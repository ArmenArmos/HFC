import { testById } from "@/lib/clinical/seed/tests";
import type { PatientLocale } from "./copy";

/** Translate only the catalogue's own wording; retain provider-authored titles. */
export function testTitle(test: { id: string; title: string }, locale: PatientLocale) {
  const catalogue = testById(test.id);
  return catalogue && (test.title === catalogue.name.en || test.title === catalogue.name.hy || test.title === catalogue.name.ru)
    ? catalogue.name[locale] ?? test.title
    : test.title;
}
