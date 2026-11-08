import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {act,create} from 'react-test-renderer';
import * as schema from '@/lib/first-note/schema';
import * as runtime from '@/lib/first-note/runtime';
import * as locale from '@/lib/locale';
import * as dates from '@/lib/patient/date-format';
import * as icons from 'lucide-react';

globalThis.fetch=(()=>{throw Error('Network used in a check');}) as typeof fetch;
const id='fb040000-0000-4000-8000-000000000001',other='fb040000-0000-4000-8000-000000000002';
const queue={version:'first-note-queue-v1',enabled:true,items:[
 {memberId:id,memberName:'Synthetic overdue member',doctorName:'Synthetic owner',completedAt:'2026-10-18T08:00:00Z',dueAt:'2026-10-19T08:00:00Z'},
 {memberId:other,memberName:'Synthetic recent member',doctorName:null,completedAt:'2026-11-05T08:00:00Z',dueAt:'2026-11-06T08:00:00Z'},
],closed:[{memberId:other,memberName:'Synthetic closed member',doctorName:null,closedByName:'Synthetic reviewer',closedAt:'2026-11-04T08:00:00Z',reason:'Synthetic backlog reason'}]};
const parsed=schema.firstNoteQueueSchema.parse(queue);
assert.equal(parsed.items[0].doctorName,'Synthetic owner','Owner survives RPC parsing');
assert.equal(parsed.closed[0].reason,'Synthetic backlog reason','Closure survives RPC parsing');
const calls:unknown[][]=[];
let data:unknown={status:'closed'},error:{code:string}|null=null,throws=false;
const rpc={rpc:async(...args:unknown[])=>{calls.push(args);if(throws)throw Error('PRIVATE REASON');return {data,error};}};
for(const reason of [null,'',' ','\n\t','x'.repeat(501)]){
 calls.length=0;
 assert.equal((await runtime.runFirstNoteBacklogClose(rpc,{memberId:id,reason})).status,'invalid');
 assert.equal(calls.length,0,'Invalid reasons never reach SQL');
}
assert.equal((await runtime.runFirstNoteBacklogClose(rpc,{memberId:id,reason:'  Reviewed  '})).status,'closed');
assert.deepEqual(calls.at(-1),['doctor_first_note_backlog_close',{p_member:id,p_reason:'Reviewed'}]);
for(const status of ['not-overdue','already','disabled','unavailable','closed']){
 data={status};assert.equal((await runtime.runFirstNoteBacklogClose(rpc,{memberId:id,reason:'x'})).status,status);
}
data={status:'reopened'};
assert.equal((await runtime.runFirstNoteBacklogReopen(rpc,{memberId:id})).status,'reopened');
assert.deepEqual(calls.at(-1),['doctor_first_note_backlog_reopen',{p_member:id}]);
error={code:'42501'};assert.equal((await runtime.runFirstNoteBacklogReopen(rpc,{memberId:id})).status,'access');
error=null;data={unexpected:'raw database response'};assert.equal((await runtime.runFirstNoteBacklogReopen(rpc,{memberId:id})).status,'outcome-unknown');
throws=true;assert.equal((await runtime.runFirstNoteBacklogClose(rpc,{memberId:id,reason:'PRIVATE REASON'})).status,'outcome-unknown');
assert.equal(await runtime.readFirstNoteQueue(rpc),null,'Unreadable queue differs from empty');
throws=false;data=queue;assert.equal((await runtime.readFirstNoteQueue(rpc))?.closed.length,1);

// Execute the actual actions and component, substituting only framework/auth and RPC boundaries.
function load(path:string,modules:Record<string,unknown>){
 const exports:Record<string,unknown>={};
 vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Date,console,require:(name:string)=>{assert.ok(name in modules,`${path}: missing module ${name}`);return modules[name];}});
 return exports;
}
let role='doctor';const paths:string[]=[];
const actions=load('lib/first-note/actions.ts',{
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 'next/cache':{revalidatePath:(path:string)=>paths.push(path)},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>({identity:{role},client:rpc})},
 './runtime':runtime,'./schema':schema,
 '@/lib/staff-zoe/workspace-config':{doctorDecisionsEnabled:()=>true},
 '@/lib/doctor-decisions/approvals':{firstNoteContextSchema:{safeParse:()=>({success:true})}},
});
const close=actions.closeFirstNoteBacklog as (input:unknown)=>Promise<{status:string}>;
const reopen=actions.reopenFirstNoteBacklog as typeof close;
for(role of ['doctor','admin']){
 data={status:'closed'};assert.equal((await close({memberId:id,reason:'Reviewed'})).status,'closed');
 data={status:'reopened'};assert.equal((await reopen({memberId:id})).status,'reopened');
}
assert.ok(paths.includes('/staff/real/members')&&paths.includes('/staff/real/today')&&paths.includes('/staff/real/doctor-workspace'),'Every queue surface is revalidated');
role='nurse';calls.length=0;assert.equal((await close({memberId:id,reason:'Reviewed'})).status,'access');assert.equal(calls.length,0);
role='admin';data={status:'closed'};
let refreshes=0,uiFailure=false;
const uiCalls:unknown[][]=[];
const component=load('components/staff/first-note-queue.tsx',{
 react:React,'react/jsx-runtime':jsx,'next/link':{default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement('a',props,children)},
 'next/navigation':{useRouter:()=>({refresh:()=>refreshes++})},'lucide-react':icons,'@/lib/locale':locale,'@/lib/patient/date-format':dates,
 '@/lib/first-note/actions':{
  closeFirstNoteBacklog:async(input:unknown)=>{uiCalls.push(['close',input]);if(uiFailure)throw Error('PRIVATE REASON');return {status:'closed'};},
  reopenFirstNoteBacklog:async(input:unknown)=>{uiCalls.push(['reopen',input]);return {status:uiFailure?'unavailable':'reopened'};},
 },
});
const Queue=component.FirstNoteQueue as React.ComponentType<{queue:schema.FirstNoteQueue|null;locale:locale.Locale;now:Date}>;
const now=new Date('2026-11-05T10:00:00Z');
for(const [l,owner,unassigned,closedLabel,reopenLabel,unreadable] of [
 ['en','Owner','Not assigned','Backlog, reviewed','Reopen','First notes could not be loaded'],
 ['hy','Պատասխանատու','Նշանակված չէ','Հետաձգված, վերանայված','Վերաբացել','Առաջին գրառումները չհաջողվեց բեռնել'],
 ['ru','Ответственный','Не назначен','Архив, проверено','Открыть снова','Не удалось загрузить первые сообщения'],
] as const){
 const html=renderToStaticMarkup(React.createElement(Queue,{queue:parsed,locale:l,now}));
 for(const text of [owner,unassigned,'Synthetic owner',closedLabel,reopenLabel,'Synthetic reviewer','Synthetic backlog reason'])assert.ok(html.includes(text),`${l}: ${text}`);
 assert.equal((html.match(/<textarea/g)??[]).length,1,'Only overdue items get a close form');
 assert.match(html,/<textarea[^>]*required[^>]*maxLength="500"/);
 assert.ok(renderToStaticMarkup(React.createElement(Queue,{queue:null,locale:l,now})).includes(unreadable),'Unreadable is explicit');
 assert.equal(renderToStaticMarkup(React.createElement(Queue,{queue:{...parsed,enabled:false},locale:l,now})), '');
}
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let tree:ReturnType<typeof create>;
await act(async()=>{tree=create(React.createElement(Queue,{queue:parsed,locale:'en',now}));});
const form=()=>tree!.root.findByType('form');
await act(async()=>{tree!.root.findByType('textarea').props.onChange({target:{value:'  Reviewed backlog  '}});});
uiFailure=true;
await act(async()=>{await form().props.onSubmit({preventDefault(){}});});
assert.match(JSON.stringify(tree!.toJSON()),/could not be saved/,'Thrown save failure is visible');
assert.equal(refreshes,0);
uiFailure=false;
await act(async()=>{await form().props.onSubmit({preventDefault(){}});});
assert.equal(refreshes,1);assert.equal((uiCalls.at(-1)?.[1] as {reason:string}).reason,'Reviewed backlog');
const reopenButton=()=>tree!.root.findAllByType('button').find(b=>b.children.includes('Reopen'))!;
uiFailure=true;await act(async()=>{await reopenButton().props.onClick();});
assert.match(JSON.stringify(tree!.toJSON()),/could not be saved/,'Reopen failure is visible');
uiFailure=false;await act(async()=>{await reopenButton().props.onClick();});assert.equal(refreshes,2);
await act(async()=>{tree!.unmount();});
console.log('PASS first-note backlog: RPC validation, action roles, three-locale owner/forms/closures, explicit read/save failures and close/reopen interaction (mocked RPC).');
