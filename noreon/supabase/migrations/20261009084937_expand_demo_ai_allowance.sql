-- Extraction and explanation each consume one request. Allow repeated demo review.
create or replace function public.claim_demo_report_ai(p_request_id uuid, p_session_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
 perform pg_advisory_xact_lock(8764313);
 delete from public.demo_report_ai_attempts where created_at < now() - interval '7 days';
 if exists(select 1 from public.demo_report_ai_attempts where request_id = p_request_id)
 or (select count(*) from public.demo_report_ai_attempts where created_at >= day_start) >= 100
 or (select count(*) from public.demo_report_ai_attempts where session_hash = p_session_hash and created_at >= day_start) >= 20
 then return false; end if;
 insert into public.demo_report_ai_attempts(request_id,session_hash) values(p_request_id,p_session_hash);
 return true;
end $$;
revoke all on function public.claim_demo_report_ai(uuid,text) from public, anon, authenticated;
grant execute on function public.claim_demo_report_ai(uuid,text) to service_role;
