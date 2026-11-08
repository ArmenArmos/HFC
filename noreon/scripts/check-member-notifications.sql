-- Member journey notices: each event queues exactly one Telegram notice through the auth outbox,
-- nothing while a switch is off or for a member who is not connected, turned Telegram off, uses
-- another bot or is staff; reminders skip cancelled visits and quiet hours; no health content.
-- Fixture rows are written with triggers off (replica) except the notice triggers, which this
-- check sets to fire always. Fictional data; rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.id(n text)returns uuid language sql immutable as $$select('e7a00000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
-- Notices of a member: count by template and outcome.
create function pg_temp.n(m text,tpl text,outcome text default 'queued')returns bigint language sql as $$
 select count(*)from public.member_notices where member_id=pg_temp.id(m)and template_id=tpl and outcome=$3$$;
create function pg_temp.msg(m text,tpl text)returns public.telegram_auth_messages language sql as $$
 select o.* from public.member_notices n join public.telegram_auth_messages o on o.id=n.telegram_message_id where n.member_id=pg_temp.id(m)and n.template_id=tpl order by n.created_at desc limit 1$$;
-- Yerevan wall-clock time on a day relative to today.
create function pg_temp.yvn(days integer,hhmm text)returns timestamptz language sql as $$
 select((((now()at time zone 'Asia/Yerevan')::date+days)::text||' '||hhmm)::timestamp at time zone 'Asia/Yerevan')$$;

-- 0. Privileges.
select pg_temp.ok(not has_function_privilege('authenticated','public.member_notice_reminders_run(timestamptz)','execute')
 and not has_function_privilege('anon','public.member_notice_reminders_run(timestamptz)','execute')
 and not has_function_privilege('service_role','public._member_notice(uuid,text,text,text,jsonb,text,text)','execute')
 and has_function_privilege('service_role','public.member_notice_reminders_run(timestamptz)','execute'),'Reminder sweep is service-only; the notice itself is internal');
select pg_temp.ok((select not booking and not reminders and not results and not care from public.member_notice_settings),'Every group is off by default');

-- Fixtures. Members: 01 connected (en), 02 not connected, 03 turned Telegram off, 04 connected (hy),
-- 05 bound to an old bot, 06 a staff member with a member binding. 08 doctor, 09 nurse (Fictional Anahit).
alter table public.booking_appointment_events enable always trigger member_notice_booking_event;
alter table public.patient_test_requests enable always trigger member_notice_request_changed;
alter table public.patient_test_request_events enable always trigger member_notice_request_event;
alter table public.patient_care_lab_stages enable always trigger member_notice_lab_stage;
alter table public.clinic_result_attachments enable always trigger member_notice_result_attached;
alter table public.patient_clinical_cases enable always trigger member_notice_case_review;
alter table public.patient_consultation_arrangements enable always trigger member_notice_consultation_arranged;
alter table public.patient_document_release_events enable always trigger member_notice_document_released;
alter table public.patient_care_plan_versions enable always trigger member_notice_plan_version;
set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),'3749907'||n||'00',now()from unnest(array['01','02','03','04','05','06','08','09'])n;
insert into public.profiles(id,locale,display_name)select pg_temp.id(n),case when n='04'then 'hy'else 'en'end,'Fictional member '||n from unnest(array['01','02','03','04','05','06'])n
 on conflict(id)do update set locale=excluded.locale,display_name=excluded.display_name;
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_mn',9011,600,'consent-mn');
insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
select pg_temp.id(n),'member','fictional-member-'||n,case when n='05'then '["old_bot",1]'else(select public._telegram_account_ref(s)from public.telegram_channel_settings s)end,'+3749907'||n||'00','55507'||n,1
from unnest(array['01','03','04','05','06'])n;
insert into public.telegram_audit(member_id,kind,detail)values(pg_temp.id('03'),'link.redeemed','{}');
insert into public.telegram_audit(member_id,kind,detail,created_at)values(pg_temp.id('03'),'link.unlinked','{}',clock_timestamp()+interval '1 second');
insert into public.workspace_clinics(id,name,address)values(pg_temp.id('90'),'Fictional Clinic','1 Fictional Street');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.id('06'),'admin','Fictional admin',null),(pg_temp.id('08'),'doctor','Fictional doctor',pg_temp.id('90')),(pg_temp.id('09'),'nurse','Anahit Fictional',pg_temp.id('90'));
insert into public.patient_clinical_cases(user_id,assigned_nurse_id)select pg_temp.id(n),case when n='01'then pg_temp.id('09')end from unnest(array['01','02','03','04','05','06'])n
 on conflict(user_id)do update set assigned_nurse_id=excluded.assigned_nurse_id;
-- Appointments: 11 (member 01), 12 (02), 13 (03), 14 (04), 15 (05), 16 (06), 17 (01, for a change).
create function pg_temp.appt(n text,m text,status text,starts timestamptz)returns void language sql as $$
 insert into public.booking_appointments(id,member_id,program_id,requirements_token,status,current_arrangement,proposed_arrangement,proposed_reservation_id,notice_id)
 values(pg_temp.id(n),pg_temp.id(m),gen_random_uuid(),'tok-'||n,status,
  case when status='confirmed'then jsonb_build_object('clinicId',pg_temp.id('90'),'mode','clinic','startsAt',starts,'endsAt',starts+interval '30 minutes')end,
  jsonb_build_object('clinicId',pg_temp.id('90'),'mode','clinic','startsAt',starts,'endsAt',starts+interval '30 minutes'),gen_random_uuid(),gen_random_uuid())$$;
select pg_temp.appt(x.n,x.m,'confirmed',pg_temp.yvn(3,'10:30'))from(values('11','01'),('12','02'),('13','03'),('14','04'),('15','05'),('16','06'),('17','01'))x(n,m);
-- One scheduling notice per event: purpose booking (n||'a') and change (n||'b').
insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,channel,purpose,state)
select pg_temp.id(x.n),pg_temp.id(x.a),x.r,gen_random_uuid(),gen_random_uuid(),pg_temp.id('90'),1,'portal',x.p,'accepted'
from(values('31','11','booking',1),('32','12','booking',1),('33','13','booking',1),('34','14','booking',1),('35','15','booking',1),('36','16','booking',1),('37','17','change',2),('38','11','booking',2),('39','11','cancellation',3),('40','17','cancellation',3))x(n,a,p,r);
reset session_replication_role;
set local session_replication_role=replica;

-- 1. Off by default: the clinic confirms and nothing is queued.
insert into public.booking_appointment_events(id,appointment_id,revision,kind,notice_id)values(pg_temp.id('51'),pg_temp.id('11'),1,'clinic-confirmed',pg_temp.id('31'));
select pg_temp.ok(not exists(select 1 from public.member_notices)and not exists(select 1 from public.telegram_auth_messages where template_id like 'member.%'),'Switch off: nothing queued');

-- 2. Booking on (no throttle for now): each event queues one notice.
update public.member_notice_settings set booking=true,throttle_seconds=0,hourly_cap=60;
insert into public.booking_appointment_events(id,appointment_id,revision,kind,notice_id)values(pg_temp.id('52'),pg_temp.id('11'),1,'clinic-confirmed',pg_temp.id('31'));
select pg_temp.ok(pg_temp.n('01','member.booking_confirmed')=1,'Confirmed: one notice');
select pg_temp.ok((select m.address='5550701'and m.locale='en'and m.params->>'clinic'='Fictional Clinic'and m.params->>'time'='10:30'
 and m.params->>'date'~'^[A-Z][a-z]+day [0-9]{1,2} [A-Z][a-z]+$'and m.keyboard=jsonb_build_object('kind','open_url','url','https://app.noreon.health/patient/care')
 and m.body like '%{date}%{time}%{clinic}%'and m.state='queued'from pg_temp.msg('01','member.booking_confirmed')m),'Confirmed: address, params, button to the app');
select pg_temp.ok((select l.step='open_care'and l.state='pending'from public.telegram_signin_links l where l.message_id=(pg_temp.msg('01','member.booking_confirmed')).id),'Confirmed: one-tap sign-in link attached');
-- Retries never duplicate: the same event key decides once.
select pg_temp.ok(public._member_notice_safe(pg_temp.id('01'),'booking','member.booking_confirmed','booking:'||pg_temp.id('52')::text,'{}','/patient/care','open_care')is null
 and pg_temp.n('01','member.booking_confirmed')=1 and(select count(*)from public.member_notices where event_key='booking:'||pg_temp.id('52')::text)=1,'Same event: one notice only');
-- A change confirmed by the clinic: rescheduled. Declined: declined, no params.
insert into public.booking_appointment_events(id,appointment_id,revision,kind,notice_id)values(pg_temp.id('53'),pg_temp.id('17'),2,'clinic-confirmed',pg_temp.id('37'));
select pg_temp.ok(pg_temp.n('01','member.booking_rescheduled')=1,'Change confirmed: rescheduled');
insert into public.booking_appointment_events(id,appointment_id,revision,kind,notice_id)values(pg_temp.id('54'),pg_temp.id('11'),2,'clinic-declined',pg_temp.id('38'));
select pg_temp.ok(pg_temp.n('01','member.booking_declined')=1 and(pg_temp.msg('01','member.booking_declined')).params is null,'Declined: one notice, no params');
-- Cancelled: by staff, one notice; by the member themself, nothing.
insert into public.booking_appointment_versions(appointment_id,revision,program_id,proposed_arrangement,notice_id,actor_id)
 values(pg_temp.id('11'),3,gen_random_uuid(),'{}',pg_temp.id('39'),pg_temp.id('06')),(pg_temp.id('17'),3,gen_random_uuid(),'{}',pg_temp.id('40'),pg_temp.id('01'));
insert into public.booking_appointment_events(id,appointment_id,revision,kind,notice_id)values(pg_temp.id('55'),pg_temp.id('11'),3,'cancelled',pg_temp.id('39')),(pg_temp.id('56'),pg_temp.id('17'),3,'cancelled',pg_temp.id('40'));
select pg_temp.ok(pg_temp.n('01','member.booking_cancelled')=1,'Cancelled by staff: one notice; by the member: none');
-- Other events (the member's own request or acceptance) send nothing.
insert into public.booking_appointment_events(id,appointment_id,revision,kind,notice_id)values(pg_temp.id('57'),pg_temp.id('11'),4,'selected',pg_temp.id('38'));
select pg_temp.ok((select count(*)from public.member_notices where member_id=pg_temp.id('01'))=4,'Member-made changes: nothing');

-- 3. Who gets nothing: not connected, turned off, another bot, staff account. Each decision is journaled.
insert into public.booking_appointment_events(id,appointment_id,revision,kind,notice_id)values
 (pg_temp.id('62'),pg_temp.id('12'),1,'clinic-confirmed',pg_temp.id('32')),(pg_temp.id('63'),pg_temp.id('13'),1,'clinic-confirmed',pg_temp.id('33')),
 (pg_temp.id('65'),pg_temp.id('15'),1,'clinic-confirmed',pg_temp.id('35')),(pg_temp.id('66'),pg_temp.id('16'),1,'clinic-confirmed',pg_temp.id('36'));
select pg_temp.ok((select string_agg(right(member_id::text,2)||'='||reason,',' order by member_id)from public.member_notices where member_id in(pg_temp.id('02'),pg_temp.id('03'),pg_temp.id('05'),pg_temp.id('06')))
 ='02=not_connected,03=turned_off,05=other_bot,06=staff_account','Skipped with the reason');
select pg_temp.ok(not exists(select 1 from public.telegram_auth_messages where address in('5550702','5550703','5550705','5550706')),'Skipped members: nothing in the outbox');

-- 4. Armenian: the member's language, Armenian date.
insert into public.booking_appointment_events(id,appointment_id,revision,kind,notice_id)values(pg_temp.id('64'),pg_temp.id('14'),1,'clinic-confirmed',pg_temp.id('34'));
select pg_temp.ok((select m.locale='hy'and m.params->>'date'~'^[0-9]{1,2} [ա-ֆ]+, [ա-ֆ]+$'from pg_temp.msg('04','member.booking_confirmed')m),'Armenian notice and date');

-- Placeholder staff names use the anonymous notice, including when the first name looks real.
update public.workspace_staff set display_name='Anahit STAGING Test Nurse' where user_id=pg_temp.id('09');
select pg_temp.ok(public._member_notice_nurse_name(pg_temp.id('01'))is null,'No staging name in a SQL-built member notice');
update public.workspace_staff set display_name='Anahit TEST' where user_id=pg_temp.id('09');
select pg_temp.ok(public._member_notice_nurse_name(pg_temp.id('01'))is null,'Whole-word test is hidden in any case');
update public.workspace_staff set display_name='Testament Anahit' where user_id=pg_temp.id('09');
select pg_temp.ok(public._member_notice_nurse_name(pg_temp.id('01'))='Testament','Partial words are real names');
update public.workspace_staff set display_name='Anahit Fictional' where user_id=pg_temp.id('09');
select pg_temp.ok(public._member_notice_nurse_name(pg_temp.id('01'))='Anahit','Real nurse name still shown');

-- 5. Home visits: received, arranged (nurse's first name), cancelled by staff.
insert into public.patient_test_requests(id,user_id,revision,status,requested_terms,requirements,algorithm_version,context_token,create_payload)
 values(pg_temp.id('71'),pg_temp.id('01'),0,'requested','{"mode":"home"}','[]','v','t','{}'),(pg_temp.id('72'),pg_temp.id('01'),0,'requested','{"mode":"clinic"}','[]','v','t','{}');
select pg_temp.ok(pg_temp.n('01','member.home_received')=1,'Home request received: one notice; a clinic request: none');
update public.patient_test_requests set status='confirmed',revision=1,current_arrangement=jsonb_build_object('provider','Fictional nurse service',
 'terms',jsonb_build_object('mode','home','startsAt',pg_temp.yvn(3,'11:00'),'endsAt',pg_temp.yvn(3,'13:00'),'timezone','Asia/Yerevan','location','1 Fictional Home Street'))where id=pg_temp.id('71');
select pg_temp.ok((select m.params->>'nurse'='Anahit'and m.params->>'time'='11:00'and m.params->>'end_time'='13:00'and not m.params?'clinic'
 and m.params::text not like '%Fictional Home%'from pg_temp.msg('01','member.home_arranged')m),'Home arranged: window and the nurse''s first name, no address');
update public.patient_test_requests set updated_at=now()where id=pg_temp.id('71');
select pg_temp.ok(pg_temp.n('01','member.home_arranged')=1,'Home arranged once per revision');
update public.patient_test_requests set status='cancelled',revision=2 where id=pg_temp.id('71');
insert into public.patient_test_request_events(request_id,command_id,actor_id,revision,operation,payload,result)values(pg_temp.id('71'),gen_random_uuid(),pg_temp.id('06'),2,'cancel','{}','{}');
select pg_temp.ok(pg_temp.n('01','member.request_cancelled')=1,'Request cancelled by staff: one notice');

-- 6. Reminders: off, then the day before (18:00 to 21:00) and 2 hours before; quiet hours; cancelled.
select pg_temp.as_service();
select pg_temp.ok(public.member_notice_reminders_run(pg_temp.yvn(2,'18:30'))->>'state'='off','Reminders off: nothing');
update public.member_notice_settings set reminders=true;
reset session_replication_role;set local session_replication_role=replica;
-- 81: confirmed tomorrow 12:00 (member 04); 82: cancelled tomorrow 12:00 (member 04); 83: tomorrow 09:30 (member 04).
select pg_temp.appt('81','04','confirmed',pg_temp.yvn(3,'12:00'));select pg_temp.appt('82','04','cancelled',pg_temp.yvn(3,'12:00'));select pg_temp.appt('83','04','confirmed',pg_temp.yvn(3,'09:30'));
select pg_temp.ok((public.member_notice_reminders_run(pg_temp.yvn(2,'17:30'))->>'queued')::int=0,'Before 18:00 the day before: nothing');
select pg_temp.ok(public.member_notice_reminders_run(pg_temp.yvn(2,'21:15'))->>'state'='quiet_hours','After 21:00: quiet hours');
select pg_temp.ok((public.member_notice_reminders_run(pg_temp.yvn(2,'18:30'))->>'queued')::int>=2,'Day before at 18:30: queued');
select public.member_notice_reminders_run(pg_temp.yvn(2,'18:35'));
select pg_temp.ok((select count(*)from public.member_notices where event_key like 'reminder.tomorrow:booking:'||pg_temp.id('81')::text||':%')=1
 and not exists(select 1 from public.member_notices where event_key like 'reminder.%'||pg_temp.id('82')::text||'%'),'Day before: once, never for a cancelled visit');
select pg_temp.ok(public.member_notice_reminders_run(pg_temp.yvn(3,'07:45'))->>'state'='quiet_hours'
 and not exists(select 1 from public.member_notices where event_key like 'reminder.soon:booking:'||pg_temp.id('83')::text||':%'),'A 09:30 visit: no reminder in quiet hours');
select public.member_notice_reminders_run(pg_temp.yvn(3,'10:15'));
select pg_temp.ok((select count(*)from public.member_notices where event_key like 'reminder.soon:booking:'||pg_temp.id('81')::text||':%'and outcome='queued')=1
 and(select count(*)from public.member_notices where event_key like 'reminder.soon:booking:'||pg_temp.id('82')::text||':%')=0,'Two hours before: once; cancelled: none');
select pg_temp.ok((select m.params->>'time'='12:00'and m.params->>'clinic'='Fictional Clinic'and m.locale='hy'from pg_temp.msg('04','member.reminder_visit_soon')m),'Soon reminder carries time and clinic');
-- A moved visit gets its own reminders; the old time's are not resent.
update public.booking_appointments set current_arrangement=jsonb_set(current_arrangement,'{startsAt}',to_jsonb(pg_temp.yvn(3,'12:30')))where id=pg_temp.id('81');
select public.member_notice_reminders_run(pg_temp.yvn(3,'10:35'));
select pg_temp.ok((select count(*)from public.member_notices where event_key like 'reminder.soon:booking:'||pg_temp.id('81')::text||':%')=2,'Moved visit: a reminder for the new time');

-- 7. Results: one notice per visit for samples at the lab and for results received (stage or PDF).
update public.member_notice_settings set results=true;
insert into public.patient_care_visit_entries(id,user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id)
select pg_temp.id(n),pg_temp.id('01'),pg_temp.id('91'),gen_random_uuid(),p,'{"kind":"collection","outcome":"collected","testId":"lipid-panel"}','now',now(),pg_temp.id('09'),'Fictional','nurse',pg_temp.id('90')
from(values('92',1),('93',2))x(n,p);
insert into public.patient_care_lab_stages(user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id)
values(pg_temp.id('01'),pg_temp.id('92'),'at-lab',gen_random_uuid(),now(),pg_temp.id('09'),'Fictional','nurse',pg_temp.id('90')),
 (pg_temp.id('01'),pg_temp.id('93'),'at-lab',gen_random_uuid(),now(),pg_temp.id('09'),'Fictional','nurse',pg_temp.id('90'));
select pg_temp.ok(pg_temp.n('01','member.samples_at_lab')=1,'Two samples at the lab: one notice');
insert into public.clinic_result_attachments(id,file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id)values(pg_temp.id('94'),gen_random_uuid(),pg_temp.id('90'),pg_temp.id('01'),pg_temp.id('91'),'noreon-admin',pg_temp.id('06'),gen_random_uuid());
insert into public.patient_care_lab_stages(user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id)
values(pg_temp.id('01'),pg_temp.id('92'),'results-received',gen_random_uuid(),now(),pg_temp.id('09'),'Fictional','nurse',pg_temp.id('90'));
select pg_temp.ok(pg_temp.n('01','member.results_received')=0,'PDF attached and results stage: no member notice');

-- 8. Care: consultation needed (once per hold), arranged, document released (not withdrawn), plan ready then updated.
update public.member_notice_settings set care=true;
update public.doctor_completion_capabilities set enabled=true;
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.id('08'),review=jsonb_build_object('preparedAt',now(),'consultation',jsonb_build_object('decision','required'))where user_id=pg_temp.id('01');
update public.patient_clinical_cases set review=review||'{"note":"edited"}'where user_id=pg_temp.id('01');
select pg_temp.ok(pg_temp.n('01','member.consultation_needed')=1,'Consultation needed: once per hold');
select pg_temp.ok(not exists(select 1 from public.telegram_auth_messages o join public.member_notices n on n.telegram_message_id=o.id
 where n.template_id='member.consultation_needed'and(o.params is not null or o.body ~* 'edited|required')),'Consultation notice carries no reason');
insert into public.patient_consultation_arrangements(id,user_id,hold_since,scheduled_at,channel,actor_id,submission_id)values(pg_temp.id('95'),pg_temp.id('01'),now(),pg_temp.yvn(4,'15:00'),'phone',pg_temp.id('06'),gen_random_uuid());
select pg_temp.ok((select m.params->>'time'='15:00'and not m.params?'clinic'and m.keyboard->>'url'like '%/patient/dashboard'from pg_temp.msg('01','member.consultation_phone')m),'Phone consultation: date and time');
insert into public.patient_document_release_events(user_id,file_id,attachment_id,kind,single_member_confirmed,actor_id,submission_id)values
 (pg_temp.id('01'),gen_random_uuid(),pg_temp.id('94'),'released',true,pg_temp.id('08'),gen_random_uuid()),(pg_temp.id('01'),gen_random_uuid(),pg_temp.id('94'),'withdrawn',false,pg_temp.id('08'),gen_random_uuid());
select pg_temp.ok(pg_temp.n('01','member.document_released')=0,'Document released or withdrawn: no member notice');
insert into public.patient_care_plan_versions(plan_id,user_id,version)values(gen_random_uuid(),pg_temp.id('01'),1),(gen_random_uuid(),pg_temp.id('01'),2);
select pg_temp.ok(pg_temp.n('01','member.plan_ready')=1 and pg_temp.n('01','member.plan_updated')=1,'Plan ready, then updated');

-- 9. Throttle and hourly cap.
update public.member_notice_settings set throttle_seconds=600;
insert into public.patient_care_plan_versions(plan_id,user_id,version)values(gen_random_uuid(),pg_temp.id('01'),3);
select pg_temp.ok(pg_temp.n('01','member.plan_updated','skipped')=1 and(select reason from public.member_notices where template_id='member.plan_updated'and outcome='skipped')='throttled','Same notice within 10 minutes: throttled');
update public.member_notice_settings set throttle_seconds=0,hourly_cap=2;
insert into public.patient_care_plan_versions(plan_id,user_id,version)values(gen_random_uuid(),pg_temp.id('04'),1);
select pg_temp.ok((select reason from public.member_notices where member_id=pg_temp.id('04')and template_id='member.plan_ready')='hourly_cap','Hourly cap per member');

-- 10. Never raises: a bad notice is traced and returns nothing.
update public.member_notice_settings set hourly_cap=60;
select pg_temp.ok(public._member_notice_safe(pg_temp.id('04'),'care','member.plan_ready','care.plan:bad','{"value":"120/80"}','/patient/results',null)is null,'A failing notice returns nothing');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where subject_kind='member_notice'and subject_id='care.plan:bad'and outcome='failed'),'A failing notice never raises');

-- 11. Claim: unapproved v1 is held; approved copy renders params and the member button.
select pg_temp.ok((public.telegram_auth_message_claim((pg_temp.msg('01','member.booking_declined')).id,gen_random_uuid()))->>'code'='template_unapproved','Unapproved wording is held');
insert into public.system_message_templates(template_id,version,locale,body,approved)values
 ('member.booking_cancelled',100,'en','TEST. Your visit on {date} at {time} was cancelled.',true),('member_notice.open_label',100,'en','Open Noreon',true);
update public.member_notice_settings set booking=true,throttle_seconds=0,hourly_cap=60;
select public._member_notice_safe(pg_temp.id('01'),'booking','member.booking_cancelled','booking:test-claim',public._member_notice_visit(pg_temp.id('01'),pg_temp.yvn(3,'10:30'),null,null),'/patient/care',null);
select pg_temp.ok((select c->'envelope'->>'text'~'^TEST\. Your visit on [A-Z][a-z]+day [0-9]{1,2} [A-Z][a-z]+ at 10:30 was cancelled\.$'
 and c->'envelope'->'keyboard'=jsonb_build_object('kind','open_url','label','Open Noreon','url','https://app.noreon.health/patient/care')
 from(select public.telegram_auth_message_claim(id,gen_random_uuid())c from public.telegram_auth_messages where id=(select telegram_message_id from public.member_notices where event_key='booking:test-claim'))x),'Approved copy: params rendered, member button');
select public._member_notice_safe(pg_temp.id('01'),'booking','member.booking_cancelled','booking:test-missing','{}','/patient/care',null);
select pg_temp.ok((public.telegram_auth_message_claim((select telegram_message_id from public.member_notices where event_key='booking:test-missing'),gen_random_uuid()))->>'code'='params_missing','A placeholder without a value is held');

-- Freshness (review F1): a member notice is still sent after 2 hours; a reminder expires after 30 minutes; a staff notice after 15.
insert into public.system_message_templates(template_id,version,locale,body,approved)values('member.reminder_visit_soon',100,'en','TEST. Reminder at {time} at {clinic}.',true);
insert into public.telegram_auth_messages(id,address,principal_ref,template_id,template_version,locale,body,params,created_at)values
 (pg_temp.id('a1'),'5550701','fictional-member-01','member.reminder_visit_soon',100,'en','TEST. Reminder at {time} at {clinic}.','{"time":"10:30","clinic":"Fictional Clinic"}',clock_timestamp()-interval '40 minutes'),
 (pg_temp.id('a2'),'5550701','fictional-member-01','member.booking_cancelled',100,'en','TEST. Your visit on {date} at {time} was cancelled.','{"date":"Monday 1 June","time":"10:30"}',clock_timestamp()-interval '2 hours');
select pg_temp.ok((public.telegram_auth_message_claim(pg_temp.id('a1'),gen_random_uuid()))->>'code'='expired','A 40-minute-old reminder is not sent');
select pg_temp.ok((public.telegram_auth_message_claim(pg_temp.id('a2'),gen_random_uuid()))->>'ok'='true','A 2-hour-old member notice is still sent');
insert into public.system_message_templates(template_id,version,locale,body,approved)values('staff_message.notice',100,'en','TEST staff notice.',true);
insert into public.telegram_auth_messages(id,address,principal_ref,template_id,template_version,locale,body,created_at)values(pg_temp.id('a3'),'5550706','fictional-member-06','staff_message.notice',100,'en','TEST staff notice.',clock_timestamp()-interval '16 minutes');
select pg_temp.ok((public.telegram_auth_message_claim(pg_temp.id('a3'),gen_random_uuid()))->>'code'='expired','Staff notices keep the 15-minute window');

-- 12. No result values or judgements. Collection exceptions may name tests; other notices keep visit-only params.
do $$begin
 insert into public.telegram_auth_messages(address,principal_ref,template_id,template_version,locale,body,params)values('5550701','x','member.plan_ready',1,'en','x','{"value":"5.4"}');
 raise exception 'FAIL: a params value outside the allowed names was accepted';
exception when check_violation then null;end$$;
select pg_temp.ok(not exists(select 1 from public.system_message_templates where(template_id like 'member.%'or template_id='booking.clinic_proposal')
 and(body ~* 'mmol|mg/dl|glucose|cholesterol|pressure|diagnos|abnormal|positive|negative|risk'
  or exists(select 1 from regexp_matches(body,'\{([a-z_]+)\}','g')p where p[1]not in('date','time','end_time','clinic','nurse')and not(template_id='member.samples_collected_exceptions'and p[1]='collection_tests')))),'Wording carries no health content and only allowed placeholders');
select pg_temp.ok(not exists(select 1 from public.telegram_auth_messages where template_id like 'member.%'and params is not null
 and exists(select 1 from jsonb_each_text(params)e where e.value ~* 'lipid|result|[0-9]+(\.[0-9]+)? ?(mmol|mg)')),'Queued params carry no test names or values');

-- 13. Every queued notice is a queued outbox message (delivery states and trace in the existing pipeline).
select pg_temp.ok(not exists(select 1 from public.member_notices n left join public.telegram_auth_messages o on o.id=n.telegram_message_id where n.outcome='queued'and o.id is null)
 and exists(select 1 from public.conversation_trace_events where subject_kind='member_notice'and outcome='queued'),'Queued notices are outbox messages and traced');

-- 14. Astra A4-1/3/4 (20 Oct audit): a notice is re-checked when the dispatcher claims it.
insert into public.system_message_templates(template_id,version,locale,body,approved)values('member.reminder_medicine',100,'en','TEST. Medicine at {time}.',true);
create function pg_temp.q(id text,m text,addr text,tpl text,body text,k text,params jsonb)returns uuid language plpgsql as $$begin
 insert into public.telegram_auth_messages(id,address,principal_ref,template_id,template_version,locale,body,params)values(pg_temp.id(id),addr,'fictional-member-'||m,tpl,100,'en',body,params);
 insert into public.member_notices(member_id,event_key,notice_group,template_id,outcome,reason,telegram_message_id)values(pg_temp.id(m),k,'reminders',tpl,'queued','queued',pg_temp.id(id));
 return pg_temp.id(id);end$$;
create function pg_temp.claim(id text)returns jsonb language sql as $$select public.telegram_auth_message_claim(pg_temp.id(id),gen_random_uuid())$$;
create function pg_temp.yl(h integer)returns text language sql as $$select to_char((clock_timestamp()at time zone 'Asia/Yerevan')+make_interval(hours=>h),'HH24:00')$$;
set local session_replication_role=replica;
-- Member 01: quiet hours well away from now; member 04: quiet hours around now.
insert into public.patient_reminder_preferences(user_id,preferences)values
 (pg_temp.id('01'),jsonb_build_object('quietStart',pg_temp.yl(3),'quietEnd',pg_temp.yl(4))),
 (pg_temp.id('04'),jsonb_build_object('quietStart',pg_temp.yl(-1),'quietEnd',pg_temp.yl(2)))
 on conflict(user_id)do update set preferences=excluded.preferences;
select pg_temp.appt(x.n,'01',x.s,pg_temp.yvn(1,'11:00'))from(values('c1','confirmed'),('c2','cancelled'),('c3','confirmed'))x(n,s);
insert into public.member_medicines(id,user_id,name,times,started_on)values(pg_temp.id('d1'),pg_temp.id('01'),'Fictional medicine',array['08:00'::time],current_date-5);
select pg_temp.q('e1','01','5550701','member.reminder_visit_soon','TEST. Reminder at {time} at {clinic}.','reminder.soon:booking:'||pg_temp.id('c1')||':'||extract(epoch from pg_temp.yvn(1,'11:00'))::bigint,public._member_notice_visit(pg_temp.id('01'),pg_temp.yvn(1,'11:00'),null,'Fictional Clinic'));
select pg_temp.q('e2','01','5550701','member.reminder_visit_soon','TEST. Reminder at {time} at {clinic}.','reminder.soon:booking:'||pg_temp.id('c2')||':'||extract(epoch from pg_temp.yvn(1,'11:00'))::bigint,public._member_notice_visit(pg_temp.id('01'),pg_temp.yvn(1,'11:00'),null,'Fictional Clinic'));
select pg_temp.q('e3','01','5550701','member.reminder_visit_soon','TEST. Reminder at {time} at {clinic}.','reminder.soon:booking:'||pg_temp.id('c3')||':'||extract(epoch from pg_temp.yvn(1,'11:00'))::bigint,public._member_notice_visit(pg_temp.id('01'),pg_temp.yvn(1,'11:00'),null,'Fictional Clinic'));
select pg_temp.q('e4','04','5550704','member.reminder_visit_soon','TEST. Reminder at {time} at {clinic}.','reminder.soon:booking:'||pg_temp.id('14')||':'||extract(epoch from pg_temp.yvn(3,'10:30'))::bigint,public._member_notice_visit(pg_temp.id('04'),pg_temp.yvn(3,'10:30'),null,'Fictional Clinic'));
select pg_temp.q('e5','01','5550701','member.reminder_medicine','TEST. Medicine at {time}.','medicine:'||pg_temp.id('01')||':'||extract(epoch from public._member_medicine_due((clock_timestamp()at time zone 'Asia/Yerevan')::date,'08:00'))::bigint,'{"time":"08:00"}');
select pg_temp.q('e6','01','5550701','member.reminder_medicine','TEST. Medicine at {time}.','medicine:'||pg_temp.id('01')||':'||extract(epoch from public._member_medicine_due((clock_timestamp()at time zone 'Asia/Yerevan')::date-1,'08:00'))::bigint,'{"time":"08:00"}');
insert into public.member_medicine_doses(medicine_id,user_id,due_at,status)values(pg_temp.id('d1'),pg_temp.id('01'),public._member_medicine_due((clock_timestamp()at time zone 'Asia/Yerevan')::date-1,'08:00'),'taken');
insert into public.workspace_clinics(id,name,address)values(pg_temp.id('91'),'Other Fictional Clinic','2 Fictional Street');
select pg_temp.appt('c4','01','confirmed',pg_temp.yvn(1,'11:00'));
select pg_temp.q('ec','01','5550701','member.reminder_visit_soon','TEST. Reminder at {time} at {clinic}.','reminder.soon:booking:'||pg_temp.id('c4')||':'||extract(epoch from pg_temp.yvn(1,'11:00'))::bigint,public._member_notice_visit(pg_temp.id('01'),pg_temp.yvn(1,'11:00'),null,'Fictional Clinic'));
update public.booking_appointments set current_arrangement=jsonb_set(current_arrangement,'{clinicId}',to_jsonb(pg_temp.id('91')::text))where id=pg_temp.id('c4');
select pg_temp.q('e7','01','5550799','member.reminder_visit_soon','TEST. Reminder at {time} at {clinic}.','reminder.soon:booking:'||pg_temp.id('c1')||':1',public._member_notice_visit(pg_temp.id('01'),pg_temp.yvn(1,'11:00'),null,'Fictional Clinic'));
-- The visit c3 moves after its reminder was queued.
update public.booking_appointments set current_arrangement=jsonb_set(current_arrangement,'{startsAt}',to_jsonb(pg_temp.yvn(1,'15:00')))where id=pg_temp.id('c3');
set local session_replication_role=origin;
select pg_temp.as_service();
select pg_temp.ok(pg_temp.claim('e1')->>'ok'='true','A current visit reminder outside quiet hours is sent');
select pg_temp.ok(pg_temp.claim('e2')->>'code'='event_changed','A reminder for a visit cancelled since is held');
select pg_temp.ok(pg_temp.claim('e3')->>'code'='event_changed','A reminder for a visit moved since is held');
select pg_temp.ok(pg_temp.claim('e4')->>'code'='quiet_hours'and(select state='queued'from public.telegram_auth_messages where id=pg_temp.id('e4')),'A reminder inside the member''s own quiet hours waits (stays queued)');
select pg_temp.ok(not(public.telegram_auth_message_queue(50)?pg_temp.id('e4')::text)and exists(select 1 from public.telegram_auth_messages where state='queued'and(defer_until is null or defer_until<=clock_timestamp())),'A waiting reminder leaves the queue for 5 minutes, other messages are still offered');
update public.telegram_auth_messages set defer_until=clock_timestamp()-interval '1 second'where id=pg_temp.id('e4');
select pg_temp.ok(public.telegram_auth_message_queue(50)?pg_temp.id('e4')::text,'Then it is offered again');
update public.telegram_auth_messages set created_at=clock_timestamp()-interval '40 minutes'where id=pg_temp.id('e4');
select pg_temp.ok(pg_temp.claim('e4')->>'code'='expired','Still quiet after its 30 minutes: it expires');
select pg_temp.ok(pg_temp.claim('ec')->>'code'='event_changed','A reminder whose clinic changed (same start) is held');
select pg_temp.ok(pg_temp.claim('e5')->>'ok'='true','An open dose reminder is sent');
select pg_temp.ok(pg_temp.claim('e6')->>'code'='event_changed','A reminder for a dose already recorded is held');
select pg_temp.ok(pg_temp.claim('e7')->>'code'='binding_revoked','A notice to a chat that is not the member''s binding is held');
update public.member_medicines set stopped_at=clock_timestamp()where id=pg_temp.id('d1');
set local session_replication_role=replica;
select pg_temp.q('e9','01','5550701','member.reminder_medicine','TEST. Medicine at {time}.','medicine:'||pg_temp.id('01')||':'||extract(epoch from public._member_medicine_due((clock_timestamp()at time zone 'Asia/Yerevan')::date+1,'08:00'))::bigint,'{"time":"08:00"}');
select pg_temp.q('ea','01','5550701','member.booking_cancelled','TEST. Your visit on {date} at {time} was cancelled.','booking:audit-revoke','{"date":"Monday 1 June","time":"10:30"}');
select pg_temp.q('eb','01','5550701','member.booking_cancelled','TEST. Your visit on {date} at {time} was cancelled.','booking:audit-revoke-2','{"date":"Monday 1 June","time":"10:30"}');
set local session_replication_role=origin;
select pg_temp.ok(pg_temp.claim('e9')->>'code'='event_changed','A reminder for a stopped medicine is held');
-- The member disconnects Telegram: queued notices are held at once, and a claim refuses them anyway.
select public._telegram_revoke_binding((select id from public.telegram_auth_bindings where auth_user_id=pg_temp.id('01')and active),'test');
select pg_temp.ok((select state='held'and reason='binding_revoked'from public.telegram_auth_messages where id=pg_temp.id('ea')),'Revoking the binding holds its queued notices');
update public.telegram_auth_messages set state='queued',reason=null where id=pg_temp.id('eb');
select pg_temp.ok(pg_temp.claim('eb')->>'code'='binding_revoked','A queued notice to a revoked binding is never sent');
-- R5: a booking notice queued straight to the chat (no member notice row) is checked the same way.
insert into public.system_message_templates(template_id,version,locale,body,approved)values('booking.clinic_proposal',100,'en','TEST. Your clinic suggested a new visit time.',true);
insert into public.telegram_auth_messages(id,address,principal_ref,template_id,template_version,locale,body)values(pg_temp.id('ed'),'5550701','fictional-member-01','booking.clinic_proposal',100,'en','TEST. Your clinic suggested a new visit time.');
select pg_temp.ok(pg_temp.claim('ed')->>'code'='binding_revoked','A direct booking notice to a revoked binding is never sent');
select pg_temp.ok(not exists(select 1 from public.telegram_auth_message_attempts where message_id in(pg_temp.id('e2'),pg_temp.id('e3'),pg_temp.id('e4'),pg_temp.id('e6'),pg_temp.id('e7'),pg_temp.id('e9'),pg_temp.id('ea'),pg_temp.id('eb'),pg_temp.id('ec'),pg_temp.id('ed'))),'No held notice reached the provider');

-- All three LDL notices queue for a linked member, each with its one-tap link to Progress (parity finding 7: the step was refused).
update public.member_notice_settings set care=true,throttle_seconds=0,hourly_cap=60;
delete from public.telegram_signin_links where auth_user_id=pg_temp.id('04');
select pg_temp.ok(public._member_notice_safe(pg_temp.id('04'),'care',t,t||':'||pg_temp.id('53')::text,case when t='member.ldl_retest_due'then '{"date":"01.12.2026"}'::jsonb else '{}'::jsonb end,'/patient/progress','open_progress')is not null,t||' queues')
 from unnest(array['member.ldl_retest_due','member.ldl_retest_overdue','member.ldl_result_with_doctor'])t;
select pg_temp.ok((select count(*)=3 and bool_and(step='open_progress')from public.telegram_signin_links where auth_user_id=pg_temp.id('04')),'Each LDL notice has its link to Progress');
select pg_temp.ok(public._member_notice_safe(pg_temp.id('04'),'care','member.ldl_retest_due','ldl:no-step','{"date":"01.12.2026"}','/patient/progress','open_nowhere')is null,'A step that is not allowed is still refused');

rollback;
\echo 'member notifications: ok'
