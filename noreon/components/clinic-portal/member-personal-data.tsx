'use client';
import {useId,useRef,useState,type FormEvent} from 'react';
import type {Locale} from '@/lib/locale';
import type {EditOutcome} from '@/lib/clinic-admin/schema';
import type {ClinicMemberRevealResult} from '@/lib/clinic-admin/member-reveal-schema';
import type {ClinicMemberMasked} from '@/lib/clinic-portal/member-masked-schema';
import {clinicDate} from '@/lib/clinic-portal/display-time';
import {ProfileEditForm} from './member-record-forms';
import {clinicMaskedPhone,clinicMaskedBirthYear,clinicNotGiven} from './member-masked';
const tr=(locale:Locale,en:string,hy:string,ru:string)=>locale==='ru'?ru:locale==='hy'?hy:en;
const secondary='inline-flex min-h-12 items-center justify-center rounded-md border px-4 text-body2 disabled:opacity-60';
export function ClinicMemberPersonalData({locale,name,masked,reveal,save}:{locale:Locale;name:string;masked?:ClinicMemberMasked;reveal:(input:unknown)=>Promise<ClinicMemberRevealResult>;save:(input:unknown)=>Promise<EditOutcome>}){
 const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const [stale,setStale]=useState(false);
 const [shown,setShown]=useState<Extract<ClinicMemberRevealResult,{ok:true}>|null>(null);
 const lock=useRef(false),id=useId();
 const message=(code:string)=>code==='reason_required'?tr(locale,'Write a reason of at least 5 characters.','Գրեք առնվազն 5 նիշից բաղկացած պատճառ։','Укажите причину длиной не менее 5 символов.'):code==='rate_limited'?tr(locale,"You have shown many members' details in the last hour. Try again later.",'Վերջին ժամվա ընթացքում բացել եք բազմաթիվ անդամների տվյալներ։ Ավելի ուշ նորից փորձեք։','За последний час вы открыли данные многих участников. Попробуйте позже.'):tr(locale,"Couldn't show the details. Try again.",'Չհաջողվեց ցույց տալ տվյալները։ Նորից փորձեք։','Не удалось показать данные. Попробуйте снова.');
 async function saveProfile(input:unknown){
  const outcome=await save(input);
  if(outcome==='stale'){setShown(null);setOpen(false);setStale(true);}
  if(outcome==='saved'&&typeof input==='object'&&input!==null&&'birthDate'in input&&(typeof input.birthDate==='string'||input.birthDate===null)){
   const birthDate=input.birthDate;setShown(previous=>previous?{...previous,birthDate}:previous);
  }
  return outcome;
 }
 async function submit(event:FormEvent){
  event.preventDefault();if(lock.current)return;
  const trimmed=reason.trim();if(trimmed.length<5){setError(message('reason_required'));return;}
  lock.current=true;setBusy(true);setError(null);
  let result:ClinicMemberRevealResult;try{result=await reveal({reason:trimmed});}catch{result={ok:false,code:'unavailable'};}
  if(result.ok){setStale(false);setShown(result);setReason('');setOpen(false);}else setError(message(result.code));
  lock.current=false;setBusy(false);
 }
 return <div className="space-y-3">
  <dl className="grid gap-x-4 gap-y-2 text-body2 sm:grid-cols-[auto_1fr]">
   <dt className="text-muted-foreground">{tr(locale,'Date of birth','Ծննդյան ամսաթիվ','Дата рождения')}</dt><dd>{shown?(shown.birthDate?clinicDate(shown.birthDate,locale):clinicNotGiven(locale)):clinicMaskedBirthYear(masked,locale)}</dd>
   <dt className="text-muted-foreground">{tr(locale,'Phone (sign-in)','Հեռախոս (մուտքի համար)','Телефон для входа')}</dt><dd>{shown?.phone?<a className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href={`tel:${shown.phone}`}>{shown.phone}</a>:shown?clinicNotGiven(locale):clinicMaskedPhone(masked,locale)}</dd>
  </dl>
  {stale&&<p role="alert" className="rounded-md border bg-muted p-3 text-body2">{tr(locale,'Someone changed this member while you were editing. The page has been reloaded; check and try again.','Խմբագրման ընթացքում այս անդամի տվյալները փոխվել են։ Էջը թարմացվել է․ ստուգեք և նորից փորձեք։','Данные участника изменились, пока вы их редактировали. Страница обновлена. Проверьте данные и попробуйте снова.')}</p>}
  {shown?<><p role="status" className="text-caption text-muted-foreground">{tr(locale,'Shown for this visit. Your reason was recorded.','Տվյալները ցուցադրված են այս դիտման համար։ Ձեր պատճառը գրանցված է։','Данные показаны на время этого просмотра. Ваша причина записана.')}</p><ProfileEditForm locale={locale} current={{name,birthDate:shown.birthDate}} save={saveProfile}/></>
  :<><div className="flex flex-wrap gap-2"><button type="button" className={secondary} onClick={()=>setOpen(true)}>{tr(locale,'Show phone and date of birth','Ցույց տալ հեռախոսը և ծննդյան ամսաթիվը','Показать телефон и дату рождения')}</button><button type="button" className={secondary} onClick={()=>setOpen(true)}>{tr(locale,'Show details to edit','Ցույց տալ տվյալները՝ խմբագրելու համար','Показать данные для редактирования')}</button></div>
   {open&&<form onSubmit={submit} aria-busy={busy} className="space-y-3 rounded-md border p-4">
    <label htmlFor={id} className="block text-body2 font-medium">{tr(locale,'Why do you need them?','Ինչի՞ համար են դրանք ձեզ անհրաժեշտ։','Для чего они вам нужны?')}</label>
    <p id={`${id}-hint`} className="text-caption text-muted-foreground">{tr(locale,"For example: calling about tomorrow's visit. This is recorded with your name.",'Օրինակ՝ վաղվա այցի մասին զանգելու համար։ Սա գրանցվում է ձեր անունով։','Например: позвонить о завтрашнем приёме. Причина записывается с вашим именем.')}</p>
    <textarea id={id} required minLength={5} maxLength={500} rows={3} value={reason} disabled={busy} aria-invalid={!!error} aria-describedby={`${id}-hint${error?` ${id}-error`:''}`} onChange={event=>setReason(event.target.value)} className="w-full min-w-0 rounded-md border bg-background p-3 text-body2"/>
    {error&&<p id={`${id}-error`} role="alert" className="text-body2">{error}</p>}
    <button disabled={busy} className="inline-flex min-h-12 items-center rounded-md bg-primary px-4 text-body2 font-medium text-primary-foreground disabled:opacity-60">{tr(locale,'Show','Ցույց տալ','Показать')}</button>
   </form>}</>}
 </div>;
}
