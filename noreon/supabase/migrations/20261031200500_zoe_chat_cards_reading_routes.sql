-- Extend 20261031184835's pending-reading rules with this branch's app offers and newest same-day BP cards.
-- Keep the original pending message and all safety gates. Earlier same-day readings still cannot be carried by small talk.
-- No new columns: forwarding reasons and urgency are recorded in conversation_trace_events.

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
    and(e.attributes->>'noreon.zoe.health.urgency'='emergency'
     or(cm.seq<>z.message_seq and e.attributes->>'noreon.zoe.health.urgency'='same_day')))
   and(public._zoe_chat_message_cleared(m,z.message_seq)
    or(z.outcome='discarded'and z.reason_code='language_not_supported')
    -- Only the newest BP offer may follow a guarded same-day answer. Forward reasons live in the trace.
    or(cm.seq=z.message_seq and z.outcome='answered'and z.reason_code='health_answer_passed_guards'
     and z.forward='auto'and exists(select 1 from public.conversation_trace_events e
      where e.member_id=m and e.conversation_id=c.id and e.subject_kind='zoe_run'and e.subject_id=z.id::text
       and e.name='zoe.route'and e.attributes->>'noreon.zoe.health.forward_reason'='same_day'
       and e.attributes->>'noreon.zoe.health.urgency'='same_day')))
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

create or replace function public.zoe_chat_card_post(p_member uuid,p_request uuid,p_kind text,p_source text,p_source_seq bigint,p_snapshot jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare k public.zoe_chat_cards;
begin
 if p_member is null or p_request is null or p_kind is null or p_source is null or p_snapshot is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('ok',false,'code','disabled');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-chat-card:'||p_member::text,0));
 select * into k from public.zoe_chat_cards where member_id=p_member and request_id=p_request;
 if found then
  if k.kind=p_kind and k.source=p_source and k.source_seq is not distinct from p_source_seq then return jsonb_build_object('ok',true,'replayed',true,'card',public._zoe_chat_card_json(k));end if;
  return jsonb_build_object('ok',false,'code','conflict');
 end if;
 -- Only the BP card may follow a health answer or a same-day answer; every other card needs the plain rule.
 if p_source='typed'and(p_source_seq is null or not(case when p_kind='bp'and(p_snapshot?'typed'or exists(select 1 from public.zoe_runs z where z.member_id=p_member and z.message_seq=p_source_seq and z.state='finished'and z.outcome='answered'and z.reason_code='health_answer_passed_guards'))then public._zoe_chat_reading_cleared(p_member,p_source_seq)else public._zoe_chat_message_cleared(p_member,p_source_seq)end)
   or exists(select 1 from public.zoe_chat_cards x where x.member_id=p_member and x.source_seq=p_source_seq))then
  return jsonb_build_object('ok',false,'code','not_cleared');
 end if;
 if(select count(*)from public.zoe_chat_cards where member_id=p_member and created_at>clock_timestamp()-interval '1 hour')>=40 then
  return jsonb_build_object('ok',false,'code','rate_limited');
 end if;
 begin
  insert into public.zoe_chat_cards(member_id,request_id,kind,source,source_seq,snapshot)
  values(p_member,p_request,p_kind,p_source,case when p_source='typed'then p_source_seq end,p_snapshot)returning * into k;
 exception when check_violation then return jsonb_build_object('ok',false,'code','invalid');
 end;
 return jsonb_build_object('ok',true,'replayed',false,'card',public._zoe_chat_card_json(k));
end$$;

-- As 20261029172131, and readingSeq: the newest message when the wider rule clears it, for the BP card alone.
create or replace function public.zoe_chat_cards_member()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=auth.uid();newest bigint;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('ok',true,'enabled',false);end if;
 select max(cm.seq)into newest from public.conversations c join public.conversation_messages cm on cm.conversation_id=c.id where c.member_id=m;
 return jsonb_build_object('ok',true,'enabled',true,
  'cards',coalesce((select jsonb_agg(public._zoe_chat_card_json(x)order by x.created_at,x.id)
   from(select * from public.zoe_chat_cards where member_id=m order by created_at desc,id desc limit 40)x),'[]'),
  'clearedSeq',case when newest is not null and public._zoe_chat_message_cleared(m,newest)
   and not exists(select 1 from public.zoe_chat_cards k where k.member_id=m and k.source_seq=newest)then newest end,
  'readingSeq',case when newest is not null and public._zoe_chat_reading_cleared(m,newest)
   and not exists(select 1 from public.zoe_chat_cards k where k.member_id=m and k.source_seq=newest)then newest end);
end$$;
