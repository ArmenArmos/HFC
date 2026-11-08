-- T-auth B-3 (design v5 §5 operations matrix, `staff_telegram_recoveries`): password recovery by
-- Telegram for staff and clinic accounts. Admin-requested only: a global admin sends a one-time
-- reset link to the account's own Telegram chat (its active staff binding). The holder asks for a
-- code in that chat and sets a new password with it; then every session of the account ends.
-- Membership state is not required and not changed; `accepted_session_id` is untouched. No email.
-- Ships dark: needs NOREON_STAFF_TELEGRAM_RECOVERY and the bot configuration.

create table public.staff_telegram_recoveries(
 id uuid primary key default gen_random_uuid(),
 auth_user_id uuid not null references auth.users(id)on delete cascade,
 portal text not null check(portal in('staff','clinic')),
 issuer_id uuid not null references auth.users(id),
 token_hash text unique check(token_hash ~ '^[a-f0-9]{64}$'),
 binding_id uuid not null references public.telegram_auth_bindings(id),binding_generation bigint not null,
 status text not null default 'pending'check(status in('pending','verified','completed','revoked')),
 verified_nonce_hmac text check(verified_nonce_hmac ~ '^[a-f0-9]{64}$'),verified_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,completed_at timestamptz,
 check(status not in('verified','completed')or(verified_at is not null and verified_nonce_hmac is not null)),
 check((status='completed')=(completed_at is not null))
);
create unique index staff_telegram_recoveries_open on public.staff_telegram_recoveries(auth_user_id)where status in('pending','verified');
create index staff_telegram_recoveries_user on public.staff_telegram_recoveries(auth_user_id,created_at);
alter table public.staff_telegram_recoveries enable row level security;
revoke all on public.staff_telegram_recoveries from public,anon,authenticated,service_role;

alter table public.staff_code_challenges drop constraint staff_code_challenges_operation_kind_check;
alter table public.staff_code_challenges add constraint staff_code_challenges_operation_kind_check check(operation_kind in('signin','invitation','clinic_invitation','recovery'));
alter table public.staff_code_challenges add column recovery_id uuid references public.staff_telegram_recoveries(id)on delete cascade;
alter table public.staff_code_challenges drop constraint staff_code_challenges_kind;
alter table public.staff_code_challenges add constraint staff_code_challenges_kind check(
 (operation_kind='signin'and session_id is not null)or(operation_kind='invitation'and invitation_id is not null and invitation_generation is not null)
 or(operation_kind='clinic_invitation'and clinic_invitation_id is not null and invitation_generation is not null)
 or(operation_kind='recovery'and recovery_id is not null));

-- The recovery is usable only while it is open and the binding it was sent to is still the active one.
create function public._staff_recovery_open(p_id uuid)returns public.staff_telegram_recoveries language sql stable security definer set search_path=''as $$
 select r.* from public.staff_telegram_recoveries r join public.telegram_auth_bindings b on b.id=r.binding_id
 where r.id=p_id and r.status in('pending','verified')and r.expires_at>clock_timestamp()
  and b.active and b.revoked_at is null and b.generation=r.binding_generation and b.auth_user_id=r.auth_user_id and b.kind='staff'
  and exists(select 1 from auth.users u where u.id=r.auth_user_id and(u.banned_until is null or u.banned_until<=clock_timestamp()))
$$;

-- 1. Admin: issue a reset link. The app sends it to the account's chat; the raw token is never stored.
create function public.staff_telegram_recovery_issue(p_user uuid,p_portal text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a uuid:=public._real_staff_require_admin();b public.telegram_auth_bindings;r public.staff_telegram_recoveries;
begin
 if p_user is null or p_portal is null or p_portal not in('staff','clinic')then return jsonb_build_object('ok',false,'code','invalid');end if;
 if p_user=a then return jsonb_build_object('ok',false,'code','self');end if;
 -- Admin accounts are never reset by another single admin (review I-1): break-glass runbook only.
 if exists(select 1 from public.workspace_staff where user_id=p_user and role='admin')then return jsonb_build_object('ok',false,'code','admin_target');end if;
 if(p_portal='staff'and not exists(select 1 from public.workspace_staff where user_id=p_user and removed_at is null))
  or(p_portal='clinic'and not exists(select 1 from public.clinic_portal_memberships where user_id=p_user))then
  return jsonb_build_object('ok',false,'code','not_found');end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-user:'||p_user::text,0));
 select * into b from public.telegram_auth_bindings where auth_user_id=p_user and kind='staff'and active and revoked_at is null;
 if not found then return jsonb_build_object('ok',false,'code','not_enrolled');end if;
 -- A chat this admin connected, or one connected in the last 24 hours, cannot receive a reset
 -- (review I-1: rebinding someone's Telegram and then resetting their password).
 if b.proven_at>clock_timestamp()-interval '24 hours'
  or exists(select 1 from public.telegram_auth_challenges c where c.id=b.proven_by and c.issued_by=a)then
  return jsonb_build_object('ok',false,'code','recent_binding');end if;
 if(select count(*)from public.staff_telegram_recoveries where auth_user_id=p_user and created_at>clock_timestamp()-interval '1 hour')>=5 then
  return jsonb_build_object('ok',false,'code','rate_limited');end if;
 -- One open reset per account: a new one retires the previous link and its codes.
 update public.staff_code_challenges set state='cancelled'where state='open'and recovery_id in(select id from public.staff_telegram_recoveries where auth_user_id=p_user and status in('pending','verified'));
 update public.staff_telegram_recoveries set status='revoked'where auth_user_id=p_user and status in('pending','verified');
 insert into public.staff_telegram_recoveries(auth_user_id,portal,issuer_id,binding_id,binding_generation,expires_at)
 values(p_user,p_portal,a,b.id,b.generation,clock_timestamp()+interval '24 hours')returning * into r;
 perform public._telegram_auth_audit(p_user,'staff.recovery_issued',jsonb_build_object('recoveryId',r.id,'issuer',a,'portal',p_portal));
 -- No token here (review M-1): the server mints it once and sends it to the chat.
 return jsonb_build_object('ok',true,'recoveryId',r.id);
end$$;
-- Service: mint the one link token for a just-issued reset, with the chat to send it to.
create function public.staff_recovery_link(p_recovery uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.staff_telegram_recoveries;raw text;b public.telegram_auth_bindings;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 r:=public._staff_recovery_open(p_recovery);
 if r.id is null or r.token_hash is not null or r.status<>'pending'then return jsonb_build_object('ok',false,'code','recovery_unavailable');end if;
 raw:=translate(encode(extensions.gen_random_bytes(24),'base64'),'+/','-_');
 update public.staff_telegram_recoveries set token_hash=encode(sha256(convert_to(raw,'UTF8')),'hex')where id=r.id and token_hash is null;
 if not found then return jsonb_build_object('ok',false,'code','recovery_unavailable');end if;
 select * into b from public.telegram_auth_bindings where id=r.binding_id;
 return jsonb_build_object('ok',true,'token',raw,'address',b.address,'portal',r.portal);
end$$;

-- 2. Holder of the link: a code to the same chat, verified for this browser for 10 minutes.
create function public.staff_recovery_code_begin(p_recovery uuid,p_token_hash text,p_nonce_hmac text,p_code_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.staff_telegram_recoveries;b public.telegram_auth_bindings;new_id uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_nonce_hmac,'')!~'^[a-f0-9]{64}$'or coalesce(p_code_hmac,'')!~'^[a-f0-9]{64}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 r:=public._staff_recovery_open(p_recovery);
 if r.id is null or r.token_hash is null or r.token_hash is distinct from p_token_hash then return jsonb_build_object('ok',false,'code','recovery_unavailable');end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-user:'||r.auth_user_id::text,0));
 if(select coalesce(sum(attempts),0)from public.staff_code_challenges where auth_user_id=r.auth_user_id and created_at>clock_timestamp()-interval '24 hours')>=10
  then return jsonb_build_object('ok',false,'code','rate_limited_day');end if;
 if(select count(*)from public.staff_code_challenges where auth_user_id=r.auth_user_id and created_at>clock_timestamp()-interval '15 minutes')>=5 then
  return jsonb_build_object('ok',false,'code','rate_limited');end if;
 select * into b from public.telegram_auth_bindings where id=r.binding_id;
 update public.staff_code_challenges set state='cancelled'where recovery_id=r.id and state='open';
 insert into public.staff_code_challenges(auth_user_id,operation_kind,recovery_id,binding_id,binding_generation,nonce_hmac,code_hmac,expires_at)
 values(r.auth_user_id,'recovery',r.id,b.id,b.generation,p_nonce_hmac,p_code_hmac,clock_timestamp()+interval '5 minutes')returning staff_code_challenges.id into new_id;
 return jsonb_build_object('ok',true,'challengeId',new_id,'address',b.address);
end$$;
create function public.staff_recovery_code_verify(p_challenge uuid,p_recovery uuid,p_nonce_hmac text,p_code_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare c public.staff_code_challenges;r public.staff_telegram_recoveries;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into c from public.staff_code_challenges where id=p_challenge for update;
 if not found or c.operation_kind<>'recovery'or c.recovery_id is distinct from p_recovery or c.nonce_hmac is distinct from p_nonce_hmac then
  return jsonb_build_object('ok',false,'code','unknown_challenge');end if;
 if c.state<>'open'or c.expires_at<=clock_timestamp()then return jsonb_build_object('ok',false,'code','expired');end if;
 if c.code_hmac is distinct from p_code_hmac then
  update public.staff_code_challenges set attempts=attempts+1,state=case when attempts+1>=5 then 'exhausted'else state end where id=c.id;
  return jsonb_build_object('ok',false,'code',case when c.attempts+1>=5 then 'too_many_attempts'else 'wrong_code'end);end if;
 perform 1 from public.staff_telegram_recoveries where id=p_recovery for update;
 r:=public._staff_recovery_open(p_recovery);
 if r.id is null or r.binding_id<>c.binding_id then return jsonb_build_object('ok',false,'code','recovery_unavailable');end if;
 update public.staff_code_challenges set state='used'where id=c.id;
 update public.staff_telegram_recoveries set status='verified',verified_at=clock_timestamp(),verified_nonce_hmac=p_nonce_hmac where id=r.id;
 delete from auth.sessions where user_id=r.auth_user_id;
 perform public._telegram_auth_audit(r.auth_user_id,'staff.recovery_verified',jsonb_build_object('recoveryId',r.id));
 return jsonb_build_object('ok',true,'authUserId',r.auth_user_id,'portal',r.portal);
end$$;
-- 3. After the app set the new password: every session of the account ends; the reset is done.
create function public.staff_recovery_finish(p_recovery uuid,p_nonce_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.staff_telegram_recoveries;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.staff_telegram_recoveries where id=p_recovery for update;
 if not found then return jsonb_build_object('ok',false,'code','recovery_unavailable');end if;
 if r.status='completed'then
  return case when r.verified_nonce_hmac=p_nonce_hmac then jsonb_build_object('ok',true,'portal',r.portal)else jsonb_build_object('ok',false,'code','recovery_unavailable')end;end if;
 if r.verified_nonce_hmac is distinct from p_nonce_hmac or r.verified_at is null or r.verified_at<=clock_timestamp()-interval '10 minutes'then
  return jsonb_build_object('ok',false,'code','verification_expired');end if;
 -- The password may already be changed: sessions end even if the reset was retired since (review I-2).
 delete from auth.sessions where user_id=r.auth_user_id;
 if r.status='verified'then
  update public.staff_telegram_recoveries set status='completed',completed_at=clock_timestamp()where id=r.id;
 end if;
 perform public._telegram_auth_audit(r.auth_user_id,'staff.recovery_completed',jsonb_build_object('recoveryId',r.id));
 return jsonb_build_object('ok',true,'portal',r.portal,'completed',r.status='verified');
end$$;

revoke all on function public._staff_recovery_open(uuid),public.staff_telegram_recovery_issue(uuid,text),public.staff_recovery_link(uuid),public.staff_recovery_code_begin(uuid,text,text,text),
 public.staff_recovery_code_verify(uuid,uuid,text,text),public.staff_recovery_finish(uuid,text)from public,anon,authenticated,service_role;
grant execute on function public.staff_telegram_recovery_issue(uuid,text)to authenticated;
grant execute on function public.staff_recovery_link(uuid),public.staff_recovery_code_begin(uuid,text,text,text),public.staff_recovery_code_verify(uuid,uuid,text,text),public.staff_recovery_finish(uuid,text)to service_role;
