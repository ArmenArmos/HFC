'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {log} from '@/lib/observability/logger';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {newChatHome} from '@/lib/patient/member-chat-config';
import {sendZoeChatMessage} from '@/app/patient/zoe/chat-actions';
import {recordZoeDecision} from '@/lib/zoe/trace';
import {sessionActor,noActor} from './actor';
import {claimCard,readZoeCard,recordCard,serviceRpc} from './server';
import {readVisitBooking} from './booking-read';
import {requestVisitInput,visitRequestAvailable} from './visit-request-contract';
import {runVisitRequest} from './visit-request';
import {raiseVisitRequestTask} from './raise-admin-task';
import type {CardActionResult} from './registry';

export const requestVisitFromCard=loggedAction('requestVisitFromCard',async function requestVisitFromCard(raw:unknown):Promise<CardActionResult>{
 if(!zoeAppV3Enabled()||!newChatHome({}))return {status:'disabled'};
 const v=requestVisitInput.safeParse(raw);if(!v.success)return {status:'invalid'};
 const who=await sessionActor();if(!who)return noActor();
 const rpc=serviceRpc();
 return runVisitRequest(who,{
  readCard:readZoeCard,claim:claimCard,record:recordCard,
  current:async()=>{const read=await readVisitBooking();return {token:read.token,available:visitRequestAvailable(read),days:read.requestDays??null,locale:read.requestLocale};},
  raise:sourceRef=>raiseVisitRequestTask(rpc,who.memberId,sourceRef),
  send:(id,text)=>sendZoeChatMessage(id,text,true),
  trace:async step=>{
   const fields={member_id:who.memberId,card_id:v.data.cardId,operation_id:v.data.opId,step};
   // Fixed codes and internal ids only. Never log input, provider errors, dates or note text.
   log.warn('Visit request step unavailable',fields);
   if(rpc)await recordZoeDecision(async args=>({data:await rpc('zoe_chat_action_trace',args),error:null}),who.memberId,{
    name:'zoe.visit_request',outcome:'block',reason:`${step}_unavailable`,rule:'zoe.visit_request',ruleVersion:'visit-request-2026-11-04',
    attributes:{'noreon.card_id':v.data.cardId,'noreon.operation_id':v.data.opId,step},
   });
  },
 },v.data);
});
