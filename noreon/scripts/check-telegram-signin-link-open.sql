-- The exact bot link a sign-in page shows is kept only while it is open (Khikar, 4 Nov; review R1). Rolled back.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'FAIL: %',label;end if;
end$$;
create function pg_temp.open(phone text,nonce text,token text)returns boolean language sql as $$
 select (public.auth_code_request_link_open(phone,nonce,encode(sha256(convert_to(token,'UTF8')),'hex'))->>'open')::boolean
$$;
-- Two tabs of one browser: A's link was used by a refused contact, B's is still open.
insert into public.telegram_auth_challenges(token_hash,purpose,target_phone,nonce_hmac,state,expires_at)values
 (encode(sha256(convert_to(repeat('A',32),'UTF8')),'hex'),'member_signin','+37499014993',repeat('e',64),'consumed',clock_timestamp()+interval '10 minutes'),
 (encode(sha256(convert_to(repeat('B',32),'UTF8')),'hex'),'member_signin','+37499014993',repeat('e',64),'open',clock_timestamp()+interval '10 minutes'),
 (encode(sha256(convert_to(repeat('C',32),'UTF8')),'hex'),'member_signin','+37499014993',repeat('e',64),'open',clock_timestamp()+interval '90 seconds');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select pg_temp.ok(pg_temp.open('+37499014993',repeat('e',64),repeat('B',32)),'The shown link, open with time left, is kept');
select pg_temp.ok(not pg_temp.open('+37499014993',repeat('e',64),repeat('A',32)),'A used link is not kept even while another tab''s link is open');
select pg_temp.ok(not pg_temp.open('+37499014993',repeat('e',64),repeat('C',32)),'A link with under two minutes left is not kept');
select pg_temp.ok(not pg_temp.open('+37499014993',repeat('f',64),repeat('B',32)),'Another browser (cookie nonce changed) does not keep it');
select pg_temp.ok(not pg_temp.open('+37499014994',repeat('e',64),repeat('B',32)),'Another phone does not keep it');
select pg_temp.ok(not pg_temp.open('+37499014993',repeat('e',64),repeat('Z',32)),'An unknown link is not kept');
select pg_temp.ok(public.auth_code_request_link_open('+37499014993',repeat('e',64),'short')->>'code'='invalid','A malformed hash is refused');
reset role;
select pg_temp.ok(not has_function_privilege('anon','public.auth_code_request_link_open(text,text,text)','execute')
 and not has_function_privilege('authenticated','public.auth_code_request_link_open(text,text,text)','execute')
 and has_function_privilege('service_role','public.auth_code_request_link_open(text,text,text)','execute'),'Service-only execute');
rollback;
\echo telegram sign-in link open: passed
