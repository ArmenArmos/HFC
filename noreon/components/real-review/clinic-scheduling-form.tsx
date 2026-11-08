"use client";
import {useActionState,useState} from 'react';
import {Pencil,RotateCcw} from 'lucide-react';
import {tx,type PatientLocale} from '@/lib/patient/copy';
import {updateClinicSchedulingEmail,updateSchedulingCopyEmail} from '@/lib/staff/real-clinic-scheduling-actions';
import type {SchedulingActionState,SchedulingFeedback} from '@/lib/staff/clinic-scheduling-schema';

type Props={kind:'clinic'|'copy';clinicId?:string;clinicName?:string;initialEmail:string|null;revision:number;requestId:string;locale?:PatientLocale;disabled?:boolean;settingsHref?:string;
 action?:(previous:SchedulingActionState,form:FormData)=>Promise<SchedulingActionState>};
export function ClinicSchedulingForm({kind,clinicId,clinicName,initialEmail,revision,requestId,locale='en',disabled=false,settingsHref='/staff/real/clinics',action}:Props){
 // Freeze the operation context until explicit reload. A later server refresh
 // must not silently change the revision/request underneath a retained draft.
 const [context]=useState({revision,requestId});
 const [email,setEmail]=useState(initialEmail??'');
 const [state,submit,pending]=useActionState(action??(kind==='clinic'?updateClinicSchedulingEmail:updateSchedulingCopyEmail),{ok:false} as SchedulingActionState);
 const locked=disabled||pending||state.ok||!!state.outcomeUnknown||state.feedback==='stale'||state.feedback==='access';
 const savedEmail=state.ok&&state.revision!==undefined&&state.revision>revision?state.email??null:initialEmail;
 const inputId=`scheduling-email-${kind==='clinic'?clinicId:'noreon-copy'}`;
 const messages:Record<SchedulingFeedback,string>={
  saved:tx(locale,'Կարգավորումը պահպանվել է։','Setting saved.','Настройка сохранена.'),
  invalid:tx(locale,'Ստուգեք էլփոստի հասցեն։ Մուտքագրեք միայն մեկ հասցե կամ դաշտը թողեք դատարկ։','Check the email address. Enter one address or leave it empty.','Проверьте адрес электронной почты. Введите один адрес или оставьте поле пустым.'),
  stale:tx(locale,'Կարգավորումը փոխվել է։ Թարմացրեք էջը՝ կրկին պահպանելուց առաջ։','This setting changed. Reload before saving again.','Эта настройка изменилась. Обновите страницу перед повторным сохранением.'),
  access:tx(locale,'Մուտքի իրավունքը կամ կլինիկայի կարգավիճակը փոխվել է։ Թարմացրեք էջը։','Access or clinic status changed. Reload the page.','Права доступа или статус клиники изменились. Обновите страницу.'),
  rejected:tx(locale,'Փոփոխությունը չի պահպանվել։ Ստուգեք տվյալները կամ թարմացրեք էջը։','The change was not saved. Check the details or reload the page.','Изменение не сохранено. Проверьте данные или обновите страницу.'),
  unknown:tx(locale,'Պահպանումը չի հաստատվել։ Թարմացրեք էջը՝ ընթացիկ տվյալները ստուգելուց հետո միայն կրկին փորձեք։','The save could not be confirmed. Reload and check the current details before trying again.','Не удалось подтвердить сохранение. Обновите страницу и проверьте текущие данные перед повторной попыткой.'),
 };
 return <form action={submit} aria-label={kind==='clinic'?tx(locale,`Կլինիկայի ամրագրման էլփոստ${clinicName?`՝ ${clinicName}`:''}`,`Clinic scheduling email${clinicName?` for ${clinicName}`:''}`,`Электронная почта клиники для записи${clinicName?`: ${clinicName}`:''}`):tx(locale,'Noreon պատճենի էլփոստ','Noreon copy email','Электронная почта для копий Noreon')} aria-busy={pending} lang={locale} className="min-w-0 space-y-3">
  <input type="hidden" name="requestId" value={context.requestId}/>
  <input type="hidden" name="expectedRevision" value={context.revision}/>
  {kind==='clinic'&&<input type="hidden" name="clinicId" value={clinicId}/>}
  <p className="break-words text-caption text-muted-foreground">{savedEmail
   ? tx(locale,`Պահպանված հասցե՝ ${savedEmail}`,`Saved address: ${savedEmail}`,`Сохранённый адрес: ${savedEmail}`)
   : tx(locale,'Կարգավորված չէ','Not configured','Не настроено')}</p>
  {disabled&&<p id={`${inputId}-inactive`} className="text-body2">{tx(locale,'Ակտիվացրեք կլինիկան՝ ամրագրման էլփոստը փոխելու համար։','Activate this clinic to change its scheduling email.','Активируйте клинику, чтобы изменить её адрес электронной почты для записи.')}</p>}
  <fieldset disabled={locked} aria-describedby={disabled?`${inputId}-inactive`:undefined} className="min-w-0 space-y-3">
   <label htmlFor={inputId} className="block text-body2">{kind==='clinic'?tx(locale,'Ամրագրման էլփոստի հասցե','Scheduling email address','Адрес электронной почты для записи'):tx(locale,'Noreon պատճենի հասցե','Noreon copy address','Адрес для копий Noreon')}</label>
   <input id={inputId} type="email" name="email" value={email} onChange={event=>setEmail(event.target.value)} maxLength={254} autoComplete="off" aria-invalid={state.feedback==='invalid'||undefined} aria-describedby={`${inputId}-help${state.feedback?` ${inputId}-feedback`:''}`} className="min-h-12 w-full min-w-0 rounded-md border bg-background px-3 py-2 text-body2"/>
   <p id={`${inputId}-help`} className="text-caption text-muted-foreground">{tx(locale,'Դատարկ դաշտը նշանակում է՝ կարգավորված չէ։ Պահպանումը հաղորդագրություն չի ուղարկում։','Leave empty for unconfigured. Saving does not send a message.','Оставьте поле пустым, если адрес не настроен. Сохранение не отправляет сообщение.')}</p>
   <button type="submit" className="min-h-12 rounded-md bg-primary px-4 py-2 text-body2 text-primary-foreground disabled:opacity-50">{pending?tx(locale,'Պահպանվում է…','Saving…','Сохраняется…'):tx(locale,'Պահպանել էլփոստը','Save email','Сохранить адрес')}</button>
  </fieldset>
  {state.feedback&&<p id={`${inputId}-feedback`} role={state.ok?'status':'alert'} className="text-body2">{messages[state.feedback]}</p>}
  {!disabled&&state.feedback&&<a href={settingsHref} className="inline-flex min-h-12 items-center gap-2 rounded-md border bg-background px-4 py-2 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
   {state.ok?<Pencil className="size-4" aria-hidden/>:<RotateCcw className="size-4" aria-hidden/>}
   {state.ok?tx(locale,'Փոխել էլփոստը','Edit email','Изменить адрес'):tx(locale,'Թարմացնել կարգավորումները','Reload settings','Обновить настройки')}
  </a>}
 </form>;
}
