import {sourceBoundExplanation} from '@/lib/reports/source-bound-output';
import assert from "node:assert/strict";
import { explanationSchema, validateExplanation } from "@/lib/reports/schema";
import { SAMPLE_EXTRACTION } from "@/lib/reports/demo";
const good = sourceBoundExplanation(SAMPLE_EXTRACTION);
assert.deepEqual(validateExplanation(good, SAMPLE_EXTRACTION), good);
assert(
  explanationSchema.safeParse({ ...good, attention: [], questions: [] })
    .success,
);
assert.throws(() =>
  validateExplanation(
    { ...good, attention: [{ ...{row:0,reason:"printed_reference" as const,explanation:"Source comparison"}, row: 99 }] },
    SAMPLE_EXTRACTION,
  ),
);
assert.throws(() =>
  validateExplanation(
    { ...good, questions: [{ rows: [99], question: "Invalid" }] },
    SAMPLE_EXTRACTION,
  ),
);
assert.throws(() =>
  validateExplanation(
    { ...good, items: [good.items[0], good.items[0]] },
    SAMPLE_EXTRACTION,
  ),
);
assert.throws(() =>
  validateExplanation(good, {
    ...SAMPLE_EXTRACTION,
    rows: SAMPLE_EXTRACTION.rows.map((r) => ({ ...r, uncertain: true })),
  }),
);
assert.throws(() =>
  validateExplanation(good, {
    ...SAMPLE_EXTRACTION,
    rows: SAMPLE_EXTRACTION.rows.map((r) => ({ ...r, reference: null })),
  }),
);
assert(
  !explanationSchema.safeParse({
    ...good,
    questions: Array(4).fill({rows:[0],question:"Source question"}),
  }).success,
);
assert(
  !explanationSchema.safeParse({
    items: [{ row: 0, explanation: "Legacy", question: "Legacy" }],
  }).success,
);
console.log(
  "Report summaries: valid empty attention, source bounds, duplicate rows, uncertain/missing references, question cap and legacy detection pass.",
);
