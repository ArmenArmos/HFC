-- Zoe: the 103 window (lead 19 Oct 22:27; Astra #356 UW-2). After Zoe's urgent text, every follow-up repeats it until
-- the member says help has arrived or 103 was called, or 120 minutes after the first urgent text (lib/zoe/urgent-window.ts).
-- The claimed job's answers are filtered by the doctor's last approval and cut to 10, so they cannot carry the window.
-- zoe_run_urgent_window: per started run, how many minutes ago the current run of Zoe's urgent texts began: the first
-- urgent answer (kind 'urgent', written by zoe_run_finish on every urgent path) after the conversation's newest non-urgent
-- answer, or null when the newest answer is not urgent or there is none. Over the whole history: no approval filter, no
-- row cap, no rolling range. A number only, no text. Read after the claim, like zoe_run_resumable; the worker treats a
-- failed read or a missing row as unavailable and gives no answer of its own (the doctor answers). Additive; service role only.
create function public.zoe_run_urgent_window(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,'urgentSinceMinutes',(
   select floor(extract(epoch from clock_timestamp()-min(a.created_at))/60)::integer
   from public.zoe_member_answers a
   where a.conversation_id=r.conversation_id and a.kind='urgent'and a.created_at<=clock_timestamp()
    and a.created_at>coalesce((select max(b.created_at)from public.zoe_member_answers b
     where b.conversation_id=r.conversation_id and b.kind<>'urgent'and b.created_at<=clock_timestamp()),'-infinity'::timestamptz))))
  from public.zoe_runs r where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;
revoke all on function public.zoe_run_urgent_window(uuid[])from public,anon,authenticated,service_role;
grant execute on function public.zoe_run_urgent_window(uuid[])to service_role;
