-- Fictional checks for the LDL re-test and response loop (phase 2); all fixtures roll back.
-- Off by default and inert while off (and while only the phase 1 switch is on); tables closed to browser roles; the
-- service functions refuse members and staff; the assigned doctor's re-test window is validated, one open per member,
-- superseded by a newer change and cancelled with a therapy entered in error; the sweep creates one home-visit
-- request in the admin queue (or fences it behind an open visit), never in quiet hours; an overdue re-test reaches
-- the admin once; a response is recorded once, only for a reviewed value after the change, closes the re-test,
-- reaches the doctor's Today and tells the member the result is with the doctor without showing it; the admin can
-- confirm the created request with the LDL engine and with nothing else.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean,label text) returns void language plpgsql as $$begin
 if cond is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.raises(statement text,code text default '42501') returns boolean language plpgsql as $$begin
 execute statement;return false;
exception when others then
 if sqlstate=code then return true;end if;
 raise notice 'unexpected % %',sqlstate,sqlerrm;return false;
end$$;
-- 1d2: doctor 02, other doctor 03, members 04 (ACS, the loop), 05 (has an open request: fenced), 06 (other doctor's), nurse 07, admin 08; clinic 10.
insert into auth.users(id)select ('1d200000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid from generate_series(2,8)n;
-- Members have a confirmed phone, as every real member (the booking path requires it); 04 and 05 have consent, 09 (doctor 02's,
-- created below) has none yet: not eligible for a request.
insert into auth.users(id)values('1d200000-0000-4000-8000-000000000009');
update auth.users set phone='3749900000'||right(id::text,2),phone_confirmed_at=now() where id in(select ('1d200000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid from generate_series(4,9)n where n in(4,5,6,9));
insert into public.patient_consents(user_id,version)select ('1d200000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'patient-pilot-v1' from generate_series(4,5)n;
insert into public.workspace_clinics(id,name)values('1d200000-0000-4000-8000-000000000010','Synthetic LDL loop clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('1d200000-0000-4000-8000-000000000002','doctor','Synthetic Doctor Two','1d200000-0000-4000-8000-000000000010'),
 ('1d200000-0000-4000-8000-000000000003','doctor','Synthetic Doctor Three','1d200000-0000-4000-8000-000000000010'),
 ('1d200000-0000-4000-8000-000000000007','nurse','Synthetic Nurse','1d200000-0000-4000-8000-000000000010'),
 ('1d200000-0000-4000-8000-000000000008','admin','Synthetic Admin','1d200000-0000-4000-8000-000000000010');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('1d200000-0000-4000-8000-000000000004','1d200000-0000-4000-8000-000000000002','1d200000-0000-4000-8000-000000000007'),
 ('1d200000-0000-4000-8000-000000000005','1d200000-0000-4000-8000-000000000002',null),
 ('1d200000-0000-4000-8000-000000000006','1d200000-0000-4000-8000-000000000003',null),
 ('1d200000-0000-4000-8000-000000000009','1d200000-0000-4000-8000-000000000002',null);
insert into auth.sessions(id,user_id,created_at,updated_at)select ('1d200000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid,('1d200000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,now()-interval '1 hour',now()
 from generate_series(2,8)n;
create function pg_temp.as_user(n int) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','1d200000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id','1d200000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::text,true)
$$;
create function pg_temp.as_service() returns void language sql as $$ select set_config('request.jwt.claims','{"role":"service_role"}',true) $$;
create function pg_temp.m(n int) returns uuid language sql immutable as $$ select ('1d200000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid $$;
create function pg_temp.s(n int) returns uuid language sql immutable as $$ select ('1d200000-0000-4000-8000-0000000009'||lpad(n::text,2,'0'))::uuid $$;
create function pg_temp.d(n int) returns text language sql stable as $$ select ((clock_timestamp()at time zone 'Asia/Yerevan')::date+n)::text $$;
-- Yerevan noon (or another hour) n days from today: the sweep's p_now.
create function pg_temp.at(n int,h int default 12) returns timestamptz language sql stable as $$ select (((clock_timestamp()at time zone 'Asia/Yerevan')::date+n)+make_time(h,0,0))at time zone 'Asia/Yerevan' $$;
create function pg_temp.retest(from_ int,to_ int,req int,rule text default 'acs') returns jsonb language sql stable as $$
 select jsonb_build_object('dueFrom',pg_temp.d(from_),'dueTo',pg_temp.d(to_),'requestOn',pg_temp.d(req),'rule',rule,'defaultsVersion','ldl-defaults-2026-10-29')
$$;
create function pg_temp.therapy(member int,sub int,started int,retest jsonb) returns text language sql as $$
 select public.doctor_ldl_therapy_add(jsonb_build_object('version','ldl-goal-v1','memberId',pg_temp.m(member),'submissionId',pg_temp.s(sub),
  'drug','atorvastatin','dose','80 mg once daily','startedOn',pg_temp.d(started),'maximallyTolerated',false,'retest',retest))->>'status'
$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.raises(text,text),pg_temp.as_user(int),pg_temp.as_service(),pg_temp.m(int),pg_temp.s(int),pg_temp.d(int),
 pg_temp.at(int,int),pg_temp.retest(int,int,int,text),pg_temp.therapy(int,int,int,jsonb) to authenticated,service_role;
update public.ldl_goal_settings set ldl_goal_enabled=true where singleton;

-- 1. Off by default (phase 1 on, the loop off): a re-test is refused, the service reads say off, nothing is created.
select pg_temp.ok((select ldl_response_enabled from public.ldl_goal_settings)=false,'loop off by default');
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(pg_temp.therapy(4,1,-2,pg_temp.retest(26,40,19))='disabled','re-test refused while the loop is off');
select pg_temp.ok(pg_temp.therapy(4,2,-2,null)='saved','a therapy without a re-test still saves');
select pg_temp.ok(public.doctor_ldl_read(pg_temp.m(4))->'loop'='null'::jsonb,'doctor read has no loop while off');
select pg_temp.ok(public.doctor_ldl_responses()->>'enabled'='false','doctor inbox section says off');
reset role;
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(public.ldl_response_candidates(50)->>'enabled'='false','candidates off');
select pg_temp.ok(public.ldl_response_run(pg_temp.at(0))->>'state'='off','run off');
reset role;
select pg_temp.ok(not exists(select 1 from public.ldl_retests)and not exists(select 1 from public.ldl_responses),'nothing stored while off');
update public.ldl_goal_settings set ldl_response_enabled=true where singleton;
update public.member_notice_settings set care=true where singleton;

-- 2. Access: tables closed; service functions refuse members and staff; only the assigned doctor reads and writes.
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(pg_temp.raises('select * from public.ldl_retests'),'member cannot read re-tests table');
select pg_temp.ok(pg_temp.raises('select * from public.ldl_responses'),'member cannot read responses table');
select pg_temp.ok(pg_temp.raises('select public.ldl_response_candidates(50)'),'member cannot read candidates');
select pg_temp.ok(pg_temp.raises($q$select public.ldl_response_record('{}'::jsonb)$q$),'member cannot record a response');
select pg_temp.ok(pg_temp.raises('select public.ldl_response_run(null)'),'member cannot run the sweep');
select pg_temp.ok(pg_temp.raises('select public.doctor_ldl_responses()'),'member cannot read the doctor section');
select pg_temp.ok(pg_temp.raises('select public.admin_ldl_retests()'),'member cannot read the admin list');
select pg_temp.ok(pg_temp.raises($q$select public._ldl_medicine_facts(pg_temp.m(4),28)$q$),'member cannot read medicine facts');
select pg_temp.ok(pg_temp.raises($q$select pg_temp.therapy(4,3,-2,pg_temp.retest(26,40,19))$q$),'member cannot book their own re-test');
reset role;
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(pg_temp.raises('select public.ldl_response_candidates(50)'),'doctor cannot read candidates');
select pg_temp.ok(pg_temp.raises('select public.admin_ldl_retests()'),'doctor cannot read the admin list');
reset role;
select pg_temp.as_user(3);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select pg_temp.therapy(4,4,-2,pg_temp.retest(26,40,19))$q$),'another doctor cannot book a re-test');
reset role;
select pg_temp.as_user(7);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select pg_temp.therapy(4,5,-2,pg_temp.retest(26,40,19))$q$),'the nurse cannot book a re-test');
select pg_temp.ok(pg_temp.raises('select public.doctor_ldl_responses()'),'the nurse cannot read the doctor section');
select pg_temp.ok(pg_temp.raises('select public.admin_ldl_retests()'),'the nurse cannot read the admin list');
reset role;

-- 3. The window: validated, one open per member, superseded by a newer change, replayed by its submission.
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(pg_temp.therapy(4,10,-2,pg_temp.retest(-2,40,19))='invalid','window must start after the change');
select pg_temp.ok(pg_temp.therapy(4,11,-2,pg_temp.retest(30,26,19))='invalid','window must not end before it starts');
select pg_temp.ok(pg_temp.therapy(4,12,-2,pg_temp.retest(26,90,19))='invalid','window at most 8 weeks wide');
select pg_temp.ok(pg_temp.therapy(4,13,-2,pg_temp.retest(26,40,-1))='invalid','request day not in the past');
select pg_temp.ok(pg_temp.therapy(4,14,-2,pg_temp.retest(26,40,19,'stroke'))='invalid','rule is acs or other');
select pg_temp.ok(public.doctor_ldl_therapy_add(jsonb_build_object('version','ldl-goal-v1','memberId',pg_temp.m(4),'submissionId',pg_temp.s(15),
 'drug','atorvastatin','dose','80 mg','startedOn',pg_temp.d(-2),'maximallyTolerated',false,'retest',pg_temp.retest(26,40,19)||'{"extra":1}'))->>'status'='invalid','re-test keys are strict');
select pg_temp.ok(pg_temp.therapy(4,16,-2,pg_temp.retest(26,40,19))='saved','first re-test saved');
select pg_temp.ok(pg_temp.therapy(4,16,-2,pg_temp.retest(26,40,19))='replayed','same submission replays');
reset role;
select pg_temp.ok((select count(*) from public.ldl_retests where member_id=pg_temp.m(4))=1,'one re-test row after a replay');
select pg_temp.ok((select state='scheduled'and anchor_on=public._ldl_today()-2 and rule='acs' from public.ldl_retests where member_id=pg_temp.m(4)),'re-test scheduled, anchored on the start date');
select pg_temp.as_user(2);
set local role authenticated;
-- A newer change (dose up) the next day: the first is superseded.
select pg_temp.ok(pg_temp.therapy(4,17,-1,pg_temp.retest(27,41,20))='saved','second change saved');
select pg_temp.ok(jsonb_array_length(public.doctor_ldl_read(pg_temp.m(4))#>'{loop,retests}')=1,'doctor read hides superseded re-tests');
reset role;
select pg_temp.ok((select array_agg(state order by created_at)from public.ldl_retests where member_id=pg_temp.m(4))=array['superseded','scheduled'],'older re-test superseded');
select pg_temp.ok(pg_temp.raises($q$update public.ldl_retests set due_to=due_to+1 where member_id=pg_temp.m(4)and state='scheduled'$q$,'55000'),'window is immutable');
select pg_temp.ok(pg_temp.raises($q$delete from public.ldl_retests where member_id=pg_temp.m(4)$q$,'55000'),'re-tests are not deleted');
-- A therapy entered in error cancels its re-test.
create temp table ids as select (select therapy_id from public.ldl_retests where member_id=pg_temp.m(4)and state='scheduled')err_therapy,null::uuid fenced,null::uuid response;
grant select on ids to authenticated;
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(public.doctor_ldl_therapy_end(pg_temp.m(4),(select err_therapy from ids),'entered_in_error',null)->>'status'='saved','therapy entered in error');
reset role;
select pg_temp.ok(not exists(select 1 from public.ldl_retests where member_id=pg_temp.m(4)and state in('scheduled','requested','fenced')),'its re-test is cancelled');
select pg_temp.as_user(2);
set local role authenticated;
-- The real change: 30 days ago, so the window is already open (request day today).
select pg_temp.ok(pg_temp.therapy(4,18,-30,pg_temp.retest(-2,12,0))='saved','re-test for a change 30 days ago');
select pg_temp.ok(pg_temp.therapy(5,19,-30,pg_temp.retest(-2,12,0))='saved','member 05 re-test');
select pg_temp.ok(pg_temp.therapy(9,20,-30,pg_temp.retest(-2,12,0))='saved','member 09 re-test');
reset role;

-- 4. The sweep: nothing in quiet hours; then one home-visit request with the LDL requirement, or fenced behind an open request.
insert into public.patient_test_requests(id,user_id,requested_terms,requirements,algorithm_version,context_token,create_payload)values
 ('1d200000-0000-4000-8000-000000000055',pg_temp.m(5),'{"timezone":"Asia/Yerevan","mode":"home","location":"Synthetic home","startsAt":"2030-01-01T09:00:00Z"}',
  '[{"id":"x","title":"Synthetic test","method":"lab"}]','synthetic','v2:synthetic','{}');
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(public.ldl_response_run(pg_temp.at(0,3))->>'state'='quiet_hours','quiet hours: nothing opens');
reset role;
select pg_temp.ok(not exists(select 1 from public.ldl_retests where state<>'scheduled'and state not in('superseded','cancelled')),'still scheduled after quiet hours');
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok((public.ldl_response_run(pg_temp.at(0))->>'opened')::int=1,'one request opened');
select pg_temp.ok(public.ldl_response_run(pg_temp.at(0))->>'opened'='0','a second run opens nothing');
reset role;
select pg_temp.ok((select state='requested'and request_id is not null from public.ldl_retests where member_id=pg_temp.m(4)and state<>'cancelled'and state<>'superseded'),'member 04 requested');
select pg_temp.ok((select state='fenced'and fence_reason='open_visit'and request_id is null from public.ldl_retests where member_id=pg_temp.m(5)),'member 05 fenced behind the open request');
select pg_temp.ok((select state='fenced'and fence_reason='not_eligible'and request_id is null from public.ldl_retests where member_id=pg_temp.m(9)),'member 09 fenced: no consent yet');
select pg_temp.ok(not exists(select 1 from public.patient_test_requests where user_id=pg_temp.m(9)),'no request for a member who is not eligible');
select pg_temp.ok((select count(*)from public.patient_test_requests where user_id=pg_temp.m(5))=1,'no second request for member 05');
select pg_temp.ok((select q.status='requested'and q.algorithm_version='ldl-retest-v1'and q.requested_terms->>'mode'='home'and q.requirements=jsonb_build_array(public._ldl_retest_requirement())
  and q.context_token like 'v2:%'and public.valid_patient_test_terms(q.requested_terms||jsonb_build_object('endsAt',q.requested_terms->>'endsAt'))
  and(q.requested_terms->>'startsAt')::timestamptz>now()
 from public.patient_test_requests q join public.ldl_retests r on r.request_id=q.id where r.member_id=pg_temp.m(4)),'request: home, LDL requirement, future morning, valid terms');
select pg_temp.ok(exists(select 1 from public.patient_test_request_events e join public.ldl_retests r on r.request_id=e.request_id where r.member_id=pg_temp.m(4)
 and e.operation='create'and e.actor_id=pg_temp.m(2)),'request event records the doctor');
select pg_temp.ok(exists(select 1 from public.member_notices n join public.ldl_retests r on n.event_key='ldl.retest_due:'||r.id::text where r.member_id=pg_temp.m(4)),'member 04 notice decided');
select pg_temp.ok((select count(*)from public.member_notices n where n.event_key like 'ldl.retest_due:%')=3,'one notice decision per re-test (fenced too)');
-- The admin sees both fences and acknowledges 05's before the window ends (LDLR-03 starts here).
update ids set fenced=(select id from public.ldl_retests where member_id=pg_temp.m(5));
select pg_temp.as_user(8);
set local role authenticated;
select pg_temp.ok((select count(*)from jsonb_array_elements(public.admin_ldl_retests()->'items')x where x->>'kind'='fenced')=2,'admin sees the two fences');
select pg_temp.ok(public.admin_ldl_retest_ack((select fenced from ids),'Asked the lab to add a lipid panel')->>'status'='saved','admin acknowledges the fence');
select pg_temp.ok(jsonb_array_length(public.admin_ldl_retests()->'items')=1,'acknowledged fence leaves the list');
reset role;
-- LDLR-02: the questionnaire is completed after the request was created: the token moves, the sweep keeps the LDL request current.
insert into public.patient_assessments(user_id)values(pg_temp.m(4));
select pg_temp.ok((select public.patient_test_request_dto(q)->>'contextStale'='true'from public.patient_test_requests q join public.ldl_retests r on r.request_id=q.id where r.member_id=pg_temp.m(4)),'questionnaire change makes the token stale');
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(public.ldl_response_run(pg_temp.at(0))->>'state'='ran','sweep runs');
reset role;
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok((select r->>'dueTo'=pg_temp.d(12)and r->>'overdue'='false'and r->'id'is not null and not r?'rule'from(select public.member_ldl_read()->'retest' r)x),'member sees the window, not the rule');
reset role;
-- The admin queue's DTO: not stale again (the requirements token is the member's current one).
select pg_temp.ok((select public.patient_test_request_dto(q)->>'contextStale'='false'from public.patient_test_requests q join public.ldl_retests r on r.request_id=q.id where r.member_id=pg_temp.m(4)),'request is current in the admin queue');

-- 5. Booking risk path: an admin confirms the created request with the LDL engine; the screening engine or a wrong one is refused.
create temp table req as select q.* from public.patient_test_requests q join public.ldl_retests r on r.request_id=q.id where r.member_id=pg_temp.m(4);
create function pg_temp.confirm(engine jsonb,cmd uuid) returns text language plpgsql as $$
declare q record;
begin
 select * into q from req;
 perform public.command_patient_test_request(q.user_id,pg_temp.m(8),true,q.id,(select revision from public.patient_test_requests where id=q.id),cmd,'confirm',
  jsonb_build_object('provider','Synthetic nurse service','terms',jsonb_build_object('startsAt',(now()+interval '3 days')::text,'endsAt',(now()+interval '3 days 1 hour')::text,
   'timezone','Asia/Yerevan','mode','home','location','Synthetic home address'),'obtainedAt',now()::text,'channel','phone','source','Synthetic call',
   'preparation','No fasting needed for a lipid panel.','replacesExisting',false,'engine',engine));
 return 'ok';
exception when serialization_failure then return 'refused';
end$$;
select pg_temp.ok(pg_temp.confirm(jsonb_build_object('sourceToken',public.patient_test_context(pg_temp.m(4))->>'token','version','2026.10','tests',jsonb_build_array(public._ldl_retest_requirement())),gen_random_uuid())='refused','screening engine version refused');
select pg_temp.ok(pg_temp.confirm(jsonb_build_object('sourceToken',public.patient_test_context(pg_temp.m(4))->>'token','version','ldl-retest-v1','tests',jsonb_build_array(jsonb_build_object('id','x','title','y','method','lab'))),gen_random_uuid())='refused','other requirement refused');
select pg_temp.ok(pg_temp.confirm(jsonb_build_object('sourceToken','stale','version','ldl-retest-v1','tests',jsonb_build_array(public._ldl_retest_requirement())),gen_random_uuid())='refused','stale source refused');
select pg_temp.ok(pg_temp.confirm(jsonb_build_object('sourceToken',public.patient_test_context(pg_temp.m(4))->>'token','version','ldl-retest-v1','tests',jsonb_build_array(public._ldl_retest_requirement())),gen_random_uuid())='ok','LDL engine confirms');
select pg_temp.ok((select status='provider-proposed'from public.patient_test_requests where id=(select id from req)),'request now waits for the member');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public._nurse_visit_items('home-request',(select id from req)))i where i->>'kind'='sample'and i->>'testId'='ldl-retest-lipid-panel'),'the nurse visit lists the lipid panel sample');
-- LDLR-02: the member sees the proposal on the goal card and accepts it, with a questionnaire that is not complete.
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok((select x->>'status'='provider-proposed'and x#>>'{proposal,provider}'='Synthetic nurse service'and x->>'algorithmVersion'='ldl-retest-v1'
 from(select public.member_ldl_read()#>'{retest,request}'x)y),'member card has the proposal');
reset role;
select pg_temp.ok((select completed_at is null from public.patient_assessments where user_id=pg_temp.m(4)),'questionnaire not complete');
select pg_temp.ok((public.command_patient_test_request(pg_temp.m(4),pg_temp.m(4),false,(select id from req),(select revision from public.patient_test_requests where id=(select id from req)),gen_random_uuid(),'accept',
 jsonb_build_object('engine',jsonb_build_object('sourceToken',public.patient_test_context(pg_temp.m(4))->>'token','version','ldl-retest-v1','tests',jsonb_build_array(public._ldl_retest_requirement())))))->>'status'='confirmed','member accepts with the LDL engine');
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok((public.member_ldl_read()#>>'{retest,request,status}')='confirmed'and(public.member_ldl_read()#>'{retest,request,arrangement,startsAt}')is not null,'member card shows the confirmed visit');
reset role;

-- 6. Overdue: the day after the window, once each; an acknowledged fence does not hide the overdue item (LDLR-03).
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok((public.ldl_response_run(pg_temp.at(13))->>'overdue')::int=3,'three re-tests overdue');
select pg_temp.ok(public.ldl_response_run(pg_temp.at(13))->>'overdue'='0','overdue once');
reset role;
select pg_temp.ok((select count(*)from public.member_notices where event_key like 'ldl.retest_overdue:%')=3,'overdue notices decided once each');
select pg_temp.as_user(8);
set local role authenticated;
select pg_temp.ok((select count(*)from jsonb_array_elements(public.admin_ldl_retests()->'items')x where x->>'kind'='overdue')=3,'admin sees all three overdue, 05 too');
select pg_temp.ok(public.admin_ldl_retest_ack((select fenced from ids),'Called again')->>'status'='saved','admin acknowledges the overdue item');
select pg_temp.ok(public.admin_ldl_retest_ack((select fenced from ids),'again')->>'status'='not-found','nothing left to acknowledge');
select pg_temp.ok(jsonb_array_length(public.admin_ldl_retests()->'items')=2,'acknowledged item leaves the list');
reset role;
select pg_temp.ok((select state='fenced'from public.ldl_retests where member_id=pg_temp.m(5)),'acknowledging does not close the re-test');
select pg_temp.ok(pg_temp.raises($q$update public.ldl_retests set admin_ack_at=null,admin_ack_by=null where member_id=pg_temp.m(5)$q$,'55000'),'an acknowledgement is not undone');
-- LDLR-01: the fences clear (05's other request is cancelled, 09 gives consent): the next sweep creates both requests.
update public.patient_test_requests set status='cancelled' where id='1d200000-0000-4000-8000-000000000055';
insert into public.patient_consents(user_id,version)values(pg_temp.m(9),'patient-pilot-v1');
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok((public.ldl_response_run(pg_temp.at(14))->>'opened')::int=2,'cleared fences open their requests');
reset role;
select pg_temp.ok((select bool_and(state='requested'and fence_reason is null and request_id is not null)from public.ldl_retests where member_id in(pg_temp.m(5),pg_temp.m(9))),'05 and 09 requested');

-- 7. The response: only a reviewed value after the change; once; closes the re-test; the doctor sees it; the member does not see the value.
insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,publication_plan_id)values
 (pg_temp.m(4),'LDL cholesterol',2.1,'mmol/L',now()-interval '40 days',now()-interval '39 days','laboratory','Synthetic lab',now(),'Synthetic Doctor Two',null),
 (pg_temp.m(4),'LDL cholesterol',1.9,'mmol/L',now()-interval '2 days',now(),'laboratory','Synthetic lab',now(),'Synthetic Doctor Two',null),
 -- A reviewed value the check cannot use (unknown unit), newer than the valid one (LDLR-04).
 (pg_temp.m(4),'LDL cholesterol',7,'xyz',now()-interval '1 day',now(),'laboratory','Synthetic lab',now(),'Synthetic Doctor Two',null),
 (pg_temp.m(4),'LDL cholesterol',1.5,'mmol/L',now()-interval '2 hours',now(),'laboratory','Synthetic lab',null,null,null),
 (pg_temp.m(4),'ALT',31,'U/L',now()-interval '1 hour',now(),'laboratory','Synthetic lab',now(),'Synthetic Doctor Two',null);
create temp table k as select (select 'cr:'||id from public.patient_care_results where user_id=pg_temp.m(4)and value=1.9)new_key,
 (select 'cr:'||id from public.patient_care_results where user_id=pg_temp.m(4)and value=2.1)old_key,
 (select 'cr:'||id from public.patient_care_results where user_id=pg_temp.m(4)and value=1.5)unreviewed_key,
 (select 'cr:'||id from public.patient_care_results where user_id=pg_temp.m(4)and unit='xyz')unusable_key,
 (select 'cr:'||id from public.patient_care_results where user_id=pg_temp.m(4)and marker='ALT')alt_key;
grant select on k to service_role;
create function pg_temp.record(key text,on_ text,status text default 'above_goal') returns text language sql as $$
 select public.ldl_response_record(jsonb_build_object('version','ldl-response-v1','memberId',pg_temp.m(4),'observationKey',key,'observedOn',on_,'status',status,
  'facts',jsonb_build_object('version','ldl-response-facts-v1')))->>'status'
$$;
grant execute on function pg_temp.record(text,text,text) to service_role;
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok((select jsonb_array_length(x->'observations')=3 and x->'alt'->0->>'name'='ALT'and x->>'retestId'is not null
 from jsonb_array_elements(public.ldl_response_candidates(50)->'members')x where x->>'memberId'=pg_temp.m(4)::text),'candidate: reviewed values only, ALT, open re-test');
select pg_temp.ok(pg_temp.record((select unreviewed_key from k),pg_temp.d(0))='invalid','an unreviewed result is refused');
select pg_temp.ok(pg_temp.record((select old_key from k),pg_temp.d(-40))='invalid','a value before the change is refused');
select pg_temp.ok(pg_temp.record((select new_key from k),pg_temp.d(-1))='invalid','a wrong date is refused');
select pg_temp.ok(pg_temp.record((select alt_key from k),pg_temp.d(0))='invalid','a value that is not LDL is refused');
select pg_temp.ok(pg_temp.record((select new_key from k),pg_temp.d(-2),'maybe')='invalid','a status outside the three is refused');
select pg_temp.ok(pg_temp.record((select new_key from k),pg_temp.d(-2))='saved','response saved');
select pg_temp.ok(pg_temp.record((select new_key from k),pg_temp.d(-2))='replayed','response replays');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.ldl_response_candidates(50)->'members')x where x->>'memberId'=pg_temp.m(4)::text),'the newer unusable value keeps the member a candidate');
select pg_temp.ok(public.ldl_response_skip(pg_temp.m(5),array[(select unusable_key from k)])=0,'a key of another member is not skipped');
select pg_temp.ok(public.ldl_response_skip(pg_temp.m(4),array[(select unusable_key from k)])=1,'unusable value skipped');
select pg_temp.ok(public.ldl_response_skip(pg_temp.m(4),array[(select unusable_key from k)])=0,'skipped once');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.ldl_response_candidates(50)->'members')x where x->>'memberId'=pg_temp.m(4)::text),'no longer a candidate');
select pg_temp.ok((public.ldl_response_run(pg_temp.at(0))->>'responses')::int=1,'member told once');
reset role;
select pg_temp.ok((select r.state='done'and r.response_id=x.id from public.ldl_retests r join public.ldl_responses x on x.retest_id=r.id where r.member_id=pg_temp.m(4)),'the re-test is done');
select pg_temp.ok(exists(select 1 from public.member_notices n join public.ldl_responses x on n.event_key='ldl.result_with_doctor:'||x.id::text),'result notice decided');
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok((select public.member_ldl_read()#>>'{withDoctor,doctorName}')='Synthetic Doctor Two','member: with Dr Two');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.member_ldl_read()->'observations')o where o->>'value'in('1.9','7')),'member does not see the unreleased values');
select pg_temp.ok(public.member_ldl_read()->'retest'='null'::jsonb,'no open re-test for the member');
reset role;
update ids set response=(select id from public.ldl_responses where member_id=pg_temp.m(4));
select pg_temp.as_user(3);
set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.doctor_ldl_responses()->'items')=0,'another doctor sees nothing');
select pg_temp.ok(pg_temp.raises($q$select public.doctor_ldl_response_close((select response from ids),null)$q$),'another doctor cannot close it');
reset role;
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok((select x->>'status'='above_goal'and x->>'memberName'is not null from jsonb_array_elements(public.doctor_ldl_responses()->'items')x),'doctor sees the item');
select pg_temp.ok(public.doctor_ldl_response_close((select (x->>'id')::uuid from jsonb_array_elements(public.doctor_ldl_responses()->'items')x),'Adding ezetimibe, told the member')->>'status'='saved','doctor closes it');
select pg_temp.ok(jsonb_array_length(public.doctor_ldl_responses()->'items')=0,'item leaves Today');
reset role;
select pg_temp.ok(exists(select 1 from public.access_audit where surface='doctor_inbox'and object_id='ldl_responses'and member_id=pg_temp.m(4)),'doctor read recorded in access_audit');
select pg_temp.ok(pg_temp.raises($q$update public.ldl_responses set status='at_goal'$q$,'55000'),'a response never changes');
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(public.member_ldl_read()->'withDoctor'='null'::jsonb,'member: no longer with the doctor');
reset role;

-- 8. Test gap 4: the doctor changes the goal between the check's read and its record. The old assessment is refused, and
-- the next read works from the new goal. Member 11: a change 30 days ago, then goal 1.
insert into auth.users(id)values(pg_temp.m(11));
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values(pg_temp.m(11),pg_temp.m(2));
create function pg_temp.goal(member int,sub int,expected int,threshold numeric) returns text language sql as $$
 select public.doctor_ldl_goal_set(jsonb_build_object('version','ldl-goal-v1','memberId',pg_temp.m(member),'submissionId',pg_temp.s(sub),'expectedVersion',expected,
  'category','very_high','thresholdMmol',threshold,'reductionRule',false,'baselineKind','unknown','defaultsVersion','ldl-defaults-2026-10-29')
  ||case when expected>0 then jsonb_build_object('reason','Synthetic change of goal')else '{}'::jsonb end)->>'status'
$$;
create function pg_temp.record_for(member int,key text,on_ text,goal_version int,status text default 'at_goal') returns text language sql as $$
 select public.ldl_response_record(jsonb_build_object('version','ldl-response-v1','memberId',pg_temp.m(member),'observationKey',key,'observedOn',on_,'status',status,
  'facts',jsonb_build_object('version','ldl-response-facts-v1','goal',case when goal_version is not null then jsonb_build_object('version',goal_version)end)))->>'status'
$$;
create function pg_temp.candidate(member int) returns jsonb language sql stable as $$
 select x from jsonb_array_elements(public.ldl_response_candidates(50)->'members')x where x->>'memberId'=pg_temp.m(member)::text
$$;
grant execute on function pg_temp.goal(int,int,int,numeric),pg_temp.record_for(int,text,text,int,text),pg_temp.candidate(int) to authenticated,service_role;
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(pg_temp.therapy(11,40,-30,pg_temp.retest(-2,12,0))='saved','member 11 re-test');
select pg_temp.ok(pg_temp.goal(11,41,0,1.8)='saved','member 11 goal 1');
reset role;
insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,publication_plan_id)values
 (pg_temp.m(11),'LDL cholesterol',1.6,'mmol/L',now()-interval '2 days',now(),'laboratory','Synthetic lab',now(),'Synthetic Doctor Two',null);
create temp table k2 as select (select 'cr:'||id from public.patient_care_results where user_id=pg_temp.m(11)and value=1.6)low,null::text high,null::text lower_;
grant select,update on k2 to service_role;
select pg_temp.as_service();
set local role service_role;
create temp table read_before as select pg_temp.candidate(11) c;
select pg_temp.ok((select c#>>'{goal,version}'='1' from read_before),'the check reads goal 1');
reset role;
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(pg_temp.goal(11,42,1,1.4)='saved','the doctor sets goal 2 after the read');
reset role;
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(pg_temp.record_for(11,(select low from k2),pg_temp.d(-2),1)='stale','an assessment against goal 1 is refused');
select pg_temp.ok(pg_temp.record_for(11,(select low from k2),pg_temp.d(-2),null)='stale','so is one made with no goal');
reset role;
select pg_temp.ok(not exists(select 1 from public.ldl_responses where member_id=pg_temp.m(11)),'nothing stored for the old goal');
select pg_temp.ok((select state from public.ldl_retests where member_id=pg_temp.m(11))<>'done','the re-test stays open');
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(pg_temp.candidate(11)#>>'{goal,version}'='2','the next read has goal 2');
select pg_temp.ok(pg_temp.record_for(11,(select low from k2),pg_temp.d(-2),2,'above_goal')='saved','the fresh assessment is saved');
select pg_temp.ok(pg_temp.record_for(11,(select low from k2),pg_temp.d(-2),1)='replayed','a stored response replays, whatever the goal');
select pg_temp.ok(pg_temp.candidate(11) is null,'and the member is no longer a candidate');
reset role;

-- 9. Test gap 5: a second reviewed value from the day that already has a response. It reaches the check, whatever it is;
-- lib/ldl/response.ts responds to a higher one and skips the rest (scripts/check-ldl-response.ts). Older days stay closed.
insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,publication_plan_id)values
 (pg_temp.m(11),'LDL cholesterol',2.4,'mmol/L',now()-interval '2 days',now(),'laboratory','Synthetic lab',now(),'Synthetic Doctor Two',null);
update k2 set high=(select 'cr:'||id from public.patient_care_results where user_id=pg_temp.m(11)and value=2.4);
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(pg_temp.candidate(11) is not null,'a newly reviewed value from the answered day is actionable');
select pg_temp.ok(pg_temp.record_for(11,(select high from k2),pg_temp.d(-2),2,'above_goal')='saved','it gets its own response');
select pg_temp.ok(pg_temp.candidate(11) is null,'then the member is not a candidate');
reset role;
select pg_temp.ok((select count(*) from public.ldl_responses where member_id=pg_temp.m(11)and observed_on=pg_temp.d(-2)::date)=2,'both responses stand, same day');
-- Not reviewed: never. An older day: never. A value after the response: as before.
insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,publication_plan_id)values
 (pg_temp.m(11),'LDL cholesterol',3.3,'mmol/L',now()-interval '2 days',now(),'laboratory','Synthetic lab',null,null,null),
 (pg_temp.m(11),'LDL cholesterol',3.0,'mmol/L',now()-interval '3 days',now(),'laboratory','Synthetic lab',now(),'Synthetic Doctor Two',null);
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(pg_temp.candidate(11) is null,'an unreviewed value or an older day does not make a candidate');
reset role;
-- A lower one on the answered day comes back once; the app's skip takes it out of the list.
insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,publication_plan_id)values
 (pg_temp.m(11),'LDL cholesterol',1.2,'mmol/L',now()-interval '2 days',now(),'laboratory','Synthetic lab',now(),'Synthetic Doctor Two',null);
update k2 set lower_=(select 'cr:'||id from public.patient_care_results where user_id=pg_temp.m(11)and value=1.2);
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(pg_temp.candidate(11) is not null,'a lower value from that day reaches the check');
select pg_temp.ok(public.ldl_response_skip(pg_temp.m(11),array[(select lower_ from k2)])=1,'and is skipped');
select pg_temp.ok(pg_temp.candidate(11) is null,'so it does not hold the member in the list');
reset role;
rollback;
