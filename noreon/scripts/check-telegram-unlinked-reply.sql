-- The bot always answers: next step for unlinked chats, link-and-receive when the member can message, rolled back.
-- Synthetic fixtures only; no Telegram, network or provider.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_staff(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_member(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_unl",9007,"user",%s]',u)$$;
create function pg_temp.event(id text,kind text,u bigint,payload jsonb)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_unl",9007,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind',kind,'payload',payload||jsonb_build_object('chatId',u,'messageId',id::bigint))
$$;
create function pg_temp.drain()returns void language plpgsql as $$declare i jsonb;begin
 for i in select jsonb_array_elements(public.channel_inbox_next(50))loop perform public.channel_inbox_process((i#>>'{}')::uuid);end loop;end$$;
-- Link through the T-auth binding (as the owner); the contact proof itself is covered in check-telegram-auth.sql.
create function pg_temp.link(m uuid,u bigint)returns jsonb language plpgsql as $$declare b jsonb;begin
 b:=public._telegram_auth_bind(m,'member',pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(m),u::text,null);
 return public._telegram_replies_activate(m,(b->>'bindingId')::uuid);end$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;

create function pg_temp.say(id text,u bigint,txt text)returns void language plpgsql as $$begin
 perform pg_temp.as_service();set local role service_role;
 perform public.channel_inbox_commit(pg_temp.event(id,'text',u,jsonb_build_object('text',txt)));perform pg_temp.drain();
 reset role;end$$;
create function pg_temp.send(id text,u bigint,k text)returns void language plpgsql as $$begin
 perform pg_temp.as_service();set local role service_role;
 perform public.channel_inbox_commit(pg_temp.event(id,k,u,'{}'));perform pg_temp.drain();
 reset role;end$$;
create function pg_temp.next_hour(u bigint)returns void language sql as $$update public.telegram_auth_messages set created_at=created_at-interval '61 minutes'where principal_ref=pg_temp.principal(u)$$;
create function pg_temp.bind(m uuid,u bigint,k text default 'member')returns jsonb language sql as $$
 select public._telegram_auth_bind(m,k,pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),coalesce(public._auth_phone(m),'+37499020099'),u::text,null)$$;
create function pg_temp.result(p_event text)returns text language sql as $$
 select i.result||coalesce(':'||(select a.detail->>'step'||case when a.detail->>'rateLimited'='true'then '_rate_limited'else ''end
  from public.telegram_audit a where a.kind='bot.next_step'and a.detail->>'inboxId'=i.id::text),'')
 from public.channel_inbox i where i.event_id like '%,'||p_event||']'$$;
create function pg_temp.replies(addr text,tpl text)returns bigint language sql as $$select count(*)from public.telegram_auth_messages where address=addr and template_id=tpl$$;

-- Fixtures: member M (profile, consent, questionnaire done; no review request yet), a doctor, a staff-only account.
insert into auth.users(id,phone,phone_confirmed_at)values('d2000000-0000-4000-8000-000000000001','37499020001',now()),('d2000000-0000-4000-8000-000000000002',null,null),('d2000000-0000-4000-8000-000000000003','37499020003',now());
update public.profiles set display_name='Synthetic member',birth_date='1980-01-01',biological_sex='female',locale='en'where id='d2000000-0000-4000-8000-000000000001';
insert into public.patient_consents(user_id,version)values('d2000000-0000-4000-8000-000000000001','patient-pilot-v1');
insert into public.patient_assessments(user_id,revision,completed_at)values('d2000000-0000-4000-8000-000000000001',2,now());
insert into public.workspace_clinics(id,name)values('d2000000-0000-4000-8000-000000000004','Synthetic unlinked clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d2000000-0000-4000-8000-000000000002','doctor','Dr Unlinked Synthetic','d2000000-0000-4000-8000-000000000004'),('d2000000-0000-4000-8000-000000000003','nurse','Nurse Synthetic','d2000000-0000-4000-8000-000000000004');
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_unl',9007,600,'consent-u');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-unl',3600,600,60,100,false,true);

-- 1. Unknown chat: a sign-up pointer, once per hour.
select pg_temp.say('9101',8101,'hello');select pg_temp.say('9102',8101,'hello again');
select pg_temp.ok(pg_temp.result('9101')='principal_not_linked:signup'and pg_temp.replies('8101','telegram.signup')=1,'Unknown chat gets one sign-up reply');
select pg_temp.ok(pg_temp.result('9102')='principal_not_linked:signup_rate_limited','Rate limited within the hour');

-- 1b. A bare /start and a photo from an unknown chat answer too (results unchanged).
select pg_temp.send('9103',8102,'start');
select pg_temp.ok(pg_temp.result('9103')='ignored_start:signup'and pg_temp.replies('8102','telegram.signup')=1,'Bare /start gets the sign-up reply');
select pg_temp.send('9104',8103,'media');
select pg_temp.ok(pg_temp.result('9104')='principal_not_linked:signup','Photo from an unknown chat gets the sign-up reply');

-- 2. Bound member without a review request (Khikar's case): told to send it, in their language.
select pg_temp.bind('d2000000-0000-4000-8000-000000000001',8201);
select pg_temp.say('9201',8201,'hello');
select pg_temp.ok(pg_temp.result('9201')='principal_not_linked:next_review','Next step: review request');
select pg_temp.ok((select locale='en'and body like '%/patient/review%'and body like '%103%'from public.telegram_auth_messages where address='8201'and template_id='telegram.next_review'),'English copy with the page link and the 103 line');

-- 3. After the review request (case, doctor assigned): the next message links the chat and is received.
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('d2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000002');
select pg_temp.say('9202',8201,'second hello');
select pg_temp.ok(pg_temp.result('9202')='received','Linked now and the message is received');
select pg_temp.ok(exists(select 1 from public.conversation_endpoints where member_id='d2000000-0000-4000-8000-000000000001'and active and consent_source='enrolment'),'Replies link made with enrolment consent');
select pg_temp.ok(exists(select 1 from public.conversation_messages cm join public.conversations c on c.id=cm.conversation_id where c.member_id='d2000000-0000-4000-8000-000000000001'and cm.source='telegram_member'),'Message stored for the doctor');

-- 3b. /start from the linked member: told they can message here.
select pg_temp.next_hour(8201);
select pg_temp.send('9204',8201,'start');
select pg_temp.ok(pg_temp.result('9204')='ignored_start:ready'and pg_temp.replies('8201','telegram.ready')=1,'Linked member /start: ready');

-- 4. The member turned replies off: told how to turn them on, not relinked.
select pg_temp.as_member('d2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.telegram_unlink()->>'unlinked'='true','Member turns replies off');
reset role;
delete from public.telegram_auth_messages where address='8201';
select pg_temp.say('9203',8201,'are you there');
select pg_temp.ok(pg_temp.result('9203')='principal_not_linked:replies_off'and pg_temp.replies('8201','telegram.replies_off')=1,'Replies off: told how to turn them on');
select pg_temp.ok(not exists(select 1 from public.conversation_endpoints where member_id='d2000000-0000-4000-8000-000000000001'and active),'Not relinked against the member''s choice');

-- 4b. A member with a case who cannot message (banned): the generic pointer, never a relink, also for media.
select pg_temp.next_hour(8201);
update auth.users set banned_until=now()+interval '1 day'where id='d2000000-0000-4000-8000-000000000001';
select pg_temp.send('9205',8201,'media');
select pg_temp.ok(pg_temp.result('9205')='principal_not_linked:unavailable'and pg_temp.replies('8201','telegram.signup')=1,'Cannot message: generic pointer');
select pg_temp.ok(not exists(select 1 from public.conversation_endpoints where member_id='d2000000-0000-4000-8000-000000000001'and active),'Still not relinked');
update auth.users set banned_until=null where id='d2000000-0000-4000-8000-000000000001';

-- 5. A chat bound only to a staff account.
select pg_temp.bind('d2000000-0000-4000-8000-000000000003',8301,'staff');
select pg_temp.say('9301',8301,'hi');
select pg_temp.ok(pg_temp.result('9301')='principal_not_linked:staff_chat'and pg_temp.replies('8301','telegram.staff_chat')=1,'Staff chat told it is for sign-in codes');

-- 6. /start from a bound member who can message but is not linked yet: linked now, one message (the link confirmation).
insert into auth.users(id,phone,phone_confirmed_at)values('d2000000-0000-4000-8000-000000000005','37499020005',now());
update public.profiles set display_name='Synthetic member two',birth_date='1981-01-01',biological_sex='male',locale='en'where id='d2000000-0000-4000-8000-000000000005';
insert into public.patient_consents(user_id,version)values('d2000000-0000-4000-8000-000000000005','patient-pilot-v1');
insert into public.patient_assessments(user_id,revision,completed_at)values('d2000000-0000-4000-8000-000000000005',2,now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('d2000000-0000-4000-8000-000000000005','d2000000-0000-4000-8000-000000000002');
select pg_temp.bind('d2000000-0000-4000-8000-000000000005',8501);
select pg_temp.send('9501',8501,'start');
select pg_temp.ok(exists(select 1 from public.conversation_endpoints where member_id='d2000000-0000-4000-8000-000000000005'and active),'Linked by /start');
select pg_temp.ok((select count(*)from public.telegram_auth_messages where address='8501')=0
 and(select count(*)from public.system_messages where member_id='d2000000-0000-4000-8000-000000000005'and template_id='telegram.link_confirmed')=1,'One message (the link confirmation), not two');

rollback;
\echo 'check-telegram-unlinked-reply: ok'
