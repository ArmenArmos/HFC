'use client';
import {ConversationToggle,useConversation} from '@/components/chat-v2/conversation';
import {renderedStaffReply,staffConversationReply} from '@/components/staff/voice-reply';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import type {Route} from 'next';
import {ChatMemberIdentity,MemberDisambiguationCard} from '@/components/staff/chat-member-identity';
import type {ChatMemberIdentity as Identity} from '@/lib/staff/chat-member-identity-schema';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {useChatViewport} from '@/components/patient/use-chat-viewport';
import {useThreadScroll} from '@/components/chat-v2/use-thread-scroll';
import {readStaffZoeStream} from '@/lib/staff-zoe/stream';
import {staffZoeRefusal} from '@/lib/staff-zoe/response-copy';
import {typedBoundary} from '@/lib/staff-zoe/typed-boundary';
import {doctorHandoverCopy} from '@/lib/staff-zoe/handover';
import {typedHandover} from '@/lib/staff-zoe/typed-handover';
import {typedReplyText} from '@/lib/staff-zoe/typed-reply';
import {prepareCarePlanIntent} from '@/lib/staff-zoe/home-intent';
import {done,notDone,refreshFailed} from '@/lib/staff-zoe/outcome-copy';
import type {AlertItem} from '@/lib/doctor-inbox/contracts';
import type {EverydayResult} from '@/lib/staff-zoe/everyday-runtime';
import * as actions from '@/lib/staff-zoe/chat-v2-actions';
import {DoctorReply,type Reply,type ThreadMessage} from './messages';
import {MemberConversation,type MemberData,type ReplyStatus} from './conversation';
import {PatientLabs} from './patient-labs';
import {PatientGraphs} from './patient-graphs';
import type {PatientGraphs as GraphData} from '@/lib/staff-zoe/patient-graphs';
import {DoctorChatPlan} from './plan';
import {DoctorChatLab} from './lab';
import {DoctorChatUpload} from './upload';
import {DoctorHandoverCard} from './handover';
import {ResultsBlock} from './results-block';
import type {AlertPress} from './alerts';
import {labValuesChanged} from './lab-review-action';
import {handBackCopy} from '@/lib/staff-zoe/hand-back-copy';

type Props={voiceAvailable?:boolean;focusLabId?:string;focusAlertId?:string;doctorId:string;doctorName:string;member:Identity;locale:StaffLocale;owners:{id:string;name:string;role:'doctor'|'nurse'}[]|null;risk:string|null;planVersion:number|null;resultsReport:boolean};
type Choice={id:string;kind:'open-chat';rows:({id:string;name:string}&Partial<Identity>)[]};
type Message=ThreadMessage|Choice|{id:string;kind:'handover-retry';note:string|null}|{id:string;kind:'patient-labs'}|{id:string;kind:'patient-graphs';data:GraphData};
/** A key is also enforced here for client navigations that reuse this component's position. */
export function PatientChat(props:Props){return <PatientThread key={`${props.doctorId}:${props.member.id}:${props.focusAlertId??''}:${props.focusLabId??''}`} {...props}/>;}
function PatientThread({focusLabId,focusAlertId,doctorId,doctorName,member,locale:l,owners,risk,planVersion,resultsReport,voiceAvailable=false}:Props){
 const router=useRouter(),memberId=member.id,name=member.name??'',target={memberId,memberName:name};
 const [openedAt]=useState(()=>Date.now());
 const [messages,setMessages]=useState<Message[]>([]),[text,setText]=useState(''),[busy,setBusy]=useState(true),[ready,setReady]=useState(false);
 const [replyTo,setReplyTo]=useState<{id:string;data:MemberData}|null>(null),[alertTo,setAlertTo]=useState<{item:AlertItem;press:Exclude<AlertPress,'acknowledge'>}|null>(null);
 const [alerts,setAlerts]=useState<AlertItem[]>([]),[alertsReady,setAlertsReady]=useState(false);
 const [focusDismissed,setFocusDismissed]=useState(false);
 const focusCard=useRef<HTMLElement>(null),focusScrollDone=useRef(false),interacted=useRef(false);
 const focusedAlert=focusDismissed?null:alerts.find(item=>item.alert.id===focusAlertId&&item.memberId===memberId&&item.alert.state!=='resolved');
 const mounted=useRef(false),locked=useRef(false),sequence=useRef(0),turn=useRef<AbortController|null>(null),conversation=useRef<string|null>(null);
 const input=useRef<HTMLTextAreaElement>(null),memberCardId=useRef<string|null>(null),resultsCardId=useRef<string|null>(null),resultsVersion=useRef(0),graphsVersion=useRef(0);
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 useChatViewport(true);
 const {threadRef,contentRef,unread,newest,stopFollowing}=useThreadScroll(messages.map(m=>`${m.id}:${m.kind==='reply'?m.reply.kind:m.kind}`).join('|'));
 // Pause the shared bottom-following hook too, so a resize cannot undo the card jump.
 function noteInteraction(){if((focusAlertId||focusLabId)&&!focusScrollDone.current){interacted.current=true;stopFollowing();}}
 useEffect(()=>{
  if(!(focusAlertId||focusLabId)||busy||(!focusLabId&&!alertsReady)||focusScrollDone.current)return;
  const frame=requestAnimationFrame(()=>{
   focusScrollDone.current=true;
   if(interacted.current||(!focusLabId&&!focusedAlert)||!focusCard.current)return;
   stopFollowing();
   focusCard.current.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  });
  return()=>cancelAnimationFrame(frame);
 },[focusLabId,focusAlertId,busy,alertsReady,focusedAlert,stopFollowing]);
 const next=()=>String(++sequence.current);
 function add(reply:Reply){const id=next();if(mounted.current)setMessages(previous=>[...previous,{id,kind:'reply',reply}]);return id;}
 function replace(id:string,reply:Reply){if(mounted.current)setMessages(previous=>previous.map(m=>m.id===id?{id,kind:'reply',reply}:m));}
 function say(value:string){if(mounted.current)setMessages(previous=>[...previous,{id:next(),kind:'doctor',text:value}]);}
 function failure(){add({kind:'text',text:refreshFailed(l)});}
 const navigate=(id:string)=>router.push(`/staff/real/doctor-chat-v2/patient/${id}` as Route);
 useEffect(()=>{
  mounted.current=true;let active=true;
  void (async()=>{
   // Start with this member's history only. No saved general-chat target is ever read.
   const [history,data,openAlerts]=await Promise.all([
    actions.readDoctorPatientChatHistory(memberId,doctorId).catch(()=>null),
    actions.openDoctorChatMember(memberId,doctorId).catch(()=>null),
    actions.readDoctorPatientChatAlerts(memberId,doctorId).catch(()=>null),
   ]);
   if(!active)return;
   const restored:Message[]=[];
   if(history?.kind==='history'){
    const own=history.conversations.find(c=>c.memberId===memberId);conversation.current=own?.conversationId??null;
    for(const item of history.turns.filter(item=>item.memberId===memberId&&item.conversationId===own?.conversationId))restored.push(item.role==='staff'?{id:item.key,kind:'doctor',text:item.text,toZoe:true,at:item.savedAt}:{id:item.key,kind:'reply',reply:{kind:'zoe-answer',member:target,cards:item.content?.cards??[],content:item.content??undefined},at:item.savedAt});
   }else restored.push({id:next(),kind:'reply',reply:{kind:'history-failed'}});
   // Decision cards can be off while the authorized member chat remains available.
   if(data?.kind==='off')setReady(true);
   else if(data?.kind==='member'&&data.memberId===memberId){memberCardId.current=next();restored.push({id:memberCardId.current,kind:'reply',reply:{kind:'member',data,active:true}});setReady(true);}
   else restored.push({id:next(),kind:'reply',reply:{kind:'conversation-failed'}});
   if(openAlerts?.kind==='alerts'){
    const own=openAlerts.alerts.filter(item=>item.memberId===memberId);setAlerts(own);setAlertsReady(true);
    for(const alert of own)restored.push({id:next(),kind:'reply',reply:{kind:'urgent',alert,active:true}});
   }else restored.push({id:next(),kind:'reply',reply:{kind:'poll-failed'}});
   if(focusLabId&&!interacted.current)restored.push({id:next(),kind:'reply',reply:{kind:'lab',memberId,fileId:focusLabId,name}});
   setMessages(restored);setBusy(false);
   if(!interacted.current)newest();
  })();
  return()=>{active=false;mounted.current=false;turn.current?.abort();turn.current=null;};
 // Each keyed tree owns precisely one member and locale for its lifetime.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[memberId,doctorId]);
 async function work(run:()=>Promise<void>,scroll=true){
  if(locked.current||!mounted.current)return;
  if(scroll)newest();locked.current=true;setBusy(true);
  try{await run();}catch{if(mounted.current)failure();}
  finally{locked.current=false;if(mounted.current)setBusy(false);}
 }
 async function refreshMember(status?:ReplyStatus){
  const data=await actions.openDoctorChatMember(memberId,doctorId);
  if(!mounted.current)return null;
  if(data.kind==='off')return null;
  if(data.kind!=='member'||data.memberId!==memberId){setReady(false);throw Error('Conversation unavailable');}
  const id=memberCardId.current??next();memberCardId.current=id;
  setMessages(previous=>[...previous.filter(m=>m.id!==id),{id,kind:'reply',reply:{kind:'member',data,active:true,status}}]);
  setReady(true);return {id,data};
 }
 async function refreshAlerts(){
  const result=await actions.readDoctorPatientChatAlerts(memberId,doctorId);
  if(!mounted.current)return;
  if(result.kind!=='alerts'){setAlertsReady(false);throw Error('Alerts unavailable');}
  setAlertsReady(true);
  const own=result.alerts.filter(row=>row.memberId===memberId);setAlerts(own);
  setMessages(previous=>previous.filter(m=>!(m.kind==='reply'&&m.reply.kind==='urgent')));
  own.forEach(alert=>add({kind:'urgent',alert,active:true}));
 }
 useEffect(()=>{
  const timer=setInterval(()=>{if(!document.hidden&&!locked.current)void work(async()=>{
   // Refresh the existing card in place; polling never issues fresh approval intents.
   const data=await actions.readDoctorChatConversation(memberId,doctorId);
   if(mounted.current&&data.kind==='member'&&data.memberId===memberId)setMessages(previous=>previous.map(m=>m.kind==='reply'&&m.reply.kind==='member'&&m.reply.active?{...m,reply:{...m.reply,data:{...m.reply.data,thread:data.thread,mode:data.mode,urgentOpen:data.urgentOpen,urgentFailed:data.urgentFailed}}}:m));
   await refreshAlerts();
  },false);},60_000);
  return()=>clearInterval(timer);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[memberId,doctorId]);
 async function results(id?:string){
  if(!resultsReport){add({kind:'text',text:t('Results and reports are not available in this chat yet.','Արդյունքներն ու հաշվետվությունները դեռ հասանելի չեն այս զրույցում։','Результаты и отчёты пока недоступны в этом чате.')});return;}
  const version=++resultsVersion.current,slot=id??resultsCardId.current??add({kind:'loading-member'});resultsCardId.current=slot;
  const block=await actions.readDoctorChatResults(doctorId,memberId);
  if(!mounted.current||version!==resultsVersion.current)return;
  const reply:Reply=block.status==='ready'?{kind:'results',memberId,name,block}:block.status==='identity-checks'?{kind:'identity-checks',rows:block.rows.filter(row=>row.memberId===memberId)}:block.status==='none'?{kind:'results-empty',memberId,name,report:false}:{kind:'results-unavailable'};
  replace(slot,reply);
 }
 useEffect(()=>{const changed=()=>{graphsVersion.current++;setMessages(previous=>previous.filter(m=>m.kind!=='patient-graphs'));};document.addEventListener('noreon:clinical-evidence-changed',changed);return()=>document.removeEventListener('noreon:clinical-evidence-changed',changed);},[]);
 async function overview(){
  const version=++graphsVersion.current;
  const result=await actions.readDoctorPatientGraphs(memberId,doctorId);
  if(!mounted.current||version!==graphsVersion.current)return;
  if(result.kind==='graphs'&&result.data.memberId===memberId){newest();setMessages(previous=>[...previous.filter(m=>m.kind!=='patient-graphs'),{id:next(),kind:'patient-graphs',data:result.data}]);}
  else add({kind:'text',text:t('Graphs could not be read. Try At a glance again.','Չհաջողվեց կարդալ գծապատկերները։ Կրկին բացեք «Մի հայացքով»։','Не удалось прочитать графики. Откройте «Кратко» снова.')});
 }
 async function handover(note:string|null=null){
  const data=await actions.prepareDoctorChatHandover(memberId,doctorId).catch(()=>({kind:'unavailable' as const}));
  if(!mounted.current)return;
  if(data.kind==='handover'&&data.target.memberId===memberId)add({kind:'nurse-handover',target:data.target,note});
  else if(data.kind==='no_nurse'||data.kind==='no_conversation'){const copy=doctorHandoverCopy(l);add({kind:'text',text:data.kind==='no_nurse'?copy.noNurse:copy.noConversation});}
  else if(data.kind==='unavailable')setMessages(previous=>[...previous,{id:next(),kind:'handover-retry',note}]);
  else failure();
 }
 function openPlan(prepare=false,again=false){
  if(prepare&&!alertsReady){failure();return;}
  const id=next();newest();
  setMessages(previous=>{
   const existing=previous.find(m=>m.kind==='reply'&&m.reply.kind==='plan');
   if(existing&&!prepare&&!again)return [...previous.filter(m=>m!==existing),existing];
   return [...previous.filter(m=>m!==existing),{id,kind:'reply',reply:{kind:'plan',memberId,name,aiDraft:false,...(prepare?{prepareRequest:crypto.randomUUID()}:{})}}];
  });
 }
 function openLabs(){
  newest();setMessages(previous=>{const existing=previous.find(m=>m.kind==='patient-labs');return [...previous.filter(m=>m!==existing),existing??{id:next(),kind:'patient-labs'}];});
 }
 function openLab(id:string,fileId:string){if(id===memberId)add({kind:'lab',memberId,fileId,name});}
 function openUpload(id:string,documentId:string){if(id===memberId)add({kind:'upload',memberId,documentId,name});}
 async function actAlert(item:AlertItem,press:AlertPress,note?:string){
  if(item.memberId!==memberId)return;
  if(item.alert.id===focusAlertId)setFocusDismissed(true);
  if(press!=='acknowledge'&&!note){setReplyTo(null);setAlertTo({item,press});setText('');input.current?.focus();return;}
  const raw={alertId:item.alert.id,seq:item.alert.stateSeq};
  let result:EverydayResult;
  try{result=await (press==='acknowledge'?actions.acknowledgeDoctorChatAlert(raw,doctorId):actions.resolveDoctorChatAlert({...raw,resolution:press,note},doctorId));}catch{result={kind:'unavailable'};}
  if(!mounted.current)return;
  add({kind:'alert-outcome',alert:item,result});
  if(result.kind==='saved'||result.kind==='already_resolved'){setAlertTo(null);setText('');}
  else if(press!=='acknowledge'){setReplyTo(null);setAlertTo({item,press});setText(note??'');}
  await refreshAlerts();
 }
 async function approve(id:string,data:MemberData){
  const card=data.reply?.card;if(!card||data.memberId!==memberId)return;
  let status:ReplyStatus='outcome-unknown';
  try{const r=await actions.approveDoctorChatReply({schema:1,purpose:'reply.approve',intentId:card.intentId,requestId:card.requestId},{memberId,modeRevision:card.modeRevision},doctorId);status=r.ok?'queued':`approval:${r.code}`;}catch{}
  replace(id,{kind:'member',data,active:false,status});
  if(status==='queued')say(card.body);
  await refreshMember(status);
 }
 async function saveReply(value:string){
  const draft=replyTo;if(!draft)return;
  const {data,id}=draft,card=data.reply?.card,prepare=data.reply?.prepare;if(!prepare)return;
  let status:ReplyStatus='outcome-unknown';
  try{
   const r=card?await actions.reviseDoctorChatReply(memberId,{expectedVersion:prepare.expectedVersion,expectedRevision:card.revision,expectedContentHash:card.contentHash,body:value},doctorId):await actions.composeDoctorChatReply({...prepare,requestId:crypto.randomUUID(),body:value,summary:t('No private summary added.','Գաղտնի ամփոփում չի ավելացվել։','Внутренняя сводка не добавлена.')},doctorId);
   status=r.ok?'saved':r.code==='refused'?'access':r.code.includes('stale')?'stale':'unavailable';
  }catch{}
  if(!mounted.current)return;
  replace(id,{kind:'member',data,active:false,status});
  if(status==='saved'){say(value);setReplyTo(null);setText('');await refreshMember('saved');}
  else if(status==='outcome-unknown')setReplyTo(null);
  else{const fresh=await refreshMember(status);if(fresh)setReplyTo(fresh);}
 }
 async function ask(value:string){
  const id=add({kind:'zoe-loading',member:target,cards:[]});
  const controller=new AbortController();turn.current=controller;
  const current=()=>mounted.current&&!controller.signal.aborted&&turn.current===controller;
  try{
   if(!conversation.current){const r=await actions.openDoctorChatZoe(memberId,doctorId);if(!current())return;if(!r.ok)throw Error('Zoe unavailable');conversation.current=r.conversationId;}
   const response=await fetch(`/staff/real/doctor-chat-v2/patient/${memberId}/ask`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:conversation.current,submissionId:crypto.randomUUID(),text:value,intent:null,locale:l}),signal:controller.signal});
   if(!current()){await response.body?.cancel();return;}
   let cards:import('@/lib/staff-zoe/contracts').ToolResult[]=[];
   await readStaffZoeStream(response,event=>{if(!current())return;
    if(event.type==='cards'){cards=event.cards;replace(id,{kind:'zoe-cards',member:target,cards});}
    if(event.type==='answer')replace(id,{kind:'zoe-answer',member:target,cards,content:event.content});
    if(event.type==='refused')replace(id,{kind:'zoe-error',member:target,cards,error:staffZoeRefusal(event.code,l)});
   },controller.signal);
  }catch{if(current())replace(id,{kind:'zoe-error',member:target,cards:[],error:staffZoeRefusal('unavailable',l)});}
  finally{if(turn.current===controller)turn.current=null;}
 }
 async function send(){
  const value=text.trim();if(!value||!ready)return;
  voiceConversation.sent();
  await work(async()=>{
   if(alertTo){await actAlert(alertTo.item,alertTo.press,value);return;}
   if(replyTo){await saveReply(value);return;}
   setText('');say(value);
   // Resolve before every typed action too: another name can never issue a reply, plan or handover intent here.
   const found=await actions.findDoctorChatQuestionMember(value,doctorId,target);
   if(!mounted.current)return;
   if(found.kind==='member'&&found.memberId!==memberId||found.kind==='choose'){
    const rows=found.kind==='choose'?found.rows:[{...found.identity,id:found.memberId,name:found.memberName}];
    setMessages(previous=>[...previous,{id:next(),kind:'open-chat',rows}]);return;
   }
   if(found.kind!=='keep'&&!(found.kind==='member'&&found.memberId===memberId)){add({kind:'text',text:t('The member could not be confirmed. Try again.','Չհաջողվեց հաստատել անդամին։ Փորձեք կրկին։','Не удалось определить участника. Попробуйте ещё раз.')});return;}
   const transfer=typedHandover(value);if(transfer){await handover(transfer.note);return;}
   const draft=typedReplyText(value);if(draft){const fresh=await refreshMember();if(fresh&&!fresh.data.replyFailed&&fresh.data.reply?.prepare){setReplyTo(fresh);setText(draft);input.current?.focus();}return;}
   if(prepareCarePlanIntent(value)){openPlan(true);return;}
   const boundary=typedBoundary(value);if(boundary){add({kind:'text',text:notDone(`boundary-${boundary==='reject'?'approve':boundary}`,l)});return;}
   await ask(value);
  });
 }
 async function retry(id:string){const result=await actions.retryDoctorChatDelivery(id,doctorId);if(result.ok)await refreshMember();return result;}
 function invalidateLabs(){
  turn.current?.abort();
  setMessages(previous=>previous.map(m=>m.kind==='reply'&&m.reply.kind.startsWith('zoe-')?{id:m.id,kind:'reply',reply:{kind:'text',text:labValuesChanged(l)}}:m));
 }
 const labels:Record<string,string>={very_high:t('Very high risk','Շատ բարձր ռիսկ','Очень высокий риск'),high:t('High risk','Բարձր ռիսկ','Высокий риск'),moderate:t('Moderate risk','Միջին ռիսկ','Умеренный риск'),low:t('Low risk','Ցածր ռիսկ','Низкий риск')};
 const placeholder=replyTo?t(`Reply to ${name}`,`Պատասխանել ${name}-ին`,`Ответить: ${name}`):alertTo?t('Write the reason for closing this alert','Գրեք ահազանգը փակելու պատճառը','Напишите причину закрытия оповещения'):t(`Ask Zoe about ${name}`,`Հարցրեք Զոյային ${name}-ի մասին`,`Спросите Зою об участнике ${name}`);
 const voiceReply=staffConversationReply(messages);
 const voiceBlocked=!ready||!!replyTo||!!alertTo;
 const voiceConversation=useConversation({enabled:voiceAvailable,disabled:voiceBlocked,locale:l,audience:'staff',contextKey:memberId,urgentKey:null,
  onTranscript:result=>setText(result.text),onSend:()=>{void send();},
  reply:voiceReply?{key:voiceReply,text:()=>renderedStaffReply(contentRef.current,voiceReply)}:null});
 function render(m:Message){
  if(m.kind==='handover-retry')return <><p role="alert">{doctorHandoverCopy(l).prepareFailed}</p><button type="button" className="dcv2-choice" disabled={busy} onClick={()=>void work(()=>handover(m.note))}>{t('Try again','Փորձել կրկին','Попробовать снова')}</button></>;
  if(m.kind==='doctor')return <p className="cv2-say">{m.text}</p>;
  if(m.kind==='patient-graphs')return <PatientGraphs data={m.data} memberId={memberId} locale={l}/>;
  if(m.kind==='patient-labs')return <PatientLabs memberId={memberId} name={name} doctorId={doctorId} locale={l} resultsReport={resultsReport} onLab={fileId=>router.push(`/staff/real/doctor-chat-v2/patient/${memberId}?lab=${fileId}` as Route)} onUpload={fileId=>openUpload(memberId,fileId)}/>;
  if(m.kind==='open-chat')return <div data-open-patient-chat><p>{m.rows.length===1?t(`Open ${m.rows[0].name}'s chat to ask this`,`Այս հարցը տալու համար բացեք ${m.rows[0].name}-ի զրույցը։`,`Чтобы задать этот вопрос, откройте чат участника ${m.rows[0].name}.`):t('Open the member’s chat to ask this.','Այս հարցը տալու համար բացեք անդամի զրույցը։','Чтобы задать этот вопрос, откройте чат участника.')}</p><MemberDisambiguationCard rows={m.rows} locale={l} actionLabel={t('Open chat','Բացել զրույցը','Открыть чат')} onChoose={row=>navigate(row.id)}/></div>;
  const r=m.reply;
  if(r.kind==='member')return <MemberConversation data={r.data} locale={l} active={r.active} busy={busy} editing={replyTo?.id===m.id} status={r.status} onApprove={()=>void work(()=>approve(m.id,r.data))} onChange={()=>{setAlertTo(null);setReplyTo({id:m.id,data:r.data});setText(r.data.reply?.card?.body??'');input.current?.focus();}} onRetry={retry} onPlan={()=>openPlan()} onHandover={()=>void work(()=>handover())} onUploads={()=>r.data.uploads?.forEach(doc=>openUpload(memberId,doc.documentId))} onIdentityCheck={row=>openLab(row.memberId,row.fileId)} onHandBack={()=>void work(async()=>{
   const result=await actions.handBackDoctorChat({memberId,version:r.data.version,modeRevision:r.data.modeRevision},doctorId);
   let words=handBackCopy(result.kind==='zoe_inactive'?'inactive':result.kind==='off'?'off':result.kind==='refused'?'access':result.kind==='changed'?'changed':'unknown',l);
   try{const fresh=await refreshMember();if(result.kind==='saved'&&fresh)words=handBackCopy(fresh.data.mode.doctorMode?'changed':!fresh.data.mode.zoeActive?'inactive':'saved',l);}
   catch{if(result.kind==='saved')words=handBackCopy('unread',l);}
   add({kind:'text',text:words});
  })}/>;
  if(r.kind==='plan')return <div className="dcv2-plan-slot">{!alertsReady&&<div><p role="alert">{t('Alerts could not be checked. Check again before reviewing the plan.','Չհաջողվեց ստուգել ահազանգերը։ Պլանը վերանայելուց առաջ կրկին ստուգեք։','Не удалось проверить оповещения. Повторите проверку перед просмотром плана.')}</p><button type="button" className="dcv2-choice" disabled={busy} onClick={()=>void work(refreshAlerts)}>{t('Check again','Ստուգել կրկին','Проверить снова')}</button></div>}<fieldset disabled={!alertsReady} className="dcv2-plan-slot"><DoctorChatPlan onReviewLabs={openLabs} memberId={memberId} name={name} doctorId={doctorId} locale={l} aiDraft={r.aiDraft} prepareRequest={r.prepareRequest} alerts={alerts} recent={messages.flatMap(m=>m.kind==='reply'&&m.reply.kind==='member'?m.reply.data.thread.filter(entry=>entry.who==='member'&&Date.parse(entry.at)>=openedAt-48*60*60*1000):[]).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,3)} onSaved={(decision,reply)=>{say(decision);add({kind:'text',text:reply});router.refresh();}} onCheckAgain={()=>openPlan(false,true)} onOpen={id=>{if(id!==memberId)navigate(id);}} onAction={say}/></fieldset></div>;
  if(r.kind==='nurse-handover')return <DoctorHandoverCard target={r.target} note={r.note} doctorId={doctorId} locale={l}/>;
  if(r.kind==='upload')return <DoctorChatUpload memberId={memberId} documentId={r.documentId} doctorId={doctorId} locale={l} onApproved={reply=>{document.dispatchEvent(new Event('noreon:clinical-evidence-changed'));replace(m.id,{kind:'text',text:reply});void work(async()=>{await refreshMember();await results();});}}/>;
  if(r.kind==='lab')return <DoctorChatLab inline memberId={memberId} fileId={r.fileId} doctorId={doctorId} locale={l} resultsReport={resultsReport} onResults={()=>void work(()=>results())} onReviewed={words=>{invalidateLabs();add({kind:'text',text:words});}} onIdentityConfirmed={(id,fileId)=>{if(id!==memberId)return;invalidateLabs();setMessages(previous=>previous.map(m=>m.kind==='reply'&&m.reply.kind==='member'?{...m,reply:{...m.reply,data:{...m.reply.data,identityChecks:m.reply.data.identityChecks?.filter(row=>row.fileId!==fileId)}}}:m));}}/>;
  if(r.kind==='results')return <ResultsBlock block={r.block} name={name} locale={l} onRefresh={()=>results(m.id)} onSaved={async words=>{say(words);await results(m.id);}} onApproved={version=>{resultsVersion.current++;replace(m.id,{kind:'text',text:done('report-approved',l,String(version))});}} onStale={()=>results(m.id)}/>;
  return <DoctorReply reply={r} locale={l} doctorId={doctorId} busy={busy} closer={doctorName} onOpen={id=>{if(id===memberId)void work(async()=>{await refreshMember();});else navigate(id);}} onAct={(item,press,note)=>void work(()=>actAlert(item,press,note))} onCheck={()=>void work(refreshAlerts)} onLab={openLab} onPlan={()=>openPlan()} onUpload={openUpload} onResults={()=>void work(()=>results())}/>;
 }
 return <main lang={l} className="cv2-root dcv2-root dcv2-patient" data-patient-chat={memberId} onWheelCapture={noteInteraction} onTouchStartCapture={noteInteraction} onPointerDownCapture={noteInteraction} onKeyDownCapture={noteInteraction} onInputCapture={noteInteraction}>
  <header className="dcv2-patient-header" data-patient-header={memberId}>
   <button type="button" className="dcv2-choice" onClick={()=>router.push('/staff/real/doctor-chat-v2')}>← {t('Patients','Անդամներ','Участники')}</button>
   <h1><ChatMemberIdentity memberId={memberId} name={name} member={member} locale={l}/></h1>
   <div className="dcv2-controls">{risk&&labels[risk]&&<span className="dcv2-tag">{labels[risk]}</span>}{planVersion!==null&&<span className="dcv2-tag">{t(`Plan v${planVersion}`,`Պլան v${planVersion}`,`План v${planVersion}`)}</span>}</div>
   <p className="dcv2-time" data-care-team>{owners===null?t('Care team unavailable','Խնամքի թիմն անհասանելի է','Команда сопровождения недоступна'):owners.length?owners.map(owner=>`${owner.name} · ${owner.role==='doctor'?t('Doctor','Բժիշկ','Врач'):t('Nurse','Բուժքույր','Медсестра')}`).join(' · '):t('Care team not recorded','Խնամքի թիմը գրանցված չէ','Команда сопровождения не указана')}</p>
  </header>
  <section className="cv2-thread" ref={threadRef} role="log" aria-label={t('Member chat','Անդամի զրույց','Чат участника')}><div className="cv2-messages" ref={contentRef}>
   {!messages.length&&<p role="status">{t('Loading…','Բեռնվում է…','Загрузка…')}</p>}
   {messages.map(m=>{
    const marked=m.kind==='reply'&&((!!focusedAlert&&m.reply.kind==='urgent'&&m.reply.alert.alert.id===focusedAlert.alert.id)||(!focusDismissed&&m.reply.kind==='lab'&&m.reply.fileId===focusLabId));
    return <article key={m.id} data-message-key={m.id} ref={marked?focusCard:undefined} aria-current={marked?'true':undefined} onClickCapture={marked?()=>setFocusDismissed(true):undefined} className={`cv2-msg ${m.kind==='doctor'?'cv2-me':'cv2-zoe'}${marked?' dcv2-notice-alert':''}`}>
     {marked&&<p className="dcv2-tag">{t('From your notification','Ձեր ծանուցումից','Из вашего уведомления')}</p>}{render(m)}
    </article>;
   })}
  </div></section>
  <footer className="cv2-bottom">
   {unread&&<button type="button" className="dcv2-choice" onClick={newest}>{t('Newest messages','Վերջին հաղորդագրությունները','Последние сообщения')}</button>}
   <div className="dcv2-controls dcv2-patient-chips">
    <button type="button" className="dcv2-choice" disabled={busy||!ready||!!replyTo||!!alertTo} onClick={()=>void work(overview)}>{t('At a glance','Մի հայացքով','Кратко')}</button>
    <button type="button" className="dcv2-choice" disabled={busy||!ready||!!replyTo||!!alertTo} onClick={openLabs}>{t('Labs','Լաբորատոր արդյունքներ','Анализы')}</button>
    <button type="button" className="dcv2-choice" disabled={busy||!ready||!!replyTo||!!alertTo} onClick={()=>openPlan()}>{t('Plan','Պլան','План')}</button>
    <button type="button" className="dcv2-choice" disabled={busy||!ready||!!replyTo||!!alertTo} onClick={()=>void work(async()=>{await refreshMember();})}>{t('Messages','Հաղորդագրություններ','Сообщения')}</button>
    <button type="button" className="dcv2-choice" disabled={busy||!ready||!!replyTo||!!alertTo} onClick={()=>void work(()=>handover())}>{t('Hand over','Փոխանցել','Передать')}</button>
   </div>
   {(replyTo||alertTo)&&<div className="dcv2-ask-bar"><span>{placeholder}</span><button type="button" onClick={()=>{setReplyTo(null);setAlertTo(null);setText('');}}>{t('Cancel','Չեղարկել','Отмена')}</button></div>}
   <form className="cv2-composer" onSubmit={event=>{event.preventDefault();void send();}}><textarea ref={input} value={text} autoComplete="off" autoCorrect="off" autoCapitalize="sentences" spellCheck={false} maxLength={replyTo?8000:1000} aria-label={placeholder} placeholder={placeholder} onPointerDown={()=>voiceConversation.edit()} onChange={event=>{voiceConversation.edit();setText(event.target.value);}} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}}/>{voiceAvailable&&<ConversationToggle locale={l} conversation={voiceConversation} disabled={voiceBlocked||busy||(!voiceConversation.active&&!!text.trim())}/>}<button type="submit" disabled={busy||!ready||!text.trim()} aria-label={replyTo?t('Save reply','Պահպանել պատասխանը','Сохранить ответ'):t('Ask Zoe','Հարցնել Զոյային','Спросить Зою')}>↑</button></form>
  </footer>
 </main>;
}
