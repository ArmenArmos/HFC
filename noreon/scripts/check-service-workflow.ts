import assert from "node:assert/strict";
import {
  createWorkflow,
  applyServiceCommand as apply,
  earliestAppointmentDay,
  reviewWindow,
  workflowCare,
} from "@/lib/service-workflow/model";
const now = new Date("2026-10-09T19:30:00Z");
const tests = [
  {
    id: "lipid-panel",
    title: "Fictional lipid panel",
    method: "lab" as const,
    preparation: "Example",
    source: "Example",
  },
];
let s = createWorkflow(tests, now);
assert.equal(s.draft.medicationName, "");
assert.equal(s.draft.medicationDose, "");
assert.deepEqual(s.draft.medicationTimes, []);
assert.equal(earliestAppointmentDay(s, now), null);
assert.throws(() => apply(s, { type: "publish" }, now));
assert.throws(() =>
  apply(
    s,
    {
      type: "book",
      testIds: ["missing"],
      at: "2026-10-10T09:00:00+04:00",
      mode: "clinic",
      address: "",
    },
    now,
  ),
);
assert.throws(() =>
  apply(
    s,
    {
      type: "book",
      testIds: ["lipid-panel"],
      at: "2026-10-10T09:00:00+04:00",
      mode: "home",
      address: "",
    },
    now,
  ),
);
s = apply(
  s,
  {
    type: "book",
    testIds: ["lipid-panel"],
    at: "2026-10-10T09:00:00+04:00",
    mode: "clinic",
    address: "",
  },
  now,
);
assert.equal(earliestAppointmentDay(s, now), "2026-10-13");
s = apply(s, { type: "consultation", decision: "required" }, now);
assert.throws(() =>
  apply(
    s,
    { type: "appointment", at: "2026-10-12T09:00:00+04:00", mode: "video" },
    now,
  ),
);
s = apply(
  s,
  { type: "appointment", at: "2026-10-13T09:00:00+04:00", mode: "video" },
  now,
);
s = apply(
  s,
  {
    type: "book",
    testIds: ["lipid-panel"],
    at: "2026-10-11T09:00:00+04:00",
    mode: "clinic",
    address: "",
    replacingId: s.bookings[0].id,
  },
  now,
);
assert.equal(s.appointment?.status, "needs-reschedule");
assert.equal(earliestAppointmentDay(s, new Date("2026-10-15T00:00:00Z")), null);
s = apply(s, { type: "receive", testIds: ["lipid-panel"] }, now);
assert.deepEqual(reviewWindow(s), { from: "2026-10-12", to: "2026-10-13" });
assert.equal(workflowCare(s, [], false).results.length, 0);
assert.throws(() => apply(s, { type: "publish" }, now));
s = apply(s, { type: "consultation", decision: "not-required" }, now);
s = apply(s, {type:"save-draft",draft:{...s.draft,instructions:"Reviewed instructions."},evidenceRevision:s.evidenceRevision ?? 0}, now);
s = apply(s, { type: "publish", evidenceRevision:s.evidenceRevision ?? 0 }, now);
const published = workflowCare(s, [], false);
assert.equal(published.results.length, 1);
s = apply(
  s,
  { type: "save-draft", evidenceRevision:s.evidenceRevision ?? 0, draft: { ...s.draft, instructions: "Changed draft" } },
  now,
);
assert.deepEqual(workflowCare(s, [], false).plan, published.plan);
assert.throws(() =>
  apply(
    s,
    { type: "doctor-status", doctorId: s.assignedDoctorId, active: false },
    now,
  ),
);
assert.throws(() =>
  apply(
    s,
    {
      type: "save-draft",
      draft: { ...s.draft, instructions: "a".repeat(2001) },
    },
    now,
  ),
);
assert.equal(apply(s, { type: "reset" }, now).publication, null);
console.log("Service workflow checks passed");

const boundary = new Date("2026-10-09T20:05:00Z");
assert.equal(
  earliestAppointmentDay(createWorkflow(tests, boundary), boundary),
  null,
);
const friday = createWorkflow(tests, now);
friday.allResultsAt = "2026-10-09T20:05:00Z";
assert.deepEqual(reviewWindow(friday), {
  from: "2026-10-12",
  to: "2026-10-13",
});
assert.throws(() =>
  apply(
    createWorkflow(tests, now),
    {
      type: "book",
      testIds: ["lipid-panel"],
      at: "2027-01-10T09:00:00+04:00",
      mode: "clinic",
      address: "",
    },
    now,
  ),
);
assert.throws(() =>
  apply(
    createWorkflow(tests, now),
    {
      type: "book",
      testIds: ["lipid-panel"],
      at: "2026-10-10T10:00:00+04:00",
      mode: "clinic",
      address: "",
    },
    now,
  ),
);
assert.throws(() =>
  apply(
    createWorkflow(tests, now),
    { type: "receive", testIds: ["lipid-panel"] },
    now,
  ),
);
const nonlab = createWorkflow(
  [...tests, { ...tests[0], id: "ecg", method: "clinic" }],
  now,
);
assert.throws(() =>
  apply(
    nonlab,
    {
      type: "book",
      testIds: ["ecg"],
      at: "2026-10-10T09:00:00+04:00",
      mode: "home",
      address: "Example address",
    },
    now,
  ),
);
assert.throws(() =>
  apply(
    nonlab,
    {
      type: "book",
      testIds: ["ecg", "lipid-panel"],
      at: "2026-10-10T09:00:00+04:00",
      mode: "clinic",
      address: "",
    },
    now,
  ),
);
let delayed = apply(
  createWorkflow(tests, now),
  {
    type: "book",
    testIds: ["lipid-panel"],
    at: "2026-10-10T09:00:00+04:00",
    mode: "clinic",
    address: "",
  },
  now,
);
delayed = apply(delayed, { type: "consultation", decision: "required" }, now);
delayed = apply(
  delayed,
  { type: "appointment", at: "2026-10-15T09:00:00+04:00", mode: "video" },
  now,
);
delayed = apply(
  delayed,
  { type: "receive", testIds: ["lipid-panel"] },
  new Date("2026-10-14T09:00:00Z"),
);
assert.equal(delayed.appointment?.status, "needs-reschedule");
assert.throws(() => apply(delayed, { type: "complete-consultation" }, now));
for (let i = 0; i < 25; i++)
  s = apply(s, { type: "save-draft", evidenceRevision:s.evidenceRevision ?? 0, draft: s.draft }, now);
assert.equal(s.events.length, 20);
assert.equal(
  s.publication?.draft.instructions,
  published.plan?.instructions.split("\n\n")[0],
);
console.log("Extended scheduling and bounds checks passed");

let noTests = createWorkflow([], now);
assert.equal(earliestAppointmentDay(noTests, now), "2026-10-09");
noTests = apply(noTests, { type: "consultation", decision: "required" }, now);
noTests = apply(
  noTests,
  { type: "appointment", at: "2026-10-10T09:00:00+04:00", mode: "video" },
  now,
);
noTests = apply(noTests, { type: "complete-consultation" }, new Date(noTests.appointment!.at));
noTests = apply(noTests, {type:"save-draft",draft:{...noTests.draft,instructions:"Reviewed instructions."},evidenceRevision:noTests.evidenceRevision ?? 0}, new Date(noTests.appointment!.at));
noTests = apply(noTests, { type: "publish",evidenceRevision:noTests.evidenceRevision ?? 0 }, new Date(noTests.appointment!.at));
assert.equal(workflowCare(noTests, [], false).results.length, 0);
assert.ok(workflowCare(noTests, [], false).plan);
console.log("Zero-test consultation and publication checks passed");

const homeLog = createWorkflow(
  [
    {
      ...tests[0],
      id: "bp-home-log",
      title: "Home BP record",
      method: "home-log",
    },
  ],
  now,
);
const plannedLog = apply(
  homeLog,
  {
    type: "book",
    testIds: ["bp-home-log"],
    at: "2026-10-15T09:00:00+04:00",
    mode: "home",
    address: "",
  },
  now,
);
assert.equal(plannedLog.bookings[0].mode, "home");
assert.throws(() =>
  apply(
    homeLog,
    {
      type: "book",
      testIds: ["bp-home-log"],
      at: "2026-10-15T09:00:00+04:00",
      mode: "clinic",
      address: "",
    },
    now,
  ),
);
console.log("Home monitoring plans remain home tasks, not clinic visits.");
