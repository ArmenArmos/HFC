"use client";
import {useId,useRef,useState,useTransition} from 'react';
import { zoeName } from '@/lib/brand';
import {isTextUsableInLocale,memberInstruction} from '@/lib/text-language';
import Link from 'next/link';
import {NEXT_STEP} from '@/lib/zoe-chat-actions/next-step-copy';
import {BadgeCheck,Pill} from 'lucide-react';
import {confirmPlanFromCard} from '@/lib/zoe-chat-actions/plan-actions';
import {PLAN} from '@/lib/zoe-chat-actions/plan-copy';
import {COMMON,ONBOARDING,say,type CardLocale} from '@/lib/zoe-chat-actions/copy';
import {formatMmol} from '@/lib/ldl/status';
import {formatMemberDate} from '@/lib/patient/date-format';
import type {ValidCard,ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {cardProblem,runCardAction} from '@/components/patient/use-bp-card';
import {SignInEnded} from '@/components/patient/sign-in-ended';
import {DialogTurn} from './dialog-turn';

const TABS=['medicines','targets','lifestyle','calendar']as const;
type Tab=typeof TABS[number];
export function ConfirmedPlanTurn({locale:l,time}:{locale:CardLocale;time:string}){
 return <DialogTurn locale={l} action={say(l,PLAN.confirm)} time={time}><p data-zoe-plan-confirmed>{say(l,PLAN.saved)}</p></DialogTurn>;
}
/** Read-only published content. Only the separate teach-back metadata can be changed by the button. */
export function PlanCard({card,locale:l,onCard,onAct,onRefresh}:{card:Extract<ValidCard,{kind:'plan'}>;locale:CardLocale;onCard:(card:ZoeCard)=>void;onAct:(id:string,acting:boolean)=>void;onRefresh:()=>void}){
 const [tab,setTab]=useState<Tab>('medicines');
 const [error,setError]=useState<string|null>(null);
 const [busy,start]=useTransition();
 const op=useRef<string|null>(null);
 const id=useId();
 const {plan:p,v3:d}=card.snapshot;
 const names=p?.medicines.map(m=>m.name)??[];
 const usable=!!d&&[d.lifestyle,d.followUp].every(text=>!text||isTextUsableInLocale(text,l,names));
 const date=(value:string)=>formatMemberDate(value,l,{timeZone:'Asia/Yerevan',year:'numeric',month:'short',day:'numeric'});
 const confirm=()=>{
  if(!usable||busy)return;
  onAct(card.id,true);
  start(async()=>{
   setError(null);
   const r=await runCardAction(()=>confirmPlanFromCard({cardId:card.id,opId:op.current??=crypto.randomUUID()}));
   if(r?.card)onCard(r.card);
   if(r?.status!=='ok'){setError(cardProblem(l,r));onAct(card.id,false);}
  });
 };
 return <article className="cv2-msg cv2-zoe" data-zoe-card="plan" data-chat-card-id={card.id} data-state={busy?'loading':!p||!d?'unavailable':d.teachBackConfirmedAt?'answered':'open'}>
  <p className="cv2-from"><i className="cv2-orb" aria-hidden/>{zoeName(l)}</p>
  <section className="cv2-reading cv2-block cv2-plan" aria-label={say(l,PLAN.title)} aria-busy={busy}>
   <h3><Pill size={18} aria-hidden/>{say(l,PLAN.title)}</h3>
   {!p||!d?<><p role="status">{say(l,card.snapshot.available&&d===null?PLAN.empty:PLAN.unavailable)}</p><button type="button" className="cv2-link" onClick={onRefresh}>{say(l,COMMON.retry)}</button></>:<>
    <div className="cv2-plan-tabs" role="tablist" aria-label={say(l,PLAN.title)}>
     {TABS.map((key,index)=><button type="button" key={key} role="tab" id={`${id}-${key}`} aria-selected={key===tab} aria-controls={`${id}-panel`} tabIndex={key===tab?0:-1} disabled={busy} onClick={()=>setTab(key)} onKeyDown={event=>{
      const next=event.key==='ArrowRight'?(index+1)%TABS.length:event.key==='ArrowLeft'?(index+TABS.length-1)%TABS.length:event.key==='Home'?0:event.key==='End'?TABS.length-1:null;
      if(next!==null){event.preventDefault();setTab(TABS[next]);document.getElementById(`${id}-${TABS[next]}`)?.focus();}
     }}>{say(l,PLAN[key])}</button>)}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} tabIndex={0} className="cv2-plan-panel">
     {tab==='medicines'&&<>{p.medicines.length?p.medicines.map((m,i)=><div className="cv2-med" key={i}><p>{m.name}</p><p>{m.dose}</p><p className="cv2-plan-times">{m.times.join(' · ')||say(l,PLAN.unknown)}</p></div>):<p>{say(l,PLAN.noMedicines)}</p>}<p className="cv2-hint">{say(l,PLAN.statin)}</p></>}
     {tab==='targets'&&<>
      <div><h4>{say(l,PLAN.bp)}</h4><p>{d.bp?`${d.bp.systolic}/${d.bp.diastolic}`:say(l,PLAN.unknown)}</p></div>
      <div><h4>{say(l,PLAN.ldl)}</h4><p>{d.ldl?`< ${formatMmol(d.ldl.target)} mmol/L`:say(l,PLAN.unknown)}</p>
       {d.ldl?.current!==null&&d.ldl?.current!==undefined&&<><p>{say(l,PLAN.current)}: {formatMmol(d.ldl.current,d.ldl.target)} mmol/L</p><meter aria-label={say(l,PLAN.current)} min={0} max={Math.max(d.ldl.current,d.ldl.target)*1.5} value={d.ldl.current}/></>}
      </div>
     </>}
     {tab==='lifestyle'&&<p>{d.lifestyle?memberInstruction(d.lifestyle,l,names):say(l,PLAN.unknown)}</p>}
     {tab==='calendar'&&<>{d.followUp&&<p>{memberInstruction(d.followUp,l,names)}</p>}{d.calendar.length?d.calendar.map(t=><div key={t.id}><h4>{t.title}</h4><p>{t.dueAt?date(t.dueAt):say(l,PLAN.unknown)}</p></div>):<p>{say(l,PLAN.noDates)}</p>}</>}
    </div>
    <p className="cv2-plan-seal"><BadgeCheck size={18} aria-hidden/>{say(l,PLAN.seal)}{d.clinician?` · ${d.clinician}`:''} · {date(d.publishedAt)}</p>
    {d.teachBackConfirmedAt?<p data-zoe-plan-confirmed>{say(l,PLAN.saved)}</p>:<button type="button" className="cv2-reading-save" data-confirm-plan disabled={busy||!usable} onClick={confirm}>{say(l,busy?ONBOARDING.working:PLAN.confirm)}</button>}
    {!usable&&<Link className="cv2-link" href="/patient/team?section=contact">{say(l,NEXT_STEP.careTeam)}</Link>}
   </>}
   {error==='signed_out'?<SignInEnded locale={l}/>:error&&<p role="alert">{error}</p>}
   {error&&error!=='signed_out'&&<button type="button" className="cv2-link" disabled={busy} onClick={onRefresh}>{say(l,PLAN.recheck)}</button>}
  </section>
 </article>;
}
