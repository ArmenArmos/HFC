import assert from "node:assert/strict";
import {
  createSession,
  transition,
  deriveOutcome,
  LOG_LIMIT,
  type Action,
  type Session,
} from "../lib/zoe-synthetic/model";
const start = "2026-10-12T08:00:00Z";
let serial = 0;
function act(state: Session, payload: Action["payload"], now = start) {
  return transition(
    state,
    {
      id: `action:${++serial}`,
      eventId: state.event.id,
      planId: state.event.planId,
      payload,
    },
    now,
  );
}
function accepted(
  state: Session,
  payload: Action["payload"],
  now = start,
): Session {
  const result = act(state, payload, now);
  assert.equal(result.kind, "accepted", JSON.stringify(result));
  if (result.kind !== "accepted") throw new Error("unreachable");
  return result.state;
}
let state = createSession("bp-forgot", start);
assert.equal(state.evidence.length, 0);
state = accepted(state, { type: "barriers", barriers: ["forgot"] });
const offer = {
  id: "offer:1",
  eventId: state.event.id,
  planId: state.event.planId,
  payload: { type: "offer", initiated: true },
} as const;
const first = transition(state, offer, start);
assert.equal(first.kind, "accepted");
if (first.kind !== "accepted") throw new Error("unreachable");
state = first.state;
assert.equal(transition(state, offer, start).kind, "retry");
assert.equal(
  transition(
    state,
    { ...offer, payload: { type: "offer", initiated: false } },
    start,
  ).kind,
  "conflict",
);
assert.equal(
  act(state, { type: "offer", initiated: true }).kind,
  "daily-limit",
);
state = accepted(state, { type: "accept" });
assert.equal(state.acceptance?.acceptedAt, start);
state = accepted(state, { type: "alternative" });
assert.equal(act(state, { type: "alternative" }).kind, "daily-limit");
state = accepted(state, { type: "decline" });
assert.equal(state.acceptance, null);
assert.equal(state.evidence.length, 0, "help never records skipped");
let paused = accepted(createSession("bp-forgot", start), {
  type: "settings",
  coaching: "paused",
  reminders: true,
});
paused = accepted(paused, { type: "barriers", barriers: ["forgot"] });
assert.equal(act(paused, { type: "offer", initiated: true }).kind, "disabled");
assert.equal(
  act(paused, { type: "handoff", result: "failed" }).kind,
  "accepted",
);
const quiet = accepted(createSession("bp-forgot", start), {
  type: "barriers",
  barriers: ["forgot"],
});
assert.equal(
  act(quiet, { type: "offer", initiated: false }, "2026-10-12T17:00:00Z").kind,
  "quiet",
);
assert.equal(
  act(quiet, { type: "offer", initiated: true }, "2026-10-12T17:00:00Z").kind,
  "accepted",
);
let snoozed = accepted(createSession("bp-forgot", start), { type: "snooze" });
assert.ok(snoozed.snooze);
snoozed = accepted(snoozed, { type: "tick" }, "2026-10-13T08:00:00Z");
assert.equal(snoozed.snooze, null);
assert.equal(
  transition(state, { ...offer, id: "stale", planId: "other" }, start).kind,
  "stale",
);
for (const scenario of [
  "bp-forgot",
  "bp-anxiety",
  "medicine-travel",
  "low-importance",
] as const) {
  assert.equal(createSession(scenario, start).scenario, scenario);
}
console.log(
  "Synthetic Zoe session limits, retry conflicts, consent and stale snoozes passed",
);

// These checks require audited evidence transitions, not direct state mutation.
let evidenceState = accepted(createSession("bp-forgot", start), {
  type: "barriers",
  barriers: ["forgot"],
});
evidenceState = accepted(evidenceState, { type: "offer", initiated: true });
evidenceState = accepted(evidenceState, { type: "accept" });
assert.equal(evidenceState.acceptance?.interventionId, "bp-cue");
evidenceState = accepted(evidenceState, {
  type: "report",
  evidenceId: "observation:1",
  submissionId: "report:1",
  actualAt: "2026-10-12T07:00:00Z",
  value: "120/80",
  separate: false,
});
assert.deepEqual(deriveOutcome(evidenceState), []);
evidenceState = accepted(evidenceState, {
  type: "correct",
  evidenceId: "observation:1",
  expectedRevision: 0,
  actualAt: start,
  value: "120/80",
});
assert.deepEqual(deriveOutcome(evidenceState), ["observation:1"]);
assert.equal(
  act(evidenceState, {
    type: "correct",
    evidenceId: "observation:1",
    expectedRevision: 0,
    actualAt: start,
    value: "120/80",
  }).kind,
  "conflict",
);
assert.equal(act(evidenceState, { type: "snooze" }).kind, "completed");
evidenceState = accepted(evidenceState, {
  type: "remove",
  evidenceId: "observation:1",
  expectedRevision: 1,
});
assert.deepEqual(deriveOutcome(evidenceState), []);
assert.ok(evidenceState.logs.some((l) => l.action.payload.type === "report"));
assert.ok(evidenceState.logs.some((l) => l.action.payload.type === "correct"));
assert.ok(evidenceState.logs.some((l) => l.action.payload.type === "remove"));
assert.equal(
  act(evidenceState, { type: "offer", initiated: true }, "2026-10-13T08:00:00Z")
    .kind,
  "stale",
);
let urgent = accepted(createSession("bp-forgot", start), {
  type: "safety",
  urgent: true,
});
urgent = accepted(urgent, { type: "barriers", barriers: ["forgot"] });
assert.equal(act(urgent, { type: "offer", initiated: true }).kind, "urgent");
assert.equal(act(urgent, { type: "snooze" }).kind, "urgent");
assert.equal(
  act(urgent, { type: "handoff", result: "simulated" }).kind,
  "accepted",
);
let planChanged = accepted(createSession("bp-forgot", start), {
  type: "snooze",
});
const oldEvent = planChanged.event;
planChanged = accepted(planChanged, {
  type: "next-event",
  planId: "synthetic-plan:2",
});
assert.equal(planChanged.snooze, null);
assert.equal(
  transition(
    planChanged,
    {
      id: "old-plan",
      eventId: oldEvent.id,
      planId: oldEvent.planId,
      payload: { type: "snooze" },
    },
    start,
  ).kind,
  "stale",
);
let cooldown = accepted(createSession("medicine-travel", start), {
  type: "barriers",
  barriers: ["travel"],
});
cooldown = accepted(cooldown, { type: "offer", initiated: true });
cooldown = accepted(cooldown, { type: "decline" });
cooldown = accepted(
  cooldown,
  { type: "next-event", planId: cooldown.event.planId },
  "2026-10-25T08:00:00Z",
);
cooldown = accepted(
  cooldown,
  { type: "barriers", barriers: ["travel"] },
  "2026-10-25T08:00:00Z",
);
assert.equal(
  act(cooldown, { type: "offer", initiated: true }, "2026-10-25T08:00:00Z")
    .kind,
  "exhausted",
);
cooldown = accepted(
  cooldown,
  { type: "next-event", planId: cooldown.event.planId },
  "2026-10-26T08:00:00Z",
);
cooldown = accepted(
  cooldown,
  { type: "barriers", barriers: ["travel"] },
  "2026-10-26T08:00:00Z",
);
assert.equal(
  act(cooldown, { type: "offer", initiated: true }, "2026-10-26T08:00:00Z")
    .kind,
  "accepted",
);
let bounded = createSession("bp-forgot", start);
for (let i = 0; i < LOG_LIMIT; i++)
  bounded = accepted(bounded, { type: "tick" });
assert.equal(act(bounded, { type: "tick" }).kind, "capacity");
console.log(
  "Synthetic Zoe audited corrections, safety, plan changes and cooldown boundaries passed",
);
assert.equal(
  transition(
    createSession("bp-forgot", start),
    {
      id: "bad",
      eventId: "x",
      planId: "x",
      payload: { type: "bogus" },
    } as unknown as Action,
    start,
  ).kind,
  "invalid",
);
assert.equal(
  transition(
    createSession("bp-forgot", start),
    {
      id: "bad",
      eventId: "x",
      planId: "x",
      payload: { type: "barriers", barriers: ["invented"] },
    } as unknown as Action,
    start,
  ).kind,
  "invalid",
);
assert.ok(
  evidenceState.logs.some((l) => l.acceptance?.interventionId === "bp-cue"),
  "acceptance provenance survives retraction",
);
assert.ok(
  evidenceState.logs.some((l) =>
    l.evidence.some((e) => e.revision === 0 && !e.removed),
  ),
  "original evidence survives correction",
);
let repeatedAccept = accepted(createSession("bp-forgot", start), {
  type: "barriers",
  barriers: ["forgot"],
});
repeatedAccept = accepted(repeatedAccept, { type: "offer", initiated: true });
repeatedAccept = accepted(repeatedAccept, { type: "accept" });
assert.equal(
  act(repeatedAccept, { type: "accept" }, "2026-10-12T09:00:00Z").kind,
  "no-offer",
);
let human = accepted(createSession("bp-anxiety", start), {
  type: "barriers",
  barriers: ["anxiety"],
});
human = accepted(human, { type: "offer", initiated: true });
assert.equal(act(human, { type: "accept" }).kind, "no-offer");
let historical = accepted(createSession("bp-forgot", start), {
  type: "barriers",
  barriers: ["forgot"],
});
historical = accepted(historical, { type: "offer", initiated: true });
historical = accepted(historical, { type: "accept" });
historical = accepted(historical, {
  type: "report",
  evidenceId: "history:1",
  submissionId: "history-report:1",
  actualAt: start,
  value: "120/80",
  separate: false,
});
for (const payload of [
  { type: "settings", coaching: "paused", reminders: true },
  { type: "barriers", barriers: ["importance"] },
  { type: "handoff", result: "simulated" },
  { type: "safety", urgent: true },
] satisfies Action["payload"][]) {
  const changed = accepted(historical, payload);
  assert.deepEqual(deriveOutcome(changed), ["history:1"]);
}
historical = accepted(historical, {
  type: "settings",
  coaching: "paused",
  reminders: true,
});
historical = accepted(historical, {
  type: "correct",
  evidenceId: "history:1",
  expectedRevision: 0,
  actualAt: "2026-10-12T07:00:00Z",
  value: "120/80",
});
assert.deepEqual(deriveOutcome(historical), []);
historical = accepted(historical, {
  type: "correct",
  evidenceId: "history:1",
  expectedRevision: 1,
  actualAt: start,
  value: "120/80",
});
assert.deepEqual(deriveOutcome(historical), ["history:1"]);
historical = accepted(historical, {
  type: "remove",
  evidenceId: "history:1",
  expectedRevision: 2,
});
assert.deepEqual(deriveOutcome(historical), []);
