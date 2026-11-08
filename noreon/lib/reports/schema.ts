import { z } from "zod";
import {sourceBoundExplanation,sourceBoundExtractionNarrative} from './source-bound-output';
export const rowSchema = z
  .object({
    name: z.string().min(1).max(160),
    literal: z.string().max(200),
    unit: z.string().max(60).nullable(),
    reference: z.string().max(160).nullable(),
    page: z.number().int().min(1).max(10),
    snippet: z.string().max(400),
    uncertain: z.boolean(),
  })
  .strict();
export const extractionSchema = z
  .object({
    reportDate: z.string().nullable(),
    personName: z.string().max(160).nullable(),
    laboratory: z.string().max(160).nullable(),
    summary: z.string().max(2000),
    warnings: z.array(z.string().max(400)).max(20),
    rows: z.array(rowSchema).max(100),
  })
  .strict();
export type ReportExtraction = z.infer<typeof extractionSchema>;
export const explanationSchema = z
  .object({
    summary: z.string().min(1).max(700),
    attention: z
      .array(
        z
          .object({
            row: z.number().int().min(0).max(99),
            reason: z.enum(["printed_reference", "unclear", "context_needed"]),
            explanation: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(6),
    questions: z
      .array(
        z
          .object({
            rows: z.array(z.number().int().min(0).max(99)).min(1).max(10),
            question: z.string().min(1).max(300),
          })
          .strict(),
      )
      .max(3),
    items: z
      .array(
        z
          .object({
            row: z.number().int().min(0).max(99),
            kind: z.enum(["result", "sample"]),
            explanation: z.string().min(1).max(500),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type Explanation = z.infer<typeof explanationSchema>;
export function validateExplanation(
  value: unknown,
  report: ReportExtraction,
): Explanation {
  const result = explanationSchema.parse(value);
  const indices = [
    ...result.items.map((x) => x.row),
    ...result.attention.map((x) => x.row),
    ...result.questions.flatMap((x) => x.rows),
  ];
  if (
    indices.some((row) => row >= report.rows.length) ||
    new Set(result.items.map((x) => x.row)).size !== result.items.length ||
    new Set(result.attention.map((x) => x.row)).size !== result.attention.length
  )
    throw new Error("provider_invalid");
  // No generated reference comparison without a readable, printed reference.
  if (
    result.attention.some(
      (x) =>
        x.reason === "printed_reference" &&
        (!report.rows[x.row].reference?.trim() || report.rows[x.row].uncertain),
    )
  )
    throw new Error("provider_invalid");
  // Only source-bound templates cross the display boundary. An evidence index
  // does not establish that arbitrary model prose is true or clinically allowed.
  if(!(['en','hy'] as const).some(locale=>JSON.stringify(result)===JSON.stringify(sourceBoundExplanation(report,locale))))
    throw new Error('provider_invalid');
  return result;
}
export function validateReview(value: unknown): ReportExtraction {
  const result = extractionSchema.parse(value);
  if (result.reportDate) {
    const date = result.reportDate;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date ||
      date > new Date().toISOString().slice(0, 10) ||
      date < "1900-01-01"
    )
      throw new Error("invalid_date");
  }
  return result;
}
// Exact curated aliases only. No model-selected conversions or risk thresholds.
const markers: Record<string, { name: string; units: string[] }> = {
  ldl: { name: "LDL cholesterol", units: ["mmol/L", "mg/dL"] },
  "ldl cholesterol": { name: "LDL cholesterol", units: ["mmol/L", "mg/dL"] },
  hdl: { name: "HDL cholesterol", units: ["mmol/L", "mg/dL"] },
  "hdl cholesterol": { name: "HDL cholesterol", units: ["mmol/L", "mg/dL"] },
  hba1c: { name: "HbA1c", units: ["%", "mmol/mol"] },
  glucose: { name: "Glucose", units: ["mmol/L", "mg/dL"] },
  creatinine: { name: "Creatinine", units: ["µmol/L", "μmol/L", "mg/dL"] },
  hemoglobin: { name: "Hemoglobin", units: ["g/L", "g/dL"] },
  triglycerides: { name: "Triglycerides", units: ["mmol/L", "mg/dL"] },
  "total cholesterol": {
    name: "Total cholesterol",
    units: ["mmol/L", "mg/dL"],
  },
};
export function trendPoints(report: ReportExtraction) {
  if (!report.reportDate) return [];
  return report.rows.flatMap((r, index) => {
    const marker = markers[r.name.trim().toLowerCase()];
    if (
      !marker ||
      !r.unit ||
      !marker.units.includes(r.unit) ||
      r.uncertain ||
      !/^-?\d+(?:[.,]\d+)?$/.test(r.literal.trim())
    )
      return [];
    const value = Number(r.literal.trim().replace(",", "."));
    if (!Number.isFinite(value)) return [];
    return [
      {
        marker: marker.name,
        value,
        unit: r.unit,
        date: report.reportDate!,
        index,
      },
    ];
  });
}
export const MAX_BYTES = 8 * 1024 * 1024;
export const MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;
export const CONSENT = "report-import-openai-v1";

export function repairExtractionDate(
  value: ReportExtraction,
): ReportExtraction {
  try {
    return sourceBoundExtractionNarrative(validateReview(value));
  } catch {
    return sourceBoundExtractionNarrative(extractionSchema.parse({
      ...value,
      reportDate: null,
      warnings: [
        ...value.warnings.slice(0, 19),
        "The report date could not be validated. Check the original.",
      ],
    }));
  }
}
