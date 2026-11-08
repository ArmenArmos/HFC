-- Fictional checks for the LDL goal (phase 1); all fixtures roll back.
-- Off by default and inert while off; only the signed-in assigned active doctor reads and writes; tables are
-- closed to every browser role; the member sees nothing before the pathway, "being set" without numbers before
-- the goal, then the goal and only member-visible LDL values (never the therapy, the "maximally tolerated" flag,
-- doctor-only clinic readings or an upload still waiting for the doctor); goal versions are immutable and
-- need a reason after the first; a stale form is refused; replays return their outcome; events and therapies
-- are append-only.
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
-- 1d1: doctor 02, other doctor 03, members 04 (pathway), 05 (other doctor's), 06 (not in the pathway), nurse 07, admin 08; clinic 10.
insert into auth.users(id)select ('1d100000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid from generate_series(2,8)n;
insert into public.workspace_clinics(id,name)values('1d100000-0000-4000-8000-000000000010','Synthetic LDL clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('1d100000-0000-4000-8000-000000000002','doctor','Synthetic Doctor Two','1d100000-0000-4000-8000-000000000010'),
 ('1d100000-0000-4000-8000-000000000003','doctor','Synthetic Doctor Three','1d100000-0000-4000-8000-000000000010'),
 ('1d100000-0000-4000-8000-000000000007','nurse','Synthetic Nurse','1d100000-0000-4000-8000-000000000010'),
 ('1d100000-0000-4000-8000-000000000008','admin','Synthetic Admin','1d100000-0000-4000-8000-000000000010');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('1d100000-0000-4000-8000-000000000004','1d100000-0000-4000-8000-000000000002','1d100000-0000-4000-8000-000000000007'),
 ('1d100000-0000-4000-8000-000000000005','1d100000-0000-4000-8000-000000000003',null),
 ('1d100000-0000-4000-8000-000000000006','1d100000-0000-4000-8000-000000000002',null);
insert into auth.sessions(id,user_id,created_at,updated_at)select ('1d100000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid,('1d100000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,now()-interval '1 hour',now()
 from generate_series(2,8)n;
create function pg_temp.as_user(n int) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','1d100000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id','1d100000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::text,true)
$$;
create function pg_temp.m(n int) returns uuid language sql immutable as $$ select ('1d100000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid $$;
create function pg_temp.s(n int) returns uuid language sql immutable as $$ select ('1d100000-0000-4000-8000-0000000009'||lpad(n::text,2,'0'))::uuid $$;
create function pg_temp.event(member int,sub int,extra jsonb default '{}') returns text language sql as $$
 select public.doctor_ldl_event_add(jsonb_build_object('version','ldl-goal-v1','memberId',pg_temp.m(member),'submissionId',pg_temp.s(sub),
  'type','acs_mi','on','2026-09-01','source','document')||extra)->>'status'
$$;
create function pg_temp.therapy(member int,sub int,extra jsonb default '{}') returns text language sql as $$
 select public.doctor_ldl_therapy_add(jsonb_build_object('version','ldl-goal-v1','memberId',pg_temp.m(member),'submissionId',pg_temp.s(sub),
  'drug','atorvastatin','dose','80 mg once daily','startedOn','2026-09-03','maximallyTolerated',true)||extra)->>'status'
$$;
create function pg_temp.goal(member int,sub int,expected int,extra jsonb default '{}') returns text language sql as $$
 select public.doctor_ldl_goal_set(jsonb_build_object('version','ldl-goal-v1','memberId',pg_temp.m(member),'submissionId',pg_temp.s(sub),'expectedVersion',expected,
  'category','very_high','thresholdMmol',1.4,'reductionRule',true,'reductionPct',50,'baselineKind','pre_treatment','baselineMmol',3.8,'baselineOn','2026-08-20',
  'baselineSource','document','defaultsVersion','ldl-defaults-2026-10-29')||extra)->>'status'
$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.raises(text,text),pg_temp.as_user(int),pg_temp.m(int),pg_temp.s(int),
 pg_temp.event(int,int,jsonb),pg_temp.therapy(int,int,jsonb),pg_temp.goal(int,int,int,jsonb) to authenticated;

-- LDL values that already exist: typed by the member, an upload still waiting for the doctor (hidden from the member
-- while approval is required), a published clinic result, a VLDL result (not LDL), a future-dated result, and a
-- doctor-verified clinic reading not yet published (doctor only). Lab FKs are not the point here.
insert into public.member_reported_values(user_id,measure,value,unit,measured_on)values(pg_temp.m(4),'ldl_c',2.10,'mmol/L','2026-10-01');
set local session_replication_role=replica;
insert into public.member_reported_values(user_id,source,ai_value_id,measure,value,unit,measured_on)values(pg_temp.m(4),'ai_read',gen_random_uuid(),'ldl_c',1.20,'mmol/L','2026-10-05');
-- Two stored clinic files attached to member 04: 31 stays current, 32 is detached (Astra LDL-01: its reading must not count).
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state,created_at)
select ('1d100000-0000-4000-8000-0000000000'||n)::uuid,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),pg_temp.m(2),gen_random_uuid(),'[]',now(),gen_random_uuid(),1,gen_random_uuid(),
 'SYNTHETIC-LDL-'||n||'.pdf','application/pdf',1000,repeat('a',64),'synthetic-ldl/'||n,gen_random_uuid(),1000,repeat('a',64),'stored',now()-interval '1 hour'
from generate_series(31,32)n;
insert into public.clinic_result_attachments(id,file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id)
select ('1d100000-0000-4000-8000-0000000000'||(n+10))::uuid,('1d100000-0000-4000-8000-0000000000'||n)::uuid,'1d100000-0000-4000-8000-000000000010',pg_temp.m(4),gen_random_uuid(),'noreon-admin',pg_temp.m(2),gen_random_uuid()
from generate_series(31,32)n;
insert into public.clinic_result_detachments(attachment_id,actor_id,submission_id,reason)values('1d100000-0000-4000-8000-000000000042',pg_temp.m(2),gen_random_uuid(),'Synthetic: wrong member');
insert into public.lab_ai_values(job_id,user_id,file_id,attachment_id,seq,test_name,catalogue_ref,value_text,value,unit,collected_on,page,status,reviewed_by,reviewed_at)values
 (gen_random_uuid(),pg_temp.m(4),'1d100000-0000-4000-8000-000000000031','1d100000-0000-4000-8000-000000000041',1,'LDL-C','ldl_c','1.6',1.6,'mmol/L','2026-10-20',1,'verified',pg_temp.m(2),now()),
 (gen_random_uuid(),pg_temp.m(4),'1d100000-0000-4000-8000-000000000032','1d100000-0000-4000-8000-000000000042',1,'LDL-C','ldl_c','0.9',0.9,'mmol/L','2026-10-21',1,'verified',pg_temp.m(2),now());
set local session_replication_role=origin;
-- Published results (reviewed, on a published plan) reach the member; an unpublished one is the doctor's only.
insert into public.patient_care_plans(id,user_id,clinician,instructions)values('1d100000-0000-4000-8000-000000000050',pg_temp.m(4),'Synthetic Doctor Two','Synthetic plan');
insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,publication_plan_id)values
 (pg_temp.m(4),'Холестерин ЛПНП',1.9,'mmol/L','2026-10-10T09:00:00+04','2026-10-11T09:00:00+04','laboratory','Synthetic lab',now(),'Synthetic Doctor Two','1d100000-0000-4000-8000-000000000050'),
 (pg_temp.m(4),'VLDL cholesterol',0.5,'mmol/L','2026-10-10T09:00:00+04','2026-10-11T09:00:00+04','laboratory','Synthetic lab',now(),'Synthetic Doctor Two','1d100000-0000-4000-8000-000000000050'),
 (pg_temp.m(4),'LDL-C',1.0,'mmol/L',now()+interval '2 days',now(),'laboratory','Synthetic lab',now(),'Synthetic Doctor Two','1d100000-0000-4000-8000-000000000050'),
 (pg_temp.m(4),'LDL cholesterol',1.7,'mmol/L','2026-10-15T09:00:00+04','2026-10-16T09:00:00+04','laboratory','Synthetic lab',null,null,null);

-- 1. Off by default: reads say off, writes are refused, nothing is stored.
select pg_temp.ok((select ldl_goal_enabled from public.ldl_goal_settings)=false,'off by default');
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(public.doctor_ldl_read(pg_temp.m(4))->>'enabled'='false','doctor read says off');
select pg_temp.ok(pg_temp.event(4,1)='disabled','event refused while off');
select pg_temp.ok(pg_temp.therapy(4,2)='disabled','therapy refused while off');
select pg_temp.ok(pg_temp.goal(4,3,0)='disabled','goal refused while off');
reset role;
select pg_temp.ok(not exists(select 1 from public.ldl_index_events)and not exists(select 1 from public.ldl_goals),'nothing stored while off');
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(public.member_ldl_read()->>'enabled'='false','member read says off');
reset role;
update public.ldl_goal_settings set ldl_goal_enabled=true where singleton;
select pg_temp.ok(exists(select 1 from public.config_audit where table_name='ldl_goal_settings'),'switch change is in config_audit');

-- 2. Access: tables closed; another doctor, the nurse, the admin and members are refused.
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(pg_temp.raises('select * from public.ldl_goals'),'member cannot read goals table');
select pg_temp.ok(pg_temp.raises('select * from public.ldl_lipid_therapies'),'member cannot read therapy table');
select pg_temp.ok(pg_temp.raises('select * from public.ldl_index_events'),'member cannot read events table');
select pg_temp.ok(pg_temp.raises('select * from public.ldl_goal_settings'),'member cannot read settings table');
select pg_temp.ok(pg_temp.raises($q$select public._ldl_observations(pg_temp.m(4),true)$q$),'member cannot call the doctor observation read');
select pg_temp.ok(pg_temp.raises($q$select public.doctor_ldl_read(pg_temp.m(4))$q$),'member cannot use the doctor read');
select pg_temp.ok(pg_temp.raises($q$select pg_temp.goal(4,4,0)$q$),'member cannot set their own goal');
reset role;
select pg_temp.as_user(3);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select public.doctor_ldl_read(pg_temp.m(4))$q$),'other doctor cannot read');
select pg_temp.ok(pg_temp.raises($q$select pg_temp.event(4,5)$q$),'other doctor cannot record');
reset role;
select pg_temp.as_user(7);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select public.doctor_ldl_read(pg_temp.m(4))$q$),'assigned nurse cannot read');
select pg_temp.ok(pg_temp.raises($q$select pg_temp.therapy(4,6)$q$),'assigned nurse cannot record');
reset role;
select pg_temp.as_user(8);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select public.doctor_ldl_read(pg_temp.m(4))$q$),'admin cannot read');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.raises($q$select public.member_ldl_read()$q$),'anon refused');
reset role;
-- The doctor without an admitted session (no session row) is refused.
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.m(2),'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),
 'session_id','1d100000-0000-4000-8000-00000000ffff')::text,true);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select public.doctor_ldl_read(pg_temp.m(4))$q$),'doctor without an admitted session refused');
reset role;

-- 3. Member before the pathway: nothing.
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(public.member_ldl_read()=jsonb_build_object('version','ldl-member-v1','enabled',true,'inPathway',false),'not in the pathway yet');
reset role;

-- 4. Doctor records the event and therapy; validation; replay.
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(pg_temp.event(4,10)='saved','event saved');
select pg_temp.ok(pg_temp.event(4,10)='replayed','event replay');
select pg_temp.ok(pg_temp.event(6,10)='stale','same submission for another member is stale');
select pg_temp.ok(pg_temp.event(4,11,'{"type":"other"}')='invalid','other needs a description');
select pg_temp.ok(pg_temp.event(4,12,'{"type":"heart"}')='invalid','unknown event type');
select pg_temp.ok(pg_temp.event(4,13,jsonb_build_object('on',to_char(now()+interval '3 days','YYYY-MM-DD')))='invalid','future event date');
select pg_temp.ok(pg_temp.event(4,14,'{"on":"2026-02-30"}')='invalid','impossible date');
select pg_temp.ok(pg_temp.event(4,15,'{"extra":1}')='invalid','unknown key');
select pg_temp.ok(pg_temp.event(4,16,'{"type":"ischaemic_stroke","on":null,"source":"doctor_entered","note":"Date not known"}')='saved','event with unknown date');
select pg_temp.ok(pg_temp.therapy(4,20)='saved','therapy saved');
select pg_temp.ok(pg_temp.therapy(4,21,'{"dose":"  "}')='invalid','dose required');
select pg_temp.ok(pg_temp.therapy(4,22,'{"drug":"other"}')='invalid','other drug needs a name');
select pg_temp.ok(pg_temp.therapy(4,23,'{"maximallyTolerated":"yes"}')='invalid','flag must be boolean');
select pg_temp.ok(pg_temp.therapy(4,24,'{"drug":"ezetimibe","dose":"10 mg daily","startedOn":null,"maximallyTolerated":false}')='saved','second therapy, start unknown');
reset role;

-- 5. Member in the pathway, no goal: "being set", with no goal and no values.
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(public.member_ldl_read()->>'inPathway'='true' and public.member_ldl_read()->'goal'='null'::jsonb
 and public.member_ldl_read()->'observations'='[]'::jsonb,'pathway, goal not set, no numbers');
select pg_temp.ok(public.member_ldl_read()::text !~ 'atorvastatin|maximally|acs_mi|80 mg','member read carries no event or therapy');
reset role;

-- 6. Goal: first version; validation; stale form; reason after the first; replay.
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(pg_temp.goal(4,30,1)='stale','expected version must match');
select pg_temp.ok(pg_temp.goal(4,31,0,'{"thresholdMmol":1.45}')='invalid','threshold with two decimals refused, not rounded');
select pg_temp.ok(pg_temp.goal(4,32,0,'{"reductionRule":true,"reductionPct":null}')='invalid','reduction rule needs its percentage');
select pg_temp.ok(pg_temp.goal(4,33,0,'{"baselineKind":"unknown"}')='invalid','unknown baseline cannot carry a value');
select pg_temp.ok(pg_temp.goal(4,34,0,'{"baselineMmol":null}')='invalid','documented baseline needs a value');
select pg_temp.ok(pg_temp.goal(4,35,0,'{"category":"extreme"}')='invalid','unknown category');
select pg_temp.ok(pg_temp.goal(4,36,0,jsonb_build_object('nextTestOn',to_char(now()-interval '3 days','YYYY-MM-DD')))='invalid','next test in the past');
select pg_temp.ok(pg_temp.goal(4,37,0,'{"thresholdMmol":"1.4"}')='invalid','threshold must be a number');
select pg_temp.ok(pg_temp.goal(4,38,0,jsonb_build_object('nextTestOn',to_char(now()+interval '40 days','YYYY-MM-DD')))='saved','goal v1 saved without a reason');
select pg_temp.ok(pg_temp.goal(4,38,0)='replayed','goal replay');
select pg_temp.ok(pg_temp.goal(4,39,1)='invalid','v2 needs a reason');
select pg_temp.ok(pg_temp.goal(4,40,1,'{"reason":"Discharge letter shows the earlier value was on treatment","baselineKind":"on_treatment","thresholdMmol":1.8,"category":"high"}')='saved','goal v2 with a reason');
select pg_temp.ok(pg_temp.goal(4,41,1,'{"reason":"x"}')='stale','a form built on v1 is stale after v2');
reset role;
select pg_temp.ok((select count(*) from public.ldl_goals where member_id=pg_temp.m(4))=2 and(select max(version)from public.ldl_goals where member_id=pg_temp.m(4))=2,'two versions');
select pg_temp.ok(pg_temp.raises($q$update public.ldl_goals set threshold_mmol=1.4$q$,'55000'),'goals immutable');
select pg_temp.ok(pg_temp.raises($q$delete from public.ldl_goals$q$,'55000'),'goals not deletable');

-- 7. Member with a goal: the latest version, only member-visible LDL values, nothing doctor-only.
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok((public.member_ldl_read()->'goal'->>'version')::int=2 and(public.member_ldl_read()->'goal'->>'thresholdMmol')::numeric=1.8,'member sees the latest version');
select pg_temp.ok(not(public.member_ldl_read()->'goal' ?| array['reason','defaultsVersion','byYou']),'member never sees the reason or audit fields');
select pg_temp.ok((select array_agg(o->>'id' order by o->>'on')from jsonb_array_elements(public.member_ldl_read()->'observations')o)
 =array['mr:'||(select id from public.member_reported_values where user_id=pg_temp.m(4) and source='member-reported')::text,
        'cr:'||(select id from public.patient_care_results where user_id=pg_temp.m(4) and marker='Холестерин ЛПНП')::text],
 'member values: typed and published LDL only (no waiting upload, no VLDL, no future, no unpublished result or clinic reading)');
select pg_temp.ok(public.member_ldl_read()::text !~ 'atorvastatin|maximally|acs_mi|clinic_reviewed','member read carries no therapy, event or doctor-only value');
reset role;
select pg_temp.as_user(6);
set local role authenticated;
select pg_temp.ok(public.member_ldl_read()->>'inPathway'='false','another member sees nothing of member 04');
reset role;

-- 8. Doctor read: events, therapies with the flag, versions newest first, and the doctor-only reading; the read is audited.
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.doctor_ldl_read(pg_temp.m(4))->'events')=2,'two events');
select pg_temp.ok((public.doctor_ldl_read(pg_temp.m(4))->'therapies'->0->>'maximallyTolerated')is not null,'doctor sees the flag');
select pg_temp.ok((public.doctor_ldl_read(pg_temp.m(4))->'goals'->0->>'version')::int=2 and(public.doctor_ldl_read(pg_temp.m(4))->'goals'->0->>'byYou')::boolean,'newest version first, by you');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.doctor_ldl_read(pg_temp.m(4))->'observations')o where o->>'source'='clinic_reviewed' and o->>'memberVisible'='false'),'doctor sees the verified clinic reading, marked not visible to the member');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.doctor_ldl_read(pg_temp.m(4))->'observations')o where o->>'source'='clinic_result' and (o->>'value')::numeric=1.7 and o->>'memberVisible'='false'),'doctor sees the unpublished result, marked not visible to the member');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.doctor_ldl_read(pg_temp.m(4))->'observations')o where (o->>'value')::numeric in(1.2,0.5,1.0,0.9)),'doctor read also excludes the waiting upload, VLDL, future results and the detached clinic reading');
reset role;
select pg_temp.ok(exists(select 1 from public.access_audit where member_id=pg_temp.m(4) and surface='ldl_goal' and actor_id=pg_temp.m(2)),'doctor read recorded');

-- 9. Ending and removing: once, by the assigned doctor; entered in error disappears; append-only otherwise.
create temp table ids as select submission_id,id from public.ldl_lipid_therapies union all select submission_id,id from public.ldl_index_events;
grant select on ids to authenticated;
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(public.doctor_ldl_therapy_end(pg_temp.m(4),(select id from ids where submission_id=pg_temp.s(24)),'entered_in_error',null)->>'status'='saved','therapy entered in error');
select pg_temp.ok(public.doctor_ldl_therapy_end(pg_temp.m(4),(select id from ids where submission_id=pg_temp.s(24)),'stopped',null)->>'status'='not-found','ended only once');
select pg_temp.ok(public.doctor_ldl_therapy_end(pg_temp.m(4),(select id from ids where submission_id=pg_temp.s(20)),'stopped','2026-09-01')->>'status'='invalid','stopped before it started');
select pg_temp.ok(public.doctor_ldl_therapy_end(pg_temp.m(4),(select id from ids where submission_id=pg_temp.s(20)),'paused',null)->>'status'='invalid','unknown end reason');
select pg_temp.ok(jsonb_array_length(public.doctor_ldl_read(pg_temp.m(4))->'therapies')=1,'entered-in-error therapy hidden');
select pg_temp.ok(public.doctor_ldl_event_remove(pg_temp.m(4),(select id from ids where submission_id=pg_temp.s(16)))->>'status'='saved','event removed');
select pg_temp.ok(pg_temp.raises($q$select public.doctor_ldl_event_remove(pg_temp.m(5),gen_random_uuid())$q$),'cannot remove on another doctor''s member');
select pg_temp.ok(public.doctor_ldl_event_remove(pg_temp.m(6),(select id from ids where submission_id=pg_temp.s(10)))->>'status'='not-found','an event id of another member is not found');
reset role;
select pg_temp.ok(pg_temp.raises($q$delete from public.ldl_index_events$q$,'55000'),'events not deletable');
select pg_temp.ok(pg_temp.raises($q$update public.ldl_index_events set event_type='tia'$q$,'55000'),'events not editable');
select pg_temp.ok(pg_temp.raises($q$update public.ldl_lipid_therapies set maximally_tolerated=false$q$,'55000'),'therapies not editable');
select pg_temp.ok(pg_temp.raises($q$update public.ldl_lipid_therapies set ended_at=null,ended_by=null,end_reason=null$q$,'55000'),'an end is not undone');

-- 10. Switched off again: the member sees nothing, the doctor read says off.
update public.ldl_goal_settings set ldl_goal_enabled=false where singleton;
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(public.member_ldl_read()->>'enabled'='false','member sees nothing once off');
reset role;
rollback;
