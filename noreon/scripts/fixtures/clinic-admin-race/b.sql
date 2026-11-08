\set VERBOSITY verbose
\set ON_ERROR_STOP off
set application_name='clinic-admin-c462-b';
begin;
set local statement_timeout='15s';
select set_config('request.jwt.claims','{"sub": "c4620000-0000-4000-8000-000000000001", "session_id": "c4620000-0000-4000-8000-000000000011", "exp": 4102444800, "role": "authenticated", "amr": [{"method": "password"}]}',true);
set local role authenticated;
select public.clinic_admin_membership_command('{"version": "clinic-admin-command-v1", "op": "grant-existing", "submissionId": "c4620000-0000-4000-8000-000000000032", "clinicId": "c4620000-0000-4000-8000-000000000021", "membershipId": "c4620000-0000-4000-8000-000000000042", "userId": "c4620000-0000-4000-8000-000000000002", "email": "target-c462@example.invalid", "displayName": "Fictional race uploader"}'::jsonb);
-- Keep this connection OPEN. Controller issues commit/rollback explicitly.
