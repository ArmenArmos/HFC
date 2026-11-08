import assert from 'node:assert/strict';
const {labCardDue,labCardRequestId}=await import('@/lib/zoe-chat-actions/lab-schedule');
const appointment={appointmentId:'00000000-0000-4000-8000-000000000001',revision:2,startsAt:'2026-11-03T05:00:00Z',quietStart:'22:00',quietEnd:'07:00'};
assert.equal(labCardDue(appointment,'prep',new Date('2026-11-02T15:59:59Z')),false);
assert.equal(labCardDue(appointment,'prep',new Date('2026-11-02T16:00:00Z')),true,'20:00 in Yerevan');
assert.equal(labCardDue(appointment,'fasting',new Date('2026-11-03T02:59:59Z')),false);
assert.equal(labCardDue(appointment,'fasting',new Date('2026-11-03T03:00:00Z')),true,'wake time in Yerevan');
assert.equal(labCardDue({...appointment,quietStart:'19:00'},'prep',new Date('2026-11-02T16:00:00Z')),false,'quiet at 20:00');
assert.equal(labCardDue({...appointment,quietStart:'19:00'},'prep',new Date('2026-11-03T03:00:00Z')),true,'defer to wake');
assert.equal(labCardDue(appointment,'prep',new Date('2026-11-02T18:00:00Z')),false,'do not catch up during quiet hours');
assert.equal(labCardDue(appointment,'fasting',new Date('2026-11-03T05:00:00Z')),false,'never post after the appointment starts');
assert.equal(labCardDue({...appointment,quietEnd:'10:00'},'fasting',new Date('2026-11-03T05:30:00Z')),false,'wake after visit: no stale fasting prompt');
assert.equal(labCardDue({...appointment,quietStart:'12:00',quietEnd:'14:00'},'prep',new Date('2026-11-02T16:00:00Z')),true,'non-overnight quiet hours');
assert.equal(labCardDue({...appointment,quietStart:'07:00',quietEnd:'07:00'},'prep',new Date('2026-11-02T16:00:00Z')),false,'ambiguous all-day quiet fails closed');
assert.equal(labCardRequestId(appointment,'prep'),labCardRequestId({...appointment},'prep'),'retry and parallel sweep use the same durable key');
assert.notEqual(labCardRequestId(appointment,'prep'),labCardRequestId(appointment,'fasting'));
assert.notEqual(labCardRequestId(appointment,'prep'),labCardRequestId({...appointment,revision:3},'prep'),'rescheduled appointment gets current cards');
console.log('Lab schedule: Yerevan time, quiet hours, missed ticks, expiry and durable keys pass.');
const {runLabCardSweep}=await import('@/lib/zoe-chat-actions/lab-sweep');
let calls=0;
const posted=new Set<string>();
const rpc={rpc:async(name:string,args:Record<string,unknown>)=>{
 calls++;
 if(name==='zoe_v3_lab_candidates')return {data:[{...appointment,v:1,memberId:crypto.randomUUID(),location:'Clinic',preparation:'Clinic preparation'}],error:null};
 assert.equal(name,'zoe_v3_lab_card_post');
 const request=String(args.p_request),replayed=posted.has(request);posted.add(request);
 return {data:{ok:true,replayed},error:null};
}};
assert.deepEqual(await runLabCardSweep({},new Date('2026-11-03T03:00:00Z'),rpc),{posted:0,replayed:0,failed:0,stoppedForTime:false});
assert.equal(calls,0,'switch off performs no IO');
const now=new Date('2026-11-03T03:00:00Z');
const [first,second]=await Promise.all([runLabCardSweep({NOREON_ZOE_APP_V3:'true'},now,rpc),runLabCardSweep({NOREON_ZOE_APP_V3:'true'},now,rpc)]);
assert.equal(first.posted+second.posted,2);assert.equal(posted.size,2,'repeated sweeps use one request per kind/appointment revision');
assert.equal((await runLabCardSweep({NOREON_ZOE_APP_V3:'true'},now,{rpc:async()=>({data:null,error:'unavailable'})})).failed,1);
console.log('Lab sweep: disabled IO, repeated/concurrent requests and failure reporting pass (RPC fixture, not DB concurrency).');
// More than one SQL page: completed earlier appointments cannot starve appointment 101.
const many=Array.from({length:101},(_,i)=>({...appointment,v:1,appointmentId:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,memberId:crypto.randomUUID(),location:'Clinic',preparation:'Booked instructions'}));
const ids=new Set<string>(),pages:unknown[]=[];
const paged={rpc:async(name:string,args:Record<string,unknown>)=>{
 if(name==='zoe_v3_lab_candidates'){
  pages.push(args.p_after_id);
  const start=args.p_after_id?many.findIndex(a=>a.appointmentId===args.p_after_id)+1:0;
  return {data:many.slice(start,start+100),error:null};
 }
 ids.add(String(args.p_request));return {data:{ok:true,replayed:false},error:null};
}};
const batch=await runLabCardSweep({NOREON_ZOE_APP_V3:'true'},now,paged);
assert.equal(batch.posted,202);assert.equal(ids.size,202);assert.equal(pages.length,2);
console.log('Lab sweep: 101 appointments advance through both cursor pages.');
// Deadline-limited ticks must skip completed work, including the already-posted kind on a partial appointment.
let simulated=0;
const realNow=Date.now;
const completed=new Set<string>();
const workload=Array.from({length:201},(_,i)=>({...appointment,v:1,appointmentId:`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,memberId:crypto.randomUUID(),location:'Clinic',preparation:'Booked instructions'}));
const slowRpc={rpc:async(name:string,args:Record<string,unknown>)=>{
 if(name==='zoe_v3_lab_candidates'){
  simulated+=20;
  const remaining=workload.map(a=>({...a,postedKinds:(['prep','fasting']as const).filter(k=>completed.has(labCardRequestId(a,k)))})).filter(a=>a.postedKinds.length<2&&(!args.p_after_id||a.appointmentId>String(args.p_after_id)));
  return {data:remaining.slice(0,100),error:null};
 }
 simulated+=100;
 completed.add(String(args.p_request));return {data:{ok:true,replayed:false},error:null};
}};
try{
 Date.now=()=>simulated;
 for(let tick=0;tick<4&&completed.size<402;tick++)await runLabCardSweep({NOREON_ZOE_APP_V3:'true'},now,slowRpc);
 assert.equal(completed.size,402,'later appointments advance over repeated 20-second ticks');
}finally{Date.now=realNow;}
console.log('Lab sweep: repeated budget-limited ticks finish 201 appointments with simulated 100ms post latency.');
