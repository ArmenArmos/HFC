import 'server-only';
import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';

export const DEFAULT_VOICE_SETTINGS = Object.freeze({
  enabled:false,
  stt_model:'google/gemini-2.5-pro',
  stt_urgent_model:'elevenlabs/scribe-v2',
  tts_model:'google/gemini-3.8-flash-tts',
  tts_voice:'Kore',
  tts_instructions:'Speak calmly, warmly and with care. Use Eastern Armenian by default and the polite Դուք form. If the text is Russian or English, speak that language. Use short, natural sentences. Say numbers naturally; blood pressure as the upper and lower number. Never read symbols, lists or codes aloud. Never rush.',
  version:1,
});
const model=z.string().trim().min(1).max(160);
const schema=z.object({enabled:z.boolean(),stt_model:model,stt_urgent_model:model,tts_model:model,
  tts_voice:z.string().trim().min(1).max(80),tts_instructions:z.string().trim().min(1).max(599),version:z.number().int().positive()});
export type VoiceSettings=z.infer<typeof schema>;

/** Cache configuration only, never member text or audio. Unsuccessful reads disable voice for 30 seconds. */
export function createVoiceSettingsReader(load:()=>Promise<unknown>,now=Date.now){
  let cached:VoiceSettings=DEFAULT_VOICE_SETTINGS,expires=0;
  let pending:Promise<VoiceSettings>|undefined;
  return async():Promise<VoiceSettings>=>{
    if(now()<expires)return cached;
    if(pending)return pending;
    pending=(async()=>{
      try{
        const row=await load(),parsed=schema.safeParse(row);
        cached=parsed.success?parsed.data:DEFAULT_VOICE_SETTINGS;
      }
      catch{cached=DEFAULT_VOICE_SETTINGS;}
      expires=now()+30_000;
      return cached;
    })();
    try{return await pending;}finally{pending=undefined;}
  };
}

export const readVoiceSettings=createVoiceSettingsReader(async()=>{
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return null;
  // Runtime schema validation keeps a missing/unmigrated table on the documented fallback.
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await (client as unknown as {from:(table:string)=>{select:(columns:string)=>{eq:(column:string,value:boolean)=>{maybeSingle:()=>{abortSignal:(signal:AbortSignal)=>PromiseLike<{data:unknown;error:unknown}>}}}}}).from('voice_settings').select('enabled,stt_model,stt_urgent_model,tts_model,tts_voice,tts_instructions,version').eq('id',true).maybeSingle().abortSignal(AbortSignal.timeout(2000));
  return error?null:data;
});
