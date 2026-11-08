-- Job ledger (architecture review ADR 2): one row per run of a scheduled or triggered background job
-- (Telegram dispatch, Zoe, lab AI, report cleanup, message dispatch). Every sweep writes it through
-- lib/jobs/contract.ts. Operational telemetry only: job name, timings, outcome, a fixed error code and
-- numeric counts. Never member data, message text or provider error messages.
create table public.job_runs (
 id uuid primary key default gen_random_uuid(),
 job text not null check (job ~ '^[a-z][a-z0-9_]{1,39}$'),
 trigger text not null check (trigger in ('cron','request')),
 started_at timestamptz not null default clock_timestamp(),
 -- The route's hard limit: past this a run that never finished was killed (shown as "lost").
 deadline_at timestamptz not null,
 finished_at timestamptz,
 outcome text check (outcome in ('ok','partial','skipped','error')),
 error_code text check (error_code ~ '^[A-Za-z0-9_.:-]{1,80}$'),
 duration_ms integer check (duration_ms >= 0),
 counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object' and pg_column_size(counts) <= 4096),
 check ((finished_at is null) = (outcome is null)),
 check ((finished_at is null) = (duration_ms is null)),
 check (finished_at is null or finished_at >= started_at),
 check (deadline_at > started_at),
 check (error_code is null or outcome in ('error','partial'))
);
create index job_runs_job_recent on public.job_runs (job, started_at desc, id desc);
create index job_runs_recent on public.job_runs (started_at desc, id desc);
alter table public.job_runs enable row level security;
revoke all on public.job_runs from public, anon, authenticated, service_role;

-- Start a run. Also purges this job's rows older than 30 days (bounded, indexed), so the ledger keeps a
-- month without a separate retention job.
create function public.job_run_start(p_job text, p_trigger text, p_max_seconds integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare run uuid;
begin
 if p_max_seconds is null or p_max_seconds < 1 or p_max_seconds > 900 then raise exception 'Invalid job limit'; end if;
 insert into public.job_runs (job, trigger, deadline_at)
 values (p_job, p_trigger, clock_timestamp() + make_interval(secs => p_max_seconds))
 returning id into run;
 delete from public.job_runs
 where id in (select id from public.job_runs where job = p_job and started_at < clock_timestamp() - interval '30 days'
  order by started_at limit 500);
 return run;
end;
$$;

-- Finish a run once. Returns false if it was already finished (a retry of the write), never overwrites.
create function public.job_run_finish(p_run uuid, p_outcome text, p_error_code text, p_counts jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
 update public.job_runs
 set finished_at = greatest(clock_timestamp(), started_at), outcome = p_outcome, error_code = p_error_code,
  counts = coalesce(p_counts, '{}'::jsonb),
  duration_ms = greatest(0, floor(extract(epoch from (clock_timestamp() - started_at)) * 1000))::integer
 where id = p_run and finished_at is null;
 return found;
end;
$$;

-- Backoffice Operations: per-job health over the last 24 hours plus the latest runs. Admins only.
-- "lost" = no recorded finish and past the route's limit (the function was killed or the finish write failed).
create function public.real_admin_job_runs(p_job text default null, p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare jobs jsonb; runs jsonb;
begin
 perform public._real_staff_require_admin();
 if p_limit is null or p_limit < 1 or p_limit > 200 then raise exception 'Invalid limit'; end if;
 select coalesce(jsonb_agg(j order by j->>'job'), '[]'::jsonb) into jobs from (
  select jsonb_build_object(
   'job', r.job,
   'last_started_at', max(r.started_at),
   'last_ok_at', max(r.finished_at) filter (where r.outcome in ('ok','skipped')),
   'last_error_at', max(r.finished_at) filter (where r.outcome in ('error','partial')),
   'runs_24h', count(*) filter (where r.started_at > clock_timestamp() - interval '24 hours'),
   'errors_24h', count(*) filter (where r.started_at > clock_timestamp() - interval '24 hours' and r.outcome in ('error','partial')),
   'lost_24h', count(*) filter (where r.started_at > clock_timestamp() - interval '24 hours' and r.finished_at is null and r.deadline_at < clock_timestamp()),
   'p95_ms_24h', percentile_disc(0.95) within group (order by r.duration_ms) filter (where r.started_at > clock_timestamp() - interval '24 hours' and r.duration_ms is not null)
  ) j
  from public.job_runs r
  where r.started_at > clock_timestamp() - interval '30 days'
  group by r.job
 ) s;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id', r.id, 'job', r.job, 'trigger', r.trigger, 'started_at', r.started_at, 'finished_at', r.finished_at,
   'status', case when r.finished_at is not null then r.outcome when r.deadline_at < clock_timestamp() then 'lost' else 'running' end,
   'error_code', r.error_code, 'duration_ms', r.duration_ms, 'counts', r.counts
  ) order by r.started_at desc, r.id desc), '[]'::jsonb) into runs
 from (select * from public.job_runs where p_job is null or job = p_job order by started_at desc, id desc limit p_limit) r;
 return jsonb_build_object('jobs', jobs, 'runs', runs);
end;
$$;

revoke all on function public.job_run_start(text, text, integer), public.job_run_finish(uuid, text, text, jsonb),
 public.real_admin_job_runs(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.job_run_start(text, text, integer), public.job_run_finish(uuid, text, text, jsonb) to service_role;
grant execute on function public.real_admin_job_runs(text, integer) to authenticated;
