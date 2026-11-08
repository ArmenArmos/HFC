import type {Database} from '@/lib/db/types';
import type {ReviewTask} from '@/lib/service-workflow/review-task';
type ReviewTaskRow=Database['public']['Tables']['workspace_review_tasks']['Row'];
/** The shared read boundary rejects unexpected enum values rather than hiding work. */
export function reviewTaskFromRow(row: ReviewTaskRow): ReviewTask {
  if (row.status!=='open' && row.status!=='completed') throw new Error('Invalid review task status.');
  if (row.outcome!==null && row.outcome!=='published' && row.outcome!=='no-change') throw new Error('Invalid review outcome.');
  return {id:row.id,status:row.status,openedEvidenceRevision:row.opened_evidence_revision,
    targetEvidenceRevision:row.target_evidence_revision,ownerId:row.owner_id,openedAt:row.opened_at,
    updatedAt:row.updated_at,reason:row.reason,completedAt:row.completed_at,completedBy:row.completed_by,completedByLabel:row.completed_by_label,
    completedEvidenceRevision:row.completed_evidence_revision,outcome:row.outcome,completionNote:row.completion_note};
}
