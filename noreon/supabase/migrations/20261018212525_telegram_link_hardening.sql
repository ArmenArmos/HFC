-- One-tap sign-in links: hardening after the 19 Oct security review (output/security-review-2026-10-19,
-- F-1 and F-3). The 24 h lifetime stays (Khikar's decision).
--  F-1 The 30-day Telegram re-proof rule now holds for links as it does for typed codes: no link is
--      created (trigger), armed (arm), begun (begin) or given a code (the hook's claim, route 'link') for a
--      binding whose proof is older than 30 days. The member gets the page button or plain text and normal
--      sign-in, which asks them to re-prove.
--  F-3 A sign-in that did not start after begin (CAPTCHA, Auth rate limit: the server calls abandon) puts
--      the link back to 'armed' instead of leaving it 'redeeming' for this browser for 24 h.
-- Everything else in these functions is copied unchanged from 20261017131420, 20261018170500 and 20261016182740.

-- F-1: one rule for every place that makes a link (next-step replies, member notices): a lapsed proof
-- gets no link row; the message itself is unaffected.
create function public._telegram_signin_links_proven()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 if not exists(select 1 from public.telegram_auth_bindings b where b.id=new.binding_id and b.proven_at>clock_timestamp()-interval '30 days')then
  return null;end if;
 return new;
end$$;
revoke all on function public._telegram_signin_links_proven()from public,anon,authenticated,service_role;
create trigger telegram_signin_links_proven before insert on public.telegram_signin_links for each row execute function public._telegram_signin_links_proven();

-- F-1: the hook's link route.
create or replace function public.auth_code_request_claim(p_phone text,p_webhook_id text,p_body_hmac text)returns jsonb
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
 -- A one-tap sign-in link's request: the code is not sent anywhere; the hook seals it for the
 -- server that opened the request (route 'link').
 if r.signin_link_id is not null then
  -- The 30-day re-proof rule holds for links too (review F-1, 19 Oct).
  if not exists(select 1 from public.telegram_signin_links l join public.telegram_auth_bindings lb on lb.id=l.binding_id
    where l.id=r.signin_link_id and lb.active and lb.proven_at>clock_timestamp()-interval '30 days')then
   update public.auth_code_requests set state='refused',refusal='reproof_required',webhook_id=p_webhook_id,body_hmac=p_body_hmac,updated_at=clock_timestamp()where id=r.id;
   return jsonb_build_object('ok',false,'code','reproof_required','requestId',r.id);end if;
  if not exists(select 1 from public.telegram_signin_links l where l.id=r.signin_link_id and l.state='redeeming'and l.request_id=r.id and l.expires_at>clock_timestamp())then
   update public.auth_code_requests set state='refused',refusal='link_unavailable',webhook_id=p_webhook_id,body_hmac=p_body_hmac,updated_at=clock_timestamp()where id=r.id;
   return jsonb_build_object('ok',false,'code','link_unavailable','requestId',r.id);end if;
  update public.auth_code_requests set state='sending',webhook_id=p_webhook_id,body_hmac=p_body_hmac,updated_at=clock_timestamp()where id=r.id;
  return jsonb_build_object('ok',true,'replay',false,'requestId',r.id,'route','link');
 end if;
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

-- F-1: arm.
create or replace function public.telegram_signin_link_arm(p_message uuid,p_token_hash text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare l public.telegram_signin_links;m public.telegram_auth_messages;lbl text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into l from public.telegram_signin_links where message_id=p_message for update;
 if not found or l.state<>'pending'then return jsonb_build_object('ok',false,'code','none');end if;
 if not exists(select 1 from public.telegram_auth_bindings b where b.id=l.binding_id and b.active and b.generation=l.binding_generation
   and b.proven_at>clock_timestamp()-interval '30 days')then
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

-- F-1: begin.
create or replace function public.telegram_signin_link_begin(p_token_hash text,p_nonce_hmac text,p_current_user uuid,p_switch boolean)returns jsonb
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
 -- A proof older than 30 days: normal sign-in, which asks the member to re-prove (review F-1).
 if exists(select 1 from public.telegram_auth_bindings b where b.id=l.binding_id and b.proven_at<=clock_timestamp()-interval '30 days')then
  update public.telegram_signin_links set state='cancelled'where id=l.id;
  perform public._telegram_auth_audit(l.auth_user_id,'signin_link.refused',jsonb_build_object('linkId',l.id,'reason','reproof_required'));
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

-- F-3: abandon re-arms a link.
create or replace function public.auth_code_request_abandon(p_request uuid,p_nonce_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare rearmed boolean;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 update public.auth_code_requests set state='unknown',updated_at=clock_timestamp()where id=p_request and nonce_hmac=p_nonce_hmac and state in('issuing','sending','sent');
 if not found then return jsonb_build_object('ok',true,'updated',false);end if;
 -- A one-tap link whose sign-in did not start (CAPTCHA, Auth rate limit) is armed again: single use is kept,
 -- since a link is used only after verifyOtp (review F-3, 19 Oct).
 -- Newest wins, as in arm: when a newer link was armed meanwhile, this one is cancelled instead (review R314-1).
 update public.telegram_signin_links l set state='armed',redeem_nonce_hmac=null,request_id=null
  where l.request_id=p_request and l.redeem_nonce_hmac=p_nonce_hmac and l.state='redeeming'and l.expires_at>clock_timestamp()
   and not exists(select 1 from public.telegram_signin_links n where n.auth_user_id=l.auth_user_id and n.state='armed'and n.id<>l.id);
 rearmed:=found;
 if not rearmed then
  update public.telegram_signin_links set state='cancelled',redeem_nonce_hmac=null,request_id=null
   where request_id=p_request and redeem_nonce_hmac=p_nonce_hmac and state='redeeming';
 end if;
 return jsonb_build_object('ok',true,'updated',true,'rearmed',rearmed);
end$$;
