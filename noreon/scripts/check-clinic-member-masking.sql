-- Clinic member privacy: fictional fixtures only, no external services, all changes roll back.
-- Run after a clean migration replay with psql -f scripts/check-clinic-member-masking.sql.
\set ON_ERROR_STOP on
begin;
create function pg_temp.cm_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.cm_id(n text) returns uuid language sql immutable as $$select('c0a50000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.cm_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cm_id(n),'role','authenticated','exp',4102444800,
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',('c0a50000-0000-4000-8000-0000000001'||n)::uuid)::text,true),
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
 pg_temp.cm_sqlstate(text),pg_temp.cm_keys(jsonb,text[]),pg_temp.cm_member(jsonb),pg_temp.cm_compare(jsonb) to authenticated,anon;

-- Clinics 0a/0b; portal A admin 0c, A staff 0d, B admin 0e; workspace admin aa, nurse e1.
-- Members 01 (A, phone+DOB), 02 (B only), 03 (assigned to A but no booking), 04 (A, no phone/DOB).
insert into auth.users(id,phone,phone_confirmed_at)
 select pg_temp.cm_id(n),case when n in('01','02','03')then '3749908'||n||'77'end,
 case when n in('01','02','03')then now()end from unnest(array['01','02','03','04','0c','0d','0e','d1','e1','aa'])n;
insert into auth.sessions(id,user_id,created_at,updated_at)
 select('c0a50000-0000-4000-8000-0000000001'||n)::uuid,pg_temp.cm_id(n),now(),now()from unnest(array['0c','0d','0e','aa'])n;
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

-- 1. Callable RPCs are authenticated-only, without an inherited PUBLIC/anon/service grant.
select pg_temp.cm_assert(has_function_privilege('authenticated','public.clinic_member_masked(uuid,uuid[])','execute')
 and not has_function_privilege('anon','public.clinic_member_masked(uuid,uuid[])','execute')
 and not has_function_privilege('service_role','public.clinic_member_masked(uuid,uuid[])','execute'),'Masked RPC grants');
-- PostgREST runs stable and immutable functions in a read-only transaction, where the clinic guards'
-- FOR SHARE locks fail; these checks run read-write, so assert the declared volatility instead.
select pg_temp.cm_assert(p.provolatile='v','Masked RPC is volatile (PostgREST read-write)')from pg_proc p where p.oid='public.clinic_member_masked(uuid,uuid[])'::regprocedure;
do $$declare bad text;begin
 -- Clinic RPCs that take a row lock themselves or through any chain of public helpers. (Five non-clinic
 -- stable RPCs on main do the same; they are reported to the lead separately, 5 Nov.)
 with recursive lockers(oid,proname)as(
  select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'and p.prosrc~*'for\s+(no\s+key\s+)?(share|update)\M'
  union
  select c.oid,c.proname from pg_proc c join pg_namespace n on n.oid=c.pronamespace join lockers l on c.prosrc~*('public\.'||l.proname||'\s*\(')
  where n.nspname='public')
 select string_agg(distinct f.proname,', 'order by f.proname)into bad from lockers l join pg_proc f on f.oid=l.oid
 where f.provolatile<>'v'and f.proname~'^_?clinic'and has_function_privilege('authenticated',f.oid,'execute');
 perform pg_temp.cm_assert(bad is null,'Stable or immutable clinic RPCs take a row lock (fails under PostgREST): '||coalesce(bad,''));
end$$;
select pg_temp.cm_assert(has_function_privilege('authenticated','public.clinic_admin_member_reveal(uuid,uuid,text)','execute')
 and not has_function_privilege('anon','public.clinic_admin_member_reveal(uuid,uuid,text)','execute')
 and not has_function_privilege('service_role','public.clinic_admin_member_reveal(uuid,uuid,text)','execute'),'Reveal RPC grants');

-- 2. Both portal roles: same released schemas, masked profile identity, unchanged matching.
create function pg_temp.cm_read_checks()returns void language plpgsql as $$
declare r jsonb;x jsonb;sc text;is_admin boolean:=auth.uid()=pg_temp.cm_id('0c');
begin
 r:=public.clinic_member_search(pg_temp.cm_id('0a'),'0177',1);
 perform pg_temp.cm_assert(pg_temp.cm_keys(r,array['version','enabled','members','total','page','pageSize'])and r->>'version'='clinic-member-search-v2'
  and r->>'total'='1'and r#>>'{members,0,memberId}'=pg_temp.cm_id('01')::text,'Search retains phone matching and envelope');
 perform pg_temp.cm_assert(pg_temp.cm_member(r#>'{members,0}')and pg_temp.cm_keys(r#>'{members,0}',array['memberId','name','phone','birthDate'])
  and r#>>'{members,0,name}'='Fictional Masking 01','Search masks values and preserves keys/name');
 r:=public.clinic_member_file(pg_temp.cm_id('0a'),pg_temp.cm_id('01'));
 perform pg_temp.cm_assert(pg_temp.cm_keys(r,array['version','enabled','status','member','bookings','checkins','visits','files'])
  and r->>'status'='ok'and pg_temp.cm_member(r->'member')and pg_temp.cm_keys(r->'member',array['memberId','name','phone','birthDate']),'Member file masks identity, keeps schema');
 r:=public.clinic_portal_lab_members(pg_temp.cm_id('0a'));
 perform pg_temp.cm_assert(pg_temp.cm_keys(r,array['version','enabled','capped','members'])and jsonb_array_length(r->'members')>0,'Lab members envelope and populated fixture');
 for x in select value from jsonb_array_elements(r->'members')loop
  perform pg_temp.cm_assert(pg_temp.cm_keys(x,array['memberId','name','birthDate','bookingAt'])and x->'birthDate'='null'::jsonb,'Lab members mask DOB only');
 end loop;
 r:=public.clinic_portal_lab_results(pg_temp.cm_id('0a'),pg_temp.cm_id('44'));
 perform pg_temp.cm_assert(pg_temp.cm_keys(r,array['version','enabled','reading','files','members'])and jsonb_array_length(r->'members')>0,'Lab results envelope');
 for x in select value from jsonb_array_elements(r->'members')loop
  perform pg_temp.cm_assert(pg_temp.cm_keys(x,array['memberId','name','birthDate','bookingAt'])and x->'birthDate'='null'::jsonb,'Lab result members mask DOB');
 end loop;
 x:=r#>'{files,0}';
 perform pg_temp.cm_assert(pg_temp.cm_keys(x,array['fileId','name','uploadedAt','linked','everLinked','reading','suggestion'])
  and pg_temp.cm_keys(x->'suggestion',array['memberId','confidence','name','birthDate'])and x#>'{suggestion,birthDate}'='null'::jsonb
  and x#>>'{suggestion,memberId}'=pg_temp.cm_id('01')::text,'Lab suggestion keeps match but masks DOB');
 perform pg_temp.cm_assert(pg_temp.cm_keys(x->'reading',array['state','outcome','identityStatus','nameMatch','birthYearMatch'])
  and x#>>'{reading,nameMatch}'='yes'and x#>>'{reading,birthYearMatch}'='yes','Reading carries match outcomes only');
 r:=public.clinic_portal_result_visits(pg_temp.cm_id('0a'));
 perform pg_temp.cm_assert(pg_temp.cm_keys(r,array['version','enabled','visits'])and jsonb_array_length(r->'visits')=1,'Portal result visits populated envelope');
 perform pg_temp.cm_assert(pg_temp.cm_keys(r#>'{visits,0}',array['visitId','memberName','visitedAt','reference','ambiguous'])
  and r#>>'{visits,0,memberName}'='Fictional Masking 01','Portal result visits retain exact non-identity shape');
 foreach sc in array array['upcoming','past']loop
  r:=public.clinic_schedule_bookings(pg_temp.cm_id('0a'),sc);
  perform pg_temp.cm_assert(pg_temp.cm_keys(r,array['version','enabled','role','bookings'])and jsonb_array_length(r->'bookings')>0,'Schedule envelope and nonempty scope');
  for x in select value from jsonb_array_elements(r->'bookings')loop
   perform pg_temp.cm_assert(pg_temp.cm_keys(x,array['appointmentId','memberId','revision','reference','kind','status','channel','memberName','memberPhone',
    'startsAt','endsAt','previousStartsAt','previousEndsAt','tests','proposal','rejectedProposal','decline']),'Schedule exact keys');
   perform pg_temp.cm_assert(x->'memberPhone'='null'::jsonb,'Every booking masks phone');
  end loop;
 end loop;
 r:=public.clinic_member_masked(pg_temp.cm_id('0a'),array[pg_temp.cm_id('01'),pg_temp.cm_id('01'),pg_temp.cm_id('02'),pg_temp.cm_id('03'),pg_temp.cm_id('04'),pg_temp.cm_id('ff')]);
 perform pg_temp.cm_assert(pg_temp.cm_keys(r,array['ok','members'])and r->'ok'='true'::jsonb and jsonb_array_length(r->'members')=case when is_admin then 3 else 2 end,'Masked list deduplicates; assigned-only needs admin full access; other clinic and unknown excluded');
 for x in select value from jsonb_array_elements(r->'members')loop
  perform pg_temp.cm_assert(pg_temp.cm_keys(x,array['memberId','phoneLast4','birthYear']),'Masked exact member keys');
  perform pg_temp.cm_assert(case x->>'memberId'when pg_temp.cm_id('01')::text then x->>'phoneLast4'='0177'and x->>'birthYear'='1975'
   when pg_temp.cm_id('03')::text then is_admin and x->>'phoneLast4'='0377'and x->>'birthYear'='1975'
   when pg_temp.cm_id('04')::text then x->'phoneLast4'='null'::jsonb and x->'birthYear'='null'::jsonb else false end,'Masked last four/year and missing identity');
 end loop;
 perform pg_temp.cm_assert(public.clinic_member_masked(pg_temp.cm_id('0a'),'{}'::uuid[])='{"ok":true,"members":[]}'::jsonb,'Empty mask request succeeds');
 perform pg_temp.cm_assert(public.clinic_member_masked(pg_temp.cm_id('0a'),null)='{"ok":false,"code":"invalid"}'::jsonb,'Null mask request is invalid');
 perform pg_temp.cm_assert(public.clinic_member_masked(pg_temp.cm_id('0a'),array(select gen_random_uuid()from generate_series(1,200)))->>'ok'='true','200 distinct IDs are accepted');
 perform pg_temp.cm_assert(public.clinic_member_masked(pg_temp.cm_id('0a'),array(select gen_random_uuid()from generate_series(1,201)))
  ='{"ok":false,"code":"invalid"}'::jsonb,'201 distinct requested IDs are invalid');
 perform pg_temp.cm_assert(public.clinic_member_masked(pg_temp.cm_id('0a'),array(select pg_temp.cm_id('01')from generate_series(1,201)))->>'ok'='true','Limit counts distinct IDs, not raw array length');
end$$;
grant execute on function pg_temp.cm_read_checks()to authenticated;
select pg_temp.cm_user('0c');
set local role authenticated;
select pg_temp.cm_read_checks();
reset role;
select pg_temp.cm_user('0d');
set local role authenticated;
select pg_temp.cm_read_checks();
select pg_temp.cm_assert(pg_temp.cm_sqlstate($q$select public.clinic_admin_patients(pg_temp.cm_id('0a'))$q$)='42501','Staff cannot list admin records');
select pg_temp.cm_assert(pg_temp.cm_sqlstate($q$select public.clinic_admin_patient_record(pg_temp.cm_id('0a'),pg_temp.cm_id('01'))$q$)='42501','Staff cannot read admin record');
select pg_temp.cm_assert(pg_temp.cm_sqlstate($q$select public.clinic_admin_member_files(pg_temp.cm_id('0a'),pg_temp.cm_id('01'))$q$)='42501','Staff cannot list admin files');
select pg_temp.cm_assert(pg_temp.cm_sqlstate($q$select public.clinic_result_attach_page(pg_temp.cm_id('0a'))$q$)='42501','Staff cannot use Noreon attach page');
reset role;

select pg_temp.cm_user('0c');
set local role authenticated;
do $$declare r jsonb;x jsonb;begin
 r:=public.clinic_admin_patients(pg_temp.cm_id('0a'),'0177');
 perform pg_temp.cm_assert(pg_temp.cm_keys(r,array['version','enabled','patients'])and jsonb_array_length(r->'patients')=1,'Admin list retains phone matching and schema');
 x:=r#>'{patients,0}';
 perform pg_temp.cm_assert(pg_temp.cm_keys(x,array['memberId','name','phone','birthDate','doctorName','nurseName'])and pg_temp.cm_member(x),'Admin list masks identity, preserves keys');
 r:=public.clinic_admin_patient_record(pg_temp.cm_id('0a'),pg_temp.cm_id('01'));
 perform pg_temp.cm_assert(pg_temp.cm_keys(r,array['version','enabled','status','member','consents','careTeam','bookings','visits','files','profileChanges','pendingRequests',
  'assessment','measurements','tests','results','plan','memberDocuments','reports'])and r->>'status'='ok','Admin record released envelope');
 perform pg_temp.cm_assert(pg_temp.cm_keys(r->'member',array['memberId','name','phone','birthDate','sex','locale','joinedAt','updatedAt'])
  and pg_temp.cm_member(r->'member')and r#>>'{member,name}'='Fictional Masking 01','Admin record masks contact but preserves member fields');
 perform pg_temp.cm_assert(jsonb_array_length(r->'profileChanges')=1,'Profile history fixture is populated');
 x:=r#>'{profileChanges,0}';
 perform pg_temp.cm_assert(pg_temp.cm_keys(x,array['at','by','before','after'])and pg_temp.cm_member(x->'before')and pg_temp.cm_member(x->'after')
  and pg_temp.cm_keys(x->'before',array['name','birthDate','phone'])and pg_temp.cm_keys(x->'after',array['name','birthDate','phone'])
  and x#>>'{before,name}'='Fictional Prior Name'and x#>>'{after,name}'='Fictional Masking 01','History preserves keys/name, masks before and after contact');
 r:=public.clinic_admin_member_files(pg_temp.cm_id('0a'),pg_temp.cm_id('01'));
 perform pg_temp.cm_assert(pg_temp.cm_keys(r,array['version','enabled','status','uploadAvailable','uploads','unmatched'])and r->>'status'='ok'
  and jsonb_array_length(r->'unmatched')=1,'Admin files retains unmatched matching and envelope');
 x:=r#>'{unmatched,0}';
 perform pg_temp.cm_assert(pg_temp.cm_keys(x,array['fileId','name','uploadedAt','fromRecord','state','attached','override','fileReading','memberReading','readingOn','compare','noValuesRead'])
  and pg_temp.cm_compare(x->'compare'),'Admin files presentation masks comparison member DOB');
 perform pg_temp.cm_assert(jsonb_typeof(x->'noValuesRead')='boolean','Admin files noValuesRead is a boolean');
 perform pg_temp.cm_assert(x#>>'{compare,sheet,nameMatch}'='no'and x#>>'{compare,sheet,birthYearMatch}'='yes'
  and x#>>'{compare,mismatch}'='both'and x#>'{compare,member,current}'is not null,'Sheet contains match outcomes; prior/current full-date mismatch remains intact');
 r:=public.clinic_admin_member_file_attach(pg_temp.cm_id('0a'),pg_temp.cm_id('01'),pg_temp.cm_id('51'),gen_random_uuid(),false);
 perform pg_temp.cm_assert(r->>'status'='mismatch'and pg_temp.cm_compare(r->'compare')
  and pg_temp.cm_keys(r#>'{compare,sheet}',array['nameMatch','birthYearMatch']),'Attach mismatch response contains only sheet outcomes');
 perform pg_temp.cm_assert(pg_temp.cm_sqlstate($q$select public.clinic_result_attach_page(pg_temp.cm_id('0a'))$q$)='42501','Portal admin cannot use Noreon attach page');
end$$;
reset role;

-- Internal matching is still complete; only presentation masks its member values.
select pg_temp.cm_assert(public._clinic_member_file_check(pg_temp.cm_id('0a'),pg_temp.cm_id('51'),pg_temp.cm_id('01'))#>>'{member,birthDate}'='1975-04-04'
 and public._clinic_member_file_check(pg_temp.cm_id('0a'),pg_temp.cm_id('51'),pg_temp.cm_id('01'))#>>'{member,current,birthDate}'='1975-04-05','Internal comparison keeps original and current DOB');
select pg_temp.cm_assert((select pg_temp.cm_compare(public._clinic_member_file_json(pg_temp.cm_id('0a'),pg_temp.cm_id('01'),f,'unmatched',false)->'compare')
 from public.clinic_batch_files f where id=pg_temp.cm_id('51')),'Internal JSON presentation masks nested member DOB');
-- Exercise the Noreon-only read with the workspace admin, keeping its existing schema.
select pg_temp.cm_user('aa');
set local role authenticated;
do $$declare r jsonb;begin
 r:=public.clinic_result_attach_page(pg_temp.cm_id('0a'));
 perform pg_temp.cm_assert(pg_temp.cm_keys(r,array['version','clinic','files','visits'])and jsonb_array_length(r->'files')=1 and jsonb_array_length(r->'visits')=1,'Noreon attach page retains populated released shape');
 perform pg_temp.cm_assert(pg_temp.cm_keys(r#>'{files,0}',array['id','name','batchName','uploadedAt','attachment'])
  and pg_temp.cm_keys(r#>'{visits,0}',array['visitId','memberId','memberName','visitedAt','atLab','collectedOnly','reference','ambiguous']),'Attach page exact file and visit keys');
end$$;
reset role;

-- Direct schedule rows: a confirmed past booking must not disclose contact, even before check-in.
select pg_temp.cm_assert((select public._clinic_schedule_row(pg_temp.cm_id('0a'),a)->'memberPhone'='null'::jsonb from public.booking_appointments a where id=pg_temp.cm_id('a1')),'Upcoming booking masks phone');
select pg_temp.cm_assert((select public._clinic_schedule_row(pg_temp.cm_id('0a'),a)->'memberPhone'='null'::jsonb from public.booking_appointments a where id=pg_temp.cm_id('a2')),'Past confirmed booking masks phone');
select pg_temp.cm_assert((select public._clinic_schedule_row(pg_temp.cm_id('0a'),a)->'memberPhone'='null'::jsonb from public.booking_appointments a where id=pg_temp.cm_id('a3')),'Cancelled upcoming booking masks phone');
select pg_temp.cm_assert((select public._clinic_schedule_row(pg_temp.cm_id('0a'),a)->'memberPhone'='null'::jsonb from public.booking_appointments a where id=pg_temp.cm_id('a6')),'Ended slot masks phone even within the upcoming calendar day');
select pg_temp.cm_assert((select public._clinic_schedule_row(pg_temp.cm_id('0b'),a)is null from public.booking_appointments a where id=pg_temp.cm_id('a1')),'Another clinic cannot read schedule row');

select pg_temp.cm_assert((select public._clinic_schedule_row(pg_temp.cm_id('0a'),a)->>'status'='completed'
 and public._clinic_schedule_row(pg_temp.cm_id('0a'),a)->'memberPhone'='null'::jsonb from public.booking_appointments a where id=pg_temp.cm_id('a7')),'A completed visit masks the phone even before its slot ends (all bookings mask it)');

-- 3. Live authorization: wrong clinic, staff reveal, disabled switches and revoked membership.
select pg_temp.cm_user('0e');
set local role authenticated;
select pg_temp.cm_assert(public.clinic_member_masked(pg_temp.cm_id('0a'),array[pg_temp.cm_id('01')])='{"ok":false,"code":"access"}'::jsonb,'B actor cannot request A masks');
select pg_temp.cm_assert(public.clinic_admin_member_reveal(pg_temp.cm_id('0a'),pg_temp.cm_id('01'),'Fictional reason')='{"ok":false,"code":"access"}'::jsonb,'B actor cannot reveal at A');
reset role;
select pg_temp.cm_user('0d');
set local role authenticated;
select pg_temp.cm_assert(public.clinic_admin_member_reveal(pg_temp.cm_id('0a'),pg_temp.cm_id('01'),'Fictional reason')='{"ok":false,"code":"access"}'::jsonb,'Staff reveal refused');
reset role;
update public.clinic_portal_capabilities set clinic_admin_full_access=false where singleton;
select pg_temp.cm_user('0c');
set local role authenticated;
select pg_temp.cm_assert(public.clinic_admin_member_reveal(pg_temp.cm_id('0a'),pg_temp.cm_id('01'),'Fictional reason')='{"ok":false,"code":"disabled"}'::jsonb,'Full access switch gates reveal');
select pg_temp.cm_assert(public.clinic_member_masked(pg_temp.cm_id('0a'),array[pg_temp.cm_id('03')])='{"ok":true,"members":[]}'::jsonb,'Full access off removes assigned-only masks');
reset role;
update public.clinic_portal_capabilities set clinic_admin_full_access=true where singleton;
update public.clinic_scheduling_capabilities set enabled=false where singleton;
set local role authenticated;
select pg_temp.cm_assert(public.clinic_member_masked(pg_temp.cm_id('0a'),array[pg_temp.cm_id('01')])#>>'{members,0,phoneLast4}'='0177','Scheduling off does not remove partial values from independently enabled records or lab matching');
reset role;
update public.clinic_scheduling_capabilities set enabled=true where singleton;
update public.clinic_portal_memberships set active=false where id=pg_temp.cm_id('f1');
set local role authenticated;
select pg_temp.cm_assert(public.clinic_member_masked(pg_temp.cm_id('0a'),array[pg_temp.cm_id('01')])='{"ok":false,"code":"access"}'::jsonb,'Revoked membership refuses masks');
select pg_temp.cm_assert(public.clinic_admin_member_reveal(pg_temp.cm_id('0a'),pg_temp.cm_id('01'),'Fictional reason')='{"ok":false,"code":"access"}'::jsonb,'Revoked membership refuses reveal');
reset role;
update public.clinic_portal_memberships set active=true where id=pg_temp.cm_id('f1');
update auth.sessions set not_after=now()-interval '1 minute'where user_id=pg_temp.cm_id('0c');
set local role authenticated;
select pg_temp.cm_assert(public.clinic_member_masked(pg_temp.cm_id('0a'),array[pg_temp.cm_id('01')])='{"ok":false,"code":"access"}'::jsonb,'Expired live session refuses masks');
select pg_temp.cm_assert(public.clinic_admin_member_reveal(pg_temp.cm_id('0a'),pg_temp.cm_id('01'),'Fictional reason')='{"ok":false,"code":"access"}'::jsonb,'Expired live session refuses reveal');
reset role;
update auth.sessions set not_after=null where user_id=pg_temp.cm_id('0c');

-- 4. Reasons, visibility and audited reveal. Rejections must not consume an allowance.
select pg_temp.cm_user('0c');
set local role authenticated;
do $$declare reason text;begin
 foreach reason in array array[null::text,'','    ','abcd',repeat('a',501)]loop
  perform pg_temp.cm_assert(public.clinic_admin_member_reveal(pg_temp.cm_id('0a'),pg_temp.cm_id('01'),reason)
   ='{"ok":false,"code":"reason_required"}'::jsonb,'Missing, whitespace, short and overlong reasons refused');
 end loop;
 perform pg_temp.cm_assert(public.clinic_admin_member_reveal(pg_temp.cm_id('0a'),pg_temp.cm_id('02'),'Fictional reason')
  ='{"ok":false,"code":"refused"}'::jsonb,'Other clinic member reveal refused');
 perform pg_temp.cm_assert(public.clinic_admin_member_reveal(pg_temp.cm_id('0a'),pg_temp.cm_id('ff'),'Fictional reason')
  ='{"ok":false,"code":"refused"}'::jsonb,'Unknown member reveal refused');
end$$;
reset role;
select pg_temp.cm_assert(not exists(select 1 from public.clinic_portal_audit where actor_id=pg_temp.cm_id('0c')and kind='member_reveal')
 and not exists(select 1 from public.access_audit where actor_id=pg_temp.cm_id('0c')and surface='clinic_member_reveal'),'Rejected reveals write no success audit');
set local role authenticated;
select pg_temp.cm_assert(public.clinic_admin_member_reveal(pg_temp.cm_id('0a'),pg_temp.cm_id('01'),'  Fictional contact correction  ')
 ='{"ok":true,"phone":"+37499080177","birthDate":"1975-04-05"}'::jsonb,'Valid reveal returns exact complete identity');
reset role;
select pg_temp.cm_assert((select count(*)=1 and bool_and(clinic_id=pg_temp.cm_id('0a')and detail->>'reason'='Fictional contact correction'
 and detail->>'memberId'=pg_temp.cm_id('01')::text)from public.clinic_portal_audit where actor_id=pg_temp.cm_id('0c')and kind='member_reveal'),'One portal audit with trimmed reason');
select pg_temp.cm_assert((select count(*)=1 and bool_and(member_id=pg_temp.cm_id('01')and actor_role='clinic')from public.access_audit
 where actor_id=pg_temp.cm_id('0c')and surface='clinic_member_reveal'),'One access audit per successful reveal');
set local role authenticated;
do $$begin
 for n in 2..30 loop
  perform pg_temp.cm_assert(public.clinic_admin_member_reveal(pg_temp.cm_id('0a'),pg_temp.cm_id('01'),'Fictional rate check')->>'ok'='true','First thirty reveals succeed');
 end loop;
 perform pg_temp.cm_assert(public.clinic_admin_member_reveal(pg_temp.cm_id('0a'),pg_temp.cm_id('01'),'Fictional excess request')
  ='{"ok":false,"code":"rate_limited"}'::jsonb,'31st reveal in rolling hour is rate limited');
end$$;
reset role;
select pg_temp.cm_assert((select count(*)=30 from public.clinic_portal_audit where actor_id=pg_temp.cm_id('0c')and kind='member_reveal')
 and(select count(*)=30 from public.access_audit where actor_id=pg_temp.cm_id('0c')and surface='clinic_member_reveal'),'Rate-limited request adds neither audit row');

-- Old reveal events do not consume the rolling allowance, and another actor has an independent allowance.
insert into public.clinic_portal_audit(clinic_id,actor_id,kind,detail,created_at)
 select pg_temp.cm_id('0b'),pg_temp.cm_id('0e'),'member_reveal',jsonb_build_object('memberId',pg_temp.cm_id('02'),'reason','Fictional old reveal'),
 clock_timestamp()-interval '2 hours'from generate_series(1,30);
select pg_temp.cm_user('0e');
set local role authenticated;
select pg_temp.cm_assert(public.clinic_admin_member_reveal(pg_temp.cm_id('0b'),pg_temp.cm_id('02'),'Fictional independent allowance')
 ='{"ok":true,"phone":"+37499080277","birthDate":"1975-04-05"}'::jsonb,'Older than one hour and another actor do not consume allowance');
reset role;
select pg_temp.cm_assert((select count(*)=1 from public.clinic_portal_audit where actor_id=pg_temp.cm_id('0e')and kind='member_reveal'and created_at>clock_timestamp()-interval '1 hour')
 and(select count(*)=1 from public.access_audit where actor_id=pg_temp.cm_id('0e')and surface='clinic_member_reveal'),'Independent actor also gets exactly one new audit pair');

-- 4b. Phone search matches only the last 4 digits the clinic already sees, so trying
-- prefixes cannot rebuild a hidden number (review CM-1).
select pg_temp.cm_user('0e');
set local role authenticated;
do $$
declare suffix text;candidate text;found_digit boolean;r jsonb;
begin
 r:=public.clinic_member_masked(pg_temp.cm_id('0b'),array[pg_temp.cm_id('02')]);
 suffix:=r#>>'{members,0,phoneLast4}';
 perform pg_temp.cm_assert(suffix='0277','Masked read gives the last 4 digits');
 loop
  found_digit:=false;
  for digit in 0..9 loop
   candidate:=digit::text||suffix;
   r:=public.clinic_member_search(pg_temp.cm_id('0b'),candidate,1);
   if exists(select 1 from jsonb_array_elements(r->'members')x where x->>'memberId'=pg_temp.cm_id('02')::text)then
    suffix:=candidate;found_digit:=true;exit;
   end if;
  end loop;
  exit when not found_digit;
 end loop;
 perform pg_temp.cm_assert(suffix='0277','Prefix guessing through member search recovers nothing beyond the last 4 digits');
 perform pg_temp.cm_assert(not exists(select 1 from jsonb_array_elements(public.clinic_member_search(pg_temp.cm_id('0b'),'+37499080277',1)->'members')x
  where x->>'memberId'=pg_temp.cm_id('02')::text),'The full number does not search');
 perform pg_temp.cm_assert(not exists(select 1 from jsonb_array_elements(public.clinic_admin_patients(pg_temp.cm_id('0b'),'80277')->'patients')x
  where x->>'memberId'=pg_temp.cm_id('02')::text)
  and not exists(select 1 from jsonb_array_elements(public.clinic_admin_patients(pg_temp.cm_id('0b'),'+37499080277')->'patients')x
  where x->>'memberId'=pg_temp.cm_id('02')::text),'Admin patient filter does not match hidden digits');
end$$;
reset role;
select pg_temp.cm_assert(not exists(select 1 from public.clinic_portal_audit where actor_id=pg_temp.cm_id('0e')and kind='member_reveal'
 and detail->>'reason' is distinct from 'Fictional independent allowance'and created_at>clock_timestamp()-interval '1 hour'),'Searching creates no reveal');
select pg_temp.cm_user('0d');
set local role authenticated;
select pg_temp.cm_assert(exists(select 1 from jsonb_array_elements(public.clinic_member_search(pg_temp.cm_id('0a'),'0177',1)->'members')x where x->>'memberId'=pg_temp.cm_id('01')::text)
 and not exists(select 1 from jsonb_array_elements(public.clinic_member_search(pg_temp.cm_id('0a'),'80177',1)->'members')x where x->>'memberId'=pg_temp.cm_id('01')::text),
 'Staff find a member by the last 4 digits but not by a longer run');
reset role;

-- 5. Anonymous callers cannot execute either RPC, including with a copied member ID.
select set_config('request.jwt.claims','{"role":"anon"}',true),set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.cm_assert(pg_temp.cm_sqlstate($q$select public.clinic_member_masked(pg_temp.cm_id('0a'),array[pg_temp.cm_id('01')])$q$)='42501','Anon mask execute denied');
select pg_temp.cm_assert(pg_temp.cm_sqlstate($q$select public.clinic_admin_member_reveal(pg_temp.cm_id('0a'),pg_temp.cm_id('01'),'Fictional reason')$q$)='42501','Anon reveal execute denied');
reset role;
select 'clinic member masking checks passed';
rollback;
