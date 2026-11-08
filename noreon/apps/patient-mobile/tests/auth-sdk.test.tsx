import { jest, test, expect, beforeEach, afterEach } from "@jest/globals";
const mockCredentials = new Map<string, string>();
let mockRead: ((key: string) => Promise<string | null>) | undefined;
jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (k: string) =>
    mockRead ? mockRead(k) : (mockCredentials.get(k) ?? null),
  setItemAsync: async (k: string, v: string) => {
    mockCredentials.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    mockCredentials.delete(k);
  },
}));
const variables = [
  "EXPO_PUBLIC_NOREON_ENABLED",
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_HCAPTCHA_SITE_KEY",
] as const;
let prior: (string | undefined)[];
let sdk: typeof import("../src/lib/supabase") | undefined;
let fetchMock: jest.SpiedFunction<typeof fetch>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function session(id: string) {
  return {
    access_token: `fictional-${id}`,
    refresh_token: `fictional-refresh-${id}`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: {
      id,
      phone: "+37499000000",
      phone_confirmed_at: "2026-10-01T00:00:00Z",
    },
  };
}
beforeEach(() => {
  jest.resetModules();
  mockCredentials.clear();
  sdk = undefined;
  mockRead = undefined;
  prior = variables.map((k) => process.env[k]);
  process.env.EXPO_PUBLIC_NOREON_ENABLED = "true";
  process.env.EXPO_PUBLIC_SUPABASE_URL = "https://fictional.invalid";
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fictional";
  process.env.EXPO_PUBLIC_HCAPTCHA_SITE_KEY = "fictional";
  fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw Error("Unexpected network request in local fixture");
  });
});
afterEach(() => {
  sdk?.authRuntime?.retire();
  fetchMock.mockRestore();
  jest.useRealTimers();
  variables.forEach((k, i) => {
    if (prior[i] === undefined) delete process.env[k];
    else process.env[k] = prior[i];
  });
});

test("installed SDK cannot save a late verification body over the replacement session", async () => {
  sdk = require("../src/lib/supabase") as typeof import("../src/lib/supabase");
  const runtime = sdk.authRuntime!;
  const old = runtime.start();
  await old.client.auth.getSession();
  const body = deferred<ReturnType<typeof session>>(),
    started = deferred<void>();
  const response = new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(response, "json", {
    value: () => {
      started.resolve();
      return body.promise;
    },
  });
  fetchMock.mockResolvedValueOnce(response);
  const verification = old.client.auth.verifyOtp({
    phone: "+37499000000",
    token: "123456",
    type: "sms",
  });
  await started.promise;
  runtime.retire(old);
  await runtime.clear();
  const next = runtime.start();
  await next.client.auth.getSession();
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(session("new")), { status: 200 }),
  );
  const saved = await next.client.auth.verifyOtp({
    phone: "+37499000000",
    token: "654321",
    type: "sms",
  });
  expect(saved.error).toBeNull();
  expect(fetchMock).toHaveBeenCalledWith("https://app.noreon.health/api/native/verify-phone", expect.objectContaining({method: "POST", credentials: "omit", redirect: "error"}));
  body.resolve(session("old"));
  await verification;
  expect(JSON.parse(mockCredentials.get(sdk.SESSION_KEY)!).user.id).toBe("new");
  await old.client.auth.signOut({ scope: "local" });
  expect(JSON.parse(mockCredentials.get(sdk.SESSION_KEY)!).user.id).toBe("new");
});

test("remote logout uses only the captured old token and local scope", async () => {
  sdk = require("../src/lib/supabase") as typeof import("../src/lib/supabase");
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await sdk.revokeOldSession({
    ...session("old"),
    access_token: "fictional-old-token",
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://fictional.invalid/auth/v1/logout?scope=local",
    expect.objectContaining({
      method: "POST",
      headers: {
        apikey: "sb_publishable_fictional",
        Authorization: "Bearer fictional-old-token",
      },
    }),
  );
  expect(mockCredentials.size).toBe(0);
});

test("retiring during SDK initialization cannot restart background refresh later", async () => {
  jest.useFakeTimers();
  const read = deferred<string | null>(),
    started = deferred<void>();
  mockRead = async () => {
    started.resolve();
    return read.promise;
  };
  sdk = require("../src/lib/supabase") as typeof import("../src/lib/supabase");
  const lease = sdk.authRuntime!.start();
  await started.promise;
  sdk.authRuntime!.retire(lease);
  read.resolve(null);
  await lease.client.auth.initialize();
  // Allow disposal's async stop to settle; no elapsed timer is advanced.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(jest.getTimerCount()).toBe(0);
});

test("expired captured session refreshes only in memory before local-scope revocation", async () => {
  sdk = require("../src/lib/supabase") as typeof import("../src/lib/supabase");
  const expired = { ...session("old"), expires_at: 1 };
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(session("rotated-old")), { status: 200 }),
  );
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await sdk.revokeOldSession(expired);
  expect(fetchMock.mock.calls[0][0]).toBe(
    "https://fictional.invalid/auth/v1/token?grant_type=refresh_token",
  );
  expect(fetchMock.mock.calls[0][1]?.body).toBe(
    JSON.stringify({ refresh_token: "fictional-refresh-old" }),
  );
  expect(fetchMock.mock.calls[1][1]?.headers).toEqual({
    apikey: "sb_publishable_fictional",
    Authorization: "Bearer fictional-rotated-old",
  });
  expect(mockCredentials.size).toBe(0);
});

test("remote revocation refreshes once on unexpected expiry and stops on refresh failure", async () => {
  sdk = require("../src/lib/supabase") as typeof import("../src/lib/supabase");
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(session("rotated")), { status: 200 }),
  );
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  expect(await sdk.revokeOldSession(session("old"))).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  fetchMock.mockClear();
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));
  expect(await sdk.revokeOldSession({ ...session("old"), expires_at: 1 })).toBe(
    false,
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(mockCredentials.size).toBe(0);
});

test("a stalled refresh body cannot trigger logout after the shared deadline", async () => {
  jest.useFakeTimers();
  sdk = require("../src/lib/supabase") as typeof import("../src/lib/supabase");
  const body = deferred<ReturnType<typeof session>>(),
    started = deferred<void>();
  const response = new Response("{}", { status: 200 });
  Object.defineProperty(response, "json", {
    value: () => {
      started.resolve();
      return body.promise;
    },
  });
  fetchMock.mockResolvedValueOnce(response);
  const result = sdk.revokeOldSession({ ...session("old"), expires_at: 1 });
  await started.promise;
  jest.advanceTimersByTime(15001);
  expect(await result).toBe(false);
  body.resolve(session("late"));
  await Promise.resolve();
  await Promise.resolve();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(mockCredentials.size).toBe(0);
});
