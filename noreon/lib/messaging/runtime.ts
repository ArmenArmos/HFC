import 'server-only';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
import {parseTwilioConfig,twilioAvailableChannels} from './twilio';
function providerConfig(env:Record<string,string|undefined>=process.env){
 return parseTwilioConfig({accountSid:env.NOREON_TWILIO_ACCOUNT_SID,authToken:env.NOREON_TWILIO_AUTH_TOKEN,apiKeySid:env.NOREON_TWILIO_API_KEY_SID,apiKeySecret:env.NOREON_TWILIO_API_KEY_SECRET,smsFrom:env.NOREON_TWILIO_SMS_FROM,whatsappFrom:env.NOREON_TWILIO_WHATSAPP_FROM,whatsappHyContentSid:env.NOREON_TWILIO_WHATSAPP_HY_CONTENT_SID,whatsappEnContentSid:env.NOREON_TWILIO_WHATSAPP_EN_CONTENT_SID,appUrl:env.NOREON_MESSAGE_APP_URL,callbackUrl:env.NOREON_TWILIO_CALLBACK_URL});
}
function databaseFactory(env:Record<string,string|undefined>=process.env){
 const url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.NOREON_MESSAGING_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error('unconfigured');
 return ()=>createClient<Database>(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
/** Resolve once, but create privileged clients only after request authorization. */
export function messageRuntime(){
 if(process.env.NOREON_TWILIO_CALLBACKS_ENABLED!=='true')return null;
 const config=providerConfig();if(!config.authToken)return null;
 return {config,db:databaseFactory()};
}
/** Database-only incident operations remain usable when callbacks are disabled. */
export function messageOperatorRuntime(needsProvider:boolean){
 if(process.env.NOREON_MESSAGE_OPERATIONS_ENABLED!=='true')throw Error('disabled');
 return {config:needsProvider?providerConfig():undefined,db:databaseFactory()};
}

export function configuredMessageChannels(env:Record<string,string|undefined>=process.env):Array<'sms'|'whatsapp'>{try{return twilioAvailableChannels(providerConfig(env),env);}catch{return [];}}

/** SMS dispatch/reconciliation do not require an account AuthToken or active callbacks. */
export function messageDispatchRuntime(env:Record<string,string|undefined>=process.env){
 if(env.NOREON_MESSAGE_DELIVERY_ENABLED!=='true'||env.NOREON_MESSAGE_RECOVERY_READY!=='true')return null;
 return {config:providerConfig(env),db:databaseFactory(env)};
}
