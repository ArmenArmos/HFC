import {resolveTestModule} from './care-alert-resolve-test-module';
import {UploadIdentityChecks} from '@/components/staff/upload-identity-check';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {PathnameContext,SearchParamsContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime.js';
import {nurseChatNewScreen} from '@/lib/nurse-chat/config';
import ts from 'typescript';
import * as copy from '@/lib/staff/staff-locale-copy';
import * as displayText from '@/lib/staff/display-text';
import {staffPathAllowed} from '@/lib/staff/hosts';
import {NurseChatShell} from '@/components/staff/nurse-chat-shell';
import * as contracts from '@/lib/nurse-chat/contracts';
import * as conversationCopy from '@/lib/nurse-chat/conversation-copy';
import * as urgentGuidance from '@/components/staff/nurse-urgent-guidance';
import * as time from '@/lib/staff/yerevan-time';
import * as handoffCopy from '@/lib/nurse-chat/handoff-copy';
import * as handoffs from '@/lib/nurse-chat/handoffs';
import * as sentHandoffs from '@/lib/nurse-chat/sent-handoffs';
import * as taskStatusCopy from '@/lib/staff/real-coordination/status-copy';
import * as careNoteCopy from '@/lib/staff/care-note-copy';
import * as taskCopy from '@/lib/staff/real-coordination/task-copy';
import * as serverCopy from '@/lib/staff/staff-server-copy';
import * as todayModel from '@/lib/nurse-chat/today';
import * as identityModel from '@/lib/staff/member-identity';
import * as identityComponent from '@/components/staff/member-identity';
import * as bpProvenance from '@/lib/patient/bp-provenance';
import * as chatReported from '@/lib/staff-zoe/chat-reported';
import {z} from 'zod';
import * as staffZoeContracts from '@/lib/staff-zoe/contracts';
import * as staffZoeCopy from '@/lib/staff-zoe/response-copy';
import * as staffZoeStream from '@/lib/staff-zoe/stream';
import * as collection from '@/lib/nurse-visit/collection';
import * as catalogueLabels from '@/lib/patient/catalogue-label';
import * as visitCopy from '@/lib/nurse-visit/copy';
import * as bpCheck from '@/lib/clinical/rules/bp-check';
import * as bpWords from '@/lib/clinical/rules/bp-words';
import {alertCardFields} from '@/lib/staff/alert-card';
import {orderAlerts} from '@/lib/doctor-inbox/contracts';
import * as careAlertContracts from '@/lib/care-alerts/contracts';
import * as localeModule from '@/lib/locale';
import * as visitOrder from '@/lib/nurse-visit/chat-order';
import * as visitParser from '@/lib/nurse-visit/chat-parser';
import * as visitSchema from '@/lib/nurse-visit/schema';
import type {NurseVisitCollectCommand,NurseVisitReady,NurseVisitMarkCommand,NurseVisitStepCommand,NurseVisitCompleteCommand} from '@/lib/nurse-visit/schema';
import type {CoordinationTask,CoordinationCommand,CoordinationSnapshot} from '@/lib/staff/real-coordination/schema';

// Execute the real route/action with isolated auth and IO, never a database.
let flag:string|undefined,enabled=true,role='nurse',auth=0,searches=0;
const View=()=>null;
const readWarnings:string[]=[];
const modules:Record<string,unknown>={'@/lib/bp-unit':await import('@/lib/bp-unit'),'@/components/charts/trend-chart':await import('@/components/charts/trend-chart'),'@/components/staff/upload-identity-check':{UploadIdentityChecks},
 // Voice is unavailable in these typed-chat fixtures; the dedicated voice UI check mounts its dispatch.
 '@/components/chat-v2/conversation':{useConversation:()=>({active:false,edit(){},sent(){}}),ConversationToggle:()=>null},
 '@/components/staff/voice-reply':await import('@/components/staff/voice-reply'),
 '@/lib/staff/display-text':displayText,
 '@/lib/patient/bp-provenance':bpProvenance,
 '@/lib/staff-zoe/chat-reported':chatReported,
 'react/jsx-runtime':jsx,
 'next/navigation':{notFound:()=>{throw Error('404');},redirect:(path:string)=>{throw Error(`redirect:${path}`);},unstable_rethrow:()=>{}},
 '@/lib/staff/real-staff-render':{requireRealStaffForRender:async()=>{auth++;return {identity:{role,name:'Fictional nurse'}};}},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>{auth++;return {identity:{role},client:{}};}},
 '@/lib/staff/staff-locale':{staffLocale:async()=> 'en'},
 '@/lib/staff/staff-locale-copy':copy,
 '@/lib/nurse-chat/config':{nurseChatEnabled:()=>enabled},
 '@/components/nurse-chat-v2/nurse-chat':{NurseChatV2:View},
 '@/lib/staff/member-search-command':{runMemberIdentitySearch:async(raw:unknown)=>{searches++;assert.deepEqual(JSON.parse(JSON.stringify(raw)),{query:'Ani',cursor:null});return {ok:true,page:{rows:[],hasMore:false,nextCursor:null}};}},
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},'@/lib/observability/logger':{log:{warn:(message:string)=>readWarnings.push(message),info:()=>{},error:()=>{}}},
};
let poll:()=>void=()=>{},pollMs=0;
const browser=Object.assign(new EventTarget(),{setInterval:(callback:()=>void,ms:number)=>{poll=callback;pollMs=ms;return 1;},clearInterval:()=>{}});
const location=new URL('http://localhost/staff/real/nurse-chat');
const history={state:{noreonTest:true},replaceState(state:{noreonTest:boolean},_title:string,url:string){this.state=state;location.href=new URL(url,location).href;}};
Object.assign(browser,{location,history});
const visibility=Object.assign(new EventTarget(),{hidden:false});
class SubmittedFormData extends FormData {constructor(form?:FormData){super();form?.forEach((value,key)=>this.append(key,value));}}
function load(file:string){
 const exports:Record<string,unknown>={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  exports,crypto,FormData:SubmittedFormData,AbortController,TextDecoder,TextEncoder,fetch:(...args:Parameters<typeof fetch>)=>chatFetch(...args),window:browser,document:visibility,process:{env:{get NOREON_NURSE_CHAT_V2(){return flag;}}},require:(name:string)=>{if(name.endsWith('.css'))return {};assert.ok(name in modules,name);return modules[name];},
 });
 return exports;
}
const page=load('app/staff/real/(review)/nurse-chat-v2/page.tsx').default as ()=>Promise<React.ReactElement>;
for(flag of [undefined,'false','TRUE','1','true '])await assert.rejects(page,/404/);
assert.equal(auth,0,'Dark route must not authenticate or read');
flag='true';enabled=false;await assert.rejects(page,/404/);assert.equal(auth,0);
enabled=true;
await assert.rejects(page,/redirect:\/staff\/real\/nurse-chat$/,'The old new-chat path leads to the original address');assert.equal(auth,0);
const on={NOREON_NURSE_CHAT:'true',NOREON_NURSE_CHAT_V2:'true'};
assert.equal(nurseChatNewScreen({},on),true,'With the flag on the plain address is the new chat');
for(const query of [{previous:'1'},{member:'id'},{view:'today'},{source:'appointment',visit:'id'}])assert.equal(nurseChatNewScreen(query,on),false,'Any query keeps the previous screen and its links');
for(const env of [{},{NOREON_NURSE_CHAT:'true'},{NOREON_NURSE_CHAT_V2:'true'},{...on,NOREON_NURSE_CHAT_V2:'TRUE'},{...on,NOREON_NURSE_CHAT:'false'}])assert.equal(nurseChatNewScreen({},env),false,'Flag off restores today');

const resolveFormModule=resolveTestModule();
modules['@/components/staff/care-alert-resolve']=resolveFormModule;
modules['./care-alert-resolve']=resolveFormModule;
modules['./config']=modules['@/lib/nurse-chat/config'];
modules.zod={z};
modules['@/lib/nurse-visit/schema']=visitSchema;
let visitReads=0,visitRuntimeFails=false,visitRuntimeAnswer:unknown=null;
modules['@/lib/nurse-visit/runtime']={readNurseVisit:async(_client:unknown,memberId:string,source:string,id:string)=>{visitReads++;if(visitRuntimeFails)throw Error('Read unavailable');return visitRuntimeAnswer??{enabled:true,visit:{id,source,memberId}};}};

const {searchNurseChatMembers,readNurseChatVisit}=load('lib/nurse-chat/v2-actions.ts') as {searchNurseChatMembers:(query:unknown)=>Promise<{ok:boolean}>;readNurseChatVisit:(member:unknown,source:unknown,id:unknown)=>Promise<unknown>};
for(flag of [undefined,'false','TRUE'])assert.equal((await searchNurseChatMembers('Ani')).ok,false);
flag='true';enabled=false;assert.equal((await searchNurseChatMembers('Ani')).ok,false);enabled=true;
for(role of ['doctor','admin'])assert.equal((await searchNurseChatMembers('Ani')).ok,false);
assert.equal(searches,0,'Disabled and non-nurse requests never reach search');
role='nurse';assert.equal((await searchNurseChatMembers('Ani')).ok,true);assert.equal(searches,1);
const visitUuid='aa110000-0000-4000-8000-000000000001';
for(flag of [undefined,'false','TRUE'])assert.equal(await readNurseChatVisit(visitUuid,'appointment',visitUuid),null);
flag='true';enabled=false;assert.equal(await readNurseChatVisit(visitUuid,'appointment',visitUuid),null);enabled=true;
for(role of ['doctor','admin'])assert.equal(await readNurseChatVisit(visitUuid,'appointment',visitUuid),null);
role='nurse';
for(const args of [['bad','appointment',visitUuid],[visitUuid,'other',visitUuid],[visitUuid,'appointment','bad']])assert.equal(await readNurseChatVisit(...args as [string,string,string]),null);
assert.equal(visitReads,0,'Visit gate and validation never reach the RPC');
assert.deepEqual(JSON.parse(JSON.stringify(await readNurseChatVisit(visitUuid,'appointment',visitUuid))),{enabled:true,visit:{id:visitUuid,source:'appointment',memberId:visitUuid}});assert.equal(visitReads,1);
visitRuntimeFails=true;assert.equal(await readNurseChatVisit(visitUuid,'appointment',visitUuid),'unavailable','A failed read is not a refusal');visitRuntimeFails=false;
visitRuntimeAnswer={status:'unavailable'};assert.equal(await readNurseChatVisit(visitUuid,'appointment',visitUuid),'unavailable','The database saying unavailable is not a refusal either');
visitRuntimeAnswer={status:'access'};assert.equal(await readNurseChatVisit(visitUuid,'appointment',visitUuid),null);
visitRuntimeAnswer={enabled:false};assert.equal(await readNurseChatVisit(visitUuid,'appointment',visitUuid),null);visitRuntimeAnswer=null;


const shell=(newChat:boolean,query='')=>renderToStaticMarkup(React.createElement(SearchParamsContext.Provider,{value:new URLSearchParams(query) as never},React.createElement(PathnameContext.Provider,{value:"/staff/real/nurse-chat"},React.createElement(NurseChatShell,{newChat,locale:"en",nav:React.createElement("a",{href:"/legacy"},"Legacy"),actions:React.createElement("button",null,"Old actions"),fallback:React.createElement("a",{href:"/fallback"},"Old shell")},React.createElement("p",null,"New thread")))));
assert.equal(shell(true),'<p>New thread</p>','The new screen bypasses the old header and links');
assert.match(shell(true,'previous=1'),/data-nurse-chat-shell/,'The previous screen keeps its shell');
assert.match(shell(false),/data-nurse-chat-shell/,'Flag off keeps the shell');
for(const host of ['backoffice.noreon.health','doctor.noreon.health','doctors.noreon.health'])assert.equal(staffPathAllowed(host,'/staff/real/nurse-chat-v2',{NODE_ENV:'production',NOREON_REAL_MEMBER_REVIEW_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fictional'}),true);
assert.equal(staffPathAllowed('app.noreon.health','/staff/real/nurse-chat-v2',{NODE_ENV:'production',NOREON_REAL_MEMBER_REVIEW_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fictional'}),false);
for(const file of readdirSync('components/nurse-chat-v2').filter(f=>f.endsWith('.tsx'))){
 const source=readFileSync(`components/nurse-chat-v2/${file}`,'utf8');
 assert.doesNotMatch(source,/<a\b|\bhref\s*=|router\.(push|replace)|scrollIntoView/,'No navigation or focus scrolling in the nurse screen');
}
console.log('Nurse chat v2: exact flag, parent gate, nurse refusal, search gate, shell passthrough, staff hosts and no leaving links passed (isolated auth/IO).');

// Exercise the real stateful screen and reply components. Only browser layout and
// server IO are replaced; WebKit separately checks the real scrolling and focus.
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const member={id:'aa110000-0000-4000-8000-000000000001',name:'Ani Example',birthYear:1986,birthDate:'1986-01-01',phoneLast4:'1234'};
const dueTask:CoordinationTask={id:'aa330000-0000-4000-8000-000000000001',caseId:member.id,title:'Confirm the visit time',memberName:member.name,kind:'booking-coordination',instructions:'Confirm the time',dueAt:'2026-11-01T09:00:00Z',status:'open',revision:1,creatorId:member.id,ownerId:member.id,ownerName:'Narine',needsReassignment:false,eligibleOwners:[{id:member.id,name:'Narine',role:'nurse'}],createdAt:'2026-10-31T08:00:00Z',updatedAt:'2026-10-31T08:00:00Z'};
let todayResult:unknown={ok:true,identities:[member],asOf:'2026-11-01T08:00:00Z',page:{tasks:[
 dueTask,
 {...dueTask,id:'later',title:'Future task',memberName:member.name,dueAt:'2026-11-03T09:00:00Z',status:'open'},
 {...dueTask,id:'done',title:'Completed task',memberName:member.name,dueAt:'2026-11-01T07:00:00Z',status:'completed'},
],nextCursor:null},visits:{enabled:true,visits:[
 {id:'old-visit',source:'appointment',memberName:'Older Example',startsAt:'2026-10-30T09:00:00Z',completion:null},
 {id:'visit',source:'appointment',memberId:member.id,memberName:member.name,startsAt:'2026-11-01T09:00:00Z',completion:null},
]}};
let todayCalls=0,searchCalls=0,searchFails=false,transportFails=false;
modules.react=React;
modules['@/lib/staff/member-identity']=await import('@/lib/staff/member-identity');
modules['@/lib/staff/chat-member-identity-actions']={readStaffChatMemberIdentities:async(ids:string[])=>ids.map(id=>({id,name:id.endsWith('00000002')?'Mariam Example':'Ani Example',birthDate:id.endsWith('00000002')?'1992-04-15':'1986-11-06',sex:'female',clinic:'Linked clinic',phone:'+37499123456',phoneLast4:'3456',shortId:id.slice(-8).toUpperCase()}))};
modules['@/components/staff/member-identity']=load('components/staff/member-identity.tsx');
modules['./member-identity']=modules['@/components/staff/member-identity'];
modules['@/components/staff/chat-member-identity']=load('components/staff/chat-member-identity.tsx');

modules['lucide-react']={ArrowUp:()=>null,Check:()=>null};
modules['@/components/patient/use-chat-viewport']={useChatViewport:()=>{}};
modules['@/components/chat-v2/use-thread-scroll']={useThreadScroll:()=>({threadRef:null,contentRef:null,unread:false,newest:()=>{}})};
modules['@/lib/nurse-chat/today']=todayModel;
modules['@/lib/nurse-chat/today-actions']={readNurseToday:async()=>{todayCalls++;if(transportFails)throw Error('Offline');return todayResult;}};
modules['@/lib/nurse-chat/v2-actions']={searchNurseChatMembers:async(query:string)=>{searchCalls++;return searchFails?{ok:false,reason:'unavailable'}:{ok:true,page:{rows:query==='Ani'?[member]:[],hasMore:false,nextCursor:null}};}};
// The mocked server clock only moves forward, as separate network calls always do.
let serverTick=Date.now();const serverNow=()=>new Date(serverTick+=1000).toISOString();
let visitData:NurseVisitReady|null=null,visitMode='',visitReadFails=false,visitClock=0;
const visitCommands:{kind:string;command:NurseVisitCollectCommand|NurseVisitMarkCommand|NurseVisitStepCommand|NurseVisitCompleteCommand}[]=[];
let visitReadOverride:(()=>Promise<NurseVisitReady|'unavailable'|null>)|null=null;
(modules['@/lib/nurse-chat/v2-actions'] as Record<string,unknown>).readNurseChatVisit=async()=>visitReadOverride?visitReadOverride():visitReadFails?null:structuredClone(visitData);
let readCalls=0,sendMode='';
let finishSend:()=>void=()=>{};
let readOverride:(()=>Promise<unknown>)|null=null;
const sendCalls:contracts.NurseReply[]=[];
let workspace:contracts.NurseWorkspace={ok:true,memberId:member.id,memberName:member.name,doctorName:'Doctor Example',canSend:true,version:1,items:[]};
modules['@/lib/nurse-chat/actions']={readNurseConversation:async()=>{readCalls++;return readOverride?readOverride():workspace;},sendNurseReply:async(request:contracts.NurseReply)=>{
 sendCalls.push(request);
 if(sendMode==='pause')await new Promise<void>(resolve=>{finishSend=resolve;});
 if(sendMode==='throw')throw Error('Lost response');
 if(sendMode==='stale')return {ok:false,code:'stale_context'};
 if(sendMode==='denied'||sendMode==='off')return {ok:false,code:sendMode};
 if(sendMode==='refuse')return {ok:false,code:'unavailable'};
 const replyId=request.requestId;
 if(workspace.ok)workspace={...workspace,items:[...workspace.items,{id:replyId,text:request.body,at:serverNow(),senderName:'Narine',senderRole:'nurse'}]};
 return {ok:true,replyId,replayed:sendCalls.length>1};
}};
modules['@/lib/nurse-chat/contracts']=contracts;
modules['@/lib/nurse-chat/conversation-copy']=conversationCopy;
modules['@/lib/staff/yerevan-time']=time;
modules['@/components/staff/nurse-urgent-guidance']=urgentGuidance;
modules['@/lib/nurse-chat/handoff-copy']=handoffCopy;
modules['@/lib/nurse-chat/handoffs']=handoffs;
modules['@/lib/nurse-chat/sent-handoffs']=sentHandoffs;
modules['@/lib/nurse-chat/handoff-state']=load('lib/nurse-chat/handoff-state.ts');
modules['@/lib/staff/real-coordination/status-copy']=taskStatusCopy;
let handoffPage:handoffs.HandoffPage|null={items:[],hasMore:false},handoffMode='',handoffReads=0;
const handoffCalls:handoffs.NurseHandoff[]=[];
const savedTask=(request:handoffs.NurseHandoff,at=new Date().toISOString()):handoffs.HandoffPage['items'][number]=>({messageId:request.messageId,messageText:'Original',topic:request.topic,observation:request.observation,nurseName:'Narine',task:{id:request.requestId,caseId:request.memberId,memberName:member.name,kind:'doctor-referral',title:'Handoff',instructions:'Review',dueAt:null,creatorId:member.id,ownerId:member.id,ownerName:'Doctor',status:'awaiting-doctor',revision:1,createdAt:at,updatedAt:at,needsReassignment:false,eligibleOwners:[],events:[]}});
let overviewPage:sentHandoffs.SentHandoffs|null={items:[],hasMore:false},overviewCalls=0;
modules['@/lib/nurse-chat/handoff-actions']={readNurseHandoffOverview:async()=>{overviewCalls++;return overviewPage;},readNurseHandoffs:async()=>{handoffReads++;return handoffPage;},escalateNurseMessage:async(request:handoffs.NurseHandoff)=>{
 handoffCalls.push(request);
 if(handoffMode==='pause')await new Promise<void>(resolve=>{finishSend=resolve;});
 if(handoffMode==='malformed')return {unexpected:true};
 if(['stale_context','already_exists','unavailable','invalid','request_conflict','denied','off'].includes(handoffMode))return {ok:false,code:handoffMode};
 if(!handoffPage?.items.some(item=>item.task.id===request.requestId))handoffPage={items:[...(handoffPage?.items??[]),savedTask(request)],hasMore:false};
 if(handoffMode==='throw')throw Error('Lost handoff response after commit');
 if(handoffMode==='savedUnread')handoffPage=null;
 return {ok:true,taskId:request.requestId,replayed:handoffCalls.filter(c=>c.requestId===request.requestId).length>1};
}};
let taskMode='',taskReadMode='',taskSnapshot:CoordinationSnapshot={...dueTask,events:[]};
const taskCalls:CoordinationCommand[]=[],taskReads:string[]=[];
modules['@/lib/staff/real-coordination/task-copy']=taskCopy;
modules['@/lib/staff/staff-server-copy']=serverCopy;
modules['@/lib/staff/real-coordination/actions']={coordinationCommand:async(command:CoordinationCommand)=>{
 taskCalls.push(command);
 if(taskMode==='pause')await new Promise<void>(resolve=>{finishSend=resolve;});
 if(taskMode==='throw')throw Error('Response lost');
 if(taskMode==='uncertain')return {ok:false,uncertain:true,error:'Ambiguous response'};
 if(taskMode==='stale')return {ok:false,error:'This task or your assignment changed, or the result could not be confirmed. Load current tasks before trying again.'};
 taskSnapshot={...taskSnapshot,status:'completed',revision:command.revision+1};
 return {ok:true,id:command.taskId,revision:command.revision+1,status:'completed'};
},refreshCoordinationTask:async(id:string)=>{taskReads.push(id);if(taskReadMode==='throw')throw Error('Read unavailable');return taskReadMode==='unreadable'?{ok:false,error:'Current task access is required.'}:{ok:true,task:taskSnapshot};}};
modules['@/lib/nurse-visit/copy']=visitCopy;
modules['@/lib/nurse-visit/chat-order']=visitOrder;
modules['@/lib/nurse-visit/chat-parser']=visitParser;
modules['@/lib/nurse-visit/shortcut']=await import('@/lib/nurse-visit/shortcut');
async function visitWrite(kind:string,command:NurseVisitCollectCommand|NurseVisitMarkCommand|NurseVisitStepCommand|NurseVisitCompleteCommand){
 visitCommands.push({kind,command});
 if(visitMode==='pause')await new Promise<void>(resolve=>{finishSend=resolve;});
 if(visitMode==='unknown-unsaved')return {status:'outcome-unknown'};
 if(visitMode==='unavailable')return {status:'unavailable'};
 if(['booking-stale','reason-required','too-early','invalid','stale','access','disabled','completed','no-samples','no-lab-entries','cancelled'].includes(visitMode))return {status:visitMode};
 assert.ok(visitData);
 const at=new Date(Date.UTC(2026,10,1,9,++visitClock)).toISOString();
 if(kind==='collect'){
  const input=command as NurseVisitCollectCommand;
  if(input.expectedRevision!==visitData.caseRevision)return {status:'stale'};
  for(const item of visitData.items)if(item.kind==='sample'&&('all'in input?collection.collectionStatus(item)==='pending':item.testId===input.testId)){
   const status='all'in input?'collected':input.status;
   item.mark={done:status==='collected',collectionStatus:status,note:'all'in input?null:input.reason,values:null,recordedAt:at,nurseName:'Narine'};
  }
  visitData.caseRevision++;
  if(visitData.items.filter(item=>item.kind==='sample').every(item=>collection.collectionStatus(item)!=='pending')&&visitData.items.some(item=>item.kind==='sample'&&item.mark?.done)&&!visitData.steps.some(s=>s.step==='samples-collected'))visitData.steps.push({step:'samples-collected',at,by:'Narine'});
 }else if(kind==='mark'){
  const mark=command as NurseVisitMarkCommand,item=visitData.items.find(item=>item.key===mark.item)!;
  item.mark={done:mark.done,note:mark.note,values:mark.values,recordedAt:at,nurseName:'Narine'};
 }else if(kind==='step'){
  const step=command as NurseVisitStepCommand;if(!visitData.steps.some(row=>row.step===step.step))visitData.steps.push({step:step.step,at,by:'Narine'});
 }else{
  const complete=command as NurseVisitCompleteCommand;
  if(visitData.items.some(item=>!item.mark?.done)&&(complete.reason?.trim().length??0)<3)return {status:'reason-required'};
  visitData.completion={completedAt:at,nurseName:'Narine',reason:complete.reason,summary:visitData.counts,visitId:complete.visitId};
 }
 if(visitMode==='unknown-saved')return {status:'outcome-unknown'};
 if(visitMode==='throw')throw Error('Lost visit response');
 return {status:'saved',occurredAt:at};
}
modules['@/lib/nurse-visit/actions']={recordNurseVisitCollect:(command:NurseVisitCollectCommand)=>visitWrite('collect',command),recordNurseVisitMark:(command:NurseVisitMarkCommand)=>visitWrite('mark',command),recordNurseVisitStep:(command:NurseVisitStepCommand)=>visitWrite('step',command),recordNurseVisitComplete:(command:NurseVisitCompleteCommand)=>visitWrite('complete',command)};
modules['@/lib/staff/care-note-copy']=careNoteCopy;
let notesMode='',notesReadMode='',notesRevision=1;
let careNotes:import('@/components/staff/care-tasks').CareNote[]=[];
const noteCalls:unknown[]=[];
modules['@/lib/nurse-chat/v2-notes-actions']={readNurseChatNotes:async(memberId:string)=>notesReadMode?{kind:notesReadMode}:{kind:'ready',card:'notes',memberId,revision:notesRevision,notes:careNotes}};
modules['@/lib/staff/nurse-actions']={realStaffCareCommand:async(command:{id:string;revision:number;kind:string;note:string})=>{noteCalls.push(command);if(notesMode==='unknown')return {ok:false,uncertain:true};if(notesMode==='refused'||command.revision!==notesRevision)return {ok:false};careNotes=[...careNotes,{id:crypto.randomUUID(),actor_name:'Narine',actor_role:'nurse',kind:command.kind,note:command.note,created_at:serverNow()}];notesRevision++;return notesMode==='unknown-saved'?{ok:false,uncertain:true}:{ok:true,revision:notesRevision};}};
modules['./use-nurse-notes']=load('components/nurse-chat-v2/use-nurse-notes.ts');
modules['./notes']=load('components/nurse-chat-v2/notes.tsx');
modules['@/components/patient-care/common']={stamp:time.yerevanStamp};
modules['./task-list']=load('components/nurse-chat-v2/task-list.tsx');
modules['./visit-list']=load('components/nurse-chat-v2/visit-list.tsx');
modules['@/lib/nurse-visit/collection']=collection;
modules['./use-nurse-visit']=load('components/nurse-chat-v2/use-nurse-visit.ts');
modules['@/lib/nurse-visit/collection']=collection;
modules['@/lib/patient/catalogue-label']=catalogueLabels;
modules['./sample-collection']=load('components/nurse-chat-v2/sample-collection.tsx');
modules['@/components/ui/progress']=await import('@/components/ui/progress');
modules['./visit-fields']=load('components/nurse-chat-v2/visit-fields.tsx');
modules['./visit']=load('components/nurse-chat-v2/visit.tsx');
modules['./use-nurse-task']=load('components/nurse-chat-v2/use-nurse-task.ts');
modules['./task']=load('components/nurse-chat-v2/task.tsx');
modules['./use-nurse-handoff']=load('components/nurse-chat-v2/use-nurse-handoff.ts');
modules['./use-nurse-conversation']=load('components/nurse-chat-v2/use-nurse-conversation.ts');
modules['@/components/chat-v2/reported-bp-label']=await import('@/components/chat-v2/reported-bp-label');
modules['./conversation']=load('components/nurse-chat-v2/conversation.tsx');
modules['./urgent-sheet']={NurseUrgentSheet:()=>null};
modules['./menu']={NurseChatMenu:()=>null};
modules['@/lib/staff/member-identity']=identityModel;
modules['@/components/staff/member-identity']=identityComponent;
modules['@/lib/staff-zoe/contracts']=staffZoeContracts;
modules['@/lib/staff-zoe/response-copy']=staffZoeCopy;
modules['@/lib/staff-zoe/stream']=staffZoeStream;
modules['@/lib/nurse-chat/zoe-events']=load('lib/nurse-chat/zoe-events.ts');
modules['@/lib/nurse-chat/intent']=load('lib/nurse-chat/intent.ts');
modules['@/lib/nurse-chat/draft-intent']=load('lib/nurse-chat/draft-intent.ts');
modules['@/lib/nurse-chat/handoff-draft']=load('lib/nurse-chat/handoff-draft.ts');
let missingBpResult:unknown={kind:'unavailable'},missingBpCalls=0;
let adherenceResult:unknown={kind:'unavailable'},adherenceCalls=0;
let handoffFactsResult:unknown=null,handoffFactsCalls=0;
modules['@/lib/nurse-chat/cohort-actions']={readNurseMissingBp:async()=>{missingBpCalls++;return missingBpResult;},readNurseAdherence:async()=>{adherenceCalls++;return adherenceResult;},readNurseHandoffFacts:async()=>{handoffFactsCalls++;return handoffFactsResult;}};
modules['@/lib/nurse-chat/boundary']=load('lib/nurse-chat/boundary.ts');
modules['@/lib/staff-zoe/small-talk']=load('lib/staff-zoe/small-talk.ts');
modules['@/lib/nurse-chat/action-intent']=load('lib/nurse-chat/action-intent.ts');
modules['@/lib/nurse-chat/measurement-intent']=load('lib/nurse-chat/measurement-intent.ts');
modules['@/lib/nurse-chat/measure-card']=load('lib/nurse-chat/measure-card.ts');
modules['@/lib/clinical/rules/bp-check']=bpCheck;modules['@/lib/clinical/rules/bp-words']=bpWords;modules['@/lib/locale']=localeModule;
modules['@/lib/care-alerts/contracts']=careAlertContracts;
const alertCommands:Record<string,unknown>[]=[];
let alertCommandResult:unknown={ok:false,code:'unavailable'};
modules['@/lib/care-alerts/actions']={changeCareAlert:async(command:Record<string,unknown>)=>{alertCommands.push(command);return alertCommandResult;}};
modules['@/lib/staff/alert-card']={alertCardFields};
modules['./alert-card']=load('components/staff/alert-card.tsx');
modules['@/components/staff/nurse-urgent-alerts']=load('components/staff/nurse-urgent-alerts.tsx');
modules['@/components/staff/bp-high-warning']=load('components/staff/bp-high-warning.tsx');
modules['next/link']={default:()=>{throw Error('Inline answers never link');}};
modules['@/components/patient-care/common']={stamp:()=> '2 Nov 2026'};
modules['@/components/staff/alert-card']={AlertCardLines:()=>null};
modules['./bp-chart']=load('components/staff/zoe/bp-chart.tsx');
modules['@/components/staff/zoe/answer']=load('components/staff/zoe/answer.tsx');
let zoeFind:unknown={kind:'none'},zoeHistoryCalls=0,zoeOpens=0,zoeStreamMode='',zoeGate:Promise<void>|null=null;
const zoeQuestions:unknown[]=[];
modules['@/lib/nurse-chat/v2-zoe-actions']={
 readNurseChatZoeHistory:async()=>{zoeHistoryCalls++;return {kind:'unavailable'};},
 findNurseChatQuestionMember:async()=>{if(zoeGate)await zoeGate;return zoeFind;},
 openNurseChatZoe:async()=>{zoeOpens++;return {ok:true,conversationId:member.id};},
};
let bindingHold=false,bindingStream:ReadableStreamDefaultController<Uint8Array>|null=null;
const bindingSignals:(AbortSignal|null|undefined)[]=[];
async function chatFetch(_url:Parameters<typeof fetch>[0],init?:RequestInit){
 zoeQuestions.push(JSON.parse(String(init?.body)));
 bindingSignals.push(init?.signal);
 if(bindingHold)return new Response(new ReadableStream<Uint8Array>({start(controller){bindingStream=controller;}}));
 const content={version:'staff-zoe-1',state:'answered',say:[{text:'Synthetic recorded answer',facts:[]}],quotes:[],notKnown:[],declined:false,notice:null,cards:[]};
 const malformed:Record<string,string>={'no-content':'{"type":"answer"}\n','bad-content':JSON.stringify({type:'answer',content:{version:'staff-zoe-1',state:'nope'}})+'\n','bad-cards':JSON.stringify({type:'cards',cards:[{tool:'nope'}]})+'\n'+JSON.stringify({type:'answer',content})+'\n','bad-code':'{"type":"refused","code":"nope"}\n','empty':''};
 if(zoeStreamMode in malformed)return new Response(malformed[zoeStreamMode]);
 const event=zoeStreamMode==='refused'?{type:'refused',code:'rate_limited'}:{type:'answer',content};
 const line=JSON.stringify(event)+'\n';
 return new Response(zoeStreamMode==='cut'?line.slice(0,-5):line);
}
modules['./sent-handoffs']=load('components/nurse-chat-v2/sent-handoffs.tsx');
modules['./messages']=load('components/nurse-chat-v2/messages.tsx');
const {NurseChatV2}=load('components/nurse-chat-v2/nurse-chat.tsx') as {NurseChatV2:React.ComponentType<{locale:copy.StaffLocale;nurseName:string;nurseId:string}>};
let screen!:ReactTestRenderer;
await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
const text=()=>JSON.stringify(screen!.toJSON());
async function send(words:string){
 await act(async()=>{screen!.root.findByProps({className:'cv2-composer'}).findByType('textarea').props.onChange({target:{value:words}});});
 await act(async()=>{screen!.root.findByProps({className:'cv2-composer'}).props.onSubmit({preventDefault(){}});});
 // A reply to the member asks first; every older check here means "send it", so it presses the confirm. The ask itself is tested below.
 const confirm=screen!.root.findAll(node=>node.type==='button'&&node.parent?.props['data-reply-confirm']!==undefined)[0];
 if(confirm)await act(async()=>{confirm.props.onClick();});
 // Existing measurement journeys now include the nurse's explicit preview confirmation.
 if(/^\s*[\d.,/\s]+\s*$/u.test(words)){
  const preview=screen.root.findAll(node=>node.type==='button'&&node.children.join('')==='Confirm entry'&&!node.props.disabled)[0];
  if(preview)await act(async()=>{preview.props.onClick();});
 }
 assert.equal(screen!.root.findAllByType('a').length,0);
}
async function sendUnconfirmed(words:string){
 await act(async()=>{screen!.root.findByType('textarea').props.onChange({target:{value:words}});});
 await act(async()=>{screen!.root.findByProps({className:'cv2-composer'}).props.onSubmit({preventDefault(){}});});
}
assert.match(text(),/Hello\. Start with today/);
await act(async()=>{screen!.root.findAllByType('button').find(button=>button.children.includes('Today'))!.props.onClick();});
assert.equal(todayCalls,1);assert.match(text(),/Confirm the visit time/);assert.match(text(),/Open work, urgent alerts first/);
assert.equal(screen.root.findAllByType('button').filter(button=>button.children.includes('Mark done')).length,2,'An eligible due task has a completion chip');
assert.match(text(),/\+37499123456/,'Today includes the assigned nurse phone payload');assert.match(text(),/Ani Example/);assert.match(text(),/Overdue/);assert.match(text(),/Older Example/,'An incomplete past visit is listed as overdue, so the overdue count is never an empty list');assert.match(text(),/open alerts, tasks and visits/);
assert.match(text(),/Future task/);assert.doesNotMatch(text(),/Completed task/);
await send('today');assert.equal(todayCalls,2);
await send('Ani');assert.equal(searchCalls,1);assert.match(text(),/\+37499123456/);
await act(async()=>{screen!.root.findAllByType('button').filter(button=>button.findAll(node=>node.props['data-member-identity']===member.id).length>0).at(-1)!.props.onClick();});
assert.match(text(),/You reply as the assigned nurse/);
assert.ok(screen!.root.findAll(node=>node.type==='p'&&node.props.className==='cv2-say').some(node=>node.children.join('')===identityModel.chatMemberIdentityLine(member,'en')),'The echo of a picked member is the full identity line, not name and year only');
assert.equal(readCalls,1,'Selection reads through the existing assigned-member action');
assert.equal(screen!.root.findByType('textarea').props.maxLength,4096);
await send('today');assert.equal(todayCalls,2,'Reply text bypasses command parsing');assert.equal(sendCalls.at(-1)?.body,'today');
let confirmReads=0;
{ // The first Send asks; only "Send to member" sends; editing, Keep editing and a second Send never send.
 const before=sendCalls.length,readsBefore=readCalls;
 const confirmButtons=()=>screen!.root.findAll(node=>node.type==='button'&&node.parent?.props['data-reply-confirm']!==undefined);
 await sendUnconfirmed('Please measure again tonight');
 assert.equal(sendCalls.length,before,'Send alone sends nothing to the member');
 assert.equal(confirmButtons().length,2,'It asks: Send to member, Keep editing');assert.match(text(),/They will see it in their chat/);
 await act(async()=>{screen!.root.findByProps({className:'cv2-composer'}).props.onSubmit({preventDefault(){}});});
 assert.equal(sendCalls.length,before,'A second Send does not confirm');
 await act(async()=>{confirmButtons()[1].props.onClick();});
 assert.equal(confirmButtons().length,0,'Keep editing closes the ask');assert.equal(sendCalls.length,before);
 await sendUnconfirmed('Please measure again tonight');assert.equal(confirmButtons().length,2);
 await act(async()=>{screen!.root.findByType('textarea').props.onChange({target:{value:'Please measure again tonight, twice'}});});
 assert.equal(confirmButtons().length,0,'Editing the words closes the ask, so what was confirmed is what is sent');assert.equal(sendCalls.length,before);
 await sendUnconfirmed('Please measure again tonight, twice');
 await act(async()=>{confirmButtons()[0].props.onClick();});
 assert.equal(sendCalls.length,before+1);assert.equal(sendCalls.at(-1)?.body,'Please measure again tonight, twice');assert.equal(confirmButtons().length,0);confirmReads=readCalls-readsBefore;
}

assert.equal(text().includes('saved in the member'),false,'No redundant saved receipt');
const close=()=>screen!.root.findAllByType('button').find(button=>button.props['aria-label']==='Close conversation')!;
await act(async()=>close().props.onClick());
assert.match(text(),/Conversation with/);assert.doesNotMatch(text(),/You reply as the assigned nurse/);
await act(async()=>screen!.root.findAllByType('button').find(button=>button.children.includes('Conversation with'))!.props.onClick());
assert.equal(readCalls,3+confirmReads,'Reopening re-reads the member');
const selectable=screen!.root.findAll(node=>node.props.role==='button'&&node.props['aria-expanded']!==undefined);
assert.ok(selectable.length,'Conversation messages can be selected for handover');
await act(async()=>selectable[0].props.onClick({stopPropagation(){}}));
assert.ok(screen!.root.findAllByType('button').some(button=>button.children.includes('Hand over to doctor')),'Tap offers handover');
const draft='  Unchanged\r\nreply  ';
sendMode='stale';await send(draft);
assert.equal(screen!.root.findByType('textarea').props.value,draft,'Stale restores the untouched draft');
assert.match(text(),/Read it before sending/);assert.equal(readCalls,4+confirmReads);
sendMode='throw';await send(draft);
assert.equal(screen!.root.findByType('textarea').props.disabled,true);
assert.equal(close().props.disabled,true);
const pending=sendCalls.at(-1);assert.equal(pending?.body,'Unchanged\nreply','Normalize and trim exactly as the old composer');
const readsBefore=readCalls;
await act(async()=>{browser.dispatchEvent(new Event('focus'));});
assert.equal(readCalls,readsBefore,'Uncertain sends suppress polling');
sendMode='';
await act(async()=>screen!.root.findAllByType('button').find(button=>button.children.includes('Check or retry this reply'))!.props.onClick());
assert.equal(sendCalls.at(-1),pending,'Retry sends the same object, id, version and body');
assert.equal(screen!.root.findByType('textarea').props.disabled,false);
assert.equal(screen!.root.findAll(node=>node.props['data-pending-reply']).length,0,'Server item replaces the optimistic turn');
await act(async()=>close().props.onClick());
await send('What is the potassium?');assert.equal(searchCalls,1);assert.match(text(),/Which member do you mean/);
// Plain chat gets fixed words with no member search and no Zoe call (Khikar, 4 Nov: "what can you do" ended in a dead end).
for(const [words,pattern] of [['Hello',/I am here and ready/],['can you talk?',/I can talk/],['What can you do?',/who needs a visit or follow-up[\s\S]*I do not prescribe/],['thanks',/You are welcome/],['bye',/Goodbye/]] as const){
 await send(words);assert.equal(searchCalls,1,words);assert.match(text(),pattern,words);
}
assert.match(text(),/Try: “What do I have today”/);
await send('Nobody');assert.match(text(),/No matching assigned members/);
todayResult={ok:false,code:'unavailable'};await send('today');assert.match(text(),/Your work list is unavailable/);
transportFails=true;await send('today');assert.match(text(),/Your work list is unavailable/);
searchFails=true;await send('Ani');assert.match(text(),/Member search is unavailable/);
searchFails=false;await send('Ani');
await act(async()=>screen!.root.findAllByType('button').filter(button=>button.findAll(node=>node.props['data-member-identity']===member.id).length>0).at(-1)!.props.onClick());
const snapshot=text();workspace={ok:false,code:'unavailable'};
await act(async()=>{browser.dispatchEvent(new Event('pageshow'));});assert.equal(text(),snapshot,'A failed poll changes nothing');
workspace={ok:false,code:'denied'};
await act(async()=>{browser.dispatchEvent(new Event('focus'));});assert.match(text(),/Access denied/);
assert.equal(screen!.root.findAllByType('button').filter(button=>button.props['aria-label']==='Close conversation').length,0);
await act(async()=>{screen!.unmount();});
console.log('Nurse chat v2 stateful UI: greeting, suggestion, typed today, due filtering, search, conversation selection/reply, unsupported input and read/transport failures passed (mocked action IO and layout).');

// Deliberately control read completion order, visibility, and the send result.
const useConversation=(modules['./use-nurse-conversation'] as typeof import('@/components/nurse-chat-v2/use-nurse-conversation')).useNurseConversation;
let hook!:ReturnType<typeof useConversation>,restoredDraft='';
const restore=(body:string)=>{restoredDraft=body;};
const atEnd={current:()=>true};
function Harness(){const value=useConversation(restore,atEnd);React.useLayoutEffect(()=>{hook=value;});return null;}
const state=()=>hook;
const base={ok:true as const,memberId:member.id,memberName:member.name,doctorName:'Doctor Example',version:1,canSend:true,items:[]};
workspace=base;sendMode='';
await act(async()=>{screen=create(React.createElement(Harness));});
await act(async()=>{await hook.openMember(member,'one');});
assert.equal(pollMs,30_000,'Each audit-writing poll is thirty seconds apart');
const beforeHidden=readCalls;visibility.hidden=true;
await act(async()=>{poll();browser.dispatchEvent(new Event('focus'));visibility.dispatchEvent(new Event('visibilitychange'));});
assert.equal(readCalls,beforeHidden,'Hidden pages do not read');visibility.hidden=false;
await act(async()=>{visibility.dispatchEvent(new Event('visibilitychange'));});assert.equal(readCalls,beforeHidden+1);
const resolves:((data:contracts.NurseWorkspace)=>void)[]=[];
readOverride=()=>new Promise(resolve=>resolves.push(resolve));
await act(async()=>{browser.dispatchEvent(new Event('focus'));browser.dispatchEvent(new Event('pageshow'));});
assert.equal(resolves.length,1,'Overlapping focus and pageshow make one audited read');
await act(async()=>{resolves[0]({...base,version:3});});
const latest=state().session?.data;
assert.equal(latest?.ok&&latest.version,3);
let opening!:Promise<void>;
await act(async()=>{opening=hook.openMember({...member,id:'aa110000-0000-4000-8000-000000000002',name:'Other member'},'two');});
await act(async()=>{hook.close();});
await act(async()=>{resolves[1]({...base,memberName:'Other member'});await opening;});
assert.equal(hook.session,null,'A late read cannot reopen a closed conversation');
readOverride=null;workspace=base;
await act(async()=>{await hook.openMember(member,'three');});
sendMode='pause';
let sending!:Promise<void>;
await act(async()=>{sending=hook.send('Saving now');});
assert.equal(hook.sending,true);assert.equal(hook.optimistic.at(-1)?.state,'saving');
const duringSend=readCalls;
await act(async()=>{poll();browser.dispatchEvent(new Event('focus'));});assert.equal(readCalls,duringSend,'Sending suppresses polling');
await act(async()=>{finishSend();await sending;});
sendMode='stale';readOverride=async()=>{throw Error('Stale reread unavailable');};
await act(async()=>{await hook.send('Preserve stale draft');});
assert.equal(hook.notice,'stale','Failed stale reread must still explain that a new member message arrived');
assert.equal(restoredDraft,'Preserve stale draft');
sendMode='';
readOverride=async()=>{throw Error('Unreadable after save');};
await act(async()=>{await hook.send('Saved but unread');});
assert.equal(hook.optimistic.at(-1)?.state,'sent');assert.equal(hook.notice,'savedUnread');
assert.equal(state().session?.data?.ok,true,'Saved read failure preserves history and the sent bubble');
await act(async()=>{await hook.send('Second saved but unread');});
assert.equal(hook.optimistic[0]?.request.body,'Saved but unread','A second accepted reply must preserve the first saved bubble until a read recovers');
readOverride=null;
await act(async()=>{poll();});
assert.equal(hook.optimistic.length,0,'A later successful poll reconciles the saved bubble');assert.equal(hook.notice,'');
sendMode='refuse';
await act(async()=>{await hook.send('  Exact refusal draft  ');});
assert.equal(restoredDraft,'  Exact refusal draft  ');assert.equal(hook.notice,'unconfirmed');
sendMode='denied';
await act(async()=>{await hook.send('Denied');});assert.equal(hook.open,false);const denied=state().session?.data;assert.equal(denied?.ok,false);assert.equal(denied&&!denied.ok&&denied.code,'denied');
await act(async()=>{screen!.unmount();});
console.log('Nurse conversation races: thirty-second visible polling, return from hidden, out-of-order/closed-session reads, saved/read failure reconciliation, refusal draft and send denial passed (controlled action IO).');

// Block b: real hook and renderer, synthetic action IO. Browser geometry remains a WebKit check.
const sourceItem={id:'source',text:'Selected source '.repeat(12),senderRole:'member' as const,senderName:member.name,at:'2026-11-01T08:00:00Z'};
workspace={...base,canSend:false,items:[sourceItem]};sendMode='';handoffMode='';handoffPage={items:[],hasMore:false};
await act(async()=>{screen=create(React.createElement(Harness));await Promise.resolve();});
await act(async()=>hook.openMember(member,'handoff'));
const hc=()=>state().handoff;
const begin=async()=>{await act(async()=>hc().start('source','Hand over\n'+sourceItem.text.slice(0,90)));await act(async()=>hc().topic('blood-pressure','Blood pressure'));};
const handoffSend=async(words:string)=>{const data=state().session?.data;assert.ok(data?.ok);await hc().send(data,words,hook.refresh,hook.refuseAccess,hook.invalidateReads);};
await begin();assert.equal(hc().flow?.turns[0].text.length,100,'Selected message preview is 90 characters');
const repliesBefore=sendCalls.length;
await act(async()=>hook.send('Blocked ordinary reply'));assert.equal(sendCalls.length,repliesBefore);
await act(async()=>hook.openMember({...member,id:'aa110000-0000-4000-8000-000000000002'},'other-during-flow'));
assert.equal(state().session?.key,'handoff','Changing members cannot discard an active handover');
await act(async()=>hc().cancel());assert.equal(hc().flow,null);assert.equal(handoffCalls.length,0);assert.equal(restoredDraft,'');
await begin();handoffMode='stale_context';workspace={...base,canSend:false,version:2,items:[sourceItem]};
const observation='  Keep this exact observation  ';
await act(async()=>handoffSend(observation));
assert.equal(hc().flow?.notice,'stale');assert.equal(restoredDraft,observation);assert.equal(hc().flow?.messageId,'source');assert.equal(hc().flow?.topic,'blood-pressure');assert.equal(hc().page?.items.length,0);
assert.equal(hc().flow?.turns.some(turn=>turn.kind==='observation'),false,'A refused send is back in the composer');
const staleRequest=handoffCalls.at(-1)!;
handoffMode='throw';await act(async()=>handoffSend(observation));
assert.notEqual(handoffCalls.at(-1)?.requestId,staleRequest.requestId);assert.equal(handoffCalls.at(-1)?.expectedVersion,2);
assert.equal(hc().frozen,true);assert.equal(hc().held.current,true);
const originalRequest=handoffCalls.at(-1),readsHeld=readCalls;
await act(async()=>{hc().cancel();hook.close();poll();browser.dispatchEvent(new Event('focus'));});
assert.equal(readCalls,readsHeld);assert.equal(hc().active,true);assert.equal(state().open,true);
handoffMode='';await act(async()=>handoffSend('Different words cannot alter the retry'));
assert.equal(handoffCalls.at(-1),originalRequest,'Unknown retry holds the exact request object');assert.equal(hc().active,false);assert.equal(hc().page?.items.length,1);assert.equal(hc().fallbacks.length,0);
assert.ok(hc().remembered.includes('source'));assert.equal(hc().frozen,false);
// A handoffs read failure is optional and cannot block conversation refresh.
handoffPage=null;workspace={...base,version:3,items:[sourceItem]};
await act(async()=>{poll();});assert.equal(hc().page,null);assert.ok(hc().remembered.includes('source'));assert.equal(state().session?.data?.ok,true);
await act(async()=>hook.close());await act(async()=>hook.openMember(member,'reopen-unread'));
assert.ok(hc().remembered.includes('source'),'Reopening with a failed read retains handovers known in this session');
// Another source can be handed over while app replies are disabled.
await act(async()=>hc().start('other','Hand over\nOther source'));await act(async()=>hc().topic('other','Other'));
handoffMode='savedUnread';await act(async()=>handoffSend('Saved words while task read fails'));
assert.equal(hc().active,false);assert.equal(hc().fallbacks.length,1);assert.equal(hc().fallbacks[0].observation,'Saved words while task read fails');
const unreadRequest=handoffCalls.at(-1)!;handoffPage={items:[savedTask(unreadRequest)],hasMore:false};
await act(async()=>{poll();});assert.equal(hc().fallbacks.length,0,'A later server read replaces the unread receipt');
await act(async()=>hc().start('third','Hand over\nThird source'));await act(async()=>hc().topic('other','Other'));
for(const code of ['unavailable','invalid','request_conflict']){
 handoffMode=code;await act(async()=>handoffSend(observation));assert.equal(restoredDraft,observation);assert.equal(hc().flow?.notice,'refused');assert.equal(hc().frozen,false);
}
handoffMode='already_exists';await act(async()=>handoffSend('Duplicate words'));
assert.equal(hc().active,false);assert.equal(hc().failed.length,1);assert.equal(hc().failed[0].turns.at(-1)?.state,'failed');assert.ok(hc().remembered.includes('third'));
await act(async()=>hc().start('fourth','Hand over\nFourth source'));await act(async()=>hc().topic('other','Other'));
handoffMode='pause';let pendingHandoff!:Promise<void>;
await act(async()=>{pendingHandoff=handoffSend('One pending observation');});
const callsBeforeOverlap=handoffCalls.length;
await act(async()=>handoffSend('An overlapping send'));assert.equal(handoffCalls.length,callsBeforeOverlap,'Same-event send cannot overlap');
await act(async()=>{finishSend();await pendingHandoff;});
for(const code of ['denied','off']){
 await act(async()=>hook.openMember(member,code));await act(async()=>hc().start(code+'-source','Hand over\nAccess source'));await act(async()=>hc().topic('other','Other'));handoffMode=code;await act(async()=>handoffSend('Access revoked'));
 assert.equal(state().open,false);assert.equal(hc().active,false);assert.equal(restoredDraft,'');
}
await act(async()=>screen.unmount());
console.log('Nurse handoff transitions: cancel, reply exclusion, canSend independence, stale reread, exact unknown retry, overlap guard, optional reads, saved reconciliation, duplicate failure and access closure passed (controlled action IO).');

// Render ordering uses server task creation time and timestamped unsaved turns.
workspace={...base,items:[sourceItem,{...sourceItem,id:'later',text:'Later member words',at:'2026-11-01T09:00:00Z'}]};handoffMode='';
const oldHandoff=savedTask({memberId:member.id,requestId:crypto.randomUUID(),expectedVersion:1,messageId:'source',topic:'other',observation:'Earlier saved observation'},'2026-11-01T08:30:00Z');
handoffPage={items:[oldHandoff],hasMore:false};
await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
await send('Ani');await act(async()=>screen.root.findAllByType('button').filter(b=>b.findAll(node=>node.props['data-member-identity']===member.id).length>0).at(-1)!.props.onClick());
let rendered=text();assert.ok(rendered.indexOf('Selected source')<rendered.indexOf('Earlier saved observation'));assert.ok(rendered.indexOf('Earlier saved observation')<rendered.indexOf('Later member words'));
assert.match(rendered,/Awaiting doctor/);
const selectableTurns=()=>screen.root.findAll(n=>n.props.role==='button'&&n.props['aria-expanded']!==undefined);
let selectionPrevented=false;
selectableTurns()[0].props.onPointerDown({pointerType:'mouse',preventDefault(){selectionPrevented=true;}});
selectableTurns()[0].props.onMouseDown?.({preventDefault(){selectionPrevented=true;}});
assert.equal(selectionPrevented,false,'Mouse text selection must retain its native defaults');
await act(async()=>selectableTurns()[0].props.onClick({stopPropagation(){}}));
assert.equal(screen.root.findAllByType('button').some(b=>b.children.includes('Hand over to doctor')),false,'A saved source has no handover action');
await act(async()=>selectableTurns()[1].props.onKeyDown({key:' ',preventDefault(){},stopPropagation(){}}));
const action=()=>screen.root.findAllByType('button').find(b=>b.children.includes('Hand over to doctor'))!;
assert.ok(action(),'Space selects another message');
await act(async()=>screen.root.findByProps({'data-nurse-chat-v2':true}).props.onClick());assert.equal(action(),undefined,'Tap elsewhere hides the action');
await act(async()=>selectableTurns()[1].props.onKeyDown({key:'Enter',preventDefault(){},stopPropagation(){}}));
await act(async()=>action().props.onClick({stopPropagation(){}}));
await new Promise(resolve=>setTimeout(resolve,2));
workspace={...workspace,version:2,items:[...workspace.items,{...sourceItem,id:'incoming',text:'Arriving during the flow',at:new Date().toISOString()}]};
await act(async()=>{poll();});
await new Promise(resolve=>setTimeout(resolve,2));
await act(async()=>screen.root.findAllByType('button').find(b=>b.children.includes('Blood pressure'))!.props.onClick());
rendered=text();assert.ok(rendered.indexOf('Hand over\\nLater member words')<rendered.indexOf('Arriving during the flow'));assert.ok(rendered.indexOf('Arriving during the flow')<rendered.indexOf('"topic"'));
assert.equal(screen.root.findByType('textarea').props.maxLength,2000);assert.equal(screen.root.findByType('textarea').props.placeholder,'Note for the doctor');
await act(async()=>screen.root.findAllByType('button').find(b=>b.props['aria-label']==='Close note for the doctor')!.props.onClick());
assert.equal(screen.root.findAll(n=>n.props['data-handoff-turn']).length,0);assert.equal(screen.root.findByType('textarea').props.maxLength,4096);
readOverride=async()=>{throw Error('Reply saved but reread unavailable');};handoffPage=null;
await act(async()=>{poll();});
assert.equal(screen.root.findAll(n=>n.props['data-handoff-saved']).length,0,'Handoffs read failure hides saved extras even if the conversation read also fails');
await send('Earlier unread reply');
await new Promise(resolve=>setTimeout(resolve,2));
await act(async()=>selectableTurns()[1].props.onClick({stopPropagation(){}}));await act(async()=>action().props.onClick({stopPropagation(){}}));
rendered=text();assert.ok(rendered.indexOf('Earlier unread reply')<rendered.indexOf('Hand over\\nLater member words'),'An earlier unread reply stays before a later handover action');
readOverride=null;

assert.equal(screen.root.findAllByType('a').length,0);await act(async()=>screen.unmount());
assert.ok(handoffReads>0);
console.log('Nurse handoff renderer: server task time/status, no duplicate action, Enter/Space selection, dismiss, mid-flow member ordering, composer and cancellation passed (mocked layout).');

// Block c: a task note owns the composer, and uncertainty owns one command identity.
const taskButtons=()=>screen.root.findAllByType('button').filter(b=>b.children.includes('Mark done'));
const taskClose=()=>screen.root.findByProps({'aria-label':'Close task note'});
const taskCheck=()=>screen.root.findAllByType('button').find(b=>b.children.includes('Check this task'))!;
const startTask=async()=>{await act(async()=>taskButtons()[0].props.onClick());};
function taskToday(tasks:CoordinationTask[]){todayResult={ok:true,asOf:'2026-11-01T08:00:00Z',page:{tasks,nextCursor:null},visits:{enabled:false,visits:[]}};}
// A task owns the composer even when Zoe was last asked about somebody else.
{
 const other={memberId:'aa110000-0000-4000-8000-000000000002',memberName:'Mariam Example'};
 const historyBefore=zoeHistoryCalls;
 workspace=base;transportFails=false;zoeFind={kind:'member',...other};taskToday([dueTask]);
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 await send('What did Mariam Example write?');
 const banner=()=>screen.root.findByType('footer').findAll(n=>n.props['data-member-identity']!==undefined).map(n=>n.props['data-member-identity']);
 assert.deepEqual(banner(),[other.memberId],'Zoe initially names B');
 await send('today');await startTask();
 assert.equal(screen.root.findByType('textarea').props['aria-label'],'Completion note');
 assert.deepEqual(banner(),[member.id],'Starting A’s task replaces B in the composer identity banner');
 await act(async()=>taskClose().props.onClick());
 assert.deepEqual(banner(),[other.memberId],'Closing the task restores the Zoe target');
 await act(async()=>screen.unmount());zoeFind={kind:'none'};zoeQuestions.length=0;zoeOpens=0;zoeHistoryCalls=historyBefore;
}
console.log('Nurse identity regression: ask Zoe about B, load Today, start A’s task, close task (mounted component, mocked IO).');
workspace=base;transportFails=false;taskToday([
 dueTask,{...dueTask,id:'awaiting',title:'Awaiting member task',status:'awaiting-member'},
 {...dueTask,id:'referral',title:'Doctor referral task',kind:'doctor-referral'},
 {...dueTask,id:'reassign',title:'Reassignment task',needsReassignment:true,eligibleOwners:[]},
 {...dueTask,id:'doctor',title:'Awaiting doctor task',status:'awaiting-doctor'},
 {...dueTask,id:'future',dueAt:'2026-11-04T08:00:00Z'},
 {...dueTask,id:'finished',status:'completed'},
]);
await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
await send('today');assert.equal(taskButtons().length,4,'The full Today list retains every eligible task, including future work, with the same owner/status conditions as TaskRow');
for(const taskId of ['referral','reassign'])assert.equal(screen.root.findByProps({'data-task-card':taskId}).findAllByType('button').filter(b=>b.children.includes('Mark done')).length,0,'Ineligible tasks have no completion control');
await send('Ani');await startTask();
assert.equal(screen.root.findByType('textarea').props.maxLength,2000);
assert.equal(screen.root.findByType('textarea').props['aria-label'],'Completion note');
assert.equal(screen.root.findAll(n=>n.props['data-today-task']===dueTask.id).length,0);
assert.match(text(),/Done:.*Confirm the visit time/);
const memberButton=screen.root.findAllByType('button').filter(b=>b.findAll(node=>node.props['data-member-identity']===member.id).length>0).at(-1)!;
assert.equal(memberButton.props.disabled,true);await act(async()=>memberButton.props.onClick());assert.equal(screen.root.findAll(n=>n.props['aria-label']==='Close conversation').length,0);
assert.ok(taskButtons().every(b=>b.props.disabled));
const beforeCancel=taskCalls.length;
await act(async()=>taskClose().props.onClick());assert.equal(taskCalls.length,beforeCancel);assert.equal(screen.root.findAll(n=>n.props['data-task-turn']).length,0);assert.equal(taskButtons().length,4);
await act(async()=>screen.unmount());

taskToday([dueTask]);
const mountTask=async()=>{taskSnapshot={...dueTask,events:[]};taskMode='';taskReadMode='';await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});await send('today');await startTask();};
await mountTask();taskMode='pause';
await send('  Exact task note  ');
assert.match(text(),/Saving…/);assert.equal(taskClose().props.disabled,true);assert.equal(screen.root.findByType('textarea').props.readOnly,true);
await act(async()=>screen.root.findByProps({className:'cv2-avatar'}).props.onClick());assert.equal(screen.root.findAll(n=>n.props.signOutHeld===true).length,1);
const taskRequest=taskCalls.at(-1)!;assert.equal(taskRequest.operation,'complete');assert.equal(taskRequest.caseId,member.id);assert.equal(taskRequest.taskId,dueTask.id);assert.equal(taskRequest.revision,1);assert.deepEqual(JSON.parse(JSON.stringify(taskRequest.input)),{note:'  Exact task note  '});
await act(async()=>{finishSend();});
assert.equal(screen.root.findAll(n=>n.props['aria-label']==='Close task note').length,0);assert.doesNotMatch(text(),/Saving…|Recorded\.|Task saved/);assert.match(text(),/No open work in the available list/);assert.equal(screen.root.findByType('textarea').props.value,'');
assert.equal(taskReads.at(-1),dueTask.id);await act(async()=>screen.unmount());

for(const mode of ['uncertain','throw']){
 await mountTask();taskMode=mode;const startCount=taskCalls.length;await send('Exact unknown task note');
 assert.match(text(),/The result could not be confirmed/);assert.equal(taskClose().props.disabled,true);
 await act(async()=>taskClose().props.onClick());assert.ok(taskCheck());
 taskReadMode='unreadable';await act(async()=>taskCheck().props.onClick());assert.equal(taskCalls.length,startCount+1);assert.equal(taskClose().props.disabled,true,'Unreadable reconciliation cannot release an unknown command');taskReadMode='';
 const command=taskCalls.at(-1)!;
 taskSnapshot={...taskSnapshot,status:'completed',events:[{request_id:command.requestId} as CoordinationSnapshot['events'][number]]};
 await act(async()=>taskCheck().props.onClick());assert.equal(taskCalls.length,startCount+1,'History proves save without a second command');assert.equal(screen.root.findAll(n=>n.props['aria-label']==='Close task note').length,0);assert.doesNotMatch(text(),/could not be confirmed/);
 await act(async()=>screen.unmount());
}
await mountTask();taskMode='uncertain';await send('Same request after check');const unknownCommand=taskCalls.at(-1)!;taskMode='';
await act(async()=>taskCheck().props.onClick());assert.equal(taskCalls.at(-1),unknownCommand,'A missing event resends the same command object with the same revision, request ID and note');await act(async()=>screen.unmount());

for(const readMode of ['active','finished','unreadable','throw']){
 await mountTask();taskMode='stale';taskReadMode=readMode==='unreadable'||readMode==='throw'?readMode:'';taskSnapshot={...dueTask,revision:4,status:readMode==='finished'?'completed':'open',events:[]};
 const draft='  Restore this exact task note  ';await send(draft);const staleCommand=taskCalls.at(-1)!;
 assert.equal(screen.root.findByType('textarea').props.value,readMode==='finished'?'':draft);assert.match(text(),/This task or your assignment changed/);assert.equal(screen.root.findAll(n=>n.props['data-task-turn']==='note').length,0);
 if(readMode==='active'){
  assert.equal(taskClose().props.disabled,false);taskMode='';await send(draft);assert.equal(taskCalls.at(-1)?.revision,4);assert.notEqual(taskCalls.at(-1)?.requestId,staleCommand.requestId);
 }else if(readMode==='finished'){assert.equal(screen.root.findAll(n=>n.props['aria-label']==='Close task note').length,0);assert.equal(taskButtons().length,0);}else{assert.equal(taskClose().props.disabled,false);assert.equal(screen.root.findByType('textarea').props.readOnly,true);assert.ok(taskCheck(),'Failed reads retain the target and require refresh');}
 await act(async()=>screen.unmount());
}
// A confirmed save survives an unavailable follow-up read without an uncertainty prompt.
await mountTask();taskReadMode='throw';await send('Saved despite unreadable refresh');assert.doesNotMatch(text(),/could not be confirmed/);assert.equal(screen.root.findAll(n=>n.props['aria-label']==='Close task note').length,0);await act(async()=>screen.unmount());
console.log('Nurse task notes: eligibility, single composer, cancel, pending hold, success, uncertain history reconciliation, exact replay, stale revision, terminal/unreadable refusal and accepted-save read failure passed (controlled action IO).');

// Block d: exercise actual visit UI and hook against controlled server records.
const visitId='aa440000-0000-4000-8000-000000000001';
const seededVisit=():NurseVisitReady=>({version:'nurse-visit-v1',enabled:true,today:'2026-11-01',checklistVersion:'test-v1',caseRevision:1,
 visit:{id:visitId,source:'appointment',memberId:member.id,memberName:member.name!,arrangementToken:visitId,startsAt:'2026-11-01T09:00:00Z',endsAt:null,mode:'home',location:'Example address',bookingStatus:'confirmed',completion:null},
 items:[
  {kind:'measurement',key:'measure:bp',field:'bp',mark:null},
  {kind:'check',key:'check:safety',checkId:'safety',section:'safety',version:'test-v1',label:{en:'Safety check',hy:'Անվտանգություն'},source:'Existing protocol',mark:null},
  {kind:'sample',key:'sample:cbc',testId:'cbc',title:'Blood count',mark:null},
  {kind:'measurement',key:'measure:weight',field:'weight',mark:null},
 ],steps:[],completion:null,counts:{samplesPlanned:1,samplesTaken:0,bpTaken:false,deviceDone:null,openItems:['measure:bp','check:safety','sample:cbc','measure:weight']}});
const visitQuestion=()=>screen.root.findAll(n=>n.props['data-visit-question']!==undefined).find(n=>n.props['data-visit-question']!=='undefined');
const questionIs=(key:string)=>assert.equal(visitQuestion()?.props['data-visit-question'],key);
const button=(label:string)=>screen.root.findAllByType('button').findLast(b=>b.children.filter(child=>typeof child==='string').join('')===label||b.findAll(node=>node.type===(modules['@/components/staff/chat-member-identity'] as {ChatMemberIdentity:unknown}).ChatMemberIdentity&&((node.props.member&&identityModel.chatMemberIdentityLine(node.props.member,'en')===label)||(node.props.name&&label.startsWith(node.props.name+' ·')))).length>0)!;
const press=async(label:string)=>{await act(async()=>button(label).props.onClick());};
async function markNotCollected(){await press('Sample collection');await press('Not collected');const field=screen.root.findAllByType('textarea').find(field=>field.props.maxLength===300)!;await act(async()=>field.props.onChange({target:{value:'Member declined'}}));await press('Save collection status');await press('Next');}
const visitClose=()=>screen.root.findByProps({'aria-label':'Close visit'});
async function mountVisit(data=seededVisit(),locale:'en'|'hy'|'ru'='en'){
 visitData=data;visitMode='';visitReadFails=false;visitReadOverride=null;visitClock=0;visitCommands.length=0;
 todayResult={ok:true,asOf:'2026-11-01T08:00:00Z',page:{tasks:[dueTask],nextCursor:null},visits:{enabled:true,today:'2026-11-01',visits:[{...data.visit,steps:data.steps}]}};
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale,nurseName:'Narine',nurseId:member.id}));});await send('today');
 await act(async()=>screen.root.findByProps({'data-today-visit':visitId}).findAllByType('button')[0].props.onClick());
}
await mountVisit();questionIs('step:confirmed');
const progress=screen.root.findByProps({role:'progressbar'});
assert.equal(progress.props['aria-valuemin'],0);assert.equal(progress.props['aria-valuenow'],1);assert.equal(progress.props['aria-valuemax'],5);
assert.equal(screen.root.findByProps({'data-visit-progress':true}).findByType('p').children.join(''),'1 of 5');
assert.equal(progress.findAll(n=>n.props.className==='cv2-say').length,0);
assert.equal(screen.root.findAll(n=>n.props['data-sample-collection']!==undefined).length,0,'Only the active block accepts input');
const confirmationPosition=text().indexOf('I confirmed the visit with the member');
assert.ok(confirmationPosition>=0,'Existing confirmation is the first active block');
assert.equal(screen.root.findByType('textarea').props.readOnly,false,'Typed shortcuts are available beside tap blocks');
assert.equal(button('Mark done').props.disabled,true,'Visit excludes task notes');
await press('I confirmed the visit with the member');questionIs('step:started');
assert.equal(screen.root.findAll(n=>n.props['data-sample-collection']!==undefined).length,0);
await press('Skip for now');questionIs('check:safety');
await press('Not done');questionIs('measure:bp');
const checkCommand=visitCommands.at(-1)!.command as NurseVisitMarkCommand;
assert.equal(checkCommand.startsAt,visitData!.visit.startsAt);assert.equal(checkCommand.checklistVersion,'test-v1');assert.equal(checkCommand.done,false);
await send('59/30');assert.equal(screen.root.findByType('textarea').props.value,'59/30');assert.match(text(),/Check the readings: whole numbers/);questionIs('measure:bp');
await act(async()=>screen.root.findByType('textarea').props.onChange({target:{value:'148/93 72'}}));
await press('Add a comment');assert.equal(screen.root.findByType('textarea').props.maxLength,1000);
assert.match(text(),/The doctor and the admin see it; the member does not/);
await send('Existing comment');assert.equal(screen.root.findByType('textarea').props.value,'148/93 72');
await send('148/93 72');questionIs('measure:weight');
assert.equal((visitCommands.at(-1)!.command as NurseVisitMarkCommand).note,'Existing comment');assert.match(text(),/148\/93, pulse 72/);
await send('400,1');assert.equal(screen.root.findByType('textarea').props.value,'400,1');assert.match(text(),/Enter a number from 20 to 400/);
await send('70,5');questionIs('collection');
await press('Confirm all collected');questionIs('step:samples-at-lab');await press('Skip for now');questionIs('finish');assert.match(text(),/1 not done yet/);
await press('Change an answer');questionIs('change');await press('Weight');questionIs('measure:weight');await send('71');questionIs('finish');
await press('Complete visit');questionIs('complete');assert.match(text(),/Safety check/);
await send('ab');assert.equal(screen.root.findByType('textarea').props.value,'ab');assert.match(text(),/at least 3 characters/);
const completeBefore=visitCommands.filter(row=>row.kind==='complete').length;
assert.equal(completeBefore,0,'Unanswered or not-done safety uses the same minimum reason check');
visitMode='booking-stale';await send('Member declined');assert.match(text(),/This booking changed/);assert.equal(screen.root.findByType('textarea').props.value,'Member declined');
const frozenIds=visitCommands.at(-1)!.command as NurseVisitCompleteCommand;
visitMode='';await send('Member declined');
const finalCommand=visitCommands.at(-1)!.command as NurseVisitCompleteCommand;
for(const key of ['submissionId','visitId','openSubmissionId','appendSubmissionId'] as const)assert.equal(finalCommand[key],frozenIds[key]);
assert.ok(visitData!.completion);questionIs('step:samples-at-lab');assert.match(text(),/Visit completed/);
assert.equal(screen.root.findAll(n=>n.props['data-today-visit']===visitId).length,1,'Lab handover keeps the completed visit in Today');
await press('Samples handed to the lab');assert.equal(visitQuestion(),undefined);
assert.equal(screen.root.findAll(n=>n.props['data-today-visit']===visitId).length,0,'Completed lab handover leaves Today');
assert.match(text(),/Open work, urgent alerts first/,'Unified work list remains after visit completion');
assert.equal(screen.root.findAll(n=>n.props['data-today-task']===dueTask.id).length,1,'Completing a visit preserves the remaining task');
assert.equal(screen.root.findAllByType('a').length,0);
await act(async()=>visitClose().props.onClick());await press('Visit with Ani Example');
const savedRows=screen.root.findAll(n=>n.props['data-visit-answer']);
assert.equal(new Set(savedRows.map(row=>row.props['data-visit-answer'])).size,savedRows.length,'Reopen does not duplicate server answers');
await act(async()=>screen.unmount());

for(const mode of ['unknown-unsaved','unknown-saved','throw','unavailable']){
 await mountVisit();visitMode=mode;await press('I confirmed the visit with the member');
 assert.equal(visitClose().props.disabled,true);assert.equal(button('Try again').props.disabled,false);
 await act(async()=>visitClose().props.onClick());assert.ok(visitClose());
 const request=visitCommands.at(-1)!.command;
 await act(async()=>screen.root.findByProps({className:'cv2-avatar'}).props.onClick());assert.equal(screen.root.findAll(n=>n.props.signOutHeld===true).length,1);
 visitMode='';await press('Try again');assert.equal(visitCommands.at(-1)!.command,request,'Uncertain step replay retains the command object and submission ID');questionIs('step:started');
 await act(async()=>screen.unmount());
}
await mountVisit();visitMode='pause';
let pendingVisit!:Promise<void>;
await act(async()=>{pendingVisit=button('I confirmed the visit with the member').props.onClick();});
assert.equal(visitClose().props.disabled,true);const inFlightCount=visitCommands.length;
await act(async()=>visitClose().props.onClick());assert.equal(visitCommands.length,inFlightCount);
await act(async()=>{finishSend();await pendingVisit;});
await act(async()=>screen.unmount());

// Server timestamps, including updates from another device, determine turn order.
const ordered=seededVisit();
ordered.steps=[{step:'confirmed',at:'2026-11-01T08:00:00Z',by:'Other nurse'},{step:'started',at:'2026-11-01T08:01:00Z',by:'Other nurse'}];
ordered.items[0].mark={done:true,note:null,values:{systolic:120,diastolic:80,pulse:null},recordedAt:'2026-11-01T08:03:00Z',nurseName:'Other nurse'};
ordered.items[1].mark={done:true,note:null,values:null,recordedAt:'2026-11-01T08:02:00Z',nurseName:'Other nurse'};
await mountVisit(ordered);
assert.deepEqual(screen.root.findAll(n=>n.props['data-visit-answer']).map(n=>n.props['data-visit-answer']),['step:confirmed','step:started','check:safety','measure:bp']);
visitData!.items[2].mark={done:false,note:null,values:null,recordedAt:'2026-11-01T08:04:00Z',nurseName:'Other nurse'};
await act(async()=>{poll();});questionIs('measure:weight');
assert.deepEqual(screen.root.findAll(n=>n.props['data-visit-answer']).map(n=>n.props['data-visit-answer']),['step:confirmed','step:started','check:safety','measure:bp']);
await act(async()=>screen.unmount());

const allDone=seededVisit();allDone.steps=[{step:'confirmed',at:'2026-11-01T08:00:00Z',by:'Narine'},{step:'started',at:'2026-11-01T08:01:00Z',by:'Narine'},{step:'samples-collected',at:'2026-11-01T08:02:00Z',by:'Narine'},{step:'samples-at-lab',at:'2026-11-01T08:03:00Z',by:'Narine'}];
for(const item of allDone.items)item.mark={done:true,note:null,values:null,recordedAt:'2026-11-01T08:04:00Z',nurseName:'Narine'};
await mountVisit(allDone);questionIs('finish');await press('Complete visit');questionIs('complete');assert.match(text(),/All items are done/);await press('Complete visit');assert.equal((visitCommands.at(-1)!.command as NurseVisitCompleteCommand).reason,null);assert.ok(visitData!.completion);await act(async()=>screen.unmount());
// A cancellation after the last read must settle into read-only instead of trapping retries.
await mountVisit();await press('I confirmed the visit with the member');await press('I have arrived');await press('Done');await press('Sample collection');
await press('Issue');const cancelledReason=screen.root.findAllByType('textarea').find(field=>field.props.maxLength===300)!;
await act(async()=>cancelledReason.props.onChange({target:{value:'Label needs checking'}}));
visitData!.visit.bookingStatus='cancelled';visitMode='cancelled';await press('Save collection status');
assert.match(text(),/This visit is read-only/);assert.match(text(),/Label needs checking/,'The unsaved reason stays readable after cancellation');
assert.equal(visitClose().props.disabled,false,'A confirmed cancellation releases the uncertain command');
assert.equal(screen.root.findAll(n=>n.props['data-sample-collection']!==undefined)[0].findAllByType('button').length,0);
await act(async()=>screen.unmount());
console.log('Nurse visits: real hook/renderer order, skip, not-done safety reason, comments, edit, parser errors, command metadata, frozen completion IDs, unknown exact retry/close/signout, in-flight hold, server timestamp poll/reopen, all-done completion and lab-only Today passed (controlled action IO; browser layout unverified).');

await mountVisit();await press('I confirmed the visit with the member');await press('I have arrived');await press('Done');await markNotCollected();questionIs('measure:bp');
await act(async()=>screen.root.findByType('textarea').props.onChange({target:{value:'123/80'}}));await press('Add a comment');await press('Go back');questionIs('measure:bp');assert.equal(screen.root.findByType('textarea').props.value,'123/80','Cancelling optional comment restores measurement words');
visitReadFails=true;await act(async()=>{poll();});assert.equal(visitQuestion(),undefined,'Unreadable visit removes stale controls');assert.equal(screen.root.findAll(n=>n.props['data-visit-answer']).length,0);assert.match(text(),/This visit is unavailable/);await act(async()=>screen.unmount());
for(const status of ['access','disabled']){await mountVisit();visitMode=status;await press('I confirmed the visit with the member');assert.equal(visitQuestion(),undefined,'Refused access removes visit controls');await act(async()=>screen.unmount());}
// Unknown item and completion commands keep their words and all four completion IDs.
await mountVisit();await press('I confirmed the visit with the member');await press('I have arrived');await press('Done');await markNotCollected();questionIs('measure:bp');
visitMode='unknown-unsaved';await send('148/93 72');const uncertainMark=visitCommands.at(-1)!.command;
assert.equal(screen.root.findByProps({'aria-label':'Systolic'}).props.value,'148');visitMode='';await press('Try again');assert.equal(visitCommands.at(-1)!.command,uncertainMark);questionIs('measure:weight');
await press('Skip for now');await press('Complete visit');visitMode='unknown-unsaved';await send('Return for missing items');const uncertainComplete=visitCommands.at(-1)!.command;
assert.equal(screen.root.findByType('textarea').props.value,'Return for missing items');visitMode='';await press('Try again');assert.equal(visitCommands.at(-1)!.command,uncertainComplete);assert.ok(visitData!.completion);await act(async()=>screen.unmount());

// A known write followed by a failed read must keep a reachable retry, even with no detail.
await mountVisit();visitReadFails=true;await press('I confirmed the visit with the member');assert.equal(visitQuestion(),undefined);assert.equal(visitClose().props.disabled,true);assert.equal(button('Try again').props.disabled,false);
const unreadCommand=visitCommands.at(-1)!.command;visitReadFails=false;await press('Try again');assert.equal(visitCommands.at(-1)!.command,unreadCommand);questionIs('step:started');await act(async()=>screen.unmount());

const twoReadings=()=>{const data=seededVisit();return {...data,items:data.items.filter(item=>item.kind==='measurement'),steps:[{step:'confirmed' as const,at:'2026-11-01T08:00:00Z',by:'Narine'},{step:'started' as const,at:'2026-11-01T08:00:00Z',by:'Narine'}]};};
const typed=()=>screen.root.findByType('textarea').props.value;
const writeReading=async(words:string,comment:string)=>{await act(async()=>screen.root.findByType('textarea').props.onChange({target:{value:words}}));await press('Add a comment');await send(comment);assert.equal(typed(),words);};
for(const failure of [async()=>'unavailable' as const,async()=>{throw Error('Read transport failed');}]){
 await mountVisit(twoReadings());questionIs('measure:bp');await writeReading('148','Left arm');
 visitReadOverride=failure;await act(async()=>{poll();});questionIs('measure:bp');assert.equal(typed(),'148','A failed poll changes nothing');assert.doesNotMatch(text(),/unavailable/);
 visitReadOverride=null;await act(async()=>{poll();});questionIs('measure:bp');assert.equal(typed(),'148','A failed then good poll keeps the words');assert.doesNotMatch(text(),/another device/);
 await act(async()=>screen.unmount());
}
await mountVisit(twoReadings());await writeReading('148','Left arm');visitReadOverride=async()=>null;await act(async()=>{poll();});assert.equal(visitQuestion(),undefined,'A refused read still removes the visit');assert.equal(typed(),'','Its words go with it');await act(async()=>screen.unmount());
for(const typedShortcut of [true,false]){
 await mountVisit(twoReadings());await writeReading('148/93','Left arm');
 const data:NurseVisitReady=structuredClone(visitData!),sent=visitCommands.length;visitData={...data,items:data.items.filter(item=>item.key!=='measure:bp')};visitMode='stale';if(typedShortcut)await send('148/93');else await press('Not taken');
 assert.equal(visitCommands.length,sent+(typedShortcut?0:1));assert.match(text(),/changed on another device|Saving stopped/,'The nurse is told the words were not used');if(typedShortcut)await press('Discard entry');questionIs('measure:weight');assert.equal(typed(),'','Refused words never move to the next question');
 visitMode='';await press('Not taken');const next=visitCommands.at(-1)!.command as NurseVisitMarkCommand;assert.equal(next.item,'measure:weight');assert.equal(next.note,null,'A refused comment never reaches the next question');assert.equal(next.values,null);
 await act(async()=>screen.unmount());
}
await mountVisit(twoReadings());await writeReading('148/93','Left arm');visitMode='stale';await send('148/93');questionIs('preview');assert.equal(screen.root.findByProps({'aria-label':'Systolic'}).props.value,'148','A refusal keeps the preview values');assert.doesNotMatch(text(),/another device/);await press('Discard entry');await press('Add a comment');assert.equal(typed(),'Left arm');await act(async()=>screen.unmount());
console.log('Nurse visit review regressions: unavailable/access/disabled deactivation, optional-comment return, exact mark/complete replay and saved-but-unread retry passed.');

// Execute Today itself: hydrate through the scoped RPC in bounded batches and
// retain usable work when optional identity data cannot be read.
const identityCommand=await import('@/lib/staff/member-identity-command');
const coordinationSchema=await import('@/lib/staff/real-coordination/schema');
modules['@/lib/staff/member-identity-command']=identityCommand;
modules['@/lib/staff/real-coordination/schema']=coordinationSchema;
modules.zod={z};modules['./contracts']=careAlertContracts;modules['@/lib/doctor-inbox/contracts']={orderAlerts};
const nurseAlerts=load('lib/care-alerts/nurse.ts') as typeof import('@/lib/care-alerts/nurse');
modules['@/lib/care-alerts/nurse']=nurseAlerts;
const readAlerts=async(...args:Parameters<typeof nurseAlerts.readNurseAlerts>)=>JSON.parse(JSON.stringify(await nurseAlerts.readNurseAlerts(...args))) as Awaited<ReturnType<typeof nurseAlerts.readNurseAlerts>>;
const todayTasks=Array.from({length:51},(_,i)=>({...dueTask,id:`ab330000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,caseId:`ab110000-0000-4000-8000-${String(i+1).padStart(12,'0')}`}));
let identityReadFails=false;
const identityBatches:string[][]=[];
modules['@/lib/patient-care/clinical-case-repository']={requireRealStaff:async()=>({identity:{role},client:{rpc:async(name:string,args:{p_members?:string[]})=>{
 if(name==='patient_coordination_queue')return {data:{tasks:todayTasks,nextCursor:null},error:null};
 assert.equal(name,'staff_member_identities');identityBatches.push(args.p_members!);
 return {data:args.p_members!.map(id=>({...member,id})),error:identityReadFails?{code:'42501'}:null};
}}})};
modules['@/lib/nurse-visit/runtime']={readNurseVisits:async()=>({enabled:true,visits:[{memberId:todayTasks[0].caseId}]})};
const todayAction=load('lib/nurse-chat/today-actions.ts').readNurseToday as ()=>Promise<{ok:boolean;page:{tasks:unknown[]};identities:unknown[];visits:unknown}>;
role='nurse';enabled=true;
let hydrated=await todayAction();assert.equal(hydrated.ok,true);assert.equal(hydrated.identities.length,51);
assert.deepEqual(identityBatches.map(batch=>batch.length),[50,1]);
assert.equal(new Set(identityBatches.flat()).size,51,'Duplicate task and visit member IDs read once');
identityReadFails=true;hydrated=await todayAction();assert.equal(hydrated.ok,true);assert.equal(hydrated.page.tasks.length,51);assert.equal(hydrated.identities.length,0);assert.ok(hydrated.visits);
const batchCount=identityBatches.length;
for(role of ['doctor','admin'])assert.equal((await todayAction()).ok,false);
assert.equal(identityBatches.length,batchCount,'Today role gate precedes optional identities');
// A doctor hand-over: first in the list with the doctor's note, and an Open conversation button that opens the member like a name tap.
{
 const handover={...dueTask,id:'aa330000-0000-4000-8000-0000000000f1',title:'From the doctor',instructions:'Please repeat her blood pressure and tell me',dueAt:null,sourceConversationId:'aa330000-0000-4000-8000-0000000000f2',origin:'doctor_handover' as const};
 const opened:string[]=[];
 const View=(modules['./messages'] as {NurseReply:React.ComponentType<{reply:unknown;locale:string;onMember:(member:{id:string})=>void}>}).NurseReply;
 const html=renderToStaticMarkup(React.createElement(View,{locale:'en',onMember:m=>opened.push(m.id),reply:{kind:'today',data:{ok:true,identities:[],asOf:'2026-11-01T08:00:00Z',page:{tasks:[dueTask,handover],nextCursor:null},visits:{enabled:false,visits:[]}}}}));
 const first=html.indexOf('data-today-task="'+handover.id),second=html.indexOf('data-today-task="'+dueTask.id);
 assert.ok(first>0&&second>first,'The hand-over is listed before the other task');
 assert.ok(html.includes('data-doctor-handover')&&html.includes('Please repeat her blood pressure and tell me'),'The doctor note is shown');
 assert.ok(html.includes('Open conversation'),'It offers to open the conversation');
 assert.equal((html.match(/Open conversation/g)??[]).length,2,'Both the hand-over and ordinary task open their member conversation');
}
// Urgent alerts: first in the shared work list, a failed read is never "no alerts", and the switch keeps them off.
{
 const alertId='ab440000-0000-4000-8000-000000000001',alertMember='ab110000-0000-4000-8000-000000000001';
 const row={id:alertId,memberId:alertMember,memberName:'Fictional member',source:'zoe',priority:'urgent',reason:'zoe_self_harm',redFlags:[],state:'open',stateSeq:0,occurrences:1,createdAt:'2026-11-04T08:00:00Z',lastSeenAt:'2026-11-04T08:00:00Z',acknowledgedAt:null,doctorName:'Fictional doctor',acknowledgedBy:null,resolvedAt:null,resolvedBy:null,resolution:null,resolutionNote:null,telegram:[],ownerName:'Narine',ownerRole:'nurse'};
 const calls:string[]=[];
 const fake=(result:unknown)=>({rpc:async(name:string,args:unknown)=>{calls.push(name+JSON.stringify(args));return result;}});
 assert.deepEqual(await readAlerts(fake({data:null,error:null}),{}),{kind:'off'});assert.equal(calls.length,0,'Switch off reads nothing');
 const on={NOREON_CARE_ALERTS_ENABLED:'true'};
 assert.deepEqual(await readAlerts(fake({data:{ok:true,asOf:'2026-11-04T09:00:00Z',total:1,alerts:[row]},error:null}),on),{kind:'ready',alerts:[row],total:1});
 assert.equal(calls[0],'care_alert_nurse_inbox{"p_limit":50}');
 { // Same order as the doctor chat: open first, Zoe and member words before questionnaire, then most recent activity.
  const mk=(n:number,over:object)=>({...row,id:`ab440000-0000-4000-8000-00000000010${n}`,...over});
  const unordered=[mk(1,{source:'questionnaire',lastSeenAt:'2026-11-04T10:00:00Z'}),mk(2,{state:'acknowledged',acknowledgedAt:'2026-11-04T09:00:00Z',lastSeenAt:'2026-11-04T11:00:00Z'}),mk(3,{source:'zoe',lastSeenAt:'2026-11-04T07:00:00Z'}),mk(4,{source:'message',lastSeenAt:'2026-11-04T08:00:00Z'})];
  const got=await readAlerts(fake({data:{ok:true,asOf:'2026-11-04T12:00:00Z',total:4,alerts:unordered},error:null}),on);
  assert.ok(got.kind==='ready');assert.deepEqual(got.alerts.map(a=>a.id.slice(-1)),['4','3','1','2'],'open message and Zoe alerts (newest first), then open questionnaire, then acknowledged');
 }
 const warningsBefore=readWarnings.length;
 assert.deepEqual(await readAlerts(fake({data:null,error:{code:'42501'}}),on),{kind:'unavailable'});
 assert.deepEqual(await readAlerts(fake({data:{ok:true,total:1,alerts:[{...row,priority:'high'}]},error:null}),on),{kind:'unavailable'},'A malformed row is a failed read');
 assert.deepEqual(await readAlerts({rpc:async()=>{throw Error('Offline');}},on),{kind:'unavailable'});
 const {ownerName:omittedOwner,...missingOwner}=row;void omittedOwner;
 assert.deepEqual(await readAlerts(fake({data:{ok:true,asOf:'2026-11-04T09:00:00Z',total:1,alerts:[missingOwner]},error:null}),on),{kind:'unavailable'},'Missing ownership is an incomplete read, never an unassigned alert');
 assert.equal(readWarnings.length-warningsBefore,4,'Refused, malformed, thrown and ownership-incomplete reads all log their failure');
 assert.ok(readWarnings.slice(warningsBefore).every(message=>message==='Nurse urgent alerts could not be read'),'Read failure logging uses fixed text without member data');
 const Today=(modules['./messages'] as {NurseReply:React.ComponentType<{reply:unknown;locale:string;onMember:(member:{id:string})=>void}>}).NurseReply;
 const opened:string[]=[];
 const render=(alerts:unknown,locale='en')=>renderToStaticMarkup(React.createElement(Today,{locale,onMember:member=>opened.push(member.id),reply:{kind:'today',data:{ok:true,identities:[],alerts,asOf:'2026-11-04T09:00:00Z',page:{tasks:[],nextCursor:null},visits:{enabled:false,visits:[]}}}}));
 for(const locale of ['en','hy','ru'] as const){
  const view=Today as React.ComponentType<{locale:copy.StaffLocale;nurseName:string;onMember:()=>void;reply:unknown}>;
  let tree!:ReactTestRenderer;
  await act(async()=>{tree=create(React.createElement(view,{locale,nurseName:'Fictional closer',onMember(){},reply:{kind:'today',data:{ok:true,identities:[],alerts:{kind:'ready',alerts:[row],total:1},asOf:'2026-11-04T09:00:00Z',page:{tasks:[],nextCursor:null},visits:{enabled:false,visits:[]}}}}));});
  const line=()=>tree.root.findByProps({'data-closing-as':'resolve'});
  const name={en:'Closing as Fictional closer',hy:'Փակվում է Fictional closer-ի անունով',ru:'Закрывается от имени: Fictional closer'}[locale];
  assert.equal(line().children.join(''),name,'No extra outcome until one is selected');
  assert.equal(line().props['aria-live'],'polite');assert.equal(line().type,'p');
  for(const [value,outcome] of [
   ['member_contacted',{en:'Member contacted',hy:'Կապ է հաստատվել անդամի հետ',ru:'С участником связались'}[locale]],
   ['other',{en:'Other (see note)',hy:'Այլ (տե՛ս նշումը)',ru:'Другое (см. примечание)'}[locale]],
  ]){
   await act(async()=>tree.root.findByType('select').props.onChange({target:{value}}));
   assert.equal(line().children.join(''),`${name} · ${outcome}`,'Choosing an outcome updates the closing line');
  }
  const updated={kind:'today',data:{ok:true,identities:[],alerts:{kind:'ready',alerts:[{...row,state:'acknowledged',stateSeq:1}],total:1},asOf:'2026-11-04T09:01:00Z',page:{tasks:[],nextCursor:null},visits:{enabled:false,visits:[]}}};
  await act(async()=>tree.update(React.createElement(view,{locale,nurseName:'Fictional closer',onMember(){},reply:updated})));
  assert.equal(line().children.join(''),name,'A new alert sequence clears the previous proposal and outcome');
  assert.equal(tree.root.findByType('select').props.required,true);
  assert.equal(tree.root.findAllByType('textarea').find(n=>n.props.name==='note')!.props.required,true);
  await act(async()=>tree.unmount());
 }
 const ready=render({kind:'ready',alerts:[row],total:1});
 assert.ok(ready.includes(`data-today-alert="${alertId}"`)&&ready.includes('Fictional member')&&ready.includes('self-harm'),'The urgent alert is on Today with the member and the reason');
 assert.ok(ready.includes('1 open alerts, tasks and visits')&&!ready.includes('No open work'),'An urgent alert is counted as open work');
 assert.ok(ready.includes('Acknowledge')&&ready.includes('Save next action')&&ready.includes('Save resolution'),'The same row exposes acknowledgement, next action and resolution');
 assert.ok(ready.includes('Narine'),'The named owner appears');
 const unavailable=render({kind:'unavailable'});
 assert.ok(unavailable.includes('data-urgent-alerts="unavailable"')&&unavailable.includes('could not be read')&&!unavailable.includes('No open work'),'A failed alert read is said out loud and never claims no open work');
 assert.ok(!render({kind:'ready',alerts:[],total:0}).includes('data-today-alert'),'No alerts, no urgent row');
 assert.ok(!render({kind:'off'}).includes('data-today-alert')&&!render(undefined).includes('data-today-alert'),'Switch off shows nothing');
 assert.ok(render({kind:'ready',alerts:[row],total:3}).includes('More urgent alerts exist'),'A cut list says there are more');
 const acknowledged=render({kind:'ready',alerts:[{...row,state:'acknowledged',acknowledgedAt:'2026-11-04T08:30:00Z',acknowledgedBy:'Narine'}],total:1});
 assert.ok(acknowledged.includes('Acknowledged')&&acknowledged.includes('Narine')&&!acknowledged.includes('>Acknowledge<'),'Acknowledgement names the actor and removes the acknowledgement action');
 for(const locale of ['hy','ru'])assert.ok(render({kind:'ready',alerts:[row],total:1},locale).includes(`data-today-alert="${alertId}"`),`${locale} renders`);
 let urgentTree:ReactTestRenderer|null=null;
 const reply={kind:'today',data:{ok:true,identities:[],alerts:{kind:'ready',alerts:[row],total:1},asOf:'2026-11-04T09:00:00Z',page:{tasks:[dueTask],nextCursor:null},visits:{enabled:true,today:'2026-11-04',visits:[{id:'urgent-visit',source:'appointment',memberId:alertMember,memberName:'Fictional member',startsAt:'2026-11-04T08:00:00Z',completion:null}]}}};
 try{
  await act(async()=>{urgentTree=create(React.createElement(Today,{locale:'en',onMember:member=>opened.push(member.id),reply}));});
  const list=urgentTree!.root.findAllByType('ul')[0];
  assert.equal(list.children.length,3,'Urgent alert, overdue task and visit share one list');
  assert.equal((list.children[0] as import('react-test-renderer').ReactTestInstance).props['data-today-alert'],alertId,'Urgent alert is the first row');
  const expectedMembers=[alertMember,dueTask.caseId,alertMember];
  for(const [index,row] of list.children.entries()){
   const open=(row as import('react-test-renderer').ReactTestInstance).findAllByType('button').find(button=>button.children.includes('Open conversation'));
   assert.ok(open,'Every Today item offers Open conversation');
   await act(async()=>open.props.onClick());
   assert.equal(opened.at(-1),expectedMembers[index],'The item opens its own member conversation');
  }
  const beforeReplies=sendCalls.length;
  const rowNode=()=>urgentTree!.root.findByProps({'data-urgent-alert':alertId});
  await act(async()=>rowNode().findAllByType('button').find(button=>button.props.className==='ncv2-choice')!.props.onClick());
  assert.equal(opened.at(-1),alertMember,'The urgent row opens its own member');
  const acknowledgedRow={...row,state:'acknowledged',stateSeq:1,acknowledgedAt:'2026-11-04T09:01:00Z',acknowledgedBy:'Narine'};
  alertCommandResult={ok:true,alert:acknowledgedRow};
  await act(async()=>rowNode().findAllByType('button').find(button=>button.children.includes('Acknowledge'))!.props.onClick());
  assert.equal(alertCommands.at(-1)?.kind,'acknowledge');assert.equal(alertCommands.at(-1)?.seq,0);
  assert.equal(rowNode().findAllByType('button').filter(button=>button.children.includes('Acknowledge')).length,0,'Confirmed acknowledgement updates the row locally');
  const actionRow={...acknowledgedRow,stateSeq:2,nextAction:'Call again this afternoon',nextActionAt:'2026-11-04T09:02:00Z',nextActionBy:'Narine',nextActionDueAt:'2026-11-04T12:00:00Z'};
  alertCommandResult={ok:true,alert:actionRow};
  const nextForm=new FormData();nextForm.set('text',actionRow.nextAction);nextForm.set('dueAt','2026-11-04T12:00:00Z');
  await act(async()=>rowNode().findAllByType('form').find(form=>form.findAllByProps({name:'text'}).length)!.props.onSubmit({preventDefault(){},currentTarget:nextForm}));
  assert.equal(alertCommands.at(-1)?.kind,'next_action');assert.equal(alertCommands.at(-1)?.seq,1);
  assert.ok(JSON.stringify(urgentTree!.toJSON()).includes(actionRow.nextAction),'The recorded next action updates locally');
  alertCommandResult={ok:true,alert:{...actionRow,state:'resolved',stateSeq:3,resolvedAt:'2026-11-04T09:03:00Z',resolvedBy:'Narine',resolution:'member_contacted',resolutionNote:'Reached the member'}};
  const resolutionForm=new FormData();resolutionForm.set('resolution','member_contacted');resolutionForm.set('note','Reached the member');
  await act(async()=>rowNode().findAllByType('details').find(details=>details.props.onToggle)!.props.onToggle({currentTarget:{open:true}}));
  await act(async()=>rowNode().findAllByType('form').find(form=>form.findAllByProps({name:'resolution'}).length)!.props.onSubmit({preventDefault(){},currentTarget:resolutionForm}));
  assert.equal(alertCommands.at(-1)?.kind,'resolve');assert.equal(alertCommands.at(-1)?.seq,2);
  assert.equal(urgentTree!.root.findAll(node=>node.props['data-today-alert']===alertId).length,0,'Confirmed resolution leaves the chat open-work list immediately');
  assert.ok(urgentTree!.root.findAllByType('p').some(p=>p.children.join('')==='2 open alerts, tasks and visits · 2 overdue'),'Confirmed resolution updates the open count while retaining remaining overdue work');
  assert.equal(urgentTree!.root.findAllByType('ul')[0].children.length,2);
  assert.equal(sendCalls.length,beforeReplies,'Alert controls never send a member message');
 }finally{if(urgentTree)await act(async()=>urgentTree!.unmount());alertCommandResult={ok:false,code:'unavailable'};}

 // Alert forms keep their words outside the main composer. Both navigation paths
 // must use the same pending-input guard, including after an unconfirmed save.
 for(const kind of ['next_action','resolve','unavailable'] as const){
  todayResult=reply.data;
  await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
  await send('today');
  const alertRow=screen.root.findByProps({'data-urgent-alert':alertId});
  if(kind==='resolve')await act(async()=>alertRow.findAllByType('details').find(details=>details.props.onToggle)!.props.onToggle({currentTarget:{open:true}}));
  const form=alertRow.findAllByType('form').find(form=>form.findAllByProps({name:kind==='resolve'?'resolution':'text'}).length)!;
  const draft=new FormData();
  if(kind==='resolve'){draft.set('resolution','member_contacted');draft.set('note','Reached the member');}
  else draft.set('text','Call again this afternoon');
  if(kind==='next_action')draft.set('dueAt','2026-11-04T12:00');
  await act(async()=>form.props.onChange({currentTarget:draft}));
  const before:number=todayCalls;
  location.hash='#today';await act(async()=>{browser.dispatchEvent(new Event('hashchange'));});
  assert.equal(todayCalls,before,'An alert form draft defers Today');assert.equal(location.hash,'#today');
  await act(async()=>alertRow.findAllByType('button').find(button=>button.props.className==='ncv2-choice')!.props.onClick());
  assert.equal(screen.root.findAllByProps({'aria-label':'Close conversation'}).length,0,'Member selection shares the pending-input guard');
  alertCommandResult=kind==='unavailable'?{ok:false,code:'unavailable'}:{ok:true,alert:{...row,state:kind==='resolve'?'resolved':'open',stateSeq:1,nextAction:kind==='next_action'?'Call again this afternoon':null}};
  await act(async()=>form.props.onSubmit({preventDefault(){},currentTarget:draft}));
  assert.equal(todayCalls,before+(kind==='unavailable'?0:1),'Only a confirmed alert save releases pending Today');
  assert.equal(location.hash,kind==='unavailable'?'#today':'');
  if(kind==='next_action'){
   draft.set('dueAt','');await act(async()=>form.props.onChange({currentTarget:draft}));
   location.hash='#today';await act(async()=>{browser.dispatchEvent(new Event('hashchange'));});
   assert.equal(todayCalls,before+1,'Removing a saved due time is also an unsaved edit');assert.equal(location.hash,'#today');
   draft.set('dueAt','2026-11-04T12:00');await act(async()=>form.props.onChange({currentTarget:draft}));
   assert.equal(todayCalls,before+2,'Reverting the alert form to its saved values releases Today');assert.equal(location.hash,'');
  }
  await act(async()=>screen.unmount());location.hash='';alertCommandResult={ok:false,code:'unavailable'};
 }

 console.log('Nurse urgent alerts: switch, unavailable-versus-none, malformed rows, shared urgent-first list, owner and controls, cut list and languages passed.');
}
console.log('Today action: scoped identity batches of at most 50, deduplication, nurse gate and silent identity failure passed (isolated IO).');

// Same-name members must keep their own identity even if bulk results arrive in
// a different order from Today tasks. This exercises the real rendered reply.
const secondMember={...member,id:'ab110000-0000-4000-8000-000000000099',birthDate:'1970-02-03',birthYear:1970,phoneLast4:'9876'};
const secondTask={...dueTask,id:'ab330000-0000-4000-8000-000000000099',caseId:secondMember.id};
const IdentityReply=(modules['./messages'] as {NurseReply:React.ComponentType<{reply:unknown;locale:string;onMember:()=>void}>}).NurseReply;
const identityMarkup=renderToStaticMarkup(React.createElement(IdentityReply,{locale:'en',onMember:()=>{},reply:{kind:'today',data:{ok:true,identities:[secondMember,member],asOf:'2026-11-01T08:00:00Z',page:{tasks:[dueTask,secondTask],nextCursor:null},visits:{enabled:false,visits:[]}}}}));
const identityRows=[...identityMarkup.matchAll(/<li[^>]*data-today-task="([^"]+)"[^>]*>(.*?)<\/li>/g)];
assert.equal(identityRows.length,2);
for(const row of identityRows){
 const expected=row[1]===dueTask.id?member:secondMember;
 const unexpected=row[1]===dueTask.id?secondMember:member;
 assert.ok(row[2].includes(identityModel.chatMemberIdentityLine(expected,'en')));
 assert.ok(!row[2].includes(`•••• ${unexpected.phoneLast4}`),'Never show another member’s phone suffix');
}
// A visit earlier today that is not done must not sit under a "Next visit" heading.
const pastVisitMarkup=(startsAt:string,completion:unknown)=>renderToStaticMarkup(React.createElement(IdentityReply as React.ComponentType<Record<string,unknown>>,{locale:'en',onMember:()=>{},visits:{disabled:false,updates:{},onOpen:()=>{}},reply:{kind:'today',data:{ok:true,identities:[member],asOf:'2026-11-01T13:28:00Z',page:{tasks:[],nextCursor:null},visits:{enabled:true,today:'2026-11-01',visits:[{id:'v1',source:'appointment',memberId:member.id,memberName:member.name,startsAt,completion}]}}}}));
const pastMarkup=pastVisitMarkup('2026-11-01T08:00:00Z',null);
assert.ok(!pastMarkup.includes('Next visit'),'A past visit is not the next visit');
assert.ok(pastMarkup.includes('Open work, urgent alerts first')&&pastMarkup.includes('Overdue'),'A past, unfinished visit today is listed as overdue');
const laterMarkup=pastVisitMarkup('2026-11-01T15:00:00Z',null);
assert.ok(laterMarkup.includes('Open work, urgent alerts first')&&!laterMarkup.includes('Overdue'),'A visit later today is not overdue');
const searchMarkup=renderToStaticMarkup(React.createElement(IdentityReply,{locale:'en',onMember:()=>{},reply:{kind:'members',page:{rows:[member,secondMember],hasMore:false,nextCursor:null}}}));
for(const expected of [member,secondMember])assert.ok(searchMarkup.includes(identityModel.chatMemberIdentityLine(expected,'en')),'Same-name search choices are distinguishable');
console.log('Rendered identity rows: same-name members retain their own birthday and phone suffix with shuffled bulk results.');

// Care notes use one composer job and can never call the member reply action.
async function mountNotes(){
 notesMode='';notesReadMode='';notesRevision=1;careNotes=[];noteCalls.length=0;workspace={...base,items:[]};
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 await send('Ani');await press(identityModel.chatMemberIdentityLine(member,'en'));await press('Notes');await press('Add a note');
 assert.equal(screen.root.findByType('textarea').props['aria-label'],'Care note');
 assert.equal(screen.root.findAll(n=>n.props['aria-label']==='Close conversation').length,0,'The row above the composer names only its current job');
}
await mountNotes();const memberReplies=sendCalls.length;
await send('Observed a delivered cuff');
assert.equal(noteCalls.length,1);assert.equal(sendCalls.length,memberReplies,'A care note never reaches sendNurseReply');
assert.equal(careNotes[0].note,'Observed a delivered cuff');assert.equal(screen.root.findByType('textarea').props.value,'');
assert.equal(screen.root.findAll(n=>n.props['data-note-job']).length,0,'The used note form leaves');
await send('Thank you');assert.equal(sendCalls.at(-1)?.body,'Thank you','After the note finishes the composer returns to member replies');
assert.ok(text().indexOf('Observed a delivered cuff')<text().indexOf('Thank you'),'A reply sent after a note appears after it');
if(workspace.ok)workspace={...workspace,version:workspace.version+1,items:[...workspace.items,{id:'after-note',text:'Incoming after the note',at:serverNow(),senderName:'Ani',senderRole:'member'}]};
await act(async()=>{poll();});assert.ok(text().indexOf('Observed a delivered cuff')<text().indexOf('Incoming after the note'),'A later incoming message remains later than the note');
await act(async()=>screen.unmount());
await mountNotes();notesMode='unknown';await send('Exact uncertain note');
const uncertainNote=noteCalls.at(-1);assert.equal(screen.root.findByProps({'aria-label':'Close care note'}).props.disabled,true);
await act(async()=>screen.root.findByProps({className:'cv2-avatar'}).props.onClick());assert.equal(screen.root.findAll(n=>n.props.signOutHeld===true).length,1);
await act(async()=>screen.root.findByProps({'aria-label':'Close care note'}).props.onClick());
notesMode='';await press('Retry this note');assert.equal(noteCalls.at(-1),uncertainNote,'Unknown note retries the exact member, revision, kind and words');assert.equal(careNotes.length,1);
await act(async()=>screen.unmount());
for(const refusal of ['unavailable','denied']){
 await mountNotes();notesMode='refused';notesReadMode=refusal;await send('Keep only for this member');
 assert.equal(screen.root.findByType('textarea').props.value,refusal==='denied'?'':'Keep only for this member');
 if(refusal==='unavailable'){await act(async()=>screen.root.findByProps({'aria-label':'Close care note'}).props.onClick());await act(async()=>screen.root.findByProps({'aria-label':'Close conversation'}).props.onClick());}
 else{assert.equal(screen.root.findAll(n=>n.props['data-care-notes']).length,0);assert.equal(screen.root.findAll(n=>n.props['aria-label']==='Close conversation').length,0,'A denied reconciliation read also revokes the member target');}
 assert.equal(screen.root.findByType('textarea').props.value,'','Refused words do not carry into another job');
 await act(async()=>screen.unmount());
}
console.log('Nurse care-note composer: note/reply isolation, exclusive job row, used form removal, exact unknown replay/close/sign-out hold, read failure/refusal and target-bound drafts passed (controlled action IO).');

// Unknown saved CAS replay must not turn a retained note into a second request at a new revision.
await mountNotes();notesMode='unknown-saved';await send('Possibly already recorded');
assert.equal(careNotes.length,1);notesMode='';await press('Retry this note');
assert.equal((noteCalls.at(-1) as {revision:number}).revision,1);assert.equal(screen.root.findByType('textarea').props.value,'Possibly already recorded');
assert.equal(screen.root.findByType('textarea').props.readOnly,true);const attempts=noteCalls.length;
await send('Possibly already recorded');await press('Reached');await send('Another note');
assert.equal(noteCalls.length,attempts,'An uncertain replay conflict cannot be resubmitted with a newer revision');assert.equal(careNotes.length,1);
await act(async()=>screen.root.findByProps({'aria-label':'Close care note'}).props.onClick());assert.equal(screen.root.findByType('textarea').props.value,'');await act(async()=>screen.unmount());

// Prefer a fresh read over a lower cached task revision, including its event history.
const currentTaskPage={tasks:[{...dueTask,revision:3,title:'Current external task',instructions:'Current external instructions'}],nextCursor:null};
const taskIo=modules['@/lib/staff/real-coordination/actions'] as Record<string,unknown>;
taskIo.readCoordinationPage=async()=>({ok:true,page:currentTaskPage});
taskToday([dueTask]);await mountTask();await send('First local completion');
taskSnapshot={...dueTask,revision:3,title:'Current external task',instructions:'Current external instructions',events:[]};
await press('See all tasks');assert.match(text(),/Current external task/);
const latestList=screen.root.findByProps({'data-task-list':true});assert.equal(latestList.findAllByType('button').filter(node=>node.children.includes('Current external task')).length,1);
await press('Current external task');assert.match(text(),/Current external instructions/);await act(async()=>screen.unmount());

// Failed reads retain current content; explicit refusal removes scoped visit/note cards.
const v2io=modules['@/lib/nurse-chat/v2-actions'] as Record<string,unknown>;
let listStatus='ready';
v2io.readNurseChatVisits=async()=>listStatus==='ready'?{status:'ready',data:{version:'nurse-visit-v1',enabled:true,today:'2026-11-01',role:'nurse',visits:[]}}:{status:listStatus};
taskToday([dueTask]);await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});await send('today');await press('See all visits');
assert.equal(screen.root.findAll(n=>n.props['data-visit-list']).length,1);await send('today');
listStatus='unavailable';const beforeFailedList=text();await press('See all visits');assert.equal(text(),beforeFailedList,'A failed visit list read changes nothing');
listStatus='refused';await press('See all visits');assert.equal(screen.root.findAll(n=>n.props['data-visit-list']).length,0,'Known refusal removes previous visits');await act(async()=>screen.unmount());
await mountNotes();await act(async()=>screen.root.findByProps({'aria-label':'Close care note'}).props.onClick());
notesReadMode='unavailable';const beforeFailedNotes=text();await press('Notes');assert.equal(text(),beforeFailedNotes,'A failed notes read changes nothing');
notesReadMode='denied';await press('Notes');assert.equal(screen.root.findAll(n=>n.props['data-care-notes']).length,0);assert.equal(screen.root.findAll(n=>n.props['aria-label']==='Close conversation').length,0);await act(async()=>screen.unmount());
console.log('Review regressions: uncertain note replay cannot duplicate, note/reply/poll chronology, freshest task snapshot and explicit read refusal removal passed (controlled action IO).');

// Future visits allow confirmation with the member, while collection still waits for the visit day.
const futureVisit=seededVisit();futureVisit.visit.startsAt='2026-11-03T09:00:00Z';futureVisit.today='2026-11-01';visitData=futureVisit;visitMode='';visitReadOverride=null;visitReadFails=false;visitCommands.length=0;
v2io.readNurseChatVisits=async()=>({status:'ready',data:{version:'nurse-visit-v1',enabled:true,today:'2026-11-01',role:'nurse',visits:[{...futureVisit.visit,samplesTaken:0,samplesPlanned:1,openItems:4,steps:[]}]}});
taskToday([{...dueTask,dueAt:null,title:'Task without a due date'}]);
await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});await send('today');assert.match(text(),/Task without a due date/);
await press('See all visits');await act(async()=>screen.root.findByProps({'data-visit-open':futureVisit.visit.id}).props.onClick());
assert.match(text(),/On the visit day/);questionIs('step:confirmed');assert.equal(visitCommands.length,0);
assert.equal(screen.root.findAll(n=>n.props['data-sample-collection']!==undefined).length,0);
await press('I confirmed the visit with the member');assert.equal(visitCommands.length,1);assert.equal(visitQuestion(),undefined);
assert.equal(screen.root.findAll(n=>n.props['data-sample-collection']!==undefined).length,0,'Visit-day gate keeps collection closed after confirmation');await act(async()=>screen.unmount());
console.log('Future visits allow confirmation but hold collection until the day; no-date tasks remain visible in Today (controlled UI/action IO).');

// A Zoe question is its own kind of turn, never a member reply.
await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
zoeFind={kind:'member',memberId:member.id,memberName:member.name};
const repliesBeforeZoe=sendCalls.length;
await send('What is Ani Example pressure?');
assert.match(text(),/Synthetic recorded answer/);
assert.match(text(),/To Zoe/);
assert.equal(zoeQuestions.length,1);assert.equal(zoeOpens,1);
assert.equal(sendCalls.length,repliesBeforeZoe,'Zoe questions never reach sendNurseReply');
assert.equal(zoeHistoryCalls,2,'One lazy history read per mounted screen, including failed reads');
zoeFind={kind:'keep'};zoeStreamMode='cut';await send('What changed?');
const lastReply=screen.root.findAll(node=>node.props['data-message-key']!==undefined).at(-1)!;
assert.ok(lastReply.findAll(node=>node.props.role==='alert').length,'A cut stream is an error');
assert.ok(!lastReply.findAllByType('p').some(node=>node.children.includes('Synthetic recorded answer')),'Partial content is not a completed answer');
zoeStreamMode='refused';await send('What changed?');assert.match(text(),new RegExp(staffZoeCopy.staffZoeRefusal('rate_limited','en').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
zoeFind={kind:'choose',rows:[{id:member.id,name:member.name}]};zoeStreamMode='';
await send('What is Ani pressure?');
await act(async()=>screen.root.findAllByType('button').findLast(button=>button.findAll(node=>node.props['data-member-identity']===member.id).length>0)!.props.onClick());
assert.ok(screen.root.findAllByProps({'data-member-disambiguation':true}).at(-1)!.findAllByType('button').every(button=>button.props.disabled),'Used choices keep their identity lines with disabled buttons');
assert.equal(zoeQuestions.length,4);assert.equal(sendCalls.length,repliesBeforeZoe);
await act(async()=>screen.unmount());
console.log('Nurse Zoe composer: lazy failed-history no-op, resolved answer, own Zoe turns, no member sends, refusal, cut stream and retired member choices passed (mocked IO).');

// Malformed stream content is an error, never a completed answer with nothing in it.
await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
zoeFind={kind:'member',memberId:member.id,memberName:member.name};
for(const mode of ['no-content','bad-content','bad-cards','bad-code','empty','cut']){
 zoeStreamMode=mode;zoeFind={kind:'member',memberId:member.id,memberName:member.name};await send(`What is Ani Example pressure? (${mode})`);
 const reply=screen.root.findAll(node=>node.props['data-message-key']!==undefined).at(-1)!;
 assert.ok(reply.findAll(node=>node.props.role==='alert').length,`${mode} stream shows an error`);
 assert.ok(!reply.findAll(node=>node.props['data-testid']==='zoe-answer').length,`${mode} stream never shows a completed answer`);
 assert.ok(!screen.root.findAll(node=>node.props['data-testid']==='zoe-answer').some(node=>node.children.some(child=>typeof child==='string'&&child.includes('(' + mode + ')'))),`${mode} leaves no answer for that question`);
}
zoeStreamMode='';
await act(async()=>screen.unmount());

// Nothing starts after the nurse has left the chat, with the conversation cached or not.
for(const cached of [true,false]){
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 zoeFind={kind:'member',memberId:member.id,memberName:member.name};
 if(cached)await send('What is Ani Example pressure? (cache)');
 const before:number=zoeQuestions.length,opensBefore:number=zoeOpens;
 let release:()=>void=()=>{};zoeGate=new Promise<void>(done=>{release=done;});
 zoeFind=cached?{kind:'keep'}:{kind:'member',memberId:member.id,memberName:member.name};
 await act(async()=>{screen!.root.findByType('textarea').props.onChange({target:{value:'What changed?'}});});
 await act(async()=>{void screen!.root.findByProps({className:'cv2-composer'}).props.onSubmit({preventDefault(){}});});
 await act(async()=>screen.unmount());
 release();zoeGate=null;await act(async()=>{await new Promise(done=>setTimeout(done,20));});
 assert.equal(zoeQuestions.length,before,`No question starts after unmount (${cached?'cached':'uncached'} conversation)`);
 if(!cached)assert.equal(zoeOpens,opensBefore,'No conversation is opened after unmount');
}
console.log('Nurse Zoe hardening: malformed or cut streams are errors and nothing starts after the chat is gone (mounted component, mocked IO).');

// Ordinary short record follow-ups must not be mistaken for a bare name in any language.
await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
zoeFind={kind:'member',memberId:member.id,memberName:member.name};
await send('What is Ani Example pressure?');
zoeFind={kind:'keep'};
for(const words of ['Latest blood pressure','Покажи последние анализы','Ինչպես է ճնշումը']){
 const searchesBefore:number=searchCalls,questionsBefore:number=zoeQuestions.length;
 await send(words);
 assert.equal(searchCalls,searchesBefore,`${words} is a record question, not a name search`);
 assert.equal(zoeQuestions.length,questionsBefore+1,`${words} reaches the existing Zoe path`);
}
await act(async()=>screen.unmount());
console.log('Nurse Zoe short EN/HY/RU follow-ups reach Zoe rather than name search (mounted component, mocked IO).');

// In an open member conversation the nurse chooses where words go: the member by default, Zoe by an explicit switch.
workspace={...base};sendMode='';searchFails=false;
await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
await send('Ani');const searchBase=searchCalls;
await act(async()=>{screen!.root.findAllByType('button').filter(b=>b.findAll(node=>node.props['data-member-identity']===member.id).length>0).at(-1)!.props.onClick();});
const switchButton=()=>screen!.root.findAll(node=>node.type==='button'&&node.props['data-zoe-switch']!==undefined)[0];
const composerText=()=>screen!.root.findByType('textarea');
assert.equal(switchButton()?.props['data-zoe-switch'],'zoe','An open member conversation offers a switch to Zoe');
assert.equal(composerText().props.placeholder,'Reply to Ani Example','Replying to the member is the default');
const zoeBase=zoeQuestions.length,memberBase=sendCalls.length;
await send('Hello, how are you feeling?');
assert.equal(sendCalls.length,memberBase+1,'By default words go to the member');assert.equal(zoeQuestions.length,zoeBase);
// A draft typed for the member never survives the switch, in either direction.
await act(async()=>{composerText().props.onChange({target:{value:'a draft for the member'}});});
await act(async()=>switchButton().props.onClick());
assert.equal(composerText().props.value,'','Switching clears the draft');
assert.equal(composerText().props.placeholder,'Ask Zoe about Ani Example');
assert.match(text(),/Asking Zoe about Ani Example/);
zoeFind={kind:'keep'};
await send('What is her latest blood pressure?');
assert.equal(zoeQuestions.length,zoeBase+1,'In Zoe mode words go to the existing Zoe path');
assert.equal(sendCalls.length,memberBase+1,'A Zoe question never reaches the member');
assert.match(text(),/To Zoe/);
assert.equal(searchCalls,searchBase,'Zoe mode never turns words into a name search');
await send('today');
assert.equal(zoeQuestions.length,zoeBase+2,'Even the word today is a Zoe question in Zoe mode');assert.equal(sendCalls.length,memberBase+1);
await act(async()=>{composerText().props.onChange({target:{value:'a draft for Zoe'}});});
await act(async()=>switchButton().props.onClick());
assert.equal(composerText().props.value,'','A Zoe draft never becomes a member reply');
assert.equal(composerText().props.placeholder,'Reply to Ani Example');
assert.equal(switchButton().props['data-zoe-switch'],'zoe');
await send('Thank you, see you soon');
assert.equal(sendCalls.length,memberBase+2,'Switching back sends to the member again');assert.equal(zoeQuestions.length,zoeBase+2);
// Closing the conversation leaves Zoe mode: reopening the same member replies to the member.
await act(async()=>switchButton().props.onClick());
await act(async()=>screen!.root.findByProps({'aria-label':'Close conversation'}).props.onClick());
assert.equal(screen!.root.findAll(node=>node.props['data-zoe-switch']!==undefined).length,0,'No switch without an open conversation');
await act(async()=>screen.unmount());
console.log('Nurse Zoe switch: member by default, explicit switch to Zoe, drafts cleared both ways, Zoe words never reach the member (mounted component, mocked IO).');

// A member conversation that is still loading cannot be switched to Zoe, and one that fails to load leaves no Zoe draft behind
// that could fall back to a member asked about earlier (review NZ-03). Unavailable and thrown reads both close it.
for(const failure of ['unavailable','throws'] as const){
 workspace={...base};sendMode='';searchFails=false;
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 zoeFind={kind:'member',memberId:member.id,memberName:member.name};
 await send('What is Ani Example pressure?');zoeFind={kind:'keep'};
 await send('Ani');
 const questionsBeforeLoad:number=zoeQuestions.length;
 let settle!:()=>void;
 readOverride=()=>new Promise((resolve,reject)=>{settle=()=>failure==='throws'?reject(Error('Conversation unreadable')):resolve({ok:false,code:'unavailable'});});
 await act(async()=>{screen!.root.findAllByType('button').filter(b=>b.findAll(node=>node.props['data-member-identity']===member.id).length>0).at(-1)!.props.onClick();});
 const loadingSwitch=screen!.root.findAll(node=>node.type==='button'&&node.props['data-zoe-switch']!==undefined)[0];
 if(loadingSwitch){
  assert.equal(loadingSwitch.props.disabled,true,`The switch to Zoe waits for the conversation (${failure})`);
  await act(async()=>loadingSwitch.props.onClick());
  assert.equal(screen!.root.findAll(node=>node.type==='button'&&node.props['data-zoe-switch']==='member').length,0,'Still not in Zoe mode while loading');
 }
 await act(async()=>{settle();await new Promise(done=>setTimeout(done,20));});
 readOverride=null;
 if(screen!.root.findAll(node=>node.props['data-zoe-switch']!==undefined).length===0){
  await send('What is her latest blood pressure?');
  assert.equal(zoeQuestions.length,questionsBeforeLoad,'A failed chart read clears its ask target; it cannot reuse the earlier member');
 }
 await act(async()=>screen.unmount());
}
console.log('Nurse Zoe switch waits for a loaded conversation; a failed load leaves no Zoe draft for another member (mounted component, mocked IO).');

// Plain words open the same work as the buttons and search by the name inside them; questions stay with Zoe.
workspace={...base};sendMode='';searchFails=false;listStatus='ready';
await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
{
 const todayBase:number=todayCalls,searchBase2:number=searchCalls,askBase:number=zoeQuestions.length;
 await send('What do I have today?');assert.equal(todayCalls,todayBase+1,'Plain words open Today');assert.equal(zoeQuestions.length,askBase,'and are not a Zoe question');
 await send('что срочное с утра?');assert.equal(todayCalls,todayBase+2,'Russian plain words open Today');
 await send('Բարի լույս։ Այսօր ի՞նչ ունեմ');assert.equal(todayCalls,todayBase+3,'Armenian plain words open Today');
 await send('Who needs me first?');assert.equal(todayCalls,todayBase+4,'Who needs me first opens Today');assert.equal(zoeQuestions.length,askBase,'and is not a Zoe question');
 await send('find ani');assert.equal(searchCalls,searchBase2+1,'"find ani" searches for ani');assert.equal(zoeQuestions.length,askBase);
 await send('открой пациента с телефоном на 1234');assert.equal(searchCalls,searchBase2+2,'a phone tail is searched');assert.equal(zoeQuestions.length,askBase);
 const visitsBefore=screen!.root.findAll(node=>node.props['data-visit-list']).length;
 await send('какие визиты сегодня и кто опаздывает');assert.ok(screen!.root.findAll(node=>node.props['data-visit-list']).length>visitsBefore,'Plain words open the visit list');assert.equal(zoeQuestions.length,askBase);
 zoeFind={kind:'keep'};
 await send('who hasnt logged bp this week');assert.equal(todayCalls,todayBase+4,'A cohort question is no Today command');
}
await act(async()=>screen.unmount());
console.log('Nurse plain words open Today, visits and a member search like the buttons do; other questions go to Zoe (mounted component, mocked IO).');

// "Who has not logged BP this week": the nurse's own cohort, read-only, also in Zoe mode; a failed read says so.
{
 const rowsFor=(m:typeof member)=>({id:m.id,name:m.name,birthDate:m.birthDate,birthYear:m.birthYear,phoneLast4:m.phoneLast4,shortId:null,revision:0,doctorId:null,nurseId:null,createdAt:'2026-01-01T00:00:00Z',bookingCounts:{requested:0,providerProposed:0,confirmed:0,changePending:0}});
 missingBpResult={kind:'missing-bp',rows:[rowsFor(member)],from:'2026-11-02',to:'2026-11-04',unknown:1,checked:5,truncated:true};
 workspace={...base};sendMode='';searchFails=false;
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 const askBase:number=zoeQuestions.length,callsBase:number=missingBpCalls;
 await send('who hasnt logged bp this week');
 assert.equal(missingBpCalls,callsBase+1,'Plain words read the cohort');assert.equal(zoeQuestions.length,askBase,'and are not a Zoe question');
 assert.match(text(),/No blood pressure reading since/);assert.match(text(),/Ani Example/);assert.match(text(),/1 could not be read, so they are not listed/);assert.match(text(),/Only the first 5 members were checked/);
 missingBpResult={kind:'missing-bp',rows:[],from:'2026-11-02',to:'2026-11-04',unknown:0,checked:3,truncated:false};await send('Кто не записал давление на этой неделе?');
 assert.match(text(),/Every member you checked has a blood pressure reading/);
 missingBpResult={kind:'unavailable'};await send('members without blood pressure this week');assert.match(text(),/This list is unavailable here/,'An unavailable read says so');
 await send('Ani');
 await act(async()=>{screen!.root.findAllByType('button').filter(b=>b.findAll(node=>node.props['data-member-identity']===member.id).length>0).at(-1)!.props.onClick();});
 await act(async()=>screen!.root.findAll(node=>node.type==='button'&&node.props['data-zoe-switch']==='zoe')[0].props.onClick());
 const inZoe:number=missingBpCalls;await send('who hasnt logged bp this week');
 assert.equal(missingBpCalls,inZoe+1,'In Zoe mode the cohort question reads the list');assert.equal(zoeQuestions.length,askBase);
 // "Who needs me first" is about the nurse's day, so it opens Today in Zoe mode too and never reaches Zoe about the open member.
 {
  const todayInZoe:number=todayCalls;await send('who needs me first');
  assert.equal(todayCalls,todayInZoe+1,'In Zoe mode who-needs-me-first opens Today');assert.equal(zoeQuestions.length,askBase);
  await send('кто меня ждёт');assert.equal(todayCalls,todayInZoe+2);assert.equal(zoeQuestions.length,askBase);
  await send('today');assert.equal(todayCalls,todayInZoe+2,'Plain today stays a question about the open member in Zoe mode');
 }
 await act(async()=>screen.unmount());
}
console.log('Nurse cohort question: the missing-BP list, the unknown count, the page limit and an unavailable read (mounted component, mocked IO).');
// "What did the doctor say": the handoff list across the nurse's members, with where each stands; read-only, also in Zoe mode.
{
 const sentAt='2026-11-07T13:00:00Z';
 const item={taskId:member.id,member,sentAt,topic:'member-request' as const,observation:'Fictional nurse observation',status:'awaiting-doctor' as const,resolution:null};
 overviewPage={items:[item,{...item,taskId:'33333333-3333-4333-8333-333333333332',status:'completed',resolution:{by:'Dr Hovsep',at:sentAt,note:'Switch to a different tablet, I will call her'}}],hasMore:false};
 workspace={...base};sendMode='';searchFails=false;
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 const askBase:number=zoeQuestions.length,sendBase:number=sendCalls.length,callsBase:number=overviewCalls;
 await send('any answers from the doctor?');
 assert.equal(overviewCalls,callsBase+1,'Plain words read the handoff list');assert.equal(zoeQuestions.length,askBase);
 assert.match(text(),/Sent to the doctor/);assert.match(text(),/Awaiting doctor/);assert.match(text(),/Completed/);assert.match(text(),/Dr Hovsep/);assert.match(text(),/Switch to a different tablet, I will call her/,'The doctor\'s words are shown, with the doctor\'s name beside them');
 assert.doesNotMatch(text(),/seen/i,'No claim of "seen"');
 overviewPage=null;await send('handoffs');assert.match(text(),/Handoffs are unavailable/,'A failed read says so');
 overviewPage={items:[],hasMore:false};await send('handoffs');assert.match(text(),/not handed anything over/);
 await send('Ani');
 await act(async()=>{screen!.root.findAllByType('button').filter(b=>b.findAll(node=>node.props['data-member-identity']===member.id).length>0).at(-1)!.props.onClick();});
 await act(async()=>screen!.root.findAll(node=>node.type==='button'&&node.props['data-zoe-switch']==='zoe')[0].props.onClick());
 const callsInZoe:number=overviewCalls;await send('what did the doctor say about my handoff for Ani');
 assert.equal(overviewCalls,callsInZoe+1,'In Zoe mode the read-only handoff question is answered from the list');assert.equal(zoeQuestions.length,askBase,'and is not a Zoe question');assert.equal(sendCalls.length,sendBase);
 await act(async()=>screen.unmount());
}
console.log('Nurse handoff answers: the list shows sent and answered with the doctor\'s attributed words, never a seen claim (mounted component, mocked IO).');

// A request only the doctor may carry out gets the fixed line, in no-member mode and in Zoe mode; in reply mode words stay a message.
workspace={...base};sendMode='';searchFails=false;
await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
{
 const askBase:number=zoeQuestions.length,sendBase:number=sendCalls.length,searchBase3:number=searchCalls;
 await send('Prescribe something for her headache');assert.match(text(),/I can’t prescribe, change a dose, diagnose or delete a record/);assert.equal(zoeQuestions.length,askBase,'Not a Zoe question');assert.equal(searchCalls,searchBase3,'Not a name search');assert.equal(sendCalls.length,sendBase);
 await send('Удали вчерашнее давление совсем чтоб врач не видел');assert.equal((text().match(/I can’t prescribe, change a dose/g)??[]).length,2,'A Russian request gets the line too (shown in the screen language)');assert.equal(zoeQuestions.length,askBase);
 await send('Ani');
 await act(async()=>{screen!.root.findAllByType('button').filter(b=>b.findAll(node=>node.props['data-member-identity']===member.id).length>0).at(-1)!.props.onClick();});
 await act(async()=>screen!.root.findAll(node=>node.type==='button'&&node.props['data-zoe-switch']==='zoe')[0].props.onClick());
 await send('increase her amlodipine to 10 mg');assert.equal(zoeQuestions.length,askBase,'Zoe mode: not a Zoe question');assert.equal(sendCalls.length,sendBase,'and never a message to the member');
 await act(async()=>screen!.root.findAll(node=>node.type==='button'&&node.props['data-zoe-switch']==='member')[0].props.onClick());
 await send('please increase the dose, she says she needs it');assert.equal(sendCalls.length,sendBase+1,'In reply mode the nurse\'s own words are the message');
}
await act(async()=>screen.unmount());
console.log('Nurse out-of-role requests get the fixed line and reach neither Zoe nor a member (mounted component, mocked IO).');

// A typed reading becomes a card; only Save writes it, as a measurement mark in the member's open nurse visit.
{
 const data=seededVisit();
 const listFor=(visits:unknown[])=>async()=>({status:'ready',data:{version:'nurse-visit-v1',enabled:true,today:'2026-11-01',role:'nurse',visits}});
 const v2=modules['@/lib/nurse-chat/v2-actions'] as Record<string,unknown>;
 visitData=data;visitMode='';visitReadFails=false;visitReadOverride=null;visitClock=0;visitCommands.length=0;
 v2.readNurseChatVisits=listFor([{...data.visit,steps:[],samplesPlanned:1,samplesTaken:0,openItems:4,nurseName:null}]);
 workspace={...base};sendMode='';searchFails=false;
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 const askBase:number=zoeQuestions.length,sendBase:number=sendCalls.length;
 await send('Ani');
 await act(async()=>{screen!.root.findAllByType('button').filter(b=>b.findAll(node=>node.props['data-member-identity']===member.id).length>0).at(-1)!.props.onClick();});
 await act(async()=>screen!.root.findAll(node=>node.type==='button'&&node.props['data-zoe-switch']==='zoe')[0].props.onClick());
 await send('bp 148/93 pulse 72');
 assert.match(text(),/Record for Ani Example/);assert.match(text(),/148\/93 mmHg/);assert.match(text(),/Nothing is saved until you press Save/);
 assert.equal(visitCommands.length,0,'A typed reading writes nothing');assert.equal(zoeQuestions.length,askBase,'and is not a Zoe question');assert.equal(sendCalls.length,sendBase,'and never a message to the member');
 await press('Save');
 assert.equal(visitCommands.length,1);const mark=visitCommands[0]!.command as NurseVisitMarkCommand;
 assert.deepEqual([visitCommands[0]!.kind,mark.item,mark.done,mark.note],['mark','measure:bp',true,null]);assert.deepEqual(mark.values,{systolic:148,diastolic:93,pulse:72});assert.equal(mark.sourceId,visitId);
 assert.match(text(),/Saved to the visit/);
 await press('Save').catch(()=>undefined);assert.equal(visitCommands.length,1,'A saved card is not saved twice');
 // The same item is now recorded: a second reading says so and writes nothing.
 await send('bp 120/80');assert.match(text(),/already recorded for this visit/);assert.equal(visitCommands.length,1);
 // Cancel writes nothing.
 await send('weight 82');assert.match(text(),/Weight/);assert.match(text(),/82 kg/);await press('Cancel');assert.match(text(),/Not saved/);assert.equal(visitCommands.length,1);
 // Out of range is an error line, not a card.
 await send('bp 93/148');assert.equal(visitCommands.length,1);
 // A question with numbers stays with Zoe.
 zoeFind={kind:'keep'};const q:number=zoeQuestions.length;await send('is 138/88 ok for a 62 year old?');assert.equal(zoeQuestions.length,q+1);assert.equal(visitCommands.length,1);
 // No open visit: the card says so and offers the visit list; nothing can be saved.
 v2.readNurseChatVisits=listFor([]);await send('waist 98');assert.match(text(),/No visit is open for Ani Example/);assert.equal(visitCommands.length,1);
 await act(async()=>screen.unmount());
}
console.log('Nurse typed readings: a card first, Save writes one visit measurement mark, recorded or missing visits write nothing, questions stay with Zoe (mounted component, mocked IO).');

// Review round: names are whole words, cards belong to their conversation, a lost answer cannot be cancelled, a very high reading carries the warning.
{
 const data=seededVisit();
 const v2=modules['@/lib/nurse-chat/v2-actions'] as Record<string,unknown>;
 v2.readNurseChatVisits=async()=>({status:'ready',data:{version:'nurse-visit-v1',enabled:true,today:'2026-11-01',role:'nurse',visits:[{...data.visit,steps:[],samplesPlanned:1,samplesTaken:0,openItems:4,nurseName:null}]}});
 visitData=data;visitMode='';visitReadFails=false;visitReadOverride=null;visitClock=0;visitCommands.length=0;
 workspace={...base};sendMode='';searchFails=false;
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 const open=async()=>{await send('Ani');await act(async()=>{screen!.root.findAllByType('button').filter(b=>b.findAll(node=>node.props['data-member-identity']===member.id).length>0).at(-1)!.props.onClick();});await act(async()=>screen!.root.findAll(node=>node.type==='button'&&node.props['data-zoe-switch']==='zoe')[0].props.onClick());};
 const hasButton=(label:string)=>screen!.root.findAllByType('button').some(b=>b.children.filter(child=>typeof child==='string').join('')===label);
 await open();
 // A partial name is not the open member: no card is prepared.
 await send('bp 148/93 for An');assert.match(text(),/Which member do you mean/);assert.equal(screen!.root.findAll(n=>n.props['data-nurse-measure']!==undefined).length,0,'A partial name prepares no card');
 // A very high reading carries the same warning as the visit forms.
 await send('bp 220/130');assert.equal(screen!.root.findAll(n=>n.props['data-bp-high-warning']!==undefined).length,1,'The very high warning is shown on the card');assert.equal(visitCommands.length,0);
 // Closing the conversation makes the card no longer current; nothing can be saved from it.
 await act(async()=>screen!.root.findByProps({'aria-label':'Close conversation'}).props.onClick());
 assert.match(text(),/no longer current/);assert.equal(hasButton('Save'),false);assert.equal(visitCommands.length,0);
 // A lost answer: no Cancel, "Check or retry" resends the same submission, and the saved card is not saved again.
 await open();visitMode='unknown-unsaved';
 await send('bp 130/85');assert.equal(hasButton('Cancel'),true,'A fresh card can be cancelled');
 await press('Save');assert.equal(visitCommands.length,1);assert.equal(hasButton('Cancel'),false,'After a lost answer Cancel is not offered');assert.equal(hasButton('Check or retry'),true);assert.match(text(),/not confirmed/);
 visitMode='';await press('Check or retry');
 assert.equal(visitCommands.length,2);assert.equal((visitCommands[1]!.command as NurseVisitMarkCommand).submissionId,(visitCommands[0]!.command as NurseVisitMarkCommand).submissionId,'The retry reuses the submission id');
 assert.match(text(),/Saved to the visit/);
 // Two cards for the same item: the second finds the first one's mark and writes nothing.
 visitData=seededVisit();visitCommands.length=0;
 await send('bp 120/80');await send('bp 125/82');
 const saves=screen!.root.findAllByType('button').filter(b=>b.children.filter(child=>typeof child==='string').join('')==='Save');assert.equal(saves.length,2);
 await act(async()=>saves[0]!.props.onClick());assert.equal(visitCommands.length,1);
 await act(async()=>saves[1]!.props.onClick());assert.equal(visitCommands.length,1,'A stale second card never replaces the first reading');assert.match(text(),/already recorded for this visit/);
 await act(async()=>screen.unmount());
}
console.log('Nurse typed readings, review round: whole-word names, expiry with the conversation, lost answer cannot be cancelled, very high warning, stale second card (mounted component, mocked IO).');

// "Who did not take their medicines": the nurse's adherence facts, read-only, also in Zoe mode; counts kept apart; unknown and page limit said.
{
 const m={id:member.id,name:member.name,birthDate:member.birthDate,birthYear:member.birthYear,phoneLast4:member.phoneLast4,shortId:null,revision:0,doctorId:null,nurseId:null,createdAt:'2026-01-01T00:00:00Z',bookingCounts:{requested:0,providerProposed:0,confirmed:0,changePending:0}};
 adherenceResult={kind:'adherence',rows:[{member:m,medicines:[{name:'Atorvastatin',dose:'20 mg',source:'plan',expected:7,taken:3,skipped:1,noReport:3}]}],from:'2026-10-29',to:'2026-11-04',days:7,checked:5,unknown:1,truncated:true};
 workspace={...base};sendMode='';searchFails=false;
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 const askBase:number=zoeQuestions.length,callsBase:number=adherenceCalls;
 await send('who didn’t take their medicines this week');
 assert.equal(adherenceCalls,callsBase+1,'Plain words read the adherence facts');assert.equal(zoeQuestions.length,askBase,'and are not a Zoe question');
 assert.match(text(),/Medicine doses reported/);assert.match(text(),/Ani Example/);assert.match(text(),/Atorvastatin/);assert.match(text(),/taken 3, skipped 1, no report 3 of 7/,'Taken, skipped and no report are shown apart');
 assert.match(text(),/Skipped means the member reported it/);assert.match(text(),/1 could not be read/);assert.match(text(),/Only the first 5 members were checked/);
 assert.doesNotMatch(text(),/%|score|rank/i,'No percentage, score or ranking');
 adherenceResult={kind:'unavailable'};await send('adherence');assert.match(text(),/This list is unavailable here/);
 await send('Ani');
 await act(async()=>{screen!.root.findAllByType('button').filter(b=>b.findAll(node=>node.props['data-member-identity']===member.id).length>0).at(-1)!.props.onClick();});
 await act(async()=>screen!.root.findAll(node=>node.type==='button'&&node.props['data-zoe-switch']==='zoe')[0].props.onClick());
 const inZoe:number=adherenceCalls;await send('adherence');assert.equal(adherenceCalls,inZoe+1,'In Zoe mode the read-only list answers');assert.equal(zoeQuestions.length,askBase);
 await act(async()=>screen.unmount());
}
console.log('Nurse adherence facts: counts kept apart with a plain note, unknown and page limit said, no score (mounted component, mocked IO).');

// iOS autocorrect turned "bp" into "no" in the real simulator: the composer must not autocorrect or spell-check what the nurse types.
await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
{const composer=screen!.root.findByType('textarea').props;assert.equal(composer.autoCorrect,'off','The composer does not autocorrect');assert.equal(composer.spellCheck,false,'or spell-check');}
await act(async()=>screen.unmount());
console.log('Nurse composer: autocorrect and spell check are off (mounted component).');

// Words for button actions open the same flow the button opens; the confirm step is the button's, nothing is saved by the words.
{
 const v2=modules['@/lib/nurse-chat/v2-actions'] as Record<string,unknown>;
 // Mark task done with a note: the note composer opens with the note prefilled; only her send saves.
 workspace=base;transportFails=false;taskCalls.length=0;taskToday([dueTask]);
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 const askBase:number=zoeQuestions.length,sendBase:number=sendCalls.length;
 await send('mark the task done, note: called, no answer');
 assert.equal(taskCalls.length,0,'The words alone save nothing');assert.equal(zoeQuestions.length,askBase);assert.equal(sendCalls.length,sendBase);
 assert.equal(screen!.root.findAll(n=>n.props['aria-label']==='Close task note').length,1,'The task note composer is open, as after Mark done');
 assert.equal(screen!.root.findByType('textarea').props.value,'called, no answer','The note is prefilled');
 await send('called, no answer');assert.equal(taskCalls.length,1);assert.equal(taskCalls[0]!.operation,'complete');
 await act(async()=>screen.unmount());
 // Several tasks and no "first": the Today list shows, she taps the one she means.
 taskCalls.length=0;taskToday([dueTask,{...dueTask,id:'second',title:'Second task'}]);
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 await send('mark the task done');assert.equal(taskCalls.length,0);assert.equal(screen!.root.findAll(n=>n.props['aria-label']==='Close task note').length,0,'Ambiguous: no flow opens');assert.ok(screen!.root.findAll(n=>n.props['data-today-reply']!==undefined).length>=1,'The Today list is shown');
 await send('mark the first task done');assert.equal(screen!.root.findAll(n=>n.props['aria-label']==='Close task note').length,1,'"first" picks the first task');
 await act(async()=>screen.unmount());
 // Start visit: the visit flow opens for the one visit that fits; two visits show the list.
 const data=seededVisit();visitData=data;visitMode='';visitReadFails=false;visitReadOverride=null;visitClock=0;visitCommands.length=0;
 const row=(id:string,name:string)=>({...data.visit,id,memberName:name,steps:[],samplesPlanned:1,samplesTaken:0,openItems:4,nurseName:null});
 v2.readNurseChatVisits=async()=>({status:'ready',data:{version:'nurse-visit-v1',enabled:true,today:'2026-11-01',role:'nurse',visits:[row(visitId,member.name!)]}});
 taskToday([]);
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 await send('start visit for ani');assert.equal(visitCommands.length,0,'Opening a visit writes nothing');assert.equal(screen!.root.findAll(n=>n.props['aria-label']==='Close visit').length,1,'The visit flow is open, as after Open visit');
 await act(async()=>screen.unmount());
 v2.readNurseChatVisits=async()=>({status:'ready',data:{version:'nurse-visit-v1',enabled:true,today:'2026-11-01',role:'nurse',visits:[row(visitId,member.name!),row('aa440000-0000-4000-8000-000000000002','Other Example')]}});
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 await send('start visit');assert.equal(screen!.root.findAll(n=>n.props['aria-label']==='Close visit').length,0,'Two visits: no visit opens by itself');assert.equal(screen!.root.findAll(n=>n.props['data-visit-list']).length,1,'The visit list is shown');
 await act(async()=>screen.unmount());
}
console.log('Nurse action words: mark task done (note prefilled, saved only by her send) and start visit open the button flows (mounted component, mocked IO).');

// Care note and hand-over words (Zoe mode, member open): the same composers as the buttons, text prefilled, saved only by her send.
{
 notesMode='';notesReadMode='';notesRevision=1;careNotes=[];noteCalls.length=0;handoffCalls.length=0;handoffPage={items:[],hasMore:false};handoffMode='';
 workspace={...base,items:[sourceItem]};sendMode='';searchFails=false;
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 const sendBase:number=sendCalls.length,askBase:number=zoeQuestions.length;
 await send('Ani');
 await act(async()=>{screen!.root.findAllByType('button').filter(b=>b.findAll(node=>node.props['data-member-identity']===member.id).length>0).at(-1)!.props.onClick();});
 await act(async()=>screen!.root.findAll(node=>node.type==='button'&&node.props['data-zoe-switch']==='zoe')[0].props.onClick());
 await send('add a care note: prefers evening calls');
 assert.equal(noteCalls.length,0,'The words alone save no note');assert.equal(zoeQuestions.length,askBase);assert.equal(sendCalls.length,sendBase);
 assert.equal(screen!.root.findAll(n=>n.props['aria-label']==='Close care note').length,1,'The care note composer is open, as after Add a note');
 assert.equal(screen!.root.findByType('textarea').props.value,'prefers evening calls','The note is prefilled');
 await send('prefers evening calls');assert.equal(noteCalls.length,1);assert.equal((noteCalls[0] as {note:string}).note,'prefers evening calls');assert.equal(sendCalls.length,sendBase,'A care note never reaches the member');
 // Hand over: the flow starts on the latest member message with the topic chips; nothing is created until she sends.
 await act(async()=>screen!.root.findAll(node=>node.type==='button'&&node.props['data-zoe-switch']==='zoe')[0]?.props.onClick());
 await send('hand over to the doctor: BP high two days');
 assert.equal(handoffCalls.length,0,'The words alone hand nothing over');assert.equal(sendCalls.length,sendBase);
 assert.ok(screen!.root.findAllByType('button').some(b=>b.children.includes('Blood pressure')),'The topic chips are shown, as after Hand over');
 assert.equal(screen!.root.findByType('textarea').props.value,'BP high two days','The observation is prefilled');
 await act(async()=>screen.unmount());
}
console.log('Nurse member action words: add a care note and hand over to the doctor open the button composers with the text prefilled (mounted component, mocked IO).');

// "Draft a handoff for the doctor": the summary lands in the hand-over composer for her to edit; nothing is handed over or sent by the words.
{
 const facts={asOf:'2026-11-04T05:30:00Z',bp:[{systolic:150,diastolic:95,pulse:78,measuredAt:'2026-11-03T04:10:00Z',source:'manual'}],tasks:[],medicines:[],medicinesFrom:'2026-10-29',medicinesTo:'2026-11-04'};
 handoffFactsResult=facts;handoffCalls.length=0;handoffPage={items:[],hasMore:false};handoffMode='';
 workspace={...base,items:[sourceItem]};sendMode='';searchFails=false;
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 const sendBase:number=sendCalls.length,askBase:number=zoeQuestions.length;
 await send('Ani');
 await act(async()=>{screen!.root.findAllByType('button').filter(b=>b.findAll(node=>node.props['data-member-identity']===member.id).length>0).at(-1)!.props.onClick();});
 await act(async()=>screen!.root.findAll(node=>node.type==='button'&&node.props['data-zoe-switch']==='zoe')[0].props.onClick());
 const callsBase:number=handoffFactsCalls;
 await send('draft a handoff for the doctor');
 assert.equal(handoffFactsCalls,callsBase+1,'The record is read for the summary');assert.equal(handoffCalls.length,0,'The words alone hand nothing over');assert.equal(sendCalls.length,sendBase,'and send nothing to the member');assert.equal(zoeQuestions.length,askBase);
 assert.ok(screen!.root.findAllByType('button').some(b=>b.children.includes('Blood pressure')),'The topic chips are shown, as after Hand over');
 const draft=String(screen!.root.findByType('textarea').props.value);
 assert.ok(draft.startsWith(identityModel.chatMemberIdentityLine(member,'en')),'The draft opens with the member');assert.match(draft,/150\/95/);assert.match(draft,/Selected source/,'The member\'s latest words are quoted');assert.ok(draft.endsWith('Nurse observation: '),'Room for her own words');
 await act(async()=>screen.unmount());
 // The only member message is already handed over: the summary is shown as a card, not lost, and no flow starts.
 handoffPage={items:[savedTask({memberId:member.id,requestId:'33333333-3333-4333-8333-333333333399',messageId:'source',expectedVersion:1,topic:'blood-pressure',observation:'o'})],hasMore:false};
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 await send('Ani');
 await act(async()=>{screen!.root.findAllByType('button').filter(b=>b.findAll(node=>node.props['data-member-identity']===member.id).length>0).at(-1)!.props.onClick();});
 await act(async()=>screen!.root.findAll(node=>node.type==='button'&&node.props['data-zoe-switch']==='zoe')[0].props.onClick());
 await send('draft a handoff for the doctor');assert.match(text(),/no member message left to hand over/);assert.match(text(),/Nurse observation:/);assert.equal(handoffCalls.length,0);
 // A failed read says so and prepares nothing.
 handoffFactsResult=null;await send('draft a handoff for the doctor');assert.match(text(),/could not be read, so no summary was prepared/);
 await act(async()=>screen.unmount());
}
console.log('Nurse hand-over draft: the summary lands in the hand-over composer, shown as a card when no message is left, a failed read says so; nothing is handed over by the words (mounted component, mocked IO).');

// The actual nurse history renderer distinguishes a clinic-approved system transfer.
const {NurseTaskDetails}=modules['./task-list'] as typeof import('@/components/nurse-chat-v2/task-list');
for(const locale of ['en','hy','ru'] as const){
 const events:CoordinationSnapshot['events']=(['system','doctor','nurse','admin'] as const).map((role,index)=>({
  id:index+1,revision:index+1,request_id:crypto.randomUUID(),actor_id:dueTask.ownerId,
  actor_name:role==='system'?'Fictional admin B':`Fictional ${role}`,actor_role:role,
  operation:'reassign',old_status:'open',new_status:'open',old_owner_id:dueTask.ownerId,new_owner_id:dueTask.ownerId,
  note:'Care team changed. Was: Fictional nurse.',care_note_id:null,
  detail:{input:{ownerId:dueTask.ownerId},before:null,via:'clinic_admin',system:true},created_at:dueTask.updatedAt,
 }));
 const html=renderToStaticMarkup(React.createElement(NurseTaskDetails,{snapshot:{...dueTask,events},locale,disabled:false,onDetails(){},onOperation(){}}));
 assert.ok(html.includes({en:'Care team change, approved by Fictional admin B',hy:'Խնամքի թիմի փոփոխություն, հաստատել է Fictional admin B',ru:'Изменение команды заботы, одобрено: Fictional admin B'}[locale]),`Nurse history system attribution in ${locale}`);
 for(const [role,label] of Object.entries({doctor:{en:'Doctor',hy:'Բժիշկ',ru:'Врач'},nurse:{en:'Nurse',hy:'Բուժքույր',ru:'Медсестра'},admin:{en:'Administrator',hy:'Ադմինիստրատոր',ru:'Администратор'}})){
  assert.ok(html.includes(`Fictional ${role} · ${label[locale]} · `),`Nurse history preserves ${role} attribution in ${locale}`);
 }
}
console.log('Nurse task history: system approval names the clinic admin in en/hy/ru; doctor, nurse and platform admin labels remain unchanged.');


// Armen P1: the open conversation, never an earlier ask/history target, binds each turn.
{
 handoffPage={items:[],hasMore:false};handoffMode='';
 const zoeIo=modules['@/lib/nurse-chat/v2-zoe-actions'] as Record<string,unknown>,oldZoe={...zoeIo};
 const memberIo=modules['@/lib/nurse-chat/v2-actions'] as Record<string,unknown>,oldMembers={...memberIo};
 const other={...member,id:'aa110000-0000-4000-8000-000000000002',name:'Gor Example'};
 let chosen=member;
 Object.assign(memberIo,{searchNurseChatMembers:async()=>({ok:true,page:{rows:[chosen],hasMore:false,nextCursor:null}})});
 Object.assign(zoeIo,{readNurseChatZoeHistory:async()=>({kind:'history',turns:[],conversations:[],target:{conversationId:other.id,memberId:other.id,memberName:other.name}}),findNurseChatQuestionMember:async()=>zoeFind,openNurseChatZoe:async(id:string)=>({ok:true,conversationId:id})});
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 const open=async(row:typeof member)=>{
  chosen=row;workspace={...base,memberId:row.id,memberName:row.name,items:[sourceItem]};
  await send(row.name);
  await act(async()=>screen.root.findAllByType('button').findLast(b=>b.findAll(node=>node.props['data-member-identity']===row.id).length>0)!.props.onClick());
  await act(async()=>screen.root.findAll(node=>node.type==='button'&&node.props['data-zoe-switch']==='zoe')[0].props.onClick());
 };
 const close=()=>act(async()=>screen.root.findByProps({'aria-label':'Close conversation'}).props.onClick());
 for(const row of [member,other,member]){
  await open(row);zoeFind={kind:'keep'};await send('What changed since yesterday?');
  assert.equal((zoeQuestions.at(-1) as {conversationId:string}).conversationId,row.id,'The request belongs to the open member, including after history loads');
  await close();
 }
 await open(member);
 await send('hand over to the doctor: BP high two days');
 await act(async()=>screen.root.findByProps({'aria-label':handoffCopy.nurseHandoffCopy('en').close}).props.onClick());
 await act(async()=>screen.root.findAll(node=>node.type==='button'&&node.props['data-zoe-switch']==='zoe')[0].props.onClick());
 zoeFind={kind:'keep'};const afterHandoff=zoeQuestions.length;await send('What changed since yesterday?');
 assert.equal(zoeQuestions.length,afterHandoff+1,'Cancelling a handoff keeps the open chart as the ask target');
 assert.equal((zoeQuestions.at(-1) as {conversationId:string}).conversationId,member.id);
 bindingHold=true;await send('What does the record show now?');
 const signal=bindingSignals.at(-1);await close();
 assert.equal(signal?.aborted,true,'Closing A aborts its pending stream');
 bindingHold=false;await open(other);
 // An old server can still finish after cancellation. Its output must never reappear.
 try{const oldStream=bindingStream as ReadableStreamDefaultController<Uint8Array>|null;oldStream?.enqueue(new TextEncoder().encode(JSON.stringify({type:'answer',content:{version:'staff-zoe-1',state:'answered',say:[],quotes:[],notKnown:[],declined:false,notice:'OLD A ANSWER',cards:[]}})+'\n'));oldStream?.close();}catch{}
 await act(async()=>{});assert.doesNotMatch(text(),/OLD A ANSWER/);
 zoeFind={kind:'member',memberId:member.id,memberName:member.name};const before=zoeQuestions.length;
 await send('What is Ani Example pressure?');assert.equal(zoeQuestions.length,before,'Naming A while B is open requires a member switch');
 assert.match(text(),/Asking Zoe about Mariam Example/,'The bar continues to name the open member using its loaded identity');
 await act(async()=>screen.unmount());Object.assign(zoeIo,oldZoe);Object.assign(memberIo,oldMembers);
}
console.log('Armen P1 binding: nurse A/B/A, saved history cannot replace chart, pending close/switch and different-name refusal passed (mounted component, mocked IO).');

// The canonical URL opens the real Today flow without a typed command, including on a mounted chat.
{
 const todayIo=modules['@/lib/nurse-chat/today-actions'] as {readNurseToday:()=>Promise<unknown>},previousRead=todayIo.readNurseToday;
 let finish!: (value:unknown)=>void,reads=0;
 todayIo.readNurseToday=()=>{reads++;return new Promise(resolve=>{finish=resolve;});};
 location.hash='#other';
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 assert.equal(reads,0);assert.match(text(),/Hello\. Start with today/);assert.equal(location.hash,'#other');
 await act(async()=>screen.unmount());
 location.hash='#today';const state=history.state;
 await act(async()=>{screen=create(React.createElement(React.StrictMode,null,React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id})));});
 assert.equal(reads,1,'Strict Mode consumes the fragment exactly once');
 assert.equal(location.hash,'');assert.equal(history.state,state,'Clearing the fragment preserves Next history state');
 assert.match(text(),/Loading your work/);assert.doesNotMatch(text(),/Hello\. Start with today/,'No landing greeting while Today loads');
 await act(async()=>{finish({ok:true,identities:[],asOf:'2026-11-06T09:00:00Z',page:{tasks:[],nextCursor:null},visits:{enabled:true,visits:[]}});});
 assert.match(text(),/No open work/);
 await act(async()=>{browser.dispatchEvent(new Event('hashchange'));});assert.equal(reads,1);
 location.hash='#other';await act(async()=>{browser.dispatchEvent(new Event('hashchange'));});
 assert.equal(reads,1);assert.equal(location.hash,'#other','Unrelated fragments stay untouched');
 location.hash='#today';await act(async()=>{browser.dispatchEvent(new Event('hashchange'));});
 assert.equal(reads,2,'A fresh navigation opens Today on the mounted chat');assert.equal(location.hash,'');
 await act(async()=>{finish({ok:false,code:'unavailable'});});assert.match(text(),/work list is unavailable/);
 await act(async()=>screen.root.findByType('textarea').props.onChange({target:{value:'Unsent reply'}}));
 location.hash='#today';await act(async()=>{browser.dispatchEvent(new Event('popstate'));});
 assert.equal(reads,2,'A fragment cannot discard unsent words');assert.equal(location.hash,'#today');
 await act(async()=>screen.root.findByType('textarea').props.onChange({target:{value:''}}));
 assert.equal(reads,3,'The pending fragment opens once the composer is clear');assert.equal(location.hash,'');
 await act(async()=>{finish({ok:false,code:'unavailable'});});
 await act(async()=>screen.unmount());
 location.hash='#today';browser.dispatchEvent(new Event('hashchange'));assert.equal(reads,3,'Unmount removes the listener');location.hash='';
 todayIo.readNurseToday=previousRead;
}
console.log('Canonical nurse Today fragment: initial loading, Strict Mode single read, mounted hash navigation, unrelated fragment, unavailable/empty states and cleanup passed (mounted component, mocked browser/IO).');

// P2: Today must not expire a reading that still needs confirmation.
for(const action of ['save','cancel','close','retry','multiple'] as const){
 const data=seededVisit();
 const v2=modules['@/lib/nurse-chat/v2-actions'] as Record<string,unknown>;
 v2.readNurseChatVisits=async()=>({status:'ready',data:{version:'nurse-visit-v1',enabled:true,today:data.today,role:'nurse',visits:[{...data.visit,steps:[]} ]}});
 visitData=data;visitMode='';visitReadFails=false;visitReadOverride=null;visitClock=0;visitCommands.length=0;
 workspace={...base};sendMode='';searchFails=false;
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 await send('Ani');
 await act(async()=>screen.root.findAllByType('button').findLast(b=>b.findAll(node=>node.props['data-member-identity']===member.id).length>0)!.props.onClick());
 await act(async()=>screen.root.findByProps({'data-zoe-switch':'zoe'}).props.onClick());
 await send('bp 148/93 pulse 72');
 if(action==='multiple')await send('weight 82');
 const before:number=todayCalls;
 location.hash='#today';await act(async()=>{browser.dispatchEvent(new Event('hashchange'));});
 assert.equal(todayCalls,before,'Today waits for the BP confirmation card');
 assert.equal(location.hash,'#today');assert.equal(button('Save').props.disabled,false);
 assert.equal(screen.root.findAllByProps({'aria-label':'Close conversation'}).length,1);
 assert.doesNotMatch(text(),/no longer current/);assert.equal(visitCommands.length,0);
 if(action==='retry'){
  visitMode='unknown-unsaved';await press('Save');
  assert.equal(todayCalls,before,'An unconfirmed save still defers Today');assert.equal(location.hash,'#today');
  visitMode='';await press('Check or retry');
 }else if(action==='multiple'){
  await press('Save');assert.equal(todayCalls,before,'Saving one card still waits for another pending card');assert.equal(location.hash,'#today');
  await press('Cancel');
 }else if(action==='close')await act(async()=>screen.root.findByProps({'aria-label':'Close conversation'}).props.onClick());
 else await press(action==='save'?'Save':'Cancel');
 assert.equal(todayCalls,before+1,'Resolving the card or explicitly leaving opens the pending Today');assert.equal(location.hash,'');
 assert.equal(visitCommands.length,action==='save'||action==='multiple'?1:action==='retry'?2:0);
 if(action==='save'||action==='retry'){
  const mark=visitCommands.at(-1)!.command as NurseVisitMarkCommand;
  assert.deepEqual(mark.values,{systolic:148,diastolic:93,pulse:72});assert.match(text(),/Saved to the visit/);
 }
 await act(async()=>screen.unmount());
}

// A visit shortcut clears the composer into editable parsed fields, before any write.
for(const action of ['Confirm entry','Discard entry']){
 await mountVisit();await sendUnconfirmed('bp 148/93 pulse 72');questionIs('preview');
 assert.equal(screen.root.findByType('textarea').props.value,'');
 assert.equal(screen.root.findByProps({'aria-label':'Systolic'}).props.value,'148');
 const before:number=todayCalls;
 location.hash='#today';await act(async()=>{browser.dispatchEvent(new Event('hashchange'));});
 assert.equal(todayCalls,before,'Today waits for the visit confirmation card');assert.equal(location.hash,'#today');questionIs('preview');
 await act(async()=>screen.root.findByProps({'aria-label':'Systolic'}).props.onChange({target:{value:'149'}}));
 assert.equal(screen.root.findByProps({'aria-label':'Systolic'}).props.value,'149');assert.equal(visitCommands.length,0);
 await press(action);assert.equal(todayCalls,before,'The active visit still holds Today after resolving its preview');
 if(action==='Confirm entry')assert.deepEqual((visitCommands[0]!.command as NurseVisitMarkCommand).values,{systolic:149,diastolic:93,pulse:72});
 await act(async()=>visitClose().props.onClick());
 assert.equal(todayCalls,before+1);assert.equal(location.hash,'');assert.equal(visitCommands.length,action==='Confirm entry'?1:0);
 await act(async()=>screen.unmount());
}

// Collection reasons are local form state too; the active visit protects them.
await mountVisit();await press('I confirmed the visit with the member');await press('I have arrived');await press('Done');
await press('Sample collection');await press('Not collected');
{
 const reason=()=>screen.root.findAllByType('textarea').find(field=>field.props.maxLength===300)!;
 await act(async()=>reason().props.onChange({target:{value:'Keep this collection reason'}}));
 const before:number=todayCalls;
 location.hash='#today';await act(async()=>{browser.dispatchEvent(new Event('hashchange'));});
 assert.equal(todayCalls,before);assert.equal(location.hash,'#today');assert.equal(reason().props.value,'Keep this collection reason');
 await act(async()=>visitClose().props.onClick());assert.equal(todayCalls,before+1);assert.equal(location.hash,'');
}
await act(async()=>screen.unmount());
console.log('Canonical nurse Today pending input: BP Save/Cancel/explicit close/uncertain retry, editable visit shortcut Save/Discard, and sample collection draft passed (mounted component, mocked browser/IO).');

// P1 staff task details, the work turn and active composer all hide stored registry codes.
{
 const codedTask={...dueTask,title:'RF-03 bp_crisis_reading',instructions:'RF-01 chest_pain_mixed'};
 taskToday([codedTask]);taskSnapshot={...codedTask,events:[]};taskReadMode='';taskMode='';
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Narine',nurseId:member.id}));});
 await send('today');
 await act(async()=>screen.root.findByProps({'data-task-card':codedTask.id}).findAllByType('button')[0].props.onClick());
 assert.doesNotMatch(text(),/RF-\d|bp_crisis_reading|chest_pain_mixed/,'Task detail and its work turn use existing plain steps');
 await press('Mark done');
 assert.doesNotMatch(text(),/RF-\d|bp_crisis_reading|chest_pain_mixed/,'The active task composer uses the same plain step');
 await act(async()=>screen.unmount());
}

// Regression pack P0-03: provenance belongs to typed member BP, never another speaker's device reading.
{
 const {NurseConversation}=modules['./conversation'] as typeof import('@/components/nurse-chat-v2/conversation');
 for(const locale of ['en','hy','ru'] as const){
  const items=[
   {...sourceItem,id:'typed-bp',text:'My blood pressure was 150/95 this morning'},
   {...sourceItem,id:'typed-bp-hy',text:'Ճնշումս՝ 142/88 pulse 76'},
   {...sourceItem,id:'typed-bp-ru',text:'Давление 150 на 95'},
   {...sourceItem,id:'typed-bp-prefixed',text:'BP 148/93'},
   {...sourceItem,id:'appointment-date',text:'Appointment on 12/05'},
   {...sourceItem,id:'visit-date',text:'Visit 15/06 at 10:00'},
   {...sourceItem,id:'tablet-fraction',text:'3/4 of a tablet'},
   {...sourceItem,id:'ordinary',text:'What can I have for breakfast?'},
   {...sourceItem,id:'device-bp',senderRole:'nurse' as const,text:'Device reading: 125/80'},
   {...sourceItem,id:'doctor-bp',senderRole:'doctor' as const,text:'Device reading: 125/80'},
   {...sourceItem,id:'quote',senderRole:'zoe' as const,text:'You wrote 150/95 this morning'},
   {...sourceItem,id:'threshold',senderRole:'zoe' as const,text:'A reading of 180/120 needs attention'},
  ];
  const conversation={session:{member,data:{...base,items}},handoff:{selected:null,active:false,remembered:[],failed:[],fallbacks:[]},optimistic:[]};
  const html=renderToStaticMarkup(React.createElement(NurseConversation,{conversation:conversation as unknown as Parameters<typeof NurseConversation>[0]['conversation'],locale,nurseName:'Narine',onRetry(){},onAction(){}}));
  const label={en:'Member-reported, not verified',hy:'Անդամի հաղորդածը, չստուգված',ru:'Со слов участника, не проверено'}[locale];
  const bubble=(id:string)=>html.split(`data-conversation-item="${id}"`)[1]!.split('</article>')[0]!;
  assert.ok(bubble('typed-bp').includes(label),`Typed BP bubble is labelled in ${locale}`);
  for(const id of ['typed-bp-hy','typed-bp-ru','typed-bp-prefixed'])assert.ok(bubble(id).includes(label),`${id} is labelled in ${locale}`);
  assert.ok(bubble('quote').includes(label),`Zoe's matching typed BP quote is labelled in ${locale}`);
  for(const id of ['ordinary','device-bp','doctor-bp','threshold','appointment-date','visit-date','tablet-fraction'])assert.ok(!bubble(id).includes(label),`${id} has no typed BP label in ${locale}`);
 }
}

// Regression pack P2: both ordinary tasks and doctor handovers disclose the actor before completion.
for(const locale of ['en','hy','ru'] as const)for(const title of ['Confirm the visit time','From the doctor']){
 const item={...dueTask,title,...(title==='From the doctor'?{sourceConversationId:member.id,origin:'doctor_handover' as const}:{})};
 taskToday([item]);taskSnapshot={...item,events:[]};taskMode='';taskReadMode='';
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale,nurseName:'Narine',nurseId:member.id}));});
 await send({en:'today',hy:'այսօր',ru:'сегодня'}[locale]);
 const markDone={en:'Mark done',hy:'Նշել ավարտված',ru:'Отметить выполненной'}[locale];
 await act(async()=>screen.root.findAllByType('button').find(b=>b.children.includes(markDone))!.props.onClick());
 const line=screen.root.findByProps({'data-closing-as':'complete'});
 assert.equal(line.children.join(''),{en:'Closing as Narine · Done',hy:'Փակվում է Narine-ի անունով · Արված է',ru:'Закрывается от имени: Narine · Выполнено'}[locale]);
 assert.equal(line.props['aria-live'],'polite');assert.equal(line.type,'p');
 const submit=()=>screen.root.findByProps({type:'submit'});
 assert.equal(submit().props.disabled,true,'An empty completion note still cannot be sent');
 await act(async()=>screen.root.findByType('textarea').props.onChange({target:{value:'Contact completed'}}));
 assert.equal(submit().props.disabled,false,'The existing completion-note rule still enables send');
 await act(async()=>screen.unmount());
}
console.log('Regression pack: typed BP and matching Zoe quotes labelled in en/hy/ru; ordinary/device/threshold bubbles unlabelled; task and handover closing actor disclosed with existing note rules (mocked IO).');

// Conversation-backed handovers change with the viewer locale; unmarked titles and notes stay as stored.
for(const locale of ['en','hy','ru'] as const){
 for(const [title,kind,want,sourceConversationId,origin] of [
  ['From the doctor','contact-followup',{en:'From the doctor',hy:'Բժշկից',ru:'От врача'},member.id,'doctor_handover'],
  ['Nurse handoff','doctor-referral',{en:'Nurse handoff',hy:'Փոխանցում բուժքրոջից',ru:'Передача от медсестры'},null,'nurse_handoff'],
  ['Mild side effect from Zoe','contact-followup',{en:'Mild side effect from Zoe',hy:'Թեթև կողմնակի ազդեցություն՝ Զոյայից',ru:'Лёгкий побочный эффект от Zoe'},null,'zoe_side_effect'],
  ['Side effect reported: dizziness','contact-followup',{en:'Side effect reported: dizziness',hy:'Հաղորդվել է կողմնակի ազդեցություն՝ գլխապտույտ',ru:'Сообщён побочный эффект: головокружение'},null,'zoe_side_effect'],
  ['Collect blood pressure log','evidence-collection',{en:'Collect blood pressure log',hy:'Collect blood pressure log',ru:'Collect blood pressure log'},null,null],
  ['Call about the results','contact-followup',{en:'Call about the results',hy:'Call about the results',ru:'Call about the results'},null,null],
 ] as const){
  const item={...dueTask,title,kind,sourceConversationId,origin,instructions:'From the doctor: keep this note exactly as typed'};
  taskToday([item]);taskSnapshot={...item,events:[]};taskMode='';taskReadMode='';
  await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale,nurseName:'Narine',nurseId:member.id}));});
  await send({en:'today',hy:'այսօր',ru:'сегодня'}[locale]);
  assert.ok(screen.root.findByProps({'data-task-card':item.id}).findAllByType('button')[0].children.includes(want[locale]),`Today system title in ${locale}`);
  await act(async()=>screen.root.findByProps({'data-task-card':item.id}).findAllByType('button')[0].props.onClick());
  assert.ok(text().includes(item.instructions),'The doctor note is preserved');
  await act(async()=>screen.unmount());
 }
 const staffTask={...dueTask,title:'From the doctor',sourceConversationId:null,instructions:'Staff wrote From the doctor about mmHg'};
 const html=renderToStaticMarkup(React.createElement(NurseTaskDetails,{snapshot:{...staffTask,events:[]},locale,disabled:false,onDetails(){},onOperation(){}}));
 assert.ok(html.includes('>From the doctor</button>'),'An identically named ordinary staff task is preserved');
 assert.ok(html.includes(staffTask.instructions),'Staff text containing the system phrase is preserved');
}

// The actual chat entry point passes its signed-in actor through Today to Resolve.
{
 const todayBefore=todayResult;
 const item={...careAlertContracts.careAlertSchema.parse({id:member.id,memberId:member.id,memberName:member.name,source:'message',priority:'urgent',doctorName:'Fictional doctor',reason:'bp_doctor_today',redFlags:[],state:'open',stateSeq:0,occurrences:1,createdAt:dueTask.createdAt,lastSeenAt:dueTask.createdAt,acknowledgedAt:null,acknowledgedBy:null,resolvedAt:null,resolvedBy:null,resolution:null,resolutionNote:null,telegram:[]}),ownerName:'Different owner',ownerRole:'nurse'};
 todayResult={ok:true,identities:[],asOf:dueTask.createdAt,alerts:{kind:'ready',alerts:[item],total:1},page:{tasks:[],nextCursor:null},visits:{enabled:false,visits:[]}};
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale:'en',nurseName:'Signed-in nurse',nurseId:member.id}));});
 await send('today');
 assert.equal(screen.root.findByProps({'data-closing-as':'resolve'}).children.join(''),'Closing as Signed-in nurse');
 await act(async()=>screen.unmount());todayResult=todayBefore;
}

// Sent handoffs are discoverable without knowing a typed command, in every staff language.
for(const locale of ['en','hy','ru'] as const){
 workspace={...base,items:[sourceItem]};readOverride=null;handoffMode='';handoffPage={items:[],hasMore:false};
 const title=sentHandoffs.sentHandoffsCopy(locale).title;
 const item={taskId:member.id,member,sentAt:'2026-11-07T13:00:00Z',topic:'member-request' as const,observation:'Fictional nurse observation',status:'completed' as const,resolution:{note:'Fictional closing note',by:'Fictional doctor',at:'2026-11-07T14:00:00Z'}};
 overviewPage={items:[item],hasMore:false};
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale,nurseName:'Narine',nurseId:member.id}));});
 assert.ok(button(title),'Landing has the sent-to-doctor entry');
 const before=overviewCalls;const writeBefore:number=handoffCalls.length;
 await press(title);assert.equal(overviewCalls,before+1);
 assert.equal(screen.root.findAllByProps({'data-nurse-sent-handoffs':true}).length,1);
 assert.match(text(),/Fictional closing note/);
 assert.equal(handoffCalls.length,writeBefore,'Reading handoffs never creates a handoff');
 await press(sentHandoffs.sentHandoffsCopy(locale).open);
 assert.equal(screen.root.findAllByProps({'data-nurse-sent-handoffs':true}).length,0,'Opening the member consumes the list');
 assert.ok(screen.root.findAll(node=>node.props['data-conversation-item']).length,'The member conversation opens');
 await act(async()=>screen.unmount());
 await act(async()=>{screen=create(React.createElement(NurseChatV2,{locale,nurseName:'Narine',nurseId:member.id}));});
 await send({en:'today',hy:'այսօր',ru:'сегодня'}[locale]);assert.ok(button(title),'Today footer has the same read');
 await press(title);assert.equal(overviewCalls,before+2);
 await act(async()=>screen.unmount());
}
console.log('Sent handoffs: landing and Today entry, en/hy/ru, opening the actual conversation, no handoff writes (mounted, mocked IO).');

// #752 via the actual chat entry point: confirmation precedes every collection write.
for(const [l,sentence,pulse] of [
 ['en','Samples collected.','pulse'],['hy','Նմուշները վերցված են։','զարկերակ'],['ru','Образцы взяты.','пульс'],
] as const){
 for(const mode of ['plain','mixed','exception','partial','already-collected'] as const){
  const data=seededVisit();data.steps=[{step:'confirmed',at:data.visit.startsAt,by:'Narine'},{step:'started',at:data.visit.startsAt,by:'Narine'}];
  data.items.push({kind:'sample',key:'sample:lipid-panel',testId:'lipid-panel',title:'Lipid panel',mark:null});
  const existing={done:true,collectionStatus:'collected' as const,note:null,values:null,recordedAt:data.visit.startsAt,nurseName:'Narine'};
  if(mode==='already-collected')data.items.find(i=>i.key==='sample:cbc')!.mark=existing;
  await mountVisit(data,l);
  const block=visitCopy.visitBlockCopy(l),vCopy=visitCopy.visitCopy(l);
  const message=mode==='mixed'?`138/88, ${pulse} 72. ${sentence}`:mode==='exception'?`${sentence} one tube missing`:mode==='partial'?`${sentence} Lipid`:sentence;
  await send(message);
  assert.equal(visitCommands.length,0,'Sending and previewing saves nothing');
  const preview=screen.root.findByProps({'data-visit-preview':true});
  const choices=preview.findAllByType('button').filter(b=>b.props['data-collection-choice']==='collected');
  if(mode==='exception'||mode==='partial'){
   assert.ok(choices.every(b=>b.props['aria-pressed']===false),'Unresolved or partial sample scope never preselects Collected');
   assert.equal(button(block.confirm).props.disabled,true);
   await act(async()=>screen.unmount());continue;
  }
  assert.equal(choices.length,mode==='already-collected'?1:2);
  assert.ok(choices.every(b=>b.props['aria-pressed']===true));
  assert.equal(button(block.confirm).props.disabled,false);
  await press(block.confirm);
  const collected=visitCommands.filter(c=>c.kind==='collect');
  assert.equal(collected.length,mode==='already-collected'?1:2);
  if(mode==='already-collected')assert.equal((collected[0].command as Extract<NurseVisitCollectCommand,{testId:string}>).testId,'lipid-panel');
  if(mode==='mixed'){
   const bp=screen.root.findByProps({'data-visit-item':'measure:bp'});
   assert.equal(bp.findByProps({'aria-label':vCopy.systolic}).props.value,'138');
   assert.equal(bp.findByProps({'aria-label':vCopy.diastolic}).props.value,'88');
   assert.equal(bp.findByProps({'aria-label':vCopy.optionalPulse}).props.value,'72');
   const next=bp.findAllByType('button').find(b=>b.children.join('')===block.next)!;
   assert.equal(next.props.disabled,true);assert.ok(screen.root.findByProps({'data-visit-bp-pending':true}));
   const before:number=visitCommands.length;await act(async()=>next.props.onClick());assert.equal(visitCommands.length,before);
  }
  await act(async()=>screen.unmount());
 }
}
console.log('#752 chat entry: plain/mixed/exception/partial/already-collected sample messages, zero pre-confirm writes and recorded BP in en/hy/ru passed (mocked IO).');

// #752 clean four-step visit: count button presses from opening the Today visit.
{
 const data=seededVisit();
 data.items=data.items.filter(i=>i.kind==='sample'||i.key==='measure:bp');
 data.items.push({kind:'sample',key:'sample:lipid-panel',testId:'lipid-panel',title:'Lipid panel',mark:null});
 const checks=Array.from({length:8},(_,n)=>({kind:'check' as const,key:`check:clean-${n}`,checkId:`clean-${n}`,version:'test-v1',section:n<4?'bp' as const:n<6?'safety' as const:'sampling' as const,label:{en:`Clean check ${n}`,hy:`Կետ ${n}`,ru:`Пункт ${n}`},source:'Existing protocol',mark:null}));
 data.items.unshift(...checks);
 await mountVisit(data);let presses=1;
 const tap=async(label:string)=>{await press(label);presses++;};
 const all=async(section:string)=>{await act(async()=>screen.root.findByProps({'data-visit-all-done-section':section}).findAllByType('button').find(b=>b.children.join('')===visitCopy.visitBlockCopy('en').allDone)!.props.onClick());presses++;};
 await tap('I confirmed the visit with the member');await tap('I have arrived');
 const afterArrival=presses;
 for(const [label,value] of [['Systolic','138'],['Diastolic','88'],['Pulse (optional)','72']])await act(async()=>screen.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));
 await all('bp');await all('safety');await tap('Next');
 assert.equal(screen.root.findByProps({'data-visit-group':'samples'}).props['data-visit-group'],'samples');
 const afterBp=presses;
 await all('sampling');
 await send('Samples collected.');presses++;await tap('Confirm entry');
 await tap(visitCopy.visitCopy('en').stepButtons['samples-at-lab']);
 const afterSamples=presses;
 await tap('Complete visit');await tap('Complete visit');
 assert.ok(visitData!.completion);
 assert.deepEqual({open:1,arrival:afterArrival-1,bp:afterBp-afterArrival,samples:afterSamples-afterBp,complete:presses-afterSamples,total:presses},{open:1,arrival:2,bp:3,samples:4,complete:2,total:12});
 assert.equal(visitCommands.filter(c=>c.kind==='mark'&&(c.command as NurseVisitMarkCommand).item==='measure:bp').length,1);
 assert.equal(visitCommands.filter(c=>c.kind==='mark'&&(c.command as NurseVisitMarkCommand).item.startsWith('check:')).length,8);
 assert.ok(visitCommands.filter(c=>c.kind==='mark'&&(c.command as NurseVisitMarkCommand).item.startsWith('check:')).every(c=>(c.command as NurseVisitMarkCommand).checklistVersion==='test-v1'));
 await act(async()=>screen.unmount());
 console.log('#752 clean path: 12 presses = open 1 + arrival 2 + BP 3 + samples 4 + complete 2 (real mounted chat, mocked IO; typing/scrolling excluded).');
}
