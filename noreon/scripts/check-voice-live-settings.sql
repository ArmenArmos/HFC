-- WP V (20261108081234_voice_live_settings_provenance): voice settings for the Noreon administrator, the Live token rate
-- limits, Live-dictated reading provenance and the voice turn flag. Rolled back; synthetic fixtures only.
-- Actors: 01 member, 05 Noreon administrator, 06 nurse (clinic 10), 03 family physician (clinic 10).
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.state(q text)returns text language plpgsql as $$begin execute q;return 'ok';
exception when others then return sqlstate;end$$;
create function pg_temp.id(n text)returns uuid language sql immutable as $$select('5ea0f000-0000-4000-8000-0000000002'||n)::uuid$$;
create function pg_temp.sid(n text)returns uuid language sql immutable as $$select('5ea0f000-0000-4000-8000-0000000003'||n)::uuid$$;
create function pg_temp.as_user(u text)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(u),'role','authenticated','session_id',pg_temp.sid(u),
  'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true)$$;

insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),case when n='01'then '37499000201'end,case when n='01'then now()end from unnest(array['01','03','05','06'])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.sid(n),pg_temp.id(n),now(),now()from unnest(array['01','03','05','06'])n;
insert into public.workspace_clinics(id,name)values(pg_temp.id('10'),'Synthetic voice clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.id('05'),'admin','Synthetic admin',null),
 (pg_temp.id('06'),'nurse','Synthetic nurse',pg_temp.id('10')),(pg_temp.id('03'),'doctor','Synthetic doctor',pg_temp.id('10'));

-- 1. Settings columns and the trail's posture -------------------------------------------------------------------------
select pg_temp.ok((select live_enabled=false and live_model='gemini-live-2.5-flash-preview' from public.voice_settings where id),'Live is off by default, with the documented text model');
select pg_temp.ok(pg_temp.state($q$update public.voice_settings set live_model='bad model; drop' where id$q$)='23514','The Live model id is checked');
select pg_temp.ok((select relrowsecurity from pg_class where oid='public.voice_settings_events'::regclass),'The settings trail has RLS');
select pg_temp.ok(not exists(select 1 from pg_policies where schemaname='public'and tablename='voice_settings_events'),'The settings trail has no client policies');
select pg_temp.ok(not has_table_privilege('authenticated','public.voice_settings_events','select')and not has_table_privilege('anon','public.voice_settings_events','select'),'Clients cannot read the trail directly');
select pg_temp.ok(not has_function_privilege('anon','public.voice_settings_admin_update(uuid,integer,jsonb)','execute'),'Anonymous callers cannot update settings');

-- 2. Only the Noreon administrator reads and changes them -------------------------------------------------------------
select pg_temp.as_user('06');set local role authenticated;
select pg_temp.ok(pg_temp.state($q$select public.voice_settings_admin_read()$q$)='42501','A nurse cannot read voice settings');
select pg_temp.ok(pg_temp.state($q$select public.voice_settings_admin_update(gen_random_uuid(),1,'{"live_enabled":true}')$q$)='42501','A nurse cannot change voice settings');
reset role;
select pg_temp.as_user('01');set local role authenticated;
select pg_temp.ok(pg_temp.state($q$select public.voice_settings_admin_update(gen_random_uuid(),1,'{"live_enabled":true}')$q$)='42501','A member cannot change voice settings');
reset role;

select pg_temp.as_user('05');set local role authenticated;
create temp table v(version integer) on commit drop;
grant all on v to authenticated;
insert into v select (public.voice_settings_admin_read()#>>'{settings,version}')::integer;
select pg_temp.ok((public.voice_settings_admin_read())->>'ok'='true','The administrator reads voice settings');
select pg_temp.ok((public.voice_settings_admin_update(gen_random_uuid(),(select version from v)+5,'{"live_enabled":true}'))->>'code'='stale','A stale version is refused');
select pg_temp.ok((public.voice_settings_admin_update(gen_random_uuid(),(select version from v),'{"unknown":true}'))->>'code'='invalid','Unknown keys are refused');
select pg_temp.ok((public.voice_settings_admin_update(gen_random_uuid(),(select version from v),'{"live_enabled":"yes"}'))->>'code'='invalid','Wrong types are refused');
select pg_temp.ok((public.voice_settings_admin_update(gen_random_uuid(),(select version from v),'{"live_model":"Bad Model"}'))->>'code'='invalid','A bad model id is refused');
select pg_temp.ok((public.voice_settings_admin_update('5ea0f000-0000-4000-8000-0000000002aa',(select version from v),'{"live_enabled":true,"live_model":"gemini-live-custom-1"}'))#>>'{settings,version}'=((select version from v)+1)::text,'A change bumps the version');
select pg_temp.ok((public.voice_settings_admin_update('5ea0f000-0000-4000-8000-0000000002aa',(select version from v),'{"live_enabled":true,"live_model":"gemini-live-custom-1"}'))->>'replayed'='true','A retry of the same request replays');
select pg_temp.ok((public.voice_settings_admin_update(gen_random_uuid(),(select version from v)+1,'{"live_enabled":true}'))->>'changed'='false','Saving the same values changes nothing');
select pg_temp.ok(jsonb_array_length((public.voice_settings_admin_read())->'history')>=1,'The administrator sees the recent changes');
reset role;
select pg_temp.ok((select live_enabled and live_model='gemini-live-custom-1' from public.voice_settings where id),'The change is stored');
select pg_temp.ok((select count(*)=1 and bool_and(changed=array['live_enabled','live_model']and actor_id=pg_temp.id('05'))from public.voice_settings_events where request_id='5ea0f000-0000-4000-8000-0000000002aa'),'One trail row names the fields and the administrator');
select pg_temp.ok(pg_temp.state($q$update public.voice_settings_events set changed=array['enabled']$q$)='55000','The trail is append-only');
select pg_temp.ok(exists(select 1 from public._audit_source_rows(now()-interval '1 hour',now()+interval '1 hour',null,null,'admin_change')where source='voice_settings'and action='updated'and actor_id=pg_temp.id('05')),'The change appears in the unified audit as an administrator change');

-- 3. Live token limits -------------------------------------------------------------------------------------------------
select pg_temp.ok((select max_hits=30 and window_seconds=3600 from public._rate_limit_policy('member_live','user')),'member_live: 30 tokens per member per hour');
select pg_temp.ok((select max_hits=60 from public._rate_limit_policy('staff_live','user')),'staff_live: 60 tokens per staff member per hour');
select pg_temp.ok((select max_hits=60 from public._rate_limit_policy('member_speech','user')),'Speech limits unchanged');

-- 4. A Live-dictated reading keeps its label, only with the card's own numbers and time --------------------------------
create temp table t(at timestamptz) on commit drop;insert into t values(date_trunc('second',now())-interval '2 hours');
insert into public.zoe_chat_cards(member_id,request_id,kind,source,snapshot,claims)values
 (pg_temp.id('01'),gen_random_uuid(),'bp','chip',jsonb_build_object('v',1,'week',null,'typed',jsonb_build_object('systolic',182,'diastolic',96,'pulse',70,'measuredAt',(select at from t),'entrySource','patient_voice_live_confirmed')),
  jsonb_build_object('bp',jsonb_build_object('op','5ea0f000-0000-4000-8000-0000000002b1')));
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at)values(pg_temp.id('01'),'5ea0f000-0000-4000-8000-0000000002b1',182,96,70,(select at from t));
select pg_temp.ok((select entry_source from public.patient_measurements where submission_id='5ea0f000-0000-4000-8000-0000000002b1')='patient_voice_live_confirmed','The card label is copied for the dictated numbers');
insert into public.zoe_chat_cards(member_id,request_id,kind,source,snapshot,claims)values
 (pg_temp.id('01'),gen_random_uuid(),'bp','chip',jsonb_build_object('v',1,'week',null,'typed',jsonb_build_object('systolic',150,'diastolic',90,'pulse',null,'measuredAt',(select at+interval '1 minute' from t),'entrySource','patient_voice_live_confirmed')),
  jsonb_build_object('bp',jsonb_build_object('op','5ea0f000-0000-4000-8000-0000000002b2')));
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at)values(pg_temp.id('01'),'5ea0f000-0000-4000-8000-0000000002b2',151,90,null,(select at+interval '1 minute' from t));
select pg_temp.ok((select entry_source from public.patient_measurements where submission_id='5ea0f000-0000-4000-8000-0000000002b2')is null,'An edited reading does not keep the Live label');
select pg_temp.ok(pg_temp.state($q$insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at,entry_source)values(pg_temp.id('01'),gen_random_uuid(),120,80,now(),'patient_voice_beamed')$q$)='23514','Unknown sources are refused');
-- Unverified like a typed reading: the nurse verification task for 180 and above.
select public._typed_bp_task(m)from public.patient_measurements m where submission_id='5ea0f000-0000-4000-8000-0000000002b1';
select pg_temp.ok(exists(select 1 from public.care_queue_tasks t join public.patient_measurements m on t.source_ref='typed-bp:'||m.id where m.submission_id='5ea0f000-0000-4000-8000-0000000002b1'
 and t.queue='nurse'and t.reason_code='bp_member_reported_high'and t.summary->>'entrySource'='patient_voice_live_confirmed'),'A high Live-dictated reading raises the nurse verification task');
select pg_temp.ok(position('patient_voice_live_confirmed' in pg_get_functiondef('public._bp_weekly_trend(uuid,timestamptz)'::regprocedure))>0
 and position('patient_voice_live_confirmed' in pg_get_functiondef('public.zoe_run_health_context(uuid[])'::regprocedure))>0,'Measured-BP aggregates leave Live-dictated readings out');
select pg_temp.ok(pg_temp.state($q$insert into public.member_medicines(user_id,name,provenance)values(pg_temp.id('01'),'Synthetic medicine','patient_voice_live_confirmed')$q$)in('ok','23502','23503','23514')
 and position('patient_voice_live_confirmed' in pg_get_constraintdef((select oid from pg_constraint where conname='member_medicines_provenance_check')))>0,'The provenance list includes the Live label');

-- 5. Voice turns are marked in Zoe's job --------------------------------------------------------------------------------
select pg_temp.ok(position('m.voice_receipt is not null voice' in pg_get_functiondef('public.zoe_run_claim(integer)'::regprocedure))>0
 and position('jsonb_build_object(''voice'',true)' in pg_get_functiondef('public.zoe_run_claim(integer)'::regprocedure))>0,'zoe_run_claim marks a message with a voice receipt or Live marker');
rollback;
\echo 'check-voice-live-settings: ok'
