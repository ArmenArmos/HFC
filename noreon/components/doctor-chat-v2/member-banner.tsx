'use client';
import {ChatMemberIdentity} from '@/components/staff/chat-member-identity';
import type {StaffLocale} from '@/lib/staff/staff-locale-copy';
import {st} from '@/lib/staff/staff-locale-copy';

export function DoctorMemberBanner({member,locale,restored,mode='ask'}:{member:{memberId:string;memberName:string}|null;locale:StaffLocale;restored:boolean;mode?:'ask'|'reply'|'resolution'}){
 return <span role="status" aria-live="polite" aria-atomic="true" data-current-member={member?.memberId}>
  {mode==='reply'?st(locale,'Replying to','Պատասխանում եք՝','Ответ для'):mode==='resolution'?st(locale,'Resolution note for','Լուծման նշում՝','Заметка о закрытии для'):st(locale,'Asking Zoe','Հարցնում եք Զոյային','Вопрос Зое')}
  {member&&<> · <ChatMemberIdentity key={member.memberId} memberId={member.memberId} name={member.memberName} locale={locale}/></>}
  {member&&restored&&<> · {st(locale,'From your last conversation','Ձեր նախորդ զրույցից','Из прошлого разговора')}</>}
 </span>;
}
