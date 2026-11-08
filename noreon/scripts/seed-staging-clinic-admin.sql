-- Staging site only: gives the staging clinic admin account (made by seed-staging-accounts.mjs) its clinic membership.
-- The service role cannot write clinic_portal_memberships, so this runs with psql as the database owner. Idempotent.
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name,role,active)
select u.id,c.id,'Staging Clinic Admin','admin',true
from auth.users u,public.workspace_clinics c
where u.email='staging-clinic@example.invalid' and c.name='Staging Clinic'
on conflict(user_id,clinic_id)do update set active=true,role='admin';
select count(*) as clinic_admin_memberships from public.clinic_portal_memberships;
