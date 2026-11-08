'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import{revalidatePath}from'next/cache';
import{requireRealStaff}from'@/lib/patient-care/clinical-case-repository';
import{saveVisitEvidence as execute,refreshVisitEvidence as recover,type VisitRpc}from'./visit-evidence-runtime';
import{visitRefreshInputSchema,type VisitCommandResult,type VisitRefreshResult}from'./visit-evidence-schema';
export const recordRealVisitEvidence=loggedAction("recordRealVisitEvidence",async function recordRealVisitEvidence(memberId:string,input:unknown):Promise<VisitCommandResult>{
 const{client,identity}=await requireRealStaff();
 if(identity.role!=='nurse')return{status:'access'};
 const result=await execute({memberId,client:client as unknown as VisitRpc},input);
 if(result.status==='saved'){
  for(const path of[`/staff/real/members/${memberId}`,'/staff/real/members','/patient/dashboard','/patient/measurements','/patient/progress'])revalidatePath(path);
 }
 return result;
});
export const refreshRealVisitEvidence=loggedAction("refreshRealVisitEvidence",async function refreshRealVisitEvidence(memberId:string,input:unknown):Promise<VisitRefreshResult>{
 // Guard outside the recovery catch: framework redirects/404 must propagate.
 const{client,identity}=await requireRealStaff();
 if(identity.role!=='nurse'&&identity.role!=='doctor')return{status:'access'};
 const parsed=visitRefreshInputSchema.safeParse(input);
 if(!parsed.success)return{status:'unavailable'};
 if(parsed.data.command&&identity.role!=='nurse')return{status:'access'};
 const result=await recover({memberId,client:client as unknown as VisitRpc},parsed.data);
 if(result.status==='loaded')revalidatePath(`/staff/real/members/${memberId}`);
 return result;
});
