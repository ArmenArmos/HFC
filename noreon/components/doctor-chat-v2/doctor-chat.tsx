'use client';
import {ConversationToggle,useConversation} from '@/components/chat-v2/conversation';
import {renderedStaffReply,staffConversationReply} from '@/components/staff/voice-reply';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import type {Route} from 'next';
import {ArrowUp} from 'lucide-react';
import {useChatViewport} from '@/components/patient/use-chat-viewport';
import {useThreadScroll} from '@/components/chat-v2/use-thread-scroll';
import {StaffChatMenu} from '@/components/chat-v2/staff-menu';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {typedLanguage} from '@/lib/staff-zoe/typed-language';
import {typedBoundary} from '@/lib/staff-zoe/typed-boundary';
import {notDone} from '@/lib/staff-zoe/outcome-copy';
import {smallTalk,smallTalkLines} from '@/lib/staff-zoe/small-talk';
import {workspaceIntent} from '@/lib/staff-zoe/home-intent';
import {readDoctorChatApprovals,readDoctorChatPanel,searchDoctorChatMembers,findDoctorChatQuestionMember} from '@/lib/staff-zoe/chat-v2-actions';
import {readDoctorHome} from '@/lib/staff-zoe/home-actions';
import type {DoctorPanel,PanelResponse} from '@/lib/staff-zoe/panel';
import type {ChatMemberIdentity} from '@/lib/staff/chat-member-identity-schema';
import {mergeUrgent} from '@/lib/doctor-inbox/urgent-windows';
import {DoctorTelegramMenu} from './telegram-menu';
import {DoctorReply,type Reply,type ThreadMessage} from './messages';
import {PatientsCard} from './patients-card';
import {PanelGraphs} from './panel-graphs';
import {OpenPatientChatChoice} from './open-patient-chat-choice';
type Message=ThreadMessage|{id:string;kind:'open-chat';rows:({id:string;name:string}&Partial<ChatMemberIdentity>)[];locale:StaffLocale};
/** General Zoe owns only portfolio work. Every member control leaves this thread. */
export function DoctorChatV2({locale,doctorId,doctorName,telegram,voiceAvailable=false}:{voiceAvailable?:boolean;resultsReport?:boolean;telegram?:{connected:boolean}|null;locale:StaffLocale;doctorId:string;doctorName:string}){
 const router=useRouter();
 const navigateMember=(memberId:string)=>router.push(`/staff/real/doctor-chat-v2/patient/${memberId}` as Route);
 const [l,setLocale]=useState(locale),[menu,setMenu]=useState(false),[text,setText]=useState('');
 const [findHint,setFindHint]=useState(false);
 const [telegramState,setTelegramState]=useState(telegram),[messages,setMessages]=useState<Message[]>([]),[busy,setBusy]=useState(false);
 const [panel,setPanel]=useState<DoctorPanel|null>(null),[panelState,setPanelState]=useState<'closed'|'loading'|'failed'|'ready'>('closed');
 const [memberIds,setMemberIds]=useState<string[]|null>(null);
 const mounted=useRef(true),locked=useRef(false),sequence=useRef(0),input=useRef<HTMLTextAreaElement>(null);
 const [voiceTurn,setVoiceTurn]=useState<string|null>(null);
 const summaryRead=useRef<Promise<PanelResponse>|null>(null),announced=useRef(new Set<string>());
 const [replyLanguages,setReplyLanguages]=useState(()=>new Map<string,StaffLocale>());
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const searchHint=t('Ask Zoe, or find a member by name, phone ending or date of birth','Հարցրեք Զոյային կամ գտեք անդամին անունով, հեռախոսի վերջին նիշերով կամ ծննդյան ամսաթվով','Спросите Зою или найдите участника по имени, последним цифрам телефона или дате рождения');
 useChatViewport(true);
 const {threadRef,contentRef,unread,newest}=useThreadScroll(messages.map(m=>`${m.id}:${m.kind==='reply'?m.reply.kind:m.kind}`).join('|')+panelState+String(memberIds));
 useLayoutEffect(()=>{const field=input.current;if(!field)return;field.style.height='auto';field.style.height=`${Math.min(field.scrollHeight,parseFloat(getComputedStyle(field).lineHeight)*5)}px`;},[text]);
 const next=()=>String(++sequence.current);
 function replace(id:string,reply:Reply){if(mounted.current)setMessages(previous=>previous.map(m=>m.id===id?{id,kind:'reply',reply}:m));}
 async function summary(){
  const read=summaryRead.current??=readDoctorChatPanel(doctorId,'summary');
  try{return await read;}finally{if(summaryRead.current===read)summaryRead.current=null;}
 }
 useEffect(()=>{
  mounted.current=true;let active=true,running=false,failed=false;
  async function poll(){
   if(document.hidden||running)return;running=true;
   try{
    const result=await summary();if(!active)return;
    if(result.kind!=='panel')throw Error('Portfolio unavailable');
    const who=result.who;
    if(who.urgentIncomplete){if(!failed)setMessages(previous=>[...previous,{id:next(),kind:'reply',reply:{kind:'poll-failed'}}]);failed=true;}else failed=false;
    const fresh=mergeUrgent(who.alerts,who.windows).filter(item=>!announced.current.has(item.kind==='urgent_window'?`window:${item.memberId}:${item.since}`:item.id));
    for(const item of fresh)announced.current.add(item.kind==='urgent_window'?`window:${item.memberId}:${item.since}`:item.id);
    const complete=!who.incomplete&&!who.capped;
    setMessages(previous=>[...previous.flatMap<Message>(message=>{
     if(message.kind!=='reply')return [message];
     const reply=message.reply;
     if(reply.kind==='urgent-window')return complete&&!who.windows.some(w=>w.memberId===reply.window.memberId)?[]:[message];
     if(reply.kind==='urgent'){
      const alert=who.alerts.find(a=>a.id===reply.alert.id);
      return alert?[{...message,reply:{...reply,alert}}]:complete?[]:[message];
     }
     if(reply.kind==='who'||reply.kind==='alerts'){
      const alerts=complete?who.alerts:[...who.alerts,...reply.alerts.filter(a=>!who.alerts.some(n=>n.id===a.id))];
      const windows=complete?who.windows:[...who.windows,...reply.windows.filter(w=>!who.windows.some(n=>n.memberId===w.memberId))];
      return [{...message,reply:{...reply,alerts,windows,p0Total:mergeUrgent(alerts,windows).length,missing:who.missing??[],urgentIncomplete:who.urgentIncomplete,incomplete:who.incomplete,capped:who.capped}}];
     }
     return [message];
    }),...fresh.map(item=>({id:next(),kind:'reply' as const,reply:item.kind==='urgent_window'?{kind:'urgent-window' as const,window:item,active:true}:{kind:'urgent' as const,alert:item,active:true}}))]);
   }catch{if(active&&!failed){failed=true;setMessages(previous=>[...previous,{id:next(),kind:'reply',reply:{kind:'poll-failed'}}]);}}
   finally{running=false;}
  }
  void poll();const timer=setInterval(()=>void poll(),60_000);
  const visible=()=>{if(!document.hidden)void poll();};document.addEventListener('visibilitychange',visible);
  return()=>{active=false;mounted.current=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 // The summary promise is shared across React's mount-effect replay.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[doctorId]);
 async function showPatients(){
  setPanelState('loading');setMemberIds(null);newest();
  try{const result=await readDoctorChatPanel(doctorId,'full');if(!mounted.current)return;if(result.kind==='panel'){setPanel(result);setPanelState('ready');}else setPanelState('failed');}
  catch{if(mounted.current)setPanelState('failed');}
 }
 async function send(raw=text){
  const value=raw.trim();if(!value||locked.current)return;
  voiceConversation.sent();
  locked.current=true;setBusy(true);setText('');newest();
  const id=next(),language=typedLanguage(value,l),talk=smallTalk(value),intent=workspaceIntent(value);
  setVoiceTurn(id);
  setReplyLanguages(previous=>new Map(previous).set(id,language));
  setMessages(previous=>[...previous,{id:next(),kind:'doctor',text:value},{id,kind:'reply',reply:{kind:'loading-search'}}]);
  try{
   if(talk){replace(id,{kind:'small-talk',lines:smallTalkLines(talk,'doctor',language)});return;}
   const boundary=typedBoundary(value);
   const who=intent.kind==='today'||['who needs me','ո՞ւմ է պետք իմ օգնությունը','кому нужна моя помощь'].includes(value.toLowerCase().replace(/\?$/u,''));
   if(who||intent.kind==='alerts'){
    const result=await summary();if(!mounted.current)return;
    if(result.kind!=='panel'){replace(id,{kind:'unavailable'});return;}
    const q=result.who;
    replace(id,who?{kind:'who',...q,missing:q.missing??[]}:{kind:'alerts',alerts:q.alerts,windows:q.windows,p0Total:q.p0Total,capped:q.capped,windowsCapped:q.capped,urgentIncomplete:q.urgentIncomplete,incomplete:q.incomplete,missing:q.missing??[],asOf:q.asOf});return;
   }
   if(intent.kind==='approvals_history'){
    try{const result=await readDoctorChatApprovals(intent.day,doctorId);replace(id,result.kind==='unavailable'?{kind:'approvals-unavailable'}:result);}
    catch{replace(id,{kind:'approvals-unavailable'});}return;
   }
   if(intent.kind==='missing_bp'||intent.kind==='overdue'){
    const result=await readDoctorHome(intent.kind==='missing_bp'?{kind:'missing_bp',query:'',cursor:null}:{kind:'day'},doctorId);
    replace(id,result.kind==='missing_bp'?result:result.kind==='day'?{kind:'overdue',day:result.day}:result.kind==='refused'?result:{kind:'unavailable'});return;
   }
   if(intent.kind==='dashboard'||intent.kind==='members'&&!intent.query){replace(id,{kind:'text',text:st(language,'Your assigned members are listed below.','Ձեզ նշանակված անդամները ստորև են։','Назначенные вам участники показаны ниже.')});await showPatients();return;}
   const bareName=value.length>=2&&value.length<=100&&value.split(/\s+/u).length<=4&&/^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]*$/u.test(value)&&! /^(who|which|what|how|why|can|does|did|is|are|tell|show|ask|read|кто|какие|как|почему|что|расскажи|ինչ|ով|ո՞վ|ո՞ր|ինչու|պատմիր)(?:\s|$)/iu.test(value);
   // Recognize only the shape. The server owns date validity and search limits.
   const bareDob=/^(?:[0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})$/u.test(value);
   const barePhone=/^[0-9\s+()\-]+$/u.test(value)&&value.replace(/\D/gu,'').length>=3;
   if(bareDob||barePhone||intent.kind==='members'||intent.kind==='unsupported'&&bareName&&!boundary){
    const result=await searchDoctorChatMembers(bareDob||barePhone?value:intent.kind==='members'?intent.query:value,doctorId);if(!mounted.current)return;
    if(result.kind==='members'){
     if(result.rows.length===1&&!result.hasMore&&!result.requiresChoice)navigateMember(result.rows[0].id);
     replace(id,result);return;
    }
    if(result.kind==='invalid')replace(id,{kind:'text',text:bareDob?
     st(language,'Enter a valid date of birth.','Մուտքագրեք ծննդյան վավեր ամսաթիվ։','Введите корректную дату рождения.'):
     st(language,'Enter a name, at least four phone digits or a date of birth. Use no more than 100 characters.','Մուտքագրեք անուն, հեռախոսի առնվազն չորս նիշ կամ ծննդյան ամսաթիվ։ Առավելագույնը՝ 100 նիշ։','Введите имя, не менее четырёх цифр телефона или дату рождения. Не более 100 символов.')});
    else replace(id,{kind:'search-failed'});return;
   }
   const found=await findDoctorChatQuestionMember(value,doctorId);if(!mounted.current)return;
   if(found.kind==='member'||found.kind==='choose'){
    const rows=found.kind==='choose'?found.rows:[{...found.identity,id:found.memberId,name:found.memberName}];
    setMessages(previous=>previous.map(m=>m.id===id?{id,kind:'open-chat',rows,locale:language}:m));
   }else if(boundary)replace(id,{kind:'text',text:notDone(`boundary-${boundary==='reject'?'approve':boundary}`,language)});
   else replace(id,{kind:'text',text:st(language,'Ask about your panel here. Open a member’s chat for questions about their record.','Այստեղ հարցրեք ձեր անդամների խմբի մասին։ Անդամի տվյալների մասին հարցերի համար բացեք նրա զրույցը։','Здесь можно спросить о ваших участниках в целом. Для вопросов о записи участника откройте его чат.')});
  }catch{replace(id,{kind:'unavailable'});}
  finally{locked.current=false;if(mounted.current)setBusy(false);}
 }
 const voiceReply=staffConversationReply(messages,voiceTurn);
 const voiceConversation=useConversation({enabled:voiceAvailable,disabled:menu,locale:l,audience:'staff',contextKey:doctorId,urgentKey:null,
  onTranscript:result=>setText(result.text),onSend:()=>{void send();},
  reply:voiceReply?{key:voiceReply,text:()=>renderedStaffReply(contentRef.current,voiceReply),locale:replyLanguages.get(voiceReply)??l}:null});
 const initials=doctorName.trim().split(/\s+/u).slice(0,2).map(part=>part[0]).join('');
 return <main className="cv2-root" lang={l} data-doctor-chat-v2>
  <header className="cv2-header"><h1><i className="cv2-orb" aria-hidden/>Noreon</h1><button type="button" className="cv2-avatar" onClick={()=>setMenu(true)} aria-label={t('Open menu','Բացել ընտրացանկը','Открыть меню')}><span>{initials||'N'}</span></button></header>
  <section ref={threadRef} className="cv2-thread" role="log" aria-live="polite" aria-label={t('Your work chat','Ձեր աշխատանքային զրույցը','Ваш рабочий чат')} tabIndex={0} data-zoe-thread><div ref={contentRef} className="cv2-messages">
   <article className="cv2-msg cv2-zoe"><p className="cv2-say">{t(`Hello, ${doctorName}. Who needs you today?`,`Բարև, ${doctorName}։ Ո՞ւմ է այսօր պետք ձեր օգնությունը։`,`Здравствуйте, ${doctorName}. Кому сегодня нужна ваша помощь?`)}</p><div className="dcv2-patient-chips">{[t('Who needs me','Ո՞ւմ է պետք իմ օգնությունը','Кому нужна моя помощь'),t('Alerts','Ահազանգեր','Оповещения')].map(label=><button type="button" className="dcv2-choice" key={label} disabled={busy} onClick={()=>void send(label)}>{label}</button>)}<button type="button" className="dcv2-choice" disabled={busy} onClick={()=>{setFindHint(true);input.current?.focus();}}>{t('Find a member','Գտնել անդամին','Найти участника')}</button><button type="button" className="dcv2-choice" disabled={busy} onClick={()=>void showPatients()}>{t('Patients','Անդամներ','Участники')}</button></div></article>
   {messages.map(message=><article key={message.id} data-message-key={message.id} className={`cv2-msg ${message.kind==='doctor'?'cv2-me':'cv2-zoe'}`}>
    {message.kind==='doctor'?<p className="cv2-say">{message.text}</p>:message.kind==='open-chat'?<OpenPatientChatChoice rows={message.rows} locale={message.locale} onOpen={navigateMember} busy={busy}/>:<DoctorReply doctorId={doctorId} reply={message.reply} locale={replyLanguages.get(message.id)??l} busy={busy} onChoose={row=>navigateMember(row.id)} onWho={()=>void send(t('Who needs me','Ո՞ւմ է պետք իմ օգնությունը','Кому нужна моя помощь'))} onOpen={navigateMember} onLab={(memberId,fileId)=>router.push(`/staff/real/doctor-chat-v2/patient/${memberId}?lab=${fileId}` as Route)} onUpload={navigateMember} onPlan={navigateMember} onResults={navigateMember}/>}
   </article>)}
   {panelState==='loading'&&<p role="status">{t('Loading your members…','Ձեր անդամները բեռնվում են…','Загрузка ваших участников…')}</p>}
   {panelState==='failed'&&<div role="alert"><p>{t('Your panel could not be read. Try again.','Չհաջողվեց կարդալ ձեր անդամների խումբը։ Փորձեք կրկին։','Не удалось загрузить ваших участников. Попробуйте ещё раз.')}</p><button type="button" className="dcv2-choice" onClick={()=>void showPatients()}>{t('Try again','Փորձել կրկին','Попробовать ещё раз')}</button></div>}
   {panelState==='ready'&&panel&&<article className="cv2-msg cv2-zoe dcv2-panel"><PanelGraphs graphs={panel.graphs} locale={l} onSelect={ids=>{setMemberIds([...ids]);newest();}}/><PatientsCard rosterComplete={panel.rosterComplete} rows={panel.rows} locale={l} asOf={panel.asOf} memberIds={memberIds} onClearFilter={()=>setMemberIds(null)} onOpen={navigateMember}/></article>}
  </div></section>
  {unread&&<button type="button" className="cv2-new" onClick={newest}>{t('New message','Նոր հաղորդագրություն','Новое сообщение')}</button>}
  <footer className="cv2-bottom">{findHint&&<p id="doctor-member-search-hint" className="dcv2-find-hint">{searchHint}</p>}<form className="cv2-composer dcv2-ask-composer" onSubmit={event=>{event.preventDefault();void send();}}><textarea ref={input} rows={1} autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={1000} value={text} onPointerDown={()=>voiceConversation.edit()} onChange={event=>{voiceConversation.edit();setText(event.target.value);}} aria-label={t('Your message','Ձեր հաղորդագրությունը','Ваше сообщение')} aria-describedby={findHint?'doctor-member-search-hint':undefined} placeholder={searchHint} onKeyDown={event=>{if(event.key!=='Enter'||event.shiftKey||event.nativeEvent.isComposing||event.keyCode===229)return;if(!(event.metaKey||event.ctrlKey)&&window.matchMedia('(pointer: coarse)').matches)return;event.preventDefault();void send();}}/>{voiceAvailable&&<ConversationToggle locale={l} conversation={voiceConversation} disabled={menu||busy||(!voiceConversation.active&&!!text.trim())}/>}<button type="submit" disabled={busy||!text.trim()} aria-label={t('Send','Ուղարկել','Отправить')} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}><ArrowUp size={18} strokeWidth={2.4} aria-hidden/></button></form></footer>
  {menu&&<StaffChatMenu locale={l} onLocale={setLocale} onClose={()=>setMenu(false)} oldWorkspace="/staff/real/doctor-workspace/classic"><button type="button" disabled={busy} onClick={()=>{setMenu(false);void showPatients();}}>{t('Patients','Անդամներ','Участники')}</button>{telegramState&&<DoctorTelegramMenu locale={l} connected={telegramState.connected} onConnectionChange={connected=>setTelegramState({connected})}/>}</StaffChatMenu>}
 </main>;
}
