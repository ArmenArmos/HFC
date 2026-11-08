import {z} from 'zod';

export const DOC_TYPES=['lab','ecg','echocg','duplex','ct_calcium','discharge','prescription','other']as const;
export const documentTile=z.strictObject({id:z.uuid(),fileName:z.string().max(200),mime:z.enum(['application/pdf','image/jpeg','image/png']),
 docType:z.enum(DOC_TYPES).nullable(),studyDate:z.iso.date().nullable(),uploaderRole:z.enum(['member','nurse','doctor','admin']).nullable(),
 readStatus:z.enum(['not_read','read']),classificationConfidence:z.number().min(0).max(1).nullable()});
export type DocumentTile=z.infer<typeof documentTile>;
export const documentSnapshot=z.strictObject({v:z.literal(1),document:documentTile.nullable()});
export const documentInput=z.strictObject({cardId:z.uuid(),opId:z.uuid(),docType:z.enum(DOC_TYPES),studyDate:z.iso.date().nullable(),medicineChangedSince:z.union([z.boolean(),z.literal('UNKNOWN')])});
export type DocumentInput=z.infer<typeof documentInput>;
export type SavedDocument={docType:typeof DOC_TYPES[number];studyDate:string|null;medicineChangedSince:boolean|'UNKNOWN';fresh:boolean};
export const labAppointmentSnapshot=z.strictObject({v:z.literal(1),appointmentId:z.uuid(),revision:z.number().int().nonnegative(),startsAt:z.iso.datetime({offset:true}),location:z.string().max(1000),preparation:z.string().max(8000)});
export type LabAppointment=z.infer<typeof labAppointmentSnapshot>;
export const labReplyInput=z.strictObject({cardId:z.uuid(),opId:z.uuid(),answer:z.enum(['read','fasting','ate'])});
export type LabReplyInput=z.infer<typeof labReplyInput>;
export const symptomGateSnapshot=z.strictObject({v:z.literal(1)});
export const symptomGateInput=z.strictObject({cardId:z.uuid(),opId:z.uuid(),choice:z.enum(['planned','acute']),locale:z.enum(['hy','en','ru'])});
export const QUESTION_GROUPS=['symptoms','medicines','results']as const;
export const questionGroup=z.strictObject({label:z.enum(QUESTION_GROUPS),text:z.string().trim().max(1000)});
export const consultQuestionsSnapshot=z.strictObject({v:z.literal(1),appointmentId:z.uuid().nullable(),groups:z.array(questionGroup).min(2).max(3)});
export const consultQuestionsInput=z.strictObject({cardId:z.uuid(),opId:z.uuid(),locale:z.enum(['hy','en','ru']),groups:z.array(questionGroup).min(2).max(3)})
 .refine(v=>new Set(v.groups.map(g=>g.label)).size===v.groups.length&&v.groups.some(g=>g.text.length>0));
