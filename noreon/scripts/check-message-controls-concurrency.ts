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
const users=Array.from({length:8},()=>randomUUID()),plans=users.map(()=>randomUUID());
const previous=JSON.parse(await sql('select row_to_json(c) from public.patient_message_dispatch_control c where id=1;'));
const spendFixture=await messageSpendFixture(sql);
try{
 await sql(`update public.patient_message_dispatch_control set daily_limit=1,started_count=0,budget_day=(now() at time zone 'UTC')::date,paused_reason=null,paused_at=null where id=1;`);
 for(let n=0;n<users.length;n++)await sql(`
 insert into auth.users(id,phone,phone_confirmed_at) values('${users[n]}','37499001${String(n).padStart(3,'0')}',now());
 update public.profiles set display_name='Fictional controls member',birth_date='1980-01-01',biological_sex='female' where id='${users[n]}';
 insert into public.patient_consents(user_id,version) values('${users[n]}','patient-pilot-v1');
 begin;set local role authenticated;set local "request.jwt.claim.sub"='${users[n]}';
 select public.save_patient_message_preferences('sms',0,'messaging-service-v1');
 select public.save_patient_reminder_preferences('{"medicationEnabled":true,"medicationOffsetMinutes":0,"bpEnabled":false,"bpTimes":["08:00"],"quietStart":"00:00","quietEnd":"00:00"}',0);commit;
 insert into public.patient_care_plans(id,user_id,clinician,instructions) values('${plans[n]}','${users[n]}','Fictional GP','Fictional only');`);
 const jobs=await Promise.all(plans.map(id=>sql(`set role service_role;select public.enqueue_patient_plan_message('${id}');`)));
 const results=await Promise.all(jobs.map(id=>sql(`set role service_role;select attempt_id from public.begin_patient_message_submission_budgeted('${id}',${spendFixture.revision},array['sms','whatsapp']);`).catch(e=>String(e.message))));
 const winners=results.filter(x=>/^[0-9a-f-]{36}$/.test(x));assert.equal(winners.length,1);assert.equal(results.filter(x=>x.includes('message daily limit')).length,7);
 assert.equal(await sql('select started_count from public.patient_message_dispatch_control where id=1;'),'1');
 const next=jobs[results.findIndex(x=>x.includes('message daily limit'))];
 await sql('update public.patient_message_dispatch_control set daily_limit=200 where id=1;');
 await assert.rejects(sql(`set role service_role;select * from public.begin_patient_message_submission_budgeted('${next}',${spendFixture.revision},array['sms','whatsapp']);`),/message dispatch busy/);
 await sql(`set role service_role;select public.finish_patient_message_submission('${winners[0]}','unknown',null);`);
 await assert.rejects(sql(`set role service_role;select * from public.begin_patient_message_submission_budgeted('${next}',${spendFixture.revision},array['sms','whatsapp']);`),/message dispatch paused/);
 const reference='SM'+randomUUID().replaceAll('-','');
 await sql(`set role service_role;select public.record_patient_message_delivery('${winners[0]}','${reference}','delivered');`);
 await assert.rejects(sql(`set role service_role;select * from public.begin_patient_message_submission_budgeted('${next}',${spendFixture.revision},array['sms','whatsapp']);`),/message dispatch paused/);
 const revision=await sql('select revision from public.patient_message_dispatch_control where id=1;');
 assert.equal(await sql(`set role service_role;select public.resume_patient_message_dispatch(${revision},'unknown-reviewed',null,'test-operator');`),'t');
 assert.match(await sql(`set role service_role;select attempt_id from public.begin_patient_message_submission_budgeted('${next}',${spendFixture.revision},array['sms','whatsapp']);`),/^[0-9a-f-]{36}$/);
 assert.equal(await sql('select started_count from public.patient_message_dispatch_control where id=1;'),'2');
 console.log('Eight workers compete for one daily slot; unresolved work blocks new submissions, and reconciliation does not silently clear the pause or quota.');
}finally{
 await spendFixture.cleanup();
 const ids=users.map(id=>`'${id}'`).join(',');
 await sql(`delete from public.patient_message_attempts where user_id in (${ids});delete from auth.users where id in (${ids});delete from public.patient_message_control_events where revision>${previous.revision};
 update public.patient_message_dispatch_control c set revision=x.revision,budget_day=x.budget_day,started_count=x.started_count,daily_limit=x.daily_limit,paused_reason=x.paused_reason,paused_at=x.paused_at from json_populate_record(null::public.patient_message_dispatch_control,'${JSON.stringify(previous).replaceAll("'","''")}') x where c.id=1;`);
}
