import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {clinicalBookingFailure,clinicalBookingHold} from '../lib/real-booking/form-error';
import {clinicalReviewEngine} from '../lib/patient-care/clinical-review-engine';
import type {ClinicalSnapshot} from '../lib/patient-care/clinical-case-repository';
const answers=JSON.parse(readFileSync('scripts/fixtures/patient-answers.json','utf8'));
const original={id:'83000000-0000-4000-8000-000000000001',revision:0,evidenceToken:'test',draft:null,draftSavedAt:null,draftStale:false,evidence:{visits:[],profile:{name:'Synthetic original name',birthDate:'1974-01-01',biologicalSex:answers['q1.sex'].value},consent:{version:'patient-pilot-v1'},assessment:{revision:1,assessment_date:'2026-10-12',answers,completed_at:'2026-10-12T00:00:00Z',urgent_rule:null},measurements:[],reports:[]}} as ClinicalSnapshot;
const reading={id:'synthetic-reading',systolic:120,diastolic:80,pulse:null,measured_at:'2026-10-13T00:00:00Z'};
const corrected={...original,evidence:{...original.evidence,profile:{...original.evidence.profile,name:'Synthetic corrected name'},measurements:[reading]}};
assert.deepEqual(clinicalReviewEngine(corrected),clinicalReviewEngine(original),'ordinary source changes preserve actual engine eligibility and requirements');
try { clinicalReviewEngine({...corrected,evidence:{...corrected.evidence,measurements:[reading,{...reading,id:'synthetic-crisis',systolic:190,diastolic:120}]}}); assert.fail('Crisis engine must reject'); } catch(error) { assert.match((error as Error).message,/symptom triage/); assert.equal(clinicalBookingFailure(error),clinicalBookingHold,'Real engine crisis errors map to safe hold guidance'); }
assert.throws(()=>clinicalReviewEngine({...corrected,evidence:{...corrected.evidence,consent:null}}),/Complete/,'current consent is required even with unchanged test titles');
console.log('Booking safety: normal reading/name correction preserves requirements; crisis and absent consent still stop actual engine.');
