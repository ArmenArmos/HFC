import assert from 'node:assert/strict';
import {practiceDailyLimits,mutatePractice} from '../lib/zoe/practice/store';
import {startPractice} from '../lib/zoe/practice/engine';
assert.deepEqual(practiceDailyLimits({}),{doctor:60,global:300});
assert.deepEqual(practiceDailyLimits({NOREON_ZOE_PRACTICE_DAILY_TURNS:'{"doctor":5,"global":10}'}),{doctor:5,global:10});
for(const raw of ['true','{}','{"doctor":61,"global":300}','{"doctor":60,"global":301}','{"doctor":1.2,"global":2}','{"doctor":1,"global":2,"unknown":1}'])assert.deepEqual(practiceDailyLimits({NOREON_ZOE_PRACTICE_DAILY_TURNS:raw}),{doctor:0,global:0});
const state=startPractice('practice-new-ldl');
let call:unknown;
const result=await mutatePractice(async(name,args)=>{call={name,args};return {ok:true,session:{id:'10000000-0000-4000-8000-000000000001',version:0,state}};},'10000000-0000-4000-8000-000000000002','create',{patientId:state.patientId,state});
assert.equal(result.ok,true);
assert.equal((call as {name:string}).name,'zoe_practice_mutate');
assert.deepEqual(await mutatePractice(async()=>({ok:false,code:'daily_limit'}),'author','reserve',{}),{ok:false,code:'daily_limit'});
await assert.rejects(()=>mutatePractice(async()=>({ok:true,session:{id:'10000000-0000-4000-8000-000000000001',version:0,state:{...state,patientId:'real-member'}}}),'author','reserve',{}));
console.log('Practice storage: limits fail closed; persisted state validation and refusal propagation passed.');

const conflict=await mutatePractice(async()=>({ok:false,code:'conflict',session:{id:'10000000-0000-4000-8000-000000000001',version:2,state}}),'author','reserve',{});
assert.equal(conflict.ok,false);assert.equal(conflict.session?.version,2);assert.equal(conflict.session?.state.patientId,state.patientId);
