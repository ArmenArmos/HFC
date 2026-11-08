import {z} from 'zod';
/** Doctor reads and commands for AI-read lab values. Every value shown is labelled with its review status. */
export const labReviewVersion='lab-ai-review-v1' as const;
export const labIdentityVersion='lab-ai-identity-v1' as const;
const uuid=z.uuid(),instant=z.iso.datetime({offset:true}),day=z.iso.date();
const num=z.number();
const counts=z.object({total:z.number().int(),unverified:z.number().int(),verified:z.number().int(),autoAccepted:z.number().int().default(0),rejected:z.number().int(),attention:z.number().int()});
const calls=z.object({count:z.number().int(),costUsd:num,models:z.array(z.string())});
const jobBase=z.object({jobId:uuid,fileId:uuid,state:z.enum(['queued','running','done','rejected','failed']),outcome:z.string().nullable(),attempts:z.number().int(),pageCount:z.number().int().nullable(),
 identityStatus:z.enum(['match','unknown','mismatch','multiple_patients']).nullable(),identityConfirmedAt:instant.nullable(),identityNote:z.string().nullable(),
 provider:z.string().nullable(),model:z.string().nullable(),createdAt:instant,finishedAt:instant.nullable(),counts,calls});
export const identitySchema=z.object({nameOnSheet:z.string().nullable(),birthDateOnSheet:day.nullable(),sampleDate:day.nullable(),patientsSeen:z.number().int(),
 nameMatch:z.enum(['yes','no','unknown']),birthDateMatch:z.enum(['yes','no','unknown'])});
const narrative=z.object({en:z.string(),hy:z.string()});
export const summarySchema=z.object({version:z.literal('lab-ai-summary-v1'),label:z.literal('Prepared by AI | Not reviewed by a doctor'),preparedBy:z.literal('ai'),reviewedByDoctor:z.literal(false),valuesVerified:z.literal(false),
 priority:z.array(z.object({testName:z.string(),reason:z.enum(['threshold','lab_critical','needs_doctor']),rule:z.string().nullable(),valueText:z.string(),unit:z.string().nullable(),page:z.number().int()})),
 changed:z.array(z.object({analyte:z.string(),testName:z.string(),latest:z.object({valueText:z.string(),unit:z.string().nullable(),date:z.string().nullable()}),previous:z.object({value:num,unit:z.string().nullable(),date:z.string().nullable()}),direction:z.enum(['up','down','same'])})),
 outOfRange:z.array(z.object({testName:z.string(),valueText:z.string(),unit:z.string().nullable(),refText:z.string().nullable(),labFlag:z.string().nullable(),page:z.number().int()})),
 missingForPlan:z.array(z.object({testId:z.string(),title:z.string()})),
 workup:z.object({found:z.array(z.string()),missing:z.array(z.string()),outOfRange:z.array(z.string())}).optional(),dataGaps:z.array(z.string()),narrative:narrative.nullable(),
 sources:z.object({pages:z.number().int(),method:z.literal('ai_document_reading'),model:z.string().nullable(),identityStatus:z.enum(['match','unknown','mismatch','multiple_patients'])})});
export const overviewSchema=z.object({version:z.literal('lab-ai-overview-v1'),enabled:z.boolean(),files:z.array(z.union([
 z.object({fileId:uuid,state:z.literal('not_requested')}),
 jobBase.extend({hasSummary:z.boolean()}),
]))});
export const labValueSchema=z.object({valueId:uuid,seq:z.number().int(),testName:z.string(),catalogueRef:z.string().nullable(),valueText:z.string(),value:num.nullable(),unit:z.string().nullable(),
 refLow:num.nullable(),refHigh:num.nullable(),refText:z.string().nullable(),labFlag:z.enum(['high','low','normal','abnormal','critical']).nullable(),collectedOn:day.nullable(),labName:z.string().nullable(),
 page:z.number().int(),snippet:z.string().nullable(),checks:z.array(z.string()),attention:z.enum(['threshold','lab_critical','needs_doctor']).nullable(),attentionRule:z.string().nullable(),
 status:z.enum(['unverified','auto_accepted','verified','corrected','rejected']),correctedValue:num.nullable(),correctedUnit:z.string().nullable(),reviewNote:z.string().nullable(),reviewedAt:instant.nullable(),reviewedByYou:z.boolean().nullable()});
export const labReadSchema=z.union([z.object({version:z.literal('lab-ai-read-v1'),enabled:z.literal(false)}),z.object({version:z.literal('lab-ai-read-v1'),enabled:z.literal(true),fileId:uuid,name:z.string(),clinic:z.string(),uploadedAt:instant,openedByYou:z.boolean(),
 job:jobBase.extend({identity:identitySchema.nullable(),summary:summarySchema.nullable()}).nullable(),values:z.array(labValueSchema)})]);
export const reviewCommandSchema=z.strictObject({version:z.literal(labReviewVersion),submissionId:uuid,memberId:uuid,valueId:uuid,action:z.enum(['confirm','correct','reject']),
 value:z.number().finite().gt(-1e9).lt(1e9).optional(),unit:z.string().trim().min(1).max(30).optional(),note:z.string().trim().min(1).max(300).optional()})
 .refine(c=>c.action==='correct'?c.value!==undefined:c.value===undefined&&c.unit===undefined);
export const reviewResultSchema=z.object({status:z.enum(['saved','stale','invalid','disabled','identity-first','open-first','unavailable','access','outcome-unknown']),valueStatus:z.string().optional(),replayed:z.boolean().optional()});
export const identityCommandSchema=z.strictObject({version:z.literal(labIdentityVersion),memberId:uuid,jobId:uuid,note:z.string().trim().min(1).max(300).optional()});
export const identityResultSchema=z.object({status:z.enum(['confirmed','unchanged','not-allowed','reason-required','open-first','stale','invalid','disabled','unavailable','access','outcome-unknown'])});
export const requestResultSchema=z.object({status:z.enum(['queued','unchanged','disabled','stale','unavailable','access','invalid']),state:z.string().optional()});
export type LabOverview=z.infer<typeof overviewSchema>;
export type LabRead=z.infer<typeof labReadSchema>;
export type LabValueRow=z.infer<typeof labValueSchema>;
export type LabSummaryRead=z.infer<typeof summarySchema>;
export type ReviewCommand=z.infer<typeof reviewCommandSchema>;
export type ReviewResult=z.infer<typeof reviewResultSchema>;
export type IdentityCommand=z.infer<typeof identityCommandSchema>;
export type IdentityResult=z.infer<typeof identityResultSchema>;
export type RequestResult=z.infer<typeof requestResultSchema>;

export const confirmPassingVersion='lab-ai-confirm-passing-v1' as const;
export const confirmPassingInputSchema=z.strictObject({memberId:uuid,fileId:uuid,submissionId:uuid});
export const confirmPassingCommandSchema=confirmPassingInputSchema.extend({version:z.literal(confirmPassingVersion)});
export const confirmPassingResultSchema=z.discriminatedUnion('status',[
 z.object({status:z.literal('saved'),replayed:z.boolean(),confirmed:z.number().int().nonnegative(),remaining:z.number().int().nonnegative()}),
 z.object({status:z.enum(['stale','invalid','disabled','identity-first','open-first','unavailable','access','outcome-unknown'])}),
]);
export type ConfirmPassingResult=z.infer<typeof confirmPassingResultSchema>;
