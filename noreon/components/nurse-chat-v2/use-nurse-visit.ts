'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {readNurseChatVisit} from '@/lib/nurse-chat/v2-actions';
import {recordNurseVisitCollect,recordNurseVisitMark,recordNurseVisitStep,recordNurseVisitComplete} from '@/lib/nurse-visit/actions';
import {nurseVisitVersion,type NurseVisitCollectCommand,type NurseVisitReady,type NurseVisitRow,type NurseVisitMarkCommand,type NurseVisitStepCommand,type NurseVisitCompleteCommand} from '@/lib/nurse-visit/schema';
import {nextQuestion,questionKey,type ChatVisitQuestion as VisitQuestion} from '@/lib/nurse-visit/chat-order';
import {parseVisitMeasurement,parseVisitShortcut,type VisitShortcutDraft} from '@/lib/nurse-visit/chat-parser';
import {shortcutActions,shortcutCommand,type ShortcutAction} from '@/lib/nurse-visit/shortcut';
import {collectionCopy,collectionStatus} from '@/lib/nurse-visit/collection';
import {visitBlockCopy,visitCopy} from '@/lib/nurse-visit/copy';
import type {StaffLocale} from '@/lib/staff/staff-locale-copy';

export type VisitChoice=Pick<NurseVisitRow,'id'|'source'|'memberId'|'memberName'|'startsAt'>;
type Flow={key:string;selection:VisitChoice;data:NurseVisitReady|null;loaded:boolean;skipped:string[];editing:VisitQuestion|null;view:'question'|'change'|'complete';comment:string;commentBaseline:string;commenting:boolean;error:string;preview:VisitShortcutDraft|null;briefingLast:boolean;allDonePartial?:{recorded:number;total:number}};
type Pending={kind:'collect';command:NurseVisitCollectCommand}|{kind:'mark';command:NurseVisitMarkCommand}|{kind:'step';command:NurseVisitStepCommand}|{kind:'complete';command:NurseVisitCompleteCommand};
export {questionKey} from '@/lib/nurse-visit/chat-order';
function flowQuestion(flow:Flow|null){
 if(!flow?.data)return null;
 const data=flow.data,early=new Date(Date.parse(data.visit.startsAt)+4*3600_000).toISOString().slice(0,10)>data.today;
 if(early)return nextQuestion(data,[],true);
 // An explicit selection is an identity, not a snapshot of another nurse's old answer.
 if(flow.editing?.kind==='item'){
  const key=flow.editing.item.key,item=data.items.find(item=>item.key===key);
  return item?{kind:'item' as const,item}:nextQuestion(data,flow.skipped,true);
 }
 return flow.editing??nextQuestion(data,flow.skipped,true);
}
const asked=(flow:Flow|null)=>{const q=flowQuestion(flow);return q?questionKey(q):null;};
const questionNote=(q:VisitQuestion|null)=>q?.kind==='item'?q.item.mark?.note??'':'';

/** One composer owner, one in-flight command, and server records as the only saved history. */
export function useNurseVisit(restoreDraft:(text:string)=>void,locale:StaffLocale){
 const [flow,setFlow]=useState<Flow|null>(null),[open,setOpen]=useState(false),[sending,setSending]=useState(false),[uncertain,setUncertain]=useState(false);
 const [updates,setUpdates]=useState<Record<string,NurseVisitReady>>({});
 const current=useRef<Flow|null>(null),opened=useRef(false),busy=useRef(false),pending=useRef<Pending|null>(null),generation=useRef(0),reading=useRef(false);
 const ids=useRef<Record<string,Pick<NurseVisitCompleteCommand,'submissionId'|'visitId'|'openSubmissionId'|'appendSubmissionId'>>>({});
 const readingDraft=useRef('');
 const batch=useRef<{actions:ShortcutAction[];token:string;startsAt:string;revision:number;request:Pending|null}|null>(null);
 const batching=useRef(false);
 const allDoneBatch=useRef<{requests:Extract<Pending,{kind:'mark'}>[];total:number;recorded:number;token:string;startsAt:string}|null>(null);
 const [markingAll,setMarkingAll]=useState(false);
 const patch=useCallback((change:Partial<Flow>)=>{if(!current.current)return;current.current={...current.current,...change};setFlow(current.current);},[]);
 const refresh=useCallback(async(saved=false)=>{
  const before=current.current;if(!before||!opened.current)return null;
  const ticket=++generation.current;
  try{
   const data=await readNurseChatVisit(before.selection.memberId,before.selection.source,before.selection.id);
   if(ticket!==generation.current||!opened.current||current.current?.key!==before.key)return null;
   // A failed read changes nothing. Only a refusal removes the visit, and its words go with it.
   if(data==='unavailable'){patch({loaded:true});return null;}
   if(!data){patch({data:null,preview:null,loaded:true,comment:'',commentBaseline:'',commenting:false});readingDraft.current='';restoreDraft('');return null;}
   // Words in the composer belong to the question on screen. If that question changes, they are not carried to the next one.
   const previous=current.current!,next=flowQuestion({...previous,data});
   const shown=asked(previous),moved=!saved&&shown!==null&&shown!==(next?questionKey(next):null);
   // While the comment composer is open, its unsent text still belongs to the old baseline.
   const edited=previous.commenting||(previous.comment??'').trim()!==(previous.commentBaseline??'').trim(),note=questionNote(next);
   patch({loaded:true,data,...(data.completion||data.visit.bookingStatus==='cancelled'?{editing:null,view:'question' as const}: {}),...(!edited||moved?{comment:note,commentBaseline:note}:{}),...(moved?{commenting:false,error:visitCopy(locale).changedElsewhere}:{})});
   if(moved){readingDraft.current='';restoreDraft('');}
   setUpdates(previous=>({...previous,[`${data.visit.source}:${data.visit.id}`]:data}));
   return data;
  }catch{if(ticket===generation.current&&opened.current&&current.current?.key===before.key)patch({loaded:true});return null;}
 },[patch,restoreDraft,locale]);
 useEffect(()=>{
  if(!open)return;
  const poll=()=>{if(document.hidden||busy.current||pending.current||batching.current||current.current?.preview||reading.current)return;reading.current=true;void refresh().finally(()=>{reading.current=false;});};
  const timer=window.setInterval(poll,30_000);window.addEventListener('focus',poll);window.addEventListener('pageshow',poll);document.addEventListener('visibilitychange',poll);
  return()=>{window.clearInterval(timer);window.removeEventListener('focus',poll);window.removeEventListener('pageshow',poll);document.removeEventListener('visibilitychange',poll);};
 },[open,refresh]);
 function start(selection:VisitChoice,key:string){
  if(opened.current||busy.current||pending.current)return false;
  const identity=`${selection.source}:${selection.id}`;
  ids.current[identity]??={submissionId:crypto.randomUUID(),visitId:crypto.randomUUID(),openSubmissionId:crypto.randomUUID(),appendSubmissionId:crypto.randomUUID()};
  const next:Flow={key,selection,data:null,loaded:false,skipped:[],editing:null,view:'question',comment:'',commentBaseline:'',commenting:false,error:'',preview:null,briefingLast:false};
  current.current=next;opened.current=true;setFlow(next);setOpen(true);restoreDraft('');void refresh();return true;
 }
 function close(){if(busy.current||pending.current||batching.current)return;batch.current=null;allDoneBatch.current=null;opened.current=false;generation.current++;setOpen(false);restoreDraft('');}
 function question(){return flowQuestion(current.current);}
 function discardAllDone(){allDoneBatch.current=null;patch({allDonePartial:undefined});}
 function skip(){const q=question();if(!q||busy.current||pending.current||batching.current)return;discardAllDone();patch({skipped:[...current.current!.skipped,questionKey(q)],editing:null,comment:'',commentBaseline:'',commenting:false,error:''});restoreDraft('');}
 function choose(q:VisitQuestion){if(busy.current||pending.current||batching.current)return;discardAllDone();const note=questionNote(q);patch({preview:null,editing:q,view:'question',comment:note,commentBaseline:note,commenting:false,error:''});restoreDraft('');}
 function view(value:Flow['view']){if(busy.current||pending.current||batching.current)return;discardAllDone();patch({preview:null,view:value,editing:null,error:'',comment:'',commentBaseline:'',commenting:false});restoreDraft('');}
 function cancelComment(clear=false){
  const f=current.current;if(!f||busy.current||pending.current||batching.current)return;
  const note=questionNote(question()),untouched=f.comment.trim()===f.commentBaseline.trim();
  patch({commenting:false,...(clear?{comment:''}:untouched?{comment:note,commentBaseline:note}:{})});restoreDraft(readingDraft.current);
 }
 function addComment(words:string){if(busy.current||pending.current||batching.current)return;discardAllDone();readingDraft.current=words;patch({commenting:true,error:''});restoreDraft(current.current?.comment??'');}
 async function run(request:Pending){
  if(busy.current)return;if(!batching.current)discardAllDone();generation.current++;busy.current=true;setSending(true);patch({error:''});
  try{
   const result=request.kind==='collect'?await recordNurseVisitCollect(request.command):request.kind==='mark'?await recordNurseVisitMark(request.command):request.kind==='step'?await recordNurseVisitStep(request.command):await recordNurseVisitComplete(request.command);
   const copy=visitCopy(locale);
   if(result.status==='outcome-unknown'||result.status==='unavailable'){
    pending.current=request;setUncertain(true);if(request.kind!=='collect')patch({error:request.kind==='complete'?copy.notConfirmedComplete:copy.notConfirmed});return {status:'outcome-unknown'};
   }
   if(result.status==='saved'||result.status==='already-recorded'||result.status==='completed'||result.status==='cancelled'){
    const fresh=await refresh(true);
    if(!fresh){pending.current=request;setUncertain(true);if(request.kind!=='collect')patch({error:request.kind==='complete'?copy.notConfirmedComplete:copy.notConfirmed});return {status:'outcome-unknown'};}
    pending.current=null;setUncertain(false);
    if(request.kind==='collect'){patch({error:''});return result;}
    patch({...(request.kind==='complete'?{skipped:[]}:{}),editing:null,view:'question',comment:'',commentBaseline:'',commenting:false,error:result.status==='completed'?copy.alreadyCompleted:''});restoreDraft('');return result;
   }
   pending.current=null;setUncertain(false);
   if(request.kind==='collect')return result;
   const refusal=request.kind==='complete'?copy.completeError(result.status):request.kind==='step'?copy.stepError(result.status):copy.markError(result.status);
   if(result.status==='access'||result.status==='disabled'){patch({data:null,preview:null,loaded:true,comment:'',commentBaseline:'',commenting:false,error:refusal});readingDraft.current='';restoreDraft('');return;}
   const shown=asked(current.current);await refresh();
   // A refusal retains the exact words while the question stays, and lets the nurse inspect the refreshed visit.
   patch({error:shown===asked(current.current)?refusal:copy.changedElsewhere});return result;
  }catch{pending.current=request;setUncertain(true);if(request.kind!=='collect')patch({error:request.kind==='complete'?visitCopy(locale).notConfirmedComplete:visitCopy(locale).notConfirmed});return {status:'outcome-unknown'};}
  finally{busy.current=false;setSending(false);}
 }
 async function answer(done:boolean,words=''){
  const f=current.current,q=question();if(!f?.data||!q||busy.current||pending.current||batching.current||f.commenting)return;
  const base={version:nurseVisitVersion,memberId:f.data.visit.memberId,source:f.data.visit.source,sourceId:f.data.visit.id};
  if(q.kind==='step'){await run({kind:'step',command:{...base,submissionId:crypto.randomUUID(),step:q.step}});return;}
  if(q.kind!=='item'||q.item.kind==='sample')return;
  const parsed=done?parseVisitMeasurement(q.item,words,locale):{values:null,error:null};
  if(parsed.error){patch({error:parsed.error});return;}
  // Retain a local note across refresh, but ask before replacing the changed saved note.
  if(done&&q.item.kind==='measurement'&&f.comment.trim()!==f.commentBaseline.trim()&&f.commentBaseline!==questionNote(q)){
   patch({preview:{arrived:null,measurements:{[q.item.key]:words},notes:{[q.item.key]:f.comment},replace:q.item.mark?[q.item.key]:[],marks:[],samples:[],untouched:[]},error:visitBlockCopy(locale).noteConflict});return;
  }
  const command:NurseVisitMarkCommand={...base,submissionId:crypto.randomUUID(),startsAt:f.data.visit.startsAt,...(q.item.kind==='check'?{checklistVersion:q.item.version}:{}),item:q.item.key,done,note:f.comment.trim()||null,values:parsed.values};
  await run({kind:'mark',command});
 }
 // This is only a queue of ordinary per-item marks. The database precondition owns concurrency.
 async function continueAllDone(){
  const b=allDoneBatch.current;if(!b||busy.current||batching.current)return;
  batching.current=true;setMarkingAll(true);patch({allDonePartial:undefined});
  try{
   while(b.requests.length){
    const data=current.current?.data;
    if(!data||data.visit.arrangementToken!==b.token||data.visit.startsAt!==b.startsAt||data.completion||data.visit.bookingStatus==='cancelled'){
     allDoneBatch.current=null;patch({error:visitCopy(locale).changedElsewhere});return;
    }
    const request=b.requests[0],item=data.items.find(i=>i.key===request.command.item);
    // A known refusal may have refreshed another nurse's answer. Never replace it on retry.
    // An unknown outcome must first replay the SAME submission, even if its mark is now visible.
    if(!pending.current&&item?.mark){b.requests.shift();continue;}
    const result=await run(request);
    if(pending.current||result?.status!=='saved'){
     if(!current.current?.data){allDoneBatch.current=null;return;}
     patch({allDonePartial:{recorded:b.recorded,total:b.total},error:visitBlockCopy(locale).allDonePartial(b.recorded,b.total)});return;
    }
    b.requests.shift();b.recorded++;
   }
   allDoneBatch.current=null;patch({allDonePartial:undefined,error:''});
  }finally{batching.current=false;setMarkingAll(false);}
 }
 async function allDone(section:'bp'|'safety'|'sampling'){
  const f=current.current;
  if(!f?.data||busy.current||pending.current||batching.current||f.commenting||f.comment.trim()!==f.commentBaseline.trim())return;
  const data=f.data;
  if(data.completion||data.visit.bookingStatus==='cancelled')return;
  const requests:Extract<Pending,{kind:'mark'}>[]=data.items.flatMap(item=>item.kind==='check'&&item.section===section&&!item.mark?[{kind:'mark' as const,command:{
   version:nurseVisitVersion,memberId:data.visit.memberId,source:data.visit.source,sourceId:data.visit.id,submissionId:crypto.randomUUID(),
   startsAt:data.visit.startsAt,checklistVersion:item.version,item:item.key,done:true,note:null,values:null,expectUnanswered:true,
  }}]:[]);
  if(!requests.length)return;
  allDoneBatch.current={requests,total:requests.length,recorded:0,token:data.visit.arrangementToken,startsAt:data.visit.startsAt};
  await continueAllDone();
 }
 async function collect(command:NurseVisitCollectCommand){
  if(busy.current||batching.current||pending.current&&(pending.current.kind!=='collect'||pending.current.command.submissionId!==command.submissionId))return {status:'unavailable'};
  return await run({kind:'collect',command})??{status:'outcome-unknown'};
 }
 async function complete(words=''){
  const f=current.current;if(!f?.data||busy.current||pending.current||batching.current)return;
  if(f.data.items.some(item=>item.kind==='sample'&&collectionStatus(item)==='pending')){patch({error:collectionCopy(locale).pending});return;}
  if(f.data.items.some(item=>!item.mark?.done)&&words.trim().length<3){patch({error:visitCopy(locale).reasonError});return;}
  await run({kind:'complete',command:{version:nurseVisitVersion,memberId:f.data.visit.memberId,source:f.data.visit.source,sourceId:f.data.visit.id,...ids.current[`${f.selection.source}:${f.selection.id}`],reason:words.trim()||null}});
 }
 async function send(words:string){
  if(busy.current||pending.current||batching.current)return;
  discardAllDone();const f=current.current;if(!f)return;
  if(f.commenting){
   const note=questionNote(question()),untouched=words.trim()===f.commentBaseline.trim();
   patch({comment:untouched?note:words,...(untouched?{commentBaseline:note}:{}),commenting:false,error:''});restoreDraft(readingDraft.current);return;
  }
  if(f.view==='complete'){await complete(words);return;}
  if(!f.data)return;
  if(/^(?:what(?:'s| is) next[?]?|что дальше[?]?|ինչն է հաջորդը[՞։]?|հաջորդը ինչ[՞։]?)$/iu.test(words.trim())){patch({preview:null,briefingLast:true,error:''});restoreDraft('');return;}
  // Reuse the current question's BP/scalar parser, then ask before any typed reading is written.
  const q=question();
  if(q?.kind==='item'&&q.item.kind==='measurement'&&/^\s*[\d.,/\s]+\s*$/u.test(words)){
   const parsed=parseVisitMeasurement(q.item,words,locale);if(parsed.error){patch({error:parsed.error});return;}
   const values=parsed.values!,canonical='systolic'in values?`${values.systolic}/${values.diastolic}${values.pulse===null?'':` ${values.pulse}`}`:String(values.value);
   patch({preview:{arrived:null,measurements:{[q.item.key]:canonical},notes:{[q.item.key]:f.comment},replace:q.item.mark&&f.editing?.kind==='item'&&f.editing.item.key===q.item.key?[q.item.key]:[],marks:[],samples:[],untouched:[]},error:''});restoreDraft('');return;
  }
  patch({preview:parseVisitShortcut(f.data.items,words,locale),error:''});restoreDraft('');
 }
 function editPreview(draft:VisitShortcutDraft){if(!busy.current&&!pending.current&&!batching.current){discardAllDone();batch.current=null;patch({preview:draft,error:''});}}
 function discardPreview(){if(!busy.current&&!pending.current&&!batching.current){discardAllDone();batch.current=null;patch({preview:null,error:''});}}
 async function continueShortcut(){
  if(batching.current)return;batching.current=true;setSending(true);
  try{
   while(batch.current?.actions.length){
    const b=batch.current,data=current.current?.data;
    if(!data||data.visit.arrangementToken!==b.token||data.visit.startsAt!==b.startsAt||data.completion||data.visit.bookingStatus==='cancelled'||!b.request&&data.caseRevision!==b.revision){batch.current=null;patch({error:visitBlockCopy(locale).interrupted});return;}
    const request=b.request??shortcutCommand(data,b.actions[0],locale,crypto.randomUUID());
    if(!request){batch.current=null;patch({error:visitBlockCopy(locale).interrupted});return;}
    b.request=request;
    const result=await run(request);
    if(pending.current){patch({error:visitCopy(locale).notConfirmed});return;}
    if(!result||!['saved','already-recorded'].includes(result.status)){batch.current=null;patch({error:visitBlockCopy(locale).interrupted});return;}
    const applied=b.actions.shift()!,draft=current.current?.preview;
    if(draft){
     const measurements={...draft.measurements};if(applied.kind==='measurement')delete measurements[applied.item];
     patch({preview:{...draft,...(applied.kind==='arrival'?{arrived:null}:{}),measurements,marks:draft.marks.filter(m=>applied.kind!=='mark'||m.item!==applied.item),samples:draft.samples.filter(s=>applied.kind!=='sample'||s.testId!==applied.testId)}});
    }
    b.request=null;b.revision=current.current!.data!.caseRevision;
   }
   batch.current=null;
   const draft=current.current?.preview;
   patch({preview:draft&&(draft.untouched.length||draft.collectionIssue||draft.samples.length||draft.marks.length)?draft:null});
  }finally{batching.current=false;setSending(false);}
 }
 async function confirmPreview(){
  const f=current.current;if(!f?.data||!f.preview||busy.current||pending.current||batching.current)return;
  const actions=shortcutActions(f.data,f.preview,locale);if(!actions)return;
  // Re-read before any write. A changed preview needs a second, informed confirmation.
  busy.current=true;setSending(true);
  let fresh:NurseVisitReady|null=null;
  try{fresh=await refresh();}finally{busy.current=false;setSending(false);}
  if(!fresh||fresh.caseRevision!==f.data.caseRevision||fresh.visit.arrangementToken!==f.data.visit.arrangementToken||fresh.visit.startsAt!==f.data.visit.startsAt){patch({error:visitCopy(locale).changedElsewhere});return;}
  batch.current={actions,token:f.data.visit.arrangementToken,startsAt:f.data.visit.startsAt,revision:f.data.caseRevision,request:null};
  await continueShortcut();
 }
 return {flow,updates,open,sending:sending||markingAll,uncertain,frozen:sending||markingAll||uncertain,start,close,refresh,skip,choose,view,addComment,cancelComment,answer,allDone,collect,complete,send,editPreview,discardPreview,confirmPreview,retry:async()=>{if(allDoneBatch.current)await continueAllDone();else if(batch.current)await continueShortcut();else if(pending.current)await run(pending.current);},question:flowQuestion(flow)};
}
