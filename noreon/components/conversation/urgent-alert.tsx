import {st} from '@/lib/staff/staff-locale-copy';
import type {Locale} from '@/lib/locale';
import {urgentWindowLine} from '@/lib/doctor-inbox/urgent-windows';
import {Siren} from 'lucide-react';
import {CareSection} from '@/components/patient-care/common';
import {clearUrgentAction} from '@/app/staff/real/conversation/actions';
import {clearUrgentNoticeText,type ClearUrgentNotice,type UrgentWindowView} from '@/lib/zoe/doctor-mode';

const button='inline-flex min-h-11 items-center rounded-md px-4 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring';

/**
 * The member's open 103 alert on the conversation page (20261020182719): while it is open Zoe repeats the advice to call
 * 103 to every message. The assigned doctor can clear it after checking with the member. Nothing is shown when no alert
 * is open, unless a notice is due.
 */
export function UrgentAlert({memberId,window,notice,locale='en'}:{memberId:string;window:UrgentWindowView|null;notice:ClearUrgentNotice|null;locale?:Locale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const msg=notice?<p role="status" className="text-body2">{clearUrgentNoticeText[notice]}</p>:null;
 if(window===null)return <CareSection title="103 alert"><p className="text-body2">Whether a 103 alert is open could not be loaded. Reload to try again.</p></CareSection>;
 if(!window.open)return msg?<CareSection title="103 alert">{msg}</CareSection>:null;
 return <CareSection title="103 alert is open"
  detail={window.openedBy==='model'
   ?'Zoe’s AI judged a message to be an emergency (no fixed danger sign matched). Zoe asks one danger-sign question if the member corrects it or writes about something else.'
   :'A fixed danger sign matched, so Zoe repeats the advice to call 103 to every message until the member says help has come.'}>
  <div className="space-y-3">
   {msg}
   <p className="flex flex-wrap items-center gap-2 text-body2"><Siren className="size-4 shrink-0" aria-hidden/>
    {window.since?urgentWindowLine(window.since,locale):t('The 103 text was sent to the member; no one has answered.','103-ի տեքստն ուղարկվել է անդամին, դեռ ոչ ոք չի պատասխանել։','Текст о вызове 103 отправлен участнику; пока никто не ответил.')}</p>
   <form action={clearUrgentAction}>
    <input type="hidden" name="memberId" value={memberId}/>
    <button className={`${button} bg-primary text-primary-foreground`}>Clear 103 alert</button>
   </form>
   <p className="text-caption text-muted-foreground">Clear it only after you have checked with the member. Zoe then answers normally; the member is sent nothing, and the care alert stays open until you or a colleague close it. This is recorded.</p>
  </div>
 </CareSection>;
}
