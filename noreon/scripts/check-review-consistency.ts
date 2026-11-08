import assert from 'node:assert/strict';
import { createWorkflow, applyServiceCommand, workflowCare } from '@/lib/service-workflow/model';
import { evaluate } from '@/lib/clinical/rules/engine';
import type { Answers } from '@/lib/clinical/types';
const now = new Date('2026-10-10T05:00:00Z');
let w = createWorkflow([{id:'lipid-panel', title:'Lipid panel', method:'lab', preparation:'Fast for 8 to 12 hours.', source:'fictional'}], now);
w = applyServiceCommand(w, {type:'book', testIds:['lipid-panel'], at:'2026-10-13T09:00:00+04:00',mode:'clinic',address:''},now);
let care = workflowCare(w, [], false);
assert.equal(care.tests[0].status, 'booked', 'Booked tests cannot be labelled To arrange');
assert.equal(care.appointments.length,1, 'Test visits must appear in My care appointments');
assert.equal(care.appointments[0].startsAt, w.bookings[0].at);
assert.ok(!care.tests[0].preparation?.startsWith('Fast'), 'Demo does not prescribe unapproved preparation');
w = applyServiceCommand(w, {type:'cancel',bookingId:w.bookings[0].id}, now);
care = workflowCare(w, [], false);
assert.equal(care.tests[0].status,'ordered');
assert.equal(care.appointments.length,0);
const answers = (diagnosed:string): Answers => Object.fromEntries(Object.entries({'q5.diagnosed':diagnosed,'q5.last_reading.systolic':136,'q5.last_reading.diastolic':82}).map(([fieldId,value])=>[fieldId,{fieldId,value,source:'manual',answeredAt:now.toISOString()}]));
for (const diagnosis of ['treated','untreated']) {
  assert.ok(!evaluate({answers:answers(diagnosis), observations:[]}).findings.some(f=>f.ruleId==='NRN-RULE-BP-004'),'Annual screening message must not override known hypertension');
}
assert.ok(evaluate({answers:answers('no'), observations:[]}).findings.some(f=>f.ruleId==='NRN-RULE-BP-004'));
console.log('Booked/cancelled status, appointments, demo preparation and known-hypertension messaging pass.');
