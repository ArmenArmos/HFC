'use client';
import {lazy,Suspense,useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import type {Route} from 'next';
import {CircleHelp,Clock,UserCog,Building2,PanelTop,CalendarDays,FlaskConical,RefreshCw,ArrowUp,UsersRound} from 'lucide-react';
import {pick,type Locale} from '@/lib/locale';
import type {ClinicIdentity} from '@/lib/clinic-portal/schema';
import {yerevanDay,type ClinicBooking,type ScheduleCommand,type ScheduleResult,type FreeSlot} from '@/lib/clinic-scheduling/schema';
import type {ChatQuery} from '@/lib/clinic-chat/schema';
import type {ClinicChatReply} from '@/lib/clinic-chat/runtime';
import {ClinicFileLinkedNotice,ClinicMemberMaskedSummary,clinicMaskedPhone,clinicMaskedBirthYear} from './member-masked';
import {ClinicBookingCard,statusText} from './bookings';
import {ClinicBatchDetail} from './batch-detail';
import {CreateClinicBatch} from './create-batch';
import {ChatMemberFiles} from './chat-member-files';
import {MemberRecordsList} from './member-record-forms';
import {ChatMenuItems} from '@/components/staff/chat-menu-items';
import {clinicLabFileLabel,clinicBatchName,clinicDate,clinicTimestamp} from '@/lib/clinic-portal/display-time';
import {bookingActionReceipt} from '@/lib/clinic-chat/receipt';
import {EmptyStaffChat} from '@/components/staff/empty-chat';
import {useRealtimeSignals} from '@/components/realtime/use-realtime-signals';
/** WP V: loaded only for a clinic administrator with voice on. */
const StaffVoiceBar=lazy(()=>import('@/components/staff/staff-voice-bar').then(m=>({default:m.StaffVoiceBar})));

type Props={identity:ClinicIdentity;locale:Locale;actorScope:string;canChooseClinic:boolean;resultLink:boolean;initial:ClinicChatReply;initialQuery:ChatQuery;
 /** WP V: voice for the clinic administrator (server capability). */
 voice?:{available:boolean;live:boolean};
 read:(query:ChatQuery)=>Promise<ClinicChatReply>;run:(command:ScheduleCommand)=>Promise<ScheduleResult>;slots:(day:string)=>Promise<FreeSlot[]|null>};
/** A read that never answers must not leave the chat busy for good (every menu button is disabled while busy): after 25 seconds it counts as unavailable, and Refresh works. */
const timed=<T,>(read:Promise<T>)=>Promise.race([read,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Read timed out')),25_000))]);
const button='inline-flex min-h-11 items-center justify-center gap-2 rounded-full border bg-background px-4 py-2 text-body2 font-medium hover:bg-muted disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-ring';
const card='space-y-4 rounded-xl border bg-background p-4 sm:p-5';
const field='min-h-12 w-full min-w-0 rounded-md border bg-background px-3 text-body2';
const labels={
 records:{en:'Choose a member',hy:'Ընտրել անդամին',ru:'Выбрать участника'},
 home:{en:'What needs my attention?',hy:'Ի՞նչն է իմ ուշադրության կարիքը զգում։',ru:'Что требует моего внимания?'},
 bookings:{en:'Show bookings',hy:'Ցույց տալ այցերը',ru:'Показать записи'},
 members:{en:'Find a member',hy:'Գտնել անդամին',ru:'Найти участника'},
 batches:{en:'Show upload status',hy:'Ցույց տալ վերբեռնումների վիճակը',ru:'Показать статус загрузок'},
 batch:{en:'Show file status',hy:'Ցույց տալ ֆայլերի վիճակը',ru:'Показать статус файлов'},
 member:{en:'Open the member file',hy:'Բացել անդամի քարտը',ru:'Открыть карту участника'},
};
/** Fixed questions and typed cards. All facts are printed from the existing scoped records. */
export function ClinicChat({identity,locale,actorScope,canChooseClinic,resultLink,initial,initialQuery,read,run,slots,voice}:Props){
 const t=(en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});
 const [message,setMessage]=useState(''),[typed,setTyped]=useState(''),[guidance,setGuidance]=useState(false),[started,setStarted]=useState(initialQuery.kind!=='home'||initial.kind!=='home');
 const [reply,setReply]=useState(initial),[query,setQuery]=useState(initialQuery),[busy,setBusy]=useState(false);
 const [now,setNow]=useState(()=>initial.kind==='home'?Date.parse(initial.asOf):Date.now());
 const [search,setSearch]=useState(''),[scope,setScope]=useState<'upcoming'|'past'>('upcoming'),[day,setDay]=useState(''),[status,setStatus]=useState('');
 const [receipts,setReceipts]=useState<Record<string,{text:string;booking:ClinicBooking;terminal:boolean;position:number}>>({});
 const activeQuery=useRef(initialQuery);

 const sequence=useRef(0),answer=useRef<HTMLDivElement>(null);
 useEffect(()=>{const frame=requestAnimationFrame(()=>answer.current?.scrollTo({top:guidance?answer.current.scrollHeight:0,behavior:'smooth'}));return()=>cancelAnimationFrame(frame);},[query,guidance]);
 const href=(section:string)=>`/clinic/real/${section}?clinic=${identity.clinicId}&locale=${locale}` as Route;
 async function ask(next:ChatQuery){
  const request=++sequence.current;activeQuery.current=next;setBusy(true);setReceipts({});setStarted(true);setGuidance(false);setQuery(next);
  const result=await timed(read(next)).catch(()=>({kind:'unavailable'} as const));
  if(request!==sequence.current)return;
  setReply(result);setNow(Date.now());setBusy(false);
 }
 const refreshMemberFiles=useCallback(async(memberId:string)=>{
  const current=activeQuery.current;
  if(current.kind!=='member'||current.memberId!==memberId)return;
  const request=++sequence.current;
  const result=await timed(read(current)).catch(()=>({kind:'unavailable'} as const));
  if(request===sequence.current){setReply(result);setBusy(false);}
 },[read]);
 // WP R: a clinic_thread signal (a booking or an upload batch of this clinic changed; ids only) re-reads the view on screen
 // when nothing is in flight. The read stays the source of truth; the clinic chat has no other polling.
 const busyRef=useRef(busy);
 useEffect(()=>{busyRef.current=busy;},[busy]);
 const rereadView=useCallback(async()=>{
  if(busyRef.current)return;
  const current=activeQuery.current;
  if(current.kind!=='home'&&current.kind!=='bookings'&&current.kind!=='batches'&&current.kind!=='batch')return;
  const request=++sequence.current;
  const result=await timed(read(current)).catch(()=>null);
  if(result&&request===sequence.current){setReply(result);setNow(Date.now());}
 },[read]);
 useRealtimeSignals({plane:'clinic',onSignal:useCallback((kind:string)=>{if(kind==='clinic_thread')void rereadView();},[rereadView]),onResync:useCallback(()=>void rereadView(),[rereadView])});
 async function decide(command:ScheduleCommand,booking:ClinicBooking){
  const before=activeQuery.current;
  const source=reply.kind==='home'?attention:reply.kind==='bookings'&&reply.result.status==='loaded'&&reply.result.data.enabled?reply.result.data.bookings:[];
  const position=receipts[booking.reference]?.position??source.findIndex(item=>item.reference===booking.reference);
  const result=await run(command);
  if(result.status==='saved'){
   // Keep the outcome beside its visit, even when that visit leaves the waiting queue.
   if(activeQuery.current===before)setReceipts(old=>({...old,[booking.reference]:{text:bookingActionReceipt(booking,command,result,locale),booking:result.booking??booking,terminal:!result.booking,position}}));
   const current=activeQuery.current,request=++sequence.current;
   const refreshed=await timed(read(current)).catch(()=>({kind:'unavailable'} as const));
   if(request===sequence.current){setReply(refreshed);setBusy(false);}
  }
  return result;
 }
 const bookingCards=(bookings:ClinicBooking[],keepSaved=false)=>{
  const rows=[...bookings];if(keepSaved)for(const saved of Object.values(receipts).sort((a,b)=>a.position-b.position))if(!rows.some(b=>b.reference===saved.booking.reference))rows.splice(saved.position<0?rows.length:Math.min(saved.position,rows.length),0,saved.booking);
  const groups=new Map<string,ClinicBooking[]>();
  for(const original of rows){const saved=receipts[original.reference]?.booking;const b=saved&&saved.revision>=original.revision?saved:original;const key=b.rejectedProposal&&(query.kind!=='bookings'||query.scope==='upcoming')&&Date.parse(b.startsAt)>now?'needs-time':yerevanDay(b.startsAt);groups.set(key,[...(groups.get(key)??[]),b]);}
  const ordered=[...groups].sort(([a],[b])=>a==='needs-time'?-1:b==='needs-time'?1:query.kind==='bookings'&&query.scope==='past'?b.localeCompare(a):a.localeCompare(b));
  return <>{ordered.map(([key,rows])=><section key={key} className="space-y-3"><h3 className="text-body2 font-semibold">{key==='needs-time'?t('Needs another time','Պետք է նոր ժամ','Нужно другое время'):clinicDate(key,locale)} {key!=='needs-time'&&'(UTC+4)'}</h3><ul className="space-y-3">{rows.map(b=><ClinicBookingCard key={`${b.reference}:${b.revision}:${b.proposal?.id??''}`} booking={b} masked={reply.maskedMembers?.find(m=>m.memberId===b.memberId)} receipt={receipts[b.reference]?.text} receiptOnly={receipts[b.reference]?.terminal&&b.revision<=receipts[b.reference].booking.revision} locale={locale} run={decide} slots={slots} fileHref={b.memberId?`${href('chat')}&member=${b.memberId}`:undefined}/>)}</ul></section>)}</>;
 };
 const empty=<p role="status" className="text-body2 text-muted-foreground">{t('No matching records in your clinic.','Ձեր կլինիկայում համապատասխան գրառումներ չկան։','В вашей клинике нет подходящих записей.')}</p>;
 const unavailable=<p role="alert" className="text-body2">{t('These records could not load. Refresh to try again.','Այս գրառումները չհաջողվեց բեռնել։ Թարմացրեք՝ կրկին փորձելու համար։','Не удалось загрузить эти записи. Обновите данные, чтобы попробовать снова.')}</p>;
 const disabled=<p role="status" className="text-body2">{t('Scheduling is not switched on for your clinic.','Ձեր կլինիկայի համար այցերի կառավարումը միացված չէ։','Управление записями для вашей клиники не включено.')}</p>;
 const member=reply.kind==='member'&&reply.result.status==='loaded'?reply.result.data:null;
 const bookingData=reply.kind==='home'&&reply.bookings.status==='loaded'&&reply.bookings.data.enabled?reply.bookings.data.bookings:null;
 const waiting=bookingData?.filter(b=>b.status==='requested'||b.status==='change-requested')??[];
 const another=bookingData?.filter(b=>b.rejectedProposal&&Date.parse(b.startsAt)>now)??[];
 const attention=[...new Map([...another,...waiting].map(b=>[b.reference,b])).values()];
 const todayBookings=reply.kind==='home'&&reply.today.status==='loaded'&&reply.today.data.enabled?reply.today.data.bookings:[];
 const waitingBatches=reply.kind==='home'&&reply.batches.status==='loaded'?reply.batches.data.batches.filter(batch=>batch.attentionCount>0):[];
 const menuButton='inline-flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-left text-body2 hover:bg-muted disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-ring';

 function send(event:FormEvent){event.preventDefault();route(message);}
 /** The composer's keyword routing, shared by typed and spoken text (WP V). */
 function route(raw:string){
  const text=raw.trim().toLocaleLowerCase();if(!text||busy)return;setTyped(raw.trim());setMessage('');
  if(/attention|waiting|սպաս|ուշադր|вниман|ожида/.test(text)){void ask({kind:'home'});return;}
  if(/upload|file|batch|վերբեռ|ֆայլ|փաթեթ|загруз|файл|пакет/.test(text)){void ask({kind:'batches',cursor:null});return;}
  if(/member|record|անդամ|քարտ|участ|карт/.test(text)){setSearch('');void ask(identity.capability==='clinic_admin'&&identity.fullAccess?{kind:'records'}:{kind:'members',query:'',page:1});return;}
  if(/book|visit|այց|запис|при[её]м/.test(text)){setScope('upcoming');setDay('');setStatus('');void ask({kind:'bookings',scope:'upcoming',day:null});return;}
  setGuidance(true);
 }
 function find(event:FormEvent){event.preventDefault();void ask({kind:'members',query:search,page:1});}
 return <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
  <ChatMenuItems target="clinic-chat-menu" locale={locale}>
  <nav aria-label={t('Clinic questions','Հարցեր կլինիկայի մասին','Вопросы о клинике')} className="flex flex-col gap-1">
   <button className={menuButton} disabled={busy} onClick={()=>void ask({kind:'home'})}><CircleHelp aria-hidden className="size-4"/>{pick(locale,labels.home)}</button>
   <button className={menuButton} disabled={busy} onClick={()=>{setScope('upcoming');setDay('');setStatus('');void ask({kind:'bookings',scope:'upcoming',day:null});}}><CalendarDays aria-hidden className="size-4"/>{pick(locale,labels.bookings)}</button>
   <button className={menuButton} disabled={busy} onClick={()=>{setSearch('');void ask(identity.capability==='clinic_admin'&&identity.fullAccess?{kind:'records'}:{kind:'members',query:'',page:1});}}><UsersRound aria-hidden className="size-4"/>{pick(locale,labels.members)}</button>
   <button className={menuButton} disabled={busy} onClick={()=>void ask({kind:'batches',cursor:null})}><FlaskConical aria-hidden className="size-4"/>{pick(locale,labels.batches)}</button>
   {identity.capability==='clinic_admin'&&<><Link className={menuButton} href={href('hours')}><Clock aria-hidden className="size-4"/>{t('Hours and capacity','Ժամեր և տարողություն','Часы и вместимость')}</Link><Link className={menuButton} href={href('team')}><UserCog aria-hidden className="size-4"/>{t('Team','Թիմ','Команда')}</Link></>}
   {canChooseClinic&&<Link className={menuButton} href={`/clinic/real/select?locale=${locale}`}><Building2 aria-hidden className="size-4"/>{t('Choose a clinic','Ընտրել կլինիկան','Выбрать клинику')}</Link>}
  <Link className={menuButton} href={href('bookings')}><PanelTop aria-hidden className="size-4"/>{t('Open clinic pages','Բացել կլինիկայի էջերը','Открыть страницы клиники')}</Link>
  </nav></ChatMenuItems>
  <div ref={answer} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pb-4" aria-live="polite">
  {!started&&reply.kind==='home'&&reply.bookings.status==='loaded'&&reply.bookings.data.enabled&&reply.today.status==='loaded'&&reply.today.data.enabled&&reply.batches.status==='loaded'&&!attention.length&&!todayBookings.length&&!waitingBatches.length&&<EmptyStaffChat locale={locale}/>}
  {!started&&reply.kind==='home'&&(reply.bookings.status!=='loaded'||reply.today.status!=='loaded'||reply.batches.status!=='loaded')&&unavailable}
  {!started&&reply.kind==='home'&&reply.bookings.status==='loaded'&&!reply.bookings.data.enabled&&disabled}
  {started&&<><div className="flex justify-end"><p className="max-w-full rounded-xl bg-primary px-4 py-3 text-body2 text-primary-foreground">{pick(locale,labels[query.kind])}</p></div>
  <div aria-busy={busy} className="scroll-mt-4 space-y-4">
   <div className="flex items-center justify-between gap-3"><p className="text-body2 font-semibold">{t('Clinic assistant','Կլինիկայի օգնական','Помощник клиники')}</p><button className={button} disabled={busy} onClick={()=>void ask(query)}><RefreshCw aria-hidden className="size-4"/>{t('Refresh','Թարմացնել','Обновить')}</button></div>
   {busy?<p role="status" className={card}>{t('Reading your clinic’s records…','Բեռնվում են ձեր կլինիկայի գրառումները…','Загружаются записи вашей клиники…')}</p>:<>
   {reply.kind==='home'&&<>
    <p className="text-caption text-muted-foreground">{t('Showing up to 300 bookings and 50 batches. Refresh for changes.','Ցուցադրվում է մինչև 300 այց և 50 փաթեթ։ Փոփոխությունների համար թարմացրեք։','Показано до 300 записей и 50 пакетов. Обновите данные, чтобы увидеть изменения.')}</p>
    {reply.bookings.status!=='loaded'?unavailable:!reply.bookings.data.enabled?disabled:<section className="space-y-4"><h2 className="text-h3">{t('Waiting for you','Սպասում է ձեզ','Ожидает вас')}</h2>{attention.length||Object.keys(receipts).length?bookingCards(attention,true):empty}</section>}
    {reply.today.status!=='loaded'?<p role="alert" className="text-body2">{t('Today’s bookings could not load. Refresh to try again.','Այսօրվա այցերը չհաջողվեց բեռնել։ Թարմացրեք՝ կրկին փորձելու համար։','Не удалось загрузить записи на сегодня. Обновите данные, чтобы попробовать снова.')}</p>:!reply.today.data.enabled&&disabled}
    {todayBookings.some(b=>!attention.some(a=>a.reference===b.reference)&&!receipts[b.reference])&&<section className="space-y-4"><h2 className="text-h3">{t('Today’s bookings','Այսօրվա այցերը','Записи на сегодня')}</h2>{bookingCards(todayBookings.filter(b=>!attention.some(a=>a.reference===b.reference)&&!receipts[b.reference]))}</section>}
    {waitingBatches.length>0&&<section className="space-y-4"><h2 className="text-h3">{t('Files needing attention','Ուշադրության կարիք ունեցող ֆայլեր','Файлы, требующие внимания')}</h2>{waitingBatches.map(batch=><button key={batch.id} type="button" className="block min-h-11 text-left text-body2 underline" onClick={()=>void ask({kind:'batch',batchId:batch.id,cursor:null})}>{clinicBatchName(batch.name,locale)} ({batch.attentionCount})</button>)}</section>}
    {reply.batches.status!=='loaded'&&unavailable}
   </>}
   {reply.kind==='bookings'&&<section className="space-y-4">
    <h2 className="text-h3">{t('Bookings','Այցեր','Записи')}</h2>
    <div className="flex flex-wrap gap-2">{(['upcoming','past'] as const).map(value=><button key={value} className={button} disabled={busy} aria-pressed={scope===value} onClick={()=>{setScope(value);void ask({kind:'bookings',scope:value,day:day||null});}}>{value==='upcoming'?t('Upcoming','Առաջիկա','Предстоящие'):t('Past','Անցած','Прошедшие')}</button>)}</div>
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={event=>{event.preventDefault();void ask({kind:'bookings',scope,day:day||null});}}>
     <label className="space-y-2 text-body2"><span>{t('Day','Օր','День')}</span><input className={field} type="date" value={day} onChange={e=>setDay(e.target.value)}/></label>
     <label className="space-y-2 text-body2"><span>{t('Status','Կարգավիճակ','Статус')}</span><select className={field} value={status} onChange={e=>setStatus(e.target.value)}>
      <option value="">{t('All','Բոլորը','Все')}</option>{(['requested','confirmed','change-requested','proposal','arrived','no-show','cancelled','declined'] as const).map(value=><option key={value} value={value}>{value==='proposal'?t('Proposal sent','Առաջարկն ուղարկված է','Предложение отправлено'):statusText[value][locale==='ru'?2:locale==='hy'?1:0]}</option>)}
     </select></label><button className={button}>{t('Show bookings','Ցույց տալ այցերը','Показать записи')}</button>
    </form>
    {reply.result.status!=='loaded'?unavailable:!reply.result.data.enabled?disabled:<>{reply.result.data.bookings.length===300&&<p className="text-caption">{t('Showing up to 300 bookings. Choose a day to narrow the list.','Ցուցադրվում է մինչև 300 այց։ Ցանկը նեղացնելու համար ընտրեք օրը։','Показано до 300 записей. Выберите день, чтобы сузить список.')}</p>}{(()=>{const rows=reply.result.data.bookings.filter(b=>!status||(status==='proposal'?!!b.proposal:b.status===status));return rows.length||Object.keys(receipts).length?bookingCards(rows,true):empty;})()}</>}
   </section>}
   {reply.kind==='batches'&&<section className="space-y-4"><h2 className="text-h3">{t('Upload status','Վերբեռնումների վիճակ','Статус загрузок')}</h2><p className="text-body2 text-muted-foreground">{t('Counts come from stored batches. Open a batch to see each file’s status.','Քանակները պահպանված փաթեթներից են։ Բացեք փաթեթը՝ յուրաքանչյուր ֆայլի վիճակը տեսնելու համար։','Числа взяты из сохранённых пакетов. Откройте пакет, чтобы увидеть статус каждого файла.')}</p>
    {reply.result.status!=='loaded'?unavailable:<>{reply.result.data.batches.length?<ul className="divide-y">{reply.result.data.batches.map(b=><li className="space-y-1 py-3" key={b.id}><button className="inline-flex min-h-11 items-center break-words text-left text-body2 font-medium underline" onClick={()=>void ask({kind:'batch',batchId:b.id,cursor:null})}>{b.name}</button><p className="text-caption text-muted-foreground">{t('Files','Ֆայլեր','Файлы')}: {b.fileCount} · {t('Need attention','Ուշադրության կարիք ունեն','Требуют внимания')}: {b.attentionCount}</p></li>)}</ul>:empty}{reply.result.data.nextCursor&&<button className={button} onClick={()=>void ask({kind:'batches',cursor:reply.result.status==='loaded'?reply.result.data.nextCursor:null})}>{t('Next batches','Հաջորդ փաթեթները','Следующие пакеты')}</button>}</>}
    {reply.result.status==='loaded'&&(identity.fullAccess?<button className={button} onClick={()=>void ask(identity.capability==='clinic_admin'&&identity.fullAccess?{kind:'records'}:{kind:'members',query:'',page:1})}>{t('Choose a member','Ընտրել անդամին','Выбрать участника')}</button>:<CreateClinicBatch clinicId={identity.clinicId} actorScope={actorScope} locale={locale} onCreated={batchId=>void ask({kind:'batch',batchId,cursor:null})}/>)}
   </section>}
   {reply.kind==='batch'&&<section className="space-y-4">{reply.result.status!=='loaded'?unavailable:<ClinicBatchDetail key={`${actorScope}:${reply.result.data.batch.id}`} initial={reply.result.data} actorScope={actorScope} locale={locale} resultLink={resultLink} uploadFromRecords={identity.fullAccess===true} embedded onOpenMember={()=>void ask(identity.capability==='clinic_admin'&&identity.fullAccess?{kind:'records'}:{kind:'members',query:'',page:1})}/>}</section>}
   {reply.kind==='records'&&<section className="space-y-4"><h2 className="text-h3">{t('Choose a member','Ընտրել անդամին','Выбрать участника')}</h2>{reply.result.status==='loaded'?<MemberRecordsList clinicId={identity.clinicId} locale={locale} rows={reply.result.patients} maskedMembers={reply.maskedMembers??reply.result.maskedMembers} onOpen={memberId=>void ask({kind:'member',memberId})}/>:reply.result.status==='disabled'?disabled:unavailable}</section>}
   {reply.kind==='members'&&<section className="space-y-4"><h2 className="text-h3">{t('Members known to your clinic','Ձեր կլինիկային հայտնի անդամները','Участники, известные вашей клинике')}</h2><form onSubmit={find} className="flex flex-wrap gap-2"><label className="min-w-0 flex-1 space-y-2 text-body2"><span>{t('Name or last 4 phone digits','Անուն կամ հեռախոսի վերջին 4 թվանշանը','Имя или последние 4 цифры телефона')}</span><input className={field} maxLength={100} value={search} onChange={e=>setSearch(e.target.value)}/></label><button className={`${button} self-end`}>{t('Find a member','Գտնել անդամին','Найти участника')}</button></form>
    {reply.result.status!=='loaded'?unavailable:!reply.result.data.enabled?disabled:<>{reply.result.data.members.length?<ul className="divide-y">{reply.result.data.members.map(m=><li key={m.memberId} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><p className="text-body2 font-medium">{m.name}</p><p className="text-caption text-muted-foreground"><ClinicMemberMaskedSummary member={reply.maskedMembers?.find(masked=>masked.memberId===m.memberId)} locale={locale}/></p></div><button className={button} onClick={()=>void ask({kind:'member',memberId:m.memberId})}>{t('Open file','Բացել քարտը','Открыть карту')}</button></li>)}</ul>:empty}<div className="flex flex-wrap gap-2">{reply.result.data.page>1&&<button className={button} onClick={()=>void ask({kind:'members',query:query.kind==='members'?query.query:'',page:reply.result.status==='loaded'&&reply.result.data.enabled?reply.result.data.page-1:1})}>{t('Previous members','Նախորդ անդամները','Предыдущие участники')}</button>}{reply.result.data.page*reply.result.data.pageSize<reply.result.data.total&&<button className={button} onClick={()=>void ask({kind:'members',query:query.kind==='members'?query.query:'',page:reply.result.status==='loaded'&&reply.result.data.enabled?reply.result.data.page+1:1})}>{t('Next members','Հաջորդ անդամները','Следующие участники')}</button>}</div></>}
   </section>}
   {reply.kind==='member'&&<section className="space-y-4">
    {!member?reply.result.status==='missing'?<p role="alert">{t('This member is not in your clinic’s records.','Այս անդամը ձեր կլինիկայի գրառումներում չէ։','Этого участника нет в записях вашей клиники.')}</p>:reply.result.status==='disabled'?disabled:unavailable:<>
     <h2 className="break-words text-h3">{member.member.name}</h2><p className="text-caption text-muted-foreground">{t('Your clinic’s bookings and lab file records. Opening this file is recorded.','Միայն ձեր կլինիկայի այցերը և լաբորատոր ֆայլերը։ Այս քարտի բացումը գրանցվում է։','Только записи и лабораторные файлы вашей клиники. Открытие этой карты фиксируется.')}</p>
     <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body2"><dt>{t('Phone','Հեռախոս','Телефон')}</dt><dd>{clinicMaskedPhone(reply.maskedMembers?.find(m=>m.memberId===member.member.memberId),locale)}</dd><dt>{t('Date of birth','Ծննդյան ամսաթիվ','Дата рождения')}</dt><dd>{clinicMaskedBirthYear(reply.maskedMembers?.find(m=>m.memberId===member.member.memberId),locale)}</dd></dl>
     <h3 className="text-body2 font-semibold">{t('Bookings with your clinic','Այցեր ձեր կլինիկայում','Записи в вашу клинику')}</h3>
     {member.bookings.length?<ul className="divide-y">{member.bookings.map(b=><li key={b.reference} className="space-y-1 py-3 text-body2"><p>{clinicTimestamp(b.startsAt,locale)} (UTC+4)</p><p>{statusText[b.status][locale==='ru'?2:locale==='hy'?1:0]}</p><p className="break-words">{b.tests.join(', ')}</p></li>)}</ul>:empty}
     <h3 className="text-body2 font-semibold">{t('Lab files from your clinic','Ձեր կլինիկայի լաբորատոր ֆայլերը','Лабораторные файлы вашей клиники')}</h3>
     {member.files.length?<ul className="divide-y">{member.files.map(f=><li className="space-y-1 py-3" key={f.fileId}><p className="break-words text-body2">{clinicLabFileLabel(f.uploadedAt,locale)}</p><p className="text-caption text-muted-foreground">{t('Uploaded','Վերբեռնվել է','Загружено')} {clinicDate(f.uploadedAt,locale)}</p><ClinicFileLinkedNotice locale={locale}/></li>)}</ul>:<p className="text-body2 text-muted-foreground">{t('No lab files from your clinic yet.','Ձեր կլինիկայից լաբորատոր ֆայլեր դեռ չկան։','Лабораторных файлов вашей клиники пока нет.')}</p>}
     {identity.capability==='clinic_admin'&&identity.fullAccess&&<ChatMemberFiles key={`${actorScope}:${member.member.memberId}`} clinicId={identity.clinicId} actorScope={actorScope} memberId={member.member.memberId} memberName={member.member.name} masked={reply.maskedMembers?.find(m=>m.memberId===member.member.memberId)} locale={locale} onChanged={()=>refreshMemberFiles(member.member.memberId)}/>}
    </>}
   </section>}
   {(reply.kind==='access'||reply.kind==='invalid'||reply.kind==='unavailable')&&<div className={card}>{reply.kind==='access'?<p role="alert">{t('Your clinic access changed. Reload the page to continue.','Կլինիկայի ձեր հասանելիությունը փոխվել է։ Շարունակելու համար վերաբեռնեք էջը։','Ваш доступ к клинике изменился. Перезагрузите страницу, чтобы продолжить.')}</p>:unavailable}</div>}
   </>}
  </div></>}
  {guidance&&typed&&<div className="flex justify-end"><p className="max-w-full break-words rounded-xl bg-primary px-4 py-3 text-body2 text-primary-foreground">{typed}</p></div>}
  {guidance&&<p role="status" className={card}>{t('Ask for bookings, members or upload status, or choose an action in Menu.','Հարցրեք այցերի, անդամների կամ վերբեռնումների վիճակի մասին, կամ ընտրեք գործողություն ընտրացանկից։','Спросите о записях, участниках или статусе загрузок либо выберите действие в меню.')}</p>}
  </div>

  <footer className="shrink-0 border-t bg-background pt-3 pb-[env(safe-area-inset-bottom)]">
   <form aria-label={t('Message the clinic assistant','Գրել կլինիկայի օգնականին','Написать помощнику клиники')} onSubmit={send} className="flex items-end gap-2">
    <label className="min-w-0 flex-1"><span className="sr-only">{t('Your message','Ձեր հաղորդագրությունը','Ваше сообщение')}</span><input name="clinic-message" className={field} value={message} maxLength={100} onChange={event=>setMessage(event.target.value)} placeholder={t('Ask your clinic assistant…','Գրեք կլինիկայի օգնականին…','Спросите помощника клиники…')}/></label>
    {voice?.available&&identity.capability==='clinic_admin'&&<Suspense fallback={null}><StaffVoiceBar locale={locale} role="clinic_admin" available live={voice.live} onIntent={action=>{if(action.kind==='open_operations'){void ask({kind:'bookings',scope:'upcoming',day:null});return true;}if(action.kind==='open_worklist'){void ask({kind:'home'});return true;}return false;}} onText={text=>setMessage(text.slice(0,100))} onSubmit={text=>route(text.slice(0,100))}/></Suspense>}
    <button aria-label={t('Send','Ուղարկել','Отправить')} className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-ring" disabled={busy||!message.trim()}><ArrowUp aria-hidden className="size-5"/></button>
   </form>
   <p className="pt-2 text-caption text-muted-foreground">{t('Bookings and files only. No clinical advice.','Միայն այցեր և ֆայլեր։ Առանց բժշկական խորհրդի։','Только записи и файлы. Без медицинских рекомендаций.')}</p>
  </footer>
 </div>;
}
