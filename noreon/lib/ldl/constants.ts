/**
 * LDL goal: every clinical default in one place. PENDING ARMEN/YESAYI (founders' LDL pivot, 29 Oct 2026;
 * output/ldl-pivot-2026-10-29/QUESTIONS_FOR_TEAM.md). These are conservative code defaults, not signed-off
 * clinical policy: the clinicians may change any of them, and nothing else in the app repeats these numbers.
 *
 * Basis: ESC/EAS 2019 dyslipidaemia goals as the founders' specification transcribes them (spec §4.1), with
 * the conflicts Fable found (FABLE_REPORT §2.2-2.3) settled the safe way until the clinicians decide.
 * Changing a value: change it here, bump LDL_DEFAULTS_VERSION, and say so in the PR (each saved goal records
 * the version its form proposed).
 */
import { THRESHOLD } from "../clinical/rules/thresholds";

export const LDL_DEFAULTS_VERSION = "ldl-defaults-2026-11-02";

export const LDL_CATEGORIES = ["very_high", "high", "moderate", "low"] as const;
export type LdlCategory = (typeof LDL_CATEGORIES)[number];

/**
 * Category goal: LDL-C below `thresholdMmol`, and for high and very high risk a reduction of at least
 * `reductionPct` from a documented untreated baseline. PENDING: the spec's UI uses 2.6 for low risk and its
 * rule engine 3.0; 3.0 (the ESC value) is used here. The pilot population is very high risk.
 */
export const LDL_CATEGORY_GOALS: Record<LdlCategory, { thresholdMmol: number; reductionPct: number | null }> = {
  very_high: { thresholdMmol: THRESHOLD.ldlGoalVeryHigh, reductionPct: THRESHOLD.ldlGoalReductionPct },
  high: { thresholdMmol: THRESHOLD.ldlGoalHigh, reductionPct: THRESHOLD.ldlGoalReductionPct },
  moderate: { thresholdMmol: THRESHOLD.ldlGoalModerate, reductionPct: null },
  low: { thresholdMmol: THRESHOLD.ldlGoalLow, reductionPct: null },
};

/** Established ASCVD (heart attack/ACS, ischaemic stroke, TIA) proposes very high risk; the doctor confirms. PENDING. */
export const LDL_ASCVD_EVENTS = ["acs_mi", "ischaemic_stroke", "tia"] as const;
/** Task 19 (Armen, 2 Nov; rules not signed yet): a haemorrhagic stroke excludes the member from the LDL pilot. */
export const LDL_PILOT_EXCLUDED_EVENTS = ["haemorrhagic_stroke"] as const;
export const LDL_ASCVD_DEFAULT_CATEGORY: LdlCategory = "very_high";

/** Thresholds the doctor may pick (one decimal, mmol/L), as the spec's targets control offers. */
export const LDL_THRESHOLD_CHOICES = [1.0, THRESHOLD.ldlGoalVeryHigh, THRESHOLD.ldlGoalHigh, THRESHOLD.ldlGoalModerate, THRESHOLD.ldlGoalLow] as const;

/**
 * "At goal" for now: the latest counted LDL-C is strictly below the threshold, compared unrounded. The
 * reduction rule is reported separately (met / not met / not assessable) and does not change the status.
 * PENDING: the spec's rule engine requires both (FABLE_REPORT §2.2); the clinicians decide which one the
 * member is told. Switching to "threshold and reduction" is this one flag.
 */
export const LDL_AT_GOAL_REQUIRES_REDUCTION = false;

/**
 * Which LDL values decide the status. PENDING. Default: values a doctor has reviewed (a published clinic or
 * laboratory result, a clinic reading the doctor verified, an upload the doctor approved). Values the member
 * typed or confirmed themselves are shown in the trend but never decide "at goal".
 */
export const LDL_STATUS_SOURCES = ["clinic_result", "clinic_reviewed", "upload_checked"] as const;

/** mg/dL to mmol/L for LDL-C (spec §4.1 divides by 38.67; the lab catalogue's factor is the same to 4 decimals). */
export const LDL_MG_DL_PER_MMOL = 38.67;

/**
 * Phase 2, the re-test and response loop. PENDING ARMEN/YESAYI (QUESTIONS C3, C8, C9). Changing any of these:
 * bump LDL_DEFAULTS_VERSION too (each re-test records the version its form proposed).
 *
 * Re-test window after a change to lipid therapy, in weeks from the change: 4 to 6 after a heart attack or acute
 * coronary syndrome (decision tree P531-533, as lib/programme/repeat-tests.ts lists it), and 4 to 6 after any other
 * therapy change (Task 19, Armen 2 Nov: "4 to 6 weeks after a heart attack or a therapy change"; decided 2 Nov). This
 * disagrees with the unsigned planner rule LR-02, which still says 4 to 12 for a therapy change with no heart attack.
 */
export const LDL_RETEST_WEEKS = { acs: [4, 6], other: [4, 6] } as const satisfies Record<"acs" | "other", readonly [number, number]>;
/** The home-visit request for the blood draw is created this many days before the window opens (an admin confirms it). */
export const LDL_RETEST_REQUEST_LEAD_DAYS = 7;
/** Adherence for the response check: share of lipid-medicine doses ticked taken in this many days (late counts as taken, C8). */
export const LDL_ADHERENCE_WINDOW_DAYS = 28;
/**
 * Names that make a dose-log medicine a lipid-lowering one (case-insensitive, any part of the name): the generic names
 * of the drugs in lib/ldl/schema.ts and common brands in Armenia and Russia, Latin and Cyrillic. Anything else is not
 * counted for adherence.
 */
export const LDL_LIPID_MEDICINE_NAMES = [
  "statin", "atorva", "rosuva", "simva", "prava", "pitava", "fluva", "ezetim", "evolocumab", "alirocumab", "inclisiran", "bempedo",
  "atoris", "torvacard", "liprimar", "tulip", "crestor", "rosucard", "roxera", "mertenil", "rosart", "zocor", "vasilip", "ezetrol", "repatha", "praluent", "leqvio",
  "статин", "аторва", "розува", "симва", "права", "питава", "флува", "эзетим", "эволокумаб", "алирокумаб", "инклисиран", "бемпедо",
  "аторис", "торвакард", "тулип", "липримар", "крестор", "розукард", "роксера", "мертенил", "розарт", "вазилип", "эзетрол", "репата", "пралуэнт",
  "ստատին", "ատորվա", "ռոզուվա", "էզետիմ",
] as const;
