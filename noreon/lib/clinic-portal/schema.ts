import{z}from'zod';
const id=z.uuid(),revision=z.number().int().nonnegative().safe(),label=z.string().trim().min(1).max(180),stamp=z.iso.datetime({offset:true}),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const clinicIdentitySchema=z.strictObject({version:z.literal('clinic-portal-v1'),userId:id,membershipId:id,membershipRevision:revision,clinicId:id,clinicName:label,displayName:label,capability:z.enum(['clinic_admin','clinic_staff']),fullAccess:z.boolean().optional()});
export type ClinicIdentity=z.infer<typeof clinicIdentitySchema>;
export const clinicIdentityResultSchema=z.discriminatedUnion('status',[
 z.strictObject({status:z.literal('ready'),identity:clinicIdentitySchema}),
 z.strictObject({status:z.literal('selection-required'),clinics:z.array(z.strictObject({id,name:label})).min(2).max(100)})
]);
export const clinicFileSchema=z.strictObject({id,logicalKey:id,name:label,mime:z.literal('application/pdf'),declaredSizeBytes:z.number().int().positive().max(8388608),sizeBytes:z.number().int().positive().max(8388608).nullable(),checksum:hash.nullable(),revision,createdAt:stamp,
 upload:z.strictObject({status:z.enum(['reserved','stored','rejected']),attemptId:id,possibleDuplicate:z.boolean(),cleanup:z.enum(['not_required','pending','complete'])}),
 processing:z.strictObject({status:z.enum(['not_started','queued','running','complete','partial','failed','unavailable']),sequence:revision,segments:revision,unresolvedRegions:revision}),
 association:z.strictObject({status:z.enum(['not_started','review_required','partial','associated']),associatedCount:revision,unmatchedCount:revision}),recoveryCommand:z.lazy(()=>clinicCommandSchema).nullable(),correction:z.strictObject({pendingCount:revision}),release:z.strictObject({hiddenCount:revision,releasedCount:revision})
}).superRefine((f,c)=>{if(f.upload.status==='stored'&&(!f.checksum||f.sizeBytes===null))c.addIssue({code:'custom',message:'Stored upload needs server measured identity'});if(f.processing.status==='complete'&&(f.processing.segments===0||f.processing.unresolvedRegions!==0))c.addIssue({code:'custom',message:'Complete processing needs segments and no unresolved regions'});});
const batch=z.strictObject({id,clinicId:id,name:label,revision,createdAt:stamp,uploaderName:label});
export const clinicSnapshotSchema=z.strictObject({version:z.literal('clinic-batch-v1'),batch,files:z.array(clinicFileSchema).max(100),nextCursor:z.string().min(1).max(1024).nullable(),limits:z.strictObject({maxFiles:z.number().int().positive().max(100),maxFileBytes:z.number().int().positive().max(8388608)}),capabilities:z.strictObject({upload:z.boolean(),processing:z.boolean(),association:z.boolean(),correction:z.boolean(),sourceRelease:z.literal(false)})}).refine(s=>new Set(s.files.map(f=>f.id)).size===s.files.length&&new Set(s.files.map(f=>f.logicalKey)).size===s.files.length,'Duplicate file identity').refine(s=>s.files.every(f=>!f.recoveryCommand||(f.upload.status==='reserved'&&f.recoveryCommand.op==='reserve-upload'&&f.recoveryCommand.clinicId===s.batch.clinicId&&f.recoveryCommand.batchId===s.batch.id&&f.recoveryCommand.fileId===f.id&&f.recoveryCommand.logicalKey===f.logicalKey&&f.recoveryCommand.attemptId===f.upload.attemptId&&f.recoveryCommand.name===f.name&&f.recoveryCommand.declaredSizeBytes===f.declaredSizeBytes)),'Wrong recovery command identity');
export type ClinicSnapshot=z.infer<typeof clinicSnapshotSchema>;
export const clinicBatchesSchema=z.strictObject({version:z.literal('clinic-batches-page-v1'),clinicId:id,batches:z.array(batch.extend({fileCount:revision,attentionCount:revision})).max(100),nextCursor:z.string().min(1).max(1024).nullable()}).refine(s=>s.batches.every(b=>b.clinicId===s.clinicId)&&new Set(s.batches.map(b=>b.id)).size===s.batches.length,'Wrong clinic or duplicate batch');
const commandBase={version:z.literal('clinic-command-v1'),submissionId:id,clinicId:id,batchId:id};
export const clinicCommandSchema=z.discriminatedUnion('op',[
 z.strictObject({...commandBase,op:z.literal('create-batch'),name:label}),
 z.strictObject({...commandBase,op:z.literal('reserve-upload'),revision,logicalKey:id,fileId:id,attemptId:id,name:label,mime:z.literal('application/pdf'),declaredSizeBytes:z.number().int().positive().max(8388608),fingerprint:hash})
]);
export type ClinicCommand=z.infer<typeof clinicCommandSchema>;
export const clinicCommandResultSchema=z.discriminatedUnion('status',[
 z.strictObject({status:z.literal('committed'),submissionId:id,batchId:id,revision}),
 // WP-11 item 13: 'duplicate' means the same PDF is already stored in this batch; fileId is that file.
 z.strictObject({status:z.literal('rejected'),submissionId:id,reason:z.enum(['invalid','unavailable','batch_full','conflict','duplicate']),fileId:id.optional(),noWrite:z.literal(true)}).refine(r=>(r.reason==='duplicate')===(r.fileId!==undefined),'A duplicate names the stored file'),
 z.strictObject({status:z.literal('stale')}),z.strictObject({status:z.literal('access')}),z.strictObject({status:z.literal('unknown')})
]);
export type ClinicCommandResult=z.infer<typeof clinicCommandResultSchema>|{status:'invalid'};
export const clinicRefreshSchema=z.strictObject({status:z.literal('loaded'),snapshot:clinicSnapshotSchema.nullable(),receipt:z.discriminatedUnion('status',[
 z.strictObject({status:z.literal('committed'),submissionId:id,batchId:id,revision}),
 z.strictObject({status:z.literal('retired'),submissionId:id,serialized:z.literal(true)}),
 z.strictObject({status:z.literal('unknown'),submissionId:id})
])});
export type ClinicRefreshResult=z.infer<typeof clinicRefreshSchema>|{status:'unavailable'};
