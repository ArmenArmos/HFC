'use client';
import {pick,type Locale} from '@/lib/locale';
import {urgentNotice,type NoticeKind} from '@/lib/realtime/contracts';
import type {SignalNotice} from './use-realtime-signals';

/**
 * WP R: inline notices at the top of a conversation, raised by realtime signals. They carry no health content (a
 * signal has none): they say that something changed and offer the action that opens the relevant card, where the
 * screen's own read shows what it is. A care alert is urgent (role=alert); every other notice is polite (role=status).
 */
const NOTICE_TEXT:Record<NoticeKind,Record<Locale,string>>={
 care_alert:{hy:'Նոր ահազանգ կա։ Բացեք ահազանգերը՝ այն տեսնելու համար։',en:'There is a new care alert. Open the alerts to see it.',ru:'Появилось новое оповещение. Откройте оповещения, чтобы его увидеть.'},
 staff_notice:{hy:'Անդամի մասին նոր ծանուցում ունեք։',en:'You have a new notice about a member.',ru:'У вас новое уведомление об участнике.'},
 worklist:{hy:'Ձեր աշխատանքային ցանկը փոխվել է։',en:'Your worklist has changed.',ru:'Ваш рабочий список изменился.'},
 caregiver_notice:{hy:'Նոր տեղեկություն կա այն մարդու մասին, ում օգնում եք։',en:'There is an update about a person you help.',ru:'Есть новости о человеке, которому вы помогаете.'},
};
export const NOTICE_ACTION:Record<NoticeKind,Record<Locale,string>>={
 care_alert:{hy:'Ցույց տալ ահազանգերը',en:'Show alerts',ru:'Показать оповещения'},
 staff_notice:{hy:'Բացել',en:'Open',ru:'Открыть'},
 worklist:{hy:'Ցույց տալ աշխատանքային ցանկը',en:'Show worklist',ru:'Показать рабочий список'},
 caregiver_notice:{hy:'Ցույց տալ',en:'Show',ru:'Показать'},
};
const DISMISS:Record<Locale,string>={hy:'Փակել',en:'Dismiss',ru:'Скрыть'};
const REGION:Record<Locale,string>={hy:'Նոր ծանուցումներ',en:'New notices',ru:'Новые уведомления'};
const MORE:Record<Locale,(n:number)=>string>={hy:n=>`(${n} անգամ)`,en:n=>`(${n} times)`,ru:n=>`(${n} раз)`};

export type NoticeActions=Partial<Record<NoticeKind,(ref:string|null)=>void>>;
export function noticeText(kind:NoticeKind,locale:Locale){return pick(locale,NOTICE_TEXT[kind]);}

export function SignalNotices({notices,locale,actions,onDismiss}:{notices:SignalNotice[];locale:Locale;actions:NoticeActions;onDismiss:(id:string)=>void}){
 if(!notices.length)return null;
 return <section aria-label={pick(locale,REGION)} className="mx-auto mb-3 flex w-full max-w-3xl flex-col gap-2" data-signal-notices>
  {notices.map(notice=>{
   const urgent=urgentNotice(notice.kind),open=actions[notice.kind];
   return <div key={notice.id} role={urgent?'alert':'status'} aria-live={urgent?'assertive':'polite'} data-signal-notice={notice.kind}
    className={`flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 text-body2 ${urgent?'border-destructive':''}`}>
    <p className={`min-w-0 flex-1 ${urgent?'font-semibold text-destructive':''}`}>{noticeText(notice.kind,locale)}{notice.count>1?` ${pick(locale,MORE)(notice.count)}`:''}</p>
    {open&&<button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border px-4 font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
     onClick={()=>{onDismiss(notice.id);open(notice.ref);}}>{pick(locale,NOTICE_ACTION[notice.kind])}</button>}
    <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-4 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
     onClick={()=>onDismiss(notice.id)}>{pick(locale,DISMISS)}</button>
   </div>;
  })}
 </section>;
}
