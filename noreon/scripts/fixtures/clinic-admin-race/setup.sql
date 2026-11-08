-- OFFLINE PREPARED ONLY. Requires explicit future exclusive DB window and visible candidate61000.
-- Never run while D3 owns Auth/Storage. This file does NOT apply migration.
begin;
do $$ begin
 if to_regprocedure('public.clinic_admin_membership_command(jsonb)') is null then raise exception 'Candidate must be visible to both connections under separate authorized staging';end if;
 if exists(select 1 from auth.users where id::text like 'c4620000%') or exists(select 1 from public.workspace_clinics where id::text like 'c4620000%') then raise exception 'Fixture namespace not empty';end if;
end $$;
insert into auth.users(id,email,email_confirmed_at,encrypted_password)values('c4620000-0000-4000-8000-000000000001','admin-c462@example.invalid',now(),'fictional-sql-role-not-login'),('c4620000-0000-4000-8000-000000000002','target-c462@example.invalid',now(),'fictional-sql-role-not-login');
insert into auth.sessions(id,user_id,created_at,updated_at)values('c4620000-0000-4000-8000-000000000011','c4620000-0000-4000-8000-000000000001',now(),now());
insert into public.workspace_staff(user_id,role,display_name)values('c4620000-0000-4000-8000-000000000001','admin','Fictional race admin c462');
insert into public.workspace_clinics(id,name)values('c4620000-0000-4000-8000-000000000021','Fictional race clinic c462');
commit;
