-- Fictional, rolled-back entry-point risk path. Local clean replay only; never hosted data.
\set ON_ERROR_STOP on
begin;
create function pg_temp.id(n int)returns uuid language sql immutable as $$select ('dc500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.actor(n int)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','session_id',pg_temp.id(n+20),'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true)
$$;
create function pg_temp.fails(q text,code text)returns boolean language plpgsql as $$begin execute q;return false;exception when others then if sqlstate=code then return true;end if;raise;end$$;
insert into auth.users(id,phone,phone_confirmed_at)values(pg_temp.id(1),null,null),(pg_temp.id(2),null,null),(pg_temp.id(3),'37499098503',now()),(pg_temp.id(4),null,null),(pg_temp.id(5),null,null);
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.id(n+20),pg_temp.id(n),now()-interval '1 hour',now()from generate_series(1,5)n;
insert into public.workspace_clinics(id,name)values(pg_temp.id(10),'Fictional everyday clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.id(1),'doctor','Fictional doctor',pg_temp.id(10)),(pg_temp.id(2),'doctor','Other fictional doctor',pg_temp.id(10)),
 (pg_temp.id(4),'nurse','Fictional nurse',pg_temp.id(10)),(pg_temp.id(5),'admin','Fictional admin',null);
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.id(3),pg_temp.id(1),pg_temp.id(4));
insert into public.conversations(id,member_id,version)values(pg_temp.id(11),pg_temp.id(3),7);
insert into public.zoe_doctor_mode(conversation_id,member_id,doctor_mode,changed_by,reason)values(pg_temp.id(11),pg_temp.id(3),true,pg_temp.id(1),'doctor_reply');
-- A live baseline is necessary now that inactive hand-back is refused.
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version='zoe-consent-draft-1',staging_ai_mode=true;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33',510,0,0,pg_temp.id(5)from public.zoe_tier_config;
update public.zoe_settings set model_calls_allowed=true,conversational_replies_enabled=true,health_answers_enabled=true;
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'synthetic-everyday',3600,600,60,40,false,false,true)
 on conflict(singleton)do update set version=excluded.version,app_chat_enabled=true;
insert into public.zoe_consents(member_id,kind,granted,wording_version)
 values(pg_temp.id(3),'zoe_reads_messages',true,'zoe-consent-draft-1');
create temp table shown(j jsonb);
grant all on shown to authenticated;
create function pg_temp.hand_back(v bigint default 7)returns jsonb language sql as $$
 select public.doctor_chat_hand_back(pg_temp.id(3),v,j->>'modeRevision')from shown
$$;
grant execute on all functions in schema pg_temp to authenticated;
select pg_temp.actor(1);
set local role authenticated;
insert into shown select public.doctor_chat_conversation(pg_temp.id(3));
select pg_temp.ok((j#>>'{workspace,version}')::bigint=7 and(j#>>'{mode,doctorMode}')::boolean and length(j->>'modeRevision')=32,'atomic read includes displayed mode and conversation revision')from shown;
select pg_temp.ok(pg_temp.hand_back(8)->>'code'='stale_context','changed conversation version does not hand back');
select pg_temp.ok(public.doctor_chat_hand_back(pg_temp.id(3),7,repeat('0',32))->>'code'='stale_context','changed takeover mode does not hand back');
reset role;
select pg_temp.ok((select doctor_mode from public.zoe_doctor_mode where conversation_id=pg_temp.id(11)),'stale requests leave doctor mode on');
-- Real session and role checks run again for every retained card or retry.
select pg_temp.actor(2);
set local role authenticated;
select pg_temp.ok(pg_temp.fails('select public.doctor_chat_conversation(pg_temp.id(3))','42501'),'other doctor cannot read');
select pg_temp.ok(pg_temp.fails('select pg_temp.hand_back()','42501'),'other doctor cannot hand back');
reset role;
select pg_temp.actor(4);
set local role authenticated;
select pg_temp.ok(pg_temp.fails('select pg_temp.hand_back()','42501'),'assigned nurse cannot hand back');
reset role;
select pg_temp.actor(5);
set local role authenticated;
select pg_temp.ok(pg_temp.fails('select pg_temp.hand_back()','42501'),'admin cannot hand back');
reset role;
select pg_temp.actor(1);
-- A new takeover at the same conversation version still invalidates the displayed mode token.
savepoint newer_takeover;
update public.zoe_doctor_mode set changed_at=changed_at+interval '1 second'where conversation_id=pg_temp.id(11);
set local role authenticated;
select pg_temp.ok(pg_temp.hand_back()->>'code'='stale_context','later takeover invalidates an old card at the same message version');
reset role;
rollback to newer_takeover;
-- Consent/scope changes participate in the displayed revision as in the existing reply guard.
savepoint changed_scope;
update public.zoe_settings set doctor_takeover_scope=case doctor_takeover_scope when 'topic'then 'conversation'else 'topic'end;
set local role authenticated;
select pg_temp.ok(pg_temp.hand_back()->>'code'='stale_context','changed takeover scope invalidates the card');
reset role;
rollback to changed_scope;
-- Both inactive causes, before and after the card read. Every branch rolls back.
do $$declare cause text;read_after boolean;j jsonb;r jsonb;begin
 foreach cause in array array['disabled','withdrawn']loop
  foreach read_after in array array[false,true]loop
   begin
    set local role authenticated;
    j:=public.doctor_chat_conversation(pg_temp.id(3));
    reset role;
    if cause='disabled'then
     update public.zoe_settings set conversational_replies_enabled=false,health_answers_enabled=false;
    else insert into public.zoe_consents(member_id,kind,granted,wording_version)values(pg_temp.id(3),'zoe_reads_messages',false,'zoe-consent-draft-1');end if;
    set local role authenticated;
    if read_after then
     j:=public.doctor_chat_conversation(pg_temp.id(3));
     perform pg_temp.ok((j#>>'{mode,zoeActive}')::boolean=false,'refreshed card shows inactive Zoe');
    end if;
    r:=public.doctor_chat_hand_back(pg_temp.id(3),7,j->>'modeRevision');
    reset role;
    perform pg_temp.ok(r->>'code'='zoe_inactive'and r->>'ok'='false','inactive Zoe refused: '||cause||', read after change: '||read_after);
    perform pg_temp.ok((select doctor_mode from public.zoe_doctor_mode where conversation_id=pg_temp.id(11)),'inactive hand-back retains doctor mode');
    perform pg_temp.ok(not exists(select 1 from public.zoe_mode_notices where member_id=pg_temp.id(3)and kind='zoe_back'),'inactive hand-back queues no notice');
    perform pg_temp.ok(not exists(select 1 from public.system_messages where member_id=pg_temp.id(3)and template_id='zoe.mode'),'inactive hand-back queues no system message');
    perform pg_temp.ok(not exists(select 1 from public.conversation_audit where conversation_id=pg_temp.id(11)and kind='zoe.doctor_mode_off'),'inactive hand-back records no transition');
    raise exception using errcode='ZX001',message='Rollback inactive fixture';
   exception when sqlstate 'ZX001'then null;end;
  end loop;
 end loop;
end$$;
-- A failed required audit rolls back the transition.
create function pg_temp.fail_audit()returns trigger language plpgsql as $$begin
 if new.member_id=pg_temp.id(3)and new.surface='doctor_zoe_mode'and new.object_id='hand_back'then raise exception using errcode='XX000',message='Synthetic audit failure';end if;return new;
end$$;
create trigger everyday_audit_failure before insert on public.access_audit for each row execute function pg_temp.fail_audit();
set local role authenticated;
select pg_temp.ok(pg_temp.fails('select pg_temp.hand_back()','XX000'),'audit failure refuses handback');
reset role;
select pg_temp.ok((select doctor_mode from public.zoe_doctor_mode where conversation_id=pg_temp.id(11)),'audit failure retains doctor mode');
drop trigger everyday_audit_failure on public.access_audit;
set local role authenticated;
select pg_temp.ok(pg_temp.hand_back()->>'replayed'='false','current card hands back through existing action');
select pg_temp.ok(pg_temp.hand_back()->>'replayed'='true','same card retries safely without repeating the transition');
reset role;
select pg_temp.ok((select count(*)from public.conversation_audit where conversation_id=pg_temp.id(11)and kind='zoe.doctor_mode_off')=1,'one transition audit after retry');
select pg_temp.ok((select count(*)from public.zoe_mode_notices where member_id=pg_temp.id(3)and kind='zoe_back')=1,'active hand-back queues one notice after retry');
select pg_temp.ok(not has_function_privilege('anon','public.doctor_chat_hand_back(uuid,bigint,text)','execute')and not has_function_privilege('service_role','public.doctor_chat_hand_back(uuid,bigint,text)','execute'),'only authenticated sessions may call wrapper');
rollback;
