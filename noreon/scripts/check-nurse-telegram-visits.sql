-- Isolated, rolled-back PR3 visit transport risk paths. No provider or hosted database.
-- Source authored only: run after replaying migrations to obtain runtime evidence.
-- Plans below are synthetic server decisions; business effects execute only through
-- receive / visit_prepare / apply / visit_render, never by copying visit SQL bodies.
\set ON_ERROR_STOP on
begin;
create function pg_temp.tv_ok(ok boolean,label text)returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Nurse Telegram test: %',label;end if;
end$$;
-- A refusal at receive is closed as handled with a notice queued for the nurse; at apply it is status refused.
create function pg_temp.tv_refused(r jsonb,i uuid)returns boolean language sql as $$select r->>'status'='refused'or(r->>'status'='done'and(r->>'handled')::boolean and exists(select 1 from public.telegram_nurse_outbox o where o.source_inbox=i and o.turn->>'kind' in('visit-refused','refused')))$$;
create temp table tv_fixture as select gen_random_uuid()nurse,gen_random_uuid()doctor,gen_random_uuid()other,
 gen_random_uuid()member,gen_random_uuid()clinic,gen_random_uuid()binding,gen_random_uuid()task,
 gen_random_uuid()future,gen_random_uuid()referral;
create temp sequence tv_sequence start 65001;
insert into auth.users(id,email)select u,u||'@example.invalid'from tv_fixture cross join lateral unnest(array[nurse,doctor,other,member])u;
update auth.users set phone='999000775001',phone_confirmed_at=now()where id=(select member from tv_fixture);
update public.profiles set display_name='Synthetic member',birth_date='1980-01-01',biological_sex='female',locale='en'where id=(select member from tv_fixture);
update public.profiles set locale='en'where id=(select nurse from tv_fixture);
insert into public.patient_consents(user_id,version)select member,'patient-pilot-v1'from tv_fixture;
insert into public.patient_assessments(user_id,revision,completed_at)select member,1,now()from tv_fixture;
insert into public.workspace_clinics(id,name)select clinic,'Synthetic task clinic'from tv_fixture;
insert into public.workspace_staff(user_id,role,display_name,clinic_id)
 select nurse,'nurse','Synthetic nurse',clinic from tv_fixture union all select doctor,'doctor','Synthetic doctor',clinic from tv_fixture union all select other,'nurse','Synthetic other nurse',clinic from tv_fixture;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)select member,doctor,nurse from tv_fixture;
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('nurse_visits_test',9912,600,'synthetic')on conflict(singleton)do update set account=excluded.account,bot_id=excluded.bot_id;
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)
 values(true,'synthetic-nurse-tasks',3600,600,60,100,false,true)on conflict(singleton)do update set delivery_enabled=true;
delete from public.staff_telegram_policy;
insert into public.telegram_auth_bindings(id,auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
 select binding,nurse,'staff','["telegram","nurse_visits_test",9912,"user",775001]','["nurse_visits_test",9912]','+999000775002','775001',1 from tv_fixture;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);

create function pg_temp.tv_event(kind text,payload jsonb)returns uuid language plpgsql as $$
declare n bigint:=nextval('tv_sequence');e jsonb;r jsonb;id_ uuid;
begin
 e:=jsonb_build_object('adapter','telegram','eventId','nt:'||n,'fingerprint','nt-fp:'||n,'principalRef','["telegram","nurse_visits_test",9912,"user",775001]',
  'kind',kind,'payload',jsonb_build_object('chatId',775001,'messageId',n)||payload);
 r:=public.channel_inbox_commit(e);perform pg_temp.tv_ok(r->>'status'='committed','commit admitted fixture');
 select id into id_ from public.channel_inbox where event_id='nt:'||n;
 update public.channel_inbox set status='processing',attempts=1,lease_until=clock_timestamp()+interval '60 seconds'where id=id_;
 return id_;
end$$;

insert into public.patient_test_requests(id,user_id,status,requested_terms,requirements,algorithm_version,context_token,create_payload,current_arrangement)
 select id,member,'confirmed','{}','[{"id":"lipid-panel","title":"Lipid panel","method":"lab"}]',
 'synthetic','synthetic','{}',jsonb_build_object('terms',jsonb_build_object('mode','home','startsAt',stamp,'endsAt',stamp+interval '1 hour','timezone','Asia/Yerevan','location','Synthetic street'))
 from tv_fixture cross join lateral(values(task,clock_timestamp()-interval '2 days'),(future,clock_timestamp()+interval '2 days'))v(id,stamp);
update public.telegram_nurse_settings set enabled=true;
update public.nurse_visit_settings set enabled=true;

create function pg_temp.tv_send(stop_kind text default null,stop_result text default 'accepted')returns jsonb language plpgsql as $$
declare ids jsonb;i uuid;claimed jsonb;envelope jsonb;n integer:=0;result jsonb;
begin
 loop
  ids:=public.telegram_nurse_outbox_queue(true,1)->'ids';exit when jsonb_array_length(ids)=0;
  i:=(ids->>0)::uuid;claimed:=public.telegram_nurse_outbox_claim(i,true);exit when claimed->>'ok'<>'true';
  envelope:=claimed->'envelope';n:=n+1;perform pg_temp.tv_ok(n<100,'outbox terminates');
  result:=jsonb_build_object('kind',case when envelope#>>'{turn,kind}'=stop_kind then stop_result else 'accepted'end);
  if result->>'kind'='accepted'then result:=result||jsonb_build_object('providerRef',nextval('tv_sequence')::text);end if;
  perform public.telegram_nurse_outbox_outcome(i,(envelope->>'attemptId')::uuid,true,result);
  if envelope#>>'{turn,kind}'=stop_kind then return envelope;end if;
 end loop;return envelope;
end$$;

create function pg_temp.tv_clean_transport()returns void language plpgsql as $$begin
 update public.telegram_nurse_outbox set abandoned=true where binding_id=(select binding from tv_fixture)and state in('sending','unknown');
 update public.telegram_nurse_outbox set state='suppressed'where binding_id=(select binding from tv_fixture)and state='queued';
 update public.telegram_nurse_dialogs set question_version=question_version+1,question_key='idle',expected_mode='none',pending_inbox=null,prompt_message_id=null
 where binding_id=(select binding from tv_fixture);
end$$;
create function pg_temp.tv_scrubbed(ids uuid[],needle text)returns void language plpgsql as $$begin
 perform pg_temp.tv_ok(not exists(select 1 from public.channel_inbox where id=any(ids)
  and (payload::text like '%'||needle||'%'or coalesce(nurse_context::text,'')like '%'||needle||'%')),'retired transport has no plaintext in any copy');
 perform pg_temp.tv_ok(not exists(select 1 from public.telegram_nurse_dialogs where binding_id=(select binding from tv_fixture)
  and to_jsonb(telegram_nurse_dialogs)::text like '%'||needle||'%'),'dialog releases plaintext');
 perform pg_temp.tv_ok(not exists(select 1 from public.telegram_nurse_outbox where source_inbox=any(ids)
  and turn::text like '%'||needle||'%'),'output does not echo a comment or reading');
end$$;

-- The temporary planner supplies explicit, valid server plans. It does not
-- implement nextQuestion, authorization, completion or clinical cut points.
create function pg_temp.tv_render(id_ uuid,w jsonb,key_ text,choices_ jsonb)returns jsonb language plpgsql as $$begin
 return public.telegram_nurse_visit_render(id_,true,1,jsonb_build_object('token',w->>'token','questionKey',key_,'choices',choices_));
end$$;
create function pg_temp.tv_open(visit_ uuid,key_ text default 'step:confirmed',view_ text default 'question')returns jsonb language plpgsql as $$
declare id_ uuid;r jsonb;w jsonb;o public.telegram_nurse_outbox;item jsonb;flow_ jsonb;arr_ jsonb;
begin
 perform pg_temp.tv_clean_transport();
 -- A retained Today control can be opened after the booking is rescheduled.
 -- Emit that control while the fixture is today, then restore its actual date
 -- before selecting it. The selection must fetch fresh authorized detail.
 select current_arrangement into arr_ from public.patient_test_requests where id=visit_;
 update public.patient_test_requests set current_arrangement=jsonb_set(jsonb_set(current_arrangement,'{terms,startsAt}',to_jsonb(clock_timestamp())),'{terms,endsAt}',to_jsonb(clock_timestamp()+interval '1 hour'))where id=visit_ and not exists(select 1 from public.nurse_visit_completions where source_id=visit_);
 id_:=pg_temp.tv_event('text','{"text":"/visits"}');r:=public.telegram_nurse_receive(id_,true);
 if r->>'status'='ready'then r:=public.telegram_nurse_apply(id_,true,1);end if;
 perform pg_temp.tv_send();
 select x.* into o from public.telegram_nurse_outbox x where x.source_inbox=id_ and x.turn->>'kind'='visit-list'
  and exists(select 1 from jsonb_array_elements(x.turn->'visits')v where v->>'id'=visit_::text);
 select v into item from jsonb_array_elements(o.turn->'visits')v where v->>'id'=visit_::text;
 update public.patient_test_requests set current_arrangement=arr_ where id=visit_;
 perform pg_temp.tv_ok(item->>'intentRef'is not null,'eligible visit listed through real entry point');
 id_:=pg_temp.tv_event('callback',jsonb_build_object('messageId',o.provider_ref::bigint,'callbackId','tvcb_'||nextval('tv_sequence'),'intentRef',item->>'intentRef'));
 r:=public.telegram_nurse_receive(id_,true);w:=r->'visit';
 perform pg_temp.tv_ok(w->>'phase'='input','visit selection returns input work');
 flow_:=jsonb_build_object('skipped',case when key_='finish'then coalesce((select jsonb_agg(x->>'key')from jsonb_array_elements(w#>'{snapshot,items}')x where x->>'section'='safety'),'[]'::jsonb)else '[]'::jsonb end,'editing',case when key_='finish'then null else key_ end,'view',view_,'comment','');
 r:=public.telegram_nurse_visit_prepare(id_,true,1,jsonb_build_object('token',w->>'token','flow',flow_,'operation',null,'questionKey',null,'error',null));
 perform pg_temp.tv_ok(r->>'status'='ready','opening plan prepared');
 r:=public.telegram_nurse_apply(id_,true,1);w:=r->'visit';
 perform pg_temp.tv_ok(w->>'phase'='render','apply returns current visit render work');
 perform pg_temp.tv_render(id_,w,key_,case when view_='complete'then '["complete","back"]'::jsonb else '["answer-done","answer-not-done","skip","comment"]'::jsonb end);
 perform pg_temp.tv_send();return w;
end$$;
create function pg_temp.tv_answer(action_ text,words_ text default null,carrier_delta bigint default 0)returns uuid language plpgsql as $$
declare o public.telegram_nurse_outbox;c jsonb;id_ uuid;prompt_ bigint;
begin
 if words_ is not null then
  select prompt_message_id::bigint into prompt_ from public.telegram_nurse_dialogs where binding_id=(select binding from tv_fixture);
  return pg_temp.tv_event('text',jsonb_build_object('text',words_,'replyToMessageId',prompt_+carrier_delta));
 end if;
 select x.* into o from public.telegram_nurse_outbox x
  where x.binding_id=(select binding from tv_fixture)and x.state='accepted'and exists(select 1 from jsonb_array_elements(x.turn->'controls')v where v->>'action'=action_)order by x.sequence desc limit 1;
 select v into c from jsonb_array_elements(o.turn->'controls')v where v->>'action'=action_ limit 1;
 perform pg_temp.tv_ok(c->>'ref'is not null,'answer control issued');
 return pg_temp.tv_event('callback',jsonb_build_object('messageId',o.provider_ref::bigint+carrier_delta,'callbackId','tvcb_'||nextval('tv_sequence'),'intentRef',c->>'ref'));
end$$;
create function pg_temp.tv_prepare(id_ uuid,operation_ text,key_ text,done_ boolean default true,values_ jsonb default null)returns jsonb language plpgsql as $$
declare r jsonb;w jsonb;begin
 r:=public.telegram_nurse_receive(id_,true);w:=r->'visit';
 perform pg_temp.tv_ok(w->>'phase'='input','answer admitted as input work');
 return public.telegram_nurse_visit_prepare(id_,true,1,jsonb_build_object('token',w->>'token','flow',w->'flow','operation',operation_,'questionKey',key_,'done',done_,'values',values_,'error',null));
end$$;
create function pg_temp.tv_effects()returns jsonb language sql as $$select jsonb_build_object(
 'marks',(select count(*)from public.nurse_visit_marks where member_id=(select member from tv_fixture)),
 'steps',(select count(*)from public.nurse_visit_events where member_id=(select member from tv_fixture)),
 'completions',(select count(*)from public.nurse_visit_completions where member_id=(select member from tv_fixture)))$$;

-- Approval binds the renderer, copy and substitution schema before any send.
do $$declare i uuid;o uuid;r jsonb;arr_ jsonb;begin
 select current_arrangement into arr_ from public.patient_test_requests where id=(select task from tv_fixture);
 update public.patient_test_requests set current_arrangement=jsonb_set(jsonb_set(current_arrangement,'{terms,startsAt}',to_jsonb(clock_timestamp())),'{terms,endsAt}',to_jsonb(clock_timestamp()+interval '1 hour'))where id=(select task from tv_fixture);
 i:=pg_temp.tv_event('text','{"text":"/visits"}');perform public.telegram_nurse_receive(i,true);perform public.telegram_nurse_apply(i,true,1);
 select id into o from public.telegram_nurse_outbox where source_inbox=i and turn->>'kind'='visit-list';
 perform pg_temp.tv_ok(o is not null,'visit list produced while all approvals remain off');
 update public.system_message_templates set approved=true where template_id like 'telegram.nurse.%'and template_id not like 'telegram.nurse.visit_%';
 perform pg_temp.tv_send();
 perform pg_temp.tv_ok(public.telegram_nurse_outbox_claim(o,true)->>'status'='unapproved','unapproved visit output held');
 update public.system_message_templates set approved=true where template_id like 'telegram.nurse.%';
 update public.system_message_templates set substitution_schema='{}'where template_id='telegram.nurse.visit_list';
 perform pg_temp.tv_ok(public.telegram_nurse_outbox_claim(o,true)->>'status'='unapproved','arbitrary approved template shell held');
 update public.system_message_templates set substitution_schema=public._telegram_nurse_template_schema('visit-list')where template_id='telegram.nurse.visit_list';
 perform pg_temp.tv_send();
 update public.patient_test_requests set current_arrangement=arr_ where id=(select task from tv_fixture);
end$$;

-- Every write class is fenced again after command capture. A rejected command
-- must leave all three kinds of business record unchanged, not merely say refused.
do $$declare f record;op text;fault text;key_ text;i uuid;r jsonb;before_ jsonb;s public.workspace_staff;replacement_ uuid;begin
 select * into f from tv_fixture;
 foreach op in array array['mark','step','complete']loop
  key_:=case op when 'mark'then 'sample:lipid-panel'when 'step'then 'step:confirmed'else 'finish'end;
  foreach fault in array array['inactive','removed','role','assignment','binding','replaced','generation','question','snapshot','lease','attempt','db-gate','env-gate']loop
   perform pg_temp.tv_open(f.task,key_,case when op='complete'then 'complete'else 'question'end);
   i:=pg_temp.tv_answer(case when op='complete'then 'reason'else 'answer-done'end,case when op='complete'then 'Synthetic incomplete reason'end);
   perform pg_temp.tv_prepare(i,op,key_);before_:=pg_temp.tv_effects();
   select * into s from public.workspace_staff where user_id=f.nurse;
   case fault
    when 'inactive'then update public.workspace_staff set active=false where user_id=f.nurse;
    when 'removed'then delete from public.workspace_staff where user_id=f.nurse;
    when 'role'then update public.workspace_staff set role='doctor'where user_id=f.nurse;
    when 'assignment'then update public.patient_clinical_cases set assigned_nurse_id=f.other where user_id=f.member;
    when 'binding'then update public.telegram_auth_bindings set active=false,revoked_at=clock_timestamp()where id=f.binding;
    when 'replaced'then
     update public.telegram_auth_bindings set active=false,revoked_at=clock_timestamp()where id=f.binding;
     replacement_:=gen_random_uuid();
     insert into public.telegram_auth_bindings(id,auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
      select replacement_,f.other,'staff',principal_ref,account_ref,phone,address,2 from public.telegram_auth_bindings where id=f.binding;
    when 'generation'then update public.telegram_auth_bindings set generation=2 where id=f.binding;
    when 'question'then update public.telegram_nurse_dialogs set question_version=question_version+1 where binding_id=f.binding;
    when 'snapshot'then update public.patient_test_requests set current_arrangement=jsonb_set(current_arrangement,'{terms,startsAt}',to_jsonb((current_arrangement#>>'{terms,startsAt}')::timestamptz+interval '1 minute'))where id=f.task;
    when 'lease'then update public.channel_inbox set lease_until=clock_timestamp()-interval '1 second'where id=i;
    when 'attempt'then update public.channel_inbox set attempts=2 where id=i;
    when 'db-gate'then update public.telegram_nurse_settings set enabled=false;
    else null;
   end case;
   r:=public.telegram_nurse_apply(i,fault<>'env-gate',1);
   perform pg_temp.tv_ok(r->>'status'in('refused','disabled','not_leased')or(fault='snapshot'and r->>'status'='visit-render'and r#>>'{visit,input,action}'='refresh'),'write class rejects '||fault);
   perform pg_temp.tv_ok(pg_temp.tv_effects()=before_,'no visit side effect for '||op||'/'||fault);
   if fault='removed'then insert into public.workspace_staff select(s).*;end if;
   update public.workspace_staff set active=true,role='nurse'where user_id=f.nurse;
   update public.patient_clinical_cases set assigned_nurse_id=f.nurse where user_id=f.member;
   if fault='replaced'then
    perform pg_temp.tv_ok((select nurse_binding_id=f.binding and nurse_binding_generation=1 from public.channel_inbox where id=i),'replacement does not reinterpret captured actor');
    delete from public.telegram_auth_bindings where id=replacement_;
   end if;
   update public.telegram_auth_bindings set active=true,revoked_at=null,generation=1 where id=f.binding;
   update public.telegram_nurse_settings set enabled=true;
   -- End this isolated fault fixture so later queue/dead-letter checks cannot
   -- accidentally lease an intentionally expired row from this matrix.
   update public.channel_inbox set status='done',lease_until=null,processed_at=clock_timestamp()where id=i;
  end loop;
 end loop;
end$$;

-- Wrong carrier/prompt, stale question and a reading captured before another
-- device moves the question are refused at receive as well as at apply.
do $$declare f record;op text;key_ text;i uuid;r jsonb;before_ jsonb;w jsonb;begin
 select * into f from tv_fixture;
 foreach op in array array['mark','step','complete']loop
  key_:=case op when 'mark'then 'sample:lipid-panel'when 'step'then 'step:confirmed'else 'finish'end;
  perform pg_temp.tv_open(f.task,key_,case when op='complete'then 'complete'else 'question'end);before_:=pg_temp.tv_effects();
  i:=pg_temp.tv_answer(case when op='complete'then 'reason'else 'answer-done'end,case when op='complete'then 'Synthetic wrong prompt'end,1);
  r:=public.telegram_nurse_receive(i,true);if r->>'status'='ready'then r:=public.telegram_nurse_apply(i,true,1);end if;
  perform pg_temp.tv_ok(pg_temp.tv_refused(r,i)and pg_temp.tv_effects()=before_,'wrong carrier or prompt refuses '||op);
  perform pg_temp.tv_open(f.task,key_,case when op='complete'then 'complete'else 'question'end);
  update public.telegram_nurse_dialogs set expires_at=clock_timestamp()-interval '1 second'where binding_id=f.binding;
  i:=pg_temp.tv_answer(case when op='complete'then 'reason'else 'answer-done'end,case when op='complete'then 'Synthetic expired prompt'end);
  r:=public.telegram_nurse_receive(i,true);if r->>'status'='ready'then r:=public.telegram_nurse_apply(i,true,1);end if;
  perform pg_temp.tv_ok(pg_temp.tv_refused(r,i)and pg_temp.tv_effects()=before_,'expired receive refuses '||op);
 end loop;
 perform pg_temp.tv_open(f.task,'measure:bp');before_:=pg_temp.tv_effects();
 i:=pg_temp.tv_answer('reading','133 83 73');perform pg_temp.tv_prepare(i,'mark','measure:bp',true,'{"systolic":133,"diastolic":83,"pulse":73}');
 update public.telegram_nurse_dialogs set question_version=question_version+1,visit_question_key='check:urgent-symptoms'where binding_id=f.binding;
 r:=public.telegram_nurse_apply(i,true,1);
 perform pg_temp.tv_ok(pg_temp.tv_refused(r,i)and pg_temp.tv_effects()=before_,'question change refuses already parsed reading');
 perform pg_temp.tv_ok(not exists(select 1 from public.nurse_visit_marks where source_id=f.task and vals->>'systolic'='133'),'reading is not carried to another question');
 perform pg_temp.tv_scrubbed(array[i],'133 83 73');
end$$;

-- Per mark/step submission IDs and all four completion IDs exist durably before
-- execution. A displaced original worker cannot replace the recovered command.
do $$declare f record;op text;key_ text;a uuid;b uuid;cmd jsonb;ids jsonb;r jsonb;before_ jsonb;begin
 select * into f from tv_fixture;
 foreach op in array array['mark','step','complete']loop
  key_:=case op when 'mark'then 'sample:lipid-panel'when 'step'then 'step:confirmed'else 'finish'end;
  perform pg_temp.tv_open(f.task,key_,case when op='complete'then 'complete'else 'question'end);
  a:=pg_temp.tv_answer(case when op='complete'then 'reason'else 'answer-done'end,case when op='complete'then 'Synthetic replay reason'end);
  perform pg_temp.tv_prepare(a,op,key_);
  select nurse_context->'command'into cmd from public.channel_inbox where id=a;
  perform pg_temp.tv_ok(cmd->>'submissionId'is not null,'submissionId persisted before '||op);
  if op='complete'then
   perform pg_temp.tv_ok(cmd?&array['submissionId','visitId','openSubmissionId','appendSubmissionId'],'four completion IDs persisted before execution');
   perform pg_temp.tv_ok((select count(distinct value)=4 from jsonb_each_text(cmd)where key in('submissionId','visitId','openSubmissionId','appendSubmissionId')),'four completion IDs are distinct');
  end if;
  b:=pg_temp.tv_event('text','{"text":"/resume"}');r:=public.telegram_nurse_receive(b,true);
  perform pg_temp.tv_ok((select nurse_context->'command'=cmd from public.channel_inbox where id=b),'recovery preserves exact command for '||op);
  before_:=pg_temp.tv_effects();
  perform pg_temp.tv_ok(public.telegram_nurse_apply(a,true,1)->>'status'='refused','displaced original cannot execute');
  r:=public.telegram_nurse_apply(b,true,1);
  perform pg_temp.tv_ok(r->'visit'->>'phase'='render','recovery applies through visit business body');
  perform pg_temp.tv_ok(public.telegram_nurse_apply(b,true,1)->'visit'->>'phase'='render','same pending render replay does not execute again');
  perform pg_temp.tv_ok((select count(*)=1 from public.nurse_visit_marks where submission_id=(cmd->>'submissionId')::uuid)
   or(select count(*)=1 from public.nurse_visit_events where submission_id=(cmd->>'submissionId')::uuid)
   or(select count(*)=1 from public.nurse_visit_completions where submission_id=(cmd->>'submissionId')::uuid),'exact command has one recorded effect');
  if op='complete'then
   perform pg_temp.tv_ok((select command=cmd from public.nurse_visit_completions where source_id=f.task),'completion business receipt retains the exact four IDs');
  end if;
  perform pg_temp.tv_render(b,r->'visit','finish','["finish","change"]');
  if op='complete'then exit;end if;
 end loop;
end$$;

-- A previously completed visit can still record its remaining lab handover.
do $$declare f record;i uuid;r jsonb;begin
 select * into f from tv_fixture;
 perform pg_temp.tv_ok((select status='completed'from public.patient_test_requests where id=f.task),'completion closes the home request');
 perform pg_temp.tv_open(f.task,'step:samples-at-lab');
 i:=pg_temp.tv_answer('answer-done');perform pg_temp.tv_prepare(i,'step','step:samples-at-lab');r:=public.telegram_nurse_apply(i,true,1);
 perform pg_temp.tv_ok(exists(select 1 from public.nurse_visit_events where source_id=f.task and step='samples-at-lab'),'completed visit permits lab handover');
end$$;

-- A retained Today control re-reads a rescheduled future visit, but no item or
-- arrival can be recorded. The past fixture remained open until completion.
-- Today intentionally lists only today's unfinished visits and pending lab handovers.
do $$declare f record;i uuid;r jsonb;op text;key_ text;before_ jsonb;begin
 select * into f from tv_fixture;
 foreach op in array array['mark','step','complete']loop
  key_:=case op when 'mark'then 'sample:lipid-panel'when 'step'then 'step:started'else 'finish'end;
  perform pg_temp.tv_open(f.future,key_,case when op='complete'then 'complete'else 'question'end);
  i:=pg_temp.tv_answer(case when op='complete'then 'reason'else 'answer-done'end,case when op='complete'then 'Synthetic future reason'end);
  perform pg_temp.tv_prepare(i,op,key_);before_:=pg_temp.tv_effects();r:=public.telegram_nurse_apply(i,true,1);
  perform pg_temp.tv_ok(pg_temp.tv_effects()=before_,'future visit cannot write '||op);
 end loop;
 perform pg_temp.tv_ok((select status='confirmed'from public.patient_test_requests where id=f.future),'future request stays open');
end$$;

create function pg_temp.tv_new_visit()returns uuid language plpgsql as $$declare id_ uuid:=gen_random_uuid();begin
 insert into public.patient_test_requests(id,user_id,status,requested_terms,requirements,algorithm_version,context_token,create_payload,current_arrangement)
 select id_,member,'confirmed','{}','[{"id":"lipid-panel","title":"Lipid panel","method":"lab"}]','synthetic','synthetic','{}',
 jsonb_build_object('terms',jsonb_build_object('mode','home','startsAt',clock_timestamp(),'endsAt',clock_timestamp()+interval '1 hour','timezone','Asia/Yerevan','location','Synthetic street'))from tv_fixture;
 return id_;
end$$;

-- Skipping safety only changes presentation. It is still an unfinished item,
-- and the existing completion rule requires a meaningful reason (>=3 chars).
-- Once every item is done the exact same business command accepts no reason.
do $$declare f record;v uuid;w jsonb;i uuid;r jsonb;row_ jsonb;key_ text;vals jsonb;begin
 select * into f from tv_fixture;v:=pg_temp.tv_new_visit();
 w:=pg_temp.tv_open(v,'finish','complete');
 i:=pg_temp.tv_answer('reason','ab');perform pg_temp.tv_prepare(i,'complete','finish');r:=public.telegram_nurse_apply(i,true,1);
 perform pg_temp.tv_ok(not exists(select 1 from public.nurse_visit_completions where source_id=v),'two-character incomplete reason cannot complete');
 perform pg_temp.tv_open(v,'finish','complete');
 i:=pg_temp.tv_answer('complete');perform pg_temp.tv_prepare(i,'complete','finish');r:=public.telegram_nurse_apply(i,true,1);
 perform pg_temp.tv_ok(not exists(select 1 from public.nurse_visit_completions where source_id=v),'missing reason cannot complete unfinished safety items');
 w:=pg_temp.tv_open(v);
 for row_ in select x from jsonb_array_elements(w#>'{snapshot,items}')x loop
  key_:=row_->>'key';
  vals:=case key_ when 'measure:bp'then '{"systolic":122,"diastolic":78,"pulse":68}'::jsonb when 'measure:weight'then '{"value":72}'::jsonb when 'measure:waist'then '{"value":82}'::jsonb else null end;
  perform pg_temp.tv_open(v,key_);
  i:=pg_temp.tv_answer(case when row_->>'kind'='measurement'then 'reading'else 'answer-done'end,case when row_->>'kind'='measurement'then 'Synthetic valid parsed measurement'end);
  perform pg_temp.tv_prepare(i,'mark',key_,true,vals);r:=public.telegram_nurse_apply(i,true,1);
  perform pg_temp.tv_ok(exists(select 1 from public.nurse_visit_marks where source_id=v and item=key_ and done),'each real item recorded before all-done completion');
 end loop;
 perform pg_temp.tv_open(v,'finish','complete');i:=pg_temp.tv_answer('complete');perform pg_temp.tv_prepare(i,'complete','finish');r:=public.telegram_nurse_apply(i,true,1);
 perform pg_temp.tv_ok((select reason is null from public.nurse_visit_completions where source_id=v),'all done completes without a reason');
end$$;

-- Exact pending reading copied by /resume survives retention until resolution.
-- Definitive refusal then clears EVERY transport copy, including an original
-- fifth lease which dead-letters without ever entering apply again.
do $$declare f record;v uuid;a uuid;b uuid;r jsonb;cmd jsonb;before_ jsonb;begin
 select * into f from tv_fixture;v:=pg_temp.tv_new_visit();perform pg_temp.tv_open(v,'measure:bp');
 a:=pg_temp.tv_answer('reading','137 87 77');update public.channel_inbox set attempts=5 where id=a;
 r:=public.telegram_nurse_receive(a,true);
 perform public.telegram_nurse_visit_prepare(a,true,5,jsonb_build_object('token',r#>>'{visit,token}','flow',r#>'{visit,flow}','operation','mark','questionKey','measure:bp','done',true,'values','{"systolic":137,"diastolic":87,"pulse":77}'::jsonb,'error',null));
 select nurse_context->'command'into cmd from public.channel_inbox where id=a;
 b:=pg_temp.tv_event('text','{"text":"/resume"}');perform public.telegram_nurse_receive(b,true);
 perform pg_temp.tv_ok((select nurse_context->'command'=cmd from public.channel_inbox where id=b),'resume freezes parsed reading and original submission ID');
 update public.channel_inbox set received_at=clock_timestamp()-interval '2 days'where id in(a,b);perform public.auth_cleanup_run();
 perform pg_temp.tv_ok((select nurse_context->'command'=cmd from public.channel_inbox where id=a),'cleanup retains unresolved reading command');
 update public.channel_inbox set lease_until=clock_timestamp()-interval '1 second'where id=a;perform public.channel_inbox_next(1);
 before_:=pg_temp.tv_effects();update public.patient_clinical_cases set assigned_nurse_id=f.other where user_id=f.member;
 perform pg_temp.tv_ok(public.telegram_nurse_apply(b,true,1)->>'status'='refused','recovered reading refused after reassignment');
 perform pg_temp.tv_ok((select status='dead'and attempts=5 from public.channel_inbox where id=a),'original reading fifth lease reaches dead letter');
 update public.channel_inbox set processed_at=clock_timestamp()-interval '2 days'where id in(a,b);perform public.auth_cleanup_run();
 perform pg_temp.tv_scrubbed(array[a,b],'137 87 77');
 perform pg_temp.tv_ok((select count(*)=2 and bool_and(nurse_context is null and not payload?'text')from public.channel_inbox where id in(a,b)),'reading command and values removed from all terminal copies');
 perform pg_temp.tv_ok(pg_temp.tv_effects()=before_,'dead-letter lifecycle writes no refused reading');
 update public.patient_clinical_cases set assigned_nurse_id=f.nurse where user_id=f.member;
end$$;

-- Plain text slots are bounded and never used as HTML/Markdown. Comments stay
-- private even when a command is recovered and its original row later dies.
do $$declare f record;v uuid;a uuid;b uuid;i uuid;r jsonb;w jsonb;cmd jsonb;note_ text:='Synthetic private comment <tag> **literal**';begin
 select * into f from tv_fixture;v:=pg_temp.tv_new_visit();perform pg_temp.tv_open(v,'sample:lipid-panel','comment');
 i:=pg_temp.tv_answer('comment-save',repeat('x',1001));r:=public.telegram_nurse_receive(i,true);
 if r?'visit'then
  w:=r->'visit';r:=public.telegram_nurse_visit_prepare(i,true,1,jsonb_build_object('token',w->>'token','flow',jsonb_set(w->'flow','{comment}',to_jsonb(repeat('x',1001))),'operation',null,'questionKey','sample:lipid-panel','error',null));
 end if;
 perform pg_temp.tv_ok(r->>'status'in('refused','invalid')or pg_temp.tv_refused(r,i),'comment over 1000 is rejected');
 perform pg_temp.tv_open(v,'sample:lipid-panel','comment');
 i:=pg_temp.tv_answer('comment-save',note_);r:=public.telegram_nurse_receive(i,true);w:=r->'visit';
 perform public.telegram_nurse_visit_prepare(i,true,1,jsonb_build_object('token',w->>'token','flow',jsonb_build_object('skipped','[]'::jsonb,'editing','sample:lipid-panel','view','question','comment',note_),'operation',null,'questionKey','sample:lipid-panel','error',null));
 r:=public.telegram_nurse_apply(i,true,1);perform pg_temp.tv_render(i,r->'visit','sample:lipid-panel','["answer-done","answer-not-done","comment","skip"]');perform pg_temp.tv_send();
 a:=pg_temp.tv_answer('answer-not-done');update public.channel_inbox set attempts=5 where id=a;r:=public.telegram_nurse_receive(a,true);w:=r->'visit';
 perform public.telegram_nurse_visit_prepare(a,true,5,jsonb_build_object('token',w->>'token','flow',w->'flow','operation','mark','questionKey','sample:lipid-panel','done',false,'values',null,'error',null));
 select nurse_context->'command'into cmd from public.channel_inbox where id=a;
 perform pg_temp.tv_ok(cmd->>'note'=note_,'plain comment captured exactly without markup interpretation');
 b:=pg_temp.tv_event('text','{"text":"/resume"}');perform public.telegram_nurse_receive(b,true);
 perform pg_temp.tv_ok((select nurse_context->'command'=cmd from public.channel_inbox where id=b),'resume freezes comment');
 update public.channel_inbox set lease_until=clock_timestamp()-interval '1 second'where id=a;perform public.channel_inbox_next(1);
 update public.telegram_auth_bindings set active=false,revoked_at=clock_timestamp()where id=f.binding;
 perform pg_temp.tv_ok(public.telegram_nurse_apply(b,true,1)->>'status'='refused','recovered comment refused after binding revocation');
 perform pg_temp.tv_ok((select status='dead'from public.channel_inbox where id=a),'refusal preserves original comment dead-letter lifecycle');
 update public.channel_inbox set processed_at=clock_timestamp()-interval '2 days'where id in(i,a,b);perform public.auth_cleanup_run();
 perform pg_temp.tv_scrubbed(array[i,a,b],note_);
 update public.telegram_auth_bindings set active=true,revoked_at=null where id=f.binding;
end$$;


-- A provider timeout never reclaims the same send. Answers remain frozen until
-- explicit recovery issues a fresh, correlated prompt; saved work is not rerun.
do $$declare v uuid;i uuid;a uuid;b uuid;r jsonb;e jsonb;before_ jsonb;cmd jsonb;begin
 v:=pg_temp.tv_new_visit();perform pg_temp.tv_open(v,'step:confirmed');
 a:=pg_temp.tv_answer('answer-done');perform pg_temp.tv_prepare(a,'step','step:confirmed');
 select nurse_context->'command'into cmd from public.channel_inbox where id=a;
 r:=public.telegram_nurse_apply(a,true,1);perform pg_temp.tv_render(a,r->'visit','measure:bp','["answer-not-done","comment","skip"]');
 e:=pg_temp.tv_send('visit-question','unknown');before_:=pg_temp.tv_effects();
 perform pg_temp.tv_ok(public.telegram_nurse_outbox_claim((e->>'outboxId')::uuid,true)->>'ok'='false','unknown visit question never sends twice');
 perform pg_temp.tv_ok((select prompt_message_id is null from public.telegram_nurse_dialogs where binding_id=(select binding from tv_fixture)),'unknown prompt has no reply authority');
 i:=pg_temp.tv_event('text','{"text":"139 89 79","replyToMessageId":123456789}');
 r:=public.telegram_nurse_receive(i,true);if r->>'status'='ready'then r:=public.telegram_nurse_apply(i,true,1);end if;
 perform pg_temp.tv_ok(pg_temp.tv_effects()=before_,'answer while recovery is unknown cannot record reading');
 b:=pg_temp.tv_event('text','{"text":"/resume"}');r:=public.telegram_nurse_receive(b,true);
 if r?'visit'then
  perform public.telegram_nurse_visit_prepare(b,true,1,jsonb_build_object('token',r#>>'{visit,token}','flow',r#>'{visit,flow}','operation',null,'questionKey','measure:bp','error',null));
  r:=public.telegram_nurse_apply(b,true,1);perform pg_temp.tv_render(b,r->'visit','measure:bp','["answer-not-done","comment","skip"]');
 else
  perform public.telegram_nurse_apply(b,true,1);
 end if;
 perform pg_temp.tv_send();
 perform pg_temp.tv_ok((select state='unknown'and abandoned from public.telegram_nurse_outbox where id=(e->>'outboxId')::uuid),'explicit recovery retains and abandons unknown send');
 perform pg_temp.tv_ok((select count(*)=1 from public.nurse_visit_events where submission_id=(cmd->>'submissionId')::uuid),'recovery never duplicates saved step');
 perform pg_temp.tv_ok(pg_temp.tv_effects()=before_,'recovery does not reinterpret unknown-period reading');
end$$;


-- R1: a retryable detail read during /resume cannot abandon an old unknown
-- send, suppress its queued successor, or release the frozen dialog. This
-- transaction-local fault replaces only the read helper for one synthetic inbox;
-- every command, transition and business body remains the real implementation.
create temp table tv_unavailable_detail(inbox_id uuid primary key,calls integer not null default 0);
alter function public._telegram_nurse_visit_detail(public.channel_inbox,public.workspace_staff,uuid,text,uuid)
 rename to _telegram_nurse_visit_detail_test_original;
create function public._telegram_nurse_visit_detail(r public.channel_inbox,s public.workspace_staff,m uuid,src text,sid uuid)returns jsonb
language plpgsql security definer set search_path=''as $$begin
 if exists(select 1 from pg_temp.tv_unavailable_detail where inbox_id=r.id)then
  update pg_temp.tv_unavailable_detail set calls=calls+1 where inbox_id=r.id;
  return '{"status":"unavailable"}'::jsonb;
 end if;
 return public._telegram_nurse_visit_detail_test_original(r,s,m,src,sid);
end$$;
revoke all on function public._telegram_nurse_visit_detail(public.channel_inbox,public.workspace_staff,uuid,text,uuid)from public,anon,authenticated,service_role;

do $$declare v uuid;a uuid;b uuid;r jsonb;e jsonb;ids_ uuid[];dialog_ jsonb;outbox_ jsonb;ctx_ jsonb;effects_ jsonb;begin
 v:=pg_temp.tv_new_visit();perform pg_temp.tv_open(v,'step:confirmed');
 a:=pg_temp.tv_answer('answer-done');perform pg_temp.tv_prepare(a,'step','step:confirmed');
 r:=public.telegram_nurse_apply(a,true,1);
 perform pg_temp.tv_render(a,r->'visit','measure:bp','["answer-not-done","comment","skip"]');
 e:=pg_temp.tv_send('visit-action','unknown');
 perform pg_temp.tv_ok(e#>>'{turn,kind}'='visit-action','R1 fixture has an unknown action acknowledgement');
 perform pg_temp.tv_ok(exists(select 1 from public.telegram_nurse_outbox where source_inbox=a and state='queued'and turn->>'kind'='visit-question'),'R1 fixture has its dependent queued question');
 b:=pg_temp.tv_event('text','{"text":"/resume"}');r:=public.telegram_nurse_receive(b,true);
 perform pg_temp.tv_ok(r#>>'{visit,phase}'='input','R1 recovery pins visit input before read failure');
 r:=public.telegram_nurse_visit_prepare(b,true,1,jsonb_build_object('token',r#>>'{visit,token}','flow',r#>'{visit,flow}','operation',null,'questionKey','measure:bp','error',null));
 perform pg_temp.tv_ok(r->>'status'='ready','R1 recovery command prepared');
 select to_jsonb(d)into dialog_ from public.telegram_nurse_dialogs d where binding_id=(select binding from tv_fixture);
 select array_agg(o.id order by o.sequence),jsonb_agg(to_jsonb(o)order by o.sequence)into ids_,outbox_
  from public.telegram_nurse_outbox o where binding_id=(select binding from tv_fixture);
 select nurse_context into ctx_ from public.channel_inbox where id=b;effects_:=pg_temp.tv_effects();
 insert into tv_unavailable_detail(inbox_id)values(b);
 r:=public.telegram_nurse_apply(b,true,1);
 perform pg_temp.tv_ok(r->>'status'='pending','R1 unavailable read remains retryable');
 perform pg_temp.tv_ok((select calls=1 from tv_unavailable_detail where inbox_id=b),'R1 real apply reached the injected read failure');
 perform pg_temp.tv_ok((select to_jsonb(d)=dialog_ from public.telegram_nurse_dialogs d where binding_id=(select binding from tv_fixture)),'R1 unavailable read preserves entire dialog and recovery pin');
 perform pg_temp.tv_ok((select jsonb_agg(to_jsonb(o)order by o.sequence)=outbox_ from public.telegram_nurse_outbox o where id=any(ids_)),'R1 unavailable read leaves every pre-existing outbox row unchanged');
 perform pg_temp.tv_ok((select nurse_context=ctx_ from public.channel_inbox where id=b),'R1 unavailable read keeps exact prepared recovery state');
 perform pg_temp.tv_ok(pg_temp.tv_effects()=effects_,'R1 unavailable read has no business effect');
 -- A bounded pending notice may be added, but retrying cannot add another or
 -- retire any prior output. It does not grant fresh answer authority.
 perform pg_temp.tv_ok((select count(*)=1 from public.telegram_nurse_outbox where source_inbox=b and turn->>'kind'='visit-pending'),'R1 one pending notice explains the retry');
 r:=public.telegram_nurse_apply(b,true,1);
 perform pg_temp.tv_ok(r->>'status'='pending','R1 second unavailable read remains retryable');
 perform pg_temp.tv_ok((select calls=2 from tv_unavailable_detail where inbox_id=b),'R1 retry reached the same injected read failure');
 perform pg_temp.tv_ok((select to_jsonb(d)=dialog_ from public.telegram_nurse_dialogs d where binding_id=(select binding from tv_fixture)),'R1 repeated failure preserves frozen answers');
 perform pg_temp.tv_ok((select jsonb_agg(to_jsonb(o)order by o.sequence)=outbox_ from public.telegram_nurse_outbox o where id=any(ids_)),'R1 repeated failure still preserves existing outbox');
 perform pg_temp.tv_ok((select count(*)=1 from public.telegram_nurse_outbox where source_inbox=b and turn->>'kind'='visit-pending'),'R1 retry does not duplicate pending notice');
 delete from tv_unavailable_detail where inbox_id=b;
 r:=public.telegram_nurse_apply(b,true,1);
 perform pg_temp.tv_ok(r#>>'{visit,phase}'='render','R1 recovered read reaches render');
 perform pg_temp.tv_ok((select jsonb_agg(to_jsonb(o)order by o.sequence)=outbox_ from public.telegram_nurse_outbox o where id=any(ids_)),'R1 successful apply alone does not retire output before render');
 perform pg_temp.tv_render(b,r->'visit','measure:bp','["answer-not-done","comment","skip"]');
 perform pg_temp.tv_ok((select state='unknown'and abandoned from public.telegram_nurse_outbox where id=(e->>'outboxId')::uuid),'R1 successful final render abandons unknown send');
 perform pg_temp.tv_ok(not exists(select 1 from public.telegram_nurse_outbox where source_inbox=a and state='queued'),'R1 successful final render suppresses old queued successor');
 perform pg_temp.tv_ok((select pending_inbox is null from public.telegram_nurse_dialogs where binding_id=(select binding from tv_fixture)),'R1 only final render releases recovery pin');
 perform pg_temp.tv_ok(pg_temp.tv_effects()=effects_,'R1 recovered render does not replay a business mutation');
end$$;

drop function public._telegram_nurse_visit_detail(public.channel_inbox,public.workspace_staff,uuid,text,uuid);
alter function public._telegram_nurse_visit_detail_test_original(public.channel_inbox,public.workspace_staff,uuid,text,uuid)
 rename to _telegram_nurse_visit_detail;

rollback;
\echo 'Nurse Telegram visit risk paths authored: runtime execution required for verification.'
