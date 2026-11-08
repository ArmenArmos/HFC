'use client';
import {useState,useTransition} from 'react';
import {Bot,CalendarClock,MessageCircle,type LucideIcon} from 'lucide-react';
import {IconTile} from '@/components/patient-care/common';
import {tx,type PatientLocale} from '@/lib/patient/copy';
import {clinicalLocale} from '@/lib/locale';
import {ZOE_DIRECT_ANSWERS} from '@/lib/zoe/consent-copy';
import {changeZoeConsent} from '@/app/patient/account/telegram/zoe-actions';

type Kind='zoe_reads_messages'|'zoe_scheduled_questions';
type View={readsMessages:boolean;scheduledQuestions:boolean};

function ConsentSwitch({id,label,detail,icon,checked,disabled,onChange}:{id:string;label:string;detail:string;icon:LucideIcon;checked:boolean;disabled:boolean;onChange:(v:boolean)=>void}){
 return <label htmlFor={id} className="flex cursor-pointer items-start gap-3 py-3">
  <IconTile icon={icon}/>
  <span className="min-w-0 flex-1 space-y-1"><span className="block text-body2 font-semibold">{label}</span><span id={`${id}-detail`} className="block text-body2 text-muted-foreground">{detail}</span></span>
  <input id={id} type="checkbox" role="switch" aria-describedby={`${id}-detail`} checked={checked} disabled={disabled} onChange={e=>onChange(e.target.checked)} className="peer sr-only"/>
  <span aria-hidden className="mt-2 flex h-7 w-12 shrink-0 items-center rounded-full bg-muted-foreground/30 p-1 transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:opacity-50 peer-checked:[&>span]:translate-x-5"><span className="size-5 rounded-full bg-background shadow-sm transition-transform"/></span>
 </label>;
}

/**
 * K4: three separate choices. Telegram replies is the existing connection above; the two
 * Zoe choices are independent, and saying no to Zoe still lets the member write to the doctor.
 * Under Me (My consents) the Telegram row is left out: Zoe works in the app whatever the link.
 * DRAFT WORDING, not approved (S6, Q17). The direct-answers line (shown only while zoe_settings.direct_answers_enabled is on) is a STAGING draft for legal (P34).
 */
export function ZoeConsents({locale:l,initial,telegramConnected,canGrant=true,headingId='zoe-consents',title,directAnswers=false,onSaved}:{onSaved?:(view:View)=>void;locale:PatientLocale;initial:View;telegramConnected?:boolean;canGrant?:boolean;headingId?:string;title?:string;directAnswers?:boolean}){
 const [view,setView]=useState(initial),[pending,startTransition]=useTransition();
 const [message,setMessage]=useState<{tone:'ok'|'error';text:string}|null>(null);
 function change(kind:Kind,granted:boolean){
  setMessage(null);
  startTransition(async()=>{
   try{
    const r=await changeZoeConsent(kind,granted);
    if(!r.ok){setMessage({tone:'error',text:r.reason==='stale'?tx(l,'Այս տեքստը փոխվել է։ Թարմացրեք էջը՝ ընթացիկ տարբերակը տեսնելու համար։','This wording has changed. Reload the page to see the current version.','Этот текст изменился. Обновите страницу, чтобы увидеть текущую версию.'):r.reason==='unavailable'?tx(l,'Զոյան դեռ հասանելի չէ ձեր հաշվի համար։','Zoe is not available for your account yet.','Зоя пока недоступна для вашей учётной записи.'):tx(l,'Չհաջողվեց պահպանել։ Փորձեք նորից։','We could not save your choice. Try again.','Не удалось сохранить ваш выбор. Попробуйте снова.')});return;}
    setView(r.view);onSaved?.(r.view);setMessage({tone:'ok',text:tx(l,'Ձեր ընտրությունը պահպանված է։','Your choice is saved.','Ваш выбор сохранён.')});
   }catch{setMessage({tone:'error',text:tx(l,'Չհաջողվեց պահպանել։ Փորձեք նորից։','We could not save your choice. Try again.','Не удалось сохранить ваш выбор. Попробуйте снова.')});}
  });
 }
 return <section className="journey-card max-w-2xl space-y-2" aria-labelledby={headingId}>
  <h2 id={headingId} className="text-h3">{title??tx(l,'Ձեր համաձայնությունները','Your choices','Ваш выбор')}</h2>
  {!canGrant&&<p className="text-body2">{tx(l,'Զոյան այս պահին չի օգտագործվում։ Կարող եք անջատել ձեր տված համաձայնությունը։','Zoe is not in use right now. You can still turn off a choice you made.','Зоя сейчас не используется. Вы по-прежнему можете отключить ранее выбранную настройку.')}</p>}
  <div className="divide-y">
   {telegramConnected!==undefined&&<div className="flex items-start gap-3 py-3"><IconTile icon={MessageCircle}/><div className="min-w-0 flex-1 space-y-1"><p className="text-body2 font-semibold">{tx(l,'Պատասխաններ Telegram-ում','Replies in Telegram','Ответы в Telegram')}</p>
    <p className="text-body2 text-muted-foreground">{telegramConnected?tx(l,'Միացված է։ Կարող եք անջատել վերևում։','On. You can disconnect it above.','Включено. Вы можете отключить подключение выше.'):tx(l,'Միացված չէ։ Միացրեք Telegram-ը վերևում։','Off. Connect Telegram above to turn it on.','Выключено. Подключите Telegram выше, чтобы включить.')}</p></div></div>}
   <ConsentSwitch id="zoe-reads" icon={Bot} checked={view.readsMessages} disabled={pending||(!canGrant&&!view.readsMessages)} onChange={v=>change('zoe_reads_messages',v)}
    label={tx(l,'Զոյան կարող է կարդալ իմ հաղորդագրությունները','Zoe may read my messages','Зоя может читать мои сообщения')}
    detail={`${tx(l,'Զոյան արհեստական բանականությամբ օգնական է։ Այն օգնում է ձեր խնամքի թիմին՝ ամփոփելով ձեր հաղորդագրությունները։ Եթե ասեք ոչ, դուք դեռ կարող եք գրել ձեր բժշկին։','Zoe is an AI assistant. It helps your care team by summarising your messages. If you say no, you can still write to your doctor.','Зоя работает как помощник на основе ИИ. Она помогает вашей медицинской команде, составляя краткое содержание ваших сообщений. Если вы откажетесь, вы всё равно сможете писать вашему врачу.')}${directAnswers?` ${ZOE_DIRECT_ANSWERS[clinicalLocale(l)]}`:''}`}/>
   <ConsentSwitch id="zoe-scheduled" icon={CalendarClock} checked={view.scheduledQuestions} disabled={pending||(!canGrant&&!view.scheduledQuestions)} onChange={v=>change('zoe_scheduled_questions',v)}
    label={tx(l,'Զոյան կարող է ինձ պլանավորված հարցեր ուղարկել','Zoe may send me scheduled questions','Зоя может отправлять мне вопросы по расписанию')}
    detail={tx(l,'Միայն ձեր բժշկի հաստատած հարցերը, օրական առավելագույնը 2, և ոչ երբեք 21:00-ից 09:00-ն։','Only questions your doctor approved, at most 2 a day, and never between 21:00 and 09:00.','Только вопросы, утверждённые вашим врачом, не более 2 в день и никогда с 21:00 до 09:00.')}/>
  </div>
  {message&&<p role={message.tone==='error'?'alert':'status'} className="rounded-xl border p-4 text-body2">{message.text}</p>}
 </section>;
}
