-- Sample collection commands: synthetic fixtures only; every change rolls back.
-- Same synthetic fixtures as check-nurse-visit-flow.sql; everything rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.nv_assert(ok boolean,label text)returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.nv_as(p_user uuid,p_session uuid)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',p_session)::text,true);
end$$;
-- Members m1 (home request) and m2 (slot booking); doctor; nurse n1 (assigned), n2 (same clinic); admin.
insert into auth.users(id,phone,phone_confirmed_at)values
 ('c7700000-0000-4000-8000-000000000001','374000770001',now()),('c7700000-0000-4000-8000-000000000002','374000770002',now()),
 ('c7700000-0000-4000-8000-000000000011',null,null),('c7700000-0000-4000-8000-000000000012',null,null),
 ('c7700000-0000-4000-8000-000000000013',null,null),('c7700000-0000-4000-8000-000000000014',null,null);
insert into public.workspace_clinics(id,name)values('c7700000-0000-4000-8000-000000000020','Synthetic nurse visit clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('c7700000-0000-4000-8000-000000000011','doctor','Synthetic doctor','c7700000-0000-4000-8000-000000000020'),
 ('c7700000-0000-4000-8000-000000000012','nurse','Synthetic nurse one','c7700000-0000-4000-8000-000000000020'),
 ('c7700000-0000-4000-8000-000000000013','nurse','Synthetic nurse two','c7700000-0000-4000-8000-000000000020'),
 ('c7700000-0000-4000-8000-000000000014','admin','Synthetic admin',null);
insert into auth.sessions(id,user_id,created_at,updated_at)values
 ('c7700000-0000-4000-8000-000000000031','c7700000-0000-4000-8000-000000000011',now(),now()),
 ('c7700000-0000-4000-8000-000000000032','c7700000-0000-4000-8000-000000000012',now(),now()),
 ('c7700000-0000-4000-8000-000000000033','c7700000-0000-4000-8000-000000000013',now(),now()),
 ('c7700000-0000-4000-8000-000000000034','c7700000-0000-4000-8000-000000000014',now(),now()),
 ('c7700000-0000-4000-8000-000000000035','c7700000-0000-4000-8000-000000000001',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('c7700000-0000-4000-8000-000000000001','c7700000-0000-4000-8000-000000000011','c7700000-0000-4000-8000-000000000012'),
 ('c7700000-0000-4000-8000-000000000002','c7700000-0000-4000-8000-000000000011','c7700000-0000-4000-8000-000000000012');
insert into public.profiles(id,display_name)values('c7700000-0000-4000-8000-000000000001','Synthetic Member One')on conflict(id)do update set display_name=excluded.display_name;
-- Home request today (r1) and tomorrow (r2) for m1.
insert into public.patient_test_requests(id,user_id,status,requested_terms,requirements,algorithm_version,context_token,create_payload,current_arrangement)
 select id,'c7700000-0000-4000-8000-000000000001','confirmed','{}',
  '[{"id":"hba1c","title":"HbA1c","method":"lab"},{"id":"lipid-panel","title":"Lipid panel","method":"lab"},{"id":"ecg-12-lead","title":"ECG","method":"clinic"},{"id":"urine-acr","title":"Urine ACR","method":"lab"},{"id":"cbc","title":"Complete blood count","method":"lab"},{"id":"anthropometry","title":"Weight and waist","method":"clinic"}]',
  'synthetic','synthetic','{}',jsonb_build_object('terms',jsonb_build_object('mode','home','startsAt',s,'endsAt',s+interval '1 hour','timezone','Asia/Yerevan','location','Synthetic street 1'))
 from(values('c7700000-0000-4000-8000-000000000041'::uuid,date_trunc('minute',now())),('c7700000-0000-4000-8000-000000000042'::uuid,date_trunc('minute',now())+interval '2 days'))t(id,s);
update public.nurse_visit_settings set enabled=true;
-- Historical marks predate collection_status and allowed reasons up to 1,000 characters.
insert into public.nurse_visit_marks(member_id,source,source_id,item,done,note,submission_id,actor_id,actor_name)
 values('c7700000-0000-4000-8000-000000000001','home-request','c7700000-0000-4000-8000-000000000041',
 'sample:cbc',false,repeat('a',343),'c7700000-0000-4000-8000-000000000122','c7700000-0000-4000-8000-000000000012','Synthetic nurse one');

create function pg_temp.collect(p_sub uuid,p_test text default null,p_status text default null,p_reason text default null,p_extra jsonb default '{}'::jsonb)returns jsonb language sql as $$
 select public.nurse_visit_collect(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001',
 'source','home-request','sourceId','c7700000-0000-4000-8000-000000000041','submissionId',p_sub,
 'expectedRevision',d->'caseRevision','arrangementToken',d#>'{visit,arrangementToken}')
 ||case when p_test is null then '{"all":true}'::jsonb else jsonb_build_object('testId',p_test,'status',p_status,'reason',p_reason)end||p_extra)
 from(select public.nurse_visit_detail('c7700000-0000-4000-8000-000000000001','home-request','c7700000-0000-4000-8000-000000000041')d)x
$$;
create temp table outcomes(label text primary key,v jsonb);
grant select,insert on outcomes to authenticated;
grant execute on function pg_temp.collect(uuid,text,text,text,jsonb)to authenticated;
-- A captured full command proves exact replay remains safe after the revision advances.
create temp table original(command jsonb);
grant select,insert on original to authenticated;
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000012','c7700000-0000-4000-8000-000000000032');
set local role authenticated;
insert into outcomes values('blank',pg_temp.collect('c7700000-0000-4000-8000-000000000101','lipid-panel','issue','   '));
insert into outcomes values('long',pg_temp.collect('c7700000-0000-4000-8000-000000000102','lipid-panel','not-collected',repeat('a',301)));
insert into outcomes values('pending',public.nurse_visit_complete(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001','source','home-request',
 'sourceId','c7700000-0000-4000-8000-000000000041','submissionId','c7700000-0000-4000-8000-000000000103','visitId','c7700000-0000-4000-8000-000000000104',
 'openSubmissionId','c7700000-0000-4000-8000-000000000105','appendSubmissionId','c7700000-0000-4000-8000-000000000106','reason','Synthetic reason')));
insert into original select jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001',
 'source','home-request','sourceId','c7700000-0000-4000-8000-000000000041','submissionId','c7700000-0000-4000-8000-000000000110',
 'expectedRevision',public.nurse_visit_detail('c7700000-0000-4000-8000-000000000001','home-request','c7700000-0000-4000-8000-000000000041')->'caseRevision',
 'arrangementToken',public.nurse_visit_detail('c7700000-0000-4000-8000-000000000001','home-request','c7700000-0000-4000-8000-000000000041')#>'{visit,arrangementToken}',
 'testId','lipid-panel','status','issue','reason','Synthetic collection issue');
insert into outcomes select 'issue',public.nurse_visit_collect(command)from original;
insert into outcomes values('not-collected',pg_temp.collect('c7700000-0000-4000-8000-000000000118','urine-acr','not-collected','Synthetic unavailable sample'));
insert into outcomes values('all',pg_temp.collect('c7700000-0000-4000-8000-000000000111'));
insert into outcomes select 'replay',public.nurse_visit_collect(command)from original;
insert into outcomes select 'collision',public.nurse_visit_collect(command||'{"status":"collected","reason":null}'::jsonb)from original;
insert into outcomes values('detail',public.nurse_visit_detail('c7700000-0000-4000-8000-000000000001','home-request','c7700000-0000-4000-8000-000000000041'));
insert into outcomes values('correction',pg_temp.collect('c7700000-0000-4000-8000-000000000112','lipid-panel','not-collected','Synthetic revised reason'));
insert into outcomes values('stale',pg_temp.collect('c7700000-0000-4000-8000-000000000113','lipid-panel','collected',null,'{"expectedRevision":0}'::jsonb));
-- Legacy false sample marks still require a reason; the old checkbox cannot bypass the card.
insert into outcomes values('legacy',public.nurse_visit_mark(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001',
 'source','home-request','sourceId','c7700000-0000-4000-8000-000000000041','submissionId','c7700000-0000-4000-8000-000000000114',
 'item','sample:urine-acr','done',false,'note',null,'values',null)));
reset role;
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000013','c7700000-0000-4000-8000-000000000033');
set local role authenticated;
-- Explicit revision avoids relying on a refused detail read to construct the command.
insert into outcomes values('other-nurse',pg_temp.collect('c7700000-0000-4000-8000-000000000115',null,null,null,'{"expectedRevision":0,"arrangementToken":"1"}'::jsonb));
reset role;
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000011','c7700000-0000-4000-8000-000000000031');
set local role authenticated;
insert into outcomes values('doctor',pg_temp.collect('c7700000-0000-4000-8000-000000000116',null,null,null,'{"expectedRevision":0,"arrangementToken":"1"}'::jsonb));
reset role;
select pg_temp.nv_assert((select bool_and(v->>'status'='invalid')from outcomes where label in('blank','long','legacy')),'Reasons required and bounded through both APIs');
select pg_temp.nv_assert((select v->>'status'='pending-samples'from outcomes where label='pending'),'Pending blocks completion even with an overall reason');
select pg_temp.nv_assert((select bool_and(v->>'status'='saved')from outcomes where label in('issue','not-collected','all','correction')),'Issue, pending confirm-all and correction save');
select pg_temp.nv_assert((select v->>'replayed'='true'from outcomes where label='replay'),'Exact submission replays despite revision advancing');
select pg_temp.nv_assert((select bool_and(v->>'status'='stale')from outcomes where label in('collision','stale')),'Changed submission and stale revision refuse');
select pg_temp.nv_assert((select bool_and(v->>'status'='access')from outcomes where label in('doctor','other-nurse')),'Doctor and unassigned nurse denied');
select pg_temp.nv_assert((select v#>>'{counts,samplesTaken}'='1'from outcomes where label='detail'),'Only collected samples count as taken');
select pg_temp.nv_assert((select x#>>'{mark,collectionStatus}'='issue'and x#>>'{mark,note}'='Synthetic collection issue'
 from outcomes,jsonb_array_elements(v->'items')x where label='detail'and x->>'key'='sample:lipid-panel'),'Confirm-all preserves final exceptions and reasons');
select pg_temp.nv_assert((select x#>>'{mark,collectionStatus}'='not-collected'and x#>>'{mark,note}'='Synthetic unavailable sample'
 from outcomes,jsonb_array_elements(v->'items')x where label='detail'and x->>'key'='sample:urine-acr'),'Confirm-all also preserves not-collected reasons');
select pg_temp.nv_assert((select x#>>'{mark,collectionStatus}'='not-collected'and x#>>'{mark,note}'=repeat('a',343)
 from outcomes,jsonb_array_elements(v->'items')x where label='detail'and x->>'key'='sample:cbc'),'Confirm-all preserves a 343-character legacy exception in the projection');
select pg_temp.nv_assert((select count(*)=1 and bool_and(not done and collection_status is null and note=repeat('a',343))
 from public.nurse_visit_marks where source_id='c7700000-0000-4000-8000-000000000041'and item='sample:cbc'),'Confirm-all never appends a collected mark over a legacy exception');
select pg_temp.nv_assert((select count(*)=2 from public.nurse_visit_marks where source_id='c7700000-0000-4000-8000-000000000041'and item='sample:lipid-panel'), 'Correction appends to audit history');
select pg_temp.nv_assert(exists(select 1 from public.nurse_visit_marks where source_id='c7700000-0000-4000-8000-000000000041'and collection_status='issue'and note='Synthetic collection issue'),'Original issue remains intact');
select pg_temp.nv_assert(exists(select 1 from public.nurse_visit_events where source_id='c7700000-0000-4000-8000-000000000041'and step='samples-collected'),'All final with a collected sample records the timeline step');
do $$begin
 begin
  update public.nurse_visit_marks set note='Changed'where source_id='c7700000-0000-4000-8000-000000000041';
  raise exception 'TEST mutable collection audit';
 exception when sqlstate '55000' then null;end;
end$$;
select pg_temp.nv_assert(not exists(select 1 from public.nurse_visit_completions where member_id='c7700000-0000-4000-8000-000000000001')
 and not exists(select 1 from public.patient_care_visits where user_id='c7700000-0000-4000-8000-000000000001')
 and not exists(select 1 from public.patient_care_visit_entries where user_id='c7700000-0000-4000-8000-000000000001')
 and not exists(select 1 from public.patient_care_results where user_id='c7700000-0000-4000-8000-000000000001'),'Collect and refused completion create no results or performed evidence');
-- Isolate a same-day reschedule so the cancellation checks keep their original audit.
savepoint same_day_reschedule;
create temp table before_reschedule(command jsonb);
insert into before_reschedule select command-array['testId','status','reason']||jsonb_build_object(
 'submissionId','c7700000-0000-4000-8000-000000000123','all',true,
 'expectedRevision',(select revision from public.patient_clinical_cases where user_id='c7700000-0000-4000-8000-000000000001'))from original;
grant select on before_reschedule to authenticated;
-- The fixture starts on a whole minute, so adding 30 seconds always stays on the same day.
update public.patient_test_requests set revision=revision+1,current_arrangement=jsonb_set(jsonb_set(current_arrangement,
 '{terms,startsAt}',to_jsonb((current_arrangement#>>'{terms,startsAt}')::timestamptz+interval '30 seconds')),
 '{terms,endsAt}',to_jsonb((current_arrangement#>>'{terms,endsAt}')::timestamptz+interval '30 seconds'))
 where id='c7700000-0000-4000-8000-000000000041';
select pg_temp.nv_assert((select (command->>'expectedRevision')::bigint=(select revision from public.patient_clinical_cases
 where user_id='c7700000-0000-4000-8000-000000000001')from before_reschedule),'Reschedule leaves the clinical revision unchanged');
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000012','c7700000-0000-4000-8000-000000000032');
set local role authenticated;
insert into outcomes select 'rescheduled-stale',public.nurse_visit_collect(command)from before_reschedule;
insert into outcomes select 'rescheduled-replay',public.nurse_visit_collect(command)from original;
insert into outcomes values('rescheduled-pending',public.nurse_visit_detail('c7700000-0000-4000-8000-000000000001','home-request','c7700000-0000-4000-8000-000000000041'));
-- Reuse the refused submission with the current arrangement; a stale refusal writes no receipt.
insert into outcomes values('rescheduled-fresh',pg_temp.collect('c7700000-0000-4000-8000-000000000123'));
insert into outcomes values('rescheduled-collected',public.nurse_visit_detail('c7700000-0000-4000-8000-000000000001','home-request','c7700000-0000-4000-8000-000000000041'));
reset role;
select pg_temp.nv_assert((select v->>'status'='stale'from outcomes where label='rescheduled-stale'),'Old arrangement refuses collection despite a matching clinical revision');
select pg_temp.nv_assert((select v->>'status'='saved'and v->>'replayed'='true'from outcomes where label='rescheduled-replay'),'Exact receipt replays after rescheduling');
select pg_temp.nv_assert((select bool_and(x->'mark'='null'::jsonb)from outcomes,jsonb_array_elements(v->'items')x
 where label='rescheduled-pending'and x->>'kind'='sample'),'Refused stale command and replay leave the new arrangement unmarked');
select pg_temp.nv_assert((select v->>'status'='saved'from outcomes where label='rescheduled-fresh'),'Fresh arrangement collects successfully');
select pg_temp.nv_assert((select bool_and(x#>>'{mark,collectionStatus}'='collected')from outcomes,jsonb_array_elements(v->'items')x
 where label='rescheduled-collected'and x->>'kind'='sample'),'Fresh command records collection against the rescheduled arrangement');
rollback to same_day_reschedule;
release savepoint same_day_reschedule;
-- Replacement terms can change the address without moving the start or clinical revision.
savepoint same_time_home_replacement;
create temp table before_home_replacement(command jsonb,starts_at text);
insert into before_home_replacement select command||jsonb_build_object(
 'submissionId','c7700000-0000-4000-8000-000000000124','status','collected','reason',null,
 'expectedRevision',(select revision from public.patient_clinical_cases where user_id='c7700000-0000-4000-8000-000000000001')),
 (select current_arrangement#>>'{terms,startsAt}'from public.patient_test_requests where id='c7700000-0000-4000-8000-000000000041')from original;
grant select on before_home_replacement to authenticated;
update public.patient_test_requests set revision=revision+1,
 current_arrangement=jsonb_set(current_arrangement,'{terms,location}','"Synthetic replacement street"')
 where id='c7700000-0000-4000-8000-000000000041';
select pg_temp.nv_assert((select starts_at=(select current_arrangement#>>'{terms,startsAt}'from public.patient_test_requests
 where id='c7700000-0000-4000-8000-000000000041')and(command->>'expectedRevision')::bigint=(select revision from public.patient_clinical_cases
 where user_id='c7700000-0000-4000-8000-000000000001')from before_home_replacement),'Home replacement keeps the start and clinical revision');
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000012','c7700000-0000-4000-8000-000000000032');
set local role authenticated;
insert into outcomes select 'home-replacement-stale',public.nurse_visit_collect(command)from before_home_replacement;
insert into outcomes select 'home-replacement-replay',public.nurse_visit_collect(command)from original;
insert into outcomes values('home-replacement-fresh',pg_temp.collect('c7700000-0000-4000-8000-000000000124','lipid-panel','collected'));
reset role;
select pg_temp.nv_assert((select v->>'status'='stale'from outcomes where label='home-replacement-stale'),'Old home revision refuses same-time replacement collection');
select pg_temp.nv_assert((select v->>'status'='saved'and v->>'replayed'='true'from outcomes where label='home-replacement-replay'),'Stored home receipt replays before replacement freshness check');
select pg_temp.nv_assert((select v->>'status'='saved'and v->>'replayed'='false'from outcomes where label='home-replacement-fresh'),'Fresh home revision collects after same-time replacement');
select pg_temp.nv_assert((select command->>'arrangementToken'=(select revision::text from public.patient_test_requests
 where id='c7700000-0000-4000-8000-000000000041')from public.nurse_visit_collection_receipts
 where submission_id='c7700000-0000-4000-8000-000000000124'),'Home receipt stores the fresh request revision as text');
rollback to same_time_home_replacement;
release savepoint same_time_home_replacement;
-- Real home cancellation clears the live context. Recover its last confirmed receipt.
insert into public.patient_test_request_events(request_id,command_id,actor_id,revision,operation,payload,result)
 select id,'c7700000-0000-4000-8000-000000000119','c7700000-0000-4000-8000-000000000012',revision,'confirmed','{}',
 jsonb_build_object('id',id,'status',status,'currentArrangement',current_arrangement,'requirements',requirements)
 from public.patient_test_requests where id='c7700000-0000-4000-8000-000000000041';
update public.patient_test_requests set status='cancelled',current_arrangement=null where id='c7700000-0000-4000-8000-000000000041';
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000012','c7700000-0000-4000-8000-000000000032');
set local role authenticated;
insert into outcomes values('cancelled-detail',public.nurse_visit_detail('c7700000-0000-4000-8000-000000000001','home-request','c7700000-0000-4000-8000-000000000041'));
insert into outcomes values('cancelled-record',public.nurse_visit_record('c7700000-0000-4000-8000-000000000001'));
insert into outcomes values('cancelled-command',pg_temp.collect('c7700000-0000-4000-8000-000000000117','urine-acr','collected'));
reset role;
select pg_temp.nv_assert((select v#>>'{visit,bookingStatus}'='cancelled'from outcomes where label='cancelled-detail'),'Cancelled home request recovers its cleared arrangement');
select pg_temp.nv_assert((select exists(select 1 from jsonb_array_elements(v->'items')x where x->>'key'='sample:lipid-panel'and x#>>'{mark,collectionStatus}'='not-collected')from outcomes where label='cancelled-detail'),'Cancelled home request retains its sample audit');
select pg_temp.nv_assert((select jsonb_array_length(v->'visits')=1 and v#>>'{visits,0,visit,bookingStatus}'='cancelled'from outcomes where label='cancelled-record'),'Cancelled home request remains in the member record');
select pg_temp.nv_assert((select v->>'status'='cancelled'from outcomes where label='cancelled-command'),'Cancelled collection command refuses');
insert into public.booking_program_seals(id,member_id,actor_id,source_token,requirements_token,engine_version,program)
 values('c7700000-0000-4000-8000-000000000501','c7700000-0000-4000-8000-000000000002','c7700000-0000-4000-8000-000000000012','synthetic',
  public.patient_test_context('c7700000-0000-4000-8000-000000000002')->>'requirementsToken','synthetic-only',
  '{"items":[{"id":"hba1c","title":"HbA1c","method":"lab"},{"id":"ecg-12-lead","title":"ECG","method":"clinic"}]}');
insert into public.booking_manual_capacity(key,source,reference,clinic_id,starts_at,ends_at,capacity,valid_until,created_by)
 values('nv-synthetic','synthetic','nv-synthetic','c7700000-0000-4000-8000-000000000020',now()-interval '1 hour',now(),2,now()+interval '3 days','c7700000-0000-4000-8000-000000000012');
insert into public.booking_offer_snapshots(id,version,capacity_key,offer,created_by)values('c7700000-0000-4000-8000-000000000502','synthetic','nv-synthetic','{}','c7700000-0000-4000-8000-000000000012');
insert into public.booking_appointments(id,member_id,program_id,requirements_token,revision,status,current_arrangement,proposed_arrangement,current_reservation_id,proposed_reservation_id,notice_id)
 select 'c7700000-0000-4000-8000-000000000503','c7700000-0000-4000-8000-000000000002','c7700000-0000-4000-8000-000000000501',
  public.patient_test_context('c7700000-0000-4000-8000-000000000002')->>'requirementsToken',1,'confirmed',arr,arr,
  'c7700000-0000-4000-8000-000000000504','c7700000-0000-4000-8000-000000000504','c7700000-0000-4000-8000-000000000505'
 from(select jsonb_build_object('coveredTestIds',jsonb_build_array('hba1c','ecg-12-lead'),'mode','clinic','startsAt',now()-interval '1 hour','endsAt',now(),
  'location','Synthetic clinic address','clinicId','c7700000-0000-4000-8000-000000000020')arr)x;
insert into public.booking_manual_reservations(id,appointment_id,capacity_key,offer_id,offer_version,member_id,valid_until)
 values('c7700000-0000-4000-8000-000000000504','c7700000-0000-4000-8000-000000000503','nv-synthetic','c7700000-0000-4000-8000-000000000502','synthetic','c7700000-0000-4000-8000-000000000002',now()+interval '3 days');
insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,copy_revision,sender_email,clinic_email,copy_email,template_version,subject,text_content,envelope_hash,state)
 values('c7700000-0000-4000-8000-000000000505','c7700000-0000-4000-8000-000000000503',1,'c7700000-0000-4000-8000-000000000501','c7700000-0000-4000-8000-000000000504','c7700000-0000-4000-8000-000000000020',0,0,
  'synthetic@example.invalid','synthetic@example.invalid','synthetic@example.invalid','synthetic','Synthetic','Never sent',repeat('a',64),'accepted');
insert into public.booking_appointment_versions(appointment_id,revision,program_id,proposed_arrangement,notice_id,actor_id)
 select 'c7700000-0000-4000-8000-000000000503',1,'c7700000-0000-4000-8000-000000000501',current_arrangement,'c7700000-0000-4000-8000-000000000505','c7700000-0000-4000-8000-000000000012'
 from public.booking_appointments where id='c7700000-0000-4000-8000-000000000503';
set constraints all immediate;
set constraints all deferred;
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000012','c7700000-0000-4000-8000-000000000032');
set local role authenticated;
insert into outcomes values('appt-mark',public.nurse_visit_mark(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000002',
 'source','appointment','sourceId','c7700000-0000-4000-8000-000000000503','submissionId','c7700000-0000-4000-8000-000000000120',
 'item','sample:hba1c','done',true,'note',null,'values',null)));
reset role;
-- Rebooking can change the reservation and address while preserving the start.
savepoint same_time_appointment_rebook;
create temp table appointment_original(command jsonb);
grant select,insert on appointment_original to authenticated;
set local role authenticated;
insert into appointment_original select jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000002',
 'source','appointment','sourceId','c7700000-0000-4000-8000-000000000503','submissionId','c7700000-0000-4000-8000-000000000125',
 'expectedRevision',d->'caseRevision','arrangementToken',d#>'{visit,arrangementToken}','testId','hba1c','status','collected','reason',null)
 from(select public.nurse_visit_detail('c7700000-0000-4000-8000-000000000002','appointment','c7700000-0000-4000-8000-000000000503')d)x;
insert into outcomes select 'appt-original',public.nurse_visit_collect(command)from appointment_original;
reset role;
create temp table before_appointment_rebook(command jsonb,starts_at text);
insert into before_appointment_rebook select command||jsonb_build_object(
 'submissionId','c7700000-0000-4000-8000-000000000126',
 'expectedRevision',(select revision from public.patient_clinical_cases where user_id='c7700000-0000-4000-8000-000000000002')),
 (select current_arrangement->>'startsAt'from public.booking_appointments where id='c7700000-0000-4000-8000-000000000503')from appointment_original;
grant select on before_appointment_rebook to authenticated;
insert into public.booking_manual_reservations(id,appointment_id,capacity_key,offer_id,offer_version,member_id,valid_until)
 values('c7700000-0000-4000-8000-000000000507','c7700000-0000-4000-8000-000000000503','nv-synthetic','c7700000-0000-4000-8000-000000000502','synthetic','c7700000-0000-4000-8000-000000000002',now()+interval '3 days');
update public.booking_manual_reservations set state='released'where id='c7700000-0000-4000-8000-000000000504';
update public.booking_appointments set revision=revision+1,
 current_reservation_id='c7700000-0000-4000-8000-000000000507',proposed_reservation_id='c7700000-0000-4000-8000-000000000507',
 current_arrangement=jsonb_set(current_arrangement,'{location}','"Synthetic rebooked address"'),
 proposed_arrangement=jsonb_set(current_arrangement,'{location}','"Synthetic rebooked address"')
 where id='c7700000-0000-4000-8000-000000000503';
select pg_temp.nv_assert((select starts_at=(select current_arrangement->>'startsAt'from public.booking_appointments
 where id='c7700000-0000-4000-8000-000000000503')and(command->>'expectedRevision')::bigint=(select revision from public.patient_clinical_cases
 where user_id='c7700000-0000-4000-8000-000000000002')from before_appointment_rebook),'Rebooking keeps the start and clinical revision');
set local role authenticated;
insert into outcomes select 'appt-rebook-stale',public.nurse_visit_collect(command)from before_appointment_rebook;
insert into outcomes select 'appt-rebook-replay',public.nurse_visit_collect(command)from appointment_original;
insert into outcomes select 'appt-rebook-fresh',public.nurse_visit_collect(command||jsonb_build_object('arrangementToken',d#>'{visit,arrangementToken}'))
 from before_appointment_rebook cross join lateral(select public.nurse_visit_detail('c7700000-0000-4000-8000-000000000002','appointment','c7700000-0000-4000-8000-000000000503')d)x;
reset role;
select pg_temp.nv_assert((select v->>'status'='saved'from outcomes where label='appt-original'),'Appointment collection stores an original receipt');
select pg_temp.nv_assert((select v->>'status'='stale'from outcomes where label='appt-rebook-stale'),'Old reservation refuses same-time rebooked collection');
select pg_temp.nv_assert((select v->>'status'='saved'and v->>'replayed'='true'from outcomes where label='appt-rebook-replay'),'Stored appointment receipt replays before rebooking freshness check');
select pg_temp.nv_assert((select v->>'status'='saved'and v->>'replayed'='false'from outcomes where label='appt-rebook-fresh'),'Fresh reservation collects after same-time rebooking');
select pg_temp.nv_assert((select command->>'arrangementToken'='c7700000-0000-4000-8000-000000000507'from public.nurse_visit_collection_receipts
 where submission_id='c7700000-0000-4000-8000-000000000126'),'Appointment receipt stores the new reservation id');
rollback to same_time_appointment_rebook;
release savepoint same_time_appointment_rebook;
-- Cancellation preserves proposed arrangement/version but clears both live fields.
-- Cancellation notice and version preserve the removed arrangement and exact program.
-- The synthetic slot uses email notices, including cancellation, with a complete envelope.
insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,copy_revision,sender_email,clinic_email,copy_email,template_version,subject,text_content,envelope_hash,channel,purpose,state)
 values('c7700000-0000-4000-8000-000000000506','c7700000-0000-4000-8000-000000000503',2,'c7700000-0000-4000-8000-000000000501',
 'c7700000-0000-4000-8000-000000000504','c7700000-0000-4000-8000-000000000020',0,0,
 'synthetic@example.invalid','synthetic@example.invalid','synthetic@example.invalid','synthetic','Synthetic','Never sent',repeat('a',64),'email','cancellation','accepted');
insert into public.booking_appointment_versions(appointment_id,revision,program_id,previous_arrangement,proposed_arrangement,notice_id,actor_id,previous_program)
 select a.id,2,a.program_id,a.current_arrangement,a.current_arrangement,'c7700000-0000-4000-8000-000000000506',
 'c7700000-0000-4000-8000-000000000012',s.program->'items'
 from public.booking_appointments a join public.booking_program_seals s on s.id=a.program_id where a.id='c7700000-0000-4000-8000-000000000503';
update public.booking_appointments set revision=2,status='cancelled',current_arrangement=null,current_reservation_id=null,current_program=null,notice_id='c7700000-0000-4000-8000-000000000506'
 where id='c7700000-0000-4000-8000-000000000503';
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000012','c7700000-0000-4000-8000-000000000032');
set local role authenticated;
insert into outcomes values('appt-cancelled-detail',public.nurse_visit_detail('c7700000-0000-4000-8000-000000000002','appointment','c7700000-0000-4000-8000-000000000503'));
insert into outcomes values('appt-cancelled-record',public.nurse_visit_record('c7700000-0000-4000-8000-000000000002'));
insert into outcomes select 'appt-cancelled-command',public.nurse_visit_collect(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000002',
 'source','appointment','sourceId','c7700000-0000-4000-8000-000000000503','submissionId','c7700000-0000-4000-8000-000000000121',
 'expectedRevision',v->'caseRevision','arrangementToken',v#>'{visit,arrangementToken}','testId','hba1c','status','not-collected','reason','Synthetic reason'))from outcomes where label='appt-cancelled-detail';
reset role;
select pg_temp.nv_assert((select v#>>'{visit,bookingStatus}'='cancelled'and exists(select 1 from jsonb_array_elements(v->'items')x
 where x->>'key'='sample:hba1c'and x#>>'{mark,collectionStatus}'='collected')from outcomes where label='appt-cancelled-detail'),'Cancelled slot recovers tests and marks from its cleared context');
select pg_temp.nv_assert((select jsonb_array_length(v->'visits')=1 and v#>>'{visits,0,visit,bookingStatus}'='cancelled'from outcomes where label='appt-cancelled-record'),'Cancelled slot remains in the member record');
select pg_temp.nv_assert((select v->>'status'='cancelled'from outcomes where label='appt-cancelled-command'),'Cancelled slot collection refuses');
rollback;
\echo 'Nurse sample collection: reasons, assigned-nurse access, pending gate, atomic confirm-all, replay and append-only correction'
