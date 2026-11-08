'use client';
import {useId,useRef,useState} from 'react';
import {sampleKind,nurseVisitVersion,type NurseVisitCollectCommand,type NurseVisitReady} from '@/lib/nurse-visit/schema';
import {collectionCopy,collectionCounts,collectionStatus,type CollectionStatus} from '@/lib/nurse-visit/collection';
import {visitTestTitle,visitBlockCopy} from '@/lib/nurse-visit/copy';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import type {StaffLocale} from '@/lib/staff/staff-locale-copy';

type Props={remainingOnly?:boolean;data:NurseVisitReady;locale:StaffLocale;disabled:boolean;collect:(command:NurseVisitCollectCommand)=>Promise<{status:string}>;reload:()=>Promise<unknown>};
// The card is also used outside the chat stylesheet.
const choice='ncv2-choice min-h-11 rounded-md border bg-background px-3 py-2 text-start disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring';
/** One explicit collection action at a time. Unknown outcomes retain the exact command for replay. */
export function NurseSampleCollection({data,locale,disabled,collect,reload,remainingOnly=false}:Props){
 const copy=collectionCopy(locale),counts=collectionCounts(data.items),id=useId();
 const [editing,setEditing]=useState<{testId:string;status:'not-collected'|'issue'}|null>(null);
 const [reasons,setReasons]=useState<Record<string,string>>({}),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[stale,setStale]=useState(false);
 const retry=useRef<NurseVisitCollectCommand|null>(null),lock=useRef(false);
 const [uncertain,setUncertain]=useState(false);
 const readOnly=Boolean(data.completion||data.visit.completion||data.visit.bookingStatus==='completed'||data.visit.bookingStatus==='cancelled');
 const early=new Date(Date.parse(data.visit.startsAt)+4*3600_000).toISOString().slice(0,10)>data.today;
 const confirmed=data.steps.some(step=>step.step==='confirmed');
 const locked=disabled||busy||uncertain||stale||early||!confirmed;
 const reason=editing?reasons[editing.testId]??'':'';
 function command(intent:{all:true}|{testId:string;status:Exclude<CollectionStatus,'pending'>;reason:string|null}):NurseVisitCollectCommand{
  return {version:nurseVisitVersion,memberId:data.visit.memberId,source:data.visit.source,sourceId:data.visit.id,expectedRevision:data.caseRevision,arrangementToken:data.visit.arrangementToken,submissionId:crypto.randomUUID(),...intent};
 }
 async function save(input:NurseVisitCollectCommand){
  if(lock.current||!confirmed||readOnly)return;lock.current=true;setBusy(true);setMessage('');
  try{
   const result=await collect(input);
   if(result.status==='saved'){retry.current=null;setUncertain(false);setEditing(null);setMessage(copy.saved);}
   else if(result.status==='outcome-unknown'||result.status==='unavailable'){retry.current=input;setUncertain(true);setMessage(copy.failed);}
   else {retry.current=null;setUncertain(false);setStale(true);setMessage(result.status==='stale'?copy.stale:copy.unavailable);}
  }catch{retry.current=input;setUncertain(true);setMessage(copy.failed);}
  finally{lock.current=false;setBusy(false);}
 }
 function edit(testId:string,status:'not-collected'|'issue',savedReason:string|null){
  if(locked)return;setEditing({testId,status});setReasons(previous=>({...previous,[testId]:previous[testId]??savedReason??''}));setMessage('');
 }
 async function refresh(){
  if(lock.current)return;lock.current=true;setBusy(true);
  try{const fresh=await reload();if(fresh){setStale(false);setMessage('');}else setMessage(copy.unavailable);}
  catch{setMessage(copy.unavailable);}
  finally{lock.current=false;setBusy(false);}
 }
 return <section data-sample-collection lang={locale} aria-labelledby={`${id}-title`} className="min-w-0 space-y-3 break-words">
  <h3 id={`${id}-title`} className="font-semibold">{copy.title} · {data.visit.memberName}</h3>
  <p aria-live="polite">{remainingOnly&&counts.total>0&&counts.collected===counts.total?visitBlockCopy(locale).allCollected:copy.summary(data.items)}</p>
  {!counts.total&&<p>{copy.empty}</p>}
  <ul className="ncv2-list">{data.items.filter((item):item is Extract<NurseVisitReady['items'][number],{kind:'sample'}>=>item.kind==='sample'&&(!remainingOnly||collectionStatus(item)!=='collected')).map(item=>{
   const status=collectionStatus(item),kind=sampleKind(item.testId),active=editing?.testId===item.testId;
   return <li key={item.key} className="min-w-0 space-y-2 border-t py-3">
    <div className="flex flex-wrap items-start justify-between gap-2"><strong className="min-w-0 break-words">{visitTestTitle(item,locale)}</strong><span data-sample-status={status} className="rounded-full border px-2 py-1 text-caption">{copy.statuses[status]}</span></div>
    {kind&&<p className="text-caption">{kind==='blood'?copy.blood:copy.urine}</p>}
    {item.mark?.note&&<p className="ncv2-body">{item.mark.note}</p>}
    {item.mark&&<p className="cv2-time">{item.mark.nurseName} · {yerevanStamp(item.mark.recordedAt,locale)}</p>}
    {!readOnly&&<div className="flex flex-wrap gap-2">
     {status!=='collected'&&status!=='pending'&&<button type="button" className={choice} disabled={locked} aria-describedby={!confirmed?`${id}-confirm-first`:undefined} onClick={()=>void save(command({testId:item.testId,status:'collected',reason:null}))}>{copy.collected}</button>}
     <button type="button" className={choice} disabled={locked} aria-describedby={!confirmed?`${id}-confirm-first`:undefined} onClick={()=>edit(item.testId,'not-collected',item.mark?.note??null)}>{copy.statuses['not-collected']}</button>
     <button type="button" className={choice} disabled={locked} aria-describedby={!confirmed?`${id}-confirm-first`:undefined} onClick={()=>edit(item.testId,'issue',item.mark?.note??null)}>{copy.statuses.issue}</button>
    </div>}
    {active&&editing&&!readOnly&&<div className="space-y-2">
     <p>{copy.statuses[editing.status]}</p>
     <label htmlFor={`${id}-reason`} className="block">{copy.reason}</label>
     <textarea id={`${id}-reason`} className="ncv2-sample-reason block min-h-22 w-full rounded-md border bg-background p-3 text-base" value={reason} maxLength={300} required rows={3} disabled={busy||uncertain} onChange={event=>{const value=event.target.value;setReasons(previous=>({...previous,[item.testId]:value}));}}/>
     <div className="flex flex-wrap gap-2"><button type="button" className={choice} disabled={locked||reason.trim().length<1||reason.trim().length>300} onClick={()=>void save(command({testId:item.testId,status:editing.status,reason:reason.trim()}))}>{copy.save}</button><button type="button" className={choice} disabled={busy||uncertain} onClick={()=>setEditing(null)}>{copy.cancel}</button></div>
    </div>}
   </li>;
  })}</ul>
  {!readOnly&&counts.pending>0&&<div className="space-y-2"><p id={`${id}-confirm`}>{copy.explanation(counts.pending)}</p><button type="button" className={`${choice} ncv2-sample-confirm w-full`} aria-describedby={`${id}-confirm${!confirmed?` ${id}-confirm-first`:``}`} disabled={locked||editing!==null} onClick={()=>void save(command({all:true}))}>{copy.confirm}</button></div>}
  {!readOnly&&!confirmed&&<p id={`${id}-confirm-first`}>{copy.confirmFirst}</p>}
  {readOnly&&<p>{copy.readonly}</p>}
  {readOnly&&editing&&reason&&<p className="ncv2-body">{copy.reason}: {reason}</p>}
  {(busy||message)&&<p role="status" className="ncv2-body">{busy?copy.saving:message}</p>}
  {!readOnly&&uncertain&&<button type="button" className={choice} disabled={busy||!confirmed} onClick={()=>{if(retry.current)void save(retry.current);}}>{copy.retry}</button>}
  {!readOnly&&stale&&<button type="button" className={choice} disabled={busy} onClick={()=>void refresh()}>{copy.reload}</button>}
 </section>;
}
