/** Mounted production composers and shared hook, with injected IO. No provider or browser acceptance is claimed. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import * as copy from '@/lib/staff/staff-locale-copy';
import * as boundary from '@/lib/staff-zoe/typed-boundary';
const require=createRequire(import.meta.url);
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
type Options=Parameters<typeof import('../components/chat-v2/conversation').useConversation>[0];
let options!:Options;
let sent=0;
const calls:Array<{name:string;args:unknown[]}>=[];
const nothing=()=>{};
const card=(name:string)=>function FixtureCard(props:Record<string,unknown>){return React.createElement('section',{'data-fixture-card':name},JSON.stringify(props.reply??{}));};
const browser=Object.assign(new EventTarget(),{location:new URL('http://localhost/staff/real/nurse-chat'),history:{replaceState:nothing},matchMedia:()=>({matches:false})});
const document=Object.assign(new EventTarget(),{hidden:false});
const globals={window:browser,document,crypto:{randomUUID:()=>'f0000000-0000-4000-8000-000000000099'},AbortController,Response,Request,Blob,Event,Date,TextDecoder,TextEncoder,setInterval:()=>1,clearInterval:nothing,requestAnimationFrame:()=>1,cancelAnimationFrame:nothing,
 fetch:async(url:string,init:{body:string})=>{calls.push({name:'fetch',args:[url,JSON.parse(init.body)]});return new Response(JSON.stringify({type:'refused',code:'off'})+'\n');}};
function load(file:string,deps:Record<string,unknown>,extra:Record<string,unknown>={}){
 const exports:Record<string,unknown>={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  ...globals,...extra,exports,require:(name:string)=>{assert.ok(name in deps,`Uninjected ${file}: ${name}`);return deps[name];},
 });return exports;
}
const member='f0000000-0000-4000-8000-000000000001',doctor='f0000000-0000-4000-8000-000000000002';
const identity={id:member,name:'Example member',birthYear:1980,sex:'female'};
const action=(name:string,result:unknown)=>(...args:unknown[])=>{calls.push({name,args});return Promise.resolve(result);};
const actions=new Proxy<Record<string,unknown>>({
 readDoctorPatientChatHistory:action('history',{kind:'history',conversations:[],turns:[]}),
 openDoctorChatMember:action('open-member',{kind:'off'}),
 readDoctorPatientChatAlerts:action('alerts',{kind:'alerts',alerts:[]}),
 findDoctorChatQuestionMember:action('resolve-member',{kind:'keep'}),
 openDoctorChatZoe:action('open-zoe',{ok:true,conversationId:member}),
 readDoctorChatPanel:action('panel',{kind:'panel',who:{alerts:[],windows:[],missing:[],incomplete:false,capped:false}}),
},{get(target,key){if(typeof key==='string'&&!(key in target))return (...args:unknown[])=>{calls.push({name:key,args});throw Error(`Unexpected injected action ${key}`);};return target[key as string];}});
const conversation={active:false,phase:'off',seconds:0,toggle:nothing,edit:nothing,sent:()=>{sent++;}};
const handoff={active:false,frozen:false,remembered:[],fallbacks:[],select:nothing};
const nurseConversation={open:false,frozen:false,optimistic:[],handoff,caughtUp:nothing};
const notes={active:false,frozen:false,held:false,entries:[]};
const task={active:false,frozen:false,entries:[],updates:{},composerLabel:()=>''};
const visit={open:false,frozen:false,updates:{}};
const common:Record<string,unknown>={react:React,'react/jsx-runtime':require('react/jsx-runtime'),'lucide-react':require('lucide-react'),
 'next/navigation':{useRouter:()=>({push:nothing,refresh:nothing})},
 '@/lib/staff/staff-locale-copy':copy,
 '@/lib/brand':await import('@/lib/brand'),
 '@/components/patient/use-chat-viewport':{useChatViewport:nothing},
 '@/components/chat-v2/use-thread-scroll':{useThreadScroll:()=>({threadRef:{current:null},contentRef:{current:null},unread:false,newest:nothing,stopFollowing:nothing})},
 '@/components/chat-v2/conversation':{useConversation:(value:Options)=>{options=value;return conversation;},ConversationToggle:()=>React.createElement('button',{'data-fixture-voice':true})},
 '@/components/staff/voice-reply':{staffConversationReply:()=>null,renderedStaffReply:()=>''},
 '@/lib/staff-zoe/chat-v2-actions':actions,
 '@/lib/nurse-chat/v2-zoe-actions':{readNurseChatZoeHistory:action('nurse-history',{kind:'history',conversations:[],turns:[]}),findNurseChatQuestionMember:action('nurse-resolve',{kind:'member',memberId:member,memberName:'Example member'}),openNurseChatZoe:action('nurse-open',{ok:true,conversationId:member})},
 './use-nurse-conversation':{useNurseConversation:()=>nurseConversation},
 './use-nurse-notes':{useNurseNotes:()=>notes},
 './use-nurse-task':{useNurseTask:()=>task},
 './use-nurse-visit':{useNurseVisit:()=>visit},
 './messages':{NurseReply:card('nurse-reply'),DoctorReply:card('doctor-reply')},
};
// Only pure copy/parsing modules are imported. Every IO export is injected and recorded.
for(const name of [
 'staff-zoe/typed-language','staff-zoe/typed-boundary','staff-zoe/outcome-copy','staff-zoe/small-talk','staff-zoe/home-intent','staff-zoe/stream','staff-zoe/response-copy','staff-zoe/handover','staff-zoe/typed-handover','staff-zoe/typed-reply','staff-zoe/hand-back-copy','doctor-inbox/urgent-windows',
 'nurse-chat/zoe-events','nurse-chat/boundary','nurse-chat/handoff-copy','nurse-chat/sent-handoffs','nurse-chat/intent','nurse-chat/draft-intent','nurse-chat/action-intent','nurse-chat/measurement-intent','nurse-chat/today','nurse-visit/copy','staff/real-coordination/task-copy','care-alerts/contracts',
])common[`@/lib/${name}`]=await import(`../lib/${name}.ts`);
common['@/components/staff/nurse-urgent-guidance']=await import('@/components/staff/nurse-urgent-guidance');
function component(file:string,exportName:string){
 const deps={...common};
 const source=readFileSync(file,'utf8');
 for(const item of ts.preProcessFile(source).importedFiles){
  const name=item.fileName;if(name in deps)continue;
  const clause=source.match(new RegExp(`import\\s*\\{([^}]+)\\}\\s*from\\s*['"]${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}['"]`));
  deps[name]=Object.fromEntries((clause?.[1]??'').split(',').map(raw=>raw.trim()).filter(raw=>raw&&!raw.startsWith('type ')).map(key=>[key,/^[A-Z]/.test(key)?card(key):(...args:unknown[])=>{calls.push({name:key,args});throw Error(`Unexpected injected action ${key}`);} ]));
 }
 return load(file,deps)[exportName] as React.ComponentType<Record<string,unknown>>;
}
const Nurse=component('components/nurse-chat-v2/nurse-chat.tsx','NurseChatV2');
const Doctor=component('components/doctor-chat-v2/doctor-chat.tsx','DoctorChatV2');
const Patient=component('components/doctor-chat-v2/patient-chat.tsx','PatientChat');
const screens=[
 {name:'nurse',component:Nurse,props:{nurseId:doctor,nurseName:'Example nurse'}},
 {name:'doctor',component:Doctor,props:{doctorId:doctor,doctorName:'Example doctor'}},
 {name:'member chart',component:Patient,props:{doctorId:doctor,doctorName:'Example doctor',member:identity,owners:[],risk:null,planVersion:null,resultsReport:false}},
];
let ui!:ReactTestRenderer;
async function mount(screen:typeof screens[number],locale:string,enabled=true){await act(async()=>{ui=create(React.createElement(screen.component,{...screen.props,locale,voiceAvailable:enabled}));});}
async function unmount(){await act(async()=>ui.unmount());}
const output=()=>ui.root.findAll(node=>node.type==='section'&&!!node.props['data-fixture-card']).map(node=>node.children.join(''));
async function submit(text:string,spoken:boolean){
 calls.length=0;
 if(spoken){await act(async()=>options.onTranscript({status:'ok',text}));assert.equal(ui.root.findByType('textarea').props.value,text,'Transcript commits into editable composer');assert.equal(calls.length,0,'Transcript alone never runs a downstream action');await act(async()=>options.onSend());}
 else{await act(async()=>ui.root.findByType('textarea').props.onChange({target:{value:text}}));await act(async()=>ui.root.findByType('form').props.onSubmit({preventDefault:nothing}));}
 return {output:output(),calls:JSON.parse(JSON.stringify(calls))};
}
for(const screen of screens)for(const locale of ['en','hy','ru']){
 for(const text of ['approve this report','double his dose','yes','I have chest pain right now']){
  await mount(screen,locale);assert.equal(options.audience,'staff',`${screen.name} selects staff endpoints`);assert.equal(options.enabled,true);assert.ok(options.contextKey);assert.equal(options.urgentKey,null,'Staff composer never substitutes member emergency playback');
  const typed=await submit(text,false);await unmount();
  await mount(screen,locale);const spoken=await submit(text,true);await unmount();
  // IDs are deterministic per mount; these are actual component dispatch outputs and observed IO calls.
  assert.deepEqual(spoken,typed,`${screen.name} ${locale}: spoken ${text} follows typed dispatch`);
  assert.ok(spoken.output.length,'The actual send produces a reply');
  if(text==='I have chest pain right now'&&screen.name!=='doctor'){assert.ok(spoken.calls.some((call:{name:string})=>call.name==='fetch'),'Urgent words reach the same existing server ask path');assert.match(spoken.output.join(' '),/zoe-error/,'Provider refusal remains a visible reply');}
  assert.ok(!spoken.calls.some((call:{name:string})=>/approve|save|resolveDoctor|send.*Reply|compose|revise/.test(call.name)),`Spoken ${text} grants no clinical confirmation`);
 }
 await mount(screen,locale,false);assert.equal(options.enabled,false);assert.equal(ui.root.findAllByProps({'data-fixture-voice':true}).length,0,'Unavailable voice has no toggle');await unmount();
}
console.log('Staff voice composers: actual typed/spoken dispatch parity, editable committed draft, boundary commands, spoken yes without clinical confirmation, three locales and unavailable feature passed (injected IO).');
assert.ok(sent>0);
for(const mode of [notes,task]){
 mode.active=true;await mount(screens[0],'en');assert.equal(options.disabled,true,'Nurse clinical work composer disables voice');await unmount();mode.active=false;
}
await mount(screens[0],'en');
await act(async()=>ui.root.findByProps({'aria-label':'Open menu'}).props.onClick());assert.equal(options.disabled,true,'Open nurse menu disables voice');await unmount();
await mount(screens[1],'en');
await act(async()=>ui.root.findByProps({'aria-label':'Open menu'}).props.onClick());assert.equal(options.disabled,true,'Open doctor menu disables voice');await unmount();


// Production shared hook: deliver transcript and auto-send in one controller turn.
// React must commit the new draft before onSend reads it; this catches stale closure regressions.
let ports!:Record<string,unknown>;
let active=false;
class Controller{
 constructor(value:Record<string,unknown>){ports=value;}
 get active(){return active;}
 stop(){active=false;}
 start(){active=true;return Promise.resolve();}
 hidden(){active=false;}
 edit(){}
 sent(){}
 reply(){}
 emergency(){}
 error(){}
}
const routes:string[]=[];
const hookModule=load('components/chat-v2/conversation.tsx',{
 react:React,'react/jsx-runtime':require('react/jsx-runtime'),'lucide-react':require('lucide-react'),
 '@/lib/patient/copy':await import('@/lib/patient/copy'),'@/lib/staff-zoe/typed-boundary':boundary,
 '@/lib/zoe/symptoms/intake':{URGENT_TEXT:{en:'member emergency',hy:'member emergency',ru:'member emergency'}},
 '@/components/patient/use-hydrated':{useHydrated:()=>true},
 './conversation-controller':{ConversationController:Controller},
 './conversation-browser':{captureConversation:nothing,conversationSupported:()=>true,
 transcribeConversation:(...args:unknown[])=>{routes.push(String(args[4]));return Promise.resolve({status:'ok',text:'hello'});},
 playConversation:(...args:unknown[])=>{routes.push(String(args[3]));return Promise.resolve();}},
}) as typeof import('../components/chat-v2/conversation');
let hook!:ReturnType<typeof hookModule.useConversation>;
const delivered:string[]=[];
function Harness({locale='en',contextKey='member-a',disabled=false}:{locale?:'en'|'hy'|'ru';contextKey?:string;disabled?:boolean}){
 const [draft,setDraft]=React.useState('old draft');
 const current=hookModule.useConversation({enabled:true,disabled,locale,audience:'staff',contextKey,onTranscript:result=>setDraft(result.text),onSend:()=>delivered.push(draft),reply:null,urgentKey:null});
 React.useLayoutEffect(()=>{hook=current;});
 return React.createElement(hookModule.ConversationToggle,{locale,disabled,conversation:current});
}
for(const [locale,label] of [['en','Start voice conversation'],['hy','Սկսել ձայնային զրույցը'],['ru','Начать голосовой разговор']] as const){
 await act(async()=>{ui=create(React.createElement(Harness,{locale}));});
 assert.equal(ui.root.findByType('button').props['aria-label'],label);
 await act(async()=>hook.toggle());
 await act(async()=>{(ports.onTranscript as (result:unknown)=>void)({status:'ok',text:`new ${locale}`});(ports.onSend as ()=>void)();});
 assert.equal(delivered.at(-1),`new ${locale}`,'Auto-send sees committed transcript, never stale draft');
 assert.equal(ports.memberEmergency,false,'Staff has no automatic member emergency flow');
 assert.equal((ports.autoSend as (result:{text:string})=>boolean)({text:'yes'}),true,'Bare yes stays ordinary text; mounted dispatch above proves no clinical confirmation');
 assert.equal((ports.autoSend as (result:{text:string})=>boolean)({text:'double his dose'}),false,'Clinical command requires draft review');
 assert.equal((ports.autoSend as (result:{text:string})=>boolean)({text:'what needs my attention?'}),true);
 await (ports.transcribe as (...args:unknown[])=>Promise<unknown>)(new Blob(['fixture']),100,new AbortController().signal);
 await (ports.play as (...args:unknown[])=>Promise<unknown>)('reply',new AbortController().signal);
 assert.deepEqual(routes.splice(0),['/api/staff/zoe/voice','/api/staff/zoe/speech']);
 await act(async()=>ui.update(React.createElement(Harness,{locale,contextKey:'member-b'})));assert.equal(active,false,'Changing member stops active voice');
 await unmount();
}
await act(async()=>{ui=create(React.createElement(Harness,{disabled:true}));});assert.equal(ui.root.findByType('button').props.disabled,true);await unmount();
console.log('Shared staff hook: committed transcript sends, clinical commands pause, staff endpoint routing, localized labels, context cancellation and disabled control passed (synthetic controller).');
