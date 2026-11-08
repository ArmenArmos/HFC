import 'server-only';
import {z} from 'zod';
import {doctorTelegramEnabled} from './config';
import {doctorBrokerActor,type DoctorBrokerActor} from './actor';
import {sealRefreshToken,unsealRefreshToken,type SealContext} from './seal';
export type DoctorTelegramRpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
export type BrokerAuth={refreshSession:(input:{refresh_token:string})=>Promise<{data:{session:{access_token:string;refresh_token:string}|null};error:unknown}>};
export type BrokerDependencies={rpc:DoctorTelegramRpc;auth?:BrokerAuth;env?:Record<string,string|undefined>;actor?:typeof doctorBrokerActor;now?:()=>number};
const connectionSchema=z.object({id:z.uuid(),doctor_id:z.uuid(),session_id:z.uuid(),generation:z.number().int().positive(),binding_generation:z.number().int().positive(),state:z.literal('active'),ciphertext:z.string().min(1),key_version:z.string(),nonce:z.string(),expires_at:z.string(),lease_token:z.uuid()});
const okSchema=z.object({ok:z.literal(true)});
export type BrokerActor=DoctorBrokerActor&{admit:()=>Promise<void>};
export type BrokerResult<T>={ok:true;value:T}|{ok:false;code:'off'|'unavailable'|'closed'};
/** Supabase's SDK refresh retries network/5xx uncertainty. This port deliberately sends once. */
export function doctorBrokerAuth(env:Record<string,string|undefined>,http:typeof fetch=fetch):BrokerAuth{
 const url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)throw Error('Doctor Telegram unavailable.');
 return {refreshSession:async input=>{
  try{
   const response=await http(`${url.replace(/\/$/,'')}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(input),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15_000)});
   if(!response.ok)return {data:{session:null},error:true};
   const result=z.object({access_token:z.string().min(1),refresh_token:z.string().min(1)}).safeParse(await response.json());
   return result.success?{data:{session:result.data},error:null}:{data:{session:null},error:true};
  }catch{return {data:{session:null},error:true};}
 }};
}
/** A refresh is never retried: an uncertain Auth call or persistence requires reconnection. */
export async function withBroker<T>(reference:{connectionId:string;generation:number},work:(actor:BrokerActor)=>Promise<T>,dependencies:BrokerDependencies):Promise<BrokerResult<T>>{
 const env=dependencies.env??process.env,rpc=dependencies.rpc;
 if(!doctorTelegramEnabled(env))return {ok:false,code:'off'};
 let fence:Record<string,unknown>|null=null,refreshing=false;
 try{
  const taken=z.object({ok:z.literal(true),connection:connectionSchema}).safeParse(await rpc('doctor_telegram_take_lease',{p_connection:reference.connectionId,p_generation:reference.generation}));
  if(!taken.success)return {ok:false,code:'closed'};
  const row=taken.data.connection;
  fence={p_connection:row.id,p_generation:row.generation,p_lease:row.lease_token};
  if(row.id!==reference.connectionId||row.generation!==reference.generation||!Number.isFinite(Date.parse(row.expires_at))||Date.parse(row.expires_at)<=(dependencies.now?.()??Date.now()))return {ok:false,code:'closed'};
  const context:SealContext={doctorId:row.doctor_id,sessionId:row.session_id,generation:row.generation,bindingGeneration:row.binding_generation};
  const token=unsealRefreshToken({ciphertext:row.ciphertext,keyVersion:row.key_version,nonce:row.nonce},context,env);
  // Set locally before the RPC: a lost acknowledgement is also an uncertain transition.
  refreshing=true;
  if(!okSchema.safeParse(await rpc('doctor_telegram_begin_refresh',fence)).success)throw Error('Refresh refused');
  const refreshed=await (dependencies.auth??doctorBrokerAuth(env)).refreshSession({refresh_token:token});
  const session=refreshed.data.session;
  if(refreshed.error||!session?.access_token||!session.refresh_token)throw Error('Refresh failed');
  const sealed=sealRefreshToken(session.refresh_token,context,env);
  if(!okSchema.safeParse(await rpc('doctor_telegram_finish_refresh',{...fence,p_ciphertext:sealed.ciphertext,p_key_version:sealed.keyVersion,p_nonce:sealed.nonce})).success)throw Error('Refresh persistence failed');
  refreshing=false;
  const actor=await (dependencies.actor??doctorBrokerActor)(session.access_token,row.doctor_id,{env,sessionId:row.session_id});
  if(!actor)return {ok:false,code:'closed'};
  const admit=async()=>{
   if(!okSchema.safeParse(await rpc('doctor_telegram_action_admit',fence!)).success)throw Error('Doctor Telegram connection ended.');
  };
  await admit();
  return {ok:true,value:await work({...actor,admit})};
 }catch{
  if(refreshing&&fence)try{await rpc('doctor_telegram_quarantine',fence);}catch{/* Expired refreshing leases are quarantined by the database on the next take. */}
  return {ok:false,code:'unavailable'};
 }finally{
  if(fence&&!refreshing)try{await rpc('doctor_telegram_release_lease',fence);}catch{/* The bounded database lease expires without retrying Auth or work. */}
 }
}
export const withDoctorTelegramBroker=withBroker;
