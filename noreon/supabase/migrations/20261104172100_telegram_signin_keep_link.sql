-- Each return from the bot asked for a code again, and each refusal made a new bot link, using up the browser's
-- 10 links per hour (Khikar, 4 Nov). The page now sends back the link it shows; the server keeps that exact link
-- when it is still open for this phone and this browser with at least two minutes left (review R1: one browser can
-- hold several links in several tabs). auth_code_request_proof_state is unchanged. Read-only.
create function public.auth_code_request_link_open(p_phone text,p_nonce_hmac text,p_token_hash text)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_phone,'')!~'^\+[1-9][0-9]{6,14}$'or coalesce(p_nonce_hmac,'')!~'^[a-f0-9]{64}$'or coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$'then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 return jsonb_build_object('ok',true,'open',exists(select 1 from public.telegram_auth_challenges c where c.token_hash=p_token_hash
  and c.purpose='member_signin'and c.target_phone=p_phone and c.nonce_hmac=p_nonce_hmac and c.state='open'and c.expires_at>clock_timestamp()+interval '2 minutes'));
end$$;
revoke all on function public.auth_code_request_link_open(text,text,text)from public,anon,authenticated;
grant execute on function public.auth_code_request_link_open(text,text,text)to service_role;
