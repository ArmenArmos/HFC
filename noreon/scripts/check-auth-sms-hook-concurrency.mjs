/** Exclusive isolated local replay DB only. Never targets the primary/hosted DB.
 * Commits labeled synthetic reservations to test separate concurrent sessions,
 * then restores policy and removes only this run's fixtures in finally.
 */
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const container=process.env.NOREON_TEST_DB_CONTAINER??'supabase_db_noreon-integrity-replay';
if(!['supabase_db_noreon-integrity-replay','supabase_db_noreon-twilio-hook-replay'].includes(container))throw Error('Exclusive isolated replay DB required');
const suffix=randomBytes(6).toString('hex'),schema=`qa_sms_${suffix}`,prefix=`qa_${suffix}_`;
function sql(text){return new Promise((resolve,reject)=>{const process=spawn('docker',['exec','-i',container,'psql','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres']);let out='',err='';process.stdout.on('data',x=>out+=x);process.stderr.on('data',x=>err+=x);process.on('error',reject);process.on('close',code=>resolve({code,out,err}));process.stdin.end(text);});}
async function checked(text){const r=await sql(text);if(r.code!==0)throw Error(`Isolated concurrency SQL failed: ${r.err}`);return r.out;}
let setup=false;
try{
 await checked(`begin;
 do $$begin if exists(select 1 from public.auth_sms_hook_attempts) or exists(select 1 from public.patient_message_spend_totals) or exists(select 1 from public.patient_message_attempts) then raise exception 'Exclusive clean replay DB required';end if;end$$;
 create schema ${schema};create table ${schema}.policy as table public.patient_message_spend_policy;
 select public.configure_patient_message_spend((select revision from public.patient_message_spend_policy where id=1),'{"enabled":true,"currency":"USD","daily_limit_micros":5000000,"sms_segment_ceiling_micros":3000000,"whatsapp_message_ceiling_micros":1000,"max_sms_segments":1,"allowed_prefixes":["+374"]}'::jsonb||jsonb_build_object('valid_until',clock_timestamp()+interval '1 day'),'test-operator');commit;`);
 setup=true;
 const transaction=id=>`begin;set local role service_role;set local lock_timeout='3s';set local statement_timeout='4s';select public.claim_auth_sms_hook('${id}',repeat('a',64),'twilio','sms');select pg_sleep(0.3);commit;`;
 const different=await Promise.all([sql(transaction(prefix+'one')),sql(transaction(prefix+'two'))]);
 assert.equal(different.filter(r=>r.code===0).length,1,'only one request fits remaining shared budget');
 assert.equal(different.filter(r=>r.err.includes('message spending limit')).length,1);
 assert.equal((await checked("select reserved_micros from public.patient_message_spend_totals where currency='USD';")).trim(),'3000000');
 await checked(`begin;delete from public.auth_sms_hook_attempts where webhook_id like '${prefix}%';delete from public.patient_message_spend_totals;commit;`);
 const same=await Promise.all([sql(transaction(prefix+'same')),sql(transaction(prefix+'same'))]);
 assert.ok(same.every(r=>r.code===0));
 const claims=same.flatMap(r=>r.out.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)));
 assert.equal(claims.filter(r=>r.status==='send').length,1);assert.equal(claims.filter(r=>r.status==='submitting').length,1);
 assert.equal((await checked('select count(*) from public.auth_sms_hook_attempts;')).trim(),'1');
 assert.equal((await checked("select reserved_micros from public.patient_message_spend_totals where currency='USD';")).trim(),'3000000');
 console.log('Actual concurrent PostgreSQL sessions: one cap winner, one same-ID sender, no double reservation.');
}finally{
 if(setup)await checked(`begin;
 delete from public.auth_sms_hook_attempts where webhook_id like '${prefix}%';
 delete from public.patient_message_spend_totals;
 update public.patient_message_spend_policy set (revision,enabled,currency,daily_limit_micros,sms_segment_ceiling_micros,whatsapp_message_ceiling_micros,max_sms_segments,allowed_prefixes,valid_until,updated_at)=(select revision,enabled,currency,daily_limit_micros,sms_segment_ceiling_micros,whatsapp_message_ceiling_micros,max_sms_segments,allowed_prefixes,valid_until,updated_at from ${schema}.policy) where id=1;
 delete from public.patient_message_spend_policy_events where revision>(select revision from ${schema}.policy);
 drop schema ${schema} cascade;commit;`);
}
