-- T-auth B-1: staff Telegram enrolment, sign-in code admission and guards, rolled back.
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

-- Fixtures: an admin, a doctor in an active clinic, sessions.
insert into auth.users(id,email)values('d1500000-0000-4000-8000-000000000001','admin.synthetic@example.invalid'),('d1500000-0000-4000-8000-000000000002','doctor.synthetic@example.invalid');
insert into public.workspace_clinics(id,name)values('d1500000-0000-4000-8000-000000000004','Synthetic staff clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d1500000-0000-4000-8000-000000000001','admin','Synthetic admin',null),('d1500000-0000-4000-8000-000000000002','doctor','Dr Staff Synthetic','d1500000-0000-4000-8000-000000000004');
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1500000-0000-4000-8000-000000000011','d1500000-0000-4000-8000-000000000001',now(),now()),('d1500000-0000-4000-8000-000000000012','d1500000-0000-4000-8000-000000000002',now(),now());
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_staff',9005,600,'consent-s');

-- Dark: no policy row, existing sign-in unchanged.
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000012');set local role authenticated;
select pg_temp.ok(public.real_clinical_staff_identity()->>'role'='doctor','Without the policy a password session works as before');
select pg_temp.ok(public.staff_signin_state()->>'required'='false','Not required');
reset role;
select pg_temp.ok(not has_function_privilege('authenticated','public.staff_signin_code_begin(uuid,uuid,text,text)','execute')and not has_function_privilege('authenticated','public.staff_signin_code_verify(uuid,uuid,uuid,text,text)','execute')
 and not has_function_privilege('anon','public.staff_telegram_enrolment_issue(uuid,text,boolean)','execute')and not has_table_privilege('authenticated','public.auth_admissions','select'),'Codes and admissions are service-only');

-- Enrolment: only an admin issues it; the doctor proves the recorded phone in the bot.
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000012');set local role authenticated;
do $$begin perform public.staff_telegram_enrolment_issue('d1500000-0000-4000-8000-000000000002','+37499015101');raise exception 'doctor issued';exception when insufficient_privilege then null;end$$;
reset role;
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.staff_telegram_enrolment_issue('d1500000-0000-4000-8000-000000000099','+37499015101')->>'code'='not_staff','Only staff accounts can be enrolled');
select pg_temp.ok(public.staff_telegram_enrolment_issue('d1500000-0000-4000-8000-000000000002','37499015101')->>'code'='invalid_phone','Phone must be E.164');
insert into kv values('e0',public.staff_telegram_enrolment_issue('d1500000-0000-4000-8000-000000000002','+37499015101'));
insert into kv values('e1',public.staff_telegram_enrolment_issue('d1500000-0000-4000-8000-000000000002','+37499015101'));
reset role;
select pg_temp.ok((select count(*)filter(where state='cancelled')=1 and count(*)=2 from public.telegram_auth_challenges where purpose='staff_enrol'),'Reissue cancels the earlier link');
select pg_temp.as_service();set local role service_role;
select pg_temp.prove(pg_temp.kv('e0')->>'token',7201,'+37499015101',200);
select pg_temp.prove(pg_temp.kv('e1')->>'token',7201,'+37499015199',202);
reset role;
select pg_temp.ok((select array_agg(result order by event_id)from public.channel_inbox where event_id ~ ',20[0-3]\]$')=array['auth:token_invalid','principal_not_linked','auth:prompted','contact:refused'],'Cancelled link does nothing; another number is refused');
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000011');set local role authenticated;
insert into kv values('e2',public.staff_telegram_enrolment_issue('d1500000-0000-4000-8000-000000000002','+37499015101'));
reset role;
select pg_temp.as_service();set local role service_role;
select pg_temp.prove(pg_temp.kv('e2')->>'token',7201,'+37499015101',204);
reset role;
select pg_temp.ok((select kind='staff'and phone='+37499015101'and address='7201'from public.telegram_auth_bindings where auth_user_id='d1500000-0000-4000-8000-000000000002'and active),'Staff binding created from the recorded phone');
select pg_temp.ok(exists(select 1 from public.telegram_auth_messages where address='7201'and template_id='telegram.staff_contact_ok')and not exists(select 1 from public.telegram_auth_messages where address='7201'and template_id='telegram.contact_ok'),'Staff enrolment gets the staff confirmation, not "go back to the app"');
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.staff_telegram_status('d1500000-0000-4000-8000-000000000002')->>'enrolled'='true','Admin sees the doctor enrolled');
reset role;

-- Sign-in second step.
insert into public.staff_telegram_policy(signin_required)values(true);
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000012');set local role authenticated;
select pg_temp.ok(public.real_clinical_staff_identity()is null,'Required: an unadmitted password session has no staff access');
select pg_temp.ok(public.staff_signin_state()->>'admitted'='false'and public.staff_signin_state()->>'enrolled'='true','State says enrolled, not admitted');
reset role;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.staff_signin_code_begin('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000011',repeat('1',64),repeat('c',64))->>'code'='not_enrolled','Admin without Telegram cannot get a code');
select pg_temp.ok(public.staff_signin_code_begin('d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000011',repeat('1',64),repeat('c',64))->>'code'='no_session','Session must belong to the user');
insert into kv values('c1',public.staff_signin_code_begin('d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000012',repeat('1',64),repeat('c',64)));
select pg_temp.ok(pg_temp.kv('c1')->>'address'='7201','Code goes only to the bound chat');
select pg_temp.ok(public.staff_signin_code_verify((pg_temp.kv('c1')->>'challengeId')::uuid,'d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000012',repeat('2',64),repeat('c',64))->>'code'='unknown_challenge','Another browser cannot use the challenge');
select pg_temp.ok(public.staff_signin_code_verify((pg_temp.kv('c1')->>'challengeId')::uuid,'d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000012',repeat('1',64),repeat('d',64))->>'code'='wrong_code','Wrong code');
select pg_temp.ok(public.staff_signin_code_verify((pg_temp.kv('c1')->>'challengeId')::uuid,'d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000012',repeat('1',64),repeat('c',64))->>'result'='admitted','Right code admits the session');
select pg_temp.ok(public.staff_signin_code_verify((pg_temp.kv('c1')->>'challengeId')::uuid,'d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000012',repeat('1',64),repeat('c',64))->>'result'='admitted','Retry after a lost answer gets the same decision');
reset role;
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000012');set local role authenticated;
select pg_temp.ok(public.real_clinical_staff_identity()->>'role'='doctor','Admitted session has staff access');
reset role;
-- Five wrong codes end a challenge.
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1500000-0000-4000-8000-000000000013','d1500000-0000-4000-8000-000000000002',now(),now());
select pg_temp.as_service();set local role service_role;
insert into kv values('c2',public.staff_signin_code_begin('d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000013',repeat('3',64),repeat('e',64)));
select pg_temp.ok(bool_and(public.staff_signin_code_verify((pg_temp.kv('c2')->>'challengeId')::uuid,'d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000013',repeat('3',64),repeat(x,64))->>'ok'='false'),'Wrong codes refused')from unnest(array['0','1','2','3','4'])x;
select pg_temp.ok(public.staff_signin_code_verify((pg_temp.kv('c2')->>'challengeId')::uuid,'d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000013',repeat('3',64),repeat('e',64))->>'code'='expired','After five wrong codes the right one no longer works');
reset role;

-- Admin revoke: binding off, sessions ended, admitted access stops.
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000011');set local role authenticated;
do $$begin perform public.staff_telegram_revoke('d1500000-0000-4000-8000-000000000002');raise exception 'unadmitted admin revoked';exception when insufficient_privilege then null;end$$;
reset role;
delete from public.staff_telegram_policy;
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.staff_telegram_revoke('d1500000-0000-4000-8000-000000000002')->>'revoked'='true','Admin revokes Telegram and sessions');
reset role;
select pg_temp.ok(not exists(select 1 from auth.sessions where user_id='d1500000-0000-4000-8000-000000000002')and not exists(select 1 from public.telegram_auth_bindings where auth_user_id='d1500000-0000-4000-8000-000000000002'and active),'Sessions and binding gone');
insert into public.staff_telegram_policy(signin_required)values(true);
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1500000-0000-4000-8000-000000000012','d1500000-0000-4000-8000-000000000002',now(),now());
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000012');set local role authenticated;
select pg_temp.ok(public.real_clinical_staff_identity()is null,'An admission through a revoked binding no longer counts');
reset role;

-- Review fixes (B-1 Opus fallback review) --------------------------------------------------------
-- Revoke only targets staff accounts.
delete from public.staff_telegram_policy;
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.staff_telegram_revoke('d1500000-0000-4000-8000-000000000099')->>'code'='not_staff','Revoke refuses non-staff accounts');
reset role;
-- Re-enrol after the revoke, sign in and get admitted: the cleanup sweeps keep that session.
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000011');set local role authenticated;
insert into kv values('e3',public.staff_telegram_enrolment_issue('d1500000-0000-4000-8000-000000000002','+37499015101'));
reset role;
select pg_temp.as_service();set local role service_role;
select pg_temp.prove(pg_temp.kv('e3')->>'token',7201,'+37499015101',210);
reset role;
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1500000-0000-4000-8000-000000000015','d1500000-0000-4000-8000-000000000002',now(),now());
select pg_temp.as_service();set local role service_role;
insert into kv values('c3',public.staff_signin_code_begin('d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000015',repeat('4',64),repeat('f',64)));
select pg_temp.ok(public.staff_signin_code_verify((pg_temp.kv('c3')->>'challengeId')::uuid,'d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000015',repeat('4',64),repeat('f',64))->>'result'='admitted','Re-enrolled staff admitted');
reset role;
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1500000-0000-4000-8000-000000000014','d1500000-0000-4000-8000-000000000002',now(),now());
update public.auth_cleanup_jobs set due_at=clock_timestamp()-interval '1 second'where auth_user_id='d1500000-0000-4000-8000-000000000002';
select pg_temp.as_service();set local role service_role;select public.auth_cleanup_run();reset role;
select pg_temp.ok(exists(select 1 from auth.sessions where id='d1500000-0000-4000-8000-000000000015')and not exists(select 1 from auth.sessions where id='d1500000-0000-4000-8000-000000000014'),'Sweep keeps the admitted session and removes the stray one');
-- 24-hour ceiling: 10 wrong codes stop new codes for the account.
reset role;
update public.staff_code_challenges set attempts=10 where id=(pg_temp.kv('c3')->>'challengeId')::uuid;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.staff_signin_code_begin('d1500000-0000-4000-8000-000000000002','d1500000-0000-4000-8000-000000000015',repeat('5',64),repeat('f',64))->>'code'='too_many_attempts','Ten wrong codes in 24 hours stop new codes');
reset role;
-- Admin assignment RPCs now need the managed admin session (and admission when required).
insert into auth.users(id,email)values('d1500000-0000-4000-8000-000000000003','member.synthetic@example.invalid');
insert into public.patient_clinical_cases(user_id)values('d1500000-0000-4000-8000-000000000003');
insert into kv select 'rev',to_jsonb(revision)from public.patient_clinical_cases where user_id='d1500000-0000-4000-8000-000000000003';
insert into public.staff_telegram_policy(signin_required)values(true);
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000011');set local role authenticated;
do $$begin perform public.assign_patient_clinical_case('d1500000-0000-4000-8000-000000000003',(pg_temp.kv('rev')#>>'{}')::bigint,'d1500000-0000-4000-8000-000000000002');raise exception 'unadmitted admin assigned';exception when insufficient_privilege then null;end$$;
do $$begin perform public.assign_patient_case_nurse('d1500000-0000-4000-8000-000000000003',0,null);raise exception 'unadmitted admin assigned nurse';exception when insufficient_privilege then null;end$$;
reset role;
delete from public.staff_telegram_policy;
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.assign_patient_clinical_case('d1500000-0000-4000-8000-000000000003',(pg_temp.kv('rev')#>>'{}')::bigint,'d1500000-0000-4000-8000-000000000002')>0,'Policy off: an admin session assigns as before');
reset role;

-- Clinic portal (T-auth B-2b-1): a clinic user is enrolled like staff; with the requirement on,
-- the clinic guard refuses an unadmitted session and accepts one admitted by its Telegram code.
delete from public.staff_telegram_policy;
insert into auth.users(id,email)values('d1500000-0000-4000-8000-000000000040','clinic.user@example.invalid');
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name)values('d1500000-0000-4000-8000-000000000040','d1500000-0000-4000-8000-000000000004','Clinic User Synthetic');
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1500000-0000-4000-8000-000000000041','d1500000-0000-4000-8000-000000000040',now(),now());
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000011');set local role authenticated;
insert into kv values('ce',public.staff_telegram_enrolment_issue('d1500000-0000-4000-8000-000000000040','+37499015140'));
reset role;
select pg_temp.as_service();set local role service_role;
select pg_temp.prove(pg_temp.kv('ce')->>'token',7240,'+37499015140',230);
reset role;
select pg_temp.ok((select kind='staff'from public.telegram_auth_bindings where auth_user_id='d1500000-0000-4000-8000-000000000040'and active),'Clinic user enrolled');
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000040','d1500000-0000-4000-8000-000000000041');set local role authenticated;
select pg_temp.ok(public.staff_signin_state()->>'clinicEligible'='true'and public.staff_signin_state()->>'staffEligible'='false','Clinic-only account: clinic step only');
reset role;
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.staff_signin_state()->>'staffEligible'='true'and public.staff_signin_state()->>'clinicEligible'='false','Staff-only account: never sent through the clinic step');
reset role;
insert into public.staff_telegram_policy(signin_required)values(true);
do $$begin perform public._clinic_portal_live('d1500000-0000-4000-8000-000000000004','d1500000-0000-4000-8000-000000000040','d1500000-0000-4000-8000-000000000041','[{"method":"password"}]',clock_timestamp()+interval '1 hour');raise exception 'unadmitted clinic session passed';exception when insufficient_privilege then null;end$$;
select pg_temp.as_service();set local role service_role;
insert into kv values('cc',public.staff_signin_code_begin('d1500000-0000-4000-8000-000000000040','d1500000-0000-4000-8000-000000000041',repeat('7',64),repeat('a',64)));
select pg_temp.ok(pg_temp.kv('cc')->>'address'='7240','Clinic code goes to the clinic user''s chat');
select pg_temp.ok(public.staff_signin_code_verify((pg_temp.kv('cc')->>'challengeId')::uuid,'d1500000-0000-4000-8000-000000000040','d1500000-0000-4000-8000-000000000041',repeat('7',64),repeat('a',64))->>'result'='admitted','Clinic session admitted');
reset role;
select pg_temp.ok((public._clinic_portal_live('d1500000-0000-4000-8000-000000000004','d1500000-0000-4000-8000-000000000040','d1500000-0000-4000-8000-000000000041','[{"method":"password"}]',clock_timestamp()+interval '1 hour')).user_id='d1500000-0000-4000-8000-000000000040','Admitted clinic session passes the clinic guard');

-- Fable F-3: never one's own account, never an admin; an existing connection is replaced only after confirmation.
reset role;
insert into auth.users(id,email)values('d1500000-0000-4000-8000-000000000050','admin2.synthetic@example.invalid');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d1500000-0000-4000-8000-000000000050','admin','Synthetic admin two',null);
delete from public.staff_telegram_policy;
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000011');set local role authenticated;
-- QA S-01: an admin connects their own Telegram the first time; replacing it needs another admin.
select pg_temp.ok(public.staff_telegram_enrolment_issue('d1500000-0000-4000-8000-000000000001','+37499015199')->>'ok'='true','Admin connects their own Telegram the first time');
reset role;
insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation,active)
values('d1500000-0000-4000-8000-000000000001','staff','["telegram","noreon_staff",9005,"user",7299]','acct-admin','+37499015199','7299',1,true);
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.staff_telegram_enrolment_issue('d1500000-0000-4000-8000-000000000001','+37499015198',true)->>'code'='self','No replacing one''s own connection');
select pg_temp.ok(public.staff_telegram_enrolment_issue('d1500000-0000-4000-8000-000000000050','+37499015199')->>'code'='admin_target','No enrolment of an admin account');
reset role;
select pg_temp.ok(exists(select 1 from public.telegram_auth_bindings where auth_user_id='d1500000-0000-4000-8000-000000000040'and kind='staff'and active),'Fixture: the clinic user is connected');
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000011');set local role authenticated;
insert into kv values('f3',public.staff_telegram_enrolment_issue('d1500000-0000-4000-8000-000000000040','+37499015140'));
select pg_temp.ok(pg_temp.kv('f3')->>'code'='has_binding'and pg_temp.kv('f3')->>'since'is not null and pg_temp.kv('f3')->>'connectedBy'='Synthetic admin','Existing connection shown, not silently replaced');
select pg_temp.ok(public.staff_telegram_enrolment_issue('d1500000-0000-4000-8000-000000000040','+37499015140',true)->>'ok'='true','Replacement after confirmation');
reset role;

-- Fable N-3: a link issued without confirmation never replaces a connection made after it was issued.
insert into auth.users(id,email)values('d1500000-0000-4000-8000-000000000060','nurse.n3@example.invalid');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d1500000-0000-4000-8000-000000000060','nurse','Nurse N3','d1500000-0000-4000-8000-000000000004');
select pg_temp.as_staff('d1500000-0000-4000-8000-000000000001','d1500000-0000-4000-8000-000000000011');set local role authenticated;
insert into kv values('n3',public.staff_telegram_enrolment_issue('d1500000-0000-4000-8000-000000000060','+37499015160'));
reset role;
insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation,active)
values('d1500000-0000-4000-8000-000000000060','staff','["telegram","noreon_staff",9005,"user",7361]','acct-n3','+37499015161','7361',1,true);
select pg_temp.as_service();set local role service_role;
select pg_temp.prove(pg_temp.kv('n3')->>'token',7360,'+37499015160',520);
reset role;
select pg_temp.ok((select principal_ref='["telegram","noreon_staff",9005,"user",7361]'from public.telegram_auth_bindings where auth_user_id='d1500000-0000-4000-8000-000000000060'and active),'Unconfirmed link did not replace the newer connection');

rollback;
\echo 'check-telegram-auth-staff: ok'
