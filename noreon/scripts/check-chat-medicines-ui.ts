import * as textLanguage from '@/lib/text-language';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {cardSchema} from '@/lib/zoe-chat-actions/registry';
import {MEDICINE_ASK_COPY,ASK_REASONS} from '@/lib/member-medicines/ask-copy';
import type {MedicinesRead} from '@/lib/zoe-chat-actions/medicines-read';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
globalThis.fetch=(()=>{throw Error('Network forbidden');}) as typeof fetch;
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const medicine={id:id(5),source:'self-reported' as const,name:'Synthetic medicine',dose:'1 tablet',times:['08:00'],startedOn:'2026-11-01',createdAt:'2026-11-01T10:00:00Z',stoppedAt:null,effectiveAt:null,doses:[]};
const empty:MedicinesRead={enabled:true,own:[],plan:[],asks:[],now:'2026-11-01T10:00:00Z',token:'a'.repeat(64)};
let data=empty,reads=0,writes=0,resultStatus='added',readStatus='ok';
let resolveChange:((r:unknown)=>void)|null=null;
const native=createRequire(import.meta.url),cache=new Map<string,Record<string,unknown>>();
function load(file:string):Record<string,unknown>{
 file=resolve(file);if(cache.has(file))return cache.get(file)!;
 const exports:Record<string,unknown>={};cache.set(file,exports);
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,crypto,document:{getElementById:()=>({focus(){}})},require(name:string):unknown{
  if(name==='@/lib/text-language')return textLanguage;
  if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;
  if(name==='lucide-react')return native(name);
  if(name==='next/navigation')return {useRouter:()=>({refresh:()=>{}})};
  if(name==='@/components/ui/button')return {Button:({children,...p}:React.ComponentProps<'button'>)=>React.createElement('button',p,children)};
  if(name==='@/components/ui/input')return {Input:({onValueChange,...p}:React.ComponentProps<'input'>&{onValueChange:(v:string)=>void})=>React.createElement('input',{...p,onChange:(e:React.ChangeEvent<HTMLInputElement>)=>onValueChange(e.target.value)})};
  if(name==='@/components/ui/label')return {Label:'label'};
  if(name==='@/components/patient-care/common')return {copy:(l:string,en:string,hy:string,ru:string)=>l==='en'?en:l==='hy'?hy:ru};
  if(name==='@/lib/member-medicines/ask-copy')return {MEDICINE_ASK_COPY,ASK_REASONS};
  if(name==='@/lib/member-medicines/actions')return {};
  if(name==='@/lib/zoe-chat-actions/medicines-actions')return {
   readMedicinesFromCard:async()=>{reads++;return {status:readStatus,data};},
   changeMedicinesFromCard:async()=>{writes++;return new Promise(r=>{resolveChange=r;});},
  };
  if(name==='@/lib/zoe-chat-actions/actions')return {openZoeCard:async()=>{throw Error('A successful save must show its list without another open');}};
  if(name==='./sign-in-ended'||name==='@/components/patient/sign-in-ended')return {SignInEnded:()=>React.createElement('a',{href:'/login'},'Sign in')};
  if(name.startsWith('@/components/'))return load(name.slice(2)+'.tsx');
  throw Error(`Unexpected UI boundary ${name}`);
 }});return exports;
}
const {ZoeMedicines}=load('components/patient/zoe-medicines.tsx') as typeof import('../components/patient/zoe-medicines');
const base=()=>cardSchema.parse({id:id(1),requestId:id(2),kind:'medicines',source:'chip',sourceSeq:null,state:'open',claims:{},outcome:{},snapshot:{v:1,token:empty.token},at:'2026-11-01T10:00:00Z'});
const text=(tree:ReactTestRenderer)=>JSON.stringify(tree.toJSON());
const callbacks:unknown[]=[];
const mount=async(l:'en'|'hy'|'ru',card=base())=>{assert.ok(card.valid&&card.kind==='medicines');let tree!:ReactTestRenderer;await act(async()=>{tree=create(React.createElement(ZoeMedicines,{card,locale:l,onCard:(saved:unknown)=>callbacks.push(saved)}));});return tree;};
for(const l of ['en','hy','ru'] as const){
 for(const kind of ['add','times','stop'] as const){
  data={...empty,own:kind==='add'?[]:[medicine]};reads=0;writes=0;readStatus='ok';resultStatus=kind==='add'?'added':kind==='times'?'saved':'stopped';
  const tree=await mount(l);
  const control=tree.root.findByType(load('components/member-medicines/controls.tsx')[kind==='add'?'AddMedicineForm':kind==='times'?'EditMedicineForm':'StopMedicineButton'] as React.ComponentType);
  const action=control.props.action;
  let pending!:Promise<unknown>;
  await act(async()=>{pending=action(kind==='add'?{name:medicine.name,dose:medicine.dose,times:medicine.times}:kind==='times'?{id:medicine.id,times:['09:00']}:undefined);});
  data={...empty,own:kind==='stop'?[]:[{...medicine,times:kind==='times'?['09:00']:medicine.times}]};
  const savedCard={...base(),state:'done' as const,outcome:{medicines:{kind,status:resultStatus}}};
  const callbacksBefore=callbacks.length;
  await act(async()=>{resolveChange!({status:'ok',result:{status:resultStatus},card:savedCard});await pending;});
  assert.equal(callbacks.length,callbacksBefore+1,'Confirmed save propagates its recorded card to the parent');
  assert.equal(callbacks.at(-1),savedCard,'The callback carries the actual returned outcome card');
  assert.ok(reads>=2,`${l}/${kind}: automatically rereads after save`);
  const status=tree.root.findAll(n=>n.props.role==='status').map(n=>n.children.join(' ')).join(' ');
  assert.ok(status.includes(medicine.name),`${l}/${kind}: confirmation names the medicine`);
  assert.equal(tree.root.findAllByType('form').length,0,'The completed card has no stale forms');
  assert.equal(tree.root.findAllByProps({'data-medicine-add':true}).length,0,'The old add button is gone');
  assert.doesNotMatch(text(tree),/Your choice was recorded|Show your current list to continue/);
  if(kind!=='stop'){
   assert.ok(text(tree).includes(kind==='times'?'09:00':'08:00'),'Current list shows saved times');
   assert.doesNotMatch(text(tree),/Your own list is empty|Ձեր սեփական ցանկը դատարկ է|Ваш собственный список пуст/);
  }
  const before=writes;await act(async()=>{await action({name:'Second',dose:'',times:['10:00']});});assert.equal(writes,before,'The same card refuses a second change');
  await act(async()=>tree.unmount());
 }
}
data={...empty,own:[medicine]};
const done={...base(),state:'done' as const,outcome:{medicines:{kind:'add',status:'added'}},claims:{medicines:{op:id(3),payload:{command:{kind:'add',name:medicine.name,dose:medicine.dose,times:medicine.times}}}}};
const reloaded=await mount('en',done);
assert.ok(text(reloaded).includes(medicine.name),'Reloaded closed card loads its current list');
assert.equal(reloaded.root.findAllByType('form').length,0);
await act(async()=>reloaded.unmount());
// A failed follow-up read must never fall back to the pre-change empty list.
data=empty;readStatus='ok';const unavailable=await mount('en');
let pending!:Promise<unknown>;
await act(async()=>{pending=unavailable.root.findByType(load('components/member-medicines/controls.tsx').AddMedicineForm as React.ComponentType).props.action({name:medicine.name,dose:'',times:['08:00']});});
readStatus='unavailable';await act(async()=>{resolveChange!({status:'ok',result:{status:'added'}});await pending;});
assert.doesNotMatch(text(unavailable),/Your own list is empty/);
assert.match(text(unavailable),/could not be loaded/);
await act(async()=>unavailable.unmount());
// BC-05: an expired session must leave the actual add form and its draft on screen.
for(const l of ['en','hy','ru'] as const){
 data=empty;readStatus='ok';reads=0;writes=0;
 const tree=await mount(l);
 const add=tree.root.findByType(load('components/member-medicines/controls.tsx').AddMedicineForm as React.ComponentType);
 await act(async()=>{add.findByType('button').props.onClick();});
 const input=(suffix:string)=>tree.root.findAllByType('input').find(n=>String(n.props.id).endsWith(suffix))!;
 await act(async()=>{
  input('-name').props.onChange({target:{value:medicine.name}});
  input('-dose').props.onChange({target:{value:medicine.dose}});
  tree.root.findAllByType('input').find(n=>n.props.type==='time')!.props.onChange({target:{value:'07:30'}});
 });
 await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});});
 readStatus='signed_out';
 await act(async()=>{resolveChange!({status:'signed_out'});});
 assert.equal(tree.root.findAllByType('form').length,1,`${l}: signed-out response keeps the medicine draft form`);
 assert.equal(input('-name').props.value,medicine.name);
 assert.equal(input('-dose').props.value,medicine.dose);
 assert.equal(tree.root.findAllByType('input').find(n=>n.props.type==='time')!.props.value,'07:30');
 assert.equal(tree.root.findAllByType('a').length,1,'The form offers sign-in recovery');
 assert.equal(reads,1,'No follow-up read may replace the draft with a signed-out screen');
 assert.equal(writes,1,'No automatic retry after sign-out');
 await act(async()=>tree.unmount());
}
console.log('Medicine UI: EN/HY/RU named add/time/stop confirmation, automatic current read, sealed forms, reload, failed-refresh recovery and signed-out draft retention. Actual component/forms with supplied IO.');

// Blank medicine names show a written error without sending a command.
for(const locale of ['en','hy','ru'] as const){
 let tree!:ReactTestRenderer;let additions=0;
 const Add=load('components/member-medicines/controls.tsx').AddMedicineForm as React.ComponentType<{locale:string;action:()=>Promise<{status:string}>}>;
 await act(async()=>{tree=create(React.createElement(Add,{locale,action:async()=>{additions++;return {status:'added'};}}));});
 await act(async()=>tree.root.findByType('button').props.onClick());
 assert.equal(tree.root.findByType('form').props.noValidate,true,'Native focus-only required validation is replaced with written feedback');
 const name=tree.root.findAllByType('input').find(n=>n.props.autoComplete==='off')!;assert.ok(name.props.placeholder);
 await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.equal(additions,0);assert.equal(tree.root.findAllByProps({role:'alert'}).length,1);
 await act(async()=>tree.unmount());
}
console.log('Medicine add EN/HY/RU: blank name shows an explicit error, name hint present, zero commands. Actual shared form with mocked IO.');

// Unknown replies retain sealing even if an outcome card accompanies the response.
data=empty;readStatus='ok';const unknown=await mount('en');
const unknownAction=unknown.root.findByType(load('components/member-medicines/controls.tsx').AddMedicineForm as React.ComponentType).props.action;
const callbackCount=callbacks.length;
let unknownPending!:Promise<unknown>;
await act(async()=>{unknownPending=unknownAction({name:medicine.name,dose:'',times:['08:00']}).catch(()=> 'unknown');});
await act(async()=>{resolveChange!({status:'ok',result:{status:'unknown'},card:{...base(),state:'done',outcome:{medicines:{status:'unknown'}}}});await unknownPending;});
assert.equal(callbacks.length,callbackCount,'Unknown medicine result does not trigger success refresh');
assert.equal(unknown.root.findAllByType('form').length,0,'Unknown medicine result stays sealed');
const unknownWrites=writes;await act(async()=>{await unknownAction({name:'Another',dose:'',times:['10:00']});});assert.equal(writes,unknownWrites);
await act(async()=>unknown.unmount());
console.log('Medicine callback: confirmed recorded card reaches parent, unknown reply stays sealed with no success callback or second command.');
