/**
 * WP V: the Gemini Live token routes and the locked session. Order and codes like the voice routes (403 origin, 401
 * actor, 503 availability, 429 fail-closed limiter, only then the body), private no-store, an answer of exactly
 * {token, model, expiresAt} with no API key and no instruction, a single-use short-lived token whose constraints lock a
 * text-only, tool-free relay with the locale's transcription, and every staff role covered.
 * Run: node --no-warnings --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/check-zoe-live-token.ts
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {APP_ROLES,type AppRole} from '@/lib/rbac/roles';

globalThis.fetch=(()=>{throw Error('No network in this check');}) as typeof fetch;
const {createLiveTokenHandler}=await import('@/lib/zoe-chat-actions/live-token-http');
const {liveAvailable,liveConnectConfig,liveModel,mintLiveToken,LIVE_RELAY_INSTRUCTION,DEFAULT_LIVE_MODEL,LIVE_MAX_OUTPUT_TOKENS}=await import('@/lib/zoe-chat-actions/voice-live');
const {staffVoiceRole,staffLiveAvailable}=await import('@/lib/staff-zoe/voice');
const {DEFAULT_VOICE_SETTINGS}=await import('@/lib/zoe-chat-actions/voice-settings');
function scenario(name:string,fn:()=>Promise<void>|void){return Promise.resolve(fn()).then(()=>console.log(`ok   ${name}`));}

const KEY='AIza-synthetic-key-0000000000000000';
let actor:{id:string;role:AppRole}|null={id:'member-1',role:'patient'},available=true,admitted=true,limitFails=false;
const events:string[]=[];
const handler=createLiveTokenHandler({
 actor:async()=>{events.push('actor');return actor;},
 available:async()=>{events.push('available');return available;},
 limit:async()=>{events.push('limit');if(limitFails)throw Error('synthetic');return admitted?{ok:true}:{ok:false,retryAfter:42};},
 mint:async(who,locale)=>{events.push(`mint:${who.role}:${locale}`);return {token:'auth_tokens/ephemeral-1',model:DEFAULT_LIVE_MODEL,expiresAt:'2026-11-08T08:01:00.000Z'};},
});
const request=(body:unknown={locale:'hy'},headers:Record<string,string>={})=>new Request('http://localhost/api/patient/zoe/live-token',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});

await scenario('order and codes: origin, actor, availability, fail-closed limiter, then the body',async()=>{
 events.length=0;assert.equal((await handler(request({locale:'hy'},{origin:'https://elsewhere.invalid'}))).status,403);assert.deepEqual(events,[]);
 actor=null;assert.equal((await handler(request())).status,401);assert.deepEqual(events,['actor']);actor={id:'member-1',role:'patient'};
 events.length=0;available=false;assert.equal((await handler(request('{not json'))).status,503);assert.deepEqual(events,['actor','available'],'no limiter claim or body read before availability');available=true;
 events.length=0;admitted=false;const limited=await handler(request());assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'42');assert.equal(limited.headers.get('cache-control'),'private, no-store');admitted=true;
 assert.ok(!events.some((e:string)=>e.startsWith('mint')),'a refused request mints nothing');
 limitFails=true;assert.equal((await handler(request())).status,503,'the limiter fails closed');limitFails=false;
 for(const bad of [{locale:'fr'},{locale:'hy',model:'gemini-other'},{locale:'hy',tools:[]},'{"locale":"hy"','[]'])assert.equal((await handler(request(bad))).status,400,JSON.stringify(bad));
 assert.equal((await handler(request({locale:'hy'},{'content-length':'4096'}))).status,413);
});
await scenario('the answer is exactly token, model and expiry; private, no-store; never the key or the instruction',async()=>{
 const response=await handler(request({locale:'ru'}));
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 const text=await response.text(),body=JSON.parse(text);
 assert.deepEqual(Object.keys(body).sort(),['expiresAt','model','token']);
 assert.ok(!text.includes(KEY)&&!text.includes('relay')&&!text.includes(LIVE_RELAY_INSTRUCTION.slice(0,30)));
 assert.ok(events.includes('mint:patient:ru'));
});
await scenario('every role reaches its own mint; a mint failure is unavailable',async()=>{
 for(const role of APP_ROLES){actor={id:`${role}-1`,role};events.length=0;assert.equal((await handler(request())).status,200,role);assert.ok(events.includes(`mint:${role}:hy`));}
 const failing=createLiveTokenHandler({actor:async()=>({id:'n',role:'nurse'}),available:async()=>true,limit:async()=>({ok:true}),mint:async()=>null});
 assert.equal((await failing(request())).status,503);
 const throwing=createLiveTokenHandler({actor:async()=>{throw Error('session');},available:async()=>true,limit:async()=>({ok:true}),mint:async()=>null});
 assert.equal((await throwing(request())).status,401);
});
await scenario('staff role coverage: every staff application role has a voice surface; members and caregivers use the member route',()=>{
 assert.deepEqual(Object.fromEntries(APP_ROLES.map(r=>[r,staffVoiceRole(r)])),{patient:null,caregiver:null,nurse:'NURSE',family_physician:'DOCTOR',cardiologist:'DOCTOR',care_coordinator:'COORDINATOR',clinic_admin:'CLINIC_ADMIN',noreon_admin:'ADMIN'});
});

// The token and the locked configuration.
const env={NOREON_ZOE_VOICE_LIVE:'true',NOREON_ZOE_VOICE_PROVIDER:'gateway',GEMINI_API_KEY:KEY,NOREON_ZOE_APP_V3:'true',NOREON_MEMBER_CHAT_V2:'true',AI_GATEWAY_API_KEY:'gw',NOREON_ZOE_MODEL_CALLS_ENABLED:'true',NOREON_PRELAUNCH_STAGING:'true'};
const settings={...DEFAULT_VOICE_SETTINGS,enabled:true,live_enabled:true};
await scenario('the token is single use, short lived, and locks a text-only relay with no tools',async()=>{
 const now=Date.parse('2026-11-08T08:00:00Z');let seen:{key:string;config:Record<string,unknown>}|null=null;
 const token=await mintLiveToken('patient','hy',{env,settings,now,create:async(key,config)=>{seen={key,config:config as unknown as Record<string,unknown>};return {name:'auth_tokens/eph-1'};}});
 assert.deepEqual(token,{token:'auth_tokens/eph-1',model:DEFAULT_LIVE_MODEL,expiresAt:'2026-11-08T08:01:00.000Z'});
 const c=seen!.config as {uses:number;expireTime:string;newSessionExpireTime:string;liveConnectConstraints:{model:string;config:Record<string,unknown>};lockAdditionalFields?:unknown};
 assert.equal(seen!.key,KEY);assert.equal(c.uses,1);
 assert.equal(c.newSessionExpireTime,'2026-11-08T08:01:00.000Z');assert.ok(Date.parse(c.expireTime)-now<=10*60_000);
 assert.equal('lockAdditionalFields' in c,false,'with constraints and no lockAdditionalFields, every config field is locked');
 assert.equal(c.liveConnectConstraints.model,DEFAULT_LIVE_MODEL);
 const config=c.liveConnectConstraints.config as ReturnType<typeof liveConnectConfig>;
 assert.deepEqual(config.responseModalities,['TEXT']);assert.deepEqual(config.tools,[]);assert.equal(config.maxOutputTokens,LIVE_MAX_OUTPUT_TOKENS);assert.ok(LIVE_MAX_OUTPUT_TOKENS<=16);
 assert.equal(config.systemInstruction,LIVE_RELAY_INSTRUCTION);assert.match(LIVE_RELAY_INSTRUCTION,/Do not answer/);
 assert.deepEqual(config.inputAudioTranscription,{languageCodes:['hy-AM']});
 assert.deepEqual(config.realtimeInputConfig.automaticActivityDetection.disabled,false);
 assert.ok(!('speechConfig' in config)&&!('outputAudioTranscription' in config),'no model voice at all');
 assert.deepEqual(liveConnectConfig('ru').inputAudioTranscription,{languageCodes:['ru-RU']});
 assert.deepEqual(liveConnectConfig('en').inputAudioTranscription,{languageCodes:['en-US']});
 assert.equal(await mintLiveToken('patient','hy',{env,settings,create:async()=>({name:KEY})}),null,'a name equal to the key is never returned');
 assert.equal(await mintLiveToken('patient','hy',{env,settings,create:async()=>{throw Error('provider says no')}}),null);
 assert.equal(await mintLiveToken('patient','hy',{env:{...env,GEMINI_API_KEY:''},settings,create:async()=>({name:'x'})}),null);
 assert.equal(await mintLiveToken('patient','fr' as 'hy',{env,settings,create:async()=>({name:'x'})}),null);
});
await scenario('the model comes from NOREON_ZOE_LIVE_MODEL, then the administrator, then the documented default',()=>{
 assert.equal(liveModel({},{live_model:'gemini-live-custom-1'}),'gemini-live-custom-1');
 assert.equal(liveModel({NOREON_ZOE_LIVE_MODEL:'gemini-2.0-flash-live-001'},{live_model:'gemini-live-custom-1'}),'gemini-2.0-flash-live-001');
 assert.equal(liveModel({NOREON_ZOE_LIVE_MODEL:'not a model; drop'},{live_model:'gemini-live-custom-1'}),'gemini-live-custom-1');
 assert.equal(liveModel({},{live_model:'BAD MODEL'}),DEFAULT_LIVE_MODEL);
});
await scenario('Live availability layers every gate and never throws',async()=>{
 const posture=async()=>({gatewayConfigured:()=>true,zoeModelCallsEnabled:()=>true,realCallsBasis:()=>'staging' as const}) as never;
 assert.equal(await liveAvailable(env,settings,{kind:'member'},posture),true);
 for(const [name,e,s] of [['flag',{...env,NOREON_ZOE_VOICE_LIVE:'false'},settings],['fake provider',{...env,NOREON_ZOE_VOICE_PROVIDER:'fake'},settings],['no key',{...env,GEMINI_API_KEY:''},settings],
  ['settings off',env,{...settings,live_enabled:false}],['voice off',env,{...settings,enabled:false}],['chat v2 off',{...env,NOREON_MEMBER_CHAT_V2:'false'},settings]]as const)
  assert.equal(await liveAvailable(e as Record<string,string>,s,{kind:'member'},posture),false,name);
 assert.equal(await liveAvailable(env,settings,{kind:'member'},async()=>{throw Error('gateway module');}),false);
 assert.equal(await liveAvailable(env,settings,{kind:'staff',available:async()=>true},posture),true);
 assert.equal(await liveAvailable(env,settings,{kind:'staff',available:async()=>false},posture),false);
 assert.equal(await liveAvailable(env,settings,{kind:'staff',available:async()=>{throw Error('x');}},posture),false);
 assert.equal(await staffLiveAvailable('ADMIN',{...env,NOREON_ZOE_VOICE_LIVE:'false'}),false);
});
await scenario('the routes are the shared handler, on the Node runtime, with route logging',()=>{
 for(const [path,ports] of [['app/api/patient/zoe/live-token/route.ts','memberLivePorts'],['app/api/staff/zoe/live-token/route.ts','staffLivePorts']]){
  const source=readFileSync(path,'utf8');
  assert.match(source,/export const runtime='nodejs'/);assert.match(source,new RegExp(`withRouteLogging\\(createLiveTokenHandler\\(${ports}\\)\\)`));
 }
 const ports=readFileSync('lib/zoe-chat-actions/live-token-http.ts','utf8');
 assert.match(ports,/rateLimit\('member_live'.*failClosed:true/);assert.match(ports,/rateLimit\('staff_live'.*failClosed:true/);
 assert.match(readFileSync('lib/security/rate-limit-core.ts','utf8'),/'member_live' \| 'staff_live'/);
 const browser=readFileSync('components/chat-v2/live-audio.ts','utf8');
 assert.ok(!/GEMINI_API_KEY|process\.env/.test(browser),'the browser never reads an API key');
 assert.ok(!/enqueueOutputPcm|createBufferSource|outputCtx/.test(browser),'no playback of model audio in the browser');
});
console.log('Live token: 401/403/429/503/400/413, no-store, exact response without key or prompt, locked text-only tool-free single-use token, model selection, layered availability and staff role coverage passed (injected ports, no network).');
