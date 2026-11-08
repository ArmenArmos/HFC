import assert from "node:assert/strict";
import { test } from "node:test";
import * as engine from "@/lib/clinical/rules/engine";
import { THRESHOLD } from "@/lib/clinical/rules/rules";
import { fieldById } from "@/lib/clinical/seed/questions";
import { type Answers, type FieldValue } from "@/lib/clinical/types";
import { fieldComplete, mergeAnswers } from "@/lib/patient/questionnaire";

// Khikar, 18 Oct 2026: weekly activity runs 0 to 500+, where 500 means "500 or more".
const ID = "q2.activity_minutes";
const answers = (values: Record<string, FieldValue>): Answers => Object.fromEntries(
  Object.entries(values).map(([fieldId, value]) => [fieldId, { fieldId, value, source: "manual" as const, answeredAt: "2026-10-18T00:00:00Z" }]),
);
const active = { "q2.activity": "active" };

test("the field is an open 0 to 500+ range above the activity threshold", () => {
  const field = fieldById(ID)!;
  assert.equal(field.min, 0);
  assert.equal(field.max, 500);
  assert.equal(field.openMax, true);
  assert.ok(field.max! > THRESHOLD.activityMinutes);
});

test("a saved answer above 500 still loads as complete", () => {
  assert.equal(fieldComplete(fieldById(ID)!, answers({ ...active, [ID]: 800 })), true);
});

test("a new answer above 500 is stored as 500, not rejected", () => {
  const merged = mergeAnswers(answers(active), [{ fieldId: ID, value: 900 }]);
  assert.equal(merged[ID]?.value, 500);
  assert.equal(mergeAnswers(answers(active), [{ fieldId: ID, value: 320 }])[ID]?.value, 320);
  assert.throws(() => mergeAnswers(answers(active), [{ fieldId: ID, value: -1 }]));
});

test("500+ and legacy values never trigger the low-activity finding", () => {
  for (const minutes of [150, 500, 800, 1200]) {
    for (const intensity of ["moderate", "vigorous"]) {
      const decision = engine.evaluate({ answers: answers({ ...active, [ID]: minutes, "q2.activity_intensity": intensity }), observations: [] });
      assert.equal(decision.findings.some((f) => f.ruleId === "NRN-RULE-ACT-001"), false, `${minutes} ${intensity}`);
    }
  }
  const low = engine.evaluate({ answers: answers({ ...active, [ID]: 149, "q2.activity_intensity": "moderate" }), observations: [] });
  assert.equal(low.findings.some((f) => f.ruleId === "NRN-RULE-ACT-001"), true);
});
