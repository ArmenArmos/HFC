-- Owned synthetic database/CI only. No fixture or read survives this transaction.
-- Search by date of birth: an exact-match filter inside the caller's own assigned list, in every accepted written form, never
-- beyond it; impossible dates are rejected; name and phone search are unchanged.
\set ON_ERROR_STOP on
begin;
create function pg_temp.dob_actor(id uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated','session_id',id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
end$$;
create function pg_temp.dob_reject(q text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate='22023' then return;end if;raise;end;
 raise exception 'Expected a 22023 rejection: %',q;
end$$;
do $$declare clinic uuid:=gen_random_uuid();a uuid:=gen_random_uuid();d uuid:=gen_random_uuid();n uuid:=gen_random_uuid();other_d uuid:=gen_random_uuid();
 m1 uuid:='d9000000-0000-4000-8000-000000000001';m2 uuid:='d9000000-0000-4000-8000-000000000002';m3 uuid:='d9000000-0000-4000-8000-000000000003';hidden uuid:='d9000000-0000-4000-8000-000000000004';u uuid;i int;begin
 perform set_config('test.dob_doctor',d::text,true);perform set_config('test.dob_nurse',n::text,true);perform set_config('test.dob_other',other_d::text,true);
 insert into public.workspace_clinics(id,name)values(clinic,'Synthetic birth date clinic');
 foreach u in array array[a,d,n,other_d]loop
  insert into auth.users(id,email)values(u,u||'@example.invalid');
  insert into auth.sessions(id,user_id,created_at,updated_at)values(u,u,clock_timestamp(),clock_timestamp());
 end loop;
 insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(a,'admin','Birth date admin',null),(d,'doctor','Birth date doctor',clinic),(n,'nurse','Birth date nurse',clinic),(other_d,'doctor','Other birth date doctor',clinic);
 -- m1 and m2 share a birth date and are assigned; m3 has another date; hidden shares the date but belongs to another doctor.
 insert into auth.users(id,email,phone,phone_confirmed_at)values(m1,m1||'@example.invalid','+37499210159',now()),(m2,m2||'@example.invalid',null,null),(m3,m3||'@example.invalid',null,null),(hidden,hidden||'@example.invalid',null,null);
 insert into public.profiles(id,display_name,birth_date)values(m1,'Birthdate Alpha',date '1959-01-21'),(m2,'Birthdate Beta',date '1959-01-21'),(m3,'Birthdate Gamma',date '1971-07-30'),(hidden,'Birthdate Hidden',date '1959-01-21')
  on conflict(id)do update set display_name=excluded.display_name,birth_date=excluded.birth_date;
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id,created_at)values(m1,d,n,'2026-01-01T00:00:00Z'),(m2,d,n,'2026-01-02T00:00:00Z'),(m3,d,n,'2026-01-03T00:00:00Z'),(hidden,other_d,null,'2026-01-04T00:00:00Z');

 -- 52 more assigned members share one birth date, to cross the 50 per page limit.
 for i in 1..52 loop
  u:=('d9100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  insert into auth.users(id,email)values(u,u||'@example.invalid');
  insert into public.profiles(id,display_name,birth_date)values(u,'Birthdate Page '||i,date '1990-05-05')on conflict(id)do update set display_name=excluded.display_name,birth_date=excluded.birth_date;
  insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id,created_at)values(u,d,n,'2026-02-01T00:00:00Z'::timestamptz+i*interval '1 minute');
 end loop;
end$$;
create function pg_temp.dob_audits() returns table(id bigint,member_id uuid) language sql security definer set search_path='' as $$
 select a.id,a.member_id from public.access_audit a where a.actor_id=auth.uid() and a.object_id='page' and a.surface='member_search'
$$;
set local role authenticated;
do $$declare actor uuid;form text;rows jsonb;ids text[];begin
 foreach actor in array array[current_setting('test.dob_doctor')::uuid,current_setting('test.dob_nurse')::uuid]loop
  perform pg_temp.dob_actor(actor);
  foreach form in array array['21.01.1959','21/01/1959','21-01-1959','1959-01-21',' 21.01.1959 ']loop
   rows:=public.patient_clinical_case_search(form)->'rows';
   select array_agg(r->>'id' order by r->>'id') into ids from jsonb_array_elements(rows)r;
   if ids is distinct from array['d9000000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-000000000002']then
    raise exception 'Birth date % must return exactly the two assigned members, got %',form,ids;end if;
  end loop;
  rows:=public.patient_clinical_case_search('30.07.1971')->'rows';
  if jsonb_array_length(rows)<>1 or rows#>>'{0,id}'<>'d9000000-0000-4000-8000-000000000003' then raise exception 'A second birth date returns only its member';end if;
  if public.patient_clinical_case_search('01.01.2000')->'rows'<>'[]'::jsonb then raise exception 'A date nobody has returns nothing';end if;
  -- The unassigned member with the same date is never returned, by date or by name.
  if exists(select 1 from jsonb_array_elements(public.patient_clinical_case_search('21.01.1959')->'rows')r where r->>'id'='d9000000-0000-4000-8000-000000000004')then raise exception 'Unassigned member leaked by birth date';end if;
  -- Impossible dates are rejected, never read as a name or a phone number.
  perform pg_temp.dob_reject($q$select public.patient_clinical_case_search('31.02.1959')$q$);
  perform pg_temp.dob_reject($q$select public.patient_clinical_case_search('1959-13-40')$q$);
  perform pg_temp.dob_reject($q$select public.patient_clinical_case_search('00.00.0000')$q$);
  -- Name and phone search are unchanged (the dotted digits of a date are no phone number).
  rows:=public.patient_clinical_case_search('birthdate alp')->'rows';
  if jsonb_array_length(rows)<>1 or rows#>>'{0,id}'<>'d9000000-0000-4000-8000-000000000001' then raise exception 'Name search changed';end if;
  rows:=public.patient_clinical_case_search('99 210 159')->'rows';
  if jsonb_array_length(rows)<>1 or rows#>>'{0,id}'<>'d9000000-0000-4000-8000-000000000001' then raise exception 'Phone search changed';end if;
 end loop;
 -- 51 or more matches page at 50 with a cursor, and every returned member is audited exactly once per page.
 perform pg_temp.dob_actor(current_setting('test.dob_nurse')::uuid);
 declare page1 jsonb;page2 jsonb;before_id bigint;begin
  select coalesce(max(id),0) into before_id from pg_temp.dob_audits();
  page1:=public.patient_clinical_case_search('05.05.1990');
  if jsonb_array_length(page1->'rows')<>50 or (page1->>'hasMore')<>'true' or page1->'nextCursor' is null then raise exception 'First page of 52 matches must have 50 rows, hasMore and a cursor';end if;
  if (select count(*) from pg_temp.dob_audits() where id>before_id)<>50 or exists(select 1 from jsonb_array_elements(page1->'rows')r where (select count(*) from pg_temp.dob_audits() a where a.id>before_id and a.member_id=(r->>'id')::uuid)<>1) then raise exception 'Each member of a date page must be audited exactly once';end if;
  select coalesce(max(id),0) into before_id from pg_temp.dob_audits();
  page2:=public.patient_clinical_case_search('1990-05-05',(page1#>>'{nextCursor,createdAt}')::timestamptz,(page1#>>'{nextCursor,id}')::uuid);
  if jsonb_array_length(page2->'rows')<>2 or (page2->>'hasMore')<>'false' or page2->'nextCursor'<>'null'::jsonb then raise exception 'Second page must hold the last 2 matches';end if;
  if exists(select 1 from jsonb_array_elements(page2->'rows')r where r in (select x from jsonb_array_elements(page1->'rows')x)) then raise exception 'Pages overlap';end if;
  if (select count(*) from pg_temp.dob_audits() where id>before_id)<>2 then raise exception 'The second page audits only its own members';end if;
 end;
 -- The other doctor sees only the member assigned to them, by the same date.
 perform pg_temp.dob_actor(current_setting('test.dob_other')::uuid);
 rows:=public.patient_clinical_case_search('21.01.1959')->'rows';
 if jsonb_array_length(rows)<>1 or rows#>>'{0,id}'<>'d9000000-0000-4000-8000-000000000004' then raise exception 'The other doctor sees only their own member by date';end if;
 -- The identity wrapper returns the same rows with the birth date for display.
 perform pg_temp.dob_actor(current_setting('test.dob_nurse')::uuid);
 rows:=public.patient_clinical_case_search_identity('21.01.1959')->'rows';
 if jsonb_array_length(rows)<>2 or exists(select 1 from jsonb_array_elements(rows)r where r->>'birthDate' is distinct from '1959-01-21') then raise exception 'Identity search by date returns the date for display';end if;
end$$;
rollback;
\echo 'Search by date of birth: every accepted form, assigned members only, impossible dates rejected, name and phone unchanged'
