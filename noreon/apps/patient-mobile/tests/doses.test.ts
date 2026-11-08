import assert from "node:assert/strict";
import { test } from "node:test";
import {
  doseSnapshotUsable,
  nativeDoseCare,
  nativeDoses,
  submitDose,
  type DoseDraft,
} from "../src/lib/doses.ts";
const plan = {
  id: "plan",
  clinician: "Clinic",
  instructions: "Follow plan",
  published_at: "2026-10-10T00:00:00Z",
  acknowledged_at: null,
};
const medication = {
  id: "med",
  name: "Example",
  dose: "Recorded dose",
  instructions: "Recorded instructions",
  times: ["08:00:00", "23:50:00"],
  start_date: "2026-10-10",
  end_date: null,
};
test("native schedule shares Armenia due time and revision, not device time", () => {
  const care = nativeDoseCare(
    plan,
    [medication],
    [
      {
        medication_id: "med",
        due_at: "2026-10-12T04:00:00Z",
        status: "taken",
        revision: 3,
        recorded_at: "2026-10-12T04:01:00Z",
      },
    ],
  );
  const rows = nativeDoses(care, new Date("2026-10-12T04:05:00Z"), 0);
  assert.equal(rows[0].dose.dueAt, "2026-10-12T04:00:00.000Z");
  assert.equal(rows[0].dose.revision, 3);
  assert.equal(rows[0].canReport, true);
  assert.equal(rows[1].canReport, false);
  assert.equal(rows[0].dose.status, "taken");
});
test("native schedule excludes expired and unpublished doses and preserves midnight allowance", () => {
  assert.equal(
    nativeDoses(
      nativeDoseCare(
        { ...plan, published_at: "2026-10-12T10:00:00Z" },
        [medication],
        [],
      ),
      new Date("2026-10-12T05:00:00Z"),
      0,
    ).length,
    1,
  );
  assert.equal(
    nativeDoses(
      nativeDoseCare(plan, [{ ...medication, end_date: "2026-10-11" }], []),
      new Date("2026-10-12T05:00:00Z"),
      0,
    ).length,
    0,
  );
  const care = nativeDoseCare(plan, [medication], []),
    now = new Date("2026-10-12T20:01:00Z");
  assert.equal(nativeDoses(care, now, 0).length, 2);
  const rows = nativeDoses(care, now, 15);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].dose.dueAt, "2026-10-12T19:50:00.000Z");
  assert.equal(rows[0].canReport, true);
  assert.equal(rows[0].dose.status, "due");
});
test("dose transport carries exact revision and treats no result as uncertain", async () => {
  const draft = {
    medicationId: "med",
    dueAt: "2026-10-12T04:00:00Z",
    status: "taken" as const,
    revision: 3,
  };
  let calls = 0;
  const run = async (input: DoseDraft) => {
    calls++;
    assert.deepEqual(input, draft);
    return { data: 4, error: null };
  };
  assert.equal(await submitDose(draft, run), "saved");
  assert.equal(calls, 1);
  assert.equal(await submitDose({ ...draft, revision: -1 }, run), "invalid");
  assert.equal(calls, 1);
  assert.equal(
    await submitDose(draft, async () => ({ data: null, error: null })),
    "unavailable",
  );
  assert.equal(
    await submitDose(draft, async () => {
      throw Error("network");
    }),
    "unavailable",
  );
  assert.equal(
    await submitDose(draft, async () => ({
      data: null,
      error: { message: "dose revision conflict" },
    })),
    "conflict",
  );
  assert.equal(
    await submitDose(draft, async () => ({
      data: null,
      error: { message: "dose outside schedule" },
    })),
    "invalid",
  );
});

test("native snapshot remains usable within the schedule day but refresh failure and day change block new reports", () => {
  assert.equal(
    doseSnapshotUsable(
      "2026-10-12T04:00:00Z",
      new Date("2026-10-12T18:00:00Z"),
      false,
    ),
    true,
  );
  assert.equal(
    doseSnapshotUsable(
      "2026-10-12T04:00:00Z",
      new Date("2026-10-12T20:00:00Z"),
      false,
    ),
    false,
  );
  assert.equal(
    doseSnapshotUsable(
      "2026-10-12T04:00:00Z",
      new Date("2026-10-12T05:00:00Z"),
      true,
    ),
    false,
  );
});
