-- Clinic-portal scheduling: hours and generated slots, portal notices, clinic actions,
-- member answers, check-in, roles and clinic isolation. Fictional data; rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.cs_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.cs_reject(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected rejection % for %',expected,q;
end$$;
create function pg_temp.cs_reject_message(q text,expected text,message text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected and sqlerrm=message then return;end if;raise;end;
 raise exception 'Expected rejection % (%) for %',expected,message,q;
end$$;
-- c5c0: member 01, member 02, clinic A admin 06, clinic A staff 07, clinic B admin 09, clinic A second admin 08. Clinics A 0a, B 0b.
create function pg_temp.cs_id(n text) returns uuid language sql immutable as $$select('c5c00000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.sub_id(n text) returns uuid language sql immutable as $$select('c5c00000-0000-4000-8000-0000000007'||n)::uuid$$;
grant execute on function pg_temp.sub_id(text) to authenticated,service_role;
create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cs_id(n),'role','authenticated','exp',4102444800,'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',('c5c00000-0000-4000-8000-0000000001'||n)::uuid)::text,true),
  set_config('request.jwt.claim.sub',pg_temp.cs_id(n)::text,true)
$$;
grant execute on function pg_temp.cs_id(text),pg_temp.as_user(text) to authenticated,service_role;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.cs_id(n),case when n in('01','02')then '3749900'||n||'55'end,case when n in('01','02')then now()end from unnest(array['01','02','06','07','08','09'])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select('c5c00000-0000-4000-8000-0000000001'||n)::uuid,pg_temp.cs_id(n),now(),now()from unnest(array['01','02','06','07','08','09'])n;
update public.profiles set display_name='Fictional member '||right(id::text,2),birth_date='1980-01-01',biological_sex='female' where id in(pg_temp.cs_id('01'),pg_temp.cs_id('02'));
insert into public.patient_consents(user_id,version)values(pg_temp.cs_id('01'),'patient-pilot-v1'),(pg_temp.cs_id('02'),'patient-pilot-v1');
insert into public.patient_assessments(user_id,revision,completed_at)values(pg_temp.cs_id('01'),1,now()),(pg_temp.cs_id('02'),1,now());
insert into public.patient_clinical_cases(user_id)values(pg_temp.cs_id('01')),(pg_temp.cs_id('02'));
insert into public.workspace_clinics(id,name,address)values(pg_temp.cs_id('0a'),'Fictional clinic A','1 Fictional Street, Yerevan'),(pg_temp.cs_id('0b'),'Fictional clinic B','2 Fictional Street, Yerevan');
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name,role)values
 (pg_temp.cs_id('06'),pg_temp.cs_id('0a'),'Fictional A admin','admin'),(pg_temp.cs_id('07'),pg_temp.cs_id('0a'),'Fictional A staff','staff'),
 (pg_temp.cs_id('08'),pg_temp.cs_id('0a'),'Fictional A second admin','admin'),(pg_temp.cs_id('09'),pg_temp.cs_id('0b'),'Fictional B admin','admin');
create temp table cs as select m member,pg_temp.cs_id('2'||right(m::text,1)) seal,
 jsonb_build_object('memberId',m,'sourceToken',c->>'token','requirementsToken',c->>'requirementsToken','engineVersion','synthetic-engine-v1','items',jsonb_build_array(
  jsonb_build_object('id','lab-a','title','Fictional lab A','method','lab','preparation','Fictional','source','fixture'),
  jsonb_build_object('id','ecg-b','title','Fictional ECG B','method','clinic','preparation','Fictional','source','fixture'),
  jsonb_build_object('id','home-c','title','Fictional home task','method','home-log','preparation','Fictional','source','fixture'))) program
 from(select m,public.patient_test_context(m)c from unnest(array[pg_temp.cs_id('01'),pg_temp.cs_id('02')])m)s;
grant select on cs to service_role,authenticated;
create function pg_temp.settings(rev int,active boolean,cap int,hours jsonb) returns jsonb language sql as $$
 select jsonb_build_object('expectedRevision',rev,'active',active,'slotMinutes',30,'capacity',cap,'coveredTestIds',jsonb_build_array('lab-a'),'followUpTestIds',jsonb_build_array('ecg-b','tsh'),
  'preparation','Fictional preparation: come fasting.','hours',hours)
$$;
create function pg_temp.week(opens text,closes text) returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('weekday',d,'opens',opens,'closes',closes)order by d)from generate_series(1,7)d
$$;
create function pg_temp.cmd(sub text,op text,appt uuid,rev bigint,extra jsonb default '{}') returns jsonb language sql as $$
 select jsonb_build_object('version','clinic-schedule-command-v1','op',op,'submissionId',('c5c00000-0000-4000-8000-0000000007'||sub)::uuid,'appointmentId',appt,'revision',rev)||extra
$$;
grant execute on function pg_temp.settings(int,boolean,int,jsonb),pg_temp.week(text,text),pg_temp.cmd(text,text,uuid,bigint,jsonb),pg_temp.cs_assert(boolean,text),pg_temp.cs_reject(text,text) to authenticated,service_role;
create temp table cs_slot(n int,key text,offer_id uuid,version text);
grant all on cs_slot to authenticated,service_role;

-- 1. Switched off: nothing generated, clinic RPCs answer disabled.
update public.clinic_scheduling_capabilities set enabled=false;
select pg_temp.as_user('06');
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_settings_save(pg_temp.cs_id('0a'),pg_temp.settings(0,true,1,pg_temp.week('09:00','12:00')))->>'status'='disabled','Settings refuse while switched off');
select pg_temp.cs_assert((public.clinic_schedule_bookings(pg_temp.cs_id('0a')))->>'enabled'='false','Bookings list reports switched off');
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('00','confirm',pg_temp.cs_id('99'),0))->>'status'='disabled','Commands refuse while switched off');
reset role;
update public.clinic_scheduling_capabilities set enabled=true;

-- 2. Roles: staff cannot change hours or the team; the identity reports the role.
select pg_temp.as_user('07');
set local role authenticated;
select pg_temp.cs_reject($q$select public.clinic_schedule_settings_save(pg_temp.cs_id('0a'),pg_temp.settings(0,true,1,pg_temp.week('09:00','12:00')))$q$,'42501');
select pg_temp.cs_reject($q$select public.clinic_schedule_team(pg_temp.cs_id('0a'))$q$,'42501');
select pg_temp.cs_assert(public.clinic_portal_identity(pg_temp.cs_id('0a'))#>>'{identity,capability}'='clinic_staff','Staff identity');
select pg_temp.cs_assert((public.clinic_schedule_settings(pg_temp.cs_id('0a')))->>'canEdit'='false','Staff reads hours without editing');
select pg_temp.as_user('06');
select pg_temp.cs_assert(public.clinic_portal_identity(pg_temp.cs_id('0a'))#>>'{identity,capability}'='clinic_admin','Admin identity');
-- Other clinic cannot read or write clinic A.
select pg_temp.as_user('09');
select pg_temp.cs_reject($q$select public.clinic_schedule_bookings(pg_temp.cs_id('0a'))$q$,'42501');
select pg_temp.cs_reject($q$select public.clinic_schedule_settings_save(pg_temp.cs_id('0a'),pg_temp.settings(0,true,1,pg_temp.week('09:00','12:00')))$q$,'42501');
select pg_temp.cs_reject($q$select public.clinic_schedule_free_slots(pg_temp.cs_id('0a'),current_date+1)$q$,'42501');

-- 3. Hours: validation, stale revision, generation.
select pg_temp.as_user('06');
select pg_temp.cs_assert(public.clinic_schedule_settings_save(pg_temp.cs_id('0a'),pg_temp.settings(0,true,1,pg_temp.week('12:00','09:00')))->>'status'='invalid','Closing before opening is invalid');
select pg_temp.cs_assert(public.clinic_schedule_settings_save(pg_temp.cs_id('0a'),pg_temp.settings(0,true,0,pg_temp.week('09:00','12:00')))->>'status'='invalid','Zero capacity is invalid');
select pg_temp.cs_assert(public.clinic_schedule_settings_save(pg_temp.cs_id('0a'),pg_temp.settings(0,true,1,pg_temp.week('09:00','12:00'))||'{"coveredTestIds":["lab-a"],"followUpTestIds":["lab-a"]}')->>'status'='invalid','A test cannot be both done and followed up');
select pg_temp.cs_assert(public.clinic_schedule_settings_save(pg_temp.cs_id('0a'),pg_temp.settings(0,true,1,pg_temp.week('09:00','12:00')))->>'status'='saved','Admin saves hours');
select pg_temp.cs_assert(public.clinic_schedule_settings_save(pg_temp.cs_id('0a'),pg_temp.settings(0,true,1,pg_temp.week('09:00','12:00')))->>'status'='stale','A second first-save is stale');
select pg_temp.cs_assert((public.clinic_schedule_settings(pg_temp.cs_id('0a')))#>>'{schedule,revision}'='1','Settings read back');
reset role;
select pg_temp.cs_assert((select count(*)between 27*6 and 28*6 from public.booking_manual_capacity where clinic_id=pg_temp.cs_id('0a')and source='clinic-hours'and valid_until>clock_timestamp()),'Six 30-minute slots a day for 28 days are generated');
select pg_temp.cs_assert((select bool_and(((starts_at at time zone 'Asia/Yerevan')::time)between '09:00'and '11:30')from public.booking_manual_capacity where clinic_id=pg_temp.cs_id('0a')and source='clinic-hours'),'Slots fall inside the hours, Yerevan time');
select pg_temp.cs_assert((select count(*)=0 from public.clinic_portal_audit where clinic_id=pg_temp.cs_id('0a')and kind='schedule-saved')is false,'Saving hours is audited');
insert into cs_slot select row_number()over(order by p.starts_at),p.key,o.id,o.version from public.booking_manual_capacity p join public.booking_offer_snapshots o on o.capacity_key=p.key and o.superseded_at is null
 where p.clinic_id=pg_temp.cs_id('0a')and p.source='clinic-hours'and p.starts_at>now()+interval '1 day'order by p.starts_at limit 6;
select pg_temp.cs_assert((select bool_and(o.id::text~'^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$')from public.booking_offer_snapshots o join public.booking_manual_capacity p on p.key=o.capacity_key where p.clinic_id=pg_temp.cs_id('0a')),'Generated offer ids are RFC 4122 version-5 shaped (the app validates them)');
-- Generation is idempotent the same day.
select pg_temp.cs_assert(public._clinic_schedule_generate(pg_temp.cs_id('0a'),false)=0,'Second generation the same day does nothing');

-- 4. Member offers: only free clinic-hours slots, projected to the member's tests.
set local role service_role;
select public.register_booking_program(seal,member,member,program)from cs;
create temp table cs_offers as select member,public.booking_pilot_offers(member,member,seal) list from cs;
reset role;
select pg_temp.cs_assert((select jsonb_array_length(list)>=6 from cs_offers where member=pg_temp.cs_id('01')),'Generated slots are offered');
select pg_temp.cs_assert((select o->'offer'->'coveredTestIds'='["lab-a"]'::jsonb and o->'offer'->'followUps'@>'[{"testId":"ecg-b"}]'::jsonb and not(o->'offer'->'followUps'@>'[{"testId":"tsh"}]'::jsonb)
 from cs_offers,jsonb_array_elements(list)o where member=pg_temp.cs_id('01')and o->'offer'->>'id'=(select offer_id::text from cs_slot where n=1)),'Offer is projected: done here, separate follow-up for the rest');

-- 5. Booking a clinic-hours slot records a portal notice with no email content.
set local role service_role;
select public.select_booking_appointment(pg_temp.cs_id('31'),member,member,seal,(select offer_id from cs_slot where n=1),(select version from cs_slot where n=1))from cs where member=pg_temp.cs_id('01');
reset role;
select pg_temp.cs_assert((select channel='portal'and state='pending'and sender_email is null and subject is null from public.booking_scheduling_notices where id=pg_temp.cs_id('31')),'Portal notice, no email');
select pg_temp.cs_assert((select status='notification-pending'and(public._booking_appointment_dto(a))->>'canStartScheduling'='false'from public.booking_appointments a where id=pg_temp.cs_id('31')),'No email first-send is offered for a portal notice');
select pg_temp.cs_reject($q$insert into public.booking_notice_attempts(id,notice_id,generation,envelope_hash)values(gen_random_uuid(),pg_temp.cs_id('31'),1,repeat('a',64))$q$,'22023');
select pg_temp.cs_reject($q$update public.booking_scheduling_notices set state='sending'where id=pg_temp.cs_id('31')$q$,'22023');
select pg_temp.cs_assert(public.claim_booking_notice(pg_temp.cs_id('31'),gen_random_uuid(),1,now()+interval '5 minutes','e','s@example.invalid','t')is null and(select state='pending'from public.booking_scheduling_notices where id=pg_temp.cs_id('31')),'A portal notice is never claimed for email (F-01)');
-- Capacity 1: the slot is no longer offered and cannot be booked by another member.
set local role service_role;
select pg_temp.cs_assert((select not exists(select 1 from jsonb_array_elements(public.booking_pilot_offers(member,member,seal))o where o->'offer'->>'id'=(select offer_id::text from cs_slot where n=1))from cs where member=pg_temp.cs_id('02')),'A full slot is not offered');
select pg_temp.cs_reject($q$select public.select_booking_appointment(pg_temp.cs_id('32'),member,member,seal,(select offer_id from cs_slot where n=1),(select version from cs_slot where n=1))from cs where member=pg_temp.cs_id('02')$q$,'40001');
reset role;

-- 6. Clinic list and isolation.
select pg_temp.as_user('07');
set local role authenticated;
create temp table cs_rows as select public.clinic_schedule_bookings(pg_temp.cs_id('0a')) r;
select pg_temp.cs_assert((select jsonb_array_length(r->'bookings')=1 from cs_rows),'Clinic A sees its one request');
select pg_temp.cs_assert((select b->>'status'='requested'and b->>'memberName'='Fictional member 01'and b->'memberPhone'='null'::jsonb and b->'tests'='["Fictional lab A"]'::jsonb and b->>'channel'='portal'
 from cs_rows,jsonb_array_elements(r->'bookings')b),'Row: name, phone, tests done here, requested');
select pg_temp.cs_assert((select not(b?'answers')and not(b?'program')and not(b?'notes')from cs_rows,jsonb_array_elements(r->'bookings')b),'Row carries nothing medical beyond test names');
select pg_temp.cs_assert((select jsonb_array_length(public.clinic_schedule_bookings(pg_temp.cs_id('0a'),'upcoming',null,'confirmed')->'bookings')=0),'Status filter');
select pg_temp.cs_assert((select jsonb_array_length(public.clinic_schedule_bookings(pg_temp.cs_id('0a'),'past')->'bookings')=0),'Past scope');
select pg_temp.as_user('09');
select pg_temp.cs_assert(jsonb_array_length(public.clinic_schedule_bookings(pg_temp.cs_id('0b'))->'bookings')=0,'Clinic B does not see clinic A bookings');
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0b'),pg_temp.cmd('01','confirm',pg_temp.cs_id('31'),0))->>'status'='invalid','Clinic B cannot act on a clinic A booking');
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('02','confirm',pg_temp.cs_id('31'),0))->>'status'='access','Clinic B user cannot act as clinic A');
select pg_temp.as_user('01');
select pg_temp.cs_reject($q$select public.clinic_schedule_bookings(pg_temp.cs_id('0a'))$q$,'42501');

-- 7. Staff confirms; replay returns the saved result; a reused submission with other input conflicts.
select pg_temp.as_user('07');
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('03','confirm',pg_temp.cs_id('31'),1))->>'status'='stale','Wrong revision is stale');
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('04','confirm',pg_temp.cs_id('31'),0))#>>'{booking,status}'='confirmed','Staff confirms');
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('04','confirm',pg_temp.cs_id('31'),0))#>>'{booking,status}'='confirmed','Replay returns the saved result');
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('04','decline',pg_temp.cs_id('31'),0,'{"reason":"Fictional reason"}'))->>'status'='conflict','Reused submission conflicts');
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('05','confirm',pg_temp.cs_id('31'),0))->>'status'='stale','Confirming twice is stale');
reset role;
select pg_temp.cs_assert((select status='confirmed'and current_arrangement->>'offerId'=(select offer_id::text from cs_slot where n=1)from public.booking_appointments where id=pg_temp.cs_id('31')),'Visit is confirmed at the requested time');
select pg_temp.cs_assert((select state='accepted'from public.booking_scheduling_notices where id=pg_temp.cs_id('31')),'Notice accepted by the clinic');
select pg_temp.cs_assert(exists(select 1 from public.clinic_portal_audit where kind='booking-confirmed'and detail->>'appointmentId'=pg_temp.cs_id('31')::text and detail->>'role'='staff'),'Confirmation audited with role');

-- 8. Propose another time; the member's Telegram notice is queued; the booking does not move.
insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation)values(pg_temp.cs_id('01'),'member','fictional-principal-01','fictional-account-01','+3749900015','5550001',1);
select pg_temp.as_user('07');
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('06','propose',pg_temp.cs_id('31'),0,jsonb_build_object('slotKey',(select key from cs_slot where n=1),'note',null)))->>'status'='invalid','Cannot propose the same slot');
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('07','propose',pg_temp.cs_id('31'),0,jsonb_build_object('slotKey',(select key from cs_slot where n=2),'note','Fictional: the room is busy')))#>>'{booking,proposal,note}'='Fictional: the room is busy','Staff proposes another time');
reset role;
select pg_temp.cs_assert((select telegram_message_id is not null from public.clinic_booking_proposals where id=pg_temp.sub_id('07')),'Member Telegram notice queued');
select pg_temp.cs_assert((select template_id='booking.clinic_proposal'from public.telegram_auth_messages m join public.clinic_booking_proposals p on p.telegram_message_id=m.id where p.id=pg_temp.sub_id('07')),'Through the auth outbox template');
select pg_temp.cs_assert((select current_arrangement->>'offerId'=(select offer_id::text from cs_slot where n=1)and revision=0 from public.booking_appointments where id=pg_temp.cs_id('31')),'A proposal never moves the booking');
select pg_temp.as_user('01');
set local role authenticated;
select pg_temp.cs_assert(public.booking_portal_details()#>>array['appointments',pg_temp.cs_id('31')::text,'proposal','id']=pg_temp.sub_id('07')::text,'Member sees the proposal');
reset role;
select pg_temp.as_user('02');
set local role authenticated;
select pg_temp.cs_reject($q$select public.booking_portal_details(pg_temp.cs_id('01'))$q$,'42501');
reset role;

-- 9. Member accepts: the visit moves at once; old hold released; staff cannot accept for them.
-- B1-3: once the member's requirements changed, the proposal is not accepted on the old programme.
savepoint b13;
update public.patient_assessments set completed_at=now()-interval '1 minute' where user_id=pg_temp.cs_id('01');
select pg_temp.cs_assert((select program->>'requirementsToken'from cs where member=pg_temp.cs_id('01'))is distinct from public.patient_test_context(pg_temp.cs_id('01'))->>'requirementsToken','Requirements changed');
set local role service_role;
select pg_temp.cs_reject_message($q$select public.booking_portal_proposal_answer(pg_temp.cs_id('4f'),pg_temp.cs_id('01'),pg_temp.cs_id('01'),pg_temp.sub_id('07'),true)$q$,'40001','Booking program changed');
reset role;
rollback to savepoint b13;
set local role service_role;
select pg_temp.cs_reject($q$select public.booking_portal_proposal_answer(pg_temp.cs_id('41'),pg_temp.cs_id('02'),pg_temp.cs_id('02'),pg_temp.sub_id('07'),true)$q$,'42501');
reset role;
update public.member_notice_settings set booking=true,throttle_seconds=0,hourly_cap=60;
set local role service_role;
select pg_temp.cs_assert(public.booking_portal_proposal_answer(pg_temp.cs_id('42'),pg_temp.cs_id('01'),pg_temp.cs_id('01'),pg_temp.sub_id('07'),true)->>'status'='confirmed','Accepted proposal is confirmed');
select pg_temp.cs_assert(public.booking_portal_proposal_answer(pg_temp.cs_id('42'),pg_temp.cs_id('01'),pg_temp.cs_id('01'),pg_temp.sub_id('07'),true)->>'revision'='1','Answer replay');
reset role;
select pg_temp.cs_assert((select count(*)=1 and bool_and(n.params=public._member_notice_visit(n.member_id,p.starts_at,null,c.name)) from public.member_notices n join public.clinic_booking_proposals p on p.id=pg_temp.sub_id('07') join public.workspace_clinics c on c.id=p.clinic_id where n.member_id=pg_temp.cs_id('01') and n.template_id='member.booking_confirmed'),'A member accepting a proposal is told the accepted time and clinic, once');
update public.member_notice_settings set booking=false;
set local role service_role;
select pg_temp.cs_reject($q$select public.booking_portal_proposal_answer(pg_temp.cs_id('43'),pg_temp.cs_id('01'),pg_temp.cs_id('01'),pg_temp.sub_id('07'),true)$q$,'40001');
reset role;
select pg_temp.cs_assert((select current_arrangement->>'offerId'=(select offer_id::text from cs_slot where n=2)and revision=1 from public.booking_appointments where id=pg_temp.cs_id('31')),'Visit moved to the accepted time');
select pg_temp.cs_assert((select count(*)=1 from public.booking_manual_reservations where appointment_id=pg_temp.cs_id('31')and state='held'),'Only the new slot is held');
select pg_temp.cs_assert((select channel='portal'and state='accepted'and purpose='change'from public.booking_scheduling_notices where id=pg_temp.cs_id('42')),'Accepted proposal recorded as an accepted change');

-- 10. Another proposal, rejected by the member: nothing changes.
select pg_temp.as_user('06');
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('08','propose',pg_temp.cs_id('31'),1,jsonb_build_object('slotKey',(select key from cs_slot where n=3),'note','')))->>'status'='saved','Admin proposes');
reset role;
set local role service_role;
select pg_temp.cs_assert(public.booking_portal_proposal_answer(pg_temp.cs_id('44'),pg_temp.cs_id('01'),pg_temp.cs_id('01'),pg_temp.sub_id('08'),false)->>'revision'='1','Declined proposal leaves the visit');
reset role;
select pg_temp.cs_assert((select state='rejected'from public.clinic_booking_proposals where id=pg_temp.sub_id('08')),'Proposal rejected');

-- 10b. WP-5 (review WP5-R2): accepting a proposal takes a new hold, so it is refused while the member
-- has an open home-visit request; nothing changes. (Inserted directly: the request fence itself is in
-- check-booking-new-visit.sql.)
select pg_temp.as_user('06');
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('0c','propose',pg_temp.cs_id('31'),1,jsonb_build_object('slotKey',(select key from cs_slot where n=3),'note','')))->>'status'='saved','Admin proposes again');
reset role;
insert into public.patient_test_requests(id,user_id,requested_terms,requirements,algorithm_version,context_token,create_payload)
 values(pg_temp.cs_id('5a'),pg_temp.cs_id('01'),'{}','[]','fictional','fictional','{}');
set local role service_role;
select pg_temp.cs_reject_message($q$select public.booking_portal_proposal_answer(pg_temp.cs_id('45'),pg_temp.cs_id('01'),pg_temp.cs_id('01'),pg_temp.sub_id('0c'),true)$q$,'40001','Reconcile the existing historical request first');
reset role;
select pg_temp.cs_assert((select revision=1 and current_arrangement->>'offerId'=(select offer_id::text from cs_slot where n=2)from public.booking_appointments where id=pg_temp.cs_id('31')),'Refused acceptance leaves the visit unchanged');
select pg_temp.cs_assert(not exists(select 1 from public.booking_manual_reservations where id=pg_temp.cs_id('45')),'No reservation left behind');
delete from public.patient_test_requests where id=pg_temp.cs_id('5a');
set local role service_role;
select pg_temp.cs_assert(public.booking_portal_proposal_answer(pg_temp.cs_id('46'),pg_temp.cs_id('01'),pg_temp.cs_id('01'),pg_temp.sub_id('0c'),false)->>'revision'='1','Declined; the visit stays');
reset role;

-- 11. Check-in: refused before the visit; arrived and no-show once due.
select pg_temp.as_user('07');
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('09','check-in',pg_temp.cs_id('31'),1,'{"outcome":"no-show"}'))->>'status'='early','No-show refused before the visit');
reset role;
update public.booking_appointments set current_arrangement=jsonb_set(current_arrangement,'{startsAt}',to_jsonb(now()-interval '10 minutes'))where id=pg_temp.cs_id('31');
select pg_temp.as_user('07');
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('10','check-in',pg_temp.cs_id('31'),1,'{"outcome":"no-show"}'))#>>'{booking,status}'='no-show','No-show recorded');
-- One rendered revision records attendance once, even with a fresh submission from another tab.
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('10','check-in',pg_temp.cs_id('31'),1,'{"outcome":"no-show"}'))#>>'{booking,status}'='no-show','Same submission replays attendance');
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('e1','check-in',pg_temp.cs_id('31'),1,'{"outcome":"no-show"}'))->>'status'='stale','Another submission with the old revision is refused');
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('e2','check-in',pg_temp.cs_id('31'),1,'{"outcome":"arrived"}'))->>'status'='stale','A stale competing correction is refused');
reset role;
select pg_temp.cs_assert((select count(*)=1 from public.clinic_booking_checkins where appointment_id=pg_temp.cs_id('31')),'Exactly one attendance event before a deliberate correction');
set local role authenticated;
-- Review F2 (lead decision 18 Oct): a no-show stays open. The clinic can propose another time,
-- and the member can move or cancel the missed visit. Review F1: an arrival withdraws an open proposal,
-- no new proposal is stored for an attended visit, and an open proposal cannot move it.
reset role;
select set_config('cs.r31',(select revision::text from public.booking_appointments where id=pg_temp.cs_id('31')),true);
savepoint f2;
select pg_temp.as_user('07');
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('f1','propose',pg_temp.cs_id('31'),current_setting('cs.r31')::bigint,jsonb_build_object('slotKey',(select key from cs_slot where n=4),'note','')))->>'status'='saved','The clinic proposes another time after a no-show');
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('e4','check-in',pg_temp.cs_id('31'),current_setting('cs.r31')::bigint,'{"outcome":"no-show"}'))#>>'{booking,status}'='no-show','No-show while another time is proposed');
reset role;
select pg_temp.cs_assert((select pr.appointment_revision=a.revision from public.clinic_booking_proposals pr join public.booking_appointments a on a.id=pr.appointment_id where pr.id=pg_temp.sub_id('f1')),'No-show preserves a valid open proposal');
select set_config('cs.r31',(select revision::text from public.booking_appointments where id=pg_temp.cs_id('31')),true);
savepoint no_show_proposal;
set local role service_role;
select pg_temp.cs_assert(public.booking_portal_proposal_answer(pg_temp.cs_id('3f'),pg_temp.cs_id('01'),pg_temp.cs_id('01'),pg_temp.sub_id('f1'),true)->>'status'='confirmed','Member can accept the proposal after a no-show');
reset role;
rollback to savepoint no_show_proposal;
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('f2','check-in',pg_temp.cs_id('31'),current_setting('cs.r31')::bigint,'{"outcome":"arrived"}'))#>>'{booking,status}'='arrived','Arrival recorded while a proposal is open');
reset role;
select set_config('cs.r31',(select revision::text from public.booking_appointments where id=pg_temp.cs_id('31')),true);
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('f3','propose',pg_temp.cs_id('31'),current_setting('cs.r31')::bigint,jsonb_build_object('slotKey',(select key from cs_slot where n=5),'note','')))->>'status'='unavailable','No proposal for an attended visit');
reset role;
select pg_temp.cs_assert((select state='withdrawn'from public.clinic_booking_proposals where id=pg_temp.sub_id('f1'))
 and not exists(select 1 from public.clinic_booking_proposals where id=pg_temp.sub_id('f3')),'Arrival withdrew the open proposal and no new one was stored');
-- Even a proposal left open (guard trigger off, as if it slipped through) cannot move an attended visit.
alter table public.clinic_booking_proposals disable trigger clinic_booking_proposals_attended_guard;
update public.clinic_booking_proposals set state='open',decided_at=null,decided_by=null,appointment_revision=(select revision from public.booking_appointments where id=pg_temp.cs_id('31')) where id=pg_temp.sub_id('f1');
set local role service_role;
select pg_temp.cs_reject_message($q$select public.booking_portal_proposal_answer(pg_temp.cs_id('3c'),pg_temp.cs_id('01'),pg_temp.cs_id('01'),pg_temp.sub_id('f1'),true)$q$,'40001','The clinic has recorded this visit');
reset role;
rollback to savepoint f2;
savepoint f2b;
set local role service_role;
select pg_temp.cs_assert(public.select_booking_appointment(pg_temp.cs_id('3d'),member,member,seal,(select offer_id from cs_slot where n=4),(select version from cs_slot where n=4),p_appointment_id=>pg_temp.cs_id('31'),p_revision=>current_setting('cs.r31')::bigint)->>'status'='notification-pending','After a no-show the member moves the visit')from cs where member=pg_temp.cs_id('01');
reset role;
rollback to savepoint f2b;
savepoint f2c;
set local role service_role;
select pg_temp.cs_assert(public.booking_portal_cancel(pg_temp.cs_id('3e'),pg_temp.cs_id('01'),pg_temp.cs_id('01'),pg_temp.cs_id('31'),current_setting('cs.r31')::bigint)->>'status'='cancelled','After a no-show the member cancels the missed visit');
reset role;
rollback to savepoint f2c;
select pg_temp.as_user('07');
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('11','check-in',pg_temp.cs_id('31'),current_setting('cs.r31')::bigint,'{"outcome":"arrived"}'))#>>'{booking,status}'='arrived','Correction to arrived');
reset role;
savepoint attendance_correction;
select set_config('cs.r31',(select revision::text from public.booking_appointments where id=pg_temp.cs_id('31')),true);
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('e3','check-in',pg_temp.cs_id('31'),current_setting('cs.r31')::bigint,'{"outcome":"no-show"}'))#>>'{booking,status}'='no-show','Fresh arrived-to-no-show correction is allowed');
reset role;
rollback to savepoint attendance_correction;
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('12','check-in',pg_temp.cs_id('31'),1,'{"outcome":"late"}'))->>'status'='invalid','Unknown outcome is invalid');
reset role;
select pg_temp.as_user('01');
set local role authenticated;
select pg_temp.cs_assert(public.booking_portal_details()#>>array['appointments',pg_temp.cs_id('31')::text,'checkin','outcome']='arrived','Member and staff see the check-in');
reset role;
select pg_temp.cs_reject($q$update public.clinic_booking_checkins set outcome='no-show'$q$,'55000');
-- QA F-03: once the clinic recorded the visit, the member (or staff for them) can no longer cancel or move it.
select set_config('cs.r31',(select revision::text from public.booking_appointments where id=pg_temp.cs_id('31')),true);
set local role service_role;
select pg_temp.cs_reject_message($q$select public.booking_portal_cancel(pg_temp.cs_id('3a'),pg_temp.cs_id('01'),pg_temp.cs_id('01'),pg_temp.cs_id('31'),current_setting('cs.r31')::bigint)$q$,'40001','The clinic has recorded this visit');
select pg_temp.cs_reject_message($q$select public.select_booking_appointment(pg_temp.cs_id('3b'),member,member,seal,(select offer_id from cs_slot where n=1),(select version from cs_slot where n=1),p_appointment_id=>pg_temp.cs_id('31'),p_revision=>current_setting('cs.r31')::bigint)from cs where member=pg_temp.cs_id('01')$q$,'40001','The clinic has recorded this visit');
reset role;
select pg_temp.cs_assert((select status='confirmed'and current_reservation_id is not null from public.booking_appointments where id=pg_temp.cs_id('31'))
 and not exists(select 1 from public.booking_appointment_commands where id in(pg_temp.cs_id('3a'),pg_temp.cs_id('3b'))),'A checked-in visit stays booked and no command is recorded');

-- 12. Decline with a reason; the member can book again; the member withdraws a pending request.
set local role service_role;
select public.select_booking_appointment(pg_temp.cs_id('51'),member,member,seal,(select offer_id from cs_slot where n=4),(select version from cs_slot where n=4))from cs where member=pg_temp.cs_id('02');
reset role;
select pg_temp.as_user('07');
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('13','decline',pg_temp.cs_id('51'),0,'{"reason":"x"}'))->>'status'='invalid','A reason is required');
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('14','decline',pg_temp.cs_id('51'),0,'{"reason":"Fictional: equipment out of service"}'))#>>'{booking,status}'='declined','Staff declines');
select pg_temp.cs_assert((select b->'memberPhone'='null'::jsonb and b#>>'{decline,reason}'='Fictional: equipment out of service' from jsonb_array_elements(public.clinic_schedule_bookings(pg_temp.cs_id('0a'),'upcoming',null,'declined')->'bookings')b),'Declined row keeps the reason and drops the phone');
reset role;
select pg_temp.cs_assert((select status='cancelled'from public.booking_appointments where id=pg_temp.cs_id('51'))and not exists(select 1 from public.booking_manual_reservations where appointment_id=pg_temp.cs_id('51')and state='held'),'Declined request releases its hold');
select pg_temp.as_user('02');
set local role authenticated;
select pg_temp.cs_assert(public.booking_portal_details()#>>array['appointments',pg_temp.cs_id('51')::text,'decline','reason']='Fictional: equipment out of service','Member sees the reason');
reset role;
set local role service_role;
select pg_temp.cs_assert(public.select_booking_appointment(pg_temp.cs_id('52'),member,member,seal,(select offer_id from cs_slot where n=5),(select version from cs_slot where n=5),p_appointment_id=>pg_temp.cs_id('51'),p_revision=>0)->>'status'='notification-pending','Member books again after a decline')from cs where member=pg_temp.cs_id('02');
select pg_temp.cs_reject($q$select public.booking_portal_cancel(pg_temp.cs_id('53'),pg_temp.cs_id('02'),pg_temp.cs_id('02'),pg_temp.cs_id('51'),0)$q$,'40001');
select pg_temp.cs_assert(public.booking_portal_cancel(pg_temp.cs_id('54'),pg_temp.cs_id('02'),pg_temp.cs_id('02'),pg_temp.cs_id('51'),1)->>'status'='cancelled','Member withdraws a pending request');
reset role;
select pg_temp.cs_assert((select state='superseded'from public.booking_scheduling_notices where id=pg_temp.cs_id('52')),'The withdrawn request is superseded');
select pg_temp.as_user('07');
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('15','confirm',pg_temp.cs_id('51'),2))->>'status'='stale','A withdrawn request cannot be confirmed');
select pg_temp.cs_assert((select b->>'status'='cancelled'from jsonb_array_elements(public.clinic_schedule_bookings(pg_temp.cs_id('0a'))->'bookings')b where b->>'appointmentId'=pg_temp.cs_id('51')::text),'Clinic sees the cancellation');
reset role;

-- 13. Hours change: future free slots outside the new hours close; held slots keep their place.
set local role service_role;
select public.select_booking_appointment(pg_temp.cs_id('61'),member,member,seal,(select offer_id from cs_slot where n=6),(select version from cs_slot where n=6),p_appointment_id=>pg_temp.cs_id('51'),p_revision=>2)from cs where member=pg_temp.cs_id('02');
reset role;
select pg_temp.as_user('06');
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_settings_save(pg_temp.cs_id('0a'),pg_temp.settings(1,true,2,pg_temp.week('10:00','11:00')))->>'status'='saved','Admin narrows the hours');
reset role;
select pg_temp.cs_assert((select bool_and(((starts_at at time zone 'Asia/Yerevan')::time)between '10:00'and '10:30')from public.booking_manual_capacity
 where clinic_id=pg_temp.cs_id('0a')and source='clinic-hours'and valid_until>clock_timestamp()and starts_at>now()and key not in(select capacity_key from public.booking_manual_reservations where state='held')),'Only slots in the new hours stay open');
select pg_temp.cs_assert((select bool_and(capacity=2)from public.booking_manual_capacity where clinic_id=pg_temp.cs_id('0a')and source='clinic-hours'and valid_until>clock_timestamp()and starts_at>now()),'Capacity follows the hours');
select pg_temp.cs_assert((select state='held'from public.booking_manual_reservations where id=pg_temp.cs_id('61')),'A held visit keeps its place');
select pg_temp.as_user('07');
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_command(pg_temp.cs_id('0a'),pg_temp.cmd('16','confirm',pg_temp.cs_id('51'),3))#>>'{booking,status}'='confirmed','A request outside the new hours can still be confirmed');
reset role;

-- 14. Team: the admin sets roles and access, never for themselves, and keeps one active admin.
create temp table cs_mem as select user_id,id from public.clinic_portal_memberships where clinic_id in(pg_temp.cs_id('0a'),pg_temp.cs_id('0b'));
grant select on cs_mem to authenticated;
select pg_temp.as_user('06');
set local role authenticated;
select pg_temp.cs_assert(jsonb_array_length(public.clinic_schedule_team(pg_temp.cs_id('0a'))->'members')=3,'Team lists clinic A only');
select pg_temp.cs_assert(public.clinic_schedule_team_command(pg_temp.cs_id('0a'),jsonb_build_object('membershipId',(select id from cs_mem where user_id=pg_temp.cs_id('06')),'expectedRevision',1,'role','staff','active',true))->>'status'='self','Cannot change yourself');
select pg_temp.cs_assert(public.clinic_schedule_team_command(pg_temp.cs_id('0a'),jsonb_build_object('membershipId',(select id from cs_mem where user_id=pg_temp.cs_id('09')),'expectedRevision',1,'role','staff','active',true))->>'status'='invalid','Cannot change another clinic''s member');
select pg_temp.cs_assert(public.clinic_schedule_team_command(pg_temp.cs_id('0a'),jsonb_build_object('membershipId',(select id from cs_mem where user_id=pg_temp.cs_id('07')),'expectedRevision',1,'role','admin','active',true))->>'status'='saved','Promote staff');
select pg_temp.cs_assert(public.clinic_schedule_team_command(pg_temp.cs_id('0a'),jsonb_build_object('membershipId',(select id from cs_mem where user_id=pg_temp.cs_id('08')),'expectedRevision',1,'role','admin','active',false))->>'status'='saved','Switch off a second admin');
reset role;
update public.clinic_portal_memberships set role='staff' where user_id=pg_temp.cs_id('07');
select pg_temp.as_user('06');
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_team_command(pg_temp.cs_id('0a'),jsonb_build_object('membershipId',(select id from cs_mem where user_id=pg_temp.cs_id('08')),'expectedRevision',2,'role','admin','active',true))->>'status'='noreon-only','Switching access back on is Noreon''s (F-04)');
reset role;
select pg_temp.cs_assert(exists(select 1 from public.clinic_portal_audit where kind='team-member-updated'and clinic_id=pg_temp.cs_id('0a')),'Team changes are audited');
-- A switched-off member loses access.
update public.clinic_portal_memberships set active=false where user_id=pg_temp.cs_id('07');
select pg_temp.as_user('07');
set local role authenticated;
select pg_temp.cs_reject($q$select public.clinic_schedule_bookings(pg_temp.cs_id('0a'))$q$,'42501');
reset role;

-- 14b. A visit-length change: new slots overlapping a held visit lose that capacity (F-06).
select pg_temp.as_user('06');
set local role authenticated;
select pg_temp.cs_assert(public.clinic_schedule_settings_save(pg_temp.cs_id('0a'),pg_temp.settings(2,true,2,pg_temp.week('09:00','12:00'))||'{"slotMinutes":20}')->>'status'='saved','Admin changes the visit length');
reset role;
select pg_temp.cs_assert((select bool_and(p.capacity=1)and count(*)=2 from public.booking_manual_capacity p,public.booking_manual_capacity held
 where held.key=(select key from cs_slot where n=2)and p.clinic_id=pg_temp.cs_id('0a')and p.source='clinic-hours'and p.key<>held.key and p.valid_until>clock_timestamp()
 and p.starts_at<held.ends_at and p.ends_at>held.starts_at),'Two 20-minute slots overlap the held 30-minute visit and keep one place each');
-- 15. Channel guards and the switch closing generated slots to members.
select pg_temp.cs_reject($q$update public.booking_scheduling_notices set state='declined'where channel='email'and false or id=(select id from public.booking_scheduling_notices where channel='portal'and state='accepted'limit 1)$q$,'22023');
update public.clinic_scheduling_capabilities set enabled=false;
set local role service_role;
select pg_temp.cs_assert((select not exists(select 1 from jsonb_array_elements(public.booking_pilot_offers(member,member,seal))o where o->'offer'->>'source'='clinic-hours')from cs where member=pg_temp.cs_id('01')),'Switch off hides generated slots');
select pg_temp.cs_assert(public.clinic_schedule_top_up()=0,'Switch off stops generation');
reset role;

rollback;
\echo 'clinic portal scheduling: all checks passed'
