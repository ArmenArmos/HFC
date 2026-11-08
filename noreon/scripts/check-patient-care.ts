import { evaluate, needsAttention } from "@/lib/clinical/rules/engine";
import type { Answers } from "@/lib/clinical/types";
import assert from "node:assert/strict";
import {
  careActions,
  dosesForDay,
  canReportDose,
  resultGroups,
} from "@/lib/patient-care/model";
import { EMPTY_CARE, type CareData } from "@/lib/patient-care/types";
const now = new Date("2026-10-08T06:00:00Z");
const medication = {
  id: "m1",
  planId: "p1",
  name: "Prescribed medicine",
  dose: "1 tablet",
  instructions: "As prescribed",
  times: ["08:00", "20:00"],
  startDate: "2026-10-07",
  endDate: null,
  active: true,
};
const data: CareData = {
  ...EMPTY_CARE,
  plan: {
    id: "p1",
    clinician: "Doctor",
    publishedAt: "2026-10-07T06:00:00Z",
    acknowledgedAt: null,
    instructions: "Plan",
    medications: [medication],
  },
};
const base = { complete: true, urgent: false, measuredToday: false, now };
for (const measuredToday of [false, true]) {
  const next = careActions(EMPTY_CARE, { ...base, measuredToday });
  assert.equal(next[0].id, "assessment-next-steps", "A completed questionnaire must lead to its recommendations even without clinical orders");
  assert.equal(next[0].href, "/patient/health/profile");
}
assert.ok(!careActions(EMPTY_CARE, { ...base, complete: false }).some(a => a.id === "assessment-next-steps"));
assert.ok(!careActions(EMPTY_CARE, { ...base, showAssessmentNextSteps: false }).some(a => a.id === "assessment-next-steps"), "Fictional care stages must not claim questionnaire completion");
for (const acknowledgedAt of [null, now.toISOString()]) {
  const published = {...data, plan: {...data.plan!, acknowledgedAt}};
  assert.ok(!careActions(published, base).some(a => a.id === "assessment-next-steps"), "A published plan must not send the member back to the initial questionnaire next step");
  assert.ok(careActions(published, {...base, complete: false}).some(a => a.id === "questions"), "A new incomplete questionnaire remains actionable alongside a plan");
  assert.equal(careActions(published, {...base, urgent: true})[0].kind, "urgent");
  assert.ok(careActions(published, {...base, attention:[{id:'new-attention',detail:{en:'New clinician attention',hy:'New clinician attention'}}]}).some(a=>a.id==='new-attention'), "New questionnaire attention must not be suppressed by a published plan");
  assert.ok(careActions(published, {...base, assessmentCompletedAt:now.toISOString()}).some(a=>a.id==='assessment-next-steps'), "A questionnaire completed after an older plan must bring back screening next steps");
  assert.ok(!careActions(published, {...base, assessmentCompletedAt:published.plan.publishedAt}).some(a=>a.id==='assessment-next-steps'), "An assessment covered by publication must not bring back initial next steps");
}
assert.equal(careActions(data, { ...base, urgent: true })[0].kind, "urgent");
assert.equal(careActions(data, { ...base, urgent: true }).length, 1);
assert.equal(careActions(data, base)[0].kind, "medication");
const doses = dosesForDay(data, now);
assert.equal(doses.length, 2);
assert.equal(doses[0].dueAt, "2026-10-08T04:00:00.000Z");
assert.equal(doses[1].status, "upcoming");
assert.equal(canReportDose(data, "m1", doses[1].dueAt, now), false);
assert.equal(canReportDose(data, "m1", doses[0].dueAt, now), true);
assert.equal(canReportDose(data, "m1", "2026-10-07T04:00:00.000Z", now), false);
assert.equal(canReportDose(data, "someone-else", doses[0].dueAt, now), false);
assert.equal(
  canReportDose({ ...data, plan: null }, "m1", doses[0].dueAt, now),
  false,
);
assert.equal(
  dosesForDay(
    {
      ...data,
      plan: { ...data.plan!, medications: [{ ...medication, active: false }] },
    },
    now,
  ).length,
  0,
);
assert.equal(
  dosesForDay(
    {
      ...data,
      plan: {
        ...data.plan!,
        medications: [{ ...medication, endDate: "2026-10-07" }],
      },
    },
    now,
  ).length,
  0,
);
assert.equal(
  dosesForDay(data, new Date("2026-10-08T20:30:00Z"))[0].dueAt,
  "2026-10-09T04:00:00.000Z",
);
assert.equal(
  dosesForDay(
    {
      ...data,
      events: [
        {
          medicationId: "m1",
          dueAt: doses[0].dueAt,
          status: "taken",
          recordedAt: now.toISOString(),
        },
      ],
    },
    now,
  )[0].status,
  "taken",
);
assert.equal(
  careActions(EMPTY_CARE, { ...base, complete: false })[0].kind,
  "questions",
);
const test = {
  id: "t",
  title: "Blood tests",
  preparation: null,
  status: "ordered" as const,
  orderedBy: "Doctor",
  orderedAt: now.toISOString(),
  dueAt: null,
  location: null,
  source: "clinic" as const,
  sourceLabel: "Clinic",
};
assert.equal(
  careActions({ ...EMPTY_CARE, tests: [test] }, base)[0].kind,
  "tests",
);
assert.equal(
  careActions(
    { ...EMPTY_CARE, tests: [{ ...test, status: "collected" }] },
    base,
  )[0].kind,
  "waiting",
);
const result = {
  id: "r",
  testId: "t",
  marker: "LDL",
  value: 2.9,
  unit: "mmol/L",
  referenceLow: null,
  referenceHigh: null,
  collectedAt: now.toISOString(),
  receivedAt: now.toISOString(),
  source: "laboratory" as const,
  sourceLabel: "Lab",
  reviewedAt: null,
  reviewedBy: null,
  explanation: null,
};
assert.equal(
  careActions({ ...EMPTY_CARE, results: [result] }, base)[0].kind,
  "results",
);
assert.equal(
  resultGroups([result, { ...result, id: "r2", unit: "mg/dL" }]).length,
  2,
  "Never combine incompatible units",
);
const multi = {
  ...data,
  plan: {
    ...data.plan!,
    medications: [medication, { ...medication, id: "m2" }],
  },
};
assert.equal(
  careActions(multi, base).filter(
    (x) => x.kind === "medication" && x.dose?.status === "due",
  ).length,
  2,
);
const upcoming = {
  id: "a",
  clinician: "Doctor",
  specialty: "Consultation",
  location: "Clinic",
  startsAt: "2026-10-08T07:00:00Z",
  status: "confirmed" as const,
};
assert.equal(
  careActions({ ...data, appointments: [upcoming] }, base)[0].kind,
  "appointment",
);
assert.ok(
  !careActions(
    { ...EMPTY_CARE, appointments: [{ ...upcoming, status: "cancelled" }] },
    base,
  ).some((x) => x.kind === "appointment"),
);
assert.equal(
  dosesForDay(
    { ...data, plan: { ...data.plan!, publishedAt: "2026-10-08T05:00:00Z" } },
    now,
  ).filter((d) => d.status === "due").length,
  0,
  "Do not invent a missed dose before treatment publication",
);
const orangeAnswers: Answers = Object.fromEntries(
  Object.entries({
    "q5.last_reading.systolic": 190,
    "q5.last_reading.diastolic": 115,
    "q5.crisis_symptoms": ["none"],
  }).map(([fieldId, value]) => [
    fieldId,
    { fieldId, value, source: "manual", answeredAt: now.toISOString() },
  ]),
);
const orange = evaluate({ answers: orangeAnswers, observations: [] });
assert.equal(orange.urgency, "orange");
const attention = needsAttention(orange)
  .filter((f) => f.urgency === "orange")
  .map((f) => ({
    id: f.ruleId,
    detail: {
      en: f.nextStep?.en ?? f.reason.en ?? f.reason.hy,
      hy: f.nextStep?.hy ?? f.reason.hy,
    },
  }));
assert.equal(
  careActions(EMPTY_CARE, { ...base, measuredToday: true, attention })[0].kind,
  "consultation",
);
assert.equal(
  careActions(data, base).filter((a) => a.dose?.status === "upcoming").length,
  1,
  "Keep the next scheduled dose visible before it is due",
);
console.log(
  "Care hub: priorities, waiting, publication, schedules, day boundaries, completion and units pass.",
);
