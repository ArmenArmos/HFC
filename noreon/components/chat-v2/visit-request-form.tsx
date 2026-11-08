"use client";
import {useState} from 'react';
import {SignInEnded} from '@/components/patient/sign-in-ended';
import {requestVisitFromCard} from '@/lib/zoe-chat-actions/visit-request-actions';
import {VISIT_REQUEST} from '@/lib/zoe-chat-actions/lab-visit-copy';
import {visitRequestPayload,visitRequestFields,visitDayLabel,visitWindows,type VisitRequestFields} from '@/lib/zoe-chat-actions/visit-request-contract';
import type {ValidCard,ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {say,type CardLocale} from '@/lib/zoe-chat-actions/copy';
import {useCardSave} from './use-card-save';

export function VisitRequestForm({card,days,locale:l,onCard,onAct,onReload}:{
 card:Extract<ValidCard,{kind:'visit'}>;days:string[]|null;locale:CardLocale;onCard:(c:ZoeCard)=>void;
 onAct:(id:string,busy:boolean)=>void;onReload:()=>void;
}){
 const pinned=visitRequestPayload.safeParse(card.claims.booking?.payload);
 const [fields,setFields]=useState<VisitRequestFields>(()=>pinned.success?{day:pinned.data.day,window:pinned.data.window,note:pinned.data.note}:{day:'',window:'morning',note:''});
 const [locked,setLocked]=useState(pinned.success),[invalid,setInvalid]=useState(false);
 const {busy,problem,save,opId}=useCardSave(card.id,l,onCard,onAct);
 if(days===null&&!pinned.success&&!locked)return <div data-visit-request><p role="status">{say(l,VISIT_REQUEST.unavailable)}</p><button type="button" className="cv2-reading-save" onClick={onReload}>{say(l,VISIT_REQUEST.reload)}</button></div>;
 const values=pinned.success?{day:pinned.data.day,window:pinned.data.window,note:pinned.data.note}:fields;
 return <form data-visit-request onSubmit={event=>{
  event.preventDefault();
  const v=visitRequestFields.safeParse(values);
  if(!v.success||(!locked&&!pinned.success&&!days?.includes(v.data.day))){setInvalid(true);return;}
  setInvalid(false);setLocked(true);
  save(async()=>{
   const r=await requestVisitFromCard({cardId:card.id,opId,...v.data});
   if(r.status==='invalid'||r.status==='stale')setLocked(pinned.success);
   return r;
  });
 }}>
  <p>{say(l,VISIT_REQUEST.intro)}</p>
  <fieldset disabled={busy||locked||pinned.success} className="cv2-visit-fields">
   <label>{say(l,VISIT_REQUEST.day)}<select required value={values.day} onChange={e=>setFields({...fields,day:e.target.value})}>
    <option value="">{say(l,VISIT_REQUEST.chooseDay)}</option>
    {[...new Set([...(days??[]),...(values.day?[values.day]:[])])].sort().map(day=><option key={day} value={day}>{visitDayLabel(day,l)}</option>)}
   </select></label>
   <label>{say(l,VISIT_REQUEST.window)}<select value={values.window} onChange={e=>setFields({...fields,window:e.target.value as VisitRequestFields['window']})}>
    {visitWindows.map(window=><option key={window} value={window}>{say(l,VISIT_REQUEST[window])}</option>)}
   </select></label>
   <label>{say(l,VISIT_REQUEST.note)}<input type="text" maxLength={200} value={values.note} onChange={e=>setFields({...fields,note:e.target.value})}/></label>
  </fieldset>
  {pinned.success&&!busy&&<p role="status">{say(l,VISIT_REQUEST.pending)}</p>}
  {invalid&&<p role="alert">{say(l,VISIT_REQUEST.invalid)}</p>}
  {problem==='signed_out'?<SignInEnded locale={l}/>:problem&&<p role="alert">{problem}</p>}
  <button type="submit" className="cv2-reading-save" disabled={busy} aria-busy={busy}>{say(l,locked||pinned.success?VISIT_REQUEST.retry:VISIT_REQUEST.send)}</button>
 </form>;
}
