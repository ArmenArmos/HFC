-- Synthetic authority/persistence tests on an explicitly owned replay database.
\set ON_ERROR_STOP on
begin;
create function pg_temp.email_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.email_reject(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected rejection %',expected;
end$$;
create function pg_temp.email_actor(id uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated','session_id',id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
end$$;
insert into auth.users(id,phone,phone_confirmed_at)values
 ('b2000000-0000-4000-8000-000000000001','374000000001',now()),('b2000000-0000-4000-8000-000000000002','374000000002',now()),
 ('b2000000-0000-4000-8000-000000000003',null,null),('b2000000-0000-4000-8000-000000000004',null,null),('b2000000-0000-4000-8000-000000000005',null,null);
update public.profiles set display_name='Synthetic booking member',birth_date='1980-01-01',biological_sex='female' where id::text like 'b2000000%';
insert into public.patient_consents(user_id,version)values('b2000000-0000-4000-8000-000000000001','patient-pilot-v1'),('b2000000-0000-4000-8000-000000000002','patient-pilot-v1');
insert into public.patient_assessments(user_id,revision,completed_at)values('b2000000-0000-4000-8000-000000000001',1,now()),('b2000000-0000-4000-8000-000000000002',1,now());
insert into auth.sessions(id,user_id,created_at,updated_at)select id,id,now(),now()from auth.users where id::text like 'b2000000%';
insert into public.workspace_clinics(id,name,address,scheduling_email)values('b2000000-0000-4000-8000-000000000010','Synthetic booking clinic','Synthetic clinic address','clinic@example.invalid');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('b2000000-0000-4000-8000-000000000003','admin','Synthetic booking admin',null),('b2000000-0000-4000-8000-000000000004','doctor','Synthetic booking doctor','b2000000-0000-4000-8000-000000000010'),('b2000000-0000-4000-8000-000000000005','nurse','Synthetic booking nurse','b2000000-0000-4000-8000-000000000010');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000005');
update public.workspace_scheduling_settings set copy_email='copy@example.invalid',revision=1;
create temp table email_ctx as select 'b2000000-0000-4000-8000-000000000001'::uuid member,'b2000000-0000-4000-8000-000000000020'::uuid command,
 jsonb_build_object('memberId','b2000000-0000-4000-8000-000000000001','sourceToken',c->>'token','requirementsToken',c->>'requirementsToken','engineVersion','synthetic-engine-v1','items',jsonb_build_array(
  jsonb_build_object('id','synthetic-lab','title','Synthetic lab','method','lab','preparation','Synthetic only','source','fixture'),
  jsonb_build_object('id','synthetic-clinic','title','Synthetic clinic test','method','clinic','preparation','Synthetic only','source','fixture'),
  jsonb_build_object('id','synthetic-home','title','Synthetic home task','method','home-log','preparation','Synthetic only','source','fixture'))) program
 from(select public.patient_test_context('b2000000-0000-4000-8000-000000000001')c)s;
grant select on email_ctx to authenticated,service_role;
select set_config('test.email_other_requirements',public.patient_test_context('b2000000-0000-4000-8000-000000000002')->>'requirementsToken',true);
select set_config('test.email_other_source',public.patient_test_context('b2000000-0000-4000-8000-000000000002')->>'token',true);
set local role service_role;
select public.register_booking_program(command,member,member,program)from email_ctx;
select public.register_booking_program(command,member,member,program)from email_ctx;
reset role;
select pg_temp.email_assert((select count(*)=1 from public.booking_program_seals),'Program seal retry writes once');
select pg_temp.email_assert((select public.patient_test_context(member)->>'token'=program->>'sourceToken'from email_ctx),'Seal registration does not invalidate its own clinical source');
set local role service_role;
select pg_temp.email_reject(format('select public.register_booking_program(%L,%L,%L,%L)',command,member,member,jsonb_set(program,'{items}','[]')),'22023')from email_ctx;
-- Manual continuity restores valid fresh requests; malformed trusted input remains denied.
select pg_temp.email_reject(format('select public.create_patient_test_request(%L,gen_random_uuid(),%L,%L,%L,%L)','b2000000-0000-4000-8000-000000000002',current_setting('test.email_other_source'),'{}','[]','synthetic-engine-v1'),'P0001');
reset role;
select pg_temp.email_actor('b2000000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.email_reject(format('select public.register_booking_program(%L,%L,%L,%L)',gen_random_uuid(),member,member,program),'42501')from email_ctx;
select pg_temp.email_reject('select * from public.booking_program_seals','42501');
select pg_temp.email_reject('insert into public.booking_program_seals(id)values(gen_random_uuid())','42501');
select pg_temp.email_reject('select public.booking_program_source(''b2000000-0000-4000-8000-000000000001'',''b2000000-0000-4000-8000-000000000001'')','42501');
reset role;
-- Production-capable manual/configured source: actual capacity/validity supplied
-- by its trusted operator, never generated for the real member UI.
select pg_temp.email_actor('b2000000-0000-4000-8000-000000000003');
create temp table email_offer as select jsonb_build_object('id','b2000000-0000-4000-8000-000000000030','version','source-v1','source','synthetic-manual-fixture','clinicId','b2000000-0000-4000-8000-000000000010','mode','clinic','startsAt',now()+interval '1 day','endsAt',now()+interval '1 day 1 hour','timezone','Asia/Yerevan','clinicAddress','Synthetic clinic address','preparation','Synthetic preparation only','preparationVersion','synthetic-v1','coveredTestIds',jsonb_build_array('synthetic-lab'),'followUps',jsonb_build_array(jsonb_build_object('testId','synthetic-clinic','owner','Synthetic operator','action','Synthetic follow-up','reference','synthetic-reference')),'reservationContract',jsonb_build_object('version','manual-v1','reference','synthetic-shared-capacity')) offer;
grant select on email_offer to service_role;
set local role service_role;
select public.register_manual_booking_offer('b2000000-0000-4000-8000-000000000003',offer,1,now()+interval '30 minutes')from email_offer;
select public.select_booking_appointment(command,member,member,command,(offer->>'id')::uuid,offer->>'version',p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Synthetic schedule',p_text_content=>'Synthetic approved content only')from email_ctx,email_offer;
select public.select_booking_appointment(command,member,member,command,(offer->>'id')::uuid,offer->>'version',p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Synthetic schedule',p_text_content=>'Synthetic approved content only')from email_ctx,email_offer;
reset role;
select pg_temp.email_assert((select count(*)=1 from public.booking_appointments),'Identical browser/HTTP/action replay creates one appointment');
select pg_temp.email_assert((select count(*)=1 from public.booking_appointment_versions),'HTTP replay creates one version');
select pg_temp.email_assert((select count(*)=1 from public.booking_scheduling_notices),'HTTP replay creates one notice');
select pg_temp.email_assert((select count(*)=1 from public.booking_manual_reservations),'HTTP replay allocates capacity once');
-- A partial recipient receipt is durable uncertainty, never confirmation.
set local role service_role;
select set_config('test.email_claim',public.claim_booking_notice('b2000000-0000-4000-8000-000000000020','b2000000-0000-4000-8000-000000000050',1,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1')::text,true);
select pg_temp.email_assert(public.claim_booking_notice('b2000000-0000-4000-8000-000000000020','b2000000-0000-4000-8000-000000000050',1,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1')is null,'Duplicate claim never authorizes another HTTP send');
savepoint partial_recipient;
select public.record_booking_notice_receipt('b2000000-0000-4000-8000-000000000020','b2000000-0000-4000-8000-000000000050',1,current_setting('test.email_claim')::jsonb->>'envelopeHash','accepted','synthetic-provider-reference',jsonb_build_object('clinic','clinic@example.invalid'));
select pg_temp.email_assert(public.apply_booking_notice_receipt('b2000000-0000-4000-8000-000000000020','b2000000-0000-4000-8000-000000000050','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1')->>'status'='unknown','Partial acceptance is unknown');
rollback to partial_recipient;
select public.record_booking_notice_receipt('b2000000-0000-4000-8000-000000000020','b2000000-0000-4000-8000-000000000050',1,current_setting('test.email_claim')::jsonb->>'envelopeHash','accepted','synthetic-provider-reference',jsonb_build_object('clinic','clinic@example.invalid','copy','copy@example.invalid'));
select pg_temp.email_assert(public.apply_booking_notice_receipt('b2000000-0000-4000-8000-000000000020','b2000000-0000-4000-8000-000000000050','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1')->>'status'='confirmed','Whole-envelope acceptance confirms without another clinic/member gate');
select public.apply_booking_notice_receipt('b2000000-0000-4000-8000-000000000020','b2000000-0000-4000-8000-000000000050','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');
reset role;
select pg_temp.email_assert((select count(*)=1 from public.booking_appointment_events where kind='accepted'),'Receipt replay applies once');
select pg_temp.email_assert((select current_arrangement=proposed_arrangement from public.booking_appointments),'Confirmed arrangement promoted');
-- New source versions do not create fresh capacity for the same reference.
update email_offer set offer=jsonb_set(jsonb_set(offer,'{version}','"source-v2"'),'{preparationVersion}','"synthetic-v2"');
set local role service_role;
select public.register_manual_booking_offer('b2000000-0000-4000-8000-000000000003',offer,1,now()+interval '30 minutes')from email_offer;
select public.register_booking_program('b2000000-0000-4000-8000-000000000022','b2000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002',jsonb_set(jsonb_set(jsonb_set(program,'{memberId}','"b2000000-0000-4000-8000-000000000002"'),'{sourceToken}',to_jsonb(current_setting('test.email_other_source'))),'{requirementsToken}',to_jsonb(current_setting('test.email_other_requirements'))))from email_ctx;
reset role;
set local role service_role;
select pg_temp.email_reject(format('select public.select_booking_appointment(%L,%L,%L,%L,%L,%L,p_sender_email=>%L,p_template_version=>%L,p_subject=>%L,p_text_content=>%L)','b2000000-0000-4000-8000-000000000023','b2000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000022',offer->>'id',offer->>'version','noreon@example.invalid','synthetic-approved-v1','Synthetic schedule','Synthetic approved content only'),'40001')from email_offer;
reset role;
select pg_temp.email_assert((select count(*)=1 from public.booking_manual_capacity),'Versions share one capacity pool');

savepoint outcome_failed;
set local role service_role;
select public.select_booking_appointment('b2000000-0000-4000-8000-000000000021',member,member,command,(offer->>'id')::uuid,offer->>'version',p_appointment_id=>command,p_revision=>0,p_agreement_source=>'Synthetic member agreement',p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Synthetic changed schedule',p_text_content=>'Synthetic approved changed content only')from email_ctx,email_offer;
select set_config('test.email_change_claim',public.claim_booking_notice('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051',1,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1')::text,true);
reset role;
set local role service_role;
select public.record_booking_notice_receipt('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051',1,current_setting('test.email_change_claim')::jsonb->>'envelopeHash','failed',null,null);
select public.apply_booking_notice_receipt('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');
reset role;
select pg_temp.email_assert((select status='failed'from public.booking_appointments where id='b2000000-0000-4000-8000-000000000020'),'Change outcome failed is truthful');
select pg_temp.email_assert((select current_arrangement->>'offerVersion'='source-v1'from public.booking_appointments where id='b2000000-0000-4000-8000-000000000020'),'Prior confirmed arrangement preserved unless exact valid acceptance');
select pg_temp.email_assert((select count(*)=2 from public.booking_manual_reservations where state='held'),'No implicit source capacity release');
rollback to outcome_failed;
savepoint outcome_unknown;
set local role service_role;
select public.select_booking_appointment('b2000000-0000-4000-8000-000000000021',member,member,command,(offer->>'id')::uuid,offer->>'version',p_appointment_id=>command,p_revision=>0,p_agreement_source=>'Synthetic member agreement',p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Synthetic changed schedule',p_text_content=>'Synthetic approved changed content only')from email_ctx,email_offer;
select set_config('test.email_change_claim',public.claim_booking_notice('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051',1,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1')::text,true);
reset role;
set local role service_role;
select public.record_booking_notice_receipt('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051',1,current_setting('test.email_change_claim')::jsonb->>'envelopeHash','unknown',null,null);
select public.apply_booking_notice_receipt('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');
reset role;
select pg_temp.email_assert((select status='unknown'from public.booking_appointments where id='b2000000-0000-4000-8000-000000000020'),'Change outcome unknown is truthful');
select pg_temp.email_assert((select current_arrangement->>'offerVersion'='source-v1'from public.booking_appointments where id='b2000000-0000-4000-8000-000000000020'),'Prior confirmed arrangement preserved unless exact valid acceptance');
select pg_temp.email_assert((select count(*)=2 from public.booking_manual_reservations where state='held'),'No implicit source capacity release');
rollback to outcome_unknown;
savepoint outcome_accepted;
set local role service_role;
select public.select_booking_appointment('b2000000-0000-4000-8000-000000000021',member,member,command,(offer->>'id')::uuid,offer->>'version',p_appointment_id=>command,p_revision=>0,p_agreement_source=>'Synthetic member agreement',p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Synthetic changed schedule',p_text_content=>'Synthetic approved changed content only')from email_ctx,email_offer;
select set_config('test.email_change_claim',public.claim_booking_notice('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051',1,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1')::text,true);
reset role;
set local role service_role;
select public.record_booking_notice_receipt('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051',1,current_setting('test.email_change_claim')::jsonb->>'envelopeHash','accepted','synthetic-change-receipt',jsonb_build_object('clinic','clinic@example.invalid','copy','copy@example.invalid'));
select public.apply_booking_notice_receipt('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');
reset role;
select pg_temp.email_assert((select status='confirmed'from public.booking_appointments where id='b2000000-0000-4000-8000-000000000020'),'Change outcome accepted is truthful');
select pg_temp.email_assert((select current_arrangement->>'offerVersion'='source-v2'from public.booking_appointments where id='b2000000-0000-4000-8000-000000000020'),'Prior confirmed arrangement preserved unless exact valid acceptance');
select pg_temp.email_assert((select count(*)=1 from public.booking_manual_reservations where state='held')and(select state='released'from public.booking_manual_reservations where id='b2000000-0000-4000-8000-000000000020'),'B1: an accepted change releases the replaced hold');
rollback to outcome_accepted;
savepoint outcome_expired;
set local role service_role;
select public.select_booking_appointment('b2000000-0000-4000-8000-000000000021',member,member,command,(offer->>'id')::uuid,offer->>'version',p_appointment_id=>command,p_revision=>0,p_agreement_source=>'Synthetic member agreement',p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Synthetic changed schedule',p_text_content=>'Synthetic approved changed content only')from email_ctx,email_offer;
select set_config('test.email_change_claim',public.claim_booking_notice('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051',1,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1')::text,true);
reset role;
update public.booking_manual_capacity set valid_until=now()-interval '1 second';
set local role service_role;
select public.record_booking_notice_receipt('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051',1,current_setting('test.email_change_claim')::jsonb->>'envelopeHash','accepted','synthetic-change-receipt',jsonb_build_object('clinic','clinic@example.invalid','copy','copy@example.invalid'));
select public.apply_booking_notice_receipt('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');
reset role;
select pg_temp.email_assert((select status='reconciliation'from public.booking_appointments where id='b2000000-0000-4000-8000-000000000020'),'Change outcome expired is truthful');
select pg_temp.email_assert((select current_arrangement->>'offerVersion'='source-v1'from public.booking_appointments where id='b2000000-0000-4000-8000-000000000020'),'Prior confirmed arrangement preserved unless exact valid acceptance');
select pg_temp.email_assert((select count(*)=2 from public.booking_manual_reservations where state='held'),'No implicit source capacity release');
rollback to outcome_expired;
savepoint outcome_source_changed;
set local role service_role;
select public.select_booking_appointment('b2000000-0000-4000-8000-000000000021',member,member,command,(offer->>'id')::uuid,offer->>'version',p_appointment_id=>command,p_revision=>0,p_agreement_source=>'Synthetic member agreement',p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Synthetic changed schedule',p_text_content=>'Synthetic approved changed content only')from email_ctx,email_offer;
select set_config('test.email_change_claim',public.claim_booking_notice('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051',1,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1')::text,true);
reset role;
update public.profiles set display_name='Synthetic source changed'where id='b2000000-0000-4000-8000-000000000001';
set local role service_role;
select public.record_booking_notice_receipt('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051',1,current_setting('test.email_change_claim')::jsonb->>'envelopeHash','accepted','synthetic-change-receipt',jsonb_build_object('clinic','clinic@example.invalid','copy','copy@example.invalid'));
select public.apply_booking_notice_receipt('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');
reset role;
select pg_temp.email_assert((select status='reconciliation'from public.booking_appointments where id='b2000000-0000-4000-8000-000000000020'),'Change outcome source_changed is truthful');
select pg_temp.email_assert((select current_arrangement->>'offerVersion'='source-v1'from public.booking_appointments where id='b2000000-0000-4000-8000-000000000020'),'Prior confirmed arrangement preserved unless exact valid acceptance');
select pg_temp.email_assert((select count(*)=2 from public.booking_manual_reservations where state='held'),'No implicit source capacity release');
rollback to outcome_source_changed;
savepoint outcome_configuration_changed;
set local role service_role;
select public.select_booking_appointment('b2000000-0000-4000-8000-000000000021',member,member,command,(offer->>'id')::uuid,offer->>'version',p_appointment_id=>command,p_revision=>0,p_agreement_source=>'Synthetic member agreement',p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Synthetic changed schedule',p_text_content=>'Synthetic approved changed content only')from email_ctx,email_offer;
select set_config('test.email_change_claim',public.claim_booking_notice('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051',1,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1')::text,true);
reset role;
update public.workspace_scheduling_settings set revision=revision+1,copy_email='newcopy@example.invalid'where id;
set local role service_role;
select public.record_booking_notice_receipt('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051',1,current_setting('test.email_change_claim')::jsonb->>'envelopeHash','accepted','synthetic-change-receipt',jsonb_build_object('clinic','clinic@example.invalid','copy','copy@example.invalid'));
select public.apply_booking_notice_receipt('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');
reset role;
select pg_temp.email_assert((select status='reconciliation'from public.booking_appointments where id='b2000000-0000-4000-8000-000000000020'),'Change outcome configuration_changed is truthful');
select pg_temp.email_assert((select current_arrangement->>'offerVersion'='source-v1'from public.booking_appointments where id='b2000000-0000-4000-8000-000000000020'),'Prior confirmed arrangement preserved unless exact valid acceptance');
select pg_temp.email_assert((select count(*)=2 from public.booking_manual_reservations where state='held'),'No implicit source capacity release');
rollback to outcome_configuration_changed;
savepoint outcome_expired_lease;
set local role service_role;
select public.select_booking_appointment('b2000000-0000-4000-8000-000000000021',member,member,command,(offer->>'id')::uuid,offer->>'version',p_appointment_id=>command,p_revision=>0,p_agreement_source=>'Synthetic member agreement',p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Synthetic changed schedule',p_text_content=>'Synthetic approved changed content only')from email_ctx,email_offer;
select set_config('test.email_change_claim',public.claim_booking_notice('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051',1,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1')::text,true);
reset role;
update public.booking_scheduling_notices set lease_until=now()-interval '1 second'where id='b2000000-0000-4000-8000-000000000021';
set local role service_role;
select public.record_booking_notice_receipt('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051',1,current_setting('test.email_change_claim')::jsonb->>'envelopeHash','accepted','synthetic-change-receipt',jsonb_build_object('clinic','clinic@example.invalid','copy','copy@example.invalid'));
select public.apply_booking_notice_receipt('b2000000-0000-4000-8000-000000000021','b2000000-0000-4000-8000-000000000051','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');
reset role;
select pg_temp.email_assert((select status='reconciliation'from public.booking_appointments where id='b2000000-0000-4000-8000-000000000020'),'Change outcome expired_lease is truthful');
select pg_temp.email_assert((select current_arrangement->>'offerVersion'='source-v1'from public.booking_appointments where id='b2000000-0000-4000-8000-000000000020'),'Prior confirmed arrangement preserved unless exact valid acceptance');
select pg_temp.email_assert((select count(*)=2 from public.booking_manual_reservations where state='held'),'No implicit source capacity release');
rollback to outcome_expired_lease;
rollback;
\echo 'Booking email authority/cutover tests passed (synthetic privileged program fixture; clinical engine tested separately).'
