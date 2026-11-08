import * as textLanguage from '@/lib/text-language';
import * as testCatalogue from '@/lib/clinical/seed/tests';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import * as displayTime from '@/lib/real-booking/display-time';
import * as visitGate from '@/lib/real-booking/visit-gate';
import type {PilotBookingData,PilotActionState,PilotFormAction,Appointment} from '@/lib/real-booking/appointment-schema';
import * as realLocaleModule from '@/lib/locale';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const require=createRequire(import.meta.url),cache=new Map<string,Record<string,unknown>>();
function load(file:string):Record<string,unknown>{if(cache.has(file))return cache.get(file)!;const exports:Record<string,unknown>={};cache.set(file,exports);const code=ts.transpileModule(readFileSync('components/real-booking/'+file+'.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;vm.runInNewContext(code,{exports,FormData,require(name:string){if(name==='@/lib/text-language')return textLanguage;if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;if(name==='lucide-react')return require(name);if(name==='@/lib/real-booking/display-time')return displayTime;if(name==='@/lib/real-booking/visit-gate')return visitGate;if(name==='@/components/pilot-commerce/member-pricing')return {TestPrices:()=>null,MemberPaymentStatus:()=>null,paymentFor:()=>undefined};if(name.startsWith('./'))return load(name.slice(2));if(name==='@/lib/clinical/seed/tests')return testCatalogue;if(name==='@/lib/locale')return realLocaleModule;throw Error('Unexpected dependency '+name);}});return exports;}
const {PilotMemberBooking}=load('pilot-member') as typeof import('../components/real-booking/pilot-member');
const {PilotStaffBooking}=load('pilot-staff') as typeof import('../components/real-booking/pilot-staff');
const {AppointmentStatus}=load('appointment-status') as typeof import('../components/real-booking/appointment-status');
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const visit={offerId:id(10),offerVersion:'v1',clinicId:id(1),mode:'clinic' as const,startsAt:'2030-01-01T05:00:00Z',endsAt:'2030-01-01T06:00:00Z',timezone:'Asia/Yerevan' as const,location:'1 Fictional Street',preparation:'Fictional prep',preparationVersion:'p1',coveredTestIds:['lab'],followUps:[]};
const program=[{id:'lab',title:'Fictional lab',method:'lab' as const,preparation:''}];
const confirmed:Appointment={version:'email-pilot-v1',id:id(80),memberId:id(81),revision:1,status:'confirmed',noticePurpose:'booking',program,current:visit,proposed:visit,noticeId:id(82),createdAt:'2026-10-16T00:00:00Z'};
const offers=[{id:id(11),version:'v1',clinicId:id(1),clinicName:'Fictional clinic',mode:'home' as const,startsAt:'2030-01-02T05:00:00Z',endsAt:'2030-01-02T06:00:00Z',timezone:'Asia/Yerevan' as const,clinicAddress:null,preparation:'Prep',preparationVersion:'p1',coveredTestIds:['lab'],followUps:[]}];
const data:PilotBookingData={available:true,canChange:true,canCancel:true,unavailableReason:null,program,offers,appointments:[confirmed],clinics:{[id(1)]:'Fictional clinic'}};
const payloads:FormData[]=[];let result:PilotActionState={ok:true,code:'saved',commandRecorded:true};
const action:PilotFormAction=async(_p,form)=>{payloads.push(form);return result;};
const never:PilotFormAction=async()=>{throw Error('Unexpected action');};
const mounted:ReactTestRenderer[]=[];
async function mount(element:React.ReactElement){let tree!:ReactTestRenderer;await act(async()=>{tree=create(element)});mounted.push(tree);return tree;}
const text=(tree:ReactTestRenderer)=>JSON.stringify(tree.toJSON());
type Node=ReactTestRenderer['root'];const inner=(node:Node):string=>node.children.map(child=>typeof child==='string'?child:inner(child)).join('');
const memberProps=(over:Partial<PilotBookingData>={})=>({data:{...data,...over},locale:'en' as const,commandId:id(90),changeCommandIds:{[confirmed.id]:id(91)},cancelCommandIds:{[confirmed.id]:id(92)},selectAction:never,changeAction:action,cancelAction:action,refreshHref:'/patient/service'});
try{
 // Confirmed: clinic named, booked wording, reschedule and cancel offered; only one offer, so home is preselected.
 const member=await mount(React.createElement(PilotMemberBooking,memberProps()));
 for(const value of ['Fictional clinic','Your visit is booked','Change time','Cancel this visit'])assert.ok(text(member).includes(value),value);
 // Two-step cancel posts exactly the cancel fields, no agreement for a member.
 const details=member.root.findAll(node=>node.type==='summary'&&inner(node).includes('Cancel this visit'))[0];
 await act(async()=>details.props.onClick({preventDefault(){}}));
 const cancelForm=text(member).includes('Yes, cancel this visit');
 const forms=member.root.findAllByType('form');const cancel=forms[forms.length-1];
 assert.ok(cancelForm);
 await act(async()=>{await cancel.props.onSubmit({preventDefault(){}})});
 const posted=payloads.at(-1)!;assert.deepEqual([...posted.keys()].sort(),['agreementSource','appointmentId','commandId','revision']);
 assert.equal(posted.get('commandId'),id(92));assert.equal(posted.get('revision'),'1');assert.equal(posted.get('agreementSource'),'');
 assert.ok(text(member).includes('The clinic has been emailed and the visit is cancelled.'));
 const before=payloads.length;await act(async()=>{await cancel.props.onSubmit({preventDefault(){}})});assert.equal(payloads.length,before,'A recorded cancel cannot be submitted twice');
 // Without approved wording the controls are hidden.
 const noWording=await mount(React.createElement(PilotMemberBooking,memberProps({canChange:false,canCancel:false})));
 assert.ok(!text(noWording).includes('Cancel this visit')&&!text(noWording).includes('Change time'));
 // Pending cancellation: visit still shown as the one to cancel, no second cancel, no proposed-change block.
 const cancelling:Appointment={...confirmed,revision:2,status:'notification-pending',noticePurpose:'cancellation',noticeId:id(92)};
 for(const locale of ['en','hy'] as const){
  const pending=await mount(React.createElement(PilotMemberBooking,{...memberProps({appointments:[cancelling]}),locale}));
  assert.ok(text(pending).includes(locale==='en'?'Cancellation email pending':'Չեղարկման նամակը սպասում է ուղարկման'));
  assert.ok(text(pending).includes(locale==='en'?'Visit to cancel':'Չեղարկվող այցը'));
  assert.ok(!text(pending).includes(locale==='en'?'Proposed change':'Առաջարկվող փոփոխությունը'));
  assert.ok(!text(pending).includes(locale==='en'?'Cancel this visit':'Չեղարկել այս այցը'));
 }
 // Cancelled: cancelled visit kept for reference, rebook form offered with booking wording.
 const cancelled:Appointment={...confirmed,revision:2,status:'cancelled',noticePurpose:'cancellation',current:null,noticeId:id(92),history:[{revision:2,createdAt:'2026-10-16T01:00:00Z',purpose:'cancellation',program,previous:visit,proposed:visit,noticeState:'accepted'}]};
 const after=await mount(React.createElement(PilotMemberBooking,memberProps({appointments:[cancelled]})));
 for(const value of ['Visit cancelled','Cancelled visit','Book this visit','Where should the visit happen?'])assert.ok(text(after).includes(value),value);
 assert.ok(!text(after).includes('Record visit change'));
 const history=await mount(React.createElement(AppointmentStatus,{appointment:cancelled,locale:'en'}));assert.ok(!text(history).includes('Earlier changes'),'A member sees no history for a single booking');
 const staffHistory=await mount(React.createElement(AppointmentStatus,{appointment:cancelled,locale:'en',audience:'staff'}));assert.ok(text(staffHistory).includes('Cancellation'),'Staff keep the full record');
 const twice:Appointment={...cancelled,history:[{...cancelled.history![0],revision:1,purpose:'booking'},...cancelled.history!]};const memberHistory=text(await mount(React.createElement(AppointmentStatus,{appointment:twice,locale:'en'})));assert.ok(memberHistory.includes('Earlier changes')&&memberHistory.includes('Cancellation')&&!/revision/i.test(memberHistory),'Member history from two entries, no revision wording');
 // Staff: cancel needs agreement text before the button is enabled.
 const staff=await mount(React.createElement(PilotStaffBooking,{data,locale:'en',commandIds:{[confirmed.id]:id(93)},changeAction:never,cancelAction:action,cancelCommandIds:{[confirmed.id]:id(94)},refreshHref:'/staff/real/members/x'}));
 const staffDetails=staff.root.findAll(node=>node.type==='summary'&&inner(node).includes('Cancel this visit'))[0];
 await act(async()=>staffDetails.props.onClick({preventDefault(){}}));
 const yes=staff.root.findAll(node=>node.type==='button'&&inner(node).includes('Yes, cancel'))[0];assert.equal(yes.props.disabled,true,'No agreement, no staff cancel');
 await act(async()=>staff.root.findAllByProps({name:'agreementSource'}).at(-1)!.props.onChange({target:{value:'Member phoned on 16 Oct'}}));
 const staffForms=staff.root.findAllByType('form');result={ok:false,code:'failed',commandRecorded:true};
 await act(async()=>{await staffForms[staffForms.length-1].props.onSubmit({preventDefault(){}})});
 assert.equal(payloads.at(-1)!.get('agreementSource'),'Member phoned on 16 Oct');assert.ok(text(staff).includes('The cancellation email failed. The visit is still booked.'));
 // Astra R1-2: reschedule only offers the visit's own clinic; a cross-clinic move is cancel + book.
 const otherClinic={...offers[0],id:id(12),clinicId:id(2),clinicName:'Other fictional clinic'};
 const same=await mount(React.createElement(PilotMemberBooking,memberProps({offers:[...offers,otherClinic]})));
 assert.ok(text(same).includes('To change clinic, cancel this visit and book again.'));
 const reschedule=same.root.findAll(node=>node.type==='details'&&inner(node).includes('Change time'))[0];
 assert.ok(!inner(reschedule).includes('Other fictional clinic'),'Other clinic not offered for a reschedule');
 const onlyOther=await mount(React.createElement(PilotMemberBooking,memberProps({offers:[otherClinic]})));
 assert.ok(!text(onlyOther).includes('Change time'),'No same-clinic time, no reschedule control');
 // Astra R1-3: a failed cancellation stays retryable for staff even when new-booking preparation failed.
 const failedCancel:Appointment={...confirmed,revision:2,status:'failed',noticePurpose:'cancellation',noticeId:id(95),history:[{revision:2,createdAt:'2026-10-16T01:00:00Z',purpose:'cancellation',program,previous:visit,proposed:visit,noticeState:'failed'}]};
 const held=await mount(React.createElement(PilotStaffBooking,{data:{...data,available:false,unavailableReason:'clinical-hold',canRetryScheduling:false,canRecoverScheduling:true,offers:[],appointments:[failedCancel]},locale:'en',commandIds:{},changeAction:never,retryAction:action,retryCommandIds:{[failedCancel.id]:id(96)},refreshHref:'/staff/real/members/x'}));
 assert.ok(text(held).includes('Retry scheduling email'),'Failed cancellation retry survives a clinical hold');
 // Astra R1-4: history says requested, not cancelled, until the cancellation email is accepted.
 assert.ok(text(held).includes('Cancellation requested for this visit')&&!text(held).includes('Cancelled visit'));
 const heldHy=await mount(React.createElement(AppointmentStatus,{appointment:failedCancel,locale:'hy',audience:'staff'}));assert.ok(text(heldHy).includes('Այս այցի չեղարկման հարցում'));
 console.log('B1 UI: home/clinic first choice, booked wording, reschedule/cancel gated by approved wording, two-step member cancel payload and lock, pending/cancelled EN/HY states, rebook, staff agreement gate passed.');
}finally{for(const tree of mounted)act(()=>tree.unmount());}
