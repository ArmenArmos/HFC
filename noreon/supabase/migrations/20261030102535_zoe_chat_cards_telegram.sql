-- Zoe chat cards in Telegram (Khikar 30 Oct 2026, phase 1A: one card and action layer, two channels). The first task is
-- the dose; the app and Telegram run the same command (lib/zoe-chat-actions/commands.ts) with an independently verified
-- actor. Dark: everything here needs conversation_policy.zoe_chat_actions_enabled, as the app cards do, and a card text
-- needs the approved 'zoe.card' template to leave.
--
-- Who pressed (the one rule of this file): callback data is an opaque random reference, never a command and never an
-- identity. The member comes from the chat's own binding, checked here against the generation the press arrived under,
-- and the reference must have been issued to that same member, endpoint and generation. Nothing Telegram sends and
-- nothing the caller passes can name a member on this path.
--
-- Saved is not delivered: a press is durable in channel_inbox until its command finished; the card message goes through
-- the system-message outbox (one send, unknown is never resent). The write is the card's claim, so a redelivered or
-- repeated press replays and a delivery timeout repeats nothing.

-- 1. The member's medicines for a verified actor -----------------------------------------------------------------------
-- The bodies move into internal functions with the member as an argument (no API grant); the session entry points are
-- unchanged, and the service entry points exist for a channel that has no member session.

create function public._member_medicines_read(uid uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare s public.member_medicine_settings;
begin
 select * into s from public.member_medicine_settings where singleton;
 if not s.enabled then return jsonb_build_object('version','member-medicines-v1','enabled',false);end if;
 return jsonb_build_object('version','member-medicines-v1','enabled',true,
  'medicines',coalesce((select jsonb_agg(public._member_medicine_json(m,clock_timestamp()-interval '8 days')order by m.stopped_at nulls first,m.created_at)
   from public.member_medicines m where m.user_id=uid and(m.stopped_at is null or m.stopped_at>clock_timestamp()-interval '30 days')),'[]'::jsonb));
end$$;
create or replace function public.member_medicines_read()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=auth.uid();
begin
 if uid is null then raise insufficient_privilege;end if;
 return public._member_medicines_read(uid);
end$$;

create function public._member_medicine_dose_report(uid uuid,p_medicine uuid,p_due_at timestamptz,p_status text,p_expected_revision integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.member_medicines;local timestamp;d public.member_medicine_doses;rev integer;
begin
 if not(select enabled from public.member_medicine_settings where singleton)then return jsonb_build_object('status','disabled');end if;
 if p_status is null or p_status not in('taken','skipped')or p_due_at is null or not isfinite(p_due_at)or p_expected_revision is null or p_expected_revision<0
  then return jsonb_build_object('status','invalid');end if;
 select * into m from public.member_medicines where id=p_medicine and user_id=uid for share;
 if not found then raise insufficient_privilege;end if;
 local:=p_due_at at time zone 'Asia/Yerevan';
 if not(local::time=any(m.times))or local::date<m.started_on or p_due_at>clock_timestamp()+interval '60 minutes'
  or p_due_at<clock_timestamp()-interval '3 days'or(m.stopped_at is not null and p_due_at>=m.stopped_at)or(m.effective_at is not null and p_due_at<m.effective_at)then return jsonb_build_object('status','not-due');end if;
 select * into d from public.member_medicine_doses where medicine_id=m.id and due_at=p_due_at for update;
 if not found then
  if p_expected_revision<>0 then return jsonb_build_object('status','conflict');end if;
  insert into public.member_medicine_doses(medicine_id,user_id,due_at,status)values(m.id,uid,p_due_at,p_status)
   on conflict(medicine_id,due_at)do nothing returning revision into rev;
  if rev is null then return jsonb_build_object('status','conflict');end if;
  return jsonb_build_object('status','saved','revision',rev);
 end if;
 if d.revision<>p_expected_revision then return jsonb_build_object('status','conflict');end if;
 if d.status=p_status then return jsonb_build_object('status','saved','revision',d.revision);end if;
 update public.member_medicine_doses set status=p_status,recorded_at=clock_timestamp(),revision=revision+1 where medicine_id=m.id and due_at=p_due_at returning revision into rev;
 return jsonb_build_object('status','saved','revision',rev);
end$$;
create or replace function public.member_medicine_dose_report(p_medicine uuid,p_due_at timestamptz,p_status text,p_expected_revision integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 return public._member_medicine_dose_report(uid,p_medicine,p_due_at,p_status,p_expected_revision);
end$$;

-- Service role only, for a member a channel adapter verified. Ineligible (phone gone, banned, staff) reads as off.
create function public.member_medicines_read_for(p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or not public._telegram_member_eligible(p_member)then return jsonb_build_object('version','member-medicines-v1','enabled',false);end if;
 return public._member_medicines_read(p_member);
end$$;
create function public.member_medicine_dose_report_for(p_member uuid,p_medicine uuid,p_due_at timestamptz,p_status text,p_expected_revision integer)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or not public._telegram_member_eligible(p_member)then return jsonb_build_object('status','disabled');end if;
 return public._member_medicine_dose_report(p_member,p_medicine,p_due_at,p_status,p_expected_revision);
end$$;

-- 2. Card text and what a button means ---------------------------------------------------------------------------------

-- Card text is built from the card's snapshot, so the template holds no wording of its own. Held at claim until approved.
insert into public.system_message_templates(template_id,version,locale,body,free_body,approval_note)values
 ('zoe.card',1,'en','UNAPPROVED PLACEHOLDER. Zoe chat card.',true,'Card wording (lib/zoe-chat-actions/copy.ts) pending Tatevik; approve per environment'),
 ('zoe.card',1,'hy','UNAPPROVED PLACEHOLDER. Zoe chat card.',true,'Card wording (lib/zoe-chat-actions/copy.ts) pending Tatevik; approve per environment');

-- Which outbox message carries which card. Apart from system_messages, whose rows are frozen.
create table public.zoe_chat_card_sends (
 system_message_id uuid primary key references public.system_messages(id)on delete cascade,
 card_id uuid not null references public.zoe_chat_cards(id)on delete cascade,
 created_at timestamptz not null default clock_timestamp()
);
create index zoe_chat_card_sends_card on public.zoe_chat_card_sends(card_id);

-- One button: an action on one card, valid only for the member, endpoint and link generation it was issued to.
-- Only the digest of the reference is kept; the reference itself rides in the button's callback data.
create table public.zoe_chat_card_intents (
 ref_hash text primary key check(ref_hash~'^[a-f0-9]{64}$'),
 member_id uuid not null references auth.users(id)on delete cascade,
 endpoint_id uuid not null references public.conversation_endpoints(id)on delete cascade,
 endpoint_generation bigint not null,
 card_id uuid not null references public.zoe_chat_cards(id)on delete cascade,
 action text not null check(action in('dose_taken','dose_skipped','show_current')),
 item jsonb not null default '{}'check(jsonb_typeof(item)='object'and octet_length(item::text)<=400),
 expires_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 check(expires_at>created_at)
);
create index zoe_chat_card_intents_member on public.zoe_chat_card_intents(member_id,expires_at);
comment on table public.zoe_chat_card_intents is
 'Telegram card buttons: opaque references, resolved only for the member, endpoint and link generation they were issued to. Deleted with the account.';
-- Member messages the sweep has already looked at and posted no card for. Ids only; kept a day.
create table public.zoe_chat_card_scans (
 member_id uuid not null references auth.users(id)on delete cascade,
 seq bigint not null,
 scanned_at timestamptz not null default clock_timestamp(),
 primary key(member_id,seq)
);
alter table public.zoe_chat_card_sends enable row level security;
alter table public.zoe_chat_card_intents enable row level security;
alter table public.zoe_chat_card_scans enable row level security;
revoke all on public.zoe_chat_card_sends,public.zoe_chat_card_intents,public.zoe_chat_card_scans from public,anon,authenticated,service_role;

-- 3. The press: from the inbox to a verified actor -----------------------------------------------------------------------

-- A callback now carries its query id and the opaque reference; the rest of the event rules are unchanged.
create or replace function public.channel_inbox_commit(p_event jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.telegram_channel_settings;kind text:=p_event->>'kind';ep public.conversation_endpoints;existing public.channel_inbox;inserted uuid;payload jsonb:=p_event->'payload';
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if jsonb_typeof(p_event)is distinct from 'object'or p_event-array['adapter','eventId','fingerprint','principalRef','kind','payload']<>'{}'
 or not(p_event?&array['adapter','eventId','fingerprint','principalRef','kind','payload'])
 or p_event->>'adapter'is distinct from 'telegram'or coalesce(kind,'')not in('text','link','start','callback','media','contact')
 or jsonb_typeof(p_event->'eventId')is distinct from 'string'or jsonb_typeof(p_event->'fingerprint')is distinct from 'string'or jsonb_typeof(p_event->'principalRef')is distinct from 'string'
 or length(p_event->>'eventId')not between 1 and 256 or length(p_event->>'fingerprint')not between 1 and 256 or length(p_event->>'principalRef')not between 1 and 256
 or jsonb_typeof(payload)is distinct from 'object'
 or(kind='text'and(payload-array['text','chatId','messageId']<>'{}'or jsonb_typeof(payload->'text')is distinct from 'string'or public._conversation_utf16(payload->>'text')not between 1 and 4096))
 or(kind='link'and(payload-array['tokenHash','chatId','messageId']<>'{}'or coalesce(payload->>'tokenHash','')!~'^[a-f0-9]{64}$'))
 or(kind='contact'and(jsonb_typeof(payload->'sentAt')is distinct from 'number'or not(
  (payload-array['phone','sentAt','chatId','messageId']='{}'and coalesce(payload->>'phone','')~'^\+[1-9][0-9]{6,14}$')
  or(payload-array['foreign','sentAt','chatId','messageId']='{}'and payload->'foreign'='true'::jsonb))))
 or(kind in('start','media')and payload-array['chatId','messageId']<>'{}')
 or(kind='callback'and(payload-array['chatId','messageId','callbackId','intentRef']<>'{}'
  or jsonb_typeof(payload->'callbackId')is distinct from 'string'or coalesce(payload->>'callbackId','')!~'^[A-Za-z0-9_-]{1,128}$'
  or jsonb_typeof(payload->'intentRef')is distinct from 'string'or coalesce(payload->>'intentRef','')!~'^[A-Za-z0-9_-]{16,60}$'))
 or jsonb_typeof(payload->'chatId')is distinct from 'number'or jsonb_typeof(payload->'messageId')is distinct from 'number'
 then return jsonb_build_object('status','failed','code','invalid_event');end if;
 select * into s from public.telegram_channel_settings where singleton;
 if not found then return jsonb_build_object('status','failed','code','unavailable');end if;
 if p_event->>'principalRef'<>public._telegram_principal_ref(s,(payload->>'chatId')::bigint)then return jsonb_build_object('status','failed','code','foreign_principal');end if;
 select * into ep from public.conversation_endpoints where adapter='telegram'and account_ref=public._telegram_account_ref(s)and principal_ref=p_event->>'principalRef'and active;
 insert into public.channel_inbox(adapter,event_id,fingerprint,principal_ref,kind,payload,endpoint_id,endpoint_generation)
 values('telegram',p_event->>'eventId',p_event->>'fingerprint',p_event->>'principalRef',kind,payload,ep.id,ep.generation)
 on conflict(event_id)do nothing returning id into inserted;
 if inserted is not null then
  return jsonb_build_object('status','committed','eventId',p_event->>'eventId','fingerprint',p_event->>'fingerprint');end if;
 select * into existing from public.channel_inbox where event_id=p_event->>'eventId';
 if existing.fingerprint=p_event->>'fingerprint'then
  return jsonb_build_object('status','committed-duplicate','eventId',existing.event_id,'fingerprint',existing.fingerprint);end if;
 perform public._telegram_audit(null,'inbox.conflict',jsonb_build_object('inboxId',existing.id));
 return jsonb_build_object('status','conflict');
exception when numeric_value_out_of_range or invalid_text_representation then return jsonb_build_object('status','failed','code','invalid_event');
end$$;

-- Ends a press with nothing done. The caller answers the button with this code's wording and nothing else.
create function public._channel_inbox_press_refused(r public.channel_inbox,m uuid,p_code text)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform public._channel_inbox_finish(r.id,'done','press_'||p_code);
 update public.channel_inbox set payload=payload-'intentRef'where id=r.id;
 perform public._telegram_audit(m,'card.press_refused',jsonb_build_object('inboxId',r.id,'code',p_code));
 return jsonb_build_object('ok',true,'refused',jsonb_build_object('code',p_code,'callbackId',r.payload->>'callbackId','locale',public._telegram_auth_locale(m)));
end$$;

-- A button press. Passing returns the verified press and keeps the row leased until channel_inbox_press_done: the command
-- runs in the sweep, and a crash re-leases the row, rechecks all of this, and replays through the card's claim.
create function public._channel_inbox_receive_callback(r public.channel_inbox)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ep public.conversation_endpoints;i public.zoe_chat_card_intents;bound uuid;
begin
 -- The chat is not linked: the same next step as a text from it, and the press does nothing. A chat still bound for
 -- sign-in is answered in its member's language; that binding gives this press no other standing.
 if r.endpoint_id is null then
  select b.auth_user_id into bound from public.telegram_auth_bindings b where b.principal_ref=r.principal_ref and b.active and b.kind='member';
  perform public._telegram_bot_next_step(r);
  return public._channel_inbox_press_refused(r,bound,'not_linked');
 end if;
 select * into ep from public.conversation_endpoints where id=r.endpoint_id for share;
 -- G2: the endpoint must still be the exact generation the press arrived under.
 if not found or not ep.active or ep.generation<>r.endpoint_generation or ep.principal_ref<>r.principal_ref then
  perform public._telegram_audit(ep.member_id,'inbox.generation_mismatch',jsonb_build_object('inboxId',r.id));
  return public._channel_inbox_press_refused(r,null,'not_linked');end if;
 if ep.expires_at<=clock_timestamp()then return public._channel_inbox_press_refused(r,ep.member_id,'binding_expired');end if;
 if not public._telegram_member_eligible(ep.member_id)then return public._channel_inbox_press_refused(r,ep.member_id,'not_eligible');end if;
 if not public._zoe_chat_actions_on()then return public._channel_inbox_press_refused(r,ep.member_id,'disabled');end if;
 select * into i from public.zoe_chat_card_intents where ref_hash=encode(sha256(convert_to(r.payload->>'intentRef','UTF8')),'hex');
 -- Unknown, or issued to anyone else or to an earlier link: the same answer, so a guess learns nothing.
 if not found or i.member_id<>ep.member_id or i.endpoint_id<>ep.id or i.endpoint_generation<>ep.generation then
  return public._channel_inbox_press_refused(r,ep.member_id,'unknown');end if;
 if i.expires_at<=clock_timestamp()then return public._channel_inbox_press_refused(r,ep.member_id,'expired');end if;
 return jsonb_build_object('ok',true,'press',jsonb_build_object('inboxId',r.id,'callbackId',r.payload->>'callbackId','chatId',r.payload->'chatId','messageId',r.payload->'messageId',
  'memberId',ep.member_id,'endpointId',ep.id,'generation',ep.generation,'cardId',i.card_id,'action',i.action,'item',i.item,'locale',public._telegram_auth_locale(ep.member_id)));
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
  if r.kind='text'then return public._channel_inbox_receive_text(r);
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

-- The press's command finished (saved or not): the row is done, whatever becomes of the answer to Telegram.
create function public.channel_inbox_press_done(p_id uuid,p_result text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare n integer;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_id is null or coalesce(p_result,'')!~'^[a-z_]{1,48}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 update public.channel_inbox set status='done',result='press_'||p_result,processed_at=clock_timestamp(),lease_until=null,payload=payload-'intentRef'
  where id=p_id and kind='callback'and status='processing';
 get diagnostics n=row_count;
 return jsonb_build_object('ok',n=1);
end$$;

-- 4. The card in the chat --------------------------------------------------------------------------------------------

-- One of the member's cards for a verified actor (the session path reads through RLS).
create function public.zoe_chat_card_get(p_member uuid,p_card uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare k public.zoe_chat_cards;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into k from public.zoe_chat_cards where id=p_card and member_id=p_member;
 if not found then return null;end if;
 return public._zoe_chat_card_json(k);
end$$;

-- Queues a card's text for the member's own linked chat, once per inbox event. The body is frozen here and checked again
-- at claim with the route, the template approval and the generation, like every system message.
create function public.zoe_chat_card_send(p_member uuid,p_card uuid,p_inbox uuid,p_body text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ep public.conversation_endpoints;t public.system_message_templates;l text;new_id uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('ok',false,'code','disabled');end if;
 if p_inbox is null or p_body is null or p_body<>btrim(p_body,E' \n\r\t')or length(p_body)<1 then return jsonb_build_object('ok',false,'code','invalid');end if;
 if not exists(select 1 from public.zoe_chat_cards where id=p_card and member_id=p_member)then return jsonb_build_object('ok',false,'code','not_found');end if;
 select * into ep from public.conversation_endpoints where member_id=p_member and adapter='telegram'and active and expires_at>clock_timestamp()order by id limit 1 for share;
 if not found then return jsonb_build_object('ok',false,'code','no_route');end if;
 if public._conversation_utf16(p_body)>ep.max_utf16 then return jsonb_build_object('ok',false,'code','invalid');end if;
 select coalesce((select locale from public.profiles where id=p_member),'hy')into l;
 select * into t from public.system_message_templates where template_id='zoe.card'and locale=l and free_body order by version desc limit 1;
 if not found then return jsonb_build_object('ok',false,'code','unavailable');end if;
 insert into public.system_messages(member_id,template_id,template_version,locale,body,body_hash,endpoint_id,endpoint_generation,source_inbox_id)
 values(p_member,t.template_id,t.version,t.locale,p_body,public._system_message_hash(t.template_id,t.version,t.locale,p_body),ep.id,ep.generation,p_inbox)
 on conflict(source_inbox_id,template_id)do nothing returning id into new_id;
 if new_id is null then return jsonb_build_object('ok',true,'replayed',true);end if;
 insert into public.zoe_chat_card_sends(system_message_id,card_id)values(new_id,p_card);
 perform public._system_message_audit(new_id,'enqueued',jsonb_build_object('template',t.template_id,'version',t.version,'locale',t.locale));
 return jsonb_build_object('ok',true,'replayed',false);
end$$;

-- The card a claimed system message carries, for its buttons at dispatch; null for any other message.
create function public.zoe_chat_card_for_message(p_message uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare k public.zoe_chat_cards;sm public.system_messages;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select c.* into k from public.zoe_chat_card_sends s join public.zoe_chat_cards c on c.id=s.card_id where s.system_message_id=p_message;
 if not found then return null;end if;
 select * into sm from public.system_messages where id=p_message;
 return jsonb_build_object('card',public._zoe_chat_card_json(k),'memberId',k.member_id,'endpointId',sm.endpoint_id,'generation',sm.endpoint_generation,'locale',sm.locale);
end$$;

-- Issues the references for one card's buttons, in order, for exactly the link the caller is about to write to: the press's
-- or the claimed message's endpoint and generation. If that link has gone (Astra MC-01), the answer is no_route and the
-- caller sends nothing, so a card never reaches a chat that was unlinked or rebound since it was verified. Called just
-- before a send or an edit; the reference is returned once and only its digest is kept. Lapsed ones are cleared on the way.
create function public.zoe_chat_card_arm(p_member uuid,p_card uuid,p_endpoint uuid,p_generation bigint,p_buttons jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ep public.conversation_endpoints;b jsonb;ref text;refs jsonb:='[]';
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return jsonb_build_object('ok',false,'code','disabled');end if;
 if jsonb_typeof(p_buttons)is distinct from 'array'or jsonb_array_length(p_buttons)>8 then return jsonb_build_object('ok',false,'code','invalid');end if;
 if not exists(select 1 from public.zoe_chat_cards where id=p_card and member_id=p_member)then return jsonb_build_object('ok',false,'code','not_found');end if;
 select * into ep from public.conversation_endpoints where id=p_endpoint and member_id=p_member and generation=p_generation and adapter='telegram'and active and expires_at>clock_timestamp()for share;
 if not found then return jsonb_build_object('ok',false,'code','no_route');end if;
 delete from public.zoe_chat_card_intents where member_id=p_member and expires_at<=clock_timestamp();
 begin
  for b in select * from jsonb_array_elements(p_buttons)loop
   ref:=translate(encode(extensions.gen_random_bytes(18),'base64'),'+/','-_');
   insert into public.zoe_chat_card_intents(ref_hash,member_id,endpoint_id,endpoint_generation,card_id,action,item,expires_at)
   values(encode(sha256(convert_to(ref,'UTF8')),'hex'),p_member,ep.id,ep.generation,p_card,b->>'action',coalesce(b->'item','{}'),clock_timestamp()+interval '48 hours');
   refs:=refs||to_jsonb(ref);
  end loop;
 exception when check_violation or not_null_violation then return jsonb_build_object('ok',false,'code','invalid');
 end;
 return jsonb_build_object('ok',true,'refs',refs);
end$$;

-- Telegram members' newest messages that Zoe's run has just cleared (the same rule as the app's typed offer), not yet
-- settled: a card already queued settles one (a card whose message failed to queue comes back, Astra MC-02), and so does
-- a look that found no card to post (zoe_chat_card_telegram_settle), so ordinary messages never use up the scan (MC-03).
-- The sweep reads their words for the card intent; nothing here decides anything about safety.
create function public.zoe_chat_card_telegram_candidates(p_limit integer)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._zoe_chat_actions_on()then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('memberId',q.member_id,'seq',q.seq,'requestId',q.request_id,'text',q.body,'locale',q.locale))from(
  select c.member_id,m.seq,m.request_id,m.body,public._telegram_auth_locale(c.member_id)locale
  from public.zoe_runs z join public.conversations c on c.id=z.conversation_id
  join public.conversation_messages m on m.conversation_id=z.conversation_id and m.seq=z.message_seq
  where z.state='finished'and z.started_at>clock_timestamp()-interval '30 minutes'and z.finished_at>clock_timestamp()-interval '15 minutes'
   and m.source='telegram_member'and public._zoe_chat_message_cleared(c.member_id,m.seq)
   and not exists(select 1 from public.zoe_chat_card_scans x where x.member_id=c.member_id and x.seq=m.seq)
   and not exists(select 1 from public.zoe_chat_cards x join public.zoe_chat_card_sends y on y.card_id=x.id where x.member_id=c.member_id and x.source_seq=m.seq)
   and exists(select 1 from public.conversation_endpoints e where e.member_id=c.member_id and e.adapter='telegram'and e.active and e.expires_at>clock_timestamp())
  order by z.finished_at limit greatest(1,least(coalesce(p_limit,20),50)))q),'[]'::jsonb);
end$$;

-- The sweep has looked at this message and there is no card to post for it.
create function public.zoe_chat_card_telegram_settle(p_member uuid,p_seq bigint)returns void
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 delete from public.zoe_chat_card_scans where member_id=p_member and scanned_at<clock_timestamp()-interval '1 day';
 insert into public.zoe_chat_card_scans(member_id,seq)values(p_member,p_seq)on conflict do nothing;
end$$;

revoke all on function public._member_medicines_read(uuid),public._member_medicine_dose_report(uuid,uuid,timestamptz,text,integer),
 public._channel_inbox_press_refused(public.channel_inbox,uuid,text),public._channel_inbox_receive_callback(public.channel_inbox)from public,anon,authenticated,service_role;
revoke all on function public.member_medicines_read_for(uuid),public.member_medicine_dose_report_for(uuid,uuid,timestamptz,text,integer),
 public.channel_inbox_press_done(uuid,text),public.zoe_chat_card_get(uuid,uuid),public.zoe_chat_card_send(uuid,uuid,uuid,text),
 public.zoe_chat_card_for_message(uuid),public.zoe_chat_card_arm(uuid,uuid,uuid,bigint,jsonb),public.zoe_chat_card_telegram_candidates(integer),public.zoe_chat_card_telegram_settle(uuid,bigint)from public,anon,authenticated;
grant execute on function public.member_medicines_read_for(uuid),public.member_medicine_dose_report_for(uuid,uuid,timestamptz,text,integer),
 public.channel_inbox_press_done(uuid,text),public.zoe_chat_card_get(uuid,uuid),public.zoe_chat_card_send(uuid,uuid,uuid,text),
 public.zoe_chat_card_for_message(uuid),public.zoe_chat_card_arm(uuid,uuid,uuid,bigint,jsonb),public.zoe_chat_card_telegram_candidates(integer),public.zoe_chat_card_telegram_settle(uuid,bigint)to service_role;
