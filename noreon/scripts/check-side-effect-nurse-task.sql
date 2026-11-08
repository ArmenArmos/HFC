-- Fictional side effect routing checks; all fixtures roll back.
-- Member's own case only, fixed text, one open task per side effect, replay, no nurse, off switch, service path.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean,label text) returns void language plpgsql as $$begin
 if cond is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.act(p_user uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated','session_id',p_user,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 perform set_config('request.jwt.claim.sub',p_user::text,true);
end$$;
-- 01 doctor, 02 assigned nurse, 03 other nurse, 04 member, 05 member without a nurse, 06 clinic.
insert into auth.users(id,phone,phone_confirmed_at)select ('5e000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,case when n in(4,5) then '3740009650'||n end,case when n in(4,5) then now() end from generate_series(1,5)n;
insert into auth.sessions(id,user_id,created_at,updated_at)select ('5e000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,('5e000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,now(),now() from generate_series(1,5)n;
insert into public.workspace_clinics(id,name)values('5e000000-0000-4000-8000-000000000006','Synthetic routing clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('5e000000-0000-4000-8000-000000000001','doctor','Synthetic doctor','5e000000-0000-4000-8000-000000000006'),
 ('5e000000-0000-4000-8000-000000000002','nurse','Synthetic nurse','5e000000-0000-4000-8000-000000000006'),
 ('5e000000-0000-4000-8000-000000000003','nurse','Synthetic other nurse','5e000000-0000-4000-8000-000000000006');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('5e000000-0000-4000-8000-000000000004','5e000000-0000-4000-8000-000000000001','5e000000-0000-4000-8000-000000000002'),
 ('5e000000-0000-4000-8000-000000000005','5e000000-0000-4000-8000-000000000001',null);
update public.nurse_chat_settings set enabled=false;

set local role authenticated;
select pg_temp.act('5e000000-0000-4000-8000-000000000004');
select pg_temp.ok((public.member_side_effect_nurse_task('dizziness','5e000000-0000-4000-8000-0000000000a0'))->>'status'='off','switch off writes nothing');
reset role;
update public.nurse_chat_settings set enabled=true;
set local role authenticated;
select pg_temp.act('5e000000-0000-4000-8000-000000000004');
select pg_temp.ok((public.member_side_effect_nurse_task('dizziness','5e000000-0000-4000-8000-0000000000a1'))->>'status'='created','member creates a task');
select pg_temp.ok((public.member_side_effect_nurse_task('dizziness','5e000000-0000-4000-8000-0000000000a1'))->>'replayed'='true','a repeat request replays');
select pg_temp.ok((public.member_side_effect_nurse_task('dizziness','5e000000-0000-4000-8000-0000000000a2'))->>'status'='already_open','a second report joins the open task');
select pg_temp.ok((public.member_side_effect_nurse_task('nausea','5e000000-0000-4000-8000-0000000000a3'))->>'status'='created','another side effect gets its own task');
do $$begin
 perform public.member_side_effect_nurse_task('muscle_aches','5e000000-0000-4000-8000-0000000000a4');
 raise exception 'TEST unlisted side effect was accepted';
exception when sqlstate '22023' then null;end$$;
select pg_temp.act('5e000000-0000-4000-8000-000000000005');
select pg_temp.ok((public.member_side_effect_nurse_task('dizziness','5e000000-0000-4000-8000-0000000000a5'))->>'status'='no_nurse','no nurse writes nothing');
do $$begin
 perform public._side_effect_nurse_task('5e000000-0000-4000-8000-000000000004','dizziness','5e000000-0000-4000-8000-0000000000a6');
 raise exception 'TEST the helper is reachable by a member';
exception when insufficient_privilege then null;end$$;
do $$begin
 perform public.channel_side_effect_nurse_task('5e000000-0000-4000-8000-000000000004','nausea','5e000000-0000-4000-8000-0000000000a7');
 raise exception 'TEST the channel function is reachable by a member';
exception when insufficient_privilege then null;end$$;
reset role;
set local role anon;
do $$begin
 perform public.member_side_effect_nurse_task('dizziness','5e000000-0000-4000-8000-0000000000a8');
 raise exception 'TEST anon reached it';
exception when insufficient_privilege then null;end$$;
reset role;
select pg_temp.ok((select count(*)=2 from public.patient_coordination_tasks where patient_case_id='5e000000-0000-4000-8000-000000000004'),'two tasks for this member');
select pg_temp.ok((select count(*)=0 from public.patient_coordination_tasks where patient_case_id='5e000000-0000-4000-8000-000000000005'),'none without a nurse');
select pg_temp.ok((select bool_and(origin='zoe_side_effect' and kind='contact-followup' and owner_id='5e000000-0000-4000-8000-000000000002' and status='open' and due_at>now() and instructions like '%Do not advise stopping, reducing or switching%') from public.patient_coordination_tasks where patient_case_id='5e000000-0000-4000-8000-000000000004'),'fixed task for the assigned nurse');
select pg_temp.ok((select bool_and(actor_role='system' and actor_name='Noreon side effect routing' and actor_id='5e000000-0000-4000-8000-000000000001') from public.patient_coordination_events e join public.patient_coordination_tasks t on t.id=e.task_id where t.patient_case_id='5e000000-0000-4000-8000-000000000004'),'the audit names the routing');
select pg_temp.ok((select bool_and(creator_id='5e000000-0000-4000-8000-000000000001') from public.patient_coordination_tasks where patient_case_id='5e000000-0000-4000-8000-000000000004'),'a nurse never counts as the creator');
-- Snapshot and paged queue carry provenance through the actor-aware read path.
set local role authenticated;
select pg_temp.act('5e000000-0000-4000-8000-000000000002');
select pg_temp.ok(public.patient_coordination_queue('5e000000-0000-4000-8000-000000000004')#>>'{tasks,0,origin}'='zoe_side_effect','Queue preserves side-effect origin');
select pg_temp.ok(public.patient_coordination_snapshot((public.patient_coordination_queue('5e000000-0000-4000-8000-000000000004')#>>'{tasks,0,id}')::uuid)->>'origin'='zoe_side_effect','Snapshot preserves side-effect origin');
reset role;
-- The assigned nurse reads it through the unchanged predicate; a nurse of another member does not.
set local role authenticated;
select pg_temp.act('5e000000-0000-4000-8000-000000000002');
select pg_temp.ok(public.patient_coordination_access('5e000000-0000-4000-8000-000000000004'),'the assigned nurse sees the case');
select pg_temp.act('5e000000-0000-4000-8000-000000000003');
select pg_temp.ok(not public.patient_coordination_access('5e000000-0000-4000-8000-000000000004'),'another nurse does not');
reset role;
select pg_temp.ok((public.channel_side_effect_nurse_task('5e000000-0000-4000-8000-000000000004','nausea','5e000000-0000-4000-8000-0000000000a9'))->>'status'='already_open','the service path shares the open task');
\echo 'Side effect nurse task passed.'
rollback;
