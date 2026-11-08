'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {unstable_rethrow} from 'next/navigation';
import {z} from 'zod';
import {requireRealStaff,snapshotSchema} from './clinical-case-repository';
import {clinicalReviewEngine} from './clinical-review-engine';
import {clinicalWriteClient} from './clinical-publication-server';
import type {ClinicalFormState} from './clinical-actions';
import {doctorCompletionEnabled} from '@/lib/doctor-completion/config';
import {yerevanInputToInstant} from '@/lib/staff/yerevan-time';
import {hasEvidencePath} from './required-evidence';
import {notRecordableMessage} from '@/lib/staff/staff-server-copy';
import {currentClinicalReview,sameClinicalValue} from './clinical-review-current';
import {careAlertsEnabled} from '@/lib/care-alerts/contracts';
import {readMemberUrgent} from '@/lib/doctor-inbox/member-urgent-server';
const context=z.object({id:z.uuid(),revision:z.coerce.number().int().nonnegative(),token:z.string().regex(/^[a-f0-9]{32}$/)});
const engineRefusals=new Set([
 'Routine review is on hold: a recorded crisis-range blood pressure has no linked symptom triage or resolution. Arrange clinical assessment; later normal readings do not clear this hold.',
 'Complete the questionnaire and resolve urgent guidance first.',
 'The stored questionnaire is incomplete.',
 'Urgent guidance takes priority over routine publication.',
 'Routine publication is on hold: the native source-specific mandatory consultation pathway is unavailable. Follow the clinical rule guidance; this workspace cannot record its completion.',
 'The required home blood pressure protocol is unavailable.',
]);
const publicationBlocks:Record<string,string>={
 'Verified member required':'Not published: the member’s phone must be verified before publication.',
 'Current doctor session required':'Not published: your doctor session is no longer current. Sign in again and reload the case.',
 'Assigned active doctor required':'Not published: only the currently assigned active doctor can publish this plan.',
 'Publication request conflict':'Not published: this publication request no longer matches the case. Reload and review before trying again.',
 'Complete questionnaire and resolve urgent guidance':'Complete the questionnaire and resolve urgent guidance first.',
 'Native source-specific mandatory consultation pathway unavailable':'Routine publication is on hold: the native source-specific mandatory consultation pathway is unavailable. Follow the clinical rule guidance; this workspace cannot record its completion.',
 'Routine review is on hold: recorded crisis-range blood pressure has no linked symptom triage or resolution. Arrange clinical assessment; later normal readings do not clear this hold.':'Routine review is on hold: a recorded crisis-range blood pressure has no linked symptom triage or resolution. Arrange clinical assessment; later normal readings do not clear this hold.',
 'Regimen approval is missing':'Not published: reload the case and review every medicine and dose before publishing.',
 'Keep the change note within 1000 characters':'Keep the change note within 1000 characters.',
 'The selected values do not cover this required test':'The selected values do not cover this required test',
 'Lab results must be dated on or after the questionnaire and not in the future':'Lab results must be dated on or after the questionnaire and not in the future',
 'Approve every current imported source report':'Not published: a source report is not approved yet. Approve each current source report, then publish.',
 'Receive every required laboratory result':'Not published: a required laboratory result has not been received yet.',
 'Required source receipt is stale':'Not published: a received result changed since you recorded it (a newer report version, or a clinic lab value corrected or detached). Receive it again from the current source.',
 'Record an explicit consultation decision':'Not published: record whether a consultation is required.',
 'Complete the consultation for the current evidence':'Not published: the required consultation is not recorded as completed for the current evidence.',
 'Save a valid draft after reviewing the current evidence and gates':'Not published: save the care plan draft after reviewing the current evidence.',
 'Refresh current clinical recommendations':'Not published: the clinical recommendations changed. Reload the case and review them.',
 'Unchanged plan already published. Review and save a changed clinical draft before publishing a new version.':'Not published: this plan is unchanged since the last publication. Save a changed draft before publishing a new version.',
 'Every selected clinic lab value must be confirmed by a doctor and current':'Not saved: a selected clinic lab value is not confirmed by a doctor, or the clinic result changed. Reload and check the values.',
 'A required clinic or home-log test has no supported native receipt pathway':'Not published: a required test cannot be received in Noreon yet. Contact the Noreon team.',
 'Confirm every required clinic or home test':'Not published: a required clinic or home test is not confirmed yet. Confirm it on the Evidence tab.',
 'An abnormal investigation needs a completed consultation':'Not published: an abnormal investigation needs a completed consultation first.',
 'This evidence does not count for the requirement':'Not saved: this evidence does not count. It must be dated on or after the questionnaire, and not in the future.',
 'Describe the finding of an abnormal investigation':'Not saved: describe the finding of an abnormal result.',
 'Enter the date, result and source of the investigation':'Not saved: enter the date, result and source.',
 'Approve the current regimen before publishing':'Not published: the medicines changed since you reviewed them, or a newer plan was published. Reload the case and review the medicines again.',
 'Several-medicine plans are switched off':'Not published: plans with several medicines are switched off. Contact the Noreon team.',
 'This draft would drop medicines from the current plan':'Not published: the current plan has several medicines and this draft cannot hold them. Contact the Noreon team.',
};
export const checkRealClinicalCaseAvailability=loggedAction("checkRealClinicalCaseAvailability",async function checkRealClinicalCaseAvailability(id:string):Promise<{ok:boolean;message:string}>{
 const unavailable={ok:false,message:'The current case is unavailable. Your entries are retained. Try refreshing again when access is restored.'};
 try {
  const parsed=z.uuid().safeParse(id);
  if(!parsed.success)return unavailable;
  const {client}=await requireRealStaff();
  const response=await client.rpc('patient_clinical_case_snapshot',{p_user_id:parsed.data});
  if(response.error)return unavailable;
  const snapshot=snapshotSchema.safeParse(response.data);
  if(!snapshot.success||snapshot.data.id!==parsed.data)return unavailable;
  return {ok:true,message:''};
 }catch(error){
  unstable_rethrow(error);
  // Ordinary outages leave the editor in place; staff navigation still applies.
  return unavailable;
 }
});
export const realClinicalCommand=loggedAction("realClinicalCommand",async function realClinicalCommand(_previous:ClinicalFormState,form:FormData):Promise<ClinicalFormState>{
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor')return {ok:false,message:'Assigned doctor access is required.'};
 const parsed=context.safeParse({id:form.get('id'),revision:form.get('revision'),token:form.get('token')});
 if(!parsed.success)return {ok:false,message:'Reload this case before continuing.'};
 const c=parsed.data,op=String(form.get('operation')??'');
 let writeAttempted=false;
 let confirmedRevision:number|undefined,confirmedToken:string|undefined;
 try {
  if(op==='prepare'||op==='publish'){
   const response=await client.rpc('patient_clinical_case_snapshot',{p_user_id:c.id});
   if(response.error)return {ok:false,message:'Assigned case unavailable. Refresh the current case.'};
   const snapshot=snapshotSchema.parse(response.data);
   if(snapshot.revision!==c.revision||snapshot.evidenceToken!==c.token)return {ok:false,message:'The evidence or assignment changed. Reload and review.'};
   if(op==='publish'&&snapshot.evidence.assessment?.urgent_rule)return {ok:false,message:"Can't publish while urgent alerts are open. Resolve them first."};
   if(op==='publish'&&careAlertsEnabled()){
    const urgent=await readMemberUrgent(client,c.id);
    if(urgent.alerts.some(alert=>alert.priority==='urgent')||urgent.window)return {ok:false,message:"Can't publish while urgent alerts are open. Resolve them first."};
    if(urgent.incomplete)return {ok:false,message:'Urgent alerts could not be checked. Reload the case before publishing.'};
   }
   const engine=clinicalReviewEngine(snapshot),admin=clinicalWriteClient();
   // The database still refuses these. It reports the first unmet test in order, which for a member with labs
   // outstanding sends the doctor to a lab result that would not unblock the plan.
   const unrecordable=op==='publish'?engine.tests.filter(test=>test.method!=='lab'&&!hasEvidencePath(test.id)):[];
   if(unrecordable.length)return {ok:false,message:notRecordableMessage(unrecordable.map(test=>test.title).join(', '))};
   const args={p_user_id:c.id,p_actor:identity.id,p_expected_revision:c.revision,p_evidence_token:c.token,p_engine:engine};
   const requestId=op==='publish'?z.uuid().parse(form.get('requestId')):undefined;
   const changeSummary=op==='publish'&&doctorCompletionEnabled()?z.string().trim().max(1000).parse(String(form.get('changeSummary')??'')):null;
   // The approval block posts the hash of the regimen it showed (doctor_regimen_review); the database rechecks it under lock.
   const regimenHash=op==='publish'?form.get('regimenHash'):null;
   if(typeof regimenHash==='string'&&form.get('regimenApproved')!=='on')return {ok:false,message:'Not published: confirm that you reviewed every medicine and dose.'};
   writeAttempted=true;
   const result=op==='prepare'?await admin.rpc('prepare_patient_clinical_review',args):typeof regimenHash==='string'?await admin.rpc('publish_patient_clinical_regimen',{...args,p_request_id:requestId!,p_change_summary:changeSummary??'',p_regimen_hash:regimenHash}):changeSummary!==null?await admin.rpc('publish_patient_clinical_plan_with_summary',{...args,p_request_id:requestId!,p_change_summary:changeSummary}):await admin.rpc('publish_patient_clinical_plan',{...args,p_request_id:requestId!});
   if(result.error)throw result.error;
   const reread=await client.rpc('patient_clinical_case_snapshot',{p_user_id:c.id});
   if(reread.error)return {ok:false,uncertain:true,message:'The clinical change could not be confirmed. Refresh the current case before trying again.'};
   const confirmed=snapshotSchema.parse(reread.data);
   const matches=confirmed.id===c.id&&confirmed.evidenceToken===c.token&&(op==='prepare'
    ?confirmed.revision===Number(result.data)&&currentClinicalReview(confirmed,identity.id)
    :confirmed.publications?.some(p=>p.planId===result.data&&sameClinicalValue(p.draft,snapshot.draft)));
   if(!matches)return {ok:false,uncertain:true,message:op==='prepare'?'The clinical review could not be confirmed. Reload the case and try again.':'Publication could not be confirmed. Reload the case and check its history before trying again.'};
   confirmedRevision=confirmed.revision;confirmedToken=confirmed.evidenceToken;
  }else{
   const operation=z.enum(['approve-report','receive-result','receive-clinic-result','receive-all-clinic-results','record-investigation','receive-evidence','consultation-decision','complete-consultation']).parse(op);
   // QA 174: the database checks every value is doctor-confirmed, from this attachment and still current.
   const input=operation==='record-investigation'?{
    testId:z.string().min(1).parse(form.get('testId')),performedOn:z.iso.date().parse(form.get('performedOn')),result:z.enum(['normal','abnormal']).parse(form.get('result')),
    finding:z.string().trim().max(2000).parse(form.get('finding')??''),source:z.string().trim().min(3).max(500).parse(form.get('source')),sourceChecked:form.get('sourceChecked')==='on'
   }:operation==='receive-evidence'?{
    testId:z.string().min(1).parse(form.get('testId')),sourceId:z.uuid().parse(form.get('sourceId')),sourceChecked:form.get('sourceChecked')==='on'
   }:operation==='receive-clinic-result'||operation==='receive-all-clinic-results'?{
    attachmentId:z.uuid().parse(form.get('attachmentId')),valueIds:z.array(z.uuid()).min(1).max(100).parse([...new Set(form.getAll('valueIds').map(String))]),
    ...(operation==='receive-clinic-result'?{testId:z.string().min(1).parse(form.get('testId'))}:{}),note:z.string().trim().min(1).max(2000).parse(form.get('note')),sourceChecked:form.get('sourceChecked')==='on'
   }:operation==='approve-report'||operation==='receive-result'?{
    reportId:z.uuid().parse(form.get('reportId')),reportRevision:z.coerce.number().int().nonnegative().parse(form.get('reportRevision')),sourceChecked:form.get('sourceChecked')==='on',
    ...(operation==='receive-result'?{testId:z.string().min(1).parse(form.get('testId')),rows:z.array(z.number().int().min(0).max(99)).min(1).max(100).parse(form.getAll('rows').flatMap(value=>String(value).split(',')).map(v=>Number(v.trim())-1)),note:z.string().trim().min(1).max(2000).parse(form.get('note'))}:{})
   }:operation==='consultation-decision'?{decision:z.enum(['required','not-required']).parse(form.get('decision')),note:z.string().trim().min(1).max(2000).parse(form.get('note'))}:null;
   if(operation==='complete-consultation'){
    // QA F-02: the form sends Yerevan wall-clock time; an ISO instant is still accepted.
    const local=form.get('completedAtLocal'),completedAt=typeof local==='string'?yerevanInputToInstant(local):z.iso.datetime({offset:true}).safeParse(form.get('completedAt')).data??null;
    if(!completedAt)return {ok:false,message:'Enter the date and time the consultation took place (Yerevan time).'};
    if(Date.parse(completedAt)>Date.now())return {ok:false,message:'That time is in the future. Enter when the consultation actually took place.'};
    const note=z.string().trim().min(1).max(2000).safeParse(form.get('note'));
    if(!note.success)return {ok:false,message:'Add completion notes (up to 2000 characters).'};
    const mode=z.enum(['phone','video','in-person']).safeParse(form.get('mode'));
    if(!mode.success)return {ok:false,message:'Choose how the consultation happened.'};
    writeAttempted=true;
    const result=await client.rpc('command_patient_clinical_review',{p_user_id:c.id,p_expected_revision:c.revision,p_evidence_token:c.token,p_operation:operation,p_input:{completedAt,mode:mode.data,note:note.data}});
    // The database refuses a time before this review was prepared, or a consultation no longer required.
    if(result.error?.code==='P0001')return {ok:false,message:'Not saved. The time must be after this review was prepared, and the consultation must still be marked required. Check the time, or reload the case.'};
    if(result.error)throw result.error;
   }else{
   writeAttempted=true;
   const result=await client.rpc('command_patient_clinical_review',{p_user_id:c.id,p_expected_revision:c.revision,p_evidence_token:c.token,p_operation:operation,p_input:input});
   if(result.error)throw result.error;
   }
  }
  revalidatePath(`/staff/real/members/${c.id}`);revalidatePath('/patient/review');revalidatePath('/patient/care');revalidatePath('/patient/results');revalidatePath('/patient/dashboard');
  return {ok:true,message:op==='publish'?'Care plan published. Any notice depends on your member’s saved messaging consent.':'Review saved. Reload the case before the next step.',revision:confirmedRevision,evidenceToken:confirmedToken};
 }catch(error){
  const code=typeof error==='object'&&error!==null&&'code'in error?error.code:null;
  if(op==='publish'&&code==='40001'&&typeof error==='object'&&error!==null&&'message'in error&&error.message==='Lab values need doctor review before publication')return {ok:false,message:'Not published: unverified lab values need your review. Check the lab values before publishing.'};
  if(op==='publish'&&code==='40001'&&typeof error==='object'&&error!==null&&'message'in error&&error.message==='Lab values changed since the AI-prepared plan was saved')return {ok:false,message:'Not published: lab values changed since this draft was saved. Reload, review the labs and save the draft again.'};
  if(code==='55P03'||code==='40001')return {ok:false,message:'This case or its source evidence is changing. Reload and review before trying again.'};
  if(code==='22023'&&error instanceof Object&&'message'in error&&String(error.message).includes('what changed'))return {ok:false,message:'Describe what changed since the previous plan, then publish again.'};
  // Be conservative unless a known SQL rejection confirms the write was refused.
  if(writeAttempted&&(typeof code!=='string'||!['42501','23514','22023','P0001'].includes(code)))return {ok:false,uncertain:true,message:'The clinical change could not be confirmed. Refresh the current case before trying again.'};
  // Clinical engine refusals happen before any write and are already written for clinicians.
  const engineMessage=!writeAttempted&&typeof error==='object'&&error!==null&&'message'in error?String(error.message):'';
  if(engineMessage==='Profile and questionnaire context disagree.')return {ok:false,message:'Not ready: the member’s profile and questionnaire disagree on age or sex. Ask the member to check their profile.'};
  if(op==='publish'&&engineMessage==='Urgent guidance takes priority over routine publication.')return {ok:false,message:"Can't publish while urgent alerts are open. Resolve them first."};
  if(engineRefusals.has(engineMessage))return {ok:false,message:engineMessage};
  // Name the unmet publication requirement instead of a generic access message.
  const blocked=typeof code==='string'&&['P0001','42501','22023'].includes(code)&&typeof error==='object'&&error!==null&&'message'in error?publicationBlocks[String(error.message)]:undefined;
  if(blocked)return {ok:false,message:blocked};
  return {ok:false,message:error instanceof z.ZodError?'Check the form details.':'The clinical command could not be saved. Refresh the current case and check your access and review requirements.'};
 }
});
