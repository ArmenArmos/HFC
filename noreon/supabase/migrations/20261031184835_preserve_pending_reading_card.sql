-- A reading followed by small talk remains a confirmation card. No new queue or saved reading:
-- use the original message/request/time and the newest run's safety decision for the whole batch.
-- This exception is only for the typed BP path; ordinary task cards still need the newest message.
create or replace function public._zoe_chat_reading_cleared(m uuid,p_seq bigint)returns boolean
language sql stable security definer set search_path=''as $$
 select public._zoe_chat_message_cleared(m,p_seq)or exists(
  select 1 from public.conversations c
  join public.conversation_messages cm on cm.conversation_id=c.id and cm.seq=p_seq
  join public.zoe_runs z on z.conversation_id=c.id
   and z.message_seq=(select max(x.seq)from public.conversation_messages x where x.conversation_id=c.id)
  where c.member_id=m and z.state='finished'and not z.injection_detected
   and cm.created_at>clock_timestamp()-interval '1 hour'
   -- zoe_run_finish records health urgency on the run's zoe.route trace, not on zoe_runs.
   and not exists(select 1 from public.conversation_trace_events e where e.member_id=m and e.conversation_id=c.id
    and e.subject_kind='zoe_run'and e.subject_id=z.id::text and e.name='zoe.route'
    and e.attributes->>'noreon.zoe.health.urgency'in('same_day','emergency'))
   and(public._zoe_chat_message_cleared(m,z.message_seq)
    or(z.outcome='discarded'and z.reason_code='language_not_supported'))
   and(cm.seq=z.message_seq or(cm.source='telegram_member'and cm.seq<z.message_seq
    -- Claim keeps at most twenty member messages, and drops messages a doctor already answered.
    and(select count(*)from public.conversation_messages x where x.conversation_id=c.id and x.seq>cm.seq)<20
    and not exists(select 1 from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id
     where d.conversation_id=c.id and ap.created_at>=cm.created_at)
    -- Every intervening message must be small talk. Corrections, another reading, symptoms,
    -- doctor messages and unknown words all keep the previous newest-message rule.
    and not exists(select 1 from public.conversation_messages x where x.conversation_id=c.id and x.seq>cm.seq
     and(x.source<>'telegram_member'or lower(btrim(regexp_replace(x.body,'\s+',' ','g')))!~'^(thanks|thank you|ok|okay|hi|hello|շնորհակալություն|շնորհակալ եմ|բարև|բարեւ|լավ|спасибо|привет|хорошо|ладно)[.!։]*$'))
    -- A newer safe run cannot rehabilitate a reading already held or escalated. A stale run
    -- had no accepted result; the newest run screens the batch again. No earlier run is normal for a burst.
    and not exists(select 1 from public.zoe_runs prior where prior.conversation_id=c.id
     and prior.message_seq>=cm.seq and prior.message_seq<z.message_seq
     and not coalesce(prior.state='finished'and not prior.injection_detected
      and not exists(select 1 from public.conversation_trace_events e where e.member_id=m and e.conversation_id=c.id
       and e.subject_kind='zoe_run'and e.subject_id=prior.id::text and e.name='zoe.route'
       and e.attributes->>'noreon.zoe.health.urgency'in('same_day','emergency'))
      and(prior.outcome='stale'
       or(prior.outcome='chatted'and coalesce(prior.reason_code,'')!~'injection|urgent|crisis|red_flag|same_day')
       or(prior.outcome='answered'and prior.reason_code in('direct_answer_passed_guards','health_answer_passed_guards')and coalesce(prior.forward,'none')in('none','asked'))
       or(prior.outcome='discarded'and prior.reason_code='language_not_supported')),false)))))
$$;

-- Read candidate messages rather than only messages with their own run: a burst is claimed
-- once, at its last message. Clearance and the post both re-check the newest run and the suffix.
create or replace function public.zoe_chat_card_telegram_candidates(p_limit integer)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('memberId',q.member_id,'seq',q.seq,'requestId',q.request_id,'text',q.body,'locale',q.locale,'at',q.created_at,'cleared',q.cleared))from(
  select c.member_id,m.seq,m.request_id,m.body,m.created_at,public._telegram_auth_locale(c.member_id)locale,public._zoe_chat_message_cleared(c.member_id,m.seq)cleared
  from public.conversations c
  join public.zoe_runs z on z.conversation_id=c.id
   and z.message_seq=(select max(x.seq)from public.conversation_messages x where x.conversation_id=c.id)
  join public.conversation_messages m on m.conversation_id=c.id and m.seq<=z.message_seq
  where z.state='finished'and z.started_at>clock_timestamp()-interval '30 minutes'and z.finished_at>clock_timestamp()-interval '15 minutes'
   and m.source='telegram_member'and m.created_at>clock_timestamp()-interval '1 hour'and public._zoe_chat_reading_cleared(c.member_id,m.seq)
   and not exists(select 1 from public.zoe_chat_card_scans x where x.member_id=c.member_id and x.seq=m.seq)
   and not exists(select 1 from public.zoe_chat_cards x join public.zoe_chat_card_sends y on y.card_id=x.id where x.member_id=c.member_id and x.source_seq=m.seq)
   and exists(select 1 from public.conversation_endpoints e where e.member_id=c.member_id and e.adapter='telegram'and e.active and e.expires_at>clock_timestamp())
  order by m.created_at,m.seq limit greatest(1,least(coalesce(p_limit,20),50)))q),'[]'::jsonb);
end$$;

