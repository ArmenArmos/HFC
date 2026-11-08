import { THRESHOLD } from "@/lib/clinical/rules/rules";
import { LDL_DEFAULTS_VERSION, LDL_RETEST_REQUEST_LEAD_DAYS, LDL_RETEST_WEEKS } from "./constants";

/**
 * The LDL re-test after a change to lipid therapy (20261029211448_ldl_response_loop.sql). The doctor's therapy form
 * proposes this window from lib/ldl/constants.ts; the database stores what the doctor confirmed and, on the request
 * day, creates a home-visit request with this one requirement in the existing admin queue.
 */
export type LdlRetestProposal = { rule: "acs" | "other"; dueFrom: string; dueTo: string; requestOn: string; defaultsVersion: string };

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * The window for a therapy started (or changed) on `startedOn`, today when unknown. Null when the window has already
 * passed: a therapy recorded long after it started is history, not a change to re-test.
 */
export function proposeRetest(input: { eventTypes: readonly string[]; startedOn: string | null; today: string }): LdlRetestProposal | null {
  const rule = input.eventTypes.includes("acs_mi") ? "acs" : "other";
  const anchor = input.startedOn ?? input.today;
  const [from, to] = LDL_RETEST_WEEKS[rule];
  const dueFrom = addDays(anchor, from * 7), dueTo = addDays(anchor, to * 7);
  if (dueTo < input.today) return null;
  const lead = addDays(dueFrom, -LDL_RETEST_REQUEST_LEAD_DAYS);
  return { rule, dueFrom, dueTo, requestOn: lead > input.today ? lead : input.today, defaultsVersion: LDL_DEFAULTS_VERSION };
}

/** The home-visit request's algorithm version and its one requirement: word for word _ldl_retest_requirement() in SQL. */
export const LDL_RETEST_ALGORITHM = "ldl-retest-v1";
export const LDL_RETEST_REQUIREMENT = { id: "ldl-retest-lipid-panel", title: "Lipid panel (LDL cholesterol) after a change to lipid treatment", method: "lab" } as const;

type Requirement = { id: string; title: string; method: string };
/** A request the LDL loop created. */
export function isLdlRetestRequest(r: { algorithmVersion: string }) {
  return r.algorithmVersion === LDL_RETEST_ALGORITHM;
}
/** Stale only when it no longer carries exactly the LDL requirement (the screening engine does not apply to it). */
export function ldlRetestRequestStale(r: { requirements: readonly Requirement[] }) {
  const [q, ...rest] = r.requirements;
  return rest.length > 0 || !q || q.id !== LDL_RETEST_REQUIREMENT.id || q.title !== LDL_RETEST_REQUIREMENT.title || q.method !== LDL_RETEST_REQUIREMENT.method;
}
/**
 * The engine a confirm or accept of an LDL request sends: the database checks that its version equals the request's
 * and that the request's requirements are among its tests, so it confirms only an LDL request.
 */
export function ldlRetestEngine(sourceToken: string) {
  return { sourceToken, version: LDL_RETEST_ALGORITHM, tests: [{ ...LDL_RETEST_REQUIREMENT }] };
}

/**
 * The LDL eligibility contract at confirm and accept, the rule _ldl_retest_eligible applies at creation (Astra LDLR-02):
 * consent recorded, no urgent hold, and no unresolved crisis-range reading (the same hold and message the screening
 * engine uses, so the booking forms show the same clinical hold). The screening questionnaire need not be complete:
 * the assigned doctor ordered this test. Throws; returns nothing.
 */
export function ldlRetestHold(evidence: { consent: unknown; assessment: { urgent_rule: string | null } | null; measurements: { systolic: number; diastolic: number }[] }) {
  if (evidence.measurements.some((m) => m.systolic >= THRESHOLD.crisisSystolic || m.diastolic >= THRESHOLD.crisisDiastolic))
    throw Error("Routine review is on hold: a recorded crisis-range blood pressure has no linked symptom triage or resolution. Arrange clinical assessment; later normal readings do not clear this hold.");
  if (evidence.assessment?.urgent_rule) throw Error("Urgent guidance takes priority over routine publication.");
  if (evidence.consent === null || evidence.consent === undefined) throw Error("Record the member's consent in Noreon before arranging this test.");
}
