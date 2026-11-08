import {expect,job,runPipeline,type EvalCase} from './harness';
import {DEFAULT_ROUTE_CONFIG} from './routing-cases';
import {createGatewayProvider} from '../gateway';
import {createFakeProvider,type ProviderRequest,type ProviderResult,type ZoeProvider} from '../provider';
import {JUDGE_FLAGS,JUDGE_TIMEOUT_MS} from '../reply-check';
import {RD_PLANS} from './reply-draft-cases';
import {runZoePasses} from '../passes';
import {HEALTH_CALL_TIMEOUT_MAX_MS,HEALTH_RUN_BUDGET_MS,CALL_TIMEOUT_MAX_MS,JUDGE_MIN_MS,MIN_CALL_MS,RETRY_CUTOFF_MS,RUN_BUDGET_MS,RUN_WORST_MS,type ZoeJob,type ZoeRouting} from '../pipeline';

/**
 * F2, the per-run time budget (TB-*): a run aims to finish within RUN_BUDGET_MS, judging included, well inside the
 * zoe/run cron's 140 s per run; the webhook (60 s) admits a second run only when a whole run still fits. Past
 * RETRY_CUTOFF_MS no retry, fallback, schema retry or structured draft starts; each speaker call gets what is left
 * after the judge's 10 s (5 to 20 s), the judge the rest (3 to 10 s). A clock the rows advance on every provider
 * call stands in for slow models. A run killed anyway is covered by the held-ack release
 * and the app's fixed ack (zoe_held_ack_release), so no fallback text is added here.
 */
const STAGING={NOREON_ZOE_TEST_LEXICON:'false',NOREON_PRELAUNCH_STAGING:'true'};
const ctx=()=>({enabled:true,doctorName:'Dr Anna Petrosyan',answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:'en' as 'en'|'hy'|null});
const conv=(texts:string|string[],extra:Partial<ZoeJob>={})=>job(texts,{displayName:'Richard Smith',directAnswers:true,conversation:ctx(),...extra});
const ids={responseModel:'stub',responseId:'stub'};
const chatRaw=(reply:string)=>JSON.stringify({reply,category:'greeting',language:'en'});
/** A clock that each slow call moves forward by stepMs. */
const clock=()=>{const c={t:1_000_000,now:()=>c.t};return c;};
/** A speaker whose calls each take stepMs on the clock and return these results in turn (the last repeats). */
const slow=(c:{t:number},stepMs:number,results:ProviderResult[]):ZoeProvider&{seen:ProviderRequest[]}=>{const base=createFakeProvider();const seen:ProviderRequest[]=[];
 return {...base,seen,async complete(r:ProviderRequest){seen.push(r);c.t+=stepMs;return results[Math.min(seen.length-1,results.length-1)]!;}};};
const timeout:ProviderResult={kind:'error',errorClass:'timeout',usage:null};
const ok=(raw:string):ProviderResult=>({kind:'ok',raw,finishReason:'stop',usage:{inputTokens:800,outputTokens:60},...ids});
const what=(r:{outcome:string;reason:string})=>`${r.outcome}/${r.reason}`;
const budgetEvent=(r:{events:{name:string;attributes?:Record<string,unknown>}[]})=>r.events.find(e=>e.name==='zoe.budget');

export function budgetPlumbingCases():EvalCase[]{
 return [
  {id:'TB-constants',level:'MUST',title:'The budget fits the deadlines: the cut-off is before the budget, the budget well inside the webhook\'s 60 s, the judge shorter than a speaker call',check:()=>{
   // A call started at the cut-off and the judge after it still end inside the budget; a whole run (two judge calls
   // at their floor) inside RUN_WORST_MS; a first webhook run and its dispatch inside 60 s.
   expect(RETRY_CUTOFF_MS+MIN_CALL_MS+JUDGE_TIMEOUT_MS<=RUN_BUDGET_MS&&RUN_BUDGET_MS<=30_000&&RUN_BUDGET_MS+2*JUDGE_MIN_MS<=RUN_WORST_MS&&RUN_WORST_MS<=45_000&&HEALTH_RUN_BUDGET_MS+2*JUDGE_MIN_MS<=RUN_WORST_MS&&HEALTH_CALL_TIMEOUT_MAX_MS+JUDGE_TIMEOUT_MS<=HEALTH_RUN_BUDGET_MS
    &&CALL_TIMEOUT_MAX_MS+JUDGE_TIMEOUT_MS<=RUN_BUDGET_MS,`${RETRY_CUTOFF_MS}/${RUN_BUDGET_MS}/${RUN_WORST_MS}/${CALL_TIMEOUT_MAX_MS}/${JUDGE_TIMEOUT_MS}`);
  }},
  {id:'TB-retry-before-cutoff',level:'MUST',title:'Control: a timed-out call that took 1 s is retried; each call leaves the judge its 10 s (20 s, then 19 s)',check:async()=>{
   const c=clock();const p=slow(c,1_000,[timeout,ok(chatRaw('Hello [NAME], good to hear from you.'))]);
   const r=await runPipeline(conv('hello'),{provider:p,directAnswers:true,env:STAGING,now:c.now});
   expect(p.seen.length===2&&!budgetEvent(r)&&p.seen.map(q=>q.timeoutMs).join()==='20000,19000',`${p.seen.length} calls ${p.seen.map(q=>q.timeoutMs)} ${budgetEvent(r)?.name}`);
  }},
  {id:'TB-retry-skipped-after-cutoff',level:'MUST',title:'A timed-out call that ran past the cut-off is not retried: one call, a zoe.budget event, and the member still gets the fixed reply',check:async()=>{
   const c=clock();const p=slow(c,RETRY_CUTOFF_MS+1_000,[timeout,ok(chatRaw('Hello'))]);
   const r=await runPipeline(conv('hello'),{provider:p,directAnswers:true,env:STAGING,now:c.now});
   const e=budgetEvent(r);
   expect(p.seen.length===1&&e?.attributes?.['noreon.zoe.budget.skipped']==='provider_attempt'&&r.finish!==null,`${p.seen.length} calls, event ${JSON.stringify(e?.attributes)}, ${r.outcome}/${r.reason}`);
  }},
  {id:'TB-call-timeout-shrinks',level:'MUST',title:'Each speaker call gets what is left after the judge\'s share: 20 s at the start, 12 s after 8 s, 5 s (not 3 s) after 17 s',check:async()=>{
   const open={budgetMs:RUN_BUDGET_MS,cutoffMs:RUN_BUDGET_MS};
   const c=clock();const p=slow(c,8_000,[timeout,ok(chatRaw('Hello'))]);
   await runPipeline(conv('hello'),{provider:p,directAnswers:true,env:STAGING,now:c.now,timeBudget:open});
   const c2=clock();const p2=slow(c2,17_000,[timeout,ok(chatRaw('Hello'))]);
   await runPipeline(conv('hello'),{provider:p2,directAnswers:true,env:STAGING,now:c2.now,timeBudget:open});
   expect(p.seen.map(q=>q.timeoutMs).join()===`${CALL_TIMEOUT_MAX_MS},12000`&&p2.seen[1]?.timeoutMs===MIN_CALL_MS,`${p.seen.map(q=>q.timeoutMs)} / ${p2.seen.map(q=>q.timeoutMs)}`);
  }},
  {id:'TB-fallback-skipped-after-cutoff',level:'MUST',title:'With a tier fallback, a primary that failed past the cut-off does not start the fallback model',check:async()=>{
   const c=clock();const asked:string[]=[];
   const make=()=>slow(c,RETRY_CUTOFF_MS+1_000,[timeout]);
   const routing:ZoeRouting={config:DEFAULT_ROUTE_CONFIG,providerFor:m=>{asked.push(m.id);const p=make();return {...p,requestModel:m.id,complete:async(q:ProviderRequest)=>{asked.push(`call:${m.id}`);return p.complete(q);}};}};
   const r=await runPipeline(conv('hello'),{routing,directAnswers:true,env:STAGING,now:c.now});
   const calls=asked.filter(a=>a.startsWith('call:'));
   expect(calls.length===1&&!r.finish?.fallbackUsed&&budgetEvent(r)!==undefined,`calls ${calls} fallback ${r.finish?.fallbackUsed} ${r.outcome}/${r.reason}`);
  }},
  {id:'TB-fallback-before-cutoff',level:'MUST',title:'Control: a primary that failed quickly still hands over to the fallback model',check:async()=>{
   const c=clock();const asked:string[]=[];
   const routing:ZoeRouting={config:DEFAULT_ROUTE_CONFIG,providerFor:m=>{const fb=m.id===DEFAULT_ROUTE_CONFIG.tiers.low?.fallback?.id;const p=slow(c,500,fb?[ok(chatRaw('Hello [NAME].'))]:[timeout]);return {...p,requestModel:m.id,complete:async(q:ProviderRequest)=>{asked.push(m.id);return p.complete(q);}};}};
   const r=await runPipeline(conv('hello'),{routing,directAnswers:true,env:STAGING,now:c.now});
   expect(r.finish?.fallbackUsed===true&&!budgetEvent(r),`asked ${asked} fallback ${r.finish?.fallbackUsed} ${r.outcome}/${r.reason}`);
  }},
  {id:'TB-judge-timeout',level:'MUST',title:'Every judge request carries the 10 s judge limit',check:async()=>{
   const r=await runPipeline(conv('hello'),{directAnswers:true,env:STAGING,fixtureRaw:chatRaw('Hello [NAME], good to hear from you.')});
   expect(r.judgeCalls.length>0&&r.judgeCalls.every(q=>q.timeoutMs===JUDGE_TIMEOUT_MS),`${r.judgeCalls.map(q=>q.timeoutMs)}`);
  }},
  {id:'TB-judge-gets-the-rest',level:'MUST',title:'The judge gets what is left of the budget: 5 s after a 25 s speaker call, 3 s (its floor) after 29 s',check:async()=>{
   const got:number[]=[];
   for(const step of [25_000,29_000]){
    const c=clock();const p=slow(c,step,[ok(chatRaw('Hello [NAME], good to hear from you.'))]);
    const r=await runPipeline(conv('hello'),{provider:p,directAnswers:true,env:STAGING,now:c.now});
    got.push(...r.judgeCalls.map(q=>q.timeoutMs??-1));
   }
   expect(got.join()==='5000,3000',`${got}`);
  }},
  {id:'TB-judge-retry-share',level:'MUST',title:'A judge retry after a malformed verdict gets what is left (6 s after 24 s), and is skipped when under 3 s is left (the reply fails closed to the fixed wording)',check:async()=>{
   const run=async(judgeStepMs:number)=>{const c=clock();const p=slow(c,20_000,[ok(chatRaw('Hello [NAME], good to hear from you.'))]);let n=0;
    const judge:ZoeProvider={providerName:'noreon.fake',requestModel:'stub/judge-tb',region:'local',local:true,pricing:{inputUsdPerMTok:1,outputUsdPerMTok:5,label:'stub'},
     async complete(){c.t+=judgeStepMs;n++;return n===1?ok('not a verdict'):ok(JSON.stringify({...Object.fromEntries(JUDGE_FLAGS.map(f=>[f,false])),reason:'stub'}));}};
    return runPipeline(conv('hello'),{provider:p,directAnswers:true,env:STAGING,now:c.now,judge});};
   const roomy=await run(4_000),tight=await run(8_000);
   expect(roomy.judgeCalls.map(q=>q.timeoutMs).join()==='10000,6000'&&roomy.finish?.chat?.source==='model',`roomy ${roomy.judgeCalls.map(q=>q.timeoutMs)} ${what(roomy)}`);
   expect(tight.judgeCalls.length===1&&tight.finish?.chat?.source!=='model',`tight ${tight.judgeCalls.map(q=>q.timeoutMs)} ${what(tight)}`);
  }},
  {id:'TB-draft-skipped-after-cutoff',level:'MUST',title:'Past the cut-off the structured draft call does not start: the free draft stays, one zoe.budget event (Codex F2-02)',check:async()=>{
   const slowFake=(stepMs:number)=>{const c=clock();const base=createFakeProvider();return {c,p:{...base,complete:async(q:ProviderRequest)=>{c.t+=stepMs;return base.complete(q);}}};};
   const store=()=>({records:[]});
   const late=slowFake(RETRY_CUTOFF_MS+1_000);
   const r=await runPipeline(job('How often should I measure my blood pressure?',{replyDraft:{enabled:true,plan:RD_PLANS.en}}),{provider:late.p,replyDrafts:store(),now:late.c.now});
   const quick=slowFake(1_000);
   const q=await runPipeline(job('How often should I measure my blood pressure?',{replyDraft:{enabled:true,plan:RD_PLANS.en}}),{provider:quick.p,replyDrafts:store(),now:quick.c.now});
   const e=budgetEvent(r);
   expect(!r.providerCalls.some(x=>x.purpose==='reply_draft')&&r.reason==='draft_passed_guards'&&e?.attributes?.['noreon.zoe.budget.skipped']==='reply_draft'
    &&r.events.filter(x=>x.name==='zoe.budget').length===1&&q.reason==='structured_draft_passed_guards',`late ${r.reason} ${r.providerCalls.map(x=>x.purpose)} ${JSON.stringify(e?.attributes)}; quick ${q.reason}`);
  }},
  {id:'TB-webhook-admission',level:'MUST',title:'The webhook starts a run only if it ends before 48 s from the request: one after 2 s of inbox work, a second only after a 1 s run (RUN_WORST_MS 44 s since health answers), none after 25 s of inbox work; it stops when nothing is claimed',check:async()=>{
   const sweep=async(beforeMs:number,stepMs:number,claims:number[])=>{const c=clock();const deadlineAt=c.t+48_000;c.t+=beforeMs;let i=0;
    const r=await runZoePasses(async()=>{c.t+=stepMs;const n=claims[Math.min(i++,claims.length-1)]!;return {claimed:n,finished:(n?{chatted:n}:{}) as Record<string,number>,failed:0};},{limit:2,deadlineAt,now:c.now});
    return {r,passes:i};};
   const slowRun=await sweep(2_000,10_000,[1,1]),quickRun=await sweep(2_000,1_000,[1,1]),lateStart=await sweep(25_000,3_000,[1,1]),empty=await sweep(0,1_000,[0,1]);
   expect(slowRun.passes===1&&slowRun.r.stoppedForTime&&quickRun.passes===2&&quickRun.r.finished.chatted===2&&lateStart.passes===0&&lateStart.r.stoppedForTime&&empty.passes===1&&!empty.r.stoppedForTime,
    `slow ${slowRun.passes} quick ${quickRun.passes} late ${lateStart.passes} empty ${empty.passes}`);
  }},
  {id:'TB-slow-reservation',level:'MUST',title:'A reservation that took past the cut-off starts no model call: the member gets the fixed reply, one zoe.budget event',check:async()=>{
   const c=clock();const p=slow(c,1_000,[ok(chatRaw('Hello'))]);
   const r=await runPipeline(conv('hello'),{provider:p,directAnswers:true,env:STAGING,now:c.now,onReserve:()=>{c.t+=RETRY_CUTOFF_MS+1_000;}});
   expect(p.seen.length===0&&budgetEvent(r)?.attributes?.['noreon.zoe.budget.skipped']==='provider_attempt'&&r.finish!==null,`${p.seen.length} calls ${r.outcome}/${r.reason}`);
  }},
  {id:'TB-gateway-honours-request',level:'MUST',title:'The Gateway adapter aborts at the request\'s own limit when it is shorter than its default, and reports a timeout',check:async()=>{
   let signal:AbortSignal|undefined;
   const g=createGatewayProvider({id:'anthropic/claude-haiku-5.5',inputUsdPerMTok:0.1,outputUsdPerMTok:0.5},{env:{NOREON_ZOE_MODEL_CALLS_ENABLED:'true'},
    generate:((a:{abortSignal?:AbortSignal})=>{signal=a.abortSignal;return new Promise((_,rej)=>a.abortSignal?.addEventListener('abort',()=>rej(new Error('aborted'))));}) as never});
   const started=Date.now();
   const res=await g.complete({purpose:'conversation',promptVersion:'t',system:'s',memberBlock:'m',replyLanguage:'en',maxOutputTokens:10,timeoutMs:50});
   expect(res.kind==='error'&&res.errorClass==='timeout'&&signal?.aborted===true&&Date.now()-started<2_000,`${JSON.stringify(res)} after ${Date.now()-started} ms`);
  }},
 ];
}
