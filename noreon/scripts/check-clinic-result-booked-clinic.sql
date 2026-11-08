-- Fictional checks for the Fable review fixes; all fixtures roll back.
-- CF-1: a visit belongs to the clinic the member booked with, not the nurse's
-- employer clinic. CF-2: the clinic list carries the email reference, and a
-- clinic cannot attach to a visit another member's same-day visit shares a name with.
\set ON_ERROR_STOP on
begin;
create function pg_temp.cf_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'TEST %',label;end if;
end$$;
-- c7c0: admin 01, doctor 02, nurse 03 (employed by clinic A 07), members 04/05/06,
-- clinic-A user 08, clinic-B user 09; clinic B 10 is where 04 booked.
insert into auth.users(id,phone,phone_confirmed_at)select ('c7c00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,case when n in(4,5,6)then '37400079000'||n end,case when n in(4,5,6)then now()end from generate_series(1,9)n where n<>7;
insert into auth.sessions(id,user_id,created_at,updated_at)select ('c7c00000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid,('c7c00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,now(),now()from generate_series(1,9)n where n<>7;
insert into public.workspace_clinics(id,name)values('c7c00000-0000-4000-8000-000000000007','Synthetic employer clinic A'),('c7c00000-0000-4000-8000-000000000010','Synthetic booked clinic B');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('c7c00000-0000-4000-8000-000000000001','admin','Synthetic cf admin',null),
 ('c7c00000-0000-4000-8000-000000000002','doctor','Synthetic cf doctor','c7c00000-0000-4000-8000-000000000007'),
 ('c7c00000-0000-4000-8000-000000000003','nurse','Synthetic cf nurse','c7c00000-0000-4000-8000-000000000007');
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name)values
 ('c7c00000-0000-4000-8000-000000000008','c7c00000-0000-4000-8000-000000000007','Synthetic clinic A admin'),
 ('c7c00000-0000-4000-8000-000000000009','c7c00000-0000-4000-8000-000000000010','Synthetic clinic B admin');
insert into public.profiles(id,display_name)values('c7c00000-0000-4000-8000-000000000004','Synthetic Booked Member'),
 ('c7c00000-0000-4000-8000-000000000005','Synthetic Same Name'),('c7c00000-0000-4000-8000-000000000006','synthetic same name ')
 on conflict(id)do update set display_name=excluded.display_name;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)select ('c7c00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'c7c00000-0000-4000-8000-000000000002','c7c00000-0000-4000-8000-000000000003' from generate_series(4,6)n;
set local session_replication_role=replica;
-- Every visit is recorded by the clinic-A nurse (visits.clinic_id = A) but booked at clinic B.
-- One shared instant keeps the three visits on one Yerevan day and before the uploads (now()-1h) at any hour.
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id,appointment_id,accepted_revision,booking_context,created_at)
select ('c7c00000-0000-4000-8000-0000000000'||(20+n))::uuid,('c7c00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'c7c00000-0000-4000-8000-000000000003','Synthetic cf nurse','nurse',
 'c7c00000-0000-4000-8000-000000000007',('c7c00000-0000-4000-8000-0000000000'||(90+n))::uuid,1,'{"version":"booking-visit-context-v1"}',now()-interval '3 hours'
from generate_series(4,6)n;
insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,copy_revision,sender_email,clinic_email,copy_email,template_version,subject,text_content,envelope_hash,state)
select ('c7c00000-0000-4000-8000-0000000003'||(20+n))::uuid,('c7c00000-0000-4000-8000-0000000000'||(90+n))::uuid,1,gen_random_uuid(),gen_random_uuid(),'c7c00000-0000-4000-8000-000000000010',1,1,'sender@example.invalid','clinic@example.invalid','copy@example.invalid','synthetic','Synthetic','Synthetic',repeat('c',64),'accepted'
from generate_series(4,6)n;
insert into public.booking_appointment_versions(appointment_id,revision,program_id,proposed_arrangement,notice_id,actor_id)
select appointment_id,1,program_id,jsonb_build_object('clinicId','c7c00000-0000-4000-8000-000000000010'),id,'c7c00000-0000-4000-8000-000000000003' from public.booking_scheduling_notices where id::text like 'c7c0%';
insert into public.patient_care_visit_entries(id,user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id)
select ('c7c00000-0000-4000-8000-0000000000'||(30+n))::uuid,('c7c00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,('c7c00000-0000-4000-8000-0000000000'||(20+n))::uuid,gen_random_uuid(),1,
 jsonb_build_object('kind','collection','observedAt','2026-10-16T08:00:00+04:00','appointmentId','c7c00000-0000-4000-8000-000000000090','acceptedRevision',1,'testId','cbc','outcome','collected'),
 '2026-10-16T08:00:00+04:00','2026-10-16T04:00:00Z','c7c00000-0000-4000-8000-000000000003','Synthetic cf nurse','nurse','c7c00000-0000-4000-8000-000000000007' from generate_series(4,6)n;
insert into public.patient_care_lab_stages(user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id)
select ('c7c00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,('c7c00000-0000-4000-8000-0000000000'||(30+n))::uuid,'at-lab',gen_random_uuid(),now()-interval '2 hours','c7c00000-0000-4000-8000-000000000003','Synthetic cf nurse','nurse','c7c00000-0000-4000-8000-000000000007' from generate_series(4,6)n;
insert into public.clinic_batches(id,clinic_id,name,uploader_id,uploader_name)values
 ('c7c00000-0000-4000-8000-000000000041','c7c00000-0000-4000-8000-000000000007','Synthetic A batch','c7c00000-0000-4000-8000-000000000008','Synthetic A'),
 ('c7c00000-0000-4000-8000-000000000042','c7c00000-0000-4000-8000-000000000010','Synthetic B batch','c7c00000-0000-4000-8000-000000000009','Synthetic B');
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state,created_at)
select ('c7c00000-0000-4000-8000-0000000000'||x.n)::uuid,x.b::uuid,gen_random_uuid(),gen_random_uuid(),'c7c00000-0000-4000-8000-000000000008',gen_random_uuid(),'[]',now(),gen_random_uuid(),1,gen_random_uuid(),
 'synthetic-cf-'||x.n||'.pdf','application/pdf',10,repeat('d',64),'synthetic-cf/'||x.n,gen_random_uuid(),10,repeat('d',64),'stored',now()-interval '1 hour'
from(values('51','c7c00000-0000-4000-8000-000000000041'),('52','c7c00000-0000-4000-8000-000000000042'),('53','c7c00000-0000-4000-8000-000000000042'))x(n,b);
set local session_replication_role=origin;
insert into public.clinic_portal_capabilities(singleton,result_attach_enabled)values(true,true)on conflict(singleton)do update set result_attach_enabled=true;

create function pg_temp.as_user(n int) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','c7c00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated','exp',4102444800,'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id','c7c00000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::text,true)
$$;
create temp table cf(label text primary key,result jsonb);
grant all on cf to authenticated;
grant execute on function pg_temp.as_user(int) to authenticated;
set local role authenticated;
select pg_temp.as_user(8);
insert into cf values('a-list',public.clinic_portal_result_visits('c7c00000-0000-4000-8000-000000000007'));
select pg_temp.as_user(9);
insert into cf values('b-list',public.clinic_portal_result_visits('c7c00000-0000-4000-8000-000000000010'));
insert into cf values('b-ambiguous',public.clinic_portal_result_attach('c7c00000-0000-4000-8000-000000000010',jsonb_build_object('version','clinic-result-attach-v1','submissionId','c7c00000-0000-4000-8000-000000000801','fileId','c7c00000-0000-4000-8000-000000000053','visitId','c7c00000-0000-4000-8000-000000000025')));
insert into cf values('b-attach',public.clinic_portal_result_attach('c7c00000-0000-4000-8000-000000000010',jsonb_build_object('version','clinic-result-attach-v1','submissionId','c7c00000-0000-4000-8000-000000000802','fileId','c7c00000-0000-4000-8000-000000000052','visitId','c7c00000-0000-4000-8000-000000000024')));
select pg_temp.as_user(1);
insert into cf values('admin-a-file',public.clinic_result_attach_command(jsonb_build_object('version','clinic-result-attach-v1','submissionId','c7c00000-0000-4000-8000-000000000803','fileId','c7c00000-0000-4000-8000-000000000051','memberId','c7c00000-0000-4000-8000-000000000005','visitId','c7c00000-0000-4000-8000-000000000025')));
insert into cf values('admin-ambiguous',public.clinic_result_attach_command(jsonb_build_object('version','clinic-result-attach-v1','submissionId','c7c00000-0000-4000-8000-000000000804','fileId','c7c00000-0000-4000-8000-000000000053','memberId','c7c00000-0000-4000-8000-000000000005','visitId','c7c00000-0000-4000-8000-000000000025')));
reset role;

select pg_temp.cf_assert((select result->'visits'='[]'::jsonb from cf where label='a-list'),'CF-1: the nurse''s employer clinic sees none of these visits');
select pg_temp.cf_assert((select jsonb_array_length(result->'visits')=3 from cf where label='b-list'),'CF-1: the booked clinic sees its visits');
select pg_temp.cf_assert((select bool_and(v->>'reference'=('c7c00000-0000-4000-8000-0000000003'||right(v->>'visitId',2))) from cf,jsonb_array_elements(result->'visits')v where label='b-list'),'CF-2: each row carries the scheduling email reference');
select pg_temp.cf_assert((select array_agg(v->>'visitId' order by v->>'visitId')filter(where(v->>'ambiguous')::boolean)=array['c7c00000-0000-4000-8000-000000000025','c7c00000-0000-4000-8000-000000000026'] from cf,jsonb_array_elements(result->'visits')v where label='b-list'),'CF-2: two members sharing a name that day are flagged; the unique one is not');
select pg_temp.cf_assert((select not(result::text like '%c7c00000-0000-4000-8000-000000000005%') from cf where label='b-list'),'Clinic list still carries no member id');
select pg_temp.cf_assert((select result->>'status'='ambiguous' from cf where label='b-ambiguous'),'CF-2: the clinic cannot attach to an ambiguous visit');
select pg_temp.cf_assert((select result->>'status'='saved' and (result->>'moved')::int=1 from cf where label='b-attach'),'CF-1: the booked clinic attaches its upload to its visit');
select pg_temp.cf_assert((select result->>'status'='invalid' from cf where label='admin-a-file'),'CF-1: an employer-clinic upload cannot attach to a visit booked elsewhere');
select pg_temp.cf_assert((select result->>'status'='saved' from cf where label='admin-ambiguous'),'CF-2: Noreon admin resolves an ambiguous visit');
rollback;
select 'Clinic result booked clinic: booked-clinic scoping, email reference and ambiguity refusal passed.';
