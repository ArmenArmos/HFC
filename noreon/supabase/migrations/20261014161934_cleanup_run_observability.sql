-- Execution telemetry only. No cleanup/retention or storage logic changes.
create table public.cleanup_runs (
 run_id uuid primary key,
 job_kind text not null default 'report-cleanup' check(job_kind='report-cleanup'),
 started_at timestamptz not null default clock_timestamp(),
 ended_at timestamptz,
 status text not null default 'running' check(status in ('running','succeeded','failed')),
 attempted integer not null default 0 check(attempted>=0),
 cleaned integer not null default 0 check(cleaned>=0),
 failed integer not null default 0 check(failed>=0),
 failure_category text check(failure_category in ('database','storage','unexpected','mixed')),
 check((status='running')=(ended_at is null)),
 check(ended_at is null or ended_at>=started_at),
 check((status='failed')=(failure_category is not null)),
 check(status<>'succeeded' or failed=0)
);
create index cleanup_runs_recent on public.cleanup_runs(started_at desc,run_id desc);
alter table public.cleanup_runs enable row level security;
revoke all on public.cleanup_runs from public,anon,authenticated,service_role;
create function public.cleanup_run_start(p_run_id uuid) returns void
language sql security definer set search_path='' as $$
 insert into public.cleanup_runs(run_id) values(p_run_id);
$$;
create function public.cleanup_run_finish(p_run_id uuid,p_attempted integer,p_cleaned integer,p_failed integer,p_failure_category text) returns void
language plpgsql security definer set search_path='' as $$
begin
 update public.cleanup_runs set ended_at=clock_timestamp(),attempted=p_attempted,cleaned=p_cleaned,failed=p_failed,
  failure_category=p_failure_category,status=case when p_failure_category is null then 'succeeded' else 'failed' end
 where run_id=p_run_id and status='running';
 if not found then raise exception 'Run unavailable'; end if;
end;
$$;
create function public.real_admin_cleanup_runs(p_before timestamptz default null,p_run_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public._real_staff_require_admin();
 if (p_before is null)<>(p_run_id is null) then raise exception 'Invalid cursor';end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.started_at desc,r.run_id desc),'[]'::jsonb) into result
 from (select * from public.cleanup_runs where p_before is null or (started_at,run_id)<(p_before,p_run_id)
 order by started_at desc,run_id desc limit 50) r;
 return result;
end;
$$;
revoke all on function public.cleanup_run_start(uuid),public.cleanup_run_finish(uuid,integer,integer,integer,text),public.real_admin_cleanup_runs(timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.cleanup_run_start(uuid),public.cleanup_run_finish(uuid,integer,integer,integer,text) to service_role;
grant execute on function public.real_admin_cleanup_runs(timestamptz,uuid) to authenticated;
