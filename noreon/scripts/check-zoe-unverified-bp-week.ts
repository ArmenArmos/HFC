import * as bpUnit from '@/lib/bp-unit';
import assert from 'node:assert/strict';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as model from '@/lib/bp-week/model';
import * as provenance from '@/lib/patient/bp-provenance';
import * as common from '@/components/patient-care/common';
import * as staffCopy from '@/lib/staff/staff-locale-copy';
import {WeekView} from '@/components/bp-week/week-view';
import {BpWeekHomeCard} from '@/components/bp-week/home-card';
const now=new Date('2026-11-05T12:00:00Z');
const typed={id:'a1000000-0000-4000-8000-000000000001',day:1,slot:'morning' as const,systolic:199,diastolic:109,pulse:77,measuredAt:'2026-11-05T10:00:00Z',entrySource:'patient_text_entry'};
const week:model.BpWeek={id:typed.id,startsOn:'2026-11-05',days:7,readingsPerSlot:2,morningTime:'08:00',eveningTime:'20:00',reminders:true,startedByRole:'member',createdAt:'2026-11-05T04:00:00Z',stoppedAt:null,stopReason:null,device:null,readings:[typed]};
assert.equal(model.weekSummary(week,now).plainAverage,null,'typed-only week never has a verified mean');
assert.equal(model.weekSummary(week,now).saved,0,'typed-only week has zero verified readings');
assert.equal(model.weekSlots(week,now)[0].readings.length,1,'raw slot capacity retains typed reading');
assert.equal(model.weekSlots(week,now)[0].state,'partial','typed reporting preserves scheduling semantics');
const mixed={...week,readings:[typed,{...typed,id:'a1000000-0000-4000-8000-000000000002',systolic:122,diastolic:76,entrySource:'photo_confirmed'}]};
assert.deepEqual(model.weekSummary(mixed,now).plainAverage,{systolic:122,diastolic:76,count:1});
assert.equal(model.weekSlots(mixed,now)[0].state,'done','raw reporting slot stays full');
const deps:Record<string,unknown>={'@/lib/bp-unit':bpUnit,'react/jsx-runtime':jsx,'@/components/patient-care/common':common,'@/lib/staff/staff-locale-copy':staffCopy,'@/lib/bp-week/model':model,'@/lib/patient/bp-provenance':provenance,'./bp-week-controls':{StaffStartWeek:()=>null,StaffStopWeek:()=>null}};
const out:Record<string,unknown>={};
new vm.Script(ts.transpileModule(readFileSync('components/staff/bp-week-panel.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports:out,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
for(const locale of ['en','hy','ru'] as const){
 const read={enabled:true as const,version:'bp-week-v1' as const,today:'2026-11-05',currentDevice:null,weeks:[week]};
 for(const [Component,props] of [[WeekView,{week,l:locale,now,showDevice:false}],[BpWeekHomeCard,{read,locale,now}],[out.BpWeekPanel,{read,memberId:typed.id,locale,now}]] as const){
  const html=renderToStaticMarkup(React.createElement(Component as React.ElementType,props));
  assert.ok(html.includes(provenance.unverifiedBpLabel(locale))||html.includes(provenance.unverifiedBpLabel(locale).toLocaleLowerCase(locale)),'weekly surfaces disclose member report');
  if(locale==='en')assert.ok(html.includes('0 verified readings · 1 member-reported, not verified'),'weekly count separates reported readings');
  if(Component!==BpWeekHomeCard)assert.ok(html.includes('199/109'),'weekly raw evidence remains visible');
 }
}
console.log('Unverified BP week model and rendered surface checks passed.');
