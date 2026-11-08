/** Real PostgreSQL sessions. Explicitly isolated onboarding replay container only. */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const container=process.env.NOREON_TEST_DB_CONTAINER;
const owned=container==='supabase_db_noreon-mvp-combined-replay-20261014'||container==='supabase_db_noreon-staff-onboarding-replay-20261013'||container==='supabase_db_noreon-staff-session-replay-20261013';
const ci=process.env.GITHUB_ACTIONS==='true'&&process.env.CI==='true'&&container==='supabase_db_noreon-core';
if(!owned&&!ci)throw Error('Owned onboarding replay or repository CI database required');
const admin=randomUUID(),adminSession=randomUUID(),clinic=randomUUID(),sessionId=randomUUID(),email=`concurrent-${randomUUID()}@example.invalid`;
function session(){
 const child=spawn('docker',['exec','-i',container,'psql','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres']);
 let out='',err='',readyResolve;const ready=new Promise(r=>readyResolve=r);
 child.stdout.on('data',x=>{out+=x;if(out.includes('LOCK_READY'))readyResolve();});child.stderr.on('data',x=>err+=x);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,out,err}));});
 child.stdin.write("\\set VERBOSITY verbose\nset statement_timeout='8s';\n");return {child,ready,done};
}
async function sql(statement){const s=session();s.child.stdin.end(statement);return s.done;}
async function checked(statement){const r=await sql(statement);assert.equal(r.code,0,r.err);return r.out.trim();}
const actor=`set request.jwt.claim.sub='${admin}';set request.jwt.claims='${JSON.stringify({sub:admin,role:'authenticated',session_id:adminSession,amr:[{method:'password'}]})}';set role authenticated;`;
let invitation,holder;
try{
 await checked(`insert into auth.users(id,email) values('${admin}','admin-${admin}@example.invalid');insert into auth.sessions(id,user_id,created_at,updated_at)values('${adminSession}','${admin}',clock_timestamp(),clock_timestamp());insert into public.workspace_clinics(id,name) values('${clinic}','Concurrency fixture');insert into public.workspace_staff(user_id,role,display_name) values('${admin}','admin','Fixture admin');`);
 const reservations=await Promise.all(Array.from({length:6},()=>sql(`${actor}select public.real_admin_reserve_doctor_invitation('${randomUUID()}','${email}','Concurrent doctor','${clinic}');`)));
 assert.equal(reservations.filter(r=>r.code===0).length,1,'only one normalized email reservation wins');
 for(const r of reservations.filter(r=>r.code!==0))assert.match(r.err,/23505/);
 invitation=JSON.parse(reservations.find(r=>r.code===0).out.trim());
 const {id,generation,operationId,expectedAuthUserId:uid}=invitation;
 const claims=await Promise.all(Array.from({length:8},()=>checked(`set role service_role;select public.real_staff_claim_invitation_dispatch('${id}',${generation},'${operationId}');`)));
 assert.equal(claims.map(JSON.parse).filter(r=>r.claimed).length,1,'one external dispatcher owns the generation');
 await checked(`insert into auth.users(id,email,email_confirmed_at) values('${uid}','${email}',clock_timestamp());insert into auth.sessions(id,user_id,created_at,updated_at) values('${sessionId}','${uid}',clock_timestamp(),clock_timestamp());set role service_role;select public.real_staff_bind_invitation_identity('${id}',1,'${operationId}','${uid}');select public.real_staff_store_invitation_token('${id}',1,'${operationId}',repeat('a',64),'invite');select public.real_staff_record_invitation_verification('${id}',1,'${uid}');`);
 // A session revoked concurrently must not activate the doctor after revocation commits.
 holder=session();holder.child.stdin.write(`begin;delete from auth.sessions where id='${sessionId}';\n\\echo LOCK_READY\n`);await holder.ready;
 const revokedFinisher=session();let revokedFinished=false;revokedFinisher.done.then(()=>revokedFinished=true);
 revokedFinisher.child.stdin.end(`set role service_role;select public.real_staff_finalize_doctor_invitation('${id}',1,'${uid}','${sessionId}');`);
 await new Promise(r=>setTimeout(r,150));assert.equal(revokedFinished,false,'activation waits for session revocation lock');
 holder.child.stdin.end('commit;');assert.equal((await holder.done).code,0);holder=null;
 const revokedResult=await revokedFinisher.done;assert.notEqual(revokedResult.code,0);assert.match(revokedResult.err,/42501/);
 assert.equal(await checked(`select active from public.workspace_staff where user_id='${uid}';`),'f');
 await checked(`insert into auth.sessions(id,user_id,created_at,updated_at) values('${sessionId}','${uid}',clock_timestamp(),clock_timestamp());`);
 // Clinic deactivation wins its row lock before activation is allowed to inspect it.
 holder=session();holder.child.stdin.write(`begin;update public.workspace_clinics set active=false where id='${clinic}';\n\\echo LOCK_READY\n`);await holder.ready;
 const finisher=session();let finished=false;finisher.done.then(()=>finished=true);
 finisher.child.stdin.end(`set role service_role;select public.real_staff_finalize_doctor_invitation('${id}',1,'${uid}','${sessionId}');`);
 await new Promise(r=>setTimeout(r,150));assert.equal(finished,false,'finalization waits for clinic state lock');
 holder.child.stdin.end('commit;');assert.equal((await holder.done).code,0);holder=null;
 const rejected=await finisher.done;assert.notEqual(rejected.code,0);assert.match(rejected.err,/42501/);
 assert.equal(await checked(`select active from public.workspace_staff where user_id='${uid}';`),'f');
 await checked(`update public.workspace_clinics set active=true where id='${clinic}';`);
 const finishes=await Promise.all(Array.from({length:5},()=>checked(`set role service_role;select public.real_staff_finalize_doctor_invitation('${id}',1,'${uid}','${sessionId}');`)));
 assert.equal(finishes.map(JSON.parse).filter(r=>r.status==='accepted').length,5);
 assert.equal(await checked(`select count(*) from public.real_staff_admin_events where invitation_id='${id}' and kind='invitation_accepted';`),'1','one activation transition');
 await checked(`update public.workspace_staff set active=false where user_id='${uid}';`);
 await Promise.all(Array.from({length:3},()=>checked(`set role service_role;select public.real_staff_finalize_doctor_invitation('${id}',1,'${uid}','${sessionId}');`)));
 assert.equal(await checked(`select active from public.workspace_staff where user_id='${uid}';`),'f','replayed activation never reactivates disabled doctor');
 console.log('PostgreSQL concurrency passed: one email reservation, one dispatch claimant, session-revocation and clinic-state fencing, one activation event, disabled access preserved.');
}finally{
 if(holder){holder.child.stdin.end('rollback;');await holder.done;}
 await checked(`delete from public.real_staff_admin_events where actor_id='${admin}' or clinic_id='${clinic}' or invitation_id in(select id from public.real_staff_invitations where clinic_id='${clinic}');delete from public.real_staff_invitations where clinic_id='${clinic}';delete from auth.users where id='${admin}' or email='${email}';delete from public.workspace_clinics where id='${clinic}';`);
}
