import assert from "node:assert/strict";
import { doctorInboxSchema } from "@/lib/doctor-inbox/contracts";
import { markZoeAnswered, zoeAnsweredItemSchema, zoeAnsweredListSchema, zoeAnsweredSummary, zoeMarkNotices, type ZoeMarkPorts } from "@/lib/doctor-inbox/zoe-answered";

/**
 * SYNTHETIC checks for doctor inbox part 2 (threads Zoe fully answered). What counts as answered is decided in the
 * database and tested in check-doctor-inbox-zoe-answered.sql; here: the app parses both shapes of the inbox (a database
 * without the migration still works), never shows an urgent level as "answered by Zoe", and the review / reopen action
 * validates its input, calls the database once and reports what happened.
 */
const member = "d1b00000-0000-4000-8000-000000000001";
const item = { conversationId: "d1b00000-0000-4000-8000-000000000081", memberId: member.toUpperCase(), memberName: "Synthetic", version: 3,
  runId: "d1b00000-0000-4000-8000-000000000051", answeredAt: "2026-10-20T07:00:00Z", urgency: "planned", declined: false, unanswered: 2, reviewed: false };
const envelope = { version: "doctor-inbox-v1", ok: true, asOf: "2026-10-20T08:00:00Z", p0: [], p0Total: 0, items: [], laneCap: 50, unavailable: [] };

// The inbox: an older database (no zoeAnswered) parses to an empty group; a new one carries the items.
{ const old = doctorInboxSchema.parse(envelope); assert.deepEqual(old.zoeAnswered, []); assert.equal(old.zoeAnsweredTotal, 0); }
{ const now = doctorInboxSchema.parse({ ...envelope, zoeAnswered: [item], zoeAnsweredTotal: 1 });
  assert.equal(now.zoeAnswered[0]!.memberId, member, "member ids are lower-cased like the other lists"); assert.equal(now.zoeAnsweredTotal, 1); }
// An urgent level is never "answered by Zoe" in the app either: the parse fails, so the page shows its error, not a calm row.
for (const urgency of ["same_day", "emergency", "later"]) assert.equal(zoeAnsweredItemSchema.safeParse({ ...item, urgency }).success, false, urgency);
assert.equal(zoeAnsweredListSchema.safeParse({ ok: true, items: [{ ...item, lastMessageAt: null, channel: "telegram" }] }).success, true);

// The row's line: counts and codes only, and it says when the member declined.
assert.equal(zoeAnsweredSummary(zoeAnsweredItemSchema.parse(item), "en"), "2 messages · Zoe's urgency: next planned visit");
assert.match(zoeAnsweredSummary(zoeAnsweredItemSchema.parse({ ...item, declined: true, unanswered: 1 }), "en"), /^1 message · .* · the member said no to sending it to you$/);
assert.ok(zoeAnsweredSummary(zoeAnsweredItemSchema.parse(item), "hy").length > 0);
for (const [en, hy] of Object.values(zoeMarkNotices)) { assert.ok(!/[—!]/.test(en), `voice guide: ${en}`); assert.ok(hy.length > 0); }

// Review and reopen: one database call with the version the doctor saw; refusals are reported, never retried.
function ports(result: unknown) { const calls: unknown[][] = []; const p: ZoeMarkPorts = { mark: async (...a) => { calls.push(a); if (result instanceof Error) throw result; return result; } }; return { p, calls }; }
const form = { memberId: member, action: "reviewed", version: "3" };
{ const { p, calls } = ports({ ok: true, action: "reviewed", replayed: false }); assert.equal(await markZoeAnswered(p, form), "zoe_reviewed"); assert.deepEqual(calls, [[member, "reviewed", 3]]); }
{ const { p } = ports({ ok: true, action: "reviewed", replayed: true }); assert.equal(await markZoeAnswered(p, form), "zoe_reviewed", "a replay is the same outcome"); }
{ const { p, calls } = ports({ ok: true, action: "reopen", replayed: false }); assert.equal(await markZoeAnswered(p, { ...form, action: "reopen" }), "zoe_reopened"); assert.deepEqual(calls, [[member, "reopen", 3]]); }
for (const code of ["stale", "not_answered_by_zoe"]) { const { p, calls } = ports({ ok: false, code }); assert.equal(await markZoeAnswered(p, form), "zoe_changed", code); assert.equal(calls.length, 1); }
{ const { p } = ports({ ok: false, code: "invalid" }); assert.equal(await markZoeAnswered(p, form), "zoe_invalid"); }
{ const { p } = ports({ surprise: true }); assert.equal(await markZoeAnswered(p, form), "unavailable", "an unknown result is not a success"); }
{ const { p } = ports(new Error("rpc")); await assert.rejects(markZoeAnswered(p, form), "a database error reaches the action, which reports unavailable"); }
for (const raw of [{ ...form, memberId: "x" }, { ...form, action: "resolve" }, { ...form, version: "0" }, { ...form, version: "abc" }, { ...form, version: null }]) {
  const { p, calls } = ports({ ok: true, action: "reviewed", replayed: false }); assert.equal(await markZoeAnswered(p, raw), "zoe_invalid"); assert.equal(calls.length, 0, "invalid input never reaches the database"); }
console.log("check-doctor-inbox-zoe-answered: all assertions passed");
