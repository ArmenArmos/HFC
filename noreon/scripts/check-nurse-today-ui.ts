import {resolveTestModule} from './care-alert-resolve-test-module';
import * as taskCopy from '@/lib/staff/real-coordination/task-copy';
import * as displayText from '@/lib/staff/display-text';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import * as schema from '@/lib/staff/real-coordination/schema';
import {nurseVisitChatHref} from '@/components/staff/nurse-chat-visit-list';
import * as todayModel from '@/lib/nurse-chat/today';
import * as localeCopy from '@/lib/staff/staff-locale-copy';
import * as serverCopy from '@/lib/staff/staff-server-copy';
import * as localeModule from '@/lib/locale';
import {stamp} from '@/components/patient-care/common';
import {selectFieldNativeStub} from './select-field-native-stub';
import * as statusCopy from '@/lib/staff/real-coordination/status-copy';
import * as handoffCopy from '@/lib/nurse-chat/handoff-copy';
import {alertCardFields} from '@/lib/staff/alert-card';
import * as careAlertContracts from '@/lib/care-alerts/contracts';
import * as yerevanTime from '@/lib/staff/yerevan-time';
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id=(n:number)=>`ad130000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const at='2026-10-31T08:00:00Z',actor={id:id(3),role:'nurse' as const};
const task:schema.CoordinationTask={id:id(20),caseId:id(1),memberName:'Fictional member',kind:'contact-followup',title:'Arrange your visit',instructions:'Confirm the visit time with the member.',dueAt:'2026-10-31T09:00:00Z',creatorId:id(2),ownerId:actor.id,ownerName:'Fictional nurse',status:'open',revision:1,createdAt:at,updatedAt:at,needsReassignment:false,eligibleOwners:[{id:actor.id,name:'Fictional nurse',role:'nurse'},{id:id(2),name:'Fictional doctor',role:'doctor'}]};
const visit={source:'home-request' as const,id:id(10),memberId:id(1),memberName:'Fictional member',arrangementToken:'1',startsAt:'2026-10-31T07:00:00Z',endsAt:null,mode:'home' as const,location:null,bookingStatus:'confirmed' as const,completion:null,samplesPlanned:1,samplesTaken:0,openItems:2,steps:[],nurseName:'Fictional nurse'};
const initial={ok:true as const,identities:[],page:{tasks:Array.from({length:9},(_,i)=>({...task,id:id(20+i),title:`Coordination ${i+1}`})),nextCursor:{createdAt:at,id:id(28)}},visits:{version:'nurse-visit-v1' as const,enabled:true as const,today:'2026-10-31',role:'nurse' as const,visits:[visit]},asOf:at};
let readCalls=0,next:Awaited<ReturnType<typeof import('@/lib/nurse-chat/today-actions').readNurseToday>>={...initial,page:{tasks:[{...task,id:id(29),title:'Loaded more work'}],nextCursor:null}};
let currentTask=task;
const actions={readCoordinationPage:async()=>{readCalls++;return next.ok?{ok:true,page:next.page}:{ok:false,error:'Unavailable'};},coordinationCommand:async()=>({ok:false,error:'Not used'}),refreshCoordinationTask:async()=>({ok:true,task:{...currentTask,events:[]}})};
const resolveFormModule=resolveTestModule();
function load(path:string):Record<string,unknown>{
 const exports:Record<string,unknown>={};
 const dependencies:Record<string,unknown>={
  react:React,'react/jsx-runtime':jsx,'next/navigation':{useRouter:()=>({refresh(){}})},
  'next/link':{default:(props:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement('a',props)},
  'lucide-react':{ArrowRight:()=>React.createElement('svg'),UserRound:()=>React.createElement('svg')},
  '@/lib/staff/real-coordination/task-copy':taskCopy,'@/lib/staff/real-coordination/actions':actions,'@/lib/staff/real-coordination/schema':schema,
  '@/components/patient-care/common':{stamp},'./shell':{fieldClass:'dw-input',buttonClass:'dw-pill'},
  '@/components/ui/select-field':selectFieldNativeStub,'@/lib/staff/staff-server-copy':serverCopy,
  '@/lib/staff/staff-locale-copy':localeCopy,'@/lib/locale':localeModule,'@/lib/nurse-chat/today':todayModel,
  '@/lib/nurse-chat/handoff-copy':handoffCopy,'@/lib/staff/real-coordination/status-copy':statusCopy,'./nurse-chat-visit-list':{nurseVisitChatHref},
  '@/lib/care-alerts/actions':{changeCareAlert:async()=>({ok:false,code:'unavailable'})},'@/lib/staff/alert-card':{alertCardFields},'@/lib/staff/display-text':displayText,
  '@/lib/care-alerts/contracts':careAlertContracts,'@/lib/staff/yerevan-time':yerevanTime,
  './care-alert-resolve':resolveFormModule,
  '@/lib/nurse-chat/today-actions':{readNurseToday:async()=>{readCalls++;return next;}},
 };
 new vm.Script(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText).runInNewContext({exports,crypto,Date,Map,FormData,require:(name:string)=>{
  if(name==='./real-coordination-tasks')return load('components/staff/real-coordination-tasks.tsx');
  if(name==='./alert-card')return load('components/staff/alert-card.tsx');
  if(name==='./nurse-urgent-alerts')return load('components/staff/nurse-urgent-alerts.tsx');
  if(name==='@/components/staff/record-refresh')return load('components/staff/record-refresh.tsx');
  assert.ok(name in dependencies,`Unexpected dependency ${name}`);return dependencies[name];
 }});
 return exports;
}
const Today=load('components/staff/nurse-today.tsx').NurseToday as typeof import('@/components/staff/nurse-today').NurseToday;
const Handoffs=load('components/staff/nurse-handoffs.tsx').NurseHandoffs as typeof import('@/components/staff/nurse-handoffs').NurseHandoffs;
const TaskRow=load('components/staff/real-coordination-tasks.tsx').TaskRow as typeof import('@/components/staff/real-coordination-tasks').TaskRow;
{
 const alert={id:id(60),memberId:id(1),memberName:'Fictional member',source:'zoe' as const,priority:'urgent' as const,reason:'zoe_urgent_route',redFlags:[],state:'open' as const,stateSeq:0,occurrences:1,createdAt:at,lastSeenAt:at,acknowledgedAt:null,doctorName:null,acknowledgedBy:null,resolvedAt:null,resolvedBy:null,resolution:null,resolutionNote:null,telegram:[],ownerName:'Fictional nurse',ownerRole:'nurse' as const};
 const html=(alerts:unknown)=>renderToStaticMarkup(React.createElement(Today,{initial:{...initial,alerts} as unknown as typeof initial,actor,locale:'en'}));
 const ready=html({kind:'ready',alerts:[alert],total:1});
 assert.ok(ready.includes('data-urgent-alert="')&&ready.includes(`/staff/real/nurse-chat?member=${id(1)}`),'Today lists the urgent alert with a link to the member');
 const firstList=ready.slice(ready.indexOf('<ul'),ready.indexOf('</ul>'));
 assert.ok(firstList.includes(`data-urgent-alert="${alert.id}"`)&&firstList.includes('Open visit'),'Urgent alerts and visits share the first work list');
 assert.ok(firstList.indexOf('data-urgent-alert')<firstList.indexOf('Open visit'),'Urgent alerts come before overdue visits');
 const alone=renderToStaticMarkup(React.createElement(Today,{initial:{...initial,page:{tasks:[],nextCursor:null},visits:{...initial.visits,visits:[]},alerts:{kind:'ready',alerts:[alert],total:1}} as unknown as typeof initial,actor,locale:'en'}));
 assert.ok(alone.includes('1 open alerts, tasks and visits')&&!alone.includes('No open work'),'An urgent-only list never claims no open work');
 const unreadable=renderToStaticMarkup(React.createElement(Today,{initial:{...initial,page:{tasks:[],nextCursor:null},visits:{...initial.visits,visits:[]},alerts:{kind:'unavailable'}} as unknown as typeof initial,actor,locale:'en'}));
 assert.ok(!unreadable.includes('No open work'),'An unreadable alert source never claims no open work');
 for(const locale of ['en','hy','ru'] as const){
  const translated=renderToStaticMarkup(React.createElement(Today,{initial:{...initial,alerts:{kind:'ready',alerts:[alert],total:1}} as unknown as typeof initial,actor,locale}));
  assert.ok(translated.includes(`data-urgent-alert="${alert.id}"`),'Urgent work renders in every staff locale');
 }

 assert.ok(html({kind:'unavailable'}).includes('data-urgent-alerts="unavailable"')&&!html({kind:'off'}).includes('data-urgent-alerts'));
}
let tree!:ReactTestRenderer;
try{
 await act(async()=>{tree=create(React.createElement(Today,{initial,actor,locale:'en'}));});
 const text=()=>JSON.stringify(tree.toJSON());
 assert.equal(readCalls,0);
 const history=tree.root.findAllByType('details').find(n=>n.findAllByType('summary').some(summary=>summary.children.join('').includes('Task filters and history')))!;
 assert.equal(history.findAllByType('button').filter(n=>String(n.props['aria-label']).startsWith('Open Coordination')).length,9,'Task filter card retains all loaded tasks');
 const openList=tree.root.findByType(Today).findAllByType('ul')[0];
 assert.equal(openList.children.length,10,'Every open task and visit is visible without opening history');
 assert.equal(tree.root.findAllByType('details').filter(n=>n.props.name==='nurse-today-work'&&n.props.open).length,0,'Filters and history stay collapsed beside the complete open work list');
 assert.ok(tree.root.findAllByType('a').every(n=>!String(n.props.href).startsWith('/staff/real/visits/')),'Visit links stay in chat');
 assert.ok(text().indexOf('Overdue')<text().indexOf('Coordination 1'),'Overdue visit appears before later tasks');
 const button=(label:string)=>tree.root.findAllByType('button').find(n=>n.children.join('').includes(label))!;
 const historyTask=tree.root.findAll(node=>node.props.initial?.id===id(20)&&typeof node.props.onChanged==='function')[0];
 await act(async()=>historyTask.props.onChanged({...initial.page.tasks[0],status:'completed',revision:2}));
 assert.ok(tree.root.findAllByType('p').some(p=>p.children.join('')==='9 open alerts, tasks and visits · 1 overdue'),'History mutations update Today counts');

 await act(async()=>button('Load more tasks').props.onClick());
 assert.ok(text().includes('Loaded more work'));assert.equal(readCalls,1);
 next={ok:false,code:'denied'};
 await act(async()=>button('Reload work list').props.onClick());
 assert.equal(text().includes('Fictional member'),false,'Lost access removes old task/visit data');
 await act(async()=>tree.update(React.createElement(Today,{initial:{...initial,page:{tasks:[{...task,status:'completed'}],nextCursor:null},visits:{...initial.visits,visits:[]}},actor,locale:'en'})));
 assert.ok(!text().includes('Your next step'),'Completed-only server refresh has no next action');
 assert.ok(text().includes('No open work in the available list.'),'Completed work remains history, not a next step');
 await act(async()=>tree.unmount());
 const owned=(ownerId:string)=>({...task,ownerId});
 for(const ownerId of [actor.id,id(2)]){
  currentTask=owned(ownerId);
  await act(async()=>{tree=create(React.createElement(TaskRow,{initial:owned(ownerId),actor,l:'en',onChanged(){}}));});
  await act(async()=>tree.root.findByProps({'aria-label':'Open Arrange your visit'}).props.onClick());
  const values=tree.root.findAllByType('option').map(n=>n.props.value);
  assert.equal(values.includes('complete'),true,'Assigned nurse can complete ordinary coordination work regardless of owner');
  assert.equal(values.includes('resolve'),false);assert.equal(values.includes('refer'),false,'Non-referral cannot expose referral action');
  await act(async()=>tree.unmount());
 }
 const empty={...initial,page:{tasks:[],nextCursor:null},visits:{version:'nurse-visit-v1' as const,enabled:false as const,visits:[] as never[]}};
 for(const locale of ['en','hy','ru'] as const){
  const html=renderToStaticMarkup(React.createElement(Today,{initial:empty,actor,locale}));assert.ok(html.includes('role="status"'));
  const unavailable=renderToStaticMarkup(React.createElement(Today,{initial:{...initial,page:null,visits:null},actor,locale}));assert.ok(unavailable.includes('role="alert"'));
 }
 {
  // Each unreadable source is named, never shown as nothing waiting.
  const render=(patch:object)=>renderToStaticMarkup(React.createElement(Today,{initial:{...initial,...patch},actor,locale:'en'}));
  assert.match(render({visits:null}),/Visits could not be read\. The counts are incomplete; do not assume none are due\./);
  assert.match(render({page:null}),/Tasks could not be read\. The counts are incomplete/);
  assert.match(render({page:null,visits:null}),/Tasks and visits could not be read/);
 }
 const handoff={messageId:'m1',messageText:'Fictional source question',topic:'member-request' as const,observation:'Review the member’s question.',nurseName:'Fictional nurse',task:{...task,kind:'doctor-referral' as const,status:'awaiting-doctor' as const,ownerId:id(2),events:[]}};
 const doctor={id:id(2),role:'doctor' as const};
 const html=renderToStaticMarkup(React.createElement(Handoffs,{page:{items:[handoff],hasMore:false},actor:doctor,locale:'en'}));
 assert.ok(html.includes('Fictional source question')&&html.includes(`/staff/real/conversations/${id(1)}#handoff-${task.id}`));
 assert.ok(html.includes('Awaiting doctor'));
 console.log('Nurse Today/handoff controls: mixed work list, all open work, collapsed task filters/history, more-task paging, access loss, assigned-nurse completion, source link, locales and empty/unavailable/visit-off states passed (mocked IO).');
}finally{if(tree)await act(async()=>tree.unmount());}

