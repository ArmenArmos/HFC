'use server';
import {unstable_rethrow} from 'next/navigation';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {nurseChatEnabled} from './config';
import {runNurseMissingBp,type NurseCohortResult} from './cohort-read';
import {readHandoffFacts,type HandoffFactsRead} from './handoff-draft-read';
import {readNurseToday} from './today-actions';
import {z} from 'zod';
import {runNurseAdherence,type NurseAdherenceResult} from './adherence-read';

/** Questions about all of the nurse's own members. The database scopes the member list and every read to the nurse's
 * assignments; nothing here widens it. The wrapper logs call metadata only. */
export const readNurseMissingBp=loggedAction('readNurseMissingBp',async function readNurseMissingBp():Promise<NurseCohortResult>{
 if(process.env.NOREON_NURSE_CHAT_V2!=='true'||!nurseChatEnabled())return {kind:'unavailable'};
 try{
  const {client,identity}=await requireRealStaff();
  if(identity.role!=='nurse')return {kind:'unavailable'};
  return await runNurseMissingBp(client);
 }catch(error){unstable_rethrow(error);return {kind:'unavailable'};}
});

/** Record facts for a hand-over summary of one member, for the nurse who has them. The summary text is built on the screen from these. */
export const readNurseHandoffFacts=loggedAction('readNurseHandoffFacts',async function readNurseHandoffFacts(memberId:unknown):Promise<HandoffFactsRead|null>{
 if(process.env.NOREON_NURSE_CHAT_V2!=='true'||!nurseChatEnabled()||!z.uuid().safeParse(memberId).success)return null;
 try{
  const {client,identity}=await requireRealStaff();
  if(identity.role!=='nurse')return null;
  const today=await readNurseToday();
  return await readHandoffFacts(client,memberId as string,today.ok&&today.page?today.page.tasks:null);
 }catch(error){unstable_rethrow(error);return null;}
});

/** Medicine doses the nurse's own members reported in the last seven days, as counts with dates (no score). */
export const readNurseAdherence=loggedAction('readNurseAdherence',async function readNurseAdherence():Promise<NurseAdherenceResult>{
 if(process.env.NOREON_NURSE_CHAT_V2!=='true'||!nurseChatEnabled())return {kind:'unavailable'};
 try{
  const {client,identity}=await requireRealStaff();
  if(identity.role!=='nurse')return {kind:'unavailable'};
  return await runNurseAdherence(client);
 }catch(error){unstable_rethrow(error);return {kind:'unavailable'};}
});
