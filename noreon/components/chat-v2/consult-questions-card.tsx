"use client";
import {useState} from 'react';
import { zoeName } from '@/lib/brand';
import {sendConsultQuestions} from '@/lib/zoe-chat-actions/consult-actions';
import {CONSULT} from '@/lib/zoe-chat-actions/consult-copy';
import {say,type CardLocale} from '@/lib/zoe-chat-actions/copy';
import {CARD_REPLY_LOST} from '@/lib/zoe-chat-actions/thread-events';
import type {ValidCard,ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {SignInEnded} from '@/components/patient/sign-in-ended';
import {useCardSave} from './use-card-save';
import {DialogTurn} from './dialog-turn';
export function SavedQuestionsTurn({locale:l,time}:{locale:CardLocale;time:string}){
 return <DialogTurn locale={l} action={null} time={time}><p>{say(l,CONSULT.sent)}</p></DialogTurn>;
}
export function ConsultQuestionsCard({card,locale:l,onCard,onAct}:{card:Extract<ValidCard,{kind:'consult_questions'}>;locale:CardLocale;onCard:(c:ZoeCard)=>void;onAct:(id:string,on:boolean)=>void}){
 const [groups,setGroups]=useState(card.snapshot.groups);
 const {busy,problem,save,opId}=useCardSave(card.id,l,onCard,onAct);
 if(card.state==='done')return null;
 return <article className="cv2-msg cv2-zoe" data-zoe-card="consult_questions" data-chat-card-id={card.id} data-state="open"><p className="cv2-from"><i className="cv2-orb" aria-hidden/>{zoeName(l)}</p><section className="cv2-reading cv2-block"><h3>{say(l,CONSULT.title)}</h3>
  <fieldset disabled={busy} aria-busy={busy}>{groups.map((g,i)=><label className="cv2-field" key={g.label}>{say(l,CONSULT[g.label])}<textarea rows={2} maxLength={1000} value={g.text} onChange={e=>setGroups(current=>current.map((v,j)=>i===j?{...v,text:e.target.value}:v))}/></label>)}
   <button type="button" className="cv2-reading-save" disabled={!groups.some(g=>g.text.trim())} onClick={()=>save(async()=>{const r=await sendConsultQuestions({cardId:card.id,opId,locale:l,groups});window.dispatchEvent(new Event(CARD_REPLY_LOST));return r;})}>{say(l,CONSULT.send)}</button>
  </fieldset>
  {problem==='signed_out'?<SignInEnded locale={l}/>:problem&&<p role="alert">{problem}</p>}
 </section></article>;
}
