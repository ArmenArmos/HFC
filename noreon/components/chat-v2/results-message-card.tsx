'use client';
import {DialogTurn} from './dialog-turn';
import type {EverydayFeatureResult} from '@/lib/zoe-chat-actions/everyday';
import {Receipt,ZoePlanDetails} from '@/components/patient/zoe-everyday';
import {ResultsBody,MessageBody} from '@/components/patient/zoe-results-message';
import {ShowCurrent} from '@/components/patient/zoe-card-controls';
import type {ValidCard,ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {say,TITLE,type CardLocale} from '@/lib/zoe-chat-actions/copy';
import {NEXT_STEP} from '@/lib/zoe-chat-actions/next-step-copy';
/** Reuse the released-results body and the existing send path, including its confirmation and limits. */
export function ResultsMessageCard({card,locale:l,onCard,onAct}:{card:Extract<ValidCard,{kind:'results'|'message'}>;locale:CardLocale;onCard:(c:ZoeCard)=>void;onAct:(id:string,on:boolean)=>void}){
 return <article className="cv2-msg cv2-zoe" data-next-step-block data-zoe-card={card.kind} data-chat-card-id={card.id} data-state={card.state==='done'?'answered':'open'}>
  <p className="cv2-from"><i className="cv2-orb" aria-hidden/>Zoe</p>
  <section className="cv2-reading cv2-block"><h3>{say(l,TITLE[card.kind])}</h3>
   {card.kind==='results'?(!card.snapshot.available?<p role="status">{say(l,NEXT_STEP.unavailable)}</p>:!card.snapshot.rows.length&&!card.snapshot.documents?.length?<p role="status">{say(l,NEXT_STEP.waitingResults)}</p>:<ResultsBody card={card} locale={l} onCard={onCard}/>):<MessageBody card={card} locale={l} onCard={onCard} onAct={onAct}/>}
  </section>
 </article>;
}

/** Main's published-plan view, kept inside the dialog. */
export function JourneyRecordCard({card,locale:l,onCard,onAct}:{onAct:(id:string,on:boolean)=>void;card:Extract<ValidCard,{kind:'plan'}>;locale:CardLocale;onCard:(c:ZoeCard)=>void}){
 return <article className="cv2-msg cv2-zoe" data-next-step-block data-zoe-card={card.kind} data-chat-card-id={card.id}>
  <p className="cv2-from"><i className="cv2-orb" aria-hidden/>Zoe</p>
  <section className="cv2-reading cv2-block"><h3>{say(l,TITLE[card.kind])}</h3>
   <ZoePlanDetails card={card} locale={l} onCard={onCard} onAct={onAct}/>
   <ShowCurrent kind={card.kind} locale={l} onCard={onCard}/>
  </section>
 </article>;
}

/** The existing published-plan acknowledgement stays a saved dialog turn. */
export function JourneyRecordTurn({card,locale:l,time,onCard}:{card:Extract<ValidCard,{kind:'plan'}>;locale:CardLocale;time:string;onCard:(c:ZoeCard)=>void}){
 const current=<ShowCurrent kind={card.kind} locale={l} onCard={onCard}/>;
 return <DialogTurn action={say(l,NEXT_STEP.openPlan)} time={time}><Receipt view="plan_ack" result={card.outcome['everyday:result'] as EverydayFeatureResult} locale={l}/>{current}</DialogTurn>;
}
