import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LipidPlanCard } from "@/components/staff/lipid-plan-card";
import { LDL_RETEST_WEEKS } from "@/lib/ldl/constants";
import { addInterval, evaluate, runRules, triAll, triAny, triNot, unknownFacts, windowStatus, type Ruleset, type Tri } from "@/lib/lipid-planner/engine";
import { lastStartOrIncrease, lipidFacts, plainDose, reviewedDays } from "@/lib/lipid-planner/facts";
import { buildLipidPlan, type LipidPlan } from "@/lib/lipid-planner/plan";
import { LIPID_OPEN_GUIDANCE, LIPID_RULES } from "@/lib/lipid-planner/rules";
import { lipidPlannerReadSchema, type LipidPlannerOn } from "@/lib/lipid-planner/schema";
import { LIPID_SOURCES } from "@/lib/lipid-planner/sources";
import { toolResultSchema } from "@/lib/staff-zoe/contracts";
import { lipidPlanResult } from "@/lib/staff-zoe/lipid-plan";

/** SYNTHETIC checks for the lipid follow-up planner: the engine, each rule, Mariam's dates and the boundary cases. */
globalThis.fetch = (() => { throw Error("network used in a check"); }) as typeof fetch;

type Record_ = Extract<LipidPlannerOn["record"], { enabled: true }>;
const id = (n: number) => `1d700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = "2026-01-01T10:00:00+04:00";
const therapy = (o: Partial<Record_["therapies"][number]> = {}): Record_["therapies"][number] => ({ id: id(1), drug: "atorvastatin", other: null, dose: "40 mg", startedOn: "2026-09-01", maximallyTolerated: false, recordedAt: at, endedAt: null, endReason: null, stoppedOn: null, ...o });
const event = (type: Record_["events"][number]["type"], on: string | null = "2026-09-01"): Record_["events"][number] => ({ id: id(2), type, other: type === "other" ? "Something else" : null, on, source: "document", note: null, recordedAt: at });
type Baseline = Record_["goals"][number]["baseline"];
const documented = (mmol = 3.8, on = "2026-08-20"): Baseline => ({ kind: "pre_treatment", mmol, on, source: "document" });
const goal = (baseline: Baseline = documented(), o: Partial<Record_["goals"][number]> = {}): Record_["goals"][number] => ({ version: 1, category: "very_high", thresholdMmol: 1.4, reductionRule: true, reductionPct: 50, baseline, nextTestOn: null, setAt: at, doctorName: "Synthetic Doctor", reason: null, defaultsVersion: "x", byYou: true, ...o });
const ldl = (value: number, on: string, n = 3) => ({ id: `cr:${n}${on}`, value, unit: "mmol/L", on, source: "clinic_result" as const, name: "LDL-C", memberVisible: true });
const lab = (test: "alt" | "ck" | "lpa", on: string, name = test === "alt" ? "ALT" : test === "ck" ? "CK" : "Lp(a)", value = 30, unit = test === "alt" ? "U/L" : test === "ck" ? "U/L" : "nmol/L") => ({ id: `cr:${test}${on}`, test, value, unit, on, name });
const none: LipidPlannerOn["medicines"] = { today: "2026-10-30", days: 28, now: "2026-10-30T10:00:00+04:00", self: [], plan: [] };

function read(o: { today?: string; events?: Record_["events"]; therapies?: Record_["therapies"]; goals?: Record_["goals"]; reviewedLdl?: LipidPlannerOn["reviewedLdl"]; reviewedLabs?: LipidPlannerOn["reviewedLabs"]; medicines?: LipidPlannerOn["medicines"]; concerns?: LipidPlannerOn["concerns"]; loop?: Record_["loop"] } = {}): LipidPlannerOn {
  const today = o.today ?? "2026-10-30";
  return {
    version: "lipid-planner-v1", enabled: true, today,
    record: { version: "ldl-goal-v1", enabled: true, today, events: o.events ?? [], therapies: o.therapies ?? [], goals: o.goals ?? [], observations: [], loop: o.loop ?? null },
    reviewedLdl: o.reviewedLdl ?? [], reviewedLabs: o.reviewedLabs ?? [], medicines: o.medicines ?? none, concerns: o.concerns ?? [],
  };
}
const plan = (o: Parameters<typeof read>[0] = {}) => buildLipidPlan(read(o))!;
const rule = (p: LipidPlan, ruleId: string) => { const d = p.decisions.find((x) => x.ruleId === ruleId); assert.ok(d, ruleId); return d; };
const item = (p: LipidPlan, test: string) => p.timeline.find((i) => i.test === test);
const has = (p: LipidPlan, ruleId: string) => p.notes.some((n) => n.ruleIds.includes(ruleId));

// ---------- Engine: three-valued logic, windows, dates ----------
assert.equal(triNot("UNKNOWN"), "UNKNOWN");
assert.equal(triAll(["TRUE", "UNKNOWN"]), "UNKNOWN");
assert.equal(triAll(["FALSE", "UNKNOWN"]), "FALSE");
assert.equal(triAny(["TRUE", "UNKNOWN"]), "TRUE");
assert.equal(triAny(["FALSE", "UNKNOWN"]), "UNKNOWN");
{
  const tri = { a: "TRUE", b: "UNKNOWN", c: "FALSE" } as Record<"a" | "b" | "c", Tri>;
  assert.equal(evaluate({ all: [{ fact: "a" }, { fact: "b" }] }, tri), "UNKNOWN");
  assert.deepEqual(unknownFacts({ all: [{ fact: "a" }, { fact: "b" }] }, tri), ["b"]);
  assert.deepEqual(unknownFacts({ all: [{ fact: "c" }, { fact: "b" }] }, tri), [], "a FALSE settles it");
  assert.equal(evaluate({ not: { fact: "b" } }, tri), "UNKNOWN", "not unknown is not normal");
}
assert.equal(windowStatus("2026-11-20", "2027-01-15", "2026-11-19"), "scheduled");
assert.equal(windowStatus("2026-11-20", "2027-01-15", "2026-11-20"), "due_now", "first day of the window");
assert.equal(windowStatus("2026-11-20", "2027-01-15", "2027-01-15"), "due_now", "last day of the window");
assert.equal(windowStatus("2026-11-20", "2027-01-15", "2027-01-16"), "overdue");
assert.equal(addInterval("2026-10-23", { weeks: 4 }), "2026-11-20");
assert.equal(addInterval("2027-02-18", { years: 1 }), "2028-02-18");
assert.equal(addInterval("2028-02-29", { years: 1 }), "2029-03-01");
{
  // An UNKNOWN rule does not act: no dated item and no action note, only what is missing.
  const set: Ruleset<"x", "d", "t", "s", "o"> = { version: "v", status: "proposed", factLabels: { x: ["Missing x", "", ""] }, rules: [
    { id: "T1", status: "proposed", title: ["t", "t", "t"], when: { fact: "x" }, then: { kind: "test", test: "t", group: "g", anchor: "d", from: { weeks: 1 }, to: { weeks: 2 } }, sources: ["s"] },
    { id: "T2", status: "proposed", title: ["t", "t", "t"], when: { fact: "x" }, then: { kind: "question", text: ["Ask", "", ""] }, sources: ["s"] },
  ] };
  const r = runRules(set, { today: "2026-10-30", tri: { x: "UNKNOWN" }, dates: { d: "2026-10-01" }, results: {}, confirmed: null });
  assert.deepEqual(r.timeline, [{ ruleId: "T1", test: "t", state: "undated", missing: ["x"] }]);
  assert.deepEqual(r.notes.map((n) => n.text[0]), ["Missing x"]);
  const applied = runRules(set, { today: "2026-10-30", tri: { x: "TRUE" }, dates: { d: null }, results: {}, confirmed: null });
  assert.equal(applied.timeline[0].state, "undated", "applies with no anchor: never scheduled");
}

// ---------- The ruleset is configuration, proposed, sourced ----------
assert.equal(LIPID_RULES.status, "proposed");
assert.match(LIPID_RULES.version, /^lipid-rules-\d{4}-\d{2}-\d{2}$/);
assert.equal(new Set(LIPID_RULES.rules.map((r) => r.id)).size, LIPID_RULES.rules.length);
for (const r of LIPID_RULES.rules) {
  assert.equal(r.status, "proposed", `${r.id} is not signed`);
  assert.ok(r.sources.length, `${r.id} has a source`);
  for (const s of r.sources) assert.ok(LIPID_SOURCES[s], `${r.id}: ${s}`);
  for (const o of r.open ?? []) assert.ok(LIPID_OPEN_GUIDANCE[o], `${r.id}: ${o}`);
  for (const l of r.title) assert.ok(l.trim(), r.id);
}
for (const o of Object.values(LIPID_OPEN_GUIDANCE)) assert.ok(o.positions.length, "an open entry states its positions");
{
  const text = JSON.stringify(LIPID_RULES) + JSON.stringify(LIPID_OPEN_GUIDANCE) + JSON.stringify(LIPID_SOURCES);
  // ERRATA: nothing from the prototype's placeholders or its wrong statements.
  assert.doesNotMatch(text, /DEMO-|demo p\.|Class I|IIa|6.12 weeks|high.intensity/i);
  // No medicine selection, no dose. Ezetimibe appears only as ACC/AHA's monitoring position, never as a step.
  for (const r of LIPID_RULES.rules) assert.doesNotMatch(JSON.stringify(r), /ezetimibe|statin|PCSK9|inclisiran|\d+ ?mg/i, `${r.id} names no medicine`);
  // No adherence cut-off and no ALT multiple: the reviews found no source for either.
  assert.doesNotMatch(text, /90 ?%|3 ?[×x] ?ULN/i);
}
assert.deepEqual(LIPID_RULES.rules.find((r) => r.id === "LR-01")!.then.kind === "test" ? [(LIPID_RULES.rules.find((r) => r.id === "LR-01")!.then as { from: { weeks: number } }).from.weeks, (LIPID_RULES.rules.find((r) => r.id === "LR-01")!.then as { to: { weeks: number } }).to.weeks] : [], [...LDL_RETEST_WEEKS.acs], "the heart-attack window matches the app's");

// ---------- Mariam's example, from the change log, where it fits (non-ACS, high risk, started 23 Oct 2026) ----------
{
  const started = { therapies: [therapy({ dose: "20 mg", startedOn: "2026-10-23" })], events: [event("tia", "2026-10-01")],
    goals: [goal(documented(3.8, "2026-10-15"), { category: "high", thresholdMmol: 1.8 })] };
  const first = plan({ ...started, today: "2026-10-23" });
  const lipid = item(first, "lipid"), alt = item(first, "alt");
  assert.ok(lipid?.state === "dated" && alt?.state === "dated");
  assert.deepEqual([lipid.from, lipid.to, lipid.status], ["2026-11-20", "2027-01-15", "scheduled"]);
  assert.deepEqual([alt.from, alt.to, alt.status], ["2026-12-18", "2027-01-15", "scheduled"]);
  assert.ok(has(first, "LR-10"), "no baseline CK on record");
  const week8 = plan({ ...started, today: "2026-12-18", reviewedLdl: [ldl(2.3, "2026-12-18")] });
  assert.ok(week8.goalCheck.run && week8.goalCheck.reduction.part);
  assert.equal(week8.goalCheck.overall, "FALSE");
  assert.equal(week8.goalCheck.reduction.percent.toFixed(1), "39.5");
  assert.ok(has(week8, "LR-12"), "above goal asks; it proposes nothing");
  // No later change, so the goal-reached example dates the yearly test from the result.
  const reached = plan({ ...started, today: "2027-02-19", reviewedLdl: [ldl(2.3, "2026-12-18"), ldl(1.6, "2027-02-18")] });
  assert.ok(reached.goalCheck.run && reached.goalCheck.reduction.part);
  assert.equal(reached.goalCheck.reduction.percent.toFixed(1), "57.9");
  assert.equal(reached.goalCheck.overall, "TRUE");
  const yearly = item(reached, "lipid_annual");
  assert.ok(yearly?.state === "dated");
  assert.deepEqual([yearly.from, yearly.status], ["2028-02-18", "scheduled"]);
}

// ---------- LR-01 and LR-02: stroke versus heart attack ----------
{
  const change = { therapies: [therapy({ startedOn: "2026-10-01" })] };
  const mi = plan({ ...change, events: [event("acs_mi", "2026-09-20")] });
  const stroke = plan({ ...change, events: [event("ischaemic_stroke", "2026-09-20")] });
  const tia = plan({ ...change, events: [event("tia", "2026-09-20")] });
  assert.equal(rule(mi, "LR-01").result, "TRUE"); assert.equal(rule(mi, "LR-02").result, "FALSE");
  assert.equal(rule(stroke, "LR-01").result, "FALSE"); assert.equal(rule(stroke, "LR-02").result, "TRUE");
  const a = item(mi, "lipid"), b = item(stroke, "lipid");
  assert.ok(a?.state === "dated" && b?.state === "dated");
  assert.deepEqual([a.from, a.to], ["2026-10-29", "2026-11-12"], "4 to 6 weeks");
  assert.deepEqual([b.from, b.to], ["2026-10-29", "2026-12-24"], "4 to 12 weeks");
  assert.ok(mi.open.includes("retest_acs") && !mi.open.includes("retest_general"));
  assert.ok(stroke.open.includes("retest_general") && stroke.open.includes("stroke_risk"), "stroke guidance stays open");
  assert.ok(has(stroke, "LR-14") && has(tia, "LR-14") && !has(mi, "LR-14"));
  // A heart attack after the last change anchors there; a stroke does not.
  const later = item(plan({ ...change, events: [event("acs_mi", "2026-10-10")] }), "lipid");
  assert.ok(later?.state === "dated"); assert.equal(later.from, "2026-11-07");
  // Both events: the heart-attack window, and no stroke question about a member with an MI on record.
  const both = plan({ ...change, events: [event("acs_mi"), event("ischaemic_stroke")] });
  assert.equal(rule(both, "LR-01").result, "TRUE"); assert.equal(rule(both, "LR-14").result, "FALSE");
  // No event, or one of type other: unknown, so one undated line and a gap, not a default window.
  for (const events of [[], [event("other")]]) {
    const p = plan({ ...change, events });
    assert.equal(rule(p, "LR-01").result, "UNKNOWN"); assert.equal(rule(p, "LR-02").result, "UNKNOWN");
    assert.deepEqual(p.timeline.filter((i) => i.test === "lipid").map((i) => i.state), ["undated"]);
    assert.ok(p.notes.some((n) => /event type is not settled/.test(n.text[0])));
  }
  // Heart attack with no usable dates: applies, not dated.
  const undated = plan({ therapies: [therapy({ startedOn: null })], events: [event("acs_mi", null)] });
  assert.equal(rule(undated, "LR-01").result, "UNKNOWN");
  assert.equal(item(undated, "lipid")?.state, "undated");
  // Heart attack dated, start date missing: an older event cannot stand in for the latest change, and a later result is not "done".
  const hidden = plan({ therapies: [therapy({ startedOn: null })], events: [event("acs_mi", "2026-02-01")], reviewedLdl: [ldl(1.2, "2026-08-01")] });
  assert.equal(rule(hidden, "LR-01").result, "UNKNOWN"); assert.equal(item(hidden, "lipid")?.state, "undated");
  assert.ok(hidden.notes.some((n) => /therapy start or stop date/.test(n.text[0])));
  // A stop with no date hides the latest change too (Astra LP-R1): no "done", no yearly test.
  const noStop = { therapies: [therapy({ startedOn: "2026-01-10" }), therapy({ drug: "ezetimibe", dose: "10 mg", startedOn: "2026-03-01", endedAt: at, endReason: "stopped", stoppedOn: null })], events: [event("acs_mi", "2026-01-05")], goals: [goal(documented(3.0, "2025-12-01"))], reviewedLdl: [ldl(1.2, "2026-08-01")] };
  const unclearStop = plan(noStop);
  assert.equal(rule(unclearStop, "LR-01").result, "UNKNOWN"); assert.equal(item(unclearStop, "lipid")?.state, "undated");
  assert.equal(rule(unclearStop, "LR-03").result, "UNKNOWN"); assert.equal(item(unclearStop, "lipid_annual"), undefined);
  // An undated event hides whether the result followed it. An event after the result restarts the cycle.
  const undatedEvent = plan({ ...noStop, therapies: [noStop.therapies[0]], events: [event("acs_mi", null)] });
  assert.equal(rule(undatedEvent, "LR-01").result, "UNKNOWN"); assert.equal(rule(undatedEvent, "LR-03").result, "UNKNOWN");
  assert.equal(rule(plan({ ...noStop, therapies: [noStop.therapies[0]], events: [event("acs_mi", "2026-09-01")] }), "LR-03").result, "FALSE");
  // Non-ACS with a start date missing: undated.
  assert.equal(item(plan({ therapies: [therapy({ startedOn: null })], events: [event("tia")] }), "lipid")?.state, "undated");
  // Therapy not recorded: unknown. All therapy stopped: no window, and a gap says why.
  const noTherapy = plan({ events: [event("acs_mi")] });
  assert.equal(rule(noTherapy, "LR-01").result, "UNKNOWN");
  assert.ok(noTherapy.notes.some((n) => n.text[0] === "No lipid therapy recorded."));
  const stopped = plan({ events: [event("acs_mi")], therapies: [therapy({ endedAt: at, endReason: "stopped", stoppedOn: "2026-10-01" })] });
  assert.equal(rule(stopped, "LR-01").result, "FALSE"); assert.equal(rule(stopped, "LR-17").result, "TRUE"); assert.equal(item(stopped, "lipid"), undefined);
}

// ---------- Timeline state from results and today ----------
{
  const base = { therapies: [therapy({ startedOn: "2026-09-01" })], events: [event("acs_mi", "2026-09-01")] };
  const status = (today: string, reviewedLdl: LipidPlannerOn["reviewedLdl"] = []) => { const i = item(plan({ ...base, today, reviewedLdl }), "lipid")!; return i.state === "dated" ? i.status : i.state; };
  assert.equal(status("2026-09-28"), "scheduled");
  assert.equal(status("2026-09-29"), "due_now");
  assert.equal(status("2026-10-13"), "due_now");
  assert.equal(status("2026-10-14"), "overdue");
  assert.equal(status("2026-10-14", [ldl(1.3, "2026-09-20")]), "overdue", "a result before the window does not count");
  assert.equal(status("2026-10-14", [ldl(1.3, "2026-09-29")]), "done");
  assert.equal(status("2026-12-14", [ldl(1.3, "2026-12-01")]), "done", "a late result still counts");
  // The doctor's confirmed window replaces the rule's dates; the rule stays the reason.
  const loop: Record_["loop"] = { responses: [], retests: [{ id: id(5), dueFrom: "2026-11-01", dueTo: "2026-11-15", state: "scheduled", overdue: false, rule: "other", anchorOn: "2026-09-01", requestOn: "2026-10-25", therapyId: id(1), requestStatus: null, createdAt: at, closedAt: null, defaultsVersion: "x" }] };
  const c = item(plan({ ...base, loop, today: "2026-11-01" }), "lipid");
  assert.ok(c?.state === "dated" && c.confirmed); assert.deepEqual([c.from, c.to, c.status], ["2026-11-01", "2026-11-15", "due_now"]);
  // Confirmed window with the event unknown: the window still shows.
  assert.equal(item(plan({ therapies: base.therapies, loop }), "lipid")?.state, "dated");
  // A closed re-test does not.
  const closed = { ...loop, retests: loop.retests.map((r) => ({ ...r, state: "done" as const })) };
  const c2 = item(plan({ ...base, loop: closed }), "lipid");
  assert.ok(c2?.state === "dated" && !c2.confirmed);
  // Overdue sorts first.
  const order = plan({ ...base, today: "2026-10-20" }).timeline.map((i) => i.test);
  assert.deepEqual(order, ["lipid", "alt"]);
}

// ---------- LR-03: yearly test needs both parts, and no later change ----------
{
  const t = [therapy({ startedOn: "2026-06-01" })], e = [event("acs_mi", "2026-06-01")];
  assert.equal(rule(plan({ therapies: t, events: e, goals: [goal(documented(3.0, "2026-05-01"))], reviewedLdl: [ldl(1.2, "2026-08-01")] }), "LR-03").result, "TRUE");
  const onlyThreshold = plan({ therapies: t, events: e, goals: [goal(documented(2.0, "2026-05-01"))], reviewedLdl: [ldl(1.3, "2026-08-01")] });
  assert.equal(rule(onlyThreshold, "LR-03").result, "FALSE", "under 1.4 alone is not the goal");
  assert.equal(item(onlyThreshold, "lipid_annual"), undefined);
  const noBaseline = plan({ therapies: t, events: e, goals: [goal({ kind: "unknown", mmol: null, on: null, source: null })], reviewedLdl: [ldl(1.3, "2026-08-01")] });
  assert.equal(rule(noBaseline, "LR-03").result, "UNKNOWN");
  assert.equal(item(noBaseline, "lipid_annual"), undefined, "unknown never dates a yearly test");
  const changed = plan({ therapies: [...t, therapy({ drug: "ezetimibe", dose: "10 mg", startedOn: "2026-09-01" })], events: e, goals: [goal(documented(3.0, "2026-05-01"))], reviewedLdl: [ldl(1.2, "2026-08-01")] });
  assert.equal(rule(changed, "LR-03").result, "FALSE", "a change after the result restarts the test cycle");
}

// ---------- LR-04: ALT, and the dose direction ----------
{
  assert.equal(plainDose("20 mg"), 20); assert.equal(plainDose("2,5мг"), 2.5); assert.equal(plainDose("20"), 20);
  assert.equal(plainDose("2 tablets of 20 mg"), null); assert.equal(plainDose("140 mg every 2 weeks"), null);
  const r1 = therapy({ dose: "20 mg", startedOn: "2026-05-01", endedAt: at, endReason: "stopped", stoppedOn: "2026-08-01" });
  assert.deepEqual(lastStartOrIncrease([r1, therapy({ dose: "40 mg", startedOn: "2026-08-01" })]), { on: "2026-08-01", known: "TRUE" });
  assert.deepEqual(lastStartOrIncrease([r1, therapy({ dose: "10 mg", startedOn: "2026-08-01" })]), { on: "2026-05-01", known: "TRUE" }, "a reduction is not a start");
  assert.deepEqual(lastStartOrIncrease([r1, therapy({ dose: "half a tablet", startedOn: "2026-08-01" })]), { on: null, known: "UNKNOWN" });
  assert.deepEqual(lastStartOrIncrease([therapy({ startedOn: null })]), { on: null, known: "UNKNOWN" });
  // Stopping and starting again is a new start at any dose (Astra LP-R2); a dose change with no gap is compared; an unknown stop is unknown.
  const stoppedApril = therapy({ dose: "20 mg", startedOn: "2026-01-01", endedAt: at, endReason: "stopped", stoppedOn: "2026-04-01" });
  assert.deepEqual(lastStartOrIncrease([stoppedApril, therapy({ dose: "20 mg", startedOn: "2026-09-01" })]), { on: "2026-09-01", known: "TRUE" }, "same dose restart");
  assert.deepEqual(lastStartOrIncrease([stoppedApril, therapy({ dose: "10 mg", startedOn: "2026-09-01" })]), { on: "2026-09-01", known: "TRUE" }, "lower dose restart");
  assert.deepEqual(lastStartOrIncrease([stoppedApril, therapy({ dose: "10 mg", startedOn: "2026-04-01" })]), { on: "2026-01-01", known: "TRUE" }, "continuous reduction");
  assert.deepEqual(lastStartOrIncrease([{ ...stoppedApril, stoppedOn: null }, therapy({ dose: "20 mg", startedOn: "2026-09-01" })]), { on: null, known: "UNKNOWN" }, "unknown stop");
  assert.equal(item(plan({ today: "2026-10-30", events: [event("tia", "2025-12-01")], therapies: [stoppedApril, therapy({ dose: "20 mg", startedOn: "2026-09-01" })], reviewedLabs: [lab("alt", "2026-03-01")] }), "alt")?.state, "dated", "an old ALT does not close the restart's window");
  const base = { therapies: [therapy({ startedOn: "2026-08-01" })], events: [event("acs_mi")] };
  const alt = (today: string, reviewedLabs: LipidPlannerOn["reviewedLabs"] = []) => item(plan({ ...base, today, reviewedLabs }), "alt")!;
  const a = alt("2026-09-25");
  assert.ok(a.state === "dated"); assert.deepEqual([a.from, a.to, a.status], ["2026-09-26", "2026-10-24", "scheduled"]);
  assert.equal(alt("2026-10-25").state === "dated" && (alt("2026-10-25") as { status: string }).status, "overdue");
  assert.equal(alt("2026-10-25", [lab("alt", "2026-09-26")]).state, "done");
  assert.equal(alt("2026-10-25", [lab("alt", "2026-09-25")]).state, "dated", "before the window");
  assert.equal(alt("2026-10-25", [lab("alt", "2026-09-30", "ALT", 999999)]).state, "dated", "an implausible value is not a result");
  assert.ok(plan(base).open.includes("alt"), "ALT guidance differs and stays open");
  const unclear = plan({ ...base, therapies: [therapy({ dose: "20 mg", startedOn: "2026-05-01", endedAt: at, endReason: "stopped", stoppedOn: "2026-08-01" }), therapy({ dose: "one tablet", startedOn: "2026-08-01" })] });
  assert.equal(rule(unclear, "LR-04").result, "UNKNOWN"); assert.equal(item(unclear, "alt")?.state, "undated");
}

// ---------- LR-05, LR-15: reports ----------
{
  const base = { therapies: [therapy()], events: [event("acs_mi")] };
  const none_ = plan(base);
  assert.equal(rule(none_, "LR-05").result, "FALSE"); assert.equal(item(none_, "ck"), undefined);
  const report = plan({ ...base, concerns: [{ kind: "side_effect", on: "2026-10-20", medicine: "Atorvastatin" }] });
  assert.equal(rule(report, "LR-05").result, "UNKNOWN", "a report is not read as muscle symptoms, or as none");
  assert.equal(item(report, "ck")?.state, "undated");
  assert.ok(has(report, "LR-15"));
  assert.ok(report.notes.some((n) => /severe muscle pain/.test(n.text[0])));
  const stopping = plan({ ...base, concerns: [{ kind: "decided_to_stop", on: "2026-10-20", medicine: "Atorvastatin" }] });
  assert.ok(has(stopping, "LR-15")); assert.equal(rule(stopping, "LR-05").result, "FALSE");
  const other = plan({ ...base, concerns: [{ kind: "side_effect", on: "2026-10-20", medicine: "Amlodipine" }] });
  assert.ok(!has(other, "LR-15") && !other.reports.length, "another medicine's report is not a lipid report");
  const unnamed = plan({ ...base, concerns: [{ kind: "side_effect", on: "2026-10-20", medicine: "" }] });
  assert.equal(rule(unnamed, "LR-15").result, "UNKNOWN");
}

// ---------- Goal check: LR-06, boundaries ----------
{
  const check = (reviewedLdl: LipidPlannerOn["reviewedLdl"], g: Record_["goals"] = [goal(documented(2.8, "2026-05-01"))]) => plan({ goals: g, reviewedLdl }).goalCheck;
  const run = (mmol: number, baseline = 2.8) => { const c = check([ldl(mmol, "2026-09-01")], [goal(documented(baseline, "2026-05-01"))]); assert.ok(c.run && c.reduction.part); return c as Extract<typeof c, { run: true }> & { reduction: { part: true; percent: number; result: Tri } }; };
  // Exactly 1.4 is not under 1.4, and is 50% from 2.8: threshold not met, reduction met, shown separately.
  const at14 = run(1.4);
  assert.equal(at14.threshold.result, "FALSE"); assert.equal(at14.reduction.result, "TRUE"); assert.equal(at14.overall, "FALSE");
  assert.equal(run(1.3999).threshold.result, "TRUE");
  // 49.6% is not 50%, and is never shown rounded up.
  const b496 = run(1.008, 2.0);
  assert.equal(b496.reduction.percent.toFixed(1), "49.6"); assert.equal(b496.reduction.result, "FALSE"); assert.equal(b496.overall, "FALSE");
  assert.equal(run(1.0, 2.0).reduction.result, "TRUE", "exactly 50%");
  // Under 1.4 but only 35% lower: one part met.
  const partial = run(1.3, 2.0);
  assert.equal(partial.threshold.result, "TRUE"); assert.equal(partial.reduction.result, "FALSE"); assert.equal(partial.overall, "FALSE");
  // Half lower but above 1.4.
  const high = run(1.9, 4.0);
  assert.equal(high.threshold.result, "FALSE"); assert.equal(high.reduction.result, "TRUE");
  // Only when risk, baseline and latest LDL all exist.
  const none_ = (c: LipidPlan["goalCheck"]) => (c.run ? [] : c.missing);
  assert.deepEqual(none_(plan({ reviewedLdl: [ldl(1.3, "2026-09-01")] }).goalCheck), ["goal"]);
  assert.deepEqual(none_(check([])), ["latest"]);
  assert.deepEqual(none_(check([ldl(1.3, "2026-09-01")], [goal({ kind: "unknown", mmol: null, on: null, source: null })])), ["baseline_unknown"]);
  assert.deepEqual(none_(check([ldl(1.3, "2026-09-01")], [goal({ kind: "on_treatment", mmol: 2.2, on: "2026-05-01", source: "document" })])), ["baseline_on_treatment"]);
  assert.deepEqual(none_(check([ldl(1.3, "2026-05-01")])), ["no_later_value"], "a value on the baseline day is not a later value");
  // Missing baseline: not run, a question, and "percentage unknown" never reads as failed or as met.
  const miss = plan({ goals: [goal({ kind: "unknown", mmol: null, on: null, source: null })], reviewedLdl: [ldl(1.3, "2026-09-01")] });
  assert.equal(rule(miss, "LR-06").result, "UNKNOWN"); assert.ok(has(miss, "LR-07")); assert.equal(rule(miss, "LR-12").result, "UNKNOWN");
  // Above the threshold is above goal whatever the baseline.
  assert.equal(rule(plan({ goals: [goal({ kind: "unknown", mmol: null, on: null, source: null })], reviewedLdl: [ldl(2.1, "2026-09-01")] }), "LR-12").result, "TRUE");
  // On-treatment baseline: a value exists but it is not pre-treatment.
  const onT = plan({ goals: [goal({ kind: "on_treatment", mmol: 2.2, on: "2026-05-01", source: "document" })], reviewedLdl: [ldl(1.3, "2026-09-01")] });
  assert.equal(rule(onT, "LR-06").result, "FALSE"); assert.ok(has(onT, "LR-07"));
  // A goal with no reduction part: the threshold decides.
  const noPart = check([ldl(2.0, "2026-09-01")], [goal(documented(3.5, "2026-05-01"), { category: "moderate", thresholdMmol: 2.6, reductionRule: false, reductionPct: null })]);
  assert.ok(noPart.run && !noPart.reduction.part); assert.equal(noPart.overall, "TRUE");
  // Latest counted value on the newest day; a member-typed value never counts.
  const typed = plan({ goals: [goal(documented(2.8, "2026-05-01"))], reviewedLdl: [ldl(1.3, "2026-09-01"), { ...ldl(1.0, "2026-10-01"), source: "member", name: null }] }).goalCheck;
  assert.ok(typed.run); assert.equal(typed.latest.mmol, 1.3);
  // mg/dL converts; compared unrounded.
  const mg = plan({ goals: [goal(documented(2.8, "2026-05-01"))], reviewedLdl: [{ ...ldl(54, "2026-09-01"), unit: "mg/dL" }] }).goalCheck;
  assert.ok(mg.run); assert.equal(mg.threshold.result, "TRUE");
  // The doctor's newest goal version decides.
  const v2 = plan({ goals: [goal(documented(2.8, "2026-05-01"), { version: 2, thresholdMmol: 1.0 }), goal(documented(2.8, "2026-05-01"))], reviewedLdl: [ldl(1.2, "2026-09-01")] }).goalCheck;
  assert.ok(v2.run); assert.equal(v2.threshold.result, "FALSE");
}

// ---------- LR-07 to LR-13, LR-16 ----------
{
  const start = { therapies: [therapy({ startedOn: "2026-06-01" })], events: [event("acs_mi")] };
  const clear = plan({ ...start, reviewedLabs: [lab("ck", "2026-05-20"), lab("alt", "2026-05-20"), lab("lpa", "2026-05-20")] });
  assert.equal(rule(clear, "LR-09").result, "FALSE"); assert.equal(rule(clear, "LR-10").result, "FALSE"); assert.equal(rule(clear, "LR-11").result, "FALSE");
  const after = plan({ ...start, reviewedLabs: [lab("ck", "2026-07-20"), lab("alt", "2026-07-20")] });
  assert.equal(rule(after, "LR-09").result, "TRUE", "a value after the start is not a baseline"); assert.equal(rule(after, "LR-10").result, "TRUE");
  assert.equal(rule(plan({ ...start, reviewedLabs: [lab("ck", "2026-06-01")] }), "LR-10").result, "FALSE", "the start day counts");
  assert.ok(after.open.includes("ck"));
  const noDate = plan({ therapies: [therapy({ startedOn: null })] });
  assert.equal(rule(noDate, "LR-10").result, "UNKNOWN", "no start date: cannot say a baseline is missing or present");
  assert.ok(noDate.notes.some((n) => /first therapy start date/.test(n.text[0])));
  assert.equal(rule(plan(), "LR-11").result, "TRUE");
  // CK names; CK-MB is a different test.
  const ck = (name: string) => reviewedDays([lab("ck", "2026-05-20", name)], "ck").length;
  for (const n of ["CK", "CPK", "Creatine kinase", "Креатинкиназа", "КФК общая", "Կրեատինկինազ"]) assert.equal(ck(n), 1, n);
  for (const n of ["CK-MB", "КФК-МВ", "Check", "Creatinine"]) assert.equal(ck(n), 0, n);
  assert.equal(reviewedDays([lab("alt", "2026-05-20", "Total protein")], "alt").length, 0, "another test's name is not ALT");
  // A baseline dated after the first therapy.
  const late = plan({ ...start, goals: [goal(documented(3.0, "2026-06-10"))] });
  assert.ok(has(late, "LR-08")); assert.ok(!has(plan({ ...start, goals: [goal(documented(3.0, "2026-06-01"))] }), "LR-08"));
  // Above goal asks; no medicine, dose or percentage cut-off in the question.
  const above = plan({ ...start, goals: [goal(documented(3.0, "2026-05-01"))], reviewedLdl: [ldl(2.1, "2026-09-01")] });
  assert.ok(has(above, "LR-12") && has(above, "LR-13"));
  assert.ok(!has(plan({ ...start, therapies: [therapy({ startedOn: "2026-06-01", maximallyTolerated: true })], goals: [goal(documented(3.0, "2026-05-01"))], reviewedLdl: [ldl(2.1, "2026-09-01")] }), "LR-13"));
  assert.ok(!has(plan({ ...start, goals: [goal(documented(3.0, "2026-05-01"))], reviewedLdl: [ldl(1.2, "2026-09-01")] }), "LR-12"));
  // Adherence is shown as facts; there is no rule on its size.
  const med = (name: string, status: "taken" | "skipped") => ({ ...none, plan: [{ id: id(9), source: "plan" as const, name, dose: "40 mg", times: ["21:00"], startedOn: "2026-10-01", endDate: null, effectiveAt: null, doses: [{ dueAt: "2026-10-29T21:00:00+04:00", status, recordedAt: "2026-10-29T21:00:00+04:00" }] }] });
  const logged = plan({ ...start, medicines: med("Atorvastatin", "taken") });
  assert.ok(logged.adherence && logged.adherence.expected > 0); assert.equal(rule(logged, "LR-16").result, "FALSE");
  assert.equal(rule(plan({ ...start, medicines: med("Amlodipine", "taken") }), "LR-16").result, "TRUE", "another medicine is not lipid intake");
  assert.equal(rule(plan(start), "LR-16").result, "TRUE");
}

// ---------- An empty record: nothing is normal ----------
{
  const p = plan();
  assert.equal(p.goalCheck.run, false);
  assert.ok(!p.timeline.some((i) => i.state === "dated" || i.state === "done"));
  assert.ok(p.decisions.some((d) => d.result === "UNKNOWN"));
  assert.ok(p.notes.length >= 3);
}
assert.equal(buildLipidPlan({ ...read(), record: { version: "ldl-goal-v1", enabled: false } }), null);

// ---------- The read's shape ----------
assert.equal(lipidPlannerReadSchema.safeParse({ version: "lipid-planner-v1", enabled: false }).success, true);
assert.equal(lipidPlannerReadSchema.safeParse(read()).success, true);
assert.equal(lipidPlannerReadSchema.safeParse({ version: "other", enabled: false }).success, false);

// ---------- The card: proposed, separate parts, read-only ----------
{
  const render = (p: LipidPlan, locale: "en" | "hy" | "ru" = "en") => renderToStaticMarkup(createElement(LipidPlanCard, { plan: p, locale }));
  const full = plan({ today: "2026-10-30", therapies: [therapy({ startedOn: "2026-09-01" })], events: [event("ischaemic_stroke")], goals: [goal(documented(2.0, "2026-08-01"))], reviewedLdl: [ldl(1.008, "2026-10-01")] });
  const html = render(full);
  assert.match(html, /Proposed rules, under clinical review/);
  assert.doesNotMatch(html, /Armen|Yesayi|not signed|pending/);
  assert.doesNotMatch(html, /lipid-rules-|LR-\d+/, "Internal rule ids stay in the plan data, not the doctor card");
  assert.match(html, /Threshold/); assert.match(html, /Reduction from pre-treatment LDL/);
  assert.match(html, /49%/, "49.6 shows as 49, never 50"); assert.doesNotMatch(html, /50%\s*·/);
  assert.match(html, /Due now/); assert.match(html, /Guidance differs/);
  assert.match(html, /ESC\/EAS 2019 Table 13/); assert.match(html, /ACC\/AHA 2026 §3\.5/);
  assert.match(html, /proposed/);
  assert.match(html, /Applies/); assert.match(html, /Does not apply/);
  assert.doesNotMatch(html, />TRUE<|>FALSE<|>UNKNOWN</);
  assert.doesNotMatch(html, /<form|<button|type="submit"/, "read-only");
  assert.doesNotMatch(html, /—/, "no em dashes");
  assert.match(render(plan()), /Not run:/);
  assert.match(render(plan()), /Not dated|Nothing can be dated/);
  for (const l of ["hy", "ru"] as const) {
    const h = render(full, l);
    assert.match(h, l === "hy" ? /Առաջարկվող կանոններ/ : /Предлагаемые правила/);
    assert.doesNotMatch(h, /Follow-up tests|Threshold/);
  }
}
// ---------- The Doctor Zoe card: code-written, proposed, the shape Doctor Zoe stores ----------
{
  const memberId = id(77);
  const p = plan({ therapies: [therapy({ startedOn: "2026-09-01" })], events: [event("acs_mi")], goals: [goal(documented(2.0, "2026-08-01"))], reviewedLdl: [ldl(1.008, "2026-10-01")], today: "2026-10-30" });
  const r = lipidPlanResult(p, { memberId, locale: "en" });
  assert.ok(toolResultSchema.safeParse(r).success);
  assert.match(r.facts[0].value, /Proposed rules, under clinical review/);
  assert.ok(r.facts.some((f) => /Lipid test/.test(f.label) && /Done|Overdue|Due now|Scheduled/.test(f.value)));
  assert.ok(r.facts.some((f) => /Threshold/.test(f.label) && /Met/.test(f.value)));
  assert.ok(r.facts.some((f) => /Reduction/.test(f.label) && /49% .*Not met/.test(f.value)));
  assert.ok(r.facts.every((f) => f.analyte === null && f.mark === null && !/—/.test(f.value)));
  assert.equal(r.href, `/staff/real/members/${memberId}`);
  const hy = lipidPlanResult(plan(), { memberId, locale: "hy" });
  assert.ok(toolResultSchema.safeParse(hy).success);
  assert.match(hy.facts[0].value, /Առաջարկվող կանոններ/);
  assert.ok(hy.facts.some((f) => /Չի կատարվել/.test(f.value)), "the goal check says it was not run");
}
{ // A reviewed value not yet published still decides the plan: published 1.3 then reviewed 2.5 is not a met goal.
  const facts = lipidFacts(read({ goals: [goal(undefined, { reductionRule: false, reductionPct: null })], reviewedLdl: [ldl(1.3, "2026-09-20", 3), { ...ldl(2.5, "2026-10-20", 4), memberVisible: false }] }))!;
  assert.equal(facts.tri.goalMet, "FALSE");
}
console.log("Lipid planner checks passed.");
