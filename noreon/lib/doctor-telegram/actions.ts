'use server';
import {cookies} from 'next/headers';
import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {validatedStaffSession} from '@/lib/staff/real-session-binding';
import {telegramAuthService} from '@/lib/telegram-auth/runtime';
import {parseStaffSigninState,staffTelegramSigninEnabled} from '@/lib/telegram-auth/staff-signin-config';
import {beginStaffSessionCode,verifyStaffSessionCode} from '@/lib/telegram-auth/staff-signin-core';
import {doctorTelegramEnabled} from './config';
import {sealRefreshToken} from './seal';
import {sealPendingConnection,readPendingConnection} from './pending';
import {doctorBrokerActor} from './actor';
import {passwordSession} from './connect-session';

const pendingCookie='noreon-doctor-telegram-pending';
const bindingSchema=z.object({id:z.uuid(),generation:z.number().int().positive()});
const statusSchema=z.object({ok:z.literal(true),binding:bindingSchema.nullable(),nextGeneration:z.number().int().positive(),connection:z.object({state:z.string(),expires_at:z.string()}).passthrough().nullable()});
type Result={kind:'connected'|'code'|'disconnected'|'password'|'invalid'|'unavailable'};

// New RPCs remain narrowly typed here until the migration can be replayed and db:types regenerated.
async function service(name:string,args:Record<string,unknown>){
 const db=telegramAuthService();
 const result=await (db.rpc as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>)(name,args);
 if(result.error)throw Error('Telegram connection unavailable');
 return result.data;
}
async function viewer(){
 if(!doctorTelegramEnabled())return null;
 const actor=await requireRealStaff();
 return actor.identity.role==='doctor'?actor:null;
}
async function status(doctorId:string){return statusSchema.parse(await service('doctor_telegram_status',{p_doctor:doctorId}));}

/** Only booleans cross the server boundary. No session or connection credentials reach the menu. */
export const doctorTelegramMenuState=loggedAction('doctorTelegramMenuState',async function doctorTelegramMenuState():Promise<{connected:boolean}|null>{
 const actor=await viewer();if(!actor)return null;
 try{const r=await status(actor.identity.id);return r.binding?{connected:!!r.connection&&['active','refreshing'].includes(r.connection.state)&&Date.parse(r.connection.expires_at)>Date.now()}:null;}catch{return null;}
});
async function open(doctorId:string,sessionId:string,accessToken:string,refreshToken:string):Promise<Result>{
 if(!await doctorBrokerActor(accessToken,doctorId,{sessionId}))return {kind:'unavailable'};
 const state=await status(doctorId);if(!state.binding)return {kind:'unavailable'};
 const sealed=sealRefreshToken(refreshToken,{doctorId,sessionId,generation:state.nextGeneration,bindingGeneration:state.binding.generation});
 const result=await service('doctor_telegram_open',{p_doctor:doctorId,p_binding:state.binding.id,p_binding_generation:state.binding.generation,p_session:sessionId,p_generation:state.nextGeneration,p_ciphertext:sealed.ciphertext,p_key_version:sealed.keyVersion,p_nonce:sealed.nonce}) as {ok?:boolean};
 return {kind:result.ok?'connected':'unavailable'};
}

export const connectDoctorTelegram=loggedAction('connectDoctorTelegram',async function connectDoctorTelegram(form:FormData):Promise<Result>{
 const actor=await viewer();if(!actor)return {kind:'unavailable'};
 const password=form.get('password');if(typeof password!=='string'||!password||password.length>4096)return {kind:'password'};
 let client:ReturnType<typeof createClient>|null=null,newSession:string|null=null,keep=false;
 try{
  const state=await status(actor.identity.id);if(!state.binding)return {kind:'unavailable'};
  // Read the browser's validated email, but never pass its session or cookie adapter to Auth sign-in.
  const browser=await validatedStaffSession(actor.client.auth);if(!browser)return {kind:'unavailable'};
  client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const signed=await passwordSession(client,actor.identity.id,browser.user.email!,password);
  if(signed.kind!=='session')return {kind:signed.kind};
  newSession=signed.sessionId;
  const admission=await client.rpc('staff_signin_state');
  const step=parseStaffSigninState(admission.data);if(admission.error||!step)return {kind:'unavailable'};
  if(step.required&&!step.admitted){
   if(!staffTelegramSigninEnabled())return {kind:'unavailable'};
   const sent=await beginStaffSessionCode({userId:actor.identity.id,sessionId:signed.sessionId});
   if(!sent.ok)return {kind:'unavailable'};
   const context={doctorId:actor.identity.id,sessionId:signed.sessionId,bindingGeneration:state.binding.generation};
   const sealed=sealPendingConnection({accessToken:signed.accessToken,refreshToken:signed.refreshToken,challenge:sent.pending},context);
   (await cookies()).set(pendingCookie,sealed,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/staff/real',maxAge:300});
   keep=true;return {kind:'code'};
  }
  const result=await open(actor.identity.id,signed.sessionId,signed.accessToken,signed.refreshToken);
  keep=result.kind==='connected';return result;
 }catch{return {kind:'unavailable'};}
 finally{
  if(!keep&&newSession)await service('doctor_telegram_abandon',{p_doctor:actor.identity.id,p_session:newSession}).catch(()=>null);
  else if(client&&!keep)await client.auth.signOut({scope:'local'}).catch(()=>null);
 }
});
export const verifyDoctorTelegram=loggedAction('verifyDoctorTelegram',async function verifyDoctorTelegram(form:FormData):Promise<Result>{
 const actor=await viewer();if(!actor)return {kind:'unavailable'};
 const jar=await cookies(),code=form.get('code');
 if(typeof code!=='string'||!/^\d{6}$/.test(code))return {kind:'invalid'};
 let sessionId:string|null=null,keep=false;
 try{
  const held=readPendingConnection(jar.get(pendingCookie)?.value??'',actor.identity.id);
  sessionId=held.sessionId;
  const result=await verifyStaffSessionCode({userId:held.doctorId,sessionId:held.sessionId},held.challenge,code);
  if(!result.ok){keep=true;return {kind:result.reason==='invalid'?'invalid':'unavailable'};}
  const connected=await open(held.doctorId,held.sessionId,held.accessToken,held.refreshToken);
  keep=connected.kind==='connected';
  jar.delete(pendingCookie);
  return connected;
 }catch{return {kind:'unavailable'};}
 finally{if(sessionId&&!keep){jar.delete(pendingCookie);await service('doctor_telegram_abandon',{p_doctor:actor.identity.id,p_session:sessionId}).catch(()=>null);}}
});
export const disconnectDoctorTelegram=loggedAction('disconnectDoctorTelegram',async function disconnectDoctorTelegram():Promise<Result>{
 const actor=await viewer();if(!actor)return {kind:'unavailable'};
 try{const result=await service('doctor_telegram_disconnect',{p_doctor:actor.identity.id}) as {ok?:boolean};(await cookies()).delete(pendingCookie);return {kind:result.ok?'disconnected':'unavailable'};}catch{return {kind:'unavailable'};}
});
