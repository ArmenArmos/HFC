/** Local-only voice boundary checks. No credentials, database, network or member data. */
import assert from 'node:assert/strict';
import { transcribe, voiceAvailable } from '@/lib/zoe-chat-actions/voice';
import { VOICE_MAX_BYTES, VOICE_MAX_MS } from '@/lib/zoe-chat-actions/voice-contract';
const enabled = { NODE_ENV: 'test', NOREON_ZOE_APP_V3: 'true', NOREON_MEMBER_CHAT_V2: 'true', NOREON_ZOE_VOICE_PROVIDER: 'fake' };
const audio = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/mp4', durationMs: 1500 };
for (const env of [{}, {...enabled, NOREON_MEMBER_CHAT_V2: undefined}, {...enabled, NOREON_MEMBER_CHAT_V2: 'false'}, {...enabled, NOREON_ZOE_APP_V3: undefined}, {...enabled, NOREON_ZOE_APP_V3: 'false'}, {...enabled, NOREON_ZOE_VOICE_PROVIDER: 'unknown'}, {...enabled, NODE_ENV: 'production'}]) {
  assert.equal(await voiceAvailable(env), false);
  assert.deepEqual(await transcribe(audio, 'en', env), {status:'unavailable'});
}
assert.equal(await voiceAvailable(enabled), true);
for (const locale of ['hy', 'en', 'ru'] as const) assert.deepEqual(await transcribe(audio, locale, enabled), {status:'ok',text:'145/92',urgent:false,transcripts:{primary:'145/92',urgent:null}});
for (const bad of [
  {...audio,bytes:new Uint8Array()}, {...audio,bytes:new Uint8Array(VOICE_MAX_BYTES+1)},
  {...audio,durationMs:0}, {...audio,durationMs:VOICE_MAX_MS+1}, {...audio,durationMs:NaN},
  {...audio,mimeType:'text/plain'},
]) assert.deepEqual(await transcribe(bad, 'en', enabled), {status:'invalid'});
assert.deepEqual(await transcribe(audio, 'fr' as 'en', enabled), {status:'invalid'});
console.log('Voice provider gates, locales, size and duration limits passed');

const gateway = {...enabled,NODE_ENV:'production',NOREON_ZOE_VOICE_PROVIDER:'gateway',VERCEL:'1',NOREON_ZOE_MODEL_CALLS_ENABLED:'true'};
assert.equal(await voiceAvailable(gateway,{enabled:false}),false,'Settings switch disables gateway');
assert.equal(await voiceAvailable(gateway,{enabled:true}),true,'Gateway allowed in a production build');
assert.equal(await voiceAvailable(gateway,{enabled:true},async()=>{throw Error('synthetic import failure');}),false,'A failing gateway import reads as unavailable, not as an exception');
assert.equal(await voiceAvailable(gateway,undefined,async()=>({gatewayConfigured:()=>true,zoeModelCallsEnabled:()=>true,realCallsBasis:()=>'staging'}) as never),false,'Settings read without a row never enables voice');
for (const off of [{VERCEL:undefined},{NOREON_ZOE_MODEL_CALLS_ENABLED:'false'},{NOREON_AI_WITHOUT_DPA_CONFIRMATION:'false'},{NOREON_ZOE_VOICE_PROVIDER:'Gateway'},{NOREON_MEMBER_CHAT_V2:'false'},{NOREON_ZOE_APP_V3:'false'}]) {
 assert.equal(await voiceAvailable({...gateway,...off},{enabled:true}),false);
}
console.log('Gateway production posture, credentials and settings matrix passed');
