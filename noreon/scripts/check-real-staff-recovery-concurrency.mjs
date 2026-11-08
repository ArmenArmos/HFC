/** Actual concurrent PostgreSQL transactions in an explicitly owned replay DB. */
import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';import {staffManagementTestDatabaseAllowed} from './staff-management-test-database.mjs';
const container=process.env.NOREON_TEST_DB_CONTAINER;if(!staffManagementTestDatabaseAllowed(container))throw Error('Owned replay database required');
const admin=randomUUID(),doctor=randomUUID(),clinic=randomUUID(),adminSession=randomUUID(),recoverySession=randomUUID();const q=x=>`'${String(x).replaceAll("'","''")}'`;
function sql(source){return new Promise((resolve,reject)=>{const child=spawn('docker',['exec','-i',container,'psql','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres']);let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('close',code=>resolve({code,out:out.trim(),err}));child.stdin.end("set statement_timeout='8s';\n"+source);});}
async function checked(source){const result=await sql(source);assert.equal(result.code,0,result.err);return result.out;}
const actor=`set request.jwt.claims=${q(JSON.stringify({sub:admin,role:'authenticated',session_id:adminSession,amr:[{method:'password'}]}))};set role authenticated;`;
const service="set request.jwt.claims='{\"role\":\"service_role\"}';set role service_role;";
const operation=(id,g,step)=>`${service}select public.real_staff_recovery_step(${q(id)},${g},${q(step)},repeat('a',64),${q(recoverySession)});`;
let op,g;
try{
 await checked(`insert into auth.users(id,email,email_confirmed_at) values(${q(admin)},${q(admin+'@example.invalid')},clock_timestamp()),(${q(doctor)},${q(doctor+'@example.invalid')},clock_timestamp());insert into auth.sessions(id,user_id,created_at,updated_at) values(${q(adminSession)},${q(admin)},clock_timestamp(),clock_timestamp()),(${q(recoverySession)},${q(doctor)},clock_timestamp(),clock_timestamp());insert into public.workspace_clinics(id,name,active)values(${q(clinic)},'Recovery concurrency fixture',true);insert into public.workspace_staff(user_id,role,display_name,clinic_id,active) values(${q(admin)},'admin','Recovery concurrency admin',null,true),(${q(doctor)},'doctor','Recovery concurrency doctor',${q(clinic)},true);`);
 const version=JSON.parse(await checked(`${actor}select x from jsonb_array_elements(public.real_admin_staff()) x where x->>'id'=${q(doctor)};`)).version,req=randomUUID();
 const reserve=`${actor}select public.real_admin_request_staff_recovery(${q(doctor)},${q(version)},${q(req)});`;
 const requests=await Promise.all([sql(reserve),sql(reserve)]);assert.ok(requests.every(r=>r.code===0));const parsed=requests.map(r=>JSON.parse(r.out));assert.equal(parsed[0].id,parsed[1].id);op=parsed[0].id;g=parsed[0].generation;
 const claims=await Promise.all([sql(`${service}select public.real_staff_recovery_step(${q(op)},${g},'claim-dispatch');`),sql(`${service}select public.real_staff_recovery_step(${q(op)},${g},'claim-dispatch');`)]);assert.ok(claims.every(r=>r.code===0));assert.equal(claims.map(r=>JSON.parse(r.out).claimed).filter(Boolean).length,1);
 await checked(`${service}select public.real_staff_recovery_step(${q(op)},${g},'token',repeat('a',64));select public.real_staff_recovery_step(${q(op)},${g},'verify',repeat('a',64),${q(recoverySession)});`);
 const passwords=await Promise.all([sql(operation(op,g,'claim-password')),sql(operation(op,g,'claim-password'))]);assert.ok(passwords.every(r=>r.code===0));assert.equal(passwords.map(r=>JSON.parse(r.out).claimed).filter(Boolean).length,1);
 const complete=await Promise.all([sql(operation(op,g,'complete')),sql(operation(op,g,'complete'))]);assert.ok(complete.every(r=>r.code===0));assert.equal(Number(await checked(`select count(*) from public.real_staff_recovery_events where recovery_id=${q(op)} and kind='password_saved';`)),1);
 // A new generation supersedes the first only after the configured cooldown.
 await checked(`update public.real_staff_recoveries set issued_at=clock_timestamp()-interval '61 seconds' where id=${q(op)};`);
 const newer=JSON.parse(await checked(`${actor}select public.real_admin_request_staff_recovery(${q(doctor)},${q(version)},${q(randomUUID())});`));op=newer.id;g=newer.generation;
 await checked(`${service}select public.real_staff_recovery_step(${q(op)},${g},'claim-dispatch');select public.real_staff_recovery_step(${q(op)},${g},'token',repeat('a',64));select public.real_staff_recovery_step(${q(op)},${g},'verify',repeat('a',64),${q(recoverySession)});`);
 const admitted=sql(`begin;${operation(op,g,'claim-password')}select pg_sleep(0.3);commit;`);
 const removal=sql(`begin;select pg_sleep(0.05);${actor}select public.real_admin_remove_staff(${q(doctor)},${q(version)},${q(randomUUID())});commit;`);
 const ordered=await Promise.all([admitted,removal]);assert.ok(ordered.every(r=>r.code===0));const denied=await sql(operation(op,g,'complete'));assert.notEqual(denied.code,0);assert.match(denied.err,/Active clinical staff required/);
 assert.equal(await checked(`select active::text from public.workspace_staff where user_id=${q(doctor)};`),'false');
 console.log('Recovery concurrency: identical request one operation, dispatch/password claim one winner, completion one audit, removal after admission denies completion and never reactivates.');
}finally{
 await checked(`delete from public.real_staff_recovery_events where recovery_id in(select id from public.real_staff_recoveries where staff_id=${q(doctor)});delete from public.real_staff_recoveries where staff_id=${q(doctor)};delete from public.real_staff_management_operations where actor_id=${q(admin)};delete from public.real_staff_admin_events where actor_id=${q(admin)};delete from auth.users where id in(${q(admin)},${q(doctor)});delete from public.workspace_clinics where id=${q(clinic)};`);
}
