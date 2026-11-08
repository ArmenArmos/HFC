import {ChatMemberIdentity} from '@/components/staff/chat-member-identity';
import {UploadIdentityChecks} from '@/components/staff/upload-identity-check';
import type {DoctorUploadOverride} from '@/lib/staff/doctor-upload-overrides';
import {useState} from 'react';
import {done,notDone} from '@/lib/staff-zoe/outcome-copy';
import {urgentWindowLine} from '@/lib/doctor-inbox/urgent-windows';
import {handBackCopy} from '@/lib/staff-zoe/hand-back-copy';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {ReplyDraftSources} from '@/components/conversation/reply-draft-sources';
import {DeliveryRetry} from '@/components/conversation/delivery-retry';
import {approvalFailureText,deliveryLabelText,deliveryDetailText} from '@/lib/telegram-runtime/delivery-copy';
import type {ChatMemberResponse} from '@/lib/staff-zoe/chat-v2-actions';
import type {ChatThreadEntry} from '@/lib/staff-zoe/chat-v2-read';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
export type MemberData=Extract<ChatMemberResponse,{kind:'member'}>;
export type ReplyStatus='queued'|'saved'|'stale'|'access'|'disabled'|'outcome-unknown'|'unavailable'|`approval:${string}`;
type Status=ReplyStatus;
export function ReplyOutcome({status,locale,entry,onRetry}:{status:Status|null;locale:StaffLocale;entry?:ChatThreadEntry;onRetry?:(id:string,memberId?:string)=>Promise<unknown>}){
 if(entry?.delivery)return <EntryDelivery entry={entry} locale={locale} onRetry={onRetry}/>;
 if(!status)return null;
 const text=status.startsWith('approval:')?approvalFailureText(status.slice(9),locale):status==='saved'?done('reply-saved',locale):status==='queued'?`${deliveryLabelText('queued',locale)}. ${deliveryDetailText('queued',null,locale)}`:
  status==='stale'?notDone('stale',locale):
  status==='access'?notDone('access',locale):
  status==='disabled'?notDone('disabled',locale):
  status==='outcome-unknown'?notDone('unknown',locale):
  notDone('save-failed',locale);
 return <p role={status==='saved'||status==='queued'?'status':'alert'} className="text-body2">{text}</p>;
}

export function ConversationEntries({entries,locale,onRetry}:{entries:ChatThreadEntry[];locale:StaffLocale;onRetry?:(id:string,memberId?:string)=>Promise<unknown>}){
 return <div className="dcv2-entries">{entries.map(entry=><div key={entry.key} data-entry-key={entry.key} className={`cv2-msg ${entry.who==='doctor'?'cv2-me':'cv2-zoe'}`}>
  <p className="cv2-from">{entry.name}{entry.who==='nurse'?` · ${st(locale,'Nurse','Բուժքույր','Медсестра')}`:''}</p>
  <p className="cv2-say">{entry.text}</p><time className="cv2-time" dateTime={entry.at}>{new Intl.DateTimeFormat(locale,{timeZone:'Asia/Yerevan',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(entry.at))}</time>
  <EntryDelivery entry={entry} locale={locale} onRetry={onRetry}/>
 </div>)}</div>;
}
function EntryDelivery({entry,locale,onRetry}:{entry:ChatThreadEntry;locale:StaffLocale;onRetry?:(id:string,memberId?:string)=>Promise<unknown>}){
 const delivery=entry.delivery;
 return <>{delivery&&<><p className="dcv2-time">{deliveryLabelText(delivery.state,locale)}. {deliveryDetailText(delivery.state,delivery.reason,locale)}</p>{delivery.id&&<DeliveryRetry delivery={{...delivery,id:delivery.id}} locale={locale} retry={onRetry?id=>onRetry(id,entry.memberId):undefined}/>}</>}
 {!!entry.deliveryHistory?.length&&<details><summary className="min-h-12 cursor-pointer">{st(locale,'History','Պատմություն','История')}</summary>{entry.deliveryHistory.map((old,index)=><p key={index} className="dcv2-time">{deliveryLabelText(old.state,locale)}. {deliveryDetailText(old.state,old.reason,locale)}</p>)}</details>}</>;
}
function MemberSummary({data,locale}:{data:MemberData;locale:StaffLocale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru),facts=data.summary,[readAt]=useState(()=>new Date().toISOString());
 // Only what was found is said. The summary is read once when the member opens and the thread below keeps updating, so it never says that nothing is waiting, and it carries the time it was read.
 const next=data.urgentOpen?t('Review the open 103 alert','Վերանայեք 103-ի բաց ահազանգը','Проверьте открытое оповещение 103'):
  facts?.replyWaiting==='draft'?t('Review the waiting draft','Վերանայեք սպասող սևագիրը','Проверьте ожидающий черновик'):
  facts?.replyWaiting==='message'?t('Reply to the member','Պատասխանեք անդամին','Ответьте участнику'):
  facts?.resultsWaiting?t('Review the results','Վերանայեք արդյունքները','Проверьте результаты'):
  null;
 if(!data.memberName&&!data.urgentOpen&&!facts)return null;
 return <div className="dcv2-member-summary">
  {data.urgentOpen&&<p role="alert" className="dcv2-alert" data-urgent-window={data.memberId}>{data.urgentSince?urgentWindowLine(data.urgentSince,locale):t('The 103 text was sent to the member; no one has answered.','Անդամին ուղարկվել է 103 զանգահարելու տեքստը։ Դեռ ոչ ոք չի պատասխանել։','Участнику отправлен текст с рекомендацией позвонить 103; пока никто не ответил.')}</p>}
  {facts?.latestFileAt&&<p>{t('Latest file','Վերջին ֆայլը','Последний файл')}: <time dateTime={facts.latestFileAt}>{yerevanStamp(facts.latestFileAt,locale)}</time></p>}
  {facts?.replyWaiting&&<p>{facts.replyWaiting==='draft'?t('Draft awaiting your review','Սևագիրը սպասում է ձեր վերանայմանը','Черновик ждёт вашей проверки'):t('Member message awaiting your reply','Անդամի հաղորդագրությունը սպասում է ձեզ','Сообщение участника ждёт ответа')}</p>}
  {next&&<p>{next}</p>}
  {(data.urgentOpen||facts?.latestFileAt||facts?.replyWaiting||next)&&<p className="dcv2-time">{t('As of','Տվյալները՝','По состоянию на')} <time dateTime={readAt}>{yerevanStamp(readAt,locale)}</time></p>}
 </div>;
}
export function MemberConversation({data,active,busy,editing=false,composingElsewhere=false,status,savedBody,compact=false,locale,onApprove,onChange,onRetry,sentDelivery,onPlan,onHandover,onHandBack,onUploads,onIdentityCheck}:{data:MemberData;active:boolean;busy:boolean;editing?:boolean;composingElsewhere?:boolean;status?:ReplyStatus;savedBody?:string;compact?:boolean;locale:StaffLocale;onApprove:()=>void;onChange:()=>void;onRetry?:(id:string,memberId?:string)=>Promise<unknown>;sentDelivery?:ChatThreadEntry;onPlan?:()=>void;onHandover?:()=>void;onHandBack?:()=>void;onUploads?:()=>void;onIdentityCheck?:(row:DoctorUploadOverride)=>void}){
 const [all,setAll]=useState(false),[confirm,setConfirm]=useState(false),t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const card=active?data.reply?.card:null,prepare=active?data.reply?.prepare:null;
 const frozen=busy||editing||status==='outcome-unknown';
 const sourceSeq=data.source?.messageSeq;
 const sourceMessageAt=sourceSeq===undefined?undefined:data.thread.find(entry=>entry.key===`member:${sourceSeq}`)?.at;
 return <section className="dcv2-conversation" data-conversation-member={data.memberId}>
  {!compact&&<header className="dcv2-member-header"><h2><ChatMemberIdentity memberId={data.memberId} name={data.memberName} member={data.identity} locale={locale}/></h2></header>}
  <UploadIdentityChecks rows={data.identityChecks??[]} locale={locale} onOpen={onIdentityCheck}/>
  {data.identityChecksFailed&&<p role="alert">{t("File identity checks are unavailable. Reload before using lab values.","Ֆայլերի ինքնության ստուգումներն անհասանելի են։ Թարմացրեք՝ լաբորատոր արժեքներն օգտագործելուց առաջ։","Проверки принадлежности файлов недоступны. Обновите перед использованием показателей.")}</p>}
  {active&&!compact&&!status&&<p role="status">{done('member-opened',locale)}</p>}
  {!compact&&!card&&<MemberSummary data={data} locale={locale}/>}
  {!compact&&<p className="dcv2-time">{data.mode.doctorMode?t('You are answering this member','Դուք եք պատասխանում այս անդամին','Этому участнику отвечаете вы'):data.mode.zoeActive?t('Zoe is answering this member','Զոյան է պատասխանում այս անդամին','Этому участнику отвечает Zoe'):t('Zoe is unavailable','Զոյան հասանելի չէ','Zoe недоступна')}</p>}
  {data.urgentOpen&&(compact||card)&&<p role="alert" className="dcv2-alert" data-urgent-window={data.memberId}>{data.urgentSince?urgentWindowLine(data.urgentSince,locale):t('The 103 text was sent to the member; no one has answered.','Անդամին ուղարկվել է 103 զանգահարելու տեքստը։ Դեռ ոչ ոք չի պատասխանել։','Участнику отправлен текст с рекомендацией позвонить 103; пока никто не ответил.')}</p>}
  {data.urgentFailed&&<p role="alert" className="dcv2-alert">{t('Whether a 103 alert is open could not be loaded. Reload to try again.','Չհաջողվեց բեռնել՝ արդյոք 103-ի ահազանգը բաց է։ Թարմացրեք՝ կրկին փորձելու համար։','Не удалось узнать, открыто ли оповещение 103. Обновите, чтобы повторить попытку.')}</p>}
  {data.unsupportedMedia&&<p role="alert" className="dcv2-alert">{t('The member sent a photo, voice message, location or other non-text message. Noreon cannot read it, including any caption, and did not keep it. Contact the member to find out what they sent before replying.','Անդամն ուղարկել է լուսանկար, ձայնային հաղորդագրություն, տեղորոշում կամ այլ ոչ տեքստային հաղորդագրություն։ Noreon-ը չի կարող այն կարդալ, ներառյալ ցանկացած մակագրություն, և այն չի պահպանել։ Պատասխանելուց առաջ կապվեք անդամի հետ՝ պարզելու, թե ինչ է նա ուղարկել։',"Участник отправил фото, голосовое сообщение, местоположение или другое нетекстовое сообщение. Noreon не может прочитать его, включая подпись, и не сохранил его. Прежде чем отвечать, свяжитесь с участником и уточните, что он отправил.")}</p>}
  {data.unsavedOverLimit&&<p role="alert" className="dcv2-alert">{t('The member sent more messages than the intake limit allows. Those messages were not saved and are not shown here. Contact the member before replying.','Անդամն ուղարկել է ավելի շատ հաղորդագրություններ, քան թույլատրում է ընդունման սահմանաչափը։ Այդ հաղորդագրությունները չեն պահպանվել և այստեղ ցուցադրված չեն։ Պատասխանելուց առաջ կապվեք անդամի հետ։',"Участник отправил больше сообщений, чем допускает лимит. Эти сообщения не сохранены и здесь не показаны. Свяжитесь с участником, прежде чем отвечать.")}</p>}
  {data.zoeFailed&&<p role="alert">{t('Zoe’s answers could not be loaded.','Զոյայի պատասխանները չհաջողվեց բեռնել։','Не удалось загрузить ответы Zoe.')}</p>}
  {!compact&&<>{!all&&data.thread.length>30&&<button type="button" className="dcv2-choice" onClick={()=>setAll(true)}>{t('Earlier messages','Ավելի վաղ հաղորդագրություններ','Предыдущие сообщения')}</button>}
   <ConversationEntries entries={all?data.thread:data.thread.slice(-30)} locale={locale} onRetry={onRetry}/>
   {!data.thread.length&&<p>{t('No messages yet.','Հաղորդագրություններ դեռ չկան։','Сообщений пока нет.')}</p>}</>}
  {active&&data.mode.doctorMode&&(!data.mode.zoeActive?<p role="status">{handBackCopy('inactive',locale)}</p>:onHandBack&&data.conversationId&&data.version!==null&&<div className="dcv2-hand-back">
   {!confirm?<button type="button" className="dcv2-choice" disabled={frozen} onClick={()=>setConfirm(true)} onPointerDown={e=>e.preventDefault()}>{t('Hand back to Zoe','Վերադարձնել Զոյային','Передать обратно Zoe')}</button>:<><p>{handBackCopy('confirm',locale)}</p><div className="dcv2-controls"><button type="button" className="dcv2-choice" disabled={frozen} onClick={onHandBack} onPointerDown={e=>e.preventDefault()}>{t('Confirm hand-back','Հաստատել վերադարձը','Подтвердить передачу')}</button><button type="button" className="dcv2-choice" disabled={frozen} onClick={()=>setConfirm(false)} onPointerDown={e=>e.preventDefault()}>{t('Cancel','Չեղարկել','Отмена')}</button></div></>}
  </div>)}
  <ReplyOutcome status={status??null} locale={locale} entry={sentDelivery} onRetry={onRetry}/>
  {status==='outcome-unknown'&&<p role="alert">{t('Re-open the member before continuing.','Շարունակելուց առաջ կրկին բացեք անդամին։','Снова откройте участника, прежде чем продолжить.')}</p>}
  {active&&data.replyFailed&&<p role="alert">{t('The reply could not be prepared. Re-open the member to try again.','Պատասխանը չհաջողվեց պատրաստել։ Կրկին փորձելու համար նորից բացեք անդամին։','Не удалось подготовить ответ. Снова откройте участника, чтобы повторить попытку.')}</p>}
  {(card||(active&&savedBody!==undefined))&&<div data-draft className="dcv2-draft">
   {savedBody!==undefined&&<p role="status">{done('reply-saved',locale)}</p>}
   {card&&<>
   {savedBody===undefined&&card.author==='staff'&&<p role="status">{done('reply-saved',locale)}</p>}
   {savedBody===undefined?<><h3>{card.author==='staff'?t('Your draft','Ձեր նախագիծը','Ваш черновик'):t("Zoe's draft",'Զոյայի նախագիծը','Черновик Zoe')}</h3><p className="cv2-say">{card.body}</p></>:<>{savedBody!==card.body&&<p className="cv2-say">{card.body}</p>}</>}
   {data.sourcesFailed&&<p role="alert">{t('How Zoe prepared this draft could not be loaded. Check the reply against the member’s published plan before approving.','Չհաջողվեց բեռնել, թե ինչպես է Զոն պատրաստել այս սևագիրը։ Հաստատելուց առաջ համեմատեք պատասխանն անդամի հրապարակված պլանի հետ։','Не удалось загрузить сведения о том, как Zoe подготовила этот черновик. Перед подтверждением сверьте ответ с опубликованным планом участника.')}</p>}
   {data.source&&<ReplyDraftSources source={data.source} messageAt={sourceMessageAt} edited={card.author==='staff'} locale={locale}/>}
   <p>{t('Your press approves and queues this exact text for the member.','Սեղմելով՝ հաստատում եք և հերթագրում այս ճշգրիտ տեքստը՝ անդամին ուղարկելու համար։','Нажатие утверждает и ставит в очередь именно этот текст для участника.')}</p>
   {card.takeover&&<p>{t('Your reply also takes over the conversation. The existing topic setting applies. Urgent safety replies continue. You can hand back to Zoe here in the chat.','Ձեր պատասխանը նաև ձեզ է փոխանցում զրույցը։ Գործում է թեմայի առկա կարգավորումը։ Շտապ անվտանգության պատասխանները շարունակվում են։ Այստեղ՝ զրույցում, կարող եք այն վերադարձնել Զոյային։','Ваш ответ также передаёт разговор вам. Действует текущая настройка темы. Срочные ответы безопасности сохраняются. Вернуть разговор Zoe можно здесь, в чате.')}</p>}
   <div className="dcv2-controls"><button type="button" className="dcv2-choice" disabled={frozen} onClick={onApprove} onPointerDown={e=>e.preventDefault()}>{card.takeover?t('Send this reply and take over','Ուղարկել այս պատասխանը և շարունակել','Отправить этот ответ и продолжить'):t('Send this reply','Ուղարկել այս պատասխանը','Отправить этот ответ')}</button><button type="button" className="dcv2-choice" disabled={frozen} onClick={onChange} onPointerDown={e=>e.preventDefault()}>{t('Change','Փոխել','Изменить')}</button></div>
   </>}
  </div>}
  {!card&&prepare&&data.staleDraft&&<p role="alert">{t('New evidence arrived. Review the current intake and save a new draft before approval.','Նոր տվյալներ են ստացվել։ Հաստատելուց առաջ ստուգեք ընթացիկ հաղորդագրությունները և պահպանեք նոր սևագիր։',"Поступили новые данные. Проверьте текущие сообщения и сохраните новый черновик перед подтверждением.")}</p>}
  {active&&<div className="dcv2-controls dcv2-member-actions">
  {!card&&prepare&&<button type="button" className="dcv2-choice" disabled={busy||composingElsewhere||status==='outcome-unknown'} onClick={onChange} onPointerDown={e=>e.preventDefault()}>{t('Reply','Պատասխանել','Ответить')}</button>}
  {!compact&&onPlan&&<button type="button" className="dcv2-choice" disabled={busy} onClick={onPlan} onPointerDown={e=>e.preventDefault()}>{t('Care plan','Խնամքի պլան','План лечения')}</button>}
  {!compact&&onHandover&&<button type="button" className="dcv2-choice" disabled={busy} onClick={onHandover} onPointerDown={e=>e.preventDefault()}>{t('Hand over to the nurse','Փոխանցել բուժքրոջը','Передать медсестре')}</button>}
  {!compact&&!!data.uploads?.length&&onUploads&&<button type="button" className="dcv2-choice" disabled={busy} onClick={onUploads} onPointerDown={e=>e.preventDefault()}>{t('Uploads','Վերբեռնումներ','Файлы')}</button>}
  </div>}
  {active&&data.uploadsFailed&&<p role="alert">{t('The upload queue is unavailable.','Վերբեռնումների ցանկն անհասանելի է։','Очередь файлов недоступна.')}</p>}
 </section>;
}
