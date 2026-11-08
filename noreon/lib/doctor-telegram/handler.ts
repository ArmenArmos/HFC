import 'server-only';
import {z} from 'zod';
import type {TelegramChannelAdapter} from '@/lib/telegram-channel/outbound';
import type {TelegramServiceRpc} from '@/lib/telegram-runtime/dispatch';
import {withBroker,type BrokerDependencies} from './broker';
import {doctorTelegramCopy} from './copy';

const routed=z.object({staff:z.object({inboxId:z.uuid(),connectionId:z.uuid(),generation:z.number().int().positive(),closed:z.boolean(),chatId:z.number().int().positive(),callbackId:z.string().nullable()})});
const appLink='https://backoffice.noreon.health/staff/real/doctor-chat-v2';
/** T1 has no clinical read or command. A persisted staff route can never fall through to member input. */
export async function handleDoctorTelegram(rpc:TelegramServiceRpc,adapter:TelegramChannelAdapter|null,processed:unknown,dependencies?:Omit<BrokerDependencies,'rpc'>){
 const parsed=routed.safeParse(processed);if(!parsed.success)return false;
 if(!adapter)return true;
 const row=parsed.data.staff,fence={p_id:row.inboxId,p_connection:row.connectionId,p_generation:row.generation};
 // A response has no idempotent retry. Claim before even calling the transport.
 const claim=await rpc('doctor_telegram_inbox_claim',fence).catch(()=>null) as {ok?:boolean}|null;
 if(!claim?.ok)return true;
 if(row.callbackId)await adapter.acknowledgeCallback(row.callbackId).catch(()=>null);
 let sent=false;
 const send=async(text:string)=>{sent=true;return adapter.deliverText(Object.freeze({address:String(row.chatId),text})).catch(()=>null);};
 let result='closed';
 if(!row.closed){
  const broker=await withBroker({connectionId:row.connectionId,generation:row.generation},async actor=>{
   await actor.admit();
   const outcome=await send(doctorTelegramCopy.connected);
   return outcome?.kind==='accepted';
  },{rpc,...dependencies});
  result=broker.ok?(broker.value?'connected':'failed'):broker.code==='unavailable'?'unavailable':'closed';
 }
 if(!sent){const outcome=await send(`${doctorTelegramCopy.reconnect}\n${appLink}`);if(outcome?.kind!=='accepted')result='failed';}
 await rpc('doctor_telegram_inbox_done',{...fence,p_result:result}).catch(()=>null);
 return true;
}
