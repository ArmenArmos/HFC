'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {doctorCompletionEnabled} from './config';
import {runArrangeCommand} from './consultation-runtime';
import type {DocumentRpc} from './document-runtime';
import type {ArrangeResult} from './consultation-schema';

export const arrangeConsultation=loggedAction("arrangeConsultation",async function arrangeConsultation(input:unknown):Promise<ArrangeResult>{
 if(!doctorCompletionEnabled())return{status:'disabled'};
 const {client,identity}=await requireRealStaff();
 // A care coordinator arranges for their own clinic; the database re-checks the clinic (_staff_coordination_access).
 if(identity.role!=='admin'&&identity.role!=='coordinator')return{status:'access'};
 const result=await runArrangeCommand(client as unknown as DocumentRpc,input);
 if(result.status==='arranged')for(const path of['/staff/real/consultations','/patient/dashboard','/patient/review'])revalidatePath(path);
 return result;
});
