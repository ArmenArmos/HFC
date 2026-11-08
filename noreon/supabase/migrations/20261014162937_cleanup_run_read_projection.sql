-- Explicit safe read projection, including for direct authenticated RPC callers.
create or replace function public.real_admin_cleanup_runs(p_before timestamptz default null,p_run_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public._real_staff_require_admin();
 if (p_before is null)<>(p_run_id is null) then raise exception 'Invalid cursor';end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.started_at desc,r.run_id desc),'[]'::jsonb) into result
 from (select run_id,job_kind,started_at,ended_at,status,attempted,cleaned,failed,failure_category from public.cleanup_runs where p_before is null or (started_at,run_id)<(p_before,p_run_id)
 order by started_at desc,run_id desc limit 50) r;
 return result;
end;
$$;
