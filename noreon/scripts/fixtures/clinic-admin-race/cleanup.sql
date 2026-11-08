-- Exclusive fixture cleanup after BOTH sessions explicitly rollback/close; no external Storage used.
begin;
set local session_replication_role=replica;
delete from public.clinic_portal_audit where clinic_id='c4620000-0000-4000-8000-000000000021' and actor_id='c4620000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
delete from public.clinic_admin_commands where actor_id='c4620000-0000-4000-8000-000000000001';
delete from public.clinic_portal_memberships where clinic_id='c4620000-0000-4000-8000-000000000021' and user_id='c4620000-0000-4000-8000-000000000002';
delete from public.workspace_staff where user_id='c4620000-0000-4000-8000-000000000001';
delete from public.workspace_clinics where id='c4620000-0000-4000-8000-000000000021';
delete from auth.sessions where user_id in('c4620000-0000-4000-8000-000000000001','c4620000-0000-4000-8000-000000000002');
delete from public.profiles where id in('c4620000-0000-4000-8000-000000000001','c4620000-0000-4000-8000-000000000002');
delete from auth.users where id in('c4620000-0000-4000-8000-000000000001','c4620000-0000-4000-8000-000000000002');
commit;
select count(*) as remaining_owned_users from auth.users where id::text like 'c4620000%';
