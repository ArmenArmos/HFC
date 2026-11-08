'use client';
import {useState} from 'react';
import {NurseChat} from './nurse-chat';
import {NurseHandoffs} from './nurse-handoffs';
import {readNurseConversation,sendNurseReply} from '@/lib/nurse-chat/actions';
import {escalateNurseMessage,readNurseHandoffs} from '@/lib/nurse-chat/handoff-actions';
import type {NurseWorkspace} from '@/lib/nurse-chat/contracts';
import type {HandoffPage} from '@/lib/nurse-chat/handoffs';
import type {StaffLocale} from '@/lib/staff/staff-locale-copy';

export function NurseMemberChat({memberId,nurseId,nurseName,initial,handoffs,locale,children,workActive=false,visitKey}:{memberId:string;nurseId:string;nurseName:string;initial:NurseWorkspace;handoffs:HandoffPage|null;locale:StaffLocale;children?:React.ReactNode;workActive?:boolean;visitKey?:string}){
 const [page,setPage]=useState(handoffs),[allowed,setAllowed]=useState(initial.ok);
 const reload=async()=>{
  let data:NurseWorkspace;
  try{data=await readNurseConversation(memberId);}catch{setAllowed(false);setPage(null);throw Error('Conversation unavailable');}
  setAllowed(data.ok);
  if(data.ok)setPage(await readNurseHandoffs(memberId));else setPage(null);
  return data;
 };
 return <div className="space-y-4">
  <NurseChat visitKey={visitKey} memberId={memberId} nurseName={nurseName} initial={initial} locale={locale} workActive={workActive} ports={{read:reload,send:sendNurseReply,escalate:escalateNurseMessage,accessChanged:setAllowed,handoffSaved:()=>{void readNurseHandoffs(memberId).then(setPage).catch(()=>setPage(null));}}}>{children}</NurseChat>
  {allowed&&<details className="rounded-xl bg-card p-4"><summary className="min-h-11 cursor-pointer content-center text-body2">{locale==='hy'?'Բժշկին փոխանցումների պատմություն':locale==='ru'?'История передач врачу':'Doctor handoff history'}</summary><NurseHandoffs page={page} actor={{id:nurseId,role:'nurse'}} locale={locale}/></details>}
 </div>;
}
