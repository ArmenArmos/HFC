'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {nurseChatEnabled} from './config';
import {nurseHandoffSchema,handoffResultSchema} from './handoffs';
import {readHandoffs} from './handoff-read';
import {readSentHandoffs} from './sent-handoffs-read';
import {z} from 'zod';
import {unstable_rethrow} from 'next/navigation';
import {log} from '@/lib/observability/logger';

export const escalateNurseMessage=loggedAction('escalateNurseMessage',async function escalateNurseMessage(input:unknown){
 if(!nurseChatEnabled())return {ok:false as const,code:'off' as const};
 const parsed=nurseHandoffSchema.safeParse(input);
 if(!parsed.success)return {ok:false as const,code:'invalid' as const};
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='nurse')return {ok:false as const,code:'denied' as const};
 const c=parsed.data;
 // Transport errors propagate: retain the exact request for retry after an unknown outcome.
 const r=await client.rpc('conversation_nurse_handoff',{p_member:c.memberId,p_request_id:c.requestId,p_expected_version:c.expectedVersion,p_message_id:c.messageId,p_topic:c.topic,p_observation:c.observation});
 if(r.error)throw Error('Nurse handoff result unavailable');
 return handoffResultSchema.parse(r.data);
});
export const readNurseHandoffs=loggedAction('readNurseHandoffs',async function readNurseHandoffs(memberId:string){
 if(!nurseChatEnabled()||!z.uuid().safeParse(memberId).success)return null;
 try{
  const {client,identity}=await requireRealStaff();
  if(identity.role!=='nurse')return null;
  return await readHandoffs(client,memberId);
 }catch(error){unstable_rethrow(error);log.warn('Nurse handoffs could not be read');return null;}
});

/** The nurse's handoffs across all assigned members, for "what did the doctor say". Only her own handoffs for currently assigned members, without task history. */
export const readNurseHandoffOverview=loggedAction('readNurseHandoffOverview',async function readNurseHandoffOverview(){
 if(!nurseChatEnabled())return null;
 try{
  const {client,identity}=await requireRealStaff();
  if(identity.role!=='nurse')return null;
  return await readSentHandoffs(client);
 }catch(error){unstable_rethrow(error);log.warn('Nurse handoff overview could not be read');return null;}
});
