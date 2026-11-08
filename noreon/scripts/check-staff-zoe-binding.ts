import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {askRequestSchema,beginResultSchema,type AskRequest,type BeginResult} from '@/lib/staff-zoe/contracts';
import {redactEvent} from '@/lib/observability/redact';

// Load the real entry points with every import mocked. No auth, DB, provider, env, or network IO.
function load(file:string,modules:Record<string,unknown>){
 const source=readFileSync(file,'utf8');const exports:Record<string,unknown>={};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Request,Response,ReadableStream,TextEncoder,URL,Date,process:{env:{}},require:(name:string)=>{assert.ok(name in modules,`Unmocked import ${name}`);return modules[name];}});
 return exports;
}
const id=(n:number)=>`f0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const staff=id(1),memberA=id(2),memberB=id(3),conversation=id(4),submission=id(5),run=id(6);
const req:AskRequest={conversationId:conversation,submissionId:submission,text:'Private question: Fictional Name 182/121',intent:'summary',locale:'en'};
let begun:BeginResult={ok:true,memberId:memberA,runId:run,role:'doctor',memberName:'Private Name',tier:'high',lastTools:[],history:[]};
let role='doctor',failBegin=false,failAfter=false,beginCalls=0,turnCalls=0;
const logs:{msg:string;fields:Record<string,unknown>}[]=[];
const modules:Record<string,unknown>={
 'next/navigation':{notFound:()=>{throw Error('404');}},
 '@/lib/observability/with-logging':{withRouteLogging:(fn:unknown)=>fn},
 '@/lib/observability/logger':{log:{info:(msg:string,fields:Record<string,unknown>)=>logs.push({msg,fields})}},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>({client:{},identity:{id:staff,role}})},
 '@/lib/staff/staff-locale':{staffLocale:async()=>'en'},
 '@/lib/staff-zoe/contracts':{askRequestSchema},
 '@/lib/staff-zoe/server':{staffTurnPorts:()=>({begin:async()=>{beginCalls++;if(failBegin)throw Error('Private failure');return begun;}})},
 '@/lib/staff-zoe/turn':{runStaffTurn:async function*(input:AskRequest,_locale:unknown,ports:{begin:(r:AskRequest)=>Promise<BeginResult>}){
  turnCalls++;const result=await ports.begin(input);if(failAfter)throw Error('Private provider failure');
  yield {type:'refused',code:result.ok?'unavailable':result.code};
 }},
};
const post=load('app/staff/real/(review)/zoe/ask/route.ts',modules).POST as (r:Request,c?:{params:Promise<{memberId:string}>})=>Promise<Response>;
const request=(body:unknown=req,origin='https://local.test')=>new Request('https://local.test/staff/real/zoe/ask',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const ask=async(body:unknown=req)=>{const response=await post(request(body),role==='doctor'?{params:Promise.resolve({memberId:begun.ok?begun.memberId:memberA})}:undefined);await response.text();return response;};
// A forged conversation cannot make the general doctor route answer about a member.
const beforeGeneral=turnCalls;
assert.equal((await post(request())).status,403);
assert.equal(turnCalls,beforeGeneral,'General doctor request never begins a member turn');
assert.equal(logs.length,0);
const expected=(member:string,staffRole:string)=>({actor_kind:'staff',actor_id:staff,staff_role:staffRole,conversation_id:conversation,member_id:member,run_id:run,submission_id:submission});
for(const staffRole of ['doctor','nurse'] as const){
 role=staffRole;begun={...begun,ok:true,memberId:memberA,role:staffRole} as BeginResult;
 const before:number=logs.length;assert.equal((await ask()).status,200);assert.equal(logs.length,before+1,'Exactly one accepted-turn log');
 assert.equal(logs.at(-1)!.msg,'staff_zoe.ask.accepted');assert.deepEqual(JSON.parse(JSON.stringify(logs.at(-1)!.fields)),expected(memberA,staffRole));
}
// Patient route context is checked again against the authoritative begin result before the accepted log.
const patientPost=post as (r:Request,c:{params:Promise<{memberId:string}>})=>Promise<Response>;
const beforeMismatch=logs.length;
const mismatch=await patientPost(request(),{params:Promise.resolve({memberId:memberB})});
assert.match(await mismatch.text(),/access/);assert.equal(logs.length,beforeMismatch,'Mismatched patient begin produces no accepted-turn log');
// A later selection's browser member hint cannot redirect or contaminate the audit binding.
const count=logs.length;assert.equal((await ask({...req,memberId:memberB})).status,400);assert.equal(logs.length,count);
role='doctor';begun={...begun,ok:true,memberId:memberB,role:'nurse'} as BeginResult;await ask();assert.equal(logs.at(-1)!.fields.member_id,memberB,'Member identity is from DB begin result');
assert.equal(logs.at(-1)!.fields.staff_role,'nurse','Role is from the accepted DB result');
assert.equal(logs[0]!.fields.member_id,memberA,'Later turns cannot alter the first accepted binding');
failAfter=true;const accepted=logs.length;await ask();assert.equal(logs.length,accepted+1,'Provider failure after acceptance retains exactly one log');failAfter=false;
for(const code of ['off','busy','replayed','invalid']){begun={ok:false,code};const before:number=logs.length;await ask();assert.equal(logs.length,before,`${code} is not a newly accepted turn`);}
failBegin=true;const beforeFailure=logs.length;await ask();assert.equal(logs.length,beforeFailure);failBegin=false;
assert.equal((await post(request(req,'https://other.test'))).status,403);
const beforeInvalid=turnCalls;assert.equal((await ask({...req,conversationId:'bad'})).status,400);assert.equal(turnCalls,beforeInvalid);
role='admin';await assert.rejects(()=>post(request()),/404/);assert.equal(beginCalls,turnCalls);
for(const event of logs){const line=redactEvent('info',event.msg,event.fields);for(const [key,value] of Object.entries(event.fields))assert.equal(line[key],value,`${key} survives structured redaction`);assert.doesNotMatch(JSON.stringify(line),/Private|182\/121|question/);}

// The real server port forwards no member hint and returns only the parsed DB binding.
class AccessLost extends Error{}
const serverSource=readFileSync('lib/staff-zoe/server.ts','utf8');
const serverModules=Object.fromEntries(ts.preProcessFile(serverSource).importedFiles.map(x=>[x.fileName,{}]));
Object.assign(serverModules,{'server-only':{},'./contracts':{beginResultSchema},'./turn':{AccessLost},'@/lib/zoe/server':{zoeServiceRpc:()=>null}});
const server=load('lib/staff-zoe/server.ts',serverModules);
let rpcError:{code:string}|null=null;
let rpcData:unknown={ok:true,memberId:memberA,runId:run,role:'doctor',memberName:'Private Name',tier:'high',lastTools:[],history:[]};
const calls:unknown[]=[];
const ports=(server.staffTurnPorts as (c:unknown,l:string,e:unknown)=>{begin:(r:AskRequest)=>Promise<BeginResult>})({rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:rpcData,error:rpcError};}},'en',{});
assert.deepEqual(JSON.parse(JSON.stringify(await ports.begin({...req,memberId:memberB} as AskRequest))),rpcData);
assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{name:'staff_zoe_begin',args:{p_conversation:conversation,p_submission:submission,p_text:req.text}}]);
rpcError={code:'42501'};await assert.rejects(()=>ports.begin(req),AccessLost);
rpcError={code:'XX000'};await assert.rejects(()=>ports.begin(req),/Zoe is unavailable/);
rpcError=null;rpcData={ok:true,memberId:'not-an-id'};await assert.rejects(()=>ports.begin(req));
console.log('Staff Zoe binding: mocked ask route acceptance/refusal, ID-only logging, real server begin forwarding and error paths passed. No DB or network IO.');

// Classic doctor Zoe binds a member without requiring the optional v2 screen flag.
const {z}=await import('zod');
const {conversationReadSchema}=await import('@/lib/staff-zoe/contracts');
let classicReads=0,classicAsks=0,classicMember=memberA,classicRole='doctor';
const classicModules={
 zod:{z},'@/lib/observability/with-logging':{withRouteLogging:(fn:unknown)=>fn},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>({identity:{role:classicRole},client:{rpc:async()=>{classicReads++;return {error:null,data:{enabled:true,id:conversation,member:{id:classicMember,name:'Synthetic',birthYear:null,sex:null},messages:[],intents:[]}};}}})},
 '@/lib/staff-zoe/contracts':{askRequestSchema,conversationReadSchema},
 '@/app/staff/real/(review)/zoe/ask/route':{POST:async()=>{classicAsks++;return new Response(null,{status:200});}},
};
const classic=load('app/staff/real/(review)/zoe/member/[memberId]/ask/route.ts',classicModules).POST as (r:Request,c:{params:Promise<{memberId:string}>})=>Promise<Response>;
const classicContext={params:Promise.resolve({memberId:memberA})};
assert.equal((await classic(request(),classicContext)).status,200);assert.equal(classicAsks,1);
classicMember=memberB;assert.equal((await classic(request(),classicContext)).status,403);assert.equal(classicAsks,1);
classicRole='nurse';const readsBefore=classicReads;assert.equal((await classic(request(),classicContext)).status,403);assert.equal(classicReads,readsBefore);
console.log('Classic doctor Zoe: bound conversation route works without v2 flags and refuses a different member or role (synthetic request).');
