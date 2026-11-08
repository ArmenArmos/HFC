import {memberInstruction} from '@/lib/text-language';
/** Real React components and dialog ordering; action IO is a stand-in. No browser or database evidence. */
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {cardSchema,type ValidCard} from '@/lib/zoe-chat-actions/registry';
import {cardTurns,dialogThread} from '@/lib/zoe-chat-actions/thread';
import {realtimeStubs} from './realtime-test-stubs';
const realtimeBoundaries=await realtimeStubs();

(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const native=createRequire(import.meta.url),cache=new Map<string,Record<string,unknown>>();
const writes:unknown[]=[];
let complete:((r:unknown)=>void)|undefined;
function load(file:string):Record<string,unknown>{
 file=resolve(file);if(cache.has(file))return cache.get(file)!;
 const exports:Record<string,unknown>={};cache.set(file,exports);
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,process:{env:{}},window:{dispatchEvent(){}},Event,crypto:globalThis.crypto,Date,Intl,setTimeout,clearTimeout,console,require(name:string):unknown{if(name in realtimeBoundaries)return realtimeBoundaries[name];
  if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;
  if(name==='next/link')return {default:({children,...props}:{children:React.ReactNode})=>React.createElement('a',props,children)};
  if(name==='@/lib/zoe-chat-actions/actions')return {};
  if(name==='@/lib/zoe-chat-actions/plan-actions')return {confirmPlanFromCard:(input:unknown)=>{writes.push(input);return new Promise(r=>{complete=r;});}};
  if(name==='@/components/patient/sign-in-ended')return {SignInEnded:()=>React.createElement('p',null,'Sign in again')};
  if(name.startsWith('@/')||name.startsWith('.')){
   const path=name.startsWith('@/')?resolve(name.slice(2)):resolve(dirname(file),name);
   for(const ext of ['','.tsx','.ts'])if(existsSync(path+ext))return load(path+ext);
  }
  return native(name);
 }});return exports;
}
const {PlanCard}=load('components/chat-v2/plan-card.tsx') as typeof import('../components/chat-v2/plan-card');
const at='2026-11-02T10:00:00Z',confirmedAt='2026-11-02T11:00:00Z';
const planId=crypto.randomUUID();
const card=cardSchema.parse({id:crypto.randomUUID(),requestId:crypto.randomUUID(),kind:'plan',source:'chip',sourceSeq:null,state:'open',outcome:{},claims:{},at,
 snapshot:{v:1,available:true,plan:{id:planId,version:1,clinician:'Dr. Mariam',publishedAt:at,instructions:'Walk as agreed.',medicines:[{name:'Rosuvastatin',dose:'20 mg',times:['20:00']}]},
 v3:{planId,version:1,teachBackConfirmedAt:null,clinician:'Dr. Mariam',publishedAt:at,bp:null,ldl:{target:1.8,current:2.2,reductionPercent:null,status:'above_goal'},lifestyle:'Walk as agreed.',followUp:'Repeat your test.',calendar:[{id:'lab',title:'Lipid profile',dueAt:'2026-12-14T08:00:00Z'}]}}}) as Extract<ValidCard,{kind:'plan'}>;
const text=(tree:ReactTestRenderer)=>JSON.stringify(tree.toJSON());
const mount=async(c=card,locale:'en'|'hy'|'ru'='en')=>{
 let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(React.createElement(PlanCard,{card:c,locale,onCard(){},onAct(){},onRefresh(){}}));});return tree;
};
for(const locale of ['en','hy','ru']as const){
 const tree=await mount(card,locale);
 const tabs=()=>tree.root.findAllByProps({role:'tab'});
 assert.equal(tabs().length,4);
 for(const exact of ['Rosuvastatin','20 mg','20:00','Dr. Mariam'])assert.ok(text(tree).includes(exact));
 assert.equal(tree.root.findAllByType('input').length,0,'No editable medicine field');
 await act(async()=>tabs()[1].props.onClick());
 assert.equal(tree.root.findAllByType('meter')[0].props.value,2.2);
 assert.ok(text(tree).includes('1.8'));
 await act(async()=>tabs()[2].props.onClick());assert.ok(text(tree).includes(memberInstruction('Walk as agreed.',locale)));if(locale!=='en')assert.ok(!text(tree).includes('Walk as agreed.'));
 await act(async()=>tabs()[3].props.onClick());assert.ok(text(tree).includes('Lipid profile'));assert.ok(text(tree).includes(memberInstruction('Repeat your test.',locale)));if(locale!=='en')assert.ok(!text(tree).includes('Repeat your test.'));
 await act(async()=>tree.unmount());
}
const tree=await mount();
await act(async()=>tree.root.findByProps({'data-confirm-plan':true}).props.onClick());
assert.equal(tree.root.findByProps({'data-confirm-plan':true}).props.disabled,true,'Save disables the action while loading');
assert.equal(tree.root.findByProps({'data-zoe-card':'plan'}).props['data-state'],'loading');
await act(async()=>complete!({status:'stale'}));
assert.equal(tree.root.findAllByProps({role:'alert'}).length,1);
assert.equal(tree.root.findByProps({'data-confirm-plan':true}).props.disabled,false);
await act(async()=>tree.root.findByProps({'data-confirm-plan':true}).props.onClick());
assert.deepEqual(writes[0],writes[1],'Retry preserves the operation ID');
await act(async()=>complete!({status:'ok',card}));
await act(async()=>tree.unmount());
const confirmed={...card,snapshot:{...card.snapshot,v3:{...card.snapshot.v3!,teachBackConfirmedAt:confirmedAt}}};
const readOnly=await mount(confirmed);
assert.equal(readOnly.root.findAllByProps({'data-confirm-plan':true}).length,0);
await act(async()=>readOnly.unmount());
const missing=await mount({...card,snapshot:{v:1,available:true,plan:null,v3:null}});
assert.equal(missing.root.findAllByProps({'data-confirm-plan':true}).length,0);
assert.equal(missing.root.findAllByProps({role:'status'}).length,1);
await act(async()=>missing.unmount());
const done={...card,state:'done' as const,outcome:{plan:{planId,confirmedAt,doneAt:confirmedAt}}};
assert.equal(cardTurns(done)[0].at,confirmedAt);
const thread=dialogThread([{kind:'member',key:'m1',text:'My question',at:'2026-11-02T10:30:00Z',channel:'app',requestId:crypto.randomUUID()}],[done]);
assert.equal(thread.at(-1)?.type,'turn','The action follows the newer member message');
assert.equal(thread.filter(e=>e.type==='card').length,0,'The answered form leaves its old position');
console.log('Zoe V3 plan UI: three locales, four tabs, immutable medicine display, loading/retry/answered/unavailable and dialog order passed');
