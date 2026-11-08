// Conversation grant renewal under two sessions (Fable review of #263, F1, 18 Oct). A live staff
// grant is only locked FOR SHARE: a delivery claim for another member of the same doctor and the
// doctor's second tab run in parallel with a workspace read. Two tabs renewing one lapsed grant at
// once make one renewal, no deadlock and no second row. Committed synthetic fixture (a7500000
// namespace), removed at the end.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
const container=process.env.NOREON_TEST_DB_CONTAINER;
if(!container?.startsWith('supabase_db_'))throw Error('Set NOREON_TEST_DB_CONTAINER to an isolated local Supabase container.');
const args=['exec','-i',container,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=(source,ok=true)=>{const r=spawnSync('docker',args,{input:source,encoding:'utf8'});if(ok)assert.equal(r.status,0,r.stderr);return r;};
const value=source=>JSON.parse(sql(source).stdout.trim().split('\n').filter(x=>x.startsWith('{')).at(-1));
const id=n=>`a7500000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const claims=(sub,sid,amr)=>JSON.stringify({sub,role:'authenticated',amr,session_id:sid});
const M1=id(1),M2=id(5),D=id(2),SM1=id(11),SM2=id(15),SD=id(12),K=id(9);
const asDoctor=body=>`begin;select set_config('request.jwt.claims','${claims(D,SD,[{method:'password'}])}',true);set local role authenticated;${body};commit;`;
// Runs a transaction that holds its locks for 2 s after the body, and resolves once the body ran.
const hold=async source=>{
 const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
 const completed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(Error(err)));});
 const ready=new Promise((resolve,reject)=>{child.stdout.on('data',d=>{out+=d;if(out.includes('LOCK_READY'))resolve();});child.on('exit',()=>{if(!out.includes('LOCK_READY'))reject(Error(err||'No lock marker'));});});
 child.stderr.on('data',d=>err+=d);
 child.stdin.end(source.replace(/commit;\s*$/,"select 'LOCK_READY';select pg_sleep(2);commit;"));
 await ready;return {completed};
};
const timed=fn=>{const t0=Date.now();const r=fn();return {r,ms:Date.now()-t0};};
const grant=()=>value(`select to_jsonb(g) from public.conversation_grants g where actor_id='${D}';`);
assert.equal(sql('select count(*) from public.conversation_policy;').stdout.trim(),'0','needs an unconfigured policy');
assert.equal(sql(`select count(*) from auth.users where id in('${M1}','${M2}','${D}');`).stdout.trim(),'0','fixture ids free');
let seeded=false;
try{
 sql(`begin;
 insert into auth.users(id,phone,phone_confirmed_at)values('${M1}','37499075001',now()),('${M2}','37499075005',now()),('${D}',null,null);
 insert into public.workspace_clinics(id,name)values('${K}','Grant lock clinic');
 insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('${D}','doctor','Dr Lock Synthetic','${K}');
 insert into auth.sessions(id,user_id,created_at,updated_at)values('${SM1}','${M1}',now(),now()),('${SM2}','${M2}',now(),now()),('${SD}','${D}',now(),now());
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('${M1}','${D}'),('${M2}','${D}');
 insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)values(true,'grant-lock-v1',3600,600,60,50,false,false,true);
 commit;`);seeded=true;
 assert.equal(value(asDoctor(`select public.conversation_workspace('${M1}')`)).ok,true,'grant created');
 const live=grant();
 assert.ok(new Date(live.expires_at)>new Date(),'grant is live: no renewal is due');

 // 1. A live grant: a doctor workspace read holds only a shared lock on it.
 {const held=await hold(asDoctor(`select public.conversation_workspace('${M1}')`));
  // As conversation_claim runs it: definer owner, create_grant=false, for share nowait.
  const claim=timed(()=>sql(`begin;select public._conversation_authorize('${M2}','${D}','${SD}','[{"method":"password"}]'::jsonb,true,false);commit;`,false));
  const tab=timed(()=>value(asDoctor(`select public.conversation_workspace('${M2}')`)));
  await held.completed;
  assert.equal(claim.r.status,0,`Claim-style check for another member is not blocked by a live read: ${claim.r.stderr}`);
  assert.equal(tab.r.ok,true);
  assert.ok(tab.ms<1500,`The doctor's second tab runs in parallel (waited ${tab.ms} ms)`);
  const after=grant();
  assert.deepEqual([after.id,after.generation,after.expires_at],[live.id,live.generation,live.expires_at],'Live grant untouched');
  console.log(`live grant: claim-style check passed in ${claim.ms} ms, second tab in ${tab.ms} ms`);}

 // 2. A lapsed grant renewed by two tabs at once: one renewal, one row, same id and generation, no deadlock.
 {sql(`update public.conversation_grants set expires_at=now()-interval '1 second' where actor_id='${D}';`);
  const held=await hold(asDoctor(`select public.conversation_workspace('${M1}')`));
  const tab=timed(()=>sql(asDoctor(`select public.conversation_workspace('${M2}')`),false));
  await held.completed;
  assert.equal(tab.r.status,0,`Second renewer waits, re-reads and passes: ${tab.r.stderr}`);
  const after=grant();
  assert.equal(sql(`select count(*) from public.conversation_grants where actor_id='${D}';`).stdout.trim(),'1','One grant row');
  assert.deepEqual([after.id,after.generation],[live.id,live.generation],'Renewal keeps id and generation');
  assert.ok(new Date(after.expires_at)>new Date(),'Renewed');
  console.log(`lapsed grant: second renewer passed after ${tab.ms} ms; one row, renewed`);}

 // 3. During a renewal a claim-style check fails fast (55P03), never hangs and never renews.
 {sql(`update public.conversation_grants set expires_at=now()-interval '1 second' where actor_id='${D}';`);
  const held=await hold(asDoctor(`select public.conversation_workspace('${M1}')`));
  const claim=timed(()=>sql(`begin;select public._conversation_authorize('${M2}','${D}','${SD}','[{"method":"password"}]'::jsonb,true,false);commit;`,false));
  await held.completed;
  assert.ok(claim.r.status!==0&&/could not obtain lock|55P03/.test(claim.r.stderr),'Claim during a renewal: lock_not_available');
  assert.ok(claim.ms<1500,`Fails fast (${claim.ms} ms)`);
  console.log(`renewal in progress: claim-style check 55P03 in ${claim.ms} ms`);}
 console.log('PASS conversation grant lock: live grants shared, one renewal under two tabs, claims fail fast only during a renewal');
}finally{
 if(seeded){
  sql(`begin;set local session_replication_role=replica;
   delete from public.conversation_grants where actor_id in('${M1}','${M2}','${D}');
   delete from public.access_audit where member_id in('${M1}','${M2}') or actor_id='${D}';
   delete from public.patient_clinical_cases where user_id in('${M1}','${M2}');
   delete from public.workspace_staff where user_id='${D}';
   delete from public.workspace_clinics where id='${K}';
   delete from auth.sessions where user_id in('${M1}','${M2}','${D}');
   delete from public.profiles where id in('${M1}','${M2}','${D}');
   delete from auth.users where id in('${M1}','${M2}','${D}');
   delete from public.conversation_policy where version='grant-lock-v1';commit;`);
  assert.equal(sql('select count(*) from public.conversation_policy;').stdout.trim(),'0');
 }
}
