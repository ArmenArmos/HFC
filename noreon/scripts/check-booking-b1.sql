-- B1 unified booking: capability slots, member/staff cancellation, hold release,
-- admin slots and the clinic notice inputs. Synthetic data on an owned replay database.
\set ON_ERROR_STOP on
begin;
create function pg_temp.b1_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.b1_reject(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected rejection % for %',expected,q;
end$$;
create function pg_temp.b1_actor(id uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated','session_id',id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
end$$;
-- Accept, fail or leave unknown the generation-1 email of a notice, as the runtime would.
create function pg_temp.b1_send(p_notice uuid,p_attempt uuid,p_outcome text) returns jsonb language plpgsql as $$declare claim jsonb;begin
 claim:=public.claim_booking_notice(p_notice,p_attempt,1,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');
 if claim is null then raise exception 'TEST claim refused for %',p_notice;end if;
 perform public.record_booking_notice_receipt(p_notice,p_attempt,1,claim->>'envelopeHash',p_outcome,case when p_outcome='accepted'then 'synthetic-receipt'end,
  case when p_outcome='accepted'then jsonb_build_object('clinic',claim->>'clinicEmail','copy',claim->>'copyEmail')end);
 return public.apply_booking_notice_receipt(p_notice,p_attempt,'synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1');
end$$;
grant execute on function pg_temp.b1_send(uuid,uuid,text) to service_role;

insert into auth.users(id,phone,phone_confirmed_at)values
 ('b3000000-0000-4000-8000-000000000001','37499000001',now()),('b3000000-0000-4000-8000-000000000002','37499000002',now()),
 ('b3000000-0000-4000-8000-000000000003',null,null),('b3000000-0000-4000-8000-000000000004',null,null),('b3000000-0000-4000-8000-000000000005',null,null);
update public.profiles set display_name='Fictional B1 member',birth_date='1980-01-01',biological_sex='female' where id::text like 'b3000000%';
insert into public.patient_consents(user_id,version)values('b3000000-0000-4000-8000-000000000001','patient-pilot-v1'),('b3000000-0000-4000-8000-000000000002','patient-pilot-v1');
insert into public.patient_assessments(user_id,revision,completed_at)values('b3000000-0000-4000-8000-000000000001',1,now()),('b3000000-0000-4000-8000-000000000002',1,now());
insert into auth.sessions(id,user_id,created_at,updated_at)select id,id,now(),now()from auth.users where id::text like 'b3000000%';
insert into public.workspace_clinics(id,name,address,scheduling_email)values('b3000000-0000-4000-8000-000000000010','Fictional B1 clinic','1 Fictional Street, Yerevan','clinic-b1@example.invalid');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('b3000000-0000-4000-8000-000000000003','admin','Fictional B1 admin',null),('b3000000-0000-4000-8000-000000000004','doctor','Fictional B1 doctor','b3000000-0000-4000-8000-000000000010'),('b3000000-0000-4000-8000-000000000005','nurse','Fictional B1 nurse','b3000000-0000-4000-8000-000000000010');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values('b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000004','b3000000-0000-4000-8000-000000000005');
update public.workspace_scheduling_settings set copy_email='noreon-copy@example.invalid',revision=revision+1;
create temp table b1 as select 'b3000000-0000-4000-8000-000000000001'::uuid member,'b3000000-0000-4000-8000-000000000020'::uuid seal,
 jsonb_build_object('memberId','b3000000-0000-4000-8000-000000000001','sourceToken',c->>'token','requirementsToken',c->>'requirementsToken','engineVersion','synthetic-engine-v1','items',jsonb_build_array(
  jsonb_build_object('id','lab-a','title','Fictional lab A','method','lab','preparation','Fictional','source','fixture'),
  jsonb_build_object('id','ecg-b','title','Fictional ECG B','method','clinic','preparation','Fictional','source','fixture'),
  jsonb_build_object('id','home-c','title','Fictional home task','method','home-log','preparation','Fictional','source','fixture'))) program
 from(select public.patient_test_context('b3000000-0000-4000-8000-000000000001')c)s;
grant select on b1 to service_role;
create function pg_temp.b1_offer(id text,mode text,covered jsonb,follow jsonb,ref text) returns jsonb language sql as $$
 select jsonb_build_object('id',id,'version','v1','source','b1-admin-fixture','clinicId','b3000000-0000-4000-8000-000000000010','mode',mode,
  'startsAt',now()+interval '2 days','endsAt',now()+interval '2 days 1 hour','timezone','Asia/Yerevan','clinicAddress',case when mode='clinic'then '1 Fictional Street, Yerevan'end,
  'preparation','Fictional preparation','preparationVersion','p1','coveredTestIds',covered,'followUps',follow,'reservationContract',jsonb_build_object('version','admin-slot-v1','reference',ref))
$$;
grant execute on function pg_temp.b1_offer(text,text,jsonb,jsonb,text) to service_role;

-- 1. Capability slots: a superset slot qualifies; a partial slot needs a follow-up for the rest.
select pg_temp.b1_actor('b3000000-0000-4000-8000-000000000003');
set local role service_role;
select public.register_booking_program(seal,member,member,program)from b1;
select public.register_manual_booking_offer('b3000000-0000-4000-8000-000000000003',pg_temp.b1_offer('b3000000-0000-4000-8000-0000000000a1','clinic','["lab-a","ecg-b","tsh"]','[]','slot-superset'),2,now()+interval '2 days');
select public.register_manual_booking_offer('b3000000-0000-4000-8000-000000000003',pg_temp.b1_offer('b3000000-0000-4000-8000-0000000000a2','home','["lab-a"]','[]','slot-partial'),2,now()+interval '2 days');
select public.register_manual_booking_offer('b3000000-0000-4000-8000-000000000003',pg_temp.b1_offer('b3000000-0000-4000-8000-0000000000a3','home','["tsh"]','[{"testId":"lab-a","owner":"Ops","action":"Separate visit","reference":"r"},{"testId":"ecg-b","owner":"Ops","action":"Separate visit","reference":"r"}]','slot-none'),2,now()+interval '2 days');
select public.register_manual_booking_offer('b3000000-0000-4000-8000-000000000003',pg_temp.b1_offer('b3000000-0000-4000-8000-0000000000a4','home','["lab-a","tsh"]','[{"testId":"tsh","owner":"Ops","action":"Unused","reference":"r"},{"testId":"ecg-b","owner":"Fictional operations","action":"Books a short clinic visit","reference":"r"},{"testId":"ecg-b","owner":"Duplicate","action":"Ignored","reference":"r"}]','slot-followup'),2,now()+interval '2 days');
create temp table b1_offers as select public.booking_pilot_offers(member,member,seal) list from b1;
reset role;
select pg_temp.b1_assert((select jsonb_array_length(list)=2 from b1_offers),'Only qualifying slots are offered (superset and partial with follow-up)');
select pg_temp.b1_assert((select o->'offer'->'coveredTestIds'='["lab-a","ecg-b"]'::jsonb and o->'offer'->'followUps'='[]'::jsonb from b1_offers,jsonb_array_elements(list)o where o->'offer'->>'id'='b3000000-0000-4000-8000-0000000000a1'),'Superset slot is projected to the member''s own tests');
select pg_temp.b1_assert((select o->'offer'->'coveredTestIds'='["lab-a"]'::jsonb and o->'offer'->'followUps'='[{"testId":"ecg-b","owner":"Fictional operations","action":"Books a short clinic visit","reference":"r"}]'::jsonb from b1_offers,jsonb_array_elements(list)o where o->'offer'->>'id'='b3000000-0000-4000-8000-0000000000a4'),'Partial slot keeps only the member''s uncovered follow-up, first one wins');
select pg_temp.b1_assert(not public._booking_offer_coverage((select program from b1),pg_temp.b1_offer(gen_random_uuid()::text,'home','["lab-a"]','[]','x')),'A slot leaving a test without follow-up is not offered');
select pg_temp.b1_assert(public._booking_offer_coverage((select program from b1),pg_temp.b1_offer(gen_random_uuid()::text,'clinic','["lab-a"]','[{"testId":"ecg-b","owner":"o","action":"a","reference":"r"}]','x')),'An exact pre-B1 offer still qualifies');

-- 2. Book the superset clinic slot: stored arrangement uses the projection; purpose booking.
set local role service_role;
select public.select_booking_appointment('b3000000-0000-4000-8000-000000000030',member,member,seal,'b3000000-0000-4000-8000-0000000000a1','v1',p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Fictional booking',p_text_content=>'Fictional approved booking text')from b1;
reset role;
select pg_temp.b1_assert((select proposed_arrangement->'coveredTestIds'='["lab-a","ecg-b"]'::jsonb from public.booking_appointments where id='b3000000-0000-4000-8000-000000000030'),'Stored arrangement holds the projected coverage');
select pg_temp.b1_assert((select purpose='booking'from public.booking_scheduling_notices where id='b3000000-0000-4000-8000-000000000030'),'First notice is a booking');
set local role service_role;
select pg_temp.b1_assert(pg_temp.b1_send('b3000000-0000-4000-8000-000000000030','b3000000-0000-4000-8000-000000000040','accepted')->>'status'='confirmed','Accepted booking email confirms');
reset role;

-- 3. Member workspace carries the phone for the clinic notice and clinic names.
select pg_temp.b1_actor('b3000000-0000-4000-8000-000000000001');
set local role authenticated;
-- Migration-first rollout: the released workspace and appointment shapes are unchanged for the previous app.
select pg_temp.b1_assert((select array_agg(k order by k)=array['appointments','member'] from jsonb_object_keys(public.booking_pilot_workspace())k),'Workspace keeps its released keys');
select pg_temp.b1_assert((select array_agg(k order by k)=array['id','name'] from jsonb_object_keys(public.booking_pilot_workspace()->'member')k),'Workspace member keeps its released keys');
select pg_temp.b1_assert((select not(public.booking_pilot_workspace()#>'{appointments,0}' ? 'noticePurpose')),'Appointment record shape unchanged');
select pg_temp.b1_assert((select public.booking_pilot_workspace_details()->>'phone'='37499000001'),'Details include the verified phone');
select pg_temp.b1_assert((select public.booking_pilot_workspace_details()#>>'{clinics,b3000000-0000-4000-8000-000000000010}'='Fictional B1 clinic'),'Details name the booked clinic');
select pg_temp.b1_assert((select public.booking_pilot_workspace_details()#>>'{purposes,b3000000-0000-4000-8000-000000000030:0}'='booking'),'Details carry the notice purpose');
reset role;
select pg_temp.b1_actor('b3000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.b1_reject('select public.booking_pilot_workspace(''b3000000-0000-4000-8000-000000000001'')','42501');
select pg_temp.b1_reject('select public.booking_pilot_workspace_details(''b3000000-0000-4000-8000-000000000001'')','42501');
reset role;

-- 3b. A change to another clinic is refused: that would release the first clinic's hold without telling it.
insert into public.workspace_clinics(id,name,address,scheduling_email)values('b3000000-0000-4000-8000-000000000011','Fictional B1 clinic two','2 Fictional Street, Yerevan','clinic-b1-two@example.invalid');
select pg_temp.b1_actor('b3000000-0000-4000-8000-000000000003');
set local role service_role;
select public.register_manual_booking_offer('b3000000-0000-4000-8000-000000000003',pg_temp.b1_offer('b3000000-0000-4000-8000-0000000000a6','home','["lab-a","ecg-b"]','[]','slot-other-clinic')||'{"clinicId":"b3000000-0000-4000-8000-000000000011"}',2,now()+interval '2 days');
do $$begin
 perform public.select_booking_appointment(gen_random_uuid(),'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000020','b3000000-0000-4000-8000-0000000000a6','v1',p_home_address=>'2 Fictional Home Street',p_appointment_id=>'b3000000-0000-4000-8000-000000000030',p_revision=>0,p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'x',p_text_content=>'y');
 raise exception 'TEST cross-clinic change accepted';
exception when invalid_parameter_value then
 if sqlerrm not like 'Reschedule within the same clinic%' then raise exception 'TEST cross-clinic change refused for another reason: %',sqlerrm;end if;
end$$;
reset role;

-- 4. Change to the partial home slot: purpose change; accepted change releases the old hold.
set local role service_role;
select public.select_booking_appointment('b3000000-0000-4000-8000-000000000031',member,member,seal,'b3000000-0000-4000-8000-0000000000a4','v1',p_home_address=>'2 Fictional Home Street',p_appointment_id=>'b3000000-0000-4000-8000-000000000030',p_revision=>0,p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Fictional change',p_text_content=>'Fictional approved change text')from b1;
reset role;
select pg_temp.b1_assert((select purpose='change'from public.booking_scheduling_notices where id='b3000000-0000-4000-8000-000000000031'),'Second notice is a change');
select pg_temp.b1_assert((select count(*)=2 from public.booking_manual_reservations where member_id='b3000000-0000-4000-8000-000000000001'and state='held'),'Both holds kept while the change email is pending');
set local role service_role;
select pg_temp.b1_assert(pg_temp.b1_send('b3000000-0000-4000-8000-000000000031','b3000000-0000-4000-8000-000000000041','accepted')->>'status'='confirmed','Accepted change confirms');
reset role;
select pg_temp.b1_assert((select state='released'from public.booking_manual_reservations where id='b3000000-0000-4000-8000-000000000030')and(select state='held'from public.booking_manual_reservations where id='b3000000-0000-4000-8000-000000000031'),'Accepted change releases the replaced hold only');

-- 4b. Failed change, then cancel: the accepted cancellation releases both the current and the failed change's hold.
savepoint failed_change_cancel;
set local role service_role;
select public.select_booking_appointment('b3000000-0000-4000-8000-000000000035',member,member,seal,'b3000000-0000-4000-8000-0000000000a1','v1',p_appointment_id=>'b3000000-0000-4000-8000-000000000030',p_revision=>1,p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Fictional change',p_text_content=>'Fictional change text')from b1;
select pg_temp.b1_assert(pg_temp.b1_send('b3000000-0000-4000-8000-000000000035','b3000000-0000-4000-8000-000000000045','failed')->>'status'='failed','Failed change is truthful');
reset role;
select pg_temp.b1_assert((select count(*)=2 from public.booking_manual_reservations where appointment_id='b3000000-0000-4000-8000-000000000030'and state='held'),'Failed change keeps both holds');
set local role service_role;
select public.cancel_booking_appointment('b3000000-0000-4000-8000-000000000036','b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000030',2,null,'noreon@example.invalid','synthetic-approved-v1','Fictional cancel','Fictional cancel text');
select pg_temp.b1_assert(pg_temp.b1_send('b3000000-0000-4000-8000-000000000036','b3000000-0000-4000-8000-000000000046','accepted')->>'status'='cancelled','Cancel after a failed change cancels the current visit');
reset role;
select pg_temp.b1_assert((select reservation_id='b3000000-0000-4000-8000-000000000031'from public.booking_scheduling_notices where id='b3000000-0000-4000-8000-000000000036'),'Cancellation targeted the current visit, not the failed change');
select pg_temp.b1_assert(not exists(select 1 from public.booking_manual_reservations where appointment_id='b3000000-0000-4000-8000-000000000030'and state='held'),'Both holds released');
rollback to failed_change_cancel;

-- 4c. A slot closed while its change email is sending: the receipt cannot confirm; the arrangement goes to review.
savepoint close_during_send;
set local role service_role;
select public.select_booking_appointment('b3000000-0000-4000-8000-000000000037',member,member,seal,'b3000000-0000-4000-8000-0000000000a1','v1',p_appointment_id=>'b3000000-0000-4000-8000-000000000030',p_revision=>1,p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Fictional change',p_text_content=>'Fictional change text')from b1;
select set_config('test.b1_claim',public.claim_booking_notice('b3000000-0000-4000-8000-000000000037','b3000000-0000-4000-8000-000000000047',1,now()+interval '5 minutes','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1')::text,true);
reset role;
update public.booking_manual_capacity set valid_until=clock_timestamp()where reference='slot-superset';
set local role service_role;
select public.record_booking_notice_receipt('b3000000-0000-4000-8000-000000000037','b3000000-0000-4000-8000-000000000047',1,current_setting('test.b1_claim')::jsonb->>'envelopeHash','accepted','r',jsonb_build_object('clinic','clinic-b1@example.invalid','copy','noreon-copy@example.invalid'));
select pg_temp.b1_assert(public.apply_booking_notice_receipt('b3000000-0000-4000-8000-000000000037','b3000000-0000-4000-8000-000000000047','synthetic-engine-v1','noreon@example.invalid','synthetic-approved-v1')->>'status'='reconciliation','Closed slot sends the change to review');
reset role;
select pg_temp.b1_assert((select current_reservation_id='b3000000-0000-4000-8000-000000000031'from public.booking_appointments where id='b3000000-0000-4000-8000-000000000030'),'Current visit unchanged');
select pg_temp.b1_assert((select state='held'from public.booking_manual_reservations where id='b3000000-0000-4000-8000-000000000031'),'Current hold not released by an unconfirmed change');
rollback to close_during_send;

-- 5. Cancellation guards.
select pg_temp.b1_actor('b3000000-0000-4000-8000-000000000004');
set local role service_role;
select pg_temp.b1_reject(format('select public.cancel_booking_appointment(%L,%L,%L,%L,%L,null,%L,%L,%L,%L)',gen_random_uuid(),'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000030',0,'noreon@example.invalid','synthetic-approved-v1','Fictional cancel','Fictional text'),'40001');
select pg_temp.b1_reject(format('select public.cancel_booking_appointment(%L,%L,%L,%L,%L,null,%L,%L,%L,%L)',gen_random_uuid(),'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000004','b3000000-0000-4000-8000-000000000030',1,'noreon@example.invalid','synthetic-approved-v1','Fictional cancel','Fictional text'),'22023');
select pg_temp.b1_reject(format('select public.cancel_booking_appointment(%L,%L,%L,%L,%L,null,%L,%L,%L,%L)',gen_random_uuid(),'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000030',1,'noreon@example.invalid','synthetic-approved-v1','Fictional cancel','Fictional text'),'42501');
select pg_temp.b1_reject(format('select public.cancel_booking_appointment(%L,%L,%L,%L,%L,null,%L,%L,%L,%L)',gen_random_uuid(),'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000030',1,'noreon@example.invalid','synthetic-approved-v1','Fictional cancel',''),'22023');
reset role;
savepoint started;
update public.booking_appointments set current_arrangement=jsonb_set(current_arrangement,'{startsAt}',to_jsonb(now()-interval '1 minute'))where id='b3000000-0000-4000-8000-000000000030';
set local role service_role;
select pg_temp.b1_reject(format('select public.cancel_booking_appointment(%L,%L,%L,%L,%L,null,%L,%L,%L,%L)',gen_random_uuid(),'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000030',1,'noreon@example.invalid','synthetic-approved-v1','Fictional cancel','Fictional text'),'40001');
reset role;
rollback to started;
select pg_temp.b1_assert(not exists(select 1 from pg_proc p where p.proname='cancel_booking_appointment'and has_function_privilege('authenticated',p.oid,'execute')),'Cancel is not callable by browsers directly');

-- 6. A failed cancellation email keeps the visit booked and its hold.
savepoint cancel_failed;
set local role service_role;
select public.cancel_booking_appointment('b3000000-0000-4000-8000-000000000032','b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000030',1,null,'noreon@example.invalid','synthetic-approved-v1','Fictional cancel','Fictional cancel text');
select pg_temp.b1_assert(pg_temp.b1_send('b3000000-0000-4000-8000-000000000032','b3000000-0000-4000-8000-000000000042','failed')->>'status'='failed','Failed cancellation is truthful');
reset role;
select pg_temp.b1_assert((select current_arrangement is not null and current_reservation_id='b3000000-0000-4000-8000-000000000031'from public.booking_appointments where id='b3000000-0000-4000-8000-000000000030'),'Failed cancellation keeps the visit');
select pg_temp.b1_assert((select state='held'from public.booking_manual_reservations where id='b3000000-0000-4000-8000-000000000031'),'Failed cancellation keeps the hold');
rollback to cancel_failed;

-- 7. A staff cancellation needs recorded member agreement; then a source change does not block it.
select pg_temp.b1_actor('b3000000-0000-4000-8000-000000000004');
set local role service_role;
select pg_temp.b1_reject(format('select public.cancel_booking_appointment(%L,%L,%L,%L,%L,null,%L,%L,%L,%L)',gen_random_uuid(),'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000004','b3000000-0000-4000-8000-000000000030',1,'noreon@example.invalid','synthetic-approved-v1','Fictional cancel','Fictional text'),'22023');
select public.cancel_booking_appointment('b3000000-0000-4000-8000-000000000033','b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000004','b3000000-0000-4000-8000-000000000030',1,'Member phoned on 16 Oct','noreon@example.invalid','synthetic-approved-v1','Fictional cancel','Fictional cancel text');
-- Replay with re-rendered content returns the recorded result without a new version.
select public.cancel_booking_appointment('b3000000-0000-4000-8000-000000000033','b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000004','b3000000-0000-4000-8000-000000000030',1,'Member phoned on 16 Oct','noreon@example.invalid','synthetic-approved-v1','Fictional cancel','Re-rendered text');
select pg_temp.b1_reject(format('select public.cancel_booking_appointment(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)','b3000000-0000-4000-8000-000000000033','b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000004','b3000000-0000-4000-8000-000000000030',1,'Different agreement','noreon@example.invalid','synthetic-approved-v1','Fictional cancel','Fictional text'),'22023');
reset role;
select pg_temp.b1_assert((select count(*)=3 from public.booking_appointment_versions where appointment_id='b3000000-0000-4000-8000-000000000030'),'Cancel replay adds no version');
select pg_temp.b1_assert((select status='notification-pending'and current_arrangement is not null and proposed_arrangement=current_arrangement from public.booking_appointments where id='b3000000-0000-4000-8000-000000000030'),'Visit stays booked until the cancellation email is accepted');
select pg_temp.b1_assert((select purpose='cancellation'and reservation_id='b3000000-0000-4000-8000-000000000031'from public.booking_scheduling_notices where id='b3000000-0000-4000-8000-000000000033'),'Cancellation notice targets the current hold');
set local role service_role;
select pg_temp.b1_reject(format('select public.select_booking_appointment(%L,%L,%L,%L,%L,%L,p_appointment_id=>%L,p_revision=>2,p_sender_email=>%L,p_template_version=>%L,p_subject=>%L,p_text_content=>%L)',gen_random_uuid(),'b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000020','b3000000-0000-4000-8000-0000000000a1','v1','b3000000-0000-4000-8000-000000000030','noreon@example.invalid','synthetic-approved-v1','x','y'),'40001');
reset role;
update public.profiles set display_name='Fictional B1 member renamed'where id='b3000000-0000-4000-8000-000000000001';
select pg_temp.b1_assert((select public.patient_test_context(member)->>'token'is distinct from program->>'sourceToken'from b1),'Fixture changed the clinical source');
set local role service_role;
select pg_temp.b1_assert(pg_temp.b1_send('b3000000-0000-4000-8000-000000000033','b3000000-0000-4000-8000-000000000043','accepted')->>'status'='cancelled','Accepted cancellation email cancels even after a source change');
reset role;
select pg_temp.b1_assert((select current_arrangement is null and current_reservation_id is null and status='cancelled'from public.booking_appointments where id='b3000000-0000-4000-8000-000000000030'),'Cancelled visit has no current arrangement');
select pg_temp.b1_assert(not exists(select 1 from public.booking_manual_reservations where appointment_id='b3000000-0000-4000-8000-000000000030'and state='held'),'Cancellation releases every hold');
select pg_temp.b1_assert(exists(select 1 from public.booking_appointment_events where notice_id='b3000000-0000-4000-8000-000000000033'and kind='accepted'),'Cancellation outcome is an immutable event');
select pg_temp.b1_assert((select public.booking_pilot_workspace_details('b3000000-0000-4000-8000-000000000001')#>>'{purposes,b3000000-0000-4000-8000-000000000030:2}'='cancellation'),'History records the cancellation');

-- 8. Rebook the cancelled visit: a new booking (no previous arrangement), capacity freed.
update b1 set program=jsonb_set(program,'{sourceToken}',to_jsonb(public.patient_test_context(member)->>'token'));
set local role service_role;
select public.register_booking_program('b3000000-0000-4000-8000-000000000021',member,member,program)from b1;
select public.select_booking_appointment('b3000000-0000-4000-8000-000000000034',member,member,'b3000000-0000-4000-8000-000000000021','b3000000-0000-4000-8000-0000000000a1','v1',p_appointment_id=>'b3000000-0000-4000-8000-000000000030',p_revision=>2,p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Fictional rebook',p_text_content=>'Fictional approved booking text')from b1;
reset role;
select pg_temp.b1_assert((select purpose='booking'from public.booking_scheduling_notices where id='b3000000-0000-4000-8000-000000000034'),'Rebooking after cancellation is a booking notice');
select pg_temp.b1_assert((select previous_arrangement is null from public.booking_appointment_versions where notice_id='b3000000-0000-4000-8000-000000000034'),'Rebooking has no previous arrangement');

-- 9. Admin slots: admin only; close stops offering, keeps holds.
select set_config('test.b1_superset_key',(select key from public.booking_manual_capacity where reference='slot-superset'),true);
select pg_temp.b1_actor('b3000000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.b1_reject('select public.real_admin_booking_slots()','42501');
select pg_temp.b1_reject(format('select public.real_admin_create_booking_slot(%L,1,now()+interval ''1 day'')',pg_temp.b1_offer(gen_random_uuid()::text,'clinic','["lab-a"]','[]','doctor-slot')),'42501');
reset role;
select pg_temp.b1_actor('b3000000-0000-4000-8000-000000000003');
set local role authenticated;
select public.real_admin_create_booking_slot(pg_temp.b1_offer('b3000000-0000-4000-8000-0000000000a5','clinic','["lab-a","ecg-b"]','[]','admin-slot'),3,now()+interval '2 days');
select public.real_admin_create_booking_slot(pg_temp.b1_offer('b3000000-0000-4000-8000-0000000000a5','clinic','["lab-a","ecg-b"]','[]','admin-slot'),3,now()+interval '2 days');
select pg_temp.b1_reject(format('select public.real_admin_create_booking_slot(%L,3,now()+interval ''2 days'')',pg_temp.b1_offer(gen_random_uuid()::text,'clinic','["lab-a"]','[]','bad-address')||'{"clinicAddress":"Wrong"}'),'22023');
select pg_temp.b1_assert((select count(*)=1 from jsonb_array_elements(public.real_admin_booking_slots())s where s->>'reference'='admin-slot'and(s->>'capacity')::int=3 and(s->>'open')::boolean),'Admin slot listed once after a resubmission');
select pg_temp.b1_assert((select (s->>'held')::int=1 from jsonb_array_elements(public.real_admin_booking_slots())s where s->>'reference'='slot-superset'),'Listing counts the rebooked hold');
select public.real_admin_close_booking_slot(current_setting('test.b1_superset_key'));
select pg_temp.b1_assert((select not(s->>'open')::boolean from jsonb_array_elements(public.real_admin_booking_slots())s where s->>'reference'='slot-superset'),'Closed slot is no longer open');
select pg_temp.b1_reject('select * from public.booking_manual_capacity','42501');
reset role;
select pg_temp.b1_assert((select state='held'from public.booking_manual_reservations where id='b3000000-0000-4000-8000-000000000034'),'Closing keeps the visit already held');
set local role service_role;
select pg_temp.b1_assert(not exists(select 1 from b1,jsonb_array_elements(public.booking_pilot_offers(b1.member,b1.member,'b3000000-0000-4000-8000-000000000021'))o where o->'offer'->>'id'='b3000000-0000-4000-8000-0000000000a1'),'Closed slot is not offered');
reset role;
rollback;
\echo 'B1 booking: capability slots, projection, change hold release, cancellation (guards, failure, replay, source change), rebook, admin slots passed.'
