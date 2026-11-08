import {z} from 'zod';
import type {ValidCard,ZoeCard} from './registry';

export const VISIT_STEPS=['awaiting','confirmed','arrived','samples_collected','plan_published']as const;
export const livingVisitSnapshot=z.strictObject({
 visitId:z.uuid(),source:z.enum(['appointment','home-request','request']),revision:z.number().int().nonnegative(),
 status:z.enum(VISIT_STEPS),startsAt:z.iso.datetime({offset:true}).nullable(),location:z.string().max(1000).nullable(),
 preparation:z.string().max(4000).nullable(),planId:z.uuid().nullable(),
}).refine(v=>(v.source!=='request'||v.status==='awaiting')
 &&(v.status==='awaiting'||v.startsAt!==null)
 &&(v.status==='plan_published')===(v.planId!==null));
export {LIVING_VISIT} from './living-visit-copy';
export function findLivingVisit(cards:readonly ZoeCard[]):Extract<ValidCard,{kind:'visit'}>|undefined{
 return cards.filter((c):c is Extract<ValidCard,{kind:'visit'}>=>c.valid&&c.kind==='visit'&&!!c.snapshot.living)
  .sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||b.id.localeCompare(a.id))[0];
}
/** Only bounded, persisted status outcomes become chat lines. */
export function visitTransitions(card:Extract<ValidCard,{kind:'visit'}>){
 return Object.entries(card.outcome).flatMap(([item,value])=>{
  const parsed=z.strictObject({status:z.enum(VISIT_STEPS),doneAt:z.iso.datetime({offset:true})}).safeParse(value);
  const visitId=item.split(':')[1];
  return parsed.success&&z.uuid().safeParse(visitId).success&&item===`visit:${visitId}:${parsed.data.status}`?[{item,...parsed.data}]:[];
 });
}
