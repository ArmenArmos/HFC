import {st,type StaffLocale} from './staff-locale-copy';
import {calendarDate} from './yerevan-time';

export type MemberIdentity={name:string|null;birthDate?:string|null;birthYear?:number|null;phoneLast4?:string|null;shortId?:string|null;sex?:'male'|'female'|null;phone?:string|null;clinic?:string|null};

/** Plain text for staff screens and messaging. Date-only values always use UTC. */
export function memberIdentityParts(member:MemberIdentity,locale:StaffLocale):string[]{
 const parts=[member.name?.trim()||st(locale,'Member','Անդամ','Участник')];
 if(member.birthDate){
  if(/^\d{4}-\d{2}-\d{2}$/.test(member.birthDate)){
   const date=new Date(`${member.birthDate}T00:00:00Z`);
   if(Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===member.birthDate){
    // Month names, never 03/04: staff read dates day-first or month-first, and this line exists to tell two people apart.
    parts.push(calendarDate(member.birthDate,locale));
   }
  }
 }else if(member.birthYear!=null)parts.push(String(member.birthYear));
 if(member.phoneLast4&&/^\d{4}$/.test(member.phoneLast4))parts.push(`•••• ${member.phoneLast4}`);
 if(member.shortId?.trim())parts.push(member.shortId.trim());
 return parts;
}
export function memberIdentityLine(member:MemberIdentity,locale:StaffLocale):string{
 return memberIdentityParts(member,locale).join(' · ');
}

/** Full chat identity. A birth year alone never supplies an age. */
export function chatMemberIdentityLine(member:MemberIdentity,locale:StaffLocale,now=new Date()):string{
 const parts=memberIdentityParts({...member,phoneLast4:null,shortId:null},locale);
 if(member.birthDate&&parts.length>1){
  const today=new Date(now.getTime()+4*60*60*1000).toISOString().slice(0,10);
  if(member.birthDate<=today){
   const age=Number(today.slice(0,4))-Number(member.birthDate.slice(0,4))-(today.slice(5)<member.birthDate.slice(5)?1:0);
   parts[1]+=` (${age})`;
  }else parts.pop();
 }
 if(member.sex)parts.push(member.sex==='female'?st(locale,'Female','Իգական','Женский'):st(locale,'Male','Արական','Мужской'));
 if(member.phone)parts.push(member.phone);
 else if(member.phoneLast4&&/^\d{4}$/.test(member.phoneLast4))parts.push(`•••• ${member.phoneLast4}`);
 if(member.clinic?.trim())parts.push(member.clinic.trim());
 if(member.shortId?.trim())parts.push(member.shortId.trim());
 return parts.join(' · ');
}
