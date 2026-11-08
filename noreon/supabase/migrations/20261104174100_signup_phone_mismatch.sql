-- Explain a refused contact only to the browser holding this exact sign-in challenge.
-- Stamp 20261104174100 from the integrator (QA 284).
create or replace function public.auth_code_request_link_open(p_phone text,p_nonce_hmac text,p_token_hash text)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare ch public.telegram_auth_challenges;req public.telegram_contact_requests;result jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_phone,'')!~'^\+[1-9][0-9]{6,14}$'or coalesce(p_nonce_hmac,'')!~'^[a-f0-9]{64}$'or coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$'then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into ch from public.telegram_auth_challenges c where c.token_hash=p_token_hash
  and c.purpose='member_signin'and c.target_phone=p_phone and c.nonce_hmac=p_nonce_hmac;
 if not found then return jsonb_build_object('ok',true,'open',false);end if;
 result:=jsonb_build_object('ok',true,'open',ch.state='open'and ch.expires_at>clock_timestamp()+interval '2 minutes');
 -- Read the latest attempt for this challenge, not another tab's challenge for the same phone.
 select * into req from public.telegram_contact_requests r where r.challenge_id=ch.id order by r.requested_at desc,r.id desc limit 1;
 if req.state='refused'and req.refusal in('phone_mismatch','not_own_contact','stale')then
  result:=result||jsonb_build_object('contactRefusal',req.refusal);
 end if;
 return result;
end$$;
revoke all on function public.auth_code_request_link_open(text,text,text)from public,anon,authenticated;
grant execute on function public.auth_code_request_link_open(text,text,text)to service_role;
