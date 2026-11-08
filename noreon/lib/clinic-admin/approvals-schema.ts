import {z} from 'zod';
const id=z.uuid(),stamp=z.iso.datetime({offset:true}),name=z.string().max(500);
const pair=z.strictObject({before:name.nullable(),after:name.nullable()});
const year=z.number().int().min(1800).max(2200).nullable();
const birthYear=z.strictObject({beforeYear:year,afterYear:year});
const birthFull=z.strictObject({beforeYear:year,afterYear:year,before:z.iso.date().nullable(),after:z.iso.date().nullable()});
const requestFields={id,clinicId:id,clinicName:name,kind:z.enum(['profile','care_team']),memberId:id,memberName:name,requesterName:name.nullable(),mine:z.boolean(),createdAt:stamp,decidedAt:stamp.nullable(),
 /** Optional until the database sends it (S1-12 migration), so this app can deploy first. */
 deciderName:name.nullable().optional(),state:z.enum(['pending','approved','rejected','cancelled','stale','expired']),decisionNote:z.string().max(500).nullable()};
const summaryFields={name:z.strictObject({before:name,after:name}).optional(),doctor:pair.optional(),nurse:pair.optional()};
export const clinicChangeRequestSchema=z.strictObject({...requestFields,summary:z.strictObject({...summaryFields,birthDate:birthYear.optional()})});
export const staffChangeRequestSchema=z.strictObject({...requestFields,summary:z.strictObject({...summaryFields,birthDate:birthFull.optional()})});
export type ChangeRequest=z.infer<typeof clinicChangeRequestSchema>|z.infer<typeof staffChangeRequestSchema>;
export const requestResultSchema=z.union([
 z.strictObject({status:z.enum(['pending','pending_exists']),requestId:id}),
 z.strictObject({status:z.enum(['unchanged','stale','invalid','disabled','not_enrolled','conflict','age-changes'])}),
 z.strictObject({status:z.literal('refused'),reason:z.literal('other_clinic').optional()}),
 z.strictObject({status:z.literal('rejected'),reason:z.enum(['doctor_unavailable','nurse_unavailable'])}),
]);
export const decisionInputSchema=z.strictObject({requestId:id,decision:z.enum(['approve','reject','cancel']),note:z.string().trim().max(500).optional()}).superRefine((v,c)=>{if(v.decision==='reject'&&(v.note?.length??0)<5)c.addIssue({code:'custom',path:['note'],message:'reason_required'});});
export const decisionResultSchema=z.strictObject({status:z.enum(['approved','rejected','cancelled','stale','expired','self_approval','refused','reason_required','invalid','disabled','not_pending'])});
export type DecisionOutcome=z.infer<typeof decisionResultSchema>['status']|'unavailable';
export type RequestList={status:'loaded';requests:ChangeRequest[]}|{status:'disabled'|'unavailable'|'refused'};
