/** Real experimental route with supplied auth/data boundaries. No credentials, storage or network. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import * as screen from '@/lib/zoe/member-screen';
import * as bpFlowModule from '@/lib/zoe-chat-actions/bp-flow';
import type {ZoeThread} from '@/lib/zoe/app-chat-contracts';
import {STAGE_CLASSES, STAGE_LINKS, type JourneyStage} from '@/lib/patient/journey-stage';
import {memberJourneyStep, type JourneyInput} from '@/lib/patient-care/journey-step';

const initial:ZoeThread={ok:true,version:2,ack:null,zoeReplies:false,settledSeq:1,messages:[{seq:1,text:'Synthetic question',at:'2026-11-01T10:00:00Z',channel:'app',requestId:null}],replies:[],answers:[]};
const profile={locale:'hy' as const,name:'Synthetic Member'};
const assessment={revision:17,answers:{},completedAt:null as string|null};
const intake={enabled:true,active:false};
const calls:string[]=[];
let registered=true,urgent=false,available=true,emergencyEnabled=true,intakeFails=false,promptFails=false;
let prompt={zoeScreen:true,directAnswers:false};
const env:{NOREON_MEMBER_CHAT_V2?:string}={};
const exports:Record<string,unknown>={};
const MemberChat=()=>null;
const cards={enabled:true,cards:[],clearedSeq:null};
const noCards={enabled:false,cards:[],clearedSeq:null};
const suggestionState={locale:'hy',consent:true,bpDue:true};
let v3=false;
let step=false;
let journeyFails=false;
let journey: {stage:JourneyStage;input:JourneyInput}|null=null;
const routeSource=readFileSync('app/patient/chat/page.tsx','utf8');
const code=ts.transpileModule(routeSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
new vm.Script(code,{filename:'app/patient/chat/page.tsx'}).runInNewContext({exports,process:{env},require(name:string){
 if(name==='react/jsx-runtime')return jsx;
 if(name==='@/lib/patient/page-title')return {memberPageMetadata:async()=>({title:'Synthetic'})};
 if(name==='@/lib/bp-photo/config')return {bpPhotoEnabled:()=>false};
 if(name==='@/lib/member-push/config')return {memberPushConfig:()=>null};
 if(name==='@/lib/zoe-chat-actions/voice')return {voiceAvailable:()=>false};
 if(name==='@/lib/patient/zoe-app-v3')return {zoeAppV3Enabled:()=>v3};
 if(name==='@/lib/patient/member-next-step')return {memberNextStepEnabled:()=>step};
 if(name==='@/lib/patient/journey-stage')return {STAGE_CLASSES,STAGE_LINKS};
 if(name==='@/lib/patient-care/journey-step')return {memberJourneyStep};
 if(name==='@/lib/patient/journey-read')return {readJourneyStage:async(member:unknown)=>{calls.push('journey');assert.equal((member as {assessment:unknown}).assessment,assessment);if(journeyFails)throw Error('Synthetic journey failure');return journey;}};
 if(name==='@/lib/zoe-chat-actions/server')return {readZoeCards:async()=>{calls.push('cards');return cards;}};
 if(name==='@/lib/zoe-chat-actions/registry')return {NO_CARDS:noCards};
 if(name==='@/lib/zoe-chat-actions/onboarding-read')return {readProfileOffer:async()=>null};
 if(name==='@/lib/chat/suggestion-read')return {readMemberSuggestionState:async()=>{calls.push('suggestions');return suggestionState;}};
 if(name==='next/navigation')return {notFound(){throw Error('not-found');},redirect(to:string){throw Error(`redirect:${to}`);}};
 if(name==='@/lib/patient/render-data')return {requireRegisteredForRender:async()=>{calls.push('registration');if(!registered)throw Error('redirect:/patient/profile');return {profile,assessment};}};
 if(name==='@/lib/patient/presentation')return {patientPresentation:(value:unknown)=>{assert.equal(value,assessment,'Existing presentation receives the registered assessment');calls.push('presentation');return {urgent};}};
 if(name==='@/app/patient/zoe/chat-access')return {readZoeAccess:async()=>{calls.push('access');return available?{kind:'chat',thread:initial}:{kind:'blocked',reason:'read_failed'};}};
 if(name==='@/lib/zoe/member')return {readZoePrompt:async()=>{calls.push('consent');if(promptFails)throw Error('Synthetic read failure');return prompt;}};
 if(name==='@/lib/zoe/app-chat')return {readIntakeState:async()=>{calls.push('intake');if(intakeFails)throw Error('Synthetic read failure');return intake;}};
 if(name==='@/lib/zoe/member-screen')return {zoeEmergencyCardEnabled:()=>emergencyEnabled,zoeEmergencyCheck:(value:screen.ZoeEmergencyCheck['intake'])=>screen.zoeEmergencyCheck(value,{NOREON_ZOE_EMERGENCY_CARD:'true',NOREON_ZOE_TEST_LEXICON:'true'})};
 if(name==='@/components/chat-v2/member-chat')return {MemberChat};
 if(name==='@/components/chat-v2/chat.css')return {};
 // WP F: caregiver and consents switches stay off here; their own checks cover them.
 if(name==='@/lib/caregivers/schema')return {caregiversEnabled:()=>false};
 if(name==='@/lib/consents/schema')return {memberConsentsEnabled:()=>false};
 if(name==='@/lib/caregivers/server')return {sessionCaregiverRpc:async()=>{throw Error('No caregiver read with the switch off');},readCaregiverInvitations:async()=>{throw Error('No caregiver read with the switch off');}};
 throw Error(`Unexpected route boundary: ${name}`);
}});
const page=exports.default as ()=>Promise<React.ReactElement<Record<string,unknown>>>;
for(const flag of [undefined,'','false','TRUE','1',' true ','True']){
 env.NOREON_MEMBER_CHAT_V2=flag;calls.length=0;
 await assert.rejects(page(),/not-found/);
 assert.deepEqual(calls,[],`Disabled ${String(flag)} stops before any member data read`);
}
env.NOREON_MEMBER_CHAT_V2='true';registered=false;calls.length=0;
await assert.rejects(page(),/redirect:\/patient\/profile$/);
assert.deepEqual(calls,['registration'],'Existing registration guard runs before other reads');
registered=true;urgent=true;emergencyEnabled=false;calls.length=0;
await assert.rejects(page(),/redirect:\/patient\/urgent$/);
assert.deepEqual(calls,['registration','presentation'],'Urgent registered assessment redirects before chat/consent/intake');
emergencyEnabled=true;
const urgentInline=await page();
assert.equal(urgentInline.props.assessment,assessment,'Inline emergency keeps the registered assessment for clinical guidance');
assert.equal(urgentInline.props.emergencyCard,true);
urgent=false;calls.length=0;
let result=await page();
assert.equal(result.type,MemberChat);
assert.equal(result.props.assessment,assessment,'Questionnaire uses the same registered assessment and saved answers');
assert.equal(result.props.initial,initial,'Existing access returns the same saved thread');
assert.equal(result.props.overview,false,'V3 off: no overview menu link');
assert.equal(result.props.locale,profile.locale);
assert.equal(result.props.memberName,profile.name);
assert.equal(result.props.revision,assessment.revision,'Language writes receive the registered revision');
assert.equal((result.props.consent as {directAnswers:boolean}).directAnswers,false,'Existing consent read controls the prompt');
assert.deepEqual((result.props.emergencyCheck as screen.ZoeEmergencyCheck).intake,intake,'Existing emergency helper receives the existing intake read');
assert.equal(result.props.cards,noCards,'V3 off: the page gets no cards');
assert.equal(result.props.voice,undefined,'V3 off: the page exposes no voice capability');
assert.equal((result.props.initial as ZoeThread).suggestionState,undefined,'V3 off: no suggestion read');
assert.deepEqual(calls,['registration','presentation','access','consent','intake'],'V3 off: nothing reads cards');
v3=true;step=true;calls.length=0;result=await page();
assert.equal(result.props.cards,cards,'V3 on: the page reads the same card payload as the old chat');
assert.equal((result.props.voice as {microphone:boolean}).microphone,false,'An unavailable provider keeps the mic disabled');
assert.equal(result.props.overview,true,'V3 on: the overview is offered alongside cards and next step');
assert.equal((result.props.initial as ZoeThread).suggestionState,suggestionState);
assert.deepEqual(calls,['registration','presentation','access','consent','intake','cards','suggestions']);
assert.equal(result.props.nextStep,undefined,'Incomplete questionnaire has no next step');
assert.equal(result.props.refreshOnComplete,true,'The next-step switch refreshes the saved completion without leaving chat');
assessment.completedAt='2026-11-03T09:00:00Z';
const journeyInput:JourneyInput={questionnaireComplete:true,review:null,appointments:[],clinics:{},canBook:true,hasOpenRequest:false,lab:null,planPublished:false,now:new Date('2026-11-03T10:00:00Z')};
journey={stage:'tests_to_choose',input:journeyInput};
calls.length=0;result=await page();
assert.equal(calls.filter(call=>call==='journey').length,1);
assert.deepEqual(JSON.parse(JSON.stringify(result.props.nextStep)),{stage:'tests_to_choose',text:STAGE_CLASSES.tests_to_choose,href:'/patient/service'},'Chat uses the saved stage sentence and Home action link');
journey={stage:'plan_published',input:{...journeyInput,planPublished:true}};
assert.equal(((await page()).props.nextStep as {href:unknown}).href,'/patient/care','A published plan links to the care page the home opens');
for(const stage of ['waiting','plan_confirmed'] as const){
 journey={stage,input:{...journeyInput,canBook:false,planPublished:stage==='plan_confirmed'}};
 const step=(await page()).props.nextStep as {stage:JourneyStage;href:unknown};
 assert.equal(step.stage,stage);assert.equal(step.href,null);
}
for(const failed of [false,true]){
 journey=null;journeyFails=failed;
 const step=(await page()).props.nextStep as {stage:null;text:Record<string,string>;href:string};
 assert.equal(step.stage,null);assert.equal(step.href,'/patient');
 assert.equal(step.text.en,'Not available right now. Your next step is on your home page.');
 for(const locale of ['hy','en','ru'])assert.ok(step.text[locale]);
}
journeyFails=false;step=false;calls.length=0;result=await page();
assert.equal(result.props.nextStep,undefined);assert.ok(!calls.includes('journey'),'Next-step switch off adds no journey read, with V3 on');
assert.equal(result.props.refreshOnComplete,undefined,'Next-step switch off preserves the original completion path');
v3=false;step=true;journey={stage:'booking_needed',input:journeyInput};calls.length=0;result=await page();
assert.equal(result.props.cards,noCards,'The next step does not need V3: no cards read');
assert.equal((result.props.nextStep as {stage:string}).stage,'booking_needed','The next step shows with V3 off');
v3=false;step=false;calls.length=0;result=await page();
assert.equal(result.props.nextStep,undefined);assert.ok(!calls.includes('journey'),'Both off adds no journey read');
v3=true;step=true;available=false;calls.length=0;result=await page();
assert.equal(result.props.nextStep,undefined);assert.ok(!calls.includes('journey'),'No chat access adds no journey read');
assessment.completedAt=null;available=true;
delete initial.suggestionState;
available=false;calls.length=0;result=await page();
assert.equal(result.props.cards,noCards,'V3 on but no chat: no cards');
assert.ok(!calls.includes('cards'));
available=true;v3=false;
for(const directAnswers of [false,true]){
 prompt={zoeScreen:true,directAnswers};result=await page();
 assert.equal((result.props.consent as {directAnswers:boolean}).directAnswers,directAnswers);
}
prompt={zoeScreen:false,directAnswers:true};
assert.equal((await page()).props.consent,null,'No extra consent prompt when existing Zoe prompt is absent');
promptFails=true;intakeFails=true;result=await page();
assert.equal(result.props.consent,null,'Consent read failure never invents consent');
assert.equal((result.props.emergencyCheck as screen.ZoeEmergencyCheck).intake,null,'Failed intake remains unknown for the shared emergency fallback');
promptFails=false;intakeFails=false;emergencyEnabled=false;calls.length=0;
assert.equal((await page()).props.emergencyCheck,null);
assert.ok(!calls.includes('intake'),'Disabled emergency flag does not read intake');
available=false;emergencyEnabled=true;calls.length=0;result=await page();
assert.equal(result.props.initial,null,'Unavailable access reaches the disabled composer state');
assert.equal(result.props.consent,null);
assert.equal(result.props.emergencyCheck,null);
assert.deepEqual(calls,['registration','presentation','access'],'Unavailable chat does not load prompt or intake');

// The new shell owns its view and scroll surfaces. Shared state/safety/consent stay reusable.
const viewFiles=['components/chat-v2/member-chat.tsx','components/chat-v2/menu.tsx','components/chat-v2/use-thread-scroll.ts','components/chat-v2/anamnesis.tsx','components/chat-v2/reading-card.tsx','components/chat-v2/dialog-turn.tsx'];
for(const path of ['app/patient/chat/page.tsx',...viewFiles]){
 const source=readFileSync(path,'utf8');
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,path.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const imports=ast.statements.filter(ts.isImportDeclaration).map(node=>(node.moduleSpecifier as ts.StringLiteral).text);
 for(const name of imports){
  assert.doesNotMatch(name,/(?:zoe-chat$|zoe-cards$|zoe-kit(?:\/|$)|patient-shell$|member-chat-menu$|member-chat\.css$|zoe-kit\.css$)/,`${path}: no previous shell or presentation import`);
  if(name.endsWith('.css'))assert.equal(name,'@/components/chat-v2/chat.css',`${path}: only the new scoped stylesheet`);
 }
 assert.doesNotMatch(source,/scrollIntoView\s*\(/,`${path}: no browser-driven ancestor scroll`);
 for(const match of source.matchAll(/\.focus\??\.?(\([^)]*\))/g))assert.match(match[1],/preventScroll:\s*true/,`${path}: programmatic focus preserves the scroll surface`);
}
const view=readFileSync(viewFiles[0],'utf8');
assert.match(view,/useZoeThread<HTMLTextAreaElement>/,'New shell consumes the real shared hook with a growing composer ref');
assert.equal((view.match(/<textarea\b/g)??[]).length,1,'The composer is one growing field');
assert.doesNotMatch(view,/<input\b/);
assert.match(view,/disabled=\{!initial \|\| locked \|\| voiceBusy\}/,'Unavailable thread disables the composer');
const css=readFileSync('components/chat-v2/chat.css','utf8');
assert.doesNotMatch(css,/@import|\.zk(?:\W|$)|\.member-chat(?:\W|$)/,'The new stylesheet does not import or style previous shells');
console.log('Chat v2: exact true gate before data, registered and urgent guards, shared thread/consent/emergency inputs, unavailable and failed-read paths; independent view/CSS and focus/scroll constraints pass. Real route, supplied IO.');

// Run the actual scroll hook with a single supplied scroll surface and browser events.
// This checks state/effects, not Safari geometry or keyboard behavior.
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
{
 const hook:Record<string,unknown>={};
 const browser=new EventTarget(),doc=Object.assign(new EventTarget(),{hidden:false});
 const box=Object.assign(new EventTarget(),{scrollTop:0,scrollHeight:1200,clientHeight:600});
 const body={};
 let resize=()=>{};
 new vm.Script(ts.transpileModule(readFileSync('components/chat-v2/use-thread-scroll.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({
  exports:hook,window:browser,document:doc,requestAnimationFrame:(fn:()=>void)=>{fn();return 1;},
  ResizeObserver:class{constructor(fn:()=>void){resize=fn;}observe(){}disconnect(){}},
  require(name:string){assert.equal(name,'react');return React;},
 });
 const useScroll=hook.useThreadScroll as typeof import('../components/chat-v2/use-thread-scroll').useThreadScroll;
 let current!:ReturnType<typeof useScroll>;
 function Fixture({revision}:{revision:string}){const state=useScroll(revision);React.useLayoutEffect(()=>{current=state;});return React.createElement('section',{ref:state.threadRef},React.createElement('div',{ref:state.contentRef}));}
 let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(React.createElement(Fixture,{revision:'original'}),{createNodeMock:node=>node.type==='section'?box:body});});
 assert.equal(box.scrollTop,1200,'Arrival follows the newest message');
 await act(async()=>{box.scrollHeight=1300;resize();});
 assert.equal(box.scrollTop,1300,'Late content follows while the member stays at newest');
 await act(async()=>{box.dispatchEvent(new Event('wheel'));box.scrollTop=100;box.dispatchEvent(new Event('scroll'));});
 await act(async()=>tree.update(React.createElement(Fixture,{revision:'original'})));
 assert.equal(box.scrollTop,100,'An unchanged poll preserves the older reading position');
 assert.equal(current.unread,false,'An unchanged poll does not invent unread content');
 await act(async()=>tree.update(React.createElement(Fixture,{revision:'new reply'})));
 assert.equal(box.scrollTop,100,'A new reply preserves the older reading position');
 assert.equal(current.unread,true,'A new reply offers the newest action while reading history');
 for(const [target,event] of [[browser,'pageshow'],[browser,'focus'],[doc,'visibilitychange']] as const){
  await act(async()=>{target.dispatchEvent(new Event(event));});
  assert.equal(box.scrollTop,100,`${event}: returning never takes away the older reading position`);
 }
 await act(async()=>resize());
 assert.equal(box.scrollTop,100,'Viewport/content resizing preserves the older reading position');
 await act(async()=>current.newest());
 assert.equal(box.scrollTop,1300,'Explicit newest action reaches the latest content');
 assert.equal(current.unread,false,'Explicit newest action clears unread status');
 await act(async()=>{box.scrollHeight=1400;resize();});
 assert.equal(box.scrollTop,1400,'After explicit newest, later size changes resume following');
 await act(async()=>tree.unmount());
}
console.log('Chat v2 scroll: actual hook preserves older history across identical/changed polls, resize and app return; explicit newest clears unread and resumes following. Supplied DOM geometry.');

// Exercise the real new screen, thread hook and BP hook together. Only browser geometry and IO are supplied.
{
 const registry = await import('@/lib/zoe-chat-actions/registry');
 const cardThread = await import('@/lib/zoe-chat-actions/thread');
 const contracts = await import('@/lib/zoe/app-chat-contracts');
 const cardCopy = await import('@/lib/zoe-chat-actions/copy');
 const bpValues = await import('@/components/patient/bp-entry-values');
 const {typedReading} = await import('@/lib/zoe-chat-actions/typed-reading');
 const suggestions = await import('@/lib/chat/suggestions');
 const tasks = await import('@/lib/chat/tasks');
 const copy = await import('@/lib/patient/copy');
 const dates = await import('@/lib/patient/date-format');
 const everyday = await import('@/lib/zoe-chat-actions/everyday-contract');
 const photoCopy = await import('@/lib/bp-photo/copy');
 const staffNames = await import('@/lib/member-staff-name.mjs');
 const browser = Object.assign(new EventTarget(), {setInterval:()=>1,clearInterval:()=>{},matchMedia:()=>({matches:true}),location:{search:''}});
 const doc = Object.assign(new EventTarget(), {hidden:false,visibilityState:'visible'});
 const box = Object.assign(new EventTarget(), {scrollTop:0,scrollHeight:1200,clientHeight:600});
 const focused:string[]=[];
 const form = {querySelector:()=>({focus:(options:{preventScroll?:boolean})=>{assert.equal(options.preventScroll,true);focused.push('reading');}})};
 const composer = {style:{height:''},scrollHeight:42,focus:(options:{preventScroll?:boolean})=>assert.equal(options.preventScroll,true)};
 const calls:{kind:string;input:Record<string,unknown>}[]=[];
 let serverThread:ZoeThread={ok:true,version:0,ack:null,zoeReplies:false,settledSeq:0,messages:[],answers:[],replies:[],suggestionState:{locale:'en',consent:true,emergency:false,safetyHold:false,medicineDue:true,bpDue:true,visitProposal:true,visitToBook:true,planToRead:true,resultsToRead:true,doctorReply:false}};
 let serverCards:import('@/lib/zoe-chat-actions/registry').ZoeCards={enabled:true,cards:[],clearedSeq:null,readingSeq:null};
 let failSave=true,failOpen=true,loseOpen=false,loseSave=false;
 let visitResult:import('@/lib/zoe-chat-actions/registry').CardActionResult={status:'failed'};
 const actionIO={
  async sendZoeChatMessage(requestId:string,text:string){
   calls.push({kind:'message',input:{requestId,text}});
   serverThread={...serverThread,version:serverThread.version+1,messages:[...serverThread.messages,{requestId,text,seq:serverThread.messages.length+1,at:new Date().toISOString(),channel:'app'}]};
   serverCards={...serverCards,readingSeq:serverThread.messages.length};
   return {status:'sent',thread:serverThread};
  },
  async openZoeCard(input:Record<string,unknown>){
   calls.push({kind:'open',input});if(input.kind==='visit')return visitResult;assert.equal(input.kind,'bp');
   if(failOpen){failOpen=false;return {status:'failed'};}
   const message=serverThread.messages.find(m=>m.seq===input.sourceSeq)!;
   const typed=typedReading(message.text);
   const card=registry.cardSchema.parse({id:crypto.randomUUID(),requestId:input.requestId,kind:'bp',source:'typed',sourceSeq:input.sourceSeq,state:'open',outcome:{},at:new Date().toISOString(),snapshot:{v:1,week:null,...(typed?{typed:{...typed,measuredAt:message.at}}:{})}});
   serverCards=cardThread.upsertCard(serverCards,card);if(loseOpen){loseOpen=false;throw Error('Synthetic lost open reply');}return {status:'ok',card};
  },
  async recordBpFromCard(input:Record<string,unknown>){
   calls.push({kind:'save',input});if(failSave){failSave=false;return {status:'failed'};}
   const card={...serverCards.cards.find(c=>c.id===input.cardId)!,state:'done',outcome:{bp:{systolic:input.systolic,diastolic:input.diastolic,pulse:input.pulse,doneAt:new Date().toISOString()}}} as import('@/lib/zoe-chat-actions/registry').ZoeCard;
   serverCards=cardThread.upsertCard(serverCards,card);if(loseSave){loseSave=false;throw Error('Synthetic lost save reply');}return {status:'ok',card};
  },
 };
 const files:Record<string,string>={
  '@/components/patient/use-zoe-thread':'components/patient/use-zoe-thread.ts',
  '@/components/patient/use-bp-card':'components/patient/use-bp-card.ts',
  './reading-card':'components/chat-v2/reading-card.tsx',
  '@/components/patient/bp-photo-input':'components/patient/bp-photo-input.tsx',
  './bp-flow-cards':'components/chat-v2/bp-flow-cards.tsx',
  './dialog-turn':'components/chat-v2/dialog-turn.tsx',
  './speaker':'components/chat-v2/speaker.tsx',
  './microphone':'components/chat-v2/microphone.tsx',
  './conversation':'components/chat-v2/conversation.tsx',
  './conversation-controller':'components/chat-v2/conversation-controller.ts',
  './conversation-browser':'components/chat-v2/conversation-browser.ts',
  './use-thread-scroll':'components/chat-v2/use-thread-scroll.ts',
  '@/components/conversation/chat-suggestions':'components/conversation/chat-suggestions.tsx',
 };
 const modules:Record<string,unknown>={
  '@/lib/staff-zoe/typed-boundary':await import('@/lib/staff-zoe/typed-boundary'),
  '@/lib/chat/doctor-note':await import('@/lib/chat/doctor-note'),
  '@/lib/zoe/symptoms/intake':await import('@/lib/zoe/symptoms/intake'),
  '@/lib/zoe-chat-actions/living-visit':await import('@/lib/zoe-chat-actions/living-visit'),
  './reported-bp-label':await import('@/components/chat-v2/reported-bp-label'),
  '@/lib/patient/bp-provenance':await import('@/lib/patient/bp-provenance'),
  react:React,'react/jsx-runtime':jsx,'lucide-react':{Phone:()=>null,ArrowUp:()=>null,HeartPulse:()=>null},
  '@/lib/zoe-chat-actions/voice-contract':await import('@/lib/zoe-chat-actions/voice-contract'),
  '@/lib/zoe-chat-actions/registry':registry,'@/lib/zoe-chat-actions/thread':{...cardThread,fetchZoeCards:async()=>serverCards},
  '@/lib/zoe/app-chat-contracts':{...contracts,fetchZoeThread:async()=>serverThread},
  '@/lib/zoe-chat-actions/copy':cardCopy,'@/lib/zoe-chat-actions/bp-flow':bpFlowModule,'@/lib/zoe/member-screen':screen,
  '@/components/patient/bp-entry-values':bpValues,'./bp-entry-values':bpValues,
  '@/lib/chat/suggestions':suggestions,'@/lib/chat/tasks':tasks,
  '@/lib/bp-photo/copy':photoCopy,
  '@/lib/bp-photo/client':{prepareBpPhoto:async(file:unknown)=>file},
  '@/lib/patient/copy':copy,'@/lib/patient/date-format':dates,'@/lib/brand':await import('@/lib/brand'),
  './next-step-card':{NextStepCard:()=>null,NextStepTurn:()=>null,ReviewCard:()=>null},
  './results-message-card':{ResultsMessageCard:()=>null,JourneyRecordCard:()=>null,JourneyRecordTurn:()=>null},
  '@/lib/zoe-chat-actions/next-step-copy':{NEXT_STEP:{}},
  '@/lib/patient/journey-stage':{STAGE_CLASSES},
  './profile-card':{ProfileCard:()=>null,SavedProfileTurn:()=>null},'./medicines-card':{MedicinesCard:()=>null,SavedMedicinesTurn:()=>null},
  './symptom-gate-card':{SymptomGateCard:()=>null,SavedGateTurn:()=>null},
  './consult-questions-card':{ConsultQuestionsCard:()=>null,SavedQuestionsTurn:()=>null},
  './lab-visit-card':{LabVisitCard:()=>null,SavedLabTurn:()=>null},
  './visit-card':{VisitCard:()=>null,SavedVisitTurn:()=>null},
  './document-card':{DocumentCard:()=>null,SavedDocumentTurn:()=>null},
  '@/components/patient/zoe-attach':{ZoeAttach:()=>null},
  '@/lib/zoe-chat-actions/labs-actions':{openDocumentCard:()=>{throw Error('Unexpected document action in reading check');}},
  './plan-card':{PlanCard:()=>null,ConfirmedPlanTurn:()=>null},
  './dose-card':{DoseCard:()=>null,DoseTurn:()=>null},
  // WP F: the caregiver, consents and invitation blocks render nothing here; with no invitations none is drawn.
  './member-settings-cards':{CaregiverCard:()=>null,ConsentsCard:()=>null,CaregiverInvitations:()=>null},
  './dose-flow-cards':{DoseReasonCard:()=>null,DoseReasonTurn:()=>null,SamsCard:()=>null,SamsTurn:()=>null},
  '@/lib/zoe-chat-actions/everyday-contract':everyday,
  '@/lib/member-staff-name.mjs':staffNames,
  '@/lib/zoe-chat-actions/thread-events':await import('@/lib/zoe-chat-actions/thread-events'),
  '@/lib/zoe-chat-actions/actions':actionIO,'@/app/patient/zoe/chat-actions':actionIO,
  '@/lib/zoe-chat-actions/everyday-actions':{openEverydayCard:()=>{throw Error('Hidden card opened');}},
  './tab-draft':{readDraft:()=>null,keepDraft:()=>{}},
  '@/components/patient/use-chat-viewport':{useChatViewport:()=>false},
  '@/components/patient/use-hydrated':{Call103:({children,size,...props}:{children:React.ReactNode;size:string})=>size==='pill'?null:React.createElement('a',{...props,href:'tel:103'},children),ComposerWaiting:()=>null,useHydrated:()=>true},
  '@/lib/clinical/rules/rules':{firesEmergency:()=>null},
  './anamnesis':{Anamnesis:()=>null},
  './push-prompt':{MemberPushPrompt:()=>null},
  './use-notice-seen':{useNoticeSeen:()=>{}},
  '@/components/patient/zoe-emergency-card':{ZoeEmergencyCard:()=>null},
  '@/components/patient/zoe-chat-consent':{ZoeChatConsent:()=>null},
  '@/components/patient/zoe-notice':{ZoeNotice:()=>null},
  '@/components/patient/sign-in-ended':{SignInEnded:()=>null},
  './menu':{ChatMenu:({onVisit}:{onVisit:()=>void})=>React.createElement('button',{'data-test-visit':true,onClick:onVisit},'visit')},
 };
 const load=(path:string):Record<string,unknown>=>{
  const out:Record<string,unknown>={};
  new vm.Script(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{filename:path}).runInNewContext({
   exports:out,crypto,Date,Intl,Event,window:browser,document:doc,
   fetch:async()=>Response.json(photoResult),AbortSignal,
   getComputedStyle:()=>({lineHeight:'22px'}),requestAnimationFrame:(fn:()=>void)=>{fn();return 1;},ResizeObserver:class{observe(){}disconnect(){}},
   setTimeout,clearTimeout,require(name:string){if(files[name]&&!modules[name])modules[name]=load(files[name]);if(!(name in modules))throw Error(`Missing isolated boundary ${name}`);return modules[name];},
  });return out;
 };
 let photoResult:unknown={status:'read',systolic:142,diastolic:91,pulse:78};
 const View=load('components/chat-v2/member-chat.tsx').MemberChat as typeof import('@/components/chat-v2/member-chat').MemberChat;
 let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(React.createElement(View,{locale:'en',memberName:'Ani',revision:1,initial:serverThread,cards:serverCards}),{createNodeMock:node=>node.type==='section'?box:node.type==='textarea'?composer:node.type==='form'?form:{}});});
 const send=async(text:string)=>{
  await act(async()=>tree.root.findByType('textarea').props.onChange({target:{value:text}}));
  await act(async()=>tree.root.findByProps({className:'cv2-composer'}).props.onSubmit({preventDefault(){}}));
 };
 const suggestionsStrip=tree.root.findByProps({'data-chat-suggestions':true});
 assert.equal(suggestionsStrip.findAllByType('button').length,1,'Only the reading suggestion is offered even with every other task due');
 await send('I want to see my results');
 assert.equal(calls.filter(c=>c.kind==='open').length,0,'A hidden request sends as a message without opening controls');
 await send('record my blood pressure');
 assert.equal(tree.root.findAllByType('input').length,0,'Failed opening leaves no editable card');
 await act(async()=>tree.root.findByProps({'data-chat-suggestions':true}).findByType('button').props.onClick());
 assert.deepEqual(calls.filter(c=>c.kind==='message').map(c=>c.input.text),['I want to see my results','record my blood pressure','I want to record my blood pressure'],'The suggestion sends real visible member text');
 assert.equal(calls.filter(c=>c.kind==='open').length,2,'A newer cleared reading supersedes the previous failed opening');
 assert.ok(focused.includes('reading'),'Opening focuses the first empty field with preventScroll');
 assert.equal(tree.root.findAllByType('a').length,0,'The open card has no anchors');
 const field=(name:string)=>tree.root.findAllByType('input').find(i=>i.props.name===name)!;
 const saveForm=()=>tree.root.findAllByType('form').find(f=>f.props.className!=='cv2-composer')!;
 await act(async()=>{field('systolic').props.onChange({target:{value:'999'}});field('diastolic').props.onChange({target:{value:'93'}});});
 await act(async()=>saveForm().props.onSubmit({preventDefault(){}}));
 assert.equal(calls.filter(c=>c.kind==='save').length,0,'Invalid numbers never reach the save action');
 await act(async()=>field('systolic').props.onChange({target:{value:'148'}}));
 await act(async()=>saveForm().props.onSubmit({preventDefault(){}}));
 assert.equal(calls.filter(c=>c.kind==='save').length,1);
 assert.equal(tree.root.findAllByProps({role:'alert'}).length,1,'A failed save remains inline');
 await act(async()=>saveForm().props.onSubmit({preventDefault(){}}));
 const saves=calls.filter(c=>c.kind==='save').map(c=>c.input);
 assert.deepEqual(saves[1],saves[0],'A retry keeps the submission id, values and measured time');
 assert.equal(saves[1].pulse,null,'An empty optional pulse stays unknown');
 assert.deepEqual(tree.root.findByProps({'data-zoe-bp-saved':true}).children,['Saved: 148/93 (Member-reported, not verified).']);
 serverCards={...serverCards,cards:serverCards.cards.map(c=>({...c,state:'open',outcome:{}}))};
 await act(async()=>{browser.dispatchEvent(new Event('focus'));});
 assert.equal(tree.root.findAllByProps({'data-zoe-bp-saved':true}).length,1,'An older poll cannot replace the saved receipt');
 assert.equal(calls.filter(c=>c.kind==='open').length,2,'Polling does not reopen the answered offer');
 assert.equal(tree.root.findAllByType('a').length,0,'The saved card has no anchors');
 loseOpen=true;
 await send('record my blood pressure');
 assert.equal(calls.filter(c=>c.kind==='open').length,3);
 await act(async()=>{browser.dispatchEvent(new Event('focus'));});
 assert.equal(tree.root.findAllByType('button').filter(n=>n.children.includes('Try again')).length,0,'Polling recovery removes the obsolete opening failure');
 // A fresh reading after a recovered lost opening must still open normally.
 await send('131/82');
 assert.equal(calls.filter(c=>c.kind==='open').length,4,'Recovered opening does not block a later reading');
 assert.deepEqual(tree.root.findAllByType('input').slice(-3).map(n=>n.props.value),['131','82',''],'A plain reading prefills the same card');
 loseSave=true;
 await act(async()=>tree.root.findAllByType('form').at(-2)!.props.onSubmit({preventDefault(){}}));
 assert.equal(tree.root.findAllByProps({'data-zoe-bp-saved':true}).length,2,'Polling recovers a saved card after its action reply is lost');
 assert.equal(tree.root.findAllByProps({role:'alert'}).length,0,'An authoritative saved receipt removes an obsolete unconfirmed error');
 for(const text of ['Ուզում եմ գրանցել ճնշումս','Я хочу записать давление']) {
  const count=calls.filter(c=>c.kind==='open').length;
  await send(text);
  assert.equal(calls.filter(c=>c.kind==='open').length,count+1,`${text}: the shared matcher opens a BP card`);
 }
 serverCards={...serverCards,cards:[...serverCards.cards,{...serverCards.cards[0],id:crypto.randomUUID(),valid:false,snapshot:{}} as import('@/lib/zoe-chat-actions/registry').ZoeCard]};
 await act(async()=>{browser.dispatchEvent(new Event('focus'));});
 assert.equal(tree.root.findAllByProps({'data-state':'unavailable'}).length,1,'An unreadable BP snapshot shows an inline unavailable state');
 assert.equal(tree.root.findAllByType('a').length,0,'Unreadable BP cards have no anchors');
 await act(async()=>tree.unmount());
 // The actual reading card and shared hook: a photo fills but never saves, and editing drops provenance permanently.
 const Reading=load('components/chat-v2/reading-card.tsx').ReadingCard as typeof import('@/components/chat-v2/reading-card').ReadingCard;
 const photoCard=registry.cardSchema.parse({id:crypto.randomUUID(),requestId:crypto.randomUUID(),kind:'bp',source:'chip',sourceSeq:null,state:'open',outcome:{},at:new Date().toISOString(),snapshot:{v:1,week:null}});
 for(const enabled of [false,true]){
  await act(async()=>{tree=create(React.createElement(Reading,{card:photoCard as never,locale:'en',focus:false,canFocus:()=>false,superseded:false,onCard:()=>{},onAct:()=>{},photoEnabled:enabled}));});
  assert.equal(tree.root.findAllByProps({'data-bp-photo':true}).length,enabled?1:0,'Switch off hides the camera control');
  if(enabled){
   const take=async()=>act(async()=>tree.root.findByProps({'data-bp-photo-input':true}).props.onChange({target:{files:[{}],value:'photo'}}));
   const saveCount=calls.filter(c=>c.kind==='save').length;
   await take();
   assert.equal(calls.filter(c=>c.kind==='save').length,saveCount,'Reading a photo never saves or escalates');
   assert.deepEqual(['systolic','diastolic','pulse'].map(n=>field(n).props.value),['142','91','78']);
   assert.ok(JSON.stringify(tree.toJSON()).includes('I read 142/91, pulse 78. Check the numbers, then save.'));
   for(const status of ['unclear','unavailable']){
    photoResult={status};await take();
    assert.deepEqual(['systolic','diastolic','pulse'].map(n=>field(n).props.value),['142','91','78'],'A failed retake preserves all fields');
   }
   await act(async()=>saveForm().props.onSubmit({preventDefault(){}}));
   assert.equal(calls.at(-1)!.input.photoConfirmed,true,'Unedited photo reaches the save command as provenance only');
  }
  await act(async()=>tree.unmount());
 }
 await act(async()=>{tree=create(React.createElement(Reading,{card:photoCard as never,locale:'en',focus:false,canFocus:()=>false,superseded:false,onCard:()=>{},onAct:()=>{},photoEnabled:true}));});
 photoResult={status:'read',systolic:142,diastolic:91,pulse:null};
 await act(async()=>tree.root.findByProps({'data-bp-photo-input':true}).props.onChange({target:{files:[{}],value:'photo'}}));
 assert.equal(field('pulse').props.value,'');
 await act(async()=>field('systolic').props.onChange({target:{value:'143'}}));
 await act(async()=>field('systolic').props.onChange({target:{value:'142'}}));
 await act(async()=>saveForm().props.onSubmit({preventDefault(){}}));
 assert.equal(calls.at(-1)!.input.photoConfirmed,false,'Editing then restoring a number still counts as typed');
 await act(async()=>tree.unmount());
 // Menu -> actual thread hook -> held visit rendering, including ordinary failures.
 serverThread={...serverThread,messages:[],answers:[],replies:[]};
 serverCards={enabled:true,cards:[],clearedSeq:null};
 for(const locale of ['hy','ru','en'] as const){
  for(const call103 of [true,false]){
   visitResult={status:'held_urgent',call103};
   await act(async()=>{tree=create(React.createElement(View,{locale,memberName:'Ani',revision:1,initial:serverThread,cards:serverCards,onboarding:{profileRequest:null}}),{createNodeMock:node=>node.type==='section'?box:node.type==='textarea'?composer:{}});});
   await act(async()=>tree.root.findByProps({className:'cv2-avatar'}).props.onClick());
   await act(async()=>tree.root.findByProps({'data-test-visit':true}).props.onClick());
   const held=tree.root.findByProps({'data-card-opening':'held_urgent'});
   const text=JSON.stringify(held.findAllByType('p').map(n=>n.children));
   const expected=call103?cardCopy.FLOW.call103[locale]:{hy:'Ձեր խնամքի թիմը կկապվի ձեզ հետ նախքան այցի ամրագրումը։',ru:'Ваша медицинская команда свяжется с вами до записи на визит.',en:'Your care team will contact you before booking.'}[locale];
   assert.ok(text.includes(expected),`${locale}: the hold gives the approved next step`);
   assert.ok(!text.includes(cardCopy.COMMON.openFailed[locale]));
   assert.equal(held.findAllByType('button').length,0,'No retry for a deliberate hold');
   assert.equal(held.findAllByProps({href:'tel:103'}).length,call103?1:0,'103 stays actionable only for an active alarm');
   await act(async()=>tree.unmount());
  }
  for(const status of ['failed','unavailable','rate_limited'] as const){
   visitResult={status};
   await act(async()=>{tree=create(React.createElement(View,{locale,memberName:'Ani',revision:1,initial:serverThread,cards:serverCards,onboarding:{profileRequest:null}}),{createNodeMock:node=>node.type==='section'?box:node.type==='textarea'?composer:{}});});
   await act(async()=>tree.root.findByProps({className:'cv2-avatar'}).props.onClick());
   await act(async()=>tree.root.findByProps({'data-test-visit':true}).props.onClick());
   const failed=tree.root.findByProps({'data-card-opening':status==='rate_limited'?status:'failed'});
   assert.ok(JSON.stringify(failed.findAllByType('p').map(n=>n.children)).includes((status==='rate_limited'?cardCopy.COMMON.rateLimited:cardCopy.COMMON.openFailed)[locale]));
   assert.equal(failed.findAllByType('button')[0].children[0],cardCopy.COMMON.retry[locale],'Other failures keep their retry');
   await act(async()=>tree.unmount());
  }
 }
 // Mixed persisted labs and continuation cards exercise the merged renderer selection.
 const block=({card}:{card:import('@/lib/zoe-chat-actions/registry').ZoeCard})=>React.createElement('section',{'data-merged-kind':card.kind});
 for(const [name,exports]of Object.entries({
  './next-step-card':['NextStepCard','ReviewCard'],
  './results-message-card':['ResultsMessageCard','JourneyRecordCard'],
  './symptom-gate-card':['SymptomGateCard'],'./consult-questions-card':['ConsultQuestionsCard'],
  './lab-visit-card':['LabVisitCard'],'./visit-card':['VisitCard'],'./document-card':['DocumentCard'],
 }))for(const key of exports)(modules[name] as Record<string,unknown>)[key]=block;
 const words={en:'Synthetic step',hy:'Synthetic step',ru:'Synthetic step'};
 const appointment={v:1,appointmentId:crypto.randomUUID(),revision:1,startsAt:'2030-01-07T05:00:00Z',location:'Synthetic clinic',preparation:'Synthetic preparation'};
 const snapshots={
  document:{v:1,document:null},prep:appointment,fasting:appointment,symptom_gate:{v:1},
  consult_questions:{v:1,appointmentId:null,groups:['symptoms','medicines','results'].map(label=>({label,text:''}))},
  visit:{v:1,available:true,next:null,proposal:null,attention:false},
  results:{v:1,available:true,publishedAt:null,rows:[],more:0},message:{v:1},plan:{v:1,available:true,plan:null},
  next_step:{v:1,stage:'mixed',title:words,detail:words,button:words,target:'tests_needed',doctorInLoop:false},
  tests_needed:{v:1,available:true,rows:[]},review:{v:1},
 };
 serverCards={enabled:true,clearedSeq:null,cards:Object.entries(snapshots).map(([kind,snapshot])=>registry.cardSchema.parse({id:crypto.randomUUID(),requestId:crypto.randomUUID(),kind,snapshot,source:'chip',sourceSeq:null,state:'open',outcome:{},at:new Date().toISOString()}))};
 for(const enabled of [false,true]){
  await act(async()=>{tree=create(React.createElement(View,{locale:'en',memberName:'Ani',revision:1,initial:serverThread,cards:serverCards,...(enabled?{onboarding:{profileRequest:null}}:{})}),{createNodeMock:node=>node.type==='section'?box:node.type==='textarea'?composer:node.type==='form'?form:{}});});
  const kinds=tree.root.findAll(n=>n.type==='section'&&n.props['data-merged-kind']).map(n=>n.props['data-merged-kind']);
  const expected=enabled?Object.keys(snapshots):['document','prep','fasting','symptom_gate','consult_questions','visit'];
  assert.deepEqual([...kinds].sort(),expected.sort(),enabled?'Labs and continuation renderers coexist, with one visit':'Switch off retains main’s labs visibility and hides continuation cards');
  if(enabled){
   const visit=tree.root.findAll(n=>n.type===block&&n.props.card.kind==='visit')[0];
   await act(async()=>visit.props.onAct(visit.props.card.id,true));
   // A lost action reply has no onCard call; only the next authenticated poll supplies the receipt.
   await act(async()=>{box.dispatchEvent(new Event('wheel'));box.scrollTop=100;box.dispatchEvent(new Event('scroll'));});
   serverCards={...serverCards,cards:serverCards.cards.map(c=>c.kind==='visit'?{...c,state:'done',outcome:{booking:{kind:'select',dialog:true,ok:true,doneAt:new Date().toISOString()}}}:c)};
   await act(async()=>{browser.dispatchEvent(new Event('focus'));});
   assert.equal(box.scrollTop,box.scrollHeight,'Polling a lost booking receipt recognizes the pending local action and reaches its saved turn');
  }
  await act(async()=>tree.unmount());
 }

 // A V3 plan must reach main's teach-back card instead of the older continuation fallback.
 const planModules=modules['./plan-card'] as Record<string,unknown>;
 function PlanCard({onRefresh}:{onRefresh:()=>void}){return React.createElement('button',{'data-main-plan':true,onClick:onRefresh});}
 planModules.PlanCard=PlanCard;
 function ConfirmedPlanTurn(){return React.createElement('p',{'data-main-plan-receipt':true});}
 planModules.ConfirmedPlanTurn=ConfirmedPlanTurn;
 function JourneyRecordTurn(){return React.createElement('p',{'data-legacy-plan-receipt':true});}
 (modules['./results-message-card'] as Record<string,unknown>).JourneyRecordTurn=JourneyRecordTurn;
 const legacyPlan=serverCards.cards.find(c=>c.kind==='plan')!;
 const currentPlan=registry.cardSchema.parse({...legacyPlan,snapshot:{v:1,available:false,plan:null,v3:null}});
 const openReading=actionIO.openZoeCard;
 actionIO.openZoeCard=async(input:Record<string,unknown>)=>{calls.push({kind:'open-plan',input});return {status:'failed'};};
 for(const [plan,marker]of [
  [currentPlan,'data-main-plan'],
  [{...currentPlan,state:'done',outcome:{plan:{doneAt:new Date().toISOString()}}},'data-main-plan-receipt'],
  [{...legacyPlan,state:'done',claims:{everyday:{payload:{view:'plan_ack'}}},outcome:{'everyday:result':{doneAt:new Date().toISOString()}}},'data-legacy-plan-receipt'],
 ] as const){
  serverCards={...serverCards,cards:[plan as import('@/lib/zoe-chat-actions/registry').ZoeCard]};
  await act(async()=>{tree=create(React.createElement(View,{locale:'en',memberName:'Ani',revision:1,initial:serverThread,cards:serverCards,onboarding:{profileRequest:null}}),{createNodeMock:node=>node.type==='section'?box:node.type==='textarea'?composer:node.type==='form'?form:{}});});
  assert.equal(tree.root.findAllByProps({[marker]:true}).length,1,'Current V3 plans and legacy acknowledgements keep their own renderer');
  if(marker==='data-main-plan'){
   assert.equal(tree.root.findAllByProps({'data-merged-kind':'plan'}).length,0,'The legacy plan cannot shadow teach-back, including an unavailable V3 read');
   await act(async()=>tree.root.findByProps({'data-main-plan':true}).props.onClick());
   assert.equal(calls.at(-1)?.input.kind,'plan','The V3 card refresh opens main’s plan through the shared hook');
  }
  await act(async()=>tree.unmount());
 }
 actionIO.openZoeCard=openReading;

}

// The dialog rule: the same stored outcome gives the same order, on every read and every device.
{
 const {dialogOrder,dialogThread,mergeCards,withCards,withoutCardReplies}=await import('@/lib/zoe-chat-actions/thread');
 const {TASK_REPLY}=await import('@/lib/chat/tasks');
 const {cardSchema}=await import('@/lib/zoe-chat-actions/registry');
 type Item=import('@/lib/zoe/app-chat-contracts').ChatItem;
 const at=(minute:number)=>new Date(Date.UTC(2026,10,1,10,minute)).toISOString();
 const bp=(id:number,minute:number,outcome:Record<string,unknown>={},typed?:{systolic:number;diastolic:number;pulse:number|null})=>cardSchema.parse({id:`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,requestId:`00000000-0000-4000-9000-${String(id).padStart(12,'0')}`,kind:'bp',source:'typed',sourceSeq:1,state:outcome.bp?'done':'open',outcome,at:at(minute),snapshot:{v:1,week:null,...(typed?{typed:{...typed,measuredAt:at(minute)}}:{})}});
 const reading=(minute:number,pulse:number|null=72)=>({bp:{systolic:148,diastolic:93,pulse,measuredAt:at(1),submissionId:'00000000-0000-4000-a000-000000000001',doneAt:at(minute)}});
 const items:Item[]=[
  {kind:'member',key:'m1',text:'record my blood pressure',at:at(1),channel:'app',requestId:null},
  {kind:'answer',key:'a1',text:'Later answer',at:at(5)},
  {kind:'nurse',key:'n1',text:'Nurse note',at:at(6),senderName:'Ani'},
  {kind:'member',key:'m2',text:'Another question',at:at(7),channel:'app',requestId:null},
  {kind:'pending',key:'p'},
 ];
 const notice:Item={kind:'notice',key:'Nn',text:'A notice',at:at(10),closed:false};
 assert.deepEqual(dialogThread([...items.slice(0,4),notice],[bp(1,2,reading(9))]).map(e=>e.type==='item'?e.item.key:'saved'),['m1','a1','n1','m2','saved','Nn'],'A save goes above a newer notice');
 assert.deepEqual(dialogThread([...items.slice(0,4),notice],[bp(1,2,reading(11))]).map(e=>e.type==='item'?e.item.key:'saved'),['m1','a1','n1','m2','Nn','saved'],'A save goes below an older notice');
 // The old chat keeps main's placement: a nurse message has no time there, so a card goes past it to the next timed item.
 const oldChat:Item[]=[{kind:'member',key:'m1',text:'Question',at:at(1),channel:'app',requestId:null},{kind:'nurse',key:'n1',text:'Nurse note',at:at(3),senderName:'Ani'},{kind:'answer',key:'a1',text:'Answer',at:at(5)}];
 assert.deepEqual(withCards(oldChat,[bp(1,2)]).map(e=>e.type==='item'?e.item.key:'card'),['m1','n1','card','a1'],'withCards: member, nurse, card, answer, as on main');
 const reply:Item={kind:'answer',key:'z1',text:TASK_REPLY.en,at:at(2)};
 const asked=(seq:number):Item=>({kind:'member',key:`m${seq}`,text:'A task',at:at(seq),channel:'app',requestId:null});
 const keys=(list:readonly Item[])=>list.map(item=>item.key);
 assert.deepEqual(keys(withoutCardReplies([asked(1),reply],new Set([1]))),['m1'],'A card answers its own request');
 assert.deepEqual(keys(withoutCardReplies([asked(1),reply],new Set())),['m1','z1'],'With no card the reply stays, so the request is answered');
 assert.deepEqual(keys(withoutCardReplies([asked(1),reply],new Set([7]))),['m1','z1'],'Another request\'s card does not hide this reply');
 assert.deepEqual(keys(withoutCardReplies([asked(1),{...reply,text:'A real answer'}],new Set([1]))),['m1','z1'],'Only the fixed reply goes');
 const names=(entries:ReturnType<typeof dialogThread>)=>entries.map(e=>e.type==='item'?e.item.key:e.type==='turn'?`saved${e.said?':reply-only':''}`:'form');
 assert.deepEqual(names(dialogThread(items,[bp(1,2)])),['m1','form','a1','n1','m2','p'],'An unsaved form stays at the time Zoe posted it');
 assert.deepEqual(names(dialogThread(items,[bp(1,2,reading(9))])),['m1','a1','n1','m2','saved','p'],'Saved from an older card: the form leaves, the save is at the end, Zoe writing stays last');
 assert.deepEqual(names(dialogThread(items,[bp(1,2,reading(4))])),['m1','saved','a1','n1','m2','p'],'What came after a save stays after it');
 const later:Item[]=[...items.slice(0,4),{kind:'answer',key:'a2',text:'After the save',at:at(10)}];
 assert.deepEqual(names(dialogThread(later,[bp(1,2,reading(9))])),['m1','a1','n1','m2','saved','a2'],'A reply after the save reads after it');
 assert.deepEqual(names(dialogThread(items.slice(0,2),[bp(1,0)])),['form','m1','a1'],'A message after a card stays after it');
 assert.deepEqual(names(dialogThread(items,[bp(1,8)])),['m1','a1','n1','m2','p','form'],'An open form stays below Zoe writing, so the keyboard does not push it up');
 assert.deepEqual(names(dialogThread(items.slice(0,3),[bp(1,8)])),['m1','a1','n1','form'],'A nurse message counts as time too');
 const same={systolic:148,diastolic:93,pulse:null};
 assert.deepEqual(names(dialogThread(items.slice(0,1),[bp(1,2,reading(3,null),same)])),['m1','saved:reply-only'],'Numbers already in the member message are not repeated');
 assert.deepEqual(names(dialogThread(items.slice(0,1),[bp(1,2,reading(3,72),same)])),['m1','saved'],'A changed or added number is new, so it shows');
 const old=bp(1,2,{bp:{systolic:148,diastolic:93,pulse:null,measuredAt:at(3)}});
 assert.deepEqual(dialogThread([],[old]).map(e=>e.type==='turn'&&e.at),[at(3)],'A reading saved before doneAt sits at its measured time');
 const first=dialogThread(items,[bp(1,2,reading(9)),bp(2,3)]);
 assert.deepEqual(dialogThread(items,[bp(2,3),bp(1,2,reading(9))]),first,'A second device reading the cards in another order sees the same thread');
 const shown={enabled:true,cards:[bp(1,2,reading(9))],clearedSeq:null};
 assert.deepEqual(names(dialogThread(items,mergeCards(shown,{...shown,cards:[bp(1,2)]}).cards)),names(first.filter(e=>e.type!=='card')),'A poll older than the save cannot put the form back');
 // The shared order is not tied to a role or to cards: another chat's own entries go through the same function.
 type Row={key:string;at:number;writing?:boolean};
 const rows:Row[]=[{key:'a',at:1},{key:'b',at:5},{key:'dots',at:-Infinity,writing:true}];
 assert.deepEqual(dialogOrder<Row>(rows,[{key:'done',at:9}],{at:r=>r.at,writing:r=>!!r.writing}).map(r=>r.key),['a','b','done','dots'],'Any thread: the finished action is last, the writer after it');
 assert.deepEqual(dialogOrder<Row>(rows,[{key:'done',at:3}],{at:r=>r.at,writing:r=>!!r.writing}).map(r=>r.key),['a','done','b','dots'],'Any thread: time order holds');
}
console.log('Chat v2 dialog: time order, saved from an older card, typed numbers not repeated, same order from any read or device. Pure.');
console.log('Chat v2 integration: actual screen and hooks send visible task text, hide other kinds, open BP only after clearance, reject invalid input, preserve retries and saved receipts across stale polls. Synthetic IO/geometry, no browser claim.');

// Suggestions must use the same fact read on the initial page and on subsequent v2 polls.
{
 const out:Record<string,unknown>={};
 let reads=0;
 const pollEnv:{NOREON_MEMBER_CHAT_V2?:string}={NOREON_MEMBER_CHAT_V2:'true'};
 let pollV3=true;
 new vm.Script(ts.transpileModule(readFileSync('app/api/patient/zoe/thread/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports:out,process:{env:pollEnv},Response,require(name:string){
  if(name==='@/lib/patient/member-chat-config')return {memberChatOnlyEnabled:()=>false};
  if(name==='@/lib/zoe-chat-actions/voice')return {voiceAvailable:()=>false};
 if(name==='@/lib/patient/zoe-app-v3')return {zoeAppV3Enabled:()=>pollV3};
  if(name==='@/lib/chat/suggestion-read')return {readMemberSuggestionState:async()=>{reads++;return suggestionState;}};
  if(name==='@/lib/observability/with-logging')return {withRouteLogging:(fn:unknown)=>fn};
  if(name==='@/lib/patient/auth')return {patientIdentity:async()=>({id:'synthetic'})};
  if(name==='@/lib/patient/demo')return {demoEnabled:()=>false};
  if(name==='@/lib/zoe/app-chat')return {readZoeThread:async()=>({...initial,suggestionState:undefined}),readIntakeState:async()=>null};
  if(name==='@/lib/zoe/member-screen')return {zoeEmergencyCardEnabled:()=>false};
  throw Error(`Unexpected polling boundary ${name}`);
 }});
 const get=out.GET as ()=>Promise<Response>;
 assert.deepEqual((await (await get()).json()).suggestionState,suggestionState,'V2 polls with V3 on retain the due suggestion without the old chat-only flag');
 assert.equal(reads,1);
 pollEnv.NOREON_MEMBER_CHAT_V2='false';await get();assert.equal(reads,1,'Disabled v2 does not add reads to the old chat');
 pollEnv.NOREON_MEMBER_CHAT_V2='true';pollV3=false;await get();assert.equal(reads,1,'V3 off adds no read to the new chat');
}
console.log('Chat v2 polling: initial and subsequent reads share suggestion facts; disabled v2 or V3 retains old read behavior.');

// Both presentations must use one questionnaire controller and the original transport.
const form=readFileSync('components/patient/questionnaire.tsx','utf8');
const chatQuestions=readFileSync('components/chat-v2/anamnesis.tsx','utf8');
for(const source of [form,chatQuestions]) {
 assert.match(source,/useQuestionnaire/);
 assert.doesNotMatch(source,/openQuestionnaireSession|saveQuestionnaireAnswers|completeAssessment/);
}
const controller=readFileSync('components/patient/use-questionnaire.tsx','utf8');
assert.match(controller,/saveQuestionnaireAnswers/);
assert.match(controller,/session.accept/);
assert.match(controller,/firesEmergency/);
assert.doesNotMatch(chatQuestions,/<a\b|scrollIntoView/);

await import("./check-chat-overview");
await import("./check-chat-anamnesis");
await import("./check-member-anamnesis");
