import Link from 'next/link';
import type {Route} from 'next';
import {notFound,unstable_rethrow} from 'next/navigation';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {CareSection,Status,stamp} from '@/components/patient-care/common';
import {staffLocale} from '@/lib/staff/staff-locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {actionLabel,careQueueInboxSchema,isOverdue,queueForRole,redFlagsLabel,statusLabel,taskReasons,zoneLabel,type CareQueueTask} from '@/lib/care-queue/contracts';
import {markCareQueueTask} from '@/lib/care-queue/actions';
import type {Locale} from '@/lib/locale';
import {readNurseAlerts} from '@/lib/care-alerts/nurse';
import {NurseUrgentAlerts,NurseUrgentAlertRow,NurseAlertReadFailure} from '@/components/staff/nurse-urgent-alerts';
import {CoordinatorVoice} from '@/components/staff/coordinator-voice';
import {staffLiveAvailable,staffVoiceAvailable} from '@/lib/staff-zoe/voice';
export const dynamic='force-dynamic';

const notices:Record<string,[string,string,string]>={
 seen:['Marked as seen.','Նշվել է որպես տեսած։','Отмечено как просмотренное.'],
 answered:['Marked as answered.','Նշվել է որպես պատասխանված։','Отмечено как отвеченное.'],
 changed:['This task changed while you were looking at it. Check it and try again.','Առաջադրանքը փոխվել է։ Ստուգեք և փորձեք նորից։','Эта задача изменилась, пока вы её просматривали. Проверьте её и повторите попытку.'],
 invalid:['That did not go through. Reload and try again.','Չստացվեց։ Թարմացրեք էջը և փորձեք նորից։','Не удалось выполнить действие. Обновите страницу и повторите попытку.'],
 access:['This queue is for nurses, doctors and admins.','Այս հերթը բուժքույրերի, բժիշկների և ադմինների համար է։','Эта очередь для медсестёр, врачей и администраторов.'],
 unavailable:['That did not go through. Reload and try again.','Չստացվեց։ Թարմացրեք էջը և փորձեք նորից։','Не удалось выполнить действие. Обновите страницу и повторите попытку.'],
};

function MarkButton({task,to,view,primary,children}:{task:CareQueueTask;to:'seen'|'answered';view:string;primary:boolean;children:React.ReactNode}){
 return <form action={markCareQueueTask}>
  <input type="hidden" name="taskId" value={task.id}/><input type="hidden" name="seq" value={task.stateSeq}/><input type="hidden" name="to" value={to}/><input type="hidden" name="view" value={view}/>
  <button className={`inline-flex min-h-11 items-center rounded-md px-4 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring ${primary?'bg-primary text-primary-foreground':'border'}`}>{children}</button>
 </form>;
}

function TaskCard({task,asOf,view,l}:{task:CareQueueTask;asOf:string;view:string;l:Locale}){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const late=isOverdue(task,asOf);
 return <li id={`task-${task.id}`} className="space-y-3 py-4 first:pt-0 last:pb-0">
  <div className="flex flex-wrap items-center gap-2">
   {late?<Status tone="attention">{t('Overdue','Ժամկետանց','Просрочено')}</Status>:<Status tone={task.status==='sent'?'due':'neutral'}>{statusLabel(task.status,l)}</Status>}
   {late&&<span className="text-caption text-muted-foreground">{statusLabel(task.status,l)}</span>}
   {task.zone&&<span className="text-body2 font-semibold">{t('Zone','Գոտի','Зона')}: {zoneLabel(task.zone,l)}</span>}
  </div>
  <p className="text-body2"><Link href={`/staff/real/members/${task.memberId}` as Route} className="font-medium underline underline-offset-4">{task.memberName||t('Member without a name','Անանուն անդամ','Участник без имени')}</Link>: {taskReasons(task,l)}</p>
  {task.redFlagsStatus&&<p className="text-caption text-muted-foreground">{redFlagsLabel(task.redFlagsStatus,l)}</p>}
  {task.suggestedAction&&<p className="text-caption text-muted-foreground">{t('Next step','Հաջորդ քայլը','Следующий шаг')}: {actionLabel(task.suggestedAction,l)}</p>}
  <p className="text-caption text-muted-foreground">{t('Raised','Ստեղծվել է','Создана')} {stamp(task.createdAt,l)}{task.slaDeadline?` · ${t('Answer by','Պատասխանել մինչև','Ответить до')} ${stamp(task.slaDeadline,l)}`:''}</p>
  <div className="flex flex-wrap items-start gap-3">
   {task.status==='sent'&&<MarkButton task={task} to="seen" view={view} primary>{t('Seen','Տեսա','Просмотрено')}</MarkButton>}
   <MarkButton task={task} to="answered" view={view} primary={task.status!=='sent'}>{t('Answered','Պատասխանված է','Отвечено')}</MarkButton>
  </div>
 </li>;
}

/** Open care queue tasks for this staff member. Dark behind NOREON_ZOE_APP_V3. */
export default async function CareQueuePage({searchParams}:{searchParams:Promise<{view?:string;notice?:string}>}){
 if(!zoeAppV3Enabled())notFound();
 const {client,identity}=await requireRealStaff();
 const queue=queueForRole(identity.role);
 if(!queue)notFound();
 const l=await staffLocale(identity.role),t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const {view:rawView,notice}=await searchParams,view=rawView==='sandbox'?'sandbox':'live';
 // A nurse's urgent alerts come first: an urgent alert on her member must never read as "No open tasks".
 const alerts=queue==='nurse'&&view==='live'?await readNurseAlerts(client):undefined;
 const urgent=<NurseUrgentAlerts read={alerts} locale={l} voice={identity.role==='nurse'&&await staffVoiceAvailable('NURSE')}/>;
 let inbox:ReturnType<typeof careQueueInboxSchema.parse>;
 try{const {data,error}=await client.rpc('care_queue_inbox',{p_queue:queue,p_view:view});if(error)throw Error('unavailable');inbox=careQueueInboxSchema.parse(data);}
 catch(error){unstable_rethrow(error);return <div className="space-y-6">{urgent}<CareSection title={t('Tasks unavailable','Առաջադրանքները հասանելի չեն','Задачи недоступны')}><p className="text-body2">{t('The list could not be loaded. Reload to try again.','Ցանկը չբեռնվեց։ Թարմացրեք էջը։','Не удалось загрузить список. Обновите страницу, чтобы повторить попытку.')}</p></CareSection></div>;}
 const msg=notice?notices[notice]:undefined;
 const listTitle=view==='live'?(queue==='nurse'?t('Open work','Բաց աշխատանք','Открытая работа'):t('Open tasks','Բաց առաջադրանքներ','Открытые задачи')):t('Test accounts','Թեստային հաշիվներ','Тестовые аккаунты');
 return <div className="space-y-6">
  <header className="max-w-3xl space-y-2"><h1 className="text-h1">{t('Care queue','Խնամքի հերթ','Очередь задач')}</h1>
   {identity.role==='coordinator'&&await staffVoiceAvailable('COORDINATOR')&&<CoordinatorVoice locale={l} available live={await staffLiveAvailable('COORDINATOR')}/>}
   <p className="text-body2 text-muted-foreground">{queue==='admin'
    ?t('Booking and logistics work to arrange. Each task says what to do next.','Կազմակերպման և ամրագրման աշխատանք։ Յուրաքանչյուր առաջադրանք ասում է հաջորդ քայլը։','Записи и организационные задачи. В каждой задаче указан следующий шаг.')
    :queue==='nurse'?t('Urgent alerts come first, followed by work for your members.','Շտապ ազդանշանները սկզբում են, ապա՝ ձեր անդամների աշխատանքը։','Сначала срочные оповещения, затем работа для ваших участников.'):t('Members who were told this is with you. The nearest deadline comes first.','Անդամներ, որոնց ասվել է, որ սա ձեզ մոտ է։ Ամենամոտ ժամկետը առաջինն է։','Участники, которым сообщили, что вопрос у вас. Сначала идёт самый ранний срок.')}</p></header>
  {msg&&<p role="status" className="rounded-md border bg-background p-3 text-body2">{t(msg[0],msg[1],msg[2])}</p>}
  <nav className="flex gap-2" aria-label={t('Task lists','Առաջադրանքների ցանկեր','Списки задач')}>
   {(['live','sandbox']as const).map(v=><Link key={v} href={`/staff/real/care-queue${v==='sandbox'?'?view=sandbox':''}` as Route} aria-current={view===v?'page':undefined}
    className={`inline-flex min-h-11 items-center rounded-md px-4 text-body2 font-medium ${view===v?'bg-primary text-primary-foreground':'border'}`}>{v==='live'?t('Open tasks','Բաց առաջադրանքներ','Открытые задачи'):t('Test accounts','Թեստային հաշիվներ','Тестовые аккаунты')}</Link>)}
  </nav>
  <NurseAlertReadFailure read={alerts} locale={l}/>
  {!inbox.tasks.length&&!(alerts?.kind==='ready'&&alerts.alerts.length)&&alerts?.kind!=='unavailable'?<CareSection title={t('No open tasks','Բաց առաջադրանքներ չկան','Нет открытых задач')}><p className="text-body2">{t('Nothing to show here right now.','Այստեղ առայժմ ոչինչ չկա։','Пока здесь ничего нет.')}</p></CareSection>
   :<CareSection title={listTitle}><ul className="divide-y">{alerts?.kind==='ready'&&alerts.alerts.map(alert=><li key={`alert:${alert.id}`} className="space-y-3 py-4"><NurseUrgentAlertRow alert={alert} locale={l}/></li>)}{inbox.tasks.map(task=><TaskCard key={task.id} task={task} asOf={inbox.asOf} view={view} l={l}/>)}</ul></CareSection>}
  {alerts?.kind==='ready'&&alerts.total>alerts.alerts.length&&<p role="status">{t('More urgent alerts exist. Reload or ask the doctor to review the rest.','Կան այլ շտապ ազդանշաններ։ Թարմացրեք կամ խնդրեք բժշկին դիտել մնացածը։','Есть другие срочные оповещения. Обновите список или попросите врача просмотреть остальные.')}</p>}
  <p className="text-caption text-muted-foreground">{t('As of','Առ','По состоянию на')} {stamp(inbox.asOf,l)}</p>
 </div>;
}
