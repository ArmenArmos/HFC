import {z} from 'zod';
/** QA 174: a required result received from values a doctor confirmed on a current clinic lab result,
 * kept as they were received (20261029211406). Publication refuses it once those values change. */
export const clinicLabValueSchema=z.object({id:z.uuid(),seq:z.number().int(),reviewedAt:z.string(),name:z.string(),valueText:z.string(),value:z.number().nullable(),unit:z.string().nullable(),reference:z.string().nullable(),collectedOn:z.string(),laboratory:z.string().nullable()});
export const clinicLabReceiptSchema=z.object({source:z.literal('clinic-lab'),attachmentId:z.uuid(),values:z.array(clinicLabValueSchema).min(1),note:z.string(),actorId:z.uuid(),at:z.string()});
export type ClinicLabValue=z.infer<typeof clinicLabValueSchema>;
export type ClinicLabReceipt=z.infer<typeof clinicLabReceiptSchema>;
export const isClinicLabReceipt=(receipt:object):receipt is ClinicLabReceipt=>'source' in receipt&&receipt.source==='clinic-lab';
/** A doctor's confirmation of a required clinic or home test (20261031123000). It holds a copy of its source;
 * publication refuses it once the source no longer matches. Kept apart from receipts, which members can read. */
export const evidenceReceiptSchema=z.object({source:z.enum(['investigation','bp-week','bp-reading','body-measures']),sourceId:z.uuid(),snapshot:z.record(z.string(),z.unknown()),actorId:z.uuid(),at:z.string()});
export type EvidenceReceipt=z.infer<typeof evidenceReceiptSchema>;
export const clinicalReviewSchema=z.object({evidenceToken:z.string(),doctorId:z.uuid(),preparedAt:z.string(),engine:z.object({version:z.string(),urgency:z.enum(['green','yellow','orange']),tests:z.array(z.object({id:z.string(),title:z.string(),method:z.enum(['lab','clinic','home-log'])}).passthrough())}),approvals:z.record(z.string(),z.object({revision:z.number(),actorId:z.uuid(),at:z.string()})),receipts:z.record(z.string(),z.union([clinicLabReceiptSchema,z.object({reportId:z.uuid(),reportRevision:z.number(),rows:z.array(z.number()),note:z.string(),actorId:z.uuid(),at:z.string()})])),evidenceReceipts:z.record(z.string(),evidenceReceiptSchema).optional(),consultation:z.object({decision:z.enum(['undecided','required','not-required']),note:z.string().optional(),completedAt:z.string().optional(),mode:z.string().optional(),completionNote:z.string().optional()}).passthrough()});
