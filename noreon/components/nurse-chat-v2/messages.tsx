import {taskTitle} from '@/lib/staff/real-coordination/task-copy';
import {ChatMemberIdentity,MemberDisambiguationCard} from '@/components/staff/chat-member-identity';
import {useState} from 'react';
import {StaffZoeResponse} from '@/components/staff/zoe/answer';
import {memberRef,type AnswerContent,type ToolResult} from '@/lib/staff-zoe/contracts';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {chatMemberIdentityLine as memberIdentityLine} from '@/lib/staff/member-identity';
import {todayItems} from '@/lib/nurse-chat/today';
import type {readNurseToday} from '@/lib/nurse-chat/today-actions';
import type {MemberSearchPage,MemberSearchRow} from '@/lib/staff/member-search-schema';
import type {CoordinationTask} from '@/lib/staff/real-coordination/schema';
import type {VisitChoice} from './use-nurse-visit';
import {NurseTaskCard,type TaskFilter} from './task-list';
import type {NurseTaskOperation} from './use-nurse-task';
import type {CoordinationSnapshot,CoordinationTaskPage} from '@/lib/staff/real-coordination/schema';
import type {NurseVisitList} from '@/lib/nurse-visit/schema';
import type {NotesPage} from './use-nurse-notes';
import {measureCardNeedsConfirmation,measureValueLabel,type MeasureCard} from '@/lib/nurse-chat/measure-card';
import {BpHighWarning} from '@/components/staff/bp-high-warning';
import type {CareAlert} from '@/lib/care-alerts/contracts';
import type {NurseMissingBp} from '@/lib/nurse-chat/cohort-read';
import type {NurseAdherence} from '@/lib/nurse-chat/adherence-read';
import {NurseSentHandoffs} from './sent-handoffs';
import {sentHandoffsCopy,type SentHandoffs} from '@/lib/nurse-chat/sent-handoffs';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {NurseUrgentAlertRow,NurseAlertReadFailure} from '@/components/staff/nurse-urgent-alerts';

export type MemberChoice=Pick<MemberSearchRow,'id'|'name'|'birthYear'|'birthDate'|'phoneLast4'|'shortId'>&Partial<import('@/lib/staff/chat-member-identity-schema').ChatMemberIdentity>;
export type AskMember={memberId:string;memberName:string};
export type Reply=
 | {kind:'zoe-loading'|'zoe-cards'|'zoe-answer'|'zoe-error';member:AskMember;cards:ToolResult[];content?:AnswerContent;error?:string}
 | {kind:'question-choice';rows:({id:string;name:string}&Partial<import('@/lib/staff/chat-member-identity-schema').ChatMemberIdentity>)[];question:string;used?:boolean}
 | {kind:'choose-member'}
 | {kind:'missing-bp';data:NurseMissingBp}
 | {kind:'adherence';data:NurseAdherence}
 | {kind:'handoffs';page:SentHandoffs}
 | {kind:'boundary'}
 | {kind:'small-talk';lines:string[]}
 | {kind:'measure';card:MeasureCard}
 | {kind:'zoe-refused';error:string}
 | {kind:'help'|'loading-today'|'loading-search'|'today-failed'|'search-failed'}
 | {kind:'today';tasksUsed?:boolean;visitsUsed?:boolean;hiddenTasks?:string[];data:Awaited<ReturnType<typeof readNurseToday>>}
 | {kind:'members';page:MemberSearchPage}
 | {kind:'text';text:string}
 | {kind:'tasks';page:CoordinationTaskPage;filter:TaskFilter}
 | {kind:'task-details';snapshot:CoordinationSnapshot}
 | {kind:'visits';data:Extract<NurseVisitList,{enabled:true}>}
 | {kind:'notes';page:NotesPage;member:MemberChoice;used?:boolean};
export type ThreadMessage=({id:string;kind:'nurse';text:string;toZoe?:boolean}|{id:string;kind:'reply';reply:Reply}|{id:string;kind:'conversation';member:MemberChoice}|{id:string;kind:'task'}|{id:string;kind:'visit';visit:VisitChoice}|{id:string;kind:'care-note'})&{at?:string;conversationKey?:string};
type TodayVisits={disabled:boolean;updates:Record<string,import('@/lib/nurse-visit/schema').NurseVisitReady>;onOpen:(visit:VisitChoice)=>void;onAll?:()=>void};
type TodayTasks={hidden:string[];updates:Record<string,CoordinationTask>;disabled:boolean;onComplete:(task:CoordinationTask,operation?:NurseTaskOperation)=>void;onDetails?:(task:CoordinationTask)=>void;onAll?:()=>void};

export function memberLabel(member:MemberChoice,locale:StaffLocale){
 return memberIdentityLine(member,locale);
}
export function NurseReply({reply,locale:l,nurseName,onMember,onChoose,onMeasure,onPendingChange,tasks,visits,onSentHandoffs,memberHeld=false}:{reply:Reply;onSentHandoffs?:()=>void;locale:StaffLocale;nurseName?:string;onMember:(member:MemberChoice)=>void;onMeasure?:(action:'save'|'cancel'|'visits')=>void;onChoose?:(row:{id:string;name:string})=>void;tasks?:TodayTasks;visits?:TodayVisits;memberHeld?:boolean;onPendingChange?:(key:string,pending:boolean)=>void}){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 switch(reply.kind){
  case 'zoe-loading':case 'zoe-cards':case 'zoe-answer':case 'zoe-error':return <div data-nurse-zoe-reply>
   <p className="cv2-time">{t(`Zoe · read from ${reply.member.memberName}'s record. The member does not see this.`,`Զոյա · կարդացվել է ${reply.member.memberName}-ի գրառումից։ Անդամը սա չի տեսնում։`,`Zoe · из записи ${reply.member.memberName}. Участник этого не видит.`)}</p>
   <StaffZoeResponse member={{id:reply.member.memberId,name:reply.member.memberName}} content={reply.content??null} cards={reply.cards} error={reply.error??null} loading={reply.kind==='zoe-loading'||reply.kind==='zoe-cards'} locale={l} memberRef={memberRef(reply.member.memberId)} inline/>
  </div>;
  case 'question-choice':return <MemberDisambiguationCard rows={reply.rows} locale={l} busy={memberHeld} used={reply.used} className="ncv2-choice" onChoose={row=>onChoose?.(row)}/>;
  case 'zoe-refused':return <p role="alert">{reply.error}</p>;
  case 'adherence':{
   const d=reply.data,fmt=new Intl.DateTimeFormat(l==='hy'?'hy-AM':l==='ru'?'ru-RU':'en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
   const range=`${fmt.format(new Date(`${d.from}T00:00:00Z`))} – ${fmt.format(new Date(`${d.to}T00:00:00Z`))}`;
   return <div data-nurse-adherence>
    <p><strong>{t(`Medicine doses reported, ${range}`,`Հաղորդված դեղաչափեր, ${range}`,`Отмеченные дозы лекарств, ${range}`)}</strong></p>
    <p className="cv2-time">{t('Skipped means the member reported it. No report means nothing was logged.','«Բաց թողնված» նշանակում է՝ անդամը հաղորդել է։ «Չի հաղորդվել» նշանակում է՝ ոչինչ չի գրանցվել։','«Пропущено» значит, что участник сообщил об этом. «Нет отметки» значит, что ничего не отмечено.')}</p>
    {d.rows.length?<ul className="ncv2-list">{d.rows.map(row=><li key={row.member.id}>
     <button type="button" className="ncv2-choice tabular-nums" disabled={memberHeld} onClick={()=>onMember(row.member)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}><ChatMemberIdentity memberId={row.member.id} name={row.member.name} member={row.member} locale={l}/></button>
     {row.medicines.map((m,i)=><p key={i} className="cv2-time">{m.name}{m.dose?` ${m.dose}`:''} · {t(`taken ${m.taken}, skipped ${m.skipped}, no report ${m.noReport} of ${m.expected}`,`ընդունված ${m.taken}, բաց թողնված ${m.skipped}, չի հաղորդվել ${m.noReport} (${m.expected}-ից)`,`принято ${m.taken}, пропущено ${m.skipped}, нет отметки ${m.noReport} из ${m.expected}`)}</p>)}
    </li>)}</ul>:<p>{t('None of the members checked has medicine doses expected in this period.','Ստուգված անդամներից ոչ մեկը այս ժամանակահատվածում դեղաչափեր չունի։','У проверенных участников нет ожидаемых доз за этот период.')}</p>}
    {d.unknown>0&&<p className="cv2-time">{t(`${d.unknown} could not be read, so they are not listed.`,`${d.unknown}-ը չհաջողվեց կարդալ, դրանք ցանկում չեն։`,`${d.unknown} не удалось прочитать, их нет в списке.`)}</p>}
    {d.truncated&&<p className="cv2-time">{t(`Only the first ${d.checked} members were checked.`,`Ստուգվել են միայն առաջին ${d.checked} անդամները։`,`Проверены только первые ${d.checked} участников.`)}</p>}
   </div>;
  }
  case 'missing-bp':{
   const d=reply.data,since=new Intl.DateTimeFormat(l==='hy'?'hy-AM':l==='ru'?'ru-RU':'en-GB',{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${d.from}T00:00:00Z`));
   return <div data-nurse-missing-bp>
    <p>{d.rows.length?t(`No blood pressure reading since ${since} for these members of yours`,`Ճնշման չափում չկա ${since}-ից սկսած ձեր այս անդամների համար`,`Нет измерений давления с ${since} у этих ваших участников`):t(`Every member you checked has a blood pressure reading since ${since}.`,`Ստուգված բոլոր անդամներն ունեն ճնշման չափում ${since}-ից սկսած։`,`У всех проверенных участников есть измерение давления с ${since}.`)}</p>
    {d.rows.length>0&&<ul className="ncv2-list">{d.rows.map(member=><li key={member.id}><button type="button" className="ncv2-choice tabular-nums" disabled={memberHeld} onClick={()=>onMember(member)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}><ChatMemberIdentity memberId={member.id} name={member.name} member={member} locale={l}/></button></li>)}</ul>}
    {d.unknown>0&&<p className="cv2-time">{t(`${d.unknown} could not be read, so they are not listed.`,`${d.unknown}-ը չհաջողվեց կարդալ, դրանք ցանկում չեն։`,`${d.unknown} не удалось прочитать, их нет в списке.`)}</p>}
    {d.truncated&&<p className="cv2-time">{t(`Only the first ${d.checked} members were checked.`,`Ստուգվել են միայն առաջին ${d.checked} անդամները։`,`Проверены только первые ${d.checked} участников.`)}</p>}
   </div>;
  }
  case 'handoffs':return <NurseSentHandoffs page={reply.page} locale={l} onMember={member=>onMember({...member,birthYear:member.birthYear??null,birthDate:member.birthDate??null,phoneLast4:member.phoneLast4??null,shortId:member.shortId??null})} disabled={memberHeld}/>;
  case 'choose-member':return <p>{t('Which member do you mean?','Ո՞ր անդամին նկատի ունեք։','Какого участника вы имеете в виду?')}</p>;
  case 'measure':{
   const c=reply.card,name=c.member.name||t('Member','Անդամ','Участник');
   const fieldLabel=(field:'bp'|'weight'|'waist')=>field==='bp'?t('Blood pressure','Արյան ճնշում','Давление'):field==='weight'?t('Weight','Քաշ','Вес'):t('Waist','Գոտկատեղ','Талия');
   const open=measureCardNeedsConfirmation(c);
   const attempted=c.entries.some(entry=>entry.attempted);
   const button=(label:string,action:'save'|'cancel'|'visits',disabled=false)=><button type="button" className="ncv2-choice" disabled={disabled||!onMeasure} onClick={()=>onMeasure?.(action)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{label}</button>;
   return <div data-nurse-measure={c.state}>
    <p><strong>{t(`Record for ${name}`,`Գրանցել ${name}-ի համար`,`Записать для ${name}`)}</strong></p>
    <ul className="ncv2-list">{c.entries.map(entry=><li key={entry.key}>{fieldLabel(entry.field)}: {measureValueLabel(entry.field,entry.values,l)}{attempted&&c.state!=='confirm'?` · ${entry.saved?t('saved','պահպանված է','сохранено'):t('not confirmed','չի հաստատվել','не подтверждено')}`:''}</li>)}</ul>
    {c.entries.filter(entry=>entry.field==='bp'&&'systolic' in entry.values).map(entry=><BpHighWarning key={entry.key} systolic={'systolic' in entry.values?entry.values.systolic:null} diastolic={'diastolic' in entry.values?entry.values.diastolic:null} locale={l}/>)}
    {c.state==='confirm'&&<p>{t('It goes into the open visit as a nurse measurement. Nothing is saved until you press Save.','Այն մտնում է բաց այցի մեջ որպես բուժքրոջ չափում։ Մինչև «Պահպանել»-ը սեղմելը ոչինչ չի պահվում։','Оно попадёт в открытый визит как измерение медсестры. Пока вы не нажмёте «Сохранить», ничего не сохраняется.')}</p>}
    {c.state==='saving'&&<p role="status">{t('Saving…','Պահպանվում է…','Сохраняем…')}</p>}
    {c.state==='saved'&&<p>{t('Saved to the visit.','Պահպանված է այցի մեջ։','Сохранено в визите.')}</p>}
    {c.state==='cancelled'&&<p>{t('Not saved.','Չի պահպանվել։','Не сохранено.')}</p>}
    {c.state==='expired'&&<p>{t('This card is no longer current. Type the reading again.','Այս քարտն այլևս ակտուալ չէ։ Նորից գրեք չափումը։','Эта карточка больше не актуальна. Введите измерение заново.')}</p>}
    {c.state==='no-visit'&&<><p>{t(`No visit is open for ${name}, so this reading cannot be saved.`,`${name}-ի համար բաց այց չկա, ուստի այս չափումը հնարավոր չէ պահպանել։`,`Для ${name} нет открытого визита, поэтому это измерение нельзя сохранить.`)}</p>{button(t('See all visits','Տեսնել բոլոր այցերը','Посмотреть все визиты'),'visits',memberHeld)}</>}
    {c.state==='not-today'&&<p>{t(`The next visit for ${name} is on ${c.nextDay}. Readings are recorded on the day of the visit.`,`${name}-ի հաջորդ այցը ${c.nextDay}-ին է։ Չափումները գրանցվում են այցի օրը։`,`Следующий визит для ${name} ${c.nextDay}. Измерения записывают в день визита.`)}</p>}
    {c.state==='no-item'&&<p>{t('This visit does not include that measurement.','Այս այցը չի ներառում այդ չափումը։','Этот визит не включает такое измерение.')}</p>}
    {c.state==='recorded'&&<p>{t('That measurement is already recorded for this visit. Change it in the visit.','Այս չափումն արդեն գրանցված է այս այցի համար։ Փոխեք այն այցի մեջ։','Это измерение уже записано в этом визите. Измените его в визите.')}</p>}
    {c.state==='unavailable'&&<p role="alert">{t('Visits are unavailable, so nothing was saved. Try again.','Այցերը հասանելի չեն, ուստի ոչինչ չի պահպանվել։ Կրկին փորձեք։','Визиты недоступны, ничего не сохранено. Попробуйте ещё раз.')}</p>}
    {(c.state==='unsure'||c.state==='error')&&c.error&&<p role="alert">{c.error}</p>}
    {open&&<div className="ncv2-topics">{button(c.state==='unsure'||attempted?t('Check or retry','Ստուգել կամ կրկնել','Проверить или повторить'):t('Save','Պահպանել','Сохранить'),'save',memberHeld)}{c.state==='confirm'&&button(t('Cancel','Չեղարկել','Отмена'),'cancel',memberHeld)}</div>}
   </div>;
  }
  case 'small-talk':return <div className="space-y-2">{reply.lines.map((line,index)=><p key={index}>{line}</p>)}</div>;
  case 'boundary':return <p>{t('I can’t prescribe, change a dose, diagnose or delete a record. Those stay with the doctor. I can hand this over to the doctor.','Ես չեմ կարող դեղ նշանակել, չափաբաժին փոխել, ախտորոշել կամ գրառում ջնջել։ Դա բժշկի որոշումն է։ Կարող եմ փոխանցել նրան։','Я не могу назначать лечение, менять дозу, ставить диагноз или удалять записи. Это решает врач. Могу передать ему.')}</p>;

  case 'tasks':case 'task-details':case 'visits':case 'notes':return null;
  case 'help':return <p>{t('You can see today’s work or find an assigned member by name.','Կարող եք տեսնել այսօրվա աշխատանքը կամ անունով գտնել կցված անդամին։','Вы можете посмотреть работу на сегодня или найти назначенного участника по имени.')}</p>;
  case 'text':return <p>{reply.text}</p>;
  case 'loading-today':return <p role="status">{t('Loading your work…','Ձեր աշխատանքը բեռնվում է…','Загружаем вашу работу…')}</p>;
  case 'loading-search':return <p role="status">{t('Finding assigned members…','Կցված անդամների որոնում…','Ищем назначенных участников…')}</p>;
  case 'today-failed':return <p role="alert">{t('Your work list is unavailable. Try today again.','Ձեր աշխատանքների ցանկն անհասանելի է։ Կրկին փորձեք «Այսօր»։','Список работы недоступен. Попробуйте «Сегодня» ещё раз.')}</p>;
  case 'search-failed':return <p role="alert">{t('Member search is unavailable. Try the name again.','Անդամի որոնումն անհասանելի է։ Կրկին փորձեք անունը։','Поиск участников недоступен. Попробуйте имя ещё раз.')}</p>;
  case 'members':return <>
   <p>{reply.page.rows.length?t('Your matching assigned members','Ձեր որոնմանը համապատասխան կցված անդամները','Ваши назначенные участники по запросу'):t('No matching assigned members. Try another name.','Համապատասխան կցված անդամներ չկան։ Փորձեք այլ անուն։','Совпадений среди назначенных участников нет. Попробуйте другое имя.')}</p>
   {!!reply.page.rows.length&&<MemberDisambiguationCard rows={reply.page.rows} locale={l} busy={memberHeld} className="ncv2-choice" onChoose={row=>{const member=reply.page.rows.find(member=>member.id===row.id);if(member)onMember({...member,name:row.name});}}/>}
   {reply.page.hasMore&&<p>{t('More members match. Type a fuller name to narrow the list.','Այլ անդամներ նույնպես համապատասխանում են։ Գրեք ավելի ամբողջական անուն՝ ցանկը նեղացնելու համար։','Есть другие совпадения. Введите более полное имя, чтобы сузить список.')}</p>}
  </>;
  case 'today':return <TodayReply onSentHandoffs={onSentHandoffs} nurseName={nurseName} onPendingChange={onPendingChange} memberHeld={memberHeld} data={reply.data} locale={l} tasks={tasks} visits={visits} onMember={onMember}/>;
 }
}

function TodayReply({onSentHandoffs,data,locale:l,nurseName,tasks,visits,onMember,onPendingChange,memberHeld=false}:{onSentHandoffs?:()=>void;onMember:(member:MemberChoice)=>void;data:Awaited<ReturnType<typeof readNurseToday>>;locale:StaffLocale;nurseName?:string;tasks?:TodayTasks;visits?:TodayVisits;memberHeld?:boolean;onPendingChange?:(key:string,pending:boolean)=>void}){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const [source,setSource]=useState(data),[alertUpdates,setAlertUpdates]=useState<Record<string,CareAlert>>({});
 if(source!==data){setSource(data);setAlertUpdates({});}
 if(!data.ok)return <NurseReply reply={{kind:'today-failed'}} locale={l} onMember={()=>{}}/>;
 const identities=new Map(data.identities?.map(member=>[member.id,member]));
 const identity=(id:string,name:string|null)=><ChatMemberIdentity memberId={id} name={name} member={identities.get(id)} locale={l}/>;
 const visitRows=data.visits?.enabled?data.visits.visits.map(row=>{
  const fresh=visits?.updates[`${row.source}:${row.id}`];
  return fresh?{...row,...fresh.visit,completion:fresh.completion,steps:fresh.steps}:row;
 }):[];
 const alertRows=data.alerts?.kind==='ready'?data.alerts.alerts.filter(alert=>alertUpdates[alert.id]?.state!=='resolved').map(alert=>alertUpdates[alert.id]?{...alert,...alertUpdates[alert.id]}:alert):[];
 const items=todayItems((data.page?.tasks??[]).filter(task=>!tasks?.hidden.includes(task.id)).map(task=>tasks?.updates[task.id]&&tasks.updates[task.id].revision>task.revision?tasks.updates[task.id]:task),visitRows,new Date(data.asOf),alertRows);
 const active=items.filter(item=>(item.state!=='completed'&&item.state!=='cancelled'&&item.state!=='resolved')||(item.kind==='visit'&&(item.visit.steps??[]).some(step=>step.step==='samples-collected')&&!(item.visit.steps??[]).some(step=>step.step==='samples-at-lab')));
 const all=todayItems((data.page?.tasks??[]).map(task=>tasks?.updates[task.id]&&tasks.updates[task.id].revision>task.revision?tasks.updates[task.id]:task),visitRows,new Date(data.asOf),alertRows);
 // One date format on every screen: the same stamp as task and conversation times (Yerevan, 24 hours).
 const stamp=(at:string)=>yerevanStamp(at,l);
 return <div data-today-reply>
  <NurseAlertReadFailure read={data.alerts} locale={l}/>
  <p>{all.filter(item=>item.state!=='completed'&&item.state!=='cancelled'&&item.state!=='resolved').length} {t('open alerts, tasks and visits','բաց ազդանշան, առաջադրանք և այց','открытых оповещений, задач и визитов')} · {all.filter(item=>item.state==='overdue').length} {t('overdue','ժամկետանց','просрочено')}</p>
  <p className="cv2-time">{t('As of','Առ','По состоянию на')} {stamp(data.asOf)}</p>
  {(!data.page||!data.visits)&&<p role="alert">{!data.visits&&!data.page?t('Tasks and visits could not be read. Do not assume nothing is due.','Առաջադրանքներն ու այցերը չհաջողվեց կարդալ։ Մի կարծեք, թե ոչինչ ժամկետանց չէ։','Не удалось прочитать задачи и визиты. Не считайте, что ничего не ждёт.'):!data.visits?t('Visits could not be read. Do not assume none are due.','Այցերը չհաջողվեց կարդալ։ Մի կարծեք, թե ժամկետանց այցեր չկան։','Не удалось прочитать визиты. Не считайте, что ближайших визитов нет.'):t('Tasks could not be read. Do not assume none are due.','Առաջադրանքները չհաջողվեց կարդալ։ Մի կարծեք, թե ժամկետանց առաջադրանքներ չկան։','Не удалось прочитать задачи. Не считайте, что задач к сроку нет.')}</p>}
  {data.visits&&!data.visits.enabled&&<p role="status">{t('Visits are switched off.','Այցերն անջատված են։','Визиты отключены.')}</p>}
  <p><strong>{t('Open work, urgent alerts first','Բաց աշխատանք՝ շտապ ազդանշանները սկզբում','Открытая работа, сначала срочные оповещения')}</strong></p>
  {!active.length&&data.alerts?.kind!=='unavailable'&&data.page&&data.visits&&<p role="status">{t('No open work in the available list.','Հասանելի ցանկում բաց աշխատանք չկա։','В доступном списке нет открытой работы.')}</p>}
  <ul className="ncv2-list">{active.map(item=><li key={item.id} data-today-alert={item.kind==='alert'?item.alert.id:undefined} data-today-task={item.kind==='task'?item.task.id:undefined} data-today-visit={item.kind==='visit'?item.visit.id:undefined}>
   {item.kind==='alert'?<NurseUrgentAlertRow nurseName={nurseName} onPendingChange={onPendingChange} alert={item.alert} locale={l} onChanged={alert=>setAlertUpdates(previous=>({...previous,[alert.id]:alert}))} member={alert=><button type="button" className="ncv2-choice" disabled={memberHeld} onClick={()=>onMember({id:alert.memberId,name:alert.memberName||null,birthYear:null,birthDate:null,phoneLast4:null,shortId:null})} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{identity(alert.memberId,alert.memberName)}</button>}/>:item.kind==='task'?<>
    {tasks?<NurseTaskCard task={item.task} locale={l} disabled={tasks.disabled} onDetails={tasks.onDetails??(()=>{})} onOperation={tasks.onComplete}/>:<p>{taskTitle(item.task,l)}</p>}
    {item.task.sourceConversationId&&<p className="cv2-time" data-doctor-handover>{t('From the doctor','Բժշկի կողմից','От врача')}: {item.task.instructions}</p>}
    <p className="cv2-time">{identity(item.task.caseId,item.task.memberName)} · {item.state==='overdue'?t('Overdue','Ժամկետանց','Просрочено'):item.state==='due'?t('Due today','Այսօրվա համար','На сегодня'):t('Open','Բաց','Открыто')}{item.at&&<> · {stamp(item.at)}</>}</p>
   </>:visits?<button type="button" className="ncv2-choice" disabled={visits.disabled} onClick={()=>visits.onOpen(item.visit)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{identity(item.visit.memberId,item.visit.memberName)} · {stamp(item.visit.startsAt)}{item.state==='overdue'&&<> · {t('Overdue','Ժամկետանց','Просрочено')}</>}{item.visit.bookingStatus==='attended'&&<> · {t('Arrived','Ժամանել է','Прибыл')}</>}</button>:<p>{identity(item.visit.memberId,item.visit.memberName)} · {stamp(item.visit.startsAt)}</p>}
   <button type="button" className="ncv2-choice" disabled={memberHeld||tasks?.disabled||visits?.disabled} onClick={()=>onMember({id:item.kind==='alert'?item.alert.memberId:item.kind==='task'?item.task.caseId:item.visit.memberId,name:item.kind==='alert'?item.alert.memberName:item.kind==='task'?item.task.memberName:item.visit.memberName,birthYear:null,birthDate:null,phoneLast4:null,shortId:null})} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{t('Open conversation','Բացել զրույցը','Открыть переписку')}</button>
  </li>)}</ul>
  {data.alerts?.kind==='ready'&&data.alerts.total>data.alerts.alerts.length&&<p>{t('More urgent alerts exist. Ask the doctor to review the rest.','Կան այլ շտապ ազդանշաններ։ Խնդրեք բժշկին դիտել մնացածը։','Есть другие срочные оповещения. Попросите врача просмотреть остальные.')}</p>}
  {tasks?.onAll&&<button type="button" className="ncv2-choice" disabled={tasks.disabled} onClick={tasks.onAll} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{t('See all tasks','Տեսնել բոլոր առաջադրանքները','Посмотреть все задачи')}</button>}
  {data.page?.nextCursor&&<p>{t('Only loaded tasks are shown. More tasks may be due.','Ցուցադրված են միայն բեռնված առաջադրանքները։ Կարող են լինել այլ ժամկետով առաջադրանքներ։','Показаны только загруженные задачи. Могут быть и другие задачи к сроку.')}</p>}
  {onSentHandoffs&&<button type="button" className="ncv2-choice" disabled={memberHeld} onClick={onSentHandoffs} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{sentHandoffsCopy(l).title}</button>}
  {visits?.onAll&&<button type="button" className="ncv2-choice" disabled={visits.disabled} onClick={visits.onAll} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{t('See all visits','Տեսնել բոլոր այցերը','Посмотреть все визиты')}</button>}
 </div>;
}
