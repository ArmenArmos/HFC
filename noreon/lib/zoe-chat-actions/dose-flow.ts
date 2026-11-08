import {evaluateLiverMuscle} from '@/lib/clinical/zones/evaluate';
import type {ZoeCard} from './registry';
export const DOSE_REASONS=['forgot','values_normal','side_effect_or_fear','ran_out_or_cost']as const;
export type DoseReason=typeof DOSE_REASONS[number];
export const SAMS_QUESTIONS=['musclePain','weakness','darkUrine','fever','jaundice','rightUpperPain']as const;
export type SamsQuestion=typeof SAMS_QUESTIONS[number];
/** Card item keys are lowercase in the shared database contract. */
export const samsItem=(q:SamsQuestion)=>`a:${q.toLowerCase()}`;
export type SamsAnswers=Partial<Record<SamsQuestion,boolean>>;
export function samsAnswers(card:Pick<ZoeCard,'outcome'>):SamsAnswers{
 return Object.fromEntries(SAMS_QUESTIONS.flatMap(q=>{const v=card.outcome[samsItem(q)]as{answer?:unknown}|undefined;return typeof v?.answer==='boolean'?[[q,v.answer]]:[];}));
}
export const evaluateSams=(a:SamsAnswers)=>evaluateLiverMuscle({alt:null,altUln:null,ck:null,ckUln:null,sams:{musclePain:a.musclePain??null,weakness:a.weakness??null,darkUrine:a.darkUrine??null,fever:a.fever??null,jaundice:a.jaundice??null,rightUpperPain:a.rightUpperPain??null}});
export const nextSamsQuestion=(a:SamsAnswers)=>evaluateSams(a).zone==='red'?null:SAMS_QUESTIONS.find(q=>a[q]===undefined)??null;
