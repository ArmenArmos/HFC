import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
const args=['exec','-i','supabase_db_noreon-core','psql','-U','supabase_admin','-d','noreon_reminders_check','-v','ON_ERROR_STOP=1','-At'];
const sql=text=>execFileSync('docker',args,{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe']});
sql(readFileSync(new URL('./check-reminder-db.sql',import.meta.url),'utf8'));
const uid='b9300000-0000-4000-8000-000000000003';
const preferences=JSON.stringify({medicationEnabled:true,medicationOffsetMinutes:0,bpEnabled:false,bpTimes:['08:00','20:00'],quietStart:'22:00',quietEnd:'07:00'});
const identity=`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`;
const call=expected=>`select public.save_patient_reminder_preferences('${preferences}',${expected});`;
try{
 sql(`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values('${uid}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fictional-reminder-concurrency@example.invalid','',now(),now()); ${identity} ${call(0)}`);
 const concurrent=()=>new Promise((resolve,reject)=>{const p=spawn('docker',args);let output='',error='';p.stdout.on('data',d=>output+=d);p.stderr.on('data',d=>error+=d);p.on('error',reject);p.on('exit',code=>code?reject(new Error(error)):resolve(Number(output.trim().split('\n').at(-1))));p.stdin.end(identity+call(1));});
 const results=await Promise.all([concurrent(),concurrent()]);assert.deepEqual(results.sort((a,b)=>a-b),[-1,2]);
}finally{sql(`delete from auth.users where id='${uid}';`);}
console.log('Reminder DB checks passed: RLS, authenticated ownership, malformed JSON, direct-write denial and concurrent revision protection.');
