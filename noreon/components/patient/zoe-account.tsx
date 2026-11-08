'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {SignOutButton} from './sign-out-button';
import {TextSizePreference} from './text-size-preference';
import {ZoeConsents} from './zoe-consents';
import {ProfileForm} from './profile-form';
import {LanguagePreference} from './language-preference';
import {ReminderSettings} from '@/components/patient-care/reminder-settings';
import {MessagePreferences} from '@/components/messaging/message-settings';
import {Button} from '@/components/ui/button';
import {copy} from '@/components/patient-care/common';
import {readAccountSettingsFromCard,saveAccountFromCard} from '@/lib/zoe-chat-actions/account-actions';
import type {AccountSettings} from '@/lib/zoe-chat-actions/account-read';
import type {AccountSave} from '@/lib/zoe-chat-actions/account';
import type {PatientLocale} from '@/lib/patient/copy';
import type {SaveResult} from '@/lib/patient/types';
import type {ValidCard,ZoeCard} from '@/lib/zoe-chat-actions/registry';
export type AccountSection='profile'|'language'|'reminders'|'messages'|'text-size'|'privacy';
/** Reuses the account forms and their validation. A save seals every section until current settings are opened. */
export function ZoeAccount({card,locale:l,onCard,initialSection='profile'}:{initialSection?:AccountSection;card:Extract<ValidCard,{kind:'account'}>;locale:PatientLocale;onCard:(card:ZoeCard)=>void}){
 const [data,setData]=useState<AccountSettings|null>(null);
 const [status,setStatus]=useState('loading');
 const router=useRouter();
 const [selection,setSelection]=useState({requested:initialSection,section:initialSection});
 const section=selection.requested===initialSection?selection.section:initialSection;
 const [busy,setBusy]=useState(false),[settled,setSettled]=useState<SaveResult|null>(null);
 const sending=useRef(false),sealed=useRef(false);
 useEffect(()=>{
  let active=true;
  if(card.state==='done')return;
  void readAccountSettingsFromCard(card.id).then(r=>{if(active){setStatus(r.status);if(r.status==='ok')setData(r.data);}}).catch(()=>{if(active)setStatus('unavailable');});
  return ()=>{active=false;};
 },[card.id,card.state]);
 const perform=async(value:Omit<AccountSave,'cardId'|'opId'>):Promise<SaveResult>=>{
  if(sending.current||sealed.current)return {ok:false,reason:'conflict'};
  sending.current=true;setBusy(true);
  let result:SaveResult;
  try{
   const r=await saveAccountFromCard({...value,cardId:card.id,opId:crypto.randomUUID()});
   result=r.result??{ok:false,reason:r.status==='stale'||r.status==='closed'?'conflict':'unavailable'};
   // Propagate the recorded outcome so the chat can refresh current settings.
   if(r.card)onCard(r.card);
  }catch{result={ok:false,reason:'unavailable'};}
  sealed.current=true;sending.current=false;setBusy(false);setSettled(result);
  return result;
 };
 if(card.state==='done'||card.outcome.account)return <p role="status" className="text-body2">{copy(l,'This card is closed. Show current details before continuing.','Այս քարտը փակված է։ Շարունակելուց առաջ ցուցադրեք ընթացիկ տվյալները։','Эта карточка закрыта. Прежде чем продолжить, откройте актуальные данные.')}</p>;
 if(!data)return <p role="status" className="text-body2">{status==='loading'?copy(l,'Loading your settings…','Բեռնվում են ձեր կարգավորումները…','Загружаем ваши настройки…'):status==='stale'?copy(l,'Your settings changed. Show current details before continuing.','Ձեր կարգավորումները փոխվել են։ Շարունակելուց առաջ ցուցադրեք ընթացիկ տվյալները։','Ваши настройки изменились. Прежде чем продолжить, откройте актуальные данные.'):copy(l,'Your settings could not be loaded. Show current details to try again.','Ձեր կարգավորումները չհաջողվեց բեռնել։ Կրկին փորձելու համար ցուցադրեք ընթացիկ տվյալները։','Не удалось загрузить ваши настройки. Откройте актуальные данные, чтобы попробовать снова.')}</p>;
 const refreshSection=(section:AccountSection)=>{
  // Independent settings actions changed this snapshot token. Keep old controls sealed until the current card arrives.
  sealed.current=true;setSettled({ok:true,revision:data.assessment.revision});
  const handled=!window.dispatchEvent(new CustomEvent('noreon:member-account-open',{cancelable:true,detail:{section}}));
  if(!handled)router.refresh();
 };
 const choices=[['profile',copy(l,'Your details','Ձեր տվյալները','Ваши данные')],['language',copy(l,'Language','Լեզու','Язык')],['reminders',copy(l,'Reminders','Հիշեցումներ','Напоминания')],['messages',copy(l,'Messages','Հաղորդագրություններ','Сообщения')],['text-size',copy(l,'Text size','Տեքստի չափը','Размер текста')],['privacy',copy(l,'Privacy and consents','Գաղտնիություն և համաձայնություններ','Конфиденциальность и согласия')]] as const;
 return <div className="min-w-0 space-y-4" data-zoe-account>
  <div role="group" aria-label={copy(l,'Your settings','Ձեր կարգավորումները','Ваши настройки')} className="grid grid-cols-2 gap-2">
   {choices.map(([id,label])=><Button key={id} type="button" variant={section===id?'default':'outline'} aria-pressed={section===id} disabled={busy||!!settled} onClick={()=>setSelection({requested:initialSection,section:id})} className="h-auto min-h-11 whitespace-normal">{label}</Button>)}
  </div>
  <fieldset disabled={busy||!!settled} aria-busy={busy} className="min-w-0 space-y-4">
   {section==='profile'&&<ProfileForm embedded profile={data.profile} expectedRevision={data.assessment.revision} today={data.today} initialLocale={data.profile.locale} saveAction={(input,consent,expectedRevision)=>perform({kind:'profile',input,consent,expectedRevision})} onSaved={()=>{}}/>}
   {section==='language'&&<LanguagePreference embedded locale={data.profile.locale} revision={data.assessment.revision} saveAction={input=>{
    const v=input as {locale:PatientLocale;expectedLocale:PatientLocale;expectedRevision:number};
    return perform({kind:'language',input:{locale:v.locale,expectedLocale:v.expectedLocale},expectedRevision:v.expectedRevision});
   }} onSaved={()=>router.refresh()}/>}
   {section==='reminders'&&<ReminderSettings saved={data.reminders} locale={l} saveAction={(input,expectedRevision)=>perform({kind:'reminders',input,expectedRevision}).then(result=>result.ok?{ok:true,revision:result.revision}:{ok:false,reason:result.reason==='signed_out'?'unavailable':result.reason})} onSaved={()=>{}}/>}
   {section==='messages'&&<MessagePreferences locale={l} telegram={data.telegram}/>}
   {section==='text-size'&&<TextSizePreference locale={l} value={data.textSize} onSaved={textSize=>{setData(current=>current?{...current,textSize}:current);refreshSection('text-size');}}/>}
   {section==='privacy'&&(data.zoe?<ZoeConsents locale={l} initial={{readsMessages:data.zoe.readsMessages,scheduledQuestions:data.zoe.scheduledQuestions}} canGrant={data.zoe.canGrant} directAnswers={data.zoe.directAnswers} headingId={`account-consents-${card.id}`} onSaved={view=>{setData(current=>current?.zoe?{...current,zoe:{...current.zoe,...view}}:current);refreshSection('privacy');}}/>:<p role="status" className="text-body2">{copy(l,'Your Zoe choices are unavailable right now.','Զոյայի ձեր կարգավորումներն այս պահին հասանելի չեն։','Ваши настройки Зои сейчас недоступны.')}</p>)}
  </fieldset>
  <div className="flex flex-wrap gap-2 border-t pt-3">
   <SignOutButton locale={l}/>
  </div>
  {settled&&<p role="status" className="text-body2">{settled.ok?copy(l,'Your settings were saved. Show current details before making another change.','Ձեր կարգավորումները պահպանված են։ Նոր փոփոխությունից առաջ ցուցադրեք ընթացիկ տվյալները։','Ваши настройки сохранены. Прежде чем вносить другие изменения, откройте актуальные данные.'):copy(l,'Check your current settings before trying another change.','Նոր փոփոխությունից առաջ ստուգեք ընթացիկ կարգավորումները։','Прежде чем вносить другие изменения, проверьте актуальные настройки.')}</p>}
 </div>;
}
