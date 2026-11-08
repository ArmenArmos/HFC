import 'server-only';
import type {MemberActor} from './actor';
import {claim,ownCard,type CardPorts} from './commands';
import type {ZoeCard,CardActionResult} from './registry';
import {requestVisitInput,visitRequestPayload,visitRequestMessage,type RequestVisitInput} from './visit-request-contract';
import type {CardLocale} from './copy';

export type VisitRequestStep='read'|'claim'|'task'|'message'|'record';
export type VisitRequestPorts=Pick<CardPorts,'readCard'|'claim'|'record'>&{
 current():Promise<{token:string;available:boolean;days:string[]|null;locale?:CardLocale}>;
 raise(sourceRef:string):Promise<boolean>;
 send(requestId:string,text:string):Promise<{status:string}>;
 trace(step:VisitRequestStep):Promise<void>;
};
/** The first claim is the durable request. Every effect replays its stable identity, including after a lost reply.
 * Keep unfinished requests open; never discard a claim or close the card on a partial failure. */
export async function runVisitRequest(actor:MemberActor,ports:VisitRequestPorts,raw:RequestVisitInput):Promise<CardActionResult>{
 if(actor.channel!=='app')return {status:'disabled'};
 const input=requestVisitInput.safeParse(raw);if(!input.success)return {status:'invalid'};
 const v=input.data;
 let step:VisitRequestStep='read';
 let latest:ZoeCard|undefined;
 try{
  const card=await ownCard(ports,v.cardId,'visit');if(!card)return {status:'invalid'};
  latest=card;
  const saved=card.outcome.booking as {kind?:string}|undefined;
  if(card.state==='done'||saved)return saved?.kind==='visit_request'?{status:'ok',card}:{status:'closed',card};
  // Only the first attempt consults current availability. Once accepted, finish the preserved request even after
  // a midnight rollover or configuration change, rather than losing it behind a new availability gate.
  const prior=visitRequestPayload.safeParse(card.claims.booking?.payload);
  let locale:CardLocale=prior.success?prior.data.locale:'en';
  if(!card.claims.booking){
   const current=await ports.current();
   if(!current.available||current.token!==card.snapshot.bookingToken)return {status:'stale',card};
   if(current.days===null){await ports.trace(step);return {status:'unavailable',card:latest};}
   if(!current.days.includes(v.day))return {status:'invalid',card};
   locale=current.locale??'en';
  }
  const payload={kind:'visit_request' as const,day:v.day,window:v.window,note:v.note,locale};
  step='claim';
  const c=await claim(actor,ports,card,'booking',v.opId,payload);
  if(!c.ok){await ports.trace(step);return c.result;}
  const pinned=visitRequestPayload.safeParse(c.claim.payload);
  if(!pinned.success||pinned.data.day!==v.day||pinned.data.window!==v.window||pinned.data.note!==v.note)return {status:'stale',card};
  latest={...card,claims:{...card.claims,booking:c.claim}};
  step='task';
  if(!await ports.raise(`visit-request:${card.id}`)){await ports.trace(step);return {status:'unavailable',card:latest};}
  step='message';
  const sent=await ports.send(c.claim.op,visitRequestMessage(pinned.data,pinned.data.locale));
  if(sent.status!=='sent'&&sent.status!=='urgent'){await ports.trace(step);return {status:'unavailable',card:latest};}
  step='record';
  const r=await ports.record(actor.memberId,card.id,'booking',{...pinned.data,requestId:c.claim.op,ok:true,dialog:true},true);
  if(!r.ok){await ports.trace(step);return {status:'unavailable',card:latest};}
  return {status:'ok',card:r.card};
 }catch(error){
  if(String((error as {digest?:unknown})?.digest??'').startsWith('NEXT_REDIRECT'))throw error;
  await ports.trace(step);
  return {status:'unavailable',...(latest?{card:latest}:{})};
 }
}
