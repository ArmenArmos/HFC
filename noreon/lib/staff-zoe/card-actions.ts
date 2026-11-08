'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {doctorChatHomeEnabled} from './workspace-config';
import {runDoctorCard,type DoctorCardResponse} from './card-read';

export const readDoctorCard=loggedAction('readDoctorCard',async function readDoctorCard(raw:unknown,expectedDoctorId:unknown):Promise<DoctorCardResponse>{
 if(!doctorChatHomeEnabled())return {kind:'refused'};
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor'||identity.id!==expectedDoctorId)return {kind:'refused'};
 try{return await runDoctorCard(client as unknown as Parameters<typeof runDoctorCard>[0],raw);}catch{return {kind:'unavailable'};}
});
