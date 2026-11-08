/** Actual PostgreSQL sessions against the explicitly owned replay database only. */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {staffManagementTestDatabaseAllowed} from './staff-management-test-database.mjs';
const container=process.env.NOREON_TEST_DB_CONTAINER;
if(!staffManagementTestDatabaseAllowed(container))throw Error('Owned staff-management replay or repository CI database required');
const admin=randomUUID(),adminSession=randomUUID(),clinic=randomUUID(),other=randomUUID();
const members=[],staff=[],invitations=[],workspaces=[];
const q=x=>`'${String(x).replaceAll("'","''")}'`;
function session(){
 const app=`management-${randomUUID()}`;
 const child=spawn('docker',['exec','-i',container,'psql','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres']);
 let out='',err='',readyResolve;const ready=new Promise(r=>readyResolve=r);
 child.stdout.on('data',x=>{out+=x;if(out.includes('LOCK_READY'))readyResolve();});child.stderr.on('data',x=>err+=x);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,out,err}));});
 child.stdin.write(`\\set VERBOSITY verbose\nset statement_timeout='8s';set application_name=${q(app)};\n`);
 return {child,ready,done,app};
}
async function sql(s){const x=session();x.child.stdin.end(s);return x.done;}
async function checked(s){const r=await sql(s);assert.equal(r.code,0,r.err);return r.out.trim();}
const actor=`set request.jwt.claim.sub=${q(admin)};set request.jwt.claim.role='authenticated';set request.jwt.claims=${q(JSON.stringify({sub:admin,role:'authenticated',session_id:adminSession,amr:[{method:'password'}]}))};set role authenticated;`;
const service=`set request.jwt.claim.role='service_role';set role service_role;`;
async function row(id){return JSON.parse(await checked(`${actor}select x from jsonb_array_elements(public.real_admin_staff()) x where x->>'id'=${q(id)};`));}
const remove=(id,v)=>`${actor}select public.real_admin_remove_staff(${q(id)},${q(v)},${q(randomUUID())});`;
const edit=(id,v,c)=>`${actor}select public.real_admin_update_staff(${q(id)},${q(v)},'Edited',${q(c)},${q(randomUUID())});`;
async function legacy(role='doctor'){const id=randomUUID();staff.push(id);await checked(`insert into auth.users(id,email) values(${q(id)},${q(id+'@example.invalid')});insert into auth.sessions(id,user_id,created_at,updated_at)values(${q(id)},${q(id)},clock_timestamp(),clock_timestamp());insert into public.workspace_staff(user_id,role,display_name,clinic_id) values(${q(id)},${q(role)},'Fixture staff',${q(clinic)});`);return id;}
async function member(doctor=null){const id=randomUUID();members.push(id);await checked(`insert into auth.users(id,phone,phone_confirmed_at) values(${q(id)},${q('374'+String(Math.floor(Math.random()*1e8)).padStart(8,'0'))},clock_timestamp());insert into public.patient_consents(user_id,version) values(${q(id)},'patient-pilot-v1');insert into public.patient_assessments(user_id,revision,completed_at) values(${q(id)},1,clock_timestamp());insert into public.patient_clinical_cases(user_id,assigned_doctor_id) values(${q(id)},${doctor?q(doctor):'null'});`);return id;}
async function pending(role='nurse'){
 const i=JSON.parse(await checked(`${actor}select public.real_admin_reserve_staff_invitation(${q(randomUUID())},${q(randomUUID()+'@example.invalid')},'Pending',${q(clinic)},${q(role)});`));
 invitations.push(i.id);staff.push(i.expectedAuthUserId);return i;
}
async function verified(){
 const i=await pending();const sid=randomUUID();
 await checked(`${service}select public.real_staff_claim_invitation_dispatch(${q(i.id)},1,${q(i.operationId)});reset role;insert into auth.users(id,email,email_confirmed_at) values(${q(i.expectedAuthUserId)},${q(i.email)},clock_timestamp());${service}select public.real_staff_bind_invitation_identity(${q(i.id)},1,${q(i.operationId)},${q(i.expectedAuthUserId)});select public.real_staff_store_invitation_token(${q(i.id)},1,${q(i.operationId)},repeat('a',64),'invite');select public.real_staff_record_invitation_verification(${q(i.id)},1,${q(i.expectedAuthUserId)});reset role;insert into auth.sessions(id,user_id,created_at,updated_at) values(${q(sid)},${q(i.expectedAuthUserId)},clock_timestamp(),clock_timestamp());`);
 return {...i,sid};
}
const finalize=i=>`${service}select public.real_staff_finalize_invitation(${q(i.id)},1,${q(i.expectedAuthUserId)},${q(i.sid)});`;
const reissue=i=>`${actor}select public.real_admin_reissue_staff_invitation(${q(i.id)},1,${q(randomUUID())});`;
let holder;
async function race(first,second,expected, label){
 holder=session();holder.child.stdin.write(`begin;${first}\n\\echo LOCK_READY\n`);
 await Promise.race([holder.ready,holder.done.then(r=>{throw Error(`Holder failed: ${r.err}`);})]);
 const follower=session();follower.child.stdin.end(second);
 let blocked=false;
 for(let attempt=0;attempt<30;attempt++){
  if(await checked(`select exists(select 1 from pg_stat_activity where application_name=${q(follower.app)} and wait_event_type='Lock');`)==='t'){blocked=true;break;}
  await new Promise(r=>setTimeout(r,20));
 }
 assert.equal(blocked,true,`${label}: follower must wait for a real database lock`);
 holder.child.stdin.end('commit;');assert.equal((await holder.done).code,0);holder=null;
 const r=await follower.done;
 if(expected===null)assert.equal(r.code,0,r.err);
 else {assert.notEqual(r.code,0,`${label}: must fail`);assert.match(r.err,expected);}
 console.log(`PASS ${label}`);return r;
}
try{
 await checked(`insert into auth.users(id,email) values(${q(admin)},${q(admin+'@example.invalid')});insert into auth.sessions(id,user_id,created_at,updated_at)values(${q(adminSession)},${q(admin)},clock_timestamp(),clock_timestamp());insert into public.workspace_clinics(id,name) values(${q(clinic)},'Concurrency A'),(${q(other)},'Concurrency B');insert into public.workspace_staff(user_id,role,display_name) values(${q(admin)},'admin','Fixture admin');`);
 // Removal versus new doctor assignment, both lock winners.
 let d=await legacy(),m=await member(),r=await row(d);
 await race(remove(d,r.version),`${actor}select public.assign_patient_clinical_case(${q(m)},0,${q(d)});`,/42501/,'remove wins native assignment');
 assert.equal(await checked(`select assigned_doctor_id is null from public.patient_clinical_cases where user_id=${q(m)};`),'t');
 d=await legacy();m=await member();r=await row(d);
 await race(`${actor}select public.assign_patient_clinical_case(${q(m)},0,${q(d)});`,remove(d,r.version),/23514/,'native assignment wins removal');
 assert.equal((await row(d)).active,true);
 // Legacy workspace assignment must share the same removal fence.
 let w=randomUUID();workspaces.push(w);d=await legacy();r=await row(d);
 await checked(`insert into public.workspace_cases(id) values(${q(w)});`);
 const refused=await race(remove(d,r.version),`${service}select public.workspace_assign_case(${q(w)},0,${q(d)});`,null,'remove wins workspace assignment');
 assert.equal(refused.out.trim(),'-1');
 w=randomUUID();workspaces.push(w);d=await legacy();r=await row(d);await checked(`insert into public.workspace_cases(id) values(${q(w)});`);
 await race(`${service}select public.workspace_assign_case(${q(w)},0,${q(d)});`,remove(d,r.version),/23514/,'workspace assignment wins removal');
 // Nurse assignment locks both responsible clinician and selected nurse.
 d=await legacy();m=await member(d);let n=await legacy('nurse');r=await row(n);
 await race(remove(n,r.version),`${actor}select public.assign_patient_case_nurse(${q(m)},0,${q(n)});`,/42501/,'remove wins nurse assignment');
 n=await legacy('nurse');r=await row(n);
 await race(`${actor}select public.assign_patient_case_nurse(${q(m)},0,${q(n)});`,remove(n,r.version),/23514/,'nurse assignment wins removal');
 // Finalization changes the version; removal cannot operate on the stale pending screen.
 let i=await verified();r=await row(i.expectedAuthUserId);
 await race(remove(i.expectedAuthUserId,r.version),finalize(i),/40001/,'remove wins finalize');
 assert.equal((await row(i.expectedAuthUserId)).active,false);
 i=await verified();r=await row(i.expectedAuthUserId);
 await race(finalize(i),remove(i.expectedAuthUserId,r.version),/40001/,'finalize wins stale removal');
 // Pending edits and activation share invitation -> membership lock order.
 i=await verified();r=await row(i.expectedAuthUserId);
 await race(edit(i.expectedAuthUserId,r.version,other),finalize(i),null,'pending clinic edit wins finalize');
 assert.equal((await row(i.expectedAuthUserId)).clinicId,other);
 i=await verified();r=await row(i.expectedAuthUserId);
 await race(finalize(i),edit(i.expectedAuthUserId,r.version,other),/40001/,'finalize wins stale pending edit');
 // Both orders of revocation and reissue invalidate the loser generation/version.
 i=await pending();await checked(`update public.real_staff_invitations set last_requested_at=clock_timestamp()-interval '3 minutes' where id=${q(i.id)};`);r=await row(i.expectedAuthUserId);
 await race(remove(i.expectedAuthUserId,r.version),reissue(i),/40001/,'remove wins reissue');
 i=await pending();await checked(`update public.real_staff_invitations set last_requested_at=clock_timestamp()-interval '3 minutes' where id=${q(i.id)};`);r=await row(i.expectedAuthUserId);
 await race(reissue(i),remove(i.expectedAuthUserId,r.version),/40001/,'reissue wins stale removal');
 // A clinic transfer serializes against assignment; assignment sees the new clinic.
 d=await legacy();m=await member();r=await row(d);
 await race(edit(d,r.version,other),`${actor}select public.assign_patient_clinical_case(${q(m)},0,${q(d)});`,/42501/,'clinic edit wins assignment');
 await checked(`${actor}select public.assign_patient_clinical_case(${q(m)},0,${q(d)});`);
 assert.equal((await row(d)).clinicId,other);
 d=await legacy();m=await member();r=await row(d);
 await race(`${actor}select public.assign_patient_clinical_case(${q(m)},0,${q(d)});`,edit(d,r.version,other),/23514/,'assignment wins clinic edit');
 // The real clinical helper holds the staff row through its existing source/hold checks.
 d=await legacy();m=await member(d);r=await row(d);
 const lock=`set request.jwt.claim.role='authenticated';set request.jwt.claims=${q(JSON.stringify({sub:d,role:'authenticated',session_id:d,amr:[{method:'password'}]}))};select public.lock_assigned_clinical_case(${q(m)},${q(d)},0,public.patient_clinical_evidence(${q(m)})->>'token');`;
 await race(lock,edit(d,r.version,other),/23514/,'clinical source/hold guard wins clinic edit');
 // A name edit can run with assignments; the clinical helper must wait for membership mutation.
 r=await row(d);await race(edit(d,r.version,clinic),lock,null,'management edit wins clinical source/hold guard');
 console.log('All staff-management concurrency scenarios passed.');
}finally{
 if(holder){holder.child.stdin.end('rollback;');await holder.done;}
 const ids=[admin,...staff,...members].map(q).join(',');
 await checked(`delete from public.real_staff_management_operations where actor_id=${q(admin)};delete from public.real_staff_admin_events where actor_id=${q(admin)} or clinic_id in(${q(clinic)},${q(other)}) or invitation_id in(select id from public.real_staff_invitations where clinic_id in(${q(clinic)},${q(other)}));delete from public.real_staff_invitations where clinic_id in(${q(clinic)},${q(other)});delete from public.workspace_cases where id in(${workspaces.length?workspaces.map(q).join(','):'null'});delete from public.patient_clinical_cases where user_id in(${members.length?members.map(q).join(','):'null'});delete from auth.users where id in(${ids});delete from public.workspace_clinics where id in(${q(clinic)},${q(other)});`);
}
