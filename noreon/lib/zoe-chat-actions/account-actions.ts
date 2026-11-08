'use server';
import {z} from 'zod';
import {loggedAction} from '@/lib/observability/with-logging';
import {memberChatOnlyEnabled} from '@/lib/patient/member-chat-config';
import {saveProfile} from '@/app/patient/actions';
import {saveLanguagePreference} from '@/app/patient/account/locale-actions';
import {saveReminderPreferences} from '@/app/patient/care/actions';
import type {ProfileInput,SaveResult} from '@/lib/patient/types';
import {sessionActor,noActor} from './actor';
import {readZoeCard,claimCard,recordCard} from './server';
import {readAccountSettings,type AccountSettings} from './account-read';
import {runAccountSave,type AccountCardResult} from './account';
import type {CardActionResult} from './registry';
export const readAccountSettingsFromCard=loggedAction('readAccountSettingsFromCard',async function readAccountSettingsFromCard(cardId:unknown):Promise<{status:'ok';data:AccountSettings}|{status:Exclude<CardActionResult['status'],'ok'>}>{
 if(!memberChatOnlyEnabled())return {status:'disabled'};
 if(!z.uuid().safeParse(cardId).success)return {status:'invalid'};
 if(!await sessionActor())return noActor();
 const card=await readZoeCard(cardId as string);
 if(!card?.valid||card.kind!=='account')return {status:'invalid'};
 if(card.state==='done')return {status:'closed'};
 const data=await readAccountSettings();
 if(card.snapshot.token!==data.token)return {status:'stale'};
 return {status:'ok',data};
});
const input=z.strictObject({cardId:z.uuid(),opId:z.uuid(),kind:z.enum(['profile','language','reminders']),input:z.unknown(),expectedRevision:z.number().int().min(0).max(2147483646),consent:z.boolean().optional()});
export const saveAccountFromCard=loggedAction('saveAccountFromCard',async function saveAccountFromCard(raw:unknown):Promise<AccountCardResult>{
 if(!memberChatOnlyEnabled())return {status:'disabled'};
 const parsed=input.safeParse(raw);
 if(!parsed.success)return {status:'invalid'};
 const who=await sessionActor();
 if(!who)return noActor();
 return runAccountSave(who,{readCard:readZoeCard,claim:claimCard,record:recordCard,currentToken:async()=>(await readAccountSettings()).token,
 execute:async (value):Promise<SaveResult>=>{
  if(value.kind==='profile'){
   const result=await saveProfile(value.input as ProfileInput,value.consent===true,value.expectedRevision);
   return result.ok&&'revision' in result?{ok:true,revision:result.revision}:{ok:false,reason:'reason' in result?result.reason:'unavailable'};
  }
  if(value.kind==='reminders')return saveReminderPreferences(value.input,value.expectedRevision);
  const locale=z.strictObject({locale:z.enum(['hy','en','ru']),expectedLocale:z.enum(['hy','en','ru'])}).safeParse(value.input);
  return locale.success?saveLanguagePreference({...locale.data,expectedRevision:value.expectedRevision}):{ok:false,reason:'invalid'};
 }},parsed.data);
});
