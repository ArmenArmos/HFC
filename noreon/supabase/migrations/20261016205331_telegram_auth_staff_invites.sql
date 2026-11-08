-- T-auth B-2a (output/telegram-t1-2026-10-16/TAUTH_B2_PLAN.md; design v5 §5): staff (doctor/nurse)
-- invitations delivered through Telegram instead of email. The admin is shown the invitation
-- link once; the invitee proves the invited phone in the bot, receives a code there, and only
-- then does the server open the Supabase invitation session, which is admitted before any
-- cookie reaches the browser. Email invitations stay behind their existing flags (off).
-- Ships dark: needs NOREON_STAFF_TELEGRAM_ENROLMENT and the bot configuration.

-- 1. Challenge purpose and invitation link ----------------------------------------------------
alter table public.telegram_auth_challenges drop constraint telegram_auth_challenges_purpose_check;
alter table public.telegram_auth_challenges add constraint telegram_auth_challenges_purpose_check check(purpose in('member_signin','member_link','staff_enrol','staff_invite'));
alter table public.telegram_auth_challenges add column invitation_id uuid references public.real_staff_invitations(id)on delete cascade,add column invitation_generation bigint;
alter table public.telegram_auth_challenges add constraint telegram_auth_challenges_invite_target check(purpose<>'staff_invite'or(target_user is not null and invitation_id is not null and invitation_generation is not null));

-- Telegram delivery is recorded on the invitation; finalize enforces it (review B-2a #1).
alter table public.real_staff_invitations add column delivery text not null default 'email'check(delivery in('email','telegram')),
 add column invited_phone text check(invited_phone ~ '^\+[1-9][0-9]{6,14}$');
-- An invitee's binding stays pending (inactive, outside the uniqueness rules) until the
-- invitation is accepted; only that invitation generation's code step may use it.
alter table public.telegram_auth_bindings add column pending_invitation_id uuid references public.real_staff_invitations(id)on delete set null;

-- 2. Codes and admissions for invitations ------------------------------------------------------
alter table public.staff_code_challenges add column operation_kind text not null default 'signin'check(operation_kind in('signin','invitation')),
 add column invitation_id uuid references public.real_staff_invitations(id)on delete cascade,add column invitation_generation bigint;
alter table public.staff_code_challenges alter column session_id drop not null;
alter table public.staff_code_challenges add constraint staff_code_challenges_kind check(
 (operation_kind='signin'and session_id is not null)or(operation_kind='invitation'and invitation_id is not null and invitation_generation is not null));
alter table public.auth_admissions drop constraint auth_admissions_operation_kind_check;
alter table public.auth_admissions add constraint auth_admissions_operation_kind_check check(operation_kind in('signin','invitation'));
alter table public.auth_admissions drop constraint auth_admissions_state_check;
alter table public.auth_admissions add constraint auth_admissions_state_check check(state in('claimed','admitted','rejected','expired'));
alter table public.auth_admissions alter column session_id drop not null;
alter table public.auth_admissions add column nonce_hmac text check(nonce_hmac ~ '^[a-f0-9]{64}$'),add column expires_at timestamptz,add column decided_at timestamptz,
 add column operation_generation bigint;
alter table public.auth_admissions add constraint auth_admissions_session_when_decided check(state in('claimed','expired')or session_id is not null);

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
 loc:=case when ch.target_user is null or ch.purpose in('staff_enrol','staff_invite')then 'hy'else public._telegram_auth_locale(ch.target_user)end;
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

-- 3. Invitation delivery: the Telegram link for a dispatched invitation (service role) -----------
create function public.staff_invitation_telegram_issue(p_invitation_id uuid,p_generation bigint,p_operation_id uuid,p_phone text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare i public.real_staff_invitations;raw text;exp timestamptz;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_phone,'')!~'^\+[1-9][0-9]{6,14}$'then return jsonb_build_object('ok',false,'code','invalid_phone');end if;
 if not exists(select 1 from public.telegram_channel_settings where singleton)then return jsonb_build_object('ok',false,'code','unavailable');end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-phone:'||p_phone,0));
 select * into i from public.real_staff_invitations where id=p_invitation_id for update;
 if not found or i.generation<>p_generation or i.operation_id<>p_operation_id or i.status<>'pending'or i.auth_user_id is null
  or i.dispatch_claimed_at is null or i.expires_at<=clock_timestamp()then return jsonb_build_object('ok',false,'code','invitation_changed');end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-user:'||i.auth_user_id::text,0));
 update public.telegram_auth_challenges set state='cancelled'where purpose='staff_invite'and invitation_id=i.id and state='open';
 -- A link forwarded by the admin needs longer than the email hour (design §5: up to 72 h).
 update public.real_staff_invitations set delivery='telegram',invited_phone=p_phone,expires_at=greatest(expires_at,clock_timestamp()+interval '72 hours')where id=i.id returning * into i;
 raw:=translate(encode(extensions.gen_random_bytes(24),'base64'),'+/','-_');exp:=i.expires_at;
 insert into public.telegram_auth_challenges(token_hash,purpose,target_phone,target_user,issued_by,invitation_id,invitation_generation,expires_at)
 values(encode(sha256(convert_to(raw,'UTF8')),'hex'),'staff_invite',p_phone,i.auth_user_id,i.issuer_id,i.id,i.generation,exp);
 perform public._telegram_auth_audit(i.auth_user_id,'staff.invite_issued',jsonb_build_object('invitationId',i.id,'generation',i.generation,'issuer',i.issuer_id));
 return jsonb_build_object('ok',true,'token',raw,'expiresAt',exp);
end$$;

-- The invitation's own proven binding: created by this invitation generation's contact proof.
create function public._staff_invite_binding(i public.real_staff_invitations)returns public.telegram_auth_bindings language sql stable security definer set search_path=''as $$
 select b.* from public.telegram_auth_bindings b join public.telegram_auth_challenges c on c.id=b.proven_by
 where b.auth_user_id=i.auth_user_id and b.kind='staff'and not b.active and b.revoked_at is null and b.pending_invitation_id=i.id
  and c.purpose='staff_invite'and c.invitation_id=i.id and c.invitation_generation=i.generation
$$;

-- 4. Invitee code: begin, verify (claims an admission), admit the opened session ----------------
create function public.staff_invite_code_begin(p_invitation_id uuid,p_generation bigint,p_start_token_hash text,p_nonce_hmac text,p_code_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare i public.real_staff_invitations;b public.telegram_auth_bindings;new_id uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_nonce_hmac,'')!~'^[a-f0-9]{64}$'or coalesce(p_code_hmac,'')!~'^[a-f0-9]{64}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into i from public.real_staff_invitations where id=p_invitation_id;
 if not found or i.generation<>p_generation or i.status not in('pending','verified')or i.auth_user_id is null or i.expires_at<=clock_timestamp()or i.delivery<>'telegram'then
  return jsonb_build_object('ok',false,'code','invitation_unavailable');end if;
 -- Only the holder of this generation's invitation link (its bot start token) may ask for codes.
 if not exists(select 1 from public.telegram_auth_challenges where purpose='staff_invite'and invitation_id=i.id and invitation_generation=i.generation and token_hash=p_start_token_hash)then
  return jsonb_build_object('ok',false,'code','invitation_unavailable');end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-user:'||i.auth_user_id::text,0));
 b:=public._staff_invite_binding(i);
 if b.id is null then return jsonb_build_object('ok',false,'code','not_proven');end if;
 if(select coalesce(sum(attempts),0)from public.staff_code_challenges where auth_user_id=i.auth_user_id and created_at>clock_timestamp()-interval '24 hours')>=10
  or(select count(*)from public.staff_code_challenges where auth_user_id=i.auth_user_id and created_at>clock_timestamp()-interval '15 minutes')>=5 then
  return jsonb_build_object('ok',false,'code','rate_limited');end if;
 update public.staff_code_challenges set state='cancelled'where invitation_id=i.id and state='open';
 insert into public.staff_code_challenges(auth_user_id,operation_kind,invitation_id,invitation_generation,binding_id,binding_generation,nonce_hmac,code_hmac,expires_at)
 values(i.auth_user_id,'invitation',i.id,i.generation,b.id,b.generation,p_nonce_hmac,p_code_hmac,clock_timestamp()+interval '5 minutes')returning staff_code_challenges.id into new_id;
 return jsonb_build_object('ok',true,'challengeId',new_id,'address',b.address);
end$$;
create function public.staff_invite_code_verify(p_challenge uuid,p_invitation_id uuid,p_generation bigint,p_nonce_hmac text,p_code_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare c public.staff_code_challenges;claim uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into c from public.staff_code_challenges where id=p_challenge for update;
 if not found or c.operation_kind<>'invitation'or c.invitation_id is distinct from p_invitation_id or c.invitation_generation is distinct from p_generation or c.nonce_hmac is distinct from p_nonce_hmac then
  return jsonb_build_object('ok',false,'code','unknown_challenge');end if;
 if c.state<>'open'or c.expires_at<=clock_timestamp()then return jsonb_build_object('ok',false,'code','expired');end if;
 if c.code_hmac is distinct from p_code_hmac then
  update public.staff_code_challenges set attempts=attempts+1,state=case when attempts+1>=5 then 'exhausted'else state end where id=c.id;
  return jsonb_build_object('ok',false,'code',case when c.attempts+1>=5 then 'too_many_attempts'else 'wrong_code'end);end if;
 update public.staff_code_challenges set state='used'where id=c.id;
 -- The code proves the invitee; the Supabase session does not exist yet (§5 admission, claimed).
 insert into public.auth_admissions(operation_kind,operation_id,operation_generation,auth_user_id,binding_id,binding_generation,nonce_hmac,state,expires_at)
 values('invitation',c.invitation_id,c.invitation_generation,c.auth_user_id,c.binding_id,c.binding_generation,p_nonce_hmac,'claimed',clock_timestamp()+interval '2 minutes')returning id into claim;
 return jsonb_build_object('ok',true,'claimId',claim);
end$$;
-- Idempotent decision for the session the server just opened (in a buffered client).
create function public.staff_invite_admit(p_claim uuid,p_nonce_hmac text,p_user uuid,p_session uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a public.auth_admissions;i public.real_staff_invitations;ok boolean;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into a from public.auth_admissions where id=p_claim and operation_kind='invitation'for update;
 if not found or a.nonce_hmac is distinct from p_nonce_hmac or a.auth_user_id is distinct from p_user then return jsonb_build_object('ok',false,'code','unknown_claim');end if;
 if a.state in('admitted','rejected')then
  if a.session_id is not distinct from p_session then return jsonb_build_object('ok',a.state='admitted','result',a.state);end if;
  return jsonb_build_object('ok',false,'code','decided');end if;
 if a.state='expired'or a.expires_at<=clock_timestamp()then
  update public.auth_admissions set state='expired',decided_at=clock_timestamp()where id=a.id;
  return jsonb_build_object('ok',false,'code','expired');end if;
 select * into i from public.real_staff_invitations where id=a.operation_id for share;
 ok:=i.id is not null and i.generation=a.operation_generation and i.status in('pending','verified')and i.auth_user_id=a.auth_user_id and i.expires_at>clock_timestamp()
  and exists(select 1 from public.workspace_clinics c where c.id=i.clinic_id and c.active)
  and exists(select 1 from public.workspace_staff s where s.user_id=i.issuer_id and s.role='admin'and s.active and s.removed_at is null)
  and exists(select 1 from public.telegram_auth_bindings b where b.id=a.binding_id and b.revoked_at is null and b.generation=a.binding_generation
   and(b.active or b.pending_invitation_id=a.operation_id))
  and exists(select 1 from auth.sessions x where x.id=p_session and x.user_id=p_user);
 update public.auth_admissions set state=case when ok then 'admitted'else 'rejected'end,session_id=p_session,decided_at=clock_timestamp()where id=a.id;
 perform public._telegram_auth_audit(p_user,case when ok then 'staff.invite_admitted'else 'staff.invite_rejected'end,jsonb_build_object('invitationId',a.operation_id,'sessionId',p_session));
 return jsonb_build_object('ok',ok,'result',case when ok then 'admitted'else 'rejected'end);
end$$;
-- After a rejection (committed first), the server ends exactly that session.
create function public.staff_invite_reject_session(p_claim uuid,p_session uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 delete from auth.sessions s where s.id=p_session and exists(select 1 from public.auth_admissions a where a.id=p_claim and a.session_id=p_session and a.state='rejected'and a.auth_user_id=s.user_id);
 return jsonb_build_object('ok',true,'deleted',found);
end$$;

-- Finalize: a Telegram invitation is accepted only with its admitted invitation session, and that
-- session's pending binding becomes the account's active staff binding (review B-2a #1, #3).
create or replace function public.real_staff_finalize_invitation(p_invitation_id uuid,p_generation bigint,p_auth_user_id uuid,p_auth_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.real_staff_invitations;session_created_at timestamptz;a public.auth_admissions;b public.telegram_auth_bindings;other public.telegram_auth_bindings;
begin
 i:=public._real_staff_lock_invitation(p_invitation_id,p_generation,true);
 if i.auth_user_id is null or i.auth_user_id is distinct from p_auth_user_id then raise insufficient_privilege using message='Invited identity required';end if;
 select created_at into session_created_at from auth.sessions where id=p_auth_session_id and user_id=i.auth_user_id
  and (not_after is null or not_after>clock_timestamp()) for share;
 if not found or session_created_at is null then raise insufficient_privilege using message='Live invited session required';end if;
 if i.status='accepted' then
  if p_auth_session_id is distinct from i.accepted_session_id and session_created_at<i.accepted_at then raise insufficient_privilege using message='Current doctor session required';end if;
  return public._real_staff_invitation_json(i);
 end if;
 if i.status<>'verified' or session_created_at<i.last_requested_at then raise insufficient_privilege using message='Current verified invitation session required';end if;
 perform 1 from auth.users where id=i.auth_user_id and lower(email)=i.email and email_confirmed_at is not null for share;
 if not found then raise insufficient_privilege using message='Verified invited identity required';end if;
 -- Telegram delivery is decided per generation: this generation went out as a Telegram link
 -- (an email reissue after a rollback has no such link and finalizes as before, review N1).
 if exists(select 1 from public.telegram_auth_challenges where purpose='staff_invite'and invitation_id=i.id and invitation_generation=i.generation)then
  select * into a from public.auth_admissions where operation_kind='invitation'and operation_id=i.id and operation_generation=i.generation
   and state='admitted'and session_id=p_auth_session_id and auth_user_id=i.auth_user_id for share;
  if not found then raise insufficient_privilege using message='Telegram-admitted invitation session required';end if;
  select * into b from public.telegram_auth_bindings where id=a.binding_id;
  -- Lock order (§2): phone, principal, user; then rows (review N3).
  perform pg_advisory_xact_lock(hashtextextended('tg-auth-phone:'||b.phone,0));
  perform pg_advisory_xact_lock(hashtextextended('tg-auth-principal:'||b.principal_ref,0));
  perform pg_advisory_xact_lock(hashtextextended('tg-auth-user:'||i.auth_user_id::text,0));
  select * into b from public.telegram_auth_bindings where id=a.binding_id and generation=a.binding_generation and revoked_at is null for update;
  if not found or(not b.active and b.pending_invitation_id is distinct from i.id)then raise insufficient_privilege using message='Telegram binding changed';end if;
  if not b.active then
   select * into other from public.telegram_auth_bindings where auth_user_id=i.auth_user_id and active;
   if found and other.principal_ref=b.principal_ref then
    -- Already enrolled with the same Telegram account (review N2): keep that binding.
    update public.telegram_auth_bindings set revoked_at=clock_timestamp(),revoked_reason='superseded',pending_invitation_id=null where id=b.id;
    update public.auth_admissions set binding_id=other.id,binding_generation=other.generation where id=a.id;
   elsif found or exists(select 1 from public.telegram_auth_bindings where principal_ref=b.principal_ref and active and auth_user_id<>i.auth_user_id)then
    perform public._telegram_auth_audit(i.auth_user_id,'staff.invite_conflict',jsonb_build_object('invitationId',i.id,'bindingId',b.id));
    raise insufficient_privilege using message='Telegram account already in use';
   else
    for other in select * from public.telegram_auth_bindings where kind='staff'and phone=b.phone and active and auth_user_id<>i.auth_user_id for update loop
     perform public._telegram_revoke_binding(other.id,'phone_moved');
    end loop;
    update public.telegram_auth_bindings set active=true,pending_invitation_id=null,proven_at=clock_timestamp()where id=b.id;
    perform public._telegram_auth_audit(i.auth_user_id,'binding.created',jsonb_build_object('bindingId',b.id,'generation',b.generation,'invitationId',i.id));
   end if;
  end if;
 end if;
 perform 1 from public.workspace_staff where user_id=i.auth_user_id and role=i.role and clinic_id=i.clinic_id and not active for update;
 if not found then raise insufficient_privilege using message='Pending staff required';end if;
 update public.workspace_staff set active=true where user_id=i.auth_user_id;
 update public.real_staff_invitations set status='accepted',accepted_at=clock_timestamp(),accepted_session_id=p_auth_session_id where id=i.id returning * into i;
 insert into public.real_staff_admin_events(invitation_id,actor_id,generation,kind) values(i.id,i.auth_user_id,i.generation,'invitation_accepted');
 return public._real_staff_invitation_json(i);
end $$;

-- 5. RLS unchanged (tables existed); grants ---------------------------------------------------------
revoke all on function public.staff_invitation_telegram_issue(uuid,bigint,uuid,text),public._staff_invite_binding(public.real_staff_invitations),
 public.staff_invite_code_begin(uuid,bigint,text,text,text),public.staff_invite_code_verify(uuid,uuid,bigint,text,text),public.staff_invite_admit(uuid,text,uuid,uuid),
 public.staff_invite_reject_session(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.staff_invitation_telegram_issue(uuid,bigint,uuid,text),public.staff_invite_code_begin(uuid,bigint,text,text,text),
 public.staff_invite_code_verify(uuid,uuid,bigint,text,text),public.staff_invite_admit(uuid,text,uuid,uuid),public.staff_invite_reject_session(uuid,uuid)to service_role;
