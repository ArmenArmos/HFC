-- Model-mode eval runs in the background (lead, 18 Oct): the high tier is about 646 rows and 9 minutes,
-- longer than one request. The server action starts a job and returns; the work runs after the response
-- and records its zoe_eval_runs row when it finishes. One job runs at a time across all tiers; a job
-- still "running" after 15 minutes is treated as timed out (the function was stopped) and frees the slot.

create table public.zoe_model_eval_jobs (
 id uuid primary key default gen_random_uuid(),
 tier text not null check(tier in('low','medium','high')),
 model_id text not null references public.zoe_model_catalog(model_id),
 status text not null default 'running' check(status in('running','done','failed')),
 requested_by uuid not null references auth.users(id),
 started_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 eval_run_id uuid references public.zoe_eval_runs(id),
 error_code text check(error_code ~ '^[a-z_]{1,40}$'),
 check((status='running')=(finished_at is null)),
 check(status<>'done' or eval_run_id is not null)
);
-- At most one running job, whatever the tier.
create unique index zoe_model_eval_jobs_one_running on public.zoe_model_eval_jobs((true))where status='running';
create index zoe_model_eval_jobs_recent on public.zoe_model_eval_jobs(started_at desc);

-- Start (service role, for an active admin). Frees a stale job first; a second start while one runs is refused.
create function public.zoe_model_eval_start(p_admin uuid,p_tier text,p_model text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare id uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not exists(select 1 from public.workspace_staff where user_id=p_admin and role='admin'and active)then return jsonb_build_object('ok',false,'code','not_admin');end if;
 update public.zoe_model_eval_jobs set status='failed',error_code='timed_out',finished_at=clock_timestamp()
  where status='running'and started_at<clock_timestamp()-interval '15 minutes';
 begin
  insert into public.zoe_model_eval_jobs(tier,model_id,requested_by)values(p_tier,p_model,p_admin)returning zoe_model_eval_jobs.id into id;
 exception
  when unique_violation then return jsonb_build_object('ok',false,'code','eval_running');
  when check_violation or foreign_key_violation or not_null_violation then return jsonb_build_object('ok',false,'code','invalid');
 end;
 return jsonb_build_object('ok',true,'id',id);
end$$;

-- Finish (service role): done with the recorded eval run, or failed with a short code. Only a running job changes.
create function public.zoe_model_eval_finish(p_job uuid,p_eval_run uuid,p_error_code text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare n integer;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_eval_run is not null and not exists(select 1 from public.zoe_eval_runs e join public.zoe_model_eval_jobs j on j.id=p_job
   where e.id=p_eval_run and e.mode='model'and e.tier=j.tier and e.requested_by=j.requested_by)then return jsonb_build_object('ok',false,'code','invalid');end if;
 begin
  update public.zoe_model_eval_jobs set status=case when p_eval_run is null then 'failed'else 'done'end,eval_run_id=p_eval_run,
   error_code=case when p_eval_run is null then coalesce(p_error_code,'failed')end,finished_at=clock_timestamp()
   where id=p_job and status='running';
 exception when check_violation then return jsonb_build_object('ok',false,'code','invalid');end;
 get diagnostics n=row_count;
 return jsonb_build_object('ok',n=1,'code',case when n=1 then null else 'not_running'end);
end$$;

-- Admin read: the latest job with its result. A running job past 15 minutes reads as timed out.
create function public.zoe_model_eval_job_admin()returns jsonb
language plpgsql security definer set search_path=''as $$
declare j public.zoe_model_eval_jobs;e public.zoe_eval_runs;stale boolean;
begin
 perform public._real_staff_require_admin();
 select * into j from public.zoe_model_eval_jobs order by started_at desc,id limit 1;
 if not found then return jsonb_build_object('ok',true,'job',null);end if;
 if j.eval_run_id is not null then select * into e from public.zoe_eval_runs where id=j.eval_run_id;end if;
 stale:=j.status='running'and j.started_at<clock_timestamp()-interval '15 minutes';
 return jsonb_build_object('ok',true,'job',jsonb_build_object('id',j.id,'tier',j.tier,'model',j.model_id,
  'status',case when stale then 'failed'else j.status end,'errorCode',case when stale then 'timed_out'else j.error_code end,
  'startedAt',j.started_at,'finishedAt',j.finished_at,
  'result',case when e.id is null then null else jsonb_build_object('total',e.total_rows,'mustFailures',e.must_failures,'failedIds',to_jsonb(e.failed_ids))end));
end$$;

alter table public.zoe_model_eval_jobs enable row level security;
revoke all on public.zoe_model_eval_jobs from public,anon,authenticated,service_role;
revoke all on function public.zoe_model_eval_start(uuid,text,text),public.zoe_model_eval_finish(uuid,uuid,text),public.zoe_model_eval_job_admin()from public,anon,authenticated,service_role;
grant execute on function public.zoe_model_eval_job_admin()to authenticated;
grant execute on function public.zoe_model_eval_start(uuid,text,text),public.zoe_model_eval_finish(uuid,uuid,text)to service_role;
