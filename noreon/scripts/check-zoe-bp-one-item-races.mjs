// Both BP creation orders in real SQL sessions. Isolated replay DB only; no providers.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const container=process.env.NOREON_TEST_DB_CONTAINER;
const isolatedCi=process.env.GITHUB_ACTIONS==='true'&&(process.env.RUNNER_ENVIRONMENT==='github-hosted'||(process.env.RUNNER_ENVIRONMENT==='self-hosted'&&process.env.NOREON_ISOLATED_CI_RUNNER==='noreon-ci'))&&process.env.GITHUB_REPOSITORY==='noreon-health/noreon-core';
if(!container?.startsWith('supabase_db_')||(container==='supabase_db_noreon-core'&&!isolatedCi))throw Error('Set NOREON_TEST_DB_CONTAINER to an isolated replay container.');
const args=['exec','-i',container,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'];
const claims=`select set_config('request.jwt.claims','{"role":"service_role"}',true);`;
const sql=text=>{const r=spawnSync('docker',args,{input:`set statement_timeout='8s';${text}`,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim().split('\n').at(-1);};
const members=Array.from({length:10},()=>randomUUID()),readings=members.map(()=>randomUUID());
const doctor=randomUUID(),clinic=randomUUID(),sessions=[];
const originalSettings=JSON.parse(sql(`select json_build_object('enabled',enabled,'telegram_delivery',telegram_delivery,'sandbox_test_accounts',sandbox_test_accounts)from public._care_alert_settings();`));
const task=(i)=>`public.zoe_bp_task_raise('${members[i]}','physician','orange','bp_same_day','zones-v1-test','unknown',null,'{}',clock_timestamp()+interval '4 hours','race:orange','race','${readings[i]}',null,10)`;
const alert=i=>`public._bp_check_raise('${members[i]}','${readings[i]}','bp_doctor_today',clock_timestamp())`;
function session(){
 const child=spawn('docker',args);let out='',err='';
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,get out(){return out;},err}));});
 child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
 const s={child,done,name:`bp-race-${randomUUID()}`,output:()=>out};sessions.push(s);return s;
}
async function hold(text){
 const s=session();
 const ready=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('BP SQL lock marker timed out')),10000);
  s.child.stdout.on('data',()=>{if(s.output().includes('LOCK_READY')){clearTimeout(timer);resolve();}});
  s.done.then(r=>{clearTimeout(timer);if(!r.out.includes('LOCK_READY'))reject(Error(r.err||'Missing lock marker'));},reject);
 });
 s.child.stdin.write(`set statement_timeout='8s';begin;${claims}${text};\n\\echo LOCK_READY\n`);
 await ready;return s;
}
async function finish(s){s.child.stdin.end('commit;\n');const r=await s.done;assert.equal(r.code,0,r.err);return r.out;}
function pending(text){const s=session();s.child.stdin.end(`set application_name='${s.name}';set statement_timeout='8s';begin;${claims}${text};commit;\n`);return s;}
async function blocked(s){
 const end=Date.now()+5000;
 while(Date.now()<end){
  if(sql(`select exists(select 1 from pg_stat_activity where application_name='${s.name}'and wait_event_type='Lock');`)==='t')return;
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 throw Error('Expected concurrent BP operation to wait on the member lock');
}
async function result(s){const r=await s.done;assert.equal(r.code,0,r.err);return r.out.trim().split('\n').at(-1);}
const open=i=>Number(sql(`select(select count(*)from public.care_alerts where member_id='${members[i]}'and source='reading'and state<>'resolved')+(select count(*)from public.care_queue_tasks where member_id='${members[i]}'and queue='physician'and status in('sent','seen')and merged_into_alert_id is null)+(select count(*)from public.bp_repeat_notes where member_id='${members[i]}'and closed_at is null);`));
const resolve=i=>`update public.care_alerts set state='resolved',resolved_at=clock_timestamp(),resolved_by='${doctor}',resolution='member_contacted',acknowledged_at=clock_timestamp(),acknowledged_by='${doctor}',state_seq=state_seq+1 where member_id='${members[i]}'and state<>'resolved'`;
const save=(i,id,s,d,staff)=>`select set_config('request.jwt.claims','${JSON.stringify({role:'authenticated',sub:staff?doctor:members[i]})}',true);
 insert into public.patient_measurements(id,user_id,submission_id,systolic,diastolic,measured_at)values('${id}','${members[i]}',gen_random_uuid(),${s},${d},clock_timestamp())returning id`;
const taskFor=(i,id)=>`public.zoe_bp_task_raise('${members[i]}','physician','orange','bp_same_day','zones-v1-test','unknown',null,'{}',clock_timestamp()+interval '4 hours','race:orange','race','${id}',null,10)`;
try{
 // The real insert trigger is enabled only in this isolated replay DB. All
 // fixtures are test accounts; delivery stays disabled and settings are restored.
 sql(`begin;insert into public.care_alert_settings(enabled,telegram_delivery,sandbox_test_accounts)values(true,false,true)on conflict(singleton)do update set enabled=true,telegram_delivery=false,sandbox_test_accounts=true;
 insert into auth.users(id)values${[...members,doctor].map(m=>`('${m}')`).join(',')};
 insert into public.workspace_clinics(id,name)values('${clinic}','Synthetic BP race');
 insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('${doctor}','doctor','Synthetic BP race doctor','${clinic}');
 ${members.map((m,i)=>`update public.profiles set is_test_account=true where id='${m}';
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('${m}','${doctor}');
 insert into public.patient_measurements(id,user_id,submission_id,systolic,diastolic,measured_at)values('${readings[i]}','${m}',gen_random_uuid(),170,112,clock_timestamp());`).join('\n')}commit;`);
 // Alert commits while the task waits: the task sees it and never inserts.
 const a=await hold(`select ${alert(0)}`),t=pending(`select ${task(0)}`);
 // An independent member succeeds while the first member's lock is held.
 assert.equal(JSON.parse(sql(`begin;${claims}select ${task(3)};commit;`)).ok,true);
 await blocked(t);await finish(a);
 assert.equal(JSON.parse(await result(t)).code,'bp_alert');assert.equal(open(0),1);
 assert.equal(sql(`select count(*)from public.care_queue_tasks where member_id='${members[0]}';`),'0');
 // Task commits while the alert waits: the alert links it in the same transaction and it stays open.
 const t2=await hold(`select ${task(1)}`),a2=pending(`select ${alert(1)}`);
 await blocked(a2);await finish(t2);assert.equal(await result(a2),'t');assert.equal(open(1),1);
 assert.equal(sql(`select count(*)from public.care_queue_tasks where member_id='${members[1]}'and status in('sent','seen')and merged_into_alert_id is not null and closed_by is null;`),'1');
 // Two tabs on the same episode return the same row, then a replay cannot reopen it.
 const first=await hold(`select ${task(2)}`),second=pending(`select ${task(2)}`);
 await blocked(second);
 const firstOut=await finish(first),secondOut=JSON.parse(await result(second));
 const firstTask=JSON.parse(firstOut.split('\n').find(line=>line.startsWith('{"ok"')));
 assert.equal(firstTask.task.id,secondOut.task.id);assert.equal(secondOut.replayed,true);
 assert.equal(open(2),1);
 sql(`begin;${claims}select ${alert(2)};select ${task(2)};select public.zoe_bp_merge_retry(50);commit;`);
 assert.equal(open(2),1);
 assert.equal(sql(`select count(*)from public.care_queue_task_events e join public.care_queue_tasks t on t.id=e.task_id where t.member_id='${members[2]}'and e.detail->>'action'='bp_linked_to_alert';`),'1');
 // A save must finish while another session still owns the member lock. This
 // matches the staff entry point's 1.5 s timeout and exercises the real trigger.
 for(const [i,systolic,diastolic,staff]of [[4,185,112,true],[5,185,112,false],[6,150,95,true]]){
  if(i===6){
   sql(`begin;${save(i,randomUUID(),185,112,false)};commit;`);
   assert.equal(open(i),1,'A quiet note exists before the calm save times out');
  }
  const id=randomUUID();
  const locker=await hold(`select pg_advisory_xact_lock(hashtextextended('bp-episode:${members[i]}',0))`);
  const saver=pending(`set local lock_timeout='1500ms';${save(i,id,systolic,diastolic,staff)}`);
  await blocked(saver);
  assert.equal(await result(saver),id,'Contended save commits before the member lock is released');
  assert.equal(sql(`select exists(select 1 from public.patient_measurements where id='${id}');`),'t');
  const ref=i===4?id:`note:${id}`;
  assert.equal(sql(`select exists(select 1 from public.bp_check_retries where ref='${ref}');`),'t','Timeout leaves durable retry work');
  assert.equal(sql(`select count(*)from public.care_alerts where member_id='${members[i]}';`),'0');
  if(i===6)assert.equal(open(i),1,'The note remains until its durable close is retried');
  await finish(locker);
  const retry=JSON.parse(sql(`begin;${claims}select public.bp_check_retry(50);commit;`));
  assert.equal(retry.failed,0);
  assert.equal(sql(`select exists(select 1 from public.bp_check_retries where ref='${ref}');`),'f');
  assert.equal(open(i),i===6?0:1,'Sweep restores the alert/note, or completes a calm note close');
  if(i===4)assert.equal(sql(`select reason_code from public.care_alerts where member_id='${members[i]}'and state<>'resolved';`),'bp_doctor_today');
  if(i===5)assert.equal(sql(`select measurement_id from public.bp_repeat_notes where member_id='${members[i]}'and closed_at is null;`),id);
 }
 // Resolution owns the alert row first. Reconciliation must recheck its state
 // after waiting; a new unreviewed reading cannot merge into the resolved row.
 sql(`begin;${claims}select ${alert(7)};select public.zoe_bp_staff_item('${members[7]}','race','${readings[7]}',null,10);commit;`);
 const resolving=await hold(resolve(7)),newReading=randomUUID();
 const registering=pending(`${save(7,newReading,185,112,false)};${claims}select ${taskFor(7,newReading)}`);
 await blocked(registering);await finish(resolving);
 const registered=JSON.parse(await result(registering));
 assert.equal(registered.ok,true);assert.equal(registered.task.status,'sent');assert.equal(registered.task.zone,'orange');assert.equal(open(7),1);
 assert.equal(sql(`select count(*)from public.care_alerts where member_id='${members[7]}'and state='resolved';`),'1');
 // Registration owns the alert first. Its sequence change must reject a
 // resolution from the old screen, just as care_alert_resolve's guard does.
 sql(`begin;${claims}select ${alert(8)};select public.zoe_bp_staff_item('${members[8]}','race','${readings[8]}',null,10);commit;`);
 const oldSeq=Number(sql(`select state_seq from public.care_alerts where member_id='${members[8]}'and state<>'resolved';`));
 const later=randomUUID(),registration=await hold(`${save(8,later,185,112,false)};${claims}select ${taskFor(8,later)}`);
 const staleResolution=pending(`with changed as(${resolve(8)}and state_seq=${oldSeq} returning id)select count(*)from changed`);
 await blocked(staleResolution);await finish(registration);
 assert.equal(await result(staleResolution),'0','New evidence fences a stale resolution');assert.equal(open(8),1);
 // Sweeps only try the member lock: a busy member is skipped and keeps its work, and no sweep ever waits (so two sweeps cannot deadlock across members).
 {
  const r1=randomUUID(),r2=randomUUID(),m=9;
  sql(`begin;select set_config('request.jwt.claims','${JSON.stringify({role:'authenticated',sub:members[m]})}',true);
   insert into public.patient_measurements(id,user_id,submission_id,systolic,diastolic,measured_at)values('${r1}','${members[m]}',gen_random_uuid(),185,112,clock_timestamp()-interval '10 minutes');
   update public.bp_repeat_notes set closed_at=clock_timestamp() where member_id='${members[m]}' and closed_at is null;
   insert into public.bp_check_retries(ref,member_id,level,measured_at)values('note:${r1}','${members[m]}','note_open',clock_timestamp()-interval '10 minutes');commit;`);
  assert.equal(open(m),0,'Failed note leaves nothing open before the retry');
  // A calm save holds the member lock while it drains the stale retry. The sweep skips the member (does not wait) and cannot reopen the note.
  const calm=await hold(save(m,r2,130,80,false));
  const skipped=JSON.parse(sql(`begin;${claims}select public.bp_check_retry(50);commit;`));
  assert.ok(skipped.skipped>=1,'Retry sweep skips a member whose lock is held instead of waiting');
  await finish(calm);
  assert.equal(open(m),0,'A stale note retry does not reopen the note a newer calm save closed');
  assert.equal(sql(`select count(*)from public.bp_check_retries where member_id='${members[m]}';`),'0');
  // The merge sweep skips a held member too (member 7 has an episode row).
  const locker=await hold(`select pg_advisory_xact_lock(hashtextextended('bp-episode:${members[7]}',0))`);
  const merge=JSON.parse(sql(`begin;${claims}select public.zoe_bp_merge_retry(50);commit;`));
  assert.ok(merge.skipped>=1,'Merge sweep skips a held member instead of waiting');
  await finish(locker);
 }
 console.log('BP one item: creation/replay races, alert/note/calm save timeouts, retry recovery, and both resolution orders passed.');
}finally{
 for(const s of sessions){if(!s.child.stdin.destroyed&&!s.child.stdin.writableEnded)s.child.stdin.end('rollback;\n');await s.done;}
 // Follow the isolated-race cleanup convention: append-only guards are disabled
 // only for deletion of these synthetic fixtures, never in application code.
 sql(`begin;set local session_replication_role=replica;
 ${originalSettings.enabled===null?'delete from public.care_alert_settings;':`update public.care_alert_settings set enabled=${originalSettings.enabled},telegram_delivery=${originalSettings.telegram_delivery},sandbox_test_accounts=${originalSettings.sandbox_test_accounts};`}
 ${['care_queue_task_events','care_queue_tasks'].map(table=>table==='care_queue_task_events'?`delete from public.${table} where task_id in(select id from public.care_queue_tasks where member_id in(${members.map(m=>`'${m}'`).join(',')}));`:`delete from public.${table} where member_id in(${members.map(m=>`'${m}'`).join(',')});`).join('\n')}
 delete from public.zoe_bp_staff_items where member_id in(${members.map(m=>`'${m}'`).join(',')});
 delete from public.care_alert_audit where alert_id in(select id from public.care_alerts where member_id in(${members.map(m=>`'${m}'`).join(',')}));
 delete from public.care_alert_deliveries where alert_id in(select id from public.care_alerts where member_id in(${members.map(m=>`'${m}'`).join(',')}));
 ${['conversation_trace_events','care_alert_screenings','care_alerts','bp_repeat_notes','bp_check_retries'].map(table=>`delete from public.${table} where member_id in(${members.map(m=>`'${m}'`).join(',')});`).join('\n')}
 delete from public.patient_measurements where user_id in(${members.map(m=>`'${m}'`).join(',')});
 delete from public.patient_clinical_cases where user_id in(${members.map(m=>`'${m}'`).join(',')});
 delete from public.workspace_staff where user_id='${doctor}';
 delete from public.profiles where id in(${[...members,doctor].map(m=>`'${m}'`).join(',')});
 delete from auth.users where id in(${[...members,doctor].map(m=>`'${m}'`).join(',')});
 delete from public.workspace_clinics where id='${clinic}';commit;`);
}
