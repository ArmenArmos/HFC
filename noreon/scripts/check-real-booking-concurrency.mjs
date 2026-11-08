/** Real independent PostgreSQL sessions on a fresh, explicitly owned synthetic replay only. */
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const container=process.env.NOREON_TEST_DB_CONTAINER;
const owned=container==='supabase_db_noreon-clinic-settings-qa'||container==='supabase_db_noreon-mvp-combined-replay-20261014'||container==='supabase_db_noreon-real-booking-replay-20261013'||container==='supabase_db_noreon-real-booking-verification-2026101';
const ci=process.env.GITHUB_ACTIONS==='true'&&process.env.CI==='true'&&container==='supabase_db_noreon-core';
if(!owned&&!ci)throw Error('Owned booking replay or repository CI database required');
const args=['exec','-i',container,'psql','-U','postgres','-d','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=text=>execFileSync('docker',args,{input:text,encoding:'utf8'}).trim();
function session(){
 const child=spawn('docker',args);let out='',err='',readyResolve;const ready=new Promise(r=>readyResolve=r);
 child.stdout.on('data',x=>{out+=x;if(out.includes('BOOKING_READY'))readyResolve();});child.stderr.on('data',x=>err+=x);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,out,err}));});
 child.stdin.write("\\set VERBOSITY verbose\nset statement_timeout='6s';\n");
 return {child,ready,done};
}
async function run(text){const s=session();s.child.stdin.end(text);return s.done;}
const member=randomUUID(),admin=randomUUID(),request=randomUUID(),command=randomUUID();let holder;
try{
 sql(`insert into auth.users(id,phone,phone_confirmed_at) values('${member}','37499008881',now()),('${admin}',null,null);update public.profiles set display_name='SYNTHETIC booking concurrency',birth_date='1980-01-01',biological_sex='female' where id='${member}';insert into public.patient_consents(user_id,version) values('${member}','patient-pilot-v1');insert into public.patient_assessments(user_id,completed_at) values('${member}',now());insert into public.workspace_staff(user_id,role,display_name) values('${admin}','admin','SYNTHETIC admin');`);
 const token=sql(`select public.patient_test_context('${member}')->>'token'`);
 const terms=JSON.stringify({startsAt:new Date(Date.now()+864000000).toISOString(),endsAt:new Date(Date.now()+867600000).toISOString(),timezone:'Asia/Yerevan',mode:'clinic',location:'Synthetic location'});
 sql(`select public._legacy_create_patient_test_request('${member}','${request}','${token}','${terms}','[{"id":"lipid-panel","title":"Lipid panel","method":"lab"}]','test-engine');`);
 const confirm=(revision,id)=>`select set_config('request.jwt.claim.sub','${admin}',false);set role service_role;select public.command_patient_test_request('${member}','${admin}',true,'${request}',${revision},'${id}','confirm',jsonb_build_object('provider','SYNTHETIC provider','terms','${terms}'::jsonb,'obtainedAt',now(),'channel','phone','source','Synthetic test only','preparation','Synthetic provider preparation','engine','{"sourceToken":"${token}","version":"test-engine","tests":[{"id":"lipid-panel","title":"Lipid panel","method":"lab"}]}'::jsonb));`;
 // A case lock prevents a competing confirmation from slipping past CAS, with bounded conflict.
 holder=session();holder.child.stdin.write(`begin;select 1 from public.patient_clinical_cases where user_id='${member}' for update;\n\\echo BOOKING_READY\n`);await holder.ready;
 let result=await run(confirm(0,command));assert.notEqual(result.code,0);assert.match(result.err,/55P03/);
 holder.child.stdin.end('rollback;');await holder.done;holder=null;
 // A source mutation in progress blocks booking confirmation before any operational state changes.
 holder=session();holder.child.stdin.write(`begin;update public.patient_assessments set revision=revision+1 where user_id='${member}';\n\\echo BOOKING_READY\n`);await holder.ready;
 result=await run(confirm(0,command));assert.notEqual(result.code,0);assert.match(result.err,/55P03/);
 holder.child.stdin.end('rollback;');await holder.done;holder=null;
 // An independently committed crisis insert after derivation must reject the old
 // source token even though the stable request requirements have not changed.
 const crisisId=randomUUID();
 result=await run(`insert into public.patient_measurements(id,user_id,submission_id,systolic,diastolic,measured_at) values('${crisisId}','${member}',gen_random_uuid(),190,120,now());`);
 assert.equal(result.code,0,result.err);
 result=await run(confirm(0,command));assert.notEqual(result.code,0);assert.match(result.err,/40001/);
 assert.equal(sql(`select revision from public.patient_test_requests where id='${request}'`),'0');
 sql(`delete from public.patient_measurements where id='${crisisId}';`);
 // Two actual simultaneous same-revision commands: exactly one can commit.
 const competing=await Promise.all([run(confirm(0,command)),run(confirm(0,randomUUID()))]);
 assert.equal(competing.filter(r=>r.code===0).length,1,JSON.stringify(competing));
 assert.match(competing.find(r=>r.code!==0).err,/40001|55P03/);
 assert.equal(sql(`select revision from public.patient_test_requests where id='${request}'`),'1');
 // Active staff row updates hold source locks, so revocation cannot race confirmation.
 holder=session();holder.child.stdin.write(`begin;update public.workspace_staff set active=false where user_id='${admin}';\n\\echo BOOKING_READY\n`);await holder.ready;
 result=await run(confirm(1,randomUUID()));assert.notEqual(result.code,0);assert.match(result.err,/55P03/);
 holder.child.stdin.end('commit;');await holder.done;holder=null;
 result=await run(confirm(1,randomUUID()));assert.notEqual(result.code,0);assert.match(result.err,/42501/);
 console.log('Booking database concurrency passed: bounded case/source contention, one CAS winner, post-derivation crisis rejects old source, revocation blocks commit. Synthetic only; no provider contacted.');
}finally{
 if(holder){holder.child.stdin.end('rollback;');await holder.done;}
 sql(`delete from public.patient_test_request_events where request_id='${request}';delete from public.patient_test_requests where id='${request}';delete from public.patient_clinical_cases where user_id='${member}';delete from public.workspace_staff where user_id='${admin}';delete from auth.users where id in ('${member}','${admin}');`);
}
