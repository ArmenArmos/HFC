import 'server-only';
import type {PlanMessageInput,SubmissionResult,VerifiedDeliveryCallback} from './twilio';
export class MessageAdmissionError extends Error{readonly reason:'paused'|'daily-limit'|'busy'|'spending-unconfigured'|'spending-revision'|'spending-limit'|'destination-blocked';constructor(reason:'paused'|'daily-limit'|'busy'|'spending-unconfigured'|'spending-revision'|'spending-limit'|'destination-blocked'){super(reason);this.reason=reason;}}
export interface MessageWorkerStore {
 sweep():Promise<number>;
 sources(after?:{plan_id:string;published_at:string}):Promise<Array<{plan_id:string;published_at:string}>>;
 claimSource(planId:string):Promise<string|null>;
 completeSource(planId:string,claimToken:string):Promise<boolean>;
 enqueue(planId:string):Promise<string|null>;
 queued():Promise<string[]>;
 begin(jobId:string):Promise<PlanMessageInput|null>;
 finish(attemptId:string,status:'accepted'|'failed'|'unknown',reference:string|null):Promise<boolean>;
 attempt(attemptId:string):Promise<{status:string;provider_reference:string|null}|null>;
 record(event:VerifiedDeliveryCallback):Promise<boolean>;
}
export async function runMessageWorker(store:MessageWorkerStore,submit:(input:PlanMessageInput)=>Promise<SubmissionResult>,now:()=>number=Date.now){
 const deadline=now()+45_000;
 const result={enqueued:0,sourceErrors:0,submitted:0,accepted:0,rejected:0,unknown:0,skipped:0,stale:0,halted:null as null|'storage'|'provider-rejected'|'provider-unknown'|'budget'|'paused'|'daily-limit'|'busy'|'spending-unconfigured'|'spending-revision'|'spending-limit'|'destination-blocked'};
 try{
  result.stale=await store.sweep();
  let cursor:{plan_id:string;published_at:string}|undefined,scanned=0;
  const producerDeadline=Math.min(deadline-35_000,now()+5000);
  sourcePages:while(scanned<1000&&result.enqueued<100&&now()<producerDeadline){
   let sources:Array<{plan_id:string;published_at:string}>;
   try{sources=await store.sources(cursor);}catch{result.sourceErrors++;break;}
   if(!sources.length)break;
   for(const source of sources.slice(0,100)){
    if(now()>=producerDeadline||scanned>=1000||result.enqueued>=100)break sourcePages;
    cursor=source;scanned++;
    try{
     // This RPC commits before enqueue, preserving cooldown on timeout/crash.
     const token=await store.claimSource(source.plan_id);
     if(!token)continue;
     if(await store.enqueue(source.plan_id)){
      result.enqueued++;
      await store.completeSource(source.plan_id,token);
     }
    }catch{result.sourceErrors++;}
   }
   if(sources.length<100)break;
  }
  if(now()>=deadline-30_000){result.halted='budget';return result;}
  const jobs=await store.queued();
  for(const job of jobs.slice(0,25)){
   // Reserve one provider timeout plus the authoritative outcome writes/reread.
   if(now()>=deadline-30_000){result.halted='budget';break;}
   const input=await store.begin(job);
   if(!input){result.skipped++;continue;}
   result.submitted++;
   let outcome:SubmissionResult;
   try{outcome=await submit(input);}catch{outcome={status:'unknown'};}
   const finished=await store.finish(input.attemptId,outcome.status,outcome.status==='accepted'?outcome.reference:null);
   if(!finished){
    const current=await store.attempt(input.attemptId);
    // A callback can win the race, but a missing row or conflicting SID is not success.
    if(current?.status!=='accepted'||!current.provider_reference||outcome.status==='failed'||(outcome.status==='accepted'&&outcome.reference!==current.provider_reference)){result.halted='storage';return result;}
    if(outcome.status==='unknown')outcome={status:'accepted',reference:current.provider_reference,deliveryStatus:null,errorCode:null};
   }
   if(outcome.status==='accepted'){
    result.accepted++;
    if(outcome.deliveryStatus&&!await store.record({attemptId:input.attemptId,reference:outcome.reference,status:outcome.deliveryStatus,errorCode:outcome.errorCode})){result.halted='storage';return result;}
   }else if(outcome.status==='failed'){result.rejected++;result.halted='provider-rejected';break;}
   else{result.unknown++;result.halted='provider-unknown';break;}
  }
 }catch(error){result.halted=error instanceof MessageAdmissionError?error.reason:'storage';}
 return result;
}
