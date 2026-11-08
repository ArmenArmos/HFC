import assert from "node:assert/strict";
import { test } from "node:test";
import { createDraftStore } from "../src/lib/member-drafts.ts";
import { memberRouteAllowed } from "../src/lib/navigation-access.ts";
test("draft remount preserves the exact retry payload and separates member stores", () => {
  const a = createDraftStore(),
    b = createDraftStore();
  const pending = { submissionId: "same-id", systolic: 120, diastolic: 80 };
  let changes = 0;
  const unsubscribe = a.subscribe(() => changes++);
  a.get("bp.pending", () => null);
  a.set("bp.pending", pending);
  unsubscribe();
  assert.equal(
    a.get("bp.pending", () => null),
    pending,
  );
  assert.equal(
    b.get("bp.pending", () => null),
    null,
  );
  assert.equal(changes, 1);
  a.set<number>("revision", 0);
  a.set<number>("revision", (n) => n + 1);
  assert.equal(
    a.get("revision", () => 0),
    1,
  );
  a.set("dose:medicine:due:0", pending);
  assert.equal(
    a.get("dose:medicine:due:1", () => null),
    null,
  );
});
test("member routes require enabled, settled, error-free verified identity", () => {
  const session = { user: { id: "member", phone_confirmed_at: "verified" } };
  assert.equal(memberRouteAllowed(true, false, false, session), true);
  for (const args of [
    [false, false, false, session],
    [true, true, false, session],
    [true, false, true, session],
    [true, false, false, null],
    [true, false, false, { user: { id: "member" } }],
  ] as const)
    assert.equal(memberRouteAllowed(args[0], args[1], args[2], args[3]), false);
});
