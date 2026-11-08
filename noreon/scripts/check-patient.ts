import assert from "node:assert/strict";
import {
  parseBirthDate,
  ageOn,
  normalizePhone,
  validMeasurement,
  validProfile,
  nameProblem,
  normalizeName,
  maskBirthInput,
  birthDateProblem,
} from "@/lib/patient/validation";
import { assessmentProgress, mergeAnswers } from "@/lib/patient/questionnaire";
import type { Answers } from "@/lib/clinical/types";

assert.equal(parseBirthDate("18051974"), "1974-05-18");
assert.equal(parseBirthDate("18/05/1974"), "1974-05-18");
assert.equal(parseBirthDate("1974-05-18"), "1974-05-18");
assert.equal(parseBirthDate("31/02/1974"), null);
assert.equal(parseBirthDate("29/02/1900"), null);
assert.equal(parseBirthDate("29/02/2000"), "2000-02-29");
assert.equal(ageOn("2008-10-08", "2026-10-07"), 17);
assert.equal(ageOn("2008-10-07", "2026-10-07"), 18);
assert.equal(ageOn("1915-10-08", "2026-10-07"), 110);
assert.equal(ageOn("1915-10-07", "2026-10-07"), 111);
assert.equal(normalizePhone("+374 91 123456"), "+37491123456");
assert.equal(normalizePhone("091123456"), "+37491123456");
assert.equal(normalizePhone("+37400000000"), null);
assert.equal(normalizePhone("invalid"), null);
const profile = {
  name: "Aram",
  birthDate: "1974-05-18",
  biologicalSex: "male",
  locale: "hy",
};
assert.equal(validProfile(profile, "2026-10-07"), true);
assert.equal(
  validProfile({ ...profile, birthDate: "2008-10-08" }, "2026-10-07"),
  false,
);
assert.equal(validProfile({ ...profile, name: " " }, "2026-10-07"), false);
// Gohar D-001: letters (Armenian, Latin, Cyrillic), spaces, hyphens and apostrophes; 2–60 characters.
for (const ok of ["Արամ", "Աննա-Մարիա", "Վարդանյան Արամ", "Ծովինար Եղիազարյան", "Ստեփանյանը և", "O'Brien", "D’Angelo", "Jean-Luc Picard", "Zoë", "José Ñúñez", "Иван Петров", "Ал", "Lu"])
  assert.equal(nameProblem(ok), null, ok);
assert.equal(nameProblem(""), "empty");
assert.equal(nameProblem("   "), "empty");
assert.equal(nameProblem("A"), "short");
assert.equal(nameProblem("12345"), "characters");
assert.equal(nameProblem("Aram2"), "characters");
assert.equal(nameProblem("Aram!"), "characters");
assert.equal(nameProblem("Aram--Bek"), "characters");
assert.equal(nameProblem("-Aram"), "characters");
assert.equal(nameProblem("Aram <b>"), "characters");
assert.equal(nameProblem("😀😀"), "characters");
assert.equal(nameProblem("Αλέξης"), "characters"); // Greek is not one of the three alphabets
assert.equal(nameProblem("a".repeat(60)), null);
assert.equal(nameProblem("B\u0301"), "short"); // one letter plus an accent (review R2)
assert.equal(nameProblem("A\u034f"), "characters"); // invisible joiner
assert.equal(nameProblem("E\u0301va"), null); // decomposed accent in a real name
assert.equal(nameProblem("Al\u200bex"), "characters"); // zero-width space
assert.equal(nameProblem("Ani\u00a0Mar"), null); // a no-break space becomes a space
assert.equal(nameProblem("a".repeat(61)), "long");
assert.equal(normalizeName("  Aram   Petrosyan "), "Aram Petrosyan");
assert.equal(nameProblem("  Aram   Petrosyan "), null);
assert.equal(validProfile({ ...profile, name: "12345" }, "2026-10-07"), false);
assert.equal(validProfile({ ...profile, name: "a".repeat(61) }, "2026-10-07"), false);
assert.equal(validProfile({ ...profile, name: " Արամ " }, "2026-10-07"), true);
// Gohar D-009: the slash appears after the day and the month; Backspace can remove it; pastes are tidied.
assert.equal(maskBirthInput("1"), "1");
assert.equal(maskBirthInput("18"), "18/");
assert.equal(maskBirthInput("18", true), "18");
assert.equal(maskBirthInput("18/0"), "18/0");
assert.equal(maskBirthInput("18/05"), "18/05/");
assert.equal(maskBirthInput("18/05", true), "18/05");
assert.equal(maskBirthInput("18/05/1974"), "18/05/1974");
assert.equal(maskBirthInput("18051974"), "18/05/1974");
assert.equal(maskBirthInput("180519745"), "18/05/1974");
assert.equal(maskBirthInput("18.5.1974"), "18/05/1974");
assert.equal(maskBirthInput("18-05-1974"), "18/05/1974");
assert.equal(maskBirthInput("1974-05-18"), "18/05/1974");
assert.equal(maskBirthInput("ab12"), "12/");
assert.equal(birthDateProblem("", "2026-10-07"), "empty");
assert.equal(birthDateProblem("31/02/1974", "2026-10-07"), "invalid");
assert.equal(birthDateProblem("18/05", "2026-10-07"), "invalid");
assert.equal(birthDateProblem("08/10/2008", "2026-10-07"), "young");
assert.equal(birthDateProblem("07/10/2008", "2026-10-07"), null);
assert.equal(birthDateProblem("07/10/1915", "2026-10-07"), "old");
assert.equal(birthDateProblem("18/05/1974", "2026-10-07"), null);
const reading = {
  submissionId: "e42cfbc7-74e2-45de-b43e-5d7c8cbcb74c",
  systolic: 134,
  diastolic: 82,
  pulse: 72,
  measuredAt: "2026-10-07T09:00:00+04:00",
};
assert.equal(
  validMeasurement(reading, new Date("2026-10-07T10:00:00+04:00")),
  true,
);
assert.equal(validMeasurement({ ...reading, diastolic: 150 }), false);
assert.equal(validMeasurement({ ...reading, systolic: NaN }), false);
assert.equal(validMeasurement({ ...reading, measuredAt: "invalid" }), false);
assert.equal(
  validMeasurement(
    { ...reading, measuredAt: "2027-10-07T09:00:00Z" },
    new Date("2026-10-07T10:00:00Z"),
  ),
  false,
);
assert.equal(assessmentProgress({}).complete, false);
let answers: Answers = {};
answers = mergeAnswers(answers, [
  { fieldId: "q3.status", value: "current" },
  { fieldId: "q3.years", value: 15 },
  { fieldId: "q3.per_day", value: 10 },
]);
assert.equal(answers["q3.years"].value, 15);
answers = mergeAnswers(answers, [{ fieldId: "q3.status", value: "never" }]);
assert.equal(answers["q3.years"], undefined);
assert.equal(answers["q3.per_day"], undefined);
assert.throws(() =>
  mergeAnswers(answers, [{ fieldId: "q3.status", value: "invented" }]),
);
assert.throws(() => mergeAnswers(answers, [{ fieldId: "q1.age", value: 52 }]));
assert.throws(() =>
  mergeAnswers(answers, [{ fieldId: "q2.height", value: NaN }]),
);
assert.throws(() =>
  mergeAnswers(answers, [
    { fieldId: "q6.conditions", value: ["none", "diabetes"] },
  ]),
);
assert.equal(assessmentProgress(answers).completedTopics, 1);
const oldBP: Answers = {
  "q5.last_reading.systolic": {
    fieldId: "q5.last_reading.systolic",
    value: 120,
    source: "manual",
    answeredAt: "2026-10-07T05:00:00Z",
  },
  "q5.last_reading.diastolic": {
    fieldId: "q5.last_reading.diastolic",
    value: 80,
    source: "manual",
    answeredAt: "2026-10-07T05:00:00Z",
  },
};
const cleared = mergeAnswers(oldBP, [
  { fieldId: "q5.last_reading.systolic", value: 130 },
  { fieldId: "q5.last_reading.diastolic", value: null },
]);
assert.equal(cleared["q5.last_reading.diastolic"], undefined);
assert.equal(assessmentProgress(cleared).complete, false);
console.log(
  "Patient domain: date, phone, measurement validation and conditional progress checks pass.",
);
