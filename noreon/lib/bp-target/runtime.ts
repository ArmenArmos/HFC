import "server-only";
import {
  bpPersonalContextSchema, bpTargetCommandSchema, bpTargetStatuses, caregiverBpTargetReadSchema, doctorBpTargetReadSchema, memberBpTargetReadSchema,
  type BpPersonalContext, type BpTargetCommandResult, type DoctorBpTargetRead, type MemberBpTarget,
} from "./schema";

/** A session client (or a fake in checks). New RPCs are not in lib/db/types.ts yet, hence the loose name. */
export type BpTargetRpc = { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }> };

/** The care team's read (assigned doctor, cardiologist or nurse). Null when unreadable or refused: the card says so. */
export async function readDoctorBpTarget(c: BpTargetRpc, memberId: string): Promise<DoctorBpTargetRead | null> {
  try {
    const r = await c.rpc("doctor_bp_target_read", { p_member: memberId });
    if (r.error) return null;
    const p = doctorBpTargetReadSchema.safeParse(r.data);
    return p.success ? p.data : null;
  } catch { return null; }
}
/** The member's own target. Undefined when unreadable (nothing is drawn); null when no physician has set one. */
export async function readMemberBpTarget(c: BpTargetRpc): Promise<MemberBpTarget | null | undefined> {
  try {
    const r = await c.rpc("member_bp_target_read");
    if (r.error) return undefined;
    const p = memberBpTargetReadSchema.safeParse(r.data);
    return p.success ? p.data.target : undefined;
  } catch { return undefined; }
}
/** A caregiver with view_plan. Undefined when refused or unreadable. */
export async function readCaregiverBpTarget(c: BpTargetRpc, memberId: string): Promise<MemberBpTarget | null | undefined> {
  try {
    const r = await c.rpc("caregiver_bp_target_read", { p_member: memberId });
    if (r.error) return undefined;
    const p = caregiverBpTargetReadSchema.safeParse(r.data);
    return p.success ? p.data.target : undefined;
  } catch { return undefined; }
}

/** 42501 access, 55P03 unavailable, anything else an unknown outcome the card retries with the same submission id. */
export async function runBpTargetSet(c: BpTargetRpc, input: unknown): Promise<BpTargetCommandResult> {
  const p = bpTargetCommandSchema.safeParse(input);
  if (!p.success) return { status: "invalid" };
  try {
    const r = await c.rpc("doctor_bp_target_set", { p_command: p.data });
    if (r.error) return { status: r.error.code === "42501" ? "access" : r.error.code === "55P03" ? "unavailable" : "outcome-unknown" };
    const d = r.data as { status?: string; targetVersion?: unknown } | null;
    if (!(bpTargetStatuses as readonly string[]).includes(d?.status ?? "")) return { status: "outcome-unknown" };
    return { status: d!.status as BpTargetCommandResult["status"], ...(typeof d!.targetVersion === "number" ? { targetVersion: d!.targetVersion } : {}) };
  } catch { return { status: "outcome-unknown" }; }
}

/** Service role: the member's target and recent readings for the BP flow. Null when unreadable: the flow falls back to defaults. */
export async function readBpPersonalContext(rpc: (name: string, args: Record<string, unknown>) => Promise<unknown>, memberId: string, days = 14): Promise<BpPersonalContext | null> {
  try {
    const p = bpPersonalContextSchema.safeParse(await rpc("bp_personal_context", { p_member: memberId, p_days: days }));
    return p.success ? p.data : null;
  } catch { return null; }
}
