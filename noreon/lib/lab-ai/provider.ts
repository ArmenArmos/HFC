import type {ZodType} from 'zod';
import {costUsd,type ProviderPricing,type ProviderUsage} from '@/lib/zoe/provider';
import {GATEWAY_PROVIDER_NAME,zoeModelCallsEnabled,type CatalogModel} from '@/lib/zoe/gateway';
import {EXTRACTION_SYSTEM,extractionPrompt,extractionSchema,type Extraction} from './extraction';
import {NARRATIVE_SYSTEM,narrativeSchema} from './summary';

/**
 * One reader per model. The PDF goes to the model as a document part; the system prompt is fixed
 * text; no tools are offered, so text inside a PDF has nothing to call. Output is structured JSON,
 * re-validated by the caller.
 */
export type LabCallResult=
 |{kind:'ok';object:unknown;usage:ProviderUsage;responseModel:string}
 |{kind:'refusal';usage:ProviderUsage;responseModel:string}
 |{kind:'error';errorClass:'timeout'|'server_error'|'rate_limited'|'unavailable';usage:null};
export interface LabProvider{
 readonly providerName:string;readonly model:string;readonly local:boolean;readonly pricing:ProviderPricing;
 /** `pdf` holds the document bytes; mediaType says what they are (a member upload may be a photo). */
 extract(input:{pdf:Uint8Array;pageCount:number;mediaType?:LabMediaType}):Promise<LabCallResult>;
 narrate(input:{facts:unknown}):Promise<LabCallResult>;
 /** In-memory monitor photo; the caller supplies a fixed prompt and schema. No content is traced. */
 readImage?(input:{bytes:Uint8Array;mediaType:'image/jpeg'|'image/png';system:string;prompt:string;schema:ZodType;maxOutputTokens:number}):Promise<LabCallResult>;
}
export type LabMediaType='application/pdf'|'image/jpeg'|'image/png';
export const LAB_TIMEOUT_MS=90_000;
/** The narrative is optional: a short call, never a fallback, so it cannot push a job past the route's 300 s. */
export const NARRATE_TIMEOUT_MS=30_000;
export const EXTRACT_MAX_OUTPUT_TOKENS=8000,NARRATE_MAX_OUTPUT_TOKENS=800;
/** Upper-bound estimate reserved before a call: about 3,000 input tokens a page, the full output budget. */
export const estimateUsd=(p:ProviderPricing,inputTokens:number,outputTokens:number)=>costUsd(p,{inputTokens,outputTokens});
export const extractInputTokens=(pages:number)=>2000+3000*pages;
export const extractEstimate=(p:ProviderPricing,pages:number)=>estimateUsd(p,extractInputTokens(pages),EXTRACT_MAX_OUTPUT_TOKENS);
export const narrateEstimate=(p:ProviderPricing,facts:unknown)=>estimateUsd(p,1000+Math.ceil(JSON.stringify(facts).length/3),NARRATE_MAX_OUTPUT_TOKENS);

/** The narrow slice of AI SDK generateText this adapter uses. */
export type LabGenerate=(args:{model:string;system:string;prompt:string;pdf:Uint8Array|null;mediaType?:LabMediaType;schema:ZodType;maxOutputTokens:number;abortSignal:AbortSignal;privateContent?:boolean})=>
 Promise<{object:unknown;finishReason:string;usage:{inputTokens?:number|undefined;outputTokens?:number|undefined};response:{modelId:string}}>;
const defaultGenerate:LabGenerate=async a=>{
 const {generateText,Output}=await import('ai');
 const content=[...(a.pdf?[{type:'file' as const,data:a.pdf,mediaType:a.mediaType??'application/pdf'}]:[]),{type:'text' as const,text:a.prompt}];
 const r=await generateText({model:a.model,system:a.system,messages:[{role:'user',content}],output:Output.object({schema:a.schema}),
  maxOutputTokens:a.maxOutputTokens,...(a.privateContent?{telemetry:{isEnabled:false}}:{}),temperature:0,maxRetries:0,abortSignal:a.abortSignal});
 return {object:r.output,finishReason:r.finishReason,usage:{inputTokens:r.usage.inputTokens,outputTokens:r.usage.outputTokens},response:{modelId:r.response.modelId}};
};
const errorClass=(e:unknown):'timeout'|'server_error'|'rate_limited'|'unavailable'=>{
 const x=e as {name?:string;statusCode?:number;status?:number}|null;const status=x?.statusCode??x?.status;
 if(x?.name==='AbortError'||x?.name==='TimeoutError')return 'timeout';
 if(status===429)return 'rate_limited';
 if(typeof status==='number'&&status>=500)return 'server_error';
 return 'unavailable';
};

type Env=Record<string,string|undefined>;
/** Vercel AI Gateway reader. Makes no call unless NOREON_ZOE_MODEL_CALLS_ENABLED is "true"; the
 * database reservation (model_calls_allowed) is the other lock, taken before this is called. */
export function createLabGatewayProvider(model:CatalogModel,options:{env?:Env;generate?:LabGenerate;timeoutMs?:number;narrateTimeoutMs?:number;deadlineAt?:number}={}):LabProvider{
 const env=options.env??process.env,generate=options.generate??defaultGenerate;
 const pricing:ProviderPricing={inputUsdPerMTok:model.inputUsdPerMTok,outputUsdPerMTok:model.outputUsdPerMTok,label:'Gateway list price, AI settings allow-list'};
 async function call(system:string,prompt:string,pdf:Uint8Array|null,schema:ZodType,maxOutputTokens:number,timeoutMs:number,mediaType?:LabMediaType,privateContent=false):Promise<LabCallResult>{
  if(!zoeModelCallsEnabled(env))return {kind:'error',errorClass:'unavailable',usage:null};
  // Provider objects are made before reservation; the call starts after it.
  timeoutMs=Math.min(timeoutMs,(options.deadlineAt??Infinity)-Date.now());
  if(timeoutMs<=0)return {kind:'error',errorClass:'timeout',usage:null};
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeoutMs);
  try{
   const r=await generate({model:model.id,system,prompt,pdf,...(mediaType?{mediaType}:{}),schema,maxOutputTokens,abortSignal:abort.signal,...(privateContent?{privateContent:true}:{})});
   const usage={inputTokens:r.usage.inputTokens??0,outputTokens:r.usage.outputTokens??0},responseModel=r.response.modelId.slice(0,80);
   if(r.finishReason==='content-filter')return {kind:'refusal',usage,responseModel};
   return {kind:'ok',object:r.object,usage,responseModel};
  }catch(error){return {kind:'error',errorClass:abort.signal.aborted?'timeout':errorClass(error),usage:null};}
  finally{clearTimeout(timer);}
 }
 return Object.freeze({providerName:GATEWAY_PROVIDER_NAME,model:model.id,local:false,pricing,
  extract:({pdf,mediaType}:{pdf:Uint8Array;mediaType?:LabMediaType})=>call(EXTRACTION_SYSTEM,extractionPrompt(),pdf,extractionSchema,EXTRACT_MAX_OUTPUT_TOKENS,options.timeoutMs??LAB_TIMEOUT_MS,mediaType),
  readImage:({bytes,mediaType,system,prompt,schema,maxOutputTokens}:Parameters<NonNullable<LabProvider['readImage']>>[0])=>call(system,prompt,bytes,schema,maxOutputTokens,options.timeoutMs??30_000,mediaType,true),
  narrate:({facts}:{facts:unknown})=>call(NARRATIVE_SYSTEM,`<facts>\n${JSON.stringify(facts)}\n</facts>`,null,narrativeSchema,NARRATE_MAX_OUTPUT_TOKENS,options.narrateTimeoutMs??NARRATE_TIMEOUT_MS)});
}

/**
 * Deterministic stand-in. It never reads real content: it returns a fixture for a known file hash
 * (tests), or the JSON a test PDF carries after a "%NOREON-FAKE-LAB:" marker (staging QA), and
 * otherwise reports the sheet unreadable. Scenario fixtures exercise failures.
 */
export const FAKE_LAB_MODEL='noreon-fake-lab-1';
export const FAKE_MARKER='%NOREON-FAKE-LAB:';
export type FakeLabFixture=Extraction|{scenario:'timeout'|'server_error'|'refusal'}|{raw:unknown};
export function createFakeLabProvider(options:{fixtures?:Record<string,FakeLabFixture>;hash?:(pdf:Uint8Array)=>string;narrative?:unknown}={}):LabProvider{
 const pricing:ProviderPricing={inputUsdPerMTok:5,outputUsdPerMTok:25,label:'fake-provider fixture rates, not a quote'};
 const usage=(n:number)=>({inputTokens:2000+3000*n,outputTokens:600});
 return Object.freeze({providerName:'noreon.fake',model:FAKE_LAB_MODEL,local:true,pricing,
  async extract({pdf,pageCount}:{pdf:Uint8Array;pageCount:number}):Promise<LabCallResult>{
   const key=options.hash?.(pdf);
   let fx:FakeLabFixture|undefined=key?options.fixtures?.[key]:undefined;
   if(!fx){
    const text=Buffer.from(pdf.buffer,pdf.byteOffset,pdf.byteLength).toString('latin1');
    const at=text.indexOf(FAKE_MARKER);
    if(at>=0){const line=text.slice(at+FAKE_MARKER.length,text.indexOf('\n',at)>0?text.indexOf('\n',at):undefined).trim();
     try{fx={raw:JSON.parse(Buffer.from(line,'base64').toString('utf8'))};}catch{fx={raw:null};}}
   }
   if(fx&&'scenario'in fx){
    if(fx.scenario==='refusal')return {kind:'refusal',usage:usage(pageCount),responseModel:FAKE_LAB_MODEL};
    return {kind:'error',errorClass:fx.scenario,usage:null};
   }
   const object=fx?('raw'in fx?fx.raw:fx):{patients:[],sampleDate:null,labName:null,unreadable:true,results:[]};
   return {kind:'ok',object,usage:usage(pageCount),responseModel:FAKE_LAB_MODEL};
  },
  async narrate({facts}:{facts:unknown}):Promise<LabCallResult>{
   if(options.narrative!==undefined)return {kind:'ok',object:options.narrative,usage:{inputTokens:800,outputTokens:120},responseModel:FAKE_LAB_MODEL};
   const f=facts as {results?:{attention?:string|null}[];missingForPlan?:string[];workup?:{onSheet?:string[];outsideLabRange?:string[]}};
   const n=f.results?.length??0,att=f.results?.filter(r=>r.attention).length??0,miss=f.missingForPlan?.length??0,on=f.workup?.onSheet?.length??0,out=f.workup?.outsideLabRange?.length??0;
   return {kind:'ok',usage:{inputTokens:800,outputTokens:120},responseModel:FAKE_LAB_MODEL,object:{
    en:`Test stand-in summary. ${n} values were read from the PDF by software and no person has checked them yet. ${att} marked for attention; ${miss} planned tests not found on this sheet. ${on} programme tests are on the sheet, ${out} of them outside the lab range.`,
    hy:`Փորձնական ամփոփում։ PDF-ից ծրագրով կարդացվել է ${n} արժեք, որոնք դեռ ոչ ոք չի ստուգել։ Ուշադրության՝ ${att}․ պլանից չգտնված հետազոտություններ՝ ${miss}։ Ծրագրի հետազոտություններից թերթիկին կա ${on}-ը, որից ${out}-ը լաբորատորիայի միջակայքից դուրս է։`}};
  }});
}
