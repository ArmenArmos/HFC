import assert from 'node:assert/strict';
import {createElement, type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {QuestionField, type Entry} from '@/components/patient/question-field';
import {fieldById} from '@/lib/clinical/seed/questions';
import {UNKNOWN, type Answers} from '@/lib/clinical/types';
import {mergeAnswers,fieldComplete} from '@/lib/patient/questionnaire';
import {evaluate} from '@/lib/clinical/rules/engine';

const known:Answers={'q6.conditions':{fieldId:'q6.conditions',value:['diabetes'],source:'manual',answeredAt:'2026-10-15T00:00:00Z'}};
const field=fieldById('q6.diabetes_years')!;
const saved=mergeAnswers(known,[{fieldId:field.id,value:UNKNOWN}]);
assert.equal(saved[field.id].value,UNKNOWN);
assert.ok(fieldComplete(field,saved),'An explicitly unknown duration permits continuation without a fabricated number');
assert.ok(evaluate({answers:saved,observations:[]}).findings.some(f=>f.ruleId==='NRN-RULE-DM-003'),'Unknown duration retains clinician review');
assert.throws(()=>mergeAnswers(known,[{fieldId:field.id,value:-1}]));
assert.equal(mergeAnswers(known,[{fieldId:field.id,value:0}])[field.id].value,0,'Known zero and unknown remain distinct');
const nodes=(node:unknown):ReactElement<Record<string,unknown>>[]=>{
 if(Array.isArray(node))return node.flatMap(nodes);
 if(!node||typeof node!=='object')return [];
 const element=node as ReactElement<Record<string,unknown>>;
 return [element,...nodes(element.props?.children)];
};
for(const locale of ['en','hy'] as const) {
 let entries:Entry[]=[];let advance:boolean|undefined;
 const props=()=>({field,entries,locale,disabled:false,onChange:(next:Entry[])=>{entries=next;},onSave:async(next:Entry[],a?:boolean)=>{entries=next;advance=a;}});
 const control=nodes(QuestionField(props())).find(n=>typeof n.props['aria-pressed']==='boolean')!;
 assert.ok(control,'The real question renders an unknown action');
 (control.props.onClick as (event:unknown)=>void)({detail:1});
 assert.deepEqual(entries,[{fieldId:field.id,value:UNKNOWN}]);
 assert.equal(advance,true);
 assert.ok(renderToStaticMarkup(createElement(QuestionField,props())).includes('aria-pressed="true"'));
}
console.log('Diabetes duration unknown is selectable, saved, complete and reviewed; zero and invalid numbers remain distinct.');
