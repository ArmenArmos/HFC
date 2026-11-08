-- Zoe's structured reply drafts in the doctor's Today inbox (20261019075018): the draft rides on the reply item with its
-- exact text, revision, content hash and sources; lane placement (judgement question P1, routine P3); approvable only
-- when structured, current, quoting the still-published plan, no judgement and no open care alert; Approve and Reject go
-- through the existing conversation_actions / conversation_command path and close the item; the reject reason is the
-- rejecting assigned doctor's only, once, in the conversation trace. Synthetic fixtures, rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.u(n int)returns uuid language sql immutable as $$select('e1d00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.as_user(n int)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id','e1d00000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::text,true)$$;
create function pg_temp.as_service()returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.denied(sql text)returns boolean language plpgsql as $$begin execute sql;return false;exception when insufficient_privilege then return true;end$$;
create temp table r(k text primary key,v jsonb);
grant all on r to authenticated,anon,service_role;
create function pg_temp.inbox(n int,label text)returns jsonb language plpgsql as $$declare x jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;x:=public.doctor_ai_inbox();reset role;insert into r values(label,x)on conflict(k)do update set v=excluded.v;return x;end$$;
create function pg_temp.item(label text,member int)returns jsonb language sql as $$
 select x from r,jsonb_array_elements(r.v->'items')x where r.k=label and(x->>'memberId')::uuid=pg_temp.u(member)and x->>'kind'like 'reply%'$$;
-- The inbox server action's path: intents from conversation_actions; Approve through doctor_inbox_approve (the inbox
-- gate, then conversation_command), Reject through conversation_command. p_target lets a probe aim an intent elsewhere.
create function pg_temp.intents(n int,member int)returns jsonb language plpgsql as $$declare a jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;a:=public.conversation_actions(pg_temp.u(member));reset role;
 insert into r values('actions:'||member,a)on conflict(k)do update set v=excluded.v;return a;end$$;
create function pg_temp.cmd(purpose text,member int)returns jsonb language sql as $$
 select jsonb_build_object('schema',1,'purpose',purpose,'intentId',(select x->>'intentId'from r,jsonb_array_elements(r.v#>'{view,actions}')x where r.k='actions:'||member and x->>'purpose'=purpose),
  'requestId',replace(gen_random_uuid()::text,'-',''))$$;
create function pg_temp.gate(n int,member int,command jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;j:=public.doctor_inbox_approve(pg_temp.u(member),command);reset role;return j;end$$;
create function pg_temp.decide(n int,member int,purpose text)returns jsonb language plpgsql as $$declare j jsonb;c jsonb;begin
 perform pg_temp.intents(n,member);c:=pg_temp.cmd(purpose,member);
 if purpose='reply.approve'then return pg_temp.gate(n,member,c);end if;
 perform pg_temp.as_user(n);set local role authenticated;j:=public.conversation_command(c);reset role;return j;end$$;
create function pg_temp.reason(n int,draft uuid,reason text,note text default null)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;j:=public.conversation_draft_reject_reason(draft,reason,note);reset role;return j;end$$;
-- A Zoe run on the member's conversation that records structured sources and finishes with a pending draft.
create function pg_temp.zoe(member int,run int,seq int,quoted jsonb,extra jsonb)returns void language plpgsql as $$declare j jsonb;begin
 insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state)
  select pg_temp.u(run),c.id,c.member_id,seq,c.version,c.draft_epoch,current_date,'started'from public.conversations c where c.member_id=pg_temp.u(member);
 perform pg_temp.as_service();set local role service_role;
 j:=public.zoe_run_record_reply_draft(pg_temp.u(run),jsonb_build_object('version','zoe-reply-draft-1','planId',pg_temp.u(60+member),'asked','The member asks about salt.',
  'acknowledgementId','A1','acknowledgement','Thank you for your question.','quoted',quoted,'doctorDecides','[]'::jsonb,'outsidePlan',false,'needsJudgement',false,'judgementReasons','[]'::jsonb)||extra);
 if j->>'ok'<>'true'then raise exception 'FAIL: sources not recorded: %',j;end if;
 perform public.zoe_run_reserve(pg_temp.u(run),0.001,true,'[]'::jsonb,'medium','noreon-fake-deterministic-1');
 j:=public.zoe_run_finish(pg_temp.u(run),jsonb_build_object('outcome','draft_proposed','reason','structured_draft_passed_guards','summary','Synthetic summary.',
  'draft','Thank you for your question.'||chr(10)||chr(10)||'Your care plan says:'||chr(10)||'Reduce salt in your food.','guardReasons','[]'::jsonb,'redactionCount',0,
  'usage',jsonb_build_object('inputTokens',10,'outputTokens',10),'costUsd',0.0001,'latencyMs',1,'provider','noreon.fake','model','noreon-fake-deterministic-1','configVersion','inbox-drafts-check',
  'sealed',null,'events','[]'::jsonb,'tier','medium','tierReason','health','fallbackUsed',false));
 reset role;
 if j->>'outcome'<>'draft_proposed'then raise exception 'FAIL: no draft proposed: %',j;end if;
end$$;

grant execute on all functions in schema pg_temp to authenticated,anon,service_role;

-- People: members 01 and 03 (doctor 11, nurse 13), 02 (doctor 12); doctors 11, 12; nurse 13; admin 14.
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.u(n),case when n<10 then '374990180'||lpad(n::text,2,'0')end,case when n<10 then now()end
 from unnest(array[1,2,3,11,12,13,14])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select('e1d00000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid,pg_temp.u(n),now()-interval '1 hour',now()
 from unnest(array[1,2,3,11,12,13,14])n;
insert into public.workspace_clinics(id,name)values(pg_temp.u(20),'Synthetic inbox drafts clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.u(11),'doctor','Dr Drafts One',pg_temp.u(20)),(pg_temp.u(12),'doctor','Dr Drafts Two',pg_temp.u(20)),(pg_temp.u(13),'nurse','Nurse Drafts',pg_temp.u(20));
insert into public.workspace_staff(user_id,role,display_name)values(pg_temp.u(14),'admin','Admin Drafts');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.u(1),pg_temp.u(11),pg_temp.u(13)),(pg_temp.u(2),pg_temp.u(12),null),(pg_temp.u(3),pg_temp.u(11),pg_temp.u(13));
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)
 values(true,'synthetic-inbox-drafts',3600,600,60,6,false,true)on conflict(singleton)do update set version=excluded.version,grant_seconds=3600,intent_seconds=600,delivery_enabled=true;
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set structured_drafts_enabled=true;
-- A published plan for each member.
insert into public.patient_care_plans(id,user_id,clinician,instructions,active,published_at)select pg_temp.u(60+n),pg_temp.u(n),'Dr Drafts','Plan',true,now()-interval '1 day'from unnest(array[1,2,3])n;
insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,published_at,draft)
 select pg_temp.u(n),pg_temp.u(60+n),gen_random_uuid(),pg_temp.u(11),0,'fixture-token','{}','{}',now()-interval '1 day',
  jsonb_build_object('explanation','Your readings are above target.','instructions','Measure twice a day.'||chr(10)||'Reduce salt in your food.','followUp','Repeat the tests in 3 months.')
 from unnest(array[1,2,3])n;
-- Each member asked one question an hour ago (written as the intake writes it; triggers off).
set local session_replication_role=replica;
insert into public.conversations(id,member_id,version,draft_epoch)select pg_temp.u(80+n),pg_temp.u(n),1,0 from unnest(array[1,2,3])n;
insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id,created_at)
 select pg_temp.u(80+n),1,pg_temp.u(n),'Synthetic question about salt','authenticated_member',gen_random_uuid(),now()-interval '1 hour'from unnest(array[1,2,3])n;
set local session_replication_role=origin;
-- 20261023063508 (Codex A2-3): zoe_run_reserve and zoe_run_finish re-check Zoe consent; the fixture's members consent.
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version=coalesce(consent_wording_version,'zoe-consent-draft-1')where singleton;
insert into public.zoe_consents(member_id,kind,granted,wording_version)select c.member_id,'zoe_reads_messages',true,(select s.consent_wording_version from public.zoe_settings s where s.singleton)
 from public.conversations c where not public._zoe_consent_ok(c.member_id);
-- Zoe: member 01 a plain plan quote (routine); member 03 a medicine question that needs the doctor (judgement); member 02 routine.
select pg_temp.zoe(1,51,1,'[{"id":"I2","kind":"instruction","text":"Reduce salt in your food."}]','{}');
select pg_temp.zoe(2,52,1,'[{"id":"I2","kind":"instruction","text":"Reduce salt in your food."}]','{}');
select pg_temp.zoe(3,53,1,'[]','{"needsJudgement":true,"judgementReasons":["medicine_question"],"doctorDecides":["Whether to change the dose"]}');

-- 1. Who may read: the assigned doctor sees only their members' drafts; others are refused.
select pg_temp.inbox(11,'d11');
select pg_temp.ok(pg_temp.item('d11',2)is null,'doctor 11 never sees member 02''s draft');
select pg_temp.inbox(12,'d12');
select pg_temp.ok(pg_temp.item('d12',2)->'draft'->>'approvable'='true'and pg_temp.item('d12',1)is null,'doctor 12 sees only member 02');
select pg_temp.as_user(13);select pg_temp.ok(pg_temp.denied($$set local role authenticated;select public.doctor_ai_inbox()$$),'nurse refused');reset role;
select pg_temp.as_user(14);select pg_temp.ok(pg_temp.denied($$set local role authenticated;select public.doctor_ai_inbox()$$),'admin refused');reset role;
select pg_temp.as_user(1);select pg_temp.ok(pg_temp.denied($$set local role authenticated;select public.doctor_ai_inbox()$$),'member refused');reset role;

-- 2. The draft on the item and its lane.
select pg_temp.ok(pg_temp.item('d11',1)->>'lane'='P3'and pg_temp.item('d11',1)->>'kind'='reply_draft'and pg_temp.item('d11',1)->>'confidence'='M','routine question with a ready draft: P3, medium');
select pg_temp.ok((select d->>'structured'='true'and d->>'approvable'='true'and d->>'stale'='false'and d->>'planCurrent'='true'and d->>'openAlert'='false'
 and d->>'body'like 'Thank you for your question.%Reduce salt in your food.'and(d->>'revision')::int=1 and d->>'author'='ai_assistant'
 and d->>'contentHash'=(select rv.content_hash from public.conversation_revisions rv join public.conversation_drafts cd on cd.id=rv.draft_id and cd.revision=rv.revision where cd.conversation_id=pg_temp.u(81)and cd.state='pending')
 from(select pg_temp.item('d11',1)->'draft'd)q),'draft carries exact text, revision and the stored content hash');
select pg_temp.ok(pg_temp.item('d11',1)->'sources'@>jsonb_build_array(jsonb_build_object('type','plan_item','ref','I2','rule','instruction'),jsonb_build_object('type','plan_publication','ref',pg_temp.u(61)::text),
 jsonb_build_object('type','zoe_run','ref',pg_temp.u(51)::text)),'sources: plan item, publication and Zoe run');
-- Astra ID-02: no new item kind (the running app parses the same doctor-inbox-v1 kinds); P1 by lane only.
select pg_temp.ok(pg_temp.item('d11',3)->>'lane'='P1'and pg_temp.item('d11',3)->>'kind'='reply_draft'and pg_temp.item('d11',3)->'draft'->>'approvable'='false'
 and pg_temp.item('d11',3)->'draft'->'doctorDecides'='["Whether to change the dose"]','question needing judgement: P1 at any age, not one-tap approvable');
select pg_temp.ok((select string_agg(x->>'lane'||':'||(x->>'kind'),',' order by n)from r,jsonb_array_elements(r.v->'items')with ordinality e(x,n)where r.k='d11')='P1:reply_draft,P3:reply_draft','lane order');
select pg_temp.ok((select bool_and(x->>'kind'=any(array['lab_attention','lab_sheet','checkin_worse','checkpoint_due','plan_draft','intake','reply_overdue','reply_not_delivered','reply_draft']))
 from r,jsonb_array_elements(r.v->'items')x),'every emitted kind is one the deployed app knows');

-- 3. Not approvable: an open care alert (P0 first, item kept), new clinical evidence, a replaced plan.
savepoint alert;
set local session_replication_role=replica;
insert into public.care_alerts(id,member_id,source,reason_code,red_flags,rule_id,rule_version,source_ref,doctor_id,state,created_at)
 values(pg_temp.u(40),pg_temp.u(1),'zoe','zoe_red_flag','{}','zoe.red_flag','v1','run-x',pg_temp.u(11),'open',now());
set local session_replication_role=origin;
select pg_temp.inbox(11,'alert');
select pg_temp.ok((select jsonb_array_length(v->'p0')=1 from r where k='alert')and pg_temp.item('alert',1)->'draft'->>'approvable'='false'and pg_temp.item('alert',1)->'draft'->>'openAlert'='true','open alert: P0 shown, draft not one-tap approvable');
rollback to alert;
savepoint stale;
update public.patient_clinical_cases set revision=revision+1 where user_id=pg_temp.u(1);
select pg_temp.inbox(11,'stale');
select pg_temp.ok(pg_temp.item('stale',1)->'draft'->>'stale'='true'and pg_temp.item('stale',1)->'draft'->>'approvable'='false'and pg_temp.item('stale',1)->>'confidence'='L','new clinical evidence: stale, low, not approvable');
rollback to stale;
savepoint plan;
update public.patient_care_plans set active=false where id=pg_temp.u(61);
select pg_temp.inbox(11,'plan');
select pg_temp.ok(pg_temp.item('plan',1)->'draft'->>'planCurrent'='false'and pg_temp.item('plan',1)->'draft'->>'approvable'='false'and pg_temp.item('plan',1)->>'confidence'='L','plan replaced: low, not approvable');
rollback to plan;

-- 4. Approve goes only through the existing guard path: another doctor, the nurse and the admin get no intents.
select pg_temp.as_user(12);select pg_temp.ok(pg_temp.denied($$set local role authenticated;select public.conversation_actions('e1d00000-0000-4000-8000-000000000001')$$),'another doctor cannot issue intents');reset role;
select pg_temp.as_user(13);select pg_temp.ok(pg_temp.denied($$set local role authenticated;select public.conversation_actions('e1d00000-0000-4000-8000-000000000001')$$),'nurse cannot issue intents');reset role;
select pg_temp.as_user(14);select pg_temp.ok(pg_temp.denied($$set local role authenticated;select public.conversation_actions('e1d00000-0000-4000-8000-000000000001')$$),'admin cannot issue intents');reset role;
-- Astra ID-01: the gate refuses inside the transaction. An alert raised after the inbox read and after the intents
-- were issued still stops the approval; so do a judgement draft and an intent for another member.
select pg_temp.intents(11,1);
create temp table cmd1 as select pg_temp.cmd('reply.approve',1)c;grant select on cmd1 to authenticated;
savepoint late_alert;
insert into public.care_alerts(id,member_id,source,reason_code,red_flags,rule_id,rule_version,source_ref,doctor_id,state,created_at)
 values(pg_temp.u(41),pg_temp.u(1),'zoe','zoe_red_flag','{}','zoe.red_flag','v1','run-late',pg_temp.u(11),'open',now());
select pg_temp.ok(pg_temp.gate(11,1,(select c from cmd1))->>'code'='open_alert','alert raised after the read: approval refused in the transaction');
select pg_temp.ok(not exists(select 1 from public.conversation_approvals a join public.conversation_drafts d on d.id=a.draft_id where d.conversation_id=pg_temp.u(81)),'no approval while the alert is open');
rollback to late_alert;
select pg_temp.ok(pg_temp.gate(11,3,(select c from cmd1))->>'code'='intent_wrong_member','an intent for another member is refused');
select pg_temp.intents(11,3);
select pg_temp.ok(pg_temp.gate(11,3,pg_temp.cmd('reply.approve',3))->>'code'='not_inbox_approvable','a judgement draft cannot be approved from the inbox');
select pg_temp.ok(pg_temp.gate(11,1,jsonb_build_object('schema',1,'purpose','reply.reject','intentId',repeat('0',32),'requestId',repeat('r',32)))->>'code'='invalid_command','the gate only carries reply.approve');
select pg_temp.as_user(12);select pg_temp.ok(pg_temp.denied($$select pg_temp.gate(12,1,(select c from cmd1))$$),'another doctor refused at the gate');reset role;
select pg_temp.ok(pg_temp.denied($$select pg_temp.gate(13,1,(select c from cmd1))$$),'nurse refused at the gate');
select pg_temp.ok(pg_temp.denied($$select pg_temp.gate(14,1,(select c from cmd1))$$),'admin refused at the gate');
select pg_temp.ok(pg_temp.denied($$select pg_temp.gate(1,1,(select c from cmd1))$$),'member refused at the gate');
select pg_temp.ok(exists(select 1 from pg_trigger where tgname='care_alert_member_lock'and tgrelid='public.care_alerts'::regclass and tgenabled='O'),'care alert writes take the member lock');
select pg_temp.ok(pg_temp.gate(11,1,(select c from cmd1))->>'ok'='true','assigned doctor approves through the gate and conversation_command');
select pg_temp.ok((select v#>>'{view,draft,contentHash}'=pg_temp.item('d11',1)#>>'{draft,contentHash}'and(v#>>'{view,draft,revision}')::int=1 from r where k='actions:1'),'the intent is for the text the inbox showed');
select pg_temp.ok((select count(*)=1 from public.conversation_approvals a join public.conversation_drafts d on d.id=a.draft_id where d.conversation_id=pg_temp.u(81)and a.doctor_id=pg_temp.u(11)
 and a.body=pg_temp.item('d11',1)#>>'{draft,body}'),'one approval, by the assigned doctor, of exactly the shown text');
select pg_temp.ok((select count(*)=1 from public.conversation_deliveries where conversation_id=pg_temp.u(81)),'one delivery row (the existing sender decides; nothing else sends)');
select pg_temp.inbox(11,'approved');
-- The draft item closes. This synthetic member has no Telegram or app route, so the existing #327 rule shows the held
-- reply as not delivered (rule, no draft, nothing to approve).
select pg_temp.ok(coalesce(pg_temp.item('approved',1)->>'kind','none')in('none','reply_not_delivered')and pg_temp.item('approved',1)->'draft'is null,'approved: the draft item leaves the inbox');

-- 5. Reject with a reason (member 03).
select pg_temp.ok(pg_temp.reason(11,(pg_temp.item('d11',3)#>>'{draft,draftId}')::uuid,'not_answered')->>'code'='draft_not_rejected_by_you','no reason before a rejection');
select pg_temp.ok((select count(*)=0 from public.conversation_intents i join public.conversation_drafts d on d.id=i.draft_id where d.conversation_id=pg_temp.u(83)and i.state='consumed'),'refused gate consumed no intent');
select pg_temp.ok(pg_temp.decide(11,3,'reply.reject')->>'ok'='true','assigned doctor rejects through conversation_command');
create temp table rej as select(pg_temp.item('d11',3)#>>'{draft,draftId}')::uuid id;grant select on rej to authenticated;
select pg_temp.as_user(12);select pg_temp.ok(pg_temp.denied($$select pg_temp.reason(12,(select id from rej),'not_answered')$$),'another doctor cannot record the reason');reset role;
select pg_temp.ok(pg_temp.denied($$select pg_temp.reason(13,(select id from rej),'not_answered')$$),'nurse cannot record the reason');
select pg_temp.ok(pg_temp.denied($$select pg_temp.reason(14,(select id from rej),'not_answered')$$),'admin cannot record the reason');
select pg_temp.ok(pg_temp.denied($$select pg_temp.reason(3,(select id from rej),'not_answered')$$),'member cannot record the reason');
select pg_temp.ok(pg_temp.denied($$select pg_temp.reason(11,gen_random_uuid(),'not_answered')$$),'unknown draft refused');
select pg_temp.ok(pg_temp.reason(11,(select id from rej),'bogus')->>'code'='reason_invalid','reason outside the fixed list refused');
select pg_temp.ok(pg_temp.reason(11,(select id from rej),'other','  ')->>'code'='note_invalid','other needs a note');
select pg_temp.ok(pg_temp.reason(11,(select id from rej),'other',repeat('x',501))->>'code'='note_invalid','note capped at 500');
select pg_temp.ok(pg_temp.reason(11,(select id from rej),'not_answered','  Did not address the dose  ')=jsonb_build_object('ok',true,'replayed',false),'reason recorded');
select pg_temp.ok(pg_temp.reason(11,(select id from rej),'unsafe')=jsonb_build_object('ok',true,'replayed',true),'once per draft');
select pg_temp.ok((select count(*)=1 and min(reason_code)='not_answered'and min(actor_id::text)=pg_temp.u(11)::text and min(attributes->>'noreon.reject.note')='Did not address the dose'
 and bool_and((attributes->>'noreon.draft.structured')::boolean)from public.conversation_trace_events where subject_id=(select id from rej)::text and name='draft.reject_reason'),'trace event carries the reason');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where subject_id=(select id from rej)::text and name='draft.rejected'),'next to the existing draft.rejected event');
select pg_temp.inbox(11,'rejected');
select pg_temp.ok(pg_temp.item('rejected',3)is null,'rejected: the item leaves the inbox');
select pg_temp.ok(not exists(select 1 from public.conversation_approvals a join public.conversation_drafts d on d.id=a.draft_id where d.conversation_id=pg_temp.u(83)),'nothing approved for the rejected draft');

-- 7. Who wrote the draft (phone test finding 3). Member 04 has only the doctor's own text; member 05 has Zoe's text edited by the doctor.
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.u(n),'37499018'||lpad(n::text,3,'0'),now()from unnest(array[4,5])n;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values(pg_temp.u(4),pg_temp.u(11)),(pg_temp.u(5),pg_temp.u(11));
set local session_replication_role=replica;
insert into public.conversations(id,member_id,version,draft_epoch)select pg_temp.u(80+n),pg_temp.u(n),1,0 from unnest(array[4,5])n;
insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id,created_at)
 select pg_temp.u(80+n),1,pg_temp.u(n),'Synthetic question','authenticated_member',gen_random_uuid(),now()-interval '1 hour'from unnest(array[4,5])n;
insert into public.conversation_drafts(id,conversation_id,state,context_version,clinical_revision,source_token,revision)
 select pg_temp.u(70+n),pg_temp.u(80+n),'pending',1,0,public.patient_clinical_evidence(pg_temp.u(n))->>'token',case n when 4 then 1 else 2 end from unnest(array[4,5])n;
insert into public.conversation_revisions(draft_id,revision,body,summary,content_hash,author_id,author_kind,provenance)values
 (pg_temp.u(74),1,'My own reply','Private summary','h1',pg_temp.u(11),'staff','{"kind":"staff"}'),
 (pg_temp.u(75),1,'Zoe reply','Private summary','h2',null,'ai_assistant','{"kind":"zoe"}'),
 (pg_temp.u(75),2,'Zoe reply, edited','Private summary','h3',pg_temp.u(11),'staff','{"kind":"staff"}');
set local session_replication_role=origin;
select pg_temp.inbox(11,'d11who');
select pg_temp.ok(pg_temp.item('d11who',4)->>'ai'='none'and pg_temp.item('d11who',4)->>'confidence'='L'and pg_temp.item('d11who',4)#>>'{draft,author}'='staff','the doctor''s own draft is not labelled AI');
select pg_temp.ok(pg_temp.item('d11who',5)->>'ai'='draft'and pg_temp.item('d11who',5)->>'confidence'='M','a Zoe draft the doctor edited still shows AI prepared it');

-- 6. Grants.
select pg_temp.ok(not has_function_privilege('anon','public.conversation_draft_reject_reason(uuid,text,text)','execute')
 and has_function_privilege('authenticated','public.conversation_draft_reject_reason(uuid,text,text)','execute')
 and not has_function_privilege('service_role','public.conversation_draft_reject_reason(uuid,text,text)','execute')
 and not has_function_privilege('anon','public.doctor_ai_inbox()','execute')
 and not has_function_privilege('anon','public.doctor_inbox_approve(uuid,jsonb)','execute')and has_function_privilege('authenticated','public.doctor_inbox_approve(uuid,jsonb)','execute')
 and not has_function_privilege('service_role','public.doctor_inbox_approve(uuid,jsonb)','execute'),'function grants');
rollback;
