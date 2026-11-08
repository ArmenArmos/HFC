import { localized, UNKNOWN, type Answers, type AssessmentField } from "@/lib/clinical/types";
import { activeFields } from "@/lib/patient/questionnaire";
import { tx, type PatientLocale } from "@/lib/patient/copy";

export type AnswerSummaryRow = { id: string; label: string; value: string };
export type AnswerSummarySection = { id: string; index: number; title: string; rows: AnswerSummaryRow[] };

/** One saved answer as plain text, in the member's language (QA 175). */
export function answerSummaryText(field: AssessmentField, answers: Answers, locale: PatientLocale): string {
  const unknown = tx(locale, "Չգիտեմ", "I don't know", "Не знаю");
  const none = tx(locale, "Պատասխան չկա", "No answer", "Нет ответа");
  const unit = field.unit ? ` ${localized(field.unit, locale)}` : "";
  const one = (value: unknown): string => {
    if (value === UNKNOWN) return unknown;
    if (value === null || value === undefined || value === "") return none;
    if (typeof value === "boolean") return value ? tx(locale, "Այո", "Yes", "Да") : tx(locale, "Ոչ", "No", "Нет");
    const option = field.options?.find((item) => item.value === value);
    if (option) return localized(option.label, locale);
    if (typeof value === "number") return field.kind === "scale" ? `${value} / ${field.max ?? 10}` : `${value}${unit}`;
    return String(value);
  };
  if (field.kind === "blood-pressure") {
    const systolic = answers[`${field.id}.systolic`]?.value, diastolic = answers[`${field.id}.diastolic`]?.value;
    if (typeof systolic === "number" && typeof diastolic === "number") return `${systolic}/${diastolic}${unit}`;
    return one(systolic ?? diastolic);
  }
  const value = answers[field.id]?.value;
  return Array.isArray(value) ? (value.length ? value.map(one).join(", ") : none) : one(value);
}

/** The questionnaire as read-only sections, in the order the form asks them. The profile
 * section (q1, age and sex) is shown on the profile page, so it is left out here like in the form. */
export function answerSummary(answers: Answers, locale: PatientLocale): AnswerSummarySection[] {
  const sections: AnswerSummarySection[] = [];
  for (const field of activeFields(answers)) {
    if (field.topic.id === "q1") continue;
    let section = sections.at(-1);
    if (section?.id !== field.topic.id) {
      section = { id: field.topic.id, index: field.topic.index, title: localized(field.topic.title, locale), rows: [] };
      sections.push(section);
    }
    section.rows.push({ id: field.id, label: localized(field.label, locale), value: answerSummaryText(field, answers, locale) });
  }
  return sections;
}
