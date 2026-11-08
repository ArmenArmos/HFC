import {z} from 'zod';

const member=z.strictObject({
 memberId:z.uuid(),
 phoneLast4:z.string().regex(/^[0-9]{4}$/).nullable(),
 birthYear:z.number().int().min(1).max(9999).nullable(),
});
export type ClinicMemberMasked=z.infer<typeof member>;
/** Separate from legacy DTOs: partial values never occupy E.164/date fields. */
export const clinicMemberMaskedSchema=z.discriminatedUnion('ok',[
 z.strictObject({ok:z.literal(true),members:z.array(member).max(200)}),
 z.strictObject({ok:z.literal(false),code:z.enum(['invalid','access','refused','disabled','unavailable'])}),
]);
