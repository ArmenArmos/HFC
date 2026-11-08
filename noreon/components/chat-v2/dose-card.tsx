"use client";
import {useRef,useState,useTransition} from 'react';
import {logV3DoseFromCard} from '@/lib/zoe-chat-actions/dose-actions';
import {DOSE} from '@/lib/zoe-chat-actions/dose-copy';
import {say,type CardLocale} from '@/lib/zoe-chat-actions/copy';
import {doseItem,type ValidCard,type ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {cardProblem,runCardAction} from '@/components/patient/use-bp-card';
import {SignInEnded} from '@/components/patient/sign-in-ended';
import {DialogTurn} from './dialog-turn';

type DoseCard=Extract<ValidCard,{kind:'dose'}>;
export function DoseTurn({card,item,locale:l,time}:{card:DoseCard;item:string;locale:CardLocale;time:string}){
 const slot=card.snapshot.slots.find(s=>doseItem(s)===item);
 const value=card.outcome[item] as {status:string};
 return slot?<DialogTurn action={say(l,DOSE.action(slot.name,value.status))} time={time}><p>{say(l,DOSE.recorded)}</p></DialogTurn>:null;
}
export function DoseCard({card,locale:l,onCard,onAct}:{card:DoseCard;locale:CardLocale;onCard:(card:ZoeCard)=>void;onAct:(id:string,acting:boolean)=>void}){
 const [error,setError]=useState<string|null>(null),[busy,start]=useTransition();
 const op=useRef<string|null>(null);
 const slot=card.snapshot.slots[0];
 const answer=(status:'taken'|'skipped')=>{
  onAct(card.id,true);
  start(async()=>{
   setError(null);
   const r=await runCardAction(()=>logV3DoseFromCard({cardId:card.id,opId:op.current??=crypto.randomUUID(),medicineId:slot.medicineId,dueAt:slot.dueAt,status}));
   if(r?.card)onCard(r.card);
   if(r?.status==='ok'&&r.next)onCard(r.next);
   if(r?.status!=='ok'){setError(cardProblem(l,r));onAct(card.id,false);}
  });
 };
 return <article className="cv2-msg cv2-zoe" data-zoe-card="dose" data-chat-card-id={card.id} data-state={busy?'loading':error?'error':card.snapshot.enabled?'open':'disabled'} aria-busy={busy}>
  <p className="cv2-from"><i className="cv2-orb" aria-hidden />Zoe</p>
  <section className="cv2-reading">
   <h3>{say(l,DOSE.title)}</h3>
   {slot?<><p><strong>{slot.name}</strong> · {slot.dose} · <time dateTime={slot.dueAt}>{slot.time}</time></p>
    <div className="cv2-flag-actions">{(['taken','skipped']as const).map(s=><button key={s} type="button" data-dose-answer={s} disabled={busy||!card.snapshot.enabled||slot.status!=='due'||card.state==='done'} onClick={()=>answer(s)}>{say(l,DOSE[s])}</button>)}</div></>:<p role="status">{say(l,DOSE.empty)}</p>}
   {error==='signed_out'?<SignInEnded locale={l}/>:error&&<p role="alert">{error}</p>}
  </section>
 </article>;
}
