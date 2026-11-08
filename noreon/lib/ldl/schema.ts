import { z } from "zod";
import { LDL_CATEGORIES, LDL_CATEGORY_GOALS } from "./constants";

/** Shapes of doctor_ldl_read / member_ldl_read and of the doctor's commands (20261029171957_ldl_goal_phase1.sql). */
export const LDL_COMMAND_VERSION = "ldl-goal-v1";
export const LDL_EVENT_TYPES = ["acs_mi", "ischaemic_stroke", "tia", "haemorrhagic_stroke", "other"] as const;
export const LDL_DRUGS = ["atorvastatin", "rosuvastatin", "simvastatin", "pravastatin", "pitavastatin", "fluvastatin", "ezetimibe", "evolocumab", "alirocumab", "inclisiran", "bempedoic_acid", "other"] as const;
export type LdlEventType = (typeof LDL_EVENT_TYPES)[number];
export type LdlDrug = (typeof LDL_DRUGS)[number];

const uuid = z.uuid(), instant = z.iso.datetime({ offset: true }), day = z.iso.date();
const num = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]);
export const ldlObservationSchema = z.object({
  id: z.string(), value: num, unit: z.string(), on: day,
  source: z.enum(["member", "upload_checked", "clinic_result", "clinic_reviewed"]), name: z.string().nullable(), memberVisible: z.boolean(),
});
export const ldlGoalBaseSchema = z.object({
  version: z.number().int(), category: z.enum(LDL_CATEGORIES), thresholdMmol: num, reductionRule: z.boolean(), reductionPct: z.number().int().nullable(),
  baseline: z.object({ kind: z.enum(["pre_treatment", "on_treatment", "unknown"]), mmol: num.nullable(), on: day.nullable(), source: z.enum(["document", "lab_result", "doctor_entered"]).nullable() }),
  nextTestOn: day.nullable(), setAt: instant, doctorName: z.string().nullable(),
});
const visitTerms = z.object({ provider: z.string(), startsAt: instant, endsAt: instant, preparation: z.string() });
/** The member's open LDL request (lib/ldl/retest.ts): accepted from the goal card, not only from the tests page. */
export const ldlMemberRequestSchema = z.object({ id: uuid, revision: z.number().int(), status: z.string(), algorithmVersion: z.string(), proposal: visitTerms.nullable(), arrangement: visitTerms.nullable() });
const memberRetest = z.object({ id: uuid, dueFrom: day, dueTo: day, state: z.enum(["scheduled", "requested", "fenced", "done", "cancelled", "superseded"]), overdue: z.boolean(), request: ldlMemberRequestSchema.nullable().optional() });
export const ldlRetestSchema = memberRetest.extend({
  rule: z.enum(["acs", "other"]), anchorOn: day, requestOn: day, therapyId: uuid, fenceReason: z.enum(["open_visit", "not_eligible"]).nullable().optional(), requestStatus: z.string().nullable(), createdAt: instant, closedAt: instant.nullable(), defaultsVersion: z.string(),
});
export type LdlRetest = z.infer<typeof ldlRetestSchema>;
const doctorGoal = ldlGoalBaseSchema.extend({ reason: z.string().nullable(), defaultsVersion: z.string(), byYou: z.boolean() });

export const doctorLdlSchema = z.discriminatedUnion("enabled", [
  z.object({ version: z.literal("ldl-goal-v1"), enabled: z.literal(false) }),
  z.object({
    version: z.literal("ldl-goal-v1"), enabled: z.literal(true), today: day,
    events: z.array(z.object({ id: uuid, type: z.enum(LDL_EVENT_TYPES), other: z.string().nullable(), on: day.nullable(), source: z.enum(["document", "doctor_entered"]), note: z.string().nullable(), recordedAt: instant })),
    therapies: z.array(z.object({
      id: uuid, drug: z.enum(LDL_DRUGS), other: z.string().nullable(), dose: z.string(), startedOn: day.nullable(), maximallyTolerated: z.boolean(),
      recordedAt: instant, endedAt: instant.nullable(), endReason: z.enum(["stopped", "entered_in_error"]).nullable(), stoppedOn: day.nullable(),
    })),
    goals: z.array(doctorGoal),
    observations: z.array(ldlObservationSchema),
    // Phase 2 (20261029211448): null while the loop is off, absent from an older database.
    loop: z.object({
      retests: z.array(ldlRetestSchema),
      responses: z.array(z.object({ id: uuid, observedOn: day, status: z.enum(["at_goal", "above_goal", "not_assessable"]), createdAt: instant, closedAt: instant.nullable() })),
    }).nullable().optional(),
  }),
]);
export type DoctorLdl = z.infer<typeof doctorLdlSchema>;
export type DoctorLdlOn = Extract<DoctorLdl, { enabled: true }>;

export const memberLdlSchema = z.union([
  z.object({ version: z.literal("ldl-member-v1"), enabled: z.literal(false) }),
  z.object({ version: z.literal("ldl-member-v1"), enabled: z.literal(true), inPathway: z.literal(false) }),
  z.object({ version: z.literal("ldl-member-v1"), enabled: z.literal(true), inPathway: z.literal(true), goal: ldlGoalBaseSchema.nullable(), observations: z.array(ldlObservationSchema),
    // Phase 2 (20261029211448), while the loop is on: the open re-test window and a result waiting for the doctor.
    retest: memberRetest.nullable().optional(), withDoctor: z.object({ since: instant, doctorName: z.string().nullable() }).nullable().optional() }),
]);
export type MemberLdl = z.infer<typeof memberLdlSchema>;

const optionalDay = day.nullable();
const text = (max: number) => z.string().trim().max(max).nullable();
export const eventCommandSchema = z.strictObject({
  version: z.literal(LDL_COMMAND_VERSION), memberId: uuid, submissionId: uuid, type: z.enum(LDL_EVENT_TYPES), other: text(120), on: optionalDay,
  source: z.enum(["document", "doctor_entered"]), note: text(300),
}).refine((c) => (c.type === "other") === !!c.other?.trim(), { path: ["other"] });
export const therapyCommandSchema = z.strictObject({
  version: z.literal(LDL_COMMAND_VERSION), memberId: uuid, submissionId: uuid, drug: z.enum(LDL_DRUGS), other: text(80), dose: z.string().trim().min(1).max(60),
  startedOn: optionalDay, maximallyTolerated: z.boolean(),
  // Phase 2: the re-test window the form proposed and the doctor kept (lib/ldl/retest.ts); omitted or null for none.
  retest: z.strictObject({ dueFrom: day, dueTo: day, requestOn: day, rule: z.enum(["acs", "other"]), defaultsVersion: z.string().regex(/^[a-z0-9.-]{1,40}$/) }).nullable().optional(),
}).refine((c) => (c.drug === "other") === !!c.other?.trim(), { path: ["other"] })
  .refine((c) => !c.retest || (c.retest.dueFrom <= c.retest.dueTo && c.retest.requestOn <= c.retest.dueTo), { path: ["retest"] });
export const goalCommandSchema = z.strictObject({
  version: z.literal(LDL_COMMAND_VERSION), memberId: uuid, submissionId: uuid, expectedVersion: z.number().int().min(0),
  category: z.enum(LDL_CATEGORIES), thresholdMmol: z.number().min(0.5).max(5).refine((n) => Number(n.toFixed(1)) === n),
  reductionRule: z.boolean(), reductionPct: z.number().int().min(10).max(90).nullable(),
  baselineKind: z.enum(["pre_treatment", "on_treatment", "unknown"]), baselineMmol: z.number().min(0.2).max(15).refine((n) => Number(n.toFixed(2)) === n).nullable(),
  baselineOn: optionalDay, baselineSource: z.enum(["document", "lab_result", "doctor_entered"]).nullable(), nextTestOn: optionalDay, reason: text(500), defaultsVersion: z.string().regex(/^[a-z0-9.-]{1,40}$/),
}).refine((c) => c.reductionRule === (c.reductionPct !== null), { path: ["reductionPct"] })
  .refine((c) => (c.baselineKind === "unknown") === (c.baselineMmol === null) && (c.baselineMmol === null) === (c.baselineOn === null) && (c.baselineMmol === null) === (c.baselineSource === null), { path: ["baselineMmol"] })
  // A reason is recorded when the goal changes (any version after the first) or differs from the category default.
  .refine((c) => !!c.reason?.trim() || !goalNeedsReason(c), { path: ["reason"] });
export function goalNeedsReason(c: { expectedVersion: number; category: (typeof LDL_CATEGORIES)[number]; thresholdMmol: number; reductionPct: number | null }) {
  const d = LDL_CATEGORY_GOALS[c.category];
  return c.expectedVersion > 0 || c.thresholdMmol !== d.thresholdMmol || c.reductionPct !== d.reductionPct;
}
export type GoalCommand = z.infer<typeof goalCommandSchema>;

export const ldlStatuses = ["saved", "replayed", "stale", "invalid", "disabled", "not-found", "unavailable", "access", "outcome-unknown"] as const;
export type LdlCommandResult = { status: (typeof ldlStatuses)[number] };
