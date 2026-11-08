-- T-auth B-2a: staff invitations through Telegram (proof, code, claimed and admitted admission), rolled back.
-- Synthetic fixtures only; no Telegram, Supabase Auth API, network or provider.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_inv",9006,"user",%s]',u)$$;
create function pg_temp.h(v text)returns text language sql as $$select encode(sha256(convert_to(v,'UTF8')),'hex')$$;
create function pg_temp.event(id text,kind text,u bigint,payload jsonb)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_inv",9006,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind',kind,'payload',payload||jsonb_build_object('chatId',u,'messageId',id::bigint))
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

-- Fixtures: admin, clinic, a dispatched pending invitation bound to a reserved Auth user.
insert into auth.users(id,email,email_confirmed_at)values('d1600000-0000-4000-8000-000000000001','admin.inv@example.invalid',now()),('d1600000-0000-4000-8000-000000000002','new.doctor@example.invalid',now());
insert into public.workspace_clinics(id,name)values('d1600000-0000-4000-8000-000000000004','Synthetic invite clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d1600000-0000-4000-8000-000000000001','admin','Synthetic admin',null);
insert into public.workspace_staff(user_id,role,display_name,clinic_id,active)values('d1600000-0000-4000-8000-000000000002','doctor','Dr New Synthetic','d1600000-0000-4000-8000-000000000004',false);
insert into public.real_staff_invitations(id,email,display_name,clinic_id,issuer_id,expected_auth_user_id,auth_user_id,dispatch_claimed_at,expires_at)
 values('d1600000-0000-4000-8000-000000000010','new.doctor@example.invalid','Dr New Synthetic','d1600000-0000-4000-8000-000000000004','d1600000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000002','d1600000-0000-4000-8000-000000000002',clock_timestamp(),clock_timestamp()+interval '1 hour');
insert into kv select 'op',to_jsonb(operation_id)from public.real_staff_invitations where id='d1600000-0000-4000-8000-000000000010';
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_inv',9006,600,'consent-i');

select pg_temp.ok(not has_function_privilege('authenticated','public.staff_invite_admit(uuid,text,uuid,uuid)','execute')and not has_function_privilege('authenticated','public.staff_invite_code_begin(uuid,bigint,text,text,text)','execute')and not has_function_privilege('anon','public.staff_invitation_telegram_issue(uuid,bigint,uuid,text)','execute'),'Invitation RPCs are service-only');

select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.staff_invitation_telegram_issue('d1600000-0000-4000-8000-000000000010',2,(pg_temp.kv('op')#>>'{}')::uuid,'+37499016101')->>'code'='invitation_changed','Wrong generation refused');
select pg_temp.ok(public.staff_invitation_telegram_issue('d1600000-0000-4000-8000-000000000010',1,(pg_temp.kv('op')#>>'{}')::uuid,'37499016101')->>'code'='invalid_phone','Phone must be E.164');
insert into kv values('t1',public.staff_invitation_telegram_issue('d1600000-0000-4000-8000-000000000010',1,(pg_temp.kv('op')#>>'{}')::uuid,'+37499016101'));
select pg_temp.ok(public.staff_invite_code_begin('d1600000-0000-4000-8000-000000000010',1,pg_temp.h(pg_temp.kv('t1')->>'token'),repeat('1',64),repeat('c',64))->>'code'='not_proven','No code before the invitee proves the invited phone');
-- Proof with another number is refused; with the invited number it creates the binding.
select pg_temp.prove(pg_temp.kv('t1')->>'token',7601,'+37499016199',300);
insert into kv values('t2',public.staff_invitation_telegram_issue('d1600000-0000-4000-8000-000000000010',1,(pg_temp.kv('op')#>>'{}')::uuid,'+37499016101'));
select pg_temp.prove(pg_temp.kv('t2')->>'token',7601,'+37499016101',302);
reset role;
select pg_temp.ok((select result from public.channel_inbox where event_id like '%,301]')='contact:refused'and(select result from public.channel_inbox where event_id like '%,303]')='contact:proven','Only the invited number proves');
select pg_temp.ok((select kind='staff'and address='7601'and not active and pending_invitation_id='d1600000-0000-4000-8000-000000000010'from public.telegram_auth_bindings where auth_user_id='d1600000-0000-4000-8000-000000000002'and revoked_at is null),'Invitee binding is pending until acceptance');
select pg_temp.ok((select delivery='telegram'and invited_phone='+37499016101'and expires_at>clock_timestamp()+interval '71 hours'from public.real_staff_invitations where id='d1600000-0000-4000-8000-000000000010'),'Invitation records Telegram delivery, phone and the 72-hour window');

-- Code and claimed admission.
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.staff_invite_code_begin('d1600000-0000-4000-8000-000000000010',1,pg_temp.h('not-the-link'),repeat('1',64),repeat('c',64))->>'code'='invitation_unavailable','Codes need this invitation link''s start token');
insert into kv values('c1',public.staff_invite_code_begin('d1600000-0000-4000-8000-000000000010',1,pg_temp.h(pg_temp.kv('t2')->>'token'),repeat('1',64),repeat('c',64)));
select pg_temp.ok(pg_temp.kv('c1')->>'address'='7601','Code goes to the proven chat');
select pg_temp.ok(public.staff_invite_code_verify((pg_temp.kv('c1')->>'challengeId')::uuid,'d1600000-0000-4000-8000-000000000010',1,repeat('2',64),repeat('c',64))->>'code'='unknown_challenge','Another browser cannot use the code');
select pg_temp.ok(public.staff_invite_code_verify((pg_temp.kv('c1')->>'challengeId')::uuid,'d1600000-0000-4000-8000-000000000010',1,repeat('1',64),repeat('d',64))->>'code'='wrong_code','Wrong code');
insert into kv values('v1',public.staff_invite_code_verify((pg_temp.kv('c1')->>'challengeId')::uuid,'d1600000-0000-4000-8000-000000000010',1,repeat('1',64),repeat('c',64)));
select pg_temp.ok(pg_temp.kv('v1')->>'ok'='true','Right code claims an admission');
reset role;
-- The server opens the Supabase session; admission decides it.
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1600000-0000-4000-8000-000000000021','d1600000-0000-4000-8000-000000000002',now(),now()),('d1600000-0000-4000-8000-000000000022','d1600000-0000-4000-8000-000000000002',now(),now());
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.staff_invite_admit((pg_temp.kv('v1')->>'claimId')::uuid,repeat('2',64),'d1600000-0000-4000-8000-000000000002','d1600000-0000-4000-8000-000000000021')->>'code'='unknown_claim','Claim bound to the browser nonce');
select pg_temp.ok(public.staff_invite_admit((pg_temp.kv('v1')->>'claimId')::uuid,repeat('1',64),'d1600000-0000-4000-8000-000000000002','d1600000-0000-4000-8000-000000000021')->>'result'='admitted','Admitted');
select pg_temp.ok(public.staff_invite_admit((pg_temp.kv('v1')->>'claimId')::uuid,repeat('1',64),'d1600000-0000-4000-8000-000000000002','d1600000-0000-4000-8000-000000000021')->>'result'='admitted','Retry with the same session gets the stored decision');
select pg_temp.ok(public.staff_invite_admit((pg_temp.kv('v1')->>'claimId')::uuid,repeat('1',64),'d1600000-0000-4000-8000-000000000002','d1600000-0000-4000-8000-000000000022')->>'code'='decided','Another session cannot reuse the claim');
reset role;


-- A claim whose invitation changed (reissue) is rejected, and that session is ended.
select pg_temp.as_service();set local role service_role;
insert into kv values('c2',public.staff_invite_code_begin('d1600000-0000-4000-8000-000000000010',1,pg_temp.h(pg_temp.kv('t2')->>'token'),repeat('3',64),repeat('e',64)));
insert into kv values('v2',public.staff_invite_code_verify((pg_temp.kv('c2')->>'challengeId')::uuid,'d1600000-0000-4000-8000-000000000010',1,repeat('3',64),repeat('e',64)));
reset role;
update public.real_staff_invitations set generation=2 where id='d1600000-0000-4000-8000-000000000010';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.staff_invite_admit((pg_temp.kv('v2')->>'claimId')::uuid,repeat('3',64),'d1600000-0000-4000-8000-000000000002','d1600000-0000-4000-8000-000000000022')->>'result'='rejected','Reissued invitation: rejected');
select pg_temp.ok(public.staff_invite_reject_session((pg_temp.kv('v2')->>'claimId')::uuid,'d1600000-0000-4000-8000-000000000022')->>'deleted'='true','Rejected session ended');
select pg_temp.ok(public.staff_invite_code_begin('d1600000-0000-4000-8000-000000000010',2,pg_temp.h(pg_temp.kv('t2')->>'token'),repeat('4',64),repeat('f',64))->>'code'='invitation_unavailable','A new generation needs its own link and proof');
reset role;
-- An expired claim is never admitted.
update public.auth_admissions set state='claimed',session_id=null,decided_at=null,expires_at=clock_timestamp()-interval '1 second'where id=(pg_temp.kv('v2')->>'claimId')::uuid;
update public.real_staff_invitations set generation=1 where id='d1600000-0000-4000-8000-000000000010';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.staff_invite_admit((pg_temp.kv('v2')->>'claimId')::uuid,repeat('3',64),'d1600000-0000-4000-8000-000000000002','d1600000-0000-4000-8000-000000000021')->>'code'='expired','Expired claim');
reset role;

-- Finalize: only the admitted invitation session accepts a Telegram invitation; acceptance activates the binding.
update public.auth_admissions set state='expired'where id=(pg_temp.kv('v2')->>'claimId')::uuid;
update public.real_staff_invitations set status='verified',verified_at=clock_timestamp(),last_requested_at=clock_timestamp()-interval '1 minute'where id='d1600000-0000-4000-8000-000000000010';
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1600000-0000-4000-8000-000000000023','d1600000-0000-4000-8000-000000000002',now(),now());
update auth.sessions set created_at=clock_timestamp()where id='d1600000-0000-4000-8000-000000000021';
select pg_temp.as_service();set local role service_role;
do $$begin perform public.real_staff_finalize_invitation('d1600000-0000-4000-8000-000000000010',1,'d1600000-0000-4000-8000-000000000002','d1600000-0000-4000-8000-000000000023');raise exception 'finalized without admission';exception when insufficient_privilege then null;end$$;
select pg_temp.ok(public.real_staff_finalize_invitation('d1600000-0000-4000-8000-000000000010',1,'d1600000-0000-4000-8000-000000000002','d1600000-0000-4000-8000-000000000021')->>'status'='accepted','The admitted session accepts the invitation');
reset role;
select pg_temp.ok((select active and pending_invitation_id is null from public.telegram_auth_bindings where auth_user_id='d1600000-0000-4000-8000-000000000002'and revoked_at is null),'Acceptance activates the binding');
select pg_temp.ok(public._staff_session_admitted('d1600000-0000-4000-8000-000000000002','d1600000-0000-4000-8000-000000000021'),'The accepted session is an admitted staff session');

-- Review N1: after a rollback to email, a reissued generation (no Telegram link) finalizes as before.
insert into auth.users(id,email,email_confirmed_at)values('d1600000-0000-4000-8000-000000000030','second.doctor@example.invalid',now());
insert into public.workspace_staff(user_id,role,display_name,clinic_id,active)values('d1600000-0000-4000-8000-000000000030','doctor','Dr Second Synthetic','d1600000-0000-4000-8000-000000000004',false);
insert into public.real_staff_invitations(id,email,display_name,clinic_id,issuer_id,expected_auth_user_id,auth_user_id,dispatch_claimed_at,expires_at,generation,delivery,status,verified_at,last_requested_at)
 values('d1600000-0000-4000-8000-000000000031','second.doctor@example.invalid','Dr Second Synthetic','d1600000-0000-4000-8000-000000000004','d1600000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000030','d1600000-0000-4000-8000-000000000030',clock_timestamp(),clock_timestamp()+interval '1 hour',2,'telegram','verified',clock_timestamp(),clock_timestamp()-interval '1 minute');
insert into public.telegram_auth_challenges(token_hash,purpose,target_phone,target_user,issued_by,invitation_id,invitation_generation,expires_at)
 values(repeat('9',64),'staff_invite','+37499016131','d1600000-0000-4000-8000-000000000030','d1600000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000031',1,clock_timestamp()+interval '1 hour');
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1600000-0000-4000-8000-000000000032','d1600000-0000-4000-8000-000000000030',now(),now());
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.real_staff_finalize_invitation('d1600000-0000-4000-8000-000000000031',2,'d1600000-0000-4000-8000-000000000030','d1600000-0000-4000-8000-000000000032')->>'status'='accepted','A generation sent by email finalizes without Telegram');
reset role;

rollback;
\echo 'check-telegram-auth-invites: ok'
