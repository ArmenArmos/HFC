import {z} from 'zod';
/** Consultations a doctor asked for, arranged by a Noreon admin (lead decision 17 Oct 2026). */
export const consultationArrangeVersion='consultation-arrange-v1' as const;
const uuid=z.uuid(),instant=z.iso.datetime({offset:true});
export const consultationChannels=['phone','clinic'] as const;
export const arrangementSchema=z.strictObject({scheduledAt:instant,channel:z.enum(consultationChannels),clinic:z.string().min(1).max(500).nullable()});
export const queueArrangementSchema=arrangementSchema.extend({arrangedAt:instant,arrangedBy:z.string().max(500).nullable()});
export const consultationQueueSchema=z.strictObject({version:z.literal('consultation-queue-v1'),enabled:z.boolean(),
 cases:z.array(z.strictObject({memberId:uuid,memberName:z.string().max(500).nullable(),doctorName:z.string().max(500).nullable(),since:instant,arrangement:queueArrangementSchema.nullable()})),
 clinics:z.array(z.strictObject({id:uuid,name:z.string().min(1).max(500)}))});
export const arrangeCommandSchema=z.strictObject({version:z.literal(consultationArrangeVersion),submissionId:uuid,memberId:uuid,since:instant,previous:instant.nullable(),scheduledAt:instant,channel:z.enum(consultationChannels),clinicId:uuid.optional()})
 .refine(c=>(c.channel==='clinic')===(c.clinicId!==undefined),'A clinic is needed for a clinic consultation, and only then.');
export const arrangeResultSchema=z.strictObject({status:z.enum(['arranged','stale','invalid','invalid-time','disabled','access','unavailable','outcome-unknown'])});
export type ConsultationQueue=z.infer<typeof consultationQueueSchema>;
export type ConsultationArrangement=z.infer<typeof arrangementSchema>;
export type ArrangeCommand=z.infer<typeof arrangeCommandSchema>;
export type ArrangeResult=z.infer<typeof arrangeResultSchema>;
export type ArrangeCommandPort=(input:ArrangeCommand)=>Promise<ArrangeResult>;
