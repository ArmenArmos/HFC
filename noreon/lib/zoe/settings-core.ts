import {z} from 'zod';
import {TIERS,type Tier} from './routing';
import {runEvalSet,EVAL_MIN_ROWS} from './eval/run';
import {createFakeProvider} from './provider';
import {realCallsBasis} from './gateway';
import {runModelEval} from './eval/model-run';
import {providerMode} from './route-config';
import type {RouteConfig,RouteModel} from './pipeline';

/**
 * Admin AI settings (lead decisions 17 Oct 15:12, 15:15, 15:17). Testable core: the RPCs are
 * injected. A tier change runs the full eval set (EVAL_SET v6, 262 rows, plus routing rows) for the
 * candidate, the server records the result (service role), and only then may the admin's apply
 * call make it live; the database re-checks the eval, the allow-list and the never-down rule.
 */
type Env=Record<string,string|undefined>;
export type Rpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
import {zoeAiSettingsEnabled} from './policy';
export {zoeAiSettingsEnabled};

const num=z.coerce.number();
export const DATA_AGREEMENTS=['none','pending','signed'] as const;
export type DataAgreement=typeof DATA_AGREEMENTS[number];
const cfg=z.object({model:z.string(),fallback:z.string().nullable(),dailyCapUsd:num,version:z.number().int()});
export const aiSettingsSchema=z.object({ok:z.literal(true),modelCallsAllowed:z.boolean(),settingsRow:z.boolean(),
 stagingAiMode:z.boolean().default(false),directAnswersEnabled:z.boolean().default(false),totalCapUsd:num,spendDay:z.string(),spentTodayUsd:num,
 tiers:z.array(cfg.extend({tier:z.enum(TIERS),updatedAt:z.string(),spentTodayUsd:num})),
 // Providers with their data processing agreement; absent before the provider migration ran.
 providers:z.array(z.object({id:z.string(),label:z.string(),dataAgreement:z.enum(DATA_AGREEMENTS)})).default([]),
 catalog:z.array(z.object({id:z.string(),label:z.string(),provider:z.string(),strength:z.number().int().min(1).max(3),inputUsdPerMTok:num,outputUsdPerMTok:num})),
 changes:z.array(z.object({id:z.number().int(),tier:z.enum(TIERS),action:z.enum(['apply','rollback']),before:cfg,after:cfg,evalRunId:z.uuid().nullable(),rolledBackChangeId:z.number().int().nullable(),reason:z.string().nullable(),actor:z.string(),at:z.string()})),
 evalRuns:z.array(z.object({id:z.uuid(),tier:z.enum(TIERS),model:z.string(),fallback:z.string().nullable(),mode:z.enum(['plumbing','model']),harnessVersion:z.string(),totalRows:z.number().int(),mustFailures:z.number().int(),failures:z.number().int(),failedIds:z.array(z.string()),used:z.boolean(),at:z.string()})),
});
export type AiSettings=z.infer<typeof aiSettingsSchema>;
export const readAiSettings=async(admin:Rpc):Promise<AiSettings>=>aiSettingsSchema.parse(await admin('zoe_ai_settings_admin',{}));

export const tierChangeSchema=z.strictObject({tier:z.enum(TIERS),model:z.string().min(3).max(100),fallback:z.string().min(3).max(100).nullable(),
 dailyCapUsd:z.number().min(0).max(10).refine(n=>Math.abs(n*100-Math.round(n*100))<1e-6,'two decimals'),expectedVersion:z.number().int().positive(),reason:z.string().trim().max(300).optional()});
export const rollbackSchema=z.strictObject({changeId:z.number().int().positive(),expectedVersion:z.number().int().positive(),reason:z.string().trim().max(300).optional()});
export type SettingsResult=
 |{status:'applied'|'rolled_back';version:number;evalRows?:number}
 |{status:'eval_failed';total:number;mustFailures:number;failedIds:string[]}
 |{status:'refused';code:string}
 |{status:'eval_started'|'apply_started';tier:Tier;model:string}
 |{status:'disabled'|'access'|'invalid'|'unavailable'};

const asModel=(c:AiSettings['catalog'][number]):RouteModel=>({id:c.id,inputUsdPerMTok:c.inputUsdPerMTok,outputUsdPerMTok:c.outputUsdPerMTok});
/** The live route configuration with one tier replaced by the candidate. */
export function candidateConfig(s:AiSettings,tier:Tier,model:string,fallback:string|null):RouteConfig|null{
 const find=(id:string)=>s.catalog.find(c=>c.id===id);
 const config:RouteConfig={tiers:{}};
 for(const t of s.tiers){
  const m=find(t.model),f=t.fallback?find(t.fallback):undefined;
  if(m)config.tiers[t.tier]={version:t.version,dailyCapUsd:t.dailyCapUsd,model:asModel(m),fallback:f?asModel(f):null};
 }
 const m=find(model),f=fallback?find(fallback):undefined;
 if(!m||(fallback&&!f)||fallback===model)return null;
 const cur=config.tiers[tier];
 config.tiers[tier]={version:cur?.version??1,dailyCapUsd:cur?.dailyCapUsd??0,model:asModel(m),fallback:f?asModel(f):null};
 return config;
}

/**
 * Runs the eval for the candidate and applies the change only if it passes. While real calls are
 * off the set runs with the stand-in model ("plumbing", in the request); once they are on, with the
 * candidate model, in the background like the model eval (a slow model would outlast the request):
 * the job is the one-at-a-time model-eval job, and the change applies when the recorded eval passes.
 */
export async function applyTierChangeCore(input:unknown,deps:{adminId:string;admin:Rpc;service:Rpc|null;env?:Env;runEval?:typeof runEvalSet;
 defer?:(work:()=>Promise<void>)=>void;run?:typeof runModelEval;onError?:(stage:string,error:unknown)=>void}):Promise<SettingsResult>{
 const env=deps.env??process.env;
 if(!zoeAiSettingsEnabled(env))return {status:'disabled'};
 const parsed=tierChangeSchema.safeParse(input);
 if(!parsed.success)return {status:'invalid'};
 const c=parsed.data;
 if(!deps.service)return {status:'unavailable'};
 let settings:AiSettings;
 try{settings=await readAiSettings(deps.admin);}catch{return {status:'access'};}
 const config=candidateConfig(settings,c.tier,c.model,c.fallback);
 if(!config)return {status:'invalid'};
 const mode=settings.modelCallsAllowed&&providerMode(env)==='gateway'?'model':'plumbing';
 const service=deps.service;
 const record=async(s:{harnessVersion:string;total:number;mustFailures:number;failures:number;failedIds:string[]}):Promise<{ok:true;id:string}|{ok:false;code:string}>=>
  recordSchema.parse(await service('zoe_eval_run_record',{p_admin:deps.adminId,p_tier:c.tier,p_model:c.model,p_fallback:c.fallback,
   p_mode:mode,p_harness_version:s.harnessVersion,p_total:s.total,p_must_failures:s.mustFailures,p_failures:s.failures,p_failed_ids:s.failedIds}));
 const apply=async(evalId:string):Promise<SettingsResult>=>{
  const r=z.union([z.object({ok:z.literal(true),version:z.number().int()}),z.object({ok:z.literal(false),code:z.string()})]).parse(await deps.admin('zoe_tier_config_apply',{p_eval:evalId,p_daily_cap_usd:c.dailyCapUsd,p_expected_version:c.expectedVersion,p_reason:c.reason||null}));
  return r.ok?{status:'applied',version:r.version}:{status:'refused',code:r.code};
 };
 if(mode==='model'){
  // The candidate's own tier rows against the candidate model, in the background (one model-eval job at a time).
  if(!deps.defer)return {status:'unavailable'};
  let job:string;
  try{const r=startSchema.parse(await service('zoe_model_eval_start',{p_admin:deps.adminId,p_tier:c.tier,p_model:c.model}));if(!r.ok)return {status:'refused',code:r.code};job=r.id;}
  catch{return {status:'unavailable'};}
  const finish=async(evalRun:string|null,code:string|null)=>{try{await service('zoe_model_eval_finish',{p_job:job,p_eval_run:evalRun,p_error_code:code});}catch(error){deps.onError?.('finish',error);}};
  deps.defer(async()=>{
   let r:Awaited<ReturnType<typeof runModelEval>>[number]|undefined;
   try{[r]=await (deps.run??runModelEval)({config,tiers:[c.tier],env,labTier:c.tier==='high'?'high':null});}catch(error){deps.onError?.('run',error);return finish(null,'run_failed');}
   if(!r)return finish(null,'run_failed');
   let rec:Awaited<ReturnType<typeof record>>;
   try{rec=await record(r.record);}catch(error){deps.onError?.('record',error);return finish(null,'record_failed');}
   if(!rec.ok)return finish(null,'record_refused');
   // The job stays running until the change is applied, so the page never shows "Passed" for a change that did
   // not apply (Codex F1): a refusal or an error closes it as failed with its own code; nothing changed.
   if(r.record.mustFailures>0||r.record.total<EVAL_MIN_ROWS)return finish(rec.id,null);
   let a:SettingsResult;
   try{a=await apply(rec.id);}catch(error){deps.onError?.('apply',error);return finish(null,'apply_failed');}
   if(a.status!=='applied'){deps.onError?.('apply',Error(`Tier change refused: ${a.status==='refused'?a.code:a.status}`));return finish(null,'apply_refused');}
   return finish(rec.id,null);
  });
  return {status:'apply_started',tier:c.tier,model:c.model};
 }
 // Plumbing: the stand-in rows only, in the request.
 const summary=await (deps.runEval??runEvalSet)({routeConfig:config,providerFor:()=>createFakeProvider()});
 let evalId:string;
 try{
  const rec=await record(summary);
  if(!rec.ok)return {status:'refused',code:rec.code};
  evalId=rec.id;
 }catch{return {status:'unavailable'};}
 if(summary.mustFailures>0||summary.total<EVAL_MIN_ROWS)return {status:'eval_failed',total:summary.total,mustFailures:summary.mustFailures,failedIds:summary.failedIds};
 try{const a=await apply(evalId);return a.status==='applied'?{...a,evalRows:summary.total}:a;}catch{return {status:'unavailable'};}
}

export async function rollbackTierChangeCore(input:unknown,deps:{admin:Rpc;env?:Env}):Promise<SettingsResult>{
 if(!zoeAiSettingsEnabled(deps.env??process.env))return {status:'disabled'};
 const parsed=rollbackSchema.safeParse(input);
 if(!parsed.success)return {status:'invalid'};
 try{
  const r=z.union([z.object({ok:z.literal(true),version:z.number().int()}),z.object({ok:z.literal(false),code:z.string()})]).parse(await deps.admin('zoe_tier_config_rollback',{p_change:parsed.data.changeId,p_expected_version:parsed.data.expectedVersion,p_reason:parsed.data.reason||null}));
  return r.ok?{status:'rolled_back',version:r.version}:{status:'refused',code:r.code};
 }catch{return {status:'access'};}
}

/**
 * Starts the model-mode eval for one tier's CURRENT models with real Gateway calls (staging AI mode).
 * The zoe_settings guard needs such a passing run for every tier before model_calls_allowed can be
 * switched on, and again within 7 days of any later settings change. Allowed only when the app has a
 * basis for real calls and Gateway selected, and the database is in staging AI mode or already allows
 * calls (signed agreements). The calls are not reserved against the daily cap; they are bounded
 * (about 40 short calls, plus 5 lab sheets for the high tier).
 *
 * The run takes up to about 9 minutes (high tier), longer than one request, so this only starts a
 * job (one at a time, enforced by the database) and hands the work to `defer` (after() in the
 * action). The work records the zoe_eval_runs row and then closes the job; the page reads the job.
 */
export async function runTierModelEvalCore(input:unknown,deps:{adminId:string;admin:Rpc;service:Rpc|null;defer:(work:()=>Promise<void>)=>void;env?:Env;run?:typeof runModelEval;now?:()=>number;onError?:(stage:string,error:unknown)=>void}):Promise<SettingsResult>{
 const env=deps.env??process.env;
 if(!zoeAiSettingsEnabled(env))return {status:'disabled'};
 const parsed=z.strictObject({tier:z.enum(TIERS)}).safeParse(input);
 if(!parsed.success)return {status:'invalid'};
 const service=deps.service;
 if(!service)return {status:'unavailable'};
 if(providerMode(env)!=='gateway'||realCallsBasis(env)===null)return {status:'refused',code:'gateway_off'};
 let settings:AiSettings;
 try{settings=await readAiSettings(deps.admin);}catch{return {status:'access'};}
 if(!settings.stagingAiMode&&!settings.modelCallsAllowed)return {status:'refused',code:'no_basis_for_real_calls'};
 const t=settings.tiers.find(x=>x.tier===parsed.data.tier);
 const config=t?candidateConfig(settings,t.tier,t.model,t.fallback):null;
 if(!t||!config)return {status:'invalid'};
 // Real calls outside the reservation: at most one model eval per tier every 10 minutes (Fable minor, #236).
 const now=deps.now?.()??Date.now();
 if(settings.evalRuns.some(e=>e.tier===t.tier&&e.mode==='model'&&now-Date.parse(e.at)<10*60_000))return {status:'refused',code:'eval_recent'};
 let job:string;
 try{
  const r=startSchema.parse(await service('zoe_model_eval_start',{p_admin:deps.adminId,p_tier:t.tier,p_model:t.model}));
  if(!r.ok)return {status:'refused',code:r.code};
  job=r.id;
 }catch{return {status:'unavailable'};}
 const finish=async(evalRun:string|null,code:string|null)=>{
  try{await service('zoe_model_eval_finish',{p_job:job,p_eval_run:evalRun,p_error_code:code});}catch(error){deps.onError?.('finish',error);}
 };
 deps.defer(async()=>{
  let r:Awaited<ReturnType<typeof runModelEval>>[number]|undefined;
  try{[r]=await (deps.run??runModelEval)({config,tiers:[t.tier],env,labTier:t.tier==='high'?'high':null});}
  catch(error){deps.onError?.('run',error);return finish(null,'run_failed');}
  if(!r)return finish(null,'run_failed');
  try{
   const rec=recordSchema.parse(await service('zoe_eval_run_record',{p_admin:deps.adminId,p_tier:r.tier,p_model:r.model,p_fallback:r.fallback,
    p_mode:'model',p_harness_version:r.record.harnessVersion,p_total:r.record.total,p_must_failures:r.record.mustFailures,p_failures:r.record.failures,p_failed_ids:r.record.failedIds}));
   return rec.ok?finish(rec.id,null):finish(null,'record_refused');
  }catch(error){deps.onError?.('record',error);return finish(null,'record_failed');}
 });
 return {status:'eval_started',tier:t.tier,model:t.model};
}
const startSchema=z.union([z.object({ok:z.literal(true),id:z.uuid()}),z.object({ok:z.literal(false),code:z.string()})]);
const recordSchema=startSchema;

/** The latest background model eval, for the page. Absent before the jobs migration ran. */
export const evalJobSchema=z.object({ok:z.literal(true),job:z.object({id:z.uuid(),tier:z.enum(TIERS),model:z.string(),status:z.enum(['running','done','failed']),errorCode:z.string().nullable(),
 startedAt:z.string(),finishedAt:z.string().nullable(),result:z.object({total:z.number().int(),mustFailures:z.number().int(),failedIds:z.array(z.string())}).nullable()}).nullable()});
export type EvalJob=NonNullable<z.infer<typeof evalJobSchema>['job']>;
export const readEvalJob=async(admin:Rpc):Promise<EvalJob|null>=>evalJobSchema.parse(await admin('zoe_model_eval_job_admin',{})).job;
