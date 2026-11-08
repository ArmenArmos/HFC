import * as bpUnit from '@/lib/bp-unit';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
assert.ok(existsSync('components/charts/trend-chart.tsx'),'One shared trend chart is required');
assert.ok(existsSync('lib/staff-zoe/patient-graphs.ts'),'A member-scoped graph projection is required');
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import * as copy from '@/lib/staff/staff-locale-copy';
import * as graphs from '@/lib/staff-zoe/patient-graphs';
import * as facts from '@/lib/staff-zoe/facts';
import {FICTIONAL_RECORDS,MEMBER_A,MEMBER_B} from '@/lib/staff-zoe/eval/fixtures';
import type {ClinicalSnapshot} from '@/lib/patient-care/clinical-case-repository';
import type {TrendPoint} from '@/components/charts/types';
const now=new Date('2026-11-06T12:00:00Z'),a=structuredClone(FICTIONAL_RECORDS[MEMBER_A]);
const snapshot=a.snapshot!;
snapshot.evidence.measurements=[
 {id:'home',systolic:128,diastolic:82,pulse:65,measured_at:'2026-11-05T20:05:00Z',entry_source:'photo_confirmed'},
 {id:'home2',systolic:126,diastolic:80,pulse:66,measured_at:'2026-11-06T08:05:00Z'},
 {id:'typed',systolic:199,diastolic:109,pulse:88,measured_at:'2026-11-04T09:05:00Z',entry_source:'patient_text_entry'},
];

const observedAt='2026-11-06T08:05:00Z';
const clinicSnapshot={...snapshot,evidence:{...snapshot.evidence,visits:[{id:'visit',createdAt:observedAt,bookingContext:null,entries:[{
 id:'entry',submissionId:'submission',observedAt,observedInstant:observedAt,recordedAt:observedAt,actor:{id:'actor',name:'Example',role:'nurse' as const,clinicId:null},source:'staff-entered' as const,measurementId:'home2',payload:{kind:'observation' as const,field:'systolic' as const,state:'known' as const,value:126,unit:'mmHg' as const,observedAt},
}]}]}};
assert.equal(graphs.snapshotBp(clinicSnapshot).bp.find(p=>p.id==='home2')?.source,'clinic','Visit-linked BP is clinic sourced even when its legacy entry source is null');
assert.equal(graphs.snapshotBp(clinicSnapshot).bp.find(p=>p.id==='home')?.source,'home');
const lab={id:'ldl',fileId:'file',source:'clinic' as const,testName:'LDL-C',catalogueRef:null,value:'70',unit:'mg/dL',on:'2026-11-01',mark:'reviewed' as const};
if(a.bpWeek?.enabled)a.bpWeek.weeks=[];
const data=graphs.buildPatientGraphs(MEMBER_A,snapshot,a.bpWeek,[lab],[],a.ldl,now)!;
assert.equal(data.memberId,MEMBER_A);assert.equal(data.series.bp.points.length,3);
assert.equal(data.series.bp.points.find(p=>p.id==='typed')?.source,'member');
assert.equal(data.series.streak.points.at(-1)?.values[0],1,'The unverified observation never adds a measured day');
assert.equal(data.series.ldl.target?.below,1.4);
assert.equal(data.series.bp.target,undefined,'General BP cut points are not a member target');
const extraLdl=graphs.buildPatientGraphs(MEMBER_A,snapshot,a.bpWeek,[lab],[],{...a.ldl!,enabled:true,observations:[
 {id:'la:ldl',value:70,unit:'mg/dL',on:lab.on,source:'clinic_reviewed',name:'LDL-C',memberVisible:false},
 {id:'cr:open',value:2.1,unit:'mmol/L',on:lab.on,source:'clinic_result',name:'LDL-C',memberVisible:false},
 {id:'cr:wrong',value:1.2,unit:'mmol/L',on:lab.on,source:'clinic_result',name:'VLDL-C',memberVisible:true},
]},now)!;
assert.equal(extraLdl.series.ldl.points.filter(p=>p.id==='ldl').length,1,'The same lab row is never duplicated by an LDL reader prefix');
assert.equal(extraLdl.series.ldl.points.find(p=>p.id==='cr:open')?.source,'unreviewed','Unpublished clinic results do not become reviewed points');
assert.ok(!extraLdl.series.ldl.points.some(p=>p.id==='cr:wrong'),'The existing LDL name guard excludes other analytes');
const unsafeFile=graphs.buildPatientGraphs(MEMBER_A,snapshot,a.bpWeek,[],[
 {id:'hidden-file',source:'ai_confirmed',measure:'ldl_c',value:9,unit:'mmol/L',value2:null,measuredOn:'2026-11-01'},
 {id:'old-approved-file',source:'doctor_approved',measure:'ldl_c',value:8,unit:'mmol/L',value2:null,measuredOn:'2026-11-01'},
],{...a.ldl!,enabled:true,observations:[{id:'la:hidden-file',value:9,unit:'mmol/L',on:'2026-11-01',source:'clinic_reviewed',name:'LDL-C',memberVisible:false}]},now)!;
assert.equal(unsafeFile.series.ldl.points.length,0,'Alternate reads cannot reintroduce file values that failed the identity/approval projection');

const draftEvidence=graphs.planGraphEvidence(snapshot,[{valueId:'draft-ldl',testName:'LDL-C',catalogueRef:null,value:2.4,unit:'mmol/L',collectedOn:'2026-11-01',labFlag:null,attention:null,status:'unverified'}]);
assert.equal(draftEvidence.ldl.points[0].source,'unreviewed');
assert.deepEqual(draftEvidence.bp.points.map(p=>p.values),snapshot.evidence.measurements.map(p=>[p.systolic,p.diastolic]));
const early=graphs.buildPatientGraphs(MEMBER_A,snapshot,a.bpWeek,[{...lab,on:'2026-11-06'}],[],null,new Date('2026-11-06T03:00:00Z'))!;
assert.equal(early.series.ldl.points.length,1,'A collection date without a time is not guessed to be a future reading');

assert.equal(graphs.buildPatientGraphs(MEMBER_B,snapshot,null,[],[],null,now),null,'Wrong-member snapshots produce no graph payload');
assert.equal(graphs.labPoint({...lab,value:'< 1.5'}),null);assert.equal(graphs.labPoint({...lab,unit:'unknown'}),null);assert.equal(graphs.labPoint({...lab,on:null}),null);
assert.equal(graphs.registryLdlTarget({...a.ldl!,enabled:true,goals:[{...a.ldl!.goals[0],thresholdMmol:2.2}]}),undefined,'A custom threshold outside the registry is not invented as a chart band');
const changed=structuredClone(snapshot);changed.id=MEMBER_B;
let bound:ClinicalSnapshot=snapshot,deny=false,revoked=false,readCount=0;const scoped:string[]=[];
const modules:Record<string,unknown>={'@/lib/bp-unit':bpUnit,react:React,'react/jsx-runtime':jsx,'@/lib/staff/staff-locale-copy':copy,'@/lib/staff/yerevan-time':await import('@/lib/staff/yerevan-time'),
 'server-only':{},'@/lib/patient-care/clinical-case-repository':await import('@/lib/patient-care/clinical-case-repository'),
 './patient-graphs':graphs,'./patient-labs':{patientLabs:()=>({values:[lab]})},
 '@/lib/bp-week/server':{readStaffBpWeek:async(_client:unknown,id:string)=>{scoped.push(id);return a.bpWeek;}},
 '@/lib/lab-ai/staff-results-server':{readStaffLabResults:async(_client:unknown,id:string)=>{scoped.push(id);return {enabled:true};}},
 '@/lib/staff/doctor-upload-overrides':{readDoctorUploadOverrides:async(_client:unknown,id:string)=>{scoped.push(id);return [];}},
 '@/lib/lab-ai/member-approval-server':{readMemberUploadApprovals:async(_client:unknown,id:string)=>{scoped.push(id);return undefined;}},
 '@/lib/member-history/server':{readMemberHistoryForStaff:async(_client:unknown,id:string)=>{scoped.push(id);return {values:[]};}},
 '@/lib/ldl/runtime':{readDoctorLdl:async(_client:unknown,id:string)=>{scoped.push(id);return a.ldl;}},
};
function load(path:string){const exports:Record<string,unknown>={};vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Date,require:(name:string)=>{assert.ok(name in modules,`Unmocked ${name}`);return modules[name];}});return exports;}
const reader=load('lib/staff-zoe/patient-graphs-read.ts').readPatientGraphs as typeof import('@/lib/staff-zoe/patient-graphs-read').readPatientGraphs;
const rpc={async rpc(name:string,args?:Record<string,unknown>){if(name==='staff_zoe_status')return {data:true,error:null};assert.equal(name,'patient_clinical_case_snapshot');assert.equal(args?.p_user_id,MEMBER_A);readCount++;return {data:bound,error:deny||revoked&&readCount>1?{code:'42501'}:null};}};
const payload=await reader(rpc,MEMBER_A,now);assert.ok(payload);assert.ok(scoped.length>0&&scoped.every(id=>id===MEMBER_A),'Every authorized source is read for the route member only');
assert.ok(!JSON.stringify(payload).includes(MEMBER_B),'Another member never appears in the payload');
for(const failure of ['mismatch','denied','revoked']){scoped.length=0;readCount=0;bound=failure==='mismatch'?changed:snapshot;deny=failure==='denied';revoked=failure==='revoked';assert.equal(await reader(rpc,MEMBER_A,now),null);if(failure!=='revoked')assert.equal(scoped.length,0,'An unauthorized snapshot cannot launch additional reads');}
const ctx={memberId:MEMBER_A,role:'doctor' as const,now,locale:'en' as const};
const {staffRecordReader}=await import('@/lib/staff-zoe/server');
for(const state of ['published','draft','none'] as const){
 const fixture={...snapshot,publications:state==='published'?snapshot.publications:[],draft:state==='draft'?snapshot.draft:null,draftSavedAt:state==='draft'?'2026-11-05T10:00:00Z':null};
 const client={async rpc(name:string,args?:Record<string,unknown>){assert.equal(args?.p_user_id,MEMBER_A);return name==='patient_clinical_case_snapshot'?{data:fixture,error:null}:{data:{version:'plan-versions-v1',versions:state==='published'?a.versions:[]},error:null};}};
 const card=await staffRecordReader(client,'en',now)('plan',MEMBER_A,'doctor');assert.equal(card.state,'ok');
 assert.ok(card.facts.some(f=>f.label===(state==='published'?'Published plan':state==='draft'?'Plan draft':'Care plan')));
}
const wrongReader=staffRecordReader({async rpc(name:string){return {data:name==='patient_clinical_case_snapshot'?changed:{version:'plan-versions-v1',versions:[]},error:null};}},'en',now);
assert.equal((await wrongReader('plan',MEMBER_A,'doctor')).state,'unavailable','The shared record reader rejects an unexpected member before making plan facts');

// Nurse plan facts use only the metadata returned by her authorized snapshot, never a doctor-only RPC.
{
 const current={...a.versions![0]!,changeSummary:null};
 const publication=snapshot.publications![0]!;
 const nurseSnapshot={...snapshot,draft:null,draftSavedAt:null,review:null,planVersions:[current]};
 const readNurse=(data:unknown,error:{code?:string}|null=null)=>staffRecordReader({async rpc(name:string,args?:Record<string,unknown>){
  assert.equal(name,'patient_clinical_case_snapshot','Nurses must not call doctor-only version reads');
  assert.deepEqual(args,{p_user_id:MEMBER_A});
  return {data,error};
 }},'en',now)('plan',MEMBER_A,'nurse');
 const published=await readNurse(nurseSnapshot);
 assert.equal(published.state,'ok','A nurse can read a current published plan');
 assert.equal(published.facts.find(f=>f.label==='Published plan')?.value,'version 2');
 assert.ok(published.facts.every(f=>f.date==='2026-09-12'));
 assert.ok(published.facts.some(f=>f.label==='Plan instruction'&&f.value.includes('5 g')));
 assert.ok(published.facts.some(f=>f.label==='Plan medicine'&&f.value.includes('Atorvastatin 40 mg')));
 assert.ok(!published.facts.some(f=>f.label==='What changed in that version'),'No doctor-only change summary is added');
 const inactive={...current,planId:'f0000000-0000-4000-8000-000000000003',version:3,publishedAt:'2026-11-06T10:00:00Z',current:false};
 const earlier={...publication,planId:inactive.planId,publishedAt:inactive.publishedAt,draft:{...publication.draft,medicationName:'Superseded medicine',instructions:'Superseded instruction'}};
 const history={...nurseSnapshot,publications:[earlier,publication],planVersions:[inactive,current]};
 const matched=await readNurse(history);
 assert.deepEqual(matched.facts,published.facts,'Current metadata wins over publication order, date and version number');
 assert.ok(!JSON.stringify(matched).includes('Superseded'));
 const none=await readNurse({...nurseSnapshot,planVersions:[{...current,current:false}]});
 assert.deepEqual(none.facts.map(f=>[f.label,f.value,f.date]),[['Care plan','No current published plan',null]],'An inactive plan exposes no instructions or medicines');
 for(const bad of [
  {...nurseSnapshot,planVersions:undefined},
  {...nurseSnapshot,planVersions:[]},
  {...nurseSnapshot,planVersions:[inactive]},
  {...nurseSnapshot,planVersions:[{...current,publishedAt:inactive.publishedAt}]},
  {...history,planVersions:[{...inactive,current:true},current]},
  {...history,planVersions:[current,current]},
  {...nurseSnapshot,publications:[publication,publication]},
  {...nurseSnapshot,planVersions:[{...current,version:null}]},
  {...nurseSnapshot,id:MEMBER_B},
 ]){
  const r=await readNurse(bad);assert.equal(r.state,'unavailable');assert.deepEqual(r.facts,[],'Inconsistent nurse reads expose no plan content');
 }
 const failed=await readNurse(null,{code:'XX000'});assert.equal(failed.state,'unavailable');assert.deepEqual(failed.facts,[]);
 await assert.rejects(()=>readNurse(null,{code:'42501'}),{name:'AccessLost'});
 const empty=await readNurse({...nurseSnapshot,publications:[],planVersions:[]});
 assert.equal(empty.facts[0]?.value,'No care plan yet');
}

for(const locale of ['en','hy','ru'] as const){
 const c={...ctx,locale};
 const pub=facts.planResult(snapshot,a.versions,c);assert.equal(pub.state,'ok');assert.ok(pub.facts.some(f=>f.value.includes('2')&&f.date==='2026-09-12'));
 assert.ok(!pub.facts.some(f=>f.value.includes('DRAFT ONLY')),'Draft content never becomes a published-plan fact');
 const draft={...snapshot,publications:[],draftSavedAt:'2026-11-05T10:00:00Z'};
 const d=facts.planResult(draft,[],c);assert.equal(d.state,'ok');assert.ok(d.facts.some(f=>f.date==='2026-11-05'));assert.ok(d.facts.some(f=>f.value.includes(String(snapshot.revision))));
 const none=facts.planResult({...draft,draft:null,draftSavedAt:null},[],c);assert.equal(none.state,'ok');assert.equal(none.facts[0].value,copy.st(locale,'No care plan yet','Խնամքի պլան դեռ չկա','Плана ухода пока нет'));
 assert.deepEqual(facts.planResult(draft,null,{...c,role:'nurse'}).facts,d.facts,'Nurse draft metadata remains available without version metadata');
 assert.deepEqual(facts.planResult({...draft,draft:null,draftSavedAt:null},null,{...c,role:'nurse'}).facts,none.facts);
 const inactive=facts.planResult(snapshot,a.versions!.map(v=>({...v,current:false})),c);
 assert.equal(inactive.state,'ok');
 assert.deepEqual(inactive.facts.map(f=>[f.label,f.value,f.date]),[[copy.st(locale,'Care plan','Խնամքի պլան','План ухода'),copy.st(locale,'No current published plan','Ընթացիկ հրապարակված պլան չկա','Нет действующего опубликованного плана'),null]],'Inactive versions cannot supply published status or clinical content');
 const newer={...a.versions![0]!,planId:'f0000000-0000-4000-8000-000000000003',version:3,publishedAt:'2026-11-06T10:00:00Z',changeSummary:'Fictional version 3 change',current:true};
 const newerVersions=[newer,...a.versions!.map(v=>({...v,current:false}))];
 const unavailable=[
  facts.planResult(snapshot,newerVersions,c),
  facts.planResult(snapshot,[newer],c),
  facts.planResult({...draft,draft:null},a.versions,c),
  facts.planResult(snapshot,null,c),
  facts.planResult(snapshot,null,{...c,role:'nurse'}),
  facts.planResult(snapshot,[],c),
  facts.planResult(snapshot,a.versions!.map(v=>({...v,publishedAt:newer.publishedAt})),c),
  facts.planResult(snapshot,[...a.versions!,newer],c),
 ];
 for(const r of unavailable){assert.equal(r.state,'unavailable','Missing or conflicting reads cannot supply plan facts');assert.deepEqual(r.facts,[]);}
 const newerPublication={...snapshot.publications![0]!,planId:newer.planId,publishedAt:newer.publishedAt,draft:{...snapshot.publications![0]!.draft,medicationName:'Fictional version 3 medicine',medicationDose:'10 mg',medicationTimes:['09:00']}};
 assert.equal(facts.planResult({...snapshot,publications:[...snapshot.publications!,newerPublication]},[...a.versions!,newer],c).state,'unavailable','Two current versions do not identify one current plan');
 assert.equal(facts.planResult({...snapshot,publications:[snapshot.publications![0]!,snapshot.publications![0]!]},newerVersions,c).state,'unavailable','Duplicate publication rows cannot substitute for a matching plan');
 const matched=facts.planResult({...snapshot,publications:[...snapshot.publications!,newerPublication]},newerVersions,c);
 assert.equal(matched.state,'ok');
 assert.deepEqual(matched.facts.find(f=>f.label===copy.st(locale,'Published plan','Հրապարակված պլան','Опубликованный план'))?.value,copy.st(locale,'version','տարբերակ','версия')+' 3');
 assert.ok(matched.facts.every(f=>f.date==='2026-11-06'),'Version, change summary and content share the matched publication date');
 assert.ok(matched.facts.some(f=>f.value.includes('Fictional version 3 medicine')));
 assert.ok(matched.facts.some(f=>f.value===newer.changeSummary));
 assert.ok(!JSON.stringify(matched).includes('Atorvastatin'),'The earlier plan cannot contribute medicine content');
}
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const chart=load('components/charts/trend-chart.tsx') as typeof import('@/components/charts/trend-chart');modules['@/components/charts/trend-chart']=chart;
const surfaces=load('components/doctor-chat-v2/patient-graphs.tsx') as typeof import('@/components/doctor-chat-v2/patient-graphs');
const text=(node:import('react-test-renderer').ReactTestInstance):string=>node.children.map(c=>typeof c==='string'?c:text(c)).join(' ');
const points:TrendPoint[]=[{id:'a',at:'2026-11-05T20:05:00Z',values:[128,82],source:'home',slot:'morning'},{id:'b',at:'2026-11-06T08:00:00Z',values:[126,80],source:'home',slot:'evening'},{id:'c',at:'2026-11-06T10:00:00Z',values:[199,109],source:'member'},{id:'d',at:'2026-11-06T11:00:00Z',values:[135,84],source:'clinic'}];
for(const locale of ['en','hy','ru'] as const){
 let screen!:ReactTestRenderer;
 const props={...surfaces.graphCopy('bp',locale),locale,points:[] as TrendPoint[]};
 await act(async()=>{screen=create(React.createElement(chart.TrendChart,props));});
 assert.equal(screen.root.findAllByProps({role:'img'}).length,0);assert.ok(text(screen.root).includes(props.emptyText));
 await act(async()=>screen.update(React.createElement(chart.TrendChart,{...props,points:points.slice(0,1)})));
 assert.equal(screen.root.findAllByType('polyline').length,0,'A single value has a point, no invented trend');
 await act(async()=>screen.root.findByType('button').props.onClick());assert.equal(screen.root.findAllByType('table').length,1);assert.match(text(screen.root),/128\/82/);assert.match(text(screen.root),/00:05/);
 await act(async()=>screen.update(React.createElement(chart.TrendChart,{...props,points})));
 assert.equal(screen.root.findAllByType('polyline').length,2,'BP has two series on one axis');
 assert.ok(screen.root.findByProps({'data-source':'member'}).findAllByType('path').length>0,'Unverified values are crosses, never verified line segments');
 assert.ok(text(screen.root).includes(chart.chartSource('member',locale)));assert.ok(text(screen.root).includes(chart.chartSource('clinic',locale)));
 assert.equal(screen.root.findAllByType('table')[0].findAllByType('tbody')[0].findAllByType('tr').length,4);
 await act(async()=>screen.unmount());
 const shown=renderToStaticMarkup(React.createElement(surfaces.PatientGraphs,{data,memberId:MEMBER_A,locale}));assert.match(shown,/eGFR/);assert.match(shown,/HbA1c/);
 assert.equal(renderToStaticMarkup(React.createElement(surfaces.PatientGraphs,{data,memberId:MEMBER_B,locale})), '');
 await act(async()=>{screen=create(React.createElement(chart.Sparkline,{...props,points}));});
 await act(async()=>screen.root.findByType('button').props.onClick());assert.equal(screen.root.findAllByType('table').length,1);await act(async()=>screen.unmount());
}
console.log('Patient graphs: mounted empty/single/many, provenance, expand tables, sparklines, EN/HY/RU, scoped payload and published/draft/none facts passed (controlled IO).');
