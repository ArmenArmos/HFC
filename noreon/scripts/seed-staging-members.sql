-- Staging site only: six fictional members at different stages, with readings, results, plans, a 103 alert, nurse tasks
-- and visits. Run with scripts/seed-staging-members.sh, which refuses any database but noreon-staging.
-- Needs seed-staging-accounts.mjs first (phones +37499000101..106, staff, clinic). Each section is skipped when the member
-- already has that data, so the script can be rerun. All names and numbers are invented.
--   101 fresh sign-up        102 questionnaire done + 103 alert    103 tests booked
--   104 results in           105 plan published                   106 blood pressure week
\set ON_ERROR_STOP on
\set answers `cat scripts/fixtures/patient-answers.json`
begin;
do $$
begin
 if not exists(select 1 from auth.users where email='staging-admin@example.invalid')then raise exception 'Not the staging database: run seed-staging-accounts.mjs first';end if;
end$$;
create temp table demo(n int primary key,id uuid,name text,birth date,sex text);
insert into demo(n,id,name,birth,sex)select v.n,u.id,v.name,v.birth,v.sex from(values
 (101,'Aram Test One','1984-03-12'::date,'male'),(102,'Lilit Test Two','1971-07-30','female'),(103,'Hayk Test Three','1966-11-02','male'),
 (104,'Nare Test Four','1959-01-21','female'),(105,'Gor Test Five','1962-09-09','male'),(106,'Anna Test Six','1975-05-17','female'))v(n,name,birth,sex)
join auth.users u on u.phone='37499000'||v.n::text;
do $$begin if(select count(*)from demo)<>6 then raise exception 'Member phones missing: run seed-staging-accounts.mjs';end if;end$$;
create temp table who as select
 (select user_id from public.workspace_staff where role='doctor' and display_name='Staging Doctor')doctor,
 (select user_id from public.workspace_staff where role='nurse' and display_name='Staging Nurse')nurse,
 (select id from public.workspace_clinics where name='Staging Clinic')clinic;

-- Fictional staging clinic only; no switch or email changes.
-- The existing generator writes booking_manual_capacity and offers with stable keys, preserving holds.
do $$
declare clinic uuid;actor uuid;
begin
 if not exists(select 1 from auth.users where email='staging-admin@example.invalid')then
  raise exception 'Not the staging database: run seed-staging-accounts.mjs first';
 end if;
 select c.id,u.id into clinic,actor from public.workspace_clinics c
  cross join auth.users u where c.name='Staging Clinic'and c.address='Fictional test location'and c.active
  and u.email='staging-doctor@example.invalid';
 if clinic is null or actor is null then raise exception 'Fictional staging clinic or doctor missing';end if;
 insert into public.clinic_schedules(clinic_id,active,slot_minutes,capacity,covered_test_ids,preparation,updated_by)
 values(clinic,true,30,2,array['lipid-panel','hba1c'],
  'Fictional staging schedule. Your care team will confirm preparation before your visit.',actor)
 on conflict(clinic_id)do nothing;
 insert into public.clinic_schedule_hours(clinic_id,weekday,opens,closes)
 select clinic,d::smallint,time '09:00',time '18:00'from generate_series(1,5)d
 on conflict(clinic_id,weekday)do nothing;
 -- seed-staging.sql enables clinic scheduling. This remains inert if that database switch is off.
 perform public._clinic_schedule_generate(clinic,true);
end$$;

-- Profiles and consent for everyone
insert into public.profiles(id,display_name,birth_date,biological_sex,locale,ui_locale,is_test_account)
select id,name,birth,sex,'en','en',true from demo
on conflict(id)do update set display_name=excluded.display_name,birth_date=excluded.birth_date,biological_sex=excluded.biological_sex,locale='en',ui_locale='en';
insert into public.patient_consents(user_id,version)select id,'patient-pilot-v1' from demo on conflict do nothing;

-- Questionnaire done (102..106): assessment completed, case assigned to the staging doctor and nurse
insert into public.patient_assessments(user_id,answers,completed_at,revision)
select d.id,(:'answers')::jsonb||jsonb_build_object('q1.age',jsonb_build_object('value',extract(year from age(d.birth))::int,'source','manual','fieldId','q1.age','answeredAt',now()),
 'q1.sex',jsonb_build_object('value',d.sex,'source','manual','fieldId','q1.sex','answeredAt',now())),now()-interval '10 days',1
from demo d where d.n>=102 and not exists(select 1 from public.patient_assessments a where a.user_id=d.id);
insert into public.patient_assessments(user_id)select id from demo d where n=101 and not exists(select 1 from public.patient_assessments a where a.user_id=d.id);
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)
select d.id,w.doctor,w.nurse from demo d,who w where d.n>=102 on conflict(user_id)do nothing;

-- 102: red flag, which raises a 103 care alert for the doctor
update public.patient_assessments set urgent_rule='RF-03',revision=revision+1
where user_id=(select id from demo where n=102)and urgent_rule is distinct from 'RF-03';

-- 103 and later: tests ordered; 103 has a confirmed appointment for them
insert into public.patient_care_tests(user_id,title,preparation,status,ordered_by,ordered_at,due_at,location,source,source_label)
select d.id,t.title,t.prep,case when d.n>=104 then 'collected' else 'ordered' end,'Staging Doctor',now()-interval '8 days',now()+case when d.n>=104 then interval '-5 days' else interval '3 days' end,'Staging Clinic','clinic','Staging Clinic'
from demo d cross join(values('Lipid panel (LDL, HDL, triglycerides)','Fast for 12 hours.'),('HbA1c','No preparation.'))t(title,prep)
where d.n between 103 and 105 and not exists(select 1 from public.patient_care_tests x where x.user_id=d.id);
insert into public.patient_care_appointments(user_id,clinician,specialty,location,starts_at,status)
select d.id,'Staging Doctor','Cardiology','Staging Clinic, fictional address',now()+interval '3 days','confirmed' from demo d
where d.n=103 and not exists(select 1 from public.patient_care_appointments x where x.user_id=d.id);

-- 104 and 105: results in (LDL high, HbA1c normal), reviewed by the doctor
insert into public.patient_care_results(user_id,test_id,marker,value,unit,reference_low,reference_high,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,explanation)
select d.id,(select id from public.patient_care_tests t where t.user_id=d.id and t.title like 'Lipid%'),r.marker,r.v,r.unit,r.lo,r.hi,now()-interval '5 days',now()-interval '4 days','clinic','Staging Clinic',
 case when d.n=105 then now()-interval '3 days' end,case when d.n=105 then 'Staging Doctor' end,case when d.n=105 then 'Your LDL is above the goal; the plan below explains the next step.' end
from demo d cross join(values('LDL cholesterol',4.6,'mmol/L',0.0,3.0),('HbA1c',5.4,'%',4.0,5.7))r(marker,v,unit,lo,hi)
where d.n in(104,105)and not exists(select 1 from public.patient_care_results x where x.user_id=d.id);

-- 104: a nurse home visit and a coordination task for the nurse
insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,due_at,creator_id,owner_id)
select gen_random_uuid(),d.id,'contact-followup','Call about the results','Phone the member, check the results arrived and ask whether the medicine questions are answered.',now()+interval '1 day',w.doctor,w.nurse
from demo d,who w where d.n=104 and not exists(select 1 from public.patient_coordination_tasks x where x.patient_case_id=d.id);
insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,due_at,creator_id,owner_id)
select gen_random_uuid(),d.id,'evidence-collection','Collect blood pressure log','Ask the member to start the blood pressure week and check the first two days.',now()+interval '2 days',w.doctor,w.nurse
from demo d,who w where d.n=106 and not exists(select 1 from public.patient_coordination_tasks x where x.patient_case_id=d.id);

-- 105: plan published with a medicine
do $$
declare m uuid:=(select id from demo where n=105);p uuid:=gen_random_uuid();w record;
begin
 select * into w from who;
 if exists(select 1 from public.patient_care_plans where user_id=m)then return;end if;
 insert into public.patient_care_plans(id,user_id,clinician,published_at,instructions,active)
  values(p,m,'Staging Doctor',now()-interval '2 days','Take the medicine every evening, recheck LDL in 6 weeks, keep the blood pressure log.',true);
 insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft,published_at)
  values(m,p,gen_random_uuid(),w.doctor,0,'staging-demo','{}'::jsonb,'{}'::jsonb,'{"explanation":"Your LDL cholesterol is above the goal. A daily statin lowers it.","instructions":"Take the medicine every evening, recheck LDL in 6 weeks, keep the blood pressure log.","followUp":"Blood test in 6 weeks.","medicationName":"Atorvastatin","medicationDose":"20 mg","medicationInstructions":"One tablet in the evening with water.","medicationTimes":["20:00"]}'::jsonb,now()-interval '2 days');
 -- the publication insert creates the plan's version and regimen rows itself
end$$;

-- 106: blood pressure week, 3 days of morning and evening readings
do $$
declare m uuid:=(select id from demo where n=106);wk uuid:=gen_random_uuid();w record;d int;s text;i int;mid uuid;
begin
 select * into w from who;
 if exists(select 1 from public.bp_weeks where member_id=m)then return;end if;
 insert into public.bp_weeks(id,member_id,starts_on,days,readings_per_slot,morning_time,evening_time,reminders,started_by,started_by_role)
  values(wk,m,current_date-3,7,2,'07:30','20:00',false,w.nurse,'nurse');
 for d in 1..3 loop foreach s in array array['morning','evening'] loop for i in 1..2 loop
  insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at,source)
   values(m,gen_random_uuid(),142+d*2+i,88+d,70+i,(current_date-4+d)::timestamp+case when s='morning' then time '07:30' else time '20:00' end+(i*interval '3 minutes'),'manual')returning id into mid;
  insert into public.bp_week_readings(measurement_id,week_id,member_id,day,slot)values(mid,wk,m,d,s);
 end loop;end loop;end loop;
end$$;

-- Conversations: a few member messages for 102 to 106
do $$
declare r record;c uuid;k int;txt text[];
begin
 for r in select * from demo where n>=102 loop
  if exists(select 1 from public.conversations where member_id=r.id)then continue;end if;
  insert into public.conversations(member_id)values(r.id)returning id into c;
  txt:=case r.n when 102 then array['Hello, I have chest pain since this morning.','It gets worse when I climb the stairs.']
   when 103 then array['Hi, when should I come for the blood tests?','Do I need to fast?']
   when 104 then array['My results arrived. Is the LDL a problem?','Can the nurse call me tomorrow?']
   when 105 then array['Thank you for the plan. Can I take the medicine in the morning instead?']
   else array['I started the blood pressure week, the first readings are in.'] end;
  for k in 1..array_length(txt,1) loop
   insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id,to_doctor)
    values(c,k,r.id,txt[k],'authenticated_member',gen_random_uuid(),true);
  end loop;
  -- the next message takes seq version+1, so the counter must equal the stored messages
  update public.conversations set version=array_length(txt,1)where id=c;
 end loop;
end$$;
commit;
select d.n,(select count(*) from public.care_alerts a where a.member_id=d.id)alerts,(select count(*) from public.patient_care_results x where x.user_id=d.id)results,
 (select count(*) from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id=d.id)messages,
 (select count(*) from public.patient_measurements x where x.user_id=d.id)readings from demo d order by 1;
