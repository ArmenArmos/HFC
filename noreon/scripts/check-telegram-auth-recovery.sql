-- T-auth B-3: password recovery by Telegram for staff and clinic accounts, rolled back.
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


-- Fixtures: an admin, a doctor and a clinic user, each Telegram-enrolled; the bot.
insert into auth.users(id,email)values('d1700000-0000-4000-8000-000000000001','admin.synthetic@example.invalid'),('d1700000-0000-4000-8000-000000000002','doctor.synthetic@example.invalid'),('d1700000-0000-4000-8000-000000000003','clinic.synthetic@example.invalid'),('d1700000-0000-4000-8000-000000000005','nurse.synthetic@example.invalid'),('d1700000-0000-4000-8000-000000000006','admin2.synthetic@example.invalid');
insert into public.workspace_clinics(id,name)values('d1700000-0000-4000-8000-000000000004','Synthetic recovery clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d1700000-0000-4000-8000-000000000001','admin','Synthetic admin',null),('d1700000-0000-4000-8000-000000000002','doctor','Dr Synthetic','d1700000-0000-4000-8000-000000000004'),('d1700000-0000-4000-8000-000000000005','nurse','Nurse Synthetic','d1700000-0000-4000-8000-000000000004'),('d1700000-0000-4000-8000-000000000006','admin','Synthetic admin two',null);
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name)values('d1700000-0000-4000-8000-000000000003','d1700000-0000-4000-8000-000000000004','Clinic Synthetic');
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1700000-0000-4000-8000-000000000011','d1700000-0000-4000-8000-000000000001',now(),now()),('d1700000-0000-4000-8000-000000000012','d1700000-0000-4000-8000-000000000002',now(),now()),('d1700000-0000-4000-8000-000000000013','d1700000-0000-4000-8000-000000000003',now(),now()),('d1700000-0000-4000-8000-000000000016','d1700000-0000-4000-8000-000000000006',now(),now());
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_staff',9005,600,'consent-s');
select pg_temp.as_staff('d1700000-0000-4000-8000-000000000006','d1700000-0000-4000-8000-000000000016');set local role authenticated;
insert into kv values('e2',public.staff_telegram_enrolment_issue('d1700000-0000-4000-8000-000000000002','+37499017020'));
insert into kv values('e3',public.staff_telegram_enrolment_issue('d1700000-0000-4000-8000-000000000003','+37499017030'));
reset role;
select pg_temp.as_service();set local role service_role;
select pg_temp.prove(pg_temp.kv('e2')->>'token',7420,'+37499017020',400);
select pg_temp.prove(pg_temp.kv('e3')->>'token',7430,'+37499017030',410);
reset role;
-- Freshly connected chats cannot receive a reset (review I-1).
select pg_temp.as_staff('d1700000-0000-4000-8000-000000000001','d1700000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.staff_telegram_recovery_issue('d1700000-0000-4000-8000-000000000002','staff')->>'code'='recent_binding','No reset within 24 hours of connecting Telegram');
reset role;
select pg_temp.as_staff('d1700000-0000-4000-8000-000000000006','d1700000-0000-4000-8000-000000000016');set local role authenticated;
reset role;
update public.telegram_auth_bindings set proven_at=now()-interval '2 days'where auth_user_id in('d1700000-0000-4000-8000-000000000002','d1700000-0000-4000-8000-000000000003');
select pg_temp.as_staff('d1700000-0000-4000-8000-000000000006','d1700000-0000-4000-8000-000000000016');set local role authenticated;
select pg_temp.ok(public.staff_telegram_recovery_issue('d1700000-0000-4000-8000-000000000002','staff')->>'code'='recent_binding','No reset to a chat this admin connected');
select pg_temp.ok(public.staff_telegram_recovery_issue('d1700000-0000-4000-8000-000000000001','staff')->>'code'='admin_target','Admin accounts are never reset here');
reset role;

-- 1. Admin-requested only, for an enrolled account of the right portal, never one's own.
select pg_temp.as_staff('d1700000-0000-4000-8000-000000000002','d1700000-0000-4000-8000-000000000012');set local role authenticated;
do $$begin perform public.staff_telegram_recovery_issue('d1700000-0000-4000-8000-000000000003','clinic');raise exception 'doctor issued a reset';exception when insufficient_privilege then null;end$$;
reset role;
select pg_temp.as_staff('d1700000-0000-4000-8000-000000000001','d1700000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.staff_telegram_recovery_issue('d1700000-0000-4000-8000-000000000001','staff')->>'code'='self','No reset of one''s own account');
select pg_temp.ok(public.staff_telegram_recovery_issue('d1700000-0000-4000-8000-000000000005','staff')->>'code'='not_enrolled','Needs a connected Telegram');
select pg_temp.ok(public.staff_telegram_recovery_issue('d1700000-0000-4000-8000-000000000003','staff')->>'code'='not_found','Portal must match the account');
insert into kv values('i1',public.staff_telegram_recovery_issue('d1700000-0000-4000-8000-000000000002','staff'));
select pg_temp.ok(pg_temp.kv('i1')->>'ok'='true'and pg_temp.kv('i1')->>'token'is null and pg_temp.kv('i1')->>'address'is null,'The admin gets no link and no chat');
reset role;
select pg_temp.as_service();set local role service_role;
insert into kv values('r1',public.staff_recovery_link((pg_temp.kv('i1')->>'recoveryId')::uuid)||jsonb_build_object('recoveryId',pg_temp.kv('i1')->>'recoveryId'));
select pg_temp.ok(pg_temp.kv('r1')->>'address'='7420'and length(pg_temp.kv('r1')->>'token')=32,'Service mints the link for the account''s chat');
select pg_temp.ok(public.staff_recovery_link((pg_temp.kv('i1')->>'recoveryId')::uuid)->>'code'='recovery_unavailable','The link is minted once');
reset role;
select pg_temp.as_staff('d1700000-0000-4000-8000-000000000001','d1700000-0000-4000-8000-000000000011');set local role authenticated;
insert into kv values('i2',public.staff_telegram_recovery_issue('d1700000-0000-4000-8000-000000000002','staff'));
reset role;
select pg_temp.as_service();set local role service_role;
insert into kv values('r2',public.staff_recovery_link((pg_temp.kv('i2')->>'recoveryId')::uuid)||jsonb_build_object('recoveryId',pg_temp.kv('i2')->>'recoveryId'));
reset role;

-- 2. A newer link replaces the older one; code to the same chat; wrong code, wrong browser.
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.staff_recovery_code_begin((pg_temp.kv('r1')->>'recoveryId')::uuid,pg_temp.h(pg_temp.kv('r1')->>'token'),repeat('a',64),repeat('1',64))->>'code'='recovery_unavailable','Older link stops');
select pg_temp.ok(public.staff_recovery_code_begin((pg_temp.kv('r2')->>'recoveryId')::uuid,pg_temp.h('wrong'),repeat('a',64),repeat('1',64))->>'code'='recovery_unavailable','Needs the link token');
insert into kv values('c2',public.staff_recovery_code_begin((pg_temp.kv('r2')->>'recoveryId')::uuid,pg_temp.h(pg_temp.kv('r2')->>'token'),repeat('a',64),repeat('1',64)));
select pg_temp.ok(pg_temp.kv('c2')->>'address'='7420','Code goes to the same chat');
select pg_temp.ok(public.staff_recovery_code_verify((pg_temp.kv('c2')->>'challengeId')::uuid,(pg_temp.kv('r2')->>'recoveryId')::uuid,repeat('a',64),repeat('2',64))->>'code'='wrong_code','Wrong code');
select pg_temp.ok(public.staff_recovery_code_verify((pg_temp.kv('c2')->>'challengeId')::uuid,(pg_temp.kv('r2')->>'recoveryId')::uuid,repeat('b',64),repeat('1',64))->>'code'='unknown_challenge','Other browser');
select pg_temp.ok(public.staff_recovery_finish((pg_temp.kv('r2')->>'recoveryId')::uuid,repeat('a',64))->>'code'='verification_expired','No finish before the code');
select pg_temp.ok(public.staff_recovery_code_verify((pg_temp.kv('c2')->>'challengeId')::uuid,(pg_temp.kv('r2')->>'recoveryId')::uuid,repeat('a',64),repeat('1',64))->>'portal'='staff','Right code verifies');
reset role;
select pg_temp.ok(exists(select 1 from auth.sessions where user_id='d1700000-0000-4000-8000-000000000002'),'Verify alone does not end sessions (Fable F-8); finish does');
-- A session opened after verify (old password), then the reset is retired before finish: finish still ends it.
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1700000-0000-4000-8000-000000000022','d1700000-0000-4000-8000-000000000002',now(),now());
update public.staff_telegram_recoveries set status='revoked'where id=(pg_temp.kv('r2')->>'recoveryId')::uuid;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.staff_recovery_finish((pg_temp.kv('r2')->>'recoveryId')::uuid,repeat('a',64))->>'completed'='false','Finish after a retire still answers');
reset role;
select pg_temp.ok(not exists(select 1 from auth.sessions where user_id='d1700000-0000-4000-8000-000000000002'),'Finish after a retire still ends sessions');
update public.staff_telegram_recoveries set status='verified'where id=(pg_temp.kv('r2')->>'recoveryId')::uuid;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.staff_recovery_finish((pg_temp.kv('r2')->>'recoveryId')::uuid,repeat('c',64))->>'code'='verification_expired','Finish needs the verifying browser');
select pg_temp.ok(public.staff_recovery_finish((pg_temp.kv('r2')->>'recoveryId')::uuid,repeat('a',64))->>'ok'='true','Finish');
select pg_temp.ok(public.staff_recovery_finish((pg_temp.kv('r2')->>'recoveryId')::uuid,repeat('a',64))->>'ok'='true','Finish is idempotent');
reset role;
select pg_temp.ok(not exists(select 1 from auth.sessions where user_id='d1700000-0000-4000-8000-000000000002'),'Every session of the account ended');
select pg_temp.ok((select active from public.workspace_staff where user_id='d1700000-0000-4000-8000-000000000002'),'Membership unchanged');

-- 3. Inactive membership allowed (design restoration); a revoked binding stops an open reset.
update public.workspace_staff set active=false where user_id='d1700000-0000-4000-8000-000000000002';
select pg_temp.as_staff('d1700000-0000-4000-8000-000000000001','d1700000-0000-4000-8000-000000000011');set local role authenticated;
insert into kv values('i3',public.staff_telegram_recovery_issue('d1700000-0000-4000-8000-000000000002','staff'));
select pg_temp.ok(pg_temp.kv('i3')->>'ok'='true','Inactive staff can be reset');
reset role;
select pg_temp.as_service();set local role service_role;
insert into kv values('r3',public.staff_recovery_link((pg_temp.kv('i3')->>'recoveryId')::uuid)||jsonb_build_object('recoveryId',pg_temp.kv('i3')->>'recoveryId'));
reset role;
select pg_temp.as_staff('d1700000-0000-4000-8000-000000000001','d1700000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.staff_telegram_revoke('d1700000-0000-4000-8000-000000000002')->>'ok'='true','Admin revokes Telegram');
reset role;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.staff_recovery_code_begin((pg_temp.kv('r3')->>'recoveryId')::uuid,pg_temp.h(pg_temp.kv('r3')->>'token'),repeat('a',64),repeat('1',64))->>'code'='recovery_unavailable','Revoked binding stops the reset');
reset role;

-- 4. Clinic accounts; five resets per hour per account.
select pg_temp.as_staff('d1700000-0000-4000-8000-000000000001','d1700000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.staff_telegram_recovery_issue('d1700000-0000-4000-8000-000000000003','clinic')->>'ok'='true','Clinic account reset');
select public.staff_telegram_recovery_issue('d1700000-0000-4000-8000-000000000003','clinic')from generate_series(1,4);
select pg_temp.ok(public.staff_telegram_recovery_issue('d1700000-0000-4000-8000-000000000003','clinic')->>'code'='rate_limited','Five resets per hour');
do $$begin perform public.staff_recovery_finish(gen_random_uuid(),repeat('a',64));raise exception 'authenticated finished';exception when insufficient_privilege then null;end$$;
reset role;

rollback;
\echo 'check-telegram-auth-recovery: ok'
