/**
 * Authorized caregivers (WP F): the shapes at every boundary of the member_caregiver_* and caregiver_* functions
 * (20261108063720_member_caregivers_consents.sql). Framework-free.
 */
import {z} from 'zod';
import {CAREGIVER_RELATIONSHIPS,CAREGIVER_SCOPES} from '@/lib/consents/copy';

export const caregiverScopeSchema=z.enum(CAREGIVER_SCOPES);
export const caregiverRelationshipSchema=z.enum(CAREGIVER_RELATIONSHIPS);
/** 'expired' is a pending invitation older than 14 days, as the database reports it: no longer live. */
export const caregiverStatusSchema=z.enum(['pending','active','revoked','declined','expired']);
/** E.164, as the database stores it. Spaces, brackets and dashes are removed before the check. */
export const E164=/^\+[1-9][0-9]{6,14}$/;
export const normalizePhone=(raw:string)=>raw.replace(/[\s()-]/g,'');
const scopes=z.array(caregiverScopeSchema).min(1).max(CAREGIVER_SCOPES.length);
const iso=z.string().min(1).max(40);

export const caregiverLinkSchema=z.strictObject({id:z.uuid(),name:z.string().min(1).max(80),relationship:caregiverRelationshipSchema,
 phone:z.string().regex(E164),scopes,status:caregiverStatusSchema,revision:z.number().int().positive(),invitedAt:iso,
 acceptedAt:iso.nullable(),revokedAt:iso.nullable(),declinedAt:iso.nullable(),wordingVersion:z.string()});
export type CaregiverLink=z.infer<typeof caregiverLinkSchema>;
export const memberCaregiversSchema=z.strictObject({ok:z.literal(true),links:z.array(caregiverLinkSchema).max(20)});
const failure=<C extends readonly [string,...string[]]>(codes:C)=>z.strictObject({ok:z.literal(false),code:z.enum(codes),link:caregiverLinkSchema.optional()});
export const caregiverInviteResultSchema=z.union([
 z.strictObject({ok:z.literal(true),replayed:z.boolean(),link:caregiverLinkSchema}),
 failure(['invalid','conflict','own_phone','duplicate','limit']),
]);
export const caregiverChangeResultSchema=z.union([
 z.strictObject({ok:z.literal(true),changed:z.boolean(),link:caregiverLinkSchema}),
 failure(['invalid','not_found','closed','stale']),
]);

export const caregiverInvitationSchema=z.strictObject({id:z.uuid(),memberFirstName:z.string().max(160).nullable(),relationship:caregiverRelationshipSchema,
 scopes,invitedAt:iso,wordingVersion:z.string()});
export type CaregiverInvitation=z.infer<typeof caregiverInvitationSchema>;
export const caregiverInvitationsSchema=z.strictObject({ok:z.literal(true),invitations:z.array(caregiverInvitationSchema).max(50)});
export const caregiverAnswerResultSchema=z.union([
 z.strictObject({ok:z.literal(true),changed:z.boolean(),status:z.enum(['active','declined'])}),
 z.strictObject({ok:z.literal(false),code:z.enum(['invalid','not_found','closed','expired','duplicate'])}),
]);
export const caredMemberSchema=z.strictObject({linkId:z.uuid(),memberId:z.uuid(),firstName:z.string().max(160).nullable(),relationship:caregiverRelationshipSchema,scopes,since:iso});
export type CaredMember=z.infer<typeof caredMemberSchema>;
export const caredMembersSchema=z.strictObject({ok:z.literal(true),members:z.array(caredMemberSchema).max(50)});

export const caregiverBpLogResultSchema=z.union([
 z.strictObject({ok:z.literal(true),replayed:z.boolean(),measurementId:z.uuid()}),
 z.strictObject({ok:z.literal(false),code:z.enum(['invalid','conflict','not_eligible'])}),
]);
export const caregiverReadingSchema=z.strictObject({id:z.uuid(),systolic:z.number().int(),diastolic:z.number().int(),pulse:z.number().int().nullable(),measuredAt:iso,entrySource:z.string().nullable()});
export const caregiverReadingsSchema=z.strictObject({ok:z.literal(true),readings:z.array(caregiverReadingSchema).max(60)});
export const caregiverPlanSchema=z.strictObject({ok:z.literal(true),plan:z.strictObject({id:z.uuid(),clinician:z.string(),publishedAt:iso,instructions:z.string(),version:z.number().int().nullable(),
 medicines:z.array(z.strictObject({name:z.string(),dose:z.string(),times:z.array(z.string())})),review:z.strictObject({planId:z.string().nullable(),instructions:z.string()}).nullable()}).nullable()});

// Card inputs (the member's caregiver card) ---------------------------------------------------------------------------
export const caregiverInviteInputSchema=z.strictObject({cardId:z.uuid(),opId:z.uuid(),name:z.string().trim().min(1).max(80),relationship:caregiverRelationshipSchema,
 phone:z.string().trim().transform(normalizePhone).pipe(z.string().regex(E164)),scopes,locale:z.enum(['hy','en','ru']),
 // A browser can only tap. A spoken confirmation is derived on the server, bound to the card, by the voice work package.
 method:z.literal('tap')});
export type CaregiverInviteInput=z.infer<typeof caregiverInviteInputSchema>;
/** locale: the language the new statement was shown in, so the server hashes the exact text the member confirmed. */
export const caregiverScopesInputSchema=z.strictObject({cardId:z.uuid(),opId:z.uuid(),linkId:z.uuid(),revision:z.number().int().positive(),scopes,locale:z.enum(['hy','en','ru'])});
export type CaregiverScopesInput=z.infer<typeof caregiverScopesInputSchema>;
export const caregiverRevokeInputSchema=z.strictObject({cardId:z.uuid(),opId:z.uuid(),linkId:z.uuid(),revision:z.number().int().positive()});
export type CaregiverRevokeInput=z.infer<typeof caregiverRevokeInputSchema>;
export const caregiverInvitationAnswerSchema=z.strictObject({id:z.uuid(),accept:z.boolean()});

/** What a caregiver card records per action: codes and scopes only, never a name or phone number. */
export const caregiverItem={invite:'invite',scopes:(linkId:string)=>`scopes:${linkId}`,revoke:(linkId:string)=>`revoke:${linkId}`};
export type CaregiverReceipt={action:'invite'|'scopes'|'revoke';status:'done'|'unchanged';linkId:string;scopes?:string[];relationship?:string;doneAt:string};

/** The caregiver card as posted: the member's own links, with only the last digits of each phone number. */
export const caregiverCardSnapshot=z.strictObject({v:z.literal(1),limit:z.number().int().min(1).max(10),
 links:z.array(z.strictObject({id:z.uuid(),name:z.string().min(1).max(80),relationship:caregiverRelationshipSchema,phoneTail:z.string().regex(/^[0-9]{2,4}$/),
  scopes,status:caregiverStatusSchema,revision:z.number().int().positive(),invitedAt:iso})).max(20)});
export type CaregiverCardSnapshot=z.infer<typeof caregiverCardSnapshot>;
export function caregiverSnapshotFrom(links:readonly CaregiverLink[]):CaregiverCardSnapshot{
 return {v:1,limit:3,links:links.map(l=>({id:l.id,name:l.name,relationship:l.relationship,phoneTail:l.phone.slice(-3),scopes:[...l.scopes],status:l.status,revision:l.revision,invitedAt:l.invitedAt}))};
}

/** Dark by default: the caregiver card, the invitation card and /patient/caring need NOREON_CAREGIVERS=true. */
export const caregiversEnabled=(env:Record<string,string|undefined>=process.env)=>env.NOREON_CAREGIVERS==='true';

/**
 * Where a signed-in phone account lands after sign-in when caregivers are on: an account that is not a member (no
 * assessment) but has an invitation waiting or someone it helps goes to /patient/caring; everyone else stays on the
 * member journey (a member sees invitations at the top of their own chat, and /patient/caring from its menu).
 */
export function caregiverLandingPath(v:{enabled:boolean;member:boolean;invitations:number;activeLinks:number}):'/patient/caring'|null{
 return v.enabled&&!v.member&&(v.invitations>0||v.activeLinks>0)?'/patient/caring':null;
}
