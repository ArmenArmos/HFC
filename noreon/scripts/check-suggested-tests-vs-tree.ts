/**
 * Suggested tests after the first questionnaire, against the clinical sources.
 *
 * Armen reported on 17 October 2026 that the tests the app suggests after the
 * questionnaire do not match the decision tree. `pnpm check:clinical` verifies
 * the questionnaire's structure and branch conditions; it does not compare the
 * resulting test list with what the sources order. This script does that.
 *
 * Every scenario is a complete questionnaire, filled through the same
 * visibility and pruning rules the member app uses, and is run through the two
 * code paths a member actually sees:
 *
 *   results  `app/patient/results/page.tsx`: evaluate() then buildPlan()
 *   booking  `lib/patient-care/clinical-review-engine.ts` via
 *            `lib/real-booking/repository.ts`: what the member can request
 *
 * The expected tests come from SPEC below, one row per ordering rule, each with
 * the paragraph it was transcribed from:
 *
 *   DT   docs/clinical/NRN-CLIN-ALG-001-decision-tree-v1.1.docx (the spec; P = paragraph, numbered as in output/clinical-decision-tree-v1.1-paragraphs-2026-10-15.txt)
 *   QJ   docs/clinical/NRN-CLIN-ALG-001-questionnaire.json `branches[].outcome`
 *   CAT  docs/clinical/NRN-LAB-CAT-001-lab-catalogue.json (section A triggers, B gaps)
 *   LP2  Noreon_Hypertension_Laboratory_Protocol_v2.docx (docs/reference, #218)
 *
 * Each expected test carries the category a missing test falls into:
 *   a  code bug: the source orders it, the code does not deliver it
 *   b  the source is ambiguous, or the item is blocked by Armen's C1–C16
 *   c  the lab protocol v2 and the decision tree disagree
 *
 * Besides the test list, every scenario states what the sources say about the
 * route: the triage colour, the consultation window (days, or a source range),
 * the rules that must fire (one per source branch, as `branch-coverage.ts`
 * maps them) and the rules that must not. A triage colour or window that is
 * later than the source is (a); one that is earlier is conservative and listed
 * as (b); a source ambiguity carries its own note and is (b).
 *
 * It fails on any category (a) discrepancy, on a red profile that shows a
 * routine test or can book one, on an orange profile that cannot book, and on
 * any difference between the results page and booking. Category (b) items are
 * expected while Armen's questions are open: they are listed, never failed.
 * `scripts/run-checks.mjs` runs it in CI with the other check-*.ts files.
 *
 *   node --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --import ./scripts/register-alias.mjs scripts/check-suggested-tests-vs-tree.ts [--json out.json] [--quiet]
 */
import { writeFileSync } from "node:fs";
import { buildPlan, consultationWindowDays, evaluate } from "@/lib/clinical/rules/engine";
import { DISCUSS_ONLY_RULES } from "@/lib/clinical/seed/tests";
import { bmi } from "@/lib/clinical/rules/derived";
import { clinicalReviewEngine } from "@/lib/patient-care/clinical-review-engine";
import type { ClinicalSnapshot } from "@/lib/patient-care/clinical-case-repository";
import { activeFields, assessmentProgress, fieldComplete, pruneAnswers } from "@/lib/patient/questionnaire";
import { UNKNOWN, URGENCY_RANK, type Answers, type Decision, type FieldValue, type Urgency } from "@/lib/clinical/types";

// ---------------------------------------------------------------------------
// Canonical investigations. The app's test ids map onto these, so one app test
// that carries two investigations (HbA1c and fasting glucose) counts as both.
// ---------------------------------------------------------------------------

type Key =
  | "lipid" | "hba1c" | "glucose" | "creatinine-egfr" | "urine-acr" | "potassium" | "sodium"
  | "urinalysis" | "cbc-hb" | "tsh" | "ecg" | "echo" | "holter" | "nt-probnp" | "lpa" | "apob"
  | "hbpm" | "bp-office" | "anthropometry" | "sleep-study" | "insulin-homa" | "fundoscopy" | "foot-exam" | "uric-acid" | "calcium" | "liver" | "ldct";

const APP_TEST_KEYS: Record<string, Key[]> = {
  "lipid-panel": ["lipid"],
  apob: ["apob"],
  lpa: ["lpa"],
  hba1c: ["hba1c"],
  "hba1c-glucose": ["hba1c", "glucose"],
  "creatinine-egfr": ["creatinine-egfr"],
  "urine-acr": ["urine-acr"],
  urinalysis: ["urinalysis"],
  potassium: ["potassium"],
  sodium: ["sodium"],
  "cbc-hb": ["cbc-hb"],
  "ecg-12-lead": ["ecg"],
  tsh: ["tsh"],
  "nt-probnp": ["nt-probnp"],
  echocardiogram: ["echo"],
  holter: ["holter"],
  "bp-visit": ["bp-office"],
  anthropometry: ["anthropometry"],
  "bp-home-log": ["hbpm"],
  "insulin-homa": ["insulin-homa"],
  "sleep-study": ["sleep-study"],
  fundoscopy: ["fundoscopy"],
  "foot-exam": ["foot-exam"],
};

/** Measurements Noreon takes at any visit. Never counted as an extra test. */
const ALWAYS_ALLOWED: Key[] = ["bp-office", "anthropometry"];

type Category = "a" | "b" | "c";
type Expectation = { key: Key; cat: Category; note?: string };

type SpecRule = {
  id: string;
  title: string;
  source: string;
  when: (p: Profile) => boolean;
  required: Expectation[];
  /** Acceptable if present, never reported as missing. */
  conditional?: Key[];
  note?: string;
};

// ---------------------------------------------------------------------------
// Reading answers. Kept local so the spec reads as the source does.
// ---------------------------------------------------------------------------

type Profile = { answers: Answers };
const v = (p: Profile, id: string) => p.answers[id]?.value;
const n = (p: Profile, id: string) => (typeof v(p, id) === "number" ? (v(p, id) as number) : undefined);
const s = (p: Profile, id: string) => (typeof v(p, id) === "string" ? (v(p, id) as string) : undefined);
const has = (p: Profile, id: string, option: string) => {
  const value = v(p, id);
  return Array.isArray(value) && value.includes(option);
};
const sbp = (p: Profile) => n(p, "q5.last_reading.systolic");
const dbp = (p: Profile) => n(p, "q5.last_reading.diastolic");
const crisis = (p: Profile) => (sbp(p) ?? 0) >= 180 || (dbp(p) ?? 0) >= 110;
const crisisSymptomatic = (p: Profile) =>
  crisis(p) && ((v(p, "q5.crisis_symptoms") as string[] | undefined) ?? []).some((x) => x !== "none");
const grade1or2 = (p: Profile) => !crisis(p) && ((sbp(p) ?? 0) >= 140 || (dbp(p) ?? 0) >= 90);
// Q5.2 band override: Armen, team group message 588, 2 Nov.
const elevated = (p: Profile) =>
  !crisis(p) && !grade1or2(p) && sbp(p) !== undefined && dbp(p) !== undefined && ((sbp(p)! >= 135) || (dbp(p)! >= 85));
const diagnosedHtn = (p: Profile) => ["treated", "untreated"].includes(s(p, "q5.diagnosed") ?? "");
const condition = (p: Profile, c: string) => has(p, "q6.conditions", c);
const relative = (p: Profile, r: string) => has(p, "q7.relatives", r);
const premature = (p: Profile) => ["male_under_55", "female_under_65"].includes(s(p, "q7.relative_age") ?? "");
const chestPainNotNow = (p: Profile) => ["yes", "unsure"].includes(s(p, "q9.present") ?? "") && s(p, "q9.right_now") === "no";
const unstablePain = (p: Profile) =>
  chestPainNotNow(p) && (s(p, "q9.crescendo") === "worse" || s(p, "q9.at_rest") === "yes" ||
    s(p, "q9.duration") === "over_15" || ["multi_daily", "daily"].includes(s(p, "q9.frequency") ?? ""));
const palpitationsNotNow = (p: Profile) =>
  s(p, "q10.symptoms") === "palpitations_only" || (s(p, "q10.symptoms") === "yes" && s(p, "q10.right_now") === "no");
const formerSmoker = (p: Profile) => s(p, "q3.status") === "former";
const packYearsOf = (p: Profile) => ((n(p, "q3.years") ?? 0) * (n(p, "q3.per_day") ?? 0)) / 20;
const redRoute = (p: Profile) =>
  s(p, "q9.right_now") === "yes" || s(p, "q10.right_now") === "yes" || crisisSymptomatic(p) ||
  has(p, "q5.crisis_symptoms", "neuro") || has(p, "q5.crisis_symptoms", "seizure");

// The "basic workup" DT P176 orders for hypertension is not itemised in the tree.
// CAT section A/B itemises what the algorithm needs from it; LP2 §2 is the
// hypertension-specific core list. Items both name are required here.
const WORKUP: Expectation[] = [
  { key: "creatinine-egfr", cat: "a", note: "CAT A.3: any BP abnormality; DT Phase 2 step 1 HMOD needs eGFR" },
  { key: "urine-acr", cat: "a", note: "CAT B.1: ordered for every hypertensive; DT P564 ACR gate" },
  { key: "potassium", cat: "a", note: "CAT B.1 critical: 2024 HTN basic workup; DT P582 RAS-blocker baseline" },
  { key: "sodium", cat: "a", note: "CAT B.1: 2024 HTN basic workup" },
  { key: "hba1c", cat: "a", note: "CAT A.2 trigger includes ԱՃ (hypertension)" },
  { key: "glucose", cat: "a", note: "CAT A.2 fasting glucose: same indications as HbA1c" },
  { key: "urinalysis", cat: "a", note: "CAT A.3: basic workup" },
  { key: "cbc-hb", cat: "a", note: "CAT A.4: basic workup" },
  { key: "tsh", cat: "a", note: "CAT A.5: basic workup; LP2 §2 keeps TSH" },
];
const WORKUP_CONDITIONAL: Key[] = ["liver", "uric-acid", "calcium", "echo"];

// ---------------------------------------------------------------------------
// The specification, one row per ordering rule.
// ---------------------------------------------------------------------------

export const SPEC: SpecRule[] = [
  {
    id: "S01", title: "Everyone: Phase 1 lipid referral",
    source: "DT P33, P393 (Phase 1 ends SCORE2_PENDING with a lab referral) · CAT A.1 «Բոլորին»",
    when: (p) => !redRoute(p),
    required: [{ key: "lipid", cat: "a" }],
    conditional: ["lpa"],
    note: "Lp(a) once in a lifetime (DT P555) is a Phase 2 action; LP2 §5 says every adult once. Not counted as missing at Phase 1.",
  },
  {
    id: "S02", title: "Measured BP 140–179 / 90–109",
    source: "DT P175–178 (140–159/90–99: doctor ≤2 wk + ECG + basic workup) · QJ Q5.2 (140–179/90–109: HBPM 7-day + doctor 2–4 wk + basic workup)",
    when: (p) => grade1or2(p),
    required: [
      { key: "ecg", cat: "a", note: "explicit in DT P176" },
      { key: "hbpm", cat: "a", note: "explicit in QJ Q5.2; BP-002's own next step says seven days of home readings" },
      ...WORKUP,
    ],
    conditional: WORKUP_CONDITIONAL,
  },
  {
    id: "S03", title: "Measured BP ≥180/110 without symptoms (RF-06)",
    source: "DT P181–186, RF-06 P606–609; QJ Q5.3 «Ոչ մեկը» · CAT A.3 «ԱՃ ցանկացած շեղում»",
    when: (p) => crisis(p) && !crisisSymptomatic(p),
    required: [
      { key: "ecg", cat: "a", note: "≥180/110 is hypertension; nothing in DT/QJ removes the 140+ workup above 180" },
      ...WORKUP,
    ],
    conditional: [...WORKUP_CONDITIONAL, "hbpm"],
    note: "DT itemises only the deadline here. The workup is inferred from the 140+ branch (audit A4), pending Armen's confirmation (B8).",
  },
  {
    id: "S04", title: "Diagnosed hypertension (treated or untreated), any reading",
    source: "QJ Q5.1 (notx: referral; tx: control assessment) · CAT B.1 (ACR for every hypertensive) · DT Phase 2 step 1 P399–408 (HMOD from ECG, ACR, eGFR) · LP2 §2, §7",
    when: (p) => diagnosedHtn(p),
    required: [{ key: "ecg", cat: "a", note: "DT P399 HMOD needs ECG-LVH; LP2 §7 baseline ECG for confirmed HTN" }, ...WORKUP],
    conditional: [...WORKUP_CONDITIONAL, "hbpm"],
  },
  {
    id: "S05", title: "Elevated BP 135–139 systolic or 85–89 diastolic",
    source: "DT P170–176 · QJ Q5.2 (risk ≥10% → ABPM/HBPM)",
    when: (p) => elevated(p) && !diagnosedHtn(p),
    required: [],
    conditional: ["hbpm", "creatinine-egfr", "urine-acr", "hba1c", "glucose"],
    note: "Out-of-office measurement depends on SCORE2 ≥10%, which Phase 1 cannot know. CAT «ԱՃ ցանկացած շեղում» may or may not include elevated BP. (b)",
  },
  {
    id: "S06", title: "Last BP reading not known",
    source: "DT P186–190 («Չեմ հիշում» → 7-day HBPM, 2 readings ×2/day) · QJ Q5.1 idk",
    when: (p) => v(p, "q5.last_reading.systolic") === UNKNOWN,
    required: [{ key: "hbpm", cat: "a", note: "explicit; the booking path adds it, the results page does not" }],
  },
  {
    id: "S07", title: "Diabetes",
    source: "DT P231–234 (HbA1c unknown → HbA1c, no fasting) · QJ Q6.2e · CAT A.2, A.3, B.1 (ACR for every diabetic) · DT P564 (ACR gate, DM)",
    when: (p) => condition(p, "diabetes"),
    required: [
      { key: "urine-acr", cat: "a" },
      { key: "creatinine-egfr", cat: "a", note: "DT Phase 2 step 3 classifies diabetes risk by eGFR" },
      { key: "fundoscopy", cat: "a", note: "CAT B.3: every member with diabetes, yearly" },
      { key: "foot-exam", cat: "a", note: "CAT B.3: every member with diabetes, yearly" },
    ],
    conditional: ["hba1c", "glucose"],
  },
  {
    id: "S07b", title: "Diabetes with HbA1c unknown",
    source: "DT P231–234 · QJ Q6.2e (HbA1c ≤2 weeks)",
    when: (p) => condition(p, "diabetes") && v(p, "q6.hba1c") === UNKNOWN,
    required: [{ key: "hba1c", cat: "a" }],
  },
  {
    id: "S08", title: "Prediabetes",
    source: "CAT A.2 (HbA1c and fasting glucose: «նախաշաքարախտ»)",
    when: (p) => condition(p, "prediabetes"),
    required: [{ key: "hba1c", cat: "a" }, { key: "glucose", cat: "a" }],
  },
  {
    id: "S09", title: "Chronic kidney disease",
    source: "QJ Q6.1 CKD (eGFR classification <30 / 30–59) · DT P543–546 (eGFR + ACR at least yearly) · CAT A.3",
    when: (p) => condition(p, "kidney"),
    required: [{ key: "creatinine-egfr", cat: "a" }, { key: "urine-acr", cat: "a" }],
    conditional: ["potassium", "sodium", "urinalysis"],
  },
  {
    id: "S10", title: "Diagnosed heart failure",
    source: "QJ Q6.1 HF (NT-proBNP · echo · referral)",
    when: (p) => condition(p, "heart_failure"),
    required: [{ key: "nt-probnp", cat: "a" }, { key: "echo", cat: "a" }],
  },
  {
    id: "S11", title: "Diagnosed arrhythmia / AF",
    source: "QJ Q6.1 AF (ECG · Holter · stroke risk)",
    when: (p) => condition(p, "af"),
    required: [{ key: "ecg", cat: "a" }, { key: "holter", cat: "a" }],
  },
  {
    id: "S12", title: "Familial hypercholesterolaemia (own diagnosis)",
    source: "QJ Q6.1 FH (SCORE2 off, high risk, genetic counselling) · DT P431",
    when: (p) => condition(p, "familial_hypercholesterolaemia"),
    required: [],
    conditional: ["lpa", "apob"],
    note: "No test named for one's own FH beyond lipids. (b)",
  },
  {
    id: "S13", title: "Family history of inherited high cholesterol",
    source: "DT P253–256 (lipid panel priority · Lp(a) once) · QJ Q7.1 FH (Lp(a) once · lipid panel · DLCN)",
    when: (p) => relative(p, "familial_hypercholesterolaemia"),
    required: [{ key: "lpa", cat: "a" }, { key: "lipid", cat: "a" }],
  },
  {
    id: "S14", title: "Premature CVD in a first-degree relative",
    source: "DT P245–251 (infarction, stroke or sudden death, ♂<55 / ♀<65: modifier only) · QJ Q7.2 · CAT A.1 Lp(a) («Վաղաժամ ՍԱՀ ընտանիքում») · CAT D route (Premium: Lp(a), ApoB/ApoA1)",
    when: (p) => (relative(p, "cad") || relative(p, "stroke") || relative(p, "sudden_death")) && premature(p),
    required: [{ key: "lpa", cat: "a" }],
    conditional: ["apob"],
    note: "ApoB appears only in the CAT D package route, not as a test trigger; LP2 §5 keeps ApoB targeted. (b)",
  },
  {
    id: "S15", title: "Sudden death before 50 in the family, no Q10 symptoms",
    source: "DT P250–253 (ECG priority · cross-read with Q9) · C14 open · LP2 §7 (family history alone is no ECG indication)",
    when: (p) => relative(p, "sudden_death") && !["yes", "palpitations_only"].includes(s(p, "q10.symptoms") ?? ""),
    required: [{ key: "ecg", cat: "b", note: "DT names ECG; C14 asks its priority; LP2 disagrees (c)" }],
  },
  {
    id: "S16", title: "RF-12: family sudden death <50 with Q10 symptoms",
    source: "DT P250–253, RF-12 P624–627",
    when: (p) => relative(p, "sudden_death") && ["yes", "palpitations_only"].includes(s(p, "q10.symptoms") ?? "") && !redRoute(p),
    required: [{ key: "ecg", cat: "a" }],
  },
  {
    id: "S17", title: "Current smoker or e-cigarette / heated tobacco",
    source: "DT P146–152, P156 · QJ Q3.3/Q3.4 (LDCT, EXTERNAL) · CAT B.3 prose (ECG «ծխող») · LP2 §7 (smoking alone is no ECG indication)",
    when: (p) => ["current", "alternative"].includes(s(p, "q3.status") ?? ""),
    required: [],
    conditional: ["ecg"],
    note: "No test is ordered for smoking by DT. ECG for smokers is CAT prose vs LP2 (c). LDCT is EXTERNAL pending Clinical Board (b).",
  },
  {
    id: "S18", title: "BMI ≥25",
    source: "CAT A.2 (HbA1c and fasting glucose: «BMI ≥25») · CAT D route (Metabolic)",
    when: (p) => (bmi(p.answers) ?? 0) >= 25,
    required: [{ key: "hba1c", cat: "a" }, { key: "glucose", cat: "a" }],
  },
  {
    id: "S18b", title: "BMI ≥30: fasting insulin/HOMA-IR",
    source: "CAT A.2 «Ծոմային ինսուլին · HOMA-IR», confirmed by Armen TC-02/08/12",
    when: (p) => (bmi(p.answers) ?? 0) >= 30,
    required: [{ key: "insulin-homa", cat: "a" }],
  },
  {
    id: "S19", title: "Waist above the reduction threshold (♂ ≥102, ♀ ≥88)",
    source: "DT P79 (lose weight) · CAT D route (waist high → Metabolic)",
    when: (p) => (n(p, "q2.waist") ?? 0) >= (s(p, "q1.sex") === "female" ? 88 : 102),
    required: [],
    conditional: ["hba1c", "glucose"],
    note: "DT orders no test for waist; CAT routes it to the Metabolic package. Accepted, not required. (b)",
  },
  {
    id: "S20", title: "Stable chest pain, none of the instability signs",
    source: "DT P339 (cardiologist ≤2 wk + ECG, lipid, Hb, TSH) · ACS 2023 §3.1.1",
    when: (p) => chestPainNotNow(p) && !unstablePain(p),
    required: [
      { key: "ecg", cat: "a" }, { key: "lipid", cat: "a" }, { key: "tsh", cat: "a" },
      { key: "cbc-hb", cat: "a", note: "Hb named in DT and confirmed by Armen TC-05" },
    ],
  },
  {
    id: "S21", title: "RF-07: worsening, rest, >15 min or daily chest pain",
    source: "DT P336 (cardiologist 1–2 days + ECG immediately)",
    when: (p) => unstablePain(p),
    required: [{ key: "ecg", cat: "a" }],
  },
  {
    id: "S22", title: "Palpitations, not right now",
    source: "DT P355–358 (clarifiers + routine ECG), P382–385 (short, rare: routine ECG)",
    when: (p) => palpitationsNotNow(p),
    required: [{ key: "ecg", cat: "a" }],
  },
  {
    id: "S23", title: "Irregular rhythm",
    source: "DT P376–379 (AF suspected · Holter 24–48 h · cardiologist) · QJ Q10.4 (ECG + Holter)",
    when: (p) => s(p, "q10.rhythm") === "irregular" && palpitationsNotNow(p),
    required: [{ key: "ecg", cat: "a" }, { key: "holter", cat: "a" }],
  },
  {
    id: "S24", title: "RF-08 / RF-09: fainting on exertion or without warning",
    source: "DT P369–377 (ECG ≤24 h + Holter + echo + arrhythmologist 2–3 days; RF-09 «same path»)",
    when: (p) => ["exertion", "rest"].includes(s(p, "q10.syncope") ?? "") && palpitationsNotNow(p),
    required: [{ key: "ecg", cat: "a" }, { key: "holter", cat: "a" }, { key: "echo", cat: "a" }],
  },
  {
    id: "S25", title: "RF-10: rhythm episodes over 30 minutes",
    source: "DT P379–382 (RF-10 «same path») · registry P618–621 (Holter)",
    when: (p) => s(p, "q10.episode_duration") === "over_30" && palpitationsNotNow(p),
    required: [{ key: "holter", cat: "a" }],
    conditional: ["ecg", "echo"],
    note: "«Same path» does not say whether it means the syncope row or the irregular-rhythm row. (b)",
  },
  {
    id: "S26", title: "STOP-BANG 5–8",
    source: "DT P282–285 (PSG / HSAT · sleep physician ≤4 wk) · QJ Q8.4a · EXTERNAL",
    when: (p) => stopBangHigh(p),
    required: [{ key: "sleep-study", cat: "a", note: "Armen TC-12: keep EXTERNAL/pending-validation attribution" }],
  },
  {
    id: "S27", title: "Documented ASCVD or stroke (own diagnosis)",
    source: "DT P200–203 (SCORE2 off, direct classification) · QJ Q6.1 ASCVD|CVA (very high risk, LDL-C <1.4) · CAT D route (very high risk → Premium: Lp(a), ApoB)",
    when: (p) => condition(p, "ascvd") || condition(p, "stroke"),
    required: [],
    conditional: ["lpa", "apob"],
    note: "Phase 1 names no test beyond lipids; Lp(a) and ApoB appear only in the CAT D package route. (b)",
  },
  {
    id: "S28", title: "LDCT candidate: ≥20 pack-years, age 50–80, smoking or quit <15 years ago",
    source: "QJ Q3.3 (≥20 pack-years → LDCT flag, age 50–80) · QJ Q3.4 (quit <15 y) · CAT C.1 · EXTERNAL (USPSTF)",
    when: (p) => packYearsOf(p) >= 20 && (n(p, "q1.age") ?? 0) >= 50 && (n(p, "q1.age") ?? 0) <= 80 &&
      (["current"].includes(s(p, "q3.status") ?? "") || (formerSmoker(p) && (n(p, "q3.quit_years_ago") ?? 99) < 15)),
    required: [{ key: "ldct", cat: "b", note: "EXTERNAL, needs Clinical Board approval; no catalogue entry (audit B10)" }],
  },
  {
    id: "S29", title: "Breathlessness without known heart failure",
    source: "DT Q9.1 P385–388 · ESC HF 2023 · Armen TC-12",
    when: (p) => palpitationsNotNow(p) && s(p, "q10.breathless") === "yes" && !condition(p, "heart_failure"),
    required: [{ key: "nt-probnp", cat: "a" }, { key: "echo", cat: "a" }],
  },
];

/** STOP-BANG ≥5, read from the engine's own finding detail so no score is re-derived here. */
function stopBangHigh(p: Profile): boolean {
  const d = evaluate({ answers: p.answers, observations: [] }).findings.find((f) => f.ruleId === "NRN-RULE-APN-002");
  const score = Number(/(\d)\/8/.exec(d?.detail?.en ?? "")?.[1] ?? 0);
  return score >= 5;
}

/** Investigations the sources name for which no input exists, so no scenario can reach them. */
export const UNREACHABLE = [
  { id: "U2", title: "Lifetime Lp(a) for every adult", source: "DT P555 (Phase 2) · LP2 §5", cat: "c" as Category, note: "Phase 2 action in DT; LP2 makes it a baseline for all adults." },
  { id: "U4", title: "30-day chest-pain safety-net card with a 103 button, and the exercise-reminder interlock after syncope", source: "DT P341–343, P371, P389", cat: "b" as Category, note: "Not an investigation: the member safety holds (member_safety_ui migration, #250) open the card and the exercise pause from these answers; the engine helpers chestPainSafetyNetActive and exerciseRemindersAllowed state the same conditions. Nothing here can be ordered." },
];

/**
 * Where the lab protocol v2 and the decision tree order different things. These
 * are source conflicts, not code behaviour, so no scenario can pass or fail them.
 */
export const PROTOCOL_CONFLICTS = [
  { id: "X1", topic: "ECG for family history or smoking alone", tree: "DT P251: family sudden death <50 → ECG priority; CAT B.3: ECG for smokers and family history", protocol: "LP2 §7: smoking or family history alone is no ECG indication; baseline ECG for confirmed hypertension" },
  { id: "X2", topic: "Lp(a) for everyone", tree: "DT P253–256 family FH only at Phase 1; P555 once if never measured (Phase 2); CAT A.1 premature family CVD, Premium only", protocol: "LP2 §5: every adult at least once, not a prerequisite for BP care" },
  { id: "X3", topic: "Echocardiogram in initial hypertension work-up", tree: "DT: echo only to confirm ECG-LVH (P579), syncope (P370), breathlessness (P386)", protocol: "LP2 §7: Armenian national protocol (MoH N 74-Ն) lists TTE in the initial services" },
  { id: "X4", topic: "Uric acid and calcium in the initial hypertension list", tree: "DT basic workup not itemised; CAT A.6 uric acid via packages; calcium not listed", protocol: "LP2 §2: uric acid (Armenian national list) and calcium with TSH in the core list" },
  { id: "X5", topic: "Fasting insulin, HOMA-IR, C-peptide for BMI ≥30", tree: "CAT A.2: ordered for BMI ≥30 / metabolic syndrome", protocol: "LP2 §7: not routine; removed from automatic orders" },
  { id: "X6", topic: "Liver panel, ferritin, hs-CRP, vitamins, homocysteine, fibrinogen, antithrombin, viral PCR", tree: "CAT A.4–A.6: listed as basic workup or by indication", protocol: "LP2 §2, §7: no automatic order; only ALT before a statin" },
  { id: "X7", topic: "STOP-BANG 5–8 → sleep study", tree: "DT P283: PSG / HSAT, sleep physician ≤4 weeks", protocol: "LP2 §6: STOP-BANG guides, 5–8 is not a mandatory entry threshold" },
  { id: "X8", topic: "Asymptomatic BP ≥180/110 deadline", tree: "DT P184, RF-06: doctor ≤1 week, mandatory", protocol: "LP2 §1: same-day medical contact (local safety rule)" },
  { id: "X9", topic: "NT-proBNP trigger", tree: "QJ Q6.1: diagnosed HF; DT P385: breathlessness without HF", protocol: "LP2 §5: clinical suspicion of HF; questionnaire answers need clinical context first" },
];

// ---------------------------------------------------------------------------
// Profiles. A scenario names only what makes it different; everything else is
// a healthy answer, filled through the same visibility rules the app uses.
// ---------------------------------------------------------------------------

const ASSESSMENT_DATE = "2026-10-17";
const answer = (fieldId: string, value: FieldValue) => ({ fieldId, value, source: "manual" as const, answeredAt: `${ASSESSMENT_DATE}T09:00:00Z` });

const HEALTHY: Record<string, FieldValue> = {
  "q2.weight_perception": "ok", "q2.height": 175, "q2.weight": 70, "q2.waist": 84,
  "q2.activity": "active", "q2.activity_minutes": 180, "q2.activity_intensity": "moderate",
  "q2.diet": ["veg", "fruit", "fish", "nuts", "meat", "grain", "salt"],
  "q3.status": "never", "q4.frequency": "never",
  "q5.diagnosed": "no", "q5.last_reading.systolic": 112, "q5.last_reading.diastolic": 68,
  "q6.conditions": ["none"], "q7.relatives": ["none"],
  "q8.sleep_quality": 8, "q8.sleep_hours": 7, "q8.stress": "sometimes",
  "q9.present": "no", "q10.symptoms": "no",
};

/** Benign defaults for clarifiers a scenario opened but did not set. */
const BENIGN = ["no", "none", "never", "same", "rare", "seconds", "later", "strong", "sometimes", "moderate", "monthly_or_less", "one_two", "beer"];

function fill(age: number, sex: "male" | "female", overrides: Record<string, FieldValue>): Answers {
  let a: Answers = {};
  const set = (values: Record<string, FieldValue>) => { for (const [id, value] of Object.entries(values)) a[id] = answer(id, value); };
  set({ "q1.age": age, "q1.sex": sex, ...HEALTHY, ...(sex === "female" ? { "q2.waist": 76 } : {}), ...overrides });
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const field of activeFields(a)) {
      if (fieldComplete(field, a)) continue;
      // A scenario's own answer that the questionnaire refuses is a mistake in
      // the scenario, not something to paper over with a benign default.
      if (Object.keys(overrides).some((id) => id === field.id || id.startsWith(`${field.id}.`))) throw Error(`Scenario override for ${field.id} is not a complete answer`);
      changed = true;
      if (field.kind === "blood-pressure") set({ [`${field.id}.systolic`]: 112, [`${field.id}.diastolic`]: 68 });
      else if (field.kind === "number" || field.kind === "scale") set({ [field.id]: field.min ?? 1 });
      else {
        const option = field.options?.find((o) => BENIGN.includes(o.value))?.value ?? field.options?.[0]?.value;
        if (option) set({ [field.id]: field.kind === "multi" ? [option] : option });
      }
    }
    a = pruneAnswers(a);
    if (!changed) break;
  }
  if (!assessmentProgress(a).complete) throw Error(`Scenario at age ${age} did not produce a complete questionnaire`);
  return a;
}

/**
 * What the sources say about the route. `triage` is the colour; `triageCat`
 * marks a source ambiguity (b). `windowDays` is the consultation deadline in
 * days, a single number or a [min, max] range the source gives (RF-07: 24–48 h
 * is [1, 2]). `rules` must fire; `noRules` must not.
 */
type Route = { triage: Urgency; triageCat?: "b"; triageNote?: string; windowDays?: number | [number, number]; windowNote?: string; rules?: string[]; noRules?: string[] };
type Scenario = { id: string; title: string; age: number; sex: "male" | "female"; answers: Record<string, FieldValue> } & Route;

const BP = (systolic: number | typeof UNKNOWN, diastolic?: number) =>
  systolic === UNKNOWN ? { "q5.last_reading.systolic": UNKNOWN, "q5.last_reading.diastolic": UNKNOWN }
    : { "q5.last_reading.systolic": systolic, "q5.last_reading.diastolic": diastolic! };

export const SCENARIOS: Scenario[] = [
  // --- The 52 audit profiles, now with the route the sources give each one. ---
  { id: "M01", title: "Healthy 45-year-old man, all normal", age: 45, sex: "male", answers: {}, triage: "green", windowDays: 365, noRules: ["NRN-RULE-BP-004", "NRN-RULE-BP-002"] },
  { id: "M02", title: "Healthy 28-year-old woman", age: 28, sex: "female", answers: {}, triage: "green", windowDays: 365 },
  { id: "M03", title: "Healthy 74-year-old man", age: 74, sex: "male", answers: {}, triage: "green", windowDays: 365 },
  { id: "M04", title: "BP 132/84 is not elevated, otherwise healthy, 52 m", age: 52, sex: "male", answers: BP(132, 84), triage: "green", triageNote: "Armen, team group message 588, 2 Nov: below the 135/85 yellow cut", noRules: ["NRN-RULE-BP-004", "NRN-RULE-BP-002"] },
  { id: "M05", title: "Grade 1 BP 148/92, no diagnosis, 50 m", age: 50, sex: "male", answers: BP(148, 92), triage: "yellow", windowDays: 14, windowNote: "DT P176 doctor ≤2 weeks", rules: ["NRN-RULE-BP-002"], noRules: ["NRN-RULE-BP-004", "RF-06"] },
  { id: "M06", title: "Grade 1 BP diastolic only 128/94, 39 f", age: 39, sex: "female", answers: BP(128, 94), triage: "yellow", windowDays: 14, rules: ["NRN-RULE-BP-002"], noRules: ["NRN-RULE-BP-004"] },
  { id: "M07", title: "Grade 2 BP 168/102, no diagnosis, 58 f", age: 58, sex: "female", answers: BP(168, 102), triage: "yellow", windowDays: 7, windowNote: "DT P179 doctor ≤1 week (QJ Q5.2 says 2–4 weeks for 140–179: DT wins)", rules: ["NRN-RULE-BP-002"] },
  { id: "M08", title: "Grade 3 BP 186/112, no symptoms (RF-06), 61 m", age: 61, sex: "male", answers: { ...BP(186, 112), "q5.crisis_symptoms": ["none"] }, triage: "orange", windowDays: 0, windowNote: "2 Nov: either number gives the same day, replacing DT P184 ≤1 week; QJ emergencyProtocol: visit date per RF (24 h / 48 h / 7 d)", rules: ["RF-06"], noRules: ["RF-03", "NRN-RULE-BP-002"] },
  { id: "M09", title: "Grade 3 BP 190/115 with headache (RF-03), 66 m", age: 66, sex: "male", answers: { ...BP(190, 115), "q5.crisis_symptoms": ["headache"] }, triage: "red", rules: ["RF-03"], noRules: ["RF-06"] },
  { id: "M10", title: "BP 182/100 with speech problem (RF-04), 70 f", age: 70, sex: "female", answers: { ...BP(182, 100), "q5.crisis_symptoms": ["neuro"] }, triage: "red", rules: ["RF-03", "RF-04"] },
  { id: "M11", title: "Last BP not known, 47 m", age: 47, sex: "male", answers: BP(UNKNOWN), triage: "yellow", triageNote: "QJ Q5.1 idk tone warn; DT P187 HBPM", rules: ["NRN-RULE-BP-003"] },
  { id: "M12", title: "Known HTN on treatment, controlled 128/78, 63 m", age: 63, sex: "male", answers: { "q5.diagnosed": "treated", ...BP(128, 78) }, triage: "green", triageNote: "QJ Q5.1 tx tone info", rules: ["NRN-RULE-HTN-002"], noRules: ["NRN-RULE-BP-004", "NRN-RULE-BP-002"] },
  { id: "M13", title: "Known HTN on treatment, uncontrolled 152/94, 60 f", age: 60, sex: "female", answers: { "q5.diagnosed": "treated", ...BP(152, 94) }, triage: "yellow", windowDays: 14, rules: ["NRN-RULE-BP-002", "NRN-RULE-HTN-002"] },
  { id: "M14", title: "Known HTN, not treated, reading 136/86, 55 m", age: 55, sex: "male", answers: { "q5.diagnosed": "untreated", ...BP(136, 86) }, triage: "yellow", rules: ["NRN-RULE-HTN-001"], noRules: ["NRN-RULE-BP-004"] },
  { id: "M15", title: "Known HTN on treatment, BP not known, 68 f", age: 68, sex: "female", answers: { "q5.diagnosed": "treated", ...BP(UNKNOWN) }, triage: "yellow", rules: ["NRN-RULE-BP-003", "NRN-RULE-HTN-002"] },
  { id: "M16", title: "Type 2 diabetes 6 y, HbA1c 6.8, 57 m", age: 57, sex: "male", answers: { "q6.conditions": ["diabetes"], "q6.diabetes_years": 6, "q6.hba1c": 6.8 }, triage: "yellow", rules: ["NRN-RULE-DM-005"], noRules: ["NRN-RULE-DM-001", "NRN-RULE-DM-002", "NRN-RULE-DM-003", "NRN-RULE-DM-004", "RF-11"] },
  { id: "M17", title: "Diabetes, HbA1c not known, 49 f", age: 49, sex: "female", answers: { "q6.conditions": ["diabetes"], "q6.diabetes_years": 3, "q6.hba1c": UNKNOWN }, triage: "yellow", rules: ["NRN-RULE-DM-004", "NRN-RULE-DM-005"] },
  { id: "M18", title: "Diabetes 12 y, HbA1c 7.6, 64 m", age: 64, sex: "male", answers: { "q6.conditions": ["diabetes"], "q6.diabetes_years": 12, "q6.hba1c": 7.6 }, triage: "yellow", windowDays: 28, windowNote: "DT P226: HbA1c ≥7.0% → doctor ≤4 weeks (QJ Q6.2e: 2–4 weeks)", rules: ["NRN-RULE-DM-001", "NRN-RULE-DM-002"] },
  { id: "M19", title: "Diabetes, HbA1c 9.4 (RF-11), 53 m", age: 53, sex: "male", answers: { "q6.conditions": ["diabetes"], "q6.diabetes_years": 8, "q6.hba1c": 9.4 }, triage: "orange", windowDays: 7, windowNote: "DT P229, P622: doctor ≤7 days; QJ emergencyProtocol per-RF visit date", rules: ["RF-11"], noRules: ["NRN-RULE-DM-002"] },
  { id: "M20", title: "Prediabetes, BMI 27, 46 f", age: 46, sex: "female", answers: { "q6.conditions": ["prediabetes"], "q2.height": 165, "q2.weight": 74 }, triage: "yellow", triageCat: "b", triageNote: "QJ Q2.2 BMI 25–29.9 tone yellow but DT P73 calls it a preventive message; prediabetes has no branch", rules: ["NRN-RULE-DM-006", "NRN-RULE-ANT-004"] },
  { id: "M21", title: "Chronic kidney disease, BP 134/82, 62 m", age: 62, sex: "male", answers: { "q6.conditions": ["kidney"], ...BP(134, 82) }, triage: "yellow", rules: ["NRN-RULE-CKD-001"] },
  { id: "M22", title: "Previous heart attack / stent, 66 m", age: 66, sex: "male", answers: { "q6.conditions": ["ascvd"] }, triage: "green", triageCat: "b", triageNote: "QJ Q6.1 ASCVD tone red names the risk category (very high), not a red flag; no Phase 1 branch lifts triage, so documented disease reads as «Stable» (for Armen)" },
  { id: "M23", title: "Previous stroke, known HTN treated 138/84, 71 f", age: 71, sex: "female", answers: { "q6.conditions": ["stroke"], "q5.diagnosed": "treated", ...BP(138, 84) }, triage: "green", triageCat: "b", triageNote: "as M22", rules: ["NRN-RULE-HTN-002"] },
  { id: "M24", title: "Diagnosed heart failure, 72 m", age: 72, sex: "male", answers: { "q6.conditions": ["heart_failure"] }, triage: "yellow", rules: ["NRN-RULE-CMB-001"] },
  { id: "M25", title: "Diagnosed atrial fibrillation, 69 f", age: 69, sex: "female", answers: { "q6.conditions": ["af"] }, triage: "yellow", rules: ["NRN-RULE-CMB-002"] },
  { id: "M26", title: "Own familial hypercholesterolaemia, 35 m", age: 35, sex: "male", answers: { "q6.conditions": ["familial_hypercholesterolaemia"] }, triage: "yellow", triageCat: "b", triageNote: "QJ Q6.1 FH tone yellow (high risk, genetic counselling); the app maps it to score2State only, no finding, so the member reads «Stable» (for Armen)" },
  { id: "M27", title: "Mother has inherited high cholesterol, 33 f", age: 33, sex: "female", answers: { "q7.relatives": ["familial_hypercholesterolaemia"] }, triage: "yellow", rules: ["NRN-RULE-FAM-002"], noRules: ["NRN-RULE-FAM-001"] },
  { id: "M28", title: "Father heart attack at 52, 44 m", age: 44, sex: "male", answers: { "q7.relatives": ["cad"], "q7.relative_age": "male_under_55" }, triage: "yellow", rules: ["NRN-RULE-FAM-001"] },
  { id: "M29", title: "Grandfather heart attack at 80 (not premature), 50 m", age: 50, sex: "male", answers: { "q7.relatives": ["cad"], "q7.relative_age": "later" }, triage: "green", noRules: ["NRN-RULE-FAM-001", "NRN-RULE-FAM-002"] },
  { id: "M30", title: "Brother died suddenly at 38, no symptoms, 36 m", age: 36, sex: "male", answers: { "q7.relatives": ["sudden_death"], "q7.relative_age": "male_under_55" }, triage: "yellow", rules: ["NRN-RULE-FAM-001"], noRules: ["RF-12"] },
  { id: "M31", title: "Family sudden death <50 + palpitations (RF-12), 41 f", age: 41, sex: "female", answers: { "q7.relatives": ["sudden_death"], "q7.relative_age": "male_under_55", "q10.symptoms": "palpitations_only" }, triage: "orange", windowDays: [1, 7], rules: ["RF-12", "NRN-RULE-PAL-002"] },
  { id: "M32", title: "Current smoker 20/day × 25 y (25 pack-years), 54 m", age: 54, sex: "male", answers: { "q3.status": "current", "q3.years": 25, "q3.per_day": 20 }, triage: "yellow", rules: ["NRN-RULE-SMK-001", "NRN-RULE-SMK-002"] },
  { id: "M33", title: "Light smoker 5/day × 4 y, 26 f", age: 26, sex: "female", answers: { "q3.status": "current", "q3.years": 4, "q3.per_day": 5 }, triage: "yellow", rules: ["NRN-RULE-SMK-001"], noRules: ["NRN-RULE-SMK-002"] },
  { id: "M34", title: "Former smoker quit 2 y ago, 48 m", age: 48, sex: "male", answers: { "q3.status": "former", "q3.years": 15, "q3.per_day": 10, "q3.quit_years_ago": 2 }, triage: "green", triageCat: "b", triageNote: "DT P152 «risk still falling» and QJ Q3.1 former tone info: a message, not a visit; the app's NRN-RULE-SMK-003 is yellow (for Armen)", rules: ["NRN-RULE-SMK-003"], noRules: ["NRN-RULE-SMK-001", "NRN-RULE-OK-006"] },
  { id: "M35", title: "Obesity BMI 33, waist not above 102, 42 m", age: 42, sex: "male", answers: { "q2.height": 178, "q2.weight": 105, "q2.waist": 100 }, triage: "yellow", rules: ["NRN-RULE-ANT-002"], noRules: ["NRN-RULE-ANT-001", "NRN-RULE-ANT-004"] },
  { id: "M36", title: "Overweight BMI 27, normal waist, 51 f", age: 51, sex: "female", answers: { "q2.height": 162, "q2.weight": 71, "q2.waist": 84 }, triage: "yellow", triageCat: "b", triageNote: "as M20: QJ tone yellow vs DT P73 preventive message", rules: ["NRN-RULE-ANT-004"], noRules: ["NRN-RULE-ANT-002"] },
  { id: "M37", title: "Waist 106 cm, BMI 29, 47 m", age: 47, sex: "male", answers: { "q2.height": 176, "q2.weight": 90, "q2.waist": 106 }, triage: "yellow", rules: ["NRN-RULE-ANT-001", "NRN-RULE-ANT-004"] },
  { id: "M38", title: "Sedentary, otherwise healthy, 40 f", age: 40, sex: "female", answers: { "q2.activity": "sedentary" }, triage: "yellow", rules: ["NRN-RULE-ACT-001"], noRules: ["NRN-RULE-ACT-002"] },
  { id: "M39", title: "Stable chest pain on exertion, not now, 58 m", age: 58, sex: "male", answers: { "q9.present": "yes", "q9.right_now": "no", "q9.frequency": "monthly", "q9.crescendo": "same", "q9.at_rest": "no", "q9.duration": "1_5" }, triage: "yellow", windowDays: 14, windowNote: "DT P339 cardiologist ≤2 weeks", rules: ["NRN-RULE-CP-002"], noRules: ["RF-07", "RF-01", "NRN-RULE-OK-001"] },
  { id: "M40", title: "Worsening chest pain, not now (RF-07), 62 m", age: 62, sex: "male", answers: { "q9.present": "yes", "q9.right_now": "no", "q9.frequency": "weekly", "q9.crescendo": "worse", "q9.at_rest": "no", "q9.duration": "5_15" }, triage: "orange", windowDays: [1, 2], windowNote: "DT P336, P610: cardiologist 24–48 h", rules: ["RF-07"], noRules: ["NRN-RULE-CP-002"] },
  { id: "M41", title: "Chest pain right now (RF-01), 59 m", age: 59, sex: "male", answers: { "q9.present": "yes", "q9.right_now": "yes" }, triage: "red", rules: ["RF-01"], noRules: ["NRN-RULE-CP-002", "RF-07"] },
  { id: "M42", title: "Unsure about chest pain, not now, short, 44 f", age: 44, sex: "female", answers: { "q9.present": "unsure", "q9.right_now": "no", "q9.frequency": "rare", "q9.crescendo": "same", "q9.at_rest": "no", "q9.duration": "seconds" }, triage: "yellow", windowDays: 14, rules: ["NRN-RULE-CP-002"] },
  { id: "M43", title: "Palpitations only, short and rare, 31 f", age: 31, sex: "female", answers: { "q10.symptoms": "palpitations_only", "q10.syncope": "never", "q10.rhythm": "fast_regular", "q10.episode_duration": "under_5" }, triage: "yellow", rules: ["NRN-RULE-PAL-002"], noRules: ["NRN-RULE-PAL-003", "RF-10"] },
  { id: "M44", title: "Palpitations + dizziness, not now, irregular, 57 m", age: 57, sex: "male", answers: { "q10.symptoms": "yes", "q10.right_now": "no", "q10.syncope": "never", "q10.rhythm": "irregular", "q10.episode_duration": "5_30" }, triage: "yellow", rules: ["NRN-RULE-PAL-002", "NRN-RULE-PAL-003"], noRules: ["RF-02"] },
  { id: "M45", title: "Fainting on exertion (RF-08), 24 m", age: 24, sex: "male", answers: { "q10.symptoms": "yes", "q10.right_now": "no", "q10.syncope": "exertion", "q10.rhythm": "fast_regular", "q10.episode_duration": "under_5" }, triage: "orange", windowDays: [1, 3], windowNote: "DT P370: ECG ≤24 h, arrhythmologist 2–3 days", rules: ["RF-08"], noRules: ["RF-09", "NRN-RULE-OK-007"] },
  { id: "M46", title: "Fainting without warning (RF-09), 67 f", age: 67, sex: "female", answers: { "q10.symptoms": "yes", "q10.right_now": "no", "q10.syncope": "rest", "q10.rhythm": "strong", "q10.episode_duration": "seconds" }, triage: "orange", windowDays: [1, 3], rules: ["RF-09"], noRules: ["RF-08"] },
  { id: "M47", title: "Rhythm episodes >30 min (RF-10), 61 m", age: 61, sex: "male", answers: { "q10.symptoms": "palpitations_only", "q10.syncope": "never", "q10.rhythm": "fast_regular", "q10.episode_duration": "over_30" }, triage: "orange", windowDays: [1, 7], windowNote: "DT gives no deadline for RF-10; QJ orange is 24 h – 7 days", rules: ["RF-10", "NRN-RULE-PAL-002"] },
  { id: "M48", title: "Palpitations + dizziness right now (RF-02), 50 f", age: 50, sex: "female", answers: { "q10.symptoms": "yes", "q10.right_now": "yes" }, triage: "red", rules: ["RF-02"], noRules: ["NRN-RULE-PAL-002"] },
  { id: "M49", title: "Loud snoring + apnoea + sleepy, BMI 37, neck 44, HTN 150/95, 56 m (STOP-BANG high)", age: 56, sex: "male", answers: { "q8.sleep_quality": 4, "q8.sleep_hours": 5, "q8.breathing": "both", "q8.daytime_sleepiness": "daily", "q8.neck": 44, "q2.height": 175, "q2.weight": 113, "q2.waist": 118, ...BP(150, 95) }, triage: "yellow", windowDays: 14, rules: ["NRN-RULE-APN-002", "NRN-RULE-SLP-001", "NRN-RULE-SLP-002", "NRN-RULE-BP-002", "NRN-RULE-ANT-001", "NRN-RULE-ANT-002"] },
  { id: "M50", title: "Heavy weekly binge drinking (AUDIT-C priority), 38 m", age: 38, sex: "male", answers: { "q4.frequency": "four_plus_week", "q4.drinks_per_day": "seven_nine", "q4.binge": "weekly", "q4.drink_type": "spirits", "q4.volume_ml": 150 }, triage: "orange", windowDays: [1, 7], rules: ["NRN-RULE-ALC-003"], noRules: ["NRN-RULE-ALC-001", "NRN-RULE-ALC-002"] },
  { id: "M51", title: "Typical pilot member: 58 m, treated HTN 146/90, smoker, BMI 31, father MI at 50, diabetes HbA1c unknown", age: 58, sex: "male",
    answers: { "q5.diagnosed": "treated", ...BP(146, 90), "q3.status": "current", "q3.years": 30, "q3.per_day": 15, "q2.height": 172, "q2.weight": 92, "q2.waist": 104,
      "q6.conditions": ["diabetes"], "q6.diabetes_years": 5, "q6.hba1c": UNKNOWN, "q7.relatives": ["cad"], "q7.relative_age": "male_under_55" },
    triage: "yellow", windowDays: 14, rules: ["NRN-RULE-BP-002", "NRN-RULE-HTN-002", "NRN-RULE-SMK-001", "NRN-RULE-SMK-002", "NRN-RULE-ANT-001", "NRN-RULE-ANT-002", "NRN-RULE-DM-004", "NRN-RULE-DM-005", "NRN-RULE-FAM-001"] },
  { id: "M52", title: "Elderly 78 f, treated HTN 142/80, AF, CKD", age: 78, sex: "female", answers: { "q5.diagnosed": "treated", ...BP(142, 80), "q6.conditions": ["af", "kidney"] }, triage: "yellow", windowDays: 14, rules: ["NRN-RULE-BP-002", "NRN-RULE-HTN-002", "NRN-RULE-CMB-002", "NRN-RULE-CKD-001"] },

  // --- Branches the audit did not reach: boundaries, combinations, every clarifier. ---
  { id: "M53", title: "Does not know if ever diagnosed, reading 150/95, 49 f", age: 49, sex: "female", answers: { "q5.diagnosed": UNKNOWN, ...BP(150, 95) }, triage: "yellow", windowDays: 14, rules: ["NRN-RULE-BP-002"], noRules: ["NRN-RULE-BP-003", "NRN-RULE-HTN-001", "NRN-RULE-HTN-002"] },
  { id: "M54", title: "Does not know if ever diagnosed, reading unknown, 52 m", age: 52, sex: "male", answers: { "q5.diagnosed": UNKNOWN, ...BP(UNKNOWN) }, triage: "yellow", rules: ["NRN-RULE-BP-003"], noRules: ["NRN-RULE-BP-002", "NRN-RULE-BP-004"] },
  { id: "M55", title: "Known HTN, not treated, 184/108 without symptoms (RF-06 + untreated), 59 m", age: 59, sex: "male", answers: { "q5.diagnosed": "untreated", ...BP(184, 108), "q5.crisis_symptoms": ["none"] }, triage: "orange", windowDays: 0, windowNote: "as M08", rules: ["RF-06", "NRN-RULE-HTN-001"], noRules: ["NRN-RULE-BP-002"] },
  { id: "M56", title: "Treated HTN 182/112 with vision change (RF-03), 64 f", age: 64, sex: "female", answers: { "q5.diagnosed": "treated", ...BP(182, 112), "q5.crisis_symptoms": ["vision"] }, triage: "red", rules: ["RF-03"], noRules: ["RF-06", "RF-04", "RF-05"] },
  { id: "M57", title: "Seizure at 185/100 (RF-03 + RF-05), 48 m", age: 48, sex: "male", answers: { ...BP(185, 100), "q5.crisis_symptoms": ["seizure"] }, triage: "red", rules: ["RF-03", "RF-05"] },
  { id: "M59", title: "Diabetes 4 y, HbA1c unknown, BP 150/95, BMI 28 (HbA1c once, not twice), 54 m", age: 54, sex: "male", answers: { "q6.conditions": ["diabetes"], "q6.diabetes_years": 4, "q6.hba1c": UNKNOWN, ...BP(150, 95), "q2.height": 175, "q2.weight": 86 }, triage: "yellow", windowDays: 14, rules: ["NRN-RULE-DM-004", "NRN-RULE-DM-005", "NRN-RULE-BP-002", "NRN-RULE-ANT-004"] },
  { id: "M60", title: "Former heavy smoker, 30 pack-years, quit 10 y ago (LDCT candidate), 62 m", age: 62, sex: "male", answers: { "q3.status": "former", "q3.years": 30, "q3.per_day": 20, "q3.quit_years_ago": 10 }, triage: "yellow", triageNote: "QJ Q3.3 ≥20 pack-years tone yellow (note to clinician); DT P153 counts him as a non-smoker", rules: ["NRN-RULE-OK-006", "NRN-RULE-SMK-002"], noRules: ["NRN-RULE-SMK-001", "NRN-RULE-SMK-003"] },
  { id: "M61", title: "Electronic or heated tobacco, 30 f", age: 30, sex: "female", answers: { "q3.status": "alternative", "q3.years": 3 }, triage: "yellow", triageNote: "QJ Q3.1 alt tone warn; DT P156 counted as a smoker", rules: ["NRN-RULE-SMK-001"], noRules: ["NRN-RULE-SMK-002"] },
  { id: "M62", title: "Snoring, not sleepy, neck 42, age 55 (STOP-BANG 3–4), 55 m", age: 55, sex: "male", answers: { "q8.sleep_quality": 5, "q8.breathing": "snoring", "q8.daytime_sleepiness": "sometimes", "q8.neck": 42 }, triage: "yellow", windowDays: 14, windowNote: "DT P286: sleep diary 2 weeks, discuss with doctor", rules: ["NRN-RULE-APN-001"], noRules: ["NRN-RULE-SLP-001"] },
  { id: "M63", title: "Stress always, otherwise healthy, 38 f", age: 38, sex: "female", answers: { "q8.stress": "always" }, triage: "yellow", rules: ["NRN-RULE-STR-001"] },
  { id: "M64", title: "Activity limited for health reasons, 66 m", age: 66, sex: "male", answers: { "q2.activity": "limited" }, triage: "yellow", triageNote: "QJ Q2.3 D tone warn: physiotherapist referral", rules: ["NRN-RULE-ACT-002"], noRules: ["NRN-RULE-ACT-001"] },
  { id: "M65", title: "Occasional activity, 90 minutes moderate a week, 35 m", age: 35, sex: "male", answers: { "q2.activity": "occasional", "q2.activity_minutes": 90, "q2.activity_intensity": "moderate" }, triage: "yellow", rules: ["NRN-RULE-ACT-001"] },
  { id: "M66", title: "Occasional activity, 80 minutes vigorous a week (counts double), 35 f", age: 35, sex: "female", answers: { "q2.activity": "occasional", "q2.activity_minutes": 80, "q2.activity_intensity": "vigorous" }, triage: "green", noRules: ["NRN-RULE-ACT-001"] },
  { id: "M67", title: "Underweight BMI 17.5, 29 f", age: 29, sex: "female", answers: { "q2.height": 165, "q2.weight": 48, "q2.waist": 66 }, triage: "yellow", triageNote: "QJ Q2.2 BMI <18.5 tone warn: dietitian", rules: ["NRN-RULE-ANT-003"], noRules: ["NRN-RULE-ANT-004", "NRN-RULE-ANT-002", "NRN-RULE-ANT-001"] },
  { id: "M68", title: "Waist 96 cm (mild threshold), BMI 24, 50 m", age: 50, sex: "male", answers: { "q2.height": 180, "q2.weight": 78, "q2.waist": 96 }, triage: "green", triageNote: "DT P79 mild threshold is a «no more weight» message; QJ tone yellow (as M20)", triageCat: "b", noRules: ["NRN-RULE-ANT-001", "NRN-RULE-ANT-004"] },
  { id: "M69", title: "Woman, waist 90 cm (≥88), BMI 23, 44 f", age: 44, sex: "female", answers: { "q2.height": 168, "q2.weight": 65, "q2.waist": 90 }, triage: "yellow", rules: ["NRN-RULE-ANT-001"], noRules: ["NRN-RULE-ANT-004"] },
  { id: "M70", title: "Poor diet, 2 of 8 components, 35 m", age: 35, sex: "male", answers: { "q2.diet": ["veg", "fruit"] }, triage: "yellow", rules: ["NRN-RULE-DIET-001"], noRules: ["NRN-RULE-DIET-002", "NRN-RULE-OK-005"] },
  { id: "M71", title: "Middling diet, 5 of 8 components, 35 f", age: 35, sex: "female", answers: { "q2.diet": ["veg", "fruit", "fish", "nuts", "grain"] }, triage: "yellow", rules: ["NRN-RULE-DIET-002"], noRules: ["NRN-RULE-DIET-001"] },
  { id: "M72", title: "Sleeps 5 hours, good quality, 41 m", age: 41, sex: "male", answers: { "q8.sleep_hours": 5 }, triage: "yellow", rules: ["NRN-RULE-SLP-002"], noRules: ["NRN-RULE-OK-004"] },
  { id: "M73", title: "Daily sleepiness with snoring, young and slim (STOP-BANG low), 30 f", age: 30, sex: "female", answers: { "q8.sleep_quality": 5, "q8.breathing": "snoring", "q8.daytime_sleepiness": "daily", "q8.neck": 34 }, triage: "yellow", rules: ["NRN-RULE-SLP-001"], noRules: ["NRN-RULE-APN-001"] },
  { id: "M74", title: "AUDIT-C positive without weekly binges, 46 m", age: 46, sex: "male", answers: { "q4.frequency": "two_to_three_week", "q4.drinks_per_day": "three_four", "q4.binge": "monthly", "q4.drink_type": "wine", "q4.volume_ml": 200 }, triage: "yellow", rules: ["NRN-RULE-ALC-002"], noRules: ["NRN-RULE-ALC-003", "NRN-RULE-ALC-001"] },
  { id: "M75", title: "Light drinker below the AUDIT-C cut-off, 52 f", age: 52, sex: "female", answers: { "q4.frequency": "monthly_or_less", "q4.drinks_per_day": "one_two", "q4.binge": "never", "q4.drink_type": "wine", "q4.volume_ml": 150 }, triage: "green", rules: ["NRN-RULE-ALC-001"], noRules: ["NRN-RULE-ALC-002", "NRN-RULE-ALC-004", "NRN-RULE-OK-008"] },
  { id: "M76", title: "Chest pain at rest, not now (RF-07 via rest pain), 60 f", age: 60, sex: "female", answers: { "q9.present": "yes", "q9.right_now": "no", "q9.frequency": "monthly", "q9.crescendo": "same", "q9.at_rest": "yes", "q9.duration": "1_5" }, triage: "orange", windowDays: [1, 2], rules: ["RF-07"], noRules: ["NRN-RULE-CP-002"] },
  { id: "M77", title: "Chest pain lasting over 15 minutes, rare (RF-07 via duration), 57 m", age: 57, sex: "male", answers: { "q9.present": "yes", "q9.right_now": "no", "q9.frequency": "rare", "q9.crescendo": "same", "q9.at_rest": "no", "q9.duration": "over_15" }, triage: "orange", windowDays: [1, 2], rules: ["RF-07"], noRules: ["NRN-RULE-CP-002"] },
  { id: "M78", title: "Chest pain every day, otherwise stable (RF-07 via frequency), 63 m", age: 63, sex: "male", answers: { "q9.present": "yes", "q9.right_now": "no", "q9.frequency": "daily", "q9.crescendo": "same", "q9.at_rest": "no", "q9.duration": "1_5" }, triage: "orange", windowDays: [1, 2], rules: ["RF-07"], noRules: ["NRN-RULE-CP-002"] },
  { id: "M79", title: "Unsure about chest pain, and has it right now (RF-01), 49 f", age: 49, sex: "female", answers: { "q9.present": "unsure", "q9.right_now": "yes" }, triage: "red", rules: ["RF-01"], noRules: ["NRN-RULE-CP-002"] },
  { id: "M80", title: "Palpitations with dizziness, not now, vasovagal faint once, 29 f", age: 29, sex: "female", answers: { "q10.symptoms": "yes", "q10.right_now": "no", "q10.syncope": "vasovagal", "q10.rhythm": "fast_regular", "q10.episode_duration": "under_5" }, triage: "yellow", rules: ["NRN-RULE-PAL-002", "NRN-RULE-OK-007"], noRules: ["RF-08", "RF-09", "RF-02"] },
  { id: "M81", title: "Palpitations only, irregular and over 30 minutes (RF-10 + irregular), 66 m", age: 66, sex: "male", answers: { "q10.symptoms": "palpitations_only", "q10.syncope": "never", "q10.rhythm": "irregular", "q10.episode_duration": "over_30" }, triage: "orange", windowDays: [1, 7], rules: ["RF-10", "NRN-RULE-PAL-003", "NRN-RULE-PAL-002"] },
  { id: "M82", title: "Fainting on exertion with an irregular rhythm (RF-08 + irregular), 33 m", age: 33, sex: "male", answers: { "q10.symptoms": "yes", "q10.right_now": "no", "q10.syncope": "exertion", "q10.rhythm": "irregular", "q10.episode_duration": "5_30" }, triage: "orange", windowDays: [1, 3], rules: ["RF-08", "NRN-RULE-PAL-003"] },
  { id: "M83", title: "Family sudden death + dizziness with palpitations, not now (RF-12 via «yes»), 45 m", age: 45, sex: "male", answers: { "q7.relatives": ["sudden_death"], "q7.relative_age": "later", "q10.symptoms": "yes", "q10.right_now": "no", "q10.syncope": "never", "q10.rhythm": "fast_regular", "q10.episode_duration": "under_5" }, triage: "orange", windowDays: [1, 7], rules: ["RF-12", "NRN-RULE-PAL-002"], noRules: ["NRN-RULE-FAM-001"] },
  { id: "M84", title: "Family sudden death, relative's age unknown, no symptoms, 52 f", age: 52, sex: "female", answers: { "q7.relatives": ["sudden_death"], "q7.relative_age": UNKNOWN }, triage: "green", triageNote: "the option itself says «before 50» (Q7.1); Q7.2 unknown applies no modifier (QJ Q7.2 idk). DT P251 ECG priority is C14", noRules: ["NRN-RULE-FAM-001", "RF-12"] },
  { id: "M85", title: "Mother's stroke before 65 (premature), 47 f", age: 47, sex: "female", answers: { "q7.relatives": ["stroke"], "q7.relative_age": "female_under_65" }, triage: "yellow", rules: ["NRN-RULE-FAM-001"] },
  { id: "M86", title: "Own FH and a parent with FH, 40 m", age: 40, sex: "male", answers: { "q6.conditions": ["familial_hypercholesterolaemia"], "q7.relatives": ["familial_hypercholesterolaemia"] }, triage: "yellow", rules: ["NRN-RULE-FAM-002"] },
  { id: "M87", title: "18-year-old man, BP 142/90", age: 18, sex: "male", answers: BP(142, 90), triage: "yellow", windowDays: 14, rules: ["NRN-RULE-BP-002"] },
  { id: "M88", title: "Diabetes HbA1c 7.5 with BP 162/98 (grade 2 keeps the one-week window), 61 f", age: 61, sex: "female", answers: { "q6.conditions": ["diabetes"], "q6.diabetes_years": 7, "q6.hba1c": 7.5, ...BP(162, 98) }, triage: "yellow", windowDays: 7, rules: ["NRN-RULE-DM-002", "NRN-RULE-BP-002", "NRN-RULE-DM-005"] },
  { id: "M89", title: "HbA1c 9.5 and BP 184/104 without symptoms (RF-11 + RF-06), 58 m", age: 58, sex: "male", answers: { "q6.conditions": ["diabetes"], "q6.diabetes_years": 9, "q6.hba1c": 9.5, ...BP(184, 104), "q5.crisis_symptoms": ["none"] }, triage: "orange", windowDays: 0, windowNote: "as M08 and M19", rules: ["RF-11", "RF-06", "NRN-RULE-DM-005"] },
  { id: "M90", title: "Weekly binges and BP 150/95 (orange with the hypertension workup), 44 m", age: 44, sex: "male", answers: { "q4.frequency": "four_plus_week", "q4.drinks_per_day": "seven_nine", "q4.binge": "weekly", "q4.drink_type": "spirits", "q4.volume_ml": 150, ...BP(150, 95) }, triage: "orange", windowDays: [1, 7], rules: ["NRN-RULE-ALC-003", "NRN-RULE-BP-002"] },
  { id: "M91", title: "BP 139/90: grade 1 by the diastolic alone, 44 f", age: 44, sex: "female", answers: BP(139, 90), triage: "yellow", windowDays: 14, rules: ["NRN-RULE-BP-002"], noRules: ["NRN-RULE-BP-004"] },
  { id: "M92", title: "BP 135/69: elevated by the systolic alone, 30 m", age: 30, sex: "male", answers: BP(135, 69), triage: "yellow", triageCat: "b", triageNote: "Armen, team group message 588, 2 Nov: either number starts yellow", rules: ["NRN-RULE-BP-004"], noRules: ["NRN-RULE-BP-002"] },
  { id: "M93", title: "BP 119/85: elevated by the diastolic alone, 30 f", age: 30, sex: "female", answers: BP(119, 85), triage: "yellow", triageCat: "b", triageNote: "Armen, team group message 588, 2 Nov: either number starts yellow", rules: ["NRN-RULE-BP-004"], noRules: ["NRN-RULE-BP-002"] },
  { id: "M94", title: "BP 119/69: not elevated, 30 m", age: 30, sex: "male", answers: BP(119, 69), triage: "green", noRules: ["NRN-RULE-BP-004", "NRN-RULE-BP-002", "NRN-RULE-BP-003"] },
  { id: "M95", title: "BP 180/109 without symptoms: crisis by the systolic alone, 50 m", age: 50, sex: "male", answers: { ...BP(180, 109), "q5.crisis_symptoms": ["none"] }, triage: "orange", windowDays: 0, windowNote: "as M08", rules: ["RF-06"], noRules: ["NRN-RULE-BP-002"] },
  { id: "M96", title: "BP 179/110 without symptoms: crisis by the diastolic alone, 50 f", age: 50, sex: "female", answers: { ...BP(179, 110), "q5.crisis_symptoms": ["none"] }, triage: "orange", windowDays: 2, windowNote: "as M08", rules: ["RF-06"], noRules: ["NRN-RULE-BP-002"] },
  { id: "M97", title: "BP 179/109 without symptoms: grade 2, not crisis, 50 m", age: 50, sex: "male", answers: BP(179, 109), triage: "yellow", windowDays: 7, rules: ["NRN-RULE-BP-002"], noRules: ["RF-06"] },
  { id: "M98", title: "Heart failure, AF, CKD and diabetes with unknown HbA1c, 76 f", age: 76, sex: "female", answers: { "q6.conditions": ["heart_failure", "af", "kidney", "diabetes"], "q6.diabetes_years": UNKNOWN, "q6.hba1c": UNKNOWN }, triage: "yellow", rules: ["NRN-RULE-CMB-001", "NRN-RULE-CMB-002", "NRN-RULE-CKD-001", "NRN-RULE-DM-003", "NRN-RULE-DM-004", "NRN-RULE-DM-005"] },
  { id: "M99", title: "Treated controlled HTN with 12-year diabetes at target and CKD, 70 m", age: 70, sex: "male", answers: { "q5.diagnosed": "treated", ...BP(126, 76), "q6.conditions": ["diabetes", "kidney"], "q6.diabetes_years": 12, "q6.hba1c": 6.5 }, triage: "yellow", windowDays: 14, rules: ["NRN-RULE-HTN-002", "NRN-RULE-DM-001", "NRN-RULE-DM-005", "NRN-RULE-CKD-001"], noRules: ["NRN-RULE-BP-004", "NRN-RULE-DM-002"] },
  { id: "M100", title: "Heart failure with palpitations, not now, 70 m", age: 70, sex: "male", answers: { "q6.conditions": ["heart_failure"], "q10.symptoms": "yes", "q10.right_now": "no", "q10.syncope": "never", "q10.rhythm": "strong", "q10.episode_duration": "seconds" }, triage: "yellow", rules: ["NRN-RULE-CMB-001", "NRN-RULE-PAL-002"] },
  { id: "TC-02", title: "Armen: obesity, grade 1 BP and smoking", age: 56, sex: "female", answers: { "q2.height": 165, "q2.weight": 88, "q2.waist": 98, "q2.activity": "sedentary", "q2.diet": ["veg", "fruit", "fish"], "q3.status": "current", "q3.years": 30, "q3.per_day": 15, "q5.diagnosed": "untreated", ...BP(148,94), "q8.stress": "often" }, triage: "yellow" },
  { id: "TC-05", title: "Armen: stable exertional chest pain", age: 52, sex: "male", answers: { "q2.height": 180, "q2.weight": 82, "q3.status": "former", "q3.quit_years_ago": 8, ...BP(128,82), "q9.present": "yes", "q9.right_now": "no", "q9.frequency": "monthly", "q9.crescendo": "same", "q9.at_rest": "no", "q9.duration": "1_5" }, triage: "yellow", rules: ["NRN-RULE-CP-002"], noRules: ["RF-07"] },
  { id: "TC-08", title: "Armen: diabetes, unknown duration, HbA1c 9.4", age: 47, sex: "female", answers: { "q2.height": 162, "q2.weight": 79, "q6.conditions": ["diabetes"], "q6.diabetes_years": UNKNOWN, "q6.hba1c": 9.4, ...BP(134,86) }, triage: "orange", rules: ["RF-11", "NRN-RULE-DM-005"] },
  { id: "TC-10", title: "Armen: BP and alcohol frequency unknown", age: 55, sex: "male", answers: { "q2.height": 176, "q2.weight": 84, "q5.last_reading.systolic": UNKNOWN, "q5.last_reading.diastolic": UNKNOWN, "q4.frequency": UNKNOWN, "q4.drinks_per_day": UNKNOWN, "q4.binge": UNKNOWN, "q4.drink_type": UNKNOWN, "q4.volume_ml": UNKNOWN }, triage: "yellow", noRules: ["NRN-RULE-OK-008", "NRN-RULE-ALC-001"] },
  { id: "TC-12", title: "Armen: high STOP-BANG and breathlessness without HF", age: 50, sex: "male", answers: { "q2.height": 174, "q2.weight": 102, "q8.neck": 44, "q8.sleep_quality": 4, "q8.sleep_hours": 5, "q8.breathing": "both", "q8.daytime_sleepiness": "daily", "q3.status": "former", "q3.quit_years_ago": 2, ...BP(138,88), "q10.symptoms": "yes", "q10.right_now": "no", "q10.breathless": "yes", "q10.syncope": "never", "q10.rhythm": "fast_regular", "q10.episode_duration": "seconds" }, triage: "yellow", rules: ["NRN-RULE-APN-002", "NRN-RULE-PAL-004"] },
];

/** What app/patient/results/page.tsx renders: it hides suggestions on red. */
function buildPlanVisible(decision: Decision) {
  return decision.urgency === "red" ? [] : buildPlan(decision);
}

// ---------------------------------------------------------------------------
// Running the real code paths.
// ---------------------------------------------------------------------------

const keysOf = (ids: string[]) => [...new Set(ids.flatMap((id) => APP_TEST_KEYS[id] ?? [`unmapped:${id}` as Key]))].sort();

function snapshot(answers: Answers, age: number, sex: string): ClinicalSnapshot {
  return {
    id: "72000000-0000-4000-8000-000000000001", revision: 0, evidenceToken: "tests-vs-tree", draft: null, draftSavedAt: null, draftStale: false,
    evidence: {
      visits: [], profile: { name: "Synthetic tests-vs-tree", birthDate: `${2026 - age}-01-01`, biologicalSex: sex },
      consent: { version: "patient-pilot-v1" },
      assessment: { revision: 1, assessment_date: ASSESSMENT_DATE, answers, completed_at: `${ASSESSMENT_DATE}T09:30:00Z`, urgent_rule: null },
      measurements: [], reports: [],
    },
  };
}

type Discrepancy = { scenario: string; rule: string; kind: "missing" | "extra" | "triage" | "window" | "rule-missing" | "rule-fired"; key: string; cat: Category; note?: string };

/**
 * The route the sources give, against the route the engine took. A colour or a
 * window later than the source is (a). Earlier is conservative: listed as (b)
 * so the contradiction with the flag's own wording stays visible. An ambiguity
 * the scenario itself declares (`triageCat`) is (b) in either direction.
 */
function routeDiscrepancies(sc: Scenario, decision: Decision): Discrepancy[] {
  const out: Discrepancy[] = [];
  if (decision.urgency !== sc.triage) {
    const later = URGENCY_RANK[decision.urgency] < URGENCY_RANK[sc.triage];
    out.push({ scenario: sc.id, rule: "route", kind: "triage", key: `${sc.triage}→${decision.urgency}`, cat: sc.triageCat ?? (later ? "a" : "b"), note: sc.triageNote });
  }
  if (sc.windowDays !== undefined && decision.urgency !== "red") {
    const [min, max] = Array.isArray(sc.windowDays) ? sc.windowDays : [sc.windowDays, sc.windowDays];
    const days = consultationWindowDays(decision)!;
    if (days > max) out.push({ scenario: sc.id, rule: "route", kind: "window", key: `≤${max}d→${days}d`, cat: "a", note: sc.windowNote });
    else if (days < min) out.push({ scenario: sc.id, rule: "route", kind: "window", key: `${min}d→${days}d`, cat: "b", note: sc.windowNote ?? "earlier than the source: conservative, but the headline and the flag's own next step then name two deadlines" });
  }
  const fired = new Set(decision.findings.map((f) => f.ruleId));
  for (const id of sc.rules ?? []) if (!fired.has(id)) out.push({ scenario: sc.id, rule: "route", kind: "rule-missing", key: id, cat: "a", note: "the source branch maps to this rule (branch-coverage.ts) and it did not fire" });
  for (const id of sc.noRules ?? []) if (fired.has(id)) out.push({ scenario: sc.id, rule: "route", kind: "rule-fired", key: id, cat: "a", note: "no source branch orders this finding here" });
  return out;
}

export function run() {
  const rows = SCENARIOS.map((sc) => {
    const answers = fill(sc.age, sc.sex, sc.answers);
    const decision: Decision = evaluate({ answers, observations: [] });
    // app/patient/results/page.tsx hides suggestions on red; buildPlan itself does not.
    const resultsIds = buildPlanVisible(decision).map((t) => t.id);
    let bookingIds: string[] | null = null;
    let bookingBlocked: string | null = null;
    try { bookingIds = clinicalReviewEngine(snapshot(answers, sc.age, sc.sex), "booking").tests.map((t) => t.id); }
    catch (error) { bookingBlocked = error instanceof Error ? error.message : String(error); }

    const profile = { answers };
    const fired = SPEC.filter((r) => r.when(profile));
    const actual = keysOf(resultsIds);
    const allowed = new Set<string>([...ALWAYS_ALLOWED, ...fired.flatMap((r) => [...r.required.map((e) => e.key), ...(r.conditional ?? [])])]);
    const discrepancies: Discrepancy[] = [];
    if (decision.urgency !== "red") {
      for (const rule of fired) for (const e of rule.required) if (!actual.includes(e.key)) {
        discrepancies.push({ scenario: sc.id, rule: rule.id, kind: "missing", key: e.key, cat: e.cat, note: e.note });
      }
      // Within one scenario, report a missing key once, under its first rule.
      const seen = new Set<string>();
      discrepancies.splice(0, discrepancies.length, ...discrepancies.filter((d) => (seen.has(d.key) ? false : (seen.add(d.key), true))));
      for (const key of actual) if (!allowed.has(key)) {
        const source = buildPlan(decision).filter((t) => (APP_TEST_KEYS[t.id] ?? []).includes(key as Key))
          .flatMap((t) => t.sourceRuleIds.filter((r) => decision.findings.some((f) => f.ruleId === r)));
        discrepancies.push({ scenario: sc.id, rule: `code:${[...new Set(source)].join("+")}`, kind: "extra", key, cat: "a", note: "No source rule that fired orders this" });
      }
    }
    discrepancies.push(...routeDiscrepancies(sc, decision));
    // Red always wins: no routine test on screen and no booking. Orange keeps
    // the member in the product, so booking stays open and matches the page.
    const routing: string[] = [];
    if (decision.urgency === "red") {
      if (buildPlanVisible(decision).length) routing.push("red profile shows routine tests");
      if (bookingIds) routing.push("red profile can book routine tests");
    } else {
      if (!bookingIds) routing.push(`${decision.urgency} profile cannot book: ${bookingBlocked}`);
      // Discussion-only tests are on the results page and never booked: a clinic offer must cover every booked test.
      else {
        const firedRules = new Set(decision.findings.map((f) => f.ruleId));
        const page = buildPlanVisible(decision).filter((t) => !t.discussOnly && t.sourceRuleIds.some((id) => firedRules.has(id) && !DISCUSS_ONLY_RULES.includes(id)));
        if (keysOf(bookingIds).join() !== keysOf(page.map((t) => t.id)).join()) routing.push("results page and booking disagree");
      }
    }
    return {
      id: sc.id, title: sc.title, urgency: decision.urgency, expectedTriage: sc.triage, windowDays: consultationWindowDays(decision), routing,
      fired: decision.findings.map((f) => f.ruleId),
      specRules: fired.map((r) => r.id),
      expectedRequired: [...new Set(fired.flatMap((r) => r.required.map((e) => e.key)))].sort(),
      results: actual,
      booking: bookingIds ? keysOf(bookingIds) : null,
      bookingBlocked,
      discrepancies,
    };
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------

const isMain = process.argv[1]?.endsWith("check-suggested-tests-vs-tree.ts");
if (isMain) {
  const rows = run();
  const args = process.argv.slice(2);
  const jsonAt = args.indexOf("--json");
  if (jsonAt >= 0) writeFileSync(args[jsonAt + 1], JSON.stringify({ spec: SPEC.map((r) => ({ ...r, when: undefined })), unreachable: UNREACHABLE, protocolConflicts: PROTOCOL_CONFLICTS, rows }, null, 2));
  const all = rows.flatMap((r) => r.discrepancies);
  const unique = new Map<string, Discrepancy & { scenarios: string[] }>();
  for (const d of all) {
    const id = `${d.kind}|${d.rule}|${d.key}`;
    const u = unique.get(id) ?? { ...d, scenarios: [] };
    u.scenarios.push(d.scenario);
    unique.set(id, u);
  }
  if (!args.includes("--quiet")) {
    for (const r of rows) {
      const booking = r.bookingBlocked ? `BLOCKED (${r.bookingBlocked.slice(0, 60)}…)` : r.booking!.join(", ");
      console.log(`${r.id} ${r.urgency.padEnd(6)} ${r.title}${r.windowDays === null ? "" : ` · window ${r.windowDays} d`}`);
      console.log(`    results: ${r.results.join(", ") || "(none)"}`);
      console.log(`    booking: ${booking}`);
      console.log(`    expected: ${r.expectedRequired.join(", ") || "(none)"}`);
      for (const d of r.discrepancies) console.log(`    ${d.cat} ${d.kind.padEnd(7)} ${d.key.padEnd(16)} ${d.rule}`);
      for (const problem of r.routing) console.log(`    ROUTING ${problem}`);
    }
    console.log("");
  }
  const byCat = (c: Category) => [...unique.values()].filter((u) => u.cat === c).length;
  const routeKinds = new Set(["triage", "window", "rule-missing", "rule-fired"]);
  const tests = all.filter((d) => !routeKinds.has(d.kind)), route = all.filter((d) => routeKinds.has(d.kind));
  console.log(`${rows.length} scenarios, ${all.length} scenario-level discrepancies (${tests.length} tests, ${route.length} route), ${unique.size} distinct (rule × test).`);
  console.log(`Distinct by category: a=${byCat("a")} b=${byCat("b")} · unreachable branches: ${UNREACHABLE.length} · protocol v2 conflicts (c, source-level): ${PROTOCOL_CONFLICTS.length}`);
  console.log(`Route: triage matches the source in ${rows.filter((r) => r.urgency === r.expectedTriage).length} of ${rows.length}; windows earlier than the source in ${route.filter((d) => d.kind === "window" && d.cat === "b").length}, later in ${route.filter((d) => d.kind === "window" && d.cat === "a").length}; rules missing ${route.filter((d) => d.kind === "rule-missing").length}, fired against the source ${route.filter((d) => d.kind === "rule-fired").length}.`);
  console.log(`Booking blocked in ${rows.filter((r) => r.bookingBlocked).length} scenarios; results page and booking differ in ${rows.filter((r) => r.booking && r.booking.join() !== r.results.join()).length}.`);
  const routing = rows.flatMap((r) => r.routing.map((p) => `${r.id}: ${p}`));
  const red = rows.filter((r) => r.urgency === "red");
  if (red.length < 7) routing.push(`expected at least 7 red profiles, found ${red.length}`);
  console.log(`Red profiles: ${red.map((r) => r.id).join(", ")}, all without routine tests or booking: ${red.every((r) => !r.routing.length)}.`);
  console.log(`Expected-pending (b, blocked on Armen): ${[...unique.values()].filter((u) => u.cat === "b").map((u) => `${u.rule} ${u.key} (${u.scenarios.join(" ")})`).join("; ") || "none"}.`);
  for (const problem of routing) console.error(`ROUTING ${problem}`);
  if (byCat("a") > 0 || routing.length) process.exitCode = 1;
}
