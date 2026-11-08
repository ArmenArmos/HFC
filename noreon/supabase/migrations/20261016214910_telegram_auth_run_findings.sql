-- T-auth fixes from the real test-bot run (output/telegram-t1-2026-10-16/TBOT_E2E_EVIDENCE.md):
-- 1. a second "Send the code" or "Connect" press no longer cancels the bot link already in use;
-- 2. a used, cancelled or expired bot link gets a neutral reply instead of silence;
-- 5. staff enrolment confirmation no longer tells staff to return to the app;
-- 3. share-flow prompts in Armenian also carry English.
-- New texts are UNAPPROVED PLACEHOLDERS (held until approved), bilingual because the
-- member's language is not known on these links.

insert into public.system_message_templates(template_id,version,locale,body)values
 ('telegram.link_expired',1,'hy','UNAPPROVED PLACEHOLDER. Այս հղումն այլևս չի գործում։ Սկսեք նորից Noreon հավելվածում։
This link no longer works. Start again in the Noreon app.'),
 ('telegram.link_expired',1,'en','UNAPPROVED PLACEHOLDER. This link no longer works. Start again in the Noreon app.'),
 ('telegram.staff_contact_ok',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր համարը հաստատված է։ Telegram-ը միացված է ձեր Noreon աշխատակցի հաշվին։
Your number is confirmed. Telegram is now connected to your Noreon staff account.'),
 ('telegram.staff_contact_ok',1,'en','UNAPPROVED PLACEHOLDER. Your number is confirmed. Telegram is now connected to your Noreon staff account.'),
 -- Finding 3 (lead): Armenian stays the default when the language is unknown; these prompts
 -- now carry English too, like the code messages.
 ('telegram.share_contact',2,'hy','UNAPPROVED PLACEHOLDER. Որպեսզի հաստատենք, որ սա ձեր համարն է, սեղմեք ներքևի կոճակը։
To confirm this is your number, press the button below.'),
 ('telegram.share_contact_label',2,'hy','Կիսվել իմ համարով / Share my number'),
 ('telegram.contact_ok',2,'hy','UNAPPROVED PLACEHOLDER. Ձեր համարը հաստատված է։ Շարունակելու համար վերադարձեք Noreon։
Your number is confirmed. Go back to Noreon to continue.'),
 ('telegram.contact_refused',2,'hy','UNAPPROVED PLACEHOLDER. Չհաջողվեց հաստատել այս համարը։ Բացեք Noreon-ը և փորձեք նորից։
We could not confirm this number. Open Noreon and try again.');

create or replace function public.telegram_auth_challenge_create(p_purpose text,p_phone text,p_user uuid default null,p_nonce_hmac text default null,p_consent_version text default null,p_allow_replace boolean default false)returns jsonb
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
 -- Earlier open links stay usable (test-bot run finding 1): a second press must never cancel
 -- the link the member is already using. Each link is single use and expires; limits above apply.
 raw:=translate(encode(extensions.gen_random_bytes(24),'base64'),'+/','-_');exp:=clock_timestamp()+interval '10 minutes';
 insert into public.telegram_auth_challenges(token_hash,purpose,target_phone,target_user,nonce_hmac,consent_version,allow_replace,expires_at)
 values(encode(sha256(convert_to(raw,'UTF8')),'hex'),p_purpose,p_phone,p_user,p_nonce_hmac,case when p_purpose='member_link'then p_consent_version end,coalesce(p_allow_replace,false),exp);
 return jsonb_build_object('ok',true,'token',raw,'expiresAt',exp);
end$$;

create or replace function public._telegram_auth_start(r public.channel_inbox)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ch public.telegram_auth_challenges;req uuid;addr text:=(r.payload->>'chatId');loc text;
begin
 select * into ch from public.telegram_auth_challenges where token_hash=r.payload->>'tokenHash'for update;
 if not found or ch.state<>'open'or ch.expires_at<=clock_timestamp()then
  -- A used, cancelled or expired link gets a neutral answer instead of silence (finding 2).
  perform public._telegram_auth_enqueue('telegram.link_expired','hy',addr,r.principal_ref,'{"kind":"remove"}',r.id);
  return public._channel_inbox_finish(r.id,'done','auth:token_invalid');end if;
 update public.telegram_contact_requests set state='superseded'where principal_ref=r.principal_ref and state='open';
 insert into public.telegram_contact_requests(challenge_id,principal_ref,address,expires_at)
 values(ch.id,r.principal_ref,addr,least(ch.expires_at,clock_timestamp()+interval '5 minutes'))returning id into req;
 loc:=case when ch.target_user is null then 'hy'else public._telegram_auth_locale(ch.target_user)end;
 perform public._telegram_auth_enqueue('telegram.share_contact',loc,addr,r.principal_ref,'{"kind":"request_contact"}',r.id);
 return public._channel_inbox_finish(r.id,'done','auth:prompted');
end$$;

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
 -- Staff enrolment has nothing to continue in the app (finding 5).
 perform public._telegram_auth_enqueue(case when ch.purpose='staff_enrol'then 'telegram.staff_contact_ok'else 'telegram.contact_ok'end,loc,addr,r.principal_ref,'{"kind":"remove"}',r.id);
 return public._channel_inbox_finish(r.id,'done','contact:proven');
end$$;
