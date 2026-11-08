/** Execute the real chat entry points with only identity and page IO replaced. */
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
assert.ok(existsSync('lib/admin-chat/card-actions.ts'),'Admin chat must expose guarded action cards');
let enabled=false,role='admin',calls=0;
const sent:unknown[]=[];
const forward=async(...args:unknown[])=>{calls++;sent.push(args);return {ok:true};};
const deps:Record<string,unknown>={
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 '@/lib/staff/real-admin':{requireRealAdmin:async()=>{if(role!=='admin')throw Error('denied');return {identity:{id:'admin',role},client:{rpc:async()=>({data:[],error:null})}};}},
 './config':{adminChatEnabled:()=>enabled},zod:{z},
 '@/lib/patient-care/clinical-case-repository':{directorySchema:z.array(z.unknown())},
 '@/lib/patient-care/clinical-actions':{assignRealMember:forward},
 '@/lib/staff/nurse-actions':{assignRealNurse:forward},
 '@/lib/staff/real-member-search-actions':{searchRealMembers:forward},
 '@/lib/real-booking/appointment-repository':{staffAppointmentContext:async()=>{calls++;return {}; }},
 '@/lib/real-booking/appointment-runtime':{readAppointmentData:async()=>({workspace:{member:{name:'Example'}},data:{appointments:[]}})},
 '@/lib/real-booking/repository':{getStaffBookingRequests:async()=>[]},
 '@/lib/staff/member-contact':{readMemberContacts:async()=>({})},
 '@/lib/real-booking/config':{realBookingEnabled:()=>true},
 '@/lib/real-booking/appointment-actions':Object.fromEntries(['changeStaffAppointment','cancelStaffAppointment','startStaffAppointmentNotice','retryStaffAppointmentNotice','reconcileStaffAppointmentNotice'].map(name=>[name,forward])),
 '@/lib/real-booking/actions':{staffBookingCommand:forward},
 '@/lib/staff/real-coordination/actions':Object.fromEntries(['coordinationCommand','refreshCoordinationTask','readCoordinationPage','searchCoordinationMembers'].map(name=>[name,forward])),
};
const out:Record<string,(...args:unknown[])=>Promise<{access:string;result?:unknown}>>={};
new vm.Script(ts.transpileModule(readFileSync('lib/admin-chat/card-actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports:out,process:{env:{}},require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
const entrypoints=['readAdminActionCard','searchAdminCareMembers','assignAdminChatDoctor','assignAdminChatNurse','adminCoordinationCommand','refreshAdminCoordinationTask','readAdminCoordinationPage','searchAdminCoordinationMembers','readAdminMemberBookings','changeAdminAppointment','cancelAdminAppointment','startAdminAppointmentNotice','retryAdminAppointmentNotice','reconcileAdminAppointmentNotice','adminProviderBookingCommand'];
for(const name of entrypoints){assert.equal(typeof out[name],'function',name);assert.equal((await out[name]('care-team')).access,'off');}
assert.equal(calls,0,'Flag off reaches no page read or write');
enabled=true;
for(role of ['doctor','nurse','clinic'])for(const name of entrypoints)assert.equal((await out[name]('care-team')).access,'denied');
assert.equal(calls,0,'Other roles reach no page read or write');
role='admin';
const beforeOpening=calls;
const emptyBookingCard=await out.readAdminActionCard('bookings');
assert.equal(calls,beforeOpening,'Opening bookings must not search or audit unrelated members');
assert.deepEqual(JSON.parse(JSON.stringify(emptyBookingCard.result)),{kind:'bookings',page:{rows:[],hasMore:false,nextCursor:null}});
const command={caseId:'case',taskId:'task',revision:7,requestId:'request',operation:'complete',input:{note:'Fixture note'}};
await out.adminCoordinationCommand(command);
assert.equal((sent.at(-1) as unknown[])[0],command,'Request id and expected revision are forwarded untouched to the page action');
const form=new FormData();form.set('revision','7');
await out.assignAdminChatDoctor({ok:false,message:''},form);
assert.equal((sent.at(-1) as unknown[])[1],form,'Assignment validation and audit stay in the existing page action');
await out.assignAdminChatNurse({status:'idle',message:''},form);
await out.searchAdminCareMembers({query:'Example',cursor:null});
await out.refreshAdminCoordinationTask('task');
await out.readAdminCoordinationPage({filter:'completed'});
await out.searchAdminCoordinationMembers({search:'Example'});
assert.equal(calls,7);
for(const name of ['changeAdminAppointment','cancelAdminAppointment','startAdminAppointmentNotice','retryAdminAppointmentNotice','reconcileAdminAppointmentNotice']){
 const previous={ok:false};await out[name]('a1000000-0000-4000-8000-000000000001',previous,form);
 const args=sent.at(-1) as unknown[];assert.equal(args[1],previous);assert.equal(args[2],form,'Booking revision, command id and consent stay with the page action');
}
await out.adminProviderBookingCommand({ok:false,message:''},form);
assert.equal((sent.at(-1) as unknown[])[1],form);
const booking=await out.readAdminMemberBookings('a1000000-0000-4000-8000-000000000001');
assert.equal(booking.access,'allowed');
await assert.rejects(()=>out.readAdminMemberBookings('invalid'));

await assert.rejects(()=>out.readAdminActionCard('unexpected'));
console.log('Admin action entry points: flag off and doctor/nurse/clinic refused; shared actions preserve revisions and request identity (mocked IO).');
