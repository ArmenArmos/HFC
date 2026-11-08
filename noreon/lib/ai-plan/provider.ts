import type {ZodType} from 'zod';
import {costUsd,type ProviderPricing,type ProviderUsage} from '@/lib/zoe/provider';
import {GATEWAY_PROVIDER_NAME,zoeModelCallsEnabled,realCallsBasis,type CatalogModel} from '@/lib/zoe/gateway';
import {proseSchema} from './contracts';
import {PLAN_SYSTEM,planPrompt} from './compose';

type Env=Record<string,string|undefined>;
/**
 * Which writer prepares the prose. NOREON_AI_PLAN_PROVIDER:
 *  - unset or anything else: off. Drafts are protocol-only (code wording), no model call.
 *  - "fake": the deterministic stand-in (tests, local and staging QA), labelled as such.
 *  - "gateway": the Vercel AI Gateway, only with NOREON_ZOE_MODEL_CALLS_ENABLED and a real-calls
 *    basis (realCallsBasis), like Zoe and lab reading. The database
 *    still refuses the reservation unless _zoe_real_calls_permitted(model).
 */
export function planProviderMode(env:Env=process.env):'fake'|'gateway'|'off'{
 const name=env.NOREON_AI_PLAN_PROVIDER;
 if(name==='fake')return 'fake';
 if(name==='gateway')return zoeModelCallsEnabled(env)&&realCallsBasis(env)!==null?'gateway':'off';
 return 'off';
}

/** usage is null whenever the provider did not report both token counts: the billing is then unknown, and the
 * database keeps the reserved estimate in the shared spend (Codex #280 F4). Never read a missing count as zero. */
export type PlanCallResult=
 |{kind:'ok';object:unknown;usage:ProviderUsage|null;responseModel:string}
 |{kind:'refusal';usage:ProviderUsage|null;responseModel:string}
 /** usage: what the provider reported before failing (a structured-output failure is billed), or null when unknown. */
 |{kind:'error';errorClass:'timeout'|'server_error'|'rate_limited'|'unavailable'|'invalid_output'|'output_truncated'|'out_of_credit';usage:ProviderUsage|null};
export interface PlanProvider{readonly providerName:string;readonly model:string;readonly local:boolean;readonly pricing:ProviderPricing;write(facts:unknown):Promise<PlanCallResult>;}
// Reasoning models spend 400 to 500 output tokens thinking before the JSON (integrator eval, 18 Oct): 1,500 cut the JSON off.
export const PLAN_TIMEOUT_MS=90_000,PLAN_MAX_OUTPUT_TOKENS=4000;
/** Upper bound reserved before the call: the prompt plus the facts at about 3 characters a token, and the full output budget. */
export const planEstimate=(p:ProviderPricing,facts:unknown)=>costUsd(p,{inputTokens:2000+Math.ceil(JSON.stringify(facts).length/3),outputTokens:PLAN_MAX_OUTPUT_TOKENS});

export type PlanGenerate=(args:{model:string;system:string;prompt:string;schema:ZodType;maxOutputTokens:number;abortSignal:AbortSignal})=>
 Promise<{object:unknown;finishReason:string;usage:{inputTokens?:number|undefined;outputTokens?:number|undefined};response:{modelId:string}}>;
const defaultGenerate:PlanGenerate=async a=>{
 const {generateText,Output}=await import('ai');
 const r=await generateText({model:a.model,system:a.system,prompt:a.prompt,output:Output.object({schema:a.schema}),maxOutputTokens:a.maxOutputTokens,temperature:0,maxRetries:0,abortSignal:a.abortSignal});
 return {object:r.output,finishReason:r.finishReason,usage:{inputTokens:r.usage.inputTokens,outputTokens:r.usage.outputTokens},response:{modelId:r.response.modelId}};
};
/** Usage an AI SDK error carries (for example NoObjectGeneratedError after a billed response). */
/** Both token counts, or null: a partial report is unknown billing, not zero. */
export const reportedUsage=(u:{inputTokens?:unknown;outputTokens?:unknown}|null|undefined):ProviderUsage|null=>{
 const ok=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
 return u&&ok(u.inputTokens)&&ok(u.outputTokens)?{inputTokens:u.inputTokens as number,outputTokens:u.outputTokens as number}:null;
};
const errorUsage=(e:unknown)=>reportedUsage((e as {usage?:{inputTokens?:unknown;outputTokens?:unknown}}|null)?.usage);
const errorClass=(e:unknown):'timeout'|'server_error'|'rate_limited'|'unavailable'|'invalid_output'|'output_truncated'|'out_of_credit'=>{
 const x=e as {name?:string;statusCode?:number;status?:number;finishReason?:string}|null;const status=x?.statusCode??x?.status;
 if(x?.name==='AI_NoObjectGeneratedError')return x.finishReason==='length'?'output_truncated':'invalid_output';
 if(x?.name==='AbortError'||x?.name==='TimeoutError')return 'timeout';
 if(status===429)return 'rate_limited';
 // The Gateway answers 402 / insufficient_funds when the team's AI credit is used up (integrator eval, 18 Oct).
 if(status===402||/insufficient_funds/i.test(String((e as {message?:unknown}|null)?.message??'')))return 'out_of_credit';
 if(typeof status==='number'&&status>=500)return 'server_error';
 return 'unavailable';
};

/** Gateway writer. No tools, fixed system prompt, structured output re-validated by the guard. */
export function createPlanGatewayProvider(model:CatalogModel,options:{env?:Env;generate?:PlanGenerate;timeoutMs?:number}={}):PlanProvider{
 const env=options.env??process.env,generate=options.generate??defaultGenerate;
 const pricing:ProviderPricing={inputUsdPerMTok:model.inputUsdPerMTok,outputUsdPerMTok:model.outputUsdPerMTok,label:'Gateway list price, AI settings allow-list'};
 return Object.freeze({providerName:GATEWAY_PROVIDER_NAME,model:model.id,local:false,pricing,
  async write(facts:unknown):Promise<PlanCallResult>{
   if(!zoeModelCallsEnabled(env))return {kind:'error',errorClass:'unavailable',usage:null};
   const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),options.timeoutMs??PLAN_TIMEOUT_MS);
   try{
    const r=await Promise.race([generate({model:model.id,system:PLAN_SYSTEM,prompt:planPrompt(facts),schema:proseSchema,maxOutputTokens:PLAN_MAX_OUTPUT_TOKENS,abortSignal:abort.signal}),new Promise<never>((_resolve,reject)=>{
     abort.signal.addEventListener('abort',()=>reject(Object.assign(new Error('Plan writer timed out'),{name:'TimeoutError'})),{once:true});
    })]);
    const usage=reportedUsage(r.usage),responseModel=r.response.modelId.slice(0,80);
    if(r.finishReason==='content-filter')return {kind:'refusal',usage,responseModel};
    if(r.finishReason==='length')return {kind:'error',errorClass:'output_truncated',usage};
    return {kind:'ok',object:r.object,usage,responseModel};
   }catch(error){return {kind:'error',errorClass:abort.signal.aborted?'timeout':errorClass(error),usage:errorUsage(error)};}
   finally{clearTimeout(timer);}
  }});
}

/**
 * Deterministic stand-in: rewords nothing, returns each item's default text and a fixed summary, so
 * the whole path runs without a network. Fixtures and scenarios exercise the guard and failures.
 */
export const FAKE_PLAN_MODEL='noreon-fake-plan-1';
export type FakePlanFixture={raw:unknown}|{scenario:'timeout'|'server_error'|'refusal'}|{scenario:'billed_failure';usage:ProviderUsage};
export function createFakePlanProvider(options:{fixture?:FakePlanFixture}={}):PlanProvider{
 const pricing:ProviderPricing={inputUsdPerMTok:5,outputUsdPerMTok:25,label:'fake-provider fixture rates, not a quote'};
 const usage={inputTokens:3000,outputTokens:500};
 return Object.freeze({providerName:'noreon.fake',model:FAKE_PLAN_MODEL,local:true,pricing,
  async write(facts:unknown):Promise<PlanCallResult>{
   const fx=options.fixture;
   if(fx&&'scenario'in fx){
    if(fx.scenario==='refusal')return {kind:'refusal',usage,responseModel:FAKE_PLAN_MODEL};
    if(fx.scenario==='billed_failure')return {kind:'error',errorClass:'invalid_output',usage:fx.usage};
    return {kind:'error',errorClass:fx.scenario,usage:null};
   }
   if(fx)return {kind:'ok',object:fx.raw,usage,responseModel:FAKE_PLAN_MODEL};
   // Stand-in wording that stays inside the summary vocabulary, so the whole path is exercised.
   const f=facts as {language:'hy'|'en'|'ru'};
   return {kind:'ok',usage,responseModel:FAKE_PLAN_MODEL,object:{summary:f.language==='hy'?'Կետեր պետք է որոշում։':f.language==='ru'?'Некоторые пункты требуют вашего решения.':'Several items need your judgement.'}};
  }});
}
