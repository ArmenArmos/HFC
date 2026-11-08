'use server';
import {z} from 'zod';
import {loggedAction} from '@/lib/observability/with-logging';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {noActor,sessionActor} from './actor';
import {parseStoredCard,serviceRpc} from './server';
import type {CardActionResult} from './registry';
import {DOSE_REASONS,SAMS_QUESTIONS} from './dose-flow';
import {answerSams} from './dose-flow-server';
import {claimCard,postCard,readZoeCard,readZoeCards,recordCard} from './server';
import {sendZoeChatMessage} from '@/app/patient/zoe/chat-actions';
import {runV3Adherence} from './plan-jobs';

const input=z.strictObject({cardId:z.uuid(),opId:z.uuid(),medicineId:z.uuid(),dueAt:z.iso.datetime({offset:true}),status:z.enum(['taken','skipped'])});
/** The service RPC commits only an event and the receipt; it never edits a plan. */
export const logV3DoseFromCard=loggedAction('logV3DoseFromCard',async function logV3DoseFromCard(raw:unknown):Promise<CardActionResult>{
 if(!zoeAppV3Enabled()||process.env.NOREON_MEMBER_CHAT_V2!=='true')return {status:'disabled'};
 const parsed=input.safeParse(raw);if(!parsed.success)return {status:'invalid'};
 const who=await sessionActor();if(!who)return noActor();
 const rpc=serviceRpc();if(!rpc)return {status:'unavailable'};
 try{
  const v=parsed.data;
  const r=await rpc('zoe_v3_dose_record',{p_member:who.memberId,p_card:v.cardId,p_op:v.opId,p_medicine:v.medicineId,p_due:v.dueAt,p_status:v.status}) as {ok?:boolean;code?:string;card?:unknown;next?:unknown}|null;
  const card=parseStoredCard(r?.card),next=parseStoredCard(r?.next);
  if(r?.ok&&card){
   // The dose receipt stands if a queue is temporarily unavailable. The scheduled job retries the same episode.
   if(v.status==='skipped')await runV3Adherence(rpc,who.memberId).catch(()=>null);
   return {status:'ok',card,...(next?{next}:{})};
  }
  return {status:r?.code==='stale'||r?.code==='disabled'||r?.code==='invalid'||r?.code==='closed'?r.code:'unavailable'};
 }catch{return {status:'unavailable'};}
});

const reasonInput=z.strictObject({cardId:z.uuid(),opId:z.uuid(),reason:z.enum(DOSE_REASONS),later:z.boolean().default(false)});
export const answerV3DoseReason=loggedAction('answerV3DoseReason',async function answerV3DoseReason(raw:unknown):Promise<CardActionResult>{
 if(!zoeAppV3Enabled()||process.env.NOREON_MEMBER_CHAT_V2!=='true')return {status:'disabled'};
 const parsed=reasonInput.safeParse(raw);if(!parsed.success)return {status:'invalid'};
 const who=await sessionActor();if(!who)return noActor();
 const rpc=serviceRpc();if(!rpc)return {status:'unavailable'};
 try{
  const v=parsed.data,r=await rpc('zoe_v3_dose_reason',{p_member:who.memberId,p_card:v.cardId,p_op:v.opId,p_reason:v.reason,p_later:v.later})as{ok?:boolean;code?:string;card?:unknown;next?:unknown}|null;
  const card=parseStoredCard(r?.card),next=parseStoredCard(r?.next);
  return r?.ok&&card?{status:'ok',card,...(next?{next}:{})}:{status:r?.code==='stale'||r?.code==='disabled'||r?.code==='invalid'||r?.code==='closed'?r.code:'unavailable'};
 }catch{return {status:'unavailable'};}
});
const samsInput=z.strictObject({cardId:z.uuid(),opId:z.uuid(),question:z.enum(SAMS_QUESTIONS),answer:z.boolean(),locale:z.enum(['hy','en','ru'])});
export const answerSamsFromCard=loggedAction('answerSamsFromCard',async function answerSamsFromCard(raw:unknown):Promise<CardActionResult>{
 if(!zoeAppV3Enabled()||process.env.NOREON_MEMBER_CHAT_V2!=='true')return {status:'disabled'};
 const parsed=samsInput.safeParse(raw);if(!parsed.success)return {status:'invalid'};
 const who=await sessionActor();if(!who)return noActor();
 try{return await answerSams(who,{rpc:serviceRpc(),post:postCard,readCards:readZoeCards,readCard:readZoeCard,claim:claimCard,record:recordCard,send:async(id,text)=>{
  return sendZoeChatMessage(id,text,false,true);
 }},parsed.data);}catch{return {status:'unavailable'};}
});
