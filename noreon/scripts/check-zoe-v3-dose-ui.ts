/** Production React cards with isolated action IO. This is not browser or database evidence. */
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
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const native=createRequire(import.meta.url),cache=new Map<string,Record<string,unknown>>();
const writes:Array<{kind:string;input:Record<string,unknown>}>=[];
let settle:((r:unknown)=>void)|undefined;
const action=(kind:string)=>(input:Record<string,unknown>)=>{writes.push({kind,input});return new Promise(r=>{settle=r;});};
function load(file:string):Record<string,unknown>{
 file=resolve(file);if(cache.has(file))return cache.get(file)!;
 const exports:Record<string,unknown>={};cache.set(file,exports);
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,process:{env:{}},window:{dispatchEvent(){}},Event,crypto:globalThis.crypto,Date,Intl,setTimeout,clearTimeout,console,require(name:string):unknown{
  if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;
  if(name==='@/lib/zoe-chat-actions/dose-actions')return {logV3DoseFromCard:action('dose'),answerV3DoseReason:action('reason'),answerSamsFromCard:action('sams')};
  if(name==='@/lib/zoe-chat-actions/actions')return {};
  if(name==='@/components/patient/sign-in-ended')return {SignInEnded:()=>React.createElement('p',null,'Sign in again')};
  if(name==='@/components/patient/zoe-emergency-card')return {ZoeEmergencyCard:()=>React.createElement('aside',{'data-safety-103':true},'103')};
  if(name.startsWith('@/')||name.startsWith('.')){
   const path=name.startsWith('@/')?resolve(name.slice(2)):resolve(dirname(file),name);
   for(const ext of ['','.tsx','.ts'])if(existsSync(path+ext))return load(path+ext);
  }
  return native(name);
 }});return exports;
}
const {DoseCard}=load('components/chat-v2/dose-card.tsx') as typeof import('../components/chat-v2/dose-card');
const {DoseReasonCard,SamsCard,SamsTurn}=load('components/chat-v2/dose-flow-cards.tsx') as typeof import('../components/chat-v2/dose-flow-cards');
const {NO_TITRATION}=load('lib/zoe-chat-actions/dose-copy.ts') as typeof import('../lib/zoe-chat-actions/dose-copy');
const at='2026-11-02T16:00:00Z';
const base={id:crypto.randomUUID(),requestId:crypto.randomUUID(),source:'chip',sourceSeq:null,state:'open',outcome:{},at};
const dose=cardSchema.parse({...base,kind:'dose',snapshot:{v:1,v3:true,enabled:true,date:'2026-11-02',slots:[{medicineId:crypto.randomUUID(),planId:crypto.randomUUID(),name:'Rosuvastatin',dose:'20 mg',dueAt:at,time:'20:00',status:'due',revision:0}]}}) as Extract<ValidCard,{kind:'dose'}>;
const ask=cardSchema.parse({...base,kind:'ask',snapshot:{v:1,v3:true,askId:crypto.randomUUID(),name:'Rosuvastatin',dueAt:at,trigger:'skipped'}}) as Extract<ValidCard,{kind:'ask'}>;
const sams=cardSchema.parse({...base,kind:'sams',snapshot:{v:1,episodeId:crypto.randomUUID()},outcome:{'a:musclepain':{answer:true},'a:weakness':{answer:false}}}) as Extract<ValidCard,{kind:'sams'}>;
const words=(tree:ReactTestRenderer)=>JSON.stringify(tree.toJSON());
for(const locale of ['en','hy','ru']as const){
 let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(React.createElement(DoseCard,{card:dose,locale,onCard(){},onAct(){}}));});
 for(const value of ['Rosuvastatin','20 mg','20:00'])assert.ok(words(tree).includes(value));
 assert.equal(tree.root.findAllByType('input').length,0,'The prescribed fields cannot be edited');
 await act(async()=>tree.root.findByProps({'data-dose-answer':'taken'}).props.onClick());
 assert.equal(tree.root.findByProps({'data-dose-answer':'skipped'}).props.disabled,true);
 await act(async()=>settle!({status:'unavailable'}));
 assert.equal(tree.root.findAllByProps({role:'alert'}).length,1);
 const op=writes.at(-1)!.input.opId;
 await act(async()=>tree.root.findByProps({'data-dose-answer':'taken'}).props.onClick());
 assert.equal(writes.at(-1)!.input.opId,op,'A lost reply retries the same operation');
 await act(async()=>settle!({status:'ok',card:dose}));
 await act(async()=>tree.unmount());
 await act(async()=>{tree=create(React.createElement(DoseReasonCard,{card:ask,locale,onCard(){},onAct(){}}));});
 assert.equal(tree.root.findAll(n=>n.props['data-dose-reason']).length,4);
 await act(async()=>tree.root.findByProps({'data-dose-reason':'forgot'}).props.onClick());
 const choices=tree.root.findAllByType('button');assert.equal(choices.length,2,'Forgot offers a reminder change and a keep option');
 await act(async()=>choices[1].props.onClick());
 assert.equal(writes.at(-1)!.input.reason,'forgot');assert.equal(writes.at(-1)!.input.later,true);
 assert.equal(tree.root.findAllByType('button').every(b=>b.props.disabled),true);
 await act(async()=>settle!({status:'ok',card:ask}));await act(async()=>tree.unmount());
 await act(async()=>{tree=create(React.createElement(SamsCard,{card:sams,locale,onCard(){},onAct(){}}));});
 await act(async()=>tree.root.findByProps({'data-sams-answer':'yes'}).props.onClick());
 assert.equal(tree.root.findAllByProps({'data-safety-103':true}).length,1,'The existing emergency component opens before action IO finishes');
 assert.equal(writes.at(-1)!.input.question,'darkUrine');
 await act(async()=>settle!({status:'unavailable'}));
 assert.equal(tree.root.findAllByProps({'data-safety-103':true}).length,1,'A network failure cannot remove urgent guidance');
 assert.equal(tree.root.findAllByProps({role:'alert'}).length,1);
 await act(async()=>tree.unmount());
 const lastQuestion=cardSchema.parse({...sams,outcome:{'a:musclepain':{answer:false},'a:weakness':{answer:false},'a:darkurine':{answer:false},'a:fever':{answer:false},'a:jaundice':{answer:false}}}) as Extract<ValidCard,{kind:'sams'}>;
 await act(async()=>{tree=create(React.createElement(SamsCard,{card:lastQuestion,locale,onCard(){},onAct(){}}));});
 await act(async()=>tree.root.findByProps({'data-sams-answer':'no'}).props.onClick());
 const heldOp=writes.at(-1)!.input.opId;
 await act(async()=>settle!({status:'unavailable',card:lastQuestion}));
 assert.equal(tree.root.findAllByProps({role:'alert'}).length,1,'A failed fallback queue leaves an error and retryable final question');
 assert.equal(words(tree).includes({en:'already sent',hy:'արդեն փոխանցել',ru:'уже переданы'}[locale]),false);
 await act(async()=>tree.root.findByProps({'data-sams-answer':'no'}).props.onClick());
 assert.equal(writes.at(-1)!.input.opId,heldOp,'The fallback retries the same final operation');
 await act(async()=>settle!({status:'unavailable',card:lastQuestion}));
 await act(async()=>tree.unmount());
 // Mandatory medication boundaries retain their text; notification words match the stored tasks.
 for(const recipient of ['physician','nurse','both','none']as const){
  const taskIds=recipient==='none'?[]:recipient==='both'?[crypto.randomUUID(),crypto.randomUUID()]:[crypto.randomUUID()];
  const flow={zone:'orange',provisional:false,ruleVersion:'fixture',next:null,sentTo:recipient==='none'?null:recipient==='nurse'?'nurse':'physician',nurseTask:recipient==='both'||recipient==='nurse',taskIds,slaHours:4,outOfHours:false,mandatoryTemplateId:'NO_TITRATION'};
  const receipt=cardSchema.parse({...sams,state:'done',outcome:{...sams.outcome,'a:rightupperpain':{answer:false,flow}}});
  await act(async()=>{tree=create(React.createElement(SamsTurn,{card:receipt,locale,time:'20:00',stored:false}));});
  const rendered=tree.root.findAllByType('p').map(p=>p.children.filter(c=>typeof c==='string').join('')).join('\n');
  const mandatory=NO_TITRATION[locale];
  assert.ok(rendered.includes(mandatory.split('։')[0].split('. ')[0]),'SAMS displays the medication-change boundary');
  assert.equal(rendered.includes(mandatory),recipient==='both','The verbatim both-recipient template needs both successful tasks');
  const claim={en:'already sent',hy:'արդեն փոխանցել',ru:'уже переданы'}[locale];
  assert.equal(rendered.includes(claim),recipient!=='none','No task means no notification claim');
  if(recipient==='physician')assert.equal(rendered.includes({en:'your nurse',hy:'բուժքրոջը',ru:'медсестре'}[locale]),false,'The doctor-only variant never claims a nurse notification');
  if(recipient==='nurse')assert.equal(rendered.includes({en:'and doctor',hy:'և բժշկին',ru:'и врачу'}[locale]),false);
  await act(async()=>tree.unmount());
 }
 for(const stored of [false,true]){
  const redReceipt=cardSchema.parse({...sams,state:'done',outcome:{...sams.outcome,'a:darkurine':{answer:true,zone:'red',requestId:crypto.randomUUID(),text:'Synthetic emergency',alerted:false,mandatoryTemplateId:'NO_TITRATION'}}});
  await act(async()=>{tree=create(React.createElement(SamsTurn,{card:redReceipt,locale,time:'20:00',stored}));});
  assert.ok(words(tree).includes(NO_TITRATION[locale].split('։')[0].split('. ')[0]),'A red receipt also retains the medication boundary after message delivery');
  assert.equal(words(tree).includes({en:'already sent',hy:'արդեն փոխանցել',ru:'уже переданы'}[locale]),false,'An alert is not proof that two queue tasks exist');
  await act(async()=>tree.unmount());
 }
}
console.log('V3 dose UI: three locales, exact approved fields, four reasons, reminder offer, loading/retry and immediate shared 103 component passed');
