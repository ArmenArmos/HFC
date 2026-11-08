-- Abuse protection for the real (non-demo) entry points: member phone codes, one-tap links,
-- the staff and clinic sign-in, and uploads (OWASP ASVS L2 V2.2 / V11). Fixed windows, keyed
-- only by server-side HMACs of the client network prefix or the account; no raw address,
-- phone, email or user id is stored. Limits live here, never in the caller.
create table public.rate_limit_counters(
 operation text not null,
 bucket text not null check(bucket ~ '^(source|phone|email|user):[a-f0-9]{64}$'),
 window_start timestamptz not null,
 expires_at timestamptz not null,
 hits integer not null check(hits>0),
 primary key(operation,bucket)
);
alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from public,anon,authenticated;
grant all on public.rate_limit_counters to service_role;
create index rate_limit_counters_expiry on public.rate_limit_counters(expires_at);

-- (operation, bucket kind) -> limit per window. Unknown pairs are refused.
create function public._rate_limit_policy(p_operation text,p_kind text,out max_hits integer,out window_seconds integer)
language sql immutable set search_path='' as $$
 select l.max_hits,l.window_seconds from (values
  -- Member phone codes. The source bucket counts every request; the phone bucket counts only a
  -- send Supabase confirmed (CAPTCHA passed), so a stranger cannot spend a member's quota for free.
  ('member_code','source',30,900),
  ('member_code','phone',8,3600),
  ('member_verify','source',60,900),
  ('member_link','source',30,900),
  -- Staff and clinic password sign-in. The email bucket counts only failed passwords.
  ('staff_signin','source',30,900),
  ('staff_signin','email',10,900),
  ('member_upload','source',60,3600),
  ('member_upload','user',30,3600),
  ('clinic_upload','user',400,3600)
 ) as l(operation,kind,max_hits,window_seconds)
 where l.operation=p_operation and l.kind=p_kind
$$;

-- p_modes: 'take' counts and checks, 'peek' checks only, 'record' counts only.
-- Returns 0 when admitted, otherwise Retry-After seconds. A refused 'take' is still counted,
-- so hammering past the limit keeps the window closed until it ends.
create function public.rate_limit_claim(p_operation text,p_kinds text[],p_keys text[],p_modes text[])
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;pol record;t timestamptz;ws timestamptz;b text;used integer;retry integer:=0;
begin
 if p_operation is null or p_kinds is null or p_keys is null or p_modes is null
  or cardinality(p_kinds)<1 or cardinality(p_kinds)>4 or cardinality(p_kinds)<>cardinality(p_keys) or cardinality(p_kinds)<>cardinality(p_modes)
 then raise exception 'invalid rate limit request';end if;
 t:=clock_timestamp();
 for n in 1..cardinality(p_kinds) loop
  select * into pol from public._rate_limit_policy(p_operation,p_kinds[n]);
  if pol.max_hits is null or coalesce(p_keys[n],'')!~'^[a-f0-9]{64}$'or coalesce(p_modes[n],'')not in('take','peek','record')then
   raise exception 'invalid rate limit request';end if;
  b:=p_kinds[n]||':'||p_keys[n];
  ws:=to_timestamp(floor(extract(epoch from t)/pol.window_seconds)*pol.window_seconds);
  if p_modes[n]='peek' then
   select hits into used from public.rate_limit_counters where operation=p_operation and bucket=b and window_start=ws;
   used:=coalesce(used,0);
   if used>=pol.max_hits then retry:=greatest(retry,ceil(extract(epoch from ws+make_interval(secs=>pol.window_seconds)-t))::integer,1);end if;
  else
   -- One atomic upsert per bucket: concurrent requests cannot both see the last free slot.
   insert into public.rate_limit_counters(operation,bucket,window_start,expires_at,hits)
   values(p_operation,b,ws,ws+make_interval(secs=>pol.window_seconds),1)
   on conflict(operation,bucket)do update set
    hits=case when rate_limit_counters.window_start=excluded.window_start then rate_limit_counters.hits+1 else 1 end,
    window_start=excluded.window_start,expires_at=excluded.expires_at
   returning hits into used;
   if p_modes[n]='take'and used>pol.max_hits then retry:=greatest(retry,ceil(extract(epoch from ws+make_interval(secs=>pol.window_seconds)-t))::integer,1);end if;
  end if;
 end loop;
 -- Bounded housekeeping: a few expired rows per call keep the table small without a cron. The outer
 -- expires_at test is re-checked on a row another call refreshed meanwhile, so that row survives.
 delete from public.rate_limit_counters where expires_at<=t and ctid in(select ctid from public.rate_limit_counters where expires_at<=t limit 20);
 return retry;
end$$;
revoke all on function public._rate_limit_policy(text,text),public.rate_limit_claim(text,text[],text[],text[])from public,anon,authenticated;
grant execute on function public.rate_limit_claim(text,text[],text[],text[])to service_role;

-- Uptime probe (/api/health): proves PostgREST and the database answer, reads nothing.
create function public.health_ping()returns boolean language sql stable set search_path='' as $$ select true $$;
revoke all on function public.health_ping()from public,anon,authenticated;
grant execute on function public.health_ping()to service_role;
