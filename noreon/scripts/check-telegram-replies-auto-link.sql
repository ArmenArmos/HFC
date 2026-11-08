-- Doctor messaging in Telegram linked automatically at Telegram sign-in (consent from enrolment), rolled back.
-- Synthetic fixtures only; no Telegram, network or provider.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_staff(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_member(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_auto",9006,"user",%s]',u)$$;
create function pg_temp.event(id text,kind text,u bigint,payload jsonb)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_auto",9006,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind',kind,'payload',payload||jsonb_build_object('chatId',u,'messageId',id::bigint))
$$;
create function pg_temp.drain()returns void language plpgsql as $$declare i jsonb;begin
 for i in select jsonb_array_elements(public.channel_inbox_next(50))loop perform public.channel_inbox_process((i#>>'{}')::uuid);end loop;end$$;
-- Link through the T-auth binding (as the owner); the contact proof itself is covered in check-telegram-auth.sql.
-- The Telegram sign-in binding only (as created at sign-in); no reply link.
create function pg_temp.bind(m uuid,u bigint)returns jsonb language sql as $$
 select public._telegram_auth_bind(m,'member',pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(m),u::text,null)$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;


-- Fixtures: A enrolled (case) with Telegram sign-in; B Telegram sign-in, not enrolled yet; C enrolled, no Telegram.
insert into auth.users(id,phone,phone_confirmed_at)values('d1800000-0000-4000-8000-000000000001','37499018001',now()),('d1800000-0000-4000-8000-000000000002','37499018002',now()),('d1800000-0000-4000-8000-000000000003','37499018003',now()),('d1800000-0000-4000-8000-000000000009',null,null);
insert into public.workspace_clinics(id,name)values('d1800000-0000-4000-8000-000000000004','Synthetic auto-link clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d1800000-0000-4000-8000-000000000009','doctor','Dr Auto Synthetic','d1800000-0000-4000-8000-000000000004');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('d1800000-0000-4000-8000-000000000001','d1800000-0000-4000-8000-000000000009'),('d1800000-0000-4000-8000-000000000003',null);
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_auto',9006,600,'consent-a');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-auto',3600,600,60,100,false,true);
insert into public.patient_consents(user_id,version)values('d1800000-0000-4000-8000-000000000001','patient-pilot-v1');
select pg_temp.bind('d1800000-0000-4000-8000-000000000001',8001);
select pg_temp.bind('d1800000-0000-4000-8000-000000000002',8002);

-- 1. Right after Telegram sign-in, an enrolled member is linked for replies; consent from enrolment.
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.telegram_replies_auto_link_for('d1800000-0000-4000-8000-000000000001')->>'result'='linked','Enrolled member linked at sign-in');
select pg_temp.ok(public.telegram_replies_auto_link_for('d1800000-0000-4000-8000-000000000001')->>'result'='already_linked','Second call changes nothing');
reset role;
select pg_temp.ok((select consent_source='enrolment'and consent_version='patient-pilot-v1'and consented_at is not null and generation=1 and active from public.conversation_endpoints where member_id='d1800000-0000-4000-8000-000000000001'),'Endpoint records enrolment consent version and time, linked once');
select pg_temp.ok(not exists(select 1 from public.system_messages where member_id='d1800000-0000-4000-8000-000000000001'and template_id='telegram.replies_auto_linked'),'No notice while its wording is unapproved');
-- Approved wording arrives later: the already-linked member gets the notice once (Fable N-1).
insert into public.system_message_templates(template_id,version,locale,body,approved)values
 ('telegram.replies_auto_linked',100,'en','STAGING. Synthetic notice.',true),('telegram.replies_auto_linked',100,'hy','STAGING. Synthetic notice hy.',true);
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.telegram_replies_auto_link_for('d1800000-0000-4000-8000-000000000001')->>'result'='already_linked','Already linked');
select public.telegram_replies_auto_link_for('d1800000-0000-4000-8000-000000000001');
reset role;
select pg_temp.ok((select count(*)=1 from public.system_messages where member_id='d1800000-0000-4000-8000-000000000001'and template_id='telegram.replies_auto_linked'),'One-time chat notice queued once after approval');
-- The member can write to the bot right away.
select public.channel_inbox_commit(pg_temp.event('801','text',8001,'{"text":"Synthetic hello"}'));select pg_temp.drain();
select pg_temp.ok(exists(select 1 from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='d1800000-0000-4000-8000-000000000001'and m.source='telegram_member'),'Message from the bot reaches the conversation');

-- 2. Not enrolled yet: nothing until enrolment; then linking happens (as the member).
select pg_temp.as_member('d1800000-0000-4000-8000-000000000002','d1800000-0000-4000-8000-000000000012');set local role authenticated;
select pg_temp.ok(public.telegram_replies_auto_link()->>'code'='not_eligible','Not enrolled: not linked');
reset role;
insert into public.patient_clinical_cases(user_id)values('d1800000-0000-4000-8000-000000000002');
select pg_temp.as_member('d1800000-0000-4000-8000-000000000002','d1800000-0000-4000-8000-000000000012');set local role authenticated;
select pg_temp.ok(public.telegram_replies_auto_link()->>'result'='linked','Linked after enrolment');
reset role;

-- 3. No Telegram sign-in: nothing to link.
select pg_temp.as_member('d1800000-0000-4000-8000-000000000003','d1800000-0000-4000-8000-000000000013');set local role authenticated;
select pg_temp.ok(public.telegram_replies_auto_link()->>'code'='telegram_not_connected','No Telegram account: not linked');
select pg_temp.ok(public.telegram_link_status()->>'messagingReady'='true','Status says messaging is switched on');
reset role;

-- 4. The member turns replies off: no automatic relink; their own explicit choice turns them back on.
-- This compares two audit timestamps, so a backward clock step between them fails it: the CI VM on the Mac is stepped by up to
-- about 340 ms under load (lima-guestagent SyncTime, #424 at 17:01:51 on 30 Oct). Half a second keeps the order real.
select pg_sleep(0.5);
select pg_temp.as_member('d1800000-0000-4000-8000-000000000001','d1800000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.telegram_unlink()->>'unlinked'='true','Member turns replies off');
select pg_temp.ok(public.telegram_replies_auto_link()->>'code'='turned_off','No automatic relink after turning off');
reset role;
-- Re-proving the same Telegram account (30-day re-proof) keeps the member's "off".
select pg_temp.bind('d1800000-0000-4000-8000-000000000001',8001);
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.telegram_replies_auto_link_for('d1800000-0000-4000-8000-000000000001')->>'code'='turned_off','Re-proof does not undo turning off');
reset role;
select pg_temp.as_member('d1800000-0000-4000-8000-000000000001','d1800000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.telegram_replies_auto_link(true)->>'result'='linked','Member turns replies back on');
reset role;
select pg_temp.ok((select consent_source='enrolment'from public.conversation_endpoints where member_id='d1800000-0000-4000-8000-000000000001'and active),'Relinked endpoint records consent from enrolment');
select pg_temp.ok((select count(*)=1 from public.system_messages where member_id='d1800000-0000-4000-8000-000000000001'and template_id='telegram.replies_auto_linked'),'Notice is sent only once per member');

-- 5. A binding from another bot is never linked; a reused endpoint row records enrolment consent.
update public.telegram_auth_bindings set account_ref='other-bot'where auth_user_id='d1800000-0000-4000-8000-000000000003';
insert into auth.users(id,phone,phone_confirmed_at)values('d1800000-0000-4000-8000-000000000005','37499018005',now());
insert into public.patient_clinical_cases(user_id)values('d1800000-0000-4000-8000-000000000005');
select pg_temp.bind('d1800000-0000-4000-8000-000000000005',8005);
update public.telegram_auth_bindings set account_ref='["telegram","old_bot",1]'where auth_user_id='d1800000-0000-4000-8000-000000000005'and active;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.telegram_replies_auto_link_for('d1800000-0000-4000-8000-000000000005')->>'code'='unavailable','Binding from another bot is not linked');
reset role;
update public.conversation_endpoints set consent_source='telegram_link',active=false where member_id='d1800000-0000-4000-8000-000000000002';
update public.conversation_endpoints set active=true where member_id='d1800000-0000-4000-8000-000000000002';
select pg_temp.ok((select consent_source='enrolment'from public.conversation_endpoints where member_id='d1800000-0000-4000-8000-000000000002'),'Reactivated endpoint records enrolment consent');

-- 6. Admin queue: B (enrolled, no doctor) writes to the bot and appears; A (has a doctor) does not.
insert into auth.users(id,email)values('d1800000-0000-4000-8000-000000000020','admin.auto@example.invalid');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d1800000-0000-4000-8000-000000000020','admin','Synthetic admin',null);
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1800000-0000-4000-8000-000000000021','d1800000-0000-4000-8000-000000000020',now(),now());
select public.channel_inbox_commit(pg_temp.event('802','text',8002,'{"text":"Synthetic unassigned hello"}'));select pg_temp.drain();
select pg_temp.as_staff('d1800000-0000-4000-8000-000000000020','d1800000-0000-4000-8000-000000000021');set local role authenticated;
select pg_temp.ok((select count(*)=1 from jsonb_array_elements(public.conversation_unassigned_members()->'items')i where i->>'memberId'='d1800000-0000-4000-8000-000000000002'and i->>'channel'='telegram'),'Unassigned member who wrote is listed');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.conversation_unassigned_members()->'items')i where i->>'memberId'='d1800000-0000-4000-8000-000000000001'),'Member with a doctor is not listed');
reset role;
select pg_temp.as_member('d1800000-0000-4000-8000-000000000002','d1800000-0000-4000-8000-000000000012');set local role authenticated;
do $$begin perform public.conversation_unassigned_members();raise exception 'member read the admin queue';exception when insufficient_privilege then null;end$$;
-- 7. Removing the Telegram sign-in account turns replies off; a new account is not relinked automatically.
select pg_temp.ok(public.telegram_auth_unlink()->>'unlinked'='true','Member removes their Telegram account');
reset role;
select pg_temp.bind('d1800000-0000-4000-8000-000000000002',8012);
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.telegram_replies_auto_link_for('d1800000-0000-4000-8000-000000000002')->>'code'='turned_off','New Telegram account after removal: replies stay off');
reset role;

-- 8. Grants: the service entry is not callable by members; nothing for anonymous callers.
select pg_temp.as_member('d1800000-0000-4000-8000-000000000001','d1800000-0000-4000-8000-000000000011');set local role authenticated;
do $$begin perform public.telegram_replies_auto_link_for('d1800000-0000-4000-8000-000000000002');raise exception 'member used service entry';exception when insufficient_privilege then null;end$$;
reset role;
set local role anon;
do $$begin perform public.telegram_replies_auto_link();raise exception 'anon linked';exception when insufficient_privilege then null;end$$;
reset role;

rollback;
\echo 'check-telegram-replies-auto-link: ok'
