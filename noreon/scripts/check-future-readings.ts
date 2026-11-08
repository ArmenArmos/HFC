// Future-dated blood pressure readings (live finding 18 Oct): entry refuses a measured time more than
// 5 minutes ahead, and clinical readers ignore future rows. The SQL side is in check-zoe-symptom-intake.sql.
import assert from 'node:assert/strict';
import {isFutureMeasurement,pastReadings,armeniaLocalNow,FUTURE_TOLERANCE_MS} from '@/lib/patient/measured-at';
import {validMeasurement} from '@/lib/patient/validation';
import {textRedFlags} from '@/lib/zoe/symptoms/red-flags';
import {saveVisitEvidence,type VisitRpc} from '@/lib/staff/visit-evidence-runtime';
import type {VisitCommand} from '@/lib/staff/visit-evidence-schema';

const now=Date.parse('2026-10-18T11:47:00Z');
const at=(ms:number)=>new Date(now+ms).toISOString();

// 1. The tolerance compares instants, whatever offset the string carries.
assert.equal(FUTURE_TOLERANCE_MS,300_000);
assert.equal(isFutureMeasurement(at(0),now),false);
assert.equal(isFutureMeasurement(at(-86400000),now),false);
assert.equal(isFutureMeasurement(at(299_000),now),false,'Clock skew up to 5 minutes is accepted');
assert.equal(isFutureMeasurement(at(301_000),now),true);
assert.equal(isFutureMeasurement('2026-10-22T09:28:00Z',now),true,'The staging row (four days ahead) is refused');
assert.equal(isFutureMeasurement('2026-10-18T15:50:00+04:00',now),false,'15:50 Yerevan is 11:50 UTC: 3 minutes ahead, accepted');
assert.equal(isFutureMeasurement('2026-10-18T15:53:00+04:00',now),true,'15:53 Yerevan is 6 minutes ahead, refused');
assert.equal(isFutureMeasurement('2026-10-18T23:00:00+04:00',now),true,'Later today in Yerevan is still the future');
assert.equal(isFutureMeasurement('not a time',now),true);
assert.equal(armeniaLocalNow(now),'2026-10-18T15:47','Picker max is Armenia wall-clock now');

// 2. Member entry (web and native share this check).
const reading=(measuredAt:string)=>({submissionId:'0ce2559d-61a5-4f5a-8b51-bf16ed58626b',systolic:160,diastolic:120,measuredAt});
assert.equal(validMeasurement(reading(at(-3600000)),new Date(now)),true);
assert.equal(validMeasurement(reading('2026-10-22T09:28:00Z'),new Date(now)),false);
assert.equal(validMeasurement(reading(at(6*60000)),new Date(now)),false);

// 3. Readers: future rows are ignored.
const rows=[{id:'a',measuredAt:at(-7200000)},{id:'b',measuredAt:'2026-10-22T09:28:00Z'},{id:'c',measuredAt:at(0)}];
assert.deepEqual(pastReadings(rows,now).map(r=>r.id),['a','c']);

// 4. RF-03 with a stored reading: only measured_at in [now-24h, now] counts.
const rf03=(minutesAgo:number,systolic=185,diastolic=112)=>textRedFlags(['I have a headache'],{intakeActive:false,latestReading:{systolic,diastolic,minutesAgo}}).some(h=>h.id==='bp_crisis_reading');
assert.equal(rf03(60),true,'185/112 an hour ago plus a symptom still escalates');
assert.equal(rf03(0),true);
assert.equal(rf03(24*60),true);
assert.equal(rf03(24*60+1),false);
assert.equal(rf03(-5732,160,120),false,'A future-dated reading never counts');
assert.equal(rf03(60,160,100),false,'Below the threshold (unchanged)');

// 5. Nurse visit evidence: a future observed time never reaches the RPC.
const id=(n:number)=>`b2500000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const calls:string[]=[];
const client:VisitRpc={rpc:async(name)=>{calls.push(name);return {data:null,error:{code:'23514'}};}};
const future=new Date(Date.now()+86400000).toISOString();
const command=(observedAt:string):VisitCommand=>({version:'visit-evidence-v1',op:'append-evidence',id:id(1),revision:2,submissionId:id(2),visitId:id(3),entries:[
 {kind:'observation',field:'systolic',observedAt,state:'known',value:160,unit:'mmHg'},{kind:'observation',field:'diastolic',observedAt,state:'known',value:120,unit:'mmHg'}]});
const refused=await saveVisitEvidence({memberId:id(1),client},command(future));
assert.equal(refused.status,'invalid');assert.deepEqual(calls,[],'Future visit evidence is refused before the RPC');
// The database trigger's check_violation (23514) also reads as invalid, not as an unknown outcome.
assert.equal((await saveVisitEvidence({memberId:id(1),client},command(new Date(Date.now()-60000).toISOString()))).status,'invalid');
assert.deepEqual(calls,['patient_staff_visit_command']);
console.log('Future-dated readings: entry and reader checks pass.');
