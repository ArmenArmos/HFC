import assert from "node:assert/strict";
import { measurementOverview } from "@/lib/patient-care/overview";
import type { Measurement } from "@/lib/patient/types";
const now = new Date("2026-10-09T06:00:00Z");
const m = (at: string, s: number, d: number): Measurement => ({
  id: at,
  submissionId: at,
  measuredAt: at,
  systolic: s,
  diastolic: d,
  source: "manual",
});
const rows = [
  m("2026-10-02T19:59:00Z", 200, 100),
  m("2026-10-02T20:00:00Z", 120, 80),
  m("2026-10-08T20:01:00Z", 140, 90),
  m("2026-10-09T07:00:00Z", 250, 120),
];
const summary = measurementOverview(rows, now);
assert.deepEqual(summary.average, { systolic: 130, diastolic: 85 });
assert.equal(summary.count, 2);
assert.equal(summary.days.filter((d) => d.count).length, 2);
assert.equal(summary.todayCount, 1);
assert.equal(summary.days[0].day, "2026-10-03");
assert.equal(summary.days.at(-1)?.day, "2026-10-09");
assert.equal(measurementOverview([], now).average, null);
assert.equal(rows[0].systolic, 200);
console.log(
  "Health overview: Armenia day boundaries, future exclusion, empty state and averages pass.",
);
