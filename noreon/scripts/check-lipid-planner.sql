-- Fictional checks for the lipid follow-up planner read; all fixtures roll back.
-- Off by default and inert while off, and while the LDL goal switch is off; only the assigned doctor reads, in an admitted
-- session; a read returns reviewed values only, never another member's, and adds nothing except its access record.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean,label text) returns void language plpgsql as $$begin
 if cond is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.raises(statement text,code text default '42501') returns boolean language plpgsql as $$begin
 execute statement;return false;
exception when others then
 if sqlstate=code then return true;end if;
 raise notice 'unexpected % %',sqlstate,sqlerrm;return false;
end$$;
-- 1d7: doctor 02, other doctor 03, members 04 (doctor 02's), 06 (other doctor's), nurse 07, admin 08; clinic 10.
insert into auth.users(id)select ('1d700000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid from generate_series(2,8)n;
insert into public.workspace_clinics(id,name)values('1d700000-0000-4000-8000-000000000010','Synthetic lipid planner clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('1d700000-0000-4000-8000-000000000002','doctor','Synthetic Doctor Two','1d700000-0000-4000-8000-000000000010'),
 ('1d700000-0000-4000-8000-000000000003','doctor','Synthetic Doctor Three','1d700000-0000-4000-8000-000000000010'),
 ('1d700000-0000-4000-8000-000000000007','nurse','Synthetic Nurse','1d700000-0000-4000-8000-000000000010'),
 ('1d700000-0000-4000-8000-000000000008','admin','Synthetic Admin','1d700000-0000-4000-8000-000000000010');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('1d700000-0000-4000-8000-000000000004','1d700000-0000-4000-8000-000000000002','1d700000-0000-4000-8000-000000000007'),
 ('1d700000-0000-4000-8000-000000000006','1d700000-0000-4000-8000-000000000003',null);
insert into auth.sessions(id,user_id,created_at,updated_at)select ('1d700000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid,('1d700000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,now(),now()
 from generate_series(2,8)n;
create function pg_temp.as_user(n int) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','1d700000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id','1d700000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::text,true)
$$;
create function pg_temp.m(n int) returns uuid language sql immutable as $$ select ('1d700000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid $$;
create function pg_temp.result(member int,marker text,val double precision,unit text,reviewed boolean) returns void language sql as $$
 insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by)
 values(pg_temp.m(member),marker,val,unit,now()-interval '3 days',now()-interval '2 days','laboratory','Synthetic lab',case when reviewed then now()end,case when reviewed then 'Synthetic Doctor Two'end)
$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.raises(text,text),pg_temp.as_user(int),pg_temp.m(int) to authenticated;

-- 1. Grants and defaults.
select pg_temp.ok((select lipid_planner_enabled from public.ldl_goal_settings)=false,'off by default');
select pg_temp.ok(not has_function_privilege('anon','public.doctor_lipid_planner_read(uuid)','execute'),'anon cannot call the read');
select pg_temp.ok(not has_function_privilege('service_role','public.doctor_lipid_planner_read(uuid)','execute'),'the service role cannot call the read');
select pg_temp.ok(has_function_privilege('authenticated','public.doctor_lipid_planner_read(uuid)','execute'),'the read is for signed-in staff');
select pg_temp.ok(not has_function_privilege(r,f,'execute'),format('%s closed to %s',f,r))
 from unnest(array['anon','authenticated','service_role'])r,unnest(array['public._lipid_planner_enabled()','public._lipid_reviewed_labs(uuid)'])f;

-- 2. Off: the doctor reads "off", with nothing else and no access record, whichever switch is off.
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(public.doctor_lipid_planner_read(pg_temp.m(4))='{"version":"lipid-planner-v1","enabled":false}'::jsonb,'off: both switches off');
reset role;
update public.ldl_goal_settings set ldl_goal_enabled=true where singleton;
set local role authenticated;
select pg_temp.ok(public.doctor_lipid_planner_read(pg_temp.m(4))->>'enabled'='false','off: planner switch off');
reset role;
update public.ldl_goal_settings set ldl_goal_enabled=false,lipid_planner_enabled=true where singleton;
set local role authenticated;
select pg_temp.ok(public.doctor_lipid_planner_read(pg_temp.m(4))->>'enabled'='false','off: the LDL goal switch is required too');
reset role;
select pg_temp.ok(not exists(select 1 from public.access_audit where member_id=pg_temp.m(4)),'no access record while off');

-- Roles are refused while off as well.
select pg_temp.as_user(3);
set local role authenticated;
select pg_temp.ok(pg_temp.raises(format('select public.doctor_lipid_planner_read(%L)',pg_temp.m(4))),'off: another doctor is refused');
reset role;

-- 3. On. Fixtures: reviewed and unreviewed results, another member's, open and handled reports.
update public.ldl_goal_settings set ldl_goal_enabled=true,lipid_planner_enabled=true where singleton;
select pg_temp.result(4,'LDL-C',2.1,'mmol/L',true),pg_temp.result(4,'LDL cholesterol',0.9,'mmol/L',false),
 pg_temp.result(4,'ALT',31,'U/L',true),pg_temp.result(4,'ALT repeat',900,'U/L',false),
 pg_temp.result(4,'CK',120,'U/L',true),pg_temp.result(4,'CK-MB',4,'U/L',true),pg_temp.result(4,'Креатинкиназа',110,'U/L',true),
 pg_temp.result(4,'Lp(a)',40,'nmol/L',true),pg_temp.result(4,'Total protein',70,'g/L',true),pg_temp.result(4,'Check-up note',1,'x',true),
 pg_temp.result(6,'CK',999,'U/L',true);
insert into public.member_medicines(id,user_id,name,dose,times,started_on)values
 ('1d700000-0000-4000-8000-000000000020',pg_temp.m(4),'Atorvastatin','40 mg',array['21:00'::time],current_date-30),
 ('1d700000-0000-4000-8000-000000000021',pg_temp.m(6),'Rosuvastatin','20 mg',array['21:00'::time],current_date-30);
insert into public.member_medicine_asks(id,user_id,source,medicine_id,due_at,trigger,state,reason,expires_at,answered_at)values
 ('1d700000-0000-4000-8000-000000000030',pg_temp.m(4),'self','1d700000-0000-4000-8000-000000000020',now()-interval '1 day','skipped','answered','side_effect',now()+interval '1 day',now()),
 ('1d700000-0000-4000-8000-000000000031',pg_temp.m(4),'self','1d700000-0000-4000-8000-000000000020',now()-interval '2 days','skipped','answered','side_effect',now()+interval '1 day',now()),
 ('1d700000-0000-4000-8000-000000000032',pg_temp.m(4),'self','1d700000-0000-4000-8000-000000000020',now()-interval '3 days','skipped','answered','ran_out',now()+interval '1 day',now()),
 ('1d700000-0000-4000-8000-000000000033',pg_temp.m(6),'self','1d700000-0000-4000-8000-000000000021',now()-interval '1 day','skipped','answered','side_effect',now()+interval '1 day',now());
insert into public.member_medicine_concerns(user_id,ask_id,kind,state,handled_at,handled_by)values
 (pg_temp.m(4),'1d700000-0000-4000-8000-000000000030','side_effect','open',null,null),
 (pg_temp.m(4),'1d700000-0000-4000-8000-000000000031','side_effect','handled',now(),pg_temp.m(2)),
 (pg_temp.m(4),'1d700000-0000-4000-8000-000000000032','refill','open',null,null),
 (pg_temp.m(6),'1d700000-0000-4000-8000-000000000033','side_effect','open',null,null);

-- Only the assigned doctor: not the member, the nurse, an admin or another doctor.
do $$ begin
 perform pg_temp.as_user(4);
 set local role authenticated;
 perform pg_temp.ok(pg_temp.raises(format('select public.doctor_lipid_planner_read(%L)',pg_temp.m(4))),'the member is refused');
 reset role;
 perform pg_temp.as_user(7);
 set local role authenticated;
 perform pg_temp.ok(pg_temp.raises(format('select public.doctor_lipid_planner_read(%L)',pg_temp.m(4))),'the assigned nurse is refused');
 reset role;
 perform pg_temp.as_user(8);
 set local role authenticated;
 perform pg_temp.ok(pg_temp.raises(format('select public.doctor_lipid_planner_read(%L)',pg_temp.m(4))),'an admin is refused');
 reset role;
 perform pg_temp.as_user(3);
 set local role authenticated;
 perform pg_temp.ok(pg_temp.raises(format('select public.doctor_lipid_planner_read(%L)',pg_temp.m(4))),'another doctor is refused');
 reset role;
 perform pg_temp.as_user(2);
 set local role authenticated;
 perform pg_temp.ok(pg_temp.raises(format('select public.doctor_lipid_planner_read(%L)',pg_temp.m(6))),'the doctor cannot read another doctor''s member');
 reset role;
end $$;

-- 4. The assigned doctor.
create temp table before_read as select
 (select count(*) from public.ldl_goals)goals,(select count(*) from public.ldl_retests)retests,(select count(*) from public.ldl_responses)responses,
 (select count(*) from public.patient_test_requests)requests,(select count(*) from public.member_medicine_concerns where state='open')concerns,
 (select count(*) from public.access_audit where member_id=pg_temp.m(4))audits;
grant select on before_read to authenticated;
select pg_temp.as_user(2);
set local role authenticated;
create temp table r on commit drop as select public.doctor_lipid_planner_read(pg_temp.m(4))j;
reset role;
select pg_temp.ok((select j->>'enabled' from r)='true','the doctor reads the plan inputs');
select pg_temp.ok((select j->>'today' from r)=((clock_timestamp()at time zone 'Asia/Yerevan')::date)::text,'today is Yerevan');
select pg_temp.ok((select j#>>'{record,enabled}' from r)='true','the LDL record comes with it');
select pg_temp.ok((select jsonb_array_length(j->'reviewedLdl')from r)=1 and (select j#>>'{reviewedLdl,0,value}' from r)='2.1','only the reviewed LDL value');
select pg_temp.ok((select jsonb_array_length(j#>'{record,observations}')from r)=2,'the unreviewed value exists in the record, which the planner does not use');
select pg_temp.ok((select jsonb_agg(o->>'value' order by (o->>'value')::numeric) from r,jsonb_array_elements(r.j->'reviewedLabs')o where o->>'test'='alt')='["31"]'::jsonb,'only the reviewed ALT');
select pg_temp.ok((select count(*) from r,jsonb_array_elements(r.j->'reviewedLabs')o where o->>'test'='ck')=3,'CK and its Russian name; CK-MB reaches the code, which drops it');
select pg_temp.ok((select count(*) from r,jsonb_array_elements(r.j->'reviewedLabs')o where o->>'test'='lpa')=1,'Lp(a)');
select pg_temp.ok((select count(*) from r,jsonb_array_elements(r.j->'reviewedLabs')o where o->>'name' in('Total protein','Check-up note'))=0,'other tests are not read');
select pg_temp.ok((select count(*) from r,jsonb_array_elements(r.j->'reviewedLabs')o where o->>'value'='999')=0,'no other member''s result');
select pg_temp.ok((select j->'concerns' from r)=jsonb_build_array(jsonb_build_object('kind','side_effect','on',(now()at time zone 'Asia/Yerevan')::date,'medicine','Atorvastatin')),'only this member''s open side-effect report');
select pg_temp.ok((select jsonb_array_length(j#>'{medicines,self}')from r)=1,'this member''s medicines only');
select pg_temp.ok((select audits+2 from before_read)=(select count(*) from public.access_audit where member_id=pg_temp.m(4)),'the read is recorded: its own row and the LDL record''s');
select pg_temp.ok(exists(select 1 from public.access_audit where member_id=pg_temp.m(4) and surface='ldl_goal' and object_id='lipid_planner' and actor_id=pg_temp.m(2)),'recorded as the planner');
select pg_temp.ok((select (goals,retests,responses,requests,concerns) from before_read)=(
 (select count(*) from public.ldl_goals),(select count(*) from public.ldl_retests),(select count(*) from public.ldl_responses),
 (select count(*) from public.patient_test_requests),(select count(*) from public.member_medicine_concerns where state='open')),'a read changes nothing else');

-- 5. Doctor-reviewed read values, on a current attachment only (the attachment chain is stubbed: only this predicate is under test).
set local session_replication_role=replica;
insert into public.lab_ai_values(id,job_id,user_id,file_id,attachment_id,seq,test_name,catalogue_ref,value_text,value,unit,page,status,reviewed_by,reviewed_at,collected_on,corrected_value)values
 ('1d700000-0000-4000-8000-000000000040',gen_random_uuid(),pg_temp.m(4),gen_random_uuid(),'1d700000-0000-4000-8000-000000000050',1,'Creatine kinase',null,'130',130,'U/L',1,'verified',pg_temp.m(2),now(),current_date-1,null),
 ('1d700000-0000-4000-8000-000000000041',gen_random_uuid(),pg_temp.m(4),gen_random_uuid(),'1d700000-0000-4000-8000-000000000050',2,'Lp(a)','lpa','40',40,'nmol/L',1,'corrected',pg_temp.m(2),now(),current_date-1,41),
 ('1d700000-0000-4000-8000-000000000042',gen_random_uuid(),pg_temp.m(4),gen_random_uuid(),'1d700000-0000-4000-8000-000000000050',3,'CK',null,'140',140,'U/L',1,'unverified',null,null,current_date-1,null);
set local session_replication_role=origin;
select pg_temp.ok((select count(*) from jsonb_array_elements(public._lipid_reviewed_labs(pg_temp.m(4)))o where o->>'id' like 'la:%')=0,'a value on an attachment that is not current is not read');
create or replace function public._lab_ai_current(p_attachment uuid)returns boolean language sql stable as $$ select true $$;
select pg_temp.ok((select count(*) from jsonb_array_elements(public._lipid_reviewed_labs(pg_temp.m(4)))o where o->>'id' like 'la:%' and o->>'test'='ck')=1,'a verified CK read value, by name; an unverified one is not');
select pg_temp.ok((select count(*) from jsonb_array_elements(public._lipid_reviewed_labs(pg_temp.m(4)))o where o->>'id' like 'la:%' and o->>'test'='lpa')=1,'a corrected Lp(a) read value');
rollback;
\echo lipid planner SQL checks passed
