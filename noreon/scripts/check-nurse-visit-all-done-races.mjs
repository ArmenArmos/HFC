// Real overlapping nurse_visit_mark RPCs on an isolated replay DB. All done sends
// one expectUnanswered command per protocol item, just like the wizard. A lock
// marker and pg_blocking_pids prove each ordering; elapsed time is never proof.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

const container=process.env.NOREON_TEST_DB_CONTAINER;
const isolatedCi=process.env.GITHUB_ACTIONS==='true'&&(process.env.RUNNER_ENVIRONMENT==='github-hosted'||(process.env.RUNNER_ENVIRONMENT==='self-hosted'&&process.env.NOREON_ISOLATED_CI_RUNNER==='noreon-ci'))&&process.env.GITHUB_REPOSITORY==='noreon-health/noreon-core';
if(!container?.startsWith('supabase_db_')||(container==='supabase_db_noreon-core'&&!isolatedCi))throw Error('Set NOREON_TEST_DB_CONTAINER to an isolated local replay container.');
const args=['exec','-i',container,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'];
const limits="set statement_timeout='10s';set idle_in_transaction_session_timeout='15s';";
const sql=text=>{
 const r=spawnSync('docker',args,{input:limits+text,encoding:'utf8',timeout:15000});
 assert.equal(r.status,0,r.error?.message??r.stderr);return r.stdout.trim();
};
const json=text=>JSON.parse(sql(text).split('\n').at(-1));
const member=randomUUID(),doctor=randomUUID(),nurse=randomUUID(),other=randomUUID(),clinic=randomUUID();
const nurseSession=randomUUID(),otherSession=randomUUID(),run=randomUUID();
const visits=Array.from({length:4},()=>randomUUID());
const items=['check:bp-validated-device','check:bp-cuff-fit'];
const comment='Synthetic reason: cuff unavailable';
const login=actor=>`select set_config('request.jwt.claims','${JSON.stringify({sub:actor,role:'authenticated',session_id:actor===nurse?nurseSession:otherSession,amr:[{method:'password'}]})}',true);set local role authenticated;`;
function mark(visit,item,{done=true,note=null,expectUnanswered=true}={}){
 const command={version:'nurse-visit-v1',memberId:member,source:'home-request',sourceId:visit,submissionId:randomUUID(),item,done,note,values:null};
 if(expectUnanswered)command.expectUnanswered=true;
 // These commands contain only synthetic constants and UUIDs.
 return `select public.nurse_visit_mark('${JSON.stringify(command)}'::jsonb);`;
}
const allDone=visit=>items.map(item=>mark(visit,item));
const notDone=visit=>mark(visit,items[0],{done:false,note:comment,expectUnanswered:false});
const transactions=(actor,commands)=>commands.map(command=>`begin;${login(actor)}${command}commit;`).join('\n');
const results=out=>out.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).filter(row=>'status'in row);
function statuses(result,want){
 assert.equal(result.code,0,result.err);
 assert.deepEqual(results(result.out).map(row=>row.status),want,result.out);
 assert.doesNotMatch(result.err,/deadlock/i);
}

const sessions=[];
function connect(){
 const child=spawn('docker',args);const s={child,out:'',err:'',completed:false};
 child.stdout.on('data',d=>{s.out+=d;});child.stderr.on('data',d=>{s.err+=d;});
 s.done=new Promise((resolve,reject)=>{
  child.on('error',reject);
  child.on('close',code=>{s.completed=true;resolve({code,out:s.out,err:s.err});});
 });
 // Register immediately so finally releases a holder even if its marker fails.
 sessions.push(s);return s;
}
async function hold(text){
 const s=connect();
 const ready=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Visit lock marker timed out')),10000);
  const check=()=>{if(s.out.includes('LOCK_READY')){clearTimeout(timer);resolve();}};
  s.child.stdout.on('data',check);
  s.done.then(r=>{clearTimeout(timer);if(!s.out.includes('LOCK_READY'))reject(Error(r.err||'No visit lock marker'));},reject);
 });
 s.child.stdin.write(`${limits}begin;select pg_backend_pid();${text}\n\\echo LOCK_READY\n`);
 await ready;
 s.pid=Number(s.out.split('\n').find(line=>/^\d+$/.test(line)));
 assert.ok(s.pid,'Holder has a real backend PID');return s;
}
function concurrent(actor,commands){
 const s=connect();s.label=`all-done-${randomUUID()}`;
 s.child.stdin.end(`${limits}set application_name='${s.label}';${transactions(actor,commands)}`);
 return s;
}
async function blocked(waiter,holder){
 const deadline=Date.now()+1400;
 while(Date.now()<deadline){
  if(sql(`select count(*)from pg_stat_activity where application_name='${waiter.label}'and wait_event_type='Lock'and ${holder.pid}=any(pg_blocking_pids(pid));`)==='1')return;
  assert.equal(waiter.completed,false,'RPC must block on the held visit lock');
  // Polling backoff only. The assertion above requires a real database lock wait.
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw Error('RPC did not reach the held visit lock before its 1500ms lock timeout');
}
async function commit(s,want=[]){
 s.child.stdin.end('commit;\n');const r=await s.done;statuses(r,want);
}
function marks(visit){
 return json(`select coalesce(json_agg(json_build_object('item',item,'done',done,'note',note,'actor',actor_id)order by recorded_at,id),'[]')from public.nurse_visit_marks where source_id='${visit}';`);
}
function current(visit){
 return json(`select json_agg(json_build_object('item',i->>'key','done',i#>'{mark,done}','note',i#>'{mark,note}')order by i->>'key')
 from jsonb_array_elements(public._nurse_visit_items_marked('home-request','${visit}'))i where i->>'key'in('${items.join("','")}');`);
}
function audit(visit,expected){
 const rows=json(`select coalesce(json_agg(json_build_object('item',detail->>'item','done',(detail->>'done')::boolean,'commented',(detail->>'commented')::boolean,'actor',actor_id)order by revision),'[]')
 from public.patient_clinical_case_events where user_id='${member}'and detail->>'sourceId'='${visit}';`);
 assert.deepEqual(rows,expected,'Exactly one clinical audit event per recorded item, in revision order');
 assert.equal(sql(`select count(*)from public.nurse_visit_marks m join public.patient_clinical_case_events e
 on e.user_id=m.member_id and e.detail->>'markId'=m.id::text and e.detail->>'submissionId'=m.submission_id::text
 and e.kind='care-evidence'and e.actor_id=m.actor_id and e.detail->>'sourceId'=m.source_id::text
 and e.detail->>'item'=m.item and (e.detail->>'done')::boolean=m.done
 where m.source_id='${visit}';`),String(expected.length),'Every mark has its matching audit event');
}
const event=(item,done,actor=nurse)=>({item,done,commented:!done,actor});
const doneState=items.map(item=>({item,done:true,note:null}));
let before;
try{
 before=json('select to_json(enabled) from public.nurse_visit_settings where singleton;');
 sql(`begin;
 insert into auth.users(id,phone,phone_confirmed_at)values('${member}','999000778001',now()),('${doctor}',null,null),('${nurse}',null,null),('${other}',null,null);
 insert into auth.sessions(id,user_id,created_at,updated_at)values('${nurseSession}','${nurse}',now(),now()),('${otherSession}','${other}',now(),now());
 insert into public.workspace_clinics(id,name)values('${clinic}','Synthetic All done race clinic');
 insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('${doctor}','doctor','Synthetic race doctor','${clinic}'),('${nurse}','nurse','Synthetic race nurse','${clinic}'),('${other}','nurse','Synthetic other nurse','${clinic}');
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values('${member}','${doctor}','${nurse}');
 ${visits.map(visit=>`insert into public.patient_test_requests(id,user_id,status,requested_terms,requirements,algorithm_version,context_token,create_payload,current_arrangement)
 values('${visit}','${member}','confirmed','{}','[]','synthetic','synthetic-${run}','{}',
 jsonb_build_object('terms',jsonb_build_object('mode','home','startsAt',date_trunc('minute',clock_timestamp()),'timezone','Asia/Yerevan','location','Synthetic race location')));`).join('\n')}
 update public.nurse_visit_settings set enabled=true;commit;`);

 // a. The explicit Not done owns the visit. All done started from an unanswered
 // view must wait, preserve its comment, and still record the other pending item.
 const explicit=await hold(`${login(nurse)}${notDone(visits[0])}`);
 const bulk=concurrent(nurse,allDone(visits[0]));
 await blocked(bulk,explicit);await commit(explicit,['saved']);
 statuses(await bulk.done,['already-marked','saved']);
 assert.deepEqual(marks(visits[0]),[
  {item:items[0],done:false,note:comment,actor:nurse},{item:items[1],done:true,note:null,actor:nurse},
 ]);
 assert.deepEqual(current(visits[0]),[{item:items[1],done:true,note:null},{item:items[0],done:false,note:comment}]);
 audit(visits[0],[event(items[0],false),event(items[1],true)]);

 // b. Reverse ordering: a later explicit tap is allowed to replace a Done.
 const doneFirst=await hold(`${login(nurse)}${allDone(visits[1]).join('\n')}`);
 const later=concurrent(nurse,[notDone(visits[1])]);
 await blocked(later,doneFirst);await commit(doneFirst,['saved','saved']);
 statuses(await later.done,['saved']);
 assert.deepEqual(marks(visits[1]),[
  {item:items[0],done:true,note:null,actor:nurse},{item:items[1],done:true,note:null,actor:nurse},{item:items[0],done:false,note:comment,actor:nurse},
 ]);
 assert.deepEqual(current(visits[1]),[{item:items[1],done:true,note:null},{item:items[0],done:false,note:comment}]);
 audit(visits[1],[event(items[0],true),event(items[1],true),event(items[0],false)]);

 // c. Only one nurse can be assigned at a time. Use a real assignment handoff
 // in the winning transaction so two DISTINCT nurses are authorized when each
 // executes. No authorization helper is mocked or bypassed for either RPC.
 const firstNurse=await hold(`${login(nurse)}${allDone(visits[2]).join('\n')}reset role;
 update public.patient_clinical_cases set assigned_nurse_id='${other}'where user_id='${member}';`);
 const secondNurse=concurrent(other,allDone(visits[2]));
 await blocked(secondNurse,firstNurse);await commit(firstNurse,['saved','saved']);
 statuses(await secondNurse.done,['already-marked','already-marked']);
 assert.equal(marks(visits[2]).length,2,'Two concurrent nurses record each Done exactly once');
 assert.deepEqual(current(visits[2]),[doneState[1],doneState[0]]);
 audit(visits[2],[event(items[0],true),event(items[1],true)]);
 sql(`update public.patient_clinical_cases set assigned_nurse_id='${nurse}'where user_id='${member}';`);

 // d. An unassigned nurse starts All done while the visit lock is held. Once
 // released it must return access, with no marks, audit, or case revision change.
 const revision=sql(`select revision from public.patient_clinical_cases where user_id='${member}';`);
 const locked=await hold(`select pg_advisory_xact_lock(hashtextextended('nurse-visit:${visits[3]}',0));`);
 const refused=concurrent(other,allDone(visits[3]));
 await blocked(refused,locked);await commit(locked);
 statuses(await refused.done,['access','access']);
 assert.deepEqual(marks(visits[3]),[]);audit(visits[3],[]);
 assert.equal(sql(`select revision from public.patient_clinical_cases where user_id='${member}';`),revision);
 console.log('All done SQL races passed: comment-first, Done-first, two nurses across assignment handoff, unauthorized overlap; exact marks and ordered audit, no deadlock.');
}finally{
 // Release/await every connection before deleting fixtures, including failures.
 for(const s of sessions){if(!s.child.stdin.destroyed&&!s.child.stdin.writableEnded)s.child.stdin.end('rollback;\n');await s.done;}
 // Retain append-only nurse_visit_marks, clinical events, and config/access audit
 // rows in this disposable DB. Replica mode removes ONLY non-append-only fixture
 // parents without cascading into or disabling protections on audit history.
 sql(`begin;set local session_replication_role=replica;
 delete from public.patient_test_requests where id in('${visits.join("','")}');
 delete from public.patient_clinical_cases where user_id='${member}';
 delete from public.workspace_staff where user_id in('${doctor}','${nurse}','${other}');
 delete from public.workspace_clinics where id='${clinic}';
 delete from auth.sessions where id in('${nurseSession}','${otherSession}');
 delete from public.profiles where id in('${member}','${doctor}','${nurse}','${other}');
 delete from auth.users where id in('${member}','${doctor}','${nurse}','${other}');commit;
 ${before===undefined?'':`update public.nurse_visit_settings set enabled=${before};`}`);
}
