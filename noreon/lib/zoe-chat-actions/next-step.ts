import {LAB_ANALYTES} from '@/lib/lab-ai/catalogue';
import {z} from 'zod';
import {memberJourneyStep,type JourneyInput} from '@/lib/patient/next-step';
import {JOURNEY_STAGES,journeyStage,type JourneyOptions} from '@/lib/patient/journey-stage';
import {labIsFresh} from '@/lib/clinical/zones/evaluate';
import {memberCatalogSchema} from '@/lib/pilot-commerce/schema';
import {NEXT_STEP} from './next-step-copy';

const words=z.strictObject({en:z.string(),hy:z.string(),ru:z.string()});
export const NEXT_TARGETS=['tests_needed','visit','results','plan','message','review']as const;
export const nextStepSnapshot=z.strictObject({v:z.literal(1),stage:z.string().min(1).max(1000),journeyStage:z.enum(JOURNEY_STAGES).optional(),title:words,detail:words,button:words,target:z.enum(NEXT_TARGETS).nullable(),doctorInLoop:z.boolean()});
export type NextStep=z.infer<typeof nextStepSnapshot>;
export const testsNeededSnapshot=z.strictObject({v:z.literal(1),available:z.boolean(),rows:z.array(z.strictObject({id:z.string(),title:z.string(),name:words.optional(),method:z.enum(['lab','clinic','home-log']),fresh:z.boolean()})),pricing:z.object({catalog:memberCatalogSchema.shape.tests}).optional()});
type Options=JourneyOptions&{unavailable?:boolean};
/** Presentation adapter only. All pre-plan precedence is the same rule the home calls. */
export function chatNextStep(input:JourneyInput,options:Options):NextStep{
 const action=memberJourneyStep(input);
 const prior={v:1 as const,stage:`${options.episode}:${options.revision??''}:${action?.id??'waiting'}`,title:NEXT_STEP.title,detail:NEXT_STEP.waiting,button:NEXT_STEP.title,target:null,doctorInLoop:false};
 if(options.unavailable)return {...prior,detail:NEXT_STEP.unavailable};
 const stage=journeyStage(input,options);
 // Saved cards replay by identity, so retire the older results-ready promises too.
 const approvalHold=action?.href==='/patient/results'||(stage==='results_waiting'&&options.resultsReleased);
 const base={...prior,stage:approvalHold?`${prior.stage}:plan-approval`:prior.stage,journeyStage:stage};
 if(stage==='plan_published'||stage==='plan_confirmed')return {...base,stage:`${options.episode}:plan:${options.planId}:${stage==='plan_confirmed'?'confirmed':'published'}`,detail:stage==='plan_confirmed'?NEXT_STEP.confirmed:NEXT_STEP.plan,button:NEXT_STEP.openPlan,target:stage==='plan_confirmed'?null:'plan'};
 if(stage==='questionnaire_open')return base;
 if(stage==='results_waiting'&&options.resultsReleased)return {...base,detail:NEXT_STEP.waitingResults,target:'results',button:{en:'See test status',hy:'Տեսնել հետազոտության կարգավիճակը',ru:'Посмотреть статус анализов'}};
 if(!action)return base;
 const target:NextStep['target']=stage==='review_needed'?'review':stage==='consultation'?'message':stage==='tests_to_choose'?'tests_needed':action.href==='/patient/service'?'visit':action.href==='/patient/results'?'results':null;
 const waiting=action.href==='/patient/results';
 return {...base,title:action.title,detail:waiting?NEXT_STEP.waitingResults:action.detail,button:target==='tests_needed'?NEXT_STEP.seeTests:target==='message'?NEXT_STEP.message:action.button,target,
  // Opening tests or booking is not journey progress. Reuse that stage's saved target chain.
  stage:base.stage,
  doctorInLoop:action.id==='journey-results'&&stage==='review_pending'};
}
export type FreshTest={testId:string;collectedOn:string|null;medicineChangedSince:boolean|null};
/** Exact test identities only. A dated upload does not prove which analytes it contains. */
export function testsNeeded(required:readonly {id:string;title:string;method:'lab'|'clinic'|'home-log'}[],saved:readonly FreshTest[],today:string):z.infer<typeof testsNeededSnapshot>{
 return {v:1,available:true,rows:required.map(t=>({...t,fresh:t.method==='lab'&&saved.some(s=>s.testId===t.id&&labIsFresh({collectedOn:s.collectedOn,today,analyte:t.id,medicineChangedSince:s.medicineChangedSince}).fresh)})).filter(t=>!t.fresh)};
}

/** Catalogue row names on planned tests map to the existing reader's analyte keys. A panel needs every key. */
export function hasTestCoverage(refs:string|readonly string[]|undefined,keys:readonly (string|null)[]):boolean{
 const rows=typeof refs==='string'?[refs]:refs??[];
 return rows.length>0&&rows.every(row=>{const analytes=LAB_ANALYTES.filter(a=>a.row===row);return analytes.length>0&&analytes.every(a=>keys.includes(a.key));});
}
