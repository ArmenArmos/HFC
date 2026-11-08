/**
 * NOT CLINICALLY APPROVED. Source: Armen's build prompt of 2 Nov, section 2.2,
 * changed by Armen's answers of the same day (team message 588): 103 only with
 * symptoms, 160/100 is yellow, 180/110 is a doctor within 48 hours, 180/120 the
 * same day. These differ from the live rules on purpose. Do not replace the live
 * screening rules with these values before clinical approval.
 *
 * Follow-up answers 11 to 15 (Roo, message 593) are used on staging on Khikar's
 * word and need Armen and Yesayi's sign-off before real members. They settle
 * ALT and CK, and that 180 or 120 alone means the same day, so `doctor48h` only
 * adds diastolic 110 to 119. Mildly raised ALT is set to yellow here, since the
 * prompt's orange would outrank ALT over 3x; that one is a default, to confirm.
 */
export const ZONE_RULES_V1 = {
  version: "zones-v1-2026-11-02",
  approval: "draft" as "draft" | "approved",
  bp: {
    systolicLow: 90,
    diastolicLow: 60,
    yellow: { sbp: 135, dbp: 85 },
    doctor48h: { sbp: 180, dbp: 110 },
    sameDay: { sbp: 180, dbp: 120 },
    repeat: { sbp: 140, dbp: 90 },
    redFlagCheck: { sbp: 160, dbp: 100 },
    fastPulseWithAf: 140,
  },
  /** Readings saved within this window are one episode and are read together. */
  repeatEpisodeMinutes: 10,
  /** A zone chip applies only to a reading this recent. */
  readingFreshHours: 24,
  glycaemia: { hba1cPct: 9, symptomaticGlucoseMmol: 15, slaHours: 168, symptomaticSlaHours: 48 },
  lipids: {
    suspectedFhMmol: 4.9,
    tgOrangeMmol: 5.6,
    tgRedAboveMmol: 10,
    triglycerideMgDlPerMmol: 88.57,
  },
  liverMuscle: { altDoctor48hUlnMultiple: 3, altSameDayUlnMultiple: 5, ckSameDayWithSymptomsUlnMultiple: 5, ckSameDayUlnMultiple: 10 },
  /** Hours a member stays monitored after a 103 alert. */
  monitoredHoursAfter103: 24,
  /** Milder complaints that go to the nurse first. Statin muscle pain goes to the doctor. */
  nurseFirstSymptoms: ["mild_nausea", "mild_dizziness", "mild_headache", "ankle_swelling", "dry_cough", "frequent_urination"],
  adherence: { missedMeasurements: 3, missedDoseDays: 2 },
  retest: { fromWeeks: 6, toWeeks: 8 },
  // The prompt specifies no window per analyte. This default holds until the
  // clinical owners supply them; do not invent shorter windows.
  labFreshness: { defaultMonths: 3, monthsByAnalyte: {} as Readonly<Record<string, number>> },
  postApproval: {
    renal: { drugClasses: ["ace_inhibitor", "arb", "diuretic"], tests: ["creatinine", "eGFR", "K"], fromWeeks: 2, toWeeks: 4 },
    lipid: { drugClasses: ["statin", "ezetimibe"], tests: ["lipids", "ALT", "CK"], fromWeeks: 6, toWeeks: 8 },
  },
  slaHours: { green: null, yellow: 48, orange: 4, red: 0.5 },
  timeZone: "Asia/Yerevan",
} as const;
