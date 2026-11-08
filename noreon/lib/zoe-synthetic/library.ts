/** Synthetic, reviewable copy. Never use this library as live clinical advice. */
export type Topic = "bp" | "medicine";
export type Barrier =
  | "forgot"
  | "anxiety"
  | "travel"
  | "importance"
  | "symptoms"
  | "device"
  | "supply"
  | "medicine-concern"
  | "time-zone"
  | "unknown";
export type Intervention = {
  readonly id: string;
  readonly version: 1;
  readonly source: "Yesai synthetic scope / HTML6 review";
  readonly approval: "synthetic-only";
  readonly topics: readonly Topic[];
  readonly barriers: readonly Barrier[];
  readonly kind: "routine" | "reflection" | "human";
  readonly copy: { readonly en: string; readonly hy: string };
};
const item = (
  id: string,
  topics: readonly Topic[],
  barriers: readonly Barrier[],
  kind: Intervention["kind"],
  en: string,
  hy: string,
): Intervention => ({
  id,
  version: 1,
  source: "Yesai synthetic scope / HTML6 review",
  approval: "synthetic-only",
  topics,
  barriers,
  kind,
  copy: { en, hy },
});
export const INTERVENTIONS: readonly Intervention[] = [
  item(
    "human-concern",
    ["bp", "medicine"],
    [
      "anxiety",
      "symptoms",
      "device",
      "supply",
      "medicine-concern",
      "time-zone",
    ],
    "human",
    "You can explore a simulated request for human support. No one is contacted by this preview. Your clinical questions need your care team.",
    "Կարող եք փորձարկել աջակցության հարցման օրինակը։ Այս նախադիտումը ոչ մեկի հետ չի կապվում։ Կլինիկական հարցերով դիմեք ձեր խնամքի թիմին։",
  ),
  item(
    "bp-cue",
    ["bp"],
    ["forgot"],
    "routine",
    "Would a visible note help you remember your existing blood-pressure task? This does not change your care-plan instructions.",
    "Տեսանելի գրառումը կօգնի՞ հիշել ճնշման չափման ձեր առաջադրանքը։ Սա չի փոխում ձեր խնամքի պլանի ցուցումները։",
  ),
  item(
    "bp-checklist",
    ["bp"],
    ["forgot"],
    "routine",
    "Would adding your existing blood-pressure task to your daily checklist help?",
    "Ճնշման չափման առաջադրանքը ձեր ամենօրյա ցանկում ավելացնելը կօգնի՞։",
  ),
  item(
    "medicine-checklist",
    ["medicine"],
    ["forgot"],
    "routine",
    "Would a checklist help you keep track of your existing medicine schedule? Follow your prescribed instructions.",
    "Ցանկը կօգնի՞ հետևել դեղերի ընդունման ձեր ժամանակացույցին։ Հետևեք նշանակված ցուցումներին։",
  ),
  item(
    "travel-reflection",
    ["medicine"],
    ["travel"],
    "reflection",
    "What part of your usual routine changes when you travel? This example does not recommend changes to medicine timing. For time-zone or dose questions, choose human support.",
    "Ճամփորդելիս ձեր առօրյայի ո՞ր մասն է փոխվում։ Այս օրինակը դեղի ընդունման ժամի փոփոխություն չի առաջարկում։ Ժամային գոտու կամ դեղաչափի հարցերով ընտրեք մասնագետի աջակցությունը։",
  ),
  item(
    "importance-reflection",
    ["bp", "medicine"],
    ["importance"],
    "reflection",
    "What would you like your care team to explain about this task? You can ask for human support without accepting a suggestion.",
    "Ի՞նչ կցանկանայիք, որ ձեր խնամքի թիմը բացատրեր այս առաջադրանքի մասին։ Կարող եք աջակցություն խնդրել՝ առանց առաջարկն ընդունելու։",
  ),
];
export type Selection =
  | { intervention: Intervention; reason?: never }
  | { intervention?: never; reason: "unconfirmed" | "clarify" | "exhausted" };
/** Explicit barriers only. A concern always takes precedence over a routine cue. */
export function selectIntervention(input: {
  topic: Topic;
  barriers: readonly Barrier[];
  excludedIds?: readonly string[];
}): Selection {
  const barriers = [...new Set(input.barriers)];
  const candidates = INTERVENTIONS.filter(
    (i) =>
      i.topics.includes(input.topic) &&
      i.barriers.some((b) => barriers.includes(b)),
  );
  const human = candidates.find((i) => i.kind === "human");
  // Human support is never exhausted by behavioral cooldowns or previous suggestions.
  if (human) return { intervention: human };
  if (!barriers.length || barriers.every((b) => b === "unknown"))
    return { reason: "unconfirmed" };
  if (barriers.length > 1) return { reason: "clarify" };
  const intervention = candidates.find(
    (i) => !input.excludedIds?.includes(i.id),
  );
  return intervention ? { intervention } : { reason: "exhausted" };
}
