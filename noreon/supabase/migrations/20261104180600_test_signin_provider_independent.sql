-- Placeholder stamp: the integrator renames this and regenerates Database types.
-- No seed rows or Auth token internals. Existing test allowlist, flags, audit vocabulary,
-- bcrypt codes and two-minute one-use challenges remain authoritative.
-- One accepted bcrypt match spends each admin-issued code, even if Auth later fails.
alter table public.test_signin_numbers add column code_used_at timestamptz;
-- Fixed-work comparison of SHA-256 digests, rather than SQL text equality of bcrypt output.
create function public._test_signin_hash_equal(a text,b text)returns boolean
language plpgsql immutable security definer set search_path=''as $$
declare x bytea:=extensions.digest(coalesce(a,''),'sha256');y bytea:=extensions.digest(coalesce(b,''),'sha256');diff integer:=0;i integer;
begin
 for i in 0..31 loop diff:=diff | (get_byte(x,i) # get_byte(y,i));end loop;
 return diff=0 and a is not null and b is not null;
end$$;
-- Server action only. A synthetic hook marker reuses #700's challenge store without
-- requesting an Auth OTP or calling any hook. Refused test phones never fall back.
create function public.test_signin_direct_begin(p_phone text,p_nonce_hmac text,p_env_enabled boolean)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare opened jsonb;claimed jsonb;rid uuid;marker text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('test-signin-switch',0));
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-code:'||coalesce(p_phone,''),0));
 if not public._test_signin_allowed(p_phone,p_env_enabled)then
  if p_env_enabled is not true or not coalesce((select enabled from public.test_signin_settings where singleton),false)then
   perform public._test_signin_audit(null,p_phone,'refused','switched_off');return jsonb_build_object('ok',false,'code','switched_off');
  elsif coalesce(p_phone,'')!~'^\+999[0-9]{5,11}$'then
   perform public._test_signin_audit(null,p_phone,'refused','outside_range');return jsonb_build_object('ok',false,'code','outside_range');
  else
   perform public._test_signin_audit(null,p_phone,'refused','not_allowlisted');return jsonb_build_object('ok',false,'code','not_allowlisted');
  end if;
 end if;
 -- A checked challenge owns the exchange until finalized, cancelled by admin reset,
 -- or expired (two minutes). A failed/abandoned exchange never revives its spent code.
 if exists(select 1 from public.test_signin_challenges c join public.auth_code_requests r on r.id=c.request_id
  where r.phone=p_phone and r.state='sent'and c.checked_at is not null and c.expires_at>clock_timestamp())then
  perform public._test_signin_audit(null,p_phone,'refused','rate_limited');return jsonb_build_object('ok',false,'code','rate_limited');end if;
 opened:=public.auth_code_request_begin(p_phone,p_nonce_hmac);
 if opened->>'ok'<>'true'then
  if opened->>'code'='busy'then
   perform public._test_signin_audit(null,p_phone,'refused','rate_limited');return jsonb_build_object('ok',false,'code','rate_limited');end if;
  perform public._test_signin_audit(null,p_phone,'refused','invalid');return jsonb_build_object('ok',false,'code','invalid');end if;
 rid:=(opened->>'requestId')::uuid;marker:='test_direct_'||rid::text;
 claimed:=public.test_signin_claim(p_phone,marker,encode(extensions.gen_random_bytes(32),'hex'),p_env_enabled);
 if claimed->>'ok'<>'true'then return claimed;end if;
 -- The marker satisfies the existing check's sealed-code guard; it contains no OTP.
 perform public.auth_code_request_seal(rid,marker,'direct');
 perform public.auth_code_request_finish(rid,marker,'accepted',encode(extensions.gen_random_bytes(32),'hex'));
 return jsonb_build_object('ok',true,'requestId',rid);
end$$;

create function public.test_signin_direct_check(p_request uuid,p_nonce_hmac text,p_phone text,p_test_code text,p_env_enabled boolean)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare r public.auth_code_requests;result jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('test-signin-switch',0));
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-code:'||coalesce(p_phone,''),0));
 select * into r from public.auth_code_requests where id=p_request for update;
 if not found or r.phone is distinct from p_phone or r.webhook_id is distinct from 'test_direct_'||r.id::text
  or not exists(select 1 from public.test_signin_challenges where request_id=r.id)then
  perform public._test_signin_audit(null,p_phone,'refused','unknown_request');return jsonb_build_object('ok',false,'code','unknown_request');end if;
 if exists(select 1 from public.test_signin_challenges c join public.auth_code_requests other on other.id=c.request_id
  where other.phone=p_phone and other.id<>r.id and other.state='sent'and c.checked_at is not null and c.expires_at>clock_timestamp())then
  perform public._test_signin_audit(null,p_phone,'refused','rate_limited');return jsonb_build_object('ok',false,'code','rate_limited');end if;
 result:=public.test_signin_check(r.id,p_nonce_hmac,p_test_code,r.code_digest,p_env_enabled);
 if result->>'ok'<>'true'then return result;end if;
 return jsonb_build_object('ok',true,'phone',r.phone,'userId',public._auth_user_for_phone(r.phone),'codeDigest',r.code_digest);
end$$;

create function public.test_signin_direct_verified(p_request uuid,p_nonce_hmac text,p_phone text,p_code_digest text,p_user uuid,p_session uuid,p_env_enabled boolean)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('test-signin-switch',0));
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-code:'||coalesce(p_phone,''),0));
 if not exists(select 1 from public.auth_code_requests r join public.test_signin_challenges c on c.request_id=r.id
  where r.id=p_request and r.phone=p_phone and r.webhook_id='test_direct_'||r.id::text)
  or not exists(select 1 from auth.sessions where id=p_session and user_id=p_user)
  or not exists(select 1 from auth.users where id=p_user and role='authenticated')then
  perform public._test_signin_audit(null,p_phone,'refused','not_verifiable');return jsonb_build_object('ok',false,'code','not_verifiable');end if;
 return public.test_signin_verified(p_request,p_nonce_hmac,p_code_digest,p_user,p_session,p_env_enabled);
end$$;

create function public.test_signin_direct_abandon(p_request uuid,p_nonce_hmac text,p_phone text,p_env_enabled boolean)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('test-signin-switch',0));
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-code:'||coalesce(p_phone,''),0));
 if exists(select 1 from public.auth_code_requests where id=p_request and phone=p_phone and nonce_hmac=p_nonce_hmac and webhook_id='test_direct_'||id::text)then
  perform public.auth_code_request_abandon(p_request,p_nonce_hmac);
  perform public._test_signin_audit(null,p_phone,'refused','not_verifiable');end if;
 return jsonb_build_object('ok',true);
end$$;

revoke all on function public._test_signin_hash_equal(text,text),
 public.test_signin_direct_begin(text,text,boolean),public.test_signin_direct_check(uuid,text,text,text,boolean),
 public.test_signin_direct_verified(uuid,text,text,text,uuid,uuid,boolean),public.test_signin_direct_abandon(uuid,text,text,boolean)
 from public,anon,authenticated,service_role;
grant execute on function public.test_signin_direct_begin(text,text,boolean),public.test_signin_direct_check(uuid,text,text,text,boolean),
 public.test_signin_direct_verified(uuid,text,text,text,uuid,uuid,boolean),public.test_signin_direct_abandon(uuid,text,text,boolean)to service_role;
create or replace function public.test_signin_check(p_request uuid,p_nonce_hmac text,p_test_code text,p_code_digest text,p_env_enabled boolean)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare r public.auth_code_requests;c public.test_signin_challenges;n public.test_signin_numbers;reason text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('test-signin-switch',0));
 select * into r from public.auth_code_requests where id=p_request;
 if not exists(select 1 from public.test_signin_challenges where request_id=p_request)then
  return public.auth_code_request_check(p_request,p_nonce_hmac,p_code_digest);end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-code:'||r.phone,0));
 select * into r from public.auth_code_requests where id=p_request for update;
 select * into c from public.test_signin_challenges where request_id=p_request for update;
 select * into n from public.test_signin_numbers where id=c.number_id for update;
 reason:=case when not public._test_signin_allowed(r.phone,p_env_enabled)then 'switched_off_or_removed'
  when r.nonce_hmac is distinct from p_nonce_hmac then 'unknown_request'
  when r.state<>'sent'or r.code_sealed is null or c.checked_at is not null then 'not_verifiable'
  when c.expires_at<=clock_timestamp()then 'expired'
  when n.failed_attempts>=5 and n.window_started_at>clock_timestamp()-interval '15 minutes'then 'rate_limited'
  when coalesce(p_test_code,'')!~'^[0-9]{6}$'or not public._test_signin_hash_equal(extensions.crypt(p_test_code,n.code_hash),n.code_hash)or n.code_used_at is not null then 'wrong_code'end;
 if reason is not null then
  if reason='wrong_code'then
   update public.test_signin_numbers set failed_attempts=case when window_started_at>clock_timestamp()-interval '15 minutes'then failed_attempts+1 else 1 end,
   window_started_at=case when window_started_at>clock_timestamp()-interval '15 minutes'then window_started_at else clock_timestamp()end where id=n.id;
  end if;
  perform public._test_signin_audit(null,r.phone,'refused',reason);return jsonb_build_object('ok',false,'code',reason);end if;
 -- Lock order is switch advisory, phone advisory, then request/challenge/number rows.
 -- Both hook and direct checks, and admin reset, share these advisory locks. A second
 -- transaction waits, rereads the spent marker, and cannot accept the same issue.
 -- Spend code and challenge atomically before Auth; any later failure needs a new issue.
 update public.test_signin_numbers set code_used_at=clock_timestamp()where id=n.id;
 update public.test_signin_challenges set checked_at=clock_timestamp()where request_id=p_request;
 update public.auth_code_requests set code_sealed=null where id=p_request;
 perform public._test_signin_audit(null,r.phone,'code','accepted');
 return jsonb_build_object('ok',true,'phone',r.phone,'sealed',r.code_sealed);
end$$;

-- Issuance does not reset the cross-challenge five-guess window. Existing challenges
-- are cancelled, so an old accepted exchange cannot finalize after admin re-issue.
create or replace function public.test_signin_admin_set_code(p_id uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare actor uuid;ph text;test_code text;
begin
 actor:=public._real_staff_require_admin();
 perform pg_advisory_xact_lock(hashtextextended('test-signin-switch',0));
 select phone into ph from public.test_signin_numbers where id=p_id;
 if ph is null then
  perform public._test_signin_audit(actor,null,'set_code','missing');return jsonb_build_object('ok',false,'code','missing');end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-code:'||ph,0));
 test_code:=lpad(((('x'||encode(extensions.gen_random_bytes(4),'hex'))::bit(32)::bigint)%1000000)::text,6,'0');
 update public.test_signin_numbers set code_hash=extensions.crypt(test_code,extensions.gen_salt('bf',10)),code_used_at=null where id=p_id;
 update public.auth_code_requests set state='cancelled',code_sealed=null,updated_at=clock_timestamp()
 where id in(select request_id from public.test_signin_challenges where number_id=p_id)and state<>'verified';
 perform public._test_signin_audit(actor,ph,'set_code','set');
 return jsonb_build_object('ok',true,'testCode',test_code);
exception when insufficient_privilege then
 perform public._test_signin_audit(auth.uid(),null,'set_code','forbidden');
 return jsonb_build_object('ok',false,'code','forbidden');
end$$;

-- CREATE OR REPLACE preserves ACLs; repeat the boundaries explicitly for this lifecycle.
revoke all on function public.test_signin_check(uuid,text,text,text,boolean),public.test_signin_admin_set_code(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.test_signin_check(uuid,text,text,text,boolean)to service_role;
grant execute on function public.test_signin_admin_set_code(uuid)to authenticated;
