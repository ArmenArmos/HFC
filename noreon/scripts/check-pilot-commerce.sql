-- Fictional pilot catalogue, price history, payment records, provider events and
-- the cohort overview; all fixtures roll back. Every outcome is asserted on stored values.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'TEST %',label;end if;
end$$;
-- pc fixture namespace: member 01, doctor 02, admin 03, member 04, clinic 07.
insert into auth.users(id,phone,phone_confirmed_at) values
 ('9c000000-0000-4000-8000-000000000001','374000990001',now()),('9c000000-0000-4000-8000-000000000002',null,null),
 ('9c000000-0000-4000-8000-000000000003',null,null),('9c000000-0000-4000-8000-000000000004','374000990004',now());
update public.profiles set display_name='Synthetic payer one' where id='9c000000-0000-4000-8000-000000000001';
insert into public.workspace_clinics(id,name) values('9c000000-0000-4000-8000-000000000007','Synthetic pricing clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id) values
 ('9c000000-0000-4000-8000-000000000002','doctor','Synthetic pricing doctor','9c000000-0000-4000-8000-000000000007'),
 ('9c000000-0000-4000-8000-000000000003','admin','Synthetic pricing admin',null);
insert into auth.sessions(id,user_id,created_at,updated_at) select ('9c000000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid,('9c000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,now(),now() from generate_series(1,4)n;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values
 ('9c000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000002'),('9c000000-0000-4000-8000-000000000004',null);
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at)values
 ('9c000000-0000-4000-8000-000000000001','9c000000-0000-4000-8000-000000000900',138,88,70,now()-interval '1 hour');
-- Bookings: a priced request, an unpriced request, a cancelled request, and a unified-booking appointment.
insert into public.patient_test_requests(id,user_id,status,requested_terms,requirements,algorithm_version,context_token,create_payload)values
 ('9c000000-0000-4000-8000-000000000a01','9c000000-0000-4000-8000-000000000001','requested','{}',
  '[{"id":"lipid-panel","title":"Lipid profile","method":"lab"},{"id":"bp-visit","title":"BP","method":"clinic"},{"id":"hba1c","title":"HbA1c","method":"lab"}]','t','t','{}'),
 ('9c000000-0000-4000-8000-000000000a02','9c000000-0000-4000-8000-000000000001','requested','{}',
  '[{"id":"lipid-panel","title":"Lipid profile","method":"lab"},{"id":"mystery-test","title":"Unknown","method":"lab"}]','t','t','{}'),
 ('9c000000-0000-4000-8000-000000000a03','9c000000-0000-4000-8000-000000000004','cancelled','{}','[{"id":"tsh","title":"TSH","method":"lab"}]','t','t','{}');
-- Appointment FKs to its notice and reservation are deferred and never checked: this transaction rolls back.
insert into public.booking_program_seals(id,member_id,actor_id,source_token,requirements_token,engine_version,program)values
 ('9c000000-0000-4000-8000-000000000b01','9c000000-0000-4000-8000-000000000004','9c000000-0000-4000-8000-000000000004','s','r','e',
  '{"items":[{"id":"ecg-12-lead","title":"ECG","method":"clinic"},{"id":"bp-home-log","title":"Home log","method":"home-log"},{"id":"tsh","title":"TSH","method":"lab"}]}');
insert into public.booking_appointments(id,member_id,program_id,requirements_token,status,proposed_arrangement,proposed_reservation_id,notice_id)values
 ('9c000000-0000-4000-8000-000000000b02','9c000000-0000-4000-8000-000000000004','9c000000-0000-4000-8000-000000000b01','r','confirmed','{}',
  '9c000000-0000-4000-8000-000000000b03','9c000000-0000-4000-8000-000000000b04');

create function pg_temp.as_user(n int) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','9c000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'exp',extract(epoch from now()+interval '1 hour')::bigint,
  'session_id','9c000000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::text,true)
$$;
create function pg_temp.sub(n text) returns uuid language sql as $$select ('9c000000-0000-4000-8000-0000000005'||lpad(n,2,'0'))::uuid$$;
create function pg_temp.cmd(n text,body jsonb) returns jsonb language sql as $$select public.pilot_command(body||jsonb_build_object('submissionId',pg_temp.sub(n)))$$;
-- The overview counts Yerevan days; UTC current_date is a day behind 00:00-04:00 Yerevan.
create function pg_temp.today() returns date language sql as $$select (clock_timestamp() at time zone 'Asia/Yerevan')::date$$;
create function pg_temp.refused(q text) returns boolean language plpgsql as $$begin execute q;return false;exception when insufficient_privilege or invalid_parameter_value then return true;end$$;
create temp table r(label text primary key,result jsonb);
create temp table tid as select test_key k,id,(select price_amd from public._pilot_current_price(t.id,now()))price from public.pilot_catalog_tests t;
grant select on tid to authenticated,service_role;
grant all on r to authenticated,service_role;
grant execute on function pg_temp.as_user(int),pg_temp.sub(text),pg_temp.cmd(text,jsonb),pg_temp.refused(text),pg_temp.today() to authenticated,service_role;

select pg_temp.ok(not has_function_privilege('anon','public.pilot_command(jsonb)','execute')
 and not has_function_privilege('anon','public.pilot_catalog_member()','execute')
 and not has_function_privilege('anon','public.pilot_gm_overview(date,date)','execute')
 and not has_function_privilege('authenticated','public.pilot_payment_provider_event(jsonb)','execute')
 and has_function_privilege('service_role','public.pilot_payment_provider_event(jsonb)','execute')
 and not has_function_privilege('authenticated','public._pilot_price_items(jsonb)','execute'),'Grants: only the service role records provider events; anonymous callers reach nothing');
select pg_temp.ok(not has_table_privilege('authenticated','public.pilot_payments','select')
 and not has_table_privilege('authenticated','public.pilot_catalog_prices','select')
 and not has_table_privilege('service_role','public.pilot_payments','update'),'No direct table access');
select pg_temp.ok((select count(*) from public.pilot_catalog_prices where price_source<>'staging-placeholder')=0,'Every seeded price is a STAGING placeholder');
-- The basic workup tests (20261017160003) are priced like every other booking item, so a
-- hypertensive member's request is never shown as unpriced or as zero.
select pg_temp.ok((select count(*) from tid where k in('urine-acr','urinalysis','potassium','sodium','cbc-hb') and price>0)=5
 and (select count(*) from public.pilot_catalog_events e join tid on tid.id=e.test_id where tid.k in('urine-acr','urinalysis','potassium','sodium','cbc-hb') and e.kind='created')=5
 and (select bool_and(not t.included_in_package and t.active_from<=public._pilot_today()) from public.pilot_catalog_tests t where t.test_key in('urine-acr','urinalysis','potassium','sodium','cbc-hb')),'Basic workup tests are active, priced and audited');

set local role authenticated;
-- Reads: catalogue prices for any signed-in member; admin-only views refuse others.
select pg_temp.as_user(1);
select pg_temp.ok(jsonb_array_length(public.pilot_catalog_member()->'tests')=18,'Member sees the active catalogue');
select pg_temp.ok(pg_temp.refused('select public.pilot_catalog_admin()') and pg_temp.refused('select public.pilot_admin_payments()')
 and pg_temp.refused($q$select public.pilot_gm_overview(pg_temp.today()-30,pg_temp.today())$q$),'Member cannot read admin views');
insert into r values('member-cmd',pg_temp.cmd('90','{"action":"set-price","testId":"9c000000-0000-4000-8000-000000000000","priceAmd":1,"priceSource":"staging-placeholder","reason":"x"}'));
select pg_temp.as_user(2);
select pg_temp.ok(pg_temp.refused('select public.pilot_catalog_admin()') and pg_temp.refused($q$select public.pilot_gm_overview(pg_temp.today()-30,pg_temp.today())$q$),'Doctor cannot read admin views');
insert into r values('doctor-cmd',pg_temp.cmd('91','{"action":"create-payment","bookingKind":"test-request","bookingId":"9c000000-0000-4000-8000-000000000a01"}'));

-- Catalogue commands.
select pg_temp.as_user(3);
insert into r values('create-test',pg_temp.cmd('01','{"action":"create-test","testKey":"ferritin","partnerCode":"STG-FER-01","nameEn":"Ferritin","nameHy":"Ֆերիտին","includedInPackage":false,"activeFrom":"2026-10-01","activeUntil":null,"priceAmd":4000,"priceSource":"staging-placeholder","reason":"Synthetic test"}'));
insert into r values('create-replay',pg_temp.cmd('01','{"action":"create-test","testKey":"ferritin","partnerCode":"STG-FER-01","nameEn":"Ferritin","nameHy":"Ֆերիտին","includedInPackage":false,"activeFrom":"2026-10-01","activeUntil":null,"priceAmd":4000,"priceSource":"staging-placeholder","reason":"Synthetic test"}'));
insert into r values('create-changed',pg_temp.cmd('01','{"action":"create-test","testKey":"ferritin","partnerCode":"STG-FER-01","nameEn":"Ferritin","nameHy":"Ֆերիտին","includedInPackage":false,"activeFrom":"2026-10-01","activeUntil":null,"priceAmd":5000,"priceSource":"staging-placeholder","reason":"Synthetic test"}'));
insert into r values('create-dup',pg_temp.cmd('02','{"action":"create-test","testKey":"ferritin-2","partnerCode":"STG-FER-01","nameEn":"Ferritin","nameHy":"Ֆերիտին","includedInPackage":false,"activeFrom":"2026-10-01","activeUntil":null,"priceAmd":null,"priceSource":"staging-placeholder","reason":"Synthetic test"}'));
insert into r values('create-noreason',pg_temp.cmd('03','{"action":"create-test","testKey":"ferritin-3","partnerCode":"STG-FER-03","nameEn":"Ferritin","nameHy":"Ֆերիտին","includedInPackage":false,"activeFrom":"2026-10-01","activeUntil":null,"priceAmd":null,"priceSource":"staging-placeholder","reason":" "}'));
insert into r values('price-backdated',pg_temp.cmd('04',jsonb_build_object('action','set-price','testId',(select id from tid where k='lipid-panel'),'priceAmd',1,'priceSource','staging-placeholder','effectiveFrom',now()-interval '1 day','reason','Backdate')));
insert into r values('price-future',pg_temp.cmd('05',jsonb_build_object('action','set-price','testId',(select id from tid where k='hba1c'),'priceAmd',5500,'priceSource','partner-approved','effectiveFrom',now()+interval '7 days','reason','Scheduled')));
insert into r values('update-stale',pg_temp.cmd('06',jsonb_build_object('action','update-test','testId',(select id from tid where k='tsh'),'revision',9,'partnerCode','STG-TSH-01','nameEn','TSH','nameHy','TSH','includedInPackage',false,'activeFrom','2026-10-01','activeUntil',null,'reason','Stale')));
insert into r values('deactivate-tsh',pg_temp.cmd('07',jsonb_build_object('action','update-test','testId',(select id from tid where k='tsh'),'revision',1,'partnerCode','STG-TSH-01','nameEn','TSH','nameHy','TSH','includedInPackage',false,'activeFrom','2026-10-01','activeUntil','2026-10-02','reason','Not offered')));
reset role;
select pg_temp.ok((select result->>'status' from r where label='member-cmd')='access' and (select result->>'status' from r where label='doctor-cmd')='access','Only an admin sends commands');
select pg_temp.ok((select result->>'status' from r where label='create-test')='saved' and (select result->>'replayed' from r where label='create-replay')='true'
 and (select result->>'status' from r where label='create-changed')='invalid' and (select count(*) from public.pilot_catalog_tests where test_key='ferritin')=1
 and (select price_amd from public._pilot_current_price((select (result->>'testId')::uuid from r where label='create-test'),clock_timestamp()))=4000,'Create is replay safe and prices the new test');
select pg_temp.ok((select result->>'status' from r where label='create-dup')='conflict' and (select result->>'status' from r where label='create-noreason')='invalid','Duplicate code and missing reason are refused');
select pg_temp.ok((select result->>'status' from r where label='price-backdated')='invalid'
 and (select price_amd from public._pilot_current_price((select id from tid where k='lipid-panel'),now()))=(select price from tid where k='lipid-panel'),'A price cannot be backdated');
select pg_temp.ok((select result->>'status' from r where label='price-future')='saved'
 and (select price_amd from public._pilot_current_price((select id from tid where k='hba1c'),now()))=(select price from tid where k='hba1c')
 and (select price_amd from public._pilot_current_price((select id from tid where k='hba1c'),now()+interval '8 days'))=5500
 and (select count(*) from public.pilot_catalog_prices p join public.pilot_catalog_tests t on t.id=p.test_id where t.test_key='hba1c')=2,'A scheduled price keeps the current one until it starts, and history keeps both');
select pg_temp.ok((select result->>'status' from r where label='update-stale')='stale' and (select result->>'status' from r where label='deactivate-tsh')='saved'
 and (select count(*) from public.pilot_catalog_events e join public.pilot_catalog_tests t on t.id=e.test_id where t.test_key='tsh' and e.kind='updated')=1,'Edits check the revision and are audited');
do $$begin update public.pilot_catalog_prices set price_amd=1;raise exception 'TEST price history is immutable';exception when sqlstate '55000' then null;end$$;

set local role authenticated;
select pg_temp.as_user(3);
-- Payments.
insert into r values('pay-a',pg_temp.cmd('10','{"action":"create-payment","bookingKind":"test-request","bookingId":"9c000000-0000-4000-8000-000000000a01"}'));
insert into r values('pay-a-again',pg_temp.cmd('11','{"action":"create-payment","bookingKind":"test-request","bookingId":"9c000000-0000-4000-8000-000000000a01"}'));
insert into r values('pay-unpriced',pg_temp.cmd('12','{"action":"create-payment","bookingKind":"test-request","bookingId":"9c000000-0000-4000-8000-000000000a02"}'));
insert into r values('pay-cancelled',pg_temp.cmd('13','{"action":"create-payment","bookingKind":"test-request","bookingId":"9c000000-0000-4000-8000-000000000a03"}'));
-- TSH was deactivated above, so the appointment cannot be priced until it is active again.
insert into r values('pay-appt-inactive',pg_temp.cmd('14','{"action":"create-payment","bookingKind":"appointment","bookingId":"9c000000-0000-4000-8000-000000000b02"}'));
insert into r values('reactivate-tsh',pg_temp.cmd('15',jsonb_build_object('action','update-test','testId',(select id from tid where k='tsh'),'revision',2,'partnerCode','STG-TSH-01','nameEn','TSH','nameHy','TSH','includedInPackage',false,'activeFrom','2026-10-01','activeUntil',null,'reason','Offered again')));
insert into r values('pay-appt',pg_temp.cmd('16','{"action":"create-payment","bookingKind":"appointment","bookingId":"9c000000-0000-4000-8000-000000000b02"}'));
insert into r values('admin-list',public.pilot_admin_payments());
reset role;
select pg_temp.ok((select result->>'status' from r where label='pay-a')='saved' and (select result->>'status' from r where label='pay-a-again')='exists'
 and (select count(*) from public.pilot_payments where test_request_id='9c000000-0000-4000-8000-000000000a01')=1,'One payment record per booking');
select pg_temp.ok((select amount_amd from public.pilot_payments where test_request_id='9c000000-0000-4000-8000-000000000a01')=(select price from tid where k='lipid-panel')+(select price from tid where k='hba1c')
 and (select jsonb_array_length(lines) from public.pilot_payments where test_request_id='9c000000-0000-4000-8000-000000000a01')=3
 and (select price_basis from public.pilot_payments where test_request_id='9c000000-0000-4000-8000-000000000a01')='staging-placeholder'
 and (select l->>'chargedAmd' from public.pilot_payments y,jsonb_array_elements(y.lines)l where y.test_request_id='9c000000-0000-4000-8000-000000000a01' and l->>'testKey'='bp-visit')='0','Included tests are listed at no charge; the total adds the rest');
select pg_temp.ok((select result->>'status' from r where label='pay-unpriced')='unpriced' and (select result->'unpriced'->0->>'testKey' from r where label='pay-unpriced')='mystery-test'
 and not exists(select 1 from public.pilot_payments where test_request_id='9c000000-0000-4000-8000-000000000a02'),'An unpriced item is flagged, never priced as zero');
select pg_temp.ok((select result->>'status' from r where label='pay-cancelled')='booking-cancelled' and (select result->>'status' from r where label='pay-appt-inactive')='unpriced','Cancelled and inactive bookings are refused');
select pg_temp.ok((select result->>'status' from r where label='pay-appt')='saved' and (select amount_amd from public.pilot_payments where appointment_id='9c000000-0000-4000-8000-000000000b02')=(select price from tid where k='ecg-12-lead')+(select price from tid where k='tsh')
 and (select jsonb_array_length(lines) from public.pilot_payments where appointment_id='9c000000-0000-4000-8000-000000000b02')=2,'Appointment priced from its program; home tracking is not billed');
select pg_temp.ok((select x->'preview'->'unpriced'->0->>'testKey' from r,jsonb_array_elements(result->'bookings')x where label='admin-list' and x->>'bookingId'='9c000000-0000-4000-8000-000000000a02')='mystery-test'
 and (select x->'payment'->>'status' from r,jsonb_array_elements(result->'bookings')x where label='admin-list' and x->>'bookingId'='9c000000-0000-4000-8000-000000000a01')='pending','Admin list shows records and flags unpriced previews');
do $$begin update public.pilot_payments set amount_amd=1;raise exception 'TEST payment snapshot is fixed';exception when sqlstate '55000' then null;end$$;
do $$begin delete from public.pilot_payment_events;raise exception 'TEST payment history is immutable';exception when sqlstate '55000' then null;end$$;

set local role authenticated;
select pg_temp.as_user(3);
-- A later price change never alters the snapshot.
insert into r values('price-now',pg_temp.cmd('20',jsonb_build_object('action','set-price','testId',(select id from tid where k='lipid-panel'),'priceAmd',7000,'priceSource','partner-approved','effectiveFrom',null,'reason','New list')));
-- Status transitions.
insert into r values('paid-noref',pg_temp.cmd('21',jsonb_build_object('action','set-status','paymentId',(select (result->>'paymentId')::uuid from r where label='pay-a'),'revision',1,'status','paid','reason','Receipt seen','reference',null)));
insert into r values('paid',pg_temp.cmd('22',jsonb_build_object('action','set-status','paymentId',(select (result->>'paymentId')::uuid from r where label='pay-a'),'revision',1,'status','paid','reason','Receipt seen','reference','RCPT-1')));
insert into r values('paid-again',pg_temp.cmd('23',jsonb_build_object('action','set-status','paymentId',(select (result->>'paymentId')::uuid from r where label='pay-a'),'revision',2,'status','paid','reason','Receipt seen twice','reference','RCPT-1')));
insert into r values('paid-stale',pg_temp.cmd('24',jsonb_build_object('action','set-status','paymentId',(select (result->>'paymentId')::uuid from r where label='pay-a'),'revision',1,'status','refunded','reason','x','reference',null)));
insert into r values('paid-to-pending',pg_temp.cmd('25',jsonb_build_object('action','set-status','paymentId',(select (result->>'paymentId')::uuid from r where label='pay-a'),'revision',2,'status','pending','reason','x','reference',null)));
insert into r values('refund',pg_temp.cmd('26',jsonb_build_object('action','set-status','paymentId',(select (result->>'paymentId')::uuid from r where label='pay-a'),'revision',2,'status','refunded','reason','Visit cancelled','reference',null)));
-- Provider reference and events on the appointment payment.
insert into r values('reference',pg_temp.cmd('27',jsonb_build_object('action','set-reference','paymentId',(select (result->>'paymentId')::uuid from r where label='pay-appt'),'revision',1,'provider','fake','reference','FAKE-ABC-1','reason',null)));
reset role;
select pg_temp.ok((select amount_amd from public.pilot_payments where test_request_id='9c000000-0000-4000-8000-000000000a01')=(select price from tid where k='lipid-panel')+(select price from tid where k='hba1c')
 and (select price_amd from public._pilot_current_price((select id from tid where k='lipid-panel'),clock_timestamp()))=7000,'A paid snapshot keeps its price after the catalogue changes');
select pg_temp.ok((select result->>'status' from r where label='paid-noref')='invalid' and (select result->>'status' from r where label='paid')='saved'
 and (select result->>'status' from r where label='paid-again')='unchanged' and (select result->>'status' from r where label='paid-stale')='stale'
 and (select result->>'status' from r where label='paid-to-pending')='invalid' and (select result->>'status' from r where label='refund')='saved','Mark paid needs a reference; repeats and illegal moves change nothing');
select pg_temp.ok((select status from public.pilot_payments where test_request_id='9c000000-0000-4000-8000-000000000a01')='refunded'
 and (select count(*) from public.pilot_payment_events e join public.pilot_payments y on y.id=e.payment_id where y.test_request_id='9c000000-0000-4000-8000-000000000a01')=3
 and (select e.provider_reference from public.pilot_payment_events e join public.pilot_payments y on y.id=e.payment_id where y.test_request_id='9c000000-0000-4000-8000-000000000a01' and e.to_status='paid')='RCPT-1','Each transition is audited once with its reference');

set local role service_role;
insert into r values('prov-paid',public.pilot_payment_provider_event('{"provider":"fake","providerReference":"FAKE-ABC-1","eventId":"evt-1","status":"paid"}'));
insert into r values('prov-replay',public.pilot_payment_provider_event('{"provider":"fake","providerReference":"FAKE-ABC-1","eventId":"evt-1","status":"paid"}'));
insert into r values('prov-late-fail',public.pilot_payment_provider_event('{"provider":"fake","providerReference":"FAKE-ABC-1","eventId":"evt-2","status":"failed"}'));
insert into r values('prov-unknown',public.pilot_payment_provider_event('{"provider":"fake","providerReference":"FAKE-NONE","eventId":"evt-3","status":"paid"}'));
insert into r values('prov-card',public.pilot_payment_provider_event('{"provider":"fake","providerReference":"FAKE-ABC-1","eventId":"evt-4","status":"paid","cardNumber":"4111"}'));
reset role;
select pg_temp.ok((select result->>'status' from r where label='prov-paid')='saved' and (select result->>'status' from r where label='prov-replay')='replayed'
 and (select result->>'status' from r where label='prov-late-fail')='transition-refused' and (select result->>'status' from r where label='prov-unknown')='not-found'
 and (select result->>'status' from r where label='prov-card')='invalid'
 and (select status from public.pilot_payments where appointment_id='9c000000-0000-4000-8000-000000000b02')='paid'
 and (select count(*) from public.pilot_payment_events e join public.pilot_payments y on y.id=e.payment_id where y.appointment_id='9c000000-0000-4000-8000-000000000b02' and e.actor_kind='provider')=1,'Provider events are idempotent, cannot regress a payment and accept no extra fields');

set local role authenticated;
select pg_temp.as_user(1);
insert into r values('member-1',public.pilot_member_payments());
select pg_temp.as_user(4);
insert into r values('member-4',public.pilot_member_payments());
select pg_temp.as_user(3);
insert into r values('gm',public.pilot_gm_overview(pg_temp.today()-30,pg_temp.today()));
select pg_temp.ok(pg_temp.refused($q$select public.pilot_gm_overview(pg_temp.today(),pg_temp.today()-1)$q$) and pg_temp.refused($q$select public.pilot_gm_overview(pg_temp.today()-400,pg_temp.today())$q$),'Overview refuses a reversed or over-long range');
reset role;
select pg_temp.ok((select jsonb_array_length(result->'payments') from r where label='member-1')=1 and (select jsonb_array_length(result->'payments') from r where label='member-4')=1
 and (select result->'payments'->0->>'status' from r where label='member-4')='paid'
 and not (select result->'payments'->0 ? 'providerReference' from r where label='member-4')
 and not (select result->'payments'->0 ? 'events' from r where label='member-4'),'Members see only their own payments, without provider details');
select pg_temp.ok((select (result->'enrolled'->>'total')::int>=2 from r where label='gm') and (select (result->'booked'->>'members')::int>=2 from r where label='gm')
 and (select (result->'bp'->>'manualReadings')::int>=1 from r where label='gm') and (select (result->'payments'->>'paid')::int>=1 from r where label='gm')
 and (select (result->'unassignedMembers')::int>=1 from r where label='gm')
 and (select (d->>'assignedMembers')::int from r,jsonb_array_elements(result->'doctors')d where label='gm' and d->>'name'='Synthetic pricing doctor')=1
 and not (select result::text like '%9c000000-0000-4000-8000-000000000001%' from r where label='gm'),'Overview counts the fixtures without member identifiers');
rollback;
\echo 'pilot commerce checks passed'
