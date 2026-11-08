-- T-auth B-2b-2: clinic invitations by Telegram, rolled back.
-- Synthetic fixtures only; no Telegram, Supabase Auth API, network or provider.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_staff(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_staff",9005,"user",%s]',u)$$;
create function pg_temp.h(v text)returns text language sql as $$select encode(sha256(convert_to(v,'UTF8')),'hex')$$;
create function pg_temp.event(id text,kind text,u bigint,payload jsonb)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_staff",9005,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind',kind,'payload',payload||jsonb_build_object('chatId',u,'messageId',id::bigint))
$$;
create function pg_temp.now_s()returns bigint language sql as $$select ceil(extract(epoch from clock_timestamp()))::bigint$$;
create function pg_temp.drain()returns void language plpgsql as $$declare i jsonb;begin
 for i in select jsonb_array_elements(public.channel_inbox_next(50))loop perform public.channel_inbox_process((i#>>'{}')::uuid);end loop;end$$;
create function pg_temp.prove(token text,u bigint,phone text,ev integer)returns void language plpgsql as $$begin
 perform public.channel_inbox_commit(pg_temp.event(ev::text,'link',u,jsonb_build_object('tokenHash',pg_temp.h(token))));perform pg_temp.drain();
 perform public.channel_inbox_commit(pg_temp.event((ev+1)::text,'contact',u,jsonb_build_object('phone',phone,'sentAt',pg_temp.now_s())));perform pg_temp.drain();
end$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;
create function pg_temp.kv(key text)returns jsonb language sql as $$select v from kv where k=key$$;


create function pg_temp.as_admin(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid,'exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true);end$$;

-- Fixtures: an admin, a doctor, an active clinic, sessions, the bot.
insert into auth.users(id,email)values('d1600000-0000-4000-8000-000000000001','admin.synthetic@example.invalid'),('d1600000-0000-4000-8000-000000000002','doctor.synthetic@example.invalid');
insert into public.workspace_clinics(id,name)values('d1600000-0000-4000-8000-000000000004','Synthetic invite clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d1600000-0000-4000-8000-000000000001','admin','Synthetic admin',null),('d1600000-0000-4000-8000-000000000002','doctor','Dr Synthetic','d1600000-0000-4000-8000-000000000004');
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1600000-0000-4000-8000-000000000011','d1600000-0000-4000-8000-000000000001',now(),now()),('d1600000-0000-4000-8000-000000000012','d1600000-0000-4000-8000-000000000002',now(),now());
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_staff',9005,600,'consent-s');

-- 1. Only a global admin reserves; one open invitation per new email.
select pg_temp.as_admin('d1600000-0000-4000-8000-000000000002','d1600000-0000-4000-8000-000000000012');set local role authenticated;
do $$begin perform public.clinic_invitation_reserve(gen_random_uuid(),'d1600000-0000-4000-8000-000000000004','x@example.invalid','X','+37499000001');raise exception 'doctor reserved';exception when insufficient_privilege then null;end$$;
reset role;
select pg_temp.as_admin('d1600000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000011');set local role authenticated;
insert into kv values('r1',public.clinic_invitation_reserve('d1600000-0000-4000-8000-000000000101','d1600000-0000-4000-8000-000000000004',' Clinic.User@Example.invalid ','Clinic User Synthetic','+37499016140'));
select pg_temp.ok(pg_temp.kv('r1')->>'ok'='true'and pg_temp.kv('r1')#>>'{invitation,email}'='clinic.user@example.invalid'and pg_temp.kv('r1')#>>'{invitation,status}'='pending','Admin reserves an invitation');
select pg_temp.ok(public.clinic_invitation_reserve('d1600000-0000-4000-8000-000000000101','d1600000-0000-4000-8000-000000000004','clinic.user@example.invalid','Clinic User Synthetic','+37499016140')#>>'{invitation,id}'=pg_temp.kv('r1')#>>'{invitation,id}','Same request is idempotent');
select pg_temp.ok(public.clinic_invitation_reserve(gen_random_uuid(),'d1600000-0000-4000-8000-000000000004','clinic.user@example.invalid','Other','+37499016141')->>'code'='email_in_use','Second open invitation for the email refused');
select pg_temp.ok(public.clinic_invitation_reserve(gen_random_uuid(),'d1600000-0000-4000-8000-000000000004','doctor.synthetic@example.invalid','Other','+37499016141')->>'code'='email_in_use','Existing account email refused');
select pg_temp.ok(public.clinic_invitation_reserve(gen_random_uuid(),'d1600000-0000-4000-8000-000000000004','new@example.invalid','Other','37499')->>'code'='invalid','Bad phone refused');
select pg_temp.ok(jsonb_array_length(public.clinic_invitations_list('d1600000-0000-4000-8000-000000000004'))=1,'List shows the open invitation');
reset role;

-- 2. The service binds only a brand-new account for exactly this email.
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.clinic_invitation_telegram_issue((pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1,'d1600000-0000-4000-8000-000000000002')->>'code'='account_unavailable','Another account cannot be bound');
select pg_temp.ok(public.clinic_invitation_account((pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1)->>'authUserId'is null,'No account yet');
reset role;
-- Like GoTrue v2.196+, a user created without a password gets a random hash (QA C-01).
insert into auth.users(id,email,email_confirmed_at,created_at,updated_at,encrypted_password)values('d1600000-0000-4000-8000-000000000040','clinic.user@example.invalid',now(),clock_timestamp(),clock_timestamp()-interval '1 hour','$2a$10$randomgotruehashrandomgotruehashrandomgotruehashxx');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.clinic_invitation_account((pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1)->>'authUserId'='d1600000-0000-4000-8000-000000000040','Retry finds the created account');
insert into kv values('t1',public.clinic_invitation_telegram_issue((pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1,'d1600000-0000-4000-8000-000000000040'));
select pg_temp.ok(pg_temp.kv('t1')->>'ok'='true'and length(pg_temp.kv('t1')->>'token')=32,'Bot link issued');
-- No proof yet; a wrong start token is never accepted.
select pg_temp.ok(public.clinic_invite_code_begin((pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1,pg_temp.h(pg_temp.kv('t1')->>'token'),repeat('a',64),repeat('1',64))->>'code'='not_proven','Code needs the phone proof');
select pg_temp.ok(public.clinic_invite_code_begin((pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1,pg_temp.h('wrong'),repeat('a',64),repeat('1',64))->>'code'='invitation_unavailable','Code needs this link');
-- Wrong phone shared: refused, link consumed, no binding.
select pg_temp.prove(pg_temp.kv('t1')->>'token',7340,'+37499000999',300);
reset role;
select pg_temp.ok(not exists(select 1 from public.telegram_auth_bindings where auth_user_id='d1600000-0000-4000-8000-000000000040'),'Wrong phone creates no binding');
select pg_temp.as_service();set local role service_role;
delete from kv where k='t1';
insert into kv values('t1',public.clinic_invitation_telegram_issue((pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1,'d1600000-0000-4000-8000-000000000040'));
select pg_temp.prove(pg_temp.kv('t1')->>'token',7340,'+37499016140',310);
reset role;
select pg_temp.ok((select not active and kind='staff'and pending_clinic_invitation_id=(pg_temp.kv('r1')#>>'{invitation,id}')::uuid from public.telegram_auth_bindings where auth_user_id='d1600000-0000-4000-8000-000000000040'),'Proof creates a pending binding only');
select pg_temp.as_service();set local role service_role;

-- 3. Code, then password, then finalize.
insert into kv values('c1',public.clinic_invite_code_begin((pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1,pg_temp.h(pg_temp.kv('t1')->>'token'),repeat('a',64),repeat('1',64)));
select pg_temp.ok(pg_temp.kv('c1')->>'address'='7340','Code goes to the proven chat');
select pg_temp.ok(public.clinic_invite_code_verify((pg_temp.kv('c1')->>'challengeId')::uuid,(pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1,repeat('a',64),repeat('2',64))->>'code'='wrong_code','Wrong code refused');
select pg_temp.ok(public.clinic_invite_code_verify((pg_temp.kv('c1')->>'challengeId')::uuid,(pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1,repeat('b',64),repeat('1',64))->>'code'='unknown_challenge','Another browser nonce refused');
select pg_temp.ok(public.clinic_invitation_finalize((pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1,repeat('a',64))->>'code'='verification_expired','No finalize before the code');
select pg_temp.ok(public.clinic_invite_code_verify((pg_temp.kv('c1')->>'challengeId')::uuid,(pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1,repeat('a',64),repeat('1',64))->>'authUserId'='d1600000-0000-4000-8000-000000000040','Right code verifies');
select pg_temp.ok(public.clinic_invitation_finalize((pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1,repeat('a',64))->>'code'='password_required','No membership before the password');
reset role;
update auth.users set encrypted_password='synthetic-hash',updated_at=clock_timestamp()where id='d1600000-0000-4000-8000-000000000040';
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1600000-0000-4000-8000-000000000049','d1600000-0000-4000-8000-000000000040',now(),now());
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.clinic_invitation_finalize((pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1,repeat('c',64))->>'code'='verification_expired','Finalize needs the verifying browser');
select pg_temp.ok(public.clinic_invitation_finalize((pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1,repeat('a',64))->>'ok'='true','Finalize');
select pg_temp.ok(public.clinic_invitation_finalize((pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1,repeat('a',64))->>'ok'='true','Finalize is idempotent');
reset role;
select pg_temp.ok(not exists(select 1 from auth.sessions where id='d1600000-0000-4000-8000-000000000049'),'Sessions opened before finalize are ended');
select pg_temp.ok((select active and clinic_id='d1600000-0000-4000-8000-000000000004'from public.clinic_portal_memberships where user_id='d1600000-0000-4000-8000-000000000040'),'Membership active');
select pg_temp.ok((select active and pending_clinic_invitation_id is null from public.telegram_auth_bindings where auth_user_id='d1600000-0000-4000-8000-000000000040'),'Binding active');
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1600000-0000-4000-8000-000000000041','d1600000-0000-4000-8000-000000000040',now(),now());
select pg_temp.ok((public._clinic_portal_live('d1600000-0000-4000-8000-000000000004','d1600000-0000-4000-8000-000000000040','d1600000-0000-4000-8000-000000000041','[{"method":"password"}]',clock_timestamp()+interval '1 hour')).user_id='d1600000-0000-4000-8000-000000000040','New clinic user passes the clinic guard');
select pg_temp.as_admin('d1600000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.clinic_invitation_reissue((pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1,'+37499016140')->>'code'='accepted','Accepted invitation cannot be reissued');
select pg_temp.ok(jsonb_array_length(public.clinic_invitations_list('d1600000-0000-4000-8000-000000000004'))=0,'Accepted invitation leaves the open list');

-- 4. Reissue retires the old link, codes and pending binding; revoke stops everything.
insert into kv values('r2',public.clinic_invitation_reserve(gen_random_uuid(),'d1600000-0000-4000-8000-000000000004','second.user@example.invalid','Second User Synthetic','+37499016150'));
reset role;
insert into auth.users(id,email,email_confirmed_at,created_at)values('d1600000-0000-4000-8000-000000000050','second.user@example.invalid',now(),clock_timestamp());
select pg_temp.as_service();set local role service_role;
insert into kv values('t2',public.clinic_invitation_telegram_issue((pg_temp.kv('r2')#>>'{invitation,id}')::uuid,1,'d1600000-0000-4000-8000-000000000050'));
select pg_temp.prove(pg_temp.kv('t2')->>'token',7350,'+37499016150',320);
reset role;
select pg_temp.as_admin('d1600000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000011');set local role authenticated;
reset role;
update auth.users set encrypted_password='wrong-person-hash'where id='d1600000-0000-4000-8000-000000000050';
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1600000-0000-4000-8000-000000000059','d1600000-0000-4000-8000-000000000050',now(),now());
select pg_temp.as_admin('d1600000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.clinic_invitation_reissue((pg_temp.kv('r2')#>>'{invitation,id}')::uuid,2,'+37499016151')->>'code'='changed','Reissue is generation fenced');
select pg_temp.ok(public.clinic_invitation_reissue((pg_temp.kv('r2')#>>'{invitation,id}')::uuid,1,'+37499016151')#>>'{invitation,generation}'='2','Reissue to a corrected phone');
reset role;
select pg_temp.ok(not exists(select 1 from public.telegram_auth_bindings where auth_user_id='d1600000-0000-4000-8000-000000000050'and revoked_at is null),'Reissue retires the pending binding');
select pg_temp.ok(not exists(select 1 from auth.sessions where user_id='d1600000-0000-4000-8000-000000000050')and(select nullif(encrypted_password,'')is null from auth.users where id='d1600000-0000-4000-8000-000000000050'),'Reissue clears the unfinished password and sessions');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.clinic_invite_code_begin((pg_temp.kv('r2')#>>'{invitation,id}')::uuid,1,pg_temp.h(pg_temp.kv('t2')->>'token'),repeat('a',64),repeat('1',64))->>'code'='invitation_unavailable','Old generation cannot ask for codes');
insert into kv values('t3',public.clinic_invitation_telegram_issue((pg_temp.kv('r2')#>>'{invitation,id}')::uuid,2,'d1600000-0000-4000-8000-000000000050'));
select pg_temp.prove(pg_temp.kv('t3')->>'token',7350,'+37499016151',330);
reset role;
select pg_temp.as_admin('d1600000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.clinic_invitation_revoke((pg_temp.kv('r2')#>>'{invitation,id}')::uuid,2)#>>'{invitation,status}'='revoked','Revoke');
reset role;
select pg_temp.ok(not exists(select 1 from public.telegram_auth_bindings where auth_user_id='d1600000-0000-4000-8000-000000000050'and revoked_at is null),'Revoke retires the pending binding');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.clinic_invite_code_begin((pg_temp.kv('r2')#>>'{invitation,id}')::uuid,2,pg_temp.h(pg_temp.kv('t3')->>'token'),repeat('a',64),repeat('1',64))->>'code'='invitation_unavailable','Revoked invitation cannot ask for codes');
reset role;

-- A staff invitation cannot take an email with an open clinic invitation.
select pg_temp.as_admin('d1600000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000011');set local role authenticated;
insert into kv values('r3',public.clinic_invitation_reserve(gen_random_uuid(),'d1600000-0000-4000-8000-000000000004','third.user@example.invalid','Third User Synthetic','+37499016160'));
select pg_temp.ok(public.clinic_invitation_reserve('d1600000-0000-4000-8000-000000000101','d1600000-0000-4000-8000-000000000004','clinic.user@example.invalid','Clinic User Synthetic','+37499016199')->>'code'='conflict','Replay with another phone is a conflict');
reset role;
do $$begin insert into public.real_staff_invitations(email,display_name,clinic_id,issuer_id,role)values('third.user@example.invalid','X','d1600000-0000-4000-8000-000000000004','d1600000-0000-4000-8000-000000000001','doctor');raise exception 'staff invitation took the email';exception when unique_violation then null;end$$;
-- A removed issuer's open invitation stops working.
insert into auth.users(id,email,email_confirmed_at,created_at)values('d1600000-0000-4000-8000-000000000060','third.user@example.invalid',now(),clock_timestamp());
select pg_temp.as_service();set local role service_role;
insert into kv values('t4',public.clinic_invitation_telegram_issue((pg_temp.kv('r3')#>>'{invitation,id}')::uuid,1,'d1600000-0000-4000-8000-000000000060'));
select pg_temp.prove(pg_temp.kv('t4')->>'token',7360,'+37499016160',340);
reset role;
update public.workspace_staff set active=false where user_id='d1600000-0000-4000-8000-000000000001';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.clinic_invite_code_begin((pg_temp.kv('r3')#>>'{invitation,id}')::uuid,1,pg_temp.h(pg_temp.kv('t4')->>'token'),repeat('a',64),repeat('1',64))->>'code'='invitation_unavailable','Removed issuer: invitation stops');
reset role;
update public.workspace_staff set active=true where user_id='d1600000-0000-4000-8000-000000000001';

-- A revoked invitation cannot be reissued once a staff invitation took its email.
select pg_temp.as_admin('d1600000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000011');set local role authenticated;
insert into kv values('r4',public.clinic_invitation_reserve(gen_random_uuid(),'d1600000-0000-4000-8000-000000000004','fourth.user@example.invalid','Fourth User Synthetic','+37499016170'));
select pg_temp.ok(public.clinic_invitation_revoke((pg_temp.kv('r4')#>>'{invitation,id}')::uuid,1)->>'ok'='true','Revoke before any account');
reset role;
insert into public.real_staff_invitations(email,display_name,clinic_id,issuer_id,role)values('fourth.user@example.invalid','X','d1600000-0000-4000-8000-000000000004','d1600000-0000-4000-8000-000000000001','doctor');
select pg_temp.as_admin('d1600000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.clinic_invitation_reissue((pg_temp.kv('r4')#>>'{invitation,id}')::uuid,1,'+37499016170')->>'code'='email_in_use','Reissue refuses a taken email');
reset role;

-- 5. Service functions are not callable by signed-in users or anonymously.
select pg_temp.as_admin('d1600000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000011');set local role authenticated;
do $$begin perform public.clinic_invitation_finalize(gen_random_uuid(),1,repeat('a',64));raise exception 'authenticated finalized';exception when insufficient_privilege then null;end$$;
reset role;
set local role anon;
do $$begin perform public.clinic_invitation_reserve(gen_random_uuid(),gen_random_uuid(),'a@b.cd','A','+37499000001');raise exception 'anon reserved';exception when insufficient_privilege then null;end$$;
reset role;

-- Fable F-6: a refused invitee does not keep the password (only a verified, unaccepted invitation, same browser).
reset role;
update public.clinic_portal_invitations set status='verified',verified_at=now(),verified_nonce_hmac=repeat('d',64),
 verified_binding_id=(select id from public.telegram_auth_bindings where auth_user_id='d1600000-0000-4000-8000-000000000060'and revoked_at is null limit 1)
 where id=(pg_temp.kv('r3')#>>'{invitation,id}')::uuid;
update auth.users set encrypted_password='refused-invitee-hash'where id='d1600000-0000-4000-8000-000000000060';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.clinic_invitation_clear_password((pg_temp.kv('r3')#>>'{invitation,id}')::uuid,1,repeat('e',64))->>'code'='not_applicable','Another browser cannot clear it');
select pg_temp.ok(public.clinic_invitation_clear_password((pg_temp.kv('r1')#>>'{invitation,id}')::uuid,1,repeat('a',64))->>'code'='not_applicable','Accepted invitation keeps its password');
select pg_temp.ok(public.clinic_invitation_clear_password((pg_temp.kv('r3')#>>'{invitation,id}')::uuid,1,repeat('d',64))->>'ok'='true','Refused invitee password cleared');
reset role;
select pg_temp.ok((select nullif(encrypted_password,'')is null from auth.users where id='d1600000-0000-4000-8000-000000000060'),'No password left');
select pg_temp.ok((select nullif(encrypted_password,'')is not null from auth.users where id='d1600000-0000-4000-8000-000000000040'),'Accepted member password intact');

rollback;
\echo 'check-telegram-auth-clinic-invites: ok'
