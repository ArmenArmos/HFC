-- Zoe chat cards: a member notice can open its task in the chat. The notice itself is unchanged: same outbox, same gates at claim
-- (quiet hours, freshness, a closed ask, consent), same record of delivery. Only its button differs: where the task has a card and
-- the chat can carry one, the button opens that card in the chat instead of a page. Any doubt, and the link button goes as before.
-- Dark with zoe_chat_actions_enabled, and only once the card template is approved, since the press posts a card.

-- The task card for a notice, or null: a released document has no card of its own, so it keeps its link.
create function public._zoe_chat_card_for_template(t text)returns text
language sql immutable set search_path=''as $$
 select case t when 'member.reminder_medicine'then 'dose' when 'member.reminder_bp_week'then 'bp' when 'member.medicine_ask'then 'ask'
  when 'member.results_received'then 'results' when 'member.plan_ready'then 'plan' when 'member.plan_updated'then 'plan'
  when 'member.ldl_retest_due'then 'ldl' when 'member.ldl_retest_overdue'then 'ldl' when 'member.ldl_result_with_doctor'then 'ldl' end
$$;

-- For a claimed notice: what its button should open, and the exact link it may be armed on. Null means the plain link button.
create function public.zoe_chat_card_notice(p_message uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m public.telegram_auth_messages;n public.member_notices;ep public.conversation_endpoints;k text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return null;end if;
 select * into m from public.telegram_auth_messages where id=p_message;
 if not found then return null;end if;
 select * into n from public.member_notices where telegram_message_id=p_message;
 if not found then return null;end if;
 k:=public._zoe_chat_card_for_template(m.template_id);
 if k is null or not exists(select 1 from public.system_message_templates where template_id='zoe.card'and locale=m.locale and free_body and approved)then return null;end if;
 select * into ep from public.conversation_endpoints where member_id=n.member_id and adapter='telegram'and active and expires_at>clock_timestamp()and principal_ref=m.principal_ref order by id limit 1;
 if not found then return null;end if;
 return jsonb_build_object('memberId',n.member_id,'endpointId',ep.id,'generation',ep.generation,'kind',k,'key',n.event_key,'locale',public._telegram_auth_locale(n.member_id));
end$$;

revoke all on function public._zoe_chat_card_for_template(text)from public,anon,authenticated,service_role;
revoke all on function public.zoe_chat_card_notice(uuid)from public,anon,authenticated;
grant execute on function public.zoe_chat_card_notice(uuid)to service_role;
