'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import{revalidatePath}from'next/cache';
import{requireRealAdmin}from'@/lib/staff/real-admin';
import type{ClinicRpc}from'./runtime';
import{runResultAttach,runResultDetach}from'./result-attach-runtime';
import{resultAttachEnabled,type ResultAttachResult,type ResultDetachResult}from'./result-attach-schema';
import {scheduleLabRead} from '@/lib/lab-ai/upload-trigger';
export const attachClinicResult=loggedAction("attachClinicResult",async function attachClinicResult(clinicId:string,input:unknown):Promise<ResultAttachResult>{
 const requestStartedAt=Date.now();
 if(!resultAttachEnabled())return{status:'access'};
 const context=await requireRealAdmin();
 const result=await runResultAttach(context.client as unknown as ClinicRpc,input);
 if(result.status==='saved'){
  scheduleLabRead(result.attachmentId,requestStartedAt);
  revalidatePath(`/staff/real/clinics/${clinicId}/results`);
 }
 return result;
});
export const detachClinicResult=loggedAction("detachClinicResult",async function detachClinicResult(clinicId:string,input:unknown):Promise<ResultDetachResult>{
 if(!resultAttachEnabled())return{status:'disabled'};
 const context=await requireRealAdmin();
 const result=await runResultDetach(context.client as unknown as ClinicRpc,input);
 if(result.status==='saved')revalidatePath(`/staff/real/clinics/${clinicId}/results`);
 return result;
});
