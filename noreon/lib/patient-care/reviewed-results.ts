/** Home's "Reviewed results" count (QA 177): everything a doctor checked that the member can read.
 * Published results the doctor reviewed, values from the member's own uploads the doctor approved,
 * and clinic lab reports the doctor released that no published plan covers yet. Clinic lab values the
 * doctor confirmed are not member-readable on their own (lab_ai_value_reviews has no member read), so
 * their released report stands for them until a plan is published after it; its values are then among
 * the published results (Astra #404 F3: decided by the plan's publication time, never by other counts).
 * A read that failed (null or undefined) adds nothing. */
export function reviewedResultCount(input: {
  results: { reviewedAt?: string | null }[];
  released?: { releasedAt: string }[] | null;
  doctorApprovedValues?: number | null;
  planPublishedAt?: string | null;
}): number {
  const published = input.planPublishedAt ? Date.parse(input.planPublishedAt) : null;
  const unpublishedReports = (input.released ?? []).filter((d) => published === null || Number.isNaN(published) || Date.parse(d.releasedAt) > published).length;
  return input.results.filter((r) => r.reviewedAt).length + (input.doctorApprovedValues ?? 0) + unpublishedReports;
}
