-- Normal synthetic transaction. SQL-role evidence, not remote Auth proof.
begin;
create function pg_temp.conversation_assert(ok boolean,label text)returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
select pg_temp.conversation_assert(to_regprocedure('public.conversation_receive(jsonb,boolean)')is not null,'Durable conversation RPC must exist');
insert into auth.users(id,phone,phone_confirmed_at)values
 ('c4400000-0000-4000-8000-000000000001','37499004401',now()),('c4400000-0000-4000-8000-000000000002',null,null),('c4400000-0000-4000-8000-000000000003',null,null);
insert into public.workspace_clinics(id,name)values('c4400000-0000-4000-8000-000000000004','Synthetic conversation clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('c4400000-0000-4000-8000-000000000002','doctor','Synthetic doctor at approval','c4400000-0000-4000-8000-000000000004'),
 ('c4400000-0000-4000-8000-000000000003','nurse','Synthetic nurse','c4400000-0000-4000-8000-000000000004');
insert into auth.sessions(id,user_id,created_at,updated_at)values
 ('c4400000-0000-4000-8000-000000000005','c4400000-0000-4000-8000-000000000001',now(),now()),
 ('c4400000-0000-4000-8000-000000000006','c4400000-0000-4000-8000-000000000002',now(),now()),
 ('c4400000-0000-4000-8000-000000000007','c4400000-0000-4000-8000-000000000003',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values('c4400000-0000-4000-8000-000000000001','c4400000-0000-4000-8000-000000000002','c4400000-0000-4000-8000-000000000003');
-- Explicit test-only values, never defaults or live clinical/privacy policy.
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-v1',3600,600,60,100,true,true);
create temp table cp(label text primary key,value jsonb);
grant all on cp to authenticated,service_role;
create function pg_temp.member_claims()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"sub":"c4400000-0000-4000-8000-000000000001","role":"authenticated","amr":[{"method":"otp"}],"session_id":"c4400000-0000-4000-8000-000000000005"}',true);end$$;
create function pg_temp.doctor_claims()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"sub":"c4400000-0000-4000-8000-000000000002","role":"authenticated","amr":[{"method":"password"}],"session_id":"c4400000-0000-4000-8000-000000000006"}',true);end$$;
select pg_temp.member_claims();set local role authenticated;
insert into cp values('received',public.conversation_receive('{"requestId":"c4400000-0000-4000-8000-000000000010","text":"Synthetic concern — no clinical advice"}'));
select pg_temp.conversation_assert((value->>'ok')::boolean,'Member message retained')from cp where label='received';
select pg_temp.conversation_assert(public.conversation_receive('{"requestId":"c4400000-0000-4000-8000-000000000010","text":"Synthetic concern — no clinical advice"}')->>'replayed'='true','Same message replay');
select pg_temp.conversation_assert(public.conversation_receive('{"requestId":"c4400000-0000-4000-8000-000000000010","text":"Changed payload"}')->>'code'='request_conflict','Full payload identity');
select pg_temp.conversation_assert(public.conversation_receive('{"requestId":"c4400000-0000-4000-8000-000000000011","text":"x","memberId":"forged"}')->>'code'='invalid_command','No injected member');
reset role;select pg_temp.doctor_claims();set local role authenticated;
insert into cp values('workspace',public.conversation_workspace('c4400000-0000-4000-8000-000000000001'));
insert into cp select 'retired-manual',jsonb_build_object('op','propose','memberId','c4400000-0000-4000-8000-000000000001','requestId','c4400000-0000-4000-8000-000000000098','expectedVersion',1,'clinicalRevision',0,'draftEpoch',(value->>'draftEpoch')::bigint,'source',value->>'sourceToken','body','Delayed manual reply','summary','Delayed factual summary','provenance','{"kind":"staff","engine":"doctor-authored","version":"1","protocolVersion":"not-applicable"}'::jsonb)from cp where label='workspace';
select pg_temp.conversation_assert(public.conversation_recover('c4400000-0000-4000-8000-000000000001',upper(value->>'requestId'),jsonb_set(jsonb_set(value,'{requestId}',to_jsonb(upper(value->>'requestId'))),'{memberId}',to_jsonb(upper(value->>'memberId'))))->>'status'='not-recorded','Uppercase manual compose retired in canonical namespace')from cp where label='retired-manual';
select pg_temp.conversation_assert(public.conversation_compose('c4400000-0000-4000-8000-000000000001',(value->>'requestId')::uuid,1,0,(value->>'draftEpoch')::bigint,value->>'source',value->>'body',value->>'summary')->>'code'='command_retired','Delayed manual compose cannot create a draft')from cp where label='retired-manual';
insert into cp select 'proposed',public.conversation_propose('c4400000-0000-4000-8000-000000000001','c4400000-0000-4000-8000-000000000012',1,0,(value->>'draftEpoch')::bigint,value->>'sourceToken','Synthetic draft only','Private factual summary','{"kind":"synthetic","engine":"deterministic-fixture","version":"1","protocolVersion":"not-clinical"}')from cp where label='workspace';
select pg_temp.conversation_assert((value->>'ok')::boolean,'Captured-source draft proposed')from cp where label='proposed';
insert into cp values('actions',public.conversation_actions('c4400000-0000-4000-8000-000000000001'));
reset role;insert into public.patient_assessments(user_id,answers)values('c4400000-0000-4000-8000-000000000001','{"synthetic":"new evidence"}');
set local role authenticated;select pg_temp.conversation_assert(public.conversation_actions('c4400000-0000-4000-8000-000000000001')->>'code'='stale_context','Changed evidence without case revision invalidates action');
reset role;delete from public.patient_assessments where user_id='c4400000-0000-4000-8000-000000000001';set local role authenticated;
reset role;select pg_temp.member_claims();set local role authenticated;
select pg_temp.conversation_assert(not(public.conversation_workspace(null)?|array['drafts','deliveries','sourceToken','clinicalRevision']),'Member workspace hides private draft');
reset role;select pg_temp.doctor_claims();set local role authenticated;
insert into cp select 'old-approve',jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from jsonb_array_elements(value#>'{view,actions}')x where x->>'purpose'='reply.approve'),'requestId','c4400000000040008000000000000091')from cp where label='actions';
insert into cp select 'retired-summary',jsonb_build_object('op','summary.edit','draftId',value->>'draftId','expectedRevision',1,'summary','Delayed summary')from cp where label='proposed';
select pg_temp.conversation_assert(public.conversation_recover('c4400000-0000-4000-8000-000000000001','C4400000000040008000000000000097',jsonb_set(value,'{draftId}',to_jsonb(upper(value->>'draftId'))))->>'status'='not-recorded','Compact uppercase UUID summary recovery shares execution namespace')from cp where label='retired-summary';
select pg_temp.conversation_assert(public.conversation_edit_summary('c4400000-0000-4000-8000-000000000001','c4400000-0000-4000-8000-000000000097',(value->>'draftId')::uuid,1,'Delayed summary')->>'code'='command_retired','Delayed summary edit cannot create a revision')from cp where label='proposed';
select pg_temp.conversation_assert(public.conversation_edit_summary('c4400000-0000-4000-8000-000000000001','c4400000-0000-4000-8000-000000000098',(value->>'draftId')::uuid,1,'Delayed summary')->>'code'='request_conflict','Same actor/request cannot cross from retired compose to summary edit')from cp where label='proposed';
select pg_temp.conversation_assert(public.conversation_edit_summary('c4400000-0000-4000-8000-000000000001','c4400000-0000-4000-8000-000000000090',(value->>'draftId')::uuid,1,'Doctor-corrected private factual summary')->>'revision'='2','Summary edit has an immutable revision')from cp where label='proposed';
select pg_temp.conversation_assert(public.conversation_command(value)->>'code'='intent_invalidated','Summary edit invalidates old exact approval')from cp where label='old-approve';
select pg_temp.conversation_assert(public.conversation_propose('c4400000-0000-4000-8000-000000000001','c4400000-0000-4000-8000-000000000092',1,0,(value->>'draftEpoch')::bigint,value->>'sourceToken','Late engine reply','Late engine summary','{"kind":"synthetic","engine":"fixture","version":"1","protocolVersion":"not-clinical"}')->>'code'='stale_context','Late AI cannot overwrite doctor summary with unchanged transcript/source')from cp where label='workspace';
update cp set value=public.conversation_actions('c4400000-0000-4000-8000-000000000001')where label='actions';
insert into cp select 'edit-command',jsonb_build_object('schema',1,'purpose','reply.edit','intentId',(select x->>'intentId'from jsonb_array_elements(value#>'{view,actions}')x where x->>'purpose'='reply.edit'),'requestId','c4400000000040008000000000000013','body','Exact doctor-edited synthetic reply')from cp where label='actions';
insert into cp select 'edited',public.conversation_command(value)from cp where label='edit-command';
select pg_temp.conversation_assert((value->>'ok')::boolean and value->>'revision'='3','Doctor edit creates revision')from cp where label='edited';
update cp set value=public.conversation_actions('c4400000-0000-4000-8000-000000000001')where label='actions';
insert into cp select 'approve-command',jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from jsonb_array_elements(value#>'{view,actions}')x where x->>'purpose'='reply.approve'),'requestId','c4400000000040008000000000000014')from cp where label='actions';
select pg_temp.conversation_assert(public.conversation_recover('c4400000-0000-4000-8000-000000000001','c4400000000040008000000000000099',jsonb_set(value,'{requestId}','"c4400000000040008000000000000099"'))->>'status'='not-recorded','Recovery retires delayed approval under same request lock')from cp where label='approve-command';
select pg_temp.conversation_assert(public.conversation_command(jsonb_set(value,'{requestId}','"c4400000000040008000000000000099"'))->>'code'='command_retired','Delayed original approval cannot execute after definitive recovery')from cp where label='approve-command';
insert into cp select 'approved',public.conversation_command(value)from cp where label='approve-command';
select pg_temp.conversation_assert(public.conversation_recover('c4400000-0000-4000-8000-000000000001',value->>'requestId',value)->>'status'='recorded','Delayed original commits; recovery reads receipt only')from cp where label='approve-command';
select pg_temp.conversation_assert((value->>'ok')::boolean,'Exact current reply approved')from cp where label='approved';
select pg_temp.conversation_assert(public.conversation_command(value)->>'replayed'='true','Approval replay')from cp where label='approve-command';
reset role;
select pg_temp.conversation_assert((select count(*)=1 from public.conversation_approvals),'One approval');
select pg_temp.conversation_assert((select body='Exact doctor-edited synthetic reply' and doctor_name='Synthetic doctor at approval'from public.conversation_approvals),'Frozen exact body and actor');
select pg_temp.conversation_assert((select state='held'from public.conversation_deliveries),'Missing route never sends');
select pg_temp.conversation_assert((select count(*)=3 from public.conversation_revisions),'Immutable revision history');
select set_config('request.jwt.claims','{"sub":"c4400000-0000-4000-8000-000000000003","role":"authenticated","amr":[{"method":"password"}],"session_id":"c4400000-0000-4000-8000-000000000007"}',true);
set local role authenticated;
select pg_temp.conversation_assert(not(public.conversation_intake_workspace('c4400000-0000-4000-8000-000000000001')?|array['drafts','deliveries','sourceToken']),'Assigned nurse intake excludes clinical review');
do $$begin perform public.conversation_actions('c4400000-0000-4000-8000-000000000001');raise exception 'Nurse cannot approve';exception when insufficient_privilege then null;end$$;
reset role;
-- A separately configured recording endpoint exercises claim durability; no provider exists.
insert into public.conversation_endpoints(id,member_id,adapter,account_ref,principal_ref,address,generation,active,policy_version,expires_at,max_utf16)
 values('c4400000-0000-4000-8000-000000000020','c4400000-0000-4000-8000-000000000001','recording','synthetic-account','synthetic-principal','synthetic-address',1,true,'synthetic-v1',clock_timestamp()+interval '1 hour',10000);
-- Test policy permits only the explicitly provisioned recording endpoint.
-- Test fixture config occurs before a second fresh approval, never requeues the held reply.
select pg_temp.member_claims();set local role authenticated;
select public.conversation_receive('{"requestId":"c4400000-0000-4000-8000-000000000021","text":"Synthetic follow-up"}');
reset role;select pg_temp.doctor_claims();set local role authenticated;
update cp set value=public.conversation_workspace('c4400000-0000-4000-8000-000000000001')where label='workspace';
select pg_temp.conversation_assert(public.conversation_propose('c4400000-0000-4000-8000-000000000001','c4400000-0000-4000-8000-000000000022',1,0,(value->>'draftEpoch')::bigint,value->>'sourceToken','Stale AI output','Private stale summary','{"kind":"synthetic","engine":"fixture","version":"1","protocolVersion":"not-clinical"}')->>'code'='stale_context','Stale AI result rejected')from cp where label='workspace';
select public.conversation_compose('c4400000-0000-4000-8000-000000000001','c4400000-0000-4000-8000-000000000023',2,0,(value->>'draftEpoch')::bigint,value->>'sourceToken','Second exact reply','Private second summary')from cp where label='workspace';
update cp set value=public.conversation_actions('c4400000-0000-4000-8000-000000000001')where label='actions';
update cp set value=jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from cp p,jsonb_array_elements(p.value#>'{view,actions}')x where p.label='actions'and x->>'purpose'='reply.approve'),'requestId','c4400000000040008000000000000024')where label='approve-command';
update cp set value=public.conversation_command((select value from cp where label='approve-command'))where label='approved';
reset role;
select pg_temp.conversation_assert((select r.author_kind='staff'and r.provenance->>'kind'='staff'from public.conversation_revisions r join public.conversation_approvals a on a.draft_id=r.draft_id and a.revision=r.revision where a.id=(select(value->>'approvalId')::uuid from cp where label='approved')),'Manual doctor draft uses derived staff provenance');
update public.workspace_staff set display_name='Doctor renamed later'where user_id='c4400000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
insert into cp select 'claim',public.conversation_claim((value->>'deliveryId')::uuid,'c4400000-0000-4000-8000-000000000025')from cp where label='approved';
select pg_temp.conversation_assert(value->>'fresh'='true'and value#>>'{envelope,approvedBy,displayName}'='Synthetic doctor at approval','Committed claim freezes original attribution')from cp where label='claim';
select pg_temp.conversation_assert(public.conversation_claim((value->>'deliveryId')::uuid,'c4400000-0000-4000-8000-000000000025')->>'ok'='false','Same attempt cannot invoke again')from cp where label='approved';
select public.conversation_reconcile('c4400000-0000-4000-8000-000000000025');
select pg_temp.conversation_assert(public.conversation_outcome('c4400000-0000-4000-8000-000000000025','{"kind":"accepted","providerRef":"late-synthetic"}')->>'result'='late','Late acceptance fenced');
reset role;
select pg_temp.conversation_assert((select state='unknown'from public.conversation_deliveries where id=(select(value->>'deliveryId')::uuid from cp where label='approved')),'Unknown not reopened');
select pg_temp.conversation_assert((select count(*)=1 from public.conversation_attempts),'One durable attempt');
select pg_temp.conversation_assert((select count(*)=1 from public.conversation_audit where kind='delivery.late_outcome'),'Late evidence retained');
select pg_temp.member_claims();set local role authenticated;
select pg_temp.conversation_assert(public.conversation_workspace(null)#>>'{replies,0,body}'='Second exact reply'and public.conversation_workspace(null)#>>'{replies,0,deliveryState}'='unknown','Member sees frozen approved history with honest uncertainty');
select pg_temp.conversation_assert(jsonb_array_length(public.conversation_workspace(null)->'replies')=1,'Held unpublished reply stays hidden');
reset role;
rollback;
