'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {z} from 'zod';
import {revalidatePath} from 'next/cache';
import {getStaff,workspaceAdmin,requireStaff} from './auth';
import {sharedDemoEnabled} from './cases';
import {careCommandSchema,nativeCareCommandSchema} from './care-command-schema';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {isFutureMeasurement} from '@/lib/patient/measured-at';
import type {BackofficeFormState} from './actions';
const failure={ok:false,error:'This case or assignment changed. Refresh and check your access before trying again.'};
export const staffCareCommand=loggedAction("staffCareCommand",async function staffCareCommand(input:unknown):Promise<{ok:boolean;error?:string}> {
 const parsed=careCommandSchema.safeParse(input);
 if(!parsed.success)return {ok:false,error:'Check the measurement or note details.'};
 if(parsed.data.op==='measurement'&&(isFutureMeasurement(parsed.data.measuredAt)||parsed.data.diastolic>=parsed.data.systolic))return {ok:false,error:'Check the recorded time and blood pressure values. Future measurements and diastolic values at or above systolic cannot be saved.'};
 if(!sharedDemoEnabled())return {ok:false,error:'Staff care is available in the shared workspace.'};
 const staff=await getStaff();
 if(!staff||!['doctor','nurse'].includes(staff.role))return {ok:false,error:'Assigned doctor or nurse access is required.'};
 const {caseId,caseRevision,op,...payload}=parsed.data;
 try {
  const result=await workspaceAdmin().rpc('staff_care_command',{p_id:caseId,p_actor:staff.id,p_revision:caseRevision,p_native:false,p_operation:op,p_input:payload});
  if(result.error)return failure;
  revalidatePath(`/staff/case/${caseId}`);revalidatePath('/staff/nurse');revalidatePath('/staff/doctor');
  return {ok:true};
 }catch{return failure;}
});
export const realStaffCareCommand=loggedAction("realStaffCareCommand",async function realStaffCareCommand(input:unknown):Promise<{ok:boolean;error?:string;revision?:number;uncertain?:boolean}> {
 const parsed=nativeCareCommandSchema.safeParse(input);
 if(!parsed.success)return {ok:false,error:'Check the measurement or note details.'};
 if(parsed.data.op==='measurement'&&(isFutureMeasurement(parsed.data.measuredAt)||parsed.data.diastolic>=parsed.data.systolic))return {ok:false,error:'Check the recorded time and blood pressure values. Future measurements and diastolic values at or above systolic cannot be saved.'};
 const {client,identity}=await requireRealStaff();
 if(!['doctor','nurse'].includes(identity.role))return {ok:false,error:'Assigned doctor or nurse access is required.'};
 const {id,revision,op,...payload}=parsed.data;
 const result=await client.rpc('patient_staff_care_command',{p_id:id,p_revision:revision,p_operation:op,p_input:payload});
 const savedRevision=z.number().int().nonnegative().safeParse(result.data);
 if(result.error||!savedRevision.success)return {...failure,uncertain:!result.error?.code||!['40001','42501','23514','22P02','P0001'].includes(result.error.code)};
 revalidatePath(`/staff/real/members/${id}`);revalidatePath('/patient/dashboard');
 return {ok:true,revision:savedRevision.data};
});
// Confirm current access and revision before allowing a retained entry to retry.
export const refreshRealCareTasks=loggedAction("refreshRealCareTasks",async function refreshRealCareTasks(id:unknown):Promise<{ok:boolean;error?:string;revision?:number}> {
 const parsed=z.uuid().safeParse(id);
 if(!parsed.success)return failure;
 const {client,identity}=await requireRealStaff();
 if(!['doctor','nurse'].includes(identity.role))return failure;
 const result=await client.rpc('patient_clinical_case_snapshot',{p_user_id:parsed.data});
 const snapshot=z.object({revision:z.number().int().nonnegative()}).safeParse(result.data);
 if(result.error||!snapshot.success)return {ok:false,error:'Current care tasks could not load. Your entries are retained.'};
 revalidatePath(`/staff/real/members/${parsed.data}`);
 return {ok:true,revision:snapshot.data.revision};
});
export const assignNurse=loggedAction("assignNurse",async function assignNurse(_previous:BackofficeFormState,form:FormData):Promise<BackofficeFormState> {
 const staff=await requireStaff('admin');
 const p=z.object({caseId:z.uuid(),revision:z.coerce.number().int().nonnegative(),nurseId:z.union([z.uuid(),z.literal('')])}).safeParse(Object.fromEntries(['caseId','revision','nurseId'].map(k=>[k,form.get(k)])));
 if(!p.success)return {status:'error',message:'Check the assignment details.'};
 const r=await workspaceAdmin().rpc('assign_case_nurse',{p_id:p.data.caseId,p_actor:staff.id,p_revision:p.data.revision,p_nurse:p.data.nurseId||undefined,p_native:false});
 if(r.error)return {status:'error',message:'Choose an active nurse in the assigned doctor’s clinic, or refresh a changed case.'};
 revalidatePath('/staff','layout');return {status:'success',message:'Nurse assignment saved.'};
});
export const assignRealNurse=loggedAction("assignRealNurse",async function assignRealNurse(_previous:BackofficeFormState,form:FormData):Promise<BackofficeFormState> {
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='admin')return {status:'error',message:'Administrator access is required.'};
 const p=z.object({caseId:z.uuid(),revision:z.coerce.number().int().nonnegative(),nurseId:z.union([z.uuid(),z.literal('')])}).safeParse(Object.fromEntries(['caseId','revision','nurseId'].map(k=>[k,form.get(k)])));
 if(!p.success)return {status:'error',message:'Check the assignment details.'};
 const r=await client.rpc('assign_patient_case_nurse',{p_id:p.data.caseId,p_revision:p.data.revision,p_nurse:p.data.nurseId||undefined});
 if(r.error)return {status:'error',message:'Choose an active nurse in the assigned doctor’s clinic, or refresh a changed case.'};
 revalidatePath('/staff/real/members');return {status:'success',message:'Nurse assignment saved.'};
});
