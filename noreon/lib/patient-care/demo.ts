import { clinicalLocale, pick, type Locale } from "@/lib/locale";
import type { Measurement } from "@/lib/patient/types";
import type { CareData, DemoCareStage, DoseEvent } from "./types";
import { armeniaDate } from "./model";
export function demoCare(
  stage: DemoCareStage,
  now: Date,
  events: DoseEvent[] = [],
  acknowledged = false,
  locale: Locale = "en",
): CareData {
  const t = (en: string, hy: string, ru: string) => pick(locale, { en, hy, ru });
  const clinical = (en: string, hy: string) => ({ en, hy })[clinicalLocale(locale)];
  const day = armeniaDate(now),
    yesterday = new Date(now.getTime() - 86400000).toISOString();
  const hasTests = stage !== "profile",
    hasResults = ["review", "treatment"].includes(stage),
    treatment = stage === "treatment";
  return {
    tests: hasTests
      ? [
          {
            id: "demo-tests",
            title: t("Blood tests", "Արյան հետազոտություններ", "Анализы крови"),
            preparation: clinical(
              "Follow the laboratory’s confirmed preparation instructions.",
              "Հետևեք լաբորատորիայի հաստատած նախապատրաստման ցուցումներին։",
            ),
            status: stage === "tests" ? "ordered" : "collected",
            orderedBy: t("Demo doctor Ani", "Demo doctor Ani", "Демонстрационный врач Ани"),
            orderedAt: yesterday,
            dueAt:
              stage === "tests"
                ? new Date(now.getTime() + 86400000).toISOString()
                : null,
            location: t("Demo laboratory, Yerevan", "Demo laboratory, Yerevan", "Демонстрационная лаборатория, Ереван"),
            source: "demo",
            sourceLabel: t("Fictional care team", "Fictional care team", "Вымышленная медицинская команда"),
          },
        ]
      : [],
    results: hasResults
      ? ["LDL cholesterol", "HbA1c", "Creatinine", "Glucose"].flatMap(
          (marker, index) =>
            [90, 60, 30, 0].map((days, j) => ({
              id: `demo-result-${index}-${j}`,
              testId: days === 0 ? "demo-tests" : null,
              marker,
              value: [
                [3.8, 3.6, 3.3, 3.1],
                [6.4, 6.3, 6.1, 6.0],
                [86, 88, 85, 87],
                [6.2, 6.1, 5.8, 5.7],
              ][index][j],
              unit: ["mmol/L", "%", "µmol/L", "mmol/L"][index],
              referenceLow: null,
              referenceHigh: null,
              collectedAt: new Date(
                now.getTime() - days * 86400000 - 7200000,
              ).toISOString(),
              receivedAt: now.toISOString(),
              source: "demo" as const,
              sourceLabel: t("Fictional laboratory", "Fictional laboratory", "Вымышленная лаборатория"),
              reviewedAt: treatment ? now.toISOString() : null,
              reviewedBy: treatment ? t("Demo doctor Ani", "Demo doctor Ani", "Демонстрационный врач Ани") : null,
              explanation: treatment
                ? clinical(
                    "Fictional review for the presentation. Your clinician’s interpretation will appear here in the real app.",
                    "Ցուցադրական վերանայում։ Իրական հավելվածում այստեղ կհայտնվի բժշկի մեկնաբանությունը։",
                  )
                : null,
            })),
        )
      : [],
    plan: treatment
      ? {
          id: "demo-plan",
          clinician: t("Demo doctor Ani", "Demo doctor Ani", "Демонстрационный врач Ани"),
          publishedAt: yesterday,
          acknowledgedAt: acknowledged ? now.toISOString() : null,
          instructions: clinical(
            "Fictional care plan. Follow the recorded medication schedule and bring your blood pressure history to your follow-up. This scenario is not a treatment recommendation.",
            "Հորինված խնամքի պլան։ Հետևեք գրանցված ժամանակացույցին և հաջորդ այցին ներկայացրեք ճնշման պատմությունը։ Սա բուժման առաջարկ չէ։",
          ),
          medications: [
            {
              id: "demo-medication",
              planId: "demo-plan",
              name: clinical("Example medicine", "Ցուցադրական դեղ"),
              dose: clinical("1 example tablet", "1 ցուցադրական հաբ"),
              instructions: clinical(
                "Fictional prescription for the demonstration only.",
                "Միայն ցուցադրության համար հորինված նշանակում։",
              ),
              times: ["08:00", "20:00"],
              startDate: day,
              endDate: null,
              active: true,
            },
          ],
        }
      : null,
    appointments: treatment
      ? [
          {
            id: "demo-appointment",
            clinician: t("Demo doctor Ani", "Demo doctor Ani", "Демонстрационный врач Ани"),
            specialty: t("Follow-up", "Կրկնակի այց", "Повторный приём"),
            location: t("Demo clinic, Yerevan", "Demo clinic, Yerevan", "Демонстрационная клиника, Ереван"),
            startsAt:
              new Date(`${day}T11:30:00+04:00`).getTime() > now.getTime()
                ? new Date(`${day}T11:30:00+04:00`).toISOString()
                : new Date(now.getTime() + 2 * 86400000).toISOString(),
            status: "confirmed",
          },
        ]
      : [],
    events,
  };
}
export function demoMeasurements(now: Date): Measurement[] {
  return Array.from({ length: 28 }, (_, i) => ({
    id: `demo-bp-${i}`,
    submissionId: `demo-bp-${i}`,
    systolic: Math.round(143 - i * 0.45 + Math.sin(i * 1.7) * 5),
    diastolic: Math.round(91 - i * 0.22 + Math.sin(i) * 3),
    pulse: Math.round(77 + Math.sin(i * 0.8) * 5),
    measuredAt: new Date(now.getTime() - (28 - i) * 86400000).toISOString(),
    source: "manual" as const,
  })).reverse();
}
