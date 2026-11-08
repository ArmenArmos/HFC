-- Fictional staging hours, capacity, logistics replay and shared message visibility. Isolated Verify only; rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.vr_id(n integer)returns uuid language sql as $$select('b0040000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.vr_ok(ok boolean,label text)returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.vr_actor(n integer)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.vr_id(n),'role','authenticated','session_id',pg_temp.vr_id(n),
  'amr',jsonb_build_array(jsonb_build_object('method',case when n=1 then 'otp'else 'password'end)))::text,true);
end$$;
insert into auth.users(id,email,phone,phone_confirmed_at)values
 (pg_temp.vr_id(1),null,'37499004001',now()),
 (pg_temp.vr_id(2),'staging-admin@example.invalid',null,null),
 (pg_temp.vr_id(3),'staging-doctor@example.invalid',null,null),
 (pg_temp.vr_id(4),'visit-request-nurse@example.invalid',null,null);
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.vr_id(n),pg_temp.vr_id(n),now(),now()from generate_series(1,4)n;
insert into public.workspace_clinics(id,name,address)values
 (pg_temp.vr_id(10),'Staging Clinic','Fictional test location'),(pg_temp.vr_id(11),'Other fictional clinic','Other fictional address');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.vr_id(2),'admin','Staging Admin',null),
 (pg_temp.vr_id(3),'doctor','Staging Doctor',pg_temp.vr_id(10)),
 (pg_temp.vr_id(4),'nurse','Visit Request Nurse',pg_temp.vr_id(10));
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.vr_id(1),pg_temp.vr_id(3),pg_temp.vr_id(4));
update public.clinic_scheduling_capabilities set enabled=true where singleton;
create function pg_temp.vr_seed()returns void language plpgsql as $$
declare clinic uuid;actor uuid;
begin
 if not exists(select 1 from auth.users where email='staging-admin@example.invalid')then
  raise exception 'Not the staging database: run seed-staging-accounts.mjs first';
 end if;
 select c.id,u.id into clinic,actor from public.workspace_clinics c
  cross join auth.users u where c.name='Staging Clinic'and c.address='Fictional test location'and c.active
  and u.email='staging-doctor@example.invalid';
 if clinic is null or actor is null then raise exception 'Fictional staging clinic or doctor missing';end if;
 insert into public.clinic_schedules(clinic_id,active,slot_minutes,capacity,covered_test_ids,preparation,updated_by)
 values(clinic,true,30,2,array['lipid-panel','hba1c'],
  'Fictional staging schedule. Your care team will confirm preparation before your visit.',actor)
 on conflict(clinic_id)do nothing;
 insert into public.clinic_schedule_hours(clinic_id,weekday,opens,closes)
 select clinic,d::smallint,time '09:00',time '18:00'from generate_series(1,5)d
 on conflict(clinic_id,weekday)do nothing;
 -- seed-staging.sql enables clinic scheduling. This remains inert if that database switch is off.
 perform public._clinic_schedule_generate(clinic,true);
end$$;
select pg_temp.vr_seed();
create temp table vr_capacity as select key from public.booking_manual_capacity where clinic_id=pg_temp.vr_id(10);
select pg_temp.vr_seed();
select pg_temp.vr_ok((select count(*)=5 from public.clinic_schedule_hours where clinic_id=pg_temp.vr_id(10)),'Five fictional opening days, even on replay');
select pg_temp.vr_ok((select count(*)>0 from vr_capacity),'Staging generator writes capacity');
select pg_temp.vr_ok((select count(*)=(select count(*)from vr_capacity)from public.booking_manual_capacity where clinic_id=pg_temp.vr_id(10)),'Seed replay never duplicates capacity');
select pg_temp.vr_ok(not exists(select 1 from public.booking_manual_capacity where clinic_id=pg_temp.vr_id(10)and(capacity<>2 or source<>'clinic-hours')),'Fictional slots use the existing capacity contract');
select pg_temp.vr_ok(not exists(select 1 from public.clinic_schedules where clinic_id=pg_temp.vr_id(11)),'Other clinics are untouched');
select pg_temp.vr_ok(jsonb_array_length(public.zoe_member_clinic_hours(pg_temp.vr_id(1)))=5,'Assigned clinic hours are available to the request read');

create temp table vr_results(label text primary key,value jsonb);
grant all on vr_results to authenticated,service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
insert into vr_results values('task',public.care_queue_raise(pg_temp.vr_id(1),'admin',null,'lab_booking_needed','visit-request-test',null,'book','{}',null,'visit-request:b0040000-0000-4000-8000-000000000020'));
insert into vr_results values('replay',public.care_queue_raise(pg_temp.vr_id(1),'admin',null,'lab_booking_needed','visit-request-test',null,'book','{}',null,'visit-request:b0040000-0000-4000-8000-000000000020'));
select pg_temp.vr_ok(value->>'ok'='true'and value->>'replayed'='true','Same card task replays')from vr_results where label='replay';
reset role;
select pg_temp.vr_ok((select count(*)=1 from public.care_queue_tasks where member_id=pg_temp.vr_id(1)),'Exactly one logistics task');
select pg_temp.vr_ok((select summary='{}'and zone is null and reason_code='lab_booking_needed'and suggested_action='book'from public.care_queue_tasks where member_id=pg_temp.vr_id(1)),'Admin task contains fixed logistics only');

insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'visit-request-test',3600,600,60,100,true,false,true);
update public.nurse_chat_settings set enabled=true where singleton;
select pg_temp.vr_actor(1);set local role authenticated;
insert into vr_results values('message',public.conversation_receive(jsonb_build_object('requestId',pg_temp.vr_id(21),'text','Visit request: Friday, 6 November 2026, morning. Please call first.'),true));
select pg_temp.vr_ok(value->>'ok'='true','Member sends through ordinary app path')from vr_results where label='message';
select pg_temp.vr_ok(public.conversation_receive(jsonb_build_object('requestId',pg_temp.vr_id(21),'text','Visit request: Friday, 6 November 2026, morning. Please call first.'),true)->>'replayed'='true','Message retry replays');
reset role;
select pg_temp.vr_ok((select count(*)=1 from public.conversation_messages where author_id=pg_temp.vr_id(1)and to_doctor),'One member message addressed to care team');
select pg_temp.vr_actor(3);set local role authenticated;
select pg_temp.vr_ok(public.conversation_workspace(pg_temp.vr_id(1))#>>'{messages,0,text}'='Visit request: Friday, 6 November 2026, morning. Please call first.','Assigned doctor sees request details');
reset role;
select pg_temp.vr_actor(4);set local role authenticated;
select pg_temp.vr_ok(public.conversation_nurse_workspace(pg_temp.vr_id(1))#>>'{items,0,text}'='Visit request: Friday, 6 November 2026, morning. Please call first.','Assigned nurse sees request details');
reset role;
select pg_temp.vr_actor(2);set local role authenticated;
select pg_temp.vr_ok(public.care_queue_inbox('admin')#>>'{tasks,0,reason}'='lab_booking_needed','Admin sees the booking task');
reset role;
rollback;
