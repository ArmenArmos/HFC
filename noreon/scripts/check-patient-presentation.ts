import assert from 'node:assert/strict';
import { patientPresentation } from '@/lib/patient/presentation';
const incomplete={answers:{},urgentRule:null,completedAt:null};
assert.deepEqual(patientPresentation(incomplete),{urgent:false,showRoutine:false});
assert.deepEqual(patientPresentation({...incomplete,completedAt:'2026-10-12'}),{urgent:false,showRoutine:true});
assert.deepEqual(patientPresentation({...incomplete,urgentRule:'RF-01',completedAt:'2026-10-12'}),{urgent:true,showRoutine:false});
console.log('Urgent state overrides completed assessment; incomplete assessment cannot show routine tasks.');

assert.deepEqual(patientPresentation({...incomplete,answers:{'q9.right_now':{fieldId:'q9.right_now',value:'yes',source:'manual',answeredAt:'2026-10-12T00:00:00Z'}},completedAt:'2026-10-12'}),{urgent:true,showRoutine:false});
