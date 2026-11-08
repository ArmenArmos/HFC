import assert from "node:assert/strict";
import { compareItems, doctorInboxSchema, draftActions, itemKinds, itemSummary, laneGroups, notApprovableReason, orderInbox, primaryAction, type InboxDraft, type InboxItem } from "@/lib/doctor-inbox/contracts";

/** SYNTHETIC checks for the doctor's four-lane inbox ordering and buttons. Access and closure: check-doctor-ai-inbox.sql. */
const m = "d1a00000-0000-4000-8000-000000000001";
const item = (over: Partial<InboxItem> & Pick<InboxItem, "id" | "lane" | "kind" | "rank" | "at">): InboxItem =>
  ({ memberId: m, memberName: "Synthetic", confidence: "H", ai: "none", sources: [], ...over }) as InboxItem;
const alert = (id: string, state: "open" | "acknowledged", at: string, rank: number) => ({
  id: `care_alert:${id}`, lane: "P0" as const, kind: "care_alert" as const, rank, at, memberId: m, memberName: "Synthetic", confidence: "rule" as const, ai: "none" as const, sources: [],
  alert: { id: `d1a00000-0000-4000-8000-0000000000${id.charCodeAt(0)}`, memberId: m, memberName: "Synthetic", source: "questionnaire" as const, priority: "urgent" as const, reason: "questionnaire_red_flag", redFlags: ["RF-03"], state, stateSeq: 0, occurrences: 1,
    createdAt: at, lastSeenAt: at, doctorName: null, acknowledgedAt: state === "acknowledged" ? at : null, acknowledgedBy: null, resolvedAt: null, resolvedBy: null, resolution: null, resolutionNote: null, telegram: [] },
});

// Lane first, then rank, then oldest first, then id.
const old = "2026-10-10T08:00:00Z", mid = "2026-10-15T08:00:00Z", recent = "2026-10-19T08:00:00Z";
const shuffled = [
  item({ id: "p3", lane: "P3", kind: "reply_draft", rank: 0, at: old, ai: "draft", confidence: "M" }),
  item({ id: "p2-lab", lane: "P2", kind: "lab_sheet", rank: 3, at: old }),
  item({ id: "p2-plan", lane: "P2", kind: "plan_draft", rank: 1, at: recent, ai: "draft", confidence: "M" }),
  item({ id: "p1-reply", lane: "P1", kind: "reply_overdue", rank: 4, at: old }),
  item({ id: "p1-lab-new", lane: "P1", kind: "lab_attention", rank: 0, at: recent }),
  item({ id: "p1-lab-old", lane: "P1", kind: "lab_attention", rank: 0, at: mid }),
];
assert.deepEqual(orderInbox(shuffled).map(i => i.id), ["p1-lab-old", "p1-lab-new", "p1-reply", "p2-plan", "p2-lab", "p3"]);
// P0 sorts before every other lane, however old the AI item is.
assert.ok(compareItems({ lane: "P0", rank: 1, at: recent, id: "z" }, { lane: "P1", rank: 0, at: "2020-01-01T00:00:00Z", id: "a" }) < 0, "P0 before an older P1 item");
assert.ok(compareItems({ lane: "P0", rank: 1, at: recent, id: "z" }, { lane: "P3", rank: 0, at: "2020-01-01T00:00:00Z", id: "a" }) < 0, "P0 before an older AI draft");
// Within P0: open before acknowledged, then oldest first.
const groups = laneGroups({ p0: [alert("b", "acknowledged", old, 1), alert("c", "open", recent, 0), alert("a", "open", mid, 0)], items: shuffled });
assert.deepEqual(groups.P0.map(i => i.id), ["care_alert:a", "care_alert:c", "care_alert:b"]);
assert.deepEqual([groups.P1.length, groups.P2.length, groups.P3.length], [3, 2, 1]);
// P0 group exists even when empty.
assert.deepEqual(laneGroups({ p0: [], items: [] }).P0, []);

// A low confidence or no draft never offers Approve; a stale plan says prepare again.
const draft = item({ id: "r", lane: "P3", kind: "reply_draft", rank: 0, at: old, ai: "draft", confidence: "M" });
assert.match(primaryAction(draft, "en").label, /^Approve/);
assert.equal(primaryAction({ ...draft, confidence: "L" }, "en").label, "Write reply");
assert.equal(primaryAction({ ...draft, ai: "none", confidence: "L" }, "en").label, "Write reply");
assert.equal(primaryAction(item({ id: "p", lane: "P2", kind: "plan_draft", rank: 1, at: old, stale: true }), "en").label, "Prepare again");
assert.equal(primaryAction(item({ id: "l", lane: "P1", kind: "lab_attention", rank: 0, at: old, fileId: m }), "en").href, `/staff/real/members/${m}/documents/${m}/check`);
assert.equal(primaryAction(draft, "en").href, `/staff/real/conversations/${m}`);

// The contract refuses an AI item claiming the P0 lane, and a P0 item without an alert.
const envelope = { version: "doctor-inbox-v1", ok: true, asOf: recent, p0Total: 0, laneCap: 50, unavailable: [] };
assert.equal(doctorInboxSchema.safeParse({ ...envelope, p0: [], items: [{ ...draft, lane: "P0" }] }).success, false);
assert.equal(doctorInboxSchema.safeParse({ ...envelope, p0: [{ ...draft, lane: "P0", kind: "care_alert" }], items: [] }).success, false);
assert.equal(doctorInboxSchema.safeParse({ ...envelope, p0: [alert("a", "open", old, 0)], items: [draft] }).success, true);

// Reply drafts (#323 in the inbox): Approve only when the database says approvable and confidence is not low; Edit always;
// a judgement, stale, replaced-plan or open-alert draft leads with Edit and says why.
const d0: InboxDraft = { draftId: m, revision: 1, body: "Synthetic", contentHash: "h", author: "ai_assistant", structured: true, stale: false, planCurrent: true, openAlert: false,
  asked: "Synthetic", acknowledgementId: "A1", needsJudgement: false, outsidePlan: false, judgementReasons: [], doctorDecides: [], approvable: true };
assert.deepEqual(draftActions({ draft: d0, confidence: "M" }), { approve: true, edit: true, reject: true, lead: "approve" });
assert.equal(draftActions({ draft: d0, confidence: "L" }).approve, false, "low confidence never approves in one tap");
for (const over of [{ needsJudgement: true }, { stale: true }, { planCurrent: false }, { openAlert: true }, { structured: false }] as Partial<InboxDraft>[]) {
  const d = { ...d0, ...over, approvable: false };
  assert.deepEqual([draftActions({ draft: d, confidence: "M" }).approve, draftActions({ draft: d, confidence: "M" }).lead], [false, "edit"], JSON.stringify(over));
  assert.ok(notApprovableReason(d, "en"), `reason shown for ${JSON.stringify(over)}`);
}
assert.match(notApprovableReason({ ...d0, approvable: false, openAlert: true, needsJudgement: true }, "en") ?? "", /open alert/, "an open alert is named first");
assert.equal(notApprovableReason(d0, "en"), null);
assert.equal(draftActions({ confidence: "M" }).approve, false, "no draft, no Approve");
// A question needing judgement is a P1 item and keeps its draft through the contract.
const judgement = item({ id: "j", lane: "P1", kind: "reply_draft", rank: 4, at: recent, ai: "draft", confidence: "M", draft: { ...d0, needsJudgement: true, approvable: false } });
assert.equal(doctorInboxSchema.safeParse({ ...envelope, p0: [], items: [judgement] }).success, true);
assert.match(itemSummary(judgement, "en"), /needs your judgement/);
assert.deepEqual(orderInbox([draft, judgement]).map(i => i.id), ["j", "r"], "judgement question (P1) before a routine draft (P3)");

// Astra ID-02: the app deploys after the migration, so the kinds the database emits must stay the ones the running app parses.
assert.deepEqual([...itemKinds], ["lab_attention", "lab_sheet", "checkin_worse", "checkpoint_due", "plan_draft", "intake", "reply_overdue", "reply_not_delivered", "reply_draft", "bp_repeat_pending"]);

console.log("doctor AI inbox checks passed");
