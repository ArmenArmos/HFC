-- Isolated, rolled-back risk-path checks. No provider or hosted database.
-- Run after a clean migration replay. Source authored here; runtime evidence must
-- come from running this script, the two-connection races and fake-provider E2E.
\set ON_ERROR_STOP on
begin;
create function pg_temp.nt_ok(ok boolean,label text)returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Nurse Telegram test: %',label;end if;
end$$;
create temp table nt_fixture as select gen_random_uuid()nurse,gen_random_uuid()doctor,gen_random_uuid()other,
 gen_random_uuid()member,gen_random_uuid()clinic,gen_random_uuid()binding,gen_random_uuid()task,
 gen_random_uuid()future,gen_random_uuid()referral;
create temp sequence nt_sequence start 55001;
insert into auth.users(id,email)select u,u||'@example.invalid'from nt_fixture cross join lateral unnest(array[nurse,doctor,other,member])u;
update auth.users set phone='999000774001',phone_confirmed_at=now()where id=(select member from nt_fixture);
update public.profiles set display_name='Synthetic member',birth_date='1980-01-01',biological_sex='female',locale='en'where id=(select member from nt_fixture);
update public.profiles set locale='en'where id=(select nurse from nt_fixture);
insert into public.patient_consents(user_id,version)select member,'patient-pilot-v1'from nt_fixture;
insert into public.patient_assessments(user_id,revision,completed_at)select member,1,now()from nt_fixture;
insert into public.workspace_clinics(id,name)select clinic,'Synthetic task clinic'from nt_fixture;
insert into public.workspace_staff(user_id,role,display_name,clinic_id)
 select nurse,'nurse','Synthetic nurse',clinic from nt_fixture union all select doctor,'doctor','Synthetic doctor',clinic from nt_fixture union all select other,'nurse','Synthetic other nurse',clinic from nt_fixture;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)select member,doctor,nurse from nt_fixture;
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('nurse_tasks_test',9911,600,'synthetic')on conflict(singleton)do update set account=excluded.account,bot_id=excluded.bot_id;
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)
 values(true,'synthetic-nurse-tasks',3600,600,60,100,false,true)on conflict(singleton)do update set delivery_enabled=true;
delete from public.staff_telegram_policy;
insert into public.telegram_auth_bindings(id,auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
 select binding,nurse,'staff','["telegram","nurse_tasks_test",9911,"user",774001]','["nurse_tasks_test",9911]','+999000774002','774001',1 from nt_fixture;
insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,due_at,creator_id,owner_id)
 select task,member,'contact-followup','Synthetic due task','Synthetic task instructions',now()-interval '1 hour',doctor,nurse from nt_fixture union all
 select future,member,'contact-followup','Synthetic future task','Future instructions',now()+interval '2 days',doctor,nurse from nt_fixture union all
 select referral,member,'doctor-referral','Synthetic referral','Referral instructions',now()-interval '30 minutes',doctor,doctor from nt_fixture;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);

create function pg_temp.nt_event(kind text,payload jsonb)returns uuid language plpgsql as $$
declare n bigint:=nextval('nt_sequence');e jsonb;r jsonb;id_ uuid;
begin
 e:=jsonb_build_object('adapter','telegram','eventId','nt:'||n,'fingerprint','nt-fp:'||n,'principalRef','["telegram","nurse_tasks_test",9911,"user",774001]',
  'kind',kind,'payload',jsonb_build_object('chatId',774001,'messageId',n)||payload);
 r:=public.channel_inbox_commit(e);perform pg_temp.nt_ok(r->>'status'='committed','commit admitted fixture');
 select id into id_ from public.channel_inbox where event_id='nt:'||n;
 update public.channel_inbox set status='processing',attempts=1,lease_until=clock_timestamp()+interval '60 seconds'where id=id_;
 return id_;
end$$;
create function pg_temp.nt_process(id_ uuid)returns jsonb language plpgsql as $$declare r jsonb;begin
 r:=public.telegram_nurse_receive(id_,true);perform pg_temp.nt_ok(r->>'handled'='true','captured nurse routed');
 if r->>'status'='ready'then return public.telegram_nurse_apply(id_,true,(r->>'leaseAttempt')::int);end if;return r;
end$$;
create function pg_temp.nt_send(stop_kind text default null,stop_result text default 'accepted')returns jsonb language plpgsql as $$
declare ids jsonb;i uuid;claimed jsonb;envelope jsonb;n integer:=0;result jsonb;
begin
 loop
  ids:=public.telegram_nurse_outbox_queue(true,1)->'ids';exit when jsonb_array_length(ids)=0;
  i:=(ids->>0)::uuid;claimed:=public.telegram_nurse_outbox_claim(i,true);exit when claimed->>'ok'<>'true';
  envelope:=claimed->'envelope';n:=n+1;perform pg_temp.nt_ok(n<100,'outbox terminates');
  result:=jsonb_build_object('kind',case when envelope#>>'{turn,kind}'=stop_kind then stop_result else 'accepted'end);
  if result->>'kind'='accepted'then result:=result||jsonb_build_object('providerRef',nextval('nt_sequence')::text);end if;
  perform public.telegram_nurse_outbox_outcome(i,(envelope->>'attemptId')::uuid,true,result);
  if envelope#>>'{turn,kind}'=stop_kind then return envelope;end if;
 end loop;return envelope;
end$$;
create function pg_temp.nt_select(task_ uuid)returns uuid language plpgsql as $$
declare id_ uuid;o public.telegram_nurse_outbox;item jsonb;
begin
 id_:=pg_temp.nt_event('text','{"text":"/today"}');perform pg_temp.nt_process(id_);perform pg_temp.nt_send();
 select x.* into o from public.telegram_nurse_outbox x where x.source_inbox=id_ and exists(select 1 from jsonb_array_elements(x.turn->'tasks')t where t->>'id'=task_::text);
 select t into item from jsonb_array_elements(o.turn->'tasks')t where t->>'id'=task_::text;
 id_:=pg_temp.nt_event('callback',jsonb_build_object('messageId',o.provider_ref::bigint,'callbackId','ntcb_'||nextval('nt_sequence'),'intentRef',item->>'intentRef'));
 perform pg_temp.nt_process(id_);return id_;
end$$;
create function pg_temp.nt_prompt()returns bigint language sql as $$select prompt_message_id::bigint from public.telegram_nurse_dialogs where binding_id=(select binding from nt_fixture)and generation=1$$;
create function pg_temp.nt_reset_task()returns void language plpgsql as $$begin
 update public.patient_coordination_tasks set status='open',revision=revision+1 where id=(select task from nt_fixture);
 -- Explicitly close only this synthetic dialog; each subsequent selection still
 -- passes through real Today, callback and provider-outcome RPCs.
 update public.telegram_nurse_dialogs set question_version=question_version+1,question_key='idle',expected_mode='none',pending_inbox=null,task_id=null,task_revision=null,prompt_message_id=null;
 update public.telegram_nurse_outbox set abandoned=true where state in('sending','unknown');
 update public.telegram_nurse_outbox set state='suppressed'where state='queued';
end$$;

-- Default off, all four gate combinations, and original throttled staff-chat path.
do $$declare db boolean;env boolean;i uuid;r jsonb;before_count bigint;begin
 perform pg_temp.nt_ok(not(select enabled from public.telegram_nurse_settings),'switch seeded off');
 foreach db in array array[false,true]loop foreach env in array array[false,true]loop
  update public.telegram_nurse_settings set enabled=db;
  i:=pg_temp.nt_event('text','{"text":"hello"}');select count(*)into before_count from public.telegram_nurse_outbox;
  r:=public.telegram_nurse_receive(i,env);
  if db and env then perform pg_temp.nt_ok(r->>'handled'='true','both gates route');perform public.telegram_nurse_apply(i,true,1);
  else
   perform pg_temp.nt_ok(r='{"handled":false}'::jsonb,'off route unchanged');
   perform pg_temp.nt_ok(public.telegram_nurse_apply(i,env,1)->>'status'='disabled','off write denied');
   perform pg_temp.nt_ok(public.telegram_nurse_resume(i,env,1)->>'status'='disabled','off resume denied');
   perform pg_temp.nt_ok(public.telegram_nurse_outbox_claim(gen_random_uuid(),env)->>'status'='disabled','off send claim denied');
   perform pg_temp.nt_ok(public.telegram_nurse_outbox_outcome(gen_random_uuid(),gen_random_uuid(),env,'{"kind":"unknown"}')->>'status'='disabled','off send outcome denied');
   perform pg_temp.nt_ok(public.telegram_nurse_outbox_reconcile(env)->>'status'='disabled','off send reconciliation denied');
   perform pg_temp.nt_ok(public.telegram_nurse_outbox_queue(env,10)->'ids'='[]'::jsonb,'off outgoing queue denied');
   perform public.channel_inbox_process(i);
   perform pg_temp.nt_ok((select count(*)from public.telegram_nurse_outbox)=before_count,'off creates no nurse output');
  end if;
 end loop;end loop;
 perform pg_temp.nt_ok((select count(*)=1 from public.telegram_auth_messages where address='774001'and template_id='telegram.staff_chat'),'original staff reply remains hourly throttled');
end$$;

-- An approved version is approval for this renderer/schema/copy tuple, not text.
do $$declare i uuid;o uuid;c jsonb;f record;begin
 select * into f from nt_fixture;
 select id into o from public.telegram_nurse_outbox where state='queued'order by sequence limit 1;
 c:=public.telegram_nurse_outbox_claim(o,true);perform pg_temp.nt_ok(c->>'status'='unapproved','default templates held');
 update public.system_message_templates set approved=true where template_id like 'telegram.nurse.%';
 update public.system_message_templates set substitution_schema='{}'where template_id='telegram.nurse.today';
 perform pg_temp.nt_ok(public.telegram_nurse_outbox_claim(o,true)->>'status'='unapproved','arbitrary shell approval denied');
 update public.system_message_templates set substitution_schema=public._telegram_nurse_template_schema('today')where template_id='telegram.nurse.today';
 perform pg_temp.nt_send();
 i:=pg_temp.nt_event('text','{"text":"hello again"}');perform pg_temp.nt_process(i);
 perform pg_temp.nt_ok((select sum(jsonb_array_length(turn->'tasks'))=2 from public.telegram_nurse_outbox where source_inbox=i),'ordinary nurse text shows due tasks only');
 perform pg_temp.nt_ok(not exists(select 1 from public.telegram_nurse_outbox o cross join lateral jsonb_array_elements(o.turn->'tasks')t where o.source_inbox=i and t->>'id'=f.future::text),'future task absent');
 perform pg_temp.nt_ok(exists(select 1 from public.telegram_nurse_outbox o cross join lateral jsonb_array_elements(o.turn->'tasks')t where o.source_inbox=i and t->>'id'=f.referral::text and t->'intentRef'='null'::jsonb),'doctor referral has no completion control');
 perform pg_temp.nt_ok(exists(select 1 from public.access_audit where member_id=f.member and actor_id=f.nurse and channel='telegram'and session_id is null and binding_id=f.binding),'truthful list audit');
 perform pg_temp.nt_send();
end$$;

-- Prompt/carrier fencing, exact lease, durable command, one atomic business effect.
do $$declare f record;select_id uuid;note_id uuid;wrong uuid;cmd jsonb;r jsonb;prompt bigint;events_before bigint;begin
 select * into f from nt_fixture;select_id:=pg_temp.nt_select(f.task);perform pg_temp.nt_send();prompt:=pg_temp.nt_prompt();
 perform pg_temp.nt_ok(prompt is not null,'provider receipt binds forced reply prompt');
 wrong:=pg_temp.nt_event('text','{"text":"Synthetic unrelated note"}');perform pg_temp.nt_ok(pg_temp.nt_process(wrong)->>'status'='refused','unrelated typed text refused');
 wrong:=pg_temp.nt_event('text',jsonb_build_object('text','Synthetic wrong prompt','replyToMessageId',prompt+1));perform pg_temp.nt_ok(pg_temp.nt_process(wrong)->>'status'='refused','foreign prompt refused');
 update public.telegram_nurse_dialogs set expires_at=clock_timestamp()-interval '1 second'where binding_id=f.binding;
 wrong:=pg_temp.nt_event('text',jsonb_build_object('text','Synthetic expired note','replyToMessageId',prompt));perform pg_temp.nt_ok(pg_temp.nt_process(wrong)->>'status'='refused','expired answer refused');
 update public.telegram_nurse_dialogs set expires_at=clock_timestamp()+interval '30 minutes'where binding_id=f.binding;
 note_id:=pg_temp.nt_event('text',jsonb_build_object('text','Synthetic exact completion note','replyToMessageId',prompt));r:=public.telegram_nurse_receive(note_id,true);
 select nurse_context->'command'into cmd from public.channel_inbox where id=note_id;
 perform pg_temp.nt_ok(cmd#>>'{input,note}'='Synthetic exact completion note'and cmd->>'requestId'is not null,'exact command persisted before apply');
 perform pg_temp.nt_ok(public.telegram_nurse_apply(note_id,true,2)->>'status'='not_leased','foreign lease attempt refused');
 update public.channel_inbox set lease_until=clock_timestamp()-interval '1 second'where id=note_id;
 perform pg_temp.nt_ok(public.telegram_nurse_apply(note_id,true,1)->>'status'='not_leased','expired lease refused');
 update public.channel_inbox set attempts=2,lease_until=clock_timestamp()+interval '60 seconds'where id=note_id;
 perform pg_temp.nt_ok(public.telegram_nurse_apply(note_id,true,1)->>'status'='not_leased','displaced lease refused');
 perform pg_temp.nt_ok(public.telegram_nurse_apply(note_id,true,2)->>'status'='saved','current lease saves');
 perform pg_temp.nt_ok(public.telegram_nurse_resume(note_id,true,2)->>'status'='saved','same immutable receipt replay');
 perform pg_temp.nt_ok((select count(*)=1 from public.patient_coordination_events where request_id=(cmd->>'requestId')::uuid),'one task effect');
 perform pg_temp.nt_ok((select count(*)=1 from public.patient_coordination_receipts where request_id=(cmd->>'requestId')::uuid and actor_id=f.nurse and channel='telegram'and session_id is null and binding_id=f.binding),'one truthful receipt');
 perform pg_temp.nt_ok((select status='done'and nurse_result->>'status'='saved'from public.channel_inbox where id=note_id),'inbox committed atomically');
 perform pg_temp.nt_ok((select expected_mode='none'and pending_inbox is null from public.telegram_nurse_dialogs where binding_id=f.binding),'dialog committed atomically');
 perform pg_temp.nt_ok((select count(*)=1 from public.telegram_nurse_outbox where source_inbox=note_id and turn->>'kind'='task-saved'),'one next step, no typed note echo');
 update public.patient_clinical_cases set assigned_nurse_id=f.other where user_id=f.member;
 perform pg_temp.nt_ok(public.telegram_nurse_resume(note_id,true,2)->>'status'='refused','receipt replay rechecks current assignment');
 update public.patient_clinical_cases set assigned_nurse_id=f.nurse where user_id=f.member;
end$$;

-- NT-01: an inbox event belongs to its captured binding forever, even when
-- receive is skipped by the environment gate. The replacement is an eligible
-- member with an active endpoint: legacy text routing would store this note.
do $$declare f record;db boolean;env boolean;i uuid;b uuid;ep uuid;before_ jsonb;r jsonb;begin
 select * into f from nt_fixture;
 foreach db in array array[false,true]loop foreach env in array array[false,true]loop
  update public.telegram_nurse_settings set enabled=true;
  perform pg_temp.nt_reset_task();perform pg_temp.nt_select(f.task);perform pg_temp.nt_send();
  i:=pg_temp.nt_event('text',jsonb_build_object('text','Synthetic private nurse note','replyToMessageId',pg_temp.nt_prompt()));
  select jsonb_build_object('principal',principal_ref,'binding',nurse_binding_id,'generation',nurse_binding_generation,'endpoint',endpoint_id,'endpointGeneration',endpoint_generation)into before_ from public.channel_inbox where id=i;
  update public.telegram_auth_bindings set active=false,revoked_at=clock_timestamp()where id=f.binding;
  b:=gen_random_uuid();ep:=gen_random_uuid();
  insert into public.telegram_auth_bindings(id,auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
   values(b,f.member,'member','["telegram","nurse_tasks_test",9911,"user",774001]','["nurse_tasks_test",9911]','+999000774001','774001',2);
  insert into public.conversation_endpoints(id,member_id,adapter,account_ref,principal_ref,address,generation,active,policy_version,expires_at,max_utf16,binding_id)
   values(ep,f.member,'telegram','["nurse_tasks_test",9911]','["telegram","nurse_tasks_test",9911,"user",774001]','774001',2,true,'synthetic-nurse-tasks','infinity',4096,b);
  perform pg_temp.nt_ok(public._telegram_member_eligible(f.member),'replacement member eligible');
  update public.telegram_nurse_settings set enabled=db;
  r:='{"handled":false}';
  if env then r:=public.telegram_nurse_receive(i,true);end if;
  if r->>'handled'='false'then perform public.channel_inbox_process(i);end if;
  perform pg_temp.nt_ok(not exists(select 1 from public.conversation_messages where request_id=i),'NT-01: no member message for any gate combination');
  perform pg_temp.nt_ok(not exists(select 1 from public.conversation_doctor_alerts where inbox_id=i),'NT-01: no doctor alert for any gate combination');
  perform pg_temp.nt_ok((select jsonb_build_object('principal',principal_ref,'binding',nurse_binding_id,'generation',nurse_binding_generation,'endpoint',endpoint_id,'endpointGeneration',endpoint_generation)=before_ and status='done' and result='nurse_access' and not payload?'text' and nurse_context is null from public.channel_inbox where id=i),'NT-01: refused event retains captured identity');
  delete from public.conversation_endpoints where id=ep;
  delete from public.telegram_auth_bindings where id=b;
  update public.telegram_auth_bindings set active=true,revoked_at=null where id=f.binding;
 end loop;end loop;
 update public.telegram_nurse_settings set enabled=true;
end$$;

-- R3: A receives, B explicitly recovers its exact command, then delayed A applies.
do $$declare f record;a uuid;b uuid;cmd jsonb;begin
 select * into f from nt_fixture;perform pg_temp.nt_reset_task();perform pg_temp.nt_select(f.task);perform pg_temp.nt_send();
 a:=pg_temp.nt_event('text',jsonb_build_object('text','Synthetic recovery note','replyToMessageId',pg_temp.nt_prompt()));perform public.telegram_nurse_receive(a,true);
 select nurse_context->'command'into cmd from public.channel_inbox where id=a;
 b:=pg_temp.nt_event('text','{"text":"/resume"}');perform public.telegram_nurse_receive(b,true);
 perform pg_temp.nt_ok((select nurse_context->'command'=cmd from public.channel_inbox where id=b),'resume keeps exact request and note');
 update public.channel_inbox set received_at=clock_timestamp()-interval '2 days'where id in(a,b);
 perform public.auth_cleanup_run();
 perform pg_temp.nt_ok((select nurse_context->'command'=cmd and payload->>'text'='Synthetic recovery note' from public.channel_inbox where id=a),'NT-03: cleanup preserves the unresolved exact command and original note');
 perform pg_temp.nt_ok(public.telegram_nurse_apply(a,true,1)->>'status'='refused','old worker is displaced');
 perform pg_temp.nt_ok((select pending_inbox=b from public.telegram_nurse_dialogs where binding_id=f.binding),'old worker cannot erase new pin');
 perform pg_temp.nt_ok(public.telegram_nurse_apply(b,true,1)->>'status'='saved','new worker saves retained command');
 perform pg_temp.nt_ok((select count(*)=1 from public.patient_coordination_events where request_id=(cmd->>'requestId')::uuid),'transferred command has one effect');
end$$;

-- NT-03: the original fifth lease is never applied after /resume copies it.
-- Refusing the copy must retire the exact command in BOTH transport rows.
do $$declare f record;a uuid;b uuid;cmd jsonb;begin
 select * into f from nt_fixture;perform pg_temp.nt_reset_task();perform pg_temp.nt_select(f.task);perform pg_temp.nt_send();
 a:=pg_temp.nt_event('text',jsonb_build_object('text','Synthetic refused copied note','replyToMessageId',pg_temp.nt_prompt()));
 update public.channel_inbox set attempts=5 where id=a;
 perform public.telegram_nurse_receive(a,true);
 select nurse_context->'command'into cmd from public.channel_inbox where id=a;
 b:=pg_temp.nt_event('text','{"text":"/resume"}');perform public.telegram_nurse_receive(b,true);
 perform pg_temp.nt_ok((select nurse_context->'command'=cmd from public.channel_inbox where id=b),'NT-03: recovery copies fifth-lease command exactly');
 update public.patient_clinical_cases set assigned_nurse_id=f.other where user_id=f.member;
 perform pg_temp.nt_ok(public.telegram_nurse_apply(b,true,1)->>'status'='refused','NT-03: reassignment definitively refuses copied command');
 update public.channel_inbox set lease_until=clock_timestamp()-interval '1 second'where id=a;
 perform public.channel_inbox_next(1);
 perform pg_temp.nt_ok((select status='dead'and attempts=5 from public.channel_inbox where id=a),'NT-03: original fifth lease dead-letters without applying');
 update public.channel_inbox set processed_at=clock_timestamp()-interval '2 days'where id in(a,b);
 perform public.auth_cleanup_run();
 perform pg_temp.nt_ok((select count(*)=2 and bool_and(not payload?'text'and nurse_context is null)from public.channel_inbox where id in(a,b)),
  'NT-03: definitively refused note is absent from both transport copies after dead-lettering and cleanup');
 perform pg_temp.nt_ok(not exists(select 1 from public.patient_coordination_events where request_id=(cmd->>'requestId')::uuid),
  'NT-03: refused copied command has no business effect');
 perform pg_temp.nt_ok((select status='open'from public.patient_coordination_tasks where id=f.task),'NT-03: refused copied command leaves task open');
 update public.patient_clinical_cases set assigned_nurse_id=f.nurse where user_id=f.member;
end$$;

-- One-attempt output: failed control edit unblocks; unknown acknowledgement holds
-- its dependent prompt until explicit resume. Neither path replays a mutation.
do $$declare f record;i uuid;e jsonb;old_attempt uuid;old_prompt bigint;note_id uuid;cmd jsonb;begin
 select * into f from nt_fixture;perform pg_temp.nt_reset_task();i:=pg_temp.nt_select(f.task);
 e:=pg_temp.nt_send('clear-controls','unknown');
 perform pg_temp.nt_ok((select state='failed'from public.telegram_nurse_outbox where id=(e->>'outboxId')::uuid),'failed edit is terminal cosmetic work');
 e:=pg_temp.nt_send('action','unknown');old_attempt:=(e->>'attemptId')::uuid;
 perform pg_temp.nt_ok(public.telegram_nurse_outbox_queue(true,20)->'ids'='[]'::jsonb,'unknown acknowledgement blocks dependent question');
 perform pg_temp.nt_ok(public.telegram_nurse_outbox_claim((e->>'outboxId')::uuid,true)->>'ok'='false','unknown item cannot be claimed again');
 i:=pg_temp.nt_event('text','{"text":"/resume"}');perform pg_temp.nt_process(i);perform pg_temp.nt_send();
 perform pg_temp.nt_ok(pg_temp.nt_prompt()is not null,'resume creates newly correlated current prompt');
 perform pg_temp.nt_ok((select state='unknown'and abandoned from public.telegram_nurse_outbox where attempt_id=old_attempt),'unknown old item retained, never resent');
 note_id:=pg_temp.nt_event('text',jsonb_build_object('text','Synthetic save before send timeout','replyToMessageId',pg_temp.nt_prompt()));perform pg_temp.nt_process(note_id);
 select nurse_context->'command'into cmd from public.channel_inbox where id=note_id;
 e:=pg_temp.nt_send('task-saved','unknown');
 i:=pg_temp.nt_event('text','{"text":"/resume"}');perform pg_temp.nt_process(i);
 perform pg_temp.nt_ok(exists(select 1 from public.telegram_nurse_outbox where source_inbox=i and turn->>'kind'='task-recovered'),'resume explains authorized recorded result');
 perform pg_temp.nt_ok((select count(*)=1 from public.patient_coordination_events where request_id=(cmd->>'requestId')::uuid),'send timeout never repeats task command');
 perform pg_temp.nt_send();
end$$;

-- Revocation/replacement, active clinic/nurse, reassignment, stale task version,
-- and unknown callbacks are refused without creating a replacement identity.
do $$declare f record;i uuid;j uuid;e jsonb;o uuid;ref text;prompt bigint;begin
 select * into f from nt_fixture;perform pg_temp.nt_reset_task();perform pg_temp.nt_select(f.task);perform pg_temp.nt_send();prompt:=pg_temp.nt_prompt();
 i:=pg_temp.nt_event('text',jsonb_build_object('text','Synthetic race against reassignment','replyToMessageId',prompt));perform public.telegram_nurse_receive(i,true);
 update public.patient_clinical_cases set assigned_nurse_id=f.other where user_id=f.member;
 perform pg_temp.nt_ok(public.telegram_nurse_apply(i,true,1)->>'status'='refused','reassignment after receive refuses write');
 perform pg_temp.nt_ok((select pending_inbox is null and expected_mode='none'from public.telegram_nurse_dialogs where binding_id=f.binding),'terminal refusal leaves usable idle dialog');
 perform pg_temp.nt_ok((select not payload?'text' and nurse_context is null from public.channel_inbox where id=i),'NT-03: refused note scrubbed from payload and pinned command');
 update public.patient_clinical_cases set assigned_nurse_id=f.nurse where user_id=f.member;
 j:=pg_temp.nt_event('text','{"text":"/today"}');perform pg_temp.nt_ok(pg_temp.nt_process(j)->>'status'='queued','restored nurse can list tasks immediately');
 select id into o from public.telegram_nurse_outbox where source_inbox=j order by sequence limit 1;
 update public.patient_clinical_cases set assigned_nurse_id=f.other where user_id=f.member;
 perform pg_temp.nt_ok(public.telegram_nurse_outbox_claim(o,true)->>'status'='access','queued details suppressed after reassignment');
 update public.patient_clinical_cases set assigned_nurse_id=f.nurse where user_id=f.member;
 i:=pg_temp.nt_event('text','{"text":"/today"}');update public.workspace_staff set active=false where user_id=f.nurse;
 perform pg_temp.nt_ok(public.telegram_nurse_receive(i,true)->>'status'='refused','inactive nurse refused');update public.workspace_staff set active=true where user_id=f.nurse;
 i:=pg_temp.nt_event('text','{"text":"/today"}');update public.workspace_clinics set active=false where id=f.clinic;
 perform pg_temp.nt_ok(public.telegram_nurse_receive(i,true)->>'status'='refused','inactive clinic refused');update public.workspace_clinics set active=true where id=f.clinic;
 i:=pg_temp.nt_event('text','{"text":"/today"}');update public.workspace_staff set role='doctor'where user_id=f.nurse;
 perform pg_temp.nt_ok(public.telegram_nurse_receive(i,true)->>'status'='refused','captured nurse demoted refuses without member fallback');update public.workspace_staff set role='nurse'where user_id=f.nurse;
 i:=pg_temp.nt_event('text','{"text":"/today"}');update public.telegram_auth_bindings set active=false,revoked_at=now()where id=f.binding;
 perform pg_temp.nt_ok(public.telegram_nurse_receive(i,true)->>'status'='refused','revoked binding refused');
 j:=pg_temp.nt_event('text','{"text":"/today"}');perform pg_temp.nt_ok((select nurse_at_commit from public.channel_inbox where id=j),'revoked nurse still captured for permanent refusal');
 update public.telegram_auth_bindings set active=true,revoked_at=null,generation=2 where id=f.binding;
 perform pg_temp.nt_ok(public.telegram_nurse_receive(j,true)->>'status'='refused','queued old generation never acquires replacement identity');
 update public.telegram_auth_bindings set generation=1 where id=f.binding;
end$$;


-- Callback identity includes opaque reference, exact carrier, current question and
-- task revision. A cancelled prompt cannot reinterpret its delayed typed answer.
do $$declare f record;i uuid;j uuid;out_ public.telegram_nurse_outbox;item jsonb;prompt bigint;event_ jsonb;r jsonb;begin
 select * into f from nt_fixture;perform pg_temp.nt_reset_task();
 i:=pg_temp.nt_event('text','{"text":"/today"}');perform pg_temp.nt_process(i);perform pg_temp.nt_send();
 select * into out_ from public.telegram_nurse_outbox where source_inbox=i and turn->>'kind'='today'limit 1;
 select x into item from jsonb_array_elements(out_.turn->'tasks')x where x->>'id'=f.task::text;
 j:=pg_temp.nt_event('callback',jsonb_build_object('messageId',out_.provider_ref::bigint+1,'callbackId','wrong_carrier','intentRef',item->>'intentRef'));
 perform pg_temp.nt_ok(pg_temp.nt_process(j)->>'status'='refused','foreign callback carrier refused');
 j:=pg_temp.nt_event('callback',jsonb_build_object('messageId',out_.provider_ref::bigint,'callbackId','unknown_ref','intentRef',repeat('f',32)));
 perform pg_temp.nt_ok(pg_temp.nt_process(j)->>'status'='refused','unknown opaque reference refused');
 update public.patient_coordination_tasks set revision=revision+1 where id=f.task;
 j:=pg_temp.nt_event('callback',jsonb_build_object('messageId',out_.provider_ref::bigint,'callbackId','stale_revision','intentRef',item->>'intentRef'));
 perform pg_temp.nt_ok(pg_temp.nt_process(j)->>'status'='refused','task revision change invalidates old button');
 perform pg_temp.nt_select(f.task);perform pg_temp.nt_send();prompt:=pg_temp.nt_prompt();
 j:=pg_temp.nt_event('text',jsonb_build_object('text','/cancel','replyToMessageId',prompt));
 perform pg_temp.nt_ok(pg_temp.nt_process(j)->>'status'='queued','cancel accepts exact prompt only');
 perform pg_temp.nt_ok((select status='open'from public.patient_coordination_tasks where id=f.task),'cancel never completes task');
 j:=pg_temp.nt_event('text',jsonb_build_object('text','Synthetic delayed note after cancel','replyToMessageId',prompt));
 perform pg_temp.nt_ok(pg_temp.nt_process(j)->>'status'='refused','cancelled prompt delayed answer refused');
 perform pg_temp.nt_send();
 -- Fingerprints continue to own deduplication, including replyToMessageId.
 event_:=jsonb_build_object('adapter','telegram','eventId','nt-duplicate-proof','fingerprint','same-fingerprint','principalRef','["telegram","nurse_tasks_test",9911,"user",774001]',
  'kind','text','payload',jsonb_build_object('chatId',774001,'messageId',99887,'text','Synthetic duplicate','replyToMessageId',prompt));
 perform pg_temp.nt_ok(public.channel_inbox_commit(event_)->>'status'='committed','reply correlation accepted at commit');
 perform pg_temp.nt_ok(public.channel_inbox_commit(event_)->>'status'='committed-duplicate','identical input deduplicated');
 perform pg_temp.nt_ok(public.channel_inbox_commit(jsonb_set(event_,'{fingerprint}','"different"'))->>'status'='conflict','conflicting duplicate never changes captured command');
 perform pg_temp.nt_ok((select(payload->>'replyToMessageId')::bigint=prompt from public.channel_inbox where event_id='nt-duplicate-proof'),'reply target retained durably');
 update public.channel_inbox set status='done'where event_id='nt-duplicate-proof';
end$$;

-- A lost completion-result send followed by reassignment withholds its receipt
-- but abandons the blocked old chain, so other authorized work remains usable.
do $$declare f record;i uuid;e jsonb;receipt_id uuid;unknown_id uuid;begin
 select * into f from nt_fixture;perform pg_temp.nt_reset_task();perform pg_temp.nt_select(f.task);perform pg_temp.nt_send();
 i:=pg_temp.nt_event('text',jsonb_build_object('text','Synthetic completion before reassignment','replyToMessageId',pg_temp.nt_prompt()));perform pg_temp.nt_process(i);
 select(nurse_context#>>'{command,requestId}')::uuid into receipt_id from public.channel_inbox where id=i;
 e:=pg_temp.nt_send('task-saved','unknown');unknown_id:=(e->>'outboxId')::uuid;
 update public.patient_clinical_cases set assigned_nurse_id=f.other where user_id=f.member;
 i:=pg_temp.nt_event('text','{"text":"/resume"}');perform pg_temp.nt_ok(pg_temp.nt_process(i)->>'status'='queued','denied historical receipt does not trap recovery');
 perform pg_temp.nt_ok(not exists(select 1 from public.telegram_nurse_outbox where source_inbox=i and turn->>'kind'='task-recovered'),'reassigned historical receipt withheld');
 perform pg_temp.nt_ok((select abandoned and state='unknown'from public.telegram_nurse_outbox where id=unknown_id),'inaccessible old chain abandoned without resend');
 perform pg_temp.nt_send();
 perform pg_temp.nt_ok((select count(*)=1 from public.patient_coordination_events where request_id=receipt_id),'denied recovery does not mutate saved task');
 update public.patient_clinical_cases set assigned_nurse_id=f.nurse where user_id=f.member;
 -- Removed actors and revocation suppress queued details, not just new writes.
 i:=pg_temp.nt_event('text','{"text":"/today"}');perform pg_temp.nt_process(i);
 select id into unknown_id from public.telegram_nurse_outbox where source_inbox=i order by sequence limit 1;
 update public.workspace_staff set active=false,removed_at=now()where user_id=f.nurse;
 perform pg_temp.nt_ok(public.telegram_nurse_outbox_claim(unknown_id,true)->>'status'='access','removed nurse cannot claim queued output');
 update public.workspace_staff set active=true,removed_at=null where user_id=f.nurse;
 i:=pg_temp.nt_event('text','{"text":"/today"}');perform pg_temp.nt_process(i);
 select id into unknown_id from public.telegram_nurse_outbox where source_inbox=i order by sequence limit 1;
 update public.telegram_auth_bindings set active=false,revoked_at=now()where id=f.binding;
 perform pg_temp.nt_ok(public.telegram_nurse_outbox_claim(unknown_id,true)->>'status'='access','revocation suppresses previously queued output');
 perform pg_temp.nt_ok(public.telegram_nurse_resume((select id from public.channel_inbox where nurse_context#>>'{command,requestId}'=receipt_id::text limit 1),true,1)->>'status'='refused','receipt replay refused under revoked binding');
 update public.telegram_auth_bindings set active=true,revoked_at=null where id=f.binding;
end$$;


-- Capture follows the current principal owner, not a historical revoked nurse.
-- Events already captured under the old generation remain refused above.
do $$declare f record;k text;b uuid;i uuid;begin
 select * into f from nt_fixture;
 foreach k in array array['staff','member']loop
  update public.telegram_auth_bindings set active=false,revoked_at=now()where id=f.binding;
  b:=gen_random_uuid();
  insert into public.telegram_auth_bindings(id,auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
   values(b,case when k='staff'then f.doctor else f.member end,k,'["telegram","nurse_tasks_test",9911,"user",774001]',
    '["nurse_tasks_test",9911]','+999000774099','774001',2);
  i:=pg_temp.nt_event('text','{"text":"Synthetic new principal owner"}');
  perform pg_temp.nt_ok((select not nurse_at_commit and nurse_binding_id is null from public.channel_inbox where id=i),'new member/doctor event does not inherit historical nurse capture');
  perform pg_temp.nt_ok(public.telegram_nurse_receive(i,true)='{"handled":false}'::jsonb,'new member/doctor keeps original route');
  perform public._channel_inbox_finish(i,'done','synthetic_capture_checked');
  delete from public.telegram_auth_bindings where id=b;
  update public.telegram_auth_bindings set active=true,revoked_at=null where id=f.binding;
 end loop;
end$$;

-- An unknown note prompt followed by reassignment is retired on the FIRST resume,
-- yielding only a generic refusal; inaccessible old details cannot trap the queue.
do $$declare f record;i uuid;e jsonb;unknown_id uuid;begin
 select * into f from nt_fixture;perform pg_temp.nt_reset_task();perform pg_temp.nt_select(f.task);
 e:=pg_temp.nt_send('task-note','unknown');unknown_id:=(e->>'outboxId')::uuid;
 update public.patient_clinical_cases set assigned_nurse_id=f.other where user_id=f.member;
 i:=pg_temp.nt_event('text','{"text":"/resume"}');
 perform pg_temp.nt_ok(pg_temp.nt_process(i)->>'status'='refused','inaccessible unknown prompt refuses first recovery');
 perform pg_temp.nt_ok((select abandoned from public.telegram_nurse_outbox where id=unknown_id),'inaccessible unknown prompt chain retired');
 perform pg_temp.nt_ok(exists(select 1 from public.telegram_nurse_outbox where source_inbox=i and turn='{"kind":"refused"}'::jsonb and cardinality(member_ids)=0),'only generic refusal queued after lost task access');
 perform pg_temp.nt_send();
 perform pg_temp.nt_ok((select expected_mode='none'and pending_inbox is null from public.telegram_nurse_dialogs where binding_id=f.binding),'first recovery releases inaccessible dialog');
 update public.patient_clinical_cases set assigned_nurse_id=f.nurse where user_id=f.member;
end$$;

-- NT-03: the existing flag-independent cleanup retires expired snapshots
-- and controls, but an unknown command/send retains its exact recovery identity.
do $$declare f record;i uuid;note_ uuid;cmd jsonb;o uuid;begin
 select * into f from nt_fixture;perform pg_temp.nt_reset_task();perform pg_temp.nt_select(f.task);perform pg_temp.nt_send();
 note_:=pg_temp.nt_event('text',jsonb_build_object('text','Synthetic note retained for unknown result','replyToMessageId',pg_temp.nt_prompt()));
 perform pg_temp.nt_process(note_);select nurse_context->'command'into cmd from public.channel_inbox where id=note_;
 o:=(pg_temp.nt_send('task-saved','unknown')->>'outboxId')::uuid;
 update public.telegram_nurse_outbox set created_at=clock_timestamp()-interval '2 days';
 update public.telegram_nurse_intents set expires_at=clock_timestamp()-interval '1 second';
 update public.channel_inbox set processed_at=clock_timestamp()-interval '2 days'where id=note_;
 update public.telegram_nurse_settings set enabled=false;perform public.auth_cleanup_run();
 perform pg_temp.nt_ok(not exists(select 1 from public.telegram_nurse_intents where expires_at<=clock_timestamp()),'NT-03: expired intents removed even with gates off');
 perform pg_temp.nt_ok(not exists(select 1 from public.telegram_nurse_outbox where created_at<clock_timestamp()-interval '30 minutes' and turn-array['kind']<>'{}'),'NT-03: expired transport snapshots scrubbed');
 perform pg_temp.nt_ok((select state='unknown'and attempt_id is not null from public.telegram_nurse_outbox where id=o),'NT-03: unknown attempt never reset or resent');
 perform pg_temp.nt_ok((select nurse_context->'command'=cmd from public.channel_inbox where id=note_),'NT-03: uncertain send keeps exact receipt command');
 update public.telegram_nurse_settings set enabled=true;
 i:=pg_temp.nt_event('text','{"text":"/resume"}');perform pg_temp.nt_ok(pg_temp.nt_process(i)->>'status'='queued','NT-03: aged uncertain result recovers');perform pg_temp.nt_send();
 perform pg_temp.nt_ok((select count(*)=1 from public.patient_coordination_events where request_id=(cmd->>'requestId')::uuid),'NT-03: recovery has exactly one business effect');
 perform public.auth_cleanup_run();
 perform pg_temp.nt_ok((select nurse_context is null from public.channel_inbox where id=note_),'NT-03: resolved old command expires');
end$$;

-- Least privilege: no actor-taking private body is exposed, no direct nurse table
-- access, no authenticated/anon service entry, and web grants remain unchanged.
do $$declare p record;t text;begin
 for p in select oid,proname from pg_proc where pronamespace='public'::regnamespace and(proname like 'telegram_nurse_%'or proname like '\_telegram\_nurse\_%'escape '\')loop
  perform pg_temp.nt_ok(not has_function_privilege('anon',p.oid,'execute')and not has_function_privilege('authenticated',p.oid,'execute'),'nurse RPC not callable by API members');
  if left(p.proname,1)='_'then perform pg_temp.nt_ok(not has_function_privilege('service_role',p.oid,'execute'),'private authority/body not exposed');
  else perform pg_temp.nt_ok(has_function_privilege('service_role',p.oid,'execute'),'service RPC explicitly granted');end if;
 end loop;
 foreach t in array array['telegram_nurse_settings','telegram_nurse_dialogs','telegram_nurse_outbox','telegram_nurse_intents']loop
  perform pg_temp.nt_ok((select relrowsecurity from pg_class where oid=('public.'||t)::regclass),'RLS enabled');
  perform pg_temp.nt_ok(not has_table_privilege('service_role','public.'||t,'SELECT,INSERT,UPDATE,DELETE'),'no direct service table access');
 end loop;
 perform pg_temp.nt_ok(not has_sequence_privilege('service_role','public.telegram_nurse_outbox_sequence_seq','USAGE,SELECT,UPDATE'),'no direct sequence access');
 perform pg_temp.nt_ok(has_function_privilege('authenticated','public.patient_coordination_command(uuid,uuid,bigint,uuid,text,jsonb)','execute'),'web RPC keeps authenticated grant');
 perform pg_temp.nt_ok(not has_function_privilege('service_role','public.patient_coordination_command(uuid,uuid,bigint,uuid,text,jsonb)','execute'),'web RPC never granted to service');
end$$;
-- Cross-channel replay is keyed by actor + exact normalized command, never by
-- channel. The Telegram entry executes only its own already-persisted command.
create function pg_temp.nt_login(u uuid,s uuid)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',coalesce(u::text,''),true);
 perform set_config('request.jwt.claim.role',case when u is null then 'service_role'else 'authenticated'end,true);
 perform set_config('request.jwt.claims',case when u is null then '{"role":"service_role"}'else
  jsonb_build_object('sub',u,'role','authenticated','session_id',s,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text end,true);
end$$;
do $$declare f record;origin text;sid uuid:=gen_random_uuid();other_sid uuid:=gen_random_uuid();note_id uuid;cmd jsonb;web_result jsonb;telegram_result jsonb;bad boolean;begin
 select * into f from nt_fixture;
 insert into auth.sessions(id,user_id,created_at,updated_at)values(sid,f.nurse,now(),now()),(other_sid,f.other,now(),now());
 foreach origin in array array['web','telegram']loop
  perform pg_temp.nt_login(null,null);
  perform pg_temp.nt_reset_task();perform pg_temp.nt_select(f.task);perform pg_temp.nt_send();
  note_id:=pg_temp.nt_event('text',jsonb_build_object('text','Synthetic identical cross-channel note','replyToMessageId',pg_temp.nt_prompt()));
  perform public.telegram_nurse_receive(note_id,true);
  select nurse_context->'command'into cmd from public.channel_inbox where id=note_id;
  perform pg_temp.nt_ok(cmd->>'requestId'is not null,'cross-channel command persisted by real receive');
  if origin='telegram'then telegram_result:=public.telegram_nurse_apply(note_id,true,1);end if;
  perform pg_temp.nt_login(f.nurse,sid);
  set local role authenticated;
  web_result:=public.patient_coordination_command((cmd->>'caseId')::uuid,(cmd->>'taskId')::uuid,(cmd->>'revision')::bigint,
   (cmd->>'requestId')::uuid,'complete',cmd->'input');
  reset role;
  perform pg_temp.nt_login(null,null);
  if origin='web'then telegram_result:=public.telegram_nurse_apply(note_id,true,1);end if;
  perform pg_temp.nt_ok(web_result->>'status'='completed'and telegram_result->>'status'='saved',origin||' receipt replays through the other channel');
  perform pg_temp.nt_ok((select count(*)=1 from public.patient_coordination_events where request_id=(cmd->>'requestId')::uuid),origin||' replay has one event');
  perform pg_temp.nt_ok((select count(*)=1 and bool_and(channel=origin)from public.patient_coordination_receipts where request_id=(cmd->>'requestId')::uuid),origin||' replay retains original provenance');

  -- Changing the note with the same request is refused on both channel bodies.
  bad:=false;
  begin
   perform public._patient_coordination_command_as(f.nurse,f.binding,1,(cmd->>'caseId')::uuid,(cmd->>'taskId')::uuid,(cmd->>'revision')::bigint,
    (cmd->>'requestId')::uuid,'complete','{"note":"Synthetic changed payload"}');
  exception when serialization_failure then bad:=true;end;
  perform pg_temp.nt_ok(bad,'Telegram replay refuses a changed payload');
  perform pg_temp.nt_login(f.nurse,sid);bad:=false;
  begin
   set local role authenticated;
   perform public.patient_coordination_command((cmd->>'caseId')::uuid,(cmd->>'taskId')::uuid,(cmd->>'revision')::bigint,
    (cmd->>'requestId')::uuid,'complete','{"note":"Synthetic changed payload"}');
   reset role;
  exception when serialization_failure then bad:=true;end;
  perform pg_temp.nt_ok(bad,'web replay refuses a changed payload');

  -- Even an actor who now owns the case cannot inherit somebody else's receipt.
  update public.patient_clinical_cases set assigned_nurse_id=f.other where user_id=f.member;
  perform pg_temp.nt_login(f.other,other_sid);bad:=false;
  begin
   set local role authenticated;
   perform public.patient_coordination_command((cmd->>'caseId')::uuid,(cmd->>'taskId')::uuid,(cmd->>'revision')::bigint,
    (cmd->>'requestId')::uuid,'complete',cmd->'input');
   reset role;
  exception when serialization_failure or insufficient_privilege then bad:=true;end;
  perform pg_temp.nt_ok(bad,'changed actor cannot replay the exact receipt');
  update public.patient_clinical_cases set assigned_nurse_id=f.nurse where user_id=f.member;
  perform pg_temp.nt_login(null,null);bad:=false;
  begin
   perform public._patient_coordination_command_as(f.other,f.binding,1,(cmd->>'caseId')::uuid,(cmd->>'taskId')::uuid,(cmd->>'revision')::bigint,
    (cmd->>'requestId')::uuid,'complete',cmd->'input');
  exception when insufficient_privilege then bad:=true;end;
  perform pg_temp.nt_ok(bad,'Telegram actor must still be derived from the captured binding');

  update public.telegram_auth_bindings set active=false,revoked_at=now()where id=f.binding;
  perform pg_temp.nt_ok(public.telegram_nurse_resume(note_id,true,1)->>'status'='refused','revoked binding refuses cross-channel receipt replay');
  update public.telegram_auth_bindings set active=true,revoked_at=null where id=f.binding;
 end loop;
 delete from auth.sessions where id=sid;
 perform pg_temp.nt_login(f.nurse,sid);bad:=false;
 begin
  set local role authenticated;
  perform public.patient_coordination_command((cmd->>'caseId')::uuid,(cmd->>'taskId')::uuid,(cmd->>'revision')::bigint,
   (cmd->>'requestId')::uuid,'complete',cmd->'input');
  reset role;
 exception when insufficient_privilege then bad:=true;end;
 perform pg_temp.nt_ok(bad,'revoked web session refuses a Telegram receipt replay');
 perform pg_temp.nt_login(null,null);
end$$;

rollback;
