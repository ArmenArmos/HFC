-- Conversation decision journal: every T1 step writes one append-only trace event, rolled back.
-- Synthetic fixtures only; no Telegram, network or provider.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_staff(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_member(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_trace",9005,"user",%s]',u)$$;
create function pg_temp.event(id text,kind text,u bigint,payload jsonb)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_trace",9005,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind',kind,'payload',payload||jsonb_build_object('chatId',u,'messageId',id::bigint))
$$;
create function pg_temp.drain()returns void language plpgsql as $$declare i jsonb;begin
 for i in select jsonb_array_elements(public.channel_inbox_next(50))loop perform public.channel_inbox_process((i#>>'{}')::uuid);end loop;end$$;
create function pg_temp.link(m uuid,u bigint)returns jsonb language plpgsql as $$declare b jsonb;begin
 b:=public._telegram_auth_bind(m,'member',pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(m),u::text,null);
 return public._telegram_replies_activate(m,(b->>'bindingId')::uuid);end$$;
create function pg_temp.has(m uuid,n text,o text,r text default null)returns boolean language sql as $$
 select exists(select 1 from public.conversation_trace_events where member_id is not distinct from m and name=n and outcome=o and(r is null or reason_code=r))$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;

-- Member, doctor, admin.
insert into auth.users(id,phone,phone_confirmed_at)values('d1500000-0000-4000-8000-000000000001','37499015001',now()),('d1500000-0000-4000-8000-000000000002',null,null),('d1500000-0000-4000-8000-000000000003',null,null);
insert into public.workspace_clinics(id,name)values('d1500000-0000-4000-8000-000000000004','Synthetic trace clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d1500000-0000-4000-8000-000000000002','doctor','Dr Trace Synthetic','d1500000-0000-4000-8000-000000000004');
insert into public.workspace_staff(user_id,role,display_name)values('d1500000-0000-4000-8000-000000000003','admin','Admin Trace Synthetic');
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1500000-0000-4000-8000-000000000005','d1500000-0000-4000-8000-000000000001',now(),now()),
 ('d1500000-0000-4000-8000-000000000006','d1500000-0000-4000-8000-000000000002',now(),now()),('d1500000-0000-4000-8000-000000000007','d1500000-0000-4000-8000-000000000003',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000002');
update public.profiles set locale='en',display_name='Trace Member'where id='d1500000-0000-4000-8000-000000000001';
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_trace',9005,600,'consent-t');
-- One message per window, so the second and third messages exercise the intake guard.
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-trace',3600,600,60,1,false,true);
insert into public.system_message_templates(template_id,version,locale,body,approved,approval_note)values('telegram.ack',2,'en','Synthetic acknowledgement. Call 103.',true,'test fixture');

-- Linking writes a link event.
select pg_temp.link('d1500000-0000-4000-8000-000000000001',8501);
select pg_temp.ok(pg_temp.has('d1500000-0000-4000-8000-000000000001','link.active','allow','linked'),'Link is traced');

-- Inbound text: intake, stored message, doctor alert, acknowledgement and its reason.
select pg_temp.as_service();set local role service_role;
select public.channel_inbox_commit(pg_temp.event('300','text',8501,'{"text":"Synthetic secret words"}'));
select pg_temp.drain();
reset role;
select pg_temp.ok(pg_temp.has('d1500000-0000-4000-8000-000000000001','intake.committed','recorded'),'Inbound event committed is traced');
select pg_temp.ok(pg_temp.has('d1500000-0000-4000-8000-000000000001','message.stored','recorded','telegram_member'),'Stored message is traced');
select pg_temp.ok(pg_temp.has('d1500000-0000-4000-8000-000000000001','doctor_alert.created','escalate','alert_recorded_for_assigned_doctor'),'Doctor alert is traced');
select pg_temp.ok(pg_temp.has('d1500000-0000-4000-8000-000000000001','intake.processed','allow','received'),'Intake guard allow is traced');
select pg_temp.ok((select rule_id='telegram.ack'and rule_version='2'from public.conversation_trace_events where name='auto_ack.decided'and outcome='queued'and reason_code='member_message_received'),'Acknowledgement decision names template and version');
select pg_temp.ok((select conversation_id=(select id from public.conversations where member_id='d1500000-0000-4000-8000-000000000001')from public.conversation_trace_events where name='message.stored'),'Events carry the conversation id');

-- The doctor composes and approves; the reply is claimed and the provider accepts it.
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000006');set local role authenticated;
insert into kv values('ws',public.conversation_workspace('d1500000-0000-4000-8000-000000000001'));
select public.conversation_compose('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000030',(v->>'version')::bigint,(v->>'clinicalRevision')::bigint,(v->>'draftEpoch')::bigint,v->>'sourceToken','Synthetic doctor reply','Private summary words')from kv where k='ws';
insert into kv values('actions',public.conversation_actions('d1500000-0000-4000-8000-000000000001'));
insert into kv select 'approved',public.conversation_command(jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from jsonb_array_elements(v#>'{view,actions}')x where x->>'purpose'='reply.approve'),'requestId','d1500000000040008000000000000031'))from kv where k='actions';
reset role;
select pg_temp.ok(pg_temp.has('d1500000-0000-4000-8000-000000000001','draft.created','recorded'),'Draft creation is traced');
select pg_temp.ok((select actor_kind='doctor'and actor_id='d1500000-0000-4000-8000-000000000002'and reason_code='staff_draft'from public.conversation_trace_events where name='draft.revision_written'limit 1),'Draft author is the doctor');
select pg_temp.ok((select actor_kind='doctor'and rule_id='conversation.exact_approval'from public.conversation_trace_events where name='approval.recorded'),'Approval names the doctor and rule');
select pg_temp.ok(pg_temp.has('d1500000-0000-4000-8000-000000000001','delivery.queued','queued'),'Queued delivery is traced');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.conversation_claim((v->>'deliveryId')::uuid,'d1500000-0000-4000-8000-000000000040')->>'ok'='true','Delivery claimed')from kv where k='approved';
select public.delivery_observe('conversation','d1500000-0000-4000-8000-000000000040','{"kind":"accepted","providerRef":"[\"telegram\",\"noreon_trace\",9005,8501,77]"}');
select public.conversation_outcome('d1500000-0000-4000-8000-000000000040','{"kind":"accepted","providerRef":"[\"telegram\",\"noreon_trace\",9005,8501,77]"}');
reset role;
select pg_temp.ok(pg_temp.has('d1500000-0000-4000-8000-000000000001','send.attempt','sending'),'Send attempt is traced');
select pg_temp.ok((select attributes->>'messaging.message.id'='77'and attributes::text not like '%8501%'and actor_kind='provider'from public.conversation_trace_events where name='provider.receipt'and attributes->>'noreon.delivery.channel'='conversation'),'Provider receipt keeps the message id, never the chat id');
select pg_temp.ok(pg_temp.has('d1500000-0000-4000-8000-000000000001','delivery.accepted_by_provider','sent'),'Projected delivery state is traced');

-- Two more messages in the window: the first is over the limit (alert and ack once), the second only blocked.
select pg_temp.as_service();set local role service_role;
select public.channel_inbox_commit(pg_temp.event('301','text',8501,'{"text":"Synthetic secret two"}'));
select pg_temp.drain();
select public.channel_inbox_commit(pg_temp.event('302','text',8501,'{"text":"Synthetic secret three"}'));
select pg_temp.drain();
-- And one from an account that is not linked.
select public.channel_inbox_commit(pg_temp.event('303','text',8599,'{"text":"Synthetic stranger"}'));
select pg_temp.drain();
reset role;
select pg_temp.ok((select count(*)=2 and bool_and(rule_id='conversation_policy.intake_max_messages'and rule_version='synthetic-trace'and attributes->>'noreon.policy.intake_max_messages'='1')
 from public.conversation_trace_events where name='intake.processed'and outcome='block'and reason_code='member_over_intake_limit'),'Over-limit messages are blocked with rule and version');
select pg_temp.ok(pg_temp.has('d1500000-0000-4000-8000-000000000001','auto_ack.decided','queued','first_over_limit_message_this_window'),'First over-limit message is acknowledged, with its reason');
select pg_temp.ok(pg_temp.has('d1500000-0000-4000-8000-000000000001','auto_ack.decided','skipped','already_acknowledged_this_window'),'Second over-limit message is not acknowledged, with its reason');
select pg_temp.ok(pg_temp.has(null,'intake.processed','block','principal_not_linked'),'Unlinked sender is blocked with no member');

-- The acknowledgement is claimed and fails at the provider.
insert into kv select 'ack',to_jsonb(id)from public.system_messages where member_id='d1500000-0000-4000-8000-000000000001'and template_id='telegram.ack'order by created_at limit 1;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.system_message_claim((v#>>'{}')::uuid,'d1500000-0000-4000-8000-000000000050')->>'ok'='true','Acknowledgement claimed')from kv where k='ack';
select public.system_message_outcome('d1500000-0000-4000-8000-000000000050','{"kind":"definitely_failed","evidence":"not_sent_chat_blocked"}');
reset role;
select pg_temp.ok(pg_temp.has('d1500000-0000-4000-8000-000000000001','system_message.sending','sending'),'Acknowledgement send attempt is traced');
select pg_temp.ok(pg_temp.has('d1500000-0000-4000-8000-000000000001','system_message.definitely_failed','failed'),'Acknowledgement failure is traced');

-- Unlinking is traced.
select pg_temp.as_member('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000005');set local role authenticated;
select public.telegram_unlink();
reset role;
select pg_temp.ok(pg_temp.has('d1500000-0000-4000-8000-000000000001','link.inactive','block','unlinked_or_revoked'),'Unlink is traced');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='link.unlinked'and actor_kind='member'),'Unlink request names the member as actor');
select public._telegram_revoke_binding((select id from public.telegram_auth_bindings where auth_user_id='d1500000-0000-4000-8000-000000000001'order by created_at desc limit 1),'phone_moved');
select pg_temp.ok(pg_temp.has('d1500000-0000-4000-8000-000000000001','binding.created','allow')and pg_temp.has('d1500000-0000-4000-8000-000000000001','binding.revoked','block','phone_moved'),'T-auth binding events carry the revocation reason');

-- F2: odd audit kinds and empty ids still record, and nothing can fail the host transaction.
insert into public.telegram_audit(member_id,kind,detail)values('d1500000-0000-4000-8000-000000000001','link.Re-Issued','{}');
select pg_temp.ok(pg_temp.has('d1500000-0000-4000-8000-000000000001','link.re_issued','recorded'),'An unexpected audit kind is normalised, and the audit insert succeeds');
insert into public.telegram_auth_audit(auth_user_id,kind,detail)values('d1500000-0000-4000-8000-000000000001','binding.revoked','{"bindingId":"","reason":"Phone Moved!"}');
select pg_temp.ok((select subject_id is null and reason_code='phone_moved'from public.conversation_trace_events where name='binding.revoked'order by id desc limit 1),'An empty binding id is recorded as none');
select pg_temp.ok(public._conversation_trace(null,null,'x',null,'not_a_step','intake.z','recorded',null,null,null,'system',null,'{}')=false,'An invalid event is dropped, not raised');
select pg_temp.ok(not exists(select 1 from public.conversation_trace_events where name='intake.z'),'The dropped event wrote nothing');
-- Nothing caller-supplied can make the writer raise (a raise would dead-letter member messages).
select public._conversation_trace(null,null,'x',null,'intake','intake.x','recorded','Adapter unavailable before invocation','Weird Rule!',repeat('v',300),'system',null,'{}');
select pg_temp.ok((select reason_code='adapter_unavailable_before_invocation'and rule_id='weird_rule'and length(rule_version)=80 from public.conversation_trace_events where name='intake.x'),'Free-form codes are slugged and versions truncated');
select public._conversation_trace(null,null,'x',null,'intake','intake.y','recorded','',null,'  ','system',null,null);
select pg_temp.ok((select reason_code='other'and rule_version is null from public.conversation_trace_events where name='intake.y'),'Empty codes and versions never raise');
-- Only hash-free, length-free metadata: nothing an admin could use to test guesses of the text.
select pg_temp.ok(not exists(select 1 from public.conversation_trace_events where attributes ?| array['noreon.content.hash','noreon.message.utf16_length']),'No content hash or text length');
-- No message, draft or summary text is ever journaled.
select pg_temp.ok(not exists(select 1 from public.conversation_trace_events where attributes::text ~* 'secret|Synthetic doctor reply|Private summary|stranger'),'No free text in trace events');
select pg_temp.ok((select bool_and(attributes ?& array[]::text[])from public.conversation_trace_events),'Attributes are objects');

-- Append-only: no update, delete or truncate, even for the owner.
do $$begin update public.conversation_trace_events set outcome='allow';raise exception 'FAIL: update allowed';exception when sqlstate '55000' then null;end$$;
do $$begin delete from public.conversation_trace_events;raise exception 'FAIL: delete allowed';exception when sqlstate '55000' then null;end$$;
do $$begin insert into public.conversation_trace_events(subject_kind,step,name,outcome,actor_kind,attributes)values('x','intake','intake.x','allow','system','{"body":"x"}');raise exception 'FAIL: text attribute allowed';exception when check_violation then null;end$$;

-- Access: no direct table or writer access; only active admins may read.
select pg_temp.ok(not has_table_privilege('authenticated','public.conversation_trace_events','select')and not has_table_privilege('service_role','public.conversation_trace_events','insert'),'No direct table access');
select pg_temp.ok(not has_function_privilege('authenticated','public._conversation_trace(uuid,uuid,text,text,text,text,text,text,text,text,text,uuid,jsonb)','execute')and not has_function_privilege('service_role','public._conversation_trace(uuid,uuid,text,text,text,text,text,text,text,text,text,uuid,jsonb)','execute'),'Writer is internal only');
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000006');set local role authenticated;
do $$begin perform public.conversation_trace('d1500000-0000-4000-8000-000000000001');raise exception 'FAIL: doctor read trace';exception when insufficient_privilege then null;end$$;
do $$begin perform public.conversation_trace_members();raise exception 'FAIL: doctor listed traces';exception when insufficient_privilege then null;end$$;
reset role;
select pg_temp.as_member('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000005');set local role authenticated;
do $$begin perform public.conversation_trace('d1500000-0000-4000-8000-000000000001');raise exception 'FAIL: member read trace';exception when insufficient_privilege then null;end$$;
reset role;
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000003','d1500000-0000-4000-8000-000000000007');set local role authenticated;
insert into kv values('trace',public.conversation_trace('d1500000-0000-4000-8000-000000000001'));
insert into kv values('members',public.conversation_trace_members());
reset role;
select pg_temp.ok((select v->>'memberName'='Trace Member'and jsonb_array_length(v->'events')>=20 and v->>'conversationId'is not null from kv where k='trace'),'Admin reads the timeline');
select pg_temp.ok((select bool_and((e->>'id')::bigint>coalesce(lag,0))from(select e,lag((e->>'id')::bigint)over(order by ord)lag from kv,jsonb_array_elements(v->'events')with ordinality x(e,ord)where k='trace')s),'Timeline is in order');
select pg_temp.ok((select e->>'actorName'from kv,jsonb_array_elements(v->'events')e where k='trace'and e->>'name'='approval.recorded')='Dr Trace Synthetic','Timeline names the approving doctor');
select pg_temp.ok((select v#>>'{members,0,memberName}'='Trace Member'and(v#>>'{members,0,blocked}')::int>=3 from kv where k='members'),'Admin lists traced conversations with problem counts');
-- PostgREST runs stable functions read-only, where the admin check's FOR SHARE fails.
select pg_temp.ok((select bool_and(provolatile='v')from pg_proc where proname in('conversation_trace','conversation_trace_members')),'Admin reads are volatile');
\echo PASS conversation trace: T1 intake, guards, ack reasons, doctor draft/approval, send, provider receipt, link/unlink; no text, append-only, admin-only (rolled back)
rollback;
