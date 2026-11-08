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
-- The existing review path, as the conversation screen and the inbox server action call it.
create function pg_temp.decide(n int,member int,purpose text)returns jsonb language plpgsql as $$declare a jsonb;j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;
 a:=public.conversation_actions(pg_temp.u(member));
 insert into r values('actions:'||member,a)on conflict(k)do update set v=excluded.v;
 j:=public.conversation_command(jsonb_build_object('schema',1,'purpose',purpose,'intentId',(select x->>'intentId'from jsonb_array_elements(a#>'{view,actions}')x where x->>'purpose'=purpose),
  'requestId',replace(gen_random_uuid()::text,'-','')));
 reset role;return j;end$$;
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
-- Zoe: member 01 a plain plan quote (routine); member 03 a medicine question that needs the doctor (judgement); member 02 routine.
select pg_temp.zoe(1,51,1,'[{"id":"I2","kind":"instruction","text":"Reduce salt in your food."}]','{}');
select pg_temp.zoe(2,52,1,'[{"id":"I2","kind":"instruction","text":"Reduce salt in your food."}]','{}');
select pg_temp.zoe(3,53,1,'[]','{"needsJudgement":true,"judgementReasons":["medicine_question"],"doctorDecides":["Whether to change the dose"]}');


-- Independent race probe: the inbox read succeeds, then an alert arrives before intent issuance.
select pg_temp.inbox(11,'shown');
select pg_temp.ok(pg_temp.item('shown',1)#>>'{draft,approvable}'='true','initially approvable');
select public._care_alert_raise(pg_temp.u(1),'zoe','zoe_red_flag','{}','zoe.red_flag','v1','review-race');
select pg_temp.inbox(11,'after-alert');
select pg_temp.ok(pg_temp.item('after-alert',1)#>>'{draft,approvable}'='false','new alert forbids inbox approve');
select pg_temp.decide(11,1,'reply.approve') as command_after_alert;
rollback;
