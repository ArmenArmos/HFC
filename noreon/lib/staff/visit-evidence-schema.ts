import type{Locale}from'@/lib/locale';
import {z} from 'zod';
import {nurseScalarMeasurementRanges} from '@/lib/nurse-visit/schema';
import {nurseBookingContextSchema} from '@/lib/real-booking/visit-context-schema';

export const visitVersion='visit-evidence-v1' as const;
const uuid=z.uuid(),revision=z.number().int().nonnegative().safe();
const instant=z.iso.datetime({offset:true});
const text=z.string().trim().min(1).max(2000);
export const observationFields=['height','weight','systolic','diastolic','pulse','waist','neck','temperature'] as const;
export const observationUnits={height:'cm',weight:'kg',systolic:'mmHg',diastolic:'mmHg',pulse:'beats/min',waist:'cm',neck:'cm',temperature:'C'} as const;
/** Advice for permissive staff observations, using the existing nurse bounds only.
 * It does not change command validation or add clinical interpretation. */
export function observationNeedsRecheck(field:typeof observationFields[number],value:number):boolean{
 if(field!=='weight'&&field!=='waist')return false;
 const [min,max]=nurseScalarMeasurementRanges[field];
 return Number.isFinite(value)&&(value<min||value>max);
}
const field=z.enum(observationFields);
const observation=z.discriminatedUnion('state',[
 z.strictObject({kind:z.literal('observation'),field,observedAt:instant,state:z.literal('known'),value:z.number().finite(),unit:z.enum(['cm','kg','mmHg','beats/min','C'])}),
 z.strictObject({kind:z.literal('observation'),field,observedAt:instant,state:z.literal('unknown'),reason:text}),
]).superRefine((entry,ctx)=>{
 if(entry.state!=='known')return;
 if(entry.unit!==observationUnits[entry.field])ctx.addIssue({code:'custom',message:'Use the canonical field unit',path:['unit']});
});
const collection=z.strictObject({kind:z.literal('collection'),observedAt:instant,appointmentId:uuid,acceptedRevision:revision,testId:z.string().min(1).max(100),outcome:z.enum(['collected','not-collected','unknown']),reason:text.optional()}).superRefine((entry,ctx)=>{
 if(entry.outcome!=='collected'&&!entry.reason)ctx.addIssue({code:'custom',message:'Record a reason',path:['reason']});
});
export const visitPayloadSchema=z.union([observation,collection,z.strictObject({kind:z.literal('note'),observedAt:instant,text})]);
const booking=z.strictObject({appointmentId:uuid,acceptedRevision:revision});
const envelope={version:z.literal(visitVersion),id:uuid,revision,submissionId:uuid,visitId:uuid};
export const visitCommandSchema=z.discriminatedUnion('op',[
 z.strictObject({...envelope,op:z.literal('open-visit'),booking:booking.nullable()}),
 z.strictObject({...envelope,op:z.literal('append-evidence'),entries:z.array(visitPayloadSchema).min(1).max(128)}),
]).superRefine((command,ctx)=>{
 if(command.op!=='append-evidence')return;
 const seen=new Set<string>();
 command.entries.forEach((entry,index)=>{
  const key=entry.kind==='observation'?`field:${entry.field}`:entry.kind==='collection'?`test:${entry.testId}`:null;
  if(key&&seen.has(key))ctx.addIssue({code:'custom',message:'Record each field or test once per submission',path:['entries',index]});
  if(key)seen.add(key);
 });
 const systolic=command.entries.find(entry=>entry.kind==='observation'&&entry.field==='systolic'&&entry.state==='known');
 const diastolic=command.entries.find(entry=>entry.kind==='observation'&&entry.field==='diastolic'&&entry.state==='known');
 if(systolic?.kind==='observation'&&systolic.state==='known'&&diastolic?.kind==='observation'&&diastolic.state==='known'){
  if(!Number.isInteger(systolic.value)||systolic.value<60||systolic.value>300||!Number.isInteger(diastolic.value)||diastolic.value<30||diastolic.value>200)ctx.addIssue({code:'custom',message:'Check the complete blood pressure pair',path:['entries']});
  const pulse=command.entries.find(entry=>entry.kind==='observation'&&entry.field==='pulse'&&entry.state==='known'&&Date.parse(entry.observedAt)===Date.parse(systolic.observedAt));
  if(pulse?.kind==='observation'&&pulse.state==='known'&&(!Number.isInteger(pulse.value)||pulse.value<20||pulse.value>250))ctx.addIssue({code:'custom',message:'Check pulse accompanying the blood pressure pair',path:['entries']});
  if(systolic.value<=diastolic.value)ctx.addIssue({code:'custom',message:'Systolic must exceed diastolic',path:['entries']});
  if(Date.parse(systolic.observedAt)!==Date.parse(diastolic.observedAt))ctx.addIssue({code:'custom',message:'A blood pressure pair must share its observed instant',path:['entries']});
 }
});
export const visitEntrySchema=z.strictObject({id:uuid,submissionId:uuid,observedAt:instant,observedInstant:instant,recordedAt:instant,actor:z.strictObject({id:uuid,name:z.string().min(1).max(500),role:z.enum(['nurse','doctor']),clinicId:uuid.nullable()}),source:z.literal('staff-entered'),payload:visitPayloadSchema,measurementId:uuid.nullable()}).superRefine((entry,ctx)=>{
 if(Date.parse(entry.observedAt)!==Date.parse(entry.observedInstant)||Date.parse(entry.observedAt)!==Date.parse(entry.payload.observedAt))ctx.addIssue({code:'custom',message:'Observation timestamps must identify the same instant'});
});
export const careVisitSchema=z.strictObject({id:uuid,createdAt:instant,bookingContext:nurseBookingContextSchema.nullable(),entries:z.array(visitEntrySchema)});
export const visitReadSchema=z.strictObject({version:z.literal(visitVersion),memberId:uuid,revision,bookingContext:nurseBookingContextSchema.nullable(),collectionAvailability:z.enum(['available','unlinked','stale','unavailable']),visits:z.array(careVisitSchema)}).superRefine((read,ctx)=>{
 if(read.collectionAvailability==='available'&&!read.bookingContext)ctx.addIssue({code:'custom',message:'Available collection needs accepted booking context'});
});
export const visitCommandResultSchema=z.discriminatedUnion('status',[
 z.strictObject({status:z.literal('saved'),submissionId:uuid,visitId:uuid,revision,entryIds:z.array(uuid),replayed:z.boolean()}),
 z.strictObject({status:z.literal('invalid'),issues:z.array(z.strictObject({path:z.string().max(200),message:z.string().max(500)})).min(1)}),
 z.strictObject({status:z.enum(['stale','access','unavailable','outcome-unknown'])}),
]);
// Implementing ports must serialize receipt recovery against the original command.
// A generic read/not-found is NOT proof of a definitely-not-recorded result.
// Backend must commit a same-key/payload/actor terminal retirement fence first.
export const visitRefreshResultSchema=z.discriminatedUnion('status',[
 z.strictObject({status:z.literal('loaded'),data:visitReadSchema,receipt:z.discriminatedUnion('status',[
  z.strictObject({status:z.literal('committed'),submissionId:uuid,visitId:uuid,revision,entryIds:z.array(uuid)}),
  z.strictObject({status:z.literal('not-recorded'),submissionId:uuid,serialized:z.literal(true)}),
  z.strictObject({status:z.literal('unknown'),submissionId:uuid}),
 ]).nullable()}),
 z.strictObject({status:z.enum(['access','unavailable'])}),
]);
export type VisitCommand=z.infer<typeof visitCommandSchema>;
export type VisitPayload=z.infer<typeof visitPayloadSchema>;
export type VisitEntry=z.infer<typeof visitEntrySchema>;
export type CareVisit=z.infer<typeof careVisitSchema>;
export type VisitRead=z.infer<typeof visitReadSchema>;
export type VisitCommandResult=z.infer<typeof visitCommandResultSchema>;
export type VisitRefreshResult=z.infer<typeof visitRefreshResultSchema>;
export type VisitCommandPort=(input:VisitCommand)=>Promise<VisitCommandResult>;
export const visitRefreshInputSchema=z.strictObject({id:uuid,visitId:uuid,command:visitCommandSchema.nullable()}).superRefine((input,ctx)=>{
 if(input.command&&(input.command.id!==input.id||input.command.visitId!==input.visitId))ctx.addIssue({code:'custom',message:'Recovery must match the frozen member and visit'});
});
export type VisitRefreshInput=z.infer<typeof visitRefreshInputSchema>;
/** Recovery never executes command. The guarded backend compares the full frozen
 * identity/payload and commits a retired-key fence before claiming not-recorded,
 * so a delayed original HTTP command cannot execute after that response. */
export type VisitRefreshPort=(input:VisitRefreshInput)=>Promise<VisitRefreshResult>;
/** Technical IDs are server supplied and retained until a draft is explicitly
 * resolved. actorScope is a session/context fence, never client authority. */
export type VisitEvidenceProps={data:VisitRead;locale:Locale;actorScope:string;canRecord:boolean;visitId:string;openSubmissionId:string;appendSubmissionId:string;command:VisitCommandPort;refresh:VisitRefreshPort};
