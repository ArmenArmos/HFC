import { z } from "zod";
import { measures } from "./measures";

/**
 * A member's earlier result as read by the lab AI reader (20261018120200_member_upload_ai.sql).
 * Values are saved as soon as the member's own sheet is read (Khikar 18 Oct, 20261018170210): "read by AI,
 * not confirmed by you". The member can correct or remove them; a sheet that looks like someone else's waits
 * for the member's "Is this yours?" answer. The doctor sees each value's provenance and the AI summary.
 */
export const memberEditVersion = "member-upload-edit-v1" as const;
export const memberIdentityVersion = "member-upload-identity-v1" as const;
const uuid = z.uuid(), instant = z.iso.datetime({ offset: true }), day = z.iso.date();
const jobState = z.enum(["queued", "running", "done", "rejected", "failed"]);
const identityStatus = z.enum(["match", "unknown", "mismatch", "multiple_patients"]);
const confirmation = z.object({ identityAnswer: z.enum(["mine", "not_mine"]).nullable(), valuesSaved: z.number().int(), valuesCharted: z.number().int(), measuredOn: day.nullable().optional(), at: instant });
/** The doctor's check (20261021070050): not required (values show at once), waiting, or approved. */
const review = z.object({ state: z.enum(["not_required", "waiting", "approved"]), approvedAt: instant.nullable() });
const memberJob = z.object({ jobId: uuid, state: jobState, outcome: z.string().nullable(), createdAt: instant, finishedAt: instant.nullable(), identityStatus: identityStatus.nullable(), sampleDate: z.string().nullable(), confirmation: confirmation.nullable(), valueCount: z.number().int(), review: review.optional() });
export const memberOverviewSchema = z.object({ version: z.literal("member-upload-ai-v1"), enabled: z.boolean(), documents: z.array(z.object({ documentId: uuid, createdAt: instant, job: memberJob.nullable() })) });
const chartMeasureId = z.enum(["total_cholesterol", "ldl_c", "hba1c", "fasting_glucose"]);
export const memberValueSchema = z.object({
  valueId: uuid, seq: z.number().int(), testName: z.string(), catalogueRef: z.string().nullable(), valueText: z.string(), value: z.number().nullable(), unit: z.string().nullable(),
  collectedOn: day.nullable(), measure: chartMeasureId.nullable(), measureUnit: z.enum(["mmol/L", "mg/dL", "%"]).nullable(), checks: z.array(z.string()),
  memberStatus: z.enum(["pending", "confirmed", "corrected", "rejected"]), memberValue: z.number().nullable(),
  chartedSource: z.enum(["ai_confirmed", "ai_read", "member_corrected", "doctor_approved"]).nullable().optional(),
});
export const memberReadSchema = z.union([
  z.object({ version: z.literal("member-upload-ai-read-v1"), enabled: z.literal(false) }),
  z.object({ version: z.literal("member-upload-ai-read-v1"), enabled: z.literal(true), found: z.literal(false) }),
  z.object({ version: z.literal("member-upload-ai-read-v1"), enabled: z.literal(true), found: z.literal(true), documentId: uuid, fileName: z.string(), resultDate: day.nullable(), job: memberJob.nullable(), values: z.array(memberValueSchema) }),
]);
export type MemberOverview = z.infer<typeof memberOverviewSchema>;
export type MemberReadingJob = z.infer<typeof memberJob>;
export type MemberReadingValue = z.infer<typeof memberValueSchema>;
export type MemberReading = Extract<z.infer<typeof memberReadSchema>, { found: true }>;

const edit = z.strictObject({ valueId: uuid, action: z.enum(["correct", "remove"]), value: z.number().finite().gt(-1e9).lt(1e9).optional() }).refine((e) => (e.action === "correct") === (e.value !== undefined));
export const editCommandSchema = z.strictObject({ version: z.literal(memberEditVersion), submissionId: uuid, jobId: uuid, measuredOn: day.optional(), edits: z.array(edit).min(1).max(200) });
export const identityCommandSchema = z.strictObject({ version: z.literal(memberIdentityVersion), submissionId: uuid, jobId: uuid, answer: z.enum(["mine", "not_mine"]) });
export type EditCommand = z.infer<typeof editCommandSchema>;
export type IdentityCommand = z.infer<typeof identityCommandSchema>;
export type MemberCommandResult = { status: "saved" } | { status: "invalid" | "stale" | "unchanged" | "disabled" | "unavailable" | "access" };

/**
 * What the member's card says about one upload.
 *  reading      queued or being read, for the first quarter of an hour;
 *  slow         still waiting after that (a spend cap, reading switched off, retries);
 *  identity     read, but the sheet looks like someone else's: asks before saving;
 *  unreadable   not read (refused, failed, nothing found, several people on the sheet, or never queued);
 *  saved        values saved (automatically, or after the member said the sheet is theirs);
 *  not_mine     the member said the results are someone else's.
 * `shown` hides finished cards after a while, so the page does not fill with old news.
 */
export type ReadingState = "reading" | "slow" | "identity" | "unreadable" | "saved" | "not_mine";
export const SLOW_AFTER_MS = 15 * 60_000;
const DAY = 86_400_000;
export function readingState(doc: { createdAt: string; job: MemberReadingJob | null }, now: number): { state: ReadingState; shown: boolean } {
  const age = now - Date.parse(doc.createdAt);
  const j = doc.job;
  if (!j) return { state: "unreadable", shown: age < 3 * DAY };
  if (j.state === "queued" || j.state === "running") return { state: Date.parse(j.createdAt) + SLOW_AFTER_MS < now ? "slow" : "reading", shown: true };
  if (j.state !== "done") return { state: "unreadable", shown: age < 14 * DAY };
  if (j.confirmation) return { state: j.confirmation.identityAnswer === "not_mine" ? "not_mine" : "saved", shown: now - Date.parse(j.confirmation.at) < 7 * DAY };
  if (j.identityStatus === "multiple_patients" || j.valueCount === 0) return { state: "unreadable", shown: age < 14 * DAY };
  // A mismatch waits for the member. Anything else is saved in the reading itself (or by the backfill), so
  // "saved" is only said with a save record; without one the card says the reading is still being finished.
  return { state: j.identityStatus === "mismatch" ? "identity" : "slow", shown: true };
}

/** A corrected or kept value that would be charted must fit the measure's range, as for hand-entered values. */
export function chartValueProblem(v: Pick<MemberReadingValue, "measure" | "measureUnit">, value: number | null): boolean {
  if (!v.measure || !v.measureUnit || value === null) return false;
  const unit = measures[v.measure].units.find((u) => u.unit === v.measureUnit);
  return !unit || !Number.isFinite(value) || value < unit.bounds.min || value > unit.bounds.max;
}
