import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuthLifetime } from "../src/lib/auth-lifetime.ts";
test("cleanup is single-flight, blocks replacement and isolates late retirement", async () => {
  let finish!: () => void,
    clears = 0,
    count = 0;
  const lifetime = createAuthLifetime(
    () => {
      let active = true;
      return {
        client: ++count,
        active: () => active,
        retire: () => {
          active = false;
        },
      };
    },
    () => {
      clears++;
      return new Promise<void>((r) => {
        finish = r;
      });
    },
  );
  const first = lifetime.start();
  lifetime.retire(first);
  const cleanup = lifetime.clear();
  assert.equal(lifetime.clear(), cleanup);
  assert.throws(() => lifetime.start());
  await Promise.resolve();
  finish();
  await cleanup;
  const second = lifetime.start();
  lifetime.retire(first);
  assert.equal(lifetime.current(), second);
  assert.equal(second.active(), true);
  assert.equal(clears, 1);
});
test("failed deletion keeps the lifetime closed until deletion succeeds", async () => {
  let fail = true;
  const lifetime = createAuthLifetime(
    () => ({ client: {}, active: () => true, retire() {} }),
    async () => {
      if (fail) throw Error("device");
    },
  );
  lifetime.start();
  await assert.rejects(lifetime.clear());
  assert.equal(lifetime.current(), null);
  assert.throws(() => lifetime.start());
  fail = false;
  await lifetime.clear();
  assert.ok(lifetime.start());
});
