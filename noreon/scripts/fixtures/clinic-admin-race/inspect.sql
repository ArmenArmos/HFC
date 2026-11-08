select application_name,state,wait_event_type,wait_event from pg_stat_activity where application_name in('clinic-admin-c462-a','clinic-admin-c462-b') order by application_name;
select count(*) as memberships from public.clinic_portal_memberships where clinic_id='c4620000-0000-4000-8000-000000000021';
select actor_id,submission_id,state from public.clinic_admin_commands where actor_id='c4620000-0000-4000-8000-000000000001' order by submission_id;
select kind,detail from public.clinic_portal_audit where clinic_id='c4620000-0000-4000-8000-000000000021' order by id;
