import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {clinicalReviewEngine,clinicalConsultationProposal} from '../lib/patient-care/clinical-review-engine';
import type {ClinicalSnapshot} from '../lib/patient-care/clinical-case-repository';
const answers=JSON.parse(readFileSync('scripts/fixtures/patient-answers.json','utf8'));
const snapshot={id:'71000000-0000-4000-8000-000000000001',revision:0,evidenceToken:'test',draft:null,draftSavedAt:null,draftStale:false,evidence:{visits:[],profile:{name:'Synthetic fixture',birthDate:'1974-01-01',biologicalSex:answers['q1.sex'].value},consent:{version:'patient-pilot-v1'},assessment:{revision:1,assessment_date:'2026-10-12',answers,completed_at:'2026-10-12T00:00:00Z',urgent_rule:null},measurements:[],reports:[]}} as ClinicalSnapshot;
const engine=clinicalReviewEngine(snapshot);
assert.ok(engine.tests.some(t=>t.id==='lipid-panel'));
assert.ok(engine.version.startsWith('NRN-CLIN-ALG-001'));
assert.throws(()=>clinicalReviewEngine({...snapshot,evidence:{...snapshot.evidence,assessment:{...snapshot.evidence.assessment!,completed_at:null}}}),/Complete/);
assert.throws(()=>clinicalReviewEngine({...snapshot,evidence:{...snapshot.evidence,assessment:{...snapshot.evidence.assessment!,answers:{}}}}),/incomplete/);
assert.throws(()=>clinicalReviewEngine({...snapshot,evidence:{...snapshot.evidence,profile:{...snapshot.evidence.profile,birthDate:'1990-01-01'}}}),/disagree/);
assert.throws(()=>clinicalReviewEngine({...snapshot,evidence:{...snapshot.evidence,assessment:{...snapshot.evidence.assessment!,urgent_rule:'RF-01'}}}),/urgent/);
console.log('Trusted real clinical engine: actual assessment, profile consistency, required lipid evidence and urgency checks pass.');

for(const reading of [{systolic:190,diastolic:115},{systolic:180,diastolic:80},{systolic:150,diastolic:110}]){
 const measurements=[...Array.from({length:25},(_,i)=>({id:String(i),systolic:120,diastolic:80,pulse:null,measured_at:'2026-10-12T02:00:00Z'})),{id:'unresolved',...reading,pulse:null,measured_at:'2026-10-12T01:00:00Z'}];
 assert.throws(()=>clinicalReviewEngine({...snapshot,evidence:{...snapshot.evidence,measurements}}),/symptom triage/);
}
function withAnswers(values:Record<string,string|number|string[]>){return {...snapshot,evidence:{...snapshot.evidence,assessment:{...snapshot.evidence.assessment!,answers:{...answers,...Object.fromEntries(Object.entries(values).map(([fieldId,value])=>[fieldId,{fieldId,value,source:'manual',answeredAt:'2026-10-12T00:00:00Z'}]))}}}} as ClinicalSnapshot;}
assert.throws(()=>clinicalReviewEngine(withAnswers({'q5.last_reading.systolic':190,'q5.last_reading.diastolic':115,'q5.crisis_symptoms':['none']})),/source-specific mandatory consultation/);
assert.throws(()=>clinicalReviewEngine(withAnswers({'q9.present':'yes','q9.right_now':'no','q9.frequency':'daily','q9.crescendo':'same','q9.at_rest':'no','q9.duration':'1_5'})),/source-specific mandatory consultation/);
assert.ok(clinicalReviewEngine(withAnswers({'q5.last_reading.systolic':'unknown','q5.last_reading.diastolic':'unknown'})).tests.some(t=>t.id==='bp-home-log'&&t.method==='home-log'&&t.source.includes('NRN-RULE-BP-003')));

for(const [locale,note] of [['en','Medical consultation within 2 weeks'],['hy','Բժշկի խորհրդատվություն՝ 2 շաբաթվա ընթացքում'],['ru','Консультация врача в течение 2 недель']] as const){
 assert.deepEqual(clinicalConsultationProposal(snapshot,locale),{decision:'required',note},'Use the engine’s actual localized sentence');
}
assert.equal(clinicalConsultationProposal({...snapshot,evidence:{...snapshot.evidence,consent:null}}),null);
assert.equal(clinicalConsultationProposal(withAnswers({'q5.last_reading.systolic':190,'q5.last_reading.diastolic':115,'q5.crisis_symptoms':['none']})),null);
