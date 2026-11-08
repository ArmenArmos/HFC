-- Fictional rolled-back risk path, for a clean local replay only. Never hosted data.
\set ON_ERROR_STOP on
begin;
create function pg_temp.id(n int)returns uuid language sql immutable as $$select ('dc500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.actor(n int,r text default 'authenticated')returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role',r,'session_id',pg_temp.id(n+1000),'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true)
$$;
create function pg_temp.denied(q text)returns boolean language plpgsql as $$begin execute q;return false;exception when insufficient_privilege then return true;end$$;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),case when n=3 then '37499098503'end,case when n=3 then now()end
 from unnest(array[1,2,3,4,5])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.id(n+1000),pg_temp.id(n),now()-interval '1 hour',now()from generate_series(1,5)n;
insert into public.workspace_clinics(id,name)values(pg_temp.id(10),'Fictional saved-plan clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.id(1),'doctor','Fictional doctor',pg_temp.id(10)),(pg_temp.id(2),'doctor','Other fictional doctor',pg_temp.id(10)),
 (pg_temp.id(5),'nurse','Fictional nurse',pg_temp.id(10));
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values(pg_temp.id(3),pg_temp.id(1)),(pg_temp.id(4),pg_temp.id(2));
update public.profiles set display_name='Fictional saved member'where id=pg_temp.id(3);
insert into public.patient_consents(user_id,version)values(pg_temp.id(3),'patient-pilot-v1');
insert into public.patient_assessments(user_id,revision,completed_at)values(pg_temp.id(3),3,now());
create temp table context(j jsonb);
create temp table result(j jsonb);
create temp table engine as select '{"version":"test-engine","urgency":"green","tests":[]}'::jsonb j;
grant all on context,result,engine to authenticated,service_role;
grant execute on all functions in schema pg_temp to authenticated,service_role,anon;
create function pg_temp.read_saved()returns void language plpgsql as $$begin
 delete from result;insert into result select public.doctor_saved_plans();
end$$;
create function pg_temp.snapshot()returns void language plpgsql as $$begin
 delete from context;insert into context select public.patient_clinical_case_snapshot(pg_temp.id(3));
end$$;
grant execute on function pg_temp.read_saved(),pg_temp.snapshot()to authenticated;
select pg_temp.actor(1);
set local role authenticated;
select pg_temp.read_saved();
select pg_temp.ok(j->'items'='[]'and(j->>'total')::int=0,'unsaved cases absent')from result;
select pg_temp.snapshot();
reset role;
-- Use the actual preparation, save and publication commands for the primary lifecycle.
select pg_temp.actor(1,'service_role');
set local role service_role;
select public.prepare_patient_clinical_review(pg_temp.id(3),pg_temp.id(1),(j->>'revision')::bigint,j->>'evidenceToken',(select j from engine))from context;
reset role;
select pg_temp.actor(1);
set local role authenticated;
select pg_temp.snapshot();
select public.command_patient_clinical_review(pg_temp.id(3),(j->>'revision')::bigint,j->>'evidenceToken','consultation-decision','{"decision":"not-required","note":"Fictional decision"}')from context;
select pg_temp.snapshot();
select public.save_patient_clinical_draft(pg_temp.id(3),(j->>'revision')::bigint,j->>'evidenceToken',
 '{"explanation":"Fictional explanation","instructions":"Fictional instructions","followUp":"","medicationName":"","medicationDose":"","medicationInstructions":"","medicationTimes":[]}')from context;
select pg_temp.read_saved();
select pg_temp.ok((j->>'total')::int=1 and j#>>'{items,0,memberId}'=pg_temp.id(3)::text
 and j#>>'{items,0,memberName}'='Fictional saved member'and j#>>'{items,0,savedAt}'is not null,'own saved plan shown with name and save time')from result;
reset role;
select pg_temp.ok((select count(*)=1 from public.access_audit where member_id=pg_temp.id(3)and surface='doctor_saved_plans'),'shown member audited once');
select pg_temp.actor(2);
set local role authenticated;
select pg_temp.read_saved();
select pg_temp.ok(j->'items'='[]'and(j->>'total')::int=0,'other doctor cannot see own saved plan')from result;
select pg_temp.ok(pg_temp.denied('select public.doctor_approval_cards_read(pg_temp.id(3))'),'other doctor cannot open approval');
reset role;
select pg_temp.actor(5);
set local role authenticated;
select pg_temp.ok(pg_temp.denied('select public.doctor_saved_plans()'),'nurse refused');
reset role;
select pg_temp.actor(3);
set local role authenticated;
select pg_temp.ok(pg_temp.denied('select public.doctor_saved_plans()'),'member refused');
reset role;
select pg_temp.ok(not has_function_privilege('anon','public.doctor_saved_plans()','EXECUTE')
 and not has_function_privilege('service_role','public.doctor_saved_plans()','EXECUTE'),'anonymous and service roles have no grant');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(1),'role','authenticated')::text,true);
set local role authenticated;
select pg_temp.ok(pg_temp.denied('select public.doctor_saved_plans()'),'doctor without managed session refused');
reset role;

-- Dedup is precisely the inbox source predicate, including disabled/adopted AI.
update public.ai_plan_capabilities set enabled=true;
insert into public.ai_plan_generations(id,user_id,doctor_id,case_revision,evidence_token,lab_token,input_sha256,prompt_version,builder_version,language,tier,model,local,spend_day,estimate_usd,reserved,state,mode,draft,items,finished_at,created_at)values
 (pg_temp.id(20),pg_temp.id(3),pg_temp.id(1),0,repeat('a',32),public._ai_plan_lab_token(pg_temp.id(3)),repeat('b',64),
 'ai-plan-prompt-3','ai-plan-builder-2','en','high','noreon-protocol-1',true,current_date,0,true,'reserved',null,null,null,null,now()-interval '1 hour');
update public.ai_plan_generations set state='ready',mode='model',draft='{"explanation":"Fictional."}',items='[]',finished_at=now()where id=pg_temp.id(20);
select pg_temp.actor(1);
set local role authenticated;
select pg_temp.read_saved();
select pg_temp.ok((j->>'total')::int=0,'current inbox AI plan deduplicated')from result;
reset role;
update public.ai_plan_capabilities set enabled=false;
set local role authenticated;
select pg_temp.read_saved();
select pg_temp.ok((j->>'total')::int=1,'disabled AI does not hide saved plan')from result;
reset role;
update public.ai_plan_capabilities set enabled=true;
update public.ai_plan_generations set adopted_at=now(),adopted_by=pg_temp.id(1),adopted_fields='{explanation}'where id=pg_temp.id(20);
set local role authenticated;
select pg_temp.read_saved();
select pg_temp.ok((j->>'total')::int=1,'adopted AI no longer hides saved plan')from result;
select pg_temp.snapshot();
reset role;
select pg_temp.actor(1,'service_role');
set local role service_role;
select public.publish_patient_clinical_plan(pg_temp.id(3),pg_temp.id(1),(j->>'revision')::bigint,j->>'evidenceToken',(select j from engine),pg_temp.id(30))from context;
reset role;
select pg_temp.actor(1);
set local role authenticated;
select pg_temp.read_saved();
select pg_temp.ok((j->>'total')::int=0,'publication consumes saved plan')from result;
reset role;
-- A later review edit must not turn the retained, published save back into pending work.
savepoint changed_review;
update public.patient_clinical_cases set review=review||'{"fictionalChangedReview":true}'::jsonb where user_id=pg_temp.id(3);
set local role authenticated;
select pg_temp.read_saved();
select pg_temp.ok((j->>'total')::int=0,'later review edit does not resurrect consumed save')from result;
reset role;
rollback to changed_review;
-- Reassignment clears the save's tokens and keeps its text: that must not bring a published draft back (Astra DP-01).
savepoint reassigned;
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.id(2)where user_id=pg_temp.id(3);
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.id(1)where user_id=pg_temp.id(3);
set local role authenticated;
select pg_temp.read_saved();
select pg_temp.ok((j->>'total')::int=0,'reassignment does not resurrect a consumed save')from result;
reset role;
-- The same text saved after that publication is new work, and reassignment must not hide it.
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.id(2)where user_id=pg_temp.id(3);
update public.patient_clinical_cases set draft_saved_by=pg_temp.id(2),draft_saved_at=clock_timestamp()where user_id=pg_temp.id(3);
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.id(1)where user_id=pg_temp.id(3);
set local role authenticated;
select pg_temp.read_saved();
select pg_temp.ok((j->>'total')::int=1,'identical text saved after publication stays visible through reassignment')from result;
reset role;
rollback to reassigned;
savepoint retired_plan;
update public.patient_care_plans set active=false,retired_at=now()where user_id=pg_temp.id(3)and active;
set local role authenticated;
select pg_temp.read_saved();
select pg_temp.ok((j->>'total')::int=0,'retirement does not resurrect consumed save')from result;
reset role;
rollback to retired_plan;
-- Resaving the unchanged publication must not manufacture pending approval work.
set local role authenticated;
select pg_temp.snapshot();
select public.save_patient_clinical_draft(pg_temp.id(3),(j->>'revision')::bigint,j->>'evidenceToken',j->'draft')from context;
select pg_temp.read_saved();
select pg_temp.ok((j->>'total')::int=0,'unchanged published resave remains consumed')from result;
reset role;
-- A genuinely edited saved draft on that same case is pending work again.
set local role authenticated;
select pg_temp.snapshot();
select public.save_patient_clinical_draft(pg_temp.id(3),(j->>'revision')::bigint,j->>'evidenceToken',j->'draft'||'{"instructions":"Edited fictional instructions"}'::jsonb)from context;
select pg_temp.read_saved();
select pg_temp.ok((j->>'total')::int=1,'newly edited save after publication returns')from result;
reset role;
savepoint new_saved_review;
update public.patient_clinical_cases set review=review||'{"fictionalNewSavedReview":true}'::jsonb where user_id=pg_temp.id(3);
set local role authenticated;
select pg_temp.snapshot();
select public.save_patient_clinical_draft(pg_temp.id(3),(j->>'revision')::bigint,j->>'evidenceToken',j->'draft')from context;
select pg_temp.read_saved();
select pg_temp.ok((j->>'total')::int=1,'changed draft and new saved review remain pending despite older publication')from result;
reset role;
rollback to new_saved_review;

-- A bounded page includes a truthful total and deterministic oldest-first ordering.
-- Synthetic additional rows model already-saved records, without invoking clinical commands 51 times.
insert into auth.users(id)select pg_temp.id(n)from generate_series(100,150)n;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,draft,draft_saved_by,draft_saved_at)
 select pg_temp.id(n),pg_temp.id(1),'{}'::jsonb,pg_temp.id(1),now()-interval '2 days'+n*interval '1 minute'from generate_series(100,150)n;
select pg_temp.actor(1);
create temp table audit_before as select count(*)n from public.access_audit where surface='doctor_saved_plans';
set local role authenticated;
select pg_temp.read_saved();
select pg_temp.ok((j->>'total')::int=52 and(j->>'cap')::int=50 and jsonb_array_length(j->'items')=50,'cap preserves full total')from result;
select pg_temp.ok(j#>>'{items,0,memberId}'=pg_temp.id(100)::text and j#>>'{items,49,memberId}'=pg_temp.id(149)::text,'oldest first with deterministic ids')from result;
reset role;
select pg_temp.ok((select count(*)from public.access_audit where surface='doctor_saved_plans')=(select n+50 from audit_before),'only displayed capped members audited');
rollback;
\echo doctor saved plans SQL: passed
