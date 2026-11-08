import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PublishedSourceResults} from '@/components/patient-care/published-source-results';
const rows=['<0.5','negative','5.2','Trace','1.8'].map((literal,i)=>({id:`current:${i}`,planId:'current',publishedAt:'2026-10-12',reportId:'one-report',rowIndex:i,source:{name:['LDL','Urine protein','Glucose','Urine result','Triglycerides'][i],literal,unit:i===1||i===3?null:'mmol/L',reference:i===1?'negative':'Printed source reference',page:1,snippet:'',uncertain:false},laboratory:'Actual recorded laboratory',reportDate:'2026-10-12',notes:['One recorded public attestation']}));
for(const locale of ['en','hy'] as const){
 const html=renderToStaticMarkup(createElement(PublishedSourceResults,{locale,rows}));
 assert.equal(html.split('One recorded public attestation').length-1,1,'Repeated report attestation appears once, not once per result');
 assert.equal(html.split('Actual recorded laboratory').length-1,1,'Source laboratory is grouped once per report');
 assert.equal(html.split('2026-10-12').length-1,1,'Collection date is grouped once per report');
 assert.ok(html.includes('&lt;0.5'),'Qualified numeric literal is preserved');
 assert.ok(html.includes('negative'),'Unitless text remains a primary released value');
 assert.ok(!html.includes('outside supplied ranges'),'Raw source values have no inferred numeric range summary');
}
console.log('Current released source results: grouped provenance/attestation once, five literal values, EN/HY and no numeric inference.');
// Exercise the real Results page while supplying only its request/data boundaries.
// @ts-expect-error Runtime Node26 supports registerHooks; declarations target Node20.
const {registerHooks}=await import('node:module');
const reactURL=import.meta.resolve('react');
const scope=globalThis as typeof globalThis&{__currentTestsFixture?:unknown;__currentTestsPublication?:unknown};
const hook=registerHooks({resolve(specifier:string,context:object,next:(s:string,c:object)=>object){
 const modules:Record<string,string>={
  '@/lib/patient-care/repository':'export const carePageData=async()=>globalThis.__currentTestsFixture;',
  '@/lib/patient-care/current-published-review':'export const currentPatientPublishedReview=async()=>globalThis.__currentTestsPublication;',
  '@/lib/service-workflow/server':'export const getServiceWorkflowForRender=async()=>null;',
  '@/components/patient/patient-shell':`import {createElement} from '${reactURL}';export const PatientShell=({children})=>createElement('main',null,children);`,
  '@/components/patient-care/member-page-frame':`import {createElement} from '${reactURL}';export const MemberPageFrame=({children})=>createElement('main',null,children);`,
  '@/lib/real-booking/repository':'export const getMemberBookingData=async()=>null;',
  '@/lib/doctor-completion/config':'export const doctorCompletionEnabled=()=>false;',
  '@/components/patient-care/controls':'export const CareRefresh=()=>null;',
  '@/components/patient-care/trends':'export const HealthTrends=()=>null;',
  '@/components/reports/historical-charts':'export const HistoricalCharts=()=>null;',
  '@/components/patient-care/progress-navigation':'export const ProgressNavigation=()=>null;',
 };
 if(modules[specifier])return {url:`data:text/javascript,${encodeURIComponent(modules[specifier])}`,shortCircuit:true};
 return next(specifier,context);
}});
try{
 const {default:Results}=await import('@/components/patient-care/member-results-content');
 const {default:History}=await import('@/app/patient/results/history/page');
 const numeric={id:'older-numeric',testId:null,marker:'LDL',value:2.9,unit:'mmol/L',referenceLow:0,referenceHigh:3,collectedAt:'2026-10-01T00:00:00Z',receivedAt:'2026-10-01T00:00:00Z',source:'laboratory',sourceLabel:'Older source lab',reviewedAt:'2026-10-02T00:00:00Z',reviewedBy:'Recorded doctor',explanation:''};
 for(const locale of ['en','hy'] as const){
  scope.__currentTestsFixture={profile:{locale},assessment:{answers:{},completedAt:null},care:{results:[numeric],tests:[]},demo:false,stage:'treatment'};
  scope.__currentTestsPublication={planId:'current',publishedAt:'2026-10-12',draft:{},sourceRows:rows.map(({reportId,rowIndex,source,laboratory,reportDate,notes})=>({reportId,rowIndex,source,laboratory,reportDate,notes}))};
  const currentHTML=renderToStaticMarkup(await Results());
  const historyLabel=locale==='en'?'Numeric result history':'Թվային արդյունքների պատմություն';
  const historyHTML=renderToStaticMarkup(await History());
  assert.ok(historyHTML.includes(historyLabel),'Older numeric records are explicitly historical on the direct history page');
  assert.ok(historyHTML.includes('2.9'),'Older numeric records remain accessible');
  assert.ok(currentHTML.includes('href="/patient/results/history"'));
  assert.ok(currentHTML.includes('id="tests"'),'Existing tests/preparation action retains its anchor');
  assert.ok(historyHTML.includes('href="/patient/results/history?view=trends"'),'Trends remain directly accessible outside the default history');
  const primary=currentHTML;
  assert.ok(primary.includes('&lt;0.5'));assert.ok(primary.includes('negative'));
  assert.ok(!primary.includes('2.9'),'Older LDL must never precede the current literal source result');
  assert.ok(!primary.includes('role="img"'),'Current qualified/raw values must not inherit an older numeric range band');
  assert.ok(!primary.includes('Your test results'),'Old numeric summary cannot override the current source summary');
  scope.__currentTestsPublication=null;
  for(const demo of [false,true]){
   (scope.__currentTestsFixture as {demo:boolean}).demo=demo;
   const legacyHTML=renderToStaticMarkup(await Results());
   assert.ok(legacyHTML.includes('2.9'),'Legacy/demo numeric values and range presentation remain available');
   assert.ok(legacyHTML.includes('data-result-row="true"'),'Legacy/demo numeric values use the shared readable result row');
   assert.ok(legacyHTML.includes('0 – 3 mmol/L'),'The original supplied numeric interval remains visible');
   assert.ok(legacyHTML.includes(locale==='en'?'Within the lab’s reference range':'Լաբորատոր միջակայքում'),'The supplied interval comparison remains explicit');
   assert.ok(legacyHTML.includes(locale==='en'?'Your test results':'Ձեր հետազոտությունների արդյունքները'));
   assert.ok(!legacyHTML.includes(historyLabel),'Legacy/demo primary results are not relegated to source-only history');
  }
 }
 for (const locale of ['en','hy'] as const) {
  const preparation=locale==='en'?'Exact recorded preparation.':'Գրանցված նախապատրաստման ցուցումները։';
  const location=locale==='en'?'Noreon, 12 Abovyan Street':'Noreon, Աբովյան 12';
  const order={id:'pending-order',title:'Recorded pending blood test',status:'ordered',preparation,orderedBy:'Recorded doctor',orderedAt:'2026-10-12',dueAt:'2026-10-14T08:30:00+04:00',location,source:'clinic',sourceLabel:'Recorded order'};
  scope.__currentTestsFixture={profile:{locale},assessment:{answers:{},completedAt:null},care:{results:[],tests:[order,{...order,id:'booked-order',title:'Recorded booked test',status:'booked'},{...order,id:'old-order',title:'Earlier completed collection',status:'collected'}]},demo:false,stage:'treatment'};
  scope.__currentTestsPublication=null;
  const html=renderToStaticMarkup(await Results());
  const support=html.indexOf('href="/patient/results/history"');
  assert.ok(support>=0);
  const visible=html.slice(0,support);
  for (const content of ['Recorded pending blood test','Recorded booked test',preparation,location]) assert.ok(visible.includes(content),'Actual pending work must remain visible before closed historical details');
  assert.ok(visible.includes(locale==='en'?'To arrange':'Կազմակերպել'));
  assert.ok(visible.includes(locale==='en'?'Booked':'Պլանավորված է'));
  assert.ok(!visible.includes('Earlier completed collection'));
  const past=renderToStaticMarkup(await History());
  assert.ok(past.includes('Earlier completed collection'),'Historical collection remains accessible one navigation away');
  assert.ok(past.includes('href="/patient/results"'),'History has a direct return to current tests');
  (scope.__currentTestsFixture as {care:{tests:unknown[]}}).care.tests=[order];
  const pendingOnly=renderToStaticMarkup(await History());
  assert.ok(pendingOnly.includes(locale==='en'?'No past test orders recorded.':'Նախկին հետազոտությունների նշանակումներ գրանցված չեն։'));
  assert.ok(!pendingOnly.includes(locale==='en'?'No test orders recorded yet.':'Հետազոտության նշանակումներ դեռ գրանցված չեն։'),'An empty history must not contradict the active order');
 }
 console.log('Actual Tests page: current literal precedence; older numeric records disclosed as history; EN/HY and demo/legacy numeric primary views preserved.');
}finally{hook.deregister();delete scope.__currentTestsFixture;delete scope.__currentTestsPublication;}
