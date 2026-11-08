/** Session-only synthetic observations, never verified medicine ingestion. */
export type Evidence = {
  readonly id: string;
  readonly submissionId: string;
  readonly eventId: string;
  readonly planId: string;
  readonly actualAt: string;
  readonly reportedAt: string;
  readonly value: string;
  readonly removed: boolean;
  readonly revision: number;
};
export type Acceptance = {
  readonly eventId: string;
  readonly planId: string;
  readonly acceptedAt: string;
};
const time = (value: string) => Date.parse(value);
function valid(row: Evidence) {
  return (
    Boolean(
      row.id && row.submissionId && row.eventId && row.planId && row.value,
    ) &&
    Number.isSafeInteger(row.revision) &&
    row.revision >= 0 &&
    Number.isFinite(time(row.actualAt)) &&
    Number.isFinite(time(row.reportedAt)) &&
    time(row.actualAt) <= time(row.reportedAt)
  );
}
export function eligibleEvidence(
  rows: readonly Evidence[],
  acceptance: Acceptance | null,
): string[] {
  if (!acceptance || !Number.isFinite(time(acceptance.acceptedAt))) return [];
  return rows
    .filter(
      (row) =>
        valid(row) &&
        !row.removed &&
        row.eventId === acceptance.eventId &&
        row.planId === acceptance.planId &&
        time(row.actualAt) >= time(acceptance.acceptedAt),
    )
    .map((row) => row.id);
}
export type EvidenceResult =
  | { kind: "recorded"; rows: readonly Evidence[] }
  | { kind: "retry" | "conflict" | "confirm-duplicate" | "invalid" };
/** Corrections belong to the audited transition layer, not this append-only helper. */
export function recordEvidence(
  rows: readonly Evidence[],
  row: Evidence,
  choice: "new" | "separate",
): EvidenceResult {
  if (!valid(row) || row.revision !== 0 || row.removed)
    return { kind: "invalid" };
  const previous = rows.find((r) => r.submissionId === row.submissionId);
  if (previous) {
    const same = (Object.keys(row) as (keyof Evidence)[]).every(
      (k) => row[k] === previous[k],
    );
    return { kind: same ? "retry" : "conflict" };
  }
  if (rows.some((r) => r.id === row.id)) return { kind: "conflict" };
  if (
    choice !== "separate" &&
    rows.some(
      (r) =>
        !r.removed &&
        r.eventId === row.eventId &&
        r.planId === row.planId &&
        time(r.actualAt) === time(row.actualAt) &&
        r.value === row.value,
    )
  )
    return { kind: "confirm-duplicate" };
  return { kind: "recorded", rows: [...rows, { ...row }] };
}
/** Numeric Armenia time is identical in server/browser ICU implementations. */
export function formatSyntheticTime(at: string): string {
  return new Date(Date.parse(at) + 4 * 3_600_000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}
