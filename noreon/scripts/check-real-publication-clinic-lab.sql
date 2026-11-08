-- QA 174: a required laboratory result received from a doctor-confirmed clinic lab result. Fictional fixtures, rolled back.
-- Receipt refusals (unchecked, auto-accepted, rejected, other attachment, detached, other doctor), stale receipts at
-- publication (later correction, detach), the copy into patient_care_results under the new plan, the member seeing it
-- only after publication, and the doctor-only source list.
\set ON_ERROR_STOP on
begin;
create function pg_temp.password_actor(p_id uuid) returns text language plpgsql as $password$begin
 perform set_config('request.jwt.claim.sub',p_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','session_id',p_id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 return p_id::text;end$password$;
create function pg_temp.must_fail(command text,expected text) returns void language plpgsql as $$begin begin execute command;exception when others then if sqlerrm like '%'||expected||'%' then return;end if;raise;end;raise exception 'TEST command unexpectedly passed: %',command;end$$;
create function pg_temp.ok(cond boolean,label text) returns void language plpgsql as $$begin if cond is distinct from true then raise exception 'TEST %',label;end if;end$$;

-- c1ab: member 01, doctor 04, other doctor 05, clinic 10.
insert into auth.users(id,phone,phone_confirmed_at) values
('c1ab0000-0000-4000-8000-000000000001','37499000901',now()),('c1ab0000-0000-4000-8000-000000000004',null,null),('c1ab0000-0000-4000-8000-000000000005',null,null);
update public.profiles set display_name='Clinic lab fixture',birth_date='1980-01-01',biological_sex='female' where id::text like 'c1ab0000%';
insert into public.patient_consents(user_id,version) values('c1ab0000-0000-4000-8000-000000000001','patient-pilot-v1');
insert into public.patient_assessments(user_id,revision,completed_at) values('c1ab0000-0000-4000-8000-000000000001',2,'2026-10-20T00:00:00+04:00');
insert into public.workspace_clinics(id,name) values('c1ab0000-0000-4000-8000-000000000010','Synthetic clinic lab');
insert into public.workspace_staff(user_id,role,display_name,clinic_id) values
('c1ab0000-0000-4000-8000-000000000004','doctor','Assigned doctor','c1ab0000-0000-4000-8000-000000000010'),('c1ab0000-0000-4000-8000-000000000005','doctor','Other doctor','c1ab0000-0000-4000-8000-000000000010');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id) values('c1ab0000-0000-4000-8000-000000000001','c1ab0000-0000-4000-8000-000000000004');
insert into auth.sessions(id,user_id,created_at,updated_at) select user_id,user_id,clock_timestamp(),clock_timestamp() from public.workspace_staff where user_id::text like 'c1ab0000%';

-- Two stored clinic files (21, 22) attached to the member; 22 is detached later. Values are written as a doctor's
-- review leaves them (verified, corrected), plus an unchecked, an auto-accepted and a rejected one.
set local session_replication_role=replica;
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state,created_at)
select ('c1ab0000-0000-4000-8000-0000000000'||n)::uuid,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'c1ab0000-0000-4000-8000-000000000004',gen_random_uuid(),'[]',now(),gen_random_uuid(),1,gen_random_uuid(),
 'SYNTHETIC-LAB-'||n||'.pdf','application/pdf',1000,repeat('a',64),'synthetic-clinic-lab/'||n,gen_random_uuid(),1000,repeat('a',64),'stored',now()-interval '1 hour'
from generate_series(21,23)n;
insert into public.clinic_result_attachments(id,file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id)
select ('c1ab0000-0000-4000-8000-0000000000'||(n+10))::uuid,('c1ab0000-0000-4000-8000-0000000000'||n)::uuid,'c1ab0000-0000-4000-8000-000000000010','c1ab0000-0000-4000-8000-000000000001',gen_random_uuid(),'noreon-admin','c1ab0000-0000-4000-8000-000000000004',gen_random_uuid()
from generate_series(21,23)n;
insert into public.lab_ai_jobs(id,attachment_id,file_id,user_id,state,outcome,finished_at)
select ('c1ab0000-0000-4000-8000-0000000000'||(n+20))::uuid,('c1ab0000-0000-4000-8000-0000000000'||(n+10))::uuid,('c1ab0000-0000-4000-8000-0000000000'||n)::uuid,'c1ab0000-0000-4000-8000-000000000001','done','ok',now()
from generate_series(21,23)n;
-- Attachment 31 (file 21): 51 LDL verified, 52 total cholesterol corrected, 53 unchecked, 54 auto-accepted, 55 rejected, 56 qualitative verified.
-- Attachment 32 (file 22): 61 LDL verified.
insert into public.lab_ai_values(id,job_id,user_id,file_id,attachment_id,seq,test_name,catalogue_ref,value_text,value,unit,ref_text,collected_on,lab_name,page,status,corrected_value,corrected_unit,reviewed_by,reviewed_at,auto_accepted_at,auto_accept_rule) values
('c1ab0000-0000-4000-8000-000000000051','c1ab0000-0000-4000-8000-000000000041','c1ab0000-0000-4000-8000-000000000001','c1ab0000-0000-4000-8000-000000000021','c1ab0000-0000-4000-8000-000000000031',1,'LDL-C','ldl_c','3.4',3.4,'mmol/L','< 3.0','2026-10-28','SYNTHETIC Clinic Lab',1,'verified',null,null,'c1ab0000-0000-4000-8000-000000000004',now()-interval '20 minutes',null,null),
('c1ab0000-0000-4000-8000-000000000052','c1ab0000-0000-4000-8000-000000000041','c1ab0000-0000-4000-8000-000000000001','c1ab0000-0000-4000-8000-000000000021','c1ab0000-0000-4000-8000-000000000031',2,'Total cholesterol',null,'5.9',5.9,'mmol/L',null,'2026-10-28','SYNTHETIC Clinic Lab',1,'corrected',5.6,'mmol/L','c1ab0000-0000-4000-8000-000000000004',now()-interval '19 minutes',null,null),
('c1ab0000-0000-4000-8000-000000000053','c1ab0000-0000-4000-8000-000000000041','c1ab0000-0000-4000-8000-000000000001','c1ab0000-0000-4000-8000-000000000021','c1ab0000-0000-4000-8000-000000000031',3,'HDL-C',null,'1.1',1.1,'mmol/L',null,'2026-10-28','SYNTHETIC Clinic Lab',1,'unverified',null,null,null,null,null,null),
('c1ab0000-0000-4000-8000-000000000054','c1ab0000-0000-4000-8000-000000000041','c1ab0000-0000-4000-8000-000000000001','c1ab0000-0000-4000-8000-000000000021','c1ab0000-0000-4000-8000-000000000031',4,'Triglycerides',null,'1.2',1.2,'mmol/L',null,'2026-10-28','SYNTHETIC Clinic Lab',1,'auto_accepted',null,null,null,null,now(),'lab-auto-accept-v1'),
('c1ab0000-0000-4000-8000-000000000055','c1ab0000-0000-4000-8000-000000000041','c1ab0000-0000-4000-8000-000000000001','c1ab0000-0000-4000-8000-000000000021','c1ab0000-0000-4000-8000-000000000031',5,'Glucose',null,'9.9',9.9,'mmol/L',null,'2026-10-28','SYNTHETIC Clinic Lab',1,'rejected',null,null,'c1ab0000-0000-4000-8000-000000000004',now()-interval '18 minutes',null,null),
('c1ab0000-0000-4000-8000-000000000056','c1ab0000-0000-4000-8000-000000000041','c1ab0000-0000-4000-8000-000000000001','c1ab0000-0000-4000-8000-000000000021','c1ab0000-0000-4000-8000-000000000031',6,'Serum appearance',null,'clear',null,null,null,'2026-10-28','SYNTHETIC Clinic Lab',1,'verified',null,null,'c1ab0000-0000-4000-8000-000000000004',now()-interval '17 minutes',null,null),
('c1ab0000-0000-4000-8000-000000000061','c1ab0000-0000-4000-8000-000000000042','c1ab0000-0000-4000-8000-000000000001','c1ab0000-0000-4000-8000-000000000022','c1ab0000-0000-4000-8000-000000000032',1,'LDL-C','ldl_c','2.0',2.0,'mmol/L',null,'2026-10-20','SYNTHETIC Clinic Lab',1,'verified',null,null,'c1ab0000-0000-4000-8000-000000000004',now()-interval '30 minutes',null,null),
-- Attachment 33 (file 23): only a future-dated (71) and an undated (72) verified value, nothing receivable.
('c1ab0000-0000-4000-8000-000000000071','c1ab0000-0000-4000-8000-000000000043','c1ab0000-0000-4000-8000-000000000001','c1ab0000-0000-4000-8000-000000000023','c1ab0000-0000-4000-8000-000000000033',1,'LDL-C','ldl_c','2.2',2.2,'mmol/L',null,current_date+30,'SYNTHETIC Clinic Lab',1,'verified',null,null,'c1ab0000-0000-4000-8000-000000000004',now()-interval '30 minutes',null,null),
('c1ab0000-0000-4000-8000-000000000072','c1ab0000-0000-4000-8000-000000000043','c1ab0000-0000-4000-8000-000000000001','c1ab0000-0000-4000-8000-000000000023','c1ab0000-0000-4000-8000-000000000033',2,'HDL-C',null,'1.3',1.3,'mmol/L',null,null,'SYNTHETIC Clinic Lab',1,'verified',null,null,'c1ab0000-0000-4000-8000-000000000004',now()-interval '30 minutes',null,null);
insert into public.lab_ai_values(id,job_id,user_id,file_id,attachment_id,seq,test_name,catalogue_ref,value_text,value,unit,collected_on,page,status,reviewed_by,reviewed_at)
select ('c1ab0000-0000-4000-8000-0000000000'||n)::uuid,'c1ab0000-0000-4000-8000-000000000041','c1ab0000-0000-4000-8000-000000000001','c1ab0000-0000-4000-8000-000000000021','c1ab0000-0000-4000-8000-000000000031',n,
 case n when 57 then 'HDL-C' else 'Triglycerides'end,case n when 57 then 'hdl_c'else 'triglycerides'end,'1.2',1.2,'mmol/L','2026-10-28',1,'verified','c1ab0000-0000-4000-8000-000000000004',now()from generate_series(57,58)n;
set local session_replication_role=origin;
select pg_temp.ok(public._lab_ai_current('c1ab0000-0000-4000-8000-000000000031') and public._lab_ai_current('c1ab0000-0000-4000-8000-000000000032'),'fixture attachments are current');

create temp table ctx as select 'c1ab0000-0000-4000-8000-000000000001'::uuid uid,'c1ab0000-0000-4000-8000-000000000004'::uuid actor,public.patient_clinical_evidence('c1ab0000-0000-4000-8000-000000000001')->>'token' token,
 '{"version":"test-engine","urgency":"green","tests":[{"id":"lipid-panel","title":"Lipid panel","method":"lab"}]}'::jsonb engine,
 '{"explanation":"Synthetic clinician review","instructions":"Synthetic instructions","followUp":"","medicationName":"","medicationDose":"","medicationInstructions":"","medicationTimes":[]}'::jsonb draft;
grant select on ctx to authenticated,service_role;
create function pg_temp.receive(rev int,ids text[],att text default 'c1ab0000-0000-4000-8000-000000000031',checked boolean default true) returns text language sql as $$
 select format('select public.command_patient_clinical_review(%L,%s,%L,''receive-clinic-result'',%L)',uid,rev,token,
  jsonb_build_object('attachmentId',att,'valueIds',to_jsonb(ids),'testId','lipid-panel','note','Checked against the clinic sheet','sourceChecked',checked)) from ctx
$$;
grant execute on function pg_temp.receive(int,text[],text,boolean) to authenticated;

-- The doctor's source list: only attachment rows with doctor-checked values, and only those values.
select pg_temp.password_actor('c1ab0000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.doctor_clinic_lab_receipt_sources(uid)->'attachments')=2,'two receivable attachments listed; the undated and future-dated sheet is left out, not null (Astra QA174-R1)') from ctx;
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.doctor_clinic_lab_receipt_sources(uid)->'attachments') a where jsonb_typeof(a->'values')<>'array' or a->>'attachmentId'='c1ab0000-0000-4000-8000-000000000033'),'no attachment without receivable values') from ctx;
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.doctor_clinic_lab_receipt_sources(uid)->'attachments') a,jsonb_array_elements(a->'values') x
 where x->>'id' in('c1ab0000-0000-4000-8000-000000000053','c1ab0000-0000-4000-8000-000000000054','c1ab0000-0000-4000-8000-000000000055')),'unchecked, auto-accepted and rejected values are not offered') from ctx;
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.doctor_clinic_lab_receipt_sources(uid)->'attachments') a,jsonb_array_elements(a->'values') x
 where x->>'id'='c1ab0000-0000-4000-8000-000000000052' and (x->>'value')::numeric=5.6 and x->>'valueText'='5.6'),'a corrected value is offered as corrected') from ctx;
reset role;
select pg_temp.password_actor('c1ab0000-0000-4000-8000-000000000005');
set local role authenticated;
select pg_temp.must_fail(format('select public.doctor_clinic_lab_receipt_sources(%L)',uid),'Assigned active doctor required') from ctx;
reset role;
-- The member and anon cannot call it.
select pg_temp.password_actor('c1ab0000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.must_fail(format('select public.doctor_clinic_lab_receipt_sources(%L)',uid),'Assigned active doctor required') from ctx;
select pg_temp.must_fail('select public._clinic_lab_receipt_values(null,null,null)','permission denied');
reset role;

-- Prepare and draft, then receive.
select pg_temp.password_actor('c1ab0000-0000-4000-8000-000000000004');
set local role service_role;
select public.prepare_patient_clinical_review(uid,actor,0,token,engine) from ctx;
reset role;
select pg_temp.password_actor('c1ab0000-0000-4000-8000-000000000004');
set local role authenticated;
select public.save_patient_clinical_draft(uid,1,token,draft) from ctx;
-- Refusals.
select pg_temp.must_fail(pg_temp.receive(2,array['c1ab0000-0000-4000-8000-000000000071'],att=>'c1ab0000-0000-4000-8000-000000000033'),'confirmed by a doctor');
select pg_temp.must_fail(pg_temp.receive(2,array['c1ab0000-0000-4000-8000-000000000072'],att=>'c1ab0000-0000-4000-8000-000000000033'),'confirmed by a doctor');
select pg_temp.must_fail(pg_temp.receive(2,array['c1ab0000-0000-4000-8000-000000000051'],checked=>false),'Check the original source');
select pg_temp.must_fail(pg_temp.receive(2,array['c1ab0000-0000-4000-8000-000000000053']),'confirmed by a doctor');
select pg_temp.must_fail(pg_temp.receive(2,array['c1ab0000-0000-4000-8000-000000000054']),'confirmed by a doctor');
select pg_temp.must_fail(pg_temp.receive(2,array['c1ab0000-0000-4000-8000-000000000055']),'confirmed by a doctor');
select pg_temp.must_fail(pg_temp.receive(2,array['c1ab0000-0000-4000-8000-000000000061']),'confirmed by a doctor');
select pg_temp.must_fail(pg_temp.receive(2,array['c1ab0000-0000-4000-8000-000000000051','c1ab0000-0000-4000-8000-000000000051']),'confirmed by a doctor');
select pg_temp.must_fail(pg_temp.receive(2,array[]::text[]),'confirmed by a doctor');
select pg_temp.must_fail(pg_temp.receive(2,array['not-a-uuid']),'confirmed by a doctor');
select pg_temp.must_fail(pg_temp.receive(2,array['c1ab0000-0000-4000-8000-000000000051'],att=>'nope'),'confirmed by a doctor');
reset role;
select pg_temp.password_actor('c1ab0000-0000-4000-8000-000000000005');
set local role authenticated;
select pg_temp.must_fail(pg_temp.receive(2,array['c1ab0000-0000-4000-8000-000000000051']),'Assigned active doctor');
reset role;
-- The old report receipts still behave as before: unknown report refused.
select pg_temp.password_actor('c1ab0000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.must_fail(format('select public.command_patient_clinical_review(%L,2,%L,''receive-result'',%L)',uid,token,'{"reportId":"c1ab0000-0000-4000-8000-000000000099","reportRevision":1,"sourceChecked":true,"testId":"lipid-panel","rows":[0],"note":"x"}'),'Confirm and review the current source report') from ctx;
-- Receive LDL, the corrected total cholesterol and a qualitative row.
select pg_temp.ok(public.command_patient_clinical_review(uid,2,token,'receive-clinic-result',jsonb_build_object('attachmentId','c1ab0000-0000-4000-8000-000000000031',
 'valueIds',jsonb_build_array('c1ab0000-0000-4000-8000-000000000052','c1ab0000-0000-4000-8000-000000000051','c1ab0000-0000-4000-8000-000000000056','c1ab0000-0000-4000-8000-000000000057','c1ab0000-0000-4000-8000-000000000058'),'testId','lipid-panel','note','Checked against the clinic sheet','sourceChecked',true))=3,'clinic receipt recorded') from ctx;
reset role;
select pg_temp.ok((select review#>>'{receipts,lipid-panel,source}'='clinic-lab' and jsonb_array_length(review#>'{receipts,lipid-panel,values}')=4
 and review#>>'{receipts,lipid-panel,values,0,id}'='c1ab0000-0000-4000-8000-000000000051' from public.patient_clinical_cases where user_id=(select uid from ctx)),'receipt keeps the values in sheet order');
select pg_temp.ok(exists(select 1 from public.patient_clinical_case_events where user_id=(select uid from ctx) and kind='result-received' and detail->>'source'='clinic-lab'),'receipt event recorded');
select pg_temp.password_actor('c1ab0000-0000-4000-8000-000000000004');
set local role authenticated;
select public.save_patient_clinical_draft(uid,3,token,draft) from ctx;
select public.command_patient_clinical_review(uid,4,token,'consultation-decision','{"decision":"not-required","note":"Routine review"}') from ctx;
select public.save_patient_clinical_draft(uid,5,token,draft) from ctx;
reset role;

-- Stale: a later correction of a received value, then a detach, each refuse publication.
savepoint later_correction;
set local session_replication_role=replica;
update public.lab_ai_values set status='corrected',corrected_value=3.3,corrected_unit='mmol/L',reviewed_at=now() where id='c1ab0000-0000-4000-8000-000000000051';
set local session_replication_role=origin;
set local role service_role;
select pg_temp.must_fail(format('select public.publish_patient_clinical_plan(%L,%L,6,%L,%L,%L)',uid,actor,token,engine,gen_random_uuid()),'Required source receipt is stale') from ctx;
reset role;
rollback to later_correction;
savepoint detached;
set local session_replication_role=replica;
insert into public.clinic_result_detachments(attachment_id,actor_id,submission_id,reason)
 select 'c1ab0000-0000-4000-8000-000000000031',actor,gen_random_uuid(),'Synthetic wrong member' from ctx;
set local session_replication_role=origin;
set local role service_role;
select pg_temp.must_fail(format('select public.publish_patient_clinical_plan(%L,%L,6,%L,%L,%L)',uid,actor,token,engine,gen_random_uuid()),'Required source receipt is stale') from ctx;
reset role;
rollback to detached;

-- Before publication the member sees no result; after it, the complete lipid profile under the new plan.
select pg_temp.password_actor('c1ab0000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.ok((select count(*) from public.patient_care_results)=0,'member sees nothing before publication');
reset role;
select pg_temp.password_actor('c1ab0000-0000-4000-8000-000000000004');
set local role service_role;
create temp table published as select public.publish_patient_clinical_plan(uid,actor,6,token,engine,'c1ab0000-0000-4000-8000-0000000000a1') plan_id from ctx;
reset role;
select pg_temp.ok((select count(*) from public.patient_care_results r join published p on p.plan_id=r.publication_plan_id where r.user_id=(select uid from ctx))=4,'four matching numeric values copied');
select pg_temp.ok((select value=5.6 and marker='Total cholesterol' and source='laboratory' and source_label='SYNTHETIC Clinic Lab' and reviewed_by='Assigned doctor'
 and explanation='Checked against the clinic sheet' and source_lab_value_id='c1ab0000-0000-4000-8000-000000000052' and source_report_id is null
 from public.patient_care_results where source_lab_value_id='c1ab0000-0000-4000-8000-000000000052'),'corrected value published with provenance');
select pg_temp.ok((select reference_text='< 3.0' and collected_at='2026-10-28T00:00:00+04:00' from public.patient_care_results where source_lab_value_id='c1ab0000-0000-4000-8000-000000000051'),'reference and collection date kept');
select pg_temp.ok((select count(*) from public.patient_care_tests where user_id=(select uid from ctx) and source_lab_attachment_id='c1ab0000-0000-4000-8000-000000000031' and source_requirement_id='lipid-panel' and status='collected')=1,'one collected test for the requirement');
select pg_temp.ok(not exists(select 1 from public.patient_clinical_publications p,jsonb_array_elements(p.review#>'{receipts,lipid-panel,values}')v where v->>'name'='Serum appearance'),'unrelated qualitative value is not used for this test');
select pg_temp.password_actor('c1ab0000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.ok((select count(*) from public.patient_care_results)=4,'member sees the published values');
select pg_temp.ok(jsonb_array_length(public.patient_current_published_clinical_review()->'sourceRows')=0,'current published review reads with a clinic receipt and adds no report rows');
select pg_temp.ok(public.patient_published_clinical_reviews()#>>'{0,receipts,lipid-panel,source}'='clinic-lab','published reviews return the clinic receipt to the member');
reset role;
-- Replay of the same request returns the same plan and copies nothing twice.
select pg_temp.password_actor('c1ab0000-0000-4000-8000-000000000004');
set local role service_role;
select pg_temp.ok(public.publish_patient_clinical_plan(uid,actor,6,token,engine,'c1ab0000-0000-4000-8000-0000000000a1')=(select plan_id from published),'replay returns the plan') from ctx;
reset role;
select pg_temp.ok((select count(*) from public.patient_care_results where user_id=(select uid from ctx))=4,'replay copies nothing');
-- The direct writer surface stays closed.
set local role authenticated;
select pg_temp.must_fail(format('select public.publish_patient_clinical_plan(%L,%L,7,%L,%L,%L)',uid,actor,token,engine,gen_random_uuid()),'permission denied') from ctx;
select pg_temp.must_fail(format('select public.command_patient_clinical_review_before_clinic_lab(%L,7,%L,''consultation-decision'',%L)',uid,token,'{}'),'permission denied') from ctx;
reset role;
rollback;
