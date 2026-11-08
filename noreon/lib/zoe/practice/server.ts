import 'server-only';
import {z} from 'zod';
import {requirePracticeAccess} from './access';
import {startPractice,runPracticeTurn,editPracticeRecord,practiceEditSchema,MAX_PRACTICE_TURNS,type PracticeState} from './engine';
import {practiceServiceRpc,mutatePractice,practiceDailyLimits,type PracticeResult} from './store';
import {practiceProviders} from './provider';
import {ZOE_CONFIG_VERSION} from '../pipeline';
const reference=z.strictObject({sessionId:z.uuid(),expectedVersion:z.number().int().nonnegative()});
export async function startSession(input:unknown):Promise<PracticeResult>{
 const {identity}=await requirePracticeAccess();
 try{const {patientId}=z.strictObject({patientId:z.string()}).parse(input);const state=startPractice(patientId);const rpc=practiceServiceRpc();if(!rpc)return {ok:false,code:'unavailable'};return await mutatePractice(rpc,identity.id,'create',{patientId,state});}catch{return {ok:false,code:'unavailable'};}
}
async function sessionFor(client:Awaited<ReturnType<typeof requirePracticeAccess>>['client'],sessionId:string){
 const {data,error}=await client.from('zoe_practice_sessions').select('state').eq('id',sessionId).single();
 if(error||!data)throw Error('Practice session unavailable');
 return data.state as unknown as PracticeState;
}
export async function sendMessage(input:unknown):Promise<PracticeResult>{
 const {identity}=await requirePracticeAccess();
 let held:{sessionId:string;expectedVersion:number;token:string}|null=null;
 const rpc=practiceServiceRpc();if(!rpc)return {ok:false,code:'unavailable'};
 try{
  const i=reference.extend({text:z.string().trim().min(1).max(4000)}).parse(input);
  const deps=await practiceProviders(rpc);if(!deps)return {ok:false,code:'provider_unavailable'};
  const limits=practiceDailyLimits();
  const reserved=await mutatePractice(rpc,identity.id,'reserve',{...i,doctorLimit:limits.doctor,globalLimit:limits.global});
  if(!reserved.ok)return reserved;if(!reserved.token)return {ok:false,code:'unavailable'};
  held={sessionId:i.sessionId,expectedVersion:i.expectedVersion,token:reserved.token};
  if(reserved.session.state.turns.length>=MAX_PRACTICE_TURNS){await mutatePractice(rpc,identity.id,'release',held);return {ok:false,code:'conversation_full'};}
  const state=await runPracticeTurn(reserved.session.state,i.text,deps);
  return await mutatePractice(rpc,identity.id,'finish',{...held,state,configVersion:ZOE_CONFIG_VERSION});
 }catch{
  if(held)await mutatePractice(rpc,identity.id,'release',held).catch(()=>null);
  return {ok:false,code:'unavailable'};
 }
}
export async function replaceRecord(input:unknown,reset=false):Promise<PracticeResult>{
 const {client,identity}=await requirePracticeAccess();
 try{
  const i=(reset?reference:reference.extend({edit:practiceEditSchema})).parse(input);
  const rpc=practiceServiceRpc();if(!rpc)return {ok:false,code:'unavailable'};
  const current=await sessionFor(client,i.sessionId);
  const state=reset?startPractice(current.patientId):editPracticeRecord(current,(i as z.infer<typeof reference>&{edit:z.infer<typeof practiceEditSchema>}).edit);
  return await mutatePractice(rpc,identity.id,reset?'reset':'replace',{...i,state});
 }catch{return {ok:false,code:'unavailable'};}
}
export async function markReply(input:unknown){
 const {identity}=await requirePracticeAccess();
 try{
  const i=z.strictObject({sessionId:z.uuid(),turnId:z.uuid(),rating:z.enum(['good','wrong']),reason:z.enum(['unsafe','too_alarming','too_cautious','wrong_fact','wrong_tone','other']).optional(),correction:z.string().trim().max(4000).default('')}).parse(input);
  if(i.rating==='wrong'&&(!i.reason||!i.correction))return {ok:false as const,code:'reason_required'};
  const rpc=practiceServiceRpc();if(!rpc)return {ok:false as const,code:'unavailable'};
  const raw=await rpc('zoe_practice_mutate',{p_author:identity.id,p_operation:'mark',p_input:{...i,configVersion:ZOE_CONFIG_VERSION}});
  return z.union([z.object({ok:z.literal(false),code:z.string()}),z.object({ok:z.literal(true),mark:z.object({id:z.uuid(),turn_id:z.uuid(),rating:z.enum(['good','wrong'])}).passthrough()})]).parse(raw);
 }catch{return {ok:false as const,code:'unavailable'};}
}
