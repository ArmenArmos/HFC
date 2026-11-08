begin;

do $$
declare i integer;
  case_id uuid := gen_random_uuid();
  revision integer;
begin
  if not exists (select 1 from pg_class where oid = 'public.workspace_clinics'::regclass and relrowsecurity) then
    raise exception 'clinic RLS is not enabled';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.workspace_staff'::regclass and relrowsecurity) then
    raise exception 'staff RLS is not enabled';
  end if;
  if not exists (select 1 from pg_class where oid = 'public.workspace_cases'::regclass and relrowsecurity) then
    raise exception 'case RLS is not enabled';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('workspace_clinics','workspace_staff','workspace_cases') and 'anon' = any(roles)) then
    raise exception 'anonymous RLS policy exists for staff tables';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_cases') then
    raise exception 'case RLS policy exposes browser access';
  end if;
  if has_function_privilege('anon', 'public.workspace_assign_case(uuid,integer,uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.workspace_assign_case(uuid,integer,uuid)', 'execute') then
    raise exception 'case assignment RPC exposed to browser roles';
  end if;
  insert into public.workspace_cases(id, state, revision, expires_at)
    values (case_id, '{}'::jsonb, 0, now() + interval '1 day');
  revision := public.workspace_assign_case(case_id, 0, null);
  if revision <> 1 then raise exception 'case assignment did not increment revision'; end if;
  if public.workspace_assign_case(case_id, 0, null) <> -1 then
    raise exception 'stale case assignment was accepted';
  end if;
end $$;

set local role anon;
do $$
begin
  if (select count(*) from public.workspace_clinics) <> 0
    or (select count(*) from public.workspace_staff) <> 0
    or (select count(*) from public.workspace_cases) <> 0 then
    raise exception 'anonymous role can read staff data';
  end if;
end $$;

set local role authenticated;
do $$
begin
  if (select count(*) from public.workspace_cases) <> 0 then
    raise exception 'authenticated role can read cases';
  end if;
end $$;

rollback;
