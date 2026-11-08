-- D2 medicines: off by default; a member keeps only their own self-reported list and ticks;
-- ticks are bound to the medicine's own times and a revision; only the assigned nurse and doctor
-- read adherence (both kinds, kept apart); one reminder per member per dose time, only while
-- something at that time is unticked, never in quiet hours or after an opt-out, no medicine name.
-- Fictional data; rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.id(n text)returns uuid language sql immutable as $$select('d2a00000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.today()returns date language sql as $$select(now()at time zone 'Asia/Yerevan')::date$$;
create function pg_temp.yvn(days integer,hhmm text)returns timestamptz language sql as $$
 select(((pg_temp.today()+days)::text||' '||hhmm)::timestamp at time zone 'Asia/Yerevan')$$;
create function pg_temp.as_user(n text)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),
  'exp',extract(epoch from now()+interval '1 hour')::bigint,'session_id',pg_temp.id('5'||right(n,1)))::text,true)$$;
create function pg_temp.as_service()returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.id(text),pg_temp.today(),pg_temp.yvn(integer,text),pg_temp.as_user(text),pg_temp.as_service()to authenticated,service_role;
create temp table r(k text primary key,v jsonb);grant all on r to authenticated,service_role;

-- 0. Privileges and defaults.
select pg_temp.ok((select not enabled and not reminders from public.member_medicine_settings),'Both switches are off by default');
select pg_temp.ok(not has_table_privilege('authenticated','public.member_medicines','select')and not has_table_privilege('authenticated','public.member_medicine_doses','select')
 and not has_table_privilege('anon','public.member_medicines','select'),'No direct table access');
select pg_temp.ok(not has_function_privilege('anon','public.member_medicine_add(text,text,time[],uuid)','execute')
 and not has_function_privilege('authenticated','public.member_medicine_reminders_run(timestamptz)','execute')
 and has_function_privilege('service_role','public.member_medicine_reminders_run(timestamptz)','execute'),'Anonymous callers reach nothing; the sweep is service-only');

-- Fixtures. 01 member (Telegram connected) with a published plan medicine; 02 another member; 07 doctor; 08 nurse of 01; 09 other nurse; 06 admin.
set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),'3749912'||n||'00',now()from unnest(array['01','02','06','07','08','09'])n;
insert into public.profiles(id,locale,display_name)select pg_temp.id(n),'en','Fictional member '||n from unnest(array['01','02'])n
 on conflict(id)do update set display_name=excluded.display_name;
insert into public.workspace_clinics(id,name,address)values(pg_temp.id('90'),'Fictional Clinic','1 Fictional Street');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.id('06'),'admin','Fictional admin',null),
 (pg_temp.id('07'),'doctor','Fictional doctor',pg_temp.id('90')),(pg_temp.id('08'),'nurse','Fictional nurse',pg_temp.id('90')),(pg_temp.id('09'),'nurse','Other nurse',pg_temp.id('90'));
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.id('5'||right(n,1)),pg_temp.id(n),now(),now()from unnest(array['01','02','06','07','08','09'])n;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.id('01'),pg_temp.id('07'),pg_temp.id('08')),(pg_temp.id('02'),pg_temp.id('07'),pg_temp.id('09'))
 on conflict(user_id)do update set assigned_doctor_id=excluded.assigned_doctor_id,assigned_nurse_id=excluded.assigned_nurse_id;
insert into public.patient_care_plans(id,user_id,clinician,instructions,active,published_at)values(pg_temp.id('70'),pg_temp.id('01'),'Fictional doctor','Fictional instructions',true,now()-interval '2 days');
insert into public.patient_care_medications(id,user_id,plan_id,name,dose,instructions,times,start_date)
 values(pg_temp.id('71'),pg_temp.id('01'),pg_temp.id('70'),'Fictional plan medicine','5 mg','Fictional',array['09:00'::time],pg_temp.today()-2);
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_md',9031,600,'consent-md');
insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
 select pg_temp.id('01'),'member','fictional-md-01',public._telegram_account_ref(s),'+374991201','5559201',1 from public.telegram_channel_settings s;
reset session_replication_role;

set local role authenticated;
-- 1. Off.
select pg_temp.as_user('01');
select pg_temp.ok(public.member_medicines_read()->>'enabled'='false','Off: read says disabled');
select pg_temp.ok(public.member_medicine_add('Fictional','1 tablet',array['08:00'::time])->>'status'='disabled','Off: cannot add');
reset role;
update public.member_medicine_settings set enabled=true;
set local role authenticated;

-- 2. Add, validate, read back as self-reported.
select pg_temp.as_user('01');
select pg_temp.ok(public.member_medicine_add('  ',null,array['08:00'::time])->>'status'='invalid','Empty name refused');
select pg_temp.ok(public.member_medicine_add('Fictional',null,array['08:00'::time,'08:00'::time])->>'status'='invalid','Duplicate times refused');
select pg_temp.ok(public.member_medicine_add('Fictional',null,array['08:00:30'::time])->>'status'='invalid','Seconds refused');
select pg_temp.ok(public.member_medicine_add('Fictional',null,array[]::time[])->>'status'='invalid','No time refused');
insert into r values('m1',public.member_medicine_add(' Fictional own medicine ','1 tablet',array['20:00'::time,'08:00'::time]));
select pg_temp.ok((select v->>'status'='added'from r where k='m1'),'Member adds a self-reported medicine');
-- Started yesterday, so every tick below is in the past whatever the time of day the check runs.
reset role;
update public.member_medicines set started_on=pg_temp.today()-1 where id=(select(v->>'id')::uuid from r where k='m1');
set local role authenticated;
select pg_temp.as_user('01');
select pg_temp.ok((select m->>'source'='self-reported'and m->>'name'='Fictional own medicine'and m->'times'='["08:00","20:00"]'::jsonb
 from jsonb_array_elements(public.member_medicines_read()->'medicines')m),'Stored trimmed, sorted and marked self-reported');

-- 2a. BC-04: a retry after a lost reply adds nothing. The first answer comes back with the same row, reminders go by rows,
-- so they cannot double; the id belongs to one member and one set of values; a full list still replays.
insert into r values('replay',public.member_medicine_add(' Fictional replay ','1 tablet',array['21:00'::time,'09:00'::time],pg_temp.id('a1')));
select pg_temp.ok((select v->>'status'='added'from r where k='replay'),'A request id adds the medicine');
select pg_temp.ok(public.member_medicine_add('Fictional replay','1 tablet',array['09:00'::time,'21:00'::time],pg_temp.id('a1'))->>'id'=(select v->>'id'from r where k='replay'),'The same request answers with the same row, whatever the order of the times');
select pg_temp.ok(public.member_medicine_add('Fictional replay','1 tablet',array['09:00'::time,'21:00'::time],pg_temp.id('a1'))->>'status'='added','It answers as the first time did');
select pg_temp.ok((select count(*)=1 from jsonb_array_elements(public.member_medicines_read()->'medicines')m where m->>'name'='Fictional replay'),'A replay stores one row, so one set of reminders');
select pg_temp.ok(public.member_medicine_add('Fictional other','1 tablet',array['09:00'::time,'21:00'::time],pg_temp.id('a1'))->>'status'='conflict','The same id with another name is refused');
select pg_temp.ok(public.member_medicine_add('Fictional replay','2 tablets',array['09:00'::time,'21:00'::time],pg_temp.id('a1'))->>'status'='conflict','The same id with another dose is refused');
select pg_temp.ok(public.member_medicine_add('Fictional replay','1 tablet',array['09:00'::time],pg_temp.id('a1'))->>'status'='conflict','The same id with other times is refused');
select pg_temp.ok((select count(*)=0 from jsonb_array_elements(public.member_medicines_read()->'medicines')m where m->>'name'='Fictional other'),'A refused replay stores nothing');
select pg_temp.as_user('02');
insert into r values('replay-other',public.member_medicine_add('Fictional replay','1 tablet',array['09:00'::time,'21:00'::time],pg_temp.id('a1')));
select pg_temp.ok((select v->>'status'='added'and v->>'id'<>(select v->>'id'from r where k='replay')from r where k='replay-other'),'The id is the member''s own: another member''s add stores their own row');
select pg_temp.as_user('01');
select pg_temp.ok(public.member_medicine_stop((select(v->>'id')::uuid from r where k='replay'))->>'status'='stopped','Stops');
select pg_temp.ok(public.member_medicine_add('Fictional replay','1 tablet',array['09:00'::time,'21:00'::time],pg_temp.id('a1'))->>'id'=(select v->>'id'from r where k='replay'),'A late replay of a stopped medicine does not bring it back');
select pg_temp.ok((select count(*)=1 from jsonb_array_elements(public.member_medicines_read()->'medicines')m where m->>'name'='Fictional replay'and m->>'stoppedAt'is not null),'It stays stopped and single');
select pg_temp.ok(public.member_medicine_add('Fictional no id',null,array['09:00'::time])->>'status'='added'and public.member_medicine_add('Fictional no id',null,array['09:00'::time])->>'status'='added','Without a request id it adds as before, for the app still live while this deploys');
reset role;
do $$begin
 perform 1 from pg_indexes where schemaname='public'and indexname='member_medicines_request';
 if not found then raise exception 'FAIL: the database itself must hold one row per member and request id';end if;
end$$;
delete from public.member_medicines where name='Fictional no id'and user_id=pg_temp.id('01');
delete from public.member_medicines where name='Fictional replay';
set local role authenticated;
select pg_temp.as_user('01');

-- 2b. Gohar QA 99: the member changes the dose and times of their own medicine; nobody else can, and the doctor's plan
-- medicines are not reachable through it. A time change applies from now (Astra R393-01): the old row stops now with its
-- ticks, and a new row with effective_at = now holds the new times; nothing before the change is counted against it.
select pg_temp.ok(has_function_privilege('authenticated','public.member_medicine_update(uuid,text,time[])','execute')
 and not has_function_privilege('anon','public.member_medicine_update(uuid,text,time[])','execute')
 and not has_function_privilege('service_role','public.member_medicine_update(uuid,text,time[])','execute'),'Update: members only');
reset role;
insert into public.member_medicines(id,user_id,name,dose,times,started_on)values(pg_temp.id('73'),pg_temp.id('01'),'Fictional edit medicine','1 tablet',array['07:00'::time],pg_temp.today()-2);
insert into public.member_medicine_doses(medicine_id,user_id,due_at,status)values(pg_temp.id('73'),pg_temp.id('01'),pg_temp.yvn(-1,'07:00'),'taken');
set local role authenticated;
select pg_temp.as_user('01');
-- Dose only: the same row, nothing else changes.
select pg_temp.ok(public.member_medicine_update(pg_temp.id('73'),' 2 tablets ',array['07:00'::time])->>'id'=pg_temp.id('73')::text,'Dose-only change keeps the row');
select pg_temp.ok(public.member_medicine_update(pg_temp.id('73'),'',array['07:00'::time])->>'status'='saved','Saved with an empty dose');
reset role;
select pg_temp.ok((select dose is null and stopped_at is null and effective_at is null from public.member_medicines where id=pg_temp.id('73')),'An empty dose clears it; still the same live row');
set local role authenticated;
select pg_temp.as_user('01');
select pg_temp.ok(public.member_medicine_update(pg_temp.id('73'),null,array['09:00'::time,'09:00'::time])->>'status'='invalid','Duplicate times refused');
select pg_temp.ok(public.member_medicine_update(pg_temp.id('73'),null,array[]::time[])->>'status'='invalid','No time refused');
select pg_temp.ok(public.member_medicine_update(pg_temp.id('73'),null,array['09:00:30'::time])->>'status'='invalid','Seconds refused');
select pg_temp.ok(public.member_medicine_update(pg_temp.id('73'),repeat('x',121),array['09:00'::time])->>'status'='invalid','Too long a dose refused');
select pg_temp.ok(public.member_medicine_update(pg_temp.id('71'),'50 mg',array['06:00'::time])->>'status'='not-found','The doctor''s plan medicine cannot be edited');
select pg_temp.as_user('02');
select pg_temp.ok(public.member_medicine_update(pg_temp.id('73'),'10 tablets',array['03:00'::time])->>'status'='not-found','Another member cannot edit 01''s medicine');
select pg_temp.as_user('07');
do $$begin perform public.member_medicine_update(pg_temp.id('73'),'10 tablets',array['03:00'::time]);raise exception 'FAIL: staff edited a member medicine';exception when insufficient_privilege then null;end$$;
reset role;
do $$begin perform public.member_medicine_update(pg_temp.id('73'),'10 tablets',array['03:00'::time]);raise exception 'FAIL: no-JWT caller edited';exception when insufficient_privilege then null;end$$;
select pg_temp.ok((select dose is null and times=array['07:00'::time]and stopped_at is null from public.member_medicines where id=pg_temp.id('73'))
 and(select dose='5 mg'and times=array['09:00'::time]from public.patient_care_medications where id=pg_temp.id('71')),'Refused edits changed nothing');
-- A time change: the old row stops with its tick, the new row starts now.
set local role authenticated;
select pg_temp.as_user('01');
insert into r values('m73',public.member_medicine_update(pg_temp.id('73'),'1 tablet',array['21:00'::time,'09:00'::time]));
select pg_temp.ok((select v->>'status'='saved'and v->>'id'<>pg_temp.id('73')::text from r where k='m73'),'Time change saved on a new row');
reset role;
select pg_temp.ok((select stopped_at is not null and times=array['07:00'::time]from public.member_medicines where id=pg_temp.id('73'))
 and exists(select 1 from public.member_medicine_doses where medicine_id=pg_temp.id('73')and status='taken'),'Old schedule stopped now, its tick kept');
select pg_temp.ok((select name='Fictional edit medicine'and dose='1 tablet'and times=array['09:00'::time,'21:00'::time]and effective_at is not null and stopped_at is null
 from public.member_medicines where id=(select(v->>'id')::uuid from r where k='m73')),'New row: same name, new dose and sorted times, effective now');
select pg_temp.ok((select replaced_by=(select(v->>'id')::uuid from r where k='m73')from public.member_medicines where id=pg_temp.id('73')),'QA 118: the old row records the row that replaced it');
set local role authenticated;
select pg_temp.as_user('01');
select pg_temp.ok(public.member_medicine_dose_report((select(v->>'id')::uuid from r where k='m73'),pg_temp.yvn(-1,'09:00'),'taken',0)->>'status'='not-due','No tick before the change on the new schedule');
select pg_temp.ok(public.member_medicine_update(pg_temp.id('73'),null,array['10:00'::time])->>'status'='not-found','The stopped old row cannot be edited');
-- An early tick for a time the new schedule keeps moves to the new row; one for a dropped time stays behind (not counted).
-- Fixed times tomorrow stay ahead of the edit and cannot collide with the new 23:59 time at any hour.
reset role;
insert into public.member_medicines(id,user_id,name,times,started_on)values(pg_temp.id('75'),pg_temp.id('01'),'Fictional early medicine',array['06:00'::time,'06:30'::time],pg_temp.today()-1);
insert into public.member_medicine_doses(medicine_id,user_id,due_at,status)values(pg_temp.id('75'),pg_temp.id('01'),pg_temp.yvn(1,'06:00'),'taken'),(pg_temp.id('75'),pg_temp.id('01'),pg_temp.yvn(1,'06:30'),'taken');
set local role authenticated;
select pg_temp.as_user('01');
insert into r values('m75',public.member_medicine_update(pg_temp.id('75'),null,array['06:00'::time,'23:59'::time]));
reset role;
select pg_temp.ok((select count(*)=1 from public.member_medicine_doses where medicine_id=(select(v->>'id')::uuid from r where k='m75')and status='taken')
 and(select count(*)=1 from public.member_medicine_doses where medicine_id=pg_temp.id('75')),'Early tick for a kept time moves to the new schedule; the dropped time''s stays behind');
delete from public.member_medicines where id in(pg_temp.id('75'),(select(v->>'id')::uuid from r where k='m75'));
-- QA 118 repro: two times, the member removes one after the kept time has passed today. The kept dose stays on the old
-- row, which the read now links to the new one; it can still be ticked there, and not on the new row.
create temp table q118(due timestamptz);grant all on q118 to authenticated;
insert into q118 values(date_trunc('minute',now()-interval '10 minutes'));
insert into public.member_medicines(id,user_id,name,times,started_on)select pg_temp.id('79'),pg_temp.id('01'),'Fictional kept medicine',
 array[(due at time zone 'Asia/Yerevan')::time,((due+interval '1 hour')at time zone 'Asia/Yerevan')::time],pg_temp.today()-2 from q118;
set local role authenticated;
select pg_temp.as_user('01');
insert into r select 'm79',public.member_medicine_update(pg_temp.id('79'),null,array[(due at time zone 'Asia/Yerevan')::time])from q118;
select pg_temp.ok((select m->>'replacedBy'=(select v->>'id'from r where k='m79')from jsonb_array_elements(public.member_medicines_read()->'medicines')m where m->>'id'=pg_temp.id('79')::text),
 'QA 118: the read links the stopped row to its replacement');
select pg_temp.ok((select public.member_medicine_dose_report((select(v->>'id')::uuid from r where k='m79'),due,'taken',0)->>'status'='not-due'from q118),'QA 118: the kept earlier dose is not on the new row');
select pg_temp.ok((select public.member_medicine_dose_report(pg_temp.id('79'),due,'taken',0)->>'status'='saved'from q118),'QA 118: the kept earlier dose is ticked on the old row');
reset role;
select pg_temp.ok((select count(*)=1 from public.member_medicine_doses d join q118 on d.due_at=q118.due where d.medicine_id=pg_temp.id('79')and d.status='taken'),'QA 118: that tick stays on the old row');
-- Kept follows each later schedule while it keeps the time and ends on a live row.
select pg_temp.ok((select public._member_medicine_kept(pg_temp.id('79'),(due at time zone 'Asia/Yerevan')::time)from q118)
 and not(select public._member_medicine_kept(pg_temp.id('79'),((due+interval '1 hour')at time zone 'Asia/Yerevan')::time)from q118),'QA 118: kept for the kept time, not for the removed one');
insert into public.member_medicines(id,user_id,name,times,started_on,stopped_at,replaced_by)
 values(pg_temp.id('80'),pg_temp.id('01'),'Fictional chain medicine',array['06:00'::time],pg_temp.today()-3,now()-interval '1 hour',null),
       (pg_temp.id('81'),pg_temp.id('01'),'Fictional chain medicine',array['06:00'::time,'07:00'::time],pg_temp.today()-1,now()-interval '30 minutes',null),
       (pg_temp.id('82'),pg_temp.id('01'),'Fictional chain medicine',array['06:00'::time],pg_temp.today(),null,null);
update public.member_medicines set replaced_by=pg_temp.id('81')where id=pg_temp.id('80');
update public.member_medicines set replaced_by=pg_temp.id('82')where id=pg_temp.id('81');
select pg_temp.ok(public._member_medicine_kept(pg_temp.id('80'),'06:00')and not public._member_medicine_kept(pg_temp.id('81'),'07:00'),'QA 118: kept is followed through two changes');
update public.member_medicines set stopped_at=now()where id=pg_temp.id('82');
select pg_temp.ok(not public._member_medicine_kept(pg_temp.id('80'),'06:00'),'QA 118: not kept once the medicine is stopped');
delete from public.member_medicines where id in(pg_temp.id('80'),pg_temp.id('81'),pg_temp.id('82'),pg_temp.id('79'),(select(v->>'id')::uuid from r where k='m79'));
set local role authenticated;
set local role authenticated;
select pg_temp.as_user('07');
select pg_temp.ok((select bool_or(s->>'id'=pg_temp.id('73')::text and s->'times'='["07:00"]'::jsonb and jsonb_array_length(s->'doses')=1)
  and bool_or(s->>'id'=(select v->>'id'from r where k='m73')and s->>'effectiveAt'is not null)
 from jsonb_array_elements(public.member_medicines_staff_read(pg_temp.id('01'),14)->'self')s),'Adherence: the old schedule with its tick, the new one from its change');
reset role;
delete from public.member_medicines where id in(pg_temp.id('73'),(select(v->>'id')::uuid from r where k='m73'));
set local role authenticated;
select pg_temp.as_user('01');

-- 3. Ticks: only the medicine's times, not far ahead, with the revision.
create function pg_temp.tick(at timestamptz,st text,rev int)returns jsonb language sql as $$
 select public.member_medicine_dose_report((select(v->>'id')::uuid from r where k='m1'),at,st,rev)$$;
grant execute on function pg_temp.tick(timestamptz,text,int)to authenticated;
select pg_temp.ok(pg_temp.tick(pg_temp.yvn(-1,'08:00'),'taken',0)->>'status'='saved','Tick yesterday 08:00 as taken');
select pg_temp.ok(pg_temp.tick(pg_temp.yvn(-1,'08:00'),'skipped',0)->>'status'='conflict','A stale revision is refused');
select pg_temp.ok(pg_temp.tick(pg_temp.yvn(-1,'08:00'),'skipped',1)->>'status'='saved','The member corrects it with the revision');
select pg_temp.ok(pg_temp.tick(pg_temp.yvn(-1,'08:30'),'taken',0)->>'status'='not-due','A time that is not the medicine''s is refused');
select pg_temp.ok(pg_temp.tick(pg_temp.yvn(2,'08:00'),'taken',0)->>'status'='not-due','Days ahead is refused');
select pg_temp.ok(pg_temp.tick(pg_temp.yvn(-2,'08:00'),'taken',0)->>'status'='not-due','Before the medicine was added is refused');
select pg_temp.ok(pg_temp.tick(pg_temp.yvn(-1,'08:00'),'maybe',1)->>'status'='invalid','Unknown status refused');

-- 4. Other people.
select pg_temp.as_user('02');
select pg_temp.ok(jsonb_array_length(public.member_medicines_read()->'medicines')=0,'Another member sees nothing of 01');
do $$begin perform pg_temp.tick(pg_temp.yvn(0,'20:00'),'taken',0);raise exception 'FAIL: another member ticked 01''s medicine';exception when insufficient_privilege then null;end$$;
select pg_temp.ok(public.member_medicine_stop((select(v->>'id')::uuid from r where k='m1'))->>'status'='not-found','Another member cannot stop 01''s medicine');
select pg_temp.as_user('09');
do $$begin perform public.member_medicines_staff_read(pg_temp.id('01'),14);raise exception 'FAIL: unassigned nurse read adherence';exception when insufficient_privilege then null;end$$;
select pg_temp.as_user('06');
do $$begin perform public.member_medicines_staff_read(pg_temp.id('01'),14);raise exception 'FAIL: admin read adherence';exception when insufficient_privilege then null;end$$;
do $$begin perform public.member_medicine_add('Fictional',null,array['08:00'::time]);raise exception 'FAIL: staff added a member medicine';exception when insufficient_privilege then null;end$$;
select pg_temp.as_user('07');
insert into r values('staff',public.member_medicines_staff_read(pg_temp.id('01'),14));
select pg_temp.ok((select jsonb_array_length(v->'self')=1 and jsonb_array_length(v->'plan')=1 and v->'self'->0->>'source'='self-reported'and v->'plan'->0->>'source'='plan'
 and v->'self'->0->'doses'->0->>'status'='skipped'from r where k='staff'),'Assigned doctor reads both kinds, kept apart, with the ticks');

-- 5. Reminders.
reset role;
update public.member_notice_settings set reminders=true,throttle_seconds=0,hourly_cap=60;
select pg_temp.as_service();
select pg_temp.ok(public.member_medicine_reminders_run(pg_temp.yvn(0,'20:02'))->>'state'='off','Medicine reminders off: nothing');
update public.member_medicine_settings set reminders=true;
select pg_temp.ok((public.member_medicine_reminders_run(pg_temp.yvn(-1,'08:05'))->>'queued')::int=0,'08:00 is ticked (skipped counts as reported): no reminder');
select pg_temp.ok((public.member_medicine_reminders_run(pg_temp.yvn(0,'09:03'))->>'queued')::int=1,'Plan medicine at 09:00, unticked: one reminder');
select pg_temp.ok((public.member_medicine_reminders_run(pg_temp.yvn(0,'09:08'))->>'queued')::int=0,'No second reminder for the same time');
-- Throttle (review F2): a reminder held by the throttle is not journaled, so a later sweep can still send it.
update public.member_notice_settings set throttle_seconds=600;
select pg_temp.ok(public._member_reminder_held(pg_temp.id('01'),'member.reminder_medicine'),'Throttle holds a second reminder within 10 minutes');
select pg_temp.ok((public.member_medicine_reminders_run(pg_temp.yvn(0,'20:02'))->>'queued')::int=0,'Held: nothing queued');
select pg_temp.ok(not exists(select 1 from public.member_notices where member_id=pg_temp.id('01')and reason='throttled'),'Held: nothing journaled');
update public.member_notice_settings set throttle_seconds=0;
select pg_temp.ok((public.member_medicine_reminders_run(pg_temp.yvn(0,'09:20'))->>'queued')::int=0,'After 15 minutes: nothing');
select pg_temp.ok((public.member_medicine_reminders_run(pg_temp.yvn(0,'20:02'))->>'queued')::int=1,'Own medicine at 20:00, unticked: one reminder');
select pg_temp.ok((select bool_and(m.template_id='member.reminder_medicine'and m.params ?& array['time']and(m.params-'time')='{}'::jsonb
 and m.body!~*'fictional|tablet|mg|medicine name'and m.keyboard->>'url'like '%/patient/medicines')
 from public.member_notices n join public.telegram_auth_messages m on m.id=n.telegram_message_id where n.member_id=pg_temp.id('01')),'Reminders carry the time only; no medicine name');
-- Offset, opt-out and quiet hours from the member's own reminder settings.
insert into public.patient_reminder_preferences(user_id,revision,preferences)values(pg_temp.id('01'),1,
 '{"medicationEnabled":true,"medicationOffsetMinutes":15,"bpEnabled":false,"bpTimes":["08:00"],"quietStart":"22:00","quietEnd":"07:00"}');
select pg_temp.ok((public.member_medicine_reminders_run(pg_temp.yvn(1,'09:03'))->>'queued')::int=0
 and(public.member_medicine_reminders_run(pg_temp.yvn(1,'09:17'))->>'queued')::int=1,'A 15-minute offset moves the reminder');
update public.patient_reminder_preferences set preferences=jsonb_set(preferences,'{quietStart}','"19:00"')where user_id=pg_temp.id('01');
select pg_temp.ok((public.member_medicine_reminders_run(pg_temp.yvn(1,'20:17'))->>'queued')::int=0,'Quiet hours: no reminder');
update public.patient_reminder_preferences set preferences=jsonb_set(jsonb_set(preferences,'{quietStart}','"22:00"'),'{medicationEnabled}','false')where user_id=pg_temp.id('01');
select pg_temp.ok((public.member_medicine_reminders_run(pg_temp.yvn(2,'09:17'))->>'queued')::int=0,'Medicine reminders turned off by the member: none');

-- A dose just after midnight with a negative offset is reminded the evening before (review item 47).
reset role;
update public.patient_reminder_preferences set preferences=preferences||'{"medicationEnabled":true,"medicationOffsetMinutes":-15,"quietStart":"03:00","quietEnd":"04:00"}'::jsonb where user_id=pg_temp.id('01');
insert into public.member_medicines(id,user_id,name,times,started_on)values(pg_temp.id('72'),pg_temp.id('01'),'Fictional midnight medicine',array['00:05'::time],pg_temp.today()-1);
select pg_temp.as_service();
select pg_temp.ok((public.member_medicine_reminders_run(pg_temp.yvn(1,'23:52'))->>'queued')::int=1,'00:05 dose with a -15 minute offset: reminded at 23:50 the evening before');
reset role;
delete from public.member_medicines where id=pg_temp.id('72');
update public.patient_reminder_preferences set preferences=preferences||'{"medicationEnabled":false,"medicationOffsetMinutes":15,"quietStart":"22:00","quietEnd":"07:00"}'::jsonb where user_id=pg_temp.id('01');

-- QA 99: a replacement row's slot before its change is never reminded; a slot after it is.
reset role;
insert into public.member_medicines(id,user_id,name,times,started_on,effective_at)
 values(pg_temp.id('74'),pg_temp.id('01'),'Fictional replaced medicine',array['12:10'::time,'18:10'::time],pg_temp.today(),pg_temp.yvn(3,'15:00'));
update public.member_medicines set started_on=pg_temp.today()+3 where id=pg_temp.id('74');
update public.patient_reminder_preferences set preferences=jsonb_set(preferences,'{medicationEnabled}','true')where user_id=pg_temp.id('01');
select pg_temp.as_service();
select pg_temp.ok((public.member_medicine_reminders_run(pg_temp.yvn(3,'12:27'))->>'queued')::int=0,'QA 99: no reminder for a slot before the schedule change');
select pg_temp.ok((public.member_medicine_reminders_run(pg_temp.yvn(3,'18:27'))->>'queued')::int=1,'QA 99: the new schedule is reminded after the change');
reset role;
delete from public.member_medicines where id=pg_temp.id('74');
-- QA 118: a kept time's slot before the change is still reminded on the replaced row; a removed time's is not.
insert into public.member_medicines(id,user_id,name,times,started_on,stopped_at)
 values(pg_temp.id('77'),pg_temp.id('01'),'Fictional kept medicine',array['12:40'::time,'18:40'::time],pg_temp.today(),pg_temp.yvn(3,'21:00'));
insert into public.member_medicines(id,user_id,name,times,started_on,effective_at)
 values(pg_temp.id('78'),pg_temp.id('01'),'Fictional kept medicine',array['12:40'::time],pg_temp.today()+3,pg_temp.yvn(3,'21:00'));
update public.member_medicines set replaced_by=pg_temp.id('78')where id=pg_temp.id('77');
select pg_temp.as_service();
select pg_temp.ok((public.member_medicine_reminders_run(pg_temp.yvn(3,'12:57'))->>'queued')::int=1,'QA 118: the kept time is reminded the day of the change');
select pg_temp.ok((public.member_medicine_reminders_run(pg_temp.yvn(3,'18:57'))->>'queued')::int=0,'QA 118: the removed time is not');
reset role;
delete from public.member_medicines where id in(pg_temp.id('77'),pg_temp.id('78'));
update public.patient_reminder_preferences set preferences=jsonb_set(preferences,'{medicationEnabled}','false')where user_id=pg_temp.id('01');

-- 6. Stop keeps history and ends reminders.
update public.patient_reminder_preferences set preferences=jsonb_set(preferences,'{medicationEnabled}','true')where user_id=pg_temp.id('01');
select pg_temp.as_user('01');
set local role authenticated;
select pg_temp.ok(public.member_medicine_stop((select(v->>'id')::uuid from r where k='m1'))->>'status'='stopped','Member stops the medicine');
select pg_temp.ok((select m->>'stoppedAt'is not null and jsonb_array_length(m->'doses')=1 from jsonb_array_elements(public.member_medicines_read()->'medicines')m),'History stays after a stop');
reset role;
select pg_temp.as_service();
select pg_temp.ok((public.member_medicine_reminders_run(pg_temp.yvn(1,'20:17'))->>'queued')::int=0,'A stopped medicine gets no reminder');
rollback;
