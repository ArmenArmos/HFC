import Link from 'next/link';
import type {Route} from 'next';
import {notFound,redirect,unstable_rethrow} from 'next/navigation';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {nurseTodayHref} from '@/lib/nurse-chat/config';
import {CareSection,Status,stamp} from '@/components/patient-care/common';
import {staffLocale} from '@/lib/staff/staff-locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {careAlertsEnabled} from '@/lib/care-alerts/contracts';
import {AlertCardLines} from '@/components/staff/alert-card';
import {CareAlertResolve} from '@/components/staff/care-alert-resolve';
import {acknowledgeCareAlert,resolveCareAlert} from '@/lib/care-alerts/actions';
import {SelectField} from '@/components/ui/select-field';
import {aiLabel,confidenceLabel,draftActions,itemSummary,laneEmpty,laneGroups,laneTitle,notApprovableReason,primaryAction,rejectReasonLabel,rejectReasons,type AlertItem,type InboxItem,type L,type Lane} from '@/lib/doctor-inbox/contracts';
import {approveInboxDraft,rejectInboxDraft} from './actions';
import {zoeMarkNotices} from '@/lib/doctor-inbox/zoe-answered';
import {ZoeAnsweredSection} from '@/components/doctor-inbox/zoe-answered';
import {NurseActivity} from '@/components/doctor-inbox/nurse-activity';
import {MedicineConcernsSection} from '@/components/doctor-inbox/medicine-concerns';
import {type MedicinesRpc} from '@/lib/member-medicines/server';
import {FirstNoteQueue} from '@/components/staff/first-note-queue';
import {LdlResponsesSection} from '@/components/doctor-inbox/ldl-responses';
import {readDoctorDay,doctorDayCounts,type DoctorDay} from '@/lib/doctor-inbox/day';
import {mergeUrgent} from '@/lib/doctor-inbox/urgent-windows';
import {sourcesLine} from '@/lib/doctor-inbox/source-labels';
import {UrgentWindowRow} from '@/components/doctor-inbox/urgent-window';
import {doctorChatHomeEnabled} from '@/lib/staff-zoe/workspace-config';
import {OverdueTaskCards} from '@/components/staff/doctor-workspace/day-cards';
import {NurseHandoffs} from '@/components/staff/nurse-handoffs';
export const dynamic='force-dynamic';

const notices:Record<string,[string,string,string]>={
 acknowledged:['Alert acknowledged. It stays here until you resolve it.','Ահազանգը հաստատված է։ Այն կմնա այստեղ, մինչև լուծեք։','Оповещение подтверждено. Оно останется здесь, пока вы его не закроете.'],
 resolved:['Alert resolved.','Ահազանգը լուծված է։','Оповещение закрыто.'],
 changed:['This alert changed while you were looking at it, for example the member wrote again. Check it and try again.','Ահազանգը փոխվել է, օրինակ՝ անդամը կրկին գրել է։ Ստուգեք և փորձեք նորից։','Это оповещение изменилось, пока вы его просматривали, например участник написал снова. Проверьте его и попробуйте ещё раз.'],
 invalid:['Choose an outcome and write the reason. An alert is closed with both.','Ընտրեք արդյունքը և գրեք պատճառը։ Ահազանգը փակվում է երկուսով։','Выберите исход и напишите причину. Оповещение закрывается с обоими.'],
 access:['Only doctors and admins can act on alerts.','Ահազանգերով կարող են զբաղվել միայն բժիշկներն ու ադմինները։','Только врачи и администраторы могут работать с оповещениями.'],
 unavailable:['That did not go through. Reload and try again.','Չստացվեց։ Թարմացրեք էջը և փորձեք նորից։','Не удалось выполнить действие. Обновите страницу и попробуйте ещё раз.'],
 draft_approved:['Reply approved. The member receives exactly that text under your name; check delivery in the conversation.','Պատասխանը հաստատված է։ Անդամը կստանա հենց այդ տեքստը ձեր անունով, առաքումը ստուգեք զրույցում։','Ответ утверждён. Участник получит именно этот текст от вашего имени. Проверьте доставку в переписке.'],
 draft_rejected:['Draft rejected and your reason saved. Nothing was sent. Write your own reply in the conversation.','Նախագիծը մերժված է, պատճառը պահպանված է։ Ոչինչ չի ուղարկվել։ Գրեք ձեր պատասխանը զրույցում։','Черновик отклонён, причина сохранена. Ничего не отправлено. Напишите свой ответ в переписке.'],
 draft_rejected_no_reason:['Draft rejected. Nothing was sent. Your reason could not be saved.','Նախագիծը մերժված է։ Ոչինչ չի ուղարկվել։ Պատճառը չհաջողվեց պահպանել։','Черновик отклонён. Ничего не отправлено. Не удалось сохранить причину.'],
 draft_changed:['This draft changed or is no longer current, so nothing was sent. Check the item again.','Նախագիծը փոխվել է կամ այլևս ընթացիկ չէ, ոչինչ չի ուղարկվել։ Կրկին ստուգեք։','Этот черновик изменился или больше не актуален, поэтому ничего не отправлено. Проверьте элемент ещё раз.'],
 draft_invalid:['Choose a reason. For "Other", add a short note.','Ընտրեք պատճառը։ «Այլ»-ի դեպքում ավելացրեք կարճ նշում։','Выберите причину. Для варианта «Другое» добавьте короткое примечание.'],
 ...zoeMarkNotices,
 ldl_reviewed:['LDL result marked reviewed.','ՑԽԼ արդյունքը նշված է որպես վերանայված։','Результат ЛПНП отмечен как рассмотренный.'],
};
const unavailableName:Record<string,[string,string,string]>={care_alerts:['care alerts','խնամքի ահազանգեր','оповещения'],urgent_windows:['urgent conversations','շտապ զրույցներ','срочные разговоры'],lab:['lab values','լաբորատոր արժեքներ','лабораторные показатели'],programme:['programme reviews','ծրագրի վերանայումներ','проверки программы'],
 plan:['care plan drafts','պլանի նախագծեր','черновики плана лечения'],replies:['replies','պատասխաններ','ответы'],intake:['symptom questions','ախտանիշների հարցեր','вопросы о симптомах'],
 zoe_answered:['answers by Zoe','Զոյայի պատասխաններ','ответы Zoe'],first_notes:['first notes','առաջին գրառումներ','первые сообщения'],nurse_activity:['nurse replies','բուժքրոջ պատասխաններ','ответы медсестры']};
const button='inline-flex min-h-11 items-center rounded-md px-4 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring';

function Sources({item,l}:{item:{sources:{type:string;ref:string;page?:number|null}[]};l:L}){
 if(!item.sources.length)return null;
 return <p className="break-words text-caption text-muted-foreground">{st(l,'Sources','Աղբյուրներ','Источники')}: {sourcesLine(item.sources,l)}</p>;
}

function AlertRow({item,l,actions,closer}:{item:AlertItem;l:L;actions:boolean;closer:string}){
 const a=item.alert,t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 return <li className="space-y-2 py-4 first:pt-0 last:pb-0">
  <div className="flex flex-wrap items-center gap-2">
   <Status tone="attention">{a.state==='open'?(a.acknowledgedAt?t('Open again','Կրկին բաց','Снова открыто'):t('Open','Բաց','Открыто')):t('Acknowledged','Հաստատված','Подтверждено')}</Status>
  </div>
  <p className="text-body2"><Link href={`/staff/real/members/${a.memberId}` as Route} className="font-medium underline underline-offset-4">{a.memberName||t('Member without a name','Անանուն անդամ','Участник без имени')}</Link></p>
  <AlertCardLines alert={a} locale={l}/>
  {actions&&<div className="flex flex-wrap items-start gap-3">
   {a.state==='open'&&<form action={acknowledgeCareAlert}><input type="hidden" name="alertId" value={a.id}/><input type="hidden" name="seq" value={a.stateSeq}/><input type="hidden" name="from" value="today"/>
    <button className={`${button} bg-primary text-primary-foreground`}>{t('Acknowledge','Հաստատել','Подтвердить')}</button></form>}
   <CareAlertResolve alert={a} locale={l} closer={closer} action={resolveCareAlert} from="today"/>
  </div>}
 </li>;
}

const quoteKind:Record<string,[string,string,string]>={instruction:['instructions','հրահանգներ','инструкции'],explanation:['explanation','բացատրություն','объяснение'],next_step:['next step','հաջորդ քայլ','следующий шаг'],medicine:['medicine','դեղամիջոց','лекарство']};

/** The draft's exact text and the one-tap decisions. Approve and Reject post to the conversation review's own commands. */
function DraftBlock({item,l}:{item:InboxItem;l:L}){
 const d=item.draft!,t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru),acts=draftActions(item),why=notApprovableReason(d,l);
 const conversation=`/staff/real/conversations/${item.memberId}#conversation-reply`;
 const bound=<><input type="hidden" name="memberId" value={item.memberId}/><input type="hidden" name="draftId" value={d.draftId}/>
  <input type="hidden" name="revision" value={d.revision}/><input type="hidden" name="contentHash" value={d.contentHash}/></>;
 const quotes=item.sources.filter(s=>s.type==='plan_item');
 return <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
  {d.asked&&<p className="text-caption text-muted-foreground">{t('Member asked','Անդամը հարցրել է','Участник спросил')}: <span className="text-foreground">{d.asked}</span></p>}
  <p className="text-caption font-medium">{d.author==='staff'?t('Your saved revision, not sent','Ձեր պահպանված տարբերակը, չի ուղարկվել','Ваша сохранённая версия, не отправлена'):t('Draft prepared by Zoe (AI), not sent','Նախագիծը պատրաստել է Զոյան (AI), չի ուղարկվել','Черновик подготовлен Zoe (ИИ), не отправлен')}</p>
  <p className="whitespace-pre-wrap break-words text-body2 leading-relaxed">{d.body}</p>
  {d.structured&&<p className="text-caption text-muted-foreground">{quotes.length
   ?t(`Quotes your published plan word for word: ${quotes.map(q=>`${q.ref} (${quoteKind[q.rule??'']?.[0]??''})`).join(', ')}.`,`Բառացի մեջբերում է ձեր հրապարակված պլանից՝ ${quotes.map(q=>`${q.ref} (${quoteKind[q.rule??'']?.[1]??''})`).join(',')}։`,`Дословные цитаты из вашего опубликованного плана лечения: ${quotes.map(q=>`${q.ref} (${quoteKind[q.rule??'']?.[2]??''})`).join(', ')}.`)
   :t('Quotes nothing from the plan.','Պլանից ոչինչ չի մեջբերում։','Нет цитат из плана лечения.')}{d.doctorDecides.length?` ${t('Only you can decide','Միայն դուք կարող եք որոշել','Только вы можете решить')}: ${d.doctorDecides.join('; ')}.`:''}</p>}
  {why&&<p className={`text-caption ${d.openAlert||d.stale?'text-destructive':'text-muted-foreground'}`}>{why}</p>}
  <div className="flex flex-wrap items-start gap-3">
   {acts.approve&&<form action={approveInboxDraft}>{bound}
    <button className={`${button} bg-primary text-primary-foreground`} aria-label={t(`Approve and send this exact reply to ${item.memberName||'the member'}`,`Հաստատել և ուղարկել այս պատասխանը`,`Утвердить и отправить именно этот ответ: ${item.memberName||'участник'}`)}>{t('Approve and send','Հաստատել և ուղարկել','Утвердить и отправить')}</button></form>}
   <Link href={conversation as Route} className={`${button} ${acts.lead==='edit'?'bg-primary text-primary-foreground':'border'}`}>{item.ai==='none'?t('Continue your reply','Շարունակել ձեր պատասխանը','Продолжить ответ'):t('Edit','Խմբագրել','Изменить')}</Link>
   {acts.reject&&<details className="min-w-0 basis-full sm:basis-auto sm:flex-1"><summary className={`${button} cursor-pointer border`}>{t('Reject','Մերժել','Отклонить')}</summary>
    <form action={rejectInboxDraft} className="mt-3 max-w-md space-y-3">{bound}
     <label className="block space-y-1 text-body2"><span className="font-medium">{t('Why are you rejecting it?','Ինչու եք մերժում','Почему вы отклоняете черновик?')}</span>
      <SelectField name="reason" required placeholder={t('Choose one','Ընտրեք','Выберите вариант')} options={rejectReasons.map(r=>({value:r,label:rejectReasonLabel(r,l)}))}/></label>
     <label className="block space-y-1 text-body2"><span className="font-medium">{t('Note (optional, staff only)','Նշում (ըստ ցանկության, միայն աշխատակազմի համար)','Примечание (необязательно, только для сотрудников)')}</span>
      <textarea name="note" maxLength={500} rows={2} className="block w-full rounded-md border bg-background px-3 py-2"/></label>
     <button className={`${button} border border-destructive text-destructive`}>{t('Reject draft, send nothing','Մերժել նախագիծը, ոչինչ չուղարկել','Отклонить черновик без отправки')}</button>
    </form></details>}
  </div>
 </div>;
}

function ItemRow({item,l}:{item:InboxItem;l:L}){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru),primary=primaryAction(item,l);
 return <li className="space-y-2 py-4 first:pt-0 last:pb-0">
  <div className="flex flex-wrap items-center gap-2">
   <span className="text-body2 font-semibold"><Link href={`/staff/real/members/${item.memberId}` as Route} className="underline underline-offset-4">{item.memberName||t('Member without a name','Անանուն անդամ','Участник без имени')}</Link></span>
   {item.draft&&item.ai==='none'?<Status>{t('Your draft','Ձեր նախագիծը','Ваш черновик')}</Status>:<Status tone={item.confidence==='M'||item.confidence==='L'||item.stale?'attention':'neutral'}>{confidenceLabel(item.confidence,l)}</Status>}
   {item.draft&&(item.draft.needsJudgement||item.draft.outsidePlan)&&<Status tone="due">{t('Needs your judgement','Պահանջում է ձեր որոշումը','Требуется ваше решение')}</Status>}
  </div>
  <p className="text-body2">{itemSummary(item,l)}</p>
  <p className="text-caption text-muted-foreground">{aiLabel(item.ai,l)}{item.kind==='checkpoint_due'?'':` · ${t('since','սկսած','с')} ${stamp(item.at,l)}`}</p>
  <Sources item={item} l={l}/>
  {item.draft?<DraftBlock item={item} l={l}/>:<div className="flex flex-wrap gap-3">
   <Link href={primary.href as Route} className={`${button} ${item.lane==='P1'?'bg-primary text-primary-foreground':'border'}`}>{primary.label}</Link>
  </div>}
 </li>;
}

function LaneSection({lane,count,l,children,incomplete=false}:{lane:Lane;count:number;l:L;children:React.ReactNode;incomplete?:boolean}){
 return <section aria-labelledby={`lane-${lane}`} className={`space-y-3 rounded-xl border bg-background p-4 ${lane==='P0'&&count?'border-destructive':''}`}>
  <h2 id={`lane-${lane}`} className="flex flex-wrap items-baseline gap-2 text-h3">{laneTitle(lane,l)}<span data-urgent-count={lane==='P0'?count:undefined} className="text-body2 font-normal text-muted-foreground">{count}</span></h2>
  {count||incomplete?<ul className="divide-y">{children}</ul>:<p className="text-body2 text-muted-foreground">{laneEmpty(lane,l)}</p>}
 </section>;
}

/** The assigned doctor's day: P0 alerts first and in full, then today, this week and routine. Read only; items close in their own screens. */
export default async function DoctorTodayPage({searchParams}:{searchParams:Promise<{notice?:string}>}){
 const {client,identity}=await requireRealStaff();
 if(identity.role==='nurse')redirect(nurseTodayHref());
 if(identity.role!=='doctor')notFound();
 const l=await staffLocale(identity.role),t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 let day:DoctorDay;
 try{day=await readDoctorDay(client as unknown as MedicinesRpc,doctorChatHomeEnabled());}
 catch(error){unstable_rethrow(error);return <CareSection title={t('Today could not be loaded','Այսօրվա ցանկը չբեռնվեց','Не удалось загрузить список на сегодня')}>
  <p className="text-body2">{t('Reload to try again. Open Alerts now to check urgent signals.','Թարմացրեք էջը։ Շտապ ազդանշանները ստուգելու համար բացեք Ահազանգերը։','Обновите страницу и попробуйте ещё раз. Откройте раздел «Оповещения», чтобы проверить срочные сигналы.')}</p>
  <Link href={'/staff/real/alerts' as Route} className={`${button} mt-3 bg-primary text-primary-foreground`}>{t('Open Alerts','Բացել Ահազանգերը','Открыть оповещения')}</Link></CareSection>;}
 const {inbox,medicines,ldl,firstNotes}=day;
 const {notice}=await searchParams,msg=notice?notices[notice]:undefined,groups=laneGroups(inbox),actions=careAlertsEnabled();
 // Medicine concerns (item 5) are their own read and section; they count as waiting.
 const medicineCountRu=medicines?.length?`, о лекарствах: ${medicines.length}`:'';
 // LDL results after a change to treatment (phase 2, dark) are their own read and section; they count as waiting.
 // First notes have their own queue (My members); one that is due is waiting, so Today shows it too.
 const firstNotesWaiting=firstNotes?.enabled?firstNotes.items.length:0;
 const firstNoteCountRu=firstNotesWaiting?`, первых сообщений: ${firstNotesWaiting}`:'';
 const unavailable=firstNotes?inbox.unavailable:[...inbox.unavailable,'first_notes'];
 const {total,alerts:urgentTotal}=doctorDayCounts(day);
 const urgent=mergeUrgent(groups.P0,day.windows);
 const urgentIncomplete=day.urgentCapped||inbox.unavailable.some(source=>source==='care_alerts'||source==='urgent_windows');
 return <div className="mx-auto max-w-3xl space-y-6">
  <header className="space-y-2"><h1 className="text-h1">{t('Today','Այսօր','Сегодня')}</h1>
   {(total>0||!urgentIncomplete)&&<p className="text-body2 text-muted-foreground">{total===0?t('Nothing waiting. New alerts, results and replies for your members appear here.','Սպասող գործեր չկան։ Ձեր անդամների նոր ահազանգերը, արդյունքներն ու պատասխաններն այստեղ կհայտնվեն։','Ожидающих задач нет. Здесь появятся новые оповещения, результаты и ответы для ваших участников.')
    :t(`${urgentTotal} urgent item${urgentTotal===1?'':'s'} now, ${groups.P1.length} for today, ${groups.P2.length} this week, ${groups.P3.length} routine${firstNotesWaiting?`, ${firstNotesWaiting} first note${firstNotesWaiting===1?'':'s'}`:''}${medicines?.length?`, ${medicines.length} about medicines`:''}. AI prepares the drafts; nothing leaves this list until you act on it.`,
     `${urgentTotal} շտապ գործ հիմա, ${groups.P1.length}՝ այսօր, ${groups.P2.length}՝ այս շաբաթ, ${groups.P3.length}՝ ընթացիկ${firstNotesWaiting?`, ${firstNotesWaiting}՝ առաջին գրառում`:''}${medicines?.length?`, ${medicines.length}՝ դեղերի մասին`:''}։ AI-ն պատրաստում է նախագծերը, ոչինչ չի հեռանում ցանկից, քանի դեռ դուք չեք որոշել։`,`Срочных задач: ${urgentTotal}, на сегодня: ${groups.P1.length}, на эту неделю: ${groups.P2.length}, плановых: ${groups.P3.length}${firstNoteCountRu}${medicineCountRu}. ИИ готовит черновики. Элементы остаются в списке, пока вы не примете решение.`)}</p>}</header>
  {msg&&<p role="status" className="rounded-md border bg-background p-3 text-body2">{t(msg[0],msg[1],msg[2])}</p>}
  {unavailable.length>0&&<p role="alert" className="rounded-md border p-3 text-body2">{t('Some items could not be loaded','Որոշ տարրեր չբեռնվեցին','Не удалось загрузить некоторые элементы')}: {unavailable.map(u=>unavailableName[u]?t(...unavailableName[u]):u).join(', ')}. {t('Open My members to check them.','Ստուգեք «Իմ անդամները» բաժնում։','Откройте раздел «Мои участники», чтобы проверить их.')}</p>}
  <LaneSection lane="P0" count={urgentTotal} l={l} incomplete={urgentIncomplete}>
   {urgent.map(i=>i.kind==='care_alert'?<AlertRow key={i.id} item={i} l={l} actions={actions} closer={identity.name}/>:<UrgentWindowRow key={`urgent-${i.memberId}`} window={i} locale={l}/>)}
   {day.urgentCapped&&<li role="alert" className="py-4 text-caption text-muted-foreground">{t('Only the first urgent items are shown. Open My members for the rest.','Ցուցադրված են միայն առաջին շտապ տարրերը։ Մնացածը՝ «Իմ անդամները» բաժնում։','Показаны только первые срочные элементы. Остальные доступны в разделе «Мои участники».')} <Link href={'/staff/real/members' as Route} className="font-medium underline underline-offset-4">{t('Open My members','Բացել «Իմ անդամները»','Открыть «Мои участники»')}</Link></li>}
  </LaneSection>
  <FirstNoteQueue queue={firstNotes} locale={l} now={new Date()}/>
  <LdlResponsesSection items={ldl} l={l}/>
  <MedicineConcernsSection items={medicines} l={l}/>
  {day.tasks!==undefined&&<OverdueTaskCards tasks={day.tasks} locale={l}/>}
  {day.handoffs!==undefined&&<NurseHandoffs page={day.handoffs} actor={{id:identity.id,role:'doctor'}} locale={l}/>}
  {(['P1','P2','P3']as const).map(lane=><LaneSection key={lane} lane={lane} count={groups[lane].length} l={l}>
   {groups[lane].map(i=><ItemRow key={i.id} item={i} l={l}/>)}
   {groups[lane].length>=inbox.laneCap&&<li className="py-4 text-caption text-muted-foreground">{t(`Showing the first ${inbox.laneCap}. Open My members for the rest.`,`Ցուցադրված են առաջին ${inbox.laneCap}-ը։ Մնացածը՝ «Իմ անդամները» բաժնում։`,`Показаны первые ${inbox.laneCap}. Остальные доступны в разделе «Мои участники».`)}</li>}
  </LaneSection>)}
  <NurseActivity items={inbox.nurseActivity} locale={l}/>
  {(inbox.zoeAnsweredTotal>0||inbox.unavailable.includes('zoe_answered'))&&<ZoeAnsweredSection items={inbox.zoeAnswered} total={inbox.zoeAnsweredTotal} l={l} from="today"/>}
  <p className="text-caption text-muted-foreground">{t('As of','Առ','По состоянию на')} {stamp(inbox.asOf,l)}</p>
 </div>;
}
