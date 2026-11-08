/** Actual clinic file cards with scoped server boundaries replaced; no Auth, storage or provider calls. */
import assert from 'node:assert/strict';
// @ts-expect-error Runtime provides registerHooks; project types target Node 20.
import {registerHooks} from 'node:module';
import React from 'react';
import {act,create} from 'react-test-renderer';
import type {ClinicLabResults,ClinicLabLinkCommand} from '@/lib/clinic-portal/lab-results-schema';
import {clinicDate,clinicTimestamp,clinicBatchName} from '@/lib/clinic-portal/display-time';
const id=(n:number)=>`c1ab0000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const file={fileId:id(1),name:'Synthetic lab.pdf',uploadedAt:'2026-11-01T08:00:00Z',linked:null,everLinked:false,reading:null,suggestion:null};
const data:ClinicLabResults={version:'clinic-lab-results-v1',enabled:true,reading:true,files:[file],members:[{memberId:id(2),name:'Synthetic member',birthDate:'1980-03-14',bookingAt:'2026-11-01T09:00:00+04:00'}]};
const calls:ClinicLabLinkCommand[]=[];
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,__clinicLabReview:{read:async()=>({status:'loaded',data}),link:async(_clinic:string,command:ClinicLabLinkCommand)=>{calls.push(command);return {status:'needs-review'};}}});
const hook=registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 const source=s==='next/navigation'?'export function unstable_rethrow(){}':s==='@/lib/clinic-portal/lab-results-actions'?'export const clinicLabResults=(...a)=>globalThis.__clinicLabReview.read(...a);export const clinicLabLink=(...a)=>globalThis.__clinicLabReview.link(...a);':s==='@/components/ui/select-field'?'export function SelectField(p){return globalThis.__clinicLabReact.createElement("select",{value:p.value,onChange:e=>p.onValueChange(e.target.value)},p.options.map(o=>globalThis.__clinicLabReact.createElement("option",{key:o.value,value:o.value},o.label)))}':null;
 return source?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(s,c);
}});
Object.assign(globalThis,{__clinicLabReact:React});
const {ClinicLabResults:Cards}=await import('@/components/clinic-portal/lab-results');
type Node={children:(Node|string)[]};const text=(node:Node):string=>node.children.map(c=>typeof c==='string'?c:text(c)).join('');
let tree!:ReturnType<typeof create>;
const originalTimeout=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
const timers:(()=>void)[]=[];
try{
 Object.assign(globalThis,{setTimeout:(callback:()=>void)=>{timers.push(callback);return 1;},clearTimeout:()=>{}});
 for(const locale of ['en','hy','ru'] as const){
  await act(async()=>{tree=create(React.createElement(Cards,{clinicId:id(9),batchId:id(8),actorScope:'synthetic-scope',locale,refreshKey:0,initial:data}));});
  const getText=()=>text(tree.root as unknown as Node);
  const button=(label:string)=>tree.root.findAllByType('button').find(b=>text(b as unknown as Node)===label)!;
  const choose={en:'Choose member',hy:'Ընտրել անդամ',ru:'Выбрать участника'}[locale];
  assert.ok(getText().includes({en:'while this file is being read',hy:'կարդալու ընթացքում',ru:'пока файл читается'}[locale]),'Reading has an immediate manual fallback');
  await act(async()=>{for(const timer of timers.splice(0))timer();});
  assert.ok(getText().includes({en:'longer than expected',hy:'սպասվածից երկար',ru:'больше времени'}[locale]),'Long reading explains the next step');
  await act(async()=>button(choose).props.onClick());
  assert.ok(getText().includes({en:'visit time has arrived',hy:'այցի ժամը հասել է',ru:'время визита которых уже наступило'}[locale]),'The eligibility restriction is explained without broadening the server list');
  await act(async()=>tree.root.findByType('select').props.onChange({target:{value:id(2)}}));
  await act(async()=>button({en:'Link to this member',hy:'Կապել այս անդամին',ru:'Привязать к этому участнику'}[locale]).props.onClick());
  assert.equal(calls.at(-1)?.memberId,id(2));
  assert.ok(getText().includes({en:'ask Noreon to review it',hy:'խնդրեք Noreon-ին ստուգել այն',ru:'попросите Noreon проверить'}[locale]),'Review-needed result names the next step');
  assert.ok(!tree.root.findAll(n=>n.props.className?.includes?.('animate-spin')).length,'A review-required refusal does not keep a reading spinner');
  await act(async()=>tree.unmount());
 }
 assert.equal(clinicDate('1968-03-14','en'),'14 Mar 1968');
 assert.equal(clinicTimestamp('2026-11-01T08:00:00Z','en'),'1 Nov 2026 · 12:00');
 assert.equal(clinicBatchName('Results upload','hy'),'Արդյունքների վերբեռնում');
 assert.equal(clinicBatchName('Custom clinic name','hy'),'Custom clinic name','Staff-entered content is preserved');
 console.log('Clinic lab review UI PASS: three locales, manual and delayed-reading fallback, unchanged eligibility list, needs-review next step without spinner, deterministic dates/default batch name. Server actions mocked.');
}finally{await act(async()=>tree?.unmount());hook.deregister();Object.assign(globalThis,{setTimeout:originalTimeout,clearTimeout:originalClear});Reflect.deleteProperty(globalThis,'__clinicLabReview');Reflect.deleteProperty(globalThis,'__clinicLabReact');}
