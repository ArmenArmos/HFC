import { z } from "zod";
import { selectIntervention, type Intervention, type Topic } from "./library";
import {
  eligibleEvidence,
  recordEvidence,
  type Acceptance,
  type Evidence,
} from "./outcomes";
export type Scenario =
  | "bp-forgot"
  | "bp-anxiety"
  | "medicine-travel"
  | "low-importance";
const id = z.string().min(1).max(160);
const timestamp = z.string().datetime({ offset: true });
const barrier = z.enum([
  "forgot",
  "anxiety",
  "travel",
  "importance",
  "symptoms",
  "device",
  "supply",
  "medicine-concern",
  "time-zone",
  "unknown",
]);
const payload = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("barriers"), barriers: z.array(barrier).max(10) })
    .strict(),
  z.object({ type: z.literal("offer"), initiated: z.boolean() }).strict(),
  ...(["alternative", "accept", "decline", "snooze", "tick"] as const).map(
    (type) => z.object({ type: z.literal(type) }).strict(),
  ),
  z
    .object({
      type: z.literal("settings"),
      coaching: z.enum(["on", "paused", "off"]),
      reminders: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("handoff"),
      result: z.enum(["simulated", "failed"]),
    })
    .strict(),
  z.object({ type: z.literal("safety"), urgent: z.boolean() }).strict(),
  z.object({ type: z.literal("next-event"), planId: id }).strict(),
  z
    .object({
      type: z.literal("report"),
      evidenceId: id,
      submissionId: id,
      actualAt: timestamp,
      value: z.string().trim().min(1).max(80),
      separate: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("correct"),
      evidenceId: id,
      expectedRevision: z.number().int().nonnegative(),
      actualAt: timestamp,
      value: z.string().trim().min(1).max(80),
    })
    .strict(),
  z
    .object({
      type: z.literal("remove"),
      evidenceId: id,
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
]);
const actionSchema = z
  .object({ id, eventId: id, planId: id, payload })
  .strict();
export type Action = z.infer<typeof actionSchema>;
type Log = {
  readonly action: Action;
  readonly at: string;
  readonly acceptance: Session["acceptance"];
  readonly evidence: readonly Evidence[];
  readonly offer: Intervention | null;
};
export type Session = {
  readonly scenario: Scenario;
  readonly event: {
    readonly id: string;
    readonly planId: string;
    readonly topic: Topic;
    readonly scheduledAt: string;
  };
  readonly barriers: readonly z.infer<typeof barrier>[];
  readonly coaching: "on" | "paused" | "off";
  readonly reminders: boolean;
  readonly offer: Intervention | null;
  readonly acceptance:
    | (Acceptance & {
        readonly interventionId: string;
        readonly interventionVersion: number;
      })
    | null;
  readonly urgent: boolean;
  readonly snooze: {
    readonly eventId: string;
    readonly planId: string;
    readonly requestedAt: string;
    readonly dueAt: string;
  } | null;
  readonly handoff: "none" | "simulated" | "failed";
  readonly declines: Readonly<Record<string, string>>;
  readonly evidence: readonly Evidence[];
  readonly logs: readonly Log[];
};
export type Rejection =
  | "invalid"
  | "conflict"
  | "stale"
  | "capacity"
  | "disabled"
  | "quiet"
  | "daily-limit"
  | "unconfirmed"
  | "clarify"
  | "exhausted"
  | "no-offer"
  | "urgent"
  | "completed"
  | "confirm-duplicate";
export type Result =
  | { kind: "accepted"; state: Session }
  | { kind: "retry" }
  | { kind: Rejection };
const DAY = 86_400_000;
export const LOG_LIMIT = 200;
function day(at: string) {
  return new Date(Date.parse(at) + 4 * 3_600_000).toISOString().slice(0, 10);
}
function quiet(at: string) {
  const hour = new Date(Date.parse(at) + 4 * 3_600_000).getUTCHours();
  return hour >= 21 || hour < 7;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function createSession(scenario: Scenario, now: string): Session {
  if (!Number.isFinite(Date.parse(now)))
    throw new Error("Invalid synthetic clock");
  return {
    scenario,
    event: {
      id: `synthetic:${scenario}:${day(now)}`,
      planId: "synthetic-plan:1",
      topic: scenario === "medicine-travel" ? "medicine" : "bp",
      scheduledAt: now,
    },
    barriers: [],
    urgent: false,
    coaching: "on",
    reminders: true,
    offer: null,
    acceptance: null,
    snooze: null,
    handoff: "none",
    declines: {},
    evidence: [],
    logs: [],
  };
}
function expire(state: Session, now: string): Session {
  const s = state.snooze;
  const expired =
    s &&
    (s.eventId !== state.event.id ||
      s.planId !== state.event.planId ||
      day(s.requestedAt) !== day(now) ||
      Date.parse(s.dueAt) <= Date.parse(now) ||
      quiet(now) ||
      !state.reminders ||
      state.coaching !== "on" ||
      state.evidence.some(
        (e) => !e.removed && e.eventId === s.eventId && e.planId === s.planId,
      ));
  return expired ? { ...state, snooze: null } : state;
}
export function transition(
  input: Session,
  action: Action,
  now: string,
): Result {
  if (
    !actionSchema.safeParse(action).success ||
    !timestamp.safeParse(now).success
  )
    return { kind: "invalid" };
  const prior = input.logs.find((l) => l.action.id === action.id);
  if (prior)
    return {
      kind:
        canonical(prior.action) === canonical(action) ? "retry" : "conflict",
    };
  if (action.eventId !== input.event.id || action.planId !== input.event.planId)
    return { kind: "stale" };
  if (input.logs.length >= LOG_LIMIT) return { kind: "capacity" };
  if (input.logs.some((l) => Date.parse(l.at) > Date.parse(now)))
    return { kind: "invalid" };
  let state = expire(input, now);
  const p = action.payload;
  const eventActions = [
    "offer",
    "alternative",
    "accept",
    "decline",
    "snooze",
    "report",
  ];
  if (
    eventActions.includes(p.type) &&
    day(state.event.scheduledAt) !== day(now)
  )
    return { kind: "stale" };
  if (
    state.urgent &&
    ["offer", "alternative", "accept", "snooze"].includes(p.type)
  )
    return { kind: "urgent" };
  if (p.type === "safety")
    state = {
      ...state,
      urgent: p.urgent,
      offer: null,
      acceptance: null,
      snooze: null,
    };
  else if (p.type === "next-event") {
    if (!p.planId.startsWith("synthetic-plan:")) return { kind: "invalid" };
    state = {
      ...state,
      event: {
        ...state.event,
        id: `synthetic:${state.scenario}:${day(now)}:${action.id}`,
        planId: p.planId,
        scheduledAt: now,
      },
      offer: null,
      acceptance: null,
      barriers: [],
      snooze: null,
      handoff: "none",
    };
  } else if (p.type === "report") {
    const recorded = recordEvidence(
      state.evidence,
      {
        id: p.evidenceId,
        submissionId: p.submissionId,
        eventId: state.event.id,
        planId: state.event.planId,
        actualAt: p.actualAt,
        reportedAt: now,
        value: p.value,
        removed: false,
        revision: 0,
      },
      p.separate ? "separate" : "new",
    );
    if (recorded.kind !== "recorded") return { kind: recorded.kind };
    state = expire({ ...state, evidence: recorded.rows }, now);
  } else if (p.type === "correct" || p.type === "remove") {
    const row = state.evidence.find((e) => e.id === p.evidenceId);
    if (
      !row ||
      row.eventId !== state.event.id ||
      row.planId !== state.event.planId
    )
      return { kind: "stale" };
    if (row.revision !== p.expectedRevision || row.removed)
      return { kind: "conflict" };
    if (
      p.type === "correct" &&
      (!p.value.trim() ||
        !Number.isFinite(Date.parse(p.actualAt)) ||
        Date.parse(p.actualAt) > Date.parse(now))
    )
      return { kind: "invalid" };
    const updated = {
      ...row,
      ...(p.type === "correct"
        ? { actualAt: p.actualAt, value: p.value }
        : { removed: true }),
      reportedAt: now,
      revision: row.revision + 1,
    };
    state = expire(
      {
        ...state,
        evidence: state.evidence.map((e) => (e.id === row.id ? updated : e)),
      },
      now,
    );
  } else if (p.type === "settings")
    state = expire(
      {
        ...state,
        coaching: p.coaching,
        reminders: p.reminders,
        offer: p.coaching === "on" ? state.offer : null,
        acceptance: p.coaching === "on" ? state.acceptance : null,
      },
      now,
    );
  else if (p.type === "barriers")
    state = {
      ...state,
      barriers: [...new Set(p.barriers)],
      offer: null,
      acceptance: null,
    };
  else if (p.type === "handoff")
    state = { ...state, handoff: p.result, offer: null, acceptance: null };
  else if (p.type === "offer" || p.type === "alternative") {
    if (state.coaching !== "on") return { kind: "disabled" };
    if (p.type === "offer" && !p.initiated && quiet(now))
      return { kind: "quiet" };
    const today = state.logs.filter((l) => day(l.at) === day(now));
    if (
      p.type === "offer" &&
      today.some((l) => l.action.payload.type === "offer")
    )
      return { kind: "daily-limit" };
    if (
      p.type === "alternative" &&
      today.some((l) => l.action.payload.type === "alternative")
    )
      return { kind: "daily-limit" };
    if (p.type === "alternative" && !state.offer) return { kind: "no-offer" };
    const excluded = Object.entries(state.declines)
      .filter(([, at]) => Date.parse(now) - Date.parse(at) < 14 * DAY)
      .map(([id]) => id);
    if (p.type === "alternative" && state.offer) excluded.push(state.offer.id);
    const selected = selectIntervention({
      topic: state.event.topic,
      barriers: state.barriers,
      excludedIds: excluded,
    });
    if (!selected.intervention) return { kind: selected.reason };
    state = { ...state, offer: selected.intervention, acceptance: null };
  } else if (p.type === "accept" || p.type === "decline") {
    if (state.coaching !== "on") return { kind: "disabled" };
    if (
      !state.offer ||
      (p.type === "accept" &&
        (state.acceptance || state.offer.kind === "human"))
    )
      return { kind: "no-offer" };
    if (p.type === "accept")
      state = {
        ...state,
        acceptance: {
          eventId: state.event.id,
          planId: state.event.planId,
          acceptedAt: now,
          interventionId: state.offer.id,
          interventionVersion: state.offer.version,
        },
      };
    else
      state = {
        ...state,
        declines: { ...state.declines, [state.offer.id]: now },
        offer: null,
        acceptance: null,
      };
  } else if (p.type === "snooze") {
    if (
      state.evidence.some(
        (e) =>
          !e.removed &&
          e.eventId === state.event.id &&
          e.planId === state.event.planId,
      )
    )
      return { kind: "completed" };
    if (!state.reminders || state.coaching !== "on")
      return { kind: "disabled" };
    const dueAt = new Date(Date.parse(now) + 3_600_000).toISOString();
    if (quiet(now) || quiet(dueAt) || day(now) !== day(dueAt))
      return { kind: "quiet" };
    state = {
      ...state,
      snooze: {
        eventId: state.event.id,
        planId: state.event.planId,
        requestedAt: now,
        dueAt,
      },
    };
  }
  return {
    kind: "accepted",
    state: {
      ...state,
      logs: [
        ...state.logs,
        {
          action: structuredClone(action),
          at: now,
          acceptance: state.acceptance,
          evidence: state.evidence,
          offer: state.offer,
        },
      ],
    },
  };
}
export function deriveOutcome(state: Session): string[] {
  // Consent/offer changes do not rewrite historical acceptance. The evidence's
  // current revision can still retract an association by changing actual time
  // or removing the report. This is temporal association, never effectiveness.
  const acceptances = state.logs
    .filter((log) => log.action.payload.type === "accept" && log.acceptance)
    .map((log) => log.acceptance!);
  return [
    ...new Set(
      acceptances.flatMap((acceptance) =>
        eligibleEvidence(state.evidence, acceptance),
      ),
    ),
  ];
}
