-- Doctor Zoe: rolled-back SQL tests by role. Who may find, open, read and ask; wrong member, wrong clinic, removed staff, expired
-- session; a nurse never reaches a doctor read; every tool read passes the gate and leaves an audit row; the spend caps;
-- nothing touches the member's conversation. Fictional data; rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.id(n text)returns uuid language sql immutable as $$select('dc000000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.sid(n text)returns uuid language sql immutable as $$select('dc000000-0000-4000-8000-1000000000'||n)::uuid$$;
create function pg_temp.as_user(n text)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),
  'exp',extract(epoch from now()+interval '1 hour')::bigint,'session_id',pg_temp.sid(n))::text,true)$$;
create function pg_temp.as_service()returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
-- True when the call is refused with 42501.
create function pg_temp.refused(sql text)returns boolean language plpgsql as $$begin execute sql;return false;exception when insufficient_privilege then return true;end$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.id(text),pg_temp.sid(text),pg_temp.as_user(text),pg_temp.as_service(),pg_temp.refused(text)to authenticated,service_role;
create temp table r(k text primary key,v jsonb);grant all on r to authenticated,service_role;

-- 0. Off by default, no direct table access, service functions are service-only.
select pg_temp.ok((select not staff_zoe_enabled and staff_daily_cap_usd=3 and model_tier='high' from public.staff_zoe_settings),'Off by default, strongest tier');
select pg_temp.ok(not has_table_privilege(x.role,format('public.%I',t),p),format('%s has no %s on %s',x.role,p,t))
 from(values('anon'),('authenticated'),('service_role'))x(role),unnest(array['staff_zoe_settings','staff_zoe_conversations','staff_zoe_messages','staff_zoe_runs'])t,unnest(array['select','insert','update','delete'])p;
select pg_temp.ok((select relrowsecurity from pg_class where oid=format('public.%I',t)::regclass),format('RLS on %s',t))from unnest(array['staff_zoe_settings','staff_zoe_conversations','staff_zoe_messages','staff_zoe_runs'])t;
select pg_temp.ok(not has_function_privilege('anon',f,'execute'),'anon executes nothing: '||f)from unnest(array['public.staff_zoe_status()','public.staff_zoe_candidates(text)','public.staff_zoe_open(uuid)','public.staff_zoe_read(uuid)','public.staff_zoe_recent()','public.staff_zoe_begin(uuid,uuid,text)','public.staff_zoe_gate(uuid,text)','public.staff_zoe_reserve(uuid,numeric,boolean,text,text)','public.staff_zoe_finish(uuid,jsonb)'])f;
select pg_temp.ok(not has_function_privilege('authenticated',f,'execute')and has_function_privilege('service_role',f,'execute'),'service only: '||f)from unnest(array['public.staff_zoe_reserve(uuid,numeric,boolean,text,text)','public.staff_zoe_finish(uuid,jsonb)'])f;
select pg_temp.ok(not has_function_privilege('authenticated',f,'execute'),'internal: '||f)from unnest(array['public._staff_zoe_staff()','public._staff_zoe_assigned(uuid)','public._staff_zoe_on()'])f;

-- Fixtures. 01, 02 members of doctor 07 with the same name; 01 has nurse 08; 03 member of doctor 17 (clinic 91); 04 a member of
-- doctor 07 whose nurse 18 is in clinic 91 (wrong clinic). 06 admin; 19 a doctor removed below; 20 a doctor whose session expires.
set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),'3749912'||n||'00',now()from unnest(array['01','02','03','04','06','07','08','09','17','18','19','20'])n;
insert into public.profiles(id,locale,display_name,birth_date,biological_sex)values
 (pg_temp.id('01'),'en','Fictional Namesake','1970-01-01','female'),(pg_temp.id('02'),'en','Fictional Namesake','1985-06-15','female'),
 (pg_temp.id('03'),'en','Fictional Other','1960-01-01','male'),(pg_temp.id('04'),'en','Fictional Fourth','1961-01-01','male')
 on conflict(id)do update set display_name=excluded.display_name,birth_date=excluded.birth_date,biological_sex=excluded.biological_sex;
insert into public.patient_consents(user_id,version)select pg_temp.id(n),'patient-pilot-v1'from unnest(array['01','02','03','04'])n;
insert into public.patient_assessments(user_id)select pg_temp.id(n)from unnest(array['01','02','03','04'])n on conflict do nothing;
insert into public.workspace_clinics(id,name,address)values(pg_temp.id('90'),'Fictional Clinic','1 Fictional Street'),(pg_temp.id('91'),'Other Fictional Clinic','2 Fictional Street');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.id('06'),'admin','Fictional admin',null),
 (pg_temp.id('07'),'doctor','Fictional doctor',pg_temp.id('90')),(pg_temp.id('08'),'nurse','Fictional nurse',pg_temp.id('90')),(pg_temp.id('09'),'nurse','Unassigned nurse',pg_temp.id('90')),
 (pg_temp.id('17'),'doctor','Other doctor',pg_temp.id('91')),(pg_temp.id('18'),'nurse','Wrong clinic nurse',pg_temp.id('91')),
 (pg_temp.id('19'),'doctor','Removed doctor',pg_temp.id('90')),(pg_temp.id('20'),'doctor','Expiring doctor',pg_temp.id('90'));
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.sid(n),pg_temp.id(n),now(),now()from unnest(array['01','06','07','08','09','17','18','19','20'])n;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.id('01'),pg_temp.id('07'),pg_temp.id('08')),(pg_temp.id('02'),pg_temp.id('07'),null),
 (pg_temp.id('03'),pg_temp.id('17'),null),(pg_temp.id('04'),pg_temp.id('07'),pg_temp.id('18'))
 on conflict(user_id)do update set assigned_doctor_id=excluded.assigned_doctor_id,assigned_nurse_id=excluded.assigned_nurse_id;
reset session_replication_role;

set local role authenticated;
-- 1. Off: nothing is served, whoever asks.
select pg_temp.as_user('07');
select pg_temp.ok(public.staff_zoe_status()=false,'Off: status');
select pg_temp.ok(public.staff_zoe_candidates('Fictional')->>'enabled'='false','Off: find returns nothing');
select pg_temp.ok(public.staff_zoe_open(pg_temp.id('01'))->>'code'='off','Off: no conversation');
select pg_temp.ok(public.staff_zoe_recent()->>'enabled'='false','Off: no recent');
reset role;
update public.staff_zoe_settings set staff_zoe_enabled=true;
set local role authenticated;

-- 2. Finding: only assigned members; two namesakes both come back and can be told apart; no hint about others.
select pg_temp.as_user('07');
select pg_temp.ok(jsonb_array_length(public.staff_zoe_candidates('Namesake')->'rows')=2,'Two namesakes, both listed');
select pg_temp.ok((select count(distinct x->>'id')=2 and count(distinct x->>'birthYear')=2 from jsonb_array_elements(public.staff_zoe_candidates('Namesake')->'rows')x),'Each with its own id and birth year');
select pg_temp.ok(public.staff_zoe_candidates('Other')->'rows'='[]'::jsonb,'Another doctor''s member is not found');
select pg_temp.ok(public.staff_zoe_candidates('x')->'rows'='[]'::jsonb,'A one-letter search returns nothing');
select pg_temp.as_user('08');
select pg_temp.ok(jsonb_array_length(public.staff_zoe_candidates('Namesake')->'rows')=1,'The nurse finds only the member assigned to her');
select pg_temp.as_user('09');
select pg_temp.ok(public.staff_zoe_candidates('Namesake')->'rows'='[]'::jsonb,'An unassigned nurse finds nobody');
select pg_temp.as_user('18');
select pg_temp.ok(public.staff_zoe_candidates('Fourth')->'rows'='[]'::jsonb,'A nurse in the wrong clinic finds nobody');
select pg_temp.as_user('06');
select pg_temp.ok(pg_temp.refused($$select public.staff_zoe_candidates('Namesake')$$),'Admin: find refused');
select pg_temp.ok(pg_temp.refused($$select public.staff_zoe_recent()$$),'Admin: recent refused');
select pg_temp.as_user('01');
select pg_temp.ok(pg_temp.refused($$select public.staff_zoe_candidates('Namesake')$$),'A member: find refused');

-- 3. Opening: an explicit selection of an assigned member only.
select pg_temp.as_user('06');
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_open(%L)$$,pg_temp.id('01'))),'Admin: open refused');
select pg_temp.as_user('01');
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_open(%L)$$,pg_temp.id('01'))),'A member cannot open a conversation');
select pg_temp.as_user('07');
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_open(%L)$$,pg_temp.id('03'))),'Wrong member: another doctor''s');
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_open(%L)$$,pg_temp.id('99'))),'A member who does not exist is refused the same way');
select pg_temp.as_user('09');
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_open(%L)$$,pg_temp.id('01'))),'Unassigned nurse');
select pg_temp.as_user('18');
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_open(%L)$$,pg_temp.id('04'))),'Wrong clinic: assigned nurse of another clinic');
select pg_temp.as_user('07');
insert into r select 'c1',public.staff_zoe_open(pg_temp.id('01'));
insert into r select 'c2',public.staff_zoe_open(pg_temp.id('02'));
select pg_temp.as_user('08');
insert into r select 'c3',public.staff_zoe_open(pg_temp.id('01'));
create function pg_temp.conv(k text)returns uuid language sql as $$select(v->>'conversationId')::uuid from r where r.k=$1$$;
grant execute on function pg_temp.conv(text)to authenticated,service_role;

-- 4. Reading and asking: own conversations, while the assignment holds.
select pg_temp.as_user('08');
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_read(%L)$$,pg_temp.conv('c1'))),'Another staff member''s conversation is closed, same member or not');
select pg_temp.as_user('17');
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_read(%L)$$,pg_temp.conv('c1'))),'Another doctor cannot read it');
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_begin(%L,%L,'x')$$,pg_temp.conv('c1'),gen_random_uuid())),'Another doctor cannot ask in it');
select pg_temp.as_user('07');
select pg_temp.ok(public.staff_zoe_read(pg_temp.conv('c1'))#>>'{member,id}'=pg_temp.id('01')::text,'The conversation carries its one member');
select pg_temp.ok(public.staff_zoe_read(pg_temp.conv('c2'))#>>'{member,id}'=pg_temp.id('02')::text,'The namesake''s conversation carries the other member');
select pg_temp.ok(public.staff_zoe_begin(pg_temp.conv('c1'),gen_random_uuid(),'  ')->>'code'='invalid','An empty question');
select pg_temp.ok(public.staff_zoe_begin(pg_temp.conv('c1'),gen_random_uuid(),repeat('x',1001))->>'code'='invalid','A question over the limit');
insert into r select 'b1',public.staff_zoe_begin(pg_temp.conv('c1'),pg_temp.id('a1'),'How is the BP?');
select pg_temp.ok((select v->>'ok'='true' and v->>'memberId'=pg_temp.id('01')::text and v->>'role'='doctor' and v->>'tier'='high' and v->>'memberName'='Fictional Namesake' from r where k='b1'),'A turn starts on the conversation''s member');
select pg_temp.ok(public.staff_zoe_begin(pg_temp.conv('c1'),pg_temp.id('a1'),'How is the BP?')->>'code'='replayed','The same submission does not start a second turn');
select pg_temp.ok(public.staff_zoe_begin(pg_temp.conv('c1'),gen_random_uuid(),'Next?')->>'code'='busy','One turn at a time in a conversation');
create function pg_temp.run(k text)returns uuid language sql as $$select(v->>'runId')::uuid from r where r.k=$1$$;
grant execute on function pg_temp.run(text)to authenticated,service_role;

-- 5. The gate: before every read. This run, this user, a tool of this role, and it records the read.
select pg_temp.ok(public.staff_zoe_gate(pg_temp.run('b1'),'labs')->>'memberId'=pg_temp.id('01')::text,'The doctor''s gate gives the run''s member');
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_gate(%L,'write_plan')$$,pg_temp.run('b1'))),'A tool that does not exist');
select pg_temp.as_user('17');
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_gate(%L,'bp')$$,pg_temp.run('b1'))),'Another doctor cannot use the run');
select pg_temp.as_user('07');
select pg_temp.ok(pg_temp.refused($$select public.staff_zoe_gate('dc000000-0000-4000-8000-000000000000','bp')$$),'An unknown run');
select pg_temp.as_user('08');
insert into r select 'b3',public.staff_zoe_begin(pg_temp.conv('c3'),pg_temp.id('a3'),'BP?');
select pg_temp.ok((select v->>'role'='nurse' from r where k='b3'),'The nurse''s turn runs as a nurse');
select pg_temp.ok(public.staff_zoe_gate(pg_temp.run('b3'),t)->>'ok'='true','Nurse tool: '||t)from unnest(array['overview','bp','plan','adherence','open_items','visits','member_messages'])t;
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_gate(%L,%L)$$,pg_temp.run('b3'),t)),'A nurse never passes the gate for '||t)from unnest(array['lipid_plan','labs','ldl','zoe_why'])t;
reset role;
select pg_temp.ok((select count(*)=2 and bool_and(r.member_id=c.member_id and r.staff_id=c.staff_id)
 from public.staff_zoe_runs r join public.staff_zoe_conversations c on c.id=r.conversation_id
 where r.id in(pg_temp.run('b1'),pg_temp.run('b3'))),'Accepted doctor and nurse runs persist their conversation member and staff');
select pg_temp.ok((select count(*)=7 from public.access_audit where surface='zoe_staff'and actor_id=pg_temp.id('08')and member_id=pg_temp.id('01')and object_id in('overview','bp','plan','adherence','open_items','visits','member_messages')),'One audit row per tool read, with the tool named');
select pg_temp.ok((select count(*)=1 from public.access_audit where surface='zoe_staff'and actor_id=pg_temp.id('07')and object_id='labs'),'The doctor''s read is recorded too');
select pg_temp.ok(not exists(select 1 from public.access_audit where surface='zoe_staff'and actor_id=pg_temp.id('08')and object_id='labs'),'A refused read writes no audit row');
select pg_temp.ok(exists(select 1 from public.access_audit where surface='zoe_staff'and object_id='candidate'and member_id=pg_temp.id('02')),'Candidates shown are recorded');
select pg_temp.ok(not exists(select 1 from public.access_audit where surface='zoe_staff'and object_id='candidate'and member_id=pg_temp.id('03')),'A member not shown is not recorded');
set local role authenticated;

-- 6. The nurse never reaches a doctor's draft, through the reads a tool uses.
reset role;
update public.patient_clinical_cases set draft='{"explanation":"Private draft text","instructions":"Private","followUp":"","medicationName":"","medicationDose":"","medicationInstructions":"","medicationTimes":[]}'::jsonb where user_id=pg_temp.id('01');
-- Publication metadata is restricted to the rows this nurse could already read. No draft or change summary.
set local session_replication_role=replica;
insert into public.patient_care_plans(id,user_id,clinician,instructions,active,published_at)values
 (pg_temp.id('51'),pg_temp.id('01'),'Fictional doctor','Earlier instructions',false,now()-interval '2 days'),
 (pg_temp.id('52'),pg_temp.id('01'),'Fictional doctor','Current instructions',true,now()-interval '1 day'),
 (pg_temp.id('53'),pg_temp.id('02'),'Fictional doctor','Other member instructions',true,now());
insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft,published_at)
 select p.user_id,p.id,p.id,pg_temp.id('07'),case when p.id=pg_temp.id('52')then 2 else 1 end,'synthetic','{}','{}',
  jsonb_build_object('explanation','','instructions',p.instructions,'followUp','','medicationName','','medicationDose','','medicationInstructions','','medicationTimes','[]'::jsonb),p.published_at
 from public.patient_care_plans p where p.id in(pg_temp.id('51'),pg_temp.id('52'),pg_temp.id('53'));
insert into public.patient_care_plan_versions(plan_id,user_id,version,change_summary)
 select p.id,p.user_id,case when p.id=pg_temp.id('52')then 2 else 1 end,'Doctor-only change summary'
 from public.patient_care_plans p where p.id in(pg_temp.id('51'),pg_temp.id('52'),pg_temp.id('53'));
reset session_replication_role;
set local role authenticated;
select pg_temp.as_user('08');
insert into r values('nurse-plan',public.patient_clinical_case_snapshot(pg_temp.id('01')));
select pg_temp.ok((select v->'draft'='null'::jsonb and v->'review'='null'::jsonb from r where k='nurse-plan'),'The snapshot a nurse''s tool reads has no draft or review');
select pg_temp.ok((select v->'planVersions'=jsonb_build_array(
 jsonb_build_object('planId',pg_temp.id('52'),'version',2,'publishedAt',now()-interval '1 day','current',true,'changeSummary',null),
 jsonb_build_object('planId',pg_temp.id('51'),'version',1,'publishedAt',now()-interval '2 days','current',false,'changeSummary',null))from r where k='nurse-plan'),
 'Nurse version, date and current status match authorized publications without private summaries');
select pg_temp.ok((select jsonb_array_length(v->'publications')=2 from r where k='nurse-plan'),'Nurse publications remain scoped to the selected member');
select pg_temp.ok(pg_temp.refused($$select public.patient_clinical_case_snapshot(pg_temp.id('02'))$$),'A nurse cannot read another member''s plan metadata');
select pg_temp.ok(pg_temp.refused($$select public.patient_clinical_case_snapshot_unlogged(pg_temp.id('01'))$$),'The unaudited helper stays private');
select pg_temp.ok(pg_temp.refused($$select public.doctor_member_plan_versions(pg_temp.id('01'))$$),'Version metadata does not open the doctor-only RPC');
select pg_temp.ok(pg_temp.refused(format($$select public.doctor_ldl_read(%L)$$,pg_temp.id('01'))),'A nurse cannot call the doctor LDL read directly');
select pg_temp.ok(pg_temp.refused($$select public.doctor_ai_inbox()$$),'Nor the doctor inbox');
select pg_temp.as_user('07');
select pg_temp.ok(public.patient_clinical_case_snapshot(pg_temp.id('01'))->'draft'->>'explanation'='Private draft text','Fixture holds: the doctor''s own read has the draft that the nurse''s does not');

-- 7. Spend: service only, and the caps hold. Real calls need every lock a member call needs.
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_reserve(%L,0.1,false,'high','anthropic/claude-opus-5.5')$$,pg_temp.run('b1'))),'A browser cannot reserve');
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_finish(%L,'{"state":"answered","body":"forged"}')$$,pg_temp.run('b1'))),'A browser cannot write what Zoe said');
reset role;
select pg_temp.as_service();
select pg_temp.ok(public.staff_zoe_reserve(pg_temp.run('b1'),0.1,false,'high',(select model_id from public.zoe_tier_config where tier='high'))->>'code'='model_calls_not_permitted','Real calls stay off without the Zoe gate');
select pg_temp.ok(public.staff_zoe_reserve(pg_temp.run('b1'),0.1,false,'high','anthropic/not-configured')->>'ok'='false','Nor for a model outside the tier');
select pg_temp.ok(public.staff_zoe_reserve(pg_temp.run('b1'),0,true,'high','stand-in')->>'ok'='true','The stand-in costs nothing');
select pg_temp.ok(public.staff_zoe_finish(pg_temp.run('b1'),jsonb_build_object('state','answered','body','Checked text.','content',jsonb_build_object('say','[]'::jsonb),'tools','["bp"]'::jsonb,'why',jsonb_build_object('numbers_verified',2),'checks',jsonb_build_object('numbers',2),'costUsd',0,'provider','noreon.stand_in','promptVersion','p1','latencyMs',10))->>'ok'='true','The server finishes the run');
select pg_temp.ok(public.staff_zoe_finish(pg_temp.run('b1'),'{"state":"answered","body":"Second."}')->>'replayed'='true','Once only');
select pg_temp.ok((select count(*)=1 from public.staff_zoe_messages where conversation_id=pg_temp.conv('c1')and role='zoe'),'One answer');
select pg_temp.ok((select state='answered'and tools_called='["bp"]'::jsonb and why->>'numbers_verified'='2' and finished_at is not null from public.staff_zoe_runs where id=pg_temp.run('b1')),'The audit row of the run');
reset role;
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set staging_ai_mode=true,daily_spend_cap_usd=10;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33',510,0,0,pg_temp.id('07')from public.zoe_tier_config;
update public.zoe_settings set model_calls_allowed=true;
update public.zoe_tier_config set daily_cap_usd=10 where tier='high';
update public.staff_zoe_settings set staff_daily_cap_usd=0.15;
select pg_temp.as_user('07');set local role authenticated;
insert into r select 'b2',public.staff_zoe_begin(pg_temp.conv('c2'),pg_temp.id('a2'),'One');
select pg_temp.ok((select v->>'memberId'=pg_temp.id('02')::text from r where k='b2'),
 'Switching to the namesake conversation begins on its own member');
reset role;
select pg_temp.ok((select a.member_id=pg_temp.id('01') and b.member_id=pg_temp.id('02')
 and a.conversation_id=pg_temp.conv('c1') and b.conversation_id=pg_temp.conv('c2')
 from public.staff_zoe_runs a cross join public.staff_zoe_runs b where a.id=pg_temp.run('b1') and b.id=pg_temp.run('b2')),
 'Two namesake turns keep distinct persisted member bindings after switching conversations');
select pg_temp.as_service();
select pg_temp.ok(public.staff_zoe_reserve(pg_temp.run('b2'),0.1,false,'high',(select model_id from public.zoe_tier_config where tier='high'))->>'ok'='true','Inside the cap');
select pg_temp.ok(public.staff_zoe_reserve(pg_temp.run('b2'),0.1,false,'high',(select model_id from public.zoe_tier_config where tier='high'))->>'code'='run_not_reservable','Once per run');
select pg_temp.ok((select total>=0.1 from public._ai_spend((clock_timestamp()at time zone 'Asia/Yerevan')::date,'high')),'Staff spend counts in the service total');
select pg_temp.ok(public.staff_zoe_finish(pg_temp.run('b2'),jsonb_build_object('state','no_answer','reason','provider_timeout','body','Two','costUsd',null))->>'ok'='true','Finished with an unknown cost');
select pg_temp.ok((select total>=0.1 from public._ai_spend((clock_timestamp()at time zone 'Asia/Yerevan')::date,'high')),'An unknown cost keeps the reservation');
select pg_temp.as_user('07');set local role authenticated;
insert into r select 'b4',public.staff_zoe_begin(pg_temp.conv('c2'),pg_temp.id('a4'),'Two');
reset role;
select pg_temp.as_service();
select pg_temp.ok(public.staff_zoe_reserve(pg_temp.run('b4'),0.1,false,'high',(select model_id from public.zoe_tier_config where tier='high'))->>'code'='staff_spend_cap_reached','The per-staff daily cap');
reset role;
update public.staff_zoe_settings set staff_daily_cap_usd=10;
update public.zoe_tier_config set daily_cap_usd=0.15 where tier='high';
select pg_temp.as_service();
select pg_temp.ok(public.staff_zoe_reserve(pg_temp.run('b4'),0.1,false,'high',(select model_id from public.zoe_tier_config where tier='high'))->>'code'='tier_spend_cap_reached','The tier cap applies to staff runs');
-- Shared headroom matches member Zoe; the per-staff estimate check above is unchanged.
savepoint staff_shared_caps;
update public.zoe_tier_config set daily_cap_usd=6 where tier='high';
update public.staff_zoe_runs set cost_usd=4.40 where id=pg_temp.run('b2');
savepoint staff_before_reserve;
select pg_temp.ok(public.staff_zoe_reserve(pg_temp.run('b4'),1.70,false,'high',(select model_id from public.zoe_tier_config where tier='high'))->>'ok'='true','Staff: US$4.40 spent admits US$1.70 under US$6');
select pg_temp.ok((select state='started' and reserved and estimate_usd=1.70 and cost_usd is null from public.staff_zoe_runs where id=pg_temp.run('b4')),'Staff stores the full estimate in flight');
select pg_temp.ok((select tier_total=6.10 from public._ai_spend((clock_timestamp()at time zone 'Asia/Yerevan')::date,'high')),'Staff in-flight spend counts the full estimate');
select pg_temp.ok(public.staff_zoe_reserve(pg_temp.run('b3'),1.70,false,'high',(select model_id from public.zoe_tier_config where tier='high'))->>'code'='tier_spend_cap_reached','Another staff run sees the full in-flight estimate');
rollback to savepoint staff_before_reserve;
update public.staff_zoe_runs set cost_usd=5.80 where id=pg_temp.run('b2');
select pg_temp.ok(public.staff_zoe_reserve(pg_temp.run('b4'),1.70,false,'high',(select model_id from public.zoe_tier_config where tier='high'))->>'code'='tier_spend_cap_reached','Staff: US$5.80 spent refuses under US$6');
update public.staff_zoe_runs set cost_usd=5.70 where id=pg_temp.run('b2');
select pg_temp.ok(public.staff_zoe_reserve(pg_temp.run('b4'),1.70,false,'high',(select model_id from public.zoe_tier_config where tier='high'))->>'ok'='true','Staff: US$5.70 spent admits under US$6');
rollback to savepoint staff_before_reserve;
update public.staff_zoe_runs set tier='low',cost_usd=8.40 where id=pg_temp.run('b2');
-- Another staff member's settled spend avoids the separate per-staff cap here.
update public.staff_zoe_runs set staff_id=pg_temp.id('08') where id=pg_temp.run('b2');
savepoint staff_before_total;
select pg_temp.ok(public.staff_zoe_reserve(pg_temp.run('b4'),1.70,false,'high',(select model_id from public.zoe_tier_config where tier='high'))->>'ok'='true','Staff: US$8.40 total admits US$1.70 under US$10');
select pg_temp.ok(public.staff_zoe_reserve(pg_temp.run('b3'),1.70,false,'high',(select model_id from public.zoe_tier_config where tier='high'))->>'code'='daily_spend_cap_reached','Staff total counts full in-flight spend across tiers');
rollback to savepoint staff_before_total;
update public.staff_zoe_runs set cost_usd=9.80 where id=pg_temp.run('b2');
select pg_temp.ok(public.staff_zoe_reserve(pg_temp.run('b4'),1.70,false,'high',(select model_id from public.zoe_tier_config where tier='high'))->>'code'='daily_spend_cap_reached','Staff: US$9.80 total refuses under US$10');
update public.staff_zoe_runs set cost_usd=9.70 where id=pg_temp.run('b2');
select pg_temp.ok(public.staff_zoe_reserve(pg_temp.run('b4'),1.70,false,'high',(select model_id from public.zoe_tier_config where tier='high'))->>'ok'='true','Staff: US$9.70 total admits under US$10');
rollback to savepoint staff_shared_caps;
release savepoint staff_shared_caps;
select pg_temp.ok(public.staff_zoe_finish(pg_temp.run('b4'),jsonb_build_object('state','no_answer','reason','tier_spend_cap_reached','body','Limit.'))->>'ok'='true','Closed');
reset role;

-- 8. Removed staff, expired session, a changed assignment: everything closes, the history too.
set local role authenticated;
select pg_temp.as_user('07');
insert into r select 'b5',public.staff_zoe_begin(pg_temp.conv('c2'),pg_temp.id('a5'),'Three');
select pg_temp.ok(public.staff_zoe_gate(pg_temp.run('b5'),'bp')->>'ok'='true','Before the change: the gate is open');
reset role;
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.id('17')where user_id=pg_temp.id('02');
set local role authenticated;
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_gate(%L,'bp')$$,pg_temp.run('b5'))),'Reassigned mid-turn: the next read is refused');
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_read(%L)$$,pg_temp.conv('c2'))),'Reassigned: the history is closed');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.staff_zoe_recent()->'rows')x where x->>'memberId'=pg_temp.id('02')::text),'Reassigned: gone from recent');
reset role;
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.id('19')where user_id=pg_temp.id('02');
set local role authenticated;
select pg_temp.as_user('19');
insert into r select 'c4',public.staff_zoe_open(pg_temp.id('02'));
insert into r select 'b6',public.staff_zoe_begin(pg_temp.conv('c4'),pg_temp.id('a6'),'Before removal');
select pg_temp.ok(public.staff_zoe_gate(pg_temp.run('b6'),'bp')->>'ok'='true','Active doctor: open');
reset role;
update public.workspace_staff set active=false,removed_at=now()where user_id=pg_temp.id('19');
set local role authenticated;
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_gate(%L,'bp')$$,pg_temp.run('b6'))),'Removed staff: the gate is closed');
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_read(%L)$$,pg_temp.conv('c4'))),'Removed staff: history closed');
select pg_temp.ok(pg_temp.refused($$select public.staff_zoe_candidates('Namesake')$$),'Removed staff: find refused');
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_begin(%L,%L,'x')$$,pg_temp.conv('c4'),gen_random_uuid())),'Removed staff: no new turn');
reset role;
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.id('20')where user_id=pg_temp.id('02');
set local role authenticated;
select pg_temp.as_user('20');
insert into r select 'c5',public.staff_zoe_open(pg_temp.id('02'));
insert into r select 'b7',public.staff_zoe_begin(pg_temp.conv('c5'),pg_temp.id('a7'),'Before expiry');
reset role;
update auth.sessions set not_after=now()-interval '1 minute' where id=pg_temp.sid('20');
set local role authenticated;
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_gate(%L,'bp')$$,pg_temp.run('b7'))),'Expired session: the gate is closed');
select pg_temp.ok(pg_temp.refused(format($$select public.staff_zoe_read(%L)$$,pg_temp.conv('c5'))),'Expired session: history closed');
select pg_temp.ok(pg_temp.refused($$select public.staff_zoe_candidates('Namesake')$$),'Expired session: find refused');
reset role;
delete from auth.sessions where id=pg_temp.sid('20');
set local role authenticated;
select pg_temp.ok(pg_temp.refused($$select public.staff_zoe_recent()$$),'Deleted session: refused');
-- An inactive clinic closes it for its doctor as well.
reset role;
update public.workspace_clinics set active=false where id=pg_temp.id('91');
set local role authenticated;
select pg_temp.as_user('17');
select pg_temp.ok(pg_temp.refused($$select public.staff_zoe_candidates('Other')$$),'Wrong clinic: an inactive clinic closes the doctor''s access');
reset role;

-- 9. Separate from the member's conversation.
select pg_temp.ok(not exists(select 1 from public.zoe_runs where member_id in(pg_temp.id('01'),pg_temp.id('02'))),'A staff turn never creates a member Zoe run');
select pg_temp.ok(not exists(select 1 from public.conversations where member_id in(pg_temp.id('01'),pg_temp.id('02'))),'Nor a member conversation');
select 'staff-zoe sql checks passed';
rollback;
