'use client';
import {useRef,useState,useTransition} from 'react';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {handoffTopics,handoffResultSchema,type NurseHandoff} from '@/lib/nurse-chat/handoffs';
import type {NurseWorkspace} from '@/lib/nurse-chat/contracts';
import {nurseHandoffCopy,handoffTopicLabel} from '@/lib/nurse-chat/handoff-copy';

export function NurseEscalation({data,locale,send,onSaved}:{data:Extract<NurseWorkspace,{ok:true}>;locale:StaffLocale;send:(input:NurseHandoff)=>Promise<unknown>;onSaved:()=>void}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru),copy=nurseHandoffCopy(locale);
 const [messageId,setMessageId]=useState(''),[topic,setTopic]=useState<NurseHandoff['topic']>('member-request'),[observation,setObservation]=useState(''),[notice,setNotice]=useState('');
 const [uncertain,setUncertain]=useState(false),[blockedData,setBlockedData]=useState<typeof data|null>(null);
 const [busy,start]=useTransition(),locked=useRef(false),pending=useRef<NurseHandoff|null>(null);
 const stale=blockedData===data;
 function submit(){if(locked.current||(!pending.current&&(!messageId||!observation.trim()||stale)))return;
  const request=pending.current??{memberId:data.memberId,requestId:crypto.randomUUID(),expectedVersion:data.version,messageId,topic,observation:observation.trim()};
  pending.current=request;locked.current=true;
  start(async()=>{try{
   const result=handoffResultSchema.parse(await send(request));
   pending.current=null;setUncertain(false);
   if(result.ok){setObservation('');setMessageId('');setNotice(copy.savedLegacy);onSaved();}
   else {setBlockedData(data);setNotice(result.code==='already_exists'?copy.alreadyExistsLegacy:copy.refusedLegacy);}
  }catch{setUncertain(true);setNotice(copy.unknown);}
  finally{locked.current=false;}});
 }
 const selected=data.items.find(item=>item.id===messageId);
 return <form className="space-y-3 rounded-xl border bg-card p-4" onSubmit={event=>{event.preventDefault();submit();}} aria-label={t('Handoff to your responsible doctor','Փոխանցում ձեր պատասխանատու բժշկին','Передача ответственному врачу')}>
  <h2 className="text-h3">{t('Handoff to your responsible doctor','Փոխանցում ձեր պատասխանատու բժշկին','Передача ответственному врачу')}</h2>
  <p className="text-body2">{copy.introduction}</p>
  <fieldset disabled={busy||uncertain||stale} className="space-y-3">
   <label className="block space-y-1 text-body2">{t('Selected message','Ընտրված հաղորդագրություն','Выбранное сообщение')}<select className="dw-input" required value={messageId} onChange={e=>setMessageId(e.target.value)}><option value="">{t('Choose a message','Ընտրել հաղորդագրություն','Выбрать сообщение')}</option>{data.items.map(item=><option key={item.id} value={item.id}>{item.senderName}: {item.text.slice(0,90)}</option>)}</select></label>
   {selected&&<blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-body2">{selected.text}</blockquote>}
   <label className="block space-y-1 text-body2">{t('Topic','Թեմա','Тема')}<select className="dw-input" value={topic} onChange={e=>setTopic(e.target.value as NurseHandoff['topic'])}>{handoffTopics.map(value=><option key={value} value={value}>{handoffTopicLabel(locale,value)}</option>)}</select></label>
   <label className="block space-y-1 text-body2">{copy.observation}<textarea className="dw-input min-h-24" required maxLength={2000} value={observation} onChange={e=>setObservation(e.target.value)}/></label>
  </fieldset>
  <button type="submit" className="dw-pill" disabled={busy||(!uncertain&&(!messageId||!observation.trim()||stale))}>{uncertain?copy.retry:busy?t('Saving handoff…','Փոխանցումը պահպանվում է…','Сохранение передачи…'):t('Send handoff to doctor','Ուղարկել փոխանցումը բժշկին','Передать врачу')}</button>
  {notice&&<p role="status" className="text-body2">{notice}</p>}
 </form>;
}
