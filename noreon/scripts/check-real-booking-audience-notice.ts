import * as textLanguage from '@/lib/text-language';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import * as careCommon from '@/components/patient-care/common';
import * as displayTime from '@/lib/real-booking/display-time';
import * as catalogueLabel from '@/lib/patient/catalogue-label';
import {act,create,type ReactTestRenderer,type ReactTestInstance} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import type {BookingFormState,BookingRequest,MemberBookingData} from '@/lib/real-booking/schema';
import {selectFieldNativeStub} from './select-field-native-stub';
import * as realLocaleModule from '@/lib/locale';
import * as ldlRetest from '@/lib/ldl/retest';
import * as recoveryContext from '@/components/real-booking/recovery-context';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
// Actual common/staff/member components; only server actions, router and the button primitive are mocked.
let refreshes=0;
function load(path:string,deps:Record<string,unknown>){
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,crypto:globalThis.crypto,require:(name:string)=>{if(name==='@/lib/text-language')return textLanguage;
  if(name in deps)return deps[name];
  if(name==='@/components/pilot-commerce/member-pricing')return {TestPrices:()=>null,MemberPaymentStatus:()=>null,paymentFor:()=>undefined};
  if(name==='@/lib/ldl/retest')return ldlRetest;
  if(name==='./recovery-context')return recoveryContext;
  if(name==='@/components/ui/select-field')return selectFieldNativeStub;if(name==='@/lib/locale')return realLocaleModule;throw Error(`Unexpected UI boundary ${name}`);
 }});return exports;
}
const base={react:React,'react/jsx-runtime':jsx,'lucide-react':icons};
const common=load('components/real-booking/common.tsx',{...base,'next/navigation':{useRouter:()=>({refresh(){refreshes++;}})},'@/components/ui/button':{Button:'button'},'@/lib/patient/catalogue-label':catalogueLabel,'@/lib/real-booking/display-time':displayTime});
const actions={'@/lib/real-booking/actions':{memberBookingCommand:async()=>({ok:false,message:'unused'}),staffBookingCommand:async()=>({ok:false,message:'unused'})}};
type Action=(state:BookingFormState,form:FormData)=>Promise<BookingFormState>;
const Staff=load('components/real-booking/staff.tsx',{...base,...actions,'./common':common}).RealStaffBooking as React.ComponentType<{requests:BookingRequest[];action?:Action}>;
const Member=load('components/real-booking/member.tsx',{...base,...actions,'./common':common,'@/components/patient-care/common':careCommon}).RealMemberBooking as React.ComponentType<{data:MemberBookingData;locale:'en'|'hy';action?:Action}>;

const terms={startsAt:'2099-10-15T05:00:00Z',endsAt:'2099-10-15T07:00:00Z',timezone:'Asia/Yerevan' as const,mode:'clinic' as const,location:'Synthetic clinic'};
const arrangement={provider:'Synthetic provider',terms,obtainedAt:'2026-10-13T01:00:00Z',channel:'phone' as const,source:'Synthetic source',preparation:'Synthetic preparation',replacesExisting:false,recordedBy:'synthetic',recordedAt:'2026-10-13T01:00:00Z'};
const requested:BookingRequest={id:'00112233-4455-4677-8899-aabbccddeeff',revision:0,status:'requested',requestedTerms:terms,requirements:[{id:'one',title:'Synthetic test',method:'lab'}],algorithmVersion:'synthetic',contextToken:'context',contextStale:false,proposal:null,currentArrangement:null,pendingChange:null,createdAt:'2026-10-13T01:00:00Z'};
const proposed:BookingRequest={...requested,status:'provider-proposed',proposal:arrangement};
const memberData=(requests:BookingRequest[]):MemberBookingData=>({available:true,requirements:[],homeTasks:[],requests});

// Staff see staff wording; member wording is unchanged in both locales.
for(const request of [requested,proposed]){
 const staff=renderToStaticMarkup(React.createElement(Staff,{requests:[request]}));
 assert.ok(!/Your acceptance needed|Your preferred date and time/.test(staff),'Staff booking card never speaks in the member voice');
 if(request===proposed)assert.ok(staff.includes('Member acceptance needed'),'Staff status names the member as the one who must accept');
 else assert.ok(staff.includes('Member’s preferred date and time'),'Staff see the member’s preference labelled as the member’s');
}
const memberText={en:{status:'Your acceptance needed',preferred:'Your preferred date and time'},hy:{status:'Անհրաժեշտ է Ձեր համաձայնությունը',preferred:'Ձեր նախընտրելի ամսաթիվն ու ժամը'}};
for(const locale of ['en','hy'] as const){
 assert.ok(renderToStaticMarkup(React.createElement(Member,{data:memberData([proposed]),locale})).includes(memberText[locale].status),'Member status wording unchanged');
 const html=renderToStaticMarkup(React.createElement(Member,{data:memberData([requested]),locale}));
 assert.ok(html.includes(memberText[locale].preferred),'Member preference wording unchanged');
 assert.ok(!html.includes('Member acceptance needed')&&!html.includes('Member’s preferred'),'Member never sees staff wording');
}
console.log('Booking audience wording passed: staff card uses member-as-third-party labels; member EN/HY labels unchanged.');

// Success feedback survives the refresh that remounts revision-keyed forms.
const formFor=(renderer:ReactTestRenderer,operation:string)=>renderer.root.findAllByType('form').find(form=>form.findAllByProps({name:'operation'}).some(input=>input.props.value===operation))!;
const statuses=(renderer:ReactTestRenderer)=>renderer.root.findAll(node=>node.type==='p'&&node.props.role==='status').map(node=>node.children.join(''));
async function submit(form:ReactTestInstance,data=new FormData()){await act(async()=>{React.startTransition(()=>form.props.action(data));});}
async function saveThenRefresh(element:(revision:number)=>React.ReactElement,operation:string,expected:string){
 let renderer!:ReactTestRenderer;
 await act(async()=>{renderer=create(element(0));});
 refreshes=0;
 await submit(formFor(renderer,operation));
 assert.equal(refreshes,1,'Successful save refreshes server data');
 await act(async()=>renderer.update(element(1)));
 assert.equal(formFor(renderer,operation).findByType('fieldset').props.disabled,false,'Revision change still remounts a fresh, enabled form');
 assert.equal(statuses(renderer).filter(text=>text===expected).length,1,`Success message “${expected}” stays visible once after the revision change`);
 return renderer;
}
const staffSaved='Provider terms and preparation recorded. Member acceptance is required.';
const staffRenderer=await saveThenRefresh(revision=>React.createElement(Staff,{requests:[{...requested,revision}],action:async()=>({ok:true,message:staffSaved})}),'confirm',staffSaved);
let failing=false;
await act(async()=>staffRenderer.update(React.createElement(Staff,{requests:[{...requested,revision:1}],action:async():Promise<BookingFormState>=>failing?{ok:false,code:'conflict',message:'Request changed. Reload.'}:{ok:true,message:staffSaved}})));
failing=true;
await submit(formFor(staffRenderer,'confirm'));
assert.ok(!statuses(staffRenderer).includes(staffSaved),'A later failed save clears the earlier success message');
await act(async()=>staffRenderer.unmount());
// QA F-05: a member's accept says what happened, in both locales.
for(const [locale,expected] of [['en','Done. You accepted the visit details.'],['hy','Պատրաստ է։ Դուք ընդունեցիք այցի մանրամասները։']] as const){
 const renderer=await saveThenRefresh(revision=>React.createElement(Member,{data:memberData([{...proposed,revision}]),locale,action:async()=>({ok:true,message:'Your request was saved.'})}),'accept',expected);
 await act(async()=>renderer.unmount());
}
const confirmed:BookingRequest={...requested,status:'confirmed',currentArrangement:arrangement};
const changeSaved='Your change request is sent. You can see its status above.';
const memberRenderer=await saveThenRefresh(revision=>React.createElement(Member,{data:memberData([{...confirmed,revision}]),locale:'en',action:async()=>({ok:true,message:changeSaved})}),'request-change',changeSaved);
const pastChange=new FormData();pastChange.set('operation','request-change');pastChange.set('startsAt','2001-01-01T09:00');pastChange.set('mode','clinic');pastChange.set('location','Synthetic clinic');
await submit(formFor(memberRenderer,'request-change'),pastChange);
assert.ok(!statuses(memberRenderer).includes(changeSaved),'A later client-side validation failure clears the earlier success message');
await act(async()=>memberRenderer.unmount());
console.log('Booking success feedback passed: staff and member EN/HY saves stay announced after the revision-keyed remount; a later failure clears it. Actions and router mocked.');
