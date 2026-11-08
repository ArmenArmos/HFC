import {messageSpendFixture} from './test-support/message-spend';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
const container=process.env.NOREON_TEST_DB_CONTAINER;
if(!container?.startsWith('supabase_db_'))throw Error('Use an isolated local Supabase test container');
const user=randomUUID(),plan=randomUUID();
async function sql(query:string):Promise<string>{
 return new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container!,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1']);
  let out='',error='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>error+=d);
  child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(error)));child.stdin.end(query);
 });
}
const spendFixture=await messageSpendFixture(sql);
try{
 await sql(`insert into auth.users(id,phone,phone_confirmed_at) values('${user}','37499000111',now());
 update public.profiles set display_name='Fictional concurrency member',birth_date='1980-01-01',biological_sex='female' where id='${user}';
 insert into public.patient_consents(user_id,version) values('${user}','patient-pilot-v1');`);
 const results=await Promise.all(Array.from({length:8},()=>sql(`begin;set local role authenticated;set local "request.jwt.claim.sub"='${user}';select public.save_patient_message_preferences('sms',0,'messaging-service-v1');commit;`)));
 assert.equal(results.filter(x=>x==='1').length,1,'Exactly one first consent write must win');
 assert.equal(results.filter(x=>x==='-1').length,7,'Other concurrent writes must report revision conflict');
 await sql(` insert into public.patient_care_plans(id,user_id,clinician,instructions) values('${plan}','${user}','Fictional GP','Fictional only');`);
 const jobs=await Promise.all(Array.from({length:8},()=>sql(`set role service_role;select public.enqueue_patient_plan_message('${plan}');`)));
 assert.match(jobs[0],/^[0-9a-f-]{36}$/);assert.equal(new Set(jobs).size,1,'Concurrent enqueue must return the same durable job');
 assert.equal(await sql(`select count(*) from public.patient_message_outbox where user_id='${user}';`),'1');
 assert.equal(await sql(`select count(*) from public.patient_message_consent_events where user_id='${user}';`),'1');
 await sql(`set role authenticated;set "request.jwt.claim.sub"='${user}';select public.save_patient_reminder_preferences('{"medicationEnabled":true,"medicationOffsetMinutes":0,"bpEnabled":false,"bpTimes":["08:00"],"quietStart":"00:00","quietEnd":"00:00"}',0);`);
 const attempts=await Promise.all(Array.from({length:8},()=>sql(`set role service_role;select attempt_id from public.begin_patient_message_submission_budgeted('${jobs[0]}',${spendFixture.revision},array['sms','whatsapp']);`)));
 assert.equal(attempts.filter(Boolean).length,1,'Only one concurrent worker may receive a submission');
 assert.equal(await sql(`select count(*) from public.patient_message_attempts where job_id='${jobs[0]}';`),'1');
 // Resolve the first provider submission before testing a different job's opt-out race.
 // The global admission guard intentionally blocks unrelated jobs while it is unresolved.
 await sql(`set role service_role;select public.finish_patient_message_submission('${attempts.find(Boolean)}','accepted','SM${randomUUID().replaceAll('-','')}');`);
 const secondPlan=randomUUID();
 await sql(`update public.patient_care_plans set active=false where id='${plan}';insert into public.patient_care_plans(id,user_id,clinician,instructions) values('${secondPlan}','${user}','Fictional GP','Fictional only');`);
 const secondJob=await sql(`set role service_role;select public.enqueue_patient_plan_message('${secondPlan}');`);
 // The first transaction owns the auth lock and has opted out before the worker starts.
 let releaseReady!:()=>void;
 const ready=new Promise<void>(resolve=>releaseReady=resolve);
 const revoker=spawn('docker',['exec','-i',container!,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1']);
 let revokeOutput='',revokeError='';
 revoker.stdout.on('data',d=>{revokeOutput+=d;if(revokeOutput.includes('REVOKE_READY'))releaseReady();});
 revoker.stderr.on('data',d=>revokeError+=d);
 const revoked=new Promise<void>((resolve,reject)=>{revoker.on('error',reject);revoker.on('close',code=>code===0?resolve():reject(Error(revokeError)));});
 revoker.stdin.end(`begin;set local role authenticated;set local "request.jwt.claim.sub"='${user}';select public.save_patient_message_preferences('none',1,'messaging-service-v1');select 'REVOKE_READY';select pg_sleep(0.5);commit;`);
 await Promise.race([ready,revoked.then(()=>{if(!revokeOutput.includes('REVOKE_READY'))throw Error('Missing revoke handshake');})]);
 const afterRevoke=await sql(`set role service_role;select attempt_id from public.begin_patient_message_submission_budgeted('${secondJob}',${spendFixture.revision},array['sms','whatsapp']);`);
 await revoked;
 assert.equal(afterRevoke,'','A worker waiting behind revocation must not receive a destination');
 assert.equal(await sql(`select state from public.patient_message_outbox where id='${secondJob}';`),'cancelled');
 console.log('Eight concurrent workers receive one submission; a worker blocked behind opt-out cannot dispatch.');
}finally{
 await spendFixture.cleanup();await sql(`delete from public.patient_message_attempts where user_id='${user}';delete from auth.users where id='${user}';`);}
