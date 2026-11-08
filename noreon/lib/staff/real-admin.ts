import "server-only";
import {realClinicRowSchema,copySchedulingResultSchema} from "./clinic-scheduling-schema";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRealStaff, type RealStaff } from "@/lib/patient-care/clinical-case-repository";
import { realReviewEnabled } from "@/lib/patient-care/real-review-config";
import { staffHostAllowed } from "./hosts";
import { doctorInvitationOrigin, parseBrevoEmailConfig } from "@/lib/messaging/brevo-email";

/** The admin boundary shared by requireRealAdmin and its render-scoped twin. */
export async function adminOnly(staff: RealStaff) {
  if (staff.identity.role !== "admin" || !staffHostAllowed((await headers()).get("host") ?? "", "admin")) notFound();
  return staff;
}
export async function requireRealAdmin() {
  return adminOnly(await requireRealStaff());
}
export function staffInvitationConfig(env: Record<string, string | undefined> = process.env) {
  if (!realReviewEnabled(env) || env.NOREON_STAFF_INVITATIONS_ENABLED !== "true") return null;
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return null;
  const secret = env.NOREON_STAFF_INVITATION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 256) return null;
  try {
    return {
      secret,
      email: parseBrevoEmailConfig({
        apiKey: env.NOREON_BREVO_EMAIL_API_KEY ?? env.NOREON_BREVO_API_KEY,
        sender: env.NOREON_BREVO_EMAIL_SENDER,
        origin: doctorInvitationOrigin(env),
      }),
    };
  } catch { return null; }
}
export function realStaffInvitationReady() { return staffInvitationConfig() !== null; }
/** The signing secret for invitation stage proofs, independent of how the invitation is delivered (email or Telegram). */
export function staffInvitationSecret(env: Record<string, string | undefined> = process.env) {
  if (!realReviewEnabled(env) || env.NOREON_STAFF_INVITATIONS_ENABLED !== "true" || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return null;
  const secret = env.NOREON_STAFF_INVITATION_SECRET;
  return secret && Buffer.byteLength(secret) >= 32 && Buffer.byteLength(secret) <= 256 ? secret : null;
}
const clinicsSchema = z.array(realClinicRowSchema);
export async function getRealClinics(staff?: RealStaff) {
  const {client} = staff ?? await requireRealAdmin();
  const result = await client.rpc("real_admin_clinics");
  if (result.error) throw Error("Clinics are unavailable.");
  return clinicsSchema.parse(result.data);
}


export const realStaffDirectoryRowSchema = z.object({
  id: z.uuid(), name: z.string().min(1).max(160), email: z.email(),
  role: z.enum(["doctor", "nurse"]), clinicId: z.uuid(), clinicName: z.string(), active: z.boolean(),
  version: z.string().regex(/^[a-f0-9]{32}$/), assignmentCount: z.number().int().nonnegative().safe(),
  invitationId: z.uuid().optional().nullable(), generation: z.number().int().positive().safe().optional().nullable(),
  status: z.string(), sendStatus: z.string().optional().nullable(), expiresAt: z.iso.datetime({offset: true}).optional().nullable(),
});
export async function getRealStaffDirectory(staff?: RealStaff) {
  const {client} = staff ?? await requireRealAdmin();
  const result = await client.rpc("real_admin_staff");
  if (result.error) throw Error("Staff are unavailable.");
  return z.array(realStaffDirectoryRowSchema).parse(result.data).map(row => ({...row,
    invitationId: row.invitationId ?? undefined, generation: row.generation ?? undefined,
    sendStatus: row.sendStatus ?? undefined, expiresAt: row.expiresAt ?? undefined,
  }));
}

export const recoverySummarySchema = z.object({id:z.uuid(),staffId:z.uuid(),generation:z.number().int().positive(),status:z.string(),dispatchState:z.string(),issuedAt:z.string(),expiresAt:z.string(),failureCategory:z.string().nullable()});
export async function getRealStaffRecoverySummaries(staff?: RealStaff) {
  const {client} = staff ?? await requireRealAdmin();
  const result = await client.rpc('real_admin_staff_recovery_summaries');
  if (result.error) throw Error('Recovery status is unavailable.');
  return z.array(recoverySummarySchema).parse(result.data);
}

export async function getSchedulingCopySettings() {
  const {client}=await requireRealAdmin();
  const result=await client.rpc('real_admin_scheduling_copy_settings');
  if(result.error)throw Error('Scheduling copy settings are unavailable.');
  return copySchedulingResultSchema.parse(result.data);
}
