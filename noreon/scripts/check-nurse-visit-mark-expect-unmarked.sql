-- Nurse visit mark with expectUnmarked: the chat's typed reading never replaces a measurement marked since its card was prepared.
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
  '[{"id":"lipid-panel","title":"Lipid panel","method":"lab"},{"id":"ecg-12-lead","title":"ECG","method":"clinic"},{"id":"urine-acr","title":"Urine ACR","method":"lab"},{"id":"anthropometry","title":"Weight and waist","method":"clinic"}]',
  'synthetic','synthetic','{}',jsonb_build_object('terms',jsonb_build_object('mode','home','startsAt',s,'endsAt',s+interval '1 hour','timezone','Asia/Yerevan','location','Synthetic street 1'))
 from(values('c7700000-0000-4000-8000-000000000041'::uuid,date_trunc('minute',now())),('c7700000-0000-4000-8000-000000000042'::uuid,date_trunc('minute',now())+interval '2 days'))t(id,s);
update public.nurse_visit_settings set enabled=true;

create function pg_temp.nv_mark(p_sub text,p_item text,p_vals jsonb,p_expect boolean default null,p_bad jsonb default null)returns jsonb language sql as $$
 select public.nurse_visit_mark(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001','source','home-request','sourceId','c7700000-0000-4000-8000-000000000041',
  'submissionId',p_sub,'item',p_item,'done',true,'note',null,'values',p_vals)||case when p_expect is null then '{}'::jsonb else jsonb_build_object('expectUnmarked',p_expect)end||coalesce(p_bad,'{}'::jsonb))
$$;
grant execute on function pg_temp.nv_mark(text,text,jsonb,boolean,jsonb)to authenticated;
create temp table ex(label text primary key,v jsonb);
grant select,insert,update on ex to authenticated;
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000012','c7700000-0000-4000-8000-000000000032');
set local role authenticated;
-- Without the flag the visit flow is unchanged: a first mark saves, a second distinct mark replaces it (a new revision).
insert into ex values('plain-1',pg_temp.nv_mark('c7700000-0000-4000-8000-0000000000a1','measure:bp','{"systolic":120,"diastolic":80,"pulse":null}'));
insert into ex values('plain-2',pg_temp.nv_mark('c7700000-0000-4000-8000-0000000000a2','measure:bp','{"systolic":125,"diastolic":82,"pulse":null}'));
-- With the flag on a marked item: refused, nothing written; the replay of the first submission is still answered.
insert into ex values('flag-marked',pg_temp.nv_mark('c7700000-0000-4000-8000-0000000000a3','measure:bp','{"systolic":130,"diastolic":85,"pulse":null}',true));
insert into ex values('replay-first',pg_temp.nv_mark('c7700000-0000-4000-8000-0000000000a1','measure:bp','{"systolic":120,"diastolic":80,"pulse":null}',true));
-- With the flag on an unmarked item: saved; a retry of the same submission replays; another distinct submission on it is refused.
insert into ex values('flag-new',pg_temp.nv_mark('c7700000-0000-4000-8000-0000000000b1','measure:weight','{"value":82}',true));
insert into ex values('flag-new-replay',pg_temp.nv_mark('c7700000-0000-4000-8000-0000000000b1','measure:weight','{"value":82}',true));
insert into ex values('flag-new-other',pg_temp.nv_mark('c7700000-0000-4000-8000-0000000000b2','measure:weight','{"value":90}',true));
-- A false flag behaves like none; a non-boolean flag is invalid; unknown keys stay invalid.
insert into ex values('flag-false',pg_temp.nv_mark('c7700000-0000-4000-8000-0000000000c1','measure:weight','{"value":91}',false));
insert into ex values('flag-bad',pg_temp.nv_mark('c7700000-0000-4000-8000-0000000000c2','measure:waist','{"value":98}',null,'{"expectUnmarked":"yes"}'::jsonb));
insert into ex values('key-bad',pg_temp.nv_mark('c7700000-0000-4000-8000-0000000000c3','measure:waist','{"value":98}',null,'{"expectUnmarkedX":true}'::jsonb));
reset role;
select pg_temp.nv_assert((select v->>'status'='saved'and v->>'replayed'='false' from ex where label='plain-1'),'First mark without the flag saves');
select pg_temp.nv_assert((select v->>'status'='saved'and v->>'replayed'='false' from ex where label='plain-2'),'Without the flag a second distinct mark still replaces (visit flow unchanged)');
select pg_temp.nv_assert((select v->>'status'='already-marked' from ex where label='flag-marked'),'With the flag a marked item is refused');
select pg_temp.nv_assert((select count(*)=2 from public.nurse_visit_marks where item='measure:bp' and source_id='c7700000-0000-4000-8000-000000000041'),'Nothing was written for the refused reading');
select pg_temp.nv_assert((select v->>'status'='saved'and v->>'replayed'='true' from ex where label='replay-first'),'The replay of an earlier submission is answered before the precondition');
select pg_temp.nv_assert((select v->>'status'='saved'and v->>'replayed'='false' from ex where label='flag-new'),'With the flag an unmarked item saves');
select pg_temp.nv_assert((select v->>'status'='saved'and v->>'replayed'='true' from ex where label='flag-new-replay'),'A lost answer is safe to repeat with the flag');
select pg_temp.nv_assert((select v->>'status'='already-marked' from ex where label='flag-new-other'),'A distinct second reading with the flag is refused once the item is marked');
select pg_temp.nv_assert((select count(*)=2 from public.nurse_visit_marks where item='measure:weight' and source_id='c7700000-0000-4000-8000-000000000041'),'Only the first weight and the unflagged one exist');
select pg_temp.nv_assert((select v->>'status'='saved' from ex where label='flag-false'),'A false flag behaves like none');
select pg_temp.nv_assert((select v->>'status'='invalid' from ex where label='flag-bad'),'A non-boolean flag is invalid');
select pg_temp.nv_assert((select v->>'status'='invalid' from ex where label='key-bad'),'Unknown keys stay invalid');
-- Section All done uses a stricter precondition on the SAME visit lock and audit path.
-- These negative/comment marks model another nurse/tab winning the race before the bulk request.
create function pg_temp.nv_check(p_sub text,p_item text,p_done boolean default true,p_note text default null,p_expect jsonb default 'true'::jsonb)returns jsonb language sql volatile as $$
 select public.nurse_visit_mark(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001',
  'source','home-request','sourceId','c7700000-0000-4000-8000-000000000041','submissionId',p_sub,'item',p_item,'done',p_done,'note',p_note,'values',null,
  'checklistVersion','protocol-draft-2')||case when p_expect is null then '{}'::jsonb else jsonb_build_object('expectUnanswered',p_expect)end)
$$;
grant execute on function pg_temp.nv_check(text,text,boolean,text,jsonb)to authenticated;
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000012','c7700000-0000-4000-8000-000000000032');
set local role authenticated;
insert into ex values('negative',pg_temp.nv_check('c7700000-0000-4000-8000-0000000000d1','check:bp-cuff-fit',false,null,null));
insert into ex values('comment',pg_temp.nv_check('c7700000-0000-4000-8000-0000000000d2','check:bp-seated-rest',false,'Keep this comment',null));
insert into ex values('positive-comment',pg_temp.nv_check('c7700000-0000-4000-8000-0000000000d3','check:bp-conditions-medicines',true,'Keep this too',null));
insert into ex values('refuse-negative',pg_temp.nv_check('c7700000-0000-4000-8000-0000000000d4','check:bp-cuff-fit'));
insert into ex values('refuse-comment',pg_temp.nv_check('c7700000-0000-4000-8000-0000000000d5','check:bp-seated-rest'));
insert into ex values('refuse-positive-comment',pg_temp.nv_check('c7700000-0000-4000-8000-0000000000d6','check:bp-conditions-medicines'));
-- Unanswered item, exact replay and second submission. Refusals/replays add no audit row.
insert into ex values('unanswered',pg_temp.nv_check('c7700000-0000-4000-8000-0000000000d7','check:bp-validated-device'));
insert into ex values('unanswered-replay',pg_temp.nv_check('c7700000-0000-4000-8000-0000000000d7','check:bp-validated-device'));
insert into ex values('refuse-done',pg_temp.nv_check('c7700000-0000-4000-8000-0000000000d8','check:bp-validated-device'));
insert into ex values('unanswered-bad',pg_temp.nv_check('c7700000-0000-4000-8000-0000000000d9','check:bp-cuff-fit',true,null,'"yes"'));
insert into ex values('unanswered-null',pg_temp.nv_check('c7700000-0000-4000-8000-0000000000da','check:bp-cuff-fit',true,null,'null'::jsonb));
reset role;
select pg_temp.nv_assert((select bool_and(v->>'status'='saved')from ex where label in('negative','comment','positive-comment','unanswered')),'All four ordinary item marks save');
select pg_temp.nv_assert((select bool_and(v->>'status'='already-marked')from ex where label in('refuse-negative','refuse-comment','refuse-positive-comment','refuse-done')),'Expect unanswered refuses every kind of saved answer');
select pg_temp.nv_assert((select bool_and(v->>'status'='invalid')from ex where label in('unanswered-bad','unanswered-null')),'Expect unanswered accepts booleans only');
select pg_temp.nv_assert((select v->>'status'='saved'and v->>'replayed'='true'from ex where label='unanswered-replay'),'An exact lost-response replay precedes the unanswered guard');
select pg_temp.nv_assert((select count(*)=4 from public.nurse_visit_marks where source_id='c7700000-0000-4000-8000-000000000041'and item like 'check:%'),'Refused All done requests and replay write no marks');
select pg_temp.nv_assert(exists(select 1 from public.nurse_visit_marks where submission_id='c7700000-0000-4000-8000-0000000000d1'and not done and note is null),'A saved Not done without comment survives');
select pg_temp.nv_assert(exists(select 1 from public.nurse_visit_marks where submission_id='c7700000-0000-4000-8000-0000000000d2'and not done and note='Keep this comment'),'A saved negative comment survives');
select pg_temp.nv_assert(exists(select 1 from public.nurse_visit_marks where submission_id='c7700000-0000-4000-8000-0000000000d3'and done and note='Keep this too'),'A saved positive comment survives');
-- Audit shape/actor/time must match a single tap: one mark and one clinical audit event per item.
select pg_temp.nv_assert((select count(*)=4 from public.patient_clinical_case_events where user_id='c7700000-0000-4000-8000-000000000001'
 and detail->>'nurseVisit'='mark'and detail->>'item'like 'check:%'),'One care-evidence event per mark, no bulk audit events');
select pg_temp.nv_assert(not exists(select 1 from public.nurse_visit_marks m where m.item like 'check:%'and m.source_id='c7700000-0000-4000-8000-000000000041'
 and(m.actor_id<>'c7700000-0000-4000-8000-000000000012' or m.actor_name<>'Synthetic nurse one' or m.recorded_at is null or m.checklist_version<>'protocol-draft-2'
  or not exists(select 1 from public.patient_clinical_case_events e where e.user_id=m.member_id and e.kind='care-evidence'and e.actor_id=m.actor_id
   and e.detail=jsonb_build_object('nurseVisit','mark','source',m.source,'sourceId',m.source_id,'item',m.item,'done',m.done,'commented',m.note is not null,'markId',m.id,'submissionId',m.submission_id)))),
 'Bulk items use the single-tap actor, time, version and exact care-evidence detail');
-- Existing callers remain able to edit, including Undo and the false precondition.
set local role authenticated;
insert into ex values('unanswered-false',pg_temp.nv_check('c7700000-0000-4000-8000-0000000000db','check:bp-cuff-fit',true,null,'false'));
insert into ex values('legacy-negative',pg_temp.nv_mark('c7700000-0000-4000-8000-0000000000df','check:bp-seated-rest',null,true,'{"checklistVersion":"protocol-draft-2"}'));
insert into ex values('undo',pg_temp.nv_check('c7700000-0000-4000-8000-0000000000dc','check:bp-validated-device',false,null,null));
reset role;
select pg_temp.nv_assert((select bool_and(v->>'status'='saved')from ex where label in('unanswered-false','legacy-negative','undo')),'False/absent flag and legacy expectUnmarked keep explicit edits and Undo unchanged');
-- Another nurse and a member remain refused BEFORE the precondition is inspected.
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000013','c7700000-0000-4000-8000-000000000033');
set local role authenticated;
insert into ex values('other-nurse',pg_temp.nv_check('c7700000-0000-4000-8000-0000000000dd','check:bp-cuff-fit'));
reset role;
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000001','c7700000-0000-4000-8000-000000000035');
set local role authenticated;
insert into ex values('member',pg_temp.nv_check('c7700000-0000-4000-8000-0000000000de','check:bp-cuff-fit'));
reset role;
select pg_temp.nv_assert((select bool_and(v->>'status'='access')from ex where label in('other-nurse','member')),'Assignment and unauthorized caller refusals are unchanged');
select pg_temp.nv_assert((select count(*)=7 from public.nurse_visit_marks where source_id='c7700000-0000-4000-8000-000000000041'and item like 'check:%'),'Refused callers add no marks');
select pg_temp.nv_assert((select bool_and(provolatile='v')from pg_proc where oid in('public._nurse_visit_mark_as(uuid,uuid,bigint,jsonb)'::regprocedure,'public.nurse_visit_mark(jsonb)'::regprocedure)),
 'Writing helper and exposed RPC stay volatile (also covered by check-stable-functions-no-locks.sql)');
select pg_temp.nv_assert(not has_function_privilege('authenticated','public._nurse_visit_mark_as(uuid,uuid,bigint,jsonb)','execute')
 and has_function_privilege('authenticated','public.nurse_visit_mark(jsonb)','execute')
 and not has_function_privilege('anon','public.nurse_visit_mark(jsonb)','execute'),'Helper and exposed RPC grants are unchanged');
rollback;
\echo 'Nurse visit mark preconditions: expectUnmarked compatibility, expectUnanswered preservation, replay, audit, Undo and authorization'
