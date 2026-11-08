import assert from 'node:assert/strict';
const {fetchMessageDelivery,runMessageReconciliation}=await import('@/lib/messaging/recovery');
const {parseTwilioConfig}=await import('@/lib/messaging/twilio');
const config=parseTwilioConfig({accountSid:'AC'+'1'.repeat(32),authToken:'fictional-token-not-a-secret',smsFrom:'+15005550006',whatsappFrom:'whatsapp:+15005550006',whatsappHyContentSid:'HX'+'2'.repeat(32),whatsappEnContentSid:'HX'+'3'.repeat(32),appUrl:'https://app.example.com/patient/dashboard',callbackUrl:'https://app.example.com/api/messaging/twilio/status'});
const id='b9800000-0000-4000-8000-000000000001',sid='SM'+'4'.repeat(32);
let calls=0;
const transport={messages:(reference:string)=>({fetch:async()=>{calls++;assert.equal(reference,sid);return {sid,accountSid:config.accountSid,status:'delivered',errorCode:null,body:'must never return this',to:'+37499000000'};}})};
assert.deepEqual(await fetchMessageDelivery(config,id,sid,transport),{attemptId:id,reference:sid,status:'delivered',errorCode:null});
assert.equal(calls,1);
for(const change of [{sid:'SM'+'5'.repeat(32)},{accountSid:'AC'+'5'.repeat(32)},{status:'unexpected'}]){
 assert.equal(await fetchMessageDelivery(config,id,sid,{messages:()=>({fetch:async()=>({sid,accountSid:config.accountSid,status:'sent',...change})})}),null);
}
assert.equal(await fetchMessageDelivery(config,id,'invalid',transport),null);assert.equal(calls,1);
for(const status of [404,429,500])assert.equal(await fetchMessageDelivery(config,id,sid,{messages:()=>({fetch:async()=>{throw {status,message:'private'};}})}),null);
let recorded=0,deferred:Array<[string,boolean]>=[];
const store={candidates:async()=>[{attempt_id:id,provider_reference:sid}],record:async()=>{recorded++;return true;},defer:async(id:string,failed:boolean)=>{deferred.push([id,failed]);return true;}};
assert.deepEqual(await runMessageReconciliation(store,async()=>({attemptId:id,reference:sid,status:'sent',errorCode:null})),{checked:1,recorded:1,unresolved:0,halted:false});
assert.equal(recorded,1);assert.deepEqual(deferred,[[id,false]]);
deferred=[];
assert.deepEqual(await runMessageReconciliation(store,async()=>null),{checked:1,recorded:0,unresolved:1,halted:false});assert.deepEqual(deferred,[[id,true]]);
assert.equal((await runMessageReconciliation({...store,record:async()=>false},async()=>({attemptId:id,reference:sid,status:'sent',errorCode:null}))).halted,true);
let count=0;await runMessageReconciliation({...store,candidates:async()=>Array.from({length:100},()=>({attempt_id:id,provider_reference:sid}))},async()=>{count++;return null;});assert.equal(count,25);
let clock=0;count=0;await runMessageReconciliation(store,async()=>{count++;return null;},()=>clock+=40000);assert.equal(count,0);
console.log('Known-reference reconciliation validates account/SID, omits recipient/body data, bounds work and preserves uncertainty on all provider errors.');
