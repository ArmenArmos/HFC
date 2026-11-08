import assert from "node:assert/strict";
import { homeDashboard } from "../lib/patient-care/home-dashboard";
import { EMPTY_CARE, type CareData } from "../lib/patient-care/types";
import { DEFAULT_REMINDERS } from "../lib/patient-care/reminder-preferences";
const now = new Date("2026-10-15T05:00:00Z");
const care: CareData = {
  ...EMPTY_CARE,
  plan: {
    id: "published",
    clinician: "Actual GP",
    publishedAt: "2026-10-01T00:00:00Z",
    instructions: "Actual plan",
    acknowledgedAt: null,
    medications: [
      {
        id: "actual",
        planId: "published",
        name: "Actual prescription",
        dose: "actual dose",
        instructions: "Actual instruction",
        times: ["08:00", "20:00"],
        startDate: "2026-10-01",
        endDate: null,
        active: true,
      },
    ],
  },
};
let model = homeDashboard(care, [], DEFAULT_REMINDERS, now);
assert.equal(model.medicine?.medication.name, "Actual prescription");
assert.equal(model.medicine?.status, "due");
assert.equal(
  model.bp,
  null,
  "disabled preferences never become clinical measurement schedules",
);
assert.equal(model.latest, null);
assert.equal(model.completed, 0);
assert.equal(
  model.total,
  2,
  "medicine tasks remain visible with reminders disabled",
);
model = homeDashboard(
  {
    ...care,
    events: [
      {
        medicationId: "actual",
        dueAt: "2026-10-15T04:00:00Z",
        status: "taken",
        recordedAt: now.toISOString(),
      },
    ],
  },
  [],
  { ...DEFAULT_REMINDERS, bpEnabled: true },
  now,
);
assert.equal(
  model.medicine?.dueAt,
  "2026-10-15T16:00:00.000Z",
  "next prescription advances after actual report",
);
assert.equal(
  model.medicine?.status,
  "upcoming",
  "future check-in never becomes reportable early",
);
assert.equal(model.bp?.dueAt, "2026-10-15T04:00:00.000Z");
assert.equal(model.completed, 1);
assert.equal(model.total, 4);
const readings = [
  {
    id: "actual",
    submissionId: "s",
    source: "manual" as const,
    systolic: 120,
    diastolic: 80,
    pulse: 72,
    measuredAt: "2026-10-15T04:00:00Z",
  },
  {
    id: "future",
    submissionId: "f",
    source: "manual" as const,
    systolic: 999,
    diastolic: 999,
    measuredAt: "2026-10-16T04:00:00Z",
  },
];
model = homeDashboard(
  care,
  readings,
  { ...DEFAULT_REMINDERS, bpEnabled: true },
  now,
);
assert.equal(
  model.latest?.id,
  "actual",
  "future records excluded from tiles and chart",
);
assert.equal(model.measurements.length, 1);
assert.equal(model.completed, 1);
assert.equal(model.bp?.dueAt, "2026-10-15T16:00:00.000Z");
assert.equal(
  homeDashboard(EMPTY_CARE, [], DEFAULT_REMINDERS, now).medicine,
  null,
  "no sample prescriptions",
);
assert.equal(
  homeDashboard(
    {
      ...care,
      plan: {
        ...care.plan!,
        medications: care.plan!.medications.map((m) => ({
          ...m,
          active: false,
        })),
      },
    },
    [],
    DEFAULT_REMINDERS,
    now,
  ).medicine,
  null,
);
assert.equal(
  homeDashboard(
    {
      ...care,
      events: care.plan!.medications[0].times.map((t) => ({
        medicationId: "actual",
        dueAt: `2026-10-15T${t}:00+04:00`,
        status: "taken" as const,
        recordedAt: now.toISOString(),
      })),
    },
    [],
    DEFAULT_REMINDERS,
    now,
  ).medicine?.dueAt,
  "2026-10-16T04:00:00.000Z",
);
console.log(
  "Home dashboard checks passed: genuine prescriptions, check-off advancement, BP preference provenance, future-data exclusion, empty and disabled states.",
);
