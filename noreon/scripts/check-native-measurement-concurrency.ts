import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
const container=process.env.NOREON_TEST_DB_CONTAINER;
if(!container?.startsWith('supabase_db_'))throw Error('Use an isolated local Supabase test container');
const user=randomUUID(),submission=randomUUID();
async function sql(query:string):Promise<string>{
 return new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container!,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1']);
  let out='',error='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>error+=d);
  child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error(error)));child.stdin.end(query);
 });
}
try{
 const at=new Date().toISOString();
 await sql(`insert into auth.users(id,phone,phone_confirmed_at) values('${user}','37499000770',now());update public.profiles set display_name='Fictional member',birth_date='1980-01-01',biological_sex='female' where id='${user}';insert into public.patient_consents(user_id,version) values('${user}','patient-pilot-v1');insert into public.patient_assessments(user_id) values('${user}');`);
 const query=`set role authenticated;set "request.jwt.claim.sub"='${user}';select public.record_patient_measurement('${submission}',120,80,null,'${at}');`;
 const ids=await Promise.all(Array.from({length:8},()=>sql(query)));
 assert.ok(ids[0]);assert.equal(new Set(ids).size,1,'Concurrent same-submission saves must return one record');
 assert.equal(await sql(`select count(*) from public.patient_measurements where user_id='${user}';`),'1');
 await assert.rejects(sql(query.replace('120,80','121,80')),/measurement conflict/);
 assert.equal(await sql(`select systolic from public.patient_measurements where user_id='${user}';`),'120');
 console.log('Native measurement retries are atomic; changed-payload reuse cannot overwrite an existing reading.');
}finally{await sql(`delete from auth.users where id='${user}';`);}
