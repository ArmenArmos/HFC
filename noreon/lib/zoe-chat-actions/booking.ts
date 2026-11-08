import 'server-only';
import {createHash} from 'node:crypto';
import type {MemberActor} from './actor';
import {claim,ownCard,type CardPorts} from './commands';
import type {CardActionResult} from './registry';
import type {PilotActionState} from '@/lib/real-booking/appointment-schema';

export type BookingKind='select'|'change'|'cancel'|'proposal'|'legacy';
export type BookingExecution=PilotActionState&{providerPending?:boolean};
export type BookingCardResult=CardActionResult&{result?:BookingExecution};
type Ports=Pick<CardPorts,'readCard'|'claim'|'record'>&{
 currentToken():Promise<string>;
 execute(kind:BookingKind,form:FormData):Promise<BookingExecution>;
};
// Canonical keys: PostgREST object order is not part of a booking's identity.
export function bookingToken(value:unknown):string{
 const stable=(v:unknown):unknown=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,stable(x)])):v;
 return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

/** One immutable booking choice per card. Feature actions retain their own auth, revision and capacity guards. */
export async function runVisitBooking(actor:MemberActor,ports:Ports,v:{cardId:string;opId:string;kind:BookingKind;fields:Record<string,string>;dialog?:boolean}):Promise<BookingCardResult>{
 if(actor.channel!=='app')return {status:'disabled'};
 const card=await ownCard(ports,v.cardId,'visit');
 if(!card)return {status:'invalid'};
 if(card.state==='done'||card.outcome.booking)return {status:'closed',card};
 if(!card.snapshot.bookingToken||card.snapshot.bookingToken!==await ports.currentToken())return {status:'stale',card};
 const payload={kind:v.kind,fields:v.fields};
 const c=await claim(actor,ports,card,'booking',v.opId,payload);
 if(!c.ok)return c.result;
 if(bookingToken(c.claim.payload)!==bookingToken(payload))return {status:'stale',card};
 const form=new FormData();
 for(const [key,value]of Object.entries(v.fields))form.set(key,value);
 form.set('commandId',c.claim.op);
 if(v.kind==='legacy'&&form.get('operation')==='create')form.set('requestId',c.claim.op);
 let result:BookingExecution;
 try{result=await ports.execute(v.kind,form);}
 catch(error){
  if(String((error as {digest?:unknown})?.digest??'').startsWith('NEXT_REDIRECT'))throw error;
  result={ok:false,code:'unknown',outcomeUnknown:true};
 }
 // Close even a refused or unknown attempt. Only current details may start a new choice.
 // Store status only: the member's address and free text never enter outcomes or logs.
 const saved=await ports.record(actor.memberId,card.id,'booking',{kind:v.kind,...result,...(v.dialog?{dialog:true}:{})},true);
 return saved.ok?{status:'ok',card:saved.card,result}:{status:'unavailable',card,result};
}
