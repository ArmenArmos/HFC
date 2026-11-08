'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {createClient} from '@/lib/supabase/server';
import {requireRegistered} from '@/lib/patient/repository';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {runCheckin,runConfirm,type ProgrammeRpc} from './runtime';
import type {CheckinResult,ConfirmResult} from './schema';

/** The member's check-in for an open checkpoint (real members only; the database decides). */
export const submitProgrammeCheckin=loggedAction("submitProgrammeCheckin",async function submitProgrammeCheckin(input:unknown):Promise<CheckinResult>{
 await requireRegistered();
 const result=await runCheckin(await createClient() as unknown as ProgrammeRpc,input);
 if(result.status==='saved')for(const path of['/patient/dashboard','/patient/progress'])revalidatePath(path);
 return result;
});

/** The assigned doctor confirms the current plan; a new plan version goes through the publish path instead. */
export const confirmProgrammePlan=loggedAction("confirmProgrammePlan",async function confirmProgrammePlan(input:unknown):Promise<ConfirmResult>{
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor')return{status:'access'};
 const result=await runConfirm(client as unknown as ProgrammeRpc,input);
 if(result.status==='confirmed'){
  const id=(input as {memberId?:string}).memberId;
  if(id)revalidatePath(`/staff/real/members/${id}`);
  revalidatePath('/staff/real/members');
 }
 return result;
});
