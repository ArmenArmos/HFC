'use client';
import {RecordCard} from '@/components/staff/zoe/cards';
import {labsResult} from '@/lib/staff-zoe/facts';
import {DoctorCardReload} from './card-reload';
import {DoctorConversationCard} from './conversation-card';
import {DoctorObservationsCard} from './observations-card';
import {DoctorAlertResolution} from './alert-resolution';
import {resolveDoctorCardAlert} from '@/lib/staff-zoe/everyday-actions';
import {RecordRefreshProvider} from '@/components/staff/record-refresh';
import {useRef,useState} from 'react';
import type {Locale} from '@/lib/locale';
import type {DoctorCardResponse} from '@/lib/staff-zoe/card-read';
import {st} from '@/lib/staff/staff-locale-copy';
import {RealReviewControls} from '@/components/real-review/review-controls';
import {PublishConfirmationProvider} from '@/components/real-review/publish-confirmation';
import {LabAiCheck} from '@/components/staff/lab-ai-check';
import {confirmLabIdentity,requestLabReading,reviewLabValue} from '@/lib/lab-ai/actions';
import {MemberDocuments} from '@/components/staff/member-documents';
import {recordMemberDocumentRelease} from '@/lib/doctor-completion/document-actions';
import {MemberUploads} from '@/components/staff/member-uploads';
import {approveMemberUpload} from '@/lib/lab-ai/actions';
import {MemberSafetyPanel} from '@/components/staff/member-safety-panel';
import {decideMemberSafetyHold} from '@/lib/member-safety/actions';
import {RealCoordinationTasks} from '@/components/staff/real-coordination-tasks';
import {GpReportPanel} from '@/components/staff/gp-report-panel';
import {approveMemberGpReport} from '@/lib/gp-report/actions';
import {LdlGoalPanel} from '@/components/staff/ldl-goal-panel';
import {addLdlEvent,addLdlTherapy,endLdlTherapy,removeLdlEvent,setLdlGoal} from '@/lib/ldl/actions';
import {cancelLdlRetest} from '@/lib/ldl/response-actions';
import {DoctorDecisionCards} from './decisions';
import {AlertCardLines} from '@/components/staff/alert-card';
import {UrgentWindowRow} from '@/components/doctor-inbox/urgent-window';
import {stamp} from '@/components/patient-care/common';
import {calendarDate} from '@/lib/staff/yerevan-time';

/** Reuse page controls verbatim. Reload is explicit; polling cannot replace an edited review. */
export function DoctorRecordCard({response,locale,doctorId,onReload,onSaved,onSelect,onAlertsView,onLab,onReply,pending,doctorName=''}:{onSaved?:()=>void;onReply?:()=>void;doctorName?:string;response:DoctorCardResponse;locale:Locale;doctorId:string;onReload:(preserveState?:boolean,saved?:boolean)=>Promise<void>;onSelect:(memberId:string)=>void;onAlertsView:(view:'live'|'resolved')=>void;pending:boolean;onLab:(fileId:string)=>void}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const [hasUnsavedText,setHasUnsavedText]=useState(false);
 const textEdits=useRef(new Map<HTMLInputElement|HTMLTextAreaElement,string>());
 function trackText(e:React.ChangeEvent<HTMLElement>){
  const field=e.target as HTMLInputElement|HTMLTextAreaElement;
  if(field.tagName!=='TEXTAREA'&&(field.tagName!=='INPUT'||['hidden','checkbox','radio','button','submit','reset','file'].includes((field as HTMLInputElement).type)))return;
  if(!textEdits.current.has(field))textEdits.current.set(field,field.defaultValue);
  setHasUnsavedText([...textEdits.current].some(([input,original])=>input.value.trim()!==''&&input.value!==original));
 }
 function saved(){void onReload(false,true);}
 const [submissionId]=useState(()=>crypto.randomUUID());
 const [submissionIds]=useState(()=>response.kind==='ready'&&response.card==='results'?Object.fromEntries(response.documents?.documents.flatMap(doc=>(['release','withdraw']as const).map(action=>[`${doc.fileId}:${action}`,crypto.randomUUID()]))??[]):{});
 const [labSubmissionIds]=useState(()=>response.kind==='ready'&&response.card==='lab'?Object.fromEntries(response.data.values.flatMap(v=>(['confirm','correct','reject']as const).map(action=>[`${v.valueId}:${action}`,crypto.randomUUID()]))):{});
 const unavailable=<p role="status" className="text-body2">{t('This source is unavailable. Reload the card to check it.','Այս աղբյուրն անհասանելի է։ Թարմացրեք քարտը՝ ստուգելու համար։','Этот источник недоступен. Обновите карточку, чтобы проверить его.')}</p>;
 let content:React.ReactNode;
 if(response.kind!=='ready')content=response.kind==='off'?<p role="status">{t('This feature is switched off.','Այս հնարավորությունն անջատված է։','Эта функция отключена.')}</p>:unavailable;
 else switch(response.card){
  case 'conversation':content=<DoctorConversationCard response={response} doctorId={doctorId} doctorName={doctorName} locale={locale} onRefresh={onSaved}/>;break;
  case 'observations':content=<DoctorObservationsCard key={`${response.snapshot.id}:${response.snapshot.revision}:${doctorId}`} snapshot={response.snapshot} doctorId={doctorId} locale={locale} onRefresh={saved}/>;break;
  case 'lab':content=<LabAiCheck data={response.data} memberId={response.memberId} locale={locale} submissionIds={labSubmissionIds} ports={{review:reviewLabValue.bind(null,response.memberId,response.data.fileId),confirmIdentity:confirmLabIdentity.bind(null,response.memberId,response.data.fileId),readAgain:requestLabReading.bind(null,response.memberId,response.data.fileId)}}/>;break;
  case 'results':content=<PublishConfirmationProvider>
   <section className="space-y-3"><h2 className="text-h3">{t('Reviewed results','Վերանայված արդյունքներ','Проверенные результаты')}</h2>
    {response.clinicLab?.length?<ul className="space-y-3">{response.clinicLab.flatMap(source=>source.values.map(value=><li key={`${source.attachmentId}:${value.id}`} className="rounded-lg border p-3 text-body2"><p className="font-semibold">{value.name}: {value.value??value.valueText} {value.unit}</p>{value.reference&&<p>{t('Reference range','Հղումային միջակայք','Референсный диапазон')}: {value.reference}</p>}<p className="text-caption">{t('Source','Աղբյուր','Источник')}: {value.laboratory??source.clinic} · {calendarDate(value.collectedOn,locale)}</p><a className="inline-flex min-h-11 items-center underline" href={`/staff/real/clinic-originals/${source.fileId}`} target="_blank" rel="noreferrer">{source.fileName}</a></li>))}</ul>:<p className="text-body2">{response.clinicLab===null?t('Reviewed clinic results could not be read.','Կլինիկայի վերանայված արդյունքները չհաջողվեց կարդալ։','Не удалось прочитать проверенные результаты клиники.'):t('No reviewed clinic results recorded yet.','Կլինիկայի վերանայված արդյունքներ դեռ գրանցված չեն։','Проверенные результаты клиники пока не записаны.')}</p>}
   </section>
   {response.values?.enabled?<RecordCard card={labsResult(response.values,{memberId:response.memberId,role:'doctor',locale,now:new Date()})} locale={locale} memberRef=""/>:<p role="status">{t('Lab values could not be read. Check the source documents below.','Լաբորատոր արժեքները չհաջողվեց կարդալ։ Ստուգեք ստորև բերված փաստաթղթերը։','Не удалось прочитать значения анализов. Проверьте исходные документы ниже.')}</p>}
   {response.completion&&(response.documents?<MemberDocuments data={response.documents} memberId={response.memberId} locale={locale} submissionIds={submissionIds} command={recordMemberDocumentRelease.bind(null,response.memberId)} lab={response.lab} onCheckValues={onLab}/>:unavailable)}
   <RealReviewControls snapshot={response.snapshot} clinicLab={response.clinicLab} requiredEvidence={response.requiredEvidence} requestId={submissionId} section="evidence" completion={response.completion&&response.documents?.enabled!==false} locale={locale}/>
  </PublishConfirmationProvider>;break;
  case 'uploads':content=<MemberUploads data={response.history} memberId={response.memberId} locale={locale} ai={response.ai} approval={response.ai?.enabled?{data:response.approval??null,memberId:response.memberId,approve:approveMemberUpload}:undefined}/>;break;
  case 'safety':content=<MemberSafetyPanel data={response.data} memberId={response.memberId} locale={locale} decide={decideMemberSafetyHold}/>;break;
  case 'tasks':content=<RealCoordinationTasks page={response.page} memberPage={response.memberPage} actor={{id:doctorId,role:'doctor'}} caseId={response.memberId} locale={locale}/>;break;
  case 'consultation':content=<DoctorDecisionCards data={response.data} locale={locale} onReply={onReply} onRefresh={wasSaved=>onReload(false,wasSaved)}/>;break;
  case 'ldl':content=<details open={response.data.goals.length>0}><summary className="min-h-11 cursor-pointer text-body2">{response.data.goals.length?t('Review LDL goal','Վերանայել ՑԽԼ նպատակը','Проверить цель ЛПНП'):t('No LDL goal recorded. Set a goal','ՑԽԼ նպատակ գրանցված չէ։ Սահմանել նպատակ','Цель ЛПНП не записана. Задать цель')}</summary><LdlGoalPanel data={response.data} memberId={response.memberId} locale={locale} actions={{addEvent:addLdlEvent,removeEvent:removeLdlEvent,addTherapy:addLdlTherapy,endTherapy:endLdlTherapy,setGoal:setLdlGoal,cancelRetest:cancelLdlRetest}}/></details>;break;
  case 'gp':content=<GpReportPanel memberId={response.memberId} locale={locale} token={response.token} submissionId={submissionId} blocks={response.blocks} versions={response.versions} currentApproved={response.currentApproved} approve={approveMemberGpReport}/>;break;
  case 'alerts':content=<section className="space-y-3" data-urgent-count={response.view==='live'?response.urgentTotal:undefined}>
   <h2 className="text-h3">{t('Alerts','Ահազանգեր','Оповещения')}</h2>
   <p className="text-body2">{t('An alert needs your review. It does not mean emergency services were called.','Ահազանգը պահանջում է ձեր վերանայումը։ Այն չի նշանակում, որ շտապ օգնություն է կանչվել։','Оповещение требует вашей проверки. Оно не означает, что вызвана скорая помощь.')}</p>
   <div role="tablist" className="flex gap-2 border-b">{(['live','resolved']as const).map(view=><button key={view} disabled={pending} role="tab" aria-selected={response.view===view} className={`min-h-11 border-b-2 px-3 ${response.view===view?'border-primary font-semibold':'border-transparent'}`} onClick={()=>onAlertsView(view)}>{view==='live'?t('Open and acknowledged','Բաց և հաստատված','Открытые и подтвержденные'):t('Resolved','Լուծված','Закрытые')}</button>)}</div>
   {response.incomplete&&<p role="alert">{t('This list is incomplete. Reload to check your urgent items.','Այս ցանկն ամբողջական չէ։ Թարմացրեք՝ ձեր շտապ գործերը ստուգելու համար։','Список неполный. Обновите его, чтобы проверить срочные задачи.')}</p>}
   {response.windows.length>0&&<ul className="divide-y">{response.windows.map(window=><UrgentWindowRow key={window.memberId} window={window} locale={locale}/>)}</ul>}
   {!response.inbox.alerts.length?(!response.windows.length&&!response.incomplete&&!response.capped&&<p>{t('No alerts in this list.','Այս ցանկում ահազանգեր չկան։','В этом списке нет оповещений.')}</p>):<ul className="divide-y">{response.inbox.alerts.map(a=><li key={a.id} className="space-y-2 py-3">
    <p className="text-body2 font-semibold">{a.memberName}</p><AlertCardLines alert={a} locale={locale}/>
    <DoctorAlertResolution alert={a} locale={locale} onRefresh={onSaved} command={input=>resolveDoctorCardAlert(input,doctorId)}/>
    <button className="dw-pill" disabled={pending} onClick={()=>onSelect(a.memberId)}>{t('Open member review','Բացել անդամի վերանայումը','Открыть проверку участника')}</button>
   </li>)}</ul>}
   <p className="text-caption">{t('Source: alerts. As of','Աղբյուր՝ ահազանգեր։ Առ','Источник: оповещения. По состоянию на')} {stamp(response.inbox.asOf,locale)}</p>
   {response.capped&&<p role="alert">{response.view==='live'?t('Only the first urgent items are shown. Open My members for the rest.','Ցուցադրված են միայն առաջին շտապ տարրերը։ Մնացածը՝ «Իմ անդամները» բաժնում։','Показаны только первые срочные элементы. Остальные доступны в разделе «Мои участники».'):t('Showing up to 100 alerts. Open the full alerts page for more.','Ցուցադրվում է մինչև 100 ահազանգ։ Մյուսների համար բացեք ահազանգերի ամբողջական էջը։','Показано до 100 оповещений. Остальные доступны на полной странице оповещений.')}</p>}
  </section>;break;
 }
 return <section className="dw-record-card space-y-3 rounded-xl border bg-background p-3" aria-busy={pending} onChangeCapture={trackText}>
  <RecordRefreshProvider value={(preserveState,saved=true)=>void onReload(preserveState,saved&&!preserveState)}>{content}</RecordRefreshProvider>
  {!(response.kind==='ready'&&response.card==='conversation')&&<DoctorCardReload locale={locale} pending={pending} confirmDiscard={()=>hasUnsavedText&&[...textEdits.current].some(([input,original])=>input.value.trim()!==''&&input.value!==original&&input.form?.dataset.saved!=='true')} onReload={()=>onReload()}/>}
 </section>;
}
