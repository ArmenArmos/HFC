import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { suggestionsFor, type SuggestionState } from "@/lib/chat/suggestions";
import * as conversationMemory from "@/lib/zoe/task-warning";
import * as bpModel from "@/lib/bp-week/model";
import type { ZoeThread } from "@/lib/zoe/app-chat-contracts";

// Execute the actual adapter with synthetic authenticated read boundaries. No network or database.
let consent: unknown = { readsMessages: true };
let safety: unknown = { state: "off" };
let intake: unknown = { enabled: true, active: false };
let urgent = false, consentAccepted = true, careFails = false, medicineFails = false;
let optionalReads = 0;
let reminderDue = true;
let bpWeek: bpModel.BpWeekRead = { version: "bp-week-v1", enabled: false };
const now = new Date("2026-11-01T10:00:00Z"); // 14:00 in Yerevan
class FixedDate extends Date {
  constructor(value: string | number = now.getTime()) { super(value); }
}
const care = { plan: { acknowledgedAt: null, publishedReview: { explanation: "Reviewed note" } } };
const optional = async <T>(value: T) => { optionalReads++; return value; };
const ports: Record<string, unknown> = {
  "server-only": {},
  "@/lib/patient/repository": {
    getPatientState: async () => ({ profile: { locale: "ru" }, assessment: { completedAt: "2026-11-01" }, consentAccepted }),
    getMeasurements: () => optional([]),
  },
  "@/lib/patient/presentation": { patientPresentation: () => ({ urgent }) },
  "@/lib/zoe/member": { readZoeConsents: async () => consent },
  "@/lib/zoe/app-chat": { readIntakeState: async () => intake },
  "@/lib/zoe/task-warning": conversationMemory,
  "@/lib/member-safety/member": { readMemberSafety: async () => safety },
  "@/lib/patient-care/repository": { getCareData: async () => { if (careFails) throw Error("Synthetic unavailable"); return optional(care); } },
  "@/lib/patient-care/model": { dosesForDay: () => [{ status: "due" }] },
  "@/lib/patient-care/reminder-repository": { getReminderPreferences: () => optional({ preferences: {} }) },
  "@/lib/patient-care/reminders": { dailyReminders: () => reminderDue ? [{ kind: "blood-pressure", status: "due" }] : [] },
  "@/lib/member-medicines/server": { loadMemberMedicines: async () => { if (medicineFails) throw Error("Synthetic unavailable"); return optional({ enabled: false }); } },
  "@/lib/member-medicines/model": { todaysDoses: () => [] },
  "@/lib/bp-week/server": { readMemberBpWeek: () => optional(bpWeek) },
  "@/lib/bp-week/model": bpModel,
  "@/lib/real-booking/repository": { getMemberBookingData: (options: unknown) => {
    assert.equal((options as { summaryOnly?: boolean }).summaryOnly, true);
    return optional({ available: true, requests: [], requirements: [{ id: "test" }], pilot: { appointments: [] } });
  } },
  "@/lib/real-booking/visit-gate": { canBookNewVisit: () => true, completedRequestTestIds: () => [] },
};
const compiled = ts.transpileModule(readFileSync("lib/chat/suggestion-read.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText;
const exports: { readMemberSuggestionState?: (thread: ZoeThread) => Promise<SuggestionState | null> } = {};
vm.runInNewContext(compiled, { exports, require: (name: string) => {
  assert.ok(name in ports, `Unexpected adapter dependency: ${name}`);
  return ports[name];
}, Date: FixedDate, Math, Set });
const read = exports.readMemberSuggestionState!;
const thread = { suggestionSafety:true, messages: [], answers: [], replies: [{ at: "2026-11-01T10:00:00Z" }] } as unknown as ZoeThread;
let state = await read(thread);
assert.ok(state);
assert.equal(state.locale, "ru");
for (const fact of ["medicineDue", "bpDue", "visitToBook", "planToRead", "resultsToRead", "doctorReply"] as const) assert.equal(state[fact], true, fact);
assert.equal(state.visitProposal, false);
reminderDue = false;
const week: bpModel.BpWeek = {
  id: "00000000-0000-4000-8000-000000000001", startsOn: "2026-11-01", days: 7, readingsPerSlot: 2,
  morningTime: "08:00", eveningTime: "20:00", reminders: true, startedByRole: "member",
  createdAt: now.toISOString(), stoppedAt: null, stopReason: null, device: null, readings: [],
};
const reading: bpModel.BpReading = {
  id: "00000000-0000-4000-8000-000000000002", day: 1, slot: "morning",
  systolic: 120, diastolic: 80, pulse: null, measuredAt: now.toISOString(),
};
for (const [label, changes, expected] of [
  ["due morning", {}, true],
  ["partial morning", { readings: [reading] }, true],
  ["before first slot", { morningTime: "15:00" }, false],
  ["morning done, evening upcoming", { readings: [reading, { ...reading, id: "second" }] }, false],
  ["today complete", { readings: [reading, { ...reading, id: "second" }, { ...reading, slot: "evening" }, { ...reading, id: "fourth", slot: "evening" }] }, false],
  ["stopped", { stoppedAt: now.toISOString() }, false],
  ["finished", { startsOn: "2026-10-01" }, false],
  ["not started", { startsOn: "2026-11-02" }, false],
  ["yesterday missed, today upcoming", { startsOn: "2026-10-31", morningTime: "15:00" }, false],
] satisfies [string, Partial<bpModel.BpWeek>, boolean][]) {
  bpWeek = { version: "bp-week-v1", enabled: true, memberCanStart: false, today: "2026-11-01", currentDevice: null, weeks: [{ ...week, ...changes }] };
  state = await read(thread);
  assert.equal(state?.bpDue, expected, label);
  assert.equal(suggestionsFor({ ...state!, medicineDue: false }).some(s => s.id === "bp"), expected, `${label}: BP chip`);
}
reminderDue = true;
assert.equal((await read(thread))?.bpDue, true, "An independently due reminder still offers BP with no due week slot");
bpWeek = { version: "bp-week-v1", enabled: false };
for (const gate of [false,undefined]) {
 optionalReads=0;
 assert.equal(await read({...thread,suggestionSafety:gate}),null,'Unknown or blocked authoritative safety means no suggestions');
 assert.equal(optionalReads,0);
}
state=await read({...thread,answers:[{text:'Call 103 for emergency help',at:new Date().toISOString()}]} as unknown as ZoeThread);
assert.equal(state?.safetyHold,true,'An unresolved pipeline safety warning suppresses suggestions');
state=await read({...thread,answers:[{text:'Is there anything else I can help with?',at:new Date().toISOString()}]} as unknown as ZoeThread);
assert.equal(state?.planToRead,true,'A routine follow-up question does not suppress task requests');
for (const text of ["Your appointment is today at 3 pm", "Your doctor appointment is today at 3 pm", "Ձեր այցն այսօր ժամը 15։00-ին է", "Ваш приём сегодня в 15:00"]) {
  for (const at of ["2026-10-30T10:00:00Z", "2026-11-01T09:58:00Z"]) {
    for (const replies of [[], thread.replies]) {
      state = await read({ ...thread, replies, answers: [{ id: "routine", text, at }] });
      assert.equal(state?.safetyHold, false, `Routine historical timing: ${text}`);
      assert.equal(state?.planToRead, true);
      assert.ok(suggestionsFor(state).length > 0);
    }
  }
}
for (const text of ["Call 103 for emergency help", "You need to see a doctor today", "Պետք է դիմեք բժշկի այսօր", "Обратитесь к врачу сегодня"]) {
  state = await read({ ...thread, replies: [], answers: [{ id: "warning", text, at: "2026-10-30T10:00:00Z" }] });
  assert.equal(state?.safetyHold, true, `Unresolved warning must not age out: ${text}`);
  assert.deepEqual(suggestionsFor(state), []);
}
for (const failure of ["consent", "safety", "intake", "emergency", "hold", "basicConsent"] as const) {
  consent = failure === "consent" ? null : { readsMessages: true };
  safety = failure === "safety" ? { state: "unknown" } : failure === "hold" ? { state: "on", card: { hiddenToday: true }, exercisePaused: false } : { state: "off" };
  intake = failure === "intake" ? null : { enabled: true, active: false };
  urgent = failure === "emergency";
  consentAccepted = failure !== "basicConsent";
  optionalReads = 0;
  state = await read(thread);
  assert.equal(suggestionsFor(state).length, 0, failure);
  assert.equal(optionalReads, 0, `${failure}: read no optional records`);
}
consentAccepted = true;
careFails = true;
state = await read(thread);
assert.equal(state?.medicineDue, false);
assert.equal(state?.planToRead, false);
assert.equal(state?.resultsToRead, false);
careFails = false;
medicineFails = true;
state = await read(thread);
assert.equal(state?.medicineDue, false, "A partial medicine list cannot imply a dose is due");
console.log("Suggestion adapter: authenticated read boundaries, read-only booking projection, safety gates and optional-read failures passed (mocked IO).");
