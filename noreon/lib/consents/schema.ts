/**
 * Member consents (WP F): the shapes at every boundary. member_consent_set, member_consents_current and
 * member_consent_history (20261108063720_member_caregivers_consents.sql). Framework-free.
 */
import {z} from 'zod';
import {ALL_CONSENT_KINDS,MEMBER_CONSENT_KINDS} from './copy';

export const consentKindSchema=z.enum(ALL_CONSENT_KINDS);
export const memberConsentKindSchema=z.enum(MEMBER_CONSENT_KINDS);
export const consentMethodSchema=z.enum(['tap','voice']);
export const consentRowSchema=z.strictObject({kind:consentKindSchema,granted:z.boolean(),wordingVersion:z.string().regex(/^[a-z0-9-]{1,64}$/),
 method:consentMethodSchema,source:z.string().min(1).max(40),recordedAt:z.string().min(1)});
export type ConsentRow=z.infer<typeof consentRowSchema>;
export const consentsCurrentSchema=z.strictObject({ok:z.literal(true),consents:z.array(consentRowSchema).max(10)});
export const consentHistorySchema=z.strictObject({ok:z.literal(true),history:z.array(consentRowSchema).max(200)});
export const consentSetResultSchema=z.union([
 z.strictObject({ok:z.literal(true),changed:z.boolean(),consents:z.array(consentRowSchema).max(10)}),
 z.strictObject({ok:z.literal(false),code:z.enum(['invalid'])}),
]);

/** A decision on the consents card: which statement, yes or no, in which language it was shown, and how it was confirmed. */
export const consentCardInputSchema=z.strictObject({cardId:z.uuid(),opId:z.uuid(),kind:memberConsentKindSchema,granted:z.boolean(),
 // A browser can only tap. A spoken confirmation is derived on the server, bound to the card, by the voice work package.
 locale:z.enum(['hy','en','ru']),method:z.literal('tap')});
export type ConsentCardInput=z.infer<typeof consentCardInputSchema>;

/** What a consents card records per decision: never the text, only what was decided. */
export const consentDecisionSchema=z.strictObject({kind:memberConsentKindSchema,granted:z.boolean(),method:consentMethodSchema,
 wordingVersion:z.string(),changed:z.boolean(),doneAt:z.string()});
export type ConsentDecision=z.infer<typeof consentDecisionSchema>;
export const consentItem=(kind:z.infer<typeof memberConsentKindSchema>)=>`consent:${kind}`;

/** The consents card as posted: the current choice per kind and the most recent history. */
export const consentsCardSnapshot=z.strictObject({v:z.literal(1),version:z.string().regex(/^[a-z0-9-]{1,64}$/),
 current:z.array(consentRowSchema).max(10),history:z.array(consentRowSchema).max(30)});
export type ConsentsCardSnapshot=z.infer<typeof consentsCardSnapshot>;

/** Dark by default: the consents card needs NOREON_MEMBER_CONSENTS=true. */
export const memberConsentsEnabled=(env:Record<string,string|undefined>=process.env)=>env.NOREON_MEMBER_CONSENTS==='true';
