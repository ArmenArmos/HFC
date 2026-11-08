-- Telegram follow-ups after the Fable review and the lead's decisions (17 Oct 2026):
-- * F-2: consent evidence on automatic links (version and time) and a one-time chat notice;
-- * removing the Telegram sign-in account also turns doctor replies off (lead decision 4);
-- * F-3: staff enrolment never targets another admin, an admin connects only their own Telegram
--   the first time (QA S-01), and an existing connection is replaced only after confirmation;
-- * F-6: a clinic invitee refused at finalize does not keep a password; F-7: a staff password
--   sign-in after a revocation survives the cleanup while the code step is off; F-8: a recovery
--   code no longer ends sessions before the password changes (finish still ends them);
-- * an admin queue of conversations whose member has no doctor yet (lead decision 1).

alter table public.conversation_endpoints add column consent_version text,add column consented_at timestamptz;
-- The one-time notice is sent once it can actually go out: a copy held as unapproved does not count,
-- and a member already linked gets it as soon as the newest wording for their language is approved
-- (Fable N-1).
create function public._telegram_replies_notice(m uuid,ep public.conversation_endpoints)returns void language plpgsql security definer set search_path=''as $$
begin
 if ep.id is null or exists(select 1 from public.system_messages where member_id=m and template_id='telegram.replies_auto_linked'
   and not(state='held'and reason='template_unapproved')and state<>'definitely_failed')then return;end if;
 if not coalesce((select t.approved from public.system_message_templates t where t.template_id='telegram.replies_auto_linked'
   and t.locale=coalesce((select locale from public.profiles where id=m),'hy')order by t.version desc limit 1),false)then return;end if;
 perform public._system_message_enqueue('telegram.replies_auto_linked',m,ep,null);
end$$;
revoke all on function public._telegram_replies_notice(uuid,public.conversation_endpoints)from public,anon,authenticated,service_role;
insert into public.system_message_templates(template_id,version,locale,body)values
 ('telegram.replies_auto_linked',1,'en','UNAPPROVED PLACEHOLDER. Your care team''s replies will arrive in this chat. You can turn this off in your Noreon profile.'),
 ('telegram.replies_auto_linked',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր խնամքի թիմի պատասխանները կգան այս զրույցում։ Կարող եք անջատել դա ձեր Noreon պրոֆիլում։');

create or replace function public._telegram_replies_auto(m uuid,p_explicit boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare b public.telegram_auth_bindings;act jsonb;s public.telegram_channel_settings;ep public.conversation_endpoints;pc public.patient_consents;
begin
 -- Same member lock as linking and unlinking, so two automatic calls never link twice.
 perform pg_advisory_xact_lock(hashtextextended('telegram-member:'||m::text,0));
 select * into ep from public.conversation_endpoints where member_id=m and adapter='telegram'and active and consent_source='enrolment';
 if exists(select 1 from public.conversation_endpoints where member_id=m and adapter='telegram'and active)then
  perform public._telegram_replies_notice(m,ep);
  return jsonb_build_object('ok',true,'result','already_linked');end if;
 select * into b from public.telegram_auth_bindings where auth_user_id=m and kind='member'and active;
 if not found then return jsonb_build_object('ok',false,'code','telegram_not_connected');end if;
 -- The binding must belong to the bot in use now (review M-5: a bot change leaves old bindings).
 select * into s from public.telegram_channel_settings where singleton;
 if not found or b.account_ref is distinct from public._telegram_account_ref(s)then return jsonb_build_object('ok',false,'code','unavailable');end if;
 if not public._telegram_member_eligible(m)then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 -- The member's own "off" stands until they turn replies on again, whatever Telegram account or
 -- proof comes later (review I-1): their latest unlink is newer than their latest link.
 -- Removing the Telegram sign-in account ("no longer my Telegram") also turns replies off (lead, 17 Oct).
 if not p_explicit and greatest(coalesce((select max(created_at)from public.telegram_audit where member_id=m and kind='link.unlinked'),'-infinity'),
   coalesce((select max(created_at)from public.telegram_auth_audit where auth_user_id=m and kind='binding.revoked'and detail->>'reason'='member_unlinked'),'-infinity'))
  >coalesce((select max(created_at)from public.telegram_audit where member_id=m and kind='link.redeemed'),'-infinity')then
  return jsonb_build_object('ok',false,'code','turned_off');end if;
 act:=public._telegram_replies_activate(m,b.id);
 if act->>'ok'<>'true'then return act;end if;
 select * into pc from public.patient_consents where user_id=m order by accepted_at desc limit 1;
 update public.conversation_endpoints set consent_source='enrolment',consent_version=pc.version,consented_at=pc.accepted_at
  where id=(act->>'endpointId')::uuid returning * into ep;
 perform public._telegram_audit(m,'link.auto_enrolment',jsonb_build_object('endpointId',ep.id,'bindingId',b.id,'explicit',p_explicit,
  'consentVersion',pc.version,'consentedAt',pc.accepted_at));
 -- Told once, in the chat, that replies arrive there and how to turn them off (Fable F-2); the
 -- link confirmation with the emergency line follows as before. Both held until approved.
 perform public._telegram_replies_notice(m,ep);
 perform public._system_message_enqueue('telegram.link_confirmed',m,ep,null);
 return jsonb_build_object('ok',true,'result','linked','endpointId',act->>'endpointId');
end$$;

create or replace function public.staff_recovery_code_verify(p_challenge uuid,p_recovery uuid,p_nonce_hmac text,p_code_hmac text)returns jsonb
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
 perform public._telegram_auth_audit(r.auth_user_id,'staff.recovery_verified',jsonb_build_object('recoveryId',r.id));
 return jsonb_build_object('ok',true,'authUserId',r.auth_user_id,'portal',r.portal);
end$$;

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
    and b.created_at>=j.revoked_at-interval '1 second')
  -- A staff password sign-in made after the revocation is kept while the code step is not
  -- required; when it is required, such a session is unadmitted and refused anyway (Fable F-7).
  and not(s.created_at>j.revoked_at and not public._staff_signin_required()and public._staff_account_exists(j.auth_user_id));
  get diagnostics n=row_count;total:=total+n;
  update public.auth_cleanup_jobs set state='done',done_at=clock_timestamp(),deleted_sessions=n where id=j.id;
 end loop;
 return jsonb_build_object('ok',true,'deleted',total);
end$$;

drop function public.staff_telegram_enrolment_issue(uuid,text);
create function public.staff_telegram_enrolment_issue(p_staff uuid,p_phone text,p_replace boolean default false)returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor uuid;raw text;exp timestamptz;cur public.telegram_auth_bindings;
begin
 actor:=public._real_staff_require_admin();
 if not exists(select 1 from public.telegram_channel_settings where singleton)then return jsonb_build_object('ok',false,'code','unavailable');end if;
 if p_staff is null or not public._staff_account_exists(p_staff)then return jsonb_build_object('ok',false,'code','not_staff');end if;
 if coalesce(p_phone,'')!~'^\+[1-9][0-9]{6,14}$'then return jsonb_build_object('ok',false,'code','invalid_phone');end if;
 -- Fable F-3 (mirrors recovery): never one's own account, never an admin account.
 -- QA S-01: an admin may connect their own Telegram the first time (otherwise no admin could ever
 -- pass the second step); replacing it, or enrolling another admin, stays refused.
 if p_staff=actor and exists(select 1 from public.telegram_auth_bindings where auth_user_id=actor and kind='staff'and active)then
  return jsonb_build_object('ok',false,'code','self');end if;
 if p_staff<>actor and exists(select 1 from public.workspace_staff where user_id=p_staff and role='admin')then return jsonb_build_object('ok',false,'code','admin_target');end if;
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-phone:'||p_phone,0));
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-user:'||p_staff::text,0));
 if(select count(*)from public.telegram_auth_challenges where purpose='staff_enrol'and target_user=p_staff and created_at>clock_timestamp()-interval '1 hour')>=10 then
  return jsonb_build_object('ok',false,'code','rate_limited');end if;
 -- An existing connection is replaced only after the admin saw it and confirmed (Fable F-3).
 select * into cur from public.telegram_auth_bindings where auth_user_id=p_staff and kind='staff'and active;
 if found and not coalesce(p_replace,false)then
  return jsonb_build_object('ok',false,'code','has_binding','since',cur.proven_at,
   'connectedBy',(select coalesce(nullif(btrim(s.display_name),''),'an administrator')from public.telegram_auth_challenges c join public.workspace_staff s on s.user_id=c.issued_by where c.id=cur.proven_by));
 end if;
 -- Reissue invalidates earlier links for this account.
 update public.telegram_auth_challenges set state='cancelled'where purpose='staff_enrol'and target_user=p_staff and state='open';
 raw:=translate(encode(extensions.gen_random_bytes(24),'base64'),'+/','-_');exp:=clock_timestamp()+interval '72 hours';
 insert into public.telegram_auth_challenges(token_hash,purpose,target_phone,target_user,issued_by,expires_at,allow_replace)
 values(encode(sha256(convert_to(raw,'UTF8')),'hex'),'staff_enrol',p_phone,p_staff,actor,exp,coalesce(p_replace,false));
 perform public._telegram_auth_audit(p_staff,'staff.enrolment_issued',jsonb_build_object('issuedBy',actor,'expiresAt',exp,'replacing',cur.id));
 return jsonb_build_object('ok',true,'token',raw,'expiresAt',exp);
end$$;
revoke all on function public.staff_telegram_enrolment_issue(uuid,text,boolean)from public,anon,authenticated,service_role;
grant execute on function public.staff_telegram_enrolment_issue(uuid,text,boolean)to authenticated;


-- F-6: called by the app when finalize refuses after the password was set.
create function public.clinic_invitation_clear_password(p_invitation_id uuid,p_generation bigint,p_nonce_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare i public.clinic_portal_invitations;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into i from public.clinic_portal_invitations where id=p_invitation_id for update;
 if not found or i.generation<>p_generation or i.status='accepted'or i.verified_nonce_hmac is distinct from p_nonce_hmac or i.auth_user_id is null
  or exists(select 1 from public.clinic_portal_memberships where user_id=i.auth_user_id)or exists(select 1 from public.workspace_staff where user_id=i.auth_user_id)then
  return jsonb_build_object('ok',false,'code','not_applicable');end if;
 update auth.users set encrypted_password=''where id=i.auth_user_id and nullif(encrypted_password,'')is not null;
 delete from auth.sessions where user_id=i.auth_user_id;
 return jsonb_build_object('ok',true);
end$$;

-- Lead decision 1: admins see conversations whose member has no assigned doctor yet.
create function public.conversation_unassigned_members()returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform public._real_staff_require_admin();
 return jsonb_build_object('ok',true,'items',coalesce((select jsonb_agg(item order by item->>'lastMessageAt' desc)from(
  select jsonb_build_object('memberId',cs.user_id,'memberName',coalesce(pr.display_name,''),
   'lastMessageAt',(select max(m.created_at)from public.conversation_messages m where m.conversation_id=c.id),
   'messages',(select count(*)from public.conversation_messages m where m.conversation_id=c.id),
   'channel',case when exists(select 1 from public.conversation_endpoints e where e.member_id=cs.user_id and e.adapter='telegram'and e.active)then 'telegram'else 'app'end)as item
  from public.patient_clinical_cases cs join public.conversations c on c.member_id=cs.user_id left join public.profiles pr on pr.id=cs.user_id
  where cs.assigned_doctor_id is null and exists(select 1 from public.conversation_messages m where m.conversation_id=c.id)
  order by c.id limit 200)x),'[]'::jsonb));
end$$;

revoke all on function public.clinic_invitation_clear_password(uuid,bigint,text),public.conversation_unassigned_members()from public,anon,authenticated,service_role;
grant execute on function public.clinic_invitation_clear_password(uuid,bigint,text)to service_role;
grant execute on function public.conversation_unassigned_members()to authenticated;

-- QA M-02 (c): the member page can tell "messaging not switched on" (no conversation policy) apart
-- from "not connected". Same body as before plus `messagingReady`.
create or replace function public.telegram_link_status()returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=auth.uid();s public.telegram_channel_settings;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 select * into s from public.telegram_channel_settings where singleton;
 if not found then return jsonb_build_object('ok',true,'available',false,'linked',false,'connected',false,'messagingReady',false);end if;
 return jsonb_build_object('ok',true,'available',public._telegram_member_eligible(m),
  'connected',exists(select 1 from public.telegram_auth_bindings where auth_user_id=m and kind='member'and active),
  'linked',exists(select 1 from public.conversation_endpoints where member_id=m and adapter='telegram'and active),'consentVersion',s.consent_version,
  'messagingReady',exists(select 1 from public.conversation_policy where singleton));
end$$;


-- QA C-01: clinic invitations with GoTrue's random hash for password-less users.
create or replace function public.clinic_invitation_telegram_issue(p_invitation_id uuid,p_generation bigint,p_auth_user_id uuid)returns jsonb
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
  -- Only a brand-new, never-used account for exactly this email with no other Noreon role. GoTrue
  -- (v2.196+) stores a random hash for a user created without a password (QA C-01), so 'never
  -- signed in' is the check, not 'no password'.
  select * into u from auth.users where id=p_auth_user_id for share;
  if u.id is null or lower(u.email)is distinct from i.email or u.email_confirmed_at is null or u.created_at<i.created_at or u.last_sign_in_at is not null
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

create or replace function public.clinic_invitation_finalize(p_invitation_id uuid,p_generation bigint,p_nonce_hmac text)returns jsonb
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
 -- The invitee's own password: set after this browser verified the code (QA C-01: a hash alone proves
 -- nothing). Measured on GoTrue 2.196: the admin password update bumps updated_at; 30 s allow for
 -- clock skew between the database and the Auth host (Fable N-2).
 perform 1 from auth.users where id=i.auth_user_id and lower(email)=i.email and email_confirmed_at is not null and nullif(encrypted_password,'')is not null and updated_at>=i.verified_at-interval '30 seconds'
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


-- Fable N-3: a staff enrolment link replaces only when the admin confirmed replacement.
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
  -- Replaces an existing connection only when the admin confirmed it for this link (Fable N-3).
  bound:=public._telegram_auth_bind(ch.target_user,'staff',r.principal_ref,public._telegram_account_ref(s),phone,addr,ch.id,ch.allow_replace);
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
