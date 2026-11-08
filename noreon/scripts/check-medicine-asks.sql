-- Medicine-taking support (Armen's item 5): Zoe asks once why a dose was skipped or left unticked; the answer routes
-- to a reminder change, refill help, or the assigned doctor's medicine list. Off by default; one ask per medicine per
-- 3 days; missed-dose asks only for medicines the member ticks, at most one per member per 20 hours, Telegram only
-- outside quiet hours and with no medicine name; nothing without Zoe consent, with scheduled questions off, or during
-- a doctor takeover. Only the assigned doctor sees concerns; the assigned nurse and doctor see the reasons.
-- Fictional data; rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.id(n text)returns uuid language sql immutable as $$select('d5a00000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.today()returns date language sql as $$select(now()at time zone 'Asia/Yerevan')::date$$;
create function pg_temp.yvn(days integer,hhmm text)returns timestamptz language sql as $$
 select(((pg_temp.today()+days)::text||' '||hhmm)::timestamp at time zone 'Asia/Yerevan')$$;
create function pg_temp.as_user(n text)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),
  'exp',extract(epoch from now()+interval '1 hour')::bigint,'session_id',pg_temp.id('5'||right(n,1)))::text,true)$$;
create function pg_temp.as_service()returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.id(text),pg_temp.today(),pg_temp.yvn(integer,text),pg_temp.as_user(text),pg_temp.as_service()to authenticated,service_role;
create temp table r(k text primary key,v jsonb);grant all on r to authenticated,service_role;
create function pg_temp.ask(m text,src text,med text)returns public.member_medicine_asks language sql security definer as $$
 select * from public.member_medicine_asks where user_id=pg_temp.id(m)and source=src and medicine_id=pg_temp.id(med)order by created_at desc limit 1$$;
grant execute on function pg_temp.ask(text,text,text)to authenticated,service_role;
create function pg_temp.msg(ask uuid)returns text language sql security definer as $$
 select t.state||':'||coalesce(t.reason,'')from public.member_notices n join public.telegram_auth_messages t on t.id=n.telegram_message_id where n.event_key='medicine_ask:'||ask::text$$;
grant execute on function pg_temp.msg(uuid)to authenticated,service_role;

-- 0. Privileges and defaults.
select pg_temp.ok((select not asks from public.member_medicine_settings),'Asks are off by default');
select pg_temp.ok(not has_table_privilege('authenticated','public.member_medicine_asks','select')and not has_table_privilege('authenticated','public.member_medicine_concerns','select')
 and not has_table_privilege('anon','public.member_medicine_asks','select')and not has_table_privilege('service_role','public.member_medicine_concerns','select'),'No direct table access');
select pg_temp.ok(not has_function_privilege('anon','public.member_medicine_ask_answer(uuid,text)','execute')
 and not has_function_privilege('authenticated','public.member_medicine_asks_run(timestamptz)','execute')
 and has_function_privilege('service_role','public.member_medicine_asks_run(timestamptz)','execute')
 and not has_function_privilege('authenticated','public._medicine_ask_open(uuid,text,uuid,timestamptz,text,timestamptz)','execute'),'Anonymous callers reach nothing; the sweep is service-only');

-- Fixtures. 01 member (Zoe consent, Telegram) with a plan medicine (71, 09:00) and an own medicine (61, 08:00 and 20:00);
-- 02 member without consent, own medicine 62 (08:00); 05 another doctor; 06 admin; 07 doctor of both; 08 nurse of 01; 09 other nurse.
set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),'3749915'||n||'00',now()from unnest(array['01','02','05','06','07','08','09'])n;
insert into public.profiles(id,locale,display_name)select pg_temp.id(n),'en','Fictional member '||n from unnest(array['01','02'])n
 on conflict(id)do update set display_name=excluded.display_name;
insert into public.workspace_clinics(id,name,address)values(pg_temp.id('90'),'Fictional Clinic','1 Fictional Street');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.id('06'),'admin','Fictional admin',null),
 (pg_temp.id('05'),'doctor','Other doctor',pg_temp.id('90')),(pg_temp.id('07'),'doctor','Fictional doctor',pg_temp.id('90')),
 (pg_temp.id('08'),'nurse','Fictional nurse',pg_temp.id('90')),(pg_temp.id('09'),'nurse','Other nurse',pg_temp.id('90'));
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.id('5'||right(n,1)),pg_temp.id(n),now(),now()from unnest(array['01','02','05','06','07','08','09'])n;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.id('01'),pg_temp.id('07'),pg_temp.id('08')),(pg_temp.id('02'),pg_temp.id('07'),pg_temp.id('09'))
 on conflict(user_id)do update set assigned_doctor_id=excluded.assigned_doctor_id,assigned_nurse_id=excluded.assigned_nurse_id;
insert into public.patient_care_plans(id,user_id,clinician,instructions,active,published_at)values(pg_temp.id('70'),pg_temp.id('01'),'Fictional doctor','Fictional instructions',true,now()-interval '5 days');
insert into public.patient_care_medications(id,user_id,plan_id,name,dose,instructions,times,start_date)
 values(pg_temp.id('71'),pg_temp.id('01'),pg_temp.id('70'),'Fictional plan medicine','5 mg','Fictional',array['09:00'::time],pg_temp.today()-5);
insert into public.member_medicines(id,user_id,name,dose,times,started_on)values
 (pg_temp.id('61'),pg_temp.id('01'),'Fictional own medicine','1 tablet',array['08:00'::time,'20:00'::time],pg_temp.today()-3),
 (pg_temp.id('62'),pg_temp.id('02'),'Fictional other medicine',null,array['08:00'::time],pg_temp.today()-3);
insert into public.zoe_settings(singleton,consent_collection_enabled,consent_wording_version)values(true,true,'zoe-consent-draft-2')
 on conflict(singleton)do update set consent_collection_enabled=true,consent_wording_version='zoe-consent-draft-2';
insert into public.zoe_consents(member_id,kind,granted,wording_version,source)values(pg_temp.id('01'),'zoe_reads_messages',true,'zoe-consent-draft-2','enrolment');
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_ma',9051,600,'consent-ma');
insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
 select pg_temp.id('01'),'member','fictional-ma-01',public._telegram_account_ref(s),'+374991501','5559501',1 from public.telegram_channel_settings s;
reset session_replication_role;
update public.member_medicine_settings set enabled=true,asks=false;
update public.member_notice_settings set reminders=true,throttle_seconds=0,hourly_cap=60;
-- So the claim can be exercised: the ask wording and the member button label approved (rolled back); 01 never in quiet hours.
update public.system_message_templates set approved=true where template_id='member.medicine_ask';
insert into public.system_message_templates(template_id,version,locale,body,approved)values('member_notice.open_label',990,'en','Open Noreon',true);
insert into public.patient_reminder_preferences(user_id,revision,preferences)values(pg_temp.id('01'),1,
 '{"medicationEnabled":true,"medicationOffsetMinutes":0,"bpEnabled":false,"bpTimes":["08:00"],"quietStart":"03:00","quietEnd":"03:00"}');

-- 1. Off: a skip opens nothing, the member read says off, the sweep does nothing.
set local role authenticated;
select pg_temp.as_user('01');
select pg_temp.ok(public.member_medicine_dose_report(pg_temp.id('61'),pg_temp.yvn(-1,'08:00'),'skipped',0)->>'status'='saved','Off: the skip itself is saved');
select pg_temp.ok(public.member_medicine_asks_read()->>'enabled'='false','Off: read says disabled');
select pg_temp.ok(public.member_medicine_ask_answer(gen_random_uuid(),'forgot')->>'status'='disabled','Off: answer says disabled');
reset role;
select pg_temp.ok(not exists(select 1 from public.member_medicine_asks where user_id in(pg_temp.id('01'),pg_temp.id('02'))),'Off: no ask');
select pg_temp.as_service();
select pg_temp.ok(public.member_medicine_asks_run()->>'state'='off','Off: the sweep is off');
delete from public.member_medicine_doses where medicine_id=pg_temp.id('61');
update public.member_medicine_settings set asks=true;

-- 2. A skipped tick opens one ask at once; the member sees it with the medicine's name.
set local role authenticated;
select pg_temp.as_user('01');
select pg_temp.ok(public.member_medicine_dose_report(pg_temp.id('61'),pg_temp.yvn(-1,'08:00'),'skipped',0)->>'status'='saved','Skip saved');
insert into r values('read1',public.member_medicine_asks_read());
select pg_temp.ok((select jsonb_array_length(v->'asks')=1 and v->'asks'->0->>'trigger'='skipped'and v->'asks'->0->'medicine'->>'name'='Fictional own medicine'
 and v->'asks'->0->>'source'='self'from r where k='read1'),'One open ask, with the medicine''s name');
-- One per medicine per 3 days: another skipped dose of the same medicine opens nothing.
select pg_temp.ok(public.member_medicine_dose_report(pg_temp.id('61'),pg_temp.yvn(-1,'20:00'),'skipped',0)->>'status'='saved','Second skip saved');
select pg_temp.ok(jsonb_array_length(public.member_medicine_asks_read()->'asks')=1,'No second ask for the same medicine within 3 days');
-- Another member never sees or answers 01's ask.
select pg_temp.as_user('02');
select pg_temp.ok(jsonb_array_length(public.member_medicine_asks_read()->'asks')=0,'02 sees no ask of 01');
select pg_temp.ok(public.member_medicine_ask_answer((pg_temp.ask('01','self','61')).id,'forgot')->>'status'='not-found','02 cannot answer 01''s ask');
-- No Zoe consent: 02's skip opens nothing.
select pg_temp.ok(public.member_medicine_dose_report(pg_temp.id('62'),pg_temp.yvn(-1,'08:00'),'skipped',0)->>'status'='saved','02 skip saved');
reset role;
select pg_temp.ok(not exists(select 1 from public.member_medicine_asks where user_id=pg_temp.id('02')),'No consent: no ask');
select pg_temp.ok(public._medicine_ask_blocked(pg_temp.id('02'))='no_consent','Blocked reason: no consent');

-- 3. Answers. Side effect: a concern for the doctor, never more than once; a different answer later is refused.
set local role authenticated;
select pg_temp.as_user('01');
select pg_temp.ok(public.member_medicine_ask_answer((pg_temp.ask('01','self','61')).id,'tired')->>'status'='invalid','Unknown reason refused');
insert into r values('ans1',public.member_medicine_ask_answer((pg_temp.ask('01','self','61')).id,'side_effect'));
select pg_temp.ok((select v->>'status'='answered'and v->>'next'='doctor'from r where k='ans1'),'Side effect routes to the doctor');
select pg_temp.ok(public.member_medicine_ask_answer((pg_temp.ask('01','self','61')).id,'side_effect')->>'replayed'='true','The same answer replays');
select pg_temp.ok(public.member_medicine_ask_answer((pg_temp.ask('01','self','61')).id,'forgot')->>'status'='closed','A different answer later is refused');
select pg_temp.ok(jsonb_array_length(public.member_medicine_asks_read()->'asks')=0,'An answered ask leaves the member''s list');
select pg_temp.ok(public.member_medicine_ask_care_team((pg_temp.ask('01','self','61')).id)->>'status'='invalid','Refill request only after ran out or cost');
reset role;
select pg_temp.ok((select count(*)=1 from public.member_medicine_concerns where user_id=pg_temp.id('01')and kind='side_effect'and state='open'),'One open side-effect concern');

-- 4. The doctor's medicine list: the assigned doctor only.
set local role authenticated;
select pg_temp.as_user('07');
insert into r values('doc1',public.doctor_medicine_concerns());
select pg_temp.ok((select jsonb_array_length(v->'items')=1 and v->'items'->0->>'kind'='side_effect'and v->'items'->0->>'memberName'='Fictional member 01'
 and v->'items'->0->'ask'->'medicine'->>'name'='Fictional own medicine'and(v->'items'->0->'ticks14'->>'skipped')::int=2 from r where k='doc1'),
 'Assigned doctor sees the concern with medicine, reason and 14 days of ticks');
reset role;
select pg_temp.ok(exists(select 1 from public.access_audit where actor_id=pg_temp.id('07')and member_id=pg_temp.id('01')and surface='doctor_inbox'and object_id='medicine_concerns'),'The read is in the access record');
set local role authenticated;
select pg_temp.as_user('05');
select pg_temp.ok(jsonb_array_length(public.doctor_medicine_concerns()->'items')=0,'Another doctor sees nothing');
select pg_temp.ok(public.doctor_medicine_concern_handle((select(v->'items'->0->>'id')::uuid from r where k='doc1'))->>'code'='not_found','Another doctor cannot handle it');
select pg_temp.as_user('08');
do $$begin perform public.doctor_medicine_concerns();raise exception 'FAIL: a nurse read the doctor list';exception when insufficient_privilege then null;end$$;
select pg_temp.as_user('06');
do $$begin perform public.doctor_medicine_concerns();raise exception 'FAIL: admin read the doctor list';exception when insufficient_privilege then null;end$$;

-- 5. Reasons for the assigned nurse and doctor (adherence panel).
select pg_temp.as_user('08');
select pg_temp.ok((select r->>'reason'='side_effect'and r->>'concern'='open'from jsonb_array_elements(public.member_medicine_reasons_staff_read(pg_temp.id('01'),14)->'reasons')r),'Assigned nurse reads the reason');
select pg_temp.as_user('09');
do $$begin perform public.member_medicine_reasons_staff_read(pg_temp.id('01'),14);raise exception 'FAIL: unassigned nurse read reasons';exception when insufficient_privilege then null;end$$;
select pg_temp.as_user('06');
do $$begin perform public.member_medicine_reasons_staff_read(pg_temp.id('01'),14);raise exception 'FAIL: admin read reasons';exception when insufficient_privilege then null;end$$;

-- 6. The doctor marks it handled; it leaves the list.
select pg_temp.as_user('07');
select pg_temp.ok(public.doctor_medicine_concern_handle((select(v->'items'->0->>'id')::uuid from r where k='doc1'))->>'replayed'='false','Doctor marks it handled');
select pg_temp.ok(public.doctor_medicine_concern_handle((select(v->'items'->0->>'id')::uuid from r where k='doc1'))->>'replayed'='true','Handling again replays');
select pg_temp.ok(jsonb_array_length(public.doctor_medicine_concerns()->'items')=0,'Handled concerns leave the list');

-- 7. Missed doses: the sweep asks only about a medicine the member ticks, with one Telegram notice and no medicine name.
reset role;
-- 01 ticked the plan medicine two days ago, then left yesterday's 09:00 unticked.
insert into public.patient_dose_events(user_id,medication_id,due_at,status)values(pg_temp.id('01'),pg_temp.id('71'),pg_temp.yvn(-2,'09:00'),'taken');
select pg_temp.as_service();
select pg_temp.ok((public.member_medicine_asks_run(pg_temp.yvn(-1,'12:00'))->>'opened')::int=0,'Under 4 hours late: no ask yet');
insert into r values('run1',public.member_medicine_asks_run(pg_temp.yvn(-1,'13:30')));
select pg_temp.ok((select(v->>'opened')::int=1 and(v->>'queued')::int=1 from r where k='run1'),'Unticked 4.5 hours later: one ask and one notice');
select pg_temp.ok((pg_temp.ask('01','plan','71')).trigger='missed'and(pg_temp.ask('01','plan','71')).due_at=pg_temp.yvn(-1,'09:00'),'The ask is for yesterday''s 09:00');
select pg_temp.ok((select m.template_id='member.medicine_ask'and m.params is null and m.body!~*'fictional|tablet|5 mg'and m.keyboard->>'url'like '%/patient/medicines'
 from public.member_notices n join public.telegram_auth_messages m on m.id=n.telegram_message_id where n.member_id=pg_temp.id('01')and n.event_key like 'medicine_ask:%'),'The notice names no medicine and opens the medicines page');
-- The claim lets an eligible ask notice go (the guard is silent).
insert into r values('claim1',public.telegram_auth_message_claim((select n.telegram_message_id from public.member_notices n where n.event_key='medicine_ask:'||(pg_temp.ask('01','plan','71')).id::text),gen_random_uuid()));
select pg_temp.ok((select v->>'ok'='true'and v#>>'{envelope,text}'!~*'fictional|5 mg'from r where k='claim1'),'An eligible notice is claimed for sending, with no medicine name');
insert into r values('run2',public.member_medicine_asks_run(pg_temp.yvn(-1,'13:35')));
select pg_temp.ok((select(v->>'opened')::int=0 and(v->>'queued')::int=0 from r where k='run2'),'A later sweep sends nothing more');
-- 02's own medicine has no tick in 7 days (the skip in step 2 counts, so remove it): never asked about it.
delete from public.member_medicine_doses where medicine_id=pg_temp.id('62');
insert into public.zoe_consents(member_id,kind,granted,wording_version,source)values(pg_temp.id('02'),'zoe_reads_messages',true,'zoe-consent-draft-2','prompt');
select pg_temp.ok((public.member_medicine_asks_run(pg_temp.yvn(-1,'13:40'))->>'opened')::int=0,'A medicine the member never ticks: no missed-dose ask');

-- 8. Ran out: refill help, and the member can ask the care team once.
set local role authenticated;
select pg_temp.as_user('01');
select pg_temp.ok(public.member_medicine_ask_answer((pg_temp.ask('01','plan','71')).id,'ran_out')->>'next'='refill','Ran out routes to refill help');
select pg_temp.ok(public.member_medicine_ask_care_team((pg_temp.ask('01','plan','71')).id)->>'status'='sent','Member asks the care team');
select pg_temp.ok(public.member_medicine_ask_care_team((pg_temp.ask('01','plan','71')).id)->>'status'='already','Only once');
select pg_temp.as_user('07');
select pg_temp.ok((select x->>'kind'='refill'and x->'ask'->>'reason'='ran_out'from jsonb_array_elements(public.doctor_medicine_concerns()->'items')x),'The refill request is on the doctor''s list');

-- 9. Quiet hours defer the notice; the next sweep outside them sends it. Turning medicine reminders off sends none.
reset role;
insert into public.member_medicine_doses(medicine_id,user_id,due_at,status)values(pg_temp.id('62'),pg_temp.id('02'),pg_temp.yvn(-2,'08:00'),'taken');
set local session_replication_role=replica;
insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
 select pg_temp.id('02'),'member','fictional-ma-02',public._telegram_account_ref(s),'+374991502','5559502',1 from public.telegram_channel_settings s;
reset session_replication_role;
insert into public.patient_reminder_preferences(user_id,revision,preferences)values(pg_temp.id('02'),1,
 '{"medicationEnabled":true,"medicationOffsetMinutes":0,"bpEnabled":false,"bpTimes":["08:00"],"quietStart":"12:00","quietEnd":"18:00"}');
select pg_temp.as_service();
insert into r values('run3',public.member_medicine_asks_run(pg_temp.yvn(-1,'13:45')));
select pg_temp.ok((select(v->>'opened')::int=1 and(v->>'queued')::int=0 from r where k='run3')and(pg_temp.ask('02','self','62')).notice_at is null,'Quiet hours: ask opened, notice deferred');
select pg_temp.ok((public.member_medicine_asks_run(pg_temp.yvn(-1,'18:05'))->>'queued')::int=1,'After quiet hours: the notice goes');
select pg_temp.ok(pg_temp.msg((pg_temp.ask('02','self','62')).id)='queued:','The notice is queued for the sender');
-- Astra MED-02: a queued notice not yet claimed is re-checked by the next sweep (which runs just before sending).
reset role;
update public.patient_reminder_preferences set preferences=jsonb_set(jsonb_set(preferences,'{quietStart}','"18:07"'),'{quietEnd}','"23:00"')where user_id=pg_temp.id('02');
select pg_temp.as_service();
select public.member_medicine_asks_run(pg_temp.yvn(-1,'18:08'));
select pg_temp.ok(pg_temp.msg((pg_temp.ask('02','self','62')).id)='held:medicine_ask_quiet_hours','Now quiet hours: the queued notice is held, never sent');
reset role;
update public.patient_reminder_preferences set preferences=jsonb_set(jsonb_set(preferences,'{quietStart}','"12:00"'),'{quietEnd}','"18:00"')where user_id=pg_temp.id('02');
select pg_temp.as_service();
-- Per member, at most one missed-dose ask per 20 hours.
select pg_temp.ok((public.member_medicine_asks_run(pg_temp.yvn(0,'13:00'))->>'opened')::int=0,'No second missed-dose ask within 20 hours (and the medicine within 3 days)');

-- 10. A dose ticked as taken withdraws its open ask.
reset role;
delete from public.member_medicine_asks where user_id=pg_temp.id('02');
select pg_temp.as_service();
select pg_temp.ok((public.member_medicine_asks_run(pg_temp.yvn(-1,'18:10'))->>'opened')::int=1,'Ask reopened for the test');
select pg_temp.ok(pg_temp.msg((pg_temp.ask('02','self','62')).id)='queued:','Its notice is queued');
reset role;
insert into public.member_medicine_doses(medicine_id,user_id,due_at,status)values(pg_temp.id('62'),pg_temp.id('02'),pg_temp.yvn(-1,'08:00'),'taken');
select pg_temp.ok((pg_temp.ask('02','self','62')).state='withdrawn','Ticked as taken: the ask is withdrawn');
-- Astra MED-02 round 2: with no sweep in between (it failed or did not run), the claim itself refuses the notice.
update public.system_message_templates set approved=true where template_id='member.medicine_ask';
select pg_temp.as_service();
do $$begin
 perform public.telegram_auth_message_claim((select n.telegram_message_id from public.member_notices n where n.event_key='medicine_ask:'||(pg_temp.ask('02','self','62')).id::text),gen_random_uuid());
 raise exception 'FAIL: a closed ask notice was claimed';
exception when raise_exception then if sqlerrm not like 'medicine ask notice refused: medicine_ask_closed'then raise;end if;
end$$;
select pg_temp.ok(pg_temp.msg((pg_temp.ask('02','self','62')).id)='queued:','Refused claim: nothing sent, the row is still queued');
select public.member_medicine_asks_run(pg_temp.yvn(-1,'18:12'));
select pg_temp.ok(pg_temp.msg((pg_temp.ask('02','self','62')).id)='held:medicine_ask_closed','Dose ticked before sending: the queued notice is held');
reset role;

-- 10b. Backstop: an ask left open for a dose ticked taken (the trigger skipped a locked row) is withdrawn by the sweep.
reset role;
insert into public.member_medicine_asks(id,user_id,source,medicine_id,due_at,trigger,expires_at)values(pg_temp.id('a3'),pg_temp.id('01'),'plan',pg_temp.id('71'),pg_temp.yvn(-2,'09:00'),'missed',now()+interval '1 day');
select pg_temp.as_service();
select public.member_medicine_asks_run(pg_temp.yvn(-1,'18:14'));
reset role;
select pg_temp.ok((select state='withdrawn'from public.member_medicine_asks where id=pg_temp.id('a3')),'An open ask for a dose already ticked taken is withdrawn by the sweep');
delete from public.member_medicine_asks where id=pg_temp.id('a3');

-- 11. Blocks: scheduled questions turned off, and a doctor takeover.
insert into public.zoe_consents(member_id,kind,granted,wording_version,source)values(pg_temp.id('02'),'zoe_scheduled_questions',false,'zoe-consent-draft-2','settings');
select pg_temp.ok(public._medicine_ask_blocked(pg_temp.id('02'))='questions_off','Scheduled questions off: blocked');
insert into public.member_medicine_asks(id,user_id,source,medicine_id,due_at,trigger,expires_at)values(pg_temp.id('a2'),pg_temp.id('02'),'self',pg_temp.id('62'),pg_temp.yvn(-2,'08:00'),'skipped',now()+interval '1 day');
set local role authenticated;
select pg_temp.as_user('02');
select pg_temp.ok(jsonb_array_length(public.member_medicine_asks_read()->'asks')=0,'Questions off: open asks are hidden (Astra MED-01)');
select pg_temp.ok(public.member_medicine_ask_answer(pg_temp.id('a2'),'forgot')->>'status'='closed','Questions off: an answer is refused');
reset role;
select pg_temp.ok(public._medicine_ask_blocked(pg_temp.id('01'))is null,'01 may be asked');
insert into public.conversations(id,member_id)values(pg_temp.id('40'),pg_temp.id('01'));
do $$begin if to_regprocedure('public._zoe_doctor_mode(uuid)')is null then
 execute $f$create function public._zoe_doctor_mode(c uuid)returns boolean language sql as 'select c=''d5a00000-0000-4000-8000-000000000040''::uuid'$f$;
else
 -- The takeover lane's function is present: put 01's conversation in doctor mode its own way.
 execute 'insert into public.zoe_doctor_mode(conversation_id,member_id,doctor_mode,changed_by,reason)values($1,$2,true,$3,''doctor_reply'')'using pg_temp.id('40'),pg_temp.id('01'),pg_temp.id('07');
end if;end$$;
select pg_temp.ok(public._medicine_ask_blocked(pg_temp.id('01'))='takeover','Doctor takeover: blocked');
-- Astra MED-01: an ask opened before the takeover is hidden and cannot be answered while it lasts.
insert into public.member_medicine_asks(id,user_id,source,medicine_id,due_at,trigger,expires_at)values(pg_temp.id('a1'),pg_temp.id('01'),'self',pg_temp.id('61'),pg_temp.yvn(-2,'08:00'),'skipped',now()+interval '1 day');
set local role authenticated;
select pg_temp.as_user('01');
select pg_temp.ok(jsonb_array_length(public.member_medicine_asks_read()->'asks')=0,'Takeover: open asks are hidden');
select pg_temp.ok(public.member_medicine_ask_answer(pg_temp.id('a1'),'side_effect')->>'status'='closed','Takeover: an answer is refused');
select pg_temp.ok(public.member_medicine_ask_care_team((pg_temp.ask('01','plan','71')).id)->>'status'='closed','Takeover: a refill request is refused');
reset role;
select pg_temp.ok(not exists(select 1 from public.member_medicine_concerns where ask_id=pg_temp.id('a1')),'Takeover: no concern recorded');
delete from public.member_medicine_asks where id=pg_temp.id('a1');
select pg_temp.ok(public._medicine_ask_open(pg_temp.id('01'),'self',pg_temp.id('61'),pg_temp.yvn(0,'08:00'),'skipped',now()+interval '4 days')is null,'Doctor takeover: nothing opens');
do $$begin if to_regclass('public.zoe_doctor_mode')is null then drop function public._zoe_doctor_mode(uuid);
 else execute 'update public.zoe_doctor_mode set doctor_mode=false,reason=''hand_back''where conversation_id=$1'using pg_temp.id('40');end if;end$$;
select pg_temp.ok(public._medicine_ask_open(pg_temp.id('01'),'self',pg_temp.id('61'),pg_temp.yvn(0,'08:00'),'skipped',now()+interval '4 days')is not null,'After 3 days and no takeover: a new ask opens');

-- 12a. "Not now" closes an open ask; it stays closed and another member cannot close it.
reset role;
select pg_temp.as_service();
select public._medicine_ask_open(pg_temp.id('01'),'plan',pg_temp.id('71'),pg_temp.yvn(0,'09:00'),'skipped',now()+interval '8 days');
set local role authenticated;
select pg_temp.as_user('02');
select pg_temp.ok(public.member_medicine_ask_dismiss((pg_temp.ask('01','plan','71')).id)->>'status'='not-found','02 cannot close 01''s ask');
select pg_temp.as_user('01');
select pg_temp.ok(public.member_medicine_ask_dismiss((pg_temp.ask('01','plan','71')).id)->>'status'='closed','Not now closes it');
select pg_temp.ok((pg_temp.ask('01','plan','71')).state='withdrawn'and public.member_medicine_ask_answer((pg_temp.ask('01','plan','71')).id,'forgot')->>'status'='closed','A closed ask cannot be answered');
reset role;

-- 12. A lapsed ask is gone from the member's list and cannot be answered.
update public.member_medicine_asks set expires_at=now()-interval '1 minute'where user_id=pg_temp.id('01')and state='open';
set local role authenticated;
select pg_temp.as_user('01');
select pg_temp.ok(jsonb_array_length(public.member_medicine_asks_read()->'asks')=0,'Lapsed asks are not shown');
select pg_temp.ok(public.member_medicine_ask_answer((pg_temp.ask('01','self','61')).id,'forgot')->>'status'='closed','A lapsed ask cannot be answered');

-- 13. QA 99 (Astra R393-01): a schedule the member changed counts only from the change. A replacement row whose
-- effective_at is yesterday 12:00 is never asked about its 06:10 slot from before then; without effective_at it would be.
reset role;
delete from public.member_medicine_asks where user_id=pg_temp.id('01');
update public.member_medicines set stopped_at=pg_temp.yvn(-1,'12:00')where id=pg_temp.id('61');
update public.patient_care_medications set active=false where id=pg_temp.id('71');
insert into public.member_medicines(id,user_id,name,dose,times,started_on,effective_at)
 values(pg_temp.id('63'),pg_temp.id('01'),'Fictional own medicine','2 tablets',array['06:10'::time,'18:10'::time],pg_temp.today()-1,pg_temp.yvn(-1,'12:00'));
insert into public.member_medicine_doses(medicine_id,user_id,due_at,status)values(pg_temp.id('63'),pg_temp.id('01'),pg_temp.yvn(-1,'18:10'),'taken');
select pg_temp.as_service();
select pg_temp.ok((public.member_medicine_asks_run(pg_temp.yvn(0,'02:00'))->>'opened')::int=0
 and not exists(select 1 from public.member_medicine_asks where medicine_id=pg_temp.id('63')),'QA 99: no missed-dose ask for a slot before the schedule change');
reset role;
update public.member_medicines set effective_at=null where id=pg_temp.id('63');
select pg_temp.as_service();
select pg_temp.ok((public.member_medicine_asks_run(pg_temp.yvn(0,'02:05'))->>'opened')::int=1
 and(pg_temp.ask('01','self','63')).due_at=pg_temp.yvn(-1,'06:10'),'Control: without effective_at the same slot is asked about');
reset role;
rollback;
