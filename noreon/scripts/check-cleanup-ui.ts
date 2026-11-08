import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import type {CleanupView} from '@/lib/cleanup/admin-view';
const require=createRequire(import.meta.url);
const exports:Record<string,unknown>={};
const source=ts.transpileModule(readFileSync('components/cleanup/cleanup-status.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new Function('require','exports',source)((name:string)=>{
 if(name==='react/jsx-runtime')return jsxRuntime;
 if(name==='@/lib/utils')return {cn:(...values:string[])=>values.join(' ')};
 if(name==='lucide-react')return require(name);
 if(name==='@/components/ui/button')return {buttonVariants:({className}:{className:string})=>'border focus-visible:ring-3 '+className};
 if(name==='next/link')return {default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement('a',props,children)};
 throw Error(name);
},exports);
const View=exports.CleanupStatus as React.ComponentType<{view:CleanupView;embedded?:boolean}>;
const render=(view:CleanupView)=>renderToStaticMarkup(React.createElement(View,{view}));
for(const view of [{state:'unavailable'},{state:'invalid'},{state:'ready',runs:[],older:false}] as CleanupView[]){
 const html=render(view);assert.match(html,/<details/);assert.match(html,/About these records/);assert.ok(!/<details[^>]* open/.test(html),'Details start collapsed');assert.ok(!html.includes('class="underline"'));
 if(view.state==='unavailable'){assert.match(html,/>Refresh records<\/a>/);assert.match(html,/min-h-11/);assert.match(html,/<svg/);}
}
const run={run_id:'cd000000-0000-4000-8000-000000000001',job_kind:'report-cleanup' as const,started_at:'2026-10-14T16:00:00Z',ended_at:null,status:'running' as const,attempted:0,cleaned:0,failed:0,failure_category:null};
const html=render({state:'ready',runs:Array.from({length:50},(_,i)=>({...run,run_id:`cd000000-0000-4000-8000-${String(i).padStart(12,'0')}`})),older:true});
assert.match(html,/See older runs/);assert.match(html,/See latest runs/);assert.ok(!html.includes('0 / 0 / 0'));assert.match(html,/Not recorded/);assert.match(html,/Incomplete means no recorded completion/);assert.match(html,/Missing executions may be unrecorded/);
const embedded=renderToStaticMarkup(React.createElement(View,{view:{state:'ready',runs:[run],older:false},embedded:true}));
assert.match(embedded,/<h2[^>]*>Data cleanup<\/h2>/);assert.match(embedded,/<h3[^>]*>Incomplete/);assert.doesNotMatch(embedded,/<h1/);
console.log('Cleanup UI has collapsed detail, icon navigation with 44px minimum, refresh link, and honest incomplete counts.');
