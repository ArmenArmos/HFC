import assert from 'node:assert/strict';
import {clinicSnapshot} from './fixtures/clinic-portal';
import {clinicChatEnabled} from '@/lib/clinic-chat/config';
import {chatQuerySchema,chatCommandSchema} from '@/lib/clinic-chat/schema';
import {readClinicChat} from '@/lib/clinic-chat/runtime';
import type {ClinicIdentity} from '@/lib/clinic-portal/schema';
const base={NOREON_CLINIC_PORTAL_ENABLED:'true',NOREON_CLINIC_SCHEDULING_ENABLED:'true'};
for(const value of [undefined,'false','TRUE','1',' true','true '])assert.equal(clinicChatEnabled({...base,NOREON_CLINIC_CHAT:value}),false);
assert.equal(clinicChatEnabled({...base,NOREON_CLINIC_CHAT:'true'}),true);
for(const key of Object.keys(base))assert.equal(clinicChatEnabled({...base,[key]:'false',NOREON_CLINIC_CHAT:'true'}),false);
const id=(n:number)=>`c1c10000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const identity:ClinicIdentity={version:'clinic-portal-v1',userId:id(1),membershipId:id(2),membershipRevision:1,clinicId:id(3),clinicName:'Synthetic clinic',displayName:'Synthetic staff',capability:'clinic_staff'};
const calls:{name:string;args:Record<string,unknown>|undefined}[]=[];
const rpc={rpc:async(name:string,args?:Record<string,unknown>)=>{
 calls.push({name,args});
 if(name==='clinic_schedule_bookings')return {error:null,data:{version:'clinic-schedule-bookings-v1',enabled:true,role:'staff',bookings:[]}};
 if(name==='clinic_batches_page')return {error:null,data:{version:'clinic-batches-page-v1',clinicId:identity.clinicId,batches:[],nextCursor:null}};
 if(name==='clinic_member_search')return {error:null,data:{version:'clinic-member-search-v2',enabled:true,members:[],total:0,page:1,pageSize:25}};
 return {error:{code:'42501'},data:null};
}};
const home=await readClinicChat(rpc,identity,{kind:'home'});
assert.equal(home.kind,'home');
assert.equal(calls.length,3);
for(const call of calls)assert.equal(call.args?.p_clinic??call.args?.p_clinic_id,identity.clinicId);
assert.equal(calls.filter(c=>c.name==='clinic_schedule_bookings'&&c.args?.p_day!==null).length,1,'Today has its own exact-day read');
await readClinicChat(rpc,identity,{kind:'bookings',scope:'past',day:'2026-11-01'});
assert.equal(calls.at(-1)?.args?.p_scope,'past');assert.equal(calls.at(-1)?.args?.p_day,'2026-11-01');
await readClinicChat(rpc,identity,{kind:'members',query:' 123 ',page:1});
assert.equal(calls.at(-1)?.args?.p_query,'123');
const denied=await readClinicChat(rpc,identity,{kind:'member',memberId:id(99)});
assert.ok(denied.kind==='member'&&denied.result.status==='missing');
assert.equal(calls.at(-1)?.name,'clinic_member_file','Member read retains audited RPC');
await readClinicChat(rpc,identity,{kind:'batches',cursor:'next-page'});
assert.equal(calls.at(-1)?.args?.p_cursor,'next-page');
assert.equal(chatQuerySchema.safeParse({kind:'records'}).success,true,'Explicit member selection for full-access attachment');
assert.equal(chatQuerySchema.safeParse({kind:'home',clinicId:id(8)}).success,false,'No client clinic override');
const command={version:'clinic-schedule-command-v1',submissionId:id(8),appointmentId:id(9),revision:1};
assert.equal(chatCommandSchema.safeParse({...command,op:'check-in',outcome:'arrived'}).success,true);
assert.equal(chatCommandSchema.safeParse({...command,op:'decline',reason:'ab'}).success,false);
for(const op of ['confirm','withdraw-proposal','decline','propose']){
 const extra=op==='withdraw-proposal'?{proposalId:id(10)}:op==='decline'?{reason:'No capacity'}:op==='propose'?{slotKey:'a'.repeat(64),note:null}:{};
 assert.equal(chatCommandSchema.safeParse({...command,op,...extra}).success,true);
}
const outage=await readClinicChat({rpc:async()=>{throw Error('Synthetic outage');}},identity,{kind:'home'});
assert.ok(outage.kind==='home'&&outage.bookings.status==='unavailable'&&outage.batches.status==='unavailable','Read outages never become empty counts');


const batchCalls:Record<string,unknown>[]=[];
const batchRpc={rpc:async(_name:string,args?:Record<string,unknown>)=>{batchCalls.push(args!);return {error:null,data:{...clinicSnapshot,batch:{...clinicSnapshot.batch,clinicId:identity.clinicId}}};}};
const detail=await readClinicChat(batchRpc,identity,{kind:'batch',batchId:clinicSnapshot.batch.id,cursor:null});
assert.ok(detail.kind==='batch'&&detail.result.status==='loaded');
assert.equal(batchCalls[0].p_clinic_id,identity.clinicId);
const wrongBatch=await readClinicChat({rpc:async()=>({error:null,data:clinicSnapshot})},identity,{kind:'batch',batchId:clinicSnapshot.batch.id,cursor:null});
assert.ok(wrongBatch.kind==='batch'&&wrongBatch.result.status==='unavailable','Another clinic snapshot is refused');

console.log('Clinic chat PASS: exact flag, scoped booking/batch status reads, today, paging, audited refused member, wrong-clinic batch refusal, command boundaries and outages. RPC responses mocked.');

const full={...identity,capability:'clinic_admin' as const,fullAccess:true};
const fullCalls:string[]=[];
const ownRows=await readClinicChat({rpc:async(name)=>{fullCalls.push(name);return {error:null,data:{version:'clinic-admin-patients-v1',enabled:true,patients:[{memberId:id(90),name:'Own-clinic member without booking',phone:null,birthDate:null,doctorName:'Assigned doctor',nurseName:null}]}};}},full,{kind:'records'});
assert.equal(ownRows.kind,'records');assert.equal(fullCalls[0],'clinic_admin_patients','Member selection reuses own-clinic enrolment access');
if(ownRows.kind==='records')assert.equal(ownRows.result.status,'loaded');
fullCalls.length=0;
const staffRecords=await readClinicChat({rpc:async(name)=>{fullCalls.push(name);return {error:null,data:null};}},identity,{kind:'records'});
assert.equal(staffRecords.kind,'access');assert.equal(fullCalls.length,0,'Staff never reach the full-access member list');

const {clinicAdminRecord:fullRecord}=await import('./fixtures/clinic-admin');
const projected=await readClinicChat({rpc:async(name)=>{assert.equal(name,'clinic_admin_patient_record');return {error:null,data:fullRecord};}},full,{kind:'member',memberId:id(90)});
assert.ok(projected.kind==='member'&&projected.result.status==='loaded');
if(projected.kind==='member'&&projected.result.status==='loaded')assert.deepEqual(Object.keys(projected.result.data).sort(),['bookings','files','member']);

// The assistant receives only masked contact values for upcoming bookings too.
const contactPhone='+37499120123',contactDate='1968-02-23';
const {clinicBookingSchema}=await import('@/lib/clinic-scheduling/schema');
const booking=clinicBookingSchema.parse({appointmentId:id(41),memberId:id(90),revision:1,reference:id(42),kind:'current',status:'confirmed',channel:'portal',memberName:'Synthetic member',memberPhone:null,startsAt:'2099-01-01T08:00:00Z',endsAt:'2099-01-01T09:00:00Z',previousStartsAt:null,previousEndsAt:null,tests:[],proposal:null,decline:null});
const contactRpc={rpc:async(name:string)=>({error:null,data:name==='clinic_schedule_bookings'?{version:'clinic-schedule-bookings-v1',enabled:true,role:'admin',bookings:[booking]}:name==='clinic_admin_patient_record'?{...fullRecord,member:{...fullRecord.member,phone:contactPhone,birthDate:contactDate},bookings:[booking]}:name==='clinic_member_masked'?{ok:true,members:[{memberId:id(90),phoneLast4:'0123',birthYear:1968}]}:{version:'clinic-batches-page-v1',clinicId:identity.clinicId,batches:[],nextCursor:null}})};
for(const query of [{kind:'home'},{kind:'bookings',scope:'upcoming',day:null},{kind:'member',memberId:id(90)}]as const){
 const reply=await readClinicChat(contactRpc,full,query);
 assert.ok(!JSON.stringify(reply).includes(contactPhone)&&!JSON.stringify(reply).includes(contactDate),`${query.kind}: no full contact values reach the assistant`);
 assert.deepEqual(reply.maskedMembers,[{memberId:id(90),phoneLast4:'0123',birthYear:1968}]);
}
