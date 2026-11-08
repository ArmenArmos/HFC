import type { Answers } from "../types";
import { LDL_CATEGORY_GOALS } from "../../ldl/constants";
import { THRESHOLD as T } from "./thresholds";
import { bloodPressureBand } from "./derived";

/** Decision tree v1.1, Phase 2. Draft for clinical review, never a diagnosis. */
export type DatedResult<V> = { value: V; on: string };
export type ResultsAssessmentInput = {
  answers: Answers | null;
  questionnaireComplete: boolean;
  age: number | null;
  labs: Record<"totalCholesterol" | "hdl" | "ldl" | "egfr" | "uacr" | "hba1c", DatedResult<number> | null>;
  /** Independent latest TC: rule 8 must not be restricted to the paired panel. */
  latestTotalCholesterol: DatedResult<number> | null;
  entries: {
    score2Percent: DatedResult<number> | null;
    potassium: DatedResult<number> | null;
    ecgLvh: DatedResult<"yes" | "no"> | null;
    ecgIschaemia: DatedResult<"yes" | "no"> | null;
    echoDone: DatedResult<"yes" | "no"> | null;
    ahi: DatedResult<number> | null;
  };
  awaitingReview: number;
};
export type ResultsRiskLevel = "very_high" | "high" | "moderate" | "low_moderate";
export type ResultsCategoryRule = "ascvd" | "egfr_under_30" | "diabetes_organ_damage" | "egfr_30_59" | "fh" | "diabetes_short" | "diabetes_other" | "ldl_tc_high" | "score2_table";
export type ResultsGate = "questionnaire_incomplete" | "conditions_unknown" | "age_unknown" | "uacr_missing" | "diabetes_duration_unknown" | "diabetes_unconfirmed" | "lipids_incomplete" | "score2_missing" | "lvh_without_echo" | "egfr_missing" | "values_awaiting_review";
export type ResultsAssessment = {
  nonHdl: { value: number } | null;
  hmod: { status: "present" | "absent" | "unknown"; reasons: ("ecg_lvh" | "uacr" | "egfr")[] };
  score2: { state: "off" | "applicable" | "undecided"; reasons: ("ascvd" | "heart_failure" | "diabetes" | "ckd" | "fh" | "hmod" | "under_40")[]; percent: number | null };
  category: { level: ResultsRiskLevel; rule: ResultsCategoryRule } | null;
  ldlTarget: { mmol: number; reductionPct: number | null; latest: DatedResult<number> | null; below: boolean | null } | null;
  gates: ResultsGate[];
  facts: Omit<ResultsAssessmentInput["entries"], "score2Percent">;
};

export function resultsAssessment(input: ResultsAssessmentInput): ResultsAssessment {
  const { answers, age, labs, entries } = input;
  const answer = (id: string) => answers?.[id]?.value;
  const number = (id: string): number | null => typeof answer(id) === "number" ? answer(id) as number : null;
  const rawConditions = answer("q6.conditions");
  const conditionsKnown = Array.isArray(rawConditions) && !rawConditions.includes("unknown") && rawConditions.length > 0;
  const conditions = Array.isArray(rawConditions) ? rawConditions : [];
  const has = (condition: string) => conditions.includes(condition);
  const diabetes = has("diabetes");
  const ascvd = has("ascvd") || has("stroke");
  const fh = has("familial_hypercholesterolaemia");
  const egfr = labs.egfr?.value ?? null;
  const uacr = labs.uacr?.value ?? null;
  const years = number("q6.diabetes_years");
  const systolic = number("q5.last_reading.systolic");
  const diastolic = number("q5.last_reading.diastolic");
  const bp = answers ? bloodPressureBand(answers) : null;
  // The shared band needs both readings. A known positive half still opens
  // missing-lab gates, but a missing half can never establish normal BP.
  const hypertension = ["treated", "untreated"].includes(String(answer("q5.diagnosed"))) ||
    (bp !== null ? ["GRADE_1", "GRADE_2", "CRISIS"].includes(bp.code) :
      (systolic !== null && systolic >= T.grade1Systolic) || (diastolic !== null && diastolic >= T.grade1Diastolic));
  const hmod: ResultsAssessment["hmod"] = { status: "unknown", reasons: [] };
  if (entries.ecgLvh?.value === "yes") hmod.reasons.push("ecg_lvh");
  if (uacr !== null && uacr >= T.labProtocolUacrA2) hmod.reasons.push("uacr");
  if (egfr !== null && egfr < T.labProtocolEgfrG3) hmod.reasons.push("egfr");
  if (hmod.reasons.length) hmod.status = "present";
  else if (entries.ecgLvh?.value === "no" && uacr !== null && egfr !== null) hmod.status = "absent";

  const complete = input.questionnaireComplete && conditionsKnown && age !== null;
  const score2: ResultsAssessment["score2"] = { state: "undecided", reasons: [], percent: null };
  if (ascvd) score2.reasons.push("ascvd");
  if (has("heart_failure")) score2.reasons.push("heart_failure");
  if (diabetes) score2.reasons.push("diabetes");
  if (has("kidney") || (egfr !== null && egfr < T.labProtocolEgfrG3)) score2.reasons.push("ckd");
  if (fh) score2.reasons.push("fh");
  if (hmod.status === "present") score2.reasons.push("hmod");
  if (age !== null && age < T.phase2ScoreMinAge) score2.reasons.push("under_40");
  if (score2.reasons.length) score2.state = "off";
  else if (complete) { score2.state = "applicable"; score2.percent = entries.score2Percent?.value ?? null; }

  let category: ResultsAssessment["category"] = null;
  const set = (level: ResultsRiskLevel, rule: ResultsCategoryRule) => { category = { level, rule }; };
  if (complete) {
    if (ascvd) set("very_high", "ascvd");
    else if (egfr !== null && egfr < T.phase2EgfrSevere) set("very_high", "egfr_under_30");
    else if (diabetes && uacr !== null && uacr >= T.labProtocolUacrA2) set("very_high", "diabetes_organ_damage");
    else if (egfr !== null && egfr < T.labProtocolEgfrG3) set("high", "egfr_30_59");
    else if (fh) set("high", "fh");
    else if (diabetes) {
      // Every negative is explicit: missing smoking, BP, kidney or HMOD data is not reassurance.
      // A quit under five years ago still counts as smoking (decision tree Q3). High LDL or TC, or recorded dyslipidaemia, is a factor.
      const quit = number("q3.quit_years_ago");
      const nonSmoker = answer("q3.status") === "never" || (answer("q3.status") === "former" && quit !== null && quit >= T.formerSmokerYears);
      const lipidsClear = !has("dyslipidaemia") && labs.ldl !== null && labs.ldl.value < T.phase2LdlHigh &&
        input.latestTotalCholesterol !== null && input.latestTotalCholesterol.value <= T.phase2TotalCholesterolHigh;
      const short = age < T.phase2ScoreMiddleAge && years !== null && years < T.diabetesLongDurationYears &&
        nonSmoker && lipidsClear && answer("q5.diagnosed") === "no" && bp !== null && ["NON_ELEVATED", "ELEVATED"].includes(bp.code) &&
        uacr !== null && uacr < T.labProtocolUacrA2 && egfr !== null && egfr >= T.labProtocolEgfrG3 && hmod.status === "absent";
      set(short ? "moderate" : "high", short ? "diabetes_short" : "diabetes_other");
    } else if ((labs.ldl !== null && labs.ldl.value >= T.phase2LdlHigh) ||
      (input.latestTotalCholesterol !== null && input.latestTotalCholesterol.value > T.phase2TotalCholesterolHigh)) set("high", "ldl_tc_high");
    else if (score2.state === "applicable" && score2.percent !== null) {
      const [high, veryHigh] = age < T.phase2ScoreMiddleAge ? [T.phase2ScoreYoungHigh, T.phase2ScoreYoungVeryHigh] :
        age < T.phase2ScoreOlderAge ? [T.phase2ScoreMiddleHigh, T.phase2ScoreMiddleVeryHigh] : [T.phase2ScoreOlderHigh, T.phase2ScoreOlderVeryHigh];
      set(score2.percent >= veryHigh ? "very_high" : score2.percent >= high ? "high" : "low_moderate", "score2_table");
    }
  }
  const nonHdl = labs.totalCholesterol && labs.hdl && labs.totalCholesterol.on === labs.hdl.on ?
    { value: Number((labs.totalCholesterol.value - labs.hdl.value).toFixed(1)) } : null;
  const gates: ResultsGate[] = [];
  if (!input.questionnaireComplete) gates.push("questionnaire_incomplete");
  if (!conditionsKnown) gates.push("conditions_unknown");
  if (age === null) gates.push("age_unknown");
  if ((diabetes || hypertension) && uacr === null) gates.push("uacr_missing");
  if (diabetes && years === null) gates.push("diabetes_duration_unknown");
  if (!diabetes && labs.hba1c !== null && labs.hba1c.value >= T.phase2NewDiabetesHba1c) gates.push("diabetes_unconfirmed");
  if (nonHdl === null) gates.push("lipids_incomplete");
  if (score2.state === "applicable" && score2.percent === null && category === null) gates.push("score2_missing");
  if (entries.ecgLvh?.value === "yes" && entries.echoDone?.value !== "yes") gates.push("lvh_without_echo");
  if ((has("kidney") || diabetes || hypertension) && egfr === null) gates.push("egfr_missing");
  if (input.awaitingReview > 0) gates.push("values_awaiting_review");
  const chosen = category as ResultsAssessment["category"];
  const goal = chosen ? LDL_CATEGORY_GOALS[chosen.level === "low_moderate" ? "low" : chosen.level] : null;
  const ldlTarget = goal ? { mmol: goal.thresholdMmol, reductionPct: goal.reductionPct, latest: labs.ldl,
    below: labs.ldl === null ? null : labs.ldl.value < goal.thresholdMmol } : null;
  const facts = { potassium: entries.potassium, ecgLvh: entries.ecgLvh, ecgIschaemia: entries.ecgIschaemia, echoDone: entries.echoDone, ahi: entries.ahi };
  return { nonHdl, hmod, score2, category: chosen, ldlTarget, gates, facts };
}
