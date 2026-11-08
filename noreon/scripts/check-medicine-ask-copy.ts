import assert from "node:assert/strict";
import { ASK_REASONS, MEDICINE_ASK_COPY, askNext, askWhen, type AskLocale } from "@/lib/member-medicines/ask-copy";
import { reasonsByMedicine, type DoctorConcern, type StaffReason } from "@/lib/member-medicines/asks";
import { concernSummary, reasonLabel } from "@/lib/member-medicines/staff-copy";

// Item 5 (Armen, 20 Oct): Zoe asks why, never advises. The copy must be complete in en, hy and ru, follow the voice
// guide, and carry no dose or "take/stop it" instruction in any language.
const locales: AskLocale[] = ["en", "hy", "ru"];
const lines = (l: AskLocale): string[] => {
  const c = MEDICINE_ASK_COPY[l];
  return [c.title, c.skipped("X", "08:00"), c.missed("X", "08:00"), c.why, ...Object.values(c.reasons), c.notNow, c.today, c.yesterday,
    c.forgot.body, c.forgot.action, ...Object.values(c.refill), ...Object.values(c.doctor), c.failed, c.closed];
};
for (const l of locales) {
  const all = lines(l);
  assert.equal(all.length, lines("en").length, `${l}: every line present`);
  for (const line of all) {
    assert.ok(line.trim().length > 0, `${l}: no empty line`);
    assert.doesNotMatch(line, /[!—–]/u, `${l}: no exclamation marks or em/en dashes: ${line}`);
    assert.doesNotMatch(line, /\p{Extended_Pictographic}/u, `${l}: no emoji: ${line}`);
    // No dose or instruction: amounts, units, "take/double/stop taking", "next dose", in each language.
    assert.doesNotMatch(line, /\b\d+\s?(mg|mcg|ml)\b|tablet|double|take (it|another|the next)|stop taking|keep taking|next dose|дозу?|таблет|мг|принимайте|прекратите|դեղաչափ|հաբ|ընդունեք|դադարեցրեք/iu, `${l}: no dose instruction: ${line}`);
    assert.doesNotMatch(line, /\b(patient|user)\b/i, `${l}: say "you" or "member": ${line}`);
  }
  assert.equal(Object.keys(MEDICINE_ASK_COPY[l].reasons).sort().join(), [...ASK_REASONS].sort().join(), `${l}: exactly the five reasons`);
  assert.match(MEDICINE_ASK_COPY[l].doctor.urgent, /103/, `${l}: the urgent line names 103`);
}

// Routing: side effect and stopping only ever reach the doctor; nothing else does.
assert.deepEqual(ASK_REASONS.map(askNext), ["reminders", "doctor", "refill", "refill", "doctor"]);

// When: today, yesterday or a date, in Yerevan time.
const now = new Date("2026-10-20T10:00:00Z");
assert.equal(askWhen("2026-10-20T04:00:00Z", now, "en"), "08:00 today");
assert.equal(askWhen("2026-10-19T16:00:00Z", now, "hy"), "20:00 երեկ");
assert.equal(askWhen("2026-10-17T04:00:00Z", now, "ru"), "08:00, 17.10");
// Just after Yerevan midnight is "today", although it is still the previous day in UTC.
assert.equal(askWhen("2026-10-19T20:30:00Z", new Date("2026-10-19T21:00:00Z"), "en"), "00:30 today");

// Staff: reasons grouped per medicine, newest first; the summary carries facts, never advice.
const reason = (medicineId: string, dueAt: string, r: StaffReason["reason"]): StaffReason => ({ source: "self", medicineId, dueAt, trigger: "skipped", reason: r, answeredAt: dueAt, concern: null });
const grouped = reasonsByMedicine([reason("00000000-0000-4000-8000-000000000001", "2026-10-18T04:00:00Z", "forgot"), reason("00000000-0000-4000-8000-000000000001", "2026-10-19T04:00:00Z", "ran_out")]);
assert.deepEqual(grouped.get("self:00000000-0000-4000-8000-000000000001")?.map(r => r.reason), ["ran_out", "forgot"]);
for (const l of ["en", "hy"] as const) for (const r of ASK_REASONS) assert.ok(reasonLabel(l, r).length > 0);
const concern: DoctorConcern = {
  id: "00000000-0000-4000-8000-0000000000c1", memberId: "00000000-0000-4000-8000-0000000000a1", memberName: "Fictional", kind: "side_effect", createdAt: "2026-10-20T08:00:00Z",
  ask: { id: "00000000-0000-4000-8000-0000000000b1", source: "plan", medicineId: "00000000-0000-4000-8000-0000000000d1", dueAt: "2026-10-20T05:00:00Z", trigger: "missed", state: "answered", reason: "side_effect",
    createdAt: "2026-10-20T09:00:00Z", answeredAt: "2026-10-20T09:05:00Z", medicine: { name: "Fictional medicine", dose: "5 mg" }, careTeamAsked: false },
  ticks14: { taken: 10, skipped: 2 },
};
assert.equal(concernSummary(concern, "en"), "Did not tick Fictional medicine 5 mg at 20.10 09:00. Told Zoe: side effect. Last 14 days: 10 taken, 2 skipped (the member's own ticks). The member was told you will answer.");
assert.match(concernSummary({ ...concern, kind: "refill", ask: { ...concern.ask, reason: "ran_out", trigger: "skipped" } }, "en"), /^Marked .* as skipped\. Told Zoe: ran out\. .*refill\.$/);
assert.match(concernSummary(concern, "hy"), /Զոիին ասել է/);
console.log("medicine ask copy and routing: ok");
