// WP T: deterministic risk tier (lib/clinical/rules/risk-tier.ts), its inputs from clinical_review_inputs
// (lib/clinical-review/inputs.ts) and the risk-tier job with an injected service RPC. No database.
import assert from 'node:assert/strict';
import {THRESHOLD as T} from '@/lib/clinical/rules/thresholds';
import {bpAverage,daysSince,riskTier,RISK_TIER_RULES,RISK_TIER_VERSION,secondaryPrevention,type RiskTierInput} from '@/lib/clinical/rules/risk-tier';
import {adherencePct,clinicalReviewMemberSchema,memberRisk,riskTierInput} from '@/lib/clinical-review/inputs';
import {runRiskTierJob,REVIEW_PAGE} from '@/lib/clinical-review/jobs';
import {riskReasonLabel,tierLabel} from '@/lib/worklist/copy';

const base:RiskTierInput={secondaryPrevention:false,bpAverage:{systolic:120,diastolic:75},bpTarget:null,ldlLatestMmol:null,ldlGoalMmol:null,openUrgent:0,adherencePct:null,redFlag:false,daysSinceContact:3};
assert.deepEqual(riskTier(base),{tier:'low',score:0,reasons:[],version:RISK_TIER_VERSION});
// Deterministic: the same input gives the same output, every time.
assert.deepEqual(riskTier({...base,secondaryPrevention:true}),riskTier({...base,secondaryPrevention:true}));

// Every point and cut comes from THRESHOLD.
assert.equal(riskTier({...base,openUrgent:1}).score,T.riskTierPointsOpenUrgent);
assert.equal(riskTier({...base,openUrgent:1}).tier,'very_high','An open urgent alert alone is very high');
assert.equal(riskTier({...base,secondaryPrevention:true}).tier,'high');
assert.equal(riskTier({...base,secondaryPrevention:true,bpAverage:{systolic:165,diastolic:90}}).tier,'very_high','Secondary prevention and alert-range BP');
assert.deepEqual(riskTier({...base,secondaryPrevention:true,bpAverage:{systolic:140,diastolic:80}}).reasons,['risk.secondary_prevention','risk.bp_above_target']);
assert.equal(riskTier({...base,bpAverage:{systolic:140,diastolic:80}}).tier,'moderate');
assert.equal(riskTier({...base,bpAverage:{systolic:132,diastolic:79},bpTarget:{homeSystolicTarget:130,homeDiastolicTarget:80,alertHighSystolic:150,alertHighDiastolic:95,alertHighConsecutive:2,alertLowSystolic:95,alertLowPulse:50}}).reasons[0],'risk.bp_above_target','The personal target is used');
assert.deepEqual(riskTier({...base,bpAverage:{systolic:132,diastolic:79}}).reasons,[],'Below the default target');
assert.ok(riskTier({...base,ldlGoalMmol:1.4,ldlLatestMmol:1.4}).reasons.includes('risk.ldl_above_goal'),'At the threshold is not below it');
assert.ok(!riskTier({...base,ldlGoalMmol:1.4,ldlLatestMmol:1.3}).reasons.includes('risk.ldl_above_goal'));
assert.ok(riskTier({...base,adherencePct:T.riskTierAdherenceLowPct-1}).reasons.includes('risk.adherence_low'));
assert.ok(!riskTier({...base,adherencePct:T.riskTierAdherenceLowPct}).reasons.includes('risk.adherence_low'));
assert.ok(riskTier({...base,redFlag:true}).reasons.includes('risk.red_flag'));
assert.ok(riskTier({...base,daysSinceContact:T.riskTierContactStaleDays+1}).reasons.includes('risk.contact_stale'));

// Unknown is never normal: each adds its reason and the unknown points.
const unknown=riskTier({...base,secondaryPrevention:'unknown',bpAverage:null,ldlGoalMmol:1.8,ldlLatestMmol:null,daysSinceContact:null});
assert.deepEqual(unknown.reasons,['risk.history_unknown','risk.bp_unknown','risk.ldl_unknown','risk.contact_stale']);
assert.equal(unknown.score,3*T.riskTierPointsUnknown+T.riskTierPointsContactStale);
assert.equal(unknown.tier,'moderate','Unknowns lift a member out of low');
for(const r of RISK_TIER_RULES)for(const l of ['hy','en','ru'] as const)assert.notEqual(riskReasonLabel(r,l),r.replace(/^risk\./,'').replaceAll('_',' '),`label ${r} ${l}`);
for(const t of ['very_high','high','moderate','low',null] as const)assert.ok(tierLabel(t,'hy').length>0);

// Helpers.
assert.equal(secondaryPrevention(['ascvd'],[]),true);
assert.equal(secondaryPrevention([],['ischaemic_stroke']),true);
assert.equal(secondaryPrevention(['none'],[]),false);
assert.equal(secondaryPrevention([],[]),'unknown');
assert.equal(secondaryPrevention([],['tia']),false);
const now=new Date('2026-11-08T08:00:00Z');
assert.deepEqual(bpAverage([{systolic:130,diastolic:80,measuredAt:'2026-11-07T08:00:00Z'},{systolic:150,diastolic:90,measuredAt:'2026-11-06T08:00:00Z'},{systolic:200,diastolic:120,measuredAt:'2026-10-20T08:00:00Z'},{systolic:200,diastolic:120,measuredAt:'2026-11-09T08:00:00Z'}],now),{systolic:140,diastolic:85},'Only the window, never the future');
assert.equal(bpAverage([],now),null);
assert.equal(daysSince('2026-11-01T08:00:00Z',now),7);assert.equal(daysSince(null,now),null);

// Inputs from the service read, and the adherence semantics of lib/member-medicines.
const memberId='5ea0f000-0000-4000-8000-000000000001';
const raw={memberId,conditions:['ascvd'],assessmentRedFlag:null,events:[],target:null,
 readings:[{systolic:166,diastolic:96,pulse:70,measuredAt:'2026-11-07T06:00:00Z',entrySource:null},{systolic:168,diastolic:98,pulse:null,measuredAt:'2026-11-07T18:00:00Z',entrySource:'patient_text_entry'}],
 ldlGoal:{thresholdMmol:'1.4',setAt:'2026-08-01T08:00:00Z',version:1},
 ldlObservations:[{id:'cr:1',value:2.1,unit:'mmol/L',on:'2026-10-01',source:'clinic_result',name:'LDL-C',memberVisible:true}],
 openAlerts:0,openSameDayTasks:0,medicines:{today:'2026-11-08',days:7,now:'2026-11-08T08:00:00Z',self:[],plan:[]},lastContactAt:'2026-11-05T08:00:00Z'};
const m=clinicalReviewMemberSchema.parse(raw);
const input=riskTierInput(m,now);
assert.equal(input.secondaryPrevention,true);
assert.equal(input.ldlGoalMmol,1.4);assert.equal(input.ldlLatestMmol,2.1);
assert.equal(input.adherencePct,null,'Nothing expected: adherence unknown, not 100');
assert.equal(adherencePct(m.medicines,now),null);
const risk=memberRisk(m,now);
assert.equal(risk.tier,'very_high');
assert.deepEqual(risk.reasons,['risk.secondary_prevention','risk.bp_alert_range','risk.ldl_above_goal']);
assert.deepEqual(risk.facts,{aboveTargetStreak:2});

// The job: pages through the service read, records each member, counts failures, stops at the deadline.
const calls:{name:string;args:Record<string,unknown>}[]=[];
const pages=[{version:'clinical-review-inputs-v1',asOf:'2026-11-08T08:00:00Z',next:memberId,members:[raw,{memberId:'bad'}]}];
const rpc=async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});
 if(name==='clinical_review_inputs')return pages.shift()??{version:'clinical-review-inputs-v1',asOf:'2026-11-08T08:00:00Z',next:null,members:[]};
 if(name==='member_risk_tier_record')return {ok:true,changed:true};
 throw Error('unexpected');};
const report=await runRiskTierJob(rpc,{deadline:Date.now()+60_000});
assert.deepEqual(report,{members:1,recorded:1,unchanged:0,failed:0,invalid:1,pages:1,stoppedForTime:false});
assert.deepEqual(calls[0],{name:'clinical_review_inputs',args:{p_after:null,p_limit:REVIEW_PAGE,p_days:14}});
assert.deepEqual(calls[1].args,{p_member:memberId,p_tier:'very_high',p_score:risk.score,p_reasons:risk.reasons,p_version:RISK_TIER_VERSION,p_facts:{aboveTargetStreak:2}});
const late=await runRiskTierJob(rpc,{deadline:Date.now()+1000});
assert.equal(late.stoppedForTime,true,'No page is claimed close to the deadline');
const broken=await runRiskTierJob(async()=>{throw Error('down');},{deadline:Date.now()+60_000});
assert.equal(broken.failed,1,'An unreadable page is a failure, never an empty success');
console.log('Risk tier: THRESHOLD points and cuts, unknown inputs, personal target, adherence semantics, deterministic job with deadline: ok.');
