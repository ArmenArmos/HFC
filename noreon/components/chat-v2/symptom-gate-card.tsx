"use client";
import {answerSymptomGate} from '@/lib/zoe-chat-actions/consult-actions';
import { zoeName } from '@/lib/brand';
import {CONSULT} from '@/lib/zoe-chat-actions/consult-copy';
import {say,type CardLocale} from '@/lib/zoe-chat-actions/copy';
import type {ValidCard,ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {CARD_REPLY_LOST} from '@/lib/zoe-chat-actions/thread-events';
import {SignInEnded} from '@/components/patient/sign-in-ended';
import {useCardSave} from './use-card-save';
import {DialogTurn} from './dialog-turn';
export function SavedGateTurn({card,locale:l,time,onQuestions}:{card:Extract<ValidCard,{kind:'symptom_gate'}>;locale:CardLocale;time:string;onQuestions:()=>void}){
 const planned=(card.outcome.symptom_gate as {choice:string}).choice==='planned';
 return <DialogTurn locale={l} action={null} time={time}><p>{say(l,planned?CONSULT.plannedReply:CONSULT.gateReply)}</p>{planned&&<button type="button" className="cv2-link" onClick={onQuestions}>{say(l,CONSULT.offer)}</button>}</DialogTurn>;
}
export function SymptomGateCard({card,locale:l,onCard,onAct}:{card:Extract<ValidCard,{kind:'symptom_gate'}>;locale:CardLocale;onCard:(c:ZoeCard)=>void;onAct:(id:string,on:boolean)=>void}){
 const {busy,problem,save,opId}=useCardSave(card.id,l,onCard,onAct);
 if(card.state==='done')return null;
 const answer=(choice:'planned'|'acute')=>save(async()=>{const r=await answerSymptomGate({cardId:card.id,opId,choice,locale:l});window.dispatchEvent(new Event(CARD_REPLY_LOST));return r;});
 return <article className="cv2-msg cv2-zoe" data-zoe-card="symptom_gate" data-chat-card-id={card.id} data-state="open"><p className="cv2-from"><i className="cv2-orb" aria-hidden/>{zoeName(l)}</p><section className="cv2-reading cv2-block"><h3>{say(l,CONSULT.gate)}</h3>
  <fieldset disabled={busy} aria-busy={busy}><button type="button" className="cv2-reading-save" onClick={()=>answer('planned')}>{say(l,CONSULT.planned)}</button><button type="button" className="cv2-link" onClick={()=>answer('acute')}>{say(l,CONSULT.acute)}</button></fieldset>
  {problem==='signed_out'?<SignInEnded locale={l}/>:problem&&<p role="alert">{problem}</p>}
 </section></article>;
}
