import { z } from "zod";
import { planMedicineSchema, selfMedicineSchema } from "@/lib/member-medicines/model";
import { LDL_CATEGORIES } from "./constants";
import { ldlGoalBaseSchema, ldlObservationSchema } from "./schema";

/** Shapes of the response loop's reads and records (20261029211448_ldl_response_loop.sql). */
export const LDL_RESPONSE_VERSION = "ldl-response-v1";
const uuid = z.uuid(), day = z.iso.date(), instant = z.iso.datetime({ offset: true });
const num = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]);
export const ldlResponseStatuses = ["at_goal", "above_goal", "not_assessable"] as const;
export type LdlResponseStatus = (typeof ldlResponseStatuses)[number];

const rawAlt = z.object({ id: z.string(), value: num, unit: z.string(), on: day, name: z.string().nullable() });
export const ldlCandidatesSchema = z.discriminatedUnion("enabled", [
  z.object({ version: z.literal(LDL_RESPONSE_VERSION), enabled: z.literal(false) }),
  z.object({
    version: z.literal(LDL_RESPONSE_VERSION), enabled: z.literal(true), today: day,
    members: z.array(z.object({
      memberId: uuid, floorOn: day, observations: z.array(ldlObservationSchema), goal: ldlGoalBaseSchema.nullable(), checked: z.array(z.string()),
      retestId: uuid.nullable(), alt: z.array(rawAlt),
      medicines: z.object({ today: day, days: z.number().int(), now: instant, self: z.array(selfMedicineSchema), plan: z.array(planMedicineSchema) }),
    })),
  }),
]);
export type LdlCandidate = Extract<z.infer<typeof ldlCandidatesSchema>, { enabled: true }>["members"][number];

/**
 * What the doctor sees on the inbox item, frozen when the check ran. nextStep is the guideline text to show, never a
 * selected medicine: step_up "consider adding ezetimibe or raising the statin dose", adherence_first "adherence
 * support first", adherence_unknown "no lipid medicine on the dose log: check adherence with the member first".
 */
export const ldlResponseFactsSchema = z.object({
  version: z.literal("ldl-response-facts-v1"),
  defaultsVersion: z.string(),
  value: z.object({ mmol: z.number(), on: day, source: z.enum(["upload_checked", "clinic_result", "clinic_reviewed"]) }),
  goal: z.object({ version: z.number().int(), category: z.enum(LDL_CATEGORIES), thresholdMmol: z.number(), reductionPct: z.number().int().nullable() }).nullable(),
  previous: z.object({ mmol: z.number(), on: day }).nullable(),
  /** Relative change from the previous counted value, percent (negative is lower). */
  changePct: z.number().nullable(),
  reduction: z.object({ state: z.enum(["not_applicable", "not_assessable", "met", "not_met"]), percent: z.number().nullable(), requiredPct: z.number().nullable() }),
  /** Null: no lipid-lowering medicine on the dose log, so adherence is not known. */
  adherence: z.object({ windowDays: z.number().int(), expected: z.number().int(), taken: z.number().int(), skipped: z.number().int(), percent: z.number().nullable(), medicines: z.array(z.string()) }).nullable(),
  alt: z.object({ value: z.number(), on: day }).nullable(),
  nextStep: z.enum(["step_up", "adherence_first", "adherence_unknown"]).nullable(),
  /** Null since the 90% rule went (Task 19); a number only on older frozen rows. */
  adherenceThresholdPct: z.number().nullable(),
});
export type LdlResponseFacts = z.infer<typeof ldlResponseFactsSchema>;
export type LdlResponseRecord = { version: typeof LDL_RESPONSE_VERSION; memberId: string; observationKey: string; observedOn: string; status: LdlResponseStatus; facts: LdlResponseFacts };

export const doctorLdlResponsesSchema = z.discriminatedUnion("enabled", [
  z.object({ version: z.literal(LDL_RESPONSE_VERSION), enabled: z.literal(false) }),
  z.object({
    version: z.literal(LDL_RESPONSE_VERSION), enabled: z.literal(true),
    items: z.array(z.object({ id: uuid, memberId: uuid, memberName: z.string(), observedOn: day, status: z.enum(ldlResponseStatuses), facts: ldlResponseFactsSchema, createdAt: instant })),
  }),
]);
export type DoctorLdlResponse = Extract<z.infer<typeof doctorLdlResponsesSchema>, { enabled: true }>["items"][number];

export const adminLdlRetestsSchema = z.discriminatedUnion("enabled", [
  z.object({ version: z.literal(LDL_RESPONSE_VERSION), enabled: z.literal(false) }),
  z.object({
    version: z.literal(LDL_RESPONSE_VERSION), enabled: z.literal(true),
    items: z.array(z.object({
      id: uuid, memberId: uuid, memberName: z.string(), doctorName: z.string().nullable(), dueFrom: day, dueTo: day,
      state: z.enum(["scheduled", "requested", "fenced"]), overdue: z.boolean(), overdueAt: instant.nullable(), requestStatus: z.string().nullable(),
      /** overdue: the window passed (until acknowledged); fenced: no request could be created yet (fenceReason says why). */
      kind: z.enum(["overdue", "fenced"]), fenceReason: z.enum(["open_visit", "not_eligible"]).nullable(),
    })),
  }),
]);
export type AdminLdlRetest = Extract<z.infer<typeof adminLdlRetestsSchema>, { enabled: true }>["items"][number];

export const ldlLoopResults = ["saved", "replayed", "invalid", "disabled", "not-found", "unavailable", "access", "outcome-unknown"] as const;
export type LdlLoopResult = { status: (typeof ldlLoopResults)[number] };
