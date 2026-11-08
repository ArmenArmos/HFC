-- Clinic admin full access (Khikar, 18 Oct 2026): clinic admins see every record of their clinic's
-- members, edit name and date of birth, and set the doctor and nurse. Switch on for prod-as-staging
-- only. Run in the Supabase SQL editor after the 20261018161307_clinic_admin_full_access migration
-- has been applied.
-- Keep this OFF for real members until legal confirms the enrolment consent covers sharing Noreon
-- medical data with partner clinics (P21; output/GO_LIVE_GATES.md). Off = no row, or false.
insert into public.clinic_portal_capabilities(singleton,clinic_admin_full_access)values(true,true)
on conflict(singleton)do update set clinic_admin_full_access=excluded.clinic_admin_full_access;
-- Check (the change is in config_audit too):
-- select clinic_admin_full_access from public.clinic_portal_capabilities;
-- Who looked and what changed:
-- select created_at,kind,detail from public.clinic_portal_audit where kind like 'admin-%' order by id desc limit 50;
-- select created_at,member_id,before,after from public.clinic_member_profile_changes order by created_at desc limit 50;
-- Off again (nothing is deleted; clinic admins see the narrow member file only):
-- update public.clinic_portal_capabilities set clinic_admin_full_access=false where singleton;
