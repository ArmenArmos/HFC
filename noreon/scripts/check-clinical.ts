import { readFileSync } from "node:fs";

import {
  RED_FLAG_REGISTRY,
  THRESHOLD,
  inCrisisRange,
  phase2LdlHighReached,
  phase2TotalCholesterolHighReached,
} from "@/lib/clinical/rules/rules";
import { evaluate, needsAttention, reassuring } from "@/lib/clinical/rules/engine";
import { validateResult } from "@/lib/lab-ai/extraction";
import {
  ALCOHOL_WEEKLY_LIMIT_GRAMS,
  alcoholBand,
  alcoholGramsPerWeek,
  auditCBand,
  auditCScore,
  activityBand,
  bloodPressureBand,
  bmiBand,
  derivedMetrics,
  dietBand,
  osaBand,
  packYears,
  waistBand,
} from "@/lib/clinical/rules/derived";
import {
  CORE_QUESTIONS,
  fieldById,
  visibleFields,
} from "@/lib/clinical/seed/questions";
import {
  BRANCH_COVERAGE,
  declaredGaps,
  unknownRuleIds,
} from "@/lib/clinical/rules/branch-coverage";
import { APP_ONLY_FIELDS, SPEC_MAP, mapsForQuestion } from "@/lib/clinical/seed/spec-map";
import { TEST_CATALOGUE } from "@/lib/clinical/seed/tests";
import type { Answers, AssessmentField, FieldValue } from "@/lib/clinical/types";
import { UNKNOWN } from "@/lib/clinical/types";

/**
 * Conformance check against `docs/clinical/NRN-CLIN-ALG-001-questionnaire.json`.
 *
 * The source document is machine-readable, so "the code is a transcription of
 * the document" can be a test rather than a promise. This walks the source and
 * fails on anything the app has let drift: a missing question, a renamed
 * option, a bound that moved, a red flag whose level or citation changed.
 *
 * The branch conditions are checked by execution rather than by reading. The
 * source carries each `showWhen` as a JavaScript expression over its own answer
 * keys; this generates random sessions, evaluates the source's expression and
 * the app's `showIf` over the same session, and fails if they ever disagree.
 * Comparing the two as text would prove nothing, because they are written in
 * different vocabularies on purpose.
 */

const SPEC_PATH = "docs/clinical/NRN-CLIN-ALG-001-questionnaire.json";
const CATALOGUE_PATH = "docs/clinical/NRN-LAB-CAT-001-lab-catalogue.json";

type SpecOption = { value: string; label: string };
type SpecField = {
  key: string;
  label?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  optional?: boolean;
};
type SpecQuestion = {
  id: string;
  inputType: string;
  answerKey: string | null;
  fields?: SpecField[];
  options?: SpecOption[];
  scale?: { min: number; max: number };
  showWhen: { expression: string } | null;
  gate?: boolean;
  emergencyScreen?: boolean;
  unknownEscape?: string;
};
type Spec = {
  document: { code: string; version: string };
  redFlags: { id: string; level: string; source: string; label: string }[];
  questions: SpecQuestion[];
};

const spec: Spec = JSON.parse(readFileSync(SPEC_PATH, "utf8"));

const failures: string[] = [];
const notes: string[] = [];
let checks = 0;

function check(ok: boolean, message: string) {
  checks++;
  if (!ok) failures.push(message);
}

// ---------------------------------------------------------------------------
// 1. Every source question is mapped, and every mapping lands on a real field.
// ---------------------------------------------------------------------------

const appFieldIds = new Set(
  CORE_QUESTIONS.flatMap((q) =>
    q.fields.flatMap((f) =>
      f.kind === "blood-pressure"
        ? [`${f.id}.systolic`, `${f.id}.diastolic`]
        : [f.id],
    ),
  ),
);

for (const question of spec.questions) {
  const maps = mapsForQuestion(question.id);
  check(maps.length > 0, `${question.id}: no mapping in SPEC_MAP`);

  const specKeys = [
    ...(question.answerKey ? [question.answerKey] : []),
    ...(question.fields ?? []).map((f) => f.key),
  ];
  for (const key of specKeys) {
    check(
      maps.some((m) => m.specKey === key),
      `${question.id}: answer key "${key}" is not mapped`,
    );
  }
}

for (const map of SPEC_MAP) {
  check(
    appFieldIds.has(map.fieldId),
    `${map.specId}/${map.specKey}: mapped to "${map.fieldId}", which is not a field`,
  );
  check(
    spec.questions.some((q) => q.id === map.specId),
    `${map.specId}: mapped but absent from the source`,
  );
}

// Fields the app asks that the source does not.
for (const fieldId of appFieldIds) {
  check(
    SPEC_MAP.some((m) => m.fieldId === fieldId) || APP_ONLY_FIELDS.includes(fieldId),
    `${fieldId}: asked by the app but not present in the source`,
  );
}
for (const fieldId of APP_ONLY_FIELDS) {
  check(appFieldIds.has(fieldId), `${fieldId}: app-only exemption has no field`);
}

// ---------------------------------------------------------------------------
// 2. Options, bounds and input kinds.
// ---------------------------------------------------------------------------

const KIND_FOR_INPUT: Record<string, string[]> = {
  num: ["number", "blood-pressure"],
  numskip: ["number"],
  numradio: ["number", "single"],
  radio: ["single"],
  gate: ["single"],
  check: ["multi"],
  slider: ["scale"],
};

// Input ranges the product deliberately narrows below the source. Each one is
// an open top ("max or more"), so no answer the source allows becomes
// impossible to express, and each must stay above every threshold read from
// the field. If the source changes its bound, this check fails until reviewed.
const INPUT_MAX_OVERRIDES: Record<string, { sourceMax: number; max: number; threshold: number; why: string }> = {
  "q2.activity_minutes": {
    sourceMax: 1200,
    max: 500,
    threshold: THRESHOLD.activityMinutes,
    why: "Khikar, 18 Oct 2026: 1200 made the slider unusable; 500+ is still above the 150-minute target",
  },
};

for (const question of spec.questions) {
  for (const map of mapsForQuestion(question.id)) {
    const field = fieldById(map.fieldId);
    if (!field) continue;

    const allowed = KIND_FOR_INPUT[question.inputType] ?? [];
    check(
      allowed.includes(field.kind),
      `${question.id}/${map.specKey}: source type "${question.inputType}" but the app renders "${field.kind}"`,
    );

    // Numeric bounds, when this mapping is one of the source's numeric fields.
    const specField = (question.fields ?? []).find((f) => f.key === map.specKey);

    // A composite field carries its parts' bounds separately, because the two
    // halves of a reading do not share a range.
    if (specField && field.kind === "blood-pressure") {
      const part = map.fieldId.slice(field.id.length + 1);
      const bounds = field.parts?.[part];
      check(
        bounds !== undefined,
        `${question.id}/${map.specKey}: no bounds declared for the "${part}" part`,
      );
      if (bounds) {
        check(
          bounds.min === specField.min,
          `${question.id}/${map.specKey}: min is ${bounds.min}, source says ${specField.min}`,
        );
        check(
          bounds.max === specField.max,
          `${question.id}/${map.specKey}: max is ${bounds.max}, source says ${specField.max}`,
        );
      }
    }

    if (specField && field.kind === "number") {
      check(
        field.min === specField.min,
        `${question.id}/${map.specKey}: min is ${field.min}, source says ${specField.min}`,
      );
      const override = INPUT_MAX_OVERRIDES[map.fieldId];
      if (override) {
        check(
          specField.max === override.sourceMax && field.max === override.max && field.openMax === true,
          `${question.id}/${map.specKey}: override expects source max ${override.sourceMax} and an open app max ${override.max}, found source ${specField.max}, app ${field.max}${field.openMax ? "+" : ""}`,
        );
        check(
          override.max > override.threshold,
          `${question.id}/${map.specKey}: open max ${override.max} must stay above the ${override.threshold} threshold`,
        );
      } else {
        check(
          field.max === specField.max,
          `${question.id}/${map.specKey}: max is ${field.max}, source says ${specField.max}`,
        );
      }
      const specStep = specField.step === 1 ? undefined : specField.step;
      check(
        field.step === specStep,
        `${question.id}/${map.specKey}: step is ${field.step}, source says ${specStep}`,
      );
    }

    if (question.scale) {
      check(
        field.min === question.scale.min && field.max === question.scale.max,
        `${question.id}: scale is ${field.min}-${field.max}, source says ${question.scale.min}-${question.scale.max}`,
      );
    }

    // Options, in both directions.
    //
    // A gate carries no options in the source: the two answers are the
    // emergency button and its refusal, and the simulator draws them itself
    // rather than listing them as data. The app still has to offer exactly
    // those two, so that is checked directly.
    if (question.inputType === "gate") {
      const appValues = (field.options ?? []).map((o) => o.value).sort();
      check(
        appValues.join(",") === "no,yes",
        `${question.id}: a gate must offer exactly yes and no, app offers ${appValues.join(", ") || "nothing"}`,
      );
      const redFlagged = (field.options ?? []).filter((o) => o.redFlag);
      check(
        redFlagged.length === 1 && redFlagged[0].value === "yes",
        `${question.id}: the gate's "yes" must be marked as a red flag`,
      );
    } else if (map.options) {
      const appValues = new Set((field.options ?? []).map((o) => o.value));
      for (const [specValue, appValue] of Object.entries(map.options)) {
        const inSource = (question.options ?? []).some(
          (o) => o.value === specValue,
        );
        check(
          inSource,
          `${question.id}: mapping claims source option "${specValue}", which the source does not list`,
        );
        check(
          appValues.has(appValue),
          `${question.id}: mapped to app option "${appValue}", which the field does not offer`,
        );
      }
      for (const option of question.options ?? []) {
        check(
          option.value in map.options,
          `${question.id}: source option "${option.value}" is not mapped`,
        );
      }
      const added = new Set(map.addedOptions ?? []);
      const mapped = new Set(Object.values(map.options));
      for (const value of appValues) {
        check(
          mapped.has(value) || added.has(value),
          `${question.id}: app offers "${value}", which is neither in the source nor declared as an addition`,
        );
      }
      if (map.addedOptions?.length) {
        notes.push(
          `${question.id}: app adds ${map.addedOptions.map((v) => `"${v}"`).join(", ")} beyond the source (declared)`,
        );
      }
    }

    // A gate is answered before the questionnaire moves on; a numskip offers an
    // explicit "I don't know" rather than an empty box.
    if (question.gate || question.emergencyScreen) {
      check(
        field.immediate === true,
        `${question.id}: source marks this a gate, but the field is not immediate`,
      );
    }
    if (question.inputType === "numskip") {
      check(
        field.skippable === true,
        `${question.id}: source gives an unknown escape, but the field is not skippable`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Branch conditions, checked by execution.
// ---------------------------------------------------------------------------

/** A source-shaped answer state, built from an app-shaped one. */
function toSpecState(answers: Answers): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const map of SPEC_MAP) {
    const answer = answers[map.fieldId];
    if (!answer) continue;
    const value = answer.value;
    const reverse = map.options
      ? Object.fromEntries(
          Object.entries(map.options).map(([s, a]) => [a, s]),
        )
      : undefined;

    if (Array.isArray(value)) {
      state[map.specKey] = value
        .map((v) => reverse?.[v])
        .filter((v): v is string => v !== undefined);
      continue;
    }
    if (value === UNKNOWN) {
      // Only carried across where the source has a code for "I don't know".
      const code = reverse?.[UNKNOWN];
      if (code !== undefined) state[map.specKey] = code;
      continue;
    }
    state[map.specKey] = reverse ? reverse[String(value)] : value;
  }
  return state;
}

// Branch conditions the product deliberately narrows below the source: the app
// hides a field the source would show, and only when the extra condition says
// so. The field is then pruned, never stored as a normal answer.
const SHOW_IF_NARROWINGS: Record<string, { also: (a: Answers) => boolean; why: string }> = {
  "q2.activity_intensity": {
    also: (a) => a["q2.activity_minutes"]?.value !== 0,
    why: "Gohar QA 120: no intensity for 0 minutes a week; 0 minutes is below the target at any intensity",
  },
};

const specVisible = new Map<string, (s: Record<string, unknown>) => boolean>();
for (const question of spec.questions) {
  if (!question.showWhen) continue;
  specVisible.set(
    question.id,
    new Function("s", `return !!(${question.showWhen.expression});`) as (
      s: Record<string, unknown>,
    ) => boolean,
  );
}

/** Deterministic pseudo-random, so a failure can be reproduced from the seed. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomAnswers(rand: () => number): Answers {
  const answers: Answers = {};
  const put = (fieldId: string, value: FieldValue) => {
    answers[fieldId] = {
      fieldId,
      value,
      source: "manual",
      answeredAt: "2026-03-02T10:00:00.000Z",
    };
  };

  for (const map of SPEC_MAP) {
    if (rand() < 0.2) continue; // Left unanswered.
    const field = fieldById(map.fieldId);
    if (!field) continue;

    if (rand() < 0.08) {
      put(map.fieldId, UNKNOWN);
      continue;
    }

    if (field.kind === "multi") {
      const values = (field.options ?? [])
        .map((o) => o.value)
        .filter(() => rand() < 0.4);
      put(map.fieldId, values);
    } else if (field.options && map.options) {
      const choices = Object.values(map.options);
      put(map.fieldId, choices[Math.floor(rand() * choices.length)]);
    } else {
      const min = field.min ?? 0;
      const max = field.max ?? 200;
      // Bias towards the thresholds, where the branches actually turn.
      const value = Math.round(min + rand() * (max - min));
      put(map.fieldId, value);
    }
  }

  // Push the crisis gate open often enough to exercise it.
  if (rand() < 0.3) {
    put("q5.last_reading.systolic", 185);
    put("q5.last_reading.diastolic", 115);
  }
  return answers;
}

const ROUNDS = 4000;
let disagreements = 0;
/**
 * How often each conditional question came out shown and hidden.
 *
 * Agreement between two predicates that are never both exercised is not
 * evidence. If the generator never opens a branch, the check has to fail rather
 * than report a pass it did not earn.
 */
const coverage = new Map<string, { shown: number; hidden: number }>();
for (const question of spec.questions) {
  if (question.showWhen) coverage.set(question.id, { shown: 0, hidden: 0 });
}
for (let seed = 1; seed <= ROUNDS; seed++) {
  const rand = makeRandom(seed);
  const answers = randomAnswers(rand);
  const state = toSpecState(answers);
  const shown = new Set(
    CORE_QUESTIONS.flatMap((q) => visibleFields(q, answers)).map((f) => f.id),
  );

  for (const question of spec.questions) {
    const predicate = specVisible.get(question.id);
    const expected = predicate ? predicate(state) : true;

    const seen = coverage.get(question.id);
    if (seen) seen[expected ? "shown" : "hidden"]++;

    for (const map of mapsForQuestion(question.id)) {
      const field: AssessmentField | undefined = fieldById(map.fieldId);
      if (!field) continue;
      const actual = shown.has(field.id);
      const narrowing = SHOW_IF_NARROWINGS[field.id];
      // Decision tree 2.4 also opens these four follow-ups for forgotten
      // frequency. JSON Q4.1 lacks idk; spec-map declares the added option.
      // Check this exact extension, while retaining every source predicate.
      const forgottenFrequency = ["q4.drinks_per_day", "q4.binge", "q4.drink_type", "q4.volume_ml"].includes(field.id)
        && answers["q4.frequency"]?.value === UNKNOWN;
      const want = (expected || forgottenFrequency) && (!narrowing || narrowing.also(answers));
      if (actual !== want && disagreements < 5) {
        disagreements++;
        failures.push(
          `${question.id}/${map.fieldId}: source${narrowing ? " (narrowed)" : ""} says ${want ? "shown" : "hidden"}, app says ${actual ? "shown" : "hidden"} (seed ${seed}, state ${JSON.stringify(state)})`,
        );
      }
    }
  }
}
checks += ROUNDS;

const MIN_COVERAGE = 20;
for (const [questionId, seen] of coverage) {
  check(
    seen.shown >= MIN_COVERAGE && seen.hidden >= MIN_COVERAGE,
    `${questionId}: branch under-exercised (shown ${seen.shown}, hidden ${seen.hidden}, need ${MIN_COVERAGE} of each) — the generator cannot reach this condition, so its agreement proves nothing`,
  );
}

// ---------------------------------------------------------------------------
// 4. The red flag registry.
// ---------------------------------------------------------------------------

const LEVEL_TO_URGENCY: Record<string, string> = { RED: "red", ORANGE: "orange" };

for (const flag of spec.redFlags) {
  const rule = RED_FLAG_REGISTRY.find((r) => r.id === flag.id);
  check(Boolean(rule), `${flag.id}: missing from the app's registry`);
  if (!rule) continue;
  check(
    rule.urgency === LEVEL_TO_URGENCY[flag.level],
    `${flag.id}: app urgency "${rule.urgency}", source level "${flag.level}"`,
  );
  check(
    Boolean(rule.source),
    `${flag.id}: carries no guideline source in the app`,
  );
}
check(
  RED_FLAG_REGISTRY.length === spec.redFlags.length,
  `registry has ${RED_FLAG_REGISTRY.length} flags, source has ${spec.redFlags.length}`,
);

// ---------------------------------------------------------------------------
// 5. Derived value thresholds, at the cut points the source names.
// ---------------------------------------------------------------------------

function answersFrom(values: Record<string, FieldValue>): Answers {
  return Object.fromEntries(
    Object.entries(values).map(([fieldId, value]) => [
      fieldId,
      { fieldId, value, source: "manual" as const, answeredAt: "2026-03-02T10:00:00.000Z" },
    ]),
  );
}

const bmiAt = (kg: number) =>
  bmiBand(answersFrom({ "q2.height": 100, "q2.weight": kg }))?.code;
check(bmiAt(18.4) === "UNDERWEIGHT", "BMI 18.4 should be underweight");
check(bmiAt(18.5) === "NORMAL", "BMI 18.5 should be normal");
check(bmiAt(24.9) === "NORMAL", "BMI 24.9 should be normal");
check(bmiAt(25) === "OVERWEIGHT", "BMI 25.0 should be overweight");
check(bmiAt(29.9) === "OVERWEIGHT", "BMI 29.9 should be overweight");
check(bmiAt(30) === "OBESITY", "BMI 30.0 should be obesity");

const waistAt = (cm: number, sex: string) =>
  waistBand(answersFrom({ "q2.waist": cm, "q1.sex": sex }))?.code;
check(waistAt(93, "male") === "NORMAL", "male waist 93 should be normal");
check(waistAt(94, "male") === "NO_FURTHER_GAIN", "male waist 94 is the first cut");
check(waistAt(102, "male") === "REDUCTION_ADVISED", "male waist 102 is the second cut");
check(waistAt(79, "female") === "NORMAL", "female waist 79 should be normal");
check(waistAt(80, "female") === "NO_FURTHER_GAIN", "female waist 80 is the first cut");
check(waistAt(88, "female") === "REDUCTION_ADVISED", "female waist 88 is the second cut");

check(
  packYears(answersFrom({ "q3.per_day": 20, "q3.years": 20 })) === 20,
  "20 a day for 20 years is 20 pack-years",
);
check(
  THRESHOLD.heavySmokingPackYears === 20,
  "the heavy-smoking cut is 20 pack-years",
);

const dietAt = (n: number) =>
  dietBand(
    answersFrom({
      "q2.diet": ["veg", "fruit", "fish", "nuts", "meat", "grain", "salt", "ssb"].slice(0, n),
    }),
  )?.code;
check(dietAt(3) === "POOR", "diet 3 of 8 needs the full plan");
check(dietAt(4) === "PARTIAL", "diet 4 of 8 needs a few changes");
check(dietAt(6) === "PARTIAL", "diet 6 of 8 needs a few changes");
check(dietAt(7) === "GOOD", "diet 7 of 8 is keep going");

// Alcohol, at the cut points the two source documents name. AUDIT-C is
// sex-specific and the weekly gram limit is not, which is why both are checked.
const auditAt = (
  frequency: string,
  drinks: string,
  binge: string,
  sex: string,
) =>
  auditCBand(
    answersFrom({
      "q1.sex": sex,
      "q4.frequency": frequency,
      "q4.drinks_per_day": drinks,
      "q4.binge": binge,
    }),
  );

check(
  auditCScore(answersFrom({ "q4.frequency": "never" })) === 0,
  "never drinking scores 0 on AUDIT-C without the follow-ups",
);
check(
  auditCScore(
    answersFrom({ "q4.frequency": "four_plus_week", "q4.binge": "daily" }),
  ) === null,
  "an AUDIT-C missing its quantity item has no score, rather than a partial one",
);
check(
  auditCScore(
    answersFrom({
      "q4.frequency": "four_plus_week",
      "q4.drinks_per_day": "ten_plus",
      "q4.binge": "daily",
    }),
  ) === 12,
  "the AUDIT-C maximum is 12",
);
check(
  auditAt("two_to_three_week", "one_two", "never", "male")?.code === "LOW",
  "a man at 3 is below the cut",
);
check(
  auditAt("two_to_three_week", "three_four", "never", "male")?.code === "POSITIVE",
  "a man at 4 is a positive screen",
);
check(
  auditAt("two_to_four_month", "one_two", "never", "female")?.code === "LOW",
  "a woman at 2 is below the cut",
);
check(
  auditAt("two_to_three_week", "one_two", "never", "female")?.code === "POSITIVE",
  "a woman at 3 is a positive screen",
);
check(
  auditAt("monthly_or_less", "one_two", "weekly", "male")?.code === "PRIORITY",
  "six or more on one occasion weekly is a priority assessment whatever the total",
);

const gramsAt = (values: Record<string, FieldValue>) =>
  alcoholGramsPerWeek(answersFrom(values));
check(
  gramsAt({ "q4.frequency": "never" }) === 0,
  "never drinking is 0 g a week",
);
check(
  gramsAt({ "q4.frequency": "four_plus_week", "q4.drinks_per_day": UNKNOWN }) === null,
  "a frequency without a quantity leaves the gram estimate open, not zero",
);
check(
  gramsAt({ "q4.frequency": "two_to_three_week", "q4.drinks_per_day": "one_two" }) === 37.5,
  "2.5 occasions a week at 1.5 standard drinks is 37.5 g",
);
check(
  alcoholBand(
    answersFrom({
      "q4.frequency": "two_to_three_week",
      "q4.drinks_per_day": "one_two",
    }),
  )?.code === "WITHIN_LIMIT",
  "37.5 g a week is within the limit",
);
check(
  alcoholBand(
    answersFrom({
      "q4.frequency": "four_plus_week",
      "q4.drinks_per_day": "three_four",
    }),
  )?.code === "ABOVE_LIMIT",
  "175 g a week is above the limit",
);
check(
  alcoholBand(answersFrom({ "q4.frequency": "four_plus_week" }))?.code === "UNKNOWN",
  "a drinker who cannot put a number on it is unknown, not a non-drinker",
);
check(
  ALCOHOL_WEEKLY_LIMIT_GRAMS === 100,
  "the weekly ceiling is 100 g of pure alcohol, for women and men alike",
);

const osaAt = (score: number) => {
  // Build a session with a known STOP-BANG count: snoring plus observed pauses
  // is 2, and each extra component below adds one.
  const base: Record<string, FieldValue> = { "q8.breathing": "both" };
  const extras: [string, FieldValue][] = [
    ["q8.daytime_sleepiness", "daily"],
    ["q1.sex", "male"],
    ["q1.age", 60],
    ["q5.diagnosed", "treated"],
    ["q8.neck", 45],
    ["q2.height", 100],
  ];
  for (let i = 0; i < score - 2; i++) {
    const [k, v] = extras[i];
    base[k] = v;
    if (k === "q2.height") base["q2.weight"] = 40; // BMI 40, over the 35 cut.
  }
  if (score - 2 < 5) base["q8.neck"] = 30; // Measured and under the cut.
  return osaBand(answersFrom(base))?.code;
};
check(osaAt(2) === "LOW", "STOP-BANG 2 is low");
check(osaAt(3) === "INTERMEDIATE", "STOP-BANG 3 is intermediate");
check(osaAt(4) === "INTERMEDIATE", "STOP-BANG 4 is intermediate");
check(osaAt(5) === "HIGH", "STOP-BANG 5 is high");

// Weekly BP summary, draft for Armen. These are pinned separately from the approved algorithm.
check(THRESHOLD.bpTrendWindowDays === 7 && THRESHOLD.bpTrendSummaryReadings === 3 && THRESHOLD.bpTrendSummaryDays === 2, "BP weekly summary coverage cuts");
check(THRESHOLD.bpTrendComparisonReadings === 3 && THRESHOLD.bpTrendMinReadings === 4 && THRESHOLD.bpTrendChangeSystolic === 10, "BP weekly trend comparison cuts");
check(THRESHOLD.bpTrendPeriodReadings === 2 && THRESHOLD.bpTrendMorningEndHour === 12 && THRESHOLD.bpTrendEveningStartHour === 16, "BP weekly period cuts");
check(THRESHOLD.bpTrendRegularDays === 4 && THRESHOLD.bpTrendNextDays === 3, "BP weekly next step cuts");

// Blood pressure category bands, at the cut points THRESHOLD names.
// Armen, team group message 588, 2 Nov: yellow starts at 135/85, either number.
// This overrides Q5.2's vendored 120/70 cut; grade 1 and above stay unchanged.
const bpAt = (systolic: number, diastolic: number) =>
  bloodPressureBand(
    answersFrom({ "q5.last_reading.systolic": systolic, "q5.last_reading.diastolic": diastolic }),
  )?.code;
check(bpAt(119, 69) === "NON_ELEVATED", "119/69 is not elevated");
check(bpAt(118, 76) === "NON_ELEVATED", "118/76 is not elevated (Gohar 639)");
check(bpAt(120, 60) === "NON_ELEVATED", "systolic 120 is not elevated");
check(bpAt(110, 70) === "NON_ELEVATED", "diastolic 70 is not elevated");
check(bpAt(120, 70) === "NON_ELEVATED", "120/70 is not elevated");
check(bpAt(130, 80) === "NON_ELEVATED", "130/80 is not elevated");
check(bpAt(134, 84) === "NON_ELEVATED", "134/84 is just below elevated");
check(bpAt(135, 80) === "ELEVATED", "systolic 135 alone is elevated");
check(bpAt(125, 85) === "ELEVATED", "diastolic 85 alone is elevated");
check(bpAt(139, 89) === "ELEVATED", "139/89 is still elevated");
check(bpAt(140, 80) === "GRADE_1", "systolic 140 is grade 1");
check(bpAt(130, 90) === "GRADE_1", "diastolic 90 is grade 1");
check(bpAt(160, 80) === "GRADE_2", "systolic 160 is grade 2");
check(bpAt(130, 100) === "GRADE_2", "diastolic 100 is grade 2");
check(bpAt(180, 80) === "CRISIS", "systolic 180 is crisis");
check(bpAt(130, 110) === "CRISIS", "diastolic 110 is crisis");

// Activity bands: 150 moderate-equivalent minutes is the target, 75 is halfway.
const activityAt = (minutes: number, intensity = "moderate") =>
  activityBand(
    answersFrom({ "q2.activity": "active", "q2.activity_minutes": minutes, "q2.activity_intensity": intensity }),
  )?.code;
check(activityAt(150) === "MEETS_TARGET", "150 moderate minutes meets the target");
check(activityAt(149) === "PARTIAL", "149 moderate minutes is partial");
check(activityAt(75) === "PARTIAL", "75 moderate minutes is partial");
check(activityAt(75, "vigorous") === "MEETS_TARGET", "75 vigorous minutes count double");

// QA 120: 0 minutes hides the intensity, and without it 0 minutes is still below the target.
const intensity = fieldById("q2.activity_intensity");
check(intensity?.showIf?.(answersFrom({ "q2.activity": "occasional", "q2.activity_minutes": 0 })) === false, "0 minutes hides the intensity question");
check(intensity?.showIf?.(answersFrom({ "q2.activity": "occasional", "q2.activity_minutes": 30 })) === true, "30 minutes asks the intensity");
check(intensity?.showIf?.(answersFrom({ "q2.activity": "occasional" })) === true, "unanswered minutes still asks the intensity");
check(
  activityBand(answersFrom({ "q2.activity": "occasional", "q2.activity_minutes": 0 }))?.code === "BELOW_TARGET",
  "0 minutes with no intensity is below the target",
);

// The crisis symptom gate opens exactly where RF-03 and RF-06 fire.
const crisisGate = fieldById("q5.crisis_symptoms");
check(Boolean(crisisGate?.showIf), "the crisis symptom gate has a showIf");
for (const [systolic, diastolic] of [[179, 109], [180, 70], [120, 110], [181, 111]] as const) {
  const a = answersFrom({ "q5.last_reading.systolic": systolic, "q5.last_reading.diastolic": diastolic });
  check(
    crisisGate?.showIf?.(a) === inCrisisRange(a),
    `crisis gate at ${systolic}/${diastolic} disagrees with inCrisisRange`,
  );
}

// Pack-years: the band compares the raw exposure, like NRN-RULE-SMK-002, and
// never the display-rounded value (19 a day for 21 years is 19.95, shown 20).
const packsBand = (perDay: number, years: number) =>
  derivedMetrics(answersFrom({ "q3.status": "current", "q3.per_day": perDay, "q3.years": years }))
    .find((m) => m.key === "pack-years")?.band.code;
const smk002 = (perDay: number, years: number) =>
  evaluate({
    answers: answersFrom({ "q3.status": "current", "q3.per_day": perDay, "q3.years": years }),
    observations: [],
  }).findings.some((f) => f.ruleId === "NRN-RULE-SMK-002");
check(packsBand(19, 21) === "RECORDED", "19.95 pack-years is not flagged in the band");
check(!smk002(19, 21), "19.95 pack-years does not fire SMK-002");
check(packsBand(20, 20) === "HIGH" && smk002(20, 20), "20 pack-years: band and SMK-002 agree");

// NRN-RULE-BP-003: either half of the reading unknown sends the member to measure.
const bp003 = (systolic: FieldValue, diastolic: FieldValue) =>
  evaluate({
    answers: answersFrom({ "q5.last_reading.systolic": systolic, "q5.last_reading.diastolic": diastolic }),
    observations: [],
  }).findings.some((f) => f.ruleId === "NRN-RULE-BP-003");
check(bp003(UNKNOWN, 80), "unknown/80 fires BP-003");
check(bp003(120, UNKNOWN), "120/unknown fires BP-003");
check(bp003(UNKNOWN, UNKNOWN), "unknown/unknown fires BP-003");
check(!bp003(120, 80), "120/80 does not fire BP-003");
check(
  !evaluate({ answers: answersFrom({}), observations: [] }).findings.some((f) => f.ruleId === "NRN-RULE-BP-003"),
  "an unasked reading does not fire BP-003",
);
{
  const d = evaluate({
    answers: answersFrom({ "q5.last_reading.systolic": 165, "q5.last_reading.diastolic": UNKNOWN }),
    observations: [],
  });
  check(
    d.findings.some((f) => f.ruleId === "NRN-RULE-BP-002") && d.findings.some((f) => f.ruleId === "NRN-RULE-BP-003"),
    "165/unknown keeps the raised-reading finding and adds the measurement plan",
  );
}

// ALC-001 (below the AUDIT-C cut-off) is reassuring, not something to discuss.
{
  const d = evaluate({
    answers: answersFrom({
      "q1.sex": "male",
      "q4.frequency": "monthly_or_less",
      "q4.drinks_per_day": "one_two",
      "q4.binge": "never",
    }),
    observations: [],
  });
  check(d.findings.some((f) => f.ruleId === "NRN-RULE-ALC-001"), "a light drinker fires ALC-001");
  check(!needsAttention(d).some((f) => f.ruleId === "NRN-RULE-ALC-001"), "ALC-001 is not under needs attention");
  check(reassuring(d).some((f) => f.ruleId === "NRN-RULE-ALC-001"), "ALC-001 is listed as reassuring");
}

// Phase 2 lipid cut points: LDL-C >= 4.9 but TC > 8 (source: "TC >8 mmol/L").
check(phase2LdlHighReached(4.9) && !phase2LdlHighReached(4.89), "LDL-C cut is >= 4.9");
check(!phase2TotalCholesterolHighReached(7.99), "TC 7.99 is under the cut");
check(!phase2TotalCholesterolHighReached(8), "TC exactly 8.0 is not above 8");
check(phase2TotalCholesterolHighReached(8.01), "TC 8.01 is above the cut");
const tcAttention = (valueText: string) =>
  validateResult(
    {
      testName: "Total cholesterol",
      analyte: "total_cholesterol",
      valueText,
      unit: "mmol/L",
      referenceRange: null,
      flag: null,
      collectedOn: "2026-10-15",
      page: 1,
      snippet: `Total cholesterol ${valueText}`,
    },
    { pageCount: 1, sampleDate: "2026-10-15", labName: null, today: "2026-10-17" },
  ).attentionRule;
check(tcAttention("7.99") === null, "lab TC 7.99 gets no threshold flag");
check(tcAttention("8.0") === null, "lab TC 8.0 gets no threshold flag");
check(tcAttention("8.01") === "THRESHOLD.phase2TotalCholesterolHigh", "lab TC 8.01 gets the threshold flag");

// ---------------------------------------------------------------------------
// 5b. Every branch outcome in the source is accounted for.
// ---------------------------------------------------------------------------

type SpecBranch = { when: string; outcome: string; tone: string };

let branchCount = 0;
for (const question of spec.questions as (SpecQuestion & { branches?: SpecBranch[] })[]) {
  const branches = question.branches ?? [];
  branchCount += branches.length;
  for (const [index, branch] of branches.entries()) {
    const entry = BRANCH_COVERAGE.find(
      (b) => b.specId === question.id && b.index === index,
    );
    check(
      entry !== undefined,
      `${question.id}[${index}]: branch "${branch.when}" -> "${branch.outcome}" is not accounted for in BRANCH_COVERAGE`,
    );
    if (!entry) continue;
    check(
      entry.when === branch.when,
      `${question.id}[${index}]: coverage records "${entry.when}", source now says "${branch.when}"`,
    );
    const kinds = [
      entry.rule,
      entry.derived,
      entry.navigation,
      entry.phase2,
      entry.notModelled,
    ].filter(Boolean);
    check(
      kinds.length === 1,
      `${question.id}[${index}]: coverage must say exactly one of rule, derived, navigation, phase2 or notModelled`,
    );
  }
}

check(
  BRANCH_COVERAGE.length === branchCount,
  `coverage lists ${BRANCH_COVERAGE.length} branches, source has ${branchCount}`,
);

const unknownRules = unknownRuleIds();
check(
  unknownRules.length === 0,
  `coverage names rules that do not exist: ${unknownRules.join(", ")}`,
);

// ---------------------------------------------------------------------------
// 6. Every ordered test exists in the laboratory catalogue, and we say whether
//    the current packages can actually deliver it.
// ---------------------------------------------------------------------------

type Catalogue = {
  document: { code: string; version: string };
  sections: Record<
    string,
    {
      code: string;
      title: string;
      groups?: {
        code: string;
        title: string;
        tests?: { test: string; packages: string[]; packagesNote: string | null }[];
        items?: { name: string; severity: string }[];
      }[];
    }
  >;
};

const catalogue: Catalogue = JSON.parse(readFileSync(CATALOGUE_PATH, "utf8"));

type CatalogueHit = {
  section: string;
  group: string;
  packages?: string[];
  packagesNote?: string | null;
  severity?: string;
};

function findInCatalogue(name: string): CatalogueHit | undefined {
  for (const [sectionKey, section] of Object.entries(catalogue.sections)) {
    for (const group of section.groups ?? []) {
      for (const test of group.tests ?? []) {
        if (test.test === name) {
          return {
            section: sectionKey,
            group: group.code,
            packages: test.packages,
            packagesNote: test.packagesNote,
          };
        }
      }
      for (const item of group.items ?? []) {
        if (item.name === name) {
          return { section: sectionKey, group: group.code, severity: item.severity };
        }
      }
    }
  }
  return undefined;
}

const unavailable: string[] = [];
for (const test of TEST_CATALOGUE) {
  if (!test.catalogueRef) {
    notes.push(
      `${test.id}: taken by Noreon rather than ordered, so it has no catalogue entry (declared)`,
    );
    continue;
  }
  // One ordered test can carry several catalogue rows (the lipid panel, HbA1c
  // with fasting glucose); every row has to resolve.
  for (const ref of [test.catalogueRef].flat()) {
    const hit = findInCatalogue(ref);
    check(
      hit !== undefined,
      `${test.id}: catalogue reference "${ref}" is not in ${catalogue.document.code}`,
    );
    if (!hit) continue;

    // Section A is what the packages carry. Section B is what the algorithm
    // orders but no package currently delivers.
    if (hit.section === "B") {
      unavailable.push(`${test.id} (${ref}, ${hit.group}, ${hit.severity})`);
    } else if (hit.packagesNote) {
      unavailable.push(`${test.id} (${ref}, ${hit.packagesNote.trim()})`);
    } else if (hit.packages?.some((p) => p.includes("միայն"))) {
      unavailable.push(`${test.id} (${ref}, ${hit.packages.join(" / ")})`);
    }
  }
}

// ---------------------------------------------------------------------------

const version = `${spec.document.code} v${spec.document.version}`;
console.log(`Clinical conformance · ${version}`);
console.log(
  `  ${spec.questions.length} questions · ${SPEC_MAP.length} field mappings · ${spec.redFlags.length} red flags`,
);
console.log(`  ${ROUNDS} random sessions for branch equivalence`);
console.log(
  `  ${branchCount} branch outcomes, all accounted for`,
);
console.log(
  `  ${TEST_CATALOGUE.length} planned tests against ${catalogue.document.code} v${catalogue.document.version}`,
);
for (const note of notes) console.log(`  note: ${note}`);

const gaps = declaredGaps();
if (gaps.length) {
  console.log(`\n  ${gaps.length} branch outcome(s) deliberately not built:`);
  for (const gap of gaps) {
    console.log(`    · ${gap.specId} ${gap.when} — ${gap.phase2 ?? gap.notModelled}`);
  }
}

if (unavailable.length) {
  // Not a failure. The gap is the laboratory's to close, and the catalogue
  // names it as an open decision; the demo's job is to stop it being invisible.
  console.log(
    `\n  ${unavailable.length} planned test(s) the current packages cannot deliver:`,
  );
  for (const entry of unavailable) console.log(`    · ${entry}`);
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):`);
  for (const failure of failures.slice(0, 40)) console.error(`  ✗ ${failure}`);
  if (failures.length > 40) console.error(`  ... and ${failures.length - 40} more`);
  process.exit(1);
}
console.log(`\n  ${checks} checks pass.`);
