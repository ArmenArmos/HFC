/**
 * Every number that decides something, exactly once.
 *
 * Kept apart from `rules.ts` so `derived.ts`, which `rules.ts` imports, can use
 * the same values without an import cycle. Consumers import `THRESHOLD` from
 * `rules.ts`, which re-exports it.
 *
 * NOT CLINICALLY APPROVED. These thresholds are a working draft until clinical
 * sign-off.
 */
export const THRESHOLD = {
  /** Decision tree Q3: quit this long ago or more counts as a non-smoker. */
  formerSmokerYears: 5,
  /** Decision tree v1.1, Phase 2 steps 3 and 5. Draft review only. */
  phase2LdlHigh: 4.9,
  phase2TotalCholesterolHigh: 8,
  phase2NewDiabetesHba1c: 6.5,
  phase2EgfrSevere: 30,
  phase2ScoreMinAge: 40,
  phase2ScoreMiddleAge: 50,
  phase2ScoreOlderAge: 70,
  phase2ScoreYoungHigh: 2.5,
  phase2ScoreYoungVeryHigh: 7.5,
  phase2ScoreMiddleHigh: 5,
  phase2ScoreMiddleVeryHigh: 10,
  phase2ScoreOlderHigh: 7.5,
  phase2ScoreOlderVeryHigh: 15,
  ldlGoalVeryHigh: 1.4,
  ldlGoalHigh: 1.8,
  ldlGoalModerate: 2.6,
  ldlGoalLow: 3,
  ldlGoalReductionPct: 50,
  /** Hypertensive crisis. Opens the symptom gate, and the urgent route with it. */
  crisisSystolic: 180,
  crisisDiastolic: 110,
  /** A repeat at or above this, no symptoms: doctor the same day, sent automatically (bp-check.ts). Below it, in the crisis range: 48 hours. */
  bpDoctorTodaySystolic: 180,
  bpDoctorTodayDiastolic: 120,
  /** Grade 2 hypertension by measurement. */
  grade2Systolic: 160,
  grade2Diastolic: 100,
  /** Grade 1. */
  grade1Systolic: 140,
  grade1Diastolic: 90,
  /** Home-reading yellow band starts at 135 systolic or 85 diastolic (Armen, team group message 588, 2 Nov), overriding the vendored Q5.2 cut. */
  elevatedSystolic: 135,
  elevatedDiastolic: 85,
  /** Weekly home BP summary, draft for Armen (message 582, part A). */
  bpTrendWindowDays: 7,
  bpTrendSummaryReadings: 3,
  bpTrendSummaryDays: 2,
  bpTrendComparisonReadings: 3,
  bpTrendMinReadings: 4,
  bpTrendChangeSystolic: 10,
  bpTrendPeriodReadings: 2,
  bpTrendMorningEndHour: 12,
  bpTrendEveningStartHour: 16,
  bpTrendRegularDays: 4,
  bpTrendNextDays: 3,
  /** Male waist threshold; the female threshold is 88 cm. */
  waistMale: 102,
  waistFemale: 88,
  /** First waist cut ("no further weight gain"), male and female. */
  waistMaleNoFurtherGain: 94,
  waistFemaleNoFurtherGain: 80,
  /** Weekly moderate-intensity-equivalent activity target. */
  activityMinutes: 150,
  /** Half the activity target, shown as "halfway there". */
  activityHalfMinutes: 75,
  /** General adult BMI reference range, not a personal target. */
  usualAdultBmiMin: 18.5,
  usualAdultBmiMax: 24.9,
  /** Obesity, by BMI. */
  obesityBmi: 30,
  /** Pack-years at or above which the clinician gets a separate note. */
  heavySmokingPackYears: 20,
  /** HbA1c above target, and the level that makes it urgent. */
  hba1cAboveTarget: 7,
  hba1cUrgent: 9,
  /** Diabetes duration that prompts review of the high-risk source branch. */
  diabetesLongDurationYears: 10,
  /** Lab protocol v2 section 3: eGFR G3a starts below 60; uACR A2 starts at 3 mg/mmol. Doctor draft notes only, never a diagnosis. */
  labProtocolEgfrG3: 60,
  labProtocolUacrA2: 3,
} as const;
