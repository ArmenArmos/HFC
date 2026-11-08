-- Owned synthetic database/CI only; fixture and all probes roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.search_actor(id uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated','session_id',id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
end$$;
create function pg_temp.search_reject(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected search rejection %',expected;
end$$;
do $$declare c uuid:=gen_random_uuid();other_c uuid:=gen_random_uuid();a uuid:=gen_random_uuid();d uuid:=gen_random_uuid();n uuid:=gen_random_uuid();other_d uuid:=gen_random_uuid();m uuid:=gen_random_uuid();u uuid;i int;begin
 perform set_config('test.search_admin',a::text,true);perform set_config('test.search_doctor',d::text,true);perform set_config('test.search_nurse',n::text,true);perform set_config('test.search_other',other_d::text,true);perform set_config('test.search_member',m::text,true);perform set_config('test.search_clinic',c::text,true);
 insert into public.workspace_clinics(id,name)values(c,'Synthetic search clinic'),(other_c,'Synthetic other search clinic');
 foreach u in array array[a,d,n,other_d,m]loop
  insert into auth.users(id,email)values(u,u||'@example.invalid');
  insert into auth.sessions(id,user_id,created_at,updated_at)values(u,u,clock_timestamp(),clock_timestamp());
 end loop;
 insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(a,'admin','Search admin',null),(d,'doctor','Search doctor',c),(n,'nurse','Search nurse',c),(other_d,'doctor','Other search doctor',other_c);
 for i in 1..205 loop
  u:=('a1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  insert into auth.users(id,email,phone,phone_confirmed_at)values(u,u||'@example.invalid',case when i in(204,205)then '37499000'||i::text else null end,case when i=205 then now() else null end);
  insert into public.profiles(id,display_name,birth_date)values(u,case when i=205 then 'ԱՐՄԵՆ Late 50%_ literal' when i=203 then null else 'Common synthetic '||i::text end,case when i=205 then date '1980-05-12' else null end)on conflict(id)do update set display_name=excluded.display_name,birth_date=excluded.birth_date;
  insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id,created_at)values(u,d,n,'2026-01-01T00:00:00Z');
 end loop;
 u:=gen_random_uuid();perform set_config('test.search_hidden',u::text,true);
 insert into auth.users(id,email,phone,phone_confirmed_at)values(u,u||'@example.invalid','37499123456',now());
 insert into public.profiles(id,display_name)values(u,'Hidden unique member')on conflict(id)do update set display_name=excluded.display_name;
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id,created_at)values(u,other_d,'2026-01-01T00:00:00Z');
end$$;
-- Inspect audit metadata as the test owner while the search itself runs as authenticated.
create function pg_temp.search_audits() returns table(id bigint,member_id uuid)
language sql security definer set search_path='' as $$
 select a.id,a.member_id from public.access_audit a
 where a.actor_id=auth.uid() and a.surface='member_search' and a.object_id='page'
$$;
create function pg_temp.audited_search(q text,after_at timestamptz default null,after_id uuid default null,include_birth_year boolean default false)
returns jsonb language plpgsql as $$
declare before_id bigint;result jsonb;
begin
 select coalesce(max(id),0) into before_id from pg_temp.search_audits();
 result:=case when include_birth_year then public.patient_clinical_case_search_identity(q,after_at,after_id) else public.patient_clinical_case_search(q,after_at,after_id) end;
 if (select count(*) from pg_temp.search_audits() where id>before_id)<>jsonb_array_length(result->'rows')
 or exists(select 1 from jsonb_array_elements(result->'rows') r
  where (select count(*) from pg_temp.search_audits() a where a.id>before_id and a.member_id=(r->>'id')::uuid)<>1)
 then raise exception 'Every returned member must have exactly one audit row in this search';end if;
 return result;
end$$;
set local role authenticated;
select pg_temp.search_actor(current_setting('test.search_doctor')::uuid);
-- Both selection entry points opt in; old clients keep their strict DTO.
do $$declare actor uuid;old_page jsonb;new_page jsonb;stripped jsonb;begin
 foreach actor in array array[current_setting('test.search_doctor')::uuid,current_setting('test.search_nurse')::uuid] loop
  perform pg_temp.search_actor(actor);
  old_page:=pg_temp.audited_search('Late');new_page:=pg_temp.audited_search('Late',null,null,true);
  if old_page#>'{rows,0,birthYear}' is not null or new_page#>>'{rows,0,birthYear}' is distinct from '1980' then raise exception 'Birth year opt-in contract failed';end if;
  old_page:=pg_temp.audited_search('');new_page:=pg_temp.audited_search('',null,null,true);
  select jsonb_agg(r.value-array['birthYear','birthDate','phoneLast4'] order by r.ordinality) into stripped from jsonb_array_elements(new_page->'rows')with ordinality r(value,ordinality);
  if stripped is distinct from old_page->'rows' or new_page->'nextCursor' is distinct from old_page->'nextCursor' or new_page->'hasMore' is distinct from old_page->'hasMore' then raise exception 'Identity enrichment changed search order or paging';end if;
  if new_page#>'{rows,0,birthYear}' is distinct from 'null'::jsonb then raise exception 'Unknown birth year must remain null';end if;
  if public.patient_clinical_case_search_identity('Hidden')->'rows'<>'[]'::jsonb then raise exception 'Identity search leaked an unassigned member';end if;
 end loop;
 perform pg_temp.search_actor(current_setting('test.search_doctor')::uuid);
end$$;

do $$declare r jsonb;seen uuid[]:='{}';boundary jsonb:=null;item jsonb;rounds int:=0;begin
 r:=pg_temp.audited_search('Late');
 if jsonb_array_length(r->'rows')<>1 or r#>>'{rows,0,id}'<>'a1000000-0000-4000-8000-000000000205' then raise exception 'Search did not find member beyond200';end if;
 if public.patient_clinical_case_search('50%_')->'rows'<>r->'rows' then raise exception 'Wildcard characters must match literally';end if;
 if public.patient_clinical_case_search('50__')->'rows'<>'[]'::jsonb then raise exception 'Underscore wildcard leaked';end if;
 if jsonb_array_length(public.patient_clinical_case_search('արմեն')->'rows')<>1 then raise exception 'Armenian case-insensitive name match failed';end if;
 if jsonb_array_length(public.patient_clinical_case_search('+374 (99) 000-205')->'rows')<>1 then raise exception 'Formatted verified phone failed';end if;
 if public.patient_clinical_case_search('00204')->'rows'<>'[]'::jsonb then raise exception 'Unverified phone matched';end if;
 if public.patient_clinical_case_search('099000205')->'rows'<>public.patient_clinical_case_search('+374 (99) 000-205')->'rows' then raise exception 'Full national phone must match its international form';end if;
 if public.patient_clinical_case_search('099000204')->'rows'<>'[]'::jsonb then raise exception 'Unverified national phone matched';end if;
 if jsonb_array_length(public.patient_clinical_case_search('0205')->'rows')<>1 then raise exception 'Approved four-digit partial search changed';end if;
 if public.patient_clinical_case_search('123456')->'rows'<>'[]'::jsonb or public.patient_clinical_case_search('Hidden')->'rows'<>'[]'::jsonb then raise exception 'Cross-scope match leaked';end if;
 loop
  r:=pg_temp.audited_search('',(boundary->>'createdAt')::timestamptz,(boundary->>'id')::uuid);rounds:=rounds+1;
  if jsonb_array_length(r->'rows')>50 then raise exception 'Page exceeds50';end if;
  for item in select value from jsonb_array_elements(r->'rows')loop
   if item->>'doctorId' is distinct from current_setting('test.search_doctor') then raise exception 'Unassigned member returned';end if;
   if (item->>'id')::uuid=any(seen)then raise exception 'Duplicate across tied keyset pages';end if;
   if item ? 'phone' or item ? 'phone_confirmed_at' then raise exception 'Phone data leaked in DTO';end if;
   seen:=array_append(seen,(item->>'id')::uuid);
  end loop;
  exit when not(r->>'hasMore')::boolean;
  boundary:=r->'nextCursor';
  if boundary->>'id' is distinct from r#>>array['rows',(jsonb_array_length(r->'rows')-1)::text,'id'] then raise exception 'Wrong cursor boundary';end if;
  if rounds>6 then raise exception 'Pagination did not terminate';end if;
 end loop;
 if cardinality(seen)<>205 or rounds<>5 or r->'nextCursor'<>'null'::jsonb then raise exception 'Incomplete tied pagination';end if;
end$$;
select pg_temp.search_reject('select public.patient_clinical_case_search(''123'')','22023');
select pg_temp.search_reject('select public.patient_clinical_case_search(''a'')','22023');
select pg_temp.search_reject('select public.patient_clinical_case_search(null)','22023');
select pg_temp.search_reject('select public.patient_clinical_case_search(E''John\nSmith'')','22023');
select pg_temp.search_reject('select public.patient_clinical_case_search(repeat(''x'',101))','22023');
select pg_temp.search_reject('select public.patient_clinical_case_search('''',now(),null)','22023');
select pg_temp.search_reject('select public.patient_clinical_case_search('''',''infinity'',''a1000000-0000-4000-8000-000000000050'')','22023');
select pg_temp.search_actor(current_setting('test.search_nurse')::uuid);
do $$begin if jsonb_array_length(pg_temp.audited_search('Late')->'rows')<>1 or pg_temp.audited_search('Hidden')->'rows'<>'[]'::jsonb then raise exception 'Nurse scope incorrect';end if;end$$;
select pg_temp.search_actor(current_setting('test.search_other')::uuid);
do $$begin if public.patient_clinical_case_search('Late')->'rows'<>'[]'::jsonb or jsonb_array_length(public.patient_clinical_case_search('123456')->'rows')<>1 then raise exception 'Other doctor scope incorrect';end if;end$$;
select pg_temp.search_actor(current_setting('test.search_admin')::uuid);
do $$begin if jsonb_array_length(public.patient_clinical_case_search('Hidden')->'rows')<>1 then raise exception 'Admin current scope broken';end if;end$$;
select pg_temp.search_actor(current_setting('test.search_member')::uuid);
select pg_temp.search_reject('select public.patient_clinical_case_search('''')','42501');
reset role;
-- DW-01: an audit failure refuses first load, search and paging. Even earlier audit inserts roll back.
create function pg_temp.fail_search_audit() returns trigger language plpgsql as $$begin
 if new.surface='member_search' and new.member_id in
 ('a1000000-0000-4000-8000-000000000002'::uuid,'a1000000-0000-4000-8000-000000000205'::uuid)
 then raise insufficient_privilege using message='Synthetic audit failure';end if;
 return new;
end$$;
create trigger search_audit_failure before insert on public.access_audit
 for each row execute function pg_temp.fail_search_audit();
set local role authenticated;
select pg_temp.search_actor(current_setting('test.search_doctor')::uuid);
do $$declare before_id bigint;begin
 select coalesce(max(id),0) into before_id from pg_temp.search_audits();
 perform pg_temp.search_reject($q$select public.patient_clinical_case_search('')$q$,'42501');
  perform pg_temp.search_reject($q$select public.patient_clinical_case_search_identity('')$q$,'42501');
 perform pg_temp.search_reject($q$select public.patient_clinical_case_search('Late')$q$,'42501');
 perform pg_temp.search_reject($q$select public.patient_clinical_case_search('',
  '2026-01-01T00:00:00Z','a1000000-0000-4000-8000-000000000200')$q$,'42501');
 if exists(select 1 from pg_temp.search_audits() where id>before_id)
 then raise exception 'Failed search left partial audit rows';end if;
end$$;
reset role;
drop trigger search_audit_failure on public.access_audit;
-- Assignment, activity, clinic and session changes are rechecked between calls.
update public.patient_clinical_cases set assigned_nurse_id=null where user_id='a1000000-0000-4000-8000-000000000205';
set local role authenticated;
select pg_temp.search_actor(current_setting('test.search_nurse')::uuid);
do $$begin if public.patient_clinical_case_search('Late')->'rows'<>'[]'::jsonb then raise exception 'Revoked nurse assignment retained';end if;end$$;
reset role;
update public.workspace_staff set active=false where user_id=current_setting('test.search_doctor')::uuid;
set local role authenticated;
select pg_temp.search_actor(current_setting('test.search_doctor')::uuid);
select pg_temp.search_reject('select public.patient_clinical_case_search(''Late'')','42501');
reset role;
update public.workspace_staff set active=true where user_id=current_setting('test.search_doctor')::uuid;
update public.workspace_clinics set active=false where id=current_setting('test.search_clinic')::uuid;
set local role authenticated;
select pg_temp.search_reject('select public.patient_clinical_case_search(''Late'')','42501');
reset role;
update public.workspace_clinics set active=true where id=current_setting('test.search_clinic')::uuid;
delete from auth.sessions where user_id=current_setting('test.search_doctor')::uuid;
set local role authenticated;
select pg_temp.search_reject('select public.patient_clinical_case_search(''Late'')','42501');
set local role anon;
select pg_temp.search_reject('select public.patient_clinical_case_search('''')','42501');
set local role service_role;
select pg_temp.search_reject('select public.patient_clinical_case_search('''')','42501');
reset role;
rollback;
\echo 'Member search: beyond200, literals/verified phone, scope, tied paging, per-member audit and audit-failure refusal passed.'
