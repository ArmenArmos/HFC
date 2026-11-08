"use server";
import { loggedAction } from "@/lib/observability/with-logging";
import { timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { realStaffClient } from "@/lib/patient-care/clinical-case-repository";
import { doctorInvitationAvailable, doctorSetupSession, staffInvitationPageAvailable, writeInvitationProof, clearInvitationProof } from "./real-invitation-session";
import { getInvitationContext, invitationWriteClient } from "./real-invitations";
import { tokenDigest, type StaffAdminActionState } from "./real-invitation-dispatch";
import { validatedStaffSession } from "./real-session-binding";
import { acceptTelegramInvitation, sendInviteCode } from "@/lib/telegram-auth/staff-invite";

const failed = (message: string): StaffAdminActionState => ({ ok: false, message });
export const acceptRealDoctorInvitation = loggedAction("acceptRealDoctorInvitation",async function acceptRealDoctorInvitation(_previous: StaffAdminActionState, form: FormData): Promise<StaffAdminActionState> {
  if (!await doctorInvitationAvailable()) return failed("Staff invitations are unavailable. Contact your administrator.");
  const input = z.object({ invitationId: z.uuid(), generation: z.coerce.number().int().positive().safe(), type: z.enum(["invite", "recovery"]), token: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/) }).safeParse({ invitationId: form.get("invitationId"), generation: form.get("generation"), type: form.get("type"), token: form.get("token") });
  if (!input.success) return failed("This invitation is incomplete. Ask your administrator for a new one.");
  const db = invitationWriteClient();
  try {
    const context = await getInvitationContext(input.data.invitationId, input.data.generation, db);
    if (!context.authUserId || !context.tokenDigest || context.tokenType !== input.data.type || !["pending", "verified"].includes(context.status) || Date.parse(context.expiresAt) <= Date.now() ||
        !timingSafeEqual(Buffer.from(context.tokenDigest, "hex"), Buffer.from(tokenDigest(input.data.token), "hex"))) return failed("This invitation is no longer available. Ask your administrator for a new one.");
    const client = await realStaffClient();
    const verified = await client.auth.verifyOtp({ token_hash: input.data.token, type: input.data.type });
    if (verified.error || !verified.data.user?.email || !verified.data.user.email_confirmed_at) return failed("This invitation expired or was already used. Ask your administrator for a new one.");
    if (verified.data.user.id !== context.authUserId || verified.data.user.email.toLowerCase() !== context.email) {
      await client.auth.signOut({ scope: "local" }); return failed("This invitation could not be verified.");
    }
    const session=await validatedStaffSession(client.auth,verified.data.session?.access_token);
    if(!session || session.user.id!==context.authUserId) return failed("Your invitation could not be verified. Try again or contact your administrator.");
    await writeInvitationProof(context, verified.data.user.id,session.sessionId, "verified");
    // The proof records successful OTP verification even if this database write fails.
    // Password setup replays only the guarded record step, never the consumed OTP.
    try { await db.rpc("real_staff_record_invitation_verification", { p_invitation_id: context.id, p_generation: context.generation, p_auth_user_id: verified.data.user.id }); } catch { /* Resume using proof and matching live session. */ }
  } catch { return failed("Your invitation could not be opened. Try again or contact your administrator."); }
  redirect("/staff/real/set-password");
});
const invitationFields = z.object({ invitationId: z.uuid(), generation: z.coerce.number().int().positive().safe() });
/** Telegram invitations (T-auth B-2a): a code to the Telegram account that proved the invited phone. */
export const sendTelegramInvitationCode = loggedAction("sendTelegramInvitationCode",async function sendTelegramInvitationCode(_previous: StaffAdminActionState, form: FormData): Promise<StaffAdminActionState> {
  if (!await staffInvitationPageAvailable()) return failed("Staff invitations are unavailable. Contact your administrator.");
  const input = invitationFields.extend({ telegram: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }).safeParse({ invitationId: form.get("invitationId"), generation: form.get("generation"), telegram: form.get("telegram") });
  if (!input.success) return failed("This invitation is incomplete. Ask your administrator for a new one.");
  try {
    const r = await sendInviteCode(input.data.invitationId, input.data.generation, input.data.telegram);
    if (r.ok) return { ok: true, message: "We sent a code to your Telegram. Enter it below." };
    return failed(r.reason === "not_proven" ? "Open Telegram first and share your phone number in the Noreon bot." : r.reason === "busy" ? "You asked for several codes. Wait a few minutes and try again." : "We could not send a code. Try again.");
  } catch { return failed("We could not send a code. Try again."); }
});
export const acceptTelegramDoctorInvitation = loggedAction("acceptTelegramDoctorInvitation",async function acceptTelegramDoctorInvitation(_previous: StaffAdminActionState, form: FormData): Promise<StaffAdminActionState> {
  if (!await staffInvitationPageAvailable()) return failed("Staff invitations are unavailable. Contact your administrator.");
  const input = invitationFields.extend({ code: z.string().regex(/^\d{6}$/) })
    .safeParse({ invitationId: form.get("invitationId"), generation: form.get("generation"), code: String(form.get("code") ?? "").trim() });
  if (!input.success) return failed("Enter the 6-digit code from Telegram.");
  try {
    const r = await acceptTelegramInvitation(input.data);
    if (!r.ok) return failed(r.reason === "invalid_code" ? "That code is not right. Check it and try again." : r.reason === "resend" ? "This code no longer works. Send a new code." : "This invitation is no longer available. Ask your administrator for a new one.");
    await writeInvitationProof(r.context, r.userId, r.sessionId, "verified");
    try { await invitationWriteClient().rpc("real_staff_record_invitation_verification", { p_invitation_id: r.context.id, p_generation: r.context.generation, p_auth_user_id: r.userId }); } catch { /* Resume using proof and matching live session. */ }
  } catch { return failed("Your invitation could not be opened. Try again or contact your administrator."); }
  redirect("/staff/real/set-password");
});
type PasswordActionState = StaffAdminActionState & {passwordSaved?: boolean};
const activationPending = (message: string): PasswordActionState => ({ok: false, message, passwordSaved: true});
async function finalizeSetup(setup: NonNullable<Awaited<ReturnType<typeof doctorSetupSession>>>) {
  if (setup.proof.stage !== "password_set") return failed("Set your password before activating your account.");
  try {
    const result = await invitationWriteClient().rpc("real_staff_finalize_invitation", { p_invitation_id: setup.context.id, p_generation: setup.context.generation, p_auth_user_id: setup.user.id,p_auth_session_id:setup.sessionId });
    if (result.error) return activationPending("Your password is saved, but account activation is pending. Try activation again.");
  } catch { return activationPending("Your password is saved, but account activation is pending. Try activation again."); }
  await clearInvitationProof();
  redirect("/staff/real/members");
}
export const setRealDoctorPassword = loggedAction("setRealDoctorPassword",async function setRealDoctorPassword(_previous: StaffAdminActionState, form: FormData): Promise<PasswordActionState> {
  const input = z.object({ password: z.string().min(12).max(128), confirmation: z.string().min(12).max(128) }).safeParse({ password: form.get("password"), confirmation: form.get("confirmation") });
  if (!input.success || input.data.password !== input.data.confirmation) return failed("Use at least 12 characters and enter the same password twice.");
  const setup = await doctorSetupSession().catch(() => undefined);
  if (setup === undefined) return failed("Account setup is temporarily unavailable. Try again in a moment.");
  if (!setup) return failed("Your setup session expired. Ask your administrator for a new invitation.");
  if (setup.context.status === "accepted") { await clearInvitationProof(); redirect("/staff/real/members"); }
  if (setup.proof.stage === "password_set") return finalizeSetup(setup);
  const recorded = await invitationWriteClient().rpc("real_staff_record_invitation_verification", { p_invitation_id: setup.context.id, p_generation: setup.context.generation, p_auth_user_id: setup.user.id });
  if (recorded.error) return failed("Account setup is waiting. Try again in a moment.");
  const saved = await setup.client.auth.updateUser({ password: input.data.password });
  if (saved.error || saved.data.user?.id !== setup.user.id) return failed("Your password could not be saved. Choose another password and try again.");
  await writeInvitationProof(setup.context, setup.user.id,setup.sessionId, "password_set");
  const completed = await doctorSetupSession().catch(() => undefined);
  if (!completed) return activationPending("Your password is saved, but setup could not be completed. Try activation again.");
  return finalizeSetup(completed);
});
export const retryRealDoctorActivation = loggedAction("retryRealDoctorActivation",async function retryRealDoctorActivation(_previous: StaffAdminActionState, _form: FormData): Promise<StaffAdminActionState> {
  void _previous; void _form;
  const setup = await doctorSetupSession().catch(() => undefined);
  if (setup === undefined) return failed("Account activation is temporarily unavailable. Try again in a moment.");
  if (!setup) return failed("Your setup session expired. Ask your administrator for a new invitation.");
  return finalizeSetup(setup);
});
