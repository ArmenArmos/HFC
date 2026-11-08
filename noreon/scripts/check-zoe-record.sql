-- The record from the chat (20261102182738): a medicine the member confirmed in chat goes on their own list with no invented dose or time, a questionnaire
-- correction is their statement and changes no answer, the worker's record carries both, and a test member's alerts reach only test staff. Fictional, rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.u(n int)returns uuid language sql immutable as $$select('e1c80000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.sid(n int)returns uuid language sql immutable as $$select('e1c80000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.as_user(n int)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',pg_temp.sid(n))::text,true)$$;
create function pg_temp.svc(sql_ text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;execute sql_ into j;reset role;return j;end$$;
create function pg_temp.add(run uuid,meds jsonb)returns jsonb language sql as $$select pg_temp.svc(format('select public.zoe_run_medicines_add(%L::uuid,%L::jsonb)',run,meds))$$;
create function pg_temp.say(run uuid,x jsonb)returns jsonb language sql as $$select pg_temp.svc(format('select public.zoe_run_member_statements(%L::uuid,%L::jsonb)',run,x))$$;
create function pg_temp.refused(sql_ text,role_ text)returns boolean language plpgsql as $$begin
 execute format('set local role %I',role_);execute sql_;reset role;return false;exception when insufficient_privilege then reset role;return true;end$$;
create function pg_temp.alerts(n int)returns integer language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;j:=public.care_alert_inbox('live',100);reset role;return jsonb_array_length(j->'alerts');end$$;
create function pg_temp.inbox(n int)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;j:=public.doctor_ai_inbox();reset role;return j;end$$;
grant execute on all functions in schema pg_temp to authenticated,anon,service_role;

set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.u(n),'37499018'||lpad(n::text,2,'0'),now()from unnest(array[1,2,11,12,14])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.sid(n),pg_temp.u(n),now()-interval '1 hour',now()from unnest(array[11,12,14])n;
insert into public.profiles(id,display_name)values(pg_temp.u(1),'Fictional real member'),(pg_temp.u(2),'Fictional test member')on conflict(id)do nothing;
update public.profiles set is_test_account=true where id=pg_temp.u(2);
insert into public.workspace_clinics(id,name)values(pg_temp.u(20),'Synthetic record clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.u(11),'doctor','Real doctor',pg_temp.u(20)),(pg_temp.u(12),'doctor','Test doctor',pg_temp.u(20));
insert into public.workspace_staff(user_id,role,display_name)values(pg_temp.u(14),'admin','Admin');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values(pg_temp.u(1),pg_temp.u(11)),(pg_temp.u(2),pg_temp.u(11))on conflict(user_id)do update set assigned_doctor_id=excluded.assigned_doctor_id;
insert into public.conversations(member_id)select pg_temp.u(n)from unnest(array[1,2])n on conflict do nothing;
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state)
 select pg_temp.u(30+n),c.id,c.member_id,1,1,0,current_date,'started' from public.conversations c,unnest(array[1,2])n where c.member_id=pg_temp.u(n);
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
 select pg_temp.u(33),c.id,c.member_id,2,1,0,current_date,'finished','answered','x',now()from public.conversations c where c.member_id=pg_temp.u(1);
insert into public.patient_assessments(user_id,answers,completed_at)values(pg_temp.u(1),'{"q3.status":{"value":"former"},"q2.height":{"value":180},"q7.relatives":{"value":["cad"]},"q9.present":{"value":"no"}}',now());
insert into public.zoe_settings(singleton,health_answers_enabled)values(true,true)on conflict(singleton)do update set health_answers_enabled=true;
update public.member_medicine_settings set enabled=true;
insert into public.care_alert_settings(enabled)values(true)on conflict(singleton)do update set enabled=true;
set local session_replication_role=origin;

-- 1. A medicine from chat. The worker only.
select pg_temp.ok(pg_temp.refused($$select public.zoe_run_medicines_add('e1c80000-0000-4000-8000-000000000031','[]')$$,'authenticated'),'members cannot call the add');
select pg_temp.ok(pg_temp.refused($$select public.zoe_run_member_statements('e1c80000-0000-4000-8000-000000000031','[]')$$,'authenticated'),'members cannot call the statements');
select pg_temp.ok(pg_temp.refused($$select public._member_medicine_add('e1c80000-0000-4000-8000-000000000001','x',null,'{}',null,true)$$,'authenticated'),'the internal add has no browser grant');
select pg_temp.ok(pg_temp.add(pg_temp.u(31),'[{"name":"amlodipine","dose":"5 mg"},{"name":"Fictionalol","dose":null}]')->>'status'='added','two medicines added');
select pg_temp.ok((select count(*)=2 and bool_and(from_chat_at is not null and cardinality(times)=0 and source='self-reported')from public.member_medicines where user_id=pg_temp.u(1)),'the member''s own statement, no invented times');
select pg_temp.ok((select dose is null from public.member_medicines where user_id=pg_temp.u(1)and name='Fictionalol'),'an unknown dose stays unknown');
select pg_temp.ok(pg_temp.add(pg_temp.u(31),'[{"name":"amlodipine","dose":"5 mg"},{"name":"Fictionalol","dose":null}]')->>'status'='added'and(select count(*)=2 from public.member_medicines where user_id=pg_temp.u(1)),'a repeat adds nothing');
select pg_temp.ok(pg_temp.add(pg_temp.u(33),'[{"name":"x","dose":null}]')->>'status'='invalid','a finished run cannot add');
select pg_temp.ok(pg_temp.add(pg_temp.u(31),'[]')->>'status'='invalid','nothing to add');
select pg_temp.ok(jsonb_array_length(public._member_medicine_json((select m from public.member_medicines m where user_id=pg_temp.u(1)limit 1),now())->'times')=0,'the read gives an empty list of times, never null');
select pg_temp.ok((public._member_medicine_json((select m from public.member_medicines m where user_id=pg_temp.u(1)limit 1),now())->>'fromChat')='true','the staff read shows where it came from');
-- Only a row from chat may go without times.
savepoint plain;
do $$begin insert into public.member_medicines(user_id,name,times,started_on)values(pg_temp.u(1),'no times',array[]::time[],current_date);raise exception 'FAIL: a row from the app needs a time';exception when check_violation then null;end$$;
rollback to plain;
-- The session add is unchanged.
select pg_temp.as_user(1);set local role authenticated;
select pg_temp.ok(public.member_medicine_add('Own entry','1 mg',array['08:00'::time],gen_random_uuid())->>'status'='added','the app''s add still works');
select pg_temp.ok(public.member_medicine_add('No time',null,array[]::time[],gen_random_uuid())->>'status'='invalid','the app''s add still needs a time');
reset role;
-- List off: nothing added. No dose ticks or reminders can come from an empty row.
update public.member_medicine_settings set enabled=false;
select pg_temp.ok(pg_temp.add(pg_temp.u(32),'[{"name":"amlodipine","dose":null}]')->>'status'='disabled','list off');
update public.member_medicine_settings set enabled=true;

-- 2. A correction is a statement. The questionnaire does not move.
select pg_temp.ok(pg_temp.say(pg_temp.u(31),'[{"subject":"stroke","words":"I never had a stroke"}]')->>'ok'='true','stored');
select pg_temp.ok(pg_temp.say(pg_temp.u(31),'[{"subject":"stroke","words":"I never had a stroke"}]')->>'ok'='true'and(select count(*)=1 from public.member_statements where member_id=pg_temp.u(1)),'a repeat stores nothing');
select pg_temp.ok(pg_temp.say(pg_temp.u(33),'[{"subject":"stroke","words":"Late"}]')->>'ok'='false','a finished run cannot store one');
select pg_temp.ok(pg_temp.say(pg_temp.u(31),'[{"subject":"type_2","words":"Not diabetes"}]')->>'ok'='true','a subject may hold digits');
select pg_temp.ok(not has_table_privilege('authenticated','public.member_statements','select')and not has_table_privilege('anon','public.member_statements','select'),'no direct access');

-- 3. The worker's record.
select pg_temp.ok((pg_temp.svc(format('select public.zoe_run_member_record(array[%L::uuid])',pg_temp.u(31)))->0->>'medicineList')='true','the switch');
select pg_temp.ok((pg_temp.svc(format('select public.zoe_run_member_record(array[%L::uuid])',pg_temp.u(31)))->0->'disputed')@>'["stroke"]'::jsonb,'what the member disputes');
select pg_temp.ok((pg_temp.svc(format('select public.zoe_run_member_record(array[%L::uuid])',pg_temp.u(31)))->0->'questionnaireFacts')='{"q3.status":"former","q2.height":180,"q7.relatives":["cad"]}'::jsonb,'only the summary''s fields, never the red-flag questions');
select pg_temp.ok((pg_temp.svc(format('select public.zoe_run_member_record(array[%L::uuid])',pg_temp.u(32)))->0->'questionnaireFacts')='null'::jsonb,'no questionnaire: nothing');

-- 4. Test members. The real member's alert is unchanged; the test member's reaches only test staff.
set local session_replication_role=replica;
insert into public.care_alerts(member_id,source,reason_code,rule_id,rule_version,source_ref,doctor_id)select pg_temp.u(n),'zoe','zoe_urgent_route','zoe.urgent_route','1','r'||n,pg_temp.u(11)from unnest(array[1,2])n;
set local session_replication_role=origin;
select pg_temp.ok(public._test_member_hidden(pg_temp.u(2),pg_temp.u(11)),'a flagged member is hidden from real staff');
select pg_temp.ok(not public._test_member_hidden(pg_temp.u(1),pg_temp.u(11)),'a real member never is');
select pg_temp.ok(pg_temp.alerts(11)=1,'the assigned real doctor sees the real member only');
select pg_temp.ok(pg_temp.alerts(14)=1,'so does an admin');
select pg_temp.ok(pg_temp.inbox(11)::text not like '%'||pg_temp.u(2)::text||'%','not in the real doctor''s Today');
select pg_temp.ok(pg_temp.inbox(11)::text like '%'||pg_temp.u(1)::text||'%','the real member stays');
update public.workspace_staff set sees_test_members=true where user_id in(pg_temp.u(12),pg_temp.u(14));
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.u(12)where user_id=pg_temp.u(2);
select pg_temp.ok(pg_temp.alerts(14)=2,'an admin marked as test staff sees both');
select pg_temp.ok(pg_temp.alerts(12)=1,'the test doctor sees the test member');
select pg_temp.ok(pg_temp.inbox(12)::text like '%'||pg_temp.u(2)::text||'%','and in Today');
rollback;
