import 'server-only';
import {after} from 'next/server';
import {memberClearOn,memberClearContextSchema} from './member-clear';
import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';
import type {Database} from '@/lib/db/types';
import type {ZoeWhy} from './why';
import {memberRecordFrom,memberRecordRowSchema} from './member-record';
import {resumableIntakeSchema,runZoeJob,zoeJobSchema,ZOE_CONFIG_VERSION,type FinishInput,type ZoeEvent,type ZoePorts,type ZoeRouting} from './pipeline';
import type {Tier} from './routing';
import {configuredZoeProvider,type ZoeProvider} from './provider';
import {configuredZoeRouting,parseRouteConfig,providerMode} from './route-config';
import {sealRunIo} from './seal';
import {zoePipelineEnabled} from './policy';
import {planSnapshotSchema,type ReplyDraftRecord} from './reply-draft';
import {healthDataSchema} from './health-answer';
import {healthProfileSchema} from './topic';
import {logSweep} from '@/lib/observability/with-logging';
import {unreadUrgentActive,unreadUrgentResult,unreadUrgentRowsSchema} from './unread-urgent';
export {zoePipelineEnabled};

type Env=Record<string,string|undefined>;

export type ZoeRpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
const reserveResult=z.union([z.object({ok:z.literal(true)}),z.object({ok:z.literal(false),code:z.string()})]);
const finishResult=z.object({ok:z.boolean(),outcome:z.string().optional(),code:z.string().optional()});
const contextResult=z.array(z.object({runId:z.uuid(),enabled:z.boolean(),doctorName:z.string().max(120).nullable(),answeredThroughSeq:z.number().int(),
 memberSpentTodayUsd:z.number().min(0),memberDailyCapUsd:z.number().min(0).max(10).nullable().optional(),injectionsLast24h:z.number().int().min(0),locale:z.enum(['en','hy']).nullable().default(null)}));

/**
 * Conversational replies (zoe_run_context, 20261018121002): per claimed run the switch, the doctor's name
 * and the newest message already answered. Unreadable: every run goes without (the switch counts as off).
 */
async function withConversation(rpc:ZoeRpc,jobs:unknown[]):Promise<unknown[]>{
 const ids=jobs.map(j=>(j as {runId?:unknown}).runId).filter((x):x is string=>typeof x==='string');
 if(!ids.length)return jobs;
 let rows:z.infer<typeof contextResult>=[];
 try{rows=contextResult.parse(await rpc('zoe_run_context',{p_runs:ids}));}catch{return jobs;}
 const byRun=new Map(rows.map(r=>[r.runId,r]));
 return jobs.map(j=>{const c=byRun.get((j as {runId:string}).runId);return c&&j&&typeof j==='object'?{...j,conversation:{enabled:c.enabled,doctorName:c.doctorName,answeredThroughSeq:c.answeredThroughSeq,memberSpentTodayUsd:c.memberSpentTodayUsd,...(c.memberDailyCapUsd!=null?{memberDailyCapUsd:c.memberDailyCapUsd}:{}),injectionsLast24h:c.injectionsLast24h,locale:c.locale}}:j;});
}

const resumableResult=z.array(z.object({runId:z.uuid(),intake:resumableIntakeSchema.nullable()}));
/**
 * Resuming an expired intake (zoe_run_resumable, 20261019141429): per claimed run the newest intake when it expired and
 * this is the member's next message. Unreadable, or an intake off: every run goes without (the ordinary path).
 */
async function withResumable(rpc:ZoeRpc,jobs:unknown[]):Promise<unknown[]>{
 const ids=jobs.filter(j=>(j as {intake?:{enabled?:unknown}}).intake?.enabled===true).map(j=>(j as {runId?:unknown}).runId).filter((x):x is string=>typeof x==='string');
 if(!ids.length)return jobs;
 let rows:z.infer<typeof resumableResult>=[];
 try{rows=resumableResult.parse(await rpc('zoe_run_resumable',{p_runs:ids}));}catch{return jobs;}
 const byRun=new Map(rows.map(r=>[r.runId,r.intake]));
 return jobs.map(j=>{const ik=(j as {intake?:Record<string,unknown>}).intake;const r=byRun.get((j as {runId:string}).runId);
  return r&&ik?{...(j as object),intake:{...ik,resumable:r}}:j;});
}

const urgentWindowResult=z.array(z.object({runId:z.uuid(),urgentSinceMinutes:z.number().int().min(0).nullable(),
 /** Who opened the run (20261020182719); absent from an older database: a fixed rule (today's exits). */
 urgentOpenedBy:z.enum(['model','rule']).nullable().optional(),
 /** The newest member message a 103 text of the run answered (Astra N1-2); absent from an older database. */
 urgentThroughSeq:z.number().int().nullable().optional(),memberClear:memberClearContextSchema.optional(),
 /** Minutes since the last self-harm "today" reply; absent from an older database. */
 selfHarmTodayMinutes:z.number().int().min(0).nullable().optional()}));
/**
 * The 103 window (zoe_run_urgent_window): per claimed run, minutes since the current run of urgent texts began, over the
 * whole conversation (Astra #356 UW-2). A failed read or a missing row marks the run unavailable (fail closed: no answer
 * of Zoe's own unless the claimed answers show the window).
 */
async function withUrgentWindow(rpc:ZoeRpc,jobs:unknown[],alarmConversation=false):Promise<unknown[]>{
 const ids=jobs.map(j=>(j as {runId?:unknown}).runId).filter((x):x is string=>typeof x==='string');
 if(!ids.length)return jobs;
 let rows:z.infer<typeof urgentWindowResult>|null=null;
 try{rows=urgentWindowResult.parse(await rpc(alarmConversation?'zoe_run_alarm_window':'zoe_run_urgent_window',{p_runs:ids}));}catch{rows=null;}
 const byRun=new Map((rows??[]).map(r=>[r.runId,r]));
 return jobs.map(j=>{const id=(j as {runId?:unknown}).runId;const r=typeof id==='string'?byRun.get(id):undefined;
  return r?{...(j as object),urgentSinceMinutes:r.urgentSinceMinutes,urgentOpenedBy:r.urgentOpenedBy??null,urgentThroughSeq:r.urgentThroughSeq??null,...(r.memberClear?{memberClear:r.memberClear}:{}),...(r.selfHarmTodayMinutes!==undefined?{selfHarmTodayMinutes:r.selfHarmTodayMinutes}:{})}:{...(j as object),urgentWindowUnavailable:true};});
}

const planResult=z.array(z.object({runId:z.uuid(),enabled:z.boolean(),plan:planSnapshotSchema.nullable()}));
/**
 * Structured reply drafts (zoe_run_plan, 20261018213357): per claimed run the switch and the member's current
 * published plan. Unreadable: every run goes without (the free draft only). An unparsable plan: the run gets no plan.
 */
async function withReplyDraft(rpc:ZoeRpc,jobs:unknown[]):Promise<unknown[]>{
 const ids=jobs.map(j=>(j as {runId?:unknown}).runId).filter((x):x is string=>typeof x==='string');
 if(!ids.length)return jobs;
 let rows:z.infer<typeof planResult>=[];
 try{rows=planResult.parse(await rpc('zoe_run_plan',{p_runs:ids}));}catch{return jobs;}
 const byRun=new Map(rows.map(r=>[r.runId,r]));
 return jobs.map(j=>{const c=byRun.get((j as {runId:string}).runId);return c?.enabled&&j&&typeof j==='object'?{...j,replyDraft:{enabled:true,plan:c.plan}}:j;});
}

const healthResult=z.array(z.object({runId:z.uuid(),enabled:z.boolean(),data:healthDataSchema.nullable()}));
/**
 * Health answers (zoe_run_health_context, 20261019183543): per claimed run the switch and the member's own data (home BP
 * this week, doctor-reviewed results). Unreadable: every run goes without (the switch counts as off, the doctor path).
 */
async function withHealth(rpc:ZoeRpc,jobs:unknown[]):Promise<unknown[]>{
 const ids=jobs.map(j=>(j as {runId?:unknown}).runId).filter((x):x is string=>typeof x==='string');
 if(!ids.length)return jobs;
 let rows:z.infer<typeof healthResult>=[];
 try{rows=healthResult.parse(await rpc('zoe_run_health_context',{p_runs:ids}));}catch{return jobs;}
 const byRun=new Map(rows.map(r=>[r.runId,r]));
 return jobs.map(j=>{const c=byRun.get((j as {runId:string}).runId);return c?.enabled&&j&&typeof j==='object'?{...j,healthAnswers:true,health:c.data}:j;});
}

const memberRecordResult=z.array(z.object({runId:z.uuid()}).loose());
/** The record's read-only fields (zoe_run_member_record, member-record.ts). Unreadable or unparsable: the run goes without, as before. */
async function withMemberRecord(rpc:ZoeRpc,jobs:unknown[]):Promise<unknown[]>{
 const ids=jobs.map(j=>(j as {runId?:unknown}).runId).filter((x):x is string=>typeof x==='string');
 if(!ids.length)return jobs;
 let rows:z.infer<typeof memberRecordResult>=[];
 try{rows=memberRecordResult.parse(await rpc('zoe_run_member_record',{p_runs:ids}));}catch{return jobs;}
 const byRun=new Map(rows.map(r=>[r.runId,r]));
 return jobs.map(j=>{const row=memberRecordRowSchema.safeParse(byRun.get((j as {runId:string}).runId));return row.success&&j&&typeof j==='object'?{...j,viaTelegram:row.data.viaTelegram,...(row.data.enabled?{memberRecord:memberRecordFrom(row.data)}:{})}:j;});
}

const doctorModeResult=z.array(z.object({runId:z.uuid(),doctorMode:z.boolean(),scope:z.unknown().optional(),doctorMatter:z.unknown().optional()}));
const doctorScopeSchema=z.enum(['topic','conversation']);
const doctorMatterSchema=z.strictObject({reply:z.string(),minutesAgo:z.number().int(),messages:z.array(z.strictObject({text:z.string(),minutesAgo:z.number().int()})).max(5)});
/**
 * Doctor takeover (zoe_run_doctor_mode, 20261020082321): per claimed run whether the doctor has the conversation. The
 * database is the authority: zoe_run_finish holds every member text except the safety ones in doctor mode, whatever the
 * worker sends. So an unreadable state runs as before (at worst one model call whose text is then held). The result also
 * carries per-message routing (a message the member addressed to the doctor, 20261022081616); when unreadable, such a
 * message may get a Zoe answer, but _zoe_answered_open keeps it in the doctor's Waiting list either way.
 */
async function withDoctorMode(rpc:ZoeRpc,jobs:unknown[]):Promise<unknown[]>{
 const ids=jobs.map(j=>(j as {runId?:unknown}).runId).filter((x):x is string=>typeof x==='string');
 if(!ids.length)return jobs;
 let rows:z.infer<typeof doctorModeResult>=[];
 try{rows=doctorModeResult.parse(await rpc('zoe_run_doctor_mode',{p_runs:ids}));}catch{return jobs;}
 const byRun=new Map(rows.map(r=>[r.runId,r]));
 // 20261021070207: the scope and the doctor's matter. Unreadable: the 'conversation' scope (Zoe holds everything, as before).
 return jobs.map(j=>{const m=byRun.get((j as {runId:string}).runId);if(!m?.doctorMode||!j||typeof j!=='object')return j;
  const scope=doctorScopeSchema.safeParse(m.scope),matter=doctorMatterSchema.safeParse(m.doctorMatter);
  return {...j,doctorMode:true,...(scope.success&&matter.success?{doctorScope:scope.data,doctorMatter:matter.data}:{doctorScope:'conversation'as const})};});
}

const topicResult=z.array(z.object({runId:z.uuid(),breakAfterSeq:z.number().int().nullable(),startSeq:z.number().int().nullable(),zoeOwns:z.boolean(),profile:z.unknown()}));
/**
 * Topic scope (zoe_run_topic, 20261021070207; lib/zoe/topic.ts): per claimed run the member's newest divider, the topic the last
 * run recorded and the health profile. Unreadable: every run goes without (the rules alone decide the topic; no profile).
 */
async function withTopic(rpc:ZoeRpc,jobs:unknown[]):Promise<unknown[]>{
 const ids=jobs.map(j=>(j as {runId?:unknown}).runId).filter((x):x is string=>typeof x==='string');
 if(!ids.length)return jobs;
 let rows:z.infer<typeof topicResult>=[];
 try{rows=topicResult.parse(await rpc('zoe_run_topic',{p_runs:ids}));}catch{return jobs;}
 const byRun=new Map(rows.map(r=>[r.runId,r]));
 return jobs.map(j=>{const t=byRun.get((j as {runId:string}).runId);if(!t||!j||typeof j!=='object')return j;
  const profile=healthProfileSchema.safeParse(t.profile);
  return {...j,topic:{breakAfterSeq:t.breakAfterSeq,startSeq:t.startSeq,zoeOwns:t.zoeOwns,profile:profile.success?profile.data:null}};});
}

const medicineAddResult=z.object({status:z.string()});
const classifierResult=z.object({ok:z.boolean(),code:z.string().optional()});
export function zoePorts(rpc:ZoeRpc):ZoePorts{
 return {
  afterReply:after,
  reserve:async(runId:string,estimateUsd:number,local:boolean,events:ZoeEvent[],route:{tier:Tier;model:string;judgeModel?:string|null})=>reserveResult.parse(await rpc('zoe_run_reserve',{p_run:runId,p_estimate_usd:estimateUsd,p_local:local,p_events:events,p_tier:route.tier,p_model:route.model,p_judge_model:route.judgeModel??null})),
  // A refused finish is reported as such, never as the outcome the app hoped for (Fable F1, #236).
  finish:async(runId:string,input:FinishInput)=>{const r=finishResult.parse(await rpc('zoe_run_finish',{p_run:runId,p_result:{...input,configVersion:ZOE_CONFIG_VERSION}}));return r.ok?r:{ok:false,outcome:'finish_refused'};},
  // Read-only: may this run's text go to the Decisions classifier? Any failure is a no (nothing is sent).
  authorizeClassifier:async(runId:string)=>{try{const r=classifierResult.parse(await rpc('zoe_run_classifier_authorized',{p_run:runId}));return r.ok?{ok:true}:{ok:false,code:r.code};}catch{return {ok:false,code:'authorization_failed'};}},
  recordReplyDraft:async(runId:string,record:ReplyDraftRecord)=>({ok:finishResult.parse(await rpc('zoe_run_record_reply_draft',{p_run:runId,p_record:record})).ok}),
  // A medicine the member confirmed in chat, and a questionnaire correction: the run names the member, the worker never does.
  addMedicines:async(runId,medicines)=>medicineAddResult.parse(await rpc('zoe_run_medicines_add',{p_run:runId,p_medicines:medicines})),
  recordStatements:async(runId,statements)=>{await rpc('zoe_run_member_statements',{p_run:runId,p_statements:statements});},
  // A typed very high reading, saved as the member's own. A failure is one line in the logs and the reply then does not say the doctor has it.
  saveTypedBp:async(runId,r)=>{try{const j=z.object({ok:z.boolean(),notified:z.boolean().optional()}).parse(await rpc('zoe_run_bp_typed_save',{p_run:runId,p_message_seq:r.seq,p_index:r.index,p_systolic:r.systolic,p_diastolic:r.diastolic}));return {saved:j.ok,notified:j.ok&&j.notified===true};}catch{console.error(`Zoe typed reading not saved for run ${runId}`);return {saved:false,notified:false};}},
  // Never in the way of the run: a record that did not save is one line in the logs, and reads as missing.
  recordWhy:async(runId:string,why:ZoeWhy)=>{let ok=false;try{ok=finishResult.parse(await rpc('zoe_run_why_record',{p_run:runId,p_why:why})).ok;}catch{ok=false;}if(!ok)console.error(`Zoe why record not saved for run ${runId}`);return {ok};},
 };
}

export type ZoeSweepReport={claimed:number;finished:Record<string,number>;failed:number};
/**
 * One pass: claim new member messages and run each through the pipeline. A failed call leaves
 * its run started; the next claim records it as lost after ten minutes and never retries it.
 */
export async function runZoeSweep(rpc:ZoeRpc,options:{provider?:ZoeProvider|null;routing?:ZoeRouting|null;env?:Env;limit?:number;
 /** Local evals only: the reply judge to use instead of the routing's judge tier (runZoeJob's judge). */judge?:ZoeProvider|null}={}):Promise<ZoeSweepReport>{
 const env=options.env??process.env;
 const report:ZoeSweepReport={claimed:0,finished:{},failed:0};
 // Tier routing from the admin AI settings, read BEFORE claiming (quality review C-1): if it cannot be read,
 // nothing is claimed and the next sweep retries, instead of every claimed message ending tier_not_configured.
 let routing:ZoeRouting|null=options.routing===undefined?null:options.routing;
 if(options.routing===undefined){
  try{routing=configuredZoeRouting(parseRouteConfig(await rpc('zoe_route_config',{})),env);}
  catch{report.failed++;return report;}
 }
 let jobs:unknown[];
 try{jobs=z.array(z.unknown()).parse(await rpc('zoe_run_claim',{p_limit:options.limit??10}));}catch{report.failed++;return report;}
 jobs=await withMemberRecord(rpc,await withTopic(rpc,await withDoctorMode(rpc,await withUrgentWindow(rpc,await withHealth(rpc,await withResumable(rpc,await withReplyDraft(rpc,await withConversation(rpc,jobs)))),memberClearOn(env)))));
 const provider=options.provider===undefined?configuredZoeProvider(env):options.provider;
 const ports=zoePorts(rpc);
 for(const raw of jobs){
  report.claimed++;
  try{
   // Direct answers only with a real model: the stand-in's fixed text must never reach a member.
   const r=await runZoeJob(zoeJobSchema.parse(raw),{provider,ports,seal:p=>sealRunIo(p,env),env,...(routing?{routing}:{}),directAnswers:providerMode(env)==='gateway',...(options.judge!==undefined?{judge:options.judge}:{})});
   report.finished[r.outcome]=(report.finished[r.outcome]??0)+1;
  }catch(error){
   report.failed++;
   // Quality review C-3: the run is finished visibly (never left to be lost after ten minutes) and the error
   // class is logged; ids only, never content.
   const runId=typeof (raw as {runId?:unknown})?.runId==='string'?(raw as {runId:string}).runId:null;
   logSweep('zoe_job',{runId},performance.now(),'error',error);
   if(runId)await ports.finish(runId,{outcome:'no_output',reason:'worker_error',summary:null,draft:null,answer:null,language:null,guardReasons:[],redactionCount:0,usage:null,costUsd:0,latencyMs:null,
    provider:'none',model:'none',sealed:null,events:[],tier:'none',tierReason:'not_routed',fallbackUsed:false}).catch(()=>null);
  }
 }
 return report;
}

export type UnreadUrgentReport={sent:number;checked:number;failed:number};
/**
 * The fixed 103 text for Telegram members Zoe skipped (unread-urgent.ts): after her passes, because the skipped runs come from her
 * claim. No model. A failed run stays unchecked, so the next pass retries it. Without a word list in force nothing is read.
 */
export async function runUnreadUrgentPass(rpc:ZoeRpc,env:Env=process.env):Promise<UnreadUrgentReport>{
 const report={sent:0,checked:0,failed:0};
 if(!unreadUrgentActive(env))return report;
 try{
  const rows=unreadUrgentRowsSchema.parse(await rpc('zoe_unread_urgent_pending',{p_limit:10}));
  for(const row of rows){
   try{
    const r=unreadUrgentResult(row,{env,directAnswers:providerMode(env)==='gateway'});
    const done=finishResult.parse(await rpc('zoe_unread_urgent_finish',{p_run:row.runId,p_result:{...r,configVersion:ZOE_CONFIG_VERSION}}));
    if(!done.ok)report.failed++;else if(done.outcome==='urgent_sent')report.sent++;else report.checked++;
   }catch(error){report.failed++;logSweep('zoe_unread_urgent',{runId:row.runId},performance.now(),'error',error);}
  }
 }catch(error){report.failed++;logSweep('zoe_unread_urgent',{},performance.now(),'error',error);}
 return report;
}

/** Service-role RPC for Zoe server work (eval records, the sweep). Errors carry only the code. */
export function zoeServiceRpc(env:Env=process.env):ZoeRpc|null{
 const url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return null;
 const client=createClient<Database>(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 return async(name,args)=>{
  const {data,error}=await client.rpc(name as keyof Database['public']['Functions'],args as never);
  if(error)throw Error(`Zoe database unavailable (${error.code??'rpc'})`);
  return data;
 };
}
