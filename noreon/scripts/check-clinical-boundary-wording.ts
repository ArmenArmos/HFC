import assert from 'node:assert/strict';
import {RED_FLAG_REGISTRY} from '@/lib/clinical/rules/rules';
import type {Answers,FieldValue} from '@/lib/clinical/types';
function answers(values:Record<string,FieldValue>):Answers{return Object.fromEntries(Object.entries(values).map(([fieldId,value])=>[fieldId,{fieldId,value,source:'manual',answeredAt:'2026-10-12T00:00:00Z'}]));}
for(const id of ['RF-03','RF-06']){
 const rule=RED_FLAG_REGISTRY.find(r=>r.id===id)!;
 for(const [upper,lower] of [[180,80],[120,110]]){
  assert.ok(rule.evaluate({observations:[],answers:answers({'q5.last_reading.systolic':upper,'q5.last_reading.diastolic':lower,'q5.crisis_symptoms':id==='RF-03'?['chest_pain']:['none']})}),`${id} includes either exact boundary`);
  assert.match(rule.reason.en??'',/180 or more.*or.*110 or more/,'The rendered reason must explain inclusive OR, not require both values above threshold');
  assert.match(rule.reason.hy,/180 կամ ավելի.*կամ.*110 կամ ավելի/);
 }
 assert.equal(rule.evaluate({observations:[],answers:answers({'q5.last_reading.systolic':179,'q5.last_reading.diastolic':109,'q5.crisis_symptoms':id==='RF-03'?['chest_pain']:['none']})}),null);
}
const metabolic=RED_FLAG_REGISTRY.find(r=>r.id==='RF-11')!;
assert.ok(metabolic.evaluate({observations:[],answers:answers({'q6.hba1c':9})}));
assert.equal(metabolic.evaluate({observations:[],answers:answers({'q6.hba1c':8.9})}),null);
assert.match(metabolic.reason.en??'',/9% or more/);assert.match(metabolic.reason.hy,/9% կամ ավելի/);
console.log('Exact clinical boundaries trigger and their displayed reasons describe inclusive thresholds and either BP component.');
