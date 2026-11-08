-- Fictional, rolled-back risk path. Run after a clean local migration replay. No hosted data.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(b boolean,label text)returns void language plpgsql as $$begin
 if b is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.uid(n int)returns uuid language sql immutable as $$
 select ('dd200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id)select pg_temp.uid(n)from generate_series(1,3)n;
insert into public.workspace_clinics(id,name)values(pg_temp.uid(10),'Decision check clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.uid(1),'doctor','Decision doctor',pg_temp.uid(10)),(pg_temp.uid(2),'doctor','Other doctor',pg_temp.uid(10));
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values(pg_temp.uid(3),pg_temp.uid(1));
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.uid(n+20),pg_temp.uid(n),now()-interval '1 hour',now()from generate_series(1,2)n;
create function pg_temp.as_doctor(n int)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(n),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',pg_temp.uid(n+20))::text,true)
$$;
update public.ldl_goal_settings set ldl_goal_enabled=true,ldl_response_enabled=true where singleton;
insert into public.care_alerts(id,member_id,source,reason_code,rule_id,rule_version,source_ref,doctor_id)
 values(pg_temp.uid(30),pg_temp.uid(3),'message','urgent_words_matched','check','check','decision_check',pg_temp.uid(1));
insert into public.ldl_responses(id,member_id,observation_key,observed_on,status,facts,doctor_id)
 values(pg_temp.uid(31),pg_temp.uid(3),'cr:'||pg_temp.uid(50)::text,current_date,'not_assessable','{}',pg_temp.uid(1));
-- This risk test uses SQL snapshots directly; UI facts validation has separate TS checks.
insert into public.member_medicine_asks(id,user_id,source,medicine_id,due_at,trigger,expires_at)
 values(pg_temp.uid(32),pg_temp.uid(3),'self',pg_temp.uid(51),now(),'skipped',now()+interval '1 day');
insert into public.member_medicine_concerns(id,user_id,ask_id,kind)values(pg_temp.uid(33),pg_temp.uid(3),pg_temp.uid(32),'side_effect');
create temp table shown(kind text primary key,id uuid,revision text);
grant all on table shown to authenticated;
grant execute on function pg_temp.ok(boolean,text),pg_temp.uid(int),pg_temp.as_doctor(int)to authenticated;
select pg_temp.as_doctor(1);
set local role authenticated;
insert into shown select x->>'kind',(x->>'id')::uuid,x->>'revision'from jsonb_array_elements(public.doctor_decision_items(pg_temp.uid(3))->'items')x;
select pg_temp.ok((select count(*)from shown)=3,'all three existing item types are shown');
reset role;

-- A wrong doctor is refused on every item, even with a real revision copied from the assigned doctor's card.
select pg_temp.as_doctor(2);
set local role authenticated;
select pg_temp.ok(public.doctor_decision_apply(kind,id,pg_temp.uid(3),revision,'')->>'status'='access','wrong doctor refused: '||kind)from shown;
reset role;
select pg_temp.ok(not exists(select 1 from public.access_audit where surface='doctor_decisions'and object_id like '%:saved'),'denied commands write no success audit');

-- A clinical revision that changed after rendering invalidates all shown cards.
update public.patient_clinical_cases set revision=revision+1 where user_id=pg_temp.uid(3);
select pg_temp.as_doctor(1);
set local role authenticated;
select pg_temp.ok(public.doctor_decision_apply(kind,id,pg_temp.uid(3),revision,'')->>'status'='stale','stale case refused: '||kind)from shown;
truncate shown;
insert into shown select x->>'kind',(x->>'id')::uuid,x->>'revision'from jsonb_array_elements(public.doctor_decision_items(pg_temp.uid(3))->'items')x;
reset role;

-- A repeat of an alert changes the record independently of the case revision.
update public.care_alerts set state_seq=state_seq+1,occurrences=occurrences+1 where id=pg_temp.uid(30);
select pg_temp.as_doctor(1);
set local role authenticated;
select pg_temp.ok(public.doctor_decision_apply(kind,id,pg_temp.uid(3),revision,'')->>'status'='stale','repeated alert refused')from shown where kind='alert';
update shown set revision=public.doctor_decision_item(kind,id)->>'revision'where kind='alert';
reset role;

-- Fail the final decision audit, after each domain command has already acted.
-- A refusal must roll back the domain write and any earlier domain audit too.
create function pg_temp.fail_decision_audit()returns trigger language plpgsql as $$begin
 if new.surface='doctor_decisions'and new.object_id like '%:saved'then
  raise insufficient_privilege using message='Synthetic decision audit failure';
 end if;
 return new;
end$$;
create trigger decision_audit_failure before insert on public.access_audit
 for each row execute function pg_temp.fail_decision_audit();
create temp table audit_before as select count(*)n from public.access_audit;
set local role authenticated;
select pg_temp.ok(public.doctor_decision_apply(kind,id,pg_temp.uid(3),revision,'')->>'status'='access','audit failure refuses: '||kind)from shown;
reset role;
select pg_temp.ok((select state='open'and acknowledged_at is null from public.care_alerts where id=pg_temp.uid(30)),'audit failure rolls back alert acknowledgement');
select pg_temp.ok(not exists(select 1 from public.care_alert_audit where alert_id=pg_temp.uid(30)and kind='acknowledged'),'audit failure rolls back domain alert audit');
select pg_temp.ok((select closed_at is null and closed_by is null from public.ldl_responses where id=pg_temp.uid(31)),'audit failure rolls back LDL closure');
select pg_temp.ok((select state='open'and handled_by is null from public.member_medicine_concerns where id=pg_temp.uid(33)),'audit failure rolls back medicine handling');
select pg_temp.ok((select count(*)from public.access_audit)=(select n from audit_before),'audit failure leaves no partial access audit');
drop trigger decision_audit_failure on public.access_audit;
set local role authenticated;

-- Fresh commands act once. The same stale cards refuse a second press, including a separate tab.
select pg_temp.ok(public.doctor_decision_apply(kind,id,pg_temp.uid(3),revision,'')->>'status'='saved','fresh command saved: '||kind)from shown;
select pg_temp.ok(public.doctor_decision_apply(kind,id,pg_temp.uid(3),revision,'')->>'status'='stale','second press refused: '||kind)from shown;
reset role;
select pg_temp.ok((select count(*)from public.access_audit where actor_id=pg_temp.uid(1)and member_id=pg_temp.uid(3)and surface='doctor_decisions'and object_id like '%:saved')=3,'one decision audit per action');
select pg_temp.ok((select state='acknowledged'from public.care_alerts where id=pg_temp.uid(30)),'existing alert command ran');
select pg_temp.ok((select count(*)from public.care_alert_audit where alert_id=pg_temp.uid(30)and kind='acknowledged')=1,'one domain alert audit');
select pg_temp.ok((select state='handled'and handled_by=pg_temp.uid(1)from public.member_medicine_concerns where id=pg_temp.uid(33)),'existing medicine concern command ran');
select pg_temp.ok((select closed_at is not null and closed_by=pg_temp.uid(1)from public.ldl_responses where id=pg_temp.uid(31)),'existing LDL command ran');
select pg_temp.ok(not has_function_privilege('anon','public.doctor_decision_apply(text,uuid,uuid,text,text)','EXECUTE'),'anonymous write refused');
select pg_temp.ok(not has_function_privilege('authenticated','public._doctor_decision_snapshot(text,uuid)','EXECUTE'),'raw snapshot is private');

-- Legacy commands retain authorised replay after completion, without an open-item snapshot.
-- Count actual row updates, including retries with the original alert sequence.
-- Acknowledged alerts are still live; resolve the earlier fixture before reusing its member/source.
update public.care_alerts set state='resolved',resolved_by=pg_temp.uid(1),resolved_at=now(),resolution='no_action_needed'
 where id=pg_temp.uid(30);
insert into public.care_alerts(id,member_id,source,reason_code,rule_id,rule_version,source_ref,doctor_id)
 values(pg_temp.uid(34),pg_temp.uid(3),'message','urgent_words_matched','check','check','legacy_decision_check',pg_temp.uid(1));
insert into public.ldl_responses(id,member_id,observation_key,observed_on,status,facts,doctor_id)
 values(pg_temp.uid(35),pg_temp.uid(3),'cr:'||pg_temp.uid(52)::text,current_date,'not_assessable','{}',pg_temp.uid(1));
create temp table legacy_updates(kind text);
create function pg_temp.count_legacy_update()returns trigger language plpgsql as $$begin
 if new.id in(pg_temp.uid(34),pg_temp.uid(35))then insert into pg_temp.legacy_updates values(TG_TABLE_NAME);end if;
 return new;
end$$;
create trigger legacy_alert_update after update on public.care_alerts for each row execute function pg_temp.count_legacy_update();
create trigger legacy_ldl_update after update on public.ldl_responses for each row execute function pg_temp.count_legacy_update();
select pg_temp.as_doctor(1);
set local role authenticated;
select pg_temp.ok(public.doctor_ldl_response_close(pg_temp.uid(35),'First review')->>'status'='saved','legacy LDL closes');
select pg_temp.ok(public.doctor_ldl_response_close(pg_temp.uid(35),'Retry review')->>'status'='replayed','legacy LDL retry replays');
-- The fresh alert starts at sequence 0; retry with the original page's sequence after acknowledgement advances it.
select pg_temp.ok(public.care_alert_acknowledge(pg_temp.uid(34),0)@>'{"ok":true,"changed":true}','legacy alert acknowledged');
select pg_temp.ok(public.care_alert_acknowledge(pg_temp.uid(34),0)@>'{"ok":true,"changed":false}','legacy alert retry succeeds without change');
reset role;
select pg_temp.ok((select count(*)from legacy_updates where kind='ldl_responses')=1,'legacy LDL mutates once');
select pg_temp.ok((select count(*)from legacy_updates where kind='care_alerts')=1,'legacy alert mutates once');
select pg_temp.ok((select close_note='First review'from public.ldl_responses where id=pg_temp.uid(35)),'legacy replay preserves first review');
select pg_temp.ok((select count(*)from public.care_alert_audit where alert_id=pg_temp.uid(34)and kind='acknowledged')=1,'legacy retry audits acknowledgement once');
drop trigger legacy_alert_update on public.care_alerts;
drop trigger legacy_ldl_update on public.ldl_responses;

-- Reply + takeover: the existing compose/intent/approve path, with the card mode guard.
update auth.users set phone='37499099203',phone_confirmed_at=now()where id=pg_temp.uid(3);
insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.uid(23),pg_temp.uid(3),now()-interval '1 hour',now());
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'doctor-decisions-check',3600,600,60,100,true,true,true)
 on conflict(singleton)do update set version=excluded.version,grant_seconds=3600,intent_seconds=600,app_chat_enabled=true,delivery_enabled=true;
insert into public.zoe_settings(singleton)values(true)on conflict do nothing;
-- The launch guards aren't under test here; skip them for this one fixture row.
set session_replication_role=replica;
update public.zoe_settings set staging_ai_mode=true,model_calls_allowed=true,conversational_replies_enabled=true,consent_wording_version='doctor-decisions-check',doctor_takeover_scope='conversation';
set session_replication_role=origin;
insert into public.zoe_consents(member_id,kind,granted,wording_version)values(pg_temp.uid(3),'zoe_reads_messages',true,'doctor-decisions-check');
create temp table reply_shown(k text primary key,v jsonb);
grant all on reply_shown to authenticated;
create function pg_temp.reply_command(a jsonb)returns jsonb language sql as $$
 select jsonb_build_object('schema',1,'purpose','reply.approve','requestId',replace(gen_random_uuid()::text,'-',''),
 'intentId',(select x->>'intentId'from jsonb_array_elements(a#>'{actions,view,actions}')x where x->>'purpose'='reply.approve'))
$$;
create function pg_temp.denied(q text)returns boolean language plpgsql as $$begin execute q;return false;exception when insufficient_privilege then return true;end$$;
grant execute on function pg_temp.reply_command(jsonb),pg_temp.denied(text)to authenticated;
select pg_temp.as_doctor(3);
set local role authenticated;
select pg_temp.ok(public.conversation_receive(jsonb_build_object('requestId',gen_random_uuid(),'text','Fictional question for my doctor'))->>'ok'='true','member message retained');
reset role;
select pg_temp.as_doctor(1);
set local role authenticated;
insert into reply_shown values('workspace',public.conversation_workspace(pg_temp.uid(3)));
select pg_temp.ok(public.conversation_compose(pg_temp.uid(3),gen_random_uuid(),(v->>'version')::bigint,(v->>'clinicalRevision')::bigint,
 (v->>'draftEpoch')::bigint,v->>'sourceToken','Exact fictional doctor reply.','Private fictional summary.')->>'ok'='true','draft prepared without sending')from reply_shown where k='workspace';
insert into reply_shown values('card',public.doctor_decision_reply(pg_temp.uid(3)));
insert into reply_shown select 'command',pg_temp.reply_command(v)from reply_shown where k='card';
reset role;
select pg_temp.ok(not exists(select 1 from public.conversation_approvals a join public.conversation_drafts d on d.id=a.draft_id join public.conversations c on c.id=d.conversation_id where c.member_id=pg_temp.uid(3)),'no approval before card press');
select pg_temp.as_doctor(2);
set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.doctor_decision_reply_apply(pg_temp.uid(3),(select v->>'modeRevision'from reply_shown where k='card'),(select v from reply_shown where k='command'))$q$),'wrong doctor cannot press reply card');
reset role;
update public.zoe_settings set doctor_takeover_scope='topic';
select pg_temp.as_doctor(1);
set local role authenticated;
select pg_temp.ok(public.doctor_decision_reply_apply(pg_temp.uid(3),(select v->>'modeRevision'from reply_shown where k='card'),(select v from reply_shown where k='command'))->>'code'='stale_context','changed takeover state refused');
update reply_shown set v=public.doctor_decision_reply(pg_temp.uid(3))where k='card';
update reply_shown set v=pg_temp.reply_command((select v from reply_shown where k='card'))where k='command';
select pg_temp.ok(public.doctor_decision_reply_apply(pg_temp.uid(3),(select v->>'modeRevision'from reply_shown where k='card'),(select v from reply_shown where k='command'))->>'ok'='true','reply card approved through existing command');
-- The second call can replay or refuse, but must never insert another approval.
select public.doctor_decision_reply_apply(pg_temp.uid(3),(select v->>'modeRevision'from reply_shown where k='card'),(select v from reply_shown where k='command'));
reset role;
select pg_temp.ok((select count(*)from public.conversation_approvals a join public.conversation_drafts d on d.id=a.draft_id join public.conversations c on c.id=d.conversation_id where c.member_id=pg_temp.uid(3))=1,'double reply press approves once');
select pg_temp.ok((select doctor_mode from public.zoe_doctor_mode where member_id=pg_temp.uid(3)),'existing reply trigger takes over Zoe');
select pg_temp.ok((select count(*)from public.conversation_audit a join public.conversations c on c.id=a.conversation_id where c.member_id=pg_temp.uid(3)and a.kind='zoe.doctor_mode_on')=1,'takeover audit written once');
rollback;
