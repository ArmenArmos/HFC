'use client';
import {useCallback,useEffect,useRef,useState,type RefObject} from 'react';
import {readNurseConversation,sendNurseReply} from '@/lib/nurse-chat/actions';
import {nurseWorkspaceSchema,nurseSendResultSchema,type NurseWorkspace,type NurseReply} from '@/lib/nurse-chat/contracts';
import {readNurseHandoffs} from '@/lib/nurse-chat/handoff-actions';
import {handoffPageSchema,type HandoffPage} from '@/lib/nurse-chat/handoffs';
import {useNurseHandoff} from './use-nurse-handoff';
import type {MemberChoice} from './messages';

type Session={key:string;member:MemberChoice;data:NurseWorkspace|null};
type Optimistic={request:NurseReply;at:string;state:'saving'|'uncertain'|'sent';replyId?:string};
export type ConversationNotice='unknown'|'stale'|'unconfirmed'|'savedUnread'|'';

/** One open member; a pending request survives every retry unchanged. */
export function useNurseConversation(restoreDraft:(body:string)=>void,atEnd:RefObject<()=>boolean>,workHeld?:RefObject<boolean>,onClosed?:()=>void){
 const handoff=useNurseHandoff(restoreDraft);
 const {receive:receiveHandoffs,reset:resetHandoffs,held:handoffHeld}=handoff;
 const lastHandoffs=useRef<HandoffPage|null>(null);
 const [session,setSession]=useState<Session|null>(null);
 const [optimistic,setOptimistic]=useState<Optimistic[]>([]);
 const [notice,setNotice]=useState<ConversationNotice>('');
 const [sending,setSending]=useState(false);
 const current=useRef<Session|null>(null),pending=useRef<NurseReply|null>(null);
 const originalDraft=useRef(''),locked=useRef(false),sequence=useRef(0),applied=useRef(0),polling=useRef(false);
 // The version the nurse has had in view. A poll only advances it while they are at the end, so a reply
 // from a scrolled-up nurse still meets the server's stale check for a message they haven't seen.
 const reviewed=useRef(0);
 const open=session!==null&&(session.data===null||session.data.ok);
 const frozen=sending||optimistic.some(item=>item.state==='uncertain');

 const read=useCallback(async(target:Session,poll=false,preserve=false)=>{
  const seq=++sequence.current;
  try{
   const [raw,handoffs]=await Promise.all([readNurseConversation(target.member.id).catch(()=>null),readNurseHandoffs(target.member.id).then(value=>handoffPageSchema.safeParse(value)).catch(()=>null)]);
   if(current.current?.key!==target.key||seq<applied.current)return null;
   // A read begun before a send must not replace its result or reveal a stale version.
   if(poll&&(locked.current||handoffHeld.current||workHeld?.current))return null;
   applied.current=seq;
   lastHandoffs.current=handoffs?.success?handoffs.data:null;receiveHandoffs(lastHandoffs.current);
   const parsed=nurseWorkspaceSchema.safeParse(raw);if(!parsed.success)return null;
   const data=parsed.data;
   if((poll||preserve)&&!data.ok&&data.code==='unavailable')return null;
   const next={...target,data};current.current=next;setSession(next);
   if(!data.ok)onClosed?.();
   if(data.ok){
    if(!poll||atEnd.current())reviewed.current=data.version;
    setNotice(previous=>previous==='savedUnread'?'':previous);
    setOptimistic(previous=>previous.filter(reply=>!reply.replyId||!data.items.some(item=>item.id===reply.replyId)));
   }else if(data.code==='denied'||data.code==='off'){
    pending.current=null;setOptimistic([]);setNotice('');restoreDraft('');resetHandoffs();
   }
   return data;
  }catch{return null;}
 },[restoreDraft,atEnd,receiveHandoffs,resetHandoffs,handoffHeld,workHeld,onClosed]);

 async function openMember(member:MemberChoice,key:string){
  if(locked.current||pending.current||handoffHeld.current||handoff.active)return;
  const next={key,member,data:null};current.current=next;setSession(next);
  setOptimistic([]);setNotice('');restoreDraft('');resetHandoffs(member.id);lastHandoffs.current=null;
  const data=await read(next);
  if(!data&&current.current?.key===key){
   onClosed?.();
   const failed={...next,data:{ok:false,code:'unavailable'} as const};current.current=failed;setSession(failed);
  }
 }
 function close(){
  if(locked.current||pending.current||handoffHeld.current)return;
  onClosed?.();current.current=null;setSession(null);setOptimistic([]);setNotice('');restoreDraft('');resetHandoffs();lastHandoffs.current=null;
 }
 async function refreshAfterSend(target:Session,saved:boolean){
  const next=await read(target,false,true);
  if(!next&&saved)setNotice('savedUnread');
 }
 async function send(body:string){
  const target=current.current;
  if(locked.current||handoffHeld.current||handoff.active||!target?.data?.ok)return;
  if(!pending.current&&(!target.data.canSend||!body.trim()))return;
  const request=pending.current??{memberId:target.member.id,requestId:crypto.randomUUID(),expectedVersion:reviewed.current,body:body.replace(/\r\n?/g,'\n').trim()};
  if(!pending.current)originalDraft.current=body;
  pending.current=request;locked.current=true;setSending(true);setNotice('');
  setOptimistic(previous=>[...previous.filter(reply=>reply.request.requestId!==request.requestId),{request,at:previous.find(reply=>reply.request.requestId===request.requestId)?.at??new Date().toISOString(),state:'saving'}]);restoreDraft('');
  // Invalidate reads already in flight, including polls started just before this send.
  applied.current=++sequence.current;
  try{
   const result=nurseSendResultSchema.parse(await sendNurseReply(request));
   pending.current=null;
   if(!result.ok){
    setOptimistic(previous=>previous.filter(reply=>reply.request.requestId!==request.requestId));
    if(result.code==='denied'||result.code==='off'){
     onClosed?.();
     const next={...target,data:{ok:false,code:result.code} as NurseWorkspace};current.current=next;setSession(next);setOptimistic([]);restoreDraft('');
    }else{
     restoreDraft(originalDraft.current);setNotice(result.code==='stale_context'?'stale':'unconfirmed');
     await refreshAfterSend(target,false);
    }
    return;
   }
   setOptimistic(previous=>previous.map(reply=>reply.request.requestId===request.requestId?{...reply,state:'sent',replyId:result.replyId}:reply));
   await refreshAfterSend(target,true);
  }catch{
   setOptimistic(previous=>previous.map(reply=>reply.request.requestId===request.requestId?{...reply,state:'uncertain'}:reply));setNotice('unknown');
  }finally{locked.current=false;setSending(false);}
 }
 useEffect(()=>{
  if(!open)return;
  const refresh=()=>{
   const target=current.current;
   if(workHeld?.current||document.hidden||locked.current||handoffHeld.current||pending.current||polling.current||!target?.data?.ok)return;
   polling.current=true;
   void read(target,true).finally(()=>{polling.current=false;});
  };
  const interval=window.setInterval(refresh,30_000);
  window.addEventListener('focus',refresh);window.addEventListener('pageshow',refresh);
  document.addEventListener('visibilitychange',refresh);
  return ()=>{window.clearInterval(interval);window.removeEventListener('focus',refresh);window.removeEventListener('pageshow',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[open,read,handoffHeld,workHeld,onClosed]);
 useEffect(()=>()=>{current.current=null;},[]);
 const caughtUp=useCallback(()=>{const data=current.current?.data;if(data?.ok)reviewed.current=data.version;},[]);
 async function refresh(){const target=current.current;if(!target)return null;lastHandoffs.current=null;await read(target,false,true);return lastHandoffs.current;}
 function refuseAccess(code:'denied'|'off'){
  const target=current.current;if(!target)return;
  onClosed?.();const next={...target,data:{ok:false,code} as NurseWorkspace};current.current=next;setSession(next);setOptimistic([]);setNotice('');restoreDraft('');resetHandoffs();
 }
 function invalidateReads(){applied.current=++sequence.current;}
 const reviewedData=(data:Extract<NurseWorkspace,{ok:true}>)=>({...data,version:reviewed.current});
 return {session,open,optimistic,notice,sending,frozen,openMember,close,send,caughtUp,handoff,refresh,refuseAccess,invalidateReads,reviewedData};
}
