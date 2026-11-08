'use client';
import {useEffect,useEffectEvent,useRef,useState,useTransition,type ReactNode} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import type {Route} from 'next';
import {st} from '@/lib/staff/staff-locale-copy';
import {memberRef,savedAnswer,type AnswerContent,type Candidate,type ConversationRead,type Intent,type L,type StreamEvent,type ToolResult} from '@/lib/staff-zoe/contracts';
import {findStaffZoeMembers,openStaffZoe,type FindResult} from '@/lib/staff-zoe/actions';
import {ZoeTurn} from '@/components/patient/zoe-kit/thread';
import {ArrowUp} from 'lucide-react';
import {ChatMenuItems} from '@/components/staff/chat-menu-items';
import {submitChatOnEnter} from '@/components/staff/chat-enter';
import {StaffZoeResponse} from './answer';
import {staffZoeRefusal} from '@/lib/staff-zoe/response-copy';

type Turn={key:string;question:string;cards:ToolResult[];content:AnswerContent|null;error:string|null;at?:string};
const button='inline-flex min-h-11 items-center rounded-md px-4 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring';
const CHIPS:readonly [Intent,string,string,string,string][]=[
 ['summary','Summarise the record','Summarise the record','Ամփոփել գրառումը','Кратко по записи'],['bp','Blood pressure','Show blood pressure','Ճնշում','Давление'],['labs','Labs','Show reviewed labs','Լաբորատոր','Анализы'],['ldl','LDL goal','Show LDL goal and response','ՑԽԼ նպատակ','Цель ЛПНП'],
 ['plan','Plan','Show the published plan','Պլան','План'],['adherence','Adherence','Show medicines and adherence','Հետևողականություն','Приверженность'],['open_items','Open items','Show open items','Բաց հարցեր','Открытые вопросы'],
];
const DOCTOR_ONLY=new Set<Intent>(['labs','ldl','messages']);
const age=(y:number|null)=>y===null?null:y;

/** Who this conversation is about, always on screen. Two namesakes differ by reference and birth year. */
function MemberBar({m,locale}:{m:ConversationRead['member'];locale:L}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return <div data-testid="zoe-member" className="sz-member flex flex-wrap items-baseline justify-between gap-2 rounded-xl border bg-background p-4">
  <div><p className="text-h3">{m.name??t('Name not recorded','Անունը գրանցված չէ','Имя не указано')}</p><p className="text-caption text-muted-foreground">{t('Reference','Հղում','Идентификатор')} {memberRef(m.id)} · {age(m.birthYear)??t('Birth year not known','Ծննդյան տարին հայտնի չէ','Год рождения неизвестен')}{m.sex?` · ${m.sex}`:''}</p></div>
  <div className="flex flex-wrap gap-2"><Link href={`/staff/real/members/${m.id}` as Route} className="text-body2 underline underline-offset-2">{t('Open member','Բացել անդամին','Открыть участника')}</Link><Link href={'/staff/real/zoe' as Route} className="text-body2 underline underline-offset-2">{t('Change member','Փոխել անդամին','Сменить участника')}</Link></div>
 </div>;
}

function Finder({locale,recent}:{locale:L;recent:{id:string;name:string|null;birthYear:number|null;at:string}[]}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const router=useRouter();const [q,setQ]=useState('');const [found,setFound]=useState<FindResult|null>(null);const [pending,go]=useTransition();const [failed,setFailed]=useState(false);
 const search=()=>go(async()=>{setFailed(false);setFound(await findStaffZoeMembers(q));});
 const pick=(c:Candidate)=>go(async()=>{setFailed(false);const r=await openStaffZoe(c.id);if(r.ok)router.push(`/staff/real/zoe?c=${r.conversationId}` as Route);else setFailed(true);});
 return <div className="space-y-4">
  <form className="space-y-2" onSubmit={e=>{e.preventDefault();search();}}>
   <label htmlFor="zoe-find" className="text-body2 font-medium">{t('Choose one of your members','Ընտրեք ձեր անդամներից մեկին','Выберите своего участника')}</label>
   <div className="flex gap-2"><input id="zoe-find" value={q} onChange={e=>setQ(e.target.value)} maxLength={100} placeholder={t('Name or phone digits','Անուն կամ հեռախոսի թվեր','Имя или цифры телефона')} className="min-h-11 w-full rounded-md border bg-background px-3 text-body2"/><button type="submit" disabled={pending||q.trim().length<2} className={`${button} bg-primary text-primary-foreground disabled:opacity-50`}>{t('Find','Գտնել','Найти')}</button></div>
  </form>
  {found&&found.status==='ok'&&(found.rows.length?<ul className="space-y-2" aria-label={t('Matching members','Համընկնող անդամներ','Подходящие участники')}>{found.rows.map(c=><li key={c.id} className="list-none"><button type="button" disabled={pending} onClick={()=>pick(c)} data-testid="zoe-candidate" className="flex min-h-11 w-full flex-wrap items-baseline justify-between gap-2 rounded-xl border bg-background p-3 text-left focus-visible:outline-2 focus-visible:outline-ring"><span className="text-body2 font-medium">{c.name??t('Name not recorded','Անունը գրանցված չէ','Имя не указано')}</span><span className="text-caption text-muted-foreground">{t('Reference','Հղում','Идентификатор')} {memberRef(c.id)} · {c.birthYear??t('birth year not known','ծննդյան տարին հայտնի չէ','год рождения неизвестен')}{c.sex?` · ${c.sex}`:''} · {t('joined','միացել է','с')} {c.joinedOn}</span></button></li>)}</ul>:<p role="status" className="text-body2">{t('None of your members match.','Ձեր անդամներից ոչ մեկը չի համընկնում։','Среди ваших участников совпадений нет.')}</p>)}
  {found&&found.status==='ok'&&found.hasMore&&<p className="text-caption text-muted-foreground">{t('More members match. Type more of the name.','Ավելի շատ անդամներ են համընկնում։ Գրեք անվան ավելի մեծ մասը։','Совпадений больше. Введите имя подробнее.')}</p>}
  {found&&found.status!=='ok'&&<p role="alert" className="text-body2">{t('The search did not work. Try again.','Որոնումը չստացվեց։ Փորձեք նորից։','Поиск не сработал. Попробуйте ещё раз.')}</p>}
  {failed&&<p role="alert" className="text-body2">{t('That member could not be opened.','Չհաջողվեց բացել այդ անդամին։','Не удалось открыть этого участника.')}</p>}
  {!!recent.length&&<section className="space-y-2"><h2 className="text-h3">{t('Recent','Վերջին','Недавние')}</h2><ul className="space-y-1">{recent.map(r=><li key={r.id} className="list-none"><Link href={`/staff/real/zoe?c=${r.id}` as Route} className="text-body2 underline underline-offset-2">{r.name??t('Name not recorded','Անունը գրանցված չէ','Имя не указано')}{r.birthYear?` (${r.birthYear})`:''}</Link></li>)}</ul></section>}
 </div>;
}

type StaffZoeChatProps={conversation:ConversationRead;role:'doctor'|'nurse';locale:L;workspace?:boolean;home?:boolean;initialQuestion?:string;onInitialQuestionSent?:()=>void;decisions?:ReactNode;onWorkspaceAsk?:(question:string)=>Promise<boolean>};
export function StaffZoeChat(props:StaffZoeChatProps){
 // A reused parent must never carry another member's history, draft or pending turn.
 return <StaffZoeChatSession key={`${props.conversation.id}:${props.conversation.member.id}`} {...props}/>;
}
function StaffZoeChatSession({conversation,role,locale,workspace=false,home=false,decisions,onWorkspaceAsk,initialQuestion='',onInitialQuestionSent}:StaffZoeChatProps){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const ref=memberRef(conversation.member.id);
 const saved:Turn[]=conversation.messages.reduce<Turn[]>((all,m)=>{
  if(m.role==='staff')all.push({key:`s${m.seq}`,question:m.body,cards:[],content:null,error:null,at:m.at});
  else{const last=all.at(-1);if(last){last.content=savedAnswer(m.content);last.at=m.at;}}
  return all;},[]);
 const [turns,setTurns]=useState<Turn[]>(saved);const [text,setText]=useState('');const [busy,setBusy]=useState(false);
 const end=useRef<HTMLDivElement>(null);
 const active=useRef(true);
 const pending=useRef<AbortController|null>(null);
 const stream=useRef<ReadableStreamDefaultReader<string>|null>(null);
 useEffect(()=>{
  active.current=true;
  return ()=>{active.current=false;pending.current?.abort();void stream.current?.cancel().catch(()=>{});};
 },[]);
 const update=(key:string,change:(t:Turn)=>Turn)=>setTurns(all=>all.map(x=>x.key===key?change(x):x));
 const refused=(code:string)=>staffZoeRefusal(code,locale);
 async function ask(question:string,intent:Intent|null){
  const q=question.trim();if(!q||busy||!active.current)return;
  // Typed names of the former chips use exactly the same bounded read intent.
  if(!intent)intent=CHIPS.find(c=>(role==='doctor'||!DOCTOR_ONLY.has(c[0]))&&c.slice(1).some(label=>label.toLocaleLowerCase(locale)===q.toLocaleLowerCase(locale)))?.[0]??(/^(?:at a glance|մի հայացքով|краткий обзор)$/iu.test(q)?'summary':null);
  if(!intent&&onWorkspaceAsk){
   setBusy(true);setText('');
   try{if(await onWorkspaceAsk(q)||!active.current)return;}finally{if(active.current)setBusy(false);}
  }
  const key=crypto.randomUUID();
  const controller=new AbortController();pending.current=controller;
  setBusy(true);setText('');setTurns(all=>[...all,{key,question:q,cards:[],content:null,error:null,at:new Date().toISOString()}]);
  try{
   const endpoint=role==='doctor'?`/staff/real/zoe/member/${conversation.member.id}/ask`:'/staff/real/zoe/ask';
   const res=await fetch(endpoint,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId:conversation.id,submissionId:key,text:q,intent,locale})});
   if(!active.current){void res.body?.cancel().catch(()=>{});return;}
   if(!res.ok||!res.body)throw Error('failed');
   const reader=res.body.pipeThrough(new TextDecoderStream()).getReader();stream.current=reader;let rest='';
   for(;;){const {done,value}=await reader.read();if(done||!active.current)break;rest+=value;const lines=rest.split('\n');rest=lines.pop()??'';
    for(const line of lines){if(!line.trim())continue;const e=JSON.parse(line) as StreamEvent;
     if(e.type==='cards')update(key,x=>({...x,cards:e.cards}));
     if(e.type==='answer')update(key,x=>({...x,content:e.content}));
     if(e.type==='refused')update(key,x=>({...x,error:refused(e.code)}));}}
  }catch{if(active.current)update(key,x=>({...x,error:refused('unavailable')}));}
  finally{stream.current?.releaseLock();stream.current=null;pending.current=null;}
  if(!active.current)return;
  setBusy(false);end.current?.scrollIntoView({behavior:'smooth',block:'end'});
 }
 const initialSent=useRef(false);
 const sendInitial=useEffectEvent((question:string)=>{void ask(question,null);onInitialQuestionSent?.();});
 useEffect(()=>{if(initialQuestion&&!initialSent.current){initialSent.current=true;sendInitial(initialQuestion);}},[initialQuestion]);
 const chips=CHIPS.filter(c=>role==='doctor'||!DOCTOR_ONLY.has(c[0]));
 const queries=<div className={home?"flex flex-col":"sz-query-strip flex flex-wrap gap-2"}>{chips.map(c=><button key={c[0]} type="button" disabled={busy} onClick={()=>ask(st(locale,c[2],c[3],c[4]),c[0])} className={`${button} border bg-background disabled:opacity-50`}>{workspace&&c[0]==='summary'?t('At a glance','Մի հայացքով','Краткий обзор'):st(locale,c[1],c[3],c[4])}</button>)}{workspace&&<button type="button" disabled={busy} onClick={()=>ask(t('Why did Zoe answer the latest member message this way?','Ինչու Զոյան այսպես պատասխանեց անդամի վերջին հաղորդագրությանը','Почему Зоя так ответила на последнее сообщение участника?'),null)} className={`${button} border bg-background disabled:opacity-50`}>{t('Why did Zoe say this?','Ինչու Զոյան սա ասաց','Почему Зоя это сказала?')}</button>}</div>;
 return <div className="sz-chat space-y-4">
  {!home&&<MemberBar m={conversation.member} locale={locale}/>}
  <div className="sz-thread space-y-4" aria-live="polite" data-testid="zoe-thread">
   {workspace&&!home&&!turns.length&&<div className="dw-greeting"><span className="zk-orb" aria-hidden/><h2 className="text-h3">{t('What would you like to know?','Ինչ կցանկանաք իմանալ','Что вы хотите узнать?')}</h2><p className="text-body2 text-muted-foreground">{t('Ask about this member’s record. Sources and dates stay with each answer.','Հարցրեք այս անդամի գրառման մասին։ Աղբյուրներն ու ամսաթվերը նշվում են յուրաքանչյուր պատասխանի հետ։','Спросите о записи этого участника. Источники и даты указаны в каждом ответе.')}</p></div>}
   {turns.map(x=><article key={x.key} className="space-y-3">
    <p className="sz-question ml-auto w-fit max-w-[85%] rounded-xl bg-primary px-3 py-2 text-body2 text-primary-foreground">{x.question}</p>
    {home&&<ZoeTurn locale={locale} at={x.at?new Intl.DateTimeFormat(locale,{timeZone:'Asia/Yerevan',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(x.at)):undefined}>
     <StaffZoeResponse member={conversation.member} content={x.content} cards={x.cards} error={x.error} loading={busy} locale={locale} memberRef={ref} home/>
    </ZoeTurn>}
    {!home&&<StaffZoeResponse member={conversation.member} content={x.content} cards={x.cards} error={x.error} loading={busy} locale={locale} memberRef={ref}/>}
   </article>)}
   {decisions}
   <div ref={end}/>
  </div>
  <div className={home?"dw-dock":"space-y-4"}>
  {home?<ChatMenuItems target="doctor-record-menu" locale={locale}><details><summary className="min-h-11 cursor-pointer px-2 py-2 text-body2">{t('Ask about saved records','Հարցնել պահպանված գրառումների մասին','Спросить о сохранённых записях')}</summary>{queries}</details></ChatMenuItems>:queries}
  <form className={home?"zk-composer dw-member-composer":"sz-composer flex gap-2"} onSubmit={e=>{e.preventDefault();void ask(text,null);}}>
   <label htmlFor="zoe-ask" className="sr-only">{t('Ask Zoe…','Հարցրեք Զոյային…','Спросите Зою…')}</label>
   <textarea id="zoe-ask" value={text} onChange={e=>setText(e.target.value)} onKeyDown={role==='doctor'?submitChatOnEnter:undefined} maxLength={1000} rows={2} placeholder={t('Ask Zoe…','Հարցրեք Զոյային…','Спросите Зою…')} className="min-h-11 w-full rounded-md border bg-background px-3 py-2 text-body2"/>
   <button type="submit" aria-label={t('Ask','Հարցնել','Спросить')} disabled={busy||!text.trim()} className={home?"zk-send":`${button} bg-primary text-primary-foreground disabled:opacity-50`}>{home?<ArrowUp size={20} aria-hidden/>:t('Ask','Հարցնել','Спросить')}</button>
  </form>
  {home&&<p className="text-caption text-muted-foreground">{t('Use the arrow to send. Enter adds a line on your phone.','Ուղարկելու համար սեղմեք սլաքը։ Հեռախոսում Enter-ը նոր տող է ավելացնում։','Нажмите стрелку для отправки. Enter на телефоне добавляет строку.')}</p>}
  {!home&&<p className="text-caption text-muted-foreground">{t('Zoe reads and explains the record. She changes nothing, and nothing here reaches the member.','Զոյան կարդում և բացատրում է գրառումը։ Նա ոչինչ չի փոխում, և այստեղից ոչինչ չի հասնում անդամին։','Зоя читает и объясняет запись. Она ничего не меняет, и ничего отсюда не доходит до участника.')}</p>}
  </div>
 </div>;
}

export function StaffZoePane({role,locale,conversation,refused,recent}:{role:'doctor'|'nurse';locale:L;conversation:ConversationRead|null;refused:boolean;recent:{id:string;name:string|null;birthYear:number|null;at:string}[]}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return <div className="mx-auto max-w-3xl space-y-4">
  <header className="space-y-1"><h1 className="text-h1">{t('Ask Zoe','Հարցնել Զոյային','Спросить Зою')}</h1><p className="text-body2 text-muted-foreground">{t('One member at a time, from what is on the record.','Մեկ անդամ միաժամանակ, գրառման հիման վրա։','Один участник за раз, по данным записи.')}</p></header>
  {refused&&<p role="alert" className="text-body2">{staffZoeRefusal('access',locale)}</p>}
  {conversation?<StaffZoeChat conversation={conversation} role={role} locale={locale}/>:<Finder locale={locale} recent={recent}/>}
 </div>;
}
