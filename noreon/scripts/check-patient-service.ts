import assert from "node:assert/strict";
import fs from "node:fs";
import type { Answers } from "@/lib/clinical/types";
import { createPatientService } from "@/lib/patient/service";
const profile = {
  name: "Aram",
  birthDate: "1974-05-18",
  biologicalSex: "male" as const,
  locale: "en" as const,
};
const denied = createPatientService({
  user: async () => null,
  store: () => {
    throw new Error("must not access store");
  },
});
assert.equal((await denied.saveProfile(profile, true)).ok, false);
assert.equal(
  (
    await denied.saveAnswers({
      expectedRevision: 0,
      entries: [{ fieldId: "q3.status", value: "never" }],
    })
  ).ok,
  false,
);
let savedOwner = "",
  savedSeed: unknown;
const state = {
  profile: { ...profile, userId: "real-owner" },
  consentAccepted: true,
  assessment: {
    id: "draft",
    revision: 0,
    assessmentDate: "2026-10-07",
    answers: {
      "q3.status": {
        fieldId: "q3.status",
        value: "never",
        source: "manual" as const,
        answeredAt: "2026-10-07T05:00:00Z",
      },
    },
    completedAt: null,
    urgentRule: null,
  },
};
const service = createPatientService({
  user: async () => ({ userId: "real-owner", phone: "+37491123456" }),
  store: () => ({
    read: async () => state,
    profile: async (owner: string, _input: unknown, seed: unknown) => {
      savedOwner = owner;
      savedSeed = seed;
      return 1;
    },
    assessment: async () => 1,
    measurement: async () => {},
  }),
});
assert.equal(
  (
    await service.saveProfile(
      { ...profile, userId: "forged-owner" } as typeof profile,
      true,
    )
  ).ok,
  true,
);
assert.equal(savedOwner, "real-owner");
assert.deepEqual(Object.keys(savedSeed as object).sort(), ["q1.age", "q1.sex"]);
assert.equal((await service.saveProfile(profile, false)).ok, false);
assert.deepEqual(await service.completeAssessment(0), { ok: false, reason: "incomplete", missing: "answers" }, "Missing answers are named, not a bare failure (the details are repaired from the profile)");
assert.equal(
  (
    await service.saveAnswers({
      expectedRevision: 99,
      entries: [{ fieldId: "q3.status", value: "never" }],
    })
  ).ok,
  false,
);
assert.equal(
  (
    await service.saveAnswers({
      expectedRevision: 0,
      entries: [{ fieldId: "q1.age", value: 52 }],
    })
  ).ok,
  false,
);
console.log(
  "Patient service: verified owner, consent, input and completion guards pass.",
);
let computedComplete = false;
const completeState = {
  ...state,
  assessment: {
    ...state.assessment,
    answers: JSON.parse(
      fs.readFileSync(
        new URL("./fixtures/patient-answers.json", import.meta.url),
        "utf8",
      ),
    ) as Answers,
    completedAt: "2026-10-07T00:00:00Z",
  },
};
const edit = createPatientService({
  user: async () => ({ userId: "real-owner", phone: "+37491123456" }),
  store: () => ({
    read: async () => completeState,
    profile: async () => 1,
    assessment: async (_owner, _revision, _answers, complete) => {
      computedComplete = complete;
      return 1;
    },
    measurement: async () => {},
  }),
});
assert.equal(
  (
    await edit.saveAnswers({
      expectedRevision: 0,
      entries: [{ fieldId: "q5.last_reading.systolic", value: 132 }],
    })
  ).ok,
  true,
);
assert.equal(
  computedComplete,
  true,
  "Editing a complete questionnaire without new missing fields remains complete",
);

let staleWrites = 0;
const revisionService = createPatientService({
  user: async () => ({ userId: "real-owner", phone: "+37491123456" }),
  store: () => ({
    read: async () => state,
    profile: async () => {
      staleWrites++;
      return 1;
    },
    assessment: async () => 1,
    measurement: async () => {},
  }),
});
assert.deepEqual(await revisionService.saveProfile(profile, true, 99), {
  ok: false,
  reason: "conflict",
});
assert.deepEqual(await revisionService.saveProfile(profile, true, -2), {
  ok: false,
  reason: "invalid",
});
assert.deepEqual(await revisionService.saveProfile(profile, true, NaN), {
  ok: false,
  reason: "invalid",
});
assert.deepEqual(await revisionService.saveProfile(profile, true, -1), {
  ok: false,
  reason: "conflict",
});
assert.equal(staleWrites, 0);
assert.equal((await revisionService.saveProfile(profile, true, 0)).ok, true);
assert.equal(staleWrites, 1);
console.log(
  "Explicit profile revisions reject stale/invalid saves before writing.",
);

assert.deepEqual(await service.saveAnswers({
  expectedAssessmentId: "another-assessment-with-the-same-revision",
  expectedRevision: 0,
  entries: [{ fieldId: "q6.conditions", value: "unknown" }],
}), { ok: false, reason: "conflict" }, "A queued batch from a previous assessment cannot write a new session at the same revision");

assert.deepEqual(await service.completeAssessment(0, "another-assessment-with-the-same-revision"), { ok: false, reason: "conflict" }, "A stale mounted screen cannot complete another assessment at the same revision");

// A save whose response is lost (it committed as the next revision) is retried with the old
// revision. The retry recovers instead of a conflict the queue refuses to retry (review item 7),
// but only when the stored answers are exactly the set this client expects after its batch:
// another session's edit (Astra R303-1: a red answer from a second device) stays a conflict.
{
  const { QuestionnaireSession } = await import("@/lib/patient/questionnaire-session");
  type Loose = Omit<typeof state, "assessment"> & { assessment: Omit<typeof state.assessment, "answers"> & { answers: Answers } };
  const db = structuredClone(state) as Loose;
  let writes = 0;
  const shared = createPatientService({
    user: async () => ({ userId: "real-owner", phone: "+37491123456" }),
    store: () => ({
      read: async () => structuredClone(db),
      profile: async () => 1,
      assessment: async (_owner, revision, answers) => {
        if (revision !== db.assessment.revision) return -1;
        writes++;
        db.assessment = { ...db.assessment, revision: revision + 1, answers };
        return db.assessment.revision;
      },
      measurement: async () => {},
    }),
  });
  const open = (drop: { next: boolean }) => new QuestionnaireSession(
    { id: db.assessment.id, revision: db.assessment.revision, answers: structuredClone(db.assessment.answers), assessmentDate: db.assessment.assessmentDate, completedAt: null, urgentRule: null },
    async (expectedRevision, entries, expectedAnswers) => {
      const result = await shared.saveAnswers({ expectedRevision, entries, expectedAnswers });
      if (drop.next) { drop.next = false; return null; }
      return result;
    }, [0]);

  // 1. Lost response, same client: recovers without a second write, later answers keep saving.
  const lostA = { next: true };
  const a = open(lostA);
  a.accept([{ fieldId: "q3.status", value: "former" }]);
  assert.equal(await a.queue.flush(), true, "The retried batch recovers the committed save");
  assert.equal(writes, 1, "The retry does not write again");
  assert.equal(a.queue.revision, 1);
  a.accept([{ fieldId: "q3.status", value: "current" }]);
  assert.equal(await a.queue.flush(), true, "Later answers keep saving");
  assert.equal(db.assessment.revision, 2);
  assert.equal(db.assessment.answers["q3.status"]?.value, "current");

  // 2. Astra R303-1: tab A is stale at revision 2; device B saves a red answer (revision 3); A then
  // submits an answer B's write already holds, at its stale revision. That is not A's own write:
  // conflict, so A can never advance and later overwrite B's red answer.
  const stale = open({ next: false });
  const b = open({ next: false });
  b.accept([{ fieldId: "q9.present", value: "yes" }, { fieldId: "q9.right_now", value: "yes" }]);
  assert.equal(await b.queue.flush(), true);
  assert.equal(db.assessment.answers["q9.right_now"]?.value, "yes", "Device B stored the red answer");
  stale.accept([{ fieldId: "q3.status", value: "current" }]);
  assert.equal(await stale.queue.flush(), false, "A stale tab cannot pass another device's edit off as its own lost save");
  assert.equal(stale.queue.failure && "reason" in stale.queue.failure ? stale.queue.failure.reason : null, "conflict");
  assert.equal(db.assessment.answers["q9.right_now"]?.value, "yes", "The red answer stays");
  assert.equal(db.assessment.revision, 3);

  // 3. Raw calls: different values, an older revision, or no fingerprint (the native app) conflict.
  assert.deepEqual(await shared.saveAnswers({ expectedRevision: 2, entries: [{ fieldId: "q3.status", value: "never" }] }), { ok: false, reason: "conflict" });
  assert.deepEqual(await shared.saveAnswers({ expectedRevision: 1, entries: [{ fieldId: "q3.status", value: "current" }] }), { ok: false, reason: "conflict" });
  assert.deepEqual(await shared.saveAnswers({ expectedRevision: 2, entries: [{ fieldId: "q9.right_now", value: "yes" }] }), { ok: false, reason: "conflict" }, "Without the fingerprint nothing is replayed");
  assert.equal(writes, 3);
}
console.log("A retry of a save whose response was lost recovers; competing edits still conflict.");

// Profile save (review item 31): the age range applies on the assessment date, which is the age stored.
{
  const { CORE_QUESTIONS } = await import("@/lib/clinical/seed/questions");
  const { pruneAnswers } = await import("@/lib/patient/questionnaire");
  let profileWrites = 0;
  const smoker = structuredClone(state) as Omit<typeof state, "assessment"> & { assessment: Omit<typeof state.assessment, "answers"> & { answers: Answers } };
  smoker.assessment.assessmentDate = "2026-10-07";
  smoker.assessment.answers = {
    ...smoker.assessment.answers,
    "q3.status": { fieldId: "q3.status", value: "current", source: "manual", answeredAt: "2026-10-07T05:00:00Z" },
    "q3.years": { fieldId: "q3.years", value: 40, source: "manual", answeredAt: "2026-10-07T05:00:00Z" },
  } as Answers;
  const profileService = createPatientService({
    user: async () => ({ userId: "real-owner", phone: "+37491123456" }),
    store: () => ({
      read: async () => smoker,
      profile: async () => { profileWrites++; return 1; },
      assessment: async () => 1,
      measurement: async () => {},
    }),
  });
  // A correction that contradicts the retained smoking years still saves; the questionnaire reopens
  // that answer (check-questionnaire-input-consistency.ts).
  assert.equal((await profileService.saveProfile({ ...profile, birthDate: "1996-01-01" }, true, 0)).ok, true);
  assert.equal(profileWrites, 1);
  // 18 today but 17 on the assessment date: the stored q1.age would be 17.
  assert.deepEqual(await service.saveProfile({ ...profile, birthDate: "2008-10-15" }, true, 0),
    { ok: false, reason: "invalid" }, "The 18-110 range applies on the assessment date (17 on 7 Oct, 18 by 19 Oct)");
  // Tripwire: saveProfile evaluates urgency on pruned answers but stores the merge. They agree only
  // while no question is shown or hidden by age or sex. Gate one on q1.* and this fails: then make
  // save_patient_profile store the pruned set.
  for (const q of CORE_QUESTIONS) for (const f of q.fields)
    if (q.id !== "q1") assert.doesNotMatch(String((f as { showIf?: unknown }).showIf ?? ""), /q1\./, `${f.id} is gated on the profile; see service.ts saveProfile`);
  const base = pruneAnswers(smoker.assessment.answers);
  for (const age of [18, 45, 110]) for (const sex of ["male", "female"]) {
    const seeded = pruneAnswers({ ...smoker.assessment.answers,
      "q1.age": { fieldId: "q1.age", value: age, source: "manual", answeredAt: "2026-10-07T05:00:00Z" },
      "q1.sex": { fieldId: "q1.sex", value: sex, source: "manual", answeredAt: "2026-10-07T05:00:00Z" } } as Answers);
    assert.deepEqual(Object.keys(seeded).filter(k => !k.startsWith("q1.")).sort(), Object.keys(base).filter(k => !k.startsWith("q1.")).sort(), `age ${age}, ${sex}: pruning does not depend on the profile`);
  }
}
console.log("Profile save checks the age on the assessment date; pruning cannot depend on the profile.");
