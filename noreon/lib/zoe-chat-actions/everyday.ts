import 'server-only';
import type {MemberActor} from './actor';
import {bookingToken} from './booking';
import {claim, type CardPorts} from './commands';
import type {CardActionResult, ZoeCard} from './registry';
import type {EverydayView} from './everyday-contract';

export type EverydayWrite = {cardId:string;opId:string;view:EverydayView|'plan_ack';input:unknown};
export type EverydayFeatureResult = {status:'saved'|'access'|'unavailable'|'refused'}|{status:'invalid';fields:string[]};
export type EverydayWriteResult = CardActionResult & {result?:EverydayFeatureResult};
export type EverydayWritePorts = Pick<CardPorts,'readCard'|'claim'|'record'> & {
  currentToken():Promise<string>;
  execute(input:unknown):Promise<EverydayFeatureResult>;
};
export function everydayToken(card:ZoeCard, view:EverydayWrite['view']):string|null {
  if(!card.valid)return null;
  if(view==='plan_ack')return card.kind==='plan'&&card.snapshot.plan?card.snapshot.plan.id:null;
  return card.kind==='menu'&&card.snapshot.view===view?card.snapshot.token??null:null;
}

/** One attempt per card, including across tabs. Earlier-value inserts have no feature request id.
 * The atomic record elects the only executor BEFORE the feature is called. A lost receipt is
 * explicitly unconfirmed and cannot repeat the write; current details remain the recovery path.
 * Claims/outcomes contain hashes and statuses, never answers, readings or lesson text.
 */
export async function runEverydayWrite(actor:MemberActor, ports:EverydayWritePorts, value:EverydayWrite):Promise<EverydayWriteResult> {
  if(actor.channel!=='app')return {status:'disabled'};
  const card=await ports.readCard(value.cardId);
  const token=card&&everydayToken(card,value.view);
  if(!card||!token)return {status:'invalid'};
  const payload={view:value.view,digest:bookingToken(value.input)};
  const matches=card.claims.everyday&&bookingToken(card.claims.everyday.payload)===bookingToken(payload);
  const receipt=card.outcome['everyday:result'] as EverydayFeatureResult|undefined;
  if(receipt)return matches?{status:'ok',card,result:receipt}:{status:'closed',card};
  if(card.state==='done')return {status:'closed',card};
  if(card.outcome.everyday)return {status:'unavailable',card};
  if(token!==await ports.currentToken())return {status:'stale',card};
  const attempt=await claim(actor,ports,card,'everyday',value.opId,payload);
  if(!attempt.ok)return attempt.result;
  if(bookingToken(attempt.claim.payload)!==bookingToken(payload))return {status:'stale',card};
  const resultClaim=await claim(actor,ports,card,'everyday:result',attempt.claim.op,{});
  if(!resultClaim.ok)return resultClaim.result;
  const started=await ports.record(actor.memberId,card.id,'everyday',{attempted:true},false);
  if(!started.ok)return {status:'unavailable',card};
  if(started.replayed)return {status:'unavailable',card:started.card};
  let result:EverydayFeatureResult;
  try{result=await ports.execute(value.input);}
  catch(error){
    if(String((error as {digest?:unknown})?.digest??'').startsWith('NEXT_REDIRECT'))throw error;
    result={status:'unavailable'};
  }
  const saved=await ports.record(actor.memberId,card.id,'everyday:result',result,true);
  return saved.ok?{status:'ok',card:saved.card,result}:{status:'unavailable',card:started.card};
}
