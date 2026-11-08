import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PublishedSourceResults} from '@/components/patient-care/published-source-results';
import type {PublishedSourceRow} from '@/lib/patient-care/published-review';
const base:PublishedSourceRow={id:'source',planId:'plan',reportId:'report',publishedAt:'2026-10-10',rowIndex:0,laboratory:'Source lab',reportDate:'2026-10-09',notes:['Original doctor instructions\nUnchanged.'],source:{name:'Long laboratory result name',literal:'7.2',unit:'mmol/L',reference:'4.0–5.6',uncertain:false,page:1,snippet:'Original source'}};
for(const locale of ['en','hy'] as const){
 const html=renderToStaticMarkup(createElement(PublishedSourceResults,{rows:[base],locale}));
 assert.ok(html.includes('data-result-row="true"'),'Published Tests must render the shared full-width result row');
 assert.ok(html.includes(locale==='en'?'Outside the lab’s reference range':'Լաբորատոր միջակայքից դուրս'),'Exact printed numeric mismatch has an explicit non-diagnostic flag');
 assert.ok(html.includes(base.notes[0]),'Original doctor notes remain intact');
 for(const source of [{...base.source,uncertain:true},{...base.source,reference:'Adult: 4–6; child: 3–5'},{...base.source,literal:'&lt;7'}]){
  const unknown=renderToStaticMarkup(createElement(PublishedSourceResults,{rows:[{...base,source}],locale}));
  assert.ok(!unknown.includes(locale==='en'?'Outside the lab’s reference range':'Լաբորատոր միջակայքից դուրս'),'Uncertain/bounded/context-dependent values never gain a comparison flag');
 }
}
console.log('Published source EN/HY rows preserve literal evidence and flag only exact unambiguous references.');
