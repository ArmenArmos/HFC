/** Local component and supplied-IO regressions for the 7 November member audit. */
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup as render} from 'react-dom/server';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import * as registry from '@/lib/zoe-chat-actions/registry';
import {dialogThread} from '@/lib/zoe-chat-actions/thread';
import {LIVING_VISIT} from '@/lib/zoe-chat-actions/living-visit';
import {doctorNoticeText} from '@/lib/chat/doctor-note';
import {NEXT_STEP} from '@/lib/zoe-chat-actions/next-step-copy';
import {chatItems} from '@/lib/zoe/app-chat-contracts';
import {MemberChat} from '@/components/chat-v2/member-chat';
import {FirstNoteCard} from '@/components/patient-care/first-note-card';
import type {ZoeThread} from '@/lib/zoe/app-chat-contracts';
import type {MemberBookingData} from '@/lib/real-booking/schema';
import type {PilotBookingData} from '@/lib/real-booking/appointment-schema';
import type {MemberPricing} from '@/components/pilot-commerce/member-pricing';

globalThis.fetch=(()=>{throw Error('Network forbidden in member polish check');}) as typeof fetch;
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id='00000000-0000-4000-8000-000000000001',at='2026-11-07T09:00:00Z';
const visit=registry.cardSchema.parse({id,requestId:id,source:'chip',sourceSeq:null,kind:'visit',state:'done',claims:{},outcome:{[`visit:${id}:awaiting`]:{status:'awaiting',doneAt:at}},at,
 snapshot:{v:1,available:true,next:null,proposal:null,attention:false,living:{visitId:id,source:'appointment',revision:1,status:'awaiting',startsAt:null,location:null,preparation:null,planId:null}}});
assert.ok(visit.valid&&visit.kind==='visit');
const emptyThread:ZoeThread={ok:true,version:1,ack:null,zoeReplies:true,settledSeq:0,messages:[],replies:[],answers:[],notices:[]};
const locales=['en','hy','ru'] as const;
let failures=0;
async function check(name:string,run:()=>unknown){try{await run();console.log(`PASS ${name}`);}catch(error){failures++;console.error(`FAIL ${name}: ${error instanceof Error?error.message:error}`);}}
const chat=(locale:typeof locales[number],cards:registry.ZoeCards,thread=emptyThread)=>render(React.createElement(MemberChat,{locale,memberName:'Synthetic member',revision:0,initial:thread,cards,onboarding:{profileRequest:null},overview:true}));

// Keep the production module; replace session, database and side-effect ports only.
function isolated(file:string,boundaries:Record<string,unknown>,env:Record<string,string|undefined>={}){
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,process:{env},console,require(name:string){assert.ok(name in boundaries,`Unexpected dependency ${name}`);return boundaries[name];}});
 return exports;
}
// Render the real notice JSX with inert browser hooks and capture the Speaker boundary.
let speakerText:string|undefined;
const noop=()=>null;
const noticeBoundaries=Object.fromEntries([...readFileSync('components/chat-v2/member-chat.tsx','utf8').matchAll(/from ['"]([^'"]+)['"]/g)].map(m=>[m[1],new Proxy({},{get:()=>noop})]));
const {MemberChat:NoticeChat}=isolated('components/chat-v2/member-chat.tsx',{
 ...noticeBoundaries,react:React,'react/jsx-runtime':jsx,
 '@/lib/chat/doctor-note':await import('@/lib/chat/doctor-note'),
 '@/lib/zoe-chat-actions/thread':await import('@/lib/zoe-chat-actions/thread'),
 '@/lib/patient/copy':await import('@/lib/patient/copy'),
 '@/lib/patient/date-format':await import('@/lib/patient/date-format'),
 '@/lib/member-staff-name.mjs':await import('@/lib/member-staff-name.mjs'),
 '@/components/patient/use-zoe-thread':{useZoeThread:({initial}:{initial:ZoeThread})=>({items:chatItems(initial),cards:registry.NO_CARDS,thread:initial,emergencies:{},localEmergencies:{},shown:[],input:{current:null},text:''})},
 './use-thread-scroll':{useThreadScroll:()=>({threadRef:{current:null},contentRef:{current:null}})},
 './speaker':{VoicePlayback:({children}:{children:React.ReactNode})=>children,Speaker:({text}:{text:string})=>{speakerText=text;return null;}},
}) as {MemberChat:typeof MemberChat};
const serverFile='lib/zoe-chat-actions/server.ts';
const unused=Object.fromEntries([...readFileSync(serverFile,'utf8').matchAll(/from ['"]([^'"]+)['"]/g)].map(m=>[m[1],{}]));
const {syncLivingVisit}=isolated('lib/zoe-chat-actions/living-visit-read.ts',{'server-only':{},zod:await import('zod'),'./registry':registry}) as typeof import('../lib/zoe-chat-actions/living-visit-read');
const ordinaryVisit=registry.cardSchema.parse({...visit,snapshot:{v:1,available:true,next:null,proposal:null,attention:false}});
assert.ok(ordinaryVisit.valid&&ordinaryVisit.kind==='visit'&&!ordinaryVisit.snapshot.living);
let stored:registry.ZoeCard[]=[],syncResult:unknown={ok:true,card:null},syncThrows=false,cardsFail=false;
const syncEnv:Record<string,string|undefined>={NOREON_MEMBER_CHAT_V2:'true',NEXT_PUBLIC_SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic'};
const syncFailures:{event:string;fields:Record<string,unknown>}[]=[];
const {readZoeCards}=isolated(serverFile,{...unused,'server-only':{},zod:await import('zod'),'./registry':registry,
 '@/lib/observability/logger':{log:{error:(event:string,fields:Record<string,unknown>)=>{syncFailures.push({event,fields});}},errorFields:(error:{code?:unknown})=>({error_code:error.code})},
 '@/lib/patient/zoe-app-v3':{zoeAppV3Enabled:()=>true},
 './living-visit-read':{syncLivingVisit},
 './living-visit':isolated('lib/zoe-chat-actions/living-visit.ts',{zod:await import('zod'),'./registry':registry,'./living-visit-copy':{LIVING_VISIT}}),
 '@supabase/supabase-js':{createClient:()=>({rpc:async()=>{if(syncThrows)throw Error('Synthetic RPC failure');return {data:syncResult,error:null};}})},
 '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:{id}}})},rpc:async(name:string)=>{
  if(name==='zoe_chat_cards_member')return cardsFail?{data:null,error:{code:'synthetic'}}:{data:{ok:true,enabled:true,cards:stored,clearedSeq:null,readingSeq:null},error:null};
  if(name==='zoe_bp_open_emergencies')return {data:{cards:[],clearedAt:null},error:null};
  throw Error(`Unexpected read ${name}`);
 }})},'./bp-flow':{withOpenEmergencies:(cards:unknown)=>cards,memberTasks:async()=>null},
 './bp-flow-server':{retryRedMessages:async()=>{}},'./next-step-read':{reconcileNextStep:async(read:unknown)=>read},
},syncEnv) as typeof import('../lib/zoe-chat-actions/server');

await check('E3 supplied IO distinguishes no visit from an existing visit refresh failure',async()=>{
 stored=[];syncResult={ok:true,card:null};
 assert.equal(await syncLivingVisit(async()=>syncResult,id),null,'The SQL no-visit response is accepted');
 assert.equal((await readZoeCards()).visitStatusUnavailable??false,false,'Confirmed absence is quiet');
 syncResult={ok:false,code:'disabled'};
 assert.equal(await syncLivingVisit(async()=>syncResult,id),null,'An ineligible member has no living card');
 const disabled=await readZoeCards();
 assert.equal(disabled.visitStatusUnavailable??false,false,'Disabled sync is quiet');
 assert.equal(disabled.cards.length,0,'Disabled sync adds no card');
 assert.equal(syncFailures.length,0,'Disabled sync is not logged as a failure');
 for(const locale of locales)assert.ok(!chat(locale,disabled).includes(LIVING_VISIT.unavailable[locale]),`${locale}: disabled sync shows no visit warning`);
 stored=[visit];syncResult={ok:false,code:'disabled'};
 const staleVisit=await readZoeCards();
 assert.equal(staleVisit.visitStatusUnavailable,true,'A stored living visit that cannot refresh keeps the warning');
 for(const locale of locales)assert.ok(chat(locale,staleVisit).includes(LIVING_VISIT.unavailable[locale]),`${locale}: stored visit with disabled sync shows the warning`);
 stored=[];syncResult={ok:false,code:'disabled'};
 for(const cards of [[],[ordinaryVisit],[visit]]){
  stored=cards;
  for(const [result,code] of [
   [{ok:false,code:'unavailable'},'rpc_unavailable'],
   [{ok:false,code:'stale'},'rpc_stale'],
   [{ok:false,code:'a'.repeat(24)},'rpc_'+'a'.repeat(24)],
   [{ok:false},'not_ok'],
   ...['','a'.repeat(25),'UPPER','invalid-code','member@example.test','stale\n',42,null].map(code=>[{ok:false,code},'not_ok']),
   [{ok:false,code:'disabled',extra:true},'rpc_disabled'],
   [null,'shape'],
   [{ok:'false',code:'disabled'},'shape'],
   [{ok:true,card:{invalid:true}},'shape'],
   [{ok:true,card:ordinaryVisit},'card'],
  ] as const){
   syncResult=result;
   await assert.rejects(()=>syncLivingVisit(async()=>syncResult,id),{message:'Visit status unavailable',code});
   syncFailures.length=0;
   assert.equal((await readZoeCards()).visitStatusUnavailable,true,'Failed sync never proves absence, even before a living card exists');
   assert.equal(syncFailures.length,1);
   assert.equal(syncFailures[0].event,'living_visit.sync_failed');
   assert.equal(syncFailures[0].fields.error_code,code,'The failure log retains only a safe cause code');
  }
  syncThrows=true;
  syncFailures.length=0;
  assert.equal((await readZoeCards()).visitStatusUnavailable,true,'RPC exceptions retain the warning');
  assert.equal(syncFailures[0].fields.error_code,'rpc','Thrown RPC failures have a fixed code');
  syncThrows=false;delete syncEnv.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal((await readZoeCards()).visitStatusUnavailable,true,'Missing service RPC retains the warning');
  syncEnv.SUPABASE_SERVICE_ROLE_KEY='synthetic';
 }
 cardsFail=true;syncThrows=true;
 assert.equal((await readZoeCards()).visitStatusUnavailable,true,'A failed cards read cannot erase the failed visit sync');
 cardsFail=false;syncThrows=false;
 syncResult={ok:true,card:visit};
 assert.equal((await readZoeCards()).visitStatusUnavailable??false,false,'A successful visit read is quiet');
});
for(const locale of locales){
 await check(`E3 ${locale}: only confirmed absence hides visit warning`,()=>{
  assert.ok(!chat(locale,{enabled:true,cards:[],clearedSeq:null}).includes(LIVING_VISIT.unavailable[locale]));
  for(const cards of [[],[ordinaryVisit],[visit]])assert.ok(chat(locale,{enabled:true,cards,clearedSeq:null,visitStatusUnavailable:true}).includes(LIVING_VISIT.unavailable[locale]));
 });
 await check(`E23 ${locale}: stored notices are cleaned and plan-ready follows the UI language`,()=>{
  const prefix='UNAPPROVED PLACEHOLDER. ';
  const plans=['Your care plan is ready. Open Noreon to read it.','Ձեր խնամքի ծրագիրը պատրաստ է։ Բացեք Նորեոն Հելթը՝ այն կարդալու համար։'];
  const others=['Your care plan was updated. Open Noreon to see what changed.','Ձեր խնամքի ծրագիրը թարմացվել է։ Բացեք Նորեոն Հելթը՝ փոփոխությունները տեսնելու համար։','Your samples are at the lab.','Այլ ծանուցում։','Keep these trailing spaces.  ',plans[0]+' Extra context.'];
  for(const body of [...plans,...others])for(const label of ['',prefix]){
   const expected=plans.includes(body)?NEXT_STEP.plan[locale]:body;
   const thread={...emptyThread,notices:[{id,text:label+body,at,closed:false}]};
   const html=chat(locale,registry.NO_CARDS,thread);
   assert.ok(html.includes(expected));
   assert.ok(!html.includes(prefix));
   speakerText=undefined;
   render(React.createElement(NoticeChat,{locale,memberName:'Synthetic member',revision:0,initial:thread,cards:registry.NO_CARDS,overview:true}));
   assert.equal(speakerText,expected,'Listen receives the same cleaned, localized notice');
  }
 });
 await check(`E10 ${locale}: one living card, no duplicate status turn`,()=>{
  const html=chat(locale,{enabled:true,cards:[visit],clearedSeq:null});
  assert.equal((html.match(/data-zoe-card="visit"/g)??[]).length,1);
  assert.ok(!html.includes(`>${LIVING_VISIT.open[locale]}</button>`),'The status already on the living card needs no second chat bubble');
 });
 await check(`E7 ${locale}: doctor-notice chrome follows UI language, body is unchanged`,()=>{
  const body='Typed English note.\nKeep this exact line:  x < y & z.';
  const title={en:'Note from your doctor',hy:'Ձեր բժշկի նշումը',ru:'Заметка вашего врача'};
  for(const original of locales){
   const thread={...emptyThread,notices:[{id,text:`${title[original]}\n${body}`,at,closed:false}]};
   const html=chat(locale,registry.NO_CARDS,thread);
   assert.ok(html.includes(`${title[locale]}\nTyped English note.\nKeep this exact line:  x &lt; y &amp; z.`));
  }
  const note={textEn:'English original',textHy:'Հայերեն բնագիր',approvedAt:at,doctorName:'Synthetic doctor'};
  const html=render(React.createElement(FirstNoteCard,{note,locale}));
  assert.ok(html.includes(locale==='en'?'A note from Synthetic doctor':locale==='hy'?'Գրառում՝ Synthetic doctor':'Сообщение от Synthetic doctor'));
  assert.ok(html.includes(locale==='en'?note.textEn:note.textHy),'First-note card keeps its existing stored body selection');
 });
}
await check('E10 current card suppresses older living cards and older transitions',()=>{
 const older={...visit,id:'00000000-0000-4000-8000-000000000002',at:'2026-11-06T09:00:00Z'};
 const entries=dialogThread([],[older,visit],true);
 assert.equal(entries.filter(e=>e.type==='card'&&e.card.kind==='visit').length,1);
 assert.equal(entries.filter(e=>e.type==='turn'&&e.card.kind==='visit').length,0);
 const advanced={...visit,outcome:{...visit.outcome,[`visit:${id}:confirmed`]:{status:'confirmed',doneAt:'2026-11-07T10:00:00Z'}}};
 assert.equal(dialogThread([],[advanced],true).filter(e=>e.type==='turn').length,1,'A different later transition not yet on the card remains visible');
 const caughtUp={...advanced,snapshot:{...advanced.snapshot,living:{...advanced.snapshot.living!,status:'confirmed' as const,startsAt:'2026-11-08T10:00:00Z'}}};
 assert.equal(dialogThread([],[caughtUp],true).filter(e=>e.type==='turn').length,0,'The extra line disappears when the card shows that status');
});
await check('E7 other text and note bodies are never rewritten',()=>{
 for(const locale of locales)for(const text of ['Unrelated notice\nNote from your doctor','Note from your doctor','  Note from your doctor\nBody'])assert.equal(doctorNoticeText(text,locale),text);
});

// Actual booking/form components with inert actions and router, never a real service.
const native=createRequire(import.meta.url),cache=new Map<string,Record<string,unknown>>();
function load(file:string):Record<string,unknown>{
 file=resolve(file);if(cache.has(file))return cache.get(file)!;
 const exports:Record<string,unknown>={};cache.set(file,exports);
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,process:{env:{}},crypto:globalThis.crypto,FormData,Date,Intl,console,require(name:string):unknown{
  if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;
  if(name==='next/navigation')return {useRouter:()=>({refresh(){}})};
  if(name==='next/link')return {default:({children,...props}:React.ComponentProps<'a'>)=>React.createElement('a',props,children)};
  if(name==='@/lib/real-booking/actions')return {memberBookingCommand:async()=>{throw Error('Unexpected booking write');}};
  if(name==='@/components/ui/select-field')return {SelectField:()=>null};
  if(name.startsWith('@/')||name.startsWith('.')){
   const path=name.startsWith('@/')?resolve(name.slice(2)):resolve(dirname(file),name);
   for(const ext of ['','.tsx','.ts','.mjs'])if(existsSync(path+ext))return load(path+ext);
  }
  return native(name);
 }});return exports;
}
const {HomeVisitRequest,RealMemberBooking}=load('components/real-booking/member.tsx') as typeof import('../components/real-booking/member');
const {PilotMemberBooking}=load('components/real-booking/pilot-member.tsx') as typeof import('../components/real-booking/pilot-member');
const {ScheduleSettingsForm}=load('components/clinic-portal/schedule-settings.tsx') as typeof import('../components/clinic-portal/schedule-settings');
const requirements=[{id:'lipid_panel',title:'Lipid profile',method:'lab' as const}];
const homeData:MemberBookingData={available:true,homeRequestAvailable:true,requirements,homeTasks:[],requests:[],contextToken:'a'.repeat(64)};
const pilotData:PilotBookingData={available:true,unavailableReason:null,program:requirements.map(r=>({...r,preparation:''})),appointments:[],offers:[]};
const pricing:MemberPricing={catalog:[{testKey:'lipid_panel',nameEn:'Lipid profile',nameHy:'Լիպիդային պրոֆիլ',priceAmd:6000,includedInPackage:false,priceSource:'staging-placeholder'}],payments:[]};
const action=async()=>({ok:false,code:'invalid' as const});
for(const locale of locales)await check(`E8 ${locale}: clinic and home choice each show one price list`,async()=>{
 let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(React.createElement(PilotMemberBooking,{locale,data:pilotData,pricing,commandId:id,changeCommandIds:{},selectAction:action,changeAction:action,refreshHref:'/patient/service',homeVisit:React.createElement(HomeVisitRequest,{data:homeData,locale,pricing,testsShownAbove:true})}));});
 try{
  assert.equal(tree.root.findAllByProps({'data-pilot-prices':true}).length,1);
  for(const value of ['clinic','home']){
   await act(async()=>tree.root.findByProps({type:'radio',value}).props.onChange());
   assert.equal(tree.root.findAllByProps({'data-pilot-prices':true}).length,1,`${value}: only the shared price list`);
  }
 }finally{await act(async()=>tree.unmount());}
});
for(const locale of locales)await check(`E8 ${locale}: an open home request owns the page's price list`,()=>{
 const data:MemberBookingData={...homeData,legacyCreationAvailable:false,requests:[{id,revision:1,status:'requested',requestedTerms:{startsAt:'2026-11-08T10:00:00Z',timezone:'Asia/Yerevan',mode:'home',location:'Synthetic address'},requirements,algorithmVersion:'synthetic',contextToken:'a'.repeat(64),contextStale:false,proposal:null,currentArrangement:null,pendingChange:null,createdAt:at}]};
 const html=render(React.createElement(React.Fragment,null,
  React.createElement(PilotMemberBooking,{locale,data:{...pilotData,available:false,unavailableReason:'legacy-reconciliation'},pricing,homeRequestOpen:true,commandId:id,changeCommandIds:{},selectAction:action,changeAction:action,refreshHref:'/patient/service'}),
  React.createElement(RealMemberBooking,{locale,data,pricing})));
 assert.equal((html.match(/data-pilot-prices="true"/g)??[]).length,1);
});
for(const locale of locales)await check(`E9 ${locale}: empty preparation has a plain required message`,async()=>{
 let tree!:ReactTestRenderer,writes=0;
 await act(async()=>{tree=create(React.createElement(ScheduleSettingsForm,{locale,settings:{version:'clinic-schedule-settings-v1',enabled:true,canEdit:true,clinic:{name:'Synthetic clinic',address:'Synthetic address'},schedule:{active:false,revision:1,slotMinutes:30,capacity:1,coveredTestIds:['lipid_panel'],followUpTestIds:[],preparation:'',updatedAt:at,hours:[]}},save:async()=>{writes++;return {status:'unavailable' as const};}}));});
 try{
  await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(writes,0,'Empty preparation is rejected before save');
  const alert=tree.root.findByProps({role:'alert'});
  assert.ok(JSON.stringify(alert.children).includes({en:'Enter the preparation',hy:'Մուտքագրեք',ru:'Укажите подготовку'}[locale]));
  await act(async()=>tree.root.findByType('textarea').props.onChange({target:{value:'  '}}));
  await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(writes,0,'Whitespace is empty too');
  await act(async()=>tree.root.findByType('textarea').props.onChange({target:{value:'Synthetic preparation'}}));
  await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(writes,1,'Filling preparation permits the existing save path');
 }finally{await act(async()=>tree.unmount());}
});
assert.equal(failures,0,`${failures} member polish checks failed`);
