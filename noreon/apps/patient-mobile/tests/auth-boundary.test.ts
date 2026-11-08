import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCredentialVault,
  createAuthTransport,
} from "../src/lib/auth-boundary.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("retirement rejects queued writes and deletion follows an already-running native write", async () => {
  const started = deferred<void>(),
    finish = deferred<void>();
  const values = new Map<string, string>();
  const vault = createCredentialVault(
    {
      getItem: async (k) => values.get(k) ?? null,
      setItem: async (k, v) => {
        started.resolve();
        await finish.promise;
        values.set(k, v);
      },
      removeItem: async (k) => {
        values.delete(k);
      },
    },
    "session",
  );
  const old = vault.lease();
  const first = old.storage.setItem("session", "old");
  await started.promise;
  const queued = assert.rejects(old.storage.setItem("session", "late"));
  old.retire();
  const cleared = vault.clear();
  finish.resolve();
  await Promise.all([first, queued, cleared]);
  assert.equal(values.size, 0);
  const current = vault.lease();
  await current.storage.setItem("session", "new");
  await assert.rejects(old.storage.removeItem("session"));
  await assert.rejects(old.storage.setItem("session", "stale"));
  assert.equal(await current.storage.getItem("session"), "new");
});

test("retired reads never deliver credentials and native errors are generic", async () => {
  const finish = deferred<string | null>();
  let failures = 0;
  const vault = createCredentialVault(
    {
      getItem: () => finish.promise,
      setItem: async () => {
        throw Error("private keychain detail");
      },
      removeItem: async () => {
        throw Error("private keychain detail");
      },
    },
    "session",
  );
  const old = vault.lease(() => failures++);
  const read = assert.rejects(old.storage.getItem("session"));
  await Promise.resolve();
  old.retire();
  finish.resolve("private");
  await read;
  assert.equal(failures, 0, "retirement is not a new keychain fault");
  const current = vault.lease(() => failures++);
  await assert.rejects(current.storage.setItem("session", "x"), {
    message: "Secure session storage unavailable",
  });
  assert.equal(failures, 1);
  await assert.rejects(vault.clear(), {
    message: "Secure session storage unavailable",
  });
});

test("clearing credentials covers supported OTP keys and touched SDK keys", async () => {
  const values = new Map([
    ["session", "x"],
    ["session-user", "u"],
    ["session-code-verifier", "v"],
    ["session-flows-code-verifier", "[]"],
  ]);
  const vault = createCredentialVault(
    {
      getItem: async (k) => values.get(k) ?? null,
      setItem: async (k, v) => {
        values.set(k, v);
      },
      removeItem: async (k) => {
        values.delete(k);
      },
    },
    "session",
  );
  const lease = vault.lease();
  await lease.storage.setItem("session-flow-test-code-verifier", "v");
  lease.retire();
  await vault.clear();
  assert.equal(values.size, 0);
});

test("retirement ends an ignoring fetch and prevents later calls", async () => {
  const finish = deferred<Response>();
  let calls = 0;
  let signal: AbortSignal | null | undefined;
  const transport = createAuthTransport(async (_url, init) => {
    calls++;
    signal = init?.signal;
    return finish.promise;
  }, 1000);
  const request = assert.rejects(transport.fetch("https://fictional.invalid"));
  transport.retire();
  await request;
  assert.equal(signal?.aborted, true);
  finish.resolve(new Response("late"));
  await assert.rejects(transport.fetch("https://fictional.invalid"));
  assert.equal(calls, 1);
});

test("transport bounds ignored cancellation and respects caller abort", async () => {
  const transport = createAuthTransport(
    async () => new Promise<Response>(() => {}),
    10,
  );
  await assert.rejects(transport.fetch("https://fictional.invalid"));
  const caller = new AbortController();
  const request = assert.rejects(
    transport.fetch("https://fictional.invalid", { signal: caller.signal }),
  );
  caller.abort();
  await request;
  transport.retire();
  const healthy = createAuthTransport(async () => new Response("ok"));
  assert.equal(
    await (await healthy.fetch("https://fictional.invalid")).text(),
    "ok",
  );
  healthy.retire();
});
