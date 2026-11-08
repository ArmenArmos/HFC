import * as bpUnit from '@/lib/bp-unit';
/** Provenance survives real chart contracts and rendered staff/member surfaces. No IO. */
import assert from 'node:assert/strict';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {stamp} from '@/components/patient-care/common';
import {st} from '@/lib/staff/staff-locale-copy';
import * as provenance from '@/lib/patient/bp-provenance';
import {renderToStaticMarkup} from 'react-dom/server';
import {bpReadingSchema} from '@/lib/bp-device/schema';
import {BpReadingsHistory} from '@/components/staff/bp-readings-history';
import {MeasurementTrend} from '@/components/patient/measurement-trend';
import {PressureDetailSummary,RecentReadings} from '@/components/patient-care/pressure-detail-summary';
import {HealthTrends} from '@/components/patient-care/trends';
import type {Measurement} from '@/lib/patient/types';
const now=new Date('2026-11-05T12:00:00Z');
const reading={id:'a1000000-0000-4000-8000-000000000001',systolic:199,diastolic:109,pulse:77,measuredAt:'2026-11-05T10:00:00Z',source:'manual' as const,serial:null,entrySource:'patient_text_entry'};
const typed={...reading,submissionId:reading.id} as Measurement;
const verified={...typed,id:'a1000000-0000-4000-8000-000000000002',entrySource:'photo_confirmed',systolic:122,diastolic:76,measuredAt:'2026-11-04T10:00:00Z'};
const render=(component:React.ElementType,props:Record<string,unknown>)=>renderToStaticMarkup(React.createElement(component,props));
assert.ok(bpReadingSchema.safeParse(reading).success,'staff chart contract retains entrySource');
for(const entrySource of [null,undefined,'photo_confirmed'])assert.ok(bpReadingSchema.safeParse({...reading,entrySource}).success,'legacy and verified provenance remains compatible');
const deps:Record<string,unknown>={'@/lib/bp-unit':bpUnit,react:React,'react/jsx-runtime':jsx,'@/lib/patient/bp-provenance':provenance,'@/lib/staff/care-command-schema':{nativeCareCommandSchema:{}},'@/lib/staff-zoe/everyday-actions':{doctorWorkspaceCareCommand:()=>{throw Error('No writes allowed');}},'@/lib/patient/measured-at':{isFutureMeasurement:()=>false},'@/lib/staff/staff-locale-copy':{st},'@/components/patient-care/common':{stamp},'@/components/staff/bp-high-warning':{BpHighWarning:()=>null}};
const out:Record<string,unknown>={};
new vm.Script(ts.transpileModule(readFileSync('components/staff/doctor-workspace/observations-card.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports:out,Date,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
const DoctorObservations=out.DoctorObservationsCard as React.ElementType;
const repositoryDeps:Record<string,unknown>={'server-only':{},'@/lib/patient-care/pagination':{readAllPages:async()=>[{id:reading.id,submission_id:reading.id,systolic:199,diastolic:109,pulse:77,measured_at:reading.measuredAt,entry_source:'patient_text_entry'}]},'@supabase/supabase-js':{},'@/lib/supabase/server':{createClient:async()=>({})},'./auth':{requirePatient:async()=>({userId:reading.id})},'next/navigation':{},'./database-store':{}};
const repository:Record<string,unknown>={};
new vm.Script(ts.transpileModule(readFileSync('lib/patient/repository.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports:repository,require:(name:string)=>{assert.ok(name in repositoryDeps,name);return repositoryDeps[name];}});
const mapped=await (repository.getMeasurements as ()=>Promise<Measurement[]>)();
assert.equal(mapped[0].entrySource,'patient_text_entry','member repository retains DB provenance');


for(const [locale,label] of [['en','Member-reported, not verified'],['hy','Անդամի հաղորդածը, չստուգված'],['ru','Со слов участника, не проверено']] as const){
 const history=render(BpReadingsHistory,{readings:[reading],locale});
 assert.ok(history.includes(label),'typed row has explicit provenance in staff history');
 assert.ok(history.includes('199/109'),'typed values remain available for safety');
 assert.ok(!history.includes('<polyline'),'typed-only staff history never makes a trend');
 const mixed=render(BpReadingsHistory,{readings:[reading,{...verified,serial:null}],locale});
 assert.ok(!mixed.includes('<polyline'),'one verified reading plus typed reading is not a trend');
 const doctor=render(DoctorObservations,{snapshot:{id:reading.id,revision:1,evidence:{measurements:[{id:reading.id,systolic:199,diastolic:109,pulse:77,measured_at:reading.measuredAt,entry_source:'patient_text_entry'}]},careNotes:[]},doctorId:reading.id,locale});
 assert.ok(doctor.includes(label),'doctor raw observation preserves provenance');
 assert.ok(doctor.includes('199'),'doctor retains typed value for safety');
 const recent=render(RecentReadings,{measurements:[typed],locale,now});
 assert.ok(recent.includes(label),'member history retains provenance');
 const summary=render(PressureDetailSummary,{measurements:[typed],locale,now});
 assert.ok(!summary.includes('199/109'),'typed values do not become latest or averaged BP');
 const trend=render(HealthTrends,{measurements:[typed],results:[],locale,now:now.toISOString(),mode:'pressure'});
 assert.ok(!trend.includes('199'),'typed values do not appear in chart data table');
 if(locale==='en'){
  assert.ok(history.includes('0 verified readings · 1 member-reported, not verified'));
  assert.ok(doctor.includes('0 verified readings · 1 member-reported, not verified'));
  const mixedSummary=render(PressureDetailSummary,{measurements:[typed,verified],locale,now});
  assert.ok(mixedSummary.includes('122/76'),'verified observation remains available');
  assert.ok(!mixedSummary.includes('199/109'),'mixed average excludes typed observation');
  const mixedTrend=render(HealthTrends,{measurements:[typed,verified],results:[],locale,now:now.toISOString(),mode:'pressure'});
  assert.ok(mixedTrend.includes('122'),'verified reading remains in chart table');
  assert.ok(!mixedTrend.includes('199'),'typed observation excluded from mixed chart');
  assert.ok(summary.includes('0 verified readings · 1 member-reported, not verified'));
  assert.ok(trend.includes('0 verified readings · 1 member-reported, not verified'));
 }
 assert.equal(render(MeasurementTrend,{measurements:[typed,verified],locale}),'','one verified value has no trend');
}
console.log('Unverified BP chart checks passed.');
