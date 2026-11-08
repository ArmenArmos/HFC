'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {rateLimit} from '@/lib/security/rate-limit';
import {redeemSigninLink,type SigninLinkResult} from '@/lib/telegram-auth/signin-link';
export const continueTelegramLink=loggedAction("continueTelegramLink",async function continueTelegramLink(token:unknown,captchaToken:unknown,switchAccount?:unknown):Promise<SigninLinkResult>{
 if(typeof token!=='string')return {ok:false,reason:'expired'};
 // Link tokens are unguessable; this only stops one network hammering Auth through this page.
 try{if(!(await rateLimit('member_link',[{kind:'source'}])).ok)return {ok:false,reason:'busy'};}
 catch{return {ok:false,reason:'unavailable'};}
 return redeemSigninLink(token,typeof captchaToken==='string'?captchaToken:undefined,{switchAccount:switchAccount===true});
});
