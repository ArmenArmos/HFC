'use client';
import{clinicalLocale,type Locale}from'@/lib/locale';
import{useEffect,useRef,useState,useSyncExternalStore,type FormEvent}from'react';
import{useRouter}from'next/navigation';
import{CalendarClock,CalendarX,Check,UserRoundCheck,UserRoundX,X}from'lucide-react';
import type{ClinicMemberMasked}from'@/lib/clinic-portal/member-masked-schema';
import{clinicMaskedPhone}from'./member-masked';
import{clinicTimestamp}from'@/lib/clinic-portal/display-time';
import{clinicTestTitle,yerevanDay,type ClinicBooking,type FreeSlot,type ScheduleCommand,type ScheduleResult}from'@/lib/clinic-scheduling/schema';
type CommandBody=ScheduleCommand extends infer C?C extends ScheduleCommand?Omit<C,'version'|'submissionId'|'appointmentId'|'revision'>:never:never;
type Props={masked?:ClinicMemberMasked;receipt?:string;receiptOnly?:boolean;decisionOnly?:boolean;booking:ClinicBooking;fileHref?:string;locale:Locale;run:(input:ScheduleCommand,booking:ClinicBooking)=>Promise<ScheduleResult>;slots:(day:string)=>Promise<FreeSlot[]|null>};
// HY copy for the declined-proposal notice (18 Oct) awaits Tatevik's wording check.
const tr=(locale:Locale,en:string,hy:string,ru:string)=>locale==='ru'?ru:locale==='hy'?hy:en;
const button='inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-4 text-body2 font-medium disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
const primary=`${button} bg-primary text-primary-foreground`,secondary=`${button} border bg-background`;
const field='min-h-12 w-full min-w-0 rounded-md border bg-background px-3 py-2 text-body2';
const timestamp=clinicTimestamp;
const time=(value:string,locale:Locale)=>timestamp(value,locale).split(' · ')[1];
const date=(value:string,locale:Locale)=>timestamp(value,locale).split(' · ')[0];
export const statusText:Record<ClinicBooking['status'],[string,string,string]>={
 requested:['Waiting for your confirmation','Սպասում է ձեր հաստատմանը','Ожидает вашего подтверждения'],'change-requested':['Change requested','Փոփոխության հարցում','Запрошено изменение'],confirmed:['Confirmed','Հաստատված է','Подтверждён'],
 arrived:['Arrived','Ներկայացել է','Пришёл'],'no-show':['Did not come','Չի ներկայացել','Не пришёл'],completed:['Completed: results received','Ավարտված է․ արդյունքները ստացված են','Завершён: результаты получены'],declined:['Declined','Մերժված է','Отклонён'],cancelled:['Cancelled by the member','Անդամը չեղարկել է','Отменён участником'],other:['Needs Noreon','Պետք է Նորեոն Հելթի օգնությունը','Нужна помощь Нореон Хелс'],
};
function message(result:ScheduleResult,locale:Locale){
 const texts:Record<Exclude<ScheduleResult['status'],'saved'>,[string,string,string]>={
  invalid:['Check your entries and try again.','Ստուգեք մուտքագրածը և նորից փորձեք։','Проверьте введённые данные и попробуйте снова.'],stale:['This booking changed. Reload to see the latest.','Այցը փոխվել է։ Վերբեռնեք՝ վերջին տվյալները տեսնելու համար։','Запись изменилась. Обновите страницу, чтобы увидеть актуальные данные.'],
  past:['The visit time has passed. Propose another time or decline.','Այցի ժամն անցել է։ Առաջարկեք այլ ժամ կամ մերժեք։','Время визита прошло. Предложите другое время или отклоните запрос.'],full:['That time is now full. Choose another.','Այդ ժամն արդեն զբաղված է։ Ընտրեք այլ ժամ։','Это время уже занято. Выберите другое.'],
  early:['You can record this on the visit day.','Սա կարող եք գրանցել այցի օրը։','Вы можете отметить это в день визита.'],unavailable:['Couldn’t save right now. Try again.','Այժմ չհաջողվեց պահպանել։ Նորից փորձեք։','Сейчас не удалось сохранить. Попробуйте снова.'],
  access:['Your session changed. Reload the page.','Ձեր մուտքը փոխվել է։ Վերբեռնեք էջը։','Ваш сеанс изменился. Обновите страницу.'],conflict:['This action was already sent with other details. Reload the page.','Այս գործողությունն արդեն ուղարկվել է այլ տվյալներով։ Վերբեռնեք էջը։','Это действие уже отправлено с другими данными. Обновите страницу.'],
  disabled:['Scheduling is switched off.','Այցերի կառավարումն անջատված է։','Управление визитами отключено.'],unknown:['We couldn’t confirm the result. Reload to check before trying again.','Չհաջողվեց հաստատել արդյունքը։ Նորից փորձելուց առաջ վերբեռնեք էջը։','Не удалось подтвердить результат. Обновите страницу и проверьте его перед повторной попыткой.'],
 };
 return result.status==='saved'?null:tr(locale,...texts[result.status]);
}
const subscribeNever=()=>()=>{};
export function ClinicBookingCard({masked,booking,fileHref,locale,run,slots,decisionOnly=false,receipt,receiptOnly=false}:Props){
 const router=useRouter();
 const [submission,setSubmission]=useState(()=>crypto.randomUUID());
 const sending=useRef(false);
 const [uncertain,setUncertain]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[panel,setPanel]=useState<'none'|'decline'|'propose'|'no-show'>('none');
 const [reason,setReason]=useState(''),[day,setDay]=useState(''),[free,setFree]=useState<FreeSlot[]|null|'failed'>(null),[slot,setSlot]=useState(''),[note,setNote]=useState('');
 // The clock moves on while the card is open (review item 10): propose, arrived and no-show follow it per minute.
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60_000);return()=>clearInterval(timer);},[]);
 // Only the newest day's slot read may fill the list: an older, slower answer would show day A's times under day B.
 const slotRequest=useRef(0);
 const portal=booking.channel==='portal',pending=booking.kind==='pending';
 const current=booking.kind==='current';
 const canDecide=portal&&pending&&!booking.proposal&&!receiptOnly&&!busy&&!uncertain;
 // A no-show can still be offered another time (lead decision 18 Oct); an attended visit cannot.
 const canPropose=!uncertain&&!receiptOnly&&!booking.proposal&&portal&&(pending||current)&&booking.status!=='arrived'&&booking.status!=='completed'&&(booking.status==='no-show'||Date.parse(booking.startsAt)>now);
 // QA F-14: check-in buttons follow the browser clock, so they appear only after hydration (the server never renders them).
 const proposeForm=useRef<HTMLFormElement>(null);
 // The declined highlight is for upcoming bookings the clinic can still re-offer (Fable R-2 on #272); a past visit keeps its plain card.
 const rejected=Date.parse(booking.startsAt)>now&&canPropose?booking.rejectedProposal:null;
 function openPropose(){setPanel('propose');setError(null);requestAnimationFrame(()=>proposeForm.current?.scrollIntoView({block:'nearest',behavior:'smooth'}));}
 const hydrated=useSyncExternalStore(subscribeNever,()=>true,()=>false);
 const arrivedDue=hydrated&&current&&yerevanDay(now)>=yerevanDay(booking.startsAt),noShowDue=hydrated&&current&&now>=Date.parse(booking.startsAt);
 const futureCheckIn=hydrated&&!decisionOnly&&!receiptOnly&&current&&booking.status==='confirmed'&&!arrivedDue&&!noShowDue;
 async function send(command:CommandBody){
  if(sending.current||uncertain)return;sending.current=true;setBusy(true);setError(null);
  let result:ScheduleResult;
  try{result=await run({version:'clinic-schedule-command-v1',submissionId:submission,appointmentId:booking.appointmentId,revision:booking.revision,...command} as ScheduleCommand,booking);}
  catch{result={status:'unknown'};}
  sending.current=false;setBusy(false);
  if(result.status==='saved'){setSubmission(crypto.randomUUID());setPanel('none');router.refresh();return;}
  // A refused command was not recorded, so a fresh attempt gets a fresh submission.
  if(result.status==='unknown')setUncertain(true);
  if(result.status!=='unknown')setSubmission(crypto.randomUUID());
  setError(message(result,locale));
 }
 async function loadSlots(value:string){
  const request=++slotRequest.current;
  setDay(value);setSlot('');setFree(null);if(!value)return;
  // A failed read is not "no free times": it says so and offers a retry.
  const result=await slots(value).catch(()=>null);
  if(request===slotRequest.current)setFree(result??'failed');
 }
 function decline(event:FormEvent){event.preventDefault();if(reason.trim().length<3){setError(tr(locale,'Enter a reason of at least 3 characters.','Մուտքագրեք առնվազն 3 նիշից բաղկացած պատճառ։','Укажите причину длиной не менее 3 символов.'));return;}void send({op:'decline',reason:reason.trim()});}
 function propose(event:FormEvent){event.preventDefault();if(!canPropose){setPanel('none');return;}if(!slot){setError(tr(locale,'Choose a time.','Ընտրեք ժամը։','Выберите время.'));return;}void send({op:'propose',slotKey:slot,note:note.trim()||null});}
 const [en,hy,ru]=statusText[booking.status];
 return <li className={`space-y-4 rounded-lg border bg-background p-4 ${rejected?'border-2 border-brand-gold':''}`} aria-busy={busy}>
  {rejected&&<div className="space-y-3 rounded-md bg-surface-subtle-gold p-3">
   <p className="flex items-center gap-2 text-body2 font-medium"><CalendarX aria-hidden className="size-5 shrink-0 text-brand-gold-deep"/>{tr(locale,'Member declined your proposed time','Անդամը մերժել է ձեր առաջարկած ժամը','Участник отклонил предложенное вами время')}</p>
   <p className="text-body2">{tr(locale,'Declined time','Մերժված ժամը','Отклонённое время')}: {date(rejected.startsAt,locale)} · {time(rejected.startsAt,locale)}{locale==='ru'?' - ':'–'}{time(rejected.endsAt,locale)}</p>
   {canPropose&&panel!=='propose'&&<button type="button" className={primary} disabled={busy} onClick={openPropose}><CalendarClock aria-hidden className="size-4"/>{tr(locale,'Offer another time','Առաջարկել մեկ այլ ժամ','Предложить другое время')}</button>}
  </div>}
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div className="min-w-0 space-y-1">
    <p className="flex items-center gap-2 text-h3"><CalendarClock aria-hidden className="size-5 shrink-0 text-brand-navy"/>{/* Shown outside the day groups, so it carries its own date. */rejected&&`${date(booking.startsAt,locale)} · `}{time(booking.startsAt,locale)}{locale==='ru'?' - ':'–'}{time(booking.endsAt,locale)}</p>
    <p className="break-words text-body2 font-medium">{fileHref?<a className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href={fileHref}>{booking.memberName||tr(locale,'Name not given','Անունը նշված չէ','Имя не указано')}</a>:booking.memberName||tr(locale,'Name not given','Անունը նշված չէ','Имя не указано')}</p>
    <p className="text-body2">{clinicMaskedPhone(masked,locale)}</p>
   </div>
   {/* A confirmed visit whose time has passed is not simply "Confirmed": nobody has recorded whether the member came. */}
   <p className="rounded-full border px-3 py-1 text-caption font-medium">{booking.status==='confirmed'&&noShowDue?tr(locale,'Confirmed · outcome not recorded','Հաստատված է · արդյունքը գրանցված չէ','Подтверждено · итог не отмечен'):tr(locale,en,hy,ru)}</p>
  </div>
  {booking.status==='change-requested'&&booking.previousStartsAt&&<p className="text-body2">{tr(locale,'Currently booked','Այժմ գրանցված է','Текущая запись')}: {date(booking.previousStartsAt,locale)} · {time(booking.previousStartsAt,locale)}</p>}
  {booking.tests.length>0&&<div><p className="text-caption text-muted-foreground">{tr(locale,'Tests at this visit','Այս այցի հետազոտությունները','Анализы на этом визите')}</p><ul className="list-disc pl-5 text-body2">{booking.tests.map(test=><li key={test} className="break-words">{clinicTestTitle(test,clinicalLocale(locale))}</li>)}</ul></div>}
  {booking.decline&&<p className="text-body2">{tr(locale,'Reason as entered','Պատճառը՝ ինչպես մուտքագրված է','Причина в исходной формулировке')}: <span className="break-words">{booking.decline.reason}</span></p>}
  {booking.proposal&&<div className="space-y-2 border-l-2 border-brand-navy pl-3"><p className="text-body2">{tr(locale,'New time proposed: ' ,'Առաջարկված նոր ժամ՝ ','Предложено новое время: ')} {date(booking.proposal.startsAt,locale)} · {time(booking.proposal.startsAt,locale)}. {tr(locale,'Waiting for the member to accept.','Սպասում է անդամի համաձայնությանը։','Ожидает согласия участника.')}</p>
   <button type="button" className={secondary} disabled={busy||uncertain} onClick={()=>void send({op:'withdraw-proposal',proposalId:booking.proposal!.id})}>{tr(locale,'Withdraw proposal','Հետ կանչել առաջարկը','Отозвать предложение')}</button></div>}
  {!portal&&(pending||current)&&<p className="text-caption text-muted-foreground">{tr(locale,'This visit was arranged by email. Contact Noreon to change it.','Այս այցը կազմակերպվել է էլ. նամակով։ Փոխելու համար կապվեք Նորեոն Հելթի հետ։','Этот визит согласован по электронной почте. Чтобы изменить его, обратитесь в Нореон Хелс.')}</p>}
  <div className="flex flex-wrap gap-2">
   {canDecide&&<button type="button" className={primary} onClick={()=>void send({op:'confirm'})}><Check aria-hidden className="size-4"/>{tr(locale,'Confirm visit','Հաստատել այցը','Подтвердить визит')}</button>}
   {canPropose&&(!rejected||panel==='propose')&&<button type="button" className={secondary} disabled={busy} aria-expanded={panel==='propose'} onClick={()=>{setPanel(panel==='propose'?'none':'propose');setError(null);}}>{tr(locale,'Propose another time','Առաջարկել այլ ժամ','Предложить другое время')}</button>}
   {canDecide&&<button type="button" className={secondary} aria-expanded={panel==='decline'} onClick={()=>{setPanel(panel==='decline'?'none':'decline');setError(null);}}><X aria-hidden className="size-4"/>{tr(locale,'Decline','Մերժել','Отклонить')}</button>}
   {!decisionOnly&&!receiptOnly&&current&&booking.status!=='arrived'&&booking.status!=='completed'&&arrivedDue&&<button type="button" className={secondary} disabled={busy||uncertain} onClick={()=>void send({op:'check-in',outcome:'arrived'})}><UserRoundCheck aria-hidden className="size-4"/>{tr(locale,'Mark arrived','Նշել՝ ներկայացել է','Отметить приход')}</button>}
   {!decisionOnly&&!receiptOnly&&current&&booking.status!=='no-show'&&booking.status!=='completed'&&noShowDue&&<button type="button" className={secondary} disabled={busy||uncertain} aria-expanded={panel==='no-show'} onClick={()=>setPanel(panel==='no-show'?'none':'no-show')}><UserRoundX aria-hidden className="size-4"/>{tr(locale,'Mark did not come','Նշել՝ չի ներկայացել','Отметить неявку')}</button>}
  </div>
  {futureCheckIn&&<p className="text-body2 text-muted-foreground">{tr(locale,'Check-in opens on','Այցի գրանցումը հասանելի կլինի','Отметить визит можно будет')} {timestamp(booking.startsAt,locale).replace(/ \d{4} · /,', ')}</p>}
  {receipt&&<p role="status" className="rounded-md bg-muted p-3 text-body2">{receipt}</p>}
  {panel==='no-show'&&<div className="space-y-2 rounded-md border p-3"><p className="text-body2">{tr(locale,'Mark this visit as did not come? Check that the member has not arrived.','Նշե՞լ, որ անդամը չի ներկայացել։ Ստուգեք՝ անդամը չի ժամանել։','Отметить неявку на этот визит? Проверьте, что участник не пришёл.')}</p><div className="flex flex-wrap gap-2"><button type="button" className={secondary} disabled={busy||uncertain} onClick={()=>void send({op:'check-in',outcome:'no-show'})}>{tr(locale,'Confirm did not come','Հաստատել՝ չի ներկայացել','Подтвердить неявку')}</button><button type="button" className={secondary} disabled={busy} onClick={()=>setPanel('none')}>{tr(locale,'Cancel','Չեղարկել','Отмена')}</button></div></div>}
  {panel==='decline'&&<form onSubmit={decline} className="space-y-3">
   <label className="block space-y-2 text-body2"><span className="font-medium">{tr(locale,'Reason for the member','Պատճառը անդամի համար','Причина для участника')}</span><span className="block text-caption text-muted-foreground">{tr(locale,'The member sees this. Do not include medical details.','Անդամը կտեսնի սա։ Մի նշեք բժշկական տվյալներ։','Участник увидит этот текст. Не указывайте медицинские данные.')}</span>
    <textarea value={reason} onChange={event=>setReason(event.target.value)} maxLength={500} rows={3} required className={field}/></label>
   <button className={`${secondary} text-destructive`} disabled={busy}>{tr(locale,'Decline request','Մերժել հարցումը','Отклонить запрос')}</button>
  </form>}
  {/* Closes by itself once the visit has started (the clock moves on): a proposal is offered only while it may be. */}
  {panel==='propose'&&canPropose&&<form ref={proposeForm} onSubmit={propose} className="space-y-3">
   <label className="block space-y-2 text-body2"><span className="font-medium">{tr(locale,'Day','Օր','День')}</span><input type="date" value={day} min={yerevanDay(now)} max={decisionOnly?yerevanDay(now+6*86400000):undefined} onChange={event=>void loadSlots(event.target.value)} className={field} required/></label>
   {day&&free===null&&<p role="status" className="text-body2">{tr(locale,'Loading free times…','Ազատ ժամերը բեռնվում են…','Загрузка свободного времени…')}</p>}
   {free==='failed'&&<p role="alert" className="flex flex-wrap items-center gap-3 text-body2">{tr(locale,'Free times could not be loaded.','Ազատ ժամերը չհաջողվեց բեռնել։','Не удалось загрузить свободное время.')}<button type="button" className="min-h-11 rounded-md border px-3 font-medium focus-visible:outline-2 focus-visible:outline-ring" onClick={()=>void loadSlots(day)}>{tr(locale,'Try again','Կրկին փորձել','Попробовать снова')}</button></p>}
   {Array.isArray(free)&&(free.length?<fieldset><legend className="mb-2 text-body2 font-medium">{tr(locale,'Free times (UTC+4)','Ազատ ժամեր (UTC+4)','Свободное время (UTC+4)')}, {date(free[0].startsAt,locale)}</legend><div className="space-y-4">{([true,false] as const).map(morning=>{const options=free.filter(option=>(Number(time(option.startsAt,locale).split(':')[0])<12)===morning);return options.length>0&&<div key={String(morning)} className="space-y-2"><p className="text-caption text-muted-foreground">{morning?tr(locale,'Morning','Առավոտ','Утро'):tr(locale,'Afternoon and evening','Կեսօրից հետո և երեկո','День и вечер')}</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{options.map(option=><label key={option.key} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 text-body2 has-[:checked]:border-brand-navy has-[:checked]:bg-muted"><input type="radio" name={`slot-${booking.appointmentId}`} value={option.key} checked={slot===option.key} onChange={()=>setSlot(option.key)} className="size-4 accent-primary"/>{time(option.startsAt,locale)}{locale==='ru'?' - ':'–'}{time(option.endsAt,locale)}</label>)}</div></div>;})}</div></fieldset>
    :<p role="status" className="text-body2">{tr(locale,'No free times that day.','Այդ օրը ազատ ժամեր չկան։','В этот день нет свободного времени.')}</p>)}
   <label className="block space-y-2 text-body2"><span className="font-medium">{tr(locale,'Note for the member (optional)','Նշում անդամի համար (ըստ ցանկության)','Примечание для участника (необязательно)')}</span><textarea value={note} onChange={event=>setNote(event.target.value)} maxLength={500} rows={2} className={field}/></label>
   <p className="text-caption text-muted-foreground">{tr(locale,'The booking stays as it is until the member accepts the new time.','Այցը չի փոխվում, մինչև անդամը չընդունի նոր ժամը։','Запись остаётся прежней, пока участник не примет новое время.')}</p>
   <button className={primary} disabled={busy||!slot}>{tr(locale,'Send proposal','Ուղարկել առաջարկը','Отправить предложение')}</button>
  </form>}
  {error&&<p role="alert" className="text-body2">{error}</p>}
 </li>;
}
