import {z} from 'zod';

export const clinicMemberRevealInputSchema=z.strictObject({reason:z.string().trim().min(5).max(500)});
export const clinicMemberRevealSchema=z.discriminatedUnion('ok',[
 z.strictObject({ok:z.literal(true),phone:z.string().regex(/^\+[0-9]{6,15}$/).nullable(),birthDate:z.iso.date().nullable()}),
 z.strictObject({ok:z.literal(false),code:z.enum(['reason_required','rate_limited','refused','disabled','access','unavailable'])}),
]);
export type ClinicMemberRevealResult=z.infer<typeof clinicMemberRevealSchema>;
