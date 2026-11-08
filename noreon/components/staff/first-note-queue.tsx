'use client';
import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {pick,type Locale} from '@/lib/locale';
import Link from 'next/link';
import type {Route} from 'next';
import {MessageSquareText} from 'lucide-react';
import type {FirstNoteQueue as Queue} from '@/lib/first-note/schema';
import {formatMemberDate} from '@/lib/patient/date-format';
import {closeFirstNoteBacklog,reopenFirstNoteBacklog} from '@/lib/first-note/actions';
import type {BacklogResult} from '@/lib/first-note/schema';

const when=(iso:string,l:Locale)=>formatMemberDate(iso,l,{timeZone:'Asia/Yerevan',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});

const button='inline-flex min-h-11 items-center justify-center rounded-md border px-3 py-2 text-body2 font-medium disabled:opacity-50';

function BacklogAction({memberId,reopen=false,locale:l}:{memberId:string;reopen?:boolean;locale:Locale}){
 const router=useRouter(),[reason,setReason]=useState(''),[pending,setPending]=useState(false),[message,setMessage]=useState<{ok:boolean;text:string}|null>(null);
 const s=(en:string,hy:string,ru:string)=>pick(l,{en,hy,ru});
 async function save(){
  if(pending)return;
  setPending(true);setMessage(null);
  const r=await(reopen?reopenFirstNoteBacklog({memberId}):closeFirstNoteBacklog({memberId,reason:reason.trim()})).catch(():BacklogResult=>({status:'outcome-unknown'}));
  setPending(false);
  const ok=r.status===(reopen?'reopened':'closed');
  setMessage({ok,text:ok
   ?reopen?s('Reopened.','Վերաբացված է։','Открыто снова.'):s('Saved as Backlog, reviewed.','Պահպանված է որպես «Հետաձգված, վերանայված»։','Сохранено как «Архив, проверено».')
   :s('This change could not be saved. Check the queue and try again.','Փոփոխությունը չհաջողվեց պահպանել։ Ստուգեք ցանկը և փորձեք կրկին։','Изменение не удалось сохранить. Проверьте список и попробуйте снова.')});
  if(ok)router.refresh();
 }
 const feedback=message&&<p role={message.ok?'status':'alert'} className="text-body2">{message.text}</p>;
 if(reopen)return <div className="space-y-2"><button type="button" className={button} disabled={pending} onClick={save}>{pending?s('Saving…','Պահպանվում է…','Сохраняется…'):s('Reopen','Վերաբացել','Открыть снова')}</button>{feedback}</div>;
 return <details className="w-full">
  <summary className="min-h-11 cursor-pointer content-center text-body2 font-medium underline">{s('Close as Backlog, reviewed','Փակել որպես «Հետաձգված, վերանայված»','Закрыть как «Архив, проверено»')}</summary>
  <form className="max-w-lg space-y-3 py-2" onSubmit={async e=>{e.preventDefault();await save();}}>
   <label className="block space-y-1 text-body2"><span>{s('Reason (required, staff only)','Պատճառ (պարտադիր, միայն աշխատակազմի համար)','Причина (обязательно, только для сотрудников)')}</span>
    <textarea name="reason" required maxLength={500} rows={3} value={reason} onChange={e=>setReason(e.target.value)} disabled={pending} className="block w-full rounded-md border bg-background p-2"/>
   </label>
   <p className="text-body2 text-muted-foreground">{s('This records a backlog review. It does not approve or send a note to the member.','Սա գրանցում է հետաձգվածի վերանայումը։ Անդամին գրառում չի հաստատվում կամ ուղարկվում։','Это фиксирует проверку архива. Сообщение участнику не утверждается и не отправляется.')}</p>
   <button className={button} disabled={pending||!reason.trim()}>{pending?s('Saving…','Պահպանվում է…','Сохраняется…'):s('Confirm backlog review','Հաստատել հետաձգվածի վերանայումը','Подтвердить проверку архива')}</button>
   {feedback}
  </form>
 </details>;
}

/** The assigned doctor's queue, or the admin's backlog, including unassigned members. */
export function FirstNoteQueue({queue,locale:l,now}:{queue:Queue|null;locale:Locale;now:Date}){
 const s=(en:string,hy:string,ru:string)=>pick(l,{en,hy,ru});
 if(!queue)return <p role="alert" className="my-6 rounded-md border p-4 text-body2">{s('First notes could not be loaded. Try again.','Առաջին գրառումները չհաջողվեց բեռնել։ Փորձեք կրկին։','Не удалось загрузить первые сообщения. Попробуйте снова.')}</p>;
 if(!queue.enabled)return null;
 const owner=(name:string|null)=><p className="text-body2 text-muted-foreground">{s('Owner','Պատասխանատու','Ответственный')}: {name??s('Not assigned','Նշանակված չէ','Не назначен')}</p>;
 return <section aria-labelledby="first-note-queue-title" className="my-6 space-y-3 rounded-xl border bg-background p-4">
  <h2 id="first-note-queue-title" className="flex items-center gap-2 text-h3"><MessageSquareText className="size-5" aria-hidden/>{s('First notes to approve','Առաջին գրառումներ՝ հաստատելու','Первые сообщения для утверждения')}</h2>
  {!queue.items.length&&<p className="text-body2 text-muted-foreground">{s('No first notes waiting.','Սպասող առաջին գրառումներ չկան։','Нет первых сообщений, ожидающих утверждения.')}</p>}
  <ul className="divide-y">{queue.items.map(i=>{const late=Date.parse(i.dueAt)<now.getTime();return <li key={i.memberId} className="flex flex-wrap items-center justify-between gap-2 py-2">
   <div className="min-w-0 break-words"><Link href={`/staff/real/members/${i.memberId}#first-note` as Route} className="text-body2 font-semibold text-primary underline">{i.memberName??s('Member','Անդամ','Участник')}</Link>{owner(i.doctorName)}</div>
   <span className={`text-body2 ${late?'font-semibold text-destructive':''}`}>{late?s(`overdue, approve by ${when(i.dueAt,l)}`,`ժամկետն անցել է, հաստատել մինչև ${when(i.dueAt,l)}`,`просрочено, утвердить до ${when(i.dueAt,l)}`):s(`approve by ${when(i.dueAt,l)}`,`հաստատել մինչև ${when(i.dueAt,l)}`,`утвердить до ${when(i.dueAt,l)}`)}</span>
   {late&&<BacklogAction memberId={i.memberId} locale={l}/>}
  </li>;})}</ul>
  <h3 className="text-h3">{s('Backlog, reviewed','Հետաձգված, վերանայված','Архив, проверено')} ({queue.closed.length})</h3>
  <ul className="divide-y">{queue.closed.map(i=><li key={i.memberId} className="space-y-2 py-3">
   <Link href={`/staff/real/members/${i.memberId}#first-note` as Route} className="text-body2 font-semibold text-primary underline">{i.memberName??s('Member','Անդամ','Участник')}</Link>
   {owner(i.doctorName)}
   <p className="text-body2">{s('Closed by','Փակել է','Закрыл')}: {i.closedByName??s('Name unavailable','Անունն անհասանելի է','Имя недоступно')} · {when(i.closedAt,l)}</p>
   <p className="whitespace-pre-wrap break-words text-body2">{i.reason}</p>
   <BacklogAction memberId={i.memberId} reopen locale={l}/>
  </li>)}</ul>
 </section>;
}
