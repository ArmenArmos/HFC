import "server-only";
import { z } from "zod";
import { doctorLdlSchema, eventCommandSchema, goalCommandSchema, ldlStatuses, memberLdlSchema, therapyCommandSchema, type DoctorLdl, type LdlCommandResult, type MemberLdl } from "./schema";

export type LdlRpc = { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }> };

/** Assigned doctor only. Null when unreadable: the panel says so. */
export async function readDoctorLdl(c: LdlRpc, memberId: string): Promise<DoctorLdl | null> {
  try {
    const r = await c.rpc("doctor_ldl_read", { p_member: memberId });
    if (r.error) return null;
    const p = doctorLdlSchema.safeParse(r.data);
    return p.success ? p.data : null;
  } catch { return null; }
}
/** The member's own goal. Undefined when unreadable: the card stays hidden. */
export async function readMemberLdl(c: LdlRpc): Promise<MemberLdl | undefined> {
  try {
    const r = await c.rpc("member_ldl_read");
    if (r.error) return undefined;
    const p = memberLdlSchema.safeParse(r.data);
    return p.success ? p.data : undefined;
  } catch { return undefined; }
}

async function run(c: LdlRpc, name: string, args: Record<string, unknown>): Promise<LdlCommandResult> {
  try {
    const r = await c.rpc(name, args);
    if (r.error) return { status: r.error.code === "42501" ? "access" : r.error.code === "55P03" ? "unavailable" : "outcome-unknown" };
    const s = (r.data as { status?: string } | null)?.status;
    return (ldlStatuses as readonly string[]).includes(s ?? "") ? { status: s as LdlCommandResult["status"] } : { status: "outcome-unknown" };
  } catch { return { status: "outcome-unknown" }; }
}
/** Adds resend their submission id, so an unknown outcome can be retried without a second row. */
export function runLdlEventAdd(c: LdlRpc, input: unknown) {
  const p = eventCommandSchema.safeParse(input);
  return p.success ? run(c, "doctor_ldl_event_add", { p_command: p.data }) : Promise.resolve<LdlCommandResult>({ status: "invalid" });
}
export function runLdlTherapyAdd(c: LdlRpc, input: unknown) {
  const p = therapyCommandSchema.safeParse(input);
  return p.success ? run(c, "doctor_ldl_therapy_add", { p_command: p.data }) : Promise.resolve<LdlCommandResult>({ status: "invalid" });
}
export function runLdlGoalSet(c: LdlRpc, input: unknown) {
  const p = goalCommandSchema.safeParse(input);
  return p.success ? run(c, "doctor_ldl_goal_set", { p_command: p.data }) : Promise.resolve<LdlCommandResult>({ status: "invalid" });
}
const removeSchema = z.strictObject({ memberId: z.uuid(), eventId: z.uuid() });
export function runLdlEventRemove(c: LdlRpc, input: unknown) {
  const p = removeSchema.safeParse(input);
  return p.success ? run(c, "doctor_ldl_event_remove", { p_member: p.data.memberId, p_event: p.data.eventId }) : Promise.resolve<LdlCommandResult>({ status: "invalid" });
}
const endSchema = z.strictObject({ memberId: z.uuid(), therapyId: z.uuid(), reason: z.enum(["stopped", "entered_in_error"]), stoppedOn: z.iso.date().nullable() });
export function runLdlTherapyEnd(c: LdlRpc, input: unknown) {
  const p = endSchema.safeParse(input);
  return p.success ? run(c, "doctor_ldl_therapy_end", { p_member: p.data.memberId, p_therapy: p.data.therapyId, p_reason: p.data.reason, p_stopped_on: p.data.stoppedOn }) : Promise.resolve<LdlCommandResult>({ status: "invalid" });
}
