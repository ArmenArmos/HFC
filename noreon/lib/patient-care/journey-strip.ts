import type { Locale } from "@/lib/locale";

/**
 * The member Home journey strip (Khikar, 17 Oct): where you are in
 * questionnaire → tests → results → plan, from saved state only. A read that
 * failed (undefined) never moves a member forward: it leaves the earlier stage
 * current, the same rule as memberJourneyStep.
 */
export type JourneyStage = "questionnaire" | "tests" | "results" | "plan";
export const JOURNEY_STAGES: JourneyStage[] = ["questionnaire", "tests", "results", "plan"];
export type StripInput = {
  questionnaireComplete: boolean;
  lab: "collected" | "partial" | "at-lab" | "results-received" | null | undefined;
  planPublished: boolean;
  /** A completed nurse visit took samples (nurse visit flow); undefined when unread. */
  nurseSamplesTaken?: boolean;
  /** The visit took place: a completed home-visit request, a clinic visit recorded as attended, a
   *  completed nurse visit, or clinic results released to the member (QA 177). */
  visitDone?: boolean;
};
/** Index of the current stage; 4 means every stage is done (a published plan). */
export function journeyStripIndex(input: StripInput): number {
  if (!input.questionnaireComplete) return 0;
  if (input.planPublished) return 4;
  if (input.lab === "results-received") return 3;
  if (input.lab === "collected" || input.lab === "partial" || input.lab === "at-lab" || input.nurseSamplesTaken || input.visitDone) return 2;
  return 1;
}

/** The saved facts every journey view reads. Home's strip, the next-step card's "Step n of 4", the
 *  booking page and Progress all derive their stage from this one input (QA 177), so they never
 *  disagree. Failed reads are undefined or null and never move a member forward. */
export type JourneyFacts = {
  questionnaireComplete: boolean;
  lab: StripInput["lab"];
  planPublished: boolean;
  nurseVisit?: { steps: { step: string }[] } | null;
  requests?: { status: string; contextStale?: boolean }[] | null;
  appointments?: { status: string; portal?: { checkin?: { outcome?: string } | null } | null; programme?: { currentProgramme?: boolean; open?: boolean } | null }[] | null;
  released?: unknown[] | null;
};
export function journeyStripInput(facts: JourneyFacts): StripInput {
  const steps = facts.nurseVisit?.steps.map((s) => s.step) ?? [];
  // Same rule as visitAttended and countsForProgramme in the booking components.
  const attended = (facts.appointments ?? []).some((a) =>
    a.status !== "cancelled" &&
    (!a.programme || a.programme.currentProgramme || a.programme.open) &&
    (a.portal?.checkin?.outcome === "arrived" || a.portal?.checkin?.outcome === "completed"));
  return {
    questionnaireComplete: facts.questionnaireComplete,
    lab: facts.lab,
    planPublished: facts.planPublished,
    nurseSamplesTaken: steps.includes("samples-collected") || steps.includes("samples-at-lab"),
    visitDone: steps.includes("completed") || attended ||
      !!facts.requests?.some((r) => r.status === "completed" && r.contextStale !== true) || !!facts.released?.length,
  };
}
export const STAGE_LABEL: Record<JourneyStage, Record<Locale, string>> = {
  questionnaire: { en: "Questions", hy: "Հարցաշար", ru: "Анкета" },
  // Short labels: four columns share a 340px phone width.
  tests: { en: "Tests", hy: "Թեստեր", ru: "Анализы" },
  results: { en: "Results", hy: "Արդյունք", ru: "Результаты" },
  plan: { en: "Plan", hy: "Պլան", ru: "План" },
};
