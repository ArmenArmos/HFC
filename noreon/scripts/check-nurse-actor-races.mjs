// Two-connection schedule on an isolated local Supabase database. Telegram authority
// and staff management must take invitation and staff rows in the same order: an admin
// holding the invitation while updating staff never deadlocks with an authority check,
// and a removal that commits first is refused. Fixtures use a fictional namespace and
// are removed in `finally`.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
const container=process.env.NOREON_TEST_DB_CONTAINER;
if(!container?.startsWith('supabase_db_'))throw Error('Set NOREON_TEST_DB_CONTAINER to an isolated local Supabase container.');
const args=['exec','-i',container,'psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1'];
const sql=source=>{const r=spawnSync('docker',args,{input:source,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
const start=source=>{const child=spawn('docker',args);let out='',err='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err+=d;});child.stdin.end(source);return new Promise(done=>child.on('close',code=>done({code,out:out.trim(),err})));};
const id=n=>`d1300000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const NURSE=id(1),CLINIC=id(2),BINDING=id(3),ADMIN=id(4),INVITE=id(5),INBOX=id(6),SECOND=id(7),MEMBER=id(8),TASK=id(9),CALLBACK=id(10),NOTE=id(11),REVOKEDNOTE=id(12),QUEUEINBOX=id(13),VISITREQUEST=id(14),VISITMARK=id(15);
const service=`set request.jwt.claim.role='service_role';set request.jwt.claims='{"role":"service_role"}';`;
const rows=result=>result.out.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
const clean=`
delete from public.telegram_nurse_intents where binding_id='${BINDING}';
delete from public.telegram_nurse_outbox where binding_id='${BINDING}';
delete from public.telegram_nurse_dialogs where binding_id='${BINDING}';
delete from public.channel_inbox where nurse_binding_id='${BINDING}';
set session_replication_role=replica;
delete from public.access_audit where actor_id='${NURSE}'and member_id='${MEMBER}';
set session_replication_role=origin;
set session_replication_role=replica;
delete from public.nurse_visit_marks where source_id='${VISITREQUEST}';
delete from public.patient_clinical_case_events where user_id='${MEMBER}';
set session_replication_role=origin;
delete from public.patient_test_requests where id='${VISITREQUEST}';
delete from public.patient_coordination_events where task_id='${TASK}';
delete from public.patient_coordination_receipts where patient_case_id='${MEMBER}';
delete from public.patient_coordination_tasks where id='${TASK}';
delete from public.patient_clinical_cases where user_id='${MEMBER}';
delete from auth.users where id='${MEMBER}';
delete from public.telegram_auth_bindings where id='${BINDING}';
delete from public.real_staff_invitations where id='${INVITE}';
delete from public.workspace_staff where user_id in ('${NURSE}','${ADMIN}');
delete from public.workspace_clinics where id='${CLINIC}';
delete from auth.users where id in ('${NURSE}','${ADMIN}');`;
const seed=`${clean}
insert into auth.users(id,email)values('${NURSE}','${NURSE}@example.invalid'),('${ADMIN}','${ADMIN}@example.invalid');
insert into public.workspace_clinics(id,name)values('${CLINIC}','Synthetic race clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('${NURSE}','nurse','Synthetic race nurse','${CLINIC}'),('${ADMIN}','doctor','Synthetic race issuer','${CLINIC}');
insert into public.real_staff_invitations(id,email,display_name,clinic_id,issuer_id,expected_auth_user_id,auth_user_id,role,status,verified_at,accepted_at,accepted_session_id)
 values('${INVITE}','${NURSE}@example.invalid','Synthetic race nurse','${CLINIC}','${ADMIN}','${NURSE}','${NURSE}','nurse','accepted',clock_timestamp(),clock_timestamp(),gen_random_uuid());
insert into public.telegram_auth_bindings(id,auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
 values('${BINDING}','${NURSE}','staff','actor-races:${BINDING}','actor-races','+999000770002','770002',1);
delete from public.staff_telegram_policy;`;
const manage=change=>`begin;
select 1 from public.real_staff_invitations where expected_auth_user_id='${NURSE}' for update;
select pg_sleep(1.5);
update public.workspace_staff set ${change} where user_id='${NURSE}';
commit;`;
const authority=`select (public._telegram_nurse_authority('${BINDING}',1)).user_id;`;
const pause=ms=>new Promise(done=>setTimeout(done,ms));
// Preserve only the isolated configuration touched by this schedule.
const before=JSON.parse(sql(`select json_build_object(
 'settings',exists(select 1 from public.telegram_channel_settings),
 'policy',exists(select 1 from public.conversation_policy),
 'delivery',(select delivery_enabled from public.conversation_policy),
 'nurseEnabled',(select enabled from public.telegram_nurse_settings),
 'visitEnabled',(select enabled from public.nurse_visit_settings),
 'templates',(select json_agg(json_build_object('template',template_id,'locale',locale,'approved',approved))from public.system_message_templates where template_id like 'telegram.nurse.%'and version=1));`));
const restore=`update public.nurse_visit_settings set enabled=${before.visitEnabled===true};
update public.telegram_nurse_settings set enabled=${before.nurseEnabled===true};
${before.policy?`update public.conversation_policy set delivery_enabled=${before.delivery===true};`:'delete from public.conversation_policy;'}
${before.settings?'':'delete from public.telegram_channel_settings;'}
set session_replication_role=replica;
${before.templates.map(t=>`update public.system_message_templates set approved=${t.approved} where template_id='${t.template}'and locale='${t.locale}'and version=1;`).join('\n')}
set session_replication_role=origin;`;
try{
 sql(seed);
 let admin=start(manage(`display_name='Synthetic race nurse two'`));await pause(500);
 let check=start(authority);
 let [a,c]=await Promise.all([admin,check]);
 assert.equal(a.code,0,a.err);assert.equal(c.code,0,`Authority must wait, not deadlock: ${c.err}`);assert.match(c.out,new RegExp(NURSE));
 admin=start(manage(`active=false,removed_at=now()`));await pause(500);
 check=start(authority);
 [a,c]=await Promise.all([admin,check]);
 assert.equal(a.code,0,a.err);assert.notEqual(c.code,0,'A removal that commits first is refused');assert.match(c.err,/insufficient_privilege|permission denied/);assert.doesNotMatch(c.err,/deadlock/);
 // Real PR2 entry points with a synthetic assigned task and configured local bot.
 sql(`update public.workspace_staff set active=true,removed_at=null where user_id='${NURSE}';
 insert into auth.users(id,email,phone,phone_confirmed_at)values('${MEMBER}','${MEMBER}@example.invalid','999000779001',now());
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values('${MEMBER}','${ADMIN}','${NURSE}');
 insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,due_at,creator_id,owner_id)
 values('${TASK}','${MEMBER}','contact-followup','Synthetic race task','Synthetic instructions',now()-interval '1 hour','${ADMIN}','${NURSE}');
 insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('nurse_races',9912,600,'synthetic')on conflict(singleton)do nothing;
 insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)
 values(true,'synthetic-nurse-races',3600,600,60,100,false,true)on conflict(singleton)do update set delivery_enabled=true;
 update public.telegram_nurse_settings set enabled=true;
 update public.system_message_templates set approved=true where template_id like 'telegram.nurse.%'and version=1;
 update public.telegram_auth_bindings set principal_ref=(select public._telegram_principal_ref(s,770002)from public.telegram_channel_settings s),
 account_ref=(select public._telegram_account_ref(s)from public.telegram_channel_settings s)where id='${BINDING}';
 insert into public.channel_inbox(id,adapter,event_id,fingerprint,principal_ref,kind,payload,status,attempts,lease_until)
 select '${INBOX}','telegram','actor-race:${INBOX}','race-fingerprint',principal_ref,'text','{"chatId":770002,"messageId":700001,"text":"/today"}','processing',1,clock_timestamp()+interval '60 seconds'
 from public.telegram_auth_bindings where id='${BINDING}';`);
 let first=start(`${service}begin;select public.telegram_nurse_receive('${INBOX}',true);select pg_sleep(0.5);commit;`);
 await pause(100);
 let second=start(`${service}select public.telegram_nurse_receive('${INBOX}',true);`);
 [a,c]=await Promise.all([first,second]);assert.equal(a.code,0,a.err);assert.equal(c.code,0,c.err);
 assert.equal(rows(a).at(-1).status,'ready');assert.equal(rows(c).at(-1).status,'ready');
 first=start(`${service}begin;select public.telegram_nurse_apply('${INBOX}',true,1);select pg_sleep(0.5);commit;`);
 await pause(100);
 second=start(`${service}select public.telegram_nurse_apply('${INBOX}',true,1);`);
 [a,c]=await Promise.all([first,second]);assert.equal(a.code,0,a.err);assert.equal(c.code,0,c.err);
 assert.equal(rows(a).at(-1).status,'queued');assert.equal(rows(c).at(-1).status,'queued');
 assert.equal(sql(`select count(*)from public.telegram_nurse_outbox where source_inbox='${INBOX}';`),'1','Concurrent apply creates one ordered turn');
 const outbox=sql(`select id from public.telegram_nurse_outbox where source_inbox='${INBOX}';`);
 first=start(`${service}begin;select public.telegram_nurse_outbox_claim('${outbox}',true);select pg_sleep(0.5);commit;`);
 await pause(100);
 second=start(`${service}select public.telegram_nurse_outbox_claim('${outbox}',true);`);
 [a,c]=await Promise.all([first,second]);assert.equal(a.code,0,a.err);assert.equal(c.code,0,c.err);
 assert.equal(rows(a).at(-1).ok,true);assert.equal(rows(c).at(-1).ok,false,'Two workers cannot both attempt a send');
 const attempt=rows(a).at(-1).envelope.attemptId;
 sql(`${service}select public.telegram_nurse_outbox_outcome('${outbox}','${attempt}',true,'{"kind":"accepted","providerRef":"700002"}');
 insert into public.channel_inbox(id,adapter,event_id,fingerprint,principal_ref,kind,payload,status,attempts,lease_until)
 select '${SECOND}','telegram','actor-race:${SECOND}','second-race-fingerprint',principal_ref,'text','{"chatId":770002,"messageId":700003,"text":"/today"}','processing',1,clock_timestamp()+interval '60 seconds'
 from public.telegram_auth_bindings where id='${BINDING}';
 select public.telegram_nurse_receive('${SECOND}',true);select public.telegram_nurse_apply('${SECOND}',true,1);`);
 // Deliver the second Today, select its real opaque callback, and deliver its
 // prompt. Then two workers apply the same durably received completion note.
 const deliveredToday=sql(`select id from public.telegram_nurse_outbox where source_inbox='${SECOND}';`);
 const drain=`${service}do $$declare oid uuid;env jsonb;n bigint:=700010;begin loop
  select (public.telegram_nurse_outbox_queue(true,1)->'ids'->>0)::uuid into oid;exit when oid is null;
  env:=public.telegram_nurse_outbox_claim(oid,true)->'envelope';if env is null then raise exception 'Synthetic send refused';end if;
  perform public.telegram_nurse_outbox_outcome(oid,(env->>'attemptId')::uuid,true,jsonb_build_object('kind','accepted','providerRef',n::text));n:=n+1;
 end loop;end$$;`;
 sql(drain);
 sql(`${service}insert into public.channel_inbox(id,adapter,event_id,fingerprint,principal_ref,kind,payload,status,attempts,lease_until)
 select '${CALLBACK}','telegram','actor-race:${CALLBACK}','callback-fingerprint',b.principal_ref,'callback',
 jsonb_build_object('chatId',770002,'messageId',o.provider_ref::bigint,'callbackId','race_callback','intentRef',o.turn#>>'{tasks,0,intentRef}'),
 'processing',1,clock_timestamp()+interval '60 seconds'from public.telegram_auth_bindings b cross join public.telegram_nurse_outbox o where b.id='${BINDING}'and o.id='${deliveredToday}';
 select public.telegram_nurse_receive('${CALLBACK}',true);select public.telegram_nurse_apply('${CALLBACK}',true,1);`);
 sql(drain);
 sql(`${service}insert into public.channel_inbox(id,adapter,event_id,fingerprint,principal_ref,kind,payload,status,attempts,lease_until)
 select '${NOTE}','telegram','actor-race:${NOTE}','note-fingerprint',b.principal_ref,'text',
 jsonb_build_object('chatId',770002,'messageId',700020,'text','Synthetic concurrent completion','replyToMessageId',d.prompt_message_id::bigint),
 'processing',1,clock_timestamp()+interval '60 seconds'from public.telegram_auth_bindings b join public.telegram_nurse_dialogs d on d.binding_id=b.id where b.id='${BINDING}';
 select public.telegram_nurse_receive('${NOTE}',true);`);
 first=start(`${service}begin;select public.telegram_nurse_apply('${NOTE}',true,1);select pg_sleep(0.5);commit;`);
 await pause(100);second=start(`${service}select public.telegram_nurse_apply('${NOTE}',true,1);`);
 [a,c]=await Promise.all([first,second]);assert.equal(a.code,0,a.err);assert.equal(c.code,0,c.err);
 assert.equal(rows(a).at(-1).status,'saved');assert.equal(rows(c).at(-1).status,'saved');
 assert.equal(sql(`select count(*)from public.patient_coordination_events where task_id='${TASK}';`),'1','Concurrent completion has one task event');
 assert.equal(sql(`select count(*)from public.patient_coordination_receipts where patient_case_id='${MEMBER}';`),'1','Concurrent completion has one receipt');
 // A second synthetic open question pins a fresh exact command. Revocation owns
 // the binding row first, so the waiting business write must be refused.
 sql(`${service}update public.patient_coordination_tasks set status='open',revision=revision+1 where id='${TASK}';
 update public.telegram_nurse_dialogs set question_version=question_version+1,question_key='task-note',expected_mode='reply',task_id='${TASK}',
 task_revision=(select revision from public.patient_coordination_tasks where id='${TASK}'),prompt_message_id='700030',pending_inbox=null,expires_at=clock_timestamp()+interval '30 minutes'where binding_id='${BINDING}';
 insert into public.channel_inbox(id,adapter,event_id,fingerprint,principal_ref,kind,payload,status,attempts,lease_until)
 select '${REVOKEDNOTE}','telegram','actor-race:${REVOKEDNOTE}','revocation-note-fingerprint',principal_ref,'text',
 '{"chatId":770002,"messageId":700031,"text":"Synthetic revoked completion","replyToMessageId":700030}',
 'processing',1,clock_timestamp()+interval '60 seconds'from public.telegram_auth_bindings where id='${BINDING}';
 select public.telegram_nurse_receive('${REVOKEDNOTE}',true);`);
 first=start(`begin;update public.telegram_auth_bindings set active=false,revoked_at=clock_timestamp()where id='${BINDING}';select pg_sleep(0.5);commit;`);
 await pause(100);second=start(`${service}select public.telegram_nurse_apply('${REVOKEDNOTE}',true,1);`);
 [a,c]=await Promise.all([first,second]);assert.equal(a.code,0,a.err);assert.equal(c.code,0,c.err);
 assert.equal(rows(c).at(-1).status,'refused','Committed revocation wins over waiting business completion');
 assert.equal(sql(`select count(*)from public.patient_coordination_events where task_id='${TASK}';`),'1','Revoked completion creates no second event');
 sql(`${service}update public.telegram_auth_bindings set active=true,revoked_at=null where id='${BINDING}';
 update public.telegram_nurse_outbox set state='suppressed'where binding_id='${BINDING}'and state='queued';
 insert into public.channel_inbox(id,adapter,event_id,fingerprint,principal_ref,kind,payload,status,attempts,lease_until)
 select '${QUEUEINBOX}','telegram','actor-race:${QUEUEINBOX}','queue-fingerprint',principal_ref,'text','{"chatId":770002,"messageId":700040,"text":"/today"}',
 'processing',1,clock_timestamp()+interval '60 seconds'from public.telegram_auth_bindings where id='${BINDING}';
 select public.telegram_nurse_receive('${QUEUEINBOX}',true);select public.telegram_nurse_apply('${QUEUEINBOX}',true,1);`);

 const queued=sql(`select id from public.telegram_nurse_outbox where source_inbox='${QUEUEINBOX}';`);
 first=start(`begin;update public.telegram_auth_bindings set active=false,revoked_at=clock_timestamp()where id='${BINDING}';select pg_sleep(0.5);commit;`);
 await pause(100);second=start(`${service}select public.telegram_nurse_outbox_claim('${queued}',true);`);
 [a,c]=await Promise.all([first,second]);assert.equal(a.code,0,a.err);assert.equal(c.code,0,c.err);
 assert.equal(rows(c).at(-1).status,'access','Committed revocation wins over waiting outgoing claim');
 assert.equal(sql(`select attempt_id is null from public.telegram_nurse_outbox where id='${queued}';`),'t','Refused claim creates no attempt');
 // The actual visit mark body authorizes the captured Telegram actor, then
 // writes a structured measurement. Revocation commits while that call waits
 // for the binding lock: no mark, case revision, or clinical event may escape.
 sql(`update public.telegram_auth_bindings set active=true,revoked_at=null where id='${BINDING}';
 update public.nurse_visit_settings set enabled=true;
 insert into public.patient_test_requests(id,user_id,status,requested_terms,requirements,algorithm_version,context_token,create_payload,current_arrangement)
 values('${VISITREQUEST}','${MEMBER}','confirmed','{}','[]','synthetic','synthetic','{}',
 jsonb_build_object('terms',jsonb_build_object('mode','home','startsAt',date_trunc('minute',clock_timestamp()),'timezone','Asia/Yerevan','location','Synthetic visit location')));`);
 const visitBefore=sql(`select json_build_object('revision',revision,'events',(select count(*)from public.patient_clinical_case_events where user_id='${MEMBER}'))from public.patient_clinical_cases where user_id='${MEMBER}';`);
 first=start(`begin;update public.telegram_auth_bindings set active=false,revoked_at=clock_timestamp()where id='${BINDING}';select pg_sleep(0.5);commit;`);
 await pause(100);
 second=start(`${service}select public._nurse_visit_mark_as('${NURSE}','${BINDING}',1,
 jsonb_build_object('version','nurse-visit-v1','memberId','${MEMBER}','source','home-request','sourceId','${VISITREQUEST}',
 'submissionId','${VISITMARK}','item','measure:bp','done',true,'note',null,'values',jsonb_build_object('systolic',148,'diastolic',93,'pulse',72)));`);
 [a,c]=await Promise.all([first,second]);assert.equal(a.code,0,a.err);assert.equal(c.code,0,c.err);
 assert.equal(rows(c).at(-1).status,'access','Committed revocation wins over waiting real visit mark');
 assert.equal(sql(`select count(*)from public.nurse_visit_marks where source_id='${VISITREQUEST}';`),'0','Revoked visit mark writes no measurement');
 assert.equal(sql(`select json_build_object('revision',revision,'events',(select count(*)from public.patient_clinical_case_events where user_id='${MEMBER}'))from public.patient_clinical_cases where user_id='${MEMBER}';`),visitBefore,'Revoked visit mark has no clinical side effects');
 console.log('Nurse actor races: staff-removal authority order, duplicate receive/apply and business completion, one-attempt send, revocation-before-save and revocation-before-claim and real visit mark after revocation schedules passed.');

}finally{sql(clean);sql(restore);}
