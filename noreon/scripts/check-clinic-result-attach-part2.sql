-- Fictional Q8 part 2 lifecycle; all fixtures roll back.
-- Database switch, clinic-admin narrow list and attach, audited admin original
-- open, and detach with supported re-issue or retraction each assert below.
\set ON_ERROR_STOP on
begin;
create function pg_temp.p2_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'TEST %',label;end if;
end$$;
-- c7b0: admin 01, doctor 02, nurse 03, member 04, other member 05, clinic user 06 (clinic 07), other clinic user 09 (clinic 08).
insert into auth.users(id,phone,phone_confirmed_at)select ('c7b00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,case when n in(4,5)then '37400078000'||n end,case when n in(4,5)then now()end from generate_series(1,9)n where n not in(7,8);
insert into auth.sessions(id,user_id,created_at,updated_at)select ('c7b00000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid,('c7b00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,now(),now()from generate_series(1,9)n where n not in(7,8);
insert into public.workspace_clinics(id,name)values('c7b00000-0000-4000-8000-000000000007','Synthetic part2 clinic'),('c7b00000-0000-4000-8000-000000000008','Synthetic part2 other clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('c7b00000-0000-4000-8000-000000000001','admin','Synthetic p2 admin',null),
 ('c7b00000-0000-4000-8000-000000000002','doctor','Synthetic p2 doctor','c7b00000-0000-4000-8000-000000000007'),
 ('c7b00000-0000-4000-8000-000000000003','nurse','Synthetic p2 nurse','c7b00000-0000-4000-8000-000000000007');
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name)values
 ('c7b00000-0000-4000-8000-000000000006','c7b00000-0000-4000-8000-000000000007','Synthetic clinic admin'),
 ('c7b00000-0000-4000-8000-000000000009','c7b00000-0000-4000-8000-000000000008','Synthetic other clinic admin');
insert into public.profiles(id,display_name)values('c7b00000-0000-4000-8000-000000000004','Synthetic p2 member'),('c7b00000-0000-4000-8000-000000000005','Synthetic p2 other member')
 on conflict(id)do update set display_name=excluded.display_name;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('c7b00000-0000-4000-8000-000000000004','c7b00000-0000-4000-8000-000000000002','c7b00000-0000-4000-8000-000000000003'),
 ('c7b00000-0000-4000-8000-000000000005','c7b00000-0000-4000-8000-000000000002',null);
set local session_replication_role=replica;
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id,appointment_id,accepted_revision,booking_context,created_at)values
 ('c7b00000-0000-4000-8000-000000000021','c7b00000-0000-4000-8000-000000000004','c7b00000-0000-4000-8000-000000000003','Synthetic p2 nurse','nurse','c7b00000-0000-4000-8000-000000000007','c7b00000-0000-4000-8000-000000000090',1,'{"version":"booking-visit-context-v1"}',now()-interval '3 hours'),
 ('c7b00000-0000-4000-8000-000000000022','c7b00000-0000-4000-8000-000000000005','c7b00000-0000-4000-8000-000000000003','Synthetic p2 nurse','nurse','c7b00000-0000-4000-8000-000000000008','c7b00000-0000-4000-8000-000000000091',1,'{"version":"booking-visit-context-v1"}',now()-interval '3 hours'),
 ('c7b00000-0000-4000-8000-000000000023','c7b00000-0000-4000-8000-000000000004','c7b00000-0000-4000-8000-000000000003','Synthetic p2 nurse','nurse','c7b00000-0000-4000-8000-000000000007','c7b00000-0000-4000-8000-000000000092',1,'{"version":"booking-visit-context-v1"}',now()-interval '3 hours');
-- Booked clinic and email reference come from the accepted version's notice (CF-1).
insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,copy_revision,sender_email,clinic_email,copy_email,template_version,subject,text_content,envelope_hash,state)
select gen_random_uuid(),v.appointment_id,1,gen_random_uuid(),gen_random_uuid(),v.clinic_id,1,1,'sender@example.invalid','clinic@example.invalid','copy@example.invalid','synthetic','Synthetic','Synthetic',repeat('c',64),'accepted'
from public.patient_care_visits v where v.id::text like 'c7b0%';
insert into public.booking_appointment_versions(appointment_id,revision,program_id,proposed_arrangement,notice_id,actor_id)
select n.appointment_id,1,n.program_id,'{}',n.id,'c7b00000-0000-4000-8000-000000000003' from public.booking_scheduling_notices n join public.patient_care_visits v on v.appointment_id=n.appointment_id where v.id::text like 'c7b0%';
insert into public.patient_care_visit_entries(id,user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id)
select ('c7b00000-0000-4000-8000-0000000000'||x.n)::uuid,x.u::uuid,x.v::uuid,'c7b00000-0000-4000-8000-000000000060',x.pos,
 jsonb_build_object('kind','collection','observedAt','2026-10-16T08:00:00+04:00','appointmentId','c7b00000-0000-4000-8000-000000000090','acceptedRevision',1,'testId','cbc','outcome','collected'),
 '2026-10-16T08:00:00+04:00','2026-10-16T04:00:00Z','c7b00000-0000-4000-8000-000000000003','Synthetic p2 nurse','nurse','c7b00000-0000-4000-8000-000000000007'
from(values('31','c7b00000-0000-4000-8000-000000000004','c7b00000-0000-4000-8000-000000000021',1),('34','c7b00000-0000-4000-8000-000000000005','c7b00000-0000-4000-8000-000000000022',1),('35','c7b00000-0000-4000-8000-000000000004','c7b00000-0000-4000-8000-000000000023',2))x(n,u,v,pos);
insert into public.patient_care_lab_stages(user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id)
select x.u::uuid,('c7b00000-0000-4000-8000-0000000000'||x.n)::uuid,'at-lab',gen_random_uuid(),now()-interval '2 hours','c7b00000-0000-4000-8000-000000000003','Synthetic p2 nurse','nurse',x.c::uuid
from(values('31','c7b00000-0000-4000-8000-000000000004','c7b00000-0000-4000-8000-000000000007'),('34','c7b00000-0000-4000-8000-000000000005','c7b00000-0000-4000-8000-000000000008'),('35','c7b00000-0000-4000-8000-000000000004','c7b00000-0000-4000-8000-000000000007'))x(n,u,c);
insert into public.clinic_batches(id,clinic_id,name,uploader_id,uploader_name)values
 ('c7b00000-0000-4000-8000-000000000041','c7b00000-0000-4000-8000-000000000007','Synthetic p2 batch','c7b00000-0000-4000-8000-000000000006','Synthetic clinic admin'),
 ('c7b00000-0000-4000-8000-000000000042','c7b00000-0000-4000-8000-000000000008','Synthetic p2 other batch','c7b00000-0000-4000-8000-000000000009','Synthetic other clinic admin');
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state,created_at)
select ('c7b00000-0000-4000-8000-0000000000'||x.n)::uuid,x.b::uuid,gen_random_uuid(),gen_random_uuid(),'c7b00000-0000-4000-8000-000000000006',gen_random_uuid(),'[]',now(),gen_random_uuid(),1,gen_random_uuid(),
 'synthetic-p2-'||x.n||'.pdf','application/pdf',10,repeat('b',64),'synthetic-p2/'||x.n,('c7b00000-0000-4000-8000-0000000002'||x.n)::uuid,10,repeat('b',64),'stored',now()-interval '1 hour'
from(values('51','c7b00000-0000-4000-8000-000000000041'),('52','c7b00000-0000-4000-8000-000000000041'),('53','c7b00000-0000-4000-8000-000000000042'))x(n,b);
insert into storage.objects(id,bucket_id,name,metadata)values('c7b00000-0000-4000-8000-000000000251','clinic-originals','synthetic-p2/51','{"size":10}');
set local session_replication_role=origin;
update public.clinic_portal_capabilities set result_attach_enabled=false where singleton;

create function pg_temp.as_user(n int) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','c7b00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated','exp',4102444800,'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id','c7b00000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::text,true)
$$;
create function pg_temp.admin_cmd(sub text,file text,member text,visit text) returns jsonb language sql as $$
 select jsonb_build_object('version','clinic-result-attach-v1','submissionId','c7b00000-0000-4000-8000-0000000007'||sub,'fileId','c7b00000-0000-4000-8000-0000000000'||file,'memberId','c7b00000-0000-4000-8000-0000000000'||member,'visitId','c7b00000-0000-4000-8000-0000000000'||visit)
$$;
create function pg_temp.clinic_cmd(sub text,file text,visit text) returns jsonb language sql as $$
 select jsonb_build_object('version','clinic-result-attach-v1','submissionId','c7b00000-0000-4000-8000-0000000008'||sub,'fileId','c7b00000-0000-4000-8000-0000000000'||file,'visitId','c7b00000-0000-4000-8000-0000000000'||visit)
$$;
create function pg_temp.detach_cmd(sub text,file text) returns jsonb language sql as $$
 select jsonb_build_object('version','clinic-result-detach-v1','submissionId','c7b00000-0000-4000-8000-0000000009'||sub,'fileId','c7b00000-0000-4000-8000-0000000000'||file,'reason','Synthetic: wrong member')
$$;
create temp table p2(label text primary key,result jsonb);
grant all on p2 to authenticated;
grant execute on function pg_temp.as_user(int),pg_temp.admin_cmd(text,text,text,text),pg_temp.clinic_cmd(text,text,text),pg_temp.detach_cmd(text,text) to authenticated;
select pg_temp.p2_assert(not has_function_privilege('anon','public.clinic_portal_result_visits(uuid)','execute')
 and not has_function_privilege('anon','public.clinic_portal_result_attach(uuid,jsonb)','execute')
 and not has_function_privilege('anon','public.clinic_result_detach_command(jsonb)','execute')
 and not has_function_privilege('anon','public.clinic_admin_original_open(uuid)','execute'),'Anonymous callers reach none of the new RPCs');

set local role authenticated;
-- A. Switch off: everything refuses.
select pg_temp.as_user(1);
insert into p2 values('off-admin',public.clinic_result_attach_command(pg_temp.admin_cmd('01','51','04','21')));
insert into p2 values('off-detach',public.clinic_result_detach_command(pg_temp.detach_cmd('01','51')));
select pg_temp.as_user(6);
insert into p2 values('off-visits',public.clinic_portal_result_visits('c7b00000-0000-4000-8000-000000000007'));
insert into p2 values('off-clinic',public.clinic_portal_result_attach('c7b00000-0000-4000-8000-000000000007',pg_temp.clinic_cmd('01','51','21')));
reset role;
update public.clinic_portal_capabilities set result_attach_enabled=true where singleton;
insert into public.clinic_portal_capabilities(singleton,result_attach_enabled)select true,true where not exists(select 1 from public.clinic_portal_capabilities);
set local role authenticated;
-- B/C/D. Clinic admin: narrow list, own uploads and visits, no moves.
select pg_temp.as_user(6);
insert into p2 values('visits',public.clinic_portal_result_visits('c7b00000-0000-4000-8000-000000000007'));
insert into p2 values('clinic-other-file',public.clinic_portal_result_attach('c7b00000-0000-4000-8000-000000000007',pg_temp.clinic_cmd('02','53','21')));
insert into p2 values('clinic-other-visit',public.clinic_portal_result_attach('c7b00000-0000-4000-8000-000000000007',pg_temp.clinic_cmd('03','51','22')));
insert into p2 values('clinic-attach',public.clinic_portal_result_attach('c7b00000-0000-4000-8000-000000000007',pg_temp.clinic_cmd('10','51','21')));
insert into p2 values('clinic-resend',public.clinic_portal_result_attach('c7b00000-0000-4000-8000-000000000007',pg_temp.clinic_cmd('10','51','21')));
insert into p2 values('clinic-move',public.clinic_portal_result_attach('c7b00000-0000-4000-8000-000000000007',pg_temp.clinic_cmd('11','51','23')));
insert into p2 values('clinic-wrong-clinic',public.clinic_portal_result_attach('c7b00000-0000-4000-8000-000000000008',pg_temp.clinic_cmd('12','53','22')));
select pg_temp.as_user(3);
insert into p2 values('nurse-clinic',public.clinic_portal_result_attach('c7b00000-0000-4000-8000-000000000007',pg_temp.clinic_cmd('13','52','21')));
insert into p2 values('nurse-detach',public.clinic_result_detach_command(pg_temp.detach_cmd('02','51')));
-- E/F/G/H. Noreon admin: second upload supports the visit; detach re-issues, then retracts.
select pg_temp.as_user(1);
insert into p2 values('admin-second',public.clinic_result_attach_command(pg_temp.admin_cmd('20','52','04','21')));
insert into p2 values('detach-first',public.clinic_result_detach_command(pg_temp.detach_cmd('10','51')));
insert into p2 values('detach-resend',public.clinic_result_detach_command(pg_temp.detach_cmd('10','51')));
insert into p2 values('detach-second',public.clinic_result_detach_command(pg_temp.detach_cmd('11','52')));
insert into p2 values('detach-unattached',public.clinic_result_detach_command(pg_temp.detach_cmd('12','51')));
insert into p2 values('open',public.clinic_admin_original_open('c7b00000-0000-4000-8000-000000000051'));
select pg_temp.as_user(6);
insert into p2 values('clinic-relink',public.clinic_portal_result_attach('c7b00000-0000-4000-8000-000000000007',pg_temp.clinic_cmd('14','51','21')));
select pg_temp.as_user(4);
insert into p2 values('member-read',public.patient_member_lab_stages());
reset role;

select pg_temp.p2_assert((select bool_and(result->>'status'='disabled') from p2 where label in('off-admin','off-detach','off-clinic')),'Database switch off: attach and detach refuse');
select pg_temp.p2_assert((select result->>'enabled'='false' and result->'visits'='[]'::jsonb from p2 where label='off-visits'),'Database switch off: clinic list is empty');
select pg_temp.p2_assert((select jsonb_array_length(result->'visits')=2 and(select bool_and(v-array['visitId','memberName','visitedAt','reference','ambiguous']='{}'::jsonb)from jsonb_array_elements(result->'visits')v) from p2 where label='visits'),'Clinic list holds only its open visits: name, visit date, email reference and ambiguity flag');
select pg_temp.p2_assert((select not(result::text like '%c7b00000-0000-4000-8000-000000000004%') from p2 where label='visits'),'Clinic list carries no member id');
select pg_temp.p2_assert((select bool_and(result->>'status'='invalid') from p2 where label in('clinic-other-file','clinic-other-visit')),'Clinic cannot attach another clinic''s upload or visit');
select pg_temp.p2_assert((select result->>'status'='saved' and (result->>'moved')::int=1 and not(result?'attachmentId') from p2 where label='clinic-attach'),'Clinic attach moves the sample and returns counts only');
select pg_temp.p2_assert((select result->>'status'='saved' and (result->>'moved')::int=0 from p2 where label='clinic-resend'),'Clinic resend is idempotent');
select pg_temp.p2_assert((select result->>'status'='stale' from p2 where label='clinic-move'),'A clinic admin cannot move an attached upload');
select pg_temp.p2_assert((select bool_and(result->>'status'='access') from p2 where label in('clinic-wrong-clinic','nurse-clinic','nurse-detach')),'Clinic membership and admin role are required');
select pg_temp.p2_assert((select count(*)=1 from public.clinic_result_attachments where actor_kind='clinic-admin' and file_id='c7b00000-0000-4000-8000-000000000051'),'Clinic attach is recorded as clinic-admin');
select pg_temp.p2_assert((select result->>'status'='saved' and (result->>'moved')::int=0 and (result->>'alreadyReceived')::int=1 from p2 where label='admin-second'),'A second upload for the same visit changes nothing');
select pg_temp.p2_assert((select result->>'status'='saved' and (result->>'retracted')::int=0 from p2 where label='detach-first'),'Detaching a supported upload retracts nothing for the member');
select pg_temp.p2_assert((select result->>'status'='saved' and result->>'replayed'='true' from p2 where label='detach-resend'),'Detach resend replays');
select pg_temp.p2_assert((select result->>'status'='saved' and (result->>'retracted')::int=1 from p2 where label='detach-second'),'Detaching the last supporting upload retracts the result');
select pg_temp.p2_assert((select result->>'status'='stale' from p2 where label='detach-unattached'),'Detaching an unattached upload is stale');
select pg_temp.p2_assert((select (public._patient_lab_active_result('c7b00000-0000-4000-8000-000000000031')).id is null),'No active result remains after both detaches');
select pg_temp.p2_assert((select count(*)=2 from public.patient_care_lab_stages where collection_entry_id='c7b00000-0000-4000-8000-000000000031' and stage='results-retracted'),'Each retraction is a new row');
select pg_temp.p2_assert((select result#>'{samples,0,stages}'=jsonb_build_array(jsonb_build_object('stage','at-lab','occurredAt',(select to_jsonb(occurred_at) from public.patient_care_lab_stages where collection_entry_id='c7b00000-0000-4000-8000-000000000031' and stage='at-lab'))) from p2 where label='member-read'),'Member sees the sample back at the lab');
select pg_temp.p2_assert((select result->>'objectKey'='synthetic-p2/51' from p2 where label='open'),'Admin open returns the stored location');
select pg_temp.p2_assert((select array_agg(kind order by id)=array['result-attached','result-attached','result-detached','result-detached','admin-original-opened'] from public.clinic_portal_audit where clinic_id='c7b00000-0000-4000-8000-000000000007'),'Attach, detach and original open are audited in order');
select pg_temp.p2_assert((select public._clinic_portal_file_json(f)#>>'{association,status}'='review_required' from public.clinic_batch_files f where id='c7b00000-0000-4000-8000-000000000051'),'A detached upload reads as needing review, not associated');
select pg_temp.p2_assert((select result->>'status'='stale' from p2 where label='clinic-relink'),'The clinic cannot re-link an upload Noreon detached');
-- A superseded row never becomes current again after a detach (review F3).
select pg_temp.p2_assert((public._clinic_result_current('c7b00000-0000-4000-8000-000000000051')).id is null,'No fallback to an older attachment row');

do $$begin
 perform pg_temp.as_user(3);
 set local role authenticated;
 begin perform public.clinic_admin_original_open('c7b00000-0000-4000-8000-000000000051');raise exception 'TEST nurse opened a clinic original';
 exception when insufficient_privilege then null;end;
 perform pg_temp.as_user(9);
 begin perform public.clinic_portal_result_visits('c7b00000-0000-4000-8000-000000000007');raise exception 'TEST other clinic listed visits';
 exception when insufficient_privilege then null;end;
 reset role;
 begin update public.clinic_result_detachments set reason='x';raise exception 'TEST detachment mutated';
 exception when object_not_in_prerequisite_state then null;end;
end$$;
rollback;
select 'Clinic result attach part 2: switch, clinic list and attach, supported detach, retraction and audited open passed.';
