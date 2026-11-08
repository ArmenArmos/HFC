'use server';
import {z} from 'zod';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {loggedAction} from '@/lib/observability/with-logging';
import {noActor,sessionActor} from './actor';
import {parseStoredCard,serviceRpc} from './server';
import type {CardActionResult} from './registry';

const input=z.strictObject({cardId:z.uuid(),opId:z.uuid()});
/** Only confirmation metadata is written. The database atomically checks the current publication and saves the turn. */
export const confirmPlanFromCard=loggedAction('confirmPlanFromCard',async function confirmPlanFromCard(raw:unknown):Promise<CardActionResult>{
 if(!zoeAppV3Enabled()||process.env.NOREON_MEMBER_CHAT_V2!=='true')return {status:'disabled'};
 const parsed=input.safeParse(raw);
 if(!parsed.success)return {status:'invalid'};
 const who=await sessionActor();
 if(!who)return noActor();
 const rpc=serviceRpc();
 if(!rpc)return {status:'unavailable'};
 try{
  const result=await rpc('zoe_v3_plan_confirm',{p_member:who.memberId,p_card:parsed.data.cardId,p_op:parsed.data.opId}) as {ok?:boolean;code?:string;card?:unknown}|null;
  const card=parseStoredCard(result?.card);
  if(result?.ok&&card)return {status:'ok',card};
  const code=result?.code;
  return {status:code==='stale'||code==='closed'||code==='disabled'||code==='invalid'?code:'unavailable'};
 }catch{return {status:'unavailable'};}
});
