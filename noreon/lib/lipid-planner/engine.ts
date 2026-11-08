/**
 * The lipid follow-up planner's engine. Pure and deterministic: no database, no clock, no model. It knows nothing about
 * lipids: it takes a ruleset (lib/lipid-planner/rules, versioned configuration) and facts (lib/lipid-planner/facts.ts),
 * evaluates each rule to TRUE, FALSE or UNKNOWN, and turns the results into a timeline and notes for the doctor.
 *
 * Three-valued logic throughout: UNKNOWN is carried, never read as FALSE or as normal. A rule that is UNKNOWN does not
 * act; it reports what is missing.
 */
export type Tri = "TRUE" | "FALSE" | "UNKNOWN";
/** Staff copy: English, Armenian, Russian. Armenian and Russian are UNAPPROVED v1 (Tatevik; clinical wording Armen and Yesayi). */
export type L3 = readonly [en: string, hy: string, ru: string];
export type Condition<F extends string> = { fact: F } | { not: Condition<F> } | { all: readonly Condition<F>[] } | { any: readonly Condition<F>[] };

export const triNot = (a: Tri): Tri => (a === "TRUE" ? "FALSE" : a === "FALSE" ? "TRUE" : "UNKNOWN");
export const triAll = (r: readonly Tri[]): Tri => (r.includes("FALSE") ? "FALSE" : r.includes("UNKNOWN") ? "UNKNOWN" : "TRUE");
export const triAny = (r: readonly Tri[]): Tri => (r.includes("TRUE") ? "TRUE" : r.includes("UNKNOWN") ? "UNKNOWN" : "FALSE");

export function evaluate<F extends string>(c: Condition<F>, tri: Record<F, Tri>): Tri {
  if ("fact" in c) return tri[c.fact];
  if ("not" in c) return triNot(evaluate(c.not, tri));
  return ("all" in c ? triAll : triAny)(("all" in c ? c.all : c.any).map((x) => evaluate(x, tri)));
}

/** The facts that keep a condition UNKNOWN: learning any of them could settle it. Empty when it is already settled. */
export function unknownFacts<F extends string>(c: Condition<F>, tri: Record<F, Tri>): F[] {
  if (evaluate(c, tri) !== "UNKNOWN") return [];
  if ("fact" in c) return [c.fact];
  if ("not" in c) return unknownFacts(c.not, tri);
  return [...new Set(("all" in c ? c.all : c.any).flatMap((x) => unknownFacts(x, tri)))];
}

export type Interval = { weeks: number } | { years: number };
const DAY = 86400000;
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** 1 week is 7 days. A year keeps the calendar date; 29 February moves to 1 March. */
export function addInterval(day: string, i: Interval) {
  if ("weeks" in i) return addDays(day, i.weeks * 7);
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + i.years);
  return d.toISOString().slice(0, 10);
}

export type TimelineStatus = "scheduled" | "due_now" | "overdue";
/** Scheduled before the window, due now on every day of it, first and last included, overdue the day after. */
export const windowStatus = (from: string, to: string, today: string): TimelineStatus => (today < from ? "scheduled" : today <= to ? "due_now" : "overdue");

export type RuleStatus = "proposed";
export type RuleOutcome<D extends string, T extends string> =
  | {
      kind: "test";
      test: T;
      /** Rules in one group are alternatives for one line on the timeline. */
      group: string;
      anchor: D;
      from: Interval;
      to: Interval;
      /** Reviewed results of this test on or after `from` count as done. Absent: the item is never marked done. */
      doneBy?: T;
      /** A window the doctor confirmed replaces the rule's dates. */
      confirmedWindow?: boolean;
      /** Show this line only while the rule applies, never as an undated line. */
      onlyWhenTrue?: boolean;
    }
  | { kind: "gap" | "question"; text: L3 }
  | { kind: "goal_check" };
export type Rule<F extends string, D extends string, T extends string, S extends string, O extends string> = {
  id: string;
  /** Proposed until Armen and Yesayi sign it. The card shows this. */
  status: RuleStatus;
  title: L3;
  when: Condition<F>;
  then: RuleOutcome<D, T>;
  sources: readonly S[];
  /** Guidance that differs: shown open whenever this rule is not FALSE, never resolved here. */
  open?: readonly O[];
};
export type Ruleset<F extends string, D extends string, T extends string, S extends string, O extends string> = {
  version: string;
  status: RuleStatus;
  rules: readonly Rule<F, D, T, S, O>[];
  /** What to tell the doctor when a fact is UNKNOWN. Null: another part of the card already says so. */
  factLabels: Record<F, L3 | null>;
};

export type EngineFacts<F extends string, D extends string, T extends string> = {
  today: string;
  tri: Record<F, Tri>;
  dates: Record<D, string | null>;
  /** Days with a reviewed result, by test. */
  results: Partial<Record<T, readonly string[]>>;
  /** The open window the doctor confirmed, if any. */
  confirmed: { from: string; to: string } | null;
};

export type TimelineItem<T extends string> =
  | { ruleId: string; test: T; state: "dated"; status: TimelineStatus; from: string; to: string; anchorOn: string | null; confirmed: boolean }
  | { ruleId: string; test: T; state: "done"; doneOn: string; from: string; to: string; anchorOn: string | null; confirmed: boolean }
  /** The rule cannot be dated yet. Never shown as scheduled. */
  | { ruleId: string; test: T; state: "undated"; missing: string[] };
export type Decision<S extends string> = { ruleId: string; title: L3; status: RuleStatus; result: Tri; unknown: string[]; sources: readonly S[] };
export type Note = { kind: "gap" | "question"; ruleIds: string[]; text: L3 };
export type EngineResult<T extends string, S extends string, O extends string> = {
  rulesVersion: string;
  rulesStatus: RuleStatus;
  today: string;
  decisions: Decision<S>[];
  timeline: TimelineItem<T>[];
  notes: Note[];
  open: O[];
};

const order = (i: TimelineItem<string>) => (i.state === "dated" ? { overdue: 0, due_now: 1, scheduled: 2 }[i.status] : i.state === "undated" ? 3 : 4);

export function runRules<F extends string, D extends string, T extends string, S extends string, O extends string>(set: Ruleset<F, D, T, S, O>, facts: EngineFacts<F, D, T>): EngineResult<T, S, O> {
  const decisions: Decision<S>[] = [], timeline: TimelineItem<T>[] = [], notes: Note[] = [], open: O[] = [];
  const addNote = (kind: Note["kind"], text: L3, ruleId: string) => {
    const same = notes.find((n) => n.kind === kind && n.text[0] === text[0]);
    if (same) { if (!same.ruleIds.includes(ruleId)) same.ruleIds.push(ruleId); }
    else notes.push({ kind, ruleIds: [ruleId], text });
  };
  const results = set.rules.map((rule) => ({ rule, result: evaluate(rule.when, facts.tri), unknown: unknownFacts(rule.when, facts.tri) }));
  const groupApplies = new Set(results.flatMap((r) => (r.result === "TRUE" && r.rule.then.kind === "test" ? [r.rule.then.group] : [])));
  const placed = new Set<string>();
  for (const { rule, result, unknown } of results) {
    decisions.push({ ruleId: rule.id, title: rule.title, status: rule.status, result, unknown, sources: rule.sources });
    if (result !== "FALSE") for (const o of rule.open ?? []) if (!open.includes(o)) open.push(o);
    for (const f of unknown) { const label = set.factLabels[f]; if (label) addNote("gap", label, rule.id); }
    const t = rule.then;
    if (t.kind === "gap" || t.kind === "question") { if (result === "TRUE") addNote(t.kind, t.text, rule.id); continue; }
    if (t.kind !== "test" || result === "FALSE" || placed.has(t.group)) continue;
    // UNKNOWN: only when no alternative in the group applies. A doctor's confirmed window stands whatever the rule says.
    const confirmed = t.confirmedWindow ? facts.confirmed : null;
    if (result === "UNKNOWN" && !confirmed) {
      if (t.onlyWhenTrue || groupApplies.has(t.group)) continue;
      placed.add(t.group);
      timeline.push({ ruleId: rule.id, test: t.test, state: "undated", missing: unknown });
      continue;
    }
    placed.add(t.group);
    const anchorOn = facts.dates[t.anchor];
    if (!confirmed && !anchorOn) {
      timeline.push({ ruleId: rule.id, test: t.test, state: "undated", missing: [t.anchor] });
      continue;
    }
    const from = confirmed?.from ?? addInterval(anchorOn!, t.from), to = confirmed?.to ?? addInterval(anchorOn!, t.to);
    const doneOn = t.doneBy ? facts.results[t.doneBy]?.filter((day) => day >= from && day <= facts.today).sort()[0] : undefined;
    timeline.push(doneOn
      ? { ruleId: rule.id, test: t.test, state: "done", doneOn, from, to, anchorOn, confirmed: !!confirmed }
      : { ruleId: rule.id, test: t.test, state: "dated", status: windowStatus(from, to, facts.today), from, to, anchorOn, confirmed: !!confirmed });
  }
  timeline.sort((a, b) => order(a) - order(b) || ("from" in a && "from" in b ? a.from.localeCompare(b.from) : 0));
  return { rulesVersion: set.version, rulesStatus: set.status, today: facts.today, decisions, timeline, notes, open };
}
