"use client";
import {useRef,useState,useTransition} from 'react';
import { zoeName } from '@/lib/brand';
import {FileText} from 'lucide-react';
import {saveDocumentDetailsFromCard} from '@/lib/zoe-chat-actions/labs-actions';
import {DOC_TYPES,type DocumentTile,type SavedDocument} from '@/lib/zoe-chat-actions/labs-contract';
import {LABS,DOC_TYPE,UPLOADER} from '@/lib/zoe-chat-actions/labs-copy';
import {COMMON,say,type CardLocale} from '@/lib/zoe-chat-actions/copy';
import type {ValidCard,ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {CARD_REPLY_LOST} from '@/lib/zoe-chat-actions/thread-events';
import {SignInEnded} from '@/components/patient/sign-in-ended';
import {DialogTurn} from './dialog-turn';

function Tile({document:d,locale:l,saved}:{document:DocumentTile;locale:CardLocale;saved?:SavedDocument}){
 const type=saved?.docType??d.docType,date=saved?saved.studyDate:d.studyDate;
 return <div data-document-tile>
  <p><FileText size={24} aria-hidden /> {d.fileName}</p>
  <dl><dt>{say(l,LABS.type)}</dt><dd>{type?say(l,DOC_TYPE[type]):say(l,LABS.unknown)}</dd>
   <dt>{say(l,LABS.date)}</dt><dd>{date??say(l,LABS.unknown)}</dd>
   <dt>{say(l,LABS.uploaded)}</dt><dd>{d.uploaderRole?say(l,UPLOADER[d.uploaderRole]):say(l,LABS.unknown)}</dd></dl>
  <p>{say(l,d.readStatus==='read'?LABS.read:LABS.notRead)}</p>
  {saved?.fresh===true&&<p data-lab-fresh><strong>{say(l,LABS.fresh)}</strong><br/>{say(l,LABS.dateOnly)}</p>}
 </div>;
}
export function SavedDocumentTurn({card,locale:l,time}:{card:Extract<ValidCard,{kind:'document'}>;locale:CardLocale;time:string}){
 const saved=card.outcome.document as SavedDocument;
 return <DialogTurn locale={l} action={say(l,LABS.saved)} time={time}>
  <p>{say(l,LABS.thanks)}</p>{card.snapshot.document&&<Tile document={card.snapshot.document} saved={saved} locale={l}/>}
 </DialogTurn>;
}
export function DocumentCard({card,locale:l,onCard,onAct}:{card:Extract<ValidCard,{kind:'document'}>;locale:CardLocale;onCard:(c:ZoeCard)=>void;onAct:(id:string,busy:boolean)=>void}){
 const [type,setType]=useState(card.snapshot.document?.docType??'');
 const [date,setDate]=useState(card.snapshot.document?.studyDate??'');
 const [changed,setChanged]=useState<'yes'|'no'|'unknown'>('unknown');
 const [busy,start]=useTransition(),[problem,setProblem]=useState<string|null>(null);
 const [opId]=useState(()=>crypto.randomUUID());const sending=useRef(false);
 if(card.state==='done')return null;
 const d=card.snapshot.document;
 const save=()=>{
  if(sending.current||!type)return;
  sending.current=true;onAct(card.id,true);setProblem(null);
  start(async()=>{
   try{
    const r=await saveDocumentDetailsFromCard({cardId:card.id,opId,docType:type,studyDate:date||null,medicineChangedSince:changed==='unknown'?'UNKNOWN':changed==='yes'});
    if(r.card)onCard(r.card);
    if(r.status!=='ok'){onAct(card.id,false);setProblem(r.status==='signed_out'?'signed_out':say(l,r.status==='stale'?COMMON.staleInChat:r.status==='closed'?COMMON.closed:COMMON.saveFailed));}
   }catch(error){
    if(String((error as {digest?:unknown})?.digest??'').startsWith('NEXT_REDIRECT'))throw error;
    window.dispatchEvent(new Event(CARD_REPLY_LOST));setProblem(say(l,COMMON.unconfirmed));
   }finally{sending.current=false;}
  });
 };
 return <article className="cv2-msg cv2-zoe" data-zoe-card="document" data-chat-card-id={card.id} data-state="open">
  <p className="cv2-from"><i className="cv2-orb" aria-hidden/>{zoeName(l)}</p>
  <section className="cv2-reading cv2-block" aria-label={say(l,LABS.document)}>
   <h3>{say(l,LABS.document)}</h3>
   {!d?<p role="status">{say(l,LABS.empty)}</p>:<>
    <Tile document={d} locale={l}/>
    <fieldset disabled={busy} aria-busy={busy}>
     <label className="cv2-field">{say(l,LABS.type)}<select value={type} onChange={e=>setType(e.target.value as typeof type)}><option value="">{say(l,LABS.unknown)}</option>{DOC_TYPES.map(t=><option key={t} value={t}>{say(l,DOC_TYPE[t])}</option>)}</select></label>
     <label className="cv2-field">{say(l,LABS.date)}<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
     {type==='lab'&&<label className="cv2-field">{say(l,LABS.changed)}<select value={changed} onChange={e=>setChanged(e.target.value as typeof changed)}><option value="unknown">{say(l,LABS.unsure)}</option><option value="no">{say(l,LABS.no)}</option><option value="yes">{say(l,LABS.yes)}</option></select></label>}
     <button type="button" className="cv2-reading-save" disabled={!type} onClick={save}>{say(l,LABS.save)}</button>
    </fieldset>
   </>}
   {problem==='signed_out'?<SignInEnded locale={l}/>:problem&&<p role="alert">{problem}</p>}
  </section>
 </article>;
}
