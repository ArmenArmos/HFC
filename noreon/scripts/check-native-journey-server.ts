import assert from "node:assert/strict";
import {
  createNativeJourneyContext,
  nativeJourneyEnabled,
} from "@/lib/patient/native-journey-server";
const env = {
  NOREON_NATIVE_JOURNEY_ENABLED: "true",
  NOREON_DEPLOYMENT_TARGET: "app",
  NEXT_PUBLIC_SUPABASE_URL: "https://fictional.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-key",
};
assert.equal(nativeJourneyEnabled({}), false);
assert.equal(nativeJourneyEnabled(env), true);
for (const override of [
  { NOREON_NATIVE_JOURNEY_ENABLED: "false" },
  { NOREON_DEPLOYMENT_TARGET: "marketing" },
])
  assert.equal(nativeJourneyEnabled({ ...env, ...override }), false);
const calls: {
  path: string;
  auth: string | null;
  key: string | null;
  body: unknown;
}[] = [];
let confirmed = true;
let admissionRows: unknown = [{ allowed: true, retry_after: 0 }];
const fetcher: typeof fetch = async (input, init) => {
  const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    ),
    headers = new Headers(init?.headers);
  calls.push({
    path: url.pathname,
    auth: headers.get("authorization"),
    key: headers.get("apikey"),
    body: init?.body ? JSON.parse(String(init.body)) : null,
  });
  let value: unknown;
  if (url.pathname === "/auth/v1/user")
    value = {
      id: "00000000-0000-4000-8000-000000000001",
      phone: "+37491123456",
      phone_confirmed_at: confirmed ? "2026-10-01T00:00:00Z" : null,
    };
  else if (url.pathname === "/rest/v1/profiles")
    value = {
      id: "00000000-0000-4000-8000-000000000001",
      display_name: "Fictional",
      birth_date: "1974-05-18",
      biological_sex: "male",
      locale: "en",
    };
  else if (url.pathname === "/rest/v1/patient_assessments") value = [];
  else if (url.pathname === "/rest/v1/patient_consents") value = [];
  else if (url.pathname === "/rest/v1/rpc/save_patient_profile") value = 0;
  else if (url.pathname === "/rest/v1/rpc/claim_native_member_request")
    value = admissionRows;
  else throw Error("Unexpected URL " + url.pathname);
  return Response.json(value);
};
const controller = new AbortController();
const ctx = await createNativeJourneyContext(
  "member-token",
  controller.signal,
  env,
  fetcher,
);
assert.ok(ctx);
assert.equal(ctx.user.userId, "00000000-0000-4000-8000-000000000001");
assert.equal(calls[0].auth, "Bearer member-token");
assert.equal(calls[0].key, "public-key");
assert.equal(
  (await ctx.store.read(ctx.user.userId)).profile?.name,
  "Fictional",
);
for (const call of calls.slice(1)) {
  assert.equal(call.auth, "Bearer member-token");
  assert.equal(call.key, "public-key");
}
const claimsBefore = calls.filter((c) =>
  c.path.endsWith("claim_native_member_request"),
).length;
assert.equal(
  claimsBefore,
  0,
  "context verifies identity before creating an admission request",
);
assert.deepEqual(await ctx.admit(), { allowed: true, retry_after: 0 });
assert.deepEqual(calls.at(-1)?.body, { p_owner: ctx.user.userId });
assert.equal(calls.at(-1)?.key, "server-only-key");
assert.equal(calls.at(-1)?.auth, "Bearer server-only-key");
for (const invalid of [
  null,
  [],
  [{ allowed: true, retry_after: 1 }],
  [{ allowed: false, retry_after: 0 }],
  [
    { allowed: true, retry_after: 0 },
    { allowed: true, retry_after: 0 },
  ],
]) {
  admissionRows = invalid;
  await assert.rejects(() => ctx.admit());
}
admissionRows = [{ allowed: true, retry_after: 0 }];
await ctx.store.profile(
  ctx.user.userId,
  {
    name: "Fictional",
    birthDate: "1974-05-18",
    biologicalSex: "male",
    locale: "en",
  },
  {},
  -1,
  null,
);
const write = calls.at(-1)!;
assert.equal(write.auth, "Bearer server-only-key");
assert.equal(write.key, "server-only-key");
assert.equal((write.body as { p_user_id: string }).p_user_id, ctx.user.userId);
confirmed = false;
assert.equal(
  await createNativeJourneyContext(
    "unconfirmed",
    controller.signal,
    env,
    fetcher,
  ),
  null,
);
controller.abort();
const before = calls.length;
await assert.rejects(() => ctx.store.read(ctx.user.userId));
await assert.rejects(() => ctx.admit());
assert.equal(calls.length, before);
console.log(
  "Native journey installed SDK: verified phone, fixed bearer RLS reads, server-only writer and abort isolation pass.",
);
