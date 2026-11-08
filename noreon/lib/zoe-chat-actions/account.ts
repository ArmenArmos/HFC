import 'server-only';
import type {SaveResult} from '@/lib/patient/types';
import type {MemberActor} from './actor';
import {claim,ownCard,type CardPorts} from './commands';
import {bookingToken} from './booking';
import type {CardActionResult} from './registry';
export type AccountKind='profile'|'language'|'reminders';
export type AccountSave={cardId:string;opId:string;kind:AccountKind;input:unknown;expectedRevision:number;consent?:boolean};
export type AccountCardResult=CardActionResult&{result?:SaveResult};
type Ports=Pick<CardPorts,'readCard'|'claim'|'record'>&{currentToken():Promise<string>;execute(input:AccountSave):Promise<SaveResult>};
/** Pin one settings choice. Existing feature CAS guards retries, including a response lost after its write. */
export async function runAccountSave(actor:MemberActor,ports:Ports,value:AccountSave):Promise<AccountCardResult>{
 if(actor.channel!=='app')return {status:'disabled'};
 const card=await ownCard(ports,value.cardId,'account');
 if(!card)return {status:'invalid'};
 if(card.state==='done'||card.outcome.account)return {status:'closed',card};
 if(card.snapshot.token!==await ports.currentToken())return {status:'stale',card};
 // Neither profile details nor reminder times are copied into the durable claim.
 const payload={kind:value.kind,digest:bookingToken({kind:value.kind,input:value.input,expectedRevision:value.expectedRevision,consent:value.consent})};
 const claimed=await claim(actor,ports,card,'account',value.opId,payload);
 if(!claimed.ok)return claimed.result;
 if(bookingToken(claimed.claim.payload)!==bookingToken(payload))return {status:'stale',card};
 let result:SaveResult;
 try{result=await ports.execute(value);}
 catch(error){
  if(String((error as {digest?:unknown})?.digest??'').startsWith('NEXT_REDIRECT'))throw error;
  result={ok:false,reason:'unavailable'};
 }
 const outcome={kind:value.kind,ok:result.ok,...(!result.ok?{reason:result.reason}:{})};
 const saved=await ports.record(actor.memberId,card.id,'account',outcome,true);
 return saved.ok?{status:'ok',card:saved.card,result}:{status:'unavailable',card,result};
}
