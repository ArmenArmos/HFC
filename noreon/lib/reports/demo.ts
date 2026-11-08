import type { Database } from "@/lib/db/types";
import { extractionSchema, type ReportExtraction } from "@/lib/reports/schema";
export type ReportRecord =
  Database["public"]["Tables"]["patient_reports"]["Row"] & import("@/lib/service-workflow/report-associations").ReportMetadata & {sample_preview?: ReportExtraction | null; extraction_receipt?: {version: 1; issuedAt: number; signature: string}; extraction_provenance?: {status: string; version?: number; issued_at?: string}};
export const SAMPLE_EXTRACTION: ReportExtraction = {
  reportDate: "2025-09-12",
  personName: "Mariam Example",
  laboratory: "Example laboratory",
  summary: "Sample blood test report.",
  warnings: [
    "Check that every field matches the original report before saving.",
  ],
  rows: [
    {
      name: "LDL cholesterol",
      literal: "3.2",
      unit: "mmol/L",
      reference: "<3.0",
      page: 1,
      snippet: "LDL cholesterol 3.2 mmol/L | Reference <3.0",
      uncertain: false,
    },
    {
      name: "HbA1c",
      literal: "5.8",
      unit: "%",
      reference: "4.0–5.6",
      page: 1,
      snippet: "HbA1c 5.8 % | Reference 4.0–5.6",
      uncertain: false,
    },
    {
      name: "Urine protein",
      literal: "negative",
      unit: null,
      reference: "negative",
      page: 1,
      snippet: "Urine protein: negative",
      uncertain: false,
    },
  ],
};
export function sampleReports(): ReportRecord[] {
  return [2025, 2024].map((year, index) => {
    const data = structuredClone(SAMPLE_EXTRACTION);
    data.reportDate = `${year}-09-12`;
    data.rows[0].literal = index ? "3.8" : "3.2";
    data.rows[0].snippet = `LDL cholesterol ${data.rows[0].literal} mmol/L | Reference <3.0`;
    return {
      id: `fictional-${year}`,
      user_id: "fictional",
      object_path: "",
      file_name: `Sample report ${year}.pdf`,
      mime: "application/pdf",
      size_bytes: 1,
      created_at: `${year}-09-12T12:00:00Z`,
      state: index ? "confirmed" : "needs_review",
      revision: 0,
      lease_until: null,
      checksum: null,
      pdf_artifact: null,
      page_count: 1,
      extraction: JSON.parse(JSON.stringify(data)),
      reviewed: index ? JSON.parse(JSON.stringify(data)) : null,
      explanation: null,
      error_code: null,
      consent_version: "fictional",
      consent_at: `${year}-09-12T12:00:00Z`,
      model: "Simulated",
      prompt_version: "fictional",
      confirmed_at: index ? `${year}-09-12T12:00:00Z` : null,
      deleted_at: null,
      storage_purged_at: null,
    };
  });
}

/** Only prepared fixture data can be previewed before clinical publication. */
export function sampleReportPreview(record: {model?: unknown; prompt_version?: unknown; extraction?: unknown}): ReportExtraction | null {
  if (record.model !== 'Simulated' || record.prompt_version !== 'fictional') return null;
  const parsed = extractionSchema.safeParse(record.extraction);
  return parsed.success ? parsed.data : null;
}
