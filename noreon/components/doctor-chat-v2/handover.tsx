'use client';
import {ChatMemberIdentity} from '@/components/staff/chat-member-identity';
import {useEffect,useRef,useState} from 'react';
import {sendDoctorChatHandover,readDoctorChatHandover} from '@/lib/staff-zoe/chat-v2-actions';
import {doctorHandoverCopy,type DoctorHandover,type HandoverTarget} from '@/lib/staff-zoe/handover';
import type {StaffLocale} from '@/lib/staff/staff-locale-copy';

/** The confirmed target and exact retry command stay with this card, even if the
 * doctor opens another member. No write happens until its Send button is pressed. */
export function DoctorHandoverCard({target,note,doctorId,locale}:{target:HandoverTarget;note:string|null;doctorId:string;locale:StaffLocale}){
 const copy=doctorHandoverCopy(locale),locked=useRef(false);
 const [command]=useState<DoctorHandover>(()=>({memberId:target.memberId,nurseId:target.nurseId,conversationId:target.conversationId,locale,note,taskId:crypto.randomUUID(),requestId:crypto.randomUUID()}));
 const [state,setState]=useState<'confirm'|'sending'|'failed'|'cancelled'|'sent'|'working'|'done'|'closed'|'reassign'>('confirm');
 const [refreshFailed,setRefreshFailed]=useState(false);
 useEffect(()=>{
  if(state!=='sent'&&state!=='working'&&state!=='reassign')return;
  let active=true,running=false;
  async function poll(){
   if(document.hidden||running)return;running=true;
   try{const r=await readDoctorChatHandover(command.taskId,command.memberId,command.nurseId,doctorId);if(active){setRefreshFailed(r.kind!=='state');if(r.kind==='state')setState(r.state);}}catch{if(active)setRefreshFailed(true);}finally{running=false;}
  }
  const timer=setInterval(()=>void poll(),60_000);
  const visible=()=>{if(!document.hidden)void poll();};
  document.addEventListener('visibilitychange',visible);
  return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[state,command,doctorId]);
 async function send(){
  if(locked.current)return;locked.current=true;setState('sending');
  try{const r=await sendDoctorChatHandover(command,doctorId);setState(r.kind==='sent'?'sent':'failed');}catch{setState('failed');}finally{locked.current=false;}
 }
 return <section data-doctor-handover className="cv2-say dcv2-conversation"><ChatMemberIdentity memberId={target.memberId} name={target.memberName} locale={locale}/>
  <p><strong>{copy.confirm}</strong></p><p>{target.memberName} · {target.nurseName}</p>
  <p className="cv2-time">{copy.note}</p><p>{note??copy.noNote}</p>
  {(state==='confirm'||state==='failed')&&<>{state==='failed'&&<p role="alert">{copy.failed}</p>}<button type="button" className="dcv2-choice" onClick={()=>void send()}>{state==='failed'?copy.retry:copy.send}</button>{state==='confirm'&&<button type="button" className="dcv2-choice" onClick={()=>setState('cancelled')}>{copy.cancel}</button>}</>}
  {state==='sending'&&<p role="status">{copy.sending}</p>}
  {state==='cancelled'&&<p role="status">{copy.cancelled}</p>}
  {['sent','working','done','closed','reassign'].includes(state)&&<p role="status">{state==='sent'?copy.sent(target.nurseName):state==='working'?copy.working:state==='done'?copy.done:state==='reassign'?copy.reassign:copy.closed}</p>}
  {refreshFailed&&<p role="alert">{copy.refreshFailed}</p>}
 </section>;
}
