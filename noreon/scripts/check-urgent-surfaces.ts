import {resolveTestModule} from './care-alert-resolve-test-module';
import {UploadIdentityChecks} from '@/components/staff/upload-identity-check';
import * as displayText from '@/lib/staff/display-text';
import * as memberIdentity from '@/lib/staff/member-identity';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import * as icons from 'lucide-react';
import * as inbox from '@/lib/doctor-inbox/contracts';
import * as urgent from '@/lib/doctor-inbox/urgent-windows';
import * as urgentInboxServer from '@/lib/doctor-inbox/urgent-inbox-server';
import * as urgentServer from '@/lib/doctor-inbox/urgent-windows-server';
import * as sourceLabels from '@/lib/doctor-inbox/source-labels';
import {memberUrgent} from '@/lib/doctor-inbox/member-urgent';
import {readMemberUrgent} from '@/lib/doctor-inbox/member-urgent-server';
import * as alerts from '@/lib/care-alerts/contracts';
import * as copy from '@/lib/staff/staff-locale-copy';
import * as common from '@/components/patient-care/common';
import * as mode from '@/lib/zoe/doctor-mode';
import * as handBack from '@/lib/staff-zoe/hand-back-copy';
import * as outcomeCopy from '@/lib/staff-zoe/outcome-copy';
import * as delivery from '@/lib/telegram-runtime/delivery-copy';
import {DeliveryRetry} from '@/components/conversation/delivery-retry';
import {whoNeedsMe} from '@/lib/staff-zoe/chat-v2-read';
import {readDoctorDay,doctorDayCounts,type DoctorDay} from '@/lib/doctor-inbox/day';
import {dayItems,DayItemCards,DaySummary} from '@/components/staff/doctor-workspace/day-cards';
import {runDoctorCard} from '@/lib/staff-zoe/card-read';
import {fixtureAlert,fixtureMember} from '../e2e/doctor-chat-v2/data';
import * as labProvenance from '@/lib/lab-ai/provenance';
import {taskSchema} from '@/lib/staff/real-coordination/schema';

const at='2026-11-04T10:07:00Z';
const member=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const alert=(n:number,state:alerts.CareAlert['state']='open'):inbox.AlertItem=>{
 const base=fixtureAlert(member(n+100),`Member ${n}`);
 return {...base,memberId:member(n),rank:state==='open'?0:1,alert:{...base.alert,id:member(n+100),memberId:member(n),state,createdAt:at,lastSeenAt:at}};
};
// N=2 open, M=1 acknowledged, K=4 windows, two already covered by a live alert.
// A resolved alert cannot suppress its member's still-open window.
const live=[alert(2),alert(3,'acknowledged'),alert(1)];
const resolved=alert(6,'resolved');
const windows:urgent.UrgentWindow[]=[1,3,4,6].map(n=>({memberId:member(n),memberName:`Member ${n}`,since:at,openedBy:n===4?'model':'rule'}));
const merged=urgent.mergeUrgent([...live,resolved],windows);
assert.equal(urgent.urgentCount([...live,resolved],windows),5);
assert.deepEqual(merged.map(i=>i.memberId),[member(1),member(2),member(3),member(4),member(6)]);
assert.deepEqual(urgent.mergeUrgent([],windows.slice().reverse()).map(i=>i.memberId),[member(1),member(3),member(4),member(6)]);
assert.equal(urgent.urgentCount([resolved],[windows[3],windows[3]]),1,'A resolved alert and repeated window cannot add rows');
assert.equal(urgent.urgentWindowsSchema.safeParse({ok:true,windows:[{...windows[0],openedBy:'unexpected'}],total:1}).success,false);
assert.equal(urgent.urgentWindowsSchema.safeParse({ok:true,windows:[{...windows[0],since:'unknown'}],total:1}).success,false);

let currentAlerts=[...live],currentWindows=[...windows],windowError=false,alertError=false,inboxError=false,role='doctor',locale:copy.StaffLocale='en';
const calls:string[]=[];
const rpc={async rpc(name:string,args?:Record<string,unknown>){
 calls.push(name);
 if(name==='staff_zoe_status')return {data:true,error:null};
 if(name==='doctor_urgent_windows')return {data:{ok:true,windows:currentWindows.slice(0,200),total:currentWindows.length},error:windowError?{code:'42501'}:null};
 if(name==='care_alert_inbox')return {data:{ok:true,role,asOf:at,alerts:args?.p_view==='resolved'?[resolved.alert]:currentAlerts.slice(0,Number(args?.p_limit??100)).map(i=>i.alert)},error:alertError?{code:'XX000'}:null};
 if(name==='doctor_ai_inbox')return {data:{version:'doctor-inbox-v1',ok:true,asOf:at,p0:currentAlerts.slice(-200),p0Total:currentAlerts.length,items:[],laneCap:50,unavailable:[],zoeAnswered:[],zoeAnsweredTotal:0,nurseActivity:[]},error:inboxError?{code:'XX000'}:null};
 if(name==='doctor_bp_repeat_notes')return {data:[],error:null};
 if(name==='doctor_medicine_concerns')return {data:{ok:true,items:[]},error:null};
 if(name==='doctor_ldl_responses')return {data:{version:'ldl-response-v1',enabled:false},error:null};
 if(name==='doctor_first_note_queue')return {data:{version:'first-note-queue-v1',enabled:false,items:[],closed:[]},error:null};
 throw Error(`Unexpected synthetic RPC ${name}`);
}};
let day:DoctorDay=await readDoctorDay(rpc);
assert.equal(doctorDayCounts(day).alerts,5);
assert.equal(whoNeedsMe(day).p0Total,5);

// Render the actual pages/components with only auth, IO and unrelated sections replaced.
const empty=()=>null;
const modules:Record<string,unknown>={'@/lib/lab-ai/provenance':labProvenance,'@/components/staff/upload-identity-check':{UploadIdentityChecks},
 'react':React,'react/jsx-runtime':jsx,'lucide-react':icons,
 '@/lib/staff/member-identity':memberIdentity,
 '@/lib/staff/chat-member-identity-actions':{readStaffChatMemberIdentities:async()=>[]},
 '@/lib/observability/logger':{log:{warn:()=>{}}},
 'next/link':{default:(props:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement('a',props)},
 'next/navigation':{notFound:()=>{throw Error('Unexpected 404');},unstable_rethrow:()=>{}},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>({identity:{role,id:member(99)},client:rpc})},
 '@/lib/staff/staff-locale':{staffLocale:async()=>locale},'@/lib/staff/staff-locale-copy':copy,
 '@/lib/nurse-chat/config':{nurseTodayHref:()=>'/staff/real/nurse-chat#today'},
 '@/components/patient-care/common':common,'@/lib/doctor-inbox/contracts':inbox,
 '@/lib/doctor-inbox/urgent-windows':urgent,'@/lib/doctor-inbox/urgent-windows-server':urgentServer,'@/lib/doctor-inbox/urgent-inbox-server':urgentInboxServer,
 '@/lib/doctor-inbox/day':{readDoctorDay:async()=>day,doctorDayCounts},
 '@/lib/care-alerts/contracts':{...alerts,careAlertsEnabled:()=>true},
 '@/lib/care-alerts/actions':{acknowledgeCareAlert:empty,resolveCareAlert:empty},'@/lib/care-alerts/nurse':{readNurseAlerts:empty},'@/components/staff/nurse-urgent-alerts':{NurseUrgentAlerts:empty},'@/components/ui/select-field':{SelectField:empty},
 './actions':{approveInboxDraft:empty,rejectInboxDraft:empty},
 '@/lib/doctor-inbox/zoe-answered':{zoeMarkNotices:{}},'@/components/doctor-inbox/zoe-answered':{ZoeAnsweredSection:empty},
 '@/components/doctor-inbox/nurse-activity':{NurseActivity:empty},'@/components/doctor-inbox/medicine-concerns':{MedicineConcernsSection:empty},
 '@/components/staff/first-note-queue':{FirstNoteQueue:empty},'@/components/doctor-inbox/ldl-responses':{LdlResponsesSection:empty},
 '@/lib/staff-zoe/workspace-config':{doctorChatHomeEnabled:()=>false,doctorChatV2Enabled:()=>false},
 '@/components/staff/doctor-workspace/day-cards':{OverdueTaskCards:empty},'@/components/staff/nurse-handoffs':{NurseHandoffs:empty},
 '@/app/staff/real/conversation/actions':{clearUrgentAction:empty},'@/lib/zoe/doctor-mode':mode,
 '@/lib/staff-zoe/chat-v2-actions':{readDoctorChatLab:()=>{throw Error('Unexpected lab read on an urgent surface');}},
 '@/components/staff/zoe/answer':{StaffZoeResponse:empty},'@/lib/staff-zoe/contracts':{memberRef:(id:string)=>id},
 './alerts':{AlertButtons:empty,AlertOutcome:empty},'@/lib/staff/alert-label':{staffAlertReason:()=>''},
 '@/lib/staff-zoe/hand-back-copy':handBack,'@/lib/staff-zoe/outcome-copy':outcomeCopy,'@/components/conversation/reply-draft-sources':{ReplyDraftSources:empty},
 '@/lib/telegram-runtime/delivery-copy':delivery,'@/components/conversation/delivery-retry':{DeliveryRetry},'@/lib/doctor-inbox/source-labels':sourceLabels,
};
const resolveFormModule=resolveTestModule();
modules['@/components/staff/care-alert-resolve']=resolveFormModule;
modules['./care-alert-resolve']=resolveFormModule;
function load(file:string){
 const exports:Record<string,unknown>={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,require:(name:string)=>{assert.ok(name in modules,`Unexpected module ${name}`);return modules[name];}});
 return exports;
}
modules['@/lib/staff/yerevan-time']=load('lib/staff/yerevan-time.ts');
modules['./member-identity']=load('components/staff/member-identity.tsx');
modules['@/components/staff/chat-member-identity']=load('components/staff/chat-member-identity.tsx');
modules['@/components/doctor-inbox/urgent-window']=load('components/doctor-inbox/urgent-window.tsx');
modules['./display-text']=displayText;
modules['@/lib/staff/display-text']=displayText;
modules['@/lib/staff/alert-card']=load('lib/staff/alert-card.ts');
modules['@/components/staff/alert-card']=load('components/staff/alert-card.tsx');
const {MemberUrgentSection}=(()=>{modules['@/lib/doctor-inbox/urgent-windows']=urgent;modules['@/lib/doctor-inbox/member-urgent']={};return load('components/staff/member-urgent.tsx') as {MemberUrgentSection:React.ComponentType<{urgent:Awaited<ReturnType<typeof readMemberUrgent>>;locale:copy.StaffLocale}>};})();
const today=load('app/staff/real/(review)/today/page.tsx').default as (props:{searchParams:Promise<object>})=>Promise<React.ReactElement>;
const alertPage=load('app/staff/real/(review)/alerts/page.tsx').default as typeof today;
modules['./lab-review-action']=load('components/doctor-chat-v2/lab-review-action.tsx');
const {DoctorReply}=load('components/doctor-chat-v2/messages.tsx') as typeof import('@/components/doctor-chat-v2/messages');
const {MemberConversation}=load('components/doctor-chat-v2/conversation.tsx') as typeof import('@/components/doctor-chat-v2/conversation');
const render=(element:React.ReactElement)=>renderToStaticMarkup(element);
const countIn=(html:string)=>Number(html.match(/data-urgent-count="(\d+)"/)?.[1]);
const windowIds=(html:string)=>Array.from(html.matchAll(/data-urgent-window="([^"]+)"/g),match=>match[1]);
for(const language of ['en','hy','ru'] as const){
 locale=language;
 const chat=render(React.createElement(DoctorReply,{reply:{kind:'who',...whoNeedsMe(day)},locale,onOpen:empty}));
 const todayHtml=render(await today({searchParams:Promise.resolve({})}));
 const alertsHtml=render(await alertPage({searchParams:Promise.resolve({})}));
 for(const html of [chat,todayHtml,alertsHtml]){
  assert.equal(countIn(html),5,'Chat, Today header and Alerts share the hand-counted total');
  assert.deepEqual(windowIds(html),[member(4),member(6)],'Only uncovered windows create an additional list row');
  assert.ok(html.includes(urgent.urgentWindowLine(at,locale)));
  assert.match(html,/14:07/);assert.doesNotMatch(html,/\b(?:AM|PM)\b|—/);
 }
 const flagged:string[]=[];
 for(const n of [1,2,3,4,5,6,7]){
  const window=currentWindows.find(w=>w.memberId===member(n));
  const data={...fixtureMember(member(n)),urgentOpen:!!window,urgentSince:window?.since??null};
  const card=render(React.createElement(MemberConversation,{data,locale,active:false,busy:false,onApprove:empty,onChange:empty}));
  if(windowIds(card).length)flagged.push(member(n));
  assert.equal(windowIds(card).length,window?1:0,'Member card flags exactly its open window');
  if(window)assert.ok(card.includes(urgent.urgentWindowLine(at,locale)));
  assert.equal(merged.some(item=>item.memberId===member(n)),live.some(item=>item.memberId===member(n))||windowIds(card).length>0,'Member care alerts and card windows match the list members');
 }
 assert.deepEqual(flagged,[member(1),member(3),member(4),member(6)]);
}
// The original scenario: a window without any care alert must never produce the empty reassurance.
locale='en';currentAlerts=[];currentWindows=[windows[2]];day=await readDoctorDay(rpc);
const windowOnly=render(await alertPage({searchParams:Promise.resolve({})}));
assert.equal(countIn(windowOnly),1);assert.match(windowOnly,/Urgent conversations/);assert.doesNotMatch(windowOnly,/No open alerts/);
const history=render(await alertPage({searchParams:Promise.resolve({view:'resolved'})}));
assert.match(history,/Urgent conversations/);assert.match(history,/Member 6/,'Resolved alert history stays visible');
// A clear or a later answer removes the projected window from every list and its member card.
currentWindows=[];day=await readDoctorDay(rpc);
for(const html of [render(await today({searchParams:Promise.resolve({})})),render(await alertPage({searchParams:Promise.resolve({})})),render(React.createElement(DoctorReply,{reply:{kind:'who',...whoNeedsMe(day)},locale,onOpen:empty}))]){
 assert.equal(countIn(html),0);assert.deepEqual(windowIds(html),[]);
}
// New source failure preserves existing work and explicitly marks the count incomplete.
const noWaiting=['Nothing waiting.','Սպասող գործեր չկան։','Ожидающих задач нет.'];
const noAlerts=['No open alerts','Բաց ահազանգեր չկան','Нет открытых оповещений'];
for(const language of ['en','hy','ru'] as const){
 locale=language;currentAlerts=[];currentWindows=[];
 for(const failure of ['windows','alerts','cap'] as const){
  windowError=failure==='windows';alertError=failure==='alerts';
  day=await readDoctorDay(rpc);
  if(failure==='cap')day={...day,urgentCapped:true};
  const html=render(await today({searchParams:Promise.resolve({})}));
  for(const line of [...noWaiting,...noAlerts])assert.ok(!html.includes(line),`Today must not reassure after ${failure} in ${language}: ${line}`);
  assert.match(html,/role="alert"/,'An incomplete urgent queue has a visible notice even with zero rows');
 }
}
locale='en';alertError=false;
// The live doctor page must reach both sources even when its first alert RPC fails.
for(const language of ['en','hy','ru'] as const){
 locale=language;alertError=true;windowError=false;currentWindows=[windows[2]];
 for(const fallback of [true,false]){
  inboxError=!fallback;currentAlerts=fallback?[live[0]]:[];calls.length=0;
  const html=render(await alertPage({searchParams:Promise.resolve({})}));
  assert.ok(calls.includes('doctor_urgent_windows'),'A failed alert query cannot prevent the window read');
  assert.deepEqual(windowIds(html),[member(4)]);
  assert.equal(countIn(html),fallback?2:1);
  if(fallback)assert.match(html,/Member 2/,'Available fallback care alerts stay visible');
  assert.match(html,/role="alert"/);
  for(const line of noAlerts)assert.ok(!html.includes(line));
 }
 inboxError=false;alertError=false;windowError=true;currentAlerts=[live[0]];
 const html=render(await alertPage({searchParams:Promise.resolve({})}));
 assert.match(html,/Member 2/);assert.equal(countIn(html),1);assert.match(html,/role="alert"/);
}
locale='en';windowError=false;currentAlerts=[live[0]];role='admin';calls.length=0;
assert.match(render(await alertPage({searchParams:Promise.resolve({})})),/Member 2/);
assert.deepEqual(calls,['care_alert_inbox'],'Admin live view retains its existing alert-only RPC');
alertError=true;
assert.match(render(await alertPage({searchParams:Promise.resolve({})})),/Alerts unavailable/);
role='doctor';alertError=false;
currentAlerts=[live[0]];windowError=true;day=await readDoctorDay(rpc);
assert.equal(day.inbox.p0.length,1);assert.equal(whoNeedsMe(day).incomplete,true);
const failed=render(await alertPage({searchParams:Promise.resolve({})}));
assert.match(failed,/Member 2/);assert.match(failed,/could not be checked|unavailable|incomplete/i);assert.doesNotMatch(failed,/No open alerts/);
console.log('Urgent surfaces: shared reader, 2 open + 1 acknowledged + 4 windows = 5 urgent items; real chat/Today/Alerts/member renders agree in en, hy and ru; dedup, resolved history, closed windows and failed-source preservation passed (controlled IO, no browser/SQL).');

// Real query boundaries: all list surfaces share the union of both existing alert selections.
windowError=false;currentWindows=[];
for(const size of [101,201]){
 currentAlerts=Array.from({length:size},(_,i)=>alert(i+10));
 if(size===201)currentWindows=[{memberId:member(10),memberName:'Member 10',since:at,openedBy:'rule'}];
 day=await readDoctorDay(rpc);
 assert.equal(day.inbox.p0.length,size,'Union retains both the newest and oldest alert selections');
 for(const html of [render(await today({searchParams:Promise.resolve({})})),render(await alertPage({searchParams:Promise.resolve({})})),render(React.createElement(DoctorReply,{reply:{kind:'who',...whoNeedsMe(day)},locale,onOpen:empty}))]){
  assert.equal(countIn(html),size,'No unseen-total addition can double count a window at the alert cap');
  assert.deepEqual(windowIds(html),[]);
 }
}
currentAlerts=[];currentWindows=Array.from({length:201},(_,i)=>({memberId:member(i+300),memberName:`Window ${i}`,since:at,openedBy:'rule' as const}));
day=await readDoctorDay(rpc);assert.equal(day.urgentWindowsTotal,201);assert.equal(day.urgentCapped,true);
for(const html of [render(await today({searchParams:Promise.resolve({})})),render(await alertPage({searchParams:Promise.resolve({})})),render(React.createElement(DoctorReply,{reply:{kind:'who',...whoNeedsMe(day)},locale,onOpen:empty}))]){
 assert.equal(countIn(html),200,'Bounded count honestly describes the displayed rows');
 assert.match(html,/Only the first/,'Every capped surface discloses the bounded list');
}
console.log('Urgent caps: actual 100/200-row boundaries, union of existing selections, overlap at omitted alert and 201 windows agree with explicit cap notices.');

// Classic day cards must offer exactly the urgent work counted by the shared day reader.
currentAlerts=[...live,resolved];currentWindows=[...windows];day=await readDoctorDay(rpc);
for(const language of ['en','hy','ru'] as const){
 const items=dayItems(day,language);
 assert.equal(items.length,doctorDayCounts(day).alerts,'Classic day rows match the shared urgent count');
 assert.deepEqual(items.map(i=>i.memberId),merged.map(i=>i.memberId));
 const html=render(React.createElement(DayItemCards,{items,locale:language}));
 assert.ok(html.includes(urgent.urgentWindowLine(at,language)));
 assert.ok(html.includes(`/staff/real/members/${member(4)}`),'A window row opens its member');
}
currentAlerts=[];currentWindows=[windows[2]];day=await readDoctorDay(rpc);
const cardEnv={NOREON_DOCTOR_WORKSPACE:'true',NOREON_DOCTOR_CHAT_HOME:'true',NOREON_CARE_ALERTS_ENABLED:'true'};
for(const failure of ['none','alerts','windows'] as const){
 alertError=failure==='alerts';windowError=failure==='windows';
 currentAlerts=failure==='windows'?[live[0]]:[];
 const card=await runDoctorCard(rpc,{card:'alerts'},cardEnv);
 assert.equal(card.kind,'ready');
 assert.ok(card.kind==='ready'&&card.card==='alerts');
 if(card.kind==='ready'&&card.card==='alerts'){
  assert.equal(card.urgentTotal,1,'The classic Alerts card uses the merged count');
  assert.equal(card.incomplete,failure!=='none');
  assert.equal(card.windows.length,failure==='windows'?0:1,'Windows survive independent alert-source failure');
 }
}
alertError=false;windowError=false;
for(const careAlert of [live[0],live[1]]){
 currentAlerts=[careAlert];currentWindows=[{...windows[0],memberId:careAlert.memberId},windows[2]];
 const card=await runDoctorCard(rpc,{card:'alerts'},cardEnv);
 assert.ok(card.kind==='ready'&&card.card==='alerts');
 if(card.kind==='ready'&&card.card==='alerts'){
  assert.equal(card.urgentTotal,2);
  assert.deepEqual(card.windows.map(w=>w.memberId),[member(4)],'Open and acknowledged alerts cover only their own member window');
 }
}
for(const language of ['en','hy','ru'] as const){
 const cappedEmpty={...day,windows:[],urgentCapped:true};
 const html=render(React.createElement(DaySummary,{day:cappedEmpty,locale:language}));
 assert.ok(!html.includes(copy.st(language,'You are up to date.','Հասանելի խնամքի ցանկերում ոչինչ','В доступных очередях помощи ничего')),'A capped classic queue cannot claim it is empty');
}
// Today's source lines: kinds of record in plain words, never an id, a rule code or a sequence number.
for(const language of ['en','hy','ru'] as const){
 const line=sourceLabels.sourcesLine([{type:'conversation',ref:'8e5001c2-0000-4000-8000-000000000001',seq:2} as never,{type:'draft',ref:'85112514-0000-4000-8000-000000000001'},{type:'rule',ref:'RF-01'},{type:'source',ref:'zoe'},{type:'care_alert',ref:'04ca7263-0000-4000-8000-000000000001'},{type:'conversation',ref:'other'},{type:'lab_value',ref:'1',page:3},{type:'unknown_new_kind',ref:'x'}],language);
 assert.ok(!/[0-9a-f]{8}|RF-|#\d|\bzoe\b(?!\s)|_/.test(line.replace(/стр\. 3|էջ 3|page 3/,'')),`No ids or codes in the ${language} source line: ${line}`);
 assert.equal(line.split(' · ').length,7,'Each kind appears once');
}
assert.equal(sourceLabels.sourcesLine([],'en'),'');
const memberOne=alert(21),memberTwo=alert(22),done=alert(23,'resolved');
const own={...alert(21,'acknowledged').alert,id:member(221),createdAt:'2026-11-04T11:00:00Z'};
assert.deepEqual(memberUrgent([memberOne.alert,memberTwo.alert,done.alert,own],windows,member(21)).alerts.map(a=>a.id),[member(221),member(121)],'Own unresolved alerts only, newest first');
assert.equal(memberUrgent([done.alert],[],member(23)).alerts.length,0,'A resolved alert is not urgent');
assert.equal(memberUrgent([],windows,member(4)).window?.memberId,member(4));
assert.equal(memberUrgent([],windows,member(5)).window,null);
currentAlerts=[...live];currentWindows=[...windows];windowError=false;alertError=false;
const found=await readMemberUrgent(rpc,member(3));
assert.deepEqual([found.alerts.length,found.window?.memberId,found.incomplete],[1,member(3),false]);
alertError=true;assert.equal((await readMemberUrgent(rpc,member(3))).incomplete,true,'A failed alert read is incomplete, not empty');alertError=false;
windowError=true;assert.equal((await readMemberUrgent(rpc,member(3))).incomplete,true,'A failed window read is incomplete, not empty');windowError=false;
for(const language of ['en','hy','ru'] as const){
 const html=render(React.createElement(MemberUrgentSection,{urgent:{...memberUrgent(live.map(i=>i.alert),windows,member(3)),incomplete:false},locale:language}));
 assert.ok(html.includes('data-member-urgent')&&html.includes('data-alert-card')&&html.includes('data-urgent-window'),`Member page shows the card and the window in ${language}`);
 assert.ok(!/RF-\d|care_alert/.test(html));
 assert.equal(render(React.createElement(MemberUrgentSection,{urgent:{alerts:[],window:null,incomplete:false},locale:language})),'','Nothing urgent renders nothing');
 assert.ok(render(React.createElement(MemberUrgentSection,{urgent:{alerts:[],window:null,incomplete:true},locale:language})).includes('role="status"'),'An unreadable read says so');
}
console.log('Classic day cards and Alerts reader: merged rows, member links, counts and independent failures passed.');

// Doctor Today uses the same fixed-title formatter as the nurse's task cards.
for(const language of ['en','hy','ru'] as const){
 const task=taskSchema.parse({id:member(401),caseId:member(1),memberName:'Synthetic',title:'From the doctor',origin:'doctor_handover',sourceConversationId:member(402),kind:'contact-followup',instructions:'From the doctor: preserve these words',dueAt:at,creatorId:member(99),ownerId:member(98),ownerName:'Synthetic nurse',status:'open',revision:1,createdAt:at,updatedAt:at,needsReassignment:false,eligibleOwners:[]});
 const items=dayItems({...day,tasks:{items:[task],hasMore:false}},language);
 const row=items.find(item=>item.id===`task:${task.id}`)!;
 assert.equal(row.label,{en:'From the doctor',hy:'Բժշկից',ru:'От врача'}[language]);
 assert.ok(render(React.createElement(DayItemCards,{items:[row],locale:language})).includes(row.label));
}

// Ownership and recorded next action travel with the shared card on every staff surface.
{
 const {AlertCardLines}=await import('@/components/staff/alert-card');
 const a={...live[0].alert,ownerName:'Synthetic nurse',ownerRole:'nurse' as const,doctorName:'Synthetic doctor',escalatedAt:at,escalatedTo:'doctor' as const,escalatedDoctorName:'Synthetic doctor',acknowledgedAt:at,acknowledgedBy:'Synthetic nurse',nextAction:'Call <script>unsafe</script>',nextActionBy:'Synthetic nurse',nextActionAt:at,nextActionDueAt:at};
 for(const language of ['en','hy','ru'] as const){
  const html=render(React.createElement(AlertCardLines,{alert:a,locale:language}));
  assert.ok(html.includes('data-alert-owner')&&html.includes('Synthetic nurse'),'Shared card shows database owner');
  assert.ok(html.includes('data-alert-escalation')&&html.includes('Synthetic doctor'),'Escalated doctor is visible');
  assert.ok(html.includes('data-alert-next-action')&&html.includes('&lt;script&gt;unsafe&lt;/script&gt;')&&!html.includes('<script>'),'Stored text is escaped');
  assert.ok(html.includes('data-alert-acknowledgement'),'Acknowledgement includes actor and time');
  assert.ok(render(React.createElement(AlertCardLines,{alert:{...a,ownerName:null,ownerRole:null},locale:language})).includes(copy.st(language,'Not assigned','Նշանակված չէ','Не назначен')));
 }
}
console.log('Urgent surfaces: shared owner, escalation, acknowledgement and escaped next action in three locales.');

// The nurse Resolve form names the signed-in closer, independently of the alert owner.
modules['./alert-card']=modules['@/components/staff/alert-card'];
const {NurseUrgentAlertRow}=load('components/staff/nurse-urgent-alerts.tsx') as typeof import('@/components/staff/nurse-urgent-alerts');
for(const locale of ['en','hy','ru'] as const){
 const html=render(React.createElement(NurseUrgentAlertRow,{alert:{...live[0].alert,ownerName:'Different owner',ownerRole:'nurse'},locale,nurseName:'Fictional closer'}));
 const line={en:'Closing as Fictional closer',hy:'Փակվում է Fictional closer-ի անունով',ru:'Закрывается от имени: Fictional closer'}[locale];
 assert.ok(html.includes(`data-closing-as="resolve" aria-live="polite">${line}</p>`));
 const closeAt=html.indexOf('data-closing-as="resolve"'),outcomeAt=html.indexOf(alerts.resolutionLabel('member_contacted',locale));
 assert.ok(outcomeAt<closeAt,'Outcome choices precede the closing line');
 assert.match(html.slice(closeAt),/<\/p><button/,'The closing line is immediately above Save resolution');
}
console.log('Nurse Resolve: signed-in actor disclosure precedes save in en/hy/ru; outcome changes covered by check-nurse-chat-v2.');
