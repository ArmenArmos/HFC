// Synthetic inputs for the real buildOverview, so the fixture exercises the server rule, not a canned view.
import { yerevanDate, addDays } from '@/lib/bp-week/model';
import type { MemberLdl } from '@/lib/ldl/schema';
import type { OverviewFacts } from '@/lib/patient/overview';
import type { PatientLocale } from '@/lib/patient/copy';
import type { CarePlan } from '@/lib/patient-care/types';

const uuid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LONG = 'Շատերկարհայերենբառորըչպետքէդուրսգաէկրանիցևպետքէնորտողովշարունակվիանպայմանամինչևվերջ';

export function overviewFacts(query: URLSearchParams, locale: PatientLocale): OverviewFacts {
  // A fixed clock keeps the 24-hour zone rule and the reading counts the same at any hour of the day.
  const base = new Date('2026-11-02T12:00:00+04:00'), today = yerevanDate(base);
  const newestReading = Date.parse(`${addDays(today, -1)}T20:00:00+04:00`);
  const now = query.has('age') ? new Date(newestReading + Number(query.get('age')) * 3600000) : base;
  const state = query.get('state') ?? 'approved', long = query.has('long');
  const name = long ? `Ani ${LONG}` : 'Ani';
  if (state === 'empty') return {
    now, locale, name, doctor: 'STAGING Test Doctor', consent: undefined, questionnaireComplete: false, care: { plan: null, events: [], tests: [], appointments: [] }, home: null, clinicBp: null,
    bpWeek: null, ldl: undefined, medicines: null, uploaded: null, released: null, labResultsReceived: false, visitDone: false, bookedVisit: null,
  };
  const approved = state !== 'waiting';
  const at = (back: number, hour: string) => new Date(`${addDays(today, -back)}T${hour}:00:00+04:00`).toISOString();
  const home = Array.from({ length: 10 }, (_, i) => [
    { id: uuid(100 + i), submissionId: uuid(200 + i), systolic: 128 + (i % 4) * 3, diastolic: 82 + (i % 3), pulse: 70, measuredAt: at(i + 1, '08'), source: 'manual' as const },
    { id: uuid(300 + i), submissionId: uuid(400 + i), systolic: 134 + (i % 3) * 4, diastolic: 84 + (i % 2) * 2, pulse: 72, measuredAt: at(i + 1, '20'), source: 'manual' as const },
  ]).flat();
  if (query.has('high')) home.push({ id: uuid(500), submissionId: uuid(501), systolic: 190, diastolic: 125, pulse: 80, measuredAt: at(0, '00'), source: 'manual' });
  const plan: CarePlan = {
    id: uuid(1), clinician: 'Synthetic doctor', publishedAt: at(9, '09'), instructions: 'Synthetic plan', acknowledgedAt: null,
    medications: [{ id: uuid(2), planId: uuid(1), name: long ? LONG : 'Atorvastatin', dose: '20 mg', instructions: '', times: ['00:00', '23:59'], startDate: addDays(today, -9), endDate: null, active: true, effectiveAt: at(9, '09') }],
  };
  const ldl: MemberLdl = { version: 'ldl-member-v1', enabled: true, inPathway: true, retest: null, withDoctor: query.has('with-doctor') ? { since: at(1, '09'), doctorName: null } : null,
    goal: { version: 1, category: 'very_high', thresholdMmol: 1.4, reductionRule: true, reductionPct: 50, nextTestOn: addDays(today, 40), setAt: at(9, '09'), doctorName: 'Dr. Mariam',
      baseline: { kind: 'pre_treatment', mmol: 4.2, on: addDays(today, -60), source: 'lab_result' } },
    observations: [
      { id: 'cr:1', value: 1.9, unit: 'mmol/L', on: addDays(today, -6), source: 'clinic_result', name: 'LDL-C', memberVisible: true },
      { id: 'mr:1', value: 1.1, unit: 'mmol/L', on: addDays(today, -1), source: 'member', name: null, memberVisible: true },
    ] };
  return {
    now, locale, name, doctor: long ? `Dr. ${LONG}` : 'Dr. Mariam', consent: true, questionnaireComplete: true,
    care: state === 'care-failed' ? null : { plan: approved ? plan : null, events: approved ? [{ medicationId: uuid(2), dueAt: new Date(`${today}T00:00:00+04:00`).toISOString(), status: 'taken', recordedAt: at(0, '00') }] : [],
      tests: [{ id: uuid(3), title: long ? LONG : 'Lipid profile', preparation: long ? LONG : 'Do not eat for 12 hours before the test.', status: 'ordered', orderedBy: 'Dr. Mariam', orderedAt: at(3, '09'), dueAt: addDays(today, 5), location: 'Arabkir clinic', source: 'clinic', sourceLabel: 'Clinic' }], appointments: [] },
    home, clinicBp: [], bpWeek: { version: 'bp-week-v1', enabled: true, today, currentDevice: null, weeks: [{ id: uuid(4), startsOn: addDays(today, -4), days: 7, readingsPerSlot: 2, morningTime: '08:00', eveningTime: '20:00', reminders: true, startedByRole: 'nurse', createdAt: at(4, '08'), stoppedAt: null, stopReason: null, device: null, readings: [] }] },
    ldl, medicines: { version: 'member-medicines-v1', enabled: false },
    uploaded: [{ id: uuid(5), fileName: long ? `${LONG}.pdf` : 'blood-test.pdf', resultDate: addDays(today, -20), createdAt: at(19, '10') }],
    released: [{ fileId: uuid(6), clinic: 'Arabkir clinic', uploadedAt: at(5, '12'), releasedAt: at(5, '13') }],
    labResultsReceived: true, visitDone: true, bookedVisit: { startsAt: new Date(`${addDays(today, 7)}T11:00:00+04:00`).toISOString(), location: 'Arabkir clinic, room 4', clinic: 'Arabkir clinic', preparation: null },
  };
}
