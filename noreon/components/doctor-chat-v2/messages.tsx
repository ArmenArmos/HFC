import {ChatMemberIdentity,MemberDisambiguationCard,MemberIdentityButton,useChatMemberIdentity} from '@/components/staff/chat-member-identity';
import type {MemberIdentity} from '@/lib/staff/member-identity';
import type {DoctorUploadOverride} from '@/lib/staff/doctor-upload-overrides';
import {UploadIdentityChecks} from '@/components/staff/upload-identity-check';
import {overdueDayItems,dayStatus} from '@/components/staff/doctor-workspace/day-cards';
import {notDone} from '@/lib/staff-zoe/outcome-copy';
import type {DoctorDay} from '@/lib/doctor-inbox/day';
import type {HomeResponse} from '@/lib/staff-zoe/home-read';
import {LabReviewResponse} from './lab-review-action';
import type {AnswerContent,ToolResult} from '@/lib/staff-zoe/contracts';
import {AlertButtons,AlertOutcome,type AlertControls} from './alerts';
import type {EverydayResult} from '@/lib/staff-zoe/everyday-runtime';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {itemSummary,type AlertItem,type InboxItem} from '@/lib/doctor-inbox/contracts';
import {AlertCardLines} from '@/components/staff/alert-card';
import {mergeUrgent,urgentWindowLine,type UrgentWindow} from '@/lib/doctor-inbox/urgent-windows';
import type {ChatApprovalsResponse,ChatDayResponse,ChatSearchResponse,ChatAlertsResponse} from '@/lib/staff-zoe/chat-v2-actions';

import type {ResultsBlockState} from '@/lib/gp-report/runtime';
import type {HandoverTarget} from '@/lib/staff-zoe/handover';
import type {MemberData,ReplyStatus} from './conversation';
import type {SavedPlanRow,ChatThreadEntry} from '@/lib/staff-zoe/chat-v2-read';
export type AskMember={memberId:string;memberName:string};
export type ZoeReply={kind:'zoe-loading'|'zoe-cards'|'zoe-answer'|'zoe-error';member:AskMember;cards:ToolResult[];content?:AnswerContent;error?:string};
export type Reply={kind:'identity-checks';rows:DoctorUploadOverride[]}|{kind:'urgent-window';window:UrgentWindow}|ZoeReply|{kind:'results-empty';memberId:string;name:string;report:boolean;uploadId?:string}|{kind:'nurse-handover';target:HandoverTarget;note:string|null}|{kind:'small-talk';lines:string[]}|ChatApprovalsResponse|{kind:'approvals-unavailable'}|(ChatAlertsResponse&{retiredAlerts?:string[]})|Extract<HomeResponse,{kind:'missing_bp'}>|{kind:'overdue';day:DoctorDay}|{kind:'upload';memberId:string;documentId:string;name:string}|{kind:'question-choice';rows:({id:string;name:string}&MemberIdentity)[];question:string;used?:boolean}|{kind:'choose-member'}|{kind:'history-failed'}|{kind:'alert-outcome';alert:AlertItem;result:EverydayResult;active?:boolean}|{kind:'plan';memberId:string;name:string;aiDraft:boolean;prepareRequest?:string}|{kind:'results';memberId:string;name:string;block:Extract<ResultsBlockState,{status:'ready'}>;notice?:string}|{kind:'results-unavailable'}|{kind:'lab';memberId:string;fileId:string;name:string}|(ChatDayResponse&{retiredAlerts?:string[]})|ChatSearchResponse|{kind:'off'}|{kind:'loading-member'}|{kind:'loading-search'}|{kind:'conversation-failed'}|{kind:'search-failed'}|{kind:'outcome';status:ReplyStatus;memberId?:string;deliveryId?:string;sentDelivery?:ChatThreadEntry}|{kind:'entries';entries:ChatThreadEntry[]}|{kind:'member';data:MemberData;active:boolean;status?:ReplyStatus;savedBody?:string;compact?:boolean;deliveryId?:string;sentDelivery?:ChatThreadEntry}|{kind:'building'}|{kind:'text';text:string;followUp?:AskMember&{kind:'results'|'conversation'}}|{kind:'loading-who'}|{kind:'urgent';alert:AlertItem;active?:boolean}|{kind:'poll-failed'};
export type ThreadMessage={id:string;kind:'doctor';text:string;toZoe?:boolean;at?:string}|{id:string;kind:'reply';reply:Reply;at?:string};
type OpenLab=(memberId:string,fileId:string,name:string)=>void;
type OpenPlan=(memberId:string,name:string,aiDraft?:boolean)=>void;
type OpenUpload=(memberId:string,documentId:string,name:string)=>void;
type OpenMember=(memberId:string,name:string)=>void;
export const time=(at:string,l:StaffLocale)=>new Intl.DateTimeFormat(l,{timeZone:'Asia/Yerevan',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at));
const sourceNames:Record<string,readonly [string,string,string]>={
 identity_checks:['file identity checks','ֆայլերի պատկանելության ստուգումներ','проверки принадлежности файлов'],
 saved_plans:['saved plans','պահպանված պլաններ','сохранённые планы'],
 uploads_waiting:['member uploads','անդամների վերբեռնած ֆայլեր','файлы участников'],
 first_notes:['first notes','առաջին գրառումներ','первые сообщения'],
 ldl_responses:['LDL follow-ups','ՑԽԼ հետագա ստուգումներ','повторные проверки ЛПНП'],
 medicine_concerns:['medicine questions','դեղերի մասին հարցեր','вопросы о лекарствах'],
 tasks:['nurse tasks','բուժքրոջ առաջադրանքներ','задачи медсестры'],
 handoffs:['hand-overs','փոխանցումներ','передачи'],
 care_alerts:['urgent alerts','շտապ ահազանգեր','срочные оповещения'],
 urgent_windows:['urgent conversations','շտապ զրույցներ','срочные разговоры'],
 bp_repeat_notes:['blood pressure notes','ճնշման գրառումներ','записи давления'],
 member_identities:['member records','անդամների գրառումներ','записи участников'],
};
function unavailableSources(missing:string[]=[],locale:StaffLocale){
 const other=st(locale,'other queues','այլ ցանկեր','другие очереди');
 const names=[...new Set(missing.map(id=>Object.hasOwn(sourceNames,id)?st(locale,...sourceNames[id]):other))].join(', ')||other;
 return st(locale,`Some sources are unavailable: ${names}. These counts are incomplete.`,`Որոշ աղբյուրներ անհասանելի են՝ ${names}։ Քանակները թերի են։`,`Некоторые источники недоступны: ${names}. Количество неполное.`);
}
const russian=(n:number,forms:readonly [string,string,string])=>forms[n%10===1&&n%100!==11?0:n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?1:2];
const count=(n:number,l:StaffLocale,en:readonly [string,string],hy:string,ru:readonly [string,string,string])=>`${n} ${st(l,en[n===1?0:1],hy,russian(n,ru))}`;

function MemberRow({item,locale,onOpen,onLab,onPlan}:{item:AlertItem|InboxItem|SavedPlanRow;locale:StaffLocale;onOpen:OpenMember;onLab?:OpenLab;onPlan?:OpenPlan}){
 const urgent=item.kind==='care_alert',saved=item.kind==='saved_plan';
 return <MemberIdentityButton memberId={item.memberId} name={item.memberName} locale={locale} buttonClassName="dcv2-row" data-inbox-id={item.id} data-urgent={urgent||undefined} onClick={()=>!urgent&&(item.kind==='plan_draft'||saved)?onPlan?.(item.memberId,item.memberName,!saved):!urgent&&(item.kind==='lab_attention'||item.kind==='lab_sheet')&&item.fileId?onLab?.(item.memberId,item.fileId,item.memberName):onOpen(item.memberId,item.memberName)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>
  {urgent?<AlertCardLines alert={item.alert} locale={locale}/>:<span>{saved?st(locale,'Saved plan waiting for approval','Պահպանված պլանը սպասում է հաստատման','Сохранённый план ожидает утверждения'):itemSummary(item,locale)}</span>}
  {!urgent&&!saved&&item.draft?.asked&&<span className="dcv2-asked">{item.draft.asked}</span>}
  {!urgent&&!saved&&item.draft&&<span className="dcv2-tag">{st(locale,'Zoe drafted a reply','Զոյան պատրաստել է պատասխանի նախագիծ','Zoe подготовила черновик ответа')}</span>}
  <time className="dcv2-time" dateTime={item.at}>{time(item.at,locale)}</time>
 </MemberIdentityButton>;
}
function UrgentWindowRow({window,locale,onOpen}:{window:UrgentWindow;locale:StaffLocale;onOpen:OpenMember}){
 const identity=useChatMemberIdentity(window.memberId);
 return <div className="dcv2-alert-row" data-urgent-window={window.memberId}>
  <ChatMemberIdentity memberId={window.memberId} name={window.memberName} locale={locale}/><p>{urgentWindowLine(window.since,locale)}</p>
  <button type="button" className="dcv2-choice" disabled={!identity} onClick={()=>{if(identity)onOpen(window.memberId,identity.name??window.memberName);}} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{st(locale,'Open member','Բացել անդամին','Открыть участника')}</button>
 </div>;
}
export function DoctorReply({reply,locale:l,collapseZoeReplies=false,doctorId,onOpen,onLab,onPlan,onUpload,busy,onAct,onCheck,closer,onWho,onChoose,onResults}:{reply:Reply;locale:StaffLocale;collapseZoeReplies?:boolean;doctorId?:string;onOpen:OpenMember;onResults?:OpenMember;onLab?:OpenLab;onPlan?:OpenPlan;onUpload?:OpenUpload;onWho?:()=>void;onChoose?:(row:{id:string;name:string})=>void}&AlertControls){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 if(reply.kind==='zoe-loading'||reply.kind==='zoe-cards'||reply.kind==='zoe-answer'||reply.kind==='zoe-error')return <div className="dcv2-zoe-record">
  <p className="dcv2-zoe-label">{t(`Zoe · read from ${reply.member.memberName}'s record. The member does not see this.`,`Զոյա · կարդացվել է ${reply.member.memberName}-ի գրառումից։ Անդամը սա չի տեսնում։`,`Zoe · из записи ${reply.member.memberName}. Участник этого не видит.`)}</p>
  <UploadIdentityChecks rows={(reply.content?.cards??reply.cards).flatMap(card=>card.identityChecks??[])} locale={l} onOpen={onLab?row=>onLab(row.memberId,row.fileId,row.memberName):undefined}/>
  <LabReviewResponse reply={reply} doctorId={doctorId} locale={l} busy={busy} onLab={onLab} collapseZoe={collapseZoeReplies}/>
 </div>;
 if(reply.kind==='identity-checks')return <UploadIdentityChecks rows={reply.rows} locale={l} onOpen={onLab?row=>onLab(row.memberId,row.fileId,row.memberName):undefined}/>;
 if(reply.kind==='results-empty')return <div><ChatMemberIdentity memberId={reply.memberId} name={reply.name} locale={l}/><p className="cv2-say">{notDone('results-empty',l,reply.report
  ?t(`No results are available for ${reply.name}'s report yet. Upload or enter a lab report to prepare it.`,`Հաշվետվության համար արդյունքներ դեռ չկան՝ ${reply.name}։ Այն պատրաստելու համար վերբեռնեք կամ մուտքագրեք լաբորատոր հաշվետվություն։`,`Для отчёта пока нет результатов: ${reply.name}. Загрузите или внесите лабораторный отчёт, чтобы подготовить его.`)
  :t(`${reply.name} has no results yet. Upload or enter a lab report to see results here.`,`${reply.name}-ի արդյունքները դեռ չկան։ Վերբեռնեք կամ մուտքագրեք լաբորատոր հաշվետվություն՝ արդյունքներն այստեղ տեսնելու համար։`,`Результатов ${reply.name} пока нет. Загрузите или внесите лабораторный отчёт, чтобы увидеть результаты здесь.`))}</p>{reply.uploadId&&onUpload&&<button type="button" className="dcv2-choice" disabled={busy} onClick={()=>onUpload(reply.memberId,reply.uploadId!,reply.name)} onPointerDown={e=>e.preventDefault()}>{t('Review upload','Վերանայել վերբեռնումը','Проверить файл')}</button>}</div>;
 if(reply.kind==='question-choice')return <MemberDisambiguationCard rows={reply.rows} locale={l} busy={busy} used={reply.used} onChoose={row=>onChoose?.(row)}/>;
 if(reply.kind==='choose-member')return <div><p className="cv2-say">{t("I read one member's record at a time. Who do you mean?",'Ես միաժամանակ մեկ անդամի գրառում եմ կարդում։ Ո՞ւմ նկատի ունեք։','Я читаю запись одного участника за раз. Кого вы имеете в виду?')}</p><button type="button" className="dcv2-choice" disabled={busy} onClick={onWho} onPointerDown={e=>e.preventDefault()} onMouseDown={e=>e.preventDefault()}>{t('Who needs me','Ո՞ւմ է պետք իմ օգնությունը','Кому нужна моя помощь')}</button></div>;
 if(reply.kind==='approvals-unavailable')return <p className="cv2-say" role="alert">{t('Your approvals history could not be read. Try again.','Ձեր հաստատումների պատմությունը չհաջողվեց կարդալ։ Փորձեք կրկին։','Не удалось прочитать историю ваших одобрений. Попробуйте снова.')}</p>;
 if(reply.kind==='approvals_history'){
  const labels={reply:t('Reply you approved','Ձեր հաստատած պատասխանը','Одобренный вами ответ'),lab_review:t('Your lab value review','Լաբորատոր արժեքի ձեր ստուգումը','Ваша проверка лабораторного значения'),plan:t('Plan you published','Ձեր հրապարակած պլանը','Опубликованный вами план'),upload:t('Upload you approved','Ձեր հաստատած վերբեռնումը','Одобренный вами файл'),alert:t('Your alert action','Ահազանգի ձեր գործողությունը','Ваше действие с оповещением')};
  const states={
   queued:t('Queued, not delivered yet','Հերթում է, դեռ չի առաքվել','В очереди, ещё не доставлено'),
   held:t('Held','Կասեցված է','Приостановлено'),
   sending:t('Sending, delivery not confirmed','Ուղարկվում է, առաքումը հաստատված չէ','Отправляется, доставка не подтверждена'),
   accepted_by_provider:t("Delivered to the member's chat. Reading is not confirmed.",'Առաքվել է անդամի զրույցին։ Կարդալը հաստատված չէ։','Доставлено в чат участника. Прочтение не подтверждено.'),
   definitely_failed:t('Not delivered','Չի առաքվել','Не доставлено'),
   unknown:t('Unknown, check the conversation','Անհայտ է, ստուգեք զրույցը','Неизвестно, проверьте разговор'),
   confirm:t('You confirmed the value','Դուք հաստատել եք արժեքը','Вы подтвердили значение'),correct:t('You corrected the value','Դուք ուղղել եք արժեքը','Вы исправили значение'),reject:t('You rejected the value','Դուք մերժել եք արժեքը','Вы отклонили значение'),
   published:t('Published in the member’s record','Հրապարակվել է անդամի գրառումում','Опубликовано в записи участника'),approved:t('Approved in the member’s record','Հաստատվել է անդամի գրառումում','Одобрено в записи участника'),
   acknowledged:t('You acknowledged the alert','Դուք ընդունել եք ահազանգը','Вы приняли оповещение'),resolved:t('You resolved the alert','Դուք լուծել եք ահազանգը','Вы закрыли оповещение'),
  };
  return <div className="dcv2-who" data-approvals-history={reply.day}>
   <p className="cv2-say">{reply.rows.length?t('Your approvals and actions','Ձեր հաստատումներն ու գործողությունները','Ваши одобрения и действия'):reply.day==='yesterday'?t('You approved nothing yesterday.','Երեկ ոչինչ չեք հաստատել։','Вчера вы ничего не одобрили.'):t('You approved nothing today.','Այսօր ոչինչ չեք հաստատել։','Сегодня вы ничего не одобрили.')}</p>
   {reply.rows.map((row,index)=><MemberIdentityButton key={index} memberId={row.memberId} name={row.memberName} locale={l} buttonClassName="dcv2-row" onClick={()=>onOpen(row.memberId,row.memberName)} onPointerDown={e=>e.preventDefault()} onMouseDown={e=>e.preventDefault()}>
    <span>{labels[row.kind]}</span>
    <span>{states[row.state]}</span>{row.kind==='reply'&&row.excerpt&&<span>{row.excerpt}</span>}
    <time className="dcv2-time" dateTime={row.at}>{time(row.at,l)}</time>
   </MemberIdentityButton>)}
   {reply.hasMore&&<p className="cv2-say">{t('Only the first 100 are shown.','Ցուցադրված են միայն առաջին 100-ը։','Показаны только первые 100 записей.')}</p>}
   <p className="dcv2-time">{t('As of','Տվյալները՝','По состоянию на')} <time dateTime={reply.asOf}>{time(reply.asOf,l)}</time></p>
  </div>;
 }
 if(reply.kind==='history-failed')return <p className="dcv2-time">{t('Earlier answers could not be loaded.','Նախորդ պատասխանները չհաջողվեց բեռնել։','Не удалось загрузить предыдущие ответы.')}</p>;
 if(reply.kind==='off')return <p className="cv2-say" role="alert">{notDone('disabled',l)}</p>;
 if(reply.kind==='loading-member'||reply.kind==='loading-search')return <p className="cv2-say" role="status">{t('Loading…','Բեռնվում է…','Загрузка…')}</p>;
 if(reply.kind==='conversation-failed'||reply.kind==='search-failed')return <p className="cv2-say" role="alert">{notDone('conversation-unavailable',l)}</p>;
 if(reply.kind==='urgent-window')return <UrgentWindowRow window={reply.window} locale={l} onOpen={onOpen}/>;
 if(reply.kind==='alerts')return <div className="dcv2-who" data-urgent-count={reply.p0Total}>
  {reply.incomplete&&<p className="cv2-say" role="alert">{reply.urgentIncomplete?t('Urgent conversations could not be checked. These counts are incomplete.','Շտապ զրույցները չհաջողվեց ստուգել։ Քանակները թերի են։','Не удалось проверить срочные разговоры. Количество неполное.'):t('Some queues could not be read, so these counts are incomplete.','Որոշ ցանկեր չհաջողվեց կարդալ, ուստի քանակները թերի են։','Не удалось прочитать некоторые очереди, поэтому количество неполное.')}</p>}
  {(reply.p0Total>0||reply.urgentIncomplete||!reply.incomplete)&&<p className="cv2-say">{reply.p0Total?t(`${reply.p0Total} urgent ${reply.p0Total===1?'item is':'items are'} waiting for you.`,`Ձեզ սպասում են ${reply.p0Total} շտապ գործեր։`,`Вашего внимания ожидают срочные задачи: ${reply.p0Total}.`):reply.urgentIncomplete?t('Check urgent conversations again.','Կրկին ստուգեք շտապ զրույցները։','Проверьте срочные разговоры ещё раз.'):t('You have no urgent items.','Շտապ գործեր չունեք։','У вас нет срочных задач.')}</p>}
  {reply.alerts.map(alert=><DoctorReply key={alert.id} reply={{kind:'urgent',alert,active:!reply.retiredAlerts?.includes(alert.alert.id)}} locale={l} onOpen={onOpen} busy={busy} onAct={onAct} onCheck={onCheck}/>)}
  {mergeUrgent(reply.alerts,reply.windows).filter(item=>item.kind==='urgent_window').map(window=><UrgentWindowRow key={window.memberId} window={window} locale={l} onOpen={onOpen}/>)}
  {(reply.capped||reply.p0Total>mergeUrgent(reply.alerts,reply.windows).length)&&<p className="cv2-say">{t('Only the first items are shown.','Ցուցադրված են միայն առաջին գործերը։','Показаны только первые записи.')}</p>}
  <p className="dcv2-time">{t('As of','Տվյալները՝','По состоянию на')} <time dateTime={reply.asOf}>{time(reply.asOf,l)}</time></p>
 </div>;
 if(reply.kind==='missing_bp')return <div className="dcv2-who">
  <p className="cv2-say">{t('No BP readings recorded on this search page','Այս որոնման էջում ճնշման գրանցումներ չկան','На этой странице поиска нет записей давления')}: {reply.from} – {reply.to}. {t('Unknown reads','Անհայտ ընթերցումներ','Недоступные записи')}: {reply.unknown}</p>
  <DoctorReply reply={{kind:'members',rows:reply.page.rows.filter(row=>reply.missingIds.includes(row.id)).map(row=>({id:row.id,name:row.name})),hasMore:false}} locale={l} onOpen={onOpen}/>
  {reply.page.hasMore&&<p className="cv2-say">{t('Only the first members were checked.','Ստուգվել են միայն առաջին անդամները։','Проверены только первые участники.')}</p>}
  <p className="dcv2-time">{t('As of','Տվյալները՝','По состоянию на')} <time dateTime={reply.asOf}>{time(reply.asOf,l)}</time></p>
 </div>;
 if(reply.kind==='overdue'){
  const items=overdueDayItems(reply.day,l),{missing}=dayStatus(reply.day,l);
  return <div className="dcv2-who">
   <p className="cv2-say">{t('Overdue items in the available Today queues','Ժամկետանց գործերը «Այսօր» հասանելի ցանկերում','Просроченные элементы доступных очередей «Сегодня»')}: {items.length}</p>
   {missing.length>0&&<p role="alert" className="cv2-say">{unavailableSources(missing.map(id=>id==='ldl'?'ldl_responses':id==='medicines'?'medicine_concerns':id),l)}</p>}
   {items.map(item=><MemberIdentityButton key={item.id} memberId={item.memberId} name={item.name} locale={l} buttonClassName="dcv2-row" data-day-item={item.id} onClick={()=>onOpen(item.memberId,item.name)} onPointerDown={e=>e.preventDefault()}><span>{item.label}</span><time className="dcv2-time" dateTime={item.at}>{time(item.at,l)}</time></MemberIdentityButton>)}
   {(reply.day.tasks?.hasMore||reply.day.inbox.items.some(item=>reply.day.inbox.items.filter(other=>other.lane===item.lane).length>=reply.day.inbox.laneCap))&&<p className="cv2-say">{t('Only the first items are shown.','Ցուցադրված են միայն առաջին գործերը։','Показаны только первые записи.')}</p>}
   <p className="dcv2-time">{t('As of','Տվյալները՝','По состоянию на')} <time dateTime={reply.day.inbox.asOf}>{time(reply.day.inbox.asOf,l)}</time></p>
  </div>;
 }
 if(reply.kind==='members')return <div className="dcv2-who">{reply.rows.length?<MemberDisambiguationCard rows={reply.rows} locale={l} busy={busy} actionLabel={t('Open','Բացել','Открыть')} onChoose={row=>onOpen(row.id,row.name)}/>:<p>{t('No member of yours matches.','Ձեր անդամներից ոչ մեկը չի համապատասխանում։','Среди ваших участников совпадений нет.')}</p>}{reply.hasMore&&<p>{t('More members match. Enter a fuller name, more phone digits or a date of birth.','Ավելի շատ անդամներ են համապատասխանում։ Մուտքագրեք ավելի ամբողջական անուն, հեռախոսի ավելի շատ նիշեր կամ ծննդյան ամսաթիվ։','Найдены и другие участники. Уточните имя, добавьте цифры телефона или введите дату рождения.')}</p>}</div>;
 if(reply.kind==='loading-who')return <p className="cv2-say" role="status">{t('Checking who needs you…','Ստուգում եմ՝ ում է պետք ձեր օգնությունը…','Проверяю, кому нужна ваша помощь…')}</p>;
 if(reply.kind==='refused')return <p className="cv2-say" role="alert">{notDone('reason'in reply&&reply.reason==='conversation_access'?'conversation-access':'reason'in reply&&reply.reason==='zoe_context_access'?'zoe-context-access':'read-access',l)}</p>;
 if(reply.kind==='results-unavailable')return <p className="cv2-say" role="alert">{notDone('results-unavailable',l)}</p>;
 if(reply.kind==='unavailable')return <p className="cv2-say" role="alert">{t('The waiting list could not be read. Try “Who needs me” again.','Սպասողների ցանկը չհաջողվեց կարդալ։ Կրկին գրեք «Ո՞ւմ է պետք իմ օգնությունը»։','Не удалось прочитать список ожидающих. Попробуйте снова написать «Кому нужна моя помощь».')}</p>;
 if(reply.kind==='poll-failed')return <p className="cv2-say" role="alert">{t('Urgent alerts could not be checked.','Շտապ ահազանգերը չհաջողվեց ստուգել։','Не удалось проверить срочные оповещения.')}</p>;
 if(reply.kind==='alert-outcome')return <AlertOutcome item={reply.alert} result={reply.result} locale={l} active={reply.active} busy={busy} onCheck={onCheck}/>;
 if(reply.kind==='urgent')return <div className="dcv2-alert" role="alert"><MemberRow item={reply.alert} locale={l} onOpen={onOpen}/><AlertButtons item={reply.alert} onOpen={()=>onOpen(reply.alert.memberId,reply.alert.memberName)} locale={l} active={reply.active} busy={busy} onAct={onAct} closer={closer}/></div>;
 if(reply.kind==='who'){
  const members=new Set([...reply.items,...reply.labs,...reply.plans,...reply.uploads,...(reply.identityChecks??[])].map(i=>i.memberId)).size;
  const waiting=[...(reply.p0Total?[count(reply.p0Total,l,['urgent item','urgent items'],'շտապ գործ',['срочная задача','срочные задачи','срочных задач'])]:[]),
   ...(members?[count(members,l,['member','members'],'անդամ',['участник','участника','участников'])]:[])];
  const {rest}=reply.others,otherTotal=rest;
  const both=waiting.join(t(' and ',' և ',' и '));
  const opening=waiting.length?t(`${both} ${reply.p0Total+members===1?'is':'are'} waiting for you.`,`${both} սպասում ${reply.p0Total+members===1?'է':'են'} ձեզ։`,`Вас ожидают: ${both}.`)
   :reply.incomplete?t('I could not read all your care queues. I cannot tell you that nothing is waiting.','Չհաջողվեց կարդալ խնամքի բոլոր ցանկերը։ Չեմ կարող հաստատել, որ սպասող գործեր չկան։','Не удалось прочитать все очереди. Я не могу подтвердить, что ожидающих записей нет.')
   :otherTotal?t(`You have ${otherTotal} other ${otherTotal===1?'item':'items'} waiting for your review.`,`Ձեր վերանայմանն է սպասում ևս ${otherTotal} գործ։`,`Вашей проверки ожидают: ${otherTotal} ${russian(otherTotal,['другая запись','другие записи','других записей'])}.`)
   :t('Nobody is waiting for you right now.','Այս պահին ոչ ոք չի սպասում ձեզ։','Сейчас никто не ждёт вашего ответа.');
  const others=[...(rest?[count(rest,l,['other item','other items'],'այլ գործ',['другая запись','другие записи','других записей'])]:[])];
  return <div className="dcv2-who" data-urgent-count={reply.p0Total}>
   {reply.incomplete&&<p role="alert" className="cv2-say">{unavailableSources(reply.missing,l)}</p>}
   <p className="cv2-say">{opening}</p>
   {reply.alerts.map(i=><div key={i.id} className="dcv2-alert-row"><MemberRow item={i} locale={l} onOpen={onOpen}/><AlertButtons item={i} onOpen={()=>onOpen(i.memberId,i.memberName)} locale={l} active={!reply.retiredAlerts?.includes(i.alert.id)} busy={busy} onAct={onAct} closer={closer}/></div>)}
   {mergeUrgent(reply.alerts,reply.windows).filter(item=>item.kind==='urgent_window').map(window=><UrgentWindowRow key={window.memberId} window={window} locale={l} onOpen={onOpen}/>)}
   <UploadIdentityChecks rows={reply.identityChecks??[]} locale={l} onOpen={onLab?row=>onLab(row.memberId,row.fileId,row.memberName):undefined}/>
   {reply.items.map(i=><MemberRow key={i.id} item={i} locale={l} onOpen={onOpen}/>)}
   {reply.labs.map(i=><MemberRow key={i.id} item={i} locale={l} onOpen={onOpen} onLab={onLab}/>)}
   {reply.plans.map(i=><MemberRow key={i.id} item={i} locale={l} onOpen={onOpen} onPlan={onPlan}/>)}
   {reply.uploads.map(upload=><MemberIdentityButton key={upload.jobId} memberId={upload.memberId} name={upload.memberName} locale={l} buttonClassName="dcv2-row" data-upload-job={upload.jobId} onClick={()=>onUpload?.(upload.memberId,upload.documentId,upload.memberName)} onPointerDown={e=>e.preventDefault()}><span>{t('Upload waiting for approval','Վերբեռնումը սպասում է հաստատման','Файл ожидает утверждения')}</span><time className="dcv2-time" dateTime={upload.at}>{time(upload.at,l)}</time></MemberIdentityButton>)}
   {reply.capped&&<p className="cv2-say">{t('Only the first items are shown.','Ցուցադրված են միայն առաջին գործերը։','Показаны только первые записи.')}</p>}
   {others.length>0&&<p className="cv2-say">{t(`Also waiting: ${others.join(', ')} (first notes, medicine questions, hand-overs).`,`Նաև սպասում են՝ ${others.join(', ')} (առաջին գրառումներ, դեղերի մասին հարցեր, փոխանցումներ)։`,`Также ожидают: ${others.join(', ')} (первые сообщения, вопросы о лекарствах, передачи).`)}</p>}
   <p className="dcv2-time">{t('As of','Տվյալները՝','По состоянию на')} <time dateTime={reply.asOf}>{time(reply.asOf,l)}</time></p>
  </div>;
 }
 if(reply.kind==='small-talk')return <div className="space-y-2">{reply.lines.map((line,index)=><p key={index} className="cv2-say">{line}</p>)}</div>;
 if(reply.kind==='text'){
  const followUp=reply.followUp;
  if(!followUp)return <p className="cv2-say">{reply.text}</p>;
  return <div><ChatMemberIdentity memberId={followUp.memberId} name={followUp.memberName} locale={l}/><p className="cv2-say">{reply.text}</p><button type="button" className="dcv2-choice" disabled={busy} onClick={()=>{if(followUp.kind==='results')onResults?.(followUp.memberId,followUp.memberName);else onOpen(followUp.memberId,followUp.memberName);}} onPointerDown={e=>e.preventDefault()} onMouseDown={e=>e.preventDefault()}>{followUp.kind==='results'?t('Open member results','Բացել անդամի արդյունքները','Открыть результаты участника'):t('Open member conversation','Բացել անդամի զրույցը','Открыть разговор участника')}</button></div>;
 }
 return <p className="cv2-say">{t(
  'Ask “Who needs me” or enter a member’s name.',
  'Հարցրեք «Ո՞ւմ է պետք իմ օգնությունը» կամ մուտքագրեք անդամի անունը։',
  'Спросите «Кому нужна моя помощь» или введите имя участника.')}</p>;
}
