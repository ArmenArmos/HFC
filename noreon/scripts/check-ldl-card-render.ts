import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LdlGoalCard } from "@/components/patient-care/ldl-goal-card";
import { LdlGoalPanel } from "@/components/staff/ldl-goal-panel";
import type { DoctorLdlOn, MemberLdl } from "@/lib/ldl/schema";
import { LdlResponsesSection } from "@/components/doctor-inbox/ldl-responses";
import type { DoctorLdlResponse } from "@/lib/ldl/response-schema";

/** SYNTHETIC render checks for the member LDL card and the doctor panel: no number before the doctor confirms. */
globalThis.fetch = (() => { throw Error("network used in a check"); }) as typeof fetch;
const card = (data: MemberLdl | undefined, locale: "en" | "hy" | "ru" = "en", compact = false) => renderToStaticMarkup(createElement(LdlGoalCard, { data, locale, compact }));
const goal = { version: 1, category: "very_high" as const, thresholdMmol: 1.4, reductionRule: true, reductionPct: 50,
  baseline: { kind: "pre_treatment" as const, mmol: 3.8, on: "2026-08-20", source: "document" as const }, nextTestOn: "2026-12-01", setAt: "2026-10-29T10:00:00+04:00", doctorName: "Synthetic Doctor" };
const o = (id: string, value: number, on: string, source: "member" | "clinic_result" = "clinic_result") => ({ id, value, unit: "mmol/L", on, source, name: source === "member" ? null : "LDL-C", memberVisible: true });

// Off, unreadable, not in the pathway: nothing.
assert.equal(card(undefined), "");
assert.equal(card({ version: "ldl-member-v1", enabled: false }), "");
assert.equal(card({ version: "ldl-member-v1", enabled: true, inPathway: false }), "");

// In the pathway, no goal: "being set", no number, in every language.
for (const l of ["en", "hy", "ru"] as const) {
  const html = card({ version: "ldl-member-v1", enabled: true, inPathway: true, goal: null, observations: [] }, l);
  assert.match(html, l === "en" ? /Your doctor is setting your goal/ : l === "hy" ? /Ձեր բժիշկը սահմանում է ձեր նպատակը/ : /Ваш врач устанавливает вашу цель/);
  assert.doesNotMatch(html, /\d\.\d/, `${l}: no number before the goal is set`);
}

// Goal set, latest reviewed value below: below your goal, with the reduction and next test.
{
  const html = card({ version: "ldl-member-v1", enabled: true, inPathway: true, goal, observations: [o("a", 2.4, "2026-09-10"), o("b", 1.3, "2026-10-20")] });
  assert.match(html, /Your goal: below 1\.4 mmol\/L/);
  assert.match(html, /at least 50% lower than before treatment/);
  assert.match(html, />1\.3</);
  assert.match(html, /Below your goal/);
  assert.match(html, /66% lower than before treatment/);
  assert.match(html, /Next LDL test/);
}
// Above: the value is shown so it cannot read as below (1.44 shows 1.4 only because 1.4 is not below 1.4).
assert.match(card({ version: "ldl-member-v1", enabled: true, inPathway: true, goal, observations: [o("b", 1.9, "2026-10-20")] }), /Above your goal/);
{
  // Inside Zoe's card: her frame has the title, so the body comes alone, and who set the goal stays.
  const embedded = renderToStaticMarkup(createElement(LdlGoalCard, { data: { version: "ldl-member-v1", enabled: true, inPathway: true, goal, observations: [o("b", 1.9, "2026-10-20")] }, locale: "en", embedded: true }));
  assert.doesNotMatch(embedded, /Your LDL cholesterol goal|<section|<h2/);
  assert.match(embedded, /Set by /);
  assert.match(embedded, /Above your goal/);
}
// 1.36 against 1.4 shows 1.36, never "1.4 ... below your goal of 1.4".
assert.match(card({ version: "ldl-member-v1", enabled: true, inPathway: true, goal, observations: [o("b", 1.36, "2026-10-20")] }), />1\.36</);
// Only a value the member typed: no comparison, and the note that typed values do not decide.
{
  const html = card({ version: "ldl-member-v1", enabled: true, inPathway: true, goal, observations: [o("m", 1.1, "2026-10-20", "member")] });
  assert.match(html, /No result to compare yet/);
  assert.doesNotMatch(html, /Below your goal/);
  assert.match(html, /Values you add yourself show in your charts/);
}
// Compact (Home) links to Progress.
assert.match(card({ version: "ldl-member-v1", enabled: true, inPathway: true, goal, observations: [] }, "en", true), /href="\/patient\/progress"/);

// Doctor panel renders in all three languages, proposes very high for an ASCVD event, and shows the flag only to the doctor.
const doctor: DoctorLdlOn = {
  version: "ldl-goal-v1", enabled: true, today: "2026-10-29",
  events: [{ id: "00000000-0000-4000-8000-000000000001", type: "acs_mi", other: null, on: "2026-09-01", source: "document", note: null, recordedAt: "2026-10-29T10:00:00+04:00" }],
  therapies: [{ id: "00000000-0000-4000-8000-000000000002", drug: "atorvastatin", other: null, dose: "80 mg", startedOn: "2026-09-03", maximallyTolerated: true, recordedAt: "2026-10-29T10:00:00+04:00", endedAt: null, endReason: null, stoppedOn: null }],
  goals: [], observations: [o("b", 1.9, "2026-10-20")],
};
const act = async () => ({ status: "saved" as const });
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
for (const locale of ["en", "hy", "ru"] as const) {
  const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { refresh() {} } as never }, createElement(LdlGoalPanel, { data: doctor, memberId: "00000000-0000-4000-8000-000000000009", locale,
    actions: { addEvent: act, removeEvent: act, addTherapy: act, endTherapy: act, setGoal: act, cancelRetest: act } })));
  assert.ok(html.length > 1000, `${locale} renders`);
  if (locale === "en") {
    assert.match(html, /Goal not yet set/);
    assert.match(html, /Proposed: very high/);
    assert.match(html, /maximally tolerated/);
    assert.match(html, /Confirm goal and show it to the member/);
    assert.match(html, /Your doctor is setting your goal/);
  }
}

// Phase 2: the loop on the panel. The therapy form proposes the ACS window; open re-tests can be cancelled.
{
  const withLoop: DoctorLdlOn = { ...doctor, loop: { retests: [{ id: "00000000-0000-4000-8000-000000000003", dueFrom: "2026-11-26", dueTo: "2026-12-10", state: "requested", overdue: false,
    rule: "acs", anchorOn: "2026-10-29", requestOn: "2026-11-19", therapyId: "00000000-0000-4000-8000-000000000002", requestStatus: "requested", createdAt: "2026-10-29T10:00:00+04:00", closedAt: null, defaultsVersion: "ldl-defaults-2026-10-29" }],
    responses: [{ id: "00000000-0000-4000-8000-000000000004", observedOn: "2026-12-01", status: "above_goal", createdAt: "2026-12-01T10:00:00+04:00", closedAt: null }] } };
  const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { refresh() {} } as never }, createElement(LdlGoalPanel, { data: withLoop, memberId: "00000000-0000-4000-8000-000000000009", locale: "en",
    actions: { addEvent: act, removeEvent: act, addTherapy: act, endTherapy: act, setGoal: act, cancelRetest: act } })));
  assert.match(html, /book a re-test blood draw/);
  assert.match(html, /4 to 6 weeks after a heart attack/);
  // Task 19: the window after a therapy change with no heart attack comes from LDL_RETEST_WEEKS, in all three languages; the old default is gone.
  for (const [locale, re] of [["en", /4 to 6 weeks \(default/], ["hy", /4–6 շաբաթ \(/], ["ru", /4–6 недель \(/]] as const) {
    const stroke = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { refresh() {} } as never }, createElement(LdlGoalPanel, { data: { ...withLoop, events: withLoop.events.map((e) => ({ ...e, type: "ischaemic_stroke" as const })) }, memberId: "00000000-0000-4000-8000-000000000009", locale,
      actions: { addEvent: act, removeEvent: act, addTherapy: act, endTherapy: act, setGoal: act, cancelRetest: act } })));
    assert.match(stroke, re, locale);
    assert.doesNotMatch(stroke, /6 to 8|6–8/, locale);
  }
  // Task 19: excluded with no goal: a notice and no preselected category. Eligible through another event: a warning.
  {
    const panel = (types: string[], goals = withLoop.goals) => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { refresh() {} } as never }, createElement(LdlGoalPanel, { data: { ...withLoop, goals, events: types.map((type, n) => ({ ...withLoop.events[0]!, id: `00000000-0000-4000-8000-00000000010${n}`, type: type as "other" })) }, memberId: "00000000-0000-4000-8000-000000000009", locale: "en",
      actions: { addEvent: act, removeEvent: act, addTherapy: act, endTherapy: act, setGoal: act, cancelRetest: act } })));
    const excluded = panel(["haemorrhagic_stroke"], []);
    assert.match(excluded, /data-ldl-pilot-excluded/);
    assert.doesNotMatch(excluded, /name="baselineKind"/, "no goal form, so nothing is preselected");
    const both = panel(["haemorrhagic_stroke", "acs_mi"], []);
    assert.match(both, /data-ldl-pilot-warning/);
    assert.doesNotMatch(both, /data-ldl-pilot-excluded/);
    assert.match(both, /name="baselineKind"/);
  }
  assert.match(html, /Home-visit request in the admin queue/);
  assert.match(html, /No re-test needed/);
  assert.match(html, /open on Today/);
  // Loop off: no re-test controls.
  assert.doesNotMatch(renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { refresh() {} } as never }, createElement(LdlGoalPanel, { data: doctor, memberId: "00000000-0000-4000-8000-000000000009", locale: "en",
    actions: { addEvent: act, removeEvent: act, addTherapy: act, endTherapy: act, setGoal: act, cancelRetest: act } }))), /re-test/i);
}

// Phase 2: the member card shows the re-test window, an overdue test, and "with your doctor" without any new value.
{
  const base = { version: "ldl-member-v1" as const, enabled: true as const, inPathway: true as const, goal, observations: [o("b", 1.9, "2026-10-20")] };
  const retest = { id: "00000000-0000-4000-8000-000000000003", dueFrom: "2026-11-26", dueTo: "2026-12-10", state: "requested" as const, overdue: false };
  const win = card({ ...base, retest, withDoctor: null });
  assert.match(win, /Next LDL test: between/);
  assert.match(win, /nurse can take the blood sample at home/);
  assert.doesNotMatch(win, /Next LDL test: 1 Dec/, "the re-test window replaces the goal's next test date");
  assert.match(card({ ...base, retest: { ...retest, overdue: true } }), /Your cholesterol blood test is still to do/);
  for (const l of ["en", "hy", "ru"] as const) {
    const html = card({ ...base, retest: null, withDoctor: { since: "2026-12-01T10:00:00+04:00", doctorName: "Dr Synthetic" } }, l);
    assert.match(html, l === "en" ? /Your new cholesterol result is with Dr Synthetic\. They will tell you the next step\./ : l === "hy" ? /Ձեր խոլեստերինի նոր արդյունքը ձեր բժշկի մոտ է \(Dr Synthetic\)/ : /Ваш новый результат по холестерину у вашего врача \(Dr Synthetic\)/);
  }
  // LDLR-02: an admin's proposal is accepted from the card (the booking page may be unavailable); a confirmed visit shows its time.
  const request = { id: "00000000-0000-4000-8000-0000000000d1", revision: 2, status: "provider-proposed", algorithmVersion: "ldl-retest-v1",
    proposal: { provider: "Synthetic nurse service", startsAt: "2026-11-27T05:00:00.000Z", endsAt: "2026-11-27T06:00:00.000Z", preparation: "No fasting needed." }, arrangement: null };
  const routed = (data: MemberLdl) => renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: { refresh() {} } as never }, createElement(LdlGoalCard, { data, locale: "en" })));
  const proposed = routed({ ...base, retest: { ...retest, request } });
  assert.match(proposed, /A nurse visit for your blood test is proposed/);
  assert.match(proposed, /Accept this visit/);
  assert.match(proposed, /name="algorithmVersion" value="ldl-retest-v1"/);
  assert.doesNotMatch(proposed, /<button[^>]* disabled=""/, "accept is enabled");
  assert.match(card({ ...base, retest: { ...retest, request: { ...request, status: "confirmed", proposal: null, arrangement: request.proposal } } }), /Your blood test visit:/);
  // Before a goal: the window still shows, with no number.
  const noGoal = card({ version: "ldl-member-v1", enabled: true, inPathway: true, goal: null, observations: [], retest });
  assert.match(noGoal, /Next LDL test: between/);
  // Older database (no loop keys): unchanged.
  assert.match(card(base), /Next LDL test: /);
}

// Phase 2: the doctor's Today section. Value, goal, change, adherence, ALT and the guideline text with no selected medicine.
{
  const item = (status: DoctorLdlResponse["status"], nextStep: DoctorLdlResponse["facts"]["nextStep"], adherence: DoctorLdlResponse["facts"]["adherence"]): DoctorLdlResponse => ({
    id: "00000000-0000-4000-8000-000000000005", memberId: "00000000-0000-4000-8000-000000000009", memberName: "Synthetic Member", observedOn: "2026-12-01", status, createdAt: "2026-12-01T10:00:00+04:00",
    facts: { version: "ldl-response-facts-v1", defaultsVersion: "ldl-defaults-2026-10-29", value: { mmol: 1.9, on: "2026-12-01", source: "clinic_result" },
      goal: { version: 1, category: "very_high", thresholdMmol: 1.4, reductionPct: 50 }, previous: { mmol: 2.4, on: "2026-10-01" }, changePct: -20.83,
      reduction: { state: "met", percent: 50, requiredPct: 50 }, adherence, alt: { value: 31, on: "2026-12-01" }, nextStep, adherenceThresholdPct: 90 } });
  const good = { windowDays: 28, expected: 28, taken: 27, skipped: 1, percent: 96.4, medicines: ["Atorvastatin"] };
  const sect = (i: DoctorLdlResponse[] | null, l: "en" | "hy" | "ru" = "en") => renderToStaticMarkup(createElement(LdlResponsesSection, { items: i, l }));
  assert.equal(sect([]), "", "nothing when empty");
  assert.match(sect(null), /Unavailable/);
  const up = sect([item("above_goal", "step_up", good)]);
  for (const re of [/Above goal/, /1\.9 mmol\/L/, /&lt; 1\.4 mmol\/L/, /−21%/, /96% \(27 of 28 doses ticked taken; Atorvastatin\)/, /31 U\/L/, /consider stepping up treatment/, /consider adding ezetimibe or raising the statin dose\. You decide\./, /Mark reviewed/]) assert.match(up, re);
  assert.match(sect([item("above_goal", "adherence_first", { ...good, taken: 20, percent: 71.4 })]), /Adherence below 90%: adherence support first/);
  assert.match(sect([item("above_goal", "adherence_unknown", null)]), /adherence is not known/);
  // No 90% rule on a new row; a partly met goal is not green "At goal".
  const noCutOff = item("above_goal", "step_up", good);
  assert.match(sect([{ ...noCutOff, facts: { ...noCutOff.facts, adherenceThresholdPct: null } }]), /review adherence and treatment together/);
  const partly = item("at_goal", null, good);
  const one = sect([{ ...partly, facts: { ...partly.facts, reduction: { state: "not_met", percent: 30, requiredPct: 50 } } }]);
  assert.match(one, /One part of the goal met/);
  assert.doesNotMatch(one, />At goal</);
  assert.match(sect([partly]), />At goal</, "both parts met stays at goal");
  assert.match(sect([item("not_assessable", null, good)]), /No goal is set/);
  for (const l of ["hy", "ru"] as const) assert.ok(sect([item("above_goal", "step_up", good)], l).length > 1000, `${l} section renders`);
}
console.log("LDL card and panel render checks passed.");
