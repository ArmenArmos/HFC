'use client';
import Link from 'next/link';
import {useEffect,useId,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {copy,stamp} from '@/components/patient-care/common';
import {MemberBpWeekContent} from '@/components/bp-week/member-week-content';
import {currentWeek} from '@/lib/bp-week/model';
import {MeasurementForm} from './measurement-form';
import {weekSave} from '@/components/bp-week/week-controls';
import {ValueForm} from '@/components/member-history/value-form';
import {UploadCard} from '@/components/member-history/upload-card';
import {ResultHistory} from '@/components/patient-care/result-history';
import {TestOrders} from '@/components/patient-care/test-orders';
import {PublishedReviewCard} from '@/components/real-review/published-review-card';
import {LessonContent} from '@/components/lessons/lesson-content';
import {ProfileSummary} from './profile-summary';
import {MemberTeamContent} from '@/components/patient-care/member-team-content';
import {MemberHelpContent} from '@/components/patient-care/member-help-content';
import {DoseButtons,PlanAcknowledgement} from '@/components/patient-care/controls';
import {ValueList} from "@/components/member-history/history-lists";
import {ApprovedPlan,PlanApproval,MedicationSchedule} from '@/components/patient-care/care-layout';
import {SignInEnded} from './sign-in-ended';
import {arrangedConsultationText} from '@/lib/doctor-completion/consultation-copy';
import {openEverydayCard,readEverydayFromCard,readPlanFromCard,saveEverydayFromCard} from '@/lib/zoe-chat-actions/everyday-actions';
import {openZoeCard} from '@/lib/zoe-chat-actions/actions';
import type {EverydayRead} from '@/lib/zoe-chat-actions/everyday-read';
import type {EverydayFeatureResult,EverydayWrite} from '@/lib/zoe-chat-actions/everyday';
import type {EverydayView} from '@/lib/zoe-chat-actions/everyday-contract';
import type {PatientLocale} from '@/lib/patient/copy';
import type {CarePlan} from '@/lib/patient-care/types';
import type {ValidCard,ZoeCard} from '@/lib/zoe-chat-actions/registry';

type Done=(card:ZoeCard)=>void;
const unconfirmed=(l:PatientLocale)=>copy(l,'We could not confirm this save. Show current details to check before trying again.','Չհաջողվեց հաստատել պահպանումը։ Կրկին փորձելուց առաջ ցուցադրեք և ստուգեք ընթացիկ տվյալները։','Не удалось подтвердить сохранение. Прежде чем повторить попытку, откройте актуальные данные и проверьте их.');
export function EverydayStatus({status,locale:l}:{status:string;locale:PatientLocale}) {
 if(status==='signed_out')return <SignInEnded locale={l}/>;
 return <p role="status" className="text-body2">{status==='loading'?copy(l,'Loading your details…','Բեռնվում են ձեր տվյալները…','Загружаем ваши данные…')
  :status==='stale'||status==='closed'?copy(l,'These details changed or this card is closed. Show current details before continuing.','Այս տվյալները փոխվել են կամ քարտը փակված է։ Շարունակելուց առաջ ցուցադրեք ընթացիկ տվյալները։','Эти данные изменились или карточка закрыта. Прежде чем продолжить, откройте актуальные данные.')
  :copy(l,'This is unavailable right now. Show current details to try again.','Սա այս պահին անհասանելի է։ Կրկին փորձելու համար ցուցադրեք ընթացիկ տվյալները։','Сейчас это недоступно. Откройте актуальные данные, чтобы попробовать снова.')}</p>;
}
export function ShowEveryday({view,locale:l,onCard}:{view:EverydayView;locale:PatientLocale;onCard:Done}) {
 const request=useRef<string|null>(null),opening=useRef(false);
 const [busy,setBusy]=useState(false),[status,setStatus]=useState<string|null>(null);
 return <div className="space-y-2"><Button type="button" variant="outline" className="h-auto min-h-12 whitespace-normal" disabled={busy} onClick={async()=>{
  if(opening.current)return;opening.current=true;setBusy(true);setStatus(null);
  request.current??=crypto.randomUUID();
  try{const r=await openEverydayCard({requestId:request.current,view});if(r.status==='ok'){request.current=null;onCard(r.card);}else setStatus(r.status);}
  catch{setStatus('unavailable');}finally{opening.current=false;setBusy(false);}
 }}>{copy(l,'Refresh','Թարմացնել','Обновить')}</Button>{status&&<EverydayStatus status={status} locale={l}/>}</div>;
}
export function Receipt({view,result,locale:l}:{view:EverydayWrite['view'];result:EverydayFeatureResult;locale:PatientLocale}) {
 return <p role="status" className="text-body2" data-everyday-receipt={result.status}>{result.status==='saved'
  ?view==='earlier'?copy(l,'Your earlier value was saved as reported by you.','Ձեր նախկին արժեքը պահպանված է որպես ձեր հաղորդած տվյալ։','Предыдущее значение сохранено как предоставленное вами.')
  :view==='plan_ack'?copy(l,'You marked this plan as read.','Դուք նշել եք պլանը որպես կարդացված։','Этот план отмечен вами как прочитанный.')
  :copy(l,'Your lesson progress was saved.','Դասի առաջընթացը պահպանված է։','Ваш прогресс по уроку сохранён.')
  :result.status==='unavailable'?unconfirmed(l)
  :copy(l,'This change was not saved. Show current details before trying again.','Այս փոփոխությունը չպահպանվեց։ Կրկին փորձելուց առաջ ցուցադրեք ընթացիկ տվյալները։','Изменение не сохранено. Прежде чем повторить попытку, откройте актуальные данные.')}</p>;
}

/** Reads are pinned to the posted card. Existing forms own validation, content and feature writes. */
export function ZoeEveryday({card,locale:l,onCard}:{card:Extract<ValidCard,{kind:'menu'}>;locale:PatientLocale;onCard:Done}) {
 const [data,setData]=useState<EverydayRead|null>(null),[status,setStatus]=useState('loading');
 const [completedLessonId,setCompletedLessonId]=useState<string|undefined>();
 const [localResult,setLocalResult]=useState<EverydayFeatureResult|null>(null);
 const receipt=(card.outcome['everyday:result'] as EverydayFeatureResult|undefined)??localResult;
 const saved=receipt?.status==='saved';
 const sending=useRef(false),sealed=useRef(false),op=useRef<string|null>(null);
 const [busy,setBusy]=useState(false);
 useEffect(()=>{
  let active=true;
  if(!saved&&(card.state==='done'||card.outcome.everyday))return;
  void readEverydayFromCard(card.id).then(r=>{if(active){setStatus(r.status);if(r.status==='ok'){setData(r.data);setCompletedLessonId(r.completedLessonId);}}}).catch(()=>{if(active)setStatus('unavailable');});
  return ()=>{active=false;};
 },[card.id,card.state,card.outcome.everyday,saved]);
 const view=card.snapshot.view!;
 const perform=async(input:unknown):Promise<EverydayFeatureResult>=>{
  if(sending.current||sealed.current)return {status:'refused'};
  sending.current=true;setBusy(true);op.current??=crypto.randomUUID();
  let result:EverydayFeatureResult,showReceipt=true;
  try{
   const r=await saveEverydayFromCard({cardId:card.id,opId:op.current,view,input});
   result=r.result??{status:r.status==='signed_out'?'access':'unavailable'};
   if(['stale','closed','signed_out','disabled'].includes(r.status)){setStatus(r.status);showReceipt=false;}
   if(r.card)onCard(r.card);
  }catch{result={status:'unavailable'};}
  sealed.current=true;sending.current=false;setBusy(false);if(showReceipt)setLocalResult(result);
  return result;
 };
 if(receipt&&!saved)return <Receipt view={view} result={receipt} locale={l}/>;
 if(!saved&&card.outcome.everyday)return <p role="status">{unconfirmed(l)}</p>;
 if(card.state==='done'&&!saved)return <EverydayStatus status="closed" locale={l}/>;
 if(view==='bp_week'&&status==='unavailable')return <p role="status" className="text-body2">{copy(l,'Your blood pressure week could not be loaded. Refresh to try again.','Չհաջողվեց բեռնել ձեր ճնշման շաբաթը։ Թարմացրեք՝ կրկին փորձելու համար։','Не удалось загрузить вашу неделю давления. Обновите, чтобы попробовать снова.')}</p>;
 if(!data||status!=='ok')return <>{receipt&&<Receipt view={view} result={receipt} locale={l}/>}<EverydayStatus status={status} locale={l}/></>;
 return <fieldset className="min-w-0 space-y-4" disabled={busy} aria-busy={busy} data-zoe-everyday={view}>
  {receipt&&<Receipt view={view} result={receipt} locale={l}/>}
  <EverydayContent data={data} locale={l} perform={perform} onCard={onCard} readOnly={saved} initialLessonId={completedLessonId}/>
 </fieldset>;
}

export function EverydayContent({data,locale:l,perform,onCard,readOnly=false,initialLessonId}:{data:EverydayRead;locale:PatientLocale;perform:(input:unknown)=>Promise<EverydayFeatureResult>;onCard:Done;readOnly?:boolean;initialLessonId?:string}) {
 const [selected,setSelected]=useState('');
 const selector=useId();
 // Route existing support controls through the same cards, without moving out of the conversation.
 const open=async(href:string)=>{
  const view:EverydayView|undefined=href.startsWith('/patient/team')?'team':href.startsWith('/patient/review')?'previous_plans':undefined;
  const r=view?await openEverydayCard({requestId:crypto.randomUUID(),view}):await openZoeCard({requestId:crypto.randomUUID(),kind:href.includes('measurements')?'bp':href.includes('care')?'plan':'message',sourceSeq:null});
  if(r.status==='ok')onCard(r.card);else setOpenStatus(r.status);
 };
 const [openStatus,setOpenStatus]=useState<string|null>(null);
 const message=()=>{void open('/patient/zoe').catch(()=>setOpenStatus('unavailable'));};
 const supportOpen=(href:string)=>{void open(href).catch(()=>setOpenStatus('unavailable'));};
 let body;
 switch(data.view){
  case 'bp_week': body=<WeekPanel data={data} locale={l}/>;break;
  case 'earlier': body=data.history?<>
   <p className="text-body2">{copy(l,'Add results from before Noreon. These are marked as reported by you, because the clinic has not checked them.','Ավելացրեք Noreon-ից առաջ ստացված արդյունքները։ Դրանք նշվում են որպես ձեր հաղորդած տվյալներ, քանի որ կլինիկան դրանք չի ստուգել։','Добавьте результаты, полученные до Noreon. Они отмечаются как предоставленные вами, поскольку клиника их не проверяла.')}</p>
   {!readOnly&&<><ValueForm locale={l} existing={data.history.values} save={async input=>{const r=await perform(input);return r.status==='saved'?{status:'saved'}:r.status==='invalid'?{status:'invalid',fields:r.fields}:{status:r.status==='access'?'access':'unavailable'};}}/>
   <details className="rounded-xl border p-3"><summary className="min-h-12 cursor-pointer content-center font-semibold text-body2">{copy(l,'Upload an earlier report','Վերբեռնել նախկին հետազոտությունը','Загрузить предыдущий отчёт')}</summary><UploadCard locale={l} reading={data.reading}/></details></>}
   <details className="rounded-xl border p-3"><summary className="min-h-12 cursor-pointer content-center font-semibold text-body2">{copy(l,'Your saved values','Ձեր պահպանված արժեքները','Ваши сохранённые значения')}</summary><ValueList locale={l} values={data.history.values}/></details>
  </>:<EverydayStatus status="unavailable" locale={l}/>;break;
  case 'result_history': body=<>
   {data.tests.length>0&&<TestOrders tests={data.tests} locale={l}/>}
   {data.results.length?<ResultHistory results={data.results} locale={l}/>:<p className="text-body2">{copy(l,'No result history has been published yet.','Արդյունքների պատմություն դեռ հրապարակված չէ։','История результатов ещё не опубликована.')}</p>}
   {data.reportedValues===null?<EverydayStatus status="unavailable" locale={l}/>:<ValueList values={data.reportedValues} locale={l}/>}
   <p className="text-caption text-muted-foreground">{copy(l,'Reference intervals belong to the reporting laboratory. A value outside an interval does not by itself establish a diagnosis.','Հղման միջակայքները տրամադրում է լաբորատորիան։ Միջակայքից դուրս արժեքն ինքնին ախտորոշում չէ։','Референсные интервалы устанавливает лаборатория, выдавшая результат. Значение за пределами интервала само по себе не устанавливает диагноз.')}</p>
  </>;break;
  case 'previous_plans': {
   const publication=data.publications.find(p=>p.planId===selected)??data.publications[0];
   body=!data.enabled?<EverydayStatus status="disabled" locale={l}/>:<>
    {data.status?.status==='consultation_needed'&&<p className="text-body2">{copy(l,'Your doctor would like to talk with you before your new results and plan are shared.','Ձեր բժիշկը ցանկանում է խոսել ձեզ հետ՝ նախքան ձեր նոր արդյունքներն ու պլանը ձեզ հետ կիսվելը։','Ваш врач хочет поговорить с вами, прежде чем вы получите новые результаты и план.')} {data.status.consultation?arrangedConsultationText(data.status.consultation,l):copy(l,'Your care team will contact you to arrange a time.','Ձեր խնամքի թիմը կկապվի ձեզ հետ՝ ժամը համաձայնեցնելու համար։','Ваша медицинская команда свяжется с вами, чтобы согласовать время.')}</p>}
    {publication?<>
     <label htmlFor={selector} className="block text-body2 font-semibold">{copy(l,'Choose a published plan','Ընտրեք հրապարակված պլանը','Выберите опубликованный план')}</label>
     <select id={selector} value={publication.planId} onChange={e=>setSelected(e.target.value)} className="min-h-12 w-full max-w-full rounded-md border bg-background px-2 text-body2">
      {data.publications.map(p=><option key={p.planId} value={p.planId}>{data.versions?.find(v=>v.planId===p.planId)?.version?`${copy(l,'Version','Տարբերակ','Версия')} ${data.versions.find(v=>v.planId===p.planId)!.version}`:copy(l,'Published plan','Հրապարակված պլան','Опубликованный план')} · {stamp(p.publishedAt,l,false)}</option>)}
     </select>
     <PublishedReviewCard publication={publication} current={publication.planId===data.publications[0]?.planId} locale={l} version={data.versions?.find(v=>v.planId===publication.planId)??null} regimen={data.regimens?.find(v=>v.planId===publication.planId)??null}/>
    </>:<p className="text-body2">{copy(l,'You do not have any previous plans yet.','Դուք դեռ նախորդ պլաններ չունեք։','У вас пока нет предыдущих планов.')}</p>}
   </>;break;
  }
  case 'lessons': {
   const lesson=data.lessons.find(x=>x.id===(selected||initialLessonId))??data.lessons[0];
   body=lesson?<>
    <label htmlFor={selector} className="block text-body2 font-semibold">{copy(l,'Choose a lesson','Ընտրեք դասը','Выберите урок')}</label>
    <select id={selector} value={lesson.id} onChange={e=>setSelected(e.target.value)} className="min-h-12 w-full max-w-full rounded-md border bg-background px-2 text-body2">{data.lessons.map(x=><option key={x.id} value={x.id}>{x.title[l]}</option>)}</select>
    {!data.progress&&<EverydayStatus status="unavailable" locale={l}/>}
    <fieldset disabled={readOnly} className="min-w-0"><LessonContent embedded key={lesson.id} lesson={lesson} locale={l} done={data.progress?data.progress.done.some(d=>d.lessonId===lesson.id):null} saveAction={async(lessonId,done)=>({ok:(await perform({lessonId,done})).status==='saved'})}/></fieldset>
   </>:<p className="text-body2">{copy(l,'No lessons are available yet. Your care team is reviewing them.','Դասերը դեռ հասանելի չեն։ Ձեր խնամքի թիմը վերանայում է դրանք։','Уроки пока недоступны. Ваша медицинская команда проверяет их.')}</p>;break;
  }
  case 'answers': body=<>
   {Object.keys(data.assessment.answers).length?<ProfileSummary embedded answers={data.assessment.answers} locale={l} exercise={data.exercise}/>:<p className="text-body2">{copy(l,'You have not saved any answers yet.','Դուք դեռ պատասխաններ չեք պահպանել։','Вы ещё не сохранили ответы.')}</p>}
   <Link className="inline-flex min-h-12 items-center font-semibold underline" href="/patient/zoe?card=questionnaire">{copy(l,'Review or change my answers','Վերանայել կամ փոխել պատասխանները','Просмотреть или изменить мои ответы')}</Link>
  </>;break;
  case 'team': body=<MemberTeamContent embedded locale={l} clinician={data.clinician} contact={data.contact} reviewEnabled={data.reviewEnabled} onMessage={message} open={supportOpen}/>;break;
  case 'help': body=<MemberHelpContent embedded locale={l} contact={data.contact} onMessage={message} open={supportOpen}/>;break;
 }
 return <div className="min-w-0 space-y-4">{body}{openStatus&&<EverydayStatus status={openStatus} locale={l}/>}</div>;
}
function WeekPanel({data,locale:l}:{data:Extract<EverydayRead,{view:'bp_week'}>;locale:PatientLocale}) {
 const [slot,setSlot]=useState<'morning'|'evening'|null>(null),[changed,setChanged]=useState(false);
 const [now]=useState(()=>new Date());
 const prefix=useId();
 if(changed)return <EverydayStatus status="stale" locale={l}/>;
 if(!data.read.enabled)return <div className="space-y-3"><p className="text-body2">{copy(l,'Week tracking is turned off. You can still record individual readings or ask your care team about a blood pressure week.','Ճնշման շաբաթվա հետևումն անջատված է։ Կարող եք առանձին չափումներ գրանցել կամ խնամքի թիմին հարցնել ճնշման շաբաթվա մասին։','Отслеживание недели давления отключено. Вы можете записывать отдельные измерения или спросить медицинскую команду о неделе давления.')}</p><Link href="/patient/zoe?card=bp" className="inline-flex min-h-12 items-center font-semibold underline">{copy(l,'Record a reading','Գրանցել չափում','Записать измерение')}</Link><Link href="/patient/zoe?card=team" className="inline-flex min-h-12 items-center font-semibold underline">{copy(l,'Your care team','Ձեր խնամքի թիմը','Ваша медицинская команда')}</Link></div>;
 const week=currentWeek(data.read,now);
 return <div className="space-y-4"><MemberBpWeekContent embedded read={data.read} locale={l} now={now} showDevice={data.showDevice} record={setSlot} onSaved={()=>setChanged(true)}/>
  {slot&&week&&<section className="space-y-3 rounded-xl border p-3"><h3 className="text-h3">{copy(l,'Record a reading','Գրանցել չափում','Записать измерение')}</h3><MeasurementForm key={slot} idPrefix={prefix} locale={l} save={weekSave(l,week.id,slot)} onSaved={()=>setChanged(true)}/></section>}
 </div>;
}

/** Same acknowledgement control as the page; only a current published plan may be saved. */
export function ZoePlanAcknowledgement({card,plan,locale:l,onCard,onSaved,onAct}:{onAct?:(id:string,on:boolean)=>void;card:Extract<ValidCard,{kind:'plan'}>;plan?:CarePlan;locale:PatientLocale;onCard:Done;onSaved?:()=>void}) {
 const [result,setResult]=useState<EverydayFeatureResult|null>(null),[status,setStatus]=useState<string|null>(null);
 const op=useRef<string|null>(null),sending=useRef(false);
 const receipt=(card.outcome['everyday:result'] as EverydayFeatureResult|undefined)??result;
 if(plan?.acknowledged||plan?.acknowledgedAt)return <p className="text-body2">{copy(l,'You marked this plan as read','Դուք նշել եք պլանը որպես կարդացված','Этот план отмечен вами как прочитанный')} · {plan.acknowledgedAt?stamp(plan.acknowledgedAt,l):copy(l,'Date not recorded','Ամսաթիվը գրանցված չէ','Дата не записана')}</p>;
 if(receipt)return <Receipt view="plan_ack" result={receipt} locale={l}/>;
 if(card.snapshot.plan?.acknowledged)return <Receipt view="plan_ack" result={{status:'saved'}} locale={l}/>;
 if(card.outcome.everyday)return <p role="status">{unconfirmed(l)}</p>;
 if(card.state==='done'||status)return <EverydayStatus status={status??'closed'} locale={l}/>;
 if(!card.snapshot.plan)return null;
 return <PlanAcknowledgement planId={card.snapshot.plan.id} locale={l} saveAction={async planId=>{
  if(sending.current)return {ok:false};sending.current=true;op.current??=crypto.randomUUID();onAct?.(card.id,true);
  try{
   const r=await saveEverydayFromCard({cardId:card.id,opId:op.current,view:'plan_ack',input:{planId}});
   if(r.card)onCard(r.card);
   if(r.status!=='ok'&&r.status!=='unavailable')onAct?.(card.id,false);
   if(r.result)setResult(r.result);else setStatus(r.status);
   if(r.result?.status==='saved')onSaved?.();
   return {ok:r.result?.status==='saved'};
  }catch{setResult({status:'unavailable'});return {ok:false};}finally{sending.current=false;}
 }}/>;
}

export function ZoePlanDetails({card,locale:l,onCard,onAct}:{onAct?:(id:string,on:boolean)=>void;card:Extract<ValidCard,{kind:'plan'}>;locale:PatientLocale;onCard:Done}) {
 const [data,setData]=useState<Extract<Awaited<ReturnType<typeof readPlanFromCard>>,{status:'ok'}>|null>(null),[status,setStatus]=useState('loading');
 const [revision,setRevision]=useState(0);
 const saved=(card.outcome['everyday:result'] as EverydayFeatureResult|undefined)?.status;
 useEffect(()=>{
  let active=true;
  void readPlanFromCard(card.id).then(r=>{if(active){setStatus(r.status);setData(r.status==='ok'?r:null);}}).catch(()=>{if(active){setStatus('unavailable');setData(null);}});
  return ()=>{active=false;};
 },[card.id,revision,saved]);
 if(!data)return <><EverydayStatus status={status} locale={l}/>{(card.outcome['everyday:result']||card.outcome.everyday)&&<ZoePlanAcknowledgement onAct={onAct} card={card} locale={l} onCard={onCard}/>}</>;
 const reload=()=>setRevision(r=>r+1);
 return <div className="space-y-3">
  <PlanApproval plan={data.plan} pendingReview={data.pendingReview} locale={l}/>
  <MedicationSchedule embedded doses={data.doses} plan={data.plan} locale={l} doseAction={dose=><DoseButtons dose={dose} locale={l} compact onSaved={reload}/>}/>
  <ApprovedPlan embedded plan={data.plan} locale={l} version={data.version} medicineChanges={data.medicineChanges} readAction={<ZoePlanAcknowledgement onAct={onAct} card={card} plan={data.plan} locale={l} onCard={onCard} onSaved={reload}/>}/>
  <Button type="button" variant="outline" className="h-auto min-h-12 whitespace-normal" onClick={async()=>{if(typeof window!=='undefined'&&!window.dispatchEvent(new CustomEvent('noreon:member-account-open',{cancelable:true,detail:{section:'reminders'}})))return;const r=await openZoeCard({requestId:crypto.randomUUID(),kind:'account',sourceSeq:null});if(r.status==='ok')onCard(r.card);else setStatus(r.status);}}>{copy(l,'Change reminder times','Փոխել հիշեցումների ժամերը','Изменить время напоминаний')}</Button>
  {status!=='ok'&&status!=='loading'&&<EverydayStatus status={status} locale={l}/>}
 </div>;
}
