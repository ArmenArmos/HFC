import { analyteByKey, matchAnalyte, toCanonical } from "@/lib/lab-ai/catalogue";
import { lipidAdherence, isLipidMedicine } from "@/lib/ldl/response";
import { assessLdl, type LdlGoal, type RawLdlObservation } from "@/lib/ldl/status";
import type { DoctorLdlOn } from "@/lib/ldl/schema";
import type { LdlResponseFacts } from "@/lib/ldl/response-schema";
import { triAll, triNot, type EngineFacts, type Tri } from "./engine";
import type { LipidPlannerOn } from "./schema";

/**
 * From the member's record to the facts the rules read. Pure. No threshold from a clinician lives here except the goal the
 * doctor set: the record decides each fact, and a fact the record does not settle is UNKNOWN, never FALSE.
 */
export type LipidTriFact =
  | "onLipidTherapy" | "acsEvent" | "strokeOrTiaEvent" | "changeDatesKnown" | "startOrIncreaseRecorded"
  | "goalRecorded" | "documentedBaseline" | "latestAfterBaseline" | "goalMet" | "aboveGoal" | "noChangeSinceLatestLdl"
  | "noPreTreatmentValue" | "baselineAfterTherapy" | "baselineAltMissing" | "baselineCkMissing" | "lpaMissing"
  | "highestDoseNotRecorded" | "noDoseLog" | "sideEffectOpen" | "reportOpen" | "muscleSymptoms";
export type LipidDateFact = "acsRetestAnchor" | "lastChangeOn" | "lastStartOrIncreaseOn" | "latestLdlOn" | "sideEffectOn";
export type LipidTest = "lipid" | "lipid_annual" | "alt" | "ck";

export type GoalCheckGap = "goal" | "baseline_unknown" | "baseline_on_treatment" | "latest" | "no_later_value";
export type GoalCheck =
  | { run: false; missing: GoalCheckGap[] }
  | {
      run: true;
      latest: { mmol: number; on: string };
      baseline: { mmol: number; on: string };
      threshold: { mmol: number; result: Tri };
      /** `part: false`: this goal has no reduction part. */
      reduction: { part: false } | { part: true; percent: number; requiredPct: number; result: Tri };
      /** Both parts. Never TRUE from the threshold alone when the goal has a reduction part. */
      overall: Tri;
      baselineBelowThreshold: boolean;
    };

export type LipidRecordFacts = EngineFacts<LipidTriFact, LipidDateFact, LipidTest> & {
  goalCheck: GoalCheck;
  adherence: LdlResponseFacts["adherence"];
  reports: { kind: "side_effect" | "decided_to_stop"; on: string; medicine: string }[];
  doctorNextTestOn: string | null;
};

type Therapy = DoctorLdlOn["therapies"][number];
const known = (b: boolean | null): Tri => (b === null ? "UNKNOWN" : b ? "TRUE" : "FALSE");
const maxDay = (days: (string | null)[]) => days.filter((d): d is string => !!d).sort().at(-1) ?? null;

/** CK is not in the lab catalogue, so its name is matched here. CK-MB is a different test. */
const CK_NAME = /(^|[^\p{L}])(ck|cpk|кфк)($|[^\p{L}])|creatine\s*(phospho)?\s*kinase|креатин\s*-?\s*(фосфо)?\s*киназ|կրեատին\s*-?\s*(ֆոսֆո)?\s*կինազ/iu;
const CK_MB = /(^|[^\p{L}])(mb|мв)($|[^\p{L}])/iu;
const alt = analyteByKey("alt")!;

/** Days with a usable reviewed result: the name must be that test, and an ALT value must convert and be plausible. */
export function reviewedDays(labs: LipidPlannerOn["reviewedLabs"], test: "alt" | "ck" | "lpa") {
  return labs.filter((l) => {
    if (l.test !== test) return false;
    if (test === "ck") return l.name !== null && CK_NAME.test(l.name) && !CK_MB.test(l.name);
    if (l.name !== null && matchAnalyte(l.name) !== test) return false;
    if (test === "lpa") return true;
    const v = toCanonical(alt, Number(l.value), l.unit);
    return v !== null && Number.isFinite(v) && v >= alt.plausible[0] && v <= alt.plausible[1];
  }).map((l) => l.on);
}

/** A plain dose in mg, for comparing two doses of one medicine. Anything else is not read: the direction is then unknown. */
export function plainDose(dose: string) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(mg|мг|մգ)?\s*$/iu.exec(dose);
  return m ? Number(m[1].replace(",", ".")) : null;
}

/** The last start or dose increase among medicines still taken. A later change of unclear direction leaves it unknown. */
export function lastStartOrIncrease(therapies: Therapy[]): { on: string | null; known: Tri } {
  const key = (t: Therapy) => `${t.drug}:${t.other ?? ""}`;
  const activeDrugs = new Set(therapies.filter((t) => !t.endedAt).map(key));
  if (!activeDrugs.size) return { on: null, known: "UNKNOWN" };
  let on: string | null = null;
  for (const drug of activeDrugs) {
    const rows = therapies.filter((t) => key(t) === drug);
    if (rows.some((t) => !t.startedOn)) return { on: null, known: "UNKNOWN" };
    rows.sort((a, b) => a.startedOn!.localeCompare(b.startedOn!) || a.recordedAt.localeCompare(b.recordedAt));
    let best: string | null = null, unclear = false;
    rows.forEach((row, i) => {
      const before = i > 0 ? plainDose(rows[i - 1].dose) : null, now = plainDose(row.dose);
      const prior = rows[i - 1];
      // A gap between stopping and starting again is a new start, whatever the dose. Not knowing when it stopped is not knowing that.
      const stoppedBefore = prior?.endedAt ? (prior.stoppedOn ? prior.stoppedOn < row.startedOn! : null) : false;
      if (i === 0 || stoppedBefore === true) { best = row.startedOn; unclear = false; }
      else if (stoppedBefore === null || before === null || now === null) unclear = true;
      else if (now > before) { best = row.startedOn; unclear = false; }
    });
    if (unclear) return { on: null, known: "UNKNOWN" };
    on = maxDay([on, best]);
  }
  return { on, known: on ? "TRUE" : "UNKNOWN" };
}

export function lipidFacts(read: LipidPlannerOn): LipidRecordFacts | null {
  const record = read.record;
  if (!record.enabled) return null;
  const today = read.today;
  const goal: LdlGoal | null = record.goals[0] ?? null;
  const a = assessLdl({ goal, observations: read.reviewedLdl as RawLdlObservation[], reviewedList: true });
  const latest = a.latest;
  const b = goal?.baseline ?? null;

  const events = record.events, active = record.therapies.filter((t) => !t.endedAt);
  const acsDates = events.filter((e) => e.type === "acs_mi").map((e) => e.on);
  const acsEvent: Tri = acsDates.length ? "TRUE" : !events.length || events.some((e) => e.type === "other") ? "UNKNOWN" : "FALSE";
  const strokeOrTiaEvent: Tri = events.some((e) => e.type === "ischaemic_stroke" || e.type === "tia") ? "TRUE" : events.length ? "FALSE" : "UNKNOWN";
  const onLipidTherapy: Tri = active.length ? "TRUE" : record.therapies.length ? "FALSE" : "UNKNOWN";

  // A current therapy with no start date, or a stop with no date, hides the latest change: no later date stands in for it.
  const changeHidden = active.some((t) => !t.startedOn) || record.therapies.some((t) => t.endedAt && !t.stoppedOn);
  const lastChangeOn = changeHidden ? null : maxDay([...active.map((t) => t.startedOn), ...record.therapies.map((t) => t.stoppedOn)]);
  const eventsDated = !events.some((e) => !e.on);
  const firstStartOn = !record.therapies.length || record.therapies.some((t) => !t.startedOn) ? null : record.therapies.map((t) => t.startedOn!).sort()[0];
  const startOrIncrease = lastStartOrIncrease(record.therapies);

  const altDays = reviewedDays(read.reviewedLabs, "alt"), ckDays = reviewedDays(read.reviewedLabs, "ck");
  const missingBefore = (days: string[]) => (firstStartOn ? known(!days.some((d) => d <= firstStartOn)) : "UNKNOWN");

  const thresholdMet: Tri = goal && latest ? known(latest.mmol < goal.thresholdMmol) : "UNKNOWN";
  const reductionMet: Tri = !goal ? "UNKNOWN" : a.reduction.state === "not_applicable" || a.reduction.state === "met" ? "TRUE" : a.reduction.state === "not_met" ? "FALSE" : "UNKNOWN";
  const goalMet = triAll([thresholdMet, reductionMet]);

  const goalCheckGaps: GoalCheckGap[] = [];
  if (!goal) goalCheckGaps.push("goal");
  else if (b!.kind === "on_treatment") goalCheckGaps.push("baseline_on_treatment");
  else if (b!.kind === "unknown" || b!.mmol === null || b!.on === null) goalCheckGaps.push("baseline_unknown");
  if (!latest) goalCheckGaps.push("latest");
  else if (b?.on && latest.on <= b.on) goalCheckGaps.push("no_later_value");
  const goalCheck: GoalCheck = goalCheckGaps.length ? { run: false, missing: goalCheckGaps } : {
    run: true,
    latest: { mmol: latest!.mmol, on: latest!.on },
    baseline: { mmol: b!.mmol!, on: b!.on! },
    threshold: { mmol: goal!.thresholdMmol, result: thresholdMet },
    reduction: a.reduction.state === "met" || a.reduction.state === "not_met" ? { part: true, percent: a.reduction.percent, requiredPct: a.reduction.requiredPct, result: known(a.reduction.state === "met") } : { part: false },
    overall: goalMet,
    baselineBelowThreshold: a.baselineBelowThreshold,
  };

  const adherence = lipidAdherence(read.medicines);
  const reports = read.concerns.filter((c) => !c.medicine.trim() || isLipidMedicine(c.medicine));
  const reportTri = (kinds: string[]): Tri => {
    const rows = reports.filter((c) => kinds.includes(c.kind));
    return rows.some((c) => c.medicine.trim()) ? "TRUE" : rows.length ? "UNKNOWN" : "FALSE";
  };
  const open = record.loop?.retests.find((r) => r.state === "scheduled" || r.state === "requested" || r.state === "fenced");

  const tri: Record<LipidTriFact, Tri> = {
    onLipidTherapy, acsEvent, strokeOrTiaEvent,
    changeDatesKnown: lastChangeOn && eventsDated ? "TRUE" : "UNKNOWN",
    startOrIncreaseRecorded: startOrIncrease.known,
    goalRecorded: goal ? "TRUE" : "UNKNOWN",
    documentedBaseline: !b ? "UNKNOWN" : b.kind === "pre_treatment" && b.mmol !== null && b.on !== null ? "TRUE" : b.kind === "on_treatment" ? "FALSE" : "UNKNOWN",
    latestAfterBaseline: !latest || !b?.on ? "UNKNOWN" : known(latest.on > b.on),
    goalMet, aboveGoal: triNot(goalMet),
    noChangeSinceLatestLdl: !latest || !lastChangeOn || !eventsDated ? "UNKNOWN" : known(latest.on > maxDay([lastChangeOn, ...events.map((e) => e.on)])!),
    noPreTreatmentValue: !b ? "UNKNOWN" : known(!(b.kind === "pre_treatment" && b.mmol !== null)),
    baselineAfterTherapy: !b || b.kind !== "pre_treatment" ? "FALSE" : firstStartOn && b.on ? known(b.on > firstStartOn) : "UNKNOWN",
    baselineAltMissing: missingBefore(altDays), baselineCkMissing: missingBefore(ckDays),
    lpaMissing: known(!reviewedDays(read.reviewedLabs, "lpa").length),
    highestDoseNotRecorded: onLipidTherapy === "TRUE" ? known(!active.some((t) => t.maximallyTolerated)) : onLipidTherapy,
    noDoseLog: known(!adherence || adherence.percent === null),
    sideEffectOpen: reportTri(["side_effect"]), reportOpen: reportTri(["side_effect", "decided_to_stop"]),
    // Reports carry no symptom detail. A report is never read as "no muscle symptoms", and no report does not prove it either.
    muscleSymptoms: "UNKNOWN",
  };
  return {
    today, tri,
    dates: {
      acsRetestAnchor: lastChangeOn ? maxDay([lastChangeOn, ...acsDates]) : null, lastChangeOn, lastStartOrIncreaseOn: startOrIncrease.on,
      latestLdlOn: latest?.on ?? null, sideEffectOn: reports.filter((r) => r.kind === "side_effect").map((r) => r.on).sort()[0] ?? null,
    },
    results: { lipid: a.observations.filter((o) => o.counts).map((o) => o.on), alt: altDays },
    confirmed: open ? { from: open.dueFrom, to: open.dueTo } : null,
    goalCheck, adherence, reports, doctorNextTestOn: goal?.nextTestOn ?? null,
  };
}
