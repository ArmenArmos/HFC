-- T-auth PR A (members), design v5 (output/telegram-t1-2026-10-16/TAUTH_DESIGN_V5.md).
-- Telegram becomes the delivery channel for Supabase phone sign-in codes, with the
-- same trust model as SMS (option b). A Telegram account becomes a member's code
-- channel only after a contact proof (own contact shared in the bot, matching phone).
-- Revoking or replacing a binding cancels outstanding codes, challenges and sessions.
-- The T1 bearer link path is removed (closes AB-1). Ships dark: no settings row, no
-- approved wording, NOREON_TELEGRAM_AUTH_ENABLED off.

-- 0. Remove the T1 bearer link path (AB-1) ----------------------------------------
drop function public.telegram_link_issue(text);
drop function public.telegram_link_redeem(text,text,bigint);
drop function public._telegram_link_redeem(text,text,bigint);

-- Endpoints linked by a T1 bearer token have no proven binding: retire them (none in
-- production, which never had a settings row).
do $$declare m uuid;begin
 for m in select distinct member_id from public.conversation_endpoints where adapter='telegram'and active loop
  perform pg_advisory_xact_lock(hashtextextended('telegram-member:'||m::text,0));
  perform 1 from public.patient_clinical_cases where user_id=m for update;
  perform 1 from public.conversations where member_id=m for update;
  update public.conversation_endpoints set active=false,generation=generation+1 where member_id=m and adapter='telegram'and active;
  perform public._telegram_hold_member_deliveries(m,'endpoint_unlinked');
 end loop;
end$$;

-- 1. Tables -------------------------------------------------------------------------
create table public.telegram_auth_challenges (
 id uuid primary key default gen_random_uuid(),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 purpose text not null check(purpose in('member_signin','member_link')),
 target_phone text not null check(target_phone ~ '^\+[1-9][0-9]{6,14}$'),
 target_user uuid references auth.users(id) on delete cascade,
 nonce_hmac text check(nonce_hmac ~ '^[a-f0-9]{64}$'),consent_version text,
 -- Connect while Telegram codes are off may bind but never replace (no sign-out surprise).
 allow_replace boolean not null default false,
 state text not null default 'open'check(state in('open','consumed','cancelled')),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 check(purpose<>'member_link'or target_user is not null),check(purpose<>'member_signin'or nonce_hmac is not null)
);
create index telegram_auth_challenges_phone on public.telegram_auth_challenges(target_phone,created_at);
create table public.telegram_contact_requests (
 id uuid primary key default gen_random_uuid(),challenge_id uuid not null references public.telegram_auth_challenges(id),
 principal_ref text not null,address text not null check(address ~ '^[1-9][0-9]{0,15}$'),
 state text not null default 'open'check(state in('open','proven','refused','superseded','cancelled')),
 refusal text,requested_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null
);
create index telegram_contact_requests_open on public.telegram_contact_requests(principal_ref)where state='open';
create table public.telegram_phone_proofs (
 id uuid primary key default gen_random_uuid(),challenge_id uuid not null unique references public.telegram_auth_challenges(id),
 phone text not null,principal_ref text not null,account_ref text not null,address text not null,nonce_hmac text,
 proven_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,consumed_at timestamptz,cancelled_at timestamptz
);
create table public.telegram_auth_bindings (
 id uuid primary key default gen_random_uuid(),auth_user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in('member','staff')),principal_ref text not null,account_ref text not null,
 phone text not null check(phone ~ '^\+[1-9][0-9]{6,14}$'),address text not null check(address ~ '^[1-9][0-9]{0,15}$'),
 generation bigint not null check(generation>0),active boolean not null default true,
 proven_at timestamptz not null default clock_timestamp(),proven_by uuid,
 created_at timestamptz not null default clock_timestamp(),revoked_at timestamptz,revoked_reason text
);
create unique index telegram_auth_bindings_principal on public.telegram_auth_bindings(principal_ref)where active;
create unique index telegram_auth_bindings_user on public.telegram_auth_bindings(auth_user_id)where active;
create unique index telegram_auth_bindings_phone on public.telegram_auth_bindings(kind,phone)where active;
create table public.auth_code_requests (
 id uuid primary key default gen_random_uuid(),phone text not null check(phone ~ '^\+[1-9][0-9]{6,14}$'),
 nonce_hmac text not null check(nonce_hmac ~ '^[a-f0-9]{64}$'),channel text not null default 'telegram'check(channel='telegram'),
 state text not null default 'issuing'check(state in('issuing','sending','sent','failed','unknown','verified','cancelled','refused','exhausted')),
 lease_until timestamptz not null,webhook_id text unique,body_hmac text,refusal text,
 -- HMAC(key, requestId|phone|code) recorded when the send was accepted; the code itself is never stored.
 code_digest text check(code_digest ~ '^[a-f0-9]{64}$'),
 -- Wrong codes are counted here, never only at GoTrue (the digest check runs first).
 failed_checks integer not null default 0,last_failed_at timestamptz,proof_links integer not null default 0,verified_result jsonb,
 binding_id uuid references public.telegram_auth_bindings(id),binding_generation bigint,proof_id uuid references public.telegram_phone_proofs(id),
 address text,verified_user uuid,verified_session uuid,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create index auth_code_requests_phone on public.auth_code_requests(phone,created_at);
create index auth_code_requests_failed on public.auth_code_requests(phone,last_failed_at)where failed_checks>0;
create table public.auth_cleanup_jobs (
 id uuid primary key default gen_random_uuid(),auth_user_id uuid not null references auth.users(id) on delete cascade,
 revoked_at timestamptz not null,due_at timestamptz not null,attempts integer not null default 0,
 state text not null default 'due'check(state in('due','done')),done_at timestamptz,deleted_sessions integer
);
create table public.telegram_auth_audit (
 id bigint generated always as identity primary key,auth_user_id uuid,kind text not null,detail jsonb not null,created_at timestamptz not null default clock_timestamp()
);
-- Sign-in prompts and notices to a chat that may not have a clinical endpoint yet.
create table public.telegram_auth_messages (
 id uuid primary key default gen_random_uuid(),address text not null check(address ~ '^[1-9][0-9]{0,15}$'),principal_ref text not null,
 template_id text not null,template_version integer not null,locale text not null,
 foreign key(template_id,template_version,locale)references public.system_message_templates(template_id,version,locale),
 body text not null,keyboard jsonb check(keyboard is null or keyboard in('{"kind":"request_contact"}'::jsonb,'{"kind":"remove"}'::jsonb)),
 source_inbox_id uuid references public.channel_inbox(id),
 state text not null default 'queued'check(state in('queued','held','sending','accepted_by_provider','definitely_failed','unknown')),
 reason text,state_seq bigint not null default 0,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(source_inbox_id,template_id)
);
create table public.telegram_auth_message_attempts (
 id uuid primary key,message_id uuid not null unique references public.telegram_auth_messages(id),state_seq bigint not null,envelope jsonb not null,
 claimed_at timestamptz not null default clock_timestamp(),outcome jsonb,outcome_at timestamptz
);
alter table public.conversation_endpoints add column binding_id uuid references public.telegram_auth_bindings(id);
alter table public.delivery_observations drop constraint delivery_observations_channel_check;
alter table public.delivery_observations add constraint delivery_observations_channel_check check(channel in('conversation','system','auth'));
alter table public.channel_inbox drop constraint channel_inbox_kind_check;
alter table public.channel_inbox add constraint channel_inbox_kind_check check(kind in('text','link','start','callback','media','contact','rejected'));

-- D1-style placeholders; held at claim until approved. The share label is used on the button.
insert into public.system_message_templates(template_id,version,locale,body)values
 ('telegram.share_contact',1,'en','UNAPPROVED PLACEHOLDER. To confirm this is your number, press the button below to share your phone number with Noreon.'),
 ('telegram.share_contact',1,'hy','UNAPPROVED PLACEHOLDER. Որպեսզի հաստատենք, որ սա ձեր համարն է, սեղմեք ներքևի կոճակը և կիսվեք ձեր հեռախոսահամարով Noreon-ի հետ։'),
 ('telegram.share_contact_label',1,'en','Share my phone number'),
 ('telegram.share_contact_label',1,'hy','Կիսվել իմ համարով'),
 ('telegram.contact_ok',1,'en','UNAPPROVED PLACEHOLDER. Your number is confirmed. Go back to the Noreon app to continue.'),
 ('telegram.contact_ok',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր համարը հաստատված է։ Շարունակելու համար վերադարձեք Noreon հավելված։'),
 ('telegram.contact_refused',1,'en','UNAPPROVED PLACEHOLDER. We could not confirm this number. Open Noreon and try again.'),
 ('telegram.contact_refused',1,'hy','UNAPPROVED PLACEHOLDER. Չհաջողվեց հաստատել այս համարը։ Բացեք Noreon-ը և փորձեք նորից։'),
 ('telegram.binding_replaced',1,'en','UNAPPROVED PLACEHOLDER. Your Noreon account was connected to another Telegram account. If this was not you, contact Noreon.'),
 ('telegram.binding_replaced',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր Noreon հաշիվը կապվել է մեկ այլ Telegram հաշվի։ Եթե դա դուք չեք, դիմեք Noreon-ին։');

-- 2. Helpers --------------------------------------------------------------------------
create function public._telegram_auth_audit(u uuid,k text,d jsonb)returns void language sql security definer set search_path=''as $$
 insert into public.telegram_auth_audit(auth_user_id,kind,detail)values(u,k,d)
$$;
create function public._auth_phone(u uuid)returns text language sql stable security definer set search_path=''as $$
 select case when phone is null or phone=''then null else '+'||ltrim(phone,'+')end from auth.users where id=u
$$;
create function public._auth_user_for_phone(p text)returns uuid language sql stable security definer set search_path=''as $$
 select id from auth.users where phone=ltrim(p,'+')
$$;
create function public._telegram_auth_locale(u uuid)returns text language sql stable security definer set search_path=''as $$
 select coalesce((select locale from public.profiles where id=u),'hy')
$$;
-- Queue a sign-in prompt or notice (newest template version; approval checked at claim).
create function public._telegram_auth_enqueue(p_template text,p_locale text,p_address text,p_principal text,p_keyboard jsonb,p_inbox uuid)returns uuid
language plpgsql security definer set search_path=''as $$
declare t public.system_message_templates;new_id uuid;
begin
 select * into t from public.system_message_templates where template_id=p_template and locale=p_locale order by version desc limit 1;
 if not found then return null;end if;
 insert into public.telegram_auth_messages(address,principal_ref,template_id,template_version,locale,body,keyboard,source_inbox_id)
 values(p_address,p_principal,t.template_id,t.version,t.locale,t.body,p_keyboard,p_inbox)on conflict(source_inbox_id,template_id)do nothing returning id into new_id;
 return new_id;
end$$;

-- 3. Revocation (R2): binding off, codes/challenges/requests cancelled, sessions ended --
create function public._telegram_revoke_binding(p_binding uuid,p_reason text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare b public.telegram_auth_bindings;n integer;
begin
 select * into b from public.telegram_auth_bindings where id=p_binding for update;
 if not found or not b.active then return jsonb_build_object('ok',true,'revoked',false);end if;
 update public.telegram_auth_bindings set active=false,revoked_at=clock_timestamp(),revoked_reason=p_reason where id=b.id;
 -- Clinical delivery through this account stops; queued replies are held (T1 fence,
 -- T1 lock order: case, conversation, endpoints, deliveries).
 perform pg_advisory_xact_lock(hashtextextended('telegram-member:'||b.auth_user_id::text,0));
 perform 1 from public.patient_clinical_cases where user_id=b.auth_user_id for update;
 perform 1 from public.conversations where member_id=b.auth_user_id for update;
 update public.conversation_endpoints set active=false,generation=generation+1 where adapter='telegram'and principal_ref=b.principal_ref and active;
 perform public._telegram_hold_member_deliveries(b.auth_user_id,'endpoint_unlinked');
 update public.telegram_auth_challenges set state='cancelled'where state='open'and(target_user=b.auth_user_id or target_phone=b.phone);
 update public.telegram_contact_requests set state='cancelled'where state='open'and challenge_id in(select id from public.telegram_auth_challenges where target_user=b.auth_user_id or target_phone=b.phone);
 update public.telegram_phone_proofs set cancelled_at=clock_timestamp()where consumed_at is null and cancelled_at is null and phone=b.phone;
 update public.auth_code_requests set state='cancelled',updated_at=clock_timestamp()where phone=b.phone and state in('issuing','sending','sent');
 -- Outstanding Supabase codes: GoTrue v2.196 verifies against the auth.users columns
 -- (measured: clearing them rejects a delivered code; deleting one_time_tokens alone does not).
 update auth.users set confirmation_token='',recovery_token='',phone_change_token='',reauthentication_token='',email_change_token_new='',email_change_token_current=''where id=b.auth_user_id;
 delete from auth.one_time_tokens where user_id=b.auth_user_id;
 delete from auth.sessions where user_id=b.auth_user_id;get diagnostics n=row_count;
 insert into public.auth_cleanup_jobs(auth_user_id,revoked_at,due_at)values(b.auth_user_id,clock_timestamp(),clock_timestamp()+interval '6 minutes'),(b.auth_user_id,clock_timestamp(),clock_timestamp()+interval '12 minutes');
 perform public._telegram_auth_audit(b.auth_user_id,'binding.revoked',jsonb_build_object('bindingId',b.id,'reason',p_reason,'sessions',n));
 return jsonb_build_object('ok',true,'revoked',true,'sessions',n);
end$$;

-- Bind (or refresh) a member's Telegram account after a contact proof (lock order:
-- advisory phone, principal, user; then bindings). Never overrides another user's binding.
create function public._telegram_auth_bind(p_user uuid,p_kind text,p_principal text,p_account text,p_phone text,p_address text,p_proven_by uuid,p_allow_replace boolean default true)returns jsonb
language plpgsql security definer set search_path=''as $$
declare cur public.telegram_auth_bindings;other public.telegram_auth_bindings;g bigint;nb public.telegram_auth_bindings;
begin
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-phone:'||p_phone,0));
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-principal:'||p_principal,0));
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-user:'||p_user::text,0));
 if public._auth_phone(p_user)is distinct from p_phone then return jsonb_build_object('ok',false,'code','phone_mismatch');end if;
 select * into other from public.telegram_auth_bindings where principal_ref=p_principal and active for update;
 if found and other.auth_user_id<>p_user then return jsonb_build_object('ok',false,'code','principal_bound_elsewhere');end if;
 select * into cur from public.telegram_auth_bindings where auth_user_id=p_user and active for update;
 if found and cur.principal_ref=p_principal then
  update public.telegram_auth_bindings set proven_at=clock_timestamp(),proven_by=p_proven_by,address=p_address where id=cur.id;
  perform public._telegram_auth_audit(p_user,'binding.reproven',jsonb_build_object('bindingId',cur.id));
  return jsonb_build_object('ok',true,'result','refreshed','bindingId',cur.id,'generation',cur.generation);
 end if;
 if not p_allow_replace and(found or exists(select 1 from public.telegram_auth_bindings where kind=p_kind and phone=p_phone and active and auth_user_id<>p_user))then
  return jsonb_build_object('ok',false,'code','principal_changed');end if;
 if found then perform public._telegram_revoke_binding(cur.id,'replaced');
  perform public._telegram_auth_enqueue('telegram.binding_replaced',public._telegram_auth_locale(p_user),cur.address,cur.principal_ref,null,null);
 end if;
 -- The same phone held by another account's binding of this kind is retired too (phone moved).
 for other in select * from public.telegram_auth_bindings where kind=p_kind and phone=p_phone and active and auth_user_id<>p_user for update loop
  perform public._telegram_revoke_binding(other.id,'phone_moved');
 end loop;
 g:=coalesce((select max(generation)from public.telegram_auth_bindings where auth_user_id=p_user),0)+1;
 insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation,proven_by)
 values(p_user,p_kind,p_principal,p_account,p_phone,p_address,g,p_proven_by)returning * into nb;
 perform public._telegram_auth_audit(p_user,'binding.created',jsonb_build_object('bindingId',nb.id,'generation',g,'replaced',cur.id is not null));
 return jsonb_build_object('ok',true,'result',case when cur.id is null then 'bound'else 'replaced'end,'bindingId',nb.id,'generation',g);
end$$;

-- 4. Challenges and contact proof -----------------------------------------------------
-- Service-only: the server action authenticates the member (member_link) or sets the
-- browser nonce (member_signin) before calling.
create function public.telegram_auth_challenge_create(p_purpose text,p_phone text,p_user uuid default null,p_nonce_hmac text default null,p_consent_version text default null,p_allow_replace boolean default false)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.telegram_channel_settings;raw text;exp timestamptz;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into s from public.telegram_channel_settings where singleton;
 if not found then return jsonb_build_object('ok',false,'code','unavailable');end if;
 if coalesce(p_phone,'')!~'^\+[1-9][0-9]{6,14}$'or coalesce(p_purpose,'')not in('member_signin','member_link')then return jsonb_build_object('ok',false,'code','invalid');end if;
 if p_purpose='member_link'and(p_user is null or public._auth_phone(p_user)is distinct from p_phone or not exists(select 1 from auth.users where id=p_user and phone_confirmed_at is not null)
  or exists(select 1 from public.workspace_staff where user_id=p_user))then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 if p_consent_version is not null and p_consent_version is distinct from s.consent_version then return jsonb_build_object('ok',false,'code','consent_required');end if;
 if p_purpose='member_signin'and coalesce(p_nonce_hmac,'')!~'^[a-f0-9]{64}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-phone:'||p_phone,0));
 -- Limits and supersession are per browser (sign-in) or per member (Connect), so a stranger
 -- cannot spend a member's quota or cancel their open challenge.
 if(select count(*)from public.telegram_auth_challenges where target_phone=p_phone and created_at>clock_timestamp()-interval '1 hour'
   and(nonce_hmac is not distinct from p_nonce_hmac and target_user is not distinct from p_user))>=10
  or(p_purpose='member_signin'and(select count(*)from public.telegram_auth_challenges where target_phone=p_phone and purpose='member_signin'and created_at>clock_timestamp()-interval '1 hour')>=50)
 then return jsonb_build_object('ok',false,'code','rate_limited');end if;
 update public.telegram_auth_challenges set state='cancelled'where state='open'and target_phone=p_phone and purpose=p_purpose
  and nonce_hmac is not distinct from p_nonce_hmac and target_user is not distinct from p_user;
 raw:=translate(encode(extensions.gen_random_bytes(24),'base64'),'+/','-_');exp:=clock_timestamp()+interval '10 minutes';
 insert into public.telegram_auth_challenges(token_hash,purpose,target_phone,target_user,nonce_hmac,consent_version,allow_replace,expires_at)
 values(encode(sha256(convert_to(raw,'UTF8')),'hex'),p_purpose,p_phone,p_user,p_nonce_hmac,case when p_purpose='member_link'then p_consent_version end,coalesce(p_allow_replace,false),exp);
 return jsonb_build_object('ok',true,'token',raw,'expiresAt',exp);
end$$;

-- /start <token>: open a contact request and ask for the contact.
create function public._telegram_auth_start(r public.channel_inbox)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ch public.telegram_auth_challenges;req uuid;addr text:=(r.payload->>'chatId');loc text;
begin
 select * into ch from public.telegram_auth_challenges where token_hash=r.payload->>'tokenHash'for update;
 if not found or ch.state<>'open'or ch.expires_at<=clock_timestamp()then
  return public._channel_inbox_finish(r.id,'done','auth:token_invalid');end if;
 update public.telegram_contact_requests set state='superseded'where principal_ref=r.principal_ref and state='open';
 insert into public.telegram_contact_requests(challenge_id,principal_ref,address,expires_at)
 values(ch.id,r.principal_ref,addr,least(ch.expires_at,clock_timestamp()+interval '5 minutes'))returning id into req;
 loc:=case when ch.target_user is null then 'hy'else public._telegram_auth_locale(ch.target_user)end;
 perform public._telegram_auth_enqueue('telegram.share_contact',loc,addr,r.principal_ref,'{"kind":"request_contact"}',r.id);
 return public._channel_inbox_finish(r.id,'done','auth:prompted');
end$$;

-- Own contact shared: prove the phone for the single open request of this principal.
create function public._telegram_auth_contact(r public.channel_inbox)returns jsonb
language plpgsql security definer set search_path=''as $$
declare req public.telegram_contact_requests;ch public.telegram_auth_challenges;s public.telegram_channel_settings;sent timestamptz;bound jsonb;loc text;act jsonb;ep public.conversation_endpoints;
 addr text:=(r.payload->>'chatId');phone text:=r.payload->>'phone';target text;
begin
 select * into s from public.telegram_channel_settings where singleton;
 -- Lock order (§2): advisory phone first, then rows. Read the target without locking.
 select c.target_phone into target from public.telegram_contact_requests q join public.telegram_auth_challenges c on c.id=q.challenge_id
  where q.principal_ref=r.principal_ref and q.state='open'order by q.requested_at desc limit 1;
 -- No open request: a contact card is just a non-text message (T1 media handling).
 if target is null then return public._channel_inbox_receive_media(r);end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-phone:'||target,0));
 select * into req from public.telegram_contact_requests where principal_ref=r.principal_ref and state='open'order by requested_at desc limit 1 for update;
 if not found then return public._channel_inbox_receive_media(r);end if;
 select * into ch from public.telegram_auth_challenges where id=req.challenge_id for update;
 -- A newer /start for another phone slipped in: retry under the right lock.
 if ch.target_phone<>target then raise exception 'telegram contact target changed' using errcode='40001';end if;
 loc:=case when ch.target_user is null then 'hy'else public._telegram_auth_locale(ch.target_user)end;
 sent:=to_timestamp((r.payload->>'sentAt')::bigint);
 if ch.state<>'open'or ch.expires_at<=clock_timestamp()or req.expires_at<=clock_timestamp()
  or sent<date_trunc('second',req.requested_at)or sent>req.expires_at or phone is distinct from ch.target_phone then
  update public.telegram_contact_requests set state='refused',refusal=case when phone is null then 'not_own_contact'when phone is distinct from ch.target_phone then 'phone_mismatch'else 'stale'end where id=req.id;
  update public.telegram_auth_challenges set state='consumed'where id=ch.id and state='open';
  perform public._telegram_auth_enqueue('telegram.contact_refused',loc,addr,r.principal_ref,'{"kind":"remove"}',r.id);
  return public._channel_inbox_finish(r.id,'done','contact:refused');
 end if;
 update public.telegram_contact_requests set state='proven'where id=req.id;
 update public.telegram_auth_challenges set state='consumed'where id=ch.id;
 if ch.purpose='member_link'then
  bound:=public._telegram_auth_bind(ch.target_user,'member',r.principal_ref,public._telegram_account_ref(s),phone,addr,ch.id,ch.allow_replace);
  if bound->>'ok'<>'true'then
   perform public._telegram_auth_enqueue('telegram.contact_refused',loc,addr,r.principal_ref,'{"kind":"remove"}',r.id);
   return public._channel_inbox_finish(r.id,'done','contact:'||(bound->>'code'));end if;
  if ch.consent_version is not null and ch.consent_version=s.consent_version then
   act:=public._telegram_replies_activate(ch.target_user,(bound->>'bindingId')::uuid);
   -- Replies on: the T1 link confirmation (clinical outbox, member's language) is the answer.
   if act->>'ok'='true'then
    select * into ep from public.conversation_endpoints where id=(act->>'endpointId')::uuid;
    perform public._system_message_enqueue('telegram.link_confirmed',ep.member_id,ep,r.id);
    return public._channel_inbox_finish(r.id,'done','contact:linked');
   end if;
  end if;
 else
  insert into public.telegram_phone_proofs(challenge_id,phone,principal_ref,account_ref,address,nonce_hmac,expires_at)
  values(ch.id,phone,r.principal_ref,public._telegram_account_ref(s),addr,ch.nonce_hmac,clock_timestamp()+interval '10 minutes');
 end if;
 perform public._telegram_auth_enqueue('telegram.contact_ok',loc,addr,r.principal_ref,'{"kind":"remove"}',r.id);
 return public._channel_inbox_finish(r.id,'done','contact:proven');
end$$;

-- 5. Code requests (R3, app-level) ------------------------------------------------------
create function public.auth_code_request_begin(p_phone text,p_nonce_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare id uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_phone,'')!~'^\+[1-9][0-9]{6,14}$'or coalesce(p_nonce_hmac,'')!~'^[a-f0-9]{64}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-code:'||p_phone,0));
 if exists(select 1 from public.auth_code_requests where phone=p_phone and state in('issuing','sending')and lease_until>clock_timestamp())then
  return jsonb_build_object('ok',false,'code','busy');end if;
 -- Expired leases of anyone are retired; a sent code is superseded only for this browser,
 -- so a stranger without a working CAPTCHA cannot cancel a member's pending code.
 update public.auth_code_requests set state='unknown',updated_at=clock_timestamp()where phone=p_phone and state in('issuing','sending');
 update public.auth_code_requests set state='cancelled',updated_at=clock_timestamp()where phone=p_phone and state='sent'and nonce_hmac=p_nonce_hmac;
 insert into public.auth_code_requests(phone,nonce_hmac,lease_until)values(p_phone,p_nonce_hmac,clock_timestamp()+interval '15 seconds')returning auth_code_requests.id into id;
 return jsonb_build_object('ok',true,'requestId',id);
end$$;

-- Called by the signed Send-SMS hook. Returns the single destination or a refusal.
create function public.auth_code_request_claim(p_phone text,p_webhook_id text,p_body_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.auth_code_requests;u uuid;b public.telegram_auth_bindings;pf public.telegram_phone_proofs;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_webhook_id,'')!~'^[A-Za-z0-9_-]{1,128}$'or coalesce(p_body_hmac,'')!~'^[a-f0-9]{64}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-code:'||p_phone,0));
 select * into r from public.auth_code_requests where webhook_id=p_webhook_id;
 if found then
  if r.body_hmac<>p_body_hmac then return jsonb_build_object('ok',false,'code','conflict');end if;
  return jsonb_build_object('ok',true,'replay',true,'requestId',r.id,'state',r.state,'address',r.address);
 end if;
 select * into r from public.auth_code_requests where phone=p_phone and state='issuing'and lease_until>clock_timestamp()order by created_at desc limit 1 for update;
 if not found then return jsonb_build_object('ok',false,'code','no_request');end if;
 -- A fresh contact proof made by this same browser wins: it is how a member who lost
 -- their Telegram account signs in with a new one (replacement follows verification, §2).
 select * into pf from public.telegram_phone_proofs where phone=p_phone and nonce_hmac=r.nonce_hmac and consumed_at is null and cancelled_at is null and expires_at>clock_timestamp()
  and not exists(select 1 from public.telegram_auth_bindings x where x.principal_ref=telegram_phone_proofs.principal_ref and x.active and x.phone<>p_phone)order by proven_at desc limit 1;
 if found then
  update public.auth_code_requests set state='sending',webhook_id=p_webhook_id,body_hmac=p_body_hmac,proof_id=pf.id,address=pf.address,updated_at=clock_timestamp()where id=r.id;
  return jsonb_build_object('ok',true,'replay',false,'requestId',r.id,'address',pf.address,'route','proof');
 end if;
 u:=public._auth_user_for_phone(p_phone);
 select * into b from public.telegram_auth_bindings where kind='member'and auth_user_id=u and phone=p_phone and active;
 if not found then
  update public.auth_code_requests set state='refused',refusal='no_destination',webhook_id=p_webhook_id,body_hmac=p_body_hmac,updated_at=clock_timestamp()where id=r.id;
  return jsonb_build_object('ok',false,'code','no_destination','requestId',r.id);end if;
 if b.proven_at<clock_timestamp()-interval '30 days'then
  update public.auth_code_requests set state='refused',refusal='reproof_required',webhook_id=p_webhook_id,body_hmac=p_body_hmac,updated_at=clock_timestamp()where id=r.id;
  return jsonb_build_object('ok',false,'code','reproof_required','requestId',r.id);end if;
 update public.auth_code_requests set state='sending',webhook_id=p_webhook_id,body_hmac=p_body_hmac,binding_id=b.id,binding_generation=b.generation,address=b.address,updated_at=clock_timestamp()where id=r.id;
 return jsonb_build_object('ok',true,'replay',false,'requestId',r.id,'address',b.address,'route','binding');
end$$;

create function public.auth_code_request_finish(p_request uuid,p_webhook_id text,p_outcome text,p_code_digest text default null)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_outcome,'')not in('accepted','failed','unknown')or(p_outcome='accepted'and coalesce(p_code_digest,'')!~'^[a-f0-9]{64}$')then return jsonb_build_object('ok',false,'code','invalid');end if;
 update public.auth_code_requests set state=case p_outcome when 'accepted'then 'sent'when 'failed'then 'failed'else 'unknown'end,
  code_digest=case when p_outcome='accepted'then p_code_digest end,updated_at=clock_timestamp()
 where id=p_request and webhook_id=p_webhook_id and state='sending';
 return jsonb_build_object('ok',true,'updated',found);
end$$;

create function public.auth_code_request_status(p_request uuid,p_nonce_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.auth_code_requests;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.auth_code_requests where id=p_request;
 if not found or r.nonce_hmac is distinct from p_nonce_hmac then return jsonb_build_object('ok',false,'code','unknown_request');end if;
 return jsonb_build_object('ok',true,'state',r.state,'refusal',r.refusal);
end$$;

-- Before verifyOtp: the typed code must be the one this browser's request delivered (v5.1 #1).
create function public.auth_code_request_check(p_request uuid,p_nonce_hmac text,p_code_digest text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.auth_code_requests;ceiling boolean;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.auth_code_requests where id=p_request for update;
 if not found or r.nonce_hmac is distinct from p_nonce_hmac then return jsonb_build_object('ok',false,'code','unknown_request');end if;
 if r.state<>'sent'then return jsonb_build_object('ok',false,'code','not_verifiable','state',r.state);end if;
 if r.updated_at<clock_timestamp()-interval '10 minutes'then return jsonb_build_object('ok',false,'code','expired');end if;
 -- Guessing is bounded here: 5 wrong codes end a request. Once a phone has 10 wrong codes in
 -- an hour, any wrong code ends its request at once, but a request with no wrong guesses
 -- still accepts the right code, so strangers cannot lock the member out.
 ceiling:=(select coalesce(sum(failed_checks),0)from public.auth_code_requests where phone=r.phone and failed_checks>0 and last_failed_at>clock_timestamp()-interval '1 hour')>=10;
 if r.code_digest is not distinct from p_code_digest then
  if ceiling and r.failed_checks>0 then
   update public.auth_code_requests set state='exhausted',updated_at=clock_timestamp()where id=r.id;
   return jsonb_build_object('ok',false,'code','too_many_attempts');end if;
  return jsonb_build_object('ok',true,'phone',r.phone);
 end if;
 update public.auth_code_requests set failed_checks=failed_checks+1,last_failed_at=clock_timestamp(),
  state=case when ceiling or failed_checks+1>=5 then 'exhausted'else state end,updated_at=clock_timestamp()where id=r.id;
 return jsonb_build_object('ok',false,'code',case when ceiling or r.failed_checks+1>=5 then 'too_many_attempts'else 'wrong_code'end);
end$$;

-- "I no longer have that Telegram account": only a recent request of this browser that reached
-- the hook (so passed Auth's CAPTCHA) may open proof links, at most two per request.
create function public.auth_code_request_allow_proof(p_request uuid,p_nonce_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 update public.auth_code_requests set proof_links=proof_links+1 where id=p_request and nonce_hmac=p_nonce_hmac and state in('sent','refused')
  and created_at>clock_timestamp()-interval '10 minutes'and proof_links<2;
 return jsonb_build_object('ok',found);
end$$;

-- The app could not confirm issuance (Auth error after the hook, or no hook at all): never verifiable.
create function public.auth_code_request_abandon(p_request uuid,p_nonce_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 update public.auth_code_requests set state='unknown',updated_at=clock_timestamp()where id=p_request and nonce_hmac=p_nonce_hmac and state in('issuing','sending','sent');
 return jsonb_build_object('ok',true,'updated',found);
end$$;

-- After Supabase verifyOtp succeeded for this browser's request: record the session and
-- finalise a proof into a binding. A replacement ends every session, including this one.
create function public.auth_code_request_verified(p_request uuid,p_nonce_hmac text,p_code_digest text,p_user uuid,p_session uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.auth_code_requests;pf public.telegram_phone_proofs;res jsonb;out jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.auth_code_requests where id=p_request for update;
 -- A retry after a lost response gets the stored answer.
 if found and r.state='verified'and r.nonce_hmac=p_nonce_hmac and r.verified_session=p_session and r.verified_result is not null then return r.verified_result;end if;
 if not found or r.nonce_hmac is distinct from p_nonce_hmac or r.state<>'sent'or r.code_digest is distinct from p_code_digest then return jsonb_build_object('ok',false,'code','not_verifiable');end if;
 if public._auth_phone(p_user)is distinct from r.phone then return jsonb_build_object('ok',false,'code','user_mismatch');end if;
 update public.auth_code_requests set state='verified',verified_user=p_user,verified_session=p_session,updated_at=clock_timestamp()where id=r.id;
 out:=jsonb_build_object('ok',true,'result','signed_in');
 if r.proof_id is not null and not exists(select 1 from public.workspace_staff where user_id=p_user)then
  select * into pf from public.telegram_phone_proofs where id=r.proof_id for update;
  if pf.consumed_at is null and pf.cancelled_at is null then
   update public.telegram_phone_proofs set consumed_at=clock_timestamp()where id=pf.id;
   res:=public._telegram_auth_bind(p_user,'member',pf.principal_ref,pf.account_ref,pf.phone,pf.address,pf.challenge_id);
   out:=case when res->>'ok'<>'true'then jsonb_build_object('ok',true,'result','signed_in','binding',res->>'code')
    else jsonb_build_object('ok',true,'result',case when res->>'result'='replaced'then 'sign_in_again'else 'signed_in'end,'binding',res->>'result')end;
  end if;
 end if;
 update public.auth_code_requests set verified_result=out where id=r.id;
 return out;
end$$;

-- 6. Member actions --------------------------------------------------------------------
create function public.telegram_auth_unlink()returns jsonb
language plpgsql security definer set search_path=''as $$
declare b public.telegram_auth_bindings;
begin
 if auth.role()is distinct from 'authenticated'or auth.uid()is null then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-user:'||auth.uid()::text,0));
 select * into b from public.telegram_auth_bindings where auth_user_id=auth.uid()and kind='member'and active;
 if not found then return jsonb_build_object('ok',true,'unlinked',false);end if;
 return public._telegram_revoke_binding(b.id,'member_unlinked')||jsonb_build_object('unlinked',true);
end$$;

-- Telegram replies (T1 clinical channel) need an active binding plus consent. Mirrors
-- T1 redemption: one Telegram account per member, relinking retires older endpoints.
create function public._telegram_replies_activate(m uuid,p_binding uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare b public.telegram_auth_bindings;p public.conversation_policy;ep public.conversation_endpoints;other public.conversation_endpoints;g bigint;
begin
 if not public._telegram_member_eligible(m)then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 select * into p from public.conversation_policy where singleton;
 if not found then return jsonb_build_object('ok',false,'code','unavailable');end if;
 perform pg_advisory_xact_lock(hashtextextended('telegram-member:'||m::text,0));
 perform 1 from public.patient_clinical_cases where user_id=m for update;
 perform 1 from public.conversations where member_id=m for update;
 select * into b from public.telegram_auth_bindings where id=p_binding and auth_user_id=m and kind='member'and active;
 if not found then return jsonb_build_object('ok',false,'code','telegram_not_connected');end if;
 select * into ep from public.conversation_endpoints where adapter='telegram'and account_ref=b.account_ref and principal_ref=b.principal_ref for update;
 if found and ep.active and ep.member_id<>m then return jsonb_build_object('ok',false,'code','principal_linked_elsewhere');end if;
 for other in select * from public.conversation_endpoints where member_id=m and active and id is distinct from ep.id for update loop
  update public.conversation_endpoints set active=false,generation=generation+1 where id=other.id;
 end loop;
 g:=greatest(coalesce((select max(generation)from public.conversation_endpoints where member_id=m),0),coalesce(ep.generation,0))+1;
 if ep.id is null then
  insert into public.conversation_endpoints(member_id,adapter,account_ref,principal_ref,address,generation,active,policy_version,expires_at,max_utf16,binding_id)
  values(m,'telegram',b.account_ref,b.principal_ref,b.address,g,true,p.version,'infinity',4096,b.id)returning * into ep;
 else
  update public.conversation_endpoints set member_id=m,address=b.address,generation=g,active=true,policy_version=p.version,expires_at='infinity',max_utf16=4096,binding_id=b.id
  where id=ep.id returning * into ep;
 end if;
 perform public._telegram_hold_member_deliveries(m,'endpoint_relinked');
 perform public._telegram_audit(m,'link.redeemed',jsonb_build_object('endpointId',ep.id,'generation',ep.generation,'bindingId',b.id));
 return jsonb_build_object('ok',true,'endpointId',ep.id,'generation',ep.generation);
end$$;
create or replace function public.telegram_link_status()returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=auth.uid();s public.telegram_channel_settings;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 select * into s from public.telegram_channel_settings where singleton;
 if not found then return jsonb_build_object('ok',true,'available',false,'linked',false,'connected',false);end if;
 return jsonb_build_object('ok',true,'available',public._telegram_member_eligible(m),
  'connected',exists(select 1 from public.telegram_auth_bindings where auth_user_id=m and kind='member'and active),
  'linked',exists(select 1 from public.conversation_endpoints where member_id=m and adapter='telegram'and active),'consentVersion',s.consent_version);
end$$;

-- 7. Auth message outbox (claim, outcome, queue) -----------------------------------------
create function public.telegram_auth_message_claim(p_message uuid,p_attempt uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.telegram_auth_messages;t public.system_message_templates;lbl public.system_message_templates;envelope jsonb;hold text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform set_config('lock_timeout','2s',true);
 select * into m from public.telegram_auth_messages where id=p_message for update;
 if not found then return jsonb_build_object('ok',false,'code','message_unknown');end if;
 if m.state<>'queued'or exists(select 1 from public.telegram_auth_message_attempts where id=p_attempt or message_id=p_message)then return jsonb_build_object('ok',false,'code','already_claimed_or_held');end if;
 select * into t from public.system_message_templates where template_id=m.template_id and version=m.template_version and locale=m.locale;
 if m.keyboard->>'kind'='request_contact'then
  select * into lbl from public.system_message_templates where template_id='telegram.share_contact_label'and locale=m.locale and approved order by version desc limit 1;
 end if;
 hold:=case when not t.approved then 'template_unapproved'when t.body<>m.body then 'template_changed'when m.keyboard->>'kind'='request_contact'and lbl.body is null then 'template_unapproved'
  when m.created_at<clock_timestamp()-interval '15 minutes'then 'expired'end;
 if hold is not null then
  update public.telegram_auth_messages set state='held',reason=hold,state_seq=state_seq+1,updated_at=clock_timestamp()where id=m.id;
  return jsonb_build_object('ok',false,'code',hold);end if;
 envelope:=jsonb_build_object('messageId',m.id,'attemptId',p_attempt,'address',m.address,'text',m.body,
  'keyboard',case m.keyboard->>'kind'when 'request_contact'then jsonb_build_object('kind','request_contact','label',lbl.body)when 'remove'then jsonb_build_object('kind','remove')end);
 update public.telegram_auth_messages set state='sending',state_seq=state_seq+1,updated_at=clock_timestamp()where id=m.id returning * into m;
 insert into public.telegram_auth_message_attempts(id,message_id,state_seq,envelope)values(p_attempt,m.id,m.state_seq,envelope);
 return jsonb_build_object('ok',true,'fresh',true,'envelope',jsonb_strip_nulls(envelope));
exception when lock_not_available then return jsonb_build_object('ok',false,'code','busy');
end$$;
create function public.telegram_auth_message_outcome(p_attempt uuid,p_outcome jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare at public.telegram_auth_message_attempts;m public.telegram_auth_messages;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_attempt is null or public._delivery_outcome_valid(p_outcome)is not true then return jsonb_build_object('ok',false,'code','invalid_outcome','retryable',false);end if;
 select * into at from public.telegram_auth_message_attempts where id=p_attempt;
 if not found then return jsonb_build_object('ok',false,'code','attempt_unknown','retryable',false);end if;
 insert into public.delivery_observations(attempt_id,channel,outcome)values(p_attempt,'auth',p_outcome)on conflict(attempt_id)do nothing;
 begin
  perform set_config('lock_timeout','2s',true);
  select * into m from public.telegram_auth_messages where id=at.message_id for update;
  select * into at from public.telegram_auth_message_attempts where id=p_attempt for update;
 exception when lock_not_available then return jsonb_build_object('ok',false,'code','busy','retryable',true);
 end;
 if at.outcome=p_outcome then return jsonb_build_object('ok',true,'result','duplicate');end if;
 if at.outcome is not null or m.state<>'sending'or m.state_seq<>at.state_seq then return jsonb_build_object('ok',true,'result','late');end if;
 update public.telegram_auth_message_attempts set outcome=p_outcome,outcome_at=clock_timestamp()where id=at.id;
 update public.telegram_auth_messages set state=case p_outcome->>'kind'when 'accepted'then 'accepted_by_provider'when 'definitely_failed'then 'definitely_failed'else 'unknown'end,
  state_seq=state_seq+1,updated_at=clock_timestamp()where id=m.id;
 return jsonb_build_object('ok',true,'result','recorded');
end$$;
create function public.telegram_auth_message_queue(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 update public.telegram_auth_messages set state='unknown',state_seq=state_seq+1,updated_at=clock_timestamp()
 where state='sending'and updated_at<clock_timestamp()-interval '2 minutes';
 return coalesce((select jsonb_agg(id)from(select id from public.telegram_auth_messages where state='queued'order by created_at,id limit greatest(1,least(coalesce(p_limit,20),50)))q),'[]');
end$$;

-- 8. Cleanup job runner (durable, retried by the cron sweep) --------------------------------
create function public.auth_cleanup_run()returns jsonb
language plpgsql security definer set search_path=''as $$
declare j public.auth_cleanup_jobs;n integer;total integer:=0;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 for j in select * from public.auth_cleanup_jobs where state='due'and due_at<=clock_timestamp()order by due_at limit 50 for update skip locked loop
  update public.auth_cleanup_jobs set attempts=attempts+1 where id=j.id;
  delete from auth.sessions s where s.user_id=j.auth_user_id and not exists(
   select 1 from public.auth_code_requests r join public.telegram_auth_bindings b on b.id=coalesce(r.binding_id,(select x.id from public.telegram_auth_bindings x where x.auth_user_id=j.auth_user_id and x.active))
   where r.verified_session=s.id and r.state='verified'and r.updated_at>j.revoked_at and b.active and b.created_at>=j.revoked_at-interval '1 second');
  get diagnostics n=row_count;total:=total+n;
  update public.auth_cleanup_jobs set state='done',done_at=clock_timestamp(),deleted_sessions=n where id=j.id;
 end loop;
 return jsonb_build_object('ok',true,'deleted',total);
end$$;

-- 9. Inbox: contact kind and auth start for /start <token> ---------------------------------
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
 or(kind in('start','callback','media')and payload-array['chatId','messageId']<>'{}')
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
  else
   return public._channel_inbox_finish(r.id,'done','ignored_'||r.kind);
  end if;
 exception when others then
  update public.channel_inbox set last_error=sqlstate where id=r.id;
  return jsonb_build_object('ok',false,'code','retry','sqlstate',sqlstate);
 end;
end$$;

create or replace function public.channel_inbox_next(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ids jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 -- Poison rows stop after five leases (G5); text and a shared phone are scrubbed.
 update public.channel_inbox set status='dead',result='max_attempts',processed_at=clock_timestamp(),lease_until=null,payload=payload-'text'-'phone'
 where status='processing'and lease_until<clock_timestamp()and attempts>=5;
 with picked as(select id from public.channel_inbox where status='received'or(status='processing'and lease_until<clock_timestamp())
  order by received_at,id limit greatest(1,least(coalesce(p_limit,10),50))for update skip locked),
 leased as(update public.channel_inbox i set status='processing',attempts=attempts+1,lease_until=clock_timestamp()+interval '60 seconds'
  from picked where i.id=picked.id returning i.id,i.received_at)
 select coalesce(jsonb_agg(id order by received_at,id),'[]')into ids from leased;
 return ids;
end$$;

-- Contact payloads hold a phone; scrub it with the text when done.
create or replace function public._channel_inbox_finish(i uuid,st text,r text)returns jsonb language plpgsql security definer set search_path=''as $$begin
 update public.channel_inbox set status=st,result=r,processed_at=clock_timestamp(),lease_until=null,payload=payload-'text'-'phone'where id=i;
 return jsonb_build_object('ok',true,'status',st,'result',r);
end$$;

-- 10. RLS and grants -------------------------------------------------------------------------
create trigger telegram_auth_audit_immutable before update or delete on public.telegram_auth_audit for each row execute function public._conversation_immutable();
do $$declare n text;f record;begin
 foreach n in array array['telegram_auth_challenges','telegram_contact_requests','telegram_phone_proofs','telegram_auth_bindings','auth_code_requests','auth_cleanup_jobs','telegram_auth_audit','telegram_auth_messages','telegram_auth_message_attempts']loop
  execute format('alter table public.%I enable row level security',n);execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
 end loop;
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public'and(
  p.proname like '\_telegram\_auth%'escape '\'or p.proname like 'telegram\_auth%'escape '\'or p.proname like 'auth\_code\_request%'escape '\'or p.proname like 'auth\_cleanup%'escape '\'
  or p.proname in('_telegram_revoke_binding','_telegram_replies_activate','_auth_phone','_auth_user_for_phone','telegram_link_status'))loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);
 end loop;
end$$;
revoke all on sequence public.telegram_auth_audit_id_seq from public,anon,authenticated,service_role;
grant execute on function public.telegram_auth_unlink(),public.telegram_link_status()to authenticated;
grant execute on function public.telegram_auth_challenge_create(text,text,uuid,text,text,boolean),public.auth_code_request_begin(text,text),public.auth_code_request_claim(text,text,text),
 public.auth_code_request_finish(uuid,text,text,text),public.auth_code_request_status(uuid,text),public.auth_code_request_check(uuid,text,text),public.auth_code_request_abandon(uuid,text),public.auth_code_request_allow_proof(uuid,text),public.auth_code_request_verified(uuid,text,text,uuid,uuid),
 public.telegram_auth_message_claim(uuid,uuid),public.telegram_auth_message_outcome(uuid,jsonb),public.telegram_auth_message_queue(integer),public.auth_cleanup_run()to service_role;
