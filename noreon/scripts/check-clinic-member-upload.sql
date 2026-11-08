-- Results uploaded from the member's record: who may upload, automatic attach on a matching reading, the
-- "Continue anyway" override and its record, several people blocked, the booking rule, old stuck files,
-- reading off, Noreon oversight and the shell flag. Fictional data; rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text) returns void language plpgsql as $$begin if c is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.code(q text) returns text language plpgsql as $$begin execute q;return 'ran';exception when others then return sqlstate;end$$;
-- cb0a: clinics A 0a, B 0b; clinic portal A admin 0c, A staff 0d, B admin 0e; doctors d1 (A), d2 (B); Noreon admin aa.
-- Members: 01 (doctor d1), 03 (doctor d2, booked at A yesterday), 05 (booked at A 200 days ago only), 02 (doctor d2).
create function pg_temp.id(n text) returns uuid language sql immutable as $$select('cb0a0000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','exp',4102444800,'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',('cb0a0000-0000-4000-8000-0000000001'||n)::uuid)::text,true),
  set_config('request.jwt.claim.sub',pg_temp.id(n)::text,true)
$$;
grant execute on function pg_temp.id(text),pg_temp.as_user(text),pg_temp.ok(boolean,text),pg_temp.code(text) to authenticated,anon,service_role;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),case when n<'06'then '3749907'||n||'55'end,case when n<'06'then now()end
 from unnest(array['01','02','03','05','0c','0d','0e','d1','d2','aa'])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select('cb0a0000-0000-4000-8000-0000000001'||n)::uuid,pg_temp.id(n),now(),now()from unnest(array['01','0c','0d','0e','d1','d2','aa'])n;
update public.profiles p set display_name=x.n,birth_date=x.d from(values(pg_temp.id('01'),'Anahit Petrosyan','1975-04-05'::date),(pg_temp.id('02'),'Fictional Other','1960-01-01'::date),
 (pg_temp.id('03'),'Aram Booked','1970-02-02'::date),(pg_temp.id('05'),'Old Booking','1980-03-03'::date))x(i,n,d)where p.id=x.i;
insert into public.workspace_clinics(id,name,address)values(pg_temp.id('0a'),'Fictional clinic A','1 Street'),(pg_temp.id('0b'),'Fictional clinic B','2 Street');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.id('d1'),'doctor','Fictional doctor A',pg_temp.id('0a')),(pg_temp.id('d2'),'doctor','Fictional doctor B',pg_temp.id('0b'));
insert into public.workspace_staff(user_id,role,display_name)values(pg_temp.id('aa'),'admin','Fictional Noreon admin');
insert into public.clinic_portal_memberships(id,user_id,clinic_id,display_name,role)values(pg_temp.id('f1'),pg_temp.id('0c'),pg_temp.id('0a'),'Fictional A admin','admin'),
 (pg_temp.id('f2'),pg_temp.id('0d'),pg_temp.id('0a'),'Fictional A staff','staff'),(pg_temp.id('f3'),pg_temp.id('0e'),pg_temp.id('0b'),'Fictional B admin','admin');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values(pg_temp.id('01'),pg_temp.id('d1')),(pg_temp.id('02'),pg_temp.id('d2')),(pg_temp.id('03'),pg_temp.id('d2')),(pg_temp.id('05'),null);
insert into public.zoe_settings(singleton)values(true)on conflict do nothing;
update public.lab_ai_capabilities set enabled=true where singleton;
insert into public.clinic_portal_capabilities(singleton,result_attach_enabled,clinic_admin_full_access)values(true,true,false)on conflict(singleton)do update set result_attach_enabled=true,clinic_admin_full_access=false;

-- Bookings at A: 03 yesterday, 05 200 days ago (replica: booking machinery not under test).
set local session_replication_role=replica;
create function pg_temp.book(n text,member text,starts timestamptz) returns void language plpgsql as $$
declare a uuid:=pg_temp.id('a'||n);nt uuid:=pg_temp.id('b'||n);r uuid:=pg_temp.id('c'||n);s uuid:=pg_temp.id('e'||n);m uuid:=pg_temp.id(member);
 arr jsonb:=jsonb_build_object('clinicId',pg_temp.id('0a'),'startsAt',starts,'coveredTestIds',jsonb_build_array('lipid-panel'));
begin
 insert into public.booking_program_seals(id,member_id,actor_id,source_token,requirements_token,engine_version,program)values(s,m,m,'t','t','synthetic',jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id','lipid-panel','title','Lipid profile','method','lab'))));
 insert into public.booking_appointments(id,member_id,program_id,requirements_token,revision,status,current_arrangement,proposed_arrangement,current_reservation_id,proposed_reservation_id,notice_id)values(a,m,s,'t'||n,1,'confirmed',arr,arr,r,r,nt);
 insert into public.booking_manual_reservations(id,appointment_id,capacity_key,offer_id,offer_version,member_id,valid_until)values(r,a,'synthetic',gen_random_uuid(),'1',m,now()+interval '1 year');
 insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,state,channel)values(nt,a,1,s,r,pg_temp.id('0a'),1,'accepted','portal');
 insert into public.booking_appointment_versions(appointment_id,revision,program_id,proposed_arrangement,notice_id,actor_id)values(a,1,s,arr,nt,m);
end$$;
select pg_temp.book('1','03',now()-interval '1 day');
select pg_temp.book('2','05',now()-interval '200 days');
-- Batches: 41 for 01 (the record upload), 42 for 03, 43 for 05, 44 an old ordinary batch, 45 for 01 later (reading off).
insert into public.clinic_batches(id,clinic_id,name,uploader_id,uploader_name,created_at)select pg_temp.id(b),pg_temp.id('0a'),'Fictional upload '||b,pg_temp.id('0c'),'Fictional A admin',now()-interval '2 hours'
 from unnest(array['41','42','43','44','45','46','47'])b;
insert into public.clinic_batch_commands(actor_id,submission_id,session_id,clinic_id,batch_id,payload,state,result)
 select pg_temp.id('0c'),pg_temp.id('6'||right(f,1)),gen_random_uuid(),pg_temp.id('0a'),pg_temp.id(b),'{}','committed','{}'
 from(values('51','41'),('52','41'),('53','41'),('54','41'),('55','42'),('56','43'),('57','44'),('58','45'))x(f,b);
create function pg_temp.file(f text,b text) returns void language sql as $$
 insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state,created_at)
 values(pg_temp.id(f),pg_temp.id(b),gen_random_uuid(),gen_random_uuid(),pg_temp.id('0c'),gen_random_uuid(),'[]',now(),pg_temp.id('f1'),1,pg_temp.id('6'||right(f,1)),'fictional-'||f||'.pdf','application/pdf',10,repeat('a',64),'fictional-mu/'||f,gen_random_uuid(),10,repeat('a',64),'reserved',now())
$$;
set local session_replication_role=origin;
create function pg_temp.store(f text) returns void language sql as $$update public.clinic_batch_files set state='stored'where id=pg_temp.id(f)$$;
-- The worker's result for a file reading (what lab_ai_job_finish writes), set directly.
create function pg_temp.read(f text,st text,idst text,ident jsonb) returns void language sql as $$
 update public.lab_ai_jobs set state=st,outcome='fictional',finished_at=clock_timestamp(),identity_status=idst,identity=ident where kind='file'and file_id=pg_temp.id(f)
$$;
create function pg_temp.state(f text) returns text language sql as $$select state from public.clinic_member_upload_files where file_id=pg_temp.id(f)$$;
create function pg_temp.attached_to(f text) returns uuid language sql as $$select user_id from public.clinic_result_attachments where file_id=pg_temp.id(f)$$;

-- 1. Switch off: refused. Who: clinic staff, workspace staff, members and anon are refused.
select pg_temp.as_user('0c');
set local role authenticated;
select pg_temp.ok(public.clinic_admin_member_upload_register(pg_temp.id('0a'),pg_temp.id('01'),pg_temp.id('41'))->>'status'='disabled','Switch off: no upload');
select pg_temp.ok(public.clinic_admin_member_files(pg_temp.id('0a'),pg_temp.id('01'))->>'enabled'='false','Switch off: no files');
select pg_temp.ok((public.clinic_portal_identity(pg_temp.id('0a'))#>>'{identity,fullAccess}')::boolean=false,'Shell flag off');
reset role;
update public.clinic_portal_capabilities set clinic_admin_full_access=true where singleton;
select pg_temp.as_user('0c');
set local role authenticated;
select pg_temp.ok((public.clinic_portal_identity(pg_temp.id('0a'))#>>'{identity,fullAccess}')::boolean,'Shell flag on for the admin');
reset role;
select pg_temp.as_user('0d');
set local role authenticated;
select pg_temp.ok((public.clinic_portal_identity(pg_temp.id('0a'))#>>'{identity,fullAccess}')::boolean=false,'Shell flag off for clinic staff');
select pg_temp.ok(pg_temp.code($q$select public.clinic_admin_member_upload_register(pg_temp.id('0a'),pg_temp.id('01'),pg_temp.id('41'))$q$)='42501','Clinic staff cannot upload');
select pg_temp.ok(pg_temp.code($q$select public.clinic_admin_member_files(pg_temp.id('0a'),pg_temp.id('01'))$q$)='42501','Clinic staff cannot read files');
select pg_temp.ok(pg_temp.code($q$select public.clinic_admin_member_file_attach(pg_temp.id('0a'),pg_temp.id('01'),pg_temp.id('51'),gen_random_uuid(),true,null,null)$q$)='42501','Clinic staff cannot attach');
reset role;
select pg_temp.as_user('d1');
set local role authenticated;
select pg_temp.ok(pg_temp.code($q$select public.clinic_admin_member_files(pg_temp.id('0a'),pg_temp.id('01'))$q$)='42501','A doctor is not a clinic admin');
reset role;
select pg_temp.as_user('01');
set local role authenticated;
select pg_temp.ok(pg_temp.code($q$select public.clinic_admin_member_upload_register(pg_temp.id('0a'),pg_temp.id('01'),pg_temp.id('41'))$q$)='42501','A member cannot upload');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true),set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.ok(pg_temp.code($q$select public.clinic_admin_member_files(pg_temp.id('0a'),pg_temp.id('01'))$q$)='42501','Anon refused');
reset role;
select pg_temp.as_user('0e');
set local role authenticated;
select pg_temp.ok(public.clinic_admin_member_upload_register(pg_temp.id('0b'),pg_temp.id('01'),pg_temp.id('41'))->>'status'='refused','Clinic B cannot upload for clinic A''s member');
select pg_temp.ok(public.clinic_admin_member_files(pg_temp.id('0b'),pg_temp.id('01'))->>'status'='refused','Clinic B cannot read clinic A''s member files');
reset role;

-- 2. Register uploads (the batches were made by the existing create-batch command; here, by the fixture).
select pg_temp.as_user('0c');
set local role authenticated;
select pg_temp.ok(public.clinic_admin_member_upload_register(pg_temp.id('0a'),pg_temp.id('01'),pg_temp.id('41'))->>'status'='registered','Upload for the clinic''s member');
select pg_temp.ok(public.clinic_admin_member_upload_register(pg_temp.id('0a'),pg_temp.id('01'),pg_temp.id('41'))->>'status'='registered','Registering again is a replay');
select pg_temp.ok(public.clinic_admin_member_upload_register(pg_temp.id('0a'),pg_temp.id('03'),pg_temp.id('41'))->>'status'='invalid','A batch is for one member');
select pg_temp.ok(public.clinic_admin_member_upload_register(pg_temp.id('0a'),pg_temp.id('02'),pg_temp.id('46'))->>'status'='refused','Not a member of this clinic');
select pg_temp.ok(public.clinic_admin_member_upload_register(pg_temp.id('0a'),pg_temp.id('03'),pg_temp.id('42'))->>'status'='registered','Upload for a booked member');
select pg_temp.ok(public.clinic_admin_member_upload_register(pg_temp.id('0a'),pg_temp.id('05'),pg_temp.id('43'))->>'status'='registered','Upload for a member with an old booking');
select pg_temp.ok(public.clinic_admin_member_upload_register(pg_temp.id('0a'),pg_temp.id('01'),pg_temp.id('45'))->>'status'='registered','A second upload for 01');
reset role;

-- Files reserved into the batches (the existing reserve-upload command; here, by the fixture).
set local session_replication_role=replica;
select pg_temp.file(f,b)from(values('51','41'),('52','41'),('53','41'),('54','41'),('55','42'),('56','43'),('57','44'),('58','45'))x(f,b);
set local session_replication_role=origin;

-- 3. Stored files wait for the reading; a matching reading attaches by itself (no booking needed: own member).
select pg_temp.store(f)from unnest(array['51','52','53','54','55','56','57'])f;
select pg_temp.ok(pg_temp.state('51')='reading'and pg_temp.attached_to('51')is null,'Stored: waiting for the reading');
select pg_temp.ok(exists(select 1 from public.lab_ai_jobs where kind='file'and file_id=pg_temp.id('51')),'A file reading is queued');
select pg_temp.read('51','done','match',jsonb_build_object('memberId',pg_temp.id('01'),'nameOnSheet','PETROSYAN ANAHIT','birthDateOnSheet','1975-04-05','nameMatch','yes','birthDateMatch','yes'));
select pg_temp.ok(pg_temp.state('51')='attached'and pg_temp.attached_to('51')=pg_temp.id('01'),'A matching reading attaches automatically');
select pg_temp.ok((select v.source='clinic-upload'and v.booking_context is null and v.clinic_id=pg_temp.id('0a')and v.actor_id=pg_temp.id('0c')
 from public.clinic_result_attachments x join public.patient_care_visits v on v.id=x.visit_id where x.file_id=pg_temp.id('51')),'On a clinic-upload visit, by the uploader, no booking');
select pg_temp.ok(exists(select 1 from public.lab_ai_jobs where kind='attachment'and file_id=pg_temp.id('51')),'The member reading for the doctor is queued');

-- 4. Date of birth differs: waits; "Continue anyway" attaches and records the override.
select pg_temp.read('52','done','mismatch',jsonb_build_object('memberId',pg_temp.id('01'),'nameOnSheet','Anahit Petrosyan','birthDateOnSheet','1986-03-25','nameMatch','yes','birthDateMatch','no'));
select pg_temp.ok(pg_temp.state('52')='check'and pg_temp.attached_to('52')is null,'A different date of birth waits for a check');
-- 5. Several people: blocked. 6. Reading failed: attached for reading by hand.
select pg_temp.read('53','done','multiple_patients',jsonb_build_object('patientsSeen',2));
select pg_temp.ok(pg_temp.state('53')='blocked'and pg_temp.attached_to('53')is null,'Several people: blocked');
select pg_temp.read('54','failed',null,null);
select pg_temp.ok(pg_temp.state('54')='attached'and pg_temp.attached_to('54')=pg_temp.id('01'),'Reading failed: attached, the doctor reads it');
select pg_temp.ok((select count(distinct visit_id)=1 from public.clinic_result_attachments where file_id in(pg_temp.id('51'),pg_temp.id('54'))),'One visit per upload action');
-- 7. Booking rule: a booked-only member uses the booking; an old booking only means "Book a visit first".
select pg_temp.read('55','done','match',jsonb_build_object('memberId',pg_temp.id('03'),'nameOnSheet','Aram Booked','birthDateOnSheet','1970-02-02','nameMatch','yes','birthDateMatch','yes'));
select pg_temp.ok(pg_temp.state('55')='attached'and(select v.appointment_id=pg_temp.id('a1')and v.source='inferred-from-result-upload'
 from public.clinic_result_attachments x join public.patient_care_visits v on v.id=x.visit_id where x.file_id=pg_temp.id('55')),'Booked member: attached to the booking');
select pg_temp.ok(exists(select 1 from public.clinic_booking_checkins where appointment_id=pg_temp.id('a1')and outcome='completed'),'The booking is completed');
select pg_temp.read('56','done','match',jsonb_build_object('memberId',pg_temp.id('05'),'nameOnSheet','Old Booking','birthDateOnSheet','1980-03-03','nameMatch','yes','birthDateMatch','yes'));
select pg_temp.ok(pg_temp.state('56')='book-first'and pg_temp.attached_to('56')is null,'No recent booking and not the clinic''s own member: book first');

select pg_temp.as_user('0c');
set local role authenticated;
select pg_temp.ok(public.clinic_admin_member_file_attach(pg_temp.id('0a'),pg_temp.id('05'),pg_temp.id('56'),gen_random_uuid(),false,null,null)->>'status'='book-first','Attach by hand also says book first');
create temp table mu_try on commit drop as select public.clinic_admin_member_file_attach(pg_temp.id('0a'),pg_temp.id('01'),pg_temp.id('52'),pg_temp.id('81'),false,null,null)r;
select pg_temp.ok((select r->>'status'='mismatch'and r#>>'{compare,mismatch}'='birth_date'and r#>>'{compare,sheet,birthYearMatch}'='no' and r#>'{compare,member,birthDate}'='null'::jsonb from mu_try),
 'Without confirmation: mismatch retained with only sheet match outcomes and masked member birth date');
-- Astra A3-1 (20 Oct audit): the shared attach step refuses the same files when reached without these checks
-- (the legacy clinic_portal_result_attach and clinic_portal_lab_link call it directly).
reset role;
select pg_temp.ok(public._clinic_result_attach('clinic-admin',pg_temp.id('0c'),gen_random_uuid(),pg_temp.id('52'),pg_temp.id('01'),(select visit_id from public.clinic_result_attachments where file_id=pg_temp.id('51')),pg_temp.id('0a'))->>'status'='needs-review','Direct attach of a differing sheet: refused');
select pg_temp.ok(public._clinic_result_attach('clinic-admin',pg_temp.id('0c'),gen_random_uuid(),pg_temp.id('53'),pg_temp.id('01'),(select visit_id from public.clinic_result_attachments where file_id=pg_temp.id('51')),pg_temp.id('0a'))->>'status'='needs-review','Direct attach of a sheet with several people: refused');
select pg_temp.ok(pg_temp.attached_to('52')is null and pg_temp.attached_to('53')is null,'Nothing was attached');
-- R3: the guarded comparison: a clinic edit of the member's profile in the last day does not make a sheet match.
select pg_temp.ok(public._clinic_attach_refusal(pg_temp.id('51'),pg_temp.id('01'))is null,'A matching sheet may attach');
savepoint r3;
insert into public.clinic_member_profile_changes(clinic_id,actor_id,membership_id,member_id,submission_id,before,after)
 select pg_temp.id('0a'),pg_temp.id('0c'),m.id,pg_temp.id('01'),gen_random_uuid(),'{"name":"Someone Else","birthDate":"1975-04-05"}','{}'from public.clinic_portal_memberships m where m.user_id=pg_temp.id('0c')limit 1;
select pg_temp.ok(public._clinic_attach_refusal(pg_temp.id('51'),pg_temp.id('01'))='needs-review','After a clinic edit, the sheet is compared with the profile as it was');
rollback to savepoint r3;
-- R4: the legacy lab link refuses before it creates a visit.
create temp table r4 on commit drop as select(select count(*)from public.patient_care_visits where user_id=pg_temp.id('03'))visits,(select count(*)from public.clinic_booking_checkins)checkins;
select pg_temp.as_user('0c');
set local role authenticated;
select pg_temp.ok(public.clinic_portal_lab_link(pg_temp.id('0a'),jsonb_build_object('version','clinic-lab-link-v1','submissionId',gen_random_uuid(),'fileId',pg_temp.id('52'),'memberId',pg_temp.id('03')))->>'status'in('access','invalid','needs-review'),'Legacy lab link of another member''s record upload: refused');
reset role;
select pg_temp.ok((select visits from r4)=(select count(*)from public.patient_care_visits where user_id=pg_temp.id('03'))and(select checkins from r4)=(select count(*)from public.clinic_booking_checkins)and pg_temp.attached_to('52')is null,'No visit, check-in or attachment left behind');
select pg_temp.as_user('0c');
set local role authenticated;
select pg_temp.ok(public.clinic_admin_member_file_attach(pg_temp.id('0a'),pg_temp.id('01'),pg_temp.id('52'),pg_temp.id('82'),true,'Lab typed the year wrong',null)->>'status'='saved','Continue anyway attaches');
select pg_temp.ok(public.clinic_admin_member_file_attach(pg_temp.id('0a'),pg_temp.id('01'),pg_temp.id('52'),pg_temp.id('82'),true,'Lab typed the year wrong',null)->>'replayed'='true','A resend replays');
select pg_temp.ok(public.clinic_admin_member_file_attach(pg_temp.id('0a'),pg_temp.id('01'),pg_temp.id('53'),gen_random_uuid(),true,null,null)->>'status'='blocked','Several people cannot be confirmed');
select pg_temp.ok(public.clinic_admin_member_file_attach(pg_temp.id('0a'),pg_temp.id('03'),pg_temp.id('52'),gen_random_uuid(),true,null,null)->>'status'='invalid','A record upload cannot go to another member');

-- B1-1: on every clinic path, a file from 01's record cannot be attached to 03, even to 03's eligible booked visit.
reset role;
savepoint b11;
insert into public.clinic_batch_commands(actor_id,submission_id,session_id,clinic_id,batch_id,payload,state,result)values(pg_temp.id('0c'),pg_temp.id('6a'),gen_random_uuid(),pg_temp.id('0a'),pg_temp.id('41'),'{}','committed','{}');
set local session_replication_role=replica;
select pg_temp.file('5a','41');
set local session_replication_role=origin;
update public.clinic_batch_files set state='stored',created_at=clock_timestamp()where id=pg_temp.id('5a');
do $$begin
 perform public._clinic_result_attach('clinic-admin',pg_temp.id('0c'),gen_random_uuid(),pg_temp.id('5a'),pg_temp.id('03'),
  (select visit_id from public.clinic_result_attachments where file_id=pg_temp.id('55')),null);
 raise exception 'TEST Clinic path cannot attach a record upload to another member';
exception when insufficient_privilege then null;end$$;
select pg_temp.ok(pg_temp.attached_to('5a')is null,'Refused record upload left no attachment');
rollback to savepoint b11;

-- 8. An old file stuck in "Needs Noreon review": listed on the matching member's record, attached with the same check.
reset role;
select pg_temp.read('57','done','mismatch',jsonb_build_object('nameOnSheet','Петросян Анаит','birthDateOnSheet','1975-04-05','sampleDate','2026-10-10'));
select pg_temp.as_user('0c');
set local role authenticated;
create temp table mu_files on commit drop as select public.clinic_admin_member_files(pg_temp.id('0a'),pg_temp.id('01'))r;
select pg_temp.ok((select array_agg(x->>'fileId' order by x->>'fileId')=array[pg_temp.id('57')::text]from mu_files,jsonb_array_elements(r->'unmatched')x),'The stuck file appears on the matching member''s record');
select pg_temp.ok((select jsonb_array_length(r->'uploads')=4 from mu_files)and(select bool_and(x->>'override'='true')from mu_files,jsonb_array_elements(r->'uploads')x where x->>'fileId'=pg_temp.id('52')::text),'Record uploads listed, the override marked');
select pg_temp.ok(jsonb_array_length(public.clinic_admin_member_files(pg_temp.id('0a'),pg_temp.id('03'))->'unmatched')=0,'Not on another member''s record');
select pg_temp.ok(public.clinic_admin_member_file_attach(pg_temp.id('0a'),pg_temp.id('01'),pg_temp.id('57'),gen_random_uuid(),false,null,null)#>>'{compare,mismatch}'='name','A name in another script is a difference to confirm');
select pg_temp.ok(public.clinic_admin_member_file_attach(pg_temp.id('0a'),pg_temp.id('01'),pg_temp.id('57'),gen_random_uuid(),true,null,null)->>'status'='saved','The stuck file is attached');
reset role;
select pg_temp.ok(pg_temp.attached_to('57')=pg_temp.id('01'),'Stuck file attached to the member');

-- 9. Reading off: a stored file attaches at once.
update public.lab_ai_capabilities set enabled=false where singleton;
select pg_temp.store('58');
select pg_temp.ok(pg_temp.state('58')='attached'and pg_temp.attached_to('58')=pg_temp.id('01'),'Reading off: attached at once');
update public.lab_ai_capabilities set enabled=true where singleton;

-- 10. The override record and its audit.
select pg_temp.ok((select count(*)=2 from public.clinic_upload_overrides where member_id=pg_temp.id('01')),'Two overrides recorded');
select pg_temp.ok((select o.mismatch='birth_date'and o.reason='Lab typed the year wrong'and o.sheet->>'birthDate'='1986-03-25'and o.member_values->>'birthDate'='1975-04-05'
 and o.actor_id=pg_temp.id('0c')and o.clinic_id=pg_temp.id('0a')and o.file_id=pg_temp.id('52')from public.clinic_upload_overrides o where o.submission_id=pg_temp.id('82')),'Who, which file, both values, the type and the reason');
select pg_temp.ok((select o.reason is null and o.mismatch='name'from public.clinic_upload_overrides o where o.file_id=pg_temp.id('57')),'Reason is optional');
select pg_temp.ok(pg_temp.code($q$update public.clinic_upload_overrides set reason='x'$q$)='55000','Overrides are append-only');
select pg_temp.ok((select count(*)=2 from public.clinic_portal_audit where kind='member-file-override'),'Two overrides audited');
-- A generated visitId can contain 1986. Look for the full sheet birth date, not a substring of an ID.
select pg_temp.ok(not exists(select 1 from public.clinic_portal_audit where kind like 'member-file%'and detail::text like '%1986-03-25%'),'Overrides audited without the values');
select pg_temp.ok(exists(select 1 from public.access_audit where member_id=pg_temp.id('01')and surface='clinic_admin_files'and actor_role='clinic'),'Reading the files is in access_audit');

-- 11. Noreon oversight: admins only; every read audited. Doctors and clinic users cannot read the list.
select pg_temp.as_user('aa');
set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.admin_lab_upload_overrides()->'overrides')=2,'Admin sees every override');
select pg_temp.ok(jsonb_array_length(public.admin_lab_upload_overrides(null,null,null,'birth_date')->'overrides')=1,'Filter by mismatch type');
select pg_temp.ok(jsonb_array_length(public.admin_lab_upload_overrides(pg_temp.id('0b'))->'overrides')=0,'Filter by clinic');
-- The filter uses the Yerevan date; current_date (UTC) is a day behind it after 20:00 UTC.
select pg_temp.ok(jsonb_array_length(public.admin_lab_upload_overrides(null,(now() at time zone 'Asia/Yerevan')::date+1,null,null)->'overrides')=0,'Filter by date');
select pg_temp.ok(jsonb_array_length(public.admin_lab_upload_overrides(null,(now() at time zone 'Asia/Yerevan')::date,(now() at time zone 'Asia/Yerevan')::date,null)->'overrides')=2,'Filter by date: today in Yerevan');
select pg_temp.ok(jsonb_array_length(public.staff_member_upload_overrides(pg_temp.id('01')))=2,'Admin sees the member badge');
reset role;
select pg_temp.ok((select count(*)=5 from public.access_audit where surface='admin_upload_overrides'and actor_id=pg_temp.id('aa')),'Each oversight read is audited');
select pg_temp.as_user('d1');
set local role authenticated;
select pg_temp.ok(pg_temp.code($q$select public.admin_lab_upload_overrides()$q$)='42501','A doctor cannot read the oversight list');
select pg_temp.ok(jsonb_array_length(public.staff_member_upload_overrides(pg_temp.id('01')))=2,'The assigned doctor sees the badge');
reset role;
select pg_temp.as_user('d2');
set local role authenticated;
select pg_temp.ok(pg_temp.code($q$select public.staff_member_upload_overrides(pg_temp.id('01'))$q$)='42501','Another doctor does not');
reset role;
select pg_temp.as_user('0c');
set local role authenticated;
select pg_temp.ok(pg_temp.code($q$select public.admin_lab_upload_overrides()$q$)='42501','A clinic admin cannot read the oversight list');
select pg_temp.ok(pg_temp.code($q$select public.staff_member_upload_overrides(pg_temp.id('01'))$q$)='42501','A clinic admin cannot read the badge');
select pg_temp.ok(pg_temp.code($q$select public.lab_ai_file_target(gen_random_uuid())$q$)='42501','The worker target is service only');
reset role;
create temp table mu_jobs on commit drop as select file_id,id from public.lab_ai_jobs where kind='file';
grant select on mu_jobs to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select pg_temp.ok((select public.lab_ai_file_target(j.id)#>>'{target,memberId}'=pg_temp.id('01')::text from mu_jobs j where j.file_id=pg_temp.id('51')),'The worker learns the target member');
select pg_temp.ok((select public.lab_ai_file_target(j.id)->'target'='null'::jsonb from mu_jobs j where j.file_id=pg_temp.id('57')),'An ordinary batch file has no target');
reset role;

-- 12a. Review F2: only the admin who started an upload can add files; another person's file never attaches.
insert into public.clinic_batch_commands(actor_id,submission_id,session_id,clinic_id,batch_id,payload,state,result)
 values(pg_temp.id('0d'),pg_temp.id('c7'),gen_random_uuid(),pg_temp.id('0a'),pg_temp.id('45'),'{}','committed','{}'),(pg_temp.id('0c'),pg_temp.id('c8'),gen_random_uuid(),pg_temp.id('0a'),pg_temp.id('45'),'{}','committed','{}'),
 (pg_temp.id('0c'),pg_temp.id('c9'),gen_random_uuid(),pg_temp.id('0a'),pg_temp.id('47'),'{}','committed','{}');
create function pg_temp.file_by(f text,b text,actor text,membership text,sub text,made timestamptz) returns void language sql as $$
 insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state,created_at)
 values(pg_temp.id(f),pg_temp.id(b),gen_random_uuid(),gen_random_uuid(),pg_temp.id(actor),gen_random_uuid(),'[]',now(),pg_temp.id(membership),1,pg_temp.id(sub),'fictional-'||f||'.pdf','application/pdf',10,repeat('a',64),'fictional-mu/'||f,gen_random_uuid(),10,repeat('a',64),'reserved',made)
$$;
select pg_temp.ok(pg_temp.code($q$select pg_temp.file_by('61','45','0d','f2','c7',now())$q$)='42501','Clinic staff cannot add a file to an admin''s record upload');
set local session_replication_role=replica;
select pg_temp.file_by('61','45','0d','f2','c7',now());
set local session_replication_role=origin;
select pg_temp.store('61');
select pg_temp.ok(pg_temp.state('61')='paused'and pg_temp.attached_to('61')is null,'A file stored by someone else is never attached automatically');
select pg_temp.as_user('0c');
set local role authenticated;
select pg_temp.ok(public.clinic_admin_member_file_attach(pg_temp.id('0a'),pg_temp.id('01'),pg_temp.id('61'),gen_random_uuid(),true,null,null)->>'status'='invalid','Nor by hand');

-- 12b. Review F4: editing the member to match the sheet does not avoid the override.
create temp table mu_profile_request on commit drop as
 select public.clinic_admin_change_request(pg_temp.id('0a'),pg_temp.id('01'),'profile',gen_random_uuid(),
 '{"name":"Anahit Petrosyan","birthDate":"1975-04-05"}','{"name":"Anahit Petrosyan","birthDate":"1975-04-06"}')r;
select pg_temp.ok((select r->>'status'='pending'from mu_profile_request),'The immediate correction keeps the deployed response shape');
select pg_temp.as_user('aa');
select pg_temp.ok((select public.staff_clinic_change_decide((r->>'requestId')::uuid,'approve',null)->>'status'='not_pending'from mu_profile_request),'The correction is already applied without platform approval');
reset role;
select pg_temp.ok((select birth_date='1975-04-06'from public.profiles where id=pg_temp.id('01'))
 and(select count(*)=1 from public.clinic_member_profile_changes c join public.clinic_admin_change_requests r on r.submission_id=c.submission_id and r.requested_by=c.actor_id
 where r.id=(select(x.r->>'requestId')::uuid from mu_profile_request x)and c.before->>'birthDate'='1975-04-05'and c.after->>'birthDate'='1975-04-06'and c.approved_by is null),
 'Clinic correction applies immediately with exact history and no approver');
select pg_temp.file_by('59','45','0c','f1','c8',now());
select pg_temp.store('59');
select pg_temp.read('59','done','match',jsonb_build_object('memberId',pg_temp.id('01'),'nameOnSheet','Anahit Petrosyan','birthDateOnSheet','1975-04-06','nameMatch','yes','birthDateMatch','yes'));
select pg_temp.ok(pg_temp.state('59')='check'and pg_temp.attached_to('59')is null,'A sheet matching only the edited value waits for a check');
select pg_temp.as_user('0c');
set local role authenticated;
select pg_temp.ok(public.clinic_admin_member_file_attach(pg_temp.id('0a'),pg_temp.id('01'),pg_temp.id('59'),gen_random_uuid(),false,null,null)#>'{compare,member,birthDate}'='null'::jsonb,'The check masks the member value before the edit');
select pg_temp.ok(public.clinic_admin_member_file_attach(pg_temp.id('0a'),pg_temp.id('01'),pg_temp.id('59'),gen_random_uuid(),true,null,null)->>'status'='saved','Continue anyway');
reset role;
select pg_temp.ok((select mismatch='birth_date'and member_values->>'birthDate'='1975-04-05'and member_values->>'editedAt'is not null from public.clinic_upload_overrides where file_id=pg_temp.id('59')),
 'Recorded as an override with the pre-edit value');

-- 12c. Review F5 and F6: a reading still pending after 15 minutes no longer blocks; a record upload never closes a home visit.
update public.home_visit_settings set auto_close=true;
set local session_replication_role=replica;
insert into public.patient_test_requests(id,user_id,revision,status,requested_terms,requirements,algorithm_version,context_token,create_payload,current_arrangement)
 values(pg_temp.id('ab'),pg_temp.id('01'),2,'confirmed','{}','[]','v','t','{}',jsonb_build_object('terms',jsonb_build_object('mode','home','startsAt',now()-interval '1 hour')));
set local session_replication_role=origin;
select pg_temp.as_user('0c');
set local role authenticated;
select pg_temp.ok(public.clinic_admin_member_upload_register(pg_temp.id('0a'),pg_temp.id('01'),pg_temp.id('47'))->>'status'='registered','A new upload');
reset role;
select pg_temp.file_by('60','47','0c','f1','c9',now()-interval '20 minutes');
select pg_temp.store('60');
select pg_temp.ok((select state='queued'from public.lab_ai_jobs where kind='file'and file_id=pg_temp.id('60')),'The reading is still queued');
select pg_temp.ok(pg_temp.state('60')='attached'and pg_temp.attached_to('60')=pg_temp.id('01'),'After 15 minutes the file is attached for the doctor to read');
select pg_temp.ok((select status='confirmed'from public.patient_test_requests where id=pg_temp.id('ab')),'The home visit request stays confirmed');

-- 12. Switch off again: nothing new attaches automatically, and the RPCs refuse.
update public.clinic_portal_capabilities set clinic_admin_full_access=false where singleton;
select pg_temp.as_user('0c');
set local role authenticated;
select pg_temp.ok(public.clinic_admin_member_file_attach(pg_temp.id('0a'),pg_temp.id('05'),pg_temp.id('56'),gen_random_uuid(),false,null,null)->>'status'='disabled','Switched off: refused');
reset role;
select 'clinic member upload checks passed';
rollback;
