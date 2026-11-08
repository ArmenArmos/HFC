'use client';
import {useCallback,useRef,useState} from 'react';
import {escalateNurseMessage} from '@/lib/nurse-chat/handoff-actions';
import {handoffResultSchema,type HandoffPage,type NurseHandoff} from '@/lib/nurse-chat/handoffs';
import type {NurseWorkspace} from '@/lib/nurse-chat/contracts';

type Workspace=Extract<NurseWorkspace,{ok:true}>;
type Turn={id:string;at:string;kind:'start'|'topic'|'observation';text:string;state?:'saving'|'uncertain'|'failed'};
type Flow={messageId:string;topic?:NurseHandoff['topic'];turns:Turn[];promptAt:string;notice:''|'unknown'|'stale'|'refused'};
type Fallback={taskId:string;topic:NurseHandoff['topic'];observation:string;at:string};
const now=()=>new Date().toISOString();
const turn=(kind:Turn['kind'],text:string):Turn=>({id:crypto.randomUUID(),kind,text,at:now()});

/** Only unsaved dialog and unread save receipts live here. Saved turns come from the task read. */
export function useNurseHandoff(restoreDraft:(body:string)=>void){
 const [page,setPage]=useState<HandoffPage|null>(null),[selected,setSelected]=useState<string|null>(null);
 const [flow,setFlow]=useState<Flow|null>(null),[failed,setFailed]=useState<Flow[]>([]),[fallbacks,setFallbacks]=useState<Fallback[]>([]);
 const [remembered,setRemembered]=useState<string[]>([]),[sending,setSending]=useState(false);
 const known=useRef(new Map<string,string[]>()),member=useRef<string|null>(null);
 const remember=useCallback((ids:string[])=>{
  const key=member.current;if(!key)return;
  const values=[...new Set([...(known.current.get(key)??[]),...ids])];
  known.current.set(key,values);setRemembered(values);
 },[]);
 // Held survives an unknown result; locked only prevents overlapping requests.
 const held=useRef(false),locked=useRef(false),pending=useRef<NurseHandoff|null>(null),original=useRef('');
 const receive=useCallback((next:HandoffPage|null)=>{
  setPage(next);
  if(next){
   remember(next.items.map(item=>item.messageId));
   setFallbacks(previous=>previous.filter(saved=>!next.items.some(item=>item.task.id===saved.taskId)));
  }
 },[remember]);
 const reset=useCallback((memberId?:string)=>{
  member.current=memberId??null;held.current=false;pending.current=null;setPage(null);setSelected(null);setFlow(null);setFailed([]);setFallbacks([]);setRemembered(memberId?known.current.get(memberId)??[]:[]);setSending(false);
 },[]);
 function select(id:string|null){if(!flow&&!held.current)setSelected(previous=>previous===id?null:id);}
 function start(messageId:string,text:string){
  if(flow||held.current||remembered.includes(messageId))return;
  const first=turn('start',text);setSelected(null);restoreDraft('');
  setFlow({messageId,turns:[first],promptAt:first.at,notice:''});
 }
 function topic(value:NurseHandoff['topic'],label:string){
  if(!flow||flow.topic||held.current)return;
  const said=turn('topic',label);setFlow({...flow,topic:value,turns:[...flow.turns,said],promptAt:said.at});
 }
 function cancel(){if(held.current)return;setSelected(null);setFlow(null);restoreDraft('');}
 async function send(data:Workspace,words:string,refresh:()=>Promise<HandoffPage|null>,deny:(code:'denied'|'off')=>void,invalidate:()=>void){
  if(locked.current||!flow?.topic||(!pending.current&&!words.trim()))return;
  const request=pending.current??{memberId:data.memberId,requestId:crypto.randomUUID(),expectedVersion:data.version,messageId:flow.messageId,topic:flow.topic,observation:words.trim()};
  if(!pending.current)original.current=words;
  pending.current=request;locked.current=true;held.current=true;setSending(true);invalidate();restoreDraft('');
  const observation=flow.turns.find(item=>item.kind==='observation')??turn('observation',request.observation);
  const submitted={...flow,promptAt:observation.at,notice:'' as const,turns:[...flow.turns.filter(item=>item.kind!=='observation'),{...observation,state:'saving' as const}]};
  setFlow(submitted);
  try{
   const result=handoffResultSchema.parse(await escalateNurseMessage(request));
   pending.current=null;
   if(result.ok){
    remember([request.messageId]);
    const read=await refresh();
    if(!read?.items.some(item=>item.task.id===result.taskId))setFallbacks(previous=>[...previous,{taskId:result.taskId,topic:request.topic,observation:request.observation,at:observation.at}]);
    setFlow(null);
   }else if(result.code==='denied'||result.code==='off')deny(result.code);
   else if(result.code==='already_exists'){
    remember([request.messageId]);
    setFailed(previous=>[...previous,{...submitted,turns:submitted.turns.map(item=>item.kind==='observation'?{...item,state:'failed'}:item)}]);
    setFlow(null);await refresh();
   }else{
    restoreDraft(original.current);
    setFlow({...flow,turns:flow.turns.filter(item=>item.kind!=='observation'),notice:result.code==='stale_context'?'stale':'refused',promptAt:now()});
    await refresh();
   }
   held.current=false;
  }catch{
   setFlow({...submitted,notice:'unknown',turns:submitted.turns.map(item=>item.kind==='observation'?{...item,state:'uncertain'}:item)});
  }finally{locked.current=false;setSending(false);}
 }
 return {page,selected,flow,failed,fallbacks,remembered,sending,held,receive,reset,select,start,topic,cancel,send,active:flow!==null,frozen:sending||flow?.notice==='unknown'};
}
