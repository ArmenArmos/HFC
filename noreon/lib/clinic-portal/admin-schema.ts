import{z}from'zod';
const id=z.uuid(),revision=z.number().int().nonnegative().safe(),name=z.string().trim().min(1).max(180),email=z.email().max(320).transform(e=>e.trim().toLowerCase());
export const clinicMembershipSchema=z.strictObject({id,userId:id,displayName:name,email,active:z.boolean(),revision});
export const clinicAdminPageSchema=z.strictObject({version:z.literal('clinic-admin-memberships-v1'),clinic:z.strictObject({id,name,active:z.boolean()}),memberships:z.array(clinicMembershipSchema).max(100),invitations:z.array(z.strictObject({id,email,displayName:name,status:z.string().min(1).max(60),generation:z.number().int().positive().safe(),expiresAt:z.iso.datetime({offset:true}),deliveryStatus:z.string().min(1).max(60)})).max(20),invitationsHasMore:z.boolean(),nextCursor:z.string().min(1).max(1024).nullable(),capabilities:z.strictObject({grantExisting:z.literal(true),inviteNew:z.literal(false)})}).refine(p=>new Set(p.memberships.map(m=>m.id)).size===p.memberships.length&&new Set(p.memberships.map(m=>m.userId)).size===p.memberships.length,'Duplicate membership');
export const clinicAdminLookupSchema=z.discriminatedUnion('status',[z.strictObject({status:z.literal('eligible'),account:z.strictObject({userId:id,email})}),z.strictObject({status:z.literal('unavailable'),reason:z.enum(['not_found','email_unconfirmed','password_setup_required','disabled'])})]);
const base={version:z.literal('clinic-admin-command-v1'),submissionId:id,clinicId:id,membershipId:id};
export const clinicAdminCommandSchema=z.discriminatedUnion('op',[
 z.strictObject({...base,op:z.literal('grant-existing'),userId:id,email,displayName:name}),
 z.strictObject({...base,op:z.literal('update'),expectedRevision:revision,displayName:name,active:z.boolean()}),
 z.strictObject({...base,op:z.literal('revoke'),expectedRevision:revision})
]);
export type ClinicAdminCommand=z.infer<typeof clinicAdminCommandSchema>;
const receipt=z.strictObject({status:z.literal('committed'),submissionId:id,membershipId:id,revision});
export const clinicAdminResultSchema=z.discriminatedUnion('status',[receipt,z.strictObject({status:z.literal('rejected'),submissionId:id,reason:z.enum(['invalid','conflict','account_unavailable','clinic_unavailable']),noWrite:z.literal(true)}),z.strictObject({status:z.literal('stale')}),z.strictObject({status:z.literal('access')}),z.strictObject({status:z.literal('unknown')})]);
export const clinicAdminRefreshSchema=z.strictObject({status:z.literal('loaded'),receipt:z.discriminatedUnion('status',[receipt,z.strictObject({status:z.literal('retired'),submissionId:id,serialized:z.literal(true)})]),membership:clinicMembershipSchema.nullable()});
