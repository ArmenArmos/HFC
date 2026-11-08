-- Pressed suggestions enter conversation_receive as messages. Their cleared typed cards must not
-- spend a second, smaller allowance. Direct chip cards retain their existing bounded allowance.
do $migration$
declare definition text; old text; replacement text;
begin
 definition:=pg_get_functiondef('public.zoe_chat_card_post(uuid,uuid,text,text,bigint,jsonb)'::regprocedure);
 old:=$old$if(select count(*)from public.zoe_chat_cards where member_id=p_member and created_at>clock_timestamp()-interval '1 hour')>=40 then$old$;
 replacement:=$new$if p_source='chip'and(select count(*)from public.zoe_chat_cards where member_id=p_member and source='chip'and created_at>clock_timestamp()-interval '1 hour')>=40 then$new$;
 if position(old in definition)=0 or cardinality(string_to_array(definition,old))<>2 then
  raise exception 'Unexpected zoe_chat_card_post rate-limit definition';
 end if;
 execute replace(definition,old,replacement);
end $migration$;

-- Suggestion eligibility is a full-history owner projection, not an inference from the bounded
-- thread or settledSeq (which deliberately advances immediately during doctor takeover).
-- Existing thread eligibility and grants stay unchanged. An eligible empty conversation has
-- no pending message or alarm; the member must still have current consent.
do $migration$
declare definition text; old text; replacement text;
begin
 definition:=pg_get_functiondef('public.conversation_member_thread()'::regprocedure);
 old:=$old$if r->>'ok'='true'then$old$;
 replacement:=$new$if r->>'ok'='true'then
  r:=r||jsonb_build_object('suggestionSafety',public._zoe_consent_ok(auth.uid())and coalesce((
   select not exists(select 1 from public._zoe_talking_urgent_window(c.id)w where w.started_at is not null)
    and coalesce((select max(z.message_seq)from public.zoe_runs z
      where z.conversation_id=c.id and z.state='finished'and z.outcome<>'stale'),0)
     >=coalesce((select max(m.seq)from public.conversation_messages m where m.conversation_id=c.id),0)
   from public.conversations c where c.member_id=auth.uid()
  ),true));$new$;
 if position(old in definition)=0 or cardinality(string_to_array(definition,old))<>2 then
  raise exception 'Unexpected conversation_member_thread suggestion projection definition';
 end if;
 execute replace(definition,old,replacement);
end $migration$;

-- A fixed task-card acknowledgement may pass doctor takeover. This is not a hand-back: the
-- existing consent check runs first, and the core still owns freshness, publication and wording.
do $migration$
declare definition text; old text; replacement text;
begin
 definition:=pg_get_functiondef('public.zoe_run_finish(uuid,jsonb)'::regprocedure);
 old:=$old$elsif same_day then res:=public._zoe_run_finish_core(p_run,p_result);$old$;
 replacement:=$new$elsif same_day then res:=public._zoe_run_finish_core(p_run,p_result);
 elsif(o='chatted'and rs='task_request_no_model'and p_result->>'tier'='none'
  and p_result#>>'{chat,source}'='fixed'and p_result#>>'{chat,kind}'='capabilities'
  and p_result->>'answer'=case p_result->>'language'
   when 'en'then 'You can do that on the card here.'
   when 'hy'then 'Կարող եք դա անել այստեղի քարտով։'
   when 'ru'then 'Вы можете сделать это на карточке здесь.'end
  and not(jsonb_strip_nulls(p_result) ?| array['receipt','intake','health','draft','memberClear'])
  and not exists(select 1 from jsonb_array_elements(public.zoe_run_alarm_window(array[r.id]))a
   where a#>>'{memberClear,startedAt}'is not null))
 then res:=public._zoe_run_finish_core(p_run,p_result);
 $new$;
 if position(old in definition)=0 or cardinality(string_to_array(definition,old))<>2 then
  raise exception 'Unexpected zoe_run_finish doctor-mode definition';
 end if;
 execute replace(definition,old,replacement);
end $migration$;
