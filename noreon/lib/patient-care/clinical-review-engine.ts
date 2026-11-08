import {z} from 'zod';
import type {TestMethod} from '@/lib/clinical/types';
import {THRESHOLD} from '@/lib/clinical/rules/rules';
import {ALGORITHM_VERSION,evaluate,requiredTests,consultationWindow} from '@/lib/clinical/rules/engine';
import {assessmentProgress,pruneAnswers} from '@/lib/patient/questionnaire';
import {ageOn} from '@/lib/patient/validation';
import {consultationProposal} from './consultation-proposal';
import type {StaffLocale} from '@/lib/staff/staff-locale-copy';
import type {ClinicalSnapshot} from './clinical-case-repository';
const answersSchema=z.record(z.string(),z.object({fieldId:z.string(),value:z.union([z.string(),z.number().finite(),z.boolean(),z.array(z.string())]),source:z.enum(['manual','voice','presenter']),answeredAt:z.string()}));
const testMethod=(m:TestMethod)=>m==='blood_draw'||m==='urine_sample'?'lab':m==='home_log'?'home-log':'clinic';
/** Requirements come only from the stored assessment and the existing clinical engine.
 * Imported text is not silently converted into diagnostic observations or risk scores. */
function clinicalReviewDecision(snapshot:ClinicalSnapshot,purpose:'publication'|'booking'){
 if(snapshot.evidence.measurements.some(m=>m.systolic>=THRESHOLD.crisisSystolic||m.diastolic>=THRESHOLD.crisisDiastolic))throw Error('Routine review is on hold: a recorded crisis-range blood pressure has no linked symptom triage or resolution. Arrange clinical assessment; later normal readings do not clear this hold.');
 const a=snapshot.evidence.assessment;
 if(!a?.completed_at||a.urgent_rule||!snapshot.evidence.consent)throw Error('Complete the questionnaire and resolve urgent guidance first.');
 const answers=pruneAnswers(answersSchema.parse(a.answers));
 if(!assessmentProgress(answers).complete)throw Error('The stored questionnaire is incomplete.');
 const profile=snapshot.evidence.profile;
 const assessmentDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(a.assessment_date);
 if(!profile.birthDate||answers['q1.age']?.value!==ageOn(profile.birthDate,assessmentDate)||answers['q1.sex']?.value!==profile.biologicalSex)throw Error('Profile and questionnaire context disagree.');
 const decision=evaluate({answers,observations:[]});
 if(decision.urgency==='red')throw Error('Urgent guidance takes priority over routine publication.');
 // Orange keeps the person in the product (AGENTS.md): booking the suggested tests stays open while the
 // consultation window is shown. Staff publication still holds, because its consultation pathway is not built.
 if(decision.urgency==='orange'&&purpose==='publication')throw Error('Routine publication is on hold: the native source-specific mandatory consultation pathway is unavailable. Follow the clinical rule guidance; this workspace cannot record its completion.');
 return decision;
}
export function clinicalReviewEngine(snapshot:ClinicalSnapshot,purpose:'publication'|'booking'='publication'){
 const decision=clinicalReviewDecision(snapshot,purpose);
 // The results page reads the same plan, so the two screens cannot disagree (audit A10). Discussion-only tests are
 // on that plan but block nothing: they have no evidence path, and no package carries them.
 const tests=requiredTests(decision);
 return {version:ALGORITHM_VERSION,urgency:decision.urgency,tests:tests.map(t=>({id:t.id,title:t.name.en??t.name.hy,method:testMethod(t.method),preparation:t.preparation.en??t.preparation.hy,source:t.sourceRuleIds.join(', ')}))};
}

/** The same validated engine sentence used by the prepared plan, without changing the stored engine shape. */
export function clinicalConsultationProposal(snapshot:ClinicalSnapshot,locale:StaffLocale='en'){
 try{
  const decision=clinicalReviewDecision(snapshot,'publication');
  return consultationProposal(decision.urgency,consultationWindow(decision)[locale]);
 }catch{return null;}
}
