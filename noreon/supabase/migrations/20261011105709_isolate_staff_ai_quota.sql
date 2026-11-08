-- 1,000 requests/day, 50% reserved for each audience. Legacy callers are members.
-- Deploy this before the bridge, then deploy callers only after the bridge is ready.
alter table public.demo_report_ai_attempts
 add column category text not null default 'member'
 check (category in ('member','staff'));
create index demo_report_ai_attempts_category_created
 on public.demo_report_ai_attempts(category,created_at);

create function public.claim_demo_report_ai(p_request_id uuid, p_session_hash text, p_category text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
 if p_request_id is null or p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$'
 or p_category is null or p_category not in ('member','staff') then return false; end if;
 perform pg_advisory_xact_lock(8764313);
 delete from public.demo_report_ai_attempts where created_at < now() - interval '7 days';
 if exists(select 1 from public.demo_report_ai_attempts where request_id = p_request_id)
 or (select count(*) from public.demo_report_ai_attempts where created_at >= day_start) >= 1000
 or (select count(*) from public.demo_report_ai_attempts where category = p_category and created_at >= day_start) >= 500
 or (select count(*) from public.demo_report_ai_attempts where category = p_category and session_hash = p_session_hash and created_at >= day_start) >= 20
 then return false; end if;
 insert into public.demo_report_ai_attempts(request_id,session_hash,category) values(p_request_id,p_session_hash,p_category);
 return true;
end $$;
revoke all on function public.claim_demo_report_ai(uuid,text,text) from public, anon, authenticated;
grant execute on function public.claim_demo_report_ai(uuid,text,text) to service_role;

-- Explicit overload, rather than an optional SQL argument, keeps PostgREST resolution unambiguous.
create or replace function public.claim_demo_report_ai(p_request_id uuid, p_session_hash text)
returns boolean language sql security definer set search_path = '' as $$
 select public.claim_demo_report_ai(p_request_id,p_session_hash,'member');
$$;
revoke all on function public.claim_demo_report_ai(uuid,text) from public, anon, authenticated;
grant execute on function public.claim_demo_report_ai(uuid,text) to service_role;
