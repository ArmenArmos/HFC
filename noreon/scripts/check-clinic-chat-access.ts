import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';
import {chatQuerySchema} from '@/lib/clinic-chat/schema';
const clinic='clinic-a';
let enabled=false,scope='actor-a',auth=0,reads=0,writes=0,slots=0;
let schedulingResult:unknown={status:'stale'};
const load=(path:string,deps:Record<string,unknown>)=>{
 const exports:Record<string,unknown>={};
 const source=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new vm.Script(source).runInNewContext({exports,require:(name:string)=>{assert.ok(name in deps,`Unexpected dependency ${name}`);return deps[name];}});
 return exports;
};
const actions=load('lib/clinic-chat/actions.ts',{
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 '@/lib/clinic-portal/identity':{requireClinicPortal:async(requested:string)=>{auth++;if(requested!==clinic)throw Error('denied');return {identity:{clinicId:clinic},actorScope:scope,rpc:{}};}},
 '@/lib/clinic-scheduling/actions':{clinicScheduleCommand:async()=>{writes++;return schedulingResult;},clinicFreeSlots:async()=>{slots++;return []; }},
 './config':{clinicChatEnabled:()=>enabled},
 './runtime':{readClinicChat:async()=>{reads++;return {kind:'home'};}},
 './schema':{chatQuerySchema:{safeParse:(input:unknown)=>({success:true,data:input})},chatCommandSchema:{safeParse:(input:unknown)=>({success:['confirm','decline','propose','withdraw-proposal','check-in'].includes((input as {op:string}).op),data:input})}},
}) as {clinicChatRead:(c:string,s:string,q:unknown)=>Promise<{kind:string}>;clinicChatCommand:(c:string,s:string,q:unknown)=>Promise<{status:string;booking?:{memberPhone:unknown}}>;clinicChatSlots:(c:string,s:string,d:string)=>Promise<unknown>};
for(const on of [false,true]){
 enabled=on;
 if(on){scope='changed';}
 assert.equal((await actions.clinicChatRead(clinic,'actor-a',{kind:'home'})).kind,'access');
 assert.equal((await actions.clinicChatCommand(clinic,'actor-a',{op:'confirm'})).status,'access');
 assert.equal(await actions.clinicChatSlots(clinic,'actor-a','2026-11-02'),null);
}
assert.equal(reads+writes+slots,0);
assert.equal(auth,3,'Off refuses before identity; changed actor is checked on every entry');
enabled=true;scope='actor-a';
for(const call of [()=>actions.clinicChatRead('clinic-b',scope,{kind:'home'}),()=>actions.clinicChatCommand('clinic-b',scope,{op:'confirm'}),()=>actions.clinicChatSlots('clinic-b',scope,'2026-11-02')])await assert.rejects(call,/denied/);
assert.equal(reads+writes+slots,0,'Wrong clinic never reaches records or scheduling');
await actions.clinicChatRead(clinic,scope,{kind:'home'});
for(const op of ['confirm','decline','propose','withdraw-proposal','check-in'])assert.equal((await actions.clinicChatCommand(clinic,scope,{op})).status,'stale','Existing guard result is preserved');
assert.equal((await actions.clinicChatCommand(clinic,scope,{op:'check-in'})).status,'stale');
await actions.clinicChatSlots(clinic,scope,'2026-11-02');
assert.equal(reads,1);assert.equal(writes,6);assert.equal(slots,1);
schedulingResult={status:'saved',booking:{appointmentId:'synthetic',memberPhone:'+37499120123'}};
const saved=await actions.clinicChatCommand(clinic,scope,{op:'confirm'});
assert.equal(JSON.stringify(saved).includes('+37499120123'),false,'Saved command receipts cannot feed full contact values back to the assistant');
assert.equal(saved.booking?.memberPhone,null);
console.log('Clinic chat action entry points PASS: off before reads, wrong clinic denied, stale actor denied, existing guards and command allowlist. Mocked identity/IO, not SQL.');

const pageReads:unknown[]=[];let pageAuth=0;
const page=load('app/clinic/real/chat/page.tsx',{
 'react/jsx-runtime':jsxRuntime,
 'next/navigation':{notFound:()=>{throw Error('not-found');}},
 '@/lib/clinic-portal/locale':{clinicLocale:async(value:unknown)=>value==='ru'?'ru':'en'},
 '@/lib/locale':{parseLocale:(v:unknown)=>v==='ru'?'ru':'en'},
 '@/lib/clinic-portal/identity':{clinicAccess:async()=>({access:{status:'ready'}}),requireClinicPortal:async()=>{pageAuth++;return {identity:{clinicId:clinic},actorScope:scope};}},
 '@/lib/clinic-chat/config':{clinicChatEnabled:()=>enabled},
 '@/lib/clinic-portal/result-attach-schema':{resultAttachEnabled:()=>false},
 '@/lib/clinic-chat/schema':{chatQuerySchema},
 '@/lib/clinic-chat/actions':{clinicChatRead:async(c:string,s:string,q:unknown)=>{pageReads.push({clinic:c,scope:s,query:q});return {kind:'home'};},clinicChatCommand:async()=>({status:'stale'}),clinicChatSlots:async()=>[]},
 '@/components/clinic-portal/shell':{ClinicShell:()=>null},
 '@/components/clinic-portal/chat':{ClinicChat:()=>null},
}) as {default:(v:{searchParams:Promise<Record<string,string>>})=>Promise<{props:{children:{key:string}}}>};
enabled=false;
await assert.rejects(()=>page.default({searchParams:Promise.resolve({clinic})}),/not-found/);
assert.equal(pageAuth,0);assert.equal(pageReads.length,0,'Flag-off page reads nothing');
enabled=true;
const homePage=await page.default({searchParams:Promise.resolve({clinic})});
const memberPage=await page.default({searchParams:Promise.resolve({clinic,member:'c1c10000-0000-4000-8000-000000000099'})});
assert.notEqual(homePage.props.children.key,memberPage.props.children.key,'Route member/home changes remount local response state');
const russianPage=await page.default({searchParams:Promise.resolve({clinic,locale:'ru'})});
assert.notEqual(homePage.props.children.key,russianPage.props.children.key,'Language navigation remounts the current server response');
console.log('Clinic chat page PASS: flag off before identity and data, route/member/language response isolation. Mocked page dependencies.');
