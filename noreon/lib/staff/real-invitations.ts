import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { z } from "zod";
import { doctorInvitationOrigin, sendDoctorInvitation } from "@/lib/messaging/brevo-email";
import { dispatchDoctorInvitation, invitationContextSchema, type InvitationContext, type InvitationDispatch } from "./real-invitation-dispatch";
import { telegramStaffInvitationReady } from "@/lib/telegram-auth/staff-invite-config";
import { staffInvitationConfig } from "./real-admin";

export function invitationWriteClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Error("Staff account setup is unavailable.");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
    }) },
  });
}
export class InvitationNoLongerAvailable extends Error {}
export async function getInvitationContext(id: string, generation: number, db = invitationWriteClient()) {
  const result = await db.rpc("real_staff_invitation_context", { p_invitation_id: id, p_generation: generation });
  if (result.error) {
    if (["42501", "40001"].includes(result.error.code)) throw new InvitationNoLongerAvailable("Invitation unavailable.");
    throw Error("Invitation temporarily unavailable.");
  }
  return invitationContextSchema.parse(result.data);
}
type InvitationSender = { origin: string; send: InvitationDispatch["send"] };
function invitationDeps(context: InvitationContext, db: ReturnType<typeof invitationWriteClient>, sender: InvitationSender): InvitationDispatch {
  const operation = { p_invitation_id: context.id, p_generation: context.generation, p_operation_id: context.operationId };
  return {
    origin: sender.origin,
    async claim() {
      const result = await db.rpc("real_staff_claim_invitation_dispatch", operation);
      if (result.error) throw Error("Dispatch unavailable.");
      return invitationContextSchema.extend({ claimed: z.boolean() }).parse(result.data);
    },
    async readUser(id) {
      const result = await db.auth.admin.getUserById(id);
      if (result.error?.status === 404) return null;
      if (result.error || !result.data.user?.email) throw Error("Account lookup unavailable.");
      return { id: result.data.user.id, email: result.data.user.email, confirmed: Boolean(result.data.user.email_confirmed_at) };
    },
    async createUser(id, email) {
      const attributes = { id, email, email_confirm: false };
      const result = await db.auth.admin.createUser(attributes);
      if (result.error || !result.data.user?.email) throw Error("Account creation unconfirmed.");
      return { id: result.data.user.id, email: result.data.user.email, confirmed: Boolean(result.data.user.email_confirmed_at) };
    },
    async bind(id) {
      const result = await db.rpc("real_staff_bind_invitation_identity", { ...operation, p_auth_user_id: id });
      if (result.error) throw Error("Invitation binding unavailable.");
      return invitationContextSchema.parse(result.data);
    },
    async generateLink(email, type) {
      const result = await db.auth.admin.generateLink({ type, email });
      if (result.error || !result.data.user || !result.data.properties?.hashed_token) throw Error("Invitation link unavailable.");
      return { userId: result.data.user.id, tokenHash: result.data.properties.hashed_token };
    },
    async storeToken(digest, type) {
      const result = await db.rpc("real_staff_store_invitation_token", { ...operation, p_token_digest: digest, p_token_type: type });
      if (result.error) throw Error("Invitation changed.");
      return invitationContextSchema.parse(result.data);
    },
    send: sender.send,
    async record(result) {
      const recorded = await db.rpc("real_staff_record_invitation_submission", {
        ...operation, p_outcome: result.status, p_provider_reference: result.status === "accepted" ? result.reference : undefined,
      });
      if (recorded.error) throw Error("Invitation status unavailable.");
    },
  };
}
export async function sendManagedDoctorInvitation(context: InvitationContext) {
  const config = staffInvitationConfig();
  if (!config) return { ok: false, message: "Invitations are unavailable until email setup is complete." };
  return dispatchDoctorInvitation(context, invitationDeps(context, invitationWriteClient(), { origin: config.email.origin, send: input => sendDoctorInvitation(config.email, input) }));
}
/**
 * Telegram delivery (T-auth B-2a): no email. The same reserve, bind and link steps run; instead of
 * sending, the server opens the invited phone's Telegram proof and hands the admin one link to
 * pass on. The invitee opens it, shares that number in the bot and confirms a code from it.
 */
export async function sendTelegramDoctorInvitation(context: InvitationContext, phone: string) {
  if (!telegramStaffInvitationReady()) return { ok: false, message: "Telegram invitations are unavailable." };
  const db = invitationWriteClient();
  let inviteUrl: string | undefined;
  const result = await dispatchDoctorInvitation(context, invitationDeps(context, db, {
    origin: doctorInvitationOrigin(),
    async send(input) {
      const issued = await db.rpc("staff_invitation_telegram_issue", { p_invitation_id: context.id, p_generation: context.generation, p_operation_id: context.operationId, p_phone: phone });
      const parsed = z.object({ ok: z.literal(true), token: z.string().regex(/^[A-Za-z0-9_-]{32}$/) }).safeParse(issued.data);
      if (issued.error || !parsed.success) return { status: "failed" };
      // The Supabase invite token is not handed out: the server opens the session after the code (review B-2a #2).
      const url = new URL("/staff/real/invite", input.url);
      url.hash = new URLSearchParams({ invitation: context.id, generation: String(context.generation), telegram: parsed.data.token }).toString();
      inviteUrl = url.href;
      return { status: "accepted", reference: "telegram-link" };
    },
  }));
  return result.ok && inviteUrl
    ? { ok: true, message: "Invitation ready. Send this link to the team member. They open it, share their phone number in the Noreon bot and enter the code it sends. It is shown only once.", inviteUrl }
    : { ...result, message: result.ok ? "The invitation could not be prepared. Check the staff list before sending another." : result.message.replace("Email delivery", "Delivery") };
}
