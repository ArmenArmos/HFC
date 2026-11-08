import * as bpUnit from '@/lib/bp-unit';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import * as copy from '@/lib/staff/staff-locale-copy';
import * as identity from '@/lib/staff/member-identity';
import * as dates from '@/lib/staff/yerevan-time';
import {typedLanguage} from '@/lib/staff-zoe/typed-language';
import {typedBoundary} from '@/lib/staff-zoe/typed-boundary';
import {notDone} from '@/lib/staff-zoe/outcome-copy';
import {smallTalk,smallTalkLines} from '@/lib/staff-zoe/small-talk';
import {workspaceIntent} from '@/lib/staff-zoe/home-intent';
import {mergeUrgent} from '@/lib/doctor-inbox/urgent-windows';
import type {PanelMember,DoctorPanel} from '@/lib/staff-zoe/panel';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const a='d0000000-0000-4000-8000-000000000001',b='d0000000-0000-4000-8000-000000000002';
const rows:PanelMember[]=[{identity:{id:a,name:'Anna Example',birthDate:'1980-01-01',sex:'female',clinic:'North clinic',phoneLast4:'1234',shortId:'NRN-0001'},risk:'low',attention:'urgent',bp:{systolic:122,diastolic:78,at:'2026-11-06T20:30:00Z',unverified:true},ldl:{value:2,on:'2026-11-05',counted:false},unavailable:false},{identity:{id:b,name:'Anna Example',birthDate:'1990-02-03',sex:'female',clinic:'South clinic',phone:'+37499123456',shortId:'NRN-0002'},risk:null,attention:'none',bp:null,ldl:null,unavailable:true}];
const navigations:string[]=[];
const modules:Record<string,unknown>={'@/lib/bp-unit':bpUnit,'@/lib/brand':await import('@/lib/brand'),
 react:React,'react/jsx-runtime':jsx,
 '@/lib/staff/staff-locale-copy':copy,'@/lib/staff/member-identity':identity,'@/lib/staff/yerevan-time':dates,
 '@/lib/staff/chat-member-identity-actions':{readStaffChatMemberIdentities:()=>{throw Error('Complete server identities need no extra read');}},
};
function load(file:string){const exports:Record<string,unknown>={};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Date,Intl,crypto,document:{hidden:false,addEventListener(){},removeEventListener(){}},setInterval:()=>1,clearInterval(){},require:(name:string)=>{assert.ok(name in modules,`Unmocked ${name}`);return modules[name];}});return exports;}
modules['./member-identity']=load('components/staff/member-identity.tsx');
modules['@/components/staff/chat-member-identity']=load('components/staff/chat-member-identity.tsx');
modules['./panel-copy']=load('components/doctor-chat-v2/panel-copy.ts');
const Patients=load('components/doctor-chat-v2/patients-card.tsx').PatientsCard as React.ComponentType<Record<string,unknown>>;
const Graphs=load('components/doctor-chat-v2/panel-graphs.tsx').PanelGraphs as React.ComponentType<Record<string,unknown>>;
const Choice=load('components/doctor-chat-v2/open-patient-chat-choice.tsx').OpenPatientChatChoice as React.ComponentType<Record<string,unknown>>;
let view!:ReactTestRenderer;
const text=()=>JSON.stringify(view.toJSON());
for(const locale of ['en','hy','ru'] as const){
 await act(async()=>{view=create(React.createElement(Patients,{rows,locale,asOf:'2026-11-06T08:00:00Z',onOpen:(id:string)=>navigations.push(id)}));});
 assert.equal(view.root.findAllByProps({'data-panel-member':a}).length,1);
 assert.equal(view.root.findAllByProps({'data-panel-member':b}).length,1);
 assert.ok(text().includes(copy.st(locale,'7 Nov 2026, 00:30','7 նոյ 2026, 00:30','7 ноя 2026, 00:30')),'BP dates use Yerevan midnight');
 assert.match(text(),/1980|1990/);assert.match(text(),/North clinic/);assert.match(text(),/•••• 1234/);assert.match(text(),/\+37499123456/);assert.match(text(),/NRN-0001/);
 assert.ok(text().includes(copy.st(locale,'Not recorded','Գրանցված չէ','Не записано')));
 assert.ok(text().includes(copy.st(locale,'Member-reported, unverified','Անդամի նշածը, չստուգված','Со слов участника, не проверено')));
 await act(async()=>view.root.findByType('select').props.onChange({target:{value:'needs_me'}}));
 assert.equal(view.root.findAllByProps({'data-panel-member':b}).length,0);
 await act(async()=>view.root.findByType('select').props.onChange({target:{value:'urgent'}}));
 assert.equal(view.root.findAllByProps({'data-panel-member':a}).length,1);
 await act(async()=>view.root.findByProps({'data-panel-member':a}).props.onClick());assert.equal(navigations.at(-1),a);
 await act(async()=>view.update(React.createElement(Patients,{rows,locale,memberIds:[b],asOf:'2026-11-06T08:00:00Z',onOpen:(id:string)=>navigations.push(id)})));
 assert.equal(view.root.findAllByProps({'data-panel-member':a}).length,0);
 await act(async()=>view.update(React.createElement(Patients,{rows:[],locale,rosterComplete:false,asOf:'2026-11-06T08:00:00Z',onOpen:()=>{}})));
 assert.ok(text().includes(copy.st(locale,'Your member list is incomplete. Panel totals and graphs are unavailable.','Ձեր անդամների ցանկը թերի է։ Խմբի ընդհանուր քանակներն ու գծապատկերները հասանելի չեն։','Список ваших участников неполный. Общие показатели и графики недоступны.')));
 assert.ok(!text().includes(copy.st(locale,'No members are assigned to you.','Ձեզ դեռ անդամներ նշանակված չեն։','Вам пока не назначены участники.')),'An unread roster never means no assigned members');
 await act(async()=>view.unmount());
 for(const matches of [[rows[0].identity],rows.map(r=>r.identity)]){
  const before=navigations.length;
  await act(async()=>{view=create(React.createElement(Choice,{rows:matches,locale,onOpen:(id:string)=>navigations.push(id)}));});
  assert.equal(navigations.length,before,'A record question never auto-opens a chat');
  assert.match(text(),/Open|բացեք|откройте/);assert.match(text(),/North clinic/);assert.match(text(),/1980/);
  if(matches.length===2){assert.match(text(),/South clinic/);assert.match(text(),/1990/);assert.equal(view.root.findAllByProps({'data-member-disambiguation':true}).length,1);}
  await act(async()=>view.root.findAllByType('button')[0].props.onClick());assert.equal(navigations.at(-1),a);
  await act(async()=>view.unmount());
 }
}
const who={missing:[],alerts:[],windows:[],items:[],labs:[],plans:[],uploads:[],identityChecks:[],p0Total:0,uploadTotal:0,others:{rest:0},urgentIncomplete:false,incomplete:false,capped:false,asOf:'2026-11-06T08:00:00Z'};
const panel:DoctorPanel={kind:'panel',rows,who,asOf:who.asOf,graphs:[{kind:'risk',total:2,bars:[{key:'low',count:1,memberIds:[a]},{key:'unknown',count:1,memberIds:[b]}]}]};
let found:unknown={kind:'member',memberId:a,memberName:'Anna Example',identity:rows[0].identity};
let fail=false;const calls:string[]=[];
const portfolioCalls:unknown[][]=[];let portfolioFailure=false;
modules['@/lib/staff-zoe/home-actions']={readDoctorHome:async(...args:unknown[])=>{portfolioCalls.push(args);return portfolioFailure?{kind:'unavailable'}:args[0]&&((args[0] as {kind:string}).kind==='day')?{kind:'day',day:{marker:'assigned overdue queue'}}:{kind:'missing_bp',page:{rows:[],hasMore:false,nextCursor:null},missingIds:[],unknown:0};}};
Object.assign(modules,{
 // Voice is unavailable in these typed-chat fixtures; the dedicated voice UI check mounts its dispatch.
 '@/components/chat-v2/conversation':{useConversation:()=>({active:false,edit(){},sent(){}}),ConversationToggle:()=>null},
 '@/components/staff/voice-reply':await import('@/components/staff/voice-reply'),
 'next/navigation':{useRouter:()=>({push:(url:string)=>navigations.push(url)})},'lucide-react':{ArrowUp:()=>null},
 '@/components/patient/use-chat-viewport':{useChatViewport(){}},'@/components/chat-v2/use-thread-scroll':{useThreadScroll:()=>({threadRef:{current:null},contentRef:{current:null},unread:false,newest(){}})},
 '@/components/chat-v2/staff-menu':{StaffChatMenu:()=>null},'./telegram-menu':{DoctorTelegramMenu:()=>null},
 '@/lib/staff-zoe/typed-language':{typedLanguage},'@/lib/staff-zoe/typed-boundary':{typedBoundary},'@/lib/staff-zoe/outcome-copy':{notDone},
 '@/lib/staff-zoe/small-talk':{smallTalk,smallTalkLines},'@/lib/staff-zoe/home-intent':{workspaceIntent},'@/lib/doctor-inbox/urgent-windows':{mergeUrgent},
 './patients-card':{PatientsCard:Patients},'./panel-graphs':{PanelGraphs:Graphs},'./open-patient-chat-choice':{OpenPatientChatChoice:Choice},
 './messages':{DoctorReply:({reply,onAct,onCheck}:{reply:unknown;onAct?:unknown;onCheck?:unknown})=>{assert.equal(onAct,undefined,'General cards expose navigation, not alert mutations');assert.equal(onCheck,undefined);return React.createElement('p',null,JSON.stringify(reply));}},
 '@/lib/staff-zoe/chat-v2-actions':{
  readDoctorChatApprovals:async(...args:unknown[])=>{portfolioCalls.push(args);return portfolioFailure?{kind:'unavailable'}:{kind:'approvals_history',day:args[0],ok:true,rows:[],hasMore:false,asOf:who.asOf};},
  readDoctorChatPanel:async(_id:string,mode:string)=>{calls.push(mode);return fail?{kind:'unavailable'}:panel;},
  searchDoctorChatMembers:async()=>({kind:'members',rows:[rows[0].identity],hasMore:false}),
  findDoctorChatQuestionMember:async(_text:string,_doctor:string,current?:unknown)=>{assert.equal(current,undefined,'General questions never carry a target');calls.push('resolve');return found;},
 },
});
const Chat=load('components/doctor-chat-v2/doctor-chat.tsx').DoctorChatV2 as React.ComponentType<Record<string,unknown>>;
await act(async()=>{view=create(React.createElement(Chat,{doctorId:'doctor',doctorName:'Aram',locale:'en'}));});
const latestReply=()=>JSON.parse(view.root.findAllByType('p').at(-1)!.children.join('')) as {kind:string};
const send=async(value:string)=>{await act(async()=>view.root.findByType('textarea').props.onChange({target:{value}}));await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}));};
for(const [question,kind,args] of [
 ['Who is overdue','overdue',[{kind:'day'},'doctor']],
 ["Who hasn't logged BP this week",'missing_bp',[{kind:'missing_bp',query:'',cursor:null},'doctor']],
 ['What did I approve yesterday','approvals_history',['yesterday','doctor']],
 ['What did I approve today','approvals_history',['today','doctor']],
] as const){
 const before=calls.filter(c=>c==='resolve').length;
 await send(question);
 assert.equal(portfolioCalls.length>0,true,`${kind} must use its portfolio reader`);
 assert.deepEqual(JSON.parse(JSON.stringify(portfolioCalls.at(-1))),args);
 assert.equal(latestReply().kind,kind,`${question} must render a portfolio reply`);
 assert.equal(calls.filter(c=>c==='resolve').length,before,'Portfolio questions never resolve a member');
 assert.equal(view.root.findAllByProps({'data-open-patient-chat':true}).length,0);
}
portfolioFailure=true;
await send('What did I approve yesterday');assert.equal(latestReply().kind,'approvals-unavailable');
await send('Who is overdue');assert.equal(latestReply().kind,'unavailable');
await send("Who hasn't logged BP this week");assert.equal(latestReply().kind,'unavailable');
portfolioFailure=false;
await send('What is Anna Example latest BP?');assert.equal(view.root.findAllByProps({'data-open-patient-chat':true}).length,1);assert.doesNotMatch(text(),/Asking Zoe|From your last conversation/);
found={kind:'choose',rows:rows.map(r=>r.identity)};await send('What did Anna Example write?');assert.match(text(),/South clinic/);
await act(async()=>view.root.findAllByType('button').find(button=>button.children.includes('Patients'))!.props.onClick());
assert.equal(calls.filter(c=>c==='full').length,1);assert.equal(view.root.findAllByProps({'data-patients-card':true}).length,1);
await act(async()=>view.root.findByType('select').props.onChange({target:{value:'urgent'}}));
await act(async()=>view.root.findByProps({'aria-label':'Low risk: 1'}).props.onClick());
assert.equal(view.root.findByType('select').props.value,'all','Graph selection clears the earlier attention filter');assert.equal(view.root.findAllByProps({'data-panel-member':b}).length,0,'Graph selection filters Patients');
await act(async()=>view.root.findByProps({'data-panel-member':a}).findByType('button').props.onClick({stopPropagation(){}}));assert.equal(navigations.at(-1),`/staff/real/doctor-chat-v2/patient/${a}`);
await act(async()=>view.unmount());
fail=true;await act(async()=>{view=create(React.createElement(Chat,{doctorId:'doctor',doctorName:'Aram',locale:'en'}));});
await act(async()=>view.root.findAllByType('button').find(button=>button.children.includes('Patients'))!.props.onClick());assert.match(text(),/could not be read/);assert.equal(view.root.findAllByProps({'data-patients-card':true}).length,0);
await act(async()=>view.unmount());
console.log('General doctor home: mounted localized panel rows/filters, identity, graph-to-table filtering, patient navigation, single/same-name choice, no target and unreadable panel passed (synthetic IO).');
