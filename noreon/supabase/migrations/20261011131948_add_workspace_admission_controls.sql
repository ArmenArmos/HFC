-- Server-only abuse accounting; never store raw network addresses or emails.
create table public.workspace_admission_counters (
 operation text not null check (operation in ('case','upload','login')),
 bucket text not null,
 window_start timestamptz not null,
 expires_at timestamptz not null,
 attempts integer not null check (attempts > 0),
 primary key(operation,bucket)
);
alter table public.workspace_admission_counters enable row level security;
revoke all on public.workspace_admission_counters from public,anon,authenticated;
grant all on public.workspace_admission_counters to service_role;
create index workspace_admission_expiry on public.workspace_admission_counters(operation,expires_at);

-- Zero admits; a positive value is Retry-After seconds. Limits cannot be supplied by callers.
create function public.claim_workspace_admission(p_operation text,p_source text,p_email text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare
 t timestamptz := clock_timestamp();
 day_start timestamptz;
 short_start timestamptz;
 buckets text[]; starts timestamptz[]; ends timestamptz[]; limits integer[];
 n integer; used integer; retry integer := 0;
begin
 if p_operation is null or p_operation not in ('case','upload','login')
   or p_source is null or p_source !~ '^[a-f0-9]{64}$'
   or (p_operation='login' and (p_email is null or p_email !~ '^[a-f0-9]{64}$'))
   or (p_operation<>'login' and p_email is not null) then raise exception 'invalid admission request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('workspace-admission:'||p_operation,0));
 -- Get the clock after waiting, so a request cannot use yesterday's quota after midnight.
 t := clock_timestamp();
 day_start := date_trunc('day',t at time zone 'UTC') at time zone 'UTC';
 if p_operation='case' then
   buckets := array['global','source:'||p_source];
   starts := array[day_start,day_start]; ends := array[day_start+interval '1 day',day_start+interval '1 day']; limits := array[200,20];
 elsif p_operation='upload' then
   short_start := date_trunc('hour',t at time zone 'UTC') at time zone 'UTC';
   buckets := array['global','source:'||p_source]; starts := array[day_start,short_start];
   ends := array[day_start+interval '1 day',short_start+interval '1 hour']; limits := array[500,50];
 else
   short_start := to_timestamp(floor(extract(epoch from t)/900)*900);
   buckets := array['source:'||p_source,'pair:'||p_source||':'||p_email];
   starts := array[short_start,short_start]; ends := array[short_start+interval '15 minutes',short_start+interval '15 minutes']; limits := array[40,8];
 end if;
 delete from public.workspace_admission_counters where operation=p_operation and expires_at <= t;
 for n in 1..array_length(buckets,1) loop
   select attempts into used from public.workspace_admission_counters
    where operation=p_operation and bucket=buckets[n] and window_start=starts[n];
   if coalesce(used,0)>=limits[n] then retry := greatest(retry,ceil(extract(epoch from ends[n]-t))::integer,1); end if;
 end loop;
 if retry>0 then return retry; end if;
 for n in 1..array_length(buckets,1) loop
   insert into public.workspace_admission_counters(operation,bucket,window_start,expires_at,attempts)
   values(p_operation,buckets[n],starts[n],ends[n],1)
   on conflict(operation,bucket) do update set
     attempts=case when workspace_admission_counters.window_start=excluded.window_start then workspace_admission_counters.attempts+1 else 1 end,
     window_start=excluded.window_start,expires_at=excluded.expires_at;
 end loop;
 return 0;
end $$;

create function public.clear_workspace_login_source(p_source text,p_email text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_source is null or p_source !~ '^[a-f0-9]{64}$' or p_email is null or p_email !~ '^[a-f0-9]{64}$' then raise exception 'invalid admission request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('workspace-admission:login',0));
 delete from public.workspace_admission_counters where operation='login' and bucket='pair:'||p_source||':'||p_email;
end $$;
revoke all on function public.claim_workspace_admission(text,text,text),public.clear_workspace_login_source(text,text) from public,anon,authenticated;
grant execute on function public.claim_workspace_admission(text,text,text),public.clear_workspace_login_source(text,text) to service_role;

-- This also protects older app deployments during the migration-first rollout.
create or replace function public.workspace_create_case(p_id uuid,p_state jsonb,p_doctor uuid default null) returns integer
language plpgsql security definer set search_path='' as $$
begin
 if p_state->>'userId' is distinct from p_id::text or p_state ? 'workflow' then raise exception 'Invalid new case.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('workspace-active-case-cap',0));
 if (select count(*) from public.workspace_cases where expires_at>clock_timestamp())>=1000 then raise exception 'demo_capacity'; end if;
 insert into public.workspace_cases(id,state,assigned_doctor_id,expires_at)
 values(p_id,p_state,p_doctor,to_timestamp((p_state->>'expiresAt')::double precision/1000));
 return 0;
end $$;

-- Quota and insertion commit together. A failed insertion does not spend admission.
create function public.workspace_create_case_admitted(p_id uuid,p_state jsonb,p_source text,p_doctor uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare retry integer;
begin
 retry := public.claim_workspace_admission('case',p_source,null);
 if retry>0 then return -retry; end if;
 return public.workspace_create_case(p_id,p_state,p_doctor);
end $$;
revoke all on function public.workspace_create_case_admitted(uuid,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.workspace_create_case_admitted(uuid,jsonb,text,uuid) to service_role;
