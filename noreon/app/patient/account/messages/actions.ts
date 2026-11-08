'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {saveMessagePreference} from '@/lib/messaging/server';
export const changeMessagePreference=loggedAction("changeMessagePreference",async function changeMessagePreference(input:unknown){
 const result=await saveMessagePreference(input);
 if(result.ok)revalidatePath('/patient/account/messages');
 return result;
});
