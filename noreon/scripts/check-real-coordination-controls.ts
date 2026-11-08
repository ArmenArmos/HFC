import * as taskCopy from '../lib/staff/real-coordination/task-copy';
/** Real hooks and UI component; deferred server boundary, no external calls. */
import * as displayText from '@/lib/staff/display-text';
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import React from 'react';import * as jsx from 'react/jsx-runtime';import {act,create,type ReactTestRenderer} from 'react-test-renderer';import * as schema from '../lib/staff/real-coordination/schema';import * as statusCopy from '../lib/staff/real-coordination/status-copy';
import * as staffLocaleCopy from '../lib/staff/staff-locale-copy';import * as staffServerCopy from '../lib/staff/staff-server-copy';
import {selectFieldNativeStub} from './select-field-native-stub';
import * as realLocaleModule from '@/lib/locale';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let finish!:(r:unknown)=>void;const requests:Record<string,unknown>[]=[];let currentTask:schema.CoordinationTask={id:'a8000000-0000-4000-8000-000000000002',caseId:'a8000000-0000-4000-8000-000000000001',memberName:'Fictional member',kind:'contact-followup' as const,title:'Fictional contact',instructions:'Collect an operational update',dueAt:null,creatorId:'a8000000-0000-4000-8000-000000000003',ownerId:'a8000000-0000-4000-8000-000000000004',ownerName:'Fictional nurse',status:'open' as const,revision:1,createdAt:'2026-10-14T12:00:00Z',updatedAt:'2026-10-14T12:00:00Z',needsReassignment:false,eligibleOwners:[{id:'a8000000-0000-4000-8000-000000000004',name:'Fictional nurse',role:'nurse' as const}]};
let currentEvents:schema.CoordinationSnapshot["events"]=[];
const exports:Record<string,unknown>={};new vm.Script(ts.transpileModule(readFileSync('components/staff/real-coordination-tasks.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText).runInNewContext({exports,crypto,Date,FormData:class{constructor(form:{values:Map<string,string>}){return form.values;}},require(name:string){if(name==='@/lib/staff/display-text')return displayText;if(name==='@/lib/staff/real-coordination/task-copy')return taskCopy;if(name==='@/lib/staff/real-coordination/status-copy')return statusCopy;if(name==='lucide-react')return {ArrowRight:()=>React.createElement('svg'),UserRound:()=>React.createElement('svg')};if(name==='@/components/ui/select-field')return selectFieldNativeStub;if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;if(name==='@/components/staff/record-refresh')return {useRecordRefresh:()=>()=>{}};if(name==='next/navigation')return {useRouter:()=>({refresh(){}})};if(name==='next/link')return {default:(p:Record<string,unknown>)=>React.createElement('a',p)};if(name.endsWith('/schema'))return schema;if(name.endsWith('/actions'))return {coordinationCommand:async(c:Record<string,unknown>)=>{requests.push(c);return new Promise(resolve=>finish=resolve);},refreshCoordinationTask:async()=>({ok:true,task:{...currentTask,events:currentEvents}})};if(name.endsWith('/common'))return {stamp:()=> 'Fictional date'};if(name==='./shell')return {fieldClass:'field',buttonClass:'button'};if(name==='@/lib/staff/staff-locale-copy')return staffLocaleCopy;if(name==='@/lib/staff/staff-server-copy')return staffServerCopy;if(name==='@/lib/locale')return realLocaleModule;throw Error(name);}});
const {RealCoordinationTasks}=exports as typeof import('../components/staff/real-coordination-tasks');let tree!:ReactTestRenderer;
await act(async()=>{tree=create(React.createElement(RealCoordinationTasks,{page:{tasks:[currentTask],nextCursor:null},memberPage:{members:[],nextCursor:null},actor:{id:currentTask.ownerId,role:'nurse'}}));});
const form={values:new Map([['outcome','reached'],['note','Fictional contact']]),resets:0,reset(){this.resets++;}};
await act(async()=>{tree.root.findByProps({'aria-label':'Open Fictional contact'}).props.onClick();});
await act(async()=>{tree.root.findAllByType('form')[0].props.onSubmit({preventDefault(){},currentTarget:form});tree.root.findAllByType('form')[0].props.onSubmit({preventDefault(){},currentTarget:form});});
assert.equal(requests.length,1,'Two same-event submits must not race before React pending state renders');
await act(async()=>{finish({ok:false,error:'Task changed',uncertain:false});});
assert.equal(form.resets,0,'Conflict retains note');
assert.equal(tree.root.findAll(n=>n.type==='button'&&'aria-busy' in n.props)[0].props.disabled,true);
currentTask={...currentTask,revision:2};
await act(async()=>{tree.root.findByProps({'aria-label':'Refresh Fictional contact'}).props.onClick();});
assert.equal(tree.root.findAll(n=>n.type==='button'&&'aria-busy' in n.props)[0].props.disabled,false);
await act(async()=>{tree.root.findAllByType('form')[0].props.onSubmit({preventDefault(){},currentTarget:form});});
assert.equal(requests[1].revision,2);
await act(async()=>{finish({ok:true,id:currentTask.id,revision:3,status:'open'});});
assert.equal(form.resets,1);
assert.equal(tree.root.findAll(n=>n.type==='button'&&'aria-busy' in n.props)[0].props.disabled,true,'A successful write stays blocked if the snapshot read is still behind the committed task version');
currentTask={...currentTask,revision:3};
await act(async()=>{tree.root.findByProps({'aria-label':'Refresh Fictional contact'}).props.onClick();});
assert.equal(tree.root.findAll(n=>n.type==='button'&&'aria-busy' in n.props)[0].props.disabled,false);
await act(async()=>{tree.root.findAllByType('form')[0].props.onSubmit({preventDefault(){},currentTarget:form});});
await act(async()=>{finish({ok:false,error:'Unknown network result',uncertain:true});});
assert.equal(form.resets,1,'Uncertain result retains the note');
currentTask={...currentTask,revision:4};
currentEvents=[{id:1,revision:4,request_id:String(requests[2].requestId),actor_id:currentTask.ownerId,actor_name:'Fictional nurse',actor_role:'nurse',operation:'contact',old_status:'open',new_status:'open',old_owner_id:currentTask.ownerId,new_owner_id:currentTask.ownerId,note:'Fictional contact',care_note_id:null,detail:{input:{outcome:'reached',note:'Fictional contact'}},created_at:currentTask.updatedAt}];
await act(async()=>{tree.root.findByProps({'aria-label':'Refresh Fictional contact'}).props.onClick();});
assert.equal(form.resets,2,'A confirmed committed request clears the previously recorded note instead of inviting a duplicate');
assert.ok(tree.root.findAllByType('p').some(node=>node.props.className==='text-body2 font-medium'&&node.children.includes('Reached')),'Contact history displays the recorded outcome');
await act(async()=>{tree.unmount();});
console.log('Real task controls prevent same-event overlap, retain conflict notes, and retry only with current task version.');
// Case/clinic changes can alter owner eligibility without changing task version.
const doctorId=currentTask.creatorId;
currentEvents=[];
currentTask={...currentTask,eligibleOwners:[{id:doctorId,name:'Current doctor',role:'doctor' as const},{id:currentTask.ownerId,name:'Current nurse',role:'nurse' as const}],needsReassignment:false};
let visiblePage={tasks:[currentTask],nextCursor:null};
const renderAuthority=()=>React.createElement(RealCoordinationTasks,{page:visiblePage,memberPage:{members:[],nextCursor:null},actor:{id:doctorId,role:'doctor'}});
await act(async()=>{tree=create(renderAuthority());});
await act(async()=>{tree.root.findByProps({'aria-label':'Open Fictional contact'}).props.onClick();});
await act(async()=>{tree.root.findAllByType('textarea').find(node=>node.props.name==='note')!.props.onChange({target:{value:'Retained unsaved operational contact'}});});
visiblePage={tasks:[{...currentTask,eligibleOwners:[{id:doctorId,name:'Current doctor',role:'doctor' as const}],needsReassignment:true}],nextCursor:null};
await act(async()=>{tree.update(renderAuthority());});
assert.ok(tree.root.findAllByType('p').some(node=>node.children.join('').includes('Needs reassignment')),'Fresh same-revision list metadata overrides a previously loaded owner snapshot');
assert.ok(tree.root.findAllByType('p').some(node=>node.children.join('').includes('Retained unsaved operational contact')),'Blocked contact entry remains available while the owner is repaired');
assert.ok(tree.root.findAllByType('select').some(node=>node.props.name==='ownerId'&&node.findAllByType('option').some(option=>option.props.value===doctorId)),'Repair uses task-scoped owners even when the member search page is empty');
visiblePage={tasks:[currentTask],nextCursor:null};
await act(async()=>{tree.update(renderAuthority());});
assert.equal(tree.root.findAllByType('textarea').find(node=>node.props.name==='note')?.props.value,'Retained unsaved operational contact','Same-revision owner recovery restores the retained entry');
const orphan={...currentTask,creatorId:currentTask.ownerId,ownerId:'a8000000-0000-4000-8000-000000000009',needsReassignment:true};
await act(async()=>{tree.update(React.createElement(RealCoordinationTasks,{page:{tasks:[orphan],nextCursor:null},memberPage:{members:[],nextCursor:null},actor:{id:currentTask.ownerId,role:'nurse'}}));});
assert.equal(tree.root.findAllByType('option').some(option=>option.props.value==='cancel'),false,'Nurse historical creator cannot cancel an orphan task');
await act(async()=>{tree.unmount();});
console.log('Same-version authority updates override stale snapshots, retain note drafts, expose case-scoped repair owners and hide nurse orphan cancellation.');

// Regression: the dark nurse-chat feature must preserve the old Tasks page's
// assigned-nurse workflow, including operational work owned by the doctor.
const previousFlag=process.env.NOREON_NURSE_CHAT;
const nurseId=currentTask.ownerId;
process.env.NOREON_NURSE_CHAT='false';
const pageExports:Record<string,unknown>={};
new vm.Script(ts.transpileModule(readFileSync('app/staff/real/(review)/tasks/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText).runInNewContext({exports:pageExports,require(name:string){if(name==='@/lib/staff/display-text')return displayText;if(name==='@/lib/staff/real-coordination/task-copy')return taskCopy;
 if(name==='react/jsx-runtime')return jsx;
 if(name==='@/lib/staff/real-coordination/repository')return {readCoordinationWorkspace:async()=>({page:{tasks:[currentTask],nextCursor:null},memberPage:{members:[],nextCursor:null},actor:{id:nurseId,role:'nurse'}})};
 if(name==='@/components/staff/real-coordination-tasks')return {RealCoordinationTasks};
 if(name==='@/lib/staff/real-staff-render')return {requireRealStaffForRender:async()=>({client:{}})};
 if(name==='@/lib/care-alerts/nurse')return {readNurseAlerts:async()=>({kind:'ready',alerts:[],total:0})};
 if(name==='@/components/staff/nurse-urgent-alerts')return {NurseUrgentAlerts:()=>null};
 if(name==='@/lib/staff/staff-locale')return {staffLocale:async()=>'en'};
 if(name==='@/lib/staff/staff-locale-copy')return staffLocaleCopy;
 if(name==='@/lib/staff/real-staff-render')return {requireRealStaffForRender:async()=>{throw Error('BP tasks must stay off');}};
 if(name==='@/lib/patient/zoe-app-v3')return {zoeAppV3Enabled:()=>false};
 if(name==='@/lib/care-queue/server')return {readReportedBpTasks:async()=>{throw Error('BP tasks must stay off');}};
 if(name==='@/components/staff/reported-bp-tasks')return {ReportedBpTasks:()=>{throw Error('BP tasks must stay off');}};
 throw Error(name);
}});
const TasksPage=pageExports.default as (props:{searchParams:Promise<{view?:string}>})=>Promise<React.ReactElement>;
try{
 for(const kind of ['contact-followup','evidence-collection','booking-coordination'] as const){
  currentTask={...currentTask,kind,creatorId:doctorId,ownerId:doctorId,ownerName:'Current doctor',status:'open',revision:1,needsReassignment:false};
  await act(async()=>{tree=create(await TasksPage({searchParams:Promise.resolve({})}));});
  await act(async()=>tree.root.findByProps({'aria-label':'Open Fictional contact'}).props.onClick());
  for(const [operation,status] of [['await-member','awaiting-member'],['reopen','open'],['complete','completed']] as const){
   assert.ok(tree.root.findAllByType('option').some(option=>option.props.value===operation),`Flag-off Tasks page offers ${operation} on doctor-owned ${kind}`);
   await act(async()=>tree.root.findAllByType('select').find(select=>!select.props.name)!.props.onChange({target:{value:operation}}));
   await act(async()=>tree.root.findAllByType('form')[0].props.onSubmit({preventDefault(){},currentTarget:form}));
   assert.equal(requests.at(-1)?.operation,operation);
   assert.equal(requests.at(-1)?.taskId,currentTask.id);
   assert.equal(requests.at(-1)?.revision,currentTask.revision);
   currentTask={...currentTask,status,revision:currentTask.revision+1};
   await act(async()=>finish({ok:true,id:currentTask.id,status,revision:currentTask.revision}));
  }
  assert.equal(tree.root.findAllByProps({'aria-label':'Open Fictional contact'}).length,0,'Completed work leaves the old Tasks page active list');
  assert.ok(tree.root.findAllByType('p').some(p=>p.children.includes('Your task change is recorded.')),'Old Tasks UI confirms the saved change');
  await act(async()=>tree.unmount());
 }
}finally{
 if(previousFlag===undefined)delete process.env.NOREON_NURSE_CHAT;else process.env.NOREON_NURSE_CHAT=previousFlag;
}
console.log('Flag-off old Tasks page: assigned nurse advances and completes doctor-owned contact, evidence and booking work (mocked server boundary).');

// Clinic approvals use a staff FK representative, but history must credit the approver.
currentTask={...currentTask,status:'open'};
for(const locale of ['en','hy','ru'] as const){
 currentEvents=(['system','doctor','nurse','admin'] as const).map((role,index)=>({
  id:index+1,revision:index+1,request_id:crypto.randomUUID(),actor_id:doctorId,
  actor_name:role==='system'?'Fictional admin B':`Fictional ${role}`,actor_role:role,
  operation:'reassign',old_status:'open',new_status:'open',old_owner_id:nurseId,new_owner_id:doctorId,
  note:'Care team changed. Was: Fictional nurse.',care_note_id:null,
  detail:{input:{ownerId:doctorId},before:null,via:'clinic_admin',requestId:crypto.randomUUID(),approvedBy:doctorId,system:true},
  created_at:currentTask.updatedAt,
 }));
 // Exercise the same parser used by refreshCoordinationTask before rendering history.
 schema.taskSnapshotSchema.parse({...currentTask,events:currentEvents});
 await act(async()=>{tree=create(React.createElement(RealCoordinationTasks,{locale,page:{tasks:[currentTask],nextCursor:null},memberPage:{members:[],nextCursor:null},actor:{id:doctorId,role:'doctor'}}));});
 await act(async()=>tree.root.findAllByType('button').find(button=>button.props['aria-label']?.endsWith(currentTask.title))!.props.onClick());
 const history=tree.root.findAllByType('p').map(node=>node.children.join('')).join('\n');
 assert.ok(history.includes({en:'Care team change, approved by Fictional admin B',hy:'Խնամքի թիմի փոփոխություն, հաստատել է Fictional admin B',ru:'Изменение команды заботы, одобрено: Fictional admin B'}[locale]),`System approval attribution in ${locale}`);
 for(const [role,label] of Object.entries({doctor:{en:'Doctor',hy:'Բժիշկ',ru:'Врач'},nurse:{en:'Nurse',hy:'Բուժքույր',ru:'Медсестра'},admin:{en:'Administrator',hy:'Ադմինիստրատոր',ru:'Администратор'}})){
  assert.ok(history.includes(`Fictional ${role} · ${label[locale]} · Fictional date`),`Existing ${role} attribution in ${locale}`);
 }
 await act(async()=>tree.unmount());
}
console.log('Staff task history: system approval names the clinic admin in en/hy/ru; doctor, nurse and platform admin labels remain unchanged.');

// Real Tasks rows, accessible names, and expanded notes share display-only copy.
for(const locale of ['en','hy','ru'] as const){
 for(const [title,kind,sourceConversationId,want] of [
  ['From the doctor','contact-followup',currentTask.caseId,{en:'From the doctor',hy:'Բժշկից',ru:'От врача'}],
  ['Collect blood pressure log','evidence-collection',null,{en:'Collect blood pressure log',hy:'Collect blood pressure log',ru:'Collect blood pressure log'}],
  ['From the doctor','contact-followup',null,{en:'From the doctor',hy:'From the doctor',ru:'From the doctor'}],
  ['Call about the results','contact-followup',null,{en:'Call about the results',hy:'Call about the results',ru:'Call about the results'}],
 ] as const){
  currentTask={...currentTask,title,kind,sourceConversationId,origin:sourceConversationId?'doctor_handover':null,instructions:'Staff wrote From the doctor and mmHg here'};currentEvents=[];
  await act(async()=>{tree=create(React.createElement(RealCoordinationTasks,{locale,page:{tasks:[currentTask],nextCursor:null},memberPage:{members:[],nextCursor:null},actor:{id:doctorId,role:'doctor'}}));});
  const open=tree.root.findAllByType('button').find(button=>button.props['aria-label']===`${{en:'Open',hy:'Բացել',ru:'Открыть'}[locale]} ${want[locale]}`);
  assert.ok(open,`Localized Tasks accessible title in ${locale}`);
  await act(async()=>open.props.onClick());
  assert.ok(tree.root.findAllByType('p').some(node=>node.children.includes(currentTask.instructions)),'Tasks keeps staff instructions verbatim');
  await act(async()=>tree.unmount());
 }
}
