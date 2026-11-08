'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {readNurseVisit,sendNurseVisitCollect,sendNurseVisitMark,sendNurseVisitComplete,sendNurseVisitStep,type NurseVisitRpc} from './runtime';
import {nurseVisitRowSchema,type NurseVisitReady,type NurseVisitCollectResult,type NurseVisitMarkResult,type NurseVisitCompleteResult,type NurseVisitStepResult} from './schema';

/** Reload the same visit on both legacy surfaces, without depending on the chat feature flags. */
export const refreshNurseVisit=loggedAction('refreshNurseVisit',async function refreshNurseVisit(memberId:unknown,source:unknown,id:unknown):Promise<NurseVisitReady|null>{
 const parsed=nurseVisitRowSchema.pick({memberId:true,source:true,id:true}).safeParse({memberId,source,id});
 if(!parsed.success)return null;
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='nurse')return null;
 const data=await readNurseVisit(client as unknown as NurseVisitRpc,parsed.data.memberId,parsed.data.source,parsed.data.id);
 return 'enabled'in data&&data.enabled&&data.visit.source===parsed.data.source&&data.visit.id===parsed.data.id?data:null;
});

export const recordNurseVisitMark=loggedAction("recordNurseVisitMark",async function recordNurseVisitMark(input:unknown):Promise<NurseVisitMarkResult>{
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='nurse')return{status:'access'};
 return sendNurseVisitMark(client as unknown as NurseVisitRpc,input);
});
export const recordNurseVisitComplete=loggedAction("recordNurseVisitComplete",async function recordNurseVisitComplete(input:unknown):Promise<NurseVisitCompleteResult>{
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='nurse')return{status:'access'};
 const result=await sendNurseVisitComplete(client as unknown as NurseVisitRpc,input);
 if(result.status==='saved'){
  const memberId=typeof input==='object'&&input!==null&&'memberId'in input&&typeof input.memberId==='string'?input.memberId:null;
  for(const path of['/staff/real/visits','/staff/real/members','/patient/dashboard','/patient/care','/patient/results'])revalidatePath(path);
  if(memberId)revalidatePath(`/staff/real/members/${memberId}`);
 }
 return result;
});
export const recordNurseVisitStep=loggedAction("recordNurseVisitStep",async function recordNurseVisitStep(input:unknown):Promise<NurseVisitStepResult>{
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='nurse')return{status:'access'};
 const result=await sendNurseVisitStep(client as unknown as NurseVisitRpc,input);
 if(result.status==='saved'){
  const memberId=typeof input==='object'&&input!==null&&'memberId'in input&&typeof input.memberId==='string'?input.memberId:null;
  for(const path of['/staff/real/visits','/patient/dashboard','/patient/results'])revalidatePath(path);
  if(memberId)revalidatePath(`/staff/real/members/${memberId}`);
 }
 return result;
});

export const recordNurseVisitCollect=loggedAction("recordNurseVisitCollect",async function recordNurseVisitCollect(input:unknown):Promise<NurseVisitCollectResult>{
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='nurse')return{status:'access'};
 const result=await sendNurseVisitCollect(client as unknown as NurseVisitRpc,input);
 if(result.status==='saved'){
  revalidatePath('/staff/real/visits');
  const memberId=typeof input==='object'&&input!==null&&'memberId'in input&&typeof input.memberId==='string'?input.memberId:null;
  if(memberId)revalidatePath(`/staff/real/members/${memberId}`);
 }
 return result;
});
