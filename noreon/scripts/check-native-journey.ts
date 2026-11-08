import assert from "node:assert/strict";
import { createNativeJourneyHandler } from "@/lib/patient/native-journey";
import { CONSENT_VERSION, type PatientStore } from "@/lib/patient/service";
import type { PatientState } from "@/lib/patient/types";
const profile = {
  name: "Fictional member",
  birthDate: "1974-05-18",
  biologicalSex: "male" as const,
  locale: "en" as const,
};
const state: PatientState = {
  profile: { ...profile, userId: "verified-owner" },
  consentAccepted: true,
  assessment: {
    id: "draft",
    revision: 2,
    assessmentDate: "2026-10-12",
    answers: {},
    completedAt: null,
    urgentRule: null,
  },
};
let writes = 0,
  owner = "",
  lookups = 0,
  receivedToken = "";
const store: PatientStore = {
  read: async () => state,
  profile: async (id) => {
    writes++;
    owner = id;
    return 3;
  },
  assessment: async (id) => {
    writes++;
    owner = id;
    return 3;
  },
  measurement: async () => {
    throw Error("unsupported");
  },
};
const context = async (token: string) => {
  lookups++;
  receivedToken = token;
  return {
    admit: async () => ({ allowed: true, retry_after: 0 }),
    user: { userId: "verified-owner", phone: "+37491123456" },
    store,
  };
};
const handle = createNativeJourneyHandler({ enabled: () => true, context });
function request(body?: unknown, headers: Record<string, string> = {}) {
  return new Request("https://app.noreon.health/api/native/journey", {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: "Bearer token",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const command = {
  type: "profile",
  profile,
  consent: true,
  consentVersion: CONSENT_VERSION,
  expectedRevision: 2,
};
assert.equal(
  (
    await createNativeJourneyHandler({ enabled: () => false, context })(
      request(),
    )
  ).status,
  503,
);
assert.equal(lookups, 0);
for (const authorization of [
  "",
  "Basic token",
  "Bearer a b",
  "Bearer " + "a".repeat(9000),
])
  assert.equal(
    (
      await handle(
        request(undefined, { authorization, cookie: "valid-looking-cookie" }),
      )
    ).status,
    401,
  );
assert.equal(lookups, 0);
assert.equal(
  (
    await createNativeJourneyHandler({
      enabled: () => true,
      context: async () => null,
    })(request())
  ).status,
  401,
);
const get = await handle(request());
assert.equal(get.status, 200);
assert.equal(get.headers.get("cache-control"), "no-store");
assert.deepEqual(await get.json(), { state, consentVersion: CONSENT_VERSION });
assert.equal(receivedToken, "token");
assert.equal((await handle(request(command))).status, 200);
assert.equal(owner, "verified-owner");
assert.equal(
  (await handle(request({ ...command, expectedRevision: 1 }))).status,
  409,
);
assert.equal(writes, 1);
for (const body of [
  null,
  [],
  {},
  { ...command, userId: "other" },
  { ...command, profile: { ...profile, userId: "other" } },
  { ...command, consent: false },
  { ...command, consentVersion: "invented" },
  { ...command, expectedRevision: null },
  {
    type: "answers",
    expectedRevision: 2,
    entries: [{ fieldId: "q1.age", value: 50 }],
  },
  {
    type: "answers",
    expectedRevision: 2,
    entries: [{ fieldId: "q3.status", value: "never", source: "doctor" }],
  },
  { type: "complete", expectedRevision: 2, urgentRule: null },
])
  assert.equal((await handle(request(body))).status, 400, JSON.stringify(body));
assert.equal(writes, 1);
assert.equal(
  (await handle(request({ type: "complete", expectedRevision: 2 }))).status,
  400,
  "incomplete questionnaire",
);
assert.equal(
  (
    await handle(
      request({
        type: "answers",
        expectedRevision: 2,
        entries: [{ fieldId: "q3.status", value: "never" }],
      }),
    )
  ).status,
  200,
);
assert.equal(writes, 2);
assert.equal(
  (await handle(request(command, { origin: "https://evil.example" }))).status,
  401,
);
assert.equal(
  (await handle(request(command, { "content-type": "text/plain" }))).status,
  400,
);
assert.equal(
  (await handle(request({ ...command, padding: "x".repeat(17000) }))).status,
  400,
);
// Body may never deliver or cancel. Deadline must still settle without writes.
const stalled = new Request("https://app.noreon.health/api/native/journey", {
  method: "POST",
  headers: {
    authorization: "Bearer token",
    "content-type": "application/json",
  },
  body: new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      return new Promise(() => {});
    },
  }),
  duplex: "half",
} as RequestInit);
assert.equal(
  (
    await createNativeJourneyHandler({
      enabled: () => true,
      context,
      timeoutMs: 20,
    })(stalled)
  ).status,
  503,
);
assert.equal(writes, 2);
let release!: () => void;
const slowRead: PatientStore = {
  ...store,
  read: async () => {
    await new Promise<void>((r) => (release = r));
    return state;
  },
};
const slow = createNativeJourneyHandler({
  enabled: () => true,
  context: async () => ({
    admit: async () => ({ allowed: true, retry_after: 0 }),
    user: { userId: "verified-owner", phone: "+37491123456" },
    store: slowRead,
  }),
  timeoutMs: 20,
});
assert.equal((await slow(request(command))).status, 503);
release();
await new Promise((r) => setTimeout(r, 5));
assert.equal(writes, 2, "no privileged continuation after read timeout");
const fail = createNativeJourneyHandler({
  enabled: () => true,
  context: async () => {
    throw Error("secret provider details");
  },
});
const error = await fail(request());
assert.equal(error.status, 503);
assert.deepEqual(await error.json(), { error: "unavailable" });
console.log(
  "Native journey: bearer-only owner binding, strict commands, consent/revision guards, bounded streams and late-write isolation pass.",
);
// Uncertain HTTP results require re-read; a database revision conflict is explicit.
const conflict = createNativeJourneyHandler({
  enabled: () => true,
  context: async () => ({
    admit: async () => ({ allowed: true, retry_after: 0 }),
    user: { userId: "verified-owner", phone: "+37491123456" },
    store: { ...store, profile: async () => -1 },
  }),
});
assert.equal((await conflict(request(command))).status, 409);
const initial = createNativeJourneyHandler({
  enabled: () => true,
  context: async () => ({
    admit: async () => ({ allowed: true, retry_after: 0 }),
    user: { userId: "verified-owner", phone: "+37491123456" },
    store: {
      ...store,
      read: async () => ({
        profile: null,
        consentAccepted: false,
        assessment: null,
      }),
    },
  }),
});
assert.equal(
  (await initial(request({ ...command, expectedRevision: -1 }))).status,
  200,
);
let lateAuth!: () => void,
  lateReads = 0;
const stalledAuth = createNativeJourneyHandler({
  enabled: () => true,
  timeoutMs: 20,
  context: async () => {
    await new Promise<void>((r) => (lateAuth = r));
    return {
      admit: async () => ({ allowed: true, retry_after: 0 }),
      user: { userId: "verified-owner", phone: "+37491123456" },
      store: {
        ...store,
        read: async () => {
          lateReads++;
          return state;
        },
      },
    };
  },
});
assert.equal((await stalledAuth(request())).status, 503);
lateAuth();
await new Promise((r) => setTimeout(r, 5));
assert.equal(lateReads, 0);
const abortController = new AbortController();
abortController.abort();
const lookupBefore = lookups;
assert.equal(
  (await handle(new Request(request(), { signal: abortController.signal })))
    .status,
  503,
);
assert.equal(lookups, lookupBefore);
console.log(
  "Native journey: initial profile, database race, late auth and already-aborted request checks pass.",
);
const urgentState: PatientState = {
  ...state,
  assessment: {
    ...state.assessment!,
    answers: {
      "q9.present": {
        fieldId: "q9.present",
        value: "yes",
        source: "manual",
        answeredAt: "2026-10-12T00:00:00Z",
      },
      "q9.right_now": {
        fieldId: "q9.right_now",
        value: "yes",
        source: "manual",
        answeredAt: "2026-10-12T00:00:00Z",
      },
    },
  },
};
let urgent: string | null = null,
  completed = true;
const emergency = createNativeJourneyHandler({
  enabled: () => true,
  context: async () => ({
    admit: async () => ({ allowed: true, retry_after: 0 }),
    user: { userId: "verified-owner", phone: "+37491123456" },
    store: {
      ...store,
      read: async () => urgentState,
      assessment: async (_id, _revision, _answers, complete, rule) => {
        urgent = rule;
        completed = complete;
        return 3;
      },
    },
  }),
});
assert.equal(
  (
    await emergency(
      request({
        type: "answers",
        expectedRevision: 2,
        entries: [{ fieldId: "q9.right_now", value: "yes" }],
      }),
    )
  ).status,
  200,
);
assert.equal(urgent, "RF-01");
assert.equal(completed, false);
assert.equal(
  (await emergency(request({ type: "complete", expectedRevision: 2 }))).status,
  400,
);
console.log(
  "Native journey: shared emergency rule prevents completion and reaches persistence.",
);
