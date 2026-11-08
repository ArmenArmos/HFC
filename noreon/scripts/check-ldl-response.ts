import assert from "node:assert/strict";
import { LDL_ADHERENCE_WINDOW_DAYS, LDL_RETEST_REQUEST_LEAD_DAYS, LDL_RETEST_WEEKS } from "@/lib/ldl/constants";
import { LDL_RETEST_ALGORITHM, LDL_RETEST_REQUIREMENT, isLdlRetestRequest, ldlRetestEngine, ldlRetestHold, ldlRetestRequestStale, proposeRetest } from "@/lib/ldl/retest";
import { buildLdlResponse, isLipidMedicine, latestAlt, lipidAdherence, nextStepFor, unusableObservationKeys } from "@/lib/ldl/response";
import { assessLdl } from "@/lib/ldl/status";
import { runLdlResponseSweep } from "@/lib/ldl/response-runtime";
import { ldlCandidatesSchema, ldlResponseFactsSchema, type LdlCandidate } from "@/lib/ldl/response-schema";
import { therapyCommandSchema } from "@/lib/ldl/schema";

/** SYNTHETIC checks for the LDL re-test window and the response check (phase 2). No network, no database. */
globalThis.fetch = (() => { throw Error("network used in a check"); }) as typeof fetch;

// Defaults pending Armen/Yesayi (C3, C8, C9).
assert.deepEqual(LDL_RETEST_WEEKS, { acs: [4, 6], other: [4, 6] });
assert.equal(LDL_ADHERENCE_WINDOW_DAYS, 28);

// 1. The window: 4-6 weeks after any therapy change (Armen, 2 Nov), from the start date (today when unknown); the request a week ahead.
{
  const acs = proposeRetest({ eventTypes: ["acs_mi"], startedOn: "2026-11-01", today: "2026-11-01" })!;
  assert.deepEqual({ ...acs, defaultsVersion: undefined }, { rule: "acs", dueFrom: "2026-11-29", dueTo: "2026-12-13", requestOn: "2026-11-22", defaultsVersion: undefined });
  assert.equal(LDL_RETEST_REQUEST_LEAD_DAYS, 7);
  const stroke = proposeRetest({ eventTypes: ["ischaemic_stroke"], startedOn: null, today: "2026-11-01" })!;
  assert.deepEqual([stroke.rule, stroke.dueFrom, stroke.dueTo], ["other", "2026-11-29", "2026-12-13"]);
  assert.equal(proposeRetest({ eventTypes: [], startedOn: "2026-10-01", today: "2026-11-01" })?.rule, "other", "no event: other");
  // Started 30 days ago after ACS: the window is open, the request goes today.
  const open = proposeRetest({ eventTypes: ["acs_mi", "tia"], startedOn: "2026-10-02", today: "2026-11-01" })!;
  assert.deepEqual([open.dueFrom, open.dueTo, open.requestOn], ["2026-10-30", "2026-11-13", "2026-11-01"]);
  // A therapy recorded long after it started is history: no window.
  assert.equal(proposeRetest({ eventTypes: ["acs_mi"], startedOn: "2026-01-10", today: "2026-11-01" }), null);
  // The command carries it and the schema checks its order.
  const base = { version: "ldl-goal-v1", memberId: "00000000-0000-4000-8000-000000000001", submissionId: "00000000-0000-4000-8000-000000000002", drug: "atorvastatin", other: null, dose: "80 mg", startedOn: "2026-11-01", maximallyTolerated: false };
  assert.ok(therapyCommandSchema.safeParse({ ...base, retest: acs }).success);
  assert.ok(therapyCommandSchema.safeParse(base).success, "re-test optional (the old form)");
  assert.ok(!therapyCommandSchema.safeParse({ ...base, retest: { ...acs, dueTo: "2026-11-01" } }).success, "window order checked");
  assert.ok(!therapyCommandSchema.safeParse({ ...base, retest: { ...acs, extra: 1 } }).success, "re-test keys strict");
}

// 2. The booking side: an LDL request is checked against its own requirement, and its engine names only that.
{
  const req = { algorithmVersion: LDL_RETEST_ALGORITHM, requirements: [{ ...LDL_RETEST_REQUIREMENT }] };
  assert.ok(isLdlRetestRequest(req));
  assert.ok(!isLdlRetestRequest({ algorithmVersion: "2026.10" }));
  assert.equal(ldlRetestRequestStale(req), false);
  assert.equal(ldlRetestRequestStale({ requirements: [{ ...LDL_RETEST_REQUIREMENT, title: "Changed" }] }), true);
  assert.equal(ldlRetestRequestStale({ requirements: [{ ...LDL_RETEST_REQUIREMENT }, { id: "x", title: "y", method: "lab" }] }), true);
  assert.equal(ldlRetestRequestStale({ requirements: [] }), true);
  assert.deepEqual(ldlRetestEngine("tok"), { sourceToken: "tok", version: LDL_RETEST_ALGORITHM, tests: [{ ...LDL_RETEST_REQUIREMENT }] });
}

// 3. Lipid medicines and adherence: only lipid-lowering names count; late ticks count; none on the log is unknown.
assert.ok(isLipidMedicine("Atorvastatin 40 mg") && isLipidMedicine("Аторис") && isLipidMedicine("ROSUCARD") && isLipidMedicine("Эзетрол"));
assert.ok(!isLipidMedicine("Amlodipine") && !isLipidMedicine("Aspirin") && !isLipidMedicine("Бисопролол"));
const now = "2026-11-28T20:00:00+04:00";
const doses = (days: number, takenEvery: number) => Array.from({ length: days }, (_, i) => {
  const d = new Date(Date.parse("2026-11-28T00:00:00Z") - i * 86400000).toISOString().slice(0, 10);
  return { dueAt: new Date(`${d}T09:00:00+04:00`).toISOString(), status: (i % takenEvery === 0 ? "taken" : "skipped") as "taken" | "skipped", recordedAt: new Date(`${d}T13:00:00+04:00`).toISOString() };
});
const plan = (name: string, d: ReturnType<typeof doses>) => ({ id: "00000000-0000-4000-8000-0000000000a1", source: "plan" as const, name, dose: "40 mg", times: ["09:00"], startedOn: "2026-09-01", endDate: null, effectiveAt: null, doses: d });
const meds = (p: ReturnType<typeof plan>[]) => ({ today: "2026-11-28", days: 28, now, self: [], plan: p });
{
  const all = lipidAdherence(meds([plan("Atorvastatin", doses(28, 1)), plan("Amlodipine", doses(28, 2))]))!;
  assert.deepEqual([all.expected, all.taken, all.percent, all.medicines], [28, 28, 100, ["Atorvastatin"]], "late ticks count; other medicines ignored");
  const half = lipidAdherence(meds([plan("Rosuvastatin", doses(28, 2))]))!;
  assert.equal(half.percent, 50);
  assert.equal(lipidAdherence(meds([plan("Amlodipine", doses(28, 1))])), null, "no lipid medicine: unknown");
  assert.equal(nextStepFor("above_goal", all), "step_up");
  assert.equal(nextStepFor("above_goal", { ...all, percent: 20 }), "step_up", "no adherence cut-off (Task 19)");
  assert.equal(nextStepFor("above_goal", null), "adherence_unknown");
  assert.equal(nextStepFor("at_goal", all), null);
  assert.equal(nextStepFor("not_assessable", all), null);
}

// 4. ALT: the newest reviewed value with a recognised name and unit.
assert.deepEqual(latestAlt([
  { id: "cr:1", value: 28, unit: "U/L", on: "2026-10-01", name: "ALT" },
  { id: "cr:2", value: 35, unit: "Ед/л", on: "2026-11-20", name: "АЛТ (аланинаминотрансфераза)" },
  { id: "cr:3", value: 99, unit: "mmol/L", on: "2026-11-25", name: "ALT" },
  { id: "cr:4", value: 50, unit: "U/L", on: "2026-11-26", name: "Alkaline phosphatase" },
]), { value: 35, on: "2026-11-20" });
assert.equal(latestAlt([]), null);

// 5. The response check.
const goal = { version: 2, category: "very_high" as const, thresholdMmol: 1.4, reductionRule: true, reductionPct: 50,
  baseline: { kind: "pre_treatment" as const, mmol: 3.8, on: "2026-08-20", source: "document" as const }, nextTestOn: null, setAt: "2026-09-05T10:00:00+04:00", doctorName: "Dr Synthetic" };
const o = (id: string, value: number, on: string, source: "member" | "upload_checked" | "clinic_result" = "clinic_result") => ({ id, value, unit: "mmol/L", on, source, name: "LDL-C", memberVisible: false });
const candidate = (over: Partial<LdlCandidate> = {}): LdlCandidate => (ldlCandidatesSchema.parse({ version: "ldl-response-v1", enabled: true, today: "2026-11-28",
  members: [{ memberId: "00000000-0000-4000-8000-000000000004", floorOn: "2026-10-02", observations: [o("cr:00000000-0000-4000-8000-0000000000b1", 2.4, "2026-09-30"), o("cr:00000000-0000-4000-8000-0000000000b2", 1.9, "2026-11-27")],
    goal, checked: [], retestId: null, alt: [{ id: "cr:x", value: 31, unit: "U/L", on: "2026-11-27", name: "ALT" }], medicines: meds([plan("Atorvastatin", doses(28, 1))]), ...over }] }) as Extract<ReturnType<typeof ldlCandidatesSchema.parse>, { enabled: true }>).members[0];
{
  const r = buildLdlResponse(candidate())!;
  assert.equal(r.status, "above_goal");
  assert.equal(r.observationKey, "cr:00000000-0000-4000-8000-0000000000b2");
  assert.equal(r.observedOn, "2026-11-27");
  assert.ok(ldlResponseFactsSchema.safeParse(r.facts).success, "facts parse as the inbox reads them");
  assert.deepEqual(r.facts.value, { mmol: 1.9, on: "2026-11-27", source: "clinic_result" });
  assert.deepEqual(r.facts.previous, { mmol: 2.4, on: "2026-09-30" });
  assert.ok(Math.abs(r.facts.changePct! - -20.8333) < 0.001, "change since previous");
  assert.equal(r.facts.reduction.state, "met", "50% down from 3.8, still above the threshold");
  assert.equal(r.facts.nextStep, "step_up");
  assert.deepEqual(r.facts.alt, { value: 31, on: "2026-11-27" });
  assert.equal(r.facts.goal?.thresholdMmol, 1.4);
  assert.ok(!JSON.stringify(r).match(/ezetimibe|rosuvastatin|selected/i), "no medicine is selected in the record");
}
assert.equal(buildLdlResponse(candidate({ observations: [o("cr:00000000-0000-4000-8000-0000000000b2", 1.2, "2026-11-27")] }))!.status, "at_goal");
assert.equal(buildLdlResponse(candidate({ observations: [o("cr:00000000-0000-4000-8000-0000000000b2", 1.2, "2026-11-27")] }))!.facts.nextStep, null);
{
  const r = buildLdlResponse(candidate({ goal: null }))!;
  assert.equal(r.status, "not_assessable", "no goal: not assessable");
  assert.equal(r.facts.goal, null);
}
assert.equal(buildLdlResponse(candidate({ medicines: meds([plan("Rosuvastatin", doses(28, 2))]) }))!.facts.nextStep, "step_up");
assert.equal(buildLdlResponse(candidate({ medicines: meds([]) }))!.facts.nextStep, "adherence_unknown");
// Not after the floor, already checked, or only member-typed values: nothing to record.
assert.equal(buildLdlResponse(candidate({ floorOn: "2026-11-27" })), null, "on the floor day: none");
assert.equal(buildLdlResponse(candidate({ checked: ["cr:00000000-0000-4000-8000-0000000000b2"] })), null, "already checked");
assert.equal(buildLdlResponse(candidate({ observations: [o("mr:00000000-0000-4000-8000-0000000000b3", 1.0, "2026-11-27", "member")] })), null, "member-typed values never respond");
// An unreviewed upload never reaches here (the database filters); a checked upload does.
assert.equal(buildLdlResponse(candidate({ observations: [o("mr:00000000-0000-4000-8000-0000000000b4", 1.6, "2026-11-27", "upload_checked")] }))!.facts.value.source, "upload_checked");
// LDLR-04: values the status module drops are the ones the sweep marks skipped; usable and checked ones are not.
{
  const c = candidate({ observations: [o("cr:00000000-0000-4000-8000-0000000000b2", 1.9, "2026-11-25"), { ...o("cr:00000000-0000-4000-8000-0000000000b5", 7, "2026-11-27"), unit: "xyz" },
    { ...o("cr:00000000-0000-4000-8000-0000000000b6", 1.7, "2026-11-26"), name: "VLDL cholesterol" }, { ...o("cr:00000000-0000-4000-8000-0000000000b7", 9, "2026-09-01"), unit: "xyz" }] });
  assert.deepEqual(unusableObservationKeys(c), ["cr:00000000-0000-4000-8000-0000000000b5", "cr:00000000-0000-4000-8000-0000000000b6"], "only unusable values after the floor");
  assert.equal(buildLdlResponse(c)!.observationKey, "cr:00000000-0000-4000-8000-0000000000b2", "the usable value still responds");
}

// Test gap 5: another value on a day that already has a response. Higher: a new response (the higher value on a day is
// the conservative default, lib/ldl/status.ts). Lower, or the same value from a second source: none, and it is marked
// skipped so it does not hold the member in the list. Pending the clinicians' answer on same-day values.
{
  const [low, high, lower, copy] = ["b8", "b9", "ba", "bb"].map((x) => `cr:00000000-0000-4000-8000-0000000000${x}`);
  const day = "2026-11-27";
  const higher = candidate({ observations: [o(low, 1.9, day), o(high, 2.6, day)], checked: [low] });
  const r = buildLdlResponse(higher)!;
  assert.equal(r.observationKey, high, "a higher value that arrived later gets its own response");
  assert.equal(r.status, "above_goal");
  assert.deepEqual(r.facts.value, { mmol: 2.6, on: day, source: "clinic_result" });
  assert.deepEqual(r.facts.previous, { mmol: 1.9, on: day }, "the doctor sees the lower value it followed");
  assert.deepEqual(unusableObservationKeys(higher), [], "nothing to skip: the higher value is the one to answer");
  const notHigher = candidate({ observations: [o(low, 1.9, day), o(lower, 1.2, day)], checked: [low] });
  assert.equal(buildLdlResponse(notHigher), null, "a lower value on an answered day needs no response");
  assert.deepEqual(unusableObservationKeys(notHigher), [lower], "and is skipped");
  const sameValue = candidate({ observations: [{ ...o(low, 1.9, day), source: "upload_checked" }, o(copy, 1.9, day)], checked: [low] });
  assert.equal(buildLdlResponse(sameValue), null, "the same value from a better source is not a new result");
  assert.deepEqual(unusableObservationKeys(sameValue), [copy], "and is skipped");
  // Two values arriving together: one response, for the higher; the lower is skipped, so the sweep does not see it again.
  const together = candidate({ observations: [o(low, 1.9, day), o(high, 2.6, day)] });
  assert.equal(buildLdlResponse(together)!.observationKey, high);
  assert.deepEqual(unusableObservationKeys(together), [low]);
}

// Test gap 4: a record refused as stale is not a failure; the next sweep works it out again from the new goal.
{
  const member = { memberId: "00000000-0000-4000-8000-000000000004", floorOn: "2026-10-02", observations: [o("cr:00000000-0000-4000-8000-0000000000b2", 1.9, "2026-11-27")],
    goal, checked: [], retestId: null, alt: [], medicines: meds([]) };
  const calls: string[] = [];
  const rpc = async (name: string) => {
    calls.push(name);
    if (name === "ldl_response_candidates") return { version: "ldl-response-v1", enabled: true, today: "2026-11-28", members: [member] };
    if (name === "ldl_response_record") return { status: "stale" };
    return { state: "ran" };
  };
  const report = await runLdlResponseSweep(rpc);
  assert.deepEqual([report.checked, report.recorded, report.failed, report.run], [1, 0, 0, "ran"]);
  assert.deepEqual(calls, ["ldl_response_candidates", "ldl_response_record", "ldl_response_run"]);
}

// LDLR-02: the LDL eligibility contract at confirm and accept. No questionnaire needed; consent, urgent and crisis holds kept.
{
  const ok = { consent: { version: "patient-pilot-v1" }, assessment: null, measurements: [{ systolic: 130, diastolic: 80 }] };
  assert.doesNotThrow(() => ldlRetestHold(ok), "no questionnaire is fine");
  assert.throws(() => ldlRetestHold({ ...ok, consent: null }), /consent/);
  assert.throws(() => ldlRetestHold({ ...ok, assessment: { urgent_rule: "RF-01" } }), /Urgent guidance/);
  assert.throws(() => ldlRetestHold({ ...ok, measurements: [{ systolic: 185, diastolic: 95 }] }), /crisis-range/);
}
{ // Review and publication are separate: a reviewed, unpublished value makes the response, and publishing it later adds none.
  const pub = (id: string, value: number, on: string) => ({ ...o(id, value, on), memberVisible: true });
  const newer = "cr:00000000-0000-4000-8000-0000000000c2", older = "cr:00000000-0000-4000-8000-0000000000c1", day = "2026-11-27";
  const c = (observations: ReturnType<typeof o>[], checked: string[] = []) => candidate({ observations, checked });
  const later = c([pub(older, 1.3, "2026-11-01"), o(newer, 2.5, day)]);
  assert.equal(buildLdlResponse(later)!.observationKey, newer, "the newer reviewed value answers, published or not");
  assert.equal(assessLdl({ goal: later.goal, observations: later.observations }).latest!.mmol, 1.3, "a member-facing read still holds it back");
  const same = c([pub(older, 1.3, day), o(newer, 2.5, day)]);
  assert.equal(buildLdlResponse(same)!.observationKey, newer, "same day: the higher reviewed value answers");
  assert.deepEqual(unusableObservationKeys(same), [older], "the sweep skips the lower one, never the reviewed one");
  const published = c([pub(older, 1.3, day), pub(newer, 2.5, day)], [newer, older]);
  assert.equal(buildLdlResponse(published), null, "publication after the sweep makes no second response");
  assert.deepEqual(unusableObservationKeys(published), []);
}
console.log("LDL response checks passed");
