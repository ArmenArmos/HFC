-- Owned synthetic database/CI only. No fixture or read survives this transaction.
\set ON_ERROR_STOP on
begin;
create function pg_temp.identity_actor(id uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated','session_id',id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
end$$;
create function pg_temp.identity_reject(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected identity rejection %',expected;
end$$;
do $$declare clinic uuid:=gen_random_uuid();a uuid:=gen_random_uuid();d uuid:=gen_random_uuid();n uuid:=gen_random_uuid();other_d uuid:=gen_random_uuid();hidden uuid:=gen_random_uuid();u uuid;i int;begin
 perform set_config('test.identity_admin',a::text,true);perform set_config('test.identity_doctor',d::text,true);perform set_config('test.identity_nurse',n::text,true);perform set_config('test.identity_hidden',hidden::text,true);
 insert into public.workspace_clinics(id,name)values(clinic,'Synthetic identity clinic');
 foreach u in array array[a,d,n,other_d]loop
  insert into auth.users(id,email)values(u,u||'@example.invalid');
  insert into auth.sessions(id,user_id,created_at,updated_at)values(u,u,clock_timestamp(),clock_timestamp());
 end loop;
 insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(a,'admin','Identity admin',null),(d,'doctor','Identity doctor',clinic),(n,'nurse','Identity nurse',clinic),(other_d,'doctor','Other identity doctor',clinic);
 for i in 1..52 loop
  u:=('a9000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  insert into auth.users(id,email,phone,phone_confirmed_at)values(u,u||'@example.invalid',case i when 1 then '+374 (99) 123-456' when 2 then '123' when 3 then '37499123457' else null end,case when i<>3 then now() else null end);
  insert into public.profiles(id,display_name,birth_date)values(u,'Identity duplicate',case when i=1 then date '1986-01-01' else null end)on conflict(id)do update set display_name=excluded.display_name,birth_date=excluded.birth_date;
  insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id,created_at)values(u,d,n,'2026-01-01T00:00:00Z');
 end loop;
 insert into auth.users(id,email,phone,phone_confirmed_at)values(hidden,hidden||'@example.invalid','37499123458',now());
 insert into public.profiles(id,display_name)values(hidden,'Identity hidden')on conflict(id)do update set display_name=excluded.display_name;
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values(hidden,other_d);
end$$;
create function pg_temp.identity_audits() returns table(id bigint,member_id uuid,surface text)
language sql security definer set search_path='' as $$
 select a.id,a.member_id,a.surface from public.access_audit a where a.actor_id=auth.uid() and a.object_id='page' and a.surface in ('member_search','member_identities')
$$;
create function pg_temp.identity_audit_check(rows jsonb,before_id bigint,expected_surface text) returns void language plpgsql as $$begin
 if (select count(*) from pg_temp.identity_audits() where id>before_id)<>jsonb_array_length(rows)
 or exists(select 1 from jsonb_array_elements(rows)r where (select count(*) from pg_temp.identity_audits()a where a.id>before_id and a.member_id=(r->>'id')::uuid and a.surface=expected_surface)<>1)
 then raise exception 'Identity reads must audit each returned member exactly once';end if;
end$$;
set local role authenticated;
do $$declare actor uuid;rows jsonb;old_page jsonb;new_page jsonb;stripped jsonb;boundary jsonb;before_id bigint;pages int;seen int;begin
 foreach actor in array array[current_setting('test.identity_doctor')::uuid,current_setting('test.identity_nurse')::uuid]loop
  perform pg_temp.identity_actor(actor);
  select coalesce(max(id),0) into before_id from pg_temp.identity_audits();
  rows:=public.staff_member_identities(array['a9000000-0000-4000-8000-000000000001'::uuid,current_setting('test.identity_hidden')::uuid]);
  if jsonb_array_length(rows)<>1 or rows#>>'{0,id}'<>'a9000000-0000-4000-8000-000000000001' or rows#>>'{0,birthDate}'<>'1986-01-01' or rows#>>'{0,birthYear}'<>'1986' or rows#>>'{0,phoneLast4}'<>'3456' or rows#>'{0,shortId}' is not null then raise exception 'Bulk identity or assignment scope incorrect';end if;
  perform pg_temp.identity_audit_check(rows,before_id,'member_identities');
  if public.staff_member_identities(array[current_setting('test.identity_hidden')::uuid])<>'[]'::jsonb then raise exception 'Unassigned identity leaked';end if;
  rows:=public.staff_member_identities(array['a9000000-0000-4000-8000-000000000002'::uuid,'a9000000-0000-4000-8000-000000000003'::uuid]);
  if exists(select 1 from jsonb_array_elements(rows)r where r->'phoneLast4'<>'null'::jsonb) then raise exception 'Short or unconfirmed phone leaked';end if;
  perform pg_temp.identity_reject($q$select public.staff_member_identities(array_fill('a9000000-0000-4000-8000-000000000001'::uuid,array[51]))$q$,'22023');
  perform pg_temp.identity_reject($q$select public.staff_member_identities(null)$q$,'22023');
  perform pg_temp.identity_reject($q$select public.staff_member_identities(array[null::uuid])$q$,'22023');
  if public.staff_member_identities('{}'::uuid[])<>'[]'::jsonb then raise exception 'Empty identities failed';end if;
  boundary:=null;pages:=0;seen:=0;
  loop
   select coalesce(max(id),0) into before_id from pg_temp.identity_audits();
   old_page:=public.patient_clinical_case_search('Identity duplicate',(boundary->>'createdAt')::timestamptz,(boundary->>'id')::uuid);
   perform pg_temp.identity_audit_check(old_page->'rows',before_id,'member_search');
   select coalesce(max(id),0) into before_id from pg_temp.identity_audits();
   new_page:=public.patient_clinical_case_search_identity('Identity duplicate',(boundary->>'createdAt')::timestamptz,(boundary->>'id')::uuid);
   perform pg_temp.identity_audit_check(new_page->'rows',before_id,'member_search');
   select jsonb_agg(r.value-array['birthYear','birthDate','phoneLast4'] order by r.ordinality) into stripped from jsonb_array_elements(new_page->'rows')with ordinality r(value,ordinality);
   if stripped is distinct from old_page->'rows' or new_page->'hasMore' is distinct from old_page->'hasMore' or new_page->'nextCursor' is distinct from old_page->'nextCursor' then raise exception 'Identity search changed rows, counts, order or cursor';end if;
   rows:=public.staff_member_identities(array(select (r->>'id')::uuid from jsonb_array_elements(new_page->'rows')r));
   if rows::text like '%37499123456%' or new_page::text like '%37499123456%' or rows::text like '%+374 (99) 123-456%' or new_page::text like '%+374 (99) 123-456%'
    or exists(select 1 from jsonb_array_elements(new_page->'rows')r where r?'phone' or r?'phone_confirmed_at' or (r->>'phoneLast4' is not null and r->>'phoneLast4'!~'^[0-9]{4}$')) then raise exception 'Full phone escaped the database';end if;
   if pages=0 and (new_page#>>'{rows,0,birthDate}'<>'1986-01-01' or new_page#>>'{rows,0,phoneLast4}'<>'3456') then raise exception 'Search identity fields incorrect';end if;
   pages:=pages+1;seen:=seen+jsonb_array_length(new_page->'rows');
   exit when not(new_page->>'hasMore')::boolean;
   if pages>2 then raise exception 'Paging did not terminate';end if;
   boundary:=new_page->'nextCursor';
  end loop;
  if seen<>52 or pages<>2 then raise exception 'Identity paging incomplete';end if;
 end loop;
 perform pg_temp.identity_actor(current_setting('test.identity_admin')::uuid);
 if jsonb_array_length(public.staff_member_identities(array[current_setting('test.identity_hidden')::uuid]))<>1 then raise exception 'Admin search scope changed';end if;
end$$;
reset role;
-- Assignment revocation must apply on the next read.
update public.patient_clinical_cases set assigned_nurse_id=null where user_id='a9000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.identity_actor(current_setting('test.identity_nurse')::uuid);
do $$begin if public.staff_member_identities(array['a9000000-0000-4000-8000-000000000001'::uuid])<>'[]'::jsonb then raise exception 'Revoked nurse assignment retained';end if;end$$;
reset role;
create function pg_temp.fail_identity_audit() returns trigger language plpgsql as $$begin
 if new.surface in ('member_search','member_identities') and new.member_id='a9000000-0000-4000-8000-000000000002'::uuid then raise insufficient_privilege using message='Synthetic identity audit failure';end if;
 return new;
end$$;
create trigger identity_audit_failure before insert on public.access_audit for each row execute function pg_temp.fail_identity_audit();
set local role authenticated;
select pg_temp.identity_actor(current_setting('test.identity_doctor')::uuid);
do $$declare before_id bigint;begin
 select coalesce(max(id),0) into before_id from pg_temp.identity_audits();
 perform pg_temp.identity_reject($q$select public.staff_member_identities(array['a9000000-0000-4000-8000-000000000001'::uuid,'a9000000-0000-4000-8000-000000000002'::uuid])$q$,'42501');
 perform pg_temp.identity_reject($q$select public.patient_clinical_case_search_identity('Identity duplicate')$q$,'42501');
 if exists(select 1 from pg_temp.identity_audits()where id>before_id) then raise exception 'Audit failure left partial audit rows';end if;
end$$;
set local role anon;
select pg_temp.identity_reject($q$select public.staff_member_identities('{}'::uuid[])$q$,'42501');
select pg_temp.identity_reject($q$select public.patient_clinical_case_search_identity('Identity')$q$,'42501');
set local role service_role;
select pg_temp.identity_reject($q$select public.staff_member_identities('{}'::uuid[])$q$,'42501');
select pg_temp.identity_reject($q$select public.patient_clinical_case_search_identity('Identity')$q$,'42501');
reset role;
rollback;
\echo 'Member identity: scope, privacy, cap, roles, search compatibility and atomic audit passed.'
