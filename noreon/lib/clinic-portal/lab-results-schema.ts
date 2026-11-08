import{z}from'zod';
import type{ClinicMemberMasked}from'./member-masked-schema';
/** Clinic lab results screen: each stored PDF with its reading, the suggested member and the link.
 * Members listed are only those with a booking at this clinic; the database decides. */
const uuid=z.uuid(),instant=z.iso.datetime({offset:true}),day=z.iso.date(),text=z.string().max(500);
export const clinicLabFileSchema=z.strictObject({fileId:uuid,name:text,uploadedAt:instant,
 linked:z.strictObject({memberId:uuid,name:text,linkedAt:instant}).nullable(),everLinked:z.boolean(),
 reading:z.strictObject({state:z.enum(['queued','running','done','rejected','failed']),outcome:z.string().nullable(),identityStatus:z.enum(['match','unknown','mismatch','multiple_patients']).nullable(),
  nameMatch:z.enum(['yes','no','unknown']),birthYearMatch:z.enum(['yes','no','unknown'])}).nullable(),
 suggestion:z.strictObject({memberId:uuid,confidence:z.enum(['high','medium','low']),name:text,birthDate:day.nullable()}).nullable()});
const labMemberSchema=z.strictObject({memberId:uuid,name:text,birthDate:day.nullable(),bookingAt:instant});
export const clinicLabResultsSchema=z.strictObject({version:z.literal('clinic-lab-results-v1'),enabled:z.boolean(),reading:z.boolean(),files:z.array(clinicLabFileSchema).max(100),
 members:z.array(labMemberSchema).max(300)});
/** WP-11 item 46: the longer member list for manual linking (clinic_portal_lab_members). */
export const clinicLabMembersSchema=z.strictObject({version:z.literal('clinic-lab-members-v1'),enabled:z.boolean(),members:z.array(labMemberSchema).max(1000),capped:z.boolean()});
export const clinicLabLinkCommandSchema=z.strictObject({version:z.literal('clinic-lab-link-v1'),submissionId:uuid,fileId:uuid,memberId:uuid,appointmentId:uuid.optional()});
export const clinicLabLinkResultSchema=z.discriminatedUnion('status',[
 z.strictObject({status:z.literal('saved'),replayed:z.boolean(),startsAt:instant.optional(),completed:z.boolean().optional()}),
 z.strictObject({status:z.literal('choose-visit'),options:z.array(z.strictObject({appointmentId:uuid,startsAt:instant})).min(1).max(50)}),
 z.strictObject({status:z.enum(['invalid','stale','access','unavailable','disabled','needs-review','not-this-clinic','ambiguous','outcome-unknown'])}),
]);
export type ClinicLabFile=z.infer<typeof clinicLabFileSchema>;
export type ClinicLabResults=Omit<z.infer<typeof clinicLabResultsSchema>,'members'>&{members:z.infer<typeof labMemberSchema>[];
 /** More members have a booking here than the list holds (item 46); absent before the migration. */
 membersCapped?:boolean;
 /** Display-only values from a separate read; never keys in the legacy wire DTO. */
 maskedMembers?:ClinicMemberMasked[]};
export type ClinicLabLinkCommand=z.infer<typeof clinicLabLinkCommandSchema>;
export type ClinicLabLinkResult=z.infer<typeof clinicLabLinkResultSchema>;
/** One status a clinic user acts on, from the database row. */
export type ClinicLabStatus='linked'|'noreon'|'needs-review'|'reading'|'suggested'|'choose';
export function clinicLabStatus(f:ClinicLabFile,reading:boolean):ClinicLabStatus{
 if(f.linked)return 'linked';
 if(f.everLinked)return 'noreon';
 const r=f.reading;
 if(r?.state==='done'&&(r.identityStatus==='multiple_patients'||(r.identityStatus==='mismatch'&&!f.suggestion)))return 'needs-review';
 if(f.suggestion&&f.suggestion.confidence!=='low')return 'suggested';
 if(reading&&(!r||r.state==='queued'||r.state==='running'))return 'reading';
 return 'choose';
}
