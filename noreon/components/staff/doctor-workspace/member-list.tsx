'use client';
import {useId,useState,useTransition} from 'react';
import {useRouter} from 'next/navigation';
import type {Route} from 'next';
import {searchRealMembers} from '@/lib/staff/real-member-search-actions';
import type {MemberSearchResult,MemberSearchInput,MemberSearchPage} from '@/lib/staff/member-search-schema';
import {openStaffZoe} from '@/lib/staff-zoe/actions';
import {memberRef,type L} from '@/lib/staff-zoe/contracts';
import {st} from '@/lib/staff/staff-locale-copy';

/** Uses the existing authenticated search and explicit conversation selection. No clinical commands. */
export function WorkspaceMemberList({initialPage,selected,locale,nurseChat=false,onSelect,initialQuery='',resetLabel,includeIds,searchAction=searchRealMembers}:{initialPage:MemberSearchPage|null;selected?:string;locale:L;nurseChat?:boolean;onSelect?:(id:string)=>void;initialQuery?:string;resetLabel?:string;includeIds?:string[];searchAction?:(input:MemberSearchInput)=>Promise<MemberSearchResult>}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const router=useRouter(),searchId=useId();
 const [page,setPage]=useState(initialPage),[query,setQuery]=useState(initialQuery);

 const [error,setError]=useState<string|null>(initialPage?null:t('Your member list could not be read. Try again.','Ձեր անդամների ցանկը չհաջողվեց կարդալ։ Փորձեք նորից։','Не удалось прочитать список участников. Попробуйте ещё раз.'));
 const [pending,start]=useTransition();
 const search=(more=false,value=query)=>start(async()=>{
  setError(null);
  try{
   const r=await searchAction({query:value,cursor:more?page?.nextCursor??null:null});
   if(r.ok)setPage(r.page);
   else{setPage(null);setError(r.reason==='invalid'?t('Enter at least two letters or four phone digits.','Մուտքագրեք առնվազն երկու տառ կամ հեռախոսի չորս թիվ։','Введите минимум две буквы или четыре цифры телефона.'):t('Your member list could not be read. Try again.','Ձեր անդամների ցանկը չհաջողվեց կարդալ։ Փորձեք նորից։','Не удалось прочитать список участников. Попробуйте ещё раз.'));}
  }catch{setPage(null);setError(t('Your member list could not be read. Try again.','Ձեր անդամների ցանկը չհաջողվեց կարդալ։ Փորձեք նորից։','Не удалось прочитать список участников. Попробуйте ещё раз.'));}
 });
 const select=(id:string)=>{if(onSelect){onSelect(id);return;}start(async()=>{
  setError(null);
  if(nurseChat){router.push(`/staff/real/nurse-chat?member=${id}` as Route);return;}
  try{const r=await openStaffZoe(id);
   if(r.ok)router.push(`/staff/real/doctor-workspace?c=${r.conversationId}` as Route);
   else setError(t('This member could not be opened. Check your access and try again.','Այս անդամին չհաջողվեց բացել։ Ստուգեք հասանելիությունը և փորձեք նորից։','Не удалось открыть участника. Проверьте доступ и повторите.'));
  }catch{setError(t('This member could not be opened. Try again.','Այս անդամին չհաջողվեց բացել։ Փորձեք նորից։','Не удалось открыть участника. Попробуйте ещё раз.'));}
 });};
 const visibleRows=page?.rows.filter(m=>(!includeIds||includeIds.includes(m.id)))??[];
 return <details className="dw-members" open={!selected}>
  <summary>{t('Your members','Ձեր անդամները','Ваши участники')}</summary>
  <div className="space-y-4 p-4" aria-busy={pending}>
   <form onSubmit={e=>{e.preventDefault();search();}} className="space-y-2">
    <label htmlFor={searchId} className="text-caption text-muted-foreground">{t('Name or phone digits','Անուն կամ հեռախոսի թվեր','Имя или цифры телефона')}</label>
    <input id={searchId} value={query} disabled={pending} maxLength={100} onChange={e=>{setQuery(e.target.value);setPage(null);setError(null);}} className="dw-input"/>
    <button type="submit" disabled={pending} className="dw-pill w-full">{pending?t('Reading…','Կարդացվում է…','Чтение…'):t('Find members','Գտնել անդամներին','Найти участников')}</button>
   </form>

   {error&&<p role="alert" className="text-body2">{error}</p>}
   {page&&!visibleRows.length&&<p role="status" className="text-body2 text-muted-foreground">{onSelect?t('No assigned members on this page match. You can check the next page if there is one.','Այս էջում համընկնող կցված անդամներ չկան։ Եթե կա հաջորդ էջ, կարող եք ստուգել այն։','На этой странице назначенных участников совпадений нет. Проверьте следующую страницу, если она есть.'):t('No assigned members match.','Համընկնող կցված անդամներ չկան։','Среди назначенных участников совпадений нет.')}</p>}
   <ul className="space-y-2">{visibleRows.map(m=><li key={m.id}>
    <button type="button" onClick={()=>select(m.id)} disabled={pending} aria-current={m.id===selected?'true':undefined} className="dw-member">
     <span className="font-semibold">{m.name??t('Name not recorded','Անունը գրանցված չէ','Имя не указано')}</span>
     <span className="text-caption text-muted-foreground">{m.birthYear??t('Birth year not recorded','Ծննդյան տարին գրանցված չէ','Год рождения не указан')} · {t('Ref','Հղում','Код')} …{memberRef(m.id)}</span>
    </button>
   </li>)}</ul>
   {page?.hasMore&&<button type="button" onClick={()=>search(true)} disabled={pending} className="dw-pill w-full">{t('Next members','Հաջորդ անդամները','Следующие участники')}</button>}
   <button type="button" disabled={pending} onClick={()=>{setQuery('');search(false,'');}} className="text-caption underline underline-offset-4">{resetLabel??t('Back to all members','Վերադառնալ բոլոր անդամներին','Ко всем участникам')}</button>
  </div>
 </details>;
}
