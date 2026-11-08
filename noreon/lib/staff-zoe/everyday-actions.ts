'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {doctorChatHomeEnabled} from './workspace-config';
import {runEverydayHandBack,runEverydayMark,runEverydayResolve,runEverydayCare,type EverydayContext,type EverydayResult,type EverydayCareResult} from './everyday-runtime';
import {afterHandBack} from './hand-back-sweep';

async function context(expectedDoctorId:unknown):Promise<EverydayContext|null>{
 if(!doctorChatHomeEnabled())return null;
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor'||identity.id!==expectedDoctorId)return null;
 return {client:client as unknown as EverydayContext['client'],role:identity.role,doctorId:identity.id,expectedDoctorId};
}
export const handBackDoctorCard=loggedAction('handBackDoctorCard',async function handBackDoctorCard(raw:unknown,expectedDoctorId:unknown):Promise<EverydayResult>{
 const c=await context(expectedDoctorId);if(!c)return {kind:'refused'};
 try{const result=await runEverydayHandBack(c,raw);
  afterHandBack(result);
  return result;
 }catch{return {kind:'unavailable'};}
});
export const markDoctorCardReviewed=loggedAction('markDoctorCardReviewed',async function markDoctorCardReviewed(raw:unknown,expectedDoctorId:unknown):Promise<EverydayResult>{
 const c=await context(expectedDoctorId);if(!c)return {kind:'refused'};
 try{return await runEverydayMark(c,raw);}catch{return {kind:'unavailable'};}
});
export const resolveDoctorCardAlert=loggedAction('resolveDoctorCardAlert',async function resolveDoctorCardAlert(raw:unknown,expectedDoctorId:unknown):Promise<EverydayResult>{
 const c=await context(expectedDoctorId);if(!c)return {kind:'refused'};
 try{return await runEverydayResolve(c,raw);}catch{return {kind:'unavailable'};}
});
export const doctorWorkspaceCareCommand=loggedAction('doctorWorkspaceCareCommand',async function doctorWorkspaceCareCommand(raw:unknown,expectedDoctorId:unknown):Promise<EverydayCareResult>{
 const failure={ok:false,error:'Your care record could not be confirmed. Refresh and check your access.'};
 const c=await context(expectedDoctorId);if(!c)return failure;
 try{return await runEverydayCare(c,raw);}catch{return failure;}
});
