-- Isolated replay only. All fixtures are synthetic and every write rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.recovery_id(n int)returns uuid language sql immutable as $$select('bc180000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.recovery_ok(v boolean,label text)returns void language plpgsql as $$begin if v is distinct from true then raise exception 'TEST %',label;end if;end$$;
set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)values(pg_temp.recovery_id(1),'37499001801',now());
insert into public.profiles(id,locale,display_name)values(pg_temp.recovery_id(1),'en','Synthetic recovery');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages)
 values(true,'recovery-check',600,600,600,10)on conflict(singleton)do nothing;
update public.conversation_policy set app_chat_enabled=true,zoe_chat_actions_enabled=true where singleton;
update public.member_medicine_settings set enabled=true where singleton;
insert into public.zoe_chat_cards(id,member_id,request_id,kind,source,snapshot)values
 (pg_temp.recovery_id(2),pg_temp.recovery_id(1),pg_temp.recovery_id(12),'medicines','chip','{"v":1}'),
 (pg_temp.recovery_id(3),pg_temp.recovery_id(1),pg_temp.recovery_id(13),'profile','chip','{"v":1}'),
 (pg_temp.recovery_id(4),pg_temp.recovery_id(1),pg_temp.recovery_id(14),'bp','chip','{"v":1}'),
 (pg_temp.recovery_id(5),pg_temp.recovery_id(1),pg_temp.recovery_id(15),'profile','chip','{"v":1}');
reset session_replication_role;

-- Take the same form claims that precede the actual member writes.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select pg_temp.recovery_ok(public.zoe_chat_card_claim(pg_temp.recovery_id(1),pg_temp.recovery_id(2),'medicines',pg_temp.recovery_id(20),'{"kind":"review"}')->>'ok'='true','medicine claim');
select pg_temp.recovery_ok(public.zoe_chat_card_claim(pg_temp.recovery_id(1),pg_temp.recovery_id(3),'profile',pg_temp.recovery_id(30),'{"channel":"text"}')->>'ok'='true','profile claim');
select pg_temp.recovery_ok(public.zoe_chat_card_claim(pg_temp.recovery_id(1),pg_temp.recovery_id(3),'other',pg_temp.recovery_id(32),'{}')->>'ok'='true','another claim must survive form release');
reset role;

-- Both writes are definitely refused by the real functions, not a simulated error.
select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.recovery_id(1))::text,true);
set local role authenticated;
select pg_temp.recovery_ok(public.member_medicines_review('[{"id":"bc180000-0000-4000-8000-000000000099","status":"invalid","stopReason":null}]','[]')->>'status'='invalid','medicine write refused');
do $$begin
 begin
  perform public.member_profile_card_save('invalid',null);
  raise exception 'TEST profile write was accepted';
 exception when check_violation then null;end;
end$$;
reset role;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$declare cid uuid;item text;first_op uuid;next_op uuid;r jsonb;before_card public.zoe_chat_cards;begin
 for n in 2..3 loop
  cid:=pg_temp.recovery_id(n);item:=case n when 2 then 'medicines'else 'profile'end;
  first_op:=pg_temp.recovery_id(n*10);next_op:=pg_temp.recovery_id(n*10+1);
  select * into strict before_card from public.zoe_chat_cards where id=cid;
  perform pg_temp.recovery_ok(public.zoe_chat_card_unclaim(pg_temp.recovery_id(1),cid,item,next_op)->>'ok'='false','another operation cannot unclaim');
  -- Fails with 23514 under the pre-fix immutability trigger, even though the card is open.
  perform pg_temp.recovery_ok(public.zoe_chat_card_unclaim(pg_temp.recovery_id(1),cid,item,first_op)->>'ok'='true',item||' refused claim released');
  perform pg_temp.recovery_ok((select claims=before_card.claims-item and outcome=before_card.outcome and state='open'and snapshot=before_card.snapshot from public.zoe_chat_cards where id=cid),item||' release changes only the unfinished claim');
  r:=public.zoe_chat_card_claim(pg_temp.recovery_id(1),cid,item,next_op,'{"corrected":true}');
  perform pg_temp.recovery_ok(r->>'ok'='true'and r#>>'{claim,op}'=next_op::text and r#>'{claim,payload}'='{"corrected":true}'::jsonb,item||' can be pressed again with corrected input');
  -- Even on an open card, an existing outcome protects its claim.
  r:=public.zoe_chat_card_record(pg_temp.recovery_id(1),cid,item,'{"saved":true}',false);
  perform pg_temp.recovery_ok(r->>'ok'='true'and r#>>'{card,state}'='open',item||' records an open-card outcome');
  select * into strict before_card from public.zoe_chat_cards where id=cid;
  perform pg_temp.recovery_ok(public.zoe_chat_card_unclaim(pg_temp.recovery_id(1),cid,item,next_op)->>'ok'='false',item||' recorded claim cannot be unclaimed');
  begin
   update public.zoe_chat_cards set claims=claims-item where id=cid;
   raise exception 'TEST recorded claim removed directly';
  exception when check_violation then null;end;
  begin
   update public.zoe_chat_cards set outcome=jsonb_set(outcome,array[item,'saved'],'false')where id=cid;
   raise exception 'TEST recorded outcome rewritten';
  exception when check_violation then null;end;
  begin
   update public.zoe_chat_cards set outcome=jsonb_set(outcome,array[item,'doneAt'],to_jsonb('2000-01-01T00:00:00Z'::text))where id=cid;
   raise exception 'TEST receipt timestamp rewritten';
  exception when check_violation then null;end;
  perform pg_temp.recovery_ok((select claims=before_card.claims and outcome=before_card.outcome from public.zoe_chat_cards where id=cid),item||' decisions and receipts remain unchanged');
  update public.zoe_chat_cards set state='done'where id=cid;
  begin
   update public.zoe_chat_cards set state='open'where id=cid;
   raise exception 'TEST done card reopened';
  exception when check_violation then null;end;
  perform pg_temp.recovery_ok(public.zoe_chat_card_unclaim(pg_temp.recovery_id(1),cid,item,next_op)->>'ok'='false',item||' done decision cannot be unclaimed');
 end loop;
 -- Other card kinds and unfinished sends retain their immutable claims.
 perform pg_temp.recovery_ok(public.zoe_chat_card_claim(pg_temp.recovery_id(1),pg_temp.recovery_id(4),'bp',pg_temp.recovery_id(40),'{}')->>'ok'='true','BP claim');
 begin
  update public.zoe_chat_cards set claims='{}'where id=pg_temp.recovery_id(4);
  raise exception 'TEST BP claim removed';
 exception when check_violation then null;end;
 perform pg_temp.recovery_ok(public.zoe_chat_card_claim(pg_temp.recovery_id(1),pg_temp.recovery_id(5),'profile',pg_temp.recovery_id(50),'{}')->>'ok'='true','unfinished profile claim');
 perform pg_temp.recovery_ok(public.zoe_chat_card_claim(pg_temp.recovery_id(1),pg_temp.recovery_id(5),'sent:synthetic',pg_temp.recovery_id(51),'{}')->>'ok'='true','unfinished send claim');
 begin
  perform public.zoe_chat_card_unclaim(pg_temp.recovery_id(1),pg_temp.recovery_id(5),'sent:synthetic',pg_temp.recovery_id(51));
  raise exception 'TEST unfinished send unclaimed';
 exception when check_violation then null;end;
 update public.zoe_chat_cards set state='done'where id=pg_temp.recovery_id(5);
 begin
  perform public.zoe_chat_card_unclaim(pg_temp.recovery_id(1),pg_temp.recovery_id(5),'profile',pg_temp.recovery_id(50));
  raise exception 'TEST unfinished claim removed from done card';
 exception when check_violation then null;end;
 perform pg_temp.recovery_ok((select claims?'profile'and claims?'sent:synthetic'and state='done'from public.zoe_chat_cards where id=pg_temp.recovery_id(5)),'done card retains unfinished claims too');
end$$;
reset role;

-- The new trace entry point writes the existing journal with fixed codes and ids only.
select pg_temp.recovery_ok(not has_function_privilege('anon','public.zoe_chat_action_trace(uuid,text,text,text,text,text,jsonb)','execute')
 and not has_function_privilege('authenticated','public.zoe_chat_action_trace(uuid,text,text,text,text,text,jsonb)','execute')
 and has_function_privilege('service_role','public.zoe_chat_action_trace(uuid,text,text,text,text,text,jsonb)','execute'),'trace is service-only');
set local role service_role;
do $$declare attrs jsonb;phase text;begin
 attrs:=jsonb_build_object('noreon.card_id',pg_temp.recovery_id(2),'noreon.operation_id',pg_temp.recovery_id(20));
 foreach phase in array array['read','claim','task','message','record']loop
  perform pg_temp.recovery_ok(public.zoe_chat_action_trace(pg_temp.recovery_id(1),'zoe.visit_request','block',phase||'_unavailable','zoe.visit_request','visit-request-2026-11-04',attrs||jsonb_build_object('step',phase))->>'ok'='true','trace records '||phase);
 end loop;
 perform pg_temp.recovery_ok(public.zoe_chat_action_trace(pg_temp.recovery_id(1),'zoe.visit_request','block','record_unavailable','zoe.visit_request','visit-request-2026-11-04',attrs||'{"step":"record","note":"Synthetic member text"}')->>'ok'='false','trace rejects member-text attributes');
 perform pg_temp.recovery_ok(public.zoe_chat_action_trace(pg_temp.recovery_id(1),'zoe.visit_request','block','record_unavailable','zoe.visit_request','visit-request-2026-11-04',attrs||'{"step":"Synthetic member text"}')->>'ok'='false','trace rejects free-text steps');
 perform pg_temp.recovery_ok(public.zoe_chat_action_trace(pg_temp.recovery_id(1),'zoe.visit_request','block','record_unavailable','zoe.visit_request','visit-request-2026-11-04','{}')->>'ok'='false','trace rejects missing ids and step');
end$$;
reset role;
-- The journal deliberately has no service-role SELECT grant; inspect as the replay owner.
do $$declare attrs jsonb;phase text;begin
 attrs:=jsonb_build_object('noreon.card_id',pg_temp.recovery_id(2),'noreon.operation_id',pg_temp.recovery_id(20));
 foreach phase in array array['read','claim','task','message','record']loop
  perform pg_temp.recovery_ok(exists(select 1 from public.conversation_trace_events where member_id=pg_temp.recovery_id(1)and name='zoe.visit_request'and outcome='block'and reason_code=phase||'_unavailable'and rule_id='zoe.visit_request'and rule_version='visit-request-2026-11-04'and actor_kind='system'and attributes=attrs||jsonb_build_object('step',phase)),'journal retains fixed trace fields');
 end loop;
 perform pg_temp.recovery_ok((select count(*)=5 from public.conversation_trace_events where member_id=pg_temp.recovery_id(1)and name='zoe.visit_request'),'only valid traces leave journal entries');
end$$;
rollback;
