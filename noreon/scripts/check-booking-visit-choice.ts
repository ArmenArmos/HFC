import * as textLanguage from '@/lib/text-language';
import * as testCatalogue from '@/lib/clinical/seed/tests';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as memberScreens from '@/components/patient-care/member-screens';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import * as displayTime from '@/lib/real-booking/display-time';
import * as visitGate from '@/lib/real-booking/visit-gate';
import * as legacyMode from '@/lib/real-booking/legacy-mode';
import * as formError from '@/lib/real-booking/form-error';
import {runAppointmentSelection,readPilotForm} from '@/lib/real-booking/appointment-commands';
import type {MemberBookingData} from '@/lib/real-booking/schema';
import type {PilotBookingData,PilotActionState,PilotFormAction,TrustedOffer,BookingProgram,Appointment} from '@/lib/real-booking/appointment-schema';
import * as realLocaleModule from '@/lib/locale';
import * as realPatientCopy from '@/lib/patient/copy';
// Clinic scheduling on, email off (17 Oct, Khikar): the member sees "At a clinic" and "Home visit" up front with
// equal weight. Only the home visit asks for an address; a clinic booking without one is accepted by the server.
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const require=createRequire(import.meta.url),cache=new Map<string,Record<string,unknown>>();
function load(file:string):Record<string,unknown>{if(cache.has(file))return cache.get(file)!;const exports:Record<string,unknown>={};cache.set(file,exports);const code=ts.transpileModule(readFileSync('components/real-booking/'+file+'.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;vm.runInNewContext(code,{exports,FormData,require(name:string){if(name==='@/lib/text-language')return textLanguage;if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;if(name==='lucide-react')return require(name);if(name==='@/lib/real-booking/display-time')return displayTime;if(name==='@/lib/real-booking/visit-gate')return visitGate;if(name==='@/components/pilot-commerce/member-pricing')return {TestPrices:()=>null,MemberPaymentStatus:()=>null,paymentFor:()=>undefined};if(name.startsWith('./'))return load(name.slice(2));if(name==='@/lib/clinical/seed/tests')return testCatalogue;if(name==='@/lib/locale')return realLocaleModule;throw Error('Unexpected dependency '+name);}});return exports;}
const {PilotMemberBooking}=load('pilot-member') as typeof import('../components/real-booking/pilot-member');
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const program=[{id:'lipid-panel',title:'Fictional lipid profile',method:'lab' as const,preparation:''}];
const slot=(n:number,day:string)=>({id:id(n),version:'v1',clinicId:id(1),clinicName:'Fictional clinic',mode:'clinic' as const,source:'clinic-hours',startsAt:`${day}T05:00:00Z`,endsAt:`${day}T05:30:00Z`,timezone:'Asia/Yerevan' as const,clinicAddress:'12 Fictional Avenue',preparation:'Prep',preparationVersion:'p1',coveredTestIds:['lipid-panel'],followUps:[]});
const data:PilotBookingData={available:true,canChange:true,canCancel:true,unavailableReason:null,program,offers:[slot(11,'2030-01-07'),slot(12,'2030-01-08')],appointments:[],clinics:{[id(1)]:'Fictional clinic'}};
const payloads:FormData[]=[];
const action:PilotFormAction=async(_p,form)=>{payloads.push(form);return {ok:true,code:'saved',commandRecorded:true} satisfies PilotActionState;};
const never:PilotFormAction=async()=>{throw Error('Unexpected action');};
const homeForm=React.createElement('form',{'data-home-request':true},React.createElement('textarea',{name:'location',required:true}));
const props=(over:Partial<PilotBookingData>={},homeVisit:React.ReactNode=homeForm,locale:'en'|'hy'|'ru'='en')=>({data:{...data,...over},locale,commandId:id(90),changeCommandIds:{},cancelCommandIds:{},selectAction:action,changeAction:never,refreshHref:'/patient/service',homeVisit});
const mounted:ReactTestRenderer[]=[];
async function mount(element:React.ReactElement){let tree!:ReactTestRenderer;await act(async()=>{tree=create(element)});mounted.push(tree);return tree;}
const text=(tree:ReactTestRenderer)=>JSON.stringify(tree.toJSON());
type Node=ReactTestRenderer['root'];const inner=(node:Node):string=>node.children.map(child=>typeof child==='string'?child:inner(child)).join('');
const radio=(tree:ReactTestRenderer,name:string,value:string)=>tree.root.find(node=>node.type==='input'&&(name==='visitChoice'?node.props['data-visit-choice']===true:node.props.name===name)&&node.props.value===value);
const addressFields=(tree:ReactTestRenderer)=>tree.root.findAll(node=>node.type==='textarea').length;
try{
 // 1. Both choices up front, equal weight, nothing chosen yet, no address field yet. EN and HY.
 for(const [locale,clinic,home] of [['en','At a clinic','Home visit'],['hy','Կլինիկայում','Այց տանը']] as const){
  const tree=await mount(React.createElement(PilotMemberBooking,props({},homeForm,locale)));
  for(const value of [clinic,home])assert.ok(text(tree).includes(value),`${locale}: ${value} offered up front`);
  const options=tree.root.findAll(node=>node.type==='input'&&node.props['data-visit-choice']===true);
  assert.deepEqual(options.map(node=>node.props.value),['clinic','home'],`${locale}: two choices`);
  assert.ok(options.every(node=>node.props.checked===false),`${locale}: neither choice is preselected`);
  const labels=tree.root.findAll(node=>node.type==='label'&&node.findAll(child=>child.type==='input'&&child.props['data-visit-choice']===true).length===1);
  assert.equal(new Set(labels.map(node=>node.props.className)).size,1,`${locale}: same visual weight`);
  assert.equal(addressFields(tree),0,`${locale}: no address before a choice`);
  assert.ok(!text(tree).includes('Prefer a home visit?'),'The separate home card is replaced by the choice');
 }
 // 2. At a clinic: slots only, never an address; the posted booking carries an empty address.
 const tree=await mount(React.createElement(PilotMemberBooking,props()));
 await act(async()=>radio(tree,'visitChoice','clinic').props.onChange());
 assert.equal(addressFields(tree),0,'Clinic choice asks for no address');
 assert.equal(tree.root.findAll(node=>node.type==='input'&&node.props.name==='visitMode').length,0,'No second where-question inside the clinic form');
 assert.equal(tree.root.findAll(node=>node.props['data-home-request']).length,0,'Home form hidden while clinic is chosen');
 await act(async()=>tree.root.findByProps({name:'visitDate'}).props.onChange({target:{value:'2030-01-07'}}));
 await act(async()=>radio(tree,'offerId',id(11)).props.onChange());
 assert.equal(addressFields(tree),0,'Still no address with a clinic time chosen');
 const submit=tree.root.findByProps({type:'submit'});assert.equal(submit.props.disabled,false,'A clinic time alone is enough to book');
 await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}})});
 assert.equal(payloads.at(-1)!.get('offerId'),id(11));assert.equal(payloads.at(-1)!.get('homeAddress'),'','Clinic booking posts no address');
 assert.equal(payloads.at(-1)!.get('suggestedSetFingerprint'),'["lipid-panel"]','Clinic booking binds the displayed test list');
 // A changed list needs an explicit refresh, with a localized explanation and no resubmit.
 for(const [locale,words] of [['en',/list changed.*Refresh.*list and total/],['hy',/ցանկը փոխվել է.*Թարմացրեք.*ընդհանուր գումարը/],['ru',/список исследований изменился.*Обновите.*общую стоимость/]] as const){
  let submits=0;
  const stale=await mount(React.createElement(PilotMemberBooking,{...props({},homeForm,locale),selectAction:async()=>{submits++;return {ok:false as const,code:'tests-changed' as const};}}));
  await act(async()=>radio(stale,'visitChoice','clinic').props.onChange());
  await act(async()=>stale.root.findByProps({name:'visitDate'}).props.onChange({target:{value:'2030-01-07'}}));
  await act(async()=>radio(stale,'offerId',id(11)).props.onChange());
  await act(async()=>stale.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.match(inner(stale.root.findByProps({role:'alert'})),words,locale+': explains the changed list and total');
  assert.equal(stale.root.findByProps({type:'submit'}).props.disabled,true,locale+': stale form is locked');
  assert.ok(stale.root.findAll(node=>node.type==='a'&&node.props.href==='/patient/service').length>0,locale+': refresh is available');
  await act(async()=>stale.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(submits,1,locale+': stale form cannot be sent again');
 }
 // QA 213: every offered time has a real label, and the date list shows dates only, in every language.
 for(const [locale,label] of [['en','7 Jan 2030'],['hy','7 հնվ 2030'],['ru','7 янв. 2030 г.']] as const){
  const chosen=await mount(React.createElement(PilotMemberBooking,props({},homeForm,locale)));
  await act(async()=>radio(chosen,'visitChoice','clinic').props.onChange());
  const dates=chosen.root.findByProps({name:'visitDate'}).findAllByType('option').slice(1).map(inner);
  assert.equal(dates[0],label,`${locale}: the date option is the date alone`);
  await act(async()=>chosen.root.findByProps({name:'visitDate'}).props.onChange({target:{value:'2030-01-07'}}));
  const times=chosen.root.findAll(node=>node.type==='label'&&node.findAll(child=>child.type==='input'&&child.props.name==='offerId').length===1).map(inner);
  assert.deepEqual(times,['09:00–09:30'],`${locale}: the offered time has its start and end`);
 }
 // 3. Home visit: the request form (with its address field) shows; the clinic slot form does not.
 const home=await mount(React.createElement(PilotMemberBooking,props()));
 await act(async()=>radio(home,'visitChoice','home').props.onChange());
 assert.equal(home.root.findAll(node=>node.props['data-home-request']).length,1,'Home request form shown');
 assert.equal(home.root.findAll(node=>node.props.name==='visitDate').length,0,'No clinic slots under a home visit');
 // 4. No clinic slots: the home visit is still offered, with a plain note for the clinic choice.
 const empty=await mount(React.createElement(PilotMemberBooking,props({offers:[]})));
 assert.ok(text(empty).includes('Home visit'));
 await act(async()=>radio(empty,'visitChoice','clinic').props.onChange());
 assert.ok(text(empty).includes('No clinic times are currently offered. You can ask for a home visit instead.'));
 // 5. Home request not allowed: the original clinic form, unchanged.
 const clinicOnly=await mount(React.createElement(PilotMemberBooking,props({},null)));
 assert.equal(clinicOnly.root.findAll(node=>node.props['data-visit-choice']===true).length,0);
 assert.ok(text(clinicOnly).includes('Choose a visit')&&!text(clinicOnly).includes('Home visit'));
 // 6. A booked visit: no choice; an allowed home request keeps its own titled card.
 const visit={offerId:id(11),offerVersion:'v1',clinicId:id(1),mode:'clinic' as const,startsAt:'2030-01-07T05:00:00Z',endsAt:'2030-01-07T05:30:00Z',timezone:'Asia/Yerevan' as const,location:'12 Fictional Avenue',preparation:'Prep',preparationVersion:'p1',coveredTestIds:['lipid-panel'],followUps:[]};
 const cancelled=await mount(React.createElement(PilotMemberBooking,props({appointments:[{version:'email-pilot-v1',id:id(80),memberId:id(81),revision:2,status:'cancelled',noticePurpose:'cancellation',program,current:null,proposed:visit,noticeId:id(82),createdAt:'2026-10-16T00:00:00Z'}]})));
 assert.equal(cancelled.root.findAll(node=>node.props['data-visit-choice']===true).length,0);
 assert.ok(text(cancelled).includes('Prefer a home visit?'),'Standalone home card when the choice is not shown');

 // 7. Status card (QA F-03, F-09, F-10, F-11). A clinic-portal visit with portal details.
 const portalBase={channel:'portal' as const,noticeState:'accepted',portalRevisions:[0],decline:null,proposal:null,checkin:null};
 const booked:Appointment={version:'email-pilot-v1',id:id(70),memberId:id(71),revision:0,status:'confirmed',noticePurpose:'booking',program,current:visit,proposed:visit,noticeId:id(72),createdAt:'2026-10-17T00:00:00Z',portal:portalBase};
 const card=(appointment:Appointment,over:Partial<PilotBookingData>={})=>React.createElement(PilotMemberBooking,{...props({appointments:[appointment],...over},null),changeCommandIds:{[appointment.id]:id(73)},cancelCommandIds:{[appointment.id]:id(74)},proposalCommandIds:{[appointment.id]:id(75)},cancelAction:never,proposalAction:never});
 const confirmedCard=text(await mount(card(booked)));
 for(const value of ['Confirmed','Change time','Cancel this visit','Before your visit','1 test in this visit','Open in maps'])assert.ok(confirmedCard.includes(value),value);
 assert.ok(!/revision/i.test(confirmedCard)&&!/email/i.test(confirmedCard),'No internal or email wording on a portal visit');
 // F-03: a recorded arrival or linked results settle the visit: no change, no cancel.
 for(const outcome of ['arrived','completed'] as const){const checked=text(await mount(card({...booked,portal:{...portalBase,checkin:{outcome,at:'2030-01-07T05:05:00Z'}}})));
  assert.ok(!checked.includes('Change time')&&!checked.includes('Cancel this visit'),`No change or cancel after ${outcome}`);}
 // Lead decision 18 Oct (review F2): a no-show stays open, so the member can move or cancel it.
 const missed=text(await mount(card({...booked,portal:{...portalBase,checkin:{outcome:'no-show',at:'2030-01-07T05:05:00Z'}}})));
 assert.ok(missed.includes('Change time')&&missed.includes('Cancel this visit'),'Change and cancel stay after a no-show');
 // F-10: the scheduling reference is only in the small Details footer.
 const waiting:Appointment={...booked,status:'notification-pending',current:null,portal:{...portalBase,noticeState:'pending'}};
 const waitingTree=await mount(card(waiting));const footer=waitingTree.root.findAll(node=>node.type==='details'&&inner(node).startsWith('Details'));
 assert.equal(footer.length,1,'Reference sits in a Details footer');assert.ok(inner(footer[0]).includes(waiting.noticeId));
 assert.ok(text(waitingTree).includes('Cancel request'),'Withdraw is a small cancel-request control');
 // F-11: a clinic proposal is the status; the waiting status is not repeated beside it.
 const proposed=text(await mount(card({...waiting,portal:{...waiting.portal!,proposal:{id:id(76),startsAt:'2030-01-08T06:00:00Z',endsAt:'2030-01-08T06:30:00Z',note:null,clinicId:id(1),clinicName:'Fictional clinic',clinicAddress:'12 Fictional Avenue',createdAt:'2026-10-17T00:00:00Z'}}})));
 assert.ok(proposed.includes('New time proposed: accept or decline')&&!proposed.includes('Waiting for the clinic to confirm'),'One status with a proposal');
 // F-09: the clinic name and address show before a time is chosen.
 const pick=await mount(React.createElement(PilotMemberBooking,props()));
 await act(async()=>radio(pick,'visitChoice','clinic').props.onChange());assert.ok(text(pick).includes('12 Fictional Avenue'),'Clinic address before choosing a time');
}finally{for(const tree of mounted)act(()=>tree.unmount());}
// 7. Page wiring: the home request goes into the choice only when the member read allows one.
const base:MemberBookingData={available:true,requirements:[{id:'lipid-panel',title:'Fictional lipid profile',method:'lab'}],homeTasks:[],requests:[]};
const cases:[Partial<MemberBookingData>,boolean][]=[[{homeRequestAvailable:true},true],[{homeRequestAvailable:false},false],[{homeRequestAvailable:true,requirements:[]},false],[{homeRequestAvailable:true,available:false},false]];
for(const [over,expected] of cases)
 assert.equal(legacyMode.homeVisitRequestAvailable({...base,...over}),expected,JSON.stringify(over));
let member:MemberBookingData;const seen:{homeVisit?:unknown}[]=[];
const exports:Record<string,unknown>={};
const code=ts.transpileModule(readFileSync('app/patient/service/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
vm.runInNewContext(code,{exports,crypto:globalThis.crypto,require:(name:string)=>{
 if(name==='@/components/patient-care/member-screens')return memberScreens;
  if(name==='@/lib/patient/member-screens-config')return {memberScreensPrototypeEnabled:()=>false};

 if(name==='react/jsx-runtime')return jsx;if(name==='@/lib/patient-care/lab-stage-repository')return {getMemberLabStages:async()=>null};if(name==='@/lib/patient-care/repository')return {getCareData:async()=>({plan:null})};if(name==='@/lib/staff/lab-stage-schema')return {memberLabSummary:()=>null};if(name==='@/lib/patient-care/journey-strip')return {journeyStripIndex:()=>1,journeyStripInput:(f:unknown)=>f};if(name==='@/lib/patient-care/journey-reads')return {readJourneyExtras:async()=>({nurseVisit:undefined,released:null})};
 if(name==='next/navigation')return {redirect:()=>{throw Error('Unexpected urgent redirect');},unstable_rethrow:()=>{}};
 if(name==='@/lib/clinical/rules/engine')return {evaluate:()=>({urgency:'green'})};
 if(name==='@/lib/patient/repository')return {requireRegistered:async()=>({profile:{locale:'en'},assessment:{answers:{},urgentRule:null}})};
 if(name==='@/lib/patient/demo')return {demoEnabled:()=>false};
 if(name==='@/lib/real-booking/repository')return {getMemberBookingData:async()=>member};
 if(name==='@/lib/real-booking/appointment-repository')return {getMemberAppointmentData:async()=>data,getMemberAppointmentSummary:async()=>({appointments:[],clinics:{}})};
 if(name==='@/lib/observability/logger')return {log:{error:()=>{}},errorFields:()=>({})};
 if(name==='@/lib/real-booking/legacy-mode')return legacyMode;
 if(name==='@/lib/real-booking/form-error')return formError;
 if(name==='@/lib/real-booking/appointment-actions')return {};
 if(name==='@/components/real-booking/pilot-member')return {PilotMemberBooking:(p:{homeVisit?:unknown})=>{seen.push(p);return null;}};
 if(name==='@/components/real-booking/member')return {RealMemberBooking:()=>null,HomeVisitRequest:()=>null};
 if(name==='@/components/patient/patient-shell')return {PatientShell:({children}:{children:React.ReactNode})=>children};
 if(name==='@/lib/pilot-commerce/member')return {getMemberPricing:async()=>undefined};
 if(name==='@/components/patient-care/consultation-window-notice')return {ConsultationWindowNotice:()=>null};
 if(['@/lib/service-workflow/server','@/components/service-workflow/legacy-booking-history','@/lib/demo-booking/repository','@/lib/demo-booking/actions','@/components/patient-care/common','@/lib/staff/cases','@/components/service-workflow/client','@/lib/service-workflow/client-projection'].includes(name))return {};
 if(name==='@/lib/clinical/rules/rules')return {inCrisisRange:()=>false};
 if(name==='@/lib/patient/questionnaire')return {pruneAnswers:(a:unknown)=>a,assessmentProgress:()=>({complete:true})};
 if(name==='@/lib/real-booking/visit-gate')return visitGate;if(name==='@/lib/locale')return realLocaleModule;if(name==='@/lib/patient/copy')return realPatientCopy;throw Error(`Unexpected route boundary ${name}`);
}});
const page=exports.default as ()=>Promise<React.ReactElement>;
member={...base,pilot:data,homeRequestAvailable:true};renderToStaticMarkup(await page());assert.ok(seen.at(-1)!.homeVisit,'Allowed home request is passed into the choice');
member={...base,pilot:data,homeRequestAvailable:false};renderToStaticMarkup(await page());assert.equal(seen.at(-1)!.homeVisit,undefined,'No home choice when not allowed');
// 8. Server: a clinic slot booked with no address is accepted; an address on a clinic slot or none on a home slot is refused.
const cmd='b3000000-0000-4000-8000-000000000071';
const trusted:TrustedOffer={id:cmd,version:'v1',source:'clinic-hours',clinicId:cmd,mode:'clinic',startsAt:'2030-01-07T09:00:00+04:00',endsAt:'2030-01-07T09:30:00+04:00',timezone:'Asia/Yerevan',clinicAddress:'12 Fictional Avenue',preparation:'Prep',preparationVersion:'v1',coveredTestIds:['lipid-panel'],followUps:[],reservationContract:{version:'manual-v1',reference:'fictional'}};
const sealed:BookingProgram={memberId:cmd,sourceToken:'source',requirementsToken:'requirements',engineVersion:'fictional',items:[{id:'lipid-panel',title:'Fictional lipid profile',method:'lab',preparation:'',source:'fixture'}]};
let admitted=0;
const deps=(offer:TrustedOffer)=>({available:true,recover:async()=>({data:null,error:null}),prepare:async()=>({program:sealed,sealId:cmd}),offer:async()=>offer,render:()=>({senderEmail:'noreon@example.invalid',templateVersion:'fictional',subject:'Fictional',textContent:'Fictional'}),select:async()=>{admitted++;return {data:{version:'email-pilot-v1',id:cmd,memberId:cmd,revision:0,status:'notification-pending',program:[{id:'lipid-panel',title:'Fictional lipid profile',method:'lab',preparation:''}],current:null,proposed:{offerId:cmd,offerVersion:'v1',clinicId:cmd,mode:'clinic',startsAt:trusted.startsAt,endsAt:trusted.endsAt,timezone:'Asia/Yerevan',location:'12 Fictional Avenue',preparation:'Prep',preparationVersion:'v1',coveredTestIds:['lipid-panel'],followUps:[]},noticeId:cmd,createdAt:'2026-10-17T00:00:00Z'},error:null};},dispatch:async()=>'confirmed' as const,invalidate:()=>{}});
const form=new FormData();for(const [k,v] of Object.entries({commandId:cmd,offerId:cmd,offerVersion:'v1',homeAddress:'',suggestedSetFingerprint:'["lipid-panel"]'}))form.set(k,v);
const clinicInput=readPilotForm(form,false);assert.ok(clinicInput&&clinicInput.homeAddress===null,'An empty address reads as none');
assert.equal((await runAppointmentSelection({memberId:cmd,actorId:cmd},clinicInput!,deps(trusted) as never)).ok,true,'Clinic booking without an address is accepted');assert.equal(admitted,1);
assert.deepEqual(await runAppointmentSelection({memberId:cmd,actorId:cmd},{...clinicInput!,homeAddress:'5 Fictional Lane'},deps(trusted) as never),{ok:false,code:'invalid'},'No member address on a clinic visit');
assert.deepEqual(await runAppointmentSelection({memberId:cmd,actorId:cmd},clinicInput!,deps({...trusted,mode:'home',clinicAddress:null}) as never),{ok:false,code:'invalid'},'A home visit needs an address');
assert.equal(admitted,1,'Refused selections never reach admission');
console.log('Visit choice: clinic and home offered up front with equal weight (EN/HY); clinic asks and posts no address and the server accepts it; home shows its request form; page passes the home request only when allowed. Status card: no change/cancel after check-in (F-03), clinic address before a time (F-09), reference in Details (F-10), one status with a proposal (F-11).');
