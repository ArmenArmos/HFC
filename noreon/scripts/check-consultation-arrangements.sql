-- Fictional B5 consultation-queue checks; all fixtures roll back.
-- Switch, admin-only queue, no clinical reason, audited arrange with replay,
-- stale on a changed decision, time and channel validation, member status.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean,label text) returns void language plpgsql as $$begin
 if cond is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.raises(statement text) returns boolean language plpgsql as $$begin
 execute statement;return false;
exception when insufficient_privilege then return true;end$$;
-- b5c0: admin 01, doctor 02, member 04 (hold), member 05 (no hold), clinic 07, inactive clinic 08.
insert into auth.users(id,phone,phone_confirmed_at)select ('b5c00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,case when n in(4,5)then '37400096000'||n end,case when n in(4,5)then now()end from generate_series(1,5)n where n<>3;
insert into auth.sessions(id,user_id,created_at,updated_at)select id,id,clock_timestamp(),clock_timestamp() from auth.users where id::text like 'b5c0%';
insert into public.workspace_clinics(id,name,active)values('b5c00000-0000-4000-8000-000000000007','Synthetic consult clinic',true),('b5c00000-0000-4000-8000-000000000008','Synthetic closed clinic',false);
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('b5c00000-0000-4000-8000-000000000001','admin','Synthetic consult admin',null),
 ('b5c00000-0000-4000-8000-000000000002','doctor','Synthetic consult doctor','b5c00000-0000-4000-8000-000000000007');
update public.profiles set display_name='Synthetic held member' where id='b5c00000-0000-4000-8000-000000000004';
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,review)values
 ('b5c00000-0000-4000-8000-000000000004','b5c00000-0000-4000-8000-000000000002','{"preparedAt":"2026-10-17T08:00:00+00:00","consultation":{"decision":"required","note":"PRIVATE REASON","at":"2026-10-17T08:05:00+00:00"}}'),
 ('b5c00000-0000-4000-8000-000000000005','b5c00000-0000-4000-8000-000000000002','{"consultation":{"decision":"not-required","note":"x","at":"2026-10-17T08:00:00+00:00"}}');
create function pg_temp.as_user(n int) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','b5c00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated','session_id','b5c00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true)
$$;
create function pg_temp.cmd(sub text,since text,days int,channel text,clinic text default null,previous timestamptz default null) returns jsonb language sql as $$
 select jsonb_build_object('version','consultation-arrange-v1','submissionId','b5c00000-0000-4000-8000-0000000008'||sub,'memberId','b5c00000-0000-4000-8000-000000000004','since',since,'previous',previous,
  'scheduledAt',to_char((date_trunc('minute',now())+make_interval(days=>days)) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),'channel',channel)
  ||case when clinic is null then '{}'::jsonb else jsonb_build_object('clinicId','b5c00000-0000-4000-8000-0000000000'||clinic)end
$$;

-- Switch off: no queue, command disabled, member status unchanged.
update public.doctor_completion_capabilities set enabled=false where singleton;
select pg_temp.as_user(1);
set local role authenticated;
select pg_temp.ok((public.admin_consultations_to_arrange()->>'enabled')::boolean=false,'switch off queue disabled');
select pg_temp.ok(public.admin_consultation_arrange_command(pg_temp.cmd('01','2026-10-17T08:00:00+00:00',2,'phone'))->>'status'='disabled','switch off command disabled');
reset role;
update public.doctor_completion_capabilities set enabled=true where singleton;

-- Only an active admin with a live session reads or writes.
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(pg_temp.raises('select public.admin_consultations_to_arrange()'),'doctor cannot read the queue');
select pg_temp.ok(pg_temp.raises($q$select public.admin_consultation_arrange_command(pg_temp.cmd('02','2026-10-17T08:00:00+00:00',2,'phone'))$q$),'doctor cannot arrange');
reset role;
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(pg_temp.raises('select public.admin_consultations_to_arrange()'),'member cannot read the queue');
do $$declare s jsonb:=public.patient_clinical_case_status();begin
 perform pg_temp.ok(s->>'status'='consultation_needed' and not(s?'consultation'),'member sees the hold without an arrangement');
end$$;
reset role;

-- Queue: the held member only, with doctor and since, no clinical reason.
select pg_temp.as_user(1);
set local role authenticated;
do $$declare q jsonb:=public.admin_consultations_to_arrange();c jsonb;begin
 select x into c from jsonb_array_elements(q->'cases')x where x->>'memberId'='b5c00000-0000-4000-8000-000000000004';
 perform pg_temp.ok(c is not null and c->>'memberName'='Synthetic held member' and c->>'doctorName'='Synthetic consult doctor' and (c->>'since')::timestamptz='2026-10-17T08:00:00+00:00' and c->'arrangement'='null'::jsonb,'held member listed unarranged');
 perform pg_temp.ok(not exists(select 1 from jsonb_array_elements(q->'cases')x where x->>'memberId'='b5c00000-0000-4000-8000-000000000005'),'member without a hold not listed');
 perform pg_temp.ok(q::text not like '%PRIVATE%','queue leaks no clinical reason');
 perform pg_temp.ok(exists(select 1 from jsonb_array_elements(q->'clinics')x where x->>'name'='Synthetic consult clinic') and not exists(select 1 from jsonb_array_elements(q->'clinics')x where x->>'name'='Synthetic closed clinic'),'only active clinics offered');
end$$;
-- Validation.
select pg_temp.ok(public.admin_consultation_arrange_command(pg_temp.cmd('03','2026-10-17T08:00:00+00:00',-1,'phone'))->>'status'='invalid-time','past time refused');
select pg_temp.ok(public.admin_consultation_arrange_command(pg_temp.cmd('04','2026-10-17T08:00:00+00:00',200,'phone'))->>'status'='invalid-time','far future refused');
select pg_temp.ok(public.admin_consultation_arrange_command(pg_temp.cmd('05','2026-10-17T08:00:00+00:00',2,'clinic'))->>'status'='invalid','clinic channel needs a clinic');
select pg_temp.ok(public.admin_consultation_arrange_command(pg_temp.cmd('06','2026-10-17T08:00:00+00:00',2,'phone','07'))->>'status'='invalid','phone channel takes no clinic');
select pg_temp.ok(public.admin_consultation_arrange_command(pg_temp.cmd('07','2026-10-17T08:00:00+00:00',2,'clinic','08'))->>'status'='invalid','inactive clinic refused');
select pg_temp.ok(public.admin_consultation_arrange_command(pg_temp.cmd('08','2026-10-17T08:00:00+00:00',2,'video'))->>'status'='invalid','video not offered yet');
select pg_temp.ok(public.admin_consultation_arrange_command(pg_temp.cmd('09','2026-10-16T08:00:00+00:00',2,'phone'))->>'status'='stale','different hold is stale');
select pg_temp.ok(public.admin_consultation_arrange_command('{"version":"consultation-arrange-v1"}')->>'status'='invalid','malformed command invalid');
-- Arrange, replay, rearrange.
select pg_temp.ok(public.admin_consultation_arrange_command(pg_temp.cmd('10','2026-10-17T08:00:00+00:00',2,'phone'))->>'status'='arranged','arranged by phone');
select pg_temp.ok(public.admin_consultation_arrange_command(pg_temp.cmd('10','2026-10-17T08:00:00+00:00',2,'phone'))->>'status'='arranged','resend replays');
select pg_temp.ok(public.admin_consultation_arrange_command(pg_temp.cmd('10','2026-10-17T08:00:00+00:00',3,'phone'))->>'status'='stale','reused submission with other details is stale');
select pg_temp.ok(public.admin_consultation_arrange_command(pg_temp.cmd('11','2026-10-17T08:00:00+00:00',3,'clinic','07'))->>'status'='stale','rearranging without the seen arrangement is stale');
select pg_temp.ok(public.admin_consultation_arrange_command(pg_temp.cmd('12','2026-10-17T08:00:00+00:00',3,'clinic','07',(select (x#>>'{arrangement,arrangedAt}')::timestamptz from jsonb_array_elements(public.admin_consultations_to_arrange()->'cases')x where x->>'memberId'='b5c00000-0000-4000-8000-000000000004')))->>'status'='arranged','rearranged at the clinic with the seen arrangement');
do $$declare c jsonb;begin
 select x into c from jsonb_array_elements(public.admin_consultations_to_arrange()->'cases')x where x->>'memberId'='b5c00000-0000-4000-8000-000000000004';
 perform pg_temp.ok(c#>>'{arrangement,channel}'='clinic' and c#>>'{arrangement,clinic}'='Synthetic consult clinic' and c#>>'{arrangement,arrangedBy}'='Synthetic consult admin','queue shows the latest arrangement');
end$$;
reset role;
-- Member sees the arranged time, channel and clinic, still no reason.
select pg_temp.as_user(4);
set local role authenticated;
do $$declare s jsonb:=public.patient_clinical_case_status();begin
 perform pg_temp.ok(s->>'status'='consultation_needed' and s#>>'{consultation,channel}'='clinic' and s#>>'{consultation,clinic}'='Synthetic consult clinic' and (s#>>'{consultation,scheduledAt}')::timestamptz>now(),'member sees the arrangement');
 perform pg_temp.ok(s::text not like '%PRIVATE%' and s::text not like '%admin%','member status leaks no reason or staff');
end$$;
reset role;
-- Editing the decision note keeps the arrangement (same prepared review).
update public.patient_clinical_cases set review=jsonb_set(jsonb_set(review,'{consultation,at}','"2026-10-17T09:00:00+00:00"'),'{consultation,note}','"PRIVATE edited"') where user_id='b5c00000-0000-4000-8000-000000000004';
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(public.patient_clinical_case_status()?'consultation','note edit keeps the arrangement');
reset role;
-- A new review is a new hold: the old arrangement no longer applies.
update public.patient_clinical_cases set review=jsonb_set(review,'{preparedAt}','"2026-10-17T10:00:00+00:00"') where user_id='b5c00000-0000-4000-8000-000000000004';
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(not(public.patient_clinical_case_status()?'consultation'),'new review drops the old arrangement');
reset role;
-- Completing the consultation ends the hold and the queue entry.
update public.patient_clinical_cases set review=jsonb_set(review,'{consultation,completedAt}',to_jsonb(now())) where user_id='b5c00000-0000-4000-8000-000000000004';
select pg_temp.as_user(1);
set local role authenticated;
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.admin_consultations_to_arrange()->'cases')x where x->>'memberId'='b5c00000-0000-4000-8000-000000000004'),'completed consultation leaves the queue');
reset role;
-- Audit and grants.
select pg_temp.ok((select count(*) from public.patient_consultation_arrangements where user_id='b5c00000-0000-4000-8000-000000000004')=2,'one row per arrangement');
do $$begin begin update public.patient_consultation_arrangements set channel='phone';raise exception 'TEST arrangement history mutable';exception when sqlstate '55000' then null;end;end$$;
select pg_temp.ok(not has_function_privilege('anon','public.admin_consultations_to_arrange()','execute') and not has_function_privilege('authenticated','public._consultation_hold_since(public.patient_clinical_cases)','execute') and not has_table_privilege('authenticated','public.patient_consultation_arrangements','select'),'no excess grants');
rollback;
\echo Consultation arrangements: switch, admin-only queue, validation, replay, rearrange, member status, new-hold reset and audit pass.
