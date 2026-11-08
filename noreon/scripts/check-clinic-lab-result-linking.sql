-- Fictional checks for clinic lab result linking; all fixtures roll back.
-- Suggestions only among this clinic's booked members; link without arrival or samples; the booking
-- chosen by sample date or nearest past, else the clinic chooses; completion recorded once as inferred;
-- an existing nurse visit reused; several patients and other clinics' members refused; replay.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean,label text) returns void language plpgsql as $$begin
 if cond is distinct from true then raise exception 'TEST %',label;end if;
end$$;
-- c1ab: doctor 02, nurse 03, members 04 (A), 05 (B only), 06 (A, two recent bookings), 07 (A, nurse visit),
-- clinic-A user 08, clinic-B user 09; clinics A 10, B 11.
insert into auth.users(id,phone,phone_confirmed_at)select ('c1ab0000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,case when n between 4 and 7 then '37400097000'||n end,case when n between 4 and 7 then now()end from generate_series(2,9)n;
insert into auth.sessions(id,user_id,created_at,updated_at)select ('c1ab0000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid,('c1ab0000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,now(),now()from generate_series(2,9)n;
insert into public.workspace_clinics(id,name)values('c1ab0000-0000-4000-8000-000000000010','Synthetic clinic A'),('c1ab0000-0000-4000-8000-000000000011','Synthetic clinic B');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('c1ab0000-0000-4000-8000-000000000002','doctor','Synthetic link doctor','c1ab0000-0000-4000-8000-000000000010'),
 ('c1ab0000-0000-4000-8000-000000000003','nurse','Synthetic link nurse','c1ab0000-0000-4000-8000-000000000010');
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name)values
 ('c1ab0000-0000-4000-8000-000000000008','c1ab0000-0000-4000-8000-000000000010','Synthetic clinic A user'),
 ('c1ab0000-0000-4000-8000-000000000009','c1ab0000-0000-4000-8000-000000000011','Synthetic clinic B user');
update public.profiles p set display_name=x.n,birth_date=x.d from(values('c1ab0000-0000-4000-8000-000000000004'::uuid,'Synthetic Petrosyan','1970-01-02'::date),
 ('c1ab0000-0000-4000-8000-000000000005'::uuid,'Synthetic Other Clinic',null),('c1ab0000-0000-4000-8000-000000000006'::uuid,'Synthetic Two Bookings',null),('c1ab0000-0000-4000-8000-000000000007'::uuid,'Synthetic Nurse Visit',null))x(i,n,d)where p.id=x.i;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)select ('c1ab0000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'c1ab0000-0000-4000-8000-000000000002','c1ab0000-0000-4000-8000-000000000003' from generate_series(4,7)n;
insert into public.zoe_settings(singleton)values(true)on conflict do nothing;
update public.lab_ai_capabilities set enabled=true where singleton;
update public.doctor_completion_capabilities set enabled=true where singleton;
insert into public.clinic_portal_capabilities(singleton,result_attach_enabled)values(true,true)on conflict(singleton)do update set result_attach_enabled=true;

-- Bookings (replica: the booking machinery is not under test). Appointment ids c1ab...0a<n>.
set local session_replication_role=replica;
create function pg_temp.book(n int,member int,clinic int,starts timestamptz) returns void language plpgsql as $$
declare a uuid:=('c1ab0000-0000-4000-8000-0000000000a'||n)::uuid;nt uuid:=('c1ab0000-0000-4000-8000-0000000000b'||n)::uuid;r uuid:=('c1ab0000-0000-4000-8000-0000000000c'||n)::uuid;
 s uuid:=('c1ab0000-0000-4000-8000-0000000000d'||n)::uuid;m uuid:=('c1ab0000-0000-4000-8000-0000000000'||lpad(member::text,2,'0'))::uuid;c uuid:=('c1ab0000-0000-4000-8000-0000000000'||clinic)::uuid;
 arr jsonb:=jsonb_build_object('clinicId',c,'startsAt',starts,'coveredTestIds',jsonb_build_array('lipid-panel'));
begin
 insert into public.booking_program_seals(id,member_id,actor_id,source_token,requirements_token,engine_version,program)values(s,m,m,'t','t','synthetic',jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id','lipid-panel','title','Lipid profile','method','lab'))));
 insert into public.booking_appointments(id,member_id,program_id,requirements_token,revision,status,current_arrangement,proposed_arrangement,current_reservation_id,proposed_reservation_id,notice_id)values(a,m,s,'t'||n,1,'confirmed',arr,arr,r,r,nt);
 insert into public.booking_manual_reservations(id,appointment_id,capacity_key,offer_id,offer_version,member_id,valid_until)values(r,a,'synthetic',gen_random_uuid(),'1',m,now()+interval '1 year');
 insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,state,channel)values(nt,a,1,s,r,c,1,'accepted','portal');
 insert into public.booking_appointment_versions(appointment_id,revision,program_id,proposed_arrangement,notice_id,actor_id)values(a,1,s,arr,nt,m);
end$$;
select pg_temp.book(1,4,10,now()-interval '1 day');
select pg_temp.book(2,5,11,now()-interval '1 day');
select pg_temp.book(3,6,10,now()-interval '3 days');
select pg_temp.book(4,6,10,now()-interval '10 days');
select pg_temp.book(5,7,10,now()-interval '2 days');
select pg_temp.book(6,4,10,now()-interval '300 days');
-- Member 07 already has a nurse-recorded visit for booking 5.
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id,appointment_id,accepted_revision,booking_context,created_at)values
 ('c1ab0000-0000-4000-8000-000000000070','c1ab0000-0000-4000-8000-000000000007','c1ab0000-0000-4000-8000-000000000003','Synthetic link nurse','nurse','c1ab0000-0000-4000-8000-000000000010',
  'c1ab0000-0000-4000-8000-0000000000a5',1,'{"version":"booking-visit-context-v1"}',now()-interval '2 days');
insert into public.clinic_batches(id,clinic_id,name,uploader_id,uploader_name)values
 ('c1ab0000-0000-4000-8000-000000000041','c1ab0000-0000-4000-8000-000000000010','Synthetic A batch','c1ab0000-0000-4000-8000-000000000008','Synthetic A'),
 ('c1ab0000-0000-4000-8000-000000000042','c1ab0000-0000-4000-8000-000000000011','Synthetic B batch','c1ab0000-0000-4000-8000-000000000009','Synthetic B');
insert into public.clinic_batch_commands(actor_id,submission_id,session_id,clinic_id,batch_id,payload,state,result)
select 'c1ab0000-0000-4000-8000-000000000008',('c1ab0000-0000-4000-8000-0000000006'||n)::uuid,gen_random_uuid(),'c1ab0000-0000-4000-8000-000000000010','c1ab0000-0000-4000-8000-000000000041','{}','committed','{}'from generate_series(51,56)n;
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state,created_at)
select ('c1ab0000-0000-4000-8000-0000000000'||x.n)::uuid,x.b::uuid,gen_random_uuid(),gen_random_uuid(),'c1ab0000-0000-4000-8000-000000000008',gen_random_uuid(),'[]',now(),gen_random_uuid(),1,('c1ab0000-0000-4000-8000-0000000006'||x.n)::uuid,
 'synthetic-link-'||x.n||'.pdf','application/pdf',10,repeat('e',64),'synthetic-link/'||x.n,gen_random_uuid(),10,repeat('e',64),'reserved',now()-interval '1 hour'
from(values('51','c1ab0000-0000-4000-8000-000000000041'),('52','c1ab0000-0000-4000-8000-000000000041'),('53','c1ab0000-0000-4000-8000-000000000041'),('54','c1ab0000-0000-4000-8000-000000000041'),
 ('55','c1ab0000-0000-4000-8000-000000000041'),('56','c1ab0000-0000-4000-8000-000000000042'))x(n,b);
set local session_replication_role=origin;

-- Booking choice by sample date (Fable R1): member 12 has bookings 30, 7 and 2 days ago; member 13 one in 10 days.
set local session_replication_role=replica;
insert into auth.users(id)values('c1ab0000-0000-4000-8000-000000000012'),('c1ab0000-0000-4000-8000-000000000013');
set local session_replication_role=origin;
insert into public.profiles(id,display_name)values('c1ab0000-0000-4000-8000-000000000012','Synthetic Three Bookings'),('c1ab0000-0000-4000-8000-000000000013','Synthetic Upcoming')on conflict(id)do nothing;
insert into public.patient_clinical_cases(user_id)values('c1ab0000-0000-4000-8000-000000000012'),('c1ab0000-0000-4000-8000-000000000013');
set local session_replication_role=replica;
select pg_temp.book(7,12,10,now()-interval '30 days');
select pg_temp.book(8,12,10,now()-interval '7 days');
select pg_temp.book(9,12,10,now()-interval '2 days');
set local session_replication_role=origin;
create function pg_temp.pick(member int,sample date) returns text language sql as $$
 select case r->>'status'when 'one'then right(r->>'appointmentId',2)else r->>'status'end
 from(select public._lab_clinic_pick_booking('c1ab0000-0000-4000-8000-000000000010',('c1ab0000-0000-4000-8000-0000000000'||member)::uuid,sample)r)x
$$;
create function pg_temp.dday(n int) returns date language sql as $$select ((now()-make_interval(days=>n))at time zone 'Asia/Yerevan')::date$$;
select pg_temp.ok(pg_temp.pick(12,pg_temp.dday(7))='a8','sample on a booking day picks it');
select pg_temp.ok(pg_temp.pick(12,pg_temp.dday(6))='a8','a processing date a day later still picks the earlier visit');
select pg_temp.ok(pg_temp.pick(12,pg_temp.dday(29))='a7','29 days ago picks the 30-day booking');
select pg_temp.ok(pg_temp.pick(12,pg_temp.dday(45))='choose','no booking within 7 days before the sample: ask');
select pg_temp.ok(pg_temp.pick(12,null)='choose','no sample date and two recent bookings: ask');
select pg_temp.ok(pg_temp.pick(12,pg_temp.dday(1))='a9','yesterday''s sample picks the 2-day booking');
set local session_replication_role=replica;
select pg_temp.book(0,13,10,now()+interval '10 days');
set local session_replication_role=origin;
select pg_temp.ok(not exists(select 1 from public._lab_clinic_bookings('c1ab0000-0000-4000-8000-000000000010')where member_id='c1ab0000-0000-4000-8000-000000000013'),'a booking that has not started cannot take results (Fable R5)');

-- 1. A stored upload queues one file reading (the enqueue trigger on the store transition).
update public.clinic_batch_files set state='stored'where id::text like 'c1ab%';
select pg_temp.ok((select count(*)from public.lab_ai_jobs where kind='file'and file_id::text like 'c1ab%')=6,'each stored upload queues one file reading');
update public.clinic_batch_files set state='stored'where id::text like 'c1ab%';
select pg_temp.ok((select count(*)from public.lab_ai_jobs where kind='file'and file_id::text like 'c1ab%')=6,'no second reading for the same file');
select pg_temp.ok((select clinic_id from public.lab_ai_jobs where kind='file'and file_id='c1ab0000-0000-4000-8000-000000000056')='c1ab0000-0000-4000-8000-000000000011','the reading belongs to the uploading clinic');

-- 2. The worker can only suggest this clinic's booked members.
create function pg_temp.svc() returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
grant execute on function pg_temp.svc(),pg_temp.ok(boolean,text)to service_role,authenticated;
create temp table claimed(x jsonb);grant all on claimed to service_role,authenticated;
select pg_temp.svc();
set local role service_role;
insert into claimed select x from jsonb_array_elements(public.lab_ai_job_claim(5))x;
reset role;
select pg_temp.ok((select count(*)from claimed where x->>'kind'='file')>=1,'file readings are claimed');
select pg_temp.ok(not exists(select 1 from claimed c,jsonb_array_elements(c.x->'candidates')m where c.x->'file'->>'fileId'like 'c1ab%041%'or(c.x->>'kind'='file'and(select clinic_id from public.lab_ai_jobs where id=(c.x->>'jobId')::uuid)='c1ab0000-0000-4000-8000-000000000010'
 and m->>'memberId'='c1ab0000-0000-4000-8000-000000000005')),'clinic A candidates never include clinic B''s member');
select pg_temp.ok((select bool_and(jsonb_array_length(c.x->'candidates')=4)from claimed c where c.x->>'kind'='file'and(select clinic_id from public.lab_ai_jobs where id=(c.x->>'jobId')::uuid)='c1ab0000-0000-4000-8000-000000000010'),'clinic A sees its four booked members');
create function pg_temp.fin(n int,suggest jsonb,idst text default 'match') returns jsonb language plpgsql security definer as $$
declare j public.lab_ai_jobs;begin
 select * into j from public.lab_ai_jobs where kind='file'and file_id=('c1ab0000-0000-4000-8000-0000000000'||n)::uuid;
 if j.state<>'running'then update public.lab_ai_jobs set state='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=1 where id=j.id returning * into j;end if;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 return public.lab_ai_job_finish(j.id,j.lease_token,jsonb_build_object('disposition','done','outcome','suggested','pageCount',1,'sourceSha256',repeat('e',64),'identityStatus',idst,
  'identity',jsonb_build_object('nameOnSheet','Synthetic Petrosyan','sampleDate',null),'extraction',jsonb_build_object('patients','[]'::jsonb,'results','[]'::jsonb,'unreadable',false,'sampleDate',null,'labName',null),
  'suggestions',suggest,'provider','noreon.fake','model','noreon-fake-lab-1'));
end$$;
select pg_temp.ok(pg_temp.fin(51,jsonb_build_array(jsonb_build_object('memberId','c1ab0000-0000-4000-8000-000000000005','confidence','high','identityStatus','match')))->>'code'='invalid','a suggestion of another clinic''s member is refused');
select pg_temp.ok((pg_temp.fin(51,jsonb_build_array(jsonb_build_object('memberId','c1ab0000-0000-4000-8000-000000000004','confidence','high','identityStatus','match')))->>'ok')::boolean,'file 51 suggests member 04');
select pg_temp.ok((pg_temp.fin(53,'[]','multiple_patients')->>'ok')::boolean,'file 53 holds several people');
select pg_temp.ok((pg_temp.fin(55,'[]','mismatch')->>'ok')::boolean,'file 55 names nobody here');

-- 3. Clinic read: own batch only, suggestions and members limited to this clinic's bookings.
create function pg_temp.as_user(n int) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','c1ab0000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated','exp',4102444800,'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id','c1ab0000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::text,true)
$$;
create function pg_temp.link(n int,member int,sub text,appt int default null) returns jsonb language sql as $$
 select public.clinic_portal_lab_link('c1ab0000-0000-4000-8000-000000000010',jsonb_build_object('version','clinic-lab-link-v1','submissionId','c1ab0000-0000-4000-8000-0000000009'||sub,
  'fileId','c1ab0000-0000-4000-8000-0000000000'||n,'memberId','c1ab0000-0000-4000-8000-0000000000'||lpad(member::text,2,'0'))||case when appt is null then '{}'::jsonb else jsonb_build_object('appointmentId','c1ab0000-0000-4000-8000-0000000000a'||appt)end)
$$;
create function pg_temp.raises(statement text) returns boolean language plpgsql as $$begin execute statement;return false;exception when insufficient_privilege then return true;end$$;
create temp table r(label text primary key,v jsonb);grant all on r to authenticated;
grant execute on function pg_temp.as_user(int),pg_temp.link(int,int,text,int),pg_temp.raises(text)to authenticated;
select pg_temp.as_user(8);
set local role authenticated;
insert into r values('read',public.clinic_portal_lab_results('c1ab0000-0000-4000-8000-000000000010','c1ab0000-0000-4000-8000-000000000041'));
select pg_temp.ok(pg_temp.raises($q$select public.clinic_portal_lab_results('c1ab0000-0000-4000-8000-000000000010','c1ab0000-0000-4000-8000-000000000042')$q$),'clinic A cannot read clinic B''s batch through its own clinic');
select pg_temp.ok(pg_temp.raises($q$select public.clinic_portal_lab_results('c1ab0000-0000-4000-8000-000000000011','c1ab0000-0000-4000-8000-000000000042')$q$),'clinic A user is not a clinic B user');
insert into r values('cross',pg_temp.link(51,5,'01'));
insert into r values('several',pg_temp.link(53,4,'02'));
insert into r values('ok',pg_temp.link(51,4,'03'));
insert into r values('replay',pg_temp.link(51,4,'03'));
insert into r values('again',pg_temp.link(51,4,'04'));
insert into r values('choose',pg_temp.link(52,6,'05'));
insert into r values('chosen',pg_temp.link(52,6,'05',4));
insert into r values('nurse',pg_temp.link(54,7,'06'));
insert into r values('old',pg_temp.link(55,4,'07',6));
reset role;
select pg_temp.ok((select jsonb_array_length(v->'members')=4 and not(v::text like '%c1ab0000-0000-4000-8000-000000000005%')from r where label='read'),'members list is this clinic''s booked members only');
select pg_temp.ok((select f->'suggestion'->>'memberId'='c1ab0000-0000-4000-8000-000000000004'from r,jsonb_array_elements(v->'files')f where label='read'and f->>'fileId'='c1ab0000-0000-4000-8000-000000000051'),'the suggestion is shown');
select pg_temp.ok((select f->'reading'->>'identityStatus'='multiple_patients'from r,jsonb_array_elements(v->'files')f where label='read'and f->>'fileId'='c1ab0000-0000-4000-8000-000000000053'),'several people shown as such');
select pg_temp.ok((select v->>'status'='not-this-clinic'from r where label='cross'),'another clinic''s member cannot be linked');
select pg_temp.ok((select v->>'status'='needs-review'from r where label='several'),'a sheet with several people goes to Noreon');
select pg_temp.ok((select v->>'status'='saved'and(v->>'completed')::boolean from r where label='ok'),'linked without arrival or samples, booking completed');
select pg_temp.ok((select v->>'status'='saved'and(v->>'replayed')::boolean from r where label='replay'),'a resend replays');
select pg_temp.ok((select v->>'status'='stale'from r where label='again'),'a second link of a linked file is refused');
select pg_temp.ok((select v->>'status'='choose-visit'and jsonb_array_length(v->'options')=2 from r where label='choose'),'two recent bookings: the clinic chooses');
select pg_temp.ok((select v->>'status'='saved'from r where label='chosen'),'the chosen booking is linked');
select pg_temp.ok((select v->>'status'='saved'from r where label='nurse'),'a booking with a nurse visit links');
select pg_temp.ok((select v->>'status'='invalid'from r where label='old'),'a booking outside the window cannot be chosen');

-- 4. What was recorded: inferred visit and completion once, the right booking, nurse visit reused, audit.
select pg_temp.ok((select count(*)from public.patient_care_visits where user_id='c1ab0000-0000-4000-8000-000000000004'and source='inferred-from-result-upload'and actor_role='clinic'
 and actor_id='c1ab0000-0000-4000-8000-000000000008'and appointment_id='c1ab0000-0000-4000-8000-0000000000a1')=1,'one inferred visit by the clinic user for the booking');
select pg_temp.ok((select count(*)from public.clinic_booking_checkins where appointment_id='c1ab0000-0000-4000-8000-0000000000a1'and outcome='completed'and source='inferred-from-result-upload')=1,'completed once, as inferred');
select pg_temp.ok((select count(*)from public.clinic_booking_checkins where appointment_id='c1ab0000-0000-4000-8000-0000000000a4'and outcome='completed')=1
 and not exists(select 1 from public.clinic_booking_checkins where appointment_id='c1ab0000-0000-4000-8000-0000000000a3'),'only the chosen booking is completed');
-- The member's own booking read carries the completion, so Home moves on to results (QA N-02).
select set_config('request.jwt.claims',jsonb_build_object('sub','c1ab0000-0000-4000-8000-000000000004','role','authenticated')::text,true);
set local role authenticated;
select pg_temp.ok(public.booking_portal_details()#>>'{appointments,c1ab0000-0000-4000-8000-0000000000a1,checkin,outcome}'='completed','member read shows the visit completed by the result link');
reset role;
select pg_temp.ok((select visit_id from public.clinic_result_attachments where file_id='c1ab0000-0000-4000-8000-000000000054')='c1ab0000-0000-4000-8000-000000000070'
 and not exists(select 1 from public.patient_care_visits where user_id='c1ab0000-0000-4000-8000-000000000007'and source='inferred-from-result-upload'),'the nurse visit is reused');
select pg_temp.ok((select count(*)from public.lab_ai_jobs where kind='attachment'and file_id='c1ab0000-0000-4000-8000-000000000051')=1,'linking queues the member reading');
select pg_temp.ok((select count(*)from public.clinic_portal_audit where kind='lab-linked')=3 and(select count(*)from public.clinic_portal_audit where kind='lab-link-refused')=1,'links and refusals are audited');
select pg_temp.ok(not exists(select 1 from public.clinic_result_attachments where file_id='c1ab0000-0000-4000-8000-000000000053'),'nothing linked for the several-people sheet');
-- Constraints: an inferred visit needs the clinic role, and a clinic user cannot record "completed" by hand.
do $$begin
 begin insert into public.clinic_booking_checkins(clinic_id,appointment_id,reservation_id,outcome,actor_id,membership_id)select 'c1ab0000-0000-4000-8000-000000000010',id,current_reservation_id,'completed','c1ab0000-0000-4000-8000-000000000008',
  (select id from public.clinic_portal_memberships where user_id='c1ab0000-0000-4000-8000-000000000008')from public.booking_appointments where id='c1ab0000-0000-4000-8000-0000000000a3';
  raise exception 'TEST completed by hand was accepted';exception when check_violation then null;end;
 begin insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id)values(gen_random_uuid(),'c1ab0000-0000-4000-8000-000000000004','c1ab0000-0000-4000-8000-000000000008','x','clinic','c1ab0000-0000-4000-8000-000000000010');
  raise exception 'TEST a clinic visit without the inferred source was accepted';exception when check_violation then null;end;
end$$;
rollback;
\echo 'clinic lab result linking checks passed'
