-- Zoe nurse-first task (20261102185111): a mild_side_effect forward gives the assigned nurse a task and leaves the doctor's forward alone;
-- no nurse, nurse chat off, same-day, a held text and a replay add nothing. Through the real path. Rolled back. Synthetic fixtures only.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.u(n int)returns uuid language sql immutable as $$select('e1a50000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.as_user(m uuid,sid uuid)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.turn(m int,rid int,txt text)returns uuid language plpgsql as $$declare run uuid;begin
 perform pg_temp.as_user(pg_temp.u(m),pg_temp.u(m+10));set local role authenticated;perform public.conversation_receive(jsonb_build_object('requestId',pg_temp.u(rid),'text',txt));reset role;
 perform pg_temp.as_service();set local role service_role;select(x->>'runId')::uuid into run from jsonb_array_elements(public.zoe_run_claim(10))x where(x->>'memberId')::uuid=pg_temp.u(m);reset role;update public.zoe_runs set reserved=true,tier='high'where id=run;return run;end$$;
create function pg_temp.body(outcome text,reason text,urgency text)returns jsonb language sql as $$
 select jsonb_build_object('outcome',outcome,'reason','synthetic_nurse_first','summary','Synthetic summary.','answer','Synthetic answer.','language','en',
  'guardReasons','[]'::jsonb,'redactionCount',0,'usage',jsonb_build_object('inputTokens',0,'outputTokens',0),'costUsd',0,'latencyMs',5,'provider','vercel.ai_gateway','model','anthropic/claude-opus-5.5',
  'configVersion','zoe-nurse-first-check','tier','high','tierReason','check','fallbackUsed',false,'events','[]'::jsonb,
  'health',jsonb_build_object('urgency',urgency,'modelUrgency',urgency,'forward','auto','forwardReason',reason))$$;
create function pg_temp.finish(run uuid,arg jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_finish(run,arg);reset role;return j;end$$;
create function pg_temp.tasks(m int)returns bigint language sql as $$select count(*)from public.patient_coordination_tasks where patient_case_id=pg_temp.u(m)$$;
create function pg_temp.said(run uuid)returns text language sql as $$select detail->>'outcome'from public.conversation_audit where kind='zoe.nurse_first'and detail->>'runId'=run::text$$;

-- Member 1 has a doctor and a nurse, member 2 only a doctor.
insert into auth.users(id,phone,phone_confirmed_at)values(pg_temp.u(1),'37499085101',now()),(pg_temp.u(2),'37499085102',now()),(pg_temp.u(3),null,null),(pg_temp.u(4),null,null);
insert into public.workspace_clinics(id,name)values(pg_temp.u(9),'Synthetic nurse-first clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.u(3),'doctor','Dr Synthetic',pg_temp.u(9)),(pg_temp.u(4),'nurse','Nurse Synthetic',pg_temp.u(9));
insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.u(11),pg_temp.u(1),now(),now()),(pg_temp.u(12),pg_temp.u(2),now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.u(1),pg_temp.u(3),pg_temp.u(4)),(pg_temp.u(2),pg_temp.u(3),null);
update public.profiles set locale='en',display_name='Synthetic Member'where id in(pg_temp.u(1),pg_temp.u(2));
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'synthetic-nurse-first',3600,600,60,40,false,true,true);
insert into public.zoe_consents(member_id,kind,granted,wording_version)values(pg_temp.u(1),'zoe_reads_messages',true,'zoe-consent-draft-1'),(pg_temp.u(2),'zoe_reads_messages',true,'zoe-consent-draft-1');
update public.system_message_templates set approved=true where template_id in('zoe.answer','zoe.urgent');
insert into public.zoe_settings(consent_collection_enabled,consent_wording_version)values(true,'zoe-consent-draft-1');
-- Finish must accept a health answer before the nurse trigger can handle its forward.
-- Synthetic evals satisfy the settings guards; no provider is called by this SQL check.
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33',510,0,0,pg_temp.u(3)from public.zoe_tier_config;
update public.zoe_settings set staging_ai_mode=true,model_calls_allowed=true,conversational_replies_enabled=true,health_answers_enabled=true;
create temp table kv(k text primary key,v uuid,finish jsonb);

-- Nurse chat off (the default): the forward stands, no task.
update public.nurse_chat_settings set enabled=false where singleton;
insert into kv(k,v) select 'off',pg_temp.turn(1,101,'Synthetic mild side effect one');
update kv set finish=pg_temp.finish(v,pg_temp.body('answered','mild_side_effect','doctor_soon'))where k='off';
select pg_temp.ok(finish->>'ok'='true'and finish->>'outcome'='answered'and said='nurse_chat_off'and pg_temp.tasks(1)=0,
 'Nurse chat off: no task finish='||coalesce(finish::text,'null')||' said='||coalesce(said,'null'))
 from(select finish,pg_temp.said(v)said from kv where k='off')x;
update public.nurse_chat_settings set enabled=true where singleton;

-- The route: a nurse-owned task, doctor as creator, no deadline; the doctor's forward is recorded as before.
insert into kv(k,v) select 'on',pg_temp.turn(1,102,'Synthetic mild side effect two');
update kv set finish=pg_temp.finish(v,pg_temp.body('answered','mild_side_effect','doctor_soon'))where k='on';
select pg_temp.ok(finish->>'ok'='true'and finish->>'outcome'='answered'and said='task',
 'Task made finish='||coalesce(finish::text,'null')||' said='||coalesce(said,'null'))
 from(select finish,pg_temp.said(v)said from kv where k='on')x;
select pg_temp.ok((select kind='contact-followup'and owner_id=pg_temp.u(4)and creator_id=pg_temp.u(3)and status='open'and due_at is null from public.patient_coordination_tasks where patient_case_id=pg_temp.u(1)),'Owned by the assigned nurse');
select pg_temp.ok((select count(*)=1 from public.patient_coordination_events e join public.patient_coordination_tasks t on t.id=e.task_id where t.patient_case_id=pg_temp.u(1)and e.actor_name='Zoe'),'One event, by Zoe');
select pg_temp.ok((select forward='auto'and forward_reason='mild_side_effect'from public.zoe_runs where id=(select v from kv where k='on')),'The forward is on the run');
select pg_temp.ok(public._zoe_answered_open((select id from public.conversations where member_id=pg_temp.u(1)))is null,'It stays in the doctor''s needs reply');
-- The assigned doctor reads the task.
select pg_temp.ok(public.staff_care_access(pg_temp.u(1),pg_temp.u(3),true),'The doctor can see it');
-- A replayed finish adds nothing; a second mild forward while the task is open adds nothing.
select pg_temp.finish((select v from kv where k='on'),pg_temp.body('answered','mild_side_effect','doctor_soon'));
insert into kv(k,v) select 'again',pg_temp.turn(1,103,'Synthetic mild side effect three');
select pg_temp.finish((select v from kv where k='again'),pg_temp.body('answered','mild_side_effect','planned'));
select pg_temp.ok(pg_temp.said((select v from kv where k='again'))='already_open'and pg_temp.tasks(1)=1,'One open task per member');

-- Same-day level, a held text and the old reason: doctor route only.
update public.patient_coordination_tasks set status='completed'where patient_case_id=pg_temp.u(1);
insert into kv(k,v) select 'sd',pg_temp.turn(1,104,'Synthetic four');
select pg_temp.finish((select v from kv where k='sd'),pg_temp.body('answered','mild_side_effect','same_day'));
insert into kv(k,v) select 'held',pg_temp.turn(1,105,'Synthetic five');
select pg_temp.finish((select v from kv where k='held'),pg_temp.body('summary_only','mild_side_effect','doctor_soon')-'answer');
insert into kv(k,v) select 'old',pg_temp.turn(1,106,'Synthetic six');
select pg_temp.finish((select v from kv where k='old'),pg_temp.body('answered','serious_side_effect','doctor_soon'));
select pg_temp.ok(pg_temp.tasks(1)=1,'No task for same-day, held text or the serious reason');

-- No assigned nurse: audited, no task.
insert into kv(k,v) select 'none',pg_temp.turn(2,107,'Synthetic seven');
select pg_temp.finish((select v from kv where k='none'),pg_temp.body('answered','mild_side_effect','doctor_soon'));
select pg_temp.ok(pg_temp.said((select v from kv where k='none'))='no_assigned_nurse'and pg_temp.tasks(2)=0,'No assigned nurse: no task');
select pg_temp.ok((select bool_and(origin='zoe_side_effect')from public.patient_coordination_tasks where patient_case_id=pg_temp.u(1)),'Zoe trigger marks its system tasks');
rollback;
