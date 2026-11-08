-- A returning sign-in browser may arrive before the inbox sweep handles its contact.
-- Read-only: this does not open an OTP request or consume a proof.
create function public.auth_code_request_proof_state(p_phone text,p_nonce_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_phone,'')!~'^\+[1-9][0-9]{6,14}$'or coalesce(p_nonce_hmac,'')!~'^[a-f0-9]{64}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 -- Keep the same usable-proof predicate as auth_code_request_claim.
 if exists(select 1 from public.telegram_phone_proofs pf
  where pf.phone=p_phone and pf.nonce_hmac=p_nonce_hmac and pf.consumed_at is null and pf.cancelled_at is null and pf.expires_at>clock_timestamp()
  and not exists(select 1 from public.telegram_auth_bindings b where b.principal_ref=pf.principal_ref and b.active and b.phone<>p_phone))then
  return jsonb_build_object('ok',true,'state','ready');
 end if;
 if exists(select 1 from public.telegram_contact_requests r
  join public.telegram_auth_challenges c on c.id=r.challenge_id
  where r.state='open'and r.expires_at>clock_timestamp()
  and c.state='open'and c.purpose='member_signin'and c.expires_at>clock_timestamp()
  and c.target_phone=p_phone and c.nonce_hmac=p_nonce_hmac
  and exists(select 1 from public.channel_inbox i where i.principal_ref=r.principal_ref
   and i.kind='contact'and i.received_at>r.requested_at and i.status in('received','processing')))then
  return jsonb_build_object('ok',true,'state','pending');
 end if;
 return jsonb_build_object('ok',true,'state','none');
end$$;
revoke all on function public.auth_code_request_proof_state(text,text)from public,anon,authenticated;
grant execute on function public.auth_code_request_proof_state(text,text)to service_role;
