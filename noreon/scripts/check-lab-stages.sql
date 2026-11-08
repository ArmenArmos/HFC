-- Fictional lab-stage lifecycle; all fixtures roll back.
-- Stage order, role and assignment scope, replay, member privacy and
-- immutability each have a persisted-value assertion below.
\set ON_ERROR_STOP on
begin;
create function pg_temp.lab_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'TEST %',label;end if;
end$$;
-- b8 fixture namespace: member 01, doctor 02, nurse 03, other nurse 04, admin 05, other member 06, clinic 07.
insert into auth.users(id,phone,phone_confirmed_at) values
 ('b8000000-0000-4000-8000-000000000001','374000880001',now()),
 ('b8000000-0000-4000-8000-000000000002',null,null),('b8000000-0000-4000-8000-000000000003',null,null),
 ('b8000000-0000-4000-8000-000000000004',null,null),('b8000000-0000-4000-8000-000000000005',null,null),
 ('b8000000-0000-4000-8000-000000000006','374000880006',now());
insert into public.workspace_clinics(id,name) values('b8000000-0000-4000-8000-000000000007','Synthetic lab clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id) values
 ('b8000000-0000-4000-8000-000000000002','doctor','Synthetic lab doctor','b8000000-0000-4000-8000-000000000007'),
 ('b8000000-0000-4000-8000-000000000003','nurse','Synthetic lab nurse','b8000000-0000-4000-8000-000000000007'),
 ('b8000000-0000-4000-8000-000000000004','nurse','Synthetic unassigned nurse','b8000000-0000-4000-8000-000000000007'),
 ('b8000000-0000-4000-8000-000000000005','admin','Synthetic lab admin',null);
insert into auth.sessions(id,user_id,created_at,updated_at) select ('b8000000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid,('b8000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,now(),now() from generate_series(1,6)n;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('b8000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000002','b8000000-0000-4000-8000-000000000003');
-- Visit facts are inserted as owner: the visit command itself has its own check.
insert into public.patient_care_visit_command_receipts(user_id,submission_id,actor_id,session_id,command,state,result)values
 ('b8000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000020','b8000000-0000-4000-8000-000000000003','b8000000-0000-4000-8000-000000000103','{}','committed','{}');
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id)values
 ('b8000000-0000-4000-8000-000000000021','b8000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000003','Synthetic lab nurse','nurse','b8000000-0000-4000-8000-000000000007');
insert into public.patient_care_visit_entries(id,user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id)values
 ('b8000000-0000-4000-8000-000000000031','b8000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000021','b8000000-0000-4000-8000-000000000020',1,
  '{"kind":"collection","observedAt":"2026-10-16T08:00:00+04:00","appointmentId":"b8000000-0000-4000-8000-000000000040","acceptedRevision":1,"testId":"cbc","outcome":"collected"}','2026-10-16T08:00:00+04:00','2026-10-16T04:00:00Z',
  'b8000000-0000-4000-8000-000000000003','Synthetic lab nurse','nurse','b8000000-0000-4000-8000-000000000007'),
 ('b8000000-0000-4000-8000-000000000032','b8000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000021','b8000000-0000-4000-8000-000000000020',2,
  '{"kind":"collection","observedAt":"2026-10-16T08:00:00+04:00","appointmentId":"b8000000-0000-4000-8000-000000000040","acceptedRevision":1,"testId":"tsh","outcome":"not-collected","reason":"Synthetic reason"}','2026-10-16T08:00:00+04:00','2026-10-16T04:00:00Z',
  'b8000000-0000-4000-8000-000000000003','Synthetic lab nurse','nurse','b8000000-0000-4000-8000-000000000007');
-- Later outcomes are the current fact: lipids collected then corrected to not collected;
-- hba1c recorded collected twice (only the later entry is the sample).
insert into public.patient_care_visit_entries(id,user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id,recorded_at)values
 ('b8000000-0000-4000-8000-000000000033','b8000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000021','b8000000-0000-4000-8000-000000000020',3,
  '{"kind":"collection","observedAt":"2026-10-16T08:00:00+04:00","appointmentId":"b8000000-0000-4000-8000-000000000040","acceptedRevision":1,"testId":"lipids","outcome":"collected"}','2026-10-16T08:00:00+04:00','2026-10-16T04:00:00Z',
  'b8000000-0000-4000-8000-000000000003','Synthetic lab nurse','nurse','b8000000-0000-4000-8000-000000000007',now()-interval '4 minutes'),
 ('b8000000-0000-4000-8000-000000000034','b8000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000021','b8000000-0000-4000-8000-000000000020',4,
  '{"kind":"collection","observedAt":"2026-10-16T08:00:00+04:00","appointmentId":"b8000000-0000-4000-8000-000000000040","acceptedRevision":1,"testId":"lipids","outcome":"not-collected","reason":"Synthetic correction"}','2026-10-16T08:00:00+04:00','2026-10-16T04:00:00Z',
  'b8000000-0000-4000-8000-000000000003','Synthetic lab nurse','nurse','b8000000-0000-4000-8000-000000000007',now()-interval '3 minutes'),
 ('b8000000-0000-4000-8000-000000000035','b8000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000021','b8000000-0000-4000-8000-000000000020',5,
  '{"kind":"collection","observedAt":"2026-10-16T08:00:00+04:00","appointmentId":"b8000000-0000-4000-8000-000000000040","acceptedRevision":1,"testId":"hba1c","outcome":"collected"}','2026-10-16T08:00:00+04:00','2026-10-16T04:00:00Z',
  'b8000000-0000-4000-8000-000000000003','Synthetic lab nurse','nurse','b8000000-0000-4000-8000-000000000007',now()-interval '2 minutes'),
 ('b8000000-0000-4000-8000-000000000036','b8000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000021','b8000000-0000-4000-8000-000000000020',6,
  '{"kind":"collection","observedAt":"2026-10-16T08:00:00+04:00","appointmentId":"b8000000-0000-4000-8000-000000000040","acceptedRevision":1,"testId":"hba1c","outcome":"collected"}','2026-10-16T08:00:00+04:00','2026-10-16T04:00:00Z',
  'b8000000-0000-4000-8000-000000000003','Synthetic lab nurse','nurse','b8000000-0000-4000-8000-000000000007',now()-interval '1 minute');

create function pg_temp.as_user(n int) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','b8000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id','b8000000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::text,true)
$$;
create function pg_temp.cmd(sub text,entry text,stage text,at text) returns jsonb language sql as $$
 select jsonb_build_object('version','lab-stage-v1','id','b8000000-0000-4000-8000-000000000001','submissionId','b8000000-0000-4000-8000-0000000005'||sub,'entryId','b8000000-0000-4000-8000-0000000000'||entry,'stage',stage,'occurredAt',at)
$$;
create temp table lab_results(label text primary key,result jsonb);
grant all on lab_results to authenticated;
grant execute on function pg_temp.as_user(int),pg_temp.cmd(text,text,text,text) to authenticated;

select pg_temp.lab_assert(not has_function_privilege('anon','public.patient_staff_lab_stage_command(jsonb)','execute')
 and not has_function_privilege('anon','public.patient_member_lab_stages()','execute')
 and not has_function_privilege('anon','public.patient_staff_lab_stages(uuid)','execute'),'Anonymous callers cannot reach lab stages');

set local role authenticated;
select pg_temp.as_user(1);
insert into lab_results values('member-before',public.patient_member_lab_stages());
select pg_temp.as_user(3);
insert into lab_results values('results-first',public.patient_staff_lab_stage_command(pg_temp.cmd('01','31','results-received','2026-10-16T12:00:00+04:00')));
insert into lab_results values('before-collection',public.patient_staff_lab_stage_command(pg_temp.cmd('02','31','at-lab','2026-10-16T07:00:00+04:00')));
insert into lab_results values('future',public.patient_staff_lab_stage_command(pg_temp.cmd('03','31','at-lab',to_char(now()+interval '2 hours','YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
insert into lab_results values('not-collected',public.patient_staff_lab_stage_command(pg_temp.cmd('04','32','at-lab','2026-10-16T09:00:00+04:00')));
insert into lab_results values('corrected',public.patient_staff_lab_stage_command(pg_temp.cmd('14','33','at-lab','2026-10-16T09:00:00+04:00')));
insert into lab_results values('superseded',public.patient_staff_lab_stage_command(pg_temp.cmd('15','35','at-lab','2026-10-16T09:00:00+04:00')));
insert into lab_results values('extra-key',public.patient_staff_lab_stage_command(pg_temp.cmd('05','31','at-lab','2026-10-16T09:00:00+04:00')||'{"result":"normal"}'));
select pg_temp.as_user(2);
insert into lab_results values('doctor-at-lab',public.patient_staff_lab_stage_command(pg_temp.cmd('06','31','at-lab','2026-10-16T09:00:00+04:00')));
select pg_temp.as_user(4);
insert into lab_results values('unassigned-nurse',public.patient_staff_lab_stage_command(pg_temp.cmd('07','31','at-lab','2026-10-16T09:00:00+04:00')));
select pg_temp.as_user(5);
insert into lab_results values('admin',public.patient_staff_lab_stage_command(pg_temp.cmd('08','31','at-lab','2026-10-16T09:00:00+04:00')));
select pg_temp.as_user(1);
insert into lab_results values('member-write',public.patient_staff_lab_stage_command(pg_temp.cmd('09','31','at-lab','2026-10-16T09:00:00+04:00')));
select pg_temp.as_user(3);
insert into lab_results values('at-lab',public.patient_staff_lab_stage_command(pg_temp.cmd('10','31','at-lab','2026-10-16T09:00:00+04:00')));
reset role;
-- A later entry for a sample already at the lab must not hide it (review N1).
insert into public.patient_care_visit_entries(id,user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id)values
 ('b8000000-0000-4000-8000-000000000037','b8000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000021','b8000000-0000-4000-8000-000000000020',7,
  '{"kind":"collection","observedAt":"2026-10-16T08:00:00+04:00","appointmentId":"b8000000-0000-4000-8000-000000000040","acceptedRevision":1,"testId":"cbc","outcome":"not-collected","reason":"Synthetic late entry"}','2026-10-16T08:00:00+04:00','2026-10-16T04:00:00Z',
  'b8000000-0000-4000-8000-000000000003','Synthetic lab nurse','nurse','b8000000-0000-4000-8000-000000000007');
set local role authenticated;
select pg_temp.as_user(3);
insert into lab_results values('replay',public.patient_staff_lab_stage_command(pg_temp.cmd('10','31','at-lab','2026-10-16T09:00:00+04:00')));
insert into lab_results values('changed-replay',public.patient_staff_lab_stage_command(pg_temp.cmd('10','31','at-lab','2026-10-16T09:30:00+04:00')));
insert into lab_results values('second-at-lab',public.patient_staff_lab_stage_command(pg_temp.cmd('11','31','at-lab','2026-10-16T09:00:00+04:00')));
select pg_temp.as_user(2);
insert into lab_results values('results-before-lab',public.patient_staff_lab_stage_command(pg_temp.cmd('12','31','results-received','2026-10-16T08:30:00+04:00')));
insert into lab_results values('doctor-results',public.patient_staff_lab_stage_command(pg_temp.cmd('13','31','results-received','2026-10-16T15:00:00+04:00')));
insert into lab_results values('doctor-read',public.patient_staff_lab_stages('b8000000-0000-4000-8000-000000000001'));
select pg_temp.as_user(1);
insert into lab_results values('member-after',public.patient_member_lab_stages());
reset role;
insert into public.patient_care_plans(id,user_id,clinician,instructions)values('b8000000-0000-4000-8000-000000000060','b8000000-0000-4000-8000-000000000001','Synthetic lab doctor','Synthetic plan');
insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft)values
 ('b8000000-0000-4000-8000-000000000001','b8000000-0000-4000-8000-000000000060','b8000000-0000-4000-8000-000000000061','b8000000-0000-4000-8000-000000000002',2,'synthetic','{}','{}','{}');
set local role authenticated;
insert into lab_results values('member-published',public.patient_member_lab_stages());
select pg_temp.as_user(2);
insert into lab_results values('staff-published',public.patient_staff_lab_stages('b8000000-0000-4000-8000-000000000001'));
select pg_temp.as_user(6);
insert into lab_results values('other-member',public.patient_member_lab_stages());
reset role;

select pg_temp.lab_assert((select result->'samples'->0=jsonb_build_object('entryId','b8000000-0000-4000-8000-000000000031','visitId','b8000000-0000-4000-8000-000000000021','testId','cbc','title',null,'collectedAt','2026-10-16T04:00:00+00:00','stages','[]'::jsonb) from lab_results where label='member-before'),'Member sees the collected sample at the collected stage');
select pg_temp.lab_assert((select array(select x->>'entryId' from jsonb_array_elements(result->'samples')x order by 1)=array['b8000000-0000-4000-8000-000000000031','b8000000-0000-4000-8000-000000000036'] from lab_results where label='member-before'),'Only current collected outcomes are samples: corrected and superseded entries are not');
select pg_temp.lab_assert((select bool_and(result->>'status'='invalid') from lab_results where label in('corrected','superseded','results-first','before-collection','future','not-collected','extra-key','results-before-lab')),'Out-of-order, impossible-time, uncollected and extended commands are rejected');
select pg_temp.lab_assert((select bool_and(result->>'status'='access') from lab_results where label in('doctor-at-lab','unassigned-nurse','admin','member-write')),'Only the assigned nurse records at-lab');
select pg_temp.lab_assert((select result->>'status'='saved' and result->>'replayed'='false' from lab_results where label='at-lab'),'Assigned nurse records at-lab');
select pg_temp.lab_assert((select result->>'status'='saved' and result->>'replayed'='true' and result->>'stageId'=(select result->>'stageId' from lab_results where label='at-lab') from lab_results where label='replay'),'Lost-response resend replays the stored stage');
select pg_temp.lab_assert((select bool_and(result->>'status'='stale') from lab_results where label in('changed-replay','second-at-lab')),'A changed resend or second at-lab is stale');
select pg_temp.lab_assert((select result->>'status'='saved' from lab_results where label='doctor-results'),'Assigned doctor records results-received');
select pg_temp.lab_assert((select count(*)=2 from public.patient_care_lab_stages where user_id='b8000000-0000-4000-8000-000000000001'),'Exactly two stages persisted');
select pg_temp.lab_assert((select revision=2 from public.patient_clinical_cases where user_id='b8000000-0000-4000-8000-000000000001'),'Each new stage advances the case revision once');
select pg_temp.lab_assert((select count(*)=2 from public.patient_clinical_case_events where user_id='b8000000-0000-4000-8000-000000000001' and kind='care-evidence' and detail ? 'labStageId'),'Each stage leaves an attributed case event');
select pg_temp.lab_assert((select result#>>'{samples,0,stages,0,actor,name}'='Synthetic lab nurse' and result#>>'{samples,0,stages,1,actor,role}'='doctor' from lab_results where label='doctor-read'),'Staff read carries attribution in order');
select pg_temp.lab_assert((select result#>'{samples,0,stages}'=jsonb_build_array(jsonb_build_object('stage','at-lab','occurredAt','2026-10-16T05:00:00+00:00'),jsonb_build_object('stage','results-received','occurredAt','2026-10-16T11:00:00+00:00')) from lab_results where label='member-after'),'Member read has stages without staff identities');
select pg_temp.lab_assert((select result->'samples'='[]'::jsonb from lab_results where label='other-member'),'Another member sees nothing');
select pg_temp.lab_assert((select result->'samples'='[]'::jsonb from lab_results where label='member-published'),'After publication the finished cycle leaves member Home');
select pg_temp.lab_assert((select jsonb_array_length(result->'samples')=2 from lab_results where label='staff-published'),'Staff keep the sample history after publication');

do $$begin
 perform pg_temp.as_user(4);
 set local role authenticated;
 begin perform public.patient_staff_lab_stages('b8000000-0000-4000-8000-000000000001');raise exception 'TEST unassigned nurse read lab stages';
 exception when insufficient_privilege then null;end;
 perform pg_temp.as_user(5);
 begin perform public.patient_staff_lab_stages('b8000000-0000-4000-8000-000000000001');raise exception 'TEST admin read clinical lab stages';
 exception when insufficient_privilege then null;end;
 reset role;
 begin update public.patient_care_lab_stages set occurred_at=now() where user_id='b8000000-0000-4000-8000-000000000001';raise exception 'TEST lab stage mutated';
 exception when object_not_in_prerequisite_state then null;end;
end$$;
rollback;
select 'Lab stages: order, assigned scope, replay, member privacy and immutability passed.';
