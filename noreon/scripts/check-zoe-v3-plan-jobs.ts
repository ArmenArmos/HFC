import assert from 'node:assert/strict';
import {runV3PlanJobs} from '@/lib/zoe-chat-actions/plan-jobs';
const memberId=crypto.randomUUID(),calls:string[]=[];
const env={NOREON_ZOE_APP_V3:'true',NOREON_MEMBER_CHAT_V2:'true'};
await runV3PlanJobs(async name=>{calls.push(name);if(name==='zoe_v3_plan_members')return [memberId];if(name==='zoe_v3_lab_changes')return [];if(name==='zoe_v3_adherence_context')return {episodes:[],stops:[]};return {state:'ran',posted:0,failed:0};},env);
assert.ok(calls.includes('zoe_v3_adherence_context'),'The same job evaluates real missed-measurement and dose counts');
calls.length=0;
await runV3PlanJobs(async name=>{calls.push(name);throw Error('Must remain dark');},{...env,NOREON_ZOE_APP_V3:'false'});
assert.equal(calls.length,0,'Switch off makes no V3 storage call');
console.log('V3 plan jobs: scheduled adherence and dark switch passed');

const labCalls:string[]=[];
await runV3PlanJobs(async name=>{labCalls.push(name);if(name==='zoe_v3_plan_members')return [];if(name==='zoe_v3_lab_changes')return [];return {state:'ran',posted:0,failed:0};},env);
assert.ok(labCalls.includes('zoe_v3_lab_changes'),'The job processes publication changes even before teach-back');

const {adherenceTasks,followupLabTasks,explicitStatin}=await import('@/lib/zoe-chat-actions/plan-followup');
const at='2026-11-02T16:00:00Z';
const episode={episode:'dose:fixture:2026-11-01',missedDoseDays:1,missedMeasurements:0,wantsToStopStatin:false};
assert.equal(adherenceTasks(memberId,episode,at).length,0);
const missed=adherenceTasks(memberId,{...episode,missedDoseDays:2},at);
assert.deepEqual(missed.map(t=>[t.queue,t.reason]),[['nurse','missed_doses']]);
assert.equal(adherenceTasks(memberId,{...episode,missedDoseDays:0,missedMeasurements:2},at).length,0);
assert.equal(adherenceTasks(memberId,{...episode,missedDoseDays:0,missedMeasurements:3},at)[0].reason,'missed_measurements');
assert.deepEqual(adherenceTasks(memberId,{...episode,wantsToStopStatin:true},at).map(t=>t.queue),['nurse','physician']);
assert.equal(explicitStatin('Atorvastatin'),true);
assert.equal(explicitStatin('Ezetimibe'),false);
assert.equal(explicitStatin('Unknown brand'),false);
const publication={memberId,planId:crypto.randomUUID(),publishedOn:'2026-11-02',changes:[{drugClass:'statin'},{drugClass:'ezetimibe'},{drugClass:'ace_inhibitor'},{drugClass:'lipid_lowering'},{drugClass:null}]};
const labs=followupLabTasks(publication);
assert.equal(labs.unknownDrugClasses,2,'Broad or absent classes do not invent lab schedules');
assert.equal(labs.tasks.length,2,'Shared windows create one task');
assert.deepEqual(labs.tasks.map(t=>t.suggestedAction),['book_labs_2026-12-14_2026-12-28','book_labs_2026-11-16_2026-11-30']);
for(const t of labs.tasks){assert.equal(t.queue,'admin');assert.equal(t.reason,'followup_labs_due');assert.deepEqual(t.summary,{});assert.equal(t.zone,null);assert.equal(t.redFlagsStatus,null);}
assert.equal(followupLabTasks({...publication,changes:[{drugClass:null}]}).tasks.length,0);
console.log('V3 follow-up: adherence boundaries, statin stop routing, canonical lab windows and unknown-class hold passed');
