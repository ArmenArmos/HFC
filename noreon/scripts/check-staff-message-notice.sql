-- Staff Telegram notice for routine member messages: switch off, recipient selection (assigned
-- doctor, else active admins), enrolled staff only, 10-minute throttle per conversation and
-- recipient, the link button, wording held at claim while unapproved, trace events, and that a
-- notice failure never undoes the member's message. Synthetic fixtures, rolled back.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.as_staff(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_notice",9011,"user",%s]',u)$$;
create function pg_temp.event(id text,u bigint,txt text)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_notice",9011,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind','text','payload',jsonb_build_object('text',txt,'chatId',u,'messageId',id::bigint))
$$;
create function pg_temp.drain()returns void language plpgsql as $$declare i jsonb;begin
 for i in select jsonb_array_elements(public.channel_inbox_next(50))loop perform public.channel_inbox_process((i#>>'{}')::uuid);end loop;end$$;
create function pg_temp.bind(m uuid,kind text,u bigint)returns jsonb language sql as $$
 select public._telegram_auth_bind(m,kind,pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(m),u::text,null)$$;
-- One member message from Telegram (M1 is linked), processed by the inbox as in production.
create function pg_temp.member_says(id text,txt text)returns void language plpgsql as $$begin
 perform pg_temp.as_service();set local role service_role;
 perform public.channel_inbox_commit(pg_temp.event(id,8701,txt));perform pg_temp.drain();
 reset role;end$$;
-- A doctor alert as the inbox records it, for members not linked in this file.
create function pg_temp.alert(m uuid,seq bigint)returns uuid language sql as $$
 insert into public.conversation_doctor_alerts(conversation_id,member_id,doctor_id,message_seq)
 select c.id,m,cs.assigned_doctor_id,seq from public.conversations c join public.patient_clinical_cases cs on cs.user_id=c.member_id where c.member_id=m returning id$$;
create function pg_temp.notices(addr text)returns bigint language sql as $$select count(*)from public.telegram_auth_messages where address=addr and template_id='staff_message.notice'$$;
create function pg_temp.has(m uuid,n text,o text,r text default null)returns boolean language sql as $$
 select exists(select 1 from public.conversation_trace_events where member_id=m and step='doctor_alert'and name=n and outcome=o and(r is null or reason_code=r))$$;
create function pg_temp.denied(sql text)returns boolean language plpgsql as $$begin execute sql;return false;exception when insufficient_privilege then return true;end$$;
grant execute on function pg_temp.denied(text) to authenticated;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;

-- Members: M1 (doctor D1, linked on Telegram), M2 (no doctor), M3 (doctor D2, deactivated), M4 (doctor D3, not enrolled).
-- Staff: D1 enrolled; D2 deactivated but enrolled; D3 not enrolled; admins A1, A2 enrolled, A3 not enrolled, A4 removed but enrolled.
insert into auth.users(id,phone,phone_confirmed_at)values
 ('5e000000-0000-4000-8000-000000000001','37499017001',now()),('5e000000-0000-4000-8000-000000000002','37499017002',now()),
 ('5e000000-0000-4000-8000-000000000003','37499017003',now()),('5e000000-0000-4000-8000-000000000004','37499017004',now()),
 ('5e000000-0000-4000-8000-000000000011','37499017011',now()),('5e000000-0000-4000-8000-000000000012','37499017012',now()),
 ('5e000000-0000-4000-8000-000000000013','37499017013',now()),
 ('5e000000-0000-4000-8000-000000000021','37499017021',now()),('5e000000-0000-4000-8000-000000000022','37499017022',now()),
 ('5e000000-0000-4000-8000-000000000023','37499017023',now()),('5e000000-0000-4000-8000-000000000024','37499017024',now());
insert into public.workspace_clinics(id,name)values('5e000000-0000-4000-8000-000000000030','Synthetic notice clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('5e000000-0000-4000-8000-000000000011','doctor','Dr Notice One','5e000000-0000-4000-8000-000000000030'),
 ('5e000000-0000-4000-8000-000000000012','doctor','Dr Notice Two','5e000000-0000-4000-8000-000000000030'),
 ('5e000000-0000-4000-8000-000000000013','doctor','Dr Notice Three','5e000000-0000-4000-8000-000000000030');
insert into public.workspace_staff(user_id,role,display_name)values
 ('5e000000-0000-4000-8000-000000000021','admin','Admin Notice One'),('5e000000-0000-4000-8000-000000000022','admin','Admin Notice Two'),
 ('5e000000-0000-4000-8000-000000000023','admin','Admin Notice Three'),('5e000000-0000-4000-8000-000000000024','admin','Admin Notice Four');
insert into auth.sessions(id,user_id,created_at,updated_at)values('5e000000-0000-4000-8000-000000000041','5e000000-0000-4000-8000-000000000011',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values
 ('5e000000-0000-4000-8000-000000000001','5e000000-0000-4000-8000-000000000011'),('5e000000-0000-4000-8000-000000000002',null),
 ('5e000000-0000-4000-8000-000000000003','5e000000-0000-4000-8000-000000000012'),('5e000000-0000-4000-8000-000000000004','5e000000-0000-4000-8000-000000000013');
update public.profiles set locale='en'where id in('5e000000-0000-4000-8000-000000000001','5e000000-0000-4000-8000-000000000011');
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_notice',9011,600,'consent-n');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-notice',3600,600,60,100,false,true);
select public._telegram_replies_activate('5e000000-0000-4000-8000-000000000001',(pg_temp.bind('5e000000-0000-4000-8000-000000000001','member',8701)->>'bindingId')::uuid);
select pg_temp.bind('5e000000-0000-4000-8000-000000000011','staff',8711),pg_temp.bind('5e000000-0000-4000-8000-000000000012','staff',8712),
 pg_temp.bind('5e000000-0000-4000-8000-000000000021','staff',8721),pg_temp.bind('5e000000-0000-4000-8000-000000000022','staff',8722),
 pg_temp.bind('5e000000-0000-4000-8000-000000000024','staff',8724);
select pg_temp.ok((select count(*)=5 from public.telegram_auth_bindings where kind='staff'and active),'Fixture: five staff enrolled');
update public.workspace_staff set active=false where user_id='5e000000-0000-4000-8000-000000000012';
update public.workspace_staff set active=false,removed_at=clock_timestamp()where user_id='5e000000-0000-4000-8000-000000000024';
insert into public.conversations(member_id)values('5e000000-0000-4000-8000-000000000002'),('5e000000-0000-4000-8000-000000000003'),('5e000000-0000-4000-8000-000000000004');

-- 1. Switch off: no settings row, then enabled=false. The alert is recorded; nothing is queued.
select pg_temp.member_says('300','Synthetic routine question one');
select pg_temp.ok((select count(*)=1 from public.conversation_doctor_alerts where member_id='5e000000-0000-4000-8000-000000000001'),'Off: the doctor alert is still recorded');
select pg_temp.ok((select count(*)=0 from public.telegram_auth_messages where template_id='staff_message.notice')and not exists(select 1 from public.staff_message_notices),'Off (no row): nothing queued');
select pg_temp.ok(pg_temp.has('5e000000-0000-4000-8000-000000000001','doctor_alert.staff_notice_skipped','skipped','staff_notice_off'),'Off journaled');
insert into public.staff_message_notice_settings(enabled)values(false);
select pg_temp.alert('5e000000-0000-4000-8000-000000000002',1);
select pg_temp.ok((select count(*)=0 from public.telegram_auth_messages where template_id='staff_message.notice'),'Off (enabled=false): nothing queued');

-- 2. On: a Telegram message from M1 notifies the assigned doctor only, with the conversation link.
update public.staff_message_notice_settings set enabled=true;
select pg_temp.member_says('301','Synthetic routine question two');
select pg_temp.ok(pg_temp.notices('8711')=1,'Assigned doctor notified');
select pg_temp.ok(pg_temp.notices('8721')=0 and pg_temp.notices('8722')=0,'Admins not notified when a doctor is assigned');
select pg_temp.ok((select locale='en'and state='queued'and keyboard=jsonb_build_object('kind','open_url','url','https://backoffice.noreon.health/staff/real/conversations/5e000000-0000-4000-8000-000000000001')
 from public.telegram_auth_messages where address='8711'and template_id='staff_message.notice'),'Doctor link opens that conversation, in the doctor''s language');
select pg_temp.ok((select bool_and(body not like '%Synthetic routine%'and body not like '%Notice%')from public.telegram_auth_messages where template_id='staff_message.notice'),'Notice carries no member text or name');
select pg_temp.ok((select recipient_role='doctor'from public.staff_message_notices where recipient_id='5e000000-0000-4000-8000-000000000011'),'Delivery recorded for the doctor');
select pg_temp.ok(pg_temp.has('5e000000-0000-4000-8000-000000000001','doctor_alert.staff_notice_queued','queued','queued_wording_unapproved_will_be_held'),'Queue decision journaled truthfully');

-- 3. Throttle: a second message within 10 minutes is not sent; after 10 minutes it is.
select pg_temp.member_says('302','Synthetic routine question three');
select pg_temp.ok((select count(*)=3 from public.conversation_doctor_alerts where member_id='5e000000-0000-4000-8000-000000000001'),'Every message still records an alert');
select pg_temp.ok(pg_temp.notices('8711')=1,'Second message within 10 minutes: no second notice');
select pg_temp.ok(pg_temp.has('5e000000-0000-4000-8000-000000000001','doctor_alert.staff_notice_skipped','skipped','recently_notified'),'Throttle journaled');
update public.staff_message_notices set created_at=created_at-interval '601 seconds';
select pg_temp.member_says('303','Synthetic routine question four');
select pg_temp.ok(pg_temp.notices('8711')=2,'After 10 minutes the doctor is notified again');

-- 4. Held at claim while the wording or the button label is unapproved.
insert into kv select 'n1',to_jsonb(id)from public.telegram_auth_messages where address='8711'and template_id='staff_message.notice'order by created_at limit 1;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.telegram_auth_message_claim((v#>>'{}')::uuid,gen_random_uuid())->>'code'='template_unapproved','Unapproved wording held at claim')from kv where k='n1';
reset role;
select pg_temp.ok((select state='held'and reason='template_unapproved'from public.telegram_auth_messages where id=(select (v#>>'{}')::uuid from kv where k='n1')),'Message state is held');
select pg_temp.ok(pg_temp.has('5e000000-0000-4000-8000-000000000001','doctor_alert.staff_notice_held','held','template_unapproved'),'Hold journaled on the alert');
update public.system_message_templates set approved=true,approval_note='test fixture'where template_id='staff_message.notice'and locale='en';
insert into kv select 'n2',to_jsonb(id)from public.telegram_auth_messages where address='8711'and template_id='staff_message.notice'and state='queued';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.telegram_auth_message_claim((v#>>'{}')::uuid,gen_random_uuid())->>'code'='template_unapproved','Approved body but unapproved button label: still held')from kv where k='n2';
reset role;
update public.system_message_templates set approved=true,approval_note='test fixture'where template_id='staff_message.open_label'and locale='en';
update public.staff_message_notices set created_at=created_at-interval '601 seconds';
select pg_temp.member_says('304','Synthetic routine question five');
insert into kv select 'n3',to_jsonb(id)from public.telegram_auth_messages where address='8711'and template_id='staff_message.notice'and state='queued';
select pg_temp.as_service();set local role service_role;
insert into kv select 'claim',public.telegram_auth_message_claim((v#>>'{}')::uuid,gen_random_uuid())from kv where k='n3';
reset role;
select pg_temp.ok((select v->>'ok'='true'and v#>>'{envelope,keyboard}'=jsonb_build_object('kind','open_url','label','Open in Noreon','url','https://backoffice.noreon.health/staff/real/conversations/5e000000-0000-4000-8000-000000000001')::text
 and v#>>'{envelope,text}'='UNAPPROVED PLACEHOLDER. You have a new message from a member. Open it in the Noreon staff app.'from kv where k='claim'),'Approved: envelope carries the text, label and link');

-- 5. No assigned doctor: every active, enrolled admin; not the unenrolled or removed one. Unassigned queue link.
select pg_temp.alert('5e000000-0000-4000-8000-000000000002',2);
select pg_temp.ok(pg_temp.notices('8721')=1 and pg_temp.notices('8722')=1,'Both enrolled admins notified');
select pg_temp.ok(pg_temp.notices('8724')=0,'Removed admin not notified');
select pg_temp.ok((select count(*)=2 from public.staff_message_notices n join public.conversations c on c.id=n.conversation_id where c.member_id='5e000000-0000-4000-8000-000000000002'and n.recipient_role='admin'),'Two admin deliveries, none for the unenrolled admin');
select pg_temp.ok((select bool_and(keyboard->>'url'='https://backoffice.noreon.health/staff/real/unassigned')from public.telegram_auth_messages where address in('8721','8722')),'Admin link opens the unassigned queue');
select pg_temp.ok((select locale='hy'from public.telegram_auth_messages where address='8721'limit 1),'Default language is Armenian');
select pg_temp.alert('5e000000-0000-4000-8000-000000000002',3);
select pg_temp.ok(pg_temp.notices('8721')=1,'Admin throttled per conversation');

-- 6. Assigned doctor deactivated: admins instead (not the deactivated doctor), member file link.
select pg_temp.alert('5e000000-0000-4000-8000-000000000003',1);
select pg_temp.ok(pg_temp.notices('8712')=0,'Deactivated doctor not notified');
select pg_temp.ok(pg_temp.notices('8721')=2,'Throttle is per conversation: the admin hears about another member');
select pg_temp.ok((select keyboard->>'url'='https://backoffice.noreon.health/staff/real/members/5e000000-0000-4000-8000-000000000003'from public.telegram_auth_messages where address='8721'order by created_at desc limit 1),'Admin link opens the member file');

-- 7. Assigned doctor not enrolled: nobody is told (no fallback to admins), journaled.
select pg_temp.alert('5e000000-0000-4000-8000-000000000004',1);
select pg_temp.ok((select count(*)=0 from public.staff_message_notices n join public.conversations c on c.id=n.conversation_id where c.member_id='5e000000-0000-4000-8000-000000000004'),'Unenrolled doctor: no notice');
select pg_temp.ok(pg_temp.has('5e000000-0000-4000-8000-000000000004','doctor_alert.staff_notice_skipped','skipped','no_enrolled_staff'),'No enrolled staff journaled');
-- A revoked binding is not enrolled.
update public.telegram_auth_bindings set active=false where auth_user_id='5e000000-0000-4000-8000-000000000011';
update public.staff_message_notices set created_at=created_at-interval '601 seconds';
select pg_temp.member_says('305','Synthetic routine question six');
select pg_temp.ok(pg_temp.notices('8711')=3,'Revoked doctor binding: no new notice');

-- 8. The link button only ever points at a staff app path.
do $$begin
 insert into public.telegram_auth_messages(address,principal_ref,template_id,template_version,locale,body,keyboard)
 values('8711','x','staff_message.notice',1,'en','x','{"kind":"open_url","url":"https://evil.example/phish"}');
 raise exception 'FAIL: a foreign link was accepted';exception when check_violation then null;end$$;
do $$begin
 insert into public.telegram_auth_messages(address,principal_ref,template_id,template_version,locale,body,keyboard)
 values('8711','x','staff_message.notice',1,'en','x','{"kind":"open_url","url":"https://backoffice.noreon.health/staff/real/x","label":"x"}');
 raise exception 'FAIL: an extra keyboard field was accepted';exception when check_violation then null;end$$;

do $$declare k jsonb;begin
 foreach k in array array['{}'::jsonb,'{"kind":"open_url"}'::jsonb,'{"kind":"open_url","url":7}'::jsonb]loop
  begin
   insert into public.telegram_auth_messages(address,principal_ref,template_id,template_version,locale,body,keyboard)values('8711','x','staff_message.notice',1,'en','x',k);
   raise exception 'FAIL: malformed keyboard % was accepted',k;exception when check_violation then null;end;
 end loop;end$$;

-- 9. A notice failure never undoes the member's message.
update public.telegram_auth_bindings set active=true where auth_user_id='5e000000-0000-4000-8000-000000000011';
update public.staff_message_notices set created_at=created_at-interval '601 seconds';
alter table public.staff_message_notices add constraint synthetic_failure check(recipient_role='nobody')not valid;
select pg_temp.member_says('306','Synthetic routine question seven');
select pg_temp.ok((select count(*)=1 from public.conversation_messages where body='Synthetic routine question seven'),'Member message stored despite the notice failure');
select pg_temp.ok(pg_temp.has('5e000000-0000-4000-8000-000000000001','doctor_alert.staff_notice_skipped','skipped','staff_notice_error'),'Failure journaled');
select pg_temp.ok(pg_temp.notices('8711')=3,'Failed notice left nothing queued');
alter table public.staff_message_notices drop constraint synthetic_failure;

-- 10. Staff and members cannot read the settings or the deliveries.
select pg_temp.as_staff('5e000000-0000-4000-8000-000000000011','5e000000-0000-4000-8000-000000000041');set local role authenticated;
select pg_temp.ok(pg_temp.denied('select * from public.staff_message_notices'),'Deliveries not readable by staff');
select pg_temp.ok(pg_temp.denied('select * from public.staff_message_notice_settings'),'Settings not readable by staff');
select pg_temp.ok(pg_temp.denied('select public._staff_message_notice(null::public.conversation_doctor_alerts)'),'Internal notice function not callable');
reset role;

rollback;
\echo 'check-staff-message-notice: ok'
