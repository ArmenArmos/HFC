-- Synthetic checks only. Run against an isolated migrated database; every change rolls back.
-- Replica mode builds source fixtures without unrelated clinical/booking workflows. Claim and RPC
-- access checks below return to origin mode. This script never calls a delivery adapter.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.id(n text)returns uuid language sql immutable as $$select('b1c00000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.yvn(days integer,hhmm text)returns timestamptz language sql as $$
 select(((now()at time zone 'Asia/Yerevan')::date+days)+hhmm::time)at time zone 'Asia/Yerevan'$$;
create function pg_temp.as_member(n text)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated')::text,true)$$;
create function pg_temp.service()returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.emit(m text,k text,tpl text default 'member.samples_at_lab',p jsonb default '{}')returns uuid language sql as $$
 select public._member_notice(pg_temp.id(m),'results',tpl,k,p,'/patient/results',null)$$;
create temp table evidence(k text primary key,v jsonb);
grant all on evidence to authenticated,service_role;

-- New tables are private even to service_role; browser roles only receive the two narrow RPCs.
select pg_temp.ok(not has_table_privilege(r,t,'select')and not has_table_privilege(r,t,'insert')and not has_table_privilege(r,t,'update'),r||' cannot reach '||t)
 from unnest(array['anon','authenticated','service_role'])r cross join unnest(array['public.notice_channels','public.member_notices','public.member_notice_seen'])t;
select pg_temp.ok(c.relrowsecurity,'RLS enabled: '||c.relname)from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public'and c.relname in('notice_channels','member_notice_seen','member_notices');
select pg_temp.ok(has_function_privilege('authenticated','public.member_notices_read()','execute')
 and has_function_privilege('authenticated','public.member_notices_mark_seen(uuid)','execute')
 and not has_function_privilege('anon','public.member_notices_read()','execute')
 and not has_function_privilege('service_role','public.member_notices_read()','execute')
 and not has_function_privilege('authenticated','public._member_notice_closed(uuid,text,text,jsonb)','execute'),'RPC and internal helper grants');
select pg_temp.ok(not exists(select 1 from public.notice_channels where template_id not in('app.bp_weekly_summary','member.samples_collected','member.samples_collected_exceptions','member.results_received','member.document_released')and(audience<>'member'or not(chat and push and telegram))),'all seeded channels default to member, all on');
-- The weekly blood pressure summary carries readings, so it is the one app-only channel (no Telegram, no push).
select pg_temp.ok(exists(select 1 from public.notice_channels where template_id='app.bp_weekly_summary'and audience='member'and chat and not push and not telegram),'the weekly summary is member, chat only');
select pg_temp.ok((select count(*)=34 from public.notice_channels),'all current safe-producer templates and legacy proposal are seeded');

set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),'3749909'||n||'00',now()from unnest(array['01','02','03','04','05','06','07','08'])n;
insert into public.profiles(id,locale,display_name)select pg_temp.id(n),case when n='08'then 'hy'else 'en'end,'Synthetic notice member'
 from unnest(array['01','02','03','04','05','06','07','08'])n on conflict(id)do update set locale=excluded.locale;
insert into public.patient_clinical_cases(user_id)select pg_temp.id(n)from unnest(array['01','02','03','04','07','08'])n on conflict do nothing;
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_nc',9231,600,'consent-nc')
 on conflict(singleton)do update set account=excluded.account,bot_id=excluded.bot_id;
insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
 select pg_temp.id(n),'member','synthetic-notice-'||n,case when n='04'then '["old_bot",1]'else public._telegram_account_ref(s)end,
 '+3749909'||n||'00','5599'||n,1 from public.telegram_channel_settings s cross join unnest(array['01','03','04','05','06','08'])n;
insert into public.telegram_audit(member_id,kind,detail,created_at)values(pg_temp.id('03'),'link.redeemed','{}',now()-interval '1 minute'),(pg_temp.id('03'),'link.unlinked','{}',now());
insert into public.workspace_clinics(id,name,address)values(pg_temp.id('90'),'Synthetic Clinic','1 Synthetic Street');
insert into public.workspace_staff(user_id,role,display_name)values(pg_temp.id('05'),'admin','Synthetic admin');
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name,role)values(pg_temp.id('06'),pg_temp.id('90'),'Synthetic clinic staff','staff');
-- Synthetic template versions never modify production copy; newest-unapproved is tested separately.
insert into public.system_message_templates(template_id,version,locale,body,approved)
 select c.template_id,900,loc,case when c.template_id='member.reminder_medicine'then 'At {time}, open Noreon.'
 when c.template_id='member.booking_confirmed'then 'Your visit: {date} at {time}, {clinic}.'
 when c.template_id='member.reminder_visit_soon'then 'Your visit: {date} at {time}, {clinic}.'
 when c.template_id='member.reminder_visit_tomorrow'then 'Your visit: {date} at {time}, {clinic}.'
 else case when loc='hy'then 'Սինթետիկ ծանուցում։'else 'Your synthetic notice.'end end,true
 from public.notice_channels c cross join unnest(array['en','hy'])loc;
insert into public.system_message_templates(template_id,version,locale,body,approved)values('member_notice.open_label',900,'en','Open Noreon',true),('member_notice.open_label',900,'hy','Բացել Noreon-ը',true);
insert into public.patient_reminder_preferences(user_id,preferences)values(pg_temp.id('01'),'{"quietStart":"00:00","quietEnd":"00:00"}');
update public.member_notice_settings set booking=false,results=false,care=false,reminders=false,throttle_seconds=0,hourly_cap=60;
set local session_replication_role=origin;

-- Disabled group has neither channel; staff/clinic accounts have no app text or outbox message.
select pg_temp.emit('01','test:off');
select pg_temp.ok(not exists(select 1 from public.member_notices where event_key='test:off'),'disabled group makes no notice');
update public.member_notice_settings set results=true,care=true,booking=true,reminders=true;
select pg_temp.emit(n,'test:route-'||n)from unnest(array['01','02','03','04','05','06','08'])n;
select pg_temp.ok((select reason='queued'and app_text='Your synthetic notice.'and telegram_message_id is not null from public.member_notices where event_key='test:route-01'),'bound member gets both');
select pg_temp.ok((select string_agg(reason,','order by member_id)='not_connected,turned_off,other_bot'and bool_and(app_text is not null and telegram_message_id is null)
 from public.member_notices where event_key in('test:route-02','test:route-03','test:route-04')),'all Telegram eligibility skips still render app');
select pg_temp.ok((select count(*)=2 and bool_and(reason='staff_account'and app_text is null and telegram_message_id is null)from public.member_notices where event_key in('test:route-05','test:route-06')),'staff and clinic accounts remain excluded');
select pg_temp.ok((select app_text='Սինթետիկ ծանուցում։'from public.member_notices where event_key='test:route-08'),'member locale is used');
select pg_temp.emit('01','test:route-01');
select pg_temp.ok((select count(*)=1 from public.member_notices where event_key='test:route-01'),'retry is deduplicated');
update public.member_notice_settings set throttle_seconds=600;
select pg_temp.emit('01','test:throttle');
select pg_temp.ok((select reason='throttled'and app_text is not null and telegram_message_id is null from public.member_notices where event_key='test:throttle'),'throttled still appears in app');
update public.member_notice_settings set throttle_seconds=0,hourly_cap=1;
select pg_temp.emit('01','test:cap','member.consultation_needed');
select pg_temp.ok((select reason='hourly_cap'and app_text is not null and telegram_message_id is null from public.member_notices where event_key='test:cap'),'hourly cap still appears in app');
update public.member_notice_settings set hourly_cap=60;
update public.notice_channels set telegram=false where template_id='member.samples_at_lab';
select pg_temp.emit('01','test:app');
select pg_temp.ok((select reason='telegram_off'and outcome='skipped'and telegram_message_id is null and app_text is not null from public.member_notices where event_key='test:app'),'telegram off skips only Telegram');
update public.notice_channels set telegram=true,chat=false where template_id='member.samples_at_lab';
select pg_temp.emit('01','test:telegram');
select pg_temp.ok((select outcome='queued'and app_text is null from public.member_notices where event_key='test:telegram'),'chat off has no app entry');
update public.notice_channels set chat=true,audience='doctor'where template_id='member.samples_at_lab';
select pg_temp.emit('01','test:doctor');
select pg_temp.ok((select reason='staff_account'and app_text is null and telegram_message_id is null from public.member_notices where event_key='test:doctor'),'staff audience produces neither member channel');
update public.notice_channels set audience='member'where template_id='member.samples_at_lab';

-- Latest-row approval, rendering and immutable copy. No older approved fallback.
set local session_replication_role=replica;
insert into public.system_message_templates(template_id,version,locale,body,approved)values('member.samples_at_lab',901,'en','Unapproved replacement.',false);
set local session_replication_role=origin;
select pg_temp.emit('01','test:unapproved');
select pg_temp.ok((select app_text is null from public.member_notices where event_key='test:unapproved'),'newest unapproved suppresses app despite old approved version');
select pg_temp.service();
select pg_temp.ok(public.telegram_auth_message_claim((select telegram_message_id from public.member_notices where event_key='test:unapproved'),gen_random_uuid())->>'code'='template_unapproved','same latest template held in Telegram');
set local session_replication_role=replica;
insert into public.system_message_templates(template_id,version,locale,body,approved)values('member.samples_at_lab',902,'en','Your updated synthetic notice.',true);
set local session_replication_role=origin;
select pg_temp.emit('02','test:updated');
select pg_temp.ok((select app_text='Your synthetic notice.'from public.member_notices where event_key='test:route-02'),'template edit never rewrites history');
select pg_temp.emit('02','test:render','member.reminder_medicine','{"time":"09:00"}');
select pg_temp.ok((select app_text='At 09:00, open Noreon.'and params='{"time":"09:00"}'::jsonb from public.member_notices where event_key='test:render'),'rendered app-only params retained for freshness');
select pg_temp.emit('01','test:missing','member.reminder_medicine');
select pg_temp.ok((select app_text is null from public.member_notices where event_key='test:missing'),'missing placeholder suppresses app');
select pg_temp.ok(public.telegram_auth_message_claim((select telegram_message_id from public.member_notices where event_key='test:missing'),gen_random_uuid())->>'code'='params_missing','missing placeholder held at claim');
select pg_temp.ok(public._member_notice_render('Your {Slot2} notice.','{}')is null,'unexpected placeholder also fails closed');
select pg_temp.emit('01','test:unknown-template','member.no_such_template');
select pg_temp.ok((select reason='no_template'and app_text is null from public.member_notices where event_key='test:unknown-template'),'missing template never displays');
do $$begin
 begin update public.member_notices set app_text='Changed'where event_key='test:route-02';raise exception 'FAIL: notice changed';exception when sqlstate '55000'then null;end;
end$$;

-- Source fixtures: fresh visit, BP slot, unticked medicine, open ask, unread plan, open LDL task.
set local session_replication_role=replica;
insert into public.booking_appointments(id,member_id,program_id,requirements_token,status,current_arrangement,proposed_arrangement,proposed_reservation_id,notice_id)
 select pg_temp.id(n),pg_temp.id(m),gen_random_uuid(),'synthetic-'||n,'confirmed',
 jsonb_build_object('clinicId',pg_temp.id('90'),'mode','clinic','startsAt',pg_temp.yvn(1,'12:00'),'endsAt',pg_temp.yvn(1,'12:30')),
 jsonb_build_object('clinicId',pg_temp.id('90'),'mode','clinic','startsAt',pg_temp.yvn(1,'12:00'),'endsAt',pg_temp.yvn(1,'12:30')),gen_random_uuid(),gen_random_uuid()
 from(values('31','01'),('32','02'))x(n,m);
insert into public.clinic_booking_proposals(id,clinic_id,appointment_id,appointment_revision,capacity_key,starts_at,ends_at,actor_id,membership_id)
 values(pg_temp.id('41'),pg_temp.id('90'),pg_temp.id('31'),1,'synthetic-proposal',pg_temp.yvn(1,'12:00'),pg_temp.yvn(1,'12:30'),pg_temp.id('06'),gen_random_uuid());
insert into public.bp_weeks(id,member_id,starts_on,started_by,started_by_role)values(pg_temp.id('51'),pg_temp.id('02'),(pg_temp.yvn(0,'12:00')at time zone 'Asia/Yerevan')::date,pg_temp.id('02'),'member');
insert into public.member_medicines(id,user_id,name,times,started_on)values(pg_temp.id('61'),pg_temp.id('02'),'Synthetic medicine',array['09:00'::time],(pg_temp.yvn(0,'12:00')at time zone 'Asia/Yerevan')::date);
insert into public.member_medicine_asks(id,user_id,source,medicine_id,due_at,trigger,expires_at)values(pg_temp.id('62'),pg_temp.id('02'),'self',pg_temp.id('61'),pg_temp.yvn(0,'09:00'),'missed',now()+interval '1 day');
insert into public.patient_care_plans(id,user_id,clinician,instructions)values(pg_temp.id('71'),pg_temp.id('02'),'Synthetic doctor','Synthetic instructions');
insert into public.ldl_retests(id,member_id,therapy_id,rule,anchor_on,due_from,due_to,request_on,defaults_version,created_by)
 values(pg_temp.id('81'),pg_temp.id('02'),gen_random_uuid(),'acs',current_date-7,current_date+1,current_date+8,current_date,'synthetic-v1',pg_temp.id('05'));
set local session_replication_role=origin;
create temp table source_keys(k text primary key,event_key text,template text,params jsonb);
insert into source_keys values
 ('visit','reminder.soon:booking:'||pg_temp.id('31')::text||':'||extract(epoch from pg_temp.yvn(1,'12:00'))::bigint::text,'member.reminder_visit_soon',public._member_notice_visit(pg_temp.id('01'),pg_temp.yvn(1,'12:00'),null,'Synthetic Clinic')),
 ('bp','bpweek:'||pg_temp.id('51')::text||':1:morning','member.reminder_bp_week','{}'),
 ('medicine','medicine:'||pg_temp.id('02')::text||':'||extract(epoch from pg_temp.yvn(0,'09:00'))::bigint::text,'member.reminder_medicine','{"time":"09:00"}'),
 ('ask','medicine_ask:'||pg_temp.id('62')::text,'member.medicine_ask','{}'),
 ('plan','care.plan:'||pg_temp.id('71')::text,'member.plan_ready','{}'),
 ('ldl','ldl.retest_due:'||pg_temp.id('81')::text,'member.ldl_retest_due','{}');
select pg_temp.ok(not public._member_notice_closed(pg_temp.id(case when k='visit'then '01'else '02'end),event_key,template,params),'open source: '||k)from source_keys;
select pg_temp.ok(public._member_notice_closed(pg_temp.id('02'),'bpweek:unreadable:1:morning','member.reminder_bp_week','{}'),'malformed key fails closed');
select pg_temp.ok(not public._member_notice_closed(pg_temp.id('02'),'results:unchanged','member.samples_at_lab','{}'),'ordinary information notice remains open');
select pg_temp.emit('01',event_key,template,params)from source_keys where k='visit';
select pg_temp.emit('02',event_key,template,params)from source_keys where k<>'visit';

-- Legacy proposal group-off path still queues and is journalled, then deduplicates.
update public.member_notice_settings set booking=false;
create function pg_temp.fail_notice_insert()returns trigger language plpgsql as $$begin
 raise exception using errcode='P0001',message='Synthetic notice journal failure';end$$;
create trigger synthetic_notice_failure before insert on public.member_notices for each row execute function pg_temp.fail_notice_insert();
select pg_temp.ok(public._clinic_proposal_notify(pg_temp.id('01'))is not null,'a failed journal row never costs the send, as on main');
select pg_temp.ok(not exists(select 1 from public.member_notices where event_key='booking.proposal:'||pg_temp.id('41')::text),'no journal row was written');
drop trigger synthetic_notice_failure on public.member_notices;
select public._clinic_proposal_notify(pg_temp.id('01'));
select pg_temp.ok((select count(*)=1 and bool_and(app_text is not null and telegram_message_id is null and outcome='skipped' and reason='direct_send')from public.member_notices where event_key='booking.proposal:'||pg_temp.id('41')::text),'older proposal send saves its app copy and stays out of the Telegram allowance');
select pg_temp.ok(public._clinic_proposal_notify(pg_temp.id('01'))is null,'legacy proposal retry deduplicated');
-- Astra MN-R1: with one slot left under the cap, the older proposal send must not have used it (main doesn't count it).
update public.member_notice_settings set results=true,throttle_seconds=0,hourly_cap=(select count(*)+1 from public.member_notices where member_id=pg_temp.id('01')and outcome='queued'and created_at>clock_timestamp()-interval '1 hour');
select pg_temp.emit('01','test:after-older-proposal');
select pg_temp.ok((select reason='queued' from public.member_notices where event_key='test:after-older-proposal'),'the next notice still queues under the cap');
update public.member_notice_settings set hourly_cap=60;
select pg_temp.ok(not public._member_notice_closed(pg_temp.id('01'),'booking.proposal:'||pg_temp.id('41')::text,'booking.clinic_proposal','{}'),'open proposal open');
update public.member_notice_settings set booking=true;

-- Completion changes source facts, not notice history.
set local session_replication_role=replica;
update public.booking_appointments set current_arrangement=jsonb_set(current_arrangement,'{startsAt}',to_jsonb(pg_temp.yvn(1,'13:00')))where id=pg_temp.id('31');
insert into public.bp_week_readings(measurement_id,week_id,member_id,day,slot)values(gen_random_uuid(),pg_temp.id('51'),pg_temp.id('02'),1,'morning'),(gen_random_uuid(),pg_temp.id('51'),pg_temp.id('02'),1,'morning');
insert into public.member_medicine_doses(medicine_id,user_id,due_at,status)values(pg_temp.id('61'),pg_temp.id('02'),pg_temp.yvn(0,'09:00'),'taken');
update public.member_medicine_asks set state='withdrawn'where id=pg_temp.id('62');
update public.patient_care_plans set acknowledged_at=now()where id=pg_temp.id('71');
update public.ldl_retests set state='cancelled',closed_at=now()where id=pg_temp.id('81');
update public.clinic_booking_proposals set state='accepted',decided_at=now(),decided_by=pg_temp.id('01')where id=pg_temp.id('41');
set local session_replication_role=origin;
select pg_temp.ok(public._member_notice_closed(pg_temp.id(case when k='visit'then '01'else '02'end),event_key,template,params),'closed source: '||k)from source_keys;
select pg_temp.ok(public._member_notice_closed(pg_temp.id('01'),'booking.proposal:'||pg_temp.id('41')::text,'booking.clinic_proposal','{}'),'accepted proposal closed');
set local session_replication_role=replica;
update public.member_medicine_asks set state='open',expires_at=now()-interval '1 second'where id=pg_temp.id('62');
set local session_replication_role=origin;
select pg_temp.ok(public._member_notice_closed(pg_temp.id('02'),'medicine_ask:'||pg_temp.id('62')::text,'member.medicine_ask','{}'),'open but expired medicine ask closed');
-- Quiet hours still defer a fresh reminder before source closure is considered.
update public.patient_reminder_preferences set preferences='{"quietStart":"00:00","quietEnd":"23:59:59.999999"}'where user_id=pg_temp.id('01');
select pg_temp.service();
select pg_temp.ok(public.telegram_auth_message_claim((select telegram_message_id from public.member_notices where event_key=(select event_key from source_keys where k='visit')),gen_random_uuid())->>'code'='quiet_hours','quiet-hours deferral stays before event_changed');
-- Keep subsequent claim deterministic at any real wall-clock hour: empty quiet interval.
insert into public.patient_reminder_preferences(user_id,preferences)values(pg_temp.id('01'),'{"quietStart":"00:00","quietEnd":"00:00"}')on conflict(user_id)do update set preferences=excluded.preferences;
select pg_temp.service();
select pg_temp.ok(public.telegram_auth_message_claim((select telegram_message_id from public.member_notices where event_key=(select event_key from source_keys where k='visit')),gen_random_uuid())->>'code'='event_changed','moved reminder held before delivery');
-- The managed path links its message, so a proposal answered before the send is held.
delete from public.member_notices where event_key='booking.proposal:'||pg_temp.id('41')::text;
update public.member_notice_settings set booking=true;
select pg_temp.ok(public.telegram_auth_message_claim(public._member_notice_safe(pg_temp.id('01'),'booking','booking.clinic_proposal','booking.proposal:'||pg_temp.id('41')::text,'{}','/patient/care','open_care'),gen_random_uuid())->>'code'='event_changed','accepted proposal held before delivery');
select pg_temp.ok(public.telegram_auth_message_claim((select telegram_message_id from public.member_notices where event_key='test:route-01'),gen_random_uuid())->'ok'='true'::jsonb,'fresh ordinary notice still claims');

-- Proposal accepted event renders the current accepted appointment and is deduplicated by event id.
set local session_replication_role=replica;
alter table public.booking_appointment_events enable always trigger member_notice_booking_event;
insert into public.booking_appointment_events(id,appointment_id,revision,kind,notice_id)values(pg_temp.id('42'),pg_temp.id('31'),2,'clinic-proposal-accepted',gen_random_uuid());
set local session_replication_role=origin;
select pg_temp.ok((select template_id='member.booking_confirmed'and params->>'time'='13:00'and app_text like '%13:00%'from public.member_notices where event_key='booking:'||pg_temp.id('42')::text),'accepted proposal emits confirmed with new arrangement');
select pg_temp.ok(pg_temp.emit('01','booking:'||pg_temp.id('42')::text,'member.booking_confirmed')is null,'acceptance key retries once');

-- A retired/superseded plan no longer asks for acknowledgement, even if never acknowledged.
set local session_replication_role=replica;
update public.patient_care_plans set acknowledged_at=null,active=false,retired_at=now()where id=pg_temp.id('71');
set local session_replication_role=origin;
select pg_temp.ok(public._member_notice_closed(pg_temp.id('02'),'care.plan:'||pg_temp.id('71')::text,'member.plan_ready','{}'),'superseded unacknowledged plan closed');
-- A later dose of the replacement medicine is still open.
set local session_replication_role=replica;
insert into public.member_medicines(id,user_id,name,times,started_on,effective_at)
 values(pg_temp.id('63'),pg_temp.id('02'),'Synthetic medicine',array['09:00'::time],(pg_temp.yvn(0,'12:00')at time zone 'Asia/Yerevan')::date,pg_temp.yvn(0,'10:00'));
update public.member_medicines set stopped_at=pg_temp.yvn(0,'10:00'),replaced_by=pg_temp.id('63')where id=pg_temp.id('61');
set local session_replication_role=origin;
select pg_temp.ok(not public._member_notice_closed(pg_temp.id('02'),'medicine:'||pg_temp.id('02')::text||':'||extract(epoch from pg_temp.yvn(1,'09:00'))::bigint::text,'member.reminder_medicine','{"time":"09:00"}'),'next effective dose remains open');

-- Reminder sweep without Telegram: same candidate times, one app notice, unchanged quiet hours.
select pg_temp.service();
select pg_temp.ok(public.member_notice_reminders_run(pg_temp.yvn(0,'21:30'))->>'state'='quiet_hours','visit quiet hours unchanged');
select public.member_notice_reminders_run(pg_temp.yvn(0,'18:30'));
select pg_temp.ok(exists(select 1 from public.member_notices where member_id=pg_temp.id('02')and event_key like 'reminder.tomorrow:booking:'||pg_temp.id('32')::text||':%'and app_text is not null and reason='not_connected'),'unbound member gets scheduled visit app reminder');
update public.bp_week_settings set enabled=true,reminders=true;
select public.bp_week_reminders_run(pg_temp.yvn(0,'20:05'));
select pg_temp.ok(exists(select 1 from public.member_notices where event_key='bpweek:'||pg_temp.id('51')::text||':1:evening'and app_text is not null and reason='not_connected'),'unbound member gets BP app reminder');
update public.member_medicine_settings set enabled=true,reminders=true;
select public.member_medicine_reminders_run(pg_temp.yvn(1,'09:05'));
select pg_temp.ok(exists(select 1 from public.member_notices where member_id=pg_temp.id('02')and event_key='medicine:'||pg_temp.id('02')::text||':'||extract(epoch from pg_temp.yvn(1,'09:00'))::bigint::text and app_text is not null and reason='not_connected'),'unbound member gets medicine app reminder');

-- Read RPC returns only this member, bounded, oldest-first. Closed/older notices never autofocus.
-- Use a separate synthetic member to make seen-watermark assertions independent of earlier fixtures.
insert into public.member_notices(id,member_id,event_key,notice_group,template_id,outcome,reason,app_text,created_at)values
 (pg_temp.id('a1'),pg_temp.id('07'),'history:old','results','member.samples_at_lab','skipped','not_connected','Old notice',now()-interval '8 days'),
 (pg_temp.id('a2'),pg_temp.id('07'),'care.plan:'||pg_temp.id('71')::text||':other-member','care','member.plan_ready','skipped','not_connected','Closed notice',now()-interval '3 days'),
 (pg_temp.id('a3'),pg_temp.id('07'),'history:first','results','member.samples_at_lab','skipped','not_connected','First fresh notice',now()-interval '2 days'),
 (pg_temp.id('a4'),pg_temp.id('07'),'history:last','results','member.samples_at_lab','skipped','not_connected','Last fresh notice',now()-interval '1 day');
select pg_temp.as_member('07');set local role authenticated;
insert into evidence values('read',public.member_notices_read());
select pg_temp.ok((select v->>'firstUnseen'=pg_temp.id('a3')::text and jsonb_array_length(v->'notices')=4 and v#>>'{notices,0,text}'='Old notice'and v#>>'{notices,0,closed}'='true'and v#>>'{notices,1,closed}'='true'from evidence where k='read'),'read is bounded own history, ordered; firstUnseen skips old and closed');
select pg_temp.ok(public.member_notices_mark_seen(pg_temp.id('a3'))->>'ok'='true','mark own notice');
select pg_temp.ok(public.member_notices_read()->>'firstUnseen'=pg_temp.id('a4')::text,'next unseen after watermark');
select pg_temp.ok(public.member_notices_mark_seen(pg_temp.id('a4'))->>'ok'='true','mark latest');
select pg_temp.ok(public.member_notices_mark_seen(pg_temp.id('a1'))->>'ok'='true','late older mark is accepted safely');
select pg_temp.ok(public.member_notices_read()->'firstUnseen'='null'::jsonb,'seen watermark cannot move backwards');
select pg_temp.ok(public.member_notices_mark_seen(pg_temp.id('42'))->>'ok'='false','unknown id rejected');
reset role;
insert into evidence select 'foreign',to_jsonb(id)from public.member_notices where event_key='test:route-02';
set local role authenticated;
select pg_temp.ok(public.member_notices_mark_seen((select trim(both '"'from v::text)::uuid from evidence where k='foreign'))->>'ok'='false','another member notice rejected');
reset role;
select pg_temp.ok((select seen_at=now()-interval '1 day'from public.member_notice_seen where member_id=pg_temp.id('07')),'watermark is own latest notice time');
select pg_temp.as_member('02');set local role authenticated;
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.member_notices_read()->'notices')n where n->>'id'=pg_temp.id('a3')::text),'other member cannot read first member history');
reset role;
insert into public.member_notices(member_id,event_key,notice_group,template_id,outcome,reason,app_text,created_at)
 select pg_temp.id('07'),'history:bulk-'||n,'results','member.samples_at_lab','skipped','not_connected','Synthetic history '||n,now()+make_interval(secs=>n)from generate_series(1,205)n;
select pg_temp.as_member('07');set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.member_notices_read()->'notices')=200 and public.member_notices_read()#>>'{notices,0,text}'='Synthetic history 6'
 and public.member_notices_read()#>>'{notices,199,text}'='Synthetic history 205','latest 200 returned oldest-first');
reset role;
-- Function guards reject authenticated role without a member identity, even if role grants exist.
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
set local role authenticated;
do $$begin
 begin perform public.member_notices_read();raise exception 'FAIL: anonymous identity read';exception when insufficient_privilege then null;end;
 begin perform public.member_notices_mark_seen(pg_temp.id('a4'));raise exception 'FAIL: anonymous identity seen';exception when insufficient_privilege then null;end;
end$$;
reset role;
-- These call the real commands with synthetic booking sources (replica mode
-- skips unrelated fixture FKs/triggers, not command authorization, locks or idempotency logic).
set local session_replication_role=replica;
update public.staff_telegram_policy set signin_required=false;
update public.clinic_scheduling_capabilities set enabled=true;
insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.id('e0'),pg_temp.id('06'),now(),now());
insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,channel,purpose,state)
 select pg_temp.id(x.notice),a.id,a.revision,a.program_id,a.proposed_reservation_id,pg_temp.id('90'),1,'portal','booking','pending'
 from(values('e1','31'),('e2','32'))x(notice,appointment)join public.booking_appointments a on a.id=pg_temp.id(x.appointment);
update public.booking_appointments set notice_id=pg_temp.id('e1'),status='notification-pending',current_arrangement=null,current_reservation_id=null where id=pg_temp.id('31');
update public.booking_appointments set notice_id=pg_temp.id('e2')where id=pg_temp.id('32');
insert into public.clinic_booking_proposals(id,clinic_id,appointment_id,appointment_revision,capacity_key,starts_at,ends_at,actor_id,membership_id)
 select pg_temp.id('e3'),pg_temp.id('90'),a.id,a.revision,'synthetic-receipt',pg_temp.yvn(1,'12:00'),pg_temp.yvn(1,'12:30'),pg_temp.id('06'),
 (select id from public.clinic_portal_memberships where user_id=pg_temp.id('06'))from public.booking_appointments a where id=pg_temp.id('32');
insert into evidence select 'clinic-command',jsonb_build_object('version','clinic-schedule-command-v1','op','decline','submissionId',pg_temp.id('e4'),'appointmentId',id,'revision',revision,'reason','Synthetic decline')
 from public.booking_appointments where id=pg_temp.id('31');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id('06'),'role','authenticated','session_id',pg_temp.id('e0'),'amr',jsonb_build_array(jsonb_build_object('method','password')),'exp',extract(epoch from now()+interval '1 hour')::bigint)::text,true);
set local role authenticated;
insert into evidence values('clinic-saved',public.clinic_schedule_command(pg_temp.id('90'),(select v from evidence where k='clinic-command')));
select pg_temp.ok((select v->>'status'='saved'from evidence where k='clinic-saved'),'clinic command saved');
insert into evidence values('clinic-replay',public.clinic_schedule_command(pg_temp.id('90'),(select v from evidence where k='clinic-command')));
select pg_temp.ok((select v->>'status'='saved'from evidence where k='clinic-replay'),'clinic replay returns the saved result');
reset role;
select pg_temp.service();set local role service_role;
select pg_temp.ok(public.booking_portal_proposal_answer(pg_temp.id('e5'),pg_temp.id('02'),pg_temp.id('02'),pg_temp.id('e3'),false)=public.booking_portal_proposal_answer(pg_temp.id('e5'),pg_temp.id('02'),pg_temp.id('02'),pg_temp.id('e3'),false),'proposal replay returns the same result');
reset role;
set local session_replication_role=origin;
select pg_temp.ok((select count(*)=1 from public.clinic_booking_decisions where id=pg_temp.id('e4'))and(select count(*)=1 from public.booking_appointment_commands where id=pg_temp.id('e5')),'a replay did not repeat command writes');
select pg_temp.ok(not exists(select 1 from public.member_notices where(outcome='queued')is distinct from(telegram_message_id is not null)),'queued iff outbox id invariant remains');
\echo 'check-member-notices-in-chat: all passed'
rollback;
