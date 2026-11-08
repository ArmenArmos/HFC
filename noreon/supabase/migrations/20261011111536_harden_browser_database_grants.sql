-- Browser roles read through existing RLS policies; all writes use narrow RPCs.
-- Preserve SELECT and service-role grants so existing member/staff access is unchanged.
revoke insert, update, delete, truncate, trigger, references
 on public.workspace_cases, public.workspace_clinics, public.workspace_staff,
 public.workspace_login_attempts, public.profiles
 from public, anon, authenticated;

-- CLI migrations run as postgres. New public tables require explicit write grants.
-- Do not change managed Supabase schemas or supabase_admin-owned objects.
alter default privileges for role postgres in schema public
 revoke insert, update, delete, truncate, trigger, references on tables from anon, authenticated;
