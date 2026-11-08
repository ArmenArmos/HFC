'use client';
import {memberInstruction} from '@/lib/text-language';
import { zoeName } from '@/lib/brand';
import {TestPrices} from '@/components/pilot-commerce/member-pricing';
import {followNextStep} from '@/lib/zoe-chat-actions/next-step-actions';
import {NEXT_STEP} from '@/lib/zoe-chat-actions/next-step-copy';
import {ONBOARDING,say,type CardLocale} from '@/lib/zoe-chat-actions/copy';
import type {ValidCard,ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {SignInEnded} from '@/components/patient/sign-in-ended';
import {useCardSave} from './use-card-save';
import {DialogTurn} from './dialog-turn';

type StepCard=Extract<ValidCard,{kind:'next_step'|'tests_needed'}>;
type Props={card:StepCard;locale:CardLocale;onCard:(c:ZoeCard)=>void;onAct:(id:string,on:boolean)=>void;onMessage:()=>void;disabled?:boolean};
export function NextStepTurn({card,locale:l,time}:{card:StepCard;locale:CardLocale;time:string}){
 return <DialogTurn locale={l} action={say(l,card.kind==='next_step'?card.snapshot.button:NEXT_STEP.book)} time={time}><p>{say(l,NEXT_STEP.saved)}</p></DialogTurn>;
}
export function NextStepCard({card,locale:l,onCard,onAct,onMessage,disabled=false}:Props){
 const {busy,problem,save}=useCardSave(card.id,l,onCard,onAct);
 if(card.state==='done')return null;
 const step=card.kind==='next_step'?card.snapshot:null;
 const tests=card.kind==='tests_needed'?card.snapshot:null;
 const rows=tests?.rows.filter(t=>!t.fresh)??[];
 const visitTests=rows.filter(t=>t.method!=='home-log');
 const button=step?step.button:NEXT_STEP.book;
 const canOpen=step?!!step.target:!!tests?.available&&!!visitTests.length;
 const follow=()=>save(()=>followNextStep({cardId:card.id}));
 return <article className="cv2-msg cv2-zoe" data-next-step-block data-zoe-card={card.kind} data-chat-card-id={card.id} data-state={busy?'loading':problem?'error':disabled?'disabled':!canOpen?'waiting':'open'}>
  <p className="cv2-from"><i className="cv2-orb" aria-hidden/>{zoeName(l)}</p>
  <section className="cv2-reading cv2-block" aria-busy={busy}>
   <h3>{say(l,step?.title??NEXT_STEP.tests)}</h3>
   {step&&<><p>{memberInstruction(say(l,step.detail),l)}</p>{step.doctorInLoop&&<p data-template="DOCTOR_IN_LOOP">{say(l,NEXT_STEP.doctor)}</p>}</>}
   {tests&&<>{!tests.available?<p role="status">{say(l,NEXT_STEP.unavailable)}</p>:rows.length?<><p>{say(l,NEXT_STEP.testsDetail)}</p><TestPrices items={visitTests.map(t=>({id:t.id,title:t.name?.[l]??t.title}))} pricing={tests.pricing?{...tests.pricing,payments:null}:undefined} locale={l}/>{rows.some(t=>t.method==='home-log')&&<ul>{rows.filter(t=>t.method==='home-log').map(t=><li key={t.id}>{t.name?.[l]??t.title}</li>)}</ul>}</>:<p>{say(l,NEXT_STEP.emptyTests)}</p>}</>}
   {canOpen&&(!problem||problem==='signed_out')&&<button type="button" className="cv2-reading-save" data-next-step-target={step?.target??'visit'} disabled={disabled||busy} onClick={follow}>{say(l,busy?ONBOARDING.working:button)}</button>}
   {problem==='signed_out'?<SignInEnded locale={l}/>:problem&&<FollowRecovery locale={l} disabled={disabled||busy} onRetry={follow} onMessage={onMessage}/>}
  </section>
 </article>;
}

import {requestReviewFromCard} from '@/lib/zoe-chat-actions/next-step-actions';
export function ReviewCard({card,locale:l,onCard,onAct,onMessage}:{card:Extract<ValidCard,{kind:'review'}>;locale:CardLocale;onCard:(c:ZoeCard)=>void;onAct:(id:string,on:boolean)=>void;onMessage:()=>void}){
 const {busy,problem,save}=useCardSave(card.id,l,onCard,onAct);
 if(card.state==='done')return null;
 const follow=()=>save(()=>requestReviewFromCard({cardId:card.id}));
 return <article className="cv2-msg cv2-zoe" data-next-step-block data-zoe-card="review" data-chat-card-id={card.id}><p className="cv2-from"><i className="cv2-orb" aria-hidden/>{zoeName(l)}</p><section className="cv2-reading cv2-block" aria-busy={busy}><h3>{say(l,NEXT_STEP.review)}</h3>{(!problem||problem==='signed_out')&&<button type="button" className="cv2-reading-save" disabled={busy} onClick={follow}>{say(l,busy?ONBOARDING.working:NEXT_STEP.review)}</button>}{problem==='signed_out'?<SignInEnded locale={l}/>:problem&&<FollowRecovery locale={l} disabled={busy} onRetry={follow} onMessage={onMessage}/>}</section></article>;
}

function FollowRecovery({locale:l,disabled,onRetry,onMessage}:{locale:CardLocale;disabled:boolean;onRetry:()=>void;onMessage:()=>void}){
 return <div role="alert"><p>{say(l,NEXT_STEP.failure)}</p>
  <button type="button" className="cv2-reading-save" disabled={disabled} onClick={onRetry}>{say(l,NEXT_STEP.retry)}</button>
  <button type="button" className="cv2-link" onClick={onMessage}>{say(l,NEXT_STEP.careTeam)}</button>
 </div>;
}
