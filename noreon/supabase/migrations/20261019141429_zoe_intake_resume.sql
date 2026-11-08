-- Zoe: a short answer after an expired intake resumes it (Lead 19 Oct; Armen's live test: the onset question was asked
-- at 19:30, the intake expired after 12 hours, and «Առավոտյան» the next evening was handled as a new symptom).
-- The 12-hour expiry stays: it is what sends the doctor the partial summary, and a half-described symptom must not wait
-- two days for the doctor to see it.
-- zoe_run_resumable: per claimed run, the newest intake of the conversation when it expired and the run's message is
-- the member's next message after it (nothing from the member in between, no doctor reply since it ended, no intake
-- active), at most 7 days after the member's last intake message. The worker decides from the message and the age
-- whether to resume (with the record) or restart warmly. Read after the claim, like zoe_run_context: a worker that does
-- not know it ignores it, and a database without it leaves the worker on the ordinary path. Additive; service role only.
create function public.zoe_run_resumable(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,'intake',(
   select jsonb_build_object('sheetId',ix.sheet_id,'sheetVersion',ix.sheet_version,'startedSeq',ix.started_seq,'language',ix.language,'record',ix.record,
     'idleMinutes',floor(extract(epoch from clock_timestamp()-lm.created_at)/60)::integer)
   from(select * from public.zoe_symptom_intakes i where i.conversation_id=r.conversation_id order by i.created_at desc limit 1)ix
   join public.conversation_messages lm on lm.conversation_id=ix.conversation_id and lm.seq=ix.last_seq
   where ix.state='expired'and ix.last_seq<r.message_seq
    and lm.created_at>clock_timestamp()-interval '7 days'
    and exists(select 1 from public.zoe_symptom_sheets sh where sh.sheet_id=ix.sheet_id and sh.version=ix.sheet_version)
    and not exists(select 1 from public.zoe_symptom_intakes a where a.conversation_id=r.conversation_id and a.state='active')
    and not exists(select 1 from public.conversation_messages m where m.conversation_id=r.conversation_id and m.seq>ix.last_seq and m.seq<r.message_seq
     and m.source in('telegram_member','authenticated_member'))
    and not exists(select 1 from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id
     where d.conversation_id=r.conversation_id and ap.created_at>ix.finished_at))))
  from public.zoe_runs r where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;
revoke all on function public.zoe_run_resumable(uuid[])from public,anon,authenticated,service_role;
grant execute on function public.zoe_run_resumable(uuid[])to service_role;
