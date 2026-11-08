import {z} from 'zod';
import {testById} from '@/lib/clinical/seed/tests';

/** Nurse visit action list and completion, as returned by the nurse_visit_* database functions.
 * The database builds the items from the member's data and enforces every rule; these schemas
 * only refuse a response that is not the shape the screens expect. */
export const nurseVisitVersion='nurse-visit-v1' as const;
/** Existing scalar acceptance bounds for nurse visit measurements. */
export const nurseScalarMeasurementRanges={weight:[20,400],waist:[30,250]} as const;
export const nurseVisitSources=['home-request','appointment'] as const;
export type NurseVisitSource=typeof nurseVisitSources[number];
const uuid=z.uuid(),instant=z.iso.datetime({offset:true}),day=z.iso.date();
const name=z.string().min(1).max(500);
const arrangementToken=z.string().min(1).max(100);
export const nurseVisitSteps=['confirmed','started','samples-collected','samples-at-lab','completed'] as const;
export type NurseVisitStep=typeof nurseVisitSteps[number];
const staffStep=z.strictObject({step:z.enum(nurseVisitSteps),at:instant,by:name});
const summary=z.strictObject({samplesPlanned:z.number().int().nonnegative(),samplesTaken:z.number().int().nonnegative(),bpTaken:z.boolean(),deviceDone:z.boolean().nullable(),openItems:z.array(z.string())});
export const nurseVisitRowSchema=z.strictObject({
 source:z.enum(nurseVisitSources),id:uuid,memberId:uuid,memberName:name,arrangementToken,
 startsAt:instant,endsAt:instant.nullable(),mode:z.enum(['home','clinic','office']),location:z.string().max(1000).nullable(),clinic:z.string().max(500).nullable().optional(),
 bookingStatus:z.enum(['confirmed','completed','attended','cancelled']),
 completion:z.strictObject({completedAt:instant,nurseName:name,summary}).nullable(),
});
export const nurseVisitListRowSchema=nurseVisitRowSchema.extend({samplesPlanned:z.number().int().nonnegative(),samplesTaken:z.number().int().nonnegative(),openItems:z.number().int().nonnegative(),steps:z.array(staffStep),nurseName:name.nullable()});
export const nurseVisitListSchema=z.discriminatedUnion('enabled',[
 z.strictObject({version:z.literal(nurseVisitVersion),enabled:z.literal(false),visits:z.array(z.never())}),
 z.strictObject({version:z.literal(nurseVisitVersion),enabled:z.literal(true),today:day,role:z.enum(['nurse','admin']),visits:z.array(nurseVisitListRowSchema)}),
]);
/** The list envelope with rows left unparsed, so one bad row is skipped rather than failing the list (review F5). */
export const nurseVisitListEnvelopeSchema=z.discriminatedUnion('enabled',[
 z.strictObject({version:z.literal(nurseVisitVersion),enabled:z.literal(false),visits:z.array(z.never())}),
 z.strictObject({version:z.literal(nurseVisitVersion),enabled:z.literal(true),today:day,role:z.enum(['nurse','admin']),visits:z.array(z.unknown())}),
]);
const bpValues=z.strictObject({systolic:z.number().int(),diastolic:z.number().int(),pulse:z.number().int().nullable()});
const oneValue=z.strictObject({value:z.number()});
const markValues=z.union([bpValues,oneValue]);
const mark=z.strictObject({collectionStatus:z.enum(['collected','not-collected','issue']).nullable().optional(),done:z.boolean(),note:z.string().max(1000).nullable(),values:markValues.nullable(),recordedAt:instant,nurseName:name}).nullable();
export const nurseCommentMax=1000;
export const nurseVisitItemSchema=z.discriminatedUnion('kind',[
 z.strictObject({key:z.string().regex(/^sample:/),kind:z.literal('sample'),testId:z.string().min(1).max(100),title:z.string().min(1).max(500),mark}),
 z.strictObject({key:z.enum(['measure:bp','measure:weight','measure:waist']),kind:z.literal('measurement'),field:z.enum(['bp','weight','waist']),mark}),
 z.strictObject({key:z.string().regex(/^device:/),kind:z.literal('device'),assignmentId:uuid,serial:z.string().min(1).max(64),model:z.string().min(1).max(120),mark}),
 z.strictObject({key:z.string().regex(/^check:/),kind:z.literal('check'),checkId:z.string().min(1).max(60),section:z.enum(['bp','safety','sampling']),version:z.string().min(3).max(40),label:z.strictObject({en:z.string().min(1),hy:z.string().min(1)}),source:z.string().min(3).max(300),mark}),
]);
export const nurseVisitDetailSchema=z.union([
 z.strictObject({version:z.literal(nurseVisitVersion),enabled:z.literal(false)}),
 z.strictObject({version:z.literal(nurseVisitVersion),status:z.enum(['access','unavailable'])}),
 z.strictObject({version:z.literal(nurseVisitVersion),enabled:z.literal(true),visit:nurseVisitRowSchema,items:z.array(nurseVisitItemSchema),counts:summary,
  steps:z.array(staffStep),checklistVersion:z.string().min(3).max(40),caseRevision:z.number().int().nonnegative(),today:day,
  completion:z.strictObject({completedAt:instant,nurseName:name,reason:z.string().max(1000).nullable(),summary,visitId:uuid}).nullable()}),
]);
export const nurseVisitMarkCommandSchema=z.strictObject({
 version:z.literal(nurseVisitVersion),memberId:uuid,source:z.enum(nurseVisitSources),sourceId:uuid,submissionId:uuid,
 startsAt:instant.optional(),checklistVersion:z.string().min(3).max(40).optional(),
 /** The chat's typed reading: refuse (already-marked) instead of replacing a measurement marked since the card was prepared. */
 expectUnmarked:z.boolean().optional(),
 /** Section All done: refuse any saved answer, including Not done or a comment. */
 expectUnanswered:z.boolean().optional(),
 item:z.string().regex(/^(sample:[A-Za-z0-9._-]{1,100}|measure:(bp|weight|waist)|device:[0-9a-f-]{36}|check:[a-z0-9-]{1,60})$/),done:z.boolean(),
 note:z.string().trim().max(nurseCommentMax).nullable(),values:markValues.nullable(),
}).superRefine((command,ctx)=>{
 const measure=command.item.startsWith('measure:');
 if(!measure||!command.done){if(command.values)ctx.addIssue({code:'custom',message:'Values belong to a taken measurement only',path:['values']});return;}
 const v=command.values;
 if(!v){ctx.addIssue({code:'custom',message:'Enter the measurement',path:['values']});return;}
 if(command.item==='measure:bp'){
  if(!('systolic'in v)){ctx.addIssue({code:'custom',message:'Enter the blood pressure',path:['values']});return;}
  if(v.systolic<60||v.systolic>300||v.diastolic<30||v.diastolic>200||v.systolic<=v.diastolic)ctx.addIssue({code:'custom',message:'Check the blood pressure values',path:['values']});
  if(v.pulse!==null&&(v.pulse<20||v.pulse>250))ctx.addIssue({code:'custom',message:'Check the pulse',path:['values','pulse']});
  return;
 }
 const [lo,hi]=nurseScalarMeasurementRanges[command.item==='measure:weight'?'weight':'waist'];
 if(!('value'in v)||v.value<lo||v.value>hi)ctx.addIssue({code:'custom',message:'Check the measurement',path:['values']});
});
/** A collection command has one explicit intent; exceptions always carry a short reason. */
const collectBase={version:z.literal(nurseVisitVersion),memberId:uuid,source:z.enum(nurseVisitSources),sourceId:uuid,submissionId:uuid,expectedRevision:z.number().int().nonnegative(),arrangementToken};
export const nurseVisitCollectCommandSchema=z.union([
 z.strictObject({...collectBase,all:z.literal(true)}),
 z.strictObject({...collectBase,testId:z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),status:z.enum(['collected','not-collected','issue']),reason:z.string().trim().max(300).nullable()}).refine(command=>command.status==='collected'?command.reason===null:Boolean(command.reason?.length),{message:'Enter a reason',path:['reason']}),
]);
export const nurseVisitCollectResultSchema=z.union([
 z.strictObject({status:z.literal('saved'),submissionId:uuid,replayed:z.boolean()}),
 z.strictObject({status:z.enum(['invalid','stale','access','unavailable','disabled','completed','too-early','cancelled','outcome-unknown'])}),
]);
export type NurseVisitCollectCommand=z.infer<typeof nurseVisitCollectCommandSchema>;
export type NurseVisitCollectResult=z.infer<typeof nurseVisitCollectResultSchema>;
export const nurseVisitStepCommandSchema=z.strictObject({version:z.literal(nurseVisitVersion),memberId:uuid,source:z.enum(nurseVisitSources),sourceId:uuid,submissionId:uuid,step:z.enum(['confirmed','started','samples-collected','samples-at-lab'])});
export const nurseVisitStepResultSchema=z.union([
 z.strictObject({status:z.literal('saved'),eventId:uuid,submissionId:uuid,occurredAt:instant,replayed:z.boolean()}),
 z.strictObject({status:z.literal('already-recorded'),occurredAt:instant}),
 z.strictObject({status:z.enum(['invalid','stale','access','unavailable','disabled','completed','too-early','no-samples','no-lab-entries','pending-samples','outcome-unknown'])}),
]);
export const nurseVisitCompleteCommandSchema=z.strictObject({
 version:z.literal(nurseVisitVersion),memberId:uuid,source:z.enum(nurseVisitSources),sourceId:uuid,submissionId:uuid,visitId:uuid,
 openSubmissionId:uuid,appendSubmissionId:uuid,reason:z.string().trim().max(1000).nullable(),
});
export const nurseVisitMarkResultSchema=z.union([
 z.strictObject({status:z.literal('saved'),markId:uuid,submissionId:uuid,replayed:z.boolean()}),
 z.strictObject({status:z.enum(['invalid','stale','access','unavailable','disabled','completed','too-early','outcome-unknown','already-marked'])}),
]);
export const nurseVisitCompleteResultSchema=z.union([
 z.strictObject({status:z.literal('saved'),submissionId:uuid,visitId:uuid,summary,replayed:z.boolean()}),
 z.strictObject({status:z.literal('reason-required'),openItems:z.array(z.string())}),
 z.strictObject({status:z.enum(['invalid','stale','access','unavailable','disabled','completed','too-early','booking-stale','pending-samples','outcome-unknown'])}),
]);
/** Doctor, nurse and admin view of a member's nurse visits. Admins get items without values. */
export const nurseVisitRecordSchema=z.union([
 z.strictObject({version:z.literal(nurseVisitVersion),status:z.enum(['access','unavailable'])}),
 z.strictObject({version:z.literal(nurseVisitVersion),enabled:z.boolean(),visits:z.array(z.strictObject({visit:nurseVisitRowSchema,steps:z.array(staffStep),items:z.array(nurseVisitItemSchema),
  completion:z.strictObject({completedAt:instant,nurseName:name,reason:z.string().max(1000).nullable(),summary}).nullable()}))}),
]);
const memberStep=z.strictObject({step:z.enum(['confirmed','samples-collected','samples-at-lab','completed']),at:instant});
export const memberNurseVisitSchema=z.strictObject({version:z.literal(nurseVisitVersion),visit:z.strictObject({startsAt:instant,mode:z.enum(['home','clinic','office']),steps:z.array(memberStep),
 completedAt:instant.nullable(),samplesTaken:z.number().int().nonnegative().nullable(),samplesPlanned:z.number().int().nonnegative().nullable()}).nullable()});

export type NurseVisitRow=z.infer<typeof nurseVisitRowSchema>;
export type NurseVisitList=z.infer<typeof nurseVisitListSchema>;
export type NurseVisitItem=z.infer<typeof nurseVisitItemSchema>;
export type NurseVisitDetail=z.infer<typeof nurseVisitDetailSchema>;
export type NurseVisitReady=Extract<NurseVisitDetail,{enabled:true}>;
export type NurseVisitMarkCommand=z.infer<typeof nurseVisitMarkCommandSchema>;
export type NurseVisitCompleteCommand=z.infer<typeof nurseVisitCompleteCommandSchema>;
export type NurseVisitMarkResult=z.infer<typeof nurseVisitMarkResultSchema>;
export type NurseVisitCompleteResult=z.infer<typeof nurseVisitCompleteResultSchema>;
export type NurseVisitRecord=z.infer<typeof nurseVisitRecordSchema>;
export type NurseVisitStepCommand=z.infer<typeof nurseVisitStepCommandSchema>;
export type NurseVisitStepResult=z.infer<typeof nurseVisitStepResultSchema>;
export type StaffStep=z.infer<typeof staffStep>;
export type MemberNurseVisit=z.infer<typeof memberNurseVisitSchema>['visit'];

/** The sample kind the catalogue gives for a test, or null when the catalogue has none. The
 * catalogue has no tube type yet (QUESTIONS Q-NV2), so none is shown. */
export function sampleKind(testId:string):'blood'|'urine'|null{
 const method=testById(testId)?.method;
 return method==='blood_draw'?'blood':method==='urine_sample'?'urine':null;
}
