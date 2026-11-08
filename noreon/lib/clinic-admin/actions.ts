'use server';
import{revalidatePath}from'next/cache';
import{loggedAction}from'@/lib/observability/with-logging';
import{requireClinicPortal}from'@/lib/clinic-portal/identity';
import{changeClinicPatientCareTeam,updateClinicPatientProfile}from'./record';
import type{EditOutcome}from'./schema';
import{attachMemberFile,beginMemberUpload,readMemberFiles,reserveMemberFile}from'./files';
import {attachInputSchema,type AttachResult,type ReserveResult}from'./files-schema';
import{revealClinicMember}from'./member-reveal';
import type{ClinicMemberRevealResult}from'./member-reveal-schema';
import {scheduleLabRead} from '@/lib/lab-ai/upload-trigger';
/** Full details stay in this POST response and client state; never a URL or shared cache. */
export const clinicAdminMemberReveal=loggedAction('clinicAdminMemberReveal',async function clinicAdminMemberReveal(clinicId:string,expectedScope:string,memberId:string,input:unknown):Promise<ClinicMemberRevealResult>{
 const context=await requireClinicPortal(clinicId);
 if(expectedScope!==context.actorScope||context.identity.capability!=='clinic_admin')return{ok:false,code:'refused'};
 return revealClinicMember(context.rpc,clinicId,memberId,input);
});
/** Personal data travels in a POST body, never a URL. The actor scope fences a stale tab
 * (another account or clinic signed in since the page rendered). */
export const clinicPatientProfileUpdate=loggedAction('clinicPatientProfileUpdate',async function clinicPatientProfileUpdate(clinicId:string,expectedScope:string,memberId:string,input:unknown):Promise<EditOutcome>{
 const context=await requireClinicPortal(clinicId);
 if(expectedScope!==context.actorScope||context.identity.capability!=='clinic_admin')return'refused';
 const outcome=await updateClinicPatientProfile(context.rpc,clinicId,memberId,input);
 if(outcome==='saved'){
  revalidatePath(`/clinic/real/records/${memberId}`);
  revalidatePath('/clinic/real/records');
 }
 return outcome;
});
export const clinicPatientCareTeamChange=loggedAction('clinicPatientCareTeamChange',async function clinicPatientCareTeamChange(clinicId:string,expectedScope:string,memberId:string,input:unknown):Promise<EditOutcome>{
 const context=await requireClinicPortal(clinicId);
 if(expectedScope!==context.actorScope||context.identity.capability!=='clinic_admin')return'refused';
 const outcome=await changeClinicPatientCareTeam(context.rpc,clinicId,memberId,input);
 if(outcome==='pending'||outcome==='pending_exists')revalidatePath(`/clinic/real/records/${memberId}`);
 return outcome;
});
/** Results from the member's record. Names, dates and files never travel in a URL. */
async function adminContext(clinicId:string,expectedScope:string){
 const context=await requireClinicPortal(clinicId);
 return expectedScope===context.actorScope&&context.identity.capability==='clinic_admin'?context:null;
}
export const clinicMemberUploadBegin=loggedAction('clinicMemberUploadBegin',async function clinicMemberUploadBegin(clinicId:string,expectedScope:string,memberId:string,input?:unknown){
 const context=await adminContext(clinicId,expectedScope);if(!context)return{status:'refused' as const};
 return beginMemberUpload(context.rpc,context.identity,memberId,input);
});
export const clinicMemberUploadReserve=loggedAction('clinicMemberUploadReserve',async function clinicMemberUploadReserve(clinicId:string,expectedScope:string,batchId:string,input:unknown):Promise<ReserveResult>{
 const context=await adminContext(clinicId,expectedScope);if(!context)return{status:'refused'};
 return reserveMemberFile(context.rpc,context.identity,batchId,input);
});
export const clinicMemberFilesRead=loggedAction('clinicMemberFilesRead',async function clinicMemberFilesRead(clinicId:string,expectedScope:string,memberId:string){
 const context=await adminContext(clinicId,expectedScope);if(!context)return{status:'forbidden' as const};
 return readMemberFiles(context.rpc,clinicId,memberId);
});
export const clinicMemberFileAttach=loggedAction('clinicMemberFileAttach',async function clinicMemberFileAttach(clinicId:string,expectedScope:string,memberId:string,input:unknown):Promise<AttachResult>{
 const requestStartedAt=Date.now();
 const context=await adminContext(clinicId,expectedScope);if(!context)return{status:'refused'};
 const result=await attachMemberFile(context.rpc,clinicId,memberId,input);
 if(result.status==='saved'){
  const command=attachInputSchema.safeParse(input);
  if(command.success)scheduleLabRead(command.data.fileId,requestStartedAt);
  revalidatePath(`/clinic/real/records/${memberId}`);
 }
 return result;
});
