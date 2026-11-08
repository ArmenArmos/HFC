import { ALL_RULES } from "@/lib/clinical/rules/rules";

/**
 * What this app does with each of the specification's branch outcomes.
 *
 * The source names 101 outcomes across the ten questions. Some become a rule,
 * some become a derived band the screens render, some are pure navigation that
 * the branch-equivalence check already covers, and some are not built here at
 * all. The last group is the one that matters: a gap nobody wrote down is
 * indistinguishable from an oversight, and this file is what makes the
 * difference reviewable.
 *
 * `pnpm check:clinical` fails if the source grows a branch that is not listed
 * here, or if an entry names a rule that no longer exists. It does not fail on
 * a declared gap: whether to close one is a product decision, not a defect.
 */

export type BranchCoverage = {
  specId: string;
  /** Position within that question's `branches` array in the source. */
  index: number;
  /** The source's own condition text, so a reader can find the row. */
  when: string;
  /** Implemented by this rule. */
  rule?: string;
  /** Implemented as this derived metric, which the screens render as a band. */
  derived?: string;
  /** Pure branching, already proven equivalent by the fuzz check. */
  navigation?: boolean;
  /** Belongs to the post-diagnostic phase, which this app does not run. */
  phase2?: string;
  /** Deliberately not built, with the reason. */
  notModelled?: string;
};

export const BRANCH_COVERAGE: BranchCoverage[] = [
  { specId: "Q1.1", index: 0, when: "age < 18", notModelled: "The age input floors at 18, so a younger session cannot be started" },
  { specId: "Q1.1", index: 1, when: "age 18–39", derived: "score2State" },
  { specId: "Q1.1", index: 2, when: "age 40–69", derived: "score2State" },
  { specId: "Q1.1", index: 3, when: "age >= 70", derived: "score2State" },
  { specId: "Q1.1", index: 4, when: "age >= 40", notModelled: "A recurring reminder. The demo has no scheduler" },
  { specId: "Q1.1", index: 5, when: "age < 40", notModelled: "A recurring reminder. The demo has no scheduler" },
  { specId: "Q1.2", index: 0, when: "sex = male|female", derived: "score2State" },
  { specId: "Q2.1", index: 0, when: "ցանկացած պատասխան", navigation: true },
  { specId: "Q2.2", index: 0, when: "BMI < 18.5", rule: "NRN-RULE-ANT-003" },
  { specId: "Q2.2", index: 1, when: "BMI 18.5–24.9", derived: "bmiBand" },
  { specId: "Q2.2", index: 2, when: "BMI 25.0–29.9", rule: "NRN-RULE-ANT-004" },
  { specId: "Q2.2", index: 3, when: "BMI >= 30", rule: "NRN-RULE-ANT-002" },
  { specId: "Q2.2", index: 4, when: "waist >= 102 (male) կամ >= 88 (female)", rule: "NRN-RULE-ANT-001" },
  { specId: "Q2.2", index: 5, when: "waist >= 94 (male) կամ >= 80 (female)", derived: "waistBand" },
  { specId: "Q2.3", index: 0, when: "pa = A|B", navigation: true },
  { specId: "Q2.3", index: 1, when: "pa = C (նստակյաց)", rule: "NRN-RULE-ACT-001" },
  { specId: "Q2.3", index: 2, when: "pa = D (առողջական սահմանափակում)", rule: "NRN-RULE-ACT-002" },
  { specId: "Q2.3a", index: 0, when: "չափավոր >= 150 ր/շաբ կամ ինտենսիվ >= 75 ր/շաբ", derived: "activityBand" },
  { specId: "Q2.3a", index: 1, when: "չափավոր 75–149 ր/շաբ", derived: "activityBand" },
  { specId: "Q2.3a", index: 2, when: "չափավոր < 75 ր/շաբ", rule: "NRN-RULE-ACT-001" },
  { specId: "Q2.3a", index: 3, when: "ցանկացած", notModelled: "A strength-training prescription. The demo plans tests, not workouts" },
  { specId: "Q2.4", index: 0, when: "7–8 նշված", rule: "NRN-RULE-OK-005" },
  { specId: "Q2.4", index: 1, when: "4–6 նշված", rule: "NRN-RULE-DIET-002" },
  { specId: "Q2.4", index: 2, when: "0–3 նշված", rule: "NRN-RULE-DIET-001" },
  { specId: "Q2.4", index: 3, when: "ցանկացած", notModelled: "Presentation rule for a nutrition module the demo does not build" },
  { specId: "Q3.1", index: 0, when: "smoke = never", navigation: true },
  { specId: "Q3.1", index: 1, when: "smoke = cur", rule: "NRN-RULE-SMK-001" },
  { specId: "Q3.1", index: 2, when: "smoke = former", navigation: true },
  { specId: "Q3.1", index: 3, when: "smoke = alt (էլ./տաքացվող)", rule: "NRN-RULE-SMK-001" },
  { specId: "Q3.3", index: 0, when: "տուփ-տարի >= 20", rule: "NRN-RULE-SMK-002" },
  { specId: "Q3.3", index: 1, when: ">= 20 ծխախոտ/օր", notModelled: "Pack-years already carries the intensity; a second message would repeat it" },
  { specId: "Q3.4", index: 0, when: "թողել է < 15 տարի առաջ ԵՎ տուփ-տարի >= 20 ԵՎ տարիք 50–80", notModelled: "LDCT screening is EXTERNAL (USPSTF) and awaits Clinical Board sign-off" },
  { specId: "Q4.1", index: 0, when: "Երբեք", rule: "NRN-RULE-OK-008" },
  { specId: "Q4.1", index: 1, when: "Ամսական մեկ անգամ կամ ավելի", navigation: true },
  { specId: "Q4.2", index: 0, when: "Քանակը չեմ հիշում", derived: "alcoholBand" },
  { specId: "Q4.3", index: 0, when: "0 միավոր", derived: "auditCBand" },
  { specId: "Q4.3", index: 1, when: "Տղամարդ՝ 1–3 / կին՝ 1–2", rule: "NRN-RULE-ALC-001" },
  { specId: "Q4.3", index: 2, when: "Տղամարդ՝ 4 և ավելի / կին՝ 3 և ավելի", rule: "NRN-RULE-ALC-002" },
  { specId: "Q4.3", index: 3, when: "6 և ավելի բաժին՝ շաբաթական կամ ավելի հաճախ", rule: "NRN-RULE-ALC-003" },
  { specId: "Q4.5", index: 0, when: "≤100 գ/շաբաթ", derived: "alcoholBand" },
  { specId: "Q4.5", index: 1, when: ">100 գ/շաբաթ", rule: "NRN-RULE-ALC-004" },
  { specId: "Q5.1", index: 0, when: "htn = tx (ախտորոշված, դեղորայքով)", rule: "NRN-RULE-HTN-002" },
  { specId: "Q5.1", index: 1, when: "htn = notx", rule: "NRN-RULE-HTN-001" },
  { specId: "Q5.1", index: 2, when: "htn = no", navigation: true },
  { specId: "Q5.1", index: 3, when: "htn = idk", rule: "NRN-RULE-BP-003" },
  // Keep the source's own text for traceability. These two band cuts are
  // overridden to 135/85 (Armen, team group message 588, 2 Nov); see spec-map.
  { specId: "Q5.2", index: 0, when: "BP < 120/70", derived: "bloodPressureBand" },
  { specId: "Q5.2", index: 1, when: "SBP 120–139 կամ DBP 70–89", rule: "NRN-RULE-BP-004" },
  { specId: "Q5.2", index: 2, when: "BP 140–179/90–109", rule: "NRN-RULE-BP-002" },
  { specId: "Q5.2", index: 3, when: "BP >= 180/110", navigation: true },
  { specId: "Q5.3", index: 0, when: "ցանկացած ախտանիշ նշված է", rule: "RF-03" },
  { specId: "Q5.3", index: 1, when: "neuro նշված է", rule: "RF-04" },
  { specId: "Q5.3", index: 2, when: "seiz նշված է", rule: "RF-05" },
  { specId: "Q5.3", index: 3, when: "«Ոչ մեկը»", rule: "RF-06" },
  { specId: "Q6.1", index: 0, when: "ASCVD | CVA նշված է", derived: "score2State" },
  { specId: "Q6.1", index: 1, when: "DM նշված է", rule: "NRN-RULE-DM-005" },
  { specId: "Q6.1", index: 2, when: "CKD նշված է", rule: "NRN-RULE-CKD-001" },
  { specId: "Q6.1", index: 3, when: "FH նշված է", derived: "score2State" },
  { specId: "Q6.1", index: 4, when: "HF նշված է", rule: "NRN-RULE-CMB-001" },
  { specId: "Q6.1", index: 5, when: "AF նշված է", rule: "NRN-RULE-CMB-002" },
  { specId: "Q6.1", index: 6, when: "INFLAM նշված է", derived: "modifiers" },
  { specId: "Q6.1", index: 7, when: "OSA_DX նշված է", notModelled: "A known apnoea diagnosis does not yet bypass the STOP-BANG path" },
  { specId: "Q6.1", index: 8, when: "«Ոչ մեկը»", rule: "NRN-RULE-OK-003" },
  { specId: "Q6.2b", index: 0, when: "ՇԴ ԵՎ տևողություն >= 10 տ.", phase2: "NRN-RULE-DM-001 prompts clinician review; final classification still needs review of higher-priority conditions" },
  { specId: "Q6.2b", index: 1, when: "ՇԴ ԵՎ տարիք < 50 ԵՎ տևողություն < 10 տ. ԵՎ լրացուցիչ ռիսկի գործոն չկա", phase2: "Risk category needs the returned laboratory values" },
  { specId: "Q6.2b", index: 2, when: "մնացած բոլոր ՇԴ դեպքեր", phase2: "Risk category needs the returned laboratory values" },
  { specId: "Q6.2b", index: 3, when: "տևողությունը անհայտ է", phase2: "NRN-RULE-DM-003 prompts clinician review without claiming moderate risk; final classification still needs review of higher-priority conditions" },
  { specId: "Q6.2e", index: 0, when: "HbA1c < 7.0%", notModelled: "An in-target value produces no finding of its own" },
  { specId: "Q6.2e", index: 1, when: "HbA1c 7.0–8.9%", rule: "NRN-RULE-DM-002" },
  { specId: "Q6.2e", index: 2, when: "HbA1c >= 9.0%", rule: "RF-11" },
  { specId: "Q6.2e", index: 3, when: "չգիտի / չի հանձնել", rule: "NRN-RULE-DM-004" },
  { specId: "Q7.1", index: 0, when: "CAD | STROKE | SCD նշված է", navigation: true },
  { specId: "Q7.1", index: 1, when: "FH նշված է", rule: "NRN-RULE-FAM-002" },
  { specId: "Q7.1", index: 2, when: "«Ոչ մեկը / չգիտեմ»", navigation: true },
  { specId: "Q7.2", index: 0, when: "prem = m55 կամ f65 (վաղաժամ)", rule: "NRN-RULE-FAM-001" },
  { specId: "Q7.2", index: 1, when: "prem = later | idk", navigation: true },
  { specId: "Q8.1", index: 0, when: "sleepq < 7", navigation: true },
  { specId: "Q8.1a", index: 0, when: "քնի տևողությունը ≠ ~7 ժ", rule: "NRN-RULE-SLP-002" },
  { specId: "Q8.2", index: 0, when: "sdb = snore|apnoea|both", navigation: true },
  { specId: "Q8.3", index: 0, when: "sleepy = often|daily", rule: "NRN-RULE-SLP-001" },
  { specId: "Q8.4a", index: 0, when: "STOP-BANG 5–8", rule: "NRN-RULE-APN-002" },
  { specId: "Q8.4a", index: 1, when: "STOP-BANG 3–4", rule: "NRN-RULE-APN-001" },
  { specId: "Q8.4a", index: 2, when: "STOP-BANG 0–2", derived: "osaBand" },
  { specId: "Q8.5", index: 0, when: "stress = often|always", rule: "NRN-RULE-STR-001" },
  { specId: "Q9.1", index: 0, when: "cp = yes|unsure", navigation: true },
  { specId: "Q9.1", index: 1, when: "cp = no", rule: "NRN-RULE-OK-001" },
  { specId: "Q9.2", index: 0, when: "ԱՅՈ", rule: "RF-01" },
  { specId: "Q9.2", index: 1, when: "ՈՉ", navigation: true },
  { specId: "Q9.3", index: 0, when: "cpfreq = multi|daily", rule: "RF-07" },
  { specId: "Q9.4", index: 0, when: "cresc = yes", rule: "RF-07" },
  { specId: "Q9.5", index: 0, when: "cprest = yes", rule: "RF-07" },
  { specId: "Q9.6", index: 0, when: "cpdur = gt15", rule: "RF-07" },
  { specId: "Q10.1", index: 0, when: "ar = yes", navigation: true },
  { specId: "Q10.1", index: 1, when: "ar = palponly", rule: "NRN-RULE-PAL-002" },
  { specId: "Q10.1", index: 2, when: "ar = no", rule: "NRN-RULE-OK-002" },
  { specId: "Q10.2", index: 0, when: "ԱՅՈ", rule: "RF-02" },
  { specId: "Q10.2", index: 1, when: "ՈՉ", navigation: true },
  { specId: "Q10.3", index: 0, when: "syn = exert", rule: "RF-08" },
  { specId: "Q10.3", index: 1, when: "syn = rest", rule: "RF-09" },
  { specId: "Q10.3", index: 2, when: "syn = vaso", rule: "NRN-RULE-OK-007" },
  { specId: "Q10.4", index: 0, when: "rhy = irreg", rule: "NRN-RULE-PAL-003" },
  { specId: "Q10.5", index: 0, when: "ardur = gt30", rule: "RF-10" },
];

/** Branch outcomes the app does not implement, with the reason for each. */
export function declaredGaps(): BranchCoverage[] {
  return BRANCH_COVERAGE.filter((b) => b.notModelled || b.phase2);
}

/** Every rule id a coverage entry claims, for the conformance check. */
export function referencedRuleIds(): string[] {
  return [...new Set(BRANCH_COVERAGE.flatMap((b) => (b.rule ? [b.rule] : [])))];
}

/** True when every referenced rule actually exists. */
export function unknownRuleIds(): string[] {
  const known = new Set(ALL_RULES.map((r) => r.id));
  return referencedRuleIds().filter((id) => !known.has(id));
}
