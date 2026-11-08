import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {jobCounts,jobErrorCode,outcomeFromFailures} from '@/lib/jobs/summary';
import {readJobsView,jobOverdue} from '@/lib/jobs/admin-view';
import {cronAuthorized,runJob,JOB_DEADLINE_MARGIN_SEC,type JobLedger} from '@/lib/jobs/contract';
import {RUN_WORST_MS} from '@/lib/zoe/pipeline';

// Counts keep numbers and short state words only: ids, text and arrays never reach the ledger.
assert.deepEqual(jobCounts({claimed:2,finished:{chatted:1,draft_proposed:1},failed:0,sending:'on',reminders:'queued 3',
 runId:'0b7c6b1e-8f3a-4c1d-9e2f-3a4b5c6d7e8f',text:'my chest hurts since this morning, please call',name:'Ani Petrosyan',phone:'+37491234567',ids:['a'],nested:{deep:{deeper:{x:1}}}}),
 {claimed:2,finished:{chatted:1,draft_proposed:1},failed:0,sending:'on',reminders:'queued 3'},'nesting stops at three levels; empty objects are dropped');
assert.deepEqual(jobCounts(null),{});
assert.deepEqual(jobCounts([1,2]),{});
assert.equal(jobErrorCode(new Error('lab_sweep_failed')),'lab_sweep_failed');
assert.equal(jobErrorCode(new Error('Member Ani Petrosyan has no consent')),'Error','a message with text is reduced to its class');
assert.equal(jobErrorCode(new TypeError('x is undefined')),'TypeError');
assert.equal(jobErrorCode('boom'),'unknown_error');
assert.equal(outcomeFromFailures(0,3),'ok');assert.equal(outcomeFromFailures(1,3),'partial');assert.equal(outcomeFromFailures(1,0),'error');
console.log('Job ledger counts carry numbers and state words only; error codes never carry message text.');

// The contract: start before work, finish once after, deadline before maxDuration, ledger failures never block the job.
const calls:string[]=[];
const ledger=(fail?:'start'|'finish'):JobLedger=>({
 start:async(job,trigger,max)=>{calls.push(`start ${job} ${trigger} ${max}`);if(fail==='start')throw new Error('job_ledger_write_failed');return 'run-1';},
 finish:async(id,outcome,code,counts)=>{calls.push(`finish ${id} ${outcome} ${code} ${JSON.stringify(counts)}`);if(fail==='finish')throw new Error('job_ledger_write_failed');},
});
const now=()=>1_000_000;
let seenDeadline=0;
const ok=await runJob({name:'zoe_run',maxDurationSec:120,trigger:'cron',ledger:ledger(),now},async ctx=>{calls.push(`work ${ctx.runId}`);seenDeadline=ctx.deadline;return {outcome:'ok',report:{claimed:1}};});
assert.deepEqual(calls,['start zoe_run cron 120','work run-1','finish run-1 ok null {"claimed":1}']);
assert.equal(seenDeadline,1_000_000+(120-JOB_DEADLINE_MARGIN_SEC)*1000);
assert.equal(ok.runId,'run-1');
calls.length=0;
const thrown=await runJob({name:'lab_ai',maxDurationSec:300,trigger:'request',ledger:ledger(),now},async()=>{throw new Error('Member text that must not be stored');});
assert.equal(thrown.outcome,'error');assert.equal(thrown.status,503);
assert.equal(calls.at(-1),'finish run-1 error Error {}','a thrown error is finished as error with its class, not its message');
calls.length=0;
const partial=await runJob({name:'zoe_run',maxDurationSec:60,trigger:'cron',ledger:ledger(),now},async()=>({outcome:'partial',report:{failed:1},errorCode:'zoe_job_failed'}));
assert.equal(partial.outcome,'partial');assert.match(calls.at(-1)!,/finish run-1 partial zoe_job_failed/);
calls.length=0;
const noStart=await runJob({name:'zoe_run',maxDurationSec:60,trigger:'cron',ledger:ledger('start'),now},async()=>{calls.push('work');return {outcome:'ok',report:{}};});
assert.equal(noStart.outcome,'ok');assert.deepEqual(calls,['start zoe_run cron 60','work'],'a failed start still runs the job and skips the finish');
calls.length=0;
const noFinish=await runJob({name:'zoe_run',maxDurationSec:60,trigger:'cron',ledger:ledger('finish'),now},async()=>({outcome:'ok',report:{}}));
assert.equal(noFinish.outcome,'ok','a failed finish does not change the job result');
const noLedger=await runJob({name:'zoe_run',maxDurationSec:60,trigger:'cron',ledger:null,now},async()=>({outcome:'skipped',report:{state:'disabled'}}));
assert.equal(noLedger.runId,null);
console.log('Job contract: start, work under a deadline, finish once; ledger outages never block or change a job.');

// Cron authentication is exact and constant-time.
const req=(auth?:string)=>new Request('https://app.example.com/api/internal/zoe/run',{headers:auth?{authorization:auth}:{}});
assert.equal(cronAuthorized(req('Bearer s3cret-value'),'s3cret-value'),true);
assert.equal(cronAuthorized(req('Bearer s3cret-valuX'),'s3cret-value'),false);
assert.equal(cronAuthorized(req(),'s3cret-value'),false);
assert.equal(cronAuthorized(req('Bearer '),''),false,'an unset secret never authorizes');
assert.equal(cronAuthorized(req('Bearer undefined'),undefined),false);

// Every internal job route goes through the contract, and zoe/run has its own cron.
for(const route of ['care-alerts/sweep','lab-ai','message-dispatch','report-cleanup','telegram/dispatch','zoe/run','risk-tiers','clinical-anomalies','realtime-signals'])
 assert.match(readFileSync(`app/api/internal/${route}/route.ts`,'utf8'),/export const GET=jobRoute\(/,`${route} uses jobRoute`);
const crons=(JSON.parse(readFileSync('vercel.json','utf8')) as {crons:{path:string}[]}).crons.map(c=>c.path);
assert.deepEqual(JSON.parse(readFileSync('vercel.json','utf8')).crons,[
 {path:'/api/internal/report-cleanup',schedule:'17 * * * *'},
 {path:'/api/internal/telegram/dispatch',schedule:'*/5 * * * *'},
 {path:'/api/internal/zoe/run',schedule:'*/5 * * * *'},
 {path:'/api/internal/lab-ai',schedule:'*/5 * * * *'},
 {path:'/api/internal/care-alerts/sweep',schedule:'* * * * *'},
 {path:'/api/internal/risk-tiers',schedule:'41 */6 * * *'},
 {path:'/api/internal/clinical-anomalies',schedule:'23 5 * * *'},
 {path:'/api/internal/realtime-signals',schedule:'29 * * * *'},
],'care alerts run every minute and the existing crons keep their schedules');
assert.ok(crons.includes('/api/internal/zoe/run'),'zoe/run is scheduled');
assert.ok(!crons.includes('/api/internal/monitoring-follow-up'),'the demo-only monitoring cron is retired');
for(const path of crons)assert.ok(readFileSync(`app${path}/route.ts`,'utf8').includes('jobRoute('),`${path} writes the ledger`);
assert.match(readFileSync('app/api/internal/telegram/dispatch/route.ts','utf8'),/runConfiguredTelegramSweep\(\{withZoe:false(?:,[^}]*)?\}\)/,'the Telegram cron leaves Zoe to its own cron');
{const server=readFileSync('lib/telegram-runtime/server.ts','utf8');
 assert.match(server,/runZoePasses\(\(\)=>runZoeSweep\(r,\{limit:1\}\),\{limit:options\.zoeLimit\?\?WEBHOOK_ZOE_LIMIT,deadlineAt:startedAt\+WEBHOOK_LIMIT_MS-WEBHOOK_DISPATCH_RESERVE_MS\}\)/,'the webhook sweep runs a bounded number of Zoe messages, one at a time, before a deadline counted from the request');
 assert.match(readFileSync('app/api/telegram/webhook/route.ts','utf8'),/runConfiguredTelegramSweep\(\{startedAt\}\)/,'the webhook passes its request start to the sweep');
 const limit=Number(/const WEBHOOK_ZOE_LIMIT=(\d+)/.exec(server)?.[1]);
 assert.ok(limit>=1&&limit<=2,'at most two Zoe runs inside the 60 s webhook function');
 const num=(name:string)=>Number(new RegExp(`${name}=([\\d_]+)`).exec(server)?.[1]?.replaceAll('_',''));
 assert.ok(num('WEBHOOK_LIMIT_MS')===60_000&&num('WEBHOOK_DISPATCH_RESERVE_MS')>=10_000&&num('WEBHOOK_LIMIT_MS')-num('WEBHOOK_DISPATCH_RESERVE_MS')>=RUN_WORST_MS,
  'a whole Zoe run fits before the webhook deadline, which leaves the 60 s function time to dispatch');}
console.log('Every scheduled job route uses the job contract; zoe/run has its own cron; the demo-only monitoring cron is gone.');

// Operations view: overdue when a scheduled job missed two intervals; unscheduled jobs never overdue.
const t=Date.parse('2026-10-19T00:00:00Z');
const health=(job:string,minsAgo:number)=>({job,last_started_at:new Date(t-minsAgo*60_000).toISOString(),last_ok_at:null,last_error_at:null,runs_24h:1,errors_24h:0,lost_24h:0,p95_ms_24h:null});
assert.equal(jobOverdue(health('zoe_run',9),t),false);assert.equal(jobOverdue(health('zoe_run',11),t),true);
assert.equal(jobOverdue(health('report_cleanup',100),t),false);assert.equal(jobOverdue(health('message_dispatch',10_000),t),false);
assert.equal(jobOverdue(health('care_alert_sweep',1),t),false);
assert.equal(jobOverdue(health('care_alert_sweep',3),t),true,'care alerts use the one-minute cadence');
const careView=await readJobsView({now:t,read:async()=>({data:{jobs:[health('care_alert_sweep',60)],runs:[]},error:null})});
assert.equal(careView.state,'ready');
if(careView.state==='ready')assert.equal(careView.jobs.find(j=>j.job==='care_alert_sweep')?.overdue,true,'a care-alert run 60 minutes old is overdue');
const view=await readJobsView({now:t,read:async()=>({data:{jobs:[health('zoe_run',1)],runs:[]},error:null})});
assert.equal(view.state,'ready');
if(view.state==='ready'){
 assert.deepEqual(view.jobs.filter(j=>j.overdue).map(j=>j.job).sort(),['care_alert_sweep','lab_ai','report_cleanup','telegram_dispatch'],'scheduled jobs with no runs show as overdue');
 const neverStarted=view.jobs.find(j=>j.job==='care_alert_sweep');
 assert.equal(neverStarted?.last_started_at,new Date(0).toISOString(),'a never-started care-alert job uses the same sentinel as other schedules');
 assert.equal(neverStarted?.runs_24h,0);
}
assert.deepEqual(await readJobsView({read:async()=>({data:null,error:{code:'42501'}})}),{state:'unavailable'});
assert.deepEqual(await readJobsView({read:async()=>({data:{jobs:'x',runs:[]},error:null})}),{state:'unavailable'});
console.log('Operations shows each job\'s health and flags a schedule that stopped.');
