-- Fictional normal nurse persistence lifecycle; all fixtures roll back.
-- Missing projection, dropped raw evidence, mutable attribution, duplicate replay,
-- or non-durable recovery would each fail a persisted-value assertion below.
\set ON_ERROR_STOP on
begin;
create function pg_temp.visit_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'TEST %',label;end if;
end$$;
select pg_temp.visit_assert(to_regprocedure('public.patient_staff_visit_command(jsonb)') is not null,'Nurse command RPC exists');
select pg_temp.visit_assert(to_regprocedure('public.patient_staff_visit_refresh(uuid,uuid,jsonb)') is not null,'Recovery RPC exists');
insert into auth.users(id,phone,phone_confirmed_at) values
 ('b3300000-0000-4000-8000-000000000001','374000330001',now()),
 ('b3300000-0000-4000-8000-000000000002',null,null),
 ('b3300000-0000-4000-8000-000000000003',null,null);
insert into public.workspace_clinics(id,name) values('b3300000-0000-4000-8000-000000000004','Synthetic nurse clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id) values
 ('b3300000-0000-4000-8000-000000000002','doctor','Synthetic assigned doctor','b3300000-0000-4000-8000-000000000004'),
 ('b3300000-0000-4000-8000-000000000003','nurse','Synthetic nurse at recording','b3300000-0000-4000-8000-000000000004');
insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('b3300000-0000-4000-8000-000000000005','b3300000-0000-4000-8000-000000000003',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('b3300000-0000-4000-8000-000000000001','b3300000-0000-4000-8000-000000000002','b3300000-0000-4000-8000-000000000003');
insert into public.patient_assessments(user_id,answers)values('b3300000-0000-4000-8000-000000000001','{"synthetic":"unchanged"}');
select set_config('request.jwt.claims','{"sub":"b3300000-0000-4000-8000-000000000003","role":"authenticated","amr":[{"method":"password"}],"session_id":"b3300000-0000-4000-8000-000000000005"}',true);
select set_config('visit.before_requirements',public.patient_test_context('b3300000-0000-4000-8000-000000000001')->>'requirementsToken',true);
select set_config('visit.before_source',public.patient_clinical_evidence('b3300000-0000-4000-8000-000000000001')->>'token',true);
create temp table visit_commands(label text primary key,command jsonb,result jsonb);
insert into visit_commands values('open','{"version":"visit-evidence-v1","id":"b3300000-0000-4000-8000-000000000001","visitId":"b3300000-0000-4000-8000-000000000006","submissionId":"b3300000-0000-4000-8000-000000000007","revision":0,"op":"open-visit","booking":null}',null);
insert into visit_commands values('raw','{"version":"visit-evidence-v1","id":"b3300000-0000-4000-8000-000000000001","visitId":"b3300000-0000-4000-8000-000000000006","submissionId":"b3300000-0000-4000-8000-000000000008","revision":1,"op":"append-evidence","entries":[{"kind":"observation","field":"height","state":"known","value":170.5,"unit":"cm","observedAt":"2026-10-16T08:00:00+04:00"},{"kind":"observation","field":"systolic","state":"unknown","reason":"Not measured","observedAt":"2026-10-16T08:00:00+04:00"},{"kind":"observation","field":"pulse","state":"known","value":7.5,"unit":"beats/min","observedAt":"2026-10-16T08:00:00+04:00"},{"kind":"note","text":"Factual synthetic note","observedAt":"2026-10-16T08:00:00+04:00"}]}',null);
-- Use authenticated execution; assertions inspect private persistence as local SQL owner.
grant select,update on visit_commands to authenticated;
set local role authenticated;
update visit_commands set result=public.patient_staff_visit_command(command) where label='open';
update visit_commands set result=public.patient_staff_visit_command(command) where label='raw';
reset role;
select pg_temp.visit_assert(result->>'status'='saved' and (result->>'revision')::int=2,'Partial known/unknown/note saved')from visit_commands where label='raw';
select pg_temp.visit_assert((select count(*)=4 from public.patient_care_visit_entries where user_id='b3300000-0000-4000-8000-000000000001'),'Every factual entry retained');
select pg_temp.visit_assert((select count(*)=0 from public.patient_measurements where user_id='b3300000-0000-4000-8000-000000000001'),'Raw pulse and unknown BP do not project');
select pg_temp.visit_assert((select bool_and(observed_at='2026-10-16T08:00:00+04:00' and observed_instant='2026-10-16T04:00:00Z'::timestamptz and actor_name='Synthetic nurse at recording')from public.patient_care_visit_entries where user_id='b3300000-0000-4000-8000-000000000001'),'Literal offset, instant and actor snapshot retained');
select pg_temp.visit_assert(public.patient_clinical_evidence('b3300000-0000-4000-8000-000000000001')->>'token'<>current_setting('visit.before_source'),'Visit facts change clinical source');
select pg_temp.visit_assert(public.patient_test_context('b3300000-0000-4000-8000-000000000001')->>'requirementsToken'=current_setting('visit.before_requirements'),'Ordinary facts leave explicit requirements stable');
select pg_temp.visit_assert((select answers='{"synthetic":"unchanged"}' from public.patient_assessments where user_id='b3300000-0000-4000-8000-000000000001'),'Questionnaire unchanged');
update public.workspace_staff set display_name='Synthetic nurse renamed'where user_id='b3300000-0000-4000-8000-000000000003';
set local role authenticated;
select pg_temp.visit_assert((public.patient_staff_visit_workspace('b3300000-0000-4000-8000-000000000001')#>>'{visits,0,entries,0,actor,name}')='Synthetic nurse at recording','Read retains historical actor');
update visit_commands set result=public.patient_staff_visit_command(command)where label='raw';
reset role;
select pg_temp.visit_assert(result->>'replayed'='true' and (result->>'revision')::int=2,'Exact replay before stale revision validation')from visit_commands where label='raw';
select pg_temp.visit_assert((select count(*)=4 from public.patient_care_visit_entries where user_id='b3300000-0000-4000-8000-000000000001'),'Replay adds no entries');
-- BP is projected only from this append, with milliseconds matching Date.parse.
insert into visit_commands select 'bp',(command-'booking')||jsonb_build_object('op','append-evidence','revision',2,'submissionId','b3300000-0000-4000-8000-000000000009','entries',
 '[{"kind":"observation","field":"systolic","state":"known","value":120,"unit":"mmHg","observedAt":"2026-10-16T08:00:00.1234+04:00"},{"kind":"observation","field":"diastolic","state":"known","value":80,"unit":"mmHg","observedAt":"2026-10-16T04:00:00.1239Z"},{"kind":"observation","field":"pulse","state":"known","value":70,"unit":"beats/min","observedAt":"2026-10-16T04:00:00.1231Z"}]'::jsonb),null from visit_commands where label='open';
select pg_temp.visit_assert(public._patient_visit_instant('2026-10-16T04:00:00.9999999Z')='2026-10-16T04:00:00.999Z'::timestamptz,'Lexical fractional truncation does not round into next second');
select pg_temp.visit_assert(public._patient_visit_command(jsonb_set(command,'{entries,1,observedAt}','"2026-10-16T04:00:00.124Z"'))is null,'Next millisecond is not same BP instant')from visit_commands where label='bp';
set local role authenticated;
update visit_commands set result=public.patient_staff_visit_command(command)where label='bp';
reset role;
select pg_temp.visit_assert(result->>'status'='saved'and(result->>'revision')::int=3,'Complete pair saved')from visit_commands where label='bp';
select pg_temp.visit_assert((select count(*)=1 and bool_and(systolic=120 and diastolic=80 and pulse=70 and measured_at='2026-10-16T04:00:00.123Z')from public.patient_measurements where user_id='b3300000-0000-4000-8000-000000000001'),'One atomic normalized BP projection');
select pg_temp.visit_assert((select count(*)=3 from public.patient_care_visit_entries where submission_id='b3300000-0000-4000-8000-000000000009'and measurement_id is not null),'Every contributing BP entry linked');
set local role authenticated;
update visit_commands set result=public.patient_staff_visit_command(command)where label='bp';
reset role;
select pg_temp.visit_assert(result->>'replayed'='true','BP replay is exact original receipt')from visit_commands where label='bp';
-- A deliberate new command with identical readings is a new measurement.
insert into visit_commands select 'bp-again',command||'{"revision":3,"submissionId":"b3300000-0000-4000-8000-000000000010"}',null from visit_commands where label='bp';
set local role authenticated;
update visit_commands set result=public.patient_staff_visit_command(command)where label='bp-again';
reset role;
select pg_temp.visit_assert((select count(*)=2 from public.patient_measurements where user_id='b3300000-0000-4000-8000-000000000001'),'Distinct submissions are not content deduplicated');
-- Invalid included pulse must reject the whole append, not silently discard it.
insert into visit_commands select 'bad-pulse',jsonb_set(command||'{"revision":4,"submissionId":"b3300000-0000-4000-8000-000000000011"}','{entries,2,value}','7.5'),null from visit_commands where label='bp';
set local role authenticated;
update visit_commands set result=public.patient_staff_visit_command(command)where label='bad-pulse';
reset role;
select pg_temp.visit_assert(result->>'status'='invalid','Same-instant fractional pulse rejected')from visit_commands where label='bad-pulse';
select pg_temp.visit_assert((select revision=4 from public.patient_clinical_cases where user_id='b3300000-0000-4000-8000-000000000001')and not exists(select 1 from public.patient_care_visit_entries where submission_id='b3300000-0000-4000-8000-000000000011'),'Whole invalid append rolled back');
-- Different instant raw pulse remains a factual entry, without projection link.
insert into visit_commands select 'separate-pulse',jsonb_set(command||'{"submissionId":"b3300000-0000-4000-8000-000000000012"}','{entries,2,observedAt}','"2026-10-16T04:00:01Z"'),null from visit_commands where label='bad-pulse';
set local role authenticated;
update visit_commands set result=public.patient_staff_visit_command(command)where label='separate-pulse';
reset role;
select pg_temp.visit_assert(result->>'status'='saved','Different instant raw pulse retained')from visit_commands where label='separate-pulse';
select pg_temp.visit_assert((select payload->>'value'='7.5'and measurement_id is null from public.patient_care_visit_entries where submission_id='b3300000-0000-4000-8000-000000000012'and payload->>'field'='pulse'),'Raw pulse not attached to other instant pair');
select pg_temp.visit_assert((select pulse is null from public.patient_measurements where submission_id='b3300000-0000-4000-8000-000000000012'),'BP projection excludes other instant pulse');
-- Read-only refresh creates no receipt; full recovery retires an unsent exact key.
insert into visit_commands select 'retire',command||'{"revision":5,"submissionId":"b3300000-0000-4000-8000-000000000013"}',null from visit_commands where label='raw';
select set_config('visit.before_recovery_source',public.patient_clinical_evidence('b3300000-0000-4000-8000-000000000001')->>'token',true);
set local role authenticated;
select pg_temp.visit_assert(public.patient_staff_visit_refresh('b3300000-0000-4000-8000-000000000001','b3300000-0000-4000-8000-000000000006',null)->'receipt'='null','NULL refresh is read only');
update visit_commands set result=public.patient_staff_visit_refresh('b3300000-0000-4000-8000-000000000001','b3300000-0000-4000-8000-000000000006',command)where label='retire';
reset role;
select pg_temp.visit_assert(result#>>'{receipt,status}'='not-recorded'and result#>>'{receipt,serialized}'='true','Recovery returns durable retirement answer')from visit_commands where label='retire';
select pg_temp.visit_assert((select state='retired'and command=(select command from visit_commands where label='retire')from public.patient_care_visit_command_receipts where submission_id='b3300000-0000-4000-8000-000000000013'),'Retired fence matches full original command');
set local role authenticated;
update visit_commands set result=public.patient_staff_visit_command(command)where label='retire';
select pg_temp.visit_assert(public.patient_staff_visit_refresh('b3300000-0000-4000-8000-000000000001','b3300000-0000-4000-8000-000000000006',(select command from visit_commands where label='bp'))#>>'{receipt,status}'='committed','Original BP recovered after revision advance');
reset role;
select pg_temp.visit_assert(result->>'status'='stale','Retired original cannot execute later')from visit_commands where label='retire';
select pg_temp.visit_assert(public.patient_clinical_evidence('b3300000-0000-4000-8000-000000000001')->>'token'=current_setting('visit.before_recovery_source'),'Recovery does not change clinical source');
-- Reauthentication by the same actor recovers original receipt, audit session stays.
insert into auth.sessions(id,user_id,created_at,updated_at)values('b3300000-0000-4000-8000-000000000014','b3300000-0000-4000-8000-000000000003',now(),now());
select set_config('request.jwt.claims','{"sub":"b3300000-0000-4000-8000-000000000003","role":"authenticated","amr":[{"method":"password"}],"session_id":"b3300000-0000-4000-8000-000000000014"}',true);
set local role authenticated;
select pg_temp.visit_assert(public.patient_staff_visit_refresh('b3300000-0000-4000-8000-000000000001','b3300000-0000-4000-8000-000000000006',(select command from visit_commands where label='bp'))#>>'{receipt,status}'='committed','Same assigned actor new session recovers');
reset role;
select pg_temp.visit_assert((select session_id='b3300000-0000-4000-8000-000000000005'from public.patient_care_visit_command_receipts where submission_id='b3300000-0000-4000-8000-000000000009'),'Original session audit unchanged');
-- Accepted v1 remains the clinical collection context while v2 is pending.
insert into public.booking_program_seals(id,member_id,actor_id,source_token,requirements_token,engine_version,program)
 values('b3300000-0000-4000-8000-000000000020','b3300000-0000-4000-8000-000000000001','b3300000-0000-4000-8000-000000000003','synthetic-source',current_setting('visit.before_requirements'),'synthetic-only',
 '{"items":[{"id":"test-a","title":"Synthetic laboratory test","method":"lab"},{"id":"test-b","title":"Synthetic clinic test","method":"clinic"},{"id":"home-a","title":"Synthetic home log","method":"home-log"},{"id":"later-a","title":"Synthetic follow-up","method":"lab"}]}');
insert into public.booking_manual_capacity(key,source,reference,clinic_id,starts_at,ends_at,capacity,valid_until,created_by)
 values('nurse-synthetic','synthetic','nurse-synthetic','b3300000-0000-4000-8000-000000000004',now()+interval '1 day',now()+interval '2 days',2,now()+interval '3 days','b3300000-0000-4000-8000-000000000003');
insert into public.booking_offer_snapshots(id,version,capacity_key,offer,created_by)values('b3300000-0000-4000-8000-000000000021','synthetic','nurse-synthetic','{}','b3300000-0000-4000-8000-000000000003');
insert into public.booking_appointments(id,member_id,program_id,requirements_token,revision,status,current_arrangement,proposed_arrangement,current_reservation_id,proposed_reservation_id,notice_id)
 values('b3300000-0000-4000-8000-000000000022','b3300000-0000-4000-8000-000000000001','b3300000-0000-4000-8000-000000000020',current_setting('visit.before_requirements'),2,'notification-pending',
 '{"coveredTestIds":["test-a","test-b","home-a"]}','{"coveredTestIds":["test-a"],"replacement":true}',
 'b3300000-0000-4000-8000-000000000023','b3300000-0000-4000-8000-000000000024','b3300000-0000-4000-8000-000000000026');
insert into public.booking_manual_reservations(id,appointment_id,capacity_key,offer_id,offer_version,member_id,valid_until)
 select x,'b3300000-0000-4000-8000-000000000022','nurse-synthetic','b3300000-0000-4000-8000-000000000021','synthetic','b3300000-0000-4000-8000-000000000001',now()+interval '3 days'
 from unnest(array['b3300000-0000-4000-8000-000000000023'::uuid,'b3300000-0000-4000-8000-000000000024'::uuid])x;
insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,copy_revision,sender_email,clinic_email,copy_email,template_version,subject,text_content,envelope_hash,state)
 select nid,'b3300000-0000-4000-8000-000000000022',rev,'b3300000-0000-4000-8000-000000000020',rid,'b3300000-0000-4000-8000-000000000004',0,0,'synthetic@example.invalid','synthetic@example.invalid','synthetic@example.invalid','synthetic','Synthetic','Never sent',repeat('a',64),st
 from(values('b3300000-0000-4000-8000-000000000025'::uuid,1,'b3300000-0000-4000-8000-000000000023'::uuid,'accepted'),('b3300000-0000-4000-8000-000000000026'::uuid,2,'b3300000-0000-4000-8000-000000000024'::uuid,'pending'))t(nid,rev,rid,st);
insert into public.booking_appointment_versions(appointment_id,revision,program_id,proposed_arrangement,notice_id,actor_id)
 select 'b3300000-0000-4000-8000-000000000022',rev,'b3300000-0000-4000-8000-000000000020',arr,nid,'b3300000-0000-4000-8000-000000000003'
 from(values(1,'{"coveredTestIds":["test-a","test-b","home-a"]}'::jsonb,'b3300000-0000-4000-8000-000000000025'::uuid),(2,'{"coveredTestIds":["test-a"],"replacement":true}'::jsonb,'b3300000-0000-4000-8000-000000000026'::uuid))t(rev,arr,nid);
set constraints all immediate;
set constraints all deferred;
set local role authenticated;
select pg_temp.visit_assert(public.patient_staff_visit_workspace('b3300000-0000-4000-8000-000000000001')#>>'{bookingContext,acceptedRevision}'='1','Pending replacement retains accepted v1');
select pg_temp.visit_assert(jsonb_array_length(public.patient_staff_visit_workspace('b3300000-0000-4000-8000-000000000001')#>'{bookingContext,tests}')=2,'Collection includes only covered lab/clinic program items');
select pg_temp.visit_assert(public.patient_staff_visit_workspace('b3300000-0000-4000-8000-000000000001')#>'{visits,0,bookingContext}'='null','Previously unlinked visit stays NULL');
reset role;
insert into visit_commands select 'linked',command||'{"revision":5,"visitId":"b3300000-0000-4000-8000-000000000030","submissionId":"b3300000-0000-4000-8000-000000000031","booking":{"appointmentId":"b3300000-0000-4000-8000-000000000022","acceptedRevision":1}}',null from visit_commands where label='open';
set local role authenticated;
update visit_commands set result=public.patient_staff_visit_command(command)where label='linked';
reset role;
select pg_temp.visit_assert(result->>'status'='saved','Explicit linked visit opened')from visit_commands where label='linked';
insert into visit_commands select 'collection',(command-'booking')||'{"op":"append-evidence","revision":6,"submissionId":"b3300000-0000-4000-8000-000000000032","entries":[{"kind":"collection","observedAt":"2026-10-16T08:00:00+04:00","appointmentId":"b3300000-0000-4000-8000-000000000022","acceptedRevision":1,"testId":"test-a","outcome":"collected"},{"kind":"collection","observedAt":"2026-10-16T08:00:00+04:00","appointmentId":"b3300000-0000-4000-8000-000000000022","acceptedRevision":1,"testId":"test-b","outcome":"not-collected","reason":"Member deferred"}]}',null from visit_commands where label='linked';
set local role authenticated;
update visit_commands set result=public.patient_staff_visit_command(command)where label='collection';
reset role;
select pg_temp.visit_assert(result->>'status'='saved','Covered collection outcomes saved')from visit_commands where label='collection';
-- Ordinary source edits make private drafts stale, without rewriting them.
update public.patient_clinical_cases set draft='{"synthetic":"retained"}',draft_evidence_token=public.patient_clinical_evidence(user_id)->>'token'where user_id='b3300000-0000-4000-8000-000000000001';
insert into visit_commands select 'note-after-draft',command||'{"revision":7,"submissionId":"b3300000-0000-4000-8000-000000000033"}',null from visit_commands where label='raw';
set local role authenticated;
update visit_commands set result=public.patient_staff_visit_command(command)where label='note-after-draft';
reset role;
select pg_temp.visit_assert((select draft='{"synthetic":"retained"}'and draft_evidence_token<>public.patient_clinical_evidence(user_id)->>'token'from public.patient_clinical_cases where user_id='b3300000-0000-4000-8000-000000000001'),'Facts stale but never overwrite private draft');
update public.booking_scheduling_notices set state='accepted'where id='b3300000-0000-4000-8000-000000000026';
update public.booking_appointments set current_reservation_id=proposed_reservation_id,current_arrangement=proposed_arrangement where id='b3300000-0000-4000-8000-000000000022';
insert into visit_commands select 'stale-collection',command||'{"revision":8,"submissionId":"b3300000-0000-4000-8000-000000000034"}',null from visit_commands where label='collection';
set local role authenticated;
update visit_commands set result=public.patient_staff_visit_command(command)where label='stale-collection';
reset role;
select pg_temp.visit_assert(result->>'status'='stale','Accepted v2 makes old visit collection stale')from visit_commands where label='stale-collection';
select pg_temp.visit_assert((select booking_context->>'acceptedRevision'='1'from public.patient_care_visits where id='b3300000-0000-4000-8000-000000000030'),'Old accepted visit context remains immutable');
select pg_temp.visit_assert(public.patient_test_context('b3300000-0000-4000-8000-000000000001')->>'requirementsToken'=current_setting('visit.before_requirements'),'All nurse facts leave requirements token stable');
-- Assigned doctor can read the same evidence and cannot record nurse commands.
insert into auth.sessions(id,user_id,created_at,updated_at)values('b3300000-0000-4000-8000-000000000040','b3300000-0000-4000-8000-000000000002',now(),now());
select set_config('request.jwt.claims','{"sub":"b3300000-0000-4000-8000-000000000002","role":"authenticated","amr":[{"method":"password"}],"session_id":"b3300000-0000-4000-8000-000000000040"}',true);
set local role authenticated;
select pg_temp.visit_assert(jsonb_array_length(public.patient_staff_visit_workspace('b3300000-0000-4000-8000-000000000001')->'visits')=2,'Assigned doctor reads immutable visits');
select pg_temp.visit_assert(public.patient_staff_visit_command((select command from visit_commands where label='raw'))->>'status'='access','Doctor is read-only for nurse commands');
reset role;
select pg_temp.visit_assert(public._patient_visit_command(jsonb_set(command,'{booking,appointmentId}','"b3300000000040008000000000000022"'))is null,'Nested appointment UUID must match public UUID shape')from visit_commands where label='linked';
-- Strict SQL payload parity: missing/extra fields, raw values, canonical units,
-- whole-pair validity and bounded one-per-field/collection inputs.
do $$declare p jsonb;e jsonb;k text;begin
 select command into p from visit_commands where label='bp';
 foreach k in array array['version','id','revision','submissionId','visitId','op','entries']loop
  perform pg_temp.visit_assert(public._patient_visit_command(p-k)is null,'Missing command key '||k);
  perform pg_temp.visit_assert(public._patient_visit_command(jsonb_set(p,array[k],'null'))is null,'Null command key '||k);
 end loop;
 perform pg_temp.visit_assert(public._patient_visit_command(p||'{"actorId":"b3300000-0000-4000-8000-000000000003"}')is null,'Browser attribution rejected');
 perform pg_temp.visit_assert(public._patient_visit_command(jsonb_set(p,'{entries,0,value}','120.5'))is null,'Fractional complete pair rejected before casts');
 perform pg_temp.visit_assert(public._patient_visit_command(jsonb_set(p,'{entries,0,value}','80'))is null,'Non-increasing complete pair rejected');
 perform pg_temp.visit_assert(public._patient_visit_command(jsonb_set(p,'{entries,0,unit}','"cm"'))is null,'Canonical BP unit required');
 perform pg_temp.visit_assert(public._patient_visit_command(jsonb_set(p,'{entries,0,observedAt}','"2026-10-16T24:00:00Z"'))is null,'Invalid ISO hour rejected');
 perform pg_temp.visit_assert(public._patient_visit_command(jsonb_set(p,'{entries}',(p->'entries')||jsonb_build_array(p#>'{entries,0}')))is null,'Duplicate field rejected');
 perform pg_temp.visit_assert(public._patient_visit_command(jsonb_set(p,'{entries}','[]'))is null,'Empty append rejected');
 perform pg_temp.visit_assert(public._patient_visit_command(jsonb_set(p,'{entries}',jsonb_build_array(p#>'{entries,0}')))is not null,'Standalone systolic is allowed');
 perform pg_temp.visit_assert(public._patient_visit_command(jsonb_set(jsonb_set(p,'{entries}',jsonb_build_array(p#>'{entries,0}')),'{entries,0,value}','-1.25'))is not null,'Partial raw value has no invented range');
 perform pg_temp.visit_assert(public._patient_visit_command(jsonb_set(p,'{revision}','3.0'))is not null,'Integral numeric JSON scale accepted');
 perform pg_temp.visit_assert(public._patient_visit_command(jsonb_set(p,'{entries}',jsonb_build_array(jsonb_build_object('kind','note','observedAt','2026-10-16T04:00:00Z','text',E'\t\n'))))is null,'Whitespace-only note rejected');
end$$;
-- Normal save interrupted by a database failure rolls back projection, entries,
-- revision and audit together. Trigger exists only in this rollback fixture.
create function pg_temp.visit_fail_receipt()returns trigger language plpgsql as $$begin
 if new.submission_id='b3300000-0000-4000-8000-000000000050'then raise check_violation using message='Synthetic final persistence failure';end if;return new;
end$$;
create trigger synthetic_visit_final_failure before insert on public.patient_care_visit_command_receipts for each row execute function pg_temp.visit_fail_receipt();
select set_config('request.jwt.claims','{"sub":"b3300000-0000-4000-8000-000000000003","role":"authenticated","amr":[{"method":"password"}],"session_id":"b3300000-0000-4000-8000-000000000014"}',true);
insert into visit_commands select 'interrupted-save',command||'{"revision":8,"submissionId":"b3300000-0000-4000-8000-000000000050"}',null from visit_commands where label='bp';
set local role authenticated;
do $$begin
 begin perform public.patient_staff_visit_command((select command from visit_commands where label='interrupted-save'));
 exception when check_violation then return;end;
 raise exception 'TEST expected final persistence failure';
end$$;
reset role;
select pg_temp.visit_assert(not exists(select 1 from public.patient_care_visit_entries where submission_id='b3300000-0000-4000-8000-000000000050')and not exists(select 1 from public.patient_measurements where submission_id='b3300000-0000-4000-8000-000000000050')and not exists(select 1 from public.patient_clinical_case_events where detail->>'submissionId'='b3300000-0000-4000-8000-000000000050')and(select revision=8 from public.patient_clinical_cases where user_id='b3300000-0000-4000-8000-000000000001'),'Final failure rolls back all clinical side effects');
drop trigger synthetic_visit_final_failure on public.patient_care_visit_command_receipts;
-- Immutable rows reject even accidental owner updates; authenticated has no direct writes.
do $$begin
 begin update public.patient_care_visits set booking_context=null where id='b3300000-0000-4000-8000-000000000030';exception when sqlstate '55000' then return;end;
 raise exception 'TEST expected immutable visit';
end$$;
set local role authenticated;
do $$begin
 begin delete from public.patient_care_visit_entries where user_id='b3300000-0000-4000-8000-000000000001';exception when insufficient_privilege then return;end;
 raise exception 'TEST expected no direct clinical table write';
end$$;
reset role;
set constraints all immediate;
rollback;
