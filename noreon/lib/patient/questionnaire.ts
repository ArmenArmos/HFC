import {
  CORE_QUESTIONS,
  visibleFields,
  fieldById,
} from "@/lib/clinical/seed/questions";
import type {
  Answers,
  FieldValue,
  AssessmentField,
} from "@/lib/clinical/types";
import { UNKNOWN, NONE, localized } from "@/lib/clinical/types";
import { tx, type PatientLocale } from "@/lib/patient/copy";

export function activeFields(answers: Answers) {
  return CORE_QUESTIONS.flatMap((q) =>
    visibleFields(q, answers).map((f) => ({ ...f, label: f.labelWhen?.when(answers) ? f.labelWhen.label : f.label, topic: q })),
  );
}
function ids(f: AssessmentField) {
  return f.kind === "blood-pressure"
    ? [`${f.id}.systolic`, `${f.id}.diastolic`]
    : [f.id];
}
function validValue(
  f: AssessmentField,
  id: string,
  value: unknown,
): value is FieldValue {
  if (value === UNKNOWN && (f.skippable || f.kind === "blood-pressure" || f.id === "q6.conditions" || f.id === "q7.relatives"))
    return true;
  if (
    f.kind === "number" ||
    f.kind === "scale" ||
    f.kind === "blood-pressure"
  ) {
    const bounds =
      f.kind === "blood-pressure" ? f.parts?.[id.split(".").at(-1)!] : f;
    if (
      !bounds ||
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < (bounds.min ?? -Infinity) ||
      (value > (bounds.max ?? Infinity) && !f.openMax)
    )
      return false;
    const step = f.step ?? 1;
    return Math.abs(value / step - Math.round(value / step)) < 0.000001;
  }
  const options = new Set(f.options?.map((o) => o.value));
  if (f.kind === "single")
    return typeof value === "string" && options.has(value);
  if (f.kind === "multi")
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      new Set(value).size === value.length &&
      value.every((v) => typeof v === "string" && options.has(v)) &&
      !(value.includes(f.exclusiveValue ?? NONE) && value.length > 1)
    );
  return false;
}
export type InputConsistencyIssue = "blood-pressure-order" | "smoking-years-age";
export class QuestionnaireInputError extends Error {
  readonly issue: InputConsistencyIssue;
  constructor(issue: InputConsistencyIssue) {
    super(issue);
    this.issue = issue;
  }
}
/** Relationships between supplied answers, independent of clinical thresholds. */
export function inputConsistencyIssue(id: string, answers: Answers): InputConsistencyIssue | null {
  if (id === "q5.last_reading" || id.startsWith("q5.last_reading.")) {
    const systolic = answers["q5.last_reading.systolic"]?.value;
    const diastolic = answers["q5.last_reading.diastolic"]?.value;
    if (typeof systolic === "number" && typeof diastolic === "number" && systolic <= diastolic)
      return "blood-pressure-order";
  }
  if (id === "q3.years") {
    const age = answers["q1.age"]?.value;
    const years = answers["q3.years"]?.value;
    if (typeof age === "number" && Number.isFinite(age) && typeof years === "number" && years > age)
      return "smoking-years-age";
  }
  return null;
}
export function pruneAnswers(answers: Answers): Answers {
  let next = { ...answers };
  for (let i = 0; i < CORE_QUESTIONS.length; i++) {
    const allowed = new Set(activeFields(next).flatMap(ids));
    const filtered = Object.fromEntries(
      Object.entries(next).filter(([id]) => allowed.has(id)),
    );
    if (Object.keys(filtered).length === Object.keys(next).length)
      return filtered;
    next = filtered;
  }
  return next;
}
export function mergeAnswers(
  answers: Answers,
  entries: Array<{ fieldId: string; value: FieldValue | null }>,
): Answers {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 10)
    throw new Error("Invalid answers");
  const next = { ...answers };
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry.fieldId !== "string" ||
      entry.fieldId.startsWith("q1.")
    )
      throw new Error("Invalid field");
    const field = fieldById(entry.fieldId);
    if (!field || !ids(field).includes(entry.fieldId))
      throw new Error("Invalid field");
    if (entry.value === null) {
      delete next[entry.fieldId];
      continue;
    }
    if (!validValue(field, entry.fieldId, entry.value))
      throw new Error("Invalid answer");
    // An open top ("500+") stores new answers at the top; older saves above it stay readable.
    const value =
      field.openMax && typeof entry.value === "number" && entry.value > (field.max ?? Infinity)
        ? field.max!
        : entry.value;
    next[entry.fieldId] = {
      fieldId: entry.fieldId,
      value,
      source: "manual",
      answeredAt: new Date().toISOString(),
    };
  }
  const pruned = pruneAnswers(next);
  for (const entry of entries) {
    const issue = inputConsistencyIssue(entry.fieldId, pruned);
    if (issue) throw new QuestionnaireInputError(issue);
  }
  return pruned;
}
const typedKey = (text: string) => text.trim().replace(/[.։]$/, "").trim().toLocaleLowerCase();
const typedNumber = (text: string) => /^\d{1,4}(?:[.,]\d{1,2})?$/.test(text) ? Number(text.replace(",", ".")) : null;
/**
 * A message typed in the chat box that plainly answers the open question: a number with or without
 * its unit, a blood pressure pair, or one choice's exact words. Anything else is null and stays a
 * message. Bounds and consistency are the same mergeAnswers checks the controls go through.
 */
export function typedAnswerEntries(field: AssessmentField, text: string, answers: Answers, locale: PatientLocale) {
  const typed = typedKey(text);
  let entries: Array<{ fieldId: string; value: FieldValue }> | null = null;
  if (field.kind === "number" || field.kind === "scale") {
    const units = field.unit ? [field.unit.hy, field.unit.en, field.unit.ru] : [];
    const bare = units.reduce<string>((rest, unit) => unit && rest.endsWith(unit.toLocaleLowerCase()) ? rest.slice(0, -unit.length).trim() : rest, typed);
    const value = typedNumber(bare);
    if (value !== null) entries = [{ fieldId: field.id, value }];
  } else if (field.kind === "blood-pressure") {
    const pair = /^(\d{2,3})\s*[/\\ ]\s*(\d{2,3})$/.exec(typed.replace(/\s*(?:mmhg|мм рт\.? ?ст)\.?$/, ""));
    if (pair) entries = [{ fieldId: `${field.id}.systolic`, value: Number(pair[1]) }, { fieldId: `${field.id}.diastolic`, value: Number(pair[2]) }];
  } else if (field.kind === "single") {
    const option = field.options?.find(option => typedKey(localized(option.label, locale)) === typed);
    if (option) entries = [{ fieldId: field.id, value: option.value }];
  }
  if (!entries) return null;
  try {
    return fieldComplete(field, mergeAnswers(answers, entries)) ? entries : null;
  } catch {
    return null;
  }
}
/** What the skip control says, and what the chat shows as the member's answer to it. */
export const skipWording = (field: AssessmentField, locale: PatientLocale) => field.id === "q2.waist"
  ? tx(locale, "Բաց թողնել չափումը", "Skip measurement", "Пропустить измерение")
  : field.skipLabel ? localized(field.skipLabel, locale) : tx(locale, "Չգիտեմ", "I don’t know", "Не знаю");

export function fieldComplete(f: AssessmentField, answers: Answers): boolean {
  return !inputConsistencyIssue(f.id, answers) && ids(f).every(
    (id) => answers[id] && validValue(f, id, answers[id].value),
  );
}
/** The details answers (age and sex) come only from the registration profile, never from a question in the questionnaire. */
export function detailsAnswered(answers: Answers): boolean {
  return CORE_QUESTIONS.filter((q) => q.id === "q1").every((q) =>
    visibleFields(q, answers).every((f) => fieldComplete(f, answers)),
  );
}
export function assessmentProgress(answers: Answers) {
  const completedTopics = CORE_QUESTIONS.filter((q) =>
    visibleFields(q, answers).every((f) => fieldComplete(f, answers)),
  ).length;
  return {
    completedTopics,
    totalTopics: 10 as const,
    complete: completedTopics === 10,
  };
}

/**
 * A short digest of an answer set's values (field ids and values, not times or sources). The
 * browser sends the digest it expects after a save; the server compares it with what it stores to
 * tell a retry of its own committed save from another session's edit (review item 7).
 */
export function answersFingerprint(answers: Answers): string {
  const text = JSON.stringify(Object.keys(answers).sort().map((id) => [id, answers[id]?.value ?? null]));
  let a = 0x811c9dc5, b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    b ^= b >>> 15;
  }
  return a.toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
