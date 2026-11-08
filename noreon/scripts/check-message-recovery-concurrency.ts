import {messageSpendFixture} from './test-support/message-spend';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
const container=process.env.NOREON_TEST_DB_CONTAINER;
if(!container?.startsWith('supabase_db_'))throw Error('Use an isolated local Supabase test container');
async function sql(query:string):Promise<string>{
 return new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container!,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1']);
  let out='',error='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>error+=d);
  child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(error)));child.stdin.end(query);
 });
}
const user=randomUUID(),plan=randomUUID(),actor=`test-${randomUUID()}`;
const previous=JSON.parse(await sql('select row_to_json(c) from public.patient_message_dispatch_control c where id=1;'));
const spendFixture=await messageSpendFixture(sql);
try{
 await sql(`update public.patient_message_dispatch_control set daily_limit=200,started_count=0,budget_day=(now() at time zone 'UTC')::date,paused_reason=null,paused_at=null where id=1;
 insert into auth.users(id,phone,phone_confirmed_at) values('${user}','37499000887',now());
 update public.profiles set display_name='Fictional retry member',birth_date='1980-01-01',biological_sex='female' where id='${user}';
 insert into public.patient_consents(user_id,version) values('${user}','patient-pilot-v1');
 begin;set local role authenticated;set local "request.jwt.claim.sub"='${user}';
 select public.save_patient_message_preferences('sms',0,'messaging-service-v1');
 select public.save_patient_reminder_preferences('{"medicationEnabled":true,"medicationOffsetMinutes":0,"bpEnabled":false,"bpTimes":["08:00"],"quietStart":"00:00","quietEnd":"00:00"}',0);commit;
 insert into public.patient_care_plans(id,user_id,clinician,instructions) values('${plan}','${user}','Fictional GP','Fictional only');`);
 const job=await sql(`set role service_role;select public.enqueue_patient_plan_message('${plan}');`);
 const attempt=await sql(`set role service_role;select attempt_id from public.begin_patient_message_submission_budgeted('${job}',${spendFixture.revision},array['sms','whatsapp']);`);
 await sql(`set role service_role;select public.finish_patient_message_submission('${attempt}','failed',null);`);
 const requeues=await Promise.all(Array.from({length:8},()=>sql(`set role service_role;select public.retry_patient_message_submission('${attempt}','${actor}');`)));
 assert.equal(requeues.filter(x=>x==='t').length,1);assert.equal(requeues.filter(x=>x==='f').length,7);
 const revision=await sql('select revision from public.patient_message_dispatch_control where id=1;');
 assert.equal(await sql(`set role service_role;select public.resume_patient_message_dispatch(${revision},'configuration-checked',null,'${actor}');`),'t');
 const attempts=await Promise.all(Array.from({length:8},()=>sql(`set role service_role;select attempt_id from public.begin_patient_message_submission_budgeted('${job}',${spendFixture.revision},array['sms','whatsapp']);`)));
 assert.equal(attempts.filter(Boolean).length,1);
 assert.equal(await sql(`select count(*) from public.patient_message_attempts where job_id='${job}';`),'2');
 assert.equal(await sql('select started_count from public.patient_message_dispatch_control where id=1;'),'2');
 assert.equal(await sql('select count(*) from public.patient_message_spend_reservations;'),'2');
 await sql(`set role service_role;select public.finish_patient_message_submission('${attempts.find(Boolean)}','unknown',null);`);
 assert.equal(await sql("select reserved_micros from public.patient_message_spend_totals where currency='USD';"),'6000','Failed and unknown submissions retain both reservations');
 console.log('Eight retry commands requeue once, and eight workers create one new attempt with preserved history and two charged admissions.');
}finally{
 await spendFixture.cleanup();
 await sql(`delete from public.patient_message_recovery_events where operator_label='${actor}';delete from public.patient_message_attempts where user_id='${user}';delete from auth.users where id='${user}';delete from public.patient_message_control_events where revision>${previous.revision};
 update public.patient_message_dispatch_control c set revision=x.revision,budget_day=x.budget_day,started_count=x.started_count,daily_limit=x.daily_limit,paused_reason=x.paused_reason,paused_at=x.paused_at from json_populate_record(null::public.patient_message_dispatch_control,'${JSON.stringify(previous).replaceAll("'","''")}') x where c.id=1;`);
}
