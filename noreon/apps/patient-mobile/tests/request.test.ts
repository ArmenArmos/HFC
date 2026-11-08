import assert from "node:assert/strict";
import { test } from "node:test";
import { abortableRequest, boundedRequest } from "../src/lib/request.ts";
import { verifiedActionClient } from "../src/lib/action-identity.ts";

test(
  "one deadline ends stalled authentication and blocks its late write",
  { timeout: 1000 },
  async () => {
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let bound = false,
      written = false;
    const result = boundedRequest(async (signal) => {
      await verifiedActionClient(
        "member",
        {
          getSession: async () => ({
            data: { session: { access_token: "token" } },
            error: null,
          }),
          getUser: async () => {
            await waiting;
            return {
              data: { user: { id: "member", phone_confirmed_at: "verified" } },
              error: null,
            };
          },
        },
        () => {
          bound = true;
          return {};
        },
        signal,
      );
      written = true;
    }, 10);
    await assert.rejects(result);
    finish();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(bound, false);
    assert.equal(written, false);
  },
);

test("pre-aborted request never starts, while successful requests keep their result", async () => {
  const controller = new AbortController();
  controller.abort();
  let started = false;
  await assert.rejects(
    abortableRequest(async () => {
      started = true;
    }, controller.signal),
  );
  assert.equal(started, false);
  assert.equal(await boundedRequest(async () => "saved"), "saved");
  await assert.rejects(
    boundedRequest(async () => {
      throw Error("failed");
    }),
    { message: "failed" },
  );
});
