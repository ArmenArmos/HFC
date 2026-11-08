'use client';
import {useId,useState} from 'react';
import type {StaffLocale} from '@/lib/staff/staff-locale-copy';
import type {NurseVisitItem,NurseVisitReady} from '@/lib/nurse-visit/schema';
import {briefingItemTitle,visitBlockCopy,visitCopy,visitTestTitle} from '@/lib/nurse-visit/copy';
import {exceptionReasonNeedsCheck,parseVisitMeasurement,type VisitShortcutDraft} from '@/lib/nurse-visit/chat-parser';
import {shortcutActions} from '@/lib/nurse-visit/shortcut';
import {collectionCopy,collectionStatus} from '@/lib/nurse-visit/collection';

type Measurement=Extract<NurseVisitItem,{kind:'measurement'}>;
export type VisitMeasurementDraft={systolic:string;diastolic:string;pulse:string;value:string};
type Fields=VisitMeasurementDraft;
function fromWords(item:Measurement,words:string):Fields{
 const parts=/^([^/]*)\/([^\s]*)(?: (.*))?$/u.exec(words);
 return {systolic:item.field==='bp'?parts?.[1]??'':'',diastolic:item.field==='bp'?parts?.[2]??'':'',pulse:item.field==='bp'?parts?.[3]??'':'',value:item.field==='bp'?'':words};
}
const toWords=(item:Measurement,v:Fields)=>item.field==='bp'?`${v.systolic}/${v.diastolic}${v.pulse?` ${v.pulse}`:''}`:v.value;
/** Independent empty fields share the visit's BP parser and ranges, including its optional pulse. No default reading. */
export function VisitMeasurementFields({item,words,onChange,locale:l,disabled,draft,onDraft}:{item:Measurement;words:string;onChange:(words:string)=>void;locale:StaffLocale;disabled:boolean;draft?:Fields;onDraft?:(fields:Fields)=>void}){
 const copy=visitCopy(l),block=visitBlockCopy(l);
 const [values,setValues]=useState(()=>draft??fromWords(item,words));
 const fields=item.field==='bp'?(['systolic','diastolic','pulse'] as const):(['value'] as const);
 return <div data-visit-fields className="ncv2-visit-fields">{fields.map(field=>{
  const label=field==='value'?(item.field==='weight'?copy.weightInput:copy.waistInput):field==='pulse'?copy.optionalPulse:copy[field];
  const change=(value:string)=>{const next={...values,[field]:value};setValues(next);onDraft?.(next);onChange(item.field==='bp'&&(!/^\d+$/u.test(next.systolic)||!/^\d+$/u.test(next.diastolic)||!/^\d*$/u.test(next.pulse))?'':toWords(item,next));};
  const step=(delta:number)=>{if(!values[field]||!/^\d+(?:[.,]\d+)?$/u.test(values[field]))return;const unit=field==='value'?0.1:1;change(String(Math.round((Number(values[field].replace(',','.'))+delta*unit)*10)/10));};
  return <label key={field} className="ncv2-visit-field"><span>{label}</span><span className="ncv2-stepper">
   <button type="button" className="ncv2-choice" disabled={disabled||!values[field]} aria-label={`${block.decrease}: ${label}`} onClick={()=>step(-1)}>−</button>
   <input inputMode={field==='value'?'decimal':'numeric'} autoComplete="off" value={values[field]} disabled={disabled} onChange={e=>change(e.target.value)} aria-label={label}/>
   <button type="button" className="ncv2-choice" disabled={disabled||!values[field]} aria-label={`${block.increase}: ${label}`} onClick={()=>step(1)}>+</button>
  </span></label>;
 })}</div>;
}
export function VisitMeasurementBlock({item,locale,disabled,onNext,draft,onDraft,pendingChecks=0,noteChanged=false}:{item:Measurement;locale:StaffLocale;disabled:boolean;onNext:(words:string)=>void;draft?:Fields;onDraft?:(fields:Fields)=>void;pendingChecks?:number;noteChanged?:boolean}){
 const saved=item.mark?.values,block=visitBlockCopy(locale),hintId=useId();
 const initial=saved?('systolic'in saved?`${saved.systolic}/${saved.diastolic}${saved.pulse===null?'':` ${saved.pulse}`}`:String(saved.value)):'';
 const [words,setWords]=useState(()=>draft?toWords(item,draft):initial);
 const parsed=parseVisitMeasurement(item,words,locale),values=parsed.values;
 const unchanged=Boolean(item.mark?.done&&saved&&values&&('systolic'in saved&&'systolic'in values
  ?saved.systolic===values.systolic&&saved.diastolic===values.diastolic&&saved.pulse===values.pulse
  :'value'in saved&&'value'in values&&saved.value===values.value));
 const blocked=disabled||pendingChecks>0||Boolean(parsed.error)||(unchanged&&!noteChanged);
 return <><VisitMeasurementFields item={item} locale={locale} disabled={disabled} words={words} onChange={setWords} draft={draft} onDraft={onDraft}/>
  {pendingChecks>0&&<p id={hintId} data-visit-bp-pending role="status">{block.bpPending(pendingChecks)}</p>}
  <button type="button" className="ncv2-choice" disabled={blocked} aria-describedby={pendingChecks>0?hintId:undefined} onClick={()=>{if(!blocked)onNext(words);}}>{block.next}</button></>;
}

/** Every parsed value is editable. Collection needs a status or an explicit choice to leave it untouched. */
export function VisitShortcutCard({data,draft,locale:l,disabled,onChange,onConfirm,onCancel}:{data:NurseVisitReady;draft:VisitShortcutDraft;locale:StaffLocale;disabled:boolean;onChange:(draft:VisitShortcutDraft)=>void;onConfirm:()=>void;onCancel:()=>void}){
 const block=visitBlockCopy(l),copy=visitCopy(l),collection=collectionCopy(l);
 const patch=(change:Partial<VisitShortcutDraft>)=>onChange({...draft,...change});
 // Unresolved text supplies no status. The same card still lets the nurse enter each one.
 const samples:VisitShortcutDraft['samples']=draft.samples.length||!draft.collectionIssue?draft.samples:data.items.filter((i):i is Extract<NurseVisitItem,{kind:'sample'}>=>i.kind==='sample'&&collectionStatus(i)==='pending').map(i=>({testId:i.testId,status:'pending',reason:''}));
 const updateSamples=(next:VisitShortcutDraft['samples'])=>patch({samples:next,...(draft.collectionIssue&&next.every(s=>s.status!=='pending')?{collectionIssue:undefined}:{})});
 return <section data-visit-preview>
  <p><strong>{block.preview}</strong></p><p>{block.previewHelp}</p>
  {draft.collectionIssue&&<p role="status">{draft.collectionIssue==='conflicting'?block.collectionConflict:block.collectionUnresolved}</p>}
  {samples.length>0&&!data.steps.some(s=>s.step==='confirmed')&&<button type="button" className="ncv2-choice" aria-pressed={Boolean(draft.confirmed)} disabled={disabled} onClick={()=>patch({confirmed:!draft.confirmed})}>{copy.confirmed}</button>}
  {draft.arrived!==null&&<button type="button" className="ncv2-choice" aria-pressed={Boolean(draft.arrived)} disabled={disabled} onClick={()=>patch({arrived:!draft.arrived})}>{copy.started}</button>}
  {Object.entries(draft.measurements).map(([key,words])=>{
   const item=data.items.find((i):i is Measurement=>i.key===key&&i.kind==='measurement');if(!item)return null;
   return <div key={key}><p><strong>{briefingItemTitle(item,l)}</strong></p>{draft.replace?.includes(key)&&draft.notes?.[key]!==undefined&&<p className="ncv2-body">{block.savedComment}: {item.mark?.note??''}</p>}<VisitMeasurementFields item={item} words={words} onChange={value=>patch({measurements:{...draft.measurements,[key]:value}})} locale={l} disabled={disabled}/>{draft.notes?.[key]!==undefined&&<label><span>{copy.commentLabel}</span><textarea className="ncv2-sample-reason" maxLength={1000} value={draft.notes[key]} disabled={disabled} onChange={event=>patch({notes:{...draft.notes,[key]:event.target.value}})}/></label>}<button type="button" className="ncv2-choice" disabled={disabled} onClick={()=>{const measurements={...draft.measurements};delete measurements[key];patch({measurements});}}>{block.leaveUntouched}</button></div>;
  })}
  {draft.marks.map((mark,index)=>{const item=data.items.find(i=>i.key===mark.item);if(!item)return null;return <label key={mark.item}>{briefingItemTitle(item,l)}<select disabled={disabled} value={mark.done===null?'':String(mark.done)} onChange={event=>patch({marks:draft.marks.map((m,i)=>i===index?{...m,done:event.target.value===''?null:event.target.value==='true'}:m)})}><option value="">{block.leaveUntouched}</option><option value="true">{copy.done}</option><option value="false">{copy.notDone}</option></select><textarea className="ncv2-sample-reason" aria-label={copy.commentLabel} maxLength={1000} disabled={disabled} value={mark.note} onChange={event=>patch({marks:draft.marks.map((m,i)=>i===index?{...m,note:event.target.value}:m)})}/></label>;})}
  {draft.collectionException&&samples.some(s=>s.status==='pending')&&<div>
   {samples.some(s=>exceptionReasonNeedsCheck(data.items,s.reason))&&<p role="status">{block.checkOtherSamples}</p>}
   {samples.some(s=>s.status==='pending'&&!s.needsReason)&&<button type="button" className="ncv2-choice" disabled={disabled} onClick={()=>updateSamples(samples.map(s=>s.status==='pending'&&!s.needsReason?{...s,status:'collected'}:s))}>{block.markRestCollected}</button>}
  </div>}
  {samples.map((sample,index)=>{
   const item=data.items.find((i):i is Extract<NurseVisitItem,{kind:'sample'}>=>i.kind==='sample'&&i.testId===sample.testId);if(!item)return null;
   const change=(value:Partial<typeof sample>)=>updateSamples(samples.map((s,i)=>i===index?{...s,...value}:s));
   return <div key={sample.testId} data-preview-sample={sample.testId} className="ncv2-preview-sample"><p>{visitTestTitle(item,l)}</p><div role="group" aria-label={visitTestTitle(item,l)} className="flex flex-wrap gap-2">
    {(['collected','not-collected','issue'] as const).map(status=><button type="button" key={status} className="ncv2-choice" data-collection-choice={status} aria-pressed={sample.status===status} disabled={disabled} onClick={()=>change({status,needsReason:false})}>{collection.statuses[status]}</button>)}
   </div>{(sample.needsReason||sample.status==='not-collected'||sample.status==='issue')&&<label><span>{collection.reason}</span><textarea className="ncv2-sample-reason" maxLength={300} value={sample.reason} disabled={disabled} onChange={e=>change({reason:e.target.value,...(sample.needsReason?{status:e.target.value.trim()?'not-collected':'pending',needsReason:!e.target.value.trim()}:{})})}/></label>}{!draft.collectionException&&<button type="button" className="ncv2-choice" data-collection-skip disabled={disabled} onClick={()=>updateSamples(samples.filter((_,i)=>i!==index))}>{block.leaveUntouched}</button>}</div>;
  })}
  {draft.untouched.length>0&&<div><p>{block.untouched}</p><ul>{draft.untouched.map((words,index)=><li key={index} className="ncv2-body">{words}</li>)}</ul></div>}
  <button type="button" className="ncv2-choice" disabled={disabled||!shortcutActions(data,draft,l)} onClick={onConfirm}>{block.confirm}</button>
  <button type="button" className="ncv2-choice" disabled={disabled} onClick={onCancel}>{block.cancel}</button>
 </section>;
}
