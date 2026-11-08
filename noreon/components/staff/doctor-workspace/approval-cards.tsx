'use client';
import {safeConsultationProposal} from '@/lib/patient-care/consultation-proposal';
import {useConsultationDecision} from '@/components/real-review/use-consultation-decision';
import {done,notDone} from '@/lib/staff-zoe/outcome-copy';
import {firstPublicationGate,consultationPublicationGate} from '@/lib/doctor-decisions/publication-gate';
import {stamp} from '@/components/patient-care/common';
import {useRef,useState,useTransition,type RefObject} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import type {Route} from 'next';
import type {Locale} from '@/lib/locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {staffServerText} from '@/lib/staff/staff-server-copy';
import {approveFirstNote} from '@/lib/first-note/actions';
import {FIRST_NOTE_BUILDER,FIRST_NOTE_VERSION} from '@/lib/first-note/compose';
import {pressClinicalCard} from '@/lib/doctor-decisions/approval-actions';
import type {ApprovalCards,ApprovalContext,FirstNoteReviewCard,RegimenReviewCard,ConsultationReviewCard,ClinicalCardCommand} from '@/lib/doctor-decisions/approvals';
import type {ClinicalFormState} from '@/lib/patient-care/clinical-actions';
import {regimenNameKey} from '@/lib/service-workflow/publication';
import {RegimenChanges,RegimenList} from '@/components/patient-care/regimen-changes';
import {ClinicalSummary} from '@/components/real-review/clinical-summary';
import {UrgentPublicationBlock} from '@/components/real-review/urgent-publication';
import {withClinicalTimeout,ClinicalActionTimeout} from '@/lib/patient-care/action-timeout';
import {checkRealClinicalCaseAvailability} from '@/lib/patient-care/clinical-review-actions';

const box='sz-record space-y-3 rounded-xl border bg-background p-4';
const button='min-h-12 rounded-md bg-primary px-4 py-2 text-body2 font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50';
const field='mt-1 block min-h-11 w-full rounded-md border bg-background p-3 text-body2';
type ChatApproval={press:(command:ClinicalCardCommand)=>Promise<ClinicalFormState>;onSuccess:(command:ClinicalCardCommand,result:ClinicalFormState)=>void;onCheckAgain:()=>void;draftFormId?:string;consultationChanged?:boolean;publicationBlocked?:boolean};
function RecordContext({context,locale,chat}:{context:ApprovalContext;locale:Locale;chat?:ChatApproval}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return chat?null:<p className="break-words text-caption text-muted-foreground"><Link href={`/staff/real/members/${context.memberId}` as Route} className="inline-flex min-h-11 items-center underline">{t('Review the source record','Վերանայել սկզբնաղբյուր գրառումը','Проверить исходную запись')}</Link></p>;
}
function FirstNoteCard({card,locale}:{card:FirstNoteReviewCard;locale:Locale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const [en,setEn]=useState(card.draft?.text.en??''),[hy,setHy]=useState(card.draft?.text.hy??'');
 const [status,setStatus]=useState<string|null>(null),[pending,start]=useTransition();const pressed=useRef(false);
 const {data,draft}=card;
 const ready=!!draft&&!data.note&&!data.planActive&&!data.urgent&&!!data.completedAt;
 const success=status==='approved';
 const outcome=success?t('Approved. The member gets this note in their chat.','Հաստատված է։ Անդամն այս գրառումը ստանում է իր զրույցում։','Утверждено. Участник получает это сообщение в своём чате.'):
  status==='access'?t('Only the assigned doctor can approve this note.','Միայն կցված բժիշկը կարող է հաստատել այս գրառումը։','Только назначенный врач может утвердить это сообщение.'):
  status==='disabled'?t('First-note approval is switched off.','Առաջին գրառման հաստատումն անջատված է։','Утверждение первого сообщения отключено.'):
  status==='outcome-unknown'?t('The outcome is unknown. Reload and check the saved note before trying again.','Արդյունքն անհայտ է։ Կրկին փորձելուց առաջ թարմացրեք և ստուգեք պահպանված գրառումը։','Результат неизвестен. Обновите и проверьте сохранённое сообщение перед повтором.'):
  t('This note could not be approved. Reload and review the current record.','Այս գրառումը չհաջողվեց հաստատել։ Թարմացրեք և վերանայեք ընթացիկ գրառումը։','Не удалось утвердить сообщение. Обновите и проверьте текущую запись.');
 return <form data-decision="first-note" className={box} aria-busy={pending} onSubmit={e=>{
  e.preventDefault();if(pressed.current||!ready||!en.trim()||!hy.trim())return;pressed.current=true;
  const note={version:FIRST_NOTE_VERSION,memberId:card.context.memberId,submissionId:card.submissionId,textEn:en,textHy:hy,
   builderVersion:FIRST_NOTE_BUILDER,sources:draft!.sources,edited:en!==draft!.text.en||hy!==draft!.text.hy,assessmentRevision:card.assessmentRevision};
  start(async()=>{try{setStatus((await approveFirstNote(note,card.context)).status);}catch{setStatus('outcome-unknown');}});
 }}>
  <h3 className="text-h3">{t('First note to the member','Առաջին գրառումն անդամին','Первое сообщение участнику')}</h3>
  <RecordContext context={card.context} locale={locale}/>
  {data.note?<><p className="text-body2">{t('Already approved','Արդեն հաստատված է','Уже утверждено')} · {stamp(data.note.approvedAt,locale)}</p><p lang="hy" className="whitespace-pre-wrap break-words text-body2">{data.note.textHy}</p><p lang="en" className="whitespace-pre-wrap break-words text-body2">{data.note.textEn}</p></>:ready?<>
   <p className="text-body2">{t('Review both languages. Your press approves this exact note for the chat with the member until a care plan is published.','Վերանայեք երկու լեզուները։ Ձեր սեղմումը հաստատում է հենց այս գրառումը՝ անդամի զրույցի համար, մինչև խնամքի պլանի հրապարակումը։','Проверьте оба языка. Нажатие утверждает именно этот текст для чата участника до публикации плана.')}</p>
   {data.dueAt&&<p className="text-caption">{t('Approve by','Հաստատել մինչև','Утвердить до')}: {stamp(data.dueAt,locale)}</p>}
   <label className="block text-body2">{t('Armenian','Հայերեն','Армянский')}<textarea lang="hy" className={field} rows={6} maxLength={2000} value={hy} onChange={e=>setHy(e.target.value)} disabled={pending||status!==null}/></label>
   <label className="block text-body2">{t('English','Անգլերեն','Английский')}<textarea lang="en" className={field} rows={6} maxLength={1500} value={en} onChange={e=>setEn(e.target.value)} disabled={pending||status!==null}/></label>
   <button className={button} disabled={pending||status!==null||!en.trim()||!hy.trim()}>{t('Approve and show this note','Հաստատել և ցույց տալ այս գրառումը','Утвердить и показать это сообщение')}</button>
  </>:<p role="status" className="text-body2">{t('No first note is ready for approval. Check the questionnaire, urgent guidance and active plan on the source page.','Առաջին գրառումը հաստատման պատրաստ չէ։ Սկզբնաղբյուր էջում ստուգեք հարցաշարը, շտապ ուղեցույցը և գործող պլանը։','Первое сообщение не готово к утверждению. Проверьте анкету, срочные рекомендации и действующий план в исходной записи.')}</p>}
  {status&&<p role={success?'status':'alert'} className="text-body2">{outcome}</p>}
 </form>;
}

/** Each form stays frozen after a press, including uncertain outcomes; refresh is always explicit. */
function useClinicalPress(chat?:ChatApproval){
 const [result,setResult]=useState<ClinicalFormState|null>(null),[pending,start]=useTransition();const pressed=useRef(false);
 const press=(command:ClinicalCardCommand)=>{if(pressed.current)return;pressed.current=true;start(async()=>{
  try{const outcome=await withClinicalTimeout(()=>(chat?.press??pressClinicalCard)(command));setResult(outcome);if(outcome.ok)chat?.onSuccess(command,outcome);}catch(error){setResult({ok:false,uncertain:!(error instanceof ClinicalActionTimeout),message:error instanceof ClinicalActionTimeout?error.message:''});}finally{pressed.current=false;}
 });};
 return {result,pending,press,frozen:pending||result!==null};
}
function ClinicalFeedback({result,locale,chat}:{result:ClinicalFormState|null;locale:Locale;chat?:ChatApproval}){
 if(!result)return null;
 const text=result.uncertain?st(locale,'The outcome is unknown. Reload and check the record before trying again.','Արդյունքն անհայտ է։ Կրկին փորձելուց առաջ թարմացրեք և ստուգեք գրառումը։','Результат неизвестен. Обновите и проверьте запись перед повтором.'):result.message==='This action is switched off.'?st(locale,'This action is switched off.','Այս գործողությունն անջատված է։','Это действие отключено.'):staffServerText(locale,result.message);
 return <p className="text-body2" role={result.ok?'status':'alert'}>{chat?(result.ok?done('action',locale,text):notDone('action',locale,text)):text}</p>;
}
function RegimenCard({card,locale,chat,urgent=false,onConsultation}:{card:RegimenReviewCard;locale:Locale;chat?:ChatApproval;urgent?:boolean;onConsultation?:()=>void}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const {result,pending,press,frozen}=useClinicalPress(chat);
 const [approved,setApproved]=useState(false),[summary,setSummary]=useState('');
 const {review,draft}=card,saved=review.draft!;
 const approvedRef=useRef<HTMLInputElement>(null),summaryRef=useRef<HTMLTextAreaElement>(null);
 // A frozen null gate has checked report details that are not sent to this card.
 const gate=!card.current?firstPublicationGate(card.clinicalReview,false):card.publicationGate!==undefined?card.publicationGate:firstPublicationGate(card.clinicalReview,true);
 const stale=gate?.kind==='stale';
 const source=`/staff/real/members/${card.context.memberId}`;
 const gateText=gate?.kind==='lab'?t(`Needs ${gate.title} result: review lab file`,`${gate.title} հետազոտության արդյունքն անհրաժեշտ է․ վերանայեք լաբորատոր ֆայլը`,`Нужен результат ${gate.title}: проверьте файл анализов`)
  :gate?.kind==='source'?t('Review and approve the lab file','Վերանայեք և հաստատեք լաբորատոր ֆայլը','Проверьте и утвердите файл анализов')
  :gate?.kind==='evidence'?t(`Confirm ${gate.title} on the Evidence tab`, `Հաստատեք ${gate.title} հետազոտությունը «Տվյալներ» ներդիրում`,`Подтвердите ${gate.title} на вкладке «Данные»`)
  :gate?.kind==='unsupported'?t(`${gate.title} cannot be confirmed in Noreon yet. Review the evidence pathway`,`${gate.title} հետազոտությունը դեռ հնարավոր չէ հաստատել Noreon-ում։ Վերանայեք տվյալների գրանցման ուղին`,`${gate.title} пока нельзя подтвердить в Noreon. Проверьте способ регистрации данных`)
  :gate?.kind==='abnormal-consultation'?t('An abnormal investigation needs a completed consultation first','Հետազոտության շեղված արդյունքի դեպքում նախ անհրաժեշտ է ավարտված խորհրդատվություն','При отклонении в исследовании сначала нужна завершённая консультация')
  :gate?.kind==='consultation'?t('Record whether a consultation is needed','Գրանցեք՝ արդյոք խորհրդատվություն անհրաժեշտ է','Укажите, нужна ли консультация')
  :gate?.kind==='completion'?t('Record the completed consultation','Գրանցեք կայացած խորհրդատվությունը','Запишите состоявшуюся консультацию'):'';
 const consultationGate=gate?.kind==='consultation'||gate?.kind==='completion'||gate?.kind==='abnormal-consultation';
 const gateHref=gate?.reportId?`${source}/reports/${gate.reportId}`:consultationGate?`${source}#treatment`:`${source}#uploaded-reports`;
 const consultationChanged=chat?.consultationChanged||card.staleReason==='consultation';
 const previous=review.versions.find(v=>v.current),comparison=review.versions[0];
 const keys=(kind:'started'|'stopped'|'changed')=>new Set(saved.changes.filter(c=>kind==='changed'?c.kind!=='started'&&c.kind!=='stopped':c.kind===kind).map(c=>regimenNameKey(c.name)));
 const added=keys('started'),changed=keys('changed'),stopped=keys('stopped');
 const groups=[
  {kind:'new',title:t('New medicines','Նոր դեղեր','Новые лекарства'),medicines:saved.medicines.filter(m=>added.has(regimenNameKey(m.name)))},
  {kind:'changed',title:t('Changed medicines','Փոփոխված դեղեր','Изменённые лекарства'),medicines:saved.medicines.filter(m=>changed.has(regimenNameKey(m.name)))},
  {kind:'unchanged',title:t('Unchanged medicines','Անփոփոխ դեղեր','Лекарства без изменений'),medicines:saved.medicines.filter(m=>!added.has(regimenNameKey(m.name))&&!changed.has(regimenNameKey(m.name)))},
  {kind:'stopped',title:t('Stopped medicines','Դադարեցված դեղեր','Отменённые лекарства'),medicines:(comparison?.medicines??[]).filter(m=>stopped.has(regimenNameKey(m.name)))},
 ];
 return <section data-decision="regimen" className={box} aria-busy={pending}>
  <h3 className="text-h3">{t('Review the saved care plan','Վերանայել պահպանված խնամքի պլանը','Проверить сохранённый план лечения')}</h3>
  {stale&&!urgent&&<div role="alert" className="space-y-3 rounded-lg border bg-muted p-4">
   <p>{consultationChanged?t('The draft is out of date because the consultation decision changed.','Սևագիրը հնացել է, քանի որ խորհրդատվության որոշումը փոխվել է։','Черновик устарел, потому что решение о консультации изменилось.'):t('The draft is out of date. Refresh it against the current clinical recommendations.','Սևագիրը հնացել է։ Թարմացրեք այն՝ ըստ ընթացիկ կլինիկական առաջարկությունների։','Черновик устарел. Обновите его с учётом актуальных клинических рекомендаций.')}</p>
   {chat?.draftFormId?<button type="submit" form={chat.draftFormId} className={button}>{t('Refresh draft','Թարմացնել սևագիրը','Обновить черновик')}</button>:<Link className="inline-flex min-h-11 items-center underline" href={`${source}#treatment` as Route}>{t('Refresh draft','Թարմացնել սևագիրը','Обновить черновик')}</Link>}
  </div>}
  {urgent&&<UrgentPublicationBlock memberId={card.context.memberId} locale={locale}/>}
  {!urgent&&!stale&&gate&&<div role="status">{consultationGate&&onConsultation?<button type="button" className="min-h-11 text-left underline" onClick={onConsultation}>{gateText}</button>:<Link className="inline-flex min-h-11 items-center underline" href={gateHref as Route}>{gateText}</Link>}</div>}
  <RecordContext context={card.context} locale={locale} chat={chat}/>
  {card.clinicalReview&&<ClinicalSummary review={card.clinicalReview} locale={locale}/>}
  <p className="whitespace-pre-wrap break-words text-body2">{draft.explanation}</p>
  <p className="whitespace-pre-wrap break-words text-body2">{draft.instructions}</p>
  {draft.followUp&&<p className="whitespace-pre-wrap break-words text-body2">{draft.followUp}</p>}
  <h4 className="text-body1 font-semibold">{t('Exact plan being replaced','Փոխարինվող ճշգրիտ պլանը','Какой именно план заменяется')}</h4>
  {previous?<div className="space-y-2"><p className="break-all text-caption">{stamp(previous.publishedAt,locale)}</p><RegimenList medicines={previous.medicines}/></div>:<p className="text-body2">{t('There is no active published plan to replace.','Փոխարինման ենթակա գործող հրապարակված պլան չկա։','Нет действующего опубликованного плана для замены.')}</p>}
  {comparison&&<p className="text-caption">{t('Medicine changes compared with the plan published on','Դեղերի փոփոխությունները՝ համեմատած հրապարակված պլանի հետ՝','Изменения лекарств по сравнению с планом от')} {stamp(comparison.publishedAt,locale)}</p>}
  {groups.map(group=><div key={group.kind} data-regimen={group.kind} className="space-y-1"><h4 className="text-body2 font-semibold">{group.title}</h4>{group.medicines.length?<RegimenList medicines={group.medicines}/>:<p className="text-caption text-muted-foreground">{t('None','Չկա','Нет')}</p>}</div>)}
  {!!saved.changes.length&&<RegimenChanges changes={saved.changes} locale={locale}/>}
  <label className="block text-body2">{t('What changed (shown to the member)','Ինչ է փոխվել (ցուցադրվում է անդամին)','Что изменилось (показывается участнику)')}<textarea ref={summaryRef} className={field} maxLength={1000} rows={3} value={summary} onChange={e=>setSummary(e.target.value)} disabled={frozen}/></label>
  <label className="flex min-h-11 items-start gap-3 text-body2"><input ref={approvedRef} type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)} disabled={frozen}/>{t('I reviewed this saved plan, every medicine and dose, and the exact version it replaces.','Վերանայել եմ այս պահպանված պլանը, յուրաքանչյուր դեղն ու դեղաչափը և դրա փոխարինած ճշգրիտ տարբերակը։','Я проверил(а) сохранённый план, каждое лекарство и дозу, а также точную заменяемую версию.')}</label>
  {!urgent&&!gate&&!approved&&<button type="button" className="min-h-11 text-left underline" onClick={()=>approvedRef.current?.focus()}>{t('Review the medicines and doses, then tick the confirmation','Վերանայեք դեղերն ու դեղաչափերը, ապա նշեք հաստատման վանդակը','Проверьте лекарства и дозы, затем отметьте подтверждение')}</button>}
  {!urgent&&!gate&&approved&&!!comparison&&!summary.trim()&&<button type="button" className="min-h-11 text-left underline" onClick={()=>summaryRef.current?.focus()}>{t('Describe what changed for the member','Նկարագրեք՝ ինչ է փոխվել անդամի համար','Опишите для участника, что изменилось')}</button>}
  <button type="button" className={button} disabled={pending||frozen||!!gate||!card.current||chat?.publicationBlocked||urgent||!approved||!!comparison&&!summary.trim()} onClick={()=>{if(approved&&!frozen&&!gate&&card.current&&!chat?.publicationBlocked&&!urgent)press({kind:'regimen',context:card.context,requestId:card.requestId,regimenHash:saved.approvalHash,approved:true,changeSummary:summary});}}>{t('Approve and publish this plan','Հաստատել և հրապարակել այս պլանը','Утвердить и опубликовать этот план')}</button>
  {!urgent&&result?.message==="Can't publish while urgent alerts are open. Resolve them first."&&<UrgentPublicationBlock memberId={card.context.memberId} locale={locale}/>}
  {result?.message!=="Can't publish while urgent alerts are open. Resolve them first."&&<ClinicalFeedback result={result} locale={locale} chat={chat}/>}
 </section>;
}
function ConsultationCard({card,locale,chat,focusRef,urgent=false}:{card:ConsultationReviewCard;locale:Locale;chat?:ChatApproval;focusRef?:RefObject<HTMLElement|null>;urgent?:boolean}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const {result,pending,press,frozen}=useClinicalPress(chat);
 const proposal=safeConsultationProposal(card.review,card.proposal,card.context.evidenceToken===card.review.evidenceToken,urgent);
 const {decision,reason:decisionNote,proposed,changeDecision,changeReason}=useConsultationDecision(`${card.context.memberId}:${card.context.evidenceToken}`,proposal);
 const [completionNote,setCompletionNote]=useState(''),[mode,setMode]=useState('phone'),[when,setWhen]=useState('');
 const c=card.review.consultation,complete=c.decision==='required'&&!!consultationPublicationGate(card.review);
 return <section ref={focusRef} data-decision="consultation" className={box} aria-busy={pending}>
  <h3 className="text-h3">{t('Consultation review','Խորհրդատվության վերանայում','Проверка консультации')}</h3>
  <RecordContext context={card.context} locale={locale} chat={chat}/>
  <p className="text-body2">{t('Review prepared','Վերանայումը պատրաստվել է','Проверка подготовлена')}: {stamp(card.review.preparedAt,locale)}</p>
  <p className="text-body2">{c.decision==='required'?t('Consultation required','Խորհրդատվություն պահանջվում է','Нужна консультация'):c.decision==='not-required'?t('Consultation not required','Խորհրդատվություն չի պահանջվում','Консультация не нужна'):t('Not decided yet','Դեռ որոշված չէ','Решение ещё не принято')}{c.completedAt?` · ${stamp(c.completedAt,locale)}`:''}</p>
  {c.note&&<p className="whitespace-pre-wrap break-words text-body2">{c.note}</p>}
  {c.completionNote&&<p className="whitespace-pre-wrap break-words text-body2">{c.completionNote}</p>}
  <p className="text-caption">{t('Review the source evidence before saving your decision or recording completion.','Որոշումը պահպանելուց կամ ավարտը գրանցելուց առաջ վերանայեք սկզբնաղբյուր տվյալները։','Проверьте исходные данные перед сохранением решения или записью завершения.')}</p>
  <form className="space-y-3" onSubmit={e=>{e.preventDefault();if(decision&&decisionNote.trim()&&!frozen)press({kind:'consultation-decision',context:card.context,decision:decision as 'required'|'not-required',note:decisionNote});}}>
   {proposed&&<p className="text-body2 text-muted-foreground">{t("Zoe's proposal",'Զոյայի առաջարկը','Предложение Zoe')}</p>}
   <label className="block text-body2">{t('Decision','Որոշում','Решение')}<select className={field} required value={decision} onChange={e=>changeDecision(e.target.value)} disabled={frozen}><option value="">{t('Choose a decision','Ընտրեք որոշումը','Выберите решение')}</option><option value="required">{t('Required','Պահանջվում է','Нужна')}</option><option value="not-required">{t('Not required','Չի պահանջվում','Не нужна')}</option></select></label>
   <label className="block text-body2">{t('Private clinical reason','Գաղտնի կլինիկական պատճառ','Внутренняя клиническая причина')}<textarea className={field} required maxLength={2000} value={decisionNote} onChange={e=>changeReason(e.target.value)} disabled={frozen}/></label>
   <button className={button} disabled={frozen||!decision||!decisionNote.trim()}>{t('Save consultation decision','Պահպանել խորհրդատվության որոշումը','Сохранить решение о консультации')}</button>
  </form>
  {complete&&<form className="space-y-3" onSubmit={e=>{e.preventDefault();if(!frozen)press({kind:'complete-consultation',context:card.context,completedAtLocal:when,mode:mode as 'phone'|'video'|'in-person',note:completionNote});}}>
   <p className="text-body2">{t('Record a consultation that already took place after this review was prepared.','Գրանցեք խորհրդատվություն, որն արդեն տեղի է ունեցել այս վերանայման պատրաստումից հետո։','Запишите консультацию, которая уже состоялась после подготовки этой проверки.')}</p>
   <label className="block text-body2">{t('When it took place (Yerevan time)','Երբ է այն տեղի ունեցել (Երևանի ժամանակով)','Когда она состоялась (время Еревана)')}<input type="datetime-local" className={field} required value={when} onChange={e=>setWhen(e.target.value)} disabled={frozen}/></label>
   <label className="block text-body2">{t('How it took place','Ինչպես է տեղի ունեցել','Как она состоялась')}<select className={field} value={mode} onChange={e=>setMode(e.target.value)} disabled={frozen}><option value="phone">{t('Phone','Հեռախոս','Телефон')}</option><option value="video">{t('Video','Տեսազանգ','Видео')}</option><option value="in-person">{t('In person','Անձամբ','Лично')}</option></select></label>
   <label className="block text-body2">{t('Completion notes','Ավարտի նշումներ','Заметки по завершению')}<textarea className={field} required maxLength={2000} value={completionNote} onChange={e=>setCompletionNote(e.target.value)} disabled={frozen}/></label>
   <button className={button} disabled={frozen||!when||!completionNote.trim()}>{t('Record completed consultation','Գրանցել ավարտված խորհրդատվությունը','Записать завершённую консультацию')}</button>
  </form>}
  <ClinicalFeedback result={result} locale={locale} chat={chat}/>
 </section>;
}
export function DoctorApprovalCards({data,locale,onReload,chat,urgent=false}:{data:ApprovalCards|null;locale:Locale;onReload?:()=>void;chat?:ChatApproval;urgent?:boolean}){
 const router=useRouter(),t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const consultationRef=useRef<HTMLElement>(null);
 const focusConsultation=()=>{consultationRef.current?.scrollIntoView({block:'center'});consultationRef.current?.querySelector<HTMLSelectElement|HTMLInputElement>('select,input')?.focus();};
 const [reloadVersion,setReloadVersion]=useState(0),[reloading,setReloading]=useState(false),[reloadError,setReloadError]=useState('');
 async function reloadCards(){
  const id=data?.regimen?.context.memberId??data?.consultation?.context.memberId??data?.firstNote?.context.memberId;
  if(!id||reloading)return;
  setReloading(true);setReloadError('');
  try{
   const result=await withClinicalTimeout(()=>checkRealClinicalCaseAvailability(id));
   if(!result.ok){setReloadError(staffServerText(locale,result.message));return;}
   // An explicit authenticated reread also releases a failed card when no write
   // committed, so its revision/token/hash are unchanged. SQL rechecks the press.
   setReloadVersion(v=>v+1);if(onReload)onReload();else router.refresh();
  }catch(error){setReloadError(error instanceof ClinicalActionTimeout?staffServerText(locale,error.message):t('The current case could not be reloaded. Try again.','Ընթացիկ դեպքը չհաջողվեց թարմացնել։ Փորձեք կրկին։','Не удалось обновить случай. Попробуйте снова.'));}
  finally{setReloading(false);}
 }
 if(!data)return <p role="alert" className="text-body2">{t('Approval cards could not be read. Open the source record to review your work.','Հաստատման քարտերը չհաջողվեց կարդալ։ Բացեք սկզբնաղբյուր գրառումը՝ աշխատանքը վերանայելու համար։','Не удалось загрузить карточки утверждения. Откройте исходную запись для проверки.')}</p>;
 const key=(c:ApprovalContext)=>`${c.memberId}:${c.revision}:${c.evidenceToken}`;
 const consultation=data.consultation&&consultationPublicationGate(data.consultation.review)?data.consultation:null;
 if(chat)return <div className="space-y-3">
  {consultation&&<ConsultationCard urgent={urgent} focusRef={consultationRef} key={key(consultation.context)} card={consultation} locale={locale} chat={chat}/>}
  {data.regimen&&<RegimenCard onConsultation={consultation?focusConsultation:undefined} key={`${reloadVersion}:${key(data.regimen.context)}:${data.regimen.review.draft?.approvalHash}`} card={data.regimen} locale={locale} chat={chat} urgent={urgent}/>}
  {(data.regimen||consultation)&&<button type="button" className="min-h-12 text-body2 underline" onClick={chat.onCheckAgain}>{t('Check again','Ստուգել կրկին','Проверить снова')}</button>}
 </div>;
 return <div className="space-y-3">
  {data.firstNote&&<FirstNoteCard key={`${key(data.firstNote.context)}:${data.firstNote.context.appointmentsRevision}:${data.firstNote.data.note?.approvedAt??''}`} card={data.firstNote} locale={locale}/>}
  {data.regimen&&<RegimenCard onConsultation={consultation?focusConsultation:undefined} key={`${reloadVersion}:${key(data.regimen.context)}:${data.regimen.review.draft?.approvalHash}`} card={data.regimen} locale={locale} urgent={urgent}/>}
  {data.consultation&&<ConsultationCard urgent={urgent} focusRef={consultationRef} key={`${reloadVersion}:${key(data.consultation.context)}`} card={data.consultation} locale={locale}/>}
  {(data.firstNote||data.regimen||data.consultation)&&<button type="button" className="min-h-12 text-body2 underline" disabled={reloading} onClick={()=>void reloadCards()}>{t('Refresh','Թարմացնել','Обновить')}</button>}
  {reloadError&&<p role="alert">{reloadError}</p>}
 </div>;
}
