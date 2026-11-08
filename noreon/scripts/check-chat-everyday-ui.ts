import assert from 'node:assert/strict';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {cardSchema,type ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {EVERYDAY_VIEWS} from '@/lib/zoe-chat-actions/everyday-contract';
import {everydayFixtures,fixtureId,fixturePlan,fixturePlanVersion,fixtureMedicineChanges} from './fixtures/chat-everyday';
import type {EverydayRead} from '@/lib/zoe-chat-actions/everyday-read';

globalThis.fetch=(()=>{throw Error('Network forbidden in this check');}) as typeof fetch;
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let data:EverydayRead=everydayFixtures.earlier,readStatus='ok',completedLessonId:string|undefined;
let planData={...fixturePlan};
const dueAt='2026-11-01T04:00:00Z';
let doses=[{medication:fixturePlan.medications[0],dueAt,status:'due' as 'due'|'taken',revision:0}],doseWrites=0,doseOk=true;
const writes:Record<string,unknown>[]=[],opened:Record<string,unknown>[]=[];
let finish:((value:unknown)=>void)|null=null;
let recoveryCard:ZoeCard|undefined,recoveryStatus='ok';
const native=createRequire(import.meta.url),cache=new Map<string,Record<string,unknown>>();
function load(file:string):Record<string,unknown>{
 file=resolve(file);if(cache.has(file))return cache.get(file)!;
 const exports:Record<string,unknown>={};cache.set(file,exports);
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,crypto:globalThis.crypto,Date,Intl,FormData,setTimeout,clearTimeout,console,require(name:string):unknown{
  if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;
  if(name==='server-only')return {};
  if(name==='@/components/patient/zoe-notice')return {ZoeNotice:()=>null};
  if(name==='@/components/patient/zoe-account')return {ZoeAccount:()=>null};
  if(name==='@/components/patient/zoe-booking')return {ZoeBooking:()=>null};
  if(name==='@/lib/zoe-chat-actions/medicines-actions')return {readMedicinesFromCard:async()=>({status:readStatus,data:{enabled:true,own:[],plan:[],asks:[],now:'2026-11-01T10:00:00Z',token:'a'.repeat(64)}})};
  if(name==='@/lib/member-medicines/actions')return {};
  if(name==='@/lib/ldl/actions')return {};
  if(name==='@/lib/observability/logger')return {log:{error(){},warn(){},info(){},debug(){}},errorFields:()=>({})};
  if(name==='@/lib/observability/with-logging')return {loggedAction:(_name:string,fn:unknown)=>fn};
  if(name==='next/link')return {default:({children,...p}:{children:React.ReactNode})=>React.createElement('a',p,children)};
  if(name==='next/navigation')return {useRouter:()=>({refresh(){},push(){throw Error('Unexpected page navigation');},replace(){throw Error('Unexpected page navigation');}})};
  if(name==='@/components/ui/button')return {Button:({children,...p}:{children:React.ReactNode})=>React.createElement('button',p,children)};
  if(name==='@/components/ui/input')return {Input:(p:Record<string,unknown>)=>React.createElement('input',p)};
  if(name==='@/components/ui/label')return {Label:({children,...p}:{children:React.ReactNode})=>React.createElement('label',p,children)};
  if(name==='@/lib/zoe-chat-actions/everyday-actions')return {
   readEverydayFromCard:async()=>({status:readStatus,data,completedLessonId}),readPlanFromCard:async()=>({status:readStatus,plan:planData,doses,pendingReview:false,version:fixturePlanVersion,medicineChanges:fixtureMedicineChanges}),
   saveEverydayFromCard:async(v:Record<string,unknown>)=>{writes.push(v);return new Promise(r=>{finish=r;});},
   openEverydayCard:async(v:Record<string,unknown>)=>{opened.push(v);return {status:'ok',card:makeCard('help')};},
  };
  if(name==='@/lib/zoe-chat-actions/labs-actions')return {askAdminToChangeVisit:()=>{throw Error('Unexpected admin request');}};
  if(name==='@/lib/zoe-chat-actions/booking-actions')return {bookVisitFromCard:()=>{throw Error('Unexpected booking request');}};
  if(name==='@/lib/zoe-chat-actions/actions')return {openZoeCard:async(v:Record<string,unknown>)=>{opened.push(v);return recoveryCard?{status:recoveryStatus,card:recoveryStatus==='ok'?recoveryCard:undefined}:{status:'ok',card:makeCard('help')};}};
  if(name==='@/app/patient/learn/actions')return {markLessonDone:()=>{throw Error('Lesson bypassed its card');}};
  if(name==='@/app/patient/care/actions')return {acknowledgePlan:()=>{throw Error('Plan bypassed its card');},reportDose:async(...args:unknown[])=>{assert.equal(args[0],fixturePlan.medications[0].id);assert.equal(args[3],fixturePlan.id);doseWrites++;if(!doseOk)return {ok:false,reason:'conflict'};doses=[{...doses[0],status:'taken',revision:1}];return {ok:true};}};
  if(name==='@/app/patient/actions')return {recordMeasurement:()=>{throw Error('Unexpected ordinary BP action');}};
  if(name==='@/lib/bp-week/actions')return {startMyBpWeek:async()=>({status:'started'}),stopMyBpWeek:async()=>({status:'stopped'}),setMyBpWeekReminders:async()=>({status:'saved'}),recordBpWeekReading:async()=>({status:'saved'})};
  if(name.startsWith('@/')||name.startsWith('.')){
   const path=name.startsWith('@/')?resolve(name.slice(2)):resolve(dirname(file),name);
   for(const ext of ['','.tsx','.ts','.mjs','/index.ts'])if(existsSync(path+ext)&&statSync(path+ext).isFile())return load(path+ext);
  }
  return native(name);
 }});return exports;
}
const {ZoeEveryday,ShowEveryday,ZoePlanDetails}=load('components/patient/zoe-everyday.tsx') as typeof import('../components/patient/zoe-everyday');
function makeCard(view:string){return cardSchema.parse({id:fixtureId(1),requestId:fixtureId(2),kind:'menu',source:'chip',sourceSeq:null,state:'open',claims:{},outcome:{},at:'2026-11-01T00:00:00Z',snapshot:{v:1,view,token:'a'.repeat(64)}});}
const mount=async(view:string,l:'en'|'hy'|'ru'='en',card:ZoeCard=makeCard(view),override?:EverydayRead)=>{
 data=override??everydayFixtures[view];let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(React.createElement(ZoeEveryday,{card:card as Parameters<typeof ZoeEveryday>[0]['card'],locale:l,onCard(){}}));});return tree;
};
const text=(tree:ReactTestRenderer)=>JSON.stringify(tree.toJSON());
const unmount=async(tree:ReactTestRenderer)=>act(async()=>tree.unmount());
for(const l of ['en','hy','ru'] as const)for(const view of EVERYDAY_VIEWS){
 const tree=await mount(view,l);assert(tree.root.findAllByProps({'data-zoe-everyday':view}).length,`${view} renders in ${l}`);
 assert(!tree.root.findAll(n=>n.type==='a').some(n=>/^\/patient\/(team|care|review|help|learn|bp-week|progress|health)/.test(n.props.href??'')),`${view} has no everyday page escape`);
 const ids=tree.root.findAll(n=>typeof n.type==='string'&&typeof n.props.id==='string').map(n=>n.props.id);assert.equal(new Set(ids).size,ids.length);
 await unmount(tree);
}
for(const status of ['stale','unavailable','signed_out','disabled']){
 readStatus=status;const tree=await mount('earlier');assert.equal(tree.root.findAll(n=>n.type==='form').length,0);assert(text(tree).length>50);await unmount(tree);
}
readStatus='ok';
const earlier=await mount('earlier');
const recovery=JSON.stringify(earlier.root.findAll(n=>n.type==='section'&&String(n.props['aria-labelledby']).endsWith('-values-title'))[0].findAll(n=>typeof n.type==='string').flatMap(n=>n.children.filter(x=>typeof x==='string')));
assert.match(recovery,/LDL cholesterol/,'Recovery identifies the analyte, not only the same date/value/unit');
assert.match(recovery,/Total cholesterol/);
assert.match(recovery,/From you, not verified/);
const numbers=earlier.root.findAll(n=>n.type==='input'&&n.props.type==='number');
await act(async()=>{numbers[0].props.onChange({target:{value:'125'}});numbers[1].props.onChange({target:{value:'80'}});earlier.root.findAll(n=>n.type==='input'&&n.props.type==='date')[0].props.onChange({target:{value:'2020-01-01'}});});
const submit=earlier.root.findByType('form').props.onSubmit;
await act(async()=>{void submit({preventDefault(){}});void submit({preventDefault(){}});});
assert.equal(writes.length,1,'Double press from real ValueForm submits once');assert.equal(writes[0].view,'earlier');
data={...everydayFixtures.earlier,history:{...(everydayFixtures.earlier as Extract<EverydayRead,{view:'earlier'}>).history!,values:[{id:fixtureId(80),measure:'bp',value:125,value2:80,unit:'mmHg',measuredOn:'2020-01-01',source:'member-reported'}]}} as EverydayRead;
await act(async()=>finish!({status:'ok',result:{status:'saved'}}));
assert.match(text(earlier),/Your earlier value was saved/);assert.match(text(earlier),/125\/80/,'Saved card keeps the actual value visible');assert.equal(earlier.root.findAll(n=>n.type==='form').length,0);await unmount(earlier);

const closedEarlier=cardSchema.parse({...makeCard('earlier'),state:'done',outcome:{everyday:{attempted:true},'everyday:result':{status:'saved'}}});
const savedData=data;
const reloadedEarlier=await mount('earlier','en',closedEarlier,savedData);
assert.match(text(reloadedEarlier),/125\/80/,'Reloaded saved card still shows the saved value');
assert.equal(reloadedEarlier.root.findAllByType('form').length,0);await unmount(reloadedEarlier);

const lesson=await mount('lessons');const mark=lesson.root.findAll(n=>n.type==='button'&&JSON.stringify(n.props.children).includes('Mark as done'))[0];
await act(async()=>{mark.props.onClick();mark.props.onClick();});assert.equal(writes.length,2,'Lesson double press executes once');assert.equal(writes[1].view,'lessons');
await act(async()=>finish!({status:'ok',result:{status:'refused'}}));assert.match(text(lesson),/not saved/);assert.equal(lesson.root.findAll(n=>n.type==='select').length,0);await unmount(lesson);

const completed=await mount('lessons');
const lessonData=everydayFixtures.lessons;assert(lessonData.view==='lessons');
const second=lessonData.lessons[1];
await act(async()=>completed.root.findByType('select').props.onChange({target:{value:second.id}}));
const doneButton=completed.root.findAll(n=>n.type==='button'&&JSON.stringify(n.props.children).includes('Mark as done'))[0];
await act(async()=>doneButton.props.onClick());
completedLessonId=second.id;
data={...lessonData,progress:{...lessonData.progress!,done:[{lessonId:second.id,doneAt:'2026-11-01T10:00:00Z'}]}};
await act(async()=>finish!({status:'ok',result:{status:'saved'}}));
assert(text(completed).includes(second.title.en),'Completing keeps the selected lesson readable');
assert.equal(completed.root.findAllByProps({'data-lesson-done':true}).length,1,'Completed lesson keeps its done mark');
await unmount(completed);
const closedLesson=cardSchema.parse({...makeCard('lessons'),state:'done',outcome:{everyday:{attempted:true},'everyday:result':{status:'saved'}}});
const reloadedLesson=await mount('lessons','en',closedLesson,data);
assert(text(reloadedLesson).includes(second.title.en),'Reload restores the completed lesson');
assert.equal(reloadedLesson.root.findAllByProps({'data-lesson-done':true}).length,1);
assert(reloadedLesson.root.findAllByType('fieldset').some(n=>n.props.disabled),'Completed lesson cannot submit another choice');
await unmount(reloadedLesson);completedLessonId=undefined;

// Earlier values appear in result history with their member provenance, even without clinic results.
const reported=data=everydayFixtures.earlier;assert(reported.view==='earlier');
const history=everydayFixtures.result_history;assert(history.view==='result_history');
const historyTree=await mount('result_history','en',makeCard('result_history'),{...history,results:[],reportedValues:reported.history!.values});
assert.match(text(historyTree),/LDL cholesterol/);assert.match(text(historyTree),/From you, not verified/);assert.match(text(historyTree),/4.2 mmol/);
await unmount(historyTree);

const planCard=cardSchema.parse({id:fixtureId(3),requestId:fixtureId(4),kind:'plan',source:'chip',sourceSeq:null,state:'open',claims:{},outcome:{},at:'2026-11-01T00:00:00Z',snapshot:{v:1,available:true,plan:{id:fixturePlan.id,clinician:fixturePlan.clinician,publishedAt:fixturePlan.publishedAt,instructions:fixturePlan.instructions,version:1,medicines:[],acknowledged:false}}});
// Only the snapshot's fields are persisted; the full plan comes from its authorized current-plan read.
assert(planCard.valid&&planCard.kind==='plan');
const planActions:Array<[string,boolean]>=[];
let plan!:ReactTestRenderer;await act(async()=>{plan=create(React.createElement(ZoePlanDetails,{card:planCard,locale:'en',onCard(){},onAct:(id:string,on:boolean)=>planActions.push([id,on])}));});
assert.match(text(plan),/Synthetic medicine/,'Full plan includes structured medication orders before acknowledgement');assert.match(text(plan),/Synthetic dose/);assert.match(text(plan),/08:00/);assert.match(text(plan),/Synthetic prescription instructions/);
assert.match(text(plan),/Today’s check-ins/);assert.match(text(plan),/Change reminder times/);
const taken=plan.root.findAll(n=>n.type==='button'&&n.props.children==='Mark as taken')[0];assert(taken);
doseOk=false;await act(async()=>taken.props.onClick());assert.match(text(plan),/Your check-in changed/);assert.doesNotMatch(text(plan),/Reported taken/,'A refused dose stays unmarked');
doseOk=true;await act(async()=>taken.props.onClick());assert.equal(doseWrites,2);assert.match(text(plan),/Reported taken/,'Dose save refreshes current ticks in the card');
assert.match(text(plan),/Synthetic complete published instructions/);assert.match(text(plan),/Synthetic follow-up/);
// Compare the actual instruction component in chat with the care page's full props.
const {ApprovedPlan}=load('components/patient-care/care-layout.tsx') as typeof import('../components/patient-care/care-layout');
let careInstructions!:ReactTestRenderer;
await act(async()=>{careInstructions=create(React.createElement(ApprovedPlan,{plan:fixturePlan,locale:'en',version:fixturePlanVersion,medicineChanges:fixtureMedicineChanges,readAction:React.createElement('button',null,'I have read my plan')}));});
for(const instruction of [fixturePlanVersion.changeSummary,'Stopped: Synthetic stopped medicine, Old dose','Dose changed: Synthetic medicine, from Previous dose to Synthetic dose','Times changed: Synthetic medicine, from 07:00 to 08:00, 20:00']){
 assert(text(careInstructions).includes(instruction),'Care page renders the revised instruction');
 assert(text(plan).includes(instruction),`Chat must show the same revised instruction: ${instruction}`);
 assert(text(plan).indexOf(instruction)<text(plan).indexOf('I have read my plan'),'Revised instructions precede acknowledgement');
}
await unmount(careInstructions);
const ack=plan.root.findAll(n=>n.type==='button'&&JSON.stringify(n.props.children).includes('I have read my plan'))[0];
await act(async()=>{ack.props.onClick();ack.props.onClick();});assert.equal(writes.length,4);assert.equal(writes[3].view,'plan_ack');
assert.deepEqual(planActions,[[planCard.id,true]],'V3 marks the local plan action before the response, so a lost reply can still follow the saved turn');
planData={...fixturePlan,acknowledgedAt:'2026-11-01T10:24:00Z'};
await act(async()=>finish!({status:'ok',result:{status:'saved'}}));assert.match(text(plan),/marked this plan as read/);assert.match(text(plan),/14:24/,'Read receipt includes recorded Armenia time');await unmount(plan);

planData={...fixturePlan};
// Reloading the card reads the full revision again; failed reads never offer acknowledgement.
for(const status of ['ok','stale','unavailable','signed_out','disabled']){
 readStatus=status;
 let reloaded!:ReactTestRenderer;
 await act(async()=>{reloaded=create(React.createElement(ZoePlanDetails,{card:planCard,locale:'en',onCard(){}}));});
 const buttons=reloaded.root.findAll(n=>n.type==='button'&&JSON.stringify(n.props.children).includes('I have read my plan'));
 assert.equal(buttons.length,status==='ok'?1:0,`${status}: only a loaded plan may be acknowledged`);
 if(status==='ok')assert(text(reloaded).includes(fixturePlanVersion.changeSummary),'Reload retains revised instructions');
 await unmount(reloaded);
}
readStatus='ok';planData={...fixturePlan};

let current!:ReactTestRenderer;await act(async()=>{current=create(React.createElement(ShowEveryday,{view:'earlier',locale:'en',onCard(){}}));});
await act(async()=>{const click=current.root.findByType('button').props.onClick;void click();void click();});assert.equal(opened.length,1,'Show current double press opens once');await unmount(current);
console.log('Everyday UI: eight views × three locales; no everyday page escapes; unavailable/stale/signed-out states; earlier save receipt; lesson refusal; full plan and acknowledgement; real-control double presses passed (offline IO and primitive UI controls).');

function emptyFixture(value:EverydayRead):EverydayRead {
 switch(value.view){
  case 'bp_week':return {...value,read:{version:'bp-week-v1' as const,enabled:true,memberCanStart:false,today:'2026-11-01',currentDevice:null,weeks:[]}};
  case 'earlier':return {...value,history:{documents:[],values:[],clinic:{bp:[],observations:[]}}};
  case 'result_history':return {...value,results:[],tests:[],reportedValues:[]};
  case 'previous_plans':return {...value,publications:[]};
  case 'lessons':return {...value,lessons:[]};
  case 'answers':return {...value,assessment:{...value.assessment,answers:{}}};
  case 'team':return {...value,clinician:null,contact:{mode:'none'}};
  case 'help':return {...value,contact:{mode:'none'}};
 }
}
for(const l of ['en','hy','ru'] as const)for(const view of EVERYDAY_VIEWS){
 const tree=await mount(view,l,makeCard(view),emptyFixture(everydayFixtures[view]));
 assert(text(tree).length>100,`${view}: fresh member has readable content in ${l}`);
 if(view==='lessons'||view==='previous_plans')assert.equal(tree.root.findAll(n=>n.type==='select').length,0);
 await unmount(tree);
}
const noProgress=everydayFixtures.lessons;
assert(noProgress.view==='lessons');
const unreadableProgress=await mount('lessons','en',makeCard('lessons'),{...noProgress,progress:null});
assert.equal(unreadableProgress.root.findAll(n=>n.type==='button'&&JSON.stringify(n.props.children).includes('Mark as done')).length,0,'Unreadable lesson progress must not assume unfinished');
await unmount(unreadableProgress);
const staleWrite=await mount('earlier');
await act(async()=>{
 const ns=staleWrite.root.findAll(n=>n.type==='input'&&n.props.type==='number');
 ns[0].props.onChange({target:{value:'125'}});ns[1].props.onChange({target:{value:'80'}});
 staleWrite.root.findAll(n=>n.type==='input'&&n.props.type==='date')[0].props.onChange({target:{value:'2020-01-01'}});
});
await act(async()=>{void staleWrite.root.findByType('form').props.onSubmit({preventDefault(){}});});
await act(async()=>finish!({status:'stale'}));
assert.match(text(staleWrite),/These details changed/,'A stale write is explicitly stale, not an unconfirmed save');
assert.equal(staleWrite.root.findAll(n=>n.type==='form').length,0);await unmount(staleWrite);
console.log('Everyday UI: fresh/empty states in all three locales; unavailable lesson progress; stale-during-save recovery passed.');

// Assemble the actual frame and medicine body: one current-list action in every state.
const {ZoeCardView}=load('components/patient/zoe-cards.tsx') as typeof import('../components/patient/zoe-cards');
for(const status of ['ok','stale','unavailable']){
 readStatus=status;
 for(const state of ['open','done'] as const){
  const medicineCard=cardSchema.parse({id:fixtureId(50),requestId:fixtureId(51),kind:'medicines',state,source:'chip',sourceSeq:null,at:'2026-11-01T10:00:00Z',snapshot:{v:1,token:'a'.repeat(64)},claims:{},outcome:{}});
  let medicine!:ReactTestRenderer;await act(async()=>{medicine=create(React.createElement(ZoeCardView,{card:medicineCard,locale:'en',focus:false,onCard(){},chatOnly:true}));});
  assert.equal(medicine.root.findAll(n=>n.type==='button'&&n.props['data-zoe-show-current']===true).length,1,`${state}/${status}: one medicine refresh control`);
  await unmount(medicine);
 }
}
console.log('Assembled medicine cards: one refresh action in open, completed, stale and unavailable states.');

// Member cards do not expose staging editorial chrome or repeat their own heading.
readStatus='ok';
for(const locale of ['en','hy','ru'] as const){
 const lesson=await mount('lessons',locale);assert.equal(lesson.root.findAll(n=>typeof n.type==='string'&&String(n.props.className).includes('status-warning-bg')).length,0);await unmount(lesson);
 const team=await mount('team',locale);assert.equal(team.root.findAllByType('h1').length,0);assert.equal(team.root.findAll(n=>n.type==='button'&&n.props.children==='Message your care team').length,0);await unmount(team);
 const off=await mount('bp_week',locale,makeCard('bp_week'),{view:'bp_week',token:'a'.repeat(64),showDevice:false,read:{version:'bp-week-v1',enabled:false}});assert(off.root.findAll(n=>n.type==='a'&&n.props.href==='/patient/zoe?card=bp').length);assert(off.root.findAll(n=>n.type==='a'&&n.props.href==='/patient/zoe?card=team').length);await unmount(off);
}
console.log('Fresh-eyes everyday: embedded lesson chrome, concise team and actionable gated BP-week states passed in three locales.');

const {RecommendedTests}=load('components/patient-care/recommended-tests.tsx') as typeof import('../components/patient-care/recommended-tests');
const {TEST_CATALOGUE}=await import('@/lib/clinical/seed/tests');
const {evaluate}=await import('@/lib/clinical/rules/engine');
for(const locale of ['en','hy','ru'] as const){
 let suggestions!:ReactTestRenderer;
 await act(async()=>{suggestions=create(React.createElement(RecommendedTests,{compact:true,questionnaireOnly:true,tests:TEST_CATALOGUE.slice(0,2),decision:evaluate({answers:{},observations:[]}),locale}));});
 assert.equal(suggestions.root.findAllByType('details').length,2,'One disclosure per suggested check');
 assert.equal(suggestions.root.findAllByType('summary').length,2,'No repetitive nested reason rows');
 await unmount(suggestions);
 const answers=await mount('answers',locale);assert.equal(answers.root.findAllByType(RecommendedTests).length,0,'Answers do not repeat the suggested test list');await unmount(answers);
}
console.log('Suggested checks use one disclosure per test and answers have no repeated test catalogue in three locales.');

// Empty BP forms have nothing newer to load; receipts and existing readings do.
for(const snapshot of [{v:1,week:null},{v:1,week:null,latest:{systolic:120,diastolic:80,pulse:null,measuredAt:'2026-11-01T10:00:00Z'}},{v:1,week:null,typed:{systolic:120,diastolic:80,pulse:null,measuredAt:'2026-11-01T10:00:00Z'}}]){
 const card=cardSchema.parse({id:fixtureId(60),requestId:fixtureId(61),kind:'bp',state:'open',source:'chip',sourceSeq:null,at:'2026-11-01T10:00:00Z',snapshot,claims:{},outcome:{}});
 for(const saved of [false,true]){
  let tree!:ReactTestRenderer;
  await act(async()=>{tree=create(React.createElement(ZoeCardView,{card:{...card,outcome:saved?{bp:{systolic:120,diastolic:80,pulse:null}}:{}},locale:'en',focus:false,onCard(){}}));});
  assert.equal(tree.root.findAll(n=>n.type==='button'&&n.props['data-zoe-show-current']===true).length,Number(saved||'latest' in snapshot),'Refresh only when a BP card has saved/current content to update');
  await unmount(tree);
 }
}
const gatedWeek=await mount('bp_week','en',makeCard('bp_week'),{view:'bp_week',token:'a'.repeat(64),showDevice:false,read:{version:'bp-week-v1',enabled:false}});
assert.match(text(gatedWeek),/Week tracking is turned off/,'The database gate is explicit, not a temporary outage');
assert.doesNotMatch(text(gatedWeek),/unavailable right now/);
await unmount(gatedWeek);
console.log('BP cards: useful refresh visibility and explicit week gate passed.');

readStatus='unavailable';
const failedWeek=await mount('bp_week');
assert.match(text(failedWeek),/Your blood pressure week could not be loaded/);
assert.doesNotMatch(text(failedWeek),/Week tracking is turned off/,'A failed load cannot claim that tracking is disabled');
await unmount(failedWeek);
readStatus='ok';

// Finished dialogs and an unreadable current view retain the Home recovery control.
const {JourneyRecordCard,JourneyRecordTurn}=load('components/chat-v2/results-message-card.tsx') as typeof import('../components/chat-v2/results-message-card');
const {VisitCard,SavedVisitTurn}=load('components/chat-v2/visit-card.tsx') as typeof import('../components/chat-v2/visit-card');
for(const kind of ['visit','plan'] as const)for(const state of ['refused','unavailable'] as const){
 const snapshot=kind==='visit'?{v:1,available:true,next:null,proposal:null,attention:false}:planCard.snapshot;
 const failed=cardSchema.parse({id:fixtureId(71),requestId:fixtureId(72),kind,snapshot,source:'chip',sourceSeq:null,state:'done',at:'2026-11-01T09:00:00Z',claims:{everyday:{op:fixtureId(73),payload:{view:'plan_ack'}}},outcome:kind==='visit'?{booking:{kind:'select',ok:false,outcomeUnknown:state==='unavailable',doneAt:'2026-11-01T10:00:00Z'}}:{'everyday:result':{status:state,doneAt:'2026-11-01T10:00:00Z'}}});
 assert(failed.valid&&(failed.kind==='visit'||failed.kind==='plan'));
 recoveryCard=cardSchema.parse({...failed,id:fixtureId(74),requestId:fixtureId(75),state:'open',outcome:{},claims:{}});
 const delivered:ZoeCard[]=[];let turn!:ReactTestRenderer;
 await act(async()=>{turn=create(failed.kind==='visit'
  ?React.createElement(SavedVisitTurn,{card:failed,locale:'en',time:'14:00',onCard:c=>delivered.push(c)})
  :React.createElement(JourneyRecordTurn,{card:failed,locale:'en',time:'14:00',onCard:c=>delivered.push(c)}));});
 const refresh=()=>turn.root.findByProps({'data-zoe-show-current':true});
 recoveryStatus='unavailable';await act(async()=>refresh().props.onClick());
 assert.equal(delivered.length,0,'A failed recovery cannot imply new details');
 const request=opened.at(-1)!.requestId;
 recoveryStatus='ok';await act(async()=>refresh().props.onClick());
 assert.equal(opened.at(-1)!.requestId,request,'Recovery retry retains its request id');
 assert.equal(opened.at(-1)!.kind,kind);assert.equal(delivered[0]?.id,recoveryCard.id,'The closed dialog can open a fresh matching record');
 await unmount(turn);
 readStatus='unavailable';let active!:ReactTestRenderer;
 assert(recoveryCard.valid&&(recoveryCard.kind==='visit'||recoveryCard.kind==='plan'));
 await act(async()=>{active=create(recoveryCard!.valid&&recoveryCard!.kind==='visit'
  ?React.createElement(VisitCard,{card:recoveryCard!,locale:'en',onCard:c=>delivered.push(c),onAct(){},current:true})
  :React.createElement(JourneyRecordCard,{card:recoveryCard as Parameters<typeof JourneyRecordCard>[0]['card'],locale:'en',onCard:c=>delivered.push(c),onAct(){}}));});
 await act(async()=>active.root.findByProps({'data-zoe-show-current':true}).props.onClick());
 assert.equal(opened.at(-1)!.kind,kind,'Initial read failure keeps the same recovery control');
 await unmount(active);readStatus='ok';recoveryCard=undefined;
}
console.log('Merged visit and plan wrappers: refused/unknown booking and plan acknowledgement, initial read failure and request-stable recovery passed with isolated IO.');
