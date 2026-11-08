// WP T: personal BP target and clinician-set alert thresholds (lib/clinical/rules/personal-bp.ts), the command schema
// (lib/bp-target/schema.ts) and the member's reply line. Pure; no database.
import assert from 'node:assert/strict';
import {THRESHOLD} from '@/lib/clinical/rules/thresholds';
import {aboveTargetStreak,DEFAULT_PERSONAL_BP_TARGET,evaluatePersonalBp,personalAlertRaises,PERSONAL_BP_DEFAULTS_VERSION,type PersonalBpReading,type PersonalBpTarget} from '@/lib/clinical/rules/personal-bp';
import {bpCheck} from '@/lib/clinical/rules/bp-check';
import {BP_TARGET_BOUNDS,bpTargetCommandSchema,personalTarget,proposedTarget,targetConsistent} from '@/lib/bp-target/schema';
import {allCopy,PERSONAL_BP} from '@/lib/zoe-chat-actions/copy';

const r=(systolic:number,diastolic:number,o:Partial<PersonalBpReading>={}):PersonalBpReading=>({systolic,diastolic,pulse:null,symptoms:false,...o});
const target:PersonalBpTarget={homeSystolicTarget:130,homeDiastolicTarget:80,alertHighSystolic:150,alertHighDiastolic:95,alertHighConsecutive:2,alertLowSystolic:95,alertLowPulse:50};

// 1. Defaults come from THRESHOLD, and only from there.
assert.deepEqual(DEFAULT_PERSONAL_BP_TARGET,{homeSystolicTarget:THRESHOLD.personalBpTargetSystolic,homeDiastolicTarget:THRESHOLD.personalBpTargetDiastolic,
 alertHighSystolic:THRESHOLD.personalBpAlertHighSystolic,alertHighDiastolic:THRESHOLD.personalBpAlertHighDiastolic,alertHighConsecutive:THRESHOLD.personalBpAlertHighConsecutive,
 alertLowSystolic:THRESHOLD.personalBpAlertLowSystolic,alertLowPulse:THRESHOLD.personalBpAlertLowPulse});
assert.ok(targetConsistent(DEFAULT_PERSONAL_BP_TARGET),'The defaults satisfy the table rules');
for(const [k,[lo,hi]] of Object.entries(BP_TARGET_BOUNDS))assert.ok(DEFAULT_PERSONAL_BP_TARGET[k as keyof PersonalBpTarget]>=lo&&DEFAULT_PERSONAL_BP_TARGET[k as keyof PersonalBpTarget]<=hi,`default ${k} is storable`);
assert.ok(DEFAULT_PERSONAL_BP_TARGET.alertHighSystolic<=THRESHOLD.crisisSystolic&&BP_TARGET_BOUNDS.alertHighSystolic[1]<=THRESHOLD.crisisSystolic,'No personal alert can sit above the crisis cut');

// 2. Missing target means defaults; usedPersonalTarget says which.
assert.deepEqual(evaluatePersonalBp(r(128,78),[],null),{status:'at_target',ruleId:'personal_bp.at_target',usedPersonalTarget:false});
assert.deepEqual(evaluatePersonalBp(r(128,78),[],target),{status:'at_target',ruleId:'personal_bp.at_target',usedPersonalTarget:true});
assert.equal(evaluatePersonalBp(r(132,78),[],null).status,'at_target','Below the default 135/85');
assert.equal(evaluatePersonalBp(r(132,78),[],target).status,'above_target','Above the member’s own 130/80');
assert.equal(evaluatePersonalBp(r(130,70),[],target).status,'above_target','At the target number is not below it');
assert.equal(evaluatePersonalBp(r(120,80),[],target).status,'above_target','Either number counts');

// 3. A missing value is UNKNOWN, never normal.
for(const bad of [r(Number.NaN,80),r(120,0),r(-1,70),{systolic:undefined as unknown as number,diastolic:80,pulse:null,symptoms:false as const}])
 assert.deepEqual(evaluatePersonalBp(bad,[],target),{status:'unknown',ruleId:'personal_bp.unknown',usedPersonalTarget:true});

// 4. The consecutive high alert: one high reading is above target; the run of N raises.
assert.equal(evaluatePersonalBp(r(152,90),[],target).ruleId,'personal_bp.above_target');
assert.equal(evaluatePersonalBp(r(152,90),[r(120,75)],target).ruleId,'personal_bp.above_target','A normal reading breaks the run');
assert.deepEqual(evaluatePersonalBp(r(152,90),[r(120,75),r(151,96)],target),{status:'alert_high',ruleId:'personal_bp.alert_high',usedPersonalTarget:true});
assert.equal(evaluatePersonalBp(r(152,90),[r(151,96),r(Number.NaN,90)],target).ruleId,'personal_bp.above_target','A malformed earlier reading never completes a run');
assert.equal(evaluatePersonalBp(r(152,90),[r(151,96)],{...target,alertHighConsecutive:3}).ruleId,'personal_bp.above_target','Three needed, two seen');
assert.equal(evaluatePersonalBp(r(152,90),[],{...target,alertHighConsecutive:1}).ruleId,'personal_bp.alert_high');
assert.equal(evaluatePersonalBp(r(161,101),[r(162,100)],null).ruleId,'personal_bp.alert_high','Default alert at grade 2 on two readings');

// 5. Low with symptoms: symptoms decide; unknown symptoms are unknown.
assert.equal(evaluatePersonalBp(r(92,60,{symptoms:true}),[],target).status,'alert_low');
assert.equal(evaluatePersonalBp(r(110,70,{pulse:45,symptoms:true}),[],target).ruleId,'personal_bp.low_with_symptoms','A low pulse with symptoms');
assert.equal(evaluatePersonalBp(r(92,60,{symptoms:'unknown'}),[],target).ruleId,'personal_bp.low_symptoms_unknown');
assert.equal(evaluatePersonalBp(r(92,60,{symptoms:'unknown'}),[],target).status,'unknown');
assert.equal(evaluatePersonalBp(r(92,60,{symptoms:false}),[],target).status,'at_target','Low without symptoms is below the target');

// 6. Emergency rules always win and are not weakened: the crisis band belongs to bpCheck and the zone rules.
for(const [s,d] of [[180,100],[185,115],[150,110],[200,130]] as const){
 const p=evaluatePersonalBp(r(s,d,{symptoms:true}),[],{...target,alertHighSystolic:180,alertHighDiastolic:120});
 assert.equal(p.ruleId,'personal_bp.crisis_band',`${s}/${d}`);
 assert.equal(personalAlertRaises(p),false,'No personal task: the emergency route owns it');
 assert.equal(bpCheck({systolic:s,diastolic:d},{repeat:false,symptoms:'yes'}),'call_103','Symptoms in the crisis band still mean 103');
}
assert.equal(personalAlertRaises(evaluatePersonalBp(r(152,90),[r(151,96)],target)),true);
assert.equal(personalAlertRaises(evaluatePersonalBp(r(92,60,{symptoms:true}),[],target)),true);
assert.equal(personalAlertRaises(evaluatePersonalBp(r(132,78),[],target)),false);

// 7. Streak counts back from the newest.
assert.equal(aboveTargetStreak([r(140,85),r(120,70),r(135,82),r(131,79)],target),2);
assert.equal(aboveTargetStreak([r(120,70)],target),0);
assert.equal(aboveTargetStreak([r(140,90),r(Number.NaN,90),r(140,90)],null),1);

// 8. The command schema mirrors the table rules.
const command=(o:Record<string,unknown>={})=>({version:'bp-target-v1',memberId:'5ea0f000-0000-4000-8000-000000000001',submissionId:'5ea0f000-0000-4000-8000-0000000000aa',expectedVersion:0,
 ...DEFAULT_PERSONAL_BP_TARGET,reason:null,defaultsVersion:PERSONAL_BP_DEFAULTS_VERSION,...o});
assert.ok(bpTargetCommandSchema.safeParse(command()).success,'The defaults confirmed as a first version need no reason');
assert.ok(!bpTargetCommandSchema.safeParse(command({homeSystolicTarget:125})).success,'A departure from the defaults needs a reason');
assert.ok(bpTargetCommandSchema.safeParse(command({homeSystolicTarget:125,reason:'After stroke'})).success);
assert.ok(!bpTargetCommandSchema.safeParse(command({expectedVersion:1})).success,'Every later version needs a reason');
assert.ok(!bpTargetCommandSchema.safeParse(command({alertHighSystolic:130,reason:'x'})).success,'The alert must sit above the target');
assert.ok(!bpTargetCommandSchema.safeParse(command({alertLowSystolic:140,reason:'x'})).success,'The low alert must sit below the target');
assert.ok(!bpTargetCommandSchema.safeParse(command({homeSystolicTarget:200,reason:'x'})).success,'Implausible numbers are refused');
assert.ok(!bpTargetCommandSchema.safeParse(command({homeSystolicTarget:130.5,reason:'x'})).success,'Whole numbers only');
assert.ok(!bpTargetCommandSchema.safeParse({...command(),extra:1}).success,'Strict');
assert.deepEqual(personalTarget(null),null);
assert.equal(proposedTarget(null).defaultsVersion,PERSONAL_BP_DEFAULTS_VERSION);
assert.equal(proposedTarget(null).homeSystolicTarget,THRESHOLD.personalBpTargetSystolic);

// 9. Member copy: three languages, voice guide.
const lines=[PERSONAL_BP.below('130/80'),PERSONAL_BP.above('130/80'),PERSONAL_BP.belowUsual('135/85'),PERSONAL_BP.aboveUsual('135/85'),PERSONAL_BP.alertSent,PERSONAL_BP.alertNotSent,PERSONAL_BP.lowAsk,PERSONAL_BP.explain];
for(const line of lines){
 for(const l of ['hy','en','ru'] as const){assert.ok(line[l].length>0);assert.doesNotMatch(line[l],/[!—]|patient|user/i,`${l}: ${line[l]}`);}
 assert.match(line.hy,/[Ա-և]/u);assert.match(line.ru,/[Ѐ-ӿ]/u);
}
assert.ok(allCopy().some(c=>c.en===PERSONAL_BP.alertSent.en),'The copy check list includes the new lines');
console.log('Personal BP: THRESHOLD defaults, unknown handling, consecutive and low-with-symptoms alerts, crisis band left to the emergency rules, command schema, member copy: ok.');
