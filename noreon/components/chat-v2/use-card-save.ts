"use client";
import {useRef,useState,useTransition} from 'react';
import type {CardActionResult,ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {COMMON,say,type CardLocale} from '@/lib/zoe-chat-actions/copy';
import {CARD_REPLY_LOST} from '@/lib/zoe-chat-actions/thread-events';
/** Shared UI state only. Claims, validation and idempotency stay in each server command. */
export function useCardSave(id:string,l:CardLocale,onCard:(c:ZoeCard)=>void,onAct:(id:string,on:boolean)=>void){
 const [busy,start]=useTransition(),[problem,setProblem]=useState<string|null>(null);
 const sending=useRef(false);const [opId]=useState(()=>crypto.randomUUID());
 const save=(action:()=>Promise<CardActionResult>)=>{
  if(sending.current)return;
  sending.current=true;onAct(id,true);setProblem(null);
  start(async()=>{
   try{const r=await action();if(r.card)onCard(r.card);if(r.status==='ok'&&r.next)onCard(r.next);if(r.status!=='ok'){onAct(id,false);setProblem(r.status==='signed_out'?'signed_out':say(l,r.status==='stale'?COMMON.staleInChat:r.status==='closed'?COMMON.closed:COMMON.saveFailed));}}
   catch(error){if(String((error as {digest?:unknown})?.digest??'').startsWith('NEXT_REDIRECT'))throw error;window.dispatchEvent(new Event(CARD_REPLY_LOST));setProblem(say(l,COMMON.unconfirmed));}
   finally{sending.current=false;}
  });
 };
 return {busy,problem,save,opId};
}
