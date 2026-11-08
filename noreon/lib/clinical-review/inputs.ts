import { z } from "zod";
import { staffTargetSchema, personalTarget } from "@/lib/bp-target/schema";
import { planMedicineSchema, selfMedicineSchema, adherence } from "@/lib/member-medicines/model";
import { ldlObservationSchema } from "@/lib/ldl/schema";
import { ldlObservations, type RawLdlObservation } from "@/lib/ldl/status";
import { aboveTargetStreak } from "@/lib/clinical/rules/personal-bp";
import { bpAverage, daysSince, riskTier, secondaryPrevention, type RiskTierInput, type RiskTierResult } from "@/lib/clinical/rules/risk-tier";
import { detectBpAnomalies, type BpAnomaly } from "@/lib/clinical/rules/bp-anomaly";
import { detectLdlTrends, type LabTrendFinding } from "@/lib/clinical/rules/lab-trend";

/** The page clinical_review_inputs returns (20261108080830_risk_tiers_worklist.sql). Raw facts; every decision is below. */
const instant = z.iso.datetime({ offset: true });
const num = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]);
export const clinicalReviewMemberSchema = z.object({
  memberId: z.uuid(),
  conditions: z.array(z.string()),
  assessmentRedFlag: z.string().nullable(),
  events: z.array(z.string()),
  target: staffTargetSchema.omit({ byYou: true }).nullable(),
  readings: z.array(z.object({ systolic: z.number(), diastolic: z.number(), pulse: z.number().nullable(), measuredAt: instant, entrySource: z.string().nullable() })),
  ldlGoal: z.object({ thresholdMmol: num, setAt: instant, version: z.number().int() }).nullable(),
  ldlObservations: z.array(ldlObservationSchema),
  openAlerts: z.number().int(),
  openSameDayTasks: z.number().int(),
  medicines: z.object({ today: z.iso.date(), days: z.number().int(), now: instant, self: z.array(selfMedicineSchema), plan: z.array(planMedicineSchema) }),
  lastContactAt: instant.nullable(),
});
export type ClinicalReviewMember = z.infer<typeof clinicalReviewMemberSchema>;
export const clinicalReviewPageSchema = z.object({
  version: z.literal("clinical-review-inputs-v1"), asOf: instant, next: z.uuid().nullable(),
  members: z.array(z.unknown()),
});

/** Doses taken of doses expected over the window, all medicines together (lib/member-medicines adherence()). */
export function adherencePct(m: ClinicalReviewMember["medicines"], now: Date): number | null {
  const sum = [...m.self, ...m.plan].map(x => adherence(x, m.days, now)).reduce((a, b) => ({ expected: a.expected + b.expected, taken: a.taken + b.taken }), { expected: 0, taken: 0 });
  return sum.expected > 0 ? (sum.taken / sum.expected) * 100 : null;
}

/** Counted LDL values, oldest first. A clinician-side read: member-typed values never count. */
export const countedLdl = (m: ClinicalReviewMember) => ldlObservations(m.ldlObservations as RawLdlObservation[], {});

export function riskTierInput(m: ClinicalReviewMember, now: Date): RiskTierInput {
  const ldl = countedLdl(m).filter(o => o.counts).at(-1) ?? null;
  return {
    secondaryPrevention: secondaryPrevention(m.conditions, m.events),
    bpAverage: bpAverage(m.readings, now),
    bpTarget: personalTarget(m.target),
    ldlLatestMmol: ldl ? ldl.mmol : null,
    ldlGoalMmol: m.ldlGoal ? m.ldlGoal.thresholdMmol : null,
    openUrgent: m.openAlerts + m.openSameDayTasks,
    adherencePct: adherencePct(m.medicines, now),
    redFlag: m.assessmentRedFlag !== null,
    daysSinceContact: daysSince(m.lastContactAt, now),
  };
}

export function memberRisk(m: ClinicalReviewMember, now: Date): RiskTierResult & { facts: { aboveTargetStreak: number } } {
  return { ...riskTier(riskTierInput(m, now)), facts: { aboveTargetStreak: aboveTargetStreak(m.readings, personalTarget(m.target)) } };
}

export function memberAnomalies(m: ClinicalReviewMember, now: Date): (BpAnomaly | LabTrendFinding)[] {
  const bp = detectBpAnomalies(m.readings.map(r => ({ ...r, symptoms: "unknown" as const })), personalTarget(m.target), now);
  const ldl = detectLdlTrends(countedLdl(m), m.ldlGoal, now);
  return [...bp, ...ldl];
}
