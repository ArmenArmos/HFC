'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import{requireClinicPortal}from'./identity';
import{readClinicLabResults,runClinicLabLink}from'./lab-results-runtime';
import{resultAttachEnabled}from'./result-attach-schema';
import{clinicLabLinkCommandSchema,type ClinicLabLinkResult}from'./lab-results-schema';
import {scheduleLabRead} from '@/lib/lab-ai/upload-trigger';
/** Clinic portal: the actor scope fences a stale tab after a session or membership change. */
export const clinicLabResults=loggedAction("clinicLabResults",async function clinicLabResults(clinicId:string,batchId:string,expectedScope:string){
 if(!resultAttachEnabled())return{status:'unavailable' as const};
 const context=await requireClinicPortal(clinicId);if(expectedScope!==context.actorScope)return{status:'unavailable' as const};
 return readClinicLabResults(context.rpc,clinicId,batchId);
});
export const clinicLabLink=loggedAction("clinicLabLink",async function clinicLabLink(clinicId:string,input:unknown,expectedScope:string):Promise<ClinicLabLinkResult>{
 const requestStartedAt=Date.now();
 if(!resultAttachEnabled())return{status:'disabled'};
 const context=await requireClinicPortal(clinicId);if(expectedScope!==context.actorScope)return{status:'access'};
 const result=await runClinicLabLink(context.rpc,clinicId,input);
 if(result.status==='saved'){
  const command=clinicLabLinkCommandSchema.safeParse(input);
  if(command.success)scheduleLabRead(command.data.fileId,requestStartedAt);
 }
 return result;
});
