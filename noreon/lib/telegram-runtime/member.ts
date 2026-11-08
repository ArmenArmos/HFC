import 'server-only';
import {z} from 'zod';
import {createClient} from '@/lib/supabase/server';
import {telegramAuthEnabled,telegramAuthService} from '@/lib/telegram-auth/runtime';
import {telegramBotUsername,telegramEnabled} from './config';

/**
 * D3 consent for doctor replies in Telegram. UNAPPROVED DRAFT WORDING: the database
 * only turns on replies for the consent version seeded in telegram_channel_settings
 * by the activation migration, so this text cannot be used for a real link until the
 * privacy owner signs off and that version is seeded.
 */
export const TELEGRAM_CONSENT_VERSION='telegram-replies-draft-1';

const status=z.strictObject({ok:z.literal(true),available:z.boolean(),linked:z.boolean(),connected:z.boolean(),consentVersion:z.string().optional(),messagingReady:z.boolean().optional()});
const issued=z.union([z.strictObject({ok:z.literal(true),token:z.string().regex(/^[A-Za-z0-9_-]{32}$/),expiresAt:z.string()}),z.strictObject({ok:z.literal(false),code:z.enum(['unavailable','not_eligible','consent_required','rate_limited','invalid'])})]);
const unlinked=z.strictObject({ok:z.literal(true),unlinked:z.boolean()});

export type TelegramLinkView={state:'linked'|'not_linked'|'unavailable'|'not_ready';connected:boolean};
export type ConnectResult={ok:true;url:string;expiresAt:string}|{ok:false;reason:'unavailable'|'consent_required'|'rate_limited'|'error'};

/** Member's own link status through their authenticated session; null when the feature is off. */
export async function readTelegramLink():Promise<TelegramLinkView|null>{
 if(!telegramEnabled())return null;
 const client=await createClient();
 const {data,error}=await client.rpc('telegram_link_status');
 if(error)throw Error('Telegram status unavailable');
 const s=status.parse(data);
 // A link only works with the consent wording shown on this page.
 // "Sign-in codes" is shown only when Telegram codes are actually on.
 const connected=s.connected&&telegramAuthEnabled();
 // Messaging itself not switched on (no conversation policy): say so instead of "not connected" (QA M-02).
 if(!s.linked&&s.messagingReady===false)return {state:'not_ready',connected};
 if(!s.available||!telegramBotUsername())return {state:s.linked?'linked':'unavailable',connected};
 return {state:s.linked?'linked':'not_linked',connected};
}

/**
 * Opens a contact-proof challenge for the signed-in member and returns the t.me deep
 * link. In the bot the member shares their own number; when it matches the account's
 * phone, that Telegram account becomes their code channel and, with this consent,
 * replies are turned on (T-auth §1–2). The token is never stored here.
 */
export async function connectTelegram(consentVersion:unknown):Promise<ConnectResult>{
 const username=telegramBotUsername();
 if(!telegramEnabled()||!username)return {ok:false,reason:'unavailable'};
 void consentVersion;
 // The consent version comes from the channel settings, not a constant (QA M-02): consent itself
 // was given at enrolment; this records which channel wording the link was made under.
 const st=status.safeParse((await (await createClient()).rpc('telegram_link_status')).data);
 const version=st.success?st.data.consentVersion:undefined;
 if(!version)return {ok:false,reason:'unavailable'};
 const {data:{user}}=await (await createClient()).auth.getUser();
 if(!user?.phone)return {ok:false,reason:'unavailable'};
 const {data,error}=await telegramAuthService().rpc('telegram_auth_challenge_create',{p_purpose:'member_link',p_phone:`+${user.phone.replace(/^\+/,'')}`,p_user:user.id,p_consent_version:version,p_allow_replace:telegramAuthEnabled()});
 if(error)return {ok:false,reason:'error'};
 const result=issued.safeParse(data);
 if(!result.success)return {ok:false,reason:'error'};
 if(!result.data.ok)return {ok:false,reason:result.data.code==='rate_limited'||result.data.code==='consent_required'?result.data.code:'unavailable'};
 return {ok:true,url:`https://t.me/${username}?start=${result.data.token}`,expiresAt:result.data.expiresAt};
}

/** Member pressed "Turn on replies": link the sign-in chat again, overriding their earlier turn-off. */
export async function enableTelegramReplies():Promise<{ok:true}|{ok:false;reason:'linked_elsewhere'|'error'}>{
 if(!telegramEnabled()||!telegramAuthEnabled())return {ok:false,reason:'error'};
 const {data,error}=await (await createClient()).rpc('telegram_replies_auto_link',{p_explicit:true});
 const r=z.union([z.object({ok:z.literal(true)}),z.object({ok:z.literal(false),code:z.string()})]).safeParse(data);
 if(error||!r.success)return {ok:false,reason:'error'};
 return r.data.ok?{ok:true}:{ok:false,reason:r.data.code==='principal_linked_elsewhere'?'linked_elsewhere':'error'};
}

export async function disconnectTelegram():Promise<{ok:boolean}>{
 if(!telegramEnabled())return {ok:false};
 const client=await createClient();
 const {data,error}=await client.rpc('telegram_unlink');
 if(error)return {ok:false};
 return {ok:unlinked.safeParse(data).success};
}

/** Removes the Telegram account as the member's code channel: every session ends, this one too (T-auth §4). */
export async function removeTelegramAccount():Promise<{ok:boolean}>{
 if(!telegramAuthEnabled())return {ok:false};
 const client=await createClient();
 const {data,error}=await client.rpc('telegram_auth_unlink');
 if(error||!z.object({ok:z.literal(true)}).safeParse(data).success)return {ok:false};
 await client.auth.signOut({scope:'local'}).catch(()=>null);
 return {ok:true};
}
