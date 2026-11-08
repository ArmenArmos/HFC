begin;
do $$
declare signature text;
begin
 foreach signature in array array['public.workspace_create_case(uuid,jsonb,uuid)','public.record_workspace_login_attempt(text)','public.clear_workspace_login_attempts(text)'] loop
  -- Retired functions are dropped (WP-22b) or kept but not callable.
  if to_regprocedure(signature) is not null and has_function_privilege('service_role',signature,'execute') then raise exception 'Legacy admission bypass remains callable: %',signature; end if;
 end loop;
 if not has_function_privilege('service_role','public.workspace_create_case_admitted(uuid,jsonb,text,uuid)','execute') then raise exception 'Admitted creation unavailable'; end if;
end $$;
set local role service_role;
do $$
declare id uuid:=gen_random_uuid();
begin
 if public.workspace_create_case_admitted(id,jsonb_build_object('userId',id,'expiresAt',extract(epoch from now()+interval '1 day')*1000),repeat('e',64),null)<>0 then raise exception 'Retirement broke admitted wrapper'; end if;
end $$;
rollback;
