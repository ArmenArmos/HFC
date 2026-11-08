import assert from "node:assert/strict";
import { newDemoState, restartedDemoQuestions } from "@/lib/patient/demo-model";
import { firesEmergency } from "@/lib/clinical/rules/rules";
const state = newDemoState();
const at = new Date().toISOString();
state.state.profile = {
  userId: state.userId,
  name: "Fictional restart check",
  birthDate: "1974-05-18",
  biologicalSex: "male",
  locale: "en",
};
state.state.consentAccepted = true;
state.state.assessment = {
  id: "demo",
  revision: 7,
  assessmentDate: "2026-10-07",
  completedAt: at,
  urgentRule: "RF-04",
  answers: Object.fromEntries(
    Object.entries({
      "q1.age": 52,
      "q1.sex": "male",
      "q5.diagnosed": "treated",
      "q5.last_reading.systolic": 190,
      "q5.last_reading.diastolic": 115,
      "q5.crisis_symptoms": ["neuro"],
    }).map(([fieldId, value]) => [
      fieldId,
      { fieldId, value, source: "manual" as const, answeredAt: at },
    ]),
  ),
};
assert.ok(
  firesEmergency({ answers: state.state.assessment.answers, observations: [] }),
);
const original = structuredClone(state);
const reset = restartedDemoQuestions(state, 7)!;
assert.ok(reset);
assert.deepEqual(
  state,
  original,
  "Restart must not mutate the previous snapshot",
);
assert.equal(reset.state.assessment!.revision, 8);
assert.equal(reset.state.assessment!.urgentRule, null);
assert.equal(reset.state.assessment!.completedAt, null);
assert.deepEqual(Object.keys(reset.state.assessment!.answers).sort(), [
  "q1.age",
  "q1.sex",
]);
assert.ok(
  !firesEmergency({
    answers: reset.state.assessment!.answers,
    observations: [],
  }),
);
assert.deepEqual(reset.state.profile, state.state.profile);
assert.deepEqual(reset.measurements, state.measurements);
assert.equal(reset.userId, state.userId);
assert.equal(reset.expiresAt, state.expiresAt);
assert.equal(
  restartedDemoQuestions(reset, 7),
  null,
  "Old tabs must not reset a newer draft",
);
assert.equal(restartedDemoQuestions({ ...state, expiresAt: 0 }, 7), null);
assert.equal(restartedDemoQuestions(newDemoState(), 0), null);
console.log(
  "Demo restart clears urgent answers, preserves account and rejects stale/expired state.",
);
