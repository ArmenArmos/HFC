-- Clinic portal, 18 Oct 2026: the declined-proposal flag on a booking row and the member list
-- without a search term. Proves one clinic never sees another clinic's members, bookings or
-- proposals, that the flag clears once the clinic acts, and that the list keeps the search
-- audit. Fictional data; rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ux_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.ux_reject(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected rejection % for %',expected,q;
end$$;
-- c7a0: members 01 (booked at A), 02 (booked at B), 03 (booked at A, older), 04 (never booked), 1000..1025 (26 more at A);
-- clinic A staff 06, clinic B admin 09; clinics A 0a, B 0b.
create function pg_temp.ux_id(n text) returns uuid language sql immutable as $$select('c7a00000-0000-4000-8000-'||lpad(n,12,'0'))::uuid$$;
create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ux_id(n),'role','authenticated','exp',4102444800,'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',pg_temp.ux_id('9'||n))::text,true),
  set_config('request.jwt.claim.sub',pg_temp.ux_id(n)::text,true)
$$;
grant execute on function pg_temp.ux_id(text),pg_temp.as_user(text),pg_temp.ux_assert(boolean,text),pg_temp.ux_reject(text,text) to authenticated,anon,service_role;
create temp table ux_members as select n from unnest(array['01','02','03','04'])n union all select (1000+g)::text from generate_series(0,25)g;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.ux_id(n),'37499'||lpad(n,6,'0'),now()from ux_members;
insert into auth.users(id)select pg_temp.ux_id(n)from unnest(array['06','09'])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.ux_id('9'||n),pg_temp.ux_id(n),now(),now()from unnest(array['01','06','09'])n;
update public.profiles p set display_name='Fictional '||case x.n when '01' then 'Narek' when '02' then 'Bella' when '03' then 'Nune' when '04' then 'Unknown' else 'Filler '||x.n end,birth_date='1981-02-03'
 from ux_members x where p.id=pg_temp.ux_id(x.n);
insert into public.workspace_clinics(id,name,address)values(pg_temp.ux_id('0a'),'Fictional clinic A','1 Fictional Street'),(pg_temp.ux_id('0b'),'Fictional clinic B','2 Fictional Street');
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name,role)values(pg_temp.ux_id('06'),pg_temp.ux_id('0a'),'Fictional A staff','staff'),(pg_temp.ux_id('09'),pg_temp.ux_id('0b'),'Fictional B admin','admin');
update public.clinic_scheduling_capabilities set enabled=true;

-- Bookings: one per member (not 04), confirmed for tomorrow. Appointment id = 2<member>, notice id = 3<member>.
-- Notice times set the activity order: 01 newest, then the fillers, 03 oldest.
set local session_replication_role=replica;
create temp table ux_book as select n member,case when n='02' then '0b' else '0a' end clinic,
 now()-case when n='01' then interval '1 minute' when n='03' then interval '30 days' else(n::int-999)*interval '1 hour' end noticed
 from ux_members where n<>'04';
insert into public.booking_appointments(id,member_id,program_id,requirements_token,revision,status,proposed_arrangement,proposed_reservation_id,notice_id,current_arrangement)
select pg_temp.ux_id('2'||b.member),pg_temp.ux_id(b.member),pg_temp.ux_id('5'||b.member),'r'||b.member,0,'confirmed',
 jsonb_build_object('clinicId',pg_temp.ux_id(b.clinic),'startsAt',now()+interval '1 day','endsAt',now()+interval '1 day 30 minutes','coveredTestIds','[]'::jsonb),
 pg_temp.ux_id('6'||b.member),pg_temp.ux_id('3'||b.member),
 jsonb_build_object('clinicId',pg_temp.ux_id(b.clinic),'startsAt',now()+interval '1 day','endsAt',now()+interval '1 day 30 minutes','coveredTestIds','[]'::jsonb)
from ux_book b;
insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,channel,purpose,state,created_at)
select pg_temp.ux_id('3'||b.member),pg_temp.ux_id('2'||b.member),0,pg_temp.ux_id('5'||b.member),pg_temp.ux_id('6'||b.member),pg_temp.ux_id(b.clinic),0,'portal','booking','accepted',b.noticed from ux_book b;
-- Clinic A proposed another time for member 01's booking; the member rejected it an hour ago.
insert into public.clinic_booking_proposals(id,clinic_id,appointment_id,appointment_revision,capacity_key,starts_at,ends_at,note,state,actor_id,membership_id,created_at,decided_at,decided_by)
select pg_temp.ux_id('701'),pg_temp.ux_id('0a'),pg_temp.ux_id('201'),0,'fictional-slot-a',now()+interval '2 days',now()+interval '2 days 30 minutes',null,'rejected',pg_temp.ux_id('06'),
 (select id from public.clinic_portal_memberships where user_id=pg_temp.ux_id('06')),now()-interval '2 hours',now()-interval '1 hour',pg_temp.ux_id('01');
-- Clinic B's proposal for member 02's booking was also rejected.
insert into public.clinic_booking_proposals(id,clinic_id,appointment_id,appointment_revision,capacity_key,starts_at,ends_at,note,state,actor_id,membership_id,created_at,decided_at,decided_by)
select pg_temp.ux_id('702'),pg_temp.ux_id('0b'),pg_temp.ux_id('202'),0,'fictional-slot-b',now()+interval '3 days',now()+interval '3 days 30 minutes',null,'rejected',pg_temp.ux_id('09'),
 (select id from public.clinic_portal_memberships where user_id=pg_temp.ux_id('09')),now()-interval '2 hours',now()-interval '1 hour',pg_temp.ux_id('02');
set local session_replication_role=origin;

-- 1. Declined proposal: shown to the proposing clinic only, on its own booking only.
select pg_temp.as_user('06');
set local role authenticated;
create temp table ux_a as select public.clinic_schedule_bookings(pg_temp.ux_id('0a'))b;
select pg_temp.ux_assert((select r#>>'{rejectedProposal,id}'=pg_temp.ux_id('701')::text and r#>>'{rejectedProposal,rejectedAt}'is not null and r->'proposal'='null'::jsonb
 from ux_a,jsonb_array_elements(b->'bookings')r where r->>'appointmentId'=pg_temp.ux_id('201')::text),'Clinic A sees that the member declined its proposed time');
select pg_temp.ux_assert((select count(*)=1 from ux_a,jsonb_array_elements(b->'bookings')r where r->'rejectedProposal'<>'null'::jsonb),'Only that booking is flagged at clinic A');
select pg_temp.ux_assert((select not exists(select 1 from jsonb_array_elements(b->'bookings')r where r->>'appointmentId'=pg_temp.ux_id('202')::text or r->>'memberId'=pg_temp.ux_id('02')::text)
 and b::text not like '%'||pg_temp.ux_id('702')::text||'%' from ux_a),'Clinic A never sees clinic B''s booking, member or proposal');
reset role;
select pg_temp.as_user('09');
set local role authenticated;
create temp table ux_b as select public.clinic_schedule_bookings(pg_temp.ux_id('0b'))b;
select pg_temp.ux_assert((select jsonb_array_length(b->'bookings')=1 and b#>>'{bookings,0,appointmentId}'=pg_temp.ux_id('202')::text and b#>>'{bookings,0,rejectedProposal,id}'=pg_temp.ux_id('702')::text
 and b::text not like '%'||pg_temp.ux_id('701')::text||'%' from ux_b),'Clinic B sees only its booking and its own declined proposal');
select pg_temp.ux_reject($q$select public.clinic_schedule_bookings(pg_temp.ux_id('0a'))$q$,'42501');
reset role;
-- A proposal made by another clinic on this booking (impossible through the RPCs, forced here) is never read as clinic A's.
set local session_replication_role=replica;
insert into public.clinic_booking_proposals(id,clinic_id,appointment_id,appointment_revision,capacity_key,starts_at,ends_at,state,actor_id,membership_id,created_at)
select pg_temp.ux_id('703'),pg_temp.ux_id('0b'),pg_temp.ux_id('201'),0,'fictional-slot-b',now()+interval '4 days',now()+interval '4 days 30 minutes','open',pg_temp.ux_id('09'),
 (select id from public.clinic_portal_memberships where user_id=pg_temp.ux_id('09')),now();
set local session_replication_role=origin;
select pg_temp.as_user('06');
set local role authenticated;
select pg_temp.ux_assert((select r#>>'{rejectedProposal,id}'=pg_temp.ux_id('701')::text and r->'proposal'='null'::jsonb
 from jsonb_array_elements(public.clinic_schedule_bookings(pg_temp.ux_id('0a'))->'bookings')r where r->>'appointmentId'=pg_temp.ux_id('201')::text),'Another clinic''s proposal neither hides nor replaces clinic A''s');
reset role;
delete from public.clinic_booking_proposals where id=pg_temp.ux_id('703');

-- 2. The flag clears once the clinic acts: a check-in after the rejection, a new proposal, or a changed booking.
create function pg_temp.flag() returns jsonb language sql as $$
 select r->'rejectedProposal' from jsonb_array_elements(public.clinic_schedule_bookings(pg_temp.ux_id('0a'))->'bookings')r where r->>'appointmentId'=pg_temp.ux_id('201')::text
$$;
grant execute on function pg_temp.flag() to authenticated;
savepoint acts;
set local session_replication_role=replica;
insert into public.clinic_booking_checkins(clinic_id,appointment_id,reservation_id,outcome,actor_id,membership_id)
select pg_temp.ux_id('0a'),pg_temp.ux_id('201'),pg_temp.ux_id('601'),'no-show',pg_temp.ux_id('06'),(select id from public.clinic_portal_memberships where user_id=pg_temp.ux_id('06'));
set local session_replication_role=origin;
select pg_temp.as_user('06');set local role authenticated;
select pg_temp.ux_assert(pg_temp.flag()='null'::jsonb,'A check-in after the rejection clears the flag');
reset role;
rollback to savepoint acts;
savepoint acts;
set local session_replication_role=replica;
insert into public.clinic_booking_proposals(id,clinic_id,appointment_id,appointment_revision,capacity_key,starts_at,ends_at,state,actor_id,membership_id,created_at,decided_at,decided_by)
select pg_temp.ux_id('704'),pg_temp.ux_id('0a'),pg_temp.ux_id('201'),0,'fictional-slot-a',now()+interval '5 days',now()+interval '5 days 30 minutes','withdrawn',pg_temp.ux_id('06'),
 (select id from public.clinic_portal_memberships where user_id=pg_temp.ux_id('06')),now(),now(),pg_temp.ux_id('06');
set local session_replication_role=origin;
select pg_temp.as_user('06');set local role authenticated;
select pg_temp.ux_assert(pg_temp.flag()='null'::jsonb,'A newer proposal by the clinic clears the flag');
reset role;
rollback to savepoint acts;
savepoint acts;
set local session_replication_role=replica;
update public.booking_appointments set revision=1 where id=pg_temp.ux_id('201');
set local session_replication_role=origin;
select pg_temp.as_user('06');set local role authenticated;
select pg_temp.ux_assert(pg_temp.flag()='null'::jsonb,'A booking changed since the rejection is not flagged');
reset role;
rollback to savepoint acts;
select pg_temp.as_user('06');set local role authenticated;
select pg_temp.ux_assert(pg_temp.flag()->>'id'=pg_temp.ux_id('701')::text,'Flag back after rolling back the actions');
reset role;

-- 3. Member list: every member clinic A can find, 25 per page, newest activity first; never clinic B's.
select pg_temp.as_user('06');
set local role authenticated;
create temp table ux_p1 as select public.clinic_member_search(pg_temp.ux_id('0a'),'')s;
create temp table ux_p2 as select public.clinic_member_search(pg_temp.ux_id('0a'),null,2)s;
select pg_temp.ux_assert((select s->>'version'='clinic-member-search-v2'and(s->>'total')::int=28 and(s->>'pageSize')::int=25 and jsonb_array_length(s->'members')=25 from ux_p1),'Empty query: first page of 25, total 28');
select pg_temp.ux_assert((select s#>>'{members,0,memberId}'=pg_temp.ux_id('01')::text from ux_p1),'Newest activity first');
select pg_temp.ux_assert((select(s->>'page')::int=2 and jsonb_array_length(s->'members')=3 and s#>>'{members,2,memberId}'=pg_temp.ux_id('03')::text from ux_p2),'Second page holds the rest, oldest last');
select pg_temp.ux_assert((select count(distinct m->>'memberId')=28 from(select s from ux_p1 union all select s from ux_p2)x,jsonb_array_elements(x.s->'members')m),'Pages do not overlap');
select pg_temp.ux_assert((select bool_and(m->>'memberId'not in(pg_temp.ux_id('02')::text,pg_temp.ux_id('04')::text))from(select s from ux_p1 union all select s from ux_p2)x,jsonb_array_elements(x.s->'members')m),
 'Clinic A never lists clinic B''s member or a member unknown to it');
select pg_temp.ux_assert(jsonb_array_length(public.clinic_member_search(pg_temp.ux_id('0a'),'',3)->'members')=0,'Past the last page is empty');
select pg_temp.ux_assert((select(s->>'total')::int=1 and s#>>'{members,0,memberId}'=pg_temp.ux_id('01')::text from(select public.clinic_member_search(pg_temp.ux_id('0a'),'k')s)x),
 'One letter filters by name (Narek; never Unknown, who has no booking here)');
select pg_temp.ux_assert(jsonb_array_length(public.clinic_member_search(pg_temp.ux_id('0a'),'Bella')->'members')=0,'Clinic B''s member is not found by name');
select pg_temp.ux_assert(jsonb_array_length(public.clinic_member_search(pg_temp.ux_id('0a'),'0002')->'members')=0,'Clinic B''s member is not found by phone');
select pg_temp.ux_assert(public.clinic_member_search(pg_temp.ux_id('0a'),'0001')#>>'{members,0,memberId}'=pg_temp.ux_id('01')::text,'Phone digits filter');
select pg_temp.ux_reject($q$select public.clinic_member_search(pg_temp.ux_id('0a'),'',0)$q$,'22023');
select pg_temp.ux_reject($q$select public.clinic_member_search(pg_temp.ux_id('0a'),repeat('x',101))$q$,'22023');
select pg_temp.ux_reject($q$select public.clinic_member_search(pg_temp.ux_id('0b'),'')$q$,'42501');
reset role;
select pg_temp.as_user('09');
set local role authenticated;
select pg_temp.ux_assert((select(s->>'total')::int=1 and s#>>'{members,0,memberId}'=pg_temp.ux_id('02')::text from(select public.clinic_member_search(pg_temp.ux_id('0b'),'')s)x),'Clinic B lists only its own member');
reset role;
-- The audit is unchanged: one row per list or search, with the same keys and never the text.
select pg_temp.ux_assert((select count(*)=7 from public.clinic_portal_audit where kind='member-search'and clinic_id=pg_temp.ux_id('0a')),'Each list and search is audited');
select pg_temp.ux_assert((select bool_and((select array_agg(k order by k)from jsonb_object_keys(detail)k)=array['byDigits','membershipId','results','role'])from public.clinic_portal_audit where kind='member-search'),'Audit keys unchanged');
select pg_temp.ux_assert(not exists(select 1 from public.clinic_portal_audit where kind='member-search'and(detail::text ilike '%bella%'or detail::text like '%000001%')),'Search text is not audited');

-- 4. Members and anon cannot list.
select pg_temp.as_user('01');
set local role authenticated;
select pg_temp.ux_reject($q$select public.clinic_member_search(pg_temp.ux_id('0a'),'')$q$,'42501');
reset role;
set local role anon;
select pg_temp.ux_reject($q$select public.clinic_member_search(pg_temp.ux_id('0a'),'')$q$,'42501');
reset role;
rollback;
\echo 'clinic portal ux: all checks passed'
