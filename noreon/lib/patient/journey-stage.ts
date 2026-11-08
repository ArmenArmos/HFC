import type {Locale} from '@/lib/locale';
import {currentAppointment,memberJourneyStep,type JourneyInput} from './next-step';

/** Semantic ids, independent of the card's revision-based idempotency string. */
export const JOURNEY_STAGES=[
 'questionnaire_open','tests_to_choose','booking_needed','visit_booked',
 'results_waiting','results_released','review_pending','consultation',
 'plan_preparing','plan_published','plan_confirmed','waiting',
 'review_needed','test_request_pending','visit_confirmation_pending',
 'visit_time_proposed','visit_needs_checking',
] as const;
export type JourneyStage=typeof JOURNEY_STAGES[number];
export type JourneyOptions={episode:string;testsChosen?:boolean;planId?:string|null;teachBackConfirmed?:boolean;resultsReleased?:boolean;resultsPublishedAt?:string|null;revision?:string};

/** Home owns pre-plan precedence. Only the chat's saved choices and publications refine it. */
export function journeyStage(input:JourneyInput,options:JourneyOptions):JourneyStage{
 const action=memberJourneyStep(input);
 if(input.planPublished)return options.teachBackConfirmed?'plan_confirmed':'plan_published';
 if(!input.questionnaireComplete)return 'questionnaire_open';
 // Structured publications use their release event, with the same current-round visit
 // precedence as Home's document read. A collection date never proves a release.
 const visit=input.appointments?currentAppointment(input.appointments):null;
 const published=options.resultsPublishedAt?Date.parse(options.resultsPublishedAt):NaN;
 const currentRelease=Number.isFinite(published)&&(!visit||visit.portal?.checkin?.outcome==='completed'||published>=Date.parse(visit.createdAt));
 // A release is evidence for the doctor, never a member results-ready step.
 if(currentRelease&&action?.id!=='journey-consultation'&&action?.id!=='journey-plan-preparing')return input.review&&input.review!=='none'&&input.review.status==='review_pending'?'review_pending':'results_waiting';
 // The home's current-round action decides. Released documents from an older round never lift the stage above a newer visit.
 switch(action?.id){
  case 'journey-review':return 'review_needed';
  case 'journey-reviewing':return 'review_pending';
  case 'journey-consultation':return 'consultation';
  case 'journey-plan-preparing':return 'plan_preparing';
  case 'journey-results':return input.review&&input.review!=='none'&&input.review.status==='review_pending'?'review_pending':'results_waiting';
  case 'journey-samples':
  case 'journey-nurse-visit-done':
  case 'journey-nurse-samples-sent':
  case 'journey-nurse-samples-collected':
  case 'journey-visit-done':return 'results_waiting';
  case 'journey-nurse-confirmed':
  case 'journey-visit':return 'visit_booked';
  case 'journey-proposal':return 'visit_time_proposed';
  case 'journey-waiting':return 'visit_confirmation_pending';
  case 'journey-visit-check':return 'visit_needs_checking';
  case 'journey-request':return 'test_request_pending';
  case 'journey-book':
  case 'journey-rebook':return options.testsChosen?'booking_needed':'tests_to_choose';
  default:return 'waiting';
 }
}

/** Where the home sends a member once the plan is published, the only stage whose action it does not return. */
export const STAGE_LINKS:Partial<Record<JourneyStage,string>>={plan_published:'/patient/care'};

/** Draft fixed next-action lines only. These do not replace the card or Home copy. */
export const STAGE_CLASSES={
 questionnaire_open:{key:'finish_questionnaire',en:'Continue your questionnaire.',hy:'Շարունակեք ձեր հարցաշարը։',ru:'Продолжите вашу анкету.'},
 tests_to_choose:{key:'tests_to_choose',en:'See your tests before choosing a visit.',hy:'Տեսեք ձեր հետազոտությունները՝ նախքան այց ընտրելը։',ru:'Посмотрите ваши анализы перед выбором визита.'},
 booking_needed:{key:'book_visit',en:'Choose your next visit.',hy:'Ընտրեք ձեր հաջորդ այցը։',ru:'Выберите ваш следующий визит.'},
 visit_booked:{key:'prepare_for_visit',en:'Read your visit details and preparation.',hy:'Կարդացեք ձեր այցի մանրամասներն ու նախապատրաստման ցուցումները։',ru:'Прочитайте подробности вашего визита и указания по подготовке.'},
 results_waiting:{key:'wait_for_results',en:'Your next step is your doctor-approved plan.',hy:'Ձեր հաջորդ քայլը ձեր բժշկի հաստատած պլանն է։',ru:'Ваш следующий шаг: план, одобренный вашим врачом.'},
 // Retained for saved snapshots. New journeys never emit results_released.
 results_released:{key:'read_results',en:'Your next step is your doctor-approved plan.',hy:'Ձեր հաջորդ քայլը ձեր բժշկի հաստատած պլանն է։',ru:'Ваш следующий шаг: план, одобренный вашим врачом.'},
 review_pending:{key:'wait_for_review',en:'Your next step will appear here after review.',hy:'Վերանայումից հետո ձեր հաջորդ քայլը կհայտնվի այստեղ։',ru:'Ваш следующий шаг появится здесь после рассмотрения.'},
 consultation:{key:'arrange_consultation',en:'Message your care team about your consultation.',hy:'Գրեք ձեր խնամքի թիմին ձեր խորհրդատվության մասին։',ru:'Напишите вашей медицинской команде о консультации.'},
 plan_preparing:{key:'wait_for_plan',en:'Your plan will appear here after approval.',hy:'Ձեր պլանը կհայտնվի այստեղ՝ հաստատումից հետո։',ru:'Ваш план появится здесь после одобрения.'},
 plan_published:{key:'read_and_confirm_plan',en:'Read your plan, then confirm what you will do.',hy:'Կարդացեք ձեր պլանը, ապա հաստատեք ձեր անելիքը։',ru:'Прочитайте ваш план, затем подтвердите ваши действия.'},
 plan_confirmed:{key:'plan_confirmed',en:'You have nothing to do here right now.',hy:'Այս պահին այստեղ անելիք չունեք։',ru:'Сейчас вам здесь ничего делать не нужно.'},
 waiting:{key:'nothing_due',en:'Your next step will appear here when it is ready.',hy:'Ձեր հաջորդ քայլը կհայտնվի այստեղ, երբ պատրաստ լինի։',ru:'Ваш следующий шаг появится здесь, когда будет готов.'},
 review_needed:{key:'send_review_request',en:'Send your review request.',hy:'Ուղարկեք ձեր վերանայման հարցումը։',ru:'Отправьте ваш запрос врачу.'},
 test_request_pending:{key:'wait_for_visit_details',en:'Your visit details will appear here.',hy:'Ձեր այցի մանրամասները կհայտնվեն այստեղ։',ru:'Подробности вашего визита появятся здесь.'},
 visit_confirmation_pending:{key:'wait_for_visit_confirmation',en:'Your visit details will update when the clinic confirms your request.',hy:'Ձեր այցի մանրամասները կթարմացվեն, երբ կլինիկան հաստատի ձեր հարցումը։',ru:'Подробности вашего визита обновятся, когда клиника подтвердит вашу заявку.'},
 visit_time_proposed:{key:'review_proposed_time',en:'Review the new visit time proposed to you.',hy:'Դիտեք ձեզ առաջարկված այցի նոր ժամը։',ru:'Посмотрите новое время визита, предложенное вам.'},
 visit_needs_checking:{key:'check_visit_status',en:'Check your saved visit status.',hy:'Ստուգեք ձեր պահպանված այցի կարգավիճակը։',ru:'Проверьте сохранённый статус вашего визита.'},
} as const satisfies Record<JourneyStage,{key:string}&Record<Locale,string>>;
export type ZoeSentenceClassKey=typeof STAGE_CLASSES[JourneyStage]['key'];

/** Fail closed for unknown keys too: Zoe may only use this stage's own sentence class. */
export function zoeSentenceMatchesStage(stage:JourneyStage,sentenceClassKey:string):boolean{
 return STAGE_CLASSES[stage]?.key===sentenceClassKey;
}
