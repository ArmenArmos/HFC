import assert from 'node:assert/strict';
import {readRealOperationsSummary, realOperationsSummarySchema} from '@/lib/staff/real-operations-summary-model';
const snapshot = {
  asOf:'2026-10-15T07:00:00+00:00',
  cases:{total:3,doctorAssigned:2,doctorUnassigned:1,nurseAssigned:1,nurseUnassigned:2},
  bookings:{total:5,requested:1,providerProposed:1,confirmed:1,changePending:1,cancelled:1},
  coordination:{total:5,open:1,awaitingMember:1,awaitingDoctor:1,completed:1,cancelled:1,needsReassignment:2},
};
assert.deepEqual(realOperationsSummarySchema.parse(snapshot), snapshot);
for (const invalid of [null, {}, {...snapshot,asOf:'yesterday'}, {...snapshot,cases:{...snapshot.cases,total:-1}}, {...snapshot,cases:{...snapshot.cases,total:4}}, {...snapshot,bookings:{...snapshot.bookings,total:6}}, {...snapshot,coordination:{...snapshot.coordination,needsReassignment:4}}]) {
  assert.equal(realOperationsSummarySchema.safeParse(invalid).success,false,'Incomplete or inconsistent counts must be unavailable');
}
assert.deepEqual(await readRealOperationsSummary(async()=>({data:snapshot,error:null})),{status:'available',summary:snapshot});
for (const read of [async()=>({data:null,error:null}), async()=>({data:snapshot,error:{message:'failure'}}), async()=>{throw Error('network');}]) {
  assert.deepEqual(await readRealOperationsSummary(read),{status:'unavailable'},'A failed read must never become zero counts');
}
const zero=structuredClone(snapshot);
for(const group of [zero.cases,zero.bookings,zero.coordination]) for(const key of Object.keys(group)) (group as Record<string,number>)[key]=0;
assert.equal((await readRealOperationsSummary(async()=>({data:zero,error:null}))).status,'available','A valid zero snapshot is distinct from unavailable');
console.log('Real operations summary checks passed: exact reconciliation, zero snapshot, malformed and failed reads.');
