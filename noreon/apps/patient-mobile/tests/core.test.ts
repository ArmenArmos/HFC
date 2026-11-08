import assert from "node:assert/strict";
import { test } from "node:test";
import { mobileConfig } from "../src/lib/config.ts";
import { sessionStorage } from "../src/lib/session-storage.ts";
test("configuration stays off and rejects privileged credentials", () => {
  assert.equal(mobileConfig({}), null);
  const env = {
    EXPO_PUBLIC_NOREON_ENABLED: "true",
    EXPO_PUBLIC_SUPABASE_URL: "https://fictional.supabase.co",
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fictional",
    EXPO_PUBLIC_HCAPTCHA_SITE_KEY: "fictional",
  };
  assert.equal(mobileConfig(env)?.url, env.EXPO_PUBLIC_SUPABASE_URL);
  for (const key of [
    "sb_secret_private",
    "x." + btoa(JSON.stringify({ role: "service_role" })) + ".x",
  ])
    assert.throws(() =>
      mobileConfig({ ...env, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }),
    );
  assert.throws(() =>
    mobileConfig({
      ...env,
      EXPO_PUBLIC_SUPABASE_URL: "http://fictional.supabase.co",
    }),
  );
});
test("secure session writes and logout deletion stay ordered", async () => {
  const values = new Map<string, string>(),
    events: string[] = [];
  const storage = sessionStorage({
    getItem: async (k) => values.get(k) ?? null,
    setItem: async (k, v) => {
      await new Promise((r) => setTimeout(r, 10));
      events.push("write");
      values.set(k, v);
    },
    removeItem: async (k) => {
      events.push("remove");
      values.delete(k);
    },
  });
  await Promise.all([
    storage.setItem("session", "private"),
    storage.removeItem("session"),
  ]);
  assert.deepEqual(events, ["write", "remove"]);
  assert.equal(await storage.getItem("session"), null);
});
test("native storage errors do not silently persist secrets elsewhere", async () => {
  let fail = true;
  const storage = sessionStorage({
    getItem: async () => null,
    setItem: async () => {
      if (fail) throw Error("private native details");
    },
    removeItem: async () => {},
  });
  await assert.rejects(storage.setItem("session", "private"), {
    message: "Secure session storage unavailable",
  });
  fail = false;
  await storage.setItem("session", "new");
});
test("native OTP cannot create users and requires a real challenge token", async () => {
  const { requestExistingMemberCode } = await import(
    "../src/lib/phone-auth.ts"
  );
  const calls: unknown[] = [];
  const auth = {
    signInWithOtp: async (input: unknown) => {
      calls.push(input);
      return { error: null };
    },
  };
  assert.equal(
    await requestExistingMemberCode(auth, "099000000", "challenge"),
    true,
  );
  assert.deepEqual(calls, [
    {
      phone: "+37499000000",
      options: { captchaToken: "challenge", shouldCreateUser: false },
    },
  ]);
  assert.equal(
    await requestExistingMemberCode(auth, "+37499000000", ""),
    false,
  );
  assert.equal(
    await requestExistingMemberCode(auth, "invalid", "challenge"),
    false,
  );
  assert.equal(calls.length, 1);
  assert.equal(
    await requestExistingMemberCode(
      {
        signInWithOtp: async () => {
          throw Error("private provider details");
        },
      },
      "+37499000000",
      "challenge",
    ),
    false,
  );
});

test("router query decoder handles malformed links with the patched dependency", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const query = require("query-string");
  assert.equal(query.parse("label=hello%20world").label, "hello world");
  assert.equal(query.parse("label=%E0%A4%A").label, "%E0%A4%A");
  const { execFileSync } = await import("node:child_process");
  execFileSync(
    process.execPath,
    ["-e", "require('query-string').parse('label=' + '%FE'.repeat(10000))"],
    { timeout: 3000 },
  );
});

test("native writes bind the verified token rather than a later active account", async () => {
  const { verifiedActionClient } = await import(
    "../src/lib/action-identity.ts"
  );
  let current = "token-one";
  const auth = {
    getSession: async () => ({
      data: { session: { access_token: current } },
      error: null,
    }),
    getUser: async (token: string) => {
      assert.equal(token, "token-one");
      current = "token-two";
      return {
        data: { user: { id: "member-one", phone_confirmed_at: "verified" } },
        error: null,
      };
    },
  };
  const client = await verifiedActionClient("member-one", auth, (token) => ({
    token,
  }));
  assert.equal(client.token, "token-one");
  await assert.rejects(
    verifiedActionClient(
      "member-two",
      {
        ...auth,
        getSession: async () => ({
          data: { session: { access_token: "token-one" } },
          error: null,
        }),
      },
      () => {
        throw Error("Must not bind mismatched identity");
      },
    ),
  );
});

test("measurement draft rejects rolled-over dates and preserves exact retry identity", async () => {
  const { measurementDraft } = await import("../src/lib/measurement-draft.ts");
  const id = "b9e10000-0000-4000-8000-000000000001";
  assert.equal(measurementDraft(id, "120", "80", "", "2025-02-30 08:00"), null);
  assert.equal(
    measurementDraft(id, "120x", "80", "", "2025-02-28 08:00"),
    null,
  );
  const first = measurementDraft(id, "120", "80", "", "2025-02-28 08:00");
  assert.ok(first);
  assert.deepEqual(
    measurementDraft(id, "120", "80", "", "2025-02-28 08:00"),
    first,
  );
});

test("cancelled native identity verification cannot bind a late client", async () => {
  const { verifiedActionClient } = await import(
    "../src/lib/action-identity.ts"
  );
  const controller = new AbortController();
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let bound = false;
  const result = verifiedActionClient(
    "member-one",
    {
      getSession: async () => {
        await waiting;
        return { data: { session: { access_token: "token" } }, error: null };
      },
      getUser: async () => ({
        data: { user: { id: "member-one", phone_confirmed_at: "verified" } },
        error: null,
      }),
    },
    () => {
      bound = true;
      return {};
    },
    controller.signal,
  );
  controller.abort();
  finish();
  await assert.rejects(result);
  assert.equal(bound, false);
});
