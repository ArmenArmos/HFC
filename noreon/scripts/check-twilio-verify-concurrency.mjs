/** Exact isolated replay or repository-owned hosted CI DB only; fixtures removed in finally. */
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
const container=process.env.NOREON_TEST_DB_CONTAINER;
const isolatedGithubRunner=process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true'&&(process.env.RUNNER_ENVIRONMENT==='github-hosted'||(process.env.RUNNER_ENVIRONMENT==='self-hosted'&&process.env.NOREON_ISOLATED_CI_RUNNER==='noreon-ci'))&&process.env.GITHUB_REPOSITORY==='noreon-health/noreon-core';
const ciReplay=isolatedGithubRunner&&container==='supabase_db_noreon-core';
if(!container||(!ciReplay&&container!=='supabase_db_noreon-twilio-hook-replay'))throw Error('Exact isolated Verify replay or hosted repository CI database required; local primary forbidden');
const prefix='verify_qa_'+randomBytes(5).toString('hex')+'_',schema=prefix+'snapshot';
function sql(query){return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',container,'psql','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres']);let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>resolve({code,out,err}));p.stdin.end(query);});}
async function checked(query){const r=await sql(query);if(r.code)throw Error(r.err);return r.out;}
const claim=(id,digest,recipient)=>`select public.claim_auth_sms_verify_hook('${prefix+id}',repeat('${digest}',64),repeat('${digest}',64),repeat('${recipient}',64));`;
const tx=query=>`begin;set local role service_role;set local lock_timeout='3s';set local statement_timeout='4s';${query}select pg_sleep(0.2);commit;`;
let setup=false;
try{
 await checked(`begin;do $$begin if exists(select 1 from public.auth_sms_hook_attempts) or exists(select 1 from public.patient_message_spend_totals) then raise exception 'Exclusive clean replay required';end if;end$$;
 create schema ${schema};create table ${schema}.policy as table public.patient_message_spend_policy;
 select public.configure_patient_message_spend((select revision from public.patient_message_spend_policy where id=1),'{"enabled":true,"currency":"USD","daily_limit_micros":5000000,"sms_segment_ceiling_micros":100000,"whatsapp_message_ceiling_micros":100000,"max_sms_segments":1,"allowed_prefixes":["+374"]}'::jsonb||jsonb_build_object('valid_until',clock_timestamp()+interval '1 day'),'verify-concurrency');
 select public.configure_auth_verify_spend((select revision from public.patient_message_spend_policy where id=1),500000,'verify-concurrency');commit;`);setup=true;
 const contenders=await Promise.all([sql(tx(claim('a','a','1'))),sql(tx(claim('b','b','1')))]);
 assert.equal(contenders.filter(r=>r.code===0).length,1);assert.equal(contenders.filter(r=>r.err.includes('Verify recipient busy')).length,1);
 assert.equal((await checked('select sum(reserved_micros) from public.patient_message_spend_totals;')).trim(),'500000');
 await checked(`begin;${claim('prior','c','2')}select public.finish_auth_sms_hook('${prefix}prior',(select claim_token from public.auth_sms_hook_attempts where webhook_id='${prefix}prior'),'accepted','VE'||repeat('c',32));commit;`);
 const race=await Promise.all([sql(tx(claim('resend','d','2'))),sql(tx("select public.claim_auth_verify_feedback(repeat('c',64));"))]);
 const jsons=race.map(r=>r.out.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l)));
 if(race[0].code===0){assert.equal(jsons[0][0].previousReference,'VE'+'c'.repeat(32));assert.equal(jsons[1].length,0,'older feedback must not start after resend claim');}
 else{assert.ok(race[0].err.includes('Verify recipient busy'));assert.equal(jsons[1][0].reference,'VE'+'c'.repeat(32),'approval owns the recipient before cancellation');}
 console.log('Concurrent PostgreSQL sessions: one recipient sender, one reservation, cancellation/feedback mutual exclusion.');
}finally{
 if(setup)await checked(`begin;
 delete from public.auth_verify_feedback where webhook_id like '${prefix}%';delete from public.auth_verify_attempt_bindings where webhook_id like '${prefix}%';delete from public.auth_verify_recipients where active_webhook_id like '${prefix}%';delete from public.auth_sms_hook_attempts where webhook_id like '${prefix}%';delete from public.patient_message_spend_totals;
 update public.patient_message_spend_policy set (revision,enabled,currency,daily_limit_micros,sms_segment_ceiling_micros,whatsapp_message_ceiling_micros,max_sms_segments,allowed_prefixes,valid_until,updated_at,verify_attempt_ceiling_micros)=(select revision,enabled,currency,daily_limit_micros,sms_segment_ceiling_micros,whatsapp_message_ceiling_micros,max_sms_segments,allowed_prefixes,valid_until,updated_at,verify_attempt_ceiling_micros from ${schema}.policy) where id=1;
 delete from public.patient_message_spend_policy_events where revision>(select revision from ${schema}.policy);drop schema ${schema} cascade;commit;`);
}
