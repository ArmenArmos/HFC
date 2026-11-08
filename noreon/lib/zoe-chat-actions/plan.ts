import {z} from 'zod';
import type {CareData} from '@/lib/patient-care/types';
import type {MemberLdl} from '@/lib/ldl/schema';
import {assessLdl} from '@/lib/ldl/status';

export const planStateSchema=z.strictObject({planId:z.uuid(),version:z.number().int().positive(),teachBackConfirmedAt:z.string().nullable()});
export type PlanState=z.infer<typeof planStateSchema>;
/** Explicit member projection. In particular, the LDL goal's category never crosses this boundary. */
export const planDetailsSchema=planStateSchema.extend({
 clinician:z.string().nullable(),publishedAt:z.string(),
 bp:z.object({systolic:z.number(),diastolic:z.number()}).strict().nullable(),
 ldl:z.object({target:z.number(),current:z.number().nullable(),reductionPercent:z.number().nullable(),status:z.enum(['goal_not_set','not_assessable','at_goal','above_goal'])}).strict().nullable(),
 lifestyle:z.string(),followUp:z.string(),calendar:z.array(z.object({id:z.string(),title:z.string(),dueAt:z.string().nullable()}).strict()),
});
export type PlanDetails=z.infer<typeof planDetailsSchema>;

export function planRemindersAllowed(v3:boolean,state:PlanState|null,planId:string|null):boolean {
 return !v3||!!(state&&state.planId===planId&&state.teachBackConfirmedAt);
}
export const publishedDoctorName=(name:string):string|null=> /staging|demo|test|synthetic|փորձ|тест|демо/i.test(name)?null:name.trim()||null;

export function planDetails(care:CareData,state:PlanState|null,ldl:MemberLdl|null):PlanDetails|null {
 const p=care.plan;
 if(!p||!state||state.planId!==p.id)return null;
 const goal=ldl?.enabled&&ldl.inPathway?ldl.goal:null;
 const assessed=goal&&ldl?.enabled&&ldl.inPathway?assessLdl({goal,observations:ldl.observations.filter(o=>o.memberVisible)}):null;
 return {
  ...state,clinician:publishedDoctorName(p.clinician),publishedAt:p.publishedAt,
  // Publication has no structured BP goal. Do not extract one from prose or use a population target.
  bp:null,
  ldl:goal&&assessed?{target:goal.thresholdMmol,current:assessed.latest?.mmol??null,reductionPercent:'percent'in assessed.reduction?assessed.reduction.percent:null,status:assessed.status}:null,
  lifestyle:p.publishedReview?.instructions??p.instructions,followUp:p.publishedReview?.followUp??'',
  calendar:care.tests.filter(t=>(t.status==='ordered'||t.status==='booked')&&(t.source==='clinic'||t.source==='laboratory')).map(t=>({id:t.id,title:t.title,dueAt:t.dueAt})),
 };
}
