import {
  ALCOHOL_WEEKLY_LIMIT_GRAMS,
  alcoholGramsPerWeek,
  auditCBand,
  auditCScore,
  bmi,
  bmiBand,
  osaBand,
  packYears,
  rawPackYears,
} from "@/lib/clinical/rules/derived";
import { BP_QUESTIONNAIRE_NEXT } from "@/lib/clinical/rules/bp-words";
import { THRESHOLD } from "@/lib/clinical/rules/thresholds";
import type { Answers, FieldValue, Rule, RuleContext } from "@/lib/clinical/types";
import { UNKNOWN } from "@/lib/clinical/types";

/**
 * The shared clinical rules service.
 *
 * Screens never test a threshold themselves. Every number that decides
 * something lives in `THRESHOLD` (`thresholds.ts`) exactly once, and every decision it produces
 * carries the rule id that made it, so the reason shown to the user and the
 * reason recorded for the clinician are the same sentence.
 *
 * The twelve flags keep their registry ids, `RF-01` to `RF-12`, and each one
 * carries the guideline it comes from. A finding on screen can be looked up in
 * `docs/clinical/NRN-CLIN-ALG-001-triage-simulator.html` without a translation
 * step, which is the whole reason for not renaming them.
 *
 * NOT CLINICALLY APPROVED. These thresholds are a working draft for the
 * demonstration and must not be treated as production guidance until clinical
 * sign-off.
 */
export const ALGORITHM_VERSION = "NRN-CLIN-ALG-001-v1.1";

function val(answers: Answers, id: string): FieldValue | undefined {
  return answers[id]?.value;
}

function num(answers: Answers, id: string): number | undefined {
  const v = val(answers, id);
  return typeof v === "number" ? v : undefined;
}

function str(answers: Answers, id: string): string | undefined {
  const v = val(answers, id);
  return typeof v === "string" ? v : undefined;
}

function list(answers: Answers, id: string): string[] {
  const v = val(answers, id);
  return Array.isArray(v) ? v : [];
}

/** True when the field was never answered, or was answered "I don't know". */
export function isUnknown(answers: Answers, id: string): boolean {
  const v = val(answers, id);
  return v === undefined || v === UNKNOWN;
}

// ---------------------------------------------------------------------------
// Thresholds live in `thresholds.ts`, so `derived.ts` can share them without an
// import cycle. Re-exported here because consumers ask the rules service.
// ---------------------------------------------------------------------------

export { THRESHOLD };

/**
 * Decision tree v1.1, Phase 2 lipid cut points. The source is "LDL-C ≥4.9" but
 * "TC >8" (simulator reference table and risk step), so the two comparisons differ
 * on purpose. Exported so a consumer asks the rule, not the number.
 */
export function phase2LdlHighReached(ldl: number): boolean {
  return ldl >= THRESHOLD.phase2LdlHigh;
}

export function phase2TotalCholesterolHighReached(totalCholesterol: number): boolean {
  return totalCholesterol > THRESHOLD.phase2TotalCholesterolHigh;
}

/** True when the last reading is in the crisis range. Exported so a screen asks the rule, not the number. */
export function inCrisisRange(answers: Answers): boolean {
  const systolic = num(answers, "q5.last_reading.systolic");
  const diastolic = num(answers, "q5.last_reading.diastolic");
  return (
    (systolic !== undefined && systolic >= THRESHOLD.crisisSystolic) ||
    (diastolic !== undefined && diastolic >= THRESHOLD.crisisDiastolic)
  );
}

/** Crisis symptoms actually selected, with the "none of these" option removed. */
function crisisSymptoms(answers: Answers): string[] {
  return list(answers, "q5.crisis_symptoms").filter((s) => s !== "none");
}

const CALL_103 = {
  hy: "Զանգահարեք 103 հիմա։ Մի վարեք մեքենա և մի մնացեք մենակ։",
  en: "Call 103 now. Do not drive, and do not stay on your own.",
  ru: "Позвоните 103 сейчас. Не садитесь за руль и не оставайтесь в одиночестве.",
};

// ---------------------------------------------------------------------------
// The red flag registry, RF-01 to RF-12.
//
// Red opens the urgent route and freezes navigation. Orange does not: it sets
// the consultation window to somewhere between 24 hours and 7 days and stays
// on the summary. The distinction is the reason `firesEmergency` filters on
// urgency rather than on membership of this list.
// ---------------------------------------------------------------------------

const FLAG_RULES: Rule[] = [
  {
    id: "RF-01",
    source: "ESC ACS §3.1.1, §4.1.1",
    category: "emergency",
    urgency: "red",
    reason: {
      hy: "Կրծքավանդակի ցավ կամ ճնշվածություն այս պահին։",
      en: "Chest pain or pressure right now.",
      ru: "Боль или сдавление в груди прямо сейчас.",
    },
    nextStep: CALL_103,
    evaluate: ({ answers, episode }) => {
      if (str(answers, "q9.right_now") === "yes") {
        return { triggeredBy: "q9.right_now" };
      }
      if (episode?.presentNow === true && episode.clarifiers.chest_pain === "yes") {
        return { triggeredBy: "episode.chest_pain" };
      }
      return null;
    },
  },
  {
    id: "RF-02",
    source: "ESC ACS §4.1.1 · ESC Prevention §3.4.2",
    category: "emergency",
    urgency: "red",
    reason: {
      hy: "Սրտխփոց՝ գլխապտույտի, օդի պակասի կամ մոտալուտ ուշագնացության հետ, այս պահին։",
      en: "Palpitations with dizziness, breathlessness or near-fainting, right now.",
      ru: "Ощущение сильного или учащённого сердцебиения с головокружением, одышкой или предобморочным состоянием прямо сейчас.",
    },
    nextStep: CALL_103,
    evaluate: ({ answers, episode }) => {
      if (str(answers, "q10.right_now") === "yes") {
        return { triggeredBy: "q10.right_now" };
      }
      if (
        episode?.presentNow === true &&
        ["dizziness", "breathlessness", "near_fainting"].includes(
          String(episode.clarifiers.accompanying),
        )
      ) {
        return { triggeredBy: "episode.accompanying" };
      }
      return null;
    },
  },
  {
    id: "RF-03",
    source: "2024 ESC HTN §10.1.1 (Class I)",
    category: "emergency",
    urgency: "red",
    reason: {
      hy: "Ձեր վերին ճնշումը 180 կամ ավելի է, կամ ստորինը՝ 110 կամ ավելի, և առկա է առնվազն մեկ ախտանիշ։",
      en: "Your upper blood pressure is 180 or more, or your lower pressure is 110 or more, with at least one symptom present.",
      ru: "Ваше верхнее давление 180 или выше, либо нижнее давление 110 или выше, и есть хотя бы один симптом.",
    },
    nextStep: CALL_103,
    evaluate: ({ answers }) => {
      const symptoms = crisisSymptoms(answers);
      if (!inCrisisRange(answers) || !symptoms.length) return null;
      return { triggeredBy: "q5.crisis_symptoms" };
    },
  },
  {
    id: "RF-04",
    source: "2024 ESC HTN §10.1.1",
    category: "emergency",
    urgency: "red",
    reason: {
      hy: "Խոսքի կամ շարժման խանգարում այս պահին։",
      en: "Trouble speaking or moving, right now.",
      ru: "Нарушение речи или движений прямо сейчас.",
    },
    nextStep: CALL_103,
    evaluate: ({ answers }) =>
      list(answers, "q5.crisis_symptoms").includes("neuro")
        ? { triggeredBy: "q5.crisis_symptoms.neuro" }
        : null,
  },
  {
    id: "RF-05",
    source: "2024 ESC HTN §10.1.1",
    category: "emergency",
    urgency: "red",
    reason: {
      hy: "Ցնցումներ կամ գիտակցության պղտորում։",
      en: "Seizures or clouded consciousness.",
      ru: "Судороги или помрачение сознания.",
    },
    nextStep: CALL_103,
    evaluate: ({ answers }) =>
      list(answers, "q5.crisis_symptoms").includes("seizure")
        ? { triggeredBy: "q5.crisis_symptoms.seizure" }
        : null,
  },
  {
    id: "RF-06",
    source: "2024 ESC HTN §7.1",
    category: "blood-pressure",
    urgency: "orange",
    reason: {
      hy: "Ձեր վերին ճնշումը 180 կամ ավելի է, կամ ստորինը՝ 110 կամ ավելի, առանց ախտանիշների։",
      en: "Your upper blood pressure is 180 or more, or your lower pressure is 110 or more, with no symptoms.",
      ru: "Ваше верхнее давление 180 или выше, либо нижнее давление 110 или выше, без симптомов.",
    },
    // Armen's 2 Nov list, task 4: the same window as Zoe's (lib/clinical/rules/bp-words.ts). The vendored source still says one week.
    nextStep: BP_QUESTIONNAIRE_NEXT,
    evaluate: ({ answers }) => {
      if (!inCrisisRange(answers)) return null;
      // The gate has to have been answered. An unanswered gate is not the same
      // as an answered "none of these", and only the second one is reassuring.
      if (!list(answers, "q5.crisis_symptoms").includes("none")) return null;
      if (crisisSymptoms(answers).length) return null;
      // 2 Nov: 180/110 or more within 48 hours, the orange default (Armen). 180 or 120, either number, the same day
      // (Roo's item 15, on Khikar's word for staging), as Zoe's chat reads it.
      const systolic = num(answers, "q5.last_reading.systolic");
      const diastolic = num(answers, "q5.last_reading.diastolic");
      const sameDay = (systolic !== undefined && systolic >= THRESHOLD.bpDoctorTodaySystolic) || (diastolic !== undefined && diastolic >= THRESHOLD.bpDoctorTodayDiastolic);
      return { triggeredBy: "q5.last_reading", ...(sameDay ? { consultationWithinDays: 0 } : {}) };
    },
  },
  {
    id: "RF-07",
    source: "ESC ACS §4.1.1",
    category: "symptom",
    urgency: "orange",
    reason: {
      hy: "Կրծքավանդակի ցավը վատանում է, առաջանում է հանգստի ժամանակ, տևում է երկար կամ կրկնվում ամեն օր։",
      en: "Chest pain that is worsening, comes on at rest, lasts a long time, or happens daily.",
      ru: "Боль в груди, которая усиливается, возникает в покое, длится долго или повторяется ежедневно.",
    },
    nextStep: {
      hy: "Սրտաբան 1–2 օրվա ընթացքում և ԷՍԳ անհապաղ։",
      en: "A cardiologist within one to two days, and an ECG straight away.",
      ru: "Кардиолог в течение одного-двух дней и ЭКГ незамедлительно.",
    },
    evaluate: ({ answers }) => {
      // Any one of the four is enough. Stable pain that has been the same for
      // years and pain that changed last month are different conditions, and
      // this is the rule that separates them.
      const triggers: string[] = [];
      if (str(answers, "q9.crescendo") === "worse") triggers.push("q9.crescendo");
      if (str(answers, "q9.at_rest") === "yes") triggers.push("q9.at_rest");
      if (str(answers, "q9.duration") === "over_15") triggers.push("q9.duration");
      if (["multi_daily", "daily"].includes(str(answers, "q9.frequency") ?? "")) {
        triggers.push("q9.frequency");
      }
      return triggers.length ? { triggeredBy: triggers.join(", ") } : null;
    },
  },
  {
    id: "RF-08",
    source: "NOREON · ESC Prevention (sudden cardiac death risk)",
    category: "symptom",
    urgency: "orange",
    reason: {
      hy: "Ուշագնացություն ֆիզիկական ծանրաբեռնվածության ժամանակ։",
      en: "Fainting during physical exertion.",
      ru: "Обморок во время физической нагрузки.",
    },
    nextStep: {
      hy: "ԷՍԳ 24 ժամում, Հոլտեր, սրտի ուլտրաձայն և արիթմոլոգ 2–3 օրում։",
      en: "An ECG within 24 hours, a Holter monitor, a heart ultrasound, and an arrhythmia specialist within two to three days.",
      ru: "ЭКГ в течение 24 часов, холтеровское мониторирование, УЗИ сердца и аритмолог в течение двух-трёх дней.",
    },
    evaluate: ({ answers }) =>
      str(answers, "q10.syncope") === "exertion"
        ? { triggeredBy: "q10.syncope" }
        : null,
  },
  {
    id: "RF-09",
    source: "NOREON",
    category: "symptom",
    urgency: "orange",
    reason: {
      hy: "Ուշագնացություն առանց նախազգուշացնող նշանների։",
      en: "Fainting with no warning signs.",
      ru: "Обморок без предвестников.",
    },
    // DT P372–374: «same path» as RF-08, which includes the echocardiogram.
    nextStep: {
      hy: "ԷՍԳ 24 ժամում, Հոլտեր, սրտի ուլտրաձայն և արիթմոլոգ 2–3 օրում։",
      en: "An ECG within 24 hours, a Holter monitor, a heart ultrasound, and an arrhythmia specialist within two to three days.",
      ru: "ЭКГ в течение 24 часов, холтеровское мониторирование, УЗИ сердца и аритмолог в течение двух-трёх дней.",
    },
    evaluate: ({ answers }) =>
      str(answers, "q10.syncope") === "rest" ? { triggeredBy: "q10.syncope" } : null,
  },
  {
    id: "RF-10",
    source: "NOREON",
    category: "symptom",
    urgency: "orange",
    reason: {
      hy: "Սրտի ռիթմի նոպաներ, որոնք տևում են 30 րոպեից ավելի։",
      en: "Rhythm episodes lasting more than 30 minutes.",
      ru: "Приступы нарушения ритма длительностью более 30 минут.",
    },
    nextStep: {
      hy: "Հոլտեր 24–48 ժամ և սրտաբան։",
      en: "A 24 to 48 hour Holter monitor, and a cardiologist.",
      ru: "Холтеровское мониторирование в течение 24–48 часов и кардиолог.",
    },
    evaluate: ({ answers }) =>
      str(answers, "q10.episode_duration") === "over_30"
        ? { triggeredBy: "q10.episode_duration" }
        : null,
  },
  {
    id: "RF-11",
    source: "NOREON (ESC target below 7.0%, Class I)",
    category: "metabolic",
    urgency: "orange",
    reason: {
      hy: "Ձեր HbA1c-ն 9% կամ ավելի է։",
      en: "Your HbA1c is 9% or more.",
      ru: "Ваш HbA1c составляет 9% или выше.",
    },
    nextStep: {
      hy: "Բժիշկ մեկ շաբաթվա ընթացքում, իսկ ուժեղ ծարավի, քաշի կորստի կամ 15 մմոլ/լ և բարձր գլյուկոզայի դեպքում՝ 48 ժամվա ընթացքում։",
      en: "A clinician within one week, or within 48 hours with strong thirst, weight loss or glucose of 15 mmol/L or more.",
      ru: "Врач в течение одной недели, а при сильной жажде, потере веса или глюкозе 15 ммоль/л и выше в течение 48 часов.",
    },
    evaluate: ({ answers }) => {
      const hba1c = num(answers, "q6.hba1c");
      if (hba1c === undefined || hba1c < THRESHOLD.hba1cUrgent) return null;
      // One week, Armen's message 588, so the window line matches the next step. His 48 hours with thirst, weight loss or glucose
      // of 15 or more has no input here: the questionnaire asks none of them.
      return {
        triggeredBy: "q6.hba1c",
        detail: { hy: `HbA1c ${hba1c}%`, en: `HbA1c ${hba1c}%`, ru: `HbA1c ${hba1c}%` },
        consultationWithinDays: 7,
      };
    },
  },
  {
    id: "RF-12",
    source: "NOREON",
    category: "family-history",
    urgency: "orange",
    reason: {
      hy: "Հանկարծամահություն ընտանիքում 50 տարեկանից շուտ, սրտի ռիթմի գանգատների հետ միասին։",
      en: "Sudden death in the family before 50, alongside rhythm symptoms.",
      ru: "Внезапная смерть в семье в возрасте до 50 лет в сочетании с жалобами на сердечный ритм.",
    },
    nextStep: {
      hy: "ԷՍԳ-ն դառնում է առաջնահերթ, սրտաբանի գնահատմամբ։",
      en: "The ECG becomes a priority, with a cardiologist's assessment.",
      ru: "ЭКГ становится первоочередной, с оценкой кардиолога.",
    },
    evaluate: ({ answers }) => {
      if (!list(answers, "q7.relatives").includes("sudden_death")) return null;
      if (!["yes", "palpitations_only"].includes(str(answers, "q10.symptoms") ?? "")) {
        return null;
      }
      return { triggeredBy: "q7.relatives, q10.symptoms" };
    },
  },
];

// ---------------------------------------------------------------------------
// Risk factors. These shape the plan and the summary, not the route. Together
// they are what lifts a session from routine to routine-priority.
// ---------------------------------------------------------------------------

const RISK_RULES: Rule[] = [
  {
    id: "NRN-RULE-BP-002",
    source: "2024 ESC HTN §7.1",
    category: "blood-pressure",
    urgency: "yellow",
    reason: {
      hy: "Չափված ճնշումը բարձր է։",
      en: "Your measured blood pressure is raised.",
      ru: "Ваше измеренное артериальное давление повышено.",
    },
    nextStep: {
      hy: "7 օր տնային չափում՝ օրական երկու անգամ, ապա բժշկի խորհրդատվություն։",
      en: "Seven days of home readings, twice a day, then a medical consultation.",
      ru: "Домашние измерения дважды в день в течение семи дней, затем консультация врача.",
    },
    evaluate: ({ answers }) => {
      const systolic = num(answers, "q5.last_reading.systolic");
      const diastolic = num(answers, "q5.last_reading.diastolic");
      if (systolic === undefined && diastolic === undefined) return null;
      // Crisis readings belong to RF-03 and RF-06, which say something stronger.
      if (inCrisisRange(answers)) return null;
      const raised =
        (systolic !== undefined && systolic >= THRESHOLD.grade1Systolic) ||
        (diastolic !== undefined && diastolic >= THRESHOLD.grade1Diastolic);
      if (!raised) return null;
      const grade2 =
        (systolic !== undefined && systolic >= THRESHOLD.grade2Systolic) ||
        (diastolic !== undefined && diastolic >= THRESHOLD.grade2Diastolic);
      const reading = `${systolic ?? "?"}/${diastolic ?? "?"} mmHg`;
      const treated = str(answers, "q5.diagnosed") === "treated";
      return {
        triggeredBy: "q5.last_reading",
        detail: {
          hy: treated ? `${reading}։ Դուք նշել եք, որ ընդունում եք ճնշման դեղեր։` : reading,
          en: treated ? `${reading}. You reported taking blood pressure medication.` : reading,
          ru: treated ? `${reading}. Вы сообщили, что принимаете лекарства от давления.` : reading,
        },
        consultationWithinDays: grade2 ? 7 : 14,
        nextStep: grade2 ? {
          hy: "Բժշկի խորհրդատվություն՝ 1 շաբաթվա ընթացքում։",
          en: "Medical consultation within 1 week.",
          ru: "Консультация врача в течение 1 недели.",
        } : undefined,
      };
    },
  },
  {
    id: "NRN-RULE-BP-003",
    source: "NOREON",
    category: "blood-pressure",
    urgency: "yellow",
    reason: {
      hy: "Ձեր ճնշումը հայտնի չէ։",
      en: "Your blood pressure is not known.",
      ru: "Ваше артериальное давление неизвестно.",
    },
    nextStep: {
      hy: "7-օրյա տնային չափման ծրագիր՝ առավոտյան և երեկոյան։",
      en: "A seven-day home measurement plan, morning and evening.",
      ru: "Семидневный план домашних измерений утром и вечером.",
    },
    evaluate: ({ answers }) => {
      // Not knowing is not the same as being normal, and the plan has to send
      // this person to measure rather than pass over them in silence.
      // Either half can be "I don't know" on its own, and a reading missing
      // either half is not known, so both halves are tested the same way.
      const asked =
        val(answers, "q5.last_reading.systolic") !== undefined ||
        val(answers, "q5.last_reading.diastolic") !== undefined;
      if (!asked) return null;
      return isUnknown(answers, "q5.last_reading.systolic") ||
        isUnknown(answers, "q5.last_reading.diastolic")
        ? { triggeredBy: "q5.last_reading" }
        : null;
    },
  },
  {
    id: "NRN-RULE-SMK-001",
    source: "ESC Prevention",
    category: "lifestyle",
    urgency: "yellow",
    reason: { hy: "Ներկայումս ծխում եք։", en: "You currently smoke.", ru: "Вы сейчас курите." },
    nextStep: {
      hy: "Ծխելը թողնելու աջակցություն՝ դադարեցման ամսաթվով։",
      en: "Cessation support, starting with a quit date.",
      ru: "Поддержка в отказе от курения, начиная с даты отказа.",
    },
    evaluate: ({ answers }) => {
      const status = str(answers, "q3.status");
      // Heated and electronic tobacco counts as smoking, for caution: the
      // evidence is not yet enough to assume a lower risk.
      if (status !== "current" && status !== "alternative") return null;
      const packs = packYears(answers);
      const perDay = num(answers, "q3.per_day");
      const years = num(answers, "q3.years");
      return {
        triggeredBy: "q3.status",
        detail:
          packs !== null
            ? {
                hy: `${perDay} հատ օրական, ${years} տարի, ${packs} տուփ-տարի`,
                en: `${perDay} a day for ${years} years, ${packs} pack-years`,
                ru: `${perDay} в день в течение ${years} лет, ${packs} пачка-лет`,
              }
            : undefined,
      };
    },
  },
  {
    id: "NRN-RULE-SMK-002",
    source: "NOREON",
    category: "lifestyle",
    urgency: "yellow",
    reason: {
      hy: "20 տուփ-տարի և ավելի ծխելու պատմություն։",
      en: "A smoking history of 20 pack-years or more.",
      ru: "Стаж курения 20 пачка-лет или более.",
    },
    nextStep: {
      hy: "Բժշկին առանձին նշում է գնում։",
      en: "A separate note goes to the clinician.",
      ru: "Врачу направляется отдельная заметка.",
    },
    evaluate: ({ answers }) => {
      // Decision tree v1.1 P147/P149: compare exposure before display rounding.
      const exposure = rawPackYears(answers);
      if (exposure === null || exposure < THRESHOLD.heavySmokingPackYears) return null;
      const packs = packYears(answers);
      return {
        triggeredBy: "q3.years",
        detail: { hy: `${packs} տուփ-տարի`, en: `${packs} pack-years`, ru: `${packs} пачка-лет` },
      };
    },
  },
  {
    id: "NRN-RULE-ANT-001",
    source: "2024 ESC HTN",
    category: "metabolic",
    urgency: "yellow",
    reason: {
      hy: "Գոտկատեղի շրջագիծը շեմից բարձր է։",
      en: "Your waist circumference is above the threshold.",
      ru: "Ваша окружность талии выше порогового значения.",
    },
    nextStep: {
      hy: "Ածխաջրերի յուրացման ստուգում՝ HbA1c և քաղցած գլյուկոզա։",
      en: "Check glucose handling with HbA1c and fasting glucose.",
      ru: "Проверка обмена глюкозы: HbA1c и глюкоза натощак.",
    },
    evaluate: ({ answers }) => {
      const waist = num(answers, "q2.waist");
      if (waist === undefined) return null;
      const limit =
        str(answers, "q1.sex") === "female"
          ? THRESHOLD.waistFemale
          : THRESHOLD.waistMale;
      if (waist < limit) return null;
      return {
        triggeredBy: "q2.waist",
        detail: {
          hy: `${waist} սմ, շեմը՝ ${limit} սմ`,
          en: `${waist} cm against a ${limit} cm threshold`,
          ru: `${waist} см при пороговом значении ${limit} см`,
        },
      };
    },
  },
  {
    id: "NRN-RULE-ANT-002",
    source: "2024 ESC HTN",
    category: "metabolic",
    urgency: "yellow",
    reason: { hy: "BMI-ն 30-ից բարձր է։", en: "Your BMI is above 30.", ru: "Ваш BMI выше 30." },
    nextStep: {
      hy: "4-շաբաթյա սննդակարգի ծրագիր և քաշի շաբաթական գրանցում։",
      en: "A four-week nutrition plan, with a weekly weight entry.",
      ru: "Четырёхнедельный план питания с еженедельной записью веса.",
    },
    evaluate: ({ answers }) => {
      const b = bmi(answers);
      if (b === null || b < THRESHOLD.obesityBmi) return null;
      return {
        triggeredBy: "q2.weight",
        detail: { hy: `BMI ${b}`, en: `BMI ${b}`, ru: `BMI ${b}` },
      };
    },
  },
  {
    id: "NRN-RULE-ACT-001",
    source: "ESC Prevention",
    category: "lifestyle",
    urgency: "yellow",
    reason: {
      hy: "Ֆիզիկական ակտիվությունը նվազագույն նորմայից ցածր է։",
      en: "Your physical activity is below the minimum.",
      ru: "Ваша физическая активность ниже минимума.",
    },
    nextStep: {
      hy: "Աստիճանաբար հասցնել շաբաթական 150 րոպեի՝ 10-րոպեանոց բլոկներից սկսած։",
      en: "Build up to 150 minutes a week, starting with ten-minute blocks.",
      ru: "Постепенно доведите активность до 150 минут в неделю, начиная с десятиминутных отрезков.",
    },
    evaluate: ({ answers }) => {
      const activity = str(answers, "q2.activity");
      // Someone who cannot exercise for health reasons gets a physiotherapist,
      // not a target they have already been told they cannot meet.
      if (activity === "limited") return null;
      if (activity === "sedentary") return { triggeredBy: "q2.activity" };
      const minutes = num(answers, "q2.activity_minutes");
      if (minutes === undefined) return null;
      const equivalent =
        minutes * (str(answers, "q2.activity_intensity") === "vigorous" ? 2 : 1);
      if (equivalent >= THRESHOLD.activityMinutes) return null;
      return {
        triggeredBy: "q2.activity_minutes",
        detail: {
          hy: `${equivalent} րոպե շաբաթական, նորման՝ ${THRESHOLD.activityMinutes}`,
          en: `${equivalent} minutes a week against a ${THRESHOLD.activityMinutes} minute minimum`,
          ru: `${equivalent} минут в неделю при минимуме ${THRESHOLD.activityMinutes} минут`,
        },
      };
    },
  },
  {
    // AUDIT-C is a screen, not a diagnosis. The wording says so, and the rule
    // orders no medicine and applies no label: what it asks for is the full
    // instrument and a conversation.
    id: "NRN-RULE-ALC-002",
    source: "WHO AUDIT 2001",
    category: "lifestyle",
    urgency: "yellow",
    reason: {
      hy: "AUDIT-C-ի միավորը սկրինինգային շեմից բարձր է։",
      en: "The AUDIT-C score is above the screening cut-off.",
      ru: "Результат AUDIT-C выше порогового значения скрининга.",
    },
    nextStep: {
      hy: "Ամբողջական AUDIT և քննարկում բժշկի հետ։ Սա սկրինինգ է, ոչ ախտորոշում։",
      en: "A full AUDIT and a conversation with a doctor. This is a screen, not a diagnosis.",
      ru: "Полный AUDIT и беседа с врачом. Это скрининг, а не диагноз.",
    },
    evaluate: ({ answers }) => {
      const band = auditCBand(answers);
      if (band?.code !== "POSITIVE") return null;
      return {
        triggeredBy: "q4.binge",
        detail: { hy: `${band.value} / 12`, en: `${band.value} of 12`, ru: `${band.value} из 12` },
      };
    },
  },
  {
    id: "NRN-RULE-ALC-003",
    source: "WHO AUDIT 2001",
    category: "lifestyle",
    urgency: "orange",
    reason: {
      hy: "Մեկ առիթով 6 և ավելի բաժին՝ շաբաթական կամ ավելի հաճախ։",
      en: "Six or more drinks on one occasion, weekly or more often.",
      ru: "Шесть или более порций алкоголя за один раз, еженедельно или чаще.",
    },
    nextStep: {
      hy: "Առաջնահերթ գնահատում՝ վնասակար օգտագործման, կախվածության և անվտանգության ռիսկերի համար։",
      en: "A priority assessment for harmful use, dependence and safety risks.",
      ru: "Первоочередная оценка вредного употребления, зависимости и рисков для безопасности.",
    },
    evaluate: ({ answers }) =>
      auditCBand(answers)?.code === "PRIORITY"
        ? { triggeredBy: "q4.binge" }
        : null,
  },
  {
    id: "NRN-RULE-ALC-004",
    source: "ESC Prevention §4.3.2.4.5 · 2024 ESC HTN §8.2.4",
    category: "lifestyle",
    urgency: "yellow",
    reason: {
      hy: "Շաբաթական ալկոհոլի քանակը գերազանցում է սահմանը։",
      en: "Weekly alcohol is over the limit.",
      ru: "Количество алкоголя за неделю превышает предел.",
    },
    nextStep: {
      hy: "Նվազեցման ծրագիր և քննարկում բժշկի հետ։",
      en: "A reduction plan, and a conversation with a doctor.",
      ru: "План сокращения употребления и беседа с врачом.",
    },
    evaluate: ({ answers }) => {
      const grams = alcoholGramsPerWeek(answers);
      if (grams === null || grams <= ALCOHOL_WEEKLY_LIMIT_GRAMS) return null;
      return {
        triggeredBy: "q4.frequency",
        detail: {
          hy: `${grams} գ շաբաթական, սահմանը՝ ${ALCOHOL_WEEKLY_LIMIT_GRAMS} գ`,
          en: `${grams} g a week against a ${ALCOHOL_WEEKLY_LIMIT_GRAMS} g limit`,
          ru: `${grams} г в неделю при пределе ${ALCOHOL_WEEKLY_LIMIT_GRAMS} г`,
        },
      };
    },
  },
  {
    id: "NRN-RULE-DIET-001",
    source: "ESC Prevention Table 8",
    category: "lifestyle",
    urgency: "yellow",
    reason: {
      hy: "Առողջ սննդակարգի ութ բաղադրիչից կեսից քիչն է առկա։",
      en: "Fewer than half of the eight healthy-diet components are in place.",
      ru: "Присутствует менее половины из восьми компонентов здорового питания.",
    },
    nextStep: {
      hy: "Ամբողջական սննդակարգի ծրագիր, միայն չնշված կետերով։",
      en: "A full nutrition plan, covering only what you left unticked.",
      ru: "Полный план питания, охватывающий только те пункты, которые вы не отметили.",
    },
    evaluate: ({ answers }) => {
      const selected = list(answers, "q2.diet");
      if (!selected.length) return null;
      const score = selected.filter((v) => v !== "none").length;
      if (score >= 4) return null;
      return {
        triggeredBy: "q2.diet",
        detail: { hy: `${score} / 8`, en: `${score} of 8`, ru: `${score} из 8` },
      };
    },
  },
  {
    id: "NRN-RULE-FAM-001",
    source: "ESC Prevention",
    category: "family-history",
    urgency: "yellow",
    reason: {
      hy: "Առաջին աստիճանի ազգականի վաղ սրտանոթային դեպք։",
      en: "A premature cardiovascular event in a first-degree relative.",
      ru: "Раннее сердечно-сосудистое событие у родственника первой степени родства.",
    },
    nextStep: {
      hy: "Ընդլայնված լիպիդային գնահատում՝ ApoB և Lp(a)։",
      en: "Extended lipid assessment with ApoB and Lp(a).",
      ru: "Расширенная оценка липидов с ApoB и Lp(a).",
    },
    evaluate: ({ answers }) => {
      // The age band is the rule, not the diagnosis. An event at 80 is ageing,
      // and counting it would overestimate almost everyone.
      const band = str(answers, "q7.relative_age");
      if (band !== "male_under_55" && band !== "female_under_65") return null;
      return {
        triggeredBy: "q7.relative_age",
        detail:
          band === "male_under_55"
            ? { hy: "Տղամարդ ազգական, 55-ից շուտ", en: "A male relative, before 55", ru: "Родственник мужского пола, до 55 лет" }
            : { hy: "Կին ազգական, 65-ից շուտ", en: "A female relative, before 65", ru: "Родственница, до 65 лет" },
      };
    },
  },
  {
    id: "NRN-RULE-APN-001",
    source: "STOP-BANG · EXTERNAL, pending validation",
    category: "symptom",
    urgency: "yellow",
    reason: {
      hy: "Քնային ապնոէի հավանական նշաններ։",
      en: "Possible signs of sleep apnoea.",
      ru: "Возможные признаки апноэ сна.",
    },
    nextStep: {
      hy: "Քնի օրագիր 2 շաբաթ և քննարկում բժշկի հետ։ Բարձր հավանականության դեպքում՝ քնի հետազոտություն։",
      en: "A two-week sleep diary and a conversation with a clinician. If the likelihood is high, a sleep study.",
      ru: "Дневник сна в течение двух недель и беседа с врачом. При высокой вероятности, исследование сна.",
    },
    evaluate: ({ answers }) => {
      const band = osaBand(answers);
      // Decision tree Q7: 3 to 4 the sleep diary, 5 to 8 the sleep study (NRN-RULE-APN-002).
      if (!band || band.code === "LOW" || band.code === "HIGH") return null;
      return {
        triggeredBy: "q8.breathing",
        detail: { hy: `STOP-BANG ${band.unit?.hy}`, en: `STOP-BANG ${band.unit?.en ?? band.unit?.hy}`, ru: `STOP-BANG ${band.unit?.ru}` },
      };
    },
  },
  {
    id: "NRN-RULE-APN-002",
    source: "STOP-BANG · EXTERNAL, pending validation",
    category: "symptom",
    urgency: "yellow",
    reason: {
      hy: "Քնային ապնոէի բարձր հավանականություն։",
      en: "High likelihood of sleep apnoea.",
      ru: "Высокая вероятность апноэ сна.",
    },
    nextStep: {
      hy: "Քնի հետազոտություն (պոլիսոմնոգրաֆիա կամ HSAT) և սոմնոլոգի խորհրդատվություն 4 շաբաթվա ընթացքում։",
      en: "A sleep study (PSG or HSAT) and a sleep specialist within 4 weeks.",
      ru: "Исследование сна (ПСГ или HSAT) и консультация сомнолога в течение 4 недель.",
    },
    evaluate: ({ answers }) => {
      const band = osaBand(answers);
      if (band?.code !== "HIGH") return null;
      return {
        triggeredBy: "q8.breathing",
        detail: { hy: `STOP-BANG ${band.unit?.hy}`, en: `STOP-BANG ${band.unit?.en ?? band.unit?.hy}`, ru: `STOP-BANG ${band.unit?.ru}` },
      };
    },
  },
  {
    id: "NRN-RULE-SLP-001",
    source: "NOREON",
    category: "symptom",
    urgency: "yellow",
    reason: {
      hy: "Ուժեղ ցերեկային քնկոտություն։",
      en: "Strong daytime sleepiness.",
      ru: "Выраженная дневная сонливость.",
    },
    nextStep: {
      hy: "Խուսափեք երկար մեքենա վարելուց, մինչև այս հարցը քննարկեք բժշկի հետ։",
      en: "Avoid long drives until you have talked this through with a clinician.",
      ru: "Избегайте длительного вождения, пока не обсудите это с врачом.",
    },
    evaluate: ({ answers }) =>
      ["often", "daily"].includes(str(answers, "q8.daytime_sleepiness") ?? "")
        ? { triggeredBy: "q8.daytime_sleepiness" }
        : null,
  },
  {
    id: "NRN-RULE-STR-001",
    source: "ESC Prevention",
    category: "lifestyle",
    urgency: "yellow",
    reason: {
      hy: "Մշտական հոգեսոցիալական սթրես։",
      en: "Sustained psychosocial stress.",
      ru: "Постоянный психосоциальный стресс.",
    },
    nextStep: {
      hy: "Առաջարկում ենք օգնել կապվել հոգեբանի հետ։",
      en: "We can help you get in touch with a psychologist.",
      ru: "Мы можем помочь вам связаться с психологом.",
    },
    evaluate: ({ answers }) =>
      ["often", "always"].includes(str(answers, "q8.stress") ?? "")
        ? { triggeredBy: "q8.stress" }
        : null,
  },
  {
    id: "NRN-RULE-DM-001",
    source: "2025 ESC/EAS Table 3",
    category: "metabolic",
    urgency: "yellow",
    reason: {
      hy: "Դիաբետը տևում է 10 տարի և ավելի։",
      en: "Diabetes of ten years’ duration or more.",
      ru: "Сахарный диабет длительностью десять лет или более.",
    },
    nextStep: {
      hy: "Բժիշկը պետք է վերանայի բարձր ռիսկի այս ճյուղը՝ հաշվի առնելով ավելի բարձր առաջնահերթության պայմանները։ Վերջնական ռիսկի դասակարգումը դեռ որոշված չէ։",
      en: "A clinician should review this high-risk branch alongside any higher-priority conditions. The final risk category is not yet determined.",
      ru: "Врач должен пересмотреть эту ветвь высокого риска с учётом состояний с более высоким приоритетом. Окончательная категория риска ещё не определена.",
    },
    evaluate: ({ answers }) => {
      const years = num(answers, "q6.diabetes_years");
      if (years === undefined || years < THRESHOLD.diabetesLongDurationYears) {
        return null;
      }
      return {
        triggeredBy: "q6.diabetes_years",
        detail: { hy: `${years} տարի`, en: `${years} years`, ru: `${years} лет` },
      };
    },
  },
  {
    id: "NRN-RULE-DM-002",
    source: "NOREON (ESC target below 7.0%, Class I)",
    category: "metabolic",
    urgency: "yellow",
    reason: {
      hy: "HbA1c-ն թիրախից բարձր է։",
      en: "HbA1c is above target.",
      ru: "HbA1c выше целевого значения.",
    },
    nextStep: {
      hy: "Բժիշկ 4 շաբաթվա ընթացքում։",
      en: "A clinician within four weeks.",
      ru: "Врач в течение четырёх недель.",
    },
    evaluate: ({ answers }) => {
      const hba1c = num(answers, "q6.hba1c");
      if (hba1c === undefined) return null;
      if (hba1c < THRESHOLD.hba1cAboveTarget || hba1c >= THRESHOLD.hba1cUrgent) {
        return null;
      }
      return {
        triggeredBy: "q6.hba1c",
        detail: { hy: `HbA1c ${hba1c}%`, en: `HbA1c ${hba1c}%`, ru: `HbA1c ${hba1c}%` },
      };
    },
  },
  {
    id: "NRN-RULE-CP-002",
    source: "2023 ESC ACS §3.1.1",
    category: "symptom",
    urgency: "yellow",
    reason: {
      hy: "Կրծքավանդակի ցավ՝ առանց անկայունության նշանների։",
      en: "Chest pain, with none of the instability signs.",
      ru: "Боль в груди без признаков нестабильности.",
    },
    nextStep: {
      hy: "Կարդիոլոգ 2 շաբաթվա ընթացքում, ԷՍԳ, լիպիդային պանել, հեմոգլոբին և TSH։",
      en: "A cardiologist within two weeks, with an ECG, a lipid panel, haemoglobin and TSH.",
      ru: "Кардиолог в течение двух недель, ЭКГ, липидный профиль, гемоглобин и TSH.",
    },
    evaluate: ({ answers }) => {
      // Pain that is real but stable. Without this rule the questionnaire says
      // nothing at all to someone with stable angina, because the red flag did
      // not fire and the reassuring rule needs an outright "no".
      if (!["yes", "unsure"].includes(str(answers, "q9.present") ?? "")) return null;
      if (str(answers, "q9.right_now") !== "no") return null;
      const unstable =
        str(answers, "q9.crescendo") === "worse" ||
        str(answers, "q9.at_rest") === "yes" ||
        str(answers, "q9.duration") === "over_15" ||
        ["multi_daily", "daily"].includes(str(answers, "q9.frequency") ?? "");
      return unstable ? null : { triggeredBy: "q9.present" };
    },
  },
  {
    id: "NRN-RULE-BP-004",
    source: "2024 ESC HTN §7.1",
    category: "blood-pressure",
    urgency: "yellow",
    reason: {
      hy: "Ճնշումը բարձրացած է, բայց հիպերտոնիայի սահմանից ցածր։",
      en: "Blood pressure is elevated, but below the hypertension threshold.",
      ru: "Артериальное давление повышено, но ниже порога гипертонии.",
    },
    nextStep: {
      hy: "Ապրելակերպի փոփոխություններ և վերաստուգում մեկ տարուց։ Բարձր ընդհանուր ռիսկի դեպքում՝ արտագրասենյակային չափում։",
      en: "Lifestyle changes and a recheck in a year. With high overall risk, an out-of-office measurement.",
      ru: "Изменения образа жизни и повторная проверка через год. При высоком общем риске, измерение вне кабинета врача.",
    },
    evaluate: ({ answers }) => {
      // This is a screening follow-up, not follow-up for known hypertension.
      // Do not infer a personal treatment target from this single reading.
      // The elevated cut follows Armen, team group message 588, 2 Nov, via THRESHOLD.
      if (["treated", "untreated"].includes(str(answers, "q5.diagnosed") ?? "")) return null;
      const systolic = num(answers, "q5.last_reading.systolic");
      const diastolic = num(answers, "q5.last_reading.diastolic");
      if (systolic === undefined || diastolic === undefined) return null;
      const elevated =
        (systolic >= THRESHOLD.elevatedSystolic && systolic < THRESHOLD.grade1Systolic) ||
        (diastolic >= THRESHOLD.elevatedDiastolic && diastolic < THRESHOLD.grade1Diastolic);
      const hypertensive =
        systolic >= THRESHOLD.grade1Systolic || diastolic >= THRESHOLD.grade1Diastolic;
      if (!elevated || hypertensive) return null;
      const reading = `${systolic}/${diastolic} mmHg`;
      return {
        triggeredBy: "q5.last_reading",
        detail: { hy: reading, en: reading, ru: reading },
      };
    },
  },
  {
    id: "NRN-RULE-HTN-001",
    source: "2024 ESC HTN §7.1",
    category: "blood-pressure",
    urgency: "yellow",
    reason: {
      hy: "Ախտորոշված բարձր ճնշում, առանց բուժման։",
      en: "Diagnosed high blood pressure, with no treatment.",
      ru: "Диагностировано повышенное артериальное давление, без лечения.",
    },
    nextStep: {
      hy: "Բժշկի խորհրդատվություն՝ բուժման վերսկսման հարցով։",
      en: "A medical consultation about restarting treatment.",
      ru: "Консультация врача по поводу возобновления лечения.",
    },
    evaluate: ({ answers }) =>
      str(answers, "q5.diagnosed") === "untreated"
        ? { triggeredBy: "q5.diagnosed" }
        : null,
  },
  {
    // Questionnaire Q5.1 «tx»: control assessment. The source tone is info, so
    // this finding does not lift the urgency; it carries the hypertension
    // workup (catalogue B.1, DT Phase 2 step 1 P399–406).
    id: "NRN-RULE-HTN-002",
    source: "2024 ESC HTN §7",
    category: "blood-pressure",
    urgency: "green",
    reason: {
      hy: "Ախտորոշված բարձր ճնշում, բուժման ներքո։",
      en: "Diagnosed high blood pressure, on treatment.",
      ru: "Диагностировано повышенное артериальное давление, проводится лечение.",
    },
    nextStep: {
      hy: "Ճնշման հսկողության գնահատում և բազային հետազոտություններ։",
      en: "A review of blood pressure control, with the baseline tests.",
      ru: "Оценка контроля артериального давления и базовые исследования.",
    },
    evaluate: ({ answers }) =>
      str(answers, "q5.diagnosed") === "treated"
        ? { triggeredBy: "q5.diagnosed" }
        : null,
  },
  {
    // Questionnaire Q6.1 «DM» (tone yellow). Catalogue A.3 and B.1 order urine
    // ACR and creatinine/eGFR for every diabetic; DT P564 uses ACR to separate
    // high from very high risk.
    id: "NRN-RULE-DM-005",
    source: "2025 ESC/EAS Table 3",
    category: "metabolic",
    urgency: "yellow",
    reason: { hy: "Ախտորոշված շաքարային դիաբետ։", en: "Diagnosed diabetes.", ru: "Диагностирован сахарный диабет." },
    nextStep: {
      hy: "Երիկամների ստուգում՝ միզի ACR և կրեատինին/eGFR։",
      en: "A kidney check with urine ACR and creatinine with eGFR.",
      ru: "Проверка почек: ACR мочи и креатинин с eGFR.",
    },
    evaluate: ({ answers }) =>
      list(answers, "q6.conditions").includes("diabetes")
        ? { triggeredBy: "q6.conditions" }
        : null,
  },
  {
    // Catalogue A.2: prediabetes is a trigger for HbA1c and fasting glucose.
    // The questionnaire gives it no branch of its own, so it does not lift the
    // urgency.
    id: "NRN-RULE-DM-006",
    source: "ESC Prevention §4.8",
    category: "metabolic",
    urgency: "green",
    reason: { hy: "Ախտորոշված նախաշաքարախտ։", en: "Diagnosed prediabetes.", ru: "Диагностирован предиабет." },
    nextStep: {
      hy: "HbA1c և քաղցած գլյուկոզա։",
      en: "HbA1c and fasting glucose.",
      ru: "HbA1c и глюкоза натощак.",
    },
    evaluate: ({ answers }) =>
      list(answers, "q6.conditions").includes("prediabetes")
        ? { triggeredBy: "q6.conditions" }
        : null,
  },
  {
    // Questionnaire Q6.1 «CKD» (tone yellow): classification by eGFR. DT
    // P543–544 follows eGFR and ACR.
    id: "NRN-RULE-CKD-001",
    source: "2025 ESC/EAS Table 3",
    category: "metabolic",
    urgency: "yellow",
    reason: {
      hy: "Ախտորոշված երիկամային քրոնիկ հիվանդություն։",
      en: "Diagnosed chronic kidney disease.",
      ru: "Диагностирована хроническая болезнь почек.",
    },
    nextStep: {
      hy: "Կրեատինին/eGFR և միզի ACR՝ երիկամների ֆունկցիան գնահատելու համար։",
      en: "Creatinine with eGFR and urine ACR, to see how the kidneys are working.",
      ru: "Креатинин с eGFR и ACR мочи для оценки работы почек.",
    },
    evaluate: ({ answers }) =>
      list(answers, "q6.conditions").includes("kidney")
        ? { triggeredBy: "q6.conditions" }
        : null,
  },
  {
    // Questionnaire Q7.1 «FH» (tone yellow): Lp(a) once in a lifetime and the
    // lipid panel. DT P253–254. The relative's age (Q7.2) is asked only for
    // infarction, stroke or sudden death, as the source's showWhen says, so
    // this rule does not depend on it.
    id: "NRN-RULE-FAM-002",
    source: "2025 ESC/EAS",
    category: "family-history",
    urgency: "yellow",
    reason: {
      hy: "Ընտանեկան հիպերքոլեստերինեմիա առաջին աստիճանի ազգականի մոտ։",
      en: "Inherited high cholesterol in a first-degree relative.",
      ru: "Наследственный высокий холестерин у родственника первой степени родства.",
    },
    nextStep: {
      hy: "Լիպիդային պանել և Lp(a)՝ կյանքում մեկ անգամ։",
      en: "A lipid panel, and Lp(a) once in a lifetime.",
      ru: "Липидный профиль и Lp(a) один раз в жизни.",
    },
    evaluate: ({ answers }) =>
      list(answers, "q7.relatives").includes("familial_hypercholesterolaemia")
        ? { triggeredBy: "q7.relatives" }
        : null,
  },
  {
    // Catalogue A.2: BMI 25 or more orders HbA1c and fasting glucose. From 30
    // NRN-RULE-ANT-002 carries the same test, so this one covers the
    // overweight band only, read from the derived band rather than a new cut.
    id: "NRN-RULE-ANT-004",
    source: "ESC Prevention §4.8",
    category: "metabolic",
    urgency: "green",
    reason: { hy: "BMI-ն 25 կամ ավելի է։", en: "Your BMI is 25 or more.", ru: "Ваш BMI составляет 25 или выше." },
    nextStep: {
      hy: "Ածխաջրերի յուրացման ստուգում՝ HbA1c և քաղցած գլյուկոզա։",
      en: "Check glucose handling with HbA1c and fasting glucose.",
      ru: "Проверка обмена глюкозы: HbA1c и глюкоза натощак.",
    },
    evaluate: ({ answers }) => {
      const band = bmiBand(answers);
      if (band?.code !== "OVERWEIGHT") return null;
      return { triggeredBy: "q2.weight", detail: { hy: `BMI ${band.value}`, en: `BMI ${band.value}`, ru: `BMI ${band.value}` } };
    },
  },
  {
    id: "NRN-RULE-ANT-003",
    source: "NOREON",
    category: "metabolic",
    urgency: "yellow",
    reason: { hy: "BMI-ն 18,5-ից ցածր է։", en: "Your BMI is below 18.5.", ru: "Ваш BMI ниже 18.5." },
    nextStep: {
      hy: "Ուղեգիր սննդաբանի։ Նիհարեցնող խորհուրդ չենք տալիս։",
      en: "A referral to a dietitian. We give no weight-loss advice.",
      ru: "Направление к диетологу. Мы не даём рекомендаций по снижению веса.",
    },
    evaluate: ({ answers }) => {
      // The suppression matters as much as the referral: every other weight
      // rule below has to stay silent here, and they do because they are all
      // keyed to their own upper thresholds.
      const b = bmi(answers);
      if (b === null || b >= 18.5) return null;
      return { triggeredBy: "q2.weight", detail: { hy: `BMI ${b}`, en: `BMI ${b}`, ru: `BMI ${b}` } };
    },
  },
  {
    id: "NRN-RULE-ACT-002",
    source: "ESC Prevention §4.3.1.2",
    category: "lifestyle",
    urgency: "yellow",
    reason: {
      hy: "Ֆիզիկական ակտիվությունը սահմանափակ է առողջական պատճառով։",
      en: "Physical activity is limited for health reasons.",
      ru: "Физическая активность ограничена по состоянию здоровья.",
    },
    nextStep: {
      hy: "Ուղեգիր ֆիզիոթերապևտի։ Թվային նպատակ չենք սահմանում։",
      en: "A referral to a physiotherapist. We set no numeric target.",
      ru: "Направление к физиотерапевту. Мы не задаём числовую цель.",
    },
    evaluate: ({ answers }) =>
      str(answers, "q2.activity") === "limited"
        ? { triggeredBy: "q2.activity" }
        : null,
  },
  {
    id: "NRN-RULE-DIET-002",
    source: "ESC Prevention Table 8",
    category: "lifestyle",
    urgency: "yellow",
    reason: {
      hy: "Առողջ սննդակարգի ութ բաղադրիչից չորսից վեցն է առկա։",
      en: "Between four and six of the eight healthy-diet components are in place.",
      ru: "Присутствуют от четырёх до шести из восьми компонентов здорового питания.",
    },
    nextStep: {
      hy: "Երկու-երեք կոնկրետ փոփոխություն, միայն չնշված կետերից։",
      en: "Two or three specific changes, taken only from what you left unticked.",
      ru: "Два-три конкретных изменения только из тех пунктов, которые вы не отметили.",
    },
    evaluate: ({ answers }) => {
      const selected = list(answers, "q2.diet");
      if (!selected.length) return null;
      const score = selected.filter((v) => v !== "none").length;
      if (score < 4 || score > 6) return null;
      return {
        triggeredBy: "q2.diet",
        detail: { hy: `${score} / 8`, en: `${score} of 8`, ru: `${score} из 8` },
      };
    },
  },
  {
    id: "NRN-RULE-SLP-002",
    source: "ESC Prevention §3.4.9",
    category: "lifestyle",
    urgency: "yellow",
    reason: {
      hy: "Քնի տևողությունը օպտիմալից դուրս է։",
      en: "Your sleep duration is outside the optimal range.",
      ru: "Продолжительность вашего сна вне оптимального диапазона.",
    },
    nextStep: {
      hy: "Քնի հիգիենայի ծրագիր՝ 4 շաբաթ։ Օպտիմալը մոտ 7 ժամ է։",
      en: "A four-week sleep hygiene programme. Around seven hours is optimal.",
      ru: "Четырёхнедельная программа гигиены сна. Оптимальная продолжительность, около семи часов.",
    },
    evaluate: ({ answers }) => {
      const hours = num(answers, "q8.sleep_hours");
      if (hours === undefined || (hours >= 6 && hours <= 9)) return null;
      return {
        triggeredBy: "q8.sleep_hours",
        detail: { hy: `${hours} ժամ`, en: `${hours} hours`, ru: `${hours} ч` },
      };
    },
  },
  {
    id: "NRN-RULE-DM-003",
    source: "2025 ESC/EAS Table 3",
    category: "metabolic",
    urgency: "yellow",
    reason: {
      hy: "Դիաբետի տևողությունը հայտնի չէ։",
      en: "The duration of your diabetes is not known.",
      ru: "Длительность вашего сахарного диабета неизвестна.",
    },
    nextStep: {
      hy: "Բժիշկը պետք է վերանայի բարձր ռիսկի այս ճյուղը՝ հաշվի առնելով ավելի բարձր առաջնահերթության պայմանները։ Անհայտ տևողությամբ միջին ռիսկ պնդել հնարավոր չէ։ Վերջնական ռիսկի դասակարգումը դեռ որոշված չէ։",
      en: "A clinician should review this high-risk branch alongside any higher-priority conditions. With unknown duration, moderate risk cannot be claimed. The final risk category is not yet determined.",
      ru: "Врач должен пересмотреть эту ветвь высокого риска с учётом состояний с более высоким приоритетом. При неизвестной длительности нельзя утверждать, что риск умеренный. Окончательная категория риска ещё не определена.",
    },
    evaluate: ({ answers }) => {
      // Unknown duration cannot justify the source's moderate-risk branch.
      // This finding requests review; it does not calculate a final category.
      if (!list(answers, "q6.conditions").includes("diabetes")) return null;
      return isUnknown(answers, "q6.diabetes_years")
        ? { triggeredBy: "q6.diabetes_years" }
        : null;
    },
  },
  {
    id: "NRN-RULE-CMB-001",
    source: "2023 ESC HF",
    category: "symptom",
    urgency: "yellow",
    reason: {
      hy: "Ախտորոշված սրտի անբավարարություն։",
      en: "Diagnosed heart failure.",
      ru: "Диагностирована сердечная недостаточность.",
    },
    nextStep: {
      hy: "NT-proBNP և ԷխոԿԳ, սրտաբանի վերանայմամբ։",
      en: "NT-proBNP and an echocardiogram, with a cardiologist's review.",
      ru: "NT-proBNP и эхокардиография с проверкой кардиолога.",
    },
    evaluate: ({ answers }) =>
      list(answers, "q6.conditions").includes("heart_failure")
        ? { triggeredBy: "q6.conditions" }
        : null,
  },
  {
    id: "NRN-RULE-CMB-002",
    source: "ESC Prevention §3.4.2",
    category: "symptom",
    urgency: "yellow",
    reason: {
      hy: "Ախտորոշված առիթմիա կամ նախասրտերի ֆիբրիլյացիա։",
      en: "Diagnosed arrhythmia or atrial fibrillation.",
      ru: "Диагностирована аритмия или фибрилляция предсердий.",
    },
    nextStep: {
      hy: "ԷՍԳ, Հոլտեր և ինսուլտի ռիսկի գնահատում։",
      en: "An ECG, a Holter monitor and a stroke risk assessment.",
      ru: "ЭКГ, холтеровское мониторирование и оценка риска инсульта.",
    },
    evaluate: ({ answers }) =>
      list(answers, "q6.conditions").includes("af")
        ? { triggeredBy: "q6.conditions" }
        : null,
  },
  {
    id: "NRN-RULE-PAL-003",
    source: "ESC Prevention §3.4.2",
    category: "symptom",
    urgency: "yellow",
    reason: {
      hy: "Անկանոն սրտի ռիթմ։",
      en: "An irregular heart rhythm.",
      ru: "Нерегулярный сердечный ритм.",
    },
    nextStep: {
      hy: "ԷՍԳ և Հոլտեր 24–48 ժամ։ Նախասրտերի ֆիբրիլյացիայի կասկած։",
      en: "An ECG and a 24 to 48 hour Holter monitor. Atrial fibrillation is the question.",
      ru: "ЭКГ и холтеровское мониторирование в течение 24–48 часов. Нужно выяснить, есть ли фибрилляция предсердий.",
    },
    evaluate: ({ answers }) =>
      str(answers, "q10.rhythm") === "irregular"
        ? { triggeredBy: "q10.rhythm" }
        : null,
  },
  {
    // Decision tree Q9.1: breathlessness apart from dizziness, without known HF.
    id: "NRN-RULE-PAL-004",
    source: "2023 ESC HF",
    category: "symptom",
    urgency: "yellow",
    reason: {
      hy: "Սրտխփոցի հետ օդի պակաս՝ առանց հայտնի սրտային անբավարարության։",
      en: "Shortness of breath with palpitations, without known heart failure.",
      ru: "Нехватка воздуха при сердцебиении без известной сердечной недостаточности.",
    },
    nextStep: {
      hy: "Ձեր բժշկի հետ քննարկեք NT-proBNP-ն և էխոկարդիոգրաֆիան։",
      en: "Discuss NT-proBNP and an echocardiogram with your doctor.",
      ru: "Обсудите с вашим врачом NT-proBNP и эхокардиографию.",
    },
    evaluate: ({ answers }) =>
      str(answers, "q10.breathless") === "yes" && !list(answers, "q6.conditions").includes("heart_failure")
        ? { triggeredBy: "q10.breathless, q6.conditions" }
        : null,
  },
  {
    id: "NRN-RULE-SMK-003",
    source: "ESC Prevention §4.5.1",
    category: "lifestyle",
    urgency: "yellow",
    reason: {
      hy: "Ծխելը թողել եք 5 տարուց քիչ առաջ։",
      en: "You stopped smoking less than five years ago.",
      ru: "Вы бросили курить менее пяти лет назад.",
    },
    nextStep: {
      hy: "Ձեր ռիսկը դեռ իջնում է։ Վերադարձի կանխարգելման աջակցություն։",
      en: "Your risk is still falling. Support for staying stopped.",
      ru: "Ваш риск продолжает снижаться. Поддержка для сохранения отказа от курения.",
    },
    evaluate: ({ answers }) => {
      if (str(answers, "q3.status") !== "former") return null;
      const quit = num(answers, "q3.quit_years_ago");
      if (quit === undefined || quit >= 5) return null;
      return {
        triggeredBy: "q3.quit_years_ago",
        detail: { hy: `${quit} տարի առաջ`, en: `${quit} years ago`, ru: `${quit} лет назад` },
      };
    },
  },
  {
    id: "NRN-RULE-PAL-002",
    source: "NOREON",
    category: "symptom",
    urgency: "yellow",
    reason: {
      hy: "Սրտի ռիթմի դրվագներ՝ առանց ուղեկցող վտանգի նշանների։",
      en: "Rhythm episodes, with no accompanying warning signs.",
      ru: "Приступы нарушения ритма без сопутствующих тревожных признаков.",
    },
    nextStep: {
      hy: "ԷՍԳ և բժշկի վերանայում։ Անկանոն ռիթմի դեպքում՝ Հոլտեր 24–48 ժամ։",
      en: "An ECG and a clinician's review. If the rhythm is irregular, a 24 to 48 hour Holter monitor.",
      ru: "ЭКГ и проверка врача. При нерегулярном ритме, холтеровское мониторирование в течение 24–48 часов.",
    },
    evaluate: ({ answers, episode }) => {
      const symptoms = str(answers, "q10.symptoms");
      if (symptoms === "palpitations_only") {
        return { triggeredBy: "q10.symptoms" };
      }
      if (symptoms === "yes" && str(answers, "q10.right_now") === "no") {
        return { triggeredBy: "q10.right_now" };
      }
      if (episode && episode.presentNow === false) {
        return { triggeredBy: "episode.presentNow" };
      }
      return null;
    },
  },
];

// ---------------------------------------------------------------------------
// Reassuring findings. Not risk, but the summary has to name them explicitly:
// an absent red flag is information, and leaving it unsaid reads as an omission.
// ---------------------------------------------------------------------------

const REASSURING_RULES: Rule[] = [
  {
    // Not reassurance that a little is good for you. The source is explicit
    // that «protective» and «safe dose» are not phrases this product uses, so
    // the message is that less is better and nothing more.
    id: "NRN-RULE-ALC-001",
    source: "ESC Prevention §4.3.2.4.5",
    category: "reassuring",
    urgency: "green",
    reason: {
      hy: "Ալկոհոլի օգտագործումը սկրինինգային շեմից ցածր է։",
      en: "Alcohol use is below the screening cut-off.",
      ru: "Употребление алкоголя ниже порогового значения скрининга.",
    },
    nextStep: {
      hy: "Առողջության համար որքան քիչ, այնքան լավ։",
      en: "For your health, the less the better.",
      ru: "Для вашего здоровья, чем меньше, тем лучше.",
    },
    evaluate: ({ answers }) => {
      const band = auditCBand(answers);
      if (band?.code !== "LOW") return null;
      return {
        triggeredBy: "q4.frequency",
        detail: { hy: `${band.value} / 12`, en: `${band.value} of 12`, ru: `${band.value} из 12` },
      };
    },
  },
  {
    id: "NRN-RULE-OK-008",
    source: "2024 ESC HTN §8.2.4",
    category: "reassuring",
    urgency: "green",
    reason: {
      hy: "Ալկոհոլ չեք օգտագործում։",
      en: "You do not drink alcohol.",
      ru: "Вы не употребляете алкоголь.",
    },
    nextStep: {
      hy: "Ալկոհոլ սկսել խորհուրդ չենք տալիս։",
      en: "We do not suggest starting.",
      ru: "Мы не рекомендуем начинать.",
    },
    evaluate: ({ answers }) =>
      str(answers, "q4.frequency") === "never" && auditCScore(answers) === 0
        ? { triggeredBy: "q4.frequency" }
        : null,
  },
  {
    id: "NRN-RULE-OK-001",
    category: "reassuring",
    urgency: "green",
    reason: { hy: "Կրծքավանդակի ցավ չկա։", en: "No chest pain.", ru: "Боли в груди нет." },
    evaluate: ({ answers }) =>
      str(answers, "q9.present") === "no" ? { triggeredBy: "q9.present" } : null,
  },
  {
    id: "NRN-RULE-OK-002",
    category: "reassuring",
    urgency: "green",
    reason: {
      hy: "Սրտխփոց, գլխապտույտ և ուշագնացություն չկան։",
      en: "No palpitations, dizziness or fainting.",
      ru: "Нет ощущения сильного или учащённого сердцебиения, головокружения или обмороков.",
    },
    evaluate: ({ answers }) =>
      str(answers, "q10.symptoms") === "no" ? { triggeredBy: "q10.symptoms" } : null,
  },
  {
    id: "NRN-RULE-OK-003",
    category: "reassuring",
    urgency: "green",
    reason: {
      hy: "Ախտորոշված քրոնիկ հիվանդություն չկա։",
      en: "No diagnosed chronic disease.",
      ru: "Нет диагностированных хронических заболеваний.",
    },
    evaluate: ({ answers }) =>
      list(answers, "q6.conditions").includes("none")
        ? { triggeredBy: "q6.conditions" }
        : null,
  },
  {
    id: "NRN-RULE-OK-004",
    category: "reassuring",
    urgency: "green",
    reason: { hy: "Քունը բավարար է և վերականգնող։", en: "Sleep is adequate and restorative.", ru: "Сон достаточный и восстанавливающий." },
    evaluate: ({ answers }) => {
      const hours = num(answers, "q8.sleep_hours");
      const quality = num(answers, "q8.sleep_quality");
      return hours !== undefined && hours >= 7 && quality !== undefined && quality >= 7
        ? { triggeredBy: "q8.sleep_quality" }
        : null;
    },
  },
  {
    id: "NRN-RULE-OK-005",
    category: "reassuring",
    urgency: "green",
    reason: {
      hy: "Առողջ սննդակարգի ութ բաղադրիչից յոթը և ավելին առկա է։",
      en: "Seven or more of the eight healthy-diet components are in place.",
      ru: "Присутствуют семь или более из восьми компонентов здорового питания.",
    },
    evaluate: ({ answers }) => {
      const score = list(answers, "q2.diet").filter((v) => v !== "none").length;
      return score >= 7 ? { triggeredBy: "q2.diet" } : null;
    },
  },
  {
    id: "NRN-RULE-OK-006",
    source: "ESC Prevention §4.5.1",
    category: "reassuring",
    urgency: "green",
    reason: {
      hy: "Ծխելը թողել եք 5 տարուց ավելի առաջ։",
      en: "You stopped smoking more than five years ago.",
      ru: "Вы бросили курить более пяти лет назад.",
    },
    nextStep: {
      hy: "Ռիսկը հաշվարկվում է որպես չծխողի։",
      en: "Your risk is calculated as a non-smoker's.",
      ru: "Ваш риск рассчитывается как для некурящего человека.",
    },
    evaluate: ({ answers }) => {
      if (str(answers, "q3.status") !== "former") return null;
      const quit = num(answers, "q3.quit_years_ago");
      return quit !== undefined && quit >= 5
        ? { triggeredBy: "q3.quit_years_ago" }
        : null;
    },
  },
  {
    id: "NRN-RULE-OK-007",
    source: "NOREON",
    category: "reassuring",
    urgency: "green",
    reason: {
      hy: "Ուշագնացությունը վազովագալ բնույթի է։",
      en: "The fainting was vasovagal.",
      ru: "Обморок был вазовагальным.",
    },
    nextStep: {
      hy: "Երկար կանգնելուց, արյան տեսքից կամ ցավից հետո ուշագնացությունը սրտային ծագում չունի։",
      en: "Fainting after long standing, at the sight of blood or from pain is not cardiac in origin.",
      ru: "Обморок после длительного стояния, при виде крови или от боли не имеет сердечного происхождения.",
    },
    evaluate: ({ answers }) =>
      str(answers, "q10.syncope") === "vasovagal"
        ? { triggeredBy: "q10.syncope" }
        : null,
  },
];

// ---------------------------------------------------------------------------
// Missing data. Its own category, because the summary has a third group for it
// and the risk percentage depends on it.
// ---------------------------------------------------------------------------

const MISSING_DATA_RULES: Rule[] = [
  {
    id: "NRN-RULE-DM-004",
    source: "ESC Prevention §4.8 · decision tree v1.1",
    category: "missing-data",
    urgency: "green",
    reason: {
      hy: "Դիաբետի դեպքում HbA1c-ն հայտնի չէ։",
      en: "Your HbA1c is not known with diabetes.",
      ru: "При сахарном диабете ваш HbA1c неизвестен.",
    },
    nextStep: {
      hy: "Ուղեգիր՝ HbA1c-ի համար։ HbA1c-ն ծոմ չի պահանջում։",
      en: "Arrange an HbA1c test. HbA1c does not require fasting.",
      ru: "Организуйте анализ на HbA1c. Для HbA1c не требуется сдача натощак.",
    },
    evaluate: ({ answers }) =>
      list(answers, "q6.conditions").includes("diabetes") && isUnknown(answers, "q6.hba1c")
        ? { triggeredBy: "q6.hba1c" }
        : null,
  },
  {
    id: "NRN-RULE-MISS-001",
    source: "2025 ESC/EAS",
    category: "missing-data",
    urgency: "green",
    reason: {
      hy: "Լիպիդային անալիզի արդյունքները բացակայում են։",
      en: "Lipid results are missing.",
      ru: "Результаты липидных анализов отсутствуют.",
    },
    nextStep: {
      hy: "Առանց դրանց սրտանոթային ռիսկի տոկոսը ցուցադրվել չի կարող, իսկ մոտավոր տոկոսը վնասակար է։",
      en: "Without them the cardiovascular risk percentage cannot be shown, and an approximate figure would do harm.",
      ru: "Без них нельзя показать процент сердечно-сосудистого риска, а приблизительная цифра причинит вред.",
    },
    evaluate: ({ observations }) =>
      observations.some((o) => o.testId === "lipid-panel")
        ? null
        : { triggeredBy: "observations.lipid-panel" },
  },
  {
    id: "NRN-RULE-MISS-002",
    category: "missing-data",
    urgency: "green",
    reason: {
      hy: "Գլյուկոզայի հետ կապված արդյունքները բացակայում են։",
      en: "Glucose-related results are missing.",
      ru: "Результаты, связанные с глюкозой, отсутствуют.",
    },
    evaluate: ({ observations }) =>
      observations.some((o) => o.testId === "hba1c-glucose")
        ? null
        : { triggeredBy: "observations.hba1c-glucose" },
  },
];

export const ALL_RULES: Rule[] = [
  ...FLAG_RULES,
  ...RISK_RULES,
  ...REASSURING_RULES,
  ...MISSING_DATA_RULES,
];

/** The twelve registry flags, for the screens that show the registry itself. */
export const RED_FLAG_REGISTRY = FLAG_RULES;

export function ruleById(id: string): Rule | undefined {
  return ALL_RULES.find((r) => r.id === id);
}

/**
 * The rule that opens the urgent route, if any.
 *
 * Red only. An orange flag sets a consultation window measured in days and the
 * person stays in the product; freezing the app for it would be wrong, and
 * would also teach presenters that the emergency screen is routine.
 */
export function firesEmergency(ctx: RuleContext): Rule | undefined {
  return FLAG_RULES.filter((r) => r.urgency === "red").find(
    (r) => r.evaluate(ctx) !== null,
  );
}
