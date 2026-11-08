'use client';
import {ConversationToggle,useConversation} from '@/components/chat-v2/conversation';
import {renderedStaffReply,staffConversationReply} from '@/components/staff/voice-reply';
import {taskTitle} from '@/lib/staff/real-coordination/task-copy';
import {closingAsLabel} from '@/lib/care-alerts/contracts';
import {visitCopy} from '@/lib/nurse-visit/copy';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {questionKey,useNurseVisit,type VisitChoice} from './use-nurse-visit';
import {NurseVisit,visitComposerHint,visitComposerLabel,visitTakesWords} from './visit';
import {ArrowUp} from 'lucide-react';
import {useChatViewport} from '@/components/patient/use-chat-viewport';
import {useThreadScroll} from '@/components/chat-v2/use-thread-scroll';
import {findNurseChatQuestionMember,openNurseChatZoe,readNurseChatZoeHistory} from '@/lib/nurse-chat/v2-zoe-actions';
import {readStaffZoeStream} from '@/lib/staff-zoe/stream';
import {checkedZoeEvent} from '@/lib/nurse-chat/zoe-events';
import {staffZoeRefusal} from '@/lib/staff-zoe/response-copy';
import type {ToolResult} from '@/lib/staff-zoe/contracts';
import {readNurseToday} from '@/lib/nurse-chat/today-actions';
import {readNurseChatVisit,readNurseChatVisits,searchNurseChatMembers} from '@/lib/nurse-chat/v2-actions';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {nurseUrgentWords} from '@/components/staff/nurse-urgent-guidance';
import {nurseHandoffCopy} from '@/lib/nurse-chat/handoff-copy';
import {useNurseTask,canCompleteTask} from './use-nurse-task';
import {NurseTaskTurns} from './task';
import {taskMatchesFilter,type NurseTaskOperation} from '@/lib/staff/real-coordination/task-copy';
import {readCoordinationPage,refreshCoordinationTask} from '@/lib/staff/real-coordination/actions';
import {NurseTaskList,NurseTaskDetails,NurseTaskCard,taskFilterLabel,type TaskFilter } from './task-list';
import {NurseVisitList} from './visit-list';
import {readNurseChatNotes} from '@/lib/nurse-chat/v2-notes-actions';
import {useNurseNotes,type NotesPage} from './use-nurse-notes';
import {NurseNotes,NurseNoteTurns} from './notes';
import type {CoordinationTask} from '@/lib/staff/real-coordination/schema';
import {useNurseConversation} from './use-nurse-conversation';
import {NurseConversation} from './conversation';
import {NurseUrgentSheet} from './urgent-sheet';
import {NurseChatMenu} from './menu';
import {nurseIntent} from '@/lib/nurse-chat/intent';
import {draftIntent} from '@/lib/nurse-chat/draft-intent';
import {buildHandoffDraft} from '@/lib/nurse-chat/handoff-draft';
import {readNurseMissingBp,readNurseAdherence,readNurseHandoffFacts} from '@/lib/nurse-chat/cohort-actions';
import {sentHandoffsCopy} from '@/lib/nurse-chat/sent-handoffs';
import {readNurseHandoffOverview} from '@/lib/nurse-chat/handoff-actions';
import {nurseBoundary} from '@/lib/nurse-chat/boundary';
import {smallTalk,smallTalkLines} from '@/lib/staff-zoe/small-talk';
import {actionIntent,memberActionIntent} from '@/lib/nurse-chat/action-intent';
import {todayItems} from '@/lib/nurse-chat/today';
import {measurementIntent,type MeasureIntent} from '@/lib/nurse-chat/measurement-intent';
import {measureCardNeedsConfirmation,prepareMeasureCard,saveMeasureCard,type MeasureCard,type MeasureIo} from '@/lib/nurse-chat/measure-card';
import {recordNurseVisitMark} from '@/lib/nurse-visit/actions';
import {ChatMemberIdentity} from '@/components/staff/chat-member-identity';
import {NurseReply,memberLabel,type MemberChoice,type AskMember,type Reply,type ThreadMessage} from './messages';

/** A typed name must be whole words of the member's name: "Ann" is not "Anna". */
function wholeWords(typed:string,full:string){const words:string[]=full.toLocaleLowerCase().match(/[\p{L}\p{M}]+/gu)??[];const wanted:string[]=typed.toLocaleLowerCase().match(/[\p{L}\p{M}]+/gu)??[];return wanted.length>0&&wanted.every(word=>words.includes(word));}

export function NurseChatV2({locale,nurseName,nurseId,voiceAvailable=false}:{locale:StaffLocale;nurseName:string;nurseId:string;voiceAvailable?:boolean}){
 const [l,setLocale]=useState(locale),[menu,setMenu]=useState(false),[urgent,setUrgent]=useState(false),[text,setText]=useState('');
 const [messages,setMessages]=useState<ThreadMessage[]>([]);
 const [pendingAlerts,setPendingAlerts]=useState<Record<string,boolean>>({});
 const alertPending=useCallback((key:string,pending:boolean)=>setPendingAlerts(previous=>previous[key]===pending?previous:{...previous,[key]:pending}),[]);
 const [fragmentReady,setFragmentReady]=useState(false);
 const [,fragmentChanged]=useState(0);
 const [busy,setBusy]=useState(false),locked=useRef(false),sequence=useRef(0);
 const input=useRef<HTMLTextAreaElement>(null);
 const [askMember,setAskMemberState]=useState<AskMember|null>(null),[zoeFor,setZoeFor]=useState<string|null>(null);
 const conversations=useRef(new Map<string,string>()),turns=useRef(new Map<string,AbortController>());
 const askTarget=useRef<AskMember|null>(null),selection=useRef(0);
 const mounted=useRef(true),chosenQuestions=useRef(new Set<string>());
 const historyRead=useRef<ReturnType<typeof readNurseChatZoeHistory>|null>(null),historyLoaded=useRef(false);
 useEffect(()=>{mounted.current=true;const active=turns.current;return()=>{mounted.current=false;for(const turn of active.values())turn.abort();active.clear();};},[]);

 const setAskMember=useCallback((member:AskMember|null)=>{
  selection.current++;
  const pending=new Set(turns.current.keys());
  for(const turn of turns.current.values())turn.abort();
  turns.current.clear();askTarget.current=member;setAskMemberState(member);
  if(pending.size)setMessages(previous=>previous.filter(message=>!(message.kind==='reply'&&'member'in message.reply&&'memberId'in message.reply.member&&pending.has(message.reply.member.memberId)&&message.reply.kind.startsWith('zoe-'))));
 },[]);
 const clearAskMember=useCallback(()=>setAskMember(null),[setAskMember]);

 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const atEnd=useRef<()=>boolean>(()=>true);
 const notes=useNurseNotes(setText,refuseNotes);
 const conversation=useNurseConversation(setText,atEnd,notes.held,clearAskMember);
 const visit=useNurseVisit(setText,l);
 const task=useNurseTask(setText),taskLabel=task.composerLabel(l);
 const handoff=conversation.handoff,hcopy=nurseHandoffCopy(l),handoffActive=conversation.open&&handoff.active;
 const [measuring,setMeasuring]=useState(false);
 // Her own reply to the member is a message to a real person: the first Send asks, only "Send to member" sends.
 // Keyed to the conversation and mode it was asked in, so a member or mode change closes it without an effect.
 const [confirmFor,setConfirmFor]=useState<string|null>(null);
 const frozen=conversation.frozen||handoff.frozen||task.frozen||visit.frozen||notes.frozen||measuring;
 const workHeld=task.active||visit.open||notes.active||handoffActive;
 // Share the member-switch guard with automatic Today navigation. Explicit close/cancel
 // still lets the nurse leave; cards from that old conversation no longer hold navigation.
 const hasPendingInput=workHeld||Boolean(text.trim())||Object.values(pendingAlerts).some(Boolean)||messages.some(message=>message.kind==='reply'&&message.reply.kind==='measure'&&message.reply.card.scope===(conversation.session?.key??null)&&measureCardNeedsConfirmation(message.reply.card));
 // In an open member conversation the nurse picks where the words go. Replying to the member is the default; asking Zoe is an explicit, visible switch and always starts with an empty box.
 const openMember=conversation.open&&!handoffActive&&!notes.active&&!task.active&&!visit.open?conversation.session?.member:undefined;
 const composerMember=task.active?task.task&&{memberId:task.task.caseId,memberName:task.task.memberName}
  :visit.open?visit.flow&&{memberId:visit.flow.selection.memberId,memberName:visit.flow.selection.memberName}
  :conversation.open?conversation.session&&{memberId:conversation.session.member.id,memberName:conversation.session.member.name}
  :askMember;
 // A Zoe draft belongs to the open member's conversation; when that conversation goes away (failed read, close) the draft goes with it.
 if(zoeFor&&!conversation.open){setZoeFor(null);setText('');}
 const zoeMode=Boolean(openMember&&zoeFor===openMember.id);
 const memberComposer=conversation.open&&!zoeMode;
 const confirmKey=`${conversation.session?.key}|${zoeMode}|${handoffActive}`,confirmReply=confirmFor===confirmKey,setConfirmReply=(on:boolean)=>setConfirmFor(on?confirmKey:null);
 const handoffLabel=handoff.flow?.topic?hcopy.note:hcopy.chooseTopic;
 const urgentWords=nurseUrgentWords(l);
 const focusState=`${frozen}|${conversation.session?.key}|${conversation.open}|${task.activeId}|${visit.flow?.key}|${visit.open}|${visit.flow?.commenting}|${visit.flow?.view}|${notes.activeId}`,focused=useRef(focusState);
 const focus=()=>{if(!visit.open||visit.flow?.commenting||visit.flow?.view==='complete')input.current?.focus({preventScroll:true});};
 useChatViewport(true);
 const {threadRef,contentRef,unread,newest}=useThreadScroll(messages.map(message=>message.id+(message.kind==='reply'?message.reply.kind:message.kind)).join('|')+'|'+(conversation.session?.data?.ok?conversation.session.data.items.map(item=>item.id).join('|'):'')+'|'+conversation.optimistic.map(reply=>reply.request.requestId).join('|')+'|'+handoff.page?.items.map(item=>item.task.id+item.task.revision).join('|')+'|'+handoff.flow?.turns.map(turn=>turn.id+turn.state).join('|')+'|'+handoff.flow?.notice+'|'+handoff.fallbacks.map(item=>item.taskId).join('|')+'|'+JSON.stringify(notes.entries)+'|'+JSON.stringify(visit.flow)+'|'+visit.sending+'|'+task.entries.map(entry=>entry.id+entry.note+entry.state+entry.error).join('|'));
 // The next question is the reply to the nurse's own answer, so it lands in view.
 const visitTurn=visit.open&&visit.question?`${questionKey(visit.question)}|${visit.flow?.view}`:'';
 useLayoutEffect(()=>{if(visitTurn)newest();},[visitTurn,newest]);
 // During a visit the keyboard only moves because of the nurse's own press, so the question stays in view.
 useEffect(()=>{
  const viewport=window.visualViewport;if(!viewport||!visit.open)return;
  const resize=()=>{if(document.activeElement?.closest('[data-sample-collection], [data-visit-fields], [data-visit-preview]'))return;newest();};
  viewport.addEventListener('resize',resize);
  return ()=>viewport.removeEventListener('resize',resize);
 },[visit.open,newest]);
 const {caughtUp}=conversation;
 useEffect(()=>{if(!unread)caughtUp();},[unread,caughtUp]);
 useLayoutEffect(()=>{
  atEnd.current=()=>{const box=threadRef.current;return !box||box.scrollHeight-box.clientHeight-box.scrollTop<4;};
 },[threadRef]);
 useLayoutEffect(()=>{
  // Only a change of conversation state refocuses: the page never opens the keyboard on load.
  if(focused.current===focusState)return;
  focused.current=focusState;
  if(!frozen&&!visit.open)input.current?.focus({preventScroll:true});
 },[focusState,frozen,visit.open]);
 useLayoutEffect(()=>{
  const field=input.current;if(!field)return;
  field.style.height='auto';
  field.style.height=`${Math.min(field.scrollHeight,parseFloat(getComputedStyle(field).lineHeight)*5)}px`;
 },[text]);
 function append(rows:ThreadMessage[]){setMessages(previous=>[...previous,...rows]);}
 function select(member:MemberChoice,list:string){
  if(busy||frozen||hasPendingInput)return;
  newest();setText('');setZoeFor(null);setAskMember({memberId:member.id,memberName:member.name??t('Member','Անդամ','Участник')});
  const said=String(++sequence.current),id=String(++sequence.current);
  setMessages(previous=>[...previous.filter(message=>message.id!==list),{id:said,kind:'nurse',text:memberLabel(member,l)},{id,kind:'conversation',member}]);
  void conversation.openMember(member,id).then(focus);focus();
 }
 function closeConversation(){
  if(notes.active||frozen)return;newest();setZoeFor(null);
  const member=handoffActive?conversation.session?.member:null;
  setAskMember(member?{memberId:member.id,memberName:member.name??t('Member','Անդամ','Участник')}:null);
  if(handoffActive)handoff.cancel();else conversation.close();focus();
 }
 function toggleZoe(){
  if(!openMember||busy||frozen||conversation.sending||conversation.optimistic.some(reply=>reply.state==='uncertain')||(!zoeMode&&!conversation.session?.data?.ok))return;
  newest();setText('');setZoeFor(zoeMode?null:openMember.id);focus();
 }
 function handoffAction(action:()=>void){newest();focus();action();focus();}
 function completeTask(item:CoordinationTask,operation:NurseTaskOperation='complete'){
  if(busy||conversation.open||handoffActive||task.active||visit.open||notes.active)return;
  newest();focus();const id=String(++sequence.current);
  if(task.start(item,id,operation))append([{id,kind:'task'}]);focus();
 }
 function taskAction(action:()=>void){newest();focus();action();focus();}
 function openVisit(selection:VisitChoice,old?:string){
  if(busy||frozen||conversation.open||task.active||visit.open||notes.active)return;
  newest();input.current?.blur();const id=String(++sequence.current);
  if(visit.start(selection,id))setMessages(previous=>[...previous.filter(row=>row.id!==old).map<ThreadMessage>(row=>row.kind==='reply'&&row.reply.kind==='visits'?{...row,reply:{...row.reply,data:{...row.reply.data,visits:row.reply.data.visits.filter(visit=>visit.id!==selection.id||visit.source!==selection.source)}}}:row),{id:String(++sequence.current),kind:'nurse',text:selection.memberName},{id,kind:'visit',visit:selection}]);
 }
 async function readWork(label:string,read:()=>Promise<Reply|null>,used?:string){
  if(locked.current||frozen||workHeld)return;
  locked.current=true;setBusy(true);newest();focus();
  try{const reply=await read();if(!reply)return;
   const meta=reply.kind==='notes'?{at:new Date().toISOString(),conversationKey:conversation.session?.key}:{};
   setMessages(previous=>[...previous.flatMap<ThreadMessage>(row=>row.id!==used?[row]:row.kind==='reply'&&row.reply.kind==='today'?[{...row,reply:{...row.reply,tasksUsed:row.reply.tasksUsed||reply.kind==='tasks',visitsUsed:row.reply.visitsUsed||reply.kind==='visits'}}]:[]),{id:String(++sequence.current),kind:'nurse',text:label,...meta},{id:String(++sequence.current),kind:'reply',reply,...meta}]);
  }catch{}finally{locked.current=false;setBusy(false);focus();}
 }
 function allTasks(filter:TaskFilter='active',old?:Extract<Reply,{kind:'tasks'}>,used?:string){
  if(conversation.open)return;
  void readWork(old?t('Load more tasks','Բեռնել ավելի շատ առաջադրանքներ','Загрузить ещё задачи'):taskFilterLabel(l,filter),async()=>{
   const result=await readCoordinationPage({filter,cursor:old?.page.nextCursor??null});if(!result.ok)return null;
   const page=old?{...result.page,tasks:[...new Map([...old.page.tasks,...result.page.tasks].map(row=>[row.id,row])).values()]}:result.page;
   return {kind:'tasks',page,filter};
  },used);
 }
 function details(item:CoordinationTask,source?:string){
  if(conversation.open)return;
  void readWork(taskTitle(item,l),async()=>{const fresh=await refreshCoordinationTask(item.id);if(!fresh.ok)return null;
   if(source)setMessages(previous=>previous.flatMap<ThreadMessage>(row=>{
    if(row.id!==source||row.kind!=='reply')return [row];
    if(row.reply.kind==='task-details')return [];
    if(row.reply.kind==='tasks')return [{...row,reply:{...row.reply,page:{...row.reply.page,tasks:row.reply.page.tasks.filter(task=>task.id!==item.id)}}}];
    if(row.reply.kind==='today')return [{...row,reply:{...row.reply,hiddenTasks:[...(row.reply.hiddenTasks??[]),item.id]}}];
    return [row];
   }));
   return {kind:'task-details',snapshot:fresh.task};});
 }
 const measureCards=useRef(new Map<string,MeasureCard>()),measureBusy=useRef(false);
 const measureIo:MeasureIo={
  readVisits:async()=>{const result=await readNurseChatVisits();return result.status==='ready'?{status:'ready',data:result.data}:{status:result.status};},
  readVisit:(memberId,source,id)=>readNurseChatVisit(memberId,source,id),
  mark:command=>recordNurseVisitMark(command),
  newId:()=>crypto.randomUUID(),
 };
 function setMeasureCard(id:string,card:MeasureCard){measureCards.current.set(id,card);replace(id,{kind:'measure',card});}
 /** A typed reading becomes a card with the member and the open visit; nothing is written until Save. */
 async function startMeasure(value:string,measure:MeasureIntent){
  locked.current=true;setBusy(true);
  const own=String(++sequence.current),id=String(++sequence.current);
  append([{id:own,kind:'nurse',text:value},{id,kind:'reply',reply:{kind:'loading-search'}}]);
  try{
   const open=zoeMode&&openMember?{id:openMember.id,name:openMember.name??''}:null;
   let member=open;
   // A name typed after "for" must be whole words of the member's name: "Ann" is not "Anna".
   if(open&&measure.name&&!wholeWords(measure.name,open.name)){replace(id,{kind:'choose-member'});return;}
   if(!member&&measure.name){
    const found=await searchNurseChatMembers(measure.name);if(!mounted.current)return;
    if(!found.ok){replace(id,{kind:'search-failed'});return;}
    const exact=found.page.rows.filter(row=>wholeWords(measure.name!,row.name??''));
    if(exact.length!==1||found.page.hasMore){replace(id,{kind:'members',page:found.page});return;}
    member={id:exact[0]!.id,name:exact[0]!.name??''};
   }
   if(!member){replace(id,{kind:'choose-member'});return;}
   const card=await prepareMeasureCard(measureIo,member,measure.entries,l,open?conversation.session?.key??null:null);if(!mounted.current)return;
   if('error' in card)replace(id,{kind:'text',text:card.error??''});else setMeasureCard(id,card);
  }catch{if(mounted.current)replace(id,{kind:'text',text:t('Visits are unavailable. Try again.','Այցերը հասանելի չեն։ Կրկին փորձեք։','Визиты недоступны. Попробуйте ещё раз.')});}
  finally{locked.current=false;setBusy(false);focus();}
 }
 async function measureAction(id:string,action:'save'|'cancel'|'visits'){
  const card=measureCards.current.get(id);if(!card)return;
  if(action==='visits'){allVisits();return;}
  // Only a card nobody has written for can be cancelled, and a card prepared in another conversation is no longer current.
  if(measureBusy.current||!measureCardNeedsConfirmation(card))return;
  if(card.state==='confirm'&&card.scope!==(conversation.session?.key??null)){setMeasureCard(id,{...card,state:'expired'});return;}
  if(action==='cancel'){if(card.state==='confirm')setMeasureCard(id,{...card,state:'cancelled'});return;}
  measureBusy.current=true;setMeasuring(true);setMeasureCard(id,{...card,state:'saving'});
  try{const saved=await saveMeasureCard(measureIo,card,l);if(mounted.current)setMeasureCard(id,saved);}
  catch{if(mounted.current)setMeasureCard(id,{...card,state:card.entries.some(entry=>entry.attempted)?'unsure':'unavailable'});}
  finally{measureBusy.current=false;setMeasuring(false);focus();}
 }
 function allMissingBp(){
  void readWork(t('Members with no blood pressure this week','Այս շաբաթ ճնշման չափում չունեցող անդամներ','Участники без измерений давления на этой неделе'),async()=>{
   const data=await readNurseMissingBp();
   return data.kind==='missing-bp'?{kind:'missing-bp',data}:{kind:'text',text:t('This list is unavailable here.','Այս ցանկն այստեղ հասանելի չէ։','Этот список здесь недоступен.')};
  });
 }
 /** "draft a handoff for the doctor": a summary built by code from the record, placed in the hand-over composer on the latest member message not handed over
  * yet; she edits it and presses send. With no such message the summary is shown as a card so it is not lost. Nothing is saved or sent by the words. */
 async function draftHandoffByWords(value:string){
  const member=conversation.session?.member,data=conversation.session?.data;
  if(!conversation.open||!member)return;
  locked.current=true;setBusy(true);
  let facts:Awaited<ReturnType<typeof readNurseHandoffFacts>>=null;
  try{facts=await readNurseHandoffFacts(member.id);}catch{facts=null;}
  finally{locked.current=false;setBusy(false);}
  if(!mounted.current)return;
  const say=(text:string)=>append([{id:String(++sequence.current),kind:'nurse',text:value},{id:String(++sequence.current),kind:'reply',reply:{kind:'text',text}}]);
  if(!facts){say(t('The record could not be read, so no summary was prepared. Try again.','Գրառումը չհաջողվեց կարդալ, ուստի ամփոփում չի պատրաստվել։ Կրկին փորձեք։','Не удалось прочитать запись, сводка не подготовлена. Попробуйте ещё раз.'));return;}
  const items=data?.ok?data.items:[];
  const handed=new Set([...handoff.remembered,...(handoff.page?.items.map(item=>item.messageId)??[])]);
  const fromMember=[...items].reverse().filter(item=>item.senderRole==='member');
  const anchor=fromMember.find(item=>!handed.has(item.id));
  const quoted=anchor??fromMember[0];
  const draft=buildHandoffDraft({...facts,identity:memberLabel(member,l),memberMessage:quoted?{text:quoted.text,at:quoted.at}:null},l);
  if(!anchor){say(`${t('There is no member message left to hand over, so here is the summary to copy into a note:','Փոխանցելու համար անդամի հաղորդագրություն չի մնացել, ահա ամփոփումը՝','Не осталось сообщения участника для передачи, вот сводка, которую можно скопировать в заметку:')}\n\n${draft}`);return;}
  setZoeFor(null);handoffAction(()=>handoff.start(anchor.id,`${hcopy.handOver}\n${anchor.text.slice(0,90)}`));setText(draft);
 }
 function allAdherence(){
  void readWork(t('Medicine doses reported this week','Այս շաբաթ հաղորդված դեղաչափեր','Отмеченные дозы лекарств за неделю'),async()=>{
   const data=await readNurseAdherence();
   return data.kind==='adherence'?{kind:'adherence',data}:{kind:'text',text:t('This list is unavailable here.','Այս ցանկն այստեղ հասանելի չէ։','Этот список здесь недоступен.')};
  });
 }
 function allHandoffs(){
  void readWork(sentHandoffsCopy(l).title,async()=>{
   const page=await readNurseHandoffOverview();
   return page?{kind:'handoffs',page}:{kind:'text',text:sentHandoffsCopy(l).unavailable};
  });
 }
 /** "start visit (for X)": opens the same visit flow as the Open visit button when exactly one visit fits; otherwise the visit list. */
 async function startVisitByWords(name:string|null,next=false){
  locked.current=true;setBusy(true);
  let found:VisitChoice|null=null;
  try{
   const result=await readNurseChatVisits();
   if(result.status==='ready'){
    const today=result.data.today;
    const open=result.data.visits.filter(visit=>!visit.completion&&new Date(Date.parse(visit.startsAt)+4*3600_000).toISOString().slice(0,10)<=today);
    const wanted=name?result.data.visits.filter(visit=>!visit.completion&&wholeWords(name,visit.memberName)):open;
    if(next){found=[...result.data.visits].filter(v=>!v.completion&&v.bookingStatus!=='cancelled').sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt))[0]??null;}else if(wanted.length===1)found=wanted[0]!;
   }
  }catch{/* The list below says what is available. */}
  finally{locked.current=false;setBusy(false);}
  if(!mounted.current)return;
  if(found)openVisit(found);else allVisits();
 }
 /** "mark the (first) task done, note: ...": opens the same note composer as Mark done, with the note prefilled; saved only by her send. */
 async function completeTaskByWords(which:'first'|null,note:string|null){
  locked.current=true;setBusy(true);
  let found:CoordinationTask|null=null;
  try{
   const result=await readNurseToday();
   if(result.ok){
    const items=todayItems(result.page?.tasks??[],result.visits?.enabled?result.visits.visits:[],new Date()).filter(item=>item.kind==='task'&&item.state!=='completed'&&item.state!=='cancelled'&&canCompleteTask(item.task));
    if(items.length===1||(which==='first'&&items.length>0)){const first=items[0]!;if(first.kind==='task')found=first.task;}
   }
  }catch{/* Today below says what is open. */}
  finally{locked.current=false;setBusy(false);}
  if(!mounted.current)return;
  if(found){completeTask(found);if(note)setText(note);}else void send('today');
 }
 /** "add a care note: ...": opens the same note composer as the Add a note button, with the text prefilled; her send saves. */
 async function careNoteByWords(value:string,text:string){
  const member=conversation.session?.member;if(!conversation.open||!member)return;
  locked.current=true;setBusy(true);
  let page:NotesPage|null=null,refused:'denied'|'off'|null=null;
  try{
   const result=await readNurseChatNotes(member.id);
   if(result.kind==='ready'&&result.card==='notes')page=result;
   else if(result.kind==='denied'||result.kind==='off')refused=result.kind;
  }catch{/* The line below says it is unavailable. */}
  finally{locked.current=false;setBusy(false);}
  if(!mounted.current)return;
  if(refused){refuseNotes(member.id,refused);return;}
  if(!page){append([{id:String(++sequence.current),kind:'nurse',text:value},{id:String(++sequence.current),kind:'reply',reply:{kind:'text',text:t('Care notes are unavailable. Try again.','Խնամքի նշումները հասանելի չեն։ Կրկին փորձեք։','Заметки об уходе недоступны. Попробуйте ещё раз.')}}]);return;}
  setZoeFor(null);addNote(member,page,'');setText(text);
 }
 /** "hand over to the doctor (: note)": starts the same hand-over flow as the Hand over button on the member's latest message; she picks the topic and sends. */
 function handOverByWords(value:string,note:string|null){
  const data=conversation.session?.data;
  const last=data?.ok?[...data.items].reverse().find(item=>item.senderRole==='member'):undefined;
  const say=(text:string)=>append([{id:String(++sequence.current),kind:'nurse',text:value},{id:String(++sequence.current),kind:'reply',reply:{kind:'text',text}}]);
  if(!last){say(t('There is no member message to hand over.','Փոխանցելու համար անդամի հաղորդագրություն չկա։','Нет сообщения участника для передачи.'));return;}
  if(handoff.remembered.includes(last.id)){say(t('The latest member message is already handed over.','Անդամի վերջին հաղորդագրությունն արդեն փոխանցված է։','Последнее сообщение участника уже передано.'));return;}
  setZoeFor(null);handoffAction(()=>handoff.start(last.id,`${hcopy.handOver}\n${last.text.slice(0,90)}`));
  if(note)setText(note);
 }
 function allVisits(used?:string){
  if(conversation.open)return;
  void readWork(t('See all visits','Տեսնել բոլոր այցերը','Посмотреть все визиты'),async()=>{
   const result=await readNurseChatVisits();
   if(result.status==='refused')setMessages(previous=>previous.filter(row=>!(row.kind==='reply'&&row.reply.kind==='visits')&&row.kind!=='visit').map<ThreadMessage>(row=>row.kind==='reply'&&row.reply.kind==='today'&&row.reply.data.ok?{...row,reply:{...row.reply,data:{...row.reply.data,visits:{version:'nurse-visit-v1',enabled:false,visits:[]}}}}:row));
   return result.status==='ready'?{kind:'visits',data:result.data}:null;
  },used);
 }
 function refuseNotes(memberId:string,code:'denied'|'off'){
  const keys=new Set(messages.flatMap(row=>row.kind==='conversation'&&row.member.id===memberId?[row.id]:[]));
  setMessages(previous=>previous.filter(row=>!row.conversationKey||!keys.has(row.conversationKey)));
  conversation.refuseAccess(code);
 }
 function showNotes(){
  const member=conversation.session?.member;if(!conversation.open||!member)return;
  void readWork(t('Notes','Նշումներ','Заметки'),async()=>{
   const result=await readNurseChatNotes(member.id);
   if(result.kind==='denied'||result.kind==='off')refuseNotes(member.id,result.kind);
   return result.kind==='ready'&&result.card==='notes'?{kind:'notes',page:result,member}:null;
  });
 }
 function addNote(member:MemberChoice,page:NotesPage,used:string){
  if(busy||frozen||notes.active||task.active||visit.open||handoffActive||conversation.session?.member.id!==member.id||!conversation.open)return;
  const id=String(++sequence.current);newest();focus();
  conversation.invalidateReads();
  if(notes.start(member,page,id))setMessages(previous=>[...previous.map<ThreadMessage>(row=>row.id===used&&row.kind==='reply'&&row.reply.kind==='notes'?{...row,reply:{...row.reply,used:true}}:row),{id:String(++sequence.current),kind:'nurse',text:t('Add a note','Ավելացնել նշում','Добавить заметку'),at:new Date().toISOString(),conversationKey:conversation.session?.key},{id,kind:'care-note',at:new Date().toISOString(),conversationKey:conversation.session?.key}]);
  focus();
 }
 function replace(id:string,reply:Reply){setMessages(previous=>previous.map(message=>message.id===id?{id,kind:'reply',reply}:message));}
 async function loadZoeHistory(){
  if(historyLoaded.current)return;
  const result=await (historyRead.current??=readNurseChatZoeHistory(nurseId)).catch(()=>null);
  if(!mounted.current||historyLoaded.current)return;
  historyLoaded.current=true;
  // A failed saved-history read never changes the thread or the selected member.
  if(result?.kind!=='history')return;
  for(const row of result.conversations)if(!conversations.current.has(row.memberId))conversations.current.set(row.memberId,row.conversationId);
  const saved:ThreadMessage[]=result.turns.map(turn=>turn.role==='staff'?{id:`history:${turn.key}`,kind:'nurse',text:turn.text,toZoe:true,at:turn.savedAt}:{id:`history:${turn.key}`,kind:'reply',at:turn.savedAt,reply:{kind:'zoe-answer',member:{memberId:turn.memberId,memberName:turn.memberName??t('Member','Անդամ','Участник')},cards:[],...(turn.content?{content:turn.content}:{error:staffZoeRefusal('unavailable',l)})}});
  if(saved.length)setMessages(previous=>[...saved,...previous]);
  const target=result.target?{memberId:result.target.memberId,memberName:result.target.memberName??t('Member','Անդամ','Участник')}:null;
  return target;
 }
 function askZoe(member:AskMember,value:string,own:string,id:string){
  if(!mounted.current||askTarget.current?.memberId!==member.memberId)return;
  setMessages(previous=>previous.map(message=>message.id===own&&message.kind==='nurse'?{...message,toZoe:true}:message));
  if(turns.current.has(member.memberId)){replace(id,{kind:'zoe-error',member,cards:[],error:staffZoeRefusal('busy',l)});return;}
  const controller=new AbortController();turns.current.set(member.memberId,controller);
  const current=()=>mounted.current&&askTarget.current?.memberId===member.memberId&&!controller.signal.aborted&&turns.current.get(member.memberId)===controller;
  replace(id,{kind:'zoe-loading',member,cards:[]});
  void (async()=>{
   let cards:ToolResult[]=[];
   try{
    let conversationId=conversations.current.get(member.memberId);
    if(!conversationId){const opened=await openNurseChatZoe(member.memberId,nurseId);if(!current())return;if(!('ok'in opened)||!opened.ok)throw Error('Zoe unavailable');conversationId=opened.conversationId;conversations.current.set(member.memberId,conversationId);}
    if(!current())return;
    const response=await fetch('/staff/real/zoe/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId,submissionId:crypto.randomUUID(),text:value,intent:null,locale:l}),signal:controller.signal});
    if(!current()){await response.body?.cancel();return;}
    await readStaffZoeStream(response,raw=>{
     const event=checkedZoeEvent(raw);
     if(!current())return;
     if(event.type==='cards'){cards=event.cards;replace(id,{kind:'zoe-cards',member,cards});}
     if(event.type==='answer')replace(id,{kind:'zoe-answer',member,cards,content:event.content});
     if(event.type==='refused')replace(id,{kind:'zoe-error',member,cards,error:staffZoeRefusal(event.code,l)});
    },controller.signal);
   }catch{if(current())replace(id,{kind:'zoe-error',member,cards,error:staffZoeRefusal('unavailable',l)});}
   finally{if(turns.current.get(member.memberId)===controller)turns.current.delete(member.memberId);}
  })();
 }
 function chooseQuestion(id:string,row:{id:string;name:string}){
  const message=messages.find(message=>message.id===id);
  if(locked.current||frozen||(conversation.open&&!zoeMode)||task.active||visit.open||notes.active||chosenQuestions.current.has(id)||message?.kind!=='reply'||message.reply.kind!=='question-choice'||message.reply.used)return;
  const choice=message.reply;if(!choice.rows.slice(0,5).some(candidate=>candidate.id===row.id))return;
  chosenQuestions.current.add(id);newest();focus();
  const member={memberId:row.id,memberName:row.name},own=String(++sequence.current),answer=String(++sequence.current);
  if(conversation.open&&conversation.session?.member.id!==member.memberId){conversation.close();setZoeFor(null);}
  setAskMember(member);setText('');
  setMessages(previous=>[...previous.map<ThreadMessage>(message=>message.id===id?{id,kind:'reply',reply:{...choice,used:true}}:message),{id:own,kind:'nurse',toZoe:true,text:t(`Ask about ${row.name}`,`Հարցնել ${row.name}-ի մասին`,`Спросить об участнике ${row.name}`)},{id:answer,kind:'reply',reply:{kind:'zoe-loading',member,cards:[]}}]);
  askZoe(member,choice.question,own,answer);
 }
 async function sendConfirmed(){if(frozen||!memberComposer||handoffActive)return;
  // The version she has read is taken by the send itself, before the thread follows to the end, so a message she has not seen still makes the send stale.
  const sending=conversation.send(text);newest();focus();await sending;focus();}
 async function loadToday(id:string){
  try{const data=await readNurseToday();if(mounted.current)replace(id,{kind:'today',data});}
  catch{if(mounted.current)replace(id,{kind:'today-failed'});}
 }
 useEffect(()=>{
  const changed=()=>fragmentChanged(value=>value+1);
  window.addEventListener('hashchange',changed);window.addEventListener('popstate',changed);
  return ()=>{window.removeEventListener('hashchange',changed);window.removeEventListener('popstate',changed);};
 },[]);
 // Check before paint, and after a client navigation reuses this screen. Consume only
 // when it is safe to leave the current work; drafts and unconfirmed cards stay intact.
 // The browser owns the fragment. Sync before paint and recheck on each commit;
 // clearing it before updating state makes this finite, including in Strict Mode.
 /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
 useLayoutEffect(()=>{
  if(!fragmentReady)setFragmentReady(true);
  if(window.location.hash!=='#today'||locked.current||frozen||hasPendingInput)return;
  window.history.replaceState(window.history.state,'',window.location.pathname+window.location.search);
  if(conversation.open){conversation.close();setZoeFor(null);}
  setAskMember(null);locked.current=true;setBusy(true);newest();
  const own=String(++sequence.current),id=String(++sequence.current);
  append([{id:own,kind:'nurse',text:t('Today','Այսօր','Сегодня')},{id,kind:'reply',reply:{kind:'loading-today'}}]);
  void loadToday(id).finally(()=>{locked.current=false;if(mounted.current)setBusy(false);});
 });
 /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
 async function send(words=text){
  if(notes.active){if(notes.frozen)return;newest();focus();await notes.send(words);focus();return;}
  if(visit.open){if(visit.frozen||!visitTakesWords(visit))return;newest();focus();await visit.send(words);focus();return;}

  if(task.active){if(task.frozen)return;newest();focus();await task.send(words);focus();return;}
  if(memberComposer){if(frozen)return;
   // A plain reply to the member only asks here. Nothing scrolls or reads, so a message she has not seen still makes the send stale.
   if(!handoffActive){if(!confirmReply)setConfirmReply(true);return;}
   newest();focus();const data=conversation.session?.data;if(data?.ok)await handoff.send(conversation.reviewedData(data),words,conversation.refresh,conversation.refuseAccess,conversation.invalidateReads);focus();return;}
  if(zoeFor&&!zoeMode){setZoeFor(null);setText('');return;}
  const value=words.trim();if(!value||locked.current)return;
  voiceConversation.sent();
  // What only the doctor may do gets one fixed line. Nothing is sent to Zoe or to a member, and nothing is changed.
  if(nurseBoundary(value)){if(busy||frozen)return;setText('');newest();append([{id:String(++sequence.current),kind:'nurse',text:value},{id:String(++sequence.current),kind:'reply',reply:{kind:'boundary'}}]);return;}
  // Plain chat (a greeting, "can you talk", "what can you do", thanks) gets fixed words at the top level; with a member open it goes to Zoe, which answers it the same way.
  const talk=zoeMode?null:smallTalk(value);
  if(talk){if(busy||frozen)return;setText('');newest();append([{id:String(++sequence.current),kind:'nurse',text:value},{id:String(++sequence.current),kind:'reply',reply:{kind:'small-talk',lines:smallTalkLines(talk,'nurse',l)}}]);return;}
  // A typed reading becomes a card to confirm; it is written only by Save, into the member's open nurse visit.
  const measure=measurementIntent(value);
  if(measure){if(busy||frozen)return;setText('');newest();void startMeasure(value,measure);return;}
  // "Draft a handoff": a summary of the record into the hand-over composer, for her to edit and send (Zoe mode, member open).
  const draftWords=zoeMode?draftIntent(value):null;
  if(draftWords){if(busy||frozen||notes.active||task.active||visit.open||handoffActive)return;setText('');newest();void draftHandoffByWords(value);return;}
  // Words for the open member (Zoe mode) open the same composers as the Notes and Hand over buttons, with the text prefilled.
  const memberAction=zoeMode?memberActionIntent(value):null;
  if(memberAction){if(busy||frozen||notes.active||task.active||visit.open||handoffActive)return;setText('');newest();if(memberAction.kind==='care-note')void careNoteByWords(value,memberAction.text);else handOverByWords(value,memberAction.note);return;}
  // Words for actions the buttons already do open the same flow the button opens; the button's confirm step stays.
  const action=zoeMode?null:actionIntent(value);
  if(action){if(busy||frozen)return;setText('');newest();void (action.kind==='start-visit'?startVisitByWords(action.name,action.next):completeTaskByWords(action.which,action.note));return;}
  // Plain words that ask for the nurse's own work open the same lists as the buttons; everything else is a name or a question for Zoe.
  const rawIntent=nurseIntent(value);
  // In Zoe mode only the read-only lists (handoffs, the BP cohort) are commands; every other sentence stays a question about the open member.
  const intent=zoeMode?(rawIntent?.kind==='handoffs'||rawIntent?.kind==='missing-bp'||rawIntent?.kind==='adherence'||rawIntent?.kind==='priority'?rawIntent:null):rawIntent;
  if(intent?.kind==='handoffs'){if(busy||frozen)return;setText('');newest();allHandoffs();return;}
  if(intent?.kind==='missing-bp'){if(busy||frozen)return;setText('');newest();allMissingBp();return;}
  if(intent?.kind==='adherence'){if(busy||frozen)return;setText('');newest();allAdherence();return;}
  if(intent&&(intent.kind==='visits'||intent.kind==='tasks')){if(busy||frozen)return;setText('');newest();if(intent.kind==='visits')allVisits();else allTasks(intent.filter);return;}
  locked.current=true;setBusy(true);setText('');newest();input.current?.focus({preventScroll:true});
  const command=value.toLocaleLowerCase();
  const today=intent?.kind==='priority'||!zoeMode&&(['today','այսօր','сегодня'].includes(command)||intent?.kind==='today');
  const searchQuery=intent?.kind==='find'?intent.query:null;
  const name=!zoeMode&&(searchQuery!==null||value.length>=2&&value.length<=100&&value.split(/\s+/u).length<=4&&/^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]*$/u.test(value)&&! /^(who|which|what(?:'s|’s)?|how|why|when|where|can|could|does|did|do|is|are|tell|summari[sz]e|show|ask|read|and|any|latest|last|recent|previous|кто|у кого|какой|какая|какие|как|почему|что|когда|где|покажи|скажи|расскажи|найди|дай|можешь|можете|есть|а|последний|последняя|последние|предыдущий|ինչ|ով|ո՞վ|ո՞ր|ինչու|ինչպես|երբ|որտեղ|որն|ցույց|ասա|պատմիր|գտիր|տուր|կարող|խնդրում|վերջին|նախորդ)(?:\s|$)/iu.test(value));
  try{
   const own=String(++sequence.current),id=String(++sequence.current);
   append([{id:own,kind:'nurse',text:value,toZoe:!today&&!name},{id,kind:'reply',reply:{kind:today?'loading-today':'loading-search'}}]);
   if(today){await loadToday(id);return;}
   if(name){try{const result=await searchNurseChatMembers(searchQuery??value);replace(id,result.ok?{kind:'members',page:result.page}:{kind:'search-failed'});}catch{replace(id,{kind:'search-failed'});}return;}
   try{
    const beforeHistory=selection.current;
    const target=await loadZoeHistory();if(!mounted.current||selection.current!==beforeHistory)return;
    const chart=zoeMode?openMember:undefined;
    if(chart&&askTarget.current?.memberId!==chart.id)setAskMember({memberId:chart.id,memberName:chart.name??t('Member','Անդամ','Участник')});
    else if(!conversation.open&&!askTarget.current&&target)setAskMember(target);
    const current=askTarget.current??undefined,at=selection.current;
    const found=await findNurseChatQuestionMember(value,nurseId,current);
    if(!mounted.current||selection.current!==at)return;
    if(found.kind==='member'&&current&&found.memberId!==current.memberId){replace(id,{kind:'question-choice',rows:[{id:found.memberId,name:found.memberName}],question:value});return;}
    if(found.kind==='member'){const member={memberId:found.memberId,memberName:found.memberName};setAskMember(member);askZoe(member,value,own,id);}
    else if(found.kind==='keep'&&current)askZoe(current,value,own,id);
    else if(found.kind==='choose')replace(id,{kind:'question-choice',rows:found.rows.slice(0,5),question:value});
    else replace(id,found.kind==='refused'||found.kind==='unavailable'?{kind:'zoe-refused',error:staffZoeRefusal('unavailable',l)}:{kind:'choose-member'});
   }catch{replace(id,{kind:'zoe-refused',error:staffZoeRefusal('unavailable',l)});}
  }finally{locked.current=false;setBusy(false);}
 }
 function renderMessage(message:ThreadMessage){
     if(message.kind==='care-note'){const entry=notes.entries.find(row=>row.id===message.id);return entry?<NurseNoteTurns key={message.id} entry={entry} locale={l} active={notes.activeId===entry.id} frozen={notes.frozen||notes.blocked} onKind={value=>taskAction(()=>notes.kind(value))} onRetry={()=>taskAction(()=>{void notes.retry();})}/>:null;}
     if(message.kind==='reply'){
      const reply=message.reply,held=busy||frozen||conversation.open||task.active||visit.open||notes.active;
      const props={locale:l,disabled:held,onDetails:(item:CoordinationTask)=>details(item,message.id),onOperation:completeTask};
      let content;
      if(reply.kind==='tasks')content=<NurseTaskList {...props} page={{...reply.page,tasks:reply.page.tasks.filter(row=>!task.entries.some(entry=>entry.task.id===row.id&&Number(entry.id)>Number(message.id))).map(row=>task.updates[row.id]&&task.updates[row.id].revision>row.revision?task.updates[row.id]:row).filter(row=>taskMatchesFilter(row,reply.filter))}} filter={reply.filter} onFilter={filter=>allTasks(filter,undefined,message.id)} onMore={()=>allTasks(reply.filter,reply,message.id)}/>;
      if(reply.kind==='task-details'&&task.entries.some(entry=>entry.task.id===reply.snapshot.id&&Number(entry.id)>Number(message.id)))return null;
      if(reply.kind==='task-details')content=<NurseTaskDetails {...props} snapshot={task.updates[reply.snapshot.id]?.revision>reply.snapshot.revision?{...reply.snapshot,...task.updates[reply.snapshot.id]}:reply.snapshot}/>;
      if(reply.kind==='visits')content=<NurseVisitList data={reply.data} locale={l} disabled={held} onOpen={openVisit}/>;
      if(reply.kind==='notes')content=<NurseNotes page={reply.page} locale={l} disabled={busy||frozen||notes.active||handoffActive||!conversation.open||conversation.session?.member.id!==reply.member.id} onAdd={reply.used?undefined:()=>addNote(reply.member,reply.page,message.id)}/>;
      if(content)return <article key={message.id} data-message-key={message.id} className="cv2-msg cv2-zoe"><div className="cv2-say ncv2-card">{content}</div></article>;
     }
     if(message.kind==='visit')return visit.open&&visit.flow?.key===message.id?<NurseVisit key={message.id} visit={visit} locale={l} onAction={taskAction} draft={text}/>:<article key={message.id} className="cv2-msg cv2-zoe"><div>{<button type="button" className="ncv2-choice" disabled={busy||frozen||conversation.open||task.active||visit.open} onClick={()=>openVisit(message.visit,message.id)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{t('Visit with','Այց՝','Визит с')} {message.visit.memberName}</button>}</div></article>;
     if(message.kind==='task'){
      const entry=task.entries.find(entry=>entry.id===message.id);
      return entry?<div key={message.id}><NurseTaskTurns active={task.activeId===entry.id} entry={entry} locale={l} sending={task.sending} onOutcome={value=>taskAction(()=>{task.setOutcome(value);if(task.outcome!==value)setText('');})} onConfirm={()=>taskAction(()=>{void task.send();})} onCheck={()=>taskAction(()=>{void task.check().then(focus);})}/>{task.activeId!==entry.id&&task.updates[entry.task.id]&&!task.entries.some(row=>row.task.id===entry.task.id&&Number(row.id)>Number(entry.id))&&<article className="cv2-msg cv2-zoe"><div className="cv2-say ncv2-card"><NurseTaskCard task={task.updates[entry.task.id]} locale={l} disabled={busy||frozen||conversation.open||task.active||visit.open} onDetails={details} onOperation={completeTask}/></div></article>}</div>:null;
     }
     return message.kind==='conversation'?(conversation.session?.key===message.id?<NurseConversation key={message.id} workHeld={notes.active||busy} workTurns={messages.filter(row=>row.conversationKey===message.id).map(row=>({id:row.id,at:row.kind==='care-note'?notes.entries.find(entry=>entry.id===row.id)?.at??row.at!:row.at!,node:renderMessage(row)}))} conversation={conversation} locale={l} nurseName={nurseName} onAction={handoffAction} onNotes={showNotes} onRetry={()=>{newest();focus();const data=conversation.session?.data;void (handoffActive&&data?.ok?handoff.send(conversation.reviewedData(data),'',conversation.refresh,conversation.refuseAccess,conversation.invalidateReads):conversation.send('')).then(focus);}}/>:<article key={message.id} className="cv2-msg cv2-zoe"><div><button type="button" className="ncv2-choice" disabled={busy||frozen||handoffActive||task.active||visit.open} onClick={()=>select(message.member,message.id)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{t('Conversation with','Զրույց՝','Разговор с')} {message.member.name??t('Member','Անդամ','Участник')}</button>{messages.filter(row=>row.conversationKey===message.id).map(renderMessage)}</div></article>):<article key={message.id} data-message-key={message.id} className={`cv2-msg ${message.kind==='nurse'?'cv2-me':'cv2-zoe'}`}>
     {message.kind==='nurse'?<div>{message.toZoe&&<p className="cv2-time">{t('To Zoe','Զոյային','Для Зои')}</p>}<p className="cv2-say">{message.text}</p></div>:<div className="cv2-say ncv2-card"><NurseReply reply={message.reply.kind==='measure'&&message.reply.card.state==='confirm'&&message.reply.card.scope!==(conversation.session?.key??null)?{...message.reply,card:{...message.reply.card,state:'expired'}}:message.reply} locale={l} nurseName={nurseName} onSentHandoffs={allHandoffs} onPendingChange={(key,pending)=>alertPending(`${message.id}:${key}`,pending)} onMeasure={action=>void measureAction(message.id,action)} onMember={member=>select(member,message.id)} onChoose={row=>chooseQuestion(message.id,row)} memberHeld={busy||frozen||handoffActive||task.active||visit.open} visits={{disabled:busy||conversation.open||task.active||visit.open,updates:visit.updates,onOpen:openVisit,onAll:message.reply.kind==='today'&&!message.reply.visitsUsed?()=>allVisits(message.id):undefined}} tasks={{hidden:[...task.entries.filter(entry=>Number(entry.id)>Number(message.id)).map(entry=>entry.task.id),...(message.reply.kind==='today'?message.reply.hiddenTasks??[]:[])],updates:task.updates,disabled:busy||conversation.open||handoffActive||task.active||visit.open,onComplete:completeTask,onDetails:item=>details(item,message.id),onAll:message.reply.kind==='today'&&!message.reply.tasksUsed?()=>allTasks('active',undefined,message.id):undefined}}/></div>}
    </article>;
 }
 const voiceReply=staffConversationReply(messages);
 const voiceBlocked=menu||urgent||workHeld||memberComposer||confirmReply;
 const voiceConversation=useConversation({enabled:voiceAvailable,disabled:voiceBlocked,locale:l,audience:'staff',contextKey:`${askMember?.memberId??''}:${zoeMode}:${confirmKey}`,urgentKey:null,
  onTranscript:result=>{setText(result.text);setConfirmReply(false);},onSend:()=>{void send();},
  reply:voiceReply?{key:voiceReply,text:()=>renderedStaffReply(contentRef.current,voiceReply)}:null});
 const initials=nurseName.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('');
 return <main className="cv2-root" lang={l} data-nurse-chat-v2 onClick={()=>handoff.select(null)}>
  <header className="cv2-header"><h1><i className="cv2-orb" aria-hidden/>Noreon</h1><button type="button" className="cv2-avatar" onClick={()=>{focus();setMenu(true);}} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()} aria-label={t('Open menu','Բացել ընտրացանկը','Открыть меню')}><span>{initials||'N'}</span></button></header>
  <button type="button" className="ncv2-urgent" data-nurse-urgent-line onClick={()=>{focus();setUrgent(true);}} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{urgentWords.emergency} <span>{urgentWords.guidance}</span></button>
  <section ref={threadRef} className="cv2-thread" role="log" aria-live="polite" aria-label={t('Your work chat','Ձեր աշխատանքային զրույցը','Ваш рабочий чат')} tabIndex={0}>
   <div ref={contentRef} className="cv2-messages">
    {!messages.length&&<article className="cv2-msg cv2-zoe"><div className="cv2-say ncv2-card">{fragmentReady?<><p>{t('Hello. Start with today or a member’s name.','Բարև։ Սկսեք «Այսօր»-ից կամ անդամի անունից։','Здравствуйте. Начните с «Сегодня» или имени участника.')}</p><button type="button" className="ncv2-choice" onClick={()=>void send(t('Today','Այսօր','Сегодня'))} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{t('Today','Այսօր','Сегодня')}</button><button type="button" className="ncv2-choice" disabled={busy||frozen} onClick={allHandoffs} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{sentHandoffsCopy(l).title}</button></>:<NurseReply reply={{kind:'loading-today'}} locale={l} onMember={()=>{}}/>}</div></article>}
    {messages.filter(message=>!message.conversationKey).map(renderMessage)}
   </div>
  </section>
  <footer className="cv2-bottom">{composerMember&&<div className="ncv2-replying" role="status" aria-live="polite"><ChatMemberIdentity key={composerMember.memberId} memberId={composerMember.memberId} name={composerMember.memberName} locale={l}/></div>}{!conversation.open&&!task.active&&!visit.open&&!notes.active&&<div className="ncv2-replying"><span>{askMember?t(`Asking Zoe about ${askMember.memberName}`,`Հարցնում եք Զոյային ${askMember.memberName}-ի մասին`,`Вопрос Зое об участнике ${askMember.memberName}`):t('Asking Zoe','Հարցնում եք Զոյային','Вопрос Зое')}</span>{askMember&&<button type="button" disabled={busy} aria-label={t('Clear member','Հեռացնել անդամին','Убрать участника')} onClick={()=>{setAskMember(null);setText('');focus();}} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>×</button>}</div>}{unread&&<button type="button" className="cv2-new ncv2-new" onClick={()=>{newest();focus();}} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{t('New message','Նոր հաղորդագրություն','Новое сообщение')}</button>}{visit.open&&<div className="ncv2-replying"><span>{visitComposerLabel(visit,l)}</span><button type="button" disabled={visit.frozen} onClick={()=>taskAction(visit.close)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()} aria-label={t('Close visit','Փակել այցը','Закрыть визит')}>×</button></div>}{task.active&&<div className="ncv2-replying"><span>{taskLabel} · {task.task?taskTitle(task.task,l):''}</span><button type="button" disabled={task.frozen} onClick={()=>taskAction(task.cancel)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()} aria-label={t('Close task note','Փակել առաջադրանքի նշումը','Закрыть заметку к задаче')}>×</button></div>}{notes.active&&<div className="ncv2-replying"><span>{t('Care note for','Խնամքի նշում՝','Заметка об уходе для')} {conversation.session?.member.name}</span><button type="button" disabled={notes.frozen} onClick={()=>taskAction(notes.cancel)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()} aria-label={t('Close care note','Փակել խնամքի նշումը','Закрыть заметку об уходе')}>×</button></div>}{conversation.open&&!notes.active&&<div className="ncv2-replying"><span>{handoffActive?handoffLabel:zoeMode?t(`Asking Zoe about ${conversation.session?.member.name}`,`Հարցնում եք Զոյային ${conversation.session?.member.name}-ի մասին`,`Вопрос Зое об участнике ${conversation.session?.member.name}`):<>{t('Replying to','Պատասխանում եք՝','Ответ для')} {conversation.session?.member.name}</>}</span>{openMember&&<button type="button" className="ncv2-switch" data-zoe-switch={zoeMode?'member':'zoe'} disabled={busy||frozen||conversation.sending||conversation.optimistic.some(reply=>reply.state==='uncertain')||(!zoeMode&&!conversation.session?.data?.ok)} onClick={toggleZoe} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{zoeMode?t('Reply to the member instead','Փոխարենը պատասխանել անդամին','Вместо этого ответить участнику'):t('Ask Zoe instead','Փոխարենը հարցնել Զոյային','Вместо этого спросить Зою')}</button>}<button type="button" disabled={frozen} onClick={closeConversation} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()} aria-label={handoffActive?hcopy.close:t('Close conversation','Փակել զրույցը','Закрыть разговор')}>×</button></div>}{confirmReply&&memberComposer&&!handoffActive&&conversation.session?.data?.ok&&<div className="ncv2-replying ncv2-confirm" data-reply-confirm role="group" aria-label={t('Confirm your reply','Հաստատեք ձեր պատասխանը','Подтвердите ответ')}><span>{t(`Send this reply to ${conversation.session.data.memberName||'the member'}? They will see it in their chat.`,`Ուղարկե՞լ այս պատասխանը՝ ${conversation.session.data.memberName||'անդամին'}։ Նա կտեսնի այն իր զրույցում։`,`Отправить этот ответ${conversation.session.data.memberName?` (${conversation.session.data.memberName})`:''}? Участник увидит его в своём чате.`)}</span><button type="button" className="ncv2-choice" disabled={busy||frozen||conversation.sending} onClick={()=>{setConfirmReply(false);void sendConfirmed();}} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{t('Send to member','Ուղարկել անդամին','Отправить участнику')}</button><button type="button" className="ncv2-choice" onClick={()=>{setConfirmReply(false);focus();}} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{t('Keep editing','Շարունակել խմբագրել','Продолжить редактирование')}</button></div>}
  {task.active&&task.operation==='complete'&&<p className="cv2-time break-words px-2" data-closing-as="complete" aria-live="polite">{closingAsLabel(nurseName,l,visitCopy(l).done)}</p>}
  <form className="cv2-composer" onSubmit={event=>{event.preventDefault();void send();}}>
   <textarea ref={input} rows={1} autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={notes.active?1500:visit.open?1000:task.active||handoffActive?2000:memberComposer?4096:1000} readOnly={notes.active?notes.frozen||notes.blocked:task.active?task.frozen||task.needsRefresh||!task.needsNote:visit.open&&(visit.frozen||!visitTakesWords(visit))||task.frozen||conversation.sending||handoff.sending||(handoffActive&&!handoff.flow?.topic)||(memberComposer&&!conversation.session?.data)} disabled={!notes.active&&((visit.open&&!visitTakesWords(visit))||memberComposer&&(handoff.frozen||conversation.optimistic.some(reply=>reply.state==='uncertain')||(!handoffActive&&conversation.session?.data?.ok&&!conversation.session.data.canSend)))} value={text} onPointerDown={()=>voiceConversation.edit()} onChange={event=>{voiceConversation.edit();setText(event.target.value);setConfirmReply(false);}} aria-label={notes.active?t('Care note','Խնամքի նշում','Заметка об уходе'):visit.open?visitComposerLabel(visit,l):task.active?taskLabel:handoffActive?hcopy.note:zoeMode?t('Ask Zoe','Հարցրեք Զոյային','Спросите Зою'):t('Your message','Ձեր հաղորդագրությունը','Ваше сообщение')} placeholder={notes.active?t('Write a factual note','Գրել փաստական նշում','Написать фактическую заметку'):visit.open?visitComposerHint(visit,l):task.active?taskLabel:handoffActive?handoffLabel:zoeMode?t(`Ask Zoe about ${conversation.session?.member.name}`,`Հարցրեք Զոյային ${conversation.session?.member.name}-ի մասին`,`Спросите Зою об участнике ${conversation.session?.member.name}`):conversation.open?`${t('Reply to','Պատասխան՝','Ответ для')} ${conversation.session?.member.name}`:t('Ask Zoe, today or a member’s name','Հարցրեք Զոյային, այսօր կամ անդամի անունը','Спросите Зою, сегодня или имя участника')}
    onKeyDown={event=>{
     if(event.key!=='Enter'||event.shiftKey||event.nativeEvent.isComposing||event.keyCode===229)return;
     if(!(event.metaKey||event.ctrlKey)&&window.matchMedia('(pointer: coarse)').matches)return;
     event.preventDefault();void send();
    }}/>
   {voiceAvailable&&<ConversationToggle locale={l} conversation={voiceConversation} disabled={voiceBlocked||busy||frozen||(!voiceConversation.active&&!!text.trim())}/>}
   <button type="submit" disabled={busy||notes.frozen||notes.blocked||task.frozen||(visit.open&&(visit.frozen||!visitTakesWords(visit)))||!text.trim()||(!notes.active&&(zoeMode?frozen:conversation.open&&(frozen||!conversation.session?.data?.ok||(handoffActive?!handoff.flow?.topic:!conversation.session.data.canSend))))} aria-label={t('Send','Ուղարկել','Отправить')} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}><ArrowUp size={18} strokeWidth={2.4} aria-hidden/></button>
  </form></footer>
  {urgent&&<NurseUrgentSheet locale={l} onClose={()=>{setUrgent(false);focus();}}/>}
  {menu&&<NurseChatMenu locale={l} onLocale={setLocale} onClose={()=>setMenu(false)} signOutHeld={frozen}/>}
 </main>;
}
