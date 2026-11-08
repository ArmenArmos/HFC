import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { EmailSubmission } from "@/lib/messaging/brevo-email";

export const invitationContextSchema = z.object({
  role: z.enum(["doctor", "nurse", "coordinator"]), specialty: z.enum(["family_physician", "cardiologist"]).nullable().optional(),
  id: z.uuid(), generation: z.number().int().positive().safe(), operationId: z.uuid(),
  expectedAuthUserId: z.uuid(), authUserId: z.uuid().nullable(), email: z.email().max(320), name: z.string().min(1).max(160),
  clinicId: z.uuid(), issuerId: z.uuid(), status: z.enum(["pending", "verified", "accepted", "revoked"]),
  sendStatus: z.enum(["pending", "accepted", "failed", "unknown"]), expiresAt: z.iso.datetime({ offset: true }),
  tokenDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(), tokenType: z.enum(["invite", "recovery"]).nullable(),
  dispatchClaimedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type InvitationContext = z.infer<typeof invitationContextSchema>;
type AuthIdentity = { id: string; email: string; confirmed: boolean };
export type InvitationDispatch = {
  origin: string;
  claim(): Promise<InvitationContext & { claimed: boolean }>;
  readUser(id: string): Promise<AuthIdentity | null>;
  createUser(id: string, email: string): Promise<AuthIdentity>;
  bind(id: string): Promise<InvitationContext>;
  generateLink(email: string, type: "invite" | "recovery"): Promise<{ userId: string; tokenHash: string }>;
  storeToken(digest: string, type: "invite" | "recovery"): Promise<InvitationContext>;
  send(input: { name: string; email: string; url: string; role: "doctor" | "nurse" | "coordinator" }): Promise<EmailSubmission>;
  record(result: EmailSubmission): Promise<void>;
};
export type StaffAdminActionState = { ok: boolean; message: string; reservationCreated?:boolean; operationCreated?:boolean; outcomeUnknown?:boolean };
export const tokenDigest = (token: string) => createHash("sha256").update(token).digest("hex");
function sameOperation(first: InvitationContext, next: InvitationContext) {
  if (first.id !== next.id || first.generation !== next.generation || first.operationId !== next.operationId ||
      first.expectedAuthUserId !== next.expectedAuthUserId || first.email !== next.email ||
      first.role !== next.role || first.name !== next.name || first.clinicId !== next.clinicId) throw Error("Invitation changed.");
}
export async function dispatchDoctorInvitation(value: InvitationContext, deps: InvitationDispatch): Promise<StaffAdminActionState> {
  const context = invitationContextSchema.parse(value);
  let claimed = false;
  let sendStarted = false;
  try {
    const claim = await deps.claim();
    sameOperation(context, invitationContextSchema.parse(claim));
    if (!claim.claimed) return { ok: false, message: "Invitation setup is already in progress. Check the staff list." };
    claimed = true;
    let user = await deps.readUser(context.expectedAuthUserId);
    if (!user) {
      try { user = await deps.createUser(context.expectedAuthUserId, context.email); }
      catch {
        // Explicit provider-enforced UUID is the sole reconciliation key.
        user = await deps.readUser(context.expectedAuthUserId);
        if (!user) throw Error("Account setup is unconfirmed.");
      }
    }
    if (user.id !== context.expectedAuthUserId || user.email.toLowerCase() !== context.email) throw Error("Invitation identity changed.");
    const bound = invitationContextSchema.parse(await deps.bind(user.id));
    sameOperation(context, bound);
    if (bound.authUserId !== user.id) throw Error("Invitation identity changed.");
    const type = user.confirmed ? "recovery" : "invite";
    const link = await deps.generateLink(context.email, type);
    if (link.userId !== user.id || !/^[A-Za-z0-9_-]{32,256}$/.test(link.tokenHash)) throw Error("Invitation identity changed.");
    const digest = tokenDigest(link.tokenHash);
    const prepared = invitationContextSchema.parse(await deps.storeToken(digest, type));
    sameOperation(context, prepared);
    if (prepared.authUserId !== user.id || prepared.tokenDigest !== digest || prepared.tokenType !== type) throw Error("Invitation changed.");
    const url = new URL("/staff/real/invite", deps.origin);
    url.hash = new URLSearchParams({ token: link.tokenHash, invitation: context.id, generation: String(context.generation), type }).toString();
    sendStarted = true;
    const result = await deps.send({ email: context.email, name: context.name, role: context.role, url: url.href });
    await deps.record(result);
    return result.status === "accepted"
      ? { ok: true, message: "Invitation queued. The staff member can verify their email and set a password." }
      : { ok: false, message: result.status === "failed" ? "The invitation could not be queued. Check the staff list before sending another." : "Email delivery is unconfirmed. Check the staff list before sending another." };
  } catch {
    if (claimed) { try { await deps.record({ status: sendStarted ? "unknown" : "failed" }); } catch { /* Retain pending state; no blind resend. */ } }
    return { ok: false, message: sendStarted ? "Email delivery is unconfirmed. Check the staff list before sending another." : "The invitation could not be prepared. Check the staff list before sending another." };
  }
}
