'use client';
import {useRef,useState} from 'react';
import {coordinationCommand,refreshCoordinationTask} from '@/lib/staff/real-coordination/actions';
import type {CoordinationCommand,CoordinationTask} from '@/lib/staff/real-coordination/schema';
import {canTaskOperation,taskNeedsNote,taskNoteLabel,taskOperationLabel,type NurseTaskOperation,type ContactOutcome} from '@/lib/staff/real-coordination/task-copy';
import type {StaffLocale} from '@/lib/staff/staff-locale-copy';
export {availableTaskOperations,canTaskOperation,type NurseTaskOperation} from '@/lib/staff/real-coordination/task-copy';

export const canCompleteTask=(task:CoordinationTask)=>canTaskOperation(task,'complete');
export type NurseTaskEntry={id:string;task:CoordinationTask;operation:NurseTaskOperation;outcome?:ContactOutcome;note?:string;state?:'saving'|'uncertain';error?:string;changed?:boolean;needsRefresh?:boolean};

/** Page-state dialog only. The command ref survives an uncertain result unchanged. */
export function useNurseTask(restoreDraft:(body:string)=>void){
 const [entries,setEntries]=useState<NurseTaskEntry[]>([]),[activeId,setActiveId]=useState<string|null>(null);
 const [sending,setSending]=useState(false),[uncertain,setUncertain]=useState(false);
 const [updates,setUpdates]=useState<Record<string,CoordinationTask>>({});
 const active=useRef<NurseTaskEntry|null>(null),busy=useRef(false),pending=useRef<CoordinationCommand|null>(null);
 const original=useRef('');
 function change(id:string,patch:Partial<NurseTaskEntry>){if(active.current?.id===id)active.current={...active.current,...patch};setEntries(previous=>previous.map(entry=>entry.id===id?{...entry,...patch}:entry));}
 function receive(task:CoordinationTask){setUpdates(previous=>({...previous,[task.id]:task}));}
 function end(){active.current=null;pending.current=null;setActiveId(null);setUncertain(false);}
 function start(task:CoordinationTask,id:string,operation:NurseTaskOperation='complete'){
  if(active.current||busy.current||!canTaskOperation(task,operation))return false;
  const entry:NurseTaskEntry={id,task,operation,...(operation==='contact'?{outcome:'contact-attempted' as const}:{})};active.current=entry;setActiveId(id);setEntries(previous=>[...previous,entry]);restoreDraft('');return true;
 }
 function setOutcome(outcome:ContactOutcome){const entry=active.current;if(!entry||entry.operation!=='contact'||busy.current||pending.current||entry.needsRefresh)return;change(entry.id,{outcome});}
 function cancel(){
  if(busy.current||pending.current)return;
  const entry=active.current;if(!entry)return;
  setEntries(previous=>previous.filter(row=>row.id!==entry.id));end();restoreDraft('');
 }
 async function saved(entry:NurseTaskEntry,alreadyRead=false){
  // A failed follow-up read cannot turn a known save back into an unknown command.
  if(!alreadyRead){try{const fresh=await refreshCoordinationTask(entry.task.id);if(fresh.ok)receive(fresh.task);}catch{}}
  change(entry.id,{state:undefined,error:undefined,needsRefresh:false});end();
 }
 async function reread(entry:NurseTaskEntry){
  try{
   const fresh=await refreshCoordinationTask(entry.task.id);
   if(!fresh.ok)return;
   receive(fresh.task);
   if(!canTaskOperation(fresh.task,entry.operation)){restoreDraft('');change(entry.id,{note:undefined,needsRefresh:false});end();return;}
   const changed=fresh.task.title!==entry.task.title||fresh.task.instructions!==entry.task.instructions;
   change(entry.id,{task:fresh.task,changed,needsRefresh:false});
   // A refusal may preserve words only against the same task instructions.
   restoreDraft(changed?'':original.current);
  }catch{}
 }
 async function run(entry:NurseTaskEntry,command:CoordinationCommand){
  let result;
  try{result=await coordinationCommand(command);}
  catch{setUncertain(true);change(entry.id,{state:'uncertain'});return;}
  if(result.ok){await saved(entry);return;}
  if(result.uncertain){setUncertain(true);change(entry.id,{state:'uncertain'});return;}
  // A real refusal releases the command identity; a failed read keeps its target.
  pending.current=null;setUncertain(false);change(entry.id,{note:undefined,state:undefined,error:result.error,needsRefresh:true});restoreDraft(original.current);
  await reread(active.current!);
 }
 async function send(words=''){
  const entry=active.current;if(!entry||busy.current||pending.current||entry.needsRefresh||(taskNeedsNote(entry.operation)&&!words.trim()))return;
  busy.current=true;setSending(true);original.current=words;
  const base={caseId:entry.task.caseId,taskId:entry.task.id,revision:entry.task.revision,requestId:crypto.randomUUID()};
  const command:CoordinationCommand=entry.operation==='contact'?{...base,operation:'contact',input:{note:words,outcome:entry.outcome??'contact-attempted'}}:entry.operation==='await-member'||entry.operation==='reopen'?{...base,operation:entry.operation,input:{}}:{...base,operation:entry.operation,input:{note:words}};
  pending.current=command;restoreDraft('');change(entry.id,{note:taskNeedsNote(entry.operation)?words:undefined,state:'saving',error:undefined});
  try{await run(entry,command);}finally{busy.current=false;setSending(false);}
 }
 async function check(){
  const entry=active.current,command=pending.current;if(!entry||busy.current)return;
  busy.current=true;setSending(true);
  try{
   if(!command){if(entry.needsRefresh)await reread(entry);return;}
   const fresh=await refreshCoordinationTask(command.taskId);
   if(!fresh.ok)return;
   if(fresh.task.events.some(event=>event.request_id===command.requestId)){receive(fresh.task);await saved(entry,true);return;}
   change(entry.id,{state:'saving'});await run(entry,command);
  }catch{if(command)change(entry.id,{state:'uncertain'});}
  finally{busy.current=false;setSending(false);}
 }
 const current=entries.find(entry=>entry.id===activeId);
 return {entries,activeId,active:activeId!==null,task:current?.task,operation:current?.operation,outcome:current?.outcome,needsNote:current?taskNeedsNote(current.operation):false,needsRefresh:!!current?.needsRefresh,composerLabel:(l:StaffLocale)=>current&&!taskNeedsNote(current.operation)?taskOperationLabel(l,current.operation):taskNoteLabel(l,current?.operation??'complete'),updates,hidden:entries.map(entry=>entry.task.id),sending,frozen:sending||uncertain,start,cancel,send,check,setOutcome};
}
