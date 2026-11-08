import Link from 'next/link';
import type {Route} from 'next';
import {CalendarClock} from 'lucide-react';
import type {DoctorQueue} from '@/lib/programme/schema';
import {pick, type Locale} from '@/lib/locale';
import {formatMemberDate} from '@/lib/patient/date-format';

const KIND={week4_review:{en:'Week-4 review',hy:'4-րդ շաբաթվա վերանայում',ru:'Проверка на 4-й неделе'},month3:{en:'Month-3 checkpoint',hy:'3-րդ ամսվա ստուգում',ru:'Проверка на 3-м месяце'},month6:{en:'Month-6 checkpoint',hy:'6-րդ ամսվա ստուգում',ru:'Проверка на 6-м месяце'}} as const satisfies Record<string, Record<Locale,string>>;
const day=(d:string,l:Locale)=>formatMemberDate(`${d}T12:00:00+04:00`,l,{timeZone:'Asia/Yerevan',day:'numeric',month:'short'});

/** The doctor's open programme reviews, earliest date first. Shown only when there are some. */
export function ProgrammeQueue({queue,locale:l}:{queue:DoctorQueue;locale:Locale}){
 if(!queue.enabled||!queue.items.length)return null;
 const s=(en:string,hy:string,ru:string)=>pick(l,{en,hy,ru});
 return <section aria-labelledby="programme-queue-title" className="my-6 space-y-3 rounded-xl border bg-background p-4">
  <h2 id="programme-queue-title" className="flex items-center gap-2 text-h3"><CalendarClock className="size-5" aria-hidden/>{s('Programme reviews due','Ծրագրի վերանայումներ', "Предстоящие проверки по программе")}</h2>
  <ul className="divide-y">{queue.items.map(i=>{const late=queue.today&&i.dueOn<queue.today;return <li key={i.checkpointId} className="flex flex-wrap items-center justify-between gap-2 py-2">
   <Link href={`/staff/real/members/${i.memberId}#programme` as Route} className="text-body2 font-semibold text-primary underline">{i.memberName??s('Member','Անդամ', "Участник")}</Link>
   <span className="text-body2">{pick(l,KIND[i.kind])} · {late?s(`was due ${day(i.dueOn,l)}`,`ժամկետն անցել է՝ ${day(i.dueOn,l)}`, `срок истёк ${day(i.dueOn,l)}`):s(`due ${day(i.dueOn,l)}`,`ժամկետը՝ ${day(i.dueOn,l)}`, `срок: ${day(i.dueOn,l)}`)} · {i.checkinAt?s('check-in received','պատասխանները ստացված են', "ответы получены"):s('no check-in yet','պատասխաններ դեռ չկան', "ответов пока нет")}</span>
  </li>;})}</ul>
 </section>;
}
