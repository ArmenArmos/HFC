import assert from "node:assert/strict";
import fs from "node:fs";
import type { Answers } from "@/lib/clinical/types";
import {
  newDemoState,
  sealDemoState,
  openDemoState,
  demoStoreFor,
} from "@/lib/patient/demo-model";
import { createPatientService } from "@/lib/patient/service";
import { MeasurementConflict } from "@/lib/patient/measurement-store";
const key = "a".repeat(64),
  wrongKey = "b".repeat(64);
const a = newDemoState(),
  b = newDemoState();
assert.notEqual(a.userId, b.userId);
const token = sealDemoState(a, key);
assert.deepEqual(openDemoState(token, key), a);
assert.equal(openDemoState(token, wrongKey), null);
assert.equal(openDemoState(token.slice(0, -8) + "aaaaaaaa", key), null);
assert.equal(openDemoState(token, key, a.expiresAt + 1), null);
assert.throws(() => sealDemoState(a, ""));
let saved = a;
const store = demoStoreFor(a, async (state) => {
  saved = state;
});
const service = createPatientService({
  user: async () => ({ userId: a.userId, phone: "+37499000000" }),
  store: () => store,
});
const p = {
  name: "Demo member",
  birthDate: "1974-05-18",
  biologicalSex: "male" as const,
  locale: "en" as const,
};
assert.equal((await service.saveProfile(p, true)).ok, true);
assert.equal(saved.state.assessment?.revision, 0);
assert.equal(
  (
    await service.saveAnswers({
      expectedRevision: 0,
      entries: [{ fieldId: "q3.status", value: "never" }],
    })
  ).ok,
  true,
);
assert.equal(saved.state.assessment?.answers["q3.status"]?.value, "never");
assert.equal(
  (await service.saveAnswers({ expectedRevision: 0, entries: [] })).ok,
  false,
);
assert.rejects(store.read(b.userId));
const input = {
  submissionId: crypto.randomUUID(),
  systolic: 134,
  diastolic: 82,
  pulse: 72,
  measuredAt: new Date().toISOString(),
};
assert.equal((await service.recordMeasurement(input)).ok, true);
assert.equal((await service.recordMeasurement(input)).ok, true);
assert.equal(saved.measurements.length, 1);
await assert.rejects(
  store.measurement(a.userId, { ...input, systolic: 140 }),
  MeasurementConflict,
);
const other = demoStoreFor(b, async () => {});
assert.equal((await other.read(b.userId)).profile, null);
assert.equal(b.measurements.length, 0);
assert.deepEqual(openDemoState(sealDemoState(saved, key), key), saved);
console.log(
  "Demo sessions: encryption, expiry, owner isolation, resume, revision conflicts and measurement retries pass.",
);

const all = JSON.parse(
  fs.readFileSync("scripts/fixtures/patient-answers.json", "utf8"),
) as Answers;
await store.assessment(
  a.userId,
  saved.state.assessment!.revision,
  all,
  true,
  null,
);
assert.ok(saved.state.assessment?.completedAt);
for (let i = 0; i < 24; i++)
  await store.measurement(a.userId, {
    ...input,
    submissionId: crypto.randomUUID(),
    systolic: 120 + i,
  });
assert.equal(saved.measurements.length, 20);
const fullToken = sealDemoState(saved, key);
assert.ok(fullToken.length < 24000);
assert.deepEqual(openDemoState(fullToken, key), saved);
console.log(
  "Full questionnaire and bounded 20-measurement history fit encrypted browser storage.",
);
