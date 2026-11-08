/**
 * The clinical domain (NRN-CLIN-ALG-001).
 *
 * These types describe the screening algorithm and the artefacts it produces:
 * what is asked, what is derived, what fires, what is ordered and what comes
 * back.
 */

/** Human-readable text. Armenian is authoritative; English falls back to it. */
/** Clinical source text. Armenian is the source; Russian is a machine-drafted v1
 * pending clinical review (docs/reference/russian-copy-review.md). */
export type Localized = { hy: string; en?: string; ru: string };
/** Armenian and English only (the public website). */
export type LocalizedHyEn = { hy: string; en?: string };
/** Picks the reader's language. Saved records written before Russian existed
 * carry no `ru`, so Russian falls back to Armenian, and English to Armenian. */
export const localized = (v: { hy: string; en?: string; ru?: string }, l: 'hy' | 'en' | 'ru'): string =>
  l === 'ru' ? v.ru ?? v.hy : l === 'en' ? v.en ?? v.hy : v.hy;

export type Locale = "hy" | "en";

/**
 * Clinical urgency, ordered. Red always overrides everything below it
 * (PRD section 4), so the numeric rank is what comparisons use — never
 * string ordering.
 */
export const URGENCY_RANK = {
  green: 0,
  yellow: 1,
  orange: 2,
  red: 3,
} as const;

export type Urgency = keyof typeof URGENCY_RANK;

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

/**
 * A deliberately explicit "we did not ask / they did not say".
 *
 * PRD section 4: a missing answer is stored as unknown and never treated as
 * normal. Modelling this as a sentinel rather than `undefined` keeps that
 * distinction alive through the rules engine and into the summary, where
 * unknown has to render as its own group.
 */
export const UNKNOWN = "unknown" as const;
export type Unknown = typeof UNKNOWN;

export type FieldValue = string | number | boolean | string[] | Unknown;

export type AnswerSource = "manual" | "voice" | "presenter";

export type Answer = {
  fieldId: string;
  value: FieldValue;
  source: AnswerSource;
  /** The user-confirmed wording, when the answer came in by voice. */
  transcript?: string;
  answeredAt: string;
};

export type Answers = Record<string, Answer>;

export type FieldKind =
  | "number"
  /** A 1-to-10 rating. Rendered as a slider, stored as a number. */
  | "scale"
  | "single"
  | "multi"
  | "boolean"
  | "text"
  | "blood-pressure";

export type FieldOption = {
  value: string;
  label: Localized;
  /** Marks an option that may open the urgent route (PRD section 4). */
  redFlag?: boolean;
};

/**
 * The option that means "none of these", within a `multi` field.
 *
 * Selecting it clears every other option and selecting any other clears it,
 * because "none of these, and also diabetes" is not an answer the rules can
 * read. Declared per field rather than assumed, since the value differs.
 */
export const NONE = "none" as const;

export type AssessmentField = {
  id: string;
  label: Localized;
  /** Other wording for the same question once an earlier answer changes its tense. The field and its answer stay the same. */
  labelWhen?: { when: (answers: Answers) => boolean; label: Localized };
  help?: Localized;
  kind: FieldKind;
  options?: FieldOption[];
  unit?: Localized;
  min?: number;
  max?: number;
  /**
   * The top of the range means "max or more" and is shown as "max+". A saved
   * answer above it stays valid and displays at the top; the input clamps new
   * answers to it.
   */
  openMax?: boolean;
  /**
   * Conditional subquestion.
   *
   * A subquestion appears inside the batch its parent sits in. It does not
   * create a step of its own, which is part of why progress is reported by
   * topic rather than by a count (handoff screen 04).
   */
  showIf?: (answers: Answers) => boolean;
  /**
   * The «Do you have it right now?» gate. Asked before frequency or history,
   * and evaluated against the interrupt rules the moment it is answered.
   */
  immediate?: boolean;
  /**
   * Offers an explicit «I don't know» that stores `UNKNOWN`.
   *
   * For measurements the source document expects many people not to have:
   * HbA1c and neck circumference. Leaving the field blank would be recorded as
   * unknown anyway, but silence and a stated «I don't know» are different
   * things to a clinician reading the record.
   */
  skippable?: boolean;
  /** The label on that control, when the default wording does not fit. */
  skipLabel?: Localized;
  /** For `multi`: the option that clears the rest. Defaults to `NONE`. */
  exclusiveValue?: string;
  /** For `scale`: the words at each end of the range. */
  scaleLabels?: { low: Localized; high: Localized };
  /**
   * Bounds for a composite field's parts, keyed by the suffix of their id.
   *
   * A blood pressure reading is one question with two numbers that do not
   * share a range, so `min` and `max` on the field itself cannot describe it.
   */
  parts?: Record<string, { min: number; max: number }>;
  /** Step for numeric input, when whole numbers are too coarse. */
  step?: number;
};

export type CoreQuestion = {
  id: string;
  /**
   * 1-based position in the clinical source document's ordering.
   *
   * It is the question's identity, not its position on screen: the anamnesis is
   * presented as topic batches that regroup these ten, so nothing renders this
   * as "step N of 10".
   */
  index: number;
  title: Localized;
  intro?: Localized;
  fields: AssessmentField[];
};

// ---------------------------------------------------------------------------
// Clinical rules
// ---------------------------------------------------------------------------

export type RuleCategory =
  | "emergency"
  | "blood-pressure"
  | "lipids"
  | "metabolic"
  | "lifestyle"
  | "family-history"
  | "symptom"
  | "reassuring"
  | "missing-data";

export type Rule = {
  /**
   * Stable identifier stored with every decision.
   *
   * The twelve red flags use their registry ids, `RF-01` to `RF-12`, so a
   * finding on screen and a row in `docs/clinical/` are the same identifier.
   * Everything else is `NRN-RULE-*`.
   */
  id: string;
  /** The guideline or product decision the threshold comes from. */
  source?: string;
  category: RuleCategory;
  urgency: Urgency;
  reason: Localized;
  /** What to do about it, when the rule carries a next step. */
  nextStep?: Localized;
  evaluate: (ctx: RuleContext) => RuleHit | null;
};

/** Everything the rules service is allowed to look at. */
export type RuleContext = {
  answers: Answers;
  observations: Observation[];
  episode?: SymptomEpisode;
};

export type RuleHit = {
  /** Source-specific action and consultation deadline for this finding. */
  nextStep?: Localized;
  consultationWithinDays?: number;
  /** The answer or observation that fired the rule, for the audit trail. */
  triggeredBy: string;
  detail?: Localized;
};

export type DecisionFinding = {
  /** Maximum time to consultation stated by the source for this finding. */
  consultationWithinDays?: number;
  ruleId: string;
  source?: string;
  category: RuleCategory;
  urgency: Urgency;
  reason: Localized;
  nextStep?: Localized;
  triggeredBy: string;
  detail?: Localized;
};

export type Decision = {
  urgency: Urgency;
  findings: DecisionFinding[];
  /** Stored with every decision (PRD section 4). */
  algorithmVersion: string;
  /**
   * The cardiovascular risk percentage stays hidden until lipid results exist
   * (PRD section 4). The engine decides this, not the screens.
   */
  riskPercentAvailable: boolean;
};

// ---------------------------------------------------------------------------
// Tests, plan and booking
// ---------------------------------------------------------------------------

export type TestCategory = "measurement" | "laboratory" | "cardiovascular";

/**
 * The clinically approved priority labels (handoff screen 06).
 *
 * Named for what they mean rather than as a severity ladder: "one-time marker"
 * is not a weaker version of "recommended now", it is a different statement
 * about when the test is worth repeating.
 */
export type TestPriority = "now" | "baseline" | "one_time";

/** How the sample or measurement is actually taken (handoff screen 06). */
export type TestMethod = "blood_draw" | "urine_sample" | "measurement" | "ecg" | "home_log";

export type PlannedTest = {
  id: string;
  category: TestCategory;
  name: Localized;
  /** Why this specific person needs it — never a generic panel blurb. */
  rationale: Localized;
  /** "What it can tell us", in plain language. */
  whatItTells: Localized;
  /** "How it may change the next step", without promising a diagnosis. */
  howItChangesNextStep: Localized;
  priority: TestPriority;
  preparation: Localized;
  method: TestMethod;
  /** Minutes the test itself takes during the visit. */
  durationMinutes: number;
  /** How long the result takes to come back, for the demo. */
  turnaround: Localized;
  location: Localized;
  /** Rules that put this test on the plan, for traceability. */
  sourceRuleIds: string[];
  /**
   * The entry in `NRN-LAB-CAT-001` this test corresponds to, verbatim.
   *
   * The catalogue is a procurement analysis as much as an order set: it records
   * which investigations the algorithm asks for and which of them the current
   * packages can actually deliver. `pnpm check:clinical` resolves this string
   * against it and reports the availability, so a plan that orders something
   * nobody can perform is visible rather than assumed.
   *
   * Absent for the two measurements Noreon takes itself rather than ordering.
   * A list when one ordered test carries several catalogue rows, as the lipid
   * panel (TC, HDL-C, LDL-C, TG) and HbA1c with fasting glucose do.
   */
  catalogueRef?: string | string[];
  /** Cadence for the repeat-testing loop, in days. */
  repeatAfterDays?: number;
  /** On the plan for the member and doctor to discuss, but never a requirement to publish or book. No package or evidence path carries it yet. */
  discussOnly?: boolean;
  /**
   * Set when the doctor added this test at review rather than the engine
   * proposing it (handoff screen 08). The member's confirmation screen has to
   * be able to say which items changed, so the provenance travels with the test.
   */
  addedByDoctor?: boolean;
};

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

export type ObservationFlag = "normal" | "borderline" | "elevated" | "high";

export type Observation = {
  id: string;
  testId: string;
  name: Localized;
  value: Localized;
  unit?: Localized;
  referenceRange?: Localized;
  flag: ObservationFlag;
  collectedAt: string;
  /**
   * The numbers behind `value`, for results that can be drawn on a line.
   *
   * `value` is `Localized` rather than a number because not every result is
   * one: an ECG reads "normal sinus rhythm", which is a sentence and has to be
   * written in both languages like any other. Results that can be plotted carry
   * this as well, and the ones that cannot simply omit it and render as text.
   */
  scale?: {
    /** The plotted number, which for a composite reading is the leading one. */
    at: number;
    /** The ends of the axis, chosen to be clinically legible rather than tight. */
    min: number;
    max: number;
    /** The edge of the reference range, on the axis. */
    limit: number;
    /** Which side of `limit` is the healthy one. */
    healthy: "below" | "above";
  };
};

// ---------------------------------------------------------------------------
// Clinical review
// ---------------------------------------------------------------------------

/**
 * One confirmed symptom, with what fired on it.
 *
 * Carries `ruleIds` and an urgency, so it is an output of the algorithm rather
 * than a thing a screen collects — which is why it belongs here and not with
 * the session state that happens to hold a list of them.
 */
export type SymptomEpisode = {
  id: string;
  /** The wording the user confirmed, never the raw transcript. */
  confirmedText: string;
  presentNow: boolean | Unknown;
  clarifiers: Record<string, FieldValue>;
  urgency: Urgency;
  ruleIds: string[];
  clinicianReviewRequested: boolean;
  createdAt: string;
};
