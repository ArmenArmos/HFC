-- PR8 steps 1-6. Run against a freshly replayed, isolated local database. All synthetic writes roll back.
\set ON_ERROR_STOP on
begin;
set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)values
 ('ce800000-0000-4000-8000-000000000001','37499008001',now()),
 ('ce800000-0000-4000-8000-000000000002','37499008002',now());
insert into public.profiles(id,locale,display_name)values('ce800000-0000-4000-8000-000000000001','en','Synthetic one'),('ce800000-0000-4000-8000-000000000002','en','Synthetic two');
insert into public.member_medicines(id,user_id,name,dose,times,started_on)values
 ('ce800000-0000-4000-8000-000000000041','ce800000-0000-4000-8000-000000000001','Atorvastatin','20 mg',array['08:00'::time],current_date),
 ('ce800000-0000-4000-8000-000000000042','ce800000-0000-4000-8000-000000000001','Other medicine','5 mg',array['09:00'::time],current_date);
insert into public.patient_clinical_cases(user_id)values('ce800000-0000-4000-8000-000000000001'),('ce800000-0000-4000-8000-000000000002');
insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at,active)values
 ('ce800000-0000-4000-8000-000000000011','ce800000-0000-4000-8000-000000000001','Synthetic doctor','Exact published instructions',now()-interval '1 day',true),
 ('ce800000-0000-4000-8000-000000000012','ce800000-0000-4000-8000-000000000001','Synthetic doctor','Replacement instructions',now()-interval '1 hour',false);
-- FK/side-effect triggers are disabled only during synthetic fixture insertion.
insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft,published_at)
 select user_id,id,gen_random_uuid(),'ce800000-0000-4000-8000-000000000002',row_number()over(order by published_at),'fixture','{}','{}','{}',published_at
 from public.patient_care_plans where user_id='ce800000-0000-4000-8000-000000000001';
insert into public.patient_care_plan_versions(plan_id,user_id,version)
 select id,user_id,row_number()over(order by published_at) from public.patient_care_plans where user_id='ce800000-0000-4000-8000-000000000001';
insert into public.patient_care_medications(id,user_id,plan_id,name,dose,instructions,times,start_date,effective_at)values
 ('ce800000-0000-4000-8000-000000000031','ce800000-0000-4000-8000-000000000001','ce800000-0000-4000-8000-000000000011','Rosuvastatin','20 mg','Exact instructions',array['00:00'::time],current_date-2,now()-interval '1 day'),
 ('ce800000-0000-4000-8000-000000000032','ce800000-0000-4000-8000-000000000001','ce800000-0000-4000-8000-000000000011','Perindopril','5 mg','Exact instructions',array['00:00'::time],current_date-2,now()-interval '1 day');
insert into public.zoe_chat_cards(id,member_id,request_id,kind,source,snapshot)values
 ('ce800000-0000-4000-8000-000000000021','ce800000-0000-4000-8000-000000000001',gen_random_uuid(),'plan','chip','{"v":1,"plan":{"id":"ce800000-0000-4000-8000-000000000011"},"v3":{"planId":"ce800000-0000-4000-8000-000000000011","version":1}}'),
 ('ce800000-0000-4000-8000-000000000022','ce800000-0000-4000-8000-000000000001',gen_random_uuid(),'plan','chip','{"v":1,"plan":{"id":"ce800000-0000-4000-8000-000000000012"},"v3":{"planId":"ce800000-0000-4000-8000-000000000012","version":2}}');
insert into public.zoe_chat_cards(id,member_id,request_id,kind,source,snapshot,claims)values
 ('ce800000-0000-4000-8000-000000000024','ce800000-0000-4000-8000-000000000001',gen_random_uuid(),'medicines','chip',jsonb_build_object('v',1,'token',repeat('a',64)),
 '{"medicines":{"op":"ce800000-0000-4000-8000-000000000025","payload":{"kind":"review","digest":"fixture","changes":[{"id":"ce800000-0000-4000-8000-000000000041","status":"course_stopped","stopReason":"decided_to_stop","stopConfirmed":true},{"id":"ce800000-0000-4000-8000-000000000042","status":"prn","stopReason":null,"stopConfirmed":false}],"added":[]}}}');
reset session_replication_role;
update public.member_medicine_settings set enabled=true where singleton;
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,app_chat_enabled,zoe_chat_actions_enabled)values(true,'plan-test',600,600,600,10,true,true)
 on conflict(singleton)do update set app_chat_enabled=true,zoe_chat_actions_enabled=true;
create temp table original_medicines as select * from public.patient_care_medications where user_id='ce800000-0000-4000-8000-000000000001';
create temp table original_plan as select * from public.patient_care_plans where user_id='ce800000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims','{"sub":"ce800000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare r jsonb;begin
 r:=public.zoe_v3_plan_state();
 if r->>'planId'is distinct from 'ce800000-0000-4000-8000-000000000011' or r->>'teachBackConfirmedAt' is not null then raise exception 'Old acknowledgement must not confirm teach-back';end if;
 if has_function_privilege('authenticated','public.zoe_v3_plan_confirm(uuid,uuid,uuid)','execute')then raise exception 'Member can name another member in service function';end if;
 if has_table_privilege('authenticated','public.patient_care_plan_versions','update')then raise exception 'Direct version update is allowed';end if;
 if has_function_privilege('anon','public.zoe_v3_plan_state()','execute')then raise exception 'Anonymous plan state is allowed';end if;
end$$;
reset role;

select set_config('request.jwt.claims','{"sub":"ce800000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
-- Native list save is journaled atomically. Queue recovery must not reapply an older list.
do $$declare r jsonb;first_rows jsonb;medicines jsonb;begin
 if has_table_privilege('authenticated','public.zoe_v3_medicine_saves','select')or has_table_privilege('authenticated','public.zoe_v3_medicine_saves','update')then raise exception 'Direct medicine replay journal access';end if;
 r:=public.zoe_v3_medicines_save('ce800000-0000-4000-8000-000000000024');
 if r->>'status'is distinct from 'saved'or jsonb_array_length(r->'stops')is distinct from 1 then
  raise exception 'Native save marker missing (status %, stop count %)',r->>'status',jsonb_array_length(r->'stops');end if;
 first_rows:=r->'rows';
 r:=public.member_medicine_restore('ce800000-0000-4000-8000-000000000041');
 if r->>'status'<>'saved'then raise exception 'Newer restoration failed';end if;
 r:=public.member_medicines_review('[{"id":"ce800000-0000-4000-8000-000000000042","status":"continuous","stopReason":null}]','[]');
 if r->>'status'<>'saved'then raise exception 'Newer medicine edit failed';end if;
 r:=public.zoe_v3_medicines_save('ce800000-0000-4000-8000-000000000024');
 if r->'rows'is distinct from first_rows then raise exception 'Recovery lost original member receipt';end if;
 medicines:=public.member_medicine_details_read();
 if not exists(select 1 from jsonb_array_elements(medicines)m where m->>'id'='ce800000-0000-4000-8000-000000000041'and m->>'stopped'='false')
  or not exists(select 1 from jsonb_array_elements(medicines)m where m->>'id'='ce800000-0000-4000-8000-000000000042'and m->>'status'='continuous')then raise exception 'Recovery overwrote a newer medicine state';end if;
end$$;
reset role;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare r jsonb;saved jsonb;begin
 perform public.zoe_v3_reminders_run(((now()at time zone 'Asia/Yerevan')::date+time '12:00')at time zone 'Asia/Yerevan');
 if exists(select 1 from public.zoe_chat_cards where member_id='ce800000-0000-4000-8000-000000000001'and kind='dose')then raise exception 'Reminder before teach-back';end if;
 if(public.zoe_v3_plan_confirm('ce800000-0000-4000-8000-000000000002','ce800000-0000-4000-8000-000000000021',gen_random_uuid())->>'ok')::boolean then raise exception 'Another member confirmed this plan';end if;
 if(public.zoe_v3_plan_confirm('ce800000-0000-4000-8000-000000000001','ce800000-0000-4000-8000-000000000022',gen_random_uuid())->>'code')<>'stale'then raise exception 'Inactive replacement confirmed';end if;
 for i in 1..2 loop
  r:=public.zoe_v3_plan_confirm('ce800000-0000-4000-8000-000000000001','ce800000-0000-4000-8000-000000000021',gen_random_uuid());
  if not coalesce((r->>'ok')::boolean,false)then raise exception 'Confirmation failed';end if;
  if i=1 then saved:=r#>'{card,outcome,plan}';
  elsif r#>'{card,outcome,plan}' is distinct from saved then raise exception 'Replay changed action time';end if;
 end loop;
end$$;
reset role;
do $$begin
 if exists(select * from original_plan except select * from public.patient_care_plans)then raise exception 'Member action changed the doctor plan';end if;
 if(select teach_back_confirmed_at from public.patient_care_plan_versions where plan_id='ce800000-0000-4000-8000-000000000011')is null then raise exception 'Missing confirmation';end if;
 if(select state from public.zoe_chat_cards where id='ce800000-0000-4000-8000-000000000021')<>'done'then raise exception 'Missing dialog receipt';end if;
 begin
  update public.patient_care_plan_versions set teach_back_confirmed_at=clock_timestamp() where plan_id='ce800000-0000-4000-8000-000000000011';
  raise exception 'Confirmation overwritten';
 exception when check_violation then null;end;
 begin
  update public.patient_care_plan_versions set version=20 where plan_id='ce800000-0000-4000-8000-000000000012';
  raise exception 'Clinical version edited';
 exception when check_violation then null;end;
end$$;

-- The reminder and member action risk path. Event, reason, task and receipt replay once.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare r jsonb;k public.zoe_chat_cards;aid uuid;due timestamptz;begin
 perform public.zoe_v3_reminders_run(((now()at time zone 'Asia/Yerevan')::date+time '01:00')at time zone 'Asia/Yerevan');
 if exists(select 1 from public.zoe_chat_cards where member_id='ce800000-0000-4000-8000-000000000001'and kind='dose')then raise exception 'Reminder during quiet hours';end if;
 perform public.zoe_v3_reminders_run(((now()at time zone 'Asia/Yerevan')::date+time '12:00')at time zone 'Asia/Yerevan');
 perform public.zoe_v3_reminders_run(((now()at time zone 'Asia/Yerevan')::date+time '12:05')at time zone 'Asia/Yerevan');
 if(select count(*)from public.zoe_chat_cards where member_id='ce800000-0000-4000-8000-000000000001'and kind='dose')<>2 then raise exception 'Reminder replay duplicated a card';end if;
 for k in select * from public.zoe_chat_cards where member_id='ce800000-0000-4000-8000-000000000001'and kind='dose'loop
  due:=(k.snapshot#>>'{slots,0,dueAt}')::timestamptz;
  if k.snapshot#>>'{slots,0,dose}'not in('20 mg','5 mg')then raise exception 'Dose changed in reminder';end if;
  for i in 1..2 loop
   r:=public.zoe_v3_dose_record(k.member_id,k.id,gen_random_uuid(),(k.snapshot#>>'{slots,0,medicineId}')::uuid,due,'skipped');
   if not coalesce((r->>'ok')::boolean,false)then raise exception 'Dose save failed';end if;
   aid:=(r#>>'{next,id}')::uuid;
   if aid is null then raise exception 'No reason card';end if;
  end loop;
  for i in 1..2 loop
   r:=public.zoe_v3_dose_reason(k.member_id,aid,gen_random_uuid(),case when k.snapshot#>>'{slots,0,dose}'='20 mg'then 'values_normal'else 'ran_out_or_cost'end,false);
   if not coalesce((r->>'ok')::boolean,false)then raise exception 'Reason save failed';end if;
  end loop;
 end loop;
 if(select count(*)from public.patient_dose_events where user_id='ce800000-0000-4000-8000-000000000001')<>2 then raise exception 'Dose replay duplicated an event';end if;
end$$;
reset role;
-- Queue tables are private even to service_role; inspect persisted tasks as the test owner.
do $$begin
 if(select count(*)from public.care_queue_tasks where member_id='ce800000-0000-4000-8000-000000000001'and reason_code='medicine_access_help')<>1 then raise exception 'Replay duplicated a coordinator task';end if;
 if exists(select 1 from public.care_queue_tasks where member_id='ce800000-0000-4000-8000-000000000001'and queue='admin'and(summary<>'{}'::jsonb or zone is not null or red_flags_status is not null))then raise exception 'Clinical content reached admin';end if;
end$$;
do $$begin
 if exists(select * from original_plan except select * from public.patient_care_plans)or exists(select * from original_medicines except select * from public.patient_care_medications)then raise exception 'Member action changed a published plan or regimen';end if;
end$$;
-- SAMS answer keys must pass the real shared claim/record contract.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare r jsonb;cid uuid;item text;begin
 r:=public.zoe_chat_card_post('ce800000-0000-4000-8000-000000000001',gen_random_uuid(),'sams','chip',null,jsonb_build_object('v',1,'episodeId',gen_random_uuid()));
 cid:=(r#>>'{card,id}')::uuid;
 foreach item in array array['a:musclepain','a:weakness','a:darkurine','a:fever','a:jaundice','a:rightupperpain']loop
  r:=public.zoe_chat_card_claim('ce800000-0000-4000-8000-000000000001',cid,item,gen_random_uuid(),'{"answer":false}');
  if not coalesce((r->>'ok')::boolean,false)then raise exception 'SAMS key rejected by claim';end if;
  r:=public.zoe_chat_card_record('ce800000-0000-4000-8000-000000000001',cid,item,'{"answer":false}',item='a:rightupperpain');
  if not coalesce((r->>'ok')::boolean,false)then raise exception 'SAMS key rejected by record';end if;
 end loop;
end$$;
reset role;
-- A typed SAMS red decision has no unrelated RF identifier and uses the existing care alert.
-- A fresh replay has no settings row: alerts stay dark until explicitly enabled.
insert into public.care_alert_settings(singleton,enabled,sandbox_test_accounts)values(true,true,true)
 on conflict(singleton)do update set enabled=true,sandbox_test_accounts=true;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare r jsonb;first_id text;begin
 for i in 1..2 loop
  r:=public.care_alert_screen('ce800000-0000-4000-8000-000000000001','zoe','sams:ce800000-0000-4000-8000-000000000021','escalate','sams_red','{}','zoe.sams','zones-v1-fixture');
  if not coalesce((r->>'ok')::boolean,false)or r->>'alertId'is null then raise exception 'SAMS red alert refused';end if;
  if i=1 then first_id:=r->>'alertId';elsif r->>'alertId'<>first_id then raise exception 'SAMS replay duplicated an alert';end if;
 end loop;
end$$;
reset role;
update public.conversation_policy set zoe_chat_actions_enabled=false where singleton;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$begin
 if public.zoe_v3_reminders_run()->>'state'<>'off'then raise exception 'Disabled scheduler ran';end if;
end$$;
reset role;
update public.conversation_policy set zoe_chat_actions_enabled=true where singleton;

-- An organizational +15 minute reminder may cross midnight. Keep the original dose identity.
set local session_replication_role=replica;
insert into public.patient_care_medications(id,user_id,plan_id,name,dose,instructions,times,start_date,effective_at)values
 ('ce800000-0000-4000-8000-000000000033','ce800000-0000-4000-8000-000000000001','ce800000-0000-4000-8000-000000000011','Exact night medicine','10 mg','Exact instructions',array['23:50'::time],current_date-2,now()-interval '1 day');
reset session_replication_role;
insert into public.patient_reminder_preferences(user_id,revision,preferences)values('ce800000-0000-4000-8000-000000000001',1,'{"medicationEnabled":true,"medicationOffsetMinutes":15,"bpEnabled":false,"bpTimes":["08:00","20:00"],"quietStart":"02:00","quietEnd":"00:00"}')
 on conflict(user_id)do update set revision=public.patient_reminder_preferences.revision+1,preferences=excluded.preferences;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare t date:=(now()at time zone 'Asia/Yerevan')::date+1;n integer;begin
 perform public.zoe_v3_reminders_run((t+time '00:04')at time zone 'Asia/Yerevan');
 select count(*)into n from public.zoe_chat_cards where member_id='ce800000-0000-4000-8000-000000000001'and kind='dose'and snapshot#>>'{slots,0,medicineId}'='ce800000-0000-4000-8000-000000000033';
 if n<>0 then raise exception 'Offset reminder delivered early';end if;
 perform public.zoe_v3_reminders_run((t+time '00:05')at time zone 'Asia/Yerevan');
 perform public.zoe_v3_reminders_run((t+time '00:06')at time zone 'Asia/Yerevan');
 select count(*)into n from public.zoe_chat_cards where member_id='ce800000-0000-4000-8000-000000000001'and kind='dose'and snapshot#>>'{slots,0,medicineId}'='ce800000-0000-4000-8000-000000000033'
  and (snapshot#>>'{slots,0,dueAt}')::timestamptz=((t-1)+time '23:50')at time zone 'Asia/Yerevan';
 if n<>1 then raise exception 'Midnight reminder lost or duplicated its original dose';end if;
end$$;
reset role;

-- PR8-02: an open A reminder and an unconfirmed B reminder are decided on reads, not by a cleanup job.
insert into public.zoe_chat_cards(id,member_id,request_id,kind,source,snapshot)
 select 'ce800000-0000-4000-8000-000000000061',member_id,gen_random_uuid(),kind,source,snapshot
 from public.zoe_chat_cards where member_id='ce800000-0000-4000-8000-000000000001'and kind='dose'limit 1;
insert into public.zoe_chat_cards(id,member_id,request_id,kind,source,snapshot)
 select 'ce800000-0000-4000-8000-000000000062',member_id,gen_random_uuid(),kind,source,
  jsonb_set(snapshot,'{slots,0,planId}','"ce800000-0000-4000-8000-000000000012"')
 from public.zoe_chat_cards where id='ce800000-0000-4000-8000-000000000061';
select set_config('request.jwt.claims','{"sub":"ce800000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare cards jsonb:=public.zoe_chat_cards_member()->'cards';begin
 if not exists(select 1 from jsonb_array_elements(cards)k where k->>'id'='ce800000-0000-4000-8000-000000000061')then raise exception 'Current confirmed A reminder missing';end if;
 if exists(select 1 from jsonb_array_elements(cards)k where k->>'id'='ce800000-0000-4000-8000-000000000062')then raise exception 'Unconfirmed B reminder visible';end if;
end$$;
reset role;
-- Simulate the publisher replacing the plan, without editing either publication.
set local session_replication_role=replica;
update public.patient_care_plans set active=false,retired_at=clock_timestamp() where id='ce800000-0000-4000-8000-000000000011';
update public.patient_care_plans set active=true where id='ce800000-0000-4000-8000-000000000012';
reset session_replication_role;
select set_config('request.jwt.claims','{"sub":"ce800000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare r jsonb;cards jsonb;begin
 r:=public.zoe_v3_plan_state();
 if r->>'planId'<>'ce800000-0000-4000-8000-000000000012' or r->>'teachBackConfirmedAt' is not null then raise exception 'A replacement inherited teach-back';end if;
 for i in 1..2 loop
  cards:=public.zoe_chat_cards_member()->'cards';
  if exists(select 1 from jsonb_array_elements(cards)k where k->>'kind'='dose'and k->>'state'='open')then raise exception 'Reload/poll exposes a reminder before B teach-back';end if;
  if(select count(*)from jsonb_array_elements(cards)k where k->>'kind'='dose'and k->>'state'='done')<>2 then raise exception 'Replacement hid completed dose history';end if;
 end loop;
end$$;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$begin
 if not(public.zoe_v3_plan_confirm('ce800000-0000-4000-8000-000000000001','ce800000-0000-4000-8000-000000000022',gen_random_uuid())->>'ok')::boolean then raise exception 'New version confirmation failed';end if;
end$$;
reset role;
select set_config('request.jwt.claims','{"sub":"ce800000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$declare cards jsonb:=public.zoe_chat_cards_member()->'cards';begin
 if exists(select 1 from jsonb_array_elements(cards)k where k->>'id'='ce800000-0000-4000-8000-000000000061')then raise exception 'Confirming B revived A reminder';end if;
 if not exists(select 1 from jsonb_array_elements(cards)k where k->>'id'='ce800000-0000-4000-8000-000000000062')then raise exception 'Confirmed current B reminder missing';end if;
end$$;
reset role;
rollback;
