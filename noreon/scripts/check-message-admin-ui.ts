import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import * as icons from 'lucide-react';
import * as jsxRuntime from 'react/jsx-runtime';
import type {AdminMessageView} from '@/lib/messaging/admin-view';
import {renderToStaticMarkup} from 'react-dom/server';
assert.ok(existsSync('components/messaging/admin-message-status.tsx'),'Admin status UI must exist');
const exports:Record<string,unknown>={};
const source=ts.transpileModule(readFileSync('components/messaging/admin-message-status.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new Function('require','exports',source)((name:string)=>{if(name==='lucide-react')return icons;if(name==='react/jsx-runtime')return jsxRuntime;if(name==='next/link')return {default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement('a',props,children)};throw Error(name);},exports);
const View=exports.AdminMessageStatus as React.ComponentType<{view:AdminMessageView}>;
const readiness={operations:false,delivery:false,recovery:false,callbacks:false,sms:false,whatsapp:false};
for(const state of ['disabled','unavailable','invalid']){
 const html=renderToStaticMarkup(React.createElement(View,{view:{state:state as 'disabled'|'unavailable'|'invalid',readiness}}));
 assert.ok(!html.includes('No messages need attention'));
 assert.ok(!/<form|<button/.test(html),'Read-only UI has no mutation controls');
}
const view:Extract<AdminMessageView,{state:'ready'}>={state:'ready',observedAt:Date.now(),readiness,status:{control:{revision:0,budget_day:'2026-10-14',started_count:0,daily_limit:200,paused_reason:'provider-unknown',paused_at:null},attention:[],nextCursor:null},spending:{policy:{enabled:false,currency:null,daily_limit_micros:0,valid_until:null},budgetDay:'2026-10-14',reservedMicros:0,remainingMicros:0}};
let html=renderToStaticMarkup(React.createElement(View,{view}));assert.match(html,/No messages need attention/);assert.match(html,/Notification delivery is inactive/);assert.match(html,/Provider outcome is unknown/);assert.match(html,/Estimated reservations/);
view.status.attention.push({attempt_id:'b9800000-0000-4000-8000-000000000001',started_at:'2026-10-14T08:00:00Z',reason:'delivery-conflict',submission_status:'accepted',reconcile_failures:2});
view.status.nextCursor={startedAt:'2026-10-14T08:00:00Z',attemptId:'b9800000-0000-4000-8000-000000000001'};
html=renderToStaticMarkup(React.createElement(View,{view}));assert.match(html,/Conflicting delivery receipts/);assert.match(html,/See older items/);assert.ok(!/<form|<button/.test(html));
assert.match(html,/12:00 Yerevan time/,'The attempt timestamp and its timezone label agree');
assert.doesNotMatch(html,/\b(?:AM|PM)\b/);
console.log('Rendered admin view separates empty/disabled/error, labels inactive/paused delivery and estimates, and provides read-only paging.');
