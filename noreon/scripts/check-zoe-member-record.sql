-- What Zoe's context reads from the record (zoe_run_member_record): the worker only, while the switches are on, only the started
-- run's own member, only doctor-reviewed LDL values, and none of the doctor's notes. Fictional data, rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.u(n int)returns uuid language sql immutable as $$select('e1b70000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.read(run uuid)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;j:=public.zoe_run_member_record(array[run]);reset role;return j->0;end$$;
create function pg_temp.refused(role_ text)returns text language plpgsql as $$begin
 execute format('set local role %I',role_);perform public.zoe_run_member_record(array[pg_temp.u(31)]);reset role;return 'ran';
exception when others then reset role;return sqlstate;end$$;

set local session_replication_role=replica;
insert into auth.users(id)select pg_temp.u(n)from unnest(array[1,2,11])n;
insert into public.profiles(id,display_name,birth_date)values(pg_temp.u(1),'Fictional one',date '1968-03-01'),(pg_temp.u(2),'Fictional two',null)
 on conflict(id)do update set birth_date=excluded.birth_date;
insert into public.patient_clinical_cases(user_id)select pg_temp.u(n)from unnest(array[1,2])n on conflict do nothing;
insert into public.conversations(member_id)select pg_temp.u(n)from unnest(array[1,2])n on conflict do nothing;
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state)
 select pg_temp.u(30+n),c.id,c.member_id,1,1,0,current_date,'started' from public.conversations c,unnest(array[1,2])n where c.member_id=pg_temp.u(n);
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
 select pg_temp.u(33),c.id,c.member_id,2,1,0,current_date,'finished','answered','x',now()from public.conversations c where c.member_id=pg_temp.u(1);
insert into public.ldl_index_events(member_id,submission_id,event_type,event_on,source,note,recorded_by)
 values(pg_temp.u(1),gen_random_uuid(),'acs_mi',date '2026-07-01','document','FICTIONAL-EVENT-NOTE',pg_temp.u(11));
insert into public.ldl_index_events(member_id,submission_id,event_type,event_on,source,recorded_by,removed_at,removed_by)
 values(pg_temp.u(1),gen_random_uuid(),'tia',date '2026-09-01','document',pg_temp.u(11),now(),pg_temp.u(11));
insert into public.ldl_lipid_therapies(member_id,submission_id,drug,dose,started_on,maximally_tolerated,recorded_by)values(pg_temp.u(1),gen_random_uuid(),'atorvastatin','40 mg',date '2026-07-03',true,pg_temp.u(11));
insert into public.ldl_lipid_therapies(member_id,submission_id,drug,dose,recorded_by,ended_at,ended_by,end_reason)values(pg_temp.u(1),gen_random_uuid(),'simvastatin','10 mg',pg_temp.u(11),now(),pg_temp.u(11),'stopped');
insert into public.ldl_goals(member_id,version,submission_id,category,threshold_mmol,reduction_rule,baseline_kind,next_test_on,reason,defaults_version,set_by)
 values(pg_temp.u(1),1,gen_random_uuid(),'very_high',1.4,false,'unknown',date '2026-12-01','FICTIONAL-GOAL-REASON','ldl-defaults-2026-10-29',pg_temp.u(11));
insert into public.member_reported_values(user_id,measure,value,unit,measured_on,source)values(pg_temp.u(1),'ldl_c',1.1,'mmol/L',current_date-1,'member-reported');
insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source_label,source,reviewed_at,reviewed_by)values(pg_temp.u(1),'LDL-C',2.4,'mmol/L',now()-interval '5 days',now()-interval '4 days','Fictional lab','laboratory',now(),pg_temp.u(11));
insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source_label,source)values(pg_temp.u(1),'LDL-C',9.9,'mmol/L',now()-interval '1 day',now(),'Fictional lab','laboratory');
insert into public.zoe_settings(singleton,health_answers_enabled)values(true,true)on conflict(singleton)do update set health_answers_enabled=true;
update public.ldl_goal_settings set ldl_goal_enabled=true where singleton;
set local session_replication_role=origin;

-- The worker only.
select pg_temp.ok(pg_temp.refused('authenticated')='42501'and pg_temp.refused('anon')='42501','members and anon cannot call it');

-- The record, and what stays out of it.
do $$declare j jsonb:=pg_temp.read(pg_temp.u(31));o jsonb:=j->'ldl'->'observations';begin
 perform pg_temp.ok((j->>'enabled')::boolean,'on');
 perform pg_temp.ok((j->>'ageYears')::int between 57 and 59,'age in years');perform pg_temp.ok(j::text !~ '1968','never the birth date');
 perform pg_temp.ok(j->'ldl'->'goal'->>'thresholdMmol'='1.4','the confirmed goal');
 perform pg_temp.ok(jsonb_array_length(o)=1 and o->0->>'value'='2.4','only the reviewed value: no unreviewed result, no member entry');
 perform pg_temp.ok(j->'ldl'->'event'->>'type'='acs_mi','the removed event is gone');
 perform pg_temp.ok(jsonb_array_length(j->'ldl'->'therapies')=1 and j->'ldl'->'therapies'->0->>'drug'='atorvastatin','the ended therapy is gone');
 perform pg_temp.ok(j->'ldl'->>'nextTestOn'='2026-12-01','next test');
 perform pg_temp.ok(j::text !~ 'FICTIONAL-|maximally|reason','no notes, no reason, no doctor-only field');
end$$;

-- Where the member stands: their own questionnaire and their next booked time, in Yerevan, whichever booking table holds it.
insert into public.patient_assessments(user_id,answers,completed_at)values(pg_temp.u(1),'{"q1.age":{"fieldId":"q1.age","value":58}}',now())
 on conflict(user_id)do update set answers=excluded.answers,completed_at=excluded.completed_at;
insert into public.patient_care_appointments(user_id,specialty,location,starts_at,status)values(pg_temp.u(1),'cardiology','Fictional clinic',timestamptz '2099-03-02 06:30+00','confirmed'),
 (pg_temp.u(1),'cardiology','Fictional clinic',timestamptz '2098-01-01 06:30+00','cancelled'),(pg_temp.u(1),'cardiology','Fictional clinic',timestamptz '2020-01-01 06:30+00','confirmed');
do $$declare j jsonb:=pg_temp.read(pg_temp.u(31));begin
 perform pg_temp.ok((j->'questionnaire'->>'completed')::boolean and j->'questionnaire'->'answers'?'q1.age','the member''s own questionnaire');
 perform pg_temp.ok(j->'nextVisit'->>'at'='2099-03-02 10:30','the next confirmed visit in Yerevan time, not a cancelled or past one');
 perform pg_temp.ok(j::text !~ 'Fictional clinic','no location');
end$$;
do $$declare j jsonb:=pg_temp.read(pg_temp.u(32));begin perform pg_temp.ok(j->'nextVisit'='null'::jsonb,'no visit is null, and nothing from another member');
 perform pg_temp.ok(j->'questionnaire'='{"completed":false,"answers":{}}'::jsonb,'no assessment row: not started, not null');end$$;
-- The source of the run's own message: Telegram keeps its cards.
do $$begin perform pg_temp.ok(not((pg_temp.read(pg_temp.u(31)))->>'viaTelegram')::boolean,'no such message: not Telegram');end$$;
insert into public.conversation_messages(conversation_id,author_id,body,source,request_id,seq)select r.conversation_id,r.member_id,'Fictional','telegram_member',gen_random_uuid(),r.message_seq from public.zoe_runs r where r.id=pg_temp.u(31);
do $$begin perform pg_temp.ok(((pg_temp.read(pg_temp.u(31)))->>'viaTelegram')::boolean,'the run''s message came by Telegram');perform pg_temp.ok(not((pg_temp.read(pg_temp.u(32)))->>'viaTelegram')::boolean,'another member''s run does not');end$$;

-- Unknown stays unknown: nothing on record is null, never a value.
do $$declare j jsonb:=pg_temp.read(pg_temp.u(32));begin
 perform pg_temp.ok(j->'ageYears'='null'::jsonb,'no birth date, no age');
 perform pg_temp.ok(j->'ldl'->'goal'='null'::jsonb and j->'ldl'->'event'='null'::jsonb and j->'ldl'->'nextTestOn'='null'::jsonb and j->'ldl'->'therapies'='[]'::jsonb and j->'ldl'->'observations'='[]'::jsonb,'nothing invented');
 perform pg_temp.ok((j->'ldl')::text !~ '2\.4|1\.4','nothing from another member');
end$$;

-- A finished run reads nothing; the switches turn it off.
select pg_temp.ok(pg_temp.read(pg_temp.u(33)) is null,'a finished run');
update public.ldl_goal_settings set ldl_goal_enabled=false where singleton;
select pg_temp.ok((pg_temp.read(pg_temp.u(31)))->'ldl'='null'::jsonb,'the LDL flag off: no LDL fields');
update public.zoe_settings set health_answers_enabled=false where singleton;
do $$declare j jsonb:=pg_temp.read(pg_temp.u(31));begin perform pg_temp.ok(j->'questionnaire'='null'::jsonb and j->'nextVisit'='null'::jsonb,'health answers off: no status');perform pg_temp.ok(not(j->>'enabled')::boolean and j->'ageYears'='null'::jsonb and j->'medicines'='null'::jsonb,'health answers off: nothing');end$$;
rollback;
