'use server';
import {createHash} from 'node:crypto';
import {CONSULT,consultQuestionsText} from './consult-copy';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {loggedAction} from '@/lib/observability/with-logging';
import {openUrgentIfRed,sendZoeChatMessage} from '@/app/patient/zoe/chat-actions';
import {noActor,sessionActor} from './actor';
import {symptomGateInput} from './labs-contract';
import {runSymptomGate} from './consult';
import {readZoeCard,claimCard,recordCard} from './server';
import type {CardActionResult} from './registry';
export const answerSymptomGate=loggedAction('answerSymptomGate',async function answerSymptomGate(raw:unknown):Promise<CardActionResult>{
 if(!zoeAppV3Enabled())return {status:'disabled'};
 const v=symptomGateInput.safeParse(raw);if(!v.success)return {status:'invalid'};
 await screenBeforeCard(v.data.cardId,(v.data.choice==='acute'?CONSULT.acuteMessage:CONSULT.plannedMessage)[v.data.locale]);
 const who=await sessionActor();if(!who)return noActor();
 return runSymptomGate(who,{readCard:readZoeCard,claim:claimCard,record:recordCard,send:(id,text)=>sendZoeChatMessage(id,text,true)},v.data);
});

import {createClient} from '@/lib/supabase/server';
import type {MedicinesRpc} from '@/lib/member-medicines/server';
import {consultQuestionsInput} from './labs-contract';
import {runConsultQuestions} from './consult';
export const sendConsultQuestions=loggedAction('sendConsultQuestions',async function sendConsultQuestions(raw:unknown):Promise<CardActionResult>{
 if(!zoeAppV3Enabled())return {status:'disabled'};
 const v=consultQuestionsInput.safeParse(raw);if(!v.success)return {status:'invalid'};
 await screenBeforeCard(v.data.cardId,consultQuestionsText(v.data.locale,v.data.groups));
 const who=await sessionActor();if(!who)return noActor();
 const rpc=await createClient()as unknown as MedicinesRpc;
 return runConsultQuestions(who,{readCard:readZoeCard,claim:claimCard,record:recordCard,
  send:(id,text)=>sendZoeChatMessage(id,text,true),
  save:async(requestId,appointmentId,groups)=>{const r=await rpc.rpc('zoe_v3_consult_questions_save',{p_request:requestId,p_appointment:appointmentId,p_groups:groups});return !r.error&&r.data===true;},
  markSent:async requestId=>{const r=await rpc.rpc('zoe_v3_consult_questions_sent',{p_request:requestId});return !r.error&&r.data===true;},
 },v.data);
});

/** The ordinary urgent redirect runs before session, claims or persistence can refuse the card.
 * A deterministic text id lets urgent retries replay even when the card was never reached. */
async function screenBeforeCard(cardId:string,text:string){
 const requestId=createHash('sha256').update(`consult:${cardId}:${text}`).digest('hex').replace(/^(.{8})(.{4}).(.{3}).(.{3})(.{12}).*$/,'$1-$2-5$3-8$4-$5');
 await openUrgentIfRed(requestId,text,true);
}
