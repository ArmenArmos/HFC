'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useState,useTransition} from 'react';
import Link from 'next/link';
import type {Route} from 'next';
import {readDoctorHome} from '@/lib/staff-zoe/home-actions';
import type {HomeRequest,HomeResponse} from '@/lib/staff-zoe/home-read';
import type {L} from '@/lib/staff-zoe/contracts';
import {memberRef} from '@/lib/staff-zoe/contracts';
import type {MemberSearchInput,MemberSearchResult} from '@/lib/staff/member-search-schema';
import {readDoctorCard} from '@/lib/staff-zoe/card-actions';
import type {DoctorCardRequest,DoctorCardResponse} from '@/lib/staff-zoe/card-read';
import type {DoctorCardKind} from '@/lib/staff-zoe/home-intent';
import {DoctorRecordCard} from './record-card';
import {workspaceIntent} from '@/lib/staff-zoe/home-intent';
import {st} from '@/lib/staff/staff-locale-copy';
import {calendarDate,yerevanStamp} from '@/lib/staff/yerevan-time';
import {StaffZoeChat} from '@/components/staff/zoe/staff-zoe-pane';
import {ProgressCharts} from '@/components/member-history/progress-charts';
import {BpReadingsHistory} from '@/components/staff/bp-readings-history';
import {homeTime,HomeMemberHeader,HomeGlance,HomeMemberSummary} from './home-presentation';
import {ZoeTurn} from '@/components/patient/zoe-kit/thread';
import {ArrowUp} from 'lucide-react';
import {WorkspaceMemberList} from './member-list';
import {DoctorDecisionCards} from './decisions';
import {DayItemCards,DaySummary,dayStatus,dayItems,overdueDayItems} from './day-cards';
import {AlertCardLines} from '@/components/staff/alert-card';
import {NurseHandoffs} from '@/components/staff/nurse-handoffs';
import {ChatMenuItems} from '@/components/staff/chat-menu-items';
import {useChatFollow,useChatViewport} from '@/components/patient/use-chat-viewport';
import {submitChatOnEnter} from '@/components/staff/chat-enter';
import {EmptyStaffChat} from '@/components/staff/empty-chat';

type RecordResponse=Extract<HomeResponse,{kind:'record'}>;
type DayResponse=Extract<HomeResponse,{kind:'day'}>;
type Entry={id:number;question:string;response:HomeResponse;at:string;targetCard?:DoctorCardKind};
const POLL_MS=60_000;

/** The home thread is ephemeral. Member questions still use the existing persisted Doctor Zoe conversation.
 * Polls only read queues/records, run while visible, never overlap, and never invoke a model.
 */
export function DoctorHomeThread({initial,selected,locale,doctorId,decisionsEnabled,alertsEnabled=false,doctorName='',renderedAt=new Date().toISOString()}:{initial:HomeResponse;selected:HomeResponse|null;locale:L;doctorId:string;decisionsEnabled:boolean;alertsEnabled?:boolean;doctorName?:string;renderedAt?:string}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const read=useCallback((input:HomeRequest)=>readDoctorHome(input,doctorId),[doctorId]);
 const [showDay,setShowDay]=useState(false);
 const lastEntry=useRef<HTMLElement>(null),activeCard=useRef<HTMLDivElement>(null);
 const [queuedQuestion,setQueuedQuestion]=useState('');
 const [day,setDay]=useState<DayResponse|null>(initial.kind==='day'?initial:null);
 const [record,setRecord]=useState<RecordResponse|null>(selected?.kind==='record'?selected:null);
 const [entries,setEntries]=useState<Entry[]>([]),[text,setText]=useState(''),[pending,start]=useTransition();
 useEffect(()=>{if(entries.length)lastEntry.current?.scrollIntoView({behavior:'smooth',block:'start'});},[entries]);
 const [decisionGeneration,setDecisionGeneration]=useState(0);
 const [card,setCard]=useState<{request:DoctorCardRequest;response:DoctorCardResponse;generation:number;instance:number;saved?:{top:number;left:number;scrollTop:number};refreshFailed?:boolean}|null>(null);
 const cardInstance=card?.instance;
 useEffect(()=>{if(cardInstance)activeCard.current?.scrollIntoView({behavior:'smooth',block:'start'});},[cardInstance]);
 const selectedConversationId=record?.conversation.id;
 useLayoutEffect(()=>{if(selectedConversationId)scroll.current?.scrollTo?.({top:0});},[selectedConversationId]);
 const cardPress=useRef({top:0,left:0});
 const cardGeneration=useRef(0);
 const scroll=useRef<HTMLDivElement>(null),restoreScroll=useRef<number|null>(null);
 const [phone,setPhone]=useState(false);
 useEffect(()=>{
  const media=window.matchMedia('(max-width: 63.999rem)');
  const sync=()=>setPhone(media.matches);
  sync();media.addEventListener('change',sync);
  return ()=>media.removeEventListener('change',sync);
 },[]);
 // The fixed dock changes height with wrapping, locale and typing. Reserve only its real height,
 // so resizing the visible thread also lets the shared follow hook keep the latest message in view.
 useLayoutEffect(()=>{
  const box=scroll.current,dock=box?.querySelector<HTMLElement>('.dw-dock');
  if(!box||!dock)return;
  const sync=()=>box.style.setProperty('--doctor-dock-height',`${dock.getBoundingClientRect().height}px`);
  sync();
  const observer=new ResizeObserver(sync);observer.observe(dock,{box:'border-box'});
  return ()=>{observer.disconnect();box.style.removeProperty('--doctor-dock-height');};
 },[record?.conversation.id]);
 useChatViewport(phone);
 // Record cards retain their own heading focus, save restoration and scroll position.
 useChatFollow(!card,scroll,{startAtNewest:!record});
 useLayoutEffect(()=>{if(restoreScroll.current!==null&&scroll.current){scroll.current.scrollTop=restoreScroll.current;restoreScroll.current=null;}},[card]);
 const [chart,setChart]=useState<'bp'|'dashboard'|null>(null);
 const [unavailable,setUnavailable]=useState(initial.kind!=='day'||selected!==null&&selected.kind!=='record');
 const [notifications,setNotifications]=useState<string[][]>([]);
 const known=useRef(new Map(initial.kind==='day'?dayItems(initial.day,locale).map(i=>[i.id,i.revision]):[]));
 const current=useRef(record),currentDay=useRef(day);
 useEffect(()=>{current.current=record;currentDay.current=day;},[record,day]);
 const generation=useRef(0),sequence=useRef(0);
 const clear=useCallback(()=>{cardGeneration.current++;setCard(null);generation.current++;setDay(null);setRecord(null);setEntries([]);setNotifications([]);known.current.clear();setUnavailable(true);},[]);
 useEffect(()=>{
  let stopped=false,timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   try{if(document.visibilityState==='visible'){
    const version=generation.current;
    try{
     const polled=await read({kind:'poll'});
     if(stopped||version!==generation.current)return;
     if(polled.kind!=='poll'){clear();return;}
     const cached=currentDay.current?.day.firstNotes,count=polled.firstNoteCount;
     // Keep the already audited details while the count is unchanged. Only fetch and audit
     // details again when the count changes, or when recovering an unavailable source.
     const fresh:HomeResponse=!count?{kind:'day',day:{...polled.day,firstNotes:null}}:
      cached&&cached.enabled===count.enabled&&cached.items.length===count.count?
       {kind:'day',day:{...polled.day,firstNotes:cached}}:await read({kind:'day'});
     const selected=current.current;
     // Polling leaves decision snapshots alone. A save or explicit refresh may
     // read them again, avoiding lock contention and resets while editing/approving.
     const refreshed=selected&&!selected.decisions?await read({kind:'record',conversationId:selected.conversation.id}):null;
     if(stopped||version!==generation.current)return;
     if(fresh.kind!=='day'||(refreshed&&refreshed.kind!=='record')){clear();return;}
     const items=dayItems(fresh.day,locale),added=items.filter(i=>known.current.get(i.id)!==i.revision).map(i=>i.id);
     known.current=new Map(items.map(i=>[i.id,i.revision]));
     setDay(fresh);setUnavailable(false);
     if(added.length)setNotifications(all=>[...all.map(ids=>ids.filter(id=>!added.includes(id))),added].slice(-20));
     if(refreshed?.kind==='record')setRecord(refreshed);
    }catch{if(!stopped&&version===generation.current)clear();}
   }}finally{if(!stopped)timer=setTimeout(poll,POLL_MS);}
  };
  timer=setTimeout(poll,POLL_MS);
  return ()=>{stopped=true;clearTimeout(timer);};
 },[locale,clear,read]);
 async function openCard(input:DoctorCardRequest,preserveState=false,reload=false){
  const version=++cardGeneration.current;
  const instance=preserveState&&card?card.instance:version;
  // PDF-open audits retain editors. Reloads keep the old card until its fresh snapshot arrives.
  if(!preserveState&&!reload)setCard(null);
  let response:DoctorCardResponse;
  try{
   response=await readDoctorCard(input,doctorId);
  }catch{response={kind:'unavailable'};}
  if(version!==cardGeneration.current)return;
  if(response.kind==='refused'){clear();return;}
  if(preserveState&&response.kind==='unavailable'){
   setCard(previous=>previous?{...previous,generation:version,refreshFailed:true}:null);
   return;
  }
  if(reload)restoreScroll.current=scroll.current?.scrollTop??null;
  setCard(previous=>({request:input,response,generation:version,instance,saved:reload?previous?.saved:undefined}));
  return true;
 }
 async function request(input:HomeRequest,question='',showResult=false,reloadDecisions=false,targetCard?:DoctorCardKind):Promise<void>{
  const version=++generation.current;
  try{
   const response=await read(input);
   if(version!==generation.current)return;
   if(response.kind==='refused'){clear();return;}
   if(input.kind==='record'&&response.kind!=='record'){setUnavailable(true);return;}
   if(response.kind==='members'&&response.page.rows.length===1&&!response.page.hasMore&&(targetCard&&response.query!==''||/^(?:open|about|tell me about|how is|what about|բացել|открыть)\s/iu.test(question))){
    return request({kind:'select',memberId:response.page.rows[0].id},question,false,false,targetCard);
   }
   if(response.kind==='record'){if(input.kind==='select'){cardGeneration.current++;setCard(null);setShowDay(false);setChart(null);}setRecord(response);setUnavailable(false);setEntries([]);if(reloadDecisions)setDecisionGeneration(v=>v+1);if(targetCard)await openCard({card:targetCard,conversationId:response.conversation.id});}
   else if(response.kind==='day'){setDay(response);setUnavailable(false);if(showResult)setEntries(all=>[...all,{id:++sequence.current,question,response,at:new Date().toISOString()}].slice(-10));}
   else setEntries(all=>[...all,{id:++sequence.current,question,response,at:new Date().toISOString(),targetCard}].slice(-10));
  }catch{if(version===generation.current){if(input.kind==='record')setUnavailable(true);else clear();}}
 }
 async function refreshDecisions(){
  const selected=current.current,version=generation.current+1;
  await request({kind:'day'});
  if(generation.current!==version||current.current?.conversation.id!==selected?.conversation.id)return;
  if(selected)await request({kind:'record',conversationId:selected.conversation.id},'',false,true);
 }
 async function reloadCard(preserveState=false,saved=false){
  if(!card||card.generation!==cardGeneration.current)return;
  if(saved){
   const position={...cardPress.current,scrollTop:scroll.current?.scrollTop??0};
   restoreScroll.current=scroll.current?.scrollTop??null;
   setCard(previous=>previous?{...previous,saved:position}:null);
  }
  const loaded=await openCard(card.request,preserveState,true);
  if(loaded&&!preserveState)await refreshDecisions();
 }

 const select=(memberId:string,targetCard?:DoctorCardKind)=>{if(!pending)start(()=>request({kind:'select',memberId},'',false,false,targetCard));};
 const search=async(input:MemberSearchInput):Promise<MemberSearchResult>=>{
  const r=await read({kind:'members',...input});
  if(r.kind==='refused')clear();
  return r.kind==='members'?{ok:true,page:r.page}:{ok:false,reason:r.kind==='invalid'?'invalid':'unavailable'};
 };
 async function command(question:string):Promise<boolean>{
  const intent=workspaceIntent(question);
  if(intent.kind==='unsupported')return false;
  if(intent.kind==='alerts')await openCard({card:'alerts'});
  else if(intent.kind==='card'){
   if(intent.query||!current.current)await request({kind:'members',query:intent.query,cursor:null},question,false,false,intent.card);
   else await openCard({card:intent.card,conversationId:current.current.conversation.id});
  }else if(intent.kind==='dashboard'||intent.kind==='bp'){
   setChart(intent.kind);
   if(current.current){await request({kind:'record',conversationId:current.current.conversation.id},question);}
   else await request({kind:'members',query:'',cursor:null},question);
  }else if(intent.kind==='members')await request({...intent,cursor:null},question);
  else if(intent.kind==='missing_bp')await request({...intent,query:'',cursor:null},question);
  else if(intent.kind==='overdue'){await request({kind:'day'},question,true);
  }else {setShowDay(true);await request({kind:'day'},question);}
  return true;
 }
 const ask=(q:string)=>start(async()=>{
  setText('');
  if(!await command(q)){
   setQueuedQuestion(q);
   await request({kind:'members',query:'',cursor:null},q);
  }
 });
 const fallback=<p className="text-body2">{t('I cannot answer that from the available records. Choose a member to ask about their saved record, or open your waiting work.','Հասանելի գրառումներից չեմ կարող պատասխանել։ Ընտրեք անդամին՝ նրա պահպանված գրառման մասին հարցնելու համար, կամ բացեք սպասող գործերը։','По доступным записям ответить не могу. Выберите участника для вопроса о его записи или откройте ожидающие задачи.')}</p>;
 const status=day&&!unavailable?dayStatus(day.day,locale):null;
 const waiting=status?.counts.total??0;
 return <section className="dw-chat dw-home-thread" aria-label={t('Your day with Zoe','Ձեր օրը Զոյայի հետ','Ваш день с Zoe')} onClickCapture={e=>{
  // Capture pointer and keyboard clicks before a successful refresh replaces the button.
  const button=(e.target as HTMLElement).closest('.dw-record-card button');
  if(button){const {top,left}=button.getBoundingClientRect();cardPress.current={top,left};setCard(previous=>previous?.saved?{...previous,saved:undefined}:previous);}
 }}>
  {record&&<HomeMemberHeader member={record.conversation.member} locale={locale}/>}
  <div ref={scroll} className="dw-home-scroll" aria-busy={pending} onScroll={e=>{const top=e.currentTarget.scrollTop;setCard(previous=>previous?.saved&&previous.saved.scrollTop!==top?{...previous,saved:undefined}:previous);}}>
  {waiting>0&&<p role="status" className="border-b bg-background px-4 text-body2"><button type="button" className="inline-flex min-h-11 items-center underline" onClick={()=>ask(t('Today','Այսօր','Сегодня'))}>{t(`${waiting} waiting`,`Սպասում է՝ ${waiting}`,`Ожидают: ${waiting}`)}</button></p>}
  {day&&!unavailable&&!waiting&&!status?.incomplete&&!record&&!card&&!chart&&!showDay&&!entries.length&&<EmptyStaffChat locale={locale}/>}
  {status&&status.counts.alerts>0&&<div role="alert" data-urgent-count={status.counts.alerts} className="border-b border-destructive bg-background px-4 py-2 text-body2">
   <Link href={'/staff/real/alerts' as Route} className="inline-flex min-h-11 items-center font-semibold underline" onClick={event=>{if(alertsEnabled){event.preventDefault();ask(t('Open alerts','Բացել ահազանգերը','Открыть оповещения'));}}}>{t('Urgent items need your attention. Open alerts.','Շտապ գործերը ձեր ուշադրության կարիքն ունեն։ Բացեք ահազանգերը։','Срочные задачи требуют вашего внимания. Откройте оповещения.')}</Link>
  </div>}
  {day&&!unavailable&&status?.incomplete&&<p role="alert" className="border-b bg-background px-4 py-2 text-body2">{status.text}. <Link className="inline-flex min-h-11 items-center underline" href={'/staff/real/today' as Route}>{t('Open Today','Բացել «Այսօր» բաժինը','Открыть «Сегодня»')}</Link></p>}

  {record&&!card&&!chart&&<HomeMemberSummary records={record.glance} readings={record.bp} bpState={record.bpState} reasons={day?dayItems(day.day,locale).filter(i=>i.memberId===record.conversation.member.id).map(i=>i.alert?<AlertCardLines key={i.id} alert={i.alert} locale={locale}/>:i.label):[]} locale={locale} onReply={()=>{start(async()=>{await openCard({card:'conversation',conversationId:record.conversation.id});});}}/>}
  {record&&chart==='dashboard'&&<HomeGlance records={record.glance} locale={locale} reference={memberRef(record.conversation.member.id)} asOf={day?.day.inbox.asOf??renderedAt}/>}
  {unavailable&&<p role="alert">{t('Your workspace could not be read. Open Today to check waiting items.','Ձեր աշխատատարածքը չհաջողվեց կարդալ։ Սպասող գործերը ստուգեք «Այսօր» բաժնում։','Не удалось прочитать рабочее пространство. Проверьте ожидающие элементы в разделе «Сегодня».')}</p>}
  {day&&!unavailable&&showDay&&<><DaySummary day={day.day} locale={locale}/>{day.day.handoffs!==undefined&&<NurseHandoffs page={day.day.handoffs} actor={{id:doctorId,role:'doctor'}} locale={locale} onChanged={()=>{start(()=>request({kind:'day'}));}}/>}<DayItemCards items={dayItems(day.day,locale).filter(i=>!notifications.some(ids=>ids.includes(i.id)))} locale={locale} onSelect={select} decisions={decisionsEnabled} alerts={alertsEnabled}/></>}
  <div aria-live="polite">{showDay&&notifications.map((ids,index)=>{
   const fresh=day?dayItems(day.day,locale).filter(i=>ids.includes(i.id)):[];
   return fresh.length?<article key={index}><ZoeTurn locale={locale} say={[t('New items arrived','Նոր տարրեր են ստացվել','Поступили новые элементы')]} at={homeTime(day!.day.inbox.asOf,locale)}><DayItemCards items={fresh} locale={locale} onSelect={select} decisions={decisionsEnabled} alerts={alertsEnabled}/></ZoeTurn></article>:null;
  })}</div>
  {entries.map(e=><article ref={e.id===entries.at(-1)?.id?lastEntry:undefined} key={e.id} className="space-y-3">
   <p className="zk-me ml-auto">{e.question}</p>
   <ZoeTurn locale={locale} at={homeTime(e.at,locale)}>
   {e.response.kind==='day'?<><p className="text-body2">{t('Overdue items in the available Today queues','Ժամկետանց գործերը «Այսօր» հասանելի ցանկերում','Просроченные элементы доступных очередей «Сегодня»')}: {overdueDayItems(e.response.day,locale).length}</p><DayItemCards items={overdueDayItems(e.response.day,locale)} locale={locale} onSelect={select} decisions={decisionsEnabled} alerts={alertsEnabled}/></>:e.response.kind==='members'||e.response.kind==='missing_bp'?<>
    {e.response.kind==='missing_bp'&&<p className="text-body2">{t('No BP readings recorded on this search page','Այս որոնման էջում ճնշման գրանցումներ չկան','На этой странице поиска нет записей давления')}: {calendarDate(e.response.from,locale)} – {calendarDate(e.response.to,locale)}. {t('Source: BP history. Unknown reads','Աղբյուր՝ ճնշման պատմություն։ Անհայտ ընթերցումներ','Источник: история давления. Недоступные записи')}: {e.response.unknown} · {yerevanStamp(e.response.asOf,locale)}</p>}
    {queuedQuestion&&<p>{t('Choose the member for this question. Zoe will read their saved records.','Ընտրեք անդամին այս հարցի համար։ Զոյան կկարդա նրա պահպանված գրառումները։','Выберите участника для этого вопроса. Zoe прочитает его сохранённые записи.')}</p>}
    <WorkspaceMemberList initialPage={e.response.page} includeIds={e.response.kind==='missing_bp'?e.response.missingIds:undefined} initialQuery={e.response.query} resetLabel={e.response.kind==='missing_bp'?t('Back to this BP list','Վերադառնալ ճնշման այս ցանկին','К этому списку давления'):undefined} locale={locale} onSelect={id=>select(id,e.targetCard)} searchAction={e.response.kind==='members'?search:async input=>{
     const r=await read({kind:'missing_bp',...input});
     if(r.kind==='refused')clear();
     if(r.kind==='missing_bp')setEntries(all=>all.map(x=>x.id===e.id?{...x,response:r}:x));
     return r.kind==='missing_bp'?{ok:true,page:r.page}:{ok:false,reason:r.kind==='invalid'?'invalid':'unavailable'};
    }}/>
   </>:fallback}
   </ZoeTurn>
  </article>)}
  <ChatMenuItems target="doctor-chat-menu" locale={locale}>
  <div className="flex flex-col">{[
   ['Today','Այսօր','Сегодня'],['Open alerts','Բացել ահազանգերը','Открыть оповещения'],['Show my members','Իմ անդամները','Мои участники'],
  ].map(([en,hy,ru])=><button key={en} type="button" className="px-2 py-2 text-body2" disabled={pending} onClick={()=>ask(t(en,hy,ru))}>{t(en,hy,ru)}</button>)}</div>
  {record&&<div className="flex flex-col">{[
   ['Open conversation','Բացել զրույցը','Открыть разговор'],['Record blood pressure','Գրանցել ճնշումը','Записать давление'],['Show results','Բացել արդյունքները','Открыть результаты'],
  ].map(([en,hy,ru])=><button key={en} className="px-2 py-2 text-body2" disabled={pending} onClick={()=>ask(t(en,hy,ru))}>{t(en,hy,ru)}</button>)}</div>}
  <details><summary className="min-h-11 cursor-pointer px-2 py-2 text-body2">{t('More actions','Այլ գործողություններ','Другие действия')}</summary><div className="flex flex-col">{[
   ['Show dashboard','Վահանակ','Панель'],['BP chart','Ճնշման գրաֆիկ','График давления'],['Who is overdue','Ժամկետանց','Просроченные'],
   ...(record?[
    ['Record a note','Գրանցել նշում','Записать заметку'],['Review uploads','Բացել վերբեռնումները','Открыть загрузки'],['Open tasks','Բացել առաջադրանքները','Открыть задачи'],
    ['Open consultation','Բացել խորհրդատվությունը','Открыть консультацию'],['Open GP report','Բացել բժշկի հաշվետվությունը','Открыть отчёт для врача'],['Show LDL goal','Բացել ցխլ նպատակը','Открыть цель лпнп'],
   ]:[]),
  ].map(([en,hy,ru])=><button key={en} className="px-2 py-2 text-body2" disabled={pending} onClick={()=>ask(t(en,hy,ru))}>{t(en,hy,ru)}</button>)}</div></details>
   {record&&<><button className="px-2 py-2 text-body2" onClick={()=>{cardGeneration.current++;setCard(null);generation.current++;setRecord(null);setChart(null);setEntries([]);setShowDay(false);}}>{t('Change member','Փոխել անդամին','Сменить участника')}</button><Link className="px-2 py-2 text-body2" href={`/staff/real/members/${record.conversation.member.id}` as Route}>{t('Open record','Բացել գրառումը','Открыть запись')}</Link></>}
  </ChatMenuItems>
  {card?.refreshFailed&&<p role="status" className="text-body2">{t('Refresh failed. Your unsaved changes are still here. Open the PDF again to retry.','Թարմացումը չհաջողվեց։ Ձեր չպահպանված փոփոխությունները պահպանվել են։ Կրկին բացեք PDF-ը՝ նորից փորձելու համար։','Не удалось обновить карточку. Ваши несохранённые изменения сохранены здесь. Откройте PDF ещё раз, чтобы повторить попытку.')}</p>}
  {card?.saved&&<p role="status" style={{top:card.saved.top,left:card.saved.left}} className="pointer-events-none fixed z-30 -translate-y-full rounded-md border bg-background px-3 py-2 text-body2 shadow-sm">{t('Saved.','Պահպանված է։','Сохранено.')}</p>}
  {card&&<div ref={activeCard}><DoctorRecordCard key={card.instance} response={card.response} doctorName={doctorName} doctorId={doctorId} locale={locale} pending={pending} onReload={reloadCard} onSaved={()=>{if(card.generation===cardGeneration.current)void refreshDecisions();}} onSelect={select} onReply={()=>{if(record)start(async()=>{await openCard({card:'conversation',conversationId:record.conversation.id});});}} onLab={fileId=>{if(record)start(async()=>{await openCard({card:'lab',fileId,conversationId:record.conversation.id});});}} onAlertsView={view=>start(async()=>{await openCard({card:'alerts',view});})}/></div>}
  {record?<>
   {chart&&(record.bp?<BpReadingsHistory readings={record.bp} locale={locale}/>:<p className="text-body2">{t('The BP chart is unavailable here. Open the full record.','Ճնշման գրաֆիկն այստեղ անհասանելի է։ Բացեք ամբողջական գրառումը։','График давления здесь недоступен. Откройте полную запись.')}</p>)}
   {chart==='dashboard'&&<section className="space-y-3"><p className="text-caption text-muted-foreground">{t('Source: uploaded measurements, with their recorded dates and review status.','Աղբյուր՝ ներբեռնված չափումներ՝ գրանցված ամսաթվերով և վերանայման կարգավիճակով։','Источник: загруженные измерения с датами и статусом проверки.')}</p>{record.charts&&Object.values(record.charts).some(points=>points.length)?<ProgressCharts series={record.charts} locale={locale}/>:<p className="text-body2">{t('No uploaded measurement chart is available.','Ներբեռնված չափումների գրաֆիկ չկա։','График загруженных измерений недоступен.')}</p>}</section>}
   {chart&&<Link href={`/staff/real/members/${record.conversation.member.id}` as Route} className="inline-flex min-h-11 items-center text-body2 underline">{t('Open the full record','Բացել ամբողջական գրառումը','Открыть полную запись')}</Link>}
   <StaffZoeChat key={record.conversation.id} conversation={record.conversation} role="doctor" locale={locale} workspace home initialQuestion={queuedQuestion} onInitialQuestionSent={()=>setQueuedQuestion('')} onWorkspaceAsk={command} decisions={record.decisions&&!(card?.response.kind==='ready'&&['conversation','consultation'].includes(card.response.card))?<DoctorDecisionCards single key={decisionGeneration} data={record.decisions} locale={locale} onRefresh={refreshDecisions} onReply={()=>{start(async()=>{await openCard({card:'conversation',conversationId:record.conversation.id});});}}/>:undefined}/>
  </>:<div className="dw-dock"><form onSubmit={e=>{e.preventDefault();if(!pending&&text.trim())ask(text);}} className="zk-composer" aria-busy={pending}>
   <label htmlFor="doctor-home-ask" className="sr-only">{t('Ask Zoe','Հարցնել Զոյային','Спросить Zoe')}</label>
   <textarea id="doctor-home-ask" rows={2} value={text} onChange={e=>setText(e.target.value)} onKeyDown={submitChatOnEnter} maxLength={1000} placeholder={t('Ask Zoe…','Հարցրեք Զոյային…','Спросите Zoe…')} className="min-h-11 min-w-0 flex-1 resize-none border-0 bg-transparent px-3 py-2 text-body2 focus:outline-none"/>
   <button className="zk-send" aria-label={t('Ask','Հարցնել','Спросить')} disabled={pending||!text.trim()}><ArrowUp size={20} aria-hidden/></button>
  </form><p className="text-caption text-muted-foreground">{t('Use the arrow to send. Enter adds a line on your phone.','Ուղարկելու համար սեղմեք սլաքը։ Հեռախոսում Enter-ը նոր տող է ավելացնում։','Нажмите стрелку для отправки. Enter на телефоне добавляет строку.')}</p></div>}
  {pending&&<p role="status" className="zk-bubble">{t('Zoe is reading…','Զոյան կարդում է…','Zoe читает…')}</p>}
  </div>
 </section>;
}
