import type {ReviewTask} from '@/lib/service-workflow/review-task';
import type { DemoState } from '@/lib/patient/demo-model';
import type { ServiceWorkflow } from '@/lib/service-workflow/types';
import { evaluate } from '@/lib/clinical/rules/engine';
import { serviceProgress } from '@/lib/service-workflow/progress';
export type QueueStatus = 'urgent' | 'questions' | 'tests' | 'review' | 'consultation' | 'published';
export type QueueItem = { id: string; name: string; status: QueueStatus; next: string; owner: string; overdue: boolean; due: string | null; priority: number };
export function queueItem(id: string, data: DemoState, w: ServiceWorkflow | null, now = new Date(), reviewTask: ReviewTask | null = null): QueueItem {
  const a = data.state.assessment;
  const p = w ? serviceProgress(w, now) : null;
  const base = { id, name: data.state.profile?.name || 'Fictional member', overdue: false, due: null as string | null };
  if (a?.urgentRule || evaluate({ answers: a?.answers ?? {}, observations: [] }).urgency === 'red')
    return { ...base, status: 'urgent', next: 'Review urgent questionnaire findings now. Routine publication is paused.', owner: 'You', priority: 0 };
  if (reviewTask?.status==='open') {
    const blocker=!a?.completedAt ? {text:'The member needs to finish their health questions.',owner:'Member'}
      : p?.outstanding.length ? {text:p.unbooked.length ? `${p.unbooked.length} tests still need booking.` : `${p.outstanding.length} results outstanding. Check bookings and receipt.`,owner:p.unbooked.length ? 'Member' : 'Operations / provider'}
      : w?.consultation==='required' && (p?.appointmentNeeded || w.appointment?.status!=='completed') ? {text:p?.appointmentNeeded ? 'A GP appointment needs booking or rescheduling.' : 'Complete the scheduled consultation before publication.',owner:p?.appointmentNeeded ? 'Member' : 'You'} : null;
    // The existing result-based window applies to initial review only. A new
    // review of published care must not inherit an obsolete publication deadline.
    const overdue=!w?.publication && (p?.overdue??false);
    return {...base,status:'review',owner:!reviewTask.ownerId ? 'Needs assignment' : blocker?.owner??'You',
      overdue,due:w?.publication ? null : p?.window?.to??null,priority:overdue?1:2,
      next:`Review pending for evidence revision ${reviewTask.targetEvidenceRevision}. ${blocker?.text || 'Review the changed evidence and record the outcome.'}${w?.publication ? ' The approved plan remains available.' : ''}`};
  }
  if (!a?.completedAt) return { ...base, status: 'questions', next: 'The member needs to finish their health questions.', owner: 'Member', priority: 5 };
  if (w?.publication) return { ...base, status: 'published', next: 'Plan published; no review action currently due.', owner: 'None', priority: 6 };
  if (p?.outstanding.length) return { ...base, status: 'tests', next: p.unbooked.length ? `${p.unbooked.length} tests still need booking.` : `${p.outstanding.length} results outstanding. Check bookings and receipt.`, owner: p.unbooked.length ? 'Member' : 'Operations / provider', priority: 4 };
  if (w?.consultation === 'required' && w.appointment?.status !== 'completed')
    return { ...base, status: 'consultation', next: p?.appointmentNeeded ? 'A GP appointment needs booking or rescheduling.' : 'Consultation scheduled. Complete the consultation before publishing.', owner: p?.appointmentNeeded ? 'Member' : 'You', priority: 3 };
  return { ...base, status: 'review', next: !w || w.consultation === 'undecided' ? 'Review the questionnaire and reports, then decide whether a consultation is needed.' : 'Review reports and your treatment draft, then approve the complete plan.', owner: 'You', overdue: p?.overdue ?? false, due: p?.window?.to ?? null, priority: p?.overdue ? 1 : 2 };
}
