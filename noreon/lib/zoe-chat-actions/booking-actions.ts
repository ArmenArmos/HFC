'use server';
import {z} from 'zod';
import {loggedAction} from '@/lib/observability/with-logging';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {memberChatOnlyEnabled} from '@/lib/patient/member-chat-config';
import {selectMemberAppointment,changeMemberAppointment,cancelMemberAppointment,answerMemberProposal} from '@/lib/real-booking/appointment-actions';
import {memberBookingCommand} from '@/lib/real-booking/actions';
import {sessionActor,noActor} from './actor';
import {readZoeCard,claimCard,recordCard} from './server';
import {readVisitBooking,type VisitBooking} from './booking-read';
import {runVisitBooking,type BookingCardResult} from './booking';
import type {CardActionResult} from './registry';
import {visitRequestPayload} from './visit-request-contract';

export const readVisitBookingFromCard=loggedAction('readVisitBookingFromCard',async function readVisitBookingFromCard(cardId:unknown):Promise<{status:'ok';data:VisitBooking}|{status:Exclude<CardActionResult['status'],'ok'>}>{
 if(!memberChatOnlyEnabled()&&!zoeAppV3Enabled())return {status:'disabled'};
 if(!z.uuid().safeParse(cardId).success)return {status:'invalid'};
 if(!await sessionActor())return noActor();
 const card=await readZoeCard(cardId as string);
 if(!card?.valid||card.kind!=='visit')return {status:'invalid'};
 if(card.state==='done')return {status:'closed'};
 const data=await readVisitBooking();
 if(!(data.requestEnabled&&visitRequestPayload.safeParse(card.claims.booking?.payload).success)
  &&(!card.snapshot.bookingToken||card.snapshot.bookingToken!==data.token))return {status:'stale'};
 return {status:'ok',data};
});

const input=z.strictObject({cardId:z.uuid(),opId:z.uuid(),kind:z.enum(['select','change','cancel','proposal','legacy']),fields:z.record(z.string().max(100),z.string().max(10000)).refine(v=>Object.keys(v).length<=20)});
/** Authenticated app adapter. Durable claims pin the exact choice before the page's action runs. */
export const bookVisitFromCard=loggedAction('bookVisitFromCard',async function bookVisitFromCard(raw:unknown):Promise<BookingCardResult>{
 if(!memberChatOnlyEnabled()&&!zoeAppV3Enabled())return {status:'disabled'};
 const parsed=input.safeParse(raw);
 if(!parsed.success)return {status:'invalid'};
 const who=await sessionActor();
 if(!who)return noActor();
 return runVisitBooking(who,{
  readCard:readZoeCard,claim:claimCard,record:recordCard,currentToken:async()=>(await readVisitBooking()).token,
  execute:async(kind,form)=>{
   if(kind==='legacy'){
    const r=await memberBookingCommand({ok:false,message:''},form);
    // Never copy the legacy action's free-text error into a card outcome.
    return {ok:r.ok,providerPending:r.providerPending===true,code:r.ok?'saved':r.code==='conflict'?'conflict':r.code==='invalid'||r.code==='past-time'?'invalid':'unavailable'};
   }
   const action={select:selectMemberAppointment,change:changeMemberAppointment,cancel:cancelMemberAppointment,proposal:answerMemberProposal}[kind];
   return action({ok:false},form);
  },
 },{...parsed.data,dialog:zoeAppV3Enabled()});
});
