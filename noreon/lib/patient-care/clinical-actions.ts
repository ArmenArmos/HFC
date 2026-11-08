'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {patientIdentity} from '@/lib/patient/auth';
import {realReviewEnabled} from './real-review-config';
import {enrolClinicalCase} from './enrolment';
import {realStaffClient,requireRealStaff,snapshotSchema} from './clinical-case-repository';
import {realClinicalCommand} from './clinical-review-actions';
import {currentClinicalReview,sameClinicalValue} from './clinical-review-current';
import {checkDraft,parseMedicationTimes,parseRegimenInput} from '@/lib/service-workflow/draft-input';
import {z} from 'zod';
export type ClinicalFormState={ok:boolean;message:string;revision?:number;evidenceToken?:string;uncertain?:boolean};
const failed=(message:string):ClinicalFormState=>({ok:false,message});
export const enrollRealMember=loggedAction("enrollRealMember",async function enrollRealMember():Promise<ClinicalFormState>{
 const retry=()=>failed('Your request could not be saved. Check your profile and consent, then try again.');
 let signedIn;try{signedIn=realReviewEnabled(process.env)&&await patientIdentity();}catch{return retry();}
 if(!signedIn)return failed('Sign in and complete your verified profile first.');
 if(!await enrolClinicalCase())return retry();
 revalidatePath('/patient/review');
 return {ok:true,message:'Your review request is saved.'};
});
export const assignRealMember=loggedAction("assignRealMember",async function assignRealMember(_previous:ClinicalFormState,form:FormData):Promise<ClinicalFormState>{
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='admin')return failed('Administrator access is required.');
 const parsed=z.object({id:z.uuid(),revision:z.coerce.number().int().nonnegative(),doctor:z.union([z.uuid(),z.literal('')])}).safeParse({id:form.get('id'),revision:form.get('revision'),doctor:form.get('doctor')});
 if(!parsed.success)return failed('Check the assignment details.');
 const r=await client.rpc('assign_patient_clinical_case',{p_user_id:parsed.data.id,p_expected_revision:parsed.data.revision,p_doctor_id:parsed.data.doctor||undefined});
 if(r.error)return failed('Assignment changed or is unavailable. Reload and choose an active doctor.');
 revalidatePath('/staff/real/members');return {ok:true,message:'Assignment saved.',revision:Number(r.data)};
});
export const saveRealDraft=loggedAction("saveRealDraft",async function saveRealDraft(_previous:ClinicalFormState,form:FormData):Promise<ClinicalFormState>{
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor')return failed('Assigned doctor access is required.');
 // The regimen editor sends a list; the database decides whether that is allowed (multi_medicine_capabilities).
 const medicines=form.get('medicines');
 const text=(k:string)=>form.get(k);
 // Empty stays absent, so a draft without it is byte for byte what it was.
 const activity=String(form.get('activityLimits')??'').trim(),activityField=activity?{activityLimits:activity}:{};
 const draft=checkDraft(typeof medicines==='string'
  ?{...activityField,explanation:text('explanation'),instructions:text('instructions'),followUp:text('followUp'),medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[],medicines:parseRegimenInput(medicines)}
  :{...activityField,explanation:text('explanation'),instructions:text('instructions'),followUp:text('followUp'),medicationName:text('medicationName'),medicationDose:text('medicationDose'),medicationInstructions:text('medicationInstructions'),medicationTimes:parseMedicationTimes(form.get('medicationTimes'))});
 const context=z.object({id:z.uuid(),revision:z.coerce.number().int().nonnegative(),token:z.string().regex(/^[a-f0-9]{32}$/)}).safeParse({id:form.get('id'),revision:form.get('revision'),token:form.get('token')});
 // One fixed message per failing field (Gohar QA 161); Feedback translates each line.
 if(!draft.ok)return failed(draft.messages.join('\n'));
 if(!context.success)return failed('The case details are out of date. Reload the case and save again.');
 // Text taken from an AI-prepared draft is saved through the AI variant, which checks the draft against the
 // current evidence and lab reviews inside the save transaction (Codex #280 F2).
 const fromAi=form.get('aiGeneration');
 const aiGeneration=typeof fromAi==='string'&&fromAi?z.uuid().safeParse(fromAi):null;
 if(aiGeneration&&!aiGeneration.success)return failed('The case details are out of date. Reload the case and save again.');
 try {
  // Refresh before preparing. Revision-only changes (for example lab confirmation or a note)
  // may advance CAS only when they did not replace the editor's saved baseline.
  const read=await client.rpc('patient_clinical_case_snapshot',{p_user_id:context.data.id});
  if(read.error)return failed('The current case is unavailable. Your entries are retained. Try refreshing again when access is restored.');
  const current=snapshotSchema.parse(read.data);
  if(current.id!==context.data.id||current.evidenceToken!==context.data.token)return failed('The evidence or assignment changed. Reload, review the current evidence and save again.');
  if(current.revision!==context.data.revision){
   const baseline=form.get('baselineDraft');
   if(typeof baseline!=='string'||!sameClinicalValue(JSON.parse(baseline),current.draft))return failed('Another draft was saved. Reload and compare it with your edits before saving again.');
  }
  const prepare=new FormData();
  prepare.set('id',current.id);prepare.set('revision',String(current.revision));prepare.set('token',current.evidenceToken);prepare.set('operation','prepare');
  const prepared=await realClinicalCommand({ok:false,message:''},prepare);
  if(!prepared.ok)return {...prepared,message:`Clinical review could not be prepared.\n${prepared.message}`};
  const reviewRead=await client.rpc('patient_clinical_case_snapshot',{p_user_id:current.id});
  if(reviewRead.error)return {ok:false,uncertain:true,message:'The clinical review could not be confirmed. Reload the case and try again.'};
  const reviewed=snapshotSchema.parse(reviewRead.data);
  if(reviewed.id!==current.id||reviewed.revision!==prepared.revision||reviewed.evidenceToken!==current.evidenceToken||!currentClinicalReview(reviewed,identity.id))return failed('The evidence or assignment changed. Reload, review the current evidence and save again.');
  const args={p_user_id:reviewed.id,p_expected_revision:reviewed.revision,p_evidence_token:reviewed.evidenceToken,p_draft:draft.draft};
  const r=aiGeneration?.success?await client.rpc('save_patient_clinical_draft_from_ai',{...args,p_generation:aiGeneration.data}):await client.rpc('save_patient_clinical_draft',args);
  if(r.error)throw r.error;
  const savedRead=await client.rpc('patient_clinical_case_snapshot',{p_user_id:reviewed.id});
  if(savedRead.error)return {ok:false,uncertain:true,message:'The draft save could not be confirmed. Refresh the current case before trying again.'};
  const saved=snapshotSchema.parse(savedRead.data);
  if(saved.id!==reviewed.id||saved.revision!==Number(r.data)||saved.evidenceToken!==reviewed.evidenceToken||saved.draftStale||!sameClinicalValue(saved.review,reviewed.review)||!sameClinicalValue(saved.draft,draft.draft))return {ok:false,uncertain:true,message:'The draft save could not be confirmed. Refresh the current case before trying again.'};
  revalidatePath(`/staff/real/members/${saved.id}`);
  return {ok:true,message:'Draft saved privately. No plan is published and no notice is sent.',revision:saved.revision,evidenceToken:saved.evidenceToken};
 }catch(error){
  const code=typeof error==='object'&&error!==null&&'code'in error?error.code:null;
  // Only known SQL rejections confirm that this write was refused. Transport and
  // PostgREST infrastructure errors cannot establish whether it committed.
  if(typeof code!=='string'||!['42501','40001','23514','55P03','22023','P0001'].includes(code))return {ok:false,uncertain:true,message:'The draft save could not be confirmed. Refresh the current case before trying again.'};
  if(error instanceof Object&&'message'in error&&(error.message==='Several-medicine plans are switched off'||error.message==='This draft would drop medicines from the current plan'))return failed('Plans with several medicines are switched off. Reload the case.');
  if(aiGeneration&&code==='40001')return failed('The evidence or lab reviews changed after the AI draft was prepared. Reject the AI text or prepare a new draft, then save.');
  return failed(code==='40001'||code==='55P03'?'The evidence or assignment changed. Reload, review the current evidence and save again.':'The draft could not be saved. A completed questionnaire without urgent guidance and an active assignment are required.');
 }
});
export const realStaffSignOut=loggedAction("realStaffSignOut",async function realStaffSignOut(){const client=await realStaffClient();await client.auth.signOut({scope:'local'});redirect('/staff/real/login');});
