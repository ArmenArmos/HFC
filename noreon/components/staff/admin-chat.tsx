'use client';
import {lazy,Suspense,useCallback,useRef,useState,useTransition} from 'react';
import {useRealtimeSignals,useSignalNotices} from '@/components/realtime/use-realtime-signals';
import {SignalNotices} from '@/components/realtime/signal-notices';
import Link from 'next/link';
import {AdminActionCards} from './admin-action-cards';
import type {Route} from 'next';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {ADMIN_INTENTS,waitingAge,type AdminIntent,type AdminChatResult,type OperationsView,type WorkItem} from '@/lib/admin-chat/contracts';
/** WP V: loaded only when voice is on, or when the voice settings card is opened. */
const StaffVoiceBar=lazy(()=>import('./staff-voice-bar').then(m=>({default:m.StaffVoiceBar})));
const VoiceSettingsCard=lazy(()=>import('./voice-settings-card').then(m=>({default:m.VoiceSettingsCard})));

export type AdminChatLocale=StaffLocale;
export const adminQuestions:Record<AdminIntent,[string,string,string]>={
 'ldl-overdue':['How many members have an overdue LDL re-test?','Քանի՞ անդամի LDL կրկնակի հետազոտությունն է ուշացել։','У скольких участников просрочен повторный анализ LDL?'],
 'doctor-waiting':['Who is waiting for a doctor?','Ո՞վ է սպասում բժշկի նշանակմանը։','Кто ожидает назначения врача?'],
 'nurse-waiting':['Who is waiting for a nurse?','Ո՞վ է սպասում բուժքրոջ նշանակմանը։','Кто ожидает назначения медсестры?'],
 'test-requests':['Whose test requests are waiting?','Ո՞ւմ հետազոտության հարցումներն են սպասում։','Чьи заявки на анализы ожидают решения?'],
 tasks:['Which coordination tasks are active?','Ո՞ր համակարգման առաջադրանքներն են ակտիվ։','Какие задачи по координации активны?'],
 operations:["What's waiting?",'Ի՞նչ է սպասում։',"Какие дела ждут решения?"],
 unassigned:['Who needs a care team?','Ո՞ւմ է պետք խնամքի թիմ։',"Кому нужна команда заботы?"],
 registrations:['Which registrations are incomplete?','Ո՞ր գրանցումներն են անավարտ։',"Какие регистрации не завершены?"],
 callbacks:['Who asked for a callback?','Ո՞վ է հետադարձ կապ խնդրել։',"Кто просил перезвонить?"],
 bookings:['Which bookings are pending?','Ո՞ր ամրագրումներն են սպասում։',"Какие записи на приём ожидают ответа?"],
 delivery:['Which deliveries need attention?','Ո՞ր առաքումներն են ուշադրություն պահանջում։',"Какие проблемы с доставкой требуют внимания?"],
 overdue:['Show overdue and waiting work','Ցույց տալ ժամկետանց և սպասող գործերը',"Показать просроченные и ожидающие дела"],
};
const titles:Record<AdminIntent,[string,string,string]>={'ldl-overdue':['Overdue LDL re-tests','Ուշացած LDL կրկնակի հետազոտություններ','Просроченные повторные анализы LDL'],'doctor-waiting':['Waiting for a doctor','Սպասում են բժշկի նշանակմանը','Ожидают назначения врача'],'nurse-waiting':['Waiting for a nurse','Սպասում են բուժքրոջ նշանակմանը','Ожидают назначения медсестры'],'test-requests':['Test requests waiting','Սպասող հետազոտության հարցումներ','Ожидающие заявки на анализы'],tasks:['Active coordination tasks','Ակտիվ համակարգման առաջադրանքներ','Активные задачи по координации'],operations:['Operations today','Այսօրվա գործերը',"Дела на сегодня"],unassigned:['Care-team assignments','Խնամքի թիմի նշանակում',"Назначение команды заботы"],registrations:['Incomplete registrations','Անավարտ գրանցումներ',"Незавершённые регистрации"],callbacks:['Callback requests','Հետադարձ կապի հարցումներ',"Просьбы перезвонить"],bookings:['Pending bookings','Սպասող ամրագրումներ',"Записи на приём в ожидании"],delivery:['Delivery problems','Առաքման խնդիրներ',"Проблемы с доставкой"],overdue:['Overdue and waiting work','Ժամկետանց և սպասող գործեր',"Просроченные и ожидающие дела"]};
const workNames:Record<WorkItem['kind'],[string,string,string]>={'ldl-retest':['LDL re-test overdue','LDL կրկնակի հետազոտությունը ուշացել է','Повторный анализ LDL просрочен'],'test-request':['Test requests waiting','Սպասող հետազոտության հարցումներ','Ожидающие заявки на анализы'],assignment:['Assign a care team','Նշանակել խնամքի թիմ',"Назначить команду заботы"],registration:['Complete registration','Ավարտել գրանցումը',"Завершить регистрацию"],callback:['Callback request','Հետադարձ կապի հարցում',"Просьба перезвонить"],booking:['Clinic response pending','Սպասում է կլինիկայի պատասխանին',"Ожидается ответ клиники"],delivery:['Delivery needs attention','Առաքումն ուշադրություն է պահանջում',"Доставка требует внимания"],task:['Coordination task','Համակարգման առաջադրանք',"Задача по координации"]};
const roles:Record<WorkItem['owner'],[string,string,string]>={admin:['Noreon administrator','Նորեոն Հելթի ադմինիստրատոր',"Администратор Нореон Хелс"],doctor:['Doctor','Բժիշկ',"Врач"],nurse:['Nurse','Բուժքույր',"Медсестра"],member:['Member','Անդամ',"Участник"],clinic:['Clinic','Կլինիկա',"Клиника"]};
const bookingNames:Record<NonNullable<WorkItem['bookingState']>,[string,string,string]>={'clinic-response':['Clinic response pending','Սպասում է կլինիկայի պատասխանին',"Ожидается ответ клиники"],'start-scheduling':['Scheduling notice not sent','Ամրագրման ծանուցումը չի ուղարկվել',"Уведомление о записи не отправлено"],'check-scheduling':['Check scheduling delivery','Ստուգել ամրագրման ծանուցման առաքումը',"Проверить доставку уведомления о записи"],'member-proposal':['Clinic proposal awaiting member','Կլինիկայի առաջարկը սպասում է անդամին',"Предложение клиники ожидает ответа участника"]};


export function AdminOperationsCard({view,locale,onAsk,disabled=false}:{view:OperationsView;locale:AdminChatLocale;onAsk?:(intent:AdminIntent)=>void;disabled?:boolean}){
 const pick=(copy:[string,string,string])=>st(locale,...copy),t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const s=view.summary;
 const incomplete=view.unavailable.length>0||view.partial.length>0||view.disabled.length>0;
 return <section className="space-y-4 rounded-xl bg-card p-4" aria-label={pick(titles[view.intent])}>
  <h2 className="text-h3">{pick(titles[view.intent])}</h2>
  <p className="text-caption text-muted-foreground">{t('Read at','Կարդացվել է',"Данные на")} <time dateTime={view.asOf}>{view.asOf.replace('T',' ').replace(/\.\d+Z$/,' UTC').replace(/Z$/,' UTC')}</time></p>
  {view.unavailable.map(source=><p key={source} role="alert" className="text-body2">{pick(titles[source])}: {t('unavailable. Choose the question again or open the full page.','անհասանելի է։ Կրկին ընտրեք հարցը կամ բացեք ամբողջական էջը։',"данные недоступны. Выберите вопрос ещё раз или откройте полную страницу.")}</p>)}
  {view.partial.map(source=><p key={source} role="status" className="text-body2">{pick(titles[source])}: {t('only part of the queue was read. Open the full page for more records.','հերթի միայն մի մասն է կարդացվել։ Մնացած գրառումների համար բացեք ամբողջական էջը։',"загружена только часть очереди. Остальные записи доступны на полной странице.")}</p>)}
  {view.disabled.map(source=><p key={source} role="status" className="text-body2">{pick(titles[source])}: {t('not switched on.','միացված չէ։',"раздел не включён.")}</p>)}
  {s&&<ul className="space-y-2 text-body2">
   {([
    ['doctor-waiting',s.cases.doctorUnassigned],
    ['nurse-waiting',s.cases.nurseUnassigned],
    ['test-requests',s.bookings.requested+s.bookings.providerProposed+s.bookings.changePending],
    ['tasks',s.coordination.open+s.coordination.awaitingMember+s.coordination.awaitingDoctor],
   ] as const).map(([intent,count])=><li key={intent}><button type="button" disabled={disabled||!onAsk} onClick={()=>onAsk?.(intent)} className="min-h-11 text-left underline underline-offset-4 disabled:opacity-50">{pick(titles[intent])}: <strong>{count}</strong></button></li>)}
  </ul>}
  {view.intent==='overdue'&&<p className="text-body2 text-muted-foreground">{t('Oldest records first. Age is measured from the recorded step or creation date. Only a saved due date marks work overdue; age does not indicate clinical urgency.','Սկզբում՝ ամենահին գրառումները։ Տևողությունը հաշվվում է գրանցված քայլի կամ ստեղծման ամսաթվից։ Միայն պահպանված վերջնաժամկետն է գործը դարձնում ժամկետանց։ Տևողությունը չի որոշում կլինիկական հրատապությունը։',"Сначала показаны самые старые записи. Время ожидания считается от даты сохранённого этапа или создания записи. Дело считается просроченным только при наличии сохранённого срока. Время ожидания не указывает на медицинскую срочность.")}</p>}
  {view.intent==='ldl-overdue'&&view.unavailable.length===0&&view.disabled.length===0&&<p className="text-body2" data-ldl-overdue-count><strong>{view.items.length}</strong> {t(view.items.length===1?'member has an overdue LDL re-test.':'members have an overdue LDL re-test.',view.items.length===1?'անդամի LDL կրկնակի հետազոտությունը ուշացել է։':'անդամների LDL կրկնակի հետազոտությունը ուշացել է։',view.items.length===1?'участник с просроченным повторным анализом LDL.':'участников с просроченным повторным анализом LDL.')}</p>}
  {view.intent==='delivery'&&<p className="text-caption text-muted-foreground">{t('Telegram problems from the last 30 days.','Telegram-ի առաքման խնդիրները վերջին 30 օրում։',"Проблемы с доставкой в Telegram за последние 30 дней.")}</p>}
  {view.notices.map(notice=><p key={notice} role="status" className="text-body2">{notice==='held-wording'?t('Automatic messages are held pending wording approval.','Ավտոմատ հաղորդագրությունները սպասում են ձևակերպման հաստատմանը։',"Автоматические сообщения приостановлены до согласования текста."):notice==='incoming-failed'?t('Some incoming messages could not be processed. Check delivery problems.','Որոշ մուտքային հաղորդագրություններ չեն մշակվել։ Ստուգեք առաքման խնդիրները։',"Не удалось обработать часть входящих сообщений. Проверьте проблемы с доставкой."):t('Incoming messages are waiting to be processed.','Մուտքային հաղորդագրությունները սպասում են մշակման։',"Входящие сообщения ожидают обработки.")}</p>)}
  {view.items.length>0?<ul className="divide-y">{view.items.map(item=>{
   const age=waitingAge(item.since,view.asOf),due=item.dueAt?Date.parse(item.dueAt):NaN;
   return <li key={item.id} className="space-y-1 py-3 text-body2 first:pt-0">
    <Link href={item.href as Route} className="inline-flex min-h-11 items-center gap-2 font-medium underline underline-offset-4">{item.memberName||t('Member without a name','Անդամ՝ առանց անվան',"Участник без имени")} · {pick(item.bookingState?bookingNames[item.bookingState]:workNames[item.kind])}{item.requestCount!==undefined?`: ${item.requestCount}`:''}</Link>
    <p>{t('Responsible','Պատասխանատու',"Ответственный")}: {pick(roles[item.owner])}{item.ownerName?` · ${item.ownerName}`:''}</p>
    <p className="text-caption text-muted-foreground">{age===null?t('Record age not recorded','Գրառման տևողությունը գրանցված չէ',"Время ожидания не указано"):t(`Record age: ${age} days`,`Գրառման տևողությունը՝ ${age} օր`,`Время ожидания: ${age} дн.`)}{age!==null&&age>=7&&<span className="ml-2 rounded-md bg-muted px-2 py-1 font-medium">{age>=14?'14+':'7+'} {t('days old','օր',"дн.")}</span>}</p>
    {Number.isFinite(due)&&<p className="text-caption">{due<Date.parse(view.asOf)?t('Saved due date passed','Պահպանված վերջնաժամկետն անցել է',"Сохранённый срок истёк"):t('Saved due date','Պահպանված վերջնաժամկետ',"Сохранённый срок")}: <time dateTime={item.dueAt!}>{item.dueAt}</time></p>}
   </li>;
  })}</ul>:view.intent!=='operations'&&!incomplete&&view.notices.length===0&&<p className="text-body2">{t('Nothing waiting in this queue.','Այս հերթում սպասող գործ չկա։',"В этой очереди нет ожидающих дел.")}</p>}
  {view.intent==='overdue'&&<p className="text-caption text-muted-foreground">{t('This view covers care-team assignments, incomplete registrations, callbacks, saved pending bookings, Telegram delivery problems from the last 30 days and active coordination tasks. Each persisted piece of work appears once.','Այս տեսքը ներառում է խնամքի թիմի նշանակումները, անավարտ գրանցումները, հետադարձ կապի հարցումները, պահպանված սպասող ամրագրումները, վերջին 30 օրվա Telegram-ի առաքման խնդիրները և ակտիվ համակարգման առաջադրանքները։ Յուրաքանչյուր պահպանված գործ երևում է մեկ անգամ։',"Здесь показаны назначения команды заботы, незавершённые регистрации, просьбы перезвонить, сохранённые записи на приём в ожидании, проблемы с доставкой в Telegram за последние 30 дней и активные задачи по координации. Каждое сохранённое дело показано один раз.")}</p>}
 </section>;
}

/** Ephemeral, fixed questions. Every tap authenticates again on the server. */
/** voice (WP V): push-to-talk and hands-free for the Noreon administrator; words only open a question or the voice settings card. */
export function AdminChat({initial,locale,readAction,voice}:{initial:AdminChatResult;locale:AdminChatLocale;readAction:(intent:AdminIntent)=>Promise<AdminChatResult>;voice?:{available:boolean;live:boolean}}){
 const [result,setResult]=useState(initial),[question,setQuestion]=useState<AdminIntent>('operations'),[pending,start]=useTransition();
 const menu=useRef<HTMLDetailsElement>(null);
 const [working,setWorking]=useState(false);const workingRef=useRef(false),reading=useRef(false);
 const [voiceSettings,setVoiceSettings]=useState(false);
 const pick=(copy:[string,string,string])=>st(locale,...copy);
 // WP R: queue changes (admin care-queue tasks, coordination tasks, bookings) arrive as worklist signals with ids only;
 // the notice offers to read the operations view again. Nothing is re-read under the administrator's eyes.
 const {notices,push,dismiss}=useSignalNotices();
 useRealtimeSignals({plane:'staff',enabled:result.kind!=='off',onSignal:useCallback((kind:string,ref:string|null)=>{if(kind==='worklist')push(kind,ref);},[push])});
 function ask(intent:AdminIntent){
  if(reading.current||workingRef.current)return;
  reading.current=true;
  if(menu.current)menu.current.open=false;
  setQuestion(intent);
  start(async()=>{
   // Remove earlier data when a new read starts, including after revoked access.
   setResult({kind:'unavailable'});
   try{setResult(await readAction(intent));}catch{setResult({kind:'unavailable'});}finally{reading.current=false;}
  });
 }
 if(result.kind==='off')return null;
 return <div className="dw" lang={locale}>
  <header className="dw-heading gap-3"><h1 className="text-h2">{pick(['Your operations with Zoe','Ձեր գործերը Զոյայի հետ',"Ваши дела с Зои"])}</h1>
   <details ref={menu} className="relative"><summary className="dw-pill min-h-11 cursor-pointer text-body2">{pick(['More questions','Այլ հարցեր','Другие вопросы'])}</summary>
    <div className="mt-2 space-y-3 rounded-xl border bg-card p-4">
     <nav aria-label={pick(['Questions you can ask','Հարցեր, որոնք կարող եք տալ','Вопросы, которые можно задать'])} className="flex flex-col items-start">{ADMIN_INTENTS.map(intent=><button key={intent} type="button" disabled={pending||working} aria-pressed={question===intent} onClick={()=>ask(intent)} className="min-h-11 text-left text-body2 underline">{pick(adminQuestions[intent])}</button>)}
      <button type="button" disabled={pending||working} aria-pressed={voiceSettings} onClick={()=>{if(menu.current)menu.current.open=false;setVoiceSettings(true);}} className="min-h-11 text-left text-body2 underline">{pick(['Voice settings','Ձայնի կարգավորումներ','Настройки голоса'])}</button></nav>

    </div>
   </details>
   {voice?.available&&<Suspense fallback={null}><StaffVoiceBar locale={locale} role="noreon_admin" available={voice.available} live={voice.live} onIntent={action=>{
    if(action.kind==='open_voice_settings'){setVoiceSettings(true);return true;}
    if(action.kind==='open_operations'){ask('operations');return true;}
    if(action.kind==='open_worklist'){ask('overdue');return true;}
    return false;
   }}/></Suspense>}
  </header>
   <section className="dw-chat mx-auto w-full max-w-3xl space-y-4" aria-label={pick(['Operations chat','Գործերի զրույց',"Чат по делам"])} aria-busy={pending}>
    <SignalNotices notices={notices} locale={locale} onDismiss={dismiss} actions={{worklist:()=>ask(question==='operations'?'operations':question)}}/>
    {question!=='operations'&&<div className="flex justify-end"><p className="max-w-full rounded-xl bg-primary p-4 text-body2 text-primary-foreground">{pick(adminQuestions[question])}</p></div>}
    <div aria-live="polite">{pending?<p role="status" className="rounded-xl bg-card p-4">{pick(['Reading current records…','Կարդացվում են ընթացիկ գրառումները…',"Загружаем актуальные записи…"])}</p>:result.kind==='ready'?<AdminOperationsCard view={result.view} locale={locale} onAsk={ask} disabled={pending||working}/>:<p role="alert" className="rounded-xl bg-card p-4 text-body2">{result.kind==='denied'?pick(['This workspace is unavailable for your account. Open operations to continue.','Այս աշխատատարածքը ձեր հաշվի համար անհասանելի է։ Շարունակելու համար բացեք գործերի էջը։',"Этот раздел недоступен для вашей учётной записи. Откройте дела, чтобы продолжить."]):pick(['The records could not be read. Choose a question to try again or open operations.','Գրառումները չհաջողվեց կարդալ։ Կրկին ընտրեք հարցը կամ բացեք գործերի էջը։',"Не удалось загрузить записи. Выберите вопрос, чтобы повторить попытку, или откройте дела."])}</p>}</div>
    {voiceSettings&&<Suspense fallback={<p role="status" className="text-body2">{pick(['Opening voice settings…','Բացում եմ ձայնի կարգավորումները…','Открываю настройки голоса…'])}</p>}><VoiceSettingsCard locale={locale} onClose={()=>setVoiceSettings(false)}/></Suspense>}
    {(result.kind!=='denied')&&<AdminActionCards locale={locale} onWorkingChange={value=>{workingRef.current=value;setWorking(value);}} onUnavailable={kind=>setResult({kind})}/>}
   </section>
 </div>;
}
