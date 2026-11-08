import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {redactEvent,type LogEvent} from '@/lib/observability/redact';
import {readChatMemberIdentities} from '@/lib/staff/chat-member-identity-read';
const warnings:LogEvent[]=[];
import {assessLdl} from '@/lib/ldl/status';
import {addDays,yerevanDate} from '@/lib/bp-week/model';
const id=(n:number)=>`d0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const doctor=id(1),a=id(2),b=id(3),outside=id(4),at='2026-11-06T08:00:00Z';
let pages=[{rows:[{id:a,doctorId:doctor},{id:b,doctorId:doctor},{id:outside,doctorId:id(9)}],hasMore:false,nextCursor:null}];
const identity=(id:string)=>({id,name:id===a?'Anna Example':'Aram Example',birthDate:'1980-01-01',sex:'female',clinic:'Clinic',phoneLast4:'1234',shortId:'NRN-1234'});
const memberReads:string[]=[];let capReadings=false,failQueueRead=false;
const modules:Record<string,unknown>={
 'server-only':{},zod:{z},
 '@/lib/observability/logger':{log:{warn:(msg:string,fields:Record<string,unknown>)=>warnings.push(redactEvent('warn',msg,fields))}},
 '@/lib/staff/member-search-command':{runMemberIdentitySearch:async()=>({ok:true,page:pages.shift()})},
 '@/lib/staff/chat-member-identity-read':{readChatMemberIdentities:async(_c:unknown,ids:string[])=>failQueueRead&&ids.includes(a)?null:ids.filter(id=>id!==outside).map(identity)},
 '@/lib/bp-device/runtime':{readBpMemberDevices:async(_c:unknown,member:string)=>{memberReads.push(member);return {readings:capReadings?Array.from({length:500},(_,i)=>({id:String(i),systolic:120,diastolic:80,measuredAt:at,source:'device'})):[{id:member,systolic:120,diastolic:80,measuredAt:at,source:member===a?'device':'manual'}]};}},
 '@/lib/ldl/runtime':{readDoctorLdl:async(_c:unknown,member:string)=>{memberReads.push(member);return {enabled:true,goals:[{version:1,category:'low',thresholdMmol:3,reductionRule:false,reductionPct:null,baseline:{kind:'unknown',mmol:null,on:null,source:null},setAt:at,nextTestOn:null}],observations:[{id:member,value:member===a?2:4,unit:'mmol/L',on:'2026-11-05',source:member===a?'clinic_reviewed':'member',name:null,memberVisible:true}]};}},
 '@/lib/ldl/status':{assessLdl},'@/lib/bp-week/model':{addDays,yerevanDate},
};
const exports:Record<string,unknown>={};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/staff-zoe/panel-read.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Set,Map,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];}});
const read=exports.readDoctorPanel as typeof import('@/lib/staff-zoe/panel-read').readDoctorPanel;
const queue={alerts:[{memberId:a,at,alert:{state:'open',createdAt:at}},{memberId:outside,at,alert:{state:'open',createdAt:at}}],windows:[{memberId:outside,since:at}],items:[{memberId:b}],labs:[],plans:[],uploads:[],identityChecks:[],others:{rest:99},missing:[],asOf:at,capped:false,urgentIncomplete:false,incomplete:false,p0Total:2,uploadTotal:0};
const client={rpc:async()=>{throw Error('Unexpected raw read');}};
const result=await read(client,doctor,queue as never,new Date(at));
assert.equal(result.kind,'panel');
if(result.kind==='panel'){
 assert.deepEqual(Array.from(result.rows,r=>r.identity.id),[a,b]);
 assert.equal(result.rows[0].attention,'urgent');assert.equal(result.rows[1].attention,'needs_me');
 assert.equal(result.rows[1].ldl?.counted,false,'Member-entered LDL never decides the target');
 assert.equal(result.who.incomplete,false,'Known other work is not an unavailable source');
 assert.deepEqual(Array.from(result.who.missing),[]);
 assert.equal(result.who.urgentIncomplete,false,'Unscoped routine queues do not fail the urgent check');
 assert.equal(result.who.others.rest,99,'Known other work remains visible in the summary');
 assert.doesNotMatch(JSON.stringify(result),new RegExp(outside));
 const graph=(kind:string)=>result.graphs.find(g=>g.kind===kind)!;
 assert.equal(graph('ldl').bars.find(bar=>bar.key==='at_goal')?.count,1);
 assert.equal(graph('ldl').bars.find(bar=>bar.key==='unknown')?.count,1);
 assert.equal(graph('risk').bars.find(bar=>bar.key==='low')?.count,2);
 assert.equal(graph('alerts').bars.reduce((n,bar)=>n+bar.count,0),1);
 assert.equal(graph('readings').bars.reduce((n,bar)=>n+bar.count,0),2);
 assert.equal(result.rows[1].bp?.unverified,true);
}
assert.ok(!memberReads.includes(outside),'Never read another doctor’s member');
for(const [rest,incomplete,capped,attention] of [[3,false,false,'unknown'],[0,false,false,'none'],[0,true,false,'unknown'],[0,false,true,'unknown']] as const){
 pages=[{rows:[{id:b,doctorId:doctor}],hasMore:false,nextCursor:null}];
 const unattended=await read(client,doctor,{...queue,items:[],others:{rest},incomplete,capped} as never,new Date(at));
 assert.equal(unattended.kind,'panel');
 if(unattended.kind==='panel'){
  assert.equal(unattended.rows[0].attention,attention,'Unlisted work cannot be attributed to an individual member');
  assert.equal(unattended.who.incomplete,incomplete);
 }
}
const summary=await read(client,doctor,queue as never,new Date(at),false);
assert.equal(summary.kind,'panel');
if(summary.kind==='panel'){assert.equal(summary.who.incomplete,false);assert.deepEqual(Array.from(summary.who.missing),[]);assert.equal(summary.who.others.rest,99);}

capReadings=true;pages=[{rows:[{id:a,doctorId:doctor}],hasMore:false,nextCursor:null}];
const capped=await read(client,doctor,queue as never,new Date(at));assert.equal(capped.kind,'panel');if(capped.kind==='panel')assert.equal(capped.graphs.some(g=>g.kind==='readings'),false,'Capped readings cannot claim a full four-week count');
for(const metrics of [false,true]){
 pages=Array.from({length:4},(_,page)=>({rows:Array.from({length:50},(_,n)=>({id:id(100+page*50+n),doctorId:doctor})),hasMore:true,nextCursor:{id:id(149+page*50),createdAt:at}})) as never;
 const last=id(900);const largeQueue={...queue,windows:[{memberId:last,since:at},{memberId:outside,since:at}],items:[{memberId:last},{memberId:outside}]};
 const large=await read(client,doctor,largeQueue as never,new Date(at),metrics);
 assert.equal(large.kind,'panel','A capped roster must not discard an authorized queue');
 if(large.kind==='panel'){
  assert.equal(large.who.alerts.length,1);assert.equal(large.who.alerts[0].memberId,a);
  assert.equal(large.who.windows.length,1);assert.equal(large.who.windows[0].memberId,last);
  assert.equal(large.who.items.length,1);assert.equal(large.who.items[0].memberId,last,'Queue members beyond the roster cap are retained');
  assert.equal(large.who.p0Total,2);assert.equal(large.graphs.length,0,'Incomplete roster never produces whole-panel graphs');
  assert.doesNotMatch(JSON.stringify(large),new RegExp(outside));
  if(metrics){assert.equal(large.rosterComplete,false);assert.equal(large.rows.length,200);assert.ok(large.rows[0].bp,'Available individual readings survive incomplete aggregation');}
  else assert.equal(pages.length,4,'Summary reads never depend on roster paging');
 }
}
pages=[];
const failedRoster=await read(client,doctor,queue as never,new Date(at));
assert.equal(failedRoster.kind,'panel','A failed roster cannot discard authorized urgent items');
if(failedRoster.kind==='panel'){assert.equal(failedRoster.who.alerts.length,1);assert.equal(failedRoster.graphs.length,0);}
failQueueRead=true;pages=[{rows:[{id:b,doctorId:doctor}],hasMore:false,nextCursor:null}];
const partialQueue=await read(client,doctor,{...queue,others:{rest:0}} as never,new Date(at));
assert.equal(partialQueue.kind,'panel');
if(partialQueue.kind==='panel'){
 assert.equal(partialQueue.who.incomplete,true,'An authorization read failure cannot claim complete queue counts');
 assert.equal(partialQueue.who.urgentIncomplete,true,'An authorization failure can hide urgent rows');
 assert.equal(partialQueue.who.alerts.length,0,'Unconfirmed queue rows never reach the doctor');
 assert.equal(partialQueue.graphs.some(g=>g.kind==='alerts'),false,'An unread queue cannot produce an alert graph');
}

failQueueRead=false;
const legacyQueue=await read(client,doctor,{...queue,missing:undefined,incomplete:true} as never,new Date(at),false);
assert.equal(legacyQueue.kind,'panel','An older queue without source ids still returns the authorized panel');
if(legacyQueue.kind==='panel'){
 assert.deepEqual(Array.from(legacyQueue.who.missing),[]);
 assert.equal(legacyQueue.who.incomplete,true);
}
const routinePartial=await read(client,doctor,{...queue,incomplete:true,missing:['saved_plans']} as never,new Date(at),false);
assert.equal(routinePartial.kind,'panel');
if(routinePartial.kind==='panel'){
 assert.equal(routinePartial.who.incomplete,true,'A real routine-source gap still marks counts incomplete');
 assert.deepEqual(Array.from(routinePartial.who.missing),['saved_plans']);
 assert.equal(routinePartial.who.urgentIncomplete,false,'Routine-source gaps do not fail the urgent read');
}
const urgentPartial=await read(client,doctor,{...queue,urgentIncomplete:true} as never,new Date(at),false);
assert.equal(urgentPartial.kind,'panel');if(urgentPartial.kind==='panel')assert.equal(urgentPartial.who.urgentIncomplete,true,'Panel authorization preserves a missing urgent source');

Object.assign(modules['@/lib/staff/chat-member-identity-read'] as object,{readChatMemberIdentities});
const failedIdentity=await read({rpc:async(name:string)=>{assert.equal(name,'staff_chat_member_identities');return {data:null,error:null};}},doctor,{...queue,missing:['saved_plans'],others:{rest:0}} as never,new Date(at),false);
assert.equal(failedIdentity.kind,'panel');
if(failedIdentity.kind==='panel'){
 assert.deepEqual(Array.from(failedIdentity.who.missing),['saved_plans','member_identities']);
 assert.equal(failedIdentity.who.incomplete,true);
 assert.equal(failedIdentity.who.urgentIncomplete,true);
 assert.equal(failedIdentity.who.alerts.length,0);
}
assert.equal(warnings.at(-1)?.msg,'doctor_panel_source_missing');
assert.equal(warnings.at(-1)?.rpc,'staff_chat_member_identities','The actual panel warning retains its RPC through the real redactor');
assert.deepEqual(Object.keys(warnings.at(-1)!).sort(),['_time','level','msg','rpc','ts'],'No member values are logged');
console.log('Doctor panel: assigned roster, queue authorization, missing identity source and redacted warning, capped/failed roster and complete-only graphs passed (synthetic IO).');
