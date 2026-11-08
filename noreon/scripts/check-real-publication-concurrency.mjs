/** Two actual PostgreSQL sessions, isolated replay container only; no primary data. */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const container='supabase_db_noreon-integrity-replay',uid=randomUUID();
function session(){
 const child=spawn('docker',['exec','-i',container,'psql','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres']);let out='',err='';let readyResolve;const ready=new Promise(r=>readyResolve=r);
 child.stdout.on('data',x=>{out+=x;if(out.includes('LOCK_READY'))readyResolve();});child.stderr.on('data',x=>err+=x);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,out,err}));});
 child.stdin.write("\\set VERBOSITY verbose\nset statement_timeout='4s';\n");
 return {child,ready,done};
}
async function sql(statement){const s=session();s.child.stdin.end(statement);return s.done;}
async function checked(statement){const r=await sql(statement);assert.equal(r.code,0,r.err);return r.out.trim();}
let setup=false,holder;
try{
 await checked(`insert into auth.users(id,phone,phone_confirmed_at) values('${uid}','37499000991',now());`);setup=true;
 // A source writer already running must make publication fail closed immediately.
 holder=session();holder.child.stdin.write(`begin;insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at) values('${uid}',gen_random_uuid(),120,80,now());\n\\echo LOCK_READY\n`);await holder.ready;
 const blocked=await sql(`set role service_role;select public.publish_patient_clinical_plan('${uid}','${uid}',0,'old','{}',gen_random_uuid());`);
 assert.notEqual(blocked.code,0);assert.match(blocked.err,/55P03/,'publication reports lock contention, never a stale clinical commit');
 holder.child.stdin.end('rollback;');assert.equal((await holder.done).code,0);holder=null;
 // Once publication has its freeze, a newly inserted measurement waits until commit.
 holder=session();holder.child.stdin.write(`begin;select public.lock_patient_clinical_sources('${uid}');select public.patient_clinical_evidence('${uid}')->>'token';\n\\echo LOCK_READY\n`);await holder.ready;
 const writer=session();let writerFinished=false;writer.done.then(()=>writerFinished=true);writer.child.stdin.end(`insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at) values('${uid}',gen_random_uuid(),121,81,now());`);
 await new Promise(r=>setTimeout(r,150));assert.equal(writerFinished,false,'source insert cannot pass publication freeze');
 holder.child.stdin.end(`select public.patient_clinical_evidence('${uid}')->>'token';commit;`);const frozen=await holder.done;assert.equal(frozen.code,0,frozen.err);holder=null;
 const tokens=frozen.out.split('\n').filter(x=>/^[a-f0-9]{32}$/.test(x));assert.equal(tokens.length,2);assert.equal(tokens[0],tokens[1]);
 assert.equal((await writer.done).code,0);
 assert.notEqual(await checked(`select public.patient_clinical_evidence('${uid}')->>'token';`),tokens[0],'the next review observes the committed new evidence');
 console.log('Real PostgreSQL contention: existing writer blocks publication; source inserts wait for publication freeze; no stale snapshot during commit window.');
}finally{
 if(holder){holder.child.stdin.end('rollback;');await holder.done;}
 if(setup)await checked(`delete from auth.users where id='${uid}';`);
}
