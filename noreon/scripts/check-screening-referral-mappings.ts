import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPlan, evaluate } from '@/lib/clinical/rules/engine';
import type { Answers, Decision, FieldValue } from '@/lib/clinical/types';

const decide = (values: Record<string, FieldValue>) => evaluate({
  answers: Object.fromEntries(Object.entries(values).map(([fieldId, value]) => [fieldId, {
    fieldId, value, source: 'manual', answeredAt: '2026-10-15T00:00:00Z',
  }])) as Answers,
  observations: [],
});
const stablePain = { 'q9.present': 'yes', 'q9.right_now': 'no' };
const ids = (decision: Decision) => buildPlan(decision).map(test => test.id).sort();
function isolated(decision: Decision, ruleId: string): Decision {
  const findings = decision.findings.filter(finding => finding.ruleId === ruleId);
  assert.equal(findings.length, 1, `Fixture must actually fire ${ruleId}`);
  return { ...decision, findings };
}

// v1.1 P339 and Armen TC-05 name ECG, lipids, Hb and TSH.
test('stable-pain finding independently supplies ECG, lipids, Hb and catalogue TSH', () => {
  const decision = decide(stablePain);
  assert.equal(decision.urgency, 'yellow');
  const plan = buildPlan(isolated(decision, 'NRN-RULE-CP-002'));
  assert.deepEqual(plan.map(test => test.id).sort(), ['cbc-hb', 'ecg-12-lead', 'lipid-panel', 'tsh']);
  assert.equal(plan.find(test => test.id === 'tsh')?.catalogueRef, 'TSH');
  assert.equal(plan.find(test => test.id === 'cbc-hb')?.catalogueRef, 'Արյան ընդհանուր + լեյկոֆորմուլա');
});

test('RF-12 independently supplies the ECG named in its next step', () => {
  const decision = decide({ 'q7.relatives': ['sudden_death'], 'q10.symptoms': 'yes' });
  assert.equal(decision.urgency, 'orange');
  assert.deepEqual(ids(isolated(decision, 'RF-12')), ['ecg-12-lead']);
});

test('STOP-BANG finding prints the numeric partial score in every language', () => {
  const decision = decide({ 'q8.breathing': 'both', 'q8.daytime_sleepiness': 'often', 'q1.sex': 'male' });
  const finding = decision.findings.find(finding => finding.ruleId === 'NRN-RULE-APN-001');
  assert.ok(finding);
  assert.deepEqual(finding.detail, { en: 'STOP-BANG 4/8 *', hy: 'STOP-BANG 4/8 *', ru: 'STOP-BANG 4/8 *' });
  const complete = decide({ 'q8.breathing': 'both', 'q8.daytime_sleepiness': 'often', 'q1.sex': 'male', 'q8.neck': 39 });
  assert.deepEqual(complete.findings.find(finding => finding.ruleId === 'NRN-RULE-APN-001')?.detail,
    { en: 'STOP-BANG 4/8', hy: 'STOP-BANG 4/8', ru: 'STOP-BANG 4/8' });
});

test('mapping fixes introduce no SCD-only escalation or unrelated TSH/ECG suggestion', () => {
  const scenarios: Record<string, FieldValue>[] = [
    {}, { 'q9.present': 'no' }, { 'q7.relatives': ['sudden_death'] }, { 'q8.breathing': 'no' },
  ];
  for (const values of scenarios) {
    const decision = decide(values);
    assert.ok(!decision.findings.some(finding => finding.ruleId === 'RF-12'));
    assert.ok(!ids(decision).includes('tsh'));
    assert.ok(!ids(decision).includes('ecg-12-lead'));
    assert.ok(!decision.findings.some(finding => finding.ruleId === 'NRN-RULE-APN-001'));
  }
});

test('current chest pain retains red precedence over RF-12 and routine referrals', () => {
  const decision = decide({ 'q9.present': 'yes', 'q9.right_now': 'yes', 'q7.relatives': ['sudden_death'], 'q10.symptoms': 'yes' });
  assert.equal(decision.urgency, 'red');
  assert.ok(decision.findings.some(finding => finding.ruleId === 'RF-01'));
  assert.ok(!decision.findings.some(finding => finding.ruleId === 'NRN-RULE-CP-002'));
  assert.ok(!ids(decision).includes('tsh'));
});

test('raised BP retains the reported medication context without changing classification or deadlines', () => {
  for (const diagnosis of ['treated', 'untreated']) {
    const decision = decide({ 'q5.diagnosed': diagnosis, 'q5.last_reading.systolic': 150, 'q5.last_reading.diastolic': 95 });
    assert.equal(decision.urgency, 'yellow');
    const finding = decision.findings.find(finding => finding.ruleId === 'NRN-RULE-BP-002')!;
    assert.equal(finding.consultationWithinDays, 14);
    assert.equal(finding.detail?.en, diagnosis === 'treated'
      ? '150/95 mmHg. You reported taking blood pressure medication.' : '150/95 mmHg');
    assert.equal(finding.detail?.hy, diagnosis === 'treated'
      ? '150/95 mmHg։ Դուք նշել եք, որ ընդունում եք ճնշման դեղեր։' : '150/95 mmHg');
    assert.ok(!/above target/i.test(finding.detail?.en ?? ''));
  }
  const urgent = decide({ 'q5.diagnosed': 'treated', 'q5.last_reading.systolic': 190,
    'q5.last_reading.diastolic': 115, 'q5.crisis_symptoms': ['headache'] });
  assert.equal(urgent.urgency, 'red');
});
