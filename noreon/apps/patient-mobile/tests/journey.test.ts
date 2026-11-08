import test from "node:test";
import assert from "node:assert/strict";
import { createJourneyController } from "../src/lib/journey-controller.ts";
import {
  parseJourneySnapshot,
  type JourneySnapshot,
  type JourneyTransport,
} from "../src/lib/journey-protocol.ts";
const snapshot = (revision = 0): JourneySnapshot => ({
  consentVersion: "patient-pilot-v1",
  state: {
    profile: null,
    consentAccepted: false,
    assessment: {
      id: "draft",
      revision,
      assessmentDate: "2026-10-12",
      answers: {},
      urgentRule: null,
      completedAt: null,
    },
  },
});
const command = { type: "complete" as const, expectedRevision: 0 };
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
test("save must fetch authoritative state and retries read only after saved-write read fails", async () => {
  let reads = 0,
    writes = 0,
    fail = false;
  const transport: JourneyTransport = {
    read: async () => {
      reads++;
      if (fail) throw Error();
      return snapshot(writes);
    },
    write: async () => {
      writes++;
      return { ok: true, revision: 1 };
    },
  };
  const model = createJourneyController(transport);
  await model.start();
  assert.equal(model.snapshot().phase, "ready");
  fail = true;
  assert.equal(await model.save(command), null);
  assert.equal(model.snapshot().phase, "blocked");
  assert.equal(writes, 1);
  assert.equal(reads, 2);
  await model.save(command);
  assert.equal(writes, 1);
  fail = false;
  await model.load();
  assert.equal(writes, 1);
  assert.equal(model.snapshot().data?.state.assessment?.revision, 1);
  assert.equal(model.snapshot().phase, "ready");
});
test("duplicate saves and stale authoritative reads never advance", async () => {
  const write = deferred<{ ok: true; revision: number }>();
  let writes = 0;
  const model = createJourneyController({
    read: async () => snapshot(),
    write: async () => {
      writes++;
      return write.promise;
    },
  });
  await model.start();
  const saving = model.save(command);
  assert.equal(await model.save(command), null);
  write.resolve({ ok: true, revision: 1 });
  await saving;
  assert.equal(writes, 1);
  assert.equal(model.snapshot().phase, "blocked");
});
test("stopped owner ignores late data and cannot issue save continuation", async () => {
  const read = deferred<JourneySnapshot>();
  let writes = 0;
  const model = createJourneyController({
    read: () => read.promise,
    write: async () => {
      writes++;
      return { ok: true, revision: 1 };
    },
  });
  const loading = model.start();
  model.stop();
  read.resolve(snapshot());
  await loading;
  assert.equal(model.snapshot().data, null);
  await model.save(command);
  assert.equal(writes, 0);
});
test("background revision change blocks edits without resetting local drafts", async () => {
  let revision = 0;
  const model = createJourneyController({
    read: async () => snapshot(revision),
    write: async () => ({ ok: false, reason: "conflict" }),
  });
  await model.start();
  const reset = model.snapshot().reset;
  revision = 1;
  await model.load(false);
  assert.equal(model.snapshot().phase, "blocked");
  assert.equal(model.snapshot().reset, reset);
  await model.load();
  assert.equal(model.snapshot().phase, "ready");
  assert.equal(model.snapshot().reset, reset + 1);
});
test("runtime snapshot rejects foreign owner, invalid revision and malformed answers", () => {
  assert.deepEqual(parseJourneySnapshot(snapshot(), "member"), snapshot());
  const value = snapshot();
  value.state.profile = {
    userId: "other",
    name: "Fictional",
    birthDate: "1980-01-01",
    biologicalSex: "male",
    locale: "en",
  };
  assert.throws(() => parseJourneySnapshot(value, "member"));
  assert.throws(() => parseJourneySnapshot(snapshot(-1), "member"));
  assert.throws(() =>
    parseJourneySnapshot(
      {
        ...snapshot(),
        state: {
          ...snapshot().state,
          assessment: {
            ...snapshot().state.assessment,
            answers: { a: { value: { forged: true } } },
          },
        },
      },
      "member",
    ),
  );
});
import { createJourneyHttp } from "../src/lib/journey-http.ts";
test("HTTP transport bounds token/body stalls and does not continue to fetch after cancellation", async () => {
  const token = deferred<string>();
  let calls = 0;
  const http = createJourneyHttp(
    "member",
    () => token.promise,
    async () => {
      calls++;
      return Response.json(snapshot());
    },
    10,
  );
  await assert.rejects(() => http.read(new AbortController().signal));
  token.resolve("old-token");
  await new Promise((r) => setTimeout(r, 2));
  assert.equal(calls, 0);
  const body = createJourneyHttp(
    "member",
    async () => "token",
    async () =>
      ({
        ok: true,
        status: 200,
        json: () => new Promise(() => {}),
      }) as Response,
    10,
  );
  await assert.rejects(() => body.read(new AbortController().signal));
});
test("HTTP transport uses fixed origin, captures bearer and rejects malformed successful writes", async () => {
  const http = createJourneyHttp(
    "member",
    async () => "captured",
    async (url, init) => {
      assert.equal(url, "https://app.noreon.health/api/native/journey");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer captured",
      );
      return Response.json({ ok: true, revision: -1 });
    },
  );
  await assert.rejects(() => http.write(command, new AbortController().signal));
});
test("foreground read never unlocks an uncertain write without explicit recovery", async () => {
  const model = createJourneyController({
    read: async () => snapshot(),
    write: async () => {
      throw Error();
    },
  });
  await model.start();
  await model.save(command);
  await model.load(false);
  assert.equal(model.snapshot().phase, "blocked");
});
test("late write after owner stops cannot initiate authoritative read", async () => {
  const result = deferred<{ ok: true; revision: number }>();
  let reads = 0;
  const model = createJourneyController({
    read: async () => {
      reads++;
      return snapshot();
    },
    write: () => result.promise,
  });
  await model.start();
  const saving = model.save(command);
  model.stop();
  result.resolve({ ok: true, revision: 1 });
  await saving;
  assert.equal(reads, 1);
});
test("caller cancellation prevents even token lookup", async () => {
  let lookups = 0;
  const controller = new AbortController();
  controller.abort();
  const http = createJourneyHttp("member", async () => {
    lookups++;
    return "token";
  });
  await assert.rejects(() => http.read(controller.signal));
  assert.equal(lookups, 0);
});
test("authoritative reads cannot go backwards from a previously observed revision", async () => {
  let revision = 2;
  const model = createJourneyController({
    read: async () => snapshot(revision),
    write: async () => ({ ok: true, revision: 3 }),
  });
  await model.start();
  revision = 1;
  await model.load();
  assert.equal(model.snapshot().phase, "blocked");
  assert.equal(model.snapshot().data?.state.assessment?.revision, 2);
});
test("a success response that did not advance the saved revision cannot advance the journey", async () => {
  const model = createJourneyController({
    read: async () => snapshot(),
    write: async () => ({ ok: true, revision: 0 }),
  });
  await model.start();
  assert.equal(await model.save(command), null);
  assert.equal(model.snapshot().phase, "blocked");
});
test("changed background state retains the edited snapshot until explicit reload", async () => {
  let revision = 0;
  const model = createJourneyController({
    read: async () => snapshot(revision),
    write: async () => ({ ok: true, revision: 1 }),
  });
  await model.start();
  revision = 2;
  await model.load(false);
  assert.equal(model.snapshot().data?.state.assessment?.revision, 0);
  assert.equal(model.snapshot().latest?.state.assessment?.revision, 2);
  await model.load();
  assert.equal(model.snapshot().data?.state.assessment?.revision, 2);
});
test("a concurrent update after successful write blocks advancement for explicit review", async () => {
  let reads = 0;
  const model = createJourneyController({
    read: async () => snapshot(reads++ ? 2 : 0),
    write: async () => ({ ok: true, revision: 1 }),
  });
  await model.start();
  assert.equal(await model.save(command), null);
  assert.equal(model.snapshot().phase, "blocked");
  assert.equal(model.snapshot().data?.state.assessment?.revision, 0);
});

test("HTTP 429 preserves the edited snapshot and blocks automatic write retries", async () => {
  let writes = 0,
    reads = 0;
  const http = createJourneyHttp(
    "member",
    async () => "member-token",
    async (_input, init) => {
      if (init?.method === "POST") {
        writes++;
        return Response.json(
          { error: "rate_limited" },
          { status: 429, headers: { "Retry-After": "45" } },
        );
      }
      reads++;
      return Response.json(snapshot());
    },
  );
  const model = createJourneyController(http);
  await model.start();
  const before = model.snapshot();
  await model.save(command);
  assert.equal(model.snapshot().phase, "blocked");
  assert.deepEqual(model.snapshot().data, before.data);
  assert.equal(model.snapshot().reset, before.reset);
  await model.save(command);
  assert.equal(writes, 1);
  assert.equal(reads, 1);
  await model.load();
  assert.equal(reads, 2);
  assert.equal(writes, 1);
  model.stop();
});
