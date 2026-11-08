-- QA sweep 17 Oct PM: F-01 member contact is for administrators only, and F-08 a clinic user
-- can never open another clinic. Fictional data; rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.qa_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.qa_reject(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected rejection % for %',expected,q;
end$$;
-- qa17: members 01 (phone, Telegram linked) and 02 (no phone); admin 05; doctor 06; clinic A staff 07; clinic B admin 08; clinics A 0a, B 0b.
create function pg_temp.qa_id(n text) returns uuid language sql immutable as $$select('a1700000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.qa_id(n),'role','authenticated','exp',4102444800,'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',('a1700000-0000-4000-8000-0000000001'||n)::uuid)::text,true),
  set_config('request.jwt.claim.sub',pg_temp.qa_id(n)::text,true)
$$;
grant execute on function pg_temp.qa_id(text),pg_temp.as_user(text),pg_temp.qa_assert(boolean,text),pg_temp.qa_reject(text,text) to authenticated,anon,service_role;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.qa_id(n),case when n='01'then '37499123456'end,case when n='01'then now()end from unnest(array['01','02','05','06','07','08'])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select('a1700000-0000-4000-8000-0000000001'||n)::uuid,pg_temp.qa_id(n),now(),now()from unnest(array['05','06','07','08'])n;
update public.profiles set display_name='Fictional Ani '||right(id::text,2) where id in(pg_temp.qa_id('01'),pg_temp.qa_id('02'));
insert into public.workspace_clinics(id,name,address)values(pg_temp.qa_id('0a'),'Fictional clinic A','1 Fictional Street'),(pg_temp.qa_id('0b'),'Fictional clinic B','2 Fictional Street');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.qa_id('05'),'admin','Fictional admin',null),(pg_temp.qa_id('06'),'doctor','Fictional doctor',pg_temp.qa_id('0a'));
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name,role)values(pg_temp.qa_id('07'),pg_temp.qa_id('0a'),'Fictional A staff','staff'),(pg_temp.qa_id('08'),pg_temp.qa_id('0b'),'Fictional B admin','admin');
insert into public.conversation_endpoints(member_id,adapter,account_ref,principal_ref,address,generation,active,policy_version,expires_at,max_utf16)
 values(pg_temp.qa_id('01'),'telegram','qa17-bot','qa17-principal','qa17-chat',1,true,'qa17',now()+interval '1 day',4096);
update public.clinic_scheduling_capabilities set enabled=true;

-- F-01. An administrator reads phone and Telegram link for members only.
select pg_temp.as_user('05');
set local role authenticated;
create temp table qa_contacts as select public.admin_member_contacts(array[pg_temp.qa_id('01'),pg_temp.qa_id('02'),pg_temp.qa_id('06'),pg_temp.qa_id('07'),gen_random_uuid()]) c;
select pg_temp.qa_assert((select c#>>array[pg_temp.qa_id('01')::text,'phone'] from qa_contacts)='+37499123456','Admin sees the member phone');
select pg_temp.qa_assert((select (c#>>array[pg_temp.qa_id('01')::text,'telegramLinked'])::boolean from qa_contacts),'Admin sees the Telegram link');
select pg_temp.qa_assert((select c->pg_temp.qa_id('02')::text='{"phone":null,"telegramLinked":false}'::jsonb from qa_contacts),'Member without phone or Telegram');
select pg_temp.qa_assert((select not(c ? pg_temp.qa_id('06')::text) and not(c ? pg_temp.qa_id('07')::text) from qa_contacts),'Staff and clinic accounts are never returned');
select pg_temp.qa_assert((select (select count(*) from jsonb_object_keys(c))=2 from qa_contacts),'Unknown ids are absent');
select pg_temp.qa_assert(public.admin_member_contacts(array[]::uuid[])='{}'::jsonb,'Empty list');
select pg_temp.qa_reject($q$select public.admin_member_contacts((select array_agg(gen_random_uuid()) from generate_series(1,201)))$q$,'22023');
reset role;
-- Doctor, clinic user and the member themselves are refused.
select pg_temp.as_user('06');set local role authenticated;
select pg_temp.qa_reject($q$select public.admin_member_contacts(array[pg_temp.qa_id('01')])$q$,'42501');
reset role;
select pg_temp.as_user('07');set local role authenticated;
select pg_temp.qa_reject($q$select public.admin_member_contacts(array[pg_temp.qa_id('01')])$q$,'42501');
reset role;
select pg_temp.as_user('01');set local role authenticated;
select pg_temp.qa_reject($q$select public.admin_member_contacts(array[pg_temp.qa_id('01')])$q$,'42501');
reset role;
set local role anon;
select pg_temp.qa_reject($q$select public.admin_member_contacts(array[pg_temp.qa_id('01')])$q$,'42501');
reset role;
-- A deactivated administrator is refused too.
update public.workspace_staff set active=false where user_id=pg_temp.qa_id('05');
select pg_temp.as_user('05');set local role authenticated;
select pg_temp.qa_reject($q$select public.admin_member_contacts(array[pg_temp.qa_id('01')])$q$,'42501');
reset role;

-- F-08. Clinic A staff resolve their own clinic and are refused clinic B everywhere.
select pg_temp.as_user('07');
set local role authenticated;
select pg_temp.qa_assert(public.clinic_portal_identity(null)#>>'{identity,clinicId}'=pg_temp.qa_id('0a')::text,'Own clinic resolves without a parameter');
select pg_temp.qa_reject($q$select public.clinic_portal_identity(pg_temp.qa_id('0b'))$q$,'42501');
select pg_temp.qa_reject($q$select public.clinic_schedule_bookings(pg_temp.qa_id('0b'))$q$,'42501');
select pg_temp.qa_reject($q$select public.clinic_schedule_free_slots(pg_temp.qa_id('0b'),current_date)$q$,'42501');
select pg_temp.qa_reject($q$select public.clinic_schedule_settings(pg_temp.qa_id('0b'))$q$,'42501');
select pg_temp.qa_reject($q$select public.clinic_member_search(pg_temp.qa_id('0b'),'Ani')$q$,'42501');
select pg_temp.qa_assert(public.clinic_schedule_command(pg_temp.qa_id('0b'),jsonb_build_object('version','clinic-schedule-command-v1','op','confirm','submissionId',gen_random_uuid(),'appointmentId',gen_random_uuid(),'revision',0))->>'status'='access','Command against clinic B is refused');
reset role;
-- The reverse: clinic B's admin cannot open clinic A.
select pg_temp.as_user('08');
set local role authenticated;
select pg_temp.qa_assert(public.clinic_portal_identity(null)#>>'{identity,clinicId}'=pg_temp.qa_id('0b')::text,'Clinic B resolves its own clinic');
select pg_temp.qa_reject($q$select public.clinic_portal_identity(pg_temp.qa_id('0a'))$q$,'42501');
select pg_temp.qa_reject($q$select public.clinic_schedule_bookings(pg_temp.qa_id('0a'))$q$,'42501');
select pg_temp.qa_reject($q$select public.clinic_schedule_team(pg_temp.qa_id('0a'))$q$,'42501');
reset role;
rollback;
\echo 'QA 17 Oct PM: member contact is admin-only (members only, no staff) and cross-clinic access is refused PASS'
