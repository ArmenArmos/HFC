'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {labAiEnabled} from './config';
import {runLabIdentity,runLabRequest,runLabReview,type LabRpcClient} from './doctor-runtime';
import type {IdentityResult,RequestResult,ReviewResult} from './doctor-schema';
import {runMemberUploadApprove} from './member-approval-server';
import type {ApproveResult} from './member-approval';
import {scheduleLabRead} from './upload-trigger';

async function doctor(){
 const {client,identity}=await requireRealStaff();
 return identity.role==='doctor'?client as unknown as LabRpcClient:null;
}
const refresh=(memberId:string,fileId?:string)=>{revalidatePath(`/staff/real/members/${memberId}`);if(fileId)revalidatePath(`/staff/real/members/${memberId}/documents/${fileId}/check`);};
export const reviewLabValue=loggedAction("reviewLabValue",async function reviewLabValue(memberId:string,fileId:string,input:unknown):Promise<ReviewResult>{
 if(!labAiEnabled())return {status:'disabled'};
 const c=await doctor();if(!c)return {status:'access'};
 const r=await runLabReview(c,memberId,input);if(r.status==='saved')refresh(memberId,fileId);return r;
});
export const confirmLabIdentity=loggedAction("confirmLabIdentity",async function confirmLabIdentity(memberId:string,fileId:string,input:unknown):Promise<IdentityResult>{
 if(!labAiEnabled())return {status:'disabled'};
 const c=await doctor();if(!c)return {status:'access'};
 const r=await runLabIdentity(c,memberId,input);if(r.status==='confirmed')refresh(memberId,fileId);return r;
});
export const requestLabReading=loggedAction("requestLabReading",async function requestLabReading(memberId:string,fileId:string):Promise<RequestResult>{
 const requestStartedAt=Date.now();
 if(!labAiEnabled())return {status:'disabled'};
 const c=await doctor();if(!c)return {status:'access'};
 const r=await runLabRequest(c,memberId,fileId);
 if(r.status==='queued'){scheduleLabRead(fileId,requestStartedAt);refresh(memberId,fileId);}
 return r;
});
/** The assigned doctor approves a member upload's reading; the database checks assignment, care access and session. */
export const approveMemberUpload=loggedAction("approveMemberUpload",async function approveMemberUpload(input:unknown):Promise<ApproveResult>{
 if(!labAiEnabled())return {status:'disabled'};
 const c=await doctor();if(!c)return {status:'access'};
 const r=await runMemberUploadApprove(c,input);
 const id=(input as {memberId?:unknown}|null)?.memberId;
 if(r.status==='approved'&&typeof id==='string'){refresh(id);revalidatePath('/patient/progress');revalidatePath('/patient/progress/earlier');}
 return r;
});
