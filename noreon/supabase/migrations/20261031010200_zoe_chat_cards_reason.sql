-- Zoe chat cards: why a dose was missed, on Telegram. After a press on "missed", the same ask the app shows comes as a card with one
-- button per reason, and the answer goes through the same rules (once per ask; a side effect or stopping reaches the doctor's
-- list). The bodies move into internal functions; the session entry points are unchanged. Dark with zoe_chat_actions_enabled.

create function public._member_medicine_asks_read(uid uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if(select not enabled or not asks from public.member_medicine_settings where singleton)then return jsonb_build_object('version','medicine-asks-v1','enabled',false);end if;
 return jsonb_build_object('version','medicine-asks-v1','enabled',true,
  -- Eligibility now, not only when the ask opened (Astra MED-01): consent withdrawn, questions off or a takeover hide it.
  'asks',case when public._medicine_ask_blocked(uid)is not null then '[]'::jsonb else coalesce((select jsonb_agg(public._medicine_ask_json(a)order by a.created_at desc)from(
   select * from public.member_medicine_asks a where a.user_id=uid and a.state='open'and a.expires_at>clock_timestamp()
    order by a.created_at desc limit 3)a),'[]'::jsonb)end);
end$$;

create or replace function public.member_medicine_asks_read()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=auth.uid();
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 return public._member_medicine_asks_read(uid);
end$$;

create function public._member_medicine_ask_answer(uid uuid,p_ask uuid,p_reason text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a public.member_medicine_asks;nxt text;
begin
 if(select not enabled or not asks from public.member_medicine_settings where singleton)then return jsonb_build_object('status','disabled');end if;
 if p_reason is null or p_reason not in('forgot','side_effect','cost_or_availability','ran_out','decided_to_stop')then return jsonb_build_object('status','invalid');end if;
 select * into a from public.member_medicine_asks where id=p_ask and user_id=uid for update;
 if not found then return jsonb_build_object('status','not-found');end if;
 nxt:=case p_reason when 'forgot'then 'reminders'when 'side_effect'then 'doctor'when 'decided_to_stop'then 'doctor'else 'refill'end;
 if a.state='answered'then
  if a.reason=p_reason then return jsonb_build_object('status','answered','reason',a.reason,'next',nxt,'replayed',true);end if;
  return jsonb_build_object('status','closed');
 end if;
 if a.state<>'open'or a.expires_at<=clock_timestamp()or public._medicine_ask_blocked(uid)is not null then return jsonb_build_object('status','closed');end if;
 update public.member_medicine_asks set state='answered',reason=p_reason,answered_at=clock_timestamp()where id=a.id;
 if p_reason in('side_effect','decided_to_stop')then
  insert into public.member_medicine_concerns(user_id,ask_id,kind)values(uid,a.id,p_reason);
 end if;
 return jsonb_build_object('status','answered','reason',p_reason,'next',nxt,'replayed',false);
end$$;

create or replace function public.member_medicine_ask_answer(p_ask uuid,p_reason text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 return public._member_medicine_ask_answer(uid,p_ask,p_reason);
end$$;

-- Service role only, for a member a channel adapter verified.
create function public.member_medicine_asks_read_for(p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or not public._telegram_member_eligible(p_member)then return jsonb_build_object('version','medicine-asks-v1','enabled',false);end if;
 return public._member_medicine_asks_read(p_member);
end$$;
create function public.member_medicine_ask_answer_for(p_member uuid,p_ask uuid,p_reason text)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or not public._telegram_member_eligible(p_member)then return jsonb_build_object('status','disabled');end if;
 return public._member_medicine_ask_answer(p_member,p_ask,p_reason);
end$$;

-- One ask, by id, for a notice's button: this member's, still open, under the same eligibility as the list. Null means it has closed.
create function public._member_medicine_ask_open(uid uuid,p_ask uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare a public.member_medicine_asks;
begin
 if(select not enabled or not asks from public.member_medicine_settings where singleton)or public._medicine_ask_blocked(uid)is not null then return null;end if;
 select * into a from public.member_medicine_asks where id=p_ask and user_id=uid and state='open'and expires_at>clock_timestamp();
 return case when found then public._medicine_ask_json(a)end;
end$$;
create function public.member_medicine_ask_open_for(p_member uuid,p_ask uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or not public._telegram_member_eligible(p_member)then return null;end if;
 return public._member_medicine_ask_open(p_member,p_ask);
end$$;
create function public.member_medicine_ask_mine(p_ask uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=auth.uid();
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 return public._member_medicine_ask_open(uid,p_ask);
end$$;

alter table public.zoe_chat_cards drop constraint zoe_chat_cards_kind_check;
alter table public.zoe_chat_cards add constraint zoe_chat_cards_kind_check check(kind in('dose','bp','results','plan','visit','side_effect','message','menu','ldl','ask'));
alter table public.zoe_chat_card_intents drop constraint zoe_chat_card_intents_action_check;
alter table public.zoe_chat_card_intents add constraint zoe_chat_card_intents_action_check check(action in('dose_taken','dose_skipped','bp_save','open_card','show_current','visit_accept','ldl_visit_accept','ask_reason'));

revoke all on function public._member_medicine_asks_read(uuid),public._member_medicine_ask_answer(uuid,uuid,text)from public,anon,authenticated,service_role;
revoke all on function public.member_medicine_asks_read_for(uuid),public.member_medicine_ask_answer_for(uuid,uuid,text)from public,anon,authenticated;
revoke all on function public._member_medicine_ask_open(uuid,uuid)from public,anon,authenticated,service_role;
revoke all on function public.member_medicine_ask_open_for(uuid,uuid),public.member_medicine_ask_mine(uuid)from public,anon,authenticated;
grant execute on function public.member_medicine_ask_mine(uuid)to authenticated;
grant execute on function public.member_medicine_asks_read_for(uuid),public.member_medicine_ask_answer_for(uuid,uuid,text),public.member_medicine_ask_open_for(uuid,uuid)to service_role;
