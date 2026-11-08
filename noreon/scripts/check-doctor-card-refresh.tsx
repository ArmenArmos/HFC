import assert from 'node:assert/strict';
import React,{useState} from 'react';
import TestRenderer,{act} from 'react-test-renderer';
// @ts-expect-error Node 26 runtime API; project types target Node 20.
import {registerHooks} from 'node:module';
let routeRefreshes=0,path='/staff/real/doctor-workspace';
Object.assign(globalThis,{document:new EventTarget(),IS_REACT_ACT_ENVIRONMENT:true,__doctorRefreshReact:React,__doctorRefreshRouter:{refresh:()=>routeRefreshes++},__doctorRefreshPath:()=>path});
const hook=registerHooks({resolve(specifier:string,context:object,next:(s:string,c:object)=>object){
 if(specifier==='next/navigation')return {url:'data:text/javascript,'+encodeURIComponent('export const redirect=()=>{throw Error("Unexpected redirect")};export const notFound=()=>{throw Error("Unexpected notFound")};export const unstable_rethrow=()=>{};export const useRouter=()=>globalThis.__doctorRefreshRouter;export const usePathname=()=>globalThis.__doctorRefreshPath();'),shortCircuit:true};
 if(specifier==='next/link')return {url:'data:text/javascript,'+encodeURIComponent('export const useLinkStatus=()=>({pending:false});export default function Link(p){return globalThis.__doctorRefreshReact.createElement("a",p,p.children)}'),shortCircuit:true};
 return next(specifier,context);
}});
const {RecordRefreshProvider}=await import('@/components/staff/record-refresh');
const {MemberSafetyPanel}=await import('@/components/staff/member-safety-panel');
const {MemberDocuments}=await import('@/components/staff/member-documents');
const {GpReportPanel}=await import('@/components/staff/gp-report-panel');
const {default:Link}=await import('next/link');
const {DoctorChatShell}=await import('@/components/staff/doctor-workspace/chat-shell');
const member='11111111-1111-4111-8111-111111111111',fileId='22222222-2222-4222-8222-222222222222',at='2026-11-01T00:00:00Z';
let refreshes=0,deny=false;
function Safety(){
 const [active,setActive]=useState(true);
 return <RecordRefreshProvider value={()=>{refreshes++;setActive(false);}}><MemberSafetyPanel memberId={member} locale="en" data={{enabled:true,role:'doctor',holds:[{id:fileId,kind:'exercise_pause',sourceField:'q10.syncope',sourceValue:'yes',startedAt:at,expiresAt:null,active,reviewedAt:null,clearedAt:active?null:at,clearedByRole:null,clearNote:null,audit:[]}]}} decide={async()=>deny?{ok:false,reason:'unavailable'}:{ok:true,result:'cleared'}}/></RecordRefreshProvider>;
}
let tree:TestRenderer.ReactTestRenderer;
const button=(label:string)=>tree!.root.findAllByType('button').find(b=>b.children.join('')===label)!;
const content=()=>JSON.stringify(tree!.toJSON());
await act(async()=>{tree=TestRenderer.create(<Safety/>);});
const clear=tree!.root.findAllByType('button')[0];
deny=true;await act(async()=>clear.props.onClick());assert.equal(refreshes,0,'Failed changes retain the displayed card');
deny=false;await act(async()=>clear.props.onClick());assert.equal(refreshes,1);assert.equal(tree!.root.findAllByType('button').length,0,'Successful clear replaces active controls without a manual reload');
await act(async()=>tree!.unmount());

let docOpened=false,docReleased=false,docWrites=0;
const renderDocs=()=> <RecordRefreshProvider value={()=>{refreshes++;tree!.update(renderDocs());}}><MemberDocuments data={{version:'member-documents-v1',enabled:true,documents:[{fileId,name:'Fictional.pdf',clinic:'Example clinic',uploadedAt:at,attachedAt:at,released:docReleased,releasedAt:docReleased?at:null,openedByYou:docOpened}]}} memberId={member} locale="en" submissionIds={{[`${fileId}:release`]:fileId,[`${fileId}:withdraw`]:fileId}} command={async()=>{docWrites++;docReleased=true;return {status:'released'};}}/></RecordRefreshProvider>;
await act(async()=>{tree=TestRenderer.create(renderDocs());});
assert.equal(tree!.root.findAllByType('input').length,0,'Release stays blocked before the audited PDF open');
const savedTimeout=globalThis.setTimeout;let afterOpen:(()=>void)|undefined;
// Capture only the existing document-open delay; no browser/PDF route is simulated as audited.
globalThis.setTimeout=((fn:()=>void)=>{afterOpen=fn;return 0;}) as unknown as typeof setTimeout;
try{await act(async()=>tree!.root.findAllByType('a').find(a=>a.props.target==='_blank')!.props.onClick());}finally{globalThis.setTimeout=savedTimeout;}
docOpened=true;await act(async()=>afterOpen!());
assert.equal(tree!.root.findAllByType('input').length,1,'A refreshed audited-open result reveals the exact confirmation');
await act(async()=>tree!.root.findByType('input').props.onChange({target:{checked:true}}));
await act(async()=>button('Release to member').props.onClick());
assert.equal(docWrites,1);assert.ok(content().includes('Withdraw from member'),'Saved release refreshes to withdrawal controls');
await act(async()=>tree!.unmount());

let approved=false,gpWrites=0;
function Gp(){const [version,setVersion]=useState<number|null>(null);return <RecordRefreshProvider value={()=>{refreshes++;setVersion(1);}}><GpReportPanel memberId={member} locale="en" token={'a'.repeat(32)} submissionId={fileId} blocks={{en:[{type:'p',text:'Exact report preview'}],hy:[]}} versions={[]} currentApproved={version} approve={async()=>{gpWrites++;approved=true;return {status:'approved',approval:{version:1,approvedAt:at,approvedByName:'Doctor'}};}}/></RecordRefreshProvider>;}
await act(async()=>{tree=TestRenderer.create(<Gp/>);});
assert.equal(button('Approve this report').props.disabled,true);assert.equal(gpWrites,0);
await act(async()=>tree!.root.findByType('input').props.onChange({target:{checked:true}}));
await act(async()=>button('Approve this report').props.onClick());
assert.ok(approved);assert.equal(gpWrites,1);assert.ok(!tree!.root.findAllByType('button').some(b=>b.children.join('')==='Approve this report'),'Successful report approval replaces draft controls');
assert.equal(routeRefreshes,0,'Chat mutations refresh their card, not the route');
await act(async()=>tree!.unmount());
for(const locale of ['en','hy','ru']as const){
 await act(async()=>{tree=TestRenderer.create(<DoctorChatShell locale={locale} nav={<Link href="/staff/real/members">Members</Link>} actions={<><span>Doctor Example</span><button>Sign out</button></>} fallback={<aside>Legacy sidebar</aside>}><p>Chat</p></DoctorChatShell>);});
 assert.equal(tree!.root.findAllByType('aside').length,0);assert.equal(tree!.root.findAllByType('details').length,2);assert.ok(content().includes('Doctor Example'));
 await act(async()=>tree!.unmount());
}
path='/staff/real/members';
await act(async()=>{tree=TestRenderer.create(<DoctorChatShell locale="en" nav={null} actions={null} fallback={<aside>Legacy sidebar</aside>}>Chat</DoctorChatShell>);});
assert.equal(tree!.root.findAllByType('aside').length,1,'Full pages retain their existing shell');
await act(async()=>tree!.unmount());hook.deregister();
console.log('Actual safety/document/GP panels: failed writes retained, successful changes refresh snapshot, PDF-open release guard, exact report press; compact/legacy shells pass (controlled IO, no browser/DB)');
