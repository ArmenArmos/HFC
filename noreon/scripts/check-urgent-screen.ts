import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AnswerSaveQueue } from "@/lib/patient/answer-save-queue";
import { reviewableAnswer, urgentAnswerReviewEnabled } from "@/lib/care-alerts/urgent-review";
import { ruleById } from "@/lib/clinical/rules/rules";
import { createPatientAnswerHandler } from "@/lib/patient/answer-http";
import { alertReason } from "@/lib/care-alerts/contracts";
import type { Answers } from "@/lib/clinical/types";

/** SYNTHETIC checks for the urgent screen follow-up (QA M-01, M-09). SQL is check-urgent-screen-care-team.sql. */

// M-09: a transient failure is retried quietly; a conflict or invalid answer is not.
{
  const results: Array<{ ok: true; revision: number } | { ok: false; reason: string } | null> = [null, { ok: false, reason: "unavailable" }, { ok: true, revision: 2 }];
  let calls = 0;
  const q = new AnswerSaveQueue(1, async () => results[calls++], () => {}, [1, 1, 1]);
  q.enqueue([{ fieldId: "q9.right_now", value: "yes" }]);
  assert.equal(await q.flush(), true, "Recovered after two transient failures");
  assert.equal(calls, 3);
  assert.equal(q.failure, undefined);
  let n = 0;
  const giveUp = new AnswerSaveQueue(1, async () => { n++; return null; }, () => {}, [1, 1]);
  giveUp.enqueue([{ fieldId: "x", value: "y" }]);
  assert.equal(await giveUp.flush(), false, "Shows the failure after the retries run out");
  assert.equal(n, 3);
  let c = 0;
  const conflict = new AnswerSaveQueue(1, async () => { c++; return { ok: false, reason: "conflict" }; }, () => {}, [1, 1]);
  conflict.enqueue([{ fieldId: "x", value: "y" }]);
  assert.equal(await conflict.flush(), false);
  assert.equal(c, 1, "A conflict is never retried automatically");
  let d = 0;
  const plain = new AnswerSaveQueue(1, async () => { d++; return null; });
  plain.enqueue([{ fieldId: "x", value: "y" }]);
  assert.equal(await plain.flush(), false);
  assert.equal(d, 1, "Without delays nothing changes for existing callers");
}

// M-09: an auth service that throws answers 503 (retry), never 401 (signed out).
{
  const handler = createPatientAnswerHandler({ user: async () => { throw Error("auth timeout"); }, store: () => { throw Error("unused"); } });
  const res = await handler(new Request("http://localhost/patient/answers", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: "{}" }));
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, reason: "unavailable" });
  assert.match(readFileSync("app/patient/answers/route.ts", "utf8"), /user:patientIdentityForSave/, "Answer saves use the strict identity");
}

// Mistake review: off by default; only the single-choice answer that fired the red flag.
assert.equal(urgentAnswerReviewEnabled({}), false);
assert.equal(urgentAnswerReviewEnabled({ NOREON_URGENT_ANSWER_REVIEW_ENABLED: "1" }), false);
assert.equal(urgentAnswerReviewEnabled({ NOREON_URGENT_ANSWER_REVIEW_ENABLED: "true" }), true);
const a = (id: string, value: string): Answers => ({ [id]: { fieldId: id, value, source: "manual", answeredAt: "2026-10-17T00:00:00Z" } });
const rf01 = ruleById("RF-01")!;
const r = reviewableAnswer(rf01, { ...a("q9.present", "yes"), ...a("q9.right_now", "yes") });
assert.equal(r?.field.id, "q9.right_now");
assert.equal(r?.value, "yes");
assert.ok(r?.field.options.some(o => o.value === "no"));
assert.equal(reviewableAnswer(rf01, {}), null, "No hit, nothing to review");
assert.equal(reviewableAnswer({ ...rf01, urgency: "orange" }, a("q9.right_now", "yes")), null, "Never for orange");
assert.equal(reviewableAnswer({ urgency: "red", evaluate: () => ({ triggeredBy: "episode.chest_pain" }) }, {}), null, "Episode answers are not reviewable here");

// Urgent page: 103 first; "alerted" only from the database status; Get help always; review gated.
const page = readFileSync("app/patient/urgent/page.tsx", "utf8");
assert.ok(page.indexOf('href="tel:103"') < page.indexOf("status.alerted") && page.indexOf("status.alerted") < page.indexOf('href="/patient/help"'), "103, then the alert line, then help");
assert.match(page, /status === null\s*\?[\s\S]*?: status\.alerted\s*\?/, "Unknown status is neutral; alerted wording depends on the database status (U4)");
assert.match(page, /changed === "1" \? "\/patient\/questions\?changed=1"/, "A cleared correction keeps its confirmation (U5)");
assert.match(page, /urgentAnswerReviewEnabled\(\) && status\?\.alertsEnabled === true && reviewableAnswer/, "Review link needs the flag, alerts on, and a reviewable answer");
const review = readFileSync("app/patient/urgent/review/page.tsx", "utf8");
assert.ok(review.indexOf("if (!urgentAnswerReviewEnabled()) notFound()") > 0 && review.indexOf('href="tel:103"') < review.indexOf("<form"), "Review: flag first, 103 above the form");
const action = readFileSync("lib/care-alerts/member-actions.ts", "utf8");
assert.ok(action.indexOf("urgentAnswerReviewEnabled()") < action.indexOf("patientIdentityForSave()") && action.indexOf("patientIdentityForSave()") < action.indexOf("status?.alertsEnabled") && action.indexOf("urgentAnswerReviewEnabled()") < action.indexOf("status?.alertsEnabled") && action.indexOf("status?.alertsEnabled") < action.indexOf("saveAnswers"), "Action: flag, alerts on, then save");
for (const src of [page, review]) assert.ok(!src.includes("—") && !/[a-z]!["']/i.test(src), "Copy: no em dashes or exclamation marks");
assert.match(alertReason({ reason: "questionnaire_red_flag_cleared", redFlags: ["RF-01"] }, "en"), /changed a red flag answer \(RF-01\)/);
console.log("PASS urgent screen: quiet retry, 503 on auth failure, review off by default and red-only, page order and gates");
