'use client';
import {useRef,useState,useTransition} from 'react';
import {AdminBookingCard} from './admin-booking-card';
import {CareTeamDialog} from '@/components/real-review/care-team-dialog';
import {RealCoordinationTasks,type CoordinationActions} from '@/components/staff/real-coordination-tasks';
import type {CareTeamActions} from '@/lib/staff/care-team-save';
import type {AdminActionCard,AdminCardKind} from '@/lib/admin-chat/card-contracts';
import type {MemberSearchPage} from '@/lib/staff/member-search-schema';
import * as server from '@/lib/admin-chat/card-actions';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';

const button='min-h-11 rounded-md border px-4 text-body2 disabled:opacity-50';
export function AdminActionCards({locale:l,onUnavailable,onWorkingChange}:{locale:StaffLocale;onUnavailable:(reason:'off'|'denied')=>void;onWorkingChange?:(working:boolean)=>void}){
 const [careCard,setCareCard]=useState<Extract<AdminActionCard,{kind:'care-team'}>|null>(null);
 const [taskCard,setTaskCard]=useState<Extract<AdminActionCard,{kind:'tasks'}>|null>(null);
 const [bookingCard,setBookingCard]=useState<Extract<AdminActionCard,{kind:'bookings'}>|null>(null);
 const [selected,setSelected]=useState<AdminCardKind|null>(null);
 const [careVersion,setCareVersion]=useState(0);
 const inFlight=useRef(0);
 const [message,setMessage]=useState('');
 const [pending,start]=useTransition();
 const busy=useRef(false);
 const [working,setWorking]=useState(false);
 // Keep the existing controls' uncertain-request state on transport errors. Only
 // a definitive access refusal clears the card and all earlier chat records.
 async function unwrap<T>(request:()=>Promise<{access:'allowed';result:T}|{access:'off'|'denied'}>):Promise<T>{
  inFlight.current++;setWorking(true);onWorkingChange?.(true);
  try{
   const response=await request();
   if(response.access!=='allowed'){setCareCard(null);setTaskCard(null);setBookingCard(null);onUnavailable(response.access);throw Error('Admin chat unavailable.');}
   return response.result;
  }finally{inFlight.current--;setWorking(inFlight.current>0);onWorkingChange?.(inFlight.current>0);}
 }
 const taskActions:CoordinationActions={
  coordinationCommand:input=>unwrap(()=>server.adminCoordinationCommand(input)),
  refreshCoordinationTask:input=>unwrap(()=>server.refreshAdminCoordinationTask(input)),
  readCoordinationPage:input=>unwrap(()=>server.readAdminCoordinationPage(input)),
  searchCoordinationMembers:input=>unwrap(()=>server.searchAdminCoordinationMembers(input)),
 };
 const careActions:CareTeamActions={
  assignDoctor:(previous,form)=>unwrap(()=>server.assignAdminChatDoctor(previous,form)),
  assignNurse:(previous,form)=>unwrap(()=>server.assignAdminChatNurse(previous,form)),
 };
 function open(kind:AdminCardKind){
  if(busy.current||inFlight.current)return;
  busy.current=true;setSelected(kind);setMessage('');
  start(async()=>{
   try{const result=await unwrap(()=>server.readAdminActionCard(kind));if(result.kind==='bookings')setBookingCard(result);else if(result.kind==='tasks')setTaskCard(result);else{setCareCard(result);setCareVersion(value=>value+1);}}
   catch{setSelected(null);setMessage(st(l,'This card could not load. Open it again to read current records.','Այս քարտը չհաջողվեց բեռնել։ Կրկին բացեք՝ ընթացիկ գրառումները կարդալու համար։','Не удалось загрузить карточку. Откройте её снова, чтобы получить актуальные записи.'));}
   finally{busy.current=false;}
  });
 }
 return <section className="space-y-4" aria-label={st(l,'Actions in chat','Գործողություններ զրույցում','Действия в чате')}>
  <div className="flex flex-wrap gap-2">
   <button type="button" disabled={pending||working} className="dw-pill text-caption" onClick={()=>open('bookings')}>{st(l,'Manage bookings and contact','Կառավարել ամրագրումներն ու կապը','Управлять записями и контактами')}</button>
   <button type="button" disabled={pending||working} className="dw-pill text-caption" onClick={()=>open('care-team')}>{st(l,'Assign or change a care team','Նշանակել կամ փոխել խնամքի թիմը','Назначить или изменить команду заботы')}</button>
   <button type="button" disabled={pending||working} className="dw-pill text-caption" onClick={()=>open('tasks')}>{st(l,'Manage coordination tasks','Կառավարել համակարգման առաջադրանքները','Управлять задачами координации')}</button>
  </div>
  {pending&&<p role="status">{st(l,'Reading current records…','Կարդացվում են ընթացիկ գրառումները…','Загружаем актуальные записи…')}</p>}
  {message&&<p role="alert">{message}</p>}
  {bookingCard&&<div hidden={selected!=='bookings'||pending} className="min-w-0 rounded-xl bg-card p-4"><AdminBookingCard page={bookingCard.page} locale={l} unwrap={unwrap}/></div>}
  {taskCard&&<div hidden={selected!=='tasks'||pending} className="min-w-0 rounded-xl bg-card p-4"><RealCoordinationTasks {...taskCard} locale={l} actions={taskActions}/></div>}
  {careCard&&<div hidden={selected!=='care-team'||pending} className="min-w-0 rounded-xl bg-card p-4"><CareTeamCard key={careVersion} card={careCard} locale={l} actions={careActions} search={input=>unwrap(()=>server.searchAdminCareMembers(input))}/></div>}
 </section>;
}

function CareTeamCard({card,locale:l,actions,search}:{card:Extract<AdminActionCard,{kind:'care-team'}>;locale:StaffLocale;actions:CareTeamActions;search:(input:unknown)=>ReturnType<typeof import('@/lib/staff/real-member-search-actions').searchRealMembers>}){
 const [page,setPage]=useState<MemberSearchPage|null>(card.page);
 const [query,setQuery]=useState('');
 const [searched,setSearched]=useState('');
 const [message,setMessage]=useState('');
 const [pending,start]=useTransition();
 const busy=useRef(false);
 function load(more=false,note?:string){
  if(busy.current)return;
  busy.current=true;
  const previous=page;
  setPage(null);setMessage(note??'');
  start(async()=>{
   try{
    const result=await search({query:more?searched:query,cursor:more?previous?.nextCursor:null});
    if(!result.ok){setMessage(result.reason==='invalid'?st(l,'Enter at least 2 name characters or 4 phone digits.','Մուտքագրեք անվան առնվազն 2 տառ կամ հեռախոսահամարի 4 թվանշան։','Введите не менее 2 символов имени или 4 цифр телефона.'):st(l,'The member list could not load. Search again.','Անդամների ցանկը չհաջողվեց բեռնել։ Կրկին որոնեք։','Не удалось загрузить список участников. Повторите поиск.'));return;}
    setPage({...result.page,rows:more?[...new Map([...(previous?.rows??[]),...result.page.rows].map(row=>[row.id,row])).values()]:result.page.rows});
    if(!more)setSearched(query);
   }catch{setMessage(st(l,'The member list could not load. Search again.','Անդամների ցանկը չհաջողվեց բեռնել։ Կրկին որոնեք։','Не удалось загрузить список участников. Повторите поиск.'));}
   finally{busy.current=false;}
  });
 }
 return <section className="space-y-4" aria-label={st(l,'Care-team assignments','Խնամքի թիմի նշանակում','Назначение команды заботы')}>
  <h2 className="text-h3">{st(l,'Care-team assignments','Խնամքի թիմի նշանակում','Назначение команды заботы')}</h2>
  <form onSubmit={event=>{event.preventDefault();load();}} className="space-y-2">
   <label className="block text-body2">{st(l,'Find a member by name or phone','Գտնել անդամին անունով կամ հեռախոսահամարով','Найти участника по имени или телефону')}<input value={query} onChange={event=>setQuery(event.target.value)} maxLength={100} className="mt-1 min-h-11 w-full rounded-md border px-3"/></label>
   <button disabled={pending} className={button}>{st(l,'Find member','Գտնել անդամին','Найти участника')}</button>
   <button type="button" disabled={pending} className={`${button} ml-2`} onClick={()=>load()}>{st(l,'Refresh members','Թարմացնել անդամների ցանկը','Обновить список участников')}</button>
  </form>
  {pending&&<p role="status">{st(l,'Loading members…','Անդամները բեռնվում են…','Загружаем участников…')}</p>}
  {message&&<p role="status" className="text-body2">{message}</p>}
  {page?.rows.length===0&&<p>{st(l,'No matching members found.','Համապատասխան անդամներ չեն գտնվել։','Подходящие участники не найдены.')}</p>}
  <ul className="divide-y">{page?.rows.map(row=><li key={`${row.id}:${row.revision}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
   <div className="min-w-0 text-body2"><p className="break-words font-medium">{row.name||st(l,'Member without a name','Անդամ՝ առանց անվան','Участник без имени')}</p><p className="text-caption text-muted-foreground">{st(l,'Doctor','Բժիշկ','Врач')}: {card.doctors.find(d=>d.id===row.doctorId)?.name||st(l,'Not assigned or unavailable','Նշանակված չէ կամ անհասանելի է','Не назначен или недоступен')} · {st(l,'Nurse','Բուժքույր','Медсестра')}: {card.nurses.find(n=>n.id===row.nurseId)?.name||st(l,'Not assigned or unavailable','Նշանակված չէ կամ անհասանելի է','Не назначена или недоступна')}</p></div>
   <CareTeamDialog {...row} name={row.name||st(l,'Member','Անդամ','Участник')} doctors={card.doctors} nurses={card.nurses} locale={l} primary={!row.doctorId} actions={actions} onSaved={note=>load(false,note??st(l,'Assignment saved.','Կցումը պահպանվել է։','Назначение сохранено.'))}/>
  </li>)}</ul>
  {page?.hasMore&&<button type="button" disabled={pending} className={button} onClick={()=>load(true)}>{st(l,'Load more members','Բեռնել հաջորդ անդամներին','Загрузить ещё участников')}</button>}
 </section>;
}
