import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import ts from 'typescript';
import {z} from 'zod';
import * as copy from '@/lib/staff/staff-locale-copy';
import * as time from '@/lib/staff/yerevan-time';
import * as schema from '@/lib/nurse-visit/schema';
import type {NurseChatVisitsRead} from '@/lib/nurse-chat/v2-actions';
import type {NurseVisitList as VisitListComponent} from '@/components/nurse-chat-v2/visit-list';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let flag:string|undefined='true',enabled=true,role='nurse',auths=0,reads=0,authFails=false,readFails=false,readDenied=false;
let response:schema.NurseVisitList={version:'nurse-visit-v1',enabled:true,today:'2026-11-02',role:'nurse',visits:[]};
const modules:Record<string,unknown>={
 react:React,'react/jsx-runtime':jsx,zod:{z},
 'next/navigation':{unstable_rethrow:()=>{}},
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>{auths++;if(authFails)throw Error('Authentication unavailable');return {client:{},identity:{role}};}},
 '@/lib/staff/member-search-command':{},'./config':{nurseChatEnabled:()=>enabled},
 '@/lib/nurse-visit/schema':schema,
 '@/lib/nurse-visit/runtime':{readNurseVisits:async()=>{reads++;if(readDenied)throw {code:'42501'};if(readFails)throw Error('Read unavailable');return response;}},
 '@/lib/staff/staff-locale-copy':copy,'@/lib/staff/yerevan-time':time,
};
function load(file:string){const exports:Record<string,unknown>={};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,process:{env:{get NOREON_NURSE_CHAT_V2(){return flag;}}},require:(name:string)=>{assert.ok(name in modules,name);return modules[name];}});return exports;}
const readVisits=load('lib/nurse-chat/v2-actions.ts').readNurseChatVisits as ()=>Promise<NurseChatVisitsRead>;
for(flag of [undefined,'false','TRUE','true '])assert.equal((await readVisits()).status,'refused');assert.equal(auths,0);assert.equal(reads,0);
flag='true';enabled=false;assert.equal((await readVisits()).status,'refused');assert.equal(auths,0);enabled=true;
for(role of ['admin','doctor'])assert.equal((await readVisits()).status,'refused');assert.equal(reads,0);
role='nurse';authFails=true;assert.equal((await readVisits()).status,'unavailable');assert.equal(reads,0);authFails=false;
readFails=true;assert.equal((await readVisits()).status,'unavailable');readFails=false;readDenied=true;assert.equal((await readVisits()).status,'refused');readDenied=false;
response={version:'nurse-visit-v1',enabled:false,visits:[]};assert.equal((await readVisits()).status,'refused');
response={version:'nurse-visit-v1',enabled:true,today:'2026-11-02',role:'admin',visits:[]};assert.equal((await readVisits()).status,'refused');
const row=(index:number,startsAt:string,completed=false):Extract<schema.NurseVisitList,{enabled:true}>['visits'][number]=>({id:`aa110000-0000-4000-8000-${String(index).padStart(12,'0')}`,memberId:'aa110000-0000-4000-8000-000000000099',source:'appointment',memberName:`Fictional member ${index}`,arrangementToken:`synthetic-reservation-${index}`,startsAt,endsAt:null,mode:index===2?'clinic':'home',clinic:index===2?'Fictional clinic':null,location:null,bookingStatus:'confirmed',completion:completed?{completedAt:'2026-11-02T08:00:00Z',nurseName:'Fictional nurse',summary:{samplesPlanned:2,samplesTaken:1,bpTaken:false,deviceDone:null,openItems:[]}}:null,samplesPlanned:2,samplesTaken:1,openItems:3,steps:[],nurseName:'Fictional nurse'});
const data:Extract<schema.NurseVisitList,{enabled:true}>={version:'nurse-visit-v1',enabled:true,today:'2026-11-02',role:'nurse',visits:[row(1,'2026-11-01T20:15:00Z'),row(2,'2026-11-01T08:00:00Z'),row(3,'2026-11-03T08:00:00Z'),row(4,'2026-11-01T08:00:00Z',true),row(5,'2026-11-02T08:00:00Z',true)]};
response=data;const ready=await readVisits();assert.equal(ready.status,'ready');if(ready.status==='ready')assert.equal(ready.data,data,'Existing runtime list including recent completed rows is preserved');
const VisitList=load('components/nurse-chat-v2/visit-list.tsx').NurseVisitList as typeof VisitListComponent;
let tree!:ReactTestRenderer,opened:unknown;
await act(async()=>{tree=create(React.createElement(VisitList,{data,locale:'en',disabled:false,onOpen:visit=>{opened=visit;}}));});
for(const [name,indices] of [['today',[1]],['earlier',[2]],['upcoming',[3]],['completed',[5,4]]] as const){const group=tree.root.findByProps({'data-visit-group':name});assert.deepEqual(group.findAll(node=>!!node.props['data-visit-list-row']).map(node=>node.props['data-visit-list-row']),indices.map(index=>data.visits[index-1].id));}
await act(async()=>tree.root.findByProps({'data-visit-open':data.visits[0].id}).props.onClick());assert.equal(opened,data.visits[0]);
assert.equal(tree.root.findAllByType('a').length,0);await act(async()=>tree.update(React.createElement(VisitList,{data,locale:'en',disabled:true,onOpen:()=>{}})));assert.ok(tree.root.findAllByType('button').every(button=>button.props.disabled));await act(async()=>tree.unmount());
for(const [locale,expected] of [['en',['Your visits','Home visit','Fictional clinic','Read completed visit','Samples 1/2','3 items left']],['hy',['Ձեր այցերը','Տնային այց','Կարդալ ավարտված այցը']],['ru',['Ваши визиты','Визит на дом','Прочитать завершённый визит']]] as const){const markup=renderToStaticMarkup(React.createElement(VisitList,{data,locale,disabled:false,onOpen:()=>{}}));for(const text of expected)assert.ok(markup.includes(text),`${locale}: ${text}`);}
const empty=renderToStaticMarkup(React.createElement(VisitList,{data:{...data,visits:[]},locale:'en',disabled:false,onOpen:()=>{}}));assert.ok(empty.includes('No visits are arranged.'));assert.ok(!empty.includes('data-visit-open'));
console.log('Nurse visit list: exact feature and nurse gates, read failure vs refusal, recent completed rows, Yerevan date grouping, all three locales, inline opening, disabled and empty states passed with controlled IO.');
