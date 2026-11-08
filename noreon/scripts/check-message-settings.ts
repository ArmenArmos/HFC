import assert from 'node:assert/strict';
// @ts-expect-error Runtime Node supports registerHooks; project types target Node20.
import {registerHooks} from 'node:module';
const f={user:{id:'member',phone:'37499000123',phone_confirmed_at:'2026-10-12'},clientCalls:0,rpcCalls:[] as unknown[],error:null as null|{message:string},revision:2,readError:false,tables:{patient_message_preferences:{channel:'sms',revision:1,verified_phone:'+37499000123'},profiles:{locale:'en',display_name:'Fictional member',birth_date:'1980-01-01',biological_sex:'female'},patient_consents:{version:'patient-pilot-v1'}}};
Object.assign(globalThis,{__messageSettings:f});
const hook=registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 if(s==='@/lib/supabase/server')return {url:'data:text/javascript,'+encodeURIComponent(`const f=globalThis.__messageSettings;export async function createClient(){f.clientCalls++;return {auth:{getUser:async()=>({data:{user:f.user},error:null})},from(name){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:f.tables[name],error:f.readError?{}:null})}},rpc:async(name,args)=>{f.rpcCalls.push({name,args});return {data:f.revision,error:f.error};}}}`),shortCircuit:true};
 return next(s,c);
}});
const previous={...process.env};
Object.assign(process.env,{NOREON_TWILIO_SMS_READY:'true',NOREON_TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),NOREON_TWILIO_API_KEY_SID:'SK'+'2'.repeat(32),NOREON_TWILIO_API_KEY_SECRET:'fictional-secret-credentials',NOREON_TWILIO_SMS_FROM:'Noreon',NOREON_MESSAGE_APP_URL:'https://app.example.com',NOREON_TWILIO_CALLBACK_URL:'https://app.example.com/callback'});
try{
 const {saveMessagePreference,messageIdentityContext,readMessageSettings,MessageSettingsUnauthorized}=await import('@/lib/messaging/server');
 let view=await readMessageSettings();assert.deepEqual(view.availableChannels,['sms']);assert.equal(view.maskedPhone,'•••• 0123');assert.equal(view.canOptIn,true);assert.equal(view.deliveryEnabled,false);assert.ok(!JSON.stringify(view).includes('37499000123'));
 f.readError=true;await assert.rejects(readMessageSettings(),/unavailable/);f.readError=false;f.clientCalls=0;
 const input={channel:'sms',expectedRevision:1,consent:true,context:messageIdentityContext(f.user)};
 const original=f.user;f.user=null as unknown as typeof f.user;await assert.rejects(readMessageSettings(),MessageSettingsUnauthorized);assert.deepEqual(await saveMessagePreference(input),{ok:false,reason:'unauthorized'});f.user=original;
 assert.deepEqual(await saveMessagePreference({...input,recipient:'+37412345678'}),{ok:false,reason:'invalid'});
 assert.deepEqual(await saveMessagePreference({...input,consent:false}),{ok:false,reason:'consent-required'});assert.equal(f.rpcCalls.length,0);
 const before=f.rpcCalls.length;assert.deepEqual(await saveMessagePreference({...input,channel:'whatsapp'}),{ok:false,reason:'unavailable'});assert.equal(f.rpcCalls.length,before);
 assert.deepEqual(await saveMessagePreference(input),{ok:true,revision:2,channel:'sms'});
 assert.deepEqual(f.rpcCalls[0],{name:'save_patient_message_preferences_for_phone',args:{p_channel:'sms',p_expected_revision:1,p_consent_version:'messaging-service-v1',p_expected_phone:'+37499000123'}});
 assert.deepEqual(await saveMessagePreference({...input,context:'0'.repeat(64)}),{ok:false,reason:'account-changed'});
 f.revision=-1;assert.deepEqual(await saveMessagePreference(input),{ok:false,reason:'conflict'});
 f.revision=3;f.error={message:'verified membership required'};assert.deepEqual(await saveMessagePreference(input),{ok:false,reason:'ineligible'});
 f.error={message:'phone changed'};assert.deepEqual(await saveMessagePreference(input),{ok:false,reason:'account-changed'});
 f.error={message:'too many preference changes'};assert.deepEqual(await saveMessagePreference(input),{ok:false,reason:'rate-limited'});
 f.error={message:'sensitive internal details'};assert.deepEqual(await saveMessagePreference(input),{ok:false,reason:'unavailable'});
 f.error=null;f.user.phone_confirmed_at='';view=await readMessageSettings();assert.equal(view.canOptIn,false);assert.equal(view.needsReconfirmation,true);assert.equal(view.maskedPhone,null);assert.deepEqual(await saveMessagePreference({channel:'none',expectedRevision:2,consent:false,context:messageIdentityContext(f.user)}),{ok:true,revision:3,channel:'none'});
 console.log('Message settings reject anonymous callers, destination injection and unchecked consent; conflicts/errors remain typed and opt-out reaches the authoritative RPC.');
}finally{for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);hook.deregister();Reflect.deleteProperty(globalThis,'__messageSettings');}
