'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {Check,Circle,X,FlaskConical,HeartPulse,MonitorSmartphone,ListChecks,CircleCheckBig,Route} from 'lucide-react';
import {fieldClass,buttonClass} from './shell';
import {BpHighWarning} from './bp-high-warning';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {staffStepLabel} from './nurse-visit-timeline';
import {NurseSampleCollection} from '@/components/nurse-chat-v2/sample-collection';
import {recordNurseVisitCollect,refreshNurseVisit} from '@/lib/nurse-visit/actions';
import {nurseVisitVersion,nurseCommentMax,type NurseVisitCollectCommand,type NurseVisitReady,type NurseVisitItem,type NurseVisitMarkCommand,type NurseVisitMarkResult,type NurseVisitCompleteCommand,type NurseVisitCompleteResult,type NurseVisitStepCommand,type NurseVisitStepResult,type StaffStep} from '@/lib/nurse-visit/schema';

import type {Locale} from '@/lib/locale';
import {visitCopy,notConfirmed,itemTitle,itemDetail,stateLabel,valueText} from '@/lib/nurse-visit/copy';
type Ids={submissionId:string;visitId:string;openSubmissionId:string;appendSubmissionId:string};
type Props={inline?:boolean;data:NurseVisitReady;locale:Locale;completeIds:Ids;mark:(input:NurseVisitMarkCommand)=>Promise<NurseVisitMarkResult>;complete:(input:NurseVisitCompleteCommand)=>Promise<NurseVisitCompleteResult>;step:(input:NurseVisitStepCommand)=>Promise<NurseVisitStepResult>};
const secondary='inline-flex min-h-11 items-center justify-center gap-2 rounded-md border bg-background px-4 py-2 text-body2 font-medium hover:bg-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring';
type Mark=NonNullable<NurseVisitItem['mark']>;
/** One action list per visit, with the visit steps. Each tick and step is saved at once; the
 * database decides which items exist, so this screen never adds one of its own. */
export function NurseVisitActions({data:initialData,locale:l,completeIds,mark,complete,step,inline=false}:Props){
 const router=useRouter();
 const [data,setData]=useState(initialData),[sourceData,setSourceData]=useState(initialData);
 if(sourceData!==initialData){setSourceData(initialData);setData(initialData);}
 async function reloadCollection(){
  const fresh=await refreshNurseVisit(data.visit.memberId,data.visit.source,data.visit.id);
  if(fresh)setData(fresh);
  return fresh;
 }
 async function collect(command:NurseVisitCollectCommand){
  const result=await recordNurseVisitCollect(command);
  // A saved reply with an unreadable record is still uncertain: replay the same receipt.
  if(result.status==='saved'){
   if(!await reloadCollection())return {status:'outcome-unknown'};
   router.refresh();
  }
  return result;
 }
 const [marks,setMarks]=useState<Record<string,Mark|null>>(()=>Object.fromEntries(data.items.map(item=>[item.key,item.mark])));
 const [sourceItems,setSourceItems]=useState(data.items);
 if(sourceItems!==data.items){setSourceItems(data.items);setMarks(Object.fromEntries(data.items.map(item=>[item.key,item.mark])));}
 const done=data.completion!==null;
 const of=(kind:NurseVisitItem['kind'])=>data.items.filter(item=>item.kind===kind);
 const checks=data.items.filter((item):item is Extract<NurseVisitItem,{kind:'check'}>=>item.kind==='check');
 const open=data.items.filter(item=>!marks[item.key]?.done);
 const startsDay=new Date(Date.parse(data.visit.startsAt)+4*3600_000).toISOString().slice(0,10);
 const early=startsDay>data.today;
 const samplesTaken=of('sample').some(item=>marks[item.key]?.done);
 const [expanded,setExpanded]=useState<Record<string,boolean>>({'nv-steps':true});
 const section=(id:string,icon:React.ReactNode,title:string,children:React.ReactNode)=>inline?<details open={expanded[id]??false} onToggle={event=>{const open=event.currentTarget.open;setExpanded(current=>current[id]===open?current:{...current,[id]:open});}} aria-labelledby={id} className="rounded-xl border bg-card p-3 sm:p-4"><summary id={id} className="min-h-11 cursor-pointer content-center text-body1 font-medium"><span className="inline-flex items-center gap-2">{icon}{title}</span></summary><div className="mt-3 space-y-3">{children}</div></details>:<section aria-labelledby={id} className="space-y-3 rounded-xl border bg-card p-4 sm:p-5"><h2 id={id} className="flex items-center gap-2 text-h3">{icon}{title}</h2>{children}</section>;
 const list=(items:NurseVisitItem[])=><ul className="space-y-2">{items.filter(item=>item.kind!=='sample').map(item=><ActionItem key={item.key} compact={inline} item={item} mark={marks[item.key]??null} locale={l} readOnly={done} early={early} data={data} send={mark} onSaved={next=>{setMarks(current=>({...current,[item.key]:next}));router.refresh();}}/>)}</ul>;
 return <div className={inline?"space-y-4":"space-y-4 pb-28"}>
  {done&&<p role="status" className="flex items-start gap-2 rounded-xl border border-primary bg-card p-4 text-body2"><CircleCheckBig className="mt-0.5 size-5 shrink-0" aria-hidden/>{visitCopy(l).completionSummary(data)}</p>}
  {done&&data.completion?.reason&&<p className="rounded-xl border bg-card p-4 text-body2 whitespace-pre-wrap break-words">{visitCopy(l).reasonHeading}: {data.completion.reason}</p>}
  {section('nv-steps',<Route className="size-5" aria-hidden/>,visitCopy(l).visitSteps,<StepsPanel key={`${data.visit.arrangementToken}:${data.visit.startsAt}`} data={data} locale={l} early={early} done={done} samplesTaken={samplesTaken} send={step} onSaved={()=>router.refresh()}/>)}
  {/* Safety must stay readable when any visit section or item editor is closed. */}
  <section aria-labelledby="nv-safety" className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
   <h2 id="nv-safety" className="flex items-center gap-2 text-h3"><ListChecks className="size-5" aria-hidden/>{visitCopy(l).safety}</h2>
   {list(checks.filter(item=>item.section==='safety'))}
  </section>
  {section('nv-samples',<FlaskConical className="size-5" aria-hidden/>,visitCopy(l).samples,<>
   {list(checks.filter(item=>item.section==='sampling'))}
   <NurseSampleCollection data={data} locale={l} disabled={false} collect={collect} reload={reloadCollection}/>
  </>)}
  {section('nv-measures',<HeartPulse className="size-5" aria-hidden/>,visitCopy(l).measurements,<>
   {list(checks.filter(item=>item.section==='bp'))}
   {list(of('measurement'))}
  </>)}
  {section('nv-devices',<MonitorSmartphone className="size-5" aria-hidden/>,visitCopy(l).devices,of('device').length?list(of('device')):<p className="text-body2 text-muted-foreground">{visitCopy(l).noDevice}</p>)}
  {!done&&<CompletePanel inline={inline} data={data} locale={l} ids={completeIds} open={open} early={early} complete={complete} onDone={()=>router.refresh()}/>}
 </div>;
}

function StepsPanel({data,locale:l,early,done,samplesTaken,send,onSaved}:{data:NurseVisitReady;locale:Locale;early:boolean;done:boolean;samplesTaken:boolean;send:Props['step'];onSaved:()=>void}){
 // Server steps win; a step saved here shows at once until the refreshed props carry it.
 const [local,setLocal]=useState<StaffStep[]>([]);
 const steps=[...data.steps,...local.filter(x=>!data.steps.some(y=>y.step===x.step))];
 const [pending,setPending]=useState<string|null>(null),[message,setMessage]=useState('');
 const retry=useRef<NurseVisitStepCommand|null>(null),lock=useRef(false);
 const has=(s:StaffStep['step'])=>steps.some(x=>x.step===s);
 const tappable=[
  {step:'confirmed' as const,button:visitCopy(l).confirmed,ready:!done,why:''},
  {step:'started' as const,button:visitCopy(l).started,ready:!done&&!early,why:early?visitCopy(l).onDay:''},
  {step:'samples-collected' as const,button:visitCopy(l).samplesCollected,ready:!done&&!early&&samplesTaken,why:early?visitCopy(l).onDay:!samplesTaken?visitCopy(l).sampleRequired:''},
  {step:'samples-at-lab' as const,button:visitCopy(l).samplesAtLab,ready:has('samples-collected'),why:has('samples-collected')?'':visitCopy(l).afterCollection},
 ];
 async function tap(stepName:NurseVisitStepCommand['step']){
  if(lock.current)return;lock.current=true;
  const command:NurseVisitStepCommand=retry.current?.step===stepName?retry.current:{version:nurseVisitVersion,memberId:data.visit.memberId,source:data.visit.source,sourceId:data.visit.id,submissionId:crypto.randomUUID(),step:stepName};
  setPending(stepName);setMessage('');
  try{
   const result=await send(command);
   if(result.status==='saved'||result.status==='already-recorded'){retry.current=null;setLocal(current=>[...current,{step:stepName,at:result.occurredAt,by:visitCopy(l).you}]);setMessage(visitCopy(l).saved);onSaved();}
   else if(result.status==='outcome-unknown'||result.status==='unavailable'){retry.current=command;setMessage(notConfirmed(l));}
   else{retry.current=null;setMessage(result.status==='too-early'?visitCopy(l).stepOnDay:result.status==='no-samples'?visitCopy(l).recordSamples:result.status==='no-lab-entries'?visitCopy(l).noLabEntries:result.status==='completed'?visitCopy(l).alreadyCompleted:visitCopy(l).changed);}
  }catch{retry.current=command;setMessage(notConfirmed(l));}
  finally{lock.current=false;setPending(null);}
 }
 return <div className="space-y-3">
  <ol className="space-y-3">
   {tappable.map(t=>{const s=steps.find(x=>x.step===t.step);return <li key={t.step} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-3">
    <span className="flex min-w-0 items-start gap-2 text-body2">{s?<Check className="mt-0.5 size-4 shrink-0" aria-hidden/>:<Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden/>}<span>{s?staffStepLabel[t.step][l]:null}{t.step==='started'&&!s?` ${visitCopy(l).optional}`:''}{s&&<span className="block text-caption text-muted-foreground">{yerevanStamp(s.at,l)} · {s.by}</span>}{!s&&t.why&&<span className="block text-caption text-muted-foreground">{t.why}</span>}</span></span>
    {!s&&(!done||t.step==='samples-at-lab')&&<button type="button" className={secondary} disabled={!t.ready||pending!==null} onClick={()=>tap(t.step)}>{pending===t.step?visitCopy(l).saving:t.button}</button>}
   </li>;})}
   <li className="flex items-start gap-2 rounded-lg border bg-background p-3 text-body2">{done?<Check className="mt-0.5 size-4 shrink-0" aria-hidden/>:<Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden/>}<span>{staffStepLabel.completed[l]}{done?<span className="block text-caption text-muted-foreground">{yerevanStamp(data.completion!.completedAt,l)} · {data.completion!.nurseName}</span>:<span className="block text-caption text-muted-foreground">{visitCopy(l).useComplete}</span>}</span></li>
  </ol>
  <p role="status" aria-live="polite" className="text-caption">{message}</p>
 </div>;
}

function ActionItem({item,mark,locale:l,readOnly,early,data,send,onSaved,compact=false}:{compact?:boolean;item:Exclude<NurseVisitItem,{kind:'sample'}>;mark:Mark|null;locale:Locale;readOnly:boolean;early:boolean;data:NurseVisitReady;send:Props['mark'];onSaved:(mark:Mark)=>void}){
 const measure=item.kind==='measurement'?item.field:null;
 const v=mark?.values;
 const [note,setNote]=useState(mark?.note??'');
 const [noteOpen,setNoteOpen]=useState(Boolean(mark?.note));
 const [sys,setSys]=useState(v&&'systolic'in v?String(v.systolic):''),[dia,setDia]=useState(v&&'systolic'in v?String(v.diastolic):''),[pulse,setPulse]=useState(v&&'systolic'in v&&v.pulse!=null?String(v.pulse):'');
 const [single,setSingle]=useState(v&&'value'in v?String(v.value):'');
 const [pending,setPending]=useState(false),[message,setMessage]=useState('');
 const retry=useRef<NurseVisitMarkCommand|null>(null),lock=useRef(false);
 // QA 155: like the arrival step, items are recorded on the visit day; the database refuses them earlier.
 const locked=pending||early;
 const id=`nv-${item.key.replace(/[^a-z0-9]/gi,'-')}`;
 async function save(doneValue:boolean){
  if(lock.current)return;
  setMessage('');
  let values:NurseVisitMarkCommand['values']=null;
  if(measure==='bp'&&doneValue){
   const s=Number(sys),d=Number(dia),p=pulse.trim()===''?null:Number(pulse);
   if(!Number.isInteger(s)||!Number.isInteger(d)||(p!==null&&!Number.isInteger(p))||s<60||s>300||d<30||d>200||s<=d||(p!==null&&(p<20||p>250))){setMessage(visitCopy(l).bpRange);return;}
   values={systolic:s,diastolic:d,pulse:p};
  }else if(measure&&doneValue){
   const n=Number(single.replace(',','.')),[lo,hi]=measure==='weight'?[20,400]:[30,250];
   if(single.trim()===''||!Number.isFinite(n)||n<lo||n>hi){setMessage(visitCopy(l).scalarRange(lo,hi));return;}
   values={value:n};
  }
  const trimmed=note.trim();
  const command:NurseVisitMarkCommand=retry.current&&retry.current.done===doneValue&&retry.current.note===(trimmed||null)&&JSON.stringify(retry.current.values)===JSON.stringify(values)?retry.current
   :{version:nurseVisitVersion,memberId:data.visit.memberId,source:data.visit.source,sourceId:data.visit.id,submissionId:crypto.randomUUID(),startsAt:data.visit.startsAt,...(item.kind==='check'?{checklistVersion:item.version}:{}),item:item.key,done:doneValue,note:trimmed||null,values};
  lock.current=true;setPending(true);
  try{
   const result=await send(command);
   if(result.status==='saved'){retry.current=null;onSaved({done:doneValue,note:command.note,values,recordedAt:new Date().toISOString(),nurseName:mark?.nurseName??''});setMessage(visitCopy(l).saved);}
   else if(result.status==='outcome-unknown'||result.status==='unavailable'){retry.current=command;setMessage(notConfirmed(l));}
   else{retry.current=null;setMessage(result.status==='completed'?visitCopy(l).alreadyCompleted:result.status==='too-early'?visitCopy(l).markOnDay:result.status==='disabled'?visitCopy(l).disabled:result.status==='invalid'?visitCopy(l).invalidMark:visitCopy(l).changed);}
  }catch{retry.current=command;setMessage(notConfirmed(l));}
  finally{lock.current=false;setPending(false);}
 }
 const shown=mark?valueText(item,mark,l):null;
 return <li className="space-y-3 rounded-lg border bg-background p-3 sm:p-4" aria-labelledby={`${id}-title`}>
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div className="min-w-0 flex-1 basis-48"><p id={`${id}-title`} className="break-words text-body1 font-medium">{itemTitle(item,l)}</p><p className="break-words text-caption text-muted-foreground">{itemDetail(item,l)}</p></div>
   <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-caption">{mark?.done?<Check className="size-4" aria-hidden/>:mark?<X className="size-4" aria-hidden/>:<Circle className="size-4" aria-hidden/>}{stateLabel(mark,l)}</span>
  </div>
  {mark?.done&&shown&&<p className="text-body2">{shown}</p>}
  {mark?.note&&readOnly&&<p className="whitespace-pre-wrap break-words text-body2 text-muted-foreground">{mark.note}</p>}
  {!readOnly&&<details open={!compact||!measure} className="space-y-3"><summary className="min-h-11 cursor-pointer content-center text-body2 underline">{visitCopy(l).editItem}</summary>
   {measure==='bp'&&<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
    <label className="space-y-1 text-caption">{visitCopy(l).systolic}<input inputMode="numeric" className={fieldClass} value={sys} onChange={e=>setSys(e.target.value)} disabled={locked} aria-describedby={`${id}-msg`}/></label>
    <label className="space-y-1 text-caption">{visitCopy(l).diastolic}<input inputMode="numeric" className={fieldClass} value={dia} onChange={e=>setDia(e.target.value)} disabled={locked} aria-describedby={`${id}-msg`}/></label>
    <label className="space-y-1 text-caption">{visitCopy(l).optionalPulse}<input inputMode="numeric" className={fieldClass} value={pulse} onChange={e=>setPulse(e.target.value)} disabled={locked}/></label>
   </div>}
   {measure==='bp'&&<BpHighWarning systolic={sys} diastolic={dia} locale={l}/>}
   {(measure==='weight'||measure==='waist')&&<label className="block max-w-40 space-y-1 text-caption">{measure==='weight'?visitCopy(l).weightInput:visitCopy(l).waistInput}<input inputMode="decimal" className={fieldClass} value={single} onChange={e=>setSingle(e.target.value)} disabled={locked} aria-describedby={`${id}-msg`}/></label>}
   {noteOpen?<label className="block space-y-1 text-caption">{visitCopy(l).commentLabel}{measure&&<span className="block">{visitCopy(l).commentHelp}</span>}<textarea className={`${fieldClass} min-h-20`} maxLength={nurseCommentMax} value={note} onChange={e=>setNote(e.target.value)} disabled={locked}/><span className="block text-right">{note.length}/{nurseCommentMax}</span></label>
    :<button type="button" className="min-h-11 text-body2 underline disabled:opacity-50" disabled={early} onClick={()=>setNoteOpen(true)}>{visitCopy(l).addComment}</button>}
   <div className="flex flex-wrap gap-2">
    <button type="button" className={buttonClass} disabled={locked} onClick={()=>save(true)}><Check className="mr-1 size-4" aria-hidden/>{measure?visitCopy(l).saveReading:item.kind==='device'?visitCopy(l).deviceDone:visitCopy(l).done}</button>
    <button type="button" className={secondary} disabled={locked} onClick={()=>save(false)}>{measure?visitCopy(l).measurementNotTaken:visitCopy(l).notDone}</button>
   </div>
  </details>}
  <p id={`${id}-msg`} role="status" aria-live="polite" className="text-caption">{pending?visitCopy(l).saving:message||(early&&!readOnly?visitCopy(l).onDay:"")}</p>
 </li>;
}

function CompletePanel({data,locale:l,ids,open,early,complete,onDone,inline}:{inline:boolean;data:NurseVisitReady;locale:Locale;ids:Ids;open:NurseVisitItem[];early:boolean;complete:Props['complete'];onDone:()=>void}){
 const [confirming,setConfirming]=useState(false),[reason,setReason]=useState(''),[pending,setPending]=useState(false),[message,setMessage]=useState('');
 // Server-supplied ids are kept for this screen's life, so a retry after a lost answer replays.
 const [frozen]=useState(ids);
 const panel=useRef<HTMLDivElement|null>(null),lock=useRef(false);
 useEffect(()=>{if(confirming)panel.current?.focus();},[confirming]);
 async function submit(){
  if(lock.current)return;
  const text=reason.trim();
  if(open.length&&text.length<3){setMessage(visitCopy(l).reasonError);return;}
  lock.current=true;setPending(true);setMessage('');
  try{
   const result=await complete({version:nurseVisitVersion,memberId:data.visit.memberId,source:data.visit.source,sourceId:data.visit.id,...frozen,reason:text||null});
   if(result.status==='saved'){setMessage(visitCopy(l).completed);onDone();}
   else if(result.status==='reason-required')setMessage(visitCopy(l).reasonRequired);
   else if(result.status==='too-early')setMessage(visitCopy(l).completeOnDay);
   else if(result.status==='booking-stale')setMessage(visitCopy(l).bookingStale);
   else if(result.status==='completed'){setMessage(visitCopy(l).alreadyCompleted);onDone();}
   else if(result.status==='outcome-unknown'||result.status==='unavailable')setMessage(visitCopy(l).notConfirmedComplete);
   else setMessage(visitCopy(l).completeFailed);
  }catch{setMessage(visitCopy(l).notConfirmedComplete);}
  finally{lock.current=false;setPending(false);}
 }
 return <>
  {confirming&&<div ref={panel} tabIndex={-1} role="region" aria-labelledby="nv-confirm-title" className="space-y-3 rounded-xl border-2 border-primary bg-card p-4 outline-none sm:p-5">
   <h2 id="nv-confirm-title" className="text-h3">{visitCopy(l).completeQuestion}</h2>
   <p className="text-body2">{visitCopy(l).completeExplanation}</p>
   {open.length>0?<>
    <p className="text-body2 font-medium">{visitCopy(l).incompleteCount(open.length)}</p>
    <ul className="list-disc pl-5 text-body2">{open.map(item=><li key={item.key} className="break-words">{itemTitle(item,l)}</li>)}</ul>
    <label className="block space-y-1 text-body2">{visitCopy(l).reasonLabel}<textarea className={`${fieldClass} min-h-24`} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} disabled={pending}/></label>
   </>:<p className="text-body2">{visitCopy(l).allDone}</p>}
   <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={pending} onClick={submit}>{pending?visitCopy(l).completing:visitCopy(l).completeVisit}</button><button type="button" className={secondary} disabled={pending} onClick={()=>{setConfirming(false);setMessage('');}}>{visitCopy(l).goBack}</button></div>
   <p role="status" aria-live="polite" className="text-body2">{message}</p>
  </div>}
  {!confirming&&<div className={inline?"rounded-xl border bg-card p-4 sm:p-5":"fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-4 backdrop-blur lg:static lg:rounded-xl lg:border lg:p-5"}>
   <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
    <p className="text-body2">{early?visitCopy(l).earlyCompletion:open.length?visitCopy(l).counts(open.length):visitCopy(l).allItemsDone}</p>
    <button type="button" className={`${buttonClass} w-full sm:w-auto`} disabled={early} onClick={()=>setConfirming(true)}><CircleCheckBig className="mr-2 size-5" aria-hidden/>{visitCopy(l).completeVisit}</button>
   </div>
  </div>}
 </>;
}
