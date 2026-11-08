-- SYNTHETIC rollback-only SQL risk-path checks. Run after a clean local migration replay.
-- Never aimed at hosted data. Exercises real window/finish, audit and trace persistence.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
insert into auth.users(id)values('ec1e0000-0000-4000-8000-000000000001');
insert into public.patient_clinical_cases(user_id)values('ec1e0000-0000-4000-8000-000000000001');
insert into public.conversations(id,member_id)values('ec1e0000-0000-4000-8000-000000000002','ec1e0000-0000-4000-8000-000000000001');
insert into public.zoe_settings(singleton,consent_collection_enabled,consent_wording_version)
 values(true,true,'member-clear-test')on conflict(singleton)do update set consent_collection_enabled=true,consent_wording_version='member-clear-test';
insert into public.zoe_consents(member_id,kind,granted,wording_version)
 values('ec1e0000-0000-4000-8000-000000000001','zoe_reads_messages',true,'member-clear-test');
-- A synthetic alarm anchored ten minutes ago, and a started follow-up.
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
 values('ec1e0000-0000-4000-8000-000000000003','ec1e0000-0000-4000-8000-000000000002','ec1e0000-0000-4000-8000-000000000001',1,0,0,current_date,'finished','discarded','urgent_route_no_model_call',now());
insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind,created_at)
 values('ec1e0000-0000-4000-8000-000000000002','ec1e0000-0000-4000-8000-000000000001','ec1e0000-0000-4000-8000-000000000003',1,'Synthetic urgent answer.','en','noreon.rules','synthetic','urgent',clock_timestamp()-interval '10 minutes');
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state)
 values('ec1e0000-0000-4000-8000-000000000004','ec1e0000-0000-4000-8000-000000000002','ec1e0000-0000-4000-8000-000000000001',2,0,0,current_date,'started');
create function pg_temp.win(run uuid default 'ec1e0000-0000-4000-8000-000000000004')returns jsonb language plpgsql as $$declare j jsonb;begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 j:=public.zoe_run_urgent_window(array[run]);return j->0;end$$;
-- Regression: urgent words (the staging opener), not just an intake/reading alarm,
-- must supply a durable anchor to the worker even without a measurement.
select pg_temp.ok(pg_temp.win()->>'urgentOpenedBy'='rule','Urgent word opens a rule window');
select pg_temp.ok((pg_temp.win()#>>'{memberClear,startedAt}')::timestamptz=
 (select created_at from public.zoe_member_answers where run_id='ec1e0000-0000-4000-8000-000000000003'),
 'Urgent-word window returns memberClear.startedAt');
select pg_temp.ok((public.zoe_run_alarm_window(array['ec1e0000-0000-4000-8000-000000000004'::uuid])#>>'{0,memberClear,startedAt}')::timestamptz=
 (pg_temp.win()#>>'{memberClear,startedAt}')::timestamptz,'Flagged worker gets the same urgent-word anchor');
insert into public.patient_measurements(id,user_id,submission_id,systolic,diastolic,measured_at,created_at)
 values('ec1e0000-0000-4000-8000-000000000005','ec1e0000-0000-4000-8000-000000000001',gen_random_uuid(),198,106,clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '20 minutes');
select pg_temp.ok(pg_temp.win()#>>'{memberClear,readingClearReason}'is null,'Old crisis does not clear');
-- A calm reading that predates the alarm is not a new clear.
update public.patient_measurements set systolic=117,diastolic=91 where id='ec1e0000-0000-4000-8000-000000000005';
select pg_temp.ok(pg_temp.win()#>>'{memberClear,readingClearReason}'is null,'A pre-existing calm reading cannot clear an unrelated alarm');
-- MC-02: entry time after the alarm does not make a historical measurement new.
update public.patient_measurements set created_at=clock_timestamp()
 where id='ec1e0000-0000-4000-8000-000000000005';
select pg_temp.ok(pg_temp.win()#>>'{memberClear,readingClearReason}'is null,'A backdated calm reading entered after the alarm cannot clear it');
-- Correction of the actual crisis row is known by the opener's ID snapshot.
insert into public.conversation_audit(conversation_id,kind,detail)
 values('ec1e0000-0000-4000-8000-000000000002','zoe.urgent_reading','{"runId":"ec1e0000-0000-4000-8000-000000000003","readingId":"ec1e0000-0000-4000-8000-000000000005"}');
select pg_temp.ok(pg_temp.win()#>>'{memberClear,readingClearReason}'='corrected_reading','Correcting the crisis row clears');
insert into public.patient_measurements(id,user_id,submission_id,systolic,diastolic,measured_at)
 values('ec1e0000-0000-4000-8000-000000000006','ec1e0000-0000-4000-8000-000000000001',gen_random_uuid(),117,91,clock_timestamp());
select pg_temp.ok(pg_temp.win()#>>'{memberClear,readingClearReason}'='new_reading','A newer calm row clears');
-- Capture the real context in the same shape sent by the worker. No receipt: publication holds are not bypassed.
create temp table result as select jsonb_build_object('outcome','summary_only','reason','member_cleared_urgent_window',
 'summary','Synthetic member clear. Existing care alerts and safety holds remain.','guardReasons','[]'::jsonb,'provider','none','model','none',
 'configVersion','member-clear-test','tier','none','tierReason','not_routed','events','[]'::jsonb,'memberClearEnabled',true,
 'memberClear',jsonb_build_object('startedAt',pg_temp.win()#>>'{memberClear,startedAt}',
  'readingId',pg_temp.win()#>>'{memberClear,readingId}','readingVersion',pg_temp.win()#>>'{memberClear,readingVersion}','reason','new_reading'))payload;
select pg_temp.ok((public.zoe_run_finish('ec1e0000-0000-4000-8000-000000000004',(select payload from result))->>'ok')::boolean,'Real finish accepts a fresh clear');
select pg_temp.ok(exists(select 1 from public.conversation_audit where kind='zoe.member_cleared_urgent'and actor_id='ec1e0000-0000-4000-8000-000000000001'
 and detail->>'reason'='new_reading'and detail->>'readingId'='ec1e0000-0000-4000-8000-000000000006'),'Who, reason and reading are durable');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='zoe.urgent.member_cleared'
 and attributes->>'noreon.zoe.member_clear.member_id'='ec1e0000-0000-4000-8000-000000000001'
 and attributes?'noreon.zoe.member_clear.at'),'Run event records who and when');
select pg_temp.ok((public.zoe_run_finish('ec1e0000-0000-4000-8000-000000000004',(select payload from result))->>'replayed')::boolean,'Idempotent replay');
select pg_temp.ok((select count(*)=1 from public.conversation_audit where kind='zoe.member_cleared_urgent'),'Replay does not duplicate the clear');
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state)
 values('ec1e0000-0000-4000-8000-000000000007','ec1e0000-0000-4000-8000-000000000002','ec1e0000-0000-4000-8000-000000000001',3,0,0,current_date,'started');
select pg_temp.ok(pg_temp.win('ec1e0000-0000-4000-8000-000000000007')#>>'{memberClear,sinceMinutes}'is null,'Follow-up member window stays closed without an acknowledgement');
select pg_temp.ok((pg_temp.win('ec1e0000-0000-4000-8000-000000000007')#>>'{memberClear,suppressStoredReading}')::boolean,'Exact cleared row is suppressed');
select pg_temp.ok((select started_at is not null from public._zoe_urgent_window('ec1e0000-0000-4000-8000-000000000002')),'Legacy window is unchanged when publication held the acknowledgement');
-- New crisis data cannot be swallowed by a clear completion timestamp, even if its created_at is earlier.
insert into public.patient_measurements(id,user_id,submission_id,systolic,diastolic,measured_at,created_at)
 values('ec1e0000-0000-4000-8000-000000000008','ec1e0000-0000-4000-8000-000000000001',gen_random_uuid(),199,107,clock_timestamp(),clock_timestamp()-interval '1 minute');
select pg_temp.ok(not(pg_temp.win('ec1e0000-0000-4000-8000-000000000007')#>>'{memberClear,suppressStoredReading}')::boolean,'A new crisis row is never covered by an older clear');
-- A stale duplicate clear cannot supersede that new reading.
select pg_temp.ok(public.zoe_run_finish('ec1e0000-0000-4000-8000-000000000007',(select payload from result))->>'ok'='true','Stale finish records no output');
select pg_temp.ok((select reason_code='member_clear_stale'from public.zoe_runs where id='ec1e0000-0000-4000-8000-000000000007'),'Changed reading invalidates clear intent');
select pg_temp.ok((select count(*)=1 from public.conversation_audit where kind='zoe.member_cleared_urgent'),'Stale intent writes no clear');
select 'Zoe member-clear SQL checks passed.';
rollback;
