import { z } from "zod";
import { DEFAULT_PERSONAL_BP_TARGET, PERSONAL_BP_DEFAULTS_VERSION, type PersonalBpTarget } from "@/lib/clinical/rules/personal-bp";

/** Shapes of the member_bp_targets reads and the physician's command (20261108080606_member_bp_targets.sql). */
export const BP_TARGET_COMMAND_VERSION = "bp-target-v1";
/**
 * The plausibility windows the database CHECKs repeat. These bound what can be stored, not what is clinically right:
 * the clinical defaults are THRESHOLD.personalBp* (lib/clinical/rules/thresholds.ts).
 */
export const BP_TARGET_BOUNDS = {
  homeSystolicTarget: [100, 160], homeDiastolicTarget: [55, 100],
  alertHighSystolic: [120, 180], alertHighDiastolic: [70, 120], alertHighConsecutive: [1, 5],
  alertLowSystolic: [70, 110], alertLowPulse: [30, 60],
} as const satisfies Record<keyof PersonalBpTarget, readonly [number, number]>;
export const BP_TARGET_FIELDS = Object.keys(BP_TARGET_BOUNDS) as (keyof PersonalBpTarget)[];

const uuid = z.uuid(), instant = z.iso.datetime({ offset: true });
const int = (k: keyof PersonalBpTarget) => z.number().int().min(BP_TARGET_BOUNDS[k][0]).max(BP_TARGET_BOUNDS[k][1]);
const values = z.object(Object.fromEntries(BP_TARGET_FIELDS.map(k => [k, int(k)])) as Record<keyof PersonalBpTarget, z.ZodNumber>);

/** The same cross-field rules as the table: below the alert, and the low alert below the target. */
export function targetConsistent(t: PersonalBpTarget) {
  return t.homeDiastolicTarget < t.homeSystolicTarget && t.alertHighSystolic > t.homeSystolicTarget && t.alertHighDiastolic > t.homeDiastolicTarget && t.alertLowSystolic < t.homeSystolicTarget;
}
export const differsFromDefaults = (t: PersonalBpTarget) => BP_TARGET_FIELDS.some(k => t[k] !== DEFAULT_PERSONAL_BP_TARGET[k]);

/** A reason is needed for every change after the first version, and for any first version that departs from the defaults. */
export const bpTargetCommandSchema = z.strictObject({
  version: z.literal(BP_TARGET_COMMAND_VERSION), memberId: uuid, submissionId: uuid, expectedVersion: z.number().int().min(0),
  ...values.shape,
  reason: z.string().trim().min(1).max(500).nullable(),
  defaultsVersion: z.string().regex(/^[a-z0-9.-]{1,40}$/),
}).refine(targetConsistent, { message: "inconsistent" })
  .refine(c => c.reason !== null || (c.expectedVersion === 0 && !differsFromDefaults(c)), { message: "reason" });
export type BpTargetCommand = z.infer<typeof bpTargetCommandSchema>;

export const bpTargetStatuses = ["saved", "replayed", "stale", "invalid", "unavailable", "access", "outcome-unknown"] as const;
export type BpTargetStatus = (typeof bpTargetStatuses)[number];
export type BpTargetCommandResult = { status: BpTargetStatus; targetVersion?: number };

const physicianRole = z.enum(["family_physician", "cardiologist"]);
const memberTarget = z.object({
  version: z.number().int(), homeSystolicTarget: z.number().int(), homeDiastolicTarget: z.number().int(),
  setAt: instant, setByRole: physicianRole, physicianName: z.string().nullable(),
});
export const staffTargetSchema = memberTarget.extend({
  alertHighSystolic: z.number().int(), alertHighDiastolic: z.number().int(), alertHighConsecutive: z.number().int(),
  alertLowSystolic: z.number().int(), alertLowPulse: z.number().int(), reason: z.string().nullable(), defaultsVersion: z.string(), byYou: z.boolean(),
});
export type StaffBpTarget = z.infer<typeof staffTargetSchema>;
export type MemberBpTarget = z.infer<typeof memberTarget>;
export const doctorBpTargetReadSchema = z.object({
  version: z.literal("bp-target-read-v1"), canSet: z.boolean(), role: physicianRole.nullable(),
  current: staffTargetSchema.nullable(), history: z.array(staffTargetSchema),
});
export type DoctorBpTargetRead = z.infer<typeof doctorBpTargetReadSchema>;
export const memberBpTargetReadSchema = z.object({ version: z.literal("bp-target-member-v1"), target: memberTarget.nullable() });
export const caregiverBpTargetReadSchema = memberBpTargetReadSchema.extend({ ok: z.literal(true) });
/** The service read the BP flow and sweeps use (bp_personal_context). */
export const bpPersonalContextSchema = z.object({
  version: z.literal("bp-personal-context-v1"),
  target: staffTargetSchema.omit({ byYou: true }).nullable(),
  readings: z.array(z.object({ id: uuid, systolic: z.number().int(), diastolic: z.number().int(), pulse: z.number().int().nullable(), measuredAt: instant, entrySource: z.string().nullable() })),
});
export type BpPersonalContext = z.infer<typeof bpPersonalContextSchema>;

/** The engine's view of a stored target. */
export const personalTarget = (t: Pick<StaffBpTarget, keyof PersonalBpTarget> | null): PersonalBpTarget | null =>
  t ? Object.fromEntries(BP_TARGET_FIELDS.map(k => [k, t[k]])) as PersonalBpTarget : null;

/** What the targets card proposes: the current version, else the THRESHOLD defaults. */
export function proposedTarget(current: StaffBpTarget | null): PersonalBpTarget & { defaultsVersion: string } {
  return { ...(personalTarget(current) ?? DEFAULT_PERSONAL_BP_TARGET), defaultsVersion: PERSONAL_BP_DEFAULTS_VERSION };
}
