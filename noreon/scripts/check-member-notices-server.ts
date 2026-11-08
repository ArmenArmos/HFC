import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import * as contracts from '@/lib/zoe/app-chat-contracts';
import * as scheduling from '@/lib/clinic-scheduling/schema';
import * as appointments from '@/lib/real-booking/appointment-schema';

// Actual server entry points with isolated session/RPC/after IO. No external sends.
function load(file:string,modules:Record<string,unknown>){
 // Dynamically loaded exports have their production signatures checked by tsc.
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const exports:Record<string,any>={};
 const compiled=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(compiled,{exports,process,Response,URL,require:(name:string)=>name==='zod'?{z}:modules[name]??{}},{filename:file});
 return exports;
}
const id='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const notices=load('lib/zoe/member-notices.ts',{'./app-chat-contracts':contracts});
for(const value of [undefined,'false','TRUE','1'])assert.equal(notices.memberNoticesInChatEnabled({NOREON_MEMBER_NOTICES_IN_CHAT:value}),false);
assert.equal(notices.memberNoticesInChatEnabled({NOREON_MEMBER_NOTICES_IN_CHAT:'true'}),true);
let rpcCalls=0,lastArgs:unknown;
let rpcResult:{data:unknown;error:unknown}={data:{notices:[{id,text:'Fictional notice',at:'2030-01-01T00:00:00Z',closed:false}],firstUnseen:id},error:null};
const rpc={rpc:async(_name:string,args:unknown)=>{rpcCalls++;lastArgs=args;return rpcResult;}};
assert.equal((await notices.readMemberNotices(rpc)).firstUnseen,id);
for(const data of [{notices:[],firstUnseen:null,extra:true},{notices:[{id,text:'x',at:'bad',closed:false}],firstUnseen:id},null]){
 rpcResult={data,error:null};assert.equal(await notices.readMemberNotices(rpc),null);
}
rpcResult={data:null,error:{code:'PGRST202'}};assert.equal(await notices.readMemberNotices(rpc),null);
assert.equal(await notices.readMemberNotices({rpc:async()=>{throw Error('Fixture unavailable');}}),null);
rpcResult={data:{ok:true},error:null};assert.equal(await notices.markMemberNoticeSeen(rpc,id),'seen');assert.deepEqual(JSON.parse(JSON.stringify(lastArgs)),{p_id:id});
const before=rpcCalls;assert.equal(await notices.markMemberNoticeSeen(rpc,'bad'),'unavailable');assert.equal(rpcCalls,before);
rpcResult={data:{ok:false},error:null};assert.equal(await notices.markMemberNoticeSeen(rpc,id),'unavailable');
rpcResult={data:{ok:true,extra:true},error:null};assert.equal(await notices.markMemberNoticeSeen(rpc,id),'failed');

const thread={ok:true,version:0,ack:null,zoeReplies:false,settledSeq:0,messages:[],replies:[],answers:[]};
let noticeReads=0,noticeProjection:unknown={notices:[],firstUnseen:null};
const chat=load('lib/zoe/app-chat.ts',{
 './app-chat-contracts':contracts,
 './member-notices':{...notices,readMemberNotices:async()=>{noticeReads++;return noticeProjection;}},
 '@/lib/supabase/server':{createClient:async()=>({rpc:async()=>({data:thread,error:null})})},
});
const originalFlag=process.env.NOREON_MEMBER_NOTICES_IN_CHAT;
try{
 delete process.env.NOREON_MEMBER_NOTICES_IN_CHAT;
 assert.equal((await chat.readZoeThreadState()).notices,undefined);assert.equal(noticeReads,0);
 process.env.NOREON_MEMBER_NOTICES_IN_CHAT='true';
 assert.equal((await chat.readZoeThreadState()).firstUnseenNotice,null);
 noticeProjection=null;assert.equal((await chat.readZoeThreadState()).notices,undefined);

 let signedIn=true,authThrows=false;
 const route=load('app/api/patient/zoe/notices/seen/route.ts',{
  '@/lib/observability/with-logging':{withRouteLogging:(handler:unknown)=>handler},
  '@/lib/patient/auth':{patientIdentity:async()=>{if(authThrows)throw Error('Fixture auth unavailable');return signedIn?{userId:id}:null;}},
  '@/lib/patient/demo':{demoEnabled:()=>false},
  '@/lib/supabase/server':{createClient:async()=>rpc},
  '@/lib/zoe/member-notices':notices,
 });
 const request=(body:unknown={id},origin='https://app.example.invalid')=>new Request('https://app.example.invalid/api/patient/zoe/notices/seen',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
 process.env.NOREON_MEMBER_NOTICES_IN_CHAT='false';assert.equal((await route.POST(request())).status,404);
 process.env.NOREON_MEMBER_NOTICES_IN_CHAT='true';
 assert.equal((await route.POST(request({id},'https://other.example.invalid'))).status,403);
 signedIn=false;assert.equal((await route.POST(request())).status,401);signedIn=true;
 assert.equal((await route.POST(request({id:'bad'}))).status,400);
 assert.equal((await route.POST(request({id,memberId:other}))).status,400);
 rpcResult={data:{ok:true},error:null};const seen=await route.POST(request());assert.equal(seen.status,200);assert.equal(seen.headers.get('cache-control'),'no-store');
 rpcResult={data:{ok:false},error:null};assert.equal((await route.POST(request())).status,404);
 rpcResult={data:null,error:{code:'PGRST202'}};assert.equal((await route.POST(request())).status,503);
 authThrows=true;assert.equal((await route.POST(request())).status,503);
}finally{if(originalFlag===undefined)delete process.env.NOREON_MEMBER_NOTICES_IN_CHAT;else process.env.NOREON_MEMBER_NOTICES_IN_CHAT=originalFlag;}

const callbacks:number[]=[];
const delivery={'@/lib/telegram-runtime/dispatch-trigger':{dispatchNow:()=>{callbacks.push(1);}}};
const clinic=load('lib/clinic-scheduling/runtime.ts',{'./schema':scheduling,...delivery});
const booking={appointmentId:id,revision:0,reference:id,kind:'current',status:'confirmed',channel:'portal',memberName:'Fictional',memberPhone:null,startsAt:'2030-01-01T01:00:00Z',endsAt:'2030-01-01T02:00:00Z',previousStartsAt:null,previousEndsAt:null,tests:[],proposal:null,decline:null};
for(const op of ['confirm','propose','decline','withdraw-proposal','check-in']){
 const command={version:'clinic-schedule-command-v1',submissionId:id,appointmentId:id,revision:0,op,...(op==='propose'?{slotKey:'a'.repeat(64),note:null}:op==='decline'?{reason:'Fictional reason'}:op==='withdraw-proposal'?{proposalId:id}:op==='check-in'?{outcome:'arrived'}:{})};
 const before=callbacks.length;
 const result=await clinic.runScheduleCommand({rpc:async(name:string)=>{assert.equal(name,'clinic_schedule_command');return{data:{status:'saved',booking},error:null};}},id,command);
 assert.equal(result.status,'saved');assert.equal(callbacks.length-before,['confirm','propose'].includes(op)?1:0);
}
for(const data of [{status:'stale'},{status:'saved',booking:{...booking,appointmentId:other}}]){
 const before=callbacks.length;
 await clinic.runScheduleCommand({rpc:async()=>({data,error:null})},id,{version:'clinic-schedule-command-v1',submissionId:id,appointmentId:id,revision:0,op:'confirm'});
 assert.equal(callbacks.length,before,'Refused or mismatched results cannot dispatch');
}
const runtime=load('lib/real-booking/appointment-runtime.ts',{'./appointment-schema':appointments,'@/lib/patient-care/clinical-case-repository':{snapshotSchema:z.object({evidence:z.unknown()})},...delivery});
const arrangement={offerId:id,offerVersion:'fixture',clinicId:id,mode:'clinic',startsAt:booking.startsAt,endsAt:booking.endsAt,timezone:'Asia/Yerevan',location:'Fictional address',preparation:'Fictional preparation',preparationVersion:'v1',coveredTestIds:[],followUps:[]};
const appointment={version:'email-pilot-v1',id,memberId:id,revision:1,status:'confirmed',program:[],current:arrangement,proposed:arrangement,noticeId:id,createdAt:booking.startsAt};
for(const accept of [true,false]){
 const before=callbacks.length;
 const result=await runtime.answerClinicProposal({portal:true,actorId:id,memberId:id,write:{rpc:async(name:string)=>{assert.equal(name,'booking_portal_proposal_answer');return{data:appointment,error:null};}},invalidate:()=>{}},{commandId:id,proposalId:id,accept});
 assert.equal(result.ok,true);assert.equal(callbacks.length-before,accept?1:0);
}
for(const data of [{...appointment,memberId:other},null]){
 const before=callbacks.length;
 const result=await runtime.answerClinicProposal({portal:true,actorId:id,memberId:id,write:{rpc:async()=>({data,error:null})},invalidate:()=>{}},{commandId:id,proposalId:id,accept:true});
 assert.equal(result.ok,false);assert.equal(callbacks.length,before);
}
const trigger=await import('@/lib/telegram-runtime/dispatch-trigger');
const asked:Array<[string,string]>=[];
const fetcher=(async(url:string,init:{headers:{authorization:string}})=>{asked.push([url,init.headers.authorization]);return new Response('{}');}) as unknown as typeof fetch;
assert.equal(await trigger.requestTelegramDispatch({NOREON_APP_ORIGIN:'https://app.example.invalid',CRON_SECRET:'fixture'},fetcher),true);
assert.deepEqual(asked,[['https://app.example.invalid/api/internal/telegram/dispatch','Bearer fixture']]);
assert.equal(await trigger.requestTelegramDispatch({CRON_SECRET:'fixture'},fetcher),false,'No origin: the cron sends it');
assert.equal(await trigger.requestTelegramDispatch({NOREON_APP_ORIGIN:'https://app.example.invalid'},fetcher),false,'No secret: the cron sends it');
assert.equal(await trigger.requestTelegramDispatch({NOREON_APP_ORIGIN:'https://app.example.invalid',CRON_SECRET:'fixture'},(async()=>{throw Error('down');}) as unknown as typeof fetch),false,'A failure never reaches the action');
console.log('Member notices server: strict optional reads, flag, session route and delivery dispatch PASS (mocked IO, no sends).');
