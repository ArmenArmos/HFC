import{z}from'zod';
/** Attaching a clinic lab upload to a member's visit (Q8, lead decision 17 Oct).
 * Off unless NOREON_CLINIC_RESULT_ATTACH_ENABLED is 'true'. */
export const resultAttachEnabled=(env:Record<string,string|undefined>=process.env)=>env.NOREON_CLINIC_RESULT_ATTACH_ENABLED==='true';
const uuid=z.uuid(),instant=z.iso.datetime({offset:true}),text=z.string().max(500);
export const resultAttachVisitSchema=z.strictObject({visitId:uuid,memberId:uuid,memberName:text.nullable(),visitedAt:instant,atLab:z.number().int().nonnegative(),collectedOnly:z.number().int().nonnegative(),reference:uuid,ambiguous:z.boolean()});
/** The clinic recognises a visit by the reference printed in its scheduling email; a short form is shown. */
export const shortReference=(reference:string)=>reference.slice(0,8).toUpperCase();
export const resultAttachPageSchema=z.strictObject({version:z.literal('clinic-result-attach-v1'),clinic:z.strictObject({id:uuid,name:text}),
 files:z.array(z.strictObject({id:uuid,name:text,batchName:text,uploadedAt:instant,attachment:z.strictObject({id:uuid,memberId:uuid,memberName:text.nullable(),visitId:uuid,visitedAt:instant,attachedAt:instant}).nullable()})).max(100),
 visits:z.array(resultAttachVisitSchema)});
export const resultAttachCommandSchema=z.strictObject({version:z.literal('clinic-result-attach-v1'),submissionId:uuid,fileId:uuid,memberId:uuid,visitId:uuid});
export const resultAttachResultSchema=z.discriminatedUnion('status',[
 z.strictObject({status:z.literal('saved'),attachmentId:uuid,corrected:z.boolean(),moved:z.number().int().nonnegative(),waitingForLab:z.number().int().nonnegative(),atLabAfterUpload:z.number().int().nonnegative(),alreadyReceived:z.number().int().nonnegative(),retracted:z.number().int().nonnegative()}),
 z.strictObject({status:z.enum(['invalid','stale','access','unavailable','disabled','outcome-unknown'])}),
]);
/** Noreon-admin detach (F2): audited, with a reason; it retracts system results no other upload supports. */
export const resultDetachCommandSchema=z.strictObject({version:z.literal('clinic-result-detach-v1'),submissionId:uuid,fileId:uuid,reason:z.string().trim().min(1).max(500)});
export const resultDetachResultSchema=z.discriminatedUnion('status',[
 z.strictObject({status:z.literal('saved'),replayed:z.boolean(),retracted:z.number().int().nonnegative()}),
 z.strictObject({status:z.enum(['invalid','stale','access','unavailable','disabled','outcome-unknown'])}),
]);
/** Clinic admin: the narrow list (name and visit date only) and its attach. */
export const clinicResultVisitsSchema=z.strictObject({version:z.literal('clinic-result-visits-v1'),enabled:z.boolean(),visits:z.array(z.strictObject({visitId:uuid,memberName:text.nullable(),visitedAt:instant,reference:uuid,ambiguous:z.boolean()})).max(500)});
export const clinicResultAttachCommandSchema=z.strictObject({version:z.literal('clinic-result-attach-v1'),submissionId:uuid,fileId:uuid,visitId:uuid});
export const clinicResultAttachResultSchema=z.discriminatedUnion('status',[
 z.strictObject({status:z.literal('saved'),corrected:z.boolean(),moved:z.number().int().nonnegative(),waitingForLab:z.number().int().nonnegative(),atLabAfterUpload:z.number().int().nonnegative(),alreadyReceived:z.number().int().nonnegative(),retracted:z.number().int().nonnegative()}),
 z.strictObject({status:z.enum(['invalid','stale','access','unavailable','disabled','ambiguous','needs-review','outcome-unknown'])}),
]);
export type ResultDetachCommand=z.infer<typeof resultDetachCommandSchema>;
export type ResultDetachResult=z.infer<typeof resultDetachResultSchema>;
export type ClinicResultVisits=z.infer<typeof clinicResultVisitsSchema>;
export type ClinicResultAttachCommand=z.infer<typeof clinicResultAttachCommandSchema>;
export type ClinicResultAttachResult=z.infer<typeof clinicResultAttachResultSchema>;
export type ResultAttachPage=z.infer<typeof resultAttachPageSchema>;
export type ResultAttachCommand=z.infer<typeof resultAttachCommandSchema>;
export type ResultAttachResult=z.infer<typeof resultAttachResultSchema>;
