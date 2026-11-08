-- Evidence paths for required clinic and home tests (20261031123000). Fictional fixtures, rolled back.
-- Who may record and confirm, what counts for each test, the gate for every other non-lab test, a stale confirmation,
-- the abnormal rule, and nothing reaching the member. Nothing here tests a clinical value: the doctor attests.
\set ON_ERROR_STOP on
begin;
create function pg_temp.as_user(p_id uuid)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',p_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','session_id',p_id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);end$$;
create function pg_temp.must_fail(command text,expected text)returns void language plpgsql as $$begin begin execute command;exception when others then if sqlerrm like '%'||expected||'%'then return;end if;raise;end;raise exception 'TEST command unexpectedly passed: %',command;end$$;
create function pg_temp.ok(cond boolean,label text)returns void language plpgsql as $$begin if cond is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.u(n int)returns uuid language sql immutable as $$select('ec900000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid$$;
grant execute on all functions in schema pg_temp to authenticated,service_role,anon;

-- Member 01; doctors 04 (assigned), 05; nurse 06; clinic 10.
insert into auth.users(id,phone,phone_confirmed_at)values(pg_temp.u(1),'37499000971',now()),(pg_temp.u(4),null,null),(pg_temp.u(5),null,null),(pg_temp.u(6),null,null);
update public.profiles set display_name='Evidence fixture',birth_date='1970-01-01',biological_sex='male'where id=pg_temp.u(1);
insert into public.patient_consents(user_id,version)values(pg_temp.u(1),'patient-pilot-v1');
insert into public.patient_assessments(user_id,revision,completed_at)values(pg_temp.u(1),2,now()-interval '10 days');
insert into public.workspace_clinics(id,name)values(pg_temp.u(10),'Synthetic evidence clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.u(4),'doctor','Assigned doctor',pg_temp.u(10)),(pg_temp.u(5),'doctor','Other doctor',pg_temp.u(10)),(pg_temp.u(6),'nurse','Nurse Ani',pg_temp.u(10));
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.u(1),pg_temp.u(4),pg_temp.u(6));
insert into auth.sessions(id,user_id,created_at,updated_at)select user_id,user_id,clock_timestamp(),clock_timestamp()from public.workspace_staff where user_id in(pg_temp.u(4),pg_temp.u(5),pg_temp.u(6));

-- Measurements: 21 member's own, 22 staff note, 23 staff note before the questionnaire, 24 nurse visit, 25 and 26 in the finished week, 27 staff note dated tomorrow.
set local session_replication_role=replica;
insert into public.patient_measurements(id,user_id,submission_id,systolic,diastolic,pulse,measured_at)values
 (pg_temp.u(21),pg_temp.u(1),gen_random_uuid(),150,95,70,now()-interval '1 day'),(pg_temp.u(22),pg_temp.u(1),gen_random_uuid(),148,92,72,now()-interval '2 days'),
 (pg_temp.u(23),pg_temp.u(1),gen_random_uuid(),146,91,71,now()-interval '12 days'),(pg_temp.u(24),pg_temp.u(1),gen_random_uuid(),144,90,null,now()-interval '3 days'),
 (pg_temp.u(25),pg_temp.u(1),gen_random_uuid(),142,88,66,now()-interval '8 days'),(pg_temp.u(26),pg_temp.u(1),gen_random_uuid(),140,86,67,now()-interval '7 days'),
 (pg_temp.u(27),pg_temp.u(1),gen_random_uuid(),147,91,70,now()+interval '1 day');
insert into public.staff_care_notes(patient_case_id,actor_id,actor_name,actor_role,kind,note,detail)values
 (pg_temp.u(1),pg_temp.u(6),'Nurse Ani','nurse','measurement','Blood pressure measurement recorded',jsonb_build_object('measurementId',pg_temp.u(22))),
 (pg_temp.u(1),pg_temp.u(6),'Nurse Ani','nurse','measurement','Blood pressure measurement recorded',jsonb_build_object('measurementId',pg_temp.u(23))),
 (pg_temp.u(1),pg_temp.u(6),'Nurse Ani','nurse','measurement','Blood pressure measurement recorded',jsonb_build_object('measurementId',pg_temp.u(27)));
-- Visits: 31 has weight and waist after the questionnaire and BP reading 24; 32 waist only; 33 both, before the questionnaire; 34 past weight and tomorrow's waist; 35 both tomorrow.
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id)values
 (pg_temp.u(31),pg_temp.u(1),pg_temp.u(6),'Nurse Ani','nurse',pg_temp.u(10)),(pg_temp.u(32),pg_temp.u(1),pg_temp.u(6),'Nurse Ani','nurse',pg_temp.u(10)),(pg_temp.u(33),pg_temp.u(1),pg_temp.u(6),'Nurse Ani','nurse',pg_temp.u(10)),
 (pg_temp.u(34),pg_temp.u(1),pg_temp.u(6),'Nurse Ani','nurse',pg_temp.u(10)),(pg_temp.u(35),pg_temp.u(1),pg_temp.u(6),'Nurse Ani','nurse',pg_temp.u(10));
insert into public.patient_care_visit_entries(user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id,measurement_id)
 select pg_temp.u(1),pg_temp.u(v),gen_random_uuid(),p,jsonb_build_object('kind','observation','field',f,'observedAt',to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'state','known','value',val,'unit',unit),
  to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),t,pg_temp.u(6),'Nurse Ani','nurse',pg_temp.u(10),m
 from(values(31,1,'weight',82,'kg',now()-interval '3 days',null::uuid),(31,2,'waist',103,'cm',now()-interval '3 days',null),(31,3,'systolic',144,'mmHg',now()-interval '3 days',pg_temp.u(24)),
  (32,1,'waist',103,'cm',now()-interval '2 days',null),(33,1,'weight',82,'kg',now()-interval '12 days',null),(33,2,'waist',103,'cm',now()-interval '12 days',null),
  (34,1,'weight',82,'kg',now()-interval '1 day',null),(34,2,'waist',103,'cm',now()+interval '1 day',null),(35,1,'weight',82,'kg',now()+interval '1 day',null),(35,2,'waist',103,'cm',now()+interval '1 day',null))x(v,p,f,val,unit,t,m);
-- Weeks: 41 finished after the questionnaire; 42 stopped; 43 still running; 44 finished before the questionnaire.
insert into public.bp_weeks(id,member_id,starts_on,started_by,started_by_role,stopped_at,stopped_by)values
 (pg_temp.u(41),pg_temp.u(1),current_date-9,pg_temp.u(6),'nurse',null,null),(pg_temp.u(42),pg_temp.u(1),current_date-9,pg_temp.u(6),'nurse',now(),pg_temp.u(6)),
 (pg_temp.u(43),pg_temp.u(1),current_date-2,pg_temp.u(6),'nurse',null,null),(pg_temp.u(44),pg_temp.u(1),current_date-20,pg_temp.u(6),'nurse',null,null);
insert into public.bp_week_readings(measurement_id,week_id,member_id,day,slot)values(pg_temp.u(25),pg_temp.u(41),pg_temp.u(1),1,'morning'),(pg_temp.u(26),pg_temp.u(41),pg_temp.u(1),2,'evening');
set local session_replication_role=origin;

create temp table ctx as select pg_temp.u(1)uid,pg_temp.u(4)actor,public.patient_clinical_evidence(pg_temp.u(1))->>'token'token,
 '{"version":"test-engine","urgency":"yellow","tests":[{"id":"ecg-12-lead","title":"12-lead ECG","method":"clinic"},{"id":"holter","title":"Holter","method":"clinic"},{"id":"echocardiogram","title":"Echo","method":"clinic"},{"id":"bp-visit","title":"Repeated BP","method":"clinic"},{"id":"anthropometry","title":"Weight and waist","method":"clinic"},{"id":"bp-home-log","title":"Home log","method":"home-log"}]}'::jsonb engine,
 '{"explanation":"Synthetic clinician review","instructions":"Synthetic instructions","followUp":"","medicationName":"","medicationDose":"","medicationInstructions":"","medicationTimes":[]}'::jsonb draft;
grant select on ctx to authenticated,service_role;
create function pg_temp.rev()returns bigint language sql stable security definer as $$select revision from public.patient_clinical_cases where user_id=pg_temp.u(1)$$;
create function pg_temp.cmd(op text,input jsonb)returns text language sql stable as $$select format('select public.command_patient_clinical_review(%L,%s,%L,%L,%L)',uid,pg_temp.rev(),token,op,input)from ctx$$;
create function pg_temp.pub(id uuid default gen_random_uuid())returns text language sql stable as $$select format('select public.publish_patient_clinical_plan(%L,%L,%s,%L,%L,%L)',uid,actor,pg_temp.rev(),token,engine,id)from ctx$$;
create function pg_temp.ecg(extra jsonb default '{}')returns jsonb language sql as $$select jsonb_build_object('testId','ecg-12-lead','performedOn',current_date,'result','normal','finding','','source','Synthetic clinic, read by Dr Other','sourceChecked',true)||extra$$;
create function pg_temp.pick(test text,source uuid)returns jsonb language sql as $$select jsonb_build_object('testId',test,'sourceId',source,'sourceChecked',true)$$;
grant execute on all functions in schema pg_temp to authenticated,service_role;
grant select on public.patient_clinical_cases to service_role;

select pg_temp.as_user(pg_temp.u(4));
set local role service_role;
select public.prepare_patient_clinical_review(uid,actor,0,token,engine)from ctx;
reset role;

-- Roles: only the assigned doctor records, confirms or reads.
select pg_temp.as_user(pg_temp.u(6));set local role authenticated;
select pg_temp.must_fail(pg_temp.cmd('record-investigation',pg_temp.ecg()),'doctor');
select pg_temp.must_fail(format('select public.doctor_required_evidence_sources(%L)',pg_temp.u(1)),'Assigned active doctor required');
reset role;select pg_temp.as_user(pg_temp.u(5));set local role authenticated;
select pg_temp.must_fail(pg_temp.cmd('record-investigation',pg_temp.ecg()),'');
select pg_temp.must_fail(format('select public.doctor_required_evidence_sources(%L)',pg_temp.u(1)),'Assigned active doctor required');
reset role;select pg_temp.as_user(pg_temp.u(1));set local role authenticated;
select pg_temp.must_fail(pg_temp.cmd('receive-evidence',pg_temp.pick('bp-visit',pg_temp.u(21))),'');
select pg_temp.must_fail('select * from public.patient_investigation_records','permission denied');
select pg_temp.must_fail(format('insert into public.patient_investigation_records(user_id,test_id,performed_on,result,source,recorded_by,recorded_by_name)values(%L,''ecg-12-lead'',current_date,''normal'',''self-made'',%L,''x'')',pg_temp.u(1),pg_temp.u(1)),'permission denied');
reset role;
select pg_temp.ok(not has_function_privilege('anon','public.doctor_required_evidence_sources(uuid)','execute')and not has_function_privilege('authenticated','public._required_evidence_sources(uuid,text)','execute'),'helpers are private');

select pg_temp.as_user(pg_temp.u(4));set local role authenticated;
-- What is on offer: only eligible sources.
create temp table seen as select public.doctor_required_evidence_sources(pg_temp.u(1))v;
select pg_temp.ok((select jsonb_array_length(v#>'{sources,bp-home-log}')=1 and v#>>'{sources,bp-home-log,0,id}'=pg_temp.u(41)::text and jsonb_array_length(v#>'{sources,bp-home-log,0,readings}')=2 from seen),'only the finished week after the questionnaire is offered');
select pg_temp.ok((select jsonb_agg(x->>'id'order by x->>'id')=jsonb_build_array(pg_temp.u(22),pg_temp.u(24))from seen,jsonb_array_elements(v#>'{sources,bp-visit}')x),'only staff readings after the questionnaire are offered');
select pg_temp.ok((select jsonb_array_length(v#>'{sources,anthropometry}')=1 and v#>>'{sources,anthropometry,0,id}'=pg_temp.u(31)::text and jsonb_array_length(v#>'{sources,anthropometry,0,observations}')=2 from seen),'only a visit with weight and waist after the questionnaire is offered');
-- Refusals.
select pg_temp.must_fail(pg_temp.cmd('record-investigation',pg_temp.ecg('{"sourceChecked":false}')),'Check the original source');
select pg_temp.must_fail(pg_temp.cmd('record-investigation',pg_temp.ecg('{"testId":"tsh"}')),'supported native evidence pathway');
select pg_temp.must_fail(pg_temp.cmd('record-investigation',pg_temp.ecg('{"testId":"bp-visit"}')),'supported native evidence pathway');
select pg_temp.must_fail(pg_temp.cmd('record-investigation',pg_temp.ecg(jsonb_build_object('performedOn',current_date+2))),'does not count');
select pg_temp.must_fail(pg_temp.cmd('record-investigation',pg_temp.ecg(jsonb_build_object('performedOn',current_date-30))),'does not count');
select pg_temp.must_fail(pg_temp.cmd('record-investigation',pg_temp.ecg('{"result":"abnormal"}')),'Describe the finding');
select pg_temp.must_fail(pg_temp.cmd('record-investigation',pg_temp.ecg('{"result":"unreadable"}')),'Enter the date');
select pg_temp.must_fail(pg_temp.cmd('record-investigation',pg_temp.ecg('{"source":"x"}')),'Enter the date');
select pg_temp.must_fail(pg_temp.cmd('receive-evidence',pg_temp.pick('bp-visit',pg_temp.u(21))),'does not count');
select pg_temp.must_fail(pg_temp.cmd('receive-evidence',pg_temp.pick('bp-visit',pg_temp.u(25))),'does not count');
select pg_temp.must_fail(pg_temp.cmd('receive-evidence',pg_temp.pick('bp-visit',pg_temp.u(23))),'does not count');
select pg_temp.must_fail(pg_temp.cmd('receive-evidence',pg_temp.pick('bp-home-log',pg_temp.u(42))),'does not count');
select pg_temp.must_fail(pg_temp.cmd('receive-evidence',pg_temp.pick('bp-home-log',pg_temp.u(43))),'does not count');
select pg_temp.must_fail(pg_temp.cmd('receive-evidence',pg_temp.pick('bp-home-log',pg_temp.u(44))),'does not count');
select pg_temp.must_fail(pg_temp.cmd('receive-evidence',pg_temp.pick('anthropometry',pg_temp.u(32))),'does not count');
select pg_temp.must_fail(pg_temp.cmd('receive-evidence',pg_temp.pick('anthropometry',pg_temp.u(33))),'does not count');
select pg_temp.must_fail(pg_temp.cmd('receive-evidence',pg_temp.pick('anthropometry',pg_temp.u(34))),'does not count');
select pg_temp.must_fail(pg_temp.cmd('receive-evidence',pg_temp.pick('anthropometry',pg_temp.u(35))),'does not count');
select pg_temp.must_fail(pg_temp.cmd('receive-evidence',pg_temp.pick('bp-visit',pg_temp.u(27))),'does not count');
reset role;
select pg_temp.ok(not exists(select 1 from public.patient_investigation_records where user_id=pg_temp.u(1)),'a refused record leaves no row');
select pg_temp.ok((select review->'evidenceReceipts' is null from public.patient_clinical_cases where user_id=pg_temp.u(1)),'nothing confirmed yet');

-- Publication before any confirmation.
select pg_temp.as_user(pg_temp.u(4));set local role authenticated;
select public.save_patient_clinical_draft(uid,pg_temp.rev(),token,draft)from ctx;
reset role;set local role service_role;
select pg_temp.must_fail(pg_temp.pub(),'Confirm every required clinic or home test');
reset role;

-- Confirm all six.
select pg_temp.as_user(pg_temp.u(4));set local role authenticated;
do $$begin execute pg_temp.cmd('record-investigation',pg_temp.ecg());end$$;
do $$begin execute pg_temp.cmd('record-investigation',pg_temp.ecg('{"testId":"echocardiogram"}'));end$$;
do $$begin execute pg_temp.cmd('record-investigation',pg_temp.ecg('{"testId":"holter","result":"abnormal","finding":"Synthetic pauses"}'));end$$;
do $$begin execute pg_temp.cmd('receive-evidence',pg_temp.pick('bp-home-log',pg_temp.u(41)));end$$;
do $$begin execute pg_temp.cmd('receive-evidence',pg_temp.pick('bp-visit',pg_temp.u(22)));end$$;
do $$begin execute pg_temp.cmd('receive-evidence',pg_temp.pick('anthropometry',pg_temp.u(31)));end$$;
do $$begin execute format('select public.save_patient_clinical_draft(%L,%s,%L,%L)',pg_temp.u(1),pg_temp.rev(),(select token from ctx),(select draft from ctx));end$$;
reset role;
select pg_temp.ok((select count(*)=3 and bool_and(recorded_by=pg_temp.u(4)and recorded_by_name='Assigned doctor')from public.patient_investigation_records where user_id=pg_temp.u(1)),'records name the doctor');
select pg_temp.ok((select count(*)=6 from public.patient_clinical_case_events where user_id=pg_temp.u(1)and kind='result-received'and detail ?'testId'),'each confirmation is an event');
select pg_temp.must_fail(format('update public.patient_investigation_records set result=''normal'' where user_id=%L',pg_temp.u(1)),'immutable');
select pg_temp.must_fail(format('delete from public.patient_investigation_records where user_id=%L',pg_temp.u(1)),'immutable');

-- The abnormal default: a consultation completed for this evidence comes first.
set local role service_role;
select pg_temp.must_fail(pg_temp.pub(),'An abnormal investigation needs a completed consultation');
reset role;
select pg_temp.as_user(pg_temp.u(4));set local role authenticated;
do $$begin execute pg_temp.cmd('consultation-decision','{"decision":"not-required","note":"Synthetic"}');end$$;
do $$begin execute format('select public.save_patient_clinical_draft(%L,%s,%L,%L)',pg_temp.u(1),pg_temp.rev(),(select token from ctx),(select draft from ctx));end$$;
reset role;set local role service_role;
select pg_temp.must_fail(pg_temp.pub(),'An abnormal investigation needs a completed consultation');
reset role;
select pg_temp.as_user(pg_temp.u(4));set local role authenticated;
do $$begin execute pg_temp.cmd('consultation-decision','{"decision":"required","note":"Synthetic"}');end$$;
do $$begin execute pg_temp.cmd('complete-consultation',jsonb_build_object('completedAt',now(),'mode','phone','note','Synthetic'));end$$;
do $$begin execute format('select public.save_patient_clinical_draft(%L,%s,%L,%L)',pg_temp.u(1),pg_temp.rev(),(select token from ctx),(select draft from ctx));end$$;
reset role;

-- Stale: the week's reading goes away after it was confirmed.
savepoint stale_week;
set local session_replication_role=replica;
delete from public.bp_week_readings where measurement_id=pg_temp.u(26);
set local session_replication_role=origin;
set local role service_role;
select pg_temp.must_fail(pg_temp.pub(),'Required source receipt is stale');
reset role;
rollback to stale_week;

-- The gate: any other non-lab test still refuses, whatever is confirmed.
savepoint gate;
set local session_replication_role=replica;
update ctx set engine=jsonb_set(engine,'{tests}',engine->'tests'||'[{"id":"home-spirometry","title":"Unsupported","method":"clinic"}]');
update public.patient_clinical_cases c set review=jsonb_set(review,'{engine}',ctx.engine)from ctx where c.user_id=ctx.uid;
update public.patient_clinical_cases c set draft_review_token=md5(c.review::text)where user_id=(select uid from ctx);
set local session_replication_role=origin;
set local role service_role;
select pg_temp.must_fail(pg_temp.pub(),'no supported native receipt pathway');
reset role;
rollback to gate;

-- Replaying this migration after main must preserve regimen approval and every medicine order.
savepoint regimen;
update public.multi_medicine_capabilities set enabled=true;
select pg_temp.as_user(pg_temp.u(4));set local role authenticated;
select public.save_patient_clinical_draft(uid,pg_temp.rev(),token,draft||'{"medicines":[{"name":"Fictional A","dose":"1 mg","instructions":"","times":["09:00"]},{"name":"Fictional B","dose":"2 mg","instructions":"","times":["21:00"]}]}'::jsonb)from ctx;
reset role;set local role service_role;
select pg_temp.must_fail(pg_temp.pub(),'Approve the current regimen before publishing');
reset role;
do $$declare h text;p uuid;begin
 set local role authenticated;
 h:=public.doctor_regimen_review(pg_temp.u(1))#>>'{draft,approvalHash}';
 set local role service_role;
 select public.publish_patient_clinical_regimen(uid,actor,pg_temp.rev(),token,engine,gen_random_uuid(),'',h)into p from ctx;
 reset role;
 perform pg_temp.ok((select count(*)=2 from public.patient_care_plan_medications where plan_id=p),'confirmed evidence and approved regimen publish both medicines');
end$$;
rollback to regimen;

-- Published: the confirmations stay in the immutable publication, and the member gets nothing new.
select pg_temp.as_user(pg_temp.u(4));
do $$begin set local role service_role;execute pg_temp.pub('ec900000-0000-4000-8000-0000000000a1');reset role;end$$;
select pg_temp.ok((select review->'receipts'='{}'from public.patient_clinical_publications where request_id='ec900000-0000-4000-8000-0000000000a1'),'nothing in the part the member can read');
select pg_temp.ok(not exists(select 1 from public.patient_care_tests where user_id=pg_temp.u(1))and not exists(select 1 from public.patient_care_results where user_id=pg_temp.u(1)),'nothing copied to the member''s results');
select pg_temp.ok((select count(*)=6 from public.patient_clinical_publications p,jsonb_object_keys(p.review->'evidenceReceipts')k where p.request_id='ec900000-0000-4000-8000-0000000000a1'),'all six confirmations are in the publication');
select pg_temp.as_user(pg_temp.u(1));set local role authenticated;
create temp table member_view as select public.patient_published_clinical_reviews()::text v;
reset role;
select pg_temp.ok((select v not like '%Synthetic pauses%'and v not like '%evidenceReceipts%'and v like '%Synthetic clinician review%'from member_view),'the member''s own read has the plan and none of the evidence');
select pg_temp.ok((select count(*)=1 from public.patient_care_plans where user_id=pg_temp.u(1)and active),'the plan is published');
rollback;
