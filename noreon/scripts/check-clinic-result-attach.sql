-- Fictional clinic lab-upload attachment lifecycle; all fixtures roll back.
-- Admin-only attach, clinic scoping, system-recorded stages, idempotent resend,
-- audited correction without rollback, and the manual fallback each assert below.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ra_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'TEST %',label;end if;
end$$;
-- c7a0 namespace: admin 01, doctor 02, nurse 03, member 04, other member 05; clinic 07, other clinic 08.
insert into auth.users(id,phone,phone_confirmed_at)values
 ('c7a00000-0000-4000-8000-000000000001',null,null),('c7a00000-0000-4000-8000-000000000002',null,null),('c7a00000-0000-4000-8000-000000000003',null,null),
 ('c7a00000-0000-4000-8000-000000000004','374000770004',now()),('c7a00000-0000-4000-8000-000000000005','374000770005',now());
insert into auth.sessions(id,user_id,created_at,updated_at)select ('c7a00000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid,('c7a00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,now(),now()from generate_series(1,5)n;
insert into public.workspace_clinics(id,name)values('c7a00000-0000-4000-8000-000000000007','Synthetic result clinic'),('c7a00000-0000-4000-8000-000000000008','Synthetic other clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('c7a00000-0000-4000-8000-000000000001','admin','Synthetic result admin',null),
 ('c7a00000-0000-4000-8000-000000000002','doctor','Synthetic result doctor','c7a00000-0000-4000-8000-000000000007'),
 ('c7a00000-0000-4000-8000-000000000003','nurse','Synthetic result nurse','c7a00000-0000-4000-8000-000000000007');
insert into public.profiles(id,display_name)values('c7a00000-0000-4000-8000-000000000004','Synthetic attached member'),('c7a00000-0000-4000-8000-000000000005','Synthetic other-clinic member')
 on conflict(id)do update set display_name=excluded.display_name;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('c7a00000-0000-4000-8000-000000000004','c7a00000-0000-4000-8000-000000000002','c7a00000-0000-4000-8000-000000000003'),
 ('c7a00000-0000-4000-8000-000000000005','c7a00000-0000-4000-8000-000000000002',null);
-- Visits, entries, the first at-lab stage and uploads are owner fixtures (their own commands have checks).
set local session_replication_role=replica;
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id,appointment_id,accepted_revision,booking_context)values
 ('c7a00000-0000-4000-8000-000000000021','c7a00000-0000-4000-8000-000000000004','c7a00000-0000-4000-8000-000000000003','Synthetic result nurse','nurse','c7a00000-0000-4000-8000-000000000007','c7a00000-0000-4000-8000-000000000090',1,'{"version":"booking-visit-context-v1"}'),
 ('c7a00000-0000-4000-8000-000000000022','c7a00000-0000-4000-8000-000000000005','c7a00000-0000-4000-8000-000000000003','Synthetic result nurse','nurse','c7a00000-0000-4000-8000-000000000008','c7a00000-0000-4000-8000-000000000091',1,'{"version":"booking-visit-context-v1"}'),
 ('c7a00000-0000-4000-8000-000000000023','c7a00000-0000-4000-8000-000000000004','c7a00000-0000-4000-8000-000000000003','Synthetic result nurse','nurse','c7a00000-0000-4000-8000-000000000007','c7a00000-0000-4000-8000-000000000092',1,'{"version":"booking-visit-context-v1"}');
-- Booked clinic and email reference come from the accepted version's notice (CF-1).
insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,copy_revision,sender_email,clinic_email,copy_email,template_version,subject,text_content,envelope_hash,state)
select gen_random_uuid(),v.appointment_id,1,gen_random_uuid(),gen_random_uuid(),v.clinic_id,1,1,'sender@example.invalid','clinic@example.invalid','copy@example.invalid','synthetic','Synthetic','Synthetic',repeat('c',64),'accepted'
from public.patient_care_visits v where v.id::text like 'c7a0%';
insert into public.booking_appointment_versions(appointment_id,revision,program_id,proposed_arrangement,notice_id,actor_id)
select n.appointment_id,1,n.program_id,'{}',n.id,'c7a00000-0000-4000-8000-000000000003' from public.booking_scheduling_notices n join public.patient_care_visits v on v.appointment_id=n.appointment_id where v.id::text like 'c7a0%';
insert into public.patient_care_visit_entries(id,user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id)
select ('c7a00000-0000-4000-8000-0000000000'||x.n)::uuid,x.u::uuid,x.v::uuid,'c7a00000-0000-4000-8000-000000000060',x.pos,
 jsonb_build_object('kind','collection','observedAt','2026-10-16T08:00:00+04:00','appointmentId','c7a00000-0000-4000-8000-000000000090','acceptedRevision',1,'testId',x.t,'outcome',x.o)||case when x.o='collected'then '{}'::jsonb else '{"reason":"Synthetic"}'::jsonb end,
 '2026-10-16T08:00:00+04:00','2026-10-16T04:00:00Z','c7a00000-0000-4000-8000-000000000003','Synthetic result nurse','nurse','c7a00000-0000-4000-8000-000000000007'
from(values('31','c7a00000-0000-4000-8000-000000000004','c7a00000-0000-4000-8000-000000000021',1,'cbc','collected'),('32','c7a00000-0000-4000-8000-000000000004','c7a00000-0000-4000-8000-000000000021',2,'lipids','collected'),
 ('33','c7a00000-0000-4000-8000-000000000004','c7a00000-0000-4000-8000-000000000021',3,'tsh','not-collected'),('34','c7a00000-0000-4000-8000-000000000005','c7a00000-0000-4000-8000-000000000022',1,'cbc','collected'),
 ('35','c7a00000-0000-4000-8000-000000000004','c7a00000-0000-4000-8000-000000000023',4,'cbc','collected'))x(n,u,v,pos,t,o);
insert into public.patient_care_lab_stages(user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id)values
 ('c7a00000-0000-4000-8000-000000000004','c7a00000-0000-4000-8000-000000000031','at-lab','c7a00000-0000-4000-8000-000000000061','2026-10-16T09:00:00+04:00','c7a00000-0000-4000-8000-000000000003','Synthetic result nurse','nurse','c7a00000-0000-4000-8000-000000000007'),
 ('c7a00000-0000-4000-8000-000000000004','c7a00000-0000-4000-8000-000000000035','at-lab','c7a00000-0000-4000-8000-000000000062','2026-10-16T09:00:00+04:00','c7a00000-0000-4000-8000-000000000003','Synthetic result nurse','nurse','c7a00000-0000-4000-8000-000000000007'),
 ('c7a00000-0000-4000-8000-000000000005','c7a00000-0000-4000-8000-000000000034','at-lab','c7a00000-0000-4000-8000-000000000063','2026-10-16T09:00:00+04:00','c7a00000-0000-4000-8000-000000000003','Synthetic result nurse','nurse','c7a00000-0000-4000-8000-000000000008');
insert into public.clinic_batches(id,clinic_id,name,uploader_id,uploader_name)values
 ('c7a00000-0000-4000-8000-000000000041','c7a00000-0000-4000-8000-000000000007','Synthetic batch','c7a00000-0000-4000-8000-000000000001','Synthetic uploader'),
 ('c7a00000-0000-4000-8000-000000000042','c7a00000-0000-4000-8000-000000000008','Synthetic other batch','c7a00000-0000-4000-8000-000000000001','Synthetic uploader');
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state)
select ('c7a00000-0000-4000-8000-0000000000'||x.n)::uuid,x.b::uuid,gen_random_uuid(),gen_random_uuid(),'c7a00000-0000-4000-8000-000000000001',gen_random_uuid(),'[]',now(),gen_random_uuid(),1,gen_random_uuid(),
 'synthetic-'||x.n||'.pdf','application/pdf',10,repeat('a',64),'synthetic/'||x.n,case when x.s='stored'then gen_random_uuid()end,case when x.s='stored'then 10 end,case when x.s='stored'then repeat('a',64)end,x.s
from(values('51','c7a00000-0000-4000-8000-000000000041','stored'),('52','c7a00000-0000-4000-8000-000000000041','reserved'),('53','c7a00000-0000-4000-8000-000000000042','stored'))x(n,b,s);
-- Uploads arrive after the visits and their hand-overs (F1 ordering).
update public.clinic_batch_files set created_at=now()-interval '1 hour' where id::text like 'c7a0%';
update public.patient_care_visits set created_at=now()-interval '3 hours' where id::text like 'c7a0%';
update public.patient_care_lab_stages set occurred_at=now()-interval '2 hours' where user_id::text like 'c7a0%';
-- An upload older than the visit (52 is reserved; 54 is stored but too early).
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state,created_at)
 values('c7a00000-0000-4000-8000-000000000054','c7a00000-0000-4000-8000-000000000041',gen_random_uuid(),gen_random_uuid(),'c7a00000-0000-4000-8000-000000000001',gen_random_uuid(),'[]',now(),gen_random_uuid(),1,gen_random_uuid(),'synthetic-early.pdf','application/pdf',10,repeat('a',64),'synthetic/54',gen_random_uuid(),10,repeat('a',64),'stored',now()-interval '4 hours');
set local session_replication_role=origin;
-- The database switch (part 2, F3) is on for this fixture only.
insert into public.clinic_portal_capabilities(singleton,result_attach_enabled)values(true,true)on conflict(singleton)do update set result_attach_enabled=true;

create function pg_temp.as_user(n int) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','c7a00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated','exp',4102444800,'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id','c7a00000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::text,true)
$$;
create function pg_temp.cmd(sub text,file text,member text,visit text) returns jsonb language sql as $$
 select jsonb_build_object('version','clinic-result-attach-v1','submissionId','c7a00000-0000-4000-8000-0000000007'||sub,'fileId','c7a00000-0000-4000-8000-0000000000'||file,'memberId','c7a00000-0000-4000-8000-0000000000'||member,'visitId','c7a00000-0000-4000-8000-0000000000'||visit)
$$;
create temp table ra(label text primary key,result jsonb);
grant all on ra to authenticated;
grant execute on function pg_temp.as_user(int),pg_temp.cmd(text,text,text,text) to authenticated;
select pg_temp.ra_assert(not has_function_privilege('anon','public.clinic_result_attach_command(jsonb)','execute')
 and not has_function_privilege('anon','public.clinic_result_attach_page(uuid)','execute'),'Anonymous callers cannot attach or list');

set local role authenticated;
select pg_temp.as_user(1);
insert into ra values('page',public.clinic_result_attach_page('c7a00000-0000-4000-8000-000000000007'));
insert into ra values('other-file',public.clinic_result_attach_command(pg_temp.cmd('01','53','04','21')));
insert into ra values('other-visit',public.clinic_result_attach_command(pg_temp.cmd('02','51','05','22')));
insert into ra values('not-stored',public.clinic_result_attach_command(pg_temp.cmd('03','52','04','21')));
insert into ra values('wrong-member',public.clinic_result_attach_command(pg_temp.cmd('04','51','05','21')));
insert into ra values('too-early',public.clinic_result_attach_command(pg_temp.cmd('08','54','04','21')));
insert into ra values('extra-key',public.clinic_result_attach_command(pg_temp.cmd('05','51','04','21')||'{"tests":["cbc"]}'));
select pg_temp.as_user(3);
insert into ra values('nurse',public.clinic_result_attach_command(pg_temp.cmd('06','51','04','21')));
select pg_temp.as_user(4);
insert into ra values('member',public.clinic_result_attach_command(pg_temp.cmd('07','51','04','21')));
select pg_temp.as_user(1);
insert into ra values('attach',public.clinic_result_attach_command(pg_temp.cmd('10','51','04','21')));
insert into ra values('resend',public.clinic_result_attach_command(pg_temp.cmd('10','51','04','21')));
insert into ra values('duplicate',public.clinic_result_attach_command(pg_temp.cmd('11','51','04','21')));
insert into ra values('correct',public.clinic_result_attach_command(pg_temp.cmd('12','51','04','23')));
select pg_temp.as_user(3);
insert into ra values('nurse-read',public.patient_staff_lab_stages('c7a00000-0000-4000-8000-000000000004'));
insert into ra values('manual-dup',public.patient_staff_lab_stage_command(jsonb_build_object('version','lab-stage-v1','id','c7a00000-0000-4000-8000-000000000004','submissionId','c7a00000-0000-4000-8000-000000000080','entryId','c7a00000-0000-4000-8000-000000000031','stage','results-received','occurredAt',to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
insert into ra values('lipids-lab',public.patient_staff_lab_stage_command(jsonb_build_object('version','lab-stage-v1','id','c7a00000-0000-4000-8000-000000000004','submissionId','c7a00000-0000-4000-8000-000000000081','entryId','c7a00000-0000-4000-8000-000000000032','stage','at-lab','occurredAt',to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
select pg_temp.as_user(1);
-- Lipids reached the lab after the upload: resend and re-attach must not mark them (review F1).
insert into ra values('resend-after-lab',public.clinic_result_attach_command(pg_temp.cmd('12','51','04','23')));
insert into ra values('reattach-after-lab',public.clinic_result_attach_command(pg_temp.cmd('13','51','04','21')));
select pg_temp.as_user(3);
insert into ra values('lipids-manual',public.patient_staff_lab_stage_command(jsonb_build_object('version','lab-stage-v1','id','c7a00000-0000-4000-8000-000000000004','submissionId','c7a00000-0000-4000-8000-000000000082','entryId','c7a00000-0000-4000-8000-000000000032','stage','results-received','occurredAt',to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
select pg_temp.as_user(4);
insert into ra values('member-read',public.patient_member_lab_stages());
reset role;

select pg_temp.ra_assert((select array(select x->>'id' from jsonb_array_elements(result->'files')x order by 1)=array['c7a00000-0000-4000-8000-000000000051','c7a00000-0000-4000-8000-000000000054'] from ra where label='page'),'Page lists only this clinic''s stored uploads');
select pg_temp.ra_assert((select array(select x->>'visitId' from jsonb_array_elements(result->'visits')x order by 1)=array['c7a00000-0000-4000-8000-000000000021','c7a00000-0000-4000-8000-000000000023'] from ra where label='page'),'Page offers only this clinic''s open visits');
select pg_temp.ra_assert((select bool_and(result->>'status'='invalid') from ra where label in('other-file','other-visit','not-stored','wrong-member','extra-key','too-early')),'Cross-clinic, unstored, mismatched and extended attachments are rejected');
select pg_temp.ra_assert((select bool_and(result->>'status'='access') from ra where label in('nurse','member')),'Only a Noreon admin attaches');
select pg_temp.ra_assert((select result->>'status'='saved' and (result->>'moved')::int=1 and (result->>'waitingForLab')::int=1 and (result->>'alreadyReceived')::int=0 and result->>'corrected'='false' from ra where label='attach'),'Attach moves the sample at the lab and leaves the collected one');
select pg_temp.ra_assert((select count(*)=1 from public.patient_care_lab_stages where collection_entry_id='c7a00000-0000-4000-8000-000000000031' and stage='results-received' and actor_role='system' and actor_id is null and attachment_id is not null),'System recorded results-received with the attachment (kept as history after the move)');
select pg_temp.ra_assert((select bool_and(result->>'status'='saved' and (result->>'moved')::int=0 and (result->>'alreadyReceived')::int=1 and result->>'attachmentId'=(select result->>'attachmentId' from ra where label='attach')) from ra where label in('resend','duplicate')),'Resend and duplicate attach are idempotent');
select pg_temp.ra_assert((select result->>'status'='saved' and result->>'corrected'='true' and (result->>'moved')::int=1 and (result->>'retracted')::int=1 from ra where label='correct'),'Move to another visit retracts the old visit''s system result and moves the new visit''s sample');
select pg_temp.ra_assert((select count(*)=3 from public.clinic_result_attachments where file_id='c7a00000-0000-4000-8000-000000000051'),'One row per attach or correction, none for idempotent resends');
select pg_temp.ra_assert((select count(*)=1 from public.patient_care_lab_stages r join public.patient_care_lab_stages x on x.retracts=r.id where r.collection_entry_id='c7a00000-0000-4000-8000-000000000031' and r.actor_role='system' and x.stage='results-retracted' and x.actor_role='system'),'Unsupported system result is retracted by a new row, never deleted');
select pg_temp.ra_assert((select array_agg(kind order by id)=array['result-attached','result-reattached','result-reattached'] from public.clinic_portal_audit where clinic_id='c7a00000-0000-4000-8000-000000000007' and kind like 'result-%'),'Attach and correction are audited');
select pg_temp.ra_assert((select count(*)=4 from public.patient_clinical_case_events where user_id='c7a00000-0000-4000-8000-000000000004' and detail->>'actor'='system'),'Every system move and retraction leaves a case event');
select pg_temp.ra_assert((select exists(select 1 from jsonb_array_elements(result->'samples')s,jsonb_array_elements(s->'stages')g where g#>>'{actor,role}'='system') from ra where label='nurse-read'),'Staff read shows the system as actor');
select pg_temp.ra_assert((select public._clinic_portal_file_json(f)#>>'{association,status}'='associated' from public.clinic_batch_files f where id='c7a00000-0000-4000-8000-000000000051')
 and (select public._clinic_portal_file_json(f)#>>'{association,status}'='not_started' from public.clinic_batch_files f where id='c7a00000-0000-4000-8000-000000000054')
 and (select not (public._clinic_portal_file_json(f)::text like '%c7a00000-0000-4000-8000-000000000004%') from public.clinic_batch_files f where id='c7a00000-0000-4000-8000-000000000051'),'Clinic file status shows association without member data');
select pg_temp.ra_assert((select result->>'status'='saved' from ra where label='manual-dup'),'After a retraction the nurse can record results manually again');
select pg_temp.ra_assert((select bool_and(result->>'status'='saved') from ra where label in('lipids-lab','lipids-manual')),'Manual nurse path remains the fallback');
select pg_temp.ra_assert((select bool_and(result->>'status'='saved' and (result->>'moved')::int=0) from ra where label in('resend-after-lab','reattach-after-lab')),'Resend and re-attach never mark a sample handed over after the upload');
select pg_temp.ra_assert((select count(*)=0 from public.patient_care_lab_stages where collection_entry_id='c7a00000-0000-4000-8000-000000000032' and actor_role='system'),'Lipids stay manual');
select pg_temp.ra_assert((select bool_and(occurred_at=(select created_at from public.clinic_batch_files where id='c7a00000-0000-4000-8000-000000000051')) from public.patient_care_lab_stages where actor_role='system' and stage='results-received' and user_id='c7a00000-0000-4000-8000-000000000004'),'System results are stamped with the upload time');
select pg_temp.ra_assert((select not (result::text like '%actor%') and result::text like '%results-received%' from ra where label='member-read'),'Member sees results received without any actor');

do $$begin
 perform pg_temp.as_user(3);
 set local role authenticated;
 begin perform public.clinic_result_attach_page('c7a00000-0000-4000-8000-000000000007');raise exception 'TEST nurse listed clinic uploads';
 exception when insufficient_privilege then null;end;
 reset role;
 begin insert into public.patient_care_lab_stages(user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id,attachment_id)
  values('c7a00000-0000-4000-8000-000000000004','c7a00000-0000-4000-8000-000000000032','at-lab',gen_random_uuid(),now(),null,'Clinic upload','system','c7a00000-0000-4000-8000-000000000007',(select id from public.clinic_result_attachments limit 1));
  raise exception 'TEST system recorded a hand-over';
 exception when check_violation then null;end;
 begin update public.clinic_result_attachments set visit_id=visit_id;raise exception 'TEST attachment mutated';
 exception when object_not_in_prerequisite_state then null;end;
end$$;
rollback;
select 'Clinic result attach: admin-only, clinic-scoped, system stage, idempotent, audited correction, manual fallback passed.';
