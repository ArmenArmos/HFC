-- The one BP check's send to the doctor (20261103100100): every save writer at the boundary readings. A member's first very high
-- reading sends nothing, a repeat after the rest does, staff readings do at once, anything below 180/110 or older than a day stays
-- quiet, and a member reads only their own recent readings. Rolled back. Synthetic fixtures only.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text)returns void language plpgsql as $$begin perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated')::text,true);end$$;
create function pg_temp.save(m text,s int,d int,minutes_ago int)returns void language plpgsql as $$begin
 insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)values(m::uuid,gen_random_uuid(),s,d,clock_timestamp()-make_interval(mins=>minutes_ago));end$$;
create function pg_temp.alerts(m text)returns text language sql as $$select coalesce(string_agg(reason_code,','order by reason_code),'')from public.care_alerts where member_id=m::uuid and source='reading'$$;
create function pg_temp.reset(m text)returns void language sql as $$delete from public.care_alerts where member_id=m::uuid;delete from public.bp_repeat_notes where member_id=m::uuid;delete from public.patient_measurements where user_id=m::uuid$$;

-- The rule's table, the same rows as scripts/check-bp-one-rule.ts.
select pg_temp.ok(public._bp_check_level(179,109,true,true)is null,'179/109 is below the rule');
select pg_temp.ok(public._bp_check_level(185,115,false,false)is null,'a first reading sends nothing');
select pg_temp.ok(public._bp_check_level(170,115,true,false)='bp_doctor_48h','170/115 repeated: 48 hours');
select pg_temp.ok(public._bp_check_level(179,119,true,false)='bp_doctor_48h','179/119 repeated: 48 hours');
select pg_temp.ok(public._bp_check_level(185,115,true,false)='bp_doctor_today','185/115 repeated: today, either number counts');
select pg_temp.ok(public._bp_check_level(170,120,true,false)='bp_doctor_today','170/120 repeated: today');
select pg_temp.ok(public._bp_check_level(200,125,false,true)='bp_doctor_today','a staff reading sends at once');
select pg_temp.ok(public._bp_check_level(170,112,false,true)='bp_doctor_48h','a staff reading in the band');

insert into auth.users(id,phone,phone_confirmed_at)values('bb000000-0000-4000-8000-000000000001','37499084001',now()),('bb000000-0000-4000-8000-000000000002','37499084002',now()),('bb000000-0000-4000-8000-000000000003','37499084003',now());
insert into public.patient_clinical_cases(user_id)values('bb000000-0000-4000-8000-000000000001'),('bb000000-0000-4000-8000-000000000002');
insert into public.care_alert_settings(singleton,enabled)values(true,true)on conflict(singleton)do update set enabled=true;

-- A first reading at the same-day cut leaves a quiet note: no alert. The band below stays repeat-first.
create function pg_temp.notes(m text)returns bigint language sql as $$select count(*)from public.bp_repeat_notes where member_id=m::uuid and closed_at is null$$;
select pg_temp.as_user('bb000000-0000-4000-8000-000000000001');
select pg_temp.save('bb000000-0000-4000-8000-000000000001',170,115,70);
select pg_temp.ok(pg_temp.notes('bb000000-0000-4000-8000-000000000001')=0,'The 180/110 band stays repeat-first: no note');
select pg_temp.save('bb000000-0000-4000-8000-000000000002',150,90,300);
select pg_temp.as_user('bb000000-0000-4000-8000-000000000002');
select pg_temp.save('bb000000-0000-4000-8000-000000000002',185,115,60);
select pg_temp.ok(pg_temp.notes('bb000000-0000-4000-8000-000000000002')=1,'180 or more alone: a quiet note at once');
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000002')='','The note is no alert');
select pg_temp.save('bb000000-0000-4000-8000-000000000002',184,114,58);
select pg_temp.ok(pg_temp.notes('bb000000-0000-4000-8000-000000000002')=1,'A second reading inside the rest adds no second note');
select pg_temp.save('bb000000-0000-4000-8000-000000000002',186,122,40);
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000002')='bp_doctor_today','A confirmed repeat raises the alert');
select pg_temp.ok(pg_temp.notes('bb000000-0000-4000-8000-000000000002')=0,'The alert takes the note''s place: no duplicate');
delete from public.care_alerts where member_id='bb000000-0000-4000-8000-000000000002';delete from public.bp_repeat_notes where member_id='bb000000-0000-4000-8000-000000000002';delete from public.patient_measurements where user_id='bb000000-0000-4000-8000-000000000002';
select pg_temp.save('bb000000-0000-4000-8000-000000000002',170,125,30);
select pg_temp.ok(pg_temp.notes('bb000000-0000-4000-8000-000000000002')=1,'120 or more alone: a quiet note');
select pg_temp.save('bb000000-0000-4000-8000-000000000002',130,80,10);
select pg_temp.ok(pg_temp.notes('bb000000-0000-4000-8000-000000000002')=0,'A calm repeat closes it');
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000002')='','A calm repeat raises nothing');
delete from public.bp_repeat_notes where member_id='bb000000-0000-4000-8000-000000000002';delete from public.patient_measurements where user_id='bb000000-0000-4000-8000-000000000002';
update public.care_alert_settings set enabled=false;
select pg_temp.save('bb000000-0000-4000-8000-000000000002',190,125,1);
select pg_temp.ok(pg_temp.notes('bb000000-0000-4000-8000-000000000002')=1,'Alerts off: the note still stands');
update public.care_alert_settings set enabled=true;
delete from public.bp_repeat_notes where member_id='bb000000-0000-4000-8000-000000000002';delete from public.patient_measurements where user_id='bb000000-0000-4000-8000-000000000002';delete from public.patient_measurements where user_id='bb000000-0000-4000-8000-000000000001';
select pg_temp.ok((select label_en like '%within 48 hours%'and label_hy like '%48 ժամ%'from public.nurse_visit_checklist where version='protocol-draft-2'and id='severe-bp-contact'),'The checklist says the rule');
select pg_temp.ok((select checklist_version='protocol-draft-2'from public.nurse_visit_settings),'The checklist pointer moved to the reworded version');
select pg_temp.ok((select label_en not like '%within 48 hours%'from public.nurse_visit_checklist where version='protocol-draft-1'and id='severe-bp-contact'),'The old version keeps its wording');
select pg_temp.ok((select count(*)=(select count(*)from public.nurse_visit_checklist where version='protocol-draft-1')from public.nurse_visit_checklist where version='protocol-draft-2'),'The new version has every item');
do $t$ begin update public.nurse_visit_checklist set label_en='changed text'where version='protocol-draft-2'and id='severe-bp-contact';raise exception 'checklist rows must stay frozen';exception when sqlstate '55000' then null;end$t$;

-- A member's readings: no user claim is the Telegram path, and the same as the member's own session.
select pg_temp.as_user('bb000000-0000-4000-8000-000000000001');
select pg_temp.save('bb000000-0000-4000-8000-000000000001',165,100,30);
select pg_temp.save('bb000000-0000-4000-8000-000000000001',179,109,20);
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000001')='','Below 180/110 writes nothing');
select pg_temp.save('bb000000-0000-4000-8000-000000000001',185,115,20);
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000001')='','First very high reading: no alert before the repeat');
select pg_temp.save('bb000000-0000-4000-8000-000000000001',184,114,18);
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000001')='','A repeat inside the rest does not count');
select pg_temp.save('bb000000-0000-4000-8000-000000000001',170,112,10);
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000001')='bp_doctor_48h','A repeat in the band sends once');
select pg_temp.ok((select rule_id='clinical.bp_one_rule'and red_flags='{RF-06}'and rule_version='bp-one-rule-1'from public.care_alerts where member_id='bb000000-0000-4000-8000-000000000001'and source='reading'),'The alert names the rule');
select pg_temp.ok((select count(*)=1 from public.care_alert_screenings where member_id='bb000000-0000-4000-8000-000000000001'and source='reading'),'One screening row per sending reading');
select pg_temp.reset('bb000000-0000-4000-8000-000000000001');
select pg_temp.save('bb000000-0000-4000-8000-000000000001',190,125,60);
select pg_temp.save('bb000000-0000-4000-8000-000000000001',192,126,10);
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000001')='bp_doctor_today','A repeat at 180/120: doctor today');
select pg_temp.reset('bb000000-0000-4000-8000-000000000001');
select pg_temp.save('bb000000-0000-4000-8000-000000000001',190,125,300);
select pg_temp.save('bb000000-0000-4000-8000-000000000001',192,126,10);
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000001')='','Hours later is a new first reading');
select pg_temp.reset('bb000000-0000-4000-8000-000000000001');
select pg_temp.save('bb000000-0000-4000-8000-000000000001',190,125,2000);
select pg_temp.save('bb000000-0000-4000-8000-000000000001',191,125,1990);
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000001')='','Back-dated pairs stay quiet');
select pg_temp.reset('bb000000-0000-4000-8000-000000000001');

-- A staff entry: the actor is not the member, so a single reading sends.
select pg_temp.as_user('bb000000-0000-4000-8000-000000000003');
select pg_temp.save('bb000000-0000-4000-8000-000000000001',170,112,1);
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000001')='bp_doctor_48h','A nurse or doctor entry sends at once');
select pg_temp.save('bb000000-0000-4000-8000-000000000002',150,90,1);
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000002')='','A staff entry below the rule stays quiet');

-- A nurse's visit mark sends before the visit is completed.
insert into public.nurse_visit_marks(member_id,source,source_id,item,done,vals,submission_id,actor_id,actor_name)
 values('bb000000-0000-4000-8000-000000000002','appointment',gen_random_uuid(),'measure:weight',true,'{"value":80}',gen_random_uuid(),'bb000000-0000-4000-8000-000000000003','Fictional'),
 ('bb000000-0000-4000-8000-000000000002','appointment',gen_random_uuid(),'measure:bp',true,'{"systolic":150,"diastolic":90}',gen_random_uuid(),'bb000000-0000-4000-8000-000000000003','Fictional');
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000002')='','Ordinary marks stay quiet');
insert into public.nurse_visit_marks(member_id,source,source_id,item,done,vals,submission_id,actor_id,actor_name)
 values('bb000000-0000-4000-8000-000000000002','appointment',gen_random_uuid(),'measure:bp',true,'{"systolic":186,"diastolic":122,"pulse":80}',gen_random_uuid(),'bb000000-0000-4000-8000-000000000003','Fictional');
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000002')='bp_doctor_today','A very high nurse mark goes to the doctor');

-- Switched off: nothing raised, the save still works.
update public.care_alert_settings set enabled=false;
select pg_temp.reset('bb000000-0000-4000-8000-000000000002');
select pg_temp.save('bb000000-0000-4000-8000-000000000002',200,125,1);
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000002')='','Alerts off: nothing raised');
select pg_temp.ok(exists(select 1 from public.patient_measurements where user_id='bb000000-0000-4000-8000-000000000002'),'Alerts off: saved');

-- BP-05: one live alert, its reason only goes up: 48 hours, today, 48 hours again stays today.
select pg_temp.as_user('bb000000-0000-4000-8000-000000000003');
update public.care_alert_settings set enabled=true;
select pg_temp.reset('bb000000-0000-4000-8000-000000000001');
select pg_temp.save('bb000000-0000-4000-8000-000000000001',170,112,30);
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000001')='bp_doctor_48h','48 hours first');
select pg_temp.save('bb000000-0000-4000-8000-000000000001',190,125,20);
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000001')='bp_doctor_today','Today replaces it on the live alert');
select pg_temp.save('bb000000-0000-4000-8000-000000000001',170,112,10);
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000001')='bp_doctor_today','And never goes back down');
select pg_temp.ok((select count(*)=1 from public.care_alerts where member_id='bb000000-0000-4000-8000-000000000001'and source='reading'),'One live alert');
select pg_temp.reset('bb000000-0000-4000-8000-000000000001');

-- BP-06: a failed raise keeps the note and the save, and the sweep raises one alert. The added check stands in for a lock timeout.
select pg_temp.as_user('bb000000-0000-4000-8000-000000000001');
select pg_temp.save('bb000000-0000-4000-8000-000000000001',190,125,30);
select pg_temp.ok(pg_temp.notes('bb000000-0000-4000-8000-000000000001')=1,'A note waits');
alter table public.care_alert_screenings add constraint bp_retry_test check(source<>'reading')not valid;
select pg_temp.save('bb000000-0000-4000-8000-000000000001',192,126,10);
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000001')='','The raise failed');
select pg_temp.ok((select count(*)=2 from public.patient_measurements where user_id='bb000000-0000-4000-8000-000000000001'),'The save stands');
select pg_temp.ok(pg_temp.notes('bb000000-0000-4000-8000-000000000001')=1,'The note stays until the alert exists');
select pg_temp.ok((select count(*)=1 from public.bp_check_retries where member_id='bb000000-0000-4000-8000-000000000001'),'The work is kept');
alter table public.care_alert_screenings drop constraint bp_retry_test;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.ok((public.bp_check_retry(20)->>'raised')='1','The sweep raises it');
select pg_temp.ok((public.bp_check_retry(20)->>'raised')='0','And once');
select pg_temp.ok(pg_temp.alerts('bb000000-0000-4000-8000-000000000001')='bp_doctor_today','One alert');
-- Earlier scenarios leave their screenings (reset removes alerts, notes and readings only): count this scenario's readings.
select pg_temp.ok((select count(*)=1 from public.care_alert_screenings where member_id='bb000000-0000-4000-8000-000000000001'and source='reading'and source_ref in(select id::text from public.patient_measurements where user_id='bb000000-0000-4000-8000-000000000001')),'One screening');
select pg_temp.ok(pg_temp.notes('bb000000-0000-4000-8000-000000000001')=0,'The alert took the note''s place');
select pg_temp.ok(not exists(select 1 from public.bp_check_retries where member_id='bb000000-0000-4000-8000-000000000001'),'Nothing left to retry');
select pg_temp.reset('bb000000-0000-4000-8000-000000000001');

-- member_bp_recent: a member's own readings, not another's, and a named member only for the service role.
select pg_temp.as_user('bb000000-0000-4000-8000-000000000001');
select pg_temp.ok(jsonb_array_length(public.member_bp_recent('bb000000-0000-4000-8000-000000000002'))=(select count(*)from public.patient_measurements where user_id='bb000000-0000-4000-8000-000000000001'),'A member passing another id still reads their own');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.ok(jsonb_array_length(public.member_bp_recent('bb000000-0000-4000-8000-000000000002'))=1,'The service role names the member');
rollback;
