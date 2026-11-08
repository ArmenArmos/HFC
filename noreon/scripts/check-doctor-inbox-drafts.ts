import assert from "node:assert/strict";
import { decideInboxDraft, type DraftDecisionPorts } from "@/lib/doctor-inbox/draft-decision";

/**
 * SYNTHETIC checks for one-tap Approve / Reject from the Today inbox: the decision goes only through the existing
 * conversation_actions -> conversation_command path, bound to the revision and content hash the doctor saw, and is
 * refused (nothing sent) whenever the inbox no longer offers it. Access: check-doctor-inbox-drafts.sql.
 */
const member = "d1a00000-0000-4000-8000-000000000001", draftId = "d1a00000-0000-4000-8000-000000000082", hash = "a".repeat(64);
const draft = { draftId, revision: 2, body: "Synthetic reply", contentHash: hash, author: "ai_assistant", structured: true, stale: false, planCurrent: true, openAlert: false,
  asked: "Synthetic", acknowledgementId: "A1", needsJudgement: false, outsidePlan: false, judgementReasons: [], doctorDecides: [], approvable: true };
const inbox = (d: object | null, confidence = "M") => ({ version: "doctor-inbox-v1", ok: true, asOf: "2026-10-19T08:00:00Z", p0: [], p0Total: 0, laneCap: 50, unavailable: [],
  items: d ? [{ id: "reply:x", lane: "P3", kind: "reply_draft", rank: 0, at: "2026-10-19T07:00:00Z", memberId: member, memberName: "Synthetic", confidence, ai: "draft", sources: [], draft: d }] : [] });
const view = (revision = 2, contentHash = hash) => ({ ok: true, view: { conversationId: member, conversationVersion: 1, draft: { revision, body: "Synthetic reply", summary: "s", contentHash, author: "ai_assistant" },
  actions: ["reply.approve", "reply.edit", "reply.reject", "reply.request_info"].map((purpose, i) => ({ purpose, intentId: String(i).repeat(32) })) } });
type Call = [string, unknown];
function ports(over: Partial<{ inbox: unknown; actions: unknown; command: (input: { purpose: string }) => unknown; reason: unknown }> = {}) {
  const calls: Call[] = [];
  const p: DraftDecisionPorts = {
    inbox: async () => { calls.push(["inbox", null]); return over.inbox ?? inbox(draft); },
    actions: async m => { calls.push(["actions", m]); return over.actions ?? view(); },
    command: async input => { calls.push(["command", input]); const i = input as { purpose: string }; return over.command ? over.command(i) : { ok: true, purpose: i.purpose, draftId, revision: 2, replayed: false }; },
    approve: async (m, input) => { calls.push(["approve", [m, input]]); const i = input as { purpose: string }; return over.command ? over.command(i) : { ok: true, purpose: i.purpose, draftId, revision: 2, replayed: false }; },
    recordReason: async (d, r, n) => { calls.push(["reason", [d, r, n]]); if (over.reason instanceof Error) throw over.reason; return over.reason ?? { ok: true, replayed: false }; },
    requestId: () => "r".repeat(32),
  };
  return { p, calls };
}
const approve = { decision: "approve", memberId: member, draftId, revision: "2", contentHash: hash };
const reject = { ...approve, decision: "reject", reason: "not_answered", note: "" };

// Approve: inbox -> actions -> the inbox gate with one reply.approve command (the issued intent); nothing else.
{ const { p, calls } = ports(); assert.equal(await decideInboxDraft(p, approve), "draft_approved");
  assert.deepEqual(calls.map(c => c[0]), ["inbox", "actions", "approve"]);
  assert.deepEqual(calls[2][1], [member, { schema: 1, purpose: "reply.approve", intentId: "0".repeat(32), requestId: "r".repeat(32) }], "the existing command shape, no body or recipient"); }
// Refusals before any intent is issued (nothing sent).
for (const [label, over, raw] of [
  ["not approvable", { inbox: inbox({ ...draft, approvable: false }) }, approve],
  ["needs judgement", { inbox: inbox({ ...draft, needsJudgement: true, approvable: false }) }, approve],
  ["open alert", { inbox: inbox({ ...draft, openAlert: true, approvable: false }) }, approve],
  ["low confidence", { inbox: inbox(draft, "L") }, approve],
  ["draft gone", { inbox: inbox(null) }, approve],
  ["revision moved", { inbox: inbox({ ...draft, revision: 3 }) }, approve],
  ["text changed", { inbox: inbox({ ...draft, contentHash: "b".repeat(64) }) }, approve],
  ["another draft", { inbox: inbox({ ...draft, draftId: "d1a00000-0000-4000-8000-000000000083" }) }, approve],
] as const) {
  const { p, calls } = ports(over); assert.equal(await decideInboxDraft(p, raw), "draft_changed", label);
  assert.ok(!calls.some(c => c[0] === "actions" || c[0] === "command" || c[0] === "approve"), `${label}: no intent, no command`);
}
// The issuer's view must be the same revision and text; otherwise no command.
for (const [label, actions] of [["stale context", { ok: false, code: "stale_context" }], ["revision differs", view(3)], ["hash differs", view(2, "c".repeat(64))]] as const) {
  const { p, calls } = ports({ actions }); assert.equal(await decideInboxDraft(p, approve), "draft_changed", label);
  assert.ok(!calls.some(c => c[0] === "command" || c[0] === "approve"), `${label}: no command`);
}
// A command refusal (assignment, grant, hash re-check in SQL) is reported, not retried.
{ const { p, calls } = ports({ command: () => ({ ok: false, code: "open_alert" }) }); assert.equal(await decideInboxDraft(p, approve), "draft_changed", "the database gate refuses (alert raised after the read)");
  assert.equal(calls.filter(c => c[0] === "approve").length, 1); assert.equal(calls.filter(c => c[0] === "command").length, 0, "Approve never bypasses the gate"); }
// Invalid input never reaches the database.
for (const raw of [{ ...approve, memberId: "x" }, { ...approve, revision: "0" }, { ...reject, reason: "bogus" }, { ...reject, reason: "other", note: "  " }, { ...approve, decision: "send" }]) {
  const { p, calls } = ports(); assert.equal(await decideInboxDraft(p, raw), "draft_invalid"); assert.equal(calls.length, 0); }

// Reject: reply.reject through the same path, then the reason; a reason failure still reports the rejection honestly.
{ const { p, calls } = ports(); assert.equal(await decideInboxDraft(p, { ...reject, note: "  Wrong plan item  " }), "draft_rejected");
  assert.deepEqual(calls.map(c => c[0]), ["inbox", "actions", "command", "reason"]);
  assert.equal((calls[2][1] as { purpose: string }).purpose, "reply.reject");
  assert.deepEqual(calls[3][1], [draftId, "not_answered", "Wrong plan item"]); }
{ const { p } = ports({ inbox: inbox({ ...draft, needsJudgement: true, approvable: false }) }); assert.equal(await decideInboxDraft(p, reject), "draft_rejected", "a judgement draft can be rejected"); }
{ const { p } = ports({ reason: { ok: false, code: "not_recorded" } }); assert.equal(await decideInboxDraft(p, reject), "draft_rejected_no_reason"); }
{ const { p } = ports({ reason: new Error("down") }); assert.equal(await decideInboxDraft(p, reject), "draft_rejected_no_reason"); }
{ const { p, calls } = ports({ command: () => ({ ok: false, code: "stale_context" }) }); assert.equal(await decideInboxDraft(p, reject), "draft_changed");
  assert.ok(!calls.some(c => c[0] === "reason"), "no reason without a rejection"); }

console.log("doctor inbox draft decision checks passed");
