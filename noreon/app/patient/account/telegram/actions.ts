'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {connectTelegram,disconnectTelegram,enableTelegramReplies,removeTelegramAccount} from '@/lib/telegram-runtime/member';
export const startTelegramLink=loggedAction("startTelegramLink",async function startTelegramLink(consentVersion:unknown){return connectTelegram(consentVersion);});
export const stopTelegramLink=loggedAction("stopTelegramLink",async function stopTelegramLink(){
 const result=await disconnectTelegram();
 if(result.ok)revalidatePath('/patient/account/telegram');
 return result;
});
export const forgetTelegramAccount=loggedAction("forgetTelegramAccount",async function forgetTelegramAccount(){return removeTelegramAccount();});
export const turnOnTelegramReplies=loggedAction("turnOnTelegramReplies",async function turnOnTelegramReplies(){
 const result=await enableTelegramReplies();
 if(result.ok)revalidatePath('/patient/account/telegram');
 return result;
});
