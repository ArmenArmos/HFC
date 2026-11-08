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
 await sql(`insert into auth.users(id) values('${user}');insert into public.patient_care_plans(id,user_id,clinician,instructions) values('${plan}','${user}','Fictional GP','Fictional only');`);
 const claims=await Promise.all(Array.from({length:8},()=>sql(`set role service_role;select public.claim_patient_message_source('${plan}');`)));
 assert.equal(claims.filter(Boolean).length,1,'Concurrent producers must admit exactly one source attempt');
 // Simulate the next independent enqueue RPC failing after durable admission.
 await assert.rejects(sql(`begin;select 1/0;commit;`));
 assert.equal(await sql(`set role service_role;select public.claim_patient_message_source('${plan}');`),'','A failed/rolled-back enqueue must not remove cooldown');
 assert.equal(await sql(`select attempts from public.patient_message_source_backoff where plan_id='${plan}';`),'1');
 await sql(`update public.patient_message_source_backoff set next_attempt_at=now()-interval '1 second' where plan_id='${plan}';`);
 const next=await sql(`set role service_role;select public.claim_patient_message_source('${plan}');`);
 assert.ok(next&&next!==claims.find(Boolean));
 assert.equal(await sql(`set role service_role;select public.complete_patient_message_source('${plan}','${claims.find(Boolean)}');`),'f');
 assert.equal(await sql(`set role service_role;select public.complete_patient_message_source('${plan}','${next}');`),'t');
 console.log('Concurrent source admission is exclusive; independent enqueue failure and stale completion preserve newer backoff.');
}finally{await sql(`delete from auth.users where id='${user}';`);}
