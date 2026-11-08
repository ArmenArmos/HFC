-- Plan doses for a verified actor (20261030114209): the service entry point follows the plan's own rules, only the service
-- role reaches it, the member is who the history names, and the read returns what the page reads and nothing of others'.
-- Rolled back. Synthetic fixtures only.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.report(m text,med text,due timestamptz,st text,rev bigint)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.report_patient_dose_for(m::uuid,med::uuid,due,st,rev);reset role;return j;end$$;
create function pg_temp.reads(m text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.member_plan_doses_read_for(m::uuid);reset role;return j;end$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;

insert into auth.users(id,phone,phone_confirmed_at)values('ae000000-0000-4000-8000-000000000001','37499082001',now()),('ae000000-0000-4000-8000-000000000002','37499082002',now());
insert into public.patient_clinical_cases(user_id)values('ae000000-0000-4000-8000-000000000001'),('ae000000-0000-4000-8000-000000000002');
insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at)values
 ('ae000000-0000-4000-8000-0000000000b1','ae000000-0000-4000-8000-000000000001','Fictional doctor','Fictional only',now()-interval '2 days'),
 ('ae000000-0000-4000-8000-0000000000b2','ae000000-0000-4000-8000-000000000002','Fictional doctor','Fictional only',now()-interval '2 days');
insert into kv values('time',to_jsonb(to_char((clock_timestamp()-interval '5 minutes')at time zone 'Asia/Yerevan','HH24:MI')));
insert into public.patient_care_medications(id,user_id,plan_id,name,dose,instructions,times,start_date)
 select 'ae000000-0000-4000-8000-0000000000a1'::uuid,'ae000000-0000-4000-8000-000000000001'::uuid,'ae000000-0000-4000-8000-0000000000b1'::uuid,'Fictional A','5 mg','Fictional only',array[(v#>>'{}')::time],current_date-3 from kv where k='time'
 union all select 'ae000000-0000-4000-8000-0000000000a2'::uuid,'ae000000-0000-4000-8000-000000000002'::uuid,'ae000000-0000-4000-8000-0000000000b2'::uuid,'Fictional B','5 mg','Fictional only',array[(v#>>'{}')::time],current_date-3 from kv where k='time';
insert into kv values('due',to_jsonb(public._member_medicine_due((clock_timestamp()at time zone 'Asia/Yerevan')::date,(select (v#>>'{}')::time from kv where k='time'))));
create function pg_temp.due()returns timestamptz language sql as $$select (v#>>'{}')::timestamptz from kv where k='due'$$;

-- Only the service role. A member cannot name a member here, not even themself.
do $$begin
 perform set_config('request.jwt.claims','{"sub":"ae000000-0000-4000-8000-000000000001","role":"authenticated"}',true);set local role authenticated;
 begin perform public.report_patient_dose_for('ae000000-0000-4000-8000-000000000002','ae000000-0000-4000-8000-0000000000a2',now(),'taken',0);raise exception 'FAIL: member reported for another';exception when insufficient_privilege then null;end;
 begin perform public.member_plan_doses_read_for('ae000000-0000-4000-8000-000000000002');raise exception 'FAIL: member read for another';exception when insufficient_privilege then null;end;
 reset role;
 perform pg_temp.as_service();set local role service_role;
 begin perform public._report_patient_dose_versioned('ae000000-0000-4000-8000-000000000001','ae000000-0000-4000-8000-0000000000a1',now(),'taken',0);raise exception 'FAIL: internal function reachable';exception when insufficient_privilege then null;end;
 reset role;
end$$;

-- The read: this member's plan and medicines, nothing else.
select pg_temp.ok(j#>>'{plan,id}'='ae000000-0000-4000-8000-0000000000b1' and j#>>'{plan,medications,0,id}'='ae000000-0000-4000-8000-0000000000a1' and jsonb_array_length(j#>'{plan,medications}')=1 and j->'events'='[]'::jsonb and (j->>'offset')::int=0,'the member''s own plan')
 from(select pg_temp.reads('ae000000-0000-4000-8000-000000000001')j)x;

-- Saved, replayed, corrected, conflicted; the same rules as the session report.
select pg_temp.ok(j->>'status'='saved' and (j->>'revision')::bigint=1,'saved')from(select pg_temp.report('ae000000-0000-4000-8000-000000000001','ae000000-0000-4000-8000-0000000000a1',pg_temp.due(),'taken',0)j)x;
select pg_temp.ok(pg_temp.report('ae000000-0000-4000-8000-000000000001','ae000000-0000-4000-8000-0000000000a1',pg_temp.due(),'taken',0)->>'status'='saved','a retry of the same answer replays');
select pg_temp.ok((select count(*)=1 from public.patient_dose_events where medication_id='ae000000-0000-4000-8000-0000000000a1'),'one event');
select pg_temp.ok((select recorded_by='ae000000-0000-4000-8000-000000000001' from public.patient_dose_event_history where medication_id='ae000000-0000-4000-8000-0000000000a1' and kind='report' order by revision desc limit 1),'the history names the member, not nobody');
select pg_temp.ok(pg_temp.report('ae000000-0000-4000-8000-000000000001','ae000000-0000-4000-8000-0000000000a1',pg_temp.due(),'skipped',0)->>'status'='conflict','the other answer at an old revision conflicts');
select pg_temp.ok((select status='taken' from public.patient_dose_events where medication_id='ae000000-0000-4000-8000-0000000000a1'),'and changes nothing');
select pg_temp.ok(jsonb_array_length(pg_temp.reads('ae000000-0000-4000-8000-000000000001')->'events')=1,'the read shows it');
-- Outside the schedule, and another member's medicine: nothing written, a plain status.
select pg_temp.ok(pg_temp.report('ae000000-0000-4000-8000-000000000001','ae000000-0000-4000-8000-0000000000a1',pg_temp.due()+interval '1 minute','taken',0)->>'status'='not-due','a time not on the schedule');
select pg_temp.ok(pg_temp.report('ae000000-0000-4000-8000-000000000001','ae000000-0000-4000-8000-0000000000a2',pg_temp.due(),'taken',0)->>'status'='not-due','another member''s medicine');
select pg_temp.ok(not exists(select 1 from public.patient_dose_events where medication_id='ae000000-0000-4000-8000-0000000000a2'),'nothing written for B');
select pg_temp.ok(pg_temp.report('ae000000-0000-4000-8000-000000000001','ae000000-0000-4000-8000-0000000000a1',pg_temp.due(),'maybe',0)->>'status'='invalid','an unknown answer');
-- Ineligible: no write, no read.
update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='ae000000-0000-4000-8000-000000000002';
select pg_temp.ok(pg_temp.report('ae000000-0000-4000-8000-000000000002','ae000000-0000-4000-8000-0000000000a2',pg_temp.due(),'taken',0)->>'status'='disabled','banned: no write');
select pg_temp.ok(pg_temp.reads('ae000000-0000-4000-8000-000000000002') is null,'banned: no read');
update auth.users set banned_until=null where id='ae000000-0000-4000-8000-000000000002';
-- The session path is unchanged and still writes its own actor.
do $$declare r bigint;begin
 perform set_config('request.jwt.claims','{"sub":"ae000000-0000-4000-8000-000000000002","role":"authenticated"}',true);set local role authenticated;
 r:=public.report_patient_dose_versioned('ae000000-0000-4000-8000-0000000000a2',pg_temp.due(),'skipped',0);
 perform pg_temp.ok(r=1,'the session report still saves');
 begin perform public.report_patient_dose_versioned('ae000000-0000-4000-8000-0000000000a1',pg_temp.due(),'skipped',1);raise exception 'FAIL: session wrote another member''s';exception when raise_exception then if sqlerrm<>'medication unavailable' then raise;end if;end;
 reset role;
end$$;
-- No plan: an empty list, not an error.
update public.patient_care_plans set active=false where id='ae000000-0000-4000-8000-0000000000b2';
select pg_temp.ok(pg_temp.reads('ae000000-0000-4000-8000-000000000002')->'plan'='null'::jsonb,'no current plan');

rollback;
\echo ok zoe cards plan doses
