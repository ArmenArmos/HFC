'use client';
import {useEffect,useLayoutEffect,useRef,useState,useTransition} from 'react';
import {type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {nurseConversationCopy} from '@/lib/nurse-chat/conversation-copy';
import {yerevanStamp as stamp} from '@/lib/staff/yerevan-time';
import {nurseWorkspaceSchema,nurseSendResultSchema,type NurseWorkspace,type NurseReply} from '@/lib/nurse-chat/contracts';
import {NurseEscalation} from './nurse-escalation';
import type {NurseHandoff} from '@/lib/nurse-chat/handoffs';
import {handoffResultSchema} from '@/lib/nurse-chat/handoffs';
import Link from 'next/link';

type Ports={read:()=>Promise<unknown>;send:(input:NurseReply)=>Promise<unknown>;escalate?:(input:NurseHandoff)=>Promise<unknown>;handoffSaved?:()=>void;accessChanged?:(allowed:boolean)=>void};
export function NurseChat({memberId,nurseName,initial,locale,ports,children,workActive=false,visitKey}:{children?:React.ReactNode;workActive?:boolean;visitKey?:string;memberId:string;nurseName:string;initial:NurseWorkspace;locale:StaffLocale;ports:Ports}){
 const [data,setData]=useState(initial),[body,setBody]=useState(''),[notice,setNotice]=useState('');
 const copy=nurseConversationCopy(locale,data.ok?data:undefined),safety=copy.safety;
 const [phase,setPhase]=useState<'ready'|'uncertain'|'reload'>('ready');
 const [busy,start]=useTransition();
 const locked=useRef(false),pending=useRef<NurseReply|null>(null);
 const thread=useRef<HTMLDivElement>(null),composer=useRef<HTMLFormElement>(null),section=useRef<HTMLElement>(null);
 useLayoutEffect(()=>{
  if(!visitKey)return;
  const main=section.current?.closest('main');
  if(main)main.scrollTop=0;
 },[visitKey]);
 useLayoutEffect(()=>{
  if(workActive)return;
  const form=composer.current,shell=form?.closest<HTMLElement>('[data-nurse-chat-shell]');
  if(!form||!shell)return;
  const sync=()=>shell.style.setProperty('--nurse-composer-height',`${form.getBoundingClientRect().height}px`);
  sync();
  const observer=new ResizeObserver(sync);observer.observe(form,{box:'border-box'});
  return ()=>{observer.disconnect();shell.style.removeProperty('--nurse-composer-height');};
 },[data.ok,visitKey,workActive]);
 useEffect(()=>{if(!visitKey&&thread.current)thread.current.scrollTop=thread.current.scrollHeight;},[data,visitKey]);
 const label={member:copy.member,doctor:copy.doctor,nurse:copy.nurse,zoe:copy.zoe};
 const read=async()=>{const next=nurseWorkspaceSchema.parse(await ports.read());setData(next);ports.accessChanged?.(next.ok);return next;};
 const refresh=()=>{if(locked.current)return;locked.current=true;start(async()=>{
  try{await read();if(!pending.current){setPhase('ready');setNotice('');}}
  catch{setData({ok:false,code:'unavailable'});ports.accessChanged?.(false);}
  finally{locked.current=false;}
 });};
 const send=()=>{if(locked.current||!data.ok||(!pending.current&&(!body.trim()||!data.canSend||phase!=='ready')))return;
  const request=pending.current??{memberId,requestId:crypto.randomUUID(),expectedVersion:data.version,body:body.replace(/\r\n?/g,'\n').trim()};
  pending.current=request;locked.current=true;
  start(async()=>{
   try{
    const result=nurseSendResultSchema.parse(await ports.send(request));
    if(!result.ok){
     pending.current=null;setPhase('reload');
     if(result.code==='denied'||result.code==='off'){setData({ok:false,code:result.code});ports.accessChanged?.(false);}
     setNotice(result.code==='stale_context'?copy.staleReload:copy.unconfirmed);
     return;
    }
    pending.current=null;setBody('');setPhase('ready');setNotice(copy.saved);
    try{await read();}catch{setPhase('reload');setNotice(copy.savedReload);}
   }catch{setPhase('uncertain');setNotice(copy.unknown);}
   finally{locked.current=false;}
  });
 };
 return <section ref={section} className="dw-chat space-y-4" aria-label={copy.title} aria-busy={busy}>
  <header className="space-y-2 rounded-xl bg-card p-4">
   <h1 className="text-h2">{data.ok?data.memberName||label.member:copy.title}</h1>
   {data.ok&&<p className="text-caption text-muted-foreground">{copy.responsibleDoctor}{data.doctorName}</p>}
   {!visitKey&&<p className="text-body2">{safety}</p>}
   <div className="flex flex-wrap gap-2"><button type="button" className="dw-pill whitespace-nowrap" disabled={busy} onClick={refresh}>{busy?copy.reading:copy.reload}</button>
   {visitKey&&<Link href={`/staff/real/nurse-chat?member=${memberId}&card=conversation`} className="dw-pill whitespace-nowrap">{copy.back}</Link>}</div>
  </header>
  {visitKey&&<p data-nurse-visit-safety className="rounded-md border bg-card p-3 text-body2">{safety}</p>}
  {!data.ok?<p role="alert" className="rounded-xl border bg-card p-4 text-body2">{data.code==='denied'?copy.denied:data.code==='off'?copy.off:copy.unavailable}</p>:<>
   {(data.unsupportedMedia||data.unsavedOverLimit)&&<p role="alert" className="rounded-xl border border-destructive bg-card p-4 text-body2">{copy.missingMessages}</p>}
   {children}
   {!visitKey&&!workActive&&<>
   <details open={!workActive} className="rounded-xl bg-card p-3"><summary className="min-h-11 cursor-pointer content-center text-body2 font-medium">{copy.shared} · {data.items.length}</summary>
   <div ref={thread} className="sz-thread space-y-4" role="log" aria-label={copy.shared}>
    {!data.items.length&&<p role="status" className="rounded-xl bg-card p-4 text-body2">{copy.empty}</p>}
    {data.items.map(item=><article key={item.id} id={`nurse-message-${item.id}`} className={`max-w-[90%] space-y-2 p-4 ${item.senderRole==='nurse'?'sz-question ml-auto text-primary-foreground':'rounded-xl bg-card'}`}>
     <p className="text-caption font-semibold">{item.senderName||label[item.senderRole]} · {label[item.senderRole]} · {stamp(item.at,locale)}</p>
     <p className="whitespace-pre-wrap break-words text-body2">{item.text}</p>
     {item.senderRole==='nurse'&&<p className="text-caption" data-nurse-reply-state>{copy.sentToApp}</p>}
    </article>)}
   </div>
   </details>
   {!data.canSend&&<p role="status" className="rounded-xl border bg-card p-4 text-body2">{copy.readOnly}</p>}
   <details name="nurse-compose" open={!workActive||phase!=='ready'} className="rounded-xl bg-card p-3"><summary className="min-h-11 cursor-pointer content-center text-body2 font-medium">{copy.write}</summary>
   <form ref={!workActive?composer:undefined} data-nurse-reply-composer={!workActive||undefined} onSubmit={e=>{e.preventDefault();send();}} className="space-y-3 rounded-xl bg-card p-4">
    <label htmlFor="nurse-reply" className="text-body2 font-semibold">{copy.yourReply}</label>
    <p id="nurse-reply-detail" className="text-caption text-muted-foreground">{nurseName} · {label.nurse}. {copy.detail}</p>
    <p id="nurse-reply-next-step" data-nurse-telegram-handoff={copy.telegramHandoff&&!!ports.escalate||undefined} className="text-caption text-muted-foreground">{copy.telegramHandoff&&!ports.escalate?nurseConversationCopy(locale).nextStep:copy.nextStep}</p>
    <textarea id="nurse-reply" aria-describedby="nurse-reply-detail nurse-reply-next-step" className="dw-input min-h-32" value={body} maxLength={4096} disabled={busy||phase!=='ready'||!data.canSend} onChange={e=>setBody(e.target.value)}/>
    <button type="submit" className="dw-pill" disabled={busy||(phase!=='uncertain'&&(!body.trim()||phase!=='ready'||!data.canSend))}>{phase==='uncertain'?copy.retry:busy?copy.saving:copy.send}</button>
   </form>
   </details>
   {ports.escalate&&<details name="nurse-compose" className="rounded-xl bg-card p-3"><summary className="min-h-11 cursor-pointer content-center text-body2 font-medium">{copy.handoff}</summary><NurseEscalation data={data} locale={locale} send={async input=>{
    const result=handoffResultSchema.parse(await ports.escalate!(input));
    if(!result.ok&&(result.code==='denied'||result.code==='off')){setData({ok:false,code:result.code});ports.accessChanged?.(false);}
    return result;
   }} onSaved={()=>ports.handoffSaved?.()}/></details>}
   </>}
  </>}
  {notice&&<p role="status" className="rounded-xl border bg-card p-4 text-body2">{notice}</p>}
 </section>;
}
