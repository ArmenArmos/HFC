import type { ReportedValue } from "./measures";

type Candidate = Pick<ReportedValue, "measure" | "unit" | "value" | "value2" | "measuredOn">;
/** QA N-13: an earlier result with the same measure, numbers, unit and date is probably a second save. */
export function duplicateValue(existing: readonly Candidate[], candidate: Candidate): boolean {
  return existing.some(row => row.measure === candidate.measure && row.unit === candidate.unit && row.measuredOn === candidate.measuredOn
    && row.value === candidate.value && (row.value2 ?? null) === (candidate.value2 ?? null));
}
