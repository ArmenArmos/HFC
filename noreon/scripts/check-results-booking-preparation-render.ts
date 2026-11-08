import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as common from '@/components/patient-care/common';
import {ResultHistory} from '@/components/patient-care/result-history';
import {TestOrders} from '@/components/patient-care/test-orders';
import {createWorkflow,applyServiceCommand,workflowCare} from '@/lib/service-workflow/model';
import {evaluate,buildPlan} from '@/lib/clinical/rules/engine';
import * as suggestionFilter from '@/lib/patient-care/suggestion-filter';
import type {BookingRequest,MemberBookingData} from '@/lib/real-booking/schema';

// Render the actual page and preparation component. Only IO and unrelated panels are mocked.
let locale:'en'|'hy'='en', urgentRule:string|null=null;
let completedAt:string|null='2026-10-13';
let answers:Parameters<typeof evaluate>[0]['answers']={};
const unavailableBookings:MemberBookingData={available:false,requirements:[],homeTasks:[],requests:[]};
let realBookings:MemberBookingData=unavailableBookings;
const now=new Date('2026-10-13T02:00:00Z');
const tests=['one','two'].map(id=>({id,title:`Recorded lab ${id}`,method:'lab' as const,preparation:'',source:'fixture'}));
// Workflow fixtures only build realistic care orders; the page itself never reads a workflow.
const base=applyServiceCommand(createWorkflow(tests,now),{type:'book',testIds:['one'],at:'2026-10-14T09:00:00+04:00',mode:'home',address:'Fictional address'},now);
const provider='Fictional recorded provider';
const instructions='RECORDED PROVIDER START\nFull supplied text, not generated advice.\nRECORDED PROVIDER END';
const recorded=applyServiceCommand(base,{type:'record-provider-preparation',bookingId:base.bookings[0].id,provider,instructions},now,{role:'admin',id:'fictional-admin'});
let care=workflowCare(recorded,[],false);
const exports:Record<string,unknown>={};
const compiled=ts.transpileModule(readFileSync('components/patient-care/member-results-content.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const children=({children}:{children?:React.ReactNode})=>React.createElement('div',{},children);
new vm.Script(compiled).runInNewContext({exports,require:(name:string)=>{
 if(name==='react/jsx-runtime')return jsx;
 if(name.endsWith('/member-screens-config'))return {memberScreensPrototypeEnabled:()=>false};
 if(name.endsWith('/member-screens'))return {MemberScreen:children};
 if(name==='next/link')return {default:({href,children,...props}:{href:string;children:React.ReactNode})=>React.createElement('a',{href,...props},children)};
 if(name.endsWith('/common'))return common;
 if(name==='@/lib/real-booking/repository')return {getMemberBookingData:async()=>realBookings};
 if(name.endsWith('/repository'))return {carePageData:async()=>({profile:{locale},assessment:{answers,completedAt,urgentRule},care,stage:'testing',chartMeasurements:[]})};
 if(name.endsWith('/result-history'))return {ResultHistory};
 if(name.endsWith('/test-orders'))return {TestOrders};
 if(name.endsWith('/current-published-review'))return {currentPatientPublishedReview:async()=>null};
 if(name.endsWith('/published-review'))return {currentPublishedSourceRows:()=>[]};
 if(name.endsWith('/clinical/rules/engine'))return {evaluate,buildPlan};
 if(name==='@/lib/patient-care/suggestion-filter')return suggestionFilter;
 if(name.endsWith('/patient-shell'))return {PatientShell:children};
 if(name.endsWith('/member-page-frame'))return {MemberPageFrame:children};
 if(name.endsWith('/controls'))return {CareRefresh:()=>null};
 return new Proxy({}, {get:()=>()=>null});
}});
const page=exports.default as ()=>Promise<React.ReactNode>;
function disclosureDepth(html:string, text:string) {
 const position=html.indexOf(text);
 assert.ok(position>=0, `Expected rendered text: ${text}`);
 const prefix=html.slice(0,position);
 const depth=[...prefix.matchAll(/<details\b|<\/details>/g)].reduce((depth,match)=>depth+(match[0]==='</details>'?-1:1),0);
 return depth-(prefix.lastIndexOf('<summary')>prefix.lastIndexOf('</summary>')?1:0);
}
for(locale of ['en','hy'] as const) {
 realBookings=unavailableBookings;urgentRule=null;answers={};completedAt='2026-10-13';
 care=workflowCare(recorded,[],false);
 let html=renderToStaticMarkup(await page());
 let depth=0; for(const m of html.matchAll(/<details\b|<\/details>/g)){depth+=m[0]==='</details>'?-1:1;assert.ok(depth<=1,'Tests never nests disclosures');}
 assert.ok(!html.includes('href="/patient/service"'),'Unsupported service booking has no dead action');
 assert.equal(disclosureDepth(html,locale==='en'?'Due':'Ժամկետ'),0,'Pending due date stays visible');
 assert.equal(disclosureDepth(html,locale==='en'?'Preparation needs provider confirmation':'Նախապատրաստումը ճշտեք բուժծառայություն մատուցողի հետ'),1,'Unconfirmed preparation is accessible without dominating the row');
 // A collection without current receipt evidence stays in history.
 care=workflowCare(applyServiceCommand(recorded,{type:'receive',testIds:['one']},now),[],false);
 care.tests.push({...care.tests[0],id:'cancelled',title:'Cancelled old order',status:'cancelled'});
 html=renderToStaticMarkup(await page());
 const liveCurrent=html.match(/<section id="active-tests"[\s\S]*?<\/section>/)?.[0]??'';
 assert.ok(!liveCurrent.includes('Recorded lab one'),'A real collection without current receipt evidence stays in history');
 assert.ok(liveCurrent.includes('Recorded lab two'),'The pending test stays on Tests');
 assert.ok(!liveCurrent.includes('Cancelled old order'),'Cancelled orders stay in history');
 assert.ok(html.includes('href="/patient/results/history"'),'Historical collections remain one direct navigation away');
 const liveHistory=renderToStaticMarkup(React.createElement(TestOrders,{tests:care.tests,locale}));
 assert.ok(liveHistory.includes('Recorded lab one'),'The real collection remains accessible in history');
 assert.ok(liveHistory.includes(locale==='en'?'Sample collected':'Նմուշը հանձնված է'));
 assert.ok(!liveCurrent.includes(locale==='en'?'Received 1':'Ստացվել է 1'),'Collection alone is not a result receipt');
 assert.ok(!html.includes(locale==='en'?'No tests or approved results yet.':'Հետազոտություններ կամ հաստատված արդյունքներ դեռ չկան։'),'Historical tests must not be described as never having existed');

 // Real Tests exposes the actual request entry separately from clinical orders/results.
 care=workflowCare(createWorkflow([],now),[],false);
 realBookings={available:true,contextToken:'synthetic-current-context',requirements:[{id:'lipid-panel',title:'Synthetic lipid requirement',method:'lab'}],homeTasks:[],requests:[]};
 const beforeAvailable=JSON.stringify(realBookings);
 html=renderToStaticMarkup(await page());
 assert.ok(html.includes(locale==='en'?'Test arrangements':'Հետազոտությունների կազմակերպում'));
 assert.ok(html.includes(locale==='en'?'Request tests':'Հետազոտության հարցում'));
 assert.match(html,/href="\/patient\/service"/,'Current real recommendations have a working request entry');
 assert.ok(!html.includes(locale==='en'?'Doctor-approved results':'Բժշկի հաստատած արդյունքները'),'A recommendation/request is not a published clinical result');
 assert.ok(!html.includes(instructions),'Real request entry never borrows demo provider preparation');
 assert.equal(JSON.stringify(realBookings),beforeAvailable,'Rendering current real recommendations is read-only');
 const terms={startsAt:'2026-10-15T05:00:00Z',endsAt:'2026-10-15T07:00:00Z',timezone:'Asia/Yerevan' as const,mode:'clinic' as const,location:'Synthetic local QA address'};
 const request:BookingRequest={id:'00112233-4455-4677-8899-aabbccddeeff',revision:1,status:'requested',requestedTerms:terms,requirements:realBookings.requirements,algorithmVersion:'synthetic-test',contextToken:'synthetic-current-context',contextStale:false,proposal:null,currentArrangement:null,pendingChange:null,createdAt:now.toISOString()};
 realBookings={...realBookings,available:false,requirements:[],requests:[request,{...request,id:'10112233-4455-4677-8899-aabbccddeeff',status:'cancelled'}]};
 const beforeRecorded=JSON.stringify(realBookings);
 html=renderToStaticMarkup(await page());
 assert.ok(html.includes(locale==='en'?'1 active request':'1 ակտիվ հարցում')&&!html.includes('1 active requests'),'Cancelled requests are excluded from active coordination count, with singular wording');
 assert.ok(html.includes(locale==='en'?'View test requests':'Տեսնել հարցումները'),'Existing real requests remain accessible while new requests are unavailable');
 assert.match(html,/href="\/patient\/service"/,'Unavailable creation does not hide already recorded request status');
 assert.ok(!html.includes(locale==='en'?'Doctor-approved results':'Բժշկի հաստատած արդյունքները'),'Existing operational requests do not imply doctor approval');
 assert.equal(JSON.stringify(realBookings),beforeRecorded,'Request status rendering never mutates operational records');
 urgentRule='RF-01';html=renderToStaticMarkup(await page());
 assert.ok(!html.includes('href="/patient/service"'),'Stored urgent guidance hides real routine request entry even when existing requests remain recorded');
 urgentRule=null;answers={'q9.right_now':{fieldId:'q9.right_now',value:'yes',source:'manual',answeredAt:now.toISOString()}};
 html=renderToStaticMarkup(await page());
 assert.ok(!html.includes('href="/patient/service"'),'Fresh red answers hide the real request entry even with a returned operational DTO');
 answers={};

 // An incomplete real questionnaire has no routine request entry or clinical orders.
 realBookings=unavailableBookings;completedAt=null;
 html=renderToStaticMarkup(await page());
 assert.ok(!html.includes('href="/patient/service"'),'A real empty requirement/request list does not offer unnecessary booking');
 assert.ok(html.includes('href="/patient/reports"'),'A real empty view retains report access');
 completedAt=null;
 realBookings=unavailableBookings;
 care=workflowCare(createWorkflow([],now),[],false);
 html=renderToStaticMarkup(await page());
 assert.ok(html.includes(locale==='en'?'No current test orders or approved results here.':'Այստեղ ընթացիկ նշանակումներ կամ հաստատված արդյունքներ չկան։'));
 assert.ok(!html.includes(locale==='en'?'No doctor-approved results available here yet.':'Այստեղ բժշկի հաստատած արդյունքներ դեռ հասանելի չեն։'),'An empty Tests view does not repeat the empty result state');
 assert.ok(html.includes('href="/patient/reports"'),'The empty view offers the available report history entry');
}
console.log('Actual Tests EN/HY: pending orders, collected history, read-only real request entry, unavailable-existing status, cancelled-count, urgent and empty states without clinical approval inference.');
