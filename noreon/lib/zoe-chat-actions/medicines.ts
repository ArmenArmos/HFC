import 'server-only';
import {z} from 'zod';
import type {MemberActor} from './actor';
import {claim,ownCard,type CardPorts} from './commands';
import {bookingToken} from './booking';
import type {CardActionResult} from './registry';
import {ASK_REASONS} from '@/lib/member-medicines/ask-copy';
const times=z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(6).refine(v=>new Set(v).size===v.length);
export const medicineCommandSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('add'),name:z.string().trim().min(1).max(120),dose:z.string().trim().max(120),times}),
 z.strictObject({kind:z.literal('times'),id:z.uuid(),times}),
 z.strictObject({kind:z.literal('edit'),id:z.uuid(),dose:z.string().trim().max(120),times}),
 z.strictObject({kind:z.literal('stop'),id:z.uuid()}),
 z.strictObject({kind:z.literal('reason'),askId:z.uuid(),reason:z.enum(ASK_REASONS)}),
 z.strictObject({kind:z.literal('keep'),askId:z.uuid()}),
 z.strictObject({kind:z.literal('refill'),askId:z.uuid()}),
]);
export type MedicineCommand=z.infer<typeof medicineCommandSchema>;
export type MedicineExecution={status:string;next?:string};
export type MedicinesCardResult=CardActionResult&{result?:MedicineExecution};
type Current={token:string;enabled:boolean;own:{id:string;dose:string|null}[];asks:{id:string;medicineId:string;source:string;state:string;reason:string|null;careTeamAsked:boolean}[]};
type Ports=Pick<CardPorts,'readCard'|'claim'|'record'>&{current():Promise<Current>;execute(command:MedicineCommand&{requestId?:string;dose?:string;expectedDose?:string|null}):Promise<MedicineExecution>};
/** One bounded attempt. The feature actions and database retain authentication, ownership and feature gates. */
export async function runMedicines(actor:MemberActor,ports:Ports,v:{cardId:string;opId:string;command:MedicineCommand}):Promise<MedicinesCardResult>{
 if(actor.channel!=='app')return {status:'disabled'};
 const parsed=medicineCommandSchema.safeParse(v.command);
 if(!parsed.success)return {status:'invalid'};
 const card=await ownCard(ports,v.cardId,'medicines');
 if(!card)return {status:'invalid'};
 if(card.state==='done'||card.outcome.medicines)return {status:'closed',card};
 const live=await ports.current();
 if(!live.enabled)return {status:'disabled',card};
 if(card.snapshot.token!==live.token)return {status:'stale',card};
 const command=parsed.data;
 const own='id'in command?live.own.find(m=>m.id===command.id):null;
 if('id'in command&&!own)return {status:'invalid',card};
 if('askId'in command){
  const ask=live.asks.find(a=>a.id===command.askId&&a.source==='self');
  if(!ask||!live.own.some(m=>m.id===ask.medicineId))return {status:'invalid',card};
  if(command.kind==='refill'?(ask.state!=='answered'||!['ran_out','cost_or_availability'].includes(ask.reason??'')||ask.careTeamAsked):ask.state!=='open')return {status:'stale',card};
 }
 const c=await claim(actor,ports,card,'medicines',v.opId,{command});
 if(!c.ok)return c.result;
 if(bookingToken(c.claim.payload)!==bookingToken({command}))return {status:'stale',card};
 let result:MedicineExecution;
 try{result=await ports.execute({...command,...(command.kind==='add'?{requestId:c.claim.op}:{}),...(command.kind==='times'?{dose:own?.dose??'',expectedDose:own?.dose??null}:{})});}
 catch{result={status:'unknown'};}
 // Only bounded statuses enter outcomes. No names, doses or provider error text.
 const known=['added','saved','stopped','answered','sent','already','closed','not-found','invalid','limit','disabled','unavailable','signed_out','conflict'];
 result={status:known.includes(result.status)?result.status:'unknown',...(['refill','doctor','reminders'].includes(result.next??'')?{next:result.next}:{})};
 const saved=await ports.record(actor.memberId,card.id,'medicines',{kind:command.kind,...result},true);
 return saved.ok?{status:'ok',card:saved.card,result}:{status:'unavailable',card,result};
}
