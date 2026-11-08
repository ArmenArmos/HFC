/** Lifecycle only: callers supply the agreed task-opening policy and persist history. */
export type ReviewTask = {
  id: string;
  status: 'open' | 'completed';
  openedEvidenceRevision: number;
  targetEvidenceRevision: number;
  ownerId: string | null;
  openedAt: string;
  updatedAt: string;
  reason: string;
  completedAt: string | null;
  completedBy: string | null;
  completedByLabel?: string | null;
  completedEvidenceRevision: number | null;
  outcome: 'published' | 'no-change' | null;
  completionNote: string | null;
};
type AdvanceInput = {id: string; revision: number; ownerId: string | null; at: string; opensTask: boolean; reason: string};
type CompletionInput = {revision: number; actorId: string; actorLabel?: string; at: string; outcome: 'published' | 'no-change'; note: string};
function validateRevision(revision: number, previous = 0) {
  if (!Number.isSafeInteger(revision) || revision < previous) throw new Error('Invalid review evidence revision.');
}
function validateTime(at: string) {
  if (!Number.isFinite(Date.parse(at))) throw new Error('Invalid review timestamp.');
}
export function advanceReviewTask(current: ReviewTask | null, input: AdvanceInput): ReviewTask | null {
  validateRevision(input.revision,current?.targetEvidenceRevision ?? 0);
  validateTime(input.at);
  if (current?.status === 'open') return {...current,targetEvidenceRevision:input.revision,ownerId:input.ownerId,updatedAt:input.at};
  if (!input.opensTask) return null;
  return {id:input.id,status:'open',openedEvidenceRevision:input.revision,targetEvidenceRevision:input.revision,
    ownerId:input.ownerId,openedAt:input.at,updatedAt:input.at,reason:input.reason,
    completedAt:null,completedBy:null,completedEvidenceRevision:null,outcome:null,completionNote:null};
}
export function completeReviewTask(task: ReviewTask, input: CompletionInput): ReviewTask {
  if (task.status !== 'open') throw new Error('This review task is no longer open.');
  if (input.revision !== task.targetEvidenceRevision) throw new Error('Evidence changed. Refresh and review it before completing this task.');
  if (!input.actorId || input.actorId !== task.ownerId) throw new Error('The review owner changed.');
  validateTime(input.at);
  const note=input.note.trim();
  if ((input.outcome==='no-change' && !note) || note.length>1500) throw new Error('Enter a review note of 1–1500 characters.');
  return {...task,status:'completed',updatedAt:input.at,completedAt:input.at,completedBy:input.actorId,
    completedByLabel:input.actorLabel?.trim() || null,completedEvidenceRevision:input.revision,outcome:input.outcome,completionNote:note || null};
}
export type ReviewCoverage = {
  reports: {id: string; revision: number; approval: unknown}[];
  receipts: {requirementId: string; receivedAt: string | null}[];
};
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}
function coverageKey(coverage: ReviewCoverage) {
  return JSON.stringify(canonical({reports:[...coverage.reports].sort((a,b)=>a.id.localeCompare(b.id)),
    receipts:[...coverage.receipts].sort((a,b)=>a.requirementId.localeCompare(b.requirementId))}));
}
export function sameReviewCoverage(published: ReviewCoverage | null | undefined, current: ReviewCoverage): boolean {
  return !!published && coverageKey(published)===coverageKey(current);
}
