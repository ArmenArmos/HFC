import {clinicTimestamp} from '@/lib/clinic-portal/display-time';
import {pick,type Locale} from '@/lib/locale';
import type {ClinicBooking,ScheduleCommand,ScheduleResult} from '@/lib/clinic-scheduling/schema';
/** Facts from the submitted booking and saved response only; never infer a new appointment. */
export function bookingActionReceipt(booking:ClinicBooking,command:ScheduleCommand,result:Extract<ScheduleResult,{status:'saved'}>,locale:Locale){
 const saved=result.booking;
 const name=booking.memberName||pick(locale,{en:'the member',hy:'անդամը',ru:'участник'});
 const at=command.op==='propose'?saved?.proposal?.startsAt:booking.startsAt;
 const date=at?clinicTimestamp(at,locale)+' (UTC+4)':null;
 switch(command.op){
  case 'confirm':return pick(locale,{en:`You confirmed the visit for ${name}: ${date}.`,hy:`Դուք հաստատեցիք այցը՝ ${name}․ ${date}։`,ru:`Вы подтвердили визит для ${name}: ${date}.`});
  case 'decline':return pick(locale,{en:`You declined the visit for ${name}: ${date}.`,hy:`Դուք մերժեցիք այցը՝ ${name}․ ${date}։`,ru:`Вы отклонили визит для ${name}: ${date}.`});
  case 'propose':return date?pick(locale,{en:`You proposed ${date} to ${name}. You are waiting for their reply.`,hy:`Դուք առաջարկեցիք ${date}՝ ${name}։ Սպասում եք պատասխանին։`,ru:`Вы предложили ${date} для ${name}. Вы ожидаете ответа.`}):pick(locale,{en:`You proposed another time to ${name}. Refresh the booking to see the proposed time.`,hy:`Դուք այլ ժամ առաջարկեցիք՝ ${name}։ Թարմացրեք այցը՝ առաջարկված ժամը տեսնելու համար։`,ru:`Вы предложили другое время для ${name}. Обновите запись, чтобы увидеть предложенное время.`});
  case 'withdraw-proposal':return pick(locale,{en:`You withdrew the time proposal for ${name}. Visit: ${date}.`,hy:`Դուք հետ կանչեցիք ժամի առաջարկը՝ ${name}։ Այցը՝ ${date}։`,ru:`Вы отозвали предложение времени для ${name}. Визит: ${date}.`});
  case 'check-in':return command.outcome==='arrived'?pick(locale,{en:`You marked ${name} as arrived for the visit at ${date}.`,hy:`Դուք նշեցիք, որ ${name} ներկայացել է ${date} այցին։`,ru:`Вы отметили приход ${name} на визит ${date}.`}):pick(locale,{en:`You marked ${name} as not having come for the visit at ${date}.`,hy:`Դուք նշեցիք, որ ${name} չի ներկայացել ${date} այցին։`,ru:`Вы отметили неявку ${name} на визит ${date}.`});
 }
}
