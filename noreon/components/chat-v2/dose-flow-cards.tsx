"use client";
import {useRef,useState,useTransition} from 'react';
import { zoeName } from '@/lib/brand';
import {answerSamsFromCard,answerV3DoseReason} from '@/lib/zoe-chat-actions/dose-actions';
import {BARRIER,noTitrationCopy} from '@/lib/zoe-chat-actions/dose-copy';
import {DOSE_REASONS,SAMS_QUESTIONS,evaluateSams,nextSamsQuestion,samsAnswers,type DoseReason} from '@/lib/zoe-chat-actions/dose-flow';
import {failedFlow,flowOf,redOutcome} from '@/lib/zoe-chat-actions/bp-flow';
import {FLOW,say,type CardLocale} from '@/lib/zoe-chat-actions/copy';
import type {ValidCard,ZoeCard,ZoeCards} from '@/lib/zoe-chat-actions/registry';
import {cardProblem,runCardAction} from '@/components/patient/use-bp-card';
import {SignInEnded} from '@/components/patient/sign-in-ended';
import {ZoeEmergencyCard} from '@/components/patient/zoe-emergency-card';
import {FlagsTurn,FlowWords,FlowZone} from './bp-flow-cards';
import {DialogTurn} from './dialog-turn';

type Props={locale:CardLocale;onCard:(card:ZoeCard)=>void;onAct:(id:string,acting:boolean)=>void};
export function DoseReasonCard({card,locale:l,onCard,onAct}:Props&{card:Extract<ValidCard,{kind:'ask'}>}){
 const [forgot,setForgot]=useState(false),[error,setError]=useState<string|null>(null),[busy,start]=useTransition();
 const op=useRef<string|null>(null);
 const answer=(reason:DoseReason,later=false)=>{
  onAct(card.id,true);
  start(async()=>{
   setError(null);
   const r=await runCardAction(()=>answerV3DoseReason({cardId:card.id,opId:op.current??=crypto.randomUUID(),reason,later}));
   if(r?.card)onCard(r.card);
   if(r?.status==='ok'&&r.next)onCard(r.next);
   if(r?.status!=='ok'){setError(cardProblem(l,r));onAct(card.id,false);}
  });
 };
 return <article className="cv2-msg cv2-zoe" data-zoe-card="ask" data-chat-card-id={card.id} data-state={busy?'loading':error?'error':'open'} aria-busy={busy}>
  <p className="cv2-from"><i className="cv2-orb" aria-hidden />{zoeName(l)}</p>
  <section className="cv2-reading"><h3>{say(l,BARRIER.title)}</h3><p>{card.snapshot.name}</p>
   {forgot?<><p>{say(l,BARRIER.noDouble)}</p><p>{say(l,BARRIER.move)}</p><div className="cv2-flag-actions"><button type="button" disabled={busy} onClick={()=>answer('forgot')}>{say(l,BARRIER.keep)}</button><button type="button" disabled={busy} onClick={()=>answer('forgot',true)}>{say(l,BARRIER.later)}</button></div></>:<div className="cv2-seg">{DOSE_REASONS.map(reason=><button key={reason} type="button" data-dose-reason={reason} disabled={busy||card.state==='done'} onClick={()=>reason==='forgot'?setForgot(true):answer(reason)}>{say(l,BARRIER[reason])}</button>)}</div>}
   {error==='signed_out'?<SignInEnded locale={l}/>:error&&<p role="alert">{error}</p>}
  </section>
 </article>;
}
export function DoseReasonTurn({card,locale:l,time}:{card:Extract<ValidCard,{kind:'ask'}>;locale:CardLocale;time:string}){
 const value=card.outcome.answer as {reason:DoseReason;later:boolean};
 const reply=value.reason==='forgot'?value.later?BARRIER.moved:BARRIER.noDouble:value.reason==='values_normal'?BARRIER.normal:value.reason==='side_effect_or_fear'?BARRIER.questions:BARRIER.logistics;
 return <DialogTurn locale={l} action={say(l,BARRIER[value.reason])} time={time}><p>{say(l,reply)}</p>{value.reason==='forgot'&&value.later&&<p>{say(l,BARRIER.noDouble)}</p>}</DialogTurn>;
}
export function SamsTurn({card,locale:l,time,stored,tasks}:{card:ZoeCard;locale:CardLocale;time:string;stored:boolean;tasks?:ZoeCards['tasks']}){
 const a=samsAnswers(card),flow=flowOf(card);
 const mandatory=(flow?.mandatoryTemplateId??evaluateSams(a).mandatoryTemplateId)==='NO_TITRATION';
 if(redOutcome(card))return <>
  <FlagsTurn card={card} locale={l} time={time} stored={stored} tasks={tasks} flow={flow}/>
  {mandatory&&<DialogTurn locale={l} action={null} time={time}><p>{say(l,noTitrationCopy(flow??failedFlow()))}</p></DialogTurn>}
 </>;
 return <DialogTurn locale={l} action={SAMS_QUESTIONS.filter(q=>a[q]!==undefined).map(q=>`${say(l,BARRIER[q])} ${say(l,a[q]?FLOW.yes:FLOW.no)}`).join('\n')} time={time}>
  {flow?.sentTo?<><FlowZone flow={flow} locale={l}/><FlowWords flow={flow} locale={l} tasks={tasks}/></>:<p>{say(l,BARRIER.checked)}</p>}
  {mandatory&&<p>{say(l,noTitrationCopy(flow??failedFlow()))}</p>}
 </DialogTurn>;
}
export function SamsCard({card,locale:l,onCard,onAct}:Props&{card:Extract<ValidCard,{kind:'sams'}>}){
 const answers=samsAnswers(card),question=nextSamsQuestion(answers);
 const [red,setRed]=useState(false),[error,setError]=useState<string|null>(null),[busy,start]=useTransition();
 const ids=useRef<Record<string,string>>({});
 if(!question)return null;
 const answer=(value:boolean)=>{
  if(evaluateSams({...answers,[question]:value}).zone==='red')setRed(true);
  onAct(card.id,true);
  start(async()=>{
   setError(null);
   const r=await runCardAction(()=>answerSamsFromCard({cardId:card.id,opId:ids.current[question]??=crypto.randomUUID(),question,answer:value,locale:l}));
   if(r?.card)onCard(r.card);
   // Partial answers leave this block open; only a final answer follows to the end.
   if(r?.status!=='ok')setError(cardProblem(l,r));
   if(r?.status!=='ok'||r.card.state!=='done')onAct(card.id,false);
  });
 };
 return <article className="cv2-msg cv2-zoe" data-zoe-card="sams" data-chat-card-id={card.id} data-state={busy?'loading':error?'error':'open'} aria-busy={busy}>
  <p className="cv2-from"><i className="cv2-orb" aria-hidden />{zoeName(l)}</p><section className="cv2-reading cv2-flags" aria-label={say(l,BARRIER.safety)}>
   <p>{SAMS_QUESTIONS.indexOf(question)+1} / {SAMS_QUESTIONS.length}</p><h3 tabIndex={-1}>{say(l,BARRIER[question])}</h3>
   <div className="cv2-flag-actions"><button type="button" data-sams-answer="yes" disabled={busy||card.state==='done'} onClick={()=>answer(true)}>{say(l,FLOW.yes)}</button><button type="button" data-sams-answer="no" disabled={busy||card.state==='done'} onClick={()=>answer(false)}>{say(l,FLOW.no)}</button></div>
   {error==='signed_out'?<SignInEnded locale={l}/>:error&&<p role="alert">{error}</p>}
  </section>{red&&<ZoeEmergencyCard locale={l} request={null} initial={null} contained/>}
 </article>;
}
