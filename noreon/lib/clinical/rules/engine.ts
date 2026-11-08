import { ALGORITHM_VERSION, ALL_RULES, isUnknown } from "@/lib/clinical/rules/rules";
import { CORE_QUESTIONS, expectedFieldIds } from "@/lib/clinical/seed/questions";
import { DISCUSS_ONLY_RULES, TEST_CATALOGUE } from "@/lib/clinical/seed/tests";
import type {
  Answers,
  Decision,
  DecisionFinding,
  Localized,
  Observation,
  PlannedTest,
  RuleContext,
  Urgency,
} from "@/lib/clinical/types";
import { URGENCY_RANK } from "@/lib/clinical/types";

/**
 * The one entry point screens use to ask "what does the clinical engine think".
 *
 * Everything downstream — the summary groups, the plan, the urgency badge, the
 * urgent route, the Zoe response — reads a `Decision` produced here. No screen
 * re-derives any of it.
 */

export function highestUrgency(urgencies: Urgency[]): Urgency {
  return urgencies.reduce<Urgency>(
    (worst, u) => (URGENCY_RANK[u] > URGENCY_RANK[worst] ? u : worst),
    "green",
  );
}

export function evaluate(ctx: RuleContext): Decision {
  const findings: DecisionFinding[] = [];

  for (const rule of ALL_RULES) {
    const hit = rule.evaluate(ctx);
    if (!hit) continue;
    findings.push({
      ruleId: rule.id,
      source: rule.source,
      category: rule.category,
      urgency: rule.urgency,
      reason: rule.reason,
      nextStep: hit.nextStep ?? rule.nextStep,
      consultationWithinDays: hit.consultationWithinDays,
      triggeredBy: hit.triggeredBy,
      detail: hit.detail,
    });
  }

  // Reassuring and missing-data findings are green by construction, so they
  // never lift the overall urgency; only risk and emergency rules can.
  const urgency = highestUrgency(findings.map((f) => f.urgency));

  return {
    urgency,
    findings,
    algorithmVersion: ALGORITHM_VERSION,
    riskPercentAvailable: ctx.observations.some(
      (o) => o.testId === "lipid-panel",
    ),
  };
}

/** Findings the summary lists under "needs attention". */
export function needsAttention(decision: Decision): DecisionFinding[] {
  return decision.findings.filter(
    (f) => f.category !== "reassuring" && f.category !== "missing-data",
  );
}

/** Findings the summary lists as currently reassuring. */
export function reassuring(decision: Decision): DecisionFinding[] {
  return decision.findings.filter((f) => f.category === "reassuring");
}

/** Findings the summary lists as still missing. */
export function missing(decision: Decision): DecisionFinding[] {
  return decision.findings.filter((f) => f.category === "missing-data");
}

/**
 * Fields a completed assessment left unknown.
 *
 * PRD section 4: a missing answer is stored as unknown and never treated as
 * normal, so the summary has to be able to name them rather than quietly
 * assuming the reassuring case.
 */
export function unknownFields(answers: Answers): string[] {
  return expectedFieldIds(answers).filter((id) => isUnknown(answers, id));
}

export function questionLabel(fieldId: string): Localized | undefined {
  for (const q of CORE_QUESTIONS) {
    for (const f of q.fields) {
      if (f.id === fieldId || fieldId.startsWith(`${f.id}.`)) return f.label;
    }
  }
  return undefined;
}

/**
 * The personalised test plan.
 *
 * A test earns its place by being requested by a rule that actually fired. The
 * lipid panel is the exception: it is always on the plan, because the missing
 * lipid rule fires precisely when it is absent, and without it no risk estimate
 * is possible at all.
 */
/** What publication and booking require: the plan without what is only for discussion. Tests with another reason stay. */
export function requiredTests(decision: Decision): PlannedTest[] {
  const fired = new Set(decision.findings.map((f) => f.ruleId));
  return buildPlan(decision).filter(
    (test) => !test.discussOnly && test.sourceRuleIds.some((id) => fired.has(id) && !DISCUSS_ONLY_RULES.includes(id)),
  );
}

export function buildPlan(decision: Decision): PlannedTest[] {
  const firedRuleIds = new Set(decision.findings.map((f) => f.ruleId));
  const requested = TEST_CATALOGUE.filter((test) =>
    test.sourceRuleIds.some((id) => firedRuleIds.has(id)),
  );
  // An independently indicated combined investigation already includes HbA1c.
  // Missing diabetic HbA1c alone must not add fasting glucose or fasting prep.
  const includesCombinedHbA1c = requested.some((test) => test.id === "hba1c-glucose");
  return requested.filter((test) => test.id !== "hba1c" || !includesCombinedHbA1c);
}

/**
 * Time to a medical consultation, by urgency. Yellow is the seeded user's
 * result and the PRD fixes its wording (screen 05).
 */
export const CONSULTATION_WINDOW: Record<Urgency, Localized> = {
  red: {
    hy: "Զանգահարել 103 հիմա",
    en: "Call 103 now",
    ru: "Позвоните 103 сейчас",
  },
  orange: {
    hy: "Բժշկի խորհրդատվություն՝ 48 ժամվա ընթացքում",
    en: "Medical consultation within 48 hours",
    ru: "Консультация врача в течение 48 часов",
  },
  yellow: {
    hy: "Բժշկի խորհրդատվություն՝ 2 շաբաթվա ընթացքում",
    en: "Medical consultation within 2 weeks",
    ru: "Консультация врача в течение 2 недель",
  },
  green: {
    hy: "Պլանային հսկողություն՝ 12 ամսվա ընթացքում",
    en: "Routine review within 12 months",
    ru: "Плановый осмотр в течение 12 месяцев",
  },
};

/** The default window for each urgency, in days. Red has none: it is a call, not a booking. */
const DEFAULT_WINDOW_DAYS: Record<Exclude<Urgency, "red">, number> = { orange: 2, yellow: 14, green: 365 };

/**
 * The consultation window in days, or null on red. The earliest deadline among the findings wins, so one grade 2
 * reading among green answers still reads as one week. A finding at the result's own level with no deadline of its
 * own keeps the default, so RF-11's one week (Armen, 2 Nov) moves the window only when nothing else orange is present.
 */
export function consultationWindowDays(decision: Decision): number | null {
  if (decision.urgency === "red") return null;
  const defaultDays = DEFAULT_WINDOW_DAYS[decision.urgency];
  const earliest = decision.findings.reduce(
    (days, finding) => Math.min(days, finding.consultationWithinDays ?? (finding.urgency === decision.urgency ? defaultDays : days)),
    Infinity,
  );
  return Number.isFinite(earliest) ? earliest : defaultDays;
}

/** The earliest source deadline wins, while red/orange keep their existing action. */
export function consultationWindow(decision: Decision): Localized {
  if (decision.urgency === "red") return CONSULTATION_WINDOW.red;
  const days = consultationWindowDays(decision)!;
  if (days === DEFAULT_WINDOW_DAYS[decision.urgency]) return CONSULTATION_WINDOW[decision.urgency];
  if (days === 0) return {
    hy: "Բժշկի խորհրդատվություն՝ այսօր",
    en: "Medical consultation today",
    ru: "Консультация врача сегодня",
  };
  if (days === 7) return {
    hy: "Բժշկի խորհրդատվություն՝ 1 շաբաթվա ընթացքում",
    en: "Medical consultation within 1 week",
    ru: "Консультация врача в течение 1 недели",
  };
  return {
    hy: `Բժշկի խորհրդատվություն՝ ${days} օրվա ընթացքում`,
    en: `Medical consultation within ${days} days`,
    ru: `Консультация врача в течение ${days} дней`,
  };
}

export const URGENCY_LABEL: Record<Urgency, Localized> = {
  red: { hy: "Շտապ", en: "Emergency", ru: "Экстренно" },
  orange: { hy: "Հրատապ", en: "Urgent", ru: "Срочно" },
  yellow: { hy: "Ուշադրություն", en: "Needs attention", ru: "Требует внимания" },
  green: { hy: "Կայուն", en: "Stable", ru: "Стабильно" },
};

/**
 * Exercise reminders are suppressed after unexplained fainting.
 *
 * Someone who faints while running cannot be sent a notification at the same
 * hour saying it is time to train. Fainting at rest takes the same clinical
 * path, so it suppresses the reminders too: the two modules have to be able to
 * see each other. The member app reads the pause from the database
 * (`_member_safety_syncope_value`, same condition, kept in step by
 * scripts/check-member-safety.ts) because only a doctor may lift it.
 */
export function exerciseRemindersAllowed(answers: Answers): boolean {
  const syncope = answers["q10.syncope"]?.value;
  return syncope !== "exertion" && syncope !== "rest";
}

/**
 * The 30-day chest-pain safety card (DT P341-P342): chest pain on exertion or
 * stress answered «yes» or «not sure», and not present right now. «Right now»
 * is the 103 screen (RF-01, P323-P325) instead; whether those members also get
 * the card is Armen's question C2 (output/member-safety-ui-2026-10-18/QUESTIONS.md).
 * The member app does not call this: the database opens the card, and
 * `_member_safety_chest_value` in the member_safety_ui migration is the same
 * condition. scripts/check-member-safety.ts fails if the two drift apart.
 */
export function chestPainSafetyNetActive(answers: Answers): boolean {
  const present = answers["q9.present"]?.value;
  return (present === "yes" || present === "unsure") && answers["q9.right_now"]?.value === "no";
}

export { ALGORITHM_VERSION };

export type { RuleContext, Observation };
