import * as bpUnits from '@/lib/bp-unit';
import * as outcomeCopy from '@/lib/staff-zoe/outcome-copy';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import * as alertLabel from '@/lib/staff/alert-label';
import {AlertCardLines} from '@/components/staff/alert-card';
import * as staffFacts from '@/lib/staff-zoe/facts';
import * as zoeCards from '@/components/staff/zoe/cards';
import * as careAlertContracts from '@/lib/care-alerts/contracts';
import {formatMmol,formatPercent} from '@/lib/ldl/status';
import {st} from '@/lib/staff/staff-locale-copy';
import {staffServerText} from '@/lib/staff/staff-server-copy';
import {FIRST_NOTE_BUILDER,FIRST_NOTE_VERSION} from '@/lib/first-note/compose';
import {regimenNameKey} from '@/lib/service-workflow/publication';
import {RegimenChanges,RegimenList} from '@/components/patient-care/regimen-changes';
import * as contracts from '@/lib/staff-zoe/contracts';
import * as homePresentation from '@/components/staff/doctor-workspace/home-presentation';
import * as emptyChat from '@/components/staff/empty-chat';
import * as kitThread from '@/components/patient/zoe-kit/thread';
import * as dayCards from '@/components/staff/doctor-workspace/day-cards';
import * as urgentWindows from '@/lib/doctor-inbox/urgent-windows';
import {workspaceIntent} from '@/lib/staff-zoe/home-intent';
import {readDoctorDay} from '@/lib/doctor-inbox/day';
import {member,other,doctor,sourceData,memberRow,at,baseItem} from './doctor-chat-home-fixture';
import type {WorkspaceDecisions} from '@/lib/doctor-decisions/read';
import type {HomeRequest,HomeResponse} from '@/lib/staff-zoe/home-read';
import type {DoctorCardResponse} from '@/lib/staff-zoe/card-read';
import {selectFieldNativeStub} from './select-field-native-stub';
import * as reportSchema from '@/lib/reports/schema';
import * as reviewSchema from '@/lib/patient-care/clinical-review-schema';
import * as requiredEvidence from '@/lib/patient-care/required-evidence';
import * as regimen from '@/lib/patient-care/regimen';
import * as requiredLabMatch from '@/lib/patient-care/required-lab-match';
import * as localeCopy from '@/lib/locale';
import * as documentSchema from '@/lib/doctor-completion/document-schema';
import * as patientCommon from '@/components/patient-care/common';
import {nativeCareCommandSchema} from '@/lib/staff/care-command-schema';
import {isFutureMeasurement} from '@/lib/patient/measured-at';
import * as bpProvenance from '@/lib/patient/bp-provenance';
import * as yerevanTime from '@/lib/staff/yerevan-time';

// Render actual components with controlled IO and timer. No browser, DB, provider or network.
const require=createRequire(import.meta.url),calls:HomeRequest[]=[];
const rpc={async rpc(name:string){return {data:sourceData[name],error:null};}};
const initial:HomeResponse={kind:'day',day:await readDoctorDay(rpc,true,new Date(at))};
let deferredDay:Promise<HomeResponse>|null=null;
let response:HomeResponse=initial,visibility='visible',tick:(()=>Promise<void>)|null=null,delay=0;
const selected:HomeResponse={kind:'record',conversation:{enabled:true,id:other,member:{id:member,name:'Fictional selected member',birthYear:1980,sex:null},messages:[]},glance:[],decisions:null,bp:[],bpState:'ok',charts:null};
let recordResponse:HomeResponse=selected,denyFirstNoteDetails=false;
const itemPresses:{revision:string}[]=[];
const cardCalls:unknown[]=[];let cardRefused=false,realCards=false;
let cardResponse:DoctorCardResponse={kind:'off'};
let alertResult:{kind:string;resolvedBy?:string;resolvedAt?:string}={kind:'saved'};
let deferredCard:Promise<DoctorCardResponse>|null=null;
const cardModules=new Map<string,Record<string,unknown>>();
function cardModule(path:string){
 if(!cardModules.has(path))cardModules.set(path,load(path));
 return cardModules.get(path)!;
}
// Browser stand-ins also exercise the real shared chat effects below.
let phone=false,now=0;
const view=new EventTarget() as EventTarget&{height:number;offsetTop:number};
Object.assign(view,{height:700,offsetTop:0});
const media=Object.defineProperty(new EventTarget(),'matches',{get:()=>phone});
const browser=Object.assign(new EventTarget(),{setTimeout:(run:()=>void)=>{run();return 1;},clearTimeout:()=>{},visualViewport:view,scrollY:0,scrollTo:()=>{browser.scrollY=0;},matchMedia:()=>media});
const properties=new Map<string,string>();
let editing=false;
const doc=Object.assign(new EventTarget(),{getElementById:()=>null,querySelector:()=>null,activeElement:{matches:()=>editing},hidden:false,documentElement:{style:{setProperty:(k:string,v:string)=>properties.set(k,v),removeProperty:(k:string)=>properties.delete(k)}}});
const resizes:{callback:()=>void;targets:unknown[];active:boolean}[]=[];
class ResizeStandIn{
 record:{callback:()=>void;targets:unknown[];active:boolean};
 constructor(callback:()=>void){this.record={callback,targets:[],active:true};resizes.push(this.record);}
 observe(target:unknown){this.record.targets.push(target);}
 disconnect(){this.record.active=false;}
}
const p0Modules:Record<string,unknown>={};
for(const path of ['@/lib/doctor-decisions/publication-gate','@/lib/patient-care/action-timeout','@/lib/patient-care/consultation-proposal','@/components/real-review/use-consultation-decision','@/components/real-review/clinical-summary','@/components/real-review/urgent-publication'])p0Modules[path]=await import(path);
function load(path:string):Record<string,unknown>{
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new vm.Script(code).runInNewContext({exports,crypto,Set,Map,Array,window:browser,document:Object.defineProperty(doc,'visibilityState',{get:()=>visibility,configurable:true}),performance:{now:()=>now},ResizeObserver:ResizeStandIn,requestAnimationFrame:(fn:()=>void)=>{fn();return 1;},setTimeout:(fn:()=>Promise<void>,ms:number)=>{tick=fn;delay=ms;return 1;},clearTimeout:()=>{tick=null;},require(name:string){if(name==='@/lib/bp-unit')return bpUnits;
  if(name in p0Modules)return p0Modules[name];
  if(name==='./clinical-summary')return p0Modules['@/components/real-review/clinical-summary'];
  if(name==='./urgent-publication')return p0Modules['@/components/real-review/urgent-publication'];
  if(name==='./use-consultation-decision')return p0Modules['@/components/real-review/use-consultation-decision'];
  if(name==='@/components/staff/chat-menu-items')return load('components/staff/chat-menu-items.tsx');
  if(name==='@/components/staff/chat-enter')return load('components/staff/chat-enter.ts');
  if(name==='@/components/patient/use-chat-viewport')return load('components/patient/use-chat-viewport.ts');
  if(name==='next/link')return {default:(p:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement('a',p)};
  if(name==='next/navigation')return {unstable_rethrow:()=>{},useRouter:()=>({refresh:()=>{},push:()=>{throw Error('Home selections stay in chat');}})};
  if(name==='@/lib/staff/staff-locale-copy')return {st};
  if(name==='@/lib/staff/staff-server-copy')return {staffServerText};
  if(name==='@/lib/first-note/compose')return {FIRST_NOTE_BUILDER,FIRST_NOTE_VERSION};
  if(name==='@/lib/service-workflow/publication')return {regimenNameKey};
  if(name==='@/components/patient-care/regimen-changes')return {RegimenChanges,RegimenList};
  if(name==='@/lib/staff-zoe/contracts')return contracts;
  if(name==='@/lib/staff-zoe/home-intent')return {workspaceIntent};
  if(name==='@/lib/staff-zoe/home-actions')return {readDoctorHome:async(input:HomeRequest,expectedDoctor:string)=>{
   assert.equal(expectedDoctor,doctor);calls.push(structuredClone(input));
   if(input.kind==='day'&&deferredDay)return deferredDay;
   if(input.kind==='select'||input.kind==='record')return structuredClone(recordResponse);
   if(input.kind==='poll'&&response.kind==='day')return {kind:'poll',day:{...structuredClone(response.day),firstNotes:null},firstNoteCount:response.day.firstNotes?{version:'first-note-queue-count-v1',enabled:response.day.firstNotes.enabled,count:response.day.firstNotes.items.length}:null};
   if(input.kind==='day'&&response.kind==='day'&&denyFirstNoteDetails)return {kind:'day',day:{...structuredClone(response.day),firstNotes:null}};
   return structuredClone(response);
  }};
  if(name==='@/lib/staff/real-member-search-actions')return {searchRealMembers:()=>{throw Error('Home must use its gated action');}};
  if(name==='@/lib/staff-zoe/actions')return {openStaffZoe:()=>{throw Error('Home must use its gated selection');}};
  if(name==='@/lib/staff/alert-label')return alertLabel;
  if(name==='@/components/staff/alert-card')return {AlertCardLines};
  if(name==='@/lib/staff-zoe/facts')return staffFacts;
  if(name==='@/components/staff/zoe/cards')return zoeCards;
  if(name==='@/lib/staff/yerevan-time')return yerevanTime;
  if(name==='@/lib/care-alerts/contracts')return careAlertContracts;
  if(name==='@/lib/doctor-inbox/urgent-windows')return urgentWindows;
  if(name==='@/components/doctor-inbox/urgent-window')return cardModule('components/doctor-inbox/urgent-window.tsx');
  if(name==='@/components/patient-care/common')return patientCommon;
  if(name==='@/lib/ldl/status')return {formatMmol,formatPercent};
  if(name==='@/lib/staff-zoe/card-actions')return {readDoctorCard:async(input:unknown,expected:string)=>{assert.equal(expected,doctor);cardCalls.push(structuredClone(input));return cardRefused?{kind:'refused'}:deferredCard??structuredClone(cardResponse);}};
  if(name==='./record-card'&&realCards)return cardModule('components/staff/doctor-workspace/record-card.tsx');
  if(name==='./record-card')return {DoctorRecordCard:(p:{response:{kind:string};onReload:()=>void})=>React.createElement('section',{},`Opened record card: ${p.response.kind}`,React.createElement('button',{onClick:p.onReload},'Refresh'))};
  if(name==='@/lib/doctor-decisions/actions')return {pressDoctorItem:async(input:{revision:string})=>{itemPresses.push(input);return {status:'saved'};}};
  if(realCards){
   if(name==='./conversation-card')return {};
   if(name==='./alert-resolution')return cardModule('components/staff/doctor-workspace/alert-resolution.tsx');
   const components:Record<string,string>={
    './observations-card':'components/staff/doctor-workspace/observations-card.tsx',
    './card-reload':'components/staff/doctor-workspace/card-reload.tsx',
    '@/components/staff/record-refresh':'components/staff/record-refresh.tsx',
    '@/components/staff/member-documents':'components/staff/member-documents.tsx',
    '@/components/real-review/review-controls':'components/real-review/review-controls.tsx',
    '@/components/real-review/publish-confirmation':'components/real-review/publish-confirmation.tsx',
    './publish-confirmation':'components/real-review/publish-confirmation.tsx',
    './report-provenance':'components/real-review/report-provenance.tsx',
    './required-evidence':'components/real-review/required-evidence.tsx',
   };
   if(components[name])return cardModule(components[name]);
   const libraries:Record<string,unknown>={'@/lib/reports/schema':reportSchema,'@/lib/patient-care/clinical-review-schema':reviewSchema,'@/lib/patient-care/required-evidence':requiredEvidence,'@/lib/patient-care/regimen':regimen,'@/lib/patient-care/required-lab-match':requiredLabMatch,'@/lib/locale':localeCopy,'@/lib/doctor-completion/document-schema':documentSchema,'@/lib/staff/yerevan-time':yerevanTime};
   if(name==='@/components/patient-care/common')return patientCommon;
   if(libraries[name])return libraries[name];
   if(name==='@/components/ui/select-field')return selectFieldNativeStub;
   if(name==='@/lib/doctor-completion/document-actions')return {recordMemberDocumentRelease:()=>{throw Error('No document may be released by this check');}};
   if(name==='@/lib/staff-zoe/everyday-actions')return {doctorWorkspaceCareCommand:async()=>({ok:true}),resolveDoctorCardAlert:async()=>alertResult};
   if(name==='@/lib/staff/care-command-schema')return {nativeCareCommandSchema};
   if(name==='@/lib/patient/measured-at')return {isFutureMeasurement};
   if(name==='@/lib/patient/bp-provenance')return bpProvenance;
   if(name==='./shell')return {buttonClass:''};
   if(name==='@/components/staff/bp-high-warning')return {BpHighWarning:()=>null};
   if(name==='./lab-ai-status')return {LabAiStatus:()=>null};
   if(name==='@/lib/patient-care/clinical-review-actions')return {realClinicalCommand:()=>{throw Error('No receipt may be saved by this check');}};
   // Other card kinds are outside this results-card regression. Never load their server actions.
   if(/(?:actions|everyday-actions|lab-ai-check|member-uploads|member-safety-panel|real-coordination-tasks|gp-report-panel|ldl-goal-panel)$/.test(name))return {};
   if(name==='./regimen')return {};
  }
  if(name==='./home-presentation')return homePresentation;
  if(name==='@/components/staff/empty-chat')return emptyChat;
  if(name==='@/components/clinic-portal/menu')return load('components/clinic-portal/menu.tsx');
  if(name==='@/lib/locale')return localeCopy;
  if(name==='@/components/patient/zoe-kit/thread')return kitThread;
  if(name==='./day-cards')return dayCards;
  if(name==='./member-list')return load('components/staff/doctor-workspace/member-list.tsx');
  if(name==='./glance')return {WorkspaceGlance:()=>React.createElement('p',{},'Glance card')};
  if(name==='./decisions')return load('components/staff/doctor-workspace/decisions.tsx');
  if(name==='@/components/staff/bp-high-warning')return {BpHighWarning:()=>null};
  if(name==='./approval-cards')return load('components/staff/doctor-workspace/approval-cards.tsx');
  if(name==='@/lib/first-note/actions')return {approveFirstNote:async()=>({status:'outcome-unknown'})};
  if(name==='@/lib/patient-care/clinical-review-actions')return {checkRealClinicalCaseAvailability:async()=>({ok:true,message:''})};
  if(name==='@/lib/doctor-decisions/approval-actions')return {pressClinicalCard:async()=>({ok:false})};
  if(name==='@/app/staff/real/conversation/actions')return {composeConversationReply:async()=>({ok:true}),commandConversation:async()=>({ok:true})};
  if(name==='@/components/staff/bp-readings-history')return {BpReadingsHistory:()=>React.createElement('p',{},'Existing BP chart')};
  if(name==='@/components/member-history/progress-charts')return {ProgressCharts:()=>React.createElement('p',{},'Existing measurement charts')};
  if(name==='@/components/staff/zoe/staff-zoe-pane')return {StaffZoeChat:(p:{conversation:{member:{name:string}};onWorkspaceAsk:(q:string)=>Promise<boolean>;decisions?:React.ReactNode})=>React.createElement('div',{},p.conversation.member.name,p.decisions,React.createElement('button',{onClick:()=>p.onWorkspaceAsk('BP chart')},'Ask BP chart'))};
  if(name==='@/components/staff/nurse-handoffs')return {NurseHandoffs:()=>React.createElement('section',{},'Nurse handoffs')};
  if(name==='@/lib/staff-zoe/outcome-copy')return outcomeCopy;
  return require(name);
 }});
 return exports;
}
const Home=load('components/staff/doctor-workspace/home-thread.tsx').DoctorHomeThread as React.ComponentType<{initial:HomeResponse;selected:HomeResponse|null;locale:'en'|'hy'|'ru';doctorId:string;decisionsEnabled:boolean}>;
for(const locale of ['en','hy','ru']as const){
 const html=renderToStaticMarkup(React.createElement(Home,{initial,selected:null,doctorId:doctor,locale,decisionsEnabled:false}));
 assert.ok(!html.includes('dw-home-queries'),'Landing has no navigation chip rows');
 assert.ok(!html.includes('dw-day-summary'),'Day summary is opened on request');
 assert.ok(!html.includes('data-day-item'),'Ordinary queues stay out of the landing');
 assert.ok(!html.includes('Open decision card'),'Disabled decisions open existing pages');
 assert.ok(!html.includes('undefined'));
}
const emptyDay:HomeResponse={kind:'day',day:{...initial.day,windows:[],urgentWindowsTotal:0,urgentCapped:false,inbox:{...initial.day.inbox,p0:[],p0Total:0,items:[],unavailable:[]},firstNotes:{version:'first-note-queue-v1',enabled:true,items:[],closed:[]},ldl:[],medicines:[],tasks:{items:[],hasMore:false},handoffs:{items:[],hasMore:false}}};
for(const [locale,line] of [['en','Nothing needs your attention right now.'],['hy','Այս պահին ոչինչ ձեր ուշադրության կարիքը չունի։'],['ru','Сейчас ничто не требует вашего внимания.']] as const){
 const props={initial:emptyDay,selected:null,doctorId:doctor,locale,decisionsEnabled:false};
 const html=renderToStaticMarkup(React.createElement(Home,props));
 assert.ok(html.includes(line)&&html.includes('zk-from'),'An empty doctor landing has a localized Zoe turn');
 assert.ok(html.includes(({en:'Ask Zoe…',hy:'Հարցրեք Զոյային…',ru:'Спросите Zoe…'})[locale]),'The doctor composer uses the resolved locale');
 for(const initial of [{kind:'unavailable'} as const,{...emptyDay,day:{...emptyDay.day,ldl:null}},{...emptyDay,day:{...emptyDay.day,urgentCapped:true}}]){
  assert.ok(!renderToStaticMarkup(React.createElement(Home,{...props,initial})).includes(line),'Failed reads never claim nothing is waiting');
 }
 assert.ok(!renderToStaticMarkup(React.createElement(Home,{...props,selected})).includes(line),'A selected member does not get the empty landing');
}
const windowOnlyDay:HomeResponse={kind:'day',day:{...emptyDay.day,windows:[{memberId:member,memberName:'Fictional window member',since:at,openedBy:'rule'}],urgentWindowsTotal:1,urgentCapped:false}};
for(const locale of ['en','hy','ru'] as const){
 const html=renderToStaticMarkup(React.createElement(Home,{initial:windowOnlyDay,selected:null,doctorId:doctor,locale,decisionsEnabled:false}));
 assert.match(html,/data-urgent-count="1"/,'A window-only member triggers the classic urgent banner with the shared count');
 assert.match(html,/href="\/staff\/real\/alerts"/,'The urgent banner opens actionable work');
 assert.equal(dayCards.dayItems(windowOnlyDay.day,locale).length,1);
}
const partialDay:HomeResponse={...initial,day:{...initial.day,inbox:{...initial.day.inbox,p0:[],p0Total:0,unavailable:['alerts']}}};
const partialHtml=renderToStaticMarkup(React.createElement(Home,{initial:partialDay,selected,doctorId:doctor,locale:'en',decisionsEnabled:true}));
assert.ok(partialHtml.includes('Some sources are unavailable'),'Selected members retain partial queue failure warnings');
assert.ok(partialHtml.includes('role="alert"'));
const refusedHtml=renderToStaticMarkup(React.createElement(Home,{initial,selected:{kind:'refused'},doctorId:doctor,locale:'en',decisionsEnabled:true}));
assert.ok(!refusedHtml.includes('You are up to date')&&!refusedHtml.includes('First note: approve by'),'A refused conversation must not show a successful day summary');
assert.equal((refusedHtml.match(/Your workspace could not be read/g)??[]).length,1,'A refused read has one clear message');
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,self:{setTimeout:()=>0}});
let renderer:TestRenderer.ReactTestRenderer;
await act(async()=>{renderer=TestRenderer.create(React.createElement(Home,{initial,selected:null,doctorId:doctor,locale:'en',decisionsEnabled:true}));});
const text=()=>JSON.stringify(renderer!.toJSON());
const button=(label:string)=>renderer!.root.findAllByType('button').find(b=>b.children.join('')===label)!;
assert.equal(delay,60_000,'Polling is once a minute');
response={kind:'members',query:'',page:{rows:[memberRow],hasMore:false,nextCursor:null}};
await act(async()=>{await button('Show my members').props.onClick();});
assert.deepEqual(calls.at(-1),{kind:'members',query:'',cursor:null});
await act(async()=>{await button('Show my members').props.onClick();});
const inputIds=renderer!.root.findAllByType('input').map(input=>input.props.id);
assert.equal(new Set(inputIds).size,inputIds.length,'Multiple list cards have distinct input labels');
const memberButton=renderer!.root.findAllByType('button').find(b=>b.findAllByType('span').some(s=>s.children.join('')==='Fictional member'))!;
await act(async()=>{await memberButton.props.onClick();});
assert.equal(calls.at(-1)?.kind,'select');assert.ok(text().includes('Fictional selected member'));
response=selected;
await act(async()=>{await button('Ask BP chart').props.onClick();});
assert.ok(text().includes('Existing BP chart'),'The contextual chart command stays in chat');
const oldCount=calls.length;
visibility='hidden';await act(async()=>{await tick!();});assert.equal(calls.length,oldCount,'Hidden tabs do not poll');
visibility='visible';
const newDay=structuredClone(initial);
if(newDay.kind==='day')newDay.day.inbox.items.push({...baseItem,id:'reply:new',kind:'reply_draft',lane:'P1',confidence:'rule',ai:'none'});
// Poll queue and selected record independently, as the real action does.
response=newDay;
const waitingLink=()=>renderer!.root.findAllByType('button').find(a=>a.children.join('').includes('waiting'));
const originalWaiting=dayCards.dayStatus(initial.day,'en').counts.total;
await act(async()=>{await tick!();});
assert.equal(waitingLink()?.children.join(''),`${originalWaiting+1} waiting`,'New work remains visible with a member open, before Today is opened');
assert.ok(text().includes('Fictional selected member'),'Polling keeps the selected member open');
assert.equal(renderer!.root.findAll(n=>n.props['data-day-item']==='reply:new').length,0,'The compact notification does not open Today');
assert.ok(renderer!.root.findAllByProps({role:'status'}).some(n=>n.findAllByType('button').some(a=>a===waitingLink())),'Waiting counts are announced live');
// Deselect by using a new home instance for notification checks.
await act(async()=>{renderer!.unmount();renderer=TestRenderer.create(React.createElement(Home,{initial,selected:null,doctorId:doctor,locale:'en',decisionsEnabled:false}));});
response=initial;await act(async()=>{await button('Today').props.onClick();});response=newDay;
const beforePoll=calls.length;
await act(async()=>{await tick!();});
assert.equal(calls[beforePoll]?.kind,'poll','Automatic polling uses the count-only first-note read');
assert.ok(!calls.slice(beforePoll).some(r=>r.kind==='day'),'Unchanged first-note counts do not re-read member details');
assert.ok(text().includes('First note: approve by'),'Already audited first-note cards remain visible');
assert.ok(text().includes('New items arrived'));
assert.equal(renderer!.root.findAll(n=>n.props['data-day-item']==='reply:new').length,1,'A new item is appended once, without duplicating its current card');
await act(async()=>{await tick!();});
assert.equal(renderer!.root.findAll(n=>n.props['data-day-item']==='reply:new').length,1,'Unchanged polls do not append duplicates');
if(newDay.kind==='day')newDay.day.inbox.items[0].unanswered=3;
response=newDay;await act(async()=>{await tick!();});
assert.equal(renderer!.root.findAll(n=>n.props['data-day-item']==='reply:1').length,1,'A second message on the same waiting thread is notified without duplicating the card');
assert.ok(text().includes('Messages waiting: 3'));
if(newDay.kind==='day'&&newDay.day.firstNotes){newDay.day.firstNotes.items.push({memberId:other,memberName:'New first-note-only member',doctorName:null,completedAt:at,dueAt:at});}
response=newDay;const beforeChangedCount=calls.length;await act(async()=>{await tick!();});
assert.ok(calls.slice(beforeChangedCount).some(r=>r.kind==='day'),'A changed count fetches audited first-note details');
assert.ok(text().includes('New first-note-only member'));
if(newDay.kind==='day'&&newDay.day.firstNotes)newDay.day.firstNotes.items.pop();
denyFirstNoteDetails=true;response=newDay;await act(async()=>{await tick!();});
assert.ok(!text().includes('First note: approve by'),'A failed audit on the detail refresh exposes no first-note cards');
assert.ok(text().includes('Some sources are unavailable'));
denyFirstNoteDetails=false;
if(newDay.kind==='day')newDay.day.firstNotes=null;
response=newDay;await act(async()=>{await tick!();});
assert.ok(!text().includes('New first-note-only member'),'A failed count removes previously displayed first-note details');
assert.ok(text().includes('Some sources are unavailable'));
response={kind:'refused'};await act(async()=>{await tick!();});
assert.ok(!text().includes('Fictional member'),'Access failure clears previously displayed home data');
assert.ok(text().includes('Your workspace could not be read'));
assert.equal(delay,60_000,'A failed poll still schedules recovery');
response=initial;await act(async()=>{await tick!();});assert.ok(text().includes('Fictional member'),'Polling recovers after a temporary failure');
await act(async()=>{renderer!.unmount();});
console.log('Doctor home actual thread: locales, opening counts, list/selection, chart routing, visible polling, deduplication, access clearing and recovery passed (controlled IO)');

// Real approval cards keep authored text and frozen outcomes during count-only polling.
const approvalData:WorkspaceDecisions={items:[],reply:null,approvals:{regimen:null,consultation:null,firstNote:{
 context:{memberId:member,revision:4,evidenceToken:'a'.repeat(32),appointmentsRevision:'b'.repeat(32)},submissionId:other,assessmentRevision:3,
 data:{version:'first-note-v1',enabled:true,completedAt:at,dueAt:at,urgent:false,planActive:false,note:null},
 draft:{text:{en:'Original note',hy:'Հայերեն գրառում'},sources:[]},
}}};
const cardSelected:HomeResponse={...selected,decisions:approvalData};
response=initial;recordResponse=cardSelected;
await act(async()=>{renderer=TestRenderer.create(React.createElement(Home,{initial,selected:cardSelected,doctorId:doctor,locale:'en',decisionsEnabled:true}));});
const english=()=>renderer!.root.findAllByType('textarea').find(t=>t.props.lang==='en')!;
await act(async()=>english().props.onChange({target:{value:'Doctor edited exact note'}}));
const editPoll=calls.length;
await act(async()=>{await tick!();});
assert.ok(calls.slice(editPoll).some(r=>r.kind==='poll'),'Queue counts still poll during an edit');
assert.ok(!calls.slice(editPoll).some(r=>r.kind==='record'),'Background polling never competes for a displayed card case lock');
assert.equal(english().props.value,'Doctor edited exact note','Polling preserves authored text');
await act(async()=>renderer!.root.findAllByType('form')[0].props.onSubmit({preventDefault(){}}));
assert.equal(button('Approve and show this note').props.disabled,true,'An unknown approval outcome freezes the card');
await act(async()=>{await tick!();});
assert.equal(button('Approve and show this note').props.disabled,true,'Polling cannot reactivate a frozen approval');
await act(async()=>button('Refresh').props.onClick());
assert.equal(button('Approve and show this note').props.disabled,false,'Explicit successful reload resets even unchanged context');
assert.equal(english().props.value,'Original note');
await act(async()=>renderer!.root.findAllByType('form')[0].props.onSubmit({preventDefault(){}}));
recordResponse={kind:'unavailable'};
await act(async()=>button('Refresh').props.onClick());
assert.equal(button('Approve and show this note').props.disabled,true,'A failed read cannot reactivate the old card');
recordResponse=cardSelected;
await act(async()=>button('Refresh').props.onClick());
assert.equal(button('Approve and show this note').props.disabled,false);
await act(async()=>renderer!.unmount());recordResponse=selected;
console.log('Doctor home edited approval polling, frozen outcomes and explicit reload recovery passed (controlled IO).');

// The filtered list retains the audited source page's cursor, including when no rows on that page match.
const sourcePage={rows:[memberRow],hasMore:true,nextCursor:{id:member,createdAt:at}};
const searches:unknown[]=[];
const List=load('components/staff/doctor-workspace/member-list.tsx').WorkspaceMemberList as React.ComponentType<{initialPage:typeof sourcePage;initialQuery:string;includeIds:string[];locale:'en';onSelect:()=>void;searchAction:(v:unknown)=>Promise<unknown>}>;
await act(async()=>{renderer=TestRenderer.create(React.createElement(List,{initialPage:sourcePage,initialQuery:'Fictional',includeIds:[],locale:'en',onSelect:()=>{},searchAction:async input=>{searches.push(structuredClone(input));return {ok:true,page:sourcePage};}}));});
assert.ok(text().includes('No assigned members on this page match'));
await act(async()=>{await button('Next members').props.onClick();});
assert.deepEqual(searches[0],{query:'Fictional',cursor:sourcePage.nextCursor},'Paging never widens the original search or loses a hidden boundary');
await act(async()=>{renderer!.unmount();});
console.log('Home member cards: unique labels, initial search preservation and empty filtered-page paging passed');

// One reply editor opens inline; decisions still refresh from authoritative reads.
const prepare={memberId:member,expectedVersion:1,expectedClinicalRevision:1,expectedDraftEpoch:0,expectedSource:'source'};
const decisionRecord:HomeResponse={...selected,decisions:{items:[],reply:{card:null,prepare},approvals:null}};
recordResponse=decisionRecord;
await act(async()=>{renderer=TestRenderer.create(React.createElement(Home,{initial,selected:decisionRecord,doctorId:doctor,locale:'en',decisionsEnabled:true}));});
assert.equal(renderer!.root.findAllByType('textarea').length,0,'No duplicate reply form in decision cards');
await act(async()=>button('Open conversation and reply').props.onClick());
assert.deepEqual(cardCalls.at(-1),{card:'conversation',conversationId:other});
assert.ok(text().includes('Opened record card: off'));
await act(async()=>renderer!.unmount());
const replyCard:NonNullable<NonNullable<WorkspaceDecisions['reply']>['card']>={memberId:member,draftId:other,revision:1,body:'Saved reply',author:'staff',summary:'Private summary',contentHash:'hash',intentId:'a'.repeat(32),requestId:'b'.repeat(32),takeover:false,modeRevision:'c'.repeat(32)};
recordResponse={...selected,decisions:{items:[],reply:{card:replyCard,prepare:null},approvals:null}};
await act(async()=>{renderer=TestRenderer.create(React.createElement(Home,{initial,selected:decisionRecord,doctorId:doctor,locale:'en',decisionsEnabled:true}));});
await act(async()=>button('Refresh').props.onClick());
assert.ok(text().includes('Saved reply'),'Refresh immediately replaces decisions without polling');
recordResponse={kind:'refused'};
await act(async()=>button('Refresh').props.onClick());
assert.ok(!text().includes('Saved reply'),'Refused refresh clears member details');
assert.ok(text().includes('Your workspace could not be read'));
await act(async()=>renderer!.unmount());

// A refresh in flight cannot reopen the previous member after navigation.
recordResponse=decisionRecord;response=initial;
await act(async()=>{renderer=TestRenderer.create(React.createElement(Home,{initial,selected:decisionRecord,doctorId:doctor,locale:'en',decisionsEnabled:true}));});
let resolveDay!:(value:HomeResponse)=>void;
deferredDay=new Promise(resolve=>{resolveDay=resolve;});
let pendingRefresh:Promise<void>|undefined;
await act(async()=>{pendingRefresh=button('Refresh').props.onClick();});
const beforeChangingMember=calls.length;
await act(async()=>button('Change member').props.onClick());
await act(async()=>{resolveDay(initial);await pendingRefresh;});
deferredDay=null;
assert.ok(!calls.slice(beforeChangingMember).some(call=>call.kind==='record'),'An older refresh never starts a new record request after member navigation');
assert.ok(!text().includes('Fictional selected member'),'Change member stays clear after a pending refresh finishes');
await act(async()=>renderer!.unmount());

// Navigation-only card entry points run the mounted-actor action without mutating decisions.
recordResponse=selected;response=initial;
await act(async()=>{renderer=TestRenderer.create(React.createElement(Home,{initial,selected,doctorId:doctor,locale:'en',decisionsEnabled:true}));});
await act(async()=>{await button('Show results').props.onClick();});
assert.deepEqual(cardCalls.at(-1),{card:'results',conversationId:other});
assert.ok(text().includes('Opened record card: off'));
recordResponse={...selected,decisions:{items:[],reply:{card:null,prepare:{memberId:member,expectedVersion:7,expectedClinicalRevision:7,expectedDraftEpoch:0,expectedSource:'after-save'}},approvals:null}};
const beforeRecordRefresh=calls.length;
await act(async()=>button('Refresh').props.onClick());
assert.ok(calls.slice(beforeRecordRefresh).some(r=>r.kind==='record'),'A record-card refresh also reads current decision cards');
assert.ok(!text().includes('Prepare your reply'),'An open record card hides the duplicate decision editor');
recordResponse=selected;
const previousCardReload=button('Refresh').props.onClick;
await act(async()=>{await button('Open alerts').props.onClick();});
assert.deepEqual(cardCalls.at(-1),{card:'alerts'});
const afterSwitch=cardCalls.length;
await act(async()=>{await previousCardReload();});
assert.equal(cardCalls.length,afterSwitch,'A delayed refresh from a closed card cannot reopen it under another context');
cardRefused=true;
await act(async()=>{await button('Refresh').props.onClick();});
assert.ok(!text().includes('Fictional selected member'),'Card access loss clears the selected member');
await act(async()=>renderer!.unmount());cardRefused=false;
// A named request uses the audited search and carries the requested card through selection.
response={kind:'members',query:'Anna',page:{rows:[{...memberRow,name:'Anna'}],hasMore:false,nextCursor:null}};
await act(async()=>{renderer=TestRenderer.create(React.createElement(Home,{initial,selected:null,doctorId:doctor,locale:'en',decisionsEnabled:true}));});
await act(async()=>renderer!.root.findByProps({id:'doctor-home-ask'}).props.onChange({target:{value:"show Anna's results"}}));
await act(async()=>{await renderer!.root.findByType('form').props.onSubmit({preventDefault(){}});});
assert.deepEqual(cardCalls.at(-1),{card:'results',conversationId:other});
assert.ok(text().includes('Fictional selected member'));
await act(async()=>renderer!.unmount());
// Ambiguous names require an explicit choice, preserving the target across the list.
response={kind:'members',query:'Anna',page:{rows:[{...memberRow,name:'Anna One'},{...memberRow,id:other,name:'Anna Two'}],hasMore:false,nextCursor:null}};
const beforeAmbiguous=cardCalls.length;
await act(async()=>{renderer=TestRenderer.create(React.createElement(Home,{initial,selected:null,doctorId:doctor,locale:'en',decisionsEnabled:true}));});
await act(async()=>renderer!.root.findByProps({id:'doctor-home-ask'}).props.onChange({target:{value:"show Anna's results"}}));
await act(async()=>{await renderer!.root.findByType('form').props.onSubmit({preventDefault(){}});});
assert.equal(cardCalls.length,beforeAmbiguous,'No guessed member on ambiguous matches');
const choose=renderer!.root.findAllByType('button').find(b=>b.findAllByType('span').some(s=>s.children.join('')==='Anna Two'))!;
await act(async()=>{await choose.props.onClick();});
assert.deepEqual(cardCalls.at(-1),{card:'results',conversationId:other});
await act(async()=>renderer!.unmount());
console.log('Card entry: selected record, global alerts, denied reload, named results and explicit ambiguous-name selection passed (controlled IO)');

// DC-01: a PDF-open refresh must reconcile the actual results controls in place.
realCards=true;response=initial;recordResponse=selected;
const ResultsHome=load('components/staff/doctor-workspace/home-thread.tsx').DoctorHomeThread as typeof Home;
const fileId='44444444-4444-4444-8444-444444444444';
const snapshot:Extract<DoctorCardResponse,{card:'results'}>['snapshot']={
 id:member,revision:1,evidenceToken:'current',draft:null,draftSavedAt:null,draftStale:false,
 evidence:{visits:[],profile:{name:'Fictional member',birthDate:null,biologicalSex:null},consent:null,assessment:{revision:1,completed_at:'2026-10-30T09:00:00Z',urgent_rule:null,answers:{}},measurements:[],reports:[]},
 review:{evidenceToken:'current',doctorId:doctor,preparedAt:at,engine:{version:'test',urgency:'green',tests:[{id:'tsh',title:'TSH',method:'lab'}]},approvals:{},receipts:{},consultation:{decision:'undecided'}},
};
cardResponse={kind:'ready',card:'results',values:undefined,memberId:member,conversationId:other,snapshot,completion:true,requiredEvidence:null,lab:undefined,
 documents:{version:'member-documents-v1',enabled:true,documents:[{fileId,name:'Fictional.pdf',clinic:'Example clinic',uploadedAt:at,attachedAt:at,released:false,releasedAt:null,openedByYou:true}]},
 clinicLab:[member,other].map((attachmentId,i)=>({attachmentId,fileId,fileName:`Lab ${i+1}.pdf`,clinic:'Example clinic',attachedAt:at,values:[{id:fileId,seq:1,reviewedAt:at,name:'TSH',valueText:'1',value:1,laboratory:null,unit:null,collectedOn:'2026-10-31',reference:null}]})),
};
await act(async()=>{renderer=TestRenderer.create(React.createElement(ResultsHome,{initial,selected,doctorId:doctor,locale:'en',decisionsEnabled:true}));});
await act(async()=>button('Show results').props.onClick());
// Each confirmed file has its own receipt form and a hidden manual note.
const receiptForm=(attachmentId:string)=>renderer!.root.findAllByType('form').find(form=>form.findAllByType('input').some(input=>input.props.name==='operation'&&input.props.value==='receive-all-clinic-results')&&form.findAllByType('input').some(input=>input.props.name==='attachmentId'&&input.props.value===attachmentId))!;
const receiptNote=(attachmentId=other)=>receiptForm(attachmentId).findByType('textarea');
const editSelection=(attachmentId:string)=>receiptForm(attachmentId).findByType('details');
assert.ok(!editSelection(member).props.open,'Manual recording starts inside a closed disclosure');
assert.ok(receiptForm(member).findAllByType('fieldset').some(fieldset=>fieldset.props.disabled),'Hidden manual inputs cannot block or submit with the quick action');
assert.equal(receiptNote(member).props.name,undefined,'The hidden manual note is excluded from the quick action');
await act(async()=>editSelection(member).props.onToggle({currentTarget:{open:true}}));
const cleanNote=receiptNote(member);
assert.equal(cleanNote.props.name,'note');
assert.equal(cleanNote.props.required,true,'A covered result still requires a receipt note');
const cleanConfirmation=receiptForm(member).findAllByType('input').find(i=>i.props.name==='sourceChecked')!;
assert.equal(cleanConfirmation.props.required,true,'Recording still requires explicit source confirmation');
assert.ok(!cleanConfirmation.props.defaultChecked&&!cleanConfirmation.props.checked,'Source confirmation starts unchecked');
await act(async()=>button('Refresh').props.onClick());
assert.equal(button('Clear entries and reload'),undefined,'An untouched card reloads without a discard warning');
assert.notEqual(receiptNote(member),cleanNote,'The clean reload actually reads a new snapshot');
assert.ok(!renderer!.root.findAll(n=>n.props.role==='status').some(n=>n.children.filter(c=>typeof c==='string').join('').includes('Saved.')),'A read-only reload never claims a save');
const editedField={tagName:'TEXTAREA',value:'Draft to clear',defaultValue:''};
const captureEdit=()=>renderer!.root.find(n=>n.props.className==='dw-record-card space-y-3 rounded-xl border bg-background p-3').props.onChangeCapture({target:editedField});
await act(async()=>captureEdit());
editedField.value='';await act(async()=>captureEdit());
await act(async()=>button('Refresh').props.onClick());
assert.equal(button('Clear entries and reload'),undefined,'Clearing typed text removes the discard warning');
await act(async()=>editSelection(other).props.onToggle({currentTarget:{open:true}}));
const note=receiptNote();
const sourceCheck=receiptForm(other).findAllByType('input').find(i=>i.props.name==='sourceChecked')!;
const valueCheck=receiptForm(other).findAllByType('input').find(i=>i.props.name==='valueIds')!;
const documentConfirmation=()=>renderer!.root.findAllByType('input').find(i=>i.props.id===`document-confirm-${fileId}`)!;
await act(async()=>documentConfirmation().props.onChange({target:{checked:true}}));
await act(async()=>renderer!.root.findAllByType('a').find(a=>a.children.join('')==='Open PDF')!.props.onClick());
assert.equal(delay,1500,'Opening the actual PDF link schedules its audited-open refresh');
const pdfRefresh=tick!;
let finishCard!:(r:DoctorCardResponse)=>void;
deferredCard=new Promise(resolve=>{finishCard=resolve;});
await act(async()=>{await pdfRefresh();});
assert.equal(receiptForm(other).findAllByType('textarea').length,1,'The receipt stays mounted while the PDF refresh is pending');
const refreshed=structuredClone(cardResponse);
if(refreshed.kind==='ready'&&refreshed.card==='results'&&refreshed.documents)refreshed.documents.documents[0].clinic='Refreshed clinic';
await act(async()=>finishCard(refreshed));deferredCard=null;
assert.ok(text().includes('Refreshed clinic'),'The refresh still applies new source data');
assert.equal(receiptNote(),note,'The uncontrolled receipt note field survives the refresh');
assert.equal(valueCheck.props.checked,true,'The chosen file value stays selected after refresh');
assert.equal(receiptForm(other).findAllByType('input').find(i=>i.props.name==='sourceChecked')!,sourceCheck);
assert.equal(receiptForm(other).findAllByType('input').find(i=>i.props.name==='valueIds')!,valueCheck);
assert.equal(documentConfirmation().props.checked,true,'The document confirmation survives the refresh');
assert.ok(!renderer!.root.findAll(n=>n.props.role==='status').some(n=>n.children.filter(c=>typeof c==='string').join('').includes('Saved.')),'A PDF-open audit never claims a save');
for(const failure of ['unavailable','thrown']as const){
 await act(async()=>renderer!.root.findAllByType('a').find(a=>a.children.join('')==='Open PDF')!.props.onClick());
 let rejectCard!:(error:Error)=>void;
 deferredCard=new Promise((resolve,reject)=>{finishCard=resolve;rejectCard=reject;});
 await act(async()=>{await tick!();});
 await act(async()=>{if(failure==='unavailable')finishCard({kind:'unavailable'});else rejectCard(new Error('Refresh failed'));});
 deferredCard=null;
 assert.equal(receiptForm(other).findAllByType('textarea').length,1,`${failure}: a failed PDF refresh keeps the receipt editor`);
 assert.equal(receiptNote(),note,`${failure}: the unsaved note field stays mounted`);
 assert.equal(valueCheck.props.checked,true,`${failure}: the chosen file value stays selected`);
 assert.equal(receiptForm(other).findAllByType('input').find(i=>i.props.name==='sourceChecked')!,sourceCheck,`${failure}: the source confirmation stays mounted`);
 assert.equal(receiptForm(other).findAllByType('input').find(i=>i.props.name==='valueIds')!,valueCheck,`${failure}: the value selection stays mounted`);
 assert.equal(documentConfirmation().props.checked,true,`${failure}: the document confirmation stays checked`);
 assert.ok(renderer!.root.findAll(n=>n.props.role==='status').some(n=>n.children.filter(c=>typeof c==='string').join('').includes('Refresh failed')),`${failure}: a small refresh-failure message is shown`);
}
await act(async()=>renderer!.root.findAllByType('a').find(a=>a.children.join('')==='Open PDF')!.props.onClick());
await act(async()=>{await tick!();});
assert.equal(receiptNote(),note,'Retry after a failed refresh preserves the note field');
assert.ok(!text().includes('Refresh failed'),'A successful retry clears the refresh-failure message');
// TestRenderer has no native bubbling; deliver the edit capture from the real card boundary.
await act(async()=>renderer!.root.find(n=>n.props.className==='dw-record-card space-y-3 rounded-xl border bg-background p-3').props.onChangeCapture({target:{tagName:'TEXTAREA',value:'Unsaved receipt note',defaultValue:''}}));
await act(async()=>button('Refresh').props.onClick());
assert.equal(receiptNote(),note,'Reload must first protect the unsaved receipt note');
await act(async()=>button('Keep my entries').props.onClick());
assert.equal(receiptNote(),note,'Cancelling reload keeps the editor');
await act(async()=>button('Refresh').props.onClick());
await act(async()=>button('Clear entries and reload').props.onClick());
assert.notEqual(receiptNote(),note,'Confirmed reload resets the reviewed snapshot');
assert.equal(documentConfirmation().props.checked,false);
const staleRefresh=renderer!.root.findByType(cardModules.get('components/staff/doctor-workspace/record-card.tsx')!.DoctorRecordCard as React.ComponentType).props.onReload;
await act(async()=>button('Open alerts').props.onClick());
const beforeStaleRefresh=cardCalls.length;
await act(async()=>staleRefresh(true));
assert.equal(cardCalls.length,beforeStaleRefresh,'A delayed PDF refresh cannot reopen a card after navigation');
await act(async()=>button('Show results').props.onClick());
await act(async()=>renderer!.root.findAllByType('a').find(a=>a.children.join('')==='Open PDF')!.props.onClick());
cardRefused=true;
await act(async()=>{await tick!();});
assert.equal(renderer!.root.findAllByType('textarea').filter(n=>n.props.id!=='doctor-home-ask').length,0,'A refused PDF refresh still removes the receipt editor');
assert.ok(!text().includes('Fictional selected member'),'A refused PDF refresh still clears the selected member');
assert.ok(text().includes('Your workspace could not be read'));
cardRefused=false;
await act(async()=>renderer!.unmount());
console.log('DC-01: actual PDF link, pending/successful/unavailable/thrown refresh, retained receipt fields/selections/confirmations, retry, explicit reload and access-denial clearing passed (controlled IO).');
// The whole day remains available while a member conversation is selected.
const handoffInitial:HomeResponse={...initial,day:{...initial.day,handoffs:{items:[],hasMore:false}}};
response=handoffInitial;
await act(async()=>{renderer=TestRenderer.create(React.createElement(Home,{initial:handoffInitial,selected,doctorId:doctor,locale:'en',decisionsEnabled:false}));});
assert.ok(text().includes('Fictional selected member'));
assert.ok(!text().includes('Open nurse handoffs: 0'),'Zero handoffs are omitted');
assert.ok(!text().includes('Nurse handoffs'),'Selected member starts without day lists');
await act(async()=>{await button('Today').props.onClick();});
assert.ok(text().includes('Nurse handoffs'));
assert.equal(renderer!.root.findAll(n=>n.props['data-day-item']==='reply:1').length,1,'Menu Today keeps the whole-day queue reachable with a selected member');
const handoffs=renderer!.root.find(n=>typeof n.type==='function'&&n.type.name==='NurseHandoffs');
assert.equal(handoffs.props.actor.id,doctor);
assert.equal(handoffs.props.actor.role,'doctor');
const beforeHandoffRefresh=calls.length;
await act(async()=>{await handoffs.props.onChanged();});
assert.deepEqual(calls.slice(beforeHandoffRefresh),[{kind:'day'}],'Handoff changes explicitly refresh the day');
assert.ok(text().includes('Fictional selected member'),'Refreshing handoffs preserves the selected conversation');
await act(async()=>{renderer!.unmount();});
console.log('Home merge: whole-day queues, handoff counts and refresh remain available with a selected conversation (controlled IO)');

// A real observation save must refresh the decision revision before the next press.
const concern=initial.day.medicines![0];
const decision={kind:'medicine' as const,id:concern.id,memberId:member,revision:'a'.repeat(32),at,data:{kind:concern.kind,ask:concern.ask}};
const beforeSaveRecord={...selected,decisions:{items:[decision],reply:{card:null,prepare:null},approvals:null}};
recordResponse=beforeSaveRecord;
cardResponse={kind:'ready',card:'observations',memberId:member,conversationId:other,snapshot};
const scrollPosition=Object.assign(new EventTarget(),{scrollTop:812,scrollHeight:1600,clientHeight:600,children:[],querySelector:()=>null});
await act(async()=>{renderer=TestRenderer.create(React.createElement(ResultsHome,{initial,selected:beforeSaveRecord,doctorId:doctor,locale:'en',decisionsEnabled:true}),{createNodeMock:node=>(node.props as {className?:string}).className==='dw-home-scroll'?scrollPosition:null});});
await act(async()=>button('Record a note').props.onClick());
scrollPosition.scrollTop=812; // The doctor scrolls to the note before saving.
await act(async()=>renderer!.root.findByType('textarea').props.onChange({target:{value:'Fictional contact note'}}));
await act(async()=>renderer!.root.findAllByType('form').find(f=>f.findAllByType('textarea').length)!.props.onSubmit({preventDefault(){}}));
recordResponse={...beforeSaveRecord,decisions:{...beforeSaveRecord.decisions,items:[{...decision,revision:'b'.repeat(32)}]}};
cardResponse={...cardResponse,snapshot:{...snapshot,revision:2}};
const beforeObservationSave=calls.length;
let finishSaveRead!:(r:DoctorCardResponse)=>void;
deferredCard=new Promise(resolve=>{finishSaveRead=resolve;});
// TestRenderer has no native click bubbling or layout. Supply the pressed button's viewport bounds.
const homeSection=renderer!.root.findByProps({className:'dw-chat dw-home-thread'});
await act(async()=>homeSection.props.onClickCapture?.({target:{closest:()=>({getBoundingClientRect:()=>({top:600,left:48})})}}));
await act(async()=>button('Approve and save this observation').props.onClick());
assert.equal(renderer!.root.findAllByType('textarea').filter(n=>n.props.id!=='doctor-home-ask').length,1,'Saving keeps the card mounted while the new snapshot loads');
assert.ok(renderer!.root.findAll(n=>n.props.role==='status').some(n=>n.children.filter(c=>typeof c==='string').join('').includes('Saved')),'A confirmed save stays visible during refresh');
await act(async()=>finishSaveRead(structuredClone(cardResponse)));deferredCard=null;
assert.ok(renderer!.root.findAll(n=>n.props.role==='status').some(n=>n.children.filter(c=>typeof c==='string').join('').includes('Saved')),'Saved confirmation survives the refreshed card');
const savedLine=renderer!.root.findAllByType('p').find(p=>p.children.join('')==='Saved.')!;
assert.equal(savedLine.props.style?.top,600,'Save feedback stays beside the pressed button, rather than above the card');
assert.equal(savedLine.props.style?.left,48);
assert.ok(savedLine.props.className.includes('fixed'),'The saved line does not add height or move the scroll');
assert.equal(scrollPosition.scrollTop,812,'The saved snapshot preserves the existing scroll position');
await act(async()=>renderer!.root.findByProps({className:'dw-home-scroll'}).props.onScroll({currentTarget:scrollPosition}));
assert.ok(renderer!.root.findAllByType('p').some(p=>p.children.join('')==='Saved.'),'Restoring the same scroll position keeps the confirmation');
scrollPosition.scrollTop=800;
await act(async()=>renderer!.root.findByProps({className:'dw-home-scroll'}).props.onScroll({currentTarget:scrollPosition}));
assert.ok(!renderer!.root.findAllByType('p').some(p=>p.children.join('')==='Saved.'),'Scrolling dismisses feedback from the old press position');
assert.ok(calls.slice(beforeObservationSave).some(r=>r.kind==='record'),'Saving an actual observation re-reads decision snapshots');
await act(async()=>button('Mark this medicine concern handled').props.onClick());
assert.equal(itemPresses.at(-1)?.revision,'b'.repeat(32),'The first decision press after saving uses the current revision');
assert.ok(!text().includes('This card has changed'));
await act(async()=>renderer!.unmount());
console.log('Actual observation save refreshes the member decision revision before the next press (controlled IO).');

// Reloading decision/approval cards is a read, even inside a consultation card.
recordResponse=beforeSaveRecord;
cardResponse={kind:'ready',card:'consultation',memberId:member,conversationId:other,data:beforeSaveRecord.decisions};
await act(async()=>{renderer=TestRenderer.create(React.createElement(ResultsHome,{initial,selected:beforeSaveRecord,doctorId:doctor,locale:'en',decisionsEnabled:true}));});
await act(async()=>button('Open consultation').props.onClick());
await act(async()=>button('Refresh').props.onClick());
assert.ok(!renderer!.root.findAll(n=>n.props.role==='status').some(n=>n.children.filter(c=>typeof c==='string').join('').includes('Saved.')),'Refreshing decisions never claims a save');
await act(async()=>renderer!.unmount());

// A saved alert note stays on screen, while only unsaved sibling text needs protection.
const openAlert:careAlertContracts.CareAlert={id:member,memberId:member,memberName:'Fictional member',source:'message',priority:'urgent',reason:'urgent_words_matched',redFlags:[],state:'open',stateSeq:1,occurrences:1,createdAt:at,lastSeenAt:at,doctorName:null,acknowledgedAt:null,acknowledgedBy:null,resolvedAt:null,resolvedBy:null,resolution:null,resolutionNote:null,telegram:[]};
for(const locale of ['en','hy','ru'] as const){
 for(const scenario of ['window','alert failure','window failure','overlap'] as const){
  const hasAlert=scenario==='window failure'||scenario==='overlap';
  cardResponse={kind:'ready',card:'alerts',view:'live',inbox:{ok:true,role:'doctor',asOf:at,alerts:hasAlert?[openAlert]:[]},
   windows:hasAlert?[]:windowOnlyDay.day.windows,urgentTotal:1,incomplete:scenario.includes('failure'),capped:false};
  await act(async()=>{renderer=TestRenderer.create(React.createElement(ResultsHome,{initial:windowOnlyDay,selected:null,doctorId:doctor,locale,decisionsEnabled:false}));});
  await act(async()=>button(st(locale,'Open alerts','Բացել ահազանգերը','Открыть оповещения')).props.onClick());
  assert.equal(renderer!.root.findAll(n=>n.props['data-urgent-window']===member).length,hasAlert?0:1,'The actual Alerts card renders uncovered windows');
  assert.equal(renderer!.root.findAll(n=>n.type==='section'&&n.props['data-urgent-count']===1).length,1,'The card and banner use the same urgent count');
  for(const line of ['No alerts in this list.','Այս ցանկում ահազանգեր չկան։','В этом списке нет оповещений.'])assert.ok(!text().includes(line));
  if(scenario.includes('failure'))assert.ok(text().includes(st(locale,'This list is incomplete. Reload to check your urgent items.','Այս ցանկն ամբողջական չէ։ Թարմացրեք՝ ձեր շտապ գործերը ստուգելու համար։','Список неполный. Обновите его, чтобы проверить срочные задачи.')));
  await act(async()=>renderer!.unmount());
 }
 for(const capped of [false,true]){
  cardResponse={kind:'ready',card:'alerts',view:'live',inbox:{ok:true,role:'doctor',asOf:at,alerts:[]},windows:[],urgentTotal:0,incomplete:!capped,capped};
  await act(async()=>{renderer=TestRenderer.create(React.createElement(ResultsHome,{initial:emptyDay,selected:null,doctorId:doctor,locale,decisionsEnabled:false}));});
  await act(async()=>button(st(locale,'Open alerts','Բացել ահազանգերը','Открыть оповещения')).props.onClick());
  for(const line of ['No alerts in this list.','Այս ցանկում ահազանգեր չկան։','В этом списке нет оповещений.'])assert.ok(!text().includes(line),'A failed or capped card cannot reassure with an empty list');
  assert.ok(renderer!.root.findAll(n=>n.type==='p'&&n.props.role==='alert').length>0);
  await act(async()=>renderer!.unmount());
 }
}
console.log('Classic urgent windows: mounted Alerts card, independent failures, overlap and matching banner/card counts passed in en, hy and ru.');
cardResponse={kind:'ready',card:'alerts',view:'live',inbox:{ok:true,role:'doctor',asOf:at,alerts:[openAlert,{...openAlert,id:other}]},windows:[],urgentTotal:2,incomplete:false,capped:false};
await act(async()=>{renderer=TestRenderer.create(React.createElement(ResultsHome,{initial,selected:null,doctorId:doctor,locale:'en',decisionsEnabled:false}));});
await act(async()=>button('Open alerts').props.onClick());
const mountedAlertLines=renderer!.root.findAll(n=>typeof n.type==='string'&&n.props['data-alert-card']!==undefined);
assert.equal(mountedAlertLines.length,2,'Both workspace alerts use the shared card');
for(const card of mountedAlertLines)assert.equal(card.findAll(n=>typeof n.type==='string'&&n.props['data-alert-field']).length,5);
await act(async()=>{renderer!.root.findAllByType('button').filter(b=>b.children.join('')==='Resolve alert').forEach(b=>b.props.onClick());});
const firstForm=renderer!.root.findAllByType('form')[0];
const alertNotes=renderer!.root.findAllByType('textarea');
const savedText={tagName:'TEXTAREA',value:'Saved first alert note',defaultValue:'',form:{dataset:{get saved(){return firstForm.props['data-saved']?'true':undefined;}}}};
const unsavedText={tagName:'TEXTAREA',value:'Unsaved second alert note',defaultValue:''};
const captureAlert=(target:unknown)=>renderer!.root.find(n=>n.props.className==='dw-record-card space-y-3 rounded-xl border bg-background p-3').props.onChangeCapture({target});
await act(async()=>{alertNotes[0].props.onChange({target:{value:savedText.value}});captureAlert(savedText);alertNotes[1].props.onChange({target:{value:unsavedText.value}});captureAlert(unsavedText);});
await act(async()=>firstForm.findByType('select').props.onChange({target:{value:'member_contacted'}}));
await act(async()=>firstForm.props.onSubmit({preventDefault(){}}));
assert.equal(alertNotes[0].props.value,'Saved first alert note');
const alertStatuses=()=>renderer!.root.findAllByType('p').filter(p=>p.children[0]==='Open'||p.children[0]==='Resolved').map(p=>p.children[0]);
assert.deepEqual(alertStatuses(),['Resolved','Open'],'A saved alert updates its status without changing its open sibling');
alertResult={kind:'already_resolved',resolvedBy:'Doctor Earlier',resolvedAt:at};
const secondForm=renderer!.root.findAllByType('form')[1];
await act(async()=>secondForm.findByType('select').props.onChange({target:{value:'member_contacted'}}));
await act(async()=>secondForm.props.onSubmit({preventDefault(){}}));
assert.deepEqual(alertStatuses(),['Resolved','Resolved'],'A second-tab conflict replaces the stale status in the actual card');
assert.ok(text().includes('Already resolved by'));
assert.equal(alertNotes[1].props.value,'Unsaved second alert note','A conflict preserves the second tab note');
await act(async()=>button('Refresh').props.onClick());
assert.ok(button('Clear entries and reload'),'Saving one alert does not discard an unsaved sibling note');
await act(async()=>button('Keep my entries').props.onClick());
unsavedText.value='';await act(async()=>{alertNotes[1].props.onChange({target:{value:''}});captureAlert(unsavedText);});
const beforeCleanAlertReload=cardCalls.length;
await act(async()=>button('Refresh').props.onClick());
assert.equal(button('Clear entries and reload'),undefined,'An already saved alert note needs no discard warning');
assert.equal(cardCalls.length,beforeCleanAlertReload+1);
await act(async()=>renderer!.unmount());

// Desktop opens a long thread at its newest message too. Actual shared effects, supplied DOM geometry.
assert.equal(properties.size,0,'Desktop home leaves viewport geometry alone');
const dock={getBoundingClientRect:()=>({height:dockHeight})};
let dockHeight=179;
const box=Object.assign(new EventTarget(),{scrollHeight:1800,scrollTop:0,clientHeight:500,children:[{}],querySelector:()=>dock,style:{setProperty:(k:string,v:string)=>properties.set(k,v),removeProperty:(k:string)=>properties.delete(k)}});
await act(async()=>{renderer=TestRenderer.create(React.createElement(Home,{initial,selected:null,doctorId:doctor,locale:'en',decisionsEnabled:false}),{createNodeMock:node=>(node.props as {className?:string}).className==='dw-home-scroll'?box:null});});
const resizeBox=()=>resizes.filter(r=>r.active&&r.targets.includes(box)).forEach(r=>r.callback());
const resizeDock=()=>resizes.filter(r=>r.active&&r.targets.includes(dock)).forEach(r=>r.callback());
const settleContents=()=>resizes.filter(r=>r.active&&r.targets.includes(box.children[0])).forEach(r=>r.callback());
settleContents();assert.equal(box.scrollTop,1800,'Desktop opens at the newest message');
assert.equal(properties.get('--doctor-dock-height'),'179px','Space below the thread follows the actual dock');
dockHeight=73;resizeDock();
assert.equal(properties.get('--doctor-dock-height'),'73px','Collapsing typing controls releases space for messages');
await act(async()=>{phone=true;media.dispatchEvent(new Event('change'));});
assert.equal(properties.has('--chat-view-height'),false,'An unfocused phone uses CSS viewport height');
editing=true;doc.dispatchEvent(new Event('focusin'));
assert.equal(properties.get('--chat-view-height'),'700px','Focusing a phone field enables visual viewport geometry');
view.height=420;view.offsetTop=25;browser.scrollY=90;
view.dispatchEvent(new Event('resize'));
assert.equal(properties.get('--chat-view-height'),'420px');
assert.equal(properties.get('--chat-view-top'),'25px');
assert.equal(browser.scrollY,0,'Viewport updates clear Safari document scrolling');
box.scrollTop=1300;box.dispatchEvent(new Event('scroll'));
box.scrollHeight=2000;resizeBox();assert.equal(box.scrollTop,2000,'A viewport resize keeps a following thread at the newest message');
box.dispatchEvent(new Event('wheel'));box.scrollTop=300;box.dispatchEvent(new Event('scroll'));
resizeBox();settleContents();browser.dispatchEvent(new Event('pageshow'));doc.dispatchEvent(new Event('visibilitychange'));
assert.equal(box.scrollTop,300,'Scrolling up survives layout changes and app return');
box.dispatchEvent(new Event('wheel'));box.scrollTop=1500;box.dispatchEvent(new Event('scroll'));
browser.dispatchEvent(new Event('pageshow'));assert.equal(box.scrollTop,2000,'App return restores the newest message when following');
box.scrollTop=1500;doc.dispatchEvent(new Event('visibilitychange'));assert.equal(box.scrollTop,2000);
now=4000;box.scrollTop=1500;settleContents();assert.equal(box.scrollTop,1500,'Later content changes do not override card focus');
editing=false;doc.dispatchEvent(new Event('focusout'));
assert.equal(properties.has('--chat-view-height'),false,'Blur restores CSS viewport height');
await act(async()=>{phone=false;media.dispatchEvent(new Event('change'));});
assert.equal(properties.has('--chat-view-height'),false,'Desktop leaves viewport height to CSS');
box.scrollTop=1500;resizeBox();assert.equal(box.scrollTop,2000,'Desktop still follows the newest message');
await act(async()=>{phone=true;media.dispatchEvent(new Event('change'));});
editing=true;doc.dispatchEvent(new Event('focusin'));
assert.equal(properties.get('--chat-view-height'),'420px','Resizing back to phone enables focused viewport tracking');
await act(async()=>button('Open alerts').props.onClick());
box.scrollTop=600;resizeBox();browser.dispatchEvent(new Event('pageshow'));
assert.equal(box.scrollTop,600,'An open record card keeps its own focus and scroll rules');
await act(async()=>renderer!.unmount());
assert.equal(properties.size,0,'Leaving the doctor home cleans up geometry variables');
phone=false;editing=false;
console.log('Doctor thread: desktop and phone following, measured dock, focused viewport, scroll-up opt-out and card protection passed (supplied browser geometry).');

// Legacy Today must preserve the alert through both initial and polling paths.
for(const locale of ['en','hy','ru'] as const){
 const alert:careAlertContracts.CareAlert={id:other,memberId:member,memberName:'Fictional alert member',source:'message',priority:'urgent',reason:'future_reason_code',redFlags:[],state:'open',stateSeq:1,occurrences:1,createdAt:'2026-11-04T05:06:00Z',lastSeenAt:'2026-11-04T05:06:00Z',doctorName:null,acknowledgedAt:null,acknowledgedBy:null,resolvedAt:null,resolvedBy:null,resolution:null,resolutionNote:null,telegram:[]};
 const alertItem={...baseItem,id:`care_alert:${other}`,lane:'P0' as const,kind:'care_alert' as const,confidence:'rule' as const,ai:'none' as const,alert};
 const alertDay:HomeResponse={kind:'day',day:{...initial.day,inbox:{...initial.day.inbox,p0:[alertItem],p0Total:1}}};
 const today=st(locale,'Today','Այսօր','Сегодня');
 response=alertDay;realCards=false;
 await act(async()=>{renderer=TestRenderer.create(React.createElement(Home,{initial:alertDay,selected:null,doctorId:doctor,locale,decisionsEnabled:false}));});
 await act(async()=>button(today).props.onClick());
 const cards=()=>renderer!.root.findAll(n=>typeof n.type==='string'&&n.props['data-day-item']!==undefined&&n.props['data-day-item'].startsWith('care_alert:'));
 const cardText=(card:TestRenderer.ReactTestInstance):string=>card.children.map(c=>typeof c==='string'?c:cardText(c)).join(' ');
 const checkCard=(last:string,acknowledged:boolean)=>{
  assert.equal(cards().length,1,'Initial and new cards cannot duplicate an alert');
  const card=cards()[0],text=cardText(card);
  assert.equal(card.findAll(n=>typeof n.type==='string'&&n.props['data-alert-field']!==undefined).length,5);
  assert.doesNotMatch(text,/future[ _]reason[ _]code/i);
  assert.ok(text.includes(last));
  assert.equal(text.includes('Doctor Example'),acknowledged);
 };
 checkCard('09:06',false);
 response={...alertDay,day:{...alertDay.day,inbox:{...alertDay.day.inbox,p0:[{...alertItem,alert:{...alert,occurrences:3,lastSeenAt:'2026-11-04T07:08:00Z'}}]}}};
 await act(async()=>{await tick!();});
 checkCard('11:08',false);
 assert.ok(text().includes(st(locale,'New items arrived','Նոր տարրեր են ստացվել','Поступили новые элементы')));
 assert.ok(cardText(cards()[0]).includes('3'));
 response={...response,day:{...response.day,inbox:{...response.day.inbox,p0:[{...alertItem,alert:{...alert,occurrences:3,lastSeenAt:'2026-11-04T07:08:00Z',state:'acknowledged',acknowledgedBy:'Doctor Example'}}]}}};
 await act(async()=>{await tick!();});
 checkCard('11:08',true);
 await act(async()=>{await tick!();});
 checkCard('11:08',true);
 await act(async()=>renderer!.unmount());
 // Selecting the member is another consumer of the flattened day label.
 const summary=renderToStaticMarkup(React.createElement(Home,{initial:response,selected,doctorId:doctor,locale,decisionsEnabled:false}));
 assert.equal((summary.match(/data-alert-field=/g)??[]).length,5,'The member introduction uses the shared card too');
 assert.doesNotMatch(summary,/future[ _]reason[ _]code/i);
 // A newly created alert also enters the live notification, beyond changes to an existing id.
 await act(async()=>{renderer=TestRenderer.create(React.createElement(Home,{initial,selected:null,doctorId:doctor,locale,decisionsEnabled:false}));});
 response=initial;await act(async()=>button(today).props.onClick());
 response=alertDay;await act(async()=>{await tick!();});
 checkCard('09:06',false);
 const live=renderer!.root.findAllByProps({'aria-live':'polite'}).find(n=>n.findAllByProps({'data-day-item':alertItem.id}).length)!;
 assert.ok(live,'A newly arrived urgent alert is rendered in the live notification');
 await act(async()=>renderer!.unmount());
}
console.log('Legacy day cards: initial, polled repeats, acknowledgements, deduplication and member summary pass in en/hy/ru (mounted components, controlled IO).');
