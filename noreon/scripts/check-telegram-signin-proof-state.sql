-- Synthetic contact queue race; run after migrations in an isolated database.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'FAIL: %',label;end if;
end$$;
create function pg_temp.proof_state()returns text language sql as $$
 select public.auth_code_request_proof_state('+37499014991',repeat('a',64))->>'state'
$$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select pg_temp.ok(pg_temp.proof_state()='none','No contact or proof is none');
select pg_temp.ok(public.auth_code_request_proof_state('bad',repeat('a',64))->>'code'='invalid','Invalid phone refused');
select pg_temp.ok(public.auth_code_request_proof_state('+37499014991','bad')->>'code'='invalid','Invalid nonce refused');
reset role;
insert into public.telegram_auth_challenges(id,token_hash,purpose,target_phone,nonce_hmac,expires_at)values
 ('d1490000-0000-4000-8000-000000000001',repeat('c',64),'member_signin','+37499014991',repeat('a',64),clock_timestamp()+interval '10 minutes');
insert into public.telegram_contact_requests(id,challenge_id,principal_ref,address,expires_at)values
 ('d1490000-0000-4000-8000-000000000002','d1490000-0000-4000-8000-000000000001','["telegram","synthetic_proof",9004,"user",7491]','7491',clock_timestamp()+interval '10 minutes');
set local role service_role;
select pg_temp.ok(pg_temp.proof_state()='none','Open request without an incoming contact is none');
reset role;
insert into public.channel_inbox(id,adapter,event_id,fingerprint,principal_ref,kind,payload)values
 ('d1490000-0000-4000-8000-000000000003','telegram','synthetic-proof-contact','fp-proof-contact','["telegram","synthetic_proof",9004,"user",7491]','contact','{}');
set local role service_role;
select pg_temp.ok(pg_temp.proof_state()='pending','Queued contact from the requested principal is pending');
select pg_temp.ok(public.auth_code_request_proof_state('+37499014991',repeat('b',64))->>'state'='none','Another browser cannot see pending');
reset role;
update public.channel_inbox set status='processing'where id='d1490000-0000-4000-8000-000000000003';
set local role service_role;
select pg_temp.ok(pg_temp.proof_state()='pending','Processing contact is pending');
reset role;
update public.channel_inbox set status='done'where id='d1490000-0000-4000-8000-000000000003';
set local role service_role;
select pg_temp.ok(pg_temp.proof_state()='none','Done contact without a proof is none');
reset role;
update public.channel_inbox set status='received',principal_ref='another-principal'where id='d1490000-0000-4000-8000-000000000003';
set local role service_role;
select pg_temp.ok(pg_temp.proof_state()='none','Another principal does not count');
reset role;
update public.channel_inbox set principal_ref='["telegram","synthetic_proof",9004,"user",7491]',received_at=clock_timestamp()-interval '1 day'where id='d1490000-0000-4000-8000-000000000003';
set local role service_role;
select pg_temp.ok(pg_temp.proof_state()='none','Old contact before request does not count');
reset role;
update public.channel_inbox set received_at=clock_timestamp(),kind='text'where id='d1490000-0000-4000-8000-000000000003';
set local role service_role;
select pg_temp.ok(pg_temp.proof_state()='none','Non-contact inbox event does not count');
reset role;
update public.channel_inbox set kind='contact'where id='d1490000-0000-4000-8000-000000000003';
update public.telegram_contact_requests set expires_at=clock_timestamp()-interval '1 second'where id='d1490000-0000-4000-8000-000000000002';
set local role service_role;
select pg_temp.ok(pg_temp.proof_state()='none','Expired request does not count');
reset role;
update public.telegram_contact_requests set expires_at=clock_timestamp()+interval '10 minutes'where id='d1490000-0000-4000-8000-000000000002';
update public.telegram_auth_challenges set state='consumed'where id='d1490000-0000-4000-8000-000000000001';
set local role service_role;
select pg_temp.ok(pg_temp.proof_state()='none','Closed challenge does not count');
reset role;
-- Proof wins even when the inbox still looks pending; consuming closes the challenge.
insert into public.telegram_phone_proofs(challenge_id,phone,principal_ref,account_ref,address,nonce_hmac,expires_at)values
 ('d1490000-0000-4000-8000-000000000001','+37499014991','["telegram","synthetic_proof",9004,"user",7491]','["synthetic_proof",9004]','7491',repeat('a',64),clock_timestamp()+interval '10 minutes');
set local role service_role;
select pg_temp.ok(pg_temp.proof_state()='ready','Usable proof is ready');
select pg_temp.ok(public.auth_code_request_proof_state('+37499014991',repeat('b',64))->>'state'='none','Another browser cannot use the proof');
reset role;
update public.telegram_phone_proofs set consumed_at=clock_timestamp()where challenge_id='d1490000-0000-4000-8000-000000000001';
set local role service_role;
select pg_temp.ok(pg_temp.proof_state()='none','Consumed proof is not ready');
reset role;
update public.telegram_phone_proofs set consumed_at=null,cancelled_at=clock_timestamp()where challenge_id='d1490000-0000-4000-8000-000000000001';
set local role service_role;
select pg_temp.ok(pg_temp.proof_state()='none','Cancelled proof is not ready');
reset role;
update public.telegram_phone_proofs set cancelled_at=null,expires_at=clock_timestamp()-interval '1 second'where challenge_id='d1490000-0000-4000-8000-000000000001';
set local role service_role;
select pg_temp.ok(pg_temp.proof_state()='none','Expired proof is not ready');
reset role;
select pg_temp.ok(not has_function_privilege('anon','public.auth_code_request_proof_state(text,text)','execute')
 and not has_function_privilege('authenticated','public.auth_code_request_proof_state(text,text)','execute')
 and has_function_privilege('service_role','public.auth_code_request_proof_state(text,text)','execute'),'Service-only execute');
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
set local role authenticated;
do $$begin
 perform public.auth_code_request_proof_state('+37499014991',repeat('a',64));
 raise exception 'Authenticated executed proof state';
exception when insufficient_privilege then null;
end$$;
reset role;
rollback;
\echo 'check-telegram-signin-proof-state: ok'
