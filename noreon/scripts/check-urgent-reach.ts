import assert from "node:assert/strict";
import { recordScreen, screenPendingMessages } from "@/lib/care-alerts/server";
import { alertReason } from "@/lib/care-alerts/contracts";
import { screenMessage } from "@/lib/care-alerts/screen";
import { job, runPipeline } from "@/lib/zoe/eval/harness";
import { runUnreadUrgentPass } from "@/lib/zoe/server";
import { stagingMatches, stagingUrgentMatcher } from "@/lib/zoe/urgent-staging";
import { unreadUrgentActive, unreadUrgentResult, unreadUrgentRowsSchema, type UnreadUrgentRow } from "@/lib/zoe/unread-urgent";

/**
 * SYNTHETIC checks for how urgent member messages reach people (20261031134000). The database half is in check-urgent-reach.sql.
 * Here: an urgent word with no red flag code escalates through the screening adapter; the fixed 103 text for a member Zoe skips is
 * the text the real pipeline gives a member she reads (so the two can never drift); nothing urgent means no text; no list, no read.
 */
const env = { NOREON_ZOE_URGENT_PLACEHOLDER: "true", NOREON_ZOE_TEST_LEXICON: "false" };
const runId = "e1b00000-0000-4000-8000-000000000001";
const row = (texts: string[], extra: Partial<UnreadUrgentRow> = {}): UnreadUrgentRow => ({ runId, locale: "en", freeMode: false, messages: texts.map((text, i) => ({ seq: i + 1, text })), ...extra });

// Gap 1: every entry family with no code. The list is the source: each text must match with no red flag at all.
const noCode = ["I want to kill myself", "Թունավորվել եմ, բացիկ խմել եմ, շատ հաբեր", "My child swallowed my pills", "I am bleeding heavily and feel dizzy", "У меня кровотечение и кружится голова"];
const coded = noCode.filter(t => { const m = stagingMatches(t); return m.length > 0 && m.every(e => e.redFlag === null); });
assert.ok(coded.length >= 3, `the no-code samples still match with no red flag (${coded.length})`);
for (const text of coded) {
  const d = screenMessage(text, stagingUrgentMatcher);
  assert.equal(d.outcome, "escalate", "no-code word escalates");
  assert.equal(d.reason, "urgent_words_matched");
  assert.deepEqual(d.redFlags, []);
}
{ const seen: Record<string, unknown>[] = [];
  const report = await screenPendingMessages(async (name, args) => { if (name === "care_alert_messages_pending") return [{ messageId: "e1b00000-0000-4000-8000-000000000011", memberId: "e1b00000-0000-4000-8000-000000000012", text: coded[0]! }];
    seen.push(args); return { ok: true, replayed: false, outcome: "escalate", alertId: "e1b00000-0000-4000-8000-000000000013" }; }, stagingUrgentMatcher);
  assert.deepEqual(report, { screened: 1, escalated: 1, failed: 0 }, "an escalation with no code is counted, not failed");
  assert.equal(seen[0]!.p_reason, "urgent_words_matched"); assert.deepEqual(seen[0]!.p_red_flags, []); }
assert.equal(typeof recordScreen, "function");
assert.equal(alertReason({ reason: "urgent_words_matched", redFlags: [] }, "en"), "Message matched the urgent word list", "no empty brackets for staff");
assert.equal(alertReason({ reason: "urgent_words_matched", redFlags: ["RF-01"] }, "en"), "Message matched the urgent word list (RF-01)");
for (const l of ["hy", "ru"] as const) assert.ok(!alertReason({ reason: "urgent_words_matched", redFlags: [] }, l).includes("()"), l);

// Gap 2: the same text as the real pipeline, in each language and each mode, for urgent words, self-harm and a medicine question.
const samples = [["en", "I have crushing chest pain right now"], ["en", "I want to kill myself"], ["en", "I have crushing chest pain, should I take aspirin?"],
  ["ru", "У меня сильно болит грудь прямо сейчас"], ["hy", "կրծքիս ցավ ունեմ հիմա"], ["hy", "krtskis cav unem hima"], ["en", "My child swallowed my pills"]] as const;
for (const [locale, text] of samples) {
  const profile = locale === "en" ? "en" : "hy";
  const run = await runPipeline(job(text, { conversation: { enabled: true, doctorName: null, answeredThroughSeq: 0, memberSpentTodayUsd: 0, injectionsLast24h: 0, locale: profile } }), { env });
  assert.equal(run.outcome, "discarded", `pipeline's urgent route: ${text}`);
  assert.equal(run.reason, "urgent_route_no_model_call", `pipeline's urgent route: ${text}`);
  const mine = unreadUrgentResult(row([text], { locale: profile }), { env, directAnswers: false });
  assert.equal(mine.answer, run.finish!.answer, `the same fixed text: ${text}`);
  assert.equal(mine.language, run.finish!.language, `the same language: ${text}`);
  assert.equal(mine.seq, 1);
  assert.equal(run.providerCalls.length, 0, "the pipeline's urgent route calls no model");
}
{ const text = "I have crushing chest pain right now";
  const run = await runPipeline(job(text, { healthAnswers: true, directAnswers: true, intake: { enabled: true, registered: [], active: null, doctorName: null, latestReading: null, redFlagsAfterSeq: 0 }, conversation: { enabled: true, doctorName: null, answeredThroughSeq: 0, memberSpentTodayUsd: 0, injectionsLast24h: 0, locale: "en" } }), { env, directAnswers: true });
  assert.equal(unreadUrgentResult(row([text], { freeMode: true }), { env, directAnswers: true }).answer, run.finish!.answer, "free mode: the steps text");
  assert.notEqual(unreadUrgentResult(row([text], { freeMode: true }), { env, directAnswers: false }).answer, run.finish!.answer, "free mode needs a real model, as in the pipeline"); }
{ const r = unreadUrgentResult(row(["I want to kill myself"]), { env, directAnswers: false }); assert.equal(r.alertReason, "zoe_self_harm"); }
{ const r = unreadUrgentResult(row(["crushing chest pain"]), { env, directAnswers: false });
  assert.equal(r.alertReason, "zoe_urgent_route"); assert.equal(r.events[0]!.attributes["noreon.zoe.urgent.red_flags"], "RF-01", "the alert gets the code");
  assert.equal(r.events[0]!.outcome, "escalate"); assert.equal(r.events[0]!.attributes["noreon.zoe.unread"], true); }
// Earlier in the batch counts, and the text goes on the newest Telegram message of the run. A combination split across messages too.
{ const r = unreadUrgentResult(row(["crushing chest pain", "hello"]), { env, directAnswers: false }); assert.equal(r.seq, 2); assert.ok(r.answer); }
{ const r = unreadUrgentResult(row(["My glucose is 25.", "I keep vomiting."]), { env, directAnswers: false }); assert.equal(r.seq, 2, "a combination across messages"); assert.equal(r.events[0]!.reason, "urgent_combination_across_unanswered"); }
{ const r = unreadUrgentResult(row(["My glucose is 25.", "Sorry, I mistyped: I keep vomiting."]), { env, directAnswers: false }); assert.equal(r.seq, null, "a correction is not combined"); }
// Nothing urgent: no text, no alert, and the event carries no words.
for (const text of ["Hello, how do I book a visit?", "I had chest pain last year, it is gone", "My blood pressure was 130/80"]) {
  if (stagingMatches(text).length) continue;
  const r = unreadUrgentResult(row([text]), { env, directAnswers: false });
  assert.deepEqual([r.seq, r.answer, r.language, r.alertReason], [null, null, null, null], text);
  assert.equal(r.events[0]!.outcome, "allow"); assert.ok(!JSON.stringify(r.events).includes(text), "no words in the event");
}
assert.ok(!JSON.stringify(unreadUrgentResult(row(["crushing chest pain"]), { env, directAnswers: false }).events).includes("crushing"), "no words in the event");

// The pass. No list in force: nothing is read. One failure leaves that run for the next pass and does not stop the others.
assert.equal(unreadUrgentActive({}), false); assert.equal(unreadUrgentActive(env), true);
{ const calls: string[] = []; assert.deepEqual(await runUnreadUrgentPass(async n => { calls.push(n); return []; }, {}), { sent: 0, checked: 0, failed: 0 }); assert.deepEqual(calls, [], "no list, no read"); }
{ const fin: Record<string, unknown>[] = [];
  const rows = [row(["crushing chest pain"]), row(["Hello there"], { runId: "e1b00000-0000-4000-8000-000000000002" }), row(["Hello again"], { runId: "e1b00000-0000-4000-8000-000000000003" })];
  assert.equal(unreadUrgentRowsSchema.safeParse(rows).success, true);
  const report = await runUnreadUrgentPass(async (name, args) => { if (name === "zoe_unread_urgent_pending") return rows; fin.push(args);
    if (args.p_run === rows[2]!.runId) throw Error("down"); return { ok: true, outcome: (args.p_result as { seq: number | null }).seq === null ? "checked" : "urgent_sent" }; }, env);
  assert.deepEqual(report, { sent: 1, checked: 1, failed: 1 }); assert.equal(fin.length, 3);
  assert.ok(typeof (fin[0]!.p_result as { configVersion: string }).configVersion === "string"); }
assert.deepEqual(await runUnreadUrgentPass(async () => { throw Error("down"); }, env), { sent: 0, checked: 0, failed: 1 });
assert.deepEqual(await runUnreadUrgentPass(async () => ({ surprise: true }), env), { sent: 0, checked: 0, failed: 1 });
{ const r = await runUnreadUrgentPass(async n => n === "zoe_unread_urgent_pending" ? [row(["crushing chest pain"])] : { ok: false, code: "invalid" }, env); assert.deepEqual(r, { sent: 0, checked: 0, failed: 1 }, "a refusal is a failure, retried"); }
console.log("PASS urgent reach: no-code words escalate, the unread 103 text matches the pipeline, nothing urgent sends nothing, no list reads nothing");
