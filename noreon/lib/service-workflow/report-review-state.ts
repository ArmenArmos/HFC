import type { ReportRecord } from '@/lib/reports/demo';
import type { ReportApproval } from './report-memory';
export type ReportReviewState = {
  reports: ReportRecord[];
  approvals: Record<string, ReportApproval>;
  evidenceRevision: number;
};
export const emptyReportReview: ReportReviewState = {reports:[],approvals:{},evidenceRevision:0};
export type ReportReviewAction = {
  update: (state: ReportReviewState) => Pick<ReportReviewState, 'reports' | 'approvals'>;
  trackEvidence: boolean;
};
/** Reports and their local freshness counter always commit in one state update. */
export function reportReviewReducer(state: ReportReviewState, action: ReportReviewAction): ReportReviewState {
  const next=action.update(state);
  const changed=JSON.stringify([state.reports,state.approvals])!==JSON.stringify([next.reports,next.approvals]);
  return changed ? {...next,evidenceRevision:state.evidenceRevision+(action.trackEvidence?1:0)} : state;
}
