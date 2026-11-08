import { analyteByKey, matchAnalyte, toCanonical } from "@/lib/lab-ai/catalogue";
import { adherence } from "@/lib/member-medicines/model";
import { LDL_ADHERENCE_WINDOW_DAYS, LDL_DEFAULTS_VERSION, LDL_LIPID_MEDICINE_NAMES } from "./constants";
import { assessLdl, ldlObservations } from "./status";
import { LDL_RESPONSE_VERSION, type LdlCandidate, type LdlResponseFacts, type LdlResponseRecord } from "./response-schema";

/**
 * The response check (phase 2). Pure: from what ldl_response_candidates returns it decides whether the member's newest
 * counted LDL value needs a response and builds it. The status is lib/ldl/status.ts's; this adds the facts the doctor
 * sees and the guideline next step as text. It never selects a medicine: the doctor decides.
 */
const alt = analyteByKey("alt")!;

export function isLipidMedicine(name: string) {
  const n = name.toLocaleLowerCase();
  return LDL_LIPID_MEDICINE_NAMES.some((k) => n.includes(k));
}

/** Lipid-medicine doses in the window: ticked taken (late counts) over doses whose time has passed. Null without one. */
export function lipidAdherence(medicines: LdlCandidate["medicines"]): LdlResponseFacts["adherence"] {
  const now = new Date(medicines.now);
  const lipid = [...medicines.plan, ...medicines.self].filter((m) => isLipidMedicine(m.name));
  if (!lipid.length) return null;
  const sum = lipid.map((m) => adherence(m, LDL_ADHERENCE_WINDOW_DAYS, now)).reduce((a, b) => ({ expected: a.expected + b.expected, taken: a.taken + b.taken, skipped: a.skipped + b.skipped }), { expected: 0, taken: 0, skipped: 0 });
  return { windowDays: LDL_ADHERENCE_WINDOW_DAYS, ...sum, percent: sum.expected ? (sum.taken / sum.expected) * 100 : null, medicines: [...new Set(lipid.map((m) => m.name))] };
}

/** The newest reviewed ALT (U/L) with a recognised name, unit and a plausible value. */
export function latestAlt(raw: LdlCandidate["alt"]): LdlResponseFacts["alt"] {
  let best: { value: number; on: string } | null = null;
  for (const r of raw) {
    if (r.name !== null && matchAnalyte(r.name) !== "alt") continue;
    const v = toCanonical(alt, Number(r.value), r.unit);
    if (v === null || !Number.isFinite(v) || v < alt.plausible[0] || v > alt.plausible[1]) continue;
    if (!best || r.on > best.on || (r.on === best.on && v > best.value)) best = { value: Number(v.toPrecision(12)), on: r.on };
  }
  return best;
}

/** The guideline next step for an above-goal result. No adherence cut-off (Task 19: no 90% rule): adherence and treatment are reviewed together. */
export function nextStepFor(status: LdlResponseRecord["status"], a: LdlResponseFacts["adherence"]): LdlResponseFacts["nextStep"] {
  if (status !== "above_goal") return null;
  if (!a || a.percent === null) return "adherence_unknown";
  return "step_up";
}

/**
 * The response for the newest counted value, or null when there is none to make: no counted value, the value is not
 * after the floor (the change it follows), or it already has one.
 */
export function buildLdlResponse(c: LdlCandidate): LdlResponseRecord | null {
  const a = assessLdl({ goal: c.goal, observations: c.observations, reviewedList: true });
  const latest = a.latest;
  if (!latest || latest.on <= c.floorOn || c.checked.includes(latest.id) || latest.source === "member") return null;
  // That day already has a response: only a higher value needs another (test gap 5). The same value from a better source does not.
  if (ldlObservations(c.observations.filter((o) => o.on === latest.on && c.checked.includes(o.id)), { reviewedList: true }).some((o) => o.mmol >= latest.mmol)) return null;
  const status = a.status === "at_goal" || a.status === "above_goal" ? a.status : "not_assessable";
  const counted = a.observations.filter((o) => o.counts);
  const previous = counted[counted.indexOf(latest) - 1] ?? null;
  const adh = lipidAdherence(c.medicines);
  const r = a.reduction;
  const facts: LdlResponseFacts = {
    version: "ldl-response-facts-v1",
    defaultsVersion: LDL_DEFAULTS_VERSION,
    value: { mmol: latest.mmol, on: latest.on, source: latest.source },
    goal: c.goal ? { version: c.goal.version, category: c.goal.category, thresholdMmol: c.goal.thresholdMmol, reductionPct: c.goal.reductionRule ? c.goal.reductionPct : null } : null,
    previous: previous ? { mmol: previous.mmol, on: previous.on } : null,
    changePct: previous && previous.mmol > 0 ? ((latest.mmol - previous.mmol) / previous.mmol) * 100 : null,
    reduction: r.state === "met" || r.state === "not_met" ? { state: r.state, percent: r.percent, requiredPct: r.requiredPct } : { state: r.state, percent: null, requiredPct: null },
    adherence: adh,
    alt: latestAlt(c.alt),
    nextStep: nextStepFor(status, adh),
    adherenceThresholdPct: null,
  };
  return { version: LDL_RESPONSE_VERSION, memberId: c.memberId, observationKey: latest.id, observedOn: latest.on, status, facts };
}

/**
 * Reviewed values after the floor that can never make a response, so the sweep records them as skipped: those the status
 * module drops (not LDL by the catalogue, an unknown unit, implausible, or an exact duplicate), and those on the newest
 * day that are not the value this sweep responds to (a lower one, or a day already answered at that value or higher).
 */
export function unusableObservationKeys(c: LdlCandidate): string[] {
  const a = assessLdl({ goal: c.goal, observations: c.observations, reviewedList: true });
  const usable = new Set(a.observations.map((o) => o.id));
  const next = buildLdlResponse(c)?.observationKey;
  return c.observations.filter((o) => o.on > c.floorOn && !c.checked.includes(o.id) && o.id !== next && (!usable.has(o.id) || o.on === a.latest?.on)).map((o) => o.id);
}
