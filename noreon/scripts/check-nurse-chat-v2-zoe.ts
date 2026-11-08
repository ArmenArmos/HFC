import * as chatIdentityRead from '@/lib/staff/chat-member-identity-read';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import * as contracts from '@/lib/staff-zoe/contracts';

// Real action gates, resolver and history reader with isolated auth and assigned-search IO.
const nurseId='aa110000-0000-4000-8000-000000000010',memberId='aa110000-0000-4000-8000-000000000001';
let flag:string|undefined='true',enabled=true,role='nurse',actorId=nurseId,authFails=false;
const events:string[]=[],queries:string[]=[];
let roster=[{id:memberId,name:'Ani Example'}];
const modules:Record<string,unknown>={
 '@/lib/staff/chat-member-identity-read':chatIdentityRead,
 './name-skeleton':await import('@/lib/staff-zoe/name-skeleton'),
 'server-only':{},zod:{z},'./contracts':contracts,
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 './config':{nurseChatEnabled:()=>enabled},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>{events.push('auth');if(authFails)throw Error('Signed out');return {identity:{role,id:actorId},client:{rpc:async(name:string,args?:{p_members:string[]})=>{if(name==='staff_chat_member_identities')return {data:args!.p_members.map(id=>({id,name:roster.find(row=>row.id===id)?.name??'Member',birthDate:null,sex:null,clinic:null})),error:null};events.push('history');return {data:{enabled:true,rows:[]},error:null};}}};}},
 '@/lib/staff-zoe/actions':{openStaffZoe:async(id:string)=>{events.push('open:'+id);return {ok:true,conversationId:memberId};}},
 '@/lib/staff/member-search-command':{runMemberIdentitySearch:async({query}:{query:string})=>{events.push('search');queries.push(query);return {ok:true,page:{rows:roster.filter(row=>row.name.toLowerCase().includes(query)),hasMore:false,nextCursor:null}};}},
};
function load(file:string){
 const exports:Record<string,unknown>={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Map,Set,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];},process:{env:{get NOREON_NURSE_CHAT_V2(){return flag;}}}});
 return exports;
}
modules['@/lib/staff-zoe/chat-v2-zoe-read']=load('lib/staff-zoe/chat-v2-zoe-read.ts');
const actions=load('lib/nurse-chat/v2-zoe-actions.ts') as typeof import('@/lib/nurse-chat/v2-zoe-actions');
const calls=[()=>actions.openNurseChatZoe(memberId,nurseId),()=>actions.readNurseChatZoeHistory(nurseId),()=>actions.findNurseChatQuestionMember('What is Ani Example bp?',nurseId)];
async function refused(){for(const call of calls){events.length=0;assert.equal((await call() as {kind:string}).kind,'refused');assert.ok(events.every(event=>event==='auth'),'Refused gates never reach a data read or model');}}
for(flag of [undefined,'false','TRUE','1','true '])await refused();
flag='true';enabled=false;await refused();enabled=true;
for(role of ['doctor','admin','clinic'])await refused();role='nurse';
actorId='other';await refused();actorId=nurseId;
authFails=true;await refused();authFails=false;
for(const value of [null,{},'', ' ', 'bad']){events.length=0;assert.equal((await actions.openNurseChatZoe(value,nurseId) as {kind:string}).kind,'refused');assert.ok(!events.some(event=>event.startsWith('open:')));}
for(const value of [null,{},'', ' ', 'x'.repeat(1001),'What\nAni Example']){events.length=0;assert.equal((await actions.findNurseChatQuestionMember(value,nurseId)).kind,'refused');assert.ok(!events.includes('search'));}
for(const current of [null as never,{memberId:'bad',memberName:'Ani Example'},{memberId,memberName:''},{memberId,memberName:'Ani Example',extra:true}]){events.length=0;assert.equal((await actions.findNurseChatQuestionMember('What changed?',nurseId,current)).kind,'refused');assert.ok(!events.includes('search'));}
assert.equal((await actions.openNurseChatZoe(memberId,nurseId) as {ok:boolean}).ok,true);
assert.equal((await actions.readNurseChatZoeHistory(nurseId)).kind,'history');
assert.equal((await actions.findNurseChatQuestionMember('What is Ani Example bp?',nurseId)).kind,'member');
assert.equal((await actions.findNurseChatQuestionMember('What is Ani bp?',nurseId)).kind,'choose','A partial name never auto-selects');
assert.equal((await actions.findNurseChatQuestionMember('What is Unassigned Example bp?',nurseId)).kind,'choose','Only assigned search results may be offered');
const result=await actions.findNurseChatQuestionMember('What is Unassigned Example bp?',nurseId);
if(result.kind==='choose')assert.ok(result.rows.every(row=>row.id===memberId));
assert.equal((await actions.findNurseChatQuestionMember('What changed?',nurseId,{memberId,memberName:'Ani Example'})).kind,'keep');
// A real sentence about the open member is long; only a question with no open member is limited to a few name words.
assert.equal((await actions.findNurseChatQuestionMember('she says headache and dizzy since this morning, what do I ask her first and when do I hand over',nurseId,{memberId,memberName:'Ani Example'})).kind,'keep','A long question about the open member is not refused');
events.length=0;assert.equal((await actions.findNurseChatQuestionMember('she says headache and dizzy since this morning, what do I ask her first and when do I hand over',nurseId)).kind,'invalid','Without an open member a long phrase is no name: the chat asks which member');assert.ok(!events.includes('search'),'and searches nothing');
roster=[{id:memberId,name:'Gor'},{id:'aa110000-0000-4000-8000-000000000002',name:'Hayk'}];
for(const question of ['покажи хайком давление','покажи Hayk-ի ճնշումը']){
 const found=await actions.findNurseChatQuestionMember(question,nurseId,{memberId,memberName:'Gor'});
 assert.equal(found.kind,'choose',question);
 if(found.kind==='choose')assert.ok(found.rows.some(row=>row.id!==memberId),question);
}
roster=[];
assert.equal((await actions.findNurseChatQuestionMember('What changed?',nurseId,{memberId,memberName:'Ani Example'})).kind,'refused','A stale or forged current member cannot bypass assigned search');
assert.equal((await actions.findNurseChatQuestionMember('What is Unassigned Example bp?',nurseId)).kind,'none');
assert.ok(queries.includes(''),'Automatic selection checks the complete assigned roster');
console.log('Nurse Zoe: exact flags, role/session id, invalid input refusal, existing open/history delegation, assigned-only resolution and stale target refusal passed (mocked IO).');

// A stream event is complete and valid, or it is an error.
modules['@/lib/staff-zoe/contracts']=contracts;
const {checkedZoeEvent}=load('lib/nurse-chat/zoe-events.ts') as typeof import('@/lib/nurse-chat/zoe-events');
const content={version:'staff-zoe-1',state:'answered',say:[{text:'Synthetic',facts:[]}],quotes:[],notKnown:[],declined:false,notice:null,cards:[]};
assert.equal(checkedZoeEvent({type:'answer',content}).type,'answer');
assert.equal(checkedZoeEvent({type:'cards',cards:[]}).type,'cards');
for(const code of ['access','off','busy','replayed','invalid','unavailable'])assert.equal(JSON.stringify(checkedZoeEvent({type:'refused',code})),JSON.stringify({type:'refused',code}));
for(const bad of [null,undefined,'x',{},{type:'answer'},{type:'answer',content:{}},{type:'answer',content:{...content,state:'nope'}},{type:'cards'},{type:'cards',cards:[{tool:'nope'}]},{type:'cards',cards:'x'},{type:'refused'},{type:'refused',code:'nope'},{type:'other'}])
 assert.throws(()=>checkedZoeEvent(bad),/Zoe event invalid/,JSON.stringify(bad));
console.log('Nurse Zoe stream events: valid answers, cards and refusals pass; every incomplete or invalid event is an error.');
