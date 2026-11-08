'use client';
import {useRef,useState} from 'react';
import {PilotStaffBooking} from '@/components/real-booking/pilot-staff';
import {RealStaffBooking} from '@/components/real-booking/staff';
import {BookingRefreshContext} from '@/components/real-booking/recovery-context';
import {MemberContactLine} from '@/components/staff/member-contact';
import type {AdminMemberBookings} from '@/lib/admin-chat/card-contracts';
import type {MemberSearchPage} from '@/lib/staff/member-search-schema';
import type {PilotActionState} from '@/lib/real-booking/appointment-schema';
import type {BookingFormState} from '@/lib/real-booking/schema';
import * as server from '@/lib/admin-chat/card-actions';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';

type Unwrap=<T>(request:()=>Promise<{access:'allowed';result:T}|{access:'off'|'denied'}>)=>Promise<T>;
const button='min-h-11 rounded-md border px-4 text-body2 disabled:opacity-50';
/** The forms and all booking decisions are shared with the member page. This host
 * only selects a member, guards concurrent taps and rereads after a saved write. */
export function AdminBookingCard({page:initial,locale:l,unwrap}:{page:MemberSearchPage;locale:StaffLocale;unwrap:Unwrap}){
 const [page,setPage]=useState(initial),[query,setQuery]=useState(''),[searched,setSearched]=useState('');
 const [record,setRecord]=useState<{data:AdminMemberBookings;commands:Record<string,string>;session:string}|null>(null);
 const [member,setMember]=useState<{id:string;name:string|null}|null>(null);
 const [sending,setSending]=useState(false);
 const [hasSearched,setHasSearched]=useState(initial.rows.length>0);
 const executing=useRef(false);
 const [pending,setPending]=useState(false),[message,setMessage]=useState(''),[needsRefresh,setNeedsRefresh]=useState(false);
 const reading=useRef(false),commandStarted=useRef(false);
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 async function search(more=false){
  if(reading.current||executing.current)return;
  reading.current=true;setPending(true);setMessage('');
  try{
   const result=await unwrap(()=>server.searchAdminCareMembers({query:more?searched:query,cursor:more?page.nextCursor:null}));
   if(!result.ok){setMessage(result.reason==='invalid'?t('Enter at least 2 name characters or 4 phone digits.','Մուտքագրեք անվան առնվազն 2 տառ կամ հեռախոսահամարի 4 թվանշան։','Введите не менее 2 символов имени или 4 цифр телефона.'):t('Members could not load. Search again.','Անդամները չհաջողվեց բեռնել։ Կրկին որոնեք։','Не удалось загрузить участников. Повторите поиск.'));return;}
   setPage({...result.page,rows:more?[...page.rows,...result.page.rows]:result.page.rows});
   setHasSearched(true);
   if(!more)setSearched(query);
  }catch{setMessage(t('Members could not load. Search again.','Անդամները չհաջողվեց բեռնել։ Կրկին որոնեք։','Не удалось загрузить участников. Повторите поиск.'));}
  finally{reading.current=false;setPending(false);}
 }
 async function readMember(next:NonNullable<typeof member>){
  if(reading.current||executing.current)return;
  reading.current=true;setPending(true);setMessage('');setNeedsRefresh(true);setMember(next);
  try{
   const data=await unwrap(()=>server.readAdminMemberBookings(next.id));
   setRecord({data,session:crypto.randomUUID(),commands:Object.fromEntries((data.pilot?.appointments??[]).map(a=>[a.id,crypto.randomUUID()]))});
   commandStarted.current=false;setNeedsRefresh(false);
  }catch{setMessage(t('These details could not load. Check current details before another action.','Այս տվյալները չհաջողվեց բեռնել։ Նոր գործողությունից առաջ ստուգեք ընթացիկ տվյալները։','Не удалось загрузить данные. Перед следующим действием проверьте актуальные данные.'));}
  finally{reading.current=false;setPending(false);}
 }
 // A result may be lost after a write. Even a second form cannot start another
 // operation until a read finishes. Unknown outcomes need an explicit read;
 // successful writes read automatically. Never replay a command here.
 async function command<T extends {ok:boolean;outcomeUnknown?:boolean}>(run:()=>Promise<T>,unknown:T):Promise<T>{
  if(commandStarted.current||reading.current)return unknown;
  commandStarted.current=true;executing.current=true;setSending(true);setNeedsRefresh(true);
  let result:T;
  try{result=await run();}catch{result=unknown;}finally{executing.current=false;setSending(false);}
  if(result.ok&&!result.outcomeUnknown&&member)await readMember(member);
  return result;
 }
 async function runPilot(action:typeof server.changeAdminAppointment,previous:PilotActionState,form:FormData):Promise<PilotActionState>{
  return command(()=>unwrap(()=>action(member!.id,previous,form)),{ok:false,code:'unknown',outcomeUnknown:true});
 }
 const provider=(previous:BookingFormState,form:FormData)=>command(()=>unwrap(()=>server.adminProviderBookingCommand(previous,form)),{ok:false,code:'failed',outcomeUnknown:true,message:'The result is unknown. Check current details before another action.'} satisfies BookingFormState);
 const current=record?.data.memberId===member?.id?record:null;
 const refresh=()=>{if(member)void readMember(member);};
 return <section className="space-y-4" aria-label={t('Bookings and contact','Ամրագրումներ և կապ','Записи и контакты')}>
  <h2 className="text-h3">{t('Bookings and contact','Ամրագրումներ և կապ','Записи и контакты')}</h2>
  <form onSubmit={event=>{event.preventDefault();void search();}} className="space-y-2">
   <label className="block text-body2">{t('Find a member by name or phone','Գտնել անդամին անունով կամ հեռախոսահամարով','Найти участника по имени или телефону')}<input value={query} onChange={event=>setQuery(event.target.value)} maxLength={100} className="mt-1 min-h-11 w-full rounded-md border px-3"/></label>
   <button disabled={pending||sending} className={button}>{t('Find member','Գտնել անդամին','Найти участника')}</button>
  </form>
  {pending&&<p role="status">{t('Reading current records…','Կարդացվում են ընթացիկ գրառումները…','Загружаем актуальные записи…')}</p>}
  {message&&<p role="alert">{message}</p>}
  {!page.rows.length&&<p>{hasSearched?t('No matching members found.','Համապատասխան անդամներ չեն գտնվել։','Подходящие участники не найдены.'):t('Search for a member to see bookings and contact details.','Որոնեք անդամին՝ ամրագրումներն ու կապի տվյալները տեսնելու համար։','Найдите участника, чтобы увидеть записи и контактные данные.')}</p>}
  <ul className="divide-y">{page.rows.map(row=><li key={row.id}><button type="button" disabled={pending||sending} onClick={()=>void readMember(row)} className="min-h-11 w-full py-2 text-left text-body2 underline">{row.name||t('Member without a name','Անդամ՝ առանց անվան','Участник без имени')}</button></li>)}</ul>
  {page.hasMore&&<button type="button" disabled={pending||sending} onClick={()=>void search(true)} className={button}>{t('Load more members','Բեռնել հաջորդ անդամներին','Загрузить ещё участников')}</button>}
  {member&&<div className="space-y-3 border-t pt-4">
   <h3 className="break-words text-h3">{current?.data.name||member.name||t('Member','Անդամ','Участник')}</h3>
   <button type="button" disabled={pending||sending} onClick={refresh} className={button}>{t('Check current details','Ստուգել ընթացիկ տվյալները','Проверить актуальные данные')}</button>
   {needsRefresh&&!pending&&<p role="status" className="text-body2">{t('Check current details before another action. An unknown result must not be sent again.','Նոր գործողությունից առաջ ստուգեք ընթացիկ տվյալները։ Անհայտ արդյունքով գործողությունը կրկին մի ուղարկեք։','Перед следующим действием проверьте актуальные данные. Не повторяйте отправку, если результат неизвестен.')}</p>}
   {current&&<div hidden={pending||!!message} className="space-y-4">
    <MemberContactLine contact={current.data.contact} locale={l}/>
    {!current.data.enabled?<p role="status">{t('Booking actions are not switched on.','Ամրագրման գործողությունները միացված չեն։','Действия с записями не включены.')}</p>:<BookingRefreshContext value={refresh}>
     <fieldset disabled={needsRefresh} className="min-w-0 space-y-6">
      {current.data.pilot?<PilotStaffBooking key={`pilot:${current.session}`} data={current.data.pilot} locale={l} commandIds={current.commands} changeAction={(previous,form)=>runPilot(server.changeAdminAppointment,previous,form)} cancelCommandIds={current.commands} cancelAction={(previous,form)=>runPilot(server.cancelAdminAppointment,previous,form)} startCommandIds={current.commands} startAction={(previous,form)=>runPilot(server.startAdminAppointmentNotice,previous,form)} retryCommandIds={current.commands} retryAction={(previous,form)=>runPilot(server.retryAdminAppointmentNotice,previous,form)} recoveryCommandIds={current.commands} recoveryAction={(previous,form)=>runPilot(server.reconcileAdminAppointmentNotice,previous,form)} refreshHref={`/staff/real/members/${member.id}`}/>:<p role="alert">{t('Visit details are unavailable.','Այցի տվյալներն անհասանելի են։','Данные визита недоступны.')}</p>}
      {current.data.requests?<RealStaffBooking key={`provider:${current.session}`} requests={current.data.requests} locale={l} action={provider}/>:<p role="alert">{t('Provider requests are unavailable.','Ծառայություն մատուցողի հարցումներն անհասանելի են։','Заявки медицинскому партнёру недоступны.')}</p>}
     </fieldset>
    </BookingRefreshContext>}
   </div>}
  </div>}
 </section>;
}
