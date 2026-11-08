import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {HomeMemberSummary} from '@/components/staff/doctor-workspace/home-presentation';
import type {ToolResult} from '@/lib/staff-zoe/contracts';
const records:ToolResult[]=[{tool:'labs',state:'ok',href:'/source',missing:[],quotes:[],facts:[{id:'lab',label:'LDL-C',value:'2.3 mmol/L',date:'2026-11-01',mark:'reviewed',href:'/source',analyte:'ldl'}]},{tool:'member_messages',state:'ok',href:'/messages',facts:[],missing:[],quotes:[{id:'quote',text:'My morning readings were 150/95',date:'2026-11-01',flagged:false}]}];
const html=renderToStaticMarkup(React.createElement(HomeMemberSummary,{records,readings:[],reasons:['A saved alert needs review'],locale:'en'}));
assert.match(html,/A saved alert needs review/);assert.match(html,/2.3 mmol\/L/);assert.match(html,/My morning readings were 150\/95/);assert.match(html,/1 Nov 2026/);assert.match(html,/Source/);assert.doesNotMatch(html,/RF-01|Reference/);
console.log('Opening summary shows the saved reason, lab value, source/date and member words');

const render=(items:ToolResult[],readings:Parameters<typeof HomeMemberSummary>[0]['readings']=[])=>renderToStaticMarkup(React.createElement(HomeMemberSummary,{records:items,readings,reasons:[],locale:'en'}));
const tools=['bp','labs','member_messages'] as const;
const result=(state:ToolResult['state']):ToolResult[]=>tools.map(tool=>({tool,state,href:'/staff/real/members/example',facts:[],quotes:[],missing:[]}));
for(const state of ['unavailable','off','not_permitted','not_built'] as const){
 const summary=render(result(state));
 assert.doesNotMatch(summary,/No reading|No lab value|No member message/,'A failed, disabled or inaccessible read must not claim an empty record');
 assert.match(summary,state==='off'?/switched off/:state==='not_permitted'?/your role/:state==='not_built'?/not available yet/:/could not be read/i);
}
for(const state of ['none','ok'] as const){
 const summary=render(result(state));
 assert.match(summary,/No reading/);assert.match(summary,/No lab value/);assert.match(summary,/No member message/);
}
assert.doesNotMatch(render(result('none'),null),/No reading/,'An unavailable history cannot be presented as an empty reading');
assert.match(render(result('none'),null),/history could not be read/i);
const switchedOff=renderToStaticMarkup(React.createElement(HomeMemberSummary,{records:result('none'),readings:null,bpState:'off',reasons:[],locale:'en'}));
assert.match(switchedOff,/history is switched off/i);assert.doesNotMatch(switchedOff,/No reading|could not be read/);
const reading={id:'reading',systolic:142,diastolic:91,pulse:70,measuredAt:'2026-11-01T08:00:00Z',source:'device' as const,serial:'TEST-MONITOR-42'};
const monitor=render(result('none'),[reading]);
assert.match(monitor,/Monitor TEST-MONITOR-42/);assert.match(monitor,/not yet part of the evidence for review/);
assert.match(render(result('none'),[{...reading,serial:null}]),/Monitor.*identity not recorded/i,'A monitor without a serial must never be called a manual reading');
for(const [source,label] of [['manual','Recorded manually'],['visit','Recorded at a visit']] as const){
 const summary=render(result('none'),[{...reading,source,serial:null}]);
 assert.ok(summary.includes(label));assert.doesNotMatch(summary,/not yet part of the evidence for review/);
}
assert.doesNotMatch(render([{...records[1],state:'unavailable'}]),/My morning readings/,'Only a successful message read supplies a quote');
console.log('Summary read states, unavailable history, monitor identity/evidence warning and manual/visit provenance passed');
