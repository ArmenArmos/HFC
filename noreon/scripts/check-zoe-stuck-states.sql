-- Fictional, rolled-back regressions for topic uncertainty and explicit doctor closure.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.u(n int)returns uuid language sql immutable as $$select('e1d90000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.sid(n int)returns uuid language sql immutable as $$select('e1d90000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.as_user(n int,amr text default 'password')returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method',amr)),'session_id',pg_temp.sid(n))::text,true)$$;
create function pg_temp.as_service()returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.send(member int,txt text,to_doctor boolean default false)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(member,'otp');set local role authenticated;j:=public.conversation_receive(jsonb_build_object('requestId',gen_random_uuid(),'text',txt),to_doctor);reset role;
 if j->>'ok'<>'true'then raise exception 'FAIL: message not received: %',j;end if;return j;end$$;
create function pg_temp.claim(member int,p_tier text default 'high')returns uuid language plpgsql as $$declare j jsonb;run uuid;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_claim(10);reset role;
 select(x->>'runId')::uuid into run from jsonb_array_elements(j)x where(x->>'memberId')::uuid=pg_temp.u(member);
 if run is null then raise exception 'FAIL: no run claimed: %',j;end if;
 update public.zoe_runs set reserved=p_tier<>'none',tier=nullif(p_tier,'none')where id=run;return run;end$$;
create function pg_temp.next(member int,txt text,p_tier text default 'high')returns uuid language sql as $$select pg_temp.send(member,txt);select pg_temp.claim(member,p_tier)$$;
create function pg_temp.finish(run uuid,arg jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_finish(run,arg);reset role;return j;end$$;
create function pg_temp.res(outcome text,reason text,answer text,extra jsonb default '{}',lang text default 'en')returns jsonb language sql as $$
 select jsonb_strip_nulls(jsonb_build_object('outcome',outcome,'reason',reason,'summary','Synthetic summary for the doctor.','answer',answer,'language',case when answer is null then null else lang end,
  'guardReasons','[]'::jsonb,'redactionCount',0,'usage',jsonb_build_object('inputTokens',900,'outputTokens',300),'costUsd',0.01,'latencyMs',900,
  'provider','vercel.ai_gateway','model','anthropic/claude-opus-5.5','configVersion','doctor-takeover-check','sealed',null,'tier','high','tierReason','rule_result_reading','fallbackUsed',false,
  'events','[]'::jsonb))||extra
$$;
create function pg_temp.h(urgency text,fwd text default 'none',reason text default 'none')returns jsonb language sql as $$
 select jsonb_build_object('urgency',urgency,'modelUrgency',urgency,'forward',fwd,'forwardReason',reason)$$;
-- A pending draft for member n (as Zoe proposes it), then doctor d approves it through conversation_actions and conversation_command.
create function pg_temp.reply(member int,d int,txt text default 'Synthetic question for the doctor')returns jsonb language plpgsql as $$declare run uuid;a jsonb;c jsonb;j jsonb;begin
 run:=pg_temp.next(member,txt,'medium');
 j:=pg_temp.finish(run,pg_temp.res('draft_proposed','draft_passed_guards',null,jsonb_build_object('draft','Synthetic doctor reply.','tier','medium')));
 if j->>'outcome'<>'draft_proposed'then raise exception 'FAIL: no draft proposed: %',j;end if;
 perform pg_temp.as_user(d);set local role authenticated;a:=public.conversation_actions(pg_temp.u(member));reset role;
 c:=jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from jsonb_array_elements(a#>'{view,actions}')x where x->>'purpose'='reply.approve'),
  'requestId',replace(gen_random_uuid()::text,'-',''));
 perform pg_temp.as_user(d);set local role authenticated;j:=public.conversation_command(c);reset role;
 if j->>'ok'<>'true'then raise exception 'FAIL: approval refused: %',j;end if;return j;end$$;
create function pg_temp.conv(member int)returns uuid language sql as $$select id from public.conversations where member_id=pg_temp.u(member)$$;
create function pg_temp.mode(member int)returns public.zoe_doctor_mode language sql as $$select * from public.zoe_doctor_mode where conversation_id=pg_temp.conv(member)$$;
create function pg_temp.notices(member int,kind text)returns bigint language sql as $$select count(*)from public.zoe_mode_notices where member_id=pg_temp.u(member)and zoe_mode_notices.kind=notices.kind$$;
grant execute on all functions in schema pg_temp to authenticated,anon,service_role;

-- People: members 01, 03 (doctor 11, nurse 13), 02 (doctor 12); doctors 11, 12; nurse 13; admin 14. Member 03 has no Zoe consent.
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.u(n),case when n<10 then '374990370'||lpad(n::text,2,'0')end,case when n<10 then now()end
 from unnest(array[1,2,3,11,12,13,14])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.sid(n),pg_temp.u(n),now()-interval '1 hour',now()from unnest(array[1,2,3,11,12,13,14])n;
insert into public.workspace_clinics(id,name)values(pg_temp.u(20),'Synthetic takeover clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.u(11),'doctor','Dr Takeover One',pg_temp.u(20)),(pg_temp.u(12),'doctor','Dr Takeover Two',pg_temp.u(20)),(pg_temp.u(13),'nurse','Nurse Takeover',pg_temp.u(20));
insert into public.workspace_staff(user_id,role,display_name)values(pg_temp.u(14),'admin','Admin Takeover');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.u(1),pg_temp.u(11),pg_temp.u(13)),(pg_temp.u(2),pg_temp.u(12),null),(pg_temp.u(3),pg_temp.u(11),pg_temp.u(13));
update public.profiles set locale='en',display_name='Zara Synthetic'where id in(pg_temp.u(1),pg_temp.u(2),pg_temp.u(3));
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'synthetic-takeover',3600,600,60,80,false,true,true)on conflict(singleton)do update set version=excluded.version,intake_max_messages=80,app_chat_enabled=true,delivery_enabled=true,grant_seconds=3600,intent_seconds=600;
-- Member 01 also has Telegram (the route a doctor's reply takes).
insert into public.conversation_endpoints(member_id,adapter,account_ref,principal_ref,address,generation,active,policy_version,expires_at,max_utf16)
 values(pg_temp.u(1),'telegram','synthetic-bot','synthetic-takeover-1','9100001',1,true,'synthetic-takeover',now()+interval '1 day',4096);
insert into public.zoe_consents(member_id,kind,granted,wording_version)select pg_temp.u(n),'zoe_reads_messages',true,'zoe-consent-draft-1'from unnest(array[1,2])n;
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version='zoe-consent-draft-1',staging_ai_mode=true;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33',510,0,0,pg_temp.u(14)from public.zoe_tier_config;
update public.zoe_settings set model_calls_allowed=true;
update public.zoe_settings set conversational_replies_enabled=true;
update public.zoe_settings set health_answers_enabled=true;
update public.zoe_settings set doctor_takeover_scope='conversation';
update public.system_message_templates set approved=true,approval_note='Staging check'where template_id in('zoe.answer','zoe.chat','zoe.receipt','zoe.urgent');
select pg_temp.ok((select bool_and(not approved and free_body)and count(*)=2 from public.system_message_templates where template_id='zoe.mode'),'zoe.mode ships unapproved (staging approves it)');
update public.system_message_templates set approved=true,approval_note='Staging check'where template_id='zoe.mode';
insert into public.care_alert_settings(enabled)values(true)on conflict do nothing;
update public.care_alert_settings set enabled=true;

-- Explicit routing must be enforced at publication even before the first doctor reply.
do $$declare run uuid;begin
 perform pg_temp.send(2,'Synthetic question addressed to your doctor',true);
 run:=pg_temp.claim(2);
 perform pg_temp.ok(not public._zoe_doctor_mode(pg_temp.conv(2)),'explicit-route fixture has no persistent takeover');
 perform pg_temp.finish(run,pg_temp.res('answered','health_answer_passed_guards','Synthetic forged ordinary answer.',
  jsonb_build_object('health',pg_temp.h('planned'),'topic',jsonb_build_object('owner','zoe','startSeq',1,'doctorTopic','no'))));
 perform pg_temp.ok(not exists(select 1 from public.zoe_member_answers where run_id=run),'explicit doctor route rejects a forged Zoe owner without takeover');
end$$;

-- The existing assigned-doctor reply establishes takeover; replying alone is not a close.
select pg_temp.reply(1,11);
select pg_temp.ok((pg_temp.mode(1)).doctor_mode,'a plain doctor reply keeps doctor mode');
update public.zoe_settings set doctor_takeover_scope='topic';
create function pg_temp.topic(verdict text)returns jsonb language sql as $$
 select jsonb_build_object('topic',jsonb_build_object('owner','zoe','startSeq',1,'doctorTopic',verdict))
$$;
create function pg_temp.answer(verdict text,to_doctor boolean default false)returns uuid language plpgsql as $$
declare run uuid;
begin
 perform pg_temp.send(1,'Synthetic new health question',to_doctor);
 run:=pg_temp.claim(1);
 perform pg_temp.finish(run,pg_temp.res('answered','health_answer_passed_guards','Synthetic health answer.',
  jsonb_build_object('health',pg_temp.h('planned')))||pg_temp.topic(verdict));
 return run;
end$$;
grant execute on function pg_temp.topic(text),pg_temp.answer(text,boolean) to authenticated,service_role;
create temp table topic_runs(verdict text,run uuid);
insert into topic_runs values('unsure',pg_temp.answer('unsure')),('null',pg_temp.answer(null)),('yes',pg_temp.answer('yes')),
 ('explicit_doctor',pg_temp.answer('unsure',true));
select pg_temp.ok(exists(select 1 from public.zoe_member_answers where run_id=run and kind='answer'),
 'uncertain topic may answer: '||verdict)from topic_runs where verdict in('unsure','null');
select pg_temp.ok(not exists(select 1 from public.zoe_member_answers where run_id=run and kind='answer'),
 'doctor matter remains held: '||verdict)from topic_runs where verdict in('yes','explicit_doctor');
update public.zoe_settings set doctor_takeover_scope='conversation';
insert into topic_runs values('conversation_scope',pg_temp.answer('unsure'));
select pg_temp.ok(not exists(select 1 from public.zoe_member_answers where run_id=run and kind='answer'),
 'conversation scope remains held')from topic_runs where verdict='conversation_scope';
select pg_temp.ok((pg_temp.mode(1)).doctor_mode,'topic answers do not end takeover');

-- Persisted alarm state must survive a claim's bounded ten-answer history.
-- Use a separate conversation so the closure checks below retain their original mode.
select pg_temp.reply(2,12);
do $$declare c uuid:=pg_temp.conv(2);run uuid;anchor timestamptz;refused uuid;context_run uuid;payload jsonb;begin
 -- A new full alarm comes after the doctor's baseline reply.
 insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
 values(c,pg_temp.u(2),100,0,0,current_date,'finished','discarded','urgent_route_no_model_call',clock_timestamp())returning id into run;
 insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind)
 values(c,pg_temp.u(2),run,100,'Synthetic urgent text.','en','noreon.rules','synthetic','urgent')returning created_at into anchor;
 insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,forward,forward_reason,finished_at)
 values(c,pg_temp.u(2),101,0,0,current_date,'finished','answered','health_answer_passed_guards','auto','refused_103',clock_timestamp())returning id into refused;
 insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind)
 values(c,pg_temp.u(2),refused,101,'Synthetic refusal acknowledgement.','en','noreon.rules','synthetic','answer');
 perform public._zoe_run_events(r,'[{"name":"zoe.urgent.conversation","outcome":"recorded","reason":"alarm_conversation_continues","rule":"zoe.alarm_conversation","ruleVersion":"check","actor":"system","attributes":{}}]')
  from public.zoe_runs r where r.id=refused;
 -- Twelve later continuations push the refusal beyond the visible answer tail.
 for n in 102..113 loop
  insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
  values(c,pg_temp.u(2),n,0,0,current_date,'finished','answered','health_answer_passed_guards',clock_timestamp())returning id into run;
  insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind)
  values(c,pg_temp.u(2),run,n,'Synthetic alarm continuation.','en','noreon.rules','synthetic','answer');
  perform public._zoe_run_events(r,'[{"name":"zoe.urgent.conversation","outcome":"recorded","reason":"alarm_conversation_continues","rule":"zoe.alarm_conversation","ruleVersion":"check","actor":"system","attributes":{}}]')
   from public.zoe_runs r where r.id=run;
 end loop;
 insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state)
 values(c,pg_temp.u(2),114,0,0,current_date,'started')returning id into context_run;
 perform pg_temp.as_service();
 payload:=public.zoe_run_alarm_window(array[context_run])->0;
 perform pg_temp.ok(payload#>>'{memberClear,refused103}'='true','refusal remains latched beyond twelve later answers');
 perform pg_temp.ok((payload#>>'{memberClear,startedAt}')::timestamptz=anchor,'continuations retain original alarm anchor');
 perform pg_temp.ok(not(public.zoe_run_urgent_window(array[context_run])->0->'memberClear'?'refused103'),'legacy window shape stays unchanged');
 -- A new full danger-sign text is a new alert for refusal, even within the original two-hour anchor.
 insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
 values(c,pg_temp.u(2),115,0,0,current_date,'finished','discarded','urgent_route_no_model_call',clock_timestamp())returning id into run;
 insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind)
 values(c,pg_temp.u(2),run,115,'Synthetic new danger sign.','en','noreon.rules','synthetic','urgent');
 perform pg_temp.ok(public.zoe_run_alarm_window(array[context_run])->0#>>'{memberClear,refused103}'='false','new full alarm resets refusal latch');
 -- Mark only this synthetic context complete before exercising the next real reply.
 update public.zoe_runs set state='finished',outcome='no_output',reason_code='synthetic_context',finished_at=clock_timestamp()where id=context_run;
end$$;
-- Keep the next actual inbound sequence beyond the manually seeded history.
update public.conversations set version=200 where member_id=pg_temp.u(2);
select pg_temp.reply(2,12);
select pg_temp.ok((select started_at is null from public._zoe_talking_urgent_window(pg_temp.conv(2))),
 'a newer doctor reply closes the flagged alarm despite bounded history');
-- A newly observed full danger sign after the doctor still starts another window.
do $$declare run uuid;begin
 insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
 values(pg_temp.conv(2),pg_temp.u(2),116,0,0,current_date,'finished','discarded','urgent_route_no_model_call',clock_timestamp())returning id into run;
 insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind)
 values(pg_temp.conv(2),pg_temp.u(2),run,116,'Synthetic later danger sign.','en','noreon.rules','synthetic','urgent');
 perform pg_temp.ok((select started_at is not null from public._zoe_talking_urgent_window(pg_temp.conv(2))),
 'a new danger sign after the doctor starts a new flagged window');
end$$;

-- The actual finish/audit/window route preserves every bounded asserted symptom family.
savepoint symptom_roundtrip;
do $$declare opener uuid;followup uuid;payload jsonb;snapshot jsonb;begin
 opener:=pg_temp.next(2,'Synthetic multi-symptom alarm','none');
 payload:=pg_temp.res('discarded','urgent_route_no_model_call','Synthetic urgent text. Call 103.',
  jsonb_build_object('tier','none','tierReason','urgent','memberClearEnabled',true,
   'alarmTrigger',jsonb_build_object('rules','["RF-01"]'::jsonb,'messageHash',repeat('a',64),
    'symptom','chest_pain','symptoms','["chest_pain","breathlessness"]'::jsonb)));
 perform pg_temp.ok(pg_temp.finish(opener,payload)->>'ok'='true','multi-symptom alarm finishes');
 select detail->'trigger'into snapshot from public.conversation_audit
  where conversation_id=pg_temp.conv(2)and kind='zoe.alarm_trigger'and detail->>'runId'=opener::text;
 perform pg_temp.ok(snapshot->'symptoms'='["chest_pain","breathlessness"]'::jsonb,'finish persists all asserted families');
 followup:=pg_temp.next(2,'Synthetic alarm follow-up','none');
 perform pg_temp.as_service();
 perform pg_temp.ok(public.zoe_run_alarm_window(array[followup])#>'{0,memberClear,trigger,symptoms}'=snapshot->'symptoms',
  'alarm window returns all persisted symptom families');
 perform pg_temp.ok(pg_temp.finish(followup,payload#-'{alarmTrigger,symptoms}')->>'ok'='true','legacy alarm without array finishes');
 select detail->'trigger'into snapshot from public.conversation_audit where kind='zoe.alarm_trigger'and detail->>'runId'=followup::text;
 perform pg_temp.ok(snapshot is not null and not(snapshot?'symptoms'),'legacy trigger omits symptoms instead of writing null');
 followup:=pg_temp.next(2,'Synthetic malformed trigger check','none');
 perform pg_temp.ok(pg_temp.finish(followup,jsonb_set(payload,'{alarmTrigger,symptoms}','[1]'))->>'ok'='true','alarm with invalid optional family array finishes safely');
 select detail->'trigger'into snapshot from public.conversation_audit where kind='zoe.alarm_trigger'and detail->>'runId'=followup::text;
 perform pg_temp.ok(snapshot is not null and not(snapshot?'symptoms'),'invalid optional family array is omitted');
end$$;
rollback to symptom_roundtrip;

insert into public.care_alerts(id,member_id,source,reason_code,rule_id,rule_version,source_ref,doctor_id)
 values(pg_temp.u(40),pg_temp.u(1),'message','urgent_words_matched','check','check','stuck-state-check',pg_temp.u(11));
create function pg_temp.resolve_as(doctor int,seq bigint default 0)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(doctor);set local role authenticated;
 j:=public.care_alert_resolve(pg_temp.u(40),seq,'member_contacted','Synthetic reason');reset role;return j;
end$$;
create function pg_temp.audit_refused()returns boolean language plpgsql as $$begin
 perform pg_temp.resolve_as(11);return false;
exception when check_violation then reset role;return true;end$$;
grant execute on function pg_temp.resolve_as(int,bigint),pg_temp.audit_refused() to authenticated;

select pg_temp.ok(pg_temp.resolve_as(12)->>'code'='not_found','another doctor cannot close the alert');
select pg_temp.ok(pg_temp.resolve_as(11,9)->>'code'='changed','stale alert sequence cannot close');
select pg_temp.ok((pg_temp.mode(1)).doctor_mode and pg_temp.notices(1,'zoe_back')=0,'refused closes leave takeover and notices unchanged');

savepoint before_close;
select pg_temp.ok(pg_temp.resolve_as(14)->>'changed'='true','administrator retains existing alert resolution');
select pg_temp.ok((pg_temp.mode(1)).doctor_mode and pg_temp.notices(1,'zoe_back')=0,'administrator resolution does not hand back');
rollback to before_close;

-- The close and notice/audits are one transaction: a failed mode audit restores the alert too.
alter table public.conversation_audit add constraint stuck_state_audit_failure check(kind<>'zoe.doctor_mode_off')not valid;
select pg_temp.ok(pg_temp.audit_refused(),'mode audit failure refuses the whole close');
select pg_temp.ok((select state='open'from public.care_alerts where id=pg_temp.u(40))and(pg_temp.mode(1)).doctor_mode
 and pg_temp.notices(1,'zoe_back')=0,'failed close has no partial alert, mode, or notice');
alter table public.conversation_audit drop constraint stuck_state_audit_failure;

select pg_temp.ok(pg_temp.resolve_as(11)->>'changed'='true','assigned doctor resolves the alert');
select pg_temp.ok(not(pg_temp.mode(1)).doctor_mode and(pg_temp.mode(1)).reason='closed','resolution ends takeover with closed reason');
select pg_temp.ok(pg_temp.notices(1,'zoe_back')=1,'the existing Zoe-is-with-you notice is written once');
select pg_temp.ok(exists(select 1 from public.conversation_audit where conversation_id=pg_temp.conv(1)
 and kind='zoe.doctor_mode_off'and detail->>'reason'='closed'and detail->>'alertId'=pg_temp.u(40)::text),'close is audited against the alert');
select pg_temp.ok(pg_temp.resolve_as(11)->>'changed'='false'and pg_temp.notices(1,'zoe_back')=1,'repeated close emits no second notice');
insert into topic_runs values('after_close_1',pg_temp.answer(null)),('after_close_2',pg_temp.answer(null)),('after_close_3',pg_temp.answer(null));
select pg_temp.ok(exists(select 1 from public.zoe_member_answers where run_id=run and kind='answer'),
 'ordinary question is answered after close: '||verdict)from topic_runs where verdict like 'after_close_%';
-- A retry of the old close cannot undo a later takeover.
update public.zoe_doctor_mode set doctor_mode=true,reason='doctor_reply'where member_id=pg_temp.u(1);
select pg_temp.ok(pg_temp.resolve_as(11)->>'changed'='false'and(pg_temp.mode(1)).doctor_mode,'old close retry leaves a later takeover alone');
rollback to before_close;

-- Withdrawal still permits the explicit close, but does not promise Zoe is returning.
insert into public.zoe_consents(member_id,kind,granted,wording_version)values(pg_temp.u(1),'zoe_reads_messages',false,'zoe-consent-draft-1');
select pg_temp.ok(pg_temp.resolve_as(11)->>'changed'='true','close succeeds after Zoe consent withdrawal');
select pg_temp.ok(not(pg_temp.mode(1)).doctor_mode and(pg_temp.mode(1)).reason='closed'
 and pg_temp.notices(1,'zoe_back')=0,'withdrawn consent suppresses the return notice');
select pg_temp.ok(not has_function_privilege('authenticated','public._zoe_mode_notify(uuid,uuid,text,timestamptz)','execute'),
 'existing private notification helper stays private');
rollback;
\echo 'PASS Zoe stuck states: uncertain topics, doctor resolution, stale/role/replay guards, atomicity and consent'

