import 'server-only';
import {configuredMessageChannels} from './runtime';
import {createHash} from 'node:crypto';
import {createClient} from '@/lib/supabase/server';
import {authServiceUnavailable} from '@/lib/supabase/auth-availability';
import {parseLocale} from '@/lib/locale';
import {MESSAGE_CONSENT_VERSION,messageChannel,messagePreferenceInput,normalizedPhone,type MessageSettings,type SaveMessageResult} from './preferences';
export function messageIdentityContext(user:{id:string;phone?:string;phone_confirmed_at?:string}){return createHash('sha256').update(JSON.stringify([user.id,normalizedPhone(user.phone),user.phone_confirmed_at??null])).digest('hex');}
export class MessageSettingsUnauthorized extends Error{}
export async function readMessageSettings():Promise<MessageSettings>{
 const client=await createClient();const {data:{user},error}=await client.auth.getUser();
 if(authServiceUnavailable(error))throw Error('Auth temporarily unavailable');
 if(error||!user)throw new MessageSettingsUnauthorized();
 const [saved,profile,consent]=await Promise.all([
  client.from('patient_message_preferences').select('channel,revision,verified_phone').maybeSingle(),
  client.from('profiles').select('locale,ui_locale,display_name,birth_date,biological_sex').maybeSingle(),
  client.from('patient_consents').select('version').eq('version','patient-pilot-v1').maybeSingle(),
 ]);
 if(saved.error||profile.error||consent.error)throw Error('Message settings unavailable');
 const phone=normalizedPhone(user.phone),verified=!!phone&&!!user.phone_confirmed_at;
 const eligible=verified&&!!profile.data?.display_name?.trim()&&!!profile.data.birth_date&&!!profile.data.biological_sex&&!!consent.data;
 const channel=messageChannel.parse(saved.data?.channel??'none');
 return {mode:'member',context:messageIdentityContext(user),locale:parseLocale(profile.data?.ui_locale??profile.data?.locale,'hy'),channel,revision:saved.data?.revision??0,
  maskedPhone:verified?`•••• ${phone!.slice(-4)}`:null,canOptIn:eligible,availableChannels:configuredMessageChannels(),
  needsReconfirmation:channel!=='none'&&(!eligible||saved.data?.verified_phone!==phone),deliveryEnabled:false};
}
export async function saveMessagePreference(input:unknown):Promise<SaveMessageResult>{
 const parsed=messagePreferenceInput.safeParse(input);
 if(!parsed.success)return {ok:false,reason:'invalid'};
 if(parsed.data.channel!=='none'&&!parsed.data.consent)return {ok:false,reason:'consent-required'};
 try{
  const client=await createClient();const {data:{user},error:identityError}=await client.auth.getUser();
  if(identityError||!user)return {ok:false,reason:'unauthorized'};
  if(parsed.data.context!==messageIdentityContext(user))return {ok:false,reason:'account-changed'};
  if(parsed.data.channel!=='none'&&!configuredMessageChannels().includes(parsed.data.channel))return {ok:false,reason:'unavailable'};
  const {data,error}=await client.rpc('save_patient_message_preferences_for_phone',{p_channel:parsed.data.channel,p_expected_revision:parsed.data.expectedRevision,p_consent_version:MESSAGE_CONSENT_VERSION,p_expected_phone:normalizedPhone(user.phone)??''});
  if(error)return {ok:false,reason:error.message==='phone changed'?'account-changed':error.message==='verified membership required'?'ineligible':error.message==='too many preference changes'?'rate-limited':'unavailable'};
  if(data===-1)return {ok:false,reason:'conflict'};
  if(!Number.isInteger(data)||data<1)return {ok:false,reason:'unavailable'};
  return {ok:true,revision:data,channel:parsed.data.channel};
 }catch{return {ok:false,reason:'unavailable'};}
}
