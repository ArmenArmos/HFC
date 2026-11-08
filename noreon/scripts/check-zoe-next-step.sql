-- PR 13: isolated SQL risk path. Run after a fresh local migration replay. All writes roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.id(n int)returns uuid language sql immutable as $$select ('ce130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.ok(v boolean,label text)returns void language plpgsql as $$begin if v is distinct from true then raise exception 'TEST %',label;end if;end$$;
set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)values(pg_temp.id(1),'37499001301',now()),(pg_temp.id(2),'37499001302',now());
insert into public.profiles(id,locale,display_name)values(pg_temp.id(1),'en','Synthetic one'),(pg_temp.id(2),'en','Synthetic two');
insert into public.patient_clinical_cases(user_id)values(pg_temp.id(1)),(pg_temp.id(2));
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version='pr13-fixture' where singleton;
insert into public.zoe_consents(member_id,kind,granted,wording_version,source)values(pg_temp.id(1),'zoe_reads_messages',true,'pr13-fixture','zoe_screen'),(pg_temp.id(2),'zoe_reads_messages',true,'pr13-fixture','zoe_screen');
reset session_replication_role;
-- Migrations intentionally leave the policy unseeded; create this check's synthetic configuration.
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages)
 values(true,'zoe-v3-next-step-check',600,600,600,10)on conflict(singleton)do nothing;
update public.conversation_policy set app_chat_enabled=true,zoe_chat_actions_enabled=true where singleton;
select pg_temp.ok(not has_function_privilege('authenticated','public.zoe_v3_next_step_sync(uuid,uuid,uuid,timestamptz,jsonb)','execute'),'member cannot forge a stage snapshot');
select pg_temp.ok(not has_function_privilege('anon','public.zoe_v3_next_step_follow(uuid,uuid,uuid,text,jsonb)','execute'),'anonymous cannot follow');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare first jsonb;second jsonb;replay jsonb;followed jsonb;old_id uuid;stamp text;begin
 first:=public.zoe_v3_next_step_sync(pg_temp.id(1),pg_temp.id(10),null,clock_timestamp(),'{"v":1,"stage":"anamnesis","target":"tests_needed"}');
 perform pg_temp.ok((first->>'ok')::boolean,'first stage posts: '||first::text);old_id:=(first#>>'{card,id}')::uuid;
 replay:=public.zoe_v3_next_step_sync(pg_temp.id(1),pg_temp.id(10),old_id,clock_timestamp(),'{"v":1,"stage":"anamnesis","target":"tests_needed"}');
 perform pg_temp.ok(replay->'card'=first->'card','reload replays the immutable snapshot');
 second:=public.zoe_v3_next_step_sync(pg_temp.id(1),pg_temp.id(11),old_id,clock_timestamp(),'{"v":1,"stage":"tests-chosen","target":"visit"}');
 perform pg_temp.ok((second->>'ok')::boolean,'new stage posts');
 perform pg_temp.ok((select count(*)=1 from public.zoe_chat_cards where member_id=pg_temp.id(1)and kind='next_step'and state='open'),'one unanswered card');
 perform pg_temp.ok((select state='done'and outcome?'replaced' from public.zoe_chat_cards where id=old_id),'older unanswered card replaced');
 replay:=public.zoe_v3_next_step_sync(pg_temp.id(1),pg_temp.id(12),old_id,clock_timestamp(),'{"v":1,"stage":"stale-poll","target":"tests_needed"}');
 perform pg_temp.ok(replay->>'code'='stale','overlapping stale poll cannot overwrite a newer continuation');
 followed:=public.zoe_v3_next_step_follow(pg_temp.id(1),old_id,pg_temp.id(20),'tests_needed','{"v":1,"available":true,"rows":[]}');
 perform pg_temp.ok(followed->>'code'='closed','superseded button cannot act');
 old_id:=(second#>>'{card,id}')::uuid;
 followed:=public.zoe_v3_next_step_follow(pg_temp.id(2),old_id,pg_temp.id(21),'visit','{"v":1}');
 perform pg_temp.ok(not(followed->>'ok')::boolean,'another member cannot use the card');
 followed:=public.zoe_v3_next_step_follow(pg_temp.id(1),old_id,pg_temp.id(21),'results','{"v":1}');
 perform pg_temp.ok(followed->>'code'='invalid','target is pinned by the saved step');
 begin
  perform public.zoe_v3_next_step_follow(pg_temp.id(1),old_id,pg_temp.id(21),'visit','null'::jsonb);
  raise exception 'Invalid target snapshot should fail';
 exception when serialization_failure then null;end;
 perform pg_temp.ok((select state='open'and not(outcome?'next_step')and not(claims?'next_step')from public.zoe_chat_cards where id=old_id),'failed target post rolls back the turn and its claim');
 followed:=public.zoe_v3_next_step_follow(pg_temp.id(1),old_id,pg_temp.id(21),'visit','{"v":1}');
 perform pg_temp.ok((followed->>'ok')::boolean,'matching card opens');stamp:=followed#>>'{card,outcome,next_step,doneAt}';
 perform pg_temp.ok(stamp is not null and followed#>>'{card,outcome,next_step,requestId}'=pg_temp.id(21)::text,'server action time and child identity persist');
 replay:=public.zoe_v3_next_step_follow(pg_temp.id(1),old_id,pg_temp.id(21),'visit','{}');
 perform pg_temp.ok(replay->'card'=followed->'card'and replay->'next'=followed->'next','lost response replays action and target');
 perform pg_temp.ok((select count(*)=1 from public.zoe_chat_cards where member_id=pg_temp.id(1)and request_id=pg_temp.id(21)),'target never duplicates');
end$$;
reset role;
-- The second member opens tests, then booking, but never saves a booking.
-- Both targets must survive beyond history and replay as the same stored cards.
set local role service_role;
do $$declare first jsonb;opened jsonb;booking jsonb;replay jsonb;root_id uuid;tests_id uuid;visit_id uuid;begin
 first:=public.zoe_v3_next_step_sync(pg_temp.id(2),pg_temp.id(40),null,clock_timestamp(),'{"v":1,"stage":"current-review:book","target":"tests_needed"}');
 root_id:=(first#>>'{card,id}')::uuid;
 opened:=public.zoe_v3_next_step_follow(pg_temp.id(2),root_id,pg_temp.id(41),'tests_needed','{"v":1,"available":true,"rows":[]}');
 tests_id:=(opened#>>'{next,id}')::uuid;
 -- Seed completed history directly so the hourly posting limit does not mask pagination.
 for i in 1..40 loop
  insert into public.zoe_chat_cards(member_id,request_id,kind,source,snapshot,state)
   values(pg_temp.id(2),pg_temp.id(100+i),'bp','chip','{"v":1}','done');
 end loop;
 perform pg_temp.ok((select count(*)=40 from public.zoe_chat_cards where member_id=pg_temp.id(2)and created_at>(opened#>>'{next,at}')::timestamptz),'forty later cards exclude the target from ordinary history');
 replay:=public.zoe_v3_next_step_sync(pg_temp.id(2),pg_temp.id(40),null,clock_timestamp(),'{"v":1,"stage":"current-review:book","target":"tests_needed"}');
 perform pg_temp.ok(replay#>>'{cards,0,id}'=tests_id::text and replay#>>'{cards,0,state}'='open','reload recovers unfinished tests outside history');
 replay:=public.zoe_v3_next_step_sync(pg_temp.id(2),pg_temp.id(40),null,clock_timestamp(),'{"v":1,"stage":"current-review:book","target":"tests_needed"}');
 perform pg_temp.ok(replay#>>'{cards,0,id}'=tests_id::text,'a second device recovers the same target');
 delete from public.zoe_chat_cards where member_id=pg_temp.id(2)and kind='bp';
 booking:=public.zoe_v3_next_step_follow(pg_temp.id(2),tests_id,pg_temp.id(42),'visit','{"v":1}');
 visit_id:=(booking#>>'{next,id}')::uuid;
 for i in 1..40 loop
  insert into public.zoe_chat_cards(member_id,request_id,kind,source,snapshot,state)
   values(pg_temp.id(2),pg_temp.id(100+i),'bp','chip','{"v":1}','done');
 end loop;
 perform pg_temp.ok((select count(*)=40 from public.zoe_chat_cards where member_id=pg_temp.id(2)and created_at>(booking#>>'{next,at}')::timestamptz),'booking is outside ordinary history too');
 -- Opening booking changes the presentation target, but not the saved journey stage id.
 replay:=public.zoe_v3_next_step_sync(pg_temp.id(2),pg_temp.id(40),root_id,clock_timestamp(),'{"v":1,"stage":"current-review:book","target":"visit"}');
 perform pg_temp.ok(jsonb_array_length(replay->'cards')=2 and replay#>>'{cards,1,id}'=visit_id::text and replay#>>'{cards,1,state}'='open','tests chosen without booking recovers the saved visit target');
 perform pg_temp.ok((select count(*)=1 from public.zoe_chat_cards where member_id=pg_temp.id(2)and kind='next_step'),'opening targets creates no duplicate stage');
 perform pg_temp.ok((select count(*)=1 from public.zoe_chat_cards where member_id=pg_temp.id(2)and kind='visit'),'recovery creates no duplicate booking card');
 -- An absent target cannot make a completed parent mean the work is finished.
 delete from public.zoe_chat_cards where id=visit_id;
 replay:=public.zoe_v3_next_step_sync(pg_temp.id(2),pg_temp.id(40),root_id,clock_timestamp(),'{"v":1,"stage":"current-review:book","target":"visit"}');
 perform pg_temp.ok(replay->>'code'='unavailable','a missing child fails closed instead of implying completion');
end$$;
reset role;
-- Adapter reads stage A, then another poll installs B before the follow call.
-- An unfinished tests card must recheck its root under the member lock.
delete from public.zoe_chat_cards where member_id=pg_temp.id(2)and kind='bp';
set local role service_role;
do $$declare prior_id uuid; root_a jsonb; opened jsonb; root_b jsonb; stale jsonb; tests_id uuid;begin
 select id into prior_id from public.zoe_chat_cards where member_id=pg_temp.id(2)and kind='next_step' order by created_at desc,id desc limit 1;
 root_a:=public.zoe_v3_next_step_sync(pg_temp.id(2),pg_temp.id(43),prior_id,clock_timestamp(),'{"v":1,"stage":"race-A","target":"tests_needed"}');
 perform pg_temp.ok((root_a->>'ok')::boolean,'race stage A posts');
 opened:=public.zoe_v3_next_step_follow(pg_temp.id(2),(root_a#>>'{card,id}')::uuid,pg_temp.id(44),'tests_needed','{"v":1,"available":true,"rows":[]}');
 perform pg_temp.ok((opened->>'ok')::boolean,'race tests open');tests_id:=(opened#>>'{next,id}')::uuid;
 root_b:=public.zoe_v3_next_step_sync(pg_temp.id(2),pg_temp.id(45),(root_a#>>'{card,id}')::uuid,clock_timestamp(),'{"v":1,"stage":"race-B","target":"results"}');
 perform pg_temp.ok((root_b->>'ok')::boolean,'race stage B replaces A');
 stale:=public.zoe_v3_next_step_follow(pg_temp.id(2),tests_id,pg_temp.id(46),'visit','{"v":1}');
 perform pg_temp.ok(stale->>'code'='stale','obsolete tests cannot follow after a concurrent stage change');
 perform pg_temp.ok((select state='open'and not(outcome?'tests_needed')and not(claims?'tests_needed')from public.zoe_chat_cards where id=tests_id),'stale follow writes no receipt or claim');
 perform pg_temp.ok(not exists(select 1 from public.zoe_chat_cards where member_id=pg_temp.id(2)and request_id=pg_temp.id(46)),'stale follow posts no visit');
 stale:=public.zoe_v3_next_step_follow(pg_temp.id(2),(root_a#>>'{card,id}')::uuid,pg_temp.id(44),'tests_needed','{}');
 perform pg_temp.ok((stale->>'ok')::boolean and stale#>>'{next,id}'=tests_id::text,'a recorded press still replays after stage replacement');
end$$;
reset role;
-- F-P0-1: the exact missing-baseline-labs task payload, including the stable UUID source.
set local role service_role;
do $$declare raised jsonb; replay jsonb; first jsonb; opened jsonb; recovered jsonb; root_id uuid; prior_id uuid;begin
 raised:=public.care_queue_raise(
  p_member=>pg_temp.id(1),p_queue=>'admin',p_zone=>null,p_reason=>'missing_baseline_labs',
  p_rule_version=>'zones-v1-2026-11-02',p_red_flags=>null,p_action=>'book',p_summary=>'{}',p_sla=>null,p_source_ref=>pg_temp.id(60)::text);
 perform pg_temp.ok((raised->>'ok')::boolean,'missing labs task accepts the adapter payload');
 replay:=public.care_queue_raise(
  p_member=>pg_temp.id(1),p_queue=>'admin',p_zone=>null,p_reason=>'missing_baseline_labs',
  p_rule_version=>'zones-v1-2026-11-02',p_red_flags=>null,p_action=>'book',p_summary=>'{}',p_sla=>null,p_source_ref=>pg_temp.id(60)::text);
 perform pg_temp.ok((replay->>'ok')::boolean and(replay->>'replayed')::boolean and replay#>>'{task,id}'=raised#>>'{task,id}','missing labs task replay succeeds without duplication');
 -- Queue tables are private even to service_role; inspect persisted tasks as the test owner.
 reset role;
 perform pg_temp.ok((select count(*)=1 from public.care_queue_tasks where member_id=pg_temp.id(1)and source_ref=pg_temp.id(60)::text),'one coordinator task');
 set local role service_role;
 select id into prior_id from public.zoe_chat_cards where member_id=pg_temp.id(1)and kind='next_step' order by created_at desc,id desc limit 1;
 first:=public.zoe_v3_next_step_sync(pg_temp.id(1),pg_temp.id(61),prior_id,clock_timestamp(),'{"v":1,"stage":"direct-labs","target":"tests_needed"}');
 perform pg_temp.ok((first->>'ok')::boolean,'lab step posts');root_id:=(first#>>'{card,id}')::uuid;
 begin
  perform public.zoe_v3_next_step_follow(pg_temp.id(1),root_id,pg_temp.id(62),'visit','null'::jsonb);
  raise exception 'Invalid lab-order snapshot should fail';
 exception when serialization_failure then null;end;
 perform pg_temp.ok((select state='open'and not(outcome?'next_step')and not(claims?'next_step')from public.zoe_chat_cards where id=root_id),'failed lab-order post leaves no orphan receipt');
 opened:=public.zoe_v3_next_step_follow(pg_temp.id(1),root_id,pg_temp.id(62),'visit','{"v":1,"available":true,"next":null,"proposal":null,"attention":false}');
 perform pg_temp.ok((opened->>'ok')::boolean and opened#>>'{next,kind}'='visit','tests CTA opens the menu lab-order kind directly');
 recovered:=public.zoe_v3_next_step_sync(pg_temp.id(1),pg_temp.id(61),root_id,clock_timestamp(),'{"v":1,"stage":"direct-labs","target":"tests_needed"}');
 perform pg_temp.ok(jsonb_array_length(recovered->'cards')=1 and recovered#>>'{cards,0,id}'=opened#>>'{next,id}','refresh recovers the same lab-order card');
 replay:=public.zoe_v3_next_step_follow(pg_temp.id(1),root_id,pg_temp.id(62),'visit','{}');
 perform pg_temp.ok(replay->'card'=opened->'card'and replay->'next'=opened->'next','second press replays the stored lab-order card');
 perform pg_temp.ok((select count(*)=1 from public.zoe_chat_cards where member_id=pg_temp.id(1)and request_id=pg_temp.id(62)),'one lab-order card');
end$$;
reset role;
-- No writes without the database switch, even through the service adapter.
update public.conversation_policy set zoe_chat_actions_enabled=false where singleton;
set local role service_role;
select pg_temp.ok(public.zoe_v3_next_step_sync(pg_temp.id(1),pg_temp.id(30),null,clock_timestamp(),'{"stage":"off"}')->>'code'='disabled','off posts nothing');
reset role;
rollback;
