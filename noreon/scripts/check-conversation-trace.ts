import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actorText, conversationTraceSchema, outcomeLabel, traceOutcomes, traceReason, traceTitle, traceViewEnabled } from "@/lib/conversation-trace/contracts";

/** SYNTHETIC checks for the admin Trace view: dark flag, copy for every outcome, schema, page guards. SQL is check-conversation-trace.sql. */
assert.equal(traceViewEnabled({}), false, "Trace view is off by default");
assert.equal(traceViewEnabled({ NOREON_CONVERSATION_TRACE_ENABLED: "1" }), false, "Only exactly true switches it on");
assert.equal(traceViewEnabled({ NOREON_CONVERSATION_TRACE_ENABLED: "true" }), true);
for (const o of traceOutcomes) assert.ok(outcomeLabel[o]?.label, `label for ${o}`);
assert.equal(traceTitle({ name: "intake.processed" }), "Incoming message checked");
assert.equal(traceTitle({ name: "zoe.quiet_hours" }), "Zoe: quiet hours", "Unknown Zoe events still read as words");
assert.match(traceReason({ name: "intake.processed", reason: "member_over_intake_limit" }) ?? "", /intake limit/);
assert.match(traceReason({ name: "delivery.held", reason: "member_over_intake_limit" }) ?? "", /went over the intake limit/);
assert.equal(traceReason({ name: "x", reason: "some_new_code" }), "some new code", "Unknown reasons fall back to words");
assert.equal(traceReason({ name: "x", reason: null }), null);
assert.equal(actorText({ actorKind: "doctor", actorName: "Dr A" }), "Doctor · Dr A");
assert.equal(actorText({ actorKind: "provider", actorName: "x" }), "Telegram");
assert.throws(() => conversationTraceSchema.parse({ ok: true, asOf: "", memberId: "m", memberName: "", conversationId: null, events: [{ id: 1, at: "", step: "intake", name: "x", outcome: "maybe", reason: null, rule: null, ruleVersion: null, actorKind: "system", actorName: null, subjectKind: "x", subjectId: null, attributes: {} }] }), "Unknown outcomes are refused");
for (const page of ["app/staff/real/(review)/trace/page.tsx", "app/staff/real/(review)/trace/[memberId]/page.tsx"]) {
  const src = readFileSync(page, "utf8");
  const flag = src.indexOf("if(!traceViewEnabled())notFound()"), admin = src.indexOf("await requireRealAdmin()"), rpc = src.indexOf("client.rpc(");
  assert.ok(flag > 0 && admin > flag && rpc > admin, `${page}: flag, then admin, then the read`);
  assert.ok(!/\.(body|summary|text)\b/.test(src), `${page}: renders no message text fields`);
}
console.log("PASS conversation trace view: dark by default, copy for every outcome, admin-gated pages, no text fields");
