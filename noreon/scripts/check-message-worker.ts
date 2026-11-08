import assert from 'node:assert/strict';
const {runMessageWorker,MessageAdmissionError}=await import('@/lib/messaging/worker');
import type {MessageWorkerStore} from '@/lib/messaging/worker';
const input={attemptId:'b9a00000-0000-4000-8000-000000000001',destination:'+37499000999',channel:'sms' as const,locale:'en' as const};
const sid='SM'+'1'.repeat(32);
function fixture(){
 const calls:string[]=[];let finish=true,current={status:'accepted',provider_reference:sid};
 const store:MessageWorkerStore={sweep:async()=>0,claimSource:async()=> 'claim',completeSource:async()=>true,sources:async()=>[{plan_id:'plan1',published_at:'2026-10-12T00:00:00Z'}],enqueue:async()=>{calls.push('enqueue');return 'job1';},queued:async()=>['quiet','job1'],begin:async id=>{calls.push('begin:'+id);return id==='quiet'?null:input;},finish:async()=>{calls.push('finish');return finish;},attempt:async()=>current,record:async()=>{calls.push('record');return true;}};
 return {store,calls,setFinish:(v:boolean)=>finish=v,setCurrent:(v:typeof current)=>current=v};
}
let f=fixture();
let result=await runMessageWorker(f.store,async()=>{f.calls.push('send');return {status:'accepted',reference:sid,deliveryStatus:'queued',errorCode:null};});
assert.deepEqual(f.calls,['enqueue','begin:quiet','begin:job1','send','finish','record']);assert.equal(result.accepted,1);assert.equal(result.skipped,1);assert.equal(result.halted,null);
f=fixture();f.setFinish(false);
result=await runMessageWorker(f.store,async()=>({status:'unknown'}));assert.equal(result.accepted,1,'Early signed callback resolves ambiguous response');assert.equal(result.halted,null);
f=fixture();f.setFinish(false);f.setCurrent({status:'accepted',provider_reference:'SM'+'2'.repeat(32)});
result=await runMessageWorker(f.store,async()=>({status:'accepted',reference:sid,deliveryStatus:'queued',errorCode:null}));assert.equal(result.halted,'storage');assert.equal(result.accepted,0,'Conflicting SID is not success');
f=fixture();let sends=0;f.store.queued=async()=>['job1','job2'];
result=await runMessageWorker(f.store,async()=>{sends++;return {status:'failed'};});assert.equal(sends,1);assert.equal(result.rejected,1);assert.equal(result.halted,'provider-rejected');
f=fixture();result=await runMessageWorker(f.store,async()=>({status:'unknown'}));assert.equal(result.halted,'provider-unknown');assert.equal(result.unknown,1);
f=fixture();f.store.record=async()=>{throw Error('private database details');};result=await runMessageWorker(f.store,async()=>({status:'accepted',reference:sid,deliveryStatus:'sent',errorCode:null}));assert.equal(result.halted,'storage');assert.ok(!JSON.stringify(result).includes('private'));
f=fixture();let time=0;f.store.enqueue=async()=>{time=44000;return 'job1';};result=await runMessageWorker(f.store,async()=>{throw Error('Must not begin a provider call without time to persist');},()=>time);assert.equal(result.submitted,0);
f=fixture();f.store.sources=async after=>after?[{plan_id:'healthy',published_at:'2026-10-12T00:00:01Z'}]:Array.from({length:100},(_,i)=>({plan_id:'bad'+i,published_at:'2026-10-12T00:00:00Z'}));
f.store.enqueue=async id=>{if(id.startsWith('bad'))throw Error('one bad source');return 'healthy-job';};
result=await runMessageWorker(f.store,async()=>({status:'accepted',reference:sid,deliveryStatus:'queued',errorCode:null}));
assert.equal(result.accepted,1,'A page of failing sources must not block the later source or existing queue');assert.equal(result.sourceErrors,100);assert.equal(result.enqueued,1);
for(const reason of ['paused','daily-limit','busy'] as const){f=fixture();f.store.begin=async()=>{throw new MessageAdmissionError(reason);};result=await runMessageWorker(f.store,async()=>{throw Error('Admission must stop send');});assert.equal(result.halted,reason);assert.equal(result.submitted,0);}
console.log('Worker skips quiet jobs, sends once, reconciles early callbacks, stops on ambiguous/rejected/storage failure, and respects its deadline.');

f=fixture();let claimedEnqueues=0;f.store.claimSource=async()=>null;f.store.enqueue=async()=>{claimedEnqueues++;return 'job';};
result=await runMessageWorker(f.store,async()=>({status:'accepted',reference:sid,deliveryStatus:null,errorCode:null}));
assert.equal(claimedEnqueues,0,'A denied durable claim must not enqueue');assert.equal(result.accepted,1,'Producer backoff must not block existing queue');
f=fixture();let completions=0;f.store.enqueue=async()=>{throw Error('timeout');};f.store.completeSource=async()=>{completions++;return true;};
result=await runMessageWorker(f.store,async()=>({status:'accepted',reference:sid,deliveryStatus:null,errorCode:null}));
assert.equal(completions,0,'Timeout leaves durable backoff intact');assert.equal(result.sourceErrors,1);
f=fixture();f.store.enqueue=async()=>null;f.store.completeSource=async()=>{throw Error('Must not clear temporary ineligibility backoff');};
result=await runMessageWorker(f.store,async()=>({status:'accepted',reference:sid,deliveryStatus:null,errorCode:null}));assert.equal(result.sourceErrors,0);

f=fixture();f.store.queued=async()=>['blocked-destination','job1'];f.store.begin=async id=>{f.calls.push('begin:'+id);return id==='blocked-destination'?null:input;};
result=await runMessageWorker(f.store,async()=>{f.calls.push('send');return {status:'accepted',reference:sid,deliveryStatus:null,errorCode:null};});
assert.deepEqual(f.calls,['enqueue','begin:blocked-destination','begin:job1','send','finish']);assert.equal(result.accepted,1);assert.equal(result.skipped,1);assert.equal(result.halted,null,'A terminal policy cancellation must not halt the following allowed job');
