'use server';
import {cookies} from 'next/headers';
import {revalidatePath} from 'next/cache';
import {loggedAction} from '@/lib/observability/with-logging';
import {setZoeConsent} from '@/lib/zoe/member';
import {ZOE_PROMPT_LATER_COOKIE} from '@/lib/zoe/consent-prompt';
export const changeZoeConsent=loggedAction("changeZoeConsent",async function changeZoeConsent(kind:unknown,granted:unknown){return setZoeConsent(kind,granted);});

/** "OK" on the one-time Home card: a grant to Zoe reading messages, recorded as source 'prompt'. */
export const acceptZoePrompt=loggedAction("acceptZoePrompt",async function acceptZoePrompt(){
 const r=await setZoeConsent('zoe_reads_messages',true,'prompt');
 if(r.ok)revalidatePath('/patient','layout');
 return {ok:r.ok};
});

/** "Agree and turn on" on the Zoe chat screen: the same grant, recorded as source 'zoe_screen'. */
export const acceptZoeFromChat=loggedAction("acceptZoeFromChat",async function acceptZoeFromChat(){
 const r=await setZoeConsent('zoe_reads_messages',true,'zoe_screen');
 if(r.ok)revalidatePath('/patient','layout');
 return {ok:r.ok};
});

/** "Not now" records nothing: it only hides the card on this device for a day. */
export const postponeZoePrompt=loggedAction("postponeZoePrompt",async function postponeZoePrompt(){
 (await cookies()).set(ZOE_PROMPT_LATER_COOKIE,'1',{maxAge:60*60*24,httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/patient'});
 return {ok:true};
});
