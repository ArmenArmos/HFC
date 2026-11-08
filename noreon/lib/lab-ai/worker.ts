import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {RouteModel} from '@/lib/zoe/pipeline';
import type {PurposeRoute} from '@/lib/zoe/purpose-route';
import {costUsd} from '@/lib/zoe/provider';
import {inspectPdf,LAB_PDF_MAX_BYTES} from './pdf-inspect';
import {extractionSchema,parseDate,clean,storedValue,validateResult,type Extraction,type LabValue} from './extraction';
import {checkIdentity,type IdentityStatus} from './identity';
import {buildSummary,guardNarrative,narrativeFacts,type Narrative} from './summary';
import {extractEstimate,extractInputTokens,narrateEstimate,type LabCallResult,type LabProvider} from './provider';
import {claimedMemberUploadJobSchema,runMemberUploadJob} from './member-upload-worker';
import {dateInArmenia} from '@/lib/patient/validation';
import {autoAcceptable} from './auto-accept';

/**
 * One job: download, check the file, read it with the lab_reading tier's model, check everything the model
 * said, and record the result. Each model call is reserved first against the shared daily caps
 * (the reservation refuses real calls while model calls are off) and traced after. Nothing here
 * logs content: no names, values or PDF text reach a log line.
 */
const uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/);
const fileSchema=z.object({fileId:uuid,bucket:z.literal('clinic-originals'),objectKey:z.string().min(1).max(1024),sizeBytes:z.number().int().nonnegative(),sha256:sha,mime:z.literal('application/pdf'),uploadedOn:z.string().optional()});
const base={jobId:uuid,leaseToken:uuid,attempt:z.number().int().min(1).max(3),file:fileSchema};
export const claimedJobSchema=z.object({...base,kind:z.literal('attachment').default('attachment'),
 member:z.object({name:z.string().max(500),birthDate:z.string().nullable()}),
 /** The clinic upload's reading of these exact bytes, reused instead of a second model call. */
 cached:z.object({extraction:z.unknown(),pageCount:z.number().int().min(1).max(10),provider:z.string(),model:z.string()}).nullable().optional(),
 visitTests:z.array(z.object({id:z.string().max(200),title:z.string().max(500).nullable()})).max(100),
 previous:z.array(z.object({catalogueRef:z.string(),value:z.coerce.number(),unit:z.string().nullable(),collectedOn:z.string().nullable()})).max(60),
});
export const claimedFileJobSchema=z.object({...base,kind:z.literal('file'),
 candidates:z.array(z.object({memberId:uuid,name:z.string().max(500),birthDate:z.string().nullable(),bookingDays:z.array(z.string())})).max(300)});
export type ClaimedFileJob=z.infer<typeof claimedFileJobSchema>;
export type ClaimedJob=z.infer<typeof claimedJobSchema>;
export type LabRpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
export type LabRoute=PurposeRoute;
export type LabWorkerDeps={
 rpc:LabRpc;
 download:(bucket:string,key:string)=>Promise<Uint8Array|null>;
 /** Null when reading is off: every job is deferred, nothing is downloaded or sent. */
 route:LabRoute|null;
 providerFor:(model:RouteModel)=>LabProvider|null;
 today?:()=>string;
 now?:()=>number;
 /** Set by the sweep: after this time no optional narrative and no fallback model call starts, so a job ends inside the route's 300 s. */
 lateAfter?:number;
};
/** The calendar day in Yerevan, the database's day: a sheet collected today is never "in the future" between 00:00 and 04:00. */
export const labToday=(deps:Pick<LabWorkerDeps,'today'>)=>deps.today?.()??dateInArmenia();
const late=(deps:LabWorkerDeps)=>deps.lateAfter!=null&&(deps.now??Date.now)()>deps.lateAfter;
/** The optional narrative: skipped when the job is late; primary model only. */
export const narrateAllowed=(deps:LabWorkerDeps)=>Boolean(deps.route)&&!late(deps);
export type Finish={disposition:'done'|'rejected'|'retry'|'defer';outcome:string}&Record<string,unknown>;
const reserveSchema=z.union([z.object({ok:z.literal(true),callId:uuid}),z.object({ok:z.literal(false),code:z.string(),callId:uuid.optional()})]);
export const DEFER=new Set(['model_calls_not_permitted','tier_spend_cap_reached','daily_spend_cap_reached','tier_not_configured','model_not_configured_for_tier']);

type Called={result:LabCallResult;provider:LabProvider}|{refused:string}|{oversize:true};
/** Reserve, call, record: primary first, the fallback after a provider error (not for the summary, and not once the job is late). */
export async function callModel(job:{jobId:string|null;leaseToken:string|null},deps:LabWorkerDeps,purpose:'extract'|'summary'|'bp_photo',run:(p:LabProvider)=>Promise<LabCallResult>,estimate:(p:LabProvider)=>number,maxInputTokens?:number):Promise<Called>{
 const models=[deps.route!.primary,...(deps.route!.fallback&&purpose==='extract'?[deps.route!.fallback]:[])];
 let last:Called={refused:'provider_unavailable'};
 for(const [i,m] of models.entries()){
  if(i>0&&late(deps))break;
  const provider=deps.providerFor(m);if(!provider)return {refused:'provider_unavailable'};
  const reserved=reserveSchema.parse(await deps.rpc('lab_ai_call_reserve',{p_job:job.jobId,p_lease:job.leaseToken,p_purpose:purpose,p_tier:deps.route!.tier,
   p_model:provider.local?provider.model:m.id,p_local:provider.local,p_estimate_usd:estimate(provider)}));
  if(!reserved.ok)return {refused:reserved.code};
  // The reservation itself can take time: check again, and settle an unused reservation at no cost.
  if((i>0||purpose==='summary')&&late(deps)){
   await deps.rpc('lab_ai_call_finish',{p_call:reserved.callId,p_result:{outcome:'skipped_late',provider:provider.providerName,costUsd:0,latencyMs:0,fallbackUsed:i>0}}).catch(()=>null);
   return i>0?last:{refused:'late'};
  }
  const started=Date.now();
  const result=await run(provider);
  await deps.rpc('lab_ai_call_finish',{p_call:reserved.callId,p_result:{outcome:result.kind==='error'?`error_${result.errorClass}`:result.kind,provider:provider.providerName,
   ...(result.kind!=='error'?{responseModel:result.responseModel,inputTokens:result.usage.inputTokens,outputTokens:result.usage.outputTokens,costUsd:costUsd(provider.pricing,result.usage)}:{costUsd:purpose==='bp_photo'&&result.errorClass!=='rate_limited'?estimate(provider):0}),
   latencyMs:Date.now()-started,fallbackUsed:i>0}}).catch(()=>null);
  last={result,provider};
  // A file far larger than its checked page count (Fable F1) is paid for once: no fallback, no retry.
  if(maxInputTokens&&result.kind!=='error'&&result.usage.inputTokens>maxInputTokens)return {oversize:true};
  if(result.kind!=='error')return last;
 }
 return last;
}

type Read={ok:true;e:Extraction;pageCount:number;provider:string;model:string;local:boolean;responseModel:string}|{ok:false;finish:Finish};
/** Download, check the file, read it with the lab_reading tier's model and validate the shape. */
async function readFile(job:{jobId:string;leaseToken:string;file:ClaimedJob['file']},deps:LabWorkerDeps):Promise<Read>{
 if(job.file.sizeBytes>LAB_PDF_MAX_BYTES)return {ok:false,finish:{disposition:'rejected',outcome:'file_too_large'}};
 if(!deps.route)return {ok:false,finish:{disposition:'defer',outcome:'reading_off'}};
 const bytes=await deps.download(job.file.bucket,job.file.objectKey).catch(()=>null);
 if(!bytes)return {ok:false,finish:{disposition:'retry',outcome:'file_unavailable'}};
 if(bytes.byteLength!==job.file.sizeBytes||createHash('sha256').update(bytes).digest('hex')!==job.file.sha256)return {ok:false,finish:{disposition:'rejected',outcome:'hash_mismatch'}};
 const pdf=inspectPdf(bytes);
 if(!pdf.ok)return {ok:false,finish:{disposition:'rejected',outcome:pdf.reason}};
 const called=await callModel(job,deps,'extract',p=>p.extract({pdf:bytes,pageCount:pdf.pageCount}),p=>extractEstimate(p.pricing,pdf.pageCount),3*extractInputTokens(pdf.pageCount));
 if('oversize'in called)return {ok:false,finish:{disposition:'rejected',outcome:'input_oversize'}};
 if('refused'in called)return {ok:false,finish:DEFER.has(called.refused)||called.refused==='provider_unavailable'?{disposition:'defer',outcome:called.refused}:{disposition:'retry',outcome:called.refused}};
 const {result,provider}=called;
 if(result.kind==='error')return {ok:false,finish:{disposition:'retry',outcome:`provider_${result.errorClass}`}};
 if(result.kind==='refusal')return {ok:false,finish:{disposition:'retry',outcome:'provider_refusal'}};
 const parsed=extractionSchema.safeParse(result.object);
 if(!parsed.success)return {ok:false,finish:{disposition:'retry',outcome:'invalid_output'}};
 return {ok:true,e:parsed.data,pageCount:pdf.pageCount,provider:provider.providerName,model:provider.model,local:provider.local,responseModel:result.responseModel};
}

export async function runLabJob(job:ClaimedJob,deps:LabWorkerDeps):Promise<Finish>{
 const today=labToday(deps);
 let read:Read;
 const cached=job.cached?extractionSchema.safeParse(job.cached.extraction):null;
 if(job.cached&&cached?.success)read={ok:true,e:cached.data,pageCount:job.cached.pageCount,provider:job.cached.provider,model:job.cached.model,local:false,responseModel:job.cached.model};
 else read=await readFile(job,deps);
 if(!read.ok)return read.finish;
 const e=read.e;
 const identity=checkIdentity(e,{name:job.member.name,birthDate:job.member.birthDate});
 const ctx={pageCount:read.pageCount,sampleDate:parseDate(e.sampleDate),labName:clean(e.labName,120),today};
 const values:LabValue[]=e.unreadable||identity.status==='multiple_patients'?[]:e.results.slice(0,200).map(r=>validateResult(r,ctx));
 const base={values,previous:job.previous,visitTests:job.visitTests,identity:identity.status,pageCount:read.pageCount,model:read.responseModel,unreadable:e.unreadable};
 // The narrative is written from code-checked facts only, and only when the sheet is this member's.
 let narrative:Narrative|null=null;
 if(values.length&&narrateAllowed(deps)&&(identity.status==='match'||identity.status==='unknown')){
  const facts=narrativeFacts(buildSummary({...base,narrative:null}),values);
  const n=await callModel(job,deps,'summary',p=>p.narrate({facts}),p=>narrateEstimate(p.pricing,facts)).catch(()=>null);
  if(n&&'result'in n&&n.result.kind==='ok')narrative=guardNarrative(n.result.object,facts);
 }
 const summary=identity.status==='multiple_patients'||identity.status==='mismatch'||e.unreadable?null:buildSummary({...base,narrative});
 return {disposition:'done',outcome:e.unreadable?'unreadable':identity.status==='multiple_patients'?'multiple_patients':identity.status==='mismatch'?'identity_mismatch':values.length?'extracted':'no_values',
  pageCount:read.pageCount,sourceSha256:job.file.sha256,identityStatus:identity.status,identity:identity.detail,values:values.map(v=>({...storedValue(v),autoAccept:autoAcceptable(v,identity.status,job.file.uploadedOn??'',labToday(deps))})),summary,
  provider:read.provider,model:read.model};
}

export type Suggestion={memberId:string;confidence:'high'|'medium'|'low';identityStatus:'match'|'unknown'};
/**
 * Which of this clinic's booked members the sheet names. Decided in code: a name and date-of-birth match
 * ranks first; a name match whose booking day equals the sample date next. A tie is never "high".
 */
export function suggestMembers(e:Extraction,candidates:ClaimedFileJob['candidates']):{status:IdentityStatus;suggestions:Suggestion[]}{
 const sample=parseDate(e.sampleDate);
 const scored=candidates.map(c=>{
  const r=checkIdentity(e,{name:c.name,birthDate:c.birthDate});
  if(r.status==='multiple_patients')return null;
  const {nameMatch,birthDateMatch}=r.detail;
  let score=r.status==='match'?3:nameMatch==='yes'&&birthDateMatch==='unknown'?2:nameMatch!=='no'&&birthDateMatch==='yes'?1:0;
  if(!score)return null;
  if(sample&&c.bookingDays.includes(sample))score+=0.5;
  return {memberId:c.memberId,score,identityStatus:r.status==='match'?'match'as const:'unknown'as const};
 }).filter(x=>x!==null).sort((a,b)=>b.score-a.score);
 const people=checkIdentity(e,{name:'',birthDate:null});
 if(people.status==='multiple_patients')return {status:'multiple_patients',suggestions:[]};
 if(!scored.length)return {status:people.detail.nameOnSheet||people.detail.birthDateOnSheet?'mismatch':'unknown',suggestions:[]};
 const top=scored[0]!,tie=scored.length>1&&scored[1]!.score===top.score;
 const confidence=tie?'low':top.score>=3?'high':top.score>=2.5||(top.score>=2&&scored.length===1)?'medium':'low';
 return {status:top.identityStatus,suggestions:scored.slice(0,3).map((x,i)=>({memberId:x.memberId,identityStatus:x.identityStatus,confidence:i===0?confidence:'low'}))};
}

const targetSchema=z.object({target:z.object({memberId:uuid,name:z.string().max(500),birthDate:z.string().nullable()}).nullable()});
/** The member a file was uploaded for from their record, if any (null on any error: the reading then suggests as before). */
async function fileTarget(job:ClaimedFileJob,deps:LabWorkerDeps){
 try{const t=targetSchema.safeParse(await deps.rpc('lab_ai_file_target',{p_job:job.jobId}));return t.success?t.data.target:null;}catch{return null;}
}
/** A clinic upload, before any link: read it once and suggest a member of this clinic. A file uploaded from a
 * member's record is compared with that member instead; the database decides from nameMatch/birthDateMatch. */
export async function runFileJob(job:ClaimedFileJob,deps:LabWorkerDeps):Promise<Finish>{
 const read=await readFile(job,deps);
 if(!read.ok)return read.finish;
 const e=read.e;
 const target=await fileTarget(job,deps);
 if(target){
  const r=checkIdentity(e,{name:target.name,birthDate:target.birthDate}),status:IdentityStatus=e.unreadable&&r.status!=='multiple_patients'?'unknown':r.status;
  return {disposition:'done',outcome:e.unreadable?'unreadable':`record_upload_${status}`,pageCount:read.pageCount,sourceSha256:job.file.sha256,identityStatus:status,
   identity:{...r.detail,memberId:target.memberId},extraction:e,suggestions:[],provider:read.provider,model:read.model};
 }
 const s=e.unreadable?{status:'unknown'as IdentityStatus,suggestions:[]}:suggestMembers(e,job.candidates);
 const first=checkIdentity(e,{name:'',birthDate:null}).detail;
 return {disposition:'done',outcome:e.unreadable?'unreadable':s.status==='multiple_patients'?'multiple_patients':s.status==='mismatch'?'no_member_match':s.suggestions.length?'suggested':'no_identity',
  pageCount:read.pageCount,sourceSha256:job.file.sha256,identityStatus:s.status,
  identity:{nameOnSheet:first.nameOnSheet,birthDateOnSheet:first.birthDateOnSheet,sampleDate:first.sampleDate,patientsSeen:first.patientsSeen},
  extraction:e,suggestions:s.suggestions,provider:read.provider,model:read.model};
}

export type LabSweepReport={claimed:number;finished:Record<string,number>;failed:number};
/**
 * One pass, one job at a time, until `maxJobs` or the time budget is used: a job can take several
 * 90-second calls, and the cron function has 300 seconds (Fable F6). A crash leaves the lease to expire.
 */
export async function runLabSweep(deps:LabWorkerDeps,options:{maxJobs?:number;budgetMs?:number;lateAfterMs?:number;now?:()=>number}={}):Promise<LabSweepReport>{
 const report:LabSweepReport={claimed:0,finished:{},failed:0};
 const now=options.now??Date.now,start=now();
 // Claims stop at 120 s; a claimed job's extraction may take 2 x 90 s, so no fallback or narrative starts after 200 s.
 deps={...deps,now,lateAfter:start+(options.lateAfterMs??200_000)};
 for(let i=0;i<(options.maxJobs??4)&&now()-start<(options.budgetMs??120_000);i++){
 let jobs:unknown[];
 try{jobs=z.array(z.unknown()).parse(await deps.rpc('lab_ai_job_claim',{p_limit:1}));}catch{report.failed++;return report;}
 if(!jobs.length)break;
 for(const raw of jobs){
  report.claimed++;
  const kind=(raw as {kind?:unknown}|null)?.kind;
  const job=kind==='file'?claimedFileJobSchema.safeParse(raw):kind==='member_upload'?claimedMemberUploadJobSchema.safeParse(raw):claimedJobSchema.safeParse(raw);
  if(!job.success){report.failed++;continue;}
  let finish:Finish;
  try{finish=job.data.kind==='file'?await runFileJob(job.data,deps):job.data.kind==='member_upload'?await runMemberUploadJob(job.data,deps):await runLabJob(job.data,deps);}catch{finish={disposition:'retry',outcome:'worker_error'};}
  try{
   const r=z.object({ok:z.boolean(),state:z.string().optional(),code:z.string().optional()}).parse(await deps.rpc('lab_ai_job_finish',{p_job:job.data.jobId,p_lease:job.data.leaseToken,p_result:finish}));
   if(!r.ok&&finish.disposition==='done'){
    // The database refused the result (a value outside its checks): retry rather than lose the job.
    await deps.rpc('lab_ai_job_finish',{p_job:job.data.jobId,p_lease:job.data.leaseToken,p_result:{disposition:'retry',outcome:'result_refused'}});
    report.finished.result_refused=(report.finished.result_refused??0)+1;continue;
   }
   report.finished[finish.outcome]=(report.finished[finish.outcome]??0)+1;
  }catch{report.failed++;}
 }
 }
 return report;
}
