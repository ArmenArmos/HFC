import assert from "node:assert/strict";
import { nextDatedThing, nextDateWhen } from "@/lib/patient-care/next-date";
import { journeyStages } from "@/lib/programme/stages";
import type { Appointment } from "@/lib/real-booking/appointment-schema";
import type { BpWeekRead } from "@/lib/bp-week/model";

/** SYNTHETIC checks for Home's next dated thing. No database, no network. */
const now = new Date("2026-10-19T09:00:00+04:00");
const visit = (o: { startsAt: string; status?: Appointment["status"]; outcome?: string | null; proposal?: string }) => ({
  id: "00000000-0000-4000-8000-000000000001", status: o.status ?? "confirmed", createdAt: "2026-10-18T10:00:00+04:00",
  current: { mode: "clinic", startsAt: o.startsAt, endsAt: new Date(Date.parse(o.startsAt) + 3600000).toISOString(), clinicId: "c", location: "x", preparation: "" },
  portal: { channel: "portal", checkin: o.outcome ? { outcome: o.outcome } : null,
    proposal: o.proposal ? { id: "p", startsAt: o.proposal, endsAt: o.proposal, note: null, clinicId: "c", clinicName: "Clinic", clinicAddress: "a", createdAt: o.proposal } : null },
}) as unknown as Appointment;
const week = (startsOn: string, readings: { day: number; slot: "morning" | "evening" }[] = []): BpWeekRead => ({
  version: "bp-week-v1", enabled: true, today: "2026-10-19", currentDevice: null,
  weeks: [{ id: "00000000-0000-4000-8000-0000000000aa", startsOn, days: 7, readingsPerSlot: 2, morningTime: "08:00", eveningTime: "20:00", reminders: true, startedByRole: "nurse",
    createdAt: "2026-10-18T10:00:00+04:00", stoppedAt: null, stopReason: null, device: null,
    readings: readings.flatMap((r, i) => [0, 1].map((k) => ({ id: `00000000-0000-4000-8000-0000000001${String(i * 2 + k).padStart(2, "0")}`, ...r, systolic: 130, diastolic: 80, pulse: null, measuredAt: now.toISOString() }))) }],
});
const stages = journeyStages({ questionnaireComplete: true, lab: "results-received", testsArranged: true, planPublishedAt: "2026-10-10T10:00:00+04:00",
  programme: { version: "programme-v1", enabled: true, today: "2026-10-19", schedulePending: false, opensDaysBefore: 3, startedAt: "2026-10-10T10:00:00+04:00",
    checkpoints: [{ id: null, kind: "week4_review", dueOn: "2026-11-07", state: "scheduled", openedAt: null, completedAt: null, outcome: null, doctorNote: null, checkin: null },
      { id: null, kind: "month3", dueOn: "2027-01-10", state: "scheduled", openedAt: null, completedAt: null, outcome: null, doctorNote: null, checkin: null }] } });

// Nothing dated: no card.
assert.equal(nextDatedThing({ now }), null);
assert.equal(nextDatedThing({ now, appointments: [], bpWeek: { version: "bp-week-v1", enabled: false }, stages: null }), null);

// A confirmed future visit; a past or attended one is not a next date; a proposal wins over the old time.
assert.equal(nextDatedThing({ now, appointments: [visit({ startsAt: "2026-10-21T10:30:00+04:00" })] })?.kind, "visit");
assert.equal(nextDatedThing({ now, appointments: [visit({ startsAt: "2026-10-18T10:30:00+04:00" })] }), null, "past visit");
assert.equal(nextDatedThing({ now, appointments: [visit({ startsAt: "2026-10-21T10:30:00+04:00", outcome: "arrived" })] }), null, "attended");
assert.equal(nextDatedThing({ now, appointments: [visit({ startsAt: "2026-10-21T10:30:00+04:00", status: "notification-pending" })] }), null, "not confirmed yet");
assert.equal(nextDatedThing({ now, appointments: [visit({ startsAt: "2026-10-21T10:30:00+04:00", proposal: "2026-10-22T11:00:00+04:00" })] })?.kind, "proposal");

// Skipped when the next step above already shows it; then the next one leads.
const both = { now, appointments: [visit({ startsAt: "2026-10-21T10:30:00+04:00" })], stages };
assert.equal(nextDatedThing(both)?.kind, "visit");
assert.equal(nextDatedThing({ ...both, skip: ["visit", "proposal"] })?.kind, "checkpoint");
assert.equal(nextDatedThing({ ...both, skip: ["visit", "proposal"] })?.title.en, "Week-4 review", "the nearest checkpoint, not month 3");

// BP week: the next open slot today, the evening once the morning is done, its start when not started.
const due = nextDatedThing({ now, bpWeek: week("2026-10-18") });
assert.equal(due?.kind, "bp-week");
assert.equal(due?.at, "2026-10-19T04:00:00.000Z", "a due slot keeps its saved 08:00, not the render time (Astra F1)");
assert.equal(nextDateWhen(due!, "en", now), "Now (from 08:00)");
const late = new Date("2026-10-19T23:59:00+04:00");
assert.equal(nextDatedThing({ now: late, bpWeek: week("2026-10-18") })?.at, "2026-10-19T04:00:00.000Z", "same at 23:59");
assert.equal(nextDateWhen(nextDatedThing({ now: late, bpWeek: week("2026-10-18") })!, "hy", late), "Հիմա (08:00-ից)");
const evening = nextDatedThing({ now, bpWeek: week("2026-10-18", [{ day: 1, slot: "morning" }, { day: 1, slot: "evening" }, { day: 2, slot: "morning" }]) });
assert.equal(evening?.title.en, "Evening blood pressure readings");
assert.equal(nextDateWhen(evening!, "en", now), "Today, 20:00");
const later = nextDatedThing({ now, bpWeek: week("2026-10-20") });
assert.equal(nextDateWhen(later!, "en", now), "Tomorrow, 08:00");
assert.equal(nextDatedThing({ now, bpWeek: week("2026-10-01") }), null, "a finished week has no next date");

// Consultation, earliest first; checkpoints are all-day dates.
assert.equal(nextDatedThing({ now, consultationAt: "2026-10-20T12:00:00+04:00", stages })?.kind, "consultation");
assert.equal(nextDatedThing({ now, consultationAt: "2026-10-18T12:00:00+04:00", stages })?.kind, "checkpoint", "a past consultation is not next");
const cp = nextDatedThing({ now, stages })!;
assert.equal(cp.allDay, true);
assert.match(nextDateWhen(cp, "en", now), /7 November/);
assert.doesNotMatch(nextDateWhen(cp, "en", now), /:/, "no time for a day-only date");
assert.match(nextDateWhen(cp, "hy", now), /նոյեմբեր/i);

// An open checkpoint past its date stays the next thing (Astra F2), before later ones; completing it moves on.
const overdueStages = journeyStages({ questionnaireComplete: true, lab: "results-received", testsArranged: true, planPublishedAt: "2026-09-10T10:00:00+04:00",
  programme: { version: "programme-v1", enabled: true, today: "2026-10-19", schedulePending: false, opensDaysBefore: 3, startedAt: "2026-09-10T10:00:00+04:00",
    checkpoints: [{ id: "00000000-0000-4000-8000-0000000000c1", kind: "week4_review", dueOn: "2026-10-18", state: "open", openedAt: "2026-10-15T10:00:00+04:00", completedAt: null, outcome: null, doctorNote: null, checkin: null },
      { id: null, kind: "month3", dueOn: "2026-12-01", state: "scheduled", openedAt: null, completedAt: null, outcome: null, doctorNote: null, checkin: null }] } });
const od = nextDatedThing({ now, stages: overdueStages })!;
assert.equal(od.title.en, "Week-4 review");
assert.equal(od.overdue, true);
assert.equal(nextDateWhen(od, "en", now), "Due 18 October");
assert.match(nextDateWhen(od, "hy", now), /^Ժամկետը՝ 18 հոկտեմբեր/);
assert.equal(nextDatedThing({ now, stages: overdueStages, appointments: [visit({ startsAt: "2026-10-21T10:30:00+04:00" })] })?.kind, "checkpoint", "overdue sorts first");
const doneStages = journeyStages({ questionnaireComplete: true, lab: "results-received", testsArranged: true, planPublishedAt: "2026-09-10T10:00:00+04:00",
  programme: { version: "programme-v1", enabled: true, today: "2026-10-19", schedulePending: false, opensDaysBefore: 3, startedAt: "2026-09-10T10:00:00+04:00",
    checkpoints: [{ id: "00000000-0000-4000-8000-0000000000c1", kind: "week4_review", dueOn: "2026-10-18", state: "completed", openedAt: "2026-10-15T10:00:00+04:00", completedAt: "2026-10-18T12:00:00+04:00", outcome: "confirmed", doctorNote: null, checkin: null },
      { id: null, kind: "month3", dueOn: "2026-12-01", state: "scheduled", openedAt: null, completedAt: null, outcome: null, doctorNote: null, checkin: null }] } });
assert.equal(nextDatedThing({ now, stages: doneStages })?.title.en, "Month-3 check-in", "completing it moves to the next checkpoint");

console.log("home next-date checks passed");
