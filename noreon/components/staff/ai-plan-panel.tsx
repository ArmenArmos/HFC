'use client';
import {AI_READ_LABEL} from '@/lib/lab-ai/provenance';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {useActionState,useEffect} from 'react';
import {prepareAiCarePlan,type PlanActionState} from '@/lib/ai-plan/actions';
import {AI_PLAN_LABEL,type PlanGeneration,type PlanItem} from '@/lib/ai-plan/contracts';

import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {planDisplayText,planSourceLabel} from '@/lib/ai-plan/display';
import {planLanguageWarning,planStaffLanguageLabel,planSummaryWarning} from '@/lib/ai-plan/language';
import {withClinicalTimeout,ClinicalActionTimeout} from '@/lib/patient-care/action-timeout';
import {staffServerText} from '@/lib/staff/staff-server-copy';

const initial:PlanActionState={ok:false,message:''};
const button='min-h-11 rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50';
const SECTION:Record<PlanItem['section'],[string,string,string]>={red_flag:['Protocol flags','Արձանագրության զգուշացումներ','Предупреждения протокола'],assessment:['Assessment','Գնահատում','Оценка'],bp_target:['Blood pressure target','Ճնշման նպատակային ցուցանիշ','Целевое артериальное давление'],lifestyle:['Lifestyle goals','Ապրելակերպի նպատակներ','Цели по образу жизни'],tests:['Tests','Հետազոտություններ','Исследования'],
 follow_up:['Follow-up','Հետագա հսկողություն','Дальнейшее наблюдение'],medication_consideration:['For your consideration, not prescribed','Ձեր քննարկման համար, նշանակված չէ','Для вашего рассмотрения, не назначено'],data_gap:['Missing or unreviewed data','Բացակայող կամ չվերանայված տվյալներ','Отсутствующие или непроверенные данные']};

function usePrepare(memberId:string){
 const [state,action,pending]=useActionState(async()=>{
  try{return await withClinicalTimeout(()=>prepareAiCarePlan(memberId));}
  catch(error){return {ok:false,message:error instanceof ClinicalActionTimeout?error.message:'The plan draft could not be prepared. Try again.'};}
 },initial);
 // A prepared draft opens in the treatment editor.
 useEffect(()=>{if(state.ok)window.location.hash='#treatment';},[state]);
 return {state,action,pending};
}

/** Overview step for the assigned doctor: results reviewed, then one button to prepare the plan draft. */
export function AiPlanPrepare({memberId,reviewed,unreviewed,autoConfirmed=0,prepared,locale}:{memberId:string;reviewed:number;unreviewed:number;autoConfirmed?:number;prepared:boolean;locale:StaffLocale}){
 const {state,action,pending}=usePrepare(memberId);
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const prepare=t('Prepare care plan','Պատրաստել խնամքի պլան','Подготовить план лечения');
 const first=unreviewed?t(`${unreviewed} result${unreviewed===1?'':'s'} still to review`,`Դեռ պետք է վերանայել ${unreviewed} արդյունք`,`Осталось проверить: ${unreviewed}`):reviewed?t('Results reviewed','Արդյունքները վերանայված են','Результаты проверены'):autoConfirmed?AI_READ_LABEL[locale]:t('No lab results recorded yet','Լաբորատոր արդյունքներ դեռ գրանցված չեն','Лабораторные результаты ещё не записаны');
 return <section aria-labelledby="ai-plan-step" className="space-y-3 rounded-xl border border-primary bg-background p-4 sm:p-5">
  <h2 id="ai-plan-step" className="text-h3"><span className={unreviewed?'text-muted-foreground':''}>{first}</span> <span aria-hidden="true">→</span><span className="sr-only">{t(', next:',', հաջորդ քայլը՝',', далее:')}</span> {prepare}</h2>
  <p className="text-body2">{prepared?t('A draft is ready in the treatment plan. You can open it or prepare a new one.','Բուժման պլանում սևագիրն արդեն պատրաստ է։ Կարող եք բացել այն կամ պատրաստել նորը։','В плане лечения готов черновик. Вы можете открыть его или подготовить новый.'):t('Prepare a draft of the care plan from the questionnaire, triage, confirmed results and readings. You edit and approve it; nothing reaches the member until you publish.','Պատրաստեք խնամքի պլանի սևագիրը՝ հարցաշարի, հրատապության գնահատման, հաստատված արդյունքների և չափումների հիման վրա։ Դուք խմբագրում և հաստատում եք այն։ Անդամը ոչինչ չի ստանում մինչև հրապարակումը։','Подготовьте черновик плана лечения на основе анкеты, оценки срочности, подтверждённых результатов и измерений. Вы редактируете и утверждаете его. Участник ничего не получит до публикации.')}{unreviewed?t(' Unverified values are not used.',' Չստուգված ցուցանիշները չեն օգտագործվում։',' Непроверенные значения не используются.'):''}</p>
  {autoConfirmed>0&&<p className="text-caption text-muted-foreground">{autoConfirmed} · {AI_READ_LABEL[locale]} · <a href="#member-documents-title" className="inline-flex min-h-11 items-center underline">{t('Check values','Ստուգել արժեքները','Проверить показатели')}</a></p>}
  <form action={action} className="flex flex-wrap items-center gap-3">
   <button className={button} disabled={pending} aria-busy={pending}>{pending?t('Preparing draft…','Սևագիրը պատրաստվում է…','Черновик готовится…'):prepared?t('Prepare a new draft','Պատրաստել նոր սևագիր','Подготовить новый черновик'):prepare}</button>
   {prepared&&<a href="#treatment" className="inline-flex min-h-11 items-center underline text-body2">{t('Open the draft','Բացել սևագիրը','Открыть черновик')}</a>}
  </form>
  {state.message&&<p role={state.ok?'status':'alert'} className="text-body2">{staffServerText(locale,state.message)}</p>}
 </section>;
}

function Item({item,locale,memberId}:{item:PlanItem;locale:StaffLocale;memberId:string}){
 if(item.id.startsWith('info:ai-read:'))return <li className="space-y-1 py-3 text-caption text-muted-foreground">{planStaffLanguageLabel(locale)&&<p>{planStaffLanguageLabel(locale)}</p>}<p>{planDisplayText(item.text,locale)}</p><a href={`/staff/real/members/${memberId}#member-documents-title`} className="inline-flex min-h-11 items-center underline">{st(locale,'Check values','Ստուգել արժեքները','Проверить показатели')}</a></li>;
 return <li className="space-y-1 py-3">
  {planStaffLanguageLabel(locale)&&<p className="text-caption text-muted-foreground">{planStaffLanguageLabel(locale)}</p>}
  <p className="text-body2">{planDisplayText(item.text,locale)}{item.status==='needs_doctor_judgement'&&<span className="ml-2 rounded-sm border px-2 py-0.5 text-caption">{st(locale,'Needs your judgement','Պահանջում է ձեր գնահատումը','Требуется ваше решение')}</span>}</p>
  {item.timing&&<p className="text-caption text-muted-foreground">{st(locale,'When:','Երբ՝','Когда:')} {planDisplayText(item.timing,locale)}</p>}
  <p className="text-caption text-muted-foreground">{st(locale,'Why:','Ինչու՝','Почему:')} {planDisplayText(item.rationale,locale)} {st(locale,'Source:','Աղբյուր՝','Источник:')} {planSourceLabel(item.source,locale)}.</p>
 </li>;
}

/** The draft's reasoning beside the editor: what needs the doctor, what was not prescribed, and why each item is there. */
export function AiPlanPanel({memberId,generation,stale,locale='en'}:{memberId:string;generation:PlanGeneration;stale:boolean;locale?:StaffLocale}){
 const {state,action,pending}=usePrepare(memberId);
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const doctorOnly=generation.items.filter(i=>!i.member||i.status==='needs_doctor_judgement');
 const memberFacing=generation.items.filter(i=>i.member&&i.status==='protocol');
 const sections=[...new Set(doctorOnly.map(i=>i.section))];
 return <section aria-labelledby="ai-plan-panel" className="space-y-4 rounded-xl border bg-background p-4 sm:p-5">
  <div className="space-y-1">
   <h2 id="ai-plan-panel" className="text-h3">{st(locale,AI_PLAN_LABEL.en,AI_PLAN_LABEL.hy,AI_PLAN_LABEL.ru)}</h2>
   <p className="text-caption text-muted-foreground">{generation.mode==='model'&&generation.summary?st(locale,'AI summary applied. Draft from plan items.','AI ամփոփումն ավելացված է։ Սևագիրը կազմված է պլանի կետերից։','Добавлено резюме ИИ. Черновик составлен из пунктов плана.'):st(locale,'AI wording unavailable. Draft from plan items.','AI ձևակերպումներն անհասանելի են։ Սևագիրը կազմված է պլանի կետերից։','Текст ИИ недоступен. Черновик составлен из пунктов плана.')} · {yerevanStamp(generation.createdAt,locale)}</p>
  </div>
  {stale&&<p role="alert" className="text-body2">{t('The evidence changed after this draft was prepared. Prepare a new draft before using it.','Այս սևագիրը պատրաստելուց հետո տվյալները փոխվել են։ Օգտագործելուց առաջ պատրաստեք նոր սևագիր։','После подготовки черновика данные изменились. Перед использованием подготовьте новый черновик.')}</p>}
  {planLanguageWarning(generation.guard??[],locale)&&<p role="alert" className="text-body2">{planLanguageWarning(generation.guard??[],locale)}</p>}
  {generation.summary&&<>
   {planSummaryWarning(generation.guard??[],locale)&&<p role="alert" className="text-body2">{planSummaryWarning(generation.guard??[],locale)}</p>}
   <p className="whitespace-pre-wrap text-body2">{planDisplayText(generation.summary,locale)}</p>
  </>}
  {sections.map(s=><div key={s}><h3 className="text-body2 font-medium">{t(...SECTION[s])}</h3><ul className="divide-y">{doctorOnly.filter(i=>i.section===s).map(i=><Item key={i.id} item={i} locale={locale} memberId={memberId}/>)}</ul></div>)}
  <details><summary className="min-h-11 cursor-pointer text-body2">{t('Sources for the member-facing text','Անդամին ցուցադրվող տեքստի աղբյուրները','Источники текста для участника')} ({memberFacing.length})</summary><ul className="divide-y">{memberFacing.map(i=><Item key={i.id} item={i} locale={locale} memberId={memberId}/>)}</ul></details>
  <form action={action} onSubmit={e=>{if(!window.confirm(t('Prepare a new draft? It fills the editor by itself only if you have not typed, accepted or saved anything; otherwise it is offered and your text is kept.','Պատրաստե՞լ նոր սևագիր։ Այն ինքնաշխատ կլրացնի խմբագրիչը միայն այն դեպքում, եթե դեռ ոչինչ չեք գրել, ընդունել կամ պահպանել։ Հակառակ դեպքում կառաջարկվի նոր սևագիրը, իսկ ձեր տեքստը կպահպանվի։','Подготовить новый черновик? Он заполнит редактор автоматически, только если вы ещё ничего не ввели, не приняли и не сохранили. Иначе он будет предложен отдельно, а ваш текст сохранится.')))e.preventDefault();}} className="flex flex-wrap items-center gap-3">
   <button className="min-h-11 rounded-md border px-4 text-body2" disabled={pending} aria-busy={pending}>{pending?t('Preparing draft…','Սևագիրը պատրաստվում է…','Черновик готовится…'):t('Regenerate','Պատրաստել նորից','Подготовить заново')}</button>
  </form>
  {state.message&&<p role={state.ok?'status':'alert'} className="text-body2">{staffServerText(locale,state.message)}</p>}
 </section>;
}
