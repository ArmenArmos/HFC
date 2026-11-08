-- WP-11 (quality review items 13, 32, 46): duplicate PDFs refused by the database whatever page the
-- browser read; retired upload attempts listed for cleanup and completed; the manual-linking member
-- list beyond 300 members. Fictional data; rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean,label text) returns void language plpgsql as $$begin if cond is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.id(n text) returns uuid language sql immutable as $$select('c1d00000-0000-4000-8000-'||lpad(n,12,'0'))::uuid$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.id(text) to authenticated,service_role;
-- Users 1 (clinic A), 2 (clinic B). Clinics A a1, B b1. Batches A ba1, B bb1.
insert into auth.users(id)values(pg_temp.id('1')),(pg_temp.id('2'));
insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.id('11'),pg_temp.id('1'),now(),now()),(pg_temp.id('12'),pg_temp.id('2'),now(),now());
insert into public.workspace_clinics(id,name)values(pg_temp.id('a1'),'Fictional clinic A'),(pg_temp.id('b1'),'Fictional clinic B');
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name)values(pg_temp.id('1'),pg_temp.id('a1'),'Fictional uploader A'),(pg_temp.id('2'),pg_temp.id('b1'),'Fictional uploader B');
insert into public.clinic_portal_capabilities(singleton,storage_enabled,result_attach_enabled)values(true,true,true)on conflict(singleton)do update set storage_enabled=true,result_attach_enabled=true;
create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'session_id',pg_temp.id('1'||n),'exp',4102444800,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true)
$$;
-- The batch revision, read past RLS (the browser gets it from clinic_batch_read).
create function pg_temp.rev(batch text) returns bigint language sql security definer as $$select revision from public.clinic_batches where id=pg_temp.id(batch)$$;
grant execute on function pg_temp.rev(text) to authenticated;
create function pg_temp.reserve(batch text,clinic text,n text,fingerprint text) returns jsonb language sql as $$
 select public.clinic_batch_command(jsonb_build_object('version','clinic-command-v1','op','reserve-upload','submissionId',pg_temp.id('5'||n),'clinicId',pg_temp.id(clinic),'batchId',pg_temp.id(batch),
  'revision',pg_temp.rev(batch),'logicalKey',pg_temp.id('6'||n),'fileId',pg_temp.id('7'||n),'attemptId',pg_temp.id('8'||n),
  'name','fictional-'||n||'.pdf','mime','application/pdf','declaredSizeBytes',10,'fingerprint',fingerprint))
$$;
grant execute on function pg_temp.as_user(text),pg_temp.reserve(text,text,text,text) to authenticated,service_role;
-- Mark a reserved file stored, as clinic_upload_finalize would.
create function pg_temp.store(n text) returns void language sql as $$
 update public.clinic_batch_files set state='stored',execution='ended',object_id=gen_random_uuid(),measured_size=declared_size,sha256=expected_sha256 where id=pg_temp.id('7'||n)
$$;

-- 1. Batches and a first stored PDF.
select pg_temp.as_user('1');set local role authenticated;
select pg_temp.ok(public.clinic_batch_command(jsonb_build_object('version','clinic-command-v1','op','create-batch','submissionId',pg_temp.id('31'),'clinicId',pg_temp.id('a1'),'batchId',pg_temp.id('ba1'),'name','Fictional batch A'))->>'status'='committed','Batch A created');
select pg_temp.ok(pg_temp.reserve('ba1','a1','001',repeat('a',64))->>'status'='committed','First PDF reserved');
reset role;select pg_temp.store('001');

-- 2. Item 13: the same PDF again is refused as a duplicate naming the stored file; nothing is written.
select pg_temp.as_user('1');set local role authenticated;
create temp table rev as select pg_temp.rev('ba1') revision;
select pg_temp.ok((select r->>'status'='rejected'and r->>'reason'='duplicate'and r->>'fileId'=pg_temp.id('7001')::text and r->>'noWrite'='true'from(select pg_temp.reserve('ba1','a1','002',repeat('a',64))r)x),'Same PDF refused as a duplicate of the stored file');
reset role;
select pg_temp.ok(not exists(select 1 from public.clinic_batch_files where id=pg_temp.id('7002')),'No file row for the refused duplicate');
select pg_temp.ok(not exists(select 1 from public.clinic_batch_commands where submission_id=pg_temp.id('5002')),'No command recorded for the refused duplicate');
select pg_temp.ok((select revision from public.clinic_batches where id=pg_temp.id('ba1'))=(select revision from rev),'Batch revision unchanged');
-- A different PDF is accepted; a reserved (not stored) copy does not block the same PDF.
select pg_temp.as_user('1');set local role authenticated;
select pg_temp.ok(pg_temp.reserve('ba1','a1','003',repeat('b',64))->>'status'='committed','A different PDF is reserved');
select pg_temp.ok(pg_temp.reserve('ba1','a1','004',repeat('b',64))->>'status'='committed','A copy of a PDF that is only reserved is not refused');
reset role;

-- 3. Item 13: the stored copy sits beyond the first page of the batch (ordered by file id): still refused.
set local session_replication_role=replica;
insert into public.clinic_batch_commands(actor_id,submission_id,session_id,clinic_id,batch_id,payload,state,result)
 select pg_temp.id('1'),pg_temp.id('9'||lpad(n::text,3,'0')),pg_temp.id('11'),pg_temp.id('a1'),pg_temp.id('ba1'),'{}','committed','{}'from generate_series(100,159)n;
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state,execution)
 select pg_temp.id('7'||lpad(n::text,3,'0')),pg_temp.id('ba1'),gen_random_uuid(),gen_random_uuid(),pg_temp.id('1'),pg_temp.id('11'),'[]',now(),gen_random_uuid(),1,pg_temp.id('9'||lpad(n::text,3,'0')),
  'fictional-'||n||'.pdf','application/pdf',10,lpad(to_hex(n),64,'c'),'fictional/'||n,gen_random_uuid(),10,lpad(to_hex(n),64,'c'),'stored','ended'from generate_series(100,159)n;
set local session_replication_role=origin;
select pg_temp.as_user('1');set local role authenticated;
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.clinic_batch_read(pg_temp.id('a1'),pg_temp.id('ba1'),null,50)->'files')f where f->>'id'=pg_temp.id('7159')::text),'The last stored file is not on the first page');
select pg_temp.ok(pg_temp.reserve('ba1','a1','005',lpad(to_hex(159),64,'c'))->>'fileId'=pg_temp.id('7159')::text,'A duplicate beyond the first page is still refused');
reset role;
-- Duplicates are per batch: the same PDF in another clinic's batch is accepted there.
select pg_temp.as_user('2');set local role authenticated;
select pg_temp.ok(public.clinic_batch_command(jsonb_build_object('version','clinic-command-v1','op','create-batch','submissionId',pg_temp.id('32'),'clinicId',pg_temp.id('b1'),'batchId',pg_temp.id('bb1'),'name','Fictional batch B'))->>'status'='committed','Batch B created');
select pg_temp.ok(pg_temp.reserve('bb1','b1','006',repeat('a',64))->>'status'='committed','Same PDF in another batch is accepted');
-- Another clinic cannot learn a file id by sending a fingerprint to clinic A's batch.
select pg_temp.ok(pg_temp.reserve('ba1','a1','007',repeat('a',64))->>'status'='access','Another clinic gets no duplicate answer for clinic A');
reset role;

-- 4. Item 32: a retired reservation is listed for cleanup (service only), completed once its original is gone.
create temp table pay as select payload from public.clinic_batch_commands where submission_id=pg_temp.id('5004');
grant select on pay to authenticated;
select pg_temp.as_user('1');set local role authenticated;
select pg_temp.ok(public.clinic_batch_refresh(pg_temp.id('a1'),pg_temp.id('ba1'),payload)#>>'{receipt,status}'='retired','Reservation 004 retired')from pay;
do $$begin perform public.clinic_upload_cleanup_pending(10);raise exception 'TEST clinic user listed cleanup';exception when insufficient_privilege then null;end$$;
reset role;
select pg_temp.ok((select state='retired'and cleanup='pending'from public.clinic_batch_files where id=pg_temp.id('7004')),'Retired with cleanup pending');
-- An attempt that is still uploading stays out of the list.
update public.clinic_batch_files set state='retired',cleanup='pending',execution='active'where id=pg_temp.id('7003');
select set_config('test.key7004',(select object_key from public.clinic_batch_files where id=pg_temp.id('7004')),true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
create temp table pending as select public.clinic_upload_cleanup_pending(100) list;
select pg_temp.ok((select jsonb_array_length(list)=1 and list->0->>'fileId'=pg_temp.id('7004')::text and list->0->>'bucket'='clinic-originals'
 and list->0->>'objectKey'=current_setting('test.key7004')from pending),'Only the retired, inactive attempt is listed, with its object key');
do $$begin perform public.clinic_upload_cleanup_pending(0);raise exception 'TEST zero limit accepted';exception when invalid_parameter_value then null;end$$;
reset role;
-- The guard stays: an original still in storage blocks completion.
insert into storage.objects(id,bucket_id,name,metadata)select pg_temp.id('e1'),'clinic-originals',object_key,'{"size":10}'from public.clinic_batch_files where id=pg_temp.id('7004');
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
do $$begin perform public.clinic_upload_cleanup(pg_temp.id('7004'));raise exception 'TEST cleanup completed with the original present';exception when object_not_in_prerequisite_state then null;end$$;
reset role;
set local storage.allow_delete_query='true';
delete from storage.objects where id=pg_temp.id('e1');
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select pg_temp.ok(public.clinic_upload_cleanup(pg_temp.id('7004'))->>'status'='complete','Cleanup completes once the original is gone');
select pg_temp.ok(jsonb_array_length(public.clinic_upload_cleanup_pending(100))=0,'Nothing left to clean');
reset role;
select pg_temp.ok((select cleanup='complete'from public.clinic_batch_files where id=pg_temp.id('7004')),'Cleanup recorded');
-- Review WP11-R1: attempt 003 was retired while its PUT was active. Once the transport proves the write
-- and ends the execution, it is listed and cleaned like any other.
insert into storage.objects(id,bucket_id,name,metadata)select pg_temp.id('e3'),'clinic-originals',object_key,'{"size":10}'from public.clinic_batch_files where id=pg_temp.id('7003');
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select pg_temp.ok(public.clinic_upload_execution_end(pg_temp.id('7003'),pg_temp.id('8003'),jsonb_build_object('kind','storage_completed','objectId',pg_temp.id('e3')))->>'status'='ended','Proven write ends the retired attempt');
select pg_temp.ok((select list->0->>'fileId'=pg_temp.id('7003')::text from(select public.clinic_upload_cleanup_pending(100)list)x),'Then it is listed for cleanup');
reset role;
delete from storage.objects where id=pg_temp.id('e3');
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select pg_temp.ok(public.clinic_upload_cleanup(pg_temp.id('7003'))->>'status'='complete','And cleaned once the original is removed');
reset role;

-- 5. Item 46: the manual-linking list holds more than 300 members and says when it is capped.
insert into auth.users(id)select pg_temp.id('2'||lpad(n::text,5,'0'))from generate_series(1,1001)n;
update public.profiles set display_name='Fictional member '||right(id::text,5)where id::text like 'c1d00000-0000-4000-8000-0000002%';
set local session_replication_role=replica;
insert into public.patient_clinical_cases(user_id)select pg_temp.id('2'||lpad(n::text,5,'0'))from generate_series(1,1001)n;
insert into public.booking_appointments(id,member_id,program_id,requirements_token,revision,status,current_arrangement,proposed_arrangement,current_reservation_id,proposed_reservation_id,notice_id)
 select pg_temp.id('3'||lpad(n::text,5,'0')),pg_temp.id('2'||lpad(n::text,5,'0')),gen_random_uuid(),'t',1,'confirmed',
  jsonb_build_object('clinicId',pg_temp.id('a1'),'startsAt',now()-make_interval(mins=>n)),jsonb_build_object('clinicId',pg_temp.id('a1')),gen_random_uuid(),gen_random_uuid(),pg_temp.id('4'||lpad(n::text,5,'0'))
 from generate_series(1,1001)n;
insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,state,channel)
 select pg_temp.id('4'||lpad(n::text,5,'0')),pg_temp.id('3'||lpad(n::text,5,'0')),1,gen_random_uuid(),gen_random_uuid(),pg_temp.id('a1'),1,'accepted','portal'from generate_series(1,1001)n;
set local session_replication_role=origin;
select pg_temp.as_user('1');set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.clinic_portal_lab_results(pg_temp.id('a1'),pg_temp.id('ba1'))->'members')=300,'The released list stays at 300 (its schema)');
create temp table lm as select public.clinic_portal_lab_members(pg_temp.id('a1')) r;
select pg_temp.ok((select r->>'version'='clinic-lab-members-v1'and r->>'enabled'='true'and jsonb_array_length(r->'members')=1000 and r->>'capped'='true'from lm),'1000 of 1001 members, capped');
-- The oldest booking (member 01001) is the one left out; the member at 301 is now listed.
select pg_temp.ok((select not exists(select 1 from jsonb_array_elements(r->'members')m where m->>'memberId'=pg_temp.id('201001')::text)
 and exists(select 1 from jsonb_array_elements(r->'members')m where m->>'memberId'=pg_temp.id('200301')::text)from lm),'Newest bookings first; member 301 can now be picked');
reset role;
set local session_replication_role=replica;
update public.booking_appointments set status='cancelled'where id=pg_temp.id('301001');
set local session_replication_role=origin;
select pg_temp.as_user('1');set local role authenticated;
select pg_temp.ok((select r->>'capped'='false'and jsonb_array_length(r->'members')=1000 from(select public.clinic_portal_lab_members(pg_temp.id('a1'))r)x),'Exactly 1000: not capped');
-- Another clinic sees none of clinic A's members; a member cannot call it.
select pg_temp.as_user('2');
select pg_temp.ok(jsonb_array_length(public.clinic_portal_lab_members(pg_temp.id('b1'))->'members')=0,'Clinic B lists none of clinic A''s members');
do $$begin perform public.clinic_portal_lab_members(pg_temp.id('a1'));raise exception 'TEST other clinic read clinic A members';exception when insufficient_privilege then null;end$$;
reset role;
update public.clinic_portal_capabilities set result_attach_enabled=false where singleton;
select pg_temp.as_user('1');set local role authenticated;
select pg_temp.ok((select r->>'enabled'='false'and jsonb_array_length(r->'members')=0 from(select public.clinic_portal_lab_members(pg_temp.id('a1'))r)x),'Switched off: no members');
reset role;
rollback;
