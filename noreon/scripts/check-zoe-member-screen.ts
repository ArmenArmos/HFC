/**
 * The member Zoe screen (founder feedback 17 Oct) while real AI calls are off:
 * 1. nothing it imports, directly or transitively, can reach a model, the AI Gateway or the Zoe pipeline;
 * 2. typed text with urgent words opens the 103 screen, red always wins, and nothing else is read as safe;
 * 3. the 103 screen keeps Call 103 first with only the Get help exit and says the care team was told only when the database says so;
 * 4. the common-question answers are existing approved texts, still present where they came from;
 * 5. Home leads with one next step and shows every section directly (Khikar, 18 Oct: no More fold).
 */
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {dirname,join,normalize} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {tx} from '@/lib/patient/copy';
import {loadUrgentViews} from './zoe-urgent-test-view';
import * as screen from '@/lib/zoe/member-screen';

const TEST={NOREON_ZOE_TEST_LEXICON:'true'};

// 1. Import graph: no model, gateway, provider or pipeline module, and no AI SDK package.
// The app chat (chat-actions, zoe-chat, app-chat) stores text and reads the thread; the Zoe pipeline
// runs only in the sweep, on stored messages, so no member request reaches it either.
const ENTRIES=['app/patient/zoe/page.tsx','app/patient/zoe/actions.ts','app/patient/zoe/chat-actions.ts','app/patient/zoe/urgent/page.tsx','app/patient/zoe/urgent/content.tsx','components/patient/zoe-emergency-card.tsx','app/patient/zoe/urgent/notice.tsx','app/patient/zoe/urgent/actions.ts','components/patient/zoe-chat.tsx','lib/zoe/member-screen.ts','lib/zoe/app-chat.ts','lib/zoe/app-chat-contracts.ts'];
const DENIED_FILES=/^lib\/(zoe\/(gateway|provider|pipeline|server|routing|route-config|settings-actions|settings-core|scope|output-guard|seal)|reports\/(provider|server)|zoe-synthetic\/)/;
const DENIED_PACKAGES=/^(ai|openai|@ai-sdk\/.*|@anthropic-ai\/.*|@vercel\/ai.*|@google\/genai|groq-sdk)$/;
const resolveLocal=(from:string,spec:string)=>{
 const base=spec.startsWith('@/')?spec.slice(2):spec.startsWith('.')?normalize(join(dirname(from),spec)):null;
 if(base===null)return null;
 for(const candidate of [base,`${base}.ts`,`${base}.tsx`,`${base}/index.ts`,`${base}/index.tsx`])if(existsSync(candidate)&&!candidate.endsWith('/'))try{readFileSync(candidate,'utf8');return candidate;}catch{/* directory */}
 return null;
};
const seen=new Set<string>(),packages=new Set<string>();
const walk=(file:string)=>{
 if(seen.has(file))return;seen.add(file);
 const source=readFileSync(file,'utf8');
 for(const m of source.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|^import\s*['"]([^'"]+)['"]/gm)){
  const spec=(m[1]??m[2]??m[3])!;
  const local=resolveLocal(file,spec);
  if(local)walk(local);else if(!spec.startsWith('@/')&&!spec.startsWith('.'))packages.add(spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0]!);
 }
};
for(const entry of ENTRIES)walk(entry);
assert.ok(seen.size>20,'The import walk reached the shell and its dependencies');
const deniedFiles=[...seen].filter(f=>DENIED_FILES.test(f));
assert.deepEqual(deniedFiles,[],'No Zoe screen module reaches a model, gateway, provider or pipeline file');
assert.deepEqual([...packages].filter(p=>DENIED_PACKAGES.test(p)),[],'No AI SDK package is imported');
for(const entry of ENTRIES)assert.doesNotMatch(readFileSync(entry,'utf8'),/\bfetch\(|generateText|streamText|callReportModel|gatewayModel/,`${entry} makes no network or model call`);

// 2. Routing: urgent words win; otherwise the doctor flow; nothing is "safe".
for(const text of ['I have chest pain since this morning','Can I move my visit? Also my chest hurts a lot','կրծքավանդակի ցավ ունեմ','болит в груди','I cannot breathe'])
 assert.equal(screen.zoeTextRoute(text,TEST),'urgent',`urgent: ${text}`);
assert.equal(screen.zoeTextRoute(`${'Can I move my visit to Monday? '.repeat(90)} my chest hurts`,TEST),'urgent','Over-long text is screened in full: red still wins');
for(const text of ['Can I move my visit to Monday?','I have no chest pain today','Where do I upload my results?'])
 assert.equal(screen.zoeTextRoute(text,TEST),'doctor',`doctor flow: ${text}`);
assert.equal(screen.zoeTextRoute('   ',TEST),'empty');
// Default environment: the S1 list is unsigned, so nothing matches and nothing is called safe either.
assert.equal(screen.zoeTextRoute('I have chest pain',{}),'doctor','Unsigned list never invents a match and still routes to a person');

// The server action: urgent redirects to the 103 screen before length or anything else; no fetch.
const transpile=(path:string)=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const originalFetch=globalThis.fetch;let fetchCalls=0;
globalThis.fetch=(async()=>{fetchCalls++;throw Error('No network in the Zoe screen');}) as typeof fetch;
const originalLexicon=process.env.NOREON_ZOE_TEST_LEXICON;process.env.NOREON_ZOE_TEST_LEXICON='true';
try{
 const exports:Record<string,unknown>={};let authCalls=0;
 new vm.Script(transpile('app/patient/zoe/actions.ts')).runInNewContext({exports,process,require(name:string){if(name==='@/lib/observability/with-logging')return {loggedAction:(_action:string,run:unknown)=>run,withRouteLogging:(handler:unknown)=>handler,logSweep:()=>{}};
  if(name==='next/navigation')return {redirect:(to:string)=>{throw Error(`redirect:${to}`);}};
  if(name==='@/lib/patient/auth')return {requirePatient:async()=>{authCalls++;return {userId:'fictional'};}};
  if(name==='@/lib/zoe/member-screen')return screen;
  throw Error(`Unexpected boundary: ${name}`);
 }});
 const route=exports.routeZoeText as (s:unknown,f:FormData)=>Promise<{route:string}>;
 const form=(text:string)=>{const f=new FormData();f.set('message',text);return f;};
 await assert.rejects(route({route:'idle',at:0},form('My chest hurts and my face is drooping')),/redirect:\/patient\/zoe\/urgent/,'Urgent words open the 103 screen');
 await assert.rejects(route({route:'idle',at:0},form(`${'x'.repeat(screen.ZOE_TEXT_MAX+50)} chest pain`)),/redirect:\/patient\/zoe\/urgent/,'Red wins over the length limit');
 assert.equal((await route({route:'idle',at:0},form('Can I move my visit?'))).route,'doctor');
 assert.equal((await route({route:'idle',at:0},form('x'.repeat(screen.ZOE_TEXT_MAX+1)))).route,'too_long');
 assert.equal((await route({route:'idle',at:0},form(''))).route,'empty');
 assert.equal(authCalls,5,'Every call requires a signed-in member');
}finally{
 globalThis.fetch=originalFetch;
 if(originalLexicon===undefined)delete process.env.NOREON_ZOE_TEST_LEXICON;else process.env.NOREON_ZOE_TEST_LEXICON=originalLexicon;
}
assert.equal(fetchCalls,0,'The Zoe action makes no network call');

// 3. The 103 screen for typed text.
let locale:'en'|'hy'='en',signedIn=true,zoeStatus:{alerted:boolean;pending:boolean}|undefined|'slow'={alerted:false,pending:false};
const urgentExports:Record<string,unknown>={};
new vm.Script(transpile('app/patient/zoe/urgent/page.tsx')).runInNewContext({exports:urgentExports,setTimeout,require(name:string){if(name==='@/lib/observability/with-logging')return {loggedAction:(_action:string,run:unknown)=>run,withRouteLogging:(handler:unknown)=>handler,logSweep:()=>{}};
 if(name==='react/jsx-runtime')return jsx;
 if(name==='@/components/patient-care/member-screens')return {MemberScreen:({children}:{children:React.ReactNode})=>children};
 if(name==='@/lib/patient/member-screens-config')return {memberScreensPrototypeEnabled:()=>false};
 if(name==='next/link')return {default:({children,...props}:{children:React.ReactNode})=>React.createElement('a',props,children)};
 if(name==='@/components/patient/document-language')return {PatientDocumentLanguage:()=>null};
 if(name==='@/lib/patient/auth')return {patientIdentity:async()=>signedIn?{userId:'fictional'}:null};
 if(name==='@/lib/patient/repository')return {getPatientState:async()=>({profile:{name:'Fictional',locale}})};
 if(name==='@/lib/patient/copy')return {tx};
 if(name==='./content')return loadUrgentViews().content;
 if(name==='@/lib/care-alerts/member')return {careAlertMemberStatus:(request?:string)=>zoeStatus==='slow'?new Promise(()=>{}):Promise.resolve(signedIn&&zoeStatus!==undefined?{ok:true,alertsEnabled:true,alerted:false,alertedAt:null,zoe:request?zoeStatus:null}:null)};
 throw Error(`Unexpected boundary: ${name}`);
}});
const urgentPage=(request:string|undefined='fictional-request')=>(urgentExports.default as (p:{searchParams:Promise<{request?:string}>})=>Promise<React.ReactElement>)({searchParams:Promise.resolve({request})});
// A session that ended while urgent words were typed still gets the screen, in Armenian (Astra TG-R1).
signedIn=false;
{const html=renderToStaticMarkup(await urgentPage());
 assert.ok(html.includes('href="tel:103"'),'No session: Call 103 is there');
 assert.ok(html.includes('Անհրաժեշտ է շտապ օգնություն'),'No session: Armenian guidance');
 assert.ok(!/չեն ծանուցվել|տեղեկացրել ենք/.test(html),'No session: no claim either way');}
signedIn=true;
for(locale of ['en','hy'] as const){
 const html=renderToStaticMarkup(await urgentPage());
 const links=[...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(links,['tel:103','/patient/help'],`${locale}: Call 103 first, only the Get help exit`);
 assert.ok(html.includes(locale==='en'?'Call 103 now':'Զանգահարել 103 հիմա'));
 const notTold=locale==='en'?'has not been notified':'չեն ծանուցվել',told=locale==='en'?'We have told the Noreon care team':'տեղեկացրել ենք';
 const render=async()=>renderToStaticMarkup(await urgentPage());
 assert.ok(html.includes(notTold)&&!html.includes(told),`${locale}: settled with no alert: not told`);
 zoeStatus={alerted:true,pending:false};
 {const h=await render();
  assert.ok(h.includes(told)&&!h.includes(notTold),`${locale}: alert raised: told`);
  assert.ok(h.includes(locale==='en'?'Emergency services have not been called':'Շտապ օգնությունը այս ծառայության միջոցով չի կանչվել'),`${locale}: told never reads as 103 was called`);
  assert.ok(h.indexOf('href="tel:103"')<h.indexOf(told),`${locale}: 103 stays first`);}
 zoeStatus={alerted:false,pending:true};
 {const h=await render();assert.ok(!h.includes(told)&&!h.includes(notTold),`${locale}: alert still to come: no claim either way`);
  assert.ok(h.includes(locale==='en'?'Do not wait for this service':'Մի սպասեք այս ծառայությանը'),`${locale}: the 103 line stands`);}
 zoeStatus=undefined;
 {const h=await render();assert.ok(!h.includes(told)&&!h.includes(notTold),`${locale}: unreadable status: no claim either way`);}
 zoeStatus={alerted:false,pending:false};
}
// Opened with no message to ask about (a bad request id, or text that was never stored): no claim either way (Astra ZUT-01).
{const html=renderToStaticMarkup(await (urgentExports.default as ()=>Promise<React.ReactElement>)());
 assert.ok(html.includes('href="tel:103"')&&!/has not been notified|We have told/.test(html),'No message named: no claim either way');}
// ZUT-01: the id reaches the screen only when this text was stored or replayed. The real action, with the store's answers mocked.
{
 const ID='00000000-0000-4000-8000-0000000000aa';
 const opened=async(store:()=>Promise<unknown>)=>{
  const exports:Record<string,unknown>={};
  new vm.Script(transpile('app/patient/zoe/chat-actions.ts')).runInNewContext({exports,setTimeout:(f:()=>void)=>setTimeout(f,5),require(name:string){
   if(name==='@/lib/observability/with-logging')return {loggedAction:(_action:string,run:unknown)=>run};
   if(name==='next/server')return {after:()=>{}};
   if(name==='next/navigation')return {redirect:(to:string)=>{throw Error(`redirect:${to}`);}};
   if(name==='@/lib/patient/auth')return {requirePatient:async()=>({userId:'fictional'})};
   if(name==='@/lib/zoe/member-screen')return {zoeTextRoute:()=>'urgent',symptomRedFlagRoute:()=>false,zoeEmergencyCardEnabled:screen.zoeEmergencyCardEnabled};
   if(name==='@/lib/zoe/sweep-trigger')return {requestZoeSweep:async()=>true};
   if(name==='@/lib/zoe/app-chat-contracts')return {ZOE_CHAT_MAX:2000};
   if(name==='@/lib/patient-care/enrolment')return {enrolForZoeChat:async()=>false};
   if(name==='@/lib/zoe-chat-actions/voice-message')return {storeMessageWithVoiceReceipt:store};
   if(name==='@/lib/zoe/app-chat')return {readIntakeState:async()=>null,readZoeThread:async()=>null,readZoeThreadState:async()=>null,screenNewMessages:async()=>null,storeNewTopic:async()=>false,utf16Length:(t:string)=>t.length};
   throw Error(`Unexpected boundary: ${name}`);
  }});
  return (exports.sendZoeChatMessage as (r:string,t:string,d:boolean)=>Promise<unknown>)(ID,'Fictional urgent words',false).then(()=>'no redirect',(e:Error)=>e.message);
 };
 assert.equal(await opened(async()=>({ok:true})),`redirect:/patient/zoe/urgent?request=${ID}`,'Stored or replayed: the screen is told which message');
 const bare='redirect:/patient/zoe/urgent';
 assert.equal(await opened(async()=>({ok:false,code:'failed'})),bare,'A reused id with other text, or a refused store: no id');
 assert.equal(await opened(async()=>{throw Error('store failed');}),bare,'A failed store: no id');
 assert.equal(await opened(()=>new Promise(()=>{})),bare,'A store that times out: no id');
}
// A slow database never holds the 103 screen.
zoeStatus='slow';
{const at=Date.now(),html=renderToStaticMarkup(await urgentPage());
 assert.ok(Date.now()-at<3000&&html.includes('href="tel:103"'),'Slow status: the screen opens anyway');
 assert.ok(!/has not been notified|We have told/.test(html),'Slow status: no claim either way');}
zoeStatus={alerted:false,pending:false};

// The inline card is the same urgent content, with the same links and status truth table.
for(const locale of ['en','hy'] as const){
 for(const status of [null,{alerted:false,pending:true},{alerted:false,pending:false},{alerted:true,pending:false}]){
  const Content=loadUrgentViews().content.ZoeUrgentContent as React.ComponentType<{locale:'en'|'hy';request:string|null;initial:typeof status;inline:boolean}>;
  const html=renderToStaticMarkup(React.createElement(Content,{locale,request:'stored',initial:status,inline:true}));
  assert.deepEqual([...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(m=>m[1]),['tel:103','/patient/help']);
  assert.ok(html.includes(locale==='en'?'Call 103 now':'Զանգահարել 103 հիմա'));
  assert.equal(html.includes(locale==='en'?'We have told':'տեղեկացրել ենք'),status?.alerted===true&&!status.pending);
  assert.equal(html.includes(locale==='en'?'has not been notified':'չեն ծանուցվել'),status?.alerted===false&&!status.pending);
 }
}
for(const value of [undefined,'','false','TRUE','1'])assert.equal(screen.zoeEmergencyCheck(null,{NOREON_ZOE_EMERGENCY_CARD:value}),null);
// A failed card always leaves a tap-to-call link while the direct page opens, with only a confirmed request.
for(const request of [null,'00000000-0000-4000-8000-0000000000aa']){
 let destination='';
 const Boundary=loadUrgentViews(undefined,url=>{destination=url;}).card.ZoeEmergencyFallback as {new(props:{request:string|null;children:React.ReactNode}):{state:{failed:boolean};componentDidCatch:()=>void;render:()=>React.ReactNode};getDerivedStateFromError:()=>{failed:boolean}};
 const boundary=new Boundary({request,children:null});
 boundary.state=Boundary.getDerivedStateFromError();
 boundary.componentDidCatch();
 assert.equal(destination,`/patient/zoe/urgent${request?`?request=${request}`:''}`);
 assert.ok(renderToStaticMarkup(boundary.render()).includes('href="tel:103"'));
}
const check=screen.zoeEmergencyCheck({enabled:true,active:true},{NOREON_ZOE_EMERGENCY_CARD:'true',NOREON_ZOE_TEST_LEXICON:'true',PRIVATE_VALUE:'must not cross'})!;
assert.deepEqual(Object.keys(check.env).sort(),['NOREON_ZOE_TEST_LEXICON','NOREON_ZOE_URGENT_PLACEHOLDER']);
assert.equal(screen.isZoeEmergency('My chest hurts',check),true);
assert.equal(screen.isZoeEmergency('Now my left arm is numb',check),true);
assert.equal(screen.isZoeEmergency('When is my visit?',check),false);

// 4. Approved answers and the screen's own copy.
for(const item of screen.ZOE_FAQ){
 const source=readFileSync(item.source,'utf8');
 assert.ok(source.includes(item.answer.en)&&source.includes(item.answer.hy)&&source.includes(item.answer.ru),`FAQ ${item.id}: answer is the approved text in ${item.source}`);
}
const zoeCopy=ENTRIES.map(f=>readFileSync(f,'utf8')).join('\n');
// Chat first (Khikar, 18 Oct 22:57): the fixed "AI assistant, not a doctor" line on the screen, the longer
// explanation in Help's About Zoe, and no 103 control of its own (the header's pill is the one).
const zoePageSource=readFileSync('app/patient/zoe/page.tsx','utf8');
assert.ok(zoePageSource.includes('"AI assistant, not a doctor", "ԱԲ օգնական, ոչ բժիշկ"'),'Zoe screen: permanent AI line');
assert.doesNotMatch(zoePageSource,/tel:103/,'Zoe screen: no 103 control besides the header pill');
const helpSource=readFileSync('components/patient-care/member-help-content.tsx','utf8');
assert.ok(helpSource.includes('For health questions, your doctor answers. Zoe explains; only your doctor changes treatment.'),'Help: About Zoe');
assert.ok(helpSource.includes('Առողջության հարցերին պատասխանում է ձեր բժիշկը։ Զոյան բացատրում է, իսկ բուժումը փոխում է միայն ձեր բժիշկը։'),'Help: About Zoe (hy)');
assert.doesNotMatch(zoeCopy,/—|!"|!'|reviews (each|every)/,'Voice guide: no em dash, no exclamation, no per-message review promise');
assert.ok(readFileSync('components/patient/zoe-quick-actions.tsx','utf8').includes('{upload && !cards && ('),'Upload is shown only when member uploads are on');
assert.deepEqual(screen.doctorChannel({state:'linked'},'NoreonBot'),{mode:'telegram',href:'https://t.me/NoreonBot'});
assert.equal(screen.doctorChannel({state:'not_linked'},'NoreonBot').mode,'connect');
for(const link of [null,{state:'not_ready'},{state:'unavailable'},{state:'linked'}])assert.equal(screen.doctorChannel(link,link?.state==='linked'?null:'NoreonBot').mode,'unavailable');

// 5. Home shows everything directly (Khikar, 18 Oct), next step first, nothing repeated.
const home=readFileSync('components/patient/member-home-content.tsx','utf8');
assert.doesNotMatch(home,/data-home-more|<details|compact\.slice/,'No More fold and no cap on Home');
for(const kept of ['<PwaInstall','<NextSteps','mode="secondary"','<ComingUpNext','<HomeHealthAndRhythm','<DailyRoutine','<HomeLifestyle','<HomeCareAndTeam','<ConsultationHoldCard','<LabStageCard','/patient/service','/patient/health/profile','<HomeJourneyStrip','<HomeCareTeam','<HomeUnwellCard','<HomeZoeCard'])
 assert.ok(home.includes(kept),`Home keeps ${kept}`);
const at=(t:string)=>{const i=home.lastIndexOf(t);assert.ok(i>0,t);return i;};
const order=['<HomeJourneyStrip','mode={urgent ? "all" : "primary"}','<HomeHealthAndRhythm','<HomeLifestyle','<HomeCareAndTeam','<HomeCareTeam','<HomeUnwellCard','<HomeZoeCard'];
for(let i=1;i<order.length;i++)assert.ok(at(order[i-1])<at(order[i]),`${order[i-1]} comes before ${order[i]}`);
assert.match(home,/primaryHref !== "\/patient\/service"/,'The visits link is not repeated when the next step already goes there');
assert.match(home,/showHold = consultationHold && !journeyShows\(\["journey-consultation"\]\)/,'The hold card is not repeated under the consultation step');
assert.match(home,/!journeyShows\(\["journey-samples", "journey-results"\]\)/,'The lab card is not repeated under the samples or results step');
assert.match(home,/i === 0 \|\| a\.kind !== "measurement"/,'The care list does not repeat the reading Up next offers');
assert.match(home,/doctorShown=\{!!careTeam\?\.doctor\}/,'The plan reviewer row is not repeated under the named doctor');
// Exercise both real Home layouts, including the urgent fallback, with synthetic IO only.
await import('./check-member-home-notices-render');
console.log('Zoe member screen: no model/gateway/pipeline in the import graph, urgent words open the 103 screen (red wins, full text), others go to the doctor flow, shared page/card exits and truthful status EN/HY, exact-true card gate and render fallback, approved FAQ answers, Home shows every section once.');
