import type { ReportRecord } from "@/lib/reports/demo";
export type ReportApproval = {
  revision: number;
  at: string;
  doctor: string;
  report: ReportRecord;
};
export function reportPublication(
  key: string,
  rows: ReportRecord[],
  approvals: Record<string, ReportApproval>,
) {
  return {
    key,
    reports: structuredClone(
      Object.fromEntries(
        rows
          .filter((r) => approvals[r.id]?.revision === r.revision)
          .map((r) => [r.id, approvals[r.id]]),
      ),
    ),
  };
}
/** Late AI responses must neither resurrect deletions nor overwrite newer edits. */
export function applyReportExplanation(
  rows: ReportRecord[],
  id: string,
  revision: number,
  explanation: ReportRecord["explanation"],
) {
  return rows.map((r) =>
    r.id === id && r.revision === revision
      ? { ...r, explanation, revision: r.revision + 1 }
      : r,
  );
}
