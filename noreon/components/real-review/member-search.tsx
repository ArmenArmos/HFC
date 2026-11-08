'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {Search,X,ChevronDown} from 'lucide-react';
import {searchRealMembers} from '@/lib/staff/real-member-search-actions';
import {memberSearchInputSchema,type MemberSearchInput,type MemberSearchPage,type MemberSearchResult} from '@/lib/staff/member-search-schema';
import {MemberQueueList,type MemberQueueDirectory} from './member-queue-list';
import {tx,type PatientLocale} from '@/lib/patient/copy';

type Props={scopeKey:string;refreshToken:string;initialPage:MemberSearchPage|null;role:'admin'|'doctor'|'nurse';doctors:MemberQueueDirectory[];nurses:MemberQueueDirectory[];locale?:PatientLocale;searchAction?:(input:MemberSearchInput)=>Promise<MemberSearchResult>;bookingSummaryAction?:Parameters<typeof MemberQueueList>[0]['bookingSummaryAction']};
const buttonClass='inline-flex min-h-12 items-center justify-center gap-2 rounded-md border px-4 py-2 text-body2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50';
export function MemberSearch(props:Props){return <SearchSession key={`${props.scopeKey}:${props.role}`} {...props}/>;}
function SearchSession({initialPage,refreshToken,role,doctors,nurses,locale='en',searchAction=searchRealMembers,bookingSummaryAction}:Props){
 const [query,setQuery]=useState('');
 const [page,setPage]=useState(initialPage);
 const [pending,setPending]=useState(false);
 const [feedback,setFeedback]=useState<'invalid'|'unavailable'|null>(initialPage?null:'unavailable');
 const [searched,setSearched]=useState(false);
 const sequence=useRef(0);
 const loadedDepth=useRef(1);
 const [seenRefresh,setSeenRefresh]=useState(refreshToken);
 const queryInput=useRef<HTMLInputElement>(null);
 const [savedAssignment,setSavedAssignment]=useState({count:0,note:''});
 const assignmentFeedback=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(savedAssignment.count)assignmentFeedback.current?.focus();},[savedAssignment]);
 useEffect(()=>()=>{sequence.current++;},[]);

 function edit(value:string){
  if(!value){clear();return;}
  sequence.current++;loadedDepth.current=1;
  setQuery(value);setPage(null);setPending(false);setFeedback(null);setSearched(false);
 }
 const load=useCallback(async(value:string,cursor:MemberSearchInput['cursor']=null,restoreDepth=1)=>{
  const ticket=++sequence.current;
  const input=memberSearchInputSchema.safeParse({query:value,cursor});
  if(!input.success){setFeedback('invalid');setPage(null);setPending(false);return;}
  const previous=cursor?page:null;
  setPending(true);setFeedback(null);setSearched(true);
  try{
   let nextInput=input.data,depth=cursor?loadedDepth.current:0;
   const rows=new Map((previous?.rows??[]).map(row=>[row.id,row]));
   let fresh:MemberSearchPage|null=null;
   do{
    const result=await searchAction(nextInput);
    if(ticket!==sequence.current)return;
    if(!result.ok){setPage(null);setFeedback(result.reason);return;}
    for(const row of result.page.rows)rows.set(row.id,row);
    fresh={...result.page,rows:[...rows.values()]};depth++;
    if(!result.page.hasMore||depth>=restoreDepth)break;
    nextInput={...input.data,cursor:result.page.nextCursor};
   }while(true);
   loadedDepth.current=depth;setPage(fresh);
  }catch{
   if(ticket===sequence.current){setPage(null);setFeedback('unavailable');}
  }finally{if(ticket===sequence.current)setPending(false);}
 },[page,searchAction]);
 useEffect(()=>{
  if(seenRefresh===refreshToken)return;
  let active=true;
  // Rebuild the loaded window from fresh boundaries; never reuse old revisions.
  queueMicrotask(()=>{if(active){setSeenRefresh(refreshToken);setPage(null);void load(query,null,loadedDepth.current);}});
  return ()=>{active=false;};
 },[refreshToken,seenRefresh,query,load]);
 const serverRefreshing=seenRefresh!==refreshToken;
 function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();void load(query);}
 function clear(){sequence.current++;loadedDepth.current=1;setQuery('');setPage(null);setPending(false);setFeedback(null);setSearched(false);queryInput.current?.focus();void load('');}
 return <section className="min-w-0 space-y-4" lang={locale} aria-label={tx(locale,'Անդամների որոնում','Member search','Поиск участников')}>
  <p ref={assignmentFeedback} role="status" tabIndex={-1} className="text-body2 focus-visible:outline-2 focus-visible:outline-ring">{savedAssignment.count>0&&(savedAssignment.note||tx(locale,'Կցումը պահպանվել է։','Assignment saved.','Назначение сохранено.'))}</p>
  <form onSubmit={submit} className="space-y-2" aria-label={tx(locale,'Գտնել անդամին','Find a member','Найти участника')}>
   <label htmlFor="member-search-query" className="block text-body2 font-medium">{tx(locale,'Որոնել անունով կամ հեռախոսահամարով','Search by name or phone','Поиск по имени или телефону')}</label>
   <div className="flex flex-col gap-2 sm:flex-row">
   <div className="relative min-w-0 flex-1">
    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden/>
    <input ref={queryInput} id="member-search-query" type="search" value={query} onChange={event=>edit(event.target.value)} maxLength={100} autoComplete="off" autoCorrect="off" spellCheck={false} aria-invalid={feedback==='invalid'||undefined} aria-describedby={`member-search-help${feedback?' member-search-feedback':''}`} className="min-h-12 w-full min-w-0 rounded-md border bg-background py-2 pr-3 pl-9 text-body2"/>
   </div>
   <div className="flex gap-2">
    <button type="submit" disabled={pending} className={`${buttonClass} bg-primary text-primary-foreground`}><Search className="size-4" aria-hidden/>{pending?tx(locale,'Որոնվում է…','Searching…','Ищем…'):tx(locale,'Գտնել անդամին','Find member','Найти участника')}</button>
    <button type="button" onClick={clear} disabled={!query&&!pending&&!feedback} className={buttonClass}><X className="size-4" aria-hidden/>{tx(locale,'Մաքրել որոնումը','Clear search','Очистить поиск')}</button>
   </div>
   </div>
   <p id="member-search-help" className="text-caption text-muted-foreground">{tx(locale,'Գրեք անվան առնվազն 2 տառ կամ հաստատված հեռախոսահամարի առնվազն 4 թվանշան։ Որոնումը սահմանափակված է ձեր հասանելի անդամներով։','Enter at least 2 name characters or 4 digits of a verified phone number. Search covers only members you can access.','Введите не менее 2 символов имени или 4 цифр подтверждённого номера телефона. Поиск охватывает только доступных вам участников.')}</p>
  </form>
  {feedback&&<p id="member-search-feedback" role="alert" className="rounded-md border p-4 text-body2">{feedback==='invalid'?tx(locale,'Ստուգեք որոնումը։ Գրեք առնվազն 2 նիշ կամ հեռախոսահամարի 4 թվանշան։','Check your search. Enter at least 2 characters or 4 phone digits.','Проверьте запрос. Введите не менее 2 символов или 4 цифр телефона.'):query?tx(locale,'Անդամների որոնումը հասանելի չէ։ Ձեր գրածը պահպանված է։ Կրկին որոնեք։','Member search is unavailable. Your text is retained. Search again.','Поиск участников недоступен. Ваш текст сохранён в форме. Повторите поиск.'):tx(locale,'Անդամների ցուցակը հասանելի չէ։ Կրկին փորձեք որոնել։','The member list is unavailable. Try searching again.','Список участников недоступен. Повторите поиск.')}</p>}
  <div aria-busy={pending} className="space-y-4">
   {pending&&<p role="status" className="text-body2">{tx(locale,'Անդամները բեռնվում են…','Loading members…','Загружаем участников…')}</p>}
   {page&&!serverRefreshing&&<>
    {page.rows.length?<><p role="status" className="text-caption text-muted-foreground">{tx(locale,`Ցուցադրված անդամներ՝ ${page.rows.length}`,`Showing ${page.rows.length} ${page.rows.length===1?'member':'members'}`,`Показано участников: ${page.rows.length}`)}</p><MemberQueueList rows={page.rows} bookingSummaryAction={bookingSummaryAction} role={role} doctors={doctors} nurses={nurses} locale={locale} onAssignmentSaved={(note?:string)=>setSavedAssignment(value=>({count:value.count+1,note:note??''}))}/></>:<p role="status" className="rounded-xl border p-5">{query.trim()?tx(locale,'Համապատասխան անդամներ չեն գտնվել։','No matching members found.','Подходящие участники не найдены.'):tx(locale,'Անդամների հարցումներ չկան։','No member requests are available.','Заявок участников пока нет.')}</p>}
    {page.hasMore&&<button type="button" onClick={()=>void load(query,page.nextCursor)} disabled={pending} className={buttonClass}><ChevronDown className="size-4" aria-hidden/>{tx(locale,'Բեռնել հաջորդ անդամներին','Load more members','Загрузить ещё участников')}</button>}
   </>}
   {!page&&!pending&&!feedback&&!searched&&<p className="text-body2 text-muted-foreground">{tx(locale,'Որոնեք՝ անդամներին տեսնելու համար։','Search to see members.','Выполните поиск, чтобы увидеть участников.')}</p>}
  </div>
 </section>;
}
