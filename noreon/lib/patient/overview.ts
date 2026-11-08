import {isUnverifiedBp,bpObservationCounts} from "@/lib/patient/bp-provenance";
import {memberInstruction} from '@/lib/text-language';
import { currentWeek, nextSlot, addDays, weekPhase, yerevanDate, type BpWeekRead, type Slot } from "@/lib/bp-week/model";
import { ZONE_RULES_V1 } from "@/lib/clinical/zones/config-v1";
import { evaluateBp } from "@/lib/clinical/zones/evaluate";
import type { Urgency } from "@/lib/clinical/types";
import type { MemberLdl } from "@/lib/ldl/schema";
import { assessLdl, formatMmol, formatPercent } from "@/lib/ldl/status";
import { adherence, todaysDoses, type MemberMedicinesRead } from "@/lib/member-medicines/model";
import { appointmentIsCurrent, dosesForDay } from "@/lib/patient-care/model";
import { measurementOverview } from "@/lib/patient-care/overview";
import type { CareData } from "@/lib/patient-care/types";
import { memberGreeting } from "@/lib/patient/greeting";
import type { PatientLocale } from "@/lib/patient/copy";
import type { Measurement } from "@/lib/patient/types";

/**
 * The member overview, worked out on the server from existing reads. The view only renders this.
 * undefined or null in the facts means the read failed or the value does not exist: it stays unknown,
 * never normal, and never moves the journey forward. Numbers only, no interpretation.
 */
export type OverviewFacts = {
  now: Date;
  locale: PatientLocale;
  name: string;
  doctor: string | null | undefined;
  /** True only when the member's agreement is on record. */
  consent: boolean | undefined;
  questionnaireComplete: boolean;
  care: Pick<CareData, "plan" | "events" | "tests" | "appointments"> | null;
  home: Measurement[] | null;
  clinicBp: { id: string; systolic: number; diastolic: number; at: string }[] | null;
  bpWeek: BpWeekRead | null;
  ldl: MemberLdl | undefined;
  /** WP T: the home target the member's physician set (member_bp_target_read); null or absent draws no target. */
  bpTarget?: { systolic: number; diastolic: number } | null;
  medicines: MemberMedicinesRead | null;
  uploaded: { id: string; fileName: string; resultDate: string | null; createdAt: string }[] | null;
  released: { fileId: string; clinic: string; uploadedAt: string; releasedAt: string }[] | null;
  labResultsReceived: boolean;
  visitDone: boolean;
  bookedVisit: { startsAt: string; location: string | null; clinic: string | null; preparation: string | null } | null;
};

export const JOURNEY = ["consent", "anamnesis", "records", "labs", "consult", "plan", "monitoring"] as const;
export type JourneyKey = (typeof JOURNEY)[number];
/** missing: a later step is done, but nothing on record says this one is. unavailable: the care read failed, so the position is not known. */
export type StepState = "done" | "missing" | "current" | "next" | "unavailable";
/** unknown: the care read failed, which says nothing about the plan. */
export type PlanState = "approved" | "waiting" | "unknown";
export type BpSource = "home" | "clinic";
export type ChartPoint = { day: string; morningSystolic: number | null; morningDiastolic: number | null; eveningSystolic: number | null; eveningDiastolic: number | null };
type SeriesSummary = { count: number; latest: { systolic: number; diastolic: number } | null };
export type BpRange = { points: ChartPoint[]; morning: SeriesSummary; evening: SeriesSummary };
/** Cards the new chat can open from a query. Add a target here when the chat handles it; until then its button stays hidden. */
export const QUICK_TARGETS = ["bp", "upload", "consult"] as const;
export type QuickTarget = (typeof QUICK_TARGETS)[number];
export const WIRED_QUICK_TARGETS: readonly QuickTarget[] = [];

export type OverviewData = {
  greeting: string;
  doctor: string | null;
  clinic: string | null;
  plan: PlanState;
  journey: { key: JourneyKey; state: StepState }[];
  bp: {
    /** zone is null for a reading too old to speak for today: number and date only. */
    last: { systolic: number; diastolic: number; at: string; source: BpSource; zone: { level: Urgency | null; provisional: boolean } | null } | null;
    reported?: {systolic:number;diastolic:number;at:string}[];
    counts?: string;
    mean: { systolic: number; diastolic: number; count: number } | null;
    week: { day: number; days: number } | null;
    ranges: { 7: BpRange; 14: BpRange };
    /** WP T: the physician-set home target, drawn as reference lines. */
    target?: { systolic: number; diastolic: number } | null;
  };
  ldl: { shown: false } | { shown: true; baseline: { value: string; on: string } | null; current: { value: string; on: string } | null; reduction: string | null; target: string };
  today: {
    doses: { key: string; name: string; dose: string | null; dueAt: string; status: "upcoming" | "due" | "taken" | "skipped" }[];
    next: { date: string; time: string; slot: Slot } | null;
    adherence: { key: string; name: string; percent: number | null; taken: number; expected: number; days: number }[];
  };
  upcoming: {
    labs: { id: string; title: string; preparation: string | null; dueAt: string | null; location: string | null }[];
    visit: { startsAt: string | null; location: string | null; preparation: string | null } | null;
    rechecks: { key: string; from: string; to: string | null }[];
  };
  documents: { key: string; name: string | null; date: string; uploader: "you" | "clinic"; clinic: string | null; released: boolean }[];
  quick: QuickTarget[];
};

const NO_SYMPTOM_ANSWERS = { chestPain: null, dyspnea: null, neuro: null, syncope: null };
const ADHERENCE_DAYS = 7;

/** Never show a staging placeholder such as "STAGING Test Doctor" to a member. */
export function memberFacingName(name: string | null | undefined): string | null {
  const shown = name?.trim();
  return shown && !/^staging\b/i.test(shown) ? shown : null;
}

function journey(f: OverviewFacts): OverviewData["journey"] {
  const records = !!f.uploaded?.length || !!f.released?.length;
  const done = [f.consent === true, f.questionnaireComplete, records, f.labResultsReceived, f.visitDone, !!f.care?.plan];
  if (!f.care) return JOURNEY.map((key, i) => ({ key, state: done[i] ? "done" : "unavailable" }));
  const current = done.lastIndexOf(true) + 1;
  return JOURNEY.map((key, i) => ({ key, state: i === current ? "current" : i > current ? "next" : done[i] ? "done" : "missing" }));
}

const hour = (at: string) => Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Yerevan" }).format(new Date(at)));
const shortDay = (date: string) => `${date.slice(8)}.${date.slice(5, 7)}`;
const mean = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;

function bpRange(rows: { systolic: number; diastolic: number; measuredAt: string; slot: Slot }[], today: string, days: number): BpRange {
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
  const inRange = rows.filter(r => yerevanDate(new Date(r.measuredAt)) >= dates[0]);
  const series = (slot: Slot): SeriesSummary => {
    const own = inRange.filter(r => r.slot === slot).sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
    const latest = own.at(-1);
    return { count: own.length, latest: latest ? { systolic: latest.systolic, diastolic: latest.diastolic } : null };
  };
  const points = dates.map((date): ChartPoint => {
    const on = inRange.filter(r => yerevanDate(new Date(r.measuredAt)) === date);
    const of = (slot: Slot, key: "systolic" | "diastolic") => mean(on.filter(r => r.slot === slot).map(r => r[key]));
    return { day: shortDay(date), morningSystolic: of("morning", "systolic"), morningDiastolic: of("morning", "diastolic"), eveningSystolic: of("evening", "systolic"), eveningDiastolic: of("evening", "diastolic") };
  });
  return { points, morning: series("morning"), evening: series("evening") };
}

function bp(f: OverviewFacts): OverviewData["bp"] {
  const now = f.now.getTime(), today = yerevanDate(f.now);
  const clinic = (f.clinicBp ?? []).filter(b => Date.parse(b.at) <= now);
  const clinicIds = new Set((f.clinicBp ?? []).map(b => b.id));
  const observations = (f.home ?? []).filter(m => !clinicIds.has(m.id) && Date.parse(m.measuredAt) <= now);
  const home = observations.filter(m=>!isUnverifiedBp(m));
  const reported = observations.filter(isUnverifiedBp).sort((a,b)=>b.measuredAt.localeCompare(a.measuredAt));
  const week = f.bpWeek ? currentWeek(f.bpWeek, f.now) : null;
  // A reading saved in a home BP week has its slot; any other reading goes by the time of day.
  const slots = new Map((f.bpWeek?.enabled ? f.bpWeek.weeks : []).flatMap(w => w.readings.map(r => [r.id, r.slot] as const)));
  const slotted = home.map(m => ({ ...m, slot: slots.get(m.id) ?? (hour(m.measuredAt) < 14 ? "morning" as const : "evening" as const) }));
  const candidates = [
    ...home.map(m => ({ systolic: m.systolic, diastolic: m.diastolic, at: m.measuredAt, source: "home" as const })),
    ...clinic.map(b => ({ systolic: b.systolic, diastolic: b.diastolic, at: b.at, source: "clinic" as const })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const newest = candidates[0];
  const fresh = newest && now - Date.parse(newest.at) <= ZONE_RULES_V1.readingFreshHours * 3600000;
  const zone = fresh ? evaluateBp({ readings: [{ sbp: newest.systolic, dbp: newest.diastolic }], symptoms: NO_SYMPTOM_ANSWERS }) : null;
  const overview = f.home ? measurementOverview(home, f.now) : null;
  const running = week && weekPhase(week, f.now) === "running";
  return {
    last: newest ? { ...newest, zone: zone && { level: zone.zone, provisional: zone.provisional } } : null,
    reported:reported.map(m=>({systolic:m.systolic,diastolic:m.diastolic,at:m.measuredAt})),
    counts:f.home?bpObservationCounts([...observations,...clinic.map(()=>({entrySource:null}))],f.locale):undefined,
    mean: overview?.average ? { ...overview.average, count: overview.count } : null,
    week: running ? { day: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${week.startsOn}T00:00:00Z`)) / 86400000) + 1, days: week.days } : null,
    ranges: { 7: bpRange(slotted, today, 7), 14: bpRange(slotted, today, 14) },
    target: f.bpTarget ?? null,
  };
}

/**
 * Safety rule: LDL numbers appear only after the doctor's approval, which here means a published plan and a
 * doctor's goal, with no newer result still waiting for the doctor. Only values the member may see and that
 * count towards the goal (LDL_STATUS_SOURCES) reach the card. A value the member typed in never does.
 */
function ldl(f: OverviewFacts): OverviewData["ldl"] {
  const read = f.ldl;
  if (!f.care?.plan || !read?.enabled || !read.inPathway || !read.goal || read.withDoctor) return { shown: false };
  const goal = read.goal;
  const a = assessLdl({ goal, observations: read.observations.filter(o => o.memberVisible) });
  const baseline = goal.baseline.kind !== "unknown" && goal.baseline.mmol !== null && goal.baseline.on !== null
    ? { value: formatMmol(goal.baseline.mmol), on: goal.baseline.on } : null;
  const pct = a.reduction.state === "met" || a.reduction.state === "not_met" ? a.reduction : null;
  return {
    shown: true, baseline,
    current: a.latest ? { value: formatMmol(a.latest.mmol, goal.thresholdMmol), on: a.latest.on } : null,
    reduction: pct && pct.percent > 0 ? formatPercent(pct.percent, pct.requiredPct) : null,
    target: formatMmol(goal.thresholdMmol),
  };
}

function today(f: OverviewFacts): OverviewData["today"] {
  const plan = f.care?.plan ?? null;
  const self = f.medicines?.enabled ? f.medicines.medicines : [];
  const planMedicines = plan ? plan.medications.filter(m => m.active && m.planId === plan.id) : [];
  const planDoses = f.care ? dosesForDay(f.care, f.now).map(d => ({ key: `plan:${d.medication.id}:${d.dueAt}`, name: d.medication.name, dose: d.medication.dose, dueAt: d.dueAt, status: d.status })) : [];
  const selfDoses = self.flatMap(m => todaysDoses(m, f.now, self).map(d => ({ key: `self:${d.medicineId}:${d.dueAt}`, name: m.name, dose: m.dose, dueAt: d.dueAt, status: d.status })));
  const counted = [
    ...planMedicines.map(m => ({ key: `plan:${m.id}`, name: m.name, count: adherence({
      id: m.id, source: "plan", name: m.name, dose: m.dose, times: m.times, startedOn: m.startDate, endDate: m.endDate ?? null,
      effectiveAt: m.effectiveAt ?? plan!.publishedAt,
      doses: f.care!.events.filter(e => e.medicationId === m.id).map(e => ({ dueAt: e.dueAt, status: e.status, recordedAt: e.recordedAt })),
    }, ADHERENCE_DAYS, f.now) })),
    ...self.filter(m => !m.stoppedAt).map(m => ({ key: `self:${m.id}`, name: m.name, count: adherence(m, ADHERENCE_DAYS, f.now) })),
  ];
  const week = f.bpWeek ? currentWeek(f.bpWeek, f.now) : null;
  const slot = week ? nextSlot(week, f.now) : null;
  return {
    doses: [...planDoses, ...selfDoses].sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    next: slot ? { date: slot.date, time: slot.time, slot: slot.slot } : null,
    adherence: counted.map(({ key, name, count }) => ({
      key, name, taken: count.taken, expected: count.expected, days: count.days,
      percent: count.expected ? Math.round((count.taken / count.expected) * 100) : null,
    })),
  };
}

function upcoming(f: OverviewFacts, ldlShown: boolean): OverviewData["upcoming"] {
  const care = f.care;
  const appointment = care?.appointments.filter(a => appointmentIsCurrent(a, f.now)).sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""))[0];
  const read = f.ldl?.enabled && f.ldl.inPathway ? f.ldl : null;
  const rechecks: OverviewData["upcoming"]["rechecks"] = [];
  if (ldlShown && read?.retest) rechecks.push({ key: `retest:${read.retest.id}`, from: read.retest.dueFrom, to: read.retest.dueTo });
  else if (ldlShown && read?.goal?.nextTestOn) rechecks.push({ key: "goal", from: read.goal.nextTestOn, to: null });
  return {
    labs: (care?.tests ?? []).filter(t => t.status === "ordered" || t.status === "booked").map(t => ({ id: t.id, title: t.title, preparation: t.preparation === null ? null : memberInstruction(t.preparation, f.locale), dueAt: t.dueAt, location: t.location === null ? null : memberInstruction(t.location, f.locale) })),
    visit: f.bookedVisit ? { startsAt: f.bookedVisit.startsAt, location: f.bookedVisit.location ? memberInstruction(f.bookedVisit.location, f.locale) : f.bookedVisit.clinic, preparation: f.bookedVisit.preparation === null ? null : memberInstruction(f.bookedVisit.preparation, f.locale) }
      : appointment ? { startsAt: appointment.startsAt, location: appointment.location === null ? null : memberInstruction(appointment.location, f.locale), preparation: null } : null,
    rechecks,
  };
}

function documents(f: OverviewFacts): OverviewData["documents"] {
  return [
    ...(f.uploaded ?? []).map(d => ({ key: `member:${d.id}`, name: d.fileName, date: d.resultDate ?? d.createdAt, uploader: "you" as const, clinic: null, released: false })),
    ...(f.released ?? []).map(d => ({ key: `clinic:${d.fileId}`, name: null, date: d.uploadedAt, uploader: "clinic" as const, clinic: memberFacingName(d.clinic), released: true })),
  ].sort((a, b) => b.date.localeCompare(a.date));
}

export function buildOverview(f: OverviewFacts): OverviewData {
  const ldlView = ldl(f);
  return {
    greeting: memberGreeting(f.locale, f.now, f.name),
    doctor: memberFacingName(f.doctor),
    clinic: memberFacingName(f.bookedVisit?.clinic) ?? memberFacingName(f.released?.[0]?.clinic),
    plan: !f.care ? "unknown" : f.care.plan ? "approved" : "waiting",
    journey: journey(f),
    bp: bp(f),
    ldl: ldlView,
    today: today(f),
    upcoming: upcoming(f, ldlView.shown),
    documents: documents(f),
    quick: QUICK_TARGETS.filter(target => WIRED_QUICK_TARGETS.includes(target)),
  };
}
