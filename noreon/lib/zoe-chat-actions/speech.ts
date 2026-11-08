import 'server-only';
import type {PatientLocale} from '@/lib/patient/copy';
import {voiceAvailable} from './voice';
import {readVoiceSettings} from './voice-settings';

export async function synthesize(text:string,locale:PatientLocale,signal:AbortSignal,load:()=>Promise<typeof import('./voice-providers/gateway')>=()=>import('./voice-providers/gateway')){
  if(!text.trim()||text.length>1200||!['hy','ru','en'].includes(locale))return {status:'unavailable' as const};
  const settings=await readVoiceSettings();
  if(!await voiceAvailable(process.env,settings)||process.env.NOREON_ZOE_VOICE_PROVIDER!=='gateway')return {status:'unavailable' as const};
  try{
    return await synthesizeVoiceSpeech(text,locale,settings,signal,load);
  }catch{return {status:'unavailable' as const};}
}

/** Shared provider call; the caller enforces its own chat surface and provider posture first. */
export async function synthesizeVoiceSpeech(text:string,locale:PatientLocale,settings:import('./voice-settings').VoiceSettings,signal:AbortSignal,load:()=>Promise<typeof import('./voice-providers/gateway')>=()=>import('./voice-providers/gateway')){
 if(!text.trim()||text.length>1200||!['hy','ru','en'].includes(locale))return {status:'unavailable' as const};
 try{
  const {generateVoiceSpeech}=await load();
  const audio=await generateVoiceSpeech(text,locale,settings,signal);
  return audio?{status:'ok' as const,...audio}:{status:'unavailable' as const};
 }catch{return {status:'unavailable' as const};}
}
