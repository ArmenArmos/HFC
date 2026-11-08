/** Synthetic identities and providers only. No hosted data, credentials, or network. */
import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {createStaffVoiceHandlers} from '@/lib/staff-zoe/voice-http';
import {staffVoiceAvailable,selectStaffTranscript,transcribeStaffVoice} from '@/lib/staff-zoe/voice';
import {signStaffVoiceReceipt,verifyStaffVoiceReceipt} from '@/lib/staff-zoe/voice-receipt';
import {verifyVoiceReceipt} from '@/lib/zoe-chat-actions/voice-receipt';
const env={NODE_ENV:'test',NOREON_NURSE_CHAT:'true',NOREON_NURSE_CHAT_V2:'true',NOREON_DOCTOR_WORKSPACE:'true',NOREON_DOCTOR_CHAT_HOME:'true',NOREON_DOCTOR_CHAT_V2:'true',NOREON_ZOE_VOICE_PROVIDER:'fake'};
for(const role of ['NURSE','DOCTOR'] as const)assert.equal(await staffVoiceAvailable(role,env),true);
assert.equal(await staffVoiceAvailable('NURSE',{...env,NOREON_NURSE_CHAT:'false'}),false);
assert.equal(await staffVoiceAvailable('DOCTOR',{...env,NOREON_DOCTOR_CHAT_HOME:'false'}),false);
assert.equal(await staffVoiceAvailable('NURSE',{...env,NODE_ENV:'production'}),false);
assert.equal(await staffVoiceAvailable('NURSE',env,{enabled:false}),false);
assert.equal(await staffVoiceAvailable('NURSE',{...env,NOREON_ZOE_VOICE_PROVIDER:'gateway'},undefined,async()=>{throw Error('synthetic');}),false);
const audio={bytes:new Uint8Array([1,2,3]),mimeType:'audio/mp4',durationMs:1000};
for(const role of ['NURSE','DOCTOR'] as const){
 for(const locale of ['hy','en','ru'] as const)assert.deepEqual(await transcribeStaffVoice(role,audio,locale,env),{status:'ok',text:'145/92',transcripts:{primary:'145/92',urgent:null}});
 assert.deepEqual(await transcribeStaffVoice(role,{...audio,durationMs:0},'en',env),{status:'invalid'});
}
const gateway={...env,NOREON_ZOE_VOICE_PROVIDER:'gateway'};
const posture=async()=>({gatewayConfigured:()=>true,zoeModelCallsEnabled:()=>true,realCallsBasis:()=>'staging'}) as never;
assert.equal(await staffVoiceAvailable('NURSE',gateway,{enabled:true},posture),true);
assert.equal(await staffVoiceAvailable('DOCTOR',gateway,{enabled:false},posture),false);
for(const load of [async()=>({gatewayConfigured:()=>false,zoeModelCallsEnabled:()=>true,realCallsBasis:()=>'staging'}) as never,async()=>({gatewayConfigured:()=>true,zoeModelCallsEnabled:()=>false,realCallsBasis:()=>'staging'}) as never,async()=>({gatewayConfigured:()=>true,zoeModelCallsEnabled:()=>true,realCallsBasis:()=>null}) as never])assert.equal(await staffVoiceAvailable('NURSE',gateway,{enabled:true},load),false);
assert.equal(selectStaffTranscript({primary:'Routine question',urgent:'Chest pain'},'hy',{NOREON_ZOE_TEST_LEXICON:'true'}),'Chest pain');
assert.equal(selectStaffTranscript({primary:'Routine question',urgent:'Chest pain'},'en',{NOREON_ZOE_TEST_LEXICON:'true'}),'Routine question');
assert.equal(selectStaffTranscript({primary:null,urgent:'Routine question'},'hy',{}),null);
const secret='synthetic-key-for-tests-only-at-least-32-characters',now=Date.now();
const receipt=signStaffVoiceReceipt('staff-1','Hello',secret,now,{primary:'Hello',urgent:null});
assert.equal(verifyStaffVoiceReceipt(receipt,'staff-1','Hello',now,secret),true);
assert.equal(verifyStaffVoiceReceipt(receipt,'staff-2','Hello',now,secret),false);
assert.equal(verifyStaffVoiceReceipt(receipt,'staff-1','Edited',now,secret),false);
assert.equal(verifyStaffVoiceReceipt(receipt,'staff-1','Hello',now+600_001,secret),false);
assert.equal(verifyVoiceReceipt(receipt,'staff-1','Hello',now,secret),false);
let identity:{id:string;role:string}|null={id:'staff-1',role:'nurse'},available=true,admitted=true,limitFails=false,calls=0,claims=0;
const seenKinds=new Set<string>();
const handlers=createStaffVoiceHandlers({actor:async()=>identity,available:async()=>available,limit:async(_request,id,kind)=>{seenKinds.add(kind);claims++;assert.equal(id,'staff-1');if(limitFails)throw Error('synthetic');return admitted?{ok:true}:{ok:false,retryAfter:30};},transcribe:async()=>{calls++;return {status:'ok',text:'Hello',transcripts:{primary:'Hello',urgent:null}};},speech:async()=>{calls++;return {status:'ok',audioBase64:'UklGRg==',mime:'audio/wav'};},sign:(id,text,transcripts)=>signStaffVoiceReceipt(id,text,secret,now,transcripts)});
const voice=(headers:Record<string,string>={},body:BodyInit='audio')=>new Request('http://localhost/api/staff/zoe/voice',{method:'POST',headers:{origin:'http://localhost','content-type':'audio/mp4','x-voice-duration-ms':'1000','x-voice-locale':'hy',...headers},body});
const speech=(body:unknown={text:'Hello',locale:'hy'})=>new Request('http://localhost/api/staff/zoe/speech',{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify(body)});
for(const role of ['nurse','doctor']){identity={id:'staff-1',role};const response=await handlers.voice(voice());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');const body=await response.json();assert.equal(body.urgent,undefined);assert.equal(body.transcripts,undefined);assert.equal(verifyStaffVoiceReceipt(body.receipt,'staff-1',body.text,now,secret),true);assert.equal((await handlers.speech(speech())).status,200);}
const before=calls,beforeClaims=claims;
for(const role of ['member','admin']){identity={id:'staff-1',role};assert.equal((await handlers.voice(voice())).status,401);assert.equal((await handlers.speech(speech())).status,401);}
identity=null;assert.equal((await handlers.voice(voice())).status,401);identity={id:'staff-1',role:'nurse'};
assert.equal((await handlers.voice(voice({origin:'https://elsewhere.invalid'}))).status,403);
available=false;assert.equal((await handlers.voice(voice())).status,503);assert.equal((await handlers.speech(speech())).status,503);available=true;
assert.equal(claims,beforeClaims);
admitted=false;const limited=await handlers.voice(voice());assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'30');admitted=true;
limitFails=true;assert.equal((await handlers.voice(voice())).status,503);limitFails=false;
for(const headers of [{'content-type':'text/plain'},{'x-voice-duration-ms':'60001'},{'x-voice-locale':'fr'}] as Record<string,string>[])assert.equal((await handlers.voice(voice(headers))).status,400);
assert.equal((await handlers.voice(voice({'content-length':'2097153'}))).status,413);
assert.equal((await handlers.voice(voice({},new Uint8Array(2097153)))).status,400);
for(const body of [null,{text:'',locale:'en'},{text:'x'.repeat(1201),locale:'hy'},{text:'Hello',locale:'fr'},{text:'x'.repeat(17000),locale:'en'}])assert.equal((await handlers.speech(speech(body))).status,400);
assert.equal(calls,before,'Denied/invalid requests never call providers');
// A stalled upload is cancelled by the actual bounded reader without waiting in real time.
mock.timers.enable({apis:['setTimeout']});
try{
 let cancelled=false;
 const slow={url:'http://localhost/api/staff/zoe/voice',headers:voice().headers,body:new ReadableStream({cancel(){cancelled=true;}})} as Request;
 const pending=handlers.voice(slow);
 await new Promise(resolve=>setImmediate(resolve));
 mock.timers.tick(15_000);
 assert.equal((await pending).status,400);
 assert.equal(cancelled,true);
}finally{mock.timers.reset();}
assert.deepEqual([...seenKinds].sort(),['speech','transcribe'],'speech chunks must not spend the transcription budget');
console.log('Staff voice HTTP: roles, gates, origin, fail-closed limiting, input caps, speech and receipt isolation passed');
