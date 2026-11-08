-- Zoe chat cards: a normal way in (parity finding 1, proved with real messages through the real pipeline, 30 Oct). In free
-- mode an ordinary request ("I took my pill") ends as a health answer, which never opened a card, and Telegram has no chips.
-- So a card can follow a health answer that passed its guards, and /menu opens the list of tasks on Telegram. Dark with
-- zoe_chat_actions_enabled. lib/zoe and the prompts are untouched: Zoe's answer goes first and is unchanged.

-- 1. What clears a message --------------------------------------------------------------------------------------------

-- As 20261029172131, plus a health answer that passed its guards with no injection and nothing sent on automatically.
-- The card is an offer after Zoe's answer, and the member still taps. Urgent, same-day, careful, held and forwarded runs
-- stay out: they end with other outcomes or reasons, or with forward 'auto', 'member_yes' or 'member_request'.
create or replace function public._zoe_chat_message_cleared(m uuid,p_seq bigint)returns boolean
language sql stable security definer set search_path=''as $$
 select exists(
  select 1 from public.conversations c
  join public.conversation_messages cm on cm.conversation_id=c.id and cm.seq=p_seq
  join public.zoe_runs z on z.conversation_id=c.id and z.message_seq=p_seq
  where c.member_id=m and z.state='finished'
   and cm.seq=(select max(x.seq)from public.conversation_messages x where x.conversation_id=c.id)
   and cm.created_at>clock_timestamp()-interval '1 hour'
   and((z.outcome='chatted'and coalesce(z.reason_code,'')!~'injection|urgent|crisis|red_flag|same_day')
    or(z.outcome='answered'and z.reason_code='direct_answer_passed_guards')
    or(z.outcome='answered'and z.reason_code='health_answer_passed_guards'and not z.injection_detected and coalesce(z.forward,'none')in('none','asked'))))
$$;

-- A message of numbers alone has no language, so the run ends here with no reply, after the urgent and same-day exits, which
-- come first (lib/zoe/pipeline.ts). Only the BP card that shows those numbers back may follow it (typed-reading.ts decides).
create or replace function public._zoe_chat_reading_cleared(m uuid,p_seq bigint)returns boolean
language sql stable security definer set search_path=''as $$
 select public._zoe_chat_message_cleared(m,p_seq)or exists(
  select 1 from public.conversations c
  join public.conversation_messages cm on cm.conversation_id=c.id and cm.seq=p_seq
  join public.zoe_runs z on z.conversation_id=c.id and z.message_seq=p_seq
  where c.member_id=m and z.state='finished'
   and cm.seq=(select max(x.seq)from public.conversation_messages x where x.conversation_id=c.id)
   and cm.created_at>clock_timestamp()-interval '1 hour'
   and z.outcome='discarded'and z.reason_code='language_not_supported'and not z.injection_detected)
$$;

-- 2. The menu card and its buttons -------------------------------------------------------------------------------------

alter table public.zoe_chat_cards drop constraint zoe_chat_cards_kind_check;
alter table public.zoe_chat_cards add constraint zoe_chat_cards_kind_check check(kind in('dose','bp','results','plan','visit','side_effect','message','menu'));
alter table public.zoe_chat_card_intents drop constraint zoe_chat_card_intents_action_check;
alter table public.zoe_chat_card_intents add constraint zoe_chat_card_intents_action_check check(action in('dose_taken','dose_skipped','bp_save','open_card','show_current'));

-- 3. /menu on Telegram -------------------------------------------------------------------------------------------------

-- The whole message is the command, so it carries nothing of the member's, like a chip tap: it needs no screening, is not
-- stored in the conversation, and anything else goes to Zoe as before.
create function public._channel_text_is_menu(t text)returns boolean
language sql immutable set search_path=''as $$
 select lower(btrim(t))~'^/menu(@[a-z0-9_]{1,64})?$'or lower(btrim(t))in('menu','մենյու','меню')
$$;

-- The same standing as a button press, from the chat's own binding. Anything short of that is an ordinary text, which gets
-- its next step. Passing keeps the row leased until channel_inbox_press_done, as a press does.
create function public._channel_inbox_receive_menu(r public.channel_inbox)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ep public.conversation_endpoints;
begin
 if r.endpoint_id is null then return public._channel_inbox_receive_text(r);end if;
 select * into ep from public.conversation_endpoints where id=r.endpoint_id for share;
 if not found or not ep.active or ep.generation<>r.endpoint_generation or ep.principal_ref<>r.principal_ref or ep.expires_at<=clock_timestamp()
  or not public._telegram_member_eligible(ep.member_id)then return public._channel_inbox_receive_text(r);end if;
 return jsonb_build_object('ok',true,'menu',jsonb_build_object('inboxId',r.id,'memberId',ep.member_id,'locale',public._telegram_auth_locale(ep.member_id)));
end$$;

create or replace function public.channel_inbox_process(p_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.channel_inbox;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform set_config('lock_timeout','3s',true);
 select * into r from public.channel_inbox where id=p_id for update;
 if not found or r.status<>'processing'then return jsonb_build_object('ok',false,'code','not_leased');end if;
 begin
  if r.kind='text'then
   if public._zoe_chat_actions_on()and public._channel_text_is_menu(r.payload->>'text')then return public._channel_inbox_receive_menu(r);end if;
   return public._channel_inbox_receive_text(r);
  elsif r.kind='media'then return public._channel_inbox_receive_media(r);
  elsif r.kind='link'then return public._telegram_auth_start(r);
  elsif r.kind='contact'then return public._telegram_auth_contact(r);
  elsif r.kind='callback'then return public._channel_inbox_receive_callback(r);
  elsif r.kind='start'then
   perform public._telegram_bot_next_step(r);
   return public._channel_inbox_finish(r.id,'done','ignored_start');
  else
   return public._channel_inbox_finish(r.id,'done','ignored_'||r.kind);
  end if;
 exception when others then
  update public.channel_inbox set last_error=sqlstate where id=r.id;
  return jsonb_build_object('ok',false,'code','retry','sqlstate',sqlstate);
 end;
end$$;

-- A /menu row ends here too. Only a row the process step left leased gets this far.
create or replace function public.channel_inbox_press_done(p_id uuid,p_result text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare n integer;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_id is null or coalesce(p_result,'')!~'^[a-z_]{1,48}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 update public.channel_inbox set status='done',result='press_'||p_result,processed_at=clock_timestamp(),lease_until=null,payload=payload-'intentRef'
  where id=p_id and(kind='callback'or(kind='text'and public._channel_text_is_menu(payload->>'text')))and status='processing';
 get diagnostics n=row_count;
 return jsonb_build_object('ok',n=1);
end$$;

revoke all on function public._channel_text_is_menu(text),public._channel_inbox_receive_menu(public.channel_inbox)from public,anon,authenticated,service_role;
