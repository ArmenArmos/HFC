import assert from 'node:assert/strict';
// @ts-expect-error Runtime Node supports registerHooks; declarations target Node20.
import {registerHooks} from 'node:module';
import {labOutcome,telegramOutcome} from '@/lib/jobs/summary';

// Outcome mapping: a handler that ran is not a job whose items succeeded (review JOB-R2).
assert.equal(labOutcome({state:'reading_off'}),'skipped');
assert.equal(labOutcome({claimed:2,finished:{read:2},failed:0}),'ok');
assert.equal(labOutcome({claimed:1,finished:{},failed:1}),'error');
assert.equal(labOutcome({claimed:2,finished:{read:1},failed:1}),'partial');
assert.equal(telegramOutcome({inbox:{processed:2,retry:0},system:{outcome_recorded:3},auth:{},replies:{}}),'ok');
assert.equal(telegramOutcome({inbox:{processed:0,retry:0},system:{},auth:{},replies:{}}),'ok','an idle sweep is fine');
assert.equal(telegramOutcome({inbox:{processed:1,retry:1},system:{},auth:{},replies:{}}),'partial');
assert.equal(telegramOutcome({inbox:{processed:0,retry:0},system:{outcome_unrecorded:1,claim_unconfirmed:1},auth:{},replies:{}}),'error');
assert.equal(telegramOutcome({inbox:{processed:0,retry:0},system:{outcome_recorded:1,outcome_rejected:1},auth:{},replies:{},screening:{failed:0}}),'partial');
console.log('Job outcomes follow item results: lab failures, Telegram retries and unrecorded sends are not "ok".');

// The exported route handlers, with the workers replaced and a virtual clock.
const state={clock:0,zoeCalls:0,zoePass:{claimed:1,finished:{chatted:1},failed:0} as {claimed:number;finished:Record<string,number>;failed:number},zoeCost:140_000,
 sweep:{inbox:{processed:0,retry:0},reconciled:0,sending:'on',system:{outcome_recorded:1},auth:{},replies:{}} as unknown,sweeps:0,
 lab:{claimed:1,finished:{},failed:1} as unknown,dispatch:{halted:'provider-unknown'} as unknown,finishes:[] as string[]};
(globalThis as {__jobTest?:unknown}).__jobTest=state;
const mod=(src:string)=>'data:text/javascript,'+encodeURIComponent(src);
const S='const s=globalThis.__jobTest;';
const mocks:Record<string,string>={
 '@/lib/zoe/server':mod(`${S}export const zoePipelineEnabled=()=>true;export const zoeServiceRpc=()=>async()=>null;export async function runUnreadUrgentPass(){return {sent:0,checked:0,failed:0};}export async function runZoeSweep(){s.zoeCalls++;s.clock+=s.zoeCost;return s.zoeCalls>3?{claimed:0,finished:{},failed:0}:s.zoePass;}`),
 '@/lib/telegram-runtime/config':mod('export const telegramEnabled=()=>true;'),
 '@/lib/telegram-runtime/server':mod(`${S}export async function runConfiguredTelegramSweep(o){s.sweeps++;void o;return s.sweep;}export async function runConfiguredAuthCleanup(){return null;}export async function runConfiguredProgrammeRun(){return null;}export async function runConfiguredLdlResponseSweep(){return null;}`),
 '@/lib/lab-ai/server':mod(`${S}export async function runConfiguredLabSweep(){return s.lab;}`),
 '@/lib/messaging/dispatch':mod(`${S}export async function dispatchMessages(){return s.dispatch;}`),
 // V3 is off here: the new service dependency must not be called by the legacy job path.
 '@/lib/zoe-chat-actions/server':mod('export function serviceRpc(){throw Error("V3 service called while disabled");}'),
 // The real ledger client path (serviceJobLedger) with the database replaced: records what each route finishes with.
 '@supabase/supabase-js':mod(`${S}export function createClient(){return {rpc(name,args){const p=Promise.resolve(name==='job_run_start'?{data:'00000000-0000-4000-8000-000000000001',error:null}:(s.finishes.push(args.p_job??(args.p_outcome+':'+args.p_error_code)),{data:true,error:null}));p.abortSignal=()=>p;return p;}};}`),
};
const hook=registerHooks({resolve(spec:string,ctx:object,next:(s:string,c:object)=>object){return mocks[spec]?{url:mocks[spec],shortCircuit:true}:next(spec,ctx);}});
const realNow=Date.now;
const names=['CRON_SECRET','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','NOREON_MESSAGE_DELIVERY_ENABLED','NOREON_MESSAGE_RECOVERY_READY','NOREON_ZOE_APP_V3'];
const old=Object.fromEntries(names.map(k=>[k,process.env[k]]));
try{
 Object.assign(process.env,{CRON_SECRET:'fictional-cron-secret',NOREON_MESSAGE_DELIVERY_ENABLED:'true',NOREON_MESSAGE_RECOVERY_READY:'true',NOREON_ZOE_APP_V3:'false'});
 Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'https://fictional.supabase.test',SUPABASE_SERVICE_ROLE_KEY:'fictional-service-key'});
 Date.now=()=>1_000_000+state.clock;
 const req=(path:string)=>new Request(`https://app.example.com${path}`,{headers:{authorization:'Bearer fictional-cron-secret','user-agent':'vercel-cron/1.0'}});
 const zoe=await import('@/app/api/internal/zoe/run/route');
 // JOB-R1: each run costs 140 s of a 300 s limit (deadline at 290 s): claims at 0 and 140 s (150 s left);
 // at 280 s only 10 s are left, so the pass stops. zoe/run never runs a Telegram sweep (no unbounded send loop).
 let res=await zoe.GET(req('/api/internal/zoe/run'));
 const body=await res.json() as {claimed:number;stoppedForTime:boolean};
 assert.equal(state.zoeCalls,2,'no claim without time for a whole run');
 assert.equal(body.stoppedForTime,true);
 assert.ok(state.clock<=290_000,`finished inside the deadline (${state.clock} ms)`);
 Object.assign(state,{clock:0,zoeCalls:0,zoeCost:5000});
 res=await zoe.GET(req('/api/internal/zoe/run'));
 assert.equal(res.status,200);assert.equal(state.zoeCalls,4,'fast runs: claims until the queue is empty');
 Object.assign(state,{clock:0,zoeCalls:0,zoePass:{claimed:1,finished:{},failed:1}});
 await zoe.GET(req('/api/internal/zoe/run'));
 assert.equal(state.sweeps,0,'zoe/run sends nothing itself');
 assert.deepEqual(state.finishes,['ok:null','ok:null','error:zoe_job_failed'],'zoe/run records its outcomes');
 // JOB-R2 through the real handlers: failures are recorded as error or partial, not ok.
 state.finishes.length=0;
 const lab=await import('@/app/api/internal/lab-ai/route');
 assert.equal((await lab.GET(req('/api/internal/lab-ai'))).status,200);
 state.lab={claimed:2,finished:{read:1},failed:1};await lab.GET(req('/api/internal/lab-ai'));
 state.lab={state:'reading_off'};await lab.GET(req('/api/internal/lab-ai'));
 const dispatch=await import('@/app/api/internal/message-dispatch/route');
 assert.equal((await dispatch.GET(req('/api/internal/message-dispatch'))).status,503,'provider-unknown halt is a 503');
 state.dispatch={halted:'budget'};assert.equal((await dispatch.GET(req('/api/internal/message-dispatch'))).status,200);
 const tg=await import('@/app/api/internal/telegram/dispatch/route');
 state.sweep={inbox:{processed:1,retry:1},reconciled:0,sending:'on',system:{},auth:{},replies:{}};
 assert.equal((await tg.GET(req('/api/internal/telegram/dispatch'))).status,200);
 state.sweep={inbox:{processed:0,retry:0},reconciled:0,sending:'on',system:{outcome_recorded:2},auth:{},replies:{}};
 await tg.GET(req('/api/internal/telegram/dispatch'));
 assert.deepEqual(state.finishes,['error:lab_read_failed','partial:lab_read_failed','skipped:null','error:message_halted_provider_unknown','ok:null','partial:telegram_items_failed','ok:null']);
 console.log('zoe/run claims only with time for a whole run and sends nothing itself; failed items are recorded as partial or error.');
}finally{
 Date.now=realNow;hook.deregister();
 for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
}
