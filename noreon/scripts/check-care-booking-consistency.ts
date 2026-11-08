import * as textLanguage from '@/lib/text-language';
import * as nextStepCopy from '@/lib/zoe-chat-actions/next-step-copy';
import * as memberStaffNames from "@/lib/member-staff-name.mjs";
import assert from 'node:assert/strict';
import { createWorkflow, applyServiceCommand, workflowCare } from '../lib/service-workflow/model';
import { applyDemoBookingOperation, demoBookingContext } from '../lib/demo-booking/model';
import type { BookingTerms } from '../lib/real-booking/schema';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { appointmentIsCurrent } from '../lib/patient-care/model';
import { formatMemberDate } from '../lib/patient/date-format';

// Render the real appointment component, with only its shared presentation
// primitives supplied locally; provider identity comes from the real lifecycle.
const require = createRequire(import.meta.url);
const layoutExports: Record<string, unknown> = {};
const layoutCode = ts.transpileModule(readFileSync('components/patient-care/care-layout.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
new vm.Script(layoutCode).runInNewContext({ exports: layoutExports, require(name: string) {
  if (name === '@/lib/text-language') return textLanguage;
  if (name === '@/lib/zoe-chat-actions/next-step-copy') return nextStepCopy;
  if (name === 'react/jsx-runtime') return jsx;
  if (name === "@/lib/member-staff-name.mjs") return memberStaffNames;
  if (name.endsWith('/patient-care/model')) return { appointmentIsCurrent };
  if (name.endsWith('/date-format')) return { formatMemberDate };
  if (name === './regimen-changes') return { RegimenChanges: () => null };
  if (name === './common') return {
    copy: (locale: string, en: string, hy: string) => locale === 'hy' ? hy : en,
    stamp: (value: string) => value,
    Status: ({ children }: { children: React.ReactNode }) => React.createElement('span', null, children),
    IconTile: ({ children }: { children: React.ReactNode }) => React.createElement('span', null, children),
  };
  return require(name);
} });
const CareAppointments = layoutExports.CareAppointments as typeof import('../components/patient-care/care-layout').CareAppointments;

const now = new Date('2026-10-14T08:00:00Z');
const member = { id: 'fixture-member', role: 'member' as const };
const admin = { id: 'fixture-ops', role: 'admin' as const };
const terms: BookingTerms = { startsAt: '2026-10-16T06:00:00Z', endsAt: '2026-10-16T07:00:00Z', timezone: 'Asia/Yerevan', mode: 'clinic', location: 'Fictional clinic, 12 Example Street' };
const id = '00000000-0000-4000-8000-000000000040';
const input = { provider: 'Fictional provider', terms, obtainedAt: '2026-10-14T07:00:00Z', channel: 'phone' as const, source: 'F40 fictional booking fixture', preparation: 'Fictional provider instructions.', replacesExisting: false };
let w = createWorkflow([{ id: 'lab', title: 'Fictional laboratory check', method: 'lab', preparation: '', source: 'fictional' }], now);
w = applyDemoBookingOperation(w, { operation: 'create', id, contextToken: demoBookingContext(w), testIds: ['lab'], terms }, member, now);
assert.equal(workflowCare(w, [], false).appointments.length, 0, 'A preference request creates no confirmed visit');
w = applyDemoBookingOperation(w, { operation: 'confirm', id, revision: 0, commandId: 'proposal', input }, admin, now);
assert.equal(workflowCare(w, [], false).appointments.length, 0, 'Provider terms without member acceptance create no confirmed visit');
w = applyDemoBookingOperation(w, { operation: 'accept', id, revision: 1, commandId: 'accept' }, member, now);
const accepted = structuredClone(w);
const beforeProjection = structuredClone(w);
const visit = workflowCare(w, [], false).appointments[0];
assert.equal(visit.location, 'Fictional clinic, 12 Example Street', 'Care preserves the exact accepted clinic location');
assert.equal(visit.status, 'confirmed', 'Care reflects the effective accepted booking');
assert.equal(visit.clinician, 'Fictional provider', 'Care identifies the accepted laboratory provider rather than reporting an unassigned doctor');
assert.equal(visit.startsAt, '2026-10-16T06:00:00Z');
for (const locale of ['en', 'hy'] as const) {
  const html = renderToStaticMarkup(React.createElement(CareAppointments, { appointments: [visit], locale, now }));
  assert.match(html, /Fictional provider/, 'Rendered visit shows the accepted provider');
  assert.doesNotMatch(html, /Clinician not assigned yet|Բժիշկը դեռ նշանակված չէ/, 'Accepted provider prevents the false unassigned-doctor fallback in either locale');
}
assert.equal(workflowCare(w, [], false).tests[0].location, 'Fictional clinic, 12 Example Street');
assert.deepEqual(w, beforeProjection, 'Projection must retain provider provenance and leave the workflow unchanged');

for (const condition of ['recommendations-pending', 'booking-review'] as const) {
  const held = structuredClone(accepted);
  if (condition === 'recommendations-pending') held.recommendationsPending = true;
  else held.bookings[0].review = { reason: 'Recommendations changed', changedTestIds: ['lab'] };
  const heldVisit = workflowCare(held, [], false).appointments[0];
  assert.equal('needsReview' in heldVisit && heldVisit.needsReview, true, 'Accepted arrangements whose requirements no longer apply must carry review context');
  assert.equal(heldVisit.status, 'confirmed', 'Requirement review does not revoke provider acceptance');
  assert.equal(heldVisit.location, 'Fictional clinic, 12 Example Street');
  assert.equal(heldVisit.clinician, 'Fictional provider');
  for (const locale of ['en', 'hy'] as const) {
    const html = renderToStaticMarkup(React.createElement(CareAppointments, { appointments: [heldVisit], locale, now }));
    assert.match(html, locale === 'en' ? /Your test requirements need review/ : /Ձեր հետազոտությունների ցանկը վերանայման կարիք ունի/);
    assert.match(html, /Fictional provider/);
    const valid = renderToStaticMarkup(React.createElement(CareAppointments, { appointments: [visit], locale, now }));
    assert.doesNotMatch(valid, /Your test requirements need review|Ձեր հետազոտությունների ցանկը վերանայման կարիք ունի/, 'Applicable accepted arrangements have no review warning');
  }
}

const replacement = { ...terms, startsAt: '2026-10-17T06:00:00Z', endsAt: '2026-10-17T07:00:00Z', mode: 'home' as const, location: 'Fictional home, 34 Example Street' };
w = applyDemoBookingOperation(w, { operation: 'request-change', id, revision: 2, commandId: 'change', terms: replacement }, member, now);
w = applyDemoBookingOperation(w, { operation: 'confirm', id, revision: 3, commandId: 'replacement-proposal', input: { ...input, terms: replacement, replacesExisting: true } }, admin, now);
w = applyDemoBookingOperation(w, { operation: 'accept', id, revision: 4, commandId: 'replacement-accept' }, member, now);
assert.deepEqual(workflowCare(w, [], false).appointments[0], visit, 'A pending replacement keeps the effective accepted visit');
w = applyDemoBookingOperation(w, { operation: 'change-outcome', id, revision: 5, commandId: 'replacement-outcome', outcome: 'accepted', source: input }, admin, now);
const homeVisit = workflowCare(w, [], false).appointments[0];
assert.equal(homeVisit.location, 'Fictional home, 34 Example Street');
assert.equal(homeVisit.status, 'confirmed');
assert.equal(homeVisit.clinician, 'Fictional provider');
assert.equal(homeVisit.startsAt, '2026-10-17T06:00:00Z');
assert.equal(workflowCare(w, [], false).appointments.length, 1, 'Replaced bookings do not remain active visits');

const received = applyServiceCommand(w, { type: 'receive', testIds: ['lab'] }, now, admin);
assert.equal(workflowCare(received, [], false).appointments[0].status, 'confirmed', 'Result receipt does not establish visit completion');
assert.equal(workflowCare(received, [], false).tests[0].status, 'collected', 'Result receipt still advances test evidence');
let cancellation = applyDemoBookingOperation(accepted, { operation: 'cancel', id, revision: 2, commandId: 'cancel' }, member, now);
assert.deepEqual(workflowCare(cancellation, [], false).appointments[0], visit, 'Pending cancellation retains the accepted arrangement');
cancellation = applyDemoBookingOperation(cancellation, { operation: 'change-outcome', id, revision: 3, commandId: 'cancel-outcome', outcome: 'accepted', source: input }, admin, now);
assert.equal(workflowCare(cancellation, [], false).appointments.length, 0);

const legacy = createWorkflow(accepted.tests, now);
legacy.bookings = [{ id: 'legacy', testIds: ['lab'], at: terms.startsAt, mode: 'clinic', address: '', status: 'scheduled' }];
assert.equal(workflowCare(legacy, [], false).appointments[0].status, 'requested', 'Legacy scheduling has no member-accepted provider arrangement');
assert.equal(workflowCare(legacy, [], false).appointments[0].location, 'Clinic · location not confirmed');
assert.equal(workflowCare(legacy, [], false).appointments[0].clinician, null, 'Legacy scheduling must not invent a provider');
legacy.receivedTestIds = ['lab'];
assert.equal(workflowCare(legacy, [], false).appointments[0].status, 'requested', 'Legacy result receipt also does not establish visit completion');
console.log('Care booking consistency passed: accepted clinic/home terms, pending changes/cancellation, unaccepted proposals, independent result receipt, legacy scheduling and immutable provenance.');
