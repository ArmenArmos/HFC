import 'server-only';
import type {PatientLocale} from '@/lib/patient/copy';
import {nurseChatV2Enabled} from '@/lib/nurse-chat/config';
import {doctorChatV2Enabled} from './workspace-config';
import {voiceProviderAvailable,validVoiceAudio,voiceTranscripts} from '@/lib/zoe-chat-actions/voice';
import {synthesizeVoiceSpeech} from '@/lib/zoe-chat-actions/speech';
import {readVoiceSettings,type VoiceSettings} from '@/lib/zoe-chat-actions/voice-settings';
import type {VoiceAudio,VoiceTranscripts} from '@/lib/zoe-chat-actions/voice-contract';
import {urgentDecision} from '@/lib/zoe/urgent-test';
import {adminChatEnabled} from '@/lib/admin-chat/config';
import {clinicChatEnabled} from '@/lib/clinic-chat/config';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import type {AppRole} from '@/lib/rbac/roles';
type Env=Record<string,string|undefined>;
/**
 * Every staff role from lib/rbac has voice (WP V): the nurse and both physician specialties in their chats, the care
 * coordinator on the care queue, the Noreon administrator in the operations chat and the clinic administrator in the
 * clinic chat. Each role's voice follows its own surface switch, plus the shared provider posture and settings.
 */
export const STAFF_VOICE_ROLES=['NURSE','DOCTOR','COORDINATOR','ADMIN','CLINIC_ADMIN']as const;
export type StaffVoiceRole=typeof STAFF_VOICE_ROLES[number];
const VOICE_ROLE_OF:Readonly<Partial<Record<AppRole,StaffVoiceRole>>>={nurse:'NURSE',family_physician:'DOCTOR',cardiologist:'DOCTOR',care_coordinator:'COORDINATOR',noreon_admin:'ADMIN',clinic_admin:'CLINIC_ADMIN'};
/** The voice surface of an application role; null for member and caregiver (they use the member routes). */
export const staffVoiceRole=(role:AppRole):StaffVoiceRole|null=>VOICE_ROLE_OF[role]??null;
/** The voice surface of a workspace staff identity (real_clinical_staff_identity role and specialty). */
export function staffVoiceRoleOf(role:string,specialty?:string|null):StaffVoiceRole|null{
 if(role==='nurse')return 'NURSE';
 if(role==='doctor')return specialty===undefined||specialty===null||specialty==='family_physician'||specialty==='cardiologist'?'DOCTOR':null;
 if(role==='coordinator')return 'COORDINATOR';
 if(role==='admin')return 'ADMIN';
 if(role==='clinic_admin')return 'CLINIC_ADMIN';
 return null;
}
const surfaceOn:Readonly<Record<StaffVoiceRole,(env:Env)=>boolean>>={
 NURSE:env=>nurseChatV2Enabled(env),DOCTOR:env=>doctorChatV2Enabled(env),COORDINATOR:env=>zoeAppV3Enabled(env),
 ADMIN:env=>adminChatEnabled(env),CLINIC_ADMIN:env=>clinicChatEnabled(env),
};
/** Staff surface flags plus the same provider posture/settings as member voice. */
export async function staffVoiceAvailable(role:StaffVoiceRole,env:Env=process.env,settings?:Pick<VoiceSettings,'enabled'>,load:()=>Promise<typeof import('@/lib/zoe/gateway')>=()=>import('@/lib/zoe/gateway')){
 if(!STAFF_VOICE_ROLES.includes(role)||!surfaceOn[role](env))return false;
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
/** WP V: Gemini Live streaming transcription for this staff role's surface (the role's voice gates plus the Live gates). */
export async function staffLiveAvailable(role:StaffVoiceRole,env:Env=process.env){
 const {liveAvailable}=await import('@/lib/zoe-chat-actions/voice-live');
 return liveAvailable(env,undefined,{kind:'staff',available:()=>staffVoiceAvailable(role,env)});
}
