import * as textLanguage from '@/lib/text-language';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import * as careCommon from '@/components/patient-care/common';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import type {BookingRequest,MemberBookingData} from '@/lib/real-booking/schema';
import {testTitle} from '@/lib/patient/catalogue-label';
import {testById} from '@/lib/clinical/seed/tests';
import {selectFieldNativeStub} from './select-field-native-stub';
import * as ldlRetest from '@/lib/ldl/retest';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
// Actual member/staff components; only actions and shared presentation/form IO are mocked.
// The mock retains successful form state so an unchanged React key reproduces the partial-create bug.
const renderedActions: unknown[]=[];
function BookingForm({operation,children,label,action}:{operation:string;children?:React.ReactNode;label:string;action?:unknown}) {
 renderedActions.push(action);
 const [saved,setSaved]=React.useState(false);
 return React.createElement('form',{'data-operation':operation},React.createElement('fieldset',{disabled:saved},children,React.createElement('button',{onClick:()=>setSaved(true)},label)));
}
const common={BookingForm,BookingNotices:({children}:{children:React.ReactNode})=>children,choose:(l:string,en:string,hy:string)=>l==='hy'?hy:en,testTitle,statusText:(s:string)=>s,termsText:()=> 'Synthetic window',fieldClass:'',TermsFields:()=>null,PreferredArrangement:()=>null,Arrangement:({title,arrangement}:{title:string;arrangement:{provider:string}})=>React.createElement('div',null,title,arrangement.provider)};
function load(path:string){
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,crypto:globalThis.crypto,require:(name:string)=>{if(name==='@/lib/text-language')return textLanguage;
  if(name==='lucide-react')return icons; if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;
  if(name==='next/link')return {default:({children}:{children:React.ReactNode})=>React.createElement('a',null,children)};
  if(name==='@/components/patient-care/common')return careCommon;
  if(name==='./common')return common;if(name.endsWith('/actions'))return {memberBookingCommand:async()=>({ok:true,message:'saved'}),staffBookingCommand:async()=>({ok:true,message:'saved'})};
  if(name==='@/components/pilot-commerce/member-pricing')return {TestPrices:()=>null,MemberPaymentStatus:()=>null,paymentFor:()=>undefined};
  if(name==='@/lib/ldl/retest')return ldlRetest;
  if(name==='@/components/ui/select-field')return selectFieldNativeStub;throw Error(`Unexpected UI boundary ${name}`);
 }});return exports;
}
const Member=load('components/real-booking/member.tsx').RealMemberBooking as React.ComponentType<{data:MemberBookingData;locale:'en'|'hy';demo?:boolean}>;
const Staff=load('components/real-booking/staff.tsx').RealStaffBooking as React.ComponentType<{requests:BookingRequest[]}>;
const requirements=['one','two','three'].map(id=>({id,title:`Synthetic ${id}`,method:'lab' as const}));
const terms={startsAt:'2026-10-15T05:00:00Z',endsAt:'2026-10-15T07:00:00Z',timezone:'Asia/Yerevan' as const,mode:'clinic' as const,location:'Synthetic'};
const request:BookingRequest={id:'00112233-4455-4677-8899-aabbccddeeff',revision:0,status:'requested',requestedTerms:terms,requirements:[requirements[0]],algorithmVersion:'synthetic',contextToken:'context',contextStale:false,proposal:null,currentArrangement:null,pendingChange:null,createdAt:'2026-10-13T01:00:00Z'};
const arrangement={provider:'Synthetic provider',terms,obtainedAt:'2026-10-13T01:00:00Z',channel:'phone' as const,source:'Synthetic source',preparation:'Synthetic preparation',replacesExisting:true,recordedBy:'synthetic',recordedAt:'2026-10-13T01:00:00Z'};
const catalogue=testById('lipid-panel')!;
for(const locale of ['en','hy'] as const) {
 const storedLocale=locale==='en'?'hy':'en';
 const stored={id:catalogue.id,title:catalogue.name[storedLocale]!,method:'lab' as const};
 const custom={...stored,title:'Provider-specific wording retained'};
 for(const recorded of [stored,custom]) {
  const data:MemberBookingData={available:true,requirements:[],homeTasks:[],requests:[{...request,requirements:[recorded]}]};
  const before=JSON.stringify(data);
  const html=renderToStaticMarkup(React.createElement(Member,{data,locale}));
  assert.ok(html.includes(recorded===stored?catalogue.name[locale]!:custom.title),'Recorded requests localize approved catalogue wording, retaining provider-authored wording');
  assert.equal(JSON.stringify(data),before,'Locale presentation never rewrites recorded request requirements or context');
 }
}
for(const locale of ['en','hy'] as const){
 const pending={...request,status:'change-pending' as const,currentArrangement:arrangement,proposal:arrangement,pendingChange:{kind:'reschedule' as const,terms,memberAccepted:true}};
 const revised={...pending,status:'provider-proposed' as const,revision:2};
 const html=renderToStaticMarkup(React.createElement(Member,{data:{available:true,requirements:[],homeTasks:[],requests:[revised]},locale}));
 assert.ok(html.includes(locale==='en'?'Provider proposal, awaiting your acceptance':'Առաջարկ, որը սպասում է Ձեր համաձայնությանը'));
 assert.ok(html.includes(locale==='en'?'Accept provider terms and preparation':'Ընդունել պայմանները և նախապատրաստումը'));
 assert.ok(!html.includes(locale==='en'?'Replacement awaiting confirmation':'Փոփոխությունը սպասում է հաստատմանը'),'New proposal cannot reuse older acceptance flag');
 const accepted=renderToStaticMarkup(React.createElement(Member,{data:{available:true,requirements:[],homeTasks:[],requests:[pending]},locale}));
 assert.ok(accepted.includes(locale==='en'?'Replacement awaiting confirmation':'Փոփոխությունը սպասում է հաստատմանը'));
 assert.ok(!accepted.includes('data-operation="accept"'),'Valid pending replacement acceptance is not requested twice');
}
// QA 160: a pending time change still offers cancel (which withdraws it); a pending cancellation does not.
for(const locale of ['en','hy'] as const){
 const reschedule={...request,status:'change-pending' as const,revision:3,currentArrangement:arrangement,pendingChange:{kind:'reschedule' as const,terms}};
 const html=renderToStaticMarkup(React.createElement(Member,{data:{available:true,requirements:[],homeTasks:[],requests:[reschedule]},locale}));
 assert.ok(html.includes('data-operation="cancel"'),'Member can cancel while a time change is pending');
 assert.ok(html.includes('name="confirmCancel"'),'Cancel during a pending time change keeps the confirmation step');
 assert.ok(!html.includes('data-operation="request-change"'),'A second time change is not offered while one is pending');
 assert.ok(html.includes(locale==='en'?'Cancelling withdraws your requested time change.':'Չեղարկելու դեպքում ժամի փոփոխության հարցումը հետ կկանչվի։'));
 const cancelling={...reschedule,revision:4,pendingChange:{kind:'cancel' as const,replacedReschedule:true}};
 const blocked=renderToStaticMarkup(React.createElement(Member,{data:{available:true,requirements:[],homeTasks:[],requests:[cancelling]},locale}));
 assert.ok(!blocked.includes('data-operation="cancel"')&&!blocked.includes('data-operation="request-change"'),'A pending cancellation blocks further member changes');
}
const withdrawn=renderToStaticMarkup(React.createElement(Staff,{requests:[{...request,status:'change-pending',currentArrangement:arrangement,pendingChange:{kind:'cancel',replacedReschedule:true}}]}));
assert.ok(withdrawn.includes('Their pending time change was withdrawn.'),'Staff see that cancellation replaced the pending time change');
const staff=renderToStaticMarkup(React.createElement(Staff,{requests:[{...request,status:'provider-proposed',currentArrangement:arrangement,proposal:arrangement,pendingChange:{kind:'reschedule',memberAccepted:true}}]}));
assert.ok(staff.includes('Provider proposal awaiting member acceptance'));
assert.ok(!staff.includes('Replacement awaiting provider confirmation'));
const before:MemberBookingData={available:true,contextToken:'unchanged-context',requirements,homeTasks:[],requests:[request]};
assert.ok(!renderToStaticMarkup(React.createElement(Member,{data:before,locale:'en'})).includes('data-operation="create"'),'Real members cannot create a legacy subset, even with no pilot row');
let renderer:ReactTestRenderer;
await act(async()=>{renderer=create(React.createElement(Member,{data:before,locale:'en',demo:true}));});
const createForm=()=>renderer.root.findAllByType('form').find(form=>form.props['data-operation']==='create')!;
assert.equal(createForm(),undefined,'An open request cannot start a second partial request');
const after={...before,requests:[{...request,status:'cancelled' as const}]};
await act(async()=>renderer.update(React.createElement(Member,{data:after,locale:'en',demo:true})));
assert.ok(createForm(),'Cancelling the old request allows a new full-set request');
assert.equal(createForm().findAllByProps({name:'testIds'}).length,0,'The form sends logistics, never test choices');
assert.equal(createForm().findAllByProps({type:'checkbox'}).length,0,'No per-test selection remains');
await act(async()=>renderer.unmount());
console.log('Actual booking UI lifecycle passed: revised proposals require fresh acceptance; open requests cannot create subsets; cancelled requests allow a fixed full set. Form/action IO mocked.');
const demoAction=async()=>({ok:true,message:'Fictional rehearsal saved'});
renderedActions.length=0;
renderToStaticMarkup(React.createElement(Member as React.ComponentType<Record<string,unknown>>,{data:before,locale:'en',action:demoAction,demo:true}));
assert.ok(renderedActions.length>0);
assert.ok(renderedActions.every(action=>action===demoAction),'Every demo member form must use the demo adapter, never real mutations');
renderedActions.length=0;
renderToStaticMarkup(React.createElement(Staff as React.ComponentType<Record<string,unknown>>,{requests:[request],action:demoAction,demo:true}));
assert.ok(renderedActions.length>0);
assert.ok(renderedActions.every(action=>action===demoAction),'Every demo staff form must use the demo adapter, never real mutations');

for(const locale of ['en','hy'] as const){const data:MemberBookingData={available:true,legacyCreationAvailable:true,requirements,homeTasks:[],requests:[]};const html=renderToStaticMarkup(React.createElement(Member,{data,locale}));assert.ok(html.includes('data-operation="create"'),'Real production compatibility renders preference form without demo mode');assert.ok(!html.includes('Demo only.'),'Real compatibility never carries demo claims');const off=renderToStaticMarkup(React.createElement(Member,{data:{...data,legacyCreationAvailable:false},locale}));assert.ok(!off.includes('data-operation="create"'),'Configured pilot does not expose legacy creation');}
