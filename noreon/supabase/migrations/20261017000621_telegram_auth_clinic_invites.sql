-- T-auth B-2b-2: clinic-portal invitations by Telegram (output/telegram-t1-2026-10-16/TAUTH_B2_PLAN.md
-- §B-2, design v5 §5). A Noreon admin invites a NEW clinic user (no Noreon account yet) with name,
-- email and phone; the admin is shown one link to pass on. The invitee opens it, proves the invited
-- phone in the bot, receives a code there, and sets a password with that code. Only then does the
-- clinic membership exist and the Telegram binding become active. No email is sent. Existing
-- accounts keep the "add existing account" path. Ships dark: needs NOREON_CLINIC_TELEGRAM_INVITES.

-- 1. Invitations ----------------------------------------------------------------------------------
create table public.clinic_portal_invitations(
 id uuid primary key default gen_random_uuid(),
 clinic_id uuid not null references public.workspace_clinics(id),
 email text not null check(email=lower(btrim(email))and length(email)between 3 and 320 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 display_name text not null check(length(btrim(display_name))between 1 and 180),
 invited_phone text not null check(invited_phone ~ '^\+[1-9][0-9]{6,14}$'),
 issuer_id uuid not null references auth.users(id),
 request_id uuid not null unique,
 auth_user_id uuid references auth.users(id)on delete cascade,
 generation bigint not null default 1 check(generation>0),
 status text not null default 'pending'check(status in('pending','verified','accepted','revoked')),
 verified_nonce_hmac text check(verified_nonce_hmac ~ '^[a-f0-9]{64}$'),verified_at timestamptz,verified_binding_id uuid references public.telegram_auth_bindings(id),
 membership_id uuid references public.clinic_portal_memberships(id),accepted_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 check(status not in('verified','accepted')or(verified_at is not null and verified_nonce_hmac is not null and verified_binding_id is not null)),
 check((status='accepted')=(accepted_at is not null and membership_id is not null))
);
create unique index clinic_portal_invitations_open_email on public.clinic_portal_invitations(email)where status in('pending','verified');
create unique index clinic_portal_invitations_user on public.clinic_portal_invitations(auth_user_id)where auth_user_id is not null;
create index clinic_portal_invitations_clinic on public.clinic_portal_invitations(clinic_id,created_at desc);
alter table public.clinic_portal_invitations enable row level security;
revoke all on public.clinic_portal_invitations from public,anon,authenticated,service_role;

-- 2. Bot link, pending binding and codes for clinic invitations ----------------------------------
alter table public.telegram_auth_challenges drop constraint telegram_auth_challenges_purpose_check;
alter table public.telegram_auth_challenges add constraint telegram_auth_challenges_purpose_check check(purpose in('member_signin','member_link','staff_enrol','staff_invite','clinic_invite'));
alter table public.telegram_auth_challenges add column clinic_invitation_id uuid references public.clinic_portal_invitations(id)on delete cascade;
alter table public.telegram_auth_challenges add constraint telegram_auth_challenges_clinic_invite_target check(purpose<>'clinic_invite'or(target_user is not null and clinic_invitation_id is not null and invitation_generation is not null));
alter table public.telegram_auth_bindings add column pending_clinic_invitation_id uuid references public.clinic_portal_invitations(id)on delete set null;
alter table public.staff_code_challenges drop constraint staff_code_challenges_operation_kind_check;
alter table public.staff_code_challenges add constraint staff_code_challenges_operation_kind_check check(operation_kind in('signin','invitation','clinic_invitation'));
alter table public.staff_code_challenges add column clinic_invitation_id uuid references public.clinic_portal_invitations(id)on delete cascade;
alter table public.staff_code_challenges drop constraint staff_code_challenges_kind;
alter table public.staff_code_challenges add constraint staff_code_challenges_kind check(
 (operation_kind='signin'and session_id is not null)or(operation_kind='invitation'and invitation_id is not null and invitation_generation is not null)
 or(operation_kind='clinic_invitation'and clinic_invitation_id is not null and invitation_generation is not null));

create or replace function public._telegram_auth_contact(r public.channel_inbox)returns jsonb
language plpgsql security definer set search_path=''as $$
declare req public.telegram_contact_requests;ch public.telegram_auth_challenges;s public.telegram_channel_settings;sent timestamptz;bound jsonb;loc text;act jsonb;ep public.conversation_endpoints;new_binding uuid;
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
 loc:=case when ch.target_user is null or ch.purpose in('staff_enrol','staff_invite','clinic_invite')then 'hy'else public._telegram_auth_locale(ch.target_user)end;
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
 elsif ch.purpose='staff_invite'then
  -- The invitee proved the invited phone: a pending staff binding for this invitation only.
  -- It becomes active (with the usual conflict rules) when the invitation is accepted.
  if exists(select 1 from public.telegram_auth_bindings where principal_ref=r.principal_ref and active and auth_user_id<>ch.target_user)then
   perform public._telegram_auth_enqueue('telegram.contact_refused',loc,addr,r.principal_ref,'{"kind":"remove"}',r.id);
   return public._channel_inbox_finish(r.id,'done','contact:principal_bound_elsewhere');end if;
  update public.telegram_auth_bindings set revoked_at=clock_timestamp(),revoked_reason='superseded',pending_invitation_id=null
   where pending_invitation_id=ch.invitation_id and not active and revoked_at is null;
  insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation,active,proven_by,pending_invitation_id)
  values(ch.target_user,'staff',r.principal_ref,public._telegram_account_ref(s),phone,addr,
   coalesce((select max(generation)from public.telegram_auth_bindings where auth_user_id=ch.target_user),0)+1,false,ch.id,ch.invitation_id)returning id into new_binding;
  perform public._telegram_auth_audit(ch.target_user,'staff.invite_proven',jsonb_build_object('bindingId',new_binding,'invitationId',ch.invitation_id,'generation',ch.invitation_generation));
 elsif ch.purpose='clinic_invite'then
  -- The clinic invitee proved the invited phone (B-2b-2): a pending staff-kind binding for this
  -- clinic invitation only; it becomes active when the invitation is accepted.
  if exists(select 1 from public.telegram_auth_bindings where principal_ref=r.principal_ref and active and auth_user_id<>ch.target_user)then
   perform public._telegram_auth_enqueue('telegram.contact_refused',loc,addr,r.principal_ref,'{"kind":"remove"}',r.id);
   return public._channel_inbox_finish(r.id,'done','contact:principal_bound_elsewhere');end if;
  update public.telegram_auth_bindings set revoked_at=clock_timestamp(),revoked_reason='superseded',pending_clinic_invitation_id=null
   where pending_clinic_invitation_id=ch.clinic_invitation_id and not active and revoked_at is null;
  insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation,active,proven_by,pending_clinic_invitation_id)
  values(ch.target_user,'staff',r.principal_ref,public._telegram_account_ref(s),phone,addr,
   coalesce((select max(generation)from public.telegram_auth_bindings where auth_user_id=ch.target_user),0)+1,false,ch.id,ch.clinic_invitation_id)returning id into new_binding;
  perform public._telegram_auth_audit(ch.target_user,'clinic.invite_proven',jsonb_build_object('bindingId',new_binding,'invitationId',ch.clinic_invitation_id,'generation',ch.invitation_generation));
 elsif ch.purpose='staff_enrol'then
  bound:=public._telegram_auth_bind(ch.target_user,'staff',r.principal_ref,public._telegram_account_ref(s),phone,addr,ch.id,true);
  if bound->>'ok'<>'true'then
   perform public._telegram_auth_enqueue('telegram.contact_refused',loc,addr,r.principal_ref,'{"kind":"remove"}',r.id);
   return public._channel_inbox_finish(r.id,'done','contact:'||(bound->>'code'));end if;
  perform public._telegram_auth_audit(ch.target_user,'staff.enrolled',jsonb_build_object('bindingId',bound->>'bindingId','issuedBy',ch.issued_by));
 else
  insert into public.telegram_phone_proofs(challenge_id,phone,principal_ref,account_ref,address,nonce_hmac,expires_at)
  values(ch.id,phone,r.principal_ref,public._telegram_account_ref(s),addr,ch.nonce_hmac,clock_timestamp()+interval '10 minutes');
 end if;
 -- Staff enrolment has nothing to continue in the app (finding 5).
 perform public._telegram_auth_enqueue(case when ch.purpose='staff_enrol'then 'telegram.staff_contact_ok'else 'telegram.contact_ok'end,loc,addr,r.principal_ref,'{"kind":"remove"}',r.id);
 return public._channel_inbox_finish(r.id,'done','contact:proven');
end$$;

-- A staff invitation for an email that has an open clinic invitation would collide on the account (review M-3).
create function public._real_staff_invitation_clinic_guard()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if exists(select 1 from public.clinic_portal_invitations where email=new.email and status in('pending','verified'))then
  raise unique_violation using message='Email already has an account or invitation';end if;
 return new;
end$$;
revoke all on function public._real_staff_invitation_clinic_guard()from public,anon,authenticated,service_role;
create trigger real_staff_invitations_clinic_guard before insert on public.real_staff_invitations for each row execute function public._real_staff_invitation_clinic_guard();

-- 3. Admin side (global admin on the staff host; same guard as clinic membership management) ------
create function public._clinic_invitation_json(i public.clinic_portal_invitations)returns jsonb language sql immutable set search_path=''as $$
 select jsonb_build_object('id',i.id,'clinicId',i.clinic_id,'email',i.email,'name',i.display_name,'phone',i.invited_phone,'generation',i.generation,
  'status',case when i.status in('pending','verified')and i.expires_at<=clock_timestamp()then 'expired'else i.status end,'expiresAt',i.expires_at,'createdAt',i.created_at)
$$;
-- Cancels everything a previous generation handed out: bot links, codes and pending bindings.
create function public._clinic_invitation_retire(i public.clinic_portal_invitations)returns void language plpgsql security definer set search_path=''as $$
begin
 update public.telegram_auth_challenges set state='cancelled'where purpose='clinic_invite'and clinic_invitation_id=i.id and state='open';
 update public.staff_code_challenges set state='cancelled'where clinic_invitation_id=i.id and state='open';
 update public.telegram_auth_bindings set revoked_at=clock_timestamp(),revoked_reason='invitation_retired',pending_clinic_invitation_id=null
  where pending_clinic_invitation_id=i.id and not active and revoked_at is null;
 -- A password or session set during an unfinished generation must not survive it (review I-1).
 if i.auth_user_id is not null and i.status<>'accepted'and not exists(select 1 from public.clinic_portal_memberships where user_id=i.auth_user_id)
  and not exists(select 1 from public.workspace_staff where user_id=i.auth_user_id)then
  delete from auth.sessions where user_id=i.auth_user_id;
  update auth.users set encrypted_password=''where id=i.auth_user_id and nullif(encrypted_password,'')is not null;
 end if;
end$$;
create function public.clinic_invitation_reserve(p_request_id uuid,p_clinic_id uuid,p_email text,p_display_name text,p_phone text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a uuid:=public._clinic_portal_admin();e text:=lower(btrim(p_email));n text:=btrim(p_display_name);i public.clinic_portal_invitations;
begin
 if p_request_id is null or p_clinic_id is null or e is null or length(e)not between 3 and 320 or e!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or n is null or length(n)not between 1 and 180 or coalesce(p_phone,'')!~'^\+[1-9][0-9]{6,14}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('clinic-invite-request:'||p_request_id::text,0));
 select * into i from public.clinic_portal_invitations where request_id=p_request_id;
 if found then
  if i.issuer_id<>a or i.clinic_id<>p_clinic_id or i.email<>e or i.display_name<>n or i.invited_phone<>p_phone or i.generation<>1 then return jsonb_build_object('ok',false,'code','conflict');end if;
  return jsonb_build_object('ok',true,'invitation',public._clinic_invitation_json(i));
 end if;
 perform pg_advisory_xact_lock(hashtextextended('real-staff-email:'||e,0));
 perform 1 from public.workspace_clinics where id=p_clinic_id and active for share;
 if not found then return jsonb_build_object('ok',false,'code','clinic_unavailable');end if;
 if exists(select 1 from auth.users where lower(email)=e)or exists(select 1 from public.real_staff_invitations where email=e)
  or exists(select 1 from public.clinic_portal_invitations where email=e and status in('pending','verified'))then
  return jsonb_build_object('ok',false,'code','email_in_use');end if;
 insert into public.clinic_portal_invitations(clinic_id,email,display_name,invited_phone,issuer_id,request_id,expires_at)
 values(p_clinic_id,e,n,p_phone,a,p_request_id,clock_timestamp()+interval '72 hours')returning * into i;
 insert into public.clinic_portal_audit(clinic_id,actor_id,kind,detail)values(i.clinic_id,a,'invitation-reserved',jsonb_build_object('invitationId',i.id));
 return jsonb_build_object('ok',true,'invitation',public._clinic_invitation_json(i));
end$$;
-- A new link (optionally to a corrected phone) for an invitation not yet accepted. Generation fenced.
create function public.clinic_invitation_reissue(p_invitation_id uuid,p_expected_generation bigint,p_phone text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a uuid:=public._clinic_portal_admin();i public.clinic_portal_invitations;
begin
 if coalesce(p_phone,'')!~'^\+[1-9][0-9]{6,14}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into i from public.clinic_portal_invitations where id=p_invitation_id for update;
 if not found then return jsonb_build_object('ok',false,'code','unavailable');end if;
 if i.generation<>p_expected_generation then return jsonb_build_object('ok',false,'code','changed');end if;
 if i.status='accepted'then return jsonb_build_object('ok',false,'code','accepted');end if;
 if i.status='revoked'and(exists(select 1 from public.clinic_portal_invitations o where o.email=i.email and o.id<>i.id and o.status in('pending','verified'))
  or exists(select 1 from public.real_staff_invitations where email=i.email)or(i.auth_user_id is null and exists(select 1 from auth.users where lower(email)=i.email)))then
  return jsonb_build_object('ok',false,'code','email_in_use');end if;
 perform 1 from public.workspace_clinics where id=i.clinic_id and active for share;
 if not found then return jsonb_build_object('ok',false,'code','clinic_unavailable');end if;
 perform public._clinic_invitation_retire(i);
 update public.clinic_portal_invitations set generation=generation+1,status='pending',verified_at=null,verified_nonce_hmac=null,verified_binding_id=null,invited_phone=p_phone,
  issuer_id=a,expires_at=clock_timestamp()+interval '72 hours'where id=i.id returning * into i;
 insert into public.clinic_portal_audit(clinic_id,actor_id,kind,detail)values(i.clinic_id,a,'invitation-reissued',jsonb_build_object('invitationId',i.id,'generation',i.generation));
 return jsonb_build_object('ok',true,'invitation',public._clinic_invitation_json(i));
end$$;
create function public.clinic_invitation_revoke(p_invitation_id uuid,p_expected_generation bigint)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a uuid:=public._clinic_portal_admin();i public.clinic_portal_invitations;
begin
 select * into i from public.clinic_portal_invitations where id=p_invitation_id for update;
 if not found then return jsonb_build_object('ok',false,'code','unavailable');end if;
 if i.generation<>p_expected_generation then return jsonb_build_object('ok',false,'code','changed');end if;
 if i.status='accepted'then return jsonb_build_object('ok',false,'code','accepted');end if;
 perform public._clinic_invitation_retire(i);
 update public.clinic_portal_invitations set status='revoked',verified_at=null,verified_nonce_hmac=null,verified_binding_id=null where id=i.id returning * into i;
 insert into public.clinic_portal_audit(clinic_id,actor_id,kind,detail)values(i.clinic_id,a,'invitation-revoked',jsonb_build_object('invitationId',i.id,'generation',i.generation));
 return jsonb_build_object('ok',true,'invitation',public._clinic_invitation_json(i));
end$$;
-- Invitations not yet accepted, newest first (accepted ones appear as memberships).
create function public.clinic_invitations_list(p_clinic_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform public._clinic_portal_admin();
 return coalesce((select jsonb_agg(public._clinic_invitation_json(i)order by i.created_at desc)from(select * from public.clinic_portal_invitations
  where clinic_id=p_clinic_id and status<>'accepted'order by created_at desc limit 50)i),'[]'::jsonb);
end$$;

-- 4. Service side: the reserved account and its bot link ------------------------------------------
-- The app creates the Auth account (confirmed email, no password) and binds it here exactly once.
create function public.clinic_invitation_telegram_issue(p_invitation_id uuid,p_generation bigint,p_auth_user_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare i public.clinic_portal_invitations;u auth.users;raw text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not exists(select 1 from public.telegram_channel_settings where singleton)then return jsonb_build_object('ok',false,'code','unavailable');end if;
 select * into i from public.clinic_portal_invitations where id=p_invitation_id;
 if not found then return jsonb_build_object('ok',false,'code','invitation_changed');end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-phone:'||i.invited_phone,0));
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-user:'||p_auth_user_id::text,0));
 select * into i from public.clinic_portal_invitations where id=p_invitation_id for update;
 if i.generation<>p_generation or i.status<>'pending'or i.expires_at<=clock_timestamp()then return jsonb_build_object('ok',false,'code','invitation_changed');end if;
 if i.auth_user_id is null then
  -- Only a brand-new account for exactly this email, with no password and no other Noreon role.
  select * into u from auth.users where id=p_auth_user_id for share;
  if u.id is null or lower(u.email)is distinct from i.email or u.email_confirmed_at is null or u.created_at<i.created_at or nullif(u.encrypted_password,'')is not null
   or exists(select 1 from public.clinic_portal_memberships where user_id=u.id)or exists(select 1 from public.workspace_staff where user_id=u.id)
   or exists(select 1 from public.telegram_auth_bindings where auth_user_id=u.id and revoked_at is null)then
   return jsonb_build_object('ok',false,'code','account_unavailable');end if;
  update public.clinic_portal_invitations set auth_user_id=u.id where id=i.id returning * into i;
 elsif i.auth_user_id<>p_auth_user_id then return jsonb_build_object('ok',false,'code','account_unavailable');
 end if;
 update public.telegram_auth_challenges set state='cancelled'where purpose='clinic_invite'and clinic_invitation_id=i.id and state='open';
 raw:=translate(encode(extensions.gen_random_bytes(24),'base64'),'+/','-_');
 insert into public.telegram_auth_challenges(token_hash,purpose,target_phone,target_user,issued_by,clinic_invitation_id,invitation_generation,expires_at)
 values(encode(sha256(convert_to(raw,'UTF8')),'hex'),'clinic_invite',i.invited_phone,i.auth_user_id,i.issuer_id,i.id,i.generation,i.expires_at);
 perform public._telegram_auth_audit(i.auth_user_id,'clinic.invite_issued',jsonb_build_object('invitationId',i.id,'generation',i.generation,'issuer',i.issuer_id));
 return jsonb_build_object('ok',true,'token',raw,'expiresAt',i.expires_at);
end$$;
-- Existing account for this invitation's email, for retries after the account was created.
create function public.clinic_invitation_account(p_invitation_id uuid,p_generation bigint)returns jsonb
language plpgsql security definer set search_path=''as $$
declare i public.clinic_portal_invitations;u uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into i from public.clinic_portal_invitations where id=p_invitation_id and generation=p_generation and status='pending';
 if not found then return jsonb_build_object('ok',false,'code','invitation_changed');end if;
 select id into u from auth.users where lower(email)=i.email;
 return jsonb_build_object('ok',true,'email',i.email,'authUserId',coalesce(i.auth_user_id,u));
end$$;

-- 5. Invitee side: code to the proven chat, then password set by the app, then finalize -----------
create function public._clinic_invite_binding(i public.clinic_portal_invitations)returns public.telegram_auth_bindings language sql stable security definer set search_path=''as $$
 select b.* from public.telegram_auth_bindings b join public.telegram_auth_challenges c on c.id=b.proven_by
 where b.auth_user_id=i.auth_user_id and b.kind='staff'and not b.active and b.revoked_at is null and b.pending_clinic_invitation_id=i.id
  and c.purpose='clinic_invite'and c.clinic_invitation_id=i.id and c.invitation_generation=i.generation
$$;
create function public._clinic_invite_open(p_invitation_id uuid,p_generation bigint)returns public.clinic_portal_invitations language sql stable security definer set search_path=''as $$
 select i.* from public.clinic_portal_invitations i where i.id=p_invitation_id and i.generation=p_generation and i.status in('pending','verified')
  and i.auth_user_id is not null and i.expires_at>clock_timestamp()and exists(select 1 from public.workspace_clinics c where c.id=i.clinic_id and c.active)
  and exists(select 1 from public.workspace_staff s where s.user_id=i.issuer_id and s.role='admin'and s.active and s.removed_at is null)
$$;
create function public.clinic_invite_code_begin(p_invitation_id uuid,p_generation bigint,p_start_token_hash text,p_nonce_hmac text,p_code_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare i public.clinic_portal_invitations;b public.telegram_auth_bindings;new_id uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_nonce_hmac,'')!~'^[a-f0-9]{64}$'or coalesce(p_code_hmac,'')!~'^[a-f0-9]{64}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 i:=public._clinic_invite_open(p_invitation_id,p_generation);
 if i.id is null then return jsonb_build_object('ok',false,'code','invitation_unavailable');end if;
 -- Only the holder of this generation's link (its bot start token) may ask for codes.
 if not exists(select 1 from public.telegram_auth_challenges where purpose='clinic_invite'and clinic_invitation_id=i.id and invitation_generation=i.generation and token_hash=p_start_token_hash)then
  return jsonb_build_object('ok',false,'code','invitation_unavailable');end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-user:'||i.auth_user_id::text,0));
 b:=public._clinic_invite_binding(i);
 if b.id is null then return jsonb_build_object('ok',false,'code','not_proven');end if;
 if(select coalesce(sum(attempts),0)from public.staff_code_challenges where auth_user_id=i.auth_user_id and created_at>clock_timestamp()-interval '24 hours')>=10
  or(select count(*)from public.staff_code_challenges where auth_user_id=i.auth_user_id and created_at>clock_timestamp()-interval '15 minutes')>=5 then
  return jsonb_build_object('ok',false,'code','rate_limited');end if;
 update public.staff_code_challenges set state='cancelled'where clinic_invitation_id=i.id and state='open';
 insert into public.staff_code_challenges(auth_user_id,operation_kind,clinic_invitation_id,invitation_generation,binding_id,binding_generation,nonce_hmac,code_hmac,expires_at)
 values(i.auth_user_id,'clinic_invitation',i.id,i.generation,b.id,b.generation,p_nonce_hmac,p_code_hmac,clock_timestamp()+interval '5 minutes')returning staff_code_challenges.id into new_id;
 return jsonb_build_object('ok',true,'challengeId',new_id,'address',b.address);
end$$;
-- A correct code marks the invitation verified for this browser's nonce for 10 minutes: the app
-- may then set the password and finalize. The account has no password before this point.
create function public.clinic_invite_code_verify(p_challenge uuid,p_invitation_id uuid,p_generation bigint,p_nonce_hmac text,p_code_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare c public.staff_code_challenges;i public.clinic_portal_invitations;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into c from public.staff_code_challenges where id=p_challenge for update;
 if not found or c.operation_kind<>'clinic_invitation'or c.clinic_invitation_id is distinct from p_invitation_id or c.invitation_generation is distinct from p_generation or c.nonce_hmac is distinct from p_nonce_hmac then
  return jsonb_build_object('ok',false,'code','unknown_challenge');end if;
 if c.state<>'open'or c.expires_at<=clock_timestamp()then return jsonb_build_object('ok',false,'code','expired');end if;
 if c.code_hmac is distinct from p_code_hmac then
  update public.staff_code_challenges set attempts=attempts+1,state=case when attempts+1>=5 then 'exhausted'else state end where id=c.id;
  return jsonb_build_object('ok',false,'code',case when c.attempts+1>=5 then 'too_many_attempts'else 'wrong_code'end);end if;
 select * into i from public.clinic_portal_invitations where id=c.clinic_invitation_id for update;
 if i.id is null or i.generation<>c.invitation_generation or i.status not in('pending','verified')or i.expires_at<=clock_timestamp()then
  return jsonb_build_object('ok',false,'code','invitation_unavailable');end if;
 if(public._clinic_invite_binding(i)).id is distinct from c.binding_id then return jsonb_build_object('ok',false,'code','expired');end if;
 update public.staff_code_challenges set state='used'where id=c.id;
 update public.clinic_portal_invitations set status='verified',verified_at=clock_timestamp(),verified_nonce_hmac=p_nonce_hmac,verified_binding_id=c.binding_id where id=i.id;
 perform public._telegram_auth_audit(i.auth_user_id,'clinic.invite_verified',jsonb_build_object('invitationId',i.id,'generation',i.generation));
 return jsonb_build_object('ok',true,'authUserId',i.auth_user_id);
end$$;
-- After the app set the password: membership created, pending binding activated (B-2a rules).
create function public.clinic_invitation_finalize(p_invitation_id uuid,p_generation bigint,p_nonce_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare i public.clinic_portal_invitations;b public.telegram_auth_bindings;other public.telegram_auth_bindings;m public.clinic_portal_memberships;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into i from public.clinic_portal_invitations where id=p_invitation_id;
 if not found or i.generation<>p_generation then return jsonb_build_object('ok',false,'code','invitation_unavailable');end if;
 if i.status='accepted'then
  return case when i.verified_nonce_hmac=p_nonce_hmac then jsonb_build_object('ok',true,'membershipId',i.membership_id)else jsonb_build_object('ok',false,'code','invitation_unavailable')end;end if;
 if i.status<>'verified'or i.verified_nonce_hmac is distinct from p_nonce_hmac or i.verified_at<=clock_timestamp()-interval '10 minutes'or i.expires_at<=clock_timestamp()then
  return jsonb_build_object('ok',false,'code','verification_expired');end if;
 if(public._clinic_invite_open(i.id,i.generation)).id is null then return jsonb_build_object('ok',false,'code','invitation_unavailable');end if;
 b:=public._clinic_invite_binding(i);
 if b.id is null or b.id is distinct from i.verified_binding_id then return jsonb_build_object('ok',false,'code','binding_changed');end if;
 -- Lock order (§2): phone, principal, user; then rows.
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-phone:'||b.phone,0));
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-principal:'||b.principal_ref,0));
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-user:'||i.auth_user_id::text,0));
 select * into i from public.clinic_portal_invitations where id=p_invitation_id for update;
 if i.generation<>p_generation or i.status<>'verified'or i.verified_nonce_hmac is distinct from p_nonce_hmac then return jsonb_build_object('ok',false,'code','invitation_unavailable');end if;
 select * into b from public.telegram_auth_bindings where id=b.id and revoked_at is null and not active and pending_clinic_invitation_id=i.id for update;
 if not found then return jsonb_build_object('ok',false,'code','binding_changed');end if;
 perform 1 from public.workspace_clinics where id=i.clinic_id and active for share;
 if not found then return jsonb_build_object('ok',false,'code','clinic_unavailable');end if;
 perform 1 from auth.users where id=i.auth_user_id and lower(email)=i.email and email_confirmed_at is not null and nullif(encrypted_password,'')is not null
  and(banned_until is null or banned_until<=clock_timestamp())for share;
 if not found then return jsonb_build_object('ok',false,'code','password_required');end if;
 if exists(select 1 from public.telegram_auth_bindings where principal_ref=b.principal_ref and active and auth_user_id<>i.auth_user_id)
  or exists(select 1 from public.telegram_auth_bindings where auth_user_id=i.auth_user_id and active)then
  perform public._telegram_auth_audit(i.auth_user_id,'clinic.invite_conflict',jsonb_build_object('invitationId',i.id,'bindingId',b.id));
  return jsonb_build_object('ok',false,'code','telegram_in_use');end if;
 if exists(select 1 from public.clinic_portal_memberships where user_id=i.auth_user_id and clinic_id=i.clinic_id)then
  return jsonb_build_object('ok',false,'code','membership_exists');end if;
 for other in select * from public.telegram_auth_bindings where kind='staff'and phone=b.phone and active and auth_user_id<>i.auth_user_id for update loop
  perform public._telegram_revoke_binding(other.id,'phone_moved');
 end loop;
 -- The invitee signs in only after this; any earlier session on the account is not theirs (review I-1).
 delete from auth.sessions where user_id=i.auth_user_id;
 update public.telegram_auth_bindings set active=true,pending_clinic_invitation_id=null,proven_at=clock_timestamp()where id=b.id;
 perform public._telegram_auth_audit(i.auth_user_id,'binding.created',jsonb_build_object('bindingId',b.id,'generation',b.generation,'clinicInvitationId',i.id));
 insert into public.clinic_portal_memberships(user_id,clinic_id,display_name)values(i.auth_user_id,i.clinic_id,i.display_name)returning * into m;
 update public.clinic_portal_invitations set status='accepted',accepted_at=clock_timestamp(),membership_id=m.id where id=i.id;
 insert into public.clinic_portal_audit(clinic_id,actor_id,kind,detail)values(i.clinic_id,i.auth_user_id,'invitation-accepted',jsonb_build_object('invitationId',i.id,'membershipId',m.id,'generation',i.generation));
 return jsonb_build_object('ok',true,'membershipId',m.id);
end$$;

-- 6. Grants -----------------------------------------------------------------------------------------
revoke all on function public._clinic_invitation_json(public.clinic_portal_invitations),public._clinic_invitation_retire(public.clinic_portal_invitations),
 public.clinic_invitation_reserve(uuid,uuid,text,text,text),public.clinic_invitation_reissue(uuid,bigint,text),public.clinic_invitation_revoke(uuid,bigint),
 public.clinic_invitations_list(uuid),public.clinic_invitation_telegram_issue(uuid,bigint,uuid),public.clinic_invitation_account(uuid,bigint),
 public._clinic_invite_binding(public.clinic_portal_invitations),public._clinic_invite_open(uuid,bigint),
 public.clinic_invite_code_begin(uuid,bigint,text,text,text),public.clinic_invite_code_verify(uuid,uuid,bigint,text,text),
 public.clinic_invitation_finalize(uuid,bigint,text)from public,anon,authenticated,service_role;
grant execute on function public.clinic_invitation_reserve(uuid,uuid,text,text,text),public.clinic_invitation_reissue(uuid,bigint,text),
 public.clinic_invitation_revoke(uuid,bigint),public.clinic_invitations_list(uuid)to authenticated;
grant execute on function public.clinic_invitation_telegram_issue(uuid,bigint,uuid),public.clinic_invitation_account(uuid,bigint),
 public.clinic_invite_code_begin(uuid,bigint,text,text,text),public.clinic_invite_code_verify(uuid,uuid,bigint,text,text),
 public.clinic_invitation_finalize(uuid,bigint,text)to service_role;
