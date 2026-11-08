import 'server-only';
import type {PatientLocale} from '@/lib/patient/copy';
import {nurseChatV2Enabled} from '@/lib/nurse-chat/config';
import {doctorChatV2Enabled} from './workspace-config';
import {voiceProviderAvailable,validVoiceAudio,voiceTranscripts} from '@/lib/zoe-chat-actions/voice';
import {synthesizeVoiceSpeech} from '@/lib/zoe-chat-actions/speech';
import {readVoiceSettings,type VoiceSettings} from '@/lib/zoe-chat-actions/voice-settings';
import type {VoiceAudio,VoiceTranscripts} from '@/lib/zoe-chat-actions/voice-contract';
import {urgentDecision} from '@/lib/zoe/urgent-test';
type Env=Record<string,string|undefined>;
export type StaffVoiceRole='NURSE'|'DOCTOR';
/** Staff surface flags plus the same provider posture/settings as member voice. */
export async function staffVoiceAvailable(role:StaffVoiceRole,env:Env=process.env,settings?:Pick<VoiceSettings,'enabled'>,load:()=>Promise<typeof import('@/lib/zoe/gateway')>=()=>import('@/lib/zoe/gateway')){
 if(role==='NURSE'?!nurseChatV2Enabled(env):role==='DOCTOR'?!doctorChatV2Enabled(env):true)return false;
 return voiceProviderAvailable(env,settings,load);
}
/** A lexical Armenian secondary hit is ordinary staff text, never a member emergency/card decision. */
export function selectStaffTranscript(transcripts:VoiceTranscripts,locale:PatientLocale,env:Env=process.env):string|null{
 if(locale==='hy'&&transcripts.urgent&&urgentDecision(transcripts.urgent,env).outcome==='escalate')return transcripts.urgent;
 return transcripts.primary;
}
export type StaffTranscriptionResult={status:'ok';text:string;transcripts:VoiceTranscripts}|{status:'invalid'|'unavailable'};
export async function transcribeStaffVoice(role:StaffVoiceRole,audio:VoiceAudio,locale:PatientLocale,env:Env=process.env):Promise<StaffTranscriptionResult>{
 if(!await staffVoiceAvailable(role,env))return {status:'unavailable'};
 if(!validVoiceAudio(audio,locale))return {status:'invalid'};
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const timeout=new Promise<null>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},15_000);});
  const transcripts=await Promise.race([voiceTranscripts(audio,locale,controller.signal,env),timeout]);
  if(!transcripts)return {status:'unavailable'};
  const text=selectStaffTranscript(transcripts,locale,env);
  return text?{status:'ok',text,transcripts}:{status:'unavailable'};
 }catch{return {status:'unavailable'};}
 finally{clearTimeout(timer);controller.abort();}
}
export async function synthesizeStaffVoice(role:StaffVoiceRole,text:string,locale:PatientLocale,signal:AbortSignal,env:Env=process.env){
 if(!text.trim()||text.length>1200||!['hy','en','ru'].includes(locale)||env.NOREON_ZOE_VOICE_PROVIDER!=='gateway')return {status:'unavailable' as const};
 try{
  const settings=await readVoiceSettings();
  if(!await staffVoiceAvailable(role,env,settings))return {status:'unavailable' as const};
  return await synthesizeVoiceSpeech(text,locale,settings,signal);
 }catch{return {status:'unavailable' as const};}
}
