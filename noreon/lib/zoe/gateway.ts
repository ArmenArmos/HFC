import type {Effort,ProviderPricing,ProviderRequest,ProviderResult,ZoeProvider} from './provider';
import {aiWithoutDpaAllowed} from '../ai-posture';

/**
 * Vercel AI Gateway adapter (lead decision 17 Oct 15:15): one provider connection, AI SDK with
 * Gateway model ids such as "anthropic/claude-opus-5.5". On Vercel it authenticates with OIDC;
 * locally with AI_GATEWAY_API_KEY (never printed or stored here).
 *
 * Three independent locks (Khikar, 19 Oct 01:28: AI stays on without the staging marker):
 *  1. this adapter makes no call unless NOREON_ZOE_MODEL_CALLS_ENABLED is exactly "true";
 *  2. configuredZoeRouting only builds it when NOREON_ZOE_PROVIDER is "gateway", the flag is on and
 *     the deployment has a basis for real calls (realCallsBasis below);
 *  3. zoe_run_reserve refuses every non-local provider unless zoe_settings.model_calls_allowed is
 *     true, which the database allows only with staging_ai_mode or a signed data agreement for the
 *     model's provider. The call happens only after that reservation.
 * Tests inject `generate`; nothing in tests or CI reaches the network.
 */
type Env=Record<string,string|undefined>;
export const GATEWAY_PROVIDER_NAME='vercel.ai_gateway';
export const GATEWAY_TIMEOUT_MS=20_000;
/**
 * Fast endpoints of the same model (Gateway list, 20 Oct 2026: Anthropic fast mode, up to 2.5x output speed at 2x the
 * price). A request with fast:true for a model listed here goes to the fast id; any other model is called as usual.
 */
export const FAST_MODELS:Readonly<Record<string,string>>={'anthropic/claude-opus-5.5':'anthropic/claude-opus-5.5-fast'};
export const FAST_PRICE_MULTIPLIER=2;
export const fastAvailable=(modelId:string)=>modelId in FAST_MODELS;
export const HEALTH_GATEWAY_TIMEOUT_MS=28_000;
/** Prompt caching on the Gateway (output/zoe-speed): on unless NOREON_ZOE_GATEWAY_CACHING is "off". */
export const gatewayCaching=(env:Env=process.env)=>env.NOREON_ZOE_GATEWAY_CACHING!=='off';
export const zoeModelCallsEnabled=(env:Env=process.env)=>env.NOREON_ZOE_MODEL_CALLS_ENABLED==='true';
/**
 * The deployment basis for real calls: prod-as-staging (NOREON_PRELAUNCH_STAGING), an explicit
 * confirmation that every configured provider's data agreement is signed (NOREON_ZOE_DPA_CONFIRMED),
 * or the owner's decision to run AI before the agreements (NOREON_AI_WITHOUT_DPA_CONFIRMATION, on
 * unless "false"; lib/ai-posture.ts). The database checks the agreement or staging_ai_mode itself;
 * this only keeps a deployment from trying.
 */
export const realCallsBasis=(env:Env=process.env):'staging'|'dpa'|'owner'|null=>env.NOREON_PRELAUNCH_STAGING==='true'?'staging':env.NOREON_ZOE_DPA_CONFIRMED==='true'?'dpa':aiWithoutDpaAllowed(env)?'owner':null;
/** Whether Gateway credentials are present (yes/no only; the value is never read out). */
export const gatewayConfigured=(env:Env=process.env)=>Boolean(env.AI_GATEWAY_API_KEY?.trim()||env.VERCEL_OIDC_TOKEN?.trim()||env.VERCEL==='1');

export type CatalogModel={id:string;inputUsdPerMTok:number;outputUsdPerMTok:number};
/** The narrow slice of AI SDK generateText this adapter uses. */
export type GatewayGenerate=(args:{model:string;system:string;prompt:string;maxOutputTokens:number;temperature:number;maxRetries:number;abortSignal:AbortSignal;
 /** Reasoning effort (AI SDK 7 portable level; the Gateway maps it to Anthropic's effort). Absent: the model's default. */reasoning?:Effort;
 /** Gateway options: caching 'auto' adds Anthropic's prompt-cache marker to the static system prompt. */providerOptions?:{gateway:{caching:'auto'}};
 /** This call's limit (eval transports emulate it; the AI SDK uses the abort signal). */timeoutMs?:number})=>
 Promise<{text:string;finishReason:string;usage:{inputTokens?:number|undefined;outputTokens?:number|undefined};response:{id:string;modelId:string};
  /** Eval transports: the model's own time for the call, without the transport's start-up. */apiMs?:number}>;

const defaultGenerate:GatewayGenerate=async input=>{
 const {generateText}=await import('ai');
 // The AI SDK uses the abort signal; the limit itself is for eval transports.
 const args={...input};delete args.timeoutMs;
 const r=await generateText(args);
 return {text:r.text,finishReason:r.finishReason,usage:{inputTokens:r.usage.inputTokens,outputTokens:r.usage.outputTokens},response:{id:r.response.id,modelId:r.response.modelId}};
};

/** Models sometimes wrap the JSON object in a Markdown fence; the guard then gets the object alone. */
export const unfence=(text:string)=>{const m=/^\s*```(?:json)?[ \t]*\n([\s\S]*?)(?:\n?```\s*)?$/u.exec(text);return m?m[1]!:text;};

const errorClass=(e:unknown):'timeout'|'server_error'|'rate_limited'|'unavailable'=>{
 const x=e as {name?:string;statusCode?:number;status?:number}|null;
 const status=x?.statusCode??x?.status;
 if(x?.name==='AbortError'||x?.name==='TimeoutError')return 'timeout';
 if(status===429)return 'rate_limited';
 if(typeof status==='number'&&status>=500)return 'server_error';
 return 'unavailable';
};

export function createGatewayProvider(model:CatalogModel,options:{env?:Env;generate?:GatewayGenerate;timeoutMs?:number}={}):ZoeProvider{
 const env=options.env??process.env;
 const generate=options.generate??defaultGenerate;
 const pricing:ProviderPricing={inputUsdPerMTok:model.inputUsdPerMTok,outputUsdPerMTok:model.outputUsdPerMTok,label:'Gateway list price, 17 Oct 2026 allow-list'};
 return Object.freeze({
  providerName:GATEWAY_PROVIDER_NAME,requestModel:model.id,region:'gateway',local:false,pricing,
  async complete(req:ProviderRequest):Promise<ProviderResult>{
   if(!zoeModelCallsEnabled(env))return {kind:'error',errorClass:'unavailable',usage:null};
   // A request's own limit (the run's time budget) can only shorten the adapter's; a health answer's may reach
   // HEALTH_GATEWAY_TIMEOUT_MS (pipeline.ts HEALTH_CALL_TIMEOUT_MAX_MS).
   const limit=Math.min(options.timeoutMs??(req.purpose==='health_answer'||req.purpose==='staff_answer'?HEALTH_GATEWAY_TIMEOUT_MS:GATEWAY_TIMEOUT_MS),req.timeoutMs??Infinity);
   const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),limit);
   // The caller may stop the call earlier (Astra ZS-02); the timer is cleared in finally either way.
   const stop=()=>abort.abort();if(req.signal?.aborted)stop();else req.signal?.addEventListener('abort',stop,{once:true});
   try{
    const lang=req.replyLanguage==='hy'?'Armenian (hy)':req.replyLanguage==='ru'?'Russian (ru)':'English (en)';
    const r=await generate({model:req.fast&&FAST_MODELS[model.id]?FAST_MODELS[model.id]!:model.id,system:req.system,prompt:req.purpose==='eval_grade'||req.purpose==='reply_check'||req.purpose==='topic_check'||req.purpose==='urgency_check'?req.memberBlock:req.purpose==='health_summary'?`${req.memberBlock}\n\nSummary language: English.`:req.purpose==='symptom_intake'||req.purpose==='reply_draft'||req.purpose==='health_answer'||req.purpose==='staff_answer'?`${req.memberBlock}\n\nReply language: ${lang}.`
      :`${req.memberBlock}\n\nReply language: ${lang}.\nDirect answer allowed: ${req.directAnswerAllowed?'yes':'no'}.${req.purpose==='summary_only'?'\nSummary only: draft_reply and direct_answer must be null.':''}`,
     maxOutputTokens:req.maxOutputTokens,temperature:0,maxRetries:0,abortSignal:abort.signal,timeoutMs:limit,
     // Every system prompt here is fixed text (never member data), so the Gateway may cache it: a shorter time to first token.
     ...(gatewayCaching(env)?{providerOptions:{gateway:{caching:'auto'as const}}}:{}),...(req.effort?{reasoning:req.effort}:{})});
    const usage={inputTokens:r.usage.inputTokens??0,outputTokens:r.usage.outputTokens??0};
    const ids={responseModel:r.response.modelId.slice(0,80),responseId:r.response.id.slice(0,120)};
    if(r.finishReason==='content-filter')return {kind:'refusal',finishReason:'refusal',usage,...ids};
    return {kind:'ok',raw:unfence(r.text),finishReason:'stop',usage,...ids,...(r.finishReason==='length'?{truncated:true}:{})};
   }catch(error){return {kind:'error',errorClass:abort.signal.aborted?'timeout':errorClass(error),usage:null};}
   finally{clearTimeout(timer);req.signal?.removeEventListener('abort',stop);}
  },
 });
}
