-- Telegram T1 foundation: member link tokens, durable channel inbox, system-message
-- outbox, doctor alerts and the CR2/CR3/CR5 conversation corrections.
--
-- Ships dark. No channel settings row and no approved message template are seeded,
-- and conversation_policy stays unseeded, so linking, receiving and every send fail
-- closed until a later reviewed activation migration (decisions D1, D3, D4, D5).
-- Every table has RLS with no direct API grants; access is through the
-- security-definer functions below only.

-- 1. Channel settings ------------------------------------------------------------

-- One configured bot. Its account and numeric ID namespace every principal
-- reference; renaming either is a migration that orphans existing links (G6).
create table public.telegram_channel_settings (
 singleton boolean primary key default true check(singleton),
 account text not null check(account ~ '^[A-Za-z0-9_-]{1,64}$'),
 bot_id bigint not null check(bot_id>0),
 link_token_seconds integer not null check(link_token_seconds between 60 and 3600),
 consent_version text not null check(length(consent_version) between 1 and 64)
);

-- The exact principal reference the adapter derives for a Telegram user of the
-- configured bot (lib/telegram-channel/protocol.ts telegramPrincipalRef).
create function public._telegram_principal_ref(s public.telegram_channel_settings,user_id bigint)returns text
language sql immutable set search_path=''as $$
 select format('["telegram",%s,%s,"user",%s]',to_json(s.account)::text,s.bot_id,user_id)
$$;
create function public._telegram_account_ref(s public.telegram_channel_settings)returns text
language sql immutable set search_path=''as $$select format('[%s,%s]',to_json(s.account)::text,s.bot_id)$$;

create table public.telegram_audit (
 id bigint generated always as identity primary key,member_id uuid references auth.users(id),
 kind text not null,detail jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create function public._telegram_audit(m uuid,k text,d jsonb)returns void language sql security definer set search_path=''as $$
 insert into public.telegram_audit(member_id,kind,detail)values(m,k,d)
$$;

-- 2. Link tokens -----------------------------------------------------------------

-- Only a SHA-256 hex digest of the token is stored. The raw token is returned once
-- to the authenticated member and travels in the t.me deep link.
create table public.telegram_link_tokens (
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references auth.users(id) on delete cascade,
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 -- One mechanism for every Telegram one-time token. Only `link` is issued and redeemed in T1;
 -- sign-up, sign-in, invitation and recovery purposes are reserved for the T-auth batch.
 purpose text not null check(purpose in('link','member_signup','member_signin','staff_invite','staff_signin','staff_recovery')),
 consent_version text not null,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 consumed_at timestamptz,consumed_principal text,consumed_result text,
 revoked_at timestamptz,
 check(expires_at>created_at)
);
create index telegram_link_tokens_member on public.telegram_link_tokens(member_id,created_at);

-- A Telegram member is an ordinary verified-phone member with a clinical case.
-- Staff linking is a later batch (T4), so staff identities are refused here.
create function public._telegram_member_eligible(m uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select exists(select 1 from auth.users where id=m and phone is not null and phone_confirmed_at is not null
  and(banned_until is null or banned_until<=clock_timestamp()))
 and not exists(select 1 from public.workspace_staff where user_id=m)
 and exists(select 1 from public.patient_clinical_cases where user_id=m)
$$;

create function public.telegram_link_issue(p_consent_version text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=auth.uid();s public.telegram_channel_settings;raw text;expires timestamptz;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 select * into s from public.telegram_channel_settings where singleton;
 if not found then return jsonb_build_object('ok',false,'code','unavailable');end if;
 if not public._telegram_member_eligible(m)then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 if p_consent_version is distinct from s.consent_version then return jsonb_build_object('ok',false,'code','consent_required');end if;
 perform pg_advisory_xact_lock(hashtextextended('telegram-member:'||m::text,0));
 if(select count(*)from public.telegram_link_tokens where member_id=m and created_at>clock_timestamp()-interval '1 hour')>=10 then
  return jsonb_build_object('ok',false,'code','rate_limited');end if;
 -- Only the newest token is redeemable.
 update public.telegram_link_tokens set revoked_at=clock_timestamp()where member_id=m and consumed_at is null and revoked_at is null;
 raw:=translate(encode(extensions.gen_random_bytes(24),'base64'),'+/','-_');
 expires:=clock_timestamp()+make_interval(secs=>s.link_token_seconds);
 insert into public.telegram_link_tokens(member_id,token_hash,purpose,consent_version,expires_at)
 values(m,encode(sha256(convert_to(raw,'UTF8')),'hex'),'link',s.consent_version,expires);
 perform public._telegram_audit(m,'link.issued',jsonb_build_object('expiresAt',expires,'consentVersion',s.consent_version));
 return jsonb_build_object('ok',true,'token',raw,'expiresAt',expires);
end$$;

create function public.telegram_link_status()returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=auth.uid();s public.telegram_channel_settings;ep public.conversation_endpoints;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 select * into s from public.telegram_channel_settings where singleton;
 if not found then return jsonb_build_object('ok',true,'available',false,'linked',false);end if;
 select * into ep from public.conversation_endpoints where member_id=m and adapter='telegram'and active;
 return jsonb_build_object('ok',true,'available',public._telegram_member_eligible(m),'linked',found,'consentVersion',s.consent_version);
end$$;

-- 3. Durable channel inbox (G1, G2, G5) ------------------------------------------

create table public.channel_inbox (
 id uuid primary key default gen_random_uuid(),
 adapter text not null check(adapter='telegram'),
 event_id text not null unique check(length(event_id)between 1 and 256),
 fingerprint text not null check(length(fingerprint)between 1 and 256),
 principal_ref text check(length(principal_ref)between 1 and 256),
 kind text not null check(kind in('text','link','start','callback','rejected')),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 -- The link generation in force when the event was committed. Processing rechecks
 -- it, so a relink can never attribute an older message to the new account (G2).
 endpoint_id uuid references public.conversation_endpoints(id),endpoint_generation bigint,
 status text not null default 'received'check(status in('received','processing','done','dead')),
 attempts integer not null default 0 check(attempts>=0),lease_until timestamptz,
 result text,last_error text,
 received_at timestamptz not null default clock_timestamp(),processed_at timestamptz
);
create index channel_inbox_pending on public.channel_inbox(received_at)where status in('received','processing');

create function public.channel_inbox_commit(p_event jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.telegram_channel_settings;kind text:=p_event->>'kind';ep public.conversation_endpoints;existing public.channel_inbox;inserted uuid;payload jsonb:=p_event->'payload';
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if jsonb_typeof(p_event)is distinct from 'object'or p_event-array['adapter','eventId','fingerprint','principalRef','kind','payload']<>'{}'
 or not(p_event?&array['adapter','eventId','fingerprint','principalRef','kind','payload'])
 or p_event->>'adapter'is distinct from 'telegram'or coalesce(kind,'')not in('text','link','start','callback')
 or jsonb_typeof(p_event->'eventId')is distinct from 'string'or jsonb_typeof(p_event->'fingerprint')is distinct from 'string'or jsonb_typeof(p_event->'principalRef')is distinct from 'string'
 or length(p_event->>'eventId')not between 1 and 256 or length(p_event->>'fingerprint')not between 1 and 256 or length(p_event->>'principalRef')not between 1 and 256
 or jsonb_typeof(payload)is distinct from 'object'
 or(kind='text'and(payload-array['text','chatId','messageId']<>'{}'or jsonb_typeof(payload->'text')is distinct from 'string'or public._conversation_utf16(payload->>'text')not between 1 and 4096))
 or(kind='link'and(payload-array['tokenHash','chatId','messageId']<>'{}'or coalesce(payload->>'tokenHash','')!~'^[a-f0-9]{64}$'))
 or(kind in('start','callback')and payload-array['chatId','messageId']<>'{}')
 or jsonb_typeof(payload->'chatId')is distinct from 'number'or jsonb_typeof(payload->'messageId')is distinct from 'number'
 then return jsonb_build_object('status','failed','code','invalid_event');end if;
 select * into s from public.telegram_channel_settings where singleton;
 if not found then return jsonb_build_object('status','failed','code','unavailable');end if;
 -- Only principals of the configured bot, in their own private chat, are admitted.
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

-- Authenticated but unparseable updates are stored as dead letters without content,
-- so Telegram stops redelivering a poison update (G5).
create function public.channel_inbox_reject(p_event_id text,p_reason text)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_event_id is null or length(p_event_id)not between 1 and 256 or coalesce(p_reason,'')!~'^[a-z_]{1,64}$'then return jsonb_build_object('status','failed');end if;
 insert into public.channel_inbox(adapter,event_id,fingerprint,kind,payload,status,result,processed_at)
 values('telegram',p_event_id,'rejected:'||p_reason,'rejected','{}','dead',p_reason,clock_timestamp())on conflict(event_id)do nothing;
 return jsonb_build_object('status','committed');
end$$;

-- 4. System-message outbox (minimal; T2 adds templates) ---------------------------

create table public.system_message_templates (
 template_id text not null check(template_id ~ '^[a-z][a-z0-9_.]{1,63}$'),version integer not null check(version>0),
 locale text not null check(locale in('hy','en')),body text not null check(length(body)between 1 and 4096 and body=btrim(body,E' \n\r\t')),
 approved boolean not null default false,approval_note text,created_at timestamptz not null default clock_timestamp(),
 primary key(template_id,version,locale)
);
-- D1: clinical wording is not approved. These placeholders keep every acknowledgement
-- held at claim until a signed-off version is inserted with approved=true.
insert into public.system_message_templates(template_id,version,locale,body)values
 ('telegram.ack',1,'en','UNAPPROVED PLACEHOLDER. We got your message and it has gone to your care team. If your care team replies, it will arrive in this chat. This chat is not for emergencies. If you think you may be in danger, call 103 now.'),
 ('telegram.ack',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր հաղորդագրությունը ստացել ենք և փոխանցել ձեր խնամքի թիմին։ Եթե ձեր խնամքի թիմը պատասխանի, պատասխանը կհասնի այս զրույցում։ Այս զրույցը շտապ դեպքերի համար չէ։ Եթե կարծում եք, որ վտանգի մեջ եք, անմիջապես զանգահարեք 103։'),
 ('telegram.link_confirmed',1,'en','UNAPPROVED PLACEHOLDER. Your Noreon account is now connected to this chat. You can go back to the app. If your care team replies, it will arrive here. This chat is not for emergencies. If you think you may be in danger, call 103 now.'),
 ('telegram.link_confirmed',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր Noreon հաշիվը այժմ կապված է այս զրույցին։ Կարող եք վերադառնալ հավելված։ Եթե ձեր խնամքի թիմը պատասխանի, պատասխանը կհասնի այստեղ։ Այս զրույցը շտապ դեպքերի համար չէ։ Եթե կարծում եք, որ վտանգի մեջ եք, անմիջապես զանգահարեք 103։');

create table public.system_messages (
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references auth.users(id),
 template_id text not null,template_version integer not null,locale text not null,
 foreign key(template_id,template_version,locale)references public.system_message_templates(template_id,version,locale),
 body text not null,body_hash text not null,
 endpoint_id uuid not null references public.conversation_endpoints(id),endpoint_generation bigint not null,
 source_inbox_id uuid references public.channel_inbox(id),
 state text not null default 'queued'check(state in('queued','held','sending','accepted_by_provider','definitely_failed','unknown')),
 reason text,state_seq bigint not null default 0,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(source_inbox_id,template_id)
);
create index system_messages_queued on public.system_messages(created_at)where state='queued';
create table public.system_message_attempts (
 id uuid primary key,message_id uuid not null unique references public.system_messages(id),state_seq bigint not null,envelope jsonb not null,
 claimed_at timestamptz not null default clock_timestamp(),outcome jsonb,outcome_at timestamptz
);
create table public.system_message_audit (
 id bigint generated always as identity primary key,message_id uuid not null references public.system_messages(id),
 kind text not null,detail jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create function public._system_message_audit(m uuid,k text,d jsonb)returns void language sql security definer set search_path=''as $$
 insert into public.system_message_audit(message_id,kind,detail)values(m,k,d)
$$;
create function public._system_message_hash(t text,v integer,l text,b text)returns text language sql immutable strict set search_path=''as $$
 select encode(sha256(convert_to('["noreon.system-message",1,'||to_json(t)::text||','||v||','||to_json(l)::text||','||to_json(b)::text||']','UTF8')),'hex')
$$;
-- Enqueue the newest version of a template in the member's language. Approval is
-- checked at claim, so a later approval never rewrites already-queued text.
create function public._system_message_enqueue(p_template text,m uuid,ep public.conversation_endpoints,p_inbox uuid)returns uuid
language plpgsql security definer set search_path=''as $$
declare l text;t public.system_message_templates;new_id uuid;
begin
 select coalesce((select locale from public.profiles where id=m),'hy')into l;
 select * into t from public.system_message_templates where template_id=p_template and locale=l order by version desc limit 1;
 if not found then return null;end if;
 insert into public.system_messages(member_id,template_id,template_version,locale,body,body_hash,endpoint_id,endpoint_generation,source_inbox_id)
 values(m,t.template_id,t.version,t.locale,t.body,public._system_message_hash(t.template_id,t.version,t.locale,t.body),ep.id,ep.generation,p_inbox)
 on conflict(source_inbox_id,template_id)do nothing returning system_messages.id into new_id;
 if new_id is not null then perform public._system_message_audit(new_id,'enqueued',jsonb_build_object('template',t.template_id,'version',t.version,'locale',t.locale));end if;
 return new_id;
end$$;

-- 5. Doctor alerts ----------------------------------------------------------------

-- A durable record that the assigned doctor has a new member message to review. It
-- never states that anyone has read it.
create table public.conversation_doctor_alerts (
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.conversations(id),
 member_id uuid not null references auth.users(id),doctor_id uuid references auth.users(id),message_seq bigint not null,
 inbox_id uuid unique references public.channel_inbox(id),created_at timestamptz not null default clock_timestamp()
);
create index conversation_doctor_alerts_doctor on public.conversation_doctor_alerts(doctor_id,created_at);

-- Telegram members write through the verified endpoint, not an authenticated session.
alter table public.conversation_messages drop constraint conversation_messages_source_check;
alter table public.conversation_messages add constraint conversation_messages_source_check check(source in('authenticated_member','telegram_member'));

-- 6. Link redemption and unlink -----------------------------------------------------

-- Holds every queued doctor reply to this member. Caller holds the case and
-- conversation locks (lock order: case, conversation, endpoint, deliveries).
create function public._telegram_hold_member_deliveries(m uuid,p_reason text)returns void
language plpgsql security definer set search_path=''as $$
declare c uuid;
begin
 select id into c from public.conversations where member_id=m;
 if c is null then return;end if;
 with held as(update public.conversation_deliveries set state='held',reason=p_reason,state_seq=state_seq+1
  where conversation_id=c and state='queued'returning id)
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)select c,null,'delivery.held',jsonb_build_object('deliveryId',held.id,'reason',p_reason)from held;
end$$;

create function public._telegram_link_redeem(p_token_hash text,p_principal text,p_address bigint)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.telegram_channel_settings;t public.telegram_link_tokens;p public.conversation_policy;ep public.conversation_endpoints;other public.conversation_endpoints;g bigint;acct text;
begin
 select * into s from public.telegram_channel_settings where singleton;
 if not found then return jsonb_build_object('ok',false,'code','unavailable');end if;
 acct:=public._telegram_account_ref(s);
 if p_principal is distinct from public._telegram_principal_ref(s,p_address)then return jsonb_build_object('ok',false,'code','foreign_principal');end if;
 select * into t from public.telegram_link_tokens where token_hash=p_token_hash;
 if not found then return jsonb_build_object('ok',false,'code','token_invalid');end if;
 -- Lock order: member advisory, principal advisory, case, conversation, endpoints.
 perform pg_advisory_xact_lock(hashtextextended('telegram-member:'||t.member_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('telegram-principal:'||p_principal,0));
 select * into t from public.telegram_link_tokens where id=t.id for update;
 if t.purpose<>'link'or t.consumed_at is not null or t.revoked_at is not null or t.expires_at<=clock_timestamp()or t.consent_version<>s.consent_version then
  return jsonb_build_object('ok',false,'code','token_invalid');end if;
 -- The token is single use whatever happens next.
 update public.telegram_link_tokens set consumed_at=clock_timestamp(),consumed_principal=p_principal where id=t.id;
 if not public._telegram_member_eligible(t.member_id)then
  update public.telegram_link_tokens set consumed_result='not_eligible'where id=t.id;return jsonb_build_object('ok',false,'code','not_eligible');end if;
 select * into p from public.conversation_policy where singleton;
 if not found then update public.telegram_link_tokens set consumed_result='policy_unavailable'where id=t.id;return jsonb_build_object('ok',false,'code','policy_unavailable');end if;
 perform 1 from public.patient_clinical_cases where user_id=t.member_id for update;
 perform 1 from public.conversations where member_id=t.member_id for update;
 select * into ep from public.conversation_endpoints where adapter='telegram'and account_ref=acct and principal_ref=p_principal for update;
 -- One member per Telegram account: another member must unlink first.
 if found and ep.active and ep.member_id<>t.member_id then
  update public.telegram_link_tokens set consumed_result='principal_linked_elsewhere'where id=t.id;
  perform public._telegram_audit(t.member_id,'link.refused',jsonb_build_object('reason','principal_linked_elsewhere'));
  return jsonb_build_object('ok',false,'code','principal_linked_elsewhere');end if;
 -- One Telegram account per member: relinking retires the previous endpoint.
 for other in select * from public.conversation_endpoints where member_id=t.member_id and active and id is distinct from ep.id for update loop
  update public.conversation_endpoints set active=false,generation=generation+1 where id=other.id;
 end loop;
 g:=greatest(coalesce((select max(generation)from public.conversation_endpoints where member_id=t.member_id),0),coalesce(ep.generation,0))+1;
 if ep.id is null then
  insert into public.conversation_endpoints(member_id,adapter,account_ref,principal_ref,address,generation,active,policy_version,expires_at,max_utf16)
  values(t.member_id,'telegram',acct,p_principal,p_address::text,g,true,p.version,'infinity',4096)returning * into ep;
 else
  update public.conversation_endpoints set member_id=t.member_id,address=p_address::text,generation=g,active=true,policy_version=p.version,expires_at='infinity',max_utf16=4096
  where id=ep.id returning * into ep;
 end if;
 -- Queued replies pinned to an older generation would be held at claim anyway; hold
 -- them now so the doctor sees the truthful state immediately.
 perform public._telegram_hold_member_deliveries(t.member_id,'endpoint_relinked');
 update public.telegram_link_tokens set consumed_result='linked'where id=t.id;
 perform public._telegram_audit(t.member_id,'link.redeemed',jsonb_build_object('endpointId',ep.id,'generation',ep.generation));
 return jsonb_build_object('ok',true,'memberId',t.member_id,'endpointId',ep.id,'generation',ep.generation);
end$$;
create function public.telegram_link_redeem(p_token_hash text,p_principal_ref text,p_address bigint)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$'or p_address is null or p_address<=0 then return jsonb_build_object('ok',false,'code','token_invalid');end if;
 return public._telegram_link_redeem(p_token_hash,p_principal_ref,p_address);
end$$;

create function public.telegram_unlink()returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=auth.uid();ep public.conversation_endpoints;n integer:=0;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 perform set_config('lock_timeout','3s',true);
 perform pg_advisory_xact_lock(hashtextextended('telegram-member:'||m::text,0));
 perform 1 from public.patient_clinical_cases where user_id=m for update;
 perform 1 from public.conversations where member_id=m for update;
 for ep in select * from public.conversation_endpoints where member_id=m and adapter='telegram'and active for update loop
  update public.conversation_endpoints set active=false,generation=generation+1 where id=ep.id;n:=n+1;
 end loop;
 update public.telegram_link_tokens set revoked_at=clock_timestamp()where member_id=m and consumed_at is null and revoked_at is null;
 perform public._telegram_hold_member_deliveries(m,'endpoint_unlinked');
 perform public._telegram_audit(m,'link.unlinked',jsonb_build_object('endpoints',n));
 return jsonb_build_object('ok',true,'unlinked',n>0);
end$$;

-- 7. Inbox processing ---------------------------------------------------------------

create function public.channel_inbox_next(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ids jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 -- Poison rows stop after five leases (G5).
 update public.channel_inbox set status='dead',result='max_attempts',processed_at=clock_timestamp(),lease_until=null,payload=payload-'text'
 where status='processing'and lease_until<clock_timestamp()and attempts>=5;
 with picked as(select id from public.channel_inbox where status='received'or(status='processing'and lease_until<clock_timestamp())
  order by received_at,id limit greatest(1,least(coalesce(p_limit,10),50))for update skip locked),
 leased as(update public.channel_inbox i set status='processing',attempts=attempts+1,lease_until=clock_timestamp()+interval '60 seconds'
  from picked where i.id=picked.id returning i.id,i.received_at)
 select coalesce(jsonb_agg(id order by received_at,id),'[]')into ids from leased;
 return ids;
end$$;

create function public._channel_inbox_finish(i uuid,st text,r text)returns jsonb language plpgsql security definer set search_path=''as $$begin
 update public.channel_inbox set status=st,result=r,processed_at=clock_timestamp(),lease_until=null,
  -- Message text lives in the conversation once received; the inbox keeps no copy.
  payload=payload-'text'where id=i;
 return jsonb_build_object('ok',true,'status',st,'result',r);
end$$;

create function public._channel_inbox_receive_text(r public.channel_inbox)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ep public.conversation_endpoints;cs public.patient_clinical_cases;c public.conversations;p public.conversation_policy;
begin
 if r.endpoint_id is null then return public._channel_inbox_finish(r.id,'done','principal_not_linked');end if;
 select * into ep from public.conversation_endpoints where id=r.endpoint_id;
 select * into cs from public.patient_clinical_cases where user_id=ep.member_id for update;
 select * into ep from public.conversation_endpoints where id=r.endpoint_id for share;
 -- G2: the endpoint must still be the exact generation the event arrived under.
 if not found or not ep.active or ep.generation<>r.endpoint_generation or ep.principal_ref<>r.principal_ref then
  perform public._telegram_audit(ep.member_id,'inbox.generation_mismatch',jsonb_build_object('inboxId',r.id));
  return public._channel_inbox_finish(r.id,'done','generation_mismatch');end if;
 if cs.user_id is null or not public._telegram_member_eligible(ep.member_id)then return public._channel_inbox_finish(r.id,'done','member_not_eligible');end if;
 select * into p from public.conversation_policy where singleton;
 if not found then raise exception using errcode='55000',message='Conversation policy unavailable';end if;
 insert into public.conversations(member_id)values(ep.member_id)on conflict(member_id)do nothing;
 select * into c from public.conversations where member_id=ep.member_id for update;
 if(select count(*)from public.conversation_messages where conversation_id=c.id and created_at>clock_timestamp()-make_interval(secs=>p.intake_window_seconds))>=p.intake_max_messages then
  -- Over the intake limit the text is not stored, but the safety path still runs: the
  -- conversation moves on so no earlier approval can be sent, and the doctor alert and
  -- acknowledgement are recorded once per intake window (bounded, never per message).
  update public.conversations set version=version+1 where id=c.id returning * into c;
  update public.conversation_intents set state='invalidated'where state='open'and draft_id in(select id from public.conversation_drafts where conversation_id=c.id);
  update public.conversation_deliveries set state='held',reason='member_over_intake_limit',state_seq=state_seq+1 where conversation_id=c.id and state='queued';
  update public.conversation_deliveries set review_after_send=true where conversation_id=c.id and state in('sending','unknown');
  update public.conversation_drafts set state='superseded'where conversation_id=c.id and state in('pending','info_requested');
  if not exists(select 1 from public.conversation_audit where conversation_id=c.id and kind='message.overflow'and created_at>clock_timestamp()-make_interval(secs=>p.intake_window_seconds))then
   insert into public.conversation_doctor_alerts(conversation_id,member_id,doctor_id,message_seq,inbox_id)values(c.id,ep.member_id,cs.assigned_doctor_id,c.version,r.id);
   perform public._system_message_enqueue('telegram.ack',ep.member_id,ep,r.id);
  end if;
  insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,null,'message.overflow',jsonb_build_object('channel','telegram','inboxId',r.id,'version',c.version));
  return public._channel_inbox_finish(r.id,'done','rate_limited');end if;
 update public.conversations set version=version+1 where id=c.id returning * into c;
 insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id)values(c.id,c.version,ep.member_id,r.payload->>'text','telegram_member',r.id);
 -- Same invalidation as conversation_receive: new information voids earlier approvals.
 update public.conversation_intents set state='invalidated'where state='open'and draft_id in(select id from public.conversation_drafts where conversation_id=c.id);
 update public.conversation_deliveries set state='held',reason='newer_member_message',state_seq=state_seq+1 where conversation_id=c.id and state='queued';
 update public.conversation_deliveries set review_after_send=true where conversation_id=c.id and state in('sending','unknown');
 update public.conversation_drafts set state='superseded'where conversation_id=c.id and state in('pending','info_requested');
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,null,'message.received',jsonb_build_object('channel','telegram','inboxId',r.id,'seq',c.version));
 -- Urgent minimum: the doctor alert and the fixed acknowledgement are both recorded
 -- here, independently; a later send failure of one never affects the other.
 insert into public.conversation_doctor_alerts(conversation_id,member_id,doctor_id,message_seq,inbox_id)values(c.id,ep.member_id,cs.assigned_doctor_id,c.version,r.id);
 perform public._system_message_enqueue('telegram.ack',ep.member_id,ep,r.id);
 return public._channel_inbox_finish(r.id,'done','received');
end$$;

create function public.channel_inbox_process(p_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.channel_inbox;res jsonb;ep public.conversation_endpoints;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform set_config('lock_timeout','3s',true);
 select * into r from public.channel_inbox where id=p_id for update;
 if not found or r.status<>'processing'then return jsonb_build_object('ok',false,'code','not_leased');end if;
 begin
  if r.kind='text'then return public._channel_inbox_receive_text(r);
  elsif r.kind='link'then
   res:=public._telegram_link_redeem(r.payload->>'tokenHash',r.principal_ref,(r.payload->>'chatId')::bigint);
   if res->>'ok'='true'then
    select * into ep from public.conversation_endpoints where id=(res->>'endpointId')::uuid;
    perform public._system_message_enqueue('telegram.link_confirmed',ep.member_id,ep,r.id);
   end if;
   return public._channel_inbox_finish(r.id,'done','link:'||(case when res->>'ok'='true'then 'linked'else res->>'code'end));
  else
   -- A bare /start or a button press does nothing in T1 (buttons arrive in T4).
   return public._channel_inbox_finish(r.id,'done','ignored_'||r.kind);
  end if;
 exception when others then
  -- Leave the lease to expire for a retry; record the error class only, never text.
  update public.channel_inbox set last_error=sqlstate where id=r.id;
  return jsonb_build_object('ok',false,'code','retry','sqlstate',sqlstate);
 end;
end$$;

-- 8. CR2: durable observations and typed outcome recording -------------------------

-- What the transport reported for an attempt. The worker commits it in its own
-- transaction (delivery_observe) before any outcome lock wait, so a known result
-- survives lock contention, a cancelled outcome call or a crash. Immutable.
create table public.delivery_observations (
 attempt_id uuid primary key,channel text not null check(channel in('conversation','system')),
 outcome jsonb not null,observed_at timestamptz not null default clock_timestamp()
);
-- True only for a complete, well-typed outcome; any missing, null or mistyped field is false, never NULL.
create function public._delivery_outcome_valid(o jsonb)returns boolean language sql immutable set search_path=''as $$
 select coalesce(jsonb_typeof(o)='object'and coalesce(o->>'kind','')in('accepted','definitely_failed','unknown')
 and o-(case o->>'kind'when 'accepted'then array['kind','providerRef']when 'definitely_failed'then array['kind','evidence']else array['kind','reason']end)='{}'
 and jsonb_typeof(o->(case o->>'kind'when 'accepted'then 'providerRef'when 'definitely_failed'then 'evidence'else 'reason'end))='string'
 and length(o->>(case o->>'kind'when 'accepted'then 'providerRef'when 'definitely_failed'then 'evidence'else 'reason'end))between 1 and 512,false)
$$;

-- Retains one observation per attempt. The attempt row is share-locked first, so a
-- reconciler holding it FOR UPDATE either sees this observation or finishes first;
-- every wait is bounded. Result: retained | conflict, or a typed failure.
create function public._delivery_retain_observation(p_channel text,p_attempt uuid,p_outcome jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare obs public.delivery_observations;
begin
 if p_attempt is null or p_channel not in('conversation','system')or public._delivery_outcome_valid(p_outcome)is not true then
  return jsonb_build_object('ok',false,'code','invalid_outcome','retryable',false);end if;
 begin
  perform set_config('lock_timeout','2s',true);
  if p_channel='conversation'then perform 1 from public.conversation_attempts where id=p_attempt for share;
  else perform 1 from public.system_message_attempts where id=p_attempt for share;end if;
  if not found then return jsonb_build_object('ok',false,'code','attempt_unknown','retryable',false);end if;
  insert into public.delivery_observations(attempt_id,channel,outcome)values(p_attempt,p_channel,p_outcome)on conflict(attempt_id)do nothing;
 exception when lock_not_available then return jsonb_build_object('ok',false,'code','busy','retryable',true);
 end;
 select * into obs from public.delivery_observations where attempt_id=p_attempt;
 if obs.channel<>p_channel then return jsonb_build_object('ok',false,'code','attempt_unknown','retryable',false);end if;
 return jsonb_build_object('ok',true,'result',case when obs.outcome=p_outcome then 'retained'else 'conflict'end);
end$$;
create function public.delivery_observe(p_channel text,p_attempt uuid,p_outcome jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 r:=public._delivery_retain_observation(p_channel,p_attempt,p_outcome);
 if r->>'result'='conflict'then
  if p_channel='conversation'then
   perform public._conversation_audit((select dl.conversation_id from public.conversation_attempts at join public.conversation_deliveries dl on dl.id=at.delivery_id where at.id=p_attempt),'delivery.conflicting_observation',jsonb_build_object('attemptId',p_attempt,'outcome',p_outcome));
  else perform public._system_message_audit((select message_id from public.system_message_attempts where id=p_attempt),'conflicting_observation',jsonb_build_object('attemptId',p_attempt,'outcome',p_outcome));end if;
 end if;
 return r;
end$$;

-- Result: {ok:true,result:recorded|duplicate|conflict|late} or {ok:false,code,retryable}.
-- An observed outcome is retained first (no-op when delivery_observe already did).
-- A reconciler (p_observed=false) re-reads the retained observation after taking the
-- terminal locks and applies it in place of unknown. A short lock timeout replaces
-- NOWAIT; nothing here ever authorises another send.
create function public._conversation_record_outcome(p_attempt uuid,p_outcome jsonb,p_observed boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare at public.conversation_attempts;dl public.conversation_deliveries;obs public.delivery_observations;kept jsonb;kind text;
begin
 if p_attempt is null or public._delivery_outcome_valid(p_outcome)is not true then return jsonb_build_object('ok',false,'code','invalid_outcome','retryable',false);end if;
 select * into at from public.conversation_attempts where id=p_attempt;
 if not found then return jsonb_build_object('ok',false,'code','attempt_unknown','retryable',false);end if;
 if p_observed then
  kept:=public._delivery_retain_observation('conversation',p_attempt,p_outcome);
  if kept->>'ok'<>'true'then return kept;end if;
  if kept->>'result'='conflict'then
   perform public._conversation_audit((select conversation_id from public.conversation_deliveries where id=at.delivery_id),'delivery.conflicting_observation',jsonb_build_object('attemptId',p_attempt,'outcome',p_outcome));
   return jsonb_build_object('ok',true,'result','conflict');end if;
 end if;
 begin
  perform set_config('lock_timeout','2s',true);
  -- Conversation first, matching command/claim order and the audit FK lock.
  perform 1 from public.conversations where id=(select conversation_id from public.conversation_deliveries where id=at.delivery_id)for update;
  select * into dl from public.conversation_deliveries where id=at.delivery_id for update;
  select * into at from public.conversation_attempts where id=p_attempt for update;
 exception when lock_not_available then
  return jsonb_build_object('ok',false,'code','busy','retryable',true);
 end;
 if not p_observed then
  select * into obs from public.delivery_observations where attempt_id=p_attempt;
  if found then p_outcome:=obs.outcome;end if;
 end if;
 kind:=p_outcome->>'kind';
 if at.outcome=p_outcome then return jsonb_build_object('ok',true,'result','duplicate');end if;
 if at.outcome is not null or dl.state<>'sending'or dl.state_seq<>at.state_seq then
  -- A terminal state is never reopened; the later evidence is kept in the audit.
  perform public._conversation_audit(dl.conversation_id,'delivery.late_outcome',jsonb_build_object('attemptId',at.id,'outcome',p_outcome));
  return jsonb_build_object('ok',true,'result','late');end if;
 update public.conversation_attempts set outcome=p_outcome,outcome_at=clock_timestamp()where id=at.id;
 update public.conversation_deliveries set state=case kind when 'accepted'then 'accepted_by_provider'when 'definitely_failed'then 'definitely_failed'else 'unknown'end,state_seq=state_seq+1 where id=dl.id;
 perform public._conversation_audit(dl.conversation_id,'delivery.outcome',jsonb_build_object('attemptId',at.id,'outcome',p_outcome,'observed',p_observed or obs.attempt_id is not null));
 return jsonb_build_object('ok',true,'result','recorded');
end$$;
create or replace function public.conversation_outcome(p_attempt uuid,p_outcome jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 return public._conversation_record_outcome(p_attempt,p_outcome,true);
end$$;

-- A reconciler applies a retained observation when one exists and otherwise records
-- unknown. It never overwrites a recorded outcome and never resends.
create or replace function public.conversation_reconcile(p_attempt uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 return public._conversation_record_outcome(p_attempt,jsonb_build_object('kind','unknown','reason','Claim acknowledgement or transport outcome unresolved; reconciliation required, no resend'),false);
end$$;

-- 9. CR3 capture-only and CR6 member minimisation ------------------------------------

-- The staff workspace reads the evidence token from its statement snapshot without
-- the seven global SHARE table locks. Every mutation still rechecks the token under
-- its existing lock. The member branch returns only what a member needs (CR6).
create or replace function public.conversation_workspace(p_member uuid default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare m uuid:=coalesce(p_member,auth.uid());a jsonb;c public.conversations;result jsonb;
begin
 a:=public._conversation_user(m,p_member is not null);
 select * into c from public.conversations where member_id=m;
 if not found then return jsonb_build_object('ok',true,'conversation',null);end if;
 if p_member is null then
  return jsonb_build_object('ok',true,'conversationId',c.id,'version',c.version,
  'messages',coalesce((select jsonb_agg(jsonb_build_object('seq',seq,'text',body,'at',created_at,'author','member')order by seq)from public.conversation_messages where conversation_id=c.id),'[]'),
  'replies',coalesce((select jsonb_agg(jsonb_build_object('approvalId',ap.id,'body',ap.body,'approvedAt',ap.created_at,'approvedBy',jsonb_build_object('displayName',ap.doctor_name),'deliveryState',dl.state)order by ap.created_at,ap.id)
   from public.conversation_deliveries dl join public.conversation_approvals ap on ap.id=dl.approval_id where dl.conversation_id=c.id and dl.state in('accepted_by_provider','unknown')),'[]'));
 end if;
 result:=jsonb_build_object('ok',true,'conversationId',c.id,'version',c.version,'messages',coalesce((select jsonb_agg(jsonb_build_object('seq',seq,'text',body,'at',created_at,'author','member')order by seq)from public.conversation_messages where conversation_id=c.id),'[]'),
 'replies',coalesce((select jsonb_agg(jsonb_build_object('approvalId',ap.id,'body',ap.body,'approvedAt',ap.created_at,'approvedBy',jsonb_build_object('staffId',ap.doctor_id,'displayName',ap.doctor_name,'role',ap.doctor_role,'clinicId',ap.clinic_id),'deliveryState',dl.state,'reviewAfterSend',dl.review_after_send)order by ap.created_at,ap.id)from public.conversation_deliveries dl join public.conversation_approvals ap on ap.id=dl.approval_id where dl.conversation_id=c.id and dl.state in('accepted_by_provider','unknown')),'[]'));
 return result||jsonb_build_object('memberName',coalesce((select display_name from public.profiles where id=m),''),
 'unsavedOverLimit',exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and au.kind='message.overflow'
  and(au.detail->>'version')::bigint>coalesce((select max(d.context_version)from public.conversation_drafts d where d.conversation_id=c.id and d.state in('approved','rejected')),0)),'clinicalRevision',a->'clinicalRevision','draftEpoch',c.draft_epoch,'sourceToken',public.patient_clinical_evidence(m)->>'token',
 'drafts',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('revisions',(select jsonb_agg(to_jsonb(r)order by revision)from public.conversation_revisions r where draft_id=d.id))order by d.created_at,d.id)from public.conversation_drafts d where conversation_id=c.id),'[]'),
 'deliveries',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('approval',to_jsonb(ap))order by d.created_at,d.id)from public.conversation_deliveries d join public.conversation_approvals ap on ap.id=d.approval_id where d.conversation_id=c.id),'[]'));
end$$;

-- 10. CR5: an authority lapse at claim is an explicit, audited hold ----------------

create or replace function public.conversation_claim(p_delivery uuid,p_attempt uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare dl public.conversation_deliveries;ap public.conversation_approvals;d public.conversation_drafts;c public.conversations;g public.conversation_grants;ep public.conversation_endpoints;p public.conversation_policy;a jsonb;envelope jsonb;lapsed boolean:=false;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('conversation-attempt:'||p_attempt::text,0));
 select * into dl from public.conversation_deliveries where id=p_delivery;
 if not found then return jsonb_build_object('ok',false,'code','delivery_unknown');end if;
 select * into ap from public.conversation_approvals where id=dl.approval_id;
 select * into c from public.conversations where id=dl.conversation_id;
 select * into g from public.conversation_grants where id=ap.grant_id;
 begin
  a:=public._conversation_authorize(c.member_id,ap.doctor_id,g.session_id,g.amr,true,false);
  if (a->>'grantId')::uuid<>ap.grant_id or(a->>'generation')::bigint<>ap.grant_generation or(a#>>'{doctor,clinicId}')::uuid<>ap.clinic_id then raise insufficient_privilege;end if;
 exception when insufficient_privilege then lapsed:=true;
 end;
 if lapsed then
  perform set_config('lock_timeout','2s',true);
  perform 1 from public.conversations where id=c.id for update;
  select * into dl from public.conversation_deliveries where id=p_delivery for update;
  if dl.state='queued'and not exists(select 1 from public.conversation_attempts where delivery_id=p_delivery)then
   update public.conversation_deliveries set state='held',reason='approval_authority_lapsed',state_seq=state_seq+1 where id=dl.id;
   perform public._conversation_audit(c.id,'delivery.held',jsonb_build_object('deliveryId',dl.id,'reason','approval_authority_lapsed'));
  end if;
  return jsonb_build_object('ok',false,'code','approval_authority_lapsed');
 end if;
 select * into c from public.conversations where id=c.id;
 select * into dl from public.conversation_deliveries where id=p_delivery for update;
 -- Replays authorize first and never grant a second transport invocation.
 if dl.state<>'queued'or exists(select 1 from public.conversation_attempts where id=p_attempt or delivery_id=p_delivery)then return jsonb_build_object('ok',false,'code','already_claimed_or_held');end if;
 select * into d from public.conversation_drafts where id=ap.draft_id;
 if c.version<>ap.context_version or d.revision<>ap.revision or d.state<>'approved'or d.clinical_revision<>(a->>'clinicalRevision')::bigint or d.source_token<>public._conversation_source(c.member_id)
 or ap.content_hash<>public._conversation_hash(c.id,c.member_id,ap.body)then
  update public.conversation_deliveries set state='held',reason='stale_context',state_seq=state_seq+1 where id=dl.id;
  perform public._conversation_audit(c.id,'delivery.held',jsonb_build_object('deliveryId',dl.id,'reason','stale_context'));
  return jsonb_build_object('ok',false,'code','stale_context');end if;
 select * into p from public.conversation_policy where singleton;
 select * into ep from public.conversation_endpoints where id=dl.endpoint_id for share nowait;
 if not p.delivery_enabled or p.version is distinct from dl.policy_version or ep.id is null or not ep.active or ep.expires_at<=clock_timestamp()
 or ep.member_id<>c.member_id or ep.generation<>dl.endpoint_generation or ep.policy_version<>p.version
 or public._conversation_utf16(ap.doctor_name||E'\n\n'||ap.body)>ep.max_utf16 then
  update public.conversation_deliveries set state='held',reason='route_unavailable',state_seq=state_seq+1 where id=dl.id;
  perform public._conversation_audit(c.id,'delivery.held',jsonb_build_object('deliveryId',dl.id,'reason','route_unavailable'));
  return jsonb_build_object('ok',false,'code','route_unavailable');end if;
 envelope:=jsonb_build_object('deliveryId',dl.id,'attemptId',p_attempt,'attemptSeq',1,'endpointId',ep.id,'address',ep.address,'generation',ep.generation,
 'body',ap.body,'contentHash',ap.content_hash,'approvalId',ap.id,'approvedBy',jsonb_build_object('staffId',ap.doctor_id,'displayName',ap.doctor_name,'role',ap.doctor_role,'clinicId',ap.clinic_id));
 update public.conversation_deliveries set state='sending',state_seq=state_seq+1 where id=dl.id returning * into dl;
 insert into public.conversation_attempts(id,delivery_id,state_seq,envelope)values(p_attempt,dl.id,dl.state_seq,envelope);
 perform public._conversation_audit(c.id,'delivery.claimed',jsonb_build_object('deliveryId',dl.id,'attemptId',p_attempt,'authorizationCutoff','claim_commit'));
 return jsonb_build_object('ok',true,'fresh',true,'adapter',ep.adapter,'accountRef',ep.account_ref,'envelope',envelope);
end$$;

-- 11. System-message claim, outcome and reconcile ----------------------------------

create function public.system_message_claim(p_message uuid,p_attempt uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare sm public.system_messages;t public.system_message_templates;ep public.conversation_endpoints;p public.conversation_policy;envelope jsonb;hold_reason text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_message is null or p_attempt is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform set_config('lock_timeout','2s',true);
 select * into sm from public.system_messages where id=p_message for update;
 if not found then return jsonb_build_object('ok',false,'code','message_unknown');end if;
 if sm.state<>'queued'or exists(select 1 from public.system_message_attempts where id=p_attempt or message_id=p_message)then return jsonb_build_object('ok',false,'code','already_claimed_or_held');end if;
 select * into t from public.system_message_templates where template_id=sm.template_id and version=sm.template_version and locale=sm.locale;
 select * into p from public.conversation_policy where singleton;
 select * into ep from public.conversation_endpoints where id=sm.endpoint_id for share;
 hold_reason:=case
  when not t.approved then 'template_unapproved'
  when t.body<>sm.body or public._system_message_hash(t.template_id,t.version,t.locale,t.body)<>sm.body_hash then 'template_changed'
  when p.singleton is null or not p.delivery_enabled then 'route_unavailable'
  when not ep.active or ep.expires_at<=clock_timestamp()or ep.member_id<>sm.member_id or ep.generation<>sm.endpoint_generation or ep.policy_version<>p.version then 'route_unavailable'
  when public._conversation_utf16(sm.body)>ep.max_utf16 then 'route_unavailable'
 end;
 if hold_reason is not null then
  update public.system_messages set state='held',reason=hold_reason,state_seq=state_seq+1,updated_at=clock_timestamp()where id=sm.id;
  perform public._system_message_audit(sm.id,'held',jsonb_build_object('reason',hold_reason));
  return jsonb_build_object('ok',false,'code',hold_reason);
 end if;
 envelope:=jsonb_build_object('messageId',sm.id,'attemptId',p_attempt,'address',ep.address,'text',sm.body,'bodyHash',sm.body_hash);
 update public.system_messages set state='sending',state_seq=state_seq+1,updated_at=clock_timestamp()where id=sm.id returning * into sm;
 insert into public.system_message_attempts(id,message_id,state_seq,envelope)values(p_attempt,sm.id,sm.state_seq,envelope);
 perform public._system_message_audit(sm.id,'claimed',jsonb_build_object('attemptId',p_attempt));
 return jsonb_build_object('ok',true,'fresh',true,'adapter',ep.adapter,'accountRef',ep.account_ref,'envelope',envelope);
exception when lock_not_available then return jsonb_build_object('ok',false,'code','busy');
end$$;

create function public._system_message_record_outcome(p_attempt uuid,p_outcome jsonb,p_observed boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare at public.system_message_attempts;sm public.system_messages;obs public.delivery_observations;kept jsonb;kind text;
begin
 if p_attempt is null or public._delivery_outcome_valid(p_outcome)is not true then return jsonb_build_object('ok',false,'code','invalid_outcome','retryable',false);end if;
 select * into at from public.system_message_attempts where id=p_attempt;
 if not found then return jsonb_build_object('ok',false,'code','attempt_unknown','retryable',false);end if;
 if p_observed then
  kept:=public._delivery_retain_observation('system',p_attempt,p_outcome);
  if kept->>'ok'<>'true'then return kept;end if;
  if kept->>'result'='conflict'then
   perform public._system_message_audit(at.message_id,'conflicting_observation',jsonb_build_object('attemptId',p_attempt,'outcome',p_outcome));
   return jsonb_build_object('ok',true,'result','conflict');end if;
 end if;
 begin
  perform set_config('lock_timeout','2s',true);
  select * into sm from public.system_messages where id=at.message_id for update;
  select * into at from public.system_message_attempts where id=p_attempt for update;
 exception when lock_not_available then return jsonb_build_object('ok',false,'code','busy','retryable',true);
 end;
 if not p_observed then
  select * into obs from public.delivery_observations where attempt_id=p_attempt;
  if found then p_outcome:=obs.outcome;end if;
 end if;
 kind:=p_outcome->>'kind';
 if at.outcome=p_outcome then return jsonb_build_object('ok',true,'result','duplicate');end if;
 if at.outcome is not null or sm.state<>'sending'or sm.state_seq<>at.state_seq then
  perform public._system_message_audit(sm.id,'late_outcome',jsonb_build_object('attemptId',at.id,'outcome',p_outcome));
  return jsonb_build_object('ok',true,'result','late');end if;
 update public.system_message_attempts set outcome=p_outcome,outcome_at=clock_timestamp()where id=at.id;
 update public.system_messages set state=case kind when 'accepted'then 'accepted_by_provider'when 'definitely_failed'then 'definitely_failed'else 'unknown'end,
  state_seq=state_seq+1,updated_at=clock_timestamp()where id=sm.id;
 perform public._system_message_audit(sm.id,'outcome',jsonb_build_object('attemptId',at.id,'outcome',p_outcome,'observed',p_observed or obs.attempt_id is not null));
 return jsonb_build_object('ok',true,'result','recorded');
end$$;
create function public.system_message_outcome(p_attempt uuid,p_outcome jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 return public._system_message_record_outcome(p_attempt,p_outcome,true);
end$$;

-- Attempts still sending after the lease become unknown (or their retained
-- observation), never queued again.
create function public.delivery_reconcile_stale(p_lease_seconds integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r record;res jsonb;n integer:=0;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_lease_seconds is null or p_lease_seconds<30 then return jsonb_build_object('ok',false,'code','invalid');end if;
 for r in select at.id from public.conversation_attempts at join public.conversation_deliveries dl on dl.id=at.delivery_id
  where at.outcome is null and dl.state='sending'and at.claimed_at<clock_timestamp()-make_interval(secs=>p_lease_seconds)order by at.claimed_at limit 50 loop
  res:=public.conversation_reconcile(r.id);if res->>'result'='recorded'then n:=n+1;end if;
 end loop;
 for r in select at.id from public.system_message_attempts at join public.system_messages sm on sm.id=at.message_id
  where at.outcome is null and sm.state='sending'and at.claimed_at<clock_timestamp()-make_interval(secs=>p_lease_seconds)order by at.claimed_at limit 50 loop
  res:=public._system_message_record_outcome(r.id,jsonb_build_object('kind','unknown','reason','Send started but no outcome was recorded; no resend'),false);
  if res->>'result'='recorded'then n:=n+1;end if;
 end loop;
 return jsonb_build_object('ok',true,'reconciled',n);
end$$;

-- Work lists for the dispatcher. Queued only; nothing else is ever re-claimed.
create function public.telegram_dispatch_queue(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 return jsonb_build_object(
  'system',coalesce((select jsonb_agg(id)from(select id from public.system_messages where state='queued'order by created_at,id limit greatest(1,least(coalesce(p_limit,20),50)))q),'[]'),
  'replies',coalesce((select jsonb_agg(id)from(select dl.id from public.conversation_deliveries dl join public.conversation_endpoints ep on ep.id=dl.endpoint_id
   where dl.state='queued'and ep.adapter='telegram'order by dl.created_at,dl.id limit greatest(1,least(coalesce(p_limit,20),50)))q),'[]'));
end$$;

-- 12. Doctor "awaiting reply" list --------------------------------------------------

-- A member stays listed while their latest message has no approved or rejected reply,
-- and also while their latest reply was not delivered (held for any reason other than a
-- newer member message, not sent, or unknown), so an undelivered reply is never hidden.
create function public.conversation_awaiting_replies()returns jsonb
language plpgsql security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();
begin
 if who is null or who->>'role'<>'doctor'then raise insufficient_privilege;end if;
 return jsonb_build_object('ok',true,'items',coalesce((select jsonb_agg(item order by item->>'reason',item->>'lastMessageAt')from(
  select jsonb_build_object('memberId',cs.user_id,'memberName',coalesce(pr.display_name,''),'lastMessageAt',lm.created_at,'unanswered',
   (select count(*)from public.conversation_messages m2 where m2.conversation_id=c.id and m2.seq>coalesce(dec.v,0)),
   'latestDelivery',ld.state,'latestReason',ld.reason,
   'reason',case when c.version>coalesce(dec.v,0)then 'new_message'else 'not_delivered'end,
   'overLimit',exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and au.kind='message.overflow'and(au.detail->>'version')::bigint>coalesce(dec.v,0)),
   'channel',case lm.source when 'telegram_member'then 'telegram'else 'app'end)as item
  from public.patient_clinical_cases cs join public.conversations c on c.member_id=cs.user_id
  left join public.profiles pr on pr.id=cs.user_id
  cross join lateral(select m.seq,m.created_at,m.source from public.conversation_messages m where m.conversation_id=c.id order by m.seq desc limit 1)lm
  left join lateral(select max(d.context_version)v from public.conversation_drafts d where d.conversation_id=c.id and d.state in('approved','rejected'))dec on true
  left join lateral(select dl.state,dl.reason,dl.created_at from public.conversation_deliveries dl where dl.conversation_id=c.id order by dl.created_at desc,dl.id desc limit 1)ld on true
  -- The conversation version moves with every member message, stored or over the
  -- intake limit, so a message that was not saved still puts the member on the list.
  -- An undelivered last reply stays listed for 30 days.
  where cs.assigned_doctor_id=(who->>'id')::uuid and(c.version>coalesce(dec.v,0)
   or(ld.created_at>clock_timestamp()-interval '30 days'and(ld.state in('definitely_failed','unknown')or(ld.state='held'and ld.reason is distinct from 'newer_member_message'))
    -- A later decision (for example rejecting a draft as no reply needed) clears it.
    and not exists(select 1 from public.conversation_drafts d2 where d2.conversation_id=c.id and d2.state='rejected'and d2.created_at>ld.created_at))))q),'[]'));
end$$;

-- 13. Operations view: problems only, history, no resend ----------------------------

create function public.telegram_delivery_problems()returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform public._real_staff_require_admin();
 return jsonb_build_object('ok',true,'asOf',statement_timestamp(),
  'system',coalesce((select jsonb_agg(jsonb_build_object('id',sm.id,'memberId',sm.member_id,'memberName',coalesce(pr.display_name,''),'template',sm.template_id,'state',sm.state,'reason',sm.reason,'createdAt',sm.created_at,'updatedAt',sm.updated_at,
    'history',(select jsonb_agg(jsonb_build_object('kind',a.kind,'detail',a.detail-'outcome'||case when a.detail?'outcome'then jsonb_build_object('outcomeKind',a.detail#>>'{outcome,kind}')else '{}'end,'at',a.created_at)order by a.id)from public.system_message_audit a where a.message_id=sm.id))order by sm.updated_at desc)
   from public.system_messages sm left join public.profiles pr on pr.id=sm.member_id where sm.state in('held','definitely_failed','unknown')and sm.reason is distinct from 'template_unapproved'and sm.updated_at>clock_timestamp()-interval '30 days'),'[]'),
  -- Held only because the wording is not approved yet (D1): one count, not one row each.
  'unapprovedHeld',(select count(*)from public.system_messages where state='held'and reason='template_unapproved'and updated_at>clock_timestamp()-interval '30 days'),
  'replies',coalesce((select jsonb_agg(jsonb_build_object('id',dl.id,'memberId',c.member_id,'memberName',coalesce(pr.display_name,''),'doctorName',ap.doctor_name,'state',dl.state,'reason',dl.reason,'approvedAt',ap.created_at,
    'history',(select jsonb_agg(jsonb_build_object('kind',a.kind,'detail',jsonb_build_object('reason',a.detail->>'reason','outcomeKind',a.detail#>>'{outcome,kind}'),'at',a.created_at)order by a.id)
     from public.conversation_audit a where a.conversation_id=dl.conversation_id and(a.detail->>'deliveryId'=dl.id::text or a.detail->>'attemptId'in(select id::text from public.conversation_attempts where delivery_id=dl.id))))order by ap.created_at desc)
   from public.conversation_deliveries dl join public.conversation_approvals ap on ap.id=dl.approval_id join public.conversations c on c.id=dl.conversation_id left join public.profiles pr on pr.id=c.member_id
   -- A hold for a newer member message is routine: the doctor already sees it in their list.
   where dl.state in('held','definitely_failed','unknown')and dl.reason is distinct from 'newer_member_message'and ap.created_at>clock_timestamp()-interval '30 days'),'[]'),
  'inbox',jsonb_build_object('dead',(select count(*)from public.channel_inbox where status='dead'),'pending',(select count(*)from public.channel_inbox where status in('received','processing'))));
end$$;

-- 14. Immutability, RLS and grants ---------------------------------------------------

create function public._system_message_attempt_guard()returns trigger language plpgsql set search_path=''as $$begin
 if tg_op='DELETE'or new.id<>old.id or new.message_id<>old.message_id or new.envelope<>old.envelope or new.state_seq<>old.state_seq or new.claimed_at<>old.claimed_at or old.outcome is not null then raise exception using errcode='55000',message='Frozen system message attempt cannot change';end if;return new;
end$$;
create trigger system_message_attempt_frozen before update or delete on public.system_message_attempts for each row execute function public._system_message_attempt_guard();
create function public._system_message_frozen_body()returns trigger language plpgsql set search_path=''as $$begin
 if tg_op='DELETE'or new.body<>old.body or new.body_hash<>old.body_hash or new.endpoint_id<>old.endpoint_id or new.endpoint_generation<>old.endpoint_generation or new.member_id<>old.member_id then raise exception using errcode='55000',message='System message content is immutable';end if;return new;
end$$;
create trigger system_messages_frozen_body before update or delete on public.system_messages for each row execute function public._system_message_frozen_body();
create function public._template_frozen()returns trigger language plpgsql set search_path=''as $$begin
 -- Wording changes are new versions; only the approval flag can be set, and only once.
 if tg_op='DELETE'or new.body<>old.body or new.template_id<>old.template_id or new.version<>old.version or new.locale<>old.locale or(old.approved and not new.approved)then raise exception using errcode='55000',message='Template versions are immutable';end if;return new;
end$$;
create trigger system_message_templates_frozen before update or delete on public.system_message_templates for each row execute function public._template_frozen();

do $$declare n text;f record;begin
 foreach n in array array['telegram_channel_settings','telegram_audit','telegram_link_tokens','channel_inbox','system_message_templates','system_messages','system_message_attempts','system_message_audit','conversation_doctor_alerts','delivery_observations']loop
  execute format('alter table public.%I enable row level security',n);execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
 end loop;
 foreach n in array array['telegram_audit','system_message_audit','delivery_observations','conversation_doctor_alerts']loop
  execute format('create trigger %I before update or delete on public.%I for each row execute function public._conversation_immutable()',n||'_immutable',n);
 end loop;
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public'and(
  p.proname like '\_telegram\_%'escape '\'or p.proname like 'telegram\_%'escape '\'or p.proname like 'channel\_inbox%'escape '\'or p.proname like '\_channel\_inbox%'escape '\'
  or p.proname like '\_system\_message%'escape '\'or p.proname like 'system\_message%'escape '\'or p.proname like '\_delivery\_%'escape '\'or p.proname like '\_conversation\_record%'escape '\'or p.proname like 'delivery\_%'escape '\'
  or p.proname in('conversation_outcome','conversation_reconcile','conversation_workspace','conversation_claim','conversation_awaiting_replies','_template_frozen'))loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
 end loop;
end$$;
revoke all on sequence public.telegram_audit_id_seq,public.system_message_audit_id_seq from public,anon,authenticated,service_role;
grant execute on function public.telegram_link_issue(text),public.telegram_link_status(),public.telegram_unlink(),public.conversation_workspace(uuid),public.conversation_awaiting_replies(),public.telegram_delivery_problems()to authenticated;
grant execute on function public.channel_inbox_commit(jsonb),public.channel_inbox_reject(text,text),public.channel_inbox_next(integer),public.channel_inbox_process(uuid),public.telegram_link_redeem(text,text,bigint),
 public.conversation_claim(uuid,uuid),public.conversation_outcome(uuid,jsonb),public.conversation_reconcile(uuid),
 public.system_message_claim(uuid,uuid),public.system_message_outcome(uuid,jsonb),public.delivery_observe(text,uuid,jsonb),public.delivery_reconcile_stale(integer),public.telegram_dispatch_queue(integer)to service_role;
