import {PublishedSourceResults} from '../components/patient-care/published-source-results';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {LabRange} from '../components/patient-care/lab-range';
import {ResultHistory} from '../components/patient-care/result-history';
import {labRange} from '../lib/patient-care/journey-evidence';
import type {CareResult} from '../lib/patient-care/types';
const result:CareResult&{referenceText:string}={id:'source-row',testId:null,marker:'LDL',value:2.1,unit:'mmol/L',referenceLow:null,referenceHigh:null,referenceText:'below 3.0; source wording',collectedAt:'2026-10-12T00:00:00Z',receivedAt:'2026-10-12T00:00:00Z',source:'laboratory',sourceLabel:'SYNTHETIC QA Lab',reviewedAt:'2026-10-12T00:00:00Z',reviewedBy:'Synthetic doctor',explanation:'Checked source'};
assert.equal(labRange(result).status,'unknown','literal text must not infer numeric bounds');
for(const locale of ['en','hy'] as const){
 const range=renderToStaticMarkup(createElement(LabRange,{result,locale}));
 assert.ok(range.includes(result.referenceText));
 assert.ok(!range.includes('role="img"'),'no numeric position inferred');
 const history=renderToStaticMarkup(createElement(ResultHistory,{results:[result],locale}));
 assert.ok(history.includes(result.referenceText));assert.ok(history.includes(result.sourceLabel));
}
const absent=renderToStaticMarkup(createElement(LabRange,{result:{...result,referenceText:''},locale:'en'}));
assert.ok(absent.includes('Not reported'));
console.log('Literal source reference and laboratory render in English/Armenian while numeric range remains unknown.');

for(const locale of ['en','hy'] as const){
 const html=renderToStaticMarkup(createElement(PublishedSourceResults,{locale,rows:['<0.5','negative','5,2 *','Trace'].map((literal,i)=>({id:String(i),planId:'p',publishedAt:'2026-10-12',reportId:'r',rowIndex:i,source:{name:'Raw marker',literal,unit:null,reference:'Printed words',page:1,snippet:'',uncertain:false},laboratory:'Synthetic source lab',reportDate:'2026-10-12',notes:['Source checked']}))}));
 for(const literal of ['&lt;0.5','negative','5,2 *','Trace','Printed words','Synthetic source lab','/patient/review'])assert.ok(html.includes(literal));
 assert.ok(!html.includes('role="img"'));
}
