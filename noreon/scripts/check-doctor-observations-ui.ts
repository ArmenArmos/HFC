import * as bpUnit from '@/lib/bp-unit';
/** Real React controls with only the server action boundary replaced. No database/browser claim. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {nativeCareCommandSchema} from '@/lib/staff/care-command-schema';
import {isFutureMeasurement} from '@/lib/patient/measured-at';
import * as bpProvenance from '@/lib/patient/bp-provenance';
import {st} from '@/lib/staff/staff-locale-copy';
import type {ClinicalSnapshot} from '@/lib/patient-care/clinical-case-repository';
const require=createRequire(import.meta.url),exports:Record<string,unknown>={};
const member='11111111-1111-4111-8111-111111111111',doctor='22222222-2222-4222-8222-222222222222';
const calls:unknown[][]=[];let outcome:'ok'|'failure'|'unknown'='ok',refreshes=0;
const code=ts.transpileModule(readFileSync('components/staff/doctor-workspace/observations-card.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new vm.Script(code).runInNewContext({exports,crypto,Date,require(name:string){
 if(name==='@/lib/staff-zoe/everyday-actions')return {doctorWorkspaceCareCommand:async(...args:unknown[])=>{calls.push(args);if(outcome==='unknown')throw Error('Transport');return {ok:outcome==='ok',revision:5};}};
 if(name==='@/lib/staff/care-command-schema')return {nativeCareCommandSchema};
 if(name==='@/lib/patient/measured-at')return {isFutureMeasurement};
 if(name==='@/lib/bp-unit')return bpUnit;
 if(name==='@/lib/patient/bp-provenance')return bpProvenance;
 if(name==='@/lib/staff/staff-locale-copy')return {st};
 if(name==='@/components/patient-care/common')return {stamp:(v:string)=>v};
 if(name==='@/components/staff/bp-high-warning')return {BpHighWarning:()=>null};
 return require(name);
}});
const Card=exports.DoctorObservationsCard as typeof import('@/components/staff/doctor-workspace/observations-card').DoctorObservationsCard;
const snapshot={id:member,revision:4,evidenceToken:'snapshot',careNotes:[],evidence:{measurements:[]}} as unknown as ClinicalSnapshot;
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let tree:TestRenderer.ReactTestRenderer;
const render=(s=snapshot,locale:'en'|'hy'|'ru'='en')=>React.createElement(Card,{snapshot:s,doctorId:doctor,locale,onRefresh:()=>{refreshes++;}});
const button=(label:string)=>tree!.root.findAllByType('button').find(b=>b.children.join('')===label)!;
const input=(name:string)=>tree!.root.findAllByType('input').find(i=>i.props.name===name)!;
const change=async(name:string,value:string)=>act(async()=>input(name).props.onChange({target:{value}}));
const preview=async()=>{await change('measuredAt','2026-10-30T14:12');await change('systolic','146');await change('diastolic','92');await change('pulse','76');await act(async()=>tree!.root.findAllByType('form')[0].props.onSubmit({preventDefault(){}}));};
await act(async()=>{tree=TestRenderer.create(render());});
assert.equal(calls.length,0);
await change('measuredAt','2026-10-30T14:12');await change('systolic','148');await change('diastolic','92');await change('pulse','76');
assert.equal(calls.length,0,'Entering values does not save');
await act(async()=>{const submit=tree!.root.findAllByType('form')[0].props.onSubmit;submit({preventDefault(){}});submit({preventDefault(){}});});
assert.equal(calls.length,1,'Explicit Save double press writes once');
const [payload,actor]=calls[0] as [{id:string;revision:number;submissionId:string;measuredAt:string;systolic:number;diastolic:number;pulse:number},string];
assert.equal(actor,doctor);assert.equal(payload.id,member);assert.equal(payload.revision,4);assert.equal(payload.systolic,148);assert.equal(payload.diastolic,92);assert.equal(payload.pulse,76);assert.equal(payload.measuredAt,'2026-10-30T10:12:00.000Z');assert.match(payload.submissionId,/^[0-9a-f-]{36}$/);assert.equal(refreshes,1);
await act(async()=>tree!.unmount());
for(const mode of ['failure','unknown']as const){outcome=mode;await act(async()=>{tree=TestRenderer.create(render());});await preview();const count:number=calls.length;await act(async()=>tree!.root.findAllByType('form')[0].props.onSubmit({preventDefault(){}}));assert.equal(calls.length,count,'Failed and ambiguous saves stay frozen');assert.ok(tree!.root.findAllByProps({role:'alert'}).length);assert.equal(refreshes,1,'An uncertain result does not reload into a new request');await act(async()=>tree!.unmount());}
outcome='ok';await act(async()=>{tree=TestRenderer.create(render());});
await act(async()=>tree!.root.findByType('textarea').props.onChange({target:{value:'Member reports that the clinic called. No result reviewed.'}}));
await act(async()=>tree!.root.findByType('select').props.onChange({target:{value:'reached'}}));
await act(async()=>tree!.root.findAllByType('form')[1].props.onSubmit({preventDefault(){}}));
assert.ok(JSON.stringify(tree!.toJSON()).includes('Member reports that the clinic called. No result reviewed.'));
const count:number=calls.length;assert.equal(count,3);
await act(async()=>button('Approve and save this observation').props.onClick());
assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1)![0])),{op:'note',id:member,revision:4,kind:'reached',note:'Member reports that the clinic called. No result reviewed.'});
await act(async()=>tree!.unmount());
for(const bad of [{sys:'146',dia:'92',at:''},{sys:'100',dia:'120',at:'2026-10-30T14:12'},{sys:'301',dia:'92',at:'2026-10-30T14:12'},{sys:'146',dia:'92',at:'2099-10-30T14:12'}]){
 await act(async()=>{tree=TestRenderer.create(render());});await change('measuredAt',bad.at);await change('systolic',bad.sys);await change('diastolic',bad.dia);
 await act(async()=>tree!.root.findAllByType('form')[0].props.onSubmit({preventDefault(){}}));assert.ok(!button('Approve and save this observation'));assert.ok(tree!.root.findAllByProps({role:'alert'}).length);await act(async()=>tree!.unmount());
}
for(const locale of ['en','hy','ru']as const){await act(async()=>{tree=TestRenderer.create(render(snapshot,locale));});assert.ok(tree!.root.findAllByType('form').length===2);assert.equal(tree!.root.findByType('section').props.lang,locale);await act(async()=>tree!.unmount());}
console.log('Doctor observations controls pass: explicit Save approval, empty date error, actor/member/revision payload, Armenian time, double press, revision guard, uncertain freeze, factual contact note, three locales (controlled server action).');

await act(async()=>{tree=TestRenderer.create(render());});
await act(async()=>tree!.root.findAllByType('form')[0].props.onInvalid());
assert.ok(JSON.stringify(tree!.toJSON()).includes('Enter the measured date and time'));
await act(async()=>tree!.unmount());
