import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';

const container=process.env.NOREON_TEST_DB_CONTAINER;
const isolatedCi=process.env.GITHUB_ACTIONS==='true'&&(process.env.RUNNER_ENVIRONMENT==='github-hosted'||(process.env.RUNNER_ENVIRONMENT==='self-hosted'&&process.env.NOREON_ISOLATED_CI_RUNNER==='noreon-ci'))&&process.env.GITHUB_REPOSITORY==='noreon-health/noreon-core';
if(!container?.startsWith('supabase_db_')||(container==='supabase_db_noreon-core'&&!isolatedCi))throw Error('Set NOREON_TEST_DB_CONTAINER to an isolated local Supabase container; local primary forbidden.');
const args=['exec','-i',container,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=source=>{
 const r=spawnSync('docker',args,{input:source,encoding:'utf8',timeout:20_000});
 assert.equal(r.status,0,r.error?.message??r.stderr);return r.stdout;
};
const json=out=>out.trim().split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l));
const id=n=>`d9600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const member=id(1),conversation='d9630000-0000-4000-8000-000000000001';
const claims=JSON.stringify({sub:id(2),role:'authenticated',amr:[{method:'password'}],session_id:'d9610000-0000-4000-8000-000000000002'});
const asDoctor=source=>`begin;set local statement_timeout='15s';select set_config('request.jwt.claims','${claims}',true);set local role authenticated;${source}`;
function connection(source){
 const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
 const completed=new Promise((resolve,reject)=>{
  child.on('error',reject);
  child.on('close',code=>code===0?resolve(out):reject(Error(err||`psql exited ${code}`)));
 });
 // A rejection remains observable through completed, including during setup/cleanup.
 void completed.catch(()=>{});
 child.stdin.write(source);
 return {child,completed,output:()=>out};
}
let seeded=false,first,second;
try{
 assert.equal(sql('select count(*) from public.conversation_policy;').trim(),'0','Synthetic race requires unconfigured policy');
 assert.equal(sql(`select count(*) from auth.users where id in(${[1,2,3,4,5].map(n=>`'${id(n)}'`).join(',')});`).trim(),'0','Fixture IDs already present');
 // Reuse exactly the authorization/source/approval fixture from the transactional check.
 const fixture=readFileSync('scripts/check-telegram-delivery-retry.sql','utf8').split('-- Concurrent fixture setup ends here.');
 assert.equal(fixture.length,2,'Explicit fixture boundary must exist once');
 const setup=fixture[0].replaceAll('d9500000','d9600000').replaceAll('d9510000','d9610000').replaceAll('d9520000','d9620000').replaceAll('d9530000','d9630000');
 const seededRows=sql(`${setup}\nselect jsonb_build_object('deliveryId',pg_temp.delivery('definitely_failed','telegram_bot_blocked'));commit;`);
 seeded=true;
 const original=json(seededRows).findLast(r=>r.deliveryId)?.deliveryId;
 assert.match(original,/^[0-9a-f-]{36}$/);
 sql(`begin;update public.conversation_deliveries set state_seq=2 where id='${original}';
  insert into public.conversation_attempts(id,delivery_id,state_seq,envelope,outcome,outcome_at)
  select gen_random_uuid(),d.id,1,jsonb_build_object('deliveryId',d.id,'approvalId',a.id,'body',a.body,'contentHash',a.content_hash),
   '{"kind":"definitely_failed","evidence":"telegram_bot_blocked"}'::jsonb,now()
  from public.conversation_deliveries d join public.conversation_approvals a on a.id=d.approval_id where d.id='${original}';commit;`);
 const snapshot=()=>json(sql(`select jsonb_build_object('delivery',to_jsonb(d),'approval',to_jsonb(a),'draft',to_jsonb(dr),'revision',to_jsonb(r),'intent',to_jsonb(i),
  'attempts',(select jsonb_agg(to_jsonb(at) order by at.id) from public.conversation_attempts at where at.delivery_id=d.id))
  from public.conversation_deliveries d join public.conversation_approvals a on a.id=d.approval_id
  join public.conversation_drafts dr on dr.id=a.draft_id join public.conversation_revisions r on r.draft_id=a.draft_id and r.revision=a.revision
  join public.conversation_intents i on i.id=a.intent_id where d.id='${original}';`))[0];
 const before=snapshot();assert.equal(before.attempts.length,1);
 const retry=`select public.conversation_retry_delivery('${original}');`;
 first=connection(asDoctor(`${retry}select jsonb_build_object('pid',pg_backend_pid());select 'RETRY_LOCK_HELD';\n`));
 // Wait for the first RPC's successful return while its transaction still owns the lock.
 const deadline=Date.now()+10_000;
 while(!first.output().includes('RETRY_LOCK_HELD')){
  assert.ok(Date.now()<deadline,'First retry did not hold its transaction open');
  await Promise.race([first.completed.then(()=>{throw Error('First connection ended before lock marker');}),new Promise(resolve=>setTimeout(resolve,25))]);
 }
 const pid=json(first.output()).find(r=>r.pid)?.pid;assert.ok(Number.isInteger(pid));
 second=connection(asDoctor(`set local application_name='telegram_retry_contender';${retry}commit;\n`));second.child.stdin.end();
 // Observe actual overlap, not timing inferred from Promise.all or a repeated call.
 let blocked=false;
 while(Date.now()<deadline){
  blocked=sql(`select exists(select 1 from pg_stat_activity where application_name='telegram_retry_contender' and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid)));`).trim()==='t';
  if(blocked)break;
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 assert.ok(blocked,'Second RPC must wait on the first transaction before it commits');
 first.child.stdin.end('commit;\n');
 const results=(await Promise.all([first.completed,second.completed])).map(out=>json(out).find(r=>'ok'in r));
 assert.equal(results[0]?.ok,true);assert.equal(results[1]?.ok,true);
 assert.equal(results[0].replayed,false);assert.equal(results[1].replayed,true);
 assert.equal(results[0].deliveryId,results[1].deliveryId,'Both callers receive the same child id');
 const child=results[0].deliveryId;
 assert.equal(sql(`select count(*) from public.conversation_deliveries where retry_of='${original}';`).trim(),'1','Exactly one child delivery');
 assert.deepEqual(snapshot(),before,'Original delivery, approval, draft, revision, intent and attempts remain unchanged');
 // The RPC promises one audit row per created child. Replayed accepted calls return
 // before the audit insertion, so two callers still produce exactly one retry event.
 const audits=json(sql(`select jsonb_build_object('count',count(*),'attributed',bool_and(actor_id='${id(2)}' and detail->>'deliveryId'='${child}'))
  from public.conversation_audit where conversation_id='${conversation}' and kind='delivery.retry_requested' and detail->>'retryOf'='${original}';`))[0];
 assert.equal(audits.count,1);assert.equal(audits.attributed,true);
 console.log('PASS overlapping PostgreSQL Retry calls: observed lock wait, one child, same returned id, unchanged original rows and one attributed audit event per child (SQL-role fixture, no provider calls).');
}finally{
 for(const session of [first,second])if(session&&!session.child.stdin.writableEnded)session.child.stdin.end('rollback;\n');
 await Promise.allSettled([first?.completed,second?.completed]);
 if(seeded)sql(`begin;set local session_replication_role=replica;
  delete from public.conversation_attempts where delivery_id in(select id from public.conversation_deliveries where conversation_id='${conversation}');
  delete from public.conversation_deliveries where conversation_id='${conversation}';
  delete from public.conversation_approvals where draft_id in(select id from public.conversation_drafts where conversation_id='${conversation}');
  delete from public.conversation_intents where draft_id in(select id from public.conversation_drafts where conversation_id='${conversation}');
  delete from public.conversation_revisions where draft_id in(select id from public.conversation_drafts where conversation_id='${conversation}');
  delete from public.conversation_drafts where conversation_id='${conversation}';
  delete from public.conversation_messages where conversation_id='${conversation}';
  delete from public.conversation_receipts where conversation_id='${conversation}';
  delete from public.conversation_audit where conversation_id='${conversation}';
  delete from public.conversations where id='${conversation}';
  delete from public.conversation_endpoints where member_id='${member}';
  delete from public.conversation_grants where actor_id in('${id(1)}','${id(2)}','${id(3)}','${id(4)}','${id(5)}');
  delete from public.patient_clinical_cases where user_id='${member}';
  delete from public.workspace_staff where user_id in('${id(2)}','${id(3)}','${id(4)}','${id(5)}');
  delete from public.workspace_clinics where id in('d9620000-0000-4000-8000-000000000001','d9620000-0000-4000-8000-000000000002');
  delete from auth.sessions where user_id in('${id(1)}','${id(2)}','${id(3)}','${id(4)}','${id(5)}');
  delete from public.profiles where id in('${id(1)}','${id(2)}','${id(3)}','${id(4)}','${id(5)}');
  delete from auth.users where id in('${id(1)}','${id(2)}','${id(3)}','${id(4)}','${id(5)}');
  delete from public.conversation_policy where version='synthetic-retry';commit;`);
}
