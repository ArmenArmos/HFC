import assert from "node:assert/strict";
import {
  medicineReportDays,
  labRange,
} from "@/lib/patient-care/journey-evidence";
const now = new Date("2026-10-12T10:00:00Z");
const base = {
  medicationId: "m1",
  dueAt: "2026-10-11T22:00:00Z",
  recordedAt: "2026-10-12T01:00:00Z",
  status: "taken" as const,
  revision: 1,
};
const days = medicineReportDays(
  [
    base,
    { ...base, status: "skipped", revision: 2 },
    { ...base, medicationId: "m2" },
    { ...base, medicationId: "future", dueAt: "2026-10-13T10:00:00Z" },
  ],
  now,
);
assert.equal(days.length, 28);
assert.equal(days.at(-1)?.day, "2026-10-12");
assert.equal(days.at(-1)?.taken, 1);
assert.equal(days.at(-1)?.skipped, 1);
assert.equal(days.at(-2)?.taken, 0);
assert.equal(
  medicineReportDays([], now).every((d) => d.taken === 0 && d.skipped === 0),
  true,
);
assert.equal(
  labRange({ value: 5, referenceLow: 2, referenceHigh: 4 }).status,
  "above",
);
assert.equal(
  labRange({ value: 4, referenceLow: 2, referenceHigh: 4 }).status,
  "within",
);
assert.equal(
  labRange({ value: 1, referenceLow: 2, referenceHigh: null }).status,
  "below",
);
assert.equal(
  labRange({ value: 3, referenceLow: null, referenceHigh: null }).status,
  "unknown",
);
assert.equal(
  labRange({ value: 3, referenceLow: 5, referenceHigh: 2 }).status,
  "unknown",
);
console.log(
  "Journey evidence: dose correction, Armenian dates, missing/future records and printed lab bounds pass.",
);
