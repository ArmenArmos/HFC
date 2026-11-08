"use server";
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {requireRealAdmin, realStaffInvitationReady, realStaffDirectoryRowSchema} from "./real-admin";
import {invitationContextSchema, type StaffAdminActionState} from "./real-invitation-dispatch";
import {sendManagedDoctorInvitation, sendTelegramDoctorInvitation} from "./real-invitations";
import {telegramStaffInvitationReady} from "@/lib/telegram-auth/staff-invite-config";

type ActionState = StaffAdminActionState & {operationCreated?: boolean; outcomeUnknown?: boolean; inviteUrl?: string};
const unavailable: ActionState = {ok: false, message: "Invitations are unavailable until invitation setup is complete."};
const staffInvitationSchema = invitationContextSchema.extend({role: z.enum(["doctor", "nurse"])});
const operationInput = z.object({staffId: z.uuid(), expectedVersion: z.string().regex(/^[a-f0-9]{32}$/), requestId: z.uuid()});
function knownRejection(error: {code?: string}, status?: number) {
  // PostgREST maps serialization_failure (40001) to HTTP 500 even though
  // PostgreSQL has rejected and rolled back the mutation.
  if (status && status >= 500 && status !== 500) return false;
  const rollbackCodes = ["40001", "23514", "42501", "22023", "23505"];
  return !!error.code && (rollbackCodes.includes(error.code) || (status !== 500 && error.code === "P0001"));
}
function unknownOutcome(): ActionState {
  revalidatePath("/staff/real/doctors");
  return {ok: false, outcomeUnknown: true, message: "The result is unconfirmed. Check the staff list before making another change."};
}
function rejectedManagement(code?: string): ActionState {
  const message = code === "40001" ? "Staff details changed. Reload the directory before saving again." : code === "23514" ? "Reassign members before changing clinic or removing access." : code === "42501" ? "Staff or clinic access changed. Reload the directory and check the clinic." : "The change was not saved. Check the details and current assignments.";
  return {ok: false, outcomeUnknown: false, message};
}

export const createRealClinic=loggedAction("createRealClinic",async function createRealClinic(_previous: StaffAdminActionState, form: FormData): Promise<StaffAdminActionState> {
  const {client} = await requireRealAdmin();
  const input = z.object({name: z.string().trim().min(1).max(160), address: z.string().trim().min(1).max(500)}).safeParse({name: form.get("name"), address: form.get("address")});
  if (!input.success) return {ok: false, message: "Check the clinic name and address."};
  const result = await client.rpc("real_admin_create_clinic", {p_name: input.data.name, p_address: input.data.address});
  if (result.error) return {ok: false, message: "The clinic could not be saved. Check the details and try again."};
  revalidatePath("/staff/real/clinics"); revalidatePath("/staff/real/doctors");
  return {ok: true, message: "Clinic added."};
});

async function inviteStaff(form: FormData, fixedRole?: "doctor"): Promise<ActionState> {
  const {client, identity} = await requireRealAdmin();
  // Telegram delivery replaces email when it is configured (T-auth B-2a); email stays behind its own flags.
  const telegram = telegramStaffInvitationReady();
  const phone = String(form.get("phone") ?? "").replace(/[\s()-]/g, "");
  if (!telegram && !realStaffInvitationReady()) return unavailable;
  if (telegram && !/^\+[1-9]\d{6,14}$/.test(phone)) return {ok: false, message: "Enter the team member's phone number with the country code, for example +37499123456."};
  const input = z.object({requestId: z.uuid(), name: z.string().trim().min(1).max(160), email: z.email().max(254), clinicId: z.uuid(), role: z.enum(["doctor", "nurse"])}).safeParse({requestId: form.get("requestId"), name: form.get("name"), email: String(form.get("email") ?? "").trim().toLowerCase(), clinicId: form.get("clinicId"), role: fixedRole ?? form.get("role")});
  if (!input.success) return {ok: false, message: "Check the staff role, name, email and clinic."};
  let reserved;
  try {reserved = await client.rpc("real_admin_reserve_staff_invitation", {p_request_id: input.data.requestId, p_email: input.data.email, p_display_name: input.data.name, p_clinic_id: input.data.clinicId, p_role: input.data.role});}
  catch {return unknownOutcome();}
  if (reserved.error) return knownRejection(reserved.error, reserved.status) ? {ok: false, outcomeUnknown: false, message: "The invitation was not created. Check the clinic and whether this email already has an account."} : unknownOutcome();
  try {
    const context = staffInvitationSchema.parse(reserved.data);
    if (context.issuerId !== identity.id || context.role !== input.data.role || context.name !== input.data.name || context.email !== input.data.email || context.clinicId !== input.data.clinicId) throw Error("Invitation identity changed.");
    const result = telegram ? await sendTelegramDoctorInvitation(context, phone) : await sendManagedDoctorInvitation(context);
    revalidatePath("/staff/real/doctors");
    return {...result, reservationCreated: true};
  } catch {
    revalidatePath("/staff/real/doctors");
    return {ok: false, reservationCreated: true, message: "The invitation was reserved, but setup could not be completed. Check the staff list before sending another."};
  }
}
export const inviteRealStaff=loggedAction("inviteRealStaff",async function inviteRealStaff(_previous: ActionState, form: FormData): Promise<ActionState> {return inviteStaff(form);});
export const inviteRealDoctor=loggedAction("inviteRealDoctor",async function inviteRealDoctor(_previous: ActionState, form: FormData): Promise<ActionState> {return inviteStaff(form, "doctor");});

async function reissueInvitation(form: FormData, doctorOnly: boolean): Promise<ActionState> {
  const {client, identity} = await requireRealAdmin();
  const telegram = telegramStaffInvitationReady();
  const phone = String(form.get("phone") ?? "").replace(/[\s()-]/g, "");
  if (!telegram && !realStaffInvitationReady()) return unavailable;
  if (telegram && !/^\+[1-9]\d{6,14}$/.test(phone)) return {ok: false, message: "Enter the team member's phone number with the country code, for example +37499123456."};
  const input = z.object({requestId: z.uuid(), invitationId: z.uuid(), generation: z.coerce.number().int().positive().safe()}).safeParse({requestId: form.get("requestId"), invitationId: form.get("invitationId"), generation: form.get("generation")});
  if (!input.success) return {ok: false, message: "Reload the staff list and try again."};
  let reserved;
  try {
    const args = {p_invitation_id: input.data.invitationId, p_expected_generation: input.data.generation, p_request_id: input.data.requestId};
    reserved = doctorOnly ? await client.rpc("real_admin_reissue_doctor_invitation", args) : await client.rpc("real_admin_reissue_staff_invitation", args);
  } catch {return unknownOutcome();}
  if (reserved.error) return knownRejection(reserved.error, reserved.status) ? {ok: false, outcomeUnknown: false, message: "The invitation changed or is still processing. Reload the list or wait two minutes before retrying."} : unknownOutcome();
  try {
    const context = staffInvitationSchema.parse(reserved.data);
    if (context.issuerId !== identity.id || context.id !== input.data.invitationId || context.generation !== input.data.generation + 1 || (doctorOnly && context.role !== "doctor")) throw Error("Invitation changed.");
    const result = telegram ? await sendTelegramDoctorInvitation(context, phone) : await sendManagedDoctorInvitation(context);
    revalidatePath("/staff/real/doctors");
    return {...result, reservationCreated: true};
  } catch {
    revalidatePath("/staff/real/doctors");
    return {ok: false, reservationCreated: true, message: "The new invitation was reserved, but setup could not be completed. Check the staff list before sending another."};
  }
}
export const reissueRealStaffInvitation=loggedAction("reissueRealStaffInvitation",async function reissueRealStaffInvitation(_previous: ActionState, form: FormData): Promise<ActionState> {return reissueInvitation(form, false);});
export const reissueRealDoctorInvitation=loggedAction("reissueRealDoctorInvitation",async function reissueRealDoctorInvitation(_previous: ActionState, form: FormData): Promise<ActionState> {return reissueInvitation(form, true);});

export const updateRealStaff=loggedAction("updateRealStaff",async function updateRealStaff(_previous: ActionState, form: FormData): Promise<ActionState> {
  const {client} = await requireRealAdmin();
  const input = operationInput.extend({name: z.string().trim().min(1).max(160), clinicId: z.uuid()}).safeParse({staffId: form.get("staffId"), expectedVersion: form.get("expectedVersion"), requestId: form.get("requestId"), name: form.get("name"), clinicId: form.get("clinicId")});
  if (!input.success) return {ok: false, outcomeUnknown: false, message: "Check the staff name and clinic, then reload outdated details."};
  try {
    const result = await client.rpc("real_admin_update_staff", {p_staff_id: input.data.staffId, p_expected_version: input.data.expectedVersion, p_display_name: input.data.name, p_clinic_id: input.data.clinicId, p_request_id: input.data.requestId});
    if (result.error) return knownRejection(result.error, result.status) ? rejectedManagement(result.error.code) : unknownOutcome();
    const row = realStaffDirectoryRowSchema.parse(result.data);
    if (row.id !== input.data.staffId || row.name !== input.data.name || row.clinicId !== input.data.clinicId) return unknownOutcome();
    revalidatePath("/staff/real/doctors");
    return {ok: true, operationCreated: true, message: "Staff details saved."};
  } catch {return unknownOutcome();}
});
export const removeRealStaffAccess=loggedAction("removeRealStaffAccess",async function removeRealStaffAccess(_previous: ActionState, form: FormData): Promise<ActionState> {
  const {client} = await requireRealAdmin();
  const input = operationInput.safeParse({staffId: form.get("staffId"), expectedVersion: form.get("expectedVersion"), requestId: form.get("requestId")});
  if (!input.success) return {ok: false, outcomeUnknown: false, message: "Reload the staff directory before removing access."};
  try {
    const result = await client.rpc("real_admin_remove_staff", {p_staff_id: input.data.staffId, p_expected_version: input.data.expectedVersion, p_request_id: input.data.requestId});
    if (result.error) return knownRejection(result.error, result.status) ? rejectedManagement(result.error.code) : unknownOutcome();
    const row = realStaffDirectoryRowSchema.parse(result.data);
    if (row.id !== input.data.staffId || row.active || !["revoked", "removed"].includes(row.status)) return unknownOutcome();
    revalidatePath("/staff/real/doctors");
    return {ok: true, operationCreated: true, message: "Staff access removed."};
  } catch {return unknownOutcome();}
});
