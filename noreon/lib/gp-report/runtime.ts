import 'server-only';
import {z} from 'zod';
import {buildGpReport,type GpReport} from './builder';
import {gpReportReadSchema,gpReportVersionMetaSchema,type GpReportRead} from './schema';
import type {GpApproval} from './document';
import {languageBlocks,type Block} from './document';
import {resultsReportEnabled} from './config';
import {resultsInputFromSource} from './results';
import type {ResultsAssessment,ResultsAssessmentInput} from '@/lib/clinical/rules/results-assessment';
import {assessmentProgress,pruneAnswers} from '@/lib/patient/questionnaire';
import type {Answers} from '@/lib/clinical/types';
import {resultEntrySchema,type SaveResultEntryResult} from './result-entry';

export type GpRpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string;message?:string}|null}>};
export type GpReportState=
 |{status:'off'}
 |{status:'unavailable'}
 |{status:'ready';read:Extract<GpReportRead,{enabled:true}>;report:GpReport};

/** Assigned doctor only; the database enforces the switch and the assignment. */
export async function readGpReport(rpc:GpRpc,memberId:string):Promise<GpReportState>{
 if(!z.uuid().safeParse(memberId).success)return{status:'unavailable'};
 try{
  const r=await rpc.rpc('doctor_gp_report_source',{p_user_id:memberId});
  // Before the migration lands the function does not exist: that is "off", not an outage.
  if(r.error)return r.error.code==='PGRST202'?{status:'off'}:{status:'unavailable'};
  const parsed=gpReportReadSchema.safeParse(r.data);
  if(!parsed.success)return{status:'unavailable'};
  if(!parsed.data.enabled)return{status:'off'};
  const read=parsed.data;
  return {status:'ready',read,report:buildGpReport({memberId:read.memberId,token:read.token,readAt:read.readAt,source:read.source,versions:read.versions,resultsAssessment:resultsReportEnabled()})};
 }catch{return{status:'unavailable'};}
}

export type ResultsBlockState={status:'off'|'unavailable'|'none'}|{
 status:'ready';memberId:string;token:string;submissionId:string;
 priorityLevel:GpReport['priorityLevel'];priority:GpReport['priority'];assessment:ResultsAssessment;
 labsShown:ResultsAssessmentInput['labs'];nonHdlOn:string|null;entries:ResultsAssessmentInput['entries'];
 reportBlocks:{en:Block[];hy:Block[]};
};
/** A bounded doctor-chat projection; unchecked names and source documents never leave this read. */
export async function readResultsBlock(rpc:GpRpc,memberId:string):Promise<ResultsBlockState>{
 if(!resultsReportEnabled())return {status:'off'};
 const state=await readGpReport(rpc,memberId);
 if(state.status!=='ready')return state;
 const block=resultsBlockFromReport(state);
 if(!block)return {status:'unavailable'};
 const s=state.read.source;
 const hasReviewedResult=s.clinicLabValues.some(v=>v.status!=='unverified')||s.labResults.some(v=>v.source!=='member'&&v.reviewedAt!==null);
 const hasPendingResult=s.clinicLabValues.some(v=>v.status==='unverified');
 if(!hasReviewedResult&&!hasPendingResult&&!Object.values(block.entries).some(Boolean))return {status:'none'};
 return block;
}

/** Reuse the same report read on the member page, including its empty entry form. */
export function resultsBlockFromReport(state:Extract<GpReportState,{status:'ready'}>):Extract<ResultsBlockState,{status:'ready'}>|null{
 const {read,report}=state;
 if(!report.results)return null;
 const answerSchema=z.object({fieldId:z.string(),value:z.union([z.string(),z.number().finite(),z.boolean(),z.array(z.string())]),source:z.enum(['manual','voice','presenter']),answeredAt:z.string()}).passthrough();
 const stored=Object.entries(read.source.assessment?.answers??{});
 const valid=stored.filter(([,v])=>answerSchema.safeParse(v).success);
 const answers=pruneAnswers(Object.fromEntries(valid) as Answers);
 const complete=Boolean(read.source.assessment?.completedAt&&stored.length===valid.length&&assessmentProgress(answers).complete);
 const input=resultsInputFromSource(read.source,read.readAt,answers,complete);
 return {status:'ready',memberId:read.memberId,token:read.token,submissionId:crypto.randomUUID(),priorityLevel:report.priorityLevel,priority:report.priority,
  assessment:report.results.assessment,labsShown:{...input.labs,totalCholesterol:input.latestTotalCholesterol},nonHdlOn:input.labs.totalCholesterol?.on??null,entries:input.entries,
  reportBlocks:{en:languageBlocks(report,null,'en'),hy:languageBlocks(report,null,'hy')}};
}

/** Pure validation plus RPC boundary, shared with the server action and isolated transport checks. */
export async function saveResultEntryRpc(rpc:GpRpc,input:unknown):Promise<SaveResultEntryResult>{
 if(!resultsReportEnabled())return {status:'off'};
 const parsed=resultEntrySchema.safeParse(input);
 if(!parsed.success)return {status:'invalid'};
 const {memberId,field,value,observedOn,submissionId}=parsed.data;
 try{
  const r=await rpc.rpc('doctor_result_entry_save',{p_user_id:memberId,p_field:field,p_number:typeof value==='number'?value:null,p_finding:typeof value==='string'?value:null,p_observed_on:observedOn,p_submission_id:submissionId});
  if(r.error)return {status:r.error.code==='55P03'||r.error.code==='PGRST202'?'off':r.error.code==='42501'?'access':['22023','23514','23502'].includes(r.error.code??'')?'invalid':'outcome-unknown'};
  return z.object({id:z.string()}).safeParse(r.data).success?{status:'saved'}:{status:'outcome-unknown'};
 }catch{return {status:'outcome-unknown'};}
}

const approvedSchema=z.object({version:z.number().int().positive(),approvedAt:z.string(),approvedByName:z.string(),contentSha256:z.string()});
export type ApproveResult={status:'approved';approval:GpApproval}|{status:'stale'|'off'|'access'|'outcome-unknown'|'invalid'};

/**
 * Approval rebuilds the report on the server from the current records and approves
 * exactly that. The page only sends the token it showed, so an approval can never
 * cover content the doctor did not see or content from the browser.
 */
export async function approveGpReport(rpc:GpRpc,memberId:string,shownToken:string,submissionId:string,shownResultsAssessment=false):Promise<ApproveResult>{
 if(!z.uuid().safeParse(memberId).success||!z.uuid().safeParse(submissionId).success||!/^[0-9a-f]{32}$/.test(shownToken))return{status:'invalid'};
 const state=await readGpReport(rpc,memberId);
 if(state.status==='off')return{status:'off'};
 if(state.status!=='ready')return{status:'outcome-unknown'};
 // The database token identifies source rows, while the feature switch changes
 // the document. A view from another report mode needs a fresh acknowledgement.
 if(shownResultsAssessment!==Boolean(state.report.results))return {status:'stale'};
 if(state.read.token!==shownToken){
  // A replay of an approval that already landed still returns its outcome.
  const replay=await approveCall(rpc,memberId,shownToken,state.report,submissionId);
  return replay.status==='approved'?replay:{status:'stale'};
 }
 return approveCall(rpc,memberId,shownToken,state.report,submissionId);
}
async function approveCall(rpc:GpRpc,memberId:string,token:string,report:GpReport,submissionId:string):Promise<ApproveResult>{
 try{
  const r=await rpc.rpc('doctor_gp_report_approve',{p_user_id:memberId,p_source_token:token,p_content:report,p_submission_id:submissionId});
  if(r.error)return r.error.code==='40001'?{status:'stale'}:r.error.code==='42501'?{status:'access'}:r.error.code==='55P03'?{status:'off'}:r.error.code==='22023'?{status:'invalid'}:{status:'outcome-unknown'};
  const p=approvedSchema.safeParse(r.data);
  return p.success?{status:'approved',approval:{version:p.data.version,approvedAt:p.data.approvedAt,approvedByName:p.data.approvedByName}}:{status:'outcome-unknown'};
 }catch{return{status:'outcome-unknown'};}
}

const versionSchema=gpReportVersionMetaSchema.extend({content:z.record(z.string(),z.unknown())});
/** A frozen approved version, exactly as approved. Null means unreadable or absent. */
export async function readApprovedGpReport(rpc:GpRpc,memberId:string,version:number):Promise<{report:GpReport;approval:GpApproval}|null>{
 if(!z.uuid().safeParse(memberId).success||!Number.isInteger(version)||version<1)return null;
 try{
  const r=await rpc.rpc('doctor_gp_report_version',{p_user_id:memberId,p_version:version});
  if(r.error||r.data==null)return null;
  const p=versionSchema.safeParse(r.data);
  if(!p.success||p.data.content.kind!=='noreon-gp-report'||p.data.content.memberId!==memberId)return null;
  return {report:p.data.content as unknown as GpReport,approval:{version:p.data.version,approvedAt:p.data.approvedAt,approvedByName:p.data.approvedByName}};
 }catch{return null;}
}
