import assert from 'node:assert/strict';
import * as engine from '@/lib/clinical/rules/engine';
import { alcoholBand, alcoholGramsPerWeek, auditCScore, osaBand, packYears } from '@/lib/clinical/rules/derived';
import { fieldById } from '@/lib/clinical/seed/questions';
import { normalizeSharedWorkflow } from '@/lib/service-workflow/normalization';
import { clinicalReviewEngine } from '@/lib/patient-care/clinical-review-engine';
import { hasEvidencePath } from '@/lib/patient-care/required-evidence';
import type { DemoState } from '@/lib/patient/demo-model';
import type { ClinicalSnapshot } from '@/lib/patient-care/clinical-case-repository';
import { activeFields, assessmentProgress, fieldComplete, mergeAnswers, pruneAnswers } from '@/lib/patient/questionnaire';
import { UNKNOWN, type Answers, type FieldValue, type Urgency } from '@/lib/clinical/types';

const answers = (values: Record<string, FieldValue>): Answers => Object.fromEntries(
  Object.entries(values).map(([fieldId, value]) => [fieldId, { fieldId, value, source: 'manual', answeredAt: '2026-10-15T00:00:00Z' }]),
);
const decide = (values: Record<string, FieldValue>) => engine.evaluate({ answers: answers(values), observations: [] });
const failures: string[] = [];
function check(name: string, run: () => void) { try { run(); } catch(error) { failures.push(`${name}: ${error instanceof Error ? error.message : error}`); } }

// Armen TC-05 / decision tree Q8: the stable branch explicitly orders Hb.
const stableChestPain = {'q9.present':'yes','q9.right_now':'no','q9.crescendo':'same','q9.at_rest':'no','q9.duration':'1_5','q9.frequency':'monthly'};
check('stable chest pain orders Hb through CP-002', () => {
  const decision=decide(stableChestPain);
  assert.ok(decision.findings.some(f=>f.ruleId==='NRN-RULE-CP-002'));
  assert.ok(!decision.findings.some(f=>f.ruleId==='RF-07'));
  const hb=engine.buildPlan(decision).find(test=>test.id==='cbc-hb');
  assert.ok(hb);
  assert.ok(hb.sourceRuleIds.includes('NRN-RULE-CP-002'));
  assert.equal(engine.buildPlan(decide({'q9.present':'no'})).some(test=>test.id==='cbc-hb'),false);
});

// Catalogue A.2: BMI >=30, without inventing a metabolic-syndrome rule.
for(const [weight,ordered] of [[119.6,false],[120,true],[120.4,true]] as const) check(`insulin/HOMA at BMI ${weight/4}`, () => {
  const test=engine.buildPlan(decide({'q2.height':200,'q2.weight':weight})).find(test=>test.id==='insulin-homa');
  assert.equal(Boolean(test),ordered);
  if(test) {
    assert.deepEqual(test.sourceRuleIds,['NRN-RULE-ANT-002']);
    assert.equal(test.method,'blood_draw');
    assert.equal(test.catalogueRef,'Ծոմային ինսուլին · HOMA-IR');
  }
});

// Decision tree Q7: scores 3–4 keep the diary; only 5–8 order PSG/HSAT.
for(const [score,extra] of [
  [2,{}], [3,{'q1.sex':'male'}], [4,{'q1.sex':'male','q8.neck':44}],
  [5,{'q1.sex':'male','q8.neck':44,'q8.daytime_sleepiness':'daily'}],
  [8,{'q1.sex':'male','q8.neck':44,'q8.daytime_sleepiness':'daily','q1.age':56,'q5.diagnosed':'treated','q2.weight':148}],
] as const) check(`STOP-BANG ${score} sleep study`, () => {
  const input=answers({'q1.age':40,'q1.sex':'female','q2.height':200,'q2.weight':80,'q8.neck':36,'q8.breathing':'both','q8.daytime_sleepiness':'sometimes',...extra});
  assert.equal(osaBand(input)?.value,score);
  const decision=engine.evaluate({answers:input,observations:[]});
  const finding=decision.findings.find(f=>f.ruleId==='NRN-RULE-APN-002');
  assert.equal(Boolean(finding),score>=5);
  const test=engine.buildPlan(decision).find(test=>test.id==='sleep-study');
  assert.equal(Boolean(test),score>=5);
  if(finding) {
    assert.equal(finding.urgency,'yellow');
    assert.equal(finding.category,'symptom');
    assert.equal(finding.source,'STOP-BANG · EXTERNAL, pending validation');
    assert.match(finding.nextStep!.en!,/sleep study.*sleep specialist.*within (4|four) weeks/i);
    for(const locale of ['en','hy','ru'] as const) assert.ok(finding.nextStep?.[locale]);
    assert.equal(test!.catalogueRef,'Պոլիսոմնոգրաֆիա / HSAT');
    assert.equal(test!.method,'measurement');
    assert.deepEqual(test!.sourceRuleIds,['NRN-RULE-APN-002']);
  } else if(score>=3) {
    assert.match(decision.findings.find(f=>f.ruleId==='NRN-RULE-APN-001')!.nextStep!.en!,/two-week sleep diary/i);
  }
});

// Catalogue B.3: both examinations are yearly for every member with diabetes.
for(const diabetic of [false,true]) check(`yearly eye and foot exams: diabetes ${diabetic}`, () => {
  const plan=engine.buildPlan(decide({'q6.conditions':[diabetic?'diabetes':'none']}));
  for(const [id,ref] of [['fundoscopy','Աչքի հատակի հետազոտություն'],['foot-exam','Ոտքերի զննում']]) {
    const test=plan.find(test=>test.id===id);
    assert.equal(Boolean(test),diabetic);
    if(test) {
      assert.deepEqual(test.sourceRuleIds,['NRN-RULE-DM-005']);
      assert.equal(test.repeatAfterDays,365);
      assert.equal(test.method,'measurement');
      assert.equal(test.catalogueRef,ref);
    }
  }
});

// Decision tree 2.4: unknown frequency keeps follow-ups open and assessment gated.
check('unknown alcohol frequency is accepted and never becomes abstinence or zero', () => {
  const input=mergeAnswers({},[{fieldId:'q4.frequency',value:UNKNOWN}]);
  assert.ok(fieldComplete(fieldById('q4.frequency')!,input));
  const field=fieldById('q4.frequency')!;
  assert.deepEqual(field.options!.find(option=>option.value===UNKNOWN)!.label,{en:"I don't remember",hy:'Չեմ հիշում',ru:'Не помню'});
  const followups=['q4.drinks_per_day','q4.binge','q4.drink_type','q4.volume_ml'];
  assert.deepEqual(activeFields(input).filter(field=>followups.includes(field.id)).map(field=>field.id),followups);
  const complete=mergeAnswers(input,[{fieldId:'q4.drinks_per_day',value:'one_two'},{fieldId:'q4.binge',value:'never'},{fieldId:'q4.drink_type',value:'wine'},{fieldId:'q4.volume_ml',value:150}]);
  assert.equal(auditCScore(complete),null);
  assert.equal(alcoholGramsPerWeek(complete),null);
  assert.equal(alcoholBand(complete)?.code,'UNKNOWN');
  const decision=engine.evaluate({answers:complete,observations:[]});
  assert.equal(decision.findings.some(f=>['NRN-RULE-OK-008','NRN-RULE-ALC-001'].includes(f.ruleId)),false);
  const abstinent=mergeAnswers(complete,[{fieldId:'q4.frequency',value:'never'}]);
  assert.equal(followups.some(id=>id in abstinent),false);
  assert.equal(auditCScore(abstinent),0);
});

// Q7.1 SCD already specifies under 50. A relative's MI is a different answer.
check('RF-12 needs family sudden death and palpitations, not family MI', () => {
  for(const [relative,symptoms,fires] of [['sudden_death','palpitations_only',true],['sudden_death','yes',true],['cad','palpitations_only',false],['sudden_death','no',false]] as const) {
    assert.equal(decide({'q7.relatives':[relative],'q10.symptoms':symptoms,'q10.right_now':'no'}).findings.some(f=>f.ruleId==='RF-12'),fires);
  }
});

// Decision tree Q9.1 separates breathlessness from dizziness; questionnaire Q10.1 does not.
for(const [symptoms,rightNow,visible] of [['yes','no',true],['yes','yes',false],['yes',undefined,false],['palpitations_only',undefined,true],['no',undefined,false],[undefined,undefined,false]] as const) check(`breathlessness visibility ${symptoms}/${rightNow}`, () => {
  const input=answers({...symptoms?{'q10.symptoms':symptoms}:{},...rightNow?{'q10.right_now':rightNow}:{}});
  assert.equal(activeFields(input).some(field=>field.id==='q10.breathless'),visible);
  assert.equal('q10.breathless' in pruneAnswers({...input,...answers({'q10.breathless':'yes'})}),visible);
});
check('breathlessness is required and accepts yes/no through the member questionnaire', () => {
  const input=answers({'q10.symptoms':'yes','q10.right_now':'no'});
  const field=activeFields(input).find(field=>field.id==='q10.breathless');
  assert.ok(field);
  assert.equal(field.skippable,undefined);
  assert.equal(fieldComplete(field,input),false);
  for(const value of ['yes','no']) assert.equal(fieldComplete(field,mergeAnswers(input,[{fieldId:field.id,value}])),true);
  assert.throws(()=>mergeAnswers(input,[{fieldId:field.id,value:UNKNOWN}]),/Invalid answer/);
});
for(const breathless of ['yes','no',UNKNOWN,undefined]) for(const heartFailure of [false,true]) check(`breathlessness ${breathless}, heart failure ${heartFailure}`, () => {
  const decision=decide({'q10.symptoms':'yes','q10.right_now':'no','q6.conditions':[heartFailure?'heart_failure':'none'],...breathless?{'q10.breathless':breathless}:{}});
  const finding=decision.findings.find(f=>f.ruleId==='NRN-RULE-PAL-004');
  assert.equal(Boolean(finding),breathless==='yes'&&!heartFailure);
  if(finding) {
    assert.equal(finding.source,'2023 ESC HF');
    assert.equal(finding.category,'symptom');
    assert.equal(finding.urgency,'yellow');
    assert.equal(finding.nextStep?.en,'Discuss NT-proBNP and an echocardiogram with your doctor.');
    for(const locale of ['en','hy','ru'] as const) assert.ok(finding.nextStep?.[locale]);
  }
  const plan=engine.buildPlan(decision);
  for(const id of ['nt-probnp','echocardiogram']) assert.equal(plan.some(test=>test.id===id),breathless==='yes'||heartFailure);
});

// Source decision tree v1.1 P149: the clinician note includes exactly 20 pack-years.
for (const [years, fires] of [[19.9, false], [20, true], [20.1, true]] as const) check(`smoking ${years} pack-years`, () => {
  const finding = decide({'q3.per_day':20,'q3.years':years}).findings.find(f => f.ruleId === 'NRN-RULE-SMK-002');
  assert.equal(Boolean(finding), fires);
  if (fires) assert.match(finding!.nextStep!.en!, /note.*clinician/i);
});

// P147 defines years × cigarettes/day in packs; P149 says >=20, with no rounding of the gate.
// Valid integer answers: 19 × 21 / 20 = 19.95, below the clinician-note boundary.
for (const [years,perDay,fires] of [[19,21,false],[20,20,true]] as const) check(`unrounded smoking gate ${years} years at ${perDay}/day`, () => {
  const input={'q3.per_day':perDay,'q3.years':years};
  assert.equal(packYears(answers(input)),20,'The displayed pack-years remain rounded to one decimal');
  const finding=decide(input).findings.find(f=>f.ruleId==='NRN-RULE-SMK-002');
  assert.equal(Boolean(finding),fires,'The clinician note must compare unrounded pack-years');
  if(fires) assert.match(finding!.nextStep!.en!,/note.*clinician/i);
});

// P175–179: grade 1 remains two weeks, either grade 2 boundary is <= one week.
for (const [systolic,diastolic,days] of [[159,99,14],[160,80,7],[120,100,7],[179,109,7]] as const) check(`BP ${systolic}/${diastolic}`, () => {
  const decision = decide({'q5.last_reading.systolic':systolic,'q5.last_reading.diastolic':diastolic});
  assert.equal(decision.urgency, 'yellow');
  const finding = decision.findings.find(f => f.ruleId === 'NRN-RULE-BP-002')!;
  if(days === 7) {
    assert.equal(finding.consultationWithinDays, 7);
    assert.match(finding.nextStep!.en!, /within (one|1) week/i);
  }
  assert.match(engine.consultationWindow(decision).en!, days === 7 ? /within (one|1) week/i : /within 2 weeks/i);
});
const urgencyCombinations: [Record<string, FieldValue>, Urgency, RegExp][] = [
  [{'q6.hba1c':9}, 'orange', /within 1 week/],
  [{'q5.last_reading.systolic':180,'q5.crisis_symptoms':['chest_pain']}, 'red', /103 now/],
];
// Armen's answers 1 to 3, 2 Nov.
for (const [systolic,diastolic,text] of [[175,114,/48 hours/],[179,110,/48 hours/],[192,114,/today/],[180,100,/today/],[170,125,/today/]] as const) check(`BP ${systolic}/${diastolic} with no symptoms`, () => {
  const decision=decide({'q5.last_reading.systolic':systolic,'q5.last_reading.diastolic':diastolic,'q5.crisis_symptoms':['none']});
  assert.equal(decision.urgency,'orange');assert.match(engine.consultationWindow(decision).en!,text);
  assert.match(decision.findings.find(f=>f.ruleId==='RF-06')!.nextStep!.en!,/48 hours/);
});
check('HbA1c 9% or more is one week alone, and yields to a sooner orange finding', () => {
  const alone=decide({'q6.conditions':['diabetes'],'q6.diabetes_years':8,'q6.hba1c':9.4});
  assert.equal(alone.urgency,'orange');assert.equal(engine.consultationWindowDays(alone),7);
  assert.match(alone.findings.find(f=>f.ruleId==='RF-11')!.nextStep!.en!,/48 hours with strong thirst/);
  const withBp=decide({'q6.conditions':['diabetes'],'q6.diabetes_years':8,'q6.hba1c':9.4,'q5.last_reading.systolic':184,'q5.last_reading.diastolic':104,'q5.crisis_symptoms':['none']});
  assert.equal(engine.consultationWindowDays(withBp),0);
});
check('grade 2 with another yellow finding keeps the earliest source deadline', () => {
  const decision=decide({'q5.last_reading.systolic':160,'q5.last_reading.diastolic':99,'q3.per_day':20,'q3.years':20});
  assert.equal(decision.urgency,'yellow');
  assert.match(engine.consultationWindow(decision).en!,/within 1 week/);
  assert.deepEqual(engine.consultationWindow({...decision,findings:[...decision.findings].reverse()}),engine.consultationWindow(decision));
});
for (const [extra, urgency, text] of urgencyCombinations) check(`BP combination keeps ${urgency} precedence`, () => {
  const decision=decide({'q5.last_reading.systolic':160,'q5.last_reading.diastolic':100,...extra});
  assert.equal(decision.urgency,urgency);
  assert.match(engine.consultationWindow(decision).en!,text);
});

// P231–233: unknown HbA1c orders HbA1c with no fasting requirement, independently of obesity/activity.
for (const hba1c of [UNKNOWN, undefined, 6.9] as const) check(`diabetes HbA1c ${hba1c}`, () => {
  const decision=decide({'q6.conditions':['diabetes'],'q2.height':180,'q2.weight':65,'q2.waist':75,'q2.activity':'active','q2.activity_minutes':180,'q2.activity_intensity':'moderate',...(hba1c === undefined ? {} : {'q6.hba1c':hba1c})});
  const plan=engine.buildPlan(decision);
  assert.equal(plan.some(t => t.id === 'hba1c'), hba1c !== 6.9);
  assert.equal(plan.some(t => t.id === 'hba1c-glucose'), false);
  if(hba1c !== 6.9) {
    const finding=decision.findings.find(f=>f.ruleId==='NRN-RULE-DM-004')!;
    assert.match(finding.nextStep!.en!,/Arrange an HbA1c test/);
    assert.match(plan.find(t=>t.id==='hba1c')!.preparation.en!, /No fasting is required/);
  }
});
check('no diabetes does not add glycaemic test solely for unanswered HbA1c', () => {
  assert.equal(engine.buildPlan(decide({'q6.conditions':['none']})).some(t=>['hba1c','hba1c-glucose'].includes(t.id)),false);
});
for(const conditions of [['diabetes'],['none']]) check(`metabolic indication retains combined test ${conditions[0]}`, () => {
  const plan=engine.buildPlan(decide({'q6.conditions':conditions,'q6.hba1c':UNKNOWN,'q1.sex':'male','q2.waist':105}));
  assert.equal(plan.filter(t=>t.id==='hba1c-glucose').length,1);
  assert.equal(plan.filter(t=>t.id==='hba1c').length,0);
});
for(const duration of [UNKNOWN,undefined]) check(`unknown diabetes duration ${duration} requires conditional review`, () => {
  const finding=decide({'q6.conditions':['diabetes','ascvd'],...(duration===undefined?{}:{'q6.diabetes_years':duration})}).findings.find(f=>f.ruleId==='NRN-RULE-DM-003')!;
  assert.match(finding.nextStep!.en!,/clinician.*review/i);
  assert.match(finding.nextStep!.en!,/higher.priority/i);
  assert.match(finding.nextStep!.en!,/moderate risk cannot be claimed/i);
  assert.doesNotMatch(finding.nextStep!.en!,/classification stays high/i);
});
for(const years of [9.9,10,10.1]) check(`diabetes duration ${years} stays clinician reviewed`, () => {
  const finding=decide({'q6.conditions':['diabetes','ascvd'],'q6.diabetes_years':years}).findings.find(f=>f.ruleId==='NRN-RULE-DM-001');
  assert.equal(Boolean(finding),years >= 10);
  if(finding) {
    assert.match(finding.nextStep!.en!,/clinician.*review/i);
    assert.match(finding.nextStep!.en!,/higher.priority/i);
    assert.doesNotMatch(finding.nextStep!.en!,/regardless/);
  }
});
function completeDiabetesAnswers(): Answers {
  let complete=answers({'q1.age':45,'q1.sex':'male','q6.conditions':['diabetes'],'q6.hba1c':UNKNOWN,'q2.height':180,'q2.weight':65,'q2.waist':75,'q2.activity':'active','q2.activity_minutes':180,'q2.activity_intensity':'moderate'});
  for(let iteration=0;iteration<12;iteration++) for(const field of activeFields(complete)) {
    if(fieldComplete(field,complete)) continue;
    if(field.kind === 'blood-pressure') Object.assign(complete, answers({[field.id+'.systolic']:115,[field.id+'.diastolic']:65}));
    else if(field.kind === 'number' || field.kind === 'scale') Object.assign(complete,answers({[field.id]:field.min ?? 1}));
    else {
      const value=field.options?.find(option=>['no','none'].includes(option.value))?.value ?? field.options?.[0]?.value;
      if(value) Object.assign(complete,answers({[field.id]:field.kind === 'multi' ? [value] : value}));
    }
  }
  complete=pruneAnswers(complete);
  assert.ok(assessmentProgress(complete).complete);
  return complete;
}
const fixtureId='71000000-0000-4000-8000-000000000001';
const assessmentDate='2026-10-15';
const completedAt='2026-10-15T00:00:00Z';
function sharedDemoState(input: Answers): DemoState {
  return {
    version:1,userId:fixtureId,expiresAt:Date.parse('2026-10-22T00:00:00Z'),measurements:[],
    state:{
      profile:{userId:fixtureId,name:'Synthetic source regression',birthDate:'1981-01-01',biologicalSex:'male',locale:'en'},
      consentAccepted:true,
      assessment:{id:'source-regression',revision:1,assessmentDate,answers:input,completedAt,urgentRule:null},
    },
  };
}
function trustedSnapshot(input: Answers): ClinicalSnapshot {
  return {
    id:fixtureId,revision:0,evidenceToken:'synthetic-source-regression',draft:null,draftSavedAt:null,draftStale:false,
    evidence:{visits:[],
      profile:{name:'Synthetic source regression',birthDate:'1981-01-01',biologicalSex:'male'},
      consent:{version:'patient-pilot-v1'},
      assessment:{revision:1,assessment_date:assessmentDate,answers:input,completed_at:completedAt,urgent_rule:null},
      measurements:[],reports:[],
    },
  };
}

// Current shared-demo write boundary: source-exact orders and preparation survive normalization.
for(const metabolic of [false,true]) check(`current shared workflow ${metabolic?'metabolic bundle':'lean active diabetic HbA1c'}`, () => {
  const input={...completeDiabetesAnswers(),...(metabolic?answers({'q2.waist':105}):{})};
  const state:DemoState=sharedDemoState(input);
  assert.equal(normalizeSharedWorkflow(state),true);
  const tests=state.workflow!.tests;
  const glycaemic=tests.filter(test=>['hba1c','hba1c-glucose'].includes(test.id));
  assert.equal(glycaemic.length,1);
  assert.equal(glycaemic[0].id,metabolic?'hba1c-glucose':'hba1c');
  assert.match(glycaemic[0].source,metabolic?/NRN-RULE-ANT-001/:/NRN-RULE-DM-004/);
  assert.match(glycaemic[0].preparation,metabolic?/Fast 8 to 12 hours for the glucose/:/^No fasting is required\.$/);
  assert.equal(glycaemic[0].method,'lab');
  assert.equal(glycaemic[0].title,metabolic?'HbA1c and fasting glucose':'HbA1c');
  // Restarting the questionnaire retires its current proposed investigations.
  state.state.assessment!.completedAt=null;
  state.state.assessment!.revision++;
  assert.equal(normalizeSharedWorkflow(state),true);
  assert.deepEqual(state.workflow!.tests,[]);
});

// Fable review of step 2: a test with no evidence path must never stop a doctor publishing a plan.
check('discussion-only tests stay on the plan and block nothing', () => {
  const snapshot:ClinicalSnapshot=trustedSnapshot({...completeDiabetesAnswers(),...answers({'q2.height':162,'q2.weight':79})});
  const plan=engine.buildPlan(engine.evaluate({answers:pruneAnswers(snapshot.evidence.assessment!.answers as Answers),observations:[]})).map(test=>test.id);
  assert.ok(['fundoscopy','foot-exam','insulin-homa'].every(id=>plan.includes(id)),'they stay on the plan');
  const required=clinicalReviewEngine(snapshot).tests;
  assert.ok(!required.some(test=>['fundoscopy','foot-exam','insulin-homa','sleep-study'].includes(test.id)));
  assert.deepEqual(required.filter(test=>test.method!=='lab'&&!hasEvidencePath(test.id)),[],'nothing unrecordable blocks publication');
});
check('breathlessness alone asks to discuss; heart failure still requires the tests', () => {
  const decision=(extra:Record<string,FieldValue>)=>engine.evaluate({answers:answers({'q6.conditions':['none'],'q9.present':'no','q10.symptoms':'palpitations_only','q10.breathless':'yes',...extra}),observations:[]});
  const alone=decision({});
  assert.ok(engine.buildPlan(alone).some(test=>test.id==='nt-probnp'));
  assert.ok(!engine.requiredTests(alone).some(test=>['nt-probnp','echocardiogram'].includes(test.id)));
  const failure=decision({'q6.conditions':['heart_failure']});
  assert.ok(engine.requiredTests(failure).some(test=>test.id==='nt-probnp')&&engine.requiredTests(failure).some(test=>test.id==='echocardiogram'));
});
check('a stated weekly binge fires the priority rule even when frequency is forgotten', () => {
  const rule=(binge:string)=>engine.evaluate({answers:answers({'q1.sex':'male','q4.frequency':UNKNOWN,'q4.binge':binge,'q4.drinks_per_day':'ten_plus'}),observations:[]}).findings.find(f=>f.ruleId==='NRN-RULE-ALC-003');
  assert.equal(rule('weekly')?.urgency,'orange');assert.equal(rule('daily')?.urgency,'orange');assert.equal(rule('never'),undefined);
});

// Current trusted real-review entry point: completed stored evidence, with no mocked engine or IO.
for(const metabolic of [false,true]) check(`trusted clinical engine ${metabolic?'metabolic bundle':'lean active diabetic HbA1c'}`, () => {
  const input={...completeDiabetesAnswers(),...(metabolic?answers({'q2.waist':105}):{})};
  const snapshot:ClinicalSnapshot=trustedSnapshot(input);
  const tests=clinicalReviewEngine(snapshot).tests;
  const glycaemic=tests.filter(test=>['hba1c','hba1c-glucose'].includes(test.id));
  assert.equal(glycaemic.length,1);
  assert.equal(glycaemic[0].id,metabolic?'hba1c-glucose':'hba1c');
  assert.match(glycaemic[0].source,metabolic?/NRN-RULE-ANT-001/:/NRN-RULE-DM-004/);
  assert.match(glycaemic[0].preparation,metabolic?/Fast 8 to 12 hours for the glucose/:/^No fasting is required\.$/);
  assert.equal(glycaemic[0].method,'lab');
  assert.equal(glycaemic[0].title,metabolic?'HbA1c and fasting glucose':'HbA1c');
  const incomplete=structuredClone(snapshot);
  incomplete.evidence.assessment!.completed_at=null;
  assert.throws(()=>clinicalReviewEngine(incomplete),/Complete the questionnaire/);
  const missingAnswer=structuredClone(snapshot);
  const partial={...input}; delete partial['q1.age'];
  missingAnswer.evidence.assessment!.answers=partial;
  assert.throws(()=>clinicalReviewEngine(missingAnswer),/stored questionnaire is incomplete/);
});
check('current shared and trusted non-diabetic lean active plans retain no glycaemic investigation', () => {
  const input=pruneAnswers({...completeDiabetesAnswers(),...answers({'q6.conditions':['none']})});
  assert.ok(assessmentProgress(input).complete);
  const state=sharedDemoState(input);
  normalizeSharedWorkflow(state);
  assert.equal(state.workflow!.tests.some(test=>['hba1c','hba1c-glucose'].includes(test.id)),false);
  assert.equal(clinicalReviewEngine(trustedSnapshot(input)).tests.some(test=>['hba1c','hba1c-glucose'].includes(test.id)),false);
});

if(failures.length) throw new Error(failures.join('\n'));
console.log('Clinical source regressions passed: Armen missing tests and clarifiers, unknown alcohol, family sudden death, inclusive smoking note, grade 2 consultation, source-exact diabetic HbA1c through shared/trusted review, and conditional duration review.');
