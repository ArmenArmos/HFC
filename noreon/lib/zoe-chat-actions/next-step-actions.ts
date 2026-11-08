'use server';
import {z} from 'zod';
import {log} from '@/lib/observability/logger';
import {loggedAction} from '@/lib/observability/with-logging';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {sessionActor,noActor} from './actor';
import {buildSnapshot,readZoeCard,readZoeCards,parseStoredCard,serviceRpc} from './server';
import {readChatNextStep,readTestsNeeded,queueMissingTests} from './next-step-read';
import {stableRequestId,stepRequestId} from './next-step-id';
import type {CardActionResult} from './registry';

/** No target, stage, member id, tests or clinical payload is accepted from the browser. */
export const followNextStep=loggedAction('followNextStep',async function followNextStep(raw:unknown):Promise<CardActionResult>{
 if(!zoeAppV3Enabled()||process.env.NOREON_MEMBER_CHAT_V2!=='true')return {status:'disabled'};
 const input=z.strictObject({cardId:z.uuid()}).safeParse(raw);if(!input.success)return {status:'invalid'};
 const who=await sessionActor();if(!who)return noActor();
 const card=await readZoeCard(input.data.cardId);
 if(!card?.valid||(card.kind!=='next_step'&&card.kind!=='tests_needed'))return {status:'invalid'};
 const originalTarget=card.kind==='next_step'?card.snapshot.target:'visit';
 if(!originalTarget)return {status:'invalid',card};
 const receipt=card.outcome[card.kind] as {target?:typeof originalTarget;requestId?:string}|undefined;
 // Existing receipts keep their target; new lab CTAs use the menu's lab-order card.
 const target=receipt?.target??(originalTarget==='tests_needed'?'visit':originalTarget);
 const request=receipt?.requestId??stableRequestId(`zoe-next-open:${card.id}:${originalTarget}`);
 const rpc=serviceRpc();if(!rpc)return {status:'unavailable',card};
 try{
  // A completed press replays the same stored target even after the journey moves on.
  let snapshot:unknown={};
  if(!card.outcome[card.kind]){
   if(card.state==='done')return {status:'closed',card};
   const cards=await readZoeCards();
   if(!cards.enabled)return {status:'disabled',card};
   if(cards.nextStepStatus==='unavailable')return {status:'unavailable',card};
   const current=await readChatNextStep(cards);
   if(!current||current.memberId!==who.memberId)return {status:'stale',card};
   if(card.kind==='next_step'&&stepRequestId(who.memberId,current.step)!==card.requestId)return {status:'stale',card};
   if(card.kind==='tests_needed'){
    const parent=cards.cards.find(c=>c.kind==='next_step'&&c.requestId===stepRequestId(who.memberId,current.step));
    const opened=parent?.outcome.next_step as {requestId?:string}|undefined;
    if(opened?.requestId!==card.requestId||(current.step.target!=='tests_needed'&&current.step.target!=='visit'))return {status:'stale',card};
   }
   snapshot=await buildSnapshot(target);
  }
  const r=await rpc('zoe_v3_next_step_follow_living',{p_member:who.memberId,p_card:card.id,p_request:request,p_target:target,p_snapshot:snapshot}) as {ok?:boolean;code?:string;card?:unknown;next?:unknown};
  const saved=parseStoredCard(r?.card),next=parseStoredCard(r?.next);
  if(r?.ok&&saved?.valid&&next?.valid){
   // Logistics must never block opening the card. The stable source ref deduplicates overlapping presses.
   if(!receipt&&originalTarget==='tests_needed'){
    let queued=false;
    try{queued=await queueMissingTests(who.memberId,request,await readTestsNeeded());}catch{}
    if(!queued)log.warn('zoe.next_step_admin_task_unavailable',{member_id:who.memberId,request_id:request});
   }
   return {status:'ok',card:saved,next};
  }
  return {status:r?.code==='stale'?'stale':r?.code==='closed'?'closed':'unavailable',card};
 }catch{return {status:'unavailable',card};}
});

import {claimCard,recordCard} from './server';
import {enrollRealMember} from '@/lib/patient-care/clinical-actions';
/** Existing review enrolment, with the same durable card receipt as the other chat forms. */
export const requestReviewFromCard=loggedAction('requestReviewFromCard',async function requestReviewFromCard(raw:unknown):Promise<CardActionResult>{
 if(!zoeAppV3Enabled()||process.env.NOREON_MEMBER_CHAT_V2!=='true')return {status:'disabled'};
 const input=z.strictObject({cardId:z.uuid()}).safeParse(raw);if(!input.success)return {status:'invalid'};
 const who=await sessionActor();if(!who)return noActor();
 const card=await readZoeCard(input.data.cardId);if(!card?.valid||card.kind!=='review')return {status:'invalid'};
 if(card.outcome.review)return {status:'ok',card};
 try{
 const cards=await readZoeCards();
 if(!cards.enabled)return {status:'disabled',card};
 if(cards.nextStepStatus==='unavailable')return {status:'unavailable',card};
 const current=await readChatNextStep(cards);
 if(!current||current.memberId!==who.memberId||current.step.target!=='review')return {status:'stale',card};
 const claim=await claimCard(who.memberId,card.id,'review',stableRequestId(`zoe-review:${card.id}`),{});
 if(!claim.ok)return {status:'unavailable',card};
  const result=await enrollRealMember();if(!result.ok)return {status:'unavailable',card};
  const r=await recordCard(who.memberId,card.id,'review',{saved:true},true);
  return r.ok?{status:'ok',card:r.card}:{status:'unavailable',card};
 }catch{return {status:'unavailable',card};}
});
