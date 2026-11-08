/**
 * The translation table between `NRN-CLIN-ALG-001` and this app.
 *
 * The specification identifies a question as `Q2.3` and its answer as `pa`,
 * with options `A` to `D`. This app calls the same thing `q2.activity` with
 * options `active` to `limited`, because a rule that reads
 * `activity === "sedentary"` can be reviewed by someone who has not memorised
 * the codebook, and rules are the thing most likely to be read by a clinician.
 *
 * Both are legitimate, and the cost of having both is drift. This file is the
 * whole of that cost, in one place: `pnpm check:clinical` reads it, walks the
 * specification, and fails if a question, an option, a bound or a branch
 * condition has moved apart from its counterpart here.
 *
 * A new question in the source is therefore a failing check rather than a
 * silent omission, which is the only property that makes "the document is the
 * source" true rather than aspirational.
 */

export type SpecFieldMap = {
  /** Question id in the source document, e.g. `Q2.3`. */
  specId: string;
  /** The source's answer key, which is also the key CQL and FHIR bind to. */
  specKey: string;
  /** The field id in `lib/clinical/seed/questions.ts`. */
  fieldId: string;
  /** Source option value to this app's option value. */
  options?: Record<string, string>;
  /**
   * Options this app adds that the source does not list.
   *
   * Each needs justifying rather than hiding: the eight
   * diet components have no "none of these" in the source, so someone who ticks
   * nothing is indistinguishable from someone who was never asked. The
   * simulator's own scoring filters a `none` value out, which says the intent
   * was there. Recorded here so the check passes deliberately, not by accident.
   */
  addedOptions?: string[];
};

export const SPEC_MAP: SpecFieldMap[] = [
  { specId: "Q1.1", specKey: "age", fieldId: "q1.age" },
  {
    specId: "Q1.2",
    specKey: "sex",
    fieldId: "q1.sex",
    options: { male: "male", female: "female" },
  },
  {
    specId: "Q2.1",
    specKey: "wperc",
    fieldId: "q2.weight_perception",
    options: { ok: "ok", over: "over", idk: "unknown" },
  },
  { specId: "Q2.2", specKey: "h", fieldId: "q2.height" },
  { specId: "Q2.2", specKey: "w", fieldId: "q2.weight" },
  { specId: "Q2.2", specKey: "waist", fieldId: "q2.waist" },
  {
    specId: "Q2.3",
    specKey: "pa",
    fieldId: "q2.activity",
    options: { A: "active", B: "occasional", C: "sedentary", D: "limited" },
  },
  { specId: "Q2.3a", specKey: "pamin", fieldId: "q2.activity_minutes" },
  {
    specId: "Q2.3a",
    specKey: "paint",
    fieldId: "q2.activity_intensity",
    options: { mod: "moderate", vig: "vigorous" },
  },
  {
    specId: "Q2.4",
    specKey: "diet",
    fieldId: "q2.diet",
    options: {
      veg: "veg",
      fruit: "fruit",
      fish: "fish",
      nuts: "nuts",
      meat: "meat",
      grain: "grain",
      salt: "salt",
      ssb: "ssb",
    },
    addedOptions: ["none"],
  },
  {
    specId: "Q3.1",
    specKey: "smoke",
    fieldId: "q3.status",
    options: {
      cur: "current",
      former: "former",
      never: "never",
      alt: "alternative",
    },
  },
  { specId: "Q3.2", specKey: "smyr", fieldId: "q3.years" },
  { specId: "Q3.3", specKey: "cpd", fieldId: "q3.per_day" },
  { specId: "Q3.4", specKey: "quit", fieldId: "q3.quit_years_ago" },
  {
    specId: "Q4.1",
    specKey: "alcfreq",
    fieldId: "q4.frequency",
    options: {
      never: "never",
      m1: "monthly_or_less",
      m24: "two_to_four_month",
      w23: "two_to_three_week",
      w4: "four_plus_week",
    },
    // Decision tree 2.4 explicitly branches on forgotten quantity or frequency;
    // questionnaire JSON Q4.1 omits idk. Keep the assessment unknown, not zero.
    addedOptions: ["unknown"],
  },
  {
    specId: "Q4.2",
    specKey: "alcqty",
    fieldId: "q4.drinks_per_day",
    options: {
      d12: "one_two",
      d34: "three_four",
      d56: "five_six",
      d79: "seven_nine",
      d10: "ten_plus",
      idk: "unknown",
    },
  },
  {
    specId: "Q4.3",
    specKey: "alcbinge",
    fieldId: "q4.binge",
    options: {
      never: "never",
      ltm: "less_than_monthly",
      mon: "monthly",
      wk: "weekly",
      day: "daily",
      idk: "unknown",
    },
  },
  {
    specId: "Q4.4",
    specKey: "alctype",
    fieldId: "q4.drink_type",
    options: {
      beer: "beer",
      wine: "wine",
      spir: "spirits",
      mix: "mixed",
      idk: "unknown",
    },
  },
  { specId: "Q4.5", specKey: "alcvol", fieldId: "q4.volume_ml" },
  {
    specId: "Q5.1",
    specKey: "htn",
    fieldId: "q5.diagnosed",
    options: { tx: "treated", notx: "untreated", no: "no", idk: "unknown" },
  },
  // Q5.2's fields and input bounds stay as vendored. Its band cut is overridden:
  // Armen, team group message 588, 2 Nov: yellow starts at 135 systolic OR 85
  // diastolic, not 120/70. THRESHOLD holds the cut; check-clinical pins both sides.
  { specId: "Q5.2", specKey: "sbp", fieldId: "q5.last_reading.systolic" },
  { specId: "Q5.2", specKey: "dbp", fieldId: "q5.last_reading.diastolic" },
  {
    specId: "Q5.3",
    specKey: "bpsx",
    fieldId: "q5.crisis_symptoms",
    options: {
      head: "headache",
      vis: "vision",
      chest: "chest",
      dysp: "breathless",
      dizz: "dizziness",
      neuro: "neuro",
      seiz: "seizure",
      none: "none",
    },
  },
  {
    specId: "Q6.1",
    specKey: "cmb",
    fieldId: "q6.conditions",
    options: {
      DM: "diabetes",
      PREDM: "prediabetes",
      ASCVD: "ascvd",
      CVA: "stroke",
      HF: "heart_failure",
      AF: "af",
      CKD: "kidney",
      DLP: "dyslipidaemia",
      FH: "familial_hypercholesterolaemia",
      INFLAM: "inflammatory",
      OSA_DX: "osa",
      NAFLD: "fatty_liver",
      MENTAL: "mental_health",
      none: "none",
    },
  },
  { specId: "Q6.2b", specKey: "dmdur", fieldId: "q6.diabetes_years" },
  { specId: "Q6.2e", specKey: "hba1c", fieldId: "q6.hba1c" },
  {
    specId: "Q7.1",
    specKey: "fhx",
    fieldId: "q7.relatives",
    options: {
      CAD: "cad",
      STROKE: "stroke",
      SCD: "sudden_death",
      DM: "diabetes",
      CKD: "kidney",
      FH: "familial_hypercholesterolaemia",
      HTN: "hypertension",
      none: "none",
    },
  },
  {
    specId: "Q7.2",
    specKey: "prem",
    fieldId: "q7.relative_age",
    options: {
      m55: "male_under_55",
      f65: "female_under_65",
      later: "later",
      idk: "unknown",
    },
  },
  { specId: "Q8.1", specKey: "sleepq", fieldId: "q8.sleep_quality" },
  { specId: "Q8.1a", specKey: "sleeph", fieldId: "q8.sleep_hours" },
  {
    specId: "Q8.2",
    specKey: "sdb",
    fieldId: "q8.breathing",
    options: { snore: "snoring", apnoea: "apnoea", both: "both", no: "no" },
  },
  {
    specId: "Q8.3",
    specKey: "sleepy",
    fieldId: "q8.daytime_sleepiness",
    options: {
      never: "never",
      some: "sometimes",
      often: "often",
      daily: "daily",
    },
  },
  { specId: "Q8.4a", specKey: "neck", fieldId: "q8.neck" },
  {
    specId: "Q8.5",
    specKey: "stress",
    fieldId: "q8.stress",
    options: { no: "no", some: "sometimes", often: "often", always: "always" },
  },
  {
    specId: "Q9.1",
    specKey: "cp",
    fieldId: "q9.present",
    options: { yes: "yes", no: "no", unsure: "unsure" },
  },
  {
    // A gate carries no options in the source; the two answers are the
    // emergency button and its refusal, and the simulator renders them itself.
    specId: "Q9.2",
    specKey: "cpnow",
    fieldId: "q9.right_now",
    options: { yes: "yes", no: "no" },
  },
  {
    specId: "Q9.3",
    specKey: "cpfreq",
    fieldId: "q9.frequency",
    options: {
      multi: "multi_daily",
      daily: "daily",
      week: "weekly",
      month: "monthly",
      rare: "rare",
    },
  },
  {
    specId: "Q9.4",
    specKey: "cresc",
    fieldId: "q9.crescendo",
    options: { yes: "worse", same: "same", better: "better" },
  },
  {
    specId: "Q9.5",
    specKey: "cprest",
    fieldId: "q9.at_rest",
    options: { yes: "yes", no: "no" },
  },
  {
    specId: "Q9.6",
    specKey: "cpdur",
    fieldId: "q9.duration",
    options: {
      sec: "seconds",
      "1_5": "1_5",
      "5_15": "5_15",
      gt15: "over_15",
      var: "variable",
    },
  },
  {
    specId: "Q10.1",
    specKey: "ar",
    fieldId: "q10.symptoms",
    options: { yes: "yes", no: "no", palponly: "palpitations_only" },
  },
  {
    specId: "Q10.2",
    specKey: "arnow",
    fieldId: "q10.right_now",
    options: { yes: "yes", no: "no" },
  },
  {
    specId: "Q10.3",
    specKey: "syn",
    fieldId: "q10.syncope",
    options: {
      exert: "exertion",
      rest: "rest",
      vaso: "vasovagal",
      never: "never",
    },
  },
  {
    specId: "Q10.4",
    specKey: "rhy",
    fieldId: "q10.rhythm",
    options: {
      fast: "fast_regular",
      irreg: "irregular",
      strong: "strong",
      idk: "unknown",
    },
  },
  {
    specId: "Q10.5",
    specKey: "ardur",
    fieldId: "q10.episode_duration",
    options: {
      sec: "seconds",
      lt5: "under_5",
      "5_30": "5_30",
      gt30: "over_30",
    },
  },
];

/** Decision tree Q9.1 orders NT-proBNP/echo for breathlessness without HF.
 * Q10.1 combines dizziness and breathlessness, so this app-only clarifier has
 * no questionnaire spec id. All other fields still require a source mapping. */
export const APP_ONLY_FIELDS: string[] = ["q10.breathless"];

/** Every mapping for one source question, since three carry several fields. */
export function mapsForQuestion(specId: string): SpecFieldMap[] {
  return SPEC_MAP.filter((m) => m.specId === specId);
}

export function mapForField(fieldId: string): SpecFieldMap | undefined {
  return SPEC_MAP.find((m) => m.fieldId === fieldId);
}
