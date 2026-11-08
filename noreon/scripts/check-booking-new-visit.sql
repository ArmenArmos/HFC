-- WP-5 (quality review item 6): a member can book again after an attended visit once the programme
-- changes; the programme state the app reads; the home-visit request fence. Fictional data; rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean,label text) returns void language plpgsql as $$begin if cond is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.reject(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected rejection % for %',expected,q;
end$$;
create function pg_temp.reject_message(q text,expected text,message text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected and sqlerrm=message then return;end if;raise;end;
 raise exception 'Expected rejection % (%) for %',expected,message,q;
end$$;
grant execute on function pg_temp.reject_message(text,text,text) to service_role;
create function pg_temp.actor(id uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated','session_id',id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
end$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.reject(text,text),pg_temp.actor(uuid) to authenticated,service_role;
-- b5e0: member 01, other member 02, admin 03, clinic 10.
insert into auth.users(id,phone,phone_confirmed_at)values('b5e00000-0000-4000-8000-000000000001','374000000051',now()),('b5e00000-0000-4000-8000-000000000002','374000000052',now()),('b5e00000-0000-4000-8000-000000000003',null,null);
update public.profiles set display_name='Fictional rebooking member',birth_date='1980-01-01',biological_sex='female' where id::text like 'b5e00000%';
insert into public.patient_consents(user_id,version)values('b5e00000-0000-4000-8000-000000000001','patient-pilot-v1');
insert into public.patient_assessments(user_id,revision,completed_at)values('b5e00000-0000-4000-8000-000000000001',1,now()-interval '1 hour');
insert into auth.sessions(id,user_id,created_at,updated_at)select id,id,now(),now()from auth.users where id::text like 'b5e00000%';
insert into public.workspace_clinics(id,name,address,scheduling_email)values('b5e00000-0000-4000-8000-000000000010','Fictional rebooking clinic','Fictional clinic address','clinic@example.invalid');
insert into public.workspace_staff(user_id,role,display_name)values('b5e00000-0000-4000-8000-000000000003','admin','Fictional rebooking admin');
insert into public.patient_clinical_cases(user_id)values('b5e00000-0000-4000-8000-000000000001');
update public.workspace_scheduling_settings set copy_email='copy@example.invalid',revision=1;
create temp table ctx(n int primary key,member uuid,command uuid,program jsonb);
grant select on ctx to authenticated,service_role;
create function pg_temp.seal(n int) returns void language sql as $$
 insert into ctx select $1,'b5e00000-0000-4000-8000-000000000001'::uuid,('b5e00000-0000-4000-8000-00000000002'||$1)::uuid,
  jsonb_build_object('memberId','b5e00000-0000-4000-8000-000000000001','sourceToken',c->>'token','requirementsToken',c->>'requirementsToken','engineVersion','synthetic-engine-v1','items',jsonb_build_array(
   jsonb_build_object('id','synthetic-lab','title','Synthetic lab','method','lab','preparation','Synthetic only','source','fixture'),
   jsonb_build_object('id','synthetic-clinic','title','Synthetic clinic test','method','clinic','preparation','Synthetic only','source','fixture')))
 from(select public.patient_test_context('b5e00000-0000-4000-8000-000000000001')c)s
$$;
-- Five places on one fictional manual slot.
select pg_temp.actor('b5e00000-0000-4000-8000-000000000003');
create temp table offer as select jsonb_build_object('id','b5e00000-0000-4000-8000-000000000030','version','source-v1','source','synthetic-manual-fixture','clinicId','b5e00000-0000-4000-8000-000000000010','mode','clinic',
 'startsAt',now()+interval '1 day','endsAt',now()+interval '1 day 1 hour','timezone','Asia/Yerevan','clinicAddress','Fictional clinic address','preparation','Synthetic preparation only','preparationVersion','synthetic-v1',
 'coveredTestIds',jsonb_build_array('synthetic-lab'),'followUps',jsonb_build_array(jsonb_build_object('testId','synthetic-clinic','owner','Synthetic operator','action','Synthetic follow-up','reference','synthetic-reference')),
 'reservationContract',jsonb_build_object('version','manual-v1','reference','synthetic-shared-capacity')) o;
grant select on offer to service_role;
set local role service_role;
select public.register_manual_booking_offer('b5e00000-0000-4000-8000-000000000003',o,5,now()+interval '30 minutes')from offer;
reset role;
create function pg_temp.book(n int) returns jsonb language sql as $$
 select public.select_booking_appointment(command,member,member,command,(o->>'id')::uuid,o->>'version',p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',
  p_subject=>'Synthetic schedule',p_text_content=>'Synthetic approved content only')from ctx,offer where ctx.n=$1
$$;
grant execute on function pg_temp.book(int) to service_role;
create function pg_temp.state(appointment uuid) returns jsonb language sql as $$
 select public.booking_pilot_programme_state('b5e00000-0000-4000-8000-000000000001')->'appointments'->appointment::text
$$;
grant execute on function pg_temp.state(uuid) to authenticated;
create temp table home as select jsonb_build_object('startsAt',now()+interval '10 days','timezone','Asia/Yerevan','mode','home','location','Fictional home address') terms,
 '[{"id":"synthetic-lab","title":"Synthetic lab","method":"lab"}]'::jsonb requirements;
grant select on home to service_role;
create function pg_temp.home_request(id uuid) returns jsonb language sql as $$
 select public.create_patient_test_request('b5e00000-0000-4000-8000-000000000001',id,current_setting('test.source'),terms,requirements,'synthetic-engine-v1')from home
$$;
grant execute on function pg_temp.home_request(uuid) to service_role;

-- 1. First programme: book, the clinic confirms, the member arrives.
select pg_temp.seal(1);
set local role service_role;
select public.register_booking_program(command,member,member,program)from ctx where n=1;
select pg_temp.ok(pg_temp.book(1)->>'status'='notification-pending','First visit booked');
reset role;
set local session_replication_role=replica;
update public.booking_appointments set status='confirmed',current_arrangement=proposed_arrangement,current_reservation_id=proposed_reservation_id where id='b5e00000-0000-4000-8000-000000000021';
insert into public.clinic_booking_checkins(clinic_id,appointment_id,reservation_id,outcome,actor_id,membership_id)
 select 'b5e00000-0000-4000-8000-000000000010',id,current_reservation_id,'arrived','b5e00000-0000-4000-8000-000000000003',gen_random_uuid()from public.booking_appointments where id='b5e00000-0000-4000-8000-000000000021';
set local session_replication_role=origin;
select pg_temp.actor('b5e00000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.ok(pg_temp.state('b5e00000-0000-4000-8000-000000000021')='{"currentProgramme":true,"open":false}','Attended visit of the current programme: current, not open');
reset role;
-- Same programme: a second booking and a home request stay refused (the app offers neither).
select set_config('test.source',public.patient_test_context('b5e00000-0000-4000-8000-000000000001')->>'token',true);
select pg_temp.seal(2);
set local role service_role;
select public.register_booking_program(command,member,member,program)from ctx where n=2;
select pg_temp.reject('select pg_temp.book(2)','40001');
select pg_temp.reject($q$select pg_temp.home_request('b5e00000-0000-4000-8000-000000000041')$q$,'40001');
reset role;

-- 2. The member's answers change: a new programme. The attended visit is history.
update public.patient_assessments set completed_at=now() where user_id='b5e00000-0000-4000-8000-000000000001';
select pg_temp.ok((select program->>'requirementsToken'from ctx where n=1)is distinct from public.patient_test_context('b5e00000-0000-4000-8000-000000000001')->>'requirementsToken','Requirements changed');
select pg_temp.actor('b5e00000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.ok(pg_temp.state('b5e00000-0000-4000-8000-000000000021')='{"currentProgramme":false,"open":false}','Attended visit of an earlier programme: neither current nor open');
reset role;
-- A home request is no longer fenced by the attended visit (cancel it again so booking can go ahead).
select set_config('test.source',public.patient_test_context('b5e00000-0000-4000-8000-000000000001')->>'token',true);
set local role service_role;
select pg_temp.ok(pg_temp.home_request('b5e00000-0000-4000-8000-000000000042')->>'status'='requested','Home request after an attended earlier visit');
select public.command_patient_test_request('b5e00000-0000-4000-8000-000000000001','b5e00000-0000-4000-8000-000000000001',false,'b5e00000-0000-4000-8000-000000000042',0,gen_random_uuid(),'cancel','{}');
reset role;
-- A slot booking for the new programme succeeds.
select pg_temp.seal(3);
set local role service_role;
select public.register_booking_program(command,member,member,program)from ctx where n=3;
select pg_temp.ok(pg_temp.book(3)->>'status'='notification-pending','New visit booked after the attended one');
reset role;
select pg_temp.ok((select count(*)=2 from public.booking_appointments where member_id='b5e00000-0000-4000-8000-000000000001'),'Two visits: the attended one and the new one');
select pg_temp.actor('b5e00000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.ok(pg_temp.state('b5e00000-0000-4000-8000-000000000023')='{"currentProgramme":true,"open":true}','The new visit is current and open');
reset role;
-- While it is live, the home request is fenced again.
set local role service_role;
select pg_temp.reject($q$select pg_temp.home_request('b5e00000-0000-4000-8000-000000000043')$q$,'40001');
reset role;

-- 3. Open, case by case, on the attended row with one field changed.
create function pg_temp.open_with(patch jsonb) returns boolean language sql as $$
 select public._booking_visit_open(jsonb_populate_record(a,patch))from public.booking_appointments a where id='b5e00000-0000-4000-8000-000000000023'
$$;
select pg_temp.ok(pg_temp.open_with('{}'),'Waiting on the clinic: open');
select pg_temp.ok(pg_temp.open_with('{"status":"cancelled"}') is false,'Cancelled: not open');
select pg_temp.ok(pg_temp.open_with(jsonb_build_object('status','confirmed','current_arrangement',jsonb_build_object('startsAt',now()+interval '1 day','endsAt',now()+interval '1 day 1 hour'))),'Confirmed and upcoming: open');
select pg_temp.ok(pg_temp.open_with(jsonb_build_object('status','confirmed','current_arrangement',jsonb_build_object('startsAt',now()-interval '2 hours','endsAt',now()-interval '1 hour'))) is false,'Confirmed and past: not open');
select pg_temp.ok(pg_temp.open_with('{"status":"failed"}'),'Failed notice: open (staff resolve it)');
-- An attended visit is closed even if its time is still ahead.
select pg_temp.ok(not public._booking_visit_open(a),'Attended: not open')from public.booking_appointments a where id='b5e00000-0000-4000-8000-000000000021';

-- 5. Review WP5-R1: a confirmed visit with a reservation but no check-in is open (not NULL).
set local session_replication_role=replica;
update public.booking_appointments set status='confirmed',current_arrangement=proposed_arrangement,current_reservation_id=proposed_reservation_id where id='b5e00000-0000-4000-8000-000000000023';
set local session_replication_role=origin;
update public.patient_assessments set completed_at=now()+interval '1 minute' where user_id='b5e00000-0000-4000-8000-000000000001';
select set_config('test.source',public.patient_test_context('b5e00000-0000-4000-8000-000000000001')->>'token',true);
select pg_temp.actor('b5e00000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.ok(pg_temp.state('b5e00000-0000-4000-8000-000000000023')='{"currentProgramme":false,"open":true}','Upcoming visit without check-in from an earlier programme: open');
reset role;
set local role service_role;
select pg_temp.reject($q$select pg_temp.home_request('b5e00000-0000-4000-8000-000000000044')$q$,'40001');
reset role;
select pg_temp.ok(not exists(select 1 from public.patient_test_requests where id='b5e00000-0000-4000-8000-000000000044'),'No request row left behind');

-- 6. Review WP5-R3: while that earlier visit is open, a slot booking for the new programme is refused.
select pg_temp.seal(4);
set local role service_role;
select public.register_booking_program(command,member,member,program)from ctx where n=4;
select pg_temp.reject_message('select pg_temp.book(4)','40001','Another visit is still open');
reset role;
-- Once its time has passed it is history, and the booking goes ahead.
update public.booking_appointments set current_arrangement=current_arrangement||jsonb_build_object('startsAt',now()-interval '2 hours','endsAt',now()-interval '1 hour')where id='b5e00000-0000-4000-8000-000000000023';
set local role service_role;
select pg_temp.ok(pg_temp.book(4)->>'status'='notification-pending','Booked once the earlier visit has passed');
reset role;

-- 7. Review WP5-R2: accepting a clinic proposal on the past visit takes a new hold. It is refused while
-- another visit is open, and while a home-visit request is open.
insert into public.booking_manual_reservations(id,appointment_id,capacity_key,offer_id,offer_version,member_id,valid_until)
 select 'b5e00000-0000-4000-8000-000000000050',a.id,r.capacity_key,r.offer_id,r.offer_version,a.member_id,r.valid_until
 from public.booking_appointments a join public.booking_manual_reservations r on r.id=a.current_reservation_id where a.id='b5e00000-0000-4000-8000-000000000023';
-- The same update booking_portal_proposal_answer makes on accept (20261017204237): proposed and
-- current both move to the new reservation and the visit is confirmed at once.
create function pg_temp.accept_on_past() returns void language sql as $$
 update public.booking_appointments set revision=revision+1,status='confirmed',proposed_arrangement=current_arrangement,proposed_reservation_id='b5e00000-0000-4000-8000-000000000050',
  current_reservation_id='b5e00000-0000-4000-8000-000000000050',legacy_current=null where id='b5e00000-0000-4000-8000-000000000023'
$$;
select pg_temp.reject_message('select pg_temp.accept_on_past()','40001','Another visit is still open');
update public.booking_appointments set status='cancelled'where id='b5e00000-0000-4000-8000-000000000024';
select set_config('test.source',public.patient_test_context('b5e00000-0000-4000-8000-000000000001')->>'token',true);
set local role service_role;
select pg_temp.ok(pg_temp.home_request('b5e00000-0000-4000-8000-000000000045')->>'status'='requested','Home request once the new booking is cancelled');
reset role;
select pg_temp.reject_message('select pg_temp.accept_on_past()','40001','Reconcile the existing historical request first');
-- Releasing a declined change (proposed back to current) takes no new hold and is never refused.
update public.booking_appointments set proposed_reservation_id=current_reservation_id where id='b5e00000-0000-4000-8000-000000000023';

-- 4. Access: another member cannot read the state; the helper is private.
select pg_temp.actor('b5e00000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.reject($q$select public.booking_pilot_programme_state('b5e00000-0000-4000-8000-000000000001')$q$,'42501');
select pg_temp.ok(public.booking_pilot_programme_state()->'appointments'='{}'::jsonb,'Own state with no visits is empty');
reset role;
select pg_temp.ok(not has_function_privilege('anon','public.booking_pilot_programme_state(uuid)','EXECUTE'),'Not callable by anon');
select pg_temp.ok(not has_function_privilege('authenticated','public._booking_visit_open(public.booking_appointments)','EXECUTE'),'Helper is private');
rollback;
