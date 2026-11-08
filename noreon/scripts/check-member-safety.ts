import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chestPainSafetyNetActive, evaluate, exerciseRemindersAllowed } from "@/lib/clinical/rules/engine";
import type { Answers } from "@/lib/clinical/types";
import {
  EXERCISE_SUGGESTION_RULES, SAFETY_COPY, exerciseGuidance, memberSafetyStatusSchema, memberSafetyView,
  visibleChestPainCard, withExerciseGuidance, type Pair,
} from "@/lib/member-safety/contract";
import { ExercisePauseNotice } from "@/components/patient-care/exercise-pause-notice";
import { HomeLifestyle } from "@/components/patient-care/home-dashboard";
import { ProfileSummary } from "@/components/patient/profile-summary";

/**
 * Member safety holds (DT P342, P371, P389). SQL behaviour is check-member-safety.sql; this
 * covers the screens' reading of the status, the exercise gate on every suggestion surface,
 * and that the SQL trigger's answer values still match the clinical rules they mirror.
 */
const answers = (pairs: Record<string, string>): Answers =>
  Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k, { value: v }])) as unknown as Answers;
const card = { id: "5a000000-0000-4000-8000-000000000001", startedAt: "2026-10-18T00:00:00Z", expiresAt: "2026-11-17T00:00:00Z", hiddenToday: false };

// 1. Status: off means no change; unknown withholds; on follows the database.
assert.deepEqual(memberSafetyView(undefined), { state: "off" });
assert.deepEqual(memberSafetyView({ enabled: false, chestPainCard: null, exercisePaused: false }), { state: "off" });
assert.deepEqual(memberSafetyView(null), { state: "unknown" });
assert.equal(exerciseGuidance({ state: "off" }), "suggest", "Switch off: suggestions as before");
assert.equal(exerciseGuidance({ state: "unknown" }), "withheld", "Unreadable: no suggestion, no claim");
assert.equal(exerciseGuidance(memberSafetyView({ enabled: true, chestPainCard: null, exercisePaused: true })), "paused");
assert.equal(exerciseGuidance(memberSafetyView({ enabled: true, chestPainCard: null, exercisePaused: false })), "suggest");
assert.equal(visibleChestPainCard(memberSafetyView({ enabled: true, chestPainCard: card, exercisePaused: false }))?.id, card.id);
assert.equal(visibleChestPainCard(memberSafetyView({ enabled: true, chestPainCard: { ...card, hiddenToday: true }, exercisePaused: false })), null, "Hidden today");
assert.equal(visibleChestPainCard({ state: "off" }), null);
assert.equal(visibleChestPainCard({ state: "unknown" }), null);
assert.equal(memberSafetyStatusSchema.safeParse({ enabled: true, chestPainCard: { ...card, id: "x" }, exercisePaused: false }).success, false, "Malformed status is not trusted");

// 2. The SQL trigger mirrors the rules: every answer it opens a hold for fires the matching rule.
const sql = readFileSync(`supabase/migrations/${readdirSync("supabase/migrations").find((f) => f.endsWith("_member_safety_ui.sql"))}`, "utf8");
assert.match(sql, /a->'q9\.present'->>'value' in\('yes','unsure'\)and a->'q9\.right_now'->>'value'='no'/, "Chest card condition");
assert.match(sql, /a->'q10\.syncope'->>'value' in\('exertion','rest'\)/, "Exercise pause condition");
for (const present of ["yes", "unsure"]) {
  const ids = evaluate({ answers: answers({ "q9.present": present, "q9.right_now": "no" }), observations: [] }).findings.map((f) => f.ruleId);
  assert.ok(ids.includes("NRN-RULE-CP-002") || ids.includes("RF-07"), `q9.present=${present}, not now: a chest-pain finding (P341)`);
  const now = evaluate({ answers: answers({ "q9.present": present, "q9.right_now": "yes" }), observations: [] });
  assert.equal(now.urgency, "red", "Right now goes to the 103 screen instead of the card");
}
const worse = evaluate({ answers: answers({ "q9.present": "yes", "q9.right_now": "no", "q9.crescendo": "worse" }), observations: [] }).findings.map((f) => f.ruleId);
assert.ok(worse.includes("RF-07"), "Unstable answers still get the card (any positive answer, P341)");
for (const [value, rule] of [["exertion", "RF-08"], ["rest", "RF-09"]] as const) {
  const ids = evaluate({ answers: answers({ "q10.symptoms": "palpitations_only", "q10.syncope": value }), observations: [] }).findings.map((f) => f.ruleId);
  assert.ok(ids.includes(rule), `q10.syncope=${value} fires ${rule}`);
}
// F3: one condition. The SQL text is pinned above; the engine helpers must give the same truth table.
for (const present of ["yes", "unsure", "no", undefined])
  for (const now of ["yes", "no", undefined]) {
    const a = answers(Object.fromEntries([["q9.present", present], ["q9.right_now", now]].filter(([, v]) => v)) as Record<string, string>);
    assert.equal(chestPainSafetyNetActive(a), (present === "yes" || present === "unsure") && now === "no", `Engine card condition ${present}/${now} matches SQL`);
  }
for (const syncope of ["exertion", "rest", "vasovagal", "never", undefined]) {
  const a = answers(syncope ? { "q10.syncope": syncope } : {});
  assert.equal(exerciseRemindersAllowed(a), !(syncope === "exertion" || syncope === "rest"), `Engine pause condition ${syncope} matches SQL`);
}
const vasovagal = evaluate({ answers: answers({ "q10.symptoms": "palpitations_only", "q10.syncope": "vasovagal" }), observations: [] }).findings.map((f) => f.ruleId);
assert.ok(!vasovagal.includes("RF-08") && !vasovagal.includes("RF-09"), "Vasovagal fainting is not RF-08/RF-09 and pauses nothing");

// 3. Screening advice: the activity suggestion follows the gate; nothing else changes.
const sedentary = answers({ "q2.activity": "sedentary" });
const decision = evaluate({ answers: sedentary, observations: [] });
const act = decision.findings.find((f) => EXERCISE_SUGGESTION_RULES.has(f.ruleId));
assert.ok(act?.nextStep, "Sedentary answer produces the activity suggestion");
assert.equal(withExerciseGuidance(decision, "suggest"), decision, "Suggest: unchanged object");
const paused = withExerciseGuidance(decision, "paused");
assert.match(paused.findings.find((f) => f.ruleId === act.ruleId)!.nextStep!.en!, /Check with your doctor before exercising/);
assert.equal(withExerciseGuidance(decision, "withheld").findings.find((f) => f.ruleId === act.ruleId)!.nextStep, undefined);
assert.deepEqual(paused.findings.filter((f) => f.ruleId !== act.ruleId), decision.findings.filter((f) => f.ruleId !== act.ruleId), "Other findings untouched");
const summary = (exercise: "suggest" | "paused" | "withheld", locale: "en" | "hy" = "en") =>
  renderToStaticMarkup(createElement(ProfileSummary, { answers: sedentary, locale, exercise }));
assert.match(summary("suggest"), /Build up to 150 minutes a week/);
assert.doesNotMatch(summary("paused"), /Build up to 150 minutes a week/);
assert.match(summary("paused"), /Check with your doctor before exercising/);
assert.match(summary("paused", "hy"), /Մարզվելուց առաջ խորհրդակցեք ձեր բժշկի հետ/);
assert.doesNotMatch(summary("withheld"), /150 minutes|Check with your doctor/);
// F1: the prop is required, so a call site that forgets the gate does not compile.
// @ts-expect-error exercise is required
void createElement(ProfileSummary, { answers: sedentary, locale: "en" });

// 4. Home lifestyle: the movement tip follows the gate (HomeLifestyle loads next/image, which
// this loader cannot render, so the branch is checked in source and the notice is rendered).
assert.match(readFileSync("components/patient-care/home-dashboard.tsx", "utf8"),
  /\{exercise === "suggest" \? <MovementTip locale=\{l\} hasPlan=\{hasPlan\} \/> : exercise === "paused" \? <ExercisePauseNotice locale=\{l\} \/> : null\}/);
// @ts-expect-error exercise is required on HomeLifestyle too
void createElement(HomeLifestyle, { locale: "en" });
const dashboard = readFileSync("components/patient/member-home-content.tsx", "utf8");
assert.match(dashboard, /<HomeLifestyle locale=\{l\} exercise=\{exerciseGuidance\(safety\)\} hasPlan=\{!!care\.plan\} \/>/, "Home passes the gate");
assert.match(dashboard, /readMemberSafety\(\)/, "Home reads the member's holds");
assert.match(dashboard, /\{!urgent && safetyCard && \(\s*<ChestPainSafetyCard card=\{safetyCard\} locale=\{l\} hide=\{hideChestPainCardToday\} \/>/, "Home shows the card under the header (the urgent screen takes over when red)");
assert.match(readFileSync("components/patient-care/chest-pain-safety-card.tsx", "utf8"), /href="tel:103" icon=\{Phone\} variant="emergency-pill"/, "Everyday screen: the outlined 103 pill (Khikar, 18 Oct)");
assert.match(dashboard, /const safetyCard = visibleChestPainCard\(safety\);/, "Hidden-today cards are not shown");
const notice = renderToStaticMarkup(createElement(ExercisePauseNotice, { locale: "hy" }));
assert.match(notice, /data-exercise-paused/);
assert.match(notice, /Մարզվելուց առաջ խորհրդակցեք ձեր բժշկի հետ/);

// 5. Every exercise-suggestion surface asks the gate. A new <MovementTip> or a new screen that
// renders screening next steps must be added here and gated (DT P389).
const grepFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? grepFiles(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []);
const member = [...grepFiles("app"), ...grepFiles("components")].filter((f) => !/^app\/(demo|staff|clinic|internal)\/|^components\/(demo|staff|clinic-portal|backoffice)\//.test(f));
const movementUses = member.filter((f) => /<MovementTip\b/.test(readFileSync(f, "utf8")));
assert.deepEqual(movementUses, ["components/patient-care/home-dashboard.tsx"], "MovementTip renders only from HomeLifestyle");
assert.match(readFileSync("components/patient-care/home-dashboard.tsx", "utf8"), /exercise === "suggest" \? <MovementTip/);
const nextStepRenderers = member.filter((f) => /finding\.nextStep|f\.nextStep/.test(readFileSync(f, "utf8")));
for (const f of nextStepRenderers) {
  const text = readFileSync(f, "utf8");
  // Orange-only renderers never show NRN-RULE-ACT-001 (yellow); the rest must apply the gate.
  assert.ok(/withExerciseGuidance\(/.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")) || /urgency === "orange" && f\.nextStep/.test(text) || /urgent\.nextStep/.test(text) || /f\.urgency === "orange"/.test(text),
    `${f} renders screening next steps without the exercise gate`);
}
assert.match(readFileSync("app/patient/health/profile/page.tsx", "utf8"), /exercise=\{exerciseGuidance\(safety\)\}/);

// 6. Copy: EN and HY for every string, voice guide (no em dashes, no exclamation marks).
const pairs: Pair[] = [];
const walk = (v: unknown) => { if (v && typeof v === "object") { if ("en" in v && "hy" in v) pairs.push(v as Pair); else Object.values(v).forEach(walk); } };
walk(SAFETY_COPY);
assert.ok(pairs.length > 40);
for (const p of pairs) {
  assert.ok(p.en.trim() && p.hy.trim(), "Both languages present");
  assert.notEqual(p.en, p.hy, `Armenian is translated: ${p.en}`);
  assert.doesNotMatch(p.en + p.hy, /—|!/, `Voice guide: ${p.en}`);
}
assert.equal(SAFETY_COPY.status, "unapproved", "Placeholder until Armen/Tatevik sign off");
assert.equal(SAFETY_COPY.card.call103Now.en, "Call 103 now. Do not drive, and do not stay on your own.", "Reuses the RF-01 wording");
console.log("Member safety: status reading, rule mirror, exercise gate on summary and Home, surface guard, EN/HY copy.");
