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
try{
 await sql(`insert into auth.users(id,phone,phone_confirmed_at) values('${user}','37499000111',now());
 update public.profiles set display_name='Fictional concurrency member',birth_date='1980-01-01',biological_sex='female' where id='${user}';
 insert into public.patient_consents(user_id,version) values('${user}','patient-pilot-v1');`);
 const results=await Promise.all(Array.from({length:8},()=>sql(`begin;set local role authenticated;set local "request.jwt.claim.sub"='${user}';select public.save_patient_message_preferences('sms',0,'messaging-service-v1');commit;`)));
 assert.equal(results.filter(x=>x==='1').length,1,'Exactly one first consent write must win');
 assert.equal(results.filter(x=>x==='-1').length,7,'Other concurrent writes must report revision conflict');
 await sql(` insert into public.patient_care_plans(id,user_id,clinician,instructions) values('${plan}','${user}','Fictional GP','Fictional only');`);
 const jobs=await Promise.all(Array.from({length:8},()=>sql(`set role service_role;select public.enqueue_patient_plan_message('${plan}');`)));
 // Diagnostic (18 Oct: null jobs only on the fast Mac runner, not reproduced elsewhere): when any enqueue returns
 // no job, print every gate enqueue_patient_plan_message checks, evaluated now, so the next failure names its cause.
 const gates=jobs.some(j=>!/^[0-9a-f-]{36}$/.test(j))?await sql(`select json_build_object('results',${"'"}${JSON.stringify(jobs)}${"'"}::json,'now',now(),'clock',clock_timestamp(),
  'phone_confirmed',(select phone_confirmed_at is not null from auth.users where id='${user}'),
  'pref',(select json_build_object('channel',channel,'phone_matches',verified_phone=('+'||ltrim(u.phone,'+')),'consented_at',consented_at,'revision',p.revision) from public.patient_message_preferences p join auth.users u on u.id=p.user_id where p.user_id='${user}'),
  'pilot_consent',exists(select 1 from public.patient_consents where user_id='${user}' and version='patient-pilot-v1'),
  'plan',(select json_build_object('active',active,'published_at',published_at,'acknowledged',acknowledged_at is not null,'published_after_now',published_at>now(),'published_before_consent',published_at<(select consented_at from public.patient_message_preferences where user_id='${user}')) from public.patient_care_plans where id='${plan}'),
  'outbox',(select json_agg(json_build_object('id',id,'state',state,'kind',kind)) from public.patient_message_outbox where plan_id='${plan}'));`):'';
 assert.match(jobs[0],/^[0-9a-f-]{36}$/,`enqueue returned no job; gates: ${gates}`);assert.equal(new Set(jobs).size,1,'Concurrent enqueue must return the same durable job');
 assert.equal(await sql(`select count(*) from public.patient_message_outbox where user_id='${user}';`),'1');
 assert.equal(await sql(`select count(*) from public.patient_message_consent_events where user_id='${user}';`),'1');
 console.log('Concurrent messaging consent has one revision winner; duplicate producers create one outbox job.');
}finally{await sql(`delete from auth.users where id='${user}';`);}
