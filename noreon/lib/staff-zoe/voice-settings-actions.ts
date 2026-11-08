'use server';
import {z} from 'zod';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {readSchema,updateSchema,voiceSettingsPatchSchema,type VoiceSettingsRead,type VoiceSettingsSave} from './voice-settings-schema';

/**
 * Voice settings for the Noreon administrator (WP V), opened as a card in the admin chat. Reads and writes go through
 * voice_settings_admin_read / voice_settings_admin_update, which require an active administrator session in SQL, check
 * the version, bump it, and write the append-only voice_settings_events trail (registered in the unified audit).
 * Results are fixed codes; database messages never reach the browser.
 */

async function admin(){
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='admin')return null;
 return async(name:string,args:Record<string,unknown>)=>{const r=await client.rpc(name as never,args as never);if(r.error)throw Error(r.error.code==='42501'?'access':'Voice settings unavailable');return r.data as unknown;};
}

export const readVoiceSettingsAdmin=loggedAction('readVoiceSettingsAdmin',async function readVoiceSettingsAdmin():Promise<VoiceSettingsRead>{
 const rpc=await admin();
 if(!rpc)return {status:'access'};
 try{
  const r=readSchema.parse(await rpc('voice_settings_admin_read',{}));
  return r.ok?{status:'ok',settings:r.settings,history:r.history}:{status:'unavailable'};
 }catch(error){return {status:(error as Error).message==='access'?'access':'unavailable'};}
});

const saveInput=z.strictObject({requestId:z.uuid(),expectedVersion:z.number().int().positive(),patch:voiceSettingsPatchSchema});
export const updateVoiceSettingsAdmin=loggedAction('updateVoiceSettingsAdmin',async function updateVoiceSettingsAdmin(raw:unknown):Promise<VoiceSettingsSave>{
 const parsed=saveInput.safeParse(raw);
 if(!parsed.success)return {status:'invalid'};
 const rpc=await admin();
 if(!rpc)return {status:'access'};
 try{
  const r=updateSchema.parse(await rpc('voice_settings_admin_update',{p_request_id:parsed.data.requestId,p_expected_version:parsed.data.expectedVersion,p_patch:parsed.data.patch}));
  if(r.ok)return {status:r.changed?'saved':'unchanged',settings:r.settings};
  return r.code==='stale'?{status:'stale',...(r.settings?{settings:r.settings}:{})}:{status:r.code==='invalid'?'invalid':'unavailable'};
 }catch(error){return {status:(error as Error).message==='access'?'access':'unavailable'};}
});
