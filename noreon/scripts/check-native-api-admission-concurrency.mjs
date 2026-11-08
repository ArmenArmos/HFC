import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const db=process.env.NOREON_TEST_DB_CONTAINER??'supabase_db_noreon-integrity-replay';
if(!db.startsWith('supabase_db_'))throw Error('Local Supabase container required');
const args=['exec','-i',db,'psql','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1'];
const sql=s=>execFileSync('docker',args,{input:s,encoding:'utf8'}).trim();
const owner=randomUUID();
const run=s=>new Promise((resolve,reject)=>{const p=spawn('docker',args);let out='',err='';p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>err+=c);p.on('error',reject);p.on('close',code=>code?reject(Error(err)):resolve(out.trim()));p.stdin.end(s);});
try{
 sql(`insert into auth.users(id,phone,phone_confirmed_at) values('${owner}','${'999'+String(parseInt(owner.replaceAll('-','').slice(0,8),16)).padStart(10,'0')}',now()); select * from public.claim_native_member_request('${owner}');`);
 for(const boundary of ['minute','day']){
  sql(`do $$ begin if extract(second from clock_timestamp())>57 then perform pg_sleep(3);end if;end $$;
   update public.native_member_request_usage set minute_started_at=date_trunc('minute',clock_timestamp()),day_started_at=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC',minute_count=${boundary==='minute'?119:0},day_count=${boundary==='minute'?10:4999} where user_id='${owner}';`);
  const results=await Promise.all(Array.from({length:12},()=>run(`select allowed from public.claim_native_member_request('${owner}')`)));
  assert.equal(results.filter(x=>x==='t').length,1,`${boundary} admits only the last available slot`);
  assert.equal(results.filter(x=>x==='f').length,11);
  assert.equal(sql(`select day_count from public.native_member_request_usage where user_id='${owner}'`),boundary==='minute'?'11':'5000');
 }
 console.log('Concurrent native minute/day final-slot requests admit exactly one each.');
}finally{sql(`delete from auth.users where id='${owner}'`);}
