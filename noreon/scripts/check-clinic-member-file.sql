-- Clinic member search and member file: who can be found, what the file holds, what it
-- never holds, and the audit of opens and downloads. Fictional data; rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.mf_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.mf_reject(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected rejection % for %',expected,q;
end$$;
-- c6f0: members 01 (booked at A), 02 (booked at B only), 03 (A's PDFs: one moved to 01, one unlinked), 04 (never booked);
-- clinic A staff 06, clinic B admin 09, nurse 08; clinics A 0a, B 0b.
create function pg_temp.mf_id(n text) returns uuid language sql immutable as $$select('c6f00000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.mf_id(n),'role','authenticated','exp',4102444800,'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',('c6f00000-0000-4000-8000-0000000001'||n)::uuid)::text,true),
  set_config('request.jwt.claim.sub',pg_temp.mf_id(n)::text,true)
$$;
grant execute on function pg_temp.mf_id(text),pg_temp.as_user(text),pg_temp.mf_assert(boolean,text),pg_temp.mf_reject(text,text) to authenticated,service_role;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.mf_id(n),case when n in('01','02','03','04')then '3749907'||n||'77'end,case when n in('01','02','03','04')then now()end from unnest(array['01','02','03','04','06','08','09'])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select('c6f00000-0000-4000-8000-0000000001'||n)::uuid,pg_temp.mf_id(n),now(),now()from unnest(array['06','09'])n;
update public.profiles set display_name='Fictional Narek '||right(id::text,2),birth_date='1981-02-03' where id in(pg_temp.mf_id('01'),pg_temp.mf_id('02'),pg_temp.mf_id('03'),pg_temp.mf_id('04'));
insert into public.patient_clinical_cases(user_id)values(pg_temp.mf_id('01')),(pg_temp.mf_id('02')),(pg_temp.mf_id('03')),(pg_temp.mf_id('04'));
insert into public.workspace_clinics(id,name,address)values(pg_temp.mf_id('0a'),'Fictional clinic A','1 Fictional Street'),(pg_temp.mf_id('0b'),'Fictional clinic B','2 Fictional Street');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.mf_id('08'),'nurse','Fictional nurse',pg_temp.mf_id('0a'));
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name,role)values(pg_temp.mf_id('06'),pg_temp.mf_id('0a'),'Fictional A staff','staff'),(pg_temp.mf_id('09'),pg_temp.mf_id('0b'),'Fictional B admin','admin');
update public.clinic_scheduling_capabilities set enabled=true;
-- Bookings: member 01 at A (with a nurse visit and one sample with results), member 02 at B. Inserted directly.
set local session_replication_role=replica;
insert into public.booking_appointments(id,member_id,program_id,requirements_token,revision,status,proposed_arrangement,proposed_reservation_id,notice_id,current_arrangement)
select pg_temp.mf_id(x.a),pg_temp.mf_id(x.m),pg_temp.mf_id('5'||right(x.a,1)),'r'||x.a,0,'confirmed',jsonb_build_object('clinicId',pg_temp.mf_id(x.c),'startsAt',now()+interval '1 day','endsAt',now()+interval '1 day 30 minutes','coveredTestIds','[]'::jsonb),
 pg_temp.mf_id('6'||right(x.a,1)),pg_temp.mf_id('7'||right(x.a,1)),jsonb_build_object('clinicId',pg_temp.mf_id(x.c),'startsAt',now()+interval '1 day','endsAt',now()+interval '1 day 30 minutes','coveredTestIds','[]'::jsonb)
from(values('31','01','0a'),('32','02','0b'))x(a,m,c);
insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,channel,purpose,state)
select pg_temp.mf_id('7'||right(x.a,1)),pg_temp.mf_id(x.a),0,pg_temp.mf_id('5'||right(x.a,1)),pg_temp.mf_id('6'||right(x.a,1)),pg_temp.mf_id(x.c),0,'portal','booking','accepted'from(values('31','0a'),('32','0b'))x(a,c);
insert into public.booking_appointment_versions(appointment_id,revision,program_id,proposed_arrangement,notice_id,actor_id)
select a.id,0,a.program_id,a.proposed_arrangement,a.notice_id,a.member_id from public.booking_appointments a where a.id in(pg_temp.mf_id('31'),pg_temp.mf_id('32'));
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id,appointment_id,accepted_revision,booking_context)values
 (pg_temp.mf_id('41'),pg_temp.mf_id('01'),pg_temp.mf_id('08'),'Fictional nurse','nurse',pg_temp.mf_id('0a'),pg_temp.mf_id('31'),0,'{"version":"booking-visit-context-v1"}');
insert into public.patient_care_visit_entries(id,user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id)values
 (pg_temp.mf_id('42'),pg_temp.mf_id('01'),pg_temp.mf_id('41'),pg_temp.mf_id('43'),1,jsonb_build_object('kind','collection','observedAt','2026-10-16T08:00:00+04:00','appointmentId',pg_temp.mf_id('31'),'acceptedRevision',0,'testId','lipid-panel','outcome','collected'),
  '2026-10-16T08:00:00+04:00','2026-10-16T04:00:00Z',pg_temp.mf_id('08'),'Fictional nurse','nurse',pg_temp.mf_id('0a'));
insert into public.patient_care_lab_stages(user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id)values
 (pg_temp.mf_id('01'),pg_temp.mf_id('42'),'at-lab',gen_random_uuid(),now()-interval '2 hours',pg_temp.mf_id('08'),'Fictional nurse','nurse',pg_temp.mf_id('0a'));
-- Clinic A PDFs: 51 linked to 01; 52 linked to 03 then moved to 01; 53 linked to 03 then unlinked. Clinic B PDF 54 linked to 01.
insert into public.clinic_batches(id,clinic_id,name,uploader_id,uploader_name)values(pg_temp.mf_id('44'),pg_temp.mf_id('0a'),'Fictional A batch',pg_temp.mf_id('06'),'Fictional A staff'),(pg_temp.mf_id('45'),pg_temp.mf_id('0b'),'Fictional B batch',pg_temp.mf_id('09'),'Fictional B admin');
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state)
select pg_temp.mf_id(x.n),pg_temp.mf_id(x.b),gen_random_uuid(),gen_random_uuid(),pg_temp.mf_id('06'),gen_random_uuid(),'[]',now(),gen_random_uuid(),1,gen_random_uuid(),'fictional-'||x.n||'.pdf','application/pdf',10,repeat('b',64),'fictional-mf/'||x.n,gen_random_uuid(),10,repeat('b',64),'stored'
from(values('51','44'),('52','44'),('53','44'),('54','45'))x(n,b);
insert into public.clinic_result_attachments(id,file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id,created_at)values
 (pg_temp.mf_id('61'),pg_temp.mf_id('51'),pg_temp.mf_id('0a'),pg_temp.mf_id('01'),pg_temp.mf_id('41'),'noreon-admin',pg_temp.mf_id('08'),gen_random_uuid(),now()-interval '3 hours'),
 (pg_temp.mf_id('62'),pg_temp.mf_id('52'),pg_temp.mf_id('0a'),pg_temp.mf_id('03'),pg_temp.mf_id('41'),'noreon-admin',pg_temp.mf_id('08'),gen_random_uuid(),now()-interval '3 hours'),
 (pg_temp.mf_id('63'),pg_temp.mf_id('52'),pg_temp.mf_id('0a'),pg_temp.mf_id('01'),pg_temp.mf_id('41'),'noreon-admin',pg_temp.mf_id('08'),gen_random_uuid(),now()-interval '2 hours'),
 (pg_temp.mf_id('64'),pg_temp.mf_id('53'),pg_temp.mf_id('0a'),pg_temp.mf_id('03'),pg_temp.mf_id('41'),'noreon-admin',pg_temp.mf_id('08'),gen_random_uuid(),now()-interval '3 hours'),
 (pg_temp.mf_id('65'),pg_temp.mf_id('54'),pg_temp.mf_id('0b'),pg_temp.mf_id('01'),pg_temp.mf_id('41'),'noreon-admin',pg_temp.mf_id('08'),gen_random_uuid(),now()-interval '3 hours');
insert into public.clinic_result_detachments(attachment_id,actor_id,submission_id,reason)values(pg_temp.mf_id('64'),pg_temp.mf_id('08'),gen_random_uuid(),'Fictional wrong member');
set local session_replication_role=origin;

-- 1. Search: only members known to this clinic, by name or phone; search text never audited.
select pg_temp.as_user('06');
set local role authenticated;
select pg_temp.mf_assert((select array_agg(m->>'memberId' order by m->>'memberId')from jsonb_array_elements(public.clinic_member_search(pg_temp.mf_id('0a'),'Narek')->'members')m)
 =array[pg_temp.mf_id('01')::text],'Clinic A finds only its member: not B''s, not unknown, not one whose PDF was moved away or unlinked');
select pg_temp.mf_assert(jsonb_array_length(public.clinic_member_search(pg_temp.mf_id('0a'),'0277')->'members')=0,'Phone search does not reach member 02 (booked at B only)');
select pg_temp.mf_assert(public.clinic_member_search(pg_temp.mf_id('0a'),'0177')#>>'{members,0,memberId}'=pg_temp.mf_id('01')::text,'Phone search by the last 4 digits');
select pg_temp.mf_assert(jsonb_array_length(public.clinic_member_search(pg_temp.mf_id('0a'),'%%')->'members')=0,'Wildcards are literal');
select pg_temp.mf_assert(public.clinic_member_search(pg_temp.mf_id('0a'),'N')#>>'{members,0,memberId}'=pg_temp.mf_id('01')::text,'One letter filters (no minimum length since 18 Oct)');
select pg_temp.mf_reject($q$select public.clinic_member_search(pg_temp.mf_id('0a'),repeat('N',101))$q$,'22023');
reset role;
select pg_temp.mf_assert(not exists(select 1 from public.clinic_portal_audit where kind='member-search'and detail::text like '%Narek%'),'Search text is not stored in the audit');
select pg_temp.mf_assert((select count(*)=5 from public.clinic_portal_audit where kind='member-search'and clinic_id=pg_temp.mf_id('0a')),'Each search is audited');

-- 2. The file: own bookings, visits, PDFs; nothing from clinic B; opening audited.
select pg_temp.as_user('06');
set local role authenticated;
create temp table mf_file as select public.clinic_member_file(pg_temp.mf_id('0a'),pg_temp.mf_id('01')) f;
select pg_temp.mf_assert((select f#>'{member,phone}'='null'::jsonb and f#>'{member,birthDate}'='null'::jsonb from mf_file),'Member phone and date of birth keys remain masked');
select pg_temp.mf_assert((select jsonb_array_length(f->'bookings')=1 and f#>>'{bookings,0,appointmentId}'=pg_temp.mf_id('31')::text from mf_file),'Only clinic A bookings');
select pg_temp.mf_assert((select f#>>'{bookings,0,memberId}'=pg_temp.mf_id('01')::text from mf_file),'Booking rows carry the member id for the file link');
select pg_temp.mf_assert((select f#>>'{visits,0,samples}'='1'and f#>>'{visits,0,atLab}'='1'and f#>>'{visits,0,resultsReceived}'='0'from mf_file),'Visit lab progress');
select pg_temp.mf_assert((select array_agg(x->>'fileId' order by x->>'fileId')=array[pg_temp.mf_id('51')::text,pg_temp.mf_id('52')::text]and bool_and(x->>'visitedAt'is not null)from mf_file,jsonb_array_elements(f->'files')x),'Clinic A PDFs linked to this member, including one moved here; never clinic B''s');
select pg_temp.mf_assert((select not(f?'questionnaire')and not(f?'answers')and not(f?'plan')and f::text not like '%Fictional B%'from mf_file),'Nothing medical beyond tests, nothing from clinic B');
select pg_temp.mf_assert(public.clinic_member_file(pg_temp.mf_id('0a'),pg_temp.mf_id('03'))->>'status'='refused','A member whose only PDFs were moved away or unlinked is refused');
-- Refused: unknown member, another clinic's member, another clinic.
select pg_temp.mf_assert(public.clinic_member_file(pg_temp.mf_id('0a'),pg_temp.mf_id('04'))->>'status'='refused','Unknown member refused');
select pg_temp.mf_assert(public.clinic_member_file(pg_temp.mf_id('0a'),pg_temp.mf_id('02'))->>'status'='refused','Another clinic''s member refused the same way');
select pg_temp.mf_reject($q$select public.clinic_member_file(pg_temp.mf_id('0b'),pg_temp.mf_id('02'))$q$,'42501');
reset role;
select pg_temp.mf_assert((select count(*)=3 from public.clinic_portal_audit where kind='member-file-refused'and clinic_id=pg_temp.mf_id('0a')),'Refused opens are audited (MF-3)');
select pg_temp.as_user('06');
set local role authenticated;

-- 3. Download: linked PDFs of this member only; ticket and audit row.
select pg_temp.mf_assert(public.clinic_member_file_download(pg_temp.mf_id('0a'),pg_temp.mf_id('01'),pg_temp.mf_id('52'))->>'status'='refused','Linked PDF is refused too');
select pg_temp.mf_assert(public.clinic_member_file_download(pg_temp.mf_id('0a'),pg_temp.mf_id('03'),pg_temp.mf_id('52'))->>'status'='refused','A PDF moved to another member is refused');
select pg_temp.mf_assert(public.clinic_member_file_download(pg_temp.mf_id('0a'),pg_temp.mf_id('03'),pg_temp.mf_id('53'))->>'status'='refused','An unlinked PDF is refused');
select pg_temp.mf_assert(public.clinic_member_file_download(pg_temp.mf_id('0a'),pg_temp.mf_id('01'),pg_temp.mf_id('54'))->>'status'='refused','Another clinic''s PDF is refused');
reset role;
select pg_temp.mf_assert((select count(*)=4 from public.clinic_portal_audit where kind='member-file-download-refused'and clinic_id=pg_temp.mf_id('0a')),'Refused downloads are audited (MF-3)');
-- MF-2: a sample with results received no longer counts as at the lab.
set local session_replication_role=replica;
insert into public.patient_care_lab_stages(user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id,attachment_id)values
 (pg_temp.mf_id('01'),pg_temp.mf_id('42'),'results-received',gen_random_uuid(),now()-interval '1 hour',null,'System','system',pg_temp.mf_id('0a'),pg_temp.mf_id('61'));
set local session_replication_role=origin;
select pg_temp.as_user('06');
set local role authenticated;
select pg_temp.mf_assert((select x#>>'{visits,0,atLab}'='0'and x#>>'{visits,0,resultsReceived}'='1'from(select public.clinic_member_file(pg_temp.mf_id('0a'),pg_temp.mf_id('01'))x)y),'Results received, no longer at the lab (MF-2)');
reset role;
select pg_temp.mf_assert((select count(*)=2 from public.clinic_portal_audit where kind='member-file-opened'and clinic_id=pg_temp.mf_id('0a')),'Each successful open is audited');
select pg_temp.mf_assert((select count(*)=0 from public.clinic_portal_audit where kind='member-file-downloaded'and detail->>'fileId'=pg_temp.mf_id('52')::text)
 and(select count(*)=0 from public.clinic_original_accesses where file_id=pg_temp.mf_id('52')),'No successful-download audit or access ticket');

-- 4. Members, anon and the switch.
select pg_temp.as_user('01');
set local role authenticated;
select pg_temp.mf_reject($q$select public.clinic_member_search(pg_temp.mf_id('0a'),'Narek')$q$,'42501');
reset role;
set local role anon;
select pg_temp.mf_reject($q$select public.clinic_member_file(pg_temp.mf_id('0a'),pg_temp.mf_id('01'))$q$,'42501');
reset role;
update public.clinic_scheduling_capabilities set enabled=false;
select pg_temp.as_user('06');
set local role authenticated;
select pg_temp.mf_assert(public.clinic_member_search(pg_temp.mf_id('0a'),'Narek')->>'enabled'='false','Switch off');
select pg_temp.mf_assert(public.clinic_member_file_download(pg_temp.mf_id('0a'),pg_temp.mf_id('01'),pg_temp.mf_id('51'))->>'status'='refused','Switch off still refuses PDF without a target');
reset role;
select pg_temp.mf_assert((select count(*)=5 from public.clinic_portal_audit where kind='member-file-download-refused'and clinic_id=pg_temp.mf_id('0a')),'Switch-off refusal is audited too');
rollback;
\echo 'clinic member file: all checks passed'
