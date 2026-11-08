import assert from "node:assert/strict";
import { DEFAULT_QUIET_HOURS, dailySpendCapUsd, inQuietHours, scheduledQuestionDecision, spendCapDecision, zoeScaffoldEnabled, zonedParts } from "@/lib/zoe/policy";
import { AWAITING_S1_LEXICON, createUrgentMatcher } from "@/lib/zoe/urgent";
import { recordZoeDecision } from "@/lib/zoe/trace";

/** SYNTHETIC checks for Zoe's non-AI policy (K3, K4 flag, K7, S1 placeholder). No model, provider or network. */
const yerevan = (hhmm: string, day = "2026-10-17") => new Date(`${day}T${hhmm}:00+04:00`);
assert.equal(zoeScaffoldEnabled({}), false, "Scaffold is off by default");
assert.equal(zoeScaffoldEnabled({ NOREON_ZOE_SCAFFOLD_ENABLED: "TRUE" }), false);

// K3 quiet hours: 21:00 to 09:00 Yerevan, crossing midnight, independent of the server zone.
for (const [t, quiet] of [["20:59", false], ["21:00", true], ["23:59", true], ["00:00", true], ["08:59", true], ["09:00", false], ["13:30", false]] as const)
  assert.equal(inQuietHours(yerevan(t)), quiet, `quiet at ${t} Yerevan is ${quiet}`);
assert.equal(inQuietHours(new Date("2026-10-17T17:30:00Z")), true, "17:30 UTC is 21:30 Yerevan");
assert.equal(inQuietHours(yerevan("23:00"), { ...DEFAULT_QUIET_HOURS, start: "09:00", end: "09:00" }), false, "Equal start and end means no quiet hours");
assert.throws(() => inQuietHours(yerevan("10:00"), { ...DEFAULT_QUIET_HOURS, start: "25:00" }), "Invalid time is refused");
assert.equal(zonedParts(new Date("2026-10-17T21:30:00Z"), "Asia/Yerevan").day, "2026-10-18", "The member's day is the Yerevan day");

// K3 daily cap: 2 per day unless the doctor's plan says more; never less through the plan.
const at = yerevan("10:00");
assert.equal(scheduledQuestionDecision({ now: at, sentToday: 0 }).outcome, "allow");
assert.equal(scheduledQuestionDecision({ now: at, sentToday: 1 }).outcome, "allow");
const capped = scheduledQuestionDecision({ now: at, sentToday: 2 });
assert.deepEqual([capped.outcome, capped.reason, capped.rule], ["block", "daily_question_cap_reached", "zoe.k3.daily_max"]);
assert.equal(scheduledQuestionDecision({ now: at, sentToday: 2, planDailyMax: 3 }).outcome, "allow", "Doctor's plan may say more");
assert.equal(scheduledQuestionDecision({ now: at, sentToday: 2, planDailyMax: 1 }).reason, "daily_question_cap_reached", "A plan value below the default does not lower it here");
assert.equal(scheduledQuestionDecision({ now: at, sentToday: 10, planDailyMax: 50 }).outcome, "block", "A plan value is bounded at 10 a day");
assert.equal(scheduledQuestionDecision({ now: at, sentToday: -1 }).reason, "sent_count_unknown", "Unreadable count fails closed");
assert.equal(scheduledQuestionDecision({ now: at, sentToday: Number.NaN }).outcome, "block");
const night = scheduledQuestionDecision({ now: yerevan("22:00"), sentToday: 0 });
assert.deepEqual([night.outcome, night.reason], ["block", "quiet_hours"], "Quiet hours win over remaining allowance");
assert.equal(night.attributes["noreon.zoe.quiet_hours"], "21:00-09:00 Asia/Yerevan");

// K7 spend cap: config may lower, never raise; invalid fails closed; model calls are not permitted at all yet.
assert.equal(dailySpendCapUsd({}), 10);
assert.equal(dailySpendCapUsd({ NOREON_ZOE_DAILY_SPEND_CAP_USD: "4.50" }), 4.5);
for (const bad of ["11", "-1", "ten", "1e3", "10.001"]) assert.equal(dailySpendCapUsd({ NOREON_ZOE_DAILY_SPEND_CAP_USD: bad }), 0, `cap ${bad} fails closed`);
const gate = spendCapDecision({ spentTodayUsd: 0, estimateUsd: 0.01 });
assert.deepEqual([gate.outcome, gate.reason, gate.rule], ["block", "model_calls_not_permitted", "zoe.k2.launch_gate"], "K2 launch gate blocks every model call");
assert.equal(spendCapDecision({ spentTodayUsd: 9.98, estimateUsd: 0.01, modelCallsAllowed: true }).outcome, "allow");
assert.equal(spendCapDecision({ spentTodayUsd: 9.995, estimateUsd: 0.01, modelCallsAllowed: true }).reason, "daily_spend_cap_reached");
assert.equal(spendCapDecision({ spentTodayUsd: 1, estimateUsd: 1, capUsd: 0, modelCallsAllowed: true }).outcome, "block", "Cap 0 blocks");
assert.equal(spendCapDecision({ spentTodayUsd: 10, estimateUsd: 1, capUsd: 50, modelCallsAllowed: true }).reason, "daily_spend_cap_reached", "A caller cannot raise the cap above US$10");
assert.equal(spendCapDecision({ spentTodayUsd: Number.NaN, estimateUsd: 1, modelCallsAllowed: true }).reason, "spend_unknown");

// S1: the urgent word list is empty and awaiting sign-off; the matcher never says "not urgent".
assert.equal(AWAITING_S1_LEXICON.entries.length, 0, "No urgent words before S1 sign-off");
assert.equal(AWAITING_S1_LEXICON.status, "awaiting_s1_clinical_signoff");
const m = createUrgentMatcher();
assert.deepEqual(m.match("chest pain right now"), []);
const d = m.decide("chest pain right now");
assert.deepEqual([d.outcome, d.reason], ["skipped", "lexicon_awaiting_s1_signoff"], "Unsigned lexicon is skipped, not a negative result");
assert.ok(!JSON.stringify(d).includes("chest"), "No text in the decision");
const unsignedWithWords = createUrgentMatcher({ version: "x", status: "signed_off", signedBy: null, entries: [{ id: "e1", locale: "en", phrase: "chest pain", redFlag: "RF-01" }] });
assert.equal(unsignedWithWords.decide("chest pain").outcome, "skipped", "A lexicon without a named signatory is not used");
const signed = createUrgentMatcher({ version: "test", status: "signed_off", signedBy: "synthetic", entries: [{ id: "e1", locale: "en", phrase: "Synthetic Phrase", redFlag: "RF-02" }] });
assert.deepEqual([signed.decide("a synthetic phrase here").outcome, signed.decide("nothing").outcome], ["escalate", "recorded"], "Interface works once a list is signed (synthetic only)");
const { decide } = signed;
assert.equal(decide("a synthetic phrase here").outcome, "escalate", "decide works when destructured");

// Journal port: a decision that could not be journaled is reported as not recorded.
const calls: unknown[] = [];
assert.equal(await recordZoeDecision(async a => { calls.push(a); return { data: { ok: true }, error: null }; }, "m", night), true);
assert.deepEqual(calls[0], { p_member: "m", p_name: "zoe.scheduled_question", p_outcome: "block", p_reason: "quiet_hours", p_rule: "zoe.k3.quiet_hours", p_rule_version: "k3-a-2026-10-16", p_attributes: night.attributes });
assert.equal(await recordZoeDecision(async () => ({ data: null, error: { message: "x" } }), "m", night), false);
assert.equal(await recordZoeDecision(async () => { throw Error("down"); }, "m", night), false);
assert.equal(await recordZoeDecision(async () => ({ data: { ok: false }, error: null }), "m", night), false);
console.log("PASS zoe policy: Yerevan quiet hours, 2/day unless plan says more, US$10 cap never raised, model calls gated, empty S1 lexicon, journal port");
