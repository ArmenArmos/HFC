import assert from "node:assert/strict";
import { test } from "node:test";
import { reminderSnapshot, submitReminders } from "../src/lib/reminders.ts";
const preferences = {
  medicationEnabled: true,
  medicationOffsetMinutes: 0,
  bpEnabled: false,
  bpTimes: ["20:00", "08:00"],
  quietStart: "22:00",
  quietEnd: "07:00",
};
test("native reminder snapshot uses shared defaults and sorts validated times", () => {
  assert.equal(reminderSnapshot(null).revision, 0);
  assert.deepEqual(
    reminderSnapshot({ revision: 2, preferences }).preferences.bpTimes,
    ["08:00", "20:00"],
  );
  assert.throws(() => reminderSnapshot({ revision: -1, preferences }));
  assert.throws(() =>
    reminderSnapshot({
      revision: 2,
      preferences: { ...preferences, bpTimes: ["08:00", "08:00"] },
    }),
  );
});
test("save preserves exact expected revision and never silently overwrites conflict", async () => {
  let calls = 0;
  const rpc = async (name: string, args: unknown) => {
    calls++;
    assert.equal(name, "save_patient_reminder_preferences");
    assert.deepEqual(args, {
      p_preferences: { ...preferences, bpTimes: ["08:00", "20:00"] },
      p_expected_revision: 2,
    });
    return { data: 3, error: null };
  };
  assert.deepEqual(await submitReminders(rpc, preferences, 2), {
    status: "saved",
    revision: 3,
  });
  assert.deepEqual(
    await submitReminders(
      async () => ({ data: -1, error: null }),
      preferences,
      2,
    ),
    { status: "conflict" },
  );
  assert.deepEqual(
    await submitReminders(
      async () => ({ data: null, error: { message: "private" } }),
      preferences,
      2,
    ),
    { status: "unavailable" },
  );
  assert.deepEqual(
    await submitReminders(rpc, { ...preferences, bpTimes: ["25:00"] }, 2),
    { status: "invalid" },
  );
  assert.deepEqual(await submitReminders(rpc, preferences, 2147483647), {
    status: "invalid",
  });
  assert.deepEqual(
    await submitReminders(
      async () => {
        throw Error("private transport detail");
      },
      preferences,
      2,
    ),
    { status: "unavailable" },
  );
  assert.deepEqual(
    await submitReminders(
      async () => ({ data: 2, error: null }),
      preferences,
      2,
    ),
    { status: "unavailable" },
  );
  assert.equal(calls, 1);
});
