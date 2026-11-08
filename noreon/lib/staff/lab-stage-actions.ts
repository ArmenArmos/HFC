'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import{revalidatePath}from'next/cache';
import{requireRealStaff}from'@/lib/patient-care/clinical-case-repository';
import{saveLabStage}from'./lab-stage-runtime';
import type{VisitRpc}from'./visit-evidence-runtime';
import type{LabStageResult}from'./lab-stage-schema';

export const recordRealLabStage=loggedAction("recordRealLabStage",async function recordRealLabStage(memberId:string,input:unknown):Promise<LabStageResult>{
 const{client,identity}=await requireRealStaff();
 if(identity.role!=='nurse'&&identity.role!=='doctor')return{status:'access'};
 const result=await saveLabStage({memberId,client:client as unknown as VisitRpc},input);
 if(result.status==='saved')for(const path of[`/staff/real/members/${memberId}`,'/patient/dashboard'])revalidatePath(path);
 return result;
});
