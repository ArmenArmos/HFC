'use client';
import {PlanReadyCard,PlanLabFileLinks} from './plan-ready-card';
import {requiredLabValues} from '@/lib/patient-care/required-lab-match';
import type {ClinicalCardCommand} from '@/lib/doctor-decisions/approvals';
import {PlanSparklines} from './patient-graphs';
import {analyteDisplayName} from '@/lib/lab-ai/analyte-names';
import {calendarDate,yerevanStamp} from '@/lib/staff/yerevan-time';
import {ChatMemberIdentity} from '@/components/staff/chat-member-identity';
import {useEffect,useEffectEvent,useId,useRef,useState} from 'react';
import {done,notDone,refreshFailed} from '@/lib/staff-zoe/outcome-copy';
import {DoctorApprovalCards} from '@/components/staff/doctor-workspace/approval-cards';
import {DraftForm,type DraftEditorState} from '@/components/real-review/forms';
import {readDoctorChatPlan,pressDoctorChatPlan,readDoctorChatAiPlan,prepareDoctorChatAiPlan,saveDoctorChatAiPlan,recordDoctorChatAiPlanAdoption,recordDoctorChatPlanResults,type ChatPlanResponse,type ChatAiPlanResponse} from '@/lib/staff-zoe/chat-v2-actions';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {planLanguageWarning,planStaffLanguageLabel,planSummaryWarning} from '@/lib/ai-plan/language';
import {AI_PLAN_LABEL} from '@/lib/ai-plan/contracts';
import {planDisplayText,planSourceLabel} from '@/lib/ai-plan/display';
import {staffServerText} from '@/lib/staff/staff-server-copy';
import type {AlertItem} from '@/lib/doctor-inbox/contracts';
import {staffAlertReason} from '@/lib/staff/alert-label';
import {time} from './messages';
import {withClinicalTimeout,ClinicalActionTimeout} from '@/lib/patient-care/action-timeout';
import {UrgentPublicationBlock} from '@/components/real-review/urgent-publication';
import type {ClinicalFormState} from '@/lib/patient-care/clinical-actions';

export function DoctorChatPlan({memberId,name,aiDraft,doctorId,locale,alerts=[],recent=[],prepareRequest,onOpen,onSaved,onCheckAgain,onAction,onReviewLabs}:{memberId:string;name:string;aiDraft:boolean;doctorId:string;locale:StaffLocale;alerts?:AlertItem[];recent?:{key:string;text:string;at:string}[];prepareRequest?:string;onOpen:(memberId:string,name:string)=>void;onSaved:(decision:string,reply:string)=>void;onCheckAgain:()=>void;onAction:(decision:string)=>void;onReviewLabs?:()=>void}){
 const [data,setData]=useState<ChatPlanResponse|null>(null),[ai,setAi]=useState<ChatAiPlanResponse|null>(null);
 const [used,setUsed]=useState({regimen:false,consultation:false}),[adopted,setAdopted]=useState(false);
 const [consultationChanged,setConsultationChanged]=useState(false);
 const [editorState,setEditorState]=useState<DraftEditorState>({dirty:false,pending:false,blocked:false});
 const draftFormId=useId();
 const [preparedGeneration,setPreparedGeneration]=useState<string>();
 const [preparing,setPreparing]=useState(false),[message,setMessage]=useState<{ok:boolean;message:string;generationId?:string}|null>(null);
 const locked=useRef(false),requested=useRef<string|undefined>(undefined),[readFailed,setReadFailed]=useState(false);
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const draft=ai?.kind==='ai-plan'?ai:null,generation=draft?.generation;
 const labEvidence=draft?.labEvidence;
 const unreviewedLabs=!!labEvidence?.values.some(value=>value.status==='unverified');
 const labsBlockPublish=!!onReviewLabs&&(unreviewedLabs||!!generation&&!labEvidence);
 const resultsBlockPublish=!!draft?.ready&&(!draft.ready.sourcesAvailable||draft.ready.results.some(test=>!test.recorded));
 // The urgent lexicon is unsigned and empty, so only existing care alerts can be shown.
 const openAlerts=alerts.filter(item=>item.memberId===memberId&&item.alert.state!=='resolved');
 const hasRegimen=data?.kind==='plan'&&!!data.approvals.regimen;
 const urgent=!!draft?.urgent||!!(data?.kind==='plan'&&data.approvals.firstNote?.data.urgent)||openAlerts.some(item=>item.alert.priority==='urgent');
 const urgentLine=t('An urgent alert is open, so you cannot prepare a routine care plan. Review the alert and resolve it before preparing a plan.','Բաց շտապ ահազանգ կա, ուստի չեք կարող պատրաստել պլանային խնամքի պլան։ Նախ վերանայեք ահազանգը և լուծեք այն, ապա պատրաստեք պլանը։','Открыто срочное оповещение, поэтому подготовка обычного плана недоступна. Сначала проверьте оповещение и закройте его, затем подготовьте план.');
 const unreadable=t('The prepared draft could not be opened. Try again.','Պատրաստված սևագիրը չհաջողվեց բացել։ Փորձեք կրկին։','Не удалось открыть подготовленный черновик. Попробуйте снова.');
 const evidenceChanged=t('The evidence changed after this draft was prepared. Prepare a new draft before using it.','Այս սևագիրը պատրաստելուց հետո տվյալները փոխվել են։ Այն օգտագործելուց առաջ պատրաստեք նոր սևագիր։','После подготовки этого черновика данные изменились. Подготовьте новый черновик перед использованием.');
 const switchedOff=t('Plan drafts are switched off. Try again when they are available.','Պլանի սևագրերի պատրաստումն անջատված է։ Փորձեք կրկին, երբ այն հասանելի լինի։','Подготовка черновиков плана отключена. Попробуйте снова, когда она станет доступна.');
 async function reload(afterSave=false){
  try{
   const [plan,next]=await withClinicalTimeout(async()=>[await readDoctorChatPlan(memberId,doctorId),await readDoctorChatAiPlan(memberId,doctorId)] as const);
   // Retain the mounted editor on failed refreshes. The previous context cannot save.
   const lostDraft=next.kind==='ai-plan'&&!next.generation&&ai?.kind==='ai-plan'&&!!ai.generation&&!adopted&&!afterSave;
   const aiReadable=next.kind==='ai-plan'||(next.kind==='off'&&plan.kind==='plan'&&!!plan.approvals.regimen);
   setReadFailed(plan.kind!=='plan'||!aiReadable||lostDraft);
   if(plan.kind==='plan')setData(plan);
   if(next.kind==='ai-plan')setAi(editorState.dirty&&!next.generation&&ai?.kind==='ai-plan'&&ai.generation?{...next,generation:ai.generation}:lostDraft&&ai?.kind==='ai-plan'?{...next,generation:ai.generation,stale:true}:next);
   if(next.kind==='ai-plan'&&(next.stale||next.snapshot.draftStale||next.savedDraftCurrent===false||(plan.kind==='plan'&&plan.approvals.regimen?.current===false)))setAdopted(false);
   return plan.kind==='plan'?next:null;
  }catch{setReadFailed(true);return null;}
 }
 useEffect(()=>{
  let active=true;
  void (async()=>{try{const plan=await readDoctorChatPlan(memberId,doctorId);if(!active)return;setData(plan);const draft=await readDoctorChatAiPlan(memberId,doctorId);if(active)setAi(draft);}catch{if(active){setData({kind:'unavailable'});setAi({kind:'unavailable'});}}})();
  return()=>{active=false;};
 },[memberId,doctorId]);
 const stop=notDone('plan-unavailable',locale);
 async function prepare(){
  if(urgent){setMessage({ok:false,message:urgentLine});return;}
  if(locked.current)return;locked.current=true;setPreparing(true);setMessage(null);
  const again=ai?.kind==='ai-plan'&&!!ai.generation;
  try{
   const result=await withClinicalTimeout(()=>prepareDoctorChatAiPlan(memberId,doctorId));
   if(result.ok&&result.generationId)setPreparedGeneration(result.generationId);
   let next=await reload();
   // Preparing has already committed. Retry only opening that generation, never the write.
   if(result.ok&&result.generationId&&(!next||next.kind==='unavailable'||next.kind==='ai-plan'&&!next.stale&&!next.published&&next.generation?.id!==result.generationId))next=await reload();
   const current=next?.kind==='ai-plan'?next:null;
   const shown=!!result.generationId&&current?.generation?.id===result.generationId&&!current.stale&&!current.published;
   if(shown)setAdopted(false);
   setMessage(result.ok?(shown?result:{ok:false,message:current?.stale?evidenceChanged:current?.published?t('A plan is already published. Open the conversation to review the current plan.','Պլանն արդեն հրապարակված է։ Ընթացիկ պլանը վերանայելու համար բացեք զրույցը։','План уже опубликован. Откройте переписку, чтобы проверить действующий план.'):next?.kind==='off'?switchedOff:unreadable}):result);
   onAction(again?t('Prepare again','Պատրաստել կրկին','Подготовить снова'):t('Prepare care plan','Պատրաստել խնամքի պլան','Подготовить план ухода'));
  }
  catch(error){setMessage({ok:false,message:error instanceof ClinicalActionTimeout?staffServerText(locale,error.message):unreadable});if(!(error instanceof ClinicalActionTimeout))await reload();}
  finally{locked.current=false;setPreparing(false);}
 }
 async function saved(result:ClinicalFormState){
  const next=await reload(true);
  if(next?.kind!=='ai-plan'||!next.snapshot.draft||next.snapshot.draftStale||next.savedDraftCurrent===false||next.snapshot.revision!==result.revision)return false;
  setAdopted(true);setConsultationChanged(false);setMessage(null);onAction(t('Use this draft','Օգտագործել այս սևագիրը','Использовать этот черновик'));return true;
 }
 async function readyPress(command:ClinicalCardCommand){
  const result=await pressDoctorChatPlan(command,doctorId);
  if(result.ok){
   if(command.kind==='regimen'){
    setUsed(previous=>({...previous,regimen:true}));
    onSaved(t('Plan approved and published','Պլանը հաստատված և հրապարակված է','План утверждён и опубликован'),done('action',locale,staffServerText(locale,result.message)));
   }else{setConsultationChanged(true);await reload();}
  }
  return result;
 }
 async function recordMatched(notes:Record<string,string>){
  if(!draft?.ready||!draft.ready.sourcesAvailable)throw Error('Case unavailable');
  let current=draft;
  const sources=[...new Map(draft.ready.results.filter(test=>!test.recorded&&test.source).map(test=>[test.source!.attachmentId,test.source!])).values()];
  if(!sources.length)throw Error('No matching reviewed files');
  for(const source of sources){
   const matches=current.ready?.results.filter(test=>!test.recorded&&test.source?.attachmentId===source.attachmentId)??[];
   if(!matches.length)continue;
   // Match only the values selected by the current frozen read. SQL repeats all
   // coverage, doctor review, collection date and current-file checks under lock.
   const values=source.values.filter(value=>matches.some(test=>requiredLabValues(test.id,[value]).length));
   const form=new FormData();
   form.set('id',memberId);form.set('revision',String(current.snapshot.revision));form.set('token',current.snapshot.evidenceToken);
   form.set('operation','receive-all-clinic-results');form.set('attachmentId',source.attachmentId);form.set('sourceChecked','on');form.set('note',notes[source.attachmentId]??'');
   values.forEach(value=>form.append('valueIds',value.id));
   const result=await recordDoctorChatPlanResults(form,doctorId);
   if(!result.ok){setMessage(result);throw Error('Result recording not confirmed');}
   const next=await reload();
   if(next?.kind!=='ai-plan'||!next.ready?.sourcesAvailable||next.stale||next.snapshot.evidenceToken!==draft.snapshot.evidenceToken)throw Error('Case unavailable');
   current=next;
  }
 }
 // Lab review in another mounted chat card invalidates the plan context too.
 const refreshEvidence=useEffectEvent(()=>{setReadFailed(true);void reload();});
 useEffect(()=>{const changed=()=>refreshEvidence();document.addEventListener('noreon:clinical-evidence-changed',changed);return()=>document.removeEventListener('noreon:clinical-evidence-changed',changed);},[]);
 const prepareFromRequest=useEffectEvent(()=>{void prepare();});
 useEffect(()=>{
  if(!prepareRequest||requested.current===prepareRequest||!data||!ai)return;
  let active=true;
  // A typed request starts once the card's reads have settled, with the same handler as its button.
  void Promise.resolve().then(()=>{
   if(!active||requested.current===prepareRequest)return;
   requested.current=prepareRequest;
   if(data.kind==='plan')prepareFromRequest();
  });
  return()=>{active=false;};
 },[prepareRequest,data,ai]);
 if(!data)return <p role="status">{t('Loading…','Բեռնվում է…','Загрузка…')}</p>;
 if(data.kind==='refused')return <><p role="alert">{notDone('read-access',locale)}</p><button type="button" className="dcv2-choice" onClick={onCheckAgain}>{t('Check again','Ստուգել կրկին','Проверить снова')}</button></>;
 if(data.kind!=='plan')return <><p role="alert">{data.kind==='off'?notDone('disabled',locale):stop}</p><button type="button" className="dcv2-choice" onClick={onCheckAgain}>{t('Check again','Ստուգել կրկին','Проверить снова')}</button></>;
 const canPrepare=!!draft&&!draft.published&&(!hasRegimen||!!generation)&&!adopted&&!urgent;
 const shownSuccess=message?.ok&&!!generation&&!draft?.stale&&!draft?.published&&!adopted&&!readFailed&&message.generationId===generation.id;
 const showPreparedDraft=!!generation&&!!draft&&!draft.published&&(!adopted||!!draft.ready);
 const showSavedDraft=!!data.approvals.regimen&&!!draft&&!generation&&(!data.approvals.regimen.current||draft.savedDraftCurrent===false||consultationChanged||!!draft.ready)&&(!adopted||!!draft.ready);
 return <section className="dcv2-plan" data-plan-member={memberId}>
  <ChatMemberIdentity memberId={memberId} name={name} locale={locale}/>
  {draft?.ready&&!draft.published&&!used.regimen&&(generation||hasRegimen)&&<PlanReadyCard key={`${memberId}:${draft.snapshot.evidenceToken}`} draft={draft} approvals={data.approvals} locale={locale} urgent={urgent} urgentReason={urgentLine} unavailable={readFailed||preparing} editor={editorState} formId={draftFormId} onReviewLabs={onReviewLabs} onDetails={()=>document.getElementById(`${draftFormId}-details`)?.scrollIntoView({block:'start'})} onRecord={recordMatched} onPress={readyPress} onRefresh={async()=>{if(!await reload())throw Error('Case unavailable');}}/>}
  <div id={`${draftFormId}-details`}/>

  {!readFailed&&<p role="status">{done('plan-opened',locale)}</p>}
  {draft?.trends&&!readFailed&&!draft.stale&&<PlanSparklines data={draft.trends} locale={locale}/>}
  {onReviewLabs&&draft&&<section className="dcv2-plan-labs" aria-label={t('Labs read for this draft','Այս սևագրի համար կարդացված լաբորատոր արժեքները','Анализы, прочитанные для этого черновика')}>
   {draft.stale&&<p role="alert">{evidenceChanged}</p>}
   {unreviewedLabs&&<><p>{t('Some lab values read for this draft are not reviewed.','Այս սևագրի համար կարդացված որոշ լաբորատոր արժեքներ վերանայված չեն։','Некоторые лабораторные показатели для этого черновика ещё не проверены.')}</p><PlanLabFileLinks files={draft.ready?.labFiles?.filter(file=>file.needsReview)??[]} memberId={memberId} locale={locale}/><button type="button" className="dcv2-choice" onClick={onReviewLabs}>{t('Review these values','Վերանայել այս արժեքները','Проверить эти значения')}</button></>}
   {labEvidence&&<><h3>{t('Labs read for this draft','Այս սևագրի համար կարդացված լաբորատոր արժեքները','Анализы, прочитанные для этого черновика')}</h3>
    {!labEvidence.values.length&&<p>{t('No lab values were read for this draft.','Այս սևագրի համար լաբորատոր արժեքներ չեն կարդացվել։','Для этого черновика лабораторные показатели не читались.')}</p>}
    <ul>{labEvidence.values.map(value=><li key={value.valueId}>{analyteDisplayName(value.testName,locale,value.catalogueRef)}: {value.value??t('Value not available','Արժեքը հասանելի չէ','Значение недоступно')} {value.unit} · {value.collectedOn?calendarDate(value.collectedOn,locale):value.status==='member-reported'&&value.reportedAt?`${t('Reported on','Հաղորդվել է','Сообщено')} ${yerevanStamp(value.reportedAt,locale)}`:t('Date not recorded','Ամսաթիվը գրանցված չէ','Дата не указана')} · {value.status==='member-reported'?t('Member-reported','Անդամի հաղորդած','Со слов участника'):value.status==='auto_accepted'?t('Confirmed by the rules','Հաստատված է կանոններով','Подтверждено правилами'):value.status==='verified'||value.status==='corrected'?t('Reviewed','Վերանայված','Проверено'):t('Not reviewed','Չվերանայված','Не проверено')}</li>)}</ul>
   </>}
  </section>}
  {(openAlerts.length>0||recent.length>0)&&<section className="dcv2-answer-first">
   <h3>{t('Answer these first','Նախ պատասխանեք սրանց','Сначала ответьте на это')}</h3>
   <ul>{openAlerts.map(item=><li key={item.alert.id}>
    <p>{staffAlertReason(item.alert,locale)}</p>
    <time className="dcv2-time" dateTime={item.at}>{time(item.at,locale)}</time>
   </li>)}</ul>
   {recent.length>0&&<>
    <p className="dcv2-time">{t('The member wrote, last 48 hours','Անդամը գրել է վերջին 48 ժամվա ընթացքում','Участник написал за последние 48 часов')}</p>
    <ul>{recent.map(entry=><li key={entry.key}>
     <p>{entry.text.length>240?`${entry.text.slice(0,240)}…`:entry.text}</p>
     <time className="dcv2-time" dateTime={entry.at}>{time(entry.at,locale)}</time>
    </li>)}</ul>
   </>}
   <button type="button" className="dcv2-choice" onClick={()=>onOpen(memberId,name)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>{t('Open conversation','Բացել զրույցը','Открыть переписку')}</button>
  </section>}
  {readFailed&&<><p role="alert">{refreshFailed(locale)}</p><button type="button" className="dcv2-choice" onClick={()=>void reload().then(()=>onAction(t('Check again','Ստուգել կրկին','Проверить снова')))}>{t('Check again','Ստուգել կրկին','Проверить снова')}</button></>}
  {!ai&&<p role="status">{t('Loading…','Բեռնվում է…','Загрузка…')}</p>}
  {!urgent&&!readFailed&&ai&&ai.kind!=='ai-plan'&&!hasRegimen&&<p role="alert">{stop}</p>}
  {urgent&&<><p role="alert">{urgentLine}</p>{!hasRegimen&&<UrgentPublicationBlock memberId={memberId} locale={locale}/>}</>}
  {!hasRegimen&&!adopted&&<p>{draft&&!draft.published&&!draft.snapshot.draft&&!generation&&!urgent?t(`No plan is published for ${name} yet. You can prepare one below.`,`${name}-ի համար պլան դեռ հրապարակված չէ։ Կարող եք այն պատրաստել ստորև։`,`Для ${name} пока нет опубликованного плана. Вы можете подготовить его ниже.`):aiDraft&&generation?t(`Zoe prepared a plan draft for ${name}. It has not been saved as a plan yet.`,`Զոյան ${name}-ի համար պատրաստել է պլանի նախագիծ։ Այն դեռ չի պահպանվել որպես պլան։`,`Зоя подготовила черновик плана для ${name}. Он ещё не сохранён как план.`):t(`No saved plan is waiting for approval for ${name}.`,`${name}-ի համար հաստատման սպասող պահպանված պլան չկա։`,`Для ${name} нет сохранённого плана, ожидающего утверждения.`)}</p>}
  {showPreparedDraft&&generation&&draft&&<>
   <section className="dcv2-ai-plan">
    <h3>{t(AI_PLAN_LABEL.en,AI_PLAN_LABEL.hy,AI_PLAN_LABEL.ru)}</h3>
    {planLanguageWarning(generation.guard??[],locale)&&<p role="alert">{planLanguageWarning(generation.guard??[],locale)}</p>}
    {draft.stale&&!readFailed&&!onReviewLabs&&<p role="alert">{evidenceChanged}</p>}
    {generation.summary&&<>{planSummaryWarning(generation.guard??[],locale)&&<p role="alert">{planSummaryWarning(generation.guard??[],locale)}</p>}<p>{planDisplayText(generation.summary,locale)}</p></>}
    <ul>{generation.items.map(item=><li key={item.id}>
     {planStaffLanguageLabel(locale)&&<p className="text-caption text-muted-foreground">{planStaffLanguageLabel(locale)}</p>}
     {item.section==='medication_consideration'&&<h4>{t('For your consideration, not prescribed','Ձեր դիտարկման համար, նշանակված չէ','Для вашего рассмотрения, не назначено')}</h4>}
     <p>{planDisplayText(item.text,locale)}</p>{item.status==='needs_doctor_judgement'&&<p className="dcv2-tag">{t('Needs your judgement','Պահանջում է ձեր դատողությունը','Требует вашего решения')}</p>}
     {item.timing&&<p>{t('When:','Երբ՝','Когда:')} {planDisplayText(item.timing,locale)}</p>}
     <p>{t('Why:','Ինչու՝','Почему:')} {planDisplayText(item.rationale,locale)} {t('Source:','Աղբյուր՝','Источник:')} {planSourceLabel(item.source,locale)}.</p>
    </li>)}</ul>
   </section>
  </>}
  {draft&&(showPreparedDraft||showSavedDraft)&&<DraftForm key={memberId} snapshot={draft.snapshot} ai={generation?{generationId:generation.id,values:generation.draft}:null} locale={locale} regimen chat={{onState:setEditorState,formId:draftFormId,resave:!generation||hasRegimen,prefill:!!generation&&preparedGeneration===generation.id,preaccepted:!!draft.ready,disabled:(!!generation&&draft.stale)||preparing||readFailed,
    save:(previous,form)=>saveDoctorChatAiPlan(previous,form,doctorId),adopt:(id,fields)=>recordDoctorChatAiPlanAdoption(id,fields,doctorId),refresh:async()=>{if(!await reload())throw Error('Case unavailable');},onSaved:saved}}/>}
  {showPreparedDraft&&<p>{t('Use this draft to save it privately, then review and publish it below. Nothing is published until you approve it.','Օգտագործեք այս սևագիրը՝ այն գաղտնի պահպանելու համար, ապա ստորև վերանայեք և հրապարակեք այն։ Ոչինչ չի հրապարակվում, մինչև դուք չհաստատեք։','Сохраните этот черновик, затем проверьте и опубликуйте его ниже. Публикация произойдёт только после вашего утверждения.')}</p>}
  {canPrepare&&<button type="button" className="dcv2-choice" disabled={preparing} aria-busy={preparing} onClick={()=>void prepare()}>{preparing?t('Preparing draft…','Սևագիրը պատրաստվում է…','Подготавливается черновик…'):generation?t('Prepare again','Պատրաստել կրկին','Подготовить снова'):t('Prepare care plan','Պատրաստել խնամքի պլան','Подготовить план ухода')}</button>}
  {message?.message&&message.message!==urgentLine&&<p role={shownSuccess?'status':'alert'}>{shownSuccess?done('draft',locale,staffServerText(locale,message.message)):notDone('action',locale,staffServerText(locale,message.ok?unreadable:message.message))}</p>}
  {message&&message.message!==urgentLine&&!shownSuccess&&message.message&&<button type="button" className="dcv2-choice" disabled={preparing} onClick={()=>{if(urgent||adopted||draft?.published)void reload();else void prepare();}}>{t('Try again','Փորձել կրկին','Попробовать снова')}</button>}
  {adopted&&<p role="status">{done('plan-draft-saved',locale)}</p>}
  {!urgent&&!readFailed&&!hasRegimen&&(adopted||draft?.published)&&<p role="alert">{stop}</p>}
  {hasRegimen&&!readFailed&&<DoctorApprovalCards urgent={urgent} data={{firstNote:null,regimen:used.regimen?null:data.approvals.regimen?{...data.approvals.regimen,current:data.approvals.regimen.current&&!draft?.stale&&draft?.savedDraftCurrent!==false}:null,consultation:used.consultation?null:data.approvals.consultation}} locale={locale}
   chat={{publicationBlocked:labsBlockPublish||resultsBlockPublish||editorState.dirty||editorState.pending||editorState.blocked,draftFormId:draft?draftFormId:undefined,consultationChanged,press:command=>pressDoctorChatPlan(command,doctorId),onCheckAgain,onSuccess:(command,result)=>{
    setUsed(previous=>({...previous,[command.kind==='regimen'?'regimen':'consultation']:true}));
    const decision=command.kind==='regimen'?t('Plan approved and published','Պլանը հաստատված և հրապարակված է','План утверждён и опубликован')
     :command.kind==='complete-consultation'?t('Consultation completed','Խորհրդատվությունն ավարտված է','Консультация завершена')
     :command.decision==='required'?t('Consultation required','Խորհրդատվություն պահանջվում է','Нужна консультация')
     :t('Consultation not required','Խորհրդատվություն չի պահանջվում','Консультация не нужна');
    onSaved(decision,done('action',locale,staffServerText(locale,result.message)));
    if(command.kind!=='regimen'){setConsultationChanged(true);void reload();}
   }}}/>}
 </section>;
}
