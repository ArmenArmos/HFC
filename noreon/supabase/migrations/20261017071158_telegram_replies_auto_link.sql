-- Doctor messaging in Telegram without a separate connect/consent step (Khikar, 17 Oct 2026).
-- Members are a limited, enrolled group whose consent is collected at enrolment, so a member
-- whose Telegram account is their sign-in channel (active member binding) is linked for
-- replies to that same chat automatically, once eligible for messaging (an enrolled clinical
-- case). The endpoint records consent_source='enrolment'. A member who turned replies off is
-- never relinked automatically (whichever Telegram account they use); only they turn replies
-- back on. Zoe consents (K4) are separate and unchanged.

-- Endpoints that exist today were linked with the explicit in-app consent checkbox; every new
-- link (automatic, or the remaining Connect button for members without Telegram sign-in) relies
-- on the consent given at enrolment.
alter table public.conversation_endpoints add column consent_source text not null default 'telegram_link'check(consent_source in('telegram_link','enrolment'));
alter table public.conversation_endpoints alter column consent_source set default 'enrolment';
-- Any (re)link from now on relies on the enrolment consent, including a reused endpoint row
-- (review M-1: `_telegram_replies_activate` updates an existing row for the same principal).
create function public._conversation_endpoint_consent_source()returns trigger language plpgsql set search_path=''as $$
begin
 if new.active and(not old.active or new.member_id<>old.member_id)then new.consent_source:='enrolment';end if;
 return new;
end$$;
create trigger conversation_endpoint_consent_source before update on public.conversation_endpoints for each row execute function public._conversation_endpoint_consent_source();

create function public._telegram_replies_auto(m uuid,p_explicit boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare b public.telegram_auth_bindings;act jsonb;s public.telegram_channel_settings;ep public.conversation_endpoints;
begin
 -- Same member lock as linking and unlinking, so two automatic calls never link twice.
 perform pg_advisory_xact_lock(hashtextextended('telegram-member:'||m::text,0));
 if exists(select 1 from public.conversation_endpoints where member_id=m and adapter='telegram'and active)then
  return jsonb_build_object('ok',true,'result','already_linked');end if;
 select * into b from public.telegram_auth_bindings where auth_user_id=m and kind='member'and active;
 if not found then return jsonb_build_object('ok',false,'code','telegram_not_connected');end if;
 -- The binding must belong to the bot in use now (review M-5: a bot change leaves old bindings).
 select * into s from public.telegram_channel_settings where singleton;
 if not found or b.account_ref is distinct from public._telegram_account_ref(s)then return jsonb_build_object('ok',false,'code','unavailable');end if;
 if not public._telegram_member_eligible(m)then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 -- The member's own "off" stands until they turn replies on again, whatever Telegram account or
 -- proof comes later (review I-1): their latest unlink is newer than their latest link.
 if not p_explicit and coalesce((select max(created_at)from public.telegram_audit where member_id=m and kind='link.unlinked'),'-infinity')
  >coalesce((select max(created_at)from public.telegram_audit where member_id=m and kind='link.redeemed'),'-infinity')then
  return jsonb_build_object('ok',false,'code','turned_off');end if;
 act:=public._telegram_replies_activate(m,b.id);
 if act->>'ok'<>'true'then return act;end if;
 update public.conversation_endpoints set consent_source='enrolment'where id=(act->>'endpointId')::uuid returning * into ep;
 perform public._telegram_audit(m,'link.auto_enrolment',jsonb_build_object('endpointId',ep.id,'bindingId',b.id,'explicit',p_explicit,
  'enrolmentConsent',(select version from public.patient_consents where user_id=m order by accepted_at desc limit 1)));
 -- Same confirmation (with the emergency notice) as the manual link (review I-2); held until approved.
 perform public._system_message_enqueue('telegram.link_confirmed',m,ep,null);
 return jsonb_build_object('ok',true,'result','linked','endpointId',act->>'endpointId');
end$$;

-- Service: right after a verified Telegram sign-in (the app passes the signed-in user).
create function public.telegram_replies_auto_link_for(p_user uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_user is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 return public._telegram_replies_auto(p_user,false);
end$$;
-- Member: on viewing the Telegram page or after enrolment (automatic), or pressing
-- "Turn on replies" (explicit, overrides their own earlier turn-off).
create function public.telegram_replies_auto_link(p_explicit boolean default false)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'authenticated'or auth.uid()is null then raise insufficient_privilege;end if;
 return public._telegram_replies_auto(auth.uid(),coalesce(p_explicit,false));
end$$;

revoke all on function public._conversation_endpoint_consent_source(),public._telegram_replies_auto(uuid,boolean),public.telegram_replies_auto_link_for(uuid),public.telegram_replies_auto_link(boolean)from public,anon,authenticated,service_role;
grant execute on function public.telegram_replies_auto_link_for(uuid)to service_role;
grant execute on function public.telegram_replies_auto_link(boolean)to authenticated;
