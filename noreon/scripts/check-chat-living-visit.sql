-- Isolated local replay only. Fictional facts and every write roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.lv_id(n int)returns uuid language sql immutable as $$select('bc170000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.lv_ok(v boolean,label text)returns void language plpgsql as $$begin if v is distinct from true then raise exception 'TEST %',label;end if;end$$;
set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)values(pg_temp.lv_id(1),'37499001701',now()),(pg_temp.lv_id(2),'37499001702',now());
insert into public.profiles(id,locale,ui_locale,display_name)values(pg_temp.lv_id(1),'hy','hy','Synthetic one'),(pg_temp.lv_id(2),'hy','ru','Synthetic two');
insert into public.patient_clinical_cases(user_id)values(pg_temp.lv_id(1)),(pg_temp.lv_id(2));
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version='living-visit-check'where singleton;
insert into public.zoe_consents(member_id,kind,granted,wording_version,source)
 select pg_temp.lv_id(n),'zoe_reads_messages',true,'living-visit-check','zoe_screen'from generate_series(1,2)n;
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages)
 values(true,'living-visit-check',600,600,600,10)on conflict(singleton)do nothing;
update public.conversation_policy set app_chat_enabled=true,zoe_chat_actions_enabled=true where singleton;
update public.nurse_visit_settings set enabled=true;
insert into public.patient_test_requests(id,user_id,status,requested_terms,requirements,algorithm_version,context_token,create_payload,current_arrangement,created_at)
 values(pg_temp.lv_id(10),pg_temp.lv_id(1),'confirmed','{"mode":"home"}',
 '[{"id":"lipid-panel","title":"Synthetic sample","method":"lab"},{"id":"urine-acr","title":"Synthetic sample two","method":"lab"}]',
 'synthetic','synthetic','{}',jsonb_build_object('terms',jsonb_build_object('mode','home','startsAt',now()-interval '1 hour','endsAt',now(),'location','Synthetic address')),now()-interval '2 days');
-- A real sent logistics request with a form that was opened BEFORE an unrelated appointment.
insert into public.zoe_chat_cards(id,member_id,request_id,kind,source,snapshot,state,outcome,created_at)
 values(pg_temp.lv_id(20),pg_temp.lv_id(2),pg_temp.lv_id(21),'visit','chip','{"v":1,"available":true,"next":null,"proposal":null,"attention":false}',
 'done',jsonb_build_object('booking',jsonb_build_object('kind','visit_request','doneAt',now()-interval '5 minutes')),now()-interval '3 days');
insert into public.booking_appointments(id,member_id,program_id,requirements_token,status,proposed_arrangement,proposed_reservation_id,notice_id,created_at)
 values(pg_temp.lv_id(22),pg_temp.lv_id(2),pg_temp.lv_id(23),'synthetic','notification-pending','{}',pg_temp.lv_id(24),pg_temp.lv_id(25),now()-interval '1 day');
reset session_replication_role;
select pg_temp.lv_ok(not has_function_privilege('authenticated','public.zoe_living_visit_sync(uuid)','execute'),'member cannot supply another member id or forge status');
select pg_temp.lv_ok(not has_function_privilege('anon','public.zoe_living_visit_sync(uuid)','execute'),'anonymous cannot sync');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare first jsonb;second jsonb;begin
 first:=public.zoe_living_visit_sync(pg_temp.lv_id(1));second:=public.zoe_living_visit_sync(pg_temp.lv_id(1));
 perform pg_temp.lv_ok(first=second,'same transition twice has exactly one revision and post');
 perform pg_temp.lv_ok(first#>>'{card,snapshot,living,status}'='confirmed','confirmed reads the actual home arrangement');
 perform pg_temp.lv_ok((select count(*)=1 from public.zoe_chat_cards where member_id=pg_temp.lv_id(1)and kind='visit'),'one persisted visit card');
 first:=public.zoe_living_visit_sync(pg_temp.lv_id(2));
 perform pg_temp.lv_ok(first#>>'{card,id}'=pg_temp.lv_id(20)::text,'sent request keeps its own card');
 perform pg_temp.lv_ok(first#>>'{card,snapshot,living,status}'='awaiting'and first#>>'{card,snapshot,living,source}'='request','unlinked request never adopts an unrelated appointment');
 perform pg_temp.lv_ok(public.zoe_living_visit_sync(pg_temp.lv_id(2))=first,'second menu request replays the existing request card');
end$$;
reset role;
set local session_replication_role=replica;
insert into public.nurse_visit_events(member_id,source,source_id,step,arrangement,submission_id,actor_id,actor_name,actor_role,occurred_at)
 values(pg_temp.lv_id(1),'home-request',pg_temp.lv_id(10),'started',now()-interval '1 hour',pg_temp.lv_id(30),pg_temp.lv_id(3),'Synthetic nurse','nurse',now()-interval '50 minutes');
reset session_replication_role;
set local role service_role;
select pg_temp.lv_ok(public.zoe_living_visit_sync(pg_temp.lv_id(1))#>>'{card,snapshot,living,status}'='arrived','arrival needs the recorded nurse started event');
reset role;
set local session_replication_role=replica;
insert into public.nurse_visit_marks(member_id,source,source_id,item,done,collection_status,arrangement,submission_id,actor_id,actor_name,recorded_at)
 values(pg_temp.lv_id(1),'home-request',pg_temp.lv_id(10),'sample:lipid-panel',true,'collected',now()-interval '1 hour',pg_temp.lv_id(31),pg_temp.lv_id(3),'Synthetic nurse',now()-interval '40 minutes');
insert into public.nurse_visit_events(member_id,source,source_id,step,arrangement,submission_id,actor_id,actor_name,actor_role,occurred_at)
 values(pg_temp.lv_id(1),'home-request',pg_temp.lv_id(10),'samples-collected',now()-interval '1 hour',pg_temp.lv_id(32),pg_temp.lv_id(3),'Synthetic nurse','nurse',now()-interval '30 minutes');
reset session_replication_role;
set local role service_role;
select pg_temp.lv_ok(public.zoe_living_visit_sync(pg_temp.lv_id(1))#>>'{card,snapshot,living,status}'='arrived','partial samples do not advance');
reset role;
set local session_replication_role=replica;
insert into public.nurse_visit_marks(member_id,source,source_id,item,done,collection_status,arrangement,submission_id,actor_id,actor_name,recorded_at)
 values(pg_temp.lv_id(1),'home-request',pg_temp.lv_id(10),'sample:urine-acr',true,'collected',now()-interval '1 hour',pg_temp.lv_id(33),pg_temp.lv_id(3),'Synthetic nurse',now()-interval '25 minutes');
reset session_replication_role;
set local role service_role;
do $$declare first jsonb;begin
 first:=public.zoe_living_visit_sync(pg_temp.lv_id(1));
 perform pg_temp.lv_ok(first#>>'{card,snapshot,living,status}'='samples_collected','all current samples plus collection event');
 perform pg_temp.lv_ok(public.zoe_living_visit_sync(pg_temp.lv_id(1))=first,'duplicate collection adds no post');
end$$;
reset role;
set local session_replication_role=replica;
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id)
 values(pg_temp.lv_id(40),pg_temp.lv_id(1),pg_temp.lv_id(3),'Synthetic nurse','nurse',pg_temp.lv_id(4));
insert into public.nurse_visit_completions(member_id,source,source_id,visit_id,submission_id,command,summary,result,actor_id,actor_name)
 values(pg_temp.lv_id(1),'home-request',pg_temp.lv_id(10),pg_temp.lv_id(40),pg_temp.lv_id(41),'{}','{}','{}',pg_temp.lv_id(3),'Synthetic nurse');
insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at)
 values(pg_temp.lv_id(42),pg_temp.lv_id(1),'Synthetic doctor','Synthetic only',now()-interval '10 minutes');
insert into public.patient_clinical_publications(id,user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft,published_at)
 values(pg_temp.lv_id(43),pg_temp.lv_id(1),pg_temp.lv_id(42),pg_temp.lv_id(44),pg_temp.lv_id(3),1,'synthetic',jsonb_build_object('visits',jsonb_build_array(jsonb_build_object('id',pg_temp.lv_id(40)))),'{}','{}',now()-interval '10 minutes');
reset session_replication_role;
set local role service_role;
do $$declare first jsonb;begin
 first:=public.zoe_living_visit_sync(pg_temp.lv_id(1));
 perform pg_temp.lv_ok(first#>>'{card,snapshot,living,status}'='plan_published','published active plan includes the same visit in evidence');
 perform pg_temp.lv_ok(public.zoe_living_visit_sync(pg_temp.lv_id(1))=first,'publication replay adds no post');
 perform pg_temp.lv_ok((select count(*)=4 from jsonb_object_keys(first#>'{card,outcome}')k where k like 'visit:%'),'one post per observed status');
end$$;
reset role;
set local session_replication_role=replica;
update public.patient_test_requests set status='cancelled'where id=pg_temp.lv_id(10);
reset session_replication_role;
set local role service_role;
select pg_temp.lv_ok(public.zoe_living_visit_sync(pg_temp.lv_id(1))#>>'{card,snapshot,available}'='false','cancelled visit is unavailable, never awaiting confirmation');
reset role;
set local session_replication_role=replica;
insert into public.booking_appointments(id,member_id,program_id,requirements_token,status,proposed_arrangement,proposed_reservation_id,notice_id,created_at)
 values(pg_temp.lv_id(50),pg_temp.lv_id(1),pg_temp.lv_id(51),'synthetic-newest-failed','failed','{}',pg_temp.lv_id(52),pg_temp.lv_id(53),now());
reset session_replication_role;
set local role service_role;
do $$declare current jsonb;begin
 current:=public.zoe_living_visit_sync(pg_temp.lv_id(1));
 perform pg_temp.lv_ok(current#>>'{card,snapshot,living,visitId}'=pg_temp.lv_id(50)::text,'newest unavailable visit replaces the old visit as the menu target');
 perform pg_temp.lv_ok(current#>>'{card,snapshot,available}'='false'and current#>'{card,outcome}'='{}'::jsonb,'failure before first sync adds no awaiting message');
end$$;
reset role;
-- Clinic-managed appointment: no nurse started/completion record exists.
set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)values(pg_temp.lv_id(60),'37499001760',now());
insert into public.profiles(id,locale,display_name)values(pg_temp.lv_id(60),'en','Synthetic clinic member');
insert into public.patient_clinical_cases(user_id)values(pg_temp.lv_id(60));
insert into public.zoe_consents(member_id,kind,granted,wording_version,source)
 values(pg_temp.lv_id(60),'zoe_reads_messages',true,'living-visit-check','zoe_screen');
insert into public.workspace_clinics(id,name,address)values(pg_temp.lv_id(61),'Synthetic clinic','Synthetic address');
insert into public.booking_program_seals(id,member_id,actor_id,source_token,requirements_token,engine_version,program)
 values(pg_temp.lv_id(62),pg_temp.lv_id(60),pg_temp.lv_id(3),'synthetic','synthetic','synthetic',
 '{"items":[{"id":"lipid-panel","title":"Synthetic lipid","method":"lab"},{"id":"urine-acr","title":"Synthetic urine","method":"lab"}]}');
insert into public.booking_appointments(id,member_id,program_id,requirements_token,revision,status,proposed_arrangement,proposed_reservation_id,notice_id,created_at)
 values(pg_temp.lv_id(63),pg_temp.lv_id(60),pg_temp.lv_id(62),'synthetic',1,'notification-pending',
 jsonb_build_object('clinicId',pg_temp.lv_id(61),'mode','clinic','location','Synthetic address','startsAt',now()-interval '2 hours','endsAt',now()-interval '1 hour','coveredTestIds',jsonb_build_array('lipid-panel','urine-acr')),
 pg_temp.lv_id(64),pg_temp.lv_id(65),now()-interval '2 days');
insert into public.clinic_booking_proposals(id,clinic_id,appointment_id,appointment_revision,capacity_key,starts_at,ends_at,actor_id,membership_id)
 values(pg_temp.lv_id(66),pg_temp.lv_id(61),pg_temp.lv_id(63),1,'synthetic',now()-interval '2 hours',now()-interval '1 hour',pg_temp.lv_id(3),pg_temp.lv_id(67));
reset session_replication_role;
set local role service_role;
do $$declare first jsonb;begin
 first:=public.zoe_living_visit_sync(pg_temp.lv_id(60));
 perform pg_temp.lv_ok(first#>>'{card,snapshot,living,status}'='awaiting','a proposal is not a confirmation');
 perform pg_temp.lv_ok(first#>>'{card,snapshot,proposal,proposalId}'=pg_temp.lv_id(66)::text,'living snapshot retains the open clinic proposal');
 perform pg_temp.lv_ok(public.zoe_living_visit_sync(pg_temp.lv_id(60))=first,'pending proposal poll is idempotent');
end$$;
reset role;
set local session_replication_role=replica;
-- Fixture represents acceptance by the existing booking command (its guards have separate checks).
update public.clinic_booking_proposals set state='accepted',decided_at=now(),decided_by=pg_temp.lv_id(60)where id=pg_temp.lv_id(66);
update public.booking_appointments set status='confirmed',current_arrangement=proposed_arrangement,current_reservation_id=proposed_reservation_id where id=pg_temp.lv_id(63);
insert into public.booking_appointment_versions(appointment_id,revision,program_id,proposed_arrangement,notice_id,actor_id)
 select id,revision,program_id,current_arrangement,notice_id,pg_temp.lv_id(3)from public.booking_appointments where id=pg_temp.lv_id(63);
reset session_replication_role;
set local role service_role;
do $$declare current jsonb;begin
 current:=public.zoe_living_visit_sync(pg_temp.lv_id(60));
 perform pg_temp.lv_ok(current#>>'{card,snapshot,living,status}'='confirmed'and current#>'{card,snapshot,proposal}'='null'::jsonb,'acceptance confirms and clears the proposal');
 perform pg_temp.lv_ok((select count(*)=1 from public.zoe_chat_cards where member_id=pg_temp.lv_id(60)and kind='visit'),'acceptance refreshes one card');
end$$;
reset role;
set local session_replication_role=replica;
insert into public.clinic_booking_checkins(clinic_id,appointment_id,reservation_id,outcome,actor_id,membership_id)
 values(pg_temp.lv_id(61),pg_temp.lv_id(63),pg_temp.lv_id(64),'arrived',pg_temp.lv_id(3),pg_temp.lv_id(67));
reset session_replication_role;
set local role service_role;
select pg_temp.lv_ok(public.zoe_living_visit_sync(pg_temp.lv_id(60))#>>'{card,snapshot,living,status}'='arrived','clinic arrival needs no nurse event');
reset role;
set local session_replication_role=replica;
insert into public.clinic_booking_checkins(clinic_id,appointment_id,reservation_id,outcome,actor_id,membership_id)
 values(pg_temp.lv_id(61),pg_temp.lv_id(63),pg_temp.lv_id(64),'no-show',pg_temp.lv_id(3),pg_temp.lv_id(67));
reset session_replication_role;
set local role service_role;
select pg_temp.lv_ok(public.zoe_living_visit_sync(pg_temp.lv_id(60))#>>'{card,snapshot,living,status}'='confirmed','a corrected no-show retains authoritative attendance semantics');
reset role;
set local session_replication_role=replica;
insert into public.clinic_booking_checkins(clinic_id,appointment_id,reservation_id,outcome,actor_id,membership_id)
 values(pg_temp.lv_id(61),pg_temp.lv_id(63),pg_temp.lv_id(64),'arrived',pg_temp.lv_id(3),pg_temp.lv_id(67));
reset session_replication_role;
set local role service_role;
select pg_temp.lv_ok(public.zoe_living_visit_sync(pg_temp.lv_id(60))#>>'{card,snapshot,living,status}'='arrived','restored clinic arrival');
reset role;
set local session_replication_role=replica;
insert into public.clinic_booking_checkins(clinic_id,appointment_id,reservation_id,outcome,actor_id,membership_id,source)
 values(pg_temp.lv_id(61),pg_temp.lv_id(63),pg_temp.lv_id(64),'completed',pg_temp.lv_id(3),pg_temp.lv_id(67),'inferred-from-result-upload');
reset session_replication_role;
set local role service_role;
select pg_temp.lv_ok(public.zoe_living_visit_sync(pg_temp.lv_id(60))#>>'{card,snapshot,living,status}'='arrived','completed never resets arrival or invents collection');
reset role;
set local session_replication_role=replica;
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id,appointment_id,accepted_revision,booking_context)
 values(pg_temp.lv_id(68),pg_temp.lv_id(60),pg_temp.lv_id(3),'Synthetic nurse','nurse',pg_temp.lv_id(61),pg_temp.lv_id(63),1,jsonb_build_object('appointmentId',pg_temp.lv_id(63)));
insert into public.patient_care_visit_entries(user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id)
 values(pg_temp.lv_id(60),pg_temp.lv_id(68),pg_temp.lv_id(69),1,'{"kind":"collection","testId":"lipid-panel","outcome":"collected"}',(now()-interval '30 minutes')::text,now()-interval '30 minutes',pg_temp.lv_id(3),'Synthetic nurse','nurse',pg_temp.lv_id(61));
reset session_replication_role;
set local role service_role;
select pg_temp.lv_ok(public.zoe_living_visit_sync(pg_temp.lv_id(60))#>>'{card,snapshot,living,status}'='arrived','clinic completion with partial lab entries stays arrived');
reset role;
set local session_replication_role=replica;
insert into public.patient_care_visit_entries(user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id)
 values(pg_temp.lv_id(60),pg_temp.lv_id(68),pg_temp.lv_id(69),2,'{"kind":"collection","testId":"urine-acr","outcome":"collected"}',(now()-interval '30 minutes')::text,now()-interval '30 minutes',pg_temp.lv_id(3),'Synthetic nurse','nurse',pg_temp.lv_id(61));
insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at)
 values(pg_temp.lv_id(70),pg_temp.lv_id(60),'Synthetic doctor','Synthetic only',now()-interval '10 minutes');
reset session_replication_role;
set local role service_role;
select pg_temp.lv_ok(public.zoe_living_visit_sync(pg_temp.lv_id(60))#>>'{card,snapshot,living,status}'='samples_collected','all booked lab entries advance, draft without publication does not');
reset role;
set local session_replication_role=replica;
insert into public.patient_clinical_publications(id,user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft,published_at)
 values(pg_temp.lv_id(71),pg_temp.lv_id(60),pg_temp.lv_id(70),pg_temp.lv_id(72),pg_temp.lv_id(3),1,'synthetic',jsonb_build_object('visits',jsonb_build_array(jsonb_build_object('id',pg_temp.lv_id(68)))),'{}','{}',now()-interval '10 minutes');
reset session_replication_role;
set local role service_role;
do $$declare first jsonb;begin
 first:=public.zoe_living_visit_sync(pg_temp.lv_id(60));
 perform pg_temp.lv_ok(first#>>'{card,snapshot,living,status}'='plan_published','completed clinic visit advances with its collection and matching publication');
 perform pg_temp.lv_ok(public.zoe_living_visit_sync(pg_temp.lv_id(60))=first,'clinic publication retry keeps its card and revision');
end$$;
reset role;

-- A second proposal on an accepted, still-unattended appointment keeps one done card.
-- Isolated appointment so the collection/publication fixtures above stay independent.
set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)values(pg_temp.lv_id(90),'37499001790',now());
insert into public.profiles(id,locale,display_name)values(pg_temp.lv_id(90),'en','Synthetic repeat proposal');
insert into public.patient_clinical_cases(user_id)values(pg_temp.lv_id(90));
insert into public.zoe_consents(member_id,kind,granted,wording_version,source)
 values(pg_temp.lv_id(90),'zoe_reads_messages',true,'living-visit-check','zoe_screen');
insert into public.booking_program_seals(id,member_id,actor_id,source_token,requirements_token,engine_version,program)
 select pg_temp.lv_id(91),pg_temp.lv_id(90),actor_id,source_token,requirements_token,engine_version,program from public.booking_program_seals where id=pg_temp.lv_id(62);
insert into public.booking_appointments(id,member_id,program_id,requirements_token,revision,status,proposed_arrangement,proposed_reservation_id,notice_id,created_at)
 select pg_temp.lv_id(92),pg_temp.lv_id(90),pg_temp.lv_id(91),requirements_token,revision,'notification-pending',proposed_arrangement,pg_temp.lv_id(93),pg_temp.lv_id(94),created_at from public.booking_appointments where id=pg_temp.lv_id(63);
insert into public.clinic_booking_proposals(id,clinic_id,appointment_id,appointment_revision,capacity_key,starts_at,ends_at,actor_id,membership_id)
 select pg_temp.lv_id(95),clinic_id,pg_temp.lv_id(92),appointment_revision,capacity_key,starts_at,ends_at,actor_id,membership_id from public.clinic_booking_proposals where id=pg_temp.lv_id(66);
reset session_replication_role;
set local role service_role;
do $$declare first jsonb;r jsonb;cid uuid;begin
 first:=public.zoe_living_visit_sync(pg_temp.lv_id(90));cid:=(first#>>'{card,id}')::uuid;
 -- Simulate A accepted by the pre-fix app, including its legacy claim and receipt.
 r:=public.zoe_chat_card_claim(pg_temp.lv_id(90),cid,'accepted',pg_temp.lv_id(96),jsonb_build_object('proposalId',pg_temp.lv_id(95)));
 perform pg_temp.lv_ok(r->>'ok'='true','A takes its original claim');
 r:=public.zoe_chat_card_record(pg_temp.lv_id(90),cid,'accepted',jsonb_build_object('proposalId',pg_temp.lv_id(95),'commandId',pg_temp.lv_id(96)),true);
 perform pg_temp.lv_ok(r#>>'{card,state}'='done','A acceptance closes the card');
 perform pg_temp.lv_ok(r#>>'{card,outcome,accepted,doneAt}'is not null,'A receipt retains the database action timestamp');
end$$;
reset role;
set local session_replication_role=replica;
update public.clinic_booking_proposals set state='accepted',decided_at=now(),decided_by=pg_temp.lv_id(90)where id=pg_temp.lv_id(95);
update public.booking_appointments set status='confirmed',current_arrangement=proposed_arrangement,current_reservation_id=proposed_reservation_id where id=pg_temp.lv_id(92);
reset session_replication_role;
set local role service_role;
select pg_temp.lv_ok(public.zoe_living_visit_sync(pg_temp.lv_id(90))#>'{card,snapshot,proposal}'='null'::jsonb,'A reconciliation clears only the proposal snapshot');
reset role;
set local session_replication_role=replica;
insert into public.clinic_booking_proposals(id,clinic_id,appointment_id,appointment_revision,capacity_key,starts_at,ends_at,actor_id,membership_id)
 select pg_temp.lv_id(97),clinic_id,appointment_id,appointment_revision,capacity_key,starts_at+interval '15 minutes',ends_at+interval '15 minutes',actor_id,membership_id from public.clinic_booking_proposals where id=pg_temp.lv_id(95);
reset session_replication_role;
set local role service_role;
do $$declare before_b public.zoe_chat_cards;after_b public.zoe_chat_cards;current jsonb;r jsonb;replay jsonb;cid uuid;item text:='accepted:'||pg_temp.lv_id(97)::text;begin
 select * into before_b from public.zoe_chat_cards where member_id=pg_temp.lv_id(90)and kind='visit';cid:=before_b.id;
 current:=public.zoe_living_visit_sync(pg_temp.lv_id(90));
 perform pg_temp.lv_ok(current#>>'{card,id}'=cid::text and current#>>'{card,state}'='done','B attaches to the same accepted card without reopening');
 perform pg_temp.lv_ok(current#>>'{card,snapshot,proposal,proposalId}'=pg_temp.lv_id(97)::text,'B is the current actionable proposal');
 perform pg_temp.lv_ok((current#>>'{card,snapshot,living,revision}')::int=(before_b.snapshot#>>'{living,revision}')::int+1,'B appends a snapshot revision');
 perform pg_temp.lv_ok(current#>'{card,outcome}'@>before_b.outcome and current#>'{card,claims}'=before_b.claims,'A history is preserved');
 perform pg_temp.lv_ok(public.zoe_living_visit_sync(pg_temp.lv_id(90))=current,'B poll replays the same revision');
 r:=public.zoe_chat_card_claim(pg_temp.lv_id(90),cid,'accepted:'||pg_temp.lv_id(95)::text,pg_temp.lv_id(98),jsonb_build_object('proposalId',pg_temp.lv_id(95)));
 perform pg_temp.lv_ok(r->>'code'='conflict','a stale A claim cannot claim B');
 r:=public.zoe_chat_card_claim(pg_temp.lv_id(90),cid,item,pg_temp.lv_id(98),jsonb_build_object('proposalId',pg_temp.lv_id(95)));
 perform pg_temp.lv_ok(r->>'code'='conflict','B item cannot carry A payload');
 r:=public.zoe_chat_card_claim(pg_temp.lv_id(90),cid,'unrelated',pg_temp.lv_id(98),'{}');
 perform pg_temp.lv_ok(r->>'code'='closed','other items still cannot claim a done card');
 select * into after_b from public.zoe_chat_cards where id=cid;
 perform pg_temp.lv_ok(after_b.claims=before_b.claims and after_b.outcome=current#>'{card,outcome}','stale and unrelated presses write nothing');
 r:=public.zoe_chat_card_claim(pg_temp.lv_id(90),cid,item,pg_temp.lv_id(98),jsonb_build_object('proposalId',pg_temp.lv_id(97)));
 perform pg_temp.lv_ok(r->>'ok'='true','B may claim the completed living card');
 replay:=public.zoe_chat_card_claim(pg_temp.lv_id(90),cid,item,pg_temp.lv_id(99),jsonb_build_object('proposalId',pg_temp.lv_id(97)));
 perform pg_temp.lv_ok(replay->'claim'=r->'claim','B retries keep the first booking command id');
 r:=public.zoe_chat_card_record(pg_temp.lv_id(90),cid,item,jsonb_build_object('proposalId',pg_temp.lv_id(97),'commandId',pg_temp.lv_id(99)),true);
 perform pg_temp.lv_ok(r->>'code'='invalid','a different booking command cannot finish B');
 perform pg_temp.lv_ok((select count(*)=1 from public.zoe_chat_cards where member_id=pg_temp.lv_id(90)and kind='visit'),'B creates no duplicate card');
end$$;
reset role;
-- Simulate the booking command accepting B and a poll winning the race before receipt recording.
set local session_replication_role=replica;
update public.clinic_booking_proposals set state='accepted',decided_at=now(),decided_by=pg_temp.lv_id(90)where id=pg_temp.lv_id(97);
update public.booking_appointments set current_arrangement=jsonb_set(jsonb_set(current_arrangement,'{startsAt}',to_jsonb(now()-interval '105 minutes')),'{endsAt}',to_jsonb(now()-interval '45 minutes'))where id=pg_temp.lv_id(92);
reset session_replication_role;
set local role service_role;
do $$declare current jsonb;r jsonb;replay jsonb;cid uuid;item text:='accepted:'||pg_temp.lv_id(97)::text;value jsonb:=jsonb_build_object('proposalId',pg_temp.lv_id(97),'commandId',pg_temp.lv_id(98));begin
 current:=public.zoe_living_visit_sync(pg_temp.lv_id(90));cid:=(current#>>'{card,id}')::uuid;
 perform pg_temp.lv_ok(current#>'{card,snapshot,proposal}'='null'::jsonb,'a poll may clear B before the receipt is recorded');
 r:=public.zoe_chat_card_claim(pg_temp.lv_id(90),cid,item,pg_temp.lv_id(99),jsonb_build_object('proposalId',pg_temp.lv_id(97)));
 perform pg_temp.lv_ok(r->>'ok'='true'and r#>>'{claim,op}'=pg_temp.lv_id(98)::text,'claim replay after sync keeps the original command');
 r:=public.zoe_chat_card_claim(pg_temp.lv_id(90),cid,'accepted:'||pg_temp.lv_id(102)::text,pg_temp.lv_id(99),jsonb_build_object('proposalId',pg_temp.lv_id(102)));
 perform pg_temp.lv_ok(r->>'code'='conflict','no new proposal claim is allowed after sync clears the proposal');

 r:=public.zoe_chat_card_record(pg_temp.lv_id(90),cid,item,value,true);
 perform pg_temp.lv_ok(r->>'ok'='true'and r#>>'{card,state}'='done','B appends a receipt while retaining done');
 perform pg_temp.lv_ok(r#>>array['card','outcome',item,'doneAt']is not null,'B receipt gets its own action timestamp');
 perform pg_temp.lv_ok(r#>'{card,outcome,accepted}'=current#>'{card,outcome,accepted}','B never rewrites A receipt');
 replay:=public.zoe_chat_card_record(pg_temp.lv_id(90),cid,item,value,true);
 perform pg_temp.lv_ok(replay->>'replayed'='true'and replay->'card'=r->'card','B receipt retries replay exactly');
 r:=public.zoe_chat_card_record(pg_temp.lv_id(90),cid,'accepted',jsonb_build_object('proposalId',pg_temp.lv_id(95),'commandId',pg_temp.lv_id(96)),true);
 perform pg_temp.lv_ok(r->>'replayed'='true','legacy A receipt still replays after B');
 begin
  update public.zoe_chat_cards set state='open'where id=cid;
  raise exception 'TEST done card reopened';
 exception when check_violation then null;end;
end$$;
reset role;

-- A persisted acceptance claim never bypasses the global chat-action switch.
update public.conversation_policy set zoe_chat_actions_enabled=false where singleton;
set local role service_role;
do $$declare cid uuid;r jsonb;before_claims jsonb;before_outcome jsonb;begin
 select id,claims,outcome into cid,before_claims,before_outcome from public.zoe_chat_cards where member_id=pg_temp.lv_id(90)and kind='visit';
 r:=public.zoe_chat_card_claim(pg_temp.lv_id(90),cid,'accepted:'||pg_temp.lv_id(97)::text,pg_temp.lv_id(99),jsonb_build_object('proposalId',pg_temp.lv_id(97)));
 perform pg_temp.lv_ok(r->>'code'='disabled','a replayed proposal claim still checks the action switch');
 perform pg_temp.lv_ok((select claims=before_claims and outcome=before_outcome from public.zoe_chat_cards where id=cid),'disabled claim replay writes nothing');
end$$;
reset role;
update public.conversation_policy set zoe_chat_actions_enabled=true where singleton;

-- The generic record RPC still timestamps ordinary actions and replays their original timestamp.
set local role service_role;
do $$declare posted jsonb;r jsonb;replay jsonb;cid uuid;begin
 posted:=public.zoe_chat_card_post(pg_temp.lv_id(90),pg_temp.lv_id(100),'message','chip',null,'{"v":1}');
 cid:=(posted#>>'{card,id}')::uuid;
 perform pg_temp.lv_ok(cid is not null,'ordinary message fixture posts');
 perform public.zoe_chat_card_claim(pg_temp.lv_id(90),cid,'sent:synthetic',pg_temp.lv_id(101),'{}');
 r:=public.zoe_chat_card_record(pg_temp.lv_id(90),cid,'sent:synthetic','{"sent":true}',true);
 perform pg_temp.lv_ok(r#>>'{card,outcome,sent:synthetic,doneAt}'is not null,'ordinary receipts still get action timestamps');
 replay:=public.zoe_chat_card_record(pg_temp.lv_id(90),cid,'sent:synthetic','{"sent":true}',true);
 perform pg_temp.lv_ok(replay->>'replayed'='true'and replay->'card'=r->'card','ordinary timestamped receipts replay without changing time');
end$$;
reset role;

-- Old five-argument RPC keeps the supplied child readable to the old strict adapter.
select pg_temp.lv_ok(not has_function_privilege('authenticated','public.zoe_v3_next_step_follow_living(uuid,uuid,uuid,text,jsonb)','execute'),'new follow is service-only');
set local role service_role;
do $$declare parent jsonb;opened jsonb;replay jsonb;live jsonb;
 old_snapshot jsonb:='{"v":1,"available":true,"next":null,"proposal":null,"attention":false}';begin
 parent:=public.zoe_v3_next_step_sync(pg_temp.lv_id(60),pg_temp.lv_id(80),null,clock_timestamp(),'{"v":1,"stage":"legacy-visit","target":"visit"}');
 opened:=public.zoe_v3_next_step_follow(pg_temp.lv_id(60),(parent#>>'{card,id}')::uuid,pg_temp.lv_id(81),'visit',old_snapshot);
 perform pg_temp.lv_ok(opened->>'ok'='true'and opened#>'{next,snapshot}'=old_snapshot,'old adapter gets exactly its readable child against the new schema');
 replay:=public.zoe_v3_next_step_follow(pg_temp.lv_id(60),(parent#>>'{card,id}')::uuid,pg_temp.lv_id(81),'visit','{}');
 perform pg_temp.lv_ok(replay=opened,'old adapter lost reply replays the same readable child');
 live:=public.zoe_living_visit_sync(pg_temp.lv_id(60));
 parent:=public.zoe_v3_next_step_sync(pg_temp.lv_id(60),pg_temp.lv_id(82),(parent#>>'{card,id}')::uuid,clock_timestamp(),'{"v":1,"stage":"living-visit","target":"visit"}');
 opened:=public.zoe_v3_next_step_follow_living(pg_temp.lv_id(60),(parent#>>'{card,id}')::uuid,pg_temp.lv_id(83),'visit',old_snapshot);
 perform pg_temp.lv_ok(opened->>'ok'='true'and opened#>>'{next,id}'=live#>>'{card,id}','new adapter explicitly reconciles and reuses the living card');
 perform pg_temp.lv_ok(opened#>>'{card,outcome,next_step,requestId}'=live#>>'{card,requestId}','new receipt uses the actual living card request id');
 replay:=public.zoe_v3_next_step_follow_living(pg_temp.lv_id(60),(parent#>>'{card,id}')::uuid,pg_temp.lv_id(83),'visit','{}');
 perform pg_temp.lv_ok(replay=opened,'new adapter lost reply replays the same child');
end$$;
reset role;

-- Existing RLS still protects every refreshed card.
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lv_id(2))::text,true);
set local role authenticated;
select pg_temp.lv_ok(not exists(select 1 from public.zoe_chat_cards where member_id=pg_temp.lv_id(1)),'another member cannot read refreshed snapshots');
reset role;
rollback;
