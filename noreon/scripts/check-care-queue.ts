import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateBp, evaluateLipids, type ZoneResult } from "@/lib/clinical/zones/evaluate";
import { careQueueInboxSchema, careQueueMarkResultSchema, careQueueMemberTaskSchema, careQueueRaiseSchema, isOverdue, logisticsActions, logisticsReasons, queueForRole, reasonCode, reasonLabel, taskFromZone, taskReasons, type TaskInput } from "@/lib/care-queue/contracts";
import { raiseCareQueueTasks } from "@/lib/care-queue/server";

/** SYNTHETIC checks for turning a zone decision into care queue tasks. SQL is check-care-queue.sql. */
const clear = { chestPain: false, dyspnea: false, neuro: false, syncope: false };
const at = "2026-11-02T10:00:00+04:00";
const input: TaskInput = { memberId: "c0000000-0000-4000-8000-000000000001", sourceRef: "turn-1", at, redFlagsStatus: "cleared", suggestedAction: "call_member", summary: { sbp: 166, dbp: 98 } };
const hoursAfter = (hours: number) => new Date(new Date(at).getTime() + hours * 3600_000).toISOString();

// Scenario B: 166/98 settled by a repeat is one nurse task with a 48 hour deadline.
const scenarioB = evaluateBp({ readings: [{ sbp: 166, dbp: 98 }, { sbp: 164, dbp: 96 }], symptoms: clear });
const yellow = taskFromZone(scenarioB, input);
assert.equal(yellow.length, 1);
assert.equal(yellow[0].queue, "nurse");
assert.equal(yellow[0].zone, "yellow");
assert.equal(yellow[0].reason, "bp_yellow");
assert.equal(yellow[0].slaDeadline, hoursAfter(48));
assert.equal(yellow[0].redFlagsStatus, "cleared");
assert.equal(yellow[0].suggestedAction, "call_member");
assert.deepEqual(yellow[0].summary, { sbp: 166, dbp: 98, reasons: ["bp_yellow"] });
assert.ok(careQueueRaiseSchema.safeParse(yellow[0]).success);

// 180 or 120 is orange: nurse and physician, 4 hours, from the same source.
for (const reading of [{ sbp: 182, dbp: 100 }, { sbp: 150, dbp: 120 }]) {
  const orange = taskFromZone(evaluateBp({ readings: [reading], symptoms: clear }), input);
  assert.deepEqual(orange.map((t) => t.queue), ["nurse", "physician"]);
  assert.ok(orange.every((t) => t.zone === "orange" && t.slaDeadline === hoursAfter(4) && t.sourceRef === "turn-1"));
}

// Red reaches the nurse and the physician, both within half an hour.
const red = taskFromZone(evaluateBp({ readings: [], symptoms: { ...clear, syncope: true } }), input);
assert.deepEqual(red.map((t) => t.queue), ["nurse", "physician"]);
assert.ok(red.every((t) => t.zone === "red" && t.slaDeadline === hoursAfter(0.5)));

// A result's own deadline wins over the zone default: a symptomatic HbA1c is orange with 48 hours.
assert.equal(taskFromZone({ ...scenarioB, zone: "orange", slaHours: 48 }, input)[0].slaDeadline, hoursAfter(48));

// A symptom reason is camelCase in the rules. The database would refuse it, so a red symptom must not arrive that way.
const symptom = taskFromZone(evaluateBp({ readings: [], symptoms: { ...clear, chestPain: true } }), input);
assert.deepEqual(symptom.map((t) => t.reason), ["bp_symptom_chest_pain", "bp_symptom_chest_pain"]);
assert.ok(symptom.every((t) => careQueueRaiseSchema.safeParse(t).success));
assert.equal(reasonCode("bp_symptom_chestPain"), "bp_symptom_chest_pain");
assert.equal(reasonLabel("bp_symptom_chest_pain", "en"), "Chest pain");

// Several reasons all reach the staff member, not only the first.
const lipids = evaluateLipids({ ldlMmol: 5, tcMmol: null, hdlMmol: null, tgMmol: 11, baselineLdlMmol: null, targetMmol: null, reductionPct: null });
const mixed = taskFromZone(lipids, input);
assert.equal(mixed[0].zone, "red");
assert.equal(taskReasons(mixed[0] as never, "en"), "LDL suggests familial hypercholesterolaemia, High triglycerides");

// Green and no zone raise nothing.
assert.deepEqual(taskFromZone(evaluateBp({ readings: [{ sbp: 120, dbp: 75 }], symptoms: clear }), input), []);
const none = evaluateBp({ readings: [], symptoms: { chestPain: null, dyspnea: null, neuro: null, syncope: null } });
assert.equal(none.zone, null);
assert.deepEqual(taskFromZone(none, input), []);

// Logistics reach the admin alone, with no zone, deadline, red flag status or snapshot, even from a clinical result.
const logistics = taskFromZone(evaluateBp({ readings: [{ sbp: 166, dbp: 98 }], symptoms: clear }), { ...input, logistics: { reason: "followup_labs_due", suggestedAction: "book" } });
assert.equal(logistics.length, 1);
assert.deepEqual(logistics[0], { memberId: input.memberId, ruleVersion: yellow[0].ruleVersion, sourceRef: "turn-1", queue: "admin", zone: null, reason: "followup_labs_due", redFlagsStatus: null, suggestedAction: "book", summary: {}, slaDeadline: null });
assert.ok(careQueueRaiseSchema.safeParse(logistics[0]).success);
assert.ok(!careQueueRaiseSchema.safeParse({ ...logistics[0], summary: { sbp: 166 } }).success, "An admin raise never carries a snapshot");
assert.ok(!careQueueRaiseSchema.safeParse({ ...logistics[0], zone: "red" }).success, "An admin raise never carries a zone");
// Only the fixed logistics words reach an admin: a clinical code is refused as reason or action.
assert.ok(!careQueueRaiseSchema.safeParse({ ...logistics[0], reason: "bp_symptom_chest_pain" }).success, "A clinical reason never reaches the admin");
assert.ok(!careQueueRaiseSchema.safeParse({ ...logistics[0], suggestedAction: "review_hba1c_high" }).success, "A clinical action never reaches the admin");
assert.ok(careQueueRaiseSchema.safeParse({ ...logistics[0], suggestedAction: null }).success);
for (const reason of logisticsReasons) assert.ok(careQueueRaiseSchema.safeParse({ ...logistics[0], reason }).success, reason);
for (const suggestedAction of logisticsActions) assert.ok(careQueueRaiseSchema.safeParse({ ...logistics[0], suggestedAction }).success, suggestedAction);
// The database holds the same list.
const migration = readFileSync("supabase/migrations/20261103100300_zoe_care_queue.sql", "utf8");
// The original six words live in the care queue migration; medicine_access_help was added by the dose-reasons one.
const reasonsAtStart = logisticsReasons.filter((r) => r !== "medicine_access_help");
assert.ok(migration.includes(`reason_code in(${reasonsAtStart.map((r) => `'${r}'`).join(",")})`));
assert.ok(readFileSync("supabase/migrations/20261104160002_zoe_v3_dose_reasons.sql", "utf8").includes(`reason_code in(${logisticsReasons.map((r) => `'${r}'`).join(",")})`));
assert.ok(migration.includes(`suggested_action in(${logisticsActions.map((a) => `'${a}'`).join(",")})`));
// A clinical result can never reach the admin queue without logistics saying so.
const forced: ZoneResult = { ...evaluateBp({ readings: [{ sbp: 166, dbp: 98 }], symptoms: clear }), queues: ["admin"] };
assert.deepEqual(taskFromZone(forced, input), []);

// Roles and overdue.
assert.deepEqual(["nurse", "doctor", "admin", "clinic"].map(queueForRole), ["nurse", "physician", "admin", null]);
assert.equal(isOverdue({ slaDeadline: "2026-11-02T10:00:00Z" }, "2026-11-02T10:00:01Z"), true);
assert.equal(isOverdue({ slaDeadline: "2026-11-02T10:00:00Z" }, "2026-11-02T09:59:59Z"), false);
assert.equal(isOverdue({ slaDeadline: null }, "2026-11-02T10:00:01Z"), false);

// The chip contract refuses anything beyond what it needs, and an admin task.
const chip = { id: "c0000000-0000-4000-8000-0000000000a1", queue: "nurse", status: "sent", slaDeadline: at, createdAt: at };
assert.ok(careQueueMemberTaskSchema.safeParse(chip).success);
assert.ok(!careQueueMemberTaskSchema.safeParse({ ...chip, reason: "bp_orange" }).success);
assert.ok(!careQueueMemberTaskSchema.safeParse({ ...chip, queue: "admin" }).success);
assert.ok(careQueueInboxSchema.safeParse({ ok: true, asOf: at, role: "nurse", tasks: [] }).success);

// A mark answers with position only, never a snapshot.
const marked = { ok: true, code: "moved", id: chip.id, status: "seen", stateSeq: 1 };
assert.ok(careQueueMarkResultSchema.safeParse(marked).success);
assert.ok(careQueueMarkResultSchema.safeParse({ ok: false, code: "not_found" }).success);
assert.ok(careQueueMarkResultSchema.safeParse({ ...marked, ok: false, code: "backward" }).success);
assert.ok(!careQueueMarkResultSchema.safeParse({ ...marked, summary: { sbp: 166 } }).success);
assert.ok(!careQueueMarkResultSchema.safeParse({ ...marked, ok: false, code: "changed", task: { summary: {} } }).success);

// Raising: off does nothing at all; on sends each task; a bad answer costs only that task.
const off = { NOREON_ZOE_APP_V3: "false" }, on = { NOREON_ZOE_APP_V3: "true" };
const calls: Record<string, unknown>[] = [];
const stored = (id: string) => ({ id, memberId: input.memberId, memberName: "", queue: "nurse", zone: "red", reason: "bp_red", ruleVersion: "v", redFlagsStatus: null, suggestedAction: null, summary: {}, slaDeadline: at, status: "sent", stateSeq: 0, sandbox: false, createdAt: at, seenAt: null, answeredAt: null });
const task = "c0000000-0000-4000-8000-0000000000a2";
assert.deepEqual(await raiseCareQueueTasks(async (_, args) => { calls.push(args); return null; }, red, off), { raised: 0, replayed: 0, failed: 0, taskIds: [], tasks: [] });
assert.deepEqual(await raiseCareQueueTasks(async (_, args) => { calls.push(args); return null; }, red, {}), { raised: 0, replayed: 0, failed: 0, taskIds: [], tasks: [] });
assert.equal(calls.length, 0, "Nothing reaches the database while the switch is off");
let turn = 0;
const report = await raiseCareQueueTasks(async (name, args) => {
  assert.equal(name, "care_queue_raise");
  calls.push(args);
  turn += 1;
  if (turn === 1) return { ok: true, replayed: false, task: stored(task) };
  if (turn === 2) return { ok: true, replayed: true, task: stored(task) };
  if (turn === 3) return { ok: false, code: "invalid" };
  throw new Error("database unavailable");
}, [...red, ...red], on);
assert.deepEqual(report, { raised: 1, replayed: 1, failed: 2, taskIds: [task, task], tasks: [stored(task), stored(task)] });
assert.equal(calls[0].p_sla, hoursAfter(0.5));
assert.deepEqual(Object.keys(calls[0]).sort(), ["p_action", "p_member", "p_queue", "p_reason", "p_red_flags", "p_rule_version", "p_sla", "p_source_ref", "p_summary", "p_zone"]);

console.log("Care queue checks passed.");

// Both Care queue and Tasks use this display formatter for reported BP.
for(const locale of ['en','hy','ru'] as const){
 const unit={en:'mmHg',hy:'մմ ս.ս.',ru:'мм рт. ст.'}[locale];
 const line=taskReasons({reason:'bp_member_reported_high',summary:{entrySource:'patient_text_entry',systolic:150,diastolic:95}},locale);
 assert.ok(line.startsWith(`150/95 ${unit} · `),`Reported BP unit in ${locale}: ${line}`);
}
