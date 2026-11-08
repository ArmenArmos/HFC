// Two real sessions in an isolated replay DB. Synthetic fixtures only; cleanup always runs.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const container=process.env.NOREON_TEST_DB_CONTAINER;
const isolatedCi=process.env.GITHUB_ACTIONS==='true'&&(process.env.RUNNER_ENVIRONMENT==='github-hosted'||(process.env.RUNNER_ENVIRONMENT==='self-hosted'&&process.env.NOREON_ISOLATED_CI_RUNNER==='noreon-ci'))&&process.env.GITHUB_REPOSITORY==='noreon-health/noreon-core';
if(!container?.startsWith('supabase_db_')||(container==='supabase_db_noreon-core'&&!isolatedCi))throw Error('Set NOREON_TEST_DB_CONTAINER to an isolated local replay container.');
const args=['exec','-i',container,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
const sql=(text,ok=true)=>{const r=spawnSync('docker',args,{input:`set statement_timeout='5s';${text}`,encoding:'utf8'});if(ok)assert.equal(r.status,0,r.stderr);return r;};
const value=text=>sql(text).stdout.trim().split('\n').at(-1);
const member=randomUUID(),doctor=randomUUID(),other=randomUUID(),clinic=randomUUID(),sid=randomUUID(),alert=randomUUID();
const nurse=randomUUID(),replacementNurse=randomUUID(),nurseSid=randomUUID(),conversation=randomUUID(),run=randomUUID();
const claims=JSON.stringify({sub:doctor,role:'authenticated',session_id:sid,amr:[{method:'password'}]});
const login=`select set_config('request.jwt.claims','${claims}',true);set local role authenticated;`;
const resolve=`public.care_alert_resolve('${alert}',0,'member_contacted','Synthetic reason')`;
const nurseClaims=JSON.stringify({sub:nurse,role:'authenticated',session_id:nurseSid,amr:[{method:'password'}]});
const nurseLogin=`select set_config('request.jwt.claims','${nurseClaims}',true);set local role authenticated;`;
const resolveAlert=(id,seq=0)=>`public.care_alert_resolve('${id}',${seq},'member_contacted','Synthetic reason')`;
const acknowledgeAlert=id=>`public.care_alert_acknowledge('${id}',0)`;
const call=(as,expression)=>JSON.parse(value(`begin;${as}select ${expression};commit;`));
function freshAlert(){
 const id=randomUUID();
 sql(`insert into public.care_alerts(id,member_id,source,reason_code,rule_id,rule_version,source_ref,doctor_id)
  values('${id}','${member}','zoe','synthetic_race','synthetic.race','1','synthetic-${id}','${doctor}');`);
 return id;
}
function assertResolved(id,seq,acknowledger){
 assert.equal(value(`select state||':'||state_seq||':'||acknowledged_by::text||':'||resolved_by::text||':'||resolution||':'||resolution_note
  from public.care_alerts where id='${id}';`),`resolved:${seq}:${acknowledger}:${doctor}:member_contacted:Synthetic reason`);
 assert.equal(value(`select count(*)from public.care_alert_audit where alert_id='${id}'and kind='acknowledged';`),'1','Exactly one acknowledgement for the cycle');
 assert.equal(value(`select count(*)from public.care_alert_audit where alert_id='${id}'and kind='resolved';`),'1','Exactly one resolution for the cycle');
 assert.equal(value(`select count(*)from public.care_alert_audit where alert_id='${id}'and kind='acknowledged'and actor_id='${acknowledger}';`),'1');
 assert.equal(value(`select count(*)from public.care_alert_audit where alert_id='${id}'and kind='resolved'and actor_id='${doctor}';`),'1');
 assert.equal(value(`select acknowledged_at>=cycle_started_at and resolved_at>=acknowledged_at from public.care_alerts where id='${id}';`),'t','Cycle times are ordered');
}
function refuseOverlap(as,expression){
 const refused=sql(`begin;${as}select ${expression};commit;`,false);
 assert.notEqual(refused.status,0,'Overlapping alert mutation must refuse while the winner holds the case');
 assert.match(refused.stderr,/55P03/,'The existing NOWAIT boundary fails closed');
}
function assertDirectAcknowledgement(id){
 assert.equal(value(`select count(*)from public.care_alerts a
  join public.care_alert_audit ack on ack.alert_id=a.id and ack.kind='acknowledged'
  join public.care_alert_audit done on done.alert_id=a.id and done.kind='resolved'
  where a.id='${id}'and ack.actor_id=done.actor_id and ack.detail->>'via'='resolve'
  and ack.xmin=done.xmin and done.xmin=a.xmin;`),'1','Direct acknowledgement and resolution share actor and transaction');
}
const sessions=[];
async function hold(text){
 const child=spawn('docker',args);let out='',err='';
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,out,err}));});
 const ready=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('SQL lock marker timed out')),10000);
  child.stdout.on('data',d=>{out+=d;if(out.includes('LOCK_READY')){clearTimeout(timer);resolve();}});
  child.on('error',e=>{clearTimeout(timer);reject(e);});
  child.on('close',()=>{clearTimeout(timer);if(!out.includes('LOCK_READY'))reject(Error(err||'No SQL lock marker'));});
 });
 child.stderr.on('data',d=>err+=d);
 const session={child,done};sessions.push(session);
 child.stdin.write(`set statement_timeout='5s';begin;${text}\n\\echo LOCK_READY\n`);
 await ready;return session;
}
function concurrent(text){
 const child=spawn('docker',args);let out='',err='';
 const session={child,completed:false};
 session.done=new Promise((resolve,reject)=>{
  child.on('error',reject);
  child.on('close',code=>{session.completed=true;resolve({code,out,err});});
 });
 child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
 sessions.push(session);child.stdin.end(`set statement_timeout='5s';${text}`);
 return session;
}
async function blocked(session,label){
 const deadline=Date.now()+4000;
 while(Date.now()<deadline){
  const waiting=value(`select count(*)from pg_stat_activity where application_name='${label}'and wait_event_type='Lock'and cardinality(pg_blocking_pids(pid))>0;`);
  if(waiting==='1')return;
  assert.equal(session.completed,false,'Alert raise must wait while assignment owns the case');
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw Error('Alert raise did not reach the assignment lock');
}
async function finish(s,command='rollback'){
 s.child.stdin.end(`${command};\n`);const r=await s.done;assert.equal(r.code,0,r.err);
}
try{
 sql(`begin;
 insert into auth.users(id)values('${member}'),('${doctor}'),('${other}'),('${nurse}'),('${replacementNurse}');
 insert into auth.sessions(id,user_id,created_at,updated_at)values('${sid}','${doctor}',now(),now()),('${nurseSid}','${nurse}',now(),now());
 insert into public.workspace_clinics(id,name)values('${clinic}','Synthetic alert race clinic');
 insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('${doctor}','doctor','Synthetic first doctor','${clinic}'),('${other}','doctor','Synthetic replacement doctor','${clinic}'),
 ('${nurse}','nurse','Synthetic first nurse','${clinic}'),('${replacementNurse}','nurse','Synthetic replacement nurse','${clinic}');
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values('${member}','${doctor}','${nurse}');
 insert into public.care_alerts(id,member_id,source,reason_code,rule_id,rule_version,source_ref,doctor_id)
 values('${alert}','${member}','message','synthetic_race','synthetic.race','1','synthetic-race','${doctor}');commit;`);
 // Two authorized resolvers overlap on an unacknowledged alert. The winner has
 // executed its RPC but keeps the transaction open until the loser hits NOWAIT.
 const doubleResolve=freshAlert();
 const firstResolver=await hold(`${login}do $$begin if (${resolveAlert(doubleResolve)})->>'changed'is distinct from 'true'then raise exception 'TEST first resolve refused';end if;end$$;`);
 refuseOverlap(nurseLogin,resolveAlert(doubleResolve));
 await finish(firstResolver,'commit');
 const secondResolve=call(nurseLogin,resolveAlert(doubleResolve));
 assert.equal(secondResolve.ok,true);assert.equal(secondResolve.changed,false,'Second resolver retries as an existing resolved no-op');
 assert.equal(secondResolve.alert.stateSeq,1);
 assertResolved(doubleResolve,1,doctor);assertDirectAcknowledgement(doubleResolve);

 // Acknowledge wins: an overlapping resolve is refused, its stale retry sees
 // changed, then a fresh-sequence resolve preserves the nurse acknowledgement.
 const acknowledgeFirst=freshAlert();
 const acknowledgement=await hold(`${nurseLogin}do $$begin if (${acknowledgeAlert(acknowledgeFirst)})->>'changed'is distinct from 'true'then raise exception 'TEST acknowledge refused';end if;end$$;`);
 refuseOverlap(login,resolveAlert(acknowledgeFirst));
 await finish(acknowledgement,'commit');
 const acknowledgedAt=value(`select acknowledged_at from public.care_alerts where id='${acknowledgeFirst}';`);
 const staleResolve=call(login,resolveAlert(acknowledgeFirst));
 assert.equal(staleResolve.ok,false);assert.equal(staleResolve.code,'changed');
 assert.equal(staleResolve.alert.stateSeq,1);
 assert.equal(value(`select state||':'||state_seq from public.care_alerts where id='${acknowledgeFirst}';`),'acknowledged:1');
 assert.equal(value(`select count(*)from public.care_alert_audit where alert_id='${acknowledgeFirst}'and kind='acknowledged';`),'1');
 assert.equal(value(`select count(*)from public.care_alert_audit where alert_id='${acknowledgeFirst}'and kind='resolved';`),'0','Stale resolve leaves no resolution audit');
 const freshResolve=call(login,resolveAlert(acknowledgeFirst,1));
 assert.equal(freshResolve.ok,true);assert.equal(freshResolve.changed,true);assert.equal(freshResolve.alert.stateSeq,2);
 assertResolved(acknowledgeFirst,2,nurse);
 assert.equal(value(`select acknowledged_at from public.care_alerts where id='${acknowledgeFirst}';`),acknowledgedAt,'Resolution preserves the winning acknowledgement time');

 // Resolve wins: an overlapping acknowledgement is refused; after commit it
 // takes the existing non-open no-op, even with its original sequence.
 const resolveFirst=freshAlert();
 const winningResolve=await hold(`${login}do $$begin if (${resolveAlert(resolveFirst)})->>'changed'is distinct from 'true'then raise exception 'TEST winning resolve refused';end if;end$$;`);
 refuseOverlap(nurseLogin,acknowledgeAlert(resolveFirst));
 await finish(winningResolve,'commit');
 const lateAcknowledge=call(nurseLogin,acknowledgeAlert(resolveFirst));
 assert.equal(lateAcknowledge.ok,true);assert.equal(lateAcknowledge.changed,false,'Acknowledgement after resolution is a no-op');
 assert.equal(lateAcknowledge.alert.stateSeq,1);
 assertResolved(resolveFirst,1,doctor);assertDirectAcknowledgement(resolveFirst);
 // Reassignment wins first: pending assignment blocks the old doctor, and committed assignment denies them.
 const assignment=await hold(`update public.patient_clinical_cases set assigned_doctor_id='${other}'where user_id='${member}';`);
 const denied=sql(`begin;${login}select ${resolve};rollback;`,false);
 assert.notEqual(denied.status,0,'Resolve must refuse while reassignment owns the case');
 assert.match(denied.stderr,/55P03/,'Case lock contention fails closed');
 await finish(assignment,'commit');
 assert.equal(JSON.parse(value(`begin;${login}select ${resolve};commit;`)).code,'not_found','Old doctor cannot resolve after reassignment');
 assert.equal(value(`select state||':'||state_seq from public.care_alerts where id='${alert}';`),'open:0');
 assert.equal(value(`select count(*)from public.care_alert_audit where alert_id='${alert}'and kind='resolved';`),'0');
 sql(`update public.patient_clinical_cases set assigned_doctor_id='${doctor}'where user_id='${member}';`);
 // Resolve wins first: assignment and authorization changes cannot commit until resolution ends.
 const resolution=await hold(`${login}do $$begin if (${resolve})->>'changed'is distinct from 'true'then raise exception 'TEST resolution refused';end if;end$$;`);
 for(const [label,table,predicate]of [
  ['assignment','public.patient_clinical_cases',`user_id='${member}'`],
  ['staff authorization','public.workspace_staff',`user_id='${doctor}'`],
  ['session authorization','auth.sessions',`id='${sid}'`],
 ]){
  const blocked=sql(`begin;select 1 from ${table} where ${predicate} for update nowait;rollback;`,false);
  assert.notEqual(blocked.status,0,`${label} cannot change during resolution`);assert.match(blocked.stderr,/55P03/);
 }
 await finish(resolution,'commit');
 sql(`update public.patient_clinical_cases set assigned_doctor_id='${other}'where user_id='${member}';`);
 assert.equal(value(`select state||':'||state_seq from public.care_alerts where id='${alert}';`),'resolved:1');
 assert.equal(value(`select count(*)from public.care_alert_audit where alert_id='${alert}'and kind='resolved';`),'1');
 // Raising an alert takes the case before any alert/advisory lock. A repeat must
 // not read D1 then overwrite committed D2; a newly inserted alert must not miss
 // the rerouting transaction by becoming visible only after its scan.
 for(const [label,source,repeat]of [['repeat','message',true],['new','lab',false]]){
  sql(`update public.patient_clinical_cases set assigned_doctor_id='${doctor}'where user_id='${member}';`);
  if(repeat){
   sql(`select public._care_alert_raise('${member}','${source}','synthetic_race','{}','synthetic.race','1','synthetic-before-assignment');`);
   assert.equal(value(`select doctor_id from public.care_alerts where member_id='${member}'and source='${source}'and state<>'resolved';`),doctor);
  }else assert.equal(value(`select count(*)from public.care_alerts where member_id='${member}'and source='${source}'and state<>'resolved';`),'0');
  const reassignment=await hold(`update public.patient_clinical_cases set assigned_doctor_id='${other}'where user_id='${member}';
   select public._care_team_reconcile('${member}','${other}','staff',null);`);
  const application=`alert-assignment-${label}-${randomUUID()}`;
  const raising=concurrent(`set application_name='${application}';begin;
   select public._care_alert_raise('${member}','${source}','synthetic_race','{}','synthetic.race','1','synthetic-during-assignment-${label}');commit;`);
  await blocked(raising,application);
  await finish(reassignment,'commit');
  const raised=await raising.done;assert.equal(raised.code,0,raised.err);
  assert.equal(value(`select doctor_id from public.care_alerts where member_id='${member}'and source='${source}'and state<>'resolved';`),other,
   `${label} alert must pin the committed replacement doctor`);
  assert.equal(value(`select count(*)from public.care_alerts where member_id='${member}'and source='${source}'and state<>'resolved';`),'1',`${label} keeps exactly one live alert`);
 }
 // The Zoe forward trigger is another task producer. It must read the final
 // nurse after assignment commits, rather than insert work for the old nurse.
 // Replica mode only brackets fictional switch setup/restoration; the forward
 // insert runs with every real trigger enabled. No config audit fixtures remain.
 const nurseChat=value('select enabled from public.nurse_chat_settings where singleton;');
 assert.match(nurseChat,/^[tf]$/,'Nurse chat singleton exists in replay');
 sql(`begin;
  update public.patient_clinical_cases set assigned_doctor_id='${doctor}'where user_id='${member}';
  update public.patient_clinical_cases set assigned_nurse_id='${nurse}'where user_id='${member}';
  insert into public.conversations(id,member_id)values('${conversation}','${member}');
  insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,state,outcome,spend_day,finished_at)
  values('${run}','${conversation}','${member}',1,0,0,'finished','answered',current_date,clock_timestamp());commit;`);
 const nurseAssignment=await hold(`update public.patient_clinical_cases set assigned_doctor_id='${other}'where user_id='${member}';
  update public.patient_clinical_cases set assigned_nurse_id='${replacementNurse}'where user_id='${member}';
  select public._care_team_reconcile('${member}','${other}','staff',null);`);
 const nurseApplication=`zoe-nurse-assignment-${randomUUID()}`;
 const forwarding=concurrent(`set application_name='${nurseApplication}';begin;
  set local session_replication_role=replica;
  update public.nurse_chat_settings set enabled=true where singleton;
  set local session_replication_role=origin;
  insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values('${conversation}',null,'zoe.forward',
   jsonb_build_object('runId','${run}','forward','auto','reason','mild_side_effect','urgency','doctor_soon'));
  set local session_replication_role=replica;
  update public.nurse_chat_settings set enabled=${nurseChat==='t'?'true':'false'} where singleton;
  set local session_replication_role=origin;commit;`);
 await blocked(forwarding,nurseApplication);
 await finish(nurseAssignment,'commit');
 const forwarded=await forwarding.done;assert.equal(forwarded.code,0,forwarded.err);
 assert.equal(value(`select detail->>'outcome'from public.conversation_audit where conversation_id='${conversation}'and kind='zoe.nurse_first';`),'task',
  'The real Zoe forward trigger creates a task after waiting');
 assert.equal(value(`select owner_id::text||':'||creator_id::text from public.patient_coordination_tasks where id=md5('zoe-nurse-first:${run}')::uuid;`),`${replacementNurse}:${other}`,
  'Concurrent forward uses the committed replacement nurse and doctor');
 assert.equal(value(`select new_owner_id from public.patient_coordination_events where task_id=md5('zoe-nurse-first:${run}')::uuid;`),replacementNurse,
  'Zoe task creation event records the final nurse');
 assert.equal(value('select enabled from public.nurse_chat_settings where singleton;'),nurseChat,'Nurse chat setting is restored within the producer transaction');
 console.log('Alert resolve: both reassignment orderings, assignment/session/staff locks, one resolution audit, two overlapping resolvers, both acknowledge/resolve orderings with one acknowledgement and consistent stateSeq, and repeat/new alert overlap and Zoe nurse-task overlap with committed replacement routing pass in real SQL sessions.');
}finally{
 for(const s of sessions){if(!s.child.stdin.destroyed&&!s.child.stdin.writableEnded)s.child.stdin.end('rollback;\n');await s.done;}
 sql(`begin;set local session_replication_role=replica;
 delete from public.conversation_trace_events where member_id='${member}';
 delete from public.care_alert_deliveries where alert_id in(select id from public.care_alerts where member_id='${member}');
 -- Let the normal FK cascade clean up synthetic alert audits; never delete
 -- append-only audit rows directly or disable their immutability trigger.
 set local session_replication_role=origin;
 delete from public.care_alerts where member_id='${member}';
 set local session_replication_role=replica;
 delete from public.patient_coordination_events where task_id in(select id from public.patient_coordination_tasks where patient_case_id='${member}');
 delete from public.patient_coordination_tasks where patient_case_id='${member}';
 delete from public.conversation_audit where conversation_id='${conversation}';
 delete from public.zoe_runs where id='${run}';
 delete from public.conversations where id='${conversation}';
 delete from public.patient_clinical_cases where user_id='${member}';
 delete from public.workspace_staff where user_id in('${doctor}','${other}','${nurse}','${replacementNurse}');
 delete from public.workspace_clinics where id='${clinic}';
 delete from auth.sessions where id in('${sid}','${nurseSid}');
 delete from public.profiles where id in('${member}','${doctor}','${other}','${nurse}','${replacementNurse}');
 delete from auth.users where id in('${member}','${doctor}','${other}','${nurse}','${replacementNurse}');commit;`);
}
