import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {adminChatEnabled} from '@/lib/admin-chat/config';
import {readAdminOperations} from '@/lib/admin-chat/read';
import {adminIntent,waitingAge,uniqueWork} from '@/lib/admin-chat/contracts';

const now='2026-10-31T12:00:00Z',member='a1000000-0000-4000-8000-000000000001';
for(const value of [undefined,'false','TRUE','1',' true','true '])assert.equal(adminChatEnabled({NOREON_ADMIN_CHAT:value}),false);
assert.equal(adminChatEnabled({NOREON_ADMIN_CHAT:'true'}),true);
assert.equal(waitingAge(null,now),null);
assert.equal(waitingAge('bad',now),null);
assert.equal(waitingAge('2026-11-01T12:00:00Z',now),null,'Future timestamps are not zero-day waits');
assert.equal(waitingAge('2026-10-17T12:00:00Z',now),14);
const item={id:'callback:one',kind:'callback' as const,memberName:'Example member',owner:'admin' as const,ownerName:null,since:'2026-10-17T12:00:00Z',dueAt:null,href:'/staff/real/callbacks'};
assert.equal(uniqueWork([item,item]).length,1);

const calls:string[]=[];
const fixtures:Record<string,unknown>={
 real_admin_operations_summary:{asOf:now,cases:{total:1,doctorAssigned:0,doctorUnassigned:1,nurseAssigned:0,nurseUnassigned:1},bookings:{total:0,requested:0,providerProposed:0,confirmed:0,changePending:0,cancelled:0},coordination:{total:0,open:0,awaitingMember:0,awaitingDoctor:0,completed:0,cancelled:0,needsReassignment:0}},
 patient_clinical_case_search:{rows:[{id:member,name:'Example member',revision:1,doctorId:null,nurseId:null,createdAt:item.since,bookingCounts:{requested:0,providerProposed:0,confirmed:0,changePending:0}}],hasMore:false,nextCursor:null},
 staff_callback_queue:[{id:member,memberId:member,memberName:'Example member',phone:'SECRET PHONE',locale:'en',requestedFrom:'nurse',contactChannel:'phone',contactTimes:[],state:'open',outcome:null,createdAt:item.since,closedAt:null,telegramLinked:false}],
 admin_member_registrations:{ok:true,asOf:now,counts:{5:1},total:1,matching:1,rows:[{id:member,name:'Example member',phoneMasked:null,signedUpAt:item.since,channel:'phone',step:5,stepAt:item.since,questionnaire:'completed',urgent:true,enrolled:true,doctorAssigned:false,lastActivityAt:now}]},
 patient_coordination_queue:{tasks:[],nextCursor:null},
 telegram_delivery_problems:{ok:true,asOf:now,unapprovedHeld:2,system:[],replies:[],inbox:{dead:1,pending:0}},
 booking_pilot_workspace:{},
};
const rpc={async rpc(name:string){calls.push(name);return {data:fixtures[name],error:null};}};
const options={telegram:true,portal:true,now};
const overview=await readAdminOperations(rpc,'operations',options);
assert.equal(overview.summary?.cases.doctorUnassigned,1);
assert.deepEqual(calls,['real_admin_operations_summary'],'Summary does not fan out into member records');
calls.length=0;
const unassigned=await readAdminOperations(rpc,'unassigned',options);
assert.equal(unassigned.items.length,1,'One care-team assignment item even when both roles are missing');
assert.equal(unassigned.items[0].owner,'admin');
assert.ok(!JSON.stringify(unassigned).includes('urgent'));
const searchFixture=fixtures.patient_clinical_case_search as {rows:Record<string,unknown>[];hasMore:boolean;nextCursor:null};
const first=searchFixture.rows[0];
fixtures.patient_clinical_case_search={rows:[
 {...first,name:'Needs doctor',nurseId:member},
 {...first,id:'a1000000-0000-4000-8000-000000000002',name:'Needs nurse',doctorId:member,bookingCounts:{requested:1,providerProposed:1,confirmed:3,changePending:1}},
 {...first,id:'a1000000-0000-4000-8000-000000000003',name:'Assigned',doctorId:member,nurseId:member},
],hasMore:false,nextCursor:null};
for(const [intent,name] of [['doctor-waiting','Needs doctor'],['nurse-waiting','Needs nurse'],['test-requests','Needs nurse']] as const){
 calls.length=0;
 const list=await readAdminOperations(rpc,intent,options);
 assert.deepEqual(list.items.map(row=>row.memberName),[name],`${intent} opens precisely the matching members`);
 assert.deepEqual(calls,['patient_clinical_case_search'],'Count drilldown does not read unrelated queues or visit details');
 if(intent==='test-requests')assert.equal(list.items[0].requestCount,3,'Only waiting provider test requests contribute');
 const outage=await readAdminOperations({rpc:async()=>({data:null,error:{code:'08006'}})},intent,options);
 assert.deepEqual(outage.unavailable,[intent],'An unavailable count list never becomes a complete empty list');
}
fixtures.patient_clinical_case_search=searchFixture;
const callbacks=await readAdminOperations(rpc,'callbacks',options);
assert.equal(callbacks.items.length,1);
assert.equal(callbacks.items[0].owner,'admin','Admin callback queue remains owned by operations');
assert.ok(!JSON.stringify(callbacks).includes('SECRET PHONE'));
const overdue=await readAdminOperations(rpc,'overdue',options);
assert.equal(overdue.items.filter(i=>i.kind==='assignment').length,1,'Registration and member search do not duplicate assignment work');
assert.equal(overdue.items.filter(i=>i.kind==='registration').length,0,'Enrolled members are not pending registrations');
assert.equal(overdue.items.find(i=>i.kind==='callback')?.dueAt,null,'Age does not create a response deadline');
assert.ok(overdue.unavailable.includes('bookings'),'Booking read failure cannot look like an empty booking queue');
assert.ok(overdue.notices.includes('held-wording'),'Unapproved automatic messages stay visible as an aggregate');
assert.ok(overdue.notices.includes('incoming-failed'));
// Members with an overdue LDL re-test: the count is the number of members, fenced ones are not counted, a switched-off or failed read is not zero.
{
 const retest=(id:string,over:object)=>({id,memberId:id,memberName:`Member ${id.slice(-1)}`,doctorName:'Doctor Example',dueFrom:'2026-10-01',dueTo:'2026-10-20',state:'requested',overdue:true,overdueAt:'2026-10-21T00:00:00Z',requestStatus:'open',kind:'overdue',fenceReason:null,...over});
 fixtures.admin_ldl_retests={version:'ldl-response-v1',enabled:true,items:[retest('a1000000-0000-4000-8000-000000000011',{}),retest('a1000000-0000-4000-8000-000000000012',{doctorName:null}),retest('a1000000-0000-4000-8000-000000000013',{kind:'fenced',overdue:false,state:'fenced',fenceReason:'open_visit'})]};
 const ldl=await readAdminOperations(rpc,'ldl-overdue',options);
 assert.equal(ldl.items.length,2,'Two members are overdue; the fenced one is not counted');
 assert.ok(ldl.items.every(i=>i.kind==='ldl-retest'&&i.href.startsWith('/staff/real/members/')));
 assert.equal(ldl.items.find(i=>i.ownerName===null)?.owner,'admin','With no doctor the work is the administrator\'s');
 assert.deepEqual(ldl.unavailable,[]);assert.deepEqual(ldl.disabled,[]);
 fixtures.admin_ldl_retests={version:'ldl-response-v1',enabled:false};
 assert.deepEqual((await readAdminOperations(rpc,'ldl-overdue',options)).disabled,['ldl-overdue'],'Switched off is said, not shown as zero');
 const broken=await readAdminOperations({rpc:async()=>({data:null,error:{code:'08006'}})},'ldl-overdue',options);
 assert.deepEqual(broken.unavailable,['ldl-overdue']);assert.equal(broken.items.length,0);
}
const off=await readAdminOperations(rpc,'delivery',{...options,telegram:false});
assert.ok(off.disabled.includes('delivery'));
assert.ok(!JSON.stringify(overdue).includes('SECRET PHONE'));
// A realistic saved appointment goes through the existing booking summary reader.
const arrangement={offerId:member,offerVersion:'v1',clinicId:member,mode:'home',startsAt:now,endsAt:'2026-10-31T13:00:00Z',timezone:'Asia/Yerevan',location:'PRIVATE ADDRESS',preparation:'CLINICAL PREPARATION',preparationVersion:'v1',coveredTestIds:['PRIVATE TEST'],followUps:[]};
const revisionAt='2026-10-31T10:00:00Z';
const appointment={version:'email-pilot-v1',id:member,memberId:member,revision:1,status:'notification-pending',program:[],current:null,proposed:arrangement,noticeId:member,createdAt:item.since,history:[{revision:1,createdAt:revisionAt,program:[],previous:null,proposed:arrangement,noticeState:'pending'}]};
fixtures.booking_pilot_workspace={member:{id:member,name:'Example member'},appointments:[appointment]};
fixtures.booking_pilot_workspace_details={memberId:member,phone:'SECRET PHONE',purposes:{[`${member}:1`]:'booking'},clinics:{[member]:'Example clinic'}};
fixtures.booking_pilot_programme_state={memberId:member,appointments:{}};
const portalDetails={channel:'portal',noticeState:'pending',portalRevisions:[1],decline:null,proposal:null,checkin:null};
fixtures.booking_portal_details={memberId:member,enabled:true,appointments:{[member]:portalDetails}};
let bookings=await readAdminOperations(rpc,'bookings',options);
assert.equal(bookings.items.length,1);assert.equal(bookings.items[0].ownerName,'Example clinic');
assert.equal(bookings.items[0].since,revisionAt,'Pending revision age starts at the saved revision, not original appointment');
assert.equal(bookings.items[0].bookingState,'clinic-response');
for(const failure of ['error','malformed','wrong-member','rejected'] as const){
 const failedPortal={async rpc(name:string){
  if(name!=='booking_portal_details')return rpc.rpc(name);
  if(failure==='rejected')throw Error('Portal unavailable');
  return {data:failure==='malformed'?{bad:true}:failure==='wrong-member'?{memberId:'a1000000-0000-4000-8000-000000000002',enabled:true,appointments:{}}:null,error:failure==='error'?{code:'08006'}:null};
 }};
 for(const intent of ['bookings','overdue'] as const){
  const unavailable=await readAdminOperations(failedPortal,intent,options);
  assert.ok(unavailable.unavailable.includes('bookings'),`${failure} portal read makes bookings unavailable`);
  assert.equal(unavailable.items.filter(i=>i.kind==='booking').length,0,`${failure} portal read must not guess a booking owner`);
 }
 const portalOff=await readAdminOperations(failedPortal,'bookings',{...options,portal:false});
 assert.deepEqual(portalOff.unavailable,[],'Portal failure does not affect email-only scheduling');
 assert.equal(portalOff.items[0].owner,'admin');
}
fixtures.booking_portal_details={memberId:member,enabled:false,appointments:{[member]:{...portalDetails,channel:'email'}}};
fixtures.booking_pilot_workspace={member:{id:member,name:'Example member'},appointments:[{...appointment,canStartScheduling:true}]};
bookings=await readAdminOperations(rpc,'bookings',options);
assert.equal(bookings.items[0].owner,'admin','An unsent email cannot be assigned to the clinic');
assert.equal(bookings.items[0].bookingState,'start-scheduling');
fixtures.booking_pilot_workspace={member:{id:member,name:'Example member'},appointments:[{...appointment,history:[]}]};
bookings=await readAdminOperations(rpc,'bookings',options);
assert.equal(bookings.items[0].since,null,'Unknown revision timestamp stays unknown');
fixtures.booking_pilot_workspace={member:{id:member,name:'Example member'},appointments:[appointment]};
for(const secret of ['PRIVATE ADDRESS','CLINICAL PREPARATION','PRIVATE TEST','SECRET PHONE'])assert.ok(!JSON.stringify(bookings).includes(secret));
fixtures.booking_pilot_workspace_details={memberId:member,phone:null,purposes:{[`${member}:1`]:'cancellation'},clinics:{}};
bookings=await readAdminOperations(rpc,'bookings',options);assert.equal(bookings.items.length,0,'Pending cancellation is not awaiting a booking');
fixtures.booking_pilot_workspace_details={bad:true};
bookings=await readAdminOperations(rpc,'bookings',options);assert.ok(bookings.unavailable.includes('bookings'),'Unknown booking purpose cannot be guessed');
const task={id:member,caseId:member,memberName:'Example member',kind:'evidence-collection',title:'PRIVATE CLINICAL TITLE',instructions:'PRIVATE INSTRUCTIONS',dueAt:'2026-10-30T12:00:00Z',creatorId:member,ownerId:member,ownerName:'Example nurse',status:'open',revision:1,createdAt:item.since,updatedAt:now,needsReassignment:false,eligibleOwners:[{id:member,name:'Example nurse',role:'nurse'}]};
fixtures.patient_coordination_queue={tasks:[task,task],nextCursor:null};
calls.length=0;
const tasksOnly=await readAdminOperations(rpc,'tasks',options);
assert.deepEqual(tasksOnly.items.map(row=>row.kind),['task']);
assert.deepEqual(calls,['patient_coordination_queue'],'Active task count opens only the active task list');
assert.deepEqual((await readAdminOperations({rpc:async()=>({data:null,error:{code:'08006'}})},'tasks',options)).unavailable,['tasks']);
let queue=await readAdminOperations(rpc,'overdue',options);
assert.equal(queue.items.filter(i=>i.kind==='task').length,1);
assert.equal(queue.items.find(i=>i.kind==='task')?.owner,'nurse');
assert.equal(queue.items.find(i=>i.kind==='task')?.dueAt,task.dueAt);
assert.ok(!JSON.stringify(queue).includes('PRIVATE INSTRUCTIONS'));assert.ok(!JSON.stringify(queue).includes('PRIVATE CLINICAL TITLE'));
fixtures.patient_coordination_queue={tasks:[{...task,needsReassignment:true}],nextCursor:null};
queue=await readAdminOperations(rpc,'overdue',options);assert.equal(queue.items.find(i=>i.kind==='task')?.owner,'admin');
fixtures.patient_clinical_case_search={...(fixtures.patient_clinical_case_search as object),hasMore:true,nextCursor:{id:member,createdAt:item.since}};
queue=await readAdminOperations(rpc,'unassigned',options);
assert.ok(queue.partial.includes('unassigned'),'Bounded pagination explicitly reports incomplete coverage');
assert.equal(queue.items.length,1,'Repeated work across pages is deduplicated');
for(const intent of ['doctor-waiting','nurse-waiting','test-requests'] as const){
 assert.deepEqual((await readAdminOperations(rpc,intent,options)).partial,[intent],'Each count list preserves the bounded search warning');
}
const [olderOpen]=fixtures.staff_callback_queue as Record<string,unknown>[];
const newerClosed=Array.from({length:200},(_,index)=>({...olderOpen,id:`b1000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`,state:'done',outcome:'reached',createdAt:now,closedAt:now}));
fixtures.staff_callback_queue=newerClosed.slice(0,199);
assert.deepEqual((await readAdminOperations(rpc,'callbacks',options)).partial,[],'An uncapped callback read is complete');
// The RPC caps newest requests before sorting open ones first: the older open
// request is outside the returned window of 200 newer closed requests.
fixtures.staff_callback_queue=[...newerClosed,olderOpen].slice(0,200);
const cappedCallbacks=await readAdminOperations(rpc,'callbacks',options);
assert.deepEqual(cappedCallbacks.items,[]);
assert.ok(cappedCallbacks.partial.includes('callbacks'),'An older open request hidden behind 200 closed requests must not look like a complete empty queue');
assert.ok((await readAdminOperations(rpc,'overdue',options)).partial.includes('callbacks'),'The combined queue preserves the callback coverage warning');
fixtures.staff_callback_queue=[olderOpen,...newerClosed.slice(0,199)];
const cappedOpenCallbacks=await readAdminOperations(rpc,'callbacks',options);
assert.equal(cappedOpenCallbacks.items.length,1,'Known open requests remain visible in a capped read');
assert.ok(cappedOpenCallbacks.partial.includes('callbacks'));
fixtures.staff_callback_queue={invalid:true};
assert.ok((await readAdminOperations(rpc,'callbacks',options)).unavailable.includes('callbacks'));

// Run the actual exported action with only its identity/IO boundary replaced.
let enabled=false,role='admin',reads=0,authCalls=0;
const exports:Record<string,unknown>={};
const load=(path:string,deps:Record<string,unknown>)=>{
 const out:Record<string,unknown>={};
 new vm.Script(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports:out,process:{env:{}},require:(name:string)=>{assert.ok(name in deps,`Unexpected import ${name}`);return deps[name];}});
 return out;
};
const admin=load('lib/staff/real-admin.ts',{
 'server-only':{},'./clinic-scheduling-schema':{},'next/headers':{headers:async()=>new Headers({host:'localhost:3000'})},'next/navigation':{notFound:()=>{throw Error('denied');}},
 zod:{z},'@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>{authCalls++;return {identity:{role},client:rpc};}},
 '@/lib/patient-care/real-review-config':{},'./hosts':{staffHostAllowed:()=>true},'@/lib/messaging/brevo-email':{},
});
Object.assign(exports,load('lib/admin-chat/actions.ts',{
 'next/navigation':{unstable_rethrow:()=>{}},'@/lib/observability/with-logging':{loggedAction:(_n:string,fn:unknown)=>fn},
 '@/lib/staff/real-admin':admin,'./config':{adminChatEnabled:()=>enabled},'./read':{readAdminOperations:async()=>{reads++;return overview;}},
 '@/lib/telegram-runtime/config':{telegramEnabled:()=>true},'./contracts':{adminIntent},
 '@/lib/clinic-scheduling/schema':{clinicSchedulingEnabled:()=>false},
}));
const action=exports.readAdminChat as (input:unknown)=>Promise<{kind:string}>;
assert.equal((await action('operations')).kind,'off');assert.equal(authCalls,0);
enabled=true;
for(role of ['doctor','nurse','clinic'])assert.equal((await action('operations')).kind,'denied');
assert.equal(reads,0,'Wrong roles never read operations');
role='admin';assert.equal((await action('operations')).kind,'ready');assert.equal(reads,1);
assert.equal((await action({intent:'operations',role:'admin'})).kind,'invalid');assert.equal(reads,1);
for(const intent of ['doctor-waiting','nurse-waiting','test-requests','tasks'])assert.equal((await action(intent)).kind,'ready','The guarded chat entry point accepts each count list');
assert.equal(reads,5);
console.log('Admin chat: exact flag, real admin boundary, wrong roles, narrow projection, deduplication, age, source outages and disabled delivery passed (mocked database).');
