-- Shared native API admission. Existing AI/upload/admission budgets are unchanged.
create table public.native_member_request_usage (
 user_id uuid primary key references auth.users(id) on delete cascade,
 minute_started_at timestamptz not null,
 minute_count integer not null check (minute_count between 0 and 120),
 day_started_at timestamptz not null,
 day_count integer not null check (day_count between 0 and 5000)
);
alter table public.native_member_request_usage enable row level security;
revoke all on table public.native_member_request_usage from public,anon,authenticated,service_role;

create function public.claim_native_member_request(p_owner uuid)
returns table(allowed boolean,retry_after integer)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 r public.native_member_request_usage;
 current_time_at timestamptz;
 minute_start timestamptz;
 day_start timestamptz;
 minute_used integer;
 day_used integer;
 wait_seconds integer:=0;
begin
 if p_owner is null or not exists (
  select 1 from auth.users where id=p_owner and phone is not null and phone<>'' and phone_confirmed_at is not null
 ) then raise exception 'verified member required';end if;
 current_time_at:=clock_timestamp();
 insert into public.native_member_request_usage(user_id,minute_started_at,minute_count,day_started_at,day_count)
 values(p_owner,date_trunc('minute',current_time_at),0,date_trunc('day',current_time_at at time zone 'UTC') at time zone 'UTC',0)
 on conflict(user_id) do nothing;
 select * into strict r from public.native_member_request_usage where user_id=p_owner for update;
 -- Read the clock after waiting for the row lock; a queued request uses its admission window.
 current_time_at:=clock_timestamp();
 minute_start:=date_trunc('minute',current_time_at);
 day_start:=date_trunc('day',current_time_at at time zone 'UTC') at time zone 'UTC';
 minute_used:=case when r.minute_started_at=minute_start then r.minute_count else 0 end;
 day_used:=case when r.day_started_at=day_start then r.day_count else 0 end;
 if minute_used>=120 then
  wait_seconds:=greatest(1,ceil(extract(epoch from minute_start+interval '1 minute'-current_time_at))::integer);
 end if;
 if day_used>=5000 then
  wait_seconds:=greatest(wait_seconds,1,ceil(extract(epoch from day_start+interval '1 day'-current_time_at))::integer);
 end if;
 if wait_seconds>0 then return query select false,wait_seconds;return;end if;
 update public.native_member_request_usage set minute_started_at=minute_start,minute_count=minute_used+1,day_started_at=day_start,day_count=day_used+1 where user_id=p_owner;
 return query select true,0;
end $$;
revoke all on function public.claim_native_member_request(uuid) from public,anon,authenticated;
grant execute on function public.claim_native_member_request(uuid) to service_role;
