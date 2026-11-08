-- One-tap sign-in rides on the "Open Noreon" button (Khikar, 18 Oct 2026). Changes to 20261017131420:
--  * The link is no longer a line of text: the sender puts it on the message's inline button. A
--    message without a button gets the approved member "Open Noreon" button; a message with another
--    keyboard (share contact, remove) or without an approved label gets no link at all.
--  * Valid 24 hours from send instead of 10 minutes (product decision, Khikar). Everything else is
--    unchanged: single use, one browser, only the token's sha256 stored, bound to the member, the
--    chat's binding and its generation, revoked with the binding, at most 5 per member per hour.
--  * An expired, used or refused link still answers "expired", now with its step when the link is
--    known, so the page can send the member to normal sign-in and on to the same page afterwards.
--  * What the 24 h window needs on top (Fable review of #274, 18 Oct):
--    F-1 begin takes the member signed in on the opening browser: the same member uses the link up
--        without a second sign-in; another member is never swapped out silently (other_account,
--        link untouched) unless the person confirmed the switch.
--    F-2 one live link per member (arming a new one cancels the older armed ones); sign-out and a
--        revoked binding cancel every armed or redeeming link (telegram_signin_links_cancel).
--  * Deploy window: the two-argument begin is replaced, so an app from before this migration gets
--    "unavailable" on a link (the member signs in normally) until the new app is live.

-- Internal: cancel a member's live links (armed or mid-redeem), audited. Returns how many.
create function public._telegram_signin_links_cancel(p_user uuid,p_reason text)returns integer
language plpgsql security definer set search_path=''as $$
declare n integer;
begin
 update public.telegram_signin_links set state='cancelled'where auth_user_id=p_user and state in('armed','redeeming');
 get diagnostics n=row_count;
 if n>0 then perform public._telegram_auth_audit(p_user,'signin_link.cancelled',jsonb_build_object('reason',p_reason,'links',n));end if;
 return n;
end$$;
revoke all on function public._telegram_signin_links_cancel(uuid,text)from public,anon,authenticated,service_role;

-- Server, on member sign-out: the member's links in Telegram stop working.
create function public.telegram_signin_links_cancel(p_user uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_user is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 return jsonb_build_object('ok',true,'cancelled',public._telegram_signin_links_cancel(p_user,'sign_out'));
end$$;
revoke all on function public.telegram_signin_links_cancel(uuid)from public,anon,authenticated,service_role;
grant execute on function public.telegram_signin_links_cancel(uuid)to service_role;

create or replace function public.telegram_signin_link_arm(p_message uuid,p_token_hash text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare l public.telegram_signin_links;m public.telegram_auth_messages;lbl text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into l from public.telegram_signin_links where message_id=p_message for update;
 if not found or l.state<>'pending'then return jsonb_build_object('ok',false,'code','none');end if;
 if not exists(select 1 from public.telegram_auth_bindings b where b.id=l.binding_id and b.active and b.generation=l.binding_generation)then
  update public.telegram_signin_links set state='cancelled'where id=l.id;return jsonb_build_object('ok',false,'code','none');end if;
 -- The link travels only on an inline button: the message's own open_url button, or the approved
 -- member "Open Noreon" label for a message that has none.
 select * into m from public.telegram_auth_messages where id=p_message;
 if m.keyboard is null then
  select body into lbl from public.system_message_templates where template_id='member_notice.open_label'and locale=m.locale and approved order by version desc limit 1;
 end if;
 if not(m.keyboard->>'kind'is not distinct from 'open_url'or lbl is not null)then
  update public.telegram_signin_links set state='cancelled'where id=l.id;return jsonb_build_object('ok',false,'code','none');end if;
 -- Newest wins: the member's older armed links stop working (one in the middle of a redeem is left alone).
 update public.telegram_signin_links set state='cancelled'where auth_user_id=l.auth_user_id and state='armed'and id<>l.id;
 update public.telegram_signin_links set token_hash=p_token_hash,state='armed',armed_at=clock_timestamp(),expires_at=clock_timestamp()+interval '24 hours'where id=l.id;
 perform public._telegram_auth_audit(l.auth_user_id,'signin_link.armed',jsonb_build_object('linkId',l.id,'step',l.step));
 return jsonb_strip_nulls(jsonb_build_object('ok',true,'step',l.step,'label',lbl));
end$$;

-- As 20261017131420, plus the step on a refusal of a known link (the page continues there after sign-in),
-- and the member signed in on the opening browser (p_current_user, read by the server; null when none).
drop function public.telegram_signin_link_begin(text,text);
create function public.telegram_signin_link_begin(p_token_hash text,p_nonce_hmac text,p_current_user uuid,p_switch boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare l public.telegram_signin_links;ph text;rid uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$'or coalesce(p_nonce_hmac,'')!~'^[a-f0-9]{64}$'then return jsonb_build_object('ok',false,'code','expired');end if;
 select * into l from public.telegram_signin_links where token_hash=p_token_hash for update;
 if not found then return jsonb_build_object('ok',false,'code','expired');end if;
 -- A retry from the same browser may continue; anything else on a used link is "expired".
 if not(l.state='armed'or(l.state='redeeming'and l.redeem_nonce_hmac=p_nonce_hmac))or l.expires_at<=clock_timestamp()then
  if l.state in('armed','redeeming')and l.expires_at<=clock_timestamp()then update public.telegram_signin_links set state='expired'where id=l.id;end if;
  perform public._telegram_auth_audit(l.auth_user_id,'signin_link.refused',jsonb_build_object('linkId',l.id,'state',l.state));
  return jsonb_build_object('ok',false,'code','expired','step',l.step);end if;
 if not exists(select 1 from public.telegram_auth_bindings b where b.id=l.binding_id and b.active and b.generation=l.binding_generation and b.principal_ref=l.principal_ref)
  or exists(select 1 from public.workspace_staff where user_id=l.auth_user_id)or exists(select 1 from public.clinic_portal_memberships where user_id=l.auth_user_id)then
  update public.telegram_signin_links set state='cancelled'where id=l.id;
  perform public._telegram_auth_audit(l.auth_user_id,'signin_link.refused',jsonb_build_object('linkId',l.id,'reason','binding_or_role'));
  return jsonb_build_object('ok',false,'code','expired','step',l.step);end if;
 select phone into ph from auth.users where id=l.auth_user_id and phone_confirmed_at is not null and(banned_until is null or banned_until<=clock_timestamp());
 if ph is null then return jsonb_build_object('ok',false,'code','expired','step',l.step);end if;
 -- Already signed in as this member here: the link is used up, no second sign-in.
 if p_current_user=l.auth_user_id then
  update public.telegram_signin_links set state='used',used_at=clock_timestamp()where id=l.id;
  if l.request_id is not null then update public.auth_code_requests set state='cancelled',updated_at=clock_timestamp()where id=l.request_id and state not in('verified');end if;
  perform public._telegram_auth_audit(l.auth_user_id,'signin_link.used',jsonb_build_object('linkId',l.id,'step',l.step,'alreadySignedIn',true));
  return jsonb_build_object('ok',true,'signedIn',true,'step',l.step);
 end if;
 -- Another member is signed in here: never swap silently; the link stays as it is until the person confirms.
 if p_current_user is not null and p_switch is not true then
  perform public._telegram_auth_audit(l.auth_user_id,'signin_link.refused',jsonb_build_object('linkId',l.id,'reason','other_account'));
  return jsonb_build_object('ok',false,'code','other_account','step',l.step);
 end if;
 ph:='+'||ltrim(ph,'+');
 perform pg_advisory_xact_lock(hashtextextended('tg-auth-code:'||ph,0));
 if exists(select 1 from public.auth_code_requests where phone=ph and state in('issuing','sending')and lease_until>clock_timestamp())then
  return jsonb_build_object('ok',false,'code','busy');end if;
 update public.auth_code_requests set state='unknown',updated_at=clock_timestamp()where phone=ph and state in('issuing','sending');
 if l.request_id is not null then update public.auth_code_requests set state='cancelled',updated_at=clock_timestamp()where id=l.request_id and state not in('verified');end if;
 update public.auth_code_requests set code_sealed=null where code_sealed is not null and updated_at<clock_timestamp()-interval '2 minutes';
 insert into public.auth_code_requests(phone,nonce_hmac,lease_until,signin_link_id)values(ph,p_nonce_hmac,clock_timestamp()+interval '15 seconds',l.id)returning id into rid;
 update public.telegram_signin_links set state='redeeming',redeem_nonce_hmac=p_nonce_hmac,request_id=rid where id=l.id;
 return jsonb_build_object('ok',true,'requestId',rid,'phone',ph,'step',l.step);
end$$;
revoke all on function public.telegram_signin_link_begin(text,text,uuid,boolean)from public,anon,authenticated,service_role;
grant execute on function public.telegram_signin_link_begin(text,text,uuid,boolean)to service_role;

-- As 20261016182740 (unchanged otherwise), plus: a revoked binding cancels the member's live links.
create or replace function public._telegram_revoke_binding(p_binding uuid,p_reason text)returns jsonb
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
 -- One-tap sign-in links of this member stop working (review F-2).
 perform public._telegram_signin_links_cancel(b.auth_user_id,'binding_revoked');
 perform public._telegram_auth_audit(b.auth_user_id,'binding.revoked',jsonb_build_object('bindingId',b.id,'reason',p_reason,'sessions',n));
 return jsonb_build_object('ok',true,'revoked',true,'sessions',n);
end$$;
