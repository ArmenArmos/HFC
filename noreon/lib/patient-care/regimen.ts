import {z} from 'zod';
import type {DraftMedicine} from '@/lib/service-workflow/publication';
/** A published regimen and what changed from the version before, as stored at publication (20261030210000).
 * The comparison lives only in the database, so a screen shows what was recorded and never works it out again. */
const medicine=z.strictObject({name:z.string(),dose:z.string(),instructions:z.string(),times:z.array(z.string())});
export const regimenChangeSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('started'),name:z.string(),dose:z.string(),times:z.array(z.string()),instructions:z.string()}),
 z.strictObject({kind:z.literal('stopped'),name:z.string(),dose:z.string(),times:z.array(z.string())}),
 z.strictObject({kind:z.literal('dose_changed'),name:z.string(),fromDose:z.string(),toDose:z.string()}),
 z.strictObject({kind:z.literal('schedule_changed'),name:z.string(),fromTimes:z.array(z.string()),toTimes:z.array(z.string())}),
 z.strictObject({kind:z.literal('instructions_changed'),name:z.string(),fromInstructions:z.string(),toInstructions:z.string()}),
]);
export const regimenVersionSchema=z.strictObject({planId:z.uuid(),version:z.number().int().positive(),publishedAt:z.string(),changeSummary:z.string().nullable(),current:z.boolean(),medicines:z.array(medicine),changes:z.array(regimenChangeSchema)});
export const memberRegimensSchema=z.strictObject({version:z.literal('plan-regimens-v1'),enabled:z.boolean(),versions:z.array(regimenVersionSchema)});
export const doctorRegimenReviewSchema=z.strictObject({version:z.literal('regimen-review-v1'),enabled:z.boolean(),versions:z.array(regimenVersionSchema),
 draft:z.strictObject({medicines:z.array(medicine),changes:z.array(regimenChangeSchema),approvalHash:z.string().regex(/^[a-f0-9]{32}$/)}).nullable()});
export type RegimenChange=z.infer<typeof regimenChangeSchema>;
export type RegimenMedicine=z.infer<typeof medicine>;
export type RegimenVersion=z.infer<typeof regimenVersionSchema>;
export type DoctorRegimenReview=z.infer<typeof doctorRegimenReviewSchema>;
/** One editor row, with the times as the doctor types them. */
export type RegimenRow={name:string;dose:string;instructions:string;times:string};
type DraftShape={medicines?:DraftMedicine[];medicationName:string;medicationDose:string;medicationInstructions:string;medicationTimes:string[]};
/** A saved draft as editor rows. A one-medicine draft opens as one row. */
export function regimenRows(draft:DraftShape|null|undefined):RegimenRow[]{
 if(!draft)return [];
 if(draft.medicines)return draft.medicines.map(m=>({name:m.name,dose:m.dose,instructions:m.instructions,times:m.times.join(', ')}));
 return draft.medicationName.trim()?[{name:draft.medicationName,dose:draft.medicationDose,instructions:draft.medicationInstructions,times:draft.medicationTimes.join(', ')}]:[];
}
