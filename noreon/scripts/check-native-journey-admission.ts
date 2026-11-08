import assert from "node:assert/strict";
import { createNativeJourneyHandler } from "@/lib/patient/native-journey";
import type { PatientStore } from "@/lib/patient/service";
let reads = 0,
  writes = 0,
  claims = 0;
const store: PatientStore = {
  read: async () => {
    reads++;
    return { profile: null, assessment: null, consentAccepted: false };
  },
  profile: async () => {
    writes++;
    return 0;
  },
  assessment: async () => {
    writes++;
    return 0;
  },
  measurement: async () => {
    throw Error();
  },
};
const request = (method = "GET", signal?: AbortSignal) =>
  new Request("https://app.noreon.health/api/native/journey", {
    method,
    headers: {
      authorization: "Bearer member-token",
      "content-type": "application/json",
    },
    ...(method === "POST" ? { body: "not valid JSON" } : {}),
    signal,
  });
const context = async () => ({
  user: { userId: "verified-owner", phone: "+37499000000" },
  store,
  admit: async () => {
    claims++;
    return { allowed: false, retry_after: 45 };
  },
});
const denied = createNativeJourneyHandler({ enabled: () => true, context });
for (const method of ["GET", "POST"]) {
  const r = await denied(request(method));
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("retry-after"), "45");
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.deepEqual(await r.json(), { error: "rate_limited" });
}
assert.equal(claims, 2);
assert.equal(reads, 0);
assert.equal(writes, 0);
for (const malformed of [
  null,
  {},
  { allowed: true, retry_after: 1 },
  { allowed: false, retry_after: 0 },
  { allowed: false, retry_after: -1 },
  { allowed: false, retry_after: 86401 },
  { allowed: false, retry_after: 1.5 },
  { allowed: "yes", retry_after: 0 },
]) {
  const r = await createNativeJourneyHandler({
    enabled: () => true,
    context: async () => ({
      ...(await context()),
      admit: async () => malformed,
    }),
  })(request());
  assert.equal(r.status, 503);
}
assert.equal(reads, 0);
assert.equal(
  (
    await createNativeJourneyHandler({
      enabled: () => true,
      context: async () => ({
        ...(await context()),
        admit: async () => {
          throw Error("db unavailable");
        },
      }),
    })(request())
  ).status,
  503,
);
const before = claims;
assert.equal(
  (
    await createNativeJourneyHandler({ enabled: () => false, context })(
      request(),
    )
  ).status,
  503,
);
assert.equal(
  (
    await createNativeJourneyHandler({
      enabled: () => true,
      context: async () => null,
    })(request())
  ).status,
  401,
);
assert.equal(claims, before);
let release!: (v: unknown) => void;
const late = new Promise<unknown>((resolve) => (release = resolve));
const stalled = createNativeJourneyHandler({
  enabled: () => true,
  timeoutMs: 5,
  context: async () => ({ ...(await context()), admit: () => late }),
});
assert.equal((await stalled(request())).status, 503);
release({ allowed: true, retry_after: 0 });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(reads, 0);
assert.equal(writes, 0);
const abort = new AbortController();
const cancelled = createNativeJourneyHandler({
  enabled: () => true,
  context: async () => ({
    ...(await context()),
    admit: async () => {
      abort.abort();
      return { allowed: true, retry_after: 0 };
    },
  }),
});
assert.equal((await cancelled(request("GET", abort.signal))).status, 503);
assert.equal(reads, 0);
const allowed = createNativeJourneyHandler({
  enabled: () => true,
  context: async () => ({
    ...(await context()),
    admit: async () => ({ allowed: true, retry_after: 0 }),
  }),
});
assert.equal((await allowed(request())).status, 200);
assert.equal(reads, 1);
console.log(
  "Native admission: denial precedes body/state, strict response, failure/abort isolation, disabled and unverified paths pass.",
);
