import {z} from 'zod';
import type {RouteModel} from '@/lib/zoe/pipeline';
import {purposeTier,type PurposeRoute} from '@/lib/zoe/purpose-route';
import {costUsd} from '@/lib/zoe/provider';
import {BUILDER_VERSION,PROMPT_VERSION,PROTOCOL_MODEL,PROTOCOL_PROVIDER,type PlanItem,type Prose} from './contracts';
import {detectPlanSummaryLanguage,missingPlanTranslations} from './language';
import {assembleDraft,guardProse} from './compose';
import {planEstimate,type PlanProvider} from './provider';
import {buildSkeleton,type PlanInput,type Refusal} from './skeleton';

/**
 * One request from the assigned doctor: build the items, reserve, call the plan_summary tier's writer, guard,
 * assemble, record. Primary model first, the fallback after a provider error. A refused reservation,
 * provider failure or guard failure still yields a protocol-only draft (code wording, US$0), so the
 * doctor gets a pre-filled editor, and the audit keeps the reason. Nothing is logged with content.
 */
export type PlanRpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
export type PlanRoute=PurposeRoute;
export type PlanDeps={rpc:PlanRpc;route:PlanRoute|null;providerFor:(model:RouteModel)=>PlanProvider|null};
export type PlanContext={memberId:string;doctorId:string;revision:number;evidenceToken:string;/** The lab values the facts were built from (doctor_ai_plan_read labToken). */labToken:string};
export type PlanOutcome={ok:true;generationId:string;mode:'model'|'protocol_only';guard:string[]}|{ok:false;code:Refusal|'disabled'|'not_assigned'|'daily_attempt_limit'|'stale'|'unavailable'};

const reserveSchema=z.union([z.object({ok:z.literal(true),generationId:z.uuid()}),z.object({ok:z.literal(false),code:z.string(),generationId:z.uuid().optional()})]);
const FINAL=new Set(['disabled','not_assigned','daily_attempt_limit','stale','invalid']);
type FinalCode='disabled'|'not_assigned'|'daily_attempt_limit'|'stale';

export async function generatePlanDraft(input:PlanInput,ctx:PlanContext,deps:PlanDeps):Promise<PlanOutcome>{
 const sk=buildSkeleton(input);
 if(typeof sk==='string')return {ok:false,code:sk};
 const base={p_user:ctx.memberId,p_doctor:ctx.doctorId,p_revision:ctx.revision,p_token:ctx.evidenceToken,p_lab_token:ctx.labToken,p_input_sha256:sk.fingerprint,p_prompt_version:PROMPT_VERSION,
  p_builder_version:BUILDER_VERSION,p_language:input.language,p_tier:deps.route?.tier??purposeTier('plan_summary')};
 const finish=(id:string,result:Record<string,unknown>)=>deps.rpc('ai_plan_finish',{p_generation:id,p_result:result});
 const memberLanguage=input.memberLanguage===undefined?input.language:input.memberLanguage;
 const missing=missingPlanTranslations(sk.items,memberLanguage);
 const memberDraft=memberLanguage==='en'||memberLanguage==='hy'?assembleDraft(sk.items,memberLanguage):{explanation:'',instructions:'',followUp:'',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[]};
 const ready=(items:PlanItem[],prose:Prose|null)=>({state:'ready',draft:memberDraft,items,summary:prose?.summary||null});
 const guard:string[]=[memberLanguage===null?'member_language_unknown':`member_language:${memberLanguage}`,...(missing.length?[`member_translation_missing:${memberLanguage}`]:[])];
 const models=deps.route?[deps.route.primary,...(deps.route.fallback?[deps.route.fallback]:[])]:[];
 for(const [n,m] of models.entries()){
  const provider=deps.providerFor(m);if(!provider)break;
  const reserved=reserveSchema.parse(await deps.rpc('ai_plan_reserve',{...base,p_model:provider.local?provider.model:m.id,p_local:provider.local,p_estimate_usd:planEstimate(provider.pricing,sk.facts)}));
  if(!reserved.ok){
   if(FINAL.has(reserved.code))return {ok:false,code:reserved.code==='invalid'?'unavailable':reserved.code as FinalCode};
   guard.push(`model_refused:${reserved.code}`.slice(0,60));break;
  }
  const started=Date.now();
  const result=await provider.write(sk.facts);
  // Spend: a local writer costs nothing; a real call records what the provider reported, even on failure
  // (a structured-output failure is billed). When the usage is unknown (timeout, network) costUsd is left
  // out, so the database keeps the reserved estimate in the shared daily spend (Codex #280 F4).
  const reported=result.usage;
  const usage={...(result.kind!=='error'?{responseModel:result.responseModel}:{}),...(reported?{inputTokens:reported.inputTokens,outputTokens:reported.outputTokens}:{}),
   ...(provider.local?{costUsd:0}:reported?{costUsd:costUsd(provider.pricing,reported)}:{})};
  const meta={provider:provider.providerName,latencyMs:Date.now()-started,fallbackUsed:n>0,...usage};
  if(result.kind==='error'){
   await finish(reserved.generationId,{state:'failed',outcome:`error_${result.errorClass}`,...meta});
   guard.push(`provider_${result.errorClass}`);continue;
  }
  const checked=result.kind==='ok'?guardProse(result.object,sk.facts):{prose:null,guard:['refusal']};
  const summaryLanguage=checked.prose?detectPlanSummaryLanguage(checked.prose.summary):null;
  const g=[...guard,`summary_language:${summaryLanguage??'unknown'}`,...checked.guard];
  const r=await finish(reserved.generationId,{...ready(sk.items,checked.prose),mode:checked.prose?'model':'protocol_only',outcome:result.kind==='ok'?(checked.prose?'drafted':'guard_rejected'):'refusal',guard:g,...meta});
  if(!z.object({ok:z.literal(true)}).safeParse(r).success)return {ok:false,code:'unavailable'};
  return {ok:true,generationId:reserved.generationId,mode:checked.prose?'model':'protocol_only',guard:g};
 }
 // Protocol only: the code's own wording, no model, no spend.
 const reserved=reserveSchema.parse(await deps.rpc('ai_plan_reserve',{...base,p_model:PROTOCOL_MODEL,p_local:true,p_estimate_usd:0}));
 if(!reserved.ok)return {ok:false,code:FINAL.has(reserved.code)&&reserved.code!=='invalid'?reserved.code as FinalCode:'unavailable'};
 const g=models.length?guard:[...guard,'writer_off'];
 const r=await finish(reserved.generationId,{...ready(sk.items,null),mode:'protocol_only',outcome:'protocol_only',provider:PROTOCOL_PROVIDER,costUsd:0,latencyMs:0,guard:g});
 if(!z.object({ok:z.literal(true)}).safeParse(r).success)return {ok:false,code:'unavailable'};
 return {ok:true,generationId:reserved.generationId,mode:'protocol_only',guard:g};
}
