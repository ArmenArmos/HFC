'use server';
import {unstable_rethrow} from 'next/navigation';
import {loggedAction} from '@/lib/observability/with-logging';
import {assignedNurseConversation} from '@/lib/conversation-persistence/server';
import {nurseChatEnabled} from './config';
import type {NurseWorkspace,NurseSendResult} from './contracts';

export const readNurseConversation=loggedAction('readNurseConversation',async function readNurseConversation(memberId:string):Promise<NurseWorkspace>{
 if(!nurseChatEnabled())return {ok:false,code:'off'};
 try{
  const repo=await assignedNurseConversation();
  if(!repo)return {ok:false,code:'denied'};
  return await repo.read(memberId);
 }catch(error){unstable_rethrow(error);return {ok:false,code:'unavailable'};}
});

export const sendNurseReply=loggedAction('sendNurseReply',async function sendNurseReply(input:unknown):Promise<NurseSendResult>{
 if(!nurseChatEnabled())return {ok:false,code:'off'};
 const repo=await assignedNurseConversation();
 if(!repo)return {ok:false,code:'denied'};
 // A transport failure may follow a committed write. The UI retains the exact
 // request id/body and can retry only that request until it gets a result.
 return repo.send(input);
});
