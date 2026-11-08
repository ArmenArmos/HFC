import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
const container=process.env.NOREON_TEST_DB_CONTAINER;
if(!container?.startsWith('supabase_db_'))throw Error('Use an isolated local Supabase test container');
const user=randomUUID(),plan=randomUUID(),med=randomUUID();
async function sql(query:string):Promise<string>{
 return new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container!,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1']);
  let out='',error='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>error+=d);
  child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(error)));child.stdin.end(query);
 });
}
try{
 await sql(`insert into auth.users(id) values('${user}');insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at) values('${plan}','${user}','Fictional GP','Fictional only',now()-interval '2 days');insert into public.patient_care_medications(id,user_id,plan_id,name,dose,instructions,times,start_date) values('${med}','${user}','${plan}','Fictional medicine','Example','Fictional only',array[time '00:00'],(now() at time zone 'Asia/Yerevan')::date-1);`);
 const due=await sql(`select date_trunc('day',now() at time zone 'Asia/Yerevan') at time zone 'Asia/Yerevan';`);
 const query=(status:string,revision:number)=>`set role authenticated;set "request.jwt.claim.sub"='${user}';select public.report_patient_dose_versioned('${med}','${due}','${status}',${revision});`;
 const initial=await Promise.all(Array.from({length:8},()=>sql(query('taken',0))));
 assert.deepEqual([...new Set(initial)],['1']);
 const stamp=await sql(`select recorded_at from public.patient_dose_events where user_id='${user}';`);
 await sql(query('taken',0));
 assert.equal(await sql(`select recorded_at from public.patient_dose_events where user_id='${user}';`),stamp,'A retry in a later transaction must preserve reported time');
 const corrections=await Promise.all(Array.from({length:8},()=>sql(query('skipped',1))));
 assert.deepEqual([...new Set(corrections)],['2']);
 await assert.rejects(sql(query('taken',0)),/dose revision conflict/);
 assert.equal(await sql(`select count(*) from public.patient_dose_event_history where user_id='${user}';`),'2');
 assert.equal(await sql(`select recorded_at from public.patient_dose_event_history where user_id='${user}' and revision=1;`),stamp);
 assert.equal(await sql(`select status from public.patient_dose_events where user_id='${user}';`),'skipped');
 console.log('Concurrent dose retries create one revision; stale check-ins cannot overwrite a newer correction and original evidence is retained.');
}finally{await sql(`delete from auth.users where id='${user}';`);}
