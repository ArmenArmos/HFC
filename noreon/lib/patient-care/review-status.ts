import type {ReviewTask} from '@/lib/service-workflow/review-task';
/** Member-safe status: review notes and internal identities remain staff-only. */
export function memberReviewStatus(tasks:ReviewTask[]):{openedAt:string}|null {
  const task=tasks.find(t=>t.status==='open');
  return task ? {openedAt:task.openedAt} : null;
}
