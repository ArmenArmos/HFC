import {resolveTestModule} from './care-alert-resolve-test-module';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as contracts from '@/lib/staff-zoe/contracts';
import * as labProvenance from '@/lib/lab-ai/provenance';
import type {ToolResult} from '@/lib/staff-zoe/contracts';
function load(file:string,modules:Record<string,unknown>){
 const exports:Record<string,unknown>={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:(name:string)=>{assert.ok(name in modules,`Unmocked ${name}`);return modules[name];},Date});
 return exports;
}
const id=(n:number)=>`f0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const member=id(1),other=id(2),conversation=id(3);
const source=readFileSync('lib/staff-zoe/chat-v2-zoe-read.ts','utf8');
const modules=Object.fromEntries(ts.preProcessFile(source).importedFiles.map(x=>[x.fileName,{}]));
Object.assign(modules,{'./contracts':contracts});
const reads=load('lib/staff-zoe/chat-v2-zoe-read.ts',modules) as {readPatientChatZoeHistory:(client:unknown,conversation:string,member:string)=>Promise<{kind:string;turns:{memberId:string;text:string}[]}>};
assert.equal(typeof reads.readPatientChatZoeHistory,'function','Patient history must read its own conversation, including older chats');
let data:unknown={enabled:true,id:conversation,member:{id:member,name:'Example A',birthYear:1980,sex:'female'},messages:[{seq:1,role:'staff',body:'Saved weeks ago',content:null,at:'2026-09-01T10:00:00Z'}]};
const client={rpc:async(name:string,args:unknown)=>{assert.equal(name,'staff_zoe_read');assert.deepEqual(JSON.parse(JSON.stringify(args)),{p_conversation:conversation});return {data,error:null};}};
const history=await reads.readPatientChatZoeHistory(client,conversation,member);
assert.equal(history.kind,'history');assert.equal(history.turns[0]?.text,'Saved weeks ago');
data={...(data as object),member:{id:other,name:'Example B',birthYear:1980,sex:'female'}};
assert.equal((await reads.readPatientChatZoeHistory(client,conversation,member)).kind,'refused','A mismatched conversation never returns history');
console.log('Patient chat: scoped persisted history passed (fake RPC).');

// Actual server page with controlled RPCs: no auth, database or environment reads.
const React=await import('react'),jsx=await import('react/jsx-runtime');
const {z}=await import('zod');
const {renderToStaticMarkup}=await import('react-dom/server');
const copy=await import('@/lib/staff/staff-locale-copy');
const coordination=await import('@/lib/staff/real-coordination/schema');
let role='doctor',allowed=true,zoeOn=true;
const identity={id:member,name:'Example A',birthDate:'1980-04-15',birthYear:1980,sex:'female' as const,phone:'+37499123456',phoneLast4:'3456',shortId:'NRN-A',clinic:'Example clinic'};
let identityCalls=0,openCalls=0;
const PatientView=()=>null;
const pageModules:Record<string,unknown>={
 '@/lib/staff-zoe/voice':{staffVoiceAvailable:async()=>false},
 'server-only':{},zod:{z},'react/jsx-runtime':jsx,
 '@/lib/staff/real-staff-render':{requireRealStaffForRender:async()=>({identity:{id:id(9),name:'Doctor Example',role},client:{rpc:async(name:string)=>{
  if(name==='staff_zoe_status')return {error:null,data:zoeOn};
  if(name==='staff_zoe_open'){openCalls++;return {error:null,data:allowed?{ok:true,conversationId:conversation}:{ok:false}};}
  if(name==='patient_coordination_members')return {error:null,data:{members:[{id:member,name:'Example A',owners:[{id:id(9),name:'Doctor Example',role:'doctor'},{id:id(8),name:'Nurse Example',role:'nurse'}]}],nextCursor:null}};
  throw Error(`Unexpected RPC ${name}`);
 }}})},
 '@/lib/staff/staff-locale':{staffLocale:async()=>'en'},'@/lib/staff/staff-locale-copy':copy,
 '@/lib/staff/chat-member-identity-read':{readChatMemberIdentities:async()=>{identityCalls++;return allowed?[identity]:[];}},
 '@/lib/staff/real-coordination/schema':coordination,
 '@/lib/lab-ai/doctor-runtime':{readLab:async(_c:unknown,routeMember:string,file:string)=>routeMember===member&&file===id(4)?{enabled:true,fileId:file}:'access'},
 '@/lib/ldl/runtime':{readDoctorLdl:async()=>({enabled:true,goals:[{category:'high'}]})},
 '@/lib/doctor-completion/document-runtime':{readDoctorPlanVersions:async()=>[{current:true,version:2}]},
 '@/lib/gp-report/config':{resultsReportEnabled:()=>false},'./patient-chat':{PatientChat:PatientView},
 '@/lib/clinical-review/header-read':{readStaffClinicalHeader:async()=>null},
 '@/components/chat-v2/chat.css':{},'./doctor-chat.css':{},
};
const page=load('components/doctor-chat-v2/patient-chat-page.tsx',pageModules).patientChatPage as (id:string)=>Promise<React.ReactElement<Record<string,unknown>>>;
assert.equal((await page(member)).type,PatientView);
assert.equal((await page(member)).props.planVersion,2);
assert.equal((await page(member)).props.risk,'high');
allowed=false;const before=identityCalls;
const unassigned=renderToStaticMarkup(await page(member)),unknown=renderToStaticMarkup(await page(other)),invalid=renderToStaticMarkup(await page('bad'));
assert.equal(unassigned,unknown);assert.equal(unknown,invalid);assert.equal(identityCalls,before+2,'Valid route IDs use the assignment-scoped identity read');
allowed=true;for(const nextRole of ['nurse','admin']){role=nextRole;const calls=openCalls;assert.equal(renderToStaticMarkup(await page(member)),unassigned);assert.equal(openCalls,calls);}
role='doctor';zoeOn=false;assert.equal(renderToStaticMarkup(await page(member)),unassigned);zoeOn=true;
console.log('Patient chat: server page care-team access and identical unassigned/unknown refusals passed (fake RPC).');

// The route treats the query as a presentation hint, never a lookup.
const patientRoute=load('app/staff/real/(review)/doctor-chat-v2/patient/[memberId]/page.tsx',{
 zod:{z},'next/navigation':{notFound:()=>{throw Error('notFound');}},
 '@/lib/staff-zoe/workspace-config':{doctorChatV2Enabled:()=>true},
 '@/components/doctor-chat-v2/patient-chat-page':{patientChatPage:async(memberId:string,focusAlertId?:string)=>({memberId,focusAlertId})},
}).default as (props:{params:Promise<{memberId:string}>;searchParams:Promise<{alert?:unknown}>})=>Promise<{memberId:string;focusAlertId?:string}>;
for(const value of [undefined,null,'bad',[id(4)],`${id(4)}&name=private`])assert.deepEqual(await patientRoute({params:Promise.resolve({memberId:member}),searchParams:Promise.resolve({alert:value})}),{memberId:member,focusAlertId:undefined});
assert.deepEqual(await patientRoute({params:Promise.resolve({memberId:member}),searchParams:Promise.resolve({alert:id(4)})}),{memberId:member,focusAlertId:id(4)});
assert.equal((await (page as (id:string,focus:string)=>ReturnType<typeof page>)(member,id(4))).props.focusAlertId,id(4));
const labPage=page as (id:string,alert:string|undefined,lab:string)=>ReturnType<typeof page>;
assert.equal((await labPage(member,undefined,id(4))).props.focusLabId,id(4));
assert.equal((await labPage(member,undefined,id(5))).props.focusLabId,undefined,'Foreign file ignored silently');
assert.equal((await labPage(member,undefined,'bad')).props.focusLabId,undefined,'Invalid file ignored silently');
const labRoute=load('app/staff/real/(review)/doctor-chat-v2/patient/[memberId]/page.tsx',{
 zod:{z},'next/navigation':{notFound:()=>{throw Error('notFound');}},
 '@/lib/staff-zoe/workspace-config':{doctorChatV2Enabled:()=>true},
 '@/components/doctor-chat-v2/patient-chat-page':{patientChatPage:async(memberId:string,_alert?:string,focusLabId?:string)=>({memberId,focusLabId})},
}).default as (input:unknown)=>Promise<unknown>;
for(const value of [undefined,null,'bad',[id(4)],`${id(4)}&name=private`])assert.deepEqual(await labRoute({params:Promise.resolve({memberId:member}),searchParams:Promise.resolve({lab:value})}),{memberId:member,focusLabId:undefined});
assert.deepEqual(await labRoute({params:Promise.resolve({memberId:member}),searchParams:Promise.resolve({lab:id(4).toUpperCase()})}),{memberId:member,focusLabId:id(4)});



// Patient ask entry point refuses a mismatched conversation or another named member before the shared turn.
let bound=member,found:Record<string,unknown>={kind:'keep'},asked=0;
const routeModules:Record<string,unknown>={
 '@/lib/observability/with-logging':{withRouteLogging:(fn:unknown)=>fn},
 zod:{z},'@/lib/staff-zoe/contracts':contracts,
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>({identity:{id:id(9),role},client:{rpc:async()=>({error:null,data:{enabled:true,id:conversation,member:{id:bound,name:'Example A',birthYear:1980,sex:'female'},messages:[]}})}})},
 '@/lib/staff-zoe/workspace-config':{doctorChatV2Enabled:()=>true},
 '@/lib/staff-zoe/chat-v2-actions':{findDoctorChatQuestionMember:async()=>found},
 '@/app/staff/real/(review)/zoe/ask/route':{POST:async(_request:Request,context:{params:Promise<{memberId:string}>})=>{asked++;assert.equal((await context.params).memberId,member);return new Response('accepted');}},
};
const routeSource=readFileSync('app/staff/real/(review)/doctor-chat-v2/patient/[memberId]/ask/route.ts','utf8');
const routeExports:Record<string,unknown>={};
vm.runInNewContext(ts.transpileModule(routeSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:routeExports,require:(name:string)=>{assert.ok(name in routeModules,name);return routeModules[name];},Request,Response,URL});
const post=routeExports.POST as (request:Request,context:{params:Promise<{memberId:string}>})=>Promise<Response>;
const request=()=>new Request(`https://local.test/staff/real/doctor-chat-v2/patient/${member}/ask`,{method:'POST',headers:{origin:'https://local.test','Content-Type':'application/json'},body:JSON.stringify({conversationId:conversation,submissionId:id(5),text:'How is Example A?',intent:null})});
const context={params:Promise.resolve({memberId:member})};
assert.equal((await post(request(),context)).status,200);assert.equal(asked,1);
bound=other;assert.equal((await post(request(),context)).status,403);assert.equal(asked,1);
bound=member;found={kind:'member',memberId:other,memberName:'Example B'};assert.equal((await post(request(),context)).status,403);assert.equal(asked,1);
found={kind:'choose',rows:[{id:member,name:'Example A'},{id:other,name:'Example B'}]};assert.equal((await post(request(),context)).status,403);assert.equal(asked,1);
found={kind:'unavailable'};assert.equal((await post(request(),context)).status,403);assert.equal(asked,1);
found={kind:'keep'};role='nurse';assert.equal((await post(request(),context)).status,403);role='doctor';
console.log('Patient chat: ask conversation mismatch, named other member, ambiguity, unavailable resolver and role refusals passed (fake RPC).');

// Mounted patient tree: real state/effects, existing identity and controlled card/action IO.
const {act,create}=await import('react-test-renderer');
type Renderer=import('react-test-renderer').ReactTestRenderer;
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const {fixtureMember,fixtureIdentity,fixtureAlert,fixtureMembers}=await import('../e2e/doctor-chat-v2/data');
const paths:string[]=[],calls:{name:string;args:unknown[]}[]=[],fetches:{url:string;body:{conversationId:string};signal:AbortSignal}[]=[];
let alertReadFailed=false,decisionsOff=false;
let focusClosed=false,pendingAlerts:Promise<unknown>|null=null,reducedMotion=false;
const scrolls:unknown[]=[],frames=new Map<number,()=>void>();let frameId=0;
let headerRefreshes=0;
let newestCalls=0,answerResolve:(value:Response)=>void=()=>{},delayedFetch=false,restoreFail=false,memberFail=false;
const histories=new Map<string,string[]>([[member,['A saved weeks ago']],[other,['B saved weeks ago']]]);
let resolver:Record<string,unknown>={kind:'keep'};
const componentSource=readFileSync('components/doctor-chat-v2/patient-chat.tsx','utf8');
const componentModules:Record<string,unknown>={'@/lib/brand':await import('@/lib/brand'),'@/lib/lab-ai/provenance':labProvenance,'@/lib/lab-ai/review-copy':await import('@/lib/lab-ai/review-copy'),'@/lib/lab-ai/analyte-names':await import('@/lib/lab-ai/analyte-names'),
 // Voice is unavailable in these typed-chat fixtures; the dedicated voice UI check mounts its dispatch.
 '@/components/chat-v2/conversation':{useConversation:()=>({active:false,edit(){},sent(){}}),ConversationToggle:()=>null},
 '@/components/staff/voice-reply':await import('@/components/staff/voice-reply'),
 react:React,'react/jsx-runtime':jsx,'next/navigation':{useRouter:()=>({push:(path:string)=>paths.push(path),refresh:()=>{headerRefreshes++;}})},
 '@/lib/staff/staff-locale-copy':copy,
 '@/components/patient/use-chat-viewport':{useChatViewport:()=>{}},
 '@/components/chat-v2/use-thread-scroll':{useThreadScroll:()=>({threadRef:null,contentRef:null,unread:false,stopFollowing:()=>{},newest:()=>{newestCalls++;}})},
 '@/lib/staff-zoe/stream':await import('@/lib/staff-zoe/stream'),
 '@/lib/staff-zoe/response-copy':await import('@/lib/staff-zoe/response-copy'),
 '@/lib/staff-zoe/typed-boundary':await import('@/lib/staff-zoe/typed-boundary'),
 '@/lib/staff-zoe/typed-handover':await import('@/lib/staff-zoe/typed-handover'),
 '@/lib/staff-zoe/handover':await import('@/lib/staff-zoe/handover'),
 '@/lib/staff-zoe/typed-reply':await import('@/lib/staff-zoe/typed-reply'),
 '@/lib/staff-zoe/home-intent':await import('@/lib/staff-zoe/home-intent'),
 '@/lib/staff-zoe/outcome-copy':await import('@/lib/staff-zoe/outcome-copy'),
 './lab-review-action':{labValuesChanged:()=> 'Lab values changed'},
 '@/lib/staff-zoe/hand-back-copy':await import('@/lib/staff-zoe/hand-back-copy'),
};
// Real shared identity rendering, with a complete role-filtered payload supplied by the server page.
componentModules['@/lib/staff/member-identity']=await import('@/lib/staff/member-identity');
componentModules['@/lib/staff/chat-member-identity-actions']={readStaffChatMemberIdentities:async(ids:string[])=>ids.map(id=>fixtureIdentity(id,id===member?'Example A':'Example B'))};
componentModules['./member-identity']=load('components/staff/member-identity.tsx',componentModules);
componentModules['@/components/staff/member-identity']=componentModules['./member-identity'];
componentModules['@/components/staff/chat-member-identity']=load('components/staff/chat-member-identity.tsx',componentModules);
const card=(name:string)=>function Card(props:Record<string,unknown>){return React.createElement('section',{'data-card':name,'data-member':props.memberId??(props.data as {memberId?:string}|undefined)?.memberId},name,JSON.stringify(props));};
function PlanCard(props:Record<string,unknown>){const [draft,setDraft]=React.useState('');return React.createElement('section',{'data-card':'plan'},React.createElement('input',{'aria-label':'Unsaved plan text',value:draft,onChange:(event:{target:{value:string}})=>setDraft(event.target.value)}),JSON.stringify(props));}
componentModules['./patient-graphs']={PatientGraphs:card('patient-graphs'),PlanSparklines:()=>null};
componentModules['./patient-labs']={PatientLabs:card('patient-labs')};
componentModules['@/components/staff/clinical-review-cards']={TargetsCard:card('targets'),MemberTierTargets:()=>null};
const MemberCard=card('member'),LabCard=card('lab'),UploadCard=card('upload'),HandoverCard=card('handover'),ResultCard=card('results');
const ReplyCard=(props:{reply:{kind:string;alert?:{memberId:string}};onOpen:(id:string,name:string)=>void})=>React.createElement('section',{'data-card':props.reply.kind},JSON.stringify(props.reply),props.reply.alert&&React.createElement('button',{onClick:()=>props.onOpen(props.reply.alert!.memberId,'Example')},'Open alert member'));
Object.assign(componentModules,{'./messages':{DoctorReply:ReplyCard},'./conversation':{MemberConversation:MemberCard},'./plan':{DoctorChatPlan:PlanCard},'./lab':{DoctorChatLab:LabCard},'./upload':{DoctorChatUpload:UploadCard},'./handover':{DoctorHandoverCard:HandoverCard},'./results-block':{ResultsBlock:ResultCard}});
const dataFor=(id:string)=>({...fixtureMember(id),memberName:id===member?'Example A':'Example B',thread:[...fixtureMember(id).thread,{key:'recent',who:'member' as const,name:'Example',text:id===member?'A recent only':'B recent only',at:new Date().toISOString()}],identity:fixtureIdentity(id,id===member?'Example A':'Example B'),reply:{...fixtureMember(id).reply,card:{...fixtureMember(fixtureMembers[0].id).reply!.card!,memberId:id},prepare:fixtureMember(id).reply!.prepare}});
const testActions:Record<string,unknown>={};
const action=<Args extends unknown[]>(name:string,fn:(...args:Args)=>unknown)=>{testActions[name]=(...args:Args)=>{calls.push({name,args});return fn(...args);};};
action('readDoctorPatientChatHistory',async(id:string)=>restoreFail?{kind:'unavailable'}:{kind:'history',conversations:[{memberId:id,conversationId:id}],turns:[...(histories.get(id)??[]).map((text,index)=>({key:`saved:${id}:${index}`,memberId:id,conversationId:id,role:'staff',text,savedAt:'2026-09-01T10:00:00Z'})),{key:'foreign',memberId:id===member?other:member,conversationId:'foreign',role:'staff',text:'FOREIGN HISTORY'}]});
action('openDoctorChatMember',async(id:string)=>decisionsOff?{kind:'off'}:memberFail?{kind:'unavailable'}:dataFor(id));
action('readDoctorChatConversation',async(id:string)=>dataFor(id));
action('readDoctorPatientChatAlerts',async(id:string)=>pendingAlerts??(alertReadFailed?{kind:'unavailable'}:({kind:'alerts',alerts:[{...fixtureAlert(),memberId:id,alert:{...fixtureAlert().alert,state:focusClosed?'resolved':'open'}},{...fixtureAlert('new-alert'),memberId:id===member?other:member}]})));
action('findDoctorChatQuestionMember',async()=>resolver);
action('openDoctorChatZoe',async(id:string)=>({ok:true,conversationId:id}));
action('readDoctorPatientGraphs',async(id:string)=>({kind:'graphs',data:{memberId:id,series:{},unavailable:[]}}));
action('readDoctorChatResults',async()=>({status:'none'}));
action('prepareDoctorChatHandover',async(id:string)=>({kind:'handover',target:{memberId:id,nurseName:'Nurse Example'}}));
action('composeDoctorChatReply',async()=>({ok:true}));action('reviseDoctorChatReply',async()=>({ok:true}));action('approveDoctorChatReply',async()=>({ok:true}));action('retryDoctorChatDelivery',async()=>({ok:true}));action('handBackDoctorChat',async()=>({kind:'saved'}));action('acknowledgeDoctorChatAlert',async()=>({kind:'saved',notice:'acknowledged'}));action('resolveDoctorChatAlert',async()=>({kind:'saved',notice:'resolved'}));
componentModules['@/lib/staff-zoe/chat-v2-actions']=testActions;
const graphEvents=Object.assign(new EventTarget(),{hidden:false});
const componentExports:Record<string,unknown>={},intervals=new Map<number,()=>void>();let intervalId=0;
vm.runInNewContext(ts.transpileModule(componentSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
 exports:componentExports,require:(name:string)=>{assert.ok(name in componentModules,`Unmocked ${name}`);return componentModules[name];},Date,AbortController,requestAnimationFrame:(fn:()=>void)=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:(id:number)=>frames.delete(id),window:{matchMedia:()=>({matches:reducedMotion})},crypto:{randomUUID:()=>id(7)},document:graphEvents,setInterval:(fn:()=>void)=>{intervals.set(++intervalId,fn);return intervalId;},clearInterval:(id:number)=>intervals.delete(id),
 fetch:async(url:string,options:{body:string;signal:AbortSignal})=>{
  const body=JSON.parse(options.body);fetches.push({url,body,signal:options.signal});
  const key=url.includes(member)?member:other;histories.set(key,[...(histories.get(key)??[]),body.text]);
  if(delayedFetch)return new Promise<Response>(resolve=>{answerResolve=resolve;});
  return new Response(JSON.stringify({type:'refused',code:'off'})+'\n');
 },
});
const Patient=componentExports.PatientChat as React.ComponentType<Record<string,unknown>>;
const props=(id:string,phone=true)=>({doctorId:'doctor',doctorName:'Doctor Example',member:{...fixtureIdentity(id,id===member?'Example A':'Example B'),...(phone?{phone:'+37499123456'}:{})},locale:'en',owners:[{id:'doctor',name:'Doctor Example',role:'doctor'},{id:'nurse',name:'Nurse Example',role:'nurse'}],risk:'high',planVersion:2,resultsReport:true});
let screen!:Renderer;
const html=()=>JSON.stringify(screen.toJSON());
const nodeText=(node:import('react-test-renderer').ReactTestInstance):string=>node.children.map(child=>typeof child==='string'?child:nodeText(child)).join('');
const press=async(label:string)=>{const button=screen.root.findAllByType('button').find(b=>nodeText(b).includes(label));assert.ok(button,label);await act(async()=>button.props.onClick());};
const send=async(value:string)=>{await act(async()=>screen.root.findByType('textarea').props.onChange({target:{value}}));await act(async()=>screen.root.findByType('form').props.onSubmit({preventDefault(){}}));};
const mount=async(id:string)=>{await act(async()=>{screen=create(React.createElement(Patient,props(id)));});};
const focusId=fixtureAlert().alert.id;
const flushFrames=async()=>{await act(async()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());});};
const mountFocus=async(focusAlertId:string,locale='en')=>{await act(async()=>{screen=create(React.createElement(Patient,{...props(member),focusAlertId,locale}),{createNodeMock:()=>({scrollIntoView:(options:unknown)=>scrolls.push(options),focus:()=>assert.fail('Notification must not take keyboard focus')})});});};
for(const locale of ['en','hy','ru']){
 scrolls.length=0;reducedMotion=locale==='hy';
 await mountFocus(focusId,locale);await flushFrames();
 assert.equal(scrolls.length,1,'Matching loaded alert scrolls once');
 assert.equal((scrolls[0] as {behavior:string}).behavior,reducedMotion?'instant':'smooth');
 assert.equal(screen.root.findAllByProps({'aria-current':'true'}).length,1);
 assert.ok(html().includes(copy.st(locale as 'en'|'hy'|'ru','From your notification','Ձեր ծանուցումից','Из вашего уведомления')));
 await act(async()=>{for(const poll of intervals.values())poll();});await flushFrames();assert.equal(scrolls.length,1,'Polling never repeats the jump');
 await act(async()=>screen.root.findByProps({'aria-current':'true'}).props.onClickCapture());
 assert.equal(screen.root.findAllByProps({'aria-current':'true'}).length,0,'Acting clears the marker');
 await act(async()=>screen.unmount());
}
for(const focus of [id(99),fixtureAlert('new-alert').alert.id]){
 scrolls.length=0;await mountFocus(focus);await flushFrames();assert.equal(scrolls.length,0);assert.equal(screen.root.findAllByProps({'aria-current':'true'}).length,0);await act(async()=>screen.unmount());
}
focusClosed=true;scrolls.length=0;await mountFocus(focusId);await flushFrames();assert.equal(scrolls.length,0);assert.equal(screen.root.findAllByProps({'aria-current':'true'}).length,0);assert.ok(screen.root.findAllByProps({'data-card':'urgent'}).length,'Closed cards retain existing rendering');await act(async()=>screen.unmount());focusClosed=false;
for(const intent of ['onWheelCapture','onTouchStartCapture','onPointerDownCapture','onKeyDownCapture','onInputCapture']){
 let finish!:(data:unknown)=>void;pendingAlerts=new Promise(resolve=>{finish=resolve;});scrolls.length=0;
 await mountFocus(focusId);
 await act(async()=>screen.root.findByType('main').props[intent]());
 const beforeLoad=newestCalls;
 await act(async()=>{finish({kind:'alerts',alerts:[{...fixtureAlert(),memberId:member}]});});pendingAlerts=null;
 assert.equal(newestCalls,beforeLoad,'Loading cannot force newest after interaction');
 await flushFrames();assert.equal(scrolls.length,0,`No jump after ${intent}`);assert.equal(screen.root.findAllByProps({'aria-current':'true'}).length,1,'Interaction cancels scrolling, not the notification marker');await act(async()=>screen.unmount());
}
scrolls.length=0;await mountFocus(focusId);
await act(async()=>screen.root.findByType('textarea').props.onChange({target:{value:'My question'}}));
await act(async()=>screen.root.findByType('main').props.onInputCapture());
await flushFrames();assert.equal(scrolls.length,0,'Typing before the scheduled frame cancels the jump');
await act(async()=>screen.update(React.createElement(Patient,{...props(member),focusAlertId:id(99)})));
await flushFrames();assert.equal(screen.root.findAllByProps({'aria-current':'true'}).length,0,'Navigation clears the old marker');await act(async()=>screen.unmount());
console.log('Patient notification focus: own open card only, localized marker, one scroll, reduced motion, closed/foreign IDs ignored, pre-load interaction cancels scroll.');
// D25: empty states are specific, localized and never reveal another member.
const handoverAction=testActions.prepareDoctorChatHandover;
for(const locale of ['en','hy','ru'] as const)for(const kind of ['no_nurse','no_conversation','unavailable','refused'] as const){
 testActions.prepareDoctorChatHandover=async()=>({kind});
 await act(async()=>{screen=create(React.createElement(Patient,{...props(member),locale}));});
 await press(copy.st(locale,'Hand over','Փոխանցել','Передать'));
 const expected=kind==='no_nurse'?copy.st(locale,'No nurse is assigned to this member yet, so there is nobody to hand over to.','Այս անդամին դեռ բուժքույր կցված չէ, ուստի փոխանցելու մարդ չկա։','Этому участнику ещё не назначена медсестра, поэтому передать задачу некому.'):
  kind==='no_conversation'?copy.st(locale,'There is no conversation with this member yet, so there is nothing to hand over.','Այս անդամի հետ դեռ զրույց չկա, ուստի փոխանցելու բան չկա։','Переписки с этим участником ещё нет, поэтому передавать нечего.'):
  kind==='unavailable'?copy.st(locale,'The hand-over could not be prepared. Try again.','Չհաջողվեց պատրաստել փոխանցումը։ Փորձեք կրկին։','Не удалось подготовить передачу. Попробуйте снова.'):(await import('@/lib/staff-zoe/outcome-copy')).refreshFailed(locale);
 assert.ok(html().includes(expected),`${locale}: ${kind} has honest handover copy`);
 assert.equal(screen.root.findAllByType(HandoverCard).length,0);
 if(kind==='unavailable'){
  testActions.prepareDoctorChatHandover=handoverAction;
  await press(copy.st(locale,'Try again','Փորձել կրկին','Попробовать снова'));
  assert.equal(screen.root.findByType(HandoverCard).props.target.memberId,member);
 }
 await act(async()=>screen.unmount());
}
testActions.prepareDoctorChatHandover=handoverAction;
await mount(member);
assert.match(html(),/A saved weeks ago/);assert.doesNotMatch(html(),/B saved weeks ago|FOREIGN HISTORY/);
assert.ok(newestCalls>0,'Reopen scrolls to newest');
const header=screen.root.findByProps({'data-patient-header':member});
assert.match(nodeText(header),/Example A/);assert.match(html(),/\+37499123456|Example clinic|Plan v2|Doctor Example|Nurse Example/);
assert.equal(header.parent?.props['data-patient-chat'],member,'Header is a sibling of the scrollport, never inside it');
assert.equal(screen.root.findAllByType('textarea')[0].props.placeholder,'Ask Zoe about Example A');
assert.equal(screen.root.findByType('textarea').props.spellCheck,false);assert.equal(screen.root.findByType('textarea').props.autoCorrect,'off');
await send('How are things?');assert.equal(fetches.length,1);assert.equal(fetches[0].body.conversationId,member);assert.match(fetches[0].url,new RegExp(`/patient/${member}/ask$`));
await act(async()=>screen.update(React.createElement(Patient,props(other))));
assert.match(html(),/B saved weeks ago/);assert.doesNotMatch(html(),/A saved weeks ago|How are things|FOREIGN HISTORY/);
await act(async()=>screen.update(React.createElement(Patient,props(member))));
assert.match(html(),/A saved weeks ago/);assert.match(html(),/How are things/);assert.doesNotMatch(html(),/B saved weeks ago/);
const beforeOther=fetches.length,callStart=calls.length;
resolver={kind:'member',memberId:other,memberName:'Example B',identity:fixtureIdentity(other,'Example B')};
await send('What is Example B’s BP?');assert.equal(fetches.length,beforeOther);assert.ok(screen.root.findAllByProps({'data-open-patient-chat':true}).length);
assert.deepEqual(calls.slice(callStart).map(c=>c.name),['findDoctorChatQuestionMember'],'Another named member runs no member action or Zoe request');
await press('Open chat');assert.equal(paths.at(-1),`/staff/real/doctor-chat-v2/patient/${other}`);
resolver={kind:'keep'};
await press('← Patients');assert.equal(paths.at(-1),'/staff/real/doctor-chat-v2');
await press('At a glance');assert.ok(calls.some(c=>c.name==='readDoctorPatientGraphs'&&c.args[0]===member));
assert.equal(screen.root.findAllByProps({'data-card':'patient-graphs'}).length,1);
await act(async()=>{graphEvents.dispatchEvent(new Event('noreon:clinical-evidence-changed'));});
assert.equal(screen.root.findAllByProps({'data-card':'patient-graphs'}).length,0,'A lab change removes the old graph snapshot');
await press('At a glance');
await press('Labs');assert.equal(screen.root.findByProps({'data-card':'patient-labs'}).props['data-member'],member);
await press('Plan');assert.equal(screen.root.findByType(PlanCard).props.memberId,member);
assert.deepEqual(JSON.parse(JSON.stringify(screen.root.findByType(PlanCard).props.recent.map((entry:{text:string})=>entry.text))),['A recent only']);
await act(async()=>screen.root.findByProps({'aria-label':'Unsaved plan text'}).props.onChange({target:{value:'Keep unsaved A instructions'}}));
await press('Messages');
await press('Hand over');assert.equal(screen.root.findByType(HandoverCard).props.target.memberId,member);
// Resolve's inline confirmation carries both fields; an unconfirmed save keeps the edited reason.
const urgentCard=()=>screen.root.findAllByType(ReplyCard).find(node=>node.props.reply.kind==='urgent')!;
const inlineItem=urgentCard().props.reply.alert;
await act(async()=>urgentCard().props.onAct(inlineItem,'member_contacted','Contact recorded by nurse'));
const inlineCall=calls.filter(call=>call.name==='resolveDoctorChatAlert').at(-1)!;
assert.deepEqual(JSON.parse(JSON.stringify(inlineCall.args[0])),{alertId:inlineItem.alert.id,seq:inlineItem.alert.stateSeq,resolution:'member_contacted',note:'Contact recorded by nurse'});
assert.equal(screen.root.findByType('textarea').props.value,'','One inline confirm does not open a blank reason composer');
action('resolveDoctorChatAlert',async()=>{throw Error('Synthetic unconfirmed resolution');});
await act(async()=>urgentCard().props.onAct(urgentCard().props.reply.alert,'other','Keep this edited reason'));
assert.equal(screen.root.findByType('textarea').props.value,'Keep this edited reason','An unconfirmed inline close retains the reason for retry');
await press('Cancel');
action('resolveDoctorChatAlert',async()=>({kind:'saved',notice:'resolved'}));
// Mutations delegate only this member, and only the explicit card controls can send/save.
const currentCard=()=>screen.root.findAllByType(MemberCard).findLast(node=>node.props.active)!;
await act(async()=>currentCard().props.onChange());await send('Reviewed reply for A');
assert.ok(calls.some(c=>c.name==='reviseDoctorChatReply'&&c.args[0]===member));
await act(async()=>currentCard().props.onApprove());assert.ok(calls.some(c=>c.name==='approveDoctorChatReply'));
await act(async()=>currentCard().props.onRetry(id(6)));assert.ok(calls.some(c=>c.name==='retryDoctorChatDelivery'));
// Polling never forces an older-history reader to the newest position. Failed reads retain known warnings.
const beforePoll=newestCalls,urgentBefore=screen.root.findAllByProps({'data-card':'urgent'}).length;
await act(async()=>{for(const poll of intervals.values())poll();});
assert.equal(newestCalls,beforePoll,'Background refresh must not jump to newest');
alertReadFailed=true;
await act(async()=>{for(const poll of intervals.values())poll();});
assert.equal(screen.root.findAllByProps({'data-card':'urgent'}).length,urgentBefore,'An unavailable/capped alert read cannot erase a known alert');
assert.equal(screen.root.findAllByType(PlanCard).length,1,'An alert outage preserves the mounted plan editor');
assert.equal(screen.root.findByType(PlanCard).parent?.props.disabled,true,'Plan interaction stays disabled until alerts are checked');
assert.equal(screen.root.findByProps({'aria-label':'Unsaved plan text'}).props.value,'Keep unsaved A instructions','Polling does not unmount the edited plan');
assert.match(html(),/Alerts could not be checked/);
alertReadFailed=false;await press('Check again');assert.equal(screen.root.findAllByType(PlanCard).length,1);
assert.equal(screen.root.findByProps({'aria-label':'Unsaved plan text'}).props.value,'Keep unsaved A instructions');
await act(async()=>screen.root.findByType(PlanCard).props.onSaved('Saved plan','Draft saved'));assert.equal(headerRefreshes,1,'Saved plan refreshes server header metadata while keeping the keyed thread');
await act(async()=>screen.root.findByType(PlanCard).props.onCheckAgain());
assert.equal(screen.root.findByProps({'aria-label':'Unsaved plan text'}).props.value,'','Explicit plan retry remounts the card for a fresh read');
// A late report refresh cannot resurrect an approval form after approval or replace a newer read.
let resultResolve:(value:unknown)=>void=()=>{};
action('readDoctorChatResults',async()=>({status:'ready',memberId:member,marker:'current'}));
await send('show results for this member');await act(async()=>screen.root.findAllByType(ReplyCard).at(-1)!.props.onResults());const resultCard=()=>screen.root.findByType(ResultCard);
action('readDoctorChatResults',()=>new Promise(resolve=>{resultResolve=resolve;}));
let lateResult!:Promise<void>;
await act(async()=>{lateResult=resultCard().props.onRefresh();});
await act(async()=>resultCard().props.onApproved(3));
await act(async()=>{resultResolve({status:'ready',memberId:member,marker:'late'});await lateResult;});
assert.equal(screen.root.findAllByType(ResultCard).length,0,'Approval invalidates older report reads');
assert.match(html(),/3/);
// Confirmed writes remain visible when the follow-up read fails; no resend is attempted.
memberFail=true;
await act(async()=>currentCard().props.onChange());await send('Confirmed A reply');
assert.match(html(),/Confirmed A reply/);assert.match(html(),/saved/);
assert.equal(screen.root.findAllByType(MemberCard).at(-1)?.props.status,'saved');
memberFail=false;await press('Messages');
assert.equal(screen.root.findAllByType(MemberCard).length,1,'Only one current member card is kept');
await act(async()=>currentCard().props.onApprove());
const beforeFailedApprove=calls.filter(c=>c.name==='approveDoctorChatReply').length;
memberFail=true;await act(async()=>currentCard().props.onApprove());
assert.equal(calls.filter(c=>c.name==='approveDoctorChatReply').length,beforeFailedApprove+1);
assert.equal(screen.root.findAllByType(MemberCard).at(-1)!.props.status,'queued','Successful send receipt survives failed refresh');
memberFail=false;await press('Messages');
// Pending turn is aborted on A → B, and its eventual A response cannot paint B.
delayedFetch=true;let pending!:Promise<void>;
await act(async()=>{screen.root.findByType('textarea').props.onChange({target:{value:'Pending A'}});});
await act(async()=>{pending=screen.root.findByType('form').props.onSubmit({preventDefault(){}});await Promise.resolve();await Promise.resolve();});
const pendingRequest=fetches.at(-1)!;
await act(async()=>screen.update(React.createElement(Patient,props(other,false))));
assert.equal(pendingRequest.signal.aborted,true);
await act(async()=>{answerResolve(new Response(JSON.stringify({type:'refused',code:'busy'})+'\n'));await pending;});
assert.doesNotMatch(html(),/Pending A|A saved weeks ago/);
assert.doesNotMatch(nodeText(screen.root.findByProps({'data-patient-header':other})),/\+37499123456/,'Masked-role identity never adds a full phone');
await act(async()=>screen.unmount());assert.equal(intervals.size,0);
// Decisions off is an expected configuration, not a chat outage.
delayedFetch=false;decisionsOff=true;
action('readDoctorChatResults',async()=>({status:'none'}));
await mount(member);
assert.equal(screen.root.findByType('textarea').props.disabled,undefined);
assert.equal(screen.root.findAllByType(MemberCard).length,0,'Decision cards stay hidden while decisions are off');
assert.equal(screen.root.findAllByProps({'data-card':'conversation-failed'}).length,0,'Switched-off decisions are not a failed conversation');
for(const chip of screen.root.findByProps({className:'dcv2-controls dcv2-patient-chips'}).findAllByType('button'))assert.equal(chip.props.disabled,false,'Read-only chat chips stay usable without decision cards');
await press('Messages');
const beforeReadOnly=calls.length;
await press('At a glance');await press('Labs');
assert.ok(calls.slice(beforeReadOnly).some(c=>c.name==='readDoctorPatientGraphs'&&c.args[0]===member));
assert.equal(screen.root.findAllByProps({'data-card':'patient-labs'}).length,1);
const beforeAsk=fetches.length;
await act(async()=>screen.root.findByType('textarea').props.onChange({target:{value:'Explain these readings'}}));
assert.equal(screen.root.findByProps({type:'submit'}).props.disabled,false,'Messages refresh with decisions off must not disable Zoe');
await send('Explain these readings');assert.equal(fetches.length,beforeAsk+1);
assert.match(html(),/Explain these readings/);
await act(async()=>screen.unmount());decisionsOff=false;
console.log('Patient chat: decisions-off mounted composer, chips, BP/labs and Zoe submission passed (mocked IO).');
restoreFail=true;memberFail=true;await mount(member);assert.match(html(),/history-failed|conversation-failed/);
assert.equal(screen.root.findByProps({type:'submit'}).props.disabled,true,'Unavailable member cannot start a turn');
await act(async()=>screen.unmount());
console.log('Patient chat: mounted A→B→A history isolation, fixed identity header, five chips, cross-member choice, scoped card actions and unmount cancellation passed (mocked action/stream IO).');

// The server must not transcribe a failed or globally capped alert read as this member having no alerts.
const actionSource=readFileSync('lib/staff-zoe/chat-v2-actions.ts','utf8');
const actionModules:Record<string,unknown>=Object.fromEntries(ts.preProcessFile(actionSource).importedFiles.map(x=>[x.fileName,{}]));
let partial=false,capped=false;
Object.assign(actionModules,{
 zod:{z},'@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 '@/lib/staff/real-staff-access':{chatDoctorEnabled:()=>true,chatDoctorIdentity:()=>true},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>({identity:{role:'doctor',id:'doctor'},client:{rpc:async()=>({data:true,error:null})}})},
 '@/lib/staff/chat-member-identity-read':{readChatMemberIdentities:async()=>[identity]},
 './card-read':{runDoctorCard:async()=>({kind:'ready',card:'alerts',incomplete:partial,capped,inbox:{alerts:[]}})},
});
const alertActions=load('lib/staff-zoe/chat-v2-actions.ts',actionModules) as {readDoctorPatientChatAlerts:(id:string,doctor:string)=>Promise<{kind:string}>};
assert.equal((await alertActions.readDoctorPatientChatAlerts(member,'doctor')).kind,'alerts');
partial=true;assert.equal((await alertActions.readDoctorPatientChatAlerts(member,'doctor')).kind,'unavailable');
partial=false;capped=true;assert.equal((await alertActions.readDoctorPatientChatAlerts(member,'doctor')).kind,'unavailable');
console.log('Patient chat: partial and capped portfolio alert reads stay unavailable (mocked server ports).');

// The public route stays dark before any page/auth read, matching the general-chat flag boundary.
let routeOn=false,pageReads=0;
const publicPage=load('app/staff/real/(review)/doctor-chat-v2/patient/[memberId]/page.tsx',{
 zod:{z},'next/navigation':{notFound:()=>{throw Error('404');}},
 '@/lib/staff-zoe/workspace-config':{doctorChatV2Enabled:()=>routeOn},
 '@/components/doctor-chat-v2/patient-chat-page':{patientChatPage:async(id:string)=>{pageReads++;return id;}},
}).default as (context:{params:Promise<{memberId:string}>;searchParams:Promise<Record<string,never>>})=>Promise<unknown>;
await assert.rejects(()=>publicPage({...context,searchParams:Promise.resolve({})}),/404/);assert.equal(pageReads,0);
routeOn=true;assert.equal(await publicPage({...context,searchParams:Promise.resolve({})}),member);assert.equal(pageReads,1);
console.log('Patient chat: public flag gate refuses before page/auth reads.');

// Main's member-owned plan journeys run under the real PatientChat tree. Only
// server action IO, browser APIs and timeout duration are controlled.
{
 const {fixturePlan,fixtureAiPlan,fixtureLab,fixtureFile}=await import('../e2e/doctor-chat-v2/data');
 const {staffAlertReason}=await import('@/lib/staff/alert-label');
 const at='2026-11-02T08:00:00Z',actorId='fictional-doctor',memberB=other;
 type ReactTestRenderer=Renderer;
 const modules:Record<string,unknown>={...componentModules};
 const doc=Object.assign(new EventTarget(),{hidden:false});
 const timers=new Set<()=>void>();
 const io:Record<string,unknown>={};
 let patientHistory:import('@/lib/staff-zoe/chat-v2-zoe-read').ChatZoeHistoryResponse={kind:'history',conversations:[],turns:[],target:null};
 let streamChunks:string[]=[],holdResponse=false,holdStream:ReadableStreamDefaultController<Uint8Array>|null=null;
 const zoeRequests:{signal:AbortSignal}[]=[];
 let patientData=fixtureMember(member),patientAlerts:import('@/lib/doctor-inbox/contracts').AlertItem[]=[];
 let newestCalls=0;
 Object.assign(modules,{
  'next/navigation':{useRouter:()=>({push:(path:string)=>paths.push(path),refresh:()=>{}}),unstable_rethrow:()=>{}},
  '@/components/chat-v2/use-thread-scroll':{useThreadScroll:()=>({threadRef:null,contentRef:null,unread:false,stopFollowing:()=>{},newest:()=>{newestCalls++;}})},
  '@/lib/staff-zoe/chat-v2-actions':io,
 });
 Object.assign(io,{
  readDoctorPatientChatHistory:async()=>patientHistory,
  openDoctorChatZoe:async()=>({ok:true,conversationId:member}),
  openDoctorChatMember:async()=>structuredClone(patientData),readDoctorChatConversation:async()=>structuredClone(patientData),
  readDoctorPatientChatAlerts:async()=>({kind:'alerts',alerts:structuredClone(patientAlerts)}),
  findDoctorChatQuestionMember:async()=>({kind:'keep'}),readDoctorChatAiPlan:async()=>({kind:'off'}),
 });
 function load(file:string){
  const exports:Record<string,unknown>={};
  vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
   exports,Date,crypto,Event,AbortController,TextDecoder,TextEncoder,document:doc,
   fetch:async(_url:string,options:{signal:AbortSignal})=>{
    zoeRequests.push({signal:options.signal});
    return new Response(new ReadableStream<Uint8Array>({start(controller){for(const chunk of streamChunks)controller.enqueue(new TextEncoder().encode(chunk));if(holdResponse)holdStream=controller;else controller.close();}}));
   },
   FormData:class extends FormData{constructor(form?:{fields:Record<string,string>}){super();for(const [key,value]of Object.entries(form?.fields??{}))this.set(key,value);}},
   setInterval:(fn:()=>void)=>{timers.add(fn);return fn;},clearInterval:(fn:()=>void)=>timers.delete(fn),
   require:(name:string)=>{if(name.endsWith('.css'))return {};assert.ok(name in modules,`Unmocked ${name}`);return modules[name];},
  });return exports;
 }
 const alert=(key:string)=>({...fixtureAlert(key),memberId:member,alert:{...fixtureAlert(key).alert,id:key,memberId:member}});
 for(const path of ['@/lib/doctor-inbox/contracts','@/lib/staff-zoe/approvals-history','@/components/staff/doctor-workspace/day-cards','@/lib/doctor-inbox/urgent-windows','@/lib/ai-plan/current','@/lib/lab-ai/empty-read-copy','@/lib/staff/doctor-upload-overrides','@/lib/staff-zoe/contracts','@/lib/staff-zoe/typed-language','@/lib/staff-zoe/handover','@/lib/staff-zoe/small-talk','@/lib/ai-plan/contracts','@/lib/ai-plan/display','@/lib/ai-plan/language','@/lib/staff/alert-label','@/lib/care-alerts/contracts','@/lib/gp-report/results-copy','@/lib/staff/yerevan-time','@/lib/locale'])modules[path]=await import(path);
 modules['@/components/staff/upload-identity-check']=await import('@/components/staff/upload-identity-check');
 modules['@/components/conversation/reply-draft-sources']=await import('@/components/conversation/reply-draft-sources');
 modules['@/lib/telegram-runtime/delivery-copy']=await import('@/lib/telegram-runtime/delivery-copy');
 modules['@/components/conversation/delivery-retry']=await import('@/components/conversation/delivery-retry');
 modules['@/components/staff/zoe/answer']=await import('@/components/staff/zoe/answer');
 modules['@/components/staff/alert-card']=await import('@/components/staff/alert-card');
 modules['./conversation']=load('components/doctor-chat-v2/conversation.tsx');
 modules['@/components/staff/care-alert-resolve']=resolveTestModule();
 modules['./alerts']=load('components/doctor-chat-v2/alerts.tsx');
 modules['./lab-review-action']=load('components/doctor-chat-v2/lab-review-action.tsx');
 modules['./member-banner']=load('components/doctor-chat-v2/member-banner.tsx');
 modules['./messages']=load('components/doctor-chat-v2/messages.tsx');
// Real plan cards and thread transitions with controlled reads and the guarded press port.
for(const path of ['@/components/patient-care/common','@/lib/staff/staff-server-copy','@/lib/first-note/compose','@/lib/service-workflow/publication','@/components/patient-care/regimen-changes'])modules[path]=await import(path);
modules['@/lib/first-note/actions']={approveFirstNote:()=>{throw Error('No first-note adoption in chat');}};
modules['@/lib/doctor-decisions/approval-actions']={pressClinicalCard:()=>{throw Error('Chat must use its guarded port');}};

modules['next/link']={default:(props:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement('a',props)};
for(const path of ['@/lib/patient-care/consultation-proposal','@/components/real-review/use-consultation-decision','@/lib/doctor-decisions/publication-gate','@/lib/patient-care/action-timeout','@/components/real-review/clinical-summary','@/components/real-review/urgent-publication'])modules[path]=await import(path);
modules['@/lib/patient-care/clinical-review-actions']={checkRealClinicalCaseAvailability:()=>{throw Error('Chat refresh stays in thread');}};
modules['@/components/staff/doctor-workspace/approval-cards']=load('components/staff/doctor-workspace/approval-cards.tsx');
modules['@/lib/ai-plan/actions']={recordAiPlanAdoption:()=>{throw Error('Chat must use guarded adoption');}};
modules['@/lib/patient-care/clinical-actions']={saveRealDraft:()=>{throw Error('Chat must use guarded save');}};
modules['@/lib/patient-care/clinical-review-actions']={checkRealClinicalCaseAvailability:()=>{throw Error('Chat refresh stays in thread');}};
modules['@/lib/patient-care/regimen']=await import('@/lib/patient-care/regimen');modules['./regimen']={RegimenEditor:()=>null};
modules['./medicine-checks']=await import('@/components/real-review/medicine-checks');

modules['@/lib/ai-plan/draft-fields']=await import('@/lib/ai-plan/draft-fields');
modules['@/components/real-review/forms']=load('components/real-review/forms.tsx');
Object.assign(modules['@/lib/staff-zoe/chat-v2-actions']!,{readDoctorChatAiPlan:async()=>({kind:'off'})});
modules['./plan-ready-card']=await import('@/components/doctor-chat-v2/plan-ready-card');modules['@/lib/patient-care/required-lab-match']=await import('@/lib/patient-care/required-lab-match');
Object.assign(modules['./plan']!,load('components/doctor-chat-v2/plan.tsx'));

 const refreshContext=React.createContext<()=>void>(()=>{});
 modules['@/components/staff/record-refresh']={RecordRefreshProvider:refreshContext.Provider,useRecordRefresh:()=>React.useContext(refreshContext)};
 let screen!:ReactTestRenderer;
 const serialized=()=>JSON.stringify(screen.toJSON());
 const button=(label:string)=>screen.root.findAllByType('button').findLast(b=>b.children.join('')===label)!;
 const press=async(label:string)=>{assert.ok(button(label),label);await act(async()=>button(label).props.onClick());};
 const unmount=async()=>{await act(async()=>screen.unmount());assert.equal(timers.size,0);};
 const mountPatient=async(locale:import('@/lib/staff/staff-locale-copy').StaffLocale='en')=>{
  const Patient=load('components/doctor-chat-v2/patient-chat.tsx').PatientChat as React.ComponentType<Record<string,unknown>>;
  let tree!:ReactTestRenderer;
  await act(async()=>{tree=create(React.createElement(Patient,{...props(member),doctorId:actorId,locale,member:fixtureIdentity(member,'Example')}));});
  screen=tree;return tree;
 };
 // Preserve the real parent callbacks while observing the receipts expected by
 // the original child checks. The Plan chip still opens the actual child.
 type PlanProps=React.ComponentProps<typeof import('@/components/doctor-chat-v2/plan').DoctorChatPlan>;
 const planTree=async(Plan:React.ComponentType<PlanProps>,options:PlanProps)=>{
  patientAlerts=options.alerts??[];
  modules['./plan']={DoctorChatPlan:(actual:PlanProps)=>React.createElement(Plan,{...actual,aiDraft:options.aiDraft,
   onSaved:(...args:Parameters<PlanProps['onSaved']>)=>{actual.onSaved(...args);options.onSaved?.(...args);},
   onAction:(...args:Parameters<PlanProps['onAction']>)=>{actual.onAction(...args);options.onAction?.(...args);},
   onCheckAgain:()=>{actual.onCheckAgain();options.onCheckAgain?.();},
  })};
  const tree=await mountPatient(options.locale);
  await act(async()=>tree.root.findByProps({className:'dcv2-controls dcv2-patient-chips'}).findAllByType('button')[2].props.onClick());
  assert.equal(tree.root.findByProps({'data-patient-chat':member}).type,'main');
  return tree;
 };
{
modules['./plan-ready-card']=await import('@/components/doctor-chat-v2/plan-ready-card');modules['@/lib/patient-care/required-lab-match']=await import('@/lib/patient-care/required-lab-match');
const Plan=load('components/doctor-chat-v2/plan.tsx').DoctorChatPlan as typeof import('@/components/doctor-chat-v2/plan').DoctorChatPlan;
let approvals=fixturePlan(member),chatPlanReads=0;
let chatPlanStop:'off'|'unavailable'|'refused'|null=null;
const planCommands:import('@/lib/doctor-decisions/approvals').ClinicalCardCommand[]=[];
let pressResult:import('@/lib/patient-care/clinical-actions').ClinicalFormState={ok:false,message:'Not published: a required laboratory result has not been received yet.'};
Object.assign(modules['@/lib/staff-zoe/chat-v2-actions']!,{
 readDoctorChatPlan:async(id:string,expected:string)=>{assert.equal(expected,actorId);assert.equal(id,member);chatPlanReads++;return chatPlanStop?{kind:chatPlanStop}:{kind:'plan',approvals:structuredClone(approvals)};},
 pressDoctorChatPlan:async(command:import('@/lib/doctor-decisions/approvals').ClinicalCardCommand,expected:string)=>{assert.equal(expected,actorId);planCommands.push(command);return pressResult;},
});
// The unsigned matcher must not turn member words into clinical classifications.
// Available unresolved alerts sit outside the saved plan and use the ordinary member-open path.
const memberData=fixtureMember(member);
memberData.thread.push({key:'unsigned-message',who:'member',name:memberData.memberName,text:'I have chest pain. Can I change my medicine?',at});
const hoursAgo=(n:number)=>new Date(Date.now()-n*3600_000).toISOString();
memberData.thread.push(
 {key:'m-old',who:'member',name:memberData.memberName,text:'Too old to show',at:hoursAgo(60)},
 {key:'m-1',who:'member',name:memberData.memberName,text:'My chest hurts when I climb the stairs',at:hoursAgo(30)},
 {key:'m-doctor',who:'doctor',name:'Aram',text:'A doctor line is not the member',at:hoursAgo(20)},
 {key:'m-2',who:'member',name:memberData.memberName,text:'I stopped the tablets',at:hoursAgo(10)},
 {key:'m-3',who:'member',name:memberData.memberName,text:'Please call me',at:hoursAgo(5)},
 {key:'m-4',who:'member',name:memberData.memberName,text:'x'.repeat(300),at:hoursAgo(1)},
);
Object.assign(modules['@/lib/staff-zoe/chat-v2-actions']!,{readDoctorChatAiPlan:async()=>fixtureAiPlan(member)});
for(const locale of ['en','hy','ru'] as const){
 const heading=copy.st(locale,'Answer these first','Նախ պատասխանեք սրանց','Сначала ответьте на это');
 const open=copy.st(locale,'Open conversation','Բացել զրույցը','Открыть переписку');
 const acknowledged={...alert('acknowledged'),alert:{...alert('acknowledged').alert,state:'acknowledged' as const}};
 const other={...alert('other'),memberId:memberB,alert:{...alert('other').alert,memberId:memberB}};
 const resolved={...alert('resolved'),alert:{...alert('resolved').alert,state:'resolved' as const}};
 patientAlerts=[alert('open'),acknowledged,other,resolved];
 patientData=memberData;await planTree(Plan,{memberId:member,name:'Example',doctorId:actorId,aiDraft:false,locale,alerts:patientAlerts,onOpen(){},onSaved(){},onAction(){},onCheckAgain(){}});
 const block=screen!.root.findByProps({'data-plan-member':member});
 const first=block.findByProps({className:'dcv2-answer-first'});
 assert.equal(first.findByType('h3').children.join(''),heading);
 assert.equal(first.findAllByType('ul')[0].findAllByType('li').length,2,'Every unresolved alert for this member is shown, including acknowledged alerts');
 assert.ok(first.findAllByType('p').some(p=>p.children.join('')===staffAlertReason(alert('open').alert,locale)));
 assert.deepEqual(first.findAllByType('ul')[0].findAllByType('time').map(n=>n.props.dateTime),[at,at]);
 const children=block.findAllByType('section');
 assert.ok(children.indexOf(first)<children.findIndex(n=>n.props['data-decision']==='regimen'),'Alerts precede the saved plan');
 assert.ok(children.indexOf(first)<children.findIndex(n=>n.props.className==='dcv2-ai-plan'),'Alerts precede the AI draft');
 assert.ok(!first.findAllByType('p').some(p=>p.children.join('').includes('chest pain')),'The unsigned matcher does not classify member words');
 const explanation=block.findAllByType('textarea').find(n=>n.props.name==='explanation')!;
 assert.equal(explanation.props.value,'Exact saved explanation');
 const save=block.findAllByType('button').find(b=>b.children.join('')===copy.st(locale,'Use this draft','Օգտագործել այս սևագիրը','Использовать этот черновик'))!;
 const saveDisabled=save.props.disabled;
 assert.ok(block.findByProps({'data-decision':'regimen'}).findAllByType('p').some(p=>p.children.join('')==='Exact saved explanation'));
 const card=block.findByProps({'data-decision':'regimen'});
 const controls=card.findAllByType('button').map(n=>[n.children.join(''),n.props.disabled]);
 const editor=card.findByType('textarea');
 await act(async()=>editor.props.onChange({target:{value:'Keep this plan edit'}}));
 const beforePollScroll=newestCalls;patientAlerts=[];await act(async()=>{for(const poll of timers)poll();});
 assert.equal(newestCalls,beforePollScroll,'Plan refresh never scrolls the history reader to newest');
 assert.equal(block.findByProps({className:'dcv2-answer-first'}).findAllByType('ul')[0].findAllByType('li').length,0,'A successful empty poll removes alerts that closed elsewhere');
 assert.equal(editor.props.value,'Keep this plan edit');
 assert.equal(explanation.props.value,'Exact saved explanation');assert.equal(save.props.disabled,saveDisabled);
 assert.deepEqual(card.findAllByType('button').map(n=>[n.children.join(''),n.props.disabled]),[
  [copy.st(locale,'Review the medicines and doses, then tick the confirmation','Վերանայեք դեղերն ու դեղաչափերը, ապա նշեք հաստատման վանդակը','Проверьте лекарства и дозы, затем отметьте подтверждение'),undefined],
  ...controls,
 ],'Clearing urgent alerts exposes the named next step and preserves every approval control');
 patientAlerts=[alert('poll-open')];await act(async()=>{for(const poll of timers)poll();});
 assert.equal(block.findByProps({className:'dcv2-answer-first'}).findAllByType('ul')[0].findAllByType('li').length,1,'A new poll updates the mounted plan');
 await act(async()=>block.findByProps({className:'dcv2-answer-first'}).findAllByType('button').find(b=>b.children.join('')===open)!.props.onClick());
 const conversation=screen.root.findByProps({'data-conversation-member':member});
 assert.ok(conversation.findAllByType('p').some(p=>p.children.join('').includes('chest pain')),'The member conversation keeps the original words');
 const carePlan=copy.st(locale,'Care plan','Խնամքի պլան','План лечения');
 await act(async()=>conversation.findAllByType('button').find(b=>b.children.join('')===carePlan)!.props.onClick());
 assert.equal(screen.root.findAllByProps({'data-plan-member':member}).length,1,'The member care-plan action opens the same block');
// Lead, 4 Nov: under the alerts, Answer these first shows the member's last three messages from the last 48 hours, verbatim and unfiltered, with date and time.
 {
  const first=screen.root.findAllByType('article').at(-1)!.findByProps({className:'dcv2-answer-first'});
  const lines=first.findAllByType('p').map(p=>p.children.join(''));
  assert.ok(lines.includes(`${'x'.repeat(240)}…`),`${locale}: a long message is cut at 240 characters`);
  assert.ok(lines.includes('Please call me')&&lines.includes('I stopped the tablets'),`${locale}: the last three member messages show`);
  assert.ok(!lines.includes('My chest hurts when I climb the stairs'),`${locale}: only three`);
  assert.ok(!lines.some(line=>/Too old|A doctor line/.test(line)),`${locale}: older than 48 hours and doctor lines are left out`);
  assert.ok(first.findAllByType('time').length>=3,'Every message carries its date and time');
  assert.ok(lines.indexOf('Please call me')<lines.indexOf('I stopped the tablets'),'Newest first');
 }
 await unmount();
 patientAlerts=[];
 patientData=fixtureMember(member);await planTree(Plan,{memberId:member,name:'Example',doctorId:actorId,aiDraft:false,locale,alerts:patientAlerts,onOpen(){},onSaved(){},onAction(){},onCheckAgain(){}});
 assert.equal(screen!.root.findByProps({'data-plan-member':member}).findAllByProps({className:'dcv2-answer-first'}).length,0,'No empty heading or conversation button');
 await unmount();
}
patientData=fixtureMember(member);chatPlanReads=0;
Object.assign(modules['@/lib/staff-zoe/chat-v2-actions']!,{readDoctorChatAiPlan:async()=>({kind:'off'})});
console.log('Plan answer-first: localized unresolved alerts, member isolation, dates, poll refresh, unchanged controls and edits, empty state and conversation action passed (mounted, controlled IO).');
patientAlerts=[];
await planTree(Plan,{memberId:member,name:'Example',doctorId:actorId,aiDraft:false,locale:'en',onOpen(){},onSaved(){},onAction(){},onCheckAgain(){}});
assert.equal(chatPlanReads,1);assert.equal(planCommands.length,0,'Opening never publishes or adopts');
assert.equal(screen.root.findAllByType('a').filter(a=>!String(a.props.href).endsWith('#member-alerts')).length,0);
assert.deepEqual(screen!.root.findAll(n=>!!n.props['data-decision']).map(n=>n.props['data-decision']),['consultation','regimen']);
const regimen=()=>screen!.root.findAllByProps({'data-decision':'regimen'})[0];
const approvePlan=()=>regimen().findAllByType('button').find(b=>b.children.join('')==='Approve and publish this plan')!;
assert.equal(approvePlan().props.disabled,true);
await act(async()=>regimen().findByType('textarea').props.onChange({target:{value:'Exact replacement summary'}}));
assert.equal(approvePlan().props.disabled,true,'Summary alone cannot approve');
await act(async()=>regimen().findByType('input').props.onChange({target:{checked:true}}));
await act(async()=>regimen().findByType('textarea').props.onChange({target:{value:'  '}}));
assert.equal(approvePlan().props.disabled,true,'The tick cannot replace the required change summary');
await act(async()=>regimen().findByType('textarea').props.onChange({target:{value:'Exact replacement summary'}}));
await act(async()=>{approvePlan().props.onClick();approvePlan().props.onClick();});
assert.equal(planCommands.length,1);
assert.deepEqual(JSON.parse(JSON.stringify(planCommands[0])),{kind:'regimen',context:approvals.regimen!.context,requestId:approvals.regimen!.requestId,regimenHash:approvals.regimen!.review.draft!.approvalHash,approved:true,changeSummary:'Exact replacement summary'});
assert.equal(approvePlan().props.disabled,true);assert.equal(regimen().findByType('textarea').props.disabled,true);
assert.match(serialized(),/Not published: a required laboratory result has not been received yet\./);
assert.equal(screen.root.findAllByProps({'data-plan-member':member}).length,1,'Refusal stays in the block');
await act(async()=>screen!.root.findAllByType('button').find(b=>b.children.join('')==='Check again')!.props.onClick());
assert.equal(chatPlanReads,2);assert.equal(screen.root.findAllByProps({'data-decision':'regimen'}).length,1,'Explicit retry replaces the refused patient card with fresh controls');
const newestPlanKey=screen.root.findAllByType('article').at(-1)!.props['data-message-key'];
await act(async()=>screen.root.findByProps({className:'dcv2-controls dcv2-patient-chips'}).findAllByType('button')[2].props.onClick());
assert.equal(screen.root.findAllByType('article').at(-1)!.props['data-message-key'],newestPlanKey,'Reopening returns to the latest plan read, not an older refusal');
const fresh=screen.root.findByProps({'data-decision':'regimen'});
pressResult={ok:true,message:'Care plan published. Any notice depends on your member’s saved messaging consent.'};
await act(async()=>fresh.findByType('input').props.onChange({target:{checked:true}}));
await act(async()=>fresh.findByType('textarea').props.onChange({target:{value:'New exact summary'}}));
await act(async()=>fresh.findAllByType('button').find(b=>b.children.join('')==='Approve and publish this plan')!.props.onClick());
assert.equal(screen!.root.findAllByProps({'data-decision':'regimen'}).length,0,'The used card leaves its place');
assert.equal(screen.root.findAllByType('article').at(-2)!.findByType('p').children.join(''),'Plan approved and published');
assert.equal(screen.root.findAllByType('article').at(-1)!.findByType('p').children.join(''),'Done: '+pressResult.message);
assert.equal(screen!.root.findAllByProps({'data-decision':'consultation'}).length,1,'Sibling cards remain mounted');
await unmount();
// Consultation saves have the same append-only dialog rule and leave the regimen intact.
approvals=fixturePlan(member);
pressResult={ok:true,message:'Review saved. Reload the case before the next step.'};
await planTree(Plan,{memberId:member,name:'Example',doctorId:actorId,aiDraft:false,locale:'en',onOpen(){},onSaved(){},onAction(){},onCheckAgain(){}});
const consultationCard=screen!.root.findByProps({'data-decision':'consultation'});
assert.equal(consultationCard.findByType('select').props.value,'');
assert.equal(consultationCard.findByType('textarea').props.value,'');
await act(async()=>consultationCard.findByType('select').props.onChange({target:{value:'not-required'}}));
await act(async()=>consultationCard.findByType('textarea').props.onChange({target:{value:'Doctor entered reason'}}));
await act(async()=>consultationCard.findByType('form').props.onSubmit({preventDefault(){}}));
assert.equal(screen!.root.findAllByProps({'data-decision':'consultation'}).length,0);
assert.equal(screen!.root.findAllByProps({'data-decision':'regimen'}).length,1);
assert.equal(screen.root.findAllByType('article').at(-2)!.findByType('p').children.join(''),'Consultation not required');
assert.equal(screen.root.findAllByType('article').at(-1)!.findByType('p').children.join(''),'Done: '+pressResult.message);
assert.deepEqual(JSON.parse(JSON.stringify(planCommands.at(-1))),{kind:'consultation-decision',context:approvals.consultation!.context,decision:'not-required',note:'Doctor entered reason'});
await unmount();
for(const decision of ['undecided','required','not-required'] as const){
 for(const completedAt of [undefined,at]){
  approvals=fixturePlan(member);approvals.consultation!.review.consultation={decision,completedAt,evidenceToken:approvals.consultation!.context.evidenceToken};
  await planTree(Plan,{memberId:member,name:'Example',doctorId:actorId,aiDraft:false,locale:'en',onOpen(){},onSaved(){},onAction(){},onCheckAgain(){}});
  assert.equal(screen!.root.findAllByProps({'data-decision':'consultation'}).length,decision==='undecided'||decision==='required'&&!completedAt?1:0);
  assert.equal(screen!.root.findAllByProps({'data-decision':'regimen'}).length,1);
  await unmount();
 }
}
for(const stop of ['off','unavailable','refused','ai-only'] as const){
 chatPlanStop=stop==='ai-only'?null:stop;approvals=fixturePlan(member);if(stop==='ai-only')approvals.regimen=null;
 await planTree(Plan,{memberId:member,name:'Example',doctorId:actorId,aiDraft:false,locale:'en',onOpen(){},onSaved(){},onAction(){},onCheckAgain(){}});
 assert.equal(screen!.root.findAllByProps({'data-decision':'regimen'}).length,0);
 assert.equal(screen.root.findAllByType('a').filter(a=>!String(a.props.href).endsWith('#member-alerts')).length,0);
 assert.match(serialized(),stop==='ai-only'?/No saved plan is waiting for approval for Example\./:stop==='refused'?/access is unavailable\./i:stop==='off'?/this action is switched off/i:/the plan cannot be approved in this chat yet\./i);
 await unmount();
}
for(const file of ['components/doctor-chat-v2/plan.tsx','lib/staff-zoe/chat-v2-actions.ts'])assert.doesNotMatch(readFileSync(file,'utf8'),/generatePlanDraft|clinicalWriteClient|publish_patient/,'Chat cannot add a second generation or publication path');
console.log('Patient plan: guarded reads and writes, approval tick and summary, exact tokens, refusal lock, explicit fresh retry, sibling preservation, ordered receipts and consultation decisions passed.');


}

// F-P0-2: a prepare receipt must describe the editor actually on screen.
{
 const io=modules['@/lib/staff-zoe/chat-v2-actions'] as Record<string,unknown>,before={...io};
 const Plan=(modules['./plan'] as typeof import('@/components/doctor-chat-v2/plan')).DoctorChatPlan;
 const freshId='d6a00000-0000-4000-8000-000000000002';
 for(const locale of ['en','hy','ru'] as const)for(const state of ['shown','missing','published','adopted','stale','old','off','unavailable','throw','lost','regimen','first-read-unavailable','first-read-throw','first-read-missing'] as const){
  let prepared=false,prepares=0,postPrepareReads=0;
  const previous=fixtureAiPlan(member);previous.snapshot.draft=null as unknown as typeof previous.snapshot.draft;
  const next:import('@/lib/staff-zoe/chat-v2-actions').ChatAiPlanResponse=structuredClone(previous);
  next.generation!.id=freshId;
  if(state==='missing'||state==='published'||state==='adopted')next.generation=null;
  if(state==='published')next.published=true;
  if(state==='stale')next.stale=true;
  if(state==='old')next.generation!.id=previous.generation.id;
  if(state==='regimen')next.snapshot.draft=fixturePlan(member).regimen!.draft;
  Object.assign(io,{
   readDoctorChatPlan:async()=>({kind:'plan',approvals:{...fixturePlan(member),regimen:state==='regimen'?fixturePlan(member).regimen:null}}),
   readDoctorChatAiPlan:async()=>{
    if(!prepared)return state==='lost'?previous:{...previous,generation:state==='regimen'?previous.generation:null};
    postPrepareReads++;
    if(state==='first-read-unavailable'&&postPrepareReads===1)return {kind:'unavailable'};
    if(state==='first-read-throw'&&postPrepareReads===1)throw Error('Synthetic first reread failure');
    if(state==='first-read-missing'&&postPrepareReads===1)return {...next,generation:null};
    if(state==='throw')throw Error('Synthetic reread failure');
    return state==='off'||state==='unavailable'?{kind:state}:state==='lost'?{...next,generation:null}:next;
   },
   prepareDoctorChatAiPlan:async()=>{prepared=true;prepares++;return {ok:true,generationId:freshId,message:'Draft prepared. Check each marked field before saving.'};},
  });
  const card:ReactTestRenderer=await planTree(Plan,{memberId:member,name:'Example',aiDraft:false,doctorId:actorId,locale,onOpen(){},onSaved(){},onCheckAgain(){},onAction(){}});
  const prepare=card!.root.findAllByType('button').find(b=>b.children.join('')===copy.st(locale,state==='lost'||state==='regimen'?'Prepare again':'Prepare care plan',state==='lost'||state==='regimen'?'Պատրաստել կրկին':'Պատրաստել խնամքի պլան',state==='lost'||state==='regimen'?'Подготовить снова':'Подготовить план ухода'))!;
  await act(async()=>prepare.props.onClick());
  const text=JSON.stringify(card!.toJSON()),success=/Draft prepared|Սևագիրը պատրաստ է|Черновик подготовлен/u.test(text);
  const expectedSuccess=state==='shown'||state==='regimen'||state.startsWith('first-read-');
  assert.equal(prepares,1,'Opening a prepared draft never repeats preparation');
  if(state.startsWith('first-read-'))assert.equal(postPrepareReads,2,'Retry just the failed read once');
  assert.equal(success,expectedSuccess,`${locale}: ${state} must never claim a hidden, stale or different draft was prepared`);
  if(expectedSuccess){
   assert.equal(card!.root.findAllByType('form').filter(f=>f.props.className==='dcv2-draft').length,1,'Prepared editor is inline');
   assert.ok(card!.root.findAllByType('button').some(b=>b.children.join('')===copy.st(locale,'Use this draft','Օգտագործել այս սևագիրը','Использовать этот черновик')));
  }else{
   assert.ok(card!.root.findAllByProps({role:'alert'}).length,`${state} has a plain error`);
   assert.ok(card!.root.findAllByType('button').some(b=>b.children.join('')===copy.st(locale,'Try again','Փորձել կրկին','Попробовать снова')),`${state} offers retry`);
  }
  await act(async()=>card!.unmount());
 }
 for(const locale of ['en','hy','ru'] as const){
  Object.assign(io,{readDoctorChatPlan:async()=>({kind:'plan',approvals:{...fixturePlan(member),regimen:null,firstNote:{...fixturePlan(member).firstNote!,data:{...fixturePlan(member).firstNote!.data,urgent:true}}}}),readDoctorChatAiPlan:async()=>({kind:'off'})});
  const card:ReactTestRenderer=await planTree(Plan,{memberId:member,name:'Example',aiDraft:false,doctorId:actorId,locale,onOpen(){},onSaved(){},onCheckAgain(){},onAction(){}});
  assert.match(JSON.stringify(card!.toJSON()),locale==='en'?/urgent alert.*Review.*resolve/iu:locale==='hy'?/շտապ ահազանգ/u:/срочное оповещение/u);
  assert.equal(card!.root.findAllByType('button').filter(b=>/^(Prepare care plan|Պատրաստել խնամքի պլան|Подготовить план ухода)$/u.test(b.children.join(''))).length,0);
  await act(async()=>card!.unmount());
 }
 Object.assign(io,before);
}
console.log('F-P0-2: mounted plan prepare receipts match readable current editors; missing, adopted, published, stale, old, lost, off and failed rereads show retry; urgent reason in en/hy/ru.');
// D33: the mounted draft card exposes unknown/untranslated language, and uses explicit staff summary locale.
{
 const io=modules['@/lib/staff-zoe/chat-v2-actions'] as Record<string,unknown>,before={...io};
 const Plan=(modules['./plan'] as typeof import('@/components/doctor-chat-v2/plan')).DoctorChatPlan;
 const {MEMBER_LANGUAGE_UNKNOWN,PLAN_TRANSLATION_MISSING}=await import('@/lib/ai-plan/language');
 for(const locale of ['en','hy','ru'] as const)for(const language of [null,'ru','hy'] as const){
  const ai:Extract<import('@/lib/staff-zoe/chat-v2-actions').ChatAiPlanResponse,{kind:'ai-plan'}>=fixtureAiPlan(member);
  ai.generation!.guard=[language===null?'member_language_unknown':`member_language:${language}`,`summary_language:${locale}`,...(language==='ru'?['member_translation_missing:ru']:[])];
  ai.generation!.items=[{id:'protocol:egfr-chronicity',section:'tests',status:'needs_doctor_judgement',text:'eGFR 52: a single low value is not chronic kidney disease; check persistence over at least 3 months.',rationale:'CKD needs an abnormality persisting at least 3 months. Repeat timing is the doctor’s.',timing:'Repeat assessment after checking chronicity.',source:{kind:'lab',ref:'synthetic',label:'eGFR'},member:null}] as unknown as NonNullable<typeof ai.generation>['items'];
  const summary=copy.st(locale,'Synthetic doctor summary','Փորձնական բժշկական ամփոփում','Проверочная сводка для врача');ai.generation!.summary=summary;
  Object.assign(io,{readDoctorChatPlan:async()=>({kind:'plan',approvals:{...fixturePlan(member),regimen:null}}),readDoctorChatAiPlan:async()=>structuredClone(ai)});
  const card=await planTree(Plan,{memberId:member,name:'Example',aiDraft:false,doctorId:actorId,locale,onOpen(){},onSaved(){},onCheckAgain(){},onAction(){}});
  const rendered=JSON.stringify(card.toJSON());
  assert.ok(rendered.includes(summary),`${locale}: the explicitly localized doctor summary is displayed`);
  if(language===null)assert.ok(rendered.includes(MEMBER_LANGUAGE_UNKNOWN[locale]));
  if(language==='ru')assert.ok(rendered.includes(PLAN_TRANSLATION_MISSING[locale]));
  if(language==='hy')assert.ok(!rendered.includes(MEMBER_LANGUAGE_UNKNOWN[locale]));
  for(const item of ai.generation!.items){assert.ok(rendered.includes(item.text));assert.ok(rendered.includes(item.rationale));assert.ok(rendered.includes(item.timing!));}
  if(locale!=='en')assert.ok(rendered.includes(copy.st(locale,'Shown in English: not translated yet','Ցուցադրված է անգլերեն․ դեռ թարգմանված չէ','Показано на английском: ещё не переведено')));
  await act(async()=>card.unmount());
 }
 // Mismatched and legacy summaries stay readable while both warnings are visible.
 for(const locale of ['en','hy','ru'] as const)for(const summaryLanguage of [null,'en','unknown'] as const){
  const ai:Extract<import('@/lib/staff-zoe/chat-v2-actions').ChatAiPlanResponse,{kind:'ai-plan'}>=fixtureAiPlan(member);
  ai.generation!.summary='Several items need your judgement.';
  ai.generation!.guard=summaryLanguage===null?[]:['member_language_unknown',`summary_language:${summaryLanguage}`];
  Object.assign(io,{readDoctorChatPlan:async()=>({kind:'plan',approvals:{...fixturePlan(member),regimen:null}}),readDoctorChatAiPlan:async()=>structuredClone(ai)});
  const card=await planTree(Plan,{memberId:member,name:'Example',aiDraft:false,doctorId:actorId,locale,onOpen(){},onSaved(){},onCheckAgain(){},onAction(){}});
  const rendered=JSON.stringify(card.toJSON());
  assert.ok(rendered.includes(ai.generation!.summary));
  assert.ok(rendered.includes(MEMBER_LANGUAGE_UNKNOWN[locale]));
  const mismatch=copy.st(locale,'Summary is in a different language than your screen','Ամփոփման լեզուն տարբերվում է ձեր էկրանի լեզվից','Язык резюме отличается от языка вашего экрана');
  assert.equal(rendered.includes(mismatch),summaryLanguage!==locale);
  await act(async()=>card.unmount());
 }
 Object.assign(io,before);
}

// A lab refresh must never remount the editor or replace unsaved instructions.
{
 const io=modules['@/lib/staff-zoe/chat-v2-actions'] as Record<string,unknown>,before={...io};
modules['./plan-ready-card']=await import('@/components/doctor-chat-v2/plan-ready-card');modules['@/lib/patient-care/required-lab-match']=await import('@/lib/patient-care/required-lab-match');
 const Plan=load('components/doctor-chat-v2/plan.tsx').DoctorChatPlan as typeof import('@/components/doctor-chat-v2/plan').DoctorChatPlan;
 for(const locale of ['en','hy','ru'] as const)for(const change of ['generation','evidence','generation-and-evidence'] as const){
  let ai:Extract<import('@/lib/staff-zoe/chat-v2-actions').ChatAiPlanResponse,{kind:'ai-plan'}>={...fixtureAiPlan(member),snapshot:{...fixtureAiPlan(member).snapshot,draft:null}};
  Object.assign(io,{readDoctorChatPlan:async()=>({kind:'plan',approvals:{firstNote:null,regimen:null,consultation:null}}),readDoctorChatAiPlan:async()=>structuredClone(ai)});
  const field=(name:string)=>tree.root.findAllByType('textarea').find(n=>n.props.name===name)!;
  const button=(text:string)=>tree.root.findAllByType('button').filter(b=>b.children.join('')===text).at(-1)!;
  const tree=await planTree(Plan,{memberId:member,name:'Example',aiDraft:true,doctorId:actorId,locale,onOpen(){},onSaved(){},onCheckAgain(){},onAction(){}});
  await act(async()=>{field('instructions').props.onChange({target:{value:'Doctor manual instructions that must survive'}});field('activityLimits').props.onChange({target:{value:'Doctor activity limits'}});});
  const editor=tree.root.findByProps({className:'dcv2-draft'});
  if(change!=='evidence'){
   ai.generation={...ai.generation!,id:'d6a00000-0000-4000-8000-000000000002',draft:{explanation:'New AI explanation',instructions:'New AI instructions',followUp:'New AI follow-up'}};
   if(change==='generation-and-evidence')ai.snapshot={...ai.snapshot,revision:5,evidenceToken:'b'.repeat(32)};
  }else{
   ai={...ai,stale:true,snapshot:{...ai.snapshot,revision:5,evidenceToken:'b'.repeat(32),draft:{...fixturePlan(member).regimen!.draft,instructions:'New saved instructions'}}};
  }
  await act(async()=>{doc.dispatchEvent(new Event('noreon:clinical-evidence-changed'));});
  assert.equal(field('instructions').props.value,'Doctor manual instructions that must survive',`${locale}: ${change} refresh retains manual instructions`);
  assert.equal(tree.root.findByProps({className:'dcv2-draft'}),editor,'Editor identity stays stable for the member');
  const notice=locale==='en'?/Your (?:text in the editor is kept|edits are retained)/:locale==='hy'?/(?:տեքստը պահվում է|փոփոխությունները պահված են)/u:/(?:текст в редакторе сохранится|изменения сохранены в форме)/u;
  assert.match(JSON.stringify(tree.toJSON()),notice,'A plain localized notice explains that edits are retained');
  // Further background reads still cannot accept the replacement for the doctor.
  await act(async()=>{doc.dispatchEvent(new Event('noreon:clinical-evidence-changed'));});
  assert.equal(field('instructions').props.value,'Doctor manual instructions that must survive');
  const useNew=copy.st(locale,'Use the new text','Օգտագործել նոր տեքստը','Использовать новый текст');
  assert.ok(button(useNew),'Replacement is an explicit localized choice');
  await act(async()=>button(useNew).props.onClick());
  assert.equal(field('instructions').props.value,change==='evidence'?'New saved instructions':'New AI instructions','Only the explicit choice replaces instructions');
  if(change!=='evidence')assert.equal(field('activityLimits').props.value,'Doctor activity limits','AI text replacement keeps manual non-AI fields');
  if(change==='generation-and-evidence')assert.ok(tree.root.findAllByProps({role:'alert'}).some(n=>/Source evidence changed|Աղբյուրի տվյալները փոխվել են|Исходные данные изменились/u.test(n.children.join(''))),'Accepting new AI text does not acknowledge changed evidence');
  await act(async()=>tree.unmount());assert.equal(timers.size,0);
 }
 Object.assign(io,before);
 console.log('Plan lab refresh: manual edits and mounted editor survive new generations and evidence in en/hy/ru; localized notice and explicit text replacement passed.');
}

// P0-PUBLISH: actual mounted plan/form/cards; only server-action IO and the clock duration are controlled.
{
 const io=modules['@/lib/staff-zoe/chat-v2-actions'] as Record<string,unknown>,before={...io};
 const timeout=await import('@/lib/patient-care/action-timeout');
 const timeoutBefore=modules['@/lib/patient-care/action-timeout'];
 modules['@/lib/patient-care/action-timeout']={...timeout,withClinicalTimeout:<T,>(work:()=>Promise<T>)=>timeout.withClinicalTimeout(work,10)};
 const formsBefore=modules['@/components/real-review/forms'],cardsBefore=modules['@/components/staff/doctor-workspace/approval-cards'];
 modules['@/components/real-review/forms']=load('components/real-review/forms.tsx');
 modules['@/components/staff/doctor-workspace/approval-cards']=load('components/staff/doctor-workspace/approval-cards.tsx');
modules['./plan-ready-card']=await import('@/components/doctor-chat-v2/plan-ready-card');modules['@/lib/patient-care/required-lab-match']=await import('@/lib/patient-care/required-lab-match');
 const Plan=load('components/doctor-chat-v2/plan.tsx').DoctorChatPlan as typeof import('@/components/doctor-chat-v2/plan').DoctorChatPlan;
 let tree!:ReactTestRenderer,saves=0,publishes=0,successes=0,actions=0,prepareFails=true;
 let approvals=fixturePlan(member),ai:Extract<import('@/lib/staff-zoe/chat-v2-actions').ChatAiPlanResponse,{kind:'ai-plan'}>={...fixtureAiPlan(member),generation:null};
 approvals.consultation=null;approvals.regimen!.current=false;approvals.regimen!.clinicalReview=null;
 const json=()=>JSON.stringify(tree.toJSON());
 const button=(text:string)=>tree.root.findAllByType('button').find(b=>b.children.join('')===text)!;
 const submit=async()=>{const form=tree.root.findByProps({className:'dcv2-draft'});const fields=Object.fromEntries([...form.findAllByType('input'),...form.findAllByType('textarea')].filter(n=>n.props.name).map(n=>[n.props.name,String(n.props.value)]));await act(async()=>form.props.onSubmit({preventDefault(){},currentTarget:{fields}}));};
 Object.assign(io,{
  readDoctorChatPlan:async()=>({kind:'plan',approvals:structuredClone(approvals)}),readDoctorChatAiPlan:async()=>structuredClone(ai),
  saveDoctorChatAiPlan:async(_previous:unknown,form:FormData)=>{saves++;assert.equal(form.get('revision'),'5','Lab-confirm refresh reaches the mounted editor before save');
   if(prepareFails)return {ok:false,message:'Clinical review could not be prepared.'};
   ai.snapshot={...ai.snapshot,revision:6,draft:{...ai.snapshot.draft!,instructions:String(form.get('instructions'))}};
   approvals.regimen!.current=true;approvals.regimen!.context.revision=6;approvals.regimen!.clinicalReview=fixturePlan(member).regimen!.clinicalReview;
   approvals.regimen!.clinicalReview!.engine.tests=[{id:'fixture-test',title:'Required clinical recommendation',method:'lab'}];
   return {ok:true,message:'Draft saved privately. No plan is published and no notice is sent.',revision:6};
  },
  recordDoctorChatAiPlanAdoption:async()=>true,
  pressDoctorChatPlan:async()=>{publishes++;return {ok:true,message:'Care plan published.'};},
 });
 const props={memberId:member,name:'Example',aiDraft:true,doctorId:actorId,locale:'en' as const,onOpen(){},onSaved(){successes++;},onCheckAgain(){},onAction(){actions++;}};
 tree=await planTree(Plan,props);
 assert.equal(button('Approve and publish this plan').props.disabled,true,'A null review can never publish');
 await act(async()=>tree.root.findAllByType('textarea').find(n=>n.props.name==='instructions')!.props.onChange({target:{value:'Retain doctor edits'}}));
 ai.snapshot.revision=5;
 await act(async()=>{doc.dispatchEvent(new Event('noreon:clinical-evidence-changed'));});
 assert.equal(tree.root.findAllByType('input').find(n=>n.props.name==='revision')!.props.value,5);
 await submit();assert.equal(saves,1);assert.equal(publishes,0);assert.equal(actions,0);assert.match(json(),/Clinical review could not be prepared/);assert.doesNotMatch(json(),/Done: (?:Plan )?draft saved/i);
 prepareFails=false;await submit();
 assert.equal(saves,2);assert.equal(publishes,0,'Use this draft never publishes');assert.equal(actions,1);
 assert.match(json(),/Required clinical recommendation/);assert.match(json(),/Green/);assert.match(json(),/Done: (?:Plan )?draft saved/i);
 assert.equal(button('Approve and publish this plan').props.disabled,true,'A fresh draft still requires an explicit approval tick');
 await act(async()=>tree.unmount());assert.equal(timers.size,0);
 // Open urgent alerts have plain localized text and a link, and do not permit publication.
 for(const locale of ['en','hy','ru'] as const){
  tree=await planTree(Plan,{...props,locale,alerts:[alert('p0-urgent')]});
  const label=copy.st(locale,'Approve and publish this plan','Հաստատել և հրապարակել այս պլանը','Утвердить и опубликовать этот план');
  assert.equal(button(label).props.disabled,true);
  assert.ok(tree.root.findAllByType('a').some(a=>a.props.href===`/staff/real/members/${member}#member-alerts`));
  assert.match(json(),locale==='en'?/Can't publish while urgent alerts are open/:locale==='hy'?/Բաց շտապ ահազանգերի/:/открыты срочные оповещения/);
  await act(async()=>tree.unmount());assert.equal(timers.size,0);
 }
 // A hung prepare releases the ref; a late response is ignored, and retry runs once.
 let prepares=0,late!:(value:unknown)=>void;
 ai={...fixtureAiPlan(member),snapshot:{...fixtureAiPlan(member).snapshot,draft:null}};
 approvals={...fixturePlan(member),regimen:null,consultation:null};
 Object.assign(io,{prepareDoctorChatAiPlan:async()=>{prepares++;if(prepares===1)return new Promise(resolve=>{late=resolve;});return {ok:true,generationId:ai.generation!.id,message:'Draft prepared. Check each marked field before saving.'};}});
 tree=await planTree(Plan,props);
 await act(async()=>button('Prepare again').props.onClick());
 await act(async()=>new Promise(resolve=>setTimeout(resolve,20)));
 assert.equal(button('Prepare again').props.disabled,false);assert.match(json(),/Taking longer than expected/);assert.doesNotMatch(json(),/Done: Draft prepared/);
 await act(async()=>late({ok:true,generationId:ai.generation!.id,message:'Late success must not be shown'}));assert.doesNotMatch(json(),/Late success/);
 await act(async()=>button('Try again').props.onClick());assert.equal(prepares,2,'Timeout releases the prepare lock');
 assert.match(json(),/Done: Draft prepared/);
 // A hung save releases the pending form and preserves its text until evidence is reloaded.
 io.saveDoctorChatAiPlan=async()=>new Promise(()=>{});
 await act(async()=>button('I checked all, accept all').props.onClick());
 await submit();await act(async()=>new Promise(resolve=>setTimeout(resolve,20)));assert.match(json(),/Taking longer than expected/);assert.equal(button('Use this draft').props['aria-busy'],false);
 assert.ok(button('Refresh evidence'));assert.equal(publishes,0);assert.equal(successes,0);
 await act(async()=>tree.unmount());assert.equal(timers.size,0);
 // Publish also exits its busy state, never emits success and offers an explicit re-read.
 ai={...fixtureAiPlan(member),generation:null};approvals=fixturePlan(member);approvals.consultation=null;
 io.pressDoctorChatPlan=async()=>new Promise(()=>{});
 let reloads=0;
 tree=await planTree(Plan,{...props,onCheckAgain(){reloads++;}});
 const publishedCard=tree.root.findByProps({'data-decision':'regimen'});
 await act(async()=>{publishedCard.findByType('input').props.onChange({target:{checked:true}});publishedCard.findByType('textarea').props.onChange({target:{value:'Reviewed change'}});});
 await act(async()=>button('Approve and publish this plan').props.onClick());
 await act(async()=>new Promise(resolve=>setTimeout(resolve,20)));
 assert.equal(publishedCard.props['aria-busy'],false);assert.match(json(),/Taking longer than expected/);assert.equal(successes,0);
 await act(async()=>button('Check again').props.onClick());assert.equal(reloads,1);
 await act(async()=>tree.unmount());assert.equal(timers.size,0);
 Object.assign(io,before);modules['@/lib/patient-care/action-timeout']=timeoutBefore;modules['@/components/real-review/forms']=formsBefore;modules['@/components/staff/doctor-workspace/approval-cards']=cardsBefore;
 console.log('P0-PUBLISH mounted: missing review blocks publish; lab-confirm refresh preserves edits/current CAS; failed prepare has no success; saved card shows clinical urgency/recommendations; explicit publish only; urgent links in EN/HY/RU; prepare/save timeouts release pending/lock and ignore late success.');
}

// #699 fresh-eyes: consultation invalidates the draft; refresh saves the mounted editor, never publishes.
{
 const io=modules['@/lib/staff-zoe/chat-v2-actions'] as Record<string,unknown>,before={...io};
modules['./plan-ready-card']=await import('@/components/doctor-chat-v2/plan-ready-card');modules['@/lib/patient-care/required-lab-match']=await import('@/lib/patient-care/required-lab-match');
 const Plan=load('components/doctor-chat-v2/plan.tsx').DoctorChatPlan as typeof import('@/components/doctor-chat-v2/plan').DoctorChatPlan;
 for(const locale of ['en','hy','ru'] as const){
  const cards=fixturePlan(member),ai:Extract<import('@/lib/staff-zoe/chat-v2-actions').ChatAiPlanResponse,{kind:'ai-plan'}>={...fixtureAiPlan(member),generation:null};
  let saves=0,publishes=0,prepareFails=true;
  cards.regimen!.clinicalReview!.consultation.decision='undecided';
  const refresh=copy.st(locale,'Refresh draft','Թարմացնել սևագիրը','Обновить черновик');
  const notice=copy.st(locale,'The draft is out of date because the consultation decision changed.','Սևագիրը հնացել է, քանի որ խորհրդատվության որոշումը փոխվել է։','Черновик устарел, потому что решение о консультации изменилось.');
  const publishLabel=copy.st(locale,'Approve and publish this plan','Հաստատել և հրապարակել այս պլանը','Утвердить и опубликовать этот план');
  Object.assign(io,{
   readDoctorChatPlan:async()=>({kind:'plan',approvals:structuredClone(cards)}),readDoctorChatAiPlan:async()=>structuredClone(ai),
   pressDoctorChatPlan:async(command:import('@/lib/doctor-decisions/approvals').ClinicalCardCommand)=>{
    if(command.kind==='regimen'){publishes++;return {ok:false,message:''};}
    cards.consultation=null;cards.regimen!.clinicalReview!.consultation.decision='not-required';
    cards.regimen!.current=false;cards.regimen!.context.revision=5;
    ai.snapshot.revision=5;ai.snapshot.draftStale=true;ai.savedDraftCurrent=false;
    return {ok:true,message:'Review saved. Reload the case before the next step.'};
   },
   saveDoctorChatAiPlan:async(_previous:unknown,form:FormData)=>{
    saves++;assert.equal(form.get('instructions'),'Doctor edits kept through refresh');assert.equal(form.get('revision'),'5');
    assert.equal(form.get('aiGeneration'),null,'Refresh retains the saved doctor text without substituting an AI generation');
    if(prepareFails)return {ok:false,message:'Clinical review could not be prepared.'};
    ai.snapshot={...ai.snapshot,revision:7,draftStale:false,draft:{...ai.snapshot.draft!,instructions:String(form.get('instructions'))}};ai.savedDraftCurrent=true;
    cards.regimen!.draft=ai.snapshot.draft!;cards.regimen!.current=true;cards.regimen!.context.revision=7;
    return {ok:true,message:'Draft saved privately. No plan is published and no notice is sent.',revision:7};
   },recordDoctorChatAiPlanAdoption:async()=>true,
  });
  const tree:ReactTestRenderer=await planTree(Plan,{memberId:member,name:'Example',aiDraft:true,doctorId:actorId,locale,onOpen(){},onSaved(){},onAction(){},onCheckAgain(){}});
  assert.equal(tree.root.findByProps({'data-plan-member':member}).findAllByProps({'data-member-identity':member}).length,1,'The plan keeps its member identity alongside the consultation refresh controls');
  const consultation=tree.root.findByProps({'data-decision':'consultation'});
  await act(async()=>{consultation.findByType('select').props.onChange({target:{value:'not-required'}});consultation.findByType('textarea').props.onChange({target:{value:'Doctor reason'}});});
  await act(async()=>consultation.findByType('form').props.onSubmit({preventDefault(){}}));
  const buttons=(label:string)=>tree.root.findAllByType('button').filter(b=>b.children.join('')===label);
  assert.equal(buttons(refresh).length,1,'Exactly one Refresh draft button');
  assert.equal(buttons(publishLabel)[0].props.disabled,true);
  assert.match(JSON.stringify(tree.toJSON()),new RegExp(notice));
  const form=tree.root.findByProps({className:'dcv2-draft'});
  assert.equal(buttons(refresh)[0].props.form,form.props.id,'The publish-area action submits the existing draft editor');
  assert.equal(buttons(refresh)[0].props.type,'submit');
  await act(async()=>form.findAllByType('textarea').find(n=>n.props.name==='instructions')!.props.onChange({target:{value:'Doctor edits kept through refresh'}}));
  const submit=async()=>{const fields=Object.fromEntries([...form.findAllByType('input'),...form.findAllByType('textarea')].filter(n=>n.props.name).map(n=>[n.props.name,String(n.props.value)]));await act(async()=>form.props.onSubmit({preventDefault(){},currentTarget:{fields}}));};
  await submit();assert.equal(saves,1);assert.equal(publishes,0);assert.equal(buttons(publishLabel)[0].props.disabled,true);
  assert.equal(form.findAllByType('textarea').find(n=>n.props.name==='instructions')!.props.value,'Doctor edits kept through refresh','A failed prepare keeps edits');
  prepareFails=false;await submit();assert.equal(saves,2);assert.equal(publishes,0);
  assert.doesNotMatch(JSON.stringify(tree.toJSON()),new RegExp(notice));
  assert.equal(buttons(publishLabel)[0].props.disabled,true,'After refresh, approval remains a separate explicit click');
  const card=tree.root.findByProps({'data-decision':'regimen'});
  assert.ok(card.findAllByType('p').some(p=>p.children.join('')==='Doctor edits kept through refresh'));
  await act(async()=>tree.unmount());assert.equal(timers.size,0);
 }
 // Concurrent route instances for one member still target their own draft editor.
 {
  const cards=fixturePlan(member),ai={...fixtureAiPlan(member),generation:null};
  cards.regimen!.current=false;cards.consultation=null;ai.snapshot.draftStale=true;
  Object.assign(io,{readDoctorChatPlan:async()=>({kind:'plan',approvals:structuredClone(cards)}),readDoctorChatAiPlan:async()=>structuredClone(ai)});
  const props={memberId:member,name:'Example',aiDraft:true,doctorId:actorId,locale:'en' as const,onOpen(){},onSaved(){},onAction(){},onCheckAgain(){}};
  let tree!:ReactTestRenderer;
  modules['./plan']={DoctorChatPlan:Plan};
  const Patient=load('components/doctor-chat-v2/patient-chat.tsx').PatientChat as React.ComponentType<Record<string,unknown>>;
  await act(async()=>{tree=create(React.createElement(React.Fragment,null,...['first','second'].map(key=>React.createElement(Patient,{...props,member:fixtureIdentity(member,'Example'),doctorName:'Doctor Example',owners:[],risk:null,planVersion:null,resultsReport:true,key}))));});
  await act(async()=>{for(const chips of tree.root.findAllByProps({className:'dcv2-controls dcv2-patient-chips'}))chips.findAllByType('button')[2].props.onClick();});
  const forms=tree.root.findAllByProps({className:'dcv2-draft'}),refresh=tree.root.findAllByType('button').filter(b=>b.children.join('')==='Refresh draft');
  assert.equal(forms.length,2);assert.equal(new Set(forms.map(f=>f.props.id)).size,2,'Same-member cards have unique form ids');
  assert.deepEqual(refresh.map(b=>b.props.form),forms.map(f=>f.props.id),'Each Refresh draft references the corresponding editor');
  await act(async()=>tree.unmount());assert.equal(timers.size,0);
 }
 // An existing urgent explanation replaces the generic unavailable outcome, including when AI drafts are off.
 for(const locale of ['en','hy','ru'] as const){
  Object.assign(io,{readDoctorChatPlan:async()=>({kind:'plan',approvals:{...fixturePlan(member),regimen:null,firstNote:{...fixturePlan(member).firstNote!,data:{...fixturePlan(member).firstNote!.data,urgent:true}}}}),readDoctorChatAiPlan:async()=>({kind:'off'})});
  const tree:ReactTestRenderer=await planTree(Plan,{memberId:member,name:'Example',aiDraft:false,doctorId:actorId,locale,onOpen(){},onSaved(){},onAction(){},onCheckAgain(){}});
  assert.ok(tree.root.findAllByType('a').some(a=>a.props.href===`/staff/real/members/${member}#member-alerts`));
  assert.doesNotMatch(JSON.stringify(tree.toJSON()),/Not done|Չի կատարվել|Не выполнено|the plan cannot be approved in this chat yet/);
  await act(async()=>tree.unmount());assert.equal(timers.size,0);
 }
 Object.assign(io,before);
}
console.log('Fresh-eyes plan EN/HY/RU: consultation stale notice; one Refresh draft wired to current text; failed prepare keeps edits; confirmed resave never publishes; urgent suppresses generic failure.');



// The real lab and upload children keep their guarded IO under PatientChat.
for(const path of ['@/lib/lab-ai/member-approval','@/lib/lab-ai/analyte-names','@/lib/clinical/seed/tests','@/lib/lab-ai/doctor-schema','@/components/ui/button','@/components/ui/input','@/components/ui/textarea','@/components/ui/badge','@/lib/member-history/lab-results'])modules[path]=await import(path);
modules['lucide-react']={ArrowUp:()=>null,AlertTriangle:()=>null,Bot:()=>null,CheckCircle2:()=>null,FileText:()=>null,Clock:()=>null};
modules['./shell']={buttonClass:'button'};
modules['@/components/staff/lab-ai-check']=load('components/staff/lab-ai-check.tsx');
modules['@/components/staff/member-upload-approve']=load('components/staff/member-upload-approve.tsx');
modules['./lab-ai-results']={LabSummaryBlock:()=>null};
modules['./member-upload-approve']=modules['@/components/staff/member-upload-approve'];
modules['@/components/staff/member-upload-ai']=load('components/staff/member-upload-ai.tsx');
modules['./lab']=load('components/doctor-chat-v2/lab.tsx');
modules['./upload']=load('components/doctor-chat-v2/upload.tsx');
const {fixtureUpload,fixtureUploadDocument}=await import('../e2e/doctor-chat-v2/data');
const mismatchRow={fileId:fixtureFile,fileName:'Different identity.pdf',at,clinicName:'Synthetic clinic',mismatch:'both' as const,reason:null,sheet:{name:'Sheet name',birthDate:'1970-01-01'},member:{name:'Mariam Example',birthDate:'1971-01-01'},current:true as const,memberId:member,memberName:'Mariam Example',jobState:null};
const emptyReadCopy=await import('@/lib/lab-ai/empty-read-copy');
// Clinic override journey: the production queue opens the production inline identity card.
{
 const io=modules['@/lib/staff-zoe/chat-v2-actions'] as Record<string,unknown>;
 const before={...io};

 for(const locale of ['en','hy','ru']as const){
  let open=true,requested=0;
  const data=fixtureLab();
  const mismatch={...mismatchRow,memberId:member,memberName:'Mariam Example',jobState:'done' as const};
  io.readDoctorChatLab=async()=>({kind:'lab',data:structuredClone(data),identityCheck:open?mismatch:undefined});
  io.confirmDoctorChatLabIdentity=async()=>{open=false;data.job!.identityConfirmedAt=at;return {status:'confirmed'};};
  io.requestDoctorChatLabReading=async()=>{requested++;return {status:'queued'};};
  // A reviewed value saved before this fix must also wait behind the current override.
  const LabResponse=(modules['./lab-review-action'] as typeof import('@/components/doctor-chat-v2/lab-review-action')).LabReviewResponse;
  const fact={id:'labs.1',label:'Creatinine',value:'82 µmol/L',date:null,mark:'reviewed' as const,href:null,analyte:null,fileId:fixtureFile};
  const card:ToolResult={tool:'labs',state:'ok',facts:[fact],quotes:[],missing:[],href:`/staff/real/members/${member}`};
  let saved!:ReactTestRenderer;
  await act(async()=>{saved=create(React.createElement(LabResponse,{reply:{kind:'zoe-answer',member:{memberId:member,memberName:mismatch.memberName},cards:[card]},doctorId:'fictional-doctor',locale,onLab(){}}));});
  assert.ok(!JSON.stringify(saved.toJSON()).includes('82 µmol/L'),'Saved reviewed facts cannot bypass a current identity check');
  assert.equal(saved.root.findAllByProps({'data-upload-identity':fixtureFile}).length,1);
  await act(async()=>saved.unmount());
  patientData={...fixtureMember(member),identityChecks:[mismatch]};patientAlerts=[];
  await mountPatient(locale);
  const checkLabel=copy.st(locale,'Check this file','Ստուգել այս ֆայլը','Проверить этот файл');
  await press(checkLabel);
  const block=screen!.root.findByProps({'data-lab-file':fixtureFile});
  assert.equal(block.findAllByType('li').length,0,'No plain values before identity confirmation, even if AI guessed match');
  const identity=block.findByType('form');
  await act(async()=>identity.findByType('textarea').props.onChange({target:{value:'Checked the original PDF'}}));
  await act(async()=>identity.props.onSubmit({preventDefault(){}}));
  assert.equal(screen!.root.findAllByProps({'data-upload-identity':fixtureFile}).length,0,'Confirmation removes both queue and inline identity notice');
  assert.ok(screen!.root.findByProps({'data-lab-file':fixtureFile}).findAllByType('li').length>0,'Values appear only after confirmation');
  await unmount();
  // No AI read still opens a card with the existing request action.
  open=true;const noRead={...data,job:null,values:[]};
  io.readDoctorChatLab=async()=>({kind:'lab',data:noRead,identityCheck:{...mismatch,jobState:null}});
  await mountPatient(locale);await press(checkLabel);
  const noReadBlock=screen!.root.findByProps({'data-lab-file':fixtureFile});
  const requestButton=noReadBlock.findAllByType('button').find(b=>b.children.join('')===copy.st(locale,'Read again','Կարդալ կրկին','Распознать ещё раз'));
  assert.ok(requestButton,'No-AI card retains its request-reading control');
  await act(async()=>requestButton.props.onClick());assert.equal(requested,1,'Existing request-reading action is called');
  await unmount();
  // The production empty-read case opens the same card, with guidance before identity confirmation.
  data.values=[];data.job!.counts.total=0;
  io.readDoctorChatLab=async()=>({kind:'lab',data:structuredClone(data),identityCheck:{...mismatch,noValuesRead:true}});
  await mountPatient(locale);await press(checkLabel);
  const emptyBlock=screen!.root.findByProps({'data-lab-file':fixtureFile});
  assert.ok(JSON.stringify(screen!.toJSON()).includes(emptyReadCopy.labEmptyReadMessage(locale)),'Empty read guidance is visible in the actual inline card');
  assert.ok(emptyBlock.findAllByType('button').some(b=>b.children.join('')===copy.st(locale,'Open the PDF','Բացել PDF-ը','Открыть PDF')),'Empty read keeps the PDF action');
  await unmount();
 }
 Object.assign(io,before);
 console.log('Clinic mismatch journey EN/HY/RU: patient member card opens inline card, values hidden until identity confirmation, queue removal and no-AI card passed (mounted, mocked IO).');
}

{
const io=modules['@/lib/staff-zoe/chat-v2-actions'] as Record<string,unknown>,before={...io};
let uploadStatus:import('@/lib/lab-ai/member-approval').ApproveResult['status']='approved';
const uploadCommands:import('@/lib/lab-ai/member-approval').ApproveCommand[]=[];
let uploadData=fixtureUpload(),uploadReads=0;
let uploadStop:'off'|'refused'|'unavailable'|null=null;
Object.assign(modules['@/lib/staff-zoe/chat-v2-actions']!,{
 readDoctorChatResults:async()=>({status:'none'}),
 readDoctorChatUpload:async()=>{uploadReads++;return uploadStop?{kind:uploadStop}:structuredClone(uploadData);},
 approveDoctorChatUpload:async(input:import('@/lib/lab-ai/member-approval').ApproveCommand,doctor:string)=>{assert.equal(doctor,actorId);uploadCommands.push(input);return {status:uploadStatus};},
});
const mountUpload=async()=>{
 patientData={...fixtureMember(member),uploads:[{documentId:fixtureUploadDocument,jobId:fixtureUploadDocument}]};patientAlerts=[];
 await mountPatient();await press('Uploads');
};
const uploadBlock=()=>screen!.root.findByProps({'data-upload-document':fixtureUploadDocument});
const uploadPress=async(label:string)=>{await act(async()=>uploadBlock().findAllByType('button').find(b=>b.children.includes(label))!.props.onClick());};

await mountUpload();
assert.equal(uploadReads,1);assert.match(serialized(),/Your check before the member sees it/);
await uploadPress('Open file');assert.match(screen!.root.findByType('iframe').props.src,/member-uploads.*page=1$/);
await act(async()=>button('Next').props.onClick());assert.match(screen!.root.findByType('iframe').props.src,/page=2$/);
await press('Close file');
const uploadsBefore=uploadReads;
const form=uploadBlock();
await act(async()=>form.findAllByType('textarea')[1].props.onChange({target:{value:'Exact edited member text'}}));
uploadStatus='stale';await uploadPress('Approve and show to the member');
assert.match(serialized(),/This reading changed since you opened it/);assert.equal(uploadBlock().findAllByType('textarea')[1].props.value,'Exact edited member text');
assert.ok(!serialized().includes("Approved Mariam Example's upload"));
await uploadPress('Reload');assert.equal(uploadReads,uploadsBefore+1);assert.equal(uploadBlock().findAllByProps({role:'alert'}).length,0);
uploadStatus='outcome-unknown';await uploadPress('Approve and show to the member');
const uncertain=uploadCommands.at(-1)!;await uploadPress('Approve and show to the member');assert.deepEqual(uploadCommands.at(-1),uncertain,'Unknown outcome preserves the retry submission');
uploadStatus='approved';await uploadPress('Approve and show to the member');
assert.equal(screen.root.findAllByProps({'data-upload-document':fixtureUploadDocument}).length,0,'Confirmed upload retires the used form');assert.match(serialized(),/Done: Upload approved. The member sees the kept values and the text below\./);
await unmount();
for(uploadStop of ['off','refused','unavailable'] as const){
 await mountUpload();
 assert.equal(screen!.root.findAllByProps({'data-upload-document':fixtureUploadDocument}).length,0);assert.match(serialized(),uploadStop==='refused'?/access is unavailable/i:uploadStop==='off'?/this action is switched off/i:/the upload is unavailable/i);await unmount();
}uploadStop=null;
uploadData=fixtureUpload();uploadData.doc.job!.confirmation=null;
await mountUpload();
assert.match(serialized(),/Waiting for the member to say whether the sheet is theirs/);assert.equal(uploadBlock().findAllByType('input').length,0);await unmount();
uploadData=fixtureUpload();uploadData.document.mime='image/png';
await mountUpload();await uploadPress('Open file');assert.equal(screen!.root.findAllByType('iframe').length,0);assert.equal(screen!.root.findByType('img').props.alt,'Member upload');await unmount();

Object.assign(io,before);
}
console.log('Upload child safety: PDF/photo, stale reload, preserved edits, exact uncertain retry, approval callback, refusal/off/unavailable and unconfirmed identity passed.');


// Saved and streamed lab evidence is reconciled by the real reply and lab cards.
{
 const memberB=member;
 type AnswerContent=import('@/lib/staff-zoe/contracts').AnswerContent;
 let currentLab=fixtureLab();
 const recordAnswer:AnswerContent={version:'staff-zoe-1',state:'answered',say:[],quotes:[],notKnown:[],declined:false,notice:null,cards:[]};
 const encoded=(events:unknown[])=>events.map(event=>JSON.stringify(event)+'\n');
 const serialized=()=>JSON.stringify(screen.toJSON());
 const resetZoe=()=>{patientData=fixtureMember(member);patientAlerts=[];patientHistory={kind:'history',conversations:[],turns:[],target:null};streamChunks=[];holdResponse=false;holdStream?.close();holdStream=null;zoeRequests.length=0;};
 const mount=mountPatient;
 const selectZoeMember=async()=>{}; // The route is already bound before the composer is available.
 const send=async(value:string)=>{
  const form=screen.root.findByProps({className:'cv2-composer'});
  await act(async()=>form.findByType('textarea').props.onChange({target:{value}}));
  await act(async()=>form.props.onSubmit({preventDefault(){}}));
 };
 const ReplyView=(modules['./messages'] as typeof import('@/components/doctor-chat-v2/messages')).DoctorReply;
 const renderToStaticMarkup=(await import('react-dom/server')).renderToStaticMarkup;
 io.reviewDoctorChatLabValue=async(_id:string,_file:string,command:import('@/lib/lab-ai/doctor-schema').ReviewCommand)=>{
  assert.equal(_id,member);assert.equal(_file,fixtureFile);
  currentLab={...currentLab,values:currentLab.values.map(v=>v.valueId===command.valueId?{...v,status:'verified'}:v)};
  return {status:'saved',valueStatus:'verified'};
 };
// Unreviewed lab facts offer one guarded action per file, including saved and streamed answers.
const labActionPorts=modules['@/lib/staff-zoe/chat-v2-actions'] as Record<string,(...args:unknown[])=>unknown>;
const originalLabRead=labActionPorts.readDoctorChatLab;
const labActionReads:unknown[][]=[];
for(const locale of ['en','hy','ru'] as const){
 const review=copy.st(locale,'Review these values','Վերանայել այս արժեքները','Проверить эти значения');
 const fallback=copy.st(locale,'Open the lab check','Բացել լաբորատոր ստուգումը','Открыть проверку анализов');
 const href=`/staff/real/members/${memberB}/documents/${fixtureFile}/check`;
 const fact={id:'labs.1',label:copy.st(locale,'LDL, unreviewed','LDL, չվերանայված','LDL, не проверено'),value:'3.9 mmol/L',date:'2026-11-02',mark:'not_reviewed' as const,href,analyte:'ldl_c',fileId:fixtureFile};
 const card:ToolResult={tool:'labs',state:'ok',facts:[fact,{...fact,id:'labs.2',label:copy.st(locale,'ALT, unreviewed','ALT, չվերանայված','ALT, не проверено')}],quotes:[],missing:[],href};
 const answer:AnswerContent={...recordAnswer,cards:[card],say:card.facts.map(f=>({text:`${f.label}: ${f.value}`,facts:[f]}))};
 labActionPorts.readDoctorChatLab=async(...args)=>{labActionReads.push(args);return {kind:'lab',data:structuredClone(currentLab)};};
 currentLab={...fixtureLab(),openedByYou:true};
 resetZoe();
 await mount(locale);await selectZoeMember();streamChunks=encoded([{type:'cards',cards:[card]},{type:'answer',content:answer}]);
 await send('What do the lab values show?');
 assert.equal(screen!.root.findAllByType('button').filter(b=>b.children.join('')===review).length,1,'Repeated facts and answer cards share one action per file');
 assert.deepEqual(labActionReads.at(-1),[memberB,fixtureFile,actorId]);
 await press(review);
 const inlineLab=screen!.root.findByProps({'data-lab-file':fixtureFile});
 assert.equal(inlineLab.parent!.props.memberId,memberB,'Review opens the existing card for this member');
 if(locale==='en'){
  holdResponse=true;streamChunks=encoded([{type:'cards',cards:[card]}]);await send('Read the lab record once more');
  assert.equal(zoeRequests.at(-1)!.signal?.aborted,false);
 }
 await act(async()=>inlineLab.findAllByType('button').find(b=>b.children.join('')===copy.st(locale,'Confirm','Հաստատել','Подтвердить'))!.props.onClick());
 if(locale==='en'){assert.equal(zoeRequests.at(-1)!.signal?.aborted,true,'A review cancels an in-flight read of stale lab values');holdResponse=false;holdStream=null;}
 assert.ok(!serialized().includes(fact.label),'A saved review invalidates stale answer and card snapshots');

 const reviewed={...card,facts:card.facts.map(f=>({...f,mark:'reviewed' as const,label:f.label.split(', ')[0]}))};
 streamChunks=encoded([{type:'answer',content:{...answer,cards:[reviewed],say:reviewed.facts.map(f=>({text:`${f.label}: ${f.value}`,facts:[f]}))}}]);
 await send('What do the lab values show now?');
 assert.doesNotMatch(serialized(),/unreviewed/);assert.equal(screen!.root.findAllByType('button').filter(b=>b.children.join('')===review).length,0);
 await unmount();
 const saved={conversationId:'c1a00000-0000-4000-8000-000000000001',memberId:memberB,memberName:'Mariam Example',savedAt:at};
 function restoreLabAnswer(){
  resetZoe();patientHistory={kind:'history',turns:[{...saved,key:'restored-lab',seq:1,role:'zoe',text:'Earlier lab answer',content:answer}],conversations:[saved],target:saved};
 }
 const changed=copy.st(locale,'Lab values changed. Ask Zoe again for the current record.','Լաբորատոր արժեքները փոխվել են։ Ընթացիկ գրառման համար կրկին հարցրեք Զոյային։','Лабораторные значения изменились. Спросите Зою ещё раз, чтобы прочитать актуальную запись.');
 const assertStaleLabHidden=()=>{
  assert.doesNotMatch(serialized(),/unreviewed|Not reviewed|Չվերանայված|Не проверено/i,'Restored answers must reconcile saved review status');
  assert.equal(screen!.root.findAllByType('button').filter(b=>b.children.join('')===review).length,0);
  assert.ok(serialized().includes(changed),'Stale facts ask for a fresh Zoe read');
  assert.ok(!serialized().includes('3.9'),'Never display an old corrected or rejected value');
 };
 // The confirmation above changed the saved read. A new chat must not depend on in-memory invalidation.
 restoreLabAnswer();await mount(locale);assertStaleLabHidden();await unmount();
 // Classic check page writes are visible only through the read, not a chat callback.
 for(const status of ['verified','corrected','rejected'] as const){
  currentLab={...fixtureLab(),values:fixtureLab().values.map((v,i)=>i===0?{...v,status,correctedValue:status==='corrected'?2.4:null}:v)};
  restoreLabAnswer();await mount(locale);assertStaleLabHidden();await unmount();
 }
 currentLab={...fixtureLab(),values:fixtureLab().values.map((v,i)=>i===1?{...v,status:'verified'}:v)};restoreLabAnswer();await mount(locale);
 assert.ok(serialized().includes(fact.label),'Unreviewed facts keep their labels even when a different value on the file is reviewed');
 assert.equal(screen!.root.findAllByType('button').filter(b=>b.children.join('')===review).length,1);
 // A browser return may retain the mounted chat. Recheck when it becomes visible again.
 currentLab={...fixtureLab(),values:fixtureLab().values.map(v=>({...v,status:'rejected'}))};
 await act(async()=>{doc.dispatchEvent(new Event('visibilitychange'));});assertStaleLabHidden();
 await unmount();
 // Do not briefly show stale facts while the authoritative read is pending.
 let releaseReviewRead!:(value:unknown)=>void;
 labActionPorts.readDoctorChatLab=()=>new Promise(resolve=>{releaseReviewRead=resolve;});
 restoreLabAnswer();await mount(locale);assert.doesNotMatch(serialized(),/unreviewed|չվերանայված|не проверено|3\.9/i);
 await act(async()=>releaseReviewRead({kind:'lab',data:{...fixtureLab(),values:fixtureLab().values.map(v=>({...v,status:'verified'}))}}));
 assertStaleLabHidden();await unmount();
 for(const failure of ['off','unavailable','refused','throw'] as const){
  labActionPorts.readDoctorChatLab=async()=>{if(failure==='throw')throw Error('Synthetic lab read failure');return {kind:failure};};
  resetZoe();await mount(locale);await selectZoeMember();streamChunks=encoded([{type:'answer',content:answer}]);await send('What do the lab values show?');
  assert.ok(!serialized().includes(fact.label)&&!serialized().includes('3.9'),'A failed identity preflight hides saved values until the file can be checked');
  const links=screen!.root.findAllByType('a');
  assert.equal(links.length,failure==='refused'?0:1,'Access refusal hides actions; inline unavailability offers the classic check');
  if(links.length){assert.equal(links[0].props.href,href);assert.equal(links[0].children.join(''),fallback);}
  assert.equal(screen!.root.findAllByType('button').filter(b=>b.children.join('')===review).length,0);await unmount();
 }
 // Keep the saved answer through transient failure, but expose it only after the identity preflight succeeds.
 labActionPorts.readDoctorChatLab=async()=>({kind:'unavailable'});
 restoreLabAnswer();await mount(locale);
 assert.ok(!serialized().includes(fact.label)&&!serialized().includes('3.9'));
 labActionPorts.readDoctorChatLab=async()=>({kind:'lab',data:fixtureLab()});
 await act(async()=>{doc.dispatchEvent(new Event('visibilitychange'));});
 assert.ok(serialized().includes(fact.label),'A successful recheck restores the existing label after a failed read');
 assert.ok(serialized().includes('3.9'),'The unchanged saved value returns only after the identity gate passes');
 assert.equal(screen!.root.findAllByType('button').filter(b=>b.children.join('')===review).length,1);
 await unmount();
 // Shared record renderer remains action-free outside the doctor chat (nurse and member surfaces).
 const shared=renderToStaticMarkup(React.createElement((modules['@/components/staff/zoe/answer'] as typeof import('@/components/staff/zoe/answer')).StaffZoeResponse,{content:answer,cards:[],error:null,loading:false,locale,memberRef:'example',inline:true}));
 assert.ok(!shared.includes(review)&&!shared.includes(fallback));
}
labActionPorts.readDoctorChatLab=originalLabRead;
{
 const href=`/staff/real/members/${memberB}/documents/${fixtureFile}/check`;
 const first={id:'labs.1',label:'LDL, unreviewed',value:'3.9 mmol/L',date:null,mark:'not_reviewed' as const,href,analyte:'ldl',fileId:fixtureFile};
 const secondFile='e1a00000-0000-4000-8000-000000000002';
 const second={...first,id:'labs.2',fileId:secondFile,href:href.replace(fixtureFile,secondFile)};
 const card:ToolResult={tool:'labs',state:'ok',facts:[first,second],quotes:[],missing:[],href};
 const opened:unknown[][]=[];
 labActionPorts.readDoctorChatLab=async()=>({kind:'lab',data:fixtureLab()});
 const props:React.ComponentProps<typeof ReplyView>={reply:{kind:'zoe-cards',member:{memberId:memberB,memberName:'Mariam'},cards:[card]},locale:'en',doctorId:actorId,onOpen(){},onLab:(...args)=>opened.push(args)};
 let view!:ReactTestRenderer;
 await act(async()=>{view=create(React.createElement(ReplyView,props));});
 const choices=view.root.findAllByType('button').filter(b=>b.children.join('')==='Review these values');assert.equal(choices.length,2,'Cards arriving before an answer offer one action per file');
 await act(async()=>choices[1].props.onClick());assert.deepEqual(opened,[[memberB,secondFile,'Mariam']]);
 await act(async()=>view.update(React.createElement(ReplyView,{...props,doctorId:undefined})));
 assert.equal(view.root.findAllByType('button').length,0,'No doctor authority means no action');
 const reviewed={...props,reply:{kind:'zoe-cards' as const,member:{memberId:memberB,memberName:'Mariam'},cards:[{...card,facts:card.facts.map(f=>({...f,mark:'reviewed' as const}))}]}};
 await act(async()=>view.update(React.createElement(ReplyView,reviewed)));assert.equal(view.root.findAllByType('button').length,0,'Reviewed-only facts have no review action');
 const legacy={...first};delete (legacy as {fileId?:string}).fileId;
 await act(async()=>view.update(React.createElement(ReplyView,{...props,reply:{kind:'zoe-cards',member:{memberId:memberB,memberName:'Mariam'},cards:[{...card,facts:[legacy]}]}})));
 assert.equal(view.root.findByType('a').props.href,href,'Older saved facts retain the classic check link');
 // Legacy saved facts can have an unknown date or no link while retaining file provenance.
 labActionPorts.readDoctorChatLab=async()=>({kind:'lab',data:{...fixtureLab(),values:fixtureLab().values.map((v,i)=>i===0?{...v,status:'corrected',correctedValue:2.4}:v)}});
 const noLink={...first,href:null};
 await act(async()=>view.update(React.createElement(ReplyView,{...props,reply:{kind:'zoe-answer',member:{memberId:memberB,memberName:'Mariam'},cards:[{...card,facts:[noLink]}]}})));
 assert.equal(view.root.findAllByType('button').length,0,'Unknown dates and absent links cannot restore corrected facts');
 assert.ok(JSON.stringify(view.toJSON()).includes('Lab values changed. Ask Zoe again'));
 assert.ok(!JSON.stringify(view.toJSON()).includes('3.9'));
 await act(async()=>view.unmount());labActionPorts.readDoctorChatLab=originalLabRead;
}

console.log('Patient lab answers: guarded per-file actions, stream cancellation, invalidation, saved-status reconciliation, visibility retries, failures and legacy provenance passed in en/hy/ru.');
}

// Bulk uses the guarded chat port and rereads the saved record without replacing the mounted list.
for(const locale of ['en','hy','ru'] as const){
 const io=modules['@/lib/staff-zoe/chat-v2-actions'] as Record<string,unknown>,before={...io};
 let data=fixtureLab(),reads=0,uncertain=true;
 data.openedByYou=true;data.values[2].status='auto_accepted';
 const extra={...data.values[1],valueId:id(88)};data.values.push(extra);
 const calls:unknown[][]=[];
 io.readDoctorChatLab=async()=>{reads++;return {kind:'lab',data:structuredClone(data),ruleBlocks:Object.fromEntries(data.values.map(v=>[v.valueId,null]))};};
 io.confirmDoctorChatPassingLabValues=async(...args:unknown[])=>{
  calls.push(args);if(uncertain){uncertain=false;return {status:'outcome-unknown'};}
  data={...data,values:data.values.map(v=>v.valueId===extra.valueId||v.valueId===data.values[1].valueId?{...v,status:'verified' as const}:v)};
  return {status:'saved',replayed:true,confirmed:2,remaining:1};
 };
 Object.assign(modules['./lab']!,load('components/doctor-chat-v2/lab.tsx'));
 const Lab=(modules['./lab'] as Record<string,unknown>).DoctorChatLab as React.ComponentType<Record<string,unknown>>;
 let view!:Renderer;
 await act(async()=>{view=create(React.createElement(Lab,{memberId:member,fileId:fixtureFile,doctorId:actorId,locale,onReviewed(){}}));});
 const details=view.root.findByType('details');await act(async()=>details.props.onToggle({currentTarget:{open:true}}));
 const button=(label:string)=>view.root.findAllByType('button').find(b=>b.children.join('')===label)!;
 const label=copy.st(locale,'Confirm all 2 that pass the rules','Հաստատել կանոններին համապատասխանող բոլոր 2 արժեքները','Подтвердить все 2 показателя, прошедшие правила');
 assert.ok(button(label));await act(async()=>button(label).props.onClick());
 const retry=copy.st(locale,'Check again','Կրկին ստուգել','Проверить ещё раз');
 const priorReads=reads;await act(async()=>button(retry).props.onClick());
 assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[0].slice(0,2),[member,fixtureFile]);assert.equal(calls[0][3],actorId);
 const bulkCommand=calls[0][2] as {memberId:string;fileId:string;submissionId:string};
 assert.deepEqual(Object.keys(bulkCommand).sort(),['fileId','memberId','submissionId']);
 assert.equal(bulkCommand.fileId,fixtureFile);assert.equal(bulkCommand.memberId,member);
 assert.ok(reads>priorReads,'A saved bulk result rereads the actual record through the chat port');
 assert.equal(view.root.findByType('details'),details);assert.equal(details.props.open,true);
 assert.equal(view.root.findAllByProps({'data-reviewed-value':extra.valueId}).length,1,'Refreshed review statuses render without locally guessing eligibility');
 assert.ok(JSON.stringify(view.toJSON()).includes(copy.st(locale,'Already saved. 2 confirmed. 1 still need you.','Արդեն պահպանված է։ 2 արժեք հաստատված է։ 1 արժեքի համար դեռ ձեր ստուգումն է պետք։','Уже сохранено. Подтверждено: 2. Ещё требуют вашей проверки: 1.')));
 await act(async()=>view.unmount());Object.assign(io,before);
}
console.log('Patient bulk EN/HY/RU: guarded doctor/member/file port, exact uncertain retry, saved-record reread and persistent expanded list passed (mocked IO).');

// Review the actual lab under the member identity control, including audited PDF opening.
{
let currentLab=fixtureLab(),openedPdf=false;
let labReadFailure:'off'|'refused'|'unavailable'|null=null;
let savedElsewhere=false;
const labCommands:import('@/lib/lab-ai/doctor-schema').ReviewCommand[]=[];
Object.assign(modules['@/lib/staff-zoe/chat-v2-actions']!,{
 readDoctorChatLab:async()=>labReadFailure?{kind:labReadFailure}:{kind:'lab',data:structuredClone(currentLab)},
 reviewDoctorChatLabValue:async(_member:string,_file:string,input:import('@/lib/lab-ai/doctor-schema').ReviewCommand)=>{
  labCommands.push(input);if(!openedPdf)return {status:'open-first'};
  if(savedElsewhere){savedElsewhere=false;return {status:'saved',valueStatus:'corrected'};}
  currentLab={...currentLab,values:currentLab.values.map(v=>v.valueId===input.valueId?{...v,status:input.action==='confirm'?'verified':input.action==='reject'?'rejected':'corrected',correctedValue:input.value??null,correctedUnit:input.unit??null}:v)};
  return {status:'saved',valueStatus:input.action==='confirm'?'verified':input.action==='reject'?'rejected':'corrected'};
 },
 confirmDoctorChatLabIdentity:async()=>({status:'confirmed'}),requestDoctorChatLabReading:async()=>({status:'queued'}),
});
Object.assign(modules['./lab']!,load('components/doctor-chat-v2/lab.tsx'));
patientAlerts=[];
patientData={...fixtureMember(member),identityChecks:[{...mismatchRow,jobState:'done'}]};
await mountPatient();await press('Check this file');
assert.equal(screen.root.findAllByProps({'data-lab-file':fixtureFile}).length,1,'The member identity control opens its actual lab card');
const labBlock=screen!.root.findByProps({'data-lab-file':fixtureFile});
const blockKey=screen.root.findAllByType('article').at(-1)!.props['data-message-key'];
const labButtons=(name:string)=>labBlock.findAllByType('button').filter(b=>b.children.join('')===name);
await act(async()=>labButtons('Correct')[1].props.onClick());
await act(async()=>labBlock.findAllByType('input')[0].props.onChange({target:{value:'139'}}));
await act(async()=>labButtons('Save correction')[0].props.onClick());
assert.equal(labBlock.findAllByType('input')[0].props.value,'139');assert.equal(labCommands.at(-1)!.action,'correct');
for(labReadFailure of ['unavailable'] as const){
 await act(async()=>labButtons('Reload')[0].props.onClick());
 assert.equal(labBlock.findAllByType('input')[0].props.value,'139','Read failure keeps the edited form');
 assert.equal(labBlock.findByType('fieldset').props.disabled,true,'A failed refresh retains edits but cannot authorize another review');
}
labReadFailure=null;await act(async()=>labButtons('Reload')[0].props.onClick());
await act(async()=>labButtons('Open the PDF')[0].props.onClick());
const pdf=screen!.root.findAllByType('iframe').find(frame=>/\?page=1$/.test(frame.props.src))!;assert.ok(pdf);
// An iframe load without an audited read must not remove the reminder.
await act(async()=>pdf.props.onLoad());assert.match(serialized(),/Open the PDF first, then review/);
openedPdf=true;currentLab={...currentLab,openedByYou:true};
await act(async()=>pdf.props.onLoad());
await act(async()=>screen!.root.findAllByType('button').find(b=>b.children.join('')==='Close PDF')!.props.onClick());
assert.equal(screen!.root.findAllByType('dialog').length,0);
await act(async()=>labButtons('Confirm')[0].props.onClick());
assert.equal(screen.root.findAllByType('article').at(-1)!.findByType('p').children.join(''),'Done: LDL 3.1 mmol/L confirmed');
// Another tab corrected this value first: the database keeps that, and the line names no value it did not save.
savedElsewhere=true;
await act(async()=>{await screen!.root.findAllByType('button').filter(b=>b.children.join('')==='Confirm')[0].props.onClick();});
assert.match(screen.root.findAllByType('article').at(-1)!.findByType('p').children.join(''),/was already reviewed\. Check the saved value\.$/);
assert.doesNotMatch(screen.root.findAllByType('article').at(-1)!.findByType('p').children.join(''),/confirmed|138|41/);
assert.equal(screen.root.findAllByType('article').find(a=>a.props['data-message-key']===blockKey)!.findByProps({'data-lab-file':fixtureFile}),labBlock,'The mounted lab stays stable beside the appended receipt');
assert.equal(labBlock.findAllByType('input')[0].props.value,'139','Another value press keeps this correction');
await act(async()=>labButtons('Save correction')[0].props.onClick());
assert.equal(screen.root.findAllByType('article').at(-1)!.findByType('p').children.join(''),'Done: Sodium corrected to 139 mmol/L');
await act(async()=>labButtons('Reject (does not apply)')[0].props.onClick());
assert.equal(screen.root.findAllByType('article').at(-1)!.findByType('p').children.join(''),'Done: LDL rejected');
// Flagged values come first, so reject whatever remains one by one; each press is a separate saved review.
for(let guard=0;guard<4&&labButtons('Reject (does not apply)').length;guard++)await act(async()=>labButtons('Reject (does not apply)')[0].props.onClick());
assert.equal(labBlock.findAllByType('p').filter(p=>p.children.join('')==='All values on this sheet are reviewed.').length,1);
// A flagged value the rules already confirmed stays visible, so it keeps its optional Confirm/Correct buttons; nothing is left to reject.
assert.equal(labButtons('Reject (does not apply)').length,0);
const samePress=labCommands.filter(c=>c.valueId===labCommands[0].valueId&&c.action===labCommands[0].action);
assert.ok(samePress.length>1);assert.equal(samePress[0].submissionId,samePress.at(-1)!.submissionId);
assert.equal(screen!.root.findAllByType('a').length,1,'Patient lab keeps the full-page check link');
assert.equal(screen.root.findAllByProps({'data-lab-file':fixtureFile}).length,1,'Reviewing values keeps one mounted lab block');
await unmount();
console.log('Patient lab: audited PDF reminder, open/close, exact retry ids, confirmed/corrected/rejected receipts, completion and preserved sibling edits passed (mocked IO, no browser layout).');


}
{
// The real shared form must retain edits across a refused save AND an unavailable reread.
const aiFixture=await import('../e2e/doctor-chat-v2/data');
const io=modules['@/lib/staff-zoe/chat-v2-actions'] as Record<string,unknown>,before={...io};
let approvals=fixturePlan(member);
modules['./plan-ready-card']=await import('@/components/doctor-chat-v2/plan-ready-card');modules['@/lib/patient-care/required-lab-match']=await import('@/lib/patient-care/required-lab-match');
const Plan=load('components/doctor-chat-v2/plan.tsx').DoctorChatPlan as typeof import('@/components/doctor-chat-v2/plan').DoctorChatPlan;
const mountPlan=async(locale:import('@/lib/staff/staff-locale-copy').StaffLocale='en')=>{patientData=fixtureMember(member);patientHistory={kind:'history',conversations:[],turns:[],target:null};await planTree(Plan,{memberId:member,name:'Example',aiDraft:false,doctorId:actorId,locale,onOpen(){},onSaved(){},onCheckAgain(){},onAction(){}});};
io.readDoctorChatPlan=async()=>({kind:'plan',approvals:structuredClone(approvals)});
const aiRead=aiFixture.fixtureAiPlan(member);aiRead.snapshot.draft=null as unknown as typeof aiRead.snapshot.draft;
aiRead.generation.items[0].text='Set the blood pressure target for this member (Q1).';
aiRead.generation.items[0].rationale="NRN-CLIN-ALG-001: rules after tests (C1–C16) are pending (Q2).";
aiRead.generation.items[0].source={kind:'protocol',ref:'NRN-LAB-CAT-001 v2 §1',label:'Lab protocol v2'};
let aiUnavailable=false,saveRefused=true,adoptionCalls=0,saveWithoutCard=false,failAfterSave=false;
const aiSaves:FormData[]=[];
Object.assign(modules['@/lib/staff-zoe/chat-v2-actions']!,{
 readDoctorChatAiPlan:async()=>aiUnavailable?{kind:'unavailable'}:structuredClone(aiRead),
 saveDoctorChatAiPlan:async(_previous:unknown,form:FormData)=>{aiSaves.push(form);if(saveRefused){aiUnavailable=true;return {ok:false,uncertain:true,message:'The draft save could not be confirmed. Refresh the current case before trying again.'};}approvals=fixturePlan(member);if(saveWithoutCard)approvals.regimen=null;if(failAfterSave)aiUnavailable=true;aiRead.snapshot.revision=5;aiRead.snapshot.draft={...fixturePlan(member).regimen!.draft,explanation:String(form.get('explanation')),instructions:String(form.get('instructions')),followUp:String(form.get('followUp'))};return {ok:true,message:'Draft saved privately. No plan is published and no notice is sent.',revision:5};},
 recordDoctorChatAiPlanAdoption:async(id:string,fields:string[])=>{assert.equal(id,aiRead.generation.id);assert.deepEqual(Array.from(fields),['explanation','instructions','followUp']);adoptionCalls++;return true;},
 prepareDoctorChatAiPlan:async()=>({ok:true,generationId:fixtureAiPlan(member).generation.id,message:'Draft prepared from protocol rules only (AI wording unavailable). Check each marked field before saving.'}),
});
approvals=fixturePlan(member);approvals.regimen=null;

for(const locale of ['en','hy','ru'] as const){
 await mountPlan(locale);
 await press(copy.st(locale,'Prepare again','Պատրաստել կրկին','Подготовить снова'));
 assert.match(serialized(),locale==='en'?/AI wording unavailable/:locale==='hy'?/AI ձևակերպումներն անհասանելի են/:/текст ИИ недоступен/);
 assert.doesNotMatch(serialized(),/AI-prepared|AI-ի պատրաստած|подготовлен ИИ|Q[1-4]\b|C1|C16|NRN-/);
 assert.match(serialized(),locale==='en'?/Draft from plan items/:locale==='hy'?/Պլանի կետերից կազմված սևագիր/:/Черновик составлен из пунктов плана/);
 await unmount();
}
await mountPlan();
const aiBlock=()=>screen!.root.findByProps({'data-plan-member':member});
const aiButtons=(text:string)=>aiBlock().findAllByType('button').filter(b=>b.children.join('')===text);
const field=(name:string)=>aiBlock().findAllByType('textarea').find(n=>n.props.name===name)!;
assert.doesNotMatch(serialized(),/AI-prepared|Q[1-4]\b|C1|C16|NRN-/, 'Code-built drafts do not claim AI wording or display audit codes');
assert.match(serialized(),/Draft from plan items/);
assert.match(serialized(),/Laboratory protocol/);
assert.equal(field('explanation').props.value,'AI explanation for review');assert.equal(aiButtons('Use this draft')[0].props.disabled,true);
await act(async()=>aiButtons('I checked all, accept all')[0].props.onClick());
await act(async()=>field('instructions').props.onChange({target:{value:'Keep these doctor edits'}}));
await act(async()=>field('activityLimits').props.onChange({target:{value:'Doctor entered activity limits'}}));
const submitAi=async()=>{const form=aiBlock().findAllByType('form')[0];const fields=Object.fromEntries([...form.findAllByType('input'),...form.findAllByType('textarea')].filter(n=>n.props.name).map(n=>[n.props.name,String(n.props.value)]));await act(async()=>form.props.onSubmit({preventDefault(){},currentTarget:{fields}}));};
await submitAi();
assert.equal(aiSaves.length,1);assert.equal(aiSaves[0].get('aiGeneration'),aiRead.generation.id);assert.equal(aiSaves[0].get('revision'),'4');assert.equal(aiSaves[0].get('token'),'a'.repeat(32));
assert.equal(aiSaves[0].get('activityLimits'),'Doctor entered activity limits','Main activity limits remain part of the chat draft save');
assert.equal(field('instructions').props.value,'Keep these doctor edits','Uncertain save plus failed reread keeps the mounted editor');
assert.equal(field('activityLimits').props.value,'Doctor entered activity limits');
assert.equal(aiButtons('Use this draft')[0].props.disabled,true,'Failed reread cannot retry old evidence');assert.equal(adoptionCalls,0);
aiUnavailable=false;await act(async()=>aiButtons('Check again')[0].props.onClick());
assert.equal(field('instructions').props.value,'Keep these doctor edits');
await act(async()=>aiButtons('Refresh evidence')[0].props.onClick());
assert.equal(aiButtons('Use this draft')[0].props.disabled,false);
saveRefused=false;await submitAi();
assert.equal(adoptionCalls,1);assert.equal(aiSaves.length,2);assert.equal(aiSaves[1].get('instructions'),'Keep these doctor edits');
assert.equal(aiBlock().findAllByType('textarea').filter(n=>n.props.name==='instructions').length,0,'Used draft editor leaves');
assert.equal(aiBlock().findAllByProps({'data-decision':'regimen'}).length,1,'Successful adoption renders the freshly read approval card');
await unmount();
console.log('Doctor chat AI adoption: marked fields, exact generation/CAS payload, uncertain save and failed-read text retention, retry and form replacement passed (real child, controlled IO).');

// A confirmed save still offers recovery if the post-save read fails, and an unsupported
// medicine-free plan says so instead of exposing another publication path.
approvals=fixturePlan(member);approvals.regimen=null;aiUnavailable=false;failAfterSave=true;saveWithoutCard=true;aiRead.snapshot.draft=null as unknown as typeof aiRead.snapshot.draft;aiRead.snapshot.revision=4;
await mountPlan();
await act(async()=>aiButtons('I checked all, accept all')[0].props.onClick());await submitAi();
assert.equal(aiButtons('Use this draft').length,1,'An unconfirmed refresh retains the editor');assert.equal(aiButtons('Check again').length,1,'Confirmed save plus failed read has an in-block retry');
aiUnavailable=false;await act(async()=>aiButtons('Check again')[0].props.onClick());
assert.doesNotMatch(serialized(),/Done: (?:Plan )?draft saved/i,'A failed post-save read never reports successful adoption');
failAfterSave=false;
await act(async()=>aiButtons('I reviewed the changes, keep my edits')[0].props.onClick());
await submitAi();
assert.equal(aiBlock().findAllByProps({'data-decision':'regimen'}).length,0);
assert.match(serialized(),/the plan cannot be approved in this chat yet\./i,'Medicine-free unsupported save keeps the existing stop line');
assert.equal(aiButtons('Prepare care plan').length,0,'Confirmed saved draft is not offered for a second adoption');await unmount();
console.log('Doctor chat AI recovery: confirmed-save refresh failure retries in place, unsupported saved plan stops without publishing (controlled IO).');


Object.assign(io,before);
}



// Results and reports use the real parent read/refresh/approval transitions.
{
 const memberB=member;
 const {fixtureResults}=await import('../e2e/doctor-chat-v2/data');
 const savedEntries:unknown[][]=[],approvalArgs:unknown[][]=[];
 let reportApproval='stale';
 modules['@/lib/gp-report/actions']={saveResultEntry:async(...args:unknown[])=>{savedEntries.push(args);return {status:'saved'};},approveMemberGpReport:async(...args:unknown[])=>{approvalArgs.push(args);return {status:reportApproval,approval:{version:7}};}};
 modules['@/components/staff/result-entry-form']=load('components/staff/result-entry-form.tsx');
 modules['./result-entry-form']=modules['@/components/staff/result-entry-form'];
 modules['@/components/staff/gp-report-panel']=load('components/staff/gp-report-panel.tsx');
 modules['./results-block']=load('components/doctor-chat-v2/results-block.tsx');
 type ResultsProps=React.ComponentProps<typeof import('@/components/doctor-chat-v2/results-block').ResultsBlock>;
 const resultsTree=async(Results:React.ComponentType<ResultsProps>,options:ResultsProps)=>{
  patientData=fixtureMember(member);patientAlerts=[];patientHistory={kind:'history',conversations:[],turns:[],target:null};
  io.readDoctorChatResults=async(doctor:string,id:string)=>{assert.equal(doctor,actorId);assert.equal(id,member);return options.block;};
  modules['./results-block']={ResultsBlock:(actual:ResultsProps)=>React.createElement(Results,{...actual,
   onSaved:async text=>{await options.onSaved(text);await actual.onSaved(text);},
   onRefresh:async()=>{await options.onRefresh();await actual.onRefresh();},
   onStale:async()=>{await options.onStale();await actual.onStale();},
   onApproved:version=>{options.onApproved(version);actual.onApproved(version);},
  })};
  const tree=await mountPatient(options.locale);
  await act(async()=>tree.root.findByType('textarea').props.onChange({target:{value:'show results for this member'}}));
  await act(async()=>tree.root.findByProps({className:'cv2-composer'}).props.onSubmit({preventDefault(){}}));
  await act(async()=>tree.root.findAllByType((modules['./messages'] as {DoctorReply:React.ComponentType}).DoctorReply).at(-1)!.props.onResults());
  return tree;
 };
// Results and report controls are real child components, independent of routing.
{
 const Results=(modules['./results-block'] as typeof import('@/components/doctor-chat-v2/results-block')).ResultsBlock;
 for(const locale of ['en','hy','ru'] as const){
  const saved:string[]=[],approved:number[]=[];let staleCalls=0,refreshCalls=0;
  const data={...fixtureResults(memberB),priorityLevel:'emergency' as const,priority:{en:'Emergency first',hy:'Շտապ'}};
  screen=await resultsTree(Results,{block:data,name:'Mariam Example',locale,onRefresh:async()=>{refreshCalls++;},onSaved:async text=>{saved.push(text);},onApproved:version=>approved.push(version),onStale:async()=>{staleCalls++;}});
  const block=screen!.root.findByProps({className:'dcv2-results'});
  assert.equal(block.findAllByType('p')[0].props.className,'dcv2-priority');assert.equal(block.findAllByType('p')[0].props.role,'alert');
  assert.match(block.findAllByType('p')[0].children.join(''),locale==='en'?/Emergency first/:locale==='hy'?/Շտապ/:/Нужны срочные действия/);
  assert.ok(!block.findByProps({className:'dcv2-full-report'}).props.open,'Report starts closed');
  const extra=block.findAllByType('details').find(node=>node.findByType('summary').children.join('')===copy.st(locale,'Add potassium, ECG, echo or AHI','Ավելացնել կալիում, ԷՍԳ, էխո կամ AHI','Добавить калий, ЭКГ, эхо или ИАГ'))!;
  assert.ok(extra&&!extra.props.open);assert.equal(extra.findAllByType('form').length,5);assert.equal(block.findAllByType('form').length,6);
  const score=block.findAllByType('form')[0];
  await act(async()=>{score.findByProps({type:'text'}).props.onChange({target:{value:'6'}});score.findByProps({type:'date'}).props.onChange({target:{value:'2026-11-02'}});});
  const before=savedEntries.length;await act(async()=>{score.props.onSubmit({preventDefault(){}});score.props.onSubmit({preventDefault(){}});});
  assert.equal(savedEntries.length,before+1,'Double submission saves one result');assert.deepEqual(savedEntries.at(-1)?.slice(1,4),['score2_percent',6,'2026-11-02']);assert.match(saved[0],/SCORE2 6%/);
  const approveLabel=copy.st(locale,'Approve this report','Հաստատել հաշվետվությունը','Утвердить этот отчёт'),refreshLabel=copy.st(locale,'Refresh results','Թարմացնել արդյունքները','Обновить результаты');
  assert.equal(button(approveLabel).props.disabled,true,'Saving a result makes the report stale until refreshed');
  await press(refreshLabel);assert.equal(refreshCalls,1);assert.equal(button(approveLabel).props.disabled,true,'Report approval requires the explicit tick');
  await act(async()=>block.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}));reportApproval='stale';const count=approvalArgs.length;
  await press(approveLabel);assert.equal(staleCalls,1);assert.equal(approvalArgs.length,count+1);assert.equal(block.findByProps({type:'checkbox'}).props.checked,false);assert.equal(button(approveLabel).props.disabled,true);
  assert.equal(approvalArgs.at(-1)![3],true,'Approval describes the results-enabled report shown');
  await press(refreshLabel);assert.equal(refreshCalls,2);assert.equal(block.findByProps({type:'checkbox'}).props.checked,false,'Refreshing never carries the approval tick forward');
  await act(async()=>block.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}));reportApproval='access';await press(approveLabel);
  assert.equal(button(approveLabel).props.disabled,true,'Access or unknown outcomes require refreshing before another approval');assert.equal(approved.length,0);
  await press(refreshLabel);await act(async()=>block.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}));reportApproval='approved';await press(approveLabel);assert.deepEqual(approved,[7]);
  await unmount();
 }
 const receipts:string[]=[];
 screen=await resultsTree(Results,{block:fixtureResults(memberB),name:'Mariam Example',locale:'en',onRefresh:async()=>{},onSaved:async text=>{receipts.push(text);},onApproved(){},onStale:async()=>{}});
 const forms=screen!.root.findAllByType('form');
 await act(async()=>forms[1].findByProps({type:'text'}).props.onChange({target:{value:'4,2'}}));await act(async()=>forms[1].props.onSubmit({preventDefault(){}}));
 assert.equal(savedEntries.at(-1)![2],4.2);assert.match(receipts.at(-1)!,/Potassium 4.2 mmol\/L/);
 await act(async()=>forms[1].findByProps({type:'text'}).props.onChange({target:{value:''}}));await act(async()=>forms[1].props.onSubmit({preventDefault(){}}));assert.equal(savedEntries.at(-1)![2],null);assert.match(receipts.at(-1)!,/Potassium cleared/);
 await act(async()=>forms[2].findByType('select').props.onChange({target:{value:'yes'}}));await act(async()=>forms[2].props.onSubmit({preventDefault(){}}));assert.match(receipts.at(-1)!,/ECG LVH: yes/);await unmount();
 const data=fixtureResults(memberB);
 screen=await resultsTree(Results,{block:{...data,priorityLevel:'cannot-assess',assessment:{...data.assessment,score2:{state:'off',reasons:['under_40'],percent:null}}},name:'Mariam Example',locale:'en',onRefresh:async()=>{},onSaved:async()=>{},onApproved(){},onStale:async()=>{}});
 assert.equal(screen.root.findByProps({className:'dcv2-results'}).findAllByType('form').length,5);assert.match(serialized(),/SCORE2 is not validated under age 40/);await unmount();
}
console.log('Results child safety: localized urgency, closed report and optional fields, single result save, decimal/unknown/binary receipts, SCORE2 applicability, stale/access approval lock, explicit refresh and approval callbacks passed.');

}
// Alert mutations update the already-mounted plan without replacing its edits.
{
modules['./plan-ready-card']=await import('@/components/doctor-chat-v2/plan-ready-card');modules['@/lib/patient-care/required-lab-match']=await import('@/lib/patient-care/required-lab-match');
 const Plan=load('components/doctor-chat-v2/plan.tsx').DoctorChatPlan as typeof import('@/components/doctor-chat-v2/plan').DoctorChatPlan;
 const labels=await import('@/lib/care-alerts/contracts');
 const writes:unknown[]=[];
 io.readDoctorChatPlan=async()=>({kind:'plan',approvals:fixturePlan(member)});
 io.readDoctorChatAiPlan=async()=>({kind:'off'});
 io.acknowledgeDoctorChatAlert=async(raw:unknown,doctor:string)=>{
  assert.equal(doctor,actorId);writes.push(raw);
  patientAlerts=patientAlerts.map(row=>({...row,alert:{...row.alert,state:'acknowledged',stateSeq:2}}));
  return {kind:'saved',notice:'acknowledged'};
 };
 io.resolveDoctorChatAlert=async(raw:unknown,doctor:string)=>{assert.equal(doctor,actorId);writes.push(raw);patientAlerts=[];return {kind:'saved',notice:'resolved'};};
 for(const locale of ['en','hy','ru'] as const){
  writes.length=0;patientData=fixtureMember(member);patientHistory={kind:'history',conversations:[],turns:[],target:null};
  const warning=alert('route-alert');
  await planTree(Plan,{memberId:member,name:'Example',aiDraft:false,doctorId:actorId,locale,alerts:[warning],onOpen(){},onSaved(){},onAction(){},onCheckAgain(){}});
  const plan=screen.root.findByProps({'data-plan-member':member});
  const section=()=>plan.findAllByProps({className:'dcv2-answer-first'});
  const editor=plan.findByProps({'data-decision':'regimen'}).findByType('textarea');
  await act(async()=>editor.props.onChange({target:{value:'Keep my plan review'}}));
  const before=newestCalls;
  await press(copy.st(locale,'Acknowledge','Հաստատել','Подтвердить'));
  assert.equal(newestCalls,before+1);assert.deepEqual(JSON.parse(JSON.stringify(writes[0])),{alertId:warning.alert.id,seq:1});
  assert.equal(section().length,1,'Acknowledge retains the unresolved plan alert');
  assert.equal(screen.root.findAllByType('button').filter(b=>b.children.join('')===copy.st(locale,'Acknowledge','Հաստատել','Подтвердить')).length,0,'Acknowledged alert stays visible without Acknowledge');
  const details=screen.root.findAllByType('details').find(node=>node.props.onToggle)!;
  await act(async()=>details.props.onToggle({currentTarget:{open:true}}));
  assert.ok(serialized().includes(labels.closingAsLabel('Doctor Example',locale)),'The Resolve step says whose name the closing is recorded under');
  const form=screen.root.findAllByType('form').find(node=>node.props['data-resolve-form'])!;
  await act(async()=>form.findByType('select').props.onChange({target:{value:'no_action_needed'}}));
  assert.equal(writes.length,1,'Choosing an outcome never writes');
  await act(async()=>form.findByType('textarea').props.onChange({target:{value:'Called the member, no action needed'}}));
  const fields=new FormData();fields.set('resolution','no_action_needed');fields.set('note','Called the member, no action needed');
  await act(async()=>form.props.onSubmit({preventDefault(){},currentTarget:fields}));
  assert.deepEqual(JSON.parse(JSON.stringify(writes[1])),{alertId:warning.alert.id,seq:2,resolution:'no_action_needed',note:'Called the member, no action needed'});
  assert.equal(section().length,0,'Resolving removes the plan alert immediately');
  assert.equal(editor.props.value,'Keep my plan review','Alert actions preserve the mounted plan review');
  await unmount();
 }
 console.log('Patient alert actions: localized actor attribution, exact sequence/note, no write before explicit confirmation, acknowledgement and resolution update the mounted plan while preserving edits.');
}

}

// A server-validated lab hint opens once and respects input/scroll before load.
focusClosed=false;pendingAlerts=null;
const labProps={...props(member),focusLabId:id(4)};
const mountLab=async()=>{await act(async()=>{screen=create(React.createElement(Patient,labProps),{createNodeMock:()=>({scrollIntoView:(options:unknown)=>scrolls.push(options)})});});};
scrolls.length=0;await mountLab();await flushFrames();
assert.equal(screen.root.findAllByProps({'data-card':'lab'}).length,1);
assert.equal(scrolls.length,1,'Lab card scrolls into view once');
await act(async()=>{screen.update(React.createElement(Patient,labProps));});await flushFrames();
assert.equal(screen.root.findAllByProps({'data-card':'lab'}).length,1,'Refresh does not append another lab card');
assert.equal(scrolls.length,1);
await act(async()=>screen.unmount());
const oldHistory=testActions.readDoctorPatientChatHistory;
for(const interaction of ['onInputCapture','onWheelCapture','onTouchStartCapture']){
 let finishHistory!:(value:unknown)=>void;
 testActions.readDoctorPatientChatHistory=()=>new Promise(resolve=>{finishHistory=resolve;});
 scrolls.length=0;await mountLab();
 await act(async()=>{screen.root.findByType('main').props[interaction]();screen.root.findByType('textarea').props.onChange({target:{value:'Keep my question'}});});
 await act(async()=>finishHistory({kind:'history',conversations:[],turns:[]}));await flushFrames();
 assert.equal(screen.root.findAllByProps({'data-card':'lab'}).length,0,`No delayed lab opening after ${interaction}`);
 assert.equal(scrolls.length,0);assert.equal(screen.root.findByType('textarea').props.value,'Keep my question');
 await act(async()=>screen.unmount());
}
testActions.readDoctorPatientChatHistory=oldHistory;
console.log('Lab focus: one opening and scroll, no duplicate on refresh, no opening after input/scroll (mounted controlled IO).');
