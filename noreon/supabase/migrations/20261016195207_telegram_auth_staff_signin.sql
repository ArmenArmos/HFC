-- T-auth part B, slice B-1 (output/telegram-t1-2026-10-16/TAUTH_PART_B_PLAN.md; design v5 §5):
-- staff Telegram enrolment and the sign-in second step. Staff and clinic users still sign
-- in with email and password; when staff Telegram sign-in is required, a session also needs
-- a code from the bot to the account's own Telegram (admission) before any staff or clinic
-- RPC accepts it. Ships dark: no staff_telegram_policy row means not required, and
-- nothing changes for existing sign-in.

-- 1. Policy (no row = off) ---------------------------------------------------------------
create table public.staff_telegram_policy(singleton boolean primary key default true check(singleton),signin_required boolean not null default false,updated_at timestamptz not null default clock_timestamp());

-- 2. Enrolment reuses the contact-proof challenge with a staff purpose -------------------
alter table public.telegram_auth_challenges drop constraint telegram_auth_challenges_purpose_check;
alter table public.telegram_auth_challenges add constraint telegram_auth_challenges_purpose_check check(purpose in('member_signin','member_link','staff_enrol'));
alter table public.telegram_auth_challenges add column issued_by uuid references auth.users(id)on delete set null;
alter table public.telegram_auth_challenges add constraint telegram_auth_challenges_staff_target check(purpose<>'staff_enrol'or target_user is not null);

-- 3. Sign-in codes and admissions ------------------------------------------------------------
create table public.staff_code_challenges(
 id uuid primary key default gen_random_uuid(),auth_user_id uuid not null references auth.users(id)on delete cascade,session_id uuid not null,
 binding_id uuid not null references public.telegram_auth_bindings(id),binding_generation bigint not null,
 nonce_hmac text not null check(nonce_hmac ~ '^[a-f0-9]{64}$'),code_hmac text not null check(code_hmac ~ '^[a-f0-9]{64}$'),
 attempts integer not null default 0,state text not null default 'open'check(state in('open','used','exhausted','cancelled')),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null
);
create index staff_code_challenges_user on public.staff_code_challenges(auth_user_id,created_at);
create table public.auth_admissions(
 id uuid primary key default gen_random_uuid(),operation_kind text not null check(operation_kind in('signin')),operation_id uuid not null,
 auth_user_id uuid not null references auth.users(id)on delete cascade,binding_id uuid not null references public.telegram_auth_bindings(id),binding_generation bigint not null,
 session_id uuid not null,state text not null check(state in('admitted','rejected')),created_at timestamptz not null default clock_timestamp()
);
create unique index auth_admissions_session on public.auth_admissions(session_id)where state='admitted';

-- 4. Helpers -----------------------------------------------------------------------------------
create function public._staff_signin_required()returns boolean language sql stable security definer set search_path=''as $$
 select coalesce((select signin_required from public.staff_telegram_policy where singleton),false)
$$;
-- True when Telegram sign-in is not required; otherwise only for a session admitted through
-- the account's still-active staff binding at the same generation (revocation stops it).
create function public._staff_session_admitted(a uuid,s uuid)returns boolean language sql stable security definer set search_path=''as $$
 select not public._staff_signin_required()or exists(select 1 from public.auth_admissions x join public.telegram_auth_bindings b on b.id=x.binding_id
  where x.session_id=s and x.auth_user_id=a and x.state='admitted'and b.active and b.kind='staff'and b.generation=x.binding_generation)
$$;
-- Sign-in precondition (§5): an active membership (staff in an active clinic, admin, or clinic portal).
create function public._staff_signin_eligible(u uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.workspace_staff s where s.user_id=u and s.active and s.removed_at is null
  and(s.role='admin'or exists(select 1 from public.workspace_clinics c where c.id=s.clinic_id and c.active)))
 or exists(select 1 from public.clinic_portal_memberships m join public.workspace_clinics c on c.id=m.clinic_id and c.active where m.user_id=u and m.active)
$$;
create function public._staff_account_exists(u uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.workspace_staff where user_id=u and removed_at is null)or exists(select 1 from public.clinic_portal_memberships where user_id=u)
$$;

create or replace function public._telegram_auth_bind(p_user uuid,p_kind text,p_principal text,p_account text,p_phone text,p_address text,p_proven_by uuid,p_allow_replace boolean default true)returns jsonb
language plpgsql security definer set search_path=''as $$
declare cur public.telegram_auth_bindings;other public.telegram_auth_bindings;g bigint;nb public.telegram_auth_bindings;
begin
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-phone:'||p_phone,0));
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-principal:'||p_principal,0));
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-user:'||p_user::text,0));
 -- Members prove their Auth phone; staff prove the phone the admin recorded on the enrolment.
 if p_kind='member'and public._auth_phone(p_user)is distinct from p_phone then return jsonb_build_object('ok',false,'code','phone_mismatch');end if;
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

create or replace function public._telegram_auth_contact(r public.channel_inbox)returns jsonb
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
 loc:=case when ch.target_user is null or ch.purpose='staff_enrol'then 'hy'else public._telegram_auth_locale(ch.target_user)end;
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
 perform public._telegram_auth_enqueue('telegram.contact_ok',loc,addr,r.principal_ref,'{"kind":"remove"}',r.id);
 return public._channel_inbox_finish(r.id,'done','contact:proven');
end$$;

-- 5. Admin: enrol, status, revoke ----------------------------------------------------------------
create function public.staff_telegram_enrolment_issue(p_staff uuid,p_phone text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor uuid;raw text;exp timestamptz;
begin
 actor:=public._real_staff_require_admin();
 if not exists(select 1 from public.telegram_channel_settings where singleton)then return jsonb_build_object('ok',false,'code','unavailable');end if;
 if p_staff is null or not public._staff_account_exists(p_staff)then return jsonb_build_object('ok',false,'code','not_staff');end if;
 if coalesce(p_phone,'')!~'^\+[1-9][0-9]{6,14}$'then return jsonb_build_object('ok',false,'code','invalid_phone');end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-phone:'||p_phone,0));
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-user:'||p_staff::text,0));
 if(select count(*)from public.telegram_auth_challenges where purpose='staff_enrol'and target_user=p_staff and created_at>clock_timestamp()-interval '1 hour')>=10 then
  return jsonb_build_object('ok',false,'code','rate_limited');end if;
 -- Reissue invalidates earlier links for this account.
 update public.telegram_auth_challenges set state='cancelled'where purpose='staff_enrol'and target_user=p_staff and state='open';
 raw:=translate(encode(extensions.gen_random_bytes(24),'base64'),'+/','-_');exp:=clock_timestamp()+interval '72 hours';
 insert into public.telegram_auth_challenges(token_hash,purpose,target_phone,target_user,issued_by,expires_at)
 values(encode(sha256(convert_to(raw,'UTF8')),'hex'),'staff_enrol',p_phone,p_staff,actor,exp);
 perform public._telegram_auth_audit(p_staff,'staff.enrolment_issued',jsonb_build_object('issuedBy',actor,'expiresAt',exp));
 return jsonb_build_object('ok',true,'token',raw,'expiresAt',exp);
end$$;
create function public.staff_telegram_status(p_staff uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare b public.telegram_auth_bindings;
begin
 perform public._real_staff_require_admin();
 select * into b from public.telegram_auth_bindings where auth_user_id=p_staff and kind='staff'and active;
 return jsonb_build_object('ok',true,'enrolled',found,'provenAt',b.proven_at,
  'pendingLink',exists(select 1 from public.telegram_auth_challenges where purpose='staff_enrol'and target_user=p_staff and state='open'and expires_at>clock_timestamp()));
end$$;
-- Compromised account: binding revoked, sessions and codes cancelled; membership unchanged.
create function public.staff_telegram_revoke(p_staff uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor uuid;b public.telegram_auth_bindings;res jsonb;ph text;n integer;
begin
 actor:=public._real_staff_require_admin();
 if p_staff=actor then return jsonb_build_object('ok',false,'code','not_self');end if;
 if p_staff is null or not public._staff_account_exists(p_staff)then return jsonb_build_object('ok',false,'code','not_staff');end if;
 -- Lock order (§2): every phone involved (sorted), then the user, then rows.
 for ph in select distinct x from(select phone x from public.telegram_auth_bindings where auth_user_id=p_staff and active
  union select target_phone from public.telegram_auth_challenges where purpose='staff_enrol'and target_user=p_staff and state='open')q order by x loop
  perform pg_advisory_xact_lock(hashtextextended('tg-auth-phone:'||ph,0));
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-user:'||p_staff::text,0));
 update public.telegram_auth_challenges set state='cancelled'where purpose='staff_enrol'and target_user=p_staff and state='open';
 update public.staff_code_challenges set state='cancelled'where auth_user_id=p_staff and state='open';
 select * into b from public.telegram_auth_bindings where auth_user_id=p_staff and kind='staff'and active;
 if not found then
  delete from auth.sessions where user_id=p_staff;get diagnostics n=row_count;
  perform public._telegram_auth_audit(p_staff,'staff.revoked',jsonb_build_object('by',actor,'binding',false,'sessions',n));
  return jsonb_build_object('ok',true,'revoked',false);end if;
 res:=public._telegram_revoke_binding(b.id,'admin_revoked');
 perform public._telegram_auth_audit(p_staff,'staff.revoked',jsonb_build_object('by',actor));
 return res;
end$$;

-- 6. Sign-in second step (service role; the server validated the session first) ----------------
create function public.staff_signin_code_begin(p_user uuid,p_session uuid,p_nonce_hmac text,p_code_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare b public.telegram_auth_bindings;new_id uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_user is null or p_session is null or coalesce(p_nonce_hmac,'')!~'^[a-f0-9]{64}$'or coalesce(p_code_hmac,'')!~'^[a-f0-9]{64}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-user:'||p_user::text,0));
 if not exists(select 1 from auth.sessions where id=p_session and user_id=p_user and(not_after is null or not_after>clock_timestamp()))
  or not public._staff_signin_eligible(p_user)then return jsonb_build_object('ok',false,'code','no_session');end if;
 -- Long-window ceiling: 10 wrong codes per account per 24 hours stop new codes (§ review B-1 #3).
 if(select coalesce(sum(attempts),0)from public.staff_code_challenges where auth_user_id=p_user and created_at>clock_timestamp()-interval '24 hours')>=10 then
  perform public._telegram_auth_audit(p_user,'staff.code_ceiling',jsonb_build_object('sessionId',p_session));
  return jsonb_build_object('ok',false,'code','too_many_attempts');end if;
 select * into b from public.telegram_auth_bindings where auth_user_id=p_user and kind='staff'and active;
 if not found then return jsonb_build_object('ok',false,'code','not_enrolled');end if;
 if(select count(*)from public.staff_code_challenges where auth_user_id=p_user and created_at>clock_timestamp()-interval '15 minutes')>=5 then
  return jsonb_build_object('ok',false,'code','rate_limited');end if;
 update public.staff_code_challenges set state='cancelled'where auth_user_id=p_user and session_id=p_session and state='open';
 insert into public.staff_code_challenges(auth_user_id,session_id,binding_id,binding_generation,nonce_hmac,code_hmac,expires_at)
 values(p_user,p_session,b.id,b.generation,p_nonce_hmac,p_code_hmac,clock_timestamp()+interval '5 minutes')returning staff_code_challenges.id into new_id;
 return jsonb_build_object('ok',true,'challengeId',new_id,'address',b.address);
end$$;
create function public.staff_signin_code_verify(p_challenge uuid,p_user uuid,p_session uuid,p_nonce_hmac text,p_code_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare c public.staff_code_challenges;b public.telegram_auth_bindings;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into c from public.staff_code_challenges where id=p_challenge for update;
 if not found or c.auth_user_id is distinct from p_user or c.session_id is distinct from p_session or c.nonce_hmac is distinct from p_nonce_hmac then
  return jsonb_build_object('ok',false,'code','unknown_challenge');end if;
 if exists(select 1 from public.auth_admissions where session_id=p_session and state='admitted'and auth_user_id=p_user and binding_id=c.binding_id)
  and c.state='used'then return jsonb_build_object('ok',true,'result','admitted');end if;
 if c.state<>'open'or c.expires_at<=clock_timestamp()then return jsonb_build_object('ok',false,'code','expired');end if;
 if c.code_hmac is distinct from p_code_hmac then
  update public.staff_code_challenges set attempts=attempts+1,state=case when attempts+1>=5 then 'exhausted'else state end where id=c.id;
  return jsonb_build_object('ok',false,'code',case when c.attempts+1>=5 then 'too_many_attempts'else 'wrong_code'end);end if;
 select * into b from public.telegram_auth_bindings where id=c.binding_id and active and generation=c.binding_generation for share;
 if not found or not exists(select 1 from auth.sessions where id=p_session and user_id=p_user and(not_after is null or not_after>clock_timestamp()))then
  update public.staff_code_challenges set state='cancelled'where id=c.id;
  insert into public.auth_admissions(operation_kind,operation_id,auth_user_id,binding_id,binding_generation,session_id,state)values('signin',c.id,p_user,c.binding_id,c.binding_generation,p_session,'rejected');
  delete from auth.sessions where id=p_session and user_id=p_user;
  return jsonb_build_object('ok',false,'code','rejected');end if;
 update public.staff_code_challenges set state='used'where id=c.id;
 insert into public.auth_admissions(operation_kind,operation_id,auth_user_id,binding_id,binding_generation,session_id,state)
 values('signin',c.id,p_user,b.id,b.generation,p_session,'admitted')on conflict(session_id)where state='admitted'do nothing;
 perform public._telegram_auth_audit(p_user,'staff.admitted',jsonb_build_object('sessionId',p_session,'bindingId',b.id));
 return jsonb_build_object('ok',true,'result','admitted');
end$$;
-- What the signed-in staff browser needs to know (no code, no address).
create function public.staff_signin_state()returns jsonb
language plpgsql security definer set search_path=''as $$
declare u uuid:=auth.uid();sid uuid;
begin
 if auth.role()is distinct from 'authenticated'or u is null then raise insufficient_privilege;end if;
 sid:=(auth.jwt()->>'session_id')::uuid;
 return jsonb_build_object('ok',true,'required',public._staff_signin_required(),'admitted',public._staff_session_admitted(u,sid)and public._staff_signin_required(),
  'enrolled',exists(select 1 from public.telegram_auth_bindings where auth_user_id=u and kind='staff'and active),'eligible',public._staff_signin_eligible(u));
exception when invalid_text_representation then raise insufficient_privilege;
end$$;

-- 7. Guards: staff RPCs and the clinic portal require admission when the policy is on ----------
create or replace function public._real_staff_managed_session_allowed(p_actor uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare i public.real_staff_invitations;sid text;created timestamptz;has_invitation boolean;
begin
 -- Service callers must validate the end-user token before dispatch; their JWT is not the actor's.
 if auth.role()='service_role' then return true;end if;
 if auth.uid() is distinct from p_actor then return false;end if;
 sid:=auth.jwt()->>'session_id';if sid is null then return false;end if;
 select created_at into created from auth.sessions where id::text=sid and user_id=p_actor and (not_after is null or not_after>now());
 if not found then return false;end if;
 -- T-auth B-1: when staff Telegram sign-in is required, only admitted sessions pass.
 if not public._staff_session_admitted(p_actor,sid::uuid)then return false;end if;
 select * into i from public.real_staff_invitations where auth_user_id=p_actor;has_invitation:=found;
 if has_invitation then
  if i.status<>'accepted' or i.accepted_at is null then return false;end if;
  if sid=i.accepted_session_id::text then return true;end if;
  if created<i.accepted_at then return false;end if;
 end if;
 return public._real_staff_amr_allowed(auth.jwt()->'amr');
end $$;

create or replace function public._clinic_portal_live(c uuid,a uuid,s uuid,amr jsonb,expires timestamptz,mid uuid default null,mrev bigint default null)returns public.clinic_portal_memberships
language plpgsql security definer set search_path=''as $$declare m public.clinic_portal_memberships;begin
 if c is null or a is null or s is null or expires is null or expires<=clock_timestamp()or not public._real_staff_amr_allowed(amr)then raise insufficient_privilege;end if;
 perform 1 from auth.users where id=a and(banned_until is null or banned_until<=clock_timestamp())for share nowait;if not found then raise insufficient_privilege;end if;
 perform 1 from auth.sessions where id=s and user_id=a and(not_after is null or not_after>clock_timestamp())for share nowait;if not found then raise insufficient_privilege;end if;
 if not public._staff_session_admitted(a,s)then raise insufficient_privilege;end if;
 perform 1 from public.workspace_clinics where id=c and active for share nowait;if not found then raise insufficient_privilege;end if;
 select * into m from public.clinic_portal_memberships where user_id=a and clinic_id=c for share nowait;
 if not found or not m.active or(mid is not null and(m.id<>mid or m.revision<>mrev))or expires<=clock_timestamp()then raise insufficient_privilege;end if;
 return m;
end$$;

-- 7b. Cleanup sweeps spare a session admitted through a binding created after the revocation
-- (design §13.3), so revoke → re-enrol → sign-in within the sweep window keeps working.
create or replace function public.auth_cleanup_run()returns jsonb
language plpgsql security definer set search_path=''as $$
declare j public.auth_cleanup_jobs;n integer;total integer:=0;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 for j in select * from public.auth_cleanup_jobs where state='due'and due_at<=clock_timestamp()order by due_at limit 50 for update skip locked loop
  update public.auth_cleanup_jobs set attempts=attempts+1 where id=j.id;
  delete from auth.sessions s where s.user_id=j.auth_user_id and not exists(
   select 1 from public.auth_code_requests r join public.telegram_auth_bindings b on b.id=coalesce(r.binding_id,(select x.id from public.telegram_auth_bindings x where x.auth_user_id=j.auth_user_id and x.active))
   where r.verified_session=s.id and r.state='verified'and r.updated_at>j.revoked_at and b.active and b.created_at>=j.revoked_at-interval '1 second')
  and not exists(
   select 1 from public.auth_admissions a join public.telegram_auth_bindings b on b.id=a.binding_id
   where a.session_id=s.id and a.auth_user_id=j.auth_user_id and a.state='admitted'and a.created_at>j.revoked_at and b.active and b.generation=a.binding_generation
    and b.created_at>=j.revoked_at-interval '1 second');
  get diagnostics n=row_count;total:=total+n;
  update public.auth_cleanup_jobs set state='done',done_at=clock_timestamp(),deleted_sessions=n where id=j.id;
 end loop;
 return jsonb_build_object('ok',true,'deleted',total);
end$$;

-- 7c. Two older admin RPCs checked only the admin role; they now require the managed admin
-- session (AMR, accepted session, removal, and Telegram admission when required).
create or replace function public.assign_patient_clinical_case(p_user_id uuid,p_expected_revision bigint,p_doctor_id uuid default null) returns bigint
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;n bigint;
begin
 perform public._real_staff_require_admin();
 select * into c from public.patient_clinical_cases where user_id=p_user_id for update;
 if not found then raise insufficient_privilege using message='Case unavailable';end if;
 if c.revision is distinct from p_expected_revision then raise serialization_failure using message='Case changed. Reload before assigning';end if;
 if p_doctor_id is not null then
  perform 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id where s.user_id=p_doctor_id and s.role='doctor' and s.active and k.active for share of s,k;
  if not found then raise insufficient_privilege using message='Choose an active doctor in an active clinic';end if;
 end if;
 if c.assigned_doctor_id is not distinct from p_doctor_id then return c.revision;end if;
 update public.patient_clinical_cases set assigned_doctor_id=p_doctor_id,revision=revision+1,updated_at=now() where user_id=p_user_id returning revision into n;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(p_user_id,n,'assigned',auth.uid(),jsonb_build_object('doctorId',p_doctor_id));
 return n;
end $$;
create or replace function public.assign_patient_case_nurse(p_id uuid,p_revision bigint,p_nurse uuid default null) returns bigint
language plpgsql security definer set search_path='' as $$
begin
 return public.assign_case_nurse(p_id,public._real_staff_require_admin(),p_revision,p_nurse,true);
end $$;

-- 8. RLS and grants ------------------------------------------------------------------------------
do $$declare n text;begin
 foreach n in array array['staff_telegram_policy','staff_code_challenges','auth_admissions']loop
  execute format('alter table public.%I enable row level security',n);execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
 end loop;
end$$;
revoke all on function public._staff_signin_required(),public._staff_session_admitted(uuid,uuid),public._staff_account_exists(uuid),public._staff_signin_eligible(uuid),
 public.staff_telegram_enrolment_issue(uuid,text),public.staff_telegram_status(uuid),public.staff_telegram_revoke(uuid),
 public.staff_signin_code_begin(uuid,uuid,text,text),public.staff_signin_code_verify(uuid,uuid,uuid,text,text),public.staff_signin_state()from public,anon,authenticated,service_role;
grant execute on function public.staff_telegram_enrolment_issue(uuid,text),public.staff_telegram_status(uuid),public.staff_telegram_revoke(uuid),public.staff_signin_state()to authenticated;
grant execute on function public.staff_signin_code_begin(uuid,uuid,text,text),public.staff_signin_code_verify(uuid,uuid,uuid,text,text)to service_role;
