import Link from 'next/link';
import type {Route} from 'next';
import type {DoctorInbox} from '@/lib/doctor-inbox/contracts';
import {NurseReplies} from '@/components/conversation/nurse-replies';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';

/** Recent activity, separate from the clinical work that still needs a doctor decision. */
export function NurseActivity({items,locale}:{items:DoctorInbox['nurseActivity'];locale:StaffLocale}){
 if(!items.length)return null;
 return <section aria-label={st(locale,'Recent nurse replies','Բուժքրոջ վերջին պատասխանները','Последние ответы медсестры')} className="space-y-3">
  <h2 className="text-h3">{st(locale,'Nurse replies in the last 24 hours','Բուժքրոջ պատասխանները վերջին 24 ժամում','Ответы медсестры за последние 24 часа')}</h2>
  <ul className="space-y-3">{items.map(item=><li key={item.id} className="space-y-2">
   <Link href={`/staff/real/conversations/${item.memberId}` as Route} className="text-body2 font-medium underline underline-offset-4">{item.memberName||st(locale,'Read conversation','Կարդալ զրույցը','Прочитать разговор')}</Link>
   <NurseReplies replies={[item]} locale={locale}/>
  </li>)}</ul>
  {items.length>=50&&<p className="text-caption text-muted-foreground">{st(locale,'Showing the latest 50 replies. Open conversations for earlier messages.','Ցուցադրված են վերջին 50 պատասխանները։ Ավելի վաղ հաղորդագրությունները կարդացեք զրույցներում։','Показаны последние 50 ответов. Более ранние сообщения доступны в переписке.')}</p>}
 </section>;
}
