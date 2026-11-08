-- D1 BP week: off by default; only the member and their assigned nurse or doctor read or act;
-- readings land in patient_measurements and in exactly one slot (2 per slot); slot reminders go
-- once per slot, only while the slot is open, never in quiet hours or after an opt-out, and carry
-- no health detail. Fictional data; rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.id(n text)returns uuid language sql immutable as $$select('d1a00000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.yvn(days integer,hhmm text)returns timestamptz language sql as $$
 select((((now()at time zone 'Asia/Yerevan')::date+days)::text||' '||hhmm)::timestamp at time zone 'Asia/Yerevan')$$;
create function pg_temp.today()returns date language sql as $$select(now()at time zone 'Asia/Yerevan')::date$$;
create function pg_temp.as_user(n text)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),
  'exp',extract(epoch from now()+interval '1 hour')::bigint,'session_id',pg_temp.id('5'||right(n,1)))::text,true)$$;
create function pg_temp.as_service()returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.id(text),pg_temp.yvn(integer,text),pg_temp.today(),pg_temp.as_user(text),pg_temp.as_service()to authenticated,service_role;
create temp table r(k text primary key,v jsonb);grant all on r to authenticated,service_role;

-- 0. Privileges and defaults.
select pg_temp.ok((select not enabled and not reminders and not member_can_start from public.bp_week_settings),'Every switch is off by default');
select pg_temp.ok(not has_table_privilege('authenticated','public.bp_weeks','select')and not has_table_privilege('authenticated','public.bp_week_readings','select')
 and not has_table_privilege('anon','public.bp_weeks','select')and not has_table_privilege('service_role','public.bp_weeks','insert'),'No direct table access');
select pg_temp.ok(not has_function_privilege('anon','public.bp_week_member_read()','execute')and not has_function_privilege('anon','public.bp_week_record(uuid,text,uuid,integer,integer,integer,timestamptz)','execute')
 and not has_function_privilege('authenticated','public.bp_week_reminders_run(timestamptz)','execute')and has_function_privilege('service_role','public.bp_week_reminders_run(timestamptz)','execute'),
 'Anonymous callers reach nothing; the reminder sweep is service-only');

-- Fixtures. 01 member (en, Telegram connected), 02 another member, 03 member who cannot start (staff-start only),
-- 07 doctor, 08 nurse of 01, 09 nurse of 02 only, 06 admin. Clinic 90.
set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),'3749911'||n||'00',now()from unnest(array['01','02','03','06','07','08','09'])n;
insert into public.profiles(id,locale,display_name,birth_date,biological_sex)select pg_temp.id(n),'en','Fictional member '||n,'1970-01-01','female'from unnest(array['01','02','03'])n
 on conflict(id)do update set display_name=excluded.display_name,birth_date=excluded.birth_date,biological_sex=excluded.biological_sex;
insert into public.patient_consents(user_id,version)select pg_temp.id(n),'patient-pilot-v1'from unnest(array['01','02','03'])n;
insert into public.patient_assessments(user_id)select pg_temp.id(n)from unnest(array['01','02','03'])n on conflict do nothing;
insert into public.workspace_clinics(id,name,address)values(pg_temp.id('90'),'Fictional Clinic','1 Fictional Street');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.id('06'),'admin','Fictional admin',null),
 (pg_temp.id('07'),'doctor','Fictional doctor',pg_temp.id('90')),(pg_temp.id('08'),'nurse','Fictional nurse',pg_temp.id('90')),(pg_temp.id('09'),'nurse','Other nurse',pg_temp.id('90'));
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.id('5'||right(n,1)),pg_temp.id(n),now(),now()from unnest(array['01','02','03','06','07','08','09'])n;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.id('01'),pg_temp.id('07'),pg_temp.id('08')),(pg_temp.id('02'),pg_temp.id('07'),pg_temp.id('09')),
 (pg_temp.id('03'),pg_temp.id('07'),pg_temp.id('08'))on conflict(user_id)do update set assigned_doctor_id=excluded.assigned_doctor_id,assigned_nurse_id=excluded.assigned_nurse_id;
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_bw',9021,600,'consent-bw');
insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
 select pg_temp.id('01'),'member','fictional-bw-01',public._telegram_account_ref(s),'+374991101','5559101',1 from public.telegram_channel_settings s;
-- A monitor handed over to member 01 (inventory fixture).
insert into public.bp_devices(id,model,serial,status,created_by)values(pg_temp.id('80'),'Fictional BP-1','FIC-001','assigned',pg_temp.id('06'));
insert into public.bp_device_assignments(id,device_id,member_id,assigned_at,assigned_by,assigned_by_name,assigned_by_role)
 values(pg_temp.id('81'),pg_temp.id('80'),pg_temp.id('01'),now()-interval '1 day',pg_temp.id('08'),'Fictional nurse','nurse');
reset session_replication_role;

set local role authenticated;
-- 1. Off: reads say so, nothing can be started or recorded.
select pg_temp.as_user('01');
select pg_temp.ok(public.bp_week_member_read()->>'enabled'='false','Off: member read says disabled and nothing else');
select pg_temp.ok(public.bp_week_start(null,pg_temp.today(),'08:00','20:00')->>'status'='disabled','Off: cannot start');
reset role;
update public.bp_week_settings set enabled=true;
set local role authenticated;
select pg_temp.as_user('01');
select pg_temp.ok(public.bp_week_start(null,pg_temp.today(),'08:00','20:00')->>'status'='disabled','On, member start not allowed: refused');
reset role;
update public.bp_week_settings set member_can_start=true;
set local role authenticated;

-- 2. Start: validation, one open week, monitor linked.
select pg_temp.as_user('01');
select pg_temp.ok(public.bp_week_start(null,pg_temp.today()-1,'08:00','20:00')->>'status'='invalid','A week cannot start in the past');
select pg_temp.ok(public.bp_week_start(null,pg_temp.today(),'13:00','20:00')->>'status'='invalid','Morning time outside the morning window refused');
insert into r values('w1',public.bp_week_start(null,pg_temp.today(),'08:00','20:00'));
select pg_temp.ok((select v->>'status'='started'from r where k='w1'),'Member starts their own week');
select pg_temp.ok(public.bp_week_start(null,pg_temp.today()+1,'08:00','20:00')->>'status'='open-week','A second open week is refused');
select pg_temp.ok((select(w->'device'->>'serial')='FIC-001'and(w->>'startedByRole')='member'and(w->>'days')::int=7 and(w->>'readingsPerSlot')::int=2
 from jsonb_array_elements(public.bp_week_member_read()->'weeks')w limit 1),'The open monitor hand-over is linked; 7 days, 2 per slot');

-- 3. Record: into patient_measurements and one slot; 2 per slot; outside the week refused; replay safe.
create function pg_temp.rec(slot text,sub text,s int,d int,at timestamptz)returns jsonb language sql as $$
 select public.bp_week_record((select(v->>'weekId')::uuid from r where k='w1'),slot,pg_temp.id(sub),s,d,70,at)$$;
grant execute on function pg_temp.rec(text,text,int,int,timestamptz)to authenticated;
select pg_temp.ok(pg_temp.rec('morning','a1',131,84,now())->>'status'='saved','First morning reading saved');
select pg_temp.ok(pg_temp.rec('morning','a1',131,84,now())->>'status'='replayed','Same submission replays');
select pg_temp.ok(pg_temp.rec('morning','a1',140,84,now())->>'status'='conflict','Same submission, other values: conflict');
select pg_temp.ok(pg_temp.rec('evening','a1',131,84,now())->>'status'='conflict','Same submission, other slot: conflict');
select pg_temp.ok(pg_temp.rec('morning','a2',129,83,now())->>'status'='saved','Second morning reading saved');
select pg_temp.ok(pg_temp.rec('morning','a3',128,82,now())->>'status'='slot-full','A third reading in a full slot is refused and not stored');
select pg_temp.ok(pg_temp.rec('evening','a4',128,82,now()-interval '2 days')->>'status'='outside-week','A reading before the week is refused');
select pg_temp.ok(pg_temp.rec('evening','a7',128,82,now()+interval '1 day')->>'status'in('not-today','invalid'),'A reading dated tomorrow is refused');
select pg_temp.ok(pg_temp.rec('evening','a5',20,10,now())->>'status'='invalid','Implausible values refused by the measurement rules');
select pg_temp.ok((select count(*)=2 from public.patient_measurements where user_id=pg_temp.id('01')and submission_id in(pg_temp.id('a1'),pg_temp.id('a2'),pg_temp.id('a3'),pg_temp.id('a4'),pg_temp.id('a5'))),
 'Exactly the two accepted readings are home readings in patient_measurements');
reset role;
select pg_temp.ok((select count(*)=2 and bool_and(day=1 and slot='morning')from public.bp_week_readings where member_id=pg_temp.id('01')),'Both are linked to day 1 morning');
set local role authenticated;

-- 4. Other people: another member and another nurse read and change nothing; the admin has no clinical read.
select pg_temp.as_user('02');
select pg_temp.ok(jsonb_array_length(public.bp_week_member_read()->'weeks')=0,'Another member sees no week of 01');
do $$begin perform pg_temp.rec('evening','b1',120,80,now());raise exception 'FAIL: another member recorded into 01''s week';exception when insufficient_privilege then null;end$$;
do $$begin perform public.bp_week_stop((select(v->>'weekId')::uuid from r where k='w1'),null);raise exception 'FAIL: another member stopped 01''s week';exception when insufficient_privilege then null;end$$;
select pg_temp.ok(public.bp_week_set_reminders((select(v->>'weekId')::uuid from r where k='w1'),false)->>'status'='not-found','Another member cannot change 01''s reminders');
select pg_temp.as_user('09');
do $$begin perform public.bp_week_staff_read(pg_temp.id('01'));raise exception 'FAIL: unassigned nurse read the week';exception when insufficient_privilege then null;end$$;
do $$begin perform public.bp_week_start(pg_temp.id('03'),pg_temp.today(),'08:00','20:00');raise exception 'FAIL: unassigned nurse started a week';exception when insufficient_privilege then null;end$$;
select pg_temp.as_user('06');
do $$begin perform public.bp_week_staff_read(pg_temp.id('01'));raise exception 'FAIL: admin read clinical readings';exception when insufficient_privilege then null;end$$;
select pg_temp.as_user('07');
select pg_temp.ok((select jsonb_array_length(w->'readings')=2 from jsonb_array_elements(public.bp_week_staff_read(pg_temp.id('01'))->'weeks')w limit 1),'Assigned doctor reads the week and its readings');
select pg_temp.as_user('08');
select pg_temp.ok(public.bp_week_start(pg_temp.id('03'),pg_temp.today()+1,'07:30','21:00')->>'status'='started','Assigned nurse starts a week for a member');
select pg_temp.ok((select w->>'startedByRole'='nurse'from jsonb_array_elements(public.bp_week_staff_read(pg_temp.id('03'))->'weeks')w limit 1),'Recorded as started by the nurse');
-- A staff member never starts a week for themselves as a member.
do $$begin perform public.bp_week_start(null,pg_temp.today(),'08:00','20:00');raise exception 'FAIL: staff self-start';exception when insufficient_privilege then null;end$$;

-- 5. Reminders: off unless both switches; once per open slot; none for a complete slot, in quiet hours or after opt-out.
reset role;
update public.member_notice_settings set reminders=true,throttle_seconds=0,hourly_cap=60;
select pg_temp.as_service();
select pg_temp.ok(public.bp_week_reminders_run(pg_temp.yvn(0,'20:05'))->>'state'='off','BP week reminders off: nothing');
update public.bp_week_settings set reminders=true;
-- The morning slot of day 1 is complete: no morning notice.
select pg_temp.ok((public.bp_week_reminders_run(pg_temp.yvn(0,'08:05'))->>'queued')::int=0,'Complete slot: no reminder');
select pg_temp.ok((public.bp_week_reminders_run(pg_temp.yvn(0,'20:05'))->>'queued')::int=1,'Open evening slot at 20:05: one reminder');
select pg_temp.ok((public.bp_week_reminders_run(pg_temp.yvn(0,'20:10'))->>'queued')::int=0,'Same slot later: no second reminder');
select pg_temp.ok((public.bp_week_reminders_run(pg_temp.yvn(0,'20:45'))->>'queued')::int=0,'Outside the 30-minute window: nothing');
select pg_temp.ok((select m.template_id='member.reminder_bp_week'and m.params=jsonb_build_object('time','20:00')and m.keyboard->>'url'like '%/patient/bp-week'
 and m.body!~*'pressure|mmhg|[0-9]{2,3}/[0-9]{2,3}'from public.member_notices n join public.telegram_auth_messages m on m.id=n.telegram_message_id where n.member_id=pg_temp.id('01')),
 'The notice carries the time only and opens the BP week');
-- Quiet hours: the member's own (21:00 to 09:00 here) hold the morning slot on day 2.
insert into public.patient_reminder_preferences(user_id,revision,preferences)values(pg_temp.id('01'),1,
 '{"medicationEnabled":true,"medicationOffsetMinutes":0,"bpEnabled":false,"bpTimes":["08:00"],"quietStart":"21:00","quietEnd":"09:00"}');
select pg_temp.ok((public.bp_week_reminders_run(pg_temp.yvn(1,'08:05'))->>'queued')::int=0,'Member quiet hours: no reminder');
delete from public.patient_reminder_preferences where user_id=pg_temp.id('01');
-- Opt-out by the member.
select pg_temp.as_user('01');
set local role authenticated;
select pg_temp.ok(public.bp_week_set_reminders((select(v->>'weekId')::uuid from r where k='w1'),false)->>'status'='saved','Member turns week reminders off');
reset role;
select pg_temp.as_service();
select pg_temp.ok((public.bp_week_reminders_run(pg_temp.yvn(1,'08:05'))->>'queued')::int=0,'Opted out: no reminder');
select pg_temp.ok((select count(*)=1 from public.member_notices where member_id=pg_temp.id('01')and template_id='member.reminder_bp_week'),'One reminder in total for member 01');
-- Member 03 (not connected to Telegram) is journaled as skipped, never queued.
update public.bp_weeks set starts_on=pg_temp.today()where member_id=pg_temp.id('03');
select pg_temp.ok((public.bp_week_reminders_run(pg_temp.yvn(0,'07:35'))->>'queued')::int=0,'Not connected: nothing queued');
select pg_temp.ok(exists(select 1 from public.member_notices where member_id=pg_temp.id('03')and outcome='skipped'and reason='not_connected'),'Not connected: skipped with the reason');

-- 6. Stop: the member stops; a stopped week takes no reading; readings stay.
select pg_temp.as_user('01');
set local role authenticated;
select pg_temp.ok(public.bp_week_stop((select(v->>'weekId')::uuid from r where k='w1'),null)->>'status'='stopped','Member stops the week');
select pg_temp.ok(pg_temp.rec('evening','a6',120,80,now())->>'status'='not-open','A stopped week takes no reading');
select pg_temp.ok((select jsonb_array_length(w->'readings')=2 and w->>'stoppedAt'is not null from jsonb_array_elements(public.bp_week_member_read()->'weeks')w limit 1),'Readings stay after the stop');
select pg_temp.ok(public.bp_week_start(null,pg_temp.today(),'08:00','20:00')->>'status'='started','After a stop a new week can start');
reset role;
rollback;
