-- Direct clinic profile edits, two-person care-team changes and downstream routing. Fictional fixtures, no delivery calls,
-- no external services. scripts/run-checks.mjs discovers this file; every change rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ap_assert(ok boolean,label text)returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.ap_id(n text)returns uuid language sql immutable as $$select('ca2a0000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.ap_user(n text)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ap_id(n),'role','authenticated','exp',4102444800,
 'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',('ca2a0000-0000-4000-8000-0000000001'||n)::uuid)::text,true),
 set_config('request.jwt.claim.sub',pg_temp.ap_id(n)::text,true)
$$;
-- Authorization may reject at the portal/staff guard or at the scoped RPC boundary.
create function pg_temp.ap_refused(q text)returns boolean language plpgsql as $$declare r jsonb;begin
 execute q into r;return r->>'status'='refused';exception when insufficient_privilege then return true;
end$$;
create function pg_temp.ap_request(kind text,submission text,expected jsonb,proposed jsonb)returns jsonb language sql as $$
 select public.clinic_admin_change_request(pg_temp.ap_id('0a'),pg_temp.ap_id('01'),kind,pg_temp.ap_id(submission),expected,proposed)
$$;
grant execute on function pg_temp.ap_assert(boolean,text),pg_temp.ap_id(text),pg_temp.ap_user(text),pg_temp.ap_refused(text),pg_temp.ap_request(text,text,jsonb,jsonb)to authenticated,anon;
-- A=0c, B=0d same-clinic admins; S=0e portal staff; C=0f other clinic admin;
-- P=aa platform admin; D1=d1, D2=d2, N1=e1, N2=e2; member=01.
insert into auth.users(id,phone,phone_confirmed_at)
 select pg_temp.ap_id(n),case when n='01'then '37499070101'end,case when n='01'then now()end
 from unnest(array['01','02','0c','0d','0e','0f','aa','d1','d2','e1','e2'])n;
insert into auth.sessions(id,user_id,created_at,updated_at)
 select('ca2a0000-0000-4000-8000-0000000001'||n)::uuid,pg_temp.ap_id(n),now(),now()
 from unnest(array['01','0c','0d','0e','0f','aa','d1','d2','e1','e2'])n;
insert into public.workspace_clinics(id,name,address)values
 (pg_temp.ap_id('0a'),'Fictional approval clinic A','1 Fictional Street'),(pg_temp.ap_id('0b'),'Fictional approval clinic B','2 Fictional Street');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.ap_id('d1'),'doctor','Fictional doctor D1',pg_temp.ap_id('0a')),(pg_temp.ap_id('d2'),'doctor','Fictional doctor D2',pg_temp.ap_id('0a')),
 (pg_temp.ap_id('e1'),'nurse','Fictional nurse N1',pg_temp.ap_id('0a')),(pg_temp.ap_id('e2'),'nurse','Fictional nurse N2',pg_temp.ap_id('0a')),
 (pg_temp.ap_id('aa'),'admin','Fictional platform P',null);
insert into public.clinic_portal_memberships(id,user_id,clinic_id,display_name,role)values
 (pg_temp.ap_id('f1'),pg_temp.ap_id('0c'),pg_temp.ap_id('0a'),'Fictional admin A','admin'),
 (pg_temp.ap_id('f2'),pg_temp.ap_id('0d'),pg_temp.ap_id('0a'),'Fictional admin B','admin'),
 (pg_temp.ap_id('f3'),pg_temp.ap_id('0e'),pg_temp.ap_id('0a'),'Fictional staff S','staff'),
 (pg_temp.ap_id('f4'),pg_temp.ap_id('0f'),pg_temp.ap_id('0b'),'Fictional admin C','admin');
update public.profiles set display_name='Fictional original member',birth_date='1975-04-05',biological_sex='female'where id=pg_temp.ap_id('01');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 (pg_temp.ap_id('01'),pg_temp.ap_id('d1'),pg_temp.ap_id('e1')),(pg_temp.ap_id('02'),null,null);
insert into public.clinic_portal_capabilities(singleton,clinic_admin_full_access)values(true,true)
 on conflict(singleton)do update set clinic_admin_full_access=true;
-- Existing clinical age must remain consistent when a correction is proposed.
set local session_replication_role=replica;
insert into public.patient_assessments(user_id,algorithm_version,answers,assessment_date,completed_at)
 values(pg_temp.ap_id('01'),'NRN-CLIN-ALG-001','{"q1.sex":{"value":"female"}}','2026-10-15',now());
set local session_replication_role=origin;
create temp table ap_results(label text primary key,r jsonb)on commit drop;
grant select,insert,update on ap_results to authenticated;

create function pg_temp.ap_sqlstate(q text)returns text language plpgsql as $$begin
 execute q;return 'ran';exception when others then return sqlstate;
end$$;

-- Tables are private and the RPCs run read-write under PostgREST.
select pg_temp.ap_assert((select relrowsecurity from pg_class where oid='public.clinic_admin_change_requests'::regclass),'Request table has RLS');
select pg_temp.ap_assert(not has_table_privilege(r,'public.clinic_admin_change_requests','select,insert,update,delete'),'No direct request-table grant: '||r)
 from unnest(array['anon','authenticated','service_role'])r;
do $$declare f regprocedure;begin
 foreach f in array array['public.clinic_admin_change_request(uuid,uuid,text,uuid,jsonb,jsonb)'::regprocedure,
 'public.clinic_admin_change_requests(uuid,text)'::regprocedure,'public.staff_clinic_change_requests(text)'::regprocedure,
 'public.clinic_admin_change_decide(uuid,uuid,text,text)'::regprocedure,'public.staff_clinic_change_decide(uuid,text,text)'::regprocedure]loop
 perform pg_temp.ap_assert(has_function_privilege('authenticated',f,'execute')and not has_function_privilege('anon',f,'execute')
  and not has_function_privilege('service_role',f,'execute'),'RPC grants: '||f::text);
 perform pg_temp.ap_assert((select provolatile='v'from pg_proc where oid=f),'RPC volatile: '||f::text);
 end loop;
 perform pg_temp.ap_assert(not has_function_privilege('authenticated','public._care_team_reconcile(uuid,uuid,text,uuid)','execute'), 'Rerouting helper is private');
 perform pg_temp.ap_assert(not has_function_privilege('authenticated','public._clinic_profile_apply(uuid,boolean)','execute'),'Profile apply helper is private');
end$$;

-- Profile changes apply in the submission transaction. Legacy success keys remain
-- parseable; the new app maps this profile-only pending response to Saved.
select pg_temp.ap_user('0c');set local role authenticated;
select pg_temp.ap_assert(pg_temp.ap_request('profile','8b','{"name":"Fictional original member","birthDate":"1975-04-05"}',
 '{"name":"Fictional changed age","birthDate":"1990-06-07"}')->>'status'='age-changes','Assessed member cannot acquire a different clinical age');
select pg_temp.ap_assert(pg_temp.ap_request('profile','8c','{"name":"Fictional original member","birthDate":"1975-04-05"}',
 '{"name":"Fictional child","birthDate":"2015-01-01"}')->>'status'='invalid','Under-18 correction refused');
select pg_temp.ap_assert(pg_temp.ap_request('profile','8d','{"name":"Fictional original member","birthDate":"1975-04-05"}',
 '{"name":"   ","birthDate":"1975-04-05"}')->>'status'='invalid','Blank member name refused');
insert into ap_results values('profile',pg_temp.ap_request('profile','81','{"name":"Fictional original member","birthDate":"1975-04-05"}',
 '{"name":"Fictional corrected member","birthDate":"1975-06-07"}'));
select pg_temp.ap_assert((select r->>'status'='pending'and r->>'requestId'is not null from ap_results where label='profile'),'Immediate save retains deployed response keys');
select pg_temp.ap_assert(pg_temp.ap_request('profile','81','{"name":"Fictional original member","birthDate":"1975-04-05"}',
 '{"name":"Fictional corrected member","birthDate":"1975-06-07"}')=(select r from ap_results where label='profile'),'Exact submission retry returns same request');
select pg_temp.ap_assert(pg_temp.ap_request('profile','82','{"name":"Fictional original member","birthDate":"1975-04-05"}',
 '{"name":"Fictional another proposal","birthDate":"1975-06-07"}')->>'status'='stale','Stale profile submission is refused without queueing');
select pg_temp.ap_assert(pg_temp.ap_request('profile','81','{"name":"Fictional original member","birthDate":"1975-04-05"}',
 '{"name":"Fictional conflicting member","birthDate":"1975-06-07"}')->>'status'='conflict','Same submission with different content is refused');
select pg_temp.ap_assert(public.clinic_admin_patient_profile_update(pg_temp.ap_id('0a'),pg_temp.ap_id('01'),gen_random_uuid(),'{"name":"Fictional corrected member","birthDate":"1975-06-07"}','Bypass','1975-06-07')->>'status'='disabled','Legacy profile write stays disabled');
select pg_temp.ap_assert(public.clinic_admin_patient_care_team(pg_temp.ap_id('0a'),pg_temp.ap_id('01'),0,pg_temp.ap_id('d2'),null)->>'status'='disabled','Legacy team write disabled');
select pg_temp.ap_user('0d');
select pg_temp.ap_assert((select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(r->>'requestId')::uuid,'approve',null)->>'status'='not_pending'from ap_results where label='profile'),'Applied profile needs no second approval');
select pg_temp.ap_assert(public.clinic_admin_change_requests(pg_temp.ap_id('0a'))->'requests'='[]'::jsonb,'Clinic pending queue excludes saved profile');
select pg_temp.ap_assert(public.clinic_admin_change_requests(pg_temp.ap_id('0a'),'decided')->'requests'='[]'::jsonb,'Clinic decided queue excludes profile history');
select pg_temp.ap_assert(public.clinic_admin_patient_record(pg_temp.ap_id('0a'),pg_temp.ap_id('01'))->'pendingRequests'='[]'::jsonb,'Saved profile never returns a waiting banner');
insert into ap_results values('clinic-profile-log',public.clinic_audit_log(pg_temp.ap_id('0a'),p_member=>pg_temp.ap_id('01'),p_category=>'care_change',p_profile_values=>true));
select pg_temp.ap_user('aa');
select pg_temp.ap_assert(public.staff_clinic_change_requests()->'requests'='[]'::jsonb and public.staff_clinic_change_requests('decided')->'requests'='[]'::jsonb,'Platform queues exclude profile items');
insert into ap_results values('platform-profile-log',public.admin_audit_log(p_member=>pg_temp.ap_id('01'),p_category=>'care_change',p_profile_values=>true));
reset role;
select pg_temp.ap_assert((select display_name='Fictional corrected member'and birth_date='1975-06-07'and biological_sex='female'from public.profiles where id=pg_temp.ap_id('01'))
 and(select phone='37499070101'from auth.users where id=pg_temp.ap_id('01')),'Profile changes only name and DOB immediately');
select pg_temp.ap_assert((select count(*)=1 and bool_and(actor_id=pg_temp.ap_id('0c')and approved_by is null
 and before='{"name":"Fictional original member","birthDate":"1975-04-05"}'and after='{"name":"Fictional corrected member","birthDate":"1975-06-07"}')
 from public.clinic_member_profile_changes where member_id=pg_temp.ap_id('01')),'Exact old/new profile audit once, original actor, no approver');
select pg_temp.ap_assert((select count(*)=1 and bool_and(state='applied'and decided_by is null and decided_at is not null)
 from public.clinic_admin_change_requests where member_id=pg_temp.ap_id('01')),'Retry, conflict and stale submission create no extra requests');
select pg_temp.ap_assert((select count(*)=1 and bool_and(actor_id=pg_temp.ap_id('0c')and detail->'fields'='["birthDate", "name"]'::jsonb)
 from public.clinic_portal_audit where kind='profile_updated'and detail->>'requestId'=(select r->>'requestId'from ap_results where label='profile')),'Exactly one visible profile event');
select pg_temp.ap_assert((select exists(select 1 from jsonb_array_elements(r->'rows')x where x->>'action'='profile_updated'
 and x->>'actorId'=pg_temp.ap_id('0c')::text and x->>'memberId'=pg_temp.ap_id('01')::text
 and x#>>'{profileChange,name,before}'='Fictional original member'and x#>>'{profileChange,name,after}'='Fictional corrected member'
 and x#>>'{profileChange,birthDate,beforeYear}'='1975'and x#>>'{profileChange,birthDate,afterYear}'='1975')
 and r::text not like '%1975-04-05%'and r::text not like '%1975-06-07%'from ap_results where label='clinic-profile-log'),'Clinic audit shows actor, member, fields and masked DOB');
select pg_temp.ap_assert((select exists(select 1 from jsonb_array_elements(r->'rows')x where x->>'action'='profile_updated'
 and x#>>'{profileChange,birthDate,before}'='1975-04-05'and x#>>'{profileChange,birthDate,after}'='1975-06-07')from ap_results where label='platform-profile-log'),'Noreon audit shows full old and new DOB');

select pg_temp.ap_user('0c');set local role authenticated;
insert into ap_results values('legacy-profile-log',public.clinic_audit_log(pg_temp.ap_id('0a'),p_member=>pg_temp.ap_id('01'),p_category=>'care_change'));
reset role;
select pg_temp.ap_assert((select exists(select 1 from jsonb_array_elements(r->'rows')x where x->>'action'='profile_updated')
 and not exists(select 1 from jsonb_array_elements(r->'rows')x where x?'profileChange')from ap_results where label='legacy-profile-log'),'Deployed strict audit parser gets metadata only until app opts in');

-- Every unauthorized role uses a valid edit payload, so a malformed input cannot
-- accidentally make these authorization checks pass. No profile mutation/audit.
select pg_temp.ap_user('0e');set local role authenticated;
select pg_temp.ap_assert(pg_temp.ap_refused($q$select public.clinic_admin_change_requests(pg_temp.ap_id('0a'))$q$),'Portal staff cannot read requests');
select pg_temp.ap_assert(pg_temp.ap_refused($q$select pg_temp.ap_request('profile','83','{"name":"Fictional corrected member","birthDate":"1975-06-07"}','{"name":"Unauthorized","birthDate":"1975-06-07"}')$q$),'Portal staff cannot edit');
select pg_temp.ap_user('0f');
select pg_temp.ap_assert(pg_temp.ap_refused($q$select public.clinic_admin_change_request(pg_temp.ap_id('0b'),pg_temp.ap_id('01'),'profile',gen_random_uuid(),'{"name":"Fictional corrected member","birthDate":"1975-06-07"}','{"name":"Unauthorized","birthDate":"1975-06-07"}')$q$),'Other clinic admin cannot edit');
select pg_temp.ap_user('d1');
select pg_temp.ap_assert(pg_temp.ap_refused($q$select pg_temp.ap_request('profile','83','{"name":"Fictional corrected member","birthDate":"1975-06-07"}','{"name":"Unauthorized","birthDate":"1975-06-07"}')$q$),'Doctor cannot edit');
select pg_temp.ap_assert(pg_temp.ap_refused($q$select public.staff_clinic_change_requests()$q$),'Doctor cannot use platform queue');
select pg_temp.ap_assert(pg_temp.ap_refused($q$select public.staff_clinic_change_decide((select(r->>'requestId')::uuid from ap_results where label='profile'),'approve',null)$q$),'Doctor cannot use platform decision route');
select pg_temp.ap_user('e1');
select pg_temp.ap_assert(pg_temp.ap_refused($q$select pg_temp.ap_request('profile','83','{"name":"Fictional corrected member","birthDate":"1975-06-07"}','{"name":"Unauthorized","birthDate":"1975-06-07"}')$q$),'Nurse cannot edit');
select pg_temp.ap_user('01');
select pg_temp.ap_assert(pg_temp.ap_refused($q$select pg_temp.ap_request('profile','83','{"name":"Fictional corrected member","birthDate":"1975-06-07"}','{"name":"Unauthorized","birthDate":"1975-06-07"}')$q$),'Member cannot use clinic admin edit');
select pg_temp.ap_user('0c');
select pg_temp.ap_assert(public.clinic_admin_change_request(pg_temp.ap_id('0a'),pg_temp.ap_id('02'),'profile',gen_random_uuid(),'{}','{}')->>'status'='refused','Unrelated member cannot be changed');
reset role;
select pg_temp.ap_assert((select display_name='Fictional corrected member'from public.profiles where id=pg_temp.ap_id('01'))
 and(select count(*)=1 from public.clinic_member_profile_changes where member_id=pg_temp.ap_id('01'))
 and(select count(*)=1 from public.clinic_portal_audit where kind='profile_updated'and detail->>'memberId'=pg_temp.ap_id('01')::text),'Refused and stale edits have no change or change audit');
update public.clinic_portal_capabilities set clinic_admin_full_access=false where singleton;
select pg_temp.ap_user('0c');set local role authenticated;
select pg_temp.ap_assert(pg_temp.ap_request('profile','8a','{}','{}')->>'status'='disabled','Full-access switch gates profile edits');
reset role;
update public.clinic_portal_capabilities set clinic_admin_full_access=true where singleton;

-- Existing pending requests replay through the real shared apply helper. A scope
-- change, revoked requester or changed field supersedes instead of overwriting.
insert into auth.users(id)select pg_temp.ap_id(n)from unnest(array['04','05','06','07'])n;
update public.profiles set display_name='Fictional backfill original',birth_date='1975-04-05'where id in(pg_temp.ap_id('05'),pg_temp.ap_id('06'),pg_temp.ap_id('07'));
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)
 select pg_temp.ap_id(n),pg_temp.ap_id('d1'),pg_temp.ap_id('e1')from unnest(array['04','05','06','07'])n;
insert into public.clinic_admin_change_requests(id,clinic_id,member_id,kind,requested_by,requested_membership,submission_id,expected,proposed,before,created_at)
 select pg_temp.ap_id('b'||n),pg_temp.ap_id('0a'),pg_temp.ap_id('0'||n),'profile',pg_temp.ap_id('0c'),pg_temp.ap_id('f1'),pg_temp.ap_id('c'||n),
 '{"name":"Fictional backfill original","birthDate":"1975-04-05"}',
 '{"name":"Fictional backfill correction","birthDate":"1975-06-07"}',
 '{"name":"Fictional backfill original","birthDate":"1975-04-05"}',clock_timestamp()-interval '8 days'+(n::int*interval '1 second')
 from unnest(array['5','6','7'])n;
update public.profiles set display_name='Fictional newer correction'where id=pg_temp.ap_id('06');
update public.patient_clinical_cases set assigned_doctor_id=null,assigned_nurse_id=null where user_id=pg_temp.ap_id('07');
do $$declare r record;begin
 for r in select id from public.clinic_admin_change_requests where kind='profile'and state='pending'order by created_at,id for update loop
  perform public._clinic_profile_apply(r.id,true);
 end loop;
end$$;
select pg_temp.ap_assert((select display_name='Fictional backfill correction'and birth_date='1975-06-07'from public.profiles where id=pg_temp.ap_id('05'))
 and(select state='applied'and decision_note='Auto-applied when profile approval was removed'from public.clinic_admin_change_requests where id=pg_temp.ap_id('b5')),'Non-stale pending profile auto-applies, including requests older than 7 days');
select pg_temp.ap_assert((select display_name='Fictional newer correction'and birth_date='1975-04-05'from public.profiles where id=pg_temp.ap_id('06'))
 and(select count(*)=2 and bool_and(state='superseded')from public.clinic_admin_change_requests where id in(pg_temp.ap_id('b6'),pg_temp.ap_id('b7'))),'Changed field or lost member scope is superseded without applying');
select pg_temp.ap_assert((select count(*)=1 and bool_and(before->>'name'='Fictional backfill original'and after->>'name'='Fictional backfill correction'and approved_by is null)
 from public.clinic_member_profile_changes where member_id in(pg_temp.ap_id('05'),pg_temp.ap_id('06'),pg_temp.ap_id('07'))),'Only applied backfill writes profile history');
select pg_temp.ap_assert((select count(*)=3 and count(distinct detail->>'requestId')=3 and bool_and(actor_id=pg_temp.ap_id('0c'))from public.clinic_portal_audit
 where kind in('profile_auto_applied','profile_superseded')and detail->>'requestId'in(pg_temp.ap_id('b5')::text,pg_temp.ap_id('b6')::text,pg_temp.ap_id('b7')::text)),'Every backfill outcome is logged exactly once with original actor');
select pg_temp.ap_assert(public._clinic_profile_apply(pg_temp.ap_id('b5'),true)->>'status'='not_pending','Backfill retry cannot apply twice');

-- Preserve the complete two-person decision lifecycle on a separate care-team
-- member, so routing fixtures for member 01 retain their original revisions.
create function pg_temp.ap_care_request(submission text,revision int)returns jsonb language sql as $$
 select public.clinic_admin_change_request(pg_temp.ap_id('0a'),pg_temp.ap_id('04'),'care_team',pg_temp.ap_id(submission),
 jsonb_build_object('revision',revision),jsonb_build_object('doctorId',pg_temp.ap_id('d2'),'nurseId',pg_temp.ap_id('e2')))
$$;
grant execute on function pg_temp.ap_care_request(text,int)to authenticated;
select pg_temp.ap_user('0c');set local role authenticated;
insert into ap_results values('approval',pg_temp.ap_care_request('a1',0));
select pg_temp.ap_assert((select r->>'status'='pending'from ap_results where label='approval'),'Care-team change still goes pending');
select pg_temp.ap_assert(pg_temp.ap_care_request('a1',0)=(select r from ap_results where label='approval'),'Care-team retry returns same request');
select pg_temp.ap_assert(pg_temp.ap_care_request('a2',0)->>'status'='pending_exists','Second care-team proposal returns pending_exists');
select pg_temp.ap_assert((select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(r->>'requestId')::uuid,'approve',null)->>'status'='self_approval'from ap_results where label='approval'),'Care-team requester cannot self-approve');
insert into ap_results values('clinic-list',public.clinic_admin_change_requests(pg_temp.ap_id('0a')));
reset role;
select pg_temp.ap_assert((select assigned_doctor_id=pg_temp.ap_id('d1')and revision=0 from public.patient_clinical_cases where user_id=pg_temp.ap_id('04')),'Pending care-team request has no assignment effect');
select pg_temp.ap_assert((select (r#>'{requests,0}')?&array['id','clinicId','clinicName','kind','memberId','memberName','requesterName','mine','createdAt','decidedAt','state','decisionNote','summary']
 and r#>>'{requests,0,requesterName}'='Fictional admin A'and r#>>'{requests,0,mine}'='true'from ap_results where label='clinic-list'),'Care-team queue retains reviewable attribution and timestamps');
select pg_temp.ap_user('0e');set local role authenticated;
select pg_temp.ap_assert(pg_temp.ap_refused($q$select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(select(r->>'requestId')::uuid from ap_results where label='approval'),'approve',null)$q$),'Portal staff cannot decide');
select pg_temp.ap_user('0f');
select pg_temp.ap_assert(pg_temp.ap_refused($q$select public.clinic_admin_change_decide(pg_temp.ap_id('0b'),(select(r->>'requestId')::uuid from ap_results where label='approval'),'approve',null)$q$),'Other clinic cannot decide copied request');
reset role;
update public.clinic_portal_capabilities set clinic_admin_full_access=false where singleton;
select pg_temp.ap_user('0d');set local role authenticated;
select pg_temp.ap_assert((select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(r->>'requestId')::uuid,'approve',null)->>'status'='disabled'from ap_results where label='approval'),'Full-access switch gates care-team decisions');
reset role;
update public.clinic_portal_capabilities set clinic_admin_full_access=true where singleton;
select pg_temp.ap_user('0d');set local role authenticated;
select pg_temp.ap_assert(public.clinic_admin_change_requests(pg_temp.ap_id('0a'))#>>'{requests,0,mine}'='false','Second admin sees someone else''s care-team request');
select pg_temp.ap_assert((select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(r->>'requestId')::uuid,'unknown',null)->>'status'='invalid'from ap_results where label='approval'),'Unknown decision refused');
select pg_temp.ap_assert((select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(r->>'requestId')::uuid,'approve',null)->>'status'='approved'from ap_results where label='approval'),'Different clinic admin still approves care team');
select pg_temp.ap_assert((select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(r->>'requestId')::uuid,'approve',null)->>'status'='not_pending'from ap_results where label='approval'),'Repeated decision does not reapply');
reset role;
-- Restore this separate synthetic member before exercising non-applying decisions.
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.ap_id('d1'),assigned_nurse_id=pg_temp.ap_id('e1'),revision=0 where user_id=pg_temp.ap_id('04');
select pg_temp.ap_user('0c');set local role authenticated;
insert into ap_results values('reject',pg_temp.ap_care_request('a3',0));
select pg_temp.ap_assert((select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(r->>'requestId')::uuid,'reject','   ')->>'status'='reason_required'from ap_results where label='reject'),'Requester blank rejection reason validated before self-approval guard');
select pg_temp.ap_user('0d');
select pg_temp.ap_assert((select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(r->>'requestId')::uuid,'reject','   ')->>'status'='reason_required'from ap_results where label='reject'),'Blank rejection reason refused');
select pg_temp.ap_assert((select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(r->>'requestId')::uuid,'cancel',null)->>'status'='refused'from ap_results where label='reject'),'Other admin cannot cancel');
select pg_temp.ap_assert((select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(r->>'requestId')::uuid,'reject','Fictional reason')->>'status'='rejected'from ap_results where label='reject'),'Rejection persists reason');
select pg_temp.ap_user('0c');
insert into ap_results values('cancel',pg_temp.ap_care_request('a4',0));
select pg_temp.ap_assert((select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(r->>'requestId')::uuid,'cancel',null)->>'status'='cancelled'from ap_results where label='cancel'),'Requester cancels care team');
insert into ap_results values('expired',pg_temp.ap_care_request('a5',0));
reset role;
set local session_replication_role=replica;
update public.clinic_admin_change_requests set created_at=clock_timestamp()-interval '8 days'where id=(select(r->>'requestId')::uuid from ap_results where label='expired');
set local session_replication_role=origin;
select pg_temp.ap_user('0d');set local role authenticated;
select pg_temp.ap_assert((select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(r->>'requestId')::uuid,'approve',null)->>'status'='expired'from ap_results where label='expired'),'Eight-day care-team request still expires');
select pg_temp.ap_user('0c');
insert into ap_results values('platform',pg_temp.ap_care_request('a6',0));
select pg_temp.ap_user('aa');
insert into ap_results values('platform-list',public.staff_clinic_change_requests());
select pg_temp.ap_assert((select r->>'status'='ok'and exists(select 1 from jsonb_array_elements(r->'requests')x where x->>'id'=(select r->>'requestId'from ap_results where label='platform')and x->>'kind'='care_team')from ap_results where label='platform-list'),'Platform queue retains care-team requests');
select pg_temp.ap_assert((select public.staff_clinic_change_decide((r->>'requestId')::uuid,'approve',null)->>'status'='approved'from ap_results where label='platform'),'Platform approval still applies care team');
reset role;

select pg_temp.ap_user('0c');set local role authenticated;
insert into ap_results values('overflow-own',pg_temp.ap_request('care_team','af','{"revision":0}',jsonb_build_object('doctorId',pg_temp.ap_id('d1'),'nurseId',null)));
reset role;
-- The member record must query this member directly. A clinic-wide queue is capped
-- at 100 and can omit an older pending request behind unrelated newer requests.
create temp table ap_overflow_ids on commit drop as
 select ('ca2a1000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid id from generate_series(1,101)n;
insert into auth.users(id)select id from ap_overflow_ids;
insert into public.clinic_admin_change_requests(clinic_id,member_id,kind,requested_by,requested_membership,submission_id,expected,proposed,before,created_at)
 select pg_temp.ap_id('0a'),id,'care_team',pg_temp.ap_id('0c'),pg_temp.ap_id('f1'),gen_random_uuid(),
 '{"revision":0}',
 jsonb_build_object('doctorId',pg_temp.ap_id('d2'),'nurseId',null),
 jsonb_build_object('doctorId',pg_temp.ap_id('d1'),'nurseId',pg_temp.ap_id('e1')),clock_timestamp()
 from ap_overflow_ids;
select pg_temp.ap_user('0c');set local role authenticated;
select pg_temp.ap_assert(jsonb_array_length(public.clinic_admin_change_requests(pg_temp.ap_id('0a'))->'requests')=100
 and not exists(select 1 from jsonb_array_elements(public.clinic_admin_change_requests(pg_temp.ap_id('0a'))->'requests')x
 where x->>'id'=(select r->>'requestId'from ap_results where label='overflow-own')),'Newer unrelated pending rows fill the capped clinic queue');
select pg_temp.ap_assert(public.clinic_admin_patient_record(pg_temp.ap_id('0a'),pg_temp.ap_id('01'))#>>'{pendingRequests,0,id}'
 =(select r->>'requestId'from ap_results where label='overflow-own'),'Member record still returns exactly its own older masked pending summary');
reset role;
-- Terminalize only the synthetic queue-overflow fixtures before the lifecycle checks.
update public.clinic_admin_change_requests set state='cancelled',decided_by=pg_temp.ap_id('0c'),decided_at=clock_timestamp()
 where member_id in(select id from ap_overflow_ids);

select pg_temp.ap_user('0c');set local role authenticated;
select pg_temp.ap_assert((select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(r->>'requestId')::uuid,'cancel',null)->>'status'='cancelled'from ap_results where label='overflow-own'),'Requester cancels overflow fixture');
reset role;

-- A pending care-team request rechecks both case revision and live staff eligibility.
select pg_temp.ap_user('0c');set local role authenticated;
insert into ap_results values('stale-team',pg_temp.ap_request('care_team','88','{"revision":0}',jsonb_build_object('doctorId',pg_temp.ap_id('d2'),'nurseId',pg_temp.ap_id('e2'))));
reset role;
update public.patient_clinical_cases set revision=revision+1 where user_id=pg_temp.ap_id('01');
select pg_temp.ap_user('0d');set local role authenticated;
select pg_temp.ap_assert((select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(r->>'requestId')::uuid,'approve',null)->>'status'='stale'from ap_results where label='stale-team'),'Concurrent case revision makes approval stale');
select pg_temp.ap_user('0c');
insert into ap_results values('inactive-team',pg_temp.ap_request('care_team','89','{"revision":1}',jsonb_build_object('doctorId',pg_temp.ap_id('d2'),'nurseId',pg_temp.ap_id('e2'))));
reset role;
update public.workspace_staff set active=false where user_id=pg_temp.ap_id('d2');
select pg_temp.ap_user('0d');set local role authenticated;
select pg_temp.ap_assert((select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(r->>'requestId')::uuid,'approve',null)->>'status'='stale'from ap_results where label='inactive-team'),'Doctor deactivated after proposal cannot be assigned');
reset role;
update public.workspace_staff set active=true where user_id=pg_temp.ap_id('d2');

-- Alerts include open, acknowledged and resolved history. Timers and escalation snapshots
-- belong to the alert cycle and must survive a team change byte for byte.
insert into public.care_alerts(id,member_id,source,reason_code,rule_id,rule_version,source_ref,doctor_id,state,
 acknowledged_by,acknowledged_at,resolved_by,resolved_at,resolution)
values(pg_temp.ap_id('31'),pg_temp.ap_id('01'),'message','fixture','fixture','test','approval-open',pg_temp.ap_id('d1'),'open',null,null,null,null,null),
 (pg_temp.ap_id('32'),pg_temp.ap_id('01'),'lab','fixture','fixture','test','approval-ack',pg_temp.ap_id('d1'),'acknowledged',pg_temp.ap_id('d1'),now()-interval '1 hour',null,null,null),
 (pg_temp.ap_id('33'),pg_temp.ap_id('01'),'zoe','fixture','fixture','test','approval-closed',pg_temp.ap_id('d1'),'resolved',pg_temp.ap_id('d1'),now()-interval '2 hours',pg_temp.ap_id('d1'),now()-interval '1 hour','no_action_needed');
update public.care_alerts set cycle_started_at=now()-interval '3 hours',route_primary='doctor',route_backup='nurse',route_minutes=15,
 escalated_at=now()-interval '2 hours',escalated_to='nurse',escalation_attempted_at=now()-interval '1 hour',escalation_notified_at=now()-interval '1 hour'
 where member_id=pg_temp.ap_id('01');
create temp table ap_alert_before on commit drop as select id,to_jsonb(a)j from public.care_alerts a where member_id=pg_temp.ap_id('01');
insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,creator_id,owner_id,status)
select pg_temp.ap_id(t),pg_temp.ap_id('01'),kind,'Fictional task '||t,'Fictional instructions',pg_temp.ap_id('d1'),pg_temp.ap_id(owner),status
 from(values('41','contact-followup','d1','open'),('42','evidence-collection','e1','awaiting-member'),
 ('43','contact-followup','d1','completed'),('44','booking-coordination','e1','cancelled'),('45','doctor-referral','d1','awaiting-doctor'))x(t,kind,owner,status);
create temp table ap_task_before on commit drop as select id,to_jsonb(t)j from public.patient_coordination_tasks t where patient_case_id=pg_temp.ap_id('01');
insert into public.care_alert_settings(singleton,enabled,telegram_delivery)values(true,true,true)
 on conflict(singleton)do update set enabled=true,telegram_delivery=true;
-- Queue to fictional Telegram destinations only. This check never claims or delivers outbox rows.
select public._telegram_auth_bind(pg_temp.ap_id('d1'),'staff','["telegram","noreon_alert",9211,"user",8811]','["telegram","noreon_alert",9211]','+37499019211','8811',null);
select public._telegram_auth_bind(pg_temp.ap_id('d2'),'staff','["telegram","noreon_alert",9212,"user",8812]','["telegram","noreon_alert",9212]','+37499019212','8812',null);
select public._telegram_auth_bind(pg_temp.ap_id('e1'),'staff','["telegram","noreon_alert",9213,"user",8813]','["telegram","noreon_alert",9213]','+37499019213','8813',null);
select public._telegram_auth_bind(pg_temp.ap_id('e2'),'staff','["telegram","noreon_alert",9214,"user",8814]','["telegram","noreon_alert",9214]','+37499019214','8814',null);
select public._telegram_auth_bind(pg_temp.ap_id('aa'),'staff','["telegram","noreon_alert",9215,"user",8815]','["telegram","noreon_alert",9215]','+37499019215','8815',null);
select pg_temp.ap_user('0c');set local role authenticated;
insert into ap_results values('team',pg_temp.ap_request('care_team','90','{"revision":1}',jsonb_build_object('doctorId',pg_temp.ap_id('d2'),'nurseId',pg_temp.ap_id('e2'))));
select pg_temp.ap_user('0d');
select pg_temp.ap_assert((select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(r->>'requestId')::uuid,'approve',null)->>'status'='approved'from ap_results where label='team'),'B approves D2 and N2');
reset role;
select pg_temp.ap_assert((select assigned_doctor_id=pg_temp.ap_id('d2')and assigned_nurse_id=pg_temp.ap_id('e2')and revision=3 from public.patient_clinical_cases where user_id=pg_temp.ap_id('01')),'Approved team and case revision change atomically');
select pg_temp.ap_assert((select count(*)=2 and bool_and(a.doctor_id=pg_temp.ap_id('d2')and to_jsonb(a)-'doctor_id'=b.j-'doctor_id')
 from public.care_alerts a join ap_alert_before b using(id)where a.state<>'resolved'),'Live alerts reroute without changing state, counters, timers or escalation');
select pg_temp.ap_assert((select to_jsonb(a)=b.j from public.care_alerts a join ap_alert_before b using(id)where a.state='resolved'),'Resolved alert remains identical');
select pg_temp.ap_assert((select count(*)=2 and bool_and(actor_id=pg_temp.ap_id('0d'))from public.care_alert_audit where alert_id in(pg_temp.ap_id('31'),pg_temp.ap_id('32'))),'Each live alert records actual approving actor');
select pg_temp.ap_assert((select count(*)=2 and bool_and(d.recipient_id=pg_temp.ap_id('d2')and d.telegram_message_id is not null)
 from public.care_alert_deliveries d where d.alert_id in(pg_temp.ap_id('31'),pg_temp.ap_id('32'),pg_temp.ap_id('33'))),'Only new doctor gets a queued notice for each rerouted live alert');
select pg_temp.ap_assert((select count(*)=3 and bool_and(t.owner_id=case when t.id=pg_temp.ap_id('42')then pg_temp.ap_id('e2')else pg_temp.ap_id('d2')end
 and t.revision=(b.j->>'revision')::bigint+1 and to_jsonb(t)-array['owner_id','revision','updated_at']=b.j-array['owner_id','revision','updated_at'])
 from public.patient_coordination_tasks t join ap_task_before b using(id)where t.status not in('completed','cancelled')),'Open tasks reroute with one revision and retain content/status');
select pg_temp.ap_assert((select count(*)=2 and bool_and(to_jsonb(t)=b.j)from public.patient_coordination_tasks t join ap_task_before b using(id)where t.status in('completed','cancelled')),'Closed tasks remain identical');
select pg_temp.ap_assert((select count(*)=3 and bool_and(e.revision=2 and e.actor_id=pg_temp.ap_id('d2')and e.detail->>'actorId'=pg_temp.ap_id('0d')::text
 and e.note like '%Fictional%'and e.old_owner_id=case when e.task_id=pg_temp.ap_id('42')then pg_temp.ap_id('e1')else pg_temp.ap_id('d1')end)
 from public.patient_coordination_events e where e.task_id in(pg_temp.ap_id('41'),pg_temp.ap_id('42'),pg_temp.ap_id('45'))),'Task events keep old owner and names, FK-safe actor and actual approver');

-- A doctor-only change clears the nurse, moving the former nurse's open work to D1.
select pg_temp.ap_user('0c');set local role authenticated;
insert into ap_results values('doctor-only',pg_temp.ap_request('care_team','91','{"revision":3}',jsonb_build_object('doctorId',pg_temp.ap_id('d1'),'nurseId',null)));
select pg_temp.ap_user('aa');
select pg_temp.ap_assert((select public.staff_clinic_change_decide((r->>'requestId')::uuid,'approve',null)->>'status'='approved'from ap_results where label='doctor-only'),'Platform approves doctor-only team');
reset role;
select pg_temp.ap_assert((select assigned_nurse_id is null and assigned_doctor_id=pg_temp.ap_id('d1')and revision=4 from public.patient_clinical_cases where user_id=pg_temp.ap_id('01'))
 and(select owner_id=pg_temp.ap_id('d1')and revision=3 from public.patient_coordination_tasks where id=pg_temp.ap_id('42')),'Former nurse task falls back to final doctor when nurse cleared');
select pg_temp.ap_assert(exists(select 1 from public.patient_coordination_events where task_id=pg_temp.ap_id('42')and revision=3 and actor_id=pg_temp.ap_id('aa')),'Platform approver is the coordination event actor');

-- Existing native assignment entry points share the reroute, rather than leaving stale work.
select pg_temp.ap_user('aa');set local role authenticated;
select pg_temp.ap_assert(public.assign_patient_case_nurse(pg_temp.ap_id('01'),4,pg_temp.ap_id('e1'))=5,'Existing nurse assignment succeeds');
reset role;
update public.patient_coordination_tasks set owner_id=pg_temp.ap_id('e1')where id=pg_temp.ap_id('42');
select pg_temp.ap_user('aa');set local role authenticated;
select pg_temp.ap_assert(public.assign_patient_case_nurse(pg_temp.ap_id('01'),5,pg_temp.ap_id('e2'))=6,'Existing nurse replacement succeeds');
reset role;
select pg_temp.ap_assert((select owner_id=pg_temp.ap_id('e2')and revision=4 from public.patient_coordination_tasks where id=pg_temp.ap_id('42')),'assign_case_nurse reroutes old nurse work');
select pg_temp.ap_user('aa');set local role authenticated;
select pg_temp.ap_assert(public.assign_patient_clinical_case(pg_temp.ap_id('01'),6,pg_temp.ap_id('d2'))=7,'Existing doctor assignment succeeds');
reset role;
select pg_temp.ap_assert((select bool_and(doctor_id=pg_temp.ap_id('d2'))from public.care_alerts where member_id=pg_temp.ap_id('01')and state<>'resolved')
 and(select owner_id=pg_temp.ap_id('d2')from public.patient_coordination_tasks where id=pg_temp.ap_id('41')),'assign_patient_clinical_case reroutes live alerts and doctor work');
-- Cycling back to a previous doctor cannot duplicate a notice for the same alert occurrence.
select pg_temp.ap_assert((select count(*)=2 from public.care_alert_deliveries where recipient_id=pg_temp.ap_id('d2')and alert_id in(pg_temp.ap_id('31'),pg_temp.ap_id('32'))),'Reroute notice deduplication survives a repeated doctor');
select pg_temp.ap_assert((select count(*)=2 and bool_and(to_jsonb(t)=b.j)from public.patient_coordination_tasks t join ap_task_before b using(id)where t.status in('completed','cancelled')),'Closed tasks survive every assignment path unchanged');
-- Removing a doctor without a replacement deliberately keeps pinned work. There
-- is no valid fallback for either the doctor's tasks or the former nurse's tasks.
select pg_temp.ap_user('aa');set local role authenticated;
select pg_temp.ap_assert(public.assign_patient_case_nurse(pg_temp.ap_id('01'),7,pg_temp.ap_id('e1'))=8,'Prepare a nurse before removing the doctor');
reset role;
update public.patient_coordination_tasks set owner_id=pg_temp.ap_id('e1')where id=pg_temp.ap_id('42');
create temp table ap_unassigned_alert_before on commit drop as select id,to_jsonb(a)j from public.care_alerts a where member_id=pg_temp.ap_id('01');
create temp table ap_unassigned_task_before on commit drop as select id,to_jsonb(t)j from public.patient_coordination_tasks t where patient_case_id=pg_temp.ap_id('01');
create temp table ap_unassigned_counts on commit drop as select
 (select count(*)from public.care_alert_deliveries where alert_id in(pg_temp.ap_id('31'),pg_temp.ap_id('32'),pg_temp.ap_id('33')))deliveries,
 (select count(*)from public.care_alert_audit where alert_id in(pg_temp.ap_id('31'),pg_temp.ap_id('32'),pg_temp.ap_id('33')))alert_audits,
 (select count(*)from public.patient_coordination_events where task_id in(select id from ap_unassigned_task_before))task_events;
select pg_temp.ap_user('aa');set local role authenticated;
select pg_temp.ap_assert(public.assign_patient_clinical_case(pg_temp.ap_id('01'),8,null)=9,'Staff may remove the doctor without a replacement');
reset role;
select pg_temp.ap_assert((select assigned_doctor_id is null and assigned_nurse_id is null and revision=9 from public.patient_clinical_cases where user_id=pg_temp.ap_id('01')),'Removing doctor clears assigned nurse');
select pg_temp.ap_assert((select count(*)=3 and bool_and(to_jsonb(a)=b.j)from public.care_alerts a join ap_unassigned_alert_before b using(id)),
 'Without a replacement, pinned alerts and all alert timers remain unchanged');
select pg_temp.ap_assert((select count(*)=5 and bool_and(to_jsonb(t)=b.j)from public.patient_coordination_tasks t join ap_unassigned_task_before b using(id))
 and(select owner_id=pg_temp.ap_id('d2')from public.patient_coordination_tasks where id=pg_temp.ap_id('41'))
 and(select owner_id=pg_temp.ap_id('e1')from public.patient_coordination_tasks where id=pg_temp.ap_id('42')),
 'Without a replacement, old doctor and nurse tasks retain owner, revision and content');
select pg_temp.ap_assert((select deliveries=(select count(*)from public.care_alert_deliveries where alert_id in(pg_temp.ap_id('31'),pg_temp.ap_id('32'),pg_temp.ap_id('33')))
 and alert_audits=(select count(*)from public.care_alert_audit where alert_id in(pg_temp.ap_id('31'),pg_temp.ap_id('32'),pg_temp.ap_id('33')))
 and task_events=(select count(*)from public.patient_coordination_events where task_id in(select id from ap_unassigned_task_before))
 from ap_unassigned_counts),'No reroute event or notice is queued to an absent doctor');

-- Positive lifecycle evidence: privacy checks alone cannot prove an audit exists.
select pg_temp.ap_assert((select count(*)=1 and bool_and(actor_id=pg_temp.ap_id('0c'))from public.clinic_portal_audit
 where kind='change_requested'and detail->>'requestId'=(select r->>'requestId'from ap_results where label='approval'))
 and(select count(*)=1 and bool_and(actor_id=pg_temp.ap_id('0d'))from public.clinic_portal_audit
 where kind='change_approved'and detail->>'requestId'=(select r->>'requestId'from ap_results where label='approval')),
 'Exactly one request audit by A and approval audit by B for the care-team request');
select pg_temp.ap_assert((select count(*)=1 and bool_and(actor_id=pg_temp.ap_id('0d'))from public.clinic_portal_audit
 where kind='change_rejected'and detail->>'requestId'=(select r->>'requestId'from ap_results where label='reject')),'Rejection writes a positive lifecycle audit');
select pg_temp.ap_assert((select count(*)=1 and bool_and(actor_id=pg_temp.ap_id('0d'))from public.clinic_portal_audit
 where kind='change_stale'and detail->>'requestId'=(select r->>'requestId'from ap_results where label='stale-team')),'Stale approval writes a positive lifecycle audit');
select pg_temp.ap_assert((select state='approved'and decided_by=pg_temp.ap_id('aa')and decided_via='platform_admin'
 from public.clinic_admin_change_requests where id=(select(r->>'requestId')::uuid from ap_results where label='platform'))
 and(select count(*)=1 from public.access_audit where actor_id=pg_temp.ap_id('aa')and actor_role='admin'and member_id=pg_temp.ap_id('04')
 and surface='staff_clinic_change_decide'and object_id=(select r->>'requestId'from ap_results where label='platform')),
 'Platform approval retains its channel and exactly one staff access audit');
select pg_temp.ap_assert((select decision_note='Fictional reason'and state='rejected'and decided_by=pg_temp.ap_id('0d')
 from public.clinic_admin_change_requests where id=(select(r->>'requestId')::uuid from ap_results where label='reject')),'Rejected request retains decision reason and actor');
select pg_temp.ap_assert(not exists(select 1 from public.clinic_portal_audit where clinic_id=pg_temp.ap_id('0a')
 and kind like 'change_%'and(detail::text like '%Fictional corrected member%'or detail::text like '%1975-06-07%'or detail::text like '%37499070101%')),'Portal lifecycle audit has IDs and field names without profile values');
select pg_temp.ap_assert((select a.attnotnull=false from pg_attribute a where a.attrelid='public.clinic_member_profile_changes'::regclass and a.attname='approved_by')
 and exists(select 1 from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
 where c.conrelid='public.clinic_member_profile_changes'::regclass and c.confrelid='auth.users'::regclass and c.contype='f'and a.attname='approved_by'),'Profile approver is nullable and references auth.users');
select pg_temp.ap_assert(pg_temp.ap_sqlstate($q$update public.clinic_member_profile_changes set after='{}'where member_id=pg_temp.ap_id('01')$q$)='55000','Direct profile audit remains append-only');
-- F1: every transfer keeps the existing snapshot reader's detail contract.
select pg_temp.ap_assert((select count(*)>0 and bool_and(coalesce(
 jsonb_typeof(detail->'input')='object' and detail->'input'=jsonb_build_object('ownerId',new_owner_id)
 and detail ? 'before' and detail->'before'='null'::jsonb and detail->>'system'='true',false))
 from public.patient_coordination_events where task_id in(pg_temp.ap_id('41'),pg_temp.ap_id('42'),pg_temp.ap_id('45'))and operation='reassign'),
 'Reroute events preserve the input envelope and before value');
-- F3: the FK representative is never credited with a clinic admin's decision.
select pg_temp.ap_assert((select count(*)=3 and bool_and(actor_id=pg_temp.ap_id('d2')and actor_role='system'
 and actor_name='Fictional admin B'and detail->>'approvedBy'=pg_temp.ap_id('0d')::text
 and detail->>'via'='clinic_admin'and detail->>'requestId'=(select r->>'requestId'from ap_results where label='team'))
 from public.patient_coordination_events where task_id in(pg_temp.ap_id('41'),pg_temp.ap_id('42'),pg_temp.ap_id('45'))and revision=2),
 'Clinic transfer credits the actual approver as a system event');
select pg_temp.ap_assert((select count(*)=3 and bool_and(actor_id=pg_temp.ap_id('aa')and actor_role='admin'
 and actor_name='Fictional platform P'and detail->>'approvedBy'=pg_temp.ap_id('aa')::text)
 from public.patient_coordination_events where task_id in(pg_temp.ap_id('41'),pg_temp.ap_id('42'),pg_temp.ap_id('45'))and revision=3),
 'Platform transfer retains the real staff actor, name and role');

-- F2: D2 -> null -> D1 must recover work pinned across the unassigned interval.
select pg_temp.ap_user('aa');set local role authenticated;
select pg_temp.ap_assert(public.assign_patient_clinical_case(pg_temp.ap_id('01'),9,pg_temp.ap_id('d1'))=10,
 'Assign replacement after an unassigned interval');
reset role;
select pg_temp.ap_assert((select count(*)=2 and bool_and(doctor_id=pg_temp.ap_id('d1'))
 from public.care_alerts where member_id=pg_temp.ap_id('01')and state in('open','acknowledged')),
 'Replacement receives every retained live alert');
select pg_temp.ap_assert((select count(*)=3 and bool_and(owner_id=pg_temp.ap_id('d1'))
 from public.patient_coordination_tasks where patient_case_id=pg_temp.ap_id('01')and status in('open','awaiting-member','awaiting-doctor')),
 'Replacement receives retained doctor and nurse tasks');
select pg_temp.ap_assert((select count(*)=3 and bool_and(t.revision=(b.j->>'revision')::bigint+1
 and to_jsonb(t)-array['owner_id','revision','updated_at']=b.j-array['owner_id','revision','updated_at'])
 from public.patient_coordination_tasks t join ap_unassigned_task_before b using(id)where t.status in('open','awaiting-member','awaiting-doctor')),
 'Recovered tasks advance once and retain all other content');
select pg_temp.ap_assert((select count(*)=3 and bool_and(e.old_owner_id=(b.j->>'owner_id')::uuid
 and e.new_owner_id=pg_temp.ap_id('d1')and e.revision=(b.j->>'revision')::bigint+1
 and e.note='Care team changed. Was: '||s.display_name||'.'
 and e.detail->'input'=jsonb_build_object('ownerId',pg_temp.ap_id('d1')))
 from public.patient_coordination_events e join ap_unassigned_task_before b on b.id=e.task_id
 join public.workspace_staff s on s.user_id=(b.j->>'owner_id')::uuid
 where e.revision=(b.j->>'revision')::bigint+1),
 'Each recovered task has one event with that task previous owner name and input');
select pg_temp.ap_assert((select task_events+3=(select count(*)from public.patient_coordination_events where task_id in(select id from ap_unassigned_task_before))
 and alert_audits+2=(select count(*)from public.care_alert_audit where alert_id in(select id from ap_unassigned_alert_before))
 and deliveries=(select count(*)from public.care_alert_deliveries where alert_id in(select id from ap_unassigned_alert_before))
 from ap_unassigned_counts), 'Recovery audits every move without duplicating notices to the returning doctor');
select pg_temp.ap_assert((select count(*)=2 and bool_and(detail->>'fromDoctor'=pg_temp.ap_id('d2')::text
 and detail->>'toDoctor'=pg_temp.ap_id('d1')::text and actor_id=pg_temp.ap_id('aa'))
 from public.care_alert_audit where alert_id in(pg_temp.ap_id('31'),pg_temp.ap_id('32'))and kind='reassigned'
 and detail->>'fromDoctor'=pg_temp.ap_id('d2')::text and detail->>'toDoctor'=pg_temp.ap_id('d1')::text
 and detail->>'via'='staff'), 'Recovery audit records the actual pinned old doctor');
select pg_temp.ap_assert((select count(*)=2 and bool_and(to_jsonb(a)-'doctor_id'=b.j-'doctor_id')
 from public.care_alerts a join ap_unassigned_alert_before b using(id)where a.state in('open','acknowledged'))
 and(select to_jsonb(a)=b.j from public.care_alerts a join ap_unassigned_alert_before b using(id)where a.state='resolved'),
 'Recovery leaves alert state, route, escalation columns and resolved history unchanged');
select pg_temp.ap_assert((select count(*)=2 and bool_and(to_jsonb(t)=b.j)
 from public.patient_coordination_tasks t join ap_unassigned_task_before b using(id)where t.status in('completed','cancelled')),
 'Recovery leaves closed tasks identical');

-- Reconciliation looks at owner role, not the immediately previous assignment.
insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,creator_id,owner_id,status)
select pg_temp.ap_id(t),pg_temp.ap_id('01'),'contact-followup','Fictional retained task','Fictional instructions',pg_temp.ap_id('d1'),pg_temp.ap_id(owner),'open'
 from(values('46','e1'),('47','aa'))x(t,owner);
select pg_temp.ap_user('aa');set local role authenticated;
select pg_temp.ap_assert(public.assign_patient_case_nurse(pg_temp.ap_id('01'),10,pg_temp.ap_id('e2'))=11,
 'Assign final nurse when previous assignment is null');
reset role;
select pg_temp.ap_assert((select owner_id=pg_temp.ap_id('e2')and revision=2 from public.patient_coordination_tasks where id=pg_temp.ap_id('46'))
 and(select owner_id=pg_temp.ap_id('d1')and revision=2 from public.patient_coordination_tasks where id=pg_temp.ap_id('47')),
 'Retained nurse work reaches final nurse and other work reaches final doctor');
select pg_temp.ap_assert((select count(*)=3 and bool_and(t.revision=(b.j->>'revision')::bigint+1)
 from public.patient_coordination_tasks t join ap_unassigned_task_before b using(id)where t.status in('open','awaiting-member','awaiting-doctor')),
 'Tasks already owned by the final doctor stay unchanged');
create temp table ap_reconciled_tasks on commit drop as select id,to_jsonb(t)j from public.patient_coordination_tasks t where patient_case_id=pg_temp.ap_id('01');
select pg_temp.ap_user('aa');set local role authenticated;
select pg_temp.ap_assert(public.assign_patient_case_nurse(pg_temp.ap_id('01'),11,pg_temp.ap_id('e2'))=12,'Repeat final nurse writer');
reset role;
select pg_temp.ap_assert((select count(*)=7 and bool_and(to_jsonb(t)=b.j)from public.patient_coordination_tasks t join ap_reconciled_tasks b using(id)),
 'Reconciliation is idempotent for tasks already owned by either final team member');

-- A never-assigned alert, including a null old doctor, reaches its first doctor.
insert into public.care_alerts(id,member_id,source,reason_code,rule_id,rule_version,source_ref,doctor_id)
 values(pg_temp.ap_id('34'),pg_temp.ap_id('02'),'message','fixture','fixture','test','approval-first-assignment',null);
select pg_temp.ap_user('aa');set local role authenticated;
select pg_temp.ap_assert(public.assign_patient_clinical_case(pg_temp.ap_id('02'),0,pg_temp.ap_id('d2'))=1,'First staff assignment');
reset role;
select pg_temp.ap_assert((select doctor_id=pg_temp.ap_id('d2')and state='open'from public.care_alerts where id=pg_temp.ap_id('34'))
 and(select count(*)=1 and bool_and(detail->'fromDoctor'='null'::jsonb and detail->>'toDoctor'=pg_temp.ap_id('d2')::text)
 from public.care_alert_audit where alert_id=pg_temp.ap_id('34')and kind='reassigned')
 and(select count(*)=1 and bool_and(recipient_id=pg_temp.ap_id('d2'))from public.care_alert_deliveries where alert_id=pg_temp.ap_id('34')),
 'First assignment moves a null-doctor alert with an audit and one first notice');

-- Enrolment is another first-assignment writer. Use the real RPC with a fully
-- eligible fictional member and an alert raised before any case exists.
insert into auth.users(id,phone,phone_confirmed_at)values(pg_temp.ap_id('03'),'37499070103',now());
update public.profiles set display_name='Fictional enrolment member',birth_date='1980-01-01',biological_sex='female'where id=pg_temp.ap_id('03');
insert into public.patient_consents(user_id,version)values(pg_temp.ap_id('03'),'patient-pilot-v1');
insert into public.patient_assessments(user_id,revision,completed_at)values(pg_temp.ap_id('03'),2,now());
-- Limit the automatic choice to the bound fictional doctor, within this rollback.
update public.workspace_staff set active=false where role='doctor'and user_id<>pg_temp.ap_id('d2');
insert into ap_results values('pre-enrol-alert',jsonb_build_object('id',public._care_alert_raise(pg_temp.ap_id('03'),'message','fixture','{}','fixture','test','before-enrolment')));
select pg_temp.ap_assert((select doctor_id is null from public.care_alerts where id=(select(r->>'id')::uuid from ap_results where label='pre-enrol-alert')),
 'Pre-enrolment alert starts without a doctor');
create temp table ap_enrol_before on commit drop as select id,to_jsonb(a)j,
 (select count(*)from public.care_alert_deliveries where alert_id=a.id)deliveries
 from public.care_alerts a where id=(select(r->>'id')::uuid from ap_results where label='pre-enrol-alert');
select pg_temp.ap_user('03');set local role authenticated;
select pg_temp.ap_assert(public.enroll_patient_clinical_case()=pg_temp.ap_id('03'),'Real enrolment succeeds');
reset role;
select pg_temp.ap_assert((select assigned_doctor_id=pg_temp.ap_id('d2')and assigned_nurse_id in(pg_temp.ap_id('e1'),pg_temp.ap_id('e2'))and revision=2
 from public.patient_clinical_cases where user_id=pg_temp.ap_id('03'))
 and(select a.doctor_id=pg_temp.ap_id('d2')and to_jsonb(a)-'doctor_id'=b.j-'doctor_id'from public.care_alerts a join ap_enrol_before b using(id))
 and(select count(*)=1 and bool_and(actor_id=pg_temp.ap_id('03')and detail->>'via'='enrolment'and detail->'fromDoctor'='null'::jsonb)
 from public.care_alert_audit where alert_id=(select(r->>'id')::uuid from ap_results where label='pre-enrol-alert')and kind='reassigned')
 and(select count(*)=1 from public.care_alert_deliveries
 where alert_id=(select(r->>'id')::uuid from ap_results where label='pre-enrol-alert')and recipient_id=pg_temp.ap_id('d2'))
 and(select deliveries+1=(select count(*)from public.care_alert_deliveries where alert_id=b.id)from ap_enrol_before b),
 'Enrolment reconciles pre-existing alerts after the final automatic doctor and nurse assignments');
select pg_temp.ap_user('03');set local role authenticated;
select pg_temp.ap_assert(public.enroll_patient_clinical_case()=pg_temp.ap_id('03'),'Enrolment retry succeeds');
reset role;
select pg_temp.ap_assert((select count(*)=1 from public.care_alert_audit where alert_id=(select(r->>'id')::uuid from ap_results where label='pre-enrol-alert')and kind='reassigned')
 and(select deliveries+1=(select count(*)from public.care_alert_deliveries where alert_id=b.id)from ap_enrol_before b),
 'Enrolment retry adds no transfer audit or duplicate first notice');

-- Review r2 F2: a repeated enrolment changes no team, so stale live work stays exactly as it is.
insert into public.care_alerts(id,member_id,source,reason_code,rule_id,rule_version,source_ref,doctor_id)
 values(pg_temp.ap_id('35'),pg_temp.ap_id('03'),'lab','fixture','fixture','test','approval-enrol-repeat',pg_temp.ap_id('d1'));
create temp table ap_enrol_repeat on commit drop as select to_jsonb(a)j,
 (select count(*)from public.care_alert_audit where alert_id=a.id)audits,(select count(*)from public.care_alert_deliveries where alert_id=a.id)deliveries
 from public.care_alerts a where id=pg_temp.ap_id('35');
select pg_temp.ap_user('03');set local role authenticated;
select pg_temp.ap_assert(public.enroll_patient_clinical_case()=pg_temp.ap_id('03'),'Second enrolment retry succeeds');
reset role;
select pg_temp.ap_assert((select to_jsonb(a)=b.j and(select count(*)from public.care_alert_audit where alert_id=a.id)=b.audits
 and(select count(*)from public.care_alert_deliveries where alert_id=a.id)=b.deliveries from public.care_alerts a,ap_enrol_repeat b where a.id=pg_temp.ap_id('35')),
 'Repeated enrolment moves no alert and writes no audit or notice');

-- Review r2 F3: a clinic approver who also has a staff row is still recorded as a system transfer.
update public.workspace_staff set active=true where user_id=pg_temp.ap_id('d1');
insert into public.workspace_staff(user_id,role,display_name,clinic_id,active)values(pg_temp.ap_id('0d'),'doctor','Fictional staff row of B',pg_temp.ap_id('0a'),false);
insert into ap_results values('dual-role-rev',jsonb_build_object('revision',(select revision from public.patient_clinical_cases where user_id=pg_temp.ap_id('01'))));
select pg_temp.ap_user('0c');set local role authenticated;
insert into ap_results values('dual-role',pg_temp.ap_request('care_team','93',(select r from ap_results where label='dual-role-rev'),
 jsonb_build_object('doctorId',pg_temp.ap_id('d2'),'nurseId',pg_temp.ap_id('e2'))));
select pg_temp.ap_user('0d');
select pg_temp.ap_assert((select public.clinic_admin_change_decide(pg_temp.ap_id('0a'),(r->>'requestId')::uuid,'approve',null)->>'status'='approved'from ap_results where label='dual-role'),
 'Dual-role clinic admin approves');
reset role;
select pg_temp.ap_assert((select count(*)>0 and bool_and(actor_role='system'and actor_name='Fictional admin B')
 from public.patient_coordination_events where detail->>'requestId'=(select r->>'requestId'from ap_results where label='dual-role')),
 'Clinic approval by a dual-role admin is a system transfer named after the clinic admin');

-- S1-12: the decided card names the decider. A clinic sees a Noreon decision as "Noreon".
select pg_temp.ap_assert((select public._clinic_admin_change_json(r,false)->>'deciderName'='Fictional admin B'from public.clinic_admin_change_requests r
 where id=(select(x.r->>'requestId')::uuid from ap_results x where label='approval')),'Clinic approval names the approving clinic admin');
select pg_temp.ap_assert((select public._clinic_admin_change_json(r,false)->>'deciderName'='Fictional admin B'from public.clinic_admin_change_requests r
 where id=(select(x.r->>'requestId')::uuid from ap_results x where label='reject')),'Clinic rejection names the rejecting clinic admin');
select pg_temp.ap_assert((select public._clinic_admin_change_json(r,false)->>'deciderName'='Noreon'
 and public._clinic_admin_change_json(r,true)->>'deciderName'='Fictional platform P'from public.clinic_admin_change_requests r
 where id=(select(x.r->>'requestId')::uuid from ap_results x where label='platform')),'Noreon decision is "Noreon" for the clinic and the staff name for Noreon');
select pg_temp.ap_assert(not exists(select 1 from public.clinic_admin_change_requests r where r.state not in('approved','rejected')
 and public._clinic_admin_change_json(r,true)->>'deciderName'is not null),'Pending, cancelled and stale requests name no decider');

select 'clinic admin approval checks passed';
rollback;
