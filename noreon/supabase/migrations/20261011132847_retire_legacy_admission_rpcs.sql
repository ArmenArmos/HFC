-- Release only AFTER admitted callers are live. The owner-only create helper
-- remains usable inside the admitted SECURITY DEFINER function.
revoke execute on function public.workspace_create_case(uuid,jsonb,uuid),
 public.record_workspace_login_attempt(text),public.clear_workspace_login_attempts(text)
 from public,anon,authenticated,service_role;
