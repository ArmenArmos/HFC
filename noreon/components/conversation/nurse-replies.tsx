import type {NurseReplyView} from '@/lib/nurse-chat/contracts';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {stamp} from '@/components/patient-care/common';

/** Frozen actual senders, also shown to the responsible physician. */
export function NurseReplies({replies,locale='en'}:{replies:readonly NurseReplyView[];locale?:StaffLocale}){
 if(!replies.length)return null;
 return <section className="space-y-3 rounded-xl border bg-card p-4" aria-label={st(locale,'Nurse messages','Բուժքրոջ հաղորդագրությունները','Сообщения медсестры')}>
  <h2 className="text-h3">{st(locale,'Nurse messages','Բուժքրոջ հաղորդագրությունները','Сообщения медсестры')}</h2>
  <ol className="space-y-4">{replies.map(r=><li key={r.id} className="space-y-1">
   <p className="text-caption text-muted-foreground">{r.senderName} · {st(locale,'Nurse','Բուժքույր','Медсестра')} · {stamp(r.at,locale)}</p>
   <p className="whitespace-pre-wrap break-words text-body2">{r.text}</p>
  </li>)}</ol>
 </section>;
}
