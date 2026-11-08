import assert from 'node:assert/strict';
import {handleDoctorTelegram} from '@/lib/doctor-telegram/handler';
import {sealRefreshToken} from '@/lib/doctor-telegram/seal';
import type {DoctorBrokerActor} from '@/lib/doctor-telegram/actor';
import type {TelegramChannelAdapter} from '@/lib/telegram-channel/outbound';
const doctor='11111111-1111-4111-8111-111111111111',session='22222222-2222-4222-8222-222222222222',connection='33333333-3333-4333-8333-333333333333',inbox='44444444-4444-4444-8444-444444444444',lease='55555555-5555-4555-8555-555555555555';
const env={NOREON_DOCTOR_WORKSPACE:'true',NOREON_DOCTOR_CHAT_HOME:'true',NOREON_DOCTOR_CHAT_V2:'true',NOREON_DOCTOR_TELEGRAM:'true',NOREON_DOCTOR_TELEGRAM_KEY:`v1:${Buffer.alloc(32,12).toString('base64')}`};
const sealed=sealRefreshToken('synthetic-refresh',{doctorId:doctor,sessionId:session,generation:1,bindingGeneration:1},env);
const row={id:connection,doctor_id:doctor,session_id:session,generation:1,binding_generation:1,state:'active',ciphertext:sealed.ciphertext,key_version:sealed.keyVersion,nonce:sealed.nonce,expires_at:new Date(Date.now()+60_000).toISOString(),lease_token:lease};
let claimed=false,refreshFail=false,sendFails=false,admitted=true;
const calls:string[]=[],texts:string[]=[];
const rpc=async(name:string,args:Record<string,unknown>)=>{
 calls.push(name);
 if(name==='doctor_telegram_inbox_claim'){if(claimed)return {ok:false};claimed=true;return {ok:true};}
 if(name==='doctor_telegram_take_lease')return {ok:true,connection:row};
 if(name==='doctor_telegram_action_admit')return {ok:admitted};
 assert.ok(['doctor_telegram_begin_refresh','doctor_telegram_finish_refresh','doctor_telegram_release_lease','doctor_telegram_quarantine','doctor_telegram_inbox_done'].includes(name),`No clinical or member operation: ${name}`);
 if(name==='doctor_telegram_inbox_done')assert.ok(['connected','closed','unavailable','failed'].includes(args.p_result as string));
 return {ok:true};
};
const adapter={acknowledgeCallback:async()=>{calls.push('ack');return 'acknowledged';},deliverText:async(payload:{text:string;address:string})=>{assert.equal(payload.address,'123');texts.push(payload.text);if(sendFails)throw Error('Unknown transport outcome');return {kind:'accepted'};}} as unknown as TelegramChannelAdapter;
const deps={env,auth:{refreshSession:async()=>({data:{session:refreshFail?null:{access_token:'synthetic-access',refresh_token:'rotated-refresh'}},error:refreshFail})},actor:async()=>({identity:{id:doctor},sessionId:session}) as DoctorBrokerActor};
const event={staff:{inboxId:inbox,doctorId:doctor,connectionId:connection,generation:1,closed:false,chatId:123,callbackId:null}};
const reset=()=>{claimed=false;refreshFail=false;sendFails=false;admitted=true;calls.length=0;texts.length=0;};
assert.equal(await handleDoctorTelegram(rpc,adapter,{ok:true},deps),false);
assert.equal(await handleDoctorTelegram(rpc,null,event,deps),true);assert.equal(calls.length,0);
for(const scenario of ['connected','closed','refresh-failed','send-unknown','disconnect-after-admit'] as const){
 reset();refreshFail=scenario==='refresh-failed';sendFails=scenario==='send-unknown';admitted=scenario!=='disconnect-after-admit';
 const routed={staff:{...event.staff,closed:scenario==='closed',callbackId:'synthetic-callback'}};
 assert.equal(await handleDoctorTelegram(rpc,adapter,routed,deps),true);
 assert.equal(texts.length,1,'Exactly one transport attempt, including an uncertain send');
 assert.ok(calls.indexOf('doctor_telegram_inbox_claim')<calls.indexOf('ack'));
 if(scenario==='connected'||scenario==='send-unknown')assert.match(texts[0],/Connected to Noreon/);
 else assert.match(texts[0],/https:\/\/backoffice.noreon.health\/staff\/real\/doctor-chat-v2/);
 if(scenario==='closed')assert.ok(!calls.includes('doctor_telegram_take_lease'));
 assert.equal(await handleDoctorTelegram(rpc,adapter,routed,deps),true);assert.equal(texts.length,1,'Persisted attempt refuses resend');
}
console.log('Doctor Telegram handler: connected, closed, failed refresh, disconnect admission, callback, no adapter and uncertain-send deduplication passed (fake Auth/RPC/transport).');
