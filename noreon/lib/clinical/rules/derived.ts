import { THRESHOLD } from "@/lib/clinical/rules/thresholds";
import { UNKNOWN } from "@/lib/clinical/types";
import type { Answers, FieldValue, Localized, Urgency } from "@/lib/clinical/types";

/**
 * Derived clinical metrics.
 *
 * Everything here is a pure function of the answers, transcribed from the
 * simulator in `docs/clinical/`. They sit apart from the rules because two
 * different consumers need them: the rules, which turn them into findings, and
 * the screens, which show the working. A metric computed twice is a metric that
 * will eventually disagree with itself.
 *
 * Every function returns `null` rather than a default when its inputs are
 * missing. A missing answer is not a normal answer, and a metric that quietly
 * substitutes zero would erase that distinction on its way to the rules.
 */

export type MetricBand = {
  /** Machine-readable classification, e.g. `OBESITY`. */
  code: string;
  label: Localized;
  /** How the band should read on screen, using the four triage colours. */
  tone: Urgency;
  /** The number itself, when the metric has one. */
  value?: number;
  unit?: Localized;
};

function value(answers: Answers, id: string): FieldValue | undefined {
  return answers[id]?.value;
}

function num(answers: Answers, id: string): number | undefined {
  const v = value(answers, id);
  return typeof v === "number" ? v : undefined;
}

function str(answers: Answers, id: string): string | undefined {
  const v = value(answers, id);
  return typeof v === "string" ? v : undefined;
}

function list(answers: Answers, id: string): string[] {
  const v = value(answers, id);
  return Array.isArray(v) ? v : [];
}

/** One decimal place, without floating-point noise in the last digit. */
function round1(n: number): number {
  return Math.round(n * 10 + Number.EPSILON) / 10;
}

// ---------------------------------------------------------------------------
// Anthropometry
// ---------------------------------------------------------------------------

export function bmi(answers: Answers): number | null {
  const height = num(answers, "q2.height");
  const weight = num(answers, "q2.weight");
  if (!height || !weight) return null;
  const metres = height / 100;
  return round1(weight / (metres * metres));
}

export function bmiBand(answers: Answers): MetricBand | null {
  const b = bmi(answers);
  if (b === null) return null;
  const band = (code: string, label: Localized, tone: Urgency): MetricBand => ({
    code,
    label,
    tone,
    value: b,
  });

  // Underweight is not green: it takes the person off the weight-loss path
  // entirely and sends them to a dietitian instead.
  if (b < 18.5) {
    return band(
      "UNDERWEIGHT",
      { hy: "Թերքաշ", en: "Underweight", ru: "Недостаточная масса тела" },
      "yellow",
    );
  }
  if (b < 25) {
    return band("NORMAL", { hy: "Նորմա", en: "Normal", ru: "Норма" }, "green");
  }
  if (b < 30) {
    return band(
      "OVERWEIGHT",
      { hy: "Ավելորդ քաշ, այլևս քաշ չհավաքել", en: "Overweight, no further gain", ru: "Избыточная масса тела, не набирайте вес дальше" },
      "yellow",
    );
  }
  return band(
    "OBESITY",
    { hy: "Ճարպակալում, քաշը պետք է իջեցնել", en: "Obesity, weight reduction advised", ru: "Ожирение, рекомендуется снизить вес" },
    "orange",
  );
}

/**
 * Waist thresholds, which fire independently of BMI.
 *
 * Someone with a normal BMI and a waist over the limit still needs the weight
 * advice, which is why this is not folded into `bmiBand`.
 */
export function waistBand(answers: Answers): MetricBand | null {
  const waist = num(answers, "q2.waist");
  const sex = str(answers, "q1.sex");
  if (waist === undefined || !sex) return null;
  const male = sex === "male";

  if (waist >= (male ? THRESHOLD.waistMale : THRESHOLD.waistFemale)) {
    return {
      code: "REDUCTION_ADVISED",
      label: { hy: "Քաշը պետք է իջեցնել", en: "Weight reduction advised", ru: "Рекомендуется снизить вес" },
      tone: "orange",
      value: waist,
      unit: { hy: "սմ", en: "cm", ru: "см" },
    };
  }
  if (waist >= (male ? THRESHOLD.waistMaleNoFurtherGain : THRESHOLD.waistFemaleNoFurtherGain)) {
    return {
      code: "NO_FURTHER_GAIN",
      label: { hy: "Այլևս քաշ չհավաքել", en: "No further weight gain", ru: "Не набирайте вес дальше" },
      tone: "yellow",
      value: waist,
      unit: { hy: "սմ", en: "cm", ru: "см" },
    };
  }
  return {
    code: "NORMAL",
    label: { hy: "Նորմա", en: "Normal", ru: "Норма" },
    tone: "green",
    value: waist,
    unit: { hy: "սմ", en: "cm", ru: "см" },
  };
}

// ---------------------------------------------------------------------------
// Smoking
// ---------------------------------------------------------------------------

/** Unrounded exposure for source-boundary comparisons. One pack is 20 cigarettes. */
export function rawPackYears(answers: Answers): number | null {
  const perDay = num(answers, "q3.per_day");
  const years = num(answers, "q3.years");
  if (perDay === undefined || years === undefined) return null;
  return (perDay / 20) * years;
}

/** Pack-years rounded to one decimal for display, never for a rule boundary. */
export function packYears(answers: Answers): number | null {
  const raw = rawPackYears(answers);
  return raw === null ? null : round1(raw);
}

// ---------------------------------------------------------------------------
// Blood pressure
// ---------------------------------------------------------------------------

/**
 * The five measured bands.
 *
 * The elevated band starts at 135 systolic or 85 diastolic, below grade 1
 * (Armen, team group message 588, 2 Nov), overriding the vendored Q5.2 cut.
 * This function reports the category and says nothing about treatment.
 */
export function bloodPressureBand(answers: Answers): MetricBand | null {
  const systolic = num(answers, "q5.last_reading.systolic");
  const diastolic = num(answers, "q5.last_reading.diastolic");
  if (systolic === undefined || diastolic === undefined) return null;

  const reading = `${systolic}/${diastolic}`;
  const band = (code: string, label: Localized, tone: Urgency): MetricBand => ({
    code,
    label,
    tone,
    value: systolic,
    unit: { hy: reading, en: reading, ru: reading },
  });

  if (systolic >= THRESHOLD.crisisSystolic || diastolic >= THRESHOLD.crisisDiastolic) {
    return band("CRISIS", { hy: "180/110 և բարձր", en: "180/110 and above", ru: "180/110 и выше" }, "red");
  }
  if (systolic >= THRESHOLD.grade2Systolic || diastolic >= THRESHOLD.grade2Diastolic) {
    // Yellow, not orange (Armen, team group message 588, 2 Nov).
    return band("GRADE_2", { hy: "160–179 / 100–109", en: "160–179 / 100–109", ru: "160–179 / 100–109" }, "yellow");
  }
  if (systolic >= THRESHOLD.grade1Systolic || diastolic >= THRESHOLD.grade1Diastolic) {
    return band("GRADE_1", { hy: "140–159 / 90–99", en: "140–159 / 90–99", ru: "140–159 / 90–99" }, "yellow");
  }
  if (systolic >= THRESHOLD.elevatedSystolic || diastolic >= THRESHOLD.elevatedDiastolic) {
    return band("ELEVATED", { hy: "Բարձրացած", en: "Elevated", ru: "Повышенное" }, "yellow");
  }
  return band("NON_ELEVATED", { hy: "Ոչ բարձրացած", en: "Not elevated", ru: "Не повышено" }, "green");
}

// ---------------------------------------------------------------------------
// Physical activity
// ---------------------------------------------------------------------------

/**
 * Weekly activity against the 150-minute target.
 *
 * Vigorous minutes count double, so the comparison is made in moderate-intensity
 * equivalent minutes rather than in raw minutes.
 */
export function activityBand(answers: Answers): MetricBand | null {
  const activity = str(answers, "q2.activity");
  if (activity === "limited") {
    return {
      code: "MEDICALLY_LIMITED",
      label: {
        hy: "Առողջական սահմանափակում, թվային նպատակ չենք դնում",
        en: "Medically limited, we set no numeric target",
        ru: "Есть ограничения по здоровью, числовую цель не ставим",
      },
      tone: "yellow",
    };
  }
  if (activity === "sedentary") {
    return {
      code: "BELOW_TARGET",
      label: { hy: "Նստակյաց", en: "Sedentary", ru: "Малоподвижный образ жизни" },
      tone: "yellow",
    };
  }

  const minutes = num(answers, "q2.activity_minutes");
  if (minutes === undefined) return null;
  const equivalent =
    minutes * (str(answers, "q2.activity_intensity") === "vigorous" ? 2 : 1);

  if (equivalent >= THRESHOLD.activityMinutes) {
    return {
      code: "MEETS_TARGET",
      label: { hy: "Նորմայի սահմաններում", en: "Meets the target", ru: "Цель достигнута" },
      tone: "green",
      value: equivalent,
      unit: { hy: "րոպե", en: "min", ru: "мин" },
    };
  }
  if (equivalent >= THRESHOLD.activityHalfMinutes) {
    return {
      code: "PARTIAL",
      label: { hy: "Կես ճանապարհին", en: "Halfway there", ru: "На полпути к цели" },
      tone: "yellow",
      value: equivalent,
      unit: { hy: "րոպե", en: "min", ru: "мин" },
    };
  }
  return {
    code: "BELOW_TARGET",
    label: { hy: "Նորմայից ցածր", en: "Below the target", ru: "Ниже целевого уровня" },
    tone: "yellow",
    value: equivalent,
    unit: { hy: "րոպե", en: "min", ru: "мин" },
  };
}

// ---------------------------------------------------------------------------
// Diet
// ---------------------------------------------------------------------------

/**
 * How many of the eight healthy-diet components are in place.
 *
 * Eight, not nine: version 1.1 of the source moved alcohol out of this
 * checklist and into a question of its own, because a single tick cannot carry
 * both how often someone drinks and how much.
 */
export function dietScore(answers: Answers): number | null {
  const selected = list(answers, "q2.diet");
  if (!selected.length) return null;
  return selected.filter((v) => v !== "none").length;
}

export function dietBand(answers: Answers): MetricBand | null {
  const score = dietScore(answers);
  if (score === null) return null;
  const band = (code: string, label: Localized, tone: Urgency): MetricBand => ({
    code,
    label,
    tone,
    value: score,
    unit: { hy: "/ 8", en: "/ 8", ru: "/ 8" },
  });

  if (score >= 7) {
    return band("GOOD", { hy: "Շարունակեք նույն ձևով", en: "Keep going the same way", ru: "Продолжайте в том же духе" }, "green");
  }
  if (score >= 4) {
    return band("PARTIAL", { hy: "2–3 կոնկրետ փոփոխություն", en: "Two or three specific changes", ru: "Два или три конкретных изменения" }, "yellow");
  }
  return band("POOR", { hy: "Ամբողջական սննդակարգի ծրագիր", en: "A full nutrition plan", ru: "Полный план питания" }, "yellow");
}

// ---------------------------------------------------------------------------
// Alcohol
//
// Two readings of the same three answers, because the two source documents ask
// for two different things and neither subsumes the other. The questionnaire
// wants AUDIT-C, which is a screen for harmful use and has sex-specific
// cut-offs. The decision tree wants grams of ethanol a week, which is a
// cardiovascular exposure and carries the same 100 g limit for everyone.
// ---------------------------------------------------------------------------

const AUDIT_C_FREQUENCY: Record<string, number> = {
  never: 0,
  monthly_or_less: 1,
  two_to_four_month: 2,
  two_to_three_week: 3,
  four_plus_week: 4,
};

const AUDIT_C_QUANTITY: Record<string, number> = {
  one_two: 0,
  three_four: 1,
  five_six: 2,
  seven_nine: 3,
  ten_plus: 4,
};

const AUDIT_C_BINGE: Record<string, number> = {
  never: 0,
  less_than_monthly: 1,
  monthly: 2,
  weekly: 3,
  daily: 4,
};

/**
 * The AUDIT-C total, 0 to 12.
 *
 * `null` while any of the three items is missing or was answered «I don't
 * remember». A partial AUDIT-C scored as though the blanks were zeroes would
 * read as abstinence, which is the one thing it must never do.
 */
export function auditCScore(answers: Answers): number | null {
  const frequency = str(answers, "q4.frequency");
  if (frequency === undefined) return null;
  const first = AUDIT_C_FREQUENCY[frequency];
  if (first === undefined) return null;
  if (frequency === "never") return 0;

  const quantity = AUDIT_C_QUANTITY[str(answers, "q4.drinks_per_day") ?? ""];
  const binge = AUDIT_C_BINGE[str(answers, "q4.binge") ?? ""];
  if (quantity === undefined || binge === undefined) return null;
  return first + quantity + binge;
}

/** True when six or more drinks on one occasion happen weekly or more often. */
export function bingesWeekly(answers: Answers): boolean {
  const binge = str(answers, "q4.binge");
  return binge === "weekly" || binge === "daily";
}

export function auditCBand(answers: Answers): MetricBand | null {
  const score = auditCScore(answers);
  const frequency = str(answers, "q4.frequency");
  // A stated weekly binge needs the priority assessment even when "I don't remember" leaves no total.
  const binge = bingesWeekly(answers) && frequency !== undefined && frequency !== "never";
  if (score === null && !binge) return null;
  const sex = str(answers, "q1.sex");
  if (!sex) return null;
  const band = (code: string, label: Localized, tone: Urgency): MetricBand => ({
    code,
    label,
    tone,
    ...(score === null ? {} : { value: score, unit: { hy: "/ 12", en: "/ 12", ru: "/ 12" } }),
  });

  // The binge item outranks the total. Someone who drinks six or more on one
  // occasion every week needs the priority assessment even if their total sits
  // below the cut-off, which it can.
  if (binge) {
    return band(
      "PRIORITY",
      {
        hy: "Առաջնահերթ գնահատում՝ վնասակար օգտագործման համար",
        en: "Priority assessment for harmful use",
        ru: "Первоочередная оценка на предмет вредного употребления алкоголя",
      },
      "orange",
    );
  }
  if (score === null) return null;
  if (score >= (sex === "male" ? 4 : 3)) {
    return band(
      "POSITIVE",
      {
        hy: "Դրական սկրինինգ։ Առաջարկվում է ամբողջական AUDIT",
        en: "A positive screen. A full AUDIT is suggested",
        ru: "Положительный результат скрининга. Рекомендуется пройти полный опросник AUDIT",
      },
      "yellow",
    );
  }
  if (score >= 1) {
    return band(
      "LOW",
      { hy: "Որքան քիչ, այնքան լավ", en: "The less, the better", ru: "Чем меньше, тем лучше" },
      "green",
    );
  }
  return band(
    "NONE",
    { hy: "Ալկոհոլ չի օգտագործում", en: "Does not drink", ru: "Вы не употребляете алкоголь" },
    "green",
  );
}

/** Ethanol by volume for the drink someone names, as a fraction. */
const DRINK_STRENGTH: Record<string, number> = {
  beer: 0.05,
  wine: 0.12,
  spirits: 0.4,
  mixed: 0.12,
};

/** Density of ethanol, g/ml. Turns a volume of drink into a mass of alcohol. */
const ETHANOL_DENSITY = 0.789;

/**
 * The weekly ceiling, in grams of pure alcohol.
 *
 * The same number for women and men, which the source states explicitly. It
 * lives here rather than in `THRESHOLD` because `rules.ts` reads this file and
 * not the other way round, and one copy is the whole point.
 */
export const ALCOHOL_WEEKLY_LIMIT_GRAMS = 100;

/** Grams of pure alcohol in a standard drink, when nothing better is known. */
const STANDARD_DRINK_GRAMS = 10;

/** Drinking occasions in a week, from the AUDIT-C frequency band's midpoint. */
const OCCASIONS_PER_WEEK: Record<string, number> = {
  never: 0,
  monthly_or_less: 0.25,
  two_to_four_month: 0.7,
  two_to_three_week: 2.5,
  four_plus_week: 5,
};

/** Standard drinks in one occasion, from that band's midpoint. */
const DRINKS_PER_OCCASION: Record<string, number> = {
  one_two: 1.5,
  three_four: 3.5,
  five_six: 5.5,
  seven_nine: 8,
  ten_plus: 11,
};

/**
 * Grams of pure alcohol a week.
 *
 * A named drink and a volume beat a count of standard drinks, because a
 * standard drink is 8 to 14 g depending on the country and a glass poured at
 * home is not a measure at all. When neither is available the answer is `null`
 * and the assessment stays open, which is the gate the source asks for.
 */
export function alcoholGramsPerWeek(answers: Answers): number | null {
  const frequency = str(answers, "q4.frequency");
  if (frequency === undefined) return null;
  const occasions = OCCASIONS_PER_WEEK[frequency];
  if (occasions === undefined) return null;
  if (frequency === "never") return 0;

  const volume = num(answers, "q4.volume_ml");
  const strength = DRINK_STRENGTH[str(answers, "q4.drink_type") ?? ""];
  const drinks = DRINKS_PER_OCCASION[str(answers, "q4.drinks_per_day") ?? ""];

  let gramsPerOccasion: number;
  if (volume !== undefined && strength !== undefined) {
    gramsPerOccasion = volume * strength * ETHANOL_DENSITY;
  } else if (drinks !== undefined) {
    gramsPerOccasion = drinks * STANDARD_DRINK_GRAMS;
  } else {
    return null;
  }

  return round1(occasions * gramsPerOccasion);
}

export function alcoholBand(answers: Answers): MetricBand | null {
  const grams = alcoholGramsPerWeek(answers);

  // Someone who said they drink but could not put a number on it is not a
  // non-drinker. The band exists so the screens can say so.
  if (grams === null) {
    const frequency = str(answers, "q4.frequency");
    if (frequency === undefined || frequency === "never") return null;
    return {
      code: "UNKNOWN",
      label: {
        hy: "Քանակը դեռ պարզ չէ",
        en: "The amount is not established yet",
        ru: "Количество пока не установлено",
      },
      tone: "yellow",
    };
  }

  const band = (code: string, label: Localized, tone: Urgency): MetricBand => ({
    code,
    label,
    tone,
    value: grams,
    unit: { hy: "գ/շաբաթ", en: "g/week", ru: "г/неделю" },
  });

  if (grams === 0) {
    return band(
      "NONE",
      { hy: "Ալկոհոլ չի օգտագործում", en: "Does not drink", ru: "Вы не употребляете алкоголь" },
      "green",
    );
  }
  if (grams <= ALCOHOL_WEEKLY_LIMIT_GRAMS) {
    return band(
      "WITHIN_LIMIT",
      { hy: "Չավելացնել օգտագործումը", en: "Do not drink more than this", ru: "Не увеличивайте количество алкоголя" },
      "green",
    );
  }
  return band(
    "ABOVE_LIMIT",
    { hy: "Նվազեցման ծրագիր", en: "A reduction plan", ru: "План сокращения употребления алкоголя" },
    "yellow",
  );
}

// ---------------------------------------------------------------------------
// Sleep-disordered breathing
// ---------------------------------------------------------------------------

export type StopBang = {
  /** Components met, out of eight. */
  score: number;
  /** True when neck circumference was not measured, so the score is a floor. */
  partial: boolean;
};

/**
 * The STOP-BANG components Noreon can already answer.
 *
 * Marked EXTERNAL in the threshold registry: it is not in the five ESC
 * guidelines and needs separate validation before production. It stays in the
 * demo because it is what turns a snoring answer into a referral decision.
 *
 * Neck circumference is the one component the questionnaire may not have. When
 * it is missing the score is reported as partial rather than as a lower number,
 * because a floor and a measurement are not the same claim.
 */
export function stopBang(answers: Answers): StopBang | null {
  const breathing = str(answers, "q8.breathing");
  if (!breathing || !["snoring", "apnoea", "both"].includes(breathing)) {
    return null;
  }

  let score = 0;
  let partial = false;

  // S — snoring
  if (breathing === "snoring" || breathing === "both") score++;
  // T — tiredness
  if (["often", "daily"].includes(str(answers, "q8.daytime_sleepiness") ?? "")) {
    score++;
  }
  // O — observed apnoea
  if (breathing === "apnoea" || breathing === "both") score++;
  // P — pressure, either treated or measured
  const systolic = num(answers, "q5.last_reading.systolic");
  const diastolic = num(answers, "q5.last_reading.diastolic");
  const raised =
    (systolic !== undefined && systolic >= THRESHOLD.grade1Systolic) ||
    (diastolic !== undefined && diastolic >= THRESHOLD.grade1Diastolic);
  if (["treated", "untreated"].includes(str(answers, "q5.diagnosed") ?? "") || raised) {
    score++;
  }
  // B — BMI over 35
  const b = bmi(answers);
  if (b !== null && b > 35) score++;
  // A — age over 50
  const age = num(answers, "q1.age");
  if (age !== undefined && age > 50) score++;
  // N — neck over 40 cm
  const neck = num(answers, "q8.neck");
  if (neck !== undefined) {
    if (neck > 40) score++;
  } else {
    partial = true;
  }
  // G — male
  if (str(answers, "q1.sex") === "male") score++;

  return { score, partial };
}

export function osaBand(answers: Answers): MetricBand | null {
  const sb = stopBang(answers);
  if (!sb) return null;
  const unit = `${sb.score}/8${sb.partial ? " *" : ""}`;
  const band = (code: string, label: Localized, tone: Urgency): MetricBand => ({
    code,
    label,
    tone,
    value: sb.score,
    unit: { hy: unit, en: unit, ru: unit },
  });

  if (sb.score >= 5) {
    return band("HIGH", { hy: "Բարձր հավանականություն", en: "High likelihood", ru: "Высокая вероятность" }, "orange");
  }
  if (sb.score >= 3) {
    return band("INTERMEDIATE", { hy: "Միջին հավանականություն", en: "Intermediate likelihood", ru: "Средняя вероятность" }, "yellow");
  }
  return band("LOW", { hy: "Ցածր հավանականություն", en: "Low likelihood", ru: "Низкая вероятность" }, "green");
}

// ---------------------------------------------------------------------------
// Which risk model applies
// ---------------------------------------------------------------------------

export type Score2State = {
  code:
    | "NOT_APPLICABLE"
    | "DIABETES_MODEL"
    | "LIFETIME_ONLY"
    | "SCORE2_OP"
    | "SCORE2"
    | "UNKNOWN";
  label: Localized;
  /** Why the percentage is not on screen yet, when it is not. */
  note: Localized;
};

/**
 * Which risk model the session runs on, and why no percentage is showing.
 *
 * Established disease is not a percentage: those people are high or very high
 * risk by classification, and running a calculator built for healthy people
 * over them produces a number that is wrong in a reassuring direction.
 */
export function score2State(answers: Answers): Score2State {
  if (value(answers, "q6.conditions") === UNKNOWN) {
    return {
      code: "UNKNOWN",
      label: { hy: "Դեռ որոշված չէ", en: "Not decided yet", ru: "Пока не определено" },
      note: {
        hy: "Հաշվարկի համար անհրաժեշտ է ճշտել ձեր ախտորոշված հիվանդությունները։",
        en: "Your diagnosed conditions need to be clarified before choosing a risk model.",
        ru: "Чтобы выбрать модель оценки риска, нужно уточнить ваши диагностированные заболевания.",
      },
    };
  }
  const conditions = list(answers, "q6.conditions");

  if (
    ["ascvd", "stroke", "heart_failure", "kidney", "familial_hypercholesterolaemia"].some(
      (c) => conditions.includes(c),
    )
  ) {
    return {
      code: "NOT_APPLICABLE",
      label: { hy: "Ուղղակի դասակարգում", en: "Direct classification", ru: "Прямая классификация" },
      note: {
        hy: "Հաշվիչը նախատեսված է առողջ մարդկանց համար։ Ձեր դեպքում ռիսկը որոշվում է ախտորոշմամբ, ոչ թե տոկոսով։",
        en: "The calculator is built for people without established disease. Here the risk comes from the diagnosis, not from a percentage.",
        ru: "Калькулятор предназначен для людей без установленного заболевания. В вашем случае риск определяется диагнозом, а не процентом.",
      },
    };
  }

  if (conditions.includes("diabetes")) {
    return {
      code: "DIABETES_MODEL",
      label: { hy: "Դիաբետի մոդել", en: "Diabetes model", ru: "Модель для сахарного диабета" },
      note: {
        hy: "Հաշվարկը սպասում է ձեր լիպիդային արդյունքներին։",
        en: "The calculation is waiting on your lipid results.",
        ru: "Для расчёта нужны результаты вашего анализа на липиды.",
      },
    };
  }

  const age = num(answers, "q1.age");
  if (age === undefined) {
    return {
      code: "UNKNOWN",
      label: { hy: "Դեռ որոշված չէ", en: "Not decided yet", ru: "Пока не определено" },
      note: { hy: "Տարիքը դեռ նշված չէ։", en: "Age has not been given yet.", ru: "Вы ещё не указали возраст." },
    };
  }

  if (age < 40) {
    return {
      code: "LIFETIME_ONLY",
      label: { hy: "Ամբողջ կյանքի ռիսկ", en: "Lifetime risk", ru: "Пожизненный риск" },
      note: {
        hy: "40 տարեկանից ցածր տոկոսը թաքցվում է. երիտասարդի ցածր 10-ամյա տոկոսը ապակողմնորոշիչ է։",
        en: "Under 40 the percentage stays hidden. A young person's low ten-year figure is misleading.",
        ru: "До 40 лет процент не показывается. Низкий показатель риска на десять лет у молодого человека может ввести в заблуждение.",
      },
    };
  }

  if (age >= 70) {
    return {
      code: "SCORE2_OP",
      label: { hy: "Տարեցների հաշվարկ", en: "Older-persons model", ru: "Модель для пожилых людей" },
      note: {
        hy: "Հաշվարկը սպասում է ձեր լիպիդային արդյունքներին։",
        en: "The calculation is waiting on your lipid results.",
        ru: "Для расчёта нужны результаты вашего анализа на липиды.",
      },
    };
  }

  return {
    code: "SCORE2",
    label: { hy: "10-ամյա ռիսկի հաշվարկ", en: "Ten-year risk model", ru: "Модель десятилетнего риска" },
    note: {
      hy: "Հաշվարկը սպասում է ձեր լիպիդային արդյունքներին։",
      en: "The calculation is waiting on your lipid results.",
      ru: "Для расчёта нужны результаты вашего анализа на липиды.",
    },
  };
}

// ---------------------------------------------------------------------------
// Risk modifiers
// ---------------------------------------------------------------------------

/**
 * Factors that shift the estimate without being part of the calculation.
 *
 * They go on the clinician's card rather than into a number, which is what the
 * source document means by a modifier.
 */
export function modifiers(answers: Answers): Localized[] {
  const found: Localized[] = [];
  const conditions = list(answers, "q6.conditions");

  if (["male_under_55", "female_under_65"].includes(str(answers, "q7.relative_age") ?? "")) {
    found.push({ hy: "Վաղաժամ սրտանոթային դեպք ընտանիքում", en: "A premature cardiovascular event in the family", ru: "Раннее сердечно-сосудистое событие в семье" });
  }
  if (["often", "always"].includes(str(answers, "q8.stress") ?? "")) {
    found.push({ hy: "Հոգեսոցիալական սթրես", en: "Psychosocial stress", ru: "Психосоциальный стресс" });
  }

  const waist = waistBand(answers);
  const b = bmi(answers);
  if (waist?.code === "REDUCTION_ADVISED" || (b !== null && b >= THRESHOLD.obesityBmi)) {
    found.push({ hy: "Աբդոմինալ ճարպակալում", en: "Abdominal obesity", ru: "Абдоминальное ожирение" });
  }
  if (str(answers, "q2.activity") === "sedentary") {
    found.push({ hy: "Նստակյաց ապրելակերպ", en: "A sedentary lifestyle", ru: "Малоподвижный образ жизни" });
  }
  if (osaBand(answers)?.code === "HIGH") {
    found.push({ hy: "Քնային ապնոէի բարձր կասկած", en: "High suspicion of sleep apnoea", ru: "Высокая вероятность апноэ сна" });
  }
  if (conditions.includes("inflammatory")) {
    found.push({ hy: "Բորբոքային հիվանդություն", en: "An inflammatory condition", ru: "Воспалительное заболевание" });
  }
  if (conditions.includes("mental_health")) {
    found.push({ hy: "Հոգեկան առողջության խնդիր", en: "A mental health condition", ru: "Психическое расстройство" });
  }
  if (conditions.includes("fatty_liver")) {
    found.push({ hy: "Ճարպակալված լյարդ", en: "Fatty liver disease", ru: "Жировая болезнь печени" });
  }
  if (conditions.includes("af")) {
    found.push({ hy: "Նախասրտերի ֆիբրիլյացիա", en: "Atrial fibrillation", ru: "Фибрилляция предсердий" });
  }
  return found;
}

// ---------------------------------------------------------------------------
// The whole picture, for the screens that show the working
// ---------------------------------------------------------------------------

export type DerivedMetric = {
  key: string;
  label: Localized;
  band: MetricBand;
};

/**
 * Every metric the current answers support, in the order the questionnaire
 * produces them. Metrics whose inputs are still missing are absent rather than
 * present and empty, so a screen can render the list directly.
 */
export function derivedMetrics(answers: Answers): DerivedMetric[] {
  const metrics: DerivedMetric[] = [];
  const push = (key: string, label: Localized, band: MetricBand | null) => {
    if (band) metrics.push({ key, label, band });
  };

  push("bmi", { hy: "BMI", en: "BMI", ru: "ИМТ" }, bmiBand(answers));
  push("waist", { hy: "Գոտկատեղ", en: "Waist", ru: "Окружность талии" }, waistBand(answers));
  push("bp", { hy: "Ճնշում", en: "Blood pressure", ru: "Артериальное давление" }, bloodPressureBand(answers));
  push("activity", { hy: "Ակտիվություն", en: "Activity", ru: "Физическая активность" }, activityBand(answers));
  push("diet", { hy: "Սննդակարգ", en: "Diet", ru: "Питание" }, dietBand(answers));
  push("alcohol", { hy: "Ալկոհոլ", en: "Alcohol", ru: "Алкоголь" }, alcoholBand(answers));
  push("audit-c", { hy: "AUDIT-C", en: "AUDIT-C", ru: "AUDIT-C" }, auditCBand(answers));
  push("osa", { hy: "STOP-BANG", en: "STOP-BANG", ru: "STOP-BANG" }, osaBand(answers));

  // The band compares the raw exposure, as NRN-RULE-SMK-002 does; the rounded
  // value is for display only, so 19.95 shows "20.0" but is not flagged.
  const packs = packYears(answers);
  const raw = rawPackYears(answers);
  if (packs !== null && raw !== null) {
    const heavy = raw >= THRESHOLD.heavySmokingPackYears;
    metrics.push({
      key: "pack-years",
      label: { hy: "Տուփ-տարի", en: "Pack-years", ru: "Пачка-лет" },
      band: {
        code: heavy ? "HIGH" : "RECORDED",
        label: heavy
          ? { hy: "20-ից ավելի, բժշկին առանձին նշում", en: "Over 20, flagged for the clinician", ru: "Более 20, отмечено для врача" }
          : { hy: "Գրանցված է", en: "Recorded", ru: "Записано" },
        tone: heavy ? "yellow" : "green",
        value: packs,
      },
    });
  }

  return metrics;
}
