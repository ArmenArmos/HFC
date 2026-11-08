import {z} from 'zod';
const amrSchema = z.array(z.object({method: z.string().min(1)})).min(1);
/** Only Auth-verified claims from this exact session may reach this predicate. */
export function staffSessionMethodAllowed(amr: unknown) {
  const parsed = amrSchema.safeParse(amr);
  if (!parsed.success) return false;
  const methods = parsed.data.map(entry => entry.method);
  return !methods.includes('recovery') && methods.includes('password');
}
