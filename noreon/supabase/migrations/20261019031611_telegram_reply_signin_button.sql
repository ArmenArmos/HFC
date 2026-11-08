-- The one-tap "Open Noreon" button on doctor replies and on Zoe's Telegram replies (lead decision,
-- 19 Oct 01:54, after Khikar got a doctor reply with no button). Until now a link was made only with
-- the auth outbox (next-step replies, member notices: 20261017131420, 20261017151240).
--  * A link can now belong to a system message (Zoe's texts) or a conversation delivery (doctor
--    replies) instead of an auth-outbox message: exactly one of the three.
--  * It is made and armed in one step at send time by telegram_signin_link_arm_reply, so no enqueue
--    function changes. Same rules as the other links: the member's active Telegram binding on the chat
--    the reply goes to, never a staff or clinic account, proof younger than 30 days, at most 5 links
--    per member per hour, the approved member "Open Noreon" label, 24 hours, single use, only the
--    token's hash stored, newest wins. When any rule says no, the reply is sent without a button.
--  * Zoe's urgent text (zoe.urgent) never carries it: that message is about calling 103.
--  * Both open the member's thread (/patient/zoe): step open_messages.

alter table public.telegram_signin_links alter column message_id drop not null,
 add column system_message_id uuid unique references public.system_messages(id)on delete cascade,
 add column delivery_id uuid unique references public.conversation_deliveries(id)on delete cascade,
 add constraint telegram_signin_links_one_source check(num_nonnulls(message_id,system_message_id,delivery_id)=1);
alter table public.telegram_signin_links drop constraint telegram_signin_links_step_check;
alter table public.telegram_signin_links add constraint telegram_signin_links_step_check
 check(step in('next_profile','next_questionnaire','next_review','replies_off','open_care','open_results','open_home','open_messages'));

-- Sender, after claiming a Zoe text ('system') or a doctor reply ('delivery'): make and arm its link.
create function public.telegram_signin_link_arm_reply(p_kind text,p_ref uuid,p_token_hash text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare u uuid;eid uuid;ep public.conversation_endpoints;tpl text;st text;b public.telegram_auth_bindings;s public.telegram_channel_settings;lbl text;lid uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_kind not in('system','delivery')or p_ref is null or coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 if p_kind='system'then
  select m.member_id,m.template_id,m.state,m.endpoint_id into u,tpl,st,eid from public.system_messages m where m.id=p_ref;
  -- Zoe's texts only; never the urgent one.
  if u is null or tpl not like 'zoe.%'or tpl='zoe.urgent'then return jsonb_build_object('ok',false,'code','none');end if;
 else
  select c.member_id,d.state,d.endpoint_id into u,st,eid from public.conversation_deliveries d join public.conversations c on c.id=d.conversation_id where d.id=p_ref;
  if u is null then return jsonb_build_object('ok',false,'code','none');end if;
 end if;
 select * into ep from public.conversation_endpoints where id=eid;
 if not found then return jsonb_build_object('ok',false,'code','none');end if;
 -- Only the send just claimed, once (a resend or a second sweep never makes another link).
 if st<>'sending'or ep.adapter<>'telegram'or not ep.active or ep.member_id<>u then return jsonb_build_object('ok',false,'code','none');end if;
 if exists(select 1 from public.workspace_staff where user_id=u)or exists(select 1 from public.clinic_portal_memberships where user_id=u)then return jsonb_build_object('ok',false,'code','none');end if;
 -- Bound to this chat: the member's active binding on the bot in use, for the reply's own principal.
 select * into s from public.telegram_channel_settings where singleton;
 select * into b from public.telegram_auth_bindings where auth_user_id=u and kind='member'and active and principal_ref=ep.principal_ref
  and account_ref=public._telegram_account_ref(s)and proven_at>clock_timestamp()-interval '30 days';
 if not found then return jsonb_build_object('ok',false,'code','none');end if;
 select body into lbl from public.system_message_templates where template_id='member_notice.open_label'and locale=public._telegram_auth_locale(u)and approved order by version desc limit 1;
 -- A Telegram button label is 1 to 64 UTF-16 units (as the adapter counts); anything else would make the adapter refuse the whole reply.
 if lbl is null or public._conversation_utf16(lbl)not between 1 and 64 or lbl<>btrim(lbl)then return jsonb_build_object('ok',false,'code','none');end if;
 -- Never wait for the binding while holding the member lock or link rows: an unlink or revoke holding it
 -- means no button this time (as in _member_notice; review F-1 of #325).
 begin
  perform 1 from public.telegram_auth_bindings where id=b.id for key share nowait;
 exception when lock_not_available then return jsonb_build_object('ok',false,'code','none');
 end;
 -- At most 5 links per member per hour (shared with the other links); over it, the reply goes without a button.
 perform pg_advisory_xact_lock(hashtextextended('telegram-signin-link:'||u::text,0));
 if exists(select 1 from public.telegram_signin_links where system_message_id=p_ref or delivery_id=p_ref)then return jsonb_build_object('ok',false,'code','none');end if;
 if(select count(*)from public.telegram_signin_links where auth_user_id=u and created_at>clock_timestamp()-interval '1 hour')>=5 then
  return jsonb_build_object('ok',false,'code','rate_limited');end if;
 -- Newest wins, as in telegram_signin_link_arm.
 update public.telegram_signin_links set state='cancelled'where auth_user_id=u and state='armed';
 insert into public.telegram_signin_links(auth_user_id,binding_id,binding_generation,principal_ref,step,system_message_id,delivery_id,token_hash,state,armed_at,expires_at)
 values(u,b.id,b.generation,b.principal_ref,'open_messages',case when p_kind='system'then p_ref end,case when p_kind='delivery'then p_ref end,
  p_token_hash,'armed',clock_timestamp(),clock_timestamp()+interval '24 hours')
 returning id into lid;
 -- A BEFORE INSERT rule may skip the row (lapsed proof); then there is no link.
 if lid is null then return jsonb_build_object('ok',false,'code','none');end if;
 perform public._telegram_auth_audit(u,'signin_link.armed',jsonb_build_object('linkId',lid,'step','open_messages','source',p_kind));
 return jsonb_build_object('ok',true,'step','open_messages','label',lbl);
end$$;
revoke all on function public.telegram_signin_link_arm_reply(text,uuid,text)from public,anon,authenticated,service_role;
grant execute on function public.telegram_signin_link_arm_reply(text,uuid,text)to service_role;

-- One lock per member for every link source (auth outbox, Zoe texts, doctor replies; review R2 of #325):
-- the 5-per-hour cap is checked under it on every insert (over it, no link row: the message goes without
-- one), and whenever a link becomes armed the member's other armed links are cancelled under it, so two
-- sends at once can never leave two live links or a sixth link in the hour.
create function public._telegram_signin_links_serial()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 -- Only an insert or a move to armed keeps an invariant; cancel, redeem, use and expiry never wait here while
 -- holding a row, so no writer can take the row first and the member lock second (review F-1 of #325).
 if not(tg_op='INSERT'or new.state='armed')then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('telegram-signin-link:'||new.auth_user_id::text,0));
 if tg_op='INSERT'and(select count(*)from public.telegram_signin_links where auth_user_id=new.auth_user_id and created_at>clock_timestamp()-interval '1 hour')>=5 then
  return null;end if;
 if new.state='armed'and(tg_op='INSERT'or old.state is distinct from 'armed')then
  update public.telegram_signin_links set state='cancelled'where auth_user_id=new.auth_user_id and state='armed'and id<>new.id;
 end if;
 return new;
end$$;
revoke all on function public._telegram_signin_links_serial()from public,anon,authenticated,service_role;
create trigger telegram_signin_links_serial before insert or update of state on public.telegram_signin_links
 for each row execute function public._telegram_signin_links_serial();

-- The two writers that change a link to armed take the member lock before the row (review F-1, F-2 of
-- #325). Both bodies are #314's (20261018212525: 30-day proof, abandon re-arms, newest wins) plus the lock,
-- so this migration must apply after it.
create or replace function public.telegram_signin_link_arm(p_message uuid,p_token_hash text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare l public.telegram_signin_links;m public.telegram_auth_messages;lbl text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 -- Member lock first, then the row (the order every link writer uses; review F-1 of #325).
 perform pg_advisory_xact_lock(hashtextextended('telegram-signin-link:'||l2.auth_user_id::text,0))from public.telegram_signin_links l2 where l2.message_id=p_message;
 select * into l from public.telegram_signin_links where message_id=p_message for update;
 if not found or l.state<>'pending'then return jsonb_build_object('ok',false,'code','none');end if;
 if not exists(select 1 from public.telegram_auth_bindings b where b.id=l.binding_id and b.active and b.generation=l.binding_generation
   and b.proven_at>clock_timestamp()-interval '30 days')then
  update public.telegram_signin_links set state='cancelled'where id=l.id;return jsonb_build_object('ok',false,'code','none');end if;
 -- The link travels only on an inline button: the message's own open_url button, or the approved
 -- member "Open Noreon" label for a message that has none.
 select * into m from public.telegram_auth_messages where id=p_message;
 if m.keyboard is null then
  select body into lbl from public.system_message_templates where template_id='member_notice.open_label'and locale=m.locale and approved order by version desc limit 1;
 end if;
 if not(m.keyboard->>'kind'is not distinct from 'open_url'or lbl is not null)then
  update public.telegram_signin_links set state='cancelled'where id=l.id;return jsonb_build_object('ok',false,'code','none');end if;
 -- Newest wins: the member's older armed links stop working (one in the middle of a redeem is left alone).
 update public.telegram_signin_links set state='cancelled'where auth_user_id=l.auth_user_id and state='armed'and id<>l.id;
 update public.telegram_signin_links set token_hash=p_token_hash,state='armed',armed_at=clock_timestamp(),expires_at=clock_timestamp()+interval '24 hours'where id=l.id;
 perform public._telegram_auth_audit(l.auth_user_id,'signin_link.armed',jsonb_build_object('linkId',l.id,'step',l.step));
 return jsonb_strip_nulls(jsonb_build_object('ok',true,'step',l.step,'label',lbl));
end$$;

create or replace function public.auth_code_request_abandon(p_request uuid,p_nonce_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare rearmed boolean;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 update public.auth_code_requests set state='unknown',updated_at=clock_timestamp()where id=p_request and nonce_hmac=p_nonce_hmac and state in('issuing','sending','sent');
 if not found then return jsonb_build_object('ok',true,'updated',false);end if;
 -- A one-tap link whose sign-in did not start (CAPTCHA, Auth rate limit) is armed again: single use is kept,
 -- since a link is used only after verifyOtp (review F-3, 19 Oct).
 -- Under the member lock, so a link armed at the same moment is seen (review F-2 of #325).
 perform pg_advisory_xact_lock(hashtextextended('telegram-signin-link:'||l2.auth_user_id::text,0))from public.telegram_signin_links l2 where l2.request_id=p_request;
 -- Newest wins, as in arm: when a newer link was armed meanwhile, this one is cancelled instead (review R314-1).
 update public.telegram_signin_links l set state='armed',redeem_nonce_hmac=null,request_id=null
  where l.request_id=p_request and l.redeem_nonce_hmac=p_nonce_hmac and l.state='redeeming'and l.expires_at>clock_timestamp()
   and not exists(select 1 from public.telegram_signin_links n where n.auth_user_id=l.auth_user_id and n.state='armed'and n.id<>l.id);
 rearmed:=found;
 if not rearmed then
  update public.telegram_signin_links set state='cancelled',redeem_nonce_hmac=null,request_id=null
   where request_id=p_request and redeem_nonce_hmac=p_nonce_hmac and state='redeeming';
 end if;
 return jsonb_build_object('ok',true,'updated',true,'rearmed',rearmed);
end$$;
