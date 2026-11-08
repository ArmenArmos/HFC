import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const container = process.env.NOREON_TEST_DB_CONTAINER;
const isolatedLocal = container === 'supabase_db_noreon-mvp-combined-replay-20261014' || container === 'supabase_db_noreon-twilio-hook-replay';
const isolatedCI = process.env.GITHUB_ACTIONS === 'true' && process.env.CI === 'true' && container === 'supabase_db_noreon-core';
if (!isolatedLocal && !isolatedCI) throw Error('Exclusive isolated nurse replay or GitHub CI database required');
const sql = text => execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'}).trim();
class Session {
  constructor(name) {
    this.name=name; this.buffer=''; this.error='';
    this.child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-X','-At','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
    this.child.stdout.on('data',c=>{this.buffer+=c;this.check?.();});
    this.child.stderr.on('data',c=>{this.error+=c;});
    this.child.on('exit',code=>this.reject?.(new Error(`session exited ${code}: ${this.error}`)));
  }
  run(text) {
    const marker=`done_${randomUUID().replaceAll('-','')}`;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{this.reject=null;reject(new Error(`timeout ${this.name}: ${this.error}`));},5000);
      this.reject=reject;
      this.check=()=>{if(this.buffer.includes(marker)){clearTimeout(timeout);this.check=null;this.reject=null;const out=this.buffer;this.buffer='';resolve(out);}};
      this.child.stdin.write(`${text}\n\\echo ${marker}\n`);
    });
  }
  close(){this.reject=null;this.child.stdin.end('rollback;\n\\q\n');}
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function blocked(name) {
  const until=Date.now()+10000;
  while(Date.now()<until){
    if(sql(`select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`)==='t') return;
    await sleep(30);
  }
  throw new Error(`${name} never blocked on a database lock`);
}
const d=randomUUID(),n=randomUUID(),cl=randomUUID(),ids=[randomUUID(),randomUUID()];
let blocker,a,b;
const command=(id)=>`set request.jwt.claims='${JSON.stringify({sub:n,role:'authenticated',session_id:n,amr:[{method:'password'}]})}';select public.staff_care_command('${id}','${n}',0,true,'measurement',jsonb_build_object('submissionId',gen_random_uuid(),'measuredAt',now(),'systolic',120,'diastolic',80));`;
try {
 sql(`insert into auth.users(id) values('${d}'),('${n}');insert into auth.sessions(id,user_id,created_at,updated_at)values('${n}','${n}',clock_timestamp(),clock_timestamp());insert into public.workspace_clinics(id,name) values('${cl}','Fictional nurse lock test');insert into public.workspace_staff(user_id,role,display_name,clinic_id) values('${d}','doctor','Doctor','${cl}'),('${n}','nurse','Nurse','${cl}');`);
 for(let i=0;i<ids.length;i++)sql(`insert into auth.users(id,phone,phone_confirmed_at) values('${ids[i]}','3749919888${i}',now());insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id) values('${ids[i]}','${d}','${n}');`);
 blocker=new Session('nurse_lock_blocker');a=new Session('nurse_lock_a');b=new Session('nurse_lock_b');
 await Promise.all([blocker,a,b].map(s=>s.run(`set application_name='${s.name}';set statement_timeout='3s';`)));
 await blocker.run(`begin;select 1 from public.patient_clinical_cases where user_id='${ids[0]}' for update;`);
 const pending=a.run(command(ids[0]));
 // Register failure immediately so the intentional pre-fix check cannot produce an unhandled rejection.
 const outcome=pending.then(()=>null,error=>error);
 await blocked(a.name);
 await b.run(command(ids[1]));
 await blocker.run('commit;');
 const error=await outcome;if(error)throw error;
 assert.equal(sql(`select count(*) from public.patient_measurements where user_id in ('${ids[0]}','${ids[1]}');`),'2');
 console.log('A blocked native care case does not hold a table lock that blocks another assigned nurse measurement. Both writes persist.');
}finally{
 blocker?.close();a?.close();b?.close();await sleep(100);
 for(const id of ids)sql(`delete from public.patient_clinical_cases where user_id='${id}';delete from auth.users where id='${id}';`);
 sql(`delete from public.workspace_staff where user_id in ('${d}','${n}');delete from public.workspace_clinics where id='${cl}';delete from auth.users where id in ('${d}','${n}');`);
}
