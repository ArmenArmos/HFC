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
  /**
   * Personal home BP target and clinician-set alert thresholds (WP T, lib/clinical/rules/personal-bp.ts). DEFAULTS ONLY,
   * pending clinical sign-off: the physician confirms or changes them per member (member_bp_targets), and the version
   * PERSONAL_BP_DEFAULTS_VERSION is stored with each confirmation. The default target equals the home yellow band above;
   * a reading below both numbers is at target. Emergency cuts (crisis and doctor-today above) always win.
   */
  personalBpTargetSystolic: 135,
  personalBpTargetDiastolic: 85,
  /** Default alert: this many consecutive home readings at or above grade 2 raise the same-day nurse task. */
  personalBpAlertHighSystolic: 160,
  personalBpAlertHighDiastolic: 100,
  personalBpAlertHighConsecutive: 2,
  /** Default low alert, only with symptoms: systolic at or below, or a pulse at or below. */
  personalBpAlertLowSystolic: 90,
  personalBpAlertLowPulse: 50,
  /** Risk tier (lib/clinical/rules/risk-tier.ts). Draft points and cuts, pending clinical sign-off. */
  riskTierWindowDays: 7,
  riskTierPointsOpenUrgent: 60,
  riskTierPointsRedFlag: 40,
  riskTierPointsSecondaryPrevention: 40,
  riskTierPointsBpAlertRange: 25,
  riskTierPointsBpAboveTarget: 15,
  riskTierPointsLdlAboveGoal: 15,
  riskTierPointsAdherenceLow: 10,
  riskTierPointsUnknown: 5,
  riskTierPointsContactStale: 5,
  riskTierAdherenceLowPct: 80,
  riskTierContactStaleDays: 30,
  riskTierVeryHighScore: 60,
  riskTierHighScore: 35,
  riskTierModerateScore: 15,
  /** BP anomalies (lib/clinical/rules/bp-anomaly.ts). Draft, pending clinical sign-off. */
  bpAnomalySustainedWindowDays: 7,
  bpAnomalySustainedDays: 4,
  bpAnomalyRiseRecentDays: 3,
  bpAnomalyRiseBaselineDays: 14,
  bpAnomalyRiseSystolic: 15,
  bpAnomalyRiseMinRecent: 2,
  bpAnomalyRiseMinBaseline: 4,
  bpAnomalyVariabilityDays: 14,
  bpAnomalyVariabilityMinReadings: 6,
  bpAnomalyVariabilitySdSystolic: 15,
  bpAnomalyLowWindowDays: 7,
  bpAnomalyLowReadings: 2,
  /** LDL trend (lib/clinical/rules/lab-trend.ts), mmol/L and weeks. Draft, pending clinical sign-off. */
  labTrendLdlRiseMmol: 0.3,
  labTrendLdlNotAtGoalWeeks: 12,
} as const;
