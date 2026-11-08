import{z}from'zod';
/** Results uploaded from a member's record. The database decides scope, identity checks, the booking rule
 * and every audit row (clinic_admin_member_*); these schemas only parse. */
const id=z.uuid(),stamp=z.iso.datetime({offset:true}),day=z.iso.date(),text=z.string().max(500);
const jobState=z.enum(['queued','running','done','rejected','failed']).nullable();
/** Frozen in the browser so retrying a lost setup response replays the same create command. */
export const memberUploadAttemptSchema=z.strictObject({submissionId:id,batchId:id,name:z.string().trim().min(1).max(180)});
export type MemberUploadAttempt=z.infer<typeof memberUploadAttemptSchema>;
const values=z.strictObject({name:text.nullable(),birthDate:day.nullable()});
export const compareSchema=z.union([
 z.strictObject({status:z.literal('reading'),read:z.literal(false)}),
 z.strictObject({status:z.literal('blocked'),read:z.literal(true)}),
 z.strictObject({status:z.literal('compared'),read:z.boolean(),differs:z.boolean(),mismatch:z.enum(['name','birth_date','both']).nullable(),
  sheet:z.strictObject({nameMatch:z.enum(['yes','no','unknown']),birthYearMatch:z.enum(['yes','no','unknown'])}).nullable(),member:values.extend({editedAt:stamp.optional(),current:values.optional()})}),
]);
export type FileCompare=z.infer<typeof compareSchema>;
// Clinic status metadata ships separately from the doctor migration. Both fields may be absent.
export const memberFileSchema=z.strictObject({fileId:id,name:text,uploadedAt:stamp,fromRecord:z.boolean(),
 state:z.enum(['reading','check','blocked','book-first','choose-visit','attached','paused','error','unmatched']),
 attached:z.boolean(),override:z.boolean(),noValuesRead:z.boolean().optional(),identityChecked:z.boolean().optional(),fileReading:jobState,memberReading:jobState,readingOn:z.boolean(),compare:compareSchema.nullable()});
export type MemberFile=z.infer<typeof memberFileSchema>;
export const memberFilesSchema=z.union([
 z.strictObject({version:z.literal('clinic-member-files-v1'),enabled:z.literal(false)}),
 z.strictObject({version:z.literal('clinic-member-files-v1'),enabled:z.literal(true),status:z.literal('refused')}),
 z.strictObject({version:z.literal('clinic-member-files-v1'),enabled:z.literal(true),status:z.literal('ok'),uploadAvailable:z.boolean(),
  uploads:z.array(memberFileSchema).max(500),unmatched:z.array(memberFileSchema).max(50)}),
]);
export type MemberFiles=Extract<z.infer<typeof memberFilesSchema>,{status:'ok'}>;
export const attachInputSchema=z.strictObject({fileId:id,submissionId:id,confirm:z.boolean(),reason:z.string().trim().max(300).optional(),appointmentId:id.optional()});
export const attachResultSchema=z.union([
 z.strictObject({status:z.literal('saved'),replayed:z.boolean(),override:z.boolean().optional()}),
 z.strictObject({status:z.literal('mismatch'),compare:compareSchema}),
 z.strictObject({status:z.literal('choose-visit'),options:z.array(z.strictObject({appointmentId:id,startsAt:stamp})).min(1).max(50)}),
 z.object({status:z.enum(['reading','blocked','book-first','invalid','stale','refused','disabled','unavailable'])}),
]);
export type AttachResult=z.infer<typeof attachResultSchema>|{status:'outcome-unknown'};
export type ReserveResult={status:'reserved';batchId:string;fileId:string;attemptId:string}|{status:'refused'|'invalid'|'unavailable'|'disabled'|'not_enrolled'};
/** One status the clinic sees per file, from the current attachment: the stored state is history, so a
 * file Noreon detached or moved to another member is never 'ready' here (audit B1-5). */
export type FileStatus='uploading'|'reading'|'reading-values'|'check'|'blocked'|'book-first'|'choose-visit'|'ready'|'by-hand'|'failed'|'paused'|'unmatched'|'detached'|'identity-check'|'identity-checked'|'unreadable';
export function fileStatus(f:MemberFile):FileStatus{
 if(f.attached){
  if(f.noValuesRead===true)return 'unreadable';
  if(f.override)return f.identityChecked?'identity-checked':'identity-check';
  if(!f.readingOn)return 'by-hand';
  if(f.memberReading==='queued'||f.memberReading==='running')return 'reading-values';
  if(f.memberReading!=='done')return 'by-hand';
  return 'ready';
 }
 if(f.state==='attached')return 'detached';
 if(f.noValuesRead===true&&f.state!=='check'&&f.state!=='blocked')return 'unreadable';
 if(f.state==='unmatched')return 'unmatched';
 if(f.state==='error')return 'failed';
 return f.state;
}
