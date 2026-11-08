// WP T: BP anomaly and LDL trend detectors (lib/clinical/rules/bp-anomaly.ts, lab-trend.ts), the sweep that raises
// care-queue tasks (lib/clinical-review/jobs.ts), and the BP flow's personal alert raise (bp-flow-server.ts). Injected
// service RPCs; no database.
import assert from 'node:assert/strict';
import {THRESHOLD as T} from '@/lib/clinical/rules/thresholds';
import {BP_ANOMALY_VERSION,detectBpAnomalies,type BpAnomalyReading} from '@/lib/clinical/rules/bp-anomaly';
import {detectLdlTrends,LAB_TREND_VERSION} from '@/lib/clinical/rules/lab-trend';
import {anomalyRaise,runClinicalAnomalySweep} from '@/lib/clinical-review/jobs';
import {careQueueRaiseSchema,reasonLabel} from '@/lib/care-queue/contracts';
import {PERSONAL_BP_VERSION} from '@/lib/clinical/rules/personal-bp';

const now=new Date('2026-11-08T08:00:00Z');
const at=(daysAgo:number,hour=8)=>new Date(Date.UTC(2026,10,8-daysAgo,hour-4)).toISOString();
const r=(daysAgo:number,systolic:number,diastolic:number,o:Partial<BpAnomalyReading>={}):BpAnomalyReading=>({systolic,diastolic,pulse:null,measuredAt:at(daysAgo),...o});
const rules=(rows:BpAnomalyReading[],target=null)=>detectBpAnomalies(rows,target,now).map(f=>f.ruleId);

// 1. Sustained above the target on N of the last M days.
const sustained=Array.from({length:T.bpAnomalySustainedDays},(_,i)=>r(i,140,86));
assert.ok(rules(sustained).includes('bp_anomaly.sustained_above_target'));
assert.ok(!rules(sustained.slice(1)).includes('bp_anomaly.sustained_above_target'),'One day short');
assert.ok(!rules(sustained,null).includes('bp_anomaly.sudden_rise'));
const personal={homeSystolicTarget:145,homeDiastolicTarget:90,alertHighSystolic:165,alertHighDiastolic:100,alertHighConsecutive:2,alertLowSystolic:95,alertLowPulse:50};
assert.ok(!detectBpAnomalies(sustained,personal,now).some(f=>f.ruleId==='bp_anomaly.sustained_above_target'),'Below the member’s own higher target');
const s=detectBpAnomalies(sustained,null,now).find(f=>f.ruleId==='bp_anomaly.sustained_above_target')!;
assert.equal(s.queue,'physician');assert.equal(s.zone,'yellow');
assert.equal(detectBpAnomalies(sustained,null,new Date(now.getTime()+3600_000)).find(f=>f.ruleId===s.ruleId)!.window,s.window,'Same window later the same day');

// 2. Sudden rise against the member's own baseline; the cut is exact.
const baseline=Array.from({length:6},(_,i)=>r(4+i,120,75));
assert.ok(rules([...baseline,r(0,135,80),r(1,135,80)]).includes('bp_anomaly.sudden_rise'),'A rise of exactly the cut');
assert.ok(!rules([...baseline,r(0,134,80),r(1,135,80)]).includes('bp_anomaly.sudden_rise'),'Just under the cut');
assert.ok(!rules([...baseline,r(0,140,80)]).includes('bp_anomaly.sudden_rise'),'One recent reading is not enough');
assert.ok(!rules([r(4,120,75),r(0,140,80),r(1,140,80)]).includes('bp_anomaly.sudden_rise'),'Too little baseline');

// 3. Variability.
const varied=[100,140,100,140,100,140].map((v,i)=>r(i,v,70));
assert.ok(rules(varied).includes('bp_anomaly.high_variability'));
assert.ok(!rules([120,122,118,121,119,120].map((v,i)=>r(i,v,70))).includes('bp_anomaly.high_variability'));

// 4. Low readings: with symptoms orange to the nurse; unknown symptoms yellow, asking; one low reading alone nothing.
const low=detectBpAnomalies([r(0,88,60,{symptoms:true})],null,now);
assert.deepEqual(low.map(f=>[f.ruleId,f.queue,f.zone]),[['bp_anomaly.low_with_symptoms','nurse','orange']]);
assert.deepEqual(rules([r(0,88,60),r(1,89,60)]),['bp_anomaly.low_symptoms_unknown']);
assert.deepEqual(rules([r(0,88,60)]),[]);
assert.deepEqual(rules([r(0,110,70,{pulse:45}),r(1,110,70,{pulse:44})]),['bp_anomaly.low_symptoms_unknown'],'A low pulse counts');

// 5. Never red, never a crisis re-label, and unknown values are skipped rather than read as normal.
for(const f of detectBpAnomalies([...varied,...sustained,r(0,190,125),r(1,88,60,{symptoms:true})],null,now))assert.notEqual(f.zone as string,'red');
assert.deepEqual(rules([r(0,Number.NaN,80),r(1,0,0),{systolic:140,diastolic:90,pulse:null,measuredAt:'not a date'}]),[]);
assert.deepEqual(rules([r(-2,88,60),r(-1,89,60)]),[],'Future readings are ignored');

// 6. LDL trends.
const p=(id:string,on:string,mmol:number,counts=true)=>({id,on,mmol,counts});
assert.deepEqual(detectLdlTrends([p('a','2026-08-01',2.3),p('b','2026-10-01',2.6)],null,now).map(f=>[f.ruleId,f.window,f.facts.riseMmol]),[['lab_trend.ldl_rising','b',0.3]],'0.3 exactly is a rise');
assert.deepEqual(detectLdlTrends([p('a','2026-08-01',2.31),p('b','2026-10-01',2.6)],null,now),[]);
assert.deepEqual(detectLdlTrends([p('a','2026-08-01',2.0),p('b','2026-10-01',2.6,false)],null,now),[],'A value that does not count is not a result');
const goal={thresholdMmol:1.4,setAt:'2026-07-01T08:00:00Z',version:2};
assert.deepEqual(detectLdlTrends([p('a','2026-10-01',1.6)],goal,now).map(f=>[f.ruleId,f.window]),[['lab_trend.ldl_not_at_goal','g2:a']]);
assert.deepEqual(detectLdlTrends([p('a','2026-10-01',1.3)],goal,now),[]);
assert.deepEqual(detectLdlTrends([p('a','2026-10-01',1.6)],{...goal,setAt:'2026-10-20T08:00:00Z'},now),[],'Too soon after the goal');
assert.deepEqual(detectLdlTrends([],goal,now),[],'No result: nothing to say');

// 7. Raises: valid care_queue_raise calls, one source ref per member, rule and window; never an alert.
const raise=anomalyRaise('5ea0f000-0000-4000-8000-000000000001',s,now.toISOString());
assert.ok(careQueueRaiseSchema.safeParse(raise).success);
assert.equal(raise.sourceRef,`anomaly:${s.ruleId}:${s.window}`);
assert.equal(raise.ruleVersion,BP_ANOMALY_VERSION);
assert.equal(raise.slaDeadline,new Date(now.getTime()+48*3600_000).toISOString());
const lab=anomalyRaise('5ea0f000-0000-4000-8000-000000000001',detectLdlTrends([p('mr:5ea0f000-0000-4000-8000-0000000000ff','2026-10-01',1.6)],goal,now)[0],now.toISOString());
assert.ok(careQueueRaiseSchema.safeParse(lab).success,'A lab window fits the source ref rules');
assert.equal(lab.ruleVersion,LAB_TREND_VERSION);
for(const rule of ['bp_anomaly.sustained_above_target','bp_anomaly.sudden_rise','bp_anomaly.high_variability','bp_anomaly.low_with_symptoms','bp_anomaly.low_symptoms_unknown','lab_trend.ldl_rising','lab_trend.ldl_not_at_goal','bp_personal_alert_high','bp_personal_alert_low'])
 for(const l of ['hy','en','ru'] as const)assert.notEqual(reasonLabel(rule,l),rule.replaceAll(/[_.:-]+/g,' '),`staff label for ${rule}`);

const member='5ea0f000-0000-4000-8000-000000000002';
const inputs={memberId:member,conditions:[],assessmentRedFlag:null,events:[],target:null,
 readings:sustained.map(x=>({...x,entrySource:null})),ldlGoal:null,ldlObservations:[],openAlerts:0,openSameDayTasks:0,
 medicines:{today:'2026-11-08',days:7,now:now.toISOString(),self:[],plan:[]},lastContactAt:null};
const calls:string[]=[];const raised=new Map<string,number>();
const rpc=async(name:string,args:Record<string,unknown>)=>{
 calls.push(name);
 if(name==='clinical_review_inputs')return {version:'clinical-review-inputs-v1',asOf:now.toISOString(),next:null,members:[inputs]};
 if(name==='care_queue_raise'){const key=String(args.p_source_ref);raised.set(key,(raised.get(key)??0)+1);
  return {ok:true,replayed:raised.get(key)!>1,task:{id:'5ea0f000-0000-4000-8000-0000000000a1',memberId:member,memberName:'X',queue:args.p_queue,zone:args.p_zone,reason:args.p_reason,ruleVersion:args.p_rule_version,
   redFlagsStatus:args.p_red_flags,suggestedAction:null,summary:args.p_summary,slaDeadline:args.p_sla,status:'sent',stateSeq:1,sandbox:false,createdAt:now.toISOString(),seenAt:null,answeredAt:null}};}
 throw Error(`unexpected ${name}`);
};
const env={NOREON_ZOE_APP_V3:'true'};
const first=await runClinicalAnomalySweep(rpc,{deadline:Date.now()+60_000,now:()=>now.getTime(),env});
const second=await runClinicalAnomalySweep(rpc,{deadline:Date.now()+60_000,now:()=>now.getTime(),env});
assert.deepEqual([first.raised,first.replayed,second.raised,second.replayed],[1,0,0,1],'The second sweep replays the same task');
assert.ok(!calls.some(n=>n.startsWith('care_alert')||n.includes('alert_raise')),'Never a care alert');
const off=await runClinicalAnomalySweep(rpc,{deadline:Date.now()+60_000,now:()=>now.getTime(),env:{}});
assert.equal(off.raised+off.replayed,0,'Raising needs NOREON_ZOE_APP_V3');

// 8. The BP flow: a crossed clinician-set alert raises the same-day nurse task once; the crisis band does not.
Object.assign(process.env,{NOREON_ZOE_APP_V3:'true',NOREON_BP_TARGETS:'true'});
const {runBpFlow}=await import('@/lib/zoe-chat-actions/bp-flow-server');
const target={version:1,homeSystolicTarget:130,homeDiastolicTarget:80,setAt:now.toISOString(),setByRole:'cardiologist',physicianName:'X',alertHighSystolic:150,alertHighDiastolic:95,
 alertHighConsecutive:2,alertLowSystolic:95,alertLowPulse:50,reason:null,defaultsVersion:'personal-bp-defaults-2026-11-08'};
const id=(n:number)=>`5ea0f000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function flowRpc(reading:{sbp:number;dbp:number},context:unknown){
 const seen:{name:string;args:Record<string,unknown>}[]=[];
 const fn=async(name:string,args:Record<string,unknown>)=>{seen.push({name,args});
  if(name==='zoe_bp_episode')return {ok:true,readingId:id(9),readings:[{id:id(9),submissionId:id(19),...reading}]};
  if(name==='bp_personal_context')return context;
  if(name==='zoe_bp_staff_item')return {ok:true,alert:null};
  if(name==='zoe_member_clinic_hours')return [];
  if(name==='care_queue_raise'||name==='zoe_bp_task_raise')return rpc('care_queue_raise',args);
  return null;};
 return {fn,seen};
}
const ctx=(rows:{systolic:number;diastolic:number}[])=>({version:'bp-personal-context-v1',target,readings:rows.map((x,i)=>({id:i===rows.length-1?id(9):id(i+1),pulse:null,entrySource:i===rows.length-1?'patient_text_entry':null,measuredAt:at(rows.length-1-i),...x}))});
const ports=(fn:(n:string,a:Record<string,unknown>)=>Promise<unknown>)=>({rpc:fn,post:async()=>({ok:false as const,code:'unavailable'}),readCards:async()=>({enabled:false,cards:[]})}) as never;
const high=flowRpc({sbp:152,dbp:90},ctx([{systolic:151,diastolic:96},{systolic:152,diastolic:90}]));
const out=await runBpFlow(ports(high.fn),member,{submissionId:id(19),systolic:152,diastolic:90});
assert.equal(out.flow.personal?.status,'alert_high');
assert.equal(out.flow.personal?.raised,true);
assert.deepEqual(out.flow.personal?.target,{systolic:130,diastolic:80});
const personalRaise=high.seen.filter(c=>c.name==='care_queue_raise'&&c.args.p_reason==='bp_personal_alert_high');
assert.equal(personalRaise.length,1);
assert.equal(personalRaise[0].args.p_queue,'nurse');assert.equal(personalRaise[0].args.p_zone,'orange');assert.equal(personalRaise[0].args.p_rule_version,PERSONAL_BP_VERSION);
assert.equal(personalRaise[0].args.p_source_ref,`${id(9)}:personal`);
assert.equal((personalRaise[0].args.p_summary as {entrySource?:string}).entrySource,'patient_text_entry','An unverified reading says so');
assert.ok(out.flow.taskIds.length>0,'The member chip follows the task');
const at1=flowRpc({sbp:125,dbp:75},ctx([{systolic:125,diastolic:75}]));
const fine=await runBpFlow(ports(at1.fn),member,{submissionId:id(19),systolic:125,diastolic:75});
assert.equal(fine.flow.personal?.status,'at_target');
assert.ok(!at1.seen.some(c=>c.name==='care_queue_raise'));
const unread=flowRpc({sbp:152,dbp:90},null);
const none=await runBpFlow(ports(unread.fn),member,{submissionId:id(19),systolic:152,diastolic:90});
assert.equal(none.flow.personal,undefined,'An unreadable target gives no comparison, never the wrong numbers');
const crisis=flowRpc({sbp:185,dbp:112},ctx([{systolic:185,diastolic:112},{systolic:186,diastolic:113}]));
const c=await runBpFlow(ports(crisis.fn),member,{submissionId:id(19),systolic:185,diastolic:112});
assert.ok(!crisis.seen.some(x=>x.args.p_reason==='bp_personal_alert_high'),'The crisis band is the emergency rules’ alone');
assert.ok(c.flow.personal===undefined||c.flow.personal.ruleId==='personal_bp.crisis_band');
delete process.env.NOREON_BP_TARGETS;
const offFlow=flowRpc({sbp:152,dbp:90},ctx([{systolic:151,diastolic:96},{systolic:152,diastolic:90}]));
const dark=await runBpFlow(ports(offFlow.fn),member,{submissionId:id(19),systolic:152,diastolic:90});
assert.equal(dark.flow.personal,undefined);assert.ok(!offFlow.seen.some(x=>x.name==='bp_personal_context'),'Switched off: not even read');
console.log('Clinical anomalies: sustained, rise, variability, low readings, LDL trends, idempotent care-queue raises with no alerts, and the BP flow personal alert: ok.');
