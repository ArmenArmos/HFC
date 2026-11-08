-- Synthetic fixtures, no network or provider. Run against a disposable local replay only.
-- All writes are rolled back. This covers sequential idempotence and unique-edge protection;
-- scripts/check-telegram-delivery-retry-races.mjs proves the simultaneous-session case.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.claims(actor integer default 2,method text default 'password')returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',format('d9500000-0000-4000-8000-%s',lpad(actor::text,12,'0')),'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method',method)),'session_id',format('d9510000-0000-4000-8000-%s',lpad(actor::text,12,'0')))::text,true);
end$$;
insert into auth.users(id,phone,phone_confirmed_at)values
 ('d9500000-0000-4000-8000-000000000001','37499009501',now()),
 ('d9500000-0000-4000-8000-000000000002',null,null),
 ('d9500000-0000-4000-8000-000000000003',null,null),
 ('d9500000-0000-4000-8000-000000000004',null,null),
 ('d9500000-0000-4000-8000-000000000005',null,null);
insert into public.workspace_clinics(id,name)values
 ('d9520000-0000-4000-8000-000000000001','Synthetic retry clinic'),
 ('d9520000-0000-4000-8000-000000000002','Synthetic other clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('d9500000-0000-4000-8000-000000000002','doctor','Synthetic original doctor','d9520000-0000-4000-8000-000000000001'),
 ('d9500000-0000-4000-8000-000000000003','nurse','Synthetic nurse','d9520000-0000-4000-8000-000000000001'),
 ('d9500000-0000-4000-8000-000000000004','doctor','Synthetic other clinic doctor','d9520000-0000-4000-8000-000000000002'),
 ('d9500000-0000-4000-8000-000000000005','doctor','Synthetic next doctor','d9520000-0000-4000-8000-000000000001');
insert into auth.sessions(id,user_id,created_at,updated_at)
 select ('d9510000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('d9500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now()from generate_series(1,5)n;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('d9500000-0000-4000-8000-000000000001','d9500000-0000-4000-8000-000000000002','d9500000-0000-4000-8000-000000000003');
insert into public.conversations(id,member_id)values('d9530000-0000-4000-8000-000000000001','d9500000-0000-4000-8000-000000000001');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,delivery_enabled)
 values(true,'synthetic-retry',3600,600,60,100,true);
insert into public.conversation_endpoints(member_id,adapter,account_ref,principal_ref,address,generation,active,policy_version,expires_at,max_utf16)
 values('d9500000-0000-4000-8000-000000000001','telegram','synthetic-retry','synthetic-principal','synthetic-address',1,true,'synthetic-retry','infinity',4096);
select pg_temp.claims();
select public.conversation_workspace('d9500000-0000-4000-8000-000000000001');
-- Approved historical delivery fixture. Its exact body/hash/source match an actual approved
-- command, but fixture setup avoids running unrelated compose/AI/Telegram machinery.
create function pg_temp.delivery(p_state text default 'definitely_failed',p_reason text default null)returns uuid language plpgsql as $$
declare d uuid;i uuid;a uuid;dl uuid;g public.conversation_grants;cs public.patient_clinical_cases;c public.conversations;h text;
begin
 select * into g from public.conversation_grants where actor_id='d9500000-0000-4000-8000-000000000002';
 select * into cs from public.patient_clinical_cases where user_id='d9500000-0000-4000-8000-000000000001';
 select * into c from public.conversations where member_id=cs.user_id;
 h:=public._conversation_hash(c.id,cs.user_id,'Exact synthetic approved reply');
 insert into public.conversation_drafts(conversation_id,state,context_version,clinical_revision,source_token)values(c.id,'approved',c.version,cs.revision,public.patient_clinical_evidence(cs.user_id)->>'token')returning id into d;
 insert into public.conversation_revisions(draft_id,revision,body,summary,content_hash,author_id,author_kind,provenance)
 values(d,1,'Exact synthetic approved reply','Synthetic private summary',h,g.actor_id,'staff','{"fixture":true}');
 insert into public.conversation_intents(draft_id,revision,actor_id,grant_id,grant_generation,purpose,context_version,content_hash,expires_at,state)
 values(d,1,g.actor_id,g.id,g.generation,'reply.approve',c.version,h,now()+interval '10 minutes','consumed')returning id into i;
 insert into public.conversation_approvals(draft_id,revision,context_version,content_hash,body,doctor_id,doctor_name,doctor_role,clinic_id,grant_id,grant_generation,intent_id)
 values(d,1,c.version,h,'Exact synthetic approved reply',g.actor_id,'Synthetic original doctor','doctor','d9520000-0000-4000-8000-000000000001',g.id,g.generation,i)returning id into a;
 insert into public.conversation_deliveries(conversation_id,approval_id,state,reason,endpoint_id,endpoint_generation,policy_version)
 select c.id,a,p_state,p_reason,id,generation,policy_version from public.conversation_endpoints where member_id=cs.user_id returning id into dl;
 return dl;
end$$;
-- Concurrent fixture setup ends here.
select pg_temp.ok(has_function_privilege('authenticated','public.conversation_retry_delivery(uuid)','EXECUTE')and not has_function_privilege('anon','public.conversation_retry_delivery(uuid)','EXECUTE')and not has_function_privilege('service_role','public.conversation_retry_delivery(uuid)','EXECUTE'),'Only authenticated callers have retry RPC privilege');
select pg_temp.ok(not has_function_privilege('authenticated','public._conversation_retry_authorize(uuid,uuid,uuid,jsonb,boolean,boolean,uuid,uuid)','EXECUTE')and not has_function_privilege('authenticated','public.conversation_workspace_unlogged(uuid)','EXECUTE'),'Authorization helper and unlogged workspace stay private');
select pg_temp.ok(to_regprocedure('public._conversation_workspace_before_retry(uuid)')is null,'No renamed audited workspace remains');
-- Each staff entry point records exactly one read through the audited workspace.
do $$declare before_reads bigint;w jsonb;begin
 select count(*)into before_reads from public.access_audit where member_id='d9500000-0000-4000-8000-000000000001'and surface='member_messages';
 w:=public.conversation_workspace('d9500000-0000-4000-8000-000000000001');
 perform pg_temp.ok((select count(*)=before_reads+1 from public.access_audit where member_id='d9500000-0000-4000-8000-000000000001'and surface='member_messages'),'Legacy workspace records one read');
 w:=public.conversation_retry_workspace('d9500000-0000-4000-8000-000000000001');
 perform pg_temp.ok((select count(*)=before_reads+2 from public.access_audit where member_id='d9500000-0000-4000-8000-000000000001'and surface='member_messages'),'Retry workspace records one read');
 w:=public.doctor_chat_retry_conversation('d9500000-0000-4000-8000-000000000001');
 perform pg_temp.ok((select count(*)=before_reads+3 from public.access_audit where member_id='d9500000-0000-4000-8000-000000000001'and surface='member_messages'),'Doctor retry conversation records one read');
end$$;

-- Every unsafe state/reason is rejected through the actual mutation entry point.
do $$declare s text;why text;dl uuid;begin
 foreach s in array array['queued','sending','accepted_by_provider','unknown']loop
  dl:=pg_temp.delivery(s);perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'code'='delivery_not_retryable','Disallowed state '||s);
 end loop;
 foreach why in array array['newer_member_message','stale_context','member_sent_unsupported_media','member_over_intake_limit','content_hash_mismatch','endpoint_relinked','endpoint_unlinked','template_unapproved','template_changed','other_hold']loop
  dl:=pg_temp.delivery('held',why);perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'code'='delivery_not_retryable','Disallowed hold '||why);
 end loop;
 dl:=pg_temp.delivery('held',null);perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'code'='delivery_not_retryable','Null held reason denied');
end$$;
-- Identity/session/clinic fences. Each nested exception rolls back the attempted request.
do $$declare dl uuid:=pg_temp.delivery();n integer;begin
 foreach n in array array[1,3,4,5]loop
  perform pg_temp.claims(n);
  begin perform public.conversation_retry_delivery(dl);raise exception 'FAIL: unauthorized actor %',n;exception when insufficient_privilege then null;end;
 end loop;
 perform pg_temp.claims(2,'recovery');
 begin perform public.conversation_retry_delivery(dl);raise exception 'FAIL: recovery AMR';exception when insufficient_privilege then null;end;
 perform pg_temp.claims();
 update auth.sessions set not_after=now()-interval '1 minute'where id='d9510000-0000-4000-8000-000000000002';
 begin perform public.conversation_retry_delivery(dl);raise exception 'FAIL: expired session';exception when insufficient_privilege then null;end;
 update auth.sessions set not_after=null where id='d9510000-0000-4000-8000-000000000002';
 update public.workspace_staff set active=false where user_id='d9500000-0000-4000-8000-000000000002';
 begin perform public.conversation_retry_delivery(dl);raise exception 'FAIL: inactive doctor';exception when insufficient_privilege then null;end;
 update public.workspace_staff set active=true where user_id='d9500000-0000-4000-8000-000000000002';
end$$;
-- Stale context, unseen media/overflow and clinical sources cannot be replayed.
savepoint stale_checks;
do $$declare dl uuid:=pg_temp.delivery();begin
 update public.conversations set version=version+1 where id='d9530000-0000-4000-8000-000000000001';
 perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'code'='stale_context','New member version blocks retry');
end$$;
rollback to stale_checks;
do $$declare dl uuid:=pg_temp.delivery();begin
 insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id)
 values('d9530000-0000-4000-8000-000000000001',1,'d9500000-0000-4000-8000-000000000001','Synthetic unseen text','authenticated_member',gen_random_uuid());
 perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'code'='stale_context','Newer member message blocks retry even if version were stale');
end$$;
rollback to stale_checks;
do $$declare dl uuid:=pg_temp.delivery();kind text;begin
 foreach kind in array array['message.media','message.overflow']loop
  insert into public.conversation_audit(conversation_id,kind,detail)values('d9530000-0000-4000-8000-000000000001',kind,'{"version":1}');
  perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'code'='stale_context','Unseen context '||kind);
 end loop;
end$$;
rollback to stale_checks;
do $$declare dl uuid:=pg_temp.delivery();begin
 update public.patient_clinical_cases set revision=revision+1 where user_id='d9500000-0000-4000-8000-000000000001';
 perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'code'='stale_context','Changed clinical revision blocks retry');
end$$;
rollback to stale_checks;
do $$declare dl uuid:=pg_temp.delivery();begin
 insert into public.patient_assessments(user_id,answers)values('d9500000-0000-4000-8000-000000000001','{"synthetic":"new evidence"}');
 perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'code'='stale_context','Changed source token blocks retry');
end$$;
rollback to stale_checks;
-- Route gates apply at retry time and again in the existing claim path.
do $$declare dl uuid:=pg_temp.delivery();begin
 update public.conversation_policy set delivery_enabled=false;
 perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'code'='route_policy_missing','Disabled policy blocks retry');
 update public.conversation_policy set delivery_enabled=true;
 update public.conversation_endpoints set active=false;
 perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'code'='route_unavailable','Inactive route blocks retry');
 update public.conversation_endpoints set active=true,max_utf16=1;
 perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'code'='route_unavailable','Over-limit transport body blocks retry');
 update public.conversation_endpoints set max_utf16=4096,expires_at=now()-interval '1 second';
 perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'code'='route_unavailable','Expired route blocks retry');
 update public.conversation_endpoints set expires_at='infinity',policy_version='old-policy';
 perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'code'='route_unavailable','Wrong policy route blocks retry');
 update public.conversation_endpoints set policy_version='synthetic-retry',adapter='other';
 perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'code'='route_unavailable','Non-Telegram route blocks retry');
end$$;
rollback to stale_checks;

-- Success for all four permitted cases; exact text, actor audit and original history.
do $$declare why text;dl uuid;res jsonb;child uuid;before_dl jsonb;before_ap jsonb;before_r jsonb;before_attempts jsonb;begin
 foreach why in array array['definitely_failed','route_unavailable','route_policy_missing','approval_authority_lapsed']loop
  dl:=pg_temp.delivery(case when why='definitely_failed'then why else 'held'end,case when why='definitely_failed'then null else why end);
  if why='definitely_failed'then
   update public.conversation_deliveries set state_seq=2 where id=dl;
   insert into public.conversation_attempts(id,delivery_id,state_seq,envelope,outcome,outcome_at)
   select gen_random_uuid(),d.id,1,jsonb_build_object('deliveryId',d.id,'approvalId',a.id,'body',a.body,'contentHash',a.content_hash),
    '{"kind":"definitely_failed","evidence":"telegram_bot_blocked"}'::jsonb,now()
   from public.conversation_deliveries d join public.conversation_approvals a on a.id=d.approval_id where d.id=dl;
  end if;
  select coalesce(jsonb_agg(to_jsonb(attempt)order by attempt.id),'[]')into before_attempts from public.conversation_attempts attempt where attempt.delivery_id=dl;
  perform pg_temp.ok(jsonb_array_length(before_attempts)=case when why='definitely_failed'then 1 else 0 end,'Original attempt fixture exists for definitive failure');
  select to_jsonb(d),to_jsonb(a),to_jsonb(r)into before_dl,before_ap,before_r from public.conversation_deliveries d join public.conversation_approvals a on a.id=d.approval_id join public.conversation_revisions r on r.draft_id=a.draft_id and r.revision=a.revision where d.id=dl;
  res:=public.conversation_retry_delivery(dl);child:=(res->>'deliveryId')::uuid;
  perform pg_temp.ok(res->>'ok'='true'and res->>'replayed'='false','Successful retry '||why);
  perform pg_temp.ok(public.conversation_retry_delivery(dl)=jsonb_build_object('ok',true,'deliveryId',child,'replayed',true),'Repeated request returns same child');
  perform pg_temp.ok((select count(*)=1 from public.conversation_deliveries where retry_of=dl),'One child per original');
  perform pg_temp.ok((select a.body=before_ap->>'body'and a.content_hash=before_ap->>'content_hash'and d.state='queued'and a.id<>(before_ap->>'id')::uuid and a.draft_id<>(before_ap->>'draft_id')::uuid from public.conversation_deliveries d join public.conversation_approvals a on a.id=d.approval_id where d.id=child),'New queued approval preserves exact approved text');
  perform pg_temp.ok((select to_jsonb(d)=before_dl and to_jsonb(a)=before_ap and to_jsonb(r)=before_r from public.conversation_deliveries d join public.conversation_approvals a on a.id=d.approval_id join public.conversation_revisions r on r.draft_id=a.draft_id and r.revision=a.revision where d.id=dl),'Original delivery approval and revision unchanged');
  perform pg_temp.ok((select coalesce(jsonb_agg(to_jsonb(attempt)order by attempt.id),'[]')=before_attempts from public.conversation_attempts attempt where attempt.delivery_id=dl),'Original attempt rows remain byte-for-byte unchanged');
  perform pg_temp.ok((select count(*)=1 from public.conversation_audit where kind='delivery.retry_requested'and detail->>'retryOf'=dl::text and detail->>'deliveryId'=child::text and actor_id='d9500000-0000-4000-8000-000000000002'),'Single attributed retry audit');
  perform pg_temp.ok(public.conversation_retry_delivery(child)->>'code'='delivery_not_retryable','Queued child cannot create another send');
  perform pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.conversation_workspace('d9500000-0000-4000-8000-000000000001')->'deliveries')x where x?'retry_of'or x?'can_retry'),'Legacy workspace has no new keys');
  perform pg_temp.ok(exists(select 1 from jsonb_array_elements(public.conversation_retry_workspace('d9500000-0000-4000-8000-000000000001')->'deliveries')x where x->>'id'=child::text and x->>'retry_of'=dl::text),'Opt-in workspace links attempts');
  perform pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.conversation_retry_workspace('d9500000-0000-4000-8000-000000000001')->'deliveries')x where x->>'id'=dl::text and (x->>'can_retry')::boolean),'Superseded original cannot retry');
 end loop;
end$$;
-- A real same-clinic reassignment increments the clinical revision. Both the original
-- approver and the current assigned doctor must refresh clinical context before approval.
savepoint handover;
do $$declare dl uuid:=pg_temp.delivery();begin
 update public.patient_clinical_cases set assigned_doctor_id='d9500000-0000-4000-8000-000000000005',revision=revision+1
 where user_id='d9500000-0000-4000-8000-000000000001';
 perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'code'='stale_context','Real handover revision change blocks original approver retry');
 perform pg_temp.claims(5);
 perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'code'='stale_context','Real handover revision change blocks current doctor retry');
end$$;
rollback to handover;
-- Authority-only synthetic setup: deliberately leave revision unchanged to isolate the
-- same-clinic current/original-approver permission branch from the clinical stale guard.
-- Their fresh grant is checked by the real worker claim entry point, with no provider send.
do $$declare dl uuid:=pg_temp.delivery();child uuid;attempt uuid:=gen_random_uuid();res jsonb;begin
 update public.patient_clinical_cases set assigned_doctor_id='d9500000-0000-4000-8000-000000000005'where user_id='d9500000-0000-4000-8000-000000000001';
 child:=(public.conversation_retry_delivery(dl)->>'deliveryId')::uuid;
 perform pg_temp.ok(child is not null,'Authority-only fixture allows original approver with unchanged clinical revision');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 res:=public.conversation_claim(child,attempt);
 perform pg_temp.ok(res->>'ok'='true'and res#>>'{envelope,body}'='Exact synthetic approved reply','Existing worker claim accepts fresh former-approver authority and exact body');
 perform pg_temp.ok(public.conversation_claim(child,gen_random_uuid())->>'code'='already_claimed_or_held','Worker cannot claim retry twice');
 perform public.conversation_outcome(attempt,'{"kind":"unknown","reason":"Synthetic unresolved outcome"}');
 perform pg_temp.claims();
 perform pg_temp.ok(public.conversation_retry_delivery(child)->>'code'='delivery_not_retryable','Unknown child never retried');
 perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'deliveryId'=child::text,'Parent replay returns same unknown child');
 dl:=pg_temp.delivery();perform pg_temp.claims(5);
 perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'ok'='true','Authority-only fixture allows current doctor with unchanged clinical revision');
end$$;
rollback to handover;
do $$declare dl uuid:=pg_temp.delivery();begin
 update public.patient_clinical_cases set assigned_doctor_id='d9500000-0000-4000-8000-000000000004'where user_id='d9500000-0000-4000-8000-000000000001';
 begin perform public.conversation_retry_delivery(dl);raise exception 'FAIL: former approver after cross-clinic transfer';exception when insufficient_privilege then null;end;
 perform pg_temp.claims(4);
 begin perform public.conversation_retry_delivery(dl);raise exception 'FAIL: current doctor cannot resend old other-clinic approval';exception when insufficient_privilege then null;end;
end$$;
rollback to handover;
savepoint claim_paths;
do $$declare dl uuid:=pg_temp.delivery();child uuid;attempt uuid:=gen_random_uuid();res jsonb;begin
 child:=(public.conversation_retry_delivery(dl)->>'deliveryId')::uuid;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform pg_temp.ok(public.telegram_dispatch_queue(50)->'replies' @> jsonb_build_array(child),'Retry enters existing Telegram dispatcher queue');
 perform pg_temp.ok(public.conversation_claim(child,attempt)->>'ok'='true','Retry claimed through existing worker');
 perform public.conversation_outcome(attempt,'{"kind":"accepted","providerRef":"synthetic-only"}');
 perform pg_temp.claims();
 perform pg_temp.ok(public.conversation_retry_delivery(child)->>'code'='delivery_not_retryable','Accepted descendant cannot be resent');
 perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'deliveryId'=child::text,'Parent replay returns accepted descendant without new child');
end$$;
rollback to claim_paths;
do $$declare dl uuid:=pg_temp.delivery();child uuid;begin
 child:=(public.conversation_retry_delivery(dl)->>'deliveryId')::uuid;
 update public.conversation_endpoints set active=false;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform pg_temp.ok(public.conversation_claim(child,gen_random_uuid())->>'code'='route_unavailable','Worker rechecks route after retry request');
 perform pg_temp.ok(not exists(select 1 from public.conversation_attempts where delivery_id=child),'Lost route never creates transport attempt');
end$$;
rollback to claim_paths;
do $$declare dl uuid:=pg_temp.delivery();child uuid;begin
 child:=(public.conversation_retry_delivery(dl)->>'deliveryId')::uuid;
 update public.conversation_grants set revoked=true where actor_id='d9500000-0000-4000-8000-000000000002';
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform pg_temp.ok(public.conversation_claim(child,gen_random_uuid())->>'code'='approval_authority_lapsed','Worker rechecks revoked retry authority');
 perform pg_temp.ok(not exists(select 1 from public.conversation_attempts where delivery_id=child),'Revoked retry authority never invokes transport');
end$$;
rollback to claim_paths;
-- Exercise actual authenticated SQL role and provider outcome reason projection.
create temp table retry_test_ids(original uuid,child uuid,attempt uuid);
grant all on retry_test_ids to authenticated,service_role;
insert into retry_test_ids(original,attempt)values(pg_temp.delivery(),gen_random_uuid());
select pg_temp.claims();set local role authenticated;
update retry_test_ids set child=(public.conversation_retry_delivery(original)->>'deliveryId')::uuid;
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select pg_temp.ok(public.conversation_claim(child,attempt)->>'ok'='true','Authenticated request enters real worker claim')from retry_test_ids;
select public.conversation_outcome(attempt,'{"kind":"definitely_failed","evidence":"Untrusted provider error must stay private"}')from retry_test_ids;
reset role;select pg_temp.claims();set local role authenticated;
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.conversation_retry_workspace('d9500000-0000-4000-8000-000000000001')->'deliveries')x where x->>'id'=t.child::text and x->>'reason'='provider_definitely_failed'and (x->>'can_retry')::boolean),'Failed attempt reason is visible as safe code and leaf can retry')from retry_test_ids t;
reset role;
-- Known failure evidence is projected through the existing reason key in all read paths.
do $$declare why text;dl uuid;ap uuid;begin
 foreach why in array array['telegram_bot_blocked','telegram_chat_not_found','telegram_message_refused','not_sent_unsupported_payload','Adapter unavailable before invocation']loop
  dl:=pg_temp.delivery();
  insert into public.conversation_attempts(id,delivery_id,state_seq,envelope,outcome,outcome_at)
  values(gen_random_uuid(),dl,0,'{}',jsonb_build_object('kind','definitely_failed','evidence',why),now());
  perform pg_temp.ok(exists(select 1 from jsonb_array_elements(public.conversation_retry_workspace('d9500000-0000-4000-8000-000000000001')->'deliveries')x where x->>'id'=dl::text and x->>'reason'=why),'Allowlisted outcome evidence '||why);
  perform pg_temp.ok(exists(select 1 from jsonb_array_elements(public.conversation_awaiting_replies()->'items')x where x->>'memberId'='d9500000-0000-4000-8000-000000000001'and x->>'latestReason'=why),'Awaiting list uses latest attempt failure');
 end loop;
 update public.workspace_staff set role='admin'where user_id='d9500000-0000-4000-8000-000000000002';
 perform pg_temp.ok(exists(select 1 from jsonb_array_elements(public.telegram_delivery_problems()->'replies')x where x->>'id'=dl::text and x->>'reason'=why),'Operational list exposes allowlisted failure detail');
 perform pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.telegram_delivery_problems()->'replies')x join retry_test_ids t on t.original=(x->>'id')::uuid),'Operational list hides superseded parent');
 update public.workspace_staff set role='doctor'where user_id='d9500000-0000-4000-8000-000000000002';
end$$;
-- A delivery retry must not become a second reply in the member app. Exercise the
-- real member RPC before transport failure, while retry is queued, and after acceptance.
savepoint member_retry_projection;
update public.conversation_policy set app_chat_enabled=true;
do $$declare dl uuid:=pg_temp.delivery('queued');root_ap uuid;child uuid;child_ap uuid;
 attempt uuid:=gen_random_uuid();child_attempt uuid:=gen_random_uuid();before_reply jsonb;before_release jsonb;before_releases jsonb;w jsonb;begin
 select approval_id into root_ap from public.conversation_deliveries where id=dl;
 perform pg_temp.claims(1,'otp');
 w:=public.conversation_member_thread();
 select x into before_reply from jsonb_array_elements(w->'replies')x where x->>'id'=root_ap::text;
 perform pg_temp.ok(w->>'ok'='true'and before_reply->>'text'='Exact synthetic approved reply','Member reads original reply before definite failure');
 select to_jsonb(r)into before_release from public.conversation_app_releases r where approval_id=root_ap;
 select coalesce(jsonb_agg(to_jsonb(r)order by r.approval_id),'[]')into before_releases from public.conversation_app_releases r where member_id='d9500000-0000-4000-8000-000000000001';
 perform pg_temp.ok(before_release->>'reason'='context_current','Original immutable app release exists before retry');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform pg_temp.ok(public.conversation_claim(dl,attempt)->>'ok'='true','Original app-visible reply enters worker claim');
 perform public.conversation_outcome(attempt,'{"kind":"definitely_failed","evidence":"telegram_bot_blocked"}');
 perform pg_temp.claims();
 child:=(public.conversation_retry_delivery(dl)->>'deliveryId')::uuid;
 select approval_id into child_ap from public.conversation_deliveries where id=child;
 perform pg_temp.claims(1,'otp');
 w:=public.conversation_member_thread();
 perform pg_temp.ok((select count(*)=1 and bool_and(x=before_reply)from jsonb_array_elements(w->'replies')x where x->>'id'in(root_ap::text,child_ap::text)),'Queued retry shows one unchanged original member reply identity body doctor and timestamp');
 perform pg_temp.ok((select to_jsonb(r)=before_release from public.conversation_app_releases r where approval_id=root_ap),'Queued retry preserves original app release byte for byte');
 perform pg_temp.ok(exists(select 1 from public.conversation_app_releases where approval_id=child_ap),'Retry app release is retained as immutable history');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform pg_temp.ok(public.conversation_claim(child,child_attempt)->>'ok'='true','App-visible retry uses existing worker claim');
 perform public.conversation_outcome(child_attempt,'{"kind":"accepted","providerRef":"synthetic-member-retry"}');
 perform pg_temp.claims(1,'otp');
 w:=public.conversation_member_thread();
 perform pg_temp.ok((select count(*)=1 and bool_and(x=before_reply)from jsonb_array_elements(w->'replies')x where x->>'id'in(root_ap::text,child_ap::text)),'Accepted retry still shows one unchanged original member reply');
 perform pg_temp.ok((select to_jsonb(r)=before_release from public.conversation_app_releases r where approval_id=root_ap),'Accepted retry preserves original app release');
 perform pg_temp.ok(not exists(select 1 from jsonb_array_elements(before_releases)x where not exists(select 1 from public.conversation_app_releases r where r.approval_id=(x->>'approval_id')::uuid and to_jsonb(r)=x)),'Every prior immutable app release remains unchanged');
 perform pg_temp.ok(not has_function_privilege('authenticated','public._conversation_member_thread_before_retry()','EXECUTE'),'Underlying release/read implementation remains private');
end$$;
rollback to member_retry_projection;
-- Current and legacy timeout observations share the fixed Telegram reason code.
do $$declare why text;dl uuid;begin
 foreach why in array array['telegram_timeout','timeout']loop
  dl:=pg_temp.delivery('unknown');
  insert into public.conversation_attempts(id,delivery_id,state_seq,envelope,outcome,outcome_at)
  values(gen_random_uuid(),dl,0,'{}',jsonb_build_object('kind','unknown','reason',why),now());
  perform pg_temp.ok(exists(select 1 from jsonb_array_elements(public.conversation_retry_workspace('d9500000-0000-4000-8000-000000000001')->'deliveries')x where x->>'id'=dl::text and x->>'reason'='telegram_timeout'),'Unknown timeout projection '||why);
  perform pg_temp.ok(public.conversation_retry_delivery(dl)->>'code'='delivery_not_retryable','Unknown timeout is never resent '||why);
 end loop;
end$$;
-- The schema fence is the concurrent-request last line of defence.
select pg_temp.ok(exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname='conversation_delivery_one_retry'and i.indisunique),'Unique retry edge enforces concurrent at-most-one child');
\echo PASS telegram delivery retry: synthetic authorization, states, context, route, history, idempotence and worker claim (rolled back)
rollback;
