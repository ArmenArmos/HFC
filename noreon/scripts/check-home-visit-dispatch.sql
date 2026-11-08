-- Home visits: nurse dispatch notice and auto-close on the recorded visit. Fictional data; rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.hv_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.hv_id(n text) returns uuid language sql immutable as $$select('c9b00000-0000-4000-8000-0000000000'||n)::uuid$$;
-- c9b0: member 01 and 02, nurse 05 (Telegram bound), nurse 06 (not bound), nurse 07 (bound).
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.hv_id(n),case when n in('01','02')then '3749909'||n||'00'end,case when n in('01','02')then now()end from unnest(array['01','02','05','06','07'])n;
update public.profiles set display_name='Fictional Ruzanna '||right(id::text,2) where id in(pg_temp.hv_id('01'),pg_temp.hv_id('02'));
insert into public.workspace_clinics(id,name,address)values(pg_temp.hv_id('99'),'Fictional nurse service','1 Fictional Street');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.hv_id('05'),'nurse','Fictional nurse five',pg_temp.hv_id('99')),(pg_temp.hv_id('06'),'nurse','Fictional nurse six',pg_temp.hv_id('99')),(pg_temp.hv_id('07'),'nurse','Fictional nurse seven',pg_temp.hv_id('99'));
insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation)values
 (pg_temp.hv_id('05'),'staff','fictional-staff-05','fictional-account-05','+37499090500','5550905',1),(pg_temp.hv_id('07'),'staff','fictional-staff-07','fictional-account-07','+37499090700','5550907',1);
insert into public.patient_clinical_cases(user_id,assigned_nurse_id)values(pg_temp.hv_id('01'),pg_temp.hv_id('05')),(pg_temp.hv_id('02'),null);
create function pg_temp.terms(mode text,starts timestamptz) returns jsonb language sql as $$
 select jsonb_build_object('provider','Fictional nurse service','terms',jsonb_build_object('startsAt',starts,'endsAt',starts+interval '1 hour','timezone','Asia/Yerevan','mode',mode,'location','1 Fictional Home Street'),
  'obtainedAt',now(),'channel','phone','source','Fictional','preparation','Fictional','replacesExisting',false,'recordedBy','Fictional','recordedAt',now())
$$;
-- Requests as the provider flow leaves them before the member accepts.
set local session_replication_role=replica;
insert into public.patient_test_requests(id,user_id,revision,status,requested_terms,requirements,algorithm_version,context_token,create_payload,proposal)
select pg_temp.hv_id(x.id),pg_temp.hv_id(x.m),1,'provider-proposed','{}','[]','v','t','{}',pg_temp.terms(x.mode,now()+x.d)
from(values('11','01','home',interval '2 days'),('12','01','clinic',interval '2 days'),('13','02','home',interval '2 days'),('14','01','home',interval '-1 day'))x(id,m,mode,d);
set local session_replication_role=origin;
create function pg_temp.confirm(n text) returns void language sql as $$
 update public.patient_test_requests set status='confirmed',revision=revision+1,current_arrangement=proposal,proposal=null where id=pg_temp.hv_id(n)
$$;

-- 1. Off by default: confirming queues nothing.
select pg_temp.confirm('11');
select pg_temp.hv_assert(not exists(select 1 from public.home_visit_dispatches where request_id=pg_temp.hv_id('11')),'Switched off: no notice');
update public.patient_test_requests set status='provider-proposed',revision=revision+1,proposal=current_arrangement,current_arrangement=null where id=pg_temp.hv_id('11');

-- 2. On: a confirmed home visit notifies the assigned nurse through the staff binding, with no member details.
update public.home_visit_settings set telegram_notice=true;
select pg_temp.confirm('11');
select pg_temp.hv_assert((select outcome='queued'and nurse_id=pg_temp.hv_id('05')and telegram_message_id is not null from public.home_visit_dispatches where request_id=pg_temp.hv_id('11')),'Assigned nurse notified');
select pg_temp.hv_assert((select m.template_id='home_visit.nurse_assigned'and m.address='5550905'and m.body not like '%Ruzanna%'and m.body not like '%Fictional Home%'
 from public.telegram_auth_messages m join public.home_visit_dispatches d on d.telegram_message_id=m.id where d.request_id=pg_temp.hv_id('11')),'Outbox message to the nurse, no member name or address');
-- The same revision is never notified twice.
update public.patient_test_requests set updated_at=now() where id=pg_temp.hv_id('11');
select pg_temp.hv_assert((select count(*)=1 from public.home_visit_dispatches where request_id=pg_temp.hv_id('11')),'Once per revision and nurse');
-- Clinic visits and past visits are not dispatched.
select pg_temp.confirm('12');select pg_temp.confirm('14');
select pg_temp.hv_assert(not exists(select 1 from public.home_visit_dispatches where request_id in(pg_temp.hv_id('12'),pg_temp.hv_id('14'))),'Only future home visits');
-- No nurse assigned: recorded as skipped.
select pg_temp.confirm('13');
select pg_temp.hv_assert((select outcome='skipped'and reason='no_nurse_assigned'from public.home_visit_dispatches where request_id=pg_temp.hv_id('13')),'No nurse: skipped with reason');
-- Assigning a nurse without Telegram, then one with: skipped, then queued.
update public.patient_clinical_cases set assigned_nurse_id=pg_temp.hv_id('06') where user_id=pg_temp.hv_id('02');
select pg_temp.hv_assert((select reason='no_staff_binding'from public.home_visit_dispatches where request_id=pg_temp.hv_id('13')and nurse_id=pg_temp.hv_id('06')),'Nurse without Telegram: skipped');
update public.patient_clinical_cases set assigned_nurse_id=pg_temp.hv_id('07') where user_id=pg_temp.hv_id('02');
select pg_temp.hv_assert((select outcome='queued'from public.home_visit_dispatches where request_id=pg_temp.hv_id('13')and nurse_id=pg_temp.hv_id('07')),'Reassigned nurse notified');

-- 3. Auto-close: off by default; then the recorded visit completes the confirmed home request.
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id)values(pg_temp.hv_id('21'),pg_temp.hv_id('01'),pg_temp.hv_id('05'),'Fictional nurse five','nurse',pg_temp.hv_id('99'));
select pg_temp.hv_assert((select status='confirmed'from public.patient_test_requests where id=pg_temp.hv_id('14')),'Switched off: stays confirmed');
update public.home_visit_settings set auto_close=true;
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id)values(pg_temp.hv_id('22'),pg_temp.hv_id('01'),pg_temp.hv_id('05'),'Fictional nurse five','nurse',pg_temp.hv_id('99'));
select pg_temp.hv_assert((select status='completed'from public.patient_test_requests where id=pg_temp.hv_id('14')),'Visit on or after the arranged day completes the request');
select pg_temp.hv_assert((select status='confirmed'from public.patient_test_requests where id=pg_temp.hv_id('11')),'A visit before the arranged day leaves a future request open');
select pg_temp.hv_assert((select status='confirmed'from public.patient_test_requests where id=pg_temp.hv_id('12')),'Clinic requests are not closed');
select pg_temp.hv_assert(exists(select 1 from public.patient_test_request_events where request_id=pg_temp.hv_id('14')and operation='completed-by-visit'and payload->>'visitId'=pg_temp.hv_id('22')::text),'Closure is journaled with the visit');
select pg_temp.hv_assert(not exists(select 1 from public.home_visit_dispatches where request_id=pg_temp.hv_id('14')),'Completion sends no notice');

-- 4. Fences: a completed request takes no commands and no longer blocks slot booking.
do $$begin
 perform public.command_patient_test_request(pg_temp.hv_id('01'),pg_temp.hv_id('01'),false,pg_temp.hv_id('14'),2,gen_random_uuid(),'cancel','{}');
 raise exception 'TEST completed request accepted a command';
exception when others then if sqlerrm not like '%completed%' then raise;end if;end$$;
-- HV-1: a retried command (its event already recorded) is not refused as completed.
insert into public.patient_test_request_events(request_id,command_id,actor_id,revision,operation,payload,result)values(pg_temp.hv_id('14'),pg_temp.hv_id('31'),pg_temp.hv_id('01'),2,'cancel','{}','{"replayed":true}');
do $$begin
 perform public.command_patient_test_request(pg_temp.hv_id('01'),pg_temp.hv_id('01'),false,pg_temp.hv_id('14'),1,pg_temp.hv_id('31'),'cancel','{}');
exception when others then if sqlerrm like '%This visit is completed%' then raise exception 'TEST replay refused as completed';end if;end$$;
select pg_temp.hv_assert(pg_get_functiondef('public.select_booking_appointment(uuid,uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,uuid,text,text,text,text)'::regprocedure)
 like '%status not in(''cancelled'',''completed'')%','Slot booking ignores completed requests');
select pg_temp.hv_assert(has_table_privilege('authenticated','public.home_visit_dispatches','select') is false and has_table_privilege('anon','public.home_visit_settings','select') is false,'No client access to the new tables');
rollback;
\echo 'home visit dispatch: all checks passed'
