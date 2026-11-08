-- Results for a verified actor (20261030150000): the service read returns what the member's page reads and nothing else, only
-- the service role reaches it, and the session read of the publication is unchanged. Rolled back. Synthetic fixtures only.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.reads(m text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;j:=public.member_results_read_for(m::uuid);reset role;return j;end$$;
insert into auth.users(id,phone,phone_confirmed_at)values('b0000000-0000-4000-8000-000000000001','37499084001',now()),('b0000000-0000-4000-8000-000000000002','37499084002',now());
insert into public.patient_clinical_cases(user_id)values('b0000000-0000-4000-8000-000000000001'),('b0000000-0000-4000-8000-000000000002');
insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at)values
 ('b0000000-0000-4000-8000-0000000000a1','b0000000-0000-4000-8000-000000000001','Fictional doctor','Fictional only',now()-interval '2 days'),
 ('b0000000-0000-4000-8000-0000000000a2','b0000000-0000-4000-8000-000000000002','Fictional doctor','Fictional only',now()-interval '2 days');
set local session_replication_role=replica;
insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,publication_plan_id,reference_text)values
 ('b0000000-0000-4000-8000-000000000001','Fictional shown',1.5,'mmol/L',now()-interval '2 days',now(),'laboratory','Fictional',now(),'Fictional doctor','b0000000-0000-4000-8000-0000000000a1','below 1.4'),
 ('b0000000-0000-4000-8000-000000000001','Fictional not reviewed',9,'mmol/L',now()-interval '2 days',now(),'laboratory','Fictional',null,null,'b0000000-0000-4000-8000-0000000000a1',null),
 ('b0000000-0000-4000-8000-000000000001','Fictional not published',9,'mmol/L',now()-interval '2 days',now(),'laboratory','Fictional',now(),'Fictional doctor',null,null),
 ('b0000000-0000-4000-8000-000000000002','Fictional other member',9,'mmol/L',now()-interval '2 days',now(),'laboratory','Fictional',now(),'Fictional doctor','b0000000-0000-4000-8000-0000000000a2',null);
set local session_replication_role=origin;
select pg_temp.ok(jsonb_array_length(pg_temp.reads('b0000000-0000-4000-8000-000000000001')->'results')=1,'only the row the page shows');
select pg_temp.ok(pg_temp.reads('b0000000-0000-4000-8000-000000000001')#>>'{results,0,marker}'='Fictional shown','this member''s row');
select pg_temp.ok(pg_temp.reads('b0000000-0000-4000-8000-000000000001')#>>'{results,0,referenceText}'='below 1.4','with its reference');
select pg_temp.ok(pg_temp.reads('b0000000-0000-4000-8000-000000000001')->'publication'='null'::jsonb,'no publication');
select pg_temp.ok(pg_temp.reads('b0000000-0000-4000-8000-0000000000ff') is null,'an ineligible member reads nothing');
do $$begin
 perform set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 set local role authenticated;
 perform pg_temp.ok(public.patient_current_published_clinical_review() is null,'the session read still works');
 begin perform public.member_results_read_for('b0000000-0000-4000-8000-000000000002');raise exception 'FAIL: a member reached the service read';exception when insufficient_privilege then null;end;
 begin perform public._patient_current_published_clinical_review('b0000000-0000-4000-8000-000000000002');raise exception 'FAIL: a member reached the body';exception when insufficient_privilege then null;end;
 reset role;
end$$;
-- The plan read: this member's active published plan and its active medicines, nothing else.
create function pg_temp.plan(m text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;j:=public.member_plan_read_for(m::uuid);reset role;return j;end$$;
insert into public.patient_care_medications(user_id,plan_id,name,dose,instructions,times,start_date,active)values
 ('b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-0000000000a1','Fictional active','5 mg','Fictional only',array['08:00'::time],current_date-1,true),
 ('b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-0000000000a1','Fictional stopped','5 mg','Fictional only',array['08:00'::time],current_date-1,false),
 ('b0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-0000000000a2','Fictional other','5 mg','Fictional only',array['08:00'::time],current_date-1,true);
-- A medicine from an unpublished plan, linked to the published one, stays hidden, as own_published_care_medications hides it (Astra R3).
insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at,active)values('b0000000-0000-4000-8000-0000000000a3','b0000000-0000-4000-8000-000000000001','Fictional doctor','Fictional only',now()+interval '3 days',false);
insert into public.patient_care_medications(id,user_id,plan_id,name,dose,instructions,times,start_date,active)values('b0000000-0000-4000-8000-0000000000c1','b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-0000000000a3','Fictional unpublished','5 mg','Fictional only',array['08:00'::time],current_date-1,true);
insert into public.patient_care_plan_medications(plan_id,medication_id,user_id)values('b0000000-0000-4000-8000-0000000000a1','b0000000-0000-4000-8000-0000000000c1','b0000000-0000-4000-8000-000000000001');
select pg_temp.ok(not (pg_temp.plan('b0000000-0000-4000-8000-000000000001')::text like '%Fictional unpublished%'),'a medicine from an unpublished plan stays out of the plan read');
do $$declare j jsonb;begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;j:=public.member_plan_doses_read_for('b0000000-0000-4000-8000-000000000001');reset role;
 perform pg_temp.ok(not (j::text like '%Fictional unpublished%')and j::text like '%Fictional active%','and out of the dose read');
end$$;
-- A course that ended yesterday, Yerevan time, is not current; one ending today is (matching planSnapshot in the app, #417).
insert into public.patient_care_medications(user_id,plan_id,name,dose,instructions,times,start_date,end_date,active)values
 ('b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-0000000000a1','Fictional ended','5 mg','Fictional only',array['08:00'::time],current_date-9,(clock_timestamp()at time zone 'Asia/Yerevan')::date-1,true),
 ('b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-0000000000a1','Fictional last day','5 mg','Fictional only',array['08:00'::time],current_date-9,(clock_timestamp()at time zone 'Asia/Yerevan')::date,true);
select pg_temp.ok(not (pg_temp.plan('b0000000-0000-4000-8000-000000000001')::text like '%Fictional ended%'),'an ended course is not listed');
select pg_temp.ok(pg_temp.plan('b0000000-0000-4000-8000-000000000001')::text like '%Fictional last day%','a course ending today still is');
delete from public.patient_care_medications where name in('Fictional ended','Fictional last day');
select pg_temp.ok(pg_temp.plan('b0000000-0000-4000-8000-000000000001')#>>'{plan,clinician}'='Fictional doctor','the plan');
select pg_temp.ok(pg_temp.plan('b0000000-0000-4000-8000-000000000001')#>'{plan,review}'='null'::jsonb,'no publication reads as no review');
select pg_temp.ok(jsonb_array_length(pg_temp.plan('b0000000-0000-4000-8000-000000000001')#>'{plan,medicines}')=1,'its active medicine only');
select pg_temp.ok(pg_temp.plan('b0000000-0000-4000-8000-000000000001')#>>'{plan,medicines,0,name}'='Fictional active','this member''s');
select pg_temp.ok(pg_temp.plan('b0000000-0000-4000-8000-000000000001')#>>'{plan,medicines,0,times,0}'='08:00','with its time');
select pg_temp.ok(pg_temp.plan('b0000000-0000-4000-8000-0000000000ff') is null,'an ineligible member reads nothing');
update public.patient_care_plans set published_at=now()+interval '1 day' where user_id='b0000000-0000-4000-8000-000000000002';
select pg_temp.ok(pg_temp.plan('b0000000-0000-4000-8000-000000000002')->'plan'='null'::jsonb,'a plan not yet published reads as none');
do $$begin
 perform set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 set local role authenticated;
 begin perform public.member_plan_read_for('b0000000-0000-4000-8000-000000000001');raise exception 'FAIL: a member reached the plan read';exception when insufficient_privilege then null;end;
 reset role;
end$$;
-- The LDL read: the same answer as the member's session read, service role only.
create function pg_temp.ldl(m text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;j:=public.member_ldl_read_for(m::uuid);reset role;return j;end$$;
insert into public.ldl_goal_settings(singleton,ldl_goal_enabled)values(true,true)on conflict(singleton)do update set ldl_goal_enabled=true;
select pg_temp.ok(pg_temp.ldl('b0000000-0000-4000-8000-000000000001')->>'inPathway'='false','not in the pathway');
select pg_temp.ok(pg_temp.ldl('b0000000-0000-4000-8000-0000000000ff')->>'enabled'='false','an ineligible member reads as off');
do $$declare j jsonb;begin
 perform set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 set local role authenticated;
 j:=public.member_ldl_read();
 perform pg_temp.ok(j->>'inPathway'='false','the session read still works');
 begin perform public.member_ldl_read_for('b0000000-0000-4000-8000-000000000002');raise exception 'FAIL: a member reached the LDL service read';exception when insufficient_privilege then null;end;
 begin perform public._member_ldl_read('b0000000-0000-4000-8000-000000000002');raise exception 'FAIL: a member reached the LDL body';exception when insufficient_privilege then null;end;
 reset role;
end$$;
\echo 'check-zoe-cards-results: all passed'
rollback;
