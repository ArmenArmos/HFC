import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url),exports:Record<string,unknown>={};
const source=ts.transpileModule(readFileSync('components/staff/nurse-visit-actions.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const deps:Record<string,unknown>={
 'react':React,'react/jsx-runtime':require('react/jsx-runtime'),'next/navigation':{useRouter:()=>({refresh(){}})},'lucide-react':await import('lucide-react'),
 './bp-high-warning':{BpHighWarning:()=>null},'./shell':{fieldClass:'field',buttonClass:'button'},'@/lib/staff/yerevan-time':await import('@/lib/staff/yerevan-time'),'./nurse-visit-timeline':await import('@/components/staff/nurse-visit-timeline'),
 '@/lib/nurse-visit/collection':await import('@/lib/nurse-visit/collection'),'@/lib/staff/staff-locale-copy':await import('@/lib/staff/staff-locale-copy'),'@/lib/patient/catalogue-label':await import('@/lib/patient/catalogue-label'),'@/lib/nurse-visit/actions':{recordNurseVisitCollect:async()=>({status:'saved'}),refreshNurseVisit:async()=>null},
 '@/lib/nurse-visit/copy':await import('@/lib/nurse-visit/copy'),
 '@/lib/nurse-visit/schema':await import('@/lib/nurse-visit/schema'),'@/lib/locale':await import('@/lib/locale'),
};
const card:Record<string,unknown>={};
new vm.Script(ts.transpileModule(readFileSync('components/nurse-chat-v2/sample-collection.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports:card,crypto,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
deps['@/components/nurse-chat-v2/sample-collection']=card;
new vm.Script(source).runInNewContext({exports,crypto:globalThis.crypto,Date,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
const Component=exports.NurseVisitActions as React.ComponentType<Record<string,unknown>>;
const data={visit:{memberName:'Fictional member',memberId:'aa110000-0000-4000-8000-000000000001',source:'appointment',id:'aa110000-0000-4000-8000-000000000002',startsAt:'2026-11-01T08:00:00Z'},today:'2026-11-01',items:[{kind:'measurement',field:'bp',key:'measure:bp',mark:null},{kind:'check',key:'check:safety',section:'safety',label:{en:'Existing safety line',hy:'Անվտանգության տող'},source:'Protocol',mark:null}],steps:[],completion:null,checklistVersion:'v1'};
for(const locale of ['en','hy','ru']){
 const html=renderToStaticMarkup(React.createElement(Component,{data,locale,inline:true,completeIds:{},mark:async()=>({status:'saved'}),step:async()=>({status:'saved'}),complete:async()=>({status:'saved'})}));
 assert.equal((html.match(/aria-labelledby="nv-(steps|samples|measures|devices)"/g)||[]).length,4,'All four action sections remain reachable');
 assert.equal((html.match(/<details[^>]*open=""[^>]*aria-labelledby="nv-(steps|samples|measures|devices)"/g)||[]).length,1,'Only one visit section opens on entry');
 const safety=html.indexOf(locale==='en'?'Existing safety line':'Անվտանգության տող');
 assert.ok(safety>=0, 'Safety instructions remain visible outside collapsed disclosures');
 assert.ok(html.indexOf('aria-labelledby="nv-steps"')<safety,'Visit steps come first');
 assert.ok(html.includes('measure:bp')||html.includes('nv-measure-bp'),'Required measurement remains in the DOM');
}
console.log('Visit disclosures: steps open first; safety stays outside disclosures; required items retained in en/hy/ru. Browser visibility is checked by scripts/nurse-visit-visibility.ts.');

// Extend the rendered visit regression with the requested language sweep.
await import('./nurse-visit-language');
