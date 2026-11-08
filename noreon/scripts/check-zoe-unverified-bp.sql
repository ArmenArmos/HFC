-- Typed BP stays visible safety evidence, excluded from measured summaries.
-- Synthetic fixtures only; no delivery and every write is rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.msg(m uuid,seq bigint,mins integer)returns uuid language plpgsql as $$declare c uuid;r uuid;begin
 select id into c from public.conversations where member_id=m;
 if c is null then insert into public.conversations(member_id)values(m)returning id into c;end if;
 insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id,created_at)
 values(c,seq,m,'Synthetic BP observation','authenticated_member',gen_random_uuid(),clock_timestamp()-make_interval(mins=>mins));
 insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,state,spend_day)
 values(c,m,seq,0,0,'started',current_date)returning id into r;return r;end$$;
create function pg_temp.save(r uuid,seq bigint,s integer,d integer)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_bp_typed_save(r,seq,0,s,d);reset role;return j;end$$;
insert into auth.users(id,phone,phone_confirmed_at)values
 ('b3000000-0000-4000-8000-000000000001','37499093001',now()),('b3000000-0000-4000-8000-000000000002','37499093002',now()),
 ('b3000000-0000-4000-8000-000000000003','37499093003',now()),('b3000000-0000-4000-8000-000000000011',null,null),('b3000000-0000-4000-8000-000000000012',null,null);
insert into public.workspace_clinics(id,name)values('b3000000-0000-4000-8000-000000000020','Synthetic BP clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('b3000000-0000-4000-8000-000000000011','nurse','Synthetic Nurse','b3000000-0000-4000-8000-000000000020'),
 ('b3000000-0000-4000-8000-000000000012','nurse','Other Nurse','b3000000-0000-4000-8000-000000000020');
insert into auth.sessions(id,user_id,created_at,updated_at)values
 ('b3000000-0000-4000-8000-000000000031','b3000000-0000-4000-8000-000000000011',now(),now()),
 ('b3000000-0000-4000-8000-000000000032','b3000000-0000-4000-8000-000000000012',now(),now());
insert into public.patient_clinical_cases(user_id)values('b3000000-0000-4000-8000-000000000001'),('b3000000-0000-4000-8000-000000000002'),('b3000000-0000-4000-8000-000000000003');
update public.profiles set is_test_account=true where id='b3000000-0000-4000-8000-000000000001';
insert into public.care_alert_settings(enabled,telegram_delivery,sandbox_test_accounts)values(true,false,true)
 on conflict(singleton)do update set enabled=true,telegram_delivery=false,sandbox_test_accounts=true;
-- The clean schema has no settings row. Enable this read fixture only, as in
-- check-zoe-member-record.sql; model activation/eval guards are tested elsewhere.
set local session_replication_role=replica;
insert into public.zoe_settings(singleton,health_answers_enabled)values(true,true)
 on conflict(singleton)do update set health_answers_enabled=true;
set local session_replication_role=origin;

-- Boundary, low DBP, replay, no care team, original quiet note identity.
do $$declare m uuid:='b3000000-0000-4000-8000-000000000001';r uuid;mid uuid;t public.care_queue_tasks;j jsonb;begin
 r:=pg_temp.msg(m,1,12);perform pg_temp.save(r,1,179,120);
 perform pg_temp.ok(not exists(select 1 from public.care_queue_tasks where member_id=m),'SBP179 does not create a verification task for any DBP');
 r:=pg_temp.msg(m,2,6);j:=pg_temp.save(r,2,180,60);
 select id into mid from public.patient_measurements where user_id=m and systolic=180;
 select * into strict t from public.care_queue_tasks where member_id=m;
 perform pg_temp.ok(t.queue='nurse'and t.sandbox and t.status='sent'and t.source_ref='typed-bp:'||mid::text,'SBP180 low DBP persists one nurse task even before assignment');
 perform pg_temp.ok(t.zone is null and t.sla_deadline is null and t.red_flags_status is null,'verification task assigns no clinical urgency or deadline');
 perform pg_temp.ok(t.summary->>'text'='Check reported BP 180/60 mmHg. Member-reported, not verified','task text includes exact value and verification warning');
 -- Prior high DBP can make this a clinical repeat; link its existing alert, never a copy.
 perform pg_temp.ok((t.summary->>'alertId')::uuid=(select alert_id from public.care_alert_screenings where member_id=m and source='reading'and source_ref=mid::text),'task links existing clinical repeat alert');
 perform pg_temp.save(r,2,180,60);perform public._typed_bp_task((select p from public.patient_measurements p where id=mid));
 perform pg_temp.ok((select count(*)=1 from public.care_queue_tasks where member_id=m),'save and task replay remain idempotent');
 perform pg_temp.ok((select count(*)=1 from public.care_queue_task_events where task_id=t.id and from_status is null),'one creation event');
 -- #565 episode reconciliation must not close the independent nurse verification task.
 perform pg_temp.as_service();set local role service_role;
 perform public.zoe_bp_staff_item(m,'synthetic-typed',mid,null,20);reset role;
 perform pg_temp.ok((select status='sent'and merged_into_alert_id is null from public.care_queue_tasks where id=t.id),'episode merge preserves nurse verification visibility');
end$$;
-- Missing provenance cannot exploit SQL CHECK's NULL semantics to make a verification task.
do $$begin
 begin
  insert into public.care_queue_tasks(member_id,queue,zone,reason_code,rule_version,summary,source_ref)
  values('b3000000-0000-4000-8000-000000000001','nurse',null,'bp_member_reported_high','typed-bp-1','{}','typed-bp:b3000000-0000-4000-8000-000000000099');
  raise exception 'FAIL: verification task without source accepted';
 exception when check_violation then null;end;
end$$;
-- High diastolic is independently covered: no DBP condition may suppress the task.
do $$declare m uuid:='b3000000-0000-4000-8000-000000000003';r uuid;begin
 r:=pg_temp.msg(m,1,6);perform pg_temp.save(r,1,179,80);
 perform pg_temp.ok(not exists(select 1 from public.care_queue_tasks where member_id=m),'SBP179 low DBP creates no verification task');
 r:=pg_temp.msg(m,2,0);perform pg_temp.save(r,2,180,179);
 perform pg_temp.ok((select count(*)=1 from public.care_queue_tasks where member_id=m),'SBP180 with high DBP also creates exactly one task');
end$$;
-- Confirmed photo/voice and legacy provenance keep their existing measured meaning.
do $$declare m uuid:='b3000000-0000-4000-8000-000000000003';j jsonb;begin
 insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at,entry_source)values
  (m,gen_random_uuid(),110,70,now()-interval '2 days','patient_photo_confirmed'),
  (m,gen_random_uuid(),120,80,now()-interval '1 day','patient_voice_confirmed'),
  (m,gen_random_uuid(),130,90,now()-interval '1 hour',null);
 j:=public._bp_weekly_trend(m,clock_timestamp());
 perform pg_temp.ok((j->>'readingsThis')::int=3 and (j#>>'{thisMean,systolic}')::int=120,'photo voice and legacy measurements still count while typed observation does not');
end$$;
-- First reading note, then repeat alert links both tasks without duplicating notes/alerts.
do $$declare m uuid:='b3000000-0000-4000-8000-000000000002';r uuid;first_id uuid;note uuid;begin
 r:=pg_temp.msg(m,1,10);perform pg_temp.save(r,1,185,115);
 select id into first_id from public.patient_measurements where user_id=m;
 select id into note from public.bp_repeat_notes where member_id=m;
 perform pg_temp.ok(note is not null and exists(select 1 from public.care_queue_tasks where member_id=m and summary->>'noteId'=note::text),'task links existing first quiet note');
 r:=pg_temp.msg(m,2,0);perform pg_temp.save(r,2,184,116);
 perform pg_temp.ok((select count(*)=1 from public.care_alerts where member_id=m),'repeat retains one existing alert');
 perform pg_temp.ok((select count(*)=2 and bool_and(summary->>'alertId'is not null)from public.care_queue_tasks where member_id=m),'repeat alert linked to original and repeat verification tasks');
 perform pg_temp.ok((select count(*)=1 from public.bp_repeat_notes where member_id=m),'no duplicate quiet note');
 -- Raw safety remains available, but typed-only history cannot form a weekly summary or GP home readings.
 perform pg_temp.ok(public._bp_weekly_trend(m,clock_timestamp())is null,'typed-only history yields no weekly trend');
 perform pg_temp.ok(jsonb_array_length(public._gp_report_source_body(m)->'homeReadings')=0,'GP measured home readings exclude typed');
 
end$$;
-- Mixed measured/unverified evidence: source stays raw; only measured values count.
do $$declare m uuid:='b3000000-0000-4000-8000-000000000002';runs uuid[];j jsonb;s jsonb;begin
 select array_agg(id)into runs from public.zoe_runs where member_id=m;
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_health_context(runs)->0->'data';s:=public.member_bp_recent(m);reset role;
 perform pg_temp.ok(jsonb_typeof(j)='object','Zoe health context is available for the mixed BP fixture');
 perform pg_temp.ok(j->'bpWeek'='null'::jsonb,'Zoe typed-only history yields no measured BP week');
 perform pg_temp.ok(jsonb_array_length(j->'bpReported')=2,'Zoe retains both typed observations as reported BP');
 perform pg_temp.ok(jsonb_array_length(s)=2,'urgent screening retains typed raw readings');
 insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)
 values(m,gen_random_uuid(),120,80,now()-interval '2 days'),(m,gen_random_uuid(),126,84,now()-interval '1 day'),(m,gen_random_uuid(),123,82,now()-interval '1 hour');
 s:=public._bp_weekly_trend(m,clock_timestamp());
 perform pg_temp.ok((s->>'readingsThis')::int=3 and (s#>>'{thisMean,systolic}')::int=123,'weekly mean and count exclude typed observations');
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_health_context(runs)->0->'data';reset role;
 perform pg_temp.ok((j#>>'{bpWeek,count}')::int=3 and (j#>>'{bpWeek,avgSystolic}')::int=123 and (j#>>'{bpWeek,latest,systolic}')::int=123,'Zoe measured average/count/latest exclude typed');
 perform pg_temp.ok(jsonb_array_length(public._gp_report_source_body(m)->'homeReadings')=3,'GP retains legacy measured readings');
end$$;

create function pg_temp.inbox(n uuid,s uuid,v text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',n,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',s)::text,true);
 set local role authenticated;j:=public.care_queue_inbox('nurse',v);reset role;return j;end$$;
-- The same queue RPC powers Care queue and nurse Tasks; assignment and sandbox
-- visibility remain enforced in SQL. The web journey check verifies both renders.
update public.patient_clinical_cases set assigned_nurse_id='b3000000-0000-4000-8000-000000000011'where user_id='b3000000-0000-4000-8000-000000000001';
do $$declare n uuid:='b3000000-0000-4000-8000-000000000011';sid uuid:='b3000000-0000-4000-8000-000000000031';j jsonb;begin
 j:=pg_temp.inbox(n,sid,'sandbox');
 perform pg_temp.ok(jsonb_array_length(j->'tasks')=1 and j#>>'{tasks,0,summary,entrySource}'='patient_text_entry','eventual assigned nurse sees original verification task in both queue consumers');
 perform pg_temp.ok(jsonb_array_length(pg_temp.inbox(n,sid,'live')->'tasks')=0,'test task hidden in live queue');
 perform pg_temp.ok(jsonb_array_length(pg_temp.inbox('b3000000-0000-4000-8000-000000000012','b3000000-0000-4000-8000-000000000032','sandbox')->'tasks')=0,'other nurse cannot see the verification task');
end$$;
-- No API role gains the private task writer or direct access to queue rows.
select pg_temp.ok(not has_function_privilege('authenticated','public._typed_bp_task(public.patient_measurements)','execute')
 and not has_function_privilege('anon','public._typed_bp_task(public.patient_measurements)','execute')
 and not has_function_privilege('service_role','public._typed_bp_task(public.patient_measurements)','execute'),'task writer is internal only');
select pg_temp.ok(not has_table_privilege('authenticated','public.care_queue_tasks','select')and not has_table_privilege('anon','public.care_queue_tasks','select'),'queue data stays behind assigned staff RPC');
-- Urgent publication finishes the run before its background observation write.
savepoint urgent_observations;
do $$declare m uuid:='b3000000-0000-4000-8000-000000000002';r uuid;mid uuid;j jsonb;oc text;seq bigint:=10;before_rows bigint;before_tasks bigint;begin
 foreach oc in array array['discarded','intake_escalated']loop
  r:=pg_temp.msg(m,seq,0);
  update public.zoe_runs set state='finished',outcome=oc,reason_code=case when oc='discarded'then 'urgent_route_no_model_call'else 'symptom_red_flag_no_model_call'end,finished_at=clock_timestamp()where id=r;
  select count(*)into before_rows from public.patient_measurements where user_id=m;
  select count(*)into before_tasks from public.care_queue_tasks where member_id=m;
  j:=pg_temp.save(r,seq,185,115);
  perform pg_temp.ok(j->>'ok'='true','completed emergency run can save its observation');
  select id into strict mid from public.patient_measurements where user_id=m and submission_id=md5('zoe-typed-bp:'||(select conversation_id::text from public.zoe_runs where id=r)||':'||seq::text||':0')::uuid;
  perform pg_temp.ok((select count(*)=before_rows+1 from public.patient_measurements where user_id=m),'one emergency observation');
  perform pg_temp.ok((select count(*)=before_tasks+1 from public.care_queue_tasks where member_id=m),'one emergency nurse verification task');
  perform pg_temp.ok(exists(select 1 from public.care_queue_tasks where member_id=m and source_ref='typed-bp:'||mid::text and summary->>'entrySource'='patient_text_entry'),'emergency task retains measurement link and provenance');
  perform pg_temp.save(r,seq,185,115);
  perform pg_temp.ok((select count(*)=before_rows+1 from public.patient_measurements where user_id=m)and(select count(*)=before_tasks+1 from public.care_queue_tasks where member_id=m),'completed emergency replay duplicates neither reading nor task');
  perform pg_temp.as_service();set local role service_role;j:=public.member_bp_read_for(m);reset role;
  perform pg_temp.ok(j#>>'{latest,entrySource}'='patient_text_entry'and j#>>'{latest,systolic}'='185','Telegram latest read includes member-reported provenance');
  seq:=seq+1;
 end loop;
 r:=pg_temp.msg(m,seq,0);
 update public.zoe_runs set state='finished',outcome='summary_only',reason_code='bp_remeasure',finished_at=clock_timestamp()where id=r;
 perform pg_temp.ok(pg_temp.save(r,seq,185,115)->>'ok'='false','finished ordinary runs cannot write observations');
 update public.zoe_runs set outcome='discarded'where id=r;
 perform pg_temp.ok(pg_temp.save(r,seq,185,115)->>'ok'='false','missing urgent reason cannot authorize an observation');
end$$;
rollback to savepoint urgent_observations;
rollback;
\echo 'PASS unverified BP provenance, measured summaries and nurse verification'
