import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const db=process.env.NOREON_TEST_DB_CONTAINER??'supabase_db_noreon-integrity-replay';
if(!db.startsWith('supabase_db_'))throw Error('Local Supabase container required');
const args=['exec','-i',db,'psql','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1'];
const sql=s=>execFileSync('docker',args,{input:s,encoding:'utf8'}).trim();
const prefix=randomUUID().replaceAll('-','');
const a=randomUUID(),b=randomUUID();
const hash=prefix+'a'.repeat(32);
const run=s=>new Promise((resolve,reject)=>{const p=spawn('docker',args);let out='',err='';p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>err+=c);p.on('close',code=>code?reject(Error(err)):resolve(out.trim()));p.stdin.end(s);});
try{
 assert.equal(sql('select count(*) from public.demo_report_ai_attempts'),'0','isolated quota table must be empty');
 sql(`insert into public.demo_report_ai_attempts(request_id,session_hash,category) select gen_random_uuid(),'${hash}','member' from generate_series(1,499);`);
 const result=await Promise.all([run(`select public.claim_demo_report_ai('${a}','${prefix+'b'.repeat(32)}','member')`),run(`select public.claim_demo_report_ai('${b}','${prefix+'c'.repeat(32)}','member')`)]);
 assert.deepEqual(result.sort(),['f','t']);
 assert.equal(sql("select count(*) from public.demo_report_ai_attempts where category='member'"),'500');
 console.log('Concurrent final-slot member claims admit exactly one request at category cap.');
}finally{sql(`delete from public.demo_report_ai_attempts where session_hash like '${prefix}%'`);}
