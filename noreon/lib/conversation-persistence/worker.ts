import 'server-only';
import type {z} from 'zod';
import {observeResultSchema,outcomeResultSchema,outcomeSchema,type claimSchema,type envelopeSchema,type ObserveResult,type OutcomeResult} from './contracts';
type Envelope=z.infer<typeof envelopeSchema>;
type Observation=z.infer<typeof outcomeSchema>;
type Port={claim(deliveryId:string,attemptId:string):Promise<z.infer<typeof claimSchema>>;observe?(attemptId:string,result:unknown):Promise<ObserveResult>;outcome(attemptId:string,result:unknown):Promise<OutcomeResult>};
/** Commits the observation on its own, then applies it; both are retried, neither resends. */
export type Recorder={observe?:(attemptId:string,observation:Observation)=>Promise<unknown>;outcome:(attemptId:string,observation:Observation)=>Promise<unknown>};
type Transport={id:string;accountRef?:string;deliver(envelope:Envelope):Promise<unknown>};
export type DispatchResult=
 |{state:'not_invoked';reason:string}
 |{state:'claim_unconfirmed';attemptId:string}
 |{state:'outcome_recorded';attemptId:string;result:'recorded'|'duplicate'|'late'|'conflict'}
 |{state:'outcome_rejected';attemptId:string;code:string}
 |{state:'observation_retained';attemptId:string;observation:Observation}
 |{state:'recording_unconfirmed';attemptId:string;observation:Observation};

/**
 * What the transport reported, as an immutable observation the database accepts.
 * `unsupported` means nothing was sent; anything malformed is unknown, never success.
 */
export function observationFrom(result:unknown):Observation{
 if(result&&typeof result==='object'&&'kind'in result&&result.kind==='unsupported')return Object.freeze({kind:'definitely_failed',evidence:'not_sent_unsupported_payload'});
 const parsed=outcomeSchema.safeParse(result);
 return Object.freeze(parsed.success?parsed.data:{kind:'unknown',reason:'transport_outcome_malformed'});
}

const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const recorderFor=(repo:Port):Recorder=>({...(repo.observe?{observe:(a:string,o:Observation)=>repo.observe!(a,o)}:{}),outcome:(a,o)=>repo.outcome(a,o)});

/**
 * Records one observation (CR2). First the observation is committed on its own
 * (delivery_observe), so a later cancelled or failed outcome call cannot lose it;
 * then it is applied. Only recording is retried, always with the same immutable
 * value; the database answers duplicate for an already-applied identical
 * observation. `observation_retained` is reported only when retention was
 * confirmed; otherwise `recording_unconfirmed`. The stale reconciler applies
 * whatever was retained, or records unknown. Nothing is ever resent.
 */
export async function recordObservation(recorder:Recorder,attemptId:string,observation:Observation,tries=3,backoffMs=400):Promise<DispatchResult>{
 let retained=false;
 if(recorder.observe){
  for(let n=0;n<tries;n++){
   let kept:ObserveResult|undefined;
   try{kept=observeResultSchema.parse(await recorder.observe(attemptId,observation));}catch{kept=undefined;}
   if(kept?.ok){if(kept.result==='conflict')return {state:'outcome_recorded',attemptId,result:'conflict'};retained=true;break;}
   if(kept&&!kept.retryable)return {state:'outcome_rejected',attemptId,code:kept.code};
   if(n<tries-1)await pause(backoffMs*(n+1));
  }
  // Never project an observation that was not durably retained first: the stale
  // reconciler records unknown, which is truthful when nothing reached the database.
  if(!retained)return {state:'recording_unconfirmed',attemptId,observation};
 }
 for(let n=0;n<tries;n++){
  let result:OutcomeResult|undefined;
  try{result=outcomeResultSchema.parse(await recorder.outcome(attemptId,observation));}catch{result=undefined;}
  if(result?.ok)return {state:'outcome_recorded',attemptId,result:result.result};
  if(result&&!result.retryable)return {state:'outcome_rejected',attemptId,code:result.code};
  if(n<tries-1)await pause(backoffMs*(n+1));
 }
 return retained?{state:'observation_retained',attemptId,observation}:{state:'recording_unconfirmed',attemptId,observation};
}

/** A fresh acknowledged SQL claim is the only invocation authority. One claim, at most one deliver, no automatic resend. */
export async function dispatchConversation(repo:Port,transport:Transport,deliveryId:string,attemptId:string,options:{tries?:number;backoffMs?:number}={}):Promise<DispatchResult>{
 let claim;try{claim=await repo.claim(deliveryId,attemptId);}catch{
  // The claim may have committed with its response lost; if so it stays `sending`
  // and the stale reconciler records unknown. It is never delivered from here.
  return {state:'claim_unconfirmed',attemptId};
 }
 if(!claim.ok)return {state:'not_invoked',reason:claim.code};
 if(claim.adapter!==transport.id||(transport.accountRef!==undefined&&claim.accountRef!==transport.accountRef)){
  // Nothing was sent; record that definitively, with the same recording retries.
  const recorded=await recordObservation(recorderFor(repo),attemptId,Object.freeze({kind:'definitely_failed',evidence:'Adapter unavailable before invocation'}),options.tries,options.backoffMs);
  return recorded.state==='outcome_recorded'?{state:'not_invoked',reason:'adapter_mismatch'}:recorded;
 }
 let result:unknown;
 try{result=await transport.deliver(Object.freeze({...claim.envelope,approvedBy:Object.freeze({...claim.envelope.approvedBy})}));}
 catch{result={kind:'unknown',reason:'Transport invocation returned no conclusive acknowledgement'};}
 return recordObservation(recorderFor(repo),attemptId,observationFrom(result),options.tries,options.backoffMs);
}
