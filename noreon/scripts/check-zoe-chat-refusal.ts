import * as bpLabel from "@/components/chat-v2/reported-bp-label";
import * as memberStaffNames from "@/lib/member-staff-name.mjs";
import {runChatView} from './zoe-chat-test-view';
import * as memberDates from '@/lib/patient/date-format';
import * as suggestions from '@/lib/chat/suggestions';
import * as tasks from '@/lib/chat/tasks';
import {ChatSuggestions} from '@/components/conversation/chat-suggestions';
// Zoe chat composer (quality review item 9): a refused message is never lost while the member types
// another one, and a stored message stays on screen until the thread read carries it.
import {loadUrgentViews} from './zoe-urgent-test-view';
import * as cardRegistry from '@/lib/zoe-chat-actions/registry';
import * as cardCopy from '@/lib/zoe-chat-actions/copy';
import * as cardThread from '@/lib/zoe-chat-actions/thread';
import * as everydayContract from '@/lib/zoe-chat-actions/everyday-contract';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestInstance,type ReactTestRenderer} from 'react-test-renderer';
import {tx} from '@/lib/patient/copy';
import * as screen from '@/lib/zoe/member-screen';
import * as contracts from '@/lib/zoe/app-chat-contracts';
import type {ZoeThread} from '@/lib/zoe/app-chat-contracts';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const transpile=(path:string)=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const thread:ZoeThread={ok:true,version:1,ack:null,zoeReplies:false,settledSeq:0,messages:[],replies:[],answers:[]};

let keyboardOpen=false;
const cardOpens:unknown[]=[];
const cardResult:unknown={status:'failed'};
type Send=(requestId:string,text:string,toDoctor?:boolean)=>Promise<unknown>;
let send:Send=async()=>({status:'failed'});
let read:()=>Promise<ZoeThread|null>=async()=>null;
let urgentStatus:()=>Promise<{alerted:boolean;pending:boolean}|null>=async()=>null;
const drafts=new Map<string,string>();
const noop=()=>{};
const windowEvents=new Map<string,()=>void>();
const fakeWindow={scrollTo:noop,addEventListener:(name:string,fn:()=>void)=>windowEvents.set(name,fn),removeEventListener:(name:string)=>windowEvents.delete(name),setInterval:()=>0,clearInterval:noop,matchMedia:()=>({matches:false})};
const scrolls: {surface:string;top:number}[]=[];
const scroller=(surface:string)=>({scrollHeight:2000,scrollTo:({top}:{top:number})=>scrolls.push({surface,top})});
const documentScroll=scroller('document'),shellScroll=scroller('shell');
const fakeDocument={visibilityState:'visible',documentElement:{scrollHeight:0},scrollingElement:documentScroll,querySelector:()=>shellScroll,addEventListener:noop,removeEventListener:noop};
let cardFocus=0,cardScroll=0;
const createNodeMock=(element:React.ReactElement)=> (element.props as Record<string,unknown>)['data-zoe-emergency-card']!==undefined
 ?{focus:()=>cardFocus++,scrollIntoView:()=>cardScroll++}:null;
function followedNewest(since:number,why:string){
 assert.ok(scrolls.slice(since).some(s=>s.surface==='document'&&s.top===2000),`${why}: document reaches newest`);
 assert.ok(scrolls.slice(since).some(s=>s.surface==='shell'&&s.top===2000),`${why}: installed-app shell reaches newest`);
}
function noPinnedEmergency(tree:ReactTestRenderer){
 assert.equal(tree.root.findAll(n=>n.props['data-zoe-emergency-call']!==undefined).length,0,'No separate emergency banner');
 for(const a of tree.root.findAllByType('a').filter(n=>n.props.href==='tel:103')){
  assert.ok(!/sticky|fixed/.test(a.props.className??''),'103 stays in the conversation flow');
 }
 assert.ok(tree.root.findByType('form').props.className.includes('sticky'),'Composer stays available after an emergency');
}
const quick:Record<string,unknown>={};
new vm.Script(transpile('components/patient/zoe-quick-actions.tsx')).runInNewContext({exports:quick,require(name:string){
 if(name==='@/lib/patient/date-format')return memberDates;
 if(name==='react/jsx-runtime')return jsx;
 if(name==='next/link')return {default:({children,...props}:{children:React.ReactNode})=>React.createElement('a',props,children)};
 if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});
 if(name==='@/lib/patient/copy')return {tx};
 throw Error(`Unexpected boundary: ${name}`);
}});
const chat:Record<string,unknown>={};
runChatView('components/patient/zoe-chat.tsx',{exports:chat,crypto,window:fakeWindow,document:fakeDocument,setTimeout,clearTimeout,require(name:string){
 if(name==='@/components/chat-v2/reported-bp-label')return bpLabel;
 if(name==='@/lib/patient/date-format')return memberDates;
 if(name==='@/lib/member-staff-name.mjs')return memberStaffNames;
 if(name==='react/jsx-runtime')return jsx;
 if(name==='react')return React;
 if(name==='next/link')return {default:({children,...props}:{children:React.ReactNode})=>React.createElement('a',props,children)};
 if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});
 if(name==='@/lib/zoe/member-screen')return screen;
 if(name==='@/components/patient/zoe-emergency-card')return loadUrgentViews(()=>urgentStatus()).card;
 if(name==='@/components/patient/zoe-cards')return {ZoeCardView:()=>null,CARD_REPLY_LOST:'synthetic-card-reply-lost'};
 if(name==='@/components/patient/sign-in-ended')return {SignInEnded:()=>null,signInAgain:async()=>{}};
 if(name==='@/components/patient/tab-draft')return {readDraft:(name:string)=>drafts.get(name)??null,keepDraft:(name:string,value:string)=>{if(value)drafts.set(name,value);else drafts.delete(name);}};
 if(name==='@/lib/zoe-chat-actions/actions')return {openZoeCard:async(input:unknown)=>{cardOpens.push(input);return cardResult;}};
 if(name==='@/lib/zoe-chat-actions/registry')return cardRegistry;
 if(name==='@/lib/zoe-chat-actions/copy')return cardCopy;
 if(name==='@/lib/zoe-chat-actions/thread')return cardThread;
 if(name==='@/lib/chat/suggestions')return suggestions;
 if(name==='@/lib/chat/tasks')return tasks;
 if(name==='@/components/conversation/chat-suggestions')return {ChatSuggestions};
 if (name === "@/components/patient/use-chat-viewport") return { useChatFollow: () => {}, useChatViewport: () => keyboardOpen };
 if(name==='@/lib/zoe-chat-actions/everyday-contract')return everydayContract;
 if(name==='@/lib/zoe-chat-actions/everyday-actions')return {openEverydayCard:async()=>({status:'failed'})};
 if(name==='@/components/patient/zoe-quick-actions')return quick;
 if(name==='@/components/patient/zoe-attach')return {ZoeAttach:()=>null};
 if(name==='@/lib/patient/copy')return {tx};
 if(name==='@/app/patient/zoe/chat-actions')return {sendZoeChatMessage:(id:string,text:string,toDoctor?:boolean)=>send(id,text,toDoctor)};
 if(name==='@/lib/zoe/app-chat-contracts')return {...contracts,fetchZoeThread:()=>read()};
 throw Error(`Unexpected boundary: ${name}`);
}});
const Chat=chat.ZoeChat as (p:{locale:'en'|'hy'|'ru';initial:ZoeThread;upload:boolean;chatOnly?:boolean;cards?:cardRegistry.ZoeCards;emergencyCheck?:screen.ZoeEmergencyCheck|null})=>React.ReactElement;

const text=(node:ReactTestInstance|string):string=>typeof node==='string'?node:node.children.map(text).join('');
const box=(tree:ReactTestRenderer)=>tree.root.findByType('textarea');
const bubbles=(tree:ReactTestRenderer)=>tree.root.findAll(n=>n.props['data-zoe-bubble']==='pending');
async function type(tree:ReactTestRenderer,value:string){await act(async()=>box(tree).props.onChange({target:{value}}));}
async function submit(tree:ReactTestRenderer){await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault:noop}));}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
async function mount(emergencyCheck:screen.ZoeEmergencyCheck|null=null,locale:'en'|'hy'='en',initial:ZoeThread=thread,keepRecovery=false){if(!keepRecovery)drafts.clear();let tree!:ReactTestRenderer;await act(async()=>{tree=create(React.createElement(Chat,{locale,initial,upload:false,emergencyCheck}),{createNodeMock});});return tree;}

// 1. Refused while the member types another message: A stays as a "Not sent" bubble, B stays in the box.
{
 const answer=deferred<unknown>();
 send=()=>answer.promise;
 const tree=await mount();
 await type(tree,'Message A');
 await submit(tree);
 assert.equal(box(tree).props.value,'','The composer clears on send');
 await type(tree,'Message B');
 await act(async()=>{answer.resolve({status:'rate_limited'});await answer.promise;});
 assert.equal(box(tree).props.value,'Message B','The new draft is kept');
 const left=bubbles(tree);
 assert.equal(left.length,1,'The refused message stays on screen');
 assert.equal(left[0].props['data-state'],'failed');
 assert.ok(text(left[0]).includes('Message A'),'with its text');
 assert.ok(text(tree.root).includes('You sent many messages in a short time'),'and the reason');
 await act(async()=>tree.unmount());
}
// 2. Refused with an empty composer: the text goes back into the box (unchanged behaviour).
{
 send=async()=>({status:'too_long'});
 const tree=await mount();
 await type(tree,'Message A');
 await submit(tree);
 assert.equal(box(tree).props.value,'Message A','The refused text returns to an empty composer');
 assert.equal(bubbles(tree).length,0);
 await act(async()=>tree.unmount());
}
// 3. Stored, but the thread could not be read with the reply: the bubble stays until a read has it.
{
 let requestId='';
 send=async(id)=>{requestId=id;return {status:'sent',thread:null};};
 const later=deferred<ZoeThread|null>();
 read=()=>later.promise;
 const tree=await mount();
 await type(tree,'Message A');
 await submit(tree);
 assert.equal(bubbles(tree).length,1,'The stored message does not vanish when the thread read failed');
 await act(async()=>{later.resolve({...thread,messages:[{seq:1,text:'Message A',at:'2026-10-19T10:00:00Z',channel:'app',requestId}]});await later.promise;});
 assert.equal(bubbles(tree).length,0,'The bubble goes once the thread carries its request id');
 assert.ok(text(tree.root).includes('Message A'),'and the stored message shows');
 await act(async()=>tree.unmount());
}
console.log('Zoe chat keeps a refused message while another is typed, and a stored one until the thread shows it.');

// Doctor quick action visibly opens the composer and keeps its hint until a successful send.
for (const locale of ['en', 'hy'] as const) {
 let focused = 0, scrolled = 0;
 let tree!: ReactTestRenderer;
 await act(async () => { tree = create(React.createElement(Chat, {locale, initial: thread, upload: false}), {
  createNodeMock: (element) => element.type === 'textarea' ? {style: {}, scrollHeight: 44, focus: () => focused++, scrollIntoView: () => scrolled++} : null,
 }); });
 const chip = tree.root.findAllByType('button').find(n => text(n) === (locale === 'en' ? 'Write to your doctor' : 'Գրել ձեր բժշկին'))!;
 await act(async () => chip.props.onClick());
 assert.equal(scrolled, 1, 'Doctor action brings the composer into view');
 assert.equal(focused, 1, 'Doctor action focuses the composer');
 assert.equal(box(tree).props.placeholder, locale === 'en' ? 'Write to your doctor…' : 'Գրեք ձեր բժշկին…');
 send = async () => ({status: 'failed'});
 await type(tree, 'Question');
 await submit(tree);
 assert.equal(box(tree).props.placeholder, locale === 'en' ? 'Write to your doctor…' : 'Գրեք ձեր բժշկին…', 'Failed send keeps the doctor hint');
 let routedToDoctor: boolean | undefined;
 send = async (id, message, toDoctor) => { routedToDoctor = toDoctor; return {status: 'sent', thread: {...thread, zoeReplies: true, version: 1, settledSeq: 1, messages: [{seq: 1, text: message, at: new Date().toISOString(), channel: 'app', requestId: id}]}}; };
 await type(tree, 'Question again');
 await submit(tree);
 assert.equal(routedToDoctor, true, 'Doctor mode routes the stored message to the doctor');
 assert.ok(!text(tree.root).includes(locale === 'en' ? 'Zoe is writing a reply' : 'Zoe-ն պատասխան է գրում'), 'Settled doctor message never shows Zoe typing');
 assert.ok(text(tree.root).includes(locale === 'en' ? 'Sent to your doctor. They will answer here.' : 'Ուղարկված է ձեր բժշկին։ Պատասխանը կստանաք այստեղ։'), 'Doctor send confirms where the reply will appear');
 assert.equal(box(tree).props.placeholder, locale === 'en' ? 'Write to Zoe…' : 'Գրեք Zoe-ին…', 'Stored message resets the hint');
 await act(async () => tree.unmount());
}

// Emergency UI is independent of the send, thread read and model. Use the actual shared card.
const emergencyCheck=screen.zoeEmergencyCheck({enabled:true,active:true},{NOREON_ZOE_EMERGENCY_CARD:'true',NOREON_ZOE_TEST_LEXICON:'true'})!;
for(const locale of ['en','hy'] as const){
 const answer=deferred<unknown>();send=()=>answer.promise;
 read=async()=>{throw Error('read failed');};
 const tree=await mount(emergencyCheck,locale);
 const before=scrolls.length;
 await type(tree,'My chest hurts');await submit(tree);
 followedNewest(before,'Urgent send with hung request');
 assert.equal(tree.root.findAll(n=>n.props['data-zoe-emergency-card']!==undefined).length,1,'103 appears before a hung send resolves');
 assert.ok(text(tree.root).includes(locale==='en'?'Call 103 now':'Զանգահարել 103 հիմա'));
 const log=tree.root.find(n=>n.props['data-zoe-thread']!==undefined);
 assert.ok(text(log).indexOf('My chest hurts')<text(log).indexOf(locale==='en'?'Call 103 now':'Զանգահարել 103 հիմա'),'Member message precedes its inline card');
 noPinnedEmergency(tree);
 assert.ok(!text(tree.root).includes('We have told'),'No database confirmation yet');
 await act(async()=>{answer.resolve({status:'rate_limited'});await answer.promise;});
 assert.ok(text(tree.root).includes('My chest hurts'),'Refused urgent text stays in the thread');
 assert.equal(tree.root.findAll(n=>n.props['data-zoe-emergency-card']!==undefined).length,1,'Refusal and failed read cannot remove 103');
 assert.equal(box(tree).props.value,'','Composer remains usable below it');
 await act(async()=>tree.unmount());
}
// A lost response also keeps 103; the server's authoritative detection can add the card when client intake is stale.
for(const mode of ['lost','server','stored'] as const){
 send=async()=>{if(mode==='lost')throw Error('reply lost');return {status:'urgent',request:mode==='stored'?'00000000-0000-4000-8000-0000000000aa':null};};
 const tree=await mount(emergencyCheck);
 await type(tree,mode==='server'?'A new intake answer':'My chest hurts');await submit(tree);
 assert.equal(tree.root.findAll(n=>n.props['data-zoe-emergency-card']!==undefined).length,1,mode);
 assert.ok(!text(tree.root).includes('We have told'),'Unreadable status never claims team told');
 await act(async()=>tree.unmount());
}
// Reusing the same card for later sends must not move it away from its own member message.
send=async()=>({status:'urgent',request:null});
{
 const tree=await mount(emergencyCheck);
 await type(tree,'My chest hurts');await submit(tree);
 await type(tree,'I cannot breathe');await submit(tree);
 assert.equal(tree.root.findAll(n=>n.props['data-zoe-emergency-card']!==undefined).length,2,'Each urgent message retains its card');
 await act(async()=>tree.unmount());
}
console.log('Emergency card EN/HY: immediate before send, refused/lost send and read failure, server-only detection, composer available, consecutive emergencies pass. Request IO isolated.');
// A prior hung ordinary send never blocks a newly typed emergency from showing 103.
{
 const first=deferred<unknown>();send=()=>first.promise;
 const tree=await mount(emergencyCheck);
 await type(tree,'When is my visit?');await submit(tree);
 await type(tree,'My chest hurts');await submit(tree);
 assert.equal(tree.root.findAll(n=>n.props['data-zoe-emergency-card']!==undefined).length,1,'Emergency wins over an earlier hung send');
 await act(async()=>{first.resolve({status:'failed'});await first.promise;});
 await act(async()=>tree.unmount());
}
// Lost send reply: a matching stored message confirms which status to read, and a reused id with other text cannot.
for(const matches of [true,false]){
 let id='';
 send=async(requestId)=>{id=requestId;throw Error('reply lost');};
 read=async()=>({...thread,version:2,messages:[{seq:1,requestId:id,text:matches?'My chest hurts':'A different message',at:'2026-10-31T10:00:00Z',channel:'app'}]});
 const tree=await mount(emergencyCheck);
 await type(tree,'My chest hurts');await submit(tree);
 const notices=tree.root.findAll(n=>typeof n.type==='function'&&n.type.name==='ZoeUrgentNotice');
 assert.equal(notices.length,1,'Exactly one card remains');
 assert.equal(notices[0].props.request,matches?id:null,'Only this exact saved text confirms its care-status id');
 assert.ok(text(tree.root).includes('My chest hurts'),'The emergency message remains visible even if its id was refused');
 if(matches){
  let calls=0;urgentStatus=async()=>++calls===1?{alerted:false,pending:true}:{alerted:true,pending:false};
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,3100));});
  assert.ok(!text(tree.root).includes('We have told'),'Pending is neutral');
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,3100));});
  assert.ok(text(tree.root).includes('We have told'),'Lost reply followed by confirmed database alert tells the truth');
  urgentStatus=async()=>null;
 }
 await act(async()=>tree.unmount());
}

console.log("Emergency follow-ups: earlier hung send, lost reply reconciled by exact stored text, pending to database-confirmed care-team status, reused request id safety pass.");

// EC-01/02/03: exercise the actual chat, matcher and shared card. Only IO is isolated.
const regressions: [string,()=>Promise<void>][] = [
 ['EC-01 saved and failed-send recovery',async()=>{
  const id='00000000-0000-4000-8000-0000000000ec';
  const saved={...thread,messages:[{seq:1,requestId:id,text:'My chest hurts',at:new Date().toISOString(),channel:'app' as const}]};
  let sends=0;send=async()=>{sends++;return {status:'failed'};};read=async()=>null;
  let tree=await mount(emergencyCheck,'en',saved);
  try{
   assert.equal(tree.root.findAll(n=>n.props['data-zoe-emergency-card']!==undefined).length,1,'Reopen saved urgent message: restore card');
   assert.equal(tree.root.findAll(n=>typeof n.type==='function'&&n.type.name==='ZoeUrgentNotice')[0].props.request,id,'Restored saved message retains confirmed association');
   assert.equal(sends,0,'Restoring never sends or raises another alert');
  }finally{await act(async()=>tree.unmount());}
  tree=await mount(emergencyCheck);
  await type(tree,'My chest hurts');await submit(tree);
  await type(tree,'An unrelated draft');
  await act(async()=>tree.unmount());
  tree=await mount(emergencyCheck,'en',thread,true);
  try{
   assert.equal(tree.root.findAll(n=>n.props['data-zoe-emergency-card']!==undefined).length,1,'Failed urgent send survives reload alongside an unrelated draft');
   assert.equal(box(tree).props.value,'An unrelated draft');
   assert.equal(tree.root.findAll(n=>typeof n.type==='function'&&n.type.name==='ZoeUrgentNotice')[0].props.request,null,'An unsaved request cannot claim care-team notification');
   assert.equal(sends,1,'Failed-send recovery does not retry without a member action');
  }finally{await act(async()=>tree.unmount());}
 }],
 ['EC-02 stale and unavailable context with hung/failed sends',async()=>{
  for(const intake of [{enabled:true,active:false},null])for(const mode of ['hung','failed'] as const){
   send=mode==='hung'?()=>new Promise(()=>{}):async()=>{throw Error('offline');};read=async()=>null;
   const check={...emergencyCheck,intake};
   assert.equal(screen.isZoeEmergency('My BP is 190/125',check),false,'Fixture reproduces the stale snapshot');
   const tree=await mount(check);
   try{
    await type(tree,'My BP is 190/125');await submit(tree);
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1100));});
    assert.ok(tree.root.findAll(n=>n.props['data-zoe-emergency-card']!==undefined).length>0,`${mode}, ${intake?'stale':'unavailable'} context: local 103 without a server reply`);
   }finally{await act(async()=>tree.unmount());}
  }
 }],
 ['EC-02 ordinary offline text stays ordinary',async()=>{
  send=()=>new Promise(()=>{});read=async()=>null;
  const tree=await mount({...emergencyCheck,intake:null});
  try{
   await type(tree,'When is my visit?');await submit(tree);
   await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1100));});
   assert.equal(tree.root.findAll(n=>n.props['data-zoe-emergency-card']!==undefined).length,0,'An outage alone never opens an emergency card');
  }finally{await act(async()=>tree.unmount());}
 }],
 ['EC-02 intake context refresh on return',async()=>{
  send=()=>new Promise(()=>{});
  read=async()=>({...thread,emergencyCheck});
  const tree=await mount({...emergencyCheck,intake:{enabled:true,active:false}});
  try{
   await act(async()=>windowEvents.get('focus')?.());
   await type(tree,'My BP is 190/125');await submit(tree);
   assert.ok(tree.root.findAll(n=>n.props['data-zoe-emergency-card']!==undefined).length>0,'Fresh active intake shows guidance immediately, without waiting for the timeout');
  }finally{await act(async()=>tree.unmount());}
 }],
 ['EC-03 followups follow newest without a banner or card focus',async()=>{
  send=async()=>({status:'failed'});read=async()=>null;
  const tree=await mount(emergencyCheck);
  try{
   cardFocus=0;cardScroll=0;
   let before=scrolls.length;
   await type(tree,'My chest hurts');await submit(tree);
   followedNewest(before,'Urgent send');
   for(const followup of ['Es lav em','Are you there?','When is my visit?']){
    before=scrolls.length;
    await type(tree,followup);await submit(tree);
    followedNewest(before,'Followup send');
    noPinnedEmergency(tree);
   }
   assert.equal(cardFocus,0,'Emergency card never takes focus from the composer');
   assert.equal(cardScroll,0,'Emergency card never scrolls away from the newest message');
  }finally{await act(async()=>tree.unmount());}
 }],
 ['EC-04 old emergency is history on reopen and after a normal reply',async()=>{
  const saved={...thread,version:2,messages:[
   {seq:1,requestId:'00000000-0000-4000-8000-0000000000ec',text:'My chest hurts',at:'2026-10-30T15:16:00Z',channel:'app' as const},
   {seq:2,requestId:'00000000-0000-4000-8000-0000000000ed',text:'Es lav em',at:'2026-10-30T21:29:00Z',channel:'app' as const},
  ],answers:[]};
  const before=scrolls.length;
  const tree=await mount(emergencyCheck,'hy',saved);
  try{
   followedNewest(before,'Reopen with an old emergency');
   noPinnedEmergency(tree);
   assert.equal(tree.root.findAllByType('a').filter(n=>n.props.href==='tel:103').length,1,'Only the historical card has a call action');
   const log=tree.root.find(n=>n.props['data-zoe-thread']!==undefined);
   assert.ok(text(log).indexOf('Զանգահարել 103 հիմա')<text(log).indexOf('Es lav em'),'Card stays at the original message');
   // A new answer replaces the acknowledgement (same number of chat items): counts alone miss it.
   read=async()=>({...saved,version:3,answers:[{id:'00000000-0000-4000-8000-0000000000ef',text:'Your newest reply',at:'2026-10-30T21:29:01Z'}]});
   const reply=scrolls.length;
   await act(async()=>windowEvents.get('focus')?.());
   followedNewest(reply,'Newly received reply');
   assert.ok(text(log).includes('Your newest reply'));
  }finally{await act(async()=>tree.unmount());}
 }],
];
let failed=0;
for(const [name,run] of regressions){try{await run();console.log(`PASS ${name}`);}catch(error){failed++;console.error(`FAIL ${name}:`,(error as Error).message);}}
assert.equal(failed,0,`${failed}/${regressions.length} emergency-card regression groups failed`);
console.log(`${regressions.length}/${regressions.length} emergency-card regression groups passed`);

// The suggestion is a real message. Exercise the actual component and normal send port in all languages.
for(const locale of ['en','hy','ru'] as const){
 drafts.clear();cardOpens.length=0;
 const state:suggestions.SuggestionState={locale,consent:true,emergency:false,safetyHold:false,medicineDue:true,bpDue:true,visitProposal:true,visitToBook:true,planToRead:true,resultsToRead:true,doctorReply:true};
 const initial={...thread,suggestionState:state};
 const response=deferred<unknown>();const sent:{id:string;text:string}[]=[];
 send=async(id,text)=>{sent.push({id,text});return response.promise;};read=async()=>null;
 let tree!:ReactTestRenderer;
 const props={locale,initial,upload:false,chatOnly:true,cards:{enabled:true,cards:[],clearedSeq:null}};
 await act(async()=>{tree=create(React.createElement(Chat,props));});
 const strip=()=>tree.root.findByProps({'data-chat-suggestions':true});
 assert.equal(strip().findAllByType('button').length,1,'An empty conversation offers one first step');
 await type(tree,'Draft stays mine');
 assert.equal(strip().props['aria-hidden'],true,'Typing hides the suggestions without moving the input');
 await type(tree,'');
 keyboardOpen=true;
 await act(async()=>tree.update(React.createElement(Chat,{...props,upload:true})));
 assert.equal(strip().props['aria-hidden'],true,'Keyboard hides suggestions');
 keyboardOpen=false;
 await act(async()=>tree.update(React.createElement(Chat,props)));
 let prevented=false;
 const button=strip().findAllByType('button')[0]!;
 button.props.onPointerDown({preventDefault(){prevented=true;}});
 assert.ok(prevented,'Press cannot blur the input and move the target under the finger');
 await act(async()=>{button.props.onClick();button.props.onClick();});
 assert.equal(sent.length,0,'An exact task never sends a doctor acknowledgement or starts a pipeline run');
 assert.equal(cardOpens.length,1,'Immediate repeated presses share a card open');
 assert.equal((cardOpens[0] as {kind:string}).kind,'dose');
 // An earlier message may still be pending, or its pipeline run held indefinitely.
 await type(tree,'An ordinary question');
 await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.equal(sent.length,1);
 await act(async()=>strip().findAllByType('button')[0].props.onClick());
 assert.equal(cardOpens.length,2,'A pending message never blocks a task control');
 for (const task of Object.keys(tasks.CHAT_TASKS) as tasks.ChatTask[]) {
   await type(tree,tasks.CHAT_TASKS[task].text[locale]);
   await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
   assert.equal((cardOpens.at(-1) as {kind:string}).kind,tasks.CHAT_TASKS[task].kind);
   assert.equal(sent.length,1,'Held runs do not receive task messages');
 }
 await act(async()=>response.resolve({status:'rate_limited'}));
 assert.equal(box(tree).props.value,'An ordinary question','The ordinary send keeps existing refusal/draft recovery');
 await act(async()=>tree.unmount());
 drafts.clear();cardOpens.length=0;
 const message={seq:1,text:tasks.CHAT_TASKS.plan.text[locale],at:new Date().toISOString(),channel:'app' as const,requestId:crypto.randomUUID()};
 await act(async()=>{tree=create(React.createElement(Chat,{...props,initial:{...initial,messages:[message]},cards:{enabled:true,cards:[],clearedSeq:1}}));});
 assert.equal(cardOpens.length,0,'Reopening old task messages never posts a card');
 await act(async()=>tree.unmount());
 for(const guard of [{emergency:true},{safetyHold:true},{consent:false}]){
  drafts.clear();
  await act(async()=>{tree=create(React.createElement(Chat,{...props,initial:{...initial,suggestionState:{...state,...guard}}}));});
  assert.equal(tree.root.findAllByProps({'data-chat-suggestions':true}).length,0);
  await act(async()=>tree.unmount());
 }
}
console.log('Exact tasks: direct card open even with pending/held run; no sends or replay on reload; single-flight, keyboard/typing hiding and safety gates in EN/HY/RU.');
