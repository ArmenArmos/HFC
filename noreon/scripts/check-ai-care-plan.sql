-- Fictional AI care plan draft checks; all fixtures roll back.
-- Switch, assigned-doctor-only reads and adoption, service-only reserve and finish, the shared real-call
-- lock and spend caps, the daily attempt limit, append-only generations, and the member's boolean
-- "preparing" flag (own case only, off with the switch, off once a plan is published).
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean,label text) returns void language plpgsql as $$begin
 if cond is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.raises(statement text,code text default '42501') returns boolean language plpgsql as $$begin
 execute statement;return false;
exception when others then
 if sqlstate=code then return true;end if;
 raise notice 'unexpected % %',sqlstate,sqlerrm;return false;
end$$;
-- aip: doctor 02, other doctor 03, member 04, other member 05, nurse 06, clinic 07, admin 08, inactive doctor 09.
insert into auth.users(id,phone,phone_confirmed_at)select ('a1900000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,case when n in(4,5)then '37400097000'||n end,case when n in(4,5)then now()end from generate_series(2,9)n where n<>7;
insert into public.workspace_clinics(id,name)values('a1900000-0000-4000-8000-000000000007','Synthetic plan clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id,active)values
 ('a1900000-0000-4000-8000-000000000002','doctor','Synthetic plan doctor','a1900000-0000-4000-8000-000000000007',true),
 ('a1900000-0000-4000-8000-000000000003','doctor','Synthetic plan other doctor','a1900000-0000-4000-8000-000000000007',true),
 ('a1900000-0000-4000-8000-000000000006','nurse','Synthetic plan nurse','a1900000-0000-4000-8000-000000000007',true),
 ('a1900000-0000-4000-8000-000000000008','admin','Synthetic plan admin',null,true),
 ('a1900000-0000-4000-8000-000000000009','doctor','Synthetic inactive doctor','a1900000-0000-4000-8000-000000000007',false);
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values
 ('a1900000-0000-4000-8000-000000000004','a1900000-0000-4000-8000-000000000002'),
 ('a1900000-0000-4000-8000-000000000005','a1900000-0000-4000-8000-000000000003');
insert into public.zoe_settings(singleton,daily_spend_cap_usd)values(true,10)on conflict(singleton)do update set daily_spend_cap_usd=10;
-- A live password session for the user (staff RPCs require a managed session, 20261020195207).
create function pg_temp.as_user(n int) returns void language plpgsql security definer as $$declare c jsonb:=jsonb_build_object('sub','a1900000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated','session_id','a1900000-0000-4000-8000-0000000003'||lpad(n::text,2,'0'));begin
 insert into auth.sessions(id,user_id,created_at,updated_at)select (c->>'session_id')::uuid,(c->>'sub')::uuid,now(),now()
  where exists(select 1 from auth.users where id=(c->>'sub')::uuid)on conflict(id)do nothing;
 perform set_config('request.jwt.claims',(c||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password'))))::text,true);
end$$;
create function pg_temp.as_service() returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.as_anon() returns void language sql as $$select set_config('request.jwt.claims','{"role":"anon"}',true)$$;
create function pg_temp.reserve(doctor int,member int,model text default 'noreon-protocol-1',local boolean default true,estimate numeric default 0,tier text default 'high') returns jsonb language sql as $$
 select public.ai_plan_reserve(('a1900000-0000-4000-8000-0000000000'||lpad(member::text,2,'0'))::uuid,('a1900000-0000-4000-8000-0000000000'||lpad(doctor::text,2,'0'))::uuid,
  3,repeat('a',32),public._ai_plan_lab_token(('a1900000-0000-4000-8000-0000000000'||lpad(member::text,2,'0'))::uuid),repeat('b',64),'ai-plan-prompt-3','ai-plan-builder-2','en',tier,model,local,estimate)
$$;
create function pg_temp.ready(local boolean default true,cost numeric default 0) returns jsonb language sql as $$
 select jsonb_build_object('state','ready','mode','model','outcome','drafted','provider','noreon.fake','responseModel','noreon-fake-plan-1','inputTokens',3000,'outputTokens',500,
  'costUsd',cost,'latencyMs',12,'guard',jsonb_build_array('item:number'),'summary','Synthetic summary.',
  'draft',jsonb_build_object('explanation','Synthetic explanation.','instructions','- Synthetic step.','followUp','Synthetic follow-up.','medicationName','','medicationDose','','medicationInstructions','','medicationTimes','[]'::jsonb),
  'items',jsonb_build_array(jsonb_build_object('id','bp:target','section','bp_target','status','needs_doctor_judgement')))
$$;
create function pg_temp.gen(r jsonb) returns uuid language sql as $$select (r->>'generationId')::uuid$$;
create function pg_temp.grow(id uuid) returns public.ai_plan_generations language sql security definer as $$select * from public.ai_plan_generations where ai_plan_generations.id=grow.id$$;

-- 1. Grants: no table access; service functions for the service role only; doctor and member functions for signed-in users.
select pg_temp.ok(not has_table_privilege(r,'public.ai_plan_generations','select')and not has_table_privilege(r,'public.ai_plan_capabilities','select'),'no table access for '||r)from unnest(array['anon','authenticated','service_role'])r;
select pg_temp.ok(has_function_privilege('service_role','public.ai_plan_reserve(uuid,uuid,bigint,text,text,text,text,text,text,text,text,boolean,numeric)','execute')
 and not has_function_privilege('anon','public.save_patient_clinical_draft_from_ai(uuid,bigint,text,jsonb,uuid)','execute')
 and not has_function_privilege('authenticated','public.ai_plan_reserve(uuid,uuid,bigint,text,text,text,text,text,text,text,text,boolean,numeric)','execute')
 and not has_function_privilege('authenticated','public.ai_plan_finish(uuid,jsonb)','execute')and not has_function_privilege('anon','public.doctor_ai_plan_read(uuid)','execute')
 and has_function_privilege('authenticated','public.doctor_ai_plan_read(uuid)','execute')and not has_function_privilege('anon','public.patient_plan_preparing()','execute')
 and not has_function_privilege('authenticated','public._ai_spend(date,text)','execute'),'function grants');

-- 2. Switch off by default.
select pg_temp.ok(not(select enabled from public.ai_plan_capabilities),'ai_plan_draft_enabled defaults off');
select pg_temp.as_user(2);
select pg_temp.ok(public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')->>'enabled'='false','switch off: read says disabled');
select pg_temp.as_service();
select pg_temp.ok(pg_temp.reserve(2,4)->>'code'='disabled','switch off: reserve refused');
select pg_temp.as_user(4);
select pg_temp.ok(public.patient_plan_preparing()=false,'switch off: member flag false');
update public.ai_plan_capabilities set enabled=true;

-- 3. Doctor read: assigned active doctor only.
select pg_temp.as_user(2);
select pg_temp.ok((public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')->>'enabled')::boolean,'assigned doctor reads');
select pg_temp.ok(jsonb_typeof(public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')->'labValues')='array'
 and public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')->'latest'='null'::jsonb,'empty read');
select pg_temp.ok(pg_temp.raises($$select public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000005')$$),'doctor refused for another doctor''s member');
select pg_temp.as_user(3);select pg_temp.ok(pg_temp.raises($$select public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')$$),'other doctor refused');
select pg_temp.as_user(6);select pg_temp.ok(pg_temp.raises($$select public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')$$),'nurse refused');
select pg_temp.as_user(8);select pg_temp.ok(pg_temp.raises($$select public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')$$),'admin refused');
select pg_temp.as_user(4);select pg_temp.ok(pg_temp.raises($$select public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')$$),'member refused');
select pg_temp.as_anon();select pg_temp.ok(pg_temp.raises($$select public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')$$),'anon refused');

-- 4. Service functions refuse every other role, even when called directly.
select pg_temp.as_user(2);
select pg_temp.ok(pg_temp.raises($$select pg_temp.reserve(2,4)$$),'doctor cannot reserve');
select pg_temp.ok(pg_temp.raises($$select public.ai_plan_finish(gen_random_uuid(),'{}')$$),'doctor cannot finish');

-- 5. Reserve: assignment re-checked in the database.
select pg_temp.as_service();
select pg_temp.ok(pg_temp.reserve(3,4)->>'code'='not_assigned','not the assigned doctor');
select pg_temp.ok(pg_temp.reserve(9,4)->>'code'='not_assigned','unassigned inactive doctor');
update public.patient_clinical_cases set assigned_doctor_id='a1900000-0000-4000-8000-000000000009'where user_id='a1900000-0000-4000-8000-000000000005';
select pg_temp.ok(pg_temp.reserve(9,5)->>'code'='not_assigned','assigned but inactive doctor');
update public.workspace_clinics set active=false where id='a1900000-0000-4000-8000-000000000007';
select pg_temp.ok(pg_temp.reserve(2,4)->>'code'='not_assigned','inactive clinic');
update public.workspace_clinics set active=true where id='a1900000-0000-4000-8000-000000000007';
select pg_temp.ok(public.ai_plan_reserve('a1900000-0000-4000-8000-000000000004','a1900000-0000-4000-8000-000000000002',3,'short',repeat('c',32),repeat('b',64),'p','b','en','high','m',true,0)->>'code'='invalid','invalid input');
select pg_temp.ok(public.ai_plan_reserve('a1900000-0000-4000-8000-000000000004','a1900000-0000-4000-8000-000000000002',3,repeat('a',32),repeat('c',32),repeat('b',64),'p','b','en','high','m',true,0)->>'code'='stale','facts built from other lab values: stale');

-- 6. Real calls: the shared lock and caps.
select pg_temp.ok(pg_temp.reserve(2,4,'anthropic/claude-opus-5.5',false,0.05)->>'code'='model_calls_not_permitted','real call refused while model calls are off');
select pg_temp.ok((pg_temp.grow(pg_temp.gen(pg_temp.reserve(2,4,'anthropic/claude-opus-5.5',false,0.05)))).state='refused','a refusal is recorded');
set local session_replication_role=replica;
update public.zoe_settings set staging_ai_mode=true,model_calls_allowed=true;
set local session_replication_role=origin;
select pg_temp.ok(pg_temp.reserve(2,4,'anthropic/claude-opus-5.5',false,0.05)->>'ok'='true','primary high-tier model reserved');
select pg_temp.ok(pg_temp.reserve(2,4,'openai/gpt-6-astra',false,0.05)->>'ok'='true','fallback high-tier model reserved');
select pg_temp.ok(pg_temp.reserve(2,4,'anthropic/claude-haiku-5.5',false,0.05)->>'code'='model_not_configured_for_tier','another tier''s model refused');
select pg_temp.ok(pg_temp.reserve(2,4,'anthropic/claude-opus-5.5',false,5.95)->>'code'='tier_spend_cap_reached','tier cap (US$6) holds');
select pg_temp.ok((select tier_total from public._ai_spend((clock_timestamp()at time zone 'Asia/Yerevan')::date,'high'))>=0.1,'plan drafts count in the shared spend');
select pg_temp.ok((pg_temp.grow(pg_temp.gen(pg_temp.reserve(2,4,'noreon-fake-plan-1',true,9)))).estimate_usd=0,'local attempts reserve nothing');
set local session_replication_role=replica;
update public.zoe_settings set staging_ai_mode=false;
set local session_replication_role=origin;
select pg_temp.ok(pg_temp.reserve(2,4,'anthropic/claude-opus-5.5',false,0.05)->>'code'='model_calls_not_permitted','no staging mode and no signed agreement: refused');

-- 6b. Billing on failure (Codex #280 F4): a real call finished without a reported cost keeps its reserved
-- estimate in the shared spend that Zoe, lab reading and plan reservations all read (_ai_spend).
set local session_replication_role=replica;
update public.zoe_settings set staging_ai_mode=true;
set local session_replication_role=origin;
create temp table u as select pg_temp.gen(pg_temp.reserve(2,4,'anthropic/claude-opus-5.5',false,2.5)) id;
create temp table spend0 as select tier_total from public._ai_spend((clock_timestamp()at time zone 'Asia/Yerevan')::date,'high');
select pg_temp.ok(public.ai_plan_finish((select id from u),'{"state":"failed","outcome":"error_timeout","provider":"vercel.ai_gateway","latencyMs":60000}')->>'ok'='true','unknown-usage failure finished');
select pg_temp.ok((pg_temp.grow((select id from u))).cost_usd is null,'unknown usage: cost left unknown');
select pg_temp.ok((select tier_total from public._ai_spend((clock_timestamp()at time zone 'Asia/Yerevan')::date,'high'))=(select tier_total from spend0),'the reserved estimate stays in the shared spend');
select pg_temp.ok(pg_temp.reserve(2,4,'anthropic/claude-opus-5.5',false,3.5)->>'code'='tier_spend_cap_reached','the kept estimate still counts against the tier cap');
-- Zoe and lab reading see the same kept estimate, with different incoming headroom checks.
set local session_replication_role=replica;
-- 20261023063508 (Codex A2-3): zoe_run_reserve and zoe_run_finish re-check Zoe consent; the fixture's members consent.
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version=coalesce(consent_wording_version,'zoe-consent-draft-1')where singleton;
insert into public.zoe_consents(member_id,kind,granted,wording_version)select c.member_id,'zoe_reads_messages',true,(select s.consent_wording_version from public.zoe_settings s where s.singleton)
 from(select 'a1900000-0000-4000-8000-000000000004'::uuid member_id)c where not public._zoe_consent_ok(c.member_id);
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day)
 values('a1900000-0000-4000-8000-000000000201',gen_random_uuid(),'a1900000-0000-4000-8000-000000000004',1,0,0,(clock_timestamp()at time zone 'Asia/Yerevan')::date);
insert into public.lab_ai_jobs(id,attachment_id,file_id,user_id,state,lease_token,lease_until)
 values('a1900000-0000-4000-8000-000000000202',gen_random_uuid(),gen_random_uuid(),'a1900000-0000-4000-8000-000000000004','running','a1900000-0000-4000-8000-000000000203',now()+interval '5 minutes');
savepoint zoe_headroom;
create temp table callers as select public.zoe_run_reserve('a1900000-0000-4000-8000-000000000201',3.5,false,'[]','high','anthropic/claude-opus-5.5') zoe,
 public.lab_ai_call_reserve('a1900000-0000-4000-8000-000000000202','a1900000-0000-4000-8000-000000000203','extract','high','anthropic/claude-opus-5.5',false,3.5) lab;
set local session_replication_role=origin;
select pg_temp.ok((select zoe->>'ok' from callers)='true','Zoe admits with US$0.25 room above the kept estimate');
select pg_temp.ok((select lab->>'code' from callers)='tier_spend_cap_reached','lab reading sees the kept estimate');
rollback to savepoint zoe_headroom;
release savepoint zoe_headroom;
set local session_replication_role=origin;
create temp table b as select pg_temp.gen(pg_temp.reserve(2,4,'anthropic/claude-opus-5.5',false,0.05)) id;
select pg_temp.ok(public.ai_plan_finish((select id from b),'{"state":"failed","outcome":"error_invalid_output","provider":"vercel.ai_gateway","inputTokens":4000,"outputTokens":1500,"costUsd":0.0575,"latencyMs":9000}')->>'ok'='true'
 and (pg_temp.grow((select id from b))).cost_usd=0.0575,'a billed failure records its cost');
create temp table n as select pg_temp.gen(pg_temp.reserve(2,4,'anthropic/claude-opus-5.5',false,0.05)) id;
select pg_temp.ok(public.ai_plan_finish((select id from n),pg_temp.ready(false)-'costUsd')->>'ok'='true'and(pg_temp.grow((select id from n))).cost_usd is null,'a ready real call with unknown usage keeps its estimate');
-- 6c. Purpose tiers (lib/zoe/purpose-route.ts): plan summaries and lab reading reserve on the medium tier by
-- default. A medium reservation must use the medium tier's models and stop at the medium cap (US$3 seeded),
-- not the high cap Zoe intake runs under; lab reading on medium sees the same medium spend.
-- Member 10 (assigned to doctor 02) keeps these attempts out of member 04's daily attempt limit.
insert into auth.users(id)values('a1900000-0000-4000-8000-000000000010');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('a1900000-0000-4000-8000-000000000010','a1900000-0000-4000-8000-000000000002');
create temp table t0 as select (select tier_total from public._ai_spend((clock_timestamp()at time zone 'Asia/Yerevan')::date,'medium')) medium,
 (select tier_total from public._ai_spend((clock_timestamp()at time zone 'Asia/Yerevan')::date,'high')) high,
 (select total from public._ai_spend((clock_timestamp()at time zone 'Asia/Yerevan')::date,null)) total,
 (select daily_cap_usd from public.zoe_tier_config where tier='medium') medium_cap,(select daily_cap_usd from public.zoe_tier_config where tier='high') high_cap;
select pg_temp.ok((select medium_cap<high_cap from t0),'seeded medium cap is below the high cap');
create temp table m as select pg_temp.gen(pg_temp.reserve(2,10,'anthropic/claude-sonnet-5.5',false,0.05,'medium')) id;
select pg_temp.ok((select id from m)is not null and (pg_temp.grow((select id from m))).reserved and (pg_temp.grow((select id from m))).tier='medium','medium primary model reserved on the medium tier');
select pg_temp.ok(pg_temp.reserve(2,10,'openai/gpt-6-sol',false,0.05,'medium')->>'ok'='true','medium fallback model reserved');
select pg_temp.ok(pg_temp.reserve(2,10,'anthropic/claude-opus-5.5',false,0.05,'medium')->>'code'='model_not_configured_for_tier','the high tier''s model is refused on medium');
select pg_temp.ok(pg_temp.reserve(2,10,'anthropic/claude-sonnet-5.5',false,0.05,'high')->>'code'='model_not_configured_for_tier','the medium tier''s model is refused on high');
select pg_temp.ok((select tier_total from public._ai_spend((clock_timestamp()at time zone 'Asia/Yerevan')::date,'medium'))=(select medium+0.1 from t0)
 and(select tier_total from public._ai_spend((clock_timestamp()at time zone 'Asia/Yerevan')::date,'high'))=(select high from t0),'medium reservations count on medium only');
-- An estimate just over what is left under the medium cap, which would still fit under the high cap and the daily total.
create temp table over as select medium_cap-(medium+0.1)+0.01 est from t0;
select pg_temp.ok((select high+(select est from over)<=high_cap and total+0.1+(select est from over)<=least((select daily_spend_cap_usd from public.zoe_settings),10) from t0),'the estimate fits the high cap and daily total');
select pg_temp.ok(pg_temp.reserve(2,10,'anthropic/claude-sonnet-5.5',false,(select est from over),'medium')->>'code'='tier_spend_cap_reached','the medium cap refuses it');
select pg_temp.ok(public.lab_ai_call_reserve('a1900000-0000-4000-8000-000000000202','a1900000-0000-4000-8000-000000000203','extract','medium','anthropic/claude-sonnet-5.5',false,(select est from over))->>'code'='tier_spend_cap_reached',
 'lab reading on medium is refused at the same medium cap');
select pg_temp.ok(public.lab_ai_call_reserve('a1900000-0000-4000-8000-000000000202','a1900000-0000-4000-8000-000000000203','summary','medium','anthropic/claude-sonnet-5.5',false,0.01)->>'ok'='true','lab reading on medium within the cap is reserved');
select pg_temp.ok((select tier from public.lab_ai_calls where job_id='a1900000-0000-4000-8000-000000000202' and reserved order by created_at desc limit 1)='medium','the lab call is recorded on medium');
set local session_replication_role=replica;
update public.zoe_settings set staging_ai_mode=false;
set local session_replication_role=origin;

-- 7. Finish once; append-only.
create temp table g as select pg_temp.gen(pg_temp.reserve(2,4)) id;
select pg_temp.ok(public.ai_plan_finish((select id from g),'{"state":"ready"}')->>'code'='invalid','invalid result refused');
select pg_temp.ok(public.ai_plan_finish((select id from g),pg_temp.ready(true,0.5))->>'code'='invalid','a local attempt cannot record a cost');
select pg_temp.ok(public.ai_plan_finish((select id from g),pg_temp.ready()-'items')->>'code'='invalid','ready needs items');
select pg_temp.ok(public.ai_plan_finish((select id from g),pg_temp.ready())->>'ok'='true','finished');
select pg_temp.ok(public.ai_plan_finish((select id from g),pg_temp.ready())->>'replayed'='true','finish replays');
select pg_temp.ok((pg_temp.grow((select id from g))).state='ready'and(pg_temp.grow((select id from g))).guard='{item:number}','stored');
select pg_temp.ok(pg_temp.raises($$update public.ai_plan_generations set draft='{"explanation":"changed"}'where id=(select id from g)$$,'55000'),'finished draft immutable');
select pg_temp.ok(pg_temp.raises($$update public.ai_plan_generations set input_sha256=repeat('c',64)where id=(select id from g)$$,'55000'),'reservation immutable');
select pg_temp.ok(pg_temp.raises($$delete from public.ai_plan_generations where id=(select id from g)$$,'55000'),'no delete');
select pg_temp.ok(pg_temp.raises($$insert into public.ai_plan_generations(user_id,doctor_id,case_revision,evidence_token,input_sha256,prompt_version,builder_version,language,tier,model,local,spend_day,estimate_usd,reserved,state)
 values('a1900000-0000-4000-8000-000000000004','a1900000-0000-4000-8000-000000000002',1,repeat('a',32),repeat('b',64),'p','b','en','high','m',true,current_date,0,true,'ready')$$,'55000'),'born reserved only');
create temp table f as select pg_temp.gen(pg_temp.reserve(2,4)) id;
select pg_temp.ok(public.ai_plan_finish((select id from f),'{"state":"failed","outcome":"error_timeout","provider":"vercel.ai_gateway","costUsd":0,"latencyMs":60000}')->>'ok'='true','failure recorded');
select pg_temp.ok(public.ai_plan_finish((select id from f),pg_temp.ready())->>'replayed'='true','a failure is final');

-- 8. Doctor sees the latest ready draft; adoption by the assigned doctor only.
select pg_temp.as_user(2);
select pg_temp.ok(public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')->'latest'->>'id'=(select id::text from g),'latest ready draft');
select pg_temp.ok((public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')->'latest'->>'byYou')::boolean
 and public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')->'latest'->'draft'->>'medicationName'='','draft returned without medicine');
select pg_temp.ok(public.doctor_ai_plan_adopted((select id from g),array['explanation','dose'])->>'status'='invalid','unknown field refused');
select pg_temp.ok(public.doctor_ai_plan_adopted((select id from g),array['explanation','followUp'])->>'status'='saved','adoption recorded');
select pg_temp.ok((pg_temp.grow((select id from g))).adopted_fields='{explanation,followUp}'and(pg_temp.grow((select id from g))).adopted_by='a1900000-0000-4000-8000-000000000002','adoption stored');
select pg_temp.ok(public.doctor_ai_plan_adopted((select id from f),array['explanation'])->>'status'='stale','a failed attempt cannot be adopted');
select pg_temp.as_user(3);select pg_temp.ok(pg_temp.raises($$select public.doctor_ai_plan_adopted((select id from g),array['explanation'])$$),'other doctor cannot adopt');
select pg_temp.as_user(4);select pg_temp.ok(pg_temp.raises($$select public.doctor_ai_plan_adopted((select id from g),array['explanation'])$$),'member cannot adopt');

-- 8b. Lab freshness through the real save path (Codex #280 F2). save_patient_clinical_draft_from_ai checks the
-- draft against the case evidence and the current lab values and review states inside the save transaction;
-- a review, correction, rejection or detachment that committed first refuses the save (40001).
-- (The concurrent case, a change waiting on the save's locks, is scripts/check-ai-care-plan-race.mjs.)
insert into public.patient_consents(user_id,version)values('a1900000-0000-4000-8000-000000000004','patient-pilot-v1');
insert into public.patient_assessments(user_id,revision,completed_at)values('a1900000-0000-4000-8000-000000000004',2,now());
insert into auth.sessions(id,user_id,created_at,updated_at)values('a1900000-0000-4000-8000-000000000002','a1900000-0000-4000-8000-000000000002',clock_timestamp(),clock_timestamp());
set local session_replication_role=replica;
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id)values('a1900000-0000-4000-8000-000000000041','a1900000-0000-4000-8000-000000000004','a1900000-0000-4000-8000-000000000006','Synthetic nurse','nurse','a1900000-0000-4000-8000-000000000007');
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state)
 values('a1900000-0000-4000-8000-000000000050',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'a1900000-0000-4000-8000-000000000002',gen_random_uuid(),'[]',now(),gen_random_uuid(),1,gen_random_uuid(),'SYNTHETIC.pdf','application/pdf',1000,repeat('a',64),'synthetic/50',gen_random_uuid(),1000,repeat('a',64),'stored');
insert into public.clinic_result_attachments(id,file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id)values('a1900000-0000-4000-8000-000000000052','a1900000-0000-4000-8000-000000000050','a1900000-0000-4000-8000-000000000007','a1900000-0000-4000-8000-000000000004','a1900000-0000-4000-8000-000000000041','noreon-admin','a1900000-0000-4000-8000-000000000002',gen_random_uuid());
insert into public.lab_ai_jobs(id,attachment_id,file_id,user_id,state,identity_status,outcome,finished_at)values('a1900000-0000-4000-8000-000000000053','a1900000-0000-4000-8000-000000000052','a1900000-0000-4000-8000-000000000050','a1900000-0000-4000-8000-000000000004','done','match','extracted',now());
insert into public.lab_ai_values(id,job_id,user_id,file_id,attachment_id,seq,test_name,catalogue_ref,value_text,value,unit,page,status)values('a1900000-0000-4000-8000-000000000054','a1900000-0000-4000-8000-000000000053','a1900000-0000-4000-8000-000000000004','a1900000-0000-4000-8000-000000000050','a1900000-0000-4000-8000-000000000052',1,'LDL-C','ldl_c','5.3',5.3,'mmol/l',1,'unverified');
set local session_replication_role=origin;
create function pg_temp.doctor_session() returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','a1900000-0000-4000-8000-000000000002','role','authenticated','session_id','a1900000-0000-4000-8000-000000000002',
  'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true)
$$;
create function pg_temp.evidence() returns text language sql security definer as $$select public.patient_clinical_evidence('a1900000-0000-4000-8000-000000000004')->>'token'$$;
create function pg_temp.revision() returns bigint language sql security definer as $$select revision from public.patient_clinical_cases where user_id='a1900000-0000-4000-8000-000000000004'$$;
-- A ready draft on the current evidence and labs.
create function pg_temp.fresh_draft() returns uuid language plpgsql as $$
declare id uuid;
begin
 perform pg_temp.as_service();
 id:=(public.ai_plan_reserve('a1900000-0000-4000-8000-000000000004','a1900000-0000-4000-8000-000000000002',pg_temp.revision(),pg_temp.evidence(),
  public._ai_plan_lab_token('a1900000-0000-4000-8000-000000000004'),repeat('b',64),'ai-plan-prompt-3','ai-plan-builder-2','en','high','noreon-protocol-1',true,0)->>'generationId')::uuid;
 perform public.ai_plan_finish(id,pg_temp.ready());
 perform pg_temp.doctor_session();
 return id;
end$$;
create function pg_temp.save_ai(g uuid) returns bigint language sql as $$
 select public.save_patient_clinical_draft_from_ai('a1900000-0000-4000-8000-000000000004',pg_temp.revision(),pg_temp.evidence(),
  '{"explanation":"Synthetic AI explanation.","instructions":"- Synthetic step.","followUp":"","medicationName":"","medicationDose":"","medicationInstructions":"","medicationTimes":[]}'::jsonb,g)
$$;
create temp table fresh as select pg_temp.fresh_draft() id;
select pg_temp.ok(public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')->>'labToken'=public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')->'latest'->>'labToken','new draft is on the current lab values');
select pg_temp.ok(pg_temp.save_ai((select id from fresh))>0,'AI text saves while the draft is current');
create temp table fresh1 as select pg_temp.fresh_draft() id;
set local session_replication_role=replica;
update public.lab_ai_values set status='corrected',corrected_value=4.1,reviewed_by='a1900000-0000-4000-8000-000000000002',reviewed_at=now()where id='a1900000-0000-4000-8000-000000000054';
set local session_replication_role=origin;
select pg_temp.ok(public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')->>'labToken'<>public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')->'latest'->>'labToken','a corrected value makes the draft stale for the editor');
select pg_temp.ok(pg_temp.raises($$select pg_temp.save_ai((select id from fresh1))$$,'40001'),'save refused: draft on a value corrected since');
select pg_temp.ok(public.doctor_ai_plan_adopted((select id from fresh1),array['explanation'])->>'status'='stale','adoption refused on a stale draft');
-- B2-2: the plan saved from the first draft keeps its lab token; the correction since blocks publication
-- (where every publication is written) until a plain save of the draft clears the token.
savepoint b22;
set local session_replication_role=replica;
insert into public.patient_care_plans(id,user_id,clinician,instructions)values('a1900000-0000-4000-8000-000000000060','a1900000-0000-4000-8000-000000000004','Synthetic plan doctor','x');
set local session_replication_role=origin;
create function pg_temp.publish() returns void language sql as $$
 insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft)
  values('a1900000-0000-4000-8000-000000000004','a1900000-0000-4000-8000-000000000060',gen_random_uuid(),'a1900000-0000-4000-8000-000000000002',pg_temp.revision(),repeat('a',32),'{}','{}','{}')
$$;
select pg_temp.ok((select draft_lab_token from public.patient_clinical_cases where user_id='a1900000-0000-4000-8000-000000000004')is not null,'AI save keeps the lab token');
select pg_temp.ok(pg_temp.raises($$select pg_temp.publish()$$,'40001'),'publication refused: lab value corrected since the AI save');
select public.save_patient_clinical_draft('a1900000-0000-4000-8000-000000000004',pg_temp.revision(),pg_temp.evidence(),'{"explanation":"Doctor edit.","instructions":"- Synthetic step.","followUp":"","medicationName":"","medicationDose":"","medicationInstructions":"","medicationTimes":[]}'::jsonb);
select pg_temp.ok((select draft_lab_token from public.patient_clinical_cases where user_id='a1900000-0000-4000-8000-000000000004')is null,'plain save clears the lab token');
select pg_temp.publish();
rollback to savepoint b22;
create temp table fresh2 as select pg_temp.fresh_draft() id;
set local session_replication_role=replica;
update public.lab_ai_values set status='rejected',corrected_value=null,corrected_unit=null where id='a1900000-0000-4000-8000-000000000054';
set local session_replication_role=origin;
select pg_temp.ok(pg_temp.raises($$select pg_temp.save_ai((select id from fresh2))$$,'40001'),'save refused: value rejected since');
create temp table fresh3 as select pg_temp.fresh_draft() id;
set local session_replication_role=replica;
insert into public.clinic_result_detachments(attachment_id,actor_id,reason,submission_id)values('a1900000-0000-4000-8000-000000000052','a1900000-0000-4000-8000-000000000002','Synthetic detach',gen_random_uuid());
set local session_replication_role=origin;
select pg_temp.ok(pg_temp.raises($$select pg_temp.save_ai((select id from fresh3))$$,'40001'),'save refused: file detached since');
create temp table fresh4 as select pg_temp.fresh_draft() id;
select pg_temp.ok(pg_temp.raises($$select public.save_patient_clinical_draft_from_ai('a1900000-0000-4000-8000-000000000004',pg_temp.revision(),repeat('e',32),'{}'::jsonb,(select id from fresh4))$$,'40001'),'save refused: other case evidence');
select pg_temp.ok(pg_temp.raises($$select public.save_patient_clinical_draft_from_ai('a1900000-0000-4000-8000-000000000004',pg_temp.revision(),pg_temp.evidence(),'{}'::jsonb,gen_random_uuid())$$,'40001'),'save refused: unknown draft');
select pg_temp.as_user(3);select pg_temp.ok(pg_temp.raises($$select pg_temp.save_ai((select id from fresh4))$$),'other doctor cannot save through the AI path');
select pg_temp.as_user(6);select pg_temp.ok(pg_temp.raises($$select pg_temp.save_ai((select id from fresh4))$$),'nurse cannot save through the AI path');

-- 9. Member flag: own case only; off once a plan is published.
select pg_temp.as_user(4);select pg_temp.ok(public.patient_plan_preparing(),'member 04: doctor is preparing the plan');
select pg_temp.as_user(5);select pg_temp.ok(not public.patient_plan_preparing(),'member 05: nothing started');
select pg_temp.as_user(2);select pg_temp.ok(not public.patient_plan_preparing(),'a doctor has no member case');
set local session_replication_role=replica;
insert into public.patient_care_plans(user_id,clinician,instructions)values('a1900000-0000-4000-8000-000000000004','Synthetic plan doctor','Synthetic instructions');
set local session_replication_role=origin;
select pg_temp.as_user(4);select pg_temp.ok(not public.patient_plan_preparing(),'published plan: flag off');
select pg_temp.as_user(2);select pg_temp.ok((public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')->>'published')::boolean,'doctor read shows published');

-- 10. Daily attempt limit (20 per member per day, all attempts count).
select pg_temp.as_service();
select pg_temp.reserve(2,4)from generate_series(1,20-(select count(*)::int from public.ai_plan_generations where user_id='a1900000-0000-4000-8000-000000000004'));
select pg_temp.ok(pg_temp.reserve(2,4)->>'code'='daily_attempt_limit','daily attempt limit');
select pg_temp.as_user(2);select pg_temp.ok((public.doctor_ai_plan_read('a1900000-0000-4000-8000-000000000004')->>'attemptsToday')::int=20,'attempts counted');

rollback;
\echo 'AI care plan draft SQL checks passed'
