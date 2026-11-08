import {resolveTestModule} from './care-alert-resolve-test-module';
import * as suggestions from '@/lib/care-alerts/resolution-suggestion';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import * as contracts from '@/lib/care-alerts/contracts';
const id='ba040000-0000-4000-8000-000000000001';
const alert={id,memberId:id,memberName:'Synthetic member',source:'zoe',priority:'urgent',reason:'zoe_urgent_route',redFlags:[],state:'acknowledged',stateSeq:2,occurrences:1,createdAt:'2026-11-05T08:00:00Z',lastSeenAt:'2026-11-05T08:00:00Z',doctorName:'Synthetic doctor',ownerName:'Synthetic nurse',ownerRole:'nurse',acknowledgedAt:'2026-11-05T08:01:00Z',acknowledgedBy:'Synthetic nurse',resolvedAt:null,resolvedBy:null,resolution:null,resolutionNote:null,telegram:[],nextAction:null,nextActionBy:null,nextActionAt:null,nextActionDueAt:null};
let enabled=true,role='nurse',calls:unknown[][]=[],failure=false,reply:unknown={ok:true,changed:true,alert};
const warnings:unknown[][]=[];
const modules:Record<string,unknown>={
 zod:{z},'@/lib/care-alerts/contracts':{...contracts,careAlertsEnabled:()=>enabled},
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 '@/lib/observability/logger':{log:{warn:(...args:unknown[])=>warnings.push(args)}},
 'next/cache':{revalidatePath:()=>{}},'next/navigation':{redirect:(url:string)=>{throw Error(url);}},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>({identity:{role},client:{rpc:async(...args:unknown[])=>{calls.push(args);if(failure)throw Error('PRIVATE DRAFT TEXT');return {data:reply,error:null};}}})},
};
modules['./resolution-suggestion']=suggestions;
modules['./contracts']=modules['@/lib/care-alerts/contracts'];
const exports:Record<string,unknown>={};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/care-alerts/actions.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,Date,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];}});
const change=exports.changeCareAlert as (input:unknown)=>Promise<{ok:boolean;code?:string;alert?:contracts.CareAlert}>;
assert.equal(typeof change,'function','Inline nurse actions exist');
for(const input of [{kind:'next_action',alertId:id,seq:1,text:' '},{kind:'next_action',alertId:id,seq:1,text:'x'.repeat(301)},{kind:'next_action',alertId:id,seq:1,text:'Call',dueAt:'tomorrow'},{kind:'resolve',alertId:id,seq:1,resolution:'duplicate',note:'Reviewed'},{kind:'resolve',alertId:id,seq:1,resolution:'other',note:' '},{kind:'acknowledge',alertId:id,seq:-1}]){
 calls=[];assert.equal((await change(input)).ok,false);assert.equal(calls.length,0,'Invalid commands never reach SQL');
}
for(const kind of ['acknowledge','next_action','resolve']){
 calls=[];const result=await change({kind,alertId:id,seq:1,text:' Call the member ',dueAt:'2026-11-05T12:00:00Z',resolution:'other',note:'Reviewed with the doctor'});
 assert.equal(result.ok,true);assert.equal((calls[0][0] as string),`care_alert_${kind}`);
 const args=calls[0][1] as Record<string,unknown>;assert.equal(args.p_expected_seq,1);
 if(kind==='next_action'){assert.equal(args.p_text,'Call the member');assert.equal(args.p_due_at,'2026-11-05T12:00:00Z');}
}
for(const r of ['member','clinic_admin','unknown']){role=r;calls=[];assert.equal((await change({kind:'acknowledge',alertId:id,seq:1})).ok,false);assert.equal(calls.length,0);}
role='nurse';enabled=false;calls=[];assert.equal((await change({kind:'acknowledge',alertId:id,seq:1})).ok,false);assert.equal(calls.length,0);enabled=true;
reply={ok:false,code:'changed',alert};assert.equal((await change({kind:'acknowledge',alertId:id,seq:1})).code,'changed');
reply={ok:true};assert.equal((await change({kind:'acknowledge',alertId:id,seq:1})).ok,false);
failure=true;assert.equal((await change({kind:'next_action',alertId:id,seq:1,text:'PRIVATE DRAFT TEXT'})).ok,false);
assert.ok(warnings.length);assert.ok(!JSON.stringify(warnings).includes('PRIVATE DRAFT TEXT'),'Logs never contain provider errors or drafts');
console.log('PASS care-alert inline actions: nurse role, validation, exact sequence, changed/unavailable and safe logging (mocked RPC).');

// The lazy read authenticates and validates independently of the visible form.
const read=exports.readCareAlertResolutionRecord as (id:string)=>Promise<unknown>;
const privateNotes=['PRIVATE DOCTOR HANDOVER INSTRUCTIONS','PRIVATE OTHER STAFF RESOLUTION NOTE','PRIVATE PREVIOUS ALERT RESOLUTION NOTE'];
failure=false;reply={ok:true,record:{alert:{...alert,resolutionNote:privateNotes[2]},cycleStartedAt:alert.createdAt,closer:'Synthetic nurse',contacts:[],notes:privateNotes.map(text=>({memberId:id,by:'Synthetic doctor',at:alert.createdAt,text}))}};calls=[];
const readRecord=await read(id) as suggestions.ResolutionRecord;
assert.ok(readRecord);assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['care_alert_resolution_record',{p_alert:id}]]);
for(const text of privateNotes){
 assert.ok(!JSON.stringify(readRecord).includes(text),'Reader strips private note text from an RPC mock');
 for(const locale of ['en','hy','ru'] as const)assert.ok(!suggestions.suggestResolution(readRecord,locale).reason.includes(text),'Private reader notes never enter the reason');
}
reply={ok:true,record:{alert,contacts:[]}};
assert.equal(await read(id),null,'A reader snapshot without its current cycle onset is unavailable');
for(const denied of ['member','clinic_admin','unknown']){role=denied;calls=[];assert.equal(await read(id),null);assert.equal(calls.length,0);}
role='nurse';enabled=false;calls=[];assert.equal(await read(id),null);assert.equal(calls.length,0);enabled=true;
calls=[];assert.equal(await read('bad-id'),null);assert.equal(calls.length,0);
reply={ok:true,record:{alert:{...alert,id:'ba040000-0000-4000-8000-000000000099'},cycleStartedAt:alert.createdAt,contacts:[]}};
assert.equal(await read(id),null,'A mismatched alert is never returned to the client');
reply={ok:true};assert.equal(await read(id),null);failure=true;assert.equal(await read(id),null);failure=false;
console.log('PASS Resolve record action: flag, role, UUID, matching alert, malformed and failed reads (mocked RPC).');

// Mount the actual inline controls. Only the server command is substituted.
const React=await import('react'),jsx=await import('react/jsx-runtime');
const {act,create}=await import('react-test-renderer');
const {renderToStaticMarkup}=await import('react-dom/server');
const copy=await import('@/lib/staff/staff-locale-copy');
const time=await import('@/lib/staff/yerevan-time');
const {AlertCardLines}=await import('@/components/staff/alert-card');
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let requests:Record<string,unknown>[]=[],changed:contracts.CareAlert[]=[];
let mode='saved',pending:((value:unknown)=>void)|undefined;
const uiModules:Record<string,unknown>={'./care-alert-resolve':resolveTestModule(),react:React,'react/jsx-runtime':jsx,
 '@/lib/staff/staff-locale-copy':copy,'@/lib/care-alerts/contracts':contracts,'@/lib/staff/yerevan-time':time,'./alert-card':{AlertCardLines},
 '@/lib/care-alerts/actions':{changeCareAlert:async(input:Record<string,unknown>)=>{requests.push(input);if(mode==='pending')return new Promise(resolve=>{pending=resolve;});if(mode==='changed')return {ok:false,code:'changed'};if(mode==='throw')throw Error('offline');return {ok:true,changed:true,alert:{...alert,state:input.kind==='resolve'?'resolved':'acknowledged',stateSeq:Number(input.seq)+1,nextAction:input.text??null,nextActionAt:alert.createdAt,nextActionBy:'Synthetic nurse',resolvedBy:input.kind==='resolve'?'Synthetic nurse':null,resolvedAt:input.kind==='resolve'?alert.createdAt:null,resolution:input.kind==='resolve'?'other':null,resolutionNote:input.note??null}};}},
};
class SubmittedFormData extends FormData {constructor(form?:FormData){super();form?.forEach((value,key)=>this.append(key,value));}}
const uiExports:Record<string,unknown>={};
vm.runInNewContext(ts.transpileModule(readFileSync('components/staff/nurse-urgent-alerts.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:uiExports,Date,FormData:SubmittedFormData,require:(name:string)=>{assert.ok(name in uiModules,name);return uiModules[name];}});
const Row=uiExports.NurseUrgentAlertRow as typeof import('@/components/staff/nurse-urgent-alerts').NurseUrgentAlertRow;
const fixture=contracts.careAlertSchema.parse({...alert,state:'open',stateSeq:1,acknowledgedAt:null,acknowledgedBy:null});
for(const locale of ['en','hy','ru'] as const){
 const html=renderToStaticMarkup(React.createElement(Row,{alert:fixture,locale}));
 assert.ok(html.includes('name="text"')&&html.includes('maxLength="300"')&&html.includes('name="dueAt"'));
 assert.ok(html.includes('name="resolution"')&&html.includes('name="note"')&&!html.includes('value="duplicate"'));
 assert.ok(html.includes('Synthetic nurse')&&html.includes('data-alert-owner'));
}
let tree!:ReturnType<typeof create>;
await act(async()=>{tree=create(React.createElement(Row,{alert:fixture,locale:'en',onChanged:a=>changed.push(a)}));});
await act(async()=>{tree.root.findAllByType('button').find(b=>b.children.includes('Acknowledge'))!.props.onClick();});
assert.equal(requests[0].seq,1);assert.equal(changed[0].state,'acknowledged');
assert.ok(tree.root.findAllByType('form').every(form=>!form.props.action&&typeof form.props.onSubmit==='function'),'Manual submit preserves uncontrolled drafts instead of React action reset');
const submit=(index:number,data:FormData)=>{let prevented=false;tree.root.findAllByType('form')[index].props.onSubmit({preventDefault(){prevented=true;},currentTarget:data});assert.ok(prevented);};
const actionForm=new FormData();actionForm.set('text','Call <script>member</script>');
await act(async()=>{submit(0,actionForm);});
assert.equal(requests[1].seq,2,'Next action uses confirmed updated sequence');
assert.ok(JSON.stringify(tree.toJSON()).includes('Call <script>member</script>'));
const resolutionForm=new FormData();resolutionForm.set('resolution','other');resolutionForm.set('note','Reviewed the follow-up');
await act(async()=>{tree.root.findAllByType('details').find(d=>d.props.onToggle)!.props.onToggle({currentTarget:{open:true}});});
await act(async()=>{submit(1,resolutionForm);});
assert.equal(requests[2].seq,3);assert.equal(changed.at(-1)!.state,'resolved');assert.equal(tree.root.findAllByType('form').length,0,'Resolved row offers no further mutations');
await act(async()=>tree.unmount());
for(mode of ['changed','throw']){
 requests=[];changed=[];
 await act(async()=>{tree=create(React.createElement(Row,{alert:fixture,locale:'en',onChanged:a=>changed.push(a)}));});
 await act(async()=>{submit(0,actionForm);});
 assert.equal(changed.length,0,'An unconfirmed change never updates the parent');
 assert.equal(tree.root.findAllByType('fieldset')[0].props.disabled,true,'Read current state before another write');
 assert.ok(JSON.stringify(tree.toJSON()).includes('Reload alerts'));
 assert.equal(tree.root.findAllByType('textarea').length,2,'Forms and draft inputs remain mounted on failure');
 await act(async()=>tree.unmount());
}
mode='pending';requests=[];
await act(async()=>{tree=create(React.createElement(Row,{alert:fixture,locale:'en'}));});
await act(async()=>{const button=tree.root.findAllByType('button').find(b=>b.children.includes('Acknowledge'))!;button.props.onClick();button.props.onClick();});
assert.equal(requests.length,1,'A double click sends one command');
await act(async()=>pending!({ok:false,code:'changed'}));await act(async()=>tree.unmount());
console.log('PASS care-alert controls: locales, acknowledge/action/resolve sequence, changed/offline drafts, confirmed callbacks and double-click guard (mocked action).');
