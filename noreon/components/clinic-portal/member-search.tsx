'use client';
import{useEffect,useRef,useState,type FormEvent}from'react';
import Link from'next/link';
import type{Route}from'next';
import type{ClinicMember}from'@/lib/clinic-scheduling/member-file';
import type{ClinicMemberMasked}from'@/lib/clinic-portal/member-masked-schema';
import{ClinicMemberMaskedSummary}from'./member-masked';
import{pick,type Locale}from'@/lib/locale';
export type ClinicMemberSearchResult={status:'invalid'|'unavailable'}|{status:'loaded';data:{enabled:false;members:never[]}|{enabled:true;members:ClinicMember[];total:number;page:number;pageSize:number;maskedMembers?:ClinicMemberMasked[]}};
// HY copy for the list, pager and empty states (18 Oct) awaits Tatevik's wording check.
const tr=(locale:Locale,en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});
const pagerButton='inline-flex min-h-12 items-center justify-center rounded-md border bg-background px-4 text-body2 disabled:opacity-60';
/** Lists every member the clinic can find, newest activity first; typing filters (no minimum length).
 * Each request is a POST server action, so names and phone digits never appear in a URL. */
export function ClinicMemberSearch({clinicId,locale,initial,search}:{clinicId:string;locale:Locale;initial:ClinicMemberSearchResult;search:(query:string,page:number)=>Promise<ClinicMemberSearchResult>}){
 const [query,setQuery]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState<ClinicMemberSearchResult>(initial),[shownQuery,setShownQuery]=useState('');
 const latest=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
 async function load(value:string,page:number){
  if(timer.current)clearTimeout(timer.current);
  const request=++latest.current;setBusy(true);
  let next:ClinicMemberSearchResult;
  try{next=await search(value.trim(),page);}catch{next={status:'unavailable'};}
  // Only the newest request may update the list, so a slow earlier answer cannot overwrite it.
  if(request!==latest.current)return;
  setResult(next);setShownQuery(value.trim());setBusy(false);
 }
 function change(value:string){
  setQuery(value);
  if(timer.current)clearTimeout(timer.current);
  timer.current=setTimeout(()=>void load(value,1),300);
 }
 function submit(event:FormEvent){event.preventDefault();void load(query,1);}
 const fileHref=(memberId:string)=>`/clinic/real/members/${memberId}?clinic=${clinicId}&locale=${locale}` as Route;
 const data=result.status==='loaded'&&result.data.enabled?result.data:null;
 const first=data&&data.members.length?(data.page-1)*data.pageSize+1:0,last=data?first+data.members.length-1:0;
 return <div className="space-y-4">
  <form onSubmit={submit} role="search" className="flex flex-col gap-3 rounded-lg border bg-background p-4 sm:flex-row sm:items-end" aria-busy={busy}>
   <label className="block min-w-0 flex-1 space-y-2 text-body2"><span className="font-medium">{tr(locale,'Filter by name or last 4 phone digits','Զտել ըստ անվան կամ հեռախոսի վերջին 4 թվանշանի','Фильтр по имени или последним 4 цифрам телефона')}</span><input type="search" name="q" value={query} onChange={event=>change(event.target.value)} maxLength={100} autoComplete="off" className="min-h-12 w-full min-w-0 rounded-md border bg-background px-3 text-body2"/></label>
   <button disabled={busy} className="inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-4 text-body2 font-medium text-primary-foreground disabled:opacity-60">{busy?tr(locale,'Searching…','Որոնվում է…','Идёт поиск…'):tr(locale,'Search','Որոնել','Найти')}</button>
  </form>
  {result.status==='invalid'?<p role="alert" className="text-body2">{tr(locale,'Use at most 100 characters.','Օգտագործեք առավելագույնը 100 նիշ։','Используйте не более 100 символов.')}</p>
  :result.status!=='loaded'?<p role="alert" className="rounded-lg border bg-background p-4 text-body2">{tr(locale,'The member list is unavailable right now. Try again.','Անդամների ցանկն այժմ անհասանելի է։ Նորից փորձեք։','Список участников сейчас недоступен. Попробуйте снова.')}</p>
  :!data?<p role="status" className="rounded-lg border bg-background p-5 text-body2">{tr(locale,'Scheduling is not switched on for clinics yet.','Կլինիկաների համար այցերի կառավարումը դեռ միացված չէ։','Управление визитами для клиник ещё не включено.')}</p>
  :!data.members.length?<p role="status" className="rounded-lg border bg-background p-5 text-body2">{shownQuery?tr(locale,'No members of your clinic match.','Ձեր կլինիկայի համապատասխան անդամներ չկան։','В вашей клинике нет участников, соответствующих запросу.'):data.page>1?tr(locale,'No more members.','Այլ անդամներ չկան։','Больше участников нет.'):tr(locale,'No members have booked with your clinic yet.','Ձեր կլինիկայում դեռ ոչ մի անդամ այց չի գրանցել։','Пока ни один участник не записался в вашу клинику.')}</p>
  :<>
   <p role="status" className="text-body2 text-muted-foreground">{tr(locale,`${first}–${last} of ${data.total}`,`${first}–${last}՝ ${data.total}-ից`,`${first}–${last} из ${data.total}`)}</p>
   <ul className="divide-y rounded-lg border bg-background">{data.members.map(member=><li key={member.memberId}><Link className="flex min-h-12 flex-wrap items-center justify-between gap-2 p-4" href={fileHref(member.memberId)}><span className="min-w-0 break-words text-body2 font-medium">{member.name||tr(locale,'Name not given','Անունը նշված չէ','Имя не указано')}</span><span className="text-caption text-muted-foreground"><ClinicMemberMaskedSummary member={data.maskedMembers?.find(m=>m.memberId===member.memberId)} locale={locale}/></span></Link></li>)}</ul>
  </>}
  {data&&(data.page>1||last<data.total)&&<nav aria-label={tr(locale,'Member list pages','Անդամների ցանկի էջեր','Страницы списка участников')} className="flex flex-wrap gap-2">
   <button type="button" className={pagerButton} disabled={busy||data.page<=1} onClick={()=>void load(shownQuery,data.page-1)}>{tr(locale,'Previous page','Նախորդ էջ','Предыдущая страница')}</button>
   <button type="button" className={pagerButton} disabled={busy||last>=data.total} onClick={()=>void load(shownQuery,data.page+1)}>{tr(locale,'Next page','Հաջորդ էջ','Следующая страница')}</button>
  </nav>}
 </div>;
}
