'use client';
import Link from 'next/link';
import {useEffect,useState,useSyncExternalStore} from 'react';
import {ArrowRight,CalendarClock,House} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {CareTeamDialog} from './care-team-dialog';
import type {MemberSearchRow} from '@/lib/staff/member-search-schema';
import {tx,type PatientLocale} from '@/lib/patient/copy';
import {memberRequestedAt} from '@/lib/staff/member-queue-format';
import {bookingTimestampText} from '@/lib/real-booking/display-time';
import {readMemberBookingSummaries} from '@/lib/staff/member-booking-summary-actions';
import type {MemberBookingSummary} from '@/lib/staff/member-booking-summary';

export type MemberQueueDirectory={id:string;name:string;clinic:string;clinicId?:string};
type Props={rows:MemberSearchRow[];role:'admin'|'doctor'|'nurse';doctors:MemberQueueDirectory[];nurses:MemberQueueDirectory[];locale?:PatientLocale;onAssignmentSaved?:(note?:string)=>void;bookingSummaryAction?:(ids:string[])=>Promise<Record<string,MemberBookingSummary|null>>};
type Filter='needs-doctor'|'home-open'|'all';
// QA N-05/F-06: a home visit stays a request in the admin queue until the provider terms are confirmed.
const homeOpen=(row:MemberSearchRow)=>row.bookingCounts.requested+row.bookingCounts.providerProposed+row.bookingCounts.changePending>0;

const NEW_WINDOW_MS=24*60*60*1000;
// A minute clock that is null on the server and during hydration, so the first
// client render matches the server's absolute time before switching to relative.
const minuteClock={
 subscribe(notify:()=>void){const timer=setInterval(notify,30_000);return ()=>clearInterval(timer);},
 snapshot:()=>Math.floor(Date.now()/60_000),
 server:()=>null,
};
function relative(value:string,minute:number,locale:PatientLocale){
 const minutes=Math.round((new Date(value).getTime()-minute*60_000)/60_000);
 const unit=Math.abs(minutes)<60?'minute':Math.abs(minutes)<24*60?'hour':Math.abs(minutes)<14*24*60?'day':null;
 if(!unit)return null;
 const amount=unit==='minute'?minutes:Math.round(minutes/(unit==='hour'?60:24*60));
 // Browser ICU often lacks Armenian relative time, so Armenian is written out.
 if(locale==='hy'){
  const n=Math.abs(amount);
  if(unit==='minute'&&n===0)return 'հիմա';
  if(unit==='day'&&n===1)return amount<0?'երեկ':'վաղը';
  return `${n} ${{minute:'րոպե',hour:'ժամ',day:'օր'}[unit]} ${amount<0?'առաջ':'հետո'}`;
 }
 return new Intl.RelativeTimeFormat(locale,{numeric:'auto'}).format(amount,unit);
}
export function initials(name:string|null){
 const parts=(name??'').trim().split(/\s+/).filter(Boolean);
 return ((parts[0]?.[0]??'')+(parts.length>1?parts.at(-1)![0]:'')).toLocaleUpperCase()||'?';
}
function Initials({name,size='md'}:{name:string|null;size?:'sm'|'md'}){
 return <span aria-hidden className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--surface-subtle-teal)] font-semibold text-brand-teal ${size==='md'?'size-10 text-body2':'size-6 text-overline'}`}>{initials(name)}</span>;
}
function Person({label,person,empty}:{label:string;person?:MemberQueueDirectory;empty:string}){
 return <div className="flex min-w-0 items-center gap-3 lg:block">
  <span className="w-16 shrink-0 text-overline text-muted-foreground lg:sr-only">{label}</span>
  {person?<span className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-pill border bg-card py-1 pr-3 pl-1" title={person.clinic?`${person.name} · ${person.clinic}`:person.name}>
   <Initials name={person.name} size="sm"/>
   <span className="min-w-0"><span className="block truncate text-body2">{person.name}</span>{person.clinic&&<span className="block truncate text-caption text-muted-foreground">{person.clinic}</span>}</span>
  </span>:<span className="inline-flex items-center rounded-pill border border-dashed px-3 py-1 text-caption text-muted-foreground">{empty}</span>}
 </div>;
}
function statusChips(row:MemberSearchRow,minute:number|null,locale:PatientLocale){
 const chips:{key:string;label:string;variant:'teal'|'warning'|'muted'|'success'|'attention'}[]=[];
 const c=row.bookingCounts;
 if(minute!==null&&minute*60_000-new Date(row.createdAt).getTime()<NEW_WINDOW_MS&&!row.doctorId)chips.push({key:'new',label:tx(locale,'Նոր','New','Новый'),variant:'teal'});
 chips.push(row.doctorId?{key:'doctor',label:tx(locale,'Բժիշկը նշանակված է','Doctor assigned','Врач назначен'),variant:'muted'}:{key:'doctor',label:tx(locale,'Բժիշկ է պետք','Needs a doctor','Нужен врач'),variant:'warning'});
 if(c.requested)chips.push({key:'requested',label:tx(locale,`${c.requested} հետազոտության հարցում`,`${c.requested} ${c.requested===1?'test':'tests'} requested`,`Запрошено исследований: ${c.requested}`),variant:'attention'});
 if(c.providerProposed)chips.push({key:'proposed',label:tx(locale,`${c.providerProposed}՝ սպասում է անդամին`,`${c.providerProposed} awaiting member`,`Ожидают участника: ${c.providerProposed}`),variant:'muted'});
 if(c.changePending)chips.push({key:'change',label:tx(locale,`${c.changePending}՝ փոփոխություն`,`${c.changePending} change pending`,`Ожидают изменения: ${c.changePending}`),variant:'attention'});
 if(c.confirmed)chips.push({key:'confirmed',label:tx(locale,`${c.confirmed} հաստատված`,`${c.confirmed} confirmed`,`Подтверждено: ${c.confirmed}`),variant:'success'});
 return chips;
}
function bookingSummary(counts:MemberSearchRow['bookingCounts'],locale:PatientLocale){
 return [
  counts.requested?tx(locale,`${counts.requested}՝ սպասում են մատակարարի պայմաններին`,`${counts.requested} awaiting provider terms`,`Ожидают условий поставщика: ${counts.requested}`):null,
  counts.providerProposed?tx(locale,`${counts.providerProposed}՝ սպասում են անդամի հաստատմանը`,`${counts.providerProposed} awaiting member acceptance`,`Ожидают подтверждения участника: ${counts.providerProposed}`):null,
  counts.changePending?tx(locale,`${counts.changePending}՝ սպասում են փոփոխության պատասխանին`,`${counts.changePending} awaiting provider change response`,`Ожидают ответа поставщика на изменение: ${counts.changePending}`):null,
  counts.confirmed?tx(locale,`${counts.confirmed} հաստատված`,`${counts.confirmed} confirmed`,`Подтверждено: ${counts.confirmed}`):null,
 ].filter(Boolean).join(' · ')||undefined;
}
function Requested({value,minute,locale}:{value:string;minute:number|null;locale:PatientLocale}){
 const exact=memberRequestedAt(value);
 const shown=minute===null?exact:relative(value,minute,locale)??exact;
 return <p className="text-caption text-muted-foreground">{tx(locale,'Հարցվել է','Requested','Запрошено')} <time dateTime={value} title={exact}>{shown}</time></p>;
}
function BookingLine({summary,locale}:{summary:MemberBookingSummary;locale:PatientLocale}){
 const state={'waiting-clinic':{label:tx(locale,'Սպասում է կլինիկային','Waiting for clinic','Ожидает клинику'),variant:'warning' as const},'confirmed':{label:tx(locale,'Հաստատված','Confirmed','Подтверждено'),variant:'success' as const},'attention':{label:tx(locale,'Ուշադրության կարիք ունի','Needs attention','Требует внимания'),variant:'danger' as const}}[summary.state];
 const home=summary.mode==='home';
 const label=home?(summary.state==='waiting-clinic'?tx(locale,'Տնային այցի հարցում','Home visit requested','Запрошен выезд на дом'):tx(locale,'Տնային այց','Home visit','Выезд на дом')):state.label;
 return <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
  {home?<House className="size-3.5 shrink-0" aria-hidden/>:<CalendarClock className="size-3.5 shrink-0" aria-hidden/>}
  <Badge variant={home&&summary.state==='waiting-clinic'?'warning':state.variant}>{label}</Badge>
  <span className="min-w-0 break-words">{bookingTimestampText(summary.startsAt,locale)}{!home&&summary.clinicName?` · ${summary.clinicName}`:''}</span>
 </p>;
}
const linkClass='inline-flex flex-1 sm:flex-none min-h-11 items-center justify-center gap-2 rounded-md px-3 text-body2 font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export function MemberQueueList({rows,role,doctors,nurses,locale='en',onAssignmentSaved,bookingSummaryAction=readMemberBookingSummaries}:Props){
 const minute=useSyncExternalStore(minuteClock.subscribe,minuteClock.snapshot,minuteClock.server);
 const [filter,setFilter]=useState<Filter>('all');
 const [bookings,setBookings]=useState<{key:string;summaries:Record<string,MemberBookingSummary|null>}>({key:'',summaries:{}});
 const bookingKey=role==='admin'?rows.map(row=>`${row.id}:${row.revision}`).join(','):'';
 useEffect(()=>{
  if(!bookingKey)return;
  let active=true;
  // Read-only; a failed read leaves those rows without a booking line. The action takes at most 50 ids,
  // so a list grown by "load more" is read in chunks (review item 40: past 50, every summary vanished).
  const ids=bookingKey.split(',').map(entry=>entry.split(':')[0]);
  const chunks=Array.from({length:Math.ceil(ids.length/50)},(_,i)=>ids.slice(i*50,i*50+50));
  void Promise.all(chunks.map(chunk=>bookingSummaryAction(chunk).catch(()=>({})))).then(parts=>{if(active)setBookings({key:bookingKey,summaries:Object.assign({},...parts)});});
  return ()=>{active=false;};
 },[bookingKey,bookingSummaryAction]);
 const summaries=bookings.key===bookingKey?bookings.summaries:{};
 if(role!=='admin')return <ul className="divide-y rounded-xl border bg-card">{rows.map(row=><li key={row.id} className="flex min-w-0 flex-wrap items-center gap-3 p-4">
  <Initials name={row.name}/>
  <div className="min-w-0 flex-1"><h2 className="text-body1 font-semibold break-words">{row.name??tx(locale,'Անդամ','Member','Участник')}{row.testAccount&&<> <Badge variant="warning" aria-label={tx(locale,'Փորձնական հաշիվ','Test account','Тестовая учётная запись')}>{tx(locale,'ՓՈՐՁՆԱԿԱՆ','TEST','ТЕСТ')}</Badge></>}</h2><Requested value={row.createdAt} minute={minute} locale={locale}/></div>
  <Link className={`${linkClass} border bg-background hover:bg-muted`} href={`/staff/real/members/${row.id}`}>{role==='nurse'?tx(locale,'Բացել կցված անդամին','Open assigned member','Открыть назначенного участника'):tx(locale,'Վերանայել անդամին','Review member','Проверить участника')}<ArrowRight className="size-4" aria-hidden/></Link>
 </li>)}</ul>;
 const needsDoctor=rows.filter(row=>!row.doctorId);
 const openHome=rows.filter(homeOpen);
 const shown=filter==='needs-doctor'?needsDoctor:filter==='home-open'?openHome:rows;
 const filters:{value:Filter;label:string;count:number}[]=[{value:'needs-doctor',label:tx(locale,'Բժիշկ է պետք','Needs a doctor','Нужен врач'),count:needsDoctor.length},{value:'home-open',label:tx(locale,'Բաց տնային հարցումներ','Open home requests','Открытые заявки на выезд'),count:openHome.length},{value:'all',label:tx(locale,'Բոլորը','All','Все'),count:rows.length}];
 return <div className="space-y-3">
  <div role="radiogroup" aria-label={tx(locale,'Ֆիլտր','Filter','Фильтр')} className="inline-flex rounded-md border bg-muted p-1">
   {filters.map(option=><button key={option.value} type="button" role="radio" aria-checked={filter===option.value} onClick={()=>setFilter(option.value)} className={`inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring ${filter===option.value?'bg-background text-foreground shadow-xs':'text-muted-foreground hover:text-foreground'}`}>{option.label}<span className="rounded-pill bg-muted px-2 text-caption tabular-nums">{option.count}</span></button>)}
  </div>
  <div aria-hidden className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_15.5rem] gap-4 px-4 text-overline text-muted-foreground lg:grid">
   <span>{tx(locale,'Անդամ','Member','Участник')}</span><span>{tx(locale,'Կարգավիճակ','Status','Статус')}</span><span>{tx(locale,'Բժիշկ','Doctor','Врач')}</span><span>{tx(locale,'Բուժքույր','Nurse','Медсестра')}</span><span/>
  </div>
  {shown.length?<ul className="divide-y rounded-xl border bg-card">{shown.map(row=>{
   const doctor=doctors.find(d=>d.id===row.doctorId);
   const nurse=nurses.find(n=>n.id===row.nurseId);
   const name=row.name??tx(locale,'Անդամ','Member','Участник');
   return <li key={row.id} className="grid min-w-0 gap-3 p-4 sm:grid-cols-2 lg:gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_15.5rem] lg:items-center">
    <div className="flex min-w-0 items-center gap-3 sm:col-span-2 lg:col-span-1">
     <Initials name={row.name}/>
     <div className="min-w-0"><h2 className="text-body1 font-semibold break-words">{name}{row.testAccount&&<> <Badge variant="warning" aria-label={tx(locale,'Փորձնական հաշիվ','Test account','Тестовая учётная запись')}>{tx(locale,'ՓՈՐՁՆԱԿԱՆ','TEST','ТЕСТ')}</Badge></>}</h2><Requested value={row.createdAt} minute={minute} locale={locale}/></div>
    </div>
    <div className="flex min-w-0 flex-wrap gap-1.5 sm:col-span-2 lg:col-span-1" title={bookingSummary(row.bookingCounts,locale)}>
     {statusChips(row,minute,locale).map(chip=><Badge key={chip.key} variant={chip.variant}>{chip.label}</Badge>)}
     {bookingSummary(row.bookingCounts,locale)&&<span className="sr-only">{bookingSummary(row.bookingCounts,locale)}</span>}
     {summaries[row.id]&&<div className="basis-full pt-1"><BookingLine summary={summaries[row.id]!} locale={locale}/></div>}
    </div>
    <Person label={tx(locale,'Բժիշկ','Doctor','Врач')} person={doctor} empty={row.doctorId?tx(locale,'Անհասանելի բժիշկ','Unavailable doctor','Врач недоступен'):tx(locale,'Բժիշկ չկա','No doctor','Врач не назначен')}/>
    <Person label={tx(locale,'Բուժքույր','Nurse','Медсестра')} person={nurse} empty={row.nurseId?tx(locale,'Անհասանելի բուժքույր','Unavailable nurse','Медсестра недоступна'):tx(locale,'Բուժքույր չկա','No nurse','Медсестра не назначена')}/>
    <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-1 lg:flex-nowrap lg:justify-end">
     <CareTeamDialog readToken={row} id={row.id} name={name} revision={row.revision} doctorId={row.doctorId} nurseId={row.nurseId} doctors={doctors} nurses={nurses} locale={locale} primary={!row.doctorId} onSaved={onAssignmentSaved}/>
     <Link className={`${linkClass} ${row.doctorId?'bg-primary text-primary-foreground hover:bg-primary/90':'border bg-background hover:bg-muted'}`} href={`/staff/real/members/${row.id}`}>{tx(locale,'Հարցումներ','Requests','Заявки')}<span className="sr-only">: {name}</span><ArrowRight className="size-4" aria-hidden/></Link>
    </div>
   </li>;})}</ul>:<p role="status" className="rounded-xl border bg-card p-5 text-body2">{filter==='home-open'?tx(locale,'Բեռնված անդամներից ոչ մեկը բաց տնային այցի հարցում չունի։','No loaded member has an open home visit request.','У загруженных участников нет открытых заявок на выезд на дом.'):tx(locale,'Բժշկի կարիք ունեցող անդամներ չկան։','Every loaded member has a doctor.','У каждого загруженного участника есть врач.')}</p>}
  <p className="text-caption text-muted-foreground">{tx(locale,'Կլինիկական այցերը հաստատում է կլինիկան իր պորտալում։','Clinic visits are confirmed by the clinic in its portal.','Клиника подтверждает визиты в своём портале.')}</p>
 </div>;
}
