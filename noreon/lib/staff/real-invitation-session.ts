import "server-only";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { realStaffClient } from "@/lib/patient-care/clinical-case-repository";
import { staffInvitationConfig, staffInvitationSecret } from "./real-admin";
import { telegramStaffInvitationReady } from "@/lib/telegram-auth/staff-invite-config";
import { getInvitationContext, InvitationNoLongerAvailable } from "./real-invitations";
import { verifyInvitationProof, invitationProofMatches, issueInvitationProof, type InvitationProof } from "./invitation-proof";
import type { InvitationContext } from "./real-invitation-dispatch";
import { validatedStaffSession } from "./real-session-binding";
import { staffHostAllowed } from "./hosts";

export const invitationProofCookie = () => process.env.NODE_ENV === "production" ? "__Host-noreon-doctor-setup" : "noreon-doctor-setup";
export async function doctorInvitationAvailable() {
  // Every staff host, from the one list (review item 15): the doctor.noreon.health alias used to 404 here.
  // In production the host must be exact: staffPortalForHost ignores a port (review R2 on #343).
  const host = (await headers()).get("host") ?? "";
  if ((process.env.NODE_ENV === "production" && host.includes(":")) || !staffHostAllowed(host)) notFound();
  return staffInvitationConfig() !== null;
}
/** The invite and set-password pages: email invitations or Telegram invitations (T-auth B-2a). Recovery keeps the email-only check. */
export async function staffInvitationPageAvailable() {
  return await doctorInvitationAvailable() || telegramStaffInvitationReady();
}
export async function writeInvitationProof(context: InvitationContext, userId: string, sessionId:string, stage: InvitationProof["stage"]) {
  const secret = staffInvitationSecret();
  if (!secret || context.authUserId !== userId || context.expectedAuthUserId !== userId) throw Error("Invitation unavailable.");
  const value = issueInvitationProof({ invitationId: context.id, generation: context.generation, userId, sessionId, stage, invitationExpiresAt: Date.parse(context.expiresAt) }, secret);
  (await cookies()).set(invitationProofCookie(), value, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/",
    maxAge: Math.max(1, Math.floor((Math.min(Date.now() + 600_000, Date.parse(context.expiresAt)) - Date.now()) / 1000)),
  });
}
export async function clearInvitationProof() { (await cookies()).delete(invitationProofCookie()); }
export async function doctorSetupSession() {
  if (!await staffInvitationPageAvailable()) return null;
  const secret = staffInvitationSecret();
  if (!secret) return null;
  const proof = verifyInvitationProof((await cookies()).get(invitationProofCookie())?.value ?? "", secret);
  if (!proof) return null;
  const client = await realStaffClient();
  const session=await validatedStaffSession(client.auth);
  if(!session || session.user.id!==proof.userId || session.sessionId!==proof.sessionId) return null;
  const {user,sessionId}=session;
  try {
    const context = await getInvitationContext(proof.invitationId, proof.generation);
    if (!invitationProofMatches(proof, context, user.id,sessionId) || user.email!.toLowerCase() !== context.email) return null;
    return { client, user, context, proof,sessionId };
  } catch (error) { if (error instanceof InvitationNoLongerAvailable) return null; throw error; }
}
export async function readDoctorSetup() {
  try {
    const setup = await doctorSetupSession();
    return setup ? { name: setup.context.name, stage: setup.context.status === "accepted" ? "accepted" as const : setup.proof.stage } : null;
  } catch { return { name: "", stage: "unavailable" as const }; }
}
