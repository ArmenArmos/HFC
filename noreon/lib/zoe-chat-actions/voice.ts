import 'server-only';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import type {PatientLocale} from '@/lib/patient/copy';
import {isZoeEmergency,couldBeZoeEmergency} from '@/lib/zoe/member-screen';
import {VOICE_MAX_BYTES,VOICE_MAX_MS,type VoiceAudio,type VoiceResult,type VoiceTranscripts} from './voice-contract';
import {readVoiceSettings,type VoiceSettings} from './voice-settings';
type Env=Record<string,string|undefined>;
export interface SpeechProvider {
  transcribe(audio:VoiceAudio,locale:PatientLocale,signal:AbortSignal):Promise<VoiceTranscripts>;
}
export async function voiceAvailable(env:Env=process.env,settings?:Pick<VoiceSettings,'enabled'>,load:()=>Promise<typeof import('@/lib/zoe/gateway')>=()=>import('@/lib/zoe/gateway')):Promise<boolean>{
  if(!zoeAppV3Enabled(env)||env.NOREON_MEMBER_CHAT_V2!=='true')return false;
  return voiceProviderAvailable(env,settings,load);
}

/** Provider posture and the shared settings switch, independent of the calling chat surface. */
export async function voiceProviderAvailable(env:Env=process.env,settings?:Pick<VoiceSettings,'enabled'>,load:()=>Promise<typeof import('@/lib/zoe/gateway')>=()=>import('@/lib/zoe/gateway')):Promise<boolean>{
  if(env.NOREON_ZOE_VOICE_PROVIDER==='fake')return env.NODE_ENV!=='production'&&settings?.enabled!==false;
  if(env.NOREON_ZOE_VOICE_PROVIDER!=='gateway')return false;
  // An unloadable gateway module or settings read is "unavailable", never an exception into the chat page.
  try{
    const {gatewayConfigured,realCallsBasis,zoeModelCallsEnabled}=await load();
    if(!gatewayConfigured(env)||!zoeModelCallsEnabled(env)||!realCallsBasis(env))return false;
    return (settings??await readVoiceSettings()).enabled===true;
  }catch{return false;}
}

/** Shared deterministic screening, with the chat's conservative presentation fallback for unknown intake. */
export function screenVoiceTranscripts(transcripts:VoiceTranscripts,intake:{enabled:boolean;active:boolean}|null,env:Env=process.env){
  const check={env:Object.fromEntries(Object.entries(env).filter((entry):entry is [string,string]=>typeof entry[1]==='string')),intake};
  const hits=(text:string|null)=>!!text&&(intake===null?couldBeZoeEmergency(text,check):isZoeEmergency(text,check));
  const primaryRed=hits(transcripts.primary),urgentRed=hits(transcripts.urgent);
  const text=urgentRed&&!primaryRed?transcripts.urgent:transcripts.primary;
  return text?{text,urgent:primaryRed||urgentRed}:null;
}

/** Shared transport validation for member and staff recordings. */
export function validVoiceAudio(audio:VoiceAudio,locale:PatientLocale):boolean{
 return ['hy','en','ru'].includes(locale)&&audio.bytes.byteLength>0&&audio.bytes.byteLength<=VOICE_MAX_BYTES
  &&Number.isFinite(audio.durationMs)&&audio.durationMs>0&&audio.durationMs<=VOICE_MAX_MS
  &&['audio/mp4','audio/webm'].includes(audio.mimeType.split(';')[0].trim().toLowerCase());
}
export async function voiceTranscripts(audio:VoiceAudio,locale:PatientLocale,signal:AbortSignal,env:Env=process.env){
 const provider=env.NOREON_ZOE_VOICE_PROVIDER==='fake'?(await import('./voice-providers/fake')).fakeSpeechProvider
  :(await import('./voice-providers/gateway')).gatewaySpeechProvider(await readVoiceSettings());
 return provider.transcribe(audio,locale,signal);
}

/** In-memory only. Authentication and the upload limiter run before reading the HTTP body. */
export async function transcribe(audio:VoiceAudio,locale:PatientLocale,env:Env=process.env):Promise<VoiceResult & {transcripts?:VoiceTranscripts}>{
  if(!await voiceAvailable(env))return {status:'unavailable'};
  if(!validVoiceAudio(audio,locale))return {status:'invalid'};
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    // The adapter bounds each engine. This shared budget also bounds the subsequent context read.
    const deadline=new Promise<null>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},15_000);});
    const transcripts=await voiceTranscripts(audio,locale,controller.signal,env);
    // Known lexical emergencies never wait for an intake RPC. Both engine hashes remain in the receipt.
    const lexical=screenVoiceTranscripts(transcripts,{enabled:false,active:false},env);
    if(lexical?.urgent)return {status:'ok',...lexical,transcripts};
    // Read only the authenticated member's context, within the same turn budget.
    const intake=env.NOREON_ZOE_VOICE_PROVIDER==='fake'?null:await Promise.race([
      import('@/lib/zoe/app-chat').then(m=>m.readIntakeState()).catch(()=>null),deadline,
    ]);
    const screened=screenVoiceTranscripts(transcripts,intake,env);
    return screened?{status:'ok',...screened,transcripts}:{status:'unavailable'};
  }catch{return {status:'unavailable'};}
  finally{clearTimeout(timer);controller.abort();}
}
