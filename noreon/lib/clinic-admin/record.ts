import 'server-only';
import{z}from'zod';
import type{ClinicRpc}from'@/lib/clinic-portal/runtime';
import{careTeamEditSchema,patientsSchema,profileEditSchema,recordSchema,type EditOutcome}from'./schema';
import{requestResultSchema}from'./approvals-schema';
import{readClinicMemberMasked}from'@/lib/clinic-portal/member-masked';
/** Parses and forwards only; the database decides scope, the switch and the audit (clinic_admin_*). */
const id=z.uuid();
export async function readClinicPatients(rpc:ClinicRpc,clinicId:string){
 try{const r=await rpc.rpc('clinic_admin_patients',{p_clinic:clinicId,p_query:null});
  if(r.error)return{status:r.error.code==='42501'?'forbidden' as const:'unavailable' as const};
  const p=patientsSchema.safeParse(r.data);if(!p.success)return{status:'unavailable' as const};
  if(!p.data.enabled)return{status:'disabled' as const};
  const masked=await readClinicMemberMasked(rpc,clinicId,p.data.patients.map(member=>member.memberId));
  return{status:'loaded' as const,patients:p.data.patients,maskedMembers:masked.status==='loaded'?masked.members:[]};
 }catch{return{status:'unavailable' as const};}
}
/** 'missing' covers an unknown member and another clinic's patient alike. */
export async function readClinicPatientRecord(rpc:ClinicRpc,clinicId:string,memberId:string){
 if(!id.safeParse(memberId).success)return{status:'missing' as const};
 try{const r=await rpc.rpc('clinic_admin_patient_record',{p_clinic:clinicId,p_member:memberId});
  if(r.error)return{status:r.error.code==='42501'?'forbidden' as const:'unavailable' as const};
  const p=recordSchema.safeParse(r.data);if(!p.success)return{status:'unavailable' as const};
  if(!p.data.enabled)return{status:'disabled' as const};
  if(p.data.status==='refused')return{status:'missing' as const};
  if(p.data.pendingRequests.some(r=>r.memberId!==memberId||r.clinicId!==clinicId||r.state!=='pending')||new Set(p.data.pendingRequests.map(r=>r.kind)).size!==p.data.pendingRequests.length)return{status:'unavailable' as const};
  return p.data.member.memberId===memberId?{status:'loaded' as const,data:{...p.data,pendingRequests:p.data.pendingRequests.filter(r=>r.kind==='care_team')}}:{status:'unavailable' as const};
 }catch{return{status:'unavailable' as const};}
}
function requestOutcome(data:unknown):EditOutcome{
 const p=requestResultSchema.safeParse(data);if(!p.success)return'unavailable';
 const s=p.data.status;
 if(s==='pending'||s==='pending_exists'||s==='unchanged'||s==='stale'||s==='invalid'||s==='disabled'||s==='not_enrolled')return s;
 if(s==='age-changes')return'age_changes';
 if(s==='conflict')return'stale';
 if(p.data.status==='rejected')return p.data.reason==='nurse_unavailable'?'nurse_unavailable':'doctor_unavailable';
 return p.data.status==='refused'&&p.data.reason==='other_clinic'?'other_clinic':'refused';
}
export async function updateClinicPatientProfile(rpc:ClinicRpc,clinicId:string,memberId:string,input:unknown):Promise<EditOutcome>{
 const edit=profileEditSchema.safeParse(input);if(!id.safeParse(memberId).success||!edit.success)return'invalid';
 try{const r=await rpc.rpc('clinic_admin_change_request',{p_clinic:clinicId,p_member:memberId,p_kind:'profile',p_submission:edit.data.submissionId,p_expected:edit.data.expected,p_proposed:{name:edit.data.name,birthDate:edit.data.birthDate}});
  // The migration keeps the deployed success shape; profile 'pending' now means applied.
  const outcome=r.error?(r.error.code==='42501'?'refused':'unavailable'):requestOutcome(r.data);
  return outcome==='pending'?'saved':outcome==='pending_exists'?'stale':outcome;
 }catch{return'unavailable';}
}
export async function changeClinicPatientCareTeam(rpc:ClinicRpc,clinicId:string,memberId:string,input:unknown):Promise<EditOutcome>{
 const edit=careTeamEditSchema.safeParse(input);if(!id.safeParse(memberId).success||!edit.success)return'invalid';
 try{const r=await rpc.rpc('clinic_admin_change_request',{p_clinic:clinicId,p_member:memberId,p_kind:'care_team',p_submission:edit.data.submissionId,p_expected:{revision:edit.data.expectedRevision},p_proposed:{doctorId:edit.data.doctorId,nurseId:edit.data.nurseId}});
  return r.error?(r.error.code==='42501'?'refused':'unavailable'):requestOutcome(r.data);
 }catch{return'unavailable';}
}
