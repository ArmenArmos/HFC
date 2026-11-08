import assert from 'node:assert/strict';
// @ts-expect-error Runtime Node supports registerHooks; declarations target Node20.
import {registerHooks} from 'node:module';

// Exercise the real route, job contract and care-alert worker; only the database,
// logging sink and Telegram entry points are replaced. No network or credentials.
const state={
 calls:[] as {name:string;args:Record<string,unknown>}[],factories:0,configured:true,fail:'',reject:false,empty:false,telegramCalls:0,
 clock:1_000_000,rpcCost:0,slowCall:'',messageCount:1,deadlineAt:undefined as number|undefined,finishTimes:[] as number[],
 finishes:[] as Record<string,unknown>[],starts:[] as Record<string,unknown>[],logs:[] as {name:string;outcome:string;report:unknown}[],
};
const retries=['care_alert_assessments_retry','care_alert_zoe_urgent_retry','bp_check_retry','care_alert_bp_flags_retry','zoe_bp_merge_retry','care_alert_escalate_due'];
const messageId='00000000-0000-4000-8000-000000000001',memberId='00000000-0000-4000-8000-000000000002';
const rpc=async(name:string,args:Record<string,unknown>)=>{
 state.calls.push({name,args});
 const remaining=state.deadlineAt===undefined?Infinity:state.deadlineAt-Date.now();
 const cost=!state.slowCall||name===state.slowCall?state.rpcCost:0;
 state.clock+=Math.min(cost,Math.max(0,remaining));
 if(cost>0&&cost>=remaining)throw Error('synthetic_rpc_timeout');
 if(name===state.fail){if(state.reject)return {ok:false,code:'unavailable'};throw Error('synthetic_rpc_failure');}
 if(retries.includes(name))return {ok:true,raised:!state.empty&&name==='care_alert_assessments_retry'?1:0,failed:0};
 if(name==='care_alert_messages_pending')return state.empty?[]:Array.from({length:state.messageCount},(_,i)=>({messageId:i===0?messageId:'00000000-0000-4000-8000-000000000003',memberId,text:null}));
 if(name==='care_alert_screen')return {ok:true,replayed:false};
 assert.fail(`Unexpected RPC: ${name}`);
};
(globalThis as {__careSweepTest?:unknown}).__careSweepTest={state,rpc};
const mod=(src:string)=>'data:text/javascript,'+encodeURIComponent(src);
const S='const {state:s,rpc}=globalThis.__careSweepTest;';
const mocks:Record<string,string>={
 '@/lib/telegram-runtime/server':mod(`${S}
  export function serviceRpc(deadlineAt){s.factories++;s.deadlineAt=deadlineAt;return s.configured?rpc:null;}
  export function runConfiguredTelegramSweep(){s.telegramCalls++;throw Error('Telegram dispatch reached');}
  export function telegramWebhook(){s.telegramCalls++;throw Error('Telegram webhook reached');}`),
 '@/lib/observability/with-logging':mod(`${S}
  export const withRouteLogging=h=>h;
  export function logSweep(name,report,started,outcome){s.logs.push({name,report,outcome});}`),
 '@supabase/supabase-js':mod(`${S}
  export function createClient(){return {rpc(name,args){
   if(name==='job_run_start'){s.starts.push(args);return Promise.resolve({data:'run-1',error:null});}
   if(name==='job_run_finish'){s.finishes.push(args);s.finishTimes.push(Date.now());return Promise.resolve({data:true,error:null});}
   throw Error('Unexpected ledger RPC');
  }};}`),
};
const hook=registerHooks({resolve(spec:string,ctx:object,next:(s:string,c:object)=>object){
 return mocks[spec]?{url:mocks[spec],shortCircuit:true}:next(spec,ctx);
}});
const names=['CRON_SECRET','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','NOREON_CARE_ALERTS_ENABLED','NOREON_TELEGRAM_ENABLED','NOREON_ZOE_URGENT_PLACEHOLDER'];
const old=Object.fromEntries(names.map(k=>[k,process.env[k]]));
const originalFetch=globalThis.fetch;
const originalNow=Date.now;
let networkCalls=0;
globalThis.fetch=(()=>{networkCalls++;throw Error('Network forbidden in care-alert route check');}) as typeof fetch;
const reset=()=>{state.calls.length=0;state.factories=0;state.finishes.length=0;state.finishTimes.length=0;state.starts.length=0;state.logs.length=0;state.fail='';state.reject=false;state.empty=false;state.configured=true;state.clock=1_000_000;state.rpcCost=0;state.slowCall='';state.messageCount=1;state.deadlineAt=undefined;};
try{
 Date.now=()=>state.clock;
 Object.assign(process.env,{
  CRON_SECRET:'fictional-cron-secret',NEXT_PUBLIC_SUPABASE_URL:'https://fictional.supabase.test',SUPABASE_SERVICE_ROLE_KEY:'fictional-service-key',
  NOREON_CARE_ALERTS_ENABLED:'true',NOREON_TELEGRAM_ENABLED:'false',NOREON_ZOE_URGENT_PLACEHOLDER:'false',
 });
 const route=await import('@/app/api/internal/care-alerts/sweep/route');
 const {telegramEnabled}=await import('@/lib/telegram-runtime/config');
 assert.equal(telegramEnabled(),false,'the previously failing scenario has Telegram off');
 assert.equal(route.runtime,'nodejs');assert.equal(route.maxDuration,60);
 const req=(auth:string|null='Bearer fictional-cron-secret')=>new Request('https://app.example.com/api/internal/care-alerts/sweep',{
  headers:{...(auth===null?{}:{authorization:auth}),'user-agent':'vercel-cron/1.0'},
 });
 for(const auth of [null,'Bearer wrong-secret','Bearer fictional-cron-secreX']){
  const res=await route.GET(req(auth));assert.equal(res.status,404);assert.equal(res.headers.get('cache-control'),'no-store');
 }
 delete process.env.CRON_SECRET;
 assert.equal((await route.GET(req())).status,404,'a missing secret never authorizes');
 process.env.CRON_SECRET='fictional-cron-secret';
 assert.equal(state.factories,0);assert.equal(state.calls.length,0);assert.deepEqual(state.starts,[]);

 process.env.NOREON_CARE_ALERTS_ENABLED='false';
 let res=await route.GET(req());
 assert.equal(res.status,200);assert.deepEqual(await res.json(),{state:'disabled'});
 assert.equal(state.factories,0,'disabled alerts do not create a service RPC');assert.equal(state.calls.length,0);
 assert.equal(state.finishes.at(-1)?.p_outcome,'skipped');
 assert.deepEqual(state.logs.at(-1),{name:'care_alert_sweep',report:{state:'disabled'},outcome:'skipped'});

 process.env.NOREON_CARE_ALERTS_ENABLED='true';reset();
 res=await route.GET(req());
 assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
 assert.deepEqual(await res.json(),{screened:2,escalated:1,failed:0});
 assert.equal(state.factories,1);
 assert.deepEqual(state.calls.map(c=>c.name),['care_alert_escalate_due',...retries.slice(0,-1),'care_alert_messages_pending','care_alert_screen'],'escalation precedes retries and screening with Telegram off');
 assert.equal(state.deadlineAt,1_050_000,'the job deadline reaches the RPC client');
 assert.deepEqual(state.calls.find(c=>c.name==='care_alert_escalate_due')?.args,{});
 assert.equal(state.calls.at(-1)?.args.p_source_ref,messageId,'the pending member message is screened');
 assert.deepEqual(state.starts,[{p_job:'care_alert_sweep',p_trigger:'cron',p_max_seconds:60}]);
 assert.equal(state.finishes.at(-1)?.p_outcome,'ok');assert.equal(state.finishes.at(-1)?.p_error_code,null);
 assert.deepEqual(state.logs.at(-1),{name:'care_alert_sweep',report:{screened:2,escalated:1,failed:0},outcome:'ok'});

 // Every swallowed worker exception must survive as a failed count and job outcome.
 // Also exercise an RPC's explicit refusal, rather than only thrown exceptions.
 for(const fail of [...retries,'care_alert_messages_pending','care_alert_screen']){
  for(const reject of [false,true]){
   reset();state.fail=fail;state.reject=reject;
   res=await route.GET(req());
   const body=await res.json() as {failed:number};
   assert.equal(body.failed,1,`${fail} ${reject?'refusal':'exception'} is counted`);
   assert.equal(state.finishes.at(-1)?.p_outcome,'partial');
   assert.equal(state.finishes.at(-1)?.p_error_code,'care_alert_items_failed');
   assert.equal(state.logs.at(-1)?.outcome,'error');
   assert.ok(state.calls.some(c=>c.name==='care_alert_messages_pending'),'retry failures do not prevent message screening');
  }
 }

 reset();state.empty=true;
 res=await route.GET(req());assert.equal(res.status,200);
 assert.deepEqual(await res.json(),{screened:0,escalated:0,failed:0});
 assert.equal(state.finishes.at(-1)?.p_outcome,'ok','an idle sweep succeeds');
 reset();state.empty=true;state.fail='care_alert_escalate_due';
 res=await route.GET(req());assert.equal(res.status,503);
 assert.deepEqual(await res.json(),{screened:0,escalated:0,failed:1});
 assert.equal(state.finishes.at(-1)?.p_outcome,'error','a failure with no completed items is an error');
 assert.equal(state.finishes.at(-1)?.p_error_code,'care_alert_items_failed');

 // Five slow RPCs consume the 50 s work budget, leaving the contract's 10 s
 // margin for recording failure. Escalation must not wait behind the retries.
 reset();state.rpcCost=12_000;
 res=await route.GET(req());
 assert.deepEqual(await res.json(),{screened:1,escalated:1,failed:3});
 assert.deepEqual(state.calls.map(c=>c.name),['care_alert_escalate_due','care_alert_assessments_retry','care_alert_zoe_urgent_retry','bp_check_retry','care_alert_bp_flags_retry']);
 assert.equal(state.finishes.at(-1)?.p_outcome,'partial');
 assert.equal(state.finishes.at(-1)?.p_error_code,'care_alert_items_failed');
 assert.deepEqual(state.finishes.at(-1)?.p_counts,{screened:1,escalated:1,failed:3},'timeout and unstarted steps reach the ledger');
 assert.equal(state.finishTimes.at(-1),1_050_000,'failure is recorded before the 60 s termination');

 // Less than a second remaining: do not start another step even before expiry.
 reset();state.rpcCost=49_500;
 res=await route.GET(req());assert.equal(res.status,503);
 assert.deepEqual(await res.json(),{screened:0,escalated:0,failed:6});
 assert.deepEqual(state.calls.map(c=>c.name),['care_alert_escalate_due']);
 assert.equal(state.finishes.at(-1)?.p_outcome,'error');
 assert.equal(state.finishTimes.at(-1),1_049_500);

 // A fetched batch is bounded too: don't start the second message after a slow first one.
 reset();state.rpcCost=49_500;state.slowCall='care_alert_screen';state.messageCount=2;
 res=await route.GET(req());assert.equal(res.status,200);
 assert.deepEqual(await res.json(),{screened:2,escalated:1,failed:1});
 assert.equal(state.calls.filter(c=>c.name==='care_alert_screen').length,1);
 assert.equal(state.finishes.at(-1)?.p_outcome,'partial');
 assert.deepEqual(state.finishes.at(-1)?.p_counts,{screened:2,escalated:1,failed:1});
 assert.equal(state.finishTimes.at(-1),1_049_500);

 reset();state.configured=false;
 res=await route.GET(req());assert.equal(res.status,503);
 assert.deepEqual(await res.json(),{error:'care_alert_sweep_failed'});
 assert.equal(state.finishes.at(-1)?.p_outcome,'error');assert.equal(state.calls.length,0);
 assert.equal(state.telegramCalls,0,'no Telegram entry point is called, even on failure');
 assert.equal(networkCalls,0,'no network or Telegram sends');
 console.log('Care-alert sweep route: secret and flag gates, escalation first, bounded slow retries and message screening, deadline failures recorded, no Telegram sends.');
}finally{
 hook.deregister();delete (globalThis as {__careSweepTest?:unknown}).__careSweepTest;
 globalThis.fetch=originalFetch;
 Date.now=originalNow;
 for(const [k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
}
