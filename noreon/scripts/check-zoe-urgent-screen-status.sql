-- The Zoe 103 screen's status (20261030222034; bp-entry-safety RESULTS, false promise 1): care_alert_member_status(request).zoe says "alerted"
-- only when that message, or the Zoe run on it, raised an alert, "pending" until that is settled, and neither once it is settled with no
-- alert. The screen opens before the alert exists, so pending is the real first state. Another message's alert never counts (Astra ZUT-01), a
-- resolved one still does, neither time nor the switch settles it (Astra ZUT-02), and the questionnaire keys are not affected. Rolled back. Synthetic fixtures only.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.send(m text,sid text,rid text,txt text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(m,sid);set local role authenticated;j:=public.conversation_receive(jsonb_build_object('requestId',rid,'text',txt));reset role;return j;end$$;
create function pg_temp.claim()returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_claim(10);reset role;return j;end$$;
create function pg_temp.run_for(m uuid)returns uuid language sql as $$select (x->>'runId')::uuid from jsonb_array_elements(pg_temp.claim())x where (x->>'memberId')::uuid=m$$;
create function pg_temp.finish(run uuid,arg jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_finish(run,arg);reset role;return j;end$$;
-- An urgent finish as the worker sends it: the fixed text, the urgent match event with its RF ids, and the health record when given.
create function pg_temp.urgent(reason text,flags text,health jsonb default null,outcome text default 'discarded')returns jsonb language sql as $$
 select jsonb_strip_nulls(jsonb_build_object('outcome',outcome,'reason',reason,'summary','Synthetic summary for the doctor.','answer','Synthetic urgent text. Call 103.','language','en',
  'guardReasons','[]'::jsonb,'redactionCount',0,'usage',jsonb_build_object('inputTokens',0,'outputTokens',0),'costUsd',0,'latencyMs',5,
  'provider','none','model','none','configVersion','zoe-urgent-status-check','tier','none','tierReason','urgent','fallbackUsed',false,
  'events',jsonb_build_array(jsonb_build_object('name','zoe.urgent_match','outcome','escalate','reason','urgent_words_matched','rule','zoe.urgent_staging_placeholder','ruleVersion','check','actor','system',
   'attributes',jsonb_build_object('noreon.zoe.urgent.red_flags',flags))),'health',health))
$$;
create function pg_temp.h(reason text,fwd text default 'auto',urgency text default 'emergency')returns jsonb language sql as $$
 select jsonb_build_object('urgency',urgency,'modelUrgency','none','forward',fwd,'forwardReason',reason)$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;
create function pg_temp.k(key text)returns uuid language sql as $$select (v#>>'{}')::uuid from kv where k=key$$;
-- One member message and its claimed run.
create function pg_temp.turn(key text,m text,sid text,rid text,txt text)returns uuid language plpgsql as $$declare run uuid;begin
 perform pg_temp.send(m,sid,rid,txt);run:=pg_temp.run_for(m::uuid);insert into kv values(key,to_jsonb(run));return run;end$$;
create function pg_temp.alert(m uuid)returns public.care_alerts language sql as $$select * from public.care_alerts where member_id=m and source='zoe'and state<>'resolved'$$;

-- A, B, C: app members (EN) of doctor D.
insert into auth.users(id,phone,phone_confirmed_at)values('e1860000-0000-4000-8000-000000000001','37499086801',now()),('e1860000-0000-4000-8000-000000000003','37499086803',now()),
 ('e1860000-0000-4000-8000-000000000005','37499086805',now()),('e1860000-0000-4000-8000-000000000002','37499086802',now());
insert into public.workspace_clinics(id,name)values('e1860000-0000-4000-8000-000000000004','Synthetic alert clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('e1860000-0000-4000-8000-000000000002','doctor','Dr Synthetic Alert Doctor','e1860000-0000-4000-8000-000000000004');
insert into auth.sessions(id,user_id,created_at,updated_at)values('e1860000-0000-4000-8000-000000000011','e1860000-0000-4000-8000-000000000001',now(),now()),
 ('e1860000-0000-4000-8000-000000000013','e1860000-0000-4000-8000-000000000003',now(),now()),('e1860000-0000-4000-8000-000000000015','e1860000-0000-4000-8000-000000000005',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)select x::uuid,'e1860000-0000-4000-8000-000000000002'
 from unnest(array['e1860000-0000-4000-8000-000000000001','e1860000-0000-4000-8000-000000000003','e1860000-0000-4000-8000-000000000005'])x;
update public.profiles set locale='en',display_name='Synthetic Alert Member'where id in('e1860000-0000-4000-8000-000000000001','e1860000-0000-4000-8000-000000000003','e1860000-0000-4000-8000-000000000005');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'synthetic-zua',3600,600,60,40,false,true,true);
insert into public.zoe_consents(member_id,kind,granted,wording_version)select x::uuid,'zoe_reads_messages',true,'zoe-consent-draft-1'
 from unnest(array['e1860000-0000-4000-8000-000000000001','e1860000-0000-4000-8000-000000000003','e1860000-0000-4000-8000-000000000005'])x;
update public.system_message_templates set approved=true where template_id in('zoe.answer','zoe.urgent');
insert into public.zoe_settings(consent_collection_enabled,consent_wording_version)values(true,'zoe-consent-draft-1');
insert into public.care_alert_settings(enabled)values(true);

create function pg_temp.status(m text,sid text,rid text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(m,sid);set local role authenticated;j:=public.care_alert_member_status(rid::uuid);reset role;return j;end$$;
create function pg_temp.zoe(m text,sid text,rid text)returns jsonb language sql as $$select pg_temp.status(m,sid,rid)->'zoe'$$;
create function pg_temp.msg(rid text)returns public.conversation_messages language sql as $$select * from public.conversation_messages where request_id=rid::uuid$$;
create function pg_temp.run(rid text)returns uuid language sql as $$
 select zr.id from public.zoe_runs zr join public.conversation_messages cm on cm.conversation_id=zr.conversation_id and cm.seq=zr.message_seq where cm.request_id=rid::uuid$$;
-- The sweep's message screening: 'escalate' raises through the same path as care_alert_screen, 'recorded' does not.
create function pg_temp.screen(rid text,outcome text)returns void language plpgsql as $$declare j jsonb;mid text:=(pg_temp.msg(rid)).id::text;who uuid:=(pg_temp.msg(rid)).author_id;begin
 perform pg_temp.as_service();set local role service_role;
 j:=public.care_alert_screen(who,'message',mid,outcome,case outcome when 'escalate'then 'urgent_words_matched'else 'no_listed_urgent_words'end,case outcome when 'escalate'then '{RF-01}'else '{}'end::text[],'care_alert.urgent_lexicon','check');
 reset role;
 if(j->>'ok')::boolean is not true then raise exception 'FAIL: screen %',j;end if;end$$;
create function pg_temp.claimed(m text)returns uuid language sql as $$select pg_temp.run_for(m::uuid)$$;
create function pg_temp.no_output()returns jsonb language sql as $$select jsonb_build_object('outcome','no_output','reason','worker_failed','guardReasons','[]'::jsonb,'redactionCount',0,
 'usage',jsonb_build_object('inputTokens',0,'outputTokens',0),'costUsd',0,'latencyMs',5,'provider','none','model','none','configVersion','zoe-urgent-status-check','tier','none','tierReason','check','fallbackUsed',false,'events','[]'::jsonb)$$;

\set a 'e1860000-0000-4000-8000-000000000001'
\set as 'e1860000-0000-4000-8000-000000000011'
\set b 'e1860000-0000-4000-8000-000000000003'
\set bs 'e1860000-0000-4000-8000-000000000013'
\set c 'e1860000-0000-4000-8000-000000000005'
\set cs 'e1860000-0000-4000-8000-000000000015'
\set a1 'e1860000-0000-4000-8000-0000000000a1'
\set a2 'e1860000-0000-4000-8000-0000000000a2'
\set a3 'e1860000-0000-4000-8000-0000000000a3'
\set a4 'e1860000-0000-4000-8000-0000000000a4'
\set b1 'e1860000-0000-4000-8000-0000000000b1'
\set b2 'e1860000-0000-4000-8000-0000000000b2'
\set b3 'e1860000-0000-4000-8000-0000000000b3'
\set c1 'e1860000-0000-4000-8000-0000000000c1'
\set c2 'e1860000-0000-4000-8000-0000000000c2'

-- 0. No request named: zoe is null and the screen claims nothing; the questionnaire's call is unchanged.
select pg_temp.as_user(:'a',:'as');set local role authenticated;
select pg_temp.ok(public.care_alert_member_status()->'zoe'='null'::jsonb and public.care_alert_member_status()@>'{"ok":true,"alerted":false}','No request: no Zoe answer, the rest unchanged');
reset role;

-- 1. The real order for urgent words: stored, the screen opens, then the message is screened, then the sweep runs Zoe.
select pg_temp.send(:'a',:'as',:'a1','Synthetic urgent words one');
select pg_temp.ok(pg_temp.zoe(:'a',:'as',:'a1')='{"alerted":false,"pending":true}','Stored, unscreened: pending, so the screen claims nothing');
select pg_temp.screen(:'a1','recorded');
select pg_temp.ok(pg_temp.zoe(:'a',:'as',:'a1')='{"alerted":false,"pending":true}','Screened with no match, no run yet: still pending, Zoe has not run');
select pg_temp.ok(pg_temp.claimed(:'a') is not null,'The run is claimed');
select pg_temp.ok(pg_temp.zoe(:'a',:'as',:'a1')='{"alerted":false,"pending":true}','Run started: still pending');
select pg_temp.ok((pg_temp.finish(pg_temp.run(:'a1'),pg_temp.urgent('urgent_route_no_model_call','RF-01'))->>'outcome')='discarded','Urgent finish');
select pg_temp.ok(pg_temp.zoe(:'a',:'as',:'a1')='{"alerted":true,"pending":false}','Zoe alert for this message: alerted');
select pg_temp.ok((pg_temp.status(:'a',:'as',:'a1')@>'{"ok":true,"alertsEnabled":true,"alerted":false}')and(pg_temp.status(:'a',:'as',:'a1')->>'alertedAt')is null,'The questionnaire keys do not read a Zoe alert');

-- 2. A resolved alert was still told, for that message.
update public.care_alerts set state='resolved',acknowledged_at=now(),acknowledged_by='e1860000-0000-4000-8000-000000000002',resolved_at=now(),resolved_by='e1860000-0000-4000-8000-000000000002',resolution='other'
 where member_id=:'a'::uuid and source='zoe';
select pg_temp.ok(pg_temp.zoe(:'a',:'as',:'a1')='{"alerted":true,"pending":false}','A resolved alert still means the team was told');

-- 3. ZUT-01: a message that is not stored, delayed or failed, is pending however the earlier message ended. The older alert never stands in.
select pg_temp.ok(pg_temp.zoe(:'a',:'as',:'a2')='{"alerted":false,"pending":true}','Previous message alerted, this one not stored: pending, not told');

-- 4. Another message's alert does not count: an ordinary next message settles as not told, and the first stays told.
select pg_temp.send(:'a',:'as',:'a2','Synthetic ordinary message two');
select pg_temp.ok(pg_temp.zoe(:'a',:'as',:'a2')='{"alerted":false,"pending":true}','Next message: the earlier alert does not carry over');
select pg_temp.screen(:'a2','recorded');
select pg_temp.ok(pg_temp.claimed(:'a') is not null,'Second run claimed');
select pg_temp.finish(pg_temp.run(:'a2'),pg_temp.no_output());
select pg_temp.ok(pg_temp.zoe(:'a',:'as',:'a2')='{"alerted":false,"pending":false}','Settled with no alert: not told, and the screen may say so');
select pg_temp.ok(pg_temp.zoe(:'a',:'as',:'a1')='{"alerted":true,"pending":false}','The first message stays told after a later one');
select pg_temp.ok(pg_temp.zoe(:'a',:'as',:'a3')='{"alerted":false,"pending":true}','Previous message settled, this one not stored: pending, no premature "not told"');

-- 5. A later alert does not make an earlier settled message told.
select pg_temp.send(:'a',:'as',:'a3','Synthetic urgent words after');
select pg_temp.screen(:'a3','escalate');
select pg_temp.ok(pg_temp.zoe(:'a',:'as',:'a3')='{"alerted":true,"pending":false}','Message alert: alerted before any run');
select pg_temp.ok(pg_temp.zoe(:'a',:'as',:'a2')='{"alerted":false,"pending":false}','The earlier settled message is not told by a later alert');

-- 5b. ZUT-01, what the redirect relies on: an identical replay is accepted, the same id with other text is refused. Only an accepted
-- store passes the id to the screen (check-zoe-member-screen.ts runs that action; zoe-urgent.spec.ts runs it in a browser).
select pg_temp.ok((pg_temp.send(:'a',:'as',:'a1','Synthetic urgent words one')->>'ok')::boolean,'Identical replay of an alerted message: accepted');
select pg_temp.ok(pg_temp.send(:'a',:'as',:'a1','Different urgent words')@>'{"ok":false,"code":"request_conflict"}','The same id with other text: refused');
select pg_temp.ok(not exists(select 1 from public.conversation_messages where body='Different urgent words'),'The refused text is not stored under that id');

-- 6. Someone else's request id tells this member nothing, and is never answered as settled.
select pg_temp.ok(pg_temp.zoe(:'b',:'bs',:'a3')='{"alerted":false,"pending":true}','Another member''s request: nothing of theirs is read');

-- 7. An intake red flag's alert (source_ref intake:<run>).
select pg_temp.send(:'c',:'cs',:'c1','Synthetic symptom red flag');
select pg_temp.screen(:'c1','recorded');
select pg_temp.ok(pg_temp.claimed(:'c') is not null,'Intake run claimed');
update public.zoe_runs set state='finished',outcome='intake_escalated',finished_at=now() where id=pg_temp.run(:'c1');
select pg_temp.ok(pg_temp.zoe(:'c',:'cs',:'c1')='{"alerted":false,"pending":true}','Intake escalated, alert not raised yet: pending, not "not told"');
select public._care_alert_screen(:'c'::uuid,'zoe','intake:'||pg_temp.run(:'c1')::text,'escalate','symptom_red_flag','{RF-01}','zoe.symptom_red_flags','check');
select pg_temp.ok(pg_temp.zoe(:'c',:'cs',:'c1')='{"alerted":true,"pending":false}','Intake alert: alerted');

-- 8. ZUT-02: a failed raise stays pending however old, and the sweep's retry then makes it told.
create function public._zus_test_fail()returns trigger language plpgsql as $$begin
 if current_setting('noreon.zus_fail',true)='on'then raise exception 'synthetic alert failure';end if;return new;end$$;
create trigger zus_test_fail before insert on public.care_alert_screenings for each row when(new.source='zoe')execute function public._zus_test_fail();
select set_config('noreon.zus_fail','on',true);
select pg_temp.send(:'b',:'bs',:'b1','Synthetic urgent words four');
select pg_temp.screen(:'b1','recorded');
select pg_temp.ok(pg_temp.claimed(:'b') is not null,'Run claimed for the failed raise');
select pg_temp.finish(pg_temp.run(:'b1'),pg_temp.urgent('urgent_route_no_model_call','RF-02'));
select pg_temp.ok(pg_temp.zoe(:'b',:'bs',:'b1')='{"alerted":false,"pending":true}','Failed raise: pending until the retry');
alter table public.conversation_messages disable trigger user;
update public.conversation_messages set created_at=now()-interval '3 hours' where id=(pg_temp.msg(:'b1')).id;
alter table public.conversation_messages enable trigger user;
select pg_temp.ok(pg_temp.zoe(:'b',:'bs',:'b1')='{"alerted":false,"pending":true}','Failed raise, hours old: still pending, never "not told"');
select set_config('noreon.zus_fail','off',true);
select pg_temp.as_service();set local role service_role;select public.care_alert_zoe_urgent_retry(20);reset role;
select pg_temp.ok(pg_temp.zoe(:'b',:'bs',:'b1')='{"alerted":true,"pending":false}','The retry raised it: alerted');

-- 8b. ZUT-02: switching alerts off does not settle a failed raise. It stays pending, and the retry resumes when they are back on.
select set_config('noreon.zus_fail','on',true);
select pg_temp.send(:'b',:'bs',:'b3','Synthetic urgent words five');
select pg_temp.screen(:'b3','recorded');
select pg_temp.ok(pg_temp.claimed(:'b') is not null,'Run claimed for the second failed raise');
select pg_temp.finish(pg_temp.run(:'b3'),pg_temp.urgent('urgent_route_no_model_call','RF-02'));
select pg_temp.ok(pg_temp.zoe(:'b',:'bs',:'b3')='{"alerted":false,"pending":true}','Failed raise: pending');
update public.care_alert_settings set enabled=false;
select pg_temp.ok(pg_temp.zoe(:'b',:'bs',:'b3')='{"alerted":false,"pending":true}','Failed raise, alerts off: still pending, never "not told"');
select set_config('noreon.zus_fail','off',true);
update public.care_alert_settings set enabled=true;
select pg_temp.as_service();set local role service_role;select public.care_alert_zoe_urgent_retry(20);reset role;
select pg_temp.ok(pg_temp.zoe(:'b',:'bs',:'b3')='{"alerted":true,"pending":false}','Alerts back on, retried: alerted');

-- 9. ZUT-02: unscreened or unclaimed work stays pending however old.
select pg_temp.send(:'b',:'bs',:'b2','Synthetic message left unscreened');
alter table public.conversation_messages disable trigger user;
update public.conversation_messages set created_at=now()-interval '3 hours' where id=(pg_temp.msg(:'b2')).id;
alter table public.conversation_messages enable trigger user;
select pg_temp.ok(pg_temp.zoe(:'b',:'bs',:'b2')='{"alerted":false,"pending":true}','Unscreened, hours old: still pending');
select pg_temp.screen(:'b2','escalate');
select pg_temp.ok(pg_temp.zoe(:'b',:'bs',:'b2')='{"alerted":true,"pending":false}','Screened late, with an alert: alerted');

-- 10. Care alerts off: unscreened work resumes when they are back on, so nothing says "not told". A message already settled stays as it was.
update public.care_alert_settings set enabled=false;
select pg_temp.send(:'c',:'cs',:'c2','Synthetic urgent words with alerts off');
select pg_temp.ok(pg_temp.zoe(:'c',:'cs',:'c2')='{"alerted":false,"pending":true}','Alerts off, unscreened: pending, no claim');
select pg_temp.ok(pg_temp.zoe(:'c',:'cs',:'a4')='{"alerted":false,"pending":true}','Alerts off, not stored: pending, no claim');
select pg_temp.ok(pg_temp.zoe(:'c',:'cs',:'c1')='{"alerted":true,"pending":false}','Alerts off later: an earlier alert stays told');
select pg_temp.ok(pg_temp.zoe(:'a',:'as',:'a2')='{"alerted":false,"pending":false}','Alerts off later: a message settled with no alert stays settled');

-- 11. Signed out gets no status: the page catches this and claims nothing.
select set_config('request.jwt.claims','{"role":"anon"}',true);set local role anon;
do $$begin perform public.care_alert_member_status('e1860000-0000-4000-8000-0000000000a1'::uuid);raise exception 'FAIL: anon allowed';exception when insufficient_privilege then null;end$$;
reset role;

rollback;
