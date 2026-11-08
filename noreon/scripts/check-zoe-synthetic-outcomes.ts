import assert from "node:assert/strict";
import {
  formatSyntheticTime,
  eligibleEvidence,
  recordEvidence,
  type Evidence,
} from "../lib/zoe-synthetic/outcomes";
const accepted = {
  eventId: "bp:demo",
  planId: "plan:1",
  acceptedAt: "2026-10-12T08:00:00Z",
};
const reading: Evidence = {
  id: "reading:1",
  submissionId: "submission:1",
  eventId: accepted.eventId,
  planId: accepted.planId,
  actualAt: "2026-10-12T08:01:00Z",
  reportedAt: "2026-10-12T09:00:00Z",
  value: "120/80",
  removed: false,
  revision: 0,
};
assert.deepEqual(eligibleEvidence([reading], accepted), ["reading:1"]);
for (const changed of [
  { actualAt: "2026-10-12T07:59:00Z" },
  { eventId: "other" },
  { planId: "other" },
  { removed: true },
]) {
  assert.deepEqual(
    eligibleEvidence([{ ...reading, ...changed }], accepted),
    [],
  );
}
assert.deepEqual(eligibleEvidence([reading], null), []);
assert.equal(recordEvidence([], reading, "new").kind, "recorded");
assert.equal(recordEvidence([reading], reading, "new").kind, "retry");
assert.equal(
  recordEvidence([reading], { ...reading, value: "121/80" }, "new").kind,
  "conflict",
);
const second = { ...reading, id: "reading:2", submissionId: "submission:2" };
assert.equal(
  recordEvidence([reading], second, "new").kind,
  "confirm-duplicate",
);
assert.equal(recordEvidence([reading], second, "separate").kind, "recorded");
assert.equal(
  recordEvidence([], { ...reading, actualAt: "garbage" }, "new").kind,
  "invalid",
);
assert.equal(
  recordEvidence([], { ...reading, actualAt: "2026-10-13T08:00:00Z" }, "new")
    .kind,
  "invalid",
);
console.log(
  "Synthetic Zoe outcome attribution and duplicate reconciliation passed",
);
assert.equal(formatSyntheticTime("2026-10-12T08:00:00Z"), "2026-10-12 12:00");
