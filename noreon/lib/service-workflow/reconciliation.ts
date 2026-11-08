import type { PatientState } from '@/lib/patient/types';
import type { ServiceBooking, ServiceTest, ServiceWorkflow } from './types';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
export function clinicalContext(state: PatientState): string {
  return JSON.stringify(canonical({answers:Object.fromEntries(Object.entries(state.assessment?.answers ?? {}).map(([id,answer])=>[id,answer.value])), birthDate:state.profile?.birthDate ?? null, biologicalSex:state.profile?.biologicalSex ?? null}));
}
/** Legacy import is deterministic; unknown dates remain unknown. Mutates only its argument. */
export function ensureRecommendationRecords(w: ServiceWorkflow) {
  if (!w.requirements) w.requirements = w.tests.map((test,i)=>({requirementId:`requirement-${i+1}-${test.id}`,test:structuredClone(test),introducedAtRevision:w.questionnaireRevision ?? 0,retiredAtRevision:null}));
  if (!w.receiptHistory) w.receiptHistory = w.receivedTestIds.flatMap(testId=>{
    const requirement=w.requirements!.find(r=>r.test.id===testId && r.retiredAtRevision===null);
    return requirement ? [{testId,method:requirement.test.method,requirementId:requirement.requirementId,receivedAt:null}] : [];
  });
  for (const booking of w.bookings) {
    booking.testSnapshots ??= booking.testIds.flatMap(id=>{
      const test=w.tests.find(t=>t.id===id);
      return test ? [structuredClone(test)] : [];
    });
    booking.requirementIds ??= booking.testIds.flatMap(id=>{
      const requirement=w.requirements!.find(r=>r.test.id===id && r.retiredAtRevision===null);
      return requirement ? [requirement.requirementId] : [];
    });
  }
}
/** Null receipt dates represent received legacy results, never pending placeholders. */
export function bookingResultsReceived(w: ServiceWorkflow, booking: ServiceBooking): boolean {
  return booking.testIds.length > 0 && booking.testIds.every(id => w.receiptHistory && booking.requirementIds
    ? w.receiptHistory.some(receipt => receipt.testId === id && booking.requirementIds!.includes(receipt.requirementId))
    : w.receivedTestIds.includes(id));
}
export function activeTestBookings(w: ServiceWorkflow): ServiceBooking[] {
  return w.bookings.filter(booking => bookingApplies(w, booking) && !bookingResultsReceived(w, booking));
}
export function bookingHasReceipt(w: ServiceWorkflow, booking: ServiceBooking): boolean {
  return w.receiptHistory && booking.requirementIds
    ? w.receiptHistory.some(r=>booking.requirementIds!.includes(r.requirementId))
    : booking.testIds.some(id=>w.receivedTestIds.includes(id));
}
export function bookingApplies(w: ServiceWorkflow, booking: ServiceBooking, testId?: string): boolean {
  if (booking.status !== 'scheduled' || booking.review || w.recommendationsPending) return false;
  const ids=testId ? [testId] : booking.testIds;
  if (!ids.length) return false;
  return ids.every(id=>{
    if (!booking.testIds.includes(id) || !w.tests.some(t=>t.id===id)) return false;
    if (!w.requirements) return true;
    const requirement=w.requirements.find(r=>r.test.id===id && r.retiredAtRevision===null);
    return !!requirement && !!booking.requirementIds?.includes(requirement.requirementId);
  });
}
export function reconcileRecommendations(old: ServiceWorkflow, tests: ServiceTest[], complete: boolean,
  revision: number, context: string, now: Date): ServiceWorkflow {
  const w=structuredClone(old);
  ensureRecommendationRecords(w);
  const priorActive=w.requirements!.filter(r=>r.retiredAtRevision===null);
  const changedContext=w.clinicalContext !== undefined && w.clinicalContext !== context;
  // Unknown legacy context is not evidence that an old decision reviewed these answers.
  if (changedContext || w.clinicalContext === undefined) w.consultation='undecided';
  w.clinicalContext=context;
  w.questionnaireRevision=revision;
  w.recommendationsPending=!complete;
  w.tests=structuredClone(tests);
  if (!complete) {
    w.receivedTestIds=[];
    w.lastResultsAt=old.allResultsAt ?? old.lastResultsAt;
    w.allResultsAt=null;
    return w;
  }
  const changes={added:[] as string[],removed:[] as string[],changed:[] as string[]};
  for (const prior of priorActive) {
    const next=tests.find(t=>t.id===prior.test.id);
    if (!next || next.method !== prior.test.method) {
      prior.retiredAtRevision=revision;
      (next ? changes.changed : changes.removed).push(prior.test.id);
    } else prior.test=structuredClone(next);
  }
  for (const test of tests) {
    if (!w.requirements!.some(r=>r.retiredAtRevision===null && r.test.id===test.id)) {
      const requirementId=`requirement-${w.requirements!.length+1}-${test.id}`;
      w.requirements!.push({requirementId,test:structuredClone(test),introducedAtRevision:revision,retiredAtRevision:null});
      if (!changes.changed.includes(test.id)) changes.added.push(test.id);
    }
  }
  w.recommendationChanges=changes;
  const active=w.requirements!.filter(r=>r.retiredAtRevision===null);
  w.receivedTestIds=active.filter(r=>w.receiptHistory!.some(receipt=>receipt.requirementId===r.requirementId)).map(r=>r.test.id);
  const sameRequirements=changes.added.length+changes.removed.length+changes.changed.length===0;
  const receipts=w.receiptHistory!.filter(r=>active.some(q=>q.requirementId===r.requirementId));
  const latestReceipt=receipts.length && receipts.every(r=>r.receivedAt) ? receipts.map(r=>r.receivedAt!).sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1) : null;
  w.allResultsAt=tests.every(t=>w.receivedTestIds.includes(t.id)) ? (sameRequirements ? old.allResultsAt ?? old.lastResultsAt : null) ?? latestReceipt ?? now.toISOString() : null;
  if (w.allResultsAt) w.lastResultsAt=w.allResultsAt;
  for (const booking of w.bookings.filter(b=>b.status==='scheduled')) {
    const affected=booking.testIds.filter(id=>!active.some(r=>r.test.id===id && booking.requirementIds!.includes(r.requirementId)));
    // An unresolved review cannot disappear merely because a test ID comes back.
    if (affected.length) { delete booking.providerPreparation; booking.review={reason:'Recommendations changed. Review this reservation before using it for the current plan.',changedTestIds:affected}; }
  }
  return w;
}
