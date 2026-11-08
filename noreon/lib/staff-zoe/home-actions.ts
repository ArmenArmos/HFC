'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {staffLocale} from '@/lib/staff/staff-locale';
import {runDoctorHome,type HomeResponse} from './home-read';
import {doctorChatHomeEnabled} from './workspace-config';

/** The wrapper logs call metadata only, never the raw search or response. */
export const readDoctorHome=loggedAction('readDoctorHome',async function readDoctorHome(raw:unknown,expectedDoctorId:unknown):Promise<HomeResponse>{
 if(!doctorChatHomeEnabled())return {kind:'refused'};
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor'||identity.id!==expectedDoctorId)return {kind:'refused'};
 try{return await runDoctorHome({client:client as unknown as Parameters<typeof runDoctorHome>[0]['client'],role:identity.role,locale:await staffLocale(identity.role)},raw);}catch{return {kind:'unavailable'};}
});
