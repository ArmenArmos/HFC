-- Test accounts only: option A, a per-number test code; real OTP stays sealed on the server.
-- Stamp 20261104175000 from the integrator (test sign-in, Khikar 5 Nov).
-- No settings/allowlist seed. Only bcrypt hashes of test codes are stored.
-- The real Supabase OTP is never exposed to admins or the testing browser.
-- +999 alone is the reserved-account boundary; staff/clinic identities are excluded too.
create table public.test_signin_settings(
 singleton boolean primary key default true check(singleton),enabled boolean not null default false
);
create table public.test_signin_numbers(
 id uuid primary key default gen_random_uuid(),phone text not null unique check(phone ~ '^\+999[0-9]{5,11}$'),
 label text not null check(length(btrim(label))between 1 and 80),created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 active boolean not null default true,code_hash text not null,failed_attempts integer not null default 0 check(failed_attempts>=0),window_started_at timestamptz,
 check(expires_at>created_at and expires_at<=created_at+interval '30 days')
);
create table public.test_signin_challenges(
 request_id uuid primary key references public.auth_code_requests(id)on delete cascade,
 number_id uuid not null references public.test_signin_numbers(id),
 expires_at timestamptz not null default(clock_timestamp()+interval '2 minutes'),checked_at timestamptz
);
alter table public.test_signin_settings enable row level security;
alter table public.test_signin_numbers enable row level security;
alter table public.test_signin_challenges enable row level security;
revoke all on public.test_signin_settings,public.test_signin_numbers,public.test_signin_challenges from public,anon,authenticated,service_role;

-- Existing Activity log already projects telegram_auth_audit as category sign_in.
-- Actor is the actual admin/member, or NULL for an anonymous attempt, never the target member.
create function public._test_signin_audit(p_actor uuid,p_phone text,p_action text,p_outcome text)returns void
language sql volatile security definer set search_path=''as $$
 insert into public.telegram_auth_audit(auth_user_id,kind,detail)values(p_actor,'test_signin.'||p_action||'.'||p_outcome,
 jsonb_build_object('phoneLast4',right(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),4),'outcome',p_outcome))
$$;
-- Internal only: no caller-supplied switch can enable this without the persisted DB switch.
create function public._test_signin_allowed(p_phone text,p_env_enabled boolean)returns boolean
language sql volatile security definer set search_path=''as $$
 select coalesce(p_env_enabled,false)and coalesce((select enabled from public.test_signin_settings where singleton),false)
 and coalesce(p_phone ~ '^\+999[0-9]{5,11}$',false)
 and exists(select 1 from public.test_signin_numbers where phone=p_phone and active and expires_at>clock_timestamp())
 and not exists(select 1 from public.workspace_staff where user_id=public._auth_user_for_phone(p_phone))
 and not exists(select 1 from public.clinic_portal_memberships where user_id=public._auth_user_for_phone(p_phone))
$$;
create function public.test_signin_admin_list()returns jsonb
language plpgsql volatile security definer set search_path=''as $$
begin
 perform public._real_staff_require_admin();
 return jsonb_build_object('enabled',coalesce((select enabled from public.test_signin_settings where singleton),false),
 'numbers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label,'last4',right(phone,4),'expiresAt',expires_at,'active',active)order by created_at desc)
 from public.test_signin_numbers),'[]'::jsonb));
exception when insufficient_privilege then
 perform public._test_signin_audit(auth.uid(),null,'list','forbidden');
 return jsonb_build_object('ok',false,'code','forbidden');
end$$;
create function public.test_signin_admin_add(p_phone text,p_label text,p_days integer default 7)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare actor uuid;nid uuid;stamp timestamptz:=clock_timestamp();test_code text;
begin
 actor:=public._real_staff_require_admin();
 if coalesce(p_phone,'')!~'^\+999[0-9]{5,11}$'or p_label is null or length(btrim(p_label))not between 1 and 80 or p_days is null or p_days not between 1 and 30 then
  perform public._test_signin_audit(actor,p_phone,'add','invalid');return jsonb_build_object('ok',false,'code','invalid');end if;
 if exists(select 1 from public.workspace_staff where user_id=public._auth_user_for_phone(p_phone))
 or exists(select 1 from public.clinic_portal_memberships where user_id=public._auth_user_for_phone(p_phone))then
  perform public._test_signin_audit(actor,p_phone,'add','staff_account');return jsonb_build_object('ok',false,'code','invalid');end if;
 -- Existing entries must be removed before they can be added again.
 test_code:=lpad(((('x'||encode(extensions.gen_random_bytes(4),'hex'))::bit(32)::bigint)%1000000)::text,6,'0');
 insert into public.test_signin_numbers(phone,label,created_by,created_at,expires_at,code_hash)
 values(p_phone,btrim(p_label),actor,stamp,stamp+make_interval(days=>p_days),extensions.crypt(test_code,extensions.gen_salt('bf',10)))
 on conflict(phone)do nothing returning id into nid;
 if nid is null then
  perform public._test_signin_audit(actor,p_phone,'add','already_exists');return jsonb_build_object('ok',false,'code','already_exists');end if;
 perform public._test_signin_audit(actor,p_phone,'add','added');return jsonb_build_object('ok',true,'testCode',test_code);
exception when insufficient_privilege then
 perform public._test_signin_audit(auth.uid(),p_phone,'add','forbidden');
 return jsonb_build_object('ok',false,'code','forbidden');
end$$;
create function public.test_signin_admin_remove(p_id uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare actor uuid;ph text;
begin
 actor:=public._real_staff_require_admin();
 perform pg_advisory_xact_lock(hashtextextended('test-signin-switch',0));
 select phone into ph from public.test_signin_numbers where id=p_id;
 -- Keep the existing lock order: phone advisory lock, allowlist, challenge/request.
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-code:'||coalesce(ph,''),0));
 update public.auth_code_requests r set state='cancelled',code_sealed=null,updated_at=clock_timestamp()
 where r.id in(select request_id from public.test_signin_challenges where number_id=p_id)and r.state<>'verified';
 delete from public.test_signin_challenges where number_id=p_id;
 delete from public.test_signin_numbers where id=p_id;
 perform public._test_signin_audit(actor,ph,'remove',case when found then 'removed'else 'missing'end);
 return jsonb_build_object('ok',true);
exception when insufficient_privilege then
 perform public._test_signin_audit(auth.uid(),null,'remove','forbidden');
 return jsonb_build_object('ok',false,'code','forbidden');
end$$;
create function public.test_signin_admin_switch(p_enabled boolean)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare actor uuid;
begin
 actor:=public._real_staff_require_admin();
 perform pg_advisory_xact_lock(hashtextextended('test-signin-switch',0));
 insert into public.test_signin_settings(singleton,enabled)values(true,coalesce(p_enabled,false))on conflict(singleton)do update set enabled=excluded.enabled;
 -- An off/on cycle must never revive pending OTPs.
 if p_enabled is not true then
  update public.auth_code_requests set state='cancelled',code_sealed=null,updated_at=clock_timestamp()
  where id in(select request_id from public.test_signin_challenges)and state<>'verified';end if;
 perform public._test_signin_audit(actor,null,'switch',case when p_enabled then 'enabled'else 'disabled'end);
 return jsonb_build_object('ok',true);
exception when insufficient_privilege then
 perform public._test_signin_audit(auth.uid(),null,'switch','forbidden');
 return jsonb_build_object('ok',false,'code','forbidden');
end$$;
-- Set/reset a generated test code, returned exactly once. It is unrelated to the real OTP.
create function public.test_signin_admin_set_code(p_id uuid)returns jsonb
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
 update public.test_signin_numbers set code_hash=extensions.crypt(test_code,extensions.gen_salt('bf',10))where id=p_id;
 update public.auth_code_requests set state='cancelled',code_sealed=null,updated_at=clock_timestamp()
 where id in(select request_id from public.test_signin_challenges where number_id=p_id)and state<>'verified';
 perform public._test_signin_audit(actor,ph,'set_code','set');
 return jsonb_build_object('ok',true,'testCode',test_code);
exception when insufficient_privilege then
 perform public._test_signin_audit(auth.uid(),null,'set_code','forbidden');
 return jsonb_build_object('ok',false,'code','forbidden');
end$$;

-- Signed hook only. When either switch is off or admission fails, use today's contact-proof route.
create function public.test_signin_claim(p_phone text,p_webhook_id text,p_body_hmac text,p_env_enabled boolean)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare r public.auth_code_requests;n public.test_signin_numbers;reason text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('test-signin-switch',0));
 if coalesce(p_webhook_id,'')!~'^[A-Za-z0-9_-]{1,128}$'or coalesce(p_body_hmac,'')!~'^[a-f0-9]{64}$'then
  perform public._test_signin_audit(null,p_phone,'refused','invalid');return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-code:'||p_phone,0));
 select * into r from public.auth_code_requests where webhook_id=p_webhook_id;
 if found then
  if r.body_hmac<>p_body_hmac then return jsonb_build_object('ok',false,'code','conflict');end if;
  return jsonb_build_object('ok',true,'replay',true,'requestId',r.id,'state',r.state,'address',r.address);end if;
 select * into r from public.auth_code_requests where phone=p_phone and state='issuing'and lease_until>clock_timestamp()order by created_at desc limit 1 for update;
 if not found then
  perform public._test_signin_audit(null,p_phone,'refused','no_request');return jsonb_build_object('ok',false,'code','no_request');end if;
 -- Keep one-tap links entirely on their original path.
 if r.signin_link_id is not null then return public.auth_code_request_claim(p_phone,p_webhook_id,p_body_hmac);end if;
 if not public._test_signin_allowed(p_phone,p_env_enabled)then
  reason:=case when p_env_enabled is not true or not coalesce((select enabled from public.test_signin_settings where singleton),false)then 'switched_off'
   when p_phone!~'^\+999[0-9]{5,11}$'then 'outside_range'else 'not_allowlisted'end;
  perform public._test_signin_audit(null,p_phone,'refused',reason);
  return public.auth_code_request_claim(p_phone,p_webhook_id,p_body_hmac);
 end if;
 select * into n from public.test_signin_numbers where phone=p_phone for update;
 if n.failed_attempts>=5 and n.window_started_at>clock_timestamp()-interval '15 minutes'then
  perform public._test_signin_audit(null,p_phone,'refused','rate_limited');
  update public.auth_code_requests set state='refused',refusal='rate_limited',updated_at=clock_timestamp()where id=r.id;
  return jsonb_build_object('ok',false,'code','rate_limited');end if;
 insert into public.test_signin_challenges(request_id,number_id)values(r.id,n.id);
 update public.auth_code_requests set state='sending',webhook_id=p_webhook_id,body_hmac=p_body_hmac,updated_at=clock_timestamp()where id=r.id;
 perform public._test_signin_audit(null,p_phone,'challenge','issued');
 return jsonb_build_object('ok',true,'replay',false,'requestId',r.id,'route','test');
end$$;
-- Same sealed OTP mechanism as one-tap sign-in; test ciphertext is service-only.
create or replace function public.auth_code_request_seal(p_request uuid,p_webhook_id text,p_sealed text)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 update public.auth_code_requests set code_sealed=p_sealed,updated_at=clock_timestamp()
 where id=p_request and webhook_id=p_webhook_id and state='sending'and code_sealed is null
 and(signin_link_id is not null or exists(select 1 from public.test_signin_challenges where request_id=p_request));
 return jsonb_build_object('ok',true,'updated',found);
end$$;
create function public.test_signin_check(p_request uuid,p_nonce_hmac text,p_test_code text,p_code_digest text,p_env_enabled boolean)returns jsonb
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
  when coalesce(p_test_code,'')!~'^[0-9]{6}$'or extensions.crypt(p_test_code,n.code_hash)is distinct from n.code_hash then 'wrong_code'end;
 if reason is not null then
  if reason='wrong_code'then
   update public.test_signin_numbers set failed_attempts=case when window_started_at>clock_timestamp()-interval '15 minutes'then failed_attempts+1 else 1 end,
   window_started_at=case when window_started_at>clock_timestamp()-interval '15 minutes'then window_started_at else clock_timestamp()end where id=n.id;
  end if;
  perform public._test_signin_audit(null,r.phone,'refused',reason);return jsonb_build_object('ok',false,'code',reason);end if;
 -- Atomically consume at app check, before GoTrue; concurrent checks cannot both win.
 update public.test_signin_challenges set checked_at=clock_timestamp()where request_id=p_request;
 update public.auth_code_requests set code_sealed=null where id=p_request;
 perform public._test_signin_audit(null,r.phone,'code','accepted');
 return jsonb_build_object('ok',true,'phone',r.phone,'sealed',r.code_sealed);
end$$;
create function public.test_signin_verified(p_request uuid,p_nonce_hmac text,p_code_digest text,p_user uuid,p_session uuid,p_env_enabled boolean)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare r public.auth_code_requests;c public.test_signin_challenges;result jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('test-signin-switch',0));
 select * into r from public.auth_code_requests where id=p_request;
 if not exists(select 1 from public.test_signin_challenges where request_id=p_request)then
  return public.auth_code_request_verified(p_request,p_nonce_hmac,p_code_digest,p_user,p_session);end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-code:'||r.phone,0));
 select * into r from public.auth_code_requests where id=p_request for update;
 select * into c from public.test_signin_challenges where request_id=p_request for update;
 if not public._test_signin_allowed(r.phone,p_env_enabled)or c.checked_at is null or c.expires_at<=clock_timestamp()then
  perform public._test_signin_audit(null,r.phone,'refused','not_verifiable');return jsonb_build_object('ok',false,'code','not_verifiable');end if;
 result:=public.auth_code_request_verified(p_request,p_nonce_hmac,p_code_digest,p_user,p_session);
 if result->>'ok'='true'and r.state<>'verified'then perform public._test_signin_audit(p_user,r.phone,'signin','succeeded');end if;
 return result;
end$$;
revoke all on function public._test_signin_audit(uuid,text,text,text),public._test_signin_allowed(text,boolean),
 public.test_signin_admin_list(),public.test_signin_admin_add(text,text,integer),public.test_signin_admin_remove(uuid),public.test_signin_admin_switch(boolean),public.test_signin_admin_set_code(uuid),
 public.test_signin_claim(text,text,text,boolean),public.test_signin_check(uuid,text,text,text,boolean),public.test_signin_verified(uuid,text,text,uuid,uuid,boolean)
 from public,anon,authenticated,service_role;
grant execute on function public.test_signin_admin_list(),public.test_signin_admin_add(text,text,integer),public.test_signin_admin_remove(uuid),public.test_signin_admin_switch(boolean),public.test_signin_admin_set_code(uuid)to authenticated;
grant execute on function public.test_signin_claim(text,text,text,boolean),public.test_signin_check(uuid,text,text,text,boolean),public.test_signin_verified(uuid,text,text,uuid,uuid,boolean)to service_role;
