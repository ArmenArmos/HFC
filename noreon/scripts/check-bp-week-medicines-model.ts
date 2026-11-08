// D1/D2 pure logic: slot states (missing is never normal), the plain average marked pending, and
// adherence counts that never rate. No database, no network.
import assert from "node:assert/strict";
import { weekSlots, weekSummary, weekPhase, nextSlot, type BpWeek } from "@/lib/bp-week/model";
import { adherence, todaysDoses, type SelfMedicine, type PlanMedicine } from "@/lib/member-medicines/model";

const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+04:00`);
const r = (day: number, slot: "morning" | "evening", s: number, d: number, n: number) =>
  ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, day, slot, systolic: s, diastolic: d, pulse: null, measuredAt: at("2026-11-02", "08:00").toISOString() });
const week: BpWeek = {
  id: "00000000-0000-4000-8000-000000000001", startsOn: "2026-11-02", days: 7, readingsPerSlot: 2, morningTime: "08:00", eveningTime: "20:00",
  reminders: true, startedByRole: "nurse", createdAt: "2026-11-01T10:00:00Z", stoppedAt: null, stopReason: null, device: null,
  readings: [r(1, "morning", 130, 80, 1), r(1, "morning", 128, 82, 2), r(1, "evening", 140, 90, 3), r(2, "morning", 120, 76, 4)],
};

// Day 2, 09:00: day 1 evening has one reading and the day is over, so it is missed (not complete, not normal).
let now = at("2026-11-03", "09:00");
let slots = weekSlots(week, now);
const s = (day: number, slot: "morning" | "evening") => slots.find(x => x.day === day && x.slot === slot)!.state;
assert.equal(weekPhase(week, now), "running");
assert.equal(s(1, "morning"), "done");
assert.equal(s(1, "evening"), "missed");
assert.equal(s(2, "morning"), "partial");
assert.equal(s(2, "evening"), "upcoming");
assert.equal(nextSlot(week, now)?.slot, "morning");
now = at("2026-11-03", "20:01");
slots = weekSlots(week, now);
assert.equal(s(2, "evening"), "due");
const sum = weekSummary(week, now);
assert.deepEqual([sum.expected, sum.saved, sum.completeSlots, sum.missedSlots], [28, 4, 1, 1]);
// Plain mean of the four saved readings only; missing slots are not filled in.
assert.deepEqual(sum.plainAverage, { systolic: 129.5, diastolic: 82, count: 4 });
assert.equal(weekSummary({ ...week, readings: [] }, now).plainAverage, null);
// Before the start and after the end.
assert.equal(weekPhase(week, at("2026-11-01", "12:00")), "not-started");
assert.equal(weekPhase(week, at("2026-11-09", "00:01")), "finished");
assert.equal(weekPhase({ ...week, stoppedAt: at("2026-11-03", "10:00").toISOString() }, now), "stopped");
// A stopped week: slots after the stop are missed, never due.
const stopped = weekSlots({ ...week, stoppedAt: at("2026-11-03", "10:00").toISOString() }, at("2026-11-03", "21:00"));
assert.equal(stopped.find(x => x.day === 2 && x.slot === "evening")!.state, "missed");
assert.equal(nextSlot({ ...week, stoppedAt: at("2026-11-03", "10:00").toISOString() }, now), null);

// Medicines: counts only; a dose not yet due is not expected; nothing before the start or after a stop.
const own: SelfMedicine = {
  id: "00000000-0000-4000-8000-0000000000a1", source: "self-reported", name: "Fictional", dose: null, times: ["08:00", "20:00"],
  startedOn: "2026-11-02", createdAt: "2026-11-02T03:00:00Z", stoppedAt: null,
  doses: [{ dueAt: at("2026-11-02", "08:00").toISOString(), status: "taken", recordedAt: "", revision: 1 },
    { dueAt: at("2026-11-02", "20:00").toISOString(), status: "skipped", recordedAt: "", revision: 1 },
    { dueAt: at("2026-11-03", "08:00").toISOString(), status: "taken", recordedAt: "", revision: 2 }],
};
assert.deepEqual(adherence(own, 14, at("2026-11-03", "12:00")), { expected: 3, taken: 2, skipped: 1, noReport: 0, days: 14 });
assert.deepEqual(adherence(own, 14, at("2026-11-04", "21:00")), { expected: 6, taken: 2, skipped: 1, noReport: 3, days: 14 });
assert.deepEqual(adherence({ ...own, stoppedAt: at("2026-11-03", "12:00").toISOString() }, 14, at("2026-11-05", "21:00")).expected, 3);
assert.equal(adherence(own, 1, at("2026-11-04", "21:00")).expected, 2, "the window is the last N Yerevan days");
const plan: PlanMedicine = { id: "00000000-0000-4000-8000-0000000000b1", source: "plan", name: "Fictional plan", dose: "5 mg", times: ["09:00"], startedOn: "2026-11-01", endDate: "2026-11-02", effectiveAt: null, doses: [] };
assert.equal(adherence(plan, 14, at("2026-11-05", "12:00")).expected, 2, "nothing after the plan medicine's end date");
// A plan medicine published at 12:00 on its first day: the 09:00 dose that day is not expected.
assert.equal(adherence({ ...plan, effectiveAt: at("2026-11-01", "12:00").toISOString() }, 14, at("2026-11-05", "12:00")).expected, 1);
// Today's ticks open an hour before the time, as the database allows.
const today = todaysDoses(own, at("2026-11-03", "19:05"));
assert.deepEqual(today.map(d => [d.time, d.status, d.revision]), [["08:00", "taken", 2], ["20:00", "due", 0]]);
assert.equal(todaysDoses(own, at("2026-11-03", "18:59"))[1].status, "upcoming");
// QA 99: a row that replaced an earlier schedule counts only from its change (effectiveAt), today and in adherence.
const changed = { ...own, effectiveAt: at("2026-11-03", "12:00").toISOString() };
assert.deepEqual(todaysDoses(changed, at("2026-11-03", "19:05")).map(d => d.time), ["20:00"], "no slot before the change today");
assert.equal(adherence(changed, 14, at("2026-11-04", "21:00")).expected, 3, "adherence starts at the change (20:00 on the 3rd, both on the 4th)");
// QA 118: a time change today. The stopped row records the row that replaced it, and a kept time's earlier slot today
// stays on the stopped row with its tick; a removed time is not shown; a new time starts at the change.
const stop = (t: string) => at("2026-11-03", t).toISOString();
const oldRow: SelfMedicine = { ...own, stoppedAt: stop("21:00"), replacedBy: "00000000-0000-4000-8000-0000000000a2" };
const keptOnly: SelfMedicine = { ...own, id: "00000000-0000-4000-8000-0000000000a2", times: ["08:00"], startedOn: "2026-11-03", effectiveAt: stop("21:00"), doses: [] };
// The repro: 08:00 and 20:00, at 21:00 the member removes 20:00. 08:00 keeps its row, its tick and the Home count.
const repro = todaysDoses(keptOnly, at("2026-11-03", "21:05"), [keptOnly, oldRow]);
assert.deepEqual(repro.map(d => [d.medicineId, d.time, d.status, d.revision]), [[oldRow.id, "08:00", "taken", 2]], "kept 08:00 still shows today, on the stopped row");
const unticked = { ...oldRow, doses: [] };
assert.deepEqual(todaysDoses(keptOnly, at("2026-11-03", "21:05"), [keptOnly, unticked]).map(d => [d.medicineId, d.status]), [[oldRow.id, "due"]], "an unticked kept dose can still be ticked");
assert.deepEqual(todaysDoses(keptOnly, at("2026-11-03", "21:05")).map(d => d.time), [], "without the list (old callers) nothing is invented");
assert.equal(todaysDoses(keptOnly, at("2026-11-04", "09:00"), [keptOnly, oldRow])[0].medicineId, keptOnly.id, "from tomorrow the new row holds it");
// An edit at 10:00 that removes 08:00 and keeps 20:00: today shows 20:00 only, on the new row.
const at10: SelfMedicine = { ...oldRow, stoppedAt: stop("10:00") };
const evening: SelfMedicine = { ...keptOnly, times: ["20:00"], effectiveAt: stop("10:00") };
assert.deepEqual(todaysDoses(evening, at("2026-11-03", "10:05"), [evening, at10]).map(d => [d.medicineId, d.time, d.status]), [[evening.id, "20:00", "upcoming"]], "removed 08:00 is gone, 20:00 stays");
// Adding a later time today (14:00 at 10:00) shows it today; an added time already past (09:00) starts tomorrow.
const added: SelfMedicine = { ...keptOnly, times: ["08:00", "09:00", "14:00", "20:00"], effectiveAt: stop("10:00") };
assert.deepEqual(todaysDoses(added, at("2026-11-03", "10:05"), [added, at10]).map(d => [d.medicineId === at10.id ? "old" : "new", d.time]),
  [["old", "08:00"], ["new", "14:00"], ["new", "20:00"]], "kept 08:00 from the old row, new 14:00 today, past 09:00 not today");
// Two changes in one day: 08:00 kept through both is followed back to the first row; dropped in between, it is not.
const mid: SelfMedicine = { ...keptOnly, id: "00000000-0000-4000-8000-0000000000a3", times: ["08:00", "21:00"], effectiveAt: stop("10:00"), stoppedAt: stop("12:00"), replacedBy: keptOnly.id };
const first: SelfMedicine = { ...own, stoppedAt: stop("10:00"), replacedBy: mid.id };
const last: SelfMedicine = { ...keptOnly, effectiveAt: stop("12:00") };
assert.equal(todaysDoses(last, at("2026-11-03", "12:05"), [last, mid, first])[0].medicineId, first.id, "followed back through two changes");
assert.deepEqual(todaysDoses(last, at("2026-11-03", "12:05"), [last, { ...mid, times: ["21:00"] }, first]), [], "a time dropped in between is not brought back");
console.log("BP week and medicines model: all checks passed (fictional data).");
