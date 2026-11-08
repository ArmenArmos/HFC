// Telegram T1 two-connection schedules on an isolated local Supabase database:
// CR2 outcome retention while a workspace read holds the conversation lock, CR3
// unrelated-member writes in both orders, concurrent Telegram binding and code claims, concurrent
// duplicate inbox commits and lease recovery after a worker crash. Each sql() call is
// a separate PostgreSQL connection. Fixtures use their own fictional namespace and are
// removed in `finally`.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
const container=process.env.NOREON_TEST_DB_CONTAINER;
if(!container?.startsWith('supabase_db_'))throw Error('Set NOREON_TEST_DB_CONTAINER to an isolated local Supabase container.');
const args=['exec','-i',container,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=(source,ok=true)=>{const r=spawnSync('docker',args,{input:source,encoding:'utf8'});if(ok)assert.equal(r.status,0,r.stderr);return r;};
const value=source=>JSON.parse(sql(source).stdout.trim().split('\n').filter(x=>x.startsWith('{')||x.startsWith('[')).at(-1));
const scalar=source=>sql(source).stdout.trim();
const id=n=>`d1200000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const M=id(1),DOC=id(2),U=id(8),M2=id(9);
const jwt=(sub,sid,method)=>JSON.stringify({sub,role:'authenticated',amr:[{method}],session_id:sid});
const as=(sub,sid,method,source)=>`begin;select set_config('request.jwt.claims','${jwt(sub,sid,method)}',true);set local role authenticated;${source};commit;`;
const doctor=source=>as(DOC,id(6),'password',source);
const service=source=>`begin;select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;${source};commit;`;
const principal=u=>`["telegram","noreon_race",9002,"user",${u}]`;
const event=(n,kind,u,payload)=>JSON.stringify({adapter:'telegram',eventId:`["telegram","noreon_race",9002,"update",${n}]`,fingerprint:`fp-${n}`,principalRef:principal(u),kind,payload:{...payload,chatId:u,messageId:n}});
// Starts a transaction in its own connection, signals once its statements ran, then
// keeps the transaction open for `seconds` before committing.
const hold=async(source,seconds)=>{
 const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
 const completed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(Error(err)));});
 const ready=new Promise((resolve,reject)=>{child.stdout.on('data',d=>{out+=d;if(out.includes('T1_LOCK_READY'))resolve();});child.on('exit',()=>{if(!out.includes('T1_LOCK_READY'))reject(Error(err||'No lock marker'));});});
 child.stderr.on('data',d=>err+=d);
 child.stdin.end(source.replace(/commit;\s*$/,`select 'T1_LOCK_READY';select pg_sleep(${seconds});commit;`));
 await ready;return {completed};
};
const timed=fn=>{const t=Date.now();const r=fn();return {r,ms:Date.now()-t};};
const drain=()=>value(service(`select coalesce(jsonb_agg(public.channel_inbox_process((x#>>'{}')::uuid)),'[]')from jsonb_array_elements(public.channel_inbox_next(50))x`));

assert.equal(scalar('select count(*) from public.conversation_policy;'),'0','Race runner needs an unconfigured conversation policy');
assert.equal(scalar('select count(*) from public.telegram_channel_settings;'),'0','Race runner needs unconfigured Telegram settings');
assert.equal(scalar(`select count(*)from auth.users where id::text like 'd1200000-%';`),'0','Fixture IDs already present');
let seeded=false;
try{
 sql(`begin;
 insert into auth.users(id,phone,phone_confirmed_at)values('${M}','37499012001',now()),('${U}','37499012008',now()),('${M2}','37499012009',now()),('${DOC}',null,null);
 insert into public.workspace_clinics(id,name)values('${id(4)}','Synthetic race clinic');
 insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('${DOC}','doctor','Dr Race Synthetic','${id(4)}');
 insert into auth.sessions(id,user_id,created_at,updated_at)values('${id(5)}','${M}',now(),now()),('${id(6)}','${DOC}',now(),now()),('${id(10)}','${M2}',now(),now());
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('${M}','${DOC}'),('${M2}','${DOC}');
 insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_race',9002,600,'consent-race');
 insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-race',3600,600,60,100,false,true);
 insert into public.system_message_templates(template_id,version,locale,body,approved,approval_note)values('telegram.ack',90,'en','Synthetic race acknowledgement. Call 103.',true,'race fixture'),('telegram.ack',90,'hy','Synthetic race acknowledgement HY. 103.',true,'race fixture');
 commit;`);
 seeded=true;

 // T-auth bindings race (as the owner; the contact proof that precedes them is covered in
 // check-telegram-auth.sql). One member per Telegram account, one account per member.
 const acct=`(select public._telegram_account_ref(s)from public.telegram_channel_settings s)`;
 const bind=(m,phone,u)=>`begin;select public._telegram_auth_bind('${m}','member','${principal(u)}',${acct},'${phone}','${u}',null);commit;`;
 const activate=m=>`begin;select public._telegram_replies_activate('${m}',(select id from public.telegram_auth_bindings where auth_user_id='${m}'and active));commit;`;
 const racing=await hold(bind(M2,'+37499012009',8009),1.5);
 const other=value(bind(M,'+37499012001',8009));
 await racing.completed;
 assert.equal(other.code,'principal_bound_elsewhere','One member per Telegram account under concurrency');
 assert.equal(scalar(`select count(*)from public.telegram_auth_bindings where principal_ref='${principal(8009)}'and active;`),'1');
 assert.equal(scalar(`select auth_user_id from public.telegram_auth_bindings where principal_ref='${principal(8009)}'and active;`),M2);
 const firstBind=await hold(bind(M,'+37499012001',8001),1.5);
 const secondBind=value(bind(M,'+37499012001',8002));
 await firstBind.completed;
 assert.equal(secondBind.result,'replaced','A concurrent second account replaces the first, never both');
 assert.equal(scalar(`select count(*)from public.telegram_auth_bindings where auth_user_id='${M}'and active;`),'1');
 value(bind(M,'+37499012001',8001));value(activate(M));
 sql(`insert into auth.sessions(id,user_id,created_at,updated_at)values('${id(5)}','${M}',now(),now())on conflict do nothing;`);
 assert.equal(scalar(`select principal_ref from public.conversation_endpoints where member_id='${M}'and active;`),principal(8001));
 // Two hook calls for one waiting code request: exactly one claims and sends.
 const begun=value(service(`select public.auth_code_request_begin('+37499012001','${'1'.repeat(64)}')`));
 const claiming=await hold(service(`select public.auth_code_request_claim('+37499012001','wh-race-a','${'b'.repeat(64)}')`),1.5);
 const secondClaim=value(service(`select public.auth_code_request_claim('+37499012001','wh-race-b','${'b'.repeat(64)}')`));
 await claiming.completed;
 assert.equal(secondClaim.code,'no_request','A second concurrent hook call finds nothing to claim');
 assert.equal(scalar(`select webhook_id||':'||state from public.auth_code_requests where id='${begun.requestId}';`),'wh-race-a:sending');
 console.log('PASS concurrent T-auth: one member per Telegram account; one account per member; one hook claims a code request');

 // Concurrent duplicate commits: the second waits on the first and is a committed duplicate.
 const commit=`select public.channel_inbox_commit('${event(500,'text',8001,{text:'Synthetic race message'})}'::jsonb)`;
 const firstCommit=await hold(service(commit),1.5);
 const dup=value(service(commit));
 await firstCommit.completed;
 assert.equal(dup.status,'committed-duplicate');
 assert.equal(scalar(`select count(*)from public.channel_inbox where event_id like '%"noreon_race",9002,"update",500]';`),'1');
 console.log('PASS simultaneous duplicate commits: one row, both acknowledged after commit');

 // Worker crash after leasing: the lease expires and the row is processed once.
 const leased=value(service('select public.channel_inbox_next(10)'));assert.equal(leased.length,1);
 sql(`update public.channel_inbox set lease_until=now()-interval '1 second' where id='${leased[0]}';`);
 const recovered=drain();assert.equal(recovered[0].result,'received');
 assert.equal(scalar(`select attempts from public.channel_inbox where id='${leased[0]}';`),'2');
 assert.equal(scalar(`select count(*)from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='${M}';`),'1');
 console.log('PASS worker crash between receipt and processing is recovered by lease expiry, processed once');

 // Two sending deliveries for the CR2 schedules.
 const sending=[];
 for(const [n,attempt] of [[501,id(60)],[502,id(61)]]){
  if(n!==501){value(service(`select public.channel_inbox_commit('${event(n,'text',8001,{text:`Synthetic race message ${n}`})}'::jsonb)`));drain();}
  const ws=value(doctor(`select public.conversation_workspace('${M}')`));
  value(doctor(`select public.conversation_compose('${M}','${id(70+n-500)}',${ws.version},${ws.clinicalRevision},${ws.draftEpoch},'${ws.sourceToken}','Exact race reply ${n}','Private race summary')`));
  const actions=value(doctor(`select public.conversation_actions('${M}')`));
  const approve={schema:1,purpose:'reply.approve',intentId:actions.view.actions.find(a=>a.purpose==='reply.approve').intentId,requestId:id(80+n-500).replaceAll('-','')};
  const approved=value(doctor(`select public.conversation_command('${JSON.stringify(approve)}')`));assert.equal(approved.ok,true);
  const claimed=value(service(`select public.conversation_claim('${approved.deliveryId}','${attempt}')`));assert.equal(claimed.ok,true);
  sending.push({delivery:approved.deliveryId,attempt});
 }
 // CR2 schedule 1: a workspace read holds the conversation lock past the 2 s timeout.
 const accepted='{"kind":"accepted","providerRef":"synthetic-race-1"}';
 const reading=await hold(doctor(`select public.conversation_workspace('${M}')`),4);
 const busy=timed(()=>value(service(`select public.conversation_outcome('${sending[0].attempt}','${accepted}')`)));
 assert.equal(busy.r.code,'busy');assert.equal(busy.r.retryable,true);
 assert.ok(busy.ms<3900,`Outcome waits only for the lock timeout (${busy.ms} ms)`);
 assert.equal(scalar(`select outcome->>'providerRef' from public.delivery_observations where attempt_id='${sending[0].attempt}';`),'synthetic-race-1','Observation retained although the lock was busy');
 assert.equal(scalar(`select state from public.conversation_deliveries where id='${sending[0].delivery}';`),'sending');
 await reading.completed;
 assert.equal(value(service(`select public.conversation_outcome('${sending[0].attempt}','${accepted}')`)).result,'recorded','Retry after the read records the exact observation');
 assert.equal(value(service(`select public.conversation_outcome('${sending[0].attempt}','${accepted}')`)).result,'duplicate');
 assert.equal(scalar(`select state from public.conversation_deliveries where id='${sending[0].delivery}';`),'accepted_by_provider');
 assert.equal(scalar(`select count(*)from public.conversation_audit where kind='delivery.outcome'and detail->>'attemptId'='${sending[0].attempt}';`),'1','Recorded once');
 // CR2 schedule 2: busy first, then the stale reconciler applies the retained
 // definite observation instead of unknown.
 const failed='{"kind":"definitely_failed","evidence":"synthetic-race-2"}';
 const longRead=await hold(doctor(`select public.conversation_workspace('${M}')`),4);
 assert.equal(value(service(`select public.conversation_outcome('${sending[1].attempt}','${failed}')`)).code,'busy');
 await longRead.completed;
 sql(`begin;set local session_replication_role=replica;update public.conversation_attempts set claimed_at=claimed_at-interval '10 minutes' where id='${sending[1].attempt}';commit;`);
 assert.equal(value(service('select public.delivery_reconcile_stale(120)')).reconciled,1);
 assert.equal(scalar(`select state from public.conversation_deliveries where id='${sending[1].delivery}';`),'definitely_failed','Reconciler kept the retained observation, not unknown');
 assert.equal(scalar(`select count(*)from public.conversation_attempts where delivery_id in('${sending[0].delivery}','${sending[1].delivery}');`),'2','One attempt per delivery; nothing re-claimed');
 // CR2 schedule 3: a read shorter than the timeout only delays the outcome call.
 const shortOk=await hold(doctor(`select public.conversation_workspace('${M}')`),0.8);
 const third=timed(()=>value(service(`select public.conversation_outcome('${sending[0].attempt}','${accepted}')`)));
 await shortOk.completed;
 assert.equal(third.r.result,'duplicate');
 console.log('PASS CR2: outcome during a held workspace read is retained (busy, retryable), recorded once on retry, and a reconciler applies the retained definite observation');

 // R1-2: committed retention is independent of projection, and reconciliation
 // serialises with retention in both orders, for both message families.
 let seq=600;
 const makeSending=()=>{
  const n=++seq;
  value(service(`select public.channel_inbox_commit('${event(n,'text',8001,{text:`Synthetic retention message ${n}`})}'::jsonb)`));drain();
  const ws=value(doctor(`select public.conversation_workspace('${M}')`));
  value(doctor(`select public.conversation_compose('${M}','${id(1000+n)}',${ws.version},${ws.clinicalRevision},${ws.draftEpoch},'${ws.sourceToken}','Exact retention reply ${n}','Private retention summary')`));
  const actions=value(doctor(`select public.conversation_actions('${M}')`));
  const approve={schema:1,purpose:'reply.approve',intentId:actions.view.actions.find(a=>a.purpose==='reply.approve').intentId,requestId:id(2000+n).replaceAll('-','')};
  const approved=value(doctor(`select public.conversation_command('${JSON.stringify(approve)}')`));assert.equal(approved.ok,true);
  const attempt=id(3000+n);assert.equal(value(service(`select public.conversation_claim('${approved.deliveryId}','${attempt}')`)).ok,true);
  // The acknowledgement for this message is the system-family subject.
  const ack=scalar(`select id from public.system_messages where source_inbox_id=(select id from public.channel_inbox where event_id like '%"update",${n}]') and template_id='telegram.ack';`);
  const sysAttempt=id(4000+n);assert.equal(value(service(`select public.system_message_claim('${ack}','${sysAttempt}')`)).ok,true);
  return {delivery:approved.deliveryId,attempt,message:ack,sysAttempt};
 };
 const backdate=(table,attempt)=>sql(`begin;set local session_replication_role=replica;update public.${table} set claimed_at=claimed_at-interval '10 minutes' where id='${attempt}';commit;`);
 const okObs='{"kind":"accepted","providerRef":"synthetic-retained"}',otherObs='{"kind":"definitely_failed","evidence":"synthetic-other"}';
 // (a) observation committed, projection cancelled (rolled back), then the reconciler applies the observation.
 const a=makeSending();
 for(const [channel,attempt] of [['conversation',a.attempt],['system',a.sysAttempt]])assert.equal(value(service(`select public.delivery_observe('${channel}','${attempt}','${okObs}')`)).result,'retained');
 sql(`begin;select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;select public.conversation_outcome('${a.attempt}','${okObs}');select public.system_message_outcome('${a.sysAttempt}','${okObs}');rollback;`);
 assert.equal(scalar(`select state from public.conversation_deliveries where id='${a.delivery}';`),'sending','Cancelled projection left the delivery sending');
 backdate('conversation_attempts',a.attempt);backdate('system_message_attempts',a.sysAttempt);
 value(service('select public.delivery_reconcile_stale(120)'));
 assert.equal(scalar(`select state from public.conversation_deliveries where id='${a.delivery}';`),'accepted_by_provider','Reconciler applied the committed observation, not unknown');
 assert.equal(scalar(`select state from public.system_messages where id='${a.message}';`),'accepted_by_provider');
 // (b) reconciler first: retention waits for it, the terminal unknown stands and the later evidence is retained and audited as late.
 const b=makeSending();
 const reconciling=await hold(service(`select public.conversation_reconcile('${b.attempt}')`),1.2);
 const keptAfter=value(service(`select public.delivery_observe('conversation','${b.attempt}','${okObs}')`));
 await reconciling.completed;
 assert.equal(keptAfter.result,'retained');
 assert.equal(value(service(`select public.conversation_outcome('${b.attempt}','${okObs}')`)).result,'late');
 assert.equal(scalar(`select state from public.conversation_deliveries where id='${b.delivery}';`),'unknown');
 assert.equal(scalar(`select count(*) from public.conversation_audit where kind='delivery.late_outcome' and detail->>'attemptId'='${b.attempt}';`),'1');
 backdate('system_message_attempts',b.sysAttempt);
 const sysReconciling=await hold(service('select public.delivery_reconcile_stale(120)'),1.2);
 const sysKept=value(service(`select public.delivery_observe('system','${b.sysAttempt}','${okObs}')`));
 await sysReconciling.completed;
 assert.equal(sysKept.result,'retained');
 assert.equal(scalar(`select state from public.system_messages where id='${b.message}';`),'unknown');
 // (c) retention first: the reconciler waits for it and applies the observation.
 const c=makeSending();
 const retaining=await hold(service(`select public.delivery_observe('conversation','${c.attempt}','${otherObs}')`),1.2);
 const reconciled=value(service(`select public.conversation_reconcile('${c.attempt}')`));
 await retaining.completed;
 assert.equal(reconciled.result,'recorded');
 assert.equal(scalar(`select state from public.conversation_deliveries where id='${c.delivery}';`),'definitely_failed','Reconciler saw the retention that committed while it waited');
 backdate('system_message_attempts',c.sysAttempt);
 const sysRetaining=await hold(service(`select public.delivery_observe('system','${c.sysAttempt}','${otherObs}')`),1.2);
 value(service('select public.delivery_reconcile_stale(120)'));
 await sysRetaining.completed;
 assert.equal(scalar(`select state from public.system_messages where id='${c.message}';`),'definitely_failed');
 // (d) concurrent identical and conflicting observations: one row, the first value wins.
 const d=makeSending();
 for(const [channel,attempt] of [['conversation',d.attempt],['system',d.sysAttempt]]){
  const first=await hold(service(`select public.delivery_observe('${channel}','${attempt}','${okObs}')`),1.2);
  const same=value(service(`select public.delivery_observe('${channel}','${attempt}','${okObs}')`));
  await first.completed;
  assert.equal(same.result,'retained');
  assert.equal(value(service(`select public.delivery_observe('${channel}','${attempt}','${otherObs}')`)).result,'conflict');
  assert.equal(scalar(`select outcome->>'kind' from public.delivery_observations where attempt_id='${attempt}';`),'accepted');
 }
 assert.equal(value(service(`select public.conversation_outcome('${d.attempt}','${otherObs}')`)).result,'conflict','A conflicting value is never applied');
 assert.equal(scalar(`select state from public.conversation_deliveries where id='${d.delivery}';`),'sending');
 assert.equal(value(service(`select public.conversation_outcome('${d.attempt}','${okObs}')`)).result,'recorded');
 assert.equal(scalar(`select count(*) from public.conversation_attempts where delivery_id in('${a.delivery}','${b.delivery}','${c.delivery}','${d.delivery}');`),'4','One attempt per delivery; nothing re-claimed');
 console.log('PASS R1-2 retention: committed observation survives a cancelled projection; reconcile and retention serialise in both orders; concurrent identical/conflicting observations (conversation and system)');

 // CR3: an unrelated member's writes do not wait on, or fail, a doctor workspace read.
 const writer=await hold(`begin;insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)values('${U}',gen_random_uuid(),120,80,now());update public.profiles set display_name='Race unrelated' where id='${U}';commit;`,3);
 const wsDuringWrite=timed(()=>sql(doctor(`select public.conversation_workspace('${M}')`),false));
 await writer.completed;
 assert.equal(wsDuringWrite.r.status,0,wsDuringWrite.r.stderr);assert.ok(wsDuringWrite.ms<2500,`Workspace read did not wait for the unrelated writer (${wsDuringWrite.ms} ms)`);
 const readerHeld=await hold(doctor(`select public.conversation_workspace('${M}')`),3);
 const writeDuringRead=timed(()=>sql(`begin;set local lock_timeout='1s';insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)values('${U}',gen_random_uuid(),121,81,now());update public.patient_measurements set pulse=70 where user_id='${U}';update public.profiles set display_name='Race unrelated 2' where id='${U}';commit;`,false));
 await readerHeld.completed;
 assert.equal(writeDuringRead.r.status,0,writeDuringRead.r.stderr);assert.ok(writeDuringRead.ms<2500,`Unrelated write did not wait for the workspace read (${writeDuringRead.ms} ms)`);
 // Stale source still blocks approval: a same-member write after capture is refused.
 const ws=value(doctor(`select public.conversation_workspace('${M}')`));
 sql(`insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)values('${M}',gen_random_uuid(),130,85,now());`);
 const stale=value(doctor(`select public.conversation_compose('${M}','${id(90)}',${ws.version},${ws.clinicalRevision},${ws.draftEpoch},'${ws.sourceToken}','Reply on stale evidence','Private stale summary')`));
 assert.equal(stale.code,'stale_context','Captured token from before a same-member write cannot be used');
 console.log('PASS CR3 capture-only: unrelated measurement/profile writes and the doctor workspace proceed in both orders; stale source still blocks');
}finally{
 if(seeded){
  sql(`begin;set local session_replication_role=replica;
   delete from public.delivery_observations where attempt_id in(select id from public.system_message_attempts where message_id in(select id from public.system_messages where member_id in('${M}','${M2}')));
   delete from public.delivery_observations where attempt_id in(select id from public.conversation_attempts where delivery_id in(select d.id from public.conversation_deliveries d join public.conversations c on c.id=d.conversation_id where c.member_id in('${M}','${M2}')));
   delete from public.conversation_attempts where delivery_id in(select d.id from public.conversation_deliveries d join public.conversations c on c.id=d.conversation_id where c.member_id in('${M}','${M2}'));
   delete from public.conversation_deliveries where conversation_id in(select id from public.conversations where member_id in('${M}','${M2}'));
   delete from public.conversation_approvals where draft_id in(select d.id from public.conversation_drafts d join public.conversations c on c.id=d.conversation_id where c.member_id in('${M}','${M2}'));
   delete from public.conversation_intents where draft_id in(select d.id from public.conversation_drafts d join public.conversations c on c.id=d.conversation_id where c.member_id in('${M}','${M2}'));
   delete from public.conversation_revisions where draft_id in(select d.id from public.conversation_drafts d join public.conversations c on c.id=d.conversation_id where c.member_id in('${M}','${M2}'));
   delete from public.conversation_drafts where conversation_id in(select id from public.conversations where member_id in('${M}','${M2}'));
   delete from public.conversation_doctor_alerts where member_id in('${M}','${M2}');
   delete from public.system_message_audit where message_id in(select id from public.system_messages where member_id in('${M}','${M2}'));
   delete from public.system_message_attempts where message_id in(select id from public.system_messages where member_id in('${M}','${M2}'));
   delete from public.system_messages where member_id in('${M}','${M2}');
   delete from public.conversation_messages where conversation_id in(select id from public.conversations where member_id in('${M}','${M2}'));
   delete from public.conversation_receipts where conversation_id in(select id from public.conversations where member_id in('${M}','${M2}'));
   delete from public.conversation_audit where conversation_id in(select id from public.conversations where member_id in('${M}','${M2}'));
   delete from public.conversations where member_id in('${M}','${M2}');
   delete from public.channel_inbox where event_id like '%"noreon_race",9002,%';
   delete from public.conversation_endpoints where member_id in('${M}','${M2}');
   delete from public.auth_code_requests where phone in('+37499012001','+37499012009');
   delete from public.auth_cleanup_jobs where auth_user_id in('${M}','${M2}');
   delete from public.telegram_auth_messages where principal_ref like '["telegram","noreon_race",9002,%';
   delete from public.telegram_auth_audit where auth_user_id in('${M}','${M2}');
   delete from public.telegram_auth_bindings where auth_user_id in('${M}','${M2}');
   delete from public.telegram_link_tokens where member_id in('${M}','${M2}');
   delete from public.telegram_audit where member_id in('${M}','${M2}');
   delete from public.conversation_grants where actor_id in('${M}','${M2}','${DOC}');
   delete from public.patient_measurements where user_id in('${M}','${U}');
   delete from public.patient_clinical_cases where user_id in('${M}','${M2}');
   delete from public.workspace_staff where user_id='${DOC}';
   delete from public.workspace_clinics where id='${id(4)}';
   delete from auth.sessions where user_id in('${M}','${M2}','${DOC}','${U}');
   delete from public.profiles where id in('${M}','${M2}','${DOC}','${U}');
   delete from auth.users where id in('${M}','${M2}','${DOC}','${U}');
   delete from public.conversation_policy where version='synthetic-race';
   delete from public.telegram_channel_settings where account='noreon_race';
   delete from public.system_message_templates where version=90 and approval_note='race fixture';commit;`);
  assert.equal(scalar(`select count(*)from auth.users where id::text like 'd1200000-%';`),'0');
  assert.equal(scalar(`select count(*)from public.channel_inbox where event_id like '%noreon_race%';`),'0');
 }
}
