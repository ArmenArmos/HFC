'use client';
import {useRef,useState} from 'react';
import {realStaffCareCommand} from '@/lib/staff/nurse-actions';
import {readNurseChatNotes} from '@/lib/nurse-chat/v2-notes-actions';
import type {MemberChoice} from './messages';
import type {CareNote} from '@/components/staff/care-tasks';

export type NotesPage={memberId:string;revision:number;notes:CareNote[]};
export type NoteKind='evidence'|'contact-attempted'|'reached'|'unreachable'|'refer-doctor';
type Command={id:string;revision:number;op:'note';kind:NoteKind;note:string};
export type NoteEntry={id:string;member:MemberChoice;page:NotesPage;kind:NoteKind;at:string;blocked?:boolean;note?:string;state?:'saving'|'uncertain';error?:boolean};

/** Revision checking in the existing care command makes an exact replay safe. */
export function useNurseNotes(restoreDraft:(words:string)=>void,onRefuse?:(memberId:string,code:'denied'|'off')=>void){
 const [entries,setEntries]=useState<NoteEntry[]>([]),[activeId,setActiveId]=useState<string|null>(null),[sending,setSending]=useState(false),[uncertain,setUncertain]=useState(false);
 const current=useRef<NoteEntry|null>(null),pending=useRef<Command|null>(null),busy=useRef(false),held=useRef(false);
 function patch(change:Partial<NoteEntry>){const entry=current.current;if(!entry)return;current.current={...entry,...change};setEntries(previous=>previous.map(row=>row.id===entry.id?{...row,...change}:row));}
 function end(){held.current=false;current.current=null;pending.current=null;setActiveId(null);setUncertain(false);restoreDraft('');}
 function start(member:MemberChoice,page:NotesPage,id:string){
  if(current.current||busy.current||pending.current||page.memberId!==member.id)return false;
  held.current=true;const entry:NoteEntry={id,member,page,kind:'evidence',at:new Date().toISOString()};current.current=entry;setActiveId(id);setEntries(previous=>[...previous,entry]);restoreDraft('');return true;
 }
 function cancel(){if(busy.current||pending.current)return;setEntries(previous=>previous.filter(row=>row.id!==current.current?.id));end();}
 function kind(value:NoteKind){if(busy.current||pending.current||current.current?.blocked||current.current?.kind===value)return;patch({kind:value});restoreDraft('');}
 async function run(command:Command,retry=false){
  busy.current=true;setSending(true);patch({state:'saving',error:false});
  try{
   const result=await realStaffCareCommand(command);
   if(result.uncertain){pending.current=command;setUncertain(true);patch({state:'uncertain'});return;}
   if(result.ok){
    // A confirmed save stays confirmed even if its follow-up read fails.
    const before=current.current;
    const fresh=await readNurseChatNotes(command.id).catch(()=>null);
    if(fresh?.kind==='denied'||fresh?.kind==='off'){end();onRefuse?.(command.id,fresh.kind);return;}
    if(fresh?.kind==='ready'&&fresh.card==='notes'&&fresh.revision===result.revision){
     const known=new Set(before?.page.notes.map(note=>note.id));
     const added=fresh.notes.filter(note=>!known.has(note.id)&&note.kind===command.kind&&note.note===command.note.trim());
     if(added.length===1)patch({at:added[0].created_at});
    }
    patch({state:undefined,error:false});end();return;
   }
   pending.current=null;setUncertain(false);
   const fresh=await readNurseChatNotes(command.id).catch(()=>({kind:'unavailable' as const}));
   if(fresh.kind==='denied'||fresh.kind==='off'){patch({note:undefined,state:undefined,error:true});end();onRefuse?.(command.id,fresh.kind);return;}
   // Do not refresh the revision silently after a refusal. The nurse reviews the current notes first.
   if(fresh.kind==='ready'&&fresh.card==='notes')patch({page:fresh});
   patch({note:undefined,state:undefined,error:true,blocked:retry});restoreDraft(command.note);
  }catch{pending.current=command;setUncertain(true);patch({state:'uncertain'});}
  finally{busy.current=false;setSending(false);}
 }
 async function send(words:string){
  const entry=current.current;if(!entry||busy.current||pending.current||entry.blocked||!words.trim())return;
  const command:Command={id:entry.member.id,revision:entry.page.revision,op:'note',kind:entry.kind,note:words};
  pending.current=command;patch({note:words,at:new Date().toISOString()});restoreDraft('');await run(command);
 }
 return {entries,held,activeId,active:activeId!==null,blocked:!!entries.find(entry=>entry.id===activeId)?.blocked,sending,frozen:sending||uncertain,start,cancel,kind,send,retry:async()=>{if(!busy.current&&pending.current)await run(pending.current,true);}};
}
