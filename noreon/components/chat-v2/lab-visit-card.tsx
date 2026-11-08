"use client";
import {useState} from 'react';
import { zoeName } from '@/lib/brand';
import {isTextUsableInLocale,memberInstruction} from '@/lib/text-language';
import {ClipboardList} from 'lucide-react';
import {answerLabCard} from '@/lib/zoe-chat-actions/labs-actions';
import {say,type CardLocale} from '@/lib/zoe-chat-actions/copy';
import {LAB_VISIT} from '@/lib/zoe-chat-actions/lab-visit-copy';
import type {ValidCard,ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {SignInEnded} from '@/components/patient/sign-in-ended';
import {DialogTurn} from './dialog-turn';
import {useCardSave} from './use-card-save';
type LabCard=Extract<ValidCard,{kind:'prep'|'fasting'}>;
export function SavedLabTurn({card,locale:l,time}:{card:LabCard;locale:CardLocale;time:string}){
 const answer=(card.outcome[card.kind] as {answer:string}).answer;
 return <DialogTurn locale={l} action={say(l,answer==='read'?LAB_VISIT.readSaid:answer==='ate'?LAB_VISIT.ateSaid:LAB_VISIT.fastingSaid)} time={time}>
  <p data-fasting-warning={answer==='ate'||undefined}>{say(l,answer==='read'?LAB_VISIT.readReply:answer==='ate'?LAB_VISIT.warning:LAB_VISIT.fastingReply)}</p>
  {answer==='read'&&<p className="cv2-preparation">{memberInstruction(card.snapshot.preparation,l)}</p>}
 </DialogTurn>;
}
export function LabVisitCard({card,locale:l,onCard,onAct}:{card:LabCard;locale:CardLocale;onCard:(c:ZoeCard)=>void;onAct:(id:string,on:boolean)=>void}){
 const {busy,problem,save,opId}=useCardSave(card.id,l,onCard,onAct);
 const lines=card.snapshot.preparation.split(/\n+/).map(s=>s.trim()).filter(Boolean);
 const usable=isTextUsableInLocale(card.snapshot.preparation,l);
 const [checked,setChecked]=useState<Set<number>>(new Set());
 if(card.state==='done')return null;
 const answer=(value:'read'|'fasting'|'ate')=>save(()=>answerLabCard({cardId:card.id,opId,answer:value}));
 return <article className="cv2-msg cv2-zoe" data-zoe-card={card.kind} data-chat-card-id={card.id} data-state="open">
  <p className="cv2-from"><i className="cv2-orb" aria-hidden/>{zoeName(l)}</p>
  <section className="cv2-reading cv2-block"><h3><ClipboardList size={18} aria-hidden/>{say(l,card.kind==='prep'?LAB_VISIT.prep:LAB_VISIT.fasting)}</h3>
   <p>{memberInstruction(card.snapshot.location,l)}</p>
   {!usable&&<p className="cv2-preparation">{memberInstruction(card.snapshot.preparation,l)}</p>}
   {(card.kind==='fasting'||usable)&&<fieldset disabled={busy} aria-busy={busy}>
    {card.kind==='prep'?<>
     {lines.map((line,i)=><label key={i} className="cv2-check"><input type="checkbox" checked={checked.has(i)} onChange={e=>setChecked(current=>{const next=new Set(current);if(e.target.checked)next.add(i);else next.delete(i);return next;})}/><span>{line}</span></label>)}
     <button type="button" className="cv2-reading-save" disabled={!lines.length||checked.size!==lines.length} onClick={()=>answer('read')}>{say(l,LAB_VISIT.read)}</button>
    </>:<>{usable&&<p className="cv2-preparation">{card.snapshot.preparation}</p>}<button type="button" className="cv2-reading-save" onClick={()=>answer('fasting')}>{say(l,LAB_VISIT.haveNotEaten)}</button><button type="button" className="cv2-link" onClick={()=>answer('ate')}>{say(l,LAB_VISIT.ate)}</button></>}
   </fieldset>}
   {problem==='signed_out'?<SignInEnded locale={l}/>:problem&&<p role="alert">{problem}</p>}
  </section>
 </article>;
}
