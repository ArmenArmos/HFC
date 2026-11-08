-- PR 7 risk-path checks, synthetic data only, rolled back. Run after a full local migration replay.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(v boolean,label text)returns void language plpgsql as $$begin if v is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.denied(q text,code text default '42501')returns boolean language plpgsql as $$begin execute q;return false;exception when others then if sqlstate=code then return true;end if;raise;end$$;
create function pg_temp.id(n int)returns uuid language sql immutable as $$select ('ce700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.as_member(n int)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','session_id',pg_temp.id(100+n),'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true)
$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.denied(text,text),pg_temp.id(int),pg_temp.as_member(int)to authenticated;
set local session_replication_role=replica;
insert into auth.users(id)select pg_temp.id(n)from generate_series(1,5)n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.id(100+n),pg_temp.id(n),now(),now()from generate_series(1,5)n;
insert into public.profiles(id,locale,display_name)values(pg_temp.id(1),'en','Synthetic one'),(pg_temp.id(2),'hy','Synthetic two');
insert into public.workspace_clinics(id,name)values(pg_temp.id(10),'Synthetic clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.id(3),'doctor','Assigned synthetic doctor',pg_temp.id(10)),(pg_temp.id(4),'doctor','Other synthetic doctor',pg_temp.id(10)),(pg_temp.id(5),'admin','Synthetic admin',pg_temp.id(10));
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values(pg_temp.id(1),pg_temp.id(3));
insert into public.booking_appointments(id,member_id,program_id,requirements_token,proposed_arrangement,proposed_reservation_id,notice_id,status)values
 (pg_temp.id(20),pg_temp.id(1),gen_random_uuid(),'synthetic-one','{}',gen_random_uuid(),gen_random_uuid(),'confirmed'),
 (pg_temp.id(21),pg_temp.id(2),gen_random_uuid(),'synthetic-two','{}',gen_random_uuid(),gen_random_uuid(),'confirmed');
insert into public.member_reported_documents(id,user_id,object_path,file_name,mime,size_bytes,sha256)values
 (pg_temp.id(30),pg_temp.id(1),pg_temp.id(1)::text||'/old.pdf','old.pdf','application/pdf',100,repeat('a',64)),
 (pg_temp.id(31),pg_temp.id(2),pg_temp.id(2)::text||'/other.pdf','other.pdf','application/pdf',100,repeat('b',64));
reset session_replication_role;
select pg_temp.ok((select doc_type is null and uploader_role is null and study_date is null and classification_confidence is null and auto_read_allowed from public.member_reported_documents where id=pg_temp.id(30)),'nullable metadata preserves old rows');
select pg_temp.ok((select relrowsecurity from pg_class where oid='public.consult_questions'::regclass),'RLS enabled in creation migration');
select pg_temp.ok(not has_function_privilege('anon','public.zoe_v3_document_details(uuid,text,date)','execute'),'anon cannot write metadata');
select pg_temp.ok(not has_function_privilege('anon','public.doctor_consult_questions(uuid)','execute'),'anon cannot read questions');
select pg_temp.ok(not has_function_privilege('authenticated','public.zoe_v3_lab_card_post(uuid,bigint,text,uuid)','execute'),'member cannot invoke scheduled service writer');
select pg_temp.ok(not has_column_privilege('authenticated','public.consult_questions','sent_at','update'),'member cannot invent sent time');
select pg_temp.ok(not has_any_column_privilege('authenticated','public.consult_questions','insert,update'),'member has no direct question column writes');
select pg_temp.ok(not has_column_privilege('authenticated','public.member_reported_documents','classification_confidence','update'),'member cannot forge classifier confidence');

select pg_temp.as_member(1);
set local role authenticated;
select pg_temp.ok(public.zoe_v3_document_read(pg_temp.id(31))->'document'='null'::jsonb,'other document unavailable');
select pg_temp.ok(not exists(select 1 from public.member_reported_documents where id=pg_temp.id(31)),'document RLS hides other member');
select pg_temp.ok(not public.zoe_v3_document_details(pg_temp.id(31),'lab',current_date),'other document not writable');
select pg_temp.ok(public.zoe_v3_document_details(pg_temp.id(30),'lab',current_date),'own metadata saves');
select pg_temp.ok(not public.zoe_v3_document_details(pg_temp.id(30),'made_up',current_date),'invalid type rejected');
select pg_temp.ok(not public.zoe_v3_document_details(pg_temp.id(30),'lab',current_date+2),'future study date rejected');
select pg_temp.ok(pg_temp.denied($q$insert into public.consult_questions(member_id,request_id,text,group_label)values(pg_temp.id(2),pg_temp.id(40),'Synthetic','results')$q$),'cannot insert another member question');
select pg_temp.ok(pg_temp.denied($q$insert into public.consult_questions(member_id,appointment_id,request_id,text,group_label)values(pg_temp.id(1),pg_temp.id(20),pg_temp.id(40),'Synthetic','results')$q$),'cannot insert own question directly');
select pg_temp.ok(not public.zoe_v3_consult_questions_save(pg_temp.id(40),pg_temp.id(21),'[{"label":"results","text":"Synthetic"}]'),'cannot attach another member appointment through function');
select pg_temp.ok(public.zoe_v3_consult_questions_save(pg_temp.id(40),pg_temp.id(20),'[{"label":"symptoms","text":"Synthetic question"},{"label":"results","text":"Synthetic test question"}]'),'save own batch');
select pg_temp.ok(public.zoe_v3_consult_questions_save(pg_temp.id(40),pg_temp.id(20),'[{"label":"symptoms","text":"Synthetic question"},{"label":"results","text":"Synthetic test question"}]'),'replay same batch');
select pg_temp.ok((select count(*)=2 from public.consult_questions),'batch replay adds no rows');
select pg_temp.ok(pg_temp.denied($q$update public.consult_questions set text='Not allowed'where request_id=pg_temp.id(40)$q$),'cannot update own unsent questions directly');
select pg_temp.ok(pg_temp.denied($q$delete from public.consult_questions where request_id=pg_temp.id(40)$q$),'cannot delete own unsent questions directly');
select pg_temp.ok(not public.zoe_v3_consult_questions_save(pg_temp.id(40),null,'[{"label":"results","text":"Changed"}]'),'claimed batch cannot mutate');
select pg_temp.ok(not public.zoe_v3_consult_questions_sent(pg_temp.id(40)),'sent time requires actual message to doctor');
select pg_temp.ok(pg_temp.denied($q$select public.doctor_consult_questions(pg_temp.id(1))$q$),'member cannot use doctor read');
reset role;
-- One ordinary, already-stored message-to-doctor; no message is dispatched by this check.
set local session_replication_role=replica;
insert into public.conversations(id,member_id)values(pg_temp.id(50),pg_temp.id(1));
insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id,to_doctor)
 values(pg_temp.id(50),1,pg_temp.id(1),'Synthetic sent questions','authenticated_member',pg_temp.id(40),true);
reset session_replication_role;
set local role authenticated;
select pg_temp.ok(public.zoe_v3_consult_questions_sent(pg_temp.id(40)),'mark sent only after message exists');
select pg_temp.ok((select count(*)=2 and bool_and(sent_at is not null)from public.consult_questions),'all sent rows have server timestamp');
select pg_temp.ok(pg_temp.denied($q$update public.consult_questions set text='Not allowed'where request_id=pg_temp.id(40)$q$),'cannot update sent questions directly');
select pg_temp.ok(not exists(select 1 from public.consult_questions where text='Not allowed'),'sent questions immutable to member');
reset role;
select pg_temp.as_member(2);
set local role authenticated;
select pg_temp.ok(not exists(select 1 from public.consult_questions),'other member cannot read');
select pg_temp.ok(pg_temp.denied($q$update public.consult_questions set text='Not allowed'$q$),'cannot update another member questions directly');
select pg_temp.ok(pg_temp.denied($q$delete from public.consult_questions$q$),'cannot delete another member questions directly');
select pg_temp.ok(not public.zoe_v3_consult_questions_sent(pg_temp.id(40)),'other member cannot mark sent');
reset role;
select pg_temp.as_member(3);
set local role authenticated;
select pg_temp.ok(not exists(select 1 from public.consult_questions),'assigned doctor has no direct table access');
select pg_temp.ok(jsonb_array_length(public.doctor_consult_questions(pg_temp.id(1)))=2,'assigned admitted doctor reads sent questions through function');
reset role;
select pg_temp.as_member(4);
set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.doctor_consult_questions(pg_temp.id(1))$q$),'unassigned doctor refused');
reset role;
select pg_temp.as_member(5);
set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.doctor_consult_questions(pg_temp.id(1))$q$),'admin cannot read clinical questions');
reset role;
-- New V3 uploads do not queue a model job, even though classic uploads retain their previous behavior.
insert into public.member_reported_documents(id,user_id,object_path,file_name,mime,size_bytes,sha256,auto_read_allowed,uploader_role)
 values(pg_temp.id(32),pg_temp.id(1),pg_temp.id(1)::text||'/new.pdf','new.pdf','application/pdf',100,repeat('c',64),false,'member');
select pg_temp.ok(not exists(select 1 from public.lab_ai_jobs where member_document_id=pg_temp.id(32)),'saved-not-read upload queues no model job');

-- Confirmed booking preparation is frozen with the booking, even if future clinic settings change.
set local session_replication_role=replica;
insert into public.booking_program_seals(id,member_id,actor_id,source_token,requirements_token,engine_version,program)
 values(pg_temp.id(60),pg_temp.id(1),pg_temp.id(3),'synthetic','synthetic','synthetic','{"items":[{"id":"synthetic-lab","method":"lab"}]}');
insert into public.clinic_schedules(clinic_id,active,slot_minutes,capacity,covered_test_ids,preparation,updated_by)
 values(pg_temp.id(10),false,30,1,array['synthetic-lab'],'New instructions for future bookings',pg_temp.id(3));
update public.booking_appointments set program_id=pg_temp.id(60),current_arrangement=jsonb_build_object('clinicId',pg_temp.id(10),'startsAt',clock_timestamp()+interval '1 day','location','Synthetic clinic','preparation','Booked clinic instructions')where id=pg_temp.id(20);
reset session_replication_role;
select pg_temp.as_member(1);
set local role authenticated;
select pg_temp.ok(public.zoe_v3_lab_appointment(pg_temp.id(20))->>'preparation'='Booked clinic instructions','booked preparation survives changed, disabled future schedule');
reset role;

-- Durable per-appointment/revision card idempotency and outstanding-work reads.
-- Migrations intentionally leave the policy unseeded; create this check's synthetic configuration.
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages)
 values(true,'zoe-v3-labs-check',600,600,600,10)on conflict(singleton)do nothing;
update public.conversation_policy set app_chat_enabled=true,zoe_chat_actions_enabled=true where singleton;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.ok(public.zoe_v3_lab_card_post(pg_temp.id(20),0,'prep',pg_temp.id(70))->>'ok'='true','service posts preparation');
select pg_temp.ok(public.zoe_v3_lab_card_post(pg_temp.id(20),0,'prep',pg_temp.id(70))->>'replayed'='true','preparation retry replays');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.zoe_v3_lab_candidates(100,null,null))a where a->>'appointmentId'=pg_temp.id(20)::text and a->'postedKinds'?'prep'),'candidate carries posted kind to avoid replay budget');
select pg_temp.ok(public.zoe_v3_lab_card_post(pg_temp.id(20),0,'fasting',pg_temp.id(71))->>'ok'='true','service posts fasting');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.zoe_v3_lab_candidates(100,null,null))a where a->>'appointmentId'=pg_temp.id(20)::text),'fully posted appointment leaves outstanding candidates');
select pg_temp.ok((select count(*)=2 from public.zoe_chat_cards where member_id=pg_temp.id(1)and kind in('prep','fasting')),'one scheduled card per kind');
rollback;
