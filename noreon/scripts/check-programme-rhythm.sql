-- Programme rhythm (week-4 review, month 3, month 6): fictional fixtures, all rolled back.
-- Switch off by default; scheduling anchored on plan version 1 in Yerevan dates; idempotent
-- scheduling and opening; offsets come from the settings row; quiet hours; one review open at a
-- time; member check-in replay and ownership; assigned-doctor-only reads and confirm; republish
-- closes the open checkpoint; completed rows are frozen; one notice per event.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean,label text) returns void language plpgsql as $$begin
 if cond is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.id(n text) returns uuid language sql immutable as $$select('9f100000-0000-4000-8000-0000000000'||n)::uuid$$;
-- 02 assigned doctor, 03 other doctor, 05 admin, 06 nurse, 04 and 10 and 11 members.
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),case when n in('04','10','11')then '374000971'||n end,case when n in('04','10','11')then now()end
 from unnest(array['02','03','04','05','06','10','11'])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.id(n),pg_temp.id(n),now(),now()from unnest(array['02','03','04','05','06','10','11'])n;
insert into public.workspace_clinics(id,name)values(pg_temp.id('07'),'Synthetic programme clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.id('02'),'doctor','Synthetic assigned doctor',pg_temp.id('07')),
 (pg_temp.id('03'),'doctor','Synthetic other doctor',pg_temp.id('07')),
 (pg_temp.id('05'),'admin','Synthetic admin',null),
 (pg_temp.id('06'),'nurse','Synthetic nurse',pg_temp.id('07'));
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)select pg_temp.id(n),pg_temp.id('02'),pg_temp.id('06')from unnest(array['04','10','11'])n
 on conflict(user_id)do update set assigned_doctor_id=excluded.assigned_doctor_id,assigned_nurse_id=excluded.assigned_nurse_id;
update public.profiles set display_name='Fictional programme member '||right(id::text,2)where id in(pg_temp.id('04'),pg_temp.id('10'),pg_temp.id('11'));

create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','session_id',pg_temp.id(n),'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true)
$$;
create function pg_temp.as_service()returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.code(statement text) returns text language plpgsql as $$begin
 execute statement;return 'none';
exception when others then return sqlstate;end$$;
-- A published plan for a member at a given instant (the trigger numbers the version).
create function pg_temp.publish(m text,plan text,at timestamptz)returns void language plpgsql as $$begin
 update public.patient_care_plans set active=false where user_id=pg_temp.id(m)and active;
 insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at)values(pg_temp.id(plan),pg_temp.id(m),'Synthetic assigned doctor','Synthetic plan',at);
 insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft,published_at)
 values(pg_temp.id(m),pg_temp.id(plan),gen_random_uuid(),pg_temp.id('02'),(select count(*)+1 from public.patient_clinical_publications where user_id=pg_temp.id(m)),'synthetic','{}','{}','{}',at);
end$$;
create function pg_temp.cp(m text,k text)returns public.programme_checkpoints language sql security definer as $$
 select * from public.programme_checkpoints where member_id=pg_temp.id(m)and kind=k$$;
create function pg_temp.yvn(ts text)returns timestamptz language sql immutable as $$select(ts::timestamp at time zone 'Asia/Yerevan')$$;
create function pg_temp.mine()returns setof uuid language sql as $$select pg_temp.id(n)from unnest(array['04','10','11'])n$$;
-- Self-contained on any database: the switch starts off and nobody else's plan is current, so only
-- these fixtures can open (all rolled back).
update public.programme_settings set enabled=false,week4_review_offset='28 days',month3_offset='3 months',month6_offset='6 months',opens_days_before=3;
update public.member_notice_settings set care=false;
update public.patient_care_plans set active=false where active and user_id not in(select pg_temp.mine());

-- 0. Privileges: tables closed, the sweep is service-only, member and doctor calls are authenticated only.
select pg_temp.ok(not has_table_privilege('authenticated','public.programme_settings','select')and not has_table_privilege('authenticated','public.programme_checkpoints','select')
 and not has_table_privilege('authenticated','public.programme_checkins','select')and not has_table_privilege('anon','public.programme_checkpoints','select'),'tables are closed to clients');
select pg_temp.ok(not has_function_privilege('authenticated','public.programme_run(timestamptz)','execute')and has_function_privilege('service_role','public.programme_run(timestamptz)','execute')
 and not has_function_privilege('anon','public.member_programme_timeline()','execute')and not has_function_privilege('authenticated','public._programme_schedule(uuid)','execute'),'sweep service-only; helpers internal');
select pg_temp.ok((select column_default='false'from information_schema.columns where table_schema='public'and table_name='programme_settings'and column_name='enabled')
 and(select clinical_status='pending_clinical_signoff'from public.programme_settings),'off by default, offsets marked pending clinical sign-off');

-- 1. Switch off: a first plan schedules nothing, the sweep and the member call say off.
select pg_temp.publish('10','60',pg_temp.yvn('2026-01-05 12:00'));
select pg_temp.ok(not exists(select 1 from public.programme_checkpoints where member_id in(select pg_temp.mine())),'off: no checkpoints');
select pg_temp.as_service();
select pg_temp.ok(public.programme_run()->>'state'='off','off: sweep idle');
select pg_temp.as_user('10');set local role authenticated;
select pg_temp.ok((public.member_programme_timeline()->>'enabled')::boolean=false,'off: member timeline disabled');
select pg_temp.ok(pg_temp.code($$select public.member_programme_checkin_submit(gen_random_uuid(),'same','all',null,gen_random_uuid())$$)='55P03','off: check-in refused');
reset role;

-- 2. On: plan version 1 schedules three checkpoints on Yerevan dates. 02:30 Yerevan on 11 Jan is
-- still 10 Jan in UTC, so a UTC date would be a day early.
update public.programme_settings set enabled=true;
select pg_temp.publish('04','61',pg_temp.yvn('2026-01-11 02:30'));
select pg_temp.ok((select count(*)from public.programme_checkpoints where member_id=pg_temp.id('04'))=3,'version 1 schedules three checkpoints');
select pg_temp.ok((pg_temp.cp('04','week4_review')).due_on='2026-02-08'and(pg_temp.cp('04','month3')).due_on='2026-04-11'and(pg_temp.cp('04','month6')).due_on='2026-07-11','dates are Yerevan calendar dates plus the offsets');
select pg_temp.ok((select bool_and(state='scheduled'and anchor_plan_id=pg_temp.id('61'))from public.programme_checkpoints where member_id=pg_temp.id('04')),'scheduled on the first plan');

-- 3. Idempotent: scheduling again changes nothing; the sweep backfills a member whose plan predates the switch.
select pg_temp.ok(public._programme_schedule(pg_temp.id('04'))=0,'second schedule: no change');
select pg_temp.as_service();
select pg_temp.ok((public.programme_run(pg_temp.yvn('2026-01-20 10:00'))->>'scheduled')::int>=3,'sweep schedules');
select pg_temp.ok((select count(*)from public.programme_checkpoints where member_id=pg_temp.id('10'))=3,'sweep backfills the earlier member');
select pg_temp.ok((public.programme_run(pg_temp.yvn('2026-01-20 10:05'))->>'scheduled')::int=0,'second sweep: nothing new');
select pg_temp.ok((select count(*)from public.programme_checkpoints where member_id in(select pg_temp.mine()))=6
 and(select count(*)from public.programme_checkpoint_events e join public.programme_checkpoints c on c.id=e.checkpoint_id where c.member_id in(select pg_temp.mine())and e.kind='scheduled')=6,'one row per member and kind');

-- 4. Offsets come from the settings row: a change moves unopened checkpoints, recorded once.
update public.programme_settings set week4_review_offset=interval '21 days';
select pg_temp.ok(public._programme_schedule(pg_temp.id('04'))=1 and(pg_temp.cp('04','week4_review')).due_on='2026-02-01','offset change moves the scheduled date');
select pg_temp.ok(exists(select 1 from public.programme_checkpoint_events e where e.checkpoint_id=(pg_temp.cp('04','week4_review')).id and e.kind='rescheduled'),'reschedule recorded');
update public.programme_settings set week4_review_offset=interval '28 days';
select pg_temp.ok(public._programme_schedule(pg_temp.id('04'))=1 and(pg_temp.cp('04','week4_review')).due_on='2026-02-08','offset restored');
select pg_temp.ok(pg_temp.code($$update public.programme_settings set month3_offset=interval '20 days'$$)='23514','offsets keep their order');

-- 5. Opening: three days before the date, Yerevan time, outside quiet hours, one notice each.
-- The care notices start off, so member 10's opening notice goes undecided (no journal row).
update public.member_notice_settings set throttle_seconds=0,hourly_cap=60;
select pg_temp.as_service();
-- Member 10's week 4 (5 Jan + 28 days = 2 Feb) opens; member 04's (8 Feb) not yet.
select pg_temp.ok((public.programme_run(pg_temp.yvn('2026-02-04 20:59'))->>'opened')::int=1 and(pg_temp.cp('10','week4_review')).state='open'
 and(pg_temp.cp('04','week4_review')).state='scheduled','opens three days before, not earlier');
select pg_temp.ok(not exists(select 1 from public.member_notices where event_key='programme.open:'||(pg_temp.cp('10','week4_review')).id::text),'care notices off: undecided');
update public.member_notice_settings set care=true;
select pg_temp.ok(public.programme_run(pg_temp.yvn('2026-02-05 08:59'))->>'state'='quiet_hours'and(pg_temp.cp('04','week4_review')).state='scheduled','quiet hours: nothing opens');
select pg_temp.ok((public.programme_run(pg_temp.yvn('2026-02-05 09:00'))->>'opened')::int=1 and(pg_temp.cp('04','week4_review')).state='open'
 and(pg_temp.cp('04','week4_review')).opened_at=pg_temp.yvn('2026-02-05 09:00'),'opens on the first day of the window');
select pg_temp.ok((public.programme_run(pg_temp.yvn('2026-02-05 09:05'))->>'opened')::int=0,'a second sweep opens nothing');
select pg_temp.ok((select count(*)from public.member_notices where event_key='programme.open:'||(pg_temp.cp('04','week4_review')).id::text and template_id='member.programme_week4_open')=1,'one notice decision per checkpoint');
select pg_temp.ok((select count(*)from public.member_notices where event_key='programme.open:'||(pg_temp.cp('10','week4_review')).id::text)=1,'an undecided opening notice is retried once the group is on');
-- One review at a time: month 3 does not open while week 4 is open.
select pg_temp.ok((public.programme_run(pg_temp.yvn('2026-04-09 10:00'))->>'opened')::int=0 and(pg_temp.cp('04','month3')).state='scheduled','month 3 waits for the open week-4 review');
-- No current plan: never opened.
update public.patient_care_plans set active=false where user_id=pg_temp.id('11');
select pg_temp.publish('11','62',pg_temp.yvn('2026-01-01 10:00'));
update public.patient_care_plans set active=false where user_id=pg_temp.id('11');
select pg_temp.ok((public.programme_run(pg_temp.yvn('2026-02-01 10:00'))->>'opened')::int=0 and(pg_temp.cp('11','week4_review')).state='scheduled','no current plan: stays scheduled');

-- 6. Member check-in: own open checkpoint only, replay-safe, one per checkpoint, valid answers.
select pg_temp.as_user('04');set local role authenticated;
do $$declare cp uuid:=(pg_temp.cp('04','week4_review')).id;sub uuid:=gen_random_uuid();t jsonb;
begin
 perform pg_temp.ok(pg_temp.code(format('select public.member_programme_checkin_submit(%L,%L,%L,null,gen_random_uuid())',cp,'great','all'))='22023','invalid answer refused');
 perform pg_temp.ok(public.member_programme_checkin_submit((pg_temp.cp('04','month3')).id,'same','all',null,gen_random_uuid())->>'status'='closed','scheduled checkpoint: closed');
 perform pg_temp.ok(public.member_programme_checkin_submit(cp,'worse','missed_some','  Dizzy in the mornings  ',sub)->>'status'='saved','check-in saved');
 perform pg_temp.ok(public.member_programme_checkin_submit(cp,'worse','missed_some','Dizzy in the mornings',sub)->>'status'='saved','replay returns saved');
 perform pg_temp.ok(public.member_programme_checkin_submit(cp,'better','all',null,gen_random_uuid())->>'status'='already','a second check-in is refused');
 t:=public.member_programme_timeline();
 perform pg_temp.ok((t->>'enabled')::boolean and (t->>'schedulePending')::boolean and jsonb_array_length(t->'checkpoints')=3
  and t#>>'{checkpoints,0,kind}'='week4_review'and t#>>'{checkpoints,0,state}'='open'and t#>>'{checkpoints,0,checkin,note}'='Dizzy in the mornings'
  and t#>>'{checkpoints,1,dueOn}'='2026-04-11','member timeline: states, dates and own check-in');
 perform pg_temp.ok(t::text !~ 'completed_by|actor|9f100000-0000-4000-8000-000000000002','member timeline carries no staff identifiers');
end$$;
reset role;
select pg_temp.ok((select count(*)from public.programme_checkins where member_id in(select pg_temp.mine()))=1,'one check-in stored');
select pg_temp.as_user('10');set local role authenticated;
select pg_temp.ok(pg_temp.code(format('select public.member_programme_checkin_submit(%L,%L,%L,null,gen_random_uuid())',(pg_temp.cp('04','week4_review')).id,'same','all'))='42501','another member refused');
reset role;
select pg_temp.as_user('02');set local role authenticated;
select pg_temp.ok(pg_temp.code($$select public.member_programme_timeline()$$)='42501','staff cannot use the member call');
reset role;

-- 7. Doctor reads: the assigned doctor only.
do $$begin
 perform pg_temp.as_user('03');set local role authenticated;
 perform pg_temp.ok(jsonb_array_length(public.doctor_programme_queue()->'items')=0,'other doctor: empty queue');
 perform pg_temp.ok(pg_temp.code(format('select public.doctor_programme_member(%L)',pg_temp.id('04')))='42501','other doctor refused');
 reset role;perform pg_temp.as_user('06');set local role authenticated;
 perform pg_temp.ok(pg_temp.code($q$select public.doctor_programme_queue()$q$)='42501','nurse: no queue');
 perform pg_temp.ok(pg_temp.code(format('select public.doctor_programme_member(%L)',pg_temp.id('04')))='42501','nurse refused');
 reset role;perform pg_temp.as_user('05');set local role authenticated;
 perform pg_temp.ok(pg_temp.code(format('select public.doctor_programme_member(%L)',pg_temp.id('04')))='42501','admin refused');
 reset role;perform pg_temp.as_user('04');set local role authenticated;
 perform pg_temp.ok(pg_temp.code(format('select public.doctor_programme_member(%L)',pg_temp.id('04')))='42501','member refused');
 perform pg_temp.ok(pg_temp.code(format('select public.doctor_programme_confirm(%L,%L,null,gen_random_uuid())',pg_temp.id('04'),(pg_temp.cp('04','week4_review')).id))='42501','member cannot confirm');
 reset role;
end$$;
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at,source)values
 (pg_temp.id('04'),gen_random_uuid(),148,92,70,now()-interval '2 days','manual'),(pg_temp.id('04'),gen_random_uuid(),140,88,72,now()-interval '1 day','manual');
select pg_temp.as_user('02');set local role authenticated;
do $$declare q jsonb:=public.doctor_programme_queue();d jsonb:=public.doctor_programme_member(pg_temp.id('04'));
begin
 perform pg_temp.ok(jsonb_array_length(q->'items')=2 and q#>>'{items,0,memberId}'=pg_temp.id('10')::text and q#>>'{items,1,kind}'='week4_review'and q#>>'{items,1,checkinAt}'is not null,'queue: open reviews, earliest first, with check-in');
 perform pg_temp.ok(d#>>'{checkpoints,0,checkin,feeling}'='worse'and(d#>>'{readings,last7,count}')::int=2 and(d#>>'{readings,last7,systolic}')::int=144
  and(d#>>'{currentPlan,version}')::int=1 and(d->>'schedulePending')::boolean,'member view: check-in, recorded readings, current plan');
end$$;

-- 8. Confirm: closes the open checkpoint once, with the doctor's note and one notice.
do $$declare cp uuid:=(pg_temp.cp('04','week4_review')).id;sub uuid:=gen_random_uuid();
begin
 perform pg_temp.ok(pg_temp.code(format('select public.doctor_programme_confirm(%L,%L,null,gen_random_uuid())',pg_temp.id('04'),(pg_temp.cp('10','week4_review')).id))='42501','checkpoint of another member refused');
 perform pg_temp.ok(public.doctor_programme_confirm(pg_temp.id('04'),cp,' Keep going with the same plan. ',sub)->>'status'='confirmed','confirmed');
 perform pg_temp.ok(public.doctor_programme_confirm(pg_temp.id('04'),cp,'other',sub)->>'status'='confirmed','replay returns the outcome');
 perform pg_temp.ok(public.doctor_programme_confirm(pg_temp.id('04'),cp,null,gen_random_uuid())->>'status'='closed','a second confirm finds it closed');
end$$;
reset role;
select pg_temp.ok((select state='completed'and outcome='confirmed'and doctor_note='Keep going with the same plan.'and completed_by=pg_temp.id('02')and completed_by_name='Synthetic assigned doctor'
 from public.programme_checkpoints where id=(pg_temp.cp('04','week4_review')).id),'completed by the assigned doctor with the note');
-- The doctor's note is its own app-only message in the member chat, once, and Telegram gets none of it.
select pg_temp.ok((select count(*)=1 and bool_and(outcome='skipped'and reason='telegram_off'and telegram_message_id is null and notice_group='care'
   and app_text=(case public._telegram_auth_locale(pg_temp.id('04'))when 'hy'then 'Ձեր բժշկի նշումը'when 'ru'then 'Заметка вашего врача'else 'Note from your doctor'end)||E'\nKeep going with the same plan.')
 from public.member_notices where event_key='programme.note:'||(pg_temp.cp('04','week4_review')).id::text),'doctor note: one app-only notice with the note text');
select set_config('t.note_text',(case public._telegram_auth_locale(pg_temp.id('04'))when 'hy'then 'Ձեր բժշկի նշումը'when 'ru'then 'Заметка вашего врача'else 'Note from your doctor'end)||E'\nKeep going with the same plan.',false);
select pg_temp.as_user('04');set local role authenticated;
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.member_notices_read()->'notices')n where n->>'text'=current_setting('t.note_text')),'doctor note: the member reads it in the chat notices');
reset role;
select pg_temp.ok((select count(*)=0 from public.member_notices where event_key like 'programme.note:%'and member_id<>pg_temp.id('04')),'doctor note: no other member gets one');
update public.member_notice_settings set care=false;
select public._programme_note_notice(pg_temp.id('04'),gen_random_uuid(),'Another note');
select pg_temp.ok((select count(*)=1 from public.member_notices where event_key like 'programme.note:%'and member_id=pg_temp.id('04')),'doctor note: care notices off, no notice');
update public.member_notice_settings set care=true;
select public._programme_note_notice(pg_temp.id('04'),(pg_temp.cp('04','week4_review')).id,'Replayed note');
select pg_temp.ok((select count(*)=1 and bool_and(app_text like '%Keep going with the same plan.')from public.member_notices where event_key='programme.note:'||(pg_temp.cp('04','week4_review')).id::text),'doctor note: a replay adds nothing');
select public._programme_note_notice(pg_temp.id('04'),gen_random_uuid(),null);
select pg_temp.ok((select count(*)=1 from public.member_notices where event_key like 'programme.note:%'and member_id=pg_temp.id('04')),'doctor note: no note, no notice');
-- The label follows the member's language.
update public.profiles set ui_locale='ru' where id=pg_temp.id('04');
select public._programme_note_notice(pg_temp.id('04'),'11111111-0000-4000-8000-000000000001','Русская заметка');
update public.profiles set ui_locale='en' where id=pg_temp.id('04');
select public._programme_note_notice(pg_temp.id('04'),'11111111-0000-4000-8000-000000000002','English note');
select pg_temp.ok((select count(*)=2 and bool_or(app_text=E'Заметка вашего врача\nРусская заметка')and bool_or(app_text=E'Note from your doctor\nEnglish note')
 from public.member_notices where event_key in('programme.note:11111111-0000-4000-8000-000000000001','programme.note:11111111-0000-4000-8000-000000000002')),'doctor note: label in the member language');
select pg_temp.ok((select count(*)from public.member_notices where event_key='programme.confirmed:'||(pg_temp.cp('04','week4_review')).id::text and template_id='member.programme_plan_confirmed')=1,'one confirm notice');
select pg_temp.ok(pg_temp.code(format('update public.programme_checkpoints set doctor_note=%L where id=%L','changed',(pg_temp.cp('04','week4_review')).id))='55000','completed checkpoint frozen');
select pg_temp.ok(pg_temp.code(format('update public.programme_checkins set feeling=%L where member_id=%L','better',pg_temp.id('04')))='55000','check-in frozen');
select pg_temp.ok(pg_temp.code(format('delete from public.programme_checkpoints where id=%L',(pg_temp.cp('04','month3')).id))='55000','checkpoints are not deleted');

-- 9. Month 3 opens after week 4 closes; a new plan version closes it as republished.
select pg_temp.as_service();
select pg_temp.ok((public.programme_run(pg_temp.yvn('2026-04-08 10:00'))->>'opened')::int=1 and(pg_temp.cp('04','month3')).state='open','month 3 opens three days before');
select pg_temp.ok(pg_temp.code(format('update public.programme_checkpoints set due_on=due_on+1 where id=%L',(pg_temp.cp('04','month3')).id))='55000','an open checkpoint keeps its date');
select pg_temp.publish('04','63',pg_temp.yvn('2026-04-10 11:00'));
select pg_temp.ok((select state='completed'and outcome='republished'and outcome_plan_id=pg_temp.id('63')and completed_by=pg_temp.id('02')from public.programme_checkpoints where id=(pg_temp.cp('04','month3')).id),'republish closes the open checkpoint');
select pg_temp.ok((pg_temp.cp('04','month6')).state='scheduled'and(pg_temp.cp('04','month6')).anchor_plan_id=pg_temp.id('61'),'month 6 stays anchored on the first plan');
select pg_temp.as_user('02');set local role authenticated;
select pg_temp.ok((public.doctor_programme_member(pg_temp.id('04'))#>>'{checkpoints,1,outcomePlanVersion}')::int=2,'doctor view names the new version');
reset role;

-- 10. A plan published while the switch is off still closes the open review it answers.
update public.programme_settings set enabled=false;
select pg_temp.publish('10','64',pg_temp.yvn('2026-02-06 11:00'));
select pg_temp.ok((select state='completed'and outcome='republished'and outcome_plan_id=pg_temp.id('64')from public.programme_checkpoints where id=(pg_temp.cp('10','week4_review')).id),'republish closes the open review even while switched off');

rollback;
\echo 'check-programme-rhythm: ok'
