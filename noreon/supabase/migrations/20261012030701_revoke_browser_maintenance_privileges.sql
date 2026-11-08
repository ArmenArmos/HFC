-- The existing browser grant hardening predates PostgreSQL 17's MAINTAIN privilege.
-- The read-only production audit confirmed it remains on these five legacy tables.
-- Preserve SELECT, narrow RPC access and service-role privileges.
do $$
begin
 if current_setting('server_version_num')::integer >= 170000 then
  execute 'revoke maintain on table public.workspace_cases, public.workspace_clinics, public.workspace_staff, public.workspace_login_attempts, public.profiles from public, anon, authenticated';
  execute 'alter default privileges for role postgres in schema public revoke maintain on tables from public, anon, authenticated';
 end if;
end $$;
-- Do not modify Supabase-managed roles/defaults. The metadata audit continues
-- to report supabase_admin future grants for a separate platform-owner decision.
