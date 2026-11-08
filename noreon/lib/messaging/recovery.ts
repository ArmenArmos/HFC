import 'server-only';
import {z} from 'zod';
import {createTwilioTransport,type TwilioConfig,type VerifiedDeliveryCallback,type ProviderDeliveryStatus} from './twilio';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';

type LookupTransport={messages:(reference:string)=>{fetch:()=>Promise<{sid:string;accountSid:string;status:string;errorCode?:number|null}>}};
const statuses=new Set(['accepted','scheduled','queued','sending','sent','delivered','read','undelivered','failed','canceled']);
/** Only a reference already bound by submission or a signed callback is eligible. */
export async function fetchMessageDelivery(config:TwilioConfig,attemptId:string,reference:string,transport:LookupTransport=createTwilioTransport(config)):Promise<VerifiedDeliveryCallback|null>{
 if(!z.uuid().safeParse(attemptId).success||!/^(SM|MM)[0-9a-fA-F]{32}$/.test(reference))return null;
 try{
  const result=await transport.messages(reference).fetch();
  if(result.sid!==reference||result.accountSid!==config.accountSid||!statuses.has(result.status))return null;
  return {attemptId,reference,status:result.status as ProviderDeliveryStatus,errorCode:typeof result.errorCode==='number'&&Number.isSafeInteger(result.errorCode)&&result.errorCode>=0?String(result.errorCode):null};
 }catch{return null;}
}
export interface ReconciliationStore{
 candidates():Promise<Array<{attempt_id:string;provider_reference:string}>>;
 record(event:VerifiedDeliveryCallback):Promise<boolean>;
 defer(id:string,failed:boolean,status?:ProviderDeliveryStatus):Promise<boolean>;
}
export async function runMessageReconciliation(store:ReconciliationStore,lookup:(id:string,reference:string)=>Promise<VerifiedDeliveryCallback|null>,now:()=>number=Date.now){
 const deadline=now()+45_000,result={checked:0,recorded:0,unresolved:0,halted:false};
 try{
  for(const item of (await store.candidates()).slice(0,25)){
   if(now()>=deadline-25_000)break;
   result.checked++;
   const event=await lookup(item.attempt_id,item.provider_reference);
   if(event){
    if(event.attemptId!==item.attempt_id||event.reference!==item.provider_reference||!await store.record(event)){result.halted=true;break;}
    result.recorded++;
   }else result.unresolved++;
   if(!await store.defer(item.attempt_id,!event,event?.status)){result.halted=true;break;}
  }
 }catch{result.halted=true;}
 return result;
}
export function reconciliationStore(db:SupabaseClient<Database>):ReconciliationStore{
 const signal=()=>AbortSignal.timeout(5000);
 return {
  async candidates(){const r=await db.rpc('patient_message_reconciliation_candidates',{p_limit:25}).abortSignal(signal());if(r.error)throw Error('storage');return r.data;},
  async record(event){const r=await db.rpc('record_patient_message_delivery',{p_attempt_id:event.attemptId,p_reference:event.reference,p_status:event.status,p_error_code:event.errorCode??undefined}).abortSignal(signal());if(r.error)throw Error('storage');return r.data;},
  async defer(id,failed,status){const r=await db.rpc('defer_patient_message_reconciliation',{p_attempt_id:id,p_failed:failed,p_observed_status:status}).abortSignal(signal());if(r.error)throw Error('storage');return r.data;},
 };
}
