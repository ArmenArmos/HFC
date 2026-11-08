import assert from 'node:assert/strict';
import {todayItems,dueState} from '@/lib/nurse-chat/today';
import {nurseHandoffSchema} from '@/lib/nurse-chat/handoffs';
import {readDoctorDay,doctorDayCounts} from '@/lib/doctor-inbox/day';
import {sourceData,task as fixtureTask} from './doctor-chat-home-fixture';
const now=new Date('2026-10-31T08:00:00Z');
assert.equal(dueState(null,false,now),'open');
assert.equal(dueState('2026-10-31T08:00:00Z',false,now),'due');
assert.equal(dueState('2026-10-30T07:00:00Z',false,now),'overdue');
assert.equal(dueState('2026-10-30T07:00:00Z',true,now),'completed');
assert.equal(nurseHandoffSchema.safeParse({memberId:'bad'}).success,false);
const id=(n:number)=>`ad130000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const command={memberId:id(1),requestId:id(2),messageId:'m1',expectedVersion:1,topic:'member-request',observation:'Please review this question.'};
assert.equal(nurseHandoffSchema.safeParse(command).success,true);
assert.equal(nurseHandoffSchema.safeParse({...command,topic:'urgent'}).success,false,'No unapproved urgent escalation');
assert.equal(nurseHandoffSchema.safeParse({...command,observation:'   '}).success,false);
const task={id:id(3),caseId:id(1),memberName:'Fictional member',kind:'contact-followup' as const,title:'Call',instructions:'Arrange a time',dueAt:'2026-10-31T09:00:00Z',creatorId:id(4),ownerId:id(5),ownerName:'Nurse',status:'open' as const,revision:1,createdAt:now.toISOString(),updatedAt:now.toISOString(),needsReassignment:false,eligibleOwners:[]};
const visit={source:'home-request' as const,id:id(6),memberId:id(1),memberName:'Fictional member',arrangementToken:'1',startsAt:'2026-10-31T07:00:00Z',endsAt:null,mode:'home' as const,location:null,bookingStatus:'confirmed' as const,completion:null,samplesPlanned:0,samplesTaken:0,openItems:1,steps:[],nurseName:'Nurse'};
const items=todayItems([task,{...task,id:id(7),status:'completed'}],[visit],now);
assert.deepEqual(items.map(i=>i.id),[`visit:home-request:${id(6)}`,`task:${id(3)}`,`task:${id(7)}`]);
assert.deepEqual(items.map(i=>i.state),['overdue','due','completed']);
assert.equal(todayItems([{...task,dueAt:null}],[],now)[0].state,'open','No fabricated due date');
// A visit past its start is overdue only when nothing happened: arrived (the clinic's check-in) or started by her is in progress.
{
 const stateOf=(v:object)=>todayItems([],[{...visit,...v}],now)[0].state;
 assert.equal(stateOf({}),'overdue');
 assert.equal(stateOf({bookingStatus:'attended'}),'due','Arrived at the clinic today is not overdue');
 assert.equal(stateOf({steps:[{step:'started',at:'2026-10-31T07:05:00Z',by:'Nurse'}]}),'due','Started by her is not overdue');
 assert.equal(stateOf({startsAt:'2026-10-29T07:00:00Z',bookingStatus:'attended'}),'open','An older arrived visit is open work, not overdue');
 assert.equal(stateOf({steps:[{step:'confirmed',at:'2026-10-30T07:05:00Z',by:'Nurse'}]}),'overdue','Only arrival or start counts');
 assert.equal(stateOf({completion:{completedAt:'2026-10-31T07:30:00Z',nurseName:'Nurse',summary:{}}}),'completed');
}
// A task handed over by the doctor (it carries its source conversation) is the first open work, even with no due date or a later one.
{
 const handed={...task,id:id(8),title:'From the doctor',dueAt:null,sourceConversationId:id(9)};
 const sorted=todayItems([task,handed,{...task,id:id(10),dueAt:'2026-10-30T09:00:00Z'}],[visit],now);
 assert.equal(sorted[0].id,`task:${id(8)}`,'The doctor hand-over comes first, before an overdue visit and tasks');
 const done=todayItems([{...handed,status:'completed' as const},task],[],now);
 assert.equal(done[0].id,`task:${id(3)}`,'A completed hand-over sorts with the finished work, not on top');
 assert.equal(todayItems([task],[],now)[0].id,`task:${id(3)}`,'Without a hand-over the order is unchanged');
}
{
 const alert={id:id(60),memberId:id(1),memberName:'Fictional member',source:'zoe' as const,priority:'urgent' as const,reason:'zoe_urgent_route',redFlags:[],state:'open' as const,stateSeq:0,occurrences:1,createdAt:now.toISOString(),lastSeenAt:now.toISOString(),acknowledgedAt:null,doctorName:null,acknowledgedBy:null,resolvedAt:null,resolvedBy:null,resolution:null,resolutionNote:null,telegram:[],ownerName:'Fictional nurse',ownerRole:'nurse' as const};
 const sorted=todayItems([{...task,sourceConversationId:id(9)}],[visit],now,[alert]);
 assert.equal(sorted[0].kind,'alert','Urgent alert precedes handed-over tasks and overdue visits');
 assert.equal(sorted[0].id,`alert:${alert.id}`);
 assert.equal(todayItems([],[],now,[alert]).length,1,'An alert alone is open work');
 assert.equal(todayItems([],[],now,[alert,{...alert,id:id(62),createdAt:'2026-10-01T08:00:00Z'}])[0].id,`alert:${alert.id}`,'Urgent rows retain the shared reader order rather than reordering by creation time');
 assert.equal(todayItems([],[],now,[{...alert,id:id(61),state:'acknowledged',createdAt:'2026-10-01T08:00:00Z'},alert])[0].id,`alert:${alert.id}`,'Unacknowledged urgent alerts lead acknowledged ones');
}
console.log('Nurse Today: mixed source sorting, terminal states, unknown due date and handoff validation passed.');

const previous=process.env.NOREON_NURSE_CHAT;
try{
 let handoffReads=0,unavailable=false,status='awaiting-doctor';
 const rpc={async rpc(name:string){
  if(name==='conversation_nurse_handoffs'){
   handoffReads++;
   return unavailable?{data:null,error:{code:'42501'}}:{data:{items:[{messageId:'m1',messageText:'Fictional source message',topic:'member-request',observation:'Fictional observation',nurseName:'Fictional nurse',task:{...fixtureTask,kind:'doctor-referral',status,events:[]}}],hasMore:false},error:null};
  }
  return {data:sourceData[name],error:null};
 }};
 delete process.env.NOREON_NURSE_CHAT;
 const before=await readDoctorDay(rpc,true,now);
 assert.equal(handoffReads,0,'Flag off adds no handoff reads to the doctor entry point');
 process.env.NOREON_NURSE_CHAT='true';
 const day=await readDoctorDay(rpc,true,new Date('2026-10-31T10:00:00Z'));
 assert.equal(day.handoffs?.items[0].task.id,fixtureTask.id);
 assert.equal(day.tasks?.items.length,0,'Handoff appears once, even when its existing task is overdue');
 assert.equal(doctorDayCounts(day).handoffs,1);
 assert.equal(doctorDayCounts(day).total,doctorDayCounts(before).total,'Deduplication preserves the total waiting count');
 status='completed';
 assert.equal(doctorDayCounts(await readDoctorDay(rpc)).handoffs,0,'Completed handoff remains history and leaves the waiting count');
 unavailable=true;
 assert.equal((await readDoctorDay(rpc)).handoffs,null,'Refused read is unavailable, never an empty successful handoff list');
 console.log('Doctor handoff reader: dark flag, actionable source, overdue-task deduplication, completion counts and unavailable state passed (mocked IO).');
}finally{if(previous===undefined)delete process.env.NOREON_NURSE_CHAT;else process.env.NOREON_NURSE_CHAT=previous;}
