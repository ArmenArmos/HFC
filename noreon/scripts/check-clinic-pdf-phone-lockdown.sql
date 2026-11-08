-- Clinic PDF/phone lockdown regression: fictional fixtures, no services, all changes roll back.
-- Run after a clean migration replay with psql -f scripts/check-clinic-pdf-phone-lockdown.sql.
\set ON_ERROR_STOP on
begin;
create function pg_temp.cm_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.cm_id(n text) returns uuid language sql immutable as $$select('c0f50000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.cm_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cm_id(n),'role','authenticated','exp',4102444800,
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',('c0f50000-0000-4000-8000-0000000001'||n)::uuid)::text,true),
  set_config('request.jwt.claim.sub',pg_temp.cm_id(n)::text,true)
$$;
create function pg_temp.cm_sqlstate(q text) returns text language plpgsql as $$begin
 execute q;return 'ran';exception when others then return sqlstate;
end$$;
create function pg_temp.cm_keys(j jsonb,keys text[]) returns boolean language sql immutable as $$
 select jsonb_typeof(j)='object'and j?&keys and j-keys='{}'::jsonb
$$;
create function pg_temp.cm_member(j jsonb) returns boolean language sql immutable as $$
 select j?'phone'and j?'birthDate'and j->'phone'='null'::jsonb and j->'birthDate'='null'::jsonb
$$;
-- All full birth dates are masked at presentation boundaries; matching stays private.
create function pg_temp.cm_compare(j jsonb) returns boolean language sql immutable as $$
 select j#>'{member,birthDate}'='null'::jsonb
  and(not(j->'member'?'current')or j#>'{member,current,birthDate}'='null'::jsonb)
$$;
grant execute on function pg_temp.cm_assert(boolean,text),pg_temp.cm_id(text),pg_temp.cm_user(text),
 pg_temp.cm_sqlstate(text),pg_temp.cm_keys(jsonb,text[]),pg_temp.cm_member(jsonb),pg_temp.cm_compare(jsonb) to authenticated,anon,service_role;

-- Clinics 0a/0b; portal A admin 0c, A staff 0d, B admin 0e; workspace admin aa, nurse e1.
-- Members 01 (A, phone+DOB), 02 (B only), 03 (assigned to A but no booking), 04 (A, no phone/DOB).
insert into auth.users(id,phone,phone_confirmed_at)
 select pg_temp.cm_id(n),case when n in('01','02','03')then '3749908'||n||'77'end,
 case when n in('01','02','03')then now()end from unnest(array['01','02','03','04','0c','0d','0e','d1','e1','aa'])n;
insert into auth.sessions(id,user_id,created_at,updated_at)
 select('c0f50000-0000-4000-8000-0000000001'||n)::uuid,pg_temp.cm_id(n),now(),now()from unnest(array['0c','0d','0e','aa'])n;
update public.profiles set display_name='Fictional Masking '||right(id::text,2),birth_date='1975-04-05',biological_sex='female'
 where id in(pg_temp.cm_id('01'),pg_temp.cm_id('02'),pg_temp.cm_id('03'));
update public.profiles set display_name='Fictional Missing Identity',birth_date=null where id=pg_temp.cm_id('04');
insert into public.workspace_clinics(id,name,address)values(pg_temp.cm_id('0a'),'Fictional clinic A','1 Fictional Street'),(pg_temp.cm_id('0b'),'Fictional clinic B','2 Fictional Street');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.cm_id('d1'),'doctor','Fictional doctor A',pg_temp.cm_id('0a')),(pg_temp.cm_id('e1'),'nurse','Fictional nurse A',pg_temp.cm_id('0a')),
 (pg_temp.cm_id('aa'),'admin','Fictional workspace admin',null);
insert into public.clinic_portal_memberships(id,user_id,clinic_id,display_name,role)values
 (pg_temp.cm_id('f1'),pg_temp.cm_id('0c'),pg_temp.cm_id('0a'),'Fictional A admin','admin'),
 (pg_temp.cm_id('f2'),pg_temp.cm_id('0d'),pg_temp.cm_id('0a'),'Fictional A staff','staff'),
 (pg_temp.cm_id('f3'),pg_temp.cm_id('0e'),pg_temp.cm_id('0b'),'Fictional B admin','admin');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values
 (pg_temp.cm_id('01'),pg_temp.cm_id('d1')),(pg_temp.cm_id('02'),null),(pg_temp.cm_id('03'),pg_temp.cm_id('d1')),(pg_temp.cm_id('04'),null);
insert into public.clinic_portal_capabilities(singleton,result_attach_enabled,clinic_admin_full_access)values(true,true,true)
 on conflict(singleton)do update set result_attach_enabled=true,clinic_admin_full_access=true;
update public.clinic_scheduling_capabilities set enabled=true where singleton;
update public.lab_ai_capabilities set enabled=true where singleton;

-- Bookings: future A, past A, cancelled future A, B-only, no-identity A, same-day expired A.
-- Bypass booking side-effect triggers, as the established clinic checks do.
set local session_replication_role=replica;
create function pg_temp.cm_book(n text,mm text,c text,starts timestamptz,st text default 'confirmed')returns void language plpgsql as $$
declare a uuid:=pg_temp.cm_id('a'||n);nt uuid:=pg_temp.cm_id('b'||n);r uuid:=pg_temp.cm_id('c'||n);s uuid:=pg_temp.cm_id('e'||n);
 arr jsonb:=jsonb_build_object('clinicId',pg_temp.cm_id(c),'startsAt',starts,'endsAt',starts+interval '30 minutes','coveredTestIds',jsonb_build_array('lipid-panel'));
begin
 insert into public.booking_program_seals(id,member_id,actor_id,source_token,requirements_token,engine_version,program)
 values(s,pg_temp.cm_id(mm),pg_temp.cm_id(mm),'t','t','synthetic',jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id','lipid-panel','title','Lipid profile','method','lab'))));
 insert into public.booking_appointments(id,member_id,program_id,requirements_token,revision,status,current_arrangement,proposed_arrangement,current_reservation_id,proposed_reservation_id,notice_id)
 values(a,pg_temp.cm_id(mm),s,'t'||n,1,st,case when st='confirmed'then arr end,arr,r,r,nt);
 insert into public.booking_manual_reservations(id,appointment_id,capacity_key,offer_id,offer_version,member_id,valid_until)
 values(r,a,'synthetic',gen_random_uuid(),'1',pg_temp.cm_id(mm),now()+interval '1 year');
 insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,state,channel,purpose)
 values(nt,a,1,s,r,pg_temp.cm_id(c),1,'accepted','portal',case when st='cancelled'then 'cancellation'else 'booking'end);
 insert into public.booking_appointment_versions(appointment_id,revision,program_id,proposed_arrangement,notice_id,actor_id)
 values(a,1,s,arr,nt,pg_temp.cm_id(mm));
end$$;
select pg_temp.cm_book('1','01','0a',now()+interval '1 day');
select pg_temp.cm_book('2','01','0a',now()-interval '1 day');
select pg_temp.cm_book('3','01','0a',now()+interval '2 days','cancelled');
select pg_temp.cm_book('4','02','0b',now()-interval '1 day');
select pg_temp.cm_book('5','04','0a',now()-interval '1 day');
select pg_temp.cm_book('6','01','0a',now()-interval '1 hour');
select pg_temp.cm_book('7','01','0a',now()+interval '3 days');
insert into public.clinic_booking_checkins(clinic_id,appointment_id,reservation_id,outcome,actor_id,membership_id,source)
 values(pg_temp.cm_id('0a'),pg_temp.cm_id('a7'),pg_temp.cm_id('c7'),'completed',pg_temp.cm_id('0c'),pg_temp.cm_id('f1'),'inferred-from-result-upload');
-- An open collection ensures the visit reads are non-empty.
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id,appointment_id,accepted_revision,booking_context)
 values(pg_temp.cm_id('41'),pg_temp.cm_id('01'),pg_temp.cm_id('e1'),'Fictional nurse A','nurse',pg_temp.cm_id('0a'),pg_temp.cm_id('a2'),1,'{"version":"booking-visit-context-v1"}');
insert into public.patient_care_visit_entries(id,user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id)
 values(pg_temp.cm_id('42'),pg_temp.cm_id('01'),pg_temp.cm_id('41'),gen_random_uuid(),1,
 jsonb_build_object('kind','collection','observedAt',now()::text,'appointmentId',pg_temp.cm_id('a2'),'acceptedRevision',1,'testId','lipid-panel','outcome','collected'),
 now()::text,now(),pg_temp.cm_id('e1'),'Fictional nurse A','nurse',pg_temp.cm_id('0a'));
insert into public.patient_care_lab_stages(user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id)
 values(pg_temp.cm_id('01'),pg_temp.cm_id('42'),'at-lab',gen_random_uuid(),now(),pg_temp.cm_id('e1'),'Fictional nurse A','nurse',pg_temp.cm_id('0a'));
insert into public.clinic_member_profile_changes(clinic_id,actor_id,membership_id,member_id,submission_id,before,after)
 values(pg_temp.cm_id('0a'),pg_temp.cm_id('0c'),pg_temp.cm_id('f1'),pg_temp.cm_id('01'),gen_random_uuid(),
 '{"name":"Fictional Prior Name","birthDate":"1975-04-04","phone":"+37499080177"}',
 '{"name":"Fictional Masking 01","birthDate":"1975-04-05","phone":"+37499080177"}');
insert into public.clinic_batches(id,clinic_id,name,uploader_id,uploader_name)
 values(pg_temp.cm_id('44'),pg_temp.cm_id('0a'),'Fictional masking batch',pg_temp.cm_id('0c'),'Fictional A admin');
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state)
 values(pg_temp.cm_id('51'),pg_temp.cm_id('44'),gen_random_uuid(),gen_random_uuid(),pg_temp.cm_id('0c'),gen_random_uuid(),'[]',now()+interval '1 year',pg_temp.cm_id('f1'),0,gen_random_uuid(),
 'fictional-masking.pdf','application/pdf',10,repeat('a',64),'fictional-masking/51',gen_random_uuid(),10,repeat('a',64),'stored');
insert into public.lab_ai_jobs(kind,file_id,clinic_id,state,outcome,finished_at,identity_status,identity,suggestions)
 values('file',pg_temp.cm_id('51'),pg_temp.cm_id('0a'),'done','fixture',now(),'match',
 '{"nameOnSheet":"Fictional Masking 01","birthDateOnSheet":"1975-04-05","sampleDate":"2026-11-01"}',
 jsonb_build_array(jsonb_build_object('memberId',pg_temp.cm_id('01'),'confidence','high')));
set local session_replication_role=origin;

-- Canary content also lives in the legacy name, sheet extraction and storage target.
set local session_replication_role=replica;
update public.clinic_batch_files set name='PRIVATE_FILENAME_37499080177_1975-04-05.pdf',object_key='PRIVATE_OBJECT_TARGET/51' where id=pg_temp.cm_id('51');
update public.clinic_batches set name='PRIVATE_BATCH_37499080177'where id=pg_temp.cm_id('44');
update public.lab_ai_jobs set extraction='{"text":"PRIVATE_EXTRACTED_TEXT","email":"PRIVATE_EMAIL@example.invalid","address":"PRIVATE_ADDRESS"}',
 identity=identity||'{"phone":"37499080177","email":"PRIVATE_EMAIL@example.invalid","address":"PRIVATE_ADDRESS","text":"PRIVATE_EXTRACTED_TEXT"}'
 where file_id=pg_temp.cm_id('51');
update public.patient_clinical_cases set assigned_nurse_id=pg_temp.cm_id('e1')where user_id=pg_temp.cm_id('01');
insert into auth.sessions(id,user_id,created_at,updated_at)
 select('c0f50000-0000-4000-8000-0000000001'||n)::uuid,pg_temp.cm_id(n),now(),now()from unnest(array['d1','e1'])n;
insert into storage.objects(id,bucket_id,name,metadata)
 select object_id,'clinic-originals',object_key,'{"size":10}'from public.clinic_batch_files where id=pg_temp.cm_id('51');
insert into public.clinic_result_attachments(id,file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id)
 values(pg_temp.cm_id('61'),pg_temp.cm_id('51'),pg_temp.cm_id('0a'),pg_temp.cm_id('01'),pg_temp.cm_id('41'),'noreon-admin',pg_temp.cm_id('aa'),gen_random_uuid());
insert into public.clinic_original_accesses(id,file_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,file_revision)
 values(pg_temp.cm_id('71'),pg_temp.cm_id('51'),pg_temp.cm_id('0c'),'c0f50000-0000-4000-8000-00000000010c','[{"method":"password"}]',now()+interval '1 year',pg_temp.cm_id('f1'),0,0);
-- Two pending uploads: sensitive legacy commands disappear, neutral commands retain recovery.
insert into public.clinic_batch_commands(actor_id,submission_id,session_id,clinic_id,batch_id,payload,state,result)
 select pg_temp.cm_id('0c'),pg_temp.cm_id(n),'c0f50000-0000-4000-8000-00000000010c',pg_temp.cm_id('0a'),pg_temp.cm_id('44'),
 jsonb_build_object('version','clinic-command-v1','op','reserve-upload','submissionId',pg_temp.cm_id(n),'clinicId',pg_temp.cm_id('0a'),'batchId',pg_temp.cm_id('44'),
  'name',case when n='82'then 'PDF 2026-11-05.pdf'else 'PDF 1975-04-05.pdf'end,'revision',0,'logicalKey',pg_temp.cm_id('9'||right(n,1)),
  'fileId',pg_temp.cm_id('5'||right(n,1)),'attemptId',pg_temp.cm_id('a'||right(n,1)),'mime','application/pdf','declaredSizeBytes',10,'fingerprint',repeat('a',64)),
 'committed','{"status":"accepted"}'from unnest(array['82','83'])n;
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key)
 select pg_temp.cm_id('5'||right(n,1)),pg_temp.cm_id('44'),pg_temp.cm_id('9'||right(n,1)),pg_temp.cm_id('a'||right(n,1)),pg_temp.cm_id('0c'),
 'c0f50000-0000-4000-8000-00000000010c','[{"method":"password"}]',now()+interval '1 year',pg_temp.cm_id('f1'),0,pg_temp.cm_id(n),
 case when n='82'then 'PDF 2026-11-05.pdf'else 'PDF 1975-04-05.pdf'end,'application/pdf',10,repeat('a',64),'PRIVATE_OBJECT_TARGET/'||n
 from unnest(array['82','83'])n;
-- Unattached legacy file exercises the comparison sheet boundary too.
insert into public.clinic_batch_files
 select (jsonb_populate_record(null::public.clinic_batch_files,to_jsonb(f)||jsonb_build_object('id',pg_temp.cm_id('54'),
 'logical_key',gen_random_uuid(),'attempt_id',gen_random_uuid(),'submission_id',gen_random_uuid(),'object_id',gen_random_uuid(),
 'object_key','PRIVATE_OBJECT_TARGET/54','created_at',f.created_at-interval '1 minute'))).* from public.clinic_batch_files f where id=pg_temp.cm_id('51');
insert into public.lab_ai_jobs(kind,file_id,clinic_id,state,outcome,finished_at,identity_status,identity,suggestions,extraction)
 select kind,pg_temp.cm_id('54'),clinic_id,state,outcome,finished_at,identity_status,identity,suggestions,extraction
 from public.lab_ai_jobs where kind='file'and file_id=pg_temp.cm_id('51');
-- Pin reservation creation to the canonical upload date. A DOB-shaped name must still
-- be replaced, and never released as a recovery command despite matching the date syntax.
update public.clinic_batch_files set created_at='2026-11-04T21:00:00Z'where id in(pg_temp.cm_id('52'),pg_temp.cm_id('53'));
set local session_replication_role=origin;
update public.doctor_completion_capabilities set enabled=true where singleton;
-- Actual pre-lockdown receipts: saved booking phone survives unless the replay branch projects it.
insert into public.clinic_schedule_commands(actor_id,submission_id,clinic_id,payload,result)
 select pg_temp.cm_id(actor),pg_temp.cm_id('72'),pg_temp.cm_id('0a'),
 jsonb_build_object('version','clinic-schedule-command-v1','op','confirm','submissionId',pg_temp.cm_id('72'),'appointmentId',pg_temp.cm_id('a1'),'revision',0),
 jsonb_build_object('status','saved','booking',jsonb_set(public._clinic_schedule_row(pg_temp.cm_id('0a'),a),'{memberPhone}','"+37499080177"'::jsonb))
 from public.booking_appointments a cross join unnest(array['0c','0d'])actor where a.id=pg_temp.cm_id('a1');


create function pg_temp.lockdown_clean(j jsonb,label text)returns void language plpgsql as $$
begin
 perform pg_temp.cm_assert(j is not null,label||' returns a result');
 perform pg_temp.cm_assert(j::text!~'37499080177|private@example[.]invalid|1975-04-05|1975-04-04|PRIVATE_FILENAME|PRIVATE_BATCH|PRIVATE_EMAIL|PRIVATE_ADDRESS|PRIVATE_EXTRACTED_TEXT|PRIVATE_OBJECT_TARGET',label||' excludes canary values');
 perform pg_temp.cm_assert(j::text!~'"(objectKey|objectId|bucket|accessId|signedUrl|extraction|rawText)"',label||' excludes target and content keys');
 -- Walk JSON scalars without treating UUIDs, timestamps or sample dates as phone numbers. A random UUID whose first eight characters are all digits (about 2% of draws) matched the phone pattern and made this check flaky; a UUID-shaped string is skipped, nothing else is loosened.
 perform pg_temp.cm_assert(not exists(
  with recursive nodes(v,k)as(
   select j,null::text
   union all
   select child.value,child.key from nodes n cross join lateral(
    select key,value from jsonb_each(case when jsonb_typeof(n.v)='object'then n.v else '{}'::jsonb end)
    union all
    select null::text,value from jsonb_array_elements(case when jsonb_typeof(n.v)='array'then n.v else '[]'::jsonb end)
   )child
  )select 1 from nodes where
   (k in('birthDate','birthDateOnSheet')and v<>'null'::jsonb)
   or(jsonb_typeof(v)='string'and((v#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'and(v#>>'{}')~'^\+?[0-9]{8,}'or(v#>>'{}')~*'[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}'))
 ),label||' recursively excludes phones, emails and full birth-date values');
end$$;
create function pg_temp.lockdown_reads()returns void language plpgsql as $$
declare r jsonb;x jsonb;sc text;
begin
 -- Direct table/Storage reads cannot bypass the guarded projections.
 begin
  perform pg_temp.cm_assert(not exists(select 1 from storage.objects where bucket_id='clinic-originals'),'clinic cannot read private original objects');
 exception when insufficient_privilege then null;end;
 begin
  perform pg_temp.cm_assert(not exists(select 1 from public.clinic_batch_files),'clinic cannot directly read original names or targets');
 exception when insufficient_privilege then null;end;
 begin
  perform pg_temp.cm_assert(not exists(select 1 from public.lab_ai_jobs),'clinic cannot directly read extracted text');
 exception when insufficient_privilege then null;end;
 perform pg_temp.lockdown_clean(public.clinic_portal_identity(pg_temp.cm_id('0a')),'portal identity');
 r:=public.clinic_schedule_command(pg_temp.cm_id('0a'),jsonb_build_object('version','clinic-schedule-command-v1','op','confirm',
  'submissionId',pg_temp.cm_id('72'),'appointmentId',pg_temp.cm_id('a1'),'revision',0));
 perform pg_temp.lockdown_clean(r,'legacy schedule command replay');
 perform pg_temp.cm_assert(r->>'status'='saved'and r#>>'{booking,appointmentId}'=pg_temp.cm_id('a1')::text
  and r#>'{booking,memberPhone}'='null'::jsonb,'legacy replay keeps saved booking and null phone key');
 perform pg_temp.cm_assert(r=public.clinic_schedule_command(pg_temp.cm_id('0a'),jsonb_build_object('version','clinic-schedule-command-v1','op','confirm',
  'submissionId',pg_temp.cm_id('72'),'appointmentId',pg_temp.cm_id('a1'),'revision',0)),'masked replay remains idempotent');
 perform pg_temp.cm_assert(public.clinic_schedule_command(pg_temp.cm_id('0a'),jsonb_build_object('version','clinic-schedule-command-v1','op','confirm',
  'submissionId',pg_temp.cm_id('72'),'appointmentId',pg_temp.cm_id('a1'),'revision',1))->>'status'='conflict','changed replay payload still conflicts');

 perform pg_temp.lockdown_clean(public.clinic_batches_page(pg_temp.cm_id('0a')),'batch listing');
 r:=public.clinic_batch_read(pg_temp.cm_id('0a'),pg_temp.cm_id('44'));
 perform pg_temp.lockdown_clean(r,'batch read');
 for x in select value from jsonb_array_elements(r->'files')loop
  perform pg_temp.cm_assert(x->>'name'~'^PDF [0-9]{4}-[0-9]{2}-[0-9]{2}\.pdf$','neutral PDF names');
  if x->>'id'=pg_temp.cm_id('52')::text then
   perform pg_temp.cm_assert(case when auth.uid()=pg_temp.cm_id('0c')then x#>>'{recoveryCommand,name}'='PDF 2026-11-05.pdf'and x#>>'{recoveryCommand,name}'=x->>'name'else x->'recoveryCommand'='null'::jsonb end,'neutral recovery only for actor');
  elsif x->>'id'=pg_temp.cm_id('53')::text then
   perform pg_temp.cm_assert(x->'recoveryCommand'='null'::jsonb and x->>'name'='PDF 2026-11-05.pdf','DOB-shaped legacy name hidden and recovery suppressed');
  end if;
 end loop;
 perform pg_temp.lockdown_clean(public.clinic_member_search(pg_temp.cm_id('0a'),'0177',1),'member search');
 perform pg_temp.lockdown_clean(public.clinic_member_file(pg_temp.cm_id('0a'),pg_temp.cm_id('01')),'member file');
 perform pg_temp.lockdown_clean(public.clinic_member_masked(pg_temp.cm_id('0a'),array[pg_temp.cm_id('01')]),'masked member');
 perform pg_temp.lockdown_clean(public.clinic_portal_lab_members(pg_temp.cm_id('0a')),'lab members');
 r:=public.clinic_portal_lab_results(pg_temp.cm_id('0a'),pg_temp.cm_id('44'));
 perform pg_temp.lockdown_clean(r,'lab results');
 perform pg_temp.cm_assert(not(r#>'{files,0,reading}' ?| array['nameOnSheet','birthDateOnSheet','sampleDate']),'reading has no extracted identity text');
 perform pg_temp.lockdown_clean(public.clinic_portal_result_visits(pg_temp.cm_id('0a')),'result visits');
 foreach sc in array array['upcoming','past']loop
  r:=public.clinic_schedule_bookings(pg_temp.cm_id('0a'),sc);
  perform pg_temp.lockdown_clean(r,'schedule '||sc);
  perform pg_temp.cm_assert(jsonb_array_length(r->'bookings')>0,'populated schedule '||sc);
  for x in select value from jsonb_array_elements(r->'bookings')loop
   perform pg_temp.cm_assert(x->'memberPhone'='null'::jsonb,'phone null for every booking');
  end loop;
 end loop;
 if auth.uid()=pg_temp.cm_id('0c')then
  perform pg_temp.lockdown_clean(public.clinic_admin_patients(pg_temp.cm_id('0a')),'admin patients');
  perform pg_temp.lockdown_clean(public.clinic_admin_patient_record(pg_temp.cm_id('0a'),pg_temp.cm_id('01')),'admin record');
  r:=public.clinic_admin_member_files(pg_temp.cm_id('0a'),pg_temp.cm_id('01'));
  perform pg_temp.lockdown_clean(r,'admin files');
  perform pg_temp.cm_assert(jsonb_array_length(r->'unmatched')=1 and pg_temp.cm_keys(r#>'{unmatched,0,compare,sheet}',array['nameMatch','birthYearMatch']),'comparison carries only match outcomes');
 else
  perform pg_temp.cm_assert(pg_temp.cm_sqlstate($q$select public.clinic_admin_member_files(pg_temp.cm_id('0a'),pg_temp.cm_id('01'))$q$)='42501','staff cannot use admin list');
 end if;
 perform set_config('response.status','',true);
 perform pg_temp.cm_assert(public.clinic_member_file_download(pg_temp.cm_id('0a'),pg_temp.cm_id('01'),pg_temp.cm_id('51'))='{"status":"refused"}'::jsonb,'member-file download refused');
 perform pg_temp.cm_assert(current_setting('response.status',true)='403','clinic_member_file_download sets HTTP 403 without rolling back audit');
 perform set_config('response.status','',true);
 perform pg_temp.cm_assert(public.clinic_original_access(pg_temp.cm_id('51'))='{"status":"refused"}'::jsonb,'original access refused');
 perform pg_temp.cm_assert(current_setting('response.status',true)='403','clinic_original_access sets HTTP 403 without rolling back audit');
 perform set_config('response.status','',true);
 perform pg_temp.cm_assert(public.clinic_admin_original_open(pg_temp.cm_id('51'))='{"status":"refused"}'::jsonb,'clinic administrator is not workspace admin');
 perform pg_temp.cm_assert(current_setting('response.status',true)='403','clinic_admin_original_open sets HTTP 403 without rolling back audit');
 perform pg_temp.cm_assert(pg_temp.cm_sqlstate($q$select public.clinic_original_target(pg_temp.cm_id('71'))$q$)='42501','clinic cannot redeem legacy ticket');
 perform pg_temp.cm_assert(pg_temp.cm_sqlstate($q$select public.doctor_member_document_open(pg_temp.cm_id('01'),pg_temp.cm_id('51'))$q$)='42501','clinic cannot use doctor entry point');
 perform pg_temp.cm_assert(pg_temp.cm_sqlstate($q$select public.clinic_result_attach_page(pg_temp.cm_id('0a'))$q$)='42501','clinic cannot read staff attachment page');
end$$;
grant execute on function pg_temp.lockdown_clean(jsonb,text),pg_temp.lockdown_reads()to authenticated;
select pg_temp.cm_user('0c');
set local role authenticated;
select pg_temp.lockdown_reads();
reset role;
select pg_temp.cm_user('0d');
set local role authenticated;
select pg_temp.lockdown_reads();
reset role;
select pg_temp.cm_assert((select count(*)=2 from public.clinic_portal_audit where clinic_id=pg_temp.cm_id('0a')and kind=k and detail->>'outcome'='refused'),'audited refusal '||k)
 from unnest(array['member-file-download-refused','original-access-refused','admin-original-refused'])k;
-- Projection must not rewrite historical receipts or repeat a booking mutation.
select pg_temp.cm_assert((select count(*)=2 and bool_and(result#>>'{booking,memberPhone}'='+37499080177')
 from public.clinic_schedule_commands where submission_id=pg_temp.cm_id('72')),'stored receipts remain unchanged');
select pg_temp.cm_assert((select revision=1 from public.booking_appointments where id=pg_temp.cm_id('a1'))
 and not exists(select 1 from public.clinic_booking_decisions where appointment_id=pg_temp.cm_id('a1')),'replay produces no new booking decision');
select pg_temp.cm_assert((select count(*)=1 from public.clinic_original_accesses where file_id=pg_temp.cm_id('51')),'no new tickets');

-- A pre-migration ticket is denied even when the privileged server bridge redeems it.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select pg_temp.cm_assert(public.clinic_original_target(pg_temp.cm_id('71'))='{"status":"refused"}'::jsonb,'legacy service ticket refused');
reset role;
select pg_temp.cm_assert((select count(*)=1 from public.clinic_portal_audit where kind='original-target-refused'and detail->>'outcome'='refused'and detail->>'accessId'=pg_temp.cm_id('71')::text),'legacy refusal persists in audit');

-- Existing staff authorization remains: workspace admin and assigned doctor can open originals.
select pg_temp.cm_user('aa');
set local role authenticated;
select pg_temp.cm_assert(public.clinic_admin_original_open(pg_temp.cm_id('51'))->>'objectKey'='PRIVATE_OBJECT_TARGET/51','workspace admin original target preserved');
reset role;
select pg_temp.cm_user('d1');
set local role authenticated;
select pg_temp.cm_assert(public.doctor_member_document_open(pg_temp.cm_id('01'),pg_temp.cm_id('51'))->>'objectKey'='PRIVATE_OBJECT_TARGET/51','assigned doctor original target preserved');
reset role;
-- There is no nurse clinic-original open/target RPC in this schema. The existing doctor-only
-- entry point remains doctor-only; nurse member-upload history access is a different surface.
select pg_temp.cm_user('e1');
set local role authenticated;
select pg_temp.cm_assert(pg_temp.cm_sqlstate($q$select public.doctor_member_document_open(pg_temp.cm_id('01'),pg_temp.cm_id('51'))$q$)='42501','nurse doctor-only denial unchanged');
reset role;
select pg_temp.cm_assert((select count(*)=1 from public.patient_document_opens where actor_id=pg_temp.cm_id('d1')and file_id=pg_temp.cm_id('51')),'doctor open audited');

-- Presentation code does not change ACLs or the private upload pipeline.
select pg_temp.cm_assert(has_function_privilege('service_role','public.clinic_upload_target(uuid,uuid,uuid)','execute')
 and not has_function_privilege('authenticated','public.clinic_upload_target(uuid,uuid,uuid)','execute'),'upload target stays service-only');
select pg_temp.cm_assert(not has_function_privilege('authenticated','public.clinic_original_target(uuid)','execute'),'original target remains service-only');
select pg_temp.cm_assert(p.provolatile='v'and p.prosecdef and p.proconfig @> array['search_path=""'],'replaced RPC metadata '||p.proname)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in(
 '_clinic_portal_batch_json','_clinic_portal_file_json','_clinic_member_files','_clinic_member_file_json','clinic_portal_lab_results','clinic_batch_read',
 '_clinic_schedule_row','_clinic_member_comparison_masked','clinic_member_file_download','clinic_original_access','clinic_original_target','clinic_admin_original_open','clinic_schedule_command');
-- Projection changes disclosure only: full-date mismatches still require review,
-- while the clinic may see a matching birth year and an unknown missing name.
select pg_temp.cm_assert(
 public._clinic_member_comparison_masked('{"status":"compared","read":true,"differs":true,"mismatch":"birth_date","sheet":{"name":"Fictional","birthDate":"1975-04-05"},"member":{"name":"Fictional","birthDate":"1975-04-04"}}'::jsonb)
 #>'{sheet}'='{"nameMatch":"yes","birthYearMatch":"yes"}'::jsonb,
 'same year does not disclose day/month or change the private full-date mismatch');
select pg_temp.cm_assert(
 public._clinic_member_comparison_masked('{"status":"compared","read":true,"differs":false,"mismatch":null,"sheet":{"name":null,"birthDate":null},"member":{"name":"Fictional","birthDate":"1975-04-05"}}'::jsonb)
 #>'{sheet}'='{"nameMatch":"unknown","birthYearMatch":"unknown"}'::jsonb,
 'missing PDF identity remains unknown');
reset role;
set local session_replication_role = replica;

update public.lab_ai_jobs
set identity = jsonb_set(
  identity,
  '{nameOnSheet}',
  to_jsonb(
    'Fictional Member +37499080177 private@example.invalid 1975-04-05'::text
  )
)
where kind = 'file'
  and file_id in (pg_temp.cm_id('51'), pg_temp.cm_id('54'));

set local session_replication_role = origin;
select pg_temp.cm_user('0c');
set local role authenticated;

select pg_temp.lockdown_clean(
  public.clinic_portal_lab_results(
    pg_temp.cm_id('0a'), pg_temp.cm_id('44')
  ),
  'independent PDF name canary'
);

select pg_temp.lockdown_clean(
  public.clinic_admin_member_files(
    pg_temp.cm_id('0a'), pg_temp.cm_id('01')
  ),
  'independent comparison name canary'
);

reset role;

-- All clinic read surfaces must remain clean with hostile extracted names.
select pg_temp.cm_user('0c');
set local role authenticated;
select pg_temp.lockdown_reads();
reset role;
select pg_temp.cm_user('0d');
set local role authenticated;
select pg_temp.lockdown_reads();
reset role;
rollback;
\echo 'clinic PDF/phone lockdown checks passed'
