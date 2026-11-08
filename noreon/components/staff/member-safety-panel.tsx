'use client';
import {useState,useTransition} from 'react';
import {useRecordRefresh} from '@/components/staff/record-refresh';
import {ShieldAlert} from 'lucide-react';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {SAFETY_COPY,type DecisionResult,type Pair,type StaffSafety} from '@/lib/member-safety/contract';

import type{Locale}from'@/lib/locale';
type Hold=StaffSafety['holds'][number];
type Decide=(input:{memberId:string;holdId:string;action:'clear'|'keep';note?:string})=>Promise<DecisionResult>;

/** DT P342/P371/P389 holds on the member file: the assigned doctor (or an admin, with a reason) clears or keeps. Placeholder wording. */
export function MemberSafetyPanel({data,memberId,locale,decide}:{data:StaffSafety;memberId:string;locale:Locale;decide:Decide}){
 const s=SAFETY_COPY.staff;const t=(p:Pair)=>p[locale];
 return <section id="member-safety" aria-labelledby="member-safety-title" lang={locale} className="space-y-4 rounded-xl border bg-background p-4 sm:p-6">
  <header className="space-y-1"><h2 id="member-safety-title" className="flex items-center gap-2 text-h3"><ShieldAlert className="size-5" aria-hidden/>{t(s.title)}</h2><p className="text-body2 text-muted-foreground">{t(s.intro)}</p></header>
  {data.holds.length===0?<p className="text-body2">{t(s.none)}</p>:<ul className="space-y-3">{data.holds.map(h=><HoldRow key={h.id} hold={h} role={data.role} memberId={memberId} locale={locale} decide={decide}/>)}</ul>}
 </section>;
}

function HoldRow({hold:h,role,memberId,locale,decide}:{hold:Hold;role:'doctor'|'admin';memberId:string;locale:Locale;decide:Decide}){
 const s=SAFETY_COPY.staff;const t=(p:Pair)=>p[locale];
 const refresh=useRecordRefresh();
 const [note,setNote]=useState('');
 const [message,setMessage]=useState<string|null>(null);
 const [pending,start]=useTransition();
 const noteId=`safety-note-${h.id}`;
 function act(action:'clear'|'keep'){
  start(async()=>{
   setMessage(null);
   const result=await decide({memberId,holdId:h.id,action,note:note.trim()||undefined}).catch(():DecisionResult=>({ok:false,reason:'unavailable'}));
   setMessage(t(result.ok?s.result[result.result]:s.result[result.reason]));
   if(result.ok)refresh();
  });
 }
 return <li data-hold={h.kind} className="space-y-3 rounded-lg border p-4">
  <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-body1 font-medium">{t(s.kind[h.kind])}</p><span className={`rounded-md px-2.5 py-1 text-caption font-semibold ${h.active?'bg-[var(--status-warning-bg)] text-foreground':'bg-muted text-muted-foreground'}`}>{h.active?t(s.active):t(s.ended)}</span></div>
  <p className="text-body2">{t(s.source[h.sourceValue])}</p>
  <dl className="grid gap-2 text-body2 sm:grid-cols-2">
   <div><dt className="text-caption text-muted-foreground">{t(s.started)}</dt><dd>{yerevanStamp(h.startedAt,locale)}</dd></div>
   <div><dt className="text-caption text-muted-foreground">{t(s.ends)}</dt><dd>{h.clearedAt?`${t(s.clearedBy[h.clearedByRole??'doctor'])} · ${yerevanStamp(h.clearedAt,locale)}`:h.expiresAt?yerevanStamp(h.expiresAt,locale):t(s.untilCleared)}</dd></div>
   {h.reviewedAt&&<div><dt className="text-caption text-muted-foreground">{t(s.reviewed)}</dt><dd>{yerevanStamp(h.reviewedAt,locale)}</dd></div>}
   {h.clearNote&&<div className="sm:col-span-2"><dt className="text-caption text-muted-foreground">{t(s.note)}</dt><dd className="whitespace-pre-wrap break-words">{h.clearNote}</dd></div>}
  </dl>
  {h.active&&<div className="space-y-2 border-t pt-3">
   <label htmlFor={noteId} className="block text-caption font-medium">{t(s.note)}</label>
   <textarea id={noteId} value={note} maxLength={500} rows={2} onChange={e=>setNote(e.target.value)} aria-describedby={`${noteId}-help`} className="w-full rounded-md border bg-background p-2 text-body2"/>
   <p id={`${noteId}-help`} className="text-caption text-muted-foreground">{t(role==='admin'?s.noteHelpAdmin:s.noteHelpDoctor)}</p>
   <div className="flex flex-wrap gap-2">
    <button type="button" disabled={pending||(role==='admin'&&!note.trim())} onClick={()=>act('clear')} className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-body2 font-medium text-primary-foreground disabled:opacity-60">{pending?t(s.saving):t(s.clear)}</button>
    <button type="button" disabled={pending} onClick={()=>act('keep')} className="inline-flex min-h-11 items-center rounded-md border px-4 text-body2 font-medium hover:bg-muted disabled:opacity-60">{t(s.keep)}</button>
   </div>
  </div>}
  {message&&<p role="status" className="text-body2">{message}</p>}
  {h.audit.length>0&&<details><summary className="min-h-11 cursor-pointer text-body2">{t(s.history)} ({h.audit.length})</summary><ol className="divide-y">{h.audit.map((a,i)=><li key={i} className="py-2 text-body2">{t(s.action[a.action])}{a.actorName?` · ${a.actorName}`:''} · {yerevanStamp(a.at,locale)}{a.note&&<span className="block whitespace-pre-wrap break-words text-muted-foreground">{a.note}</span>}</li>)}</ol></details>}
 </li>;
}
