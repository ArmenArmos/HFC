/** Real chat/card/task hooks. Only server IO and portal primitives are replaced. */
import * as displayText from '@/lib/staff/display-text';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import * as contracts from '@/lib/admin-chat/contracts';
import * as schema from '@/lib/staff/real-coordination/schema';
import * as statusCopy from '@/lib/staff/real-coordination/status-copy';
import * as taskCopy from '@/lib/staff/real-coordination/task-copy';
import * as locale from '@/lib/locale';
import * as staffLocale from '@/lib/staff/staff-locale-copy';
import * as staffServer from '@/lib/staff/staff-server-copy';
import {selectFieldNativeStub} from './select-field-native-stub';
import {realtimeStubs} from './realtime-test-stubs';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const require=createRequire(import.meta.url);
const member='a1000000-0000-4000-8000-000000000001',nurse='a1000000-0000-4000-8000-000000000002';
const owners=[{id:nurse,name:'Example nurse',role:'nurse' as const}];
let memberPage:schema.CoordinationMemberPage={members:[{id:member,name:'Example member',owners}],nextCursor:{id:member,createdAt:'2026-11-01T12:00:00Z'}};
let denied=false,fail=false,uncertain=true,refusals=0;
let routeRefreshes=0;
const commands:schema.CoordinationCommand[]=[];
const readCalls:string[]=[];
let stored:schema.CoordinationTask|null=null;
const result=<T,>(value:T)=>denied?{access:'denied' as const}:{access:'allowed' as const,result:value};
const server={
 readAdminActionCard:async(kind:string)=>{readCalls.push(kind);if(fail)throw Error('Offline failure');return result(kind==='tasks'?{kind,actor:{id:'admin',role:'admin'},page:{tasks:stored?[stored]:[],nextCursor:null},memberPage}:{kind,page:{rows:[],hasMore:false,nextCursor:null},doctors:[],nurses:[]});},
 adminCoordinationCommand:async(command:schema.CoordinationCommand)=>{
  commands.push(command);if(uncertain)return result({ok:false,uncertain:true,error:'This task or your assignment changed, or the result could not be confirmed. Load current tasks before trying again.'});
  assert.equal(command.operation,'create');if(command.operation!=='create')throw Error('Unexpected operation');
  stored={...command.input,id:command.taskId,caseId:member,memberName:'Example member',creatorId:member,ownerName:'Example nurse',status:'open',revision:1,createdAt:'2026-11-01T12:00:00Z',updatedAt:'2026-11-01T12:00:00Z',needsReassignment:false,eligibleOwners:owners};
  return result({ok:true,id:command.taskId,revision:1,status:'open'});
 },
 refreshAdminCoordinationTask:async()=>result({ok:true,task:{...stored,events:[]}}),
 readAdminCoordinationPage:async()=>result({ok:true,page:{tasks:stored?[stored]:[],nextCursor:null}}),
 searchAdminCoordinationMembers:async()=>result({ok:true,page:memberPage}),
 searchAdminCareMembers:async()=>result({ok:true,page:{rows:[],hasMore:false,nextCursor:null}}),
};
const shared:Record<string,unknown>={'@/lib/staff/display-text':displayText,'@/lib/staff/real-coordination/status-copy':statusCopy,'@/lib/staff/real-coordination/task-copy':taskCopy,react:React,'react/jsx-runtime':jsx,'next/navigation':{useRouter:()=>({refresh(){routeRefreshes++;}})},'next/link':{default:(p:Record<string,unknown>)=>React.createElement('a',p)},'lucide-react':require('lucide-react'),'@/components/ui/select-field':selectFieldNativeStub,'@/lib/staff/staff-locale-copy':staffLocale,'@/lib/staff/staff-server-copy':staffServer,'@/lib/locale':locale,'@/components/patient-care/common':{stamp:()=> 'Fixture time'},'./shell':{buttonClass:'button',fieldClass:'field'},'@/lib/staff/real-coordination/schema':schema,'@/lib/staff/real-coordination/actions':new Proxy({},{get:()=>()=>{throw Error('Chat reached unguarded page action');}})};
function load(path:string,deps:Record<string,unknown>){const out:Record<string,unknown>={};new vm.Script(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports:out,crypto,FormData:class{constructor(form:{values:Map<string,string>}){return form.values;}},require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});return out;}
// Exercise the real context hook, including its route-refresh fallback on admin pages.
shared['@/components/staff/record-refresh']=load('components/staff/record-refresh.tsx',shared);
const tasks=load('components/staff/real-coordination-tasks.tsx',shared);
const cards=load('components/staff/admin-action-cards.tsx',{...shared,'@/lib/admin-chat/card-actions':server,'./admin-booking-card':{AdminBookingCard:()=>null},'@/components/staff/real-coordination-tasks':tasks,'@/components/real-review/care-team-dialog':{CareTeamDialog:()=>null}});
const AdminActionCards=cards.AdminActionCards as typeof import('../components/staff/admin-action-cards').AdminActionCards;
const chat=load('components/staff/admin-chat.tsx',{...shared,...await realtimeStubs(),'./admin-action-cards':cards,'@/lib/admin-chat/contracts':contracts});
const AdminChat=chat.AdminChat as typeof import('../components/staff/admin-chat').AdminChat;
const ready:contracts.AdminChatResult={kind:'ready',view:{intent:'operations',asOf:'2026-11-01T12:00:00Z',summary:null,items:[],unavailable:[],partial:[],disabled:[],notices:[]}};
for(const l of ['en','hy','ru'] as const){
 const html=renderToStaticMarkup(React.createElement(AdminActionCards,{locale:l,onUnavailable(){}}));
 assert.ok(html.includes(l==='en'?'Manage coordination tasks':l==='hy'?'Կառավարել համակարգման առաջադրանքները':'Управлять задачами координации'));
 if(l==='ru')assert.ok(!/[Ա-և]/.test(html));
}
let tree!:ReactTestRenderer;
await act(async()=>{tree=create(React.createElement(AdminChat,{initial:ready,locale:'en',readAction:async()=>ready}));});
const button=(name:string)=>tree.root.findAllByType('button').find(node=>node.children.join('')===name)!;
await act(async()=>{button('Manage coordination tasks').props.onClick();button('Manage coordination tasks').props.onClick();});
assert.deepEqual(readCalls,['tasks'],'Same-event card opening reads once');
await act(async()=>tree.root.findAllByType('select').find(node=>node.props.value==='')!.props.onChange({target:{value:member}}));
const ownerSelect=()=>tree.root.findAllByType('select').find(node=>node.props.name==='ownerId')!;
await act(async()=>ownerSelect().props.onChange({target:{value:nurse}}));
const searchField=()=>tree.root.findAllByType('input').find(node=>node.props.maxLength===100)!;
await act(async()=>{
 searchField().props.onChange({target:{value:'Draft search'}});
 tree.root.findAllByType('select').find(node=>node.props.value==='contact-followup')!.props.onChange({target:{value:'evidence-collection'}});
});
await act(async()=>button('Assign or change a care team').props.onClick());
memberPage={...memberPage,members:[{id:member,name:'Example member',owners:[{...owners[0],name:'Renamed nurse'}]}]};
await act(async()=>button('Manage coordination tasks').props.onClick());
assert.equal(ownerSelect().props.value,nurse,'A still-eligible owner selection survives refresh');
assert.ok(ownerSelect().findAllByType('option').some(node=>node.children.join('').includes('Renamed nurse')),'Owner details are refreshed even when the owner id is unchanged');
const form={values:new Map([['title','Example task'],['instructions','Arrange a callback'],['ownerId',nurse],['dueAt','2026-11-02T15:30']]),reset(){}};
const submit=()=>tree.root.findAllByType('form')[0].props.onSubmit({preventDefault(){},currentTarget:form});
await act(async()=>{submit();submit();});
assert.equal(commands.length,1,'Create double press reaches guarded action only once');
assert.ok(button('Confirm previous task request'));
await act(async()=>button('Assign or change a care team').props.onClick());
assert.ok(JSON.stringify(tree.toJSON()).includes('No matching members found.'));
const replacement='a1000000-0000-4000-8000-000000000003';
memberPage={members:[{id:member,name:'Refreshed member',owners:[{id:replacement,name:'Replacement nurse',role:'nurse'}]}],nextCursor:null};
const titleField=tree.root.findByProps({name:'title'});
const instructionsField=tree.root.findByProps({name:'instructions'});
const dueField=tree.root.findByProps({name:'dueAt'});
await act(async()=>button('Manage coordination tasks').props.onClick());
assert.ok(ownerSelect().findAllByType('option').some(node=>node.props.value===replacement),'Reopening tasks offers the refreshed eligible owner');
assert.ok(!ownerSelect().findAllByType('option').some(node=>node.props.value===nurse),'The former owner is no longer offered');
assert.equal(ownerSelect().props.value,'','An ineligible owner selection is cleared');
assert.ok(tree.root.findAllByType('option').some(node=>node.children.join('')==='Refreshed member'),'Fresh member details reach the create form');
assert.equal(tree.root.findByProps({name:'title'}),titleField,'Refreshing owners does not remount draft fields');
assert.equal(tree.root.findByProps({name:'instructions'}),instructionsField);
assert.equal(tree.root.findByProps({name:'dueAt'}),dueField);
assert.equal(searchField().props.value,'Draft search','Refreshing owners preserves the draft search');
assert.ok(tree.root.findAllByType('select').some(node=>node.props.value==='evidence-collection'),'The draft task kind is preserved');
assert.ok(!button('Load more members'),'The refreshed member cursor replaces the earlier cursor');
assert.ok(tree.root.findAllByType('select').some(node=>node.props.value===member),'The selected member is preserved');
assert.ok(button('Confirm previous task request'),'Switching cards preserves uncertain create identity');
assert.equal(routeRefreshes,0,'Reads and uncertain writes do not refresh the route');
uncertain=false;
await act(async()=>submit());
assert.equal(commands.length,2);
assert.equal(commands[1].requestId,commands[0].requestId,'Confirmation uses the original request id');
assert.equal(commands[1].taskId,commands[0].taskId,'Confirmation does not create a new task identity');
assert.equal(commands[1],commands[0],'Owner refresh preserves the complete uncertain command, including its original owner');
assert.ok(JSON.stringify(tree.toJSON()).includes('Example task'));
assert.equal(routeRefreshes,1,'A saved admin task refreshes the route without a card provider');
// A read outage is not permission to create an empty queue or discard uncertain work.
fail=true;
await act(async()=>button('Assign or change a care team').props.onClick());
assert.ok(JSON.stringify(tree.toJSON()).includes('This card could not load.'));
fail=false;denied=true;
await act(async()=>button('Manage coordination tasks').props.onClick());
assert.ok(JSON.stringify(tree.toJSON()).includes('unavailable for your account'));
assert.ok(!JSON.stringify(tree.toJSON()).includes('Example task'),'Definitive refusal clears both earlier card data and the operations view');
assert.equal(tree.root.findAllByType(AdminActionCards).length,0);
await act(async()=>tree.unmount());
// Every terminal role-refusal envelope is also handled by a standalone card host.
await act(async()=>{tree=create(React.createElement(AdminActionCards,{locale:'en',onUnavailable:()=>refusals++}));});
await act(async()=>button('Manage coordination tasks').props.onClick());
assert.equal(refusals,1);
await act(async()=>tree.unmount());
console.log('Admin card UI: locales, same-event opening/create, refreshed members/owners, cleared ineligible selection, preserved drafts and uncertain requests, empty/outage and denied data clearing passed (mocked IO).');
