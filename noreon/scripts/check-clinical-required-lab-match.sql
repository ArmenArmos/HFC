-- QA 174: a required laboratory result received from a doctor-confirmed clinic lab result. Fictional fixtures, rolled back.
-- Receipt refusals (unchecked, auto-accepted, rejected, other attachment, detached, other doctor), stale receipts at
-- publication (later correction, detach), the copy into patient_care_results under the new plan, the member seeing it
-- only after publication, and the doctor-only source list.
\set ON_ERROR_STOP on
begin;
set local time zone 'UTC';
create function pg_temp.password_actor(p_id uuid) returns text language plpgsql as $password$begin
 perform set_config('request.jwt.claim.sub',p_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','session_id',p_id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 return p_id::text;end$password$;
create function pg_temp.must_fail(command text,expected text) returns void language plpgsql as $$begin begin execute command;exception when others then if sqlerrm like '%'||expected||'%' then return;end if;raise;end;raise exception 'TEST command unexpectedly passed: %',command;end$$;
create function pg_temp.ok(cond boolean,label text) returns void language plpgsql as $$begin if cond is distinct from true then raise exception 'TEST %',label;end if;end$$;

-- Exact printed labels from a six-value report. LDL must count, but remains required.
do $printed_labels$
declare vals jsonb:='[
 {"name":"Total cholesterol","value":6.1,"unit":"mmol/L","collectedOn":"2026-11-05"},
 {"name":"HDL cholesterol","value":1.3,"unit":"mmol/L","collectedOn":"2026-11-05"},
 {"name":"LDL cholesterol (LDL-C)","value":4.2,"unit":"mmol/L","collectedOn":"2026-11-05"},
 {"name":"Triglycerides","value":1.4,"unit":"mmol/L","collectedOn":"2026-11-05"},
 {"name":"Fasting glucose","value":5.2,"unit":"mmol/L","collectedOn":"2026-11-05"},
 {"name":"HbA1c","value":5.4,"unit":"%","collectedOn":"2026-11-05"}
]'::jsonb;without_ldl jsonb;
begin
 perform pg_temp.ok(public._required_lab_test_covered('lipid-panel',vals),'the six printed labels cover the lipid panel');
 perform pg_temp.ok(public._required_lab_test_covered('hba1c-glucose',vals),'the printed glucose and HbA1c cover the paired test');
 select jsonb_agg(v)into without_ldl from jsonb_array_elements(vals)v where v->>'name'<>'LDL cholesterol (LDL-C)';
 perform pg_temp.ok(not public._required_lab_test_covered('lipid-panel',without_ldl),'removing printed LDL leaves the lipid panel incomplete');
 perform pg_temp.ok(not public._required_lab_test_covered('lipid-panel',without_ldl||'[{"name":"LDL cholesterol (LDL-C) urine"}]'::jsonb),'urine LDL cannot complete the lipid panel');
 perform pg_temp.ok(not public._required_lab_test_covered('tsh','[{"name":"TSH receptor antibodies"}]'::jsonb),'TSH receptor antibodies remain a different identity');
end$printed_labels$;

-- c1ab: member 01, doctor 04, other doctor 05, clinic 10.
insert into auth.users(id,phone,phone_confirmed_at) values
('c1ac0000-0000-4000-8000-000000000001','37499000902',now()),('c1ac0000-0000-4000-8000-000000000004',null,null),('c1ac0000-0000-4000-8000-000000000005',null,null);
update public.profiles set display_name='Clinic lab fixture',birth_date='1980-01-01',biological_sex='female' where id::text like 'c1ac0000%';
insert into public.patient_consents(user_id,version) values('c1ac0000-0000-4000-8000-000000000001','patient-pilot-v1');
insert into public.patient_assessments(user_id,revision,completed_at) values('c1ac0000-0000-4000-8000-000000000001',2,now());
insert into public.workspace_clinics(id,name) values('c1ac0000-0000-4000-8000-000000000010','Synthetic clinic lab');
insert into public.workspace_staff(user_id,role,display_name,clinic_id) values
('c1ac0000-0000-4000-8000-000000000004','doctor','Assigned doctor','c1ac0000-0000-4000-8000-000000000010'),('c1ac0000-0000-4000-8000-000000000005','doctor','Other doctor','c1ac0000-0000-4000-8000-000000000010');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id) values('c1ac0000-0000-4000-8000-000000000001','c1ac0000-0000-4000-8000-000000000004');
insert into auth.sessions(id,user_id,created_at,updated_at) select user_id,user_id,clock_timestamp(),clock_timestamp() from public.workspace_staff where user_id::text like 'c1ac0000%';

-- Two stored clinic files (21, 22) attached to the member; 22 is detached later. Values are written as a doctor's
-- review leaves them (verified, corrected), plus an unchecked, an auto-accepted and a rejected one.
set local session_replication_role=replica;
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state,created_at)
select ('c1ac0000-0000-4000-8000-0000000000'||n)::uuid,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'c1ac0000-0000-4000-8000-000000000004',gen_random_uuid(),'[]',now(),gen_random_uuid(),1,gen_random_uuid(),
 'SYNTHETIC-LAB-'||n||'.pdf','application/pdf',1000,repeat('a',64),'synthetic-clinic-lab/'||n,gen_random_uuid(),1000,repeat('a',64),'stored',now()-interval '1 hour'
from generate_series(21,23)n;
insert into public.clinic_result_attachments(id,file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id)
select ('c1ac0000-0000-4000-8000-0000000000'||(n+10))::uuid,('c1ac0000-0000-4000-8000-0000000000'||n)::uuid,'c1ac0000-0000-4000-8000-000000000010','c1ac0000-0000-4000-8000-000000000001',gen_random_uuid(),'noreon-admin','c1ac0000-0000-4000-8000-000000000004',gen_random_uuid()
from generate_series(21,23)n;
insert into public.lab_ai_jobs(id,attachment_id,file_id,user_id,state,outcome,finished_at)
select ('c1ac0000-0000-4000-8000-0000000000'||(n+20))::uuid,('c1ac0000-0000-4000-8000-0000000000'||(n+10))::uuid,('c1ac0000-0000-4000-8000-0000000000'||n)::uuid,'c1ac0000-0000-4000-8000-000000000001','done','ok',now()
from generate_series(21,23)n;
-- Attachment 31 (file 21): 51 LDL verified, 52 total cholesterol corrected, 53 unchecked, 54 auto-accepted, 55 rejected, 56 qualitative verified.
-- Attachment 32 (file 22): 61 LDL verified.
insert into public.lab_ai_values(id,job_id,user_id,file_id,attachment_id,seq,test_name,catalogue_ref,value_text,value,unit,ref_text,collected_on,lab_name,page,status,corrected_value,corrected_unit,reviewed_by,reviewed_at,auto_accepted_at,auto_accept_rule) values
('c1ac0000-0000-4000-8000-000000000051','c1ac0000-0000-4000-8000-000000000041','c1ac0000-0000-4000-8000-000000000001','c1ac0000-0000-4000-8000-000000000021','c1ac0000-0000-4000-8000-000000000031',1,'LDL-C','ldl_c','3.4',3.4,'mmol/L','< 3.0','2026-10-28','SYNTHETIC Clinic Lab',1,'verified',null,null,'c1ac0000-0000-4000-8000-000000000004',now()-interval '20 minutes',null,null),
('c1ac0000-0000-4000-8000-000000000052','c1ac0000-0000-4000-8000-000000000041','c1ac0000-0000-4000-8000-000000000001','c1ac0000-0000-4000-8000-000000000021','c1ac0000-0000-4000-8000-000000000031',2,'Total cholesterol',null,'5.9',5.9,'mmol/L',null,'2026-10-28','SYNTHETIC Clinic Lab',1,'corrected',5.6,'mmol/L','c1ac0000-0000-4000-8000-000000000004',now()-interval '19 minutes',null,null),
('c1ac0000-0000-4000-8000-000000000053','c1ac0000-0000-4000-8000-000000000041','c1ac0000-0000-4000-8000-000000000001','c1ac0000-0000-4000-8000-000000000021','c1ac0000-0000-4000-8000-000000000031',3,'HDL-C',null,'1.1',1.1,'mmol/L',null,'2026-10-28','SYNTHETIC Clinic Lab',1,'unverified',null,null,null,null,null,null),
('c1ac0000-0000-4000-8000-000000000054','c1ac0000-0000-4000-8000-000000000041','c1ac0000-0000-4000-8000-000000000001','c1ac0000-0000-4000-8000-000000000021','c1ac0000-0000-4000-8000-000000000031',4,'Triglycerides',null,'1.2',1.2,'mmol/L',null,'2026-10-28','SYNTHETIC Clinic Lab',1,'auto_accepted',null,null,null,null,now(),'lab-auto-accept-v1'),
('c1ac0000-0000-4000-8000-000000000055','c1ac0000-0000-4000-8000-000000000041','c1ac0000-0000-4000-8000-000000000001','c1ac0000-0000-4000-8000-000000000021','c1ac0000-0000-4000-8000-000000000031',5,'Glucose',null,'9.9',9.9,'mmol/L',null,'2026-10-28','SYNTHETIC Clinic Lab',1,'rejected',null,null,'c1ac0000-0000-4000-8000-000000000004',now()-interval '18 minutes',null,null),
('c1ac0000-0000-4000-8000-000000000056','c1ac0000-0000-4000-8000-000000000041','c1ac0000-0000-4000-8000-000000000001','c1ac0000-0000-4000-8000-000000000021','c1ac0000-0000-4000-8000-000000000031',6,'Serum appearance',null,'clear',null,null,null,'2026-10-28','SYNTHETIC Clinic Lab',1,'verified',null,null,'c1ac0000-0000-4000-8000-000000000004',now()-interval '17 minutes',null,null),
('c1ac0000-0000-4000-8000-000000000061','c1ac0000-0000-4000-8000-000000000042','c1ac0000-0000-4000-8000-000000000001','c1ac0000-0000-4000-8000-000000000022','c1ac0000-0000-4000-8000-000000000032',1,'LDL-C','ldl_c','2.0',2.0,'mmol/L',null,'2026-10-20','SYNTHETIC Clinic Lab',1,'verified',null,null,'c1ac0000-0000-4000-8000-000000000004',now()-interval '30 minutes',null,null),
-- Attachment 33 (file 23): only a future-dated (71) and an undated (72) verified value, nothing receivable.
('c1ac0000-0000-4000-8000-000000000071','c1ac0000-0000-4000-8000-000000000043','c1ac0000-0000-4000-8000-000000000001','c1ac0000-0000-4000-8000-000000000023','c1ac0000-0000-4000-8000-000000000033',1,'LDL-C','ldl_c','2.2',2.2,'mmol/L',null,current_date+30,'SYNTHETIC Clinic Lab',1,'verified',null,null,'c1ac0000-0000-4000-8000-000000000004',now()-interval '30 minutes',null,null),
('c1ac0000-0000-4000-8000-000000000072','c1ac0000-0000-4000-8000-000000000043','c1ac0000-0000-4000-8000-000000000001','c1ac0000-0000-4000-8000-000000000023','c1ac0000-0000-4000-8000-000000000033',2,'HDL-C',null,'1.3',1.3,'mmol/L',null,null,'SYNTHETIC Clinic Lab',1,'verified',null,null,'c1ac0000-0000-4000-8000-000000000004',now()-interval '30 minutes',null,null);
set local session_replication_role=origin;
select pg_temp.ok(public._lab_ai_current('c1ac0000-0000-4000-8000-000000000031') and public._lab_ai_current('c1ac0000-0000-4000-8000-000000000032'),'fixture attachments are current');


update public.patient_assessments set completed_at=((clock_timestamp()at time zone 'Asia/Yerevan')::date-1)::timestamp at time zone 'Asia/Yerevan' where user_id='c1ac0000-0000-4000-8000-000000000001';
set local session_replication_role=replica;
-- Keep the corrected cholesterol row corrected: other statuses cannot retain correction fields.
update public.lab_ai_values set collected_on=(clock_timestamp()at time zone 'Asia/Yerevan')::date,status=case when status='corrected'then 'corrected'else 'verified'end,reviewed_by='c1ac0000-0000-4000-8000-000000000004',reviewed_at=now(),auto_accepted_at=null,auto_accept_rule=null
 where attachment_id='c1ac0000-0000-4000-8000-000000000031';
update public.lab_ai_values set test_name='HbA1c',catalogue_ref='hba1c',value_text='5.2',value=5.2,unit='%' where id='c1ac0000-0000-4000-8000-000000000056';
set local session_replication_role=origin;
create temp table ctx as select 'c1ac0000-0000-4000-8000-000000000001'::uuid uid,'c1ac0000-0000-4000-8000-000000000004'::uuid actor,
 public.patient_clinical_evidence('c1ac0000-0000-4000-8000-000000000001')->>'token' token,
 (select jsonb_build_object('version','test-engine','urgency','green','tests',jsonb_agg(jsonb_build_object('id',id,'title',id,'method','lab')order by n))from unnest(array['lipid-panel','tsh','apob','lpa','urine-acr','urinalysis','potassium','sodium','cbc-hb','hba1c','hba1c-glucose'])with ordinality t(id,n))engine,
 '{"explanation":"Synthetic clinician review","instructions":"Synthetic instructions","followUp":"","medicationName":"","medicationDose":"","medicationInstructions":"","medicationTimes":[]}'::jsonb draft,
 '["c1ac0000-0000-4000-8000-000000000051","c1ac0000-0000-4000-8000-000000000052","c1ac0000-0000-4000-8000-000000000053","c1ac0000-0000-4000-8000-000000000054"]'::jsonb lipids;
grant select on ctx to authenticated,service_role;
create function pg_temp.receive(test text,ids jsonb default null,op text default 'receive-clinic-result',checked boolean default true)returns text language sql security definer set search_path=''as $$
 select format('select public.command_patient_clinical_review(%L,%s,%L,%L,%L)',uid,(select revision from public.patient_clinical_cases where user_id=uid),token,op,
 jsonb_build_object('attachmentId','c1ac0000-0000-4000-8000-000000000031','valueIds',coalesce(ids,lipids),'testId',test,'sourceChecked',checked,'note','Checked synthetic file'))from ctx
$$;
select pg_temp.password_actor('c1ac0000-0000-4000-8000-000000000004');
set local role service_role;
select public.prepare_patient_clinical_review(uid,actor,0,token,engine)from ctx;
reset role;

-- The actual assigned-doctor RPC, not the helper alone, must refuse an unrelated file.
set local role authenticated;
select pg_temp.must_fail(pg_temp.receive(test),'The selected values do not cover this required test')from unnest(array['tsh','apob','lpa','urine-acr','urinalysis','potassium','sodium','cbc-hb'])test;
select pg_temp.must_fail(pg_temp.receive('lipid-panel',checked=>false),'Check the original source document');
select pg_temp.must_fail(pg_temp.receive('lipid-panel','["c1ac0000-0000-4000-8000-000000000051"]'),'The selected values do not cover this required test');
select pg_temp.ok(public.command_patient_clinical_review(uid,1,token,'receive-clinic-result',jsonb_build_object('attachmentId','c1ac0000-0000-4000-8000-000000000031','valueIds',lipids,'testId','lipid-panel','sourceChecked',true,'note','Checked synthetic file'))=2,'complete lipid profile records')from ctx;
reset role;

-- Row membership is not panel completeness. Run the actual single/bulk RPCs
-- and publication on receipts that still exactly match their current sources.
-- Each case gets its own savepoint, so success cannot contaminate the next case.
create function pg_temp.panel_case(p_test text,p_names text[],p_complete boolean)returns void
language plpgsql as $$
declare x record;rev bigint;ids jsonb;vals jsonb;published uuid;
begin
 -- This invoker helper returns to the fixture owner before every direct write.
 -- Only the RPCs run as their production caller; triggers stay on for those calls.
 reset role;
 set local session_replication_role=replica;
 update public.lab_ai_values v set test_name=n.name
 from unnest(p_names)with ordinality n(name,i)
 where v.id=('c1ac0000-0000-4000-8000-'||lpad((50+n.i)::text,12,'0'))::uuid;
 set local session_replication_role=origin;
 update pg_temp.ctx set engine=jsonb_build_object('version','test-engine','urgency','green','tests',jsonb_build_array(jsonb_build_object('id',p_test,'title',p_test,'method','lab'))),
  token=public.patient_clinical_evidence(uid)->>'token';
 select * into x from pg_temp.ctx;
 select jsonb_agg('c1ac0000-0000-4000-8000-'||lpad((50+i)::text,12,'0')order by i)into ids from generate_series(1,cardinality(p_names))i;
 select revision into rev from public.patient_clinical_cases where user_id=x.uid;
 set local role service_role;
 rev:=public.prepare_patient_clinical_review(x.uid,x.actor,rev,x.token,x.engine);
 reset role;
 set local role authenticated;
 if p_complete then
  execute pg_temp.receive(p_test,ids);
  execute pg_temp.receive(null,ids,'receive-all-clinic-results');
  reset role;
  perform pg_temp.ok((select jsonb_array_length(review#>array['receipts',p_test,'values'])=cardinality(p_names)from public.patient_clinical_cases where user_id=x.uid),p_test||' complete receipt stores every component');
 else
  perform pg_temp.must_fail(pg_temp.receive(p_test,ids),'The selected values do not cover this required test');
  perform pg_temp.must_fail(pg_temp.receive(null,ids,'receive-all-clinic-results'),'The selected values do not cover this required test');
  reset role;
  perform pg_temp.ok((select revision=rev and review->'receipts'='{}'::jsonb from public.patient_clinical_cases where user_id=x.uid),p_test||' partial single/bulk leaves no receipt or revision');
  -- A mixed file can still record another complete test without claiming the
  -- partial panel. The fixture's independent HbA1c row is already confirmed.
  update pg_temp.ctx set engine=jsonb_set(x.engine,'{tests}',(x.engine->'tests')||'[{"id":"hba1c","title":"HbA1c","method":"lab"}]'::jsonb);
  set local role service_role;
  rev:=public.prepare_patient_clinical_review(x.uid,x.actor,rev,x.token,(select engine from pg_temp.ctx));
  reset role;
  set local role authenticated;
  execute pg_temp.receive(null,ids||'["c1ac0000-0000-4000-8000-000000000056"]'::jsonb,'receive-all-clinic-results');
  reset role;
  perform pg_temp.ok((select review->'receipts' ? 'hba1c' and not(review->'receipts' ? p_test) from public.patient_clinical_cases where user_id=x.uid),p_test||' bulk skips incomplete panel while recording complete HbA1c');
  select revision into rev from public.patient_clinical_cases where user_id=x.uid;
  update pg_temp.ctx set engine=x.engine;
  set local role service_role;
  rev:=public.prepare_patient_clinical_review(x.uid,x.actor,rev,x.token,x.engine);
  reset role;
 end if;
 -- Emulate a legacy receipt. There is no stale-value escape hatch here: the
 -- snapshot is rebuilt from the very same selected, current, confirmed rows.
 vals:=public._clinic_lab_receipt_values(x.uid,'c1ac0000-0000-4000-8000-000000000031',ids);
 perform pg_temp.ok(vals is not null,'legacy fixture uses current doctor-confirmed values');
 update public.patient_clinical_cases set review=jsonb_set(review,'{receipts}',jsonb_build_object(p_test,jsonb_build_object(
  'source','clinic-lab','attachmentId','c1ac0000-0000-4000-8000-000000000031','values',vals,'note','Synthetic legacy panel','actorId',x.actor,'at',now())))where user_id=x.uid;
 select revision into rev from public.patient_clinical_cases where user_id=x.uid;
 set local role authenticated;
 rev:=public.command_patient_clinical_review(x.uid,rev,x.token,'consultation-decision','{"decision":"not-required","note":"Synthetic routine review"}');
 rev:=public.save_patient_clinical_draft(x.uid,rev,x.token,x.draft);
 reset role;
 set local role service_role;
 if p_complete then
  published:=public.publish_patient_clinical_plan(x.uid,x.actor,rev,x.token,x.engine,gen_random_uuid());
  reset role;
  perform pg_temp.ok(published is not null,p_test||' complete panel publishes');
 else
  perform pg_temp.must_fail(format('select public.publish_patient_clinical_plan(%L,%L,%s,%L,%L,%L)',x.uid,x.actor,rev,x.token,x.engine,gen_random_uuid()),'The selected values do not cover this required test');
  reset role;
  perform pg_temp.ok(not exists(select 1 from public.patient_clinical_publications where user_id=x.uid),p_test||' legacy partial cannot publish');
 end if;
end$$;
savepoint panel_case;
select pg_temp.panel_case('cbc-hb',array['WBC'],false);
rollback to panel_case;
release panel_case;
savepoint panel_case;
select pg_temp.panel_case('cbc-hb',array['Platelets'],false);
rollback to panel_case;
release panel_case;
savepoint panel_case;
select pg_temp.panel_case('cbc-hb',array['Hemoglobin','WBC','Platelets'],false);
rollback to panel_case;
release panel_case;
savepoint panel_case;
select pg_temp.panel_case('urinalysis',array['Urinalysis'],false);
rollback to panel_case;
release panel_case;
savepoint panel_case;
select pg_temp.panel_case('creatinine-egfr',array['Creatinine'],false);
rollback to panel_case;
release panel_case;
savepoint panel_case;
select pg_temp.panel_case('creatinine-egfr',array['eGFR'],false);
rollback to panel_case;
release panel_case;
savepoint panel_case;
select pg_temp.panel_case('insulin-homa',array['Insulin'],false);
rollback to panel_case;
release panel_case;
savepoint panel_case;
select pg_temp.panel_case('insulin-homa',array['HOMA-IR'],false);
rollback to panel_case;
release panel_case;
savepoint panel_case;
select pg_temp.panel_case('creatinine-egfr',array['Creatinine','eGFR'],true);
rollback to panel_case;
release panel_case;
savepoint panel_case;
select pg_temp.panel_case('insulin-homa',array['Insulin','HOMA-IR'],true);
rollback to panel_case;
release panel_case;
-- Mutation proof for the specific safety finding, not merely unrelated files:
-- restoring the old any-analyte-per-row semantics must break the same cases.
savepoint panel_mutation;
create or replace function public._required_lab_test_covered(p_test text,p_values jsonb)returns boolean
language sql immutable set search_path=''as $$
 select exists(select 1 from jsonb_array_elements(public._required_lab_mapping()#>array['groups',p_test]))
 and not exists(select 1 from jsonb_array_elements(public._required_lab_mapping()#>array['groups',p_test])g
  where not exists(select 1 from jsonb_array_elements(p_values)v where g ? public._required_lab_analyte(v->>'name')))
$$;
select pg_temp.must_fail($case$select pg_temp.panel_case('cbc-hb',array['WBC'],false)$case$,'TEST command unexpectedly passed');
select pg_temp.must_fail($case$select pg_temp.panel_case('cbc-hb',array['Platelets'],false)$case$,'TEST command unexpectedly passed');
select pg_temp.must_fail($case$select pg_temp.panel_case('creatinine-egfr',array['Creatinine'],false)$case$,'TEST command unexpectedly passed');
select pg_temp.must_fail($case$select pg_temp.panel_case('insulin-homa',array['Insulin'],false)$case$,'TEST command unexpectedly passed');
rollback to panel_mutation;
select pg_temp.ok(not public._required_lab_test_covered('creatinine-egfr','[{"name":"Creatinine"}]'),'panel mutation restored');

-- Independently prove the legacy-publication assertions: removing only that
-- boundary's guard leaves record-time refusals intact, but must break the test.
savepoint publish_panel_mutation;
do $mutation$
declare definition text:=pg_get_functiondef('public.publish_patient_clinical_plan(uuid,uuid,bigint,text,jsonb,uuid)'::regprocedure);
 needle text:='perform public._assert_required_lab_receipt(p_user_id,test->>''id'',receipt->''values'');';
begin
 perform pg_temp.ok(position(needle in definition)>0,'publication mutation found the actual guard');
 execute replace(definition,needle,'null;');
end$mutation$;
select pg_temp.must_fail($case$select pg_temp.panel_case('cbc-hb',array['WBC'],false)$case$,'TEST command unexpectedly passed');
select pg_temp.must_fail($case$select pg_temp.panel_case('cbc-hb',array['Platelets'],false)$case$,'TEST command unexpectedly passed');
select pg_temp.must_fail($case$select pg_temp.panel_case('creatinine-egfr',array['Creatinine'],false)$case$,'TEST command unexpectedly passed');
select pg_temp.must_fail($case$select pg_temp.panel_case('insulin-homa',array['Insulin'],false)$case$,'TEST command unexpectedly passed');
rollback to publish_panel_mutation;

-- Existing receipts from the vulnerable RPC cannot be published, even if a client
-- fabricated a test id and the old server accepted it.
savepoint forged_receipts;
update public.patient_clinical_cases set review=jsonb_set(review,'{receipts,tsh}',review#>'{receipts,lipid-panel}')where user_id=(select uid from ctx);
set local role authenticated;
select public.command_patient_clinical_review(uid,2,token,'consultation-decision','{"decision":"not-required","note":"Synthetic routine review"}')from ctx;
select public.save_patient_clinical_draft(uid,3,token,draft)from ctx;
reset role;
set local role service_role;
select pg_temp.must_fail(format('select public.publish_patient_clinical_plan(%L,%L,4,%L,%L,%L)',uid,actor,token,engine,gen_random_uuid()),'The selected values do not cover this required test')from ctx;
reset role;
rollback to forged_receipts;

-- The production example: confirmed values dated 2023-11-08 cannot count.
savepoint old_values;
set local session_replication_role=replica;
update public.lab_ai_values set collected_on='2023-11-08'where attachment_id='c1ac0000-0000-4000-8000-000000000031';
set local session_replication_role=origin;
set local role authenticated;
select pg_temp.must_fail(pg_temp.receive('lipid-panel'),'Lab results must be dated on or after the questionnaire');
select pg_temp.must_fail(pg_temp.receive(null,op=>'receive-all-clinic-results'),'Lab results must be dated on or after the questionnaire');
reset role;
-- Forge an old receipt that still equals its current source, so only the new
-- date check (not the existing stale-value comparison) can reject publication.
update public.patient_clinical_cases c set review=jsonb_set(c.review,'{receipts,lipid-panel,values}',public._clinic_lab_receipt_values(c.user_id,'c1ac0000-0000-4000-8000-000000000031',(select lipids from ctx)))where c.user_id=(select uid from ctx);
set local role authenticated;
select public.command_patient_clinical_review(uid,2,token,'consultation-decision','{"decision":"not-required","note":"Synthetic routine review"}')from ctx;
select public.save_patient_clinical_draft(uid,3,token,draft)from ctx;
reset role;
set local role service_role;
select pg_temp.must_fail(format('select public.publish_patient_clinical_plan(%L,%L,4,%L,%L,%L)',uid,actor,token,engine,gen_random_uuid()),'Lab results must be dated on or after the questionnaire')from ctx;
reset role;
rollback to old_values;

-- Bulk is atomic: one confirmation, one revision, one event, correct per-test values.
set local role authenticated;
select pg_temp.must_fail(pg_temp.receive(null,op=>'receive-all-clinic-results',checked=>false),'Check the original source document');
select pg_temp.ok(public.command_patient_clinical_review(uid,2,token,'receive-all-clinic-results',jsonb_build_object('attachmentId','c1ac0000-0000-4000-8000-000000000031','valueIds',lipids||'["c1ac0000-0000-4000-8000-000000000055","c1ac0000-0000-4000-8000-000000000056"]'::jsonb,'sourceChecked',true,'note','One explicit bulk check'))=3,'bulk advances one revision')from ctx;
reset role;
select pg_temp.ok((select count(*)from public.patient_clinical_cases c,jsonb_object_keys(c.review->'receipts')k where c.user_id=(select uid from ctx))=3,'only lipid, HbA1c and paired glucose tests received');
select pg_temp.ok((select jsonb_array_length(review#>'{receipts,lipid-panel,values}')=4 and jsonb_array_length(review#>'{receipts,hba1c,values}')=1 and jsonb_array_length(review#>'{receipts,hba1c-glucose,values}')=2 from public.patient_clinical_cases where user_id=(select uid from ctx)),'bulk stores only each tests own analytes');
select pg_temp.ok((select count(*)from public.patient_clinical_case_events where user_id=(select uid from ctx)and kind='result-received')=2,'one single event and one bulk event');

-- Executable mutation proof. Removing the match check must make the SAME
-- rejection assertion fail; everything, including the mutation, rolls back.
savepoint match_mutation;
create or replace function public._required_lab_test_covered(p_test text,p_values jsonb)returns boolean language sql immutable set search_path=''as $$select true$$;
set local role authenticated;
select pg_temp.must_fail(format('select pg_temp.must_fail(%L,%L)',pg_temp.receive('tsh'),'The selected values do not cover this required test'),'TEST command unexpectedly passed');
reset role;
rollback to match_mutation;
select pg_temp.ok(not public._required_lab_test_covered('tsh',(select jsonb_agg(jsonb_build_object('name',name))from unnest(array['LDL-C','HDL-C','Total cholesterol','Triglycerides'])name)),'mutation restored');

-- The member-imported report alternative cannot bypass the same safety guard.
insert into public.patient_reports(id,user_id,object_path,file_name,mime,size_bytes,state,consent_version,confirmed_at,reviewed,revision)
select 'c1ac0000-0000-4000-8000-000000000090',uid,'synthetic-lab-match','lipids.pdf','application/pdf',1,'confirmed','test',now(),
 jsonb_build_object('reportDate',(clock_timestamp()at time zone 'Asia/Yerevan')::date,'laboratory','Synthetic lab','personName',null,'summary','','warnings','[]'::jsonb,'rows',
 (select jsonb_agg(jsonb_build_object('name',name,'literal','1.2','unit','mmol/L','reference',null,'uncertain',false,'page',1,'snippet','Synthetic'))from unnest(array['LDL-C','Total cholesterol','HDL-C','Triglycerides'])name)),1 from ctx;
create function pg_temp.prepare_report()returns void language plpgsql as $$
declare r bigint;x record;
begin
 reset role;
 update pg_temp.ctx set token=public.patient_clinical_evidence(uid)->>'token';
 select * into x from pg_temp.ctx;
 select revision into r from public.patient_clinical_cases where user_id=x.uid;
 set local role service_role;
 r:=public.prepare_patient_clinical_review(x.uid,x.actor,r,x.token,x.engine);
 reset role;
 set local role authenticated;
 perform public.command_patient_clinical_review(x.uid,r,x.token,'approve-report','{"reportId":"c1ac0000-0000-4000-8000-000000000090","reportRevision":1,"sourceChecked":true}');
 reset role;
end$$;
create function pg_temp.receive_report(test text)returns text language sql security definer set search_path=''as $$
 select format('select public.command_patient_clinical_review(%L,%s,%L,''receive-result'',%L)',uid,(select revision from public.patient_clinical_cases where user_id=uid),token,
 jsonb_build_object('reportId','c1ac0000-0000-4000-8000-000000000090','reportRevision',1,'sourceChecked',true,'testId',test,'rows','[0,1,2,3]'::jsonb,'note','Checked synthetic report'))from pg_temp.ctx
$$;
select pg_temp.prepare_report();
-- No SQL clock stub: exercise the real RPC with the current Yerevan day.
-- During 20:00-24:00 UTC this is tomorrow in the session, but valid in Yerevan.
savepoint report_today;
set local role authenticated;
do $$begin execute pg_temp.receive_report('lipid-panel');end$$;
reset role;
select pg_temp.ok((select review#>>'{receipts,lipid-panel,reportId}'='c1ac0000-0000-4000-8000-000000000090' from public.patient_clinical_cases where user_id=(select uid from ctx)),'Yerevan today is received through the public RPC');
rollback to report_today;
release report_today;

savepoint report_tomorrow;
set local session_replication_role=replica;
update public.patient_reports set reviewed=jsonb_set(reviewed,'{reportDate}',to_jsonb((clock_timestamp()at time zone 'Asia/Yerevan')::date+1))where id='c1ac0000-0000-4000-8000-000000000090';
set local session_replication_role=origin;
select pg_temp.prepare_report();
set local role authenticated;
select pg_temp.must_fail(pg_temp.receive_report('lipid-panel'),'A valid past collection date is required');
reset role;
select pg_temp.ok((select not(review->'receipts' ? 'lipid-panel') from public.patient_clinical_cases where user_id=(select uid from ctx)),'Yerevan tomorrow leaves no receipt');
rollback to report_tomorrow;
release report_tomorrow;

set local role authenticated;
select pg_temp.must_fail(pg_temp.receive_report('tsh'),'The selected values do not cover this required test');
select pg_temp.must_fail(pg_temp.receive_report('apob'),'The selected values do not cover this required test');
reset role;
-- Forge legacy report receipts. A valid draft cannot make those receipts count.
update public.patient_clinical_cases c set review=jsonb_set(jsonb_set(review,'{receipts,lipid-panel}',r),'{receipts,tsh}',r)
 from (select jsonb_build_object('reportId','c1ac0000-0000-4000-8000-000000000090','reportRevision',1,'rows','[0,1,2,3]'::jsonb,'note','Synthetic legacy','actorId',actor,'at',now())r from ctx)x where c.user_id=(select uid from ctx);
do $$declare x record;r bigint;begin
 select * into x from pg_temp.ctx;
 select revision into r from public.patient_clinical_cases where user_id=x.uid;
 set local role authenticated;
 r:=public.command_patient_clinical_review(x.uid,r,x.token,'consultation-decision','{"decision":"not-required","note":"Synthetic routine review"}');
 r:=public.save_patient_clinical_draft(x.uid,r,x.token,x.draft);
 reset role;
 -- Carry the RPC's revision into publication; service_role cannot read the case table.
 set local role service_role;
 perform pg_temp.must_fail(format('select public.publish_patient_clinical_plan(%L,%L,%s,%L,%L,%L)',x.uid,x.actor,r,x.token,x.engine,gen_random_uuid()),'The selected values do not cover this required test');
 reset role;
end$$;
set local session_replication_role=replica;
update public.patient_reports set reviewed=jsonb_set(reviewed,'{reportDate}','"2023-11-08"')where id='c1ac0000-0000-4000-8000-000000000090';
set local session_replication_role=origin;
select pg_temp.prepare_report();
set local role authenticated;
select pg_temp.must_fail(pg_temp.receive_report('lipid-panel'),'Lab results must be dated on or after the questionnaire');
reset role;
rollback;
