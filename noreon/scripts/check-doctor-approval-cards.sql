-- Fictional rolled-back risk path. Run only against a clean local replay, never hosted data.
\set ON_ERROR_STOP on
begin;
create function pg_temp.id(n int)returns uuid language sql immutable as $$select ('dc400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.actor(n int,r text default 'authenticated')returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role',r,'session_id',pg_temp.id(n+20),'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true)
$$;
create function pg_temp.fails(q text,code text)returns boolean language plpgsql as $$begin execute q;return false;exception when others then if sqlstate=code then return true;end if;raise;end$$;
insert into auth.users(id,phone,phone_confirmed_at)values(pg_temp.id(1),null,null),(pg_temp.id(2),null,null),(pg_temp.id(3),'37499098403',now());
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.id(n+20),pg_temp.id(n),now()-interval '1 hour',now()from generate_series(1,2)n;
insert into public.workspace_clinics(id,name)values(pg_temp.id(10),'Fictional approval clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.id(1),'doctor','Fictional doctor',pg_temp.id(10)),(pg_temp.id(2),'doctor','Other fictional doctor',pg_temp.id(10));
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values(pg_temp.id(3),pg_temp.id(1));
insert into public.patient_consents(user_id,version)values(pg_temp.id(3),'patient-pilot-v1');
insert into public.patient_assessments(user_id,revision,completed_at)values(pg_temp.id(3),3,now());
update public.member_first_note_settings set enabled=true;
update public.multi_medicine_capabilities set enabled=true;
create temp table shown(j jsonb);
grant all on shown to authenticated,service_role;
grant execute on function pg_temp.id(int),pg_temp.ok(boolean,text),pg_temp.actor(int,text),pg_temp.fails(text,text)to authenticated,service_role;
select pg_temp.actor(1);
set local role authenticated;
insert into shown select public.doctor_approval_cards_read(pg_temp.id(3));
reset role;
create function pg_temp.note(extra jsonb default '{}')returns jsonb language sql as $$select jsonb_build_object(
 'version','first-note-v1','memberId',pg_temp.id(3),'submissionId',pg_temp.id(30),'textEn','Exact fictional note.','textHy','Ճշգրիտ գրառում։',
 'builderVersion','first-note-1','sources','[]'::jsonb,'edited',true,'assessmentRevision',3)||extra$$;
create function pg_temp.approve(extra jsonb default '{}')returns jsonb language sql as $$
 select public.doctor_first_note_card_approve(pg_temp.note(extra),(j#>>'{snapshot,revision}')::bigint,j#>>'{snapshot,evidenceToken}',j->>'appointmentsRevision')from shown
$$;
grant execute on function pg_temp.note(jsonb),pg_temp.approve(jsonb)to authenticated;

-- Another assigned doctor cannot reuse this doctor's displayed context or read it.
select pg_temp.actor(2);
set local role authenticated;
select pg_temp.ok(pg_temp.approve()->>'status'='access','wrong doctor cannot approve');
select pg_temp.ok(pg_temp.fails('select public.doctor_approval_cards_read(pg_temp.id(3))','42501'),'wrong doctor cannot read');
reset role;
select pg_temp.actor(1);
set local role authenticated;
select pg_temp.ok(public.doctor_first_note_card_approve(pg_temp.note(),(j#>>'{snapshot,revision}')::bigint,null,j->>'appointmentsRevision')->>'status'='invalid','missing evidence rejected')from shown;
select pg_temp.ok(public.doctor_first_note_card_approve(pg_temp.note(),1+(j#>>'{snapshot,revision}')::bigint,j#>>'{snapshot,evidenceToken}',j->>'appointmentsRevision')->>'status'='stale','wrong case revision rejected')from shown;
select pg_temp.ok(public.doctor_first_note_card_approve(pg_temp.note(),(j#>>'{snapshot,revision}')::bigint,j#>>'{snapshot,evidenceToken}',repeat('0',32))->>'status'='stale','changed appointment revision rejected')from shown;
reset role;
savepoint changed_evidence;
update public.profiles set display_name='Changed fictional source'where id=pg_temp.id(3);
set local role authenticated;
select pg_temp.ok(pg_temp.approve()->>'status'='stale','changed source evidence rejected');
reset role;
rollback to changed_evidence;

-- Existing first-note normalisation must never silently change the card's displayed text.
set local role authenticated;
select pg_temp.ok(pg_temp.approve('{"textEn":"Exact  fictional note."}')->>'status'='invalid','normalised text requires review');
reset role;
select pg_temp.ok(not exists(select 1 from public.member_first_notes where user_id=pg_temp.id(3)),'normalisation refusal rolled back note');
create function pg_temp.fail_note_audit()returns trigger language plpgsql as $$begin
 if new.member_id=pg_temp.id(3)and new.surface='doctor_decisions'and new.object_id like 'first-note:%:approved'then raise exception using errcode='XX000',message='Synthetic audit failure';end if;return new;
end$$;
create trigger approval_audit_failure before insert on public.access_audit for each row execute function pg_temp.fail_note_audit();
set local role authenticated;
select pg_temp.ok(pg_temp.fails('select pg_temp.approve()','XX000'),'approval audit failure is a failed transaction');
reset role;
select pg_temp.ok(not exists(select 1 from public.member_first_notes where user_id=pg_temp.id(3)),'audit failure rolled back note');
drop trigger approval_audit_failure on public.access_audit;
set local role authenticated;
select pg_temp.ok(pg_temp.approve()->>'status'='approved','fresh exact note approved');
select pg_temp.ok(pg_temp.approve()->>'status'='already','second press adds no note');
reset role;
select pg_temp.ok((select count(*)=1 from public.member_first_notes where user_id=pg_temp.id(3)and text_en=pg_temp.note()->>'textEn'and text_hy=pg_temp.note()->>'textHy'and doctor_id=pg_temp.id(1)),'exact bilingual note and doctor saved once');
select pg_temp.ok((select count(*)=1 from public.access_audit where member_id=pg_temp.id(3)and surface='doctor_decisions'and object_id like 'first-note:%:approved'),'one approval audit');

-- Regimen cards use the existing publication transaction. This fixture exercises its risk path with the shown fields.
create temp table engine as select '{"version":"test-engine","urgency":"green","tests":[]}'::jsonb j;
grant select on engine to authenticated,service_role;
select pg_temp.actor(1,'service_role');
set local role service_role;
select public.prepare_patient_clinical_review(pg_temp.id(3),pg_temp.id(1),(j#>>'{snapshot,revision}')::bigint,j#>>'{snapshot,evidenceToken}',(select j from engine))from shown;
reset role;
select pg_temp.actor(1);
set local role authenticated;
delete from shown;insert into shown select public.doctor_approval_cards_read(pg_temp.id(3));
select public.command_patient_clinical_review(pg_temp.id(3),(j#>>'{snapshot,revision}')::bigint,j#>>'{snapshot,evidenceToken}','consultation-decision','{"decision":"not-required","note":"Fictional decision"}')from shown;
delete from shown;insert into shown select public.doctor_approval_cards_read(pg_temp.id(3));
select public.save_patient_clinical_draft(pg_temp.id(3),(j#>>'{snapshot,revision}')::bigint,j#>>'{snapshot,evidenceToken}',
 '{"explanation":"Fictional review","instructions":"Fictional instructions","followUp":"","medicationName":"","medicationDose":"","medicationInstructions":"","medicationTimes":[],"medicines":[{"name":"Fictional medicine","dose":"Fictional dose","instructions":"Fictional instructions","times":["09:00"]}]}')from shown;
delete from shown;insert into shown select public.doctor_approval_cards_read(pg_temp.id(3));
reset role;
create function pg_temp.publish(actor uuid default pg_temp.id(1),token text default null,revision bigint default null)returns uuid language sql as $$
 select public.publish_patient_clinical_regimen(pg_temp.id(3),actor,coalesce(revision,(j#>>'{snapshot,revision}')::bigint),coalesce(token,j#>>'{snapshot,evidenceToken}'),(select j from engine),pg_temp.id(40),'',j#>>'{regimen,draft,approvalHash}')from shown
$$;
grant execute on function pg_temp.publish(uuid,text,bigint)to service_role;
select pg_temp.actor(1,'service_role');
set local role service_role;
select pg_temp.ok(pg_temp.fails('select pg_temp.publish(pg_temp.id(2))','42501'),'wrong regimen doctor rejected');
select pg_temp.ok(pg_temp.fails('select pg_temp.publish(token=>repeat(''0'',32))','40001'),'stale regimen evidence rejected');
select pg_temp.ok(pg_temp.fails('select pg_temp.publish(revision=>-1)','40001'),'stale regimen revision rejected');
reset role;
savepoint missing_evidence;
update public.patient_clinical_cases set review=jsonb_set(review,'{engine,tests}','[{"id":"fictional-lab","title":"Fictional required test","method":"lab"}]'),draft_review_token=md5(jsonb_set(review,'{engine,tests}','[{"id":"fictional-lab","title":"Fictional required test","method":"lab"}]')::text)where user_id=pg_temp.id(3);
update engine set j=jsonb_set(j,'{tests}','[{"id":"fictional-lab","title":"Fictional required test","method":"lab"}]');
set local role service_role;
select pg_temp.ok(pg_temp.fails('select pg_temp.publish()','P0001'),'missing required evidence blocks publication');
reset role;
rollback to missing_evidence;
create function pg_temp.fail_publication_audit()returns trigger language plpgsql as $$begin
 if new.user_id=pg_temp.id(3)and new.kind='plan-published'then raise exception using errcode='XX000',message='Synthetic publication audit failure';end if;return new;
end$$;
create trigger publication_audit_failure before insert on public.patient_clinical_case_events for each row execute function pg_temp.fail_publication_audit();
set local role service_role;
select pg_temp.ok(pg_temp.fails('select pg_temp.publish()','XX000'),'publication audit failure rolls back');
reset role;
select pg_temp.ok(not exists(select 1 from public.patient_clinical_publications where user_id=pg_temp.id(3)),'no publication survives audit failure');
select pg_temp.ok(not exists(select 1 from public.patient_care_plans where user_id=pg_temp.id(3)),'no plan survives audit failure');
drop trigger publication_audit_failure on public.patient_clinical_case_events;
create temp table published(id uuid);
grant all on published to service_role;
set local role service_role;
insert into published select pg_temp.publish();
select pg_temp.ok(pg_temp.publish()=(select id from published),'second press replays the same plan');
reset role;
select pg_temp.ok((select count(*)=1 from public.patient_clinical_publications where user_id=pg_temp.id(3)),'one publication');
select pg_temp.ok((select r.medicines=shown.j#>'{regimen,draft,medicines}'from public.patient_care_plan_regimens r,shown where r.plan_id=(select id from published)),'exact shown medicines published');
select pg_temp.ok(not has_function_privilege('anon','public.doctor_first_note_card_approve(jsonb,bigint,text,text)','EXECUTE'),'anonymous approval denied');
select pg_temp.ok(not has_function_privilege('service_role','public.doctor_first_note_card_approve(jsonb,bigint,text,text)','EXECUTE'),'Zoe service role cannot approve first note');
rollback;
\echo doctor approval cards SQL: passed
