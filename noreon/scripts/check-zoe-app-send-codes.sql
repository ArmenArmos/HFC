-- Zoe app send (18 Oct): a member's live session renews its own lapsed or outdated conversation grant,
-- every permanent refusal is a code, and staff grants keep their strictness. Rolled back.
-- Synthetic fixtures only; no Telegram network, provider or model.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text,sid text,method text default 'otp')returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method',method)),'session_id',sid)::text,true);end$$;
create function pg_temp.send(m text,sid text,rid text,txt text,method text default 'otp')returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(m,sid,method);set local role authenticated;j:=public.conversation_receive(jsonb_build_object('requestId',rid,'text',txt));reset role;return j;end$$;
-- The doctor's own workspace read of the member (staff path through the same grant code).
create function pg_temp.staff_read(d text,sid text,m text,amr jsonb default '[{"method":"password"}]')returns text language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',d,'role','authenticated','amr',amr,'session_id',sid)::text,true);
 set local role authenticated;perform public.conversation_workspace(m::uuid);reset role;return 'ok';
exception when insufficient_privilege then reset role;return 'refused';end$$;

-- M: member; N: member without a clinical case; U: member with an unconfirmed phone; D: assigned doctor.
insert into auth.users(id,phone,phone_confirmed_at)values('a7100000-0000-4000-8000-000000000001','37499071001',now()),('a7100000-0000-4000-8000-000000000003','37499071003',now()),
 ('a7100000-0000-4000-8000-000000000004','37499071004',null),('a7100000-0000-4000-8000-000000000002',null,null);
insert into public.workspace_clinics(id,name)values('a7100000-0000-4000-8000-000000000009','Synthetic send codes clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('a7100000-0000-4000-8000-000000000002','doctor','Dr Send Synthetic','a7100000-0000-4000-8000-000000000009');
insert into auth.sessions(id,user_id,created_at,updated_at)values('a7100000-0000-4000-8000-000000000011','a7100000-0000-4000-8000-000000000001',now(),now()),
 ('a7100000-0000-4000-8000-000000000012','a7100000-0000-4000-8000-000000000002',now(),now()),('a7100000-0000-4000-8000-000000000013','a7100000-0000-4000-8000-000000000003',now(),now()),
 ('a7100000-0000-4000-8000-000000000014','a7100000-0000-4000-8000-000000000004',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000002');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'synthetic-send-v1',3600,600,60,50,false,true,true);

-- 1. Coded refusals, checked before authorization: nothing stored, no grant made.
select pg_temp.ok(pg_temp.send('a7100000-0000-4000-8000-000000000003','a7100000-0000-4000-8000-000000000013','a7100000-0000-4000-8000-0000000000a1','Before my review request')->>'code'='needs_review_request','No clinical case: needs_review_request');
select pg_temp.ok(pg_temp.send('a7100000-0000-4000-8000-000000000004','a7100000-0000-4000-8000-000000000014','a7100000-0000-4000-8000-0000000000a2','Unconfirmed phone')->>'code'='not_eligible','Unconfirmed phone: not_eligible');
select pg_temp.ok(pg_temp.send('a7100000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000012','a7100000-0000-4000-8000-0000000000a3','Staff as member','password')->>'code'='not_eligible','Staff: not_eligible');
select pg_temp.ok(not exists(select 1 from public.conversation_grants where actor_id in('a7100000-0000-4000-8000-000000000003','a7100000-0000-4000-8000-000000000004')),'Refused before a grant exists');
-- An eligible member whose auth session is gone is told to sign in again.
select pg_temp.ok(pg_temp.send('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-0000000000ff','a7100000-0000-4000-8000-0000000000a4','Ended session')->>'code'='sign_in_again','Unknown session: sign_in_again');

-- 2. A normal send, then its replay.
select pg_temp.ok(pg_temp.send('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000011','a7100000-0000-4000-8000-0000000000b1','First message')->>'ok'='true','Member send stored');
create temp table g0 as select id,generation from public.conversation_grants where actor_id='a7100000-0000-4000-8000-000000000001';
select pg_temp.ok((select count(*)=1 from g0),'One member grant');

-- 3. The prod failure: the grant expired an hour into the session. The same session sends again.
update public.conversation_grants set expires_at=now()-interval '1 second'where actor_id='a7100000-0000-4000-8000-000000000001';
select pg_temp.ok(pg_temp.send('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000011','a7100000-0000-4000-8000-0000000000b2','After expiry')->>'ok'='true','Expired member grant renewed: send works');
select pg_temp.ok((select expires_at>now()from public.conversation_grants where actor_id='a7100000-0000-4000-8000-000000000001'),'New expiry');

-- 4. The policy version changed (app chat switched on): the same session still sends.
update public.conversation_policy set version='synthetic-send-v2';
select pg_temp.ok(pg_temp.send('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000011','a7100000-0000-4000-8000-0000000000b3','After policy change')->>'ok'='true','Stale policy version renewed: send works');
select pg_temp.ok((select policy_version='synthetic-send-v2'from public.conversation_grants where actor_id='a7100000-0000-4000-8000-000000000001'),'Grant carries the current policy');
-- The amr of the session changed (another sign-in method): renewed with the session's amr.
select pg_temp.ok(pg_temp.send('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000011','a7100000-0000-4000-8000-0000000000b4','After amr change','password')->>'ok'='true','Different amr renewed: send works');
select pg_temp.ok((select amr->0->>'method'='password'from public.conversation_grants where actor_id='a7100000-0000-4000-8000-000000000001'),'Grant carries the session amr');
-- Same grant row, same generation: replay keys survive the refresh.
select pg_temp.ok((select g.id=g0.id and g.generation=g0.generation from public.conversation_grants g join g0 on true where g.actor_id='a7100000-0000-4000-8000-000000000001'),'Refresh keeps grant id and generation');

-- 5. Replay across a refresh: the first request replays, never stores twice.
update public.conversation_grants set expires_at=now()-interval '1 second'where actor_id='a7100000-0000-4000-8000-000000000001';
select pg_temp.ok((pg_temp.send('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000011','a7100000-0000-4000-8000-0000000000b1','First message')->>'replayed')::boolean,'Retry after refresh replays');
select pg_temp.ok((select count(*)=1 from public.conversation_messages where body='First message'),'Replay stored once');
select pg_temp.ok(pg_temp.send('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000011','a7100000-0000-4000-8000-0000000000b1','Different text')->>'code'='request_conflict','Same id, other text: conflict');
select pg_temp.ok((select count(*)=4 from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='a7100000-0000-4000-8000-000000000001'),'Four member messages stored');

-- 6. A revoked grant (sign out) is never renewed.
select pg_temp.as_user('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000011');
set local role authenticated;select public.conversation_revoke_grant();reset role;
select pg_temp.ok(pg_temp.send('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000011','a7100000-0000-4000-8000-0000000000c1','After sign out')->>'code'='sign_in_again','Revoked grant: sign_in_again');
select pg_temp.ok((select revoked from public.conversation_grants where actor_id='a7100000-0000-4000-8000-000000000001'),'Still revoked');
select pg_temp.ok(not exists(select 1 from public.conversation_messages where body='After sign out'),'Nothing stored after sign out');
-- The auth session ended (not_after passed): refused, not renewed.
insert into auth.sessions(id,user_id,created_at,updated_at)values('a7100000-0000-4000-8000-000000000021','a7100000-0000-4000-8000-000000000001',now(),now());
select pg_temp.ok(pg_temp.send('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000021','a7100000-0000-4000-8000-0000000000c2','New session')->>'ok'='true','A new session gets its own grant');
update public.conversation_grants set expires_at=now()-interval '1 second'where session_id='a7100000-0000-4000-8000-000000000021';
update auth.sessions set not_after=now()-interval '1 second'where id='a7100000-0000-4000-8000-000000000021';
select pg_temp.ok(pg_temp.send('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000021','a7100000-0000-4000-8000-0000000000c3','Ended session')->>'code'='sign_in_again','Ended auth session: sign_in_again');
select pg_temp.ok((select expires_at<=now()from public.conversation_grants where session_id='a7100000-0000-4000-8000-000000000021'),'Ended session grant not renewed');
-- A renewed expiry never outlives the auth session.
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)values('a7100000-0000-4000-8000-000000000022','a7100000-0000-4000-8000-000000000001',now(),now(),now()+interval '5 minutes');
select pg_temp.send('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000022','a7100000-0000-4000-8000-0000000000c4','Short session');
update public.conversation_grants set expires_at=now()-interval '1 second'where session_id='a7100000-0000-4000-8000-000000000022';
select pg_temp.ok(pg_temp.send('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000022','a7100000-0000-4000-8000-0000000000c5','Short session again')->>'ok'='true','Short session renewed');
select pg_temp.ok((select expires_at<=now()+interval '5 minutes'from public.conversation_grants where session_id='a7100000-0000-4000-8000-000000000022'),'Renewal capped by not_after');

-- 7. Staff (lead decision 18 Oct 11:43): renewed on a live session only after every staff check passed.
select pg_temp.ok(pg_temp.staff_read('a7100000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000012','a7100000-0000-4000-8000-000000000001')='ok','Doctor reads with a fresh grant');
create temp table d0 as select id,generation from public.conversation_grants where actor_id='a7100000-0000-4000-8000-000000000002';
-- Expired an hour into the session, allowed amr: renewed, same id and generation.
update public.conversation_grants set expires_at=now()-interval '1 second'where actor_id='a7100000-0000-4000-8000-000000000002';
select pg_temp.ok(pg_temp.staff_read('a7100000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000012','a7100000-0000-4000-8000-000000000001')='ok','Expired doctor grant on a live session: renewed');
select pg_temp.ok((select g.expires_at>now()and g.id=d0.id and g.generation=d0.generation from public.conversation_grants g join d0 on d0.id=g.id),'Doctor renewal keeps id and generation');
-- Outdated policy version: renewed.
update public.conversation_policy set version='synthetic-send-v3';
select pg_temp.ok(pg_temp.staff_read('a7100000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000012','a7100000-0000-4000-8000-000000000001')='ok','Outdated doctor policy: renewed');
select pg_temp.ok((select policy_version='synthetic-send-v3'from public.conversation_grants where actor_id='a7100000-0000-4000-8000-000000000002'),'Doctor grant on the current policy');
-- Fable F2: a policy change fences staff authority issued under the old policy.
select pg_temp.ok((select g.generation=d0.generation+1 from public.conversation_grants g join d0 on d0.id=g.id),'Doctor policy change bumps the generation');
-- The sign-in method changed (still allowed): renewed with a generation bump, so earlier intents and approvals no longer claim.
select pg_temp.ok(pg_temp.staff_read('a7100000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000012','a7100000-0000-4000-8000-000000000001','[{"method":"password"},{"method":"otp"}]')='ok','Doctor amr change (allowed): renewed');
select pg_temp.ok((select g.generation=d0.generation+2 from public.conversation_grants g join d0 on d0.id=g.id),'Doctor amr change bumps the generation');
-- A recovery amr is refused and changes nothing.
create temp table d1 as select id,generation,amr,expires_at from public.conversation_grants where actor_id='a7100000-0000-4000-8000-000000000002';
update public.conversation_grants set expires_at=now()-interval '1 second'where actor_id='a7100000-0000-4000-8000-000000000002';
select pg_temp.ok(pg_temp.staff_read('a7100000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000012','a7100000-0000-4000-8000-000000000001','[{"method":"password"},{"method":"recovery"}]')='refused','Recovery amr: refused');
select pg_temp.ok(pg_temp.staff_read('a7100000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000012','a7100000-0000-4000-8000-000000000001','[{"method":"otp"}]')='refused','Amr without password: refused');
select pg_temp.ok((select g.expires_at<=now()and g.amr=d1.amr and g.generation=d1.generation from public.conversation_grants g join d1 on d1.id=g.id),'Refused staff call renews nothing');
-- A deactivated doctor is refused and not renewed.
update public.workspace_staff set active=false where user_id='a7100000-0000-4000-8000-000000000002';
select pg_temp.ok(pg_temp.staff_read('a7100000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000012','a7100000-0000-4000-8000-000000000001','[{"method":"password"},{"method":"otp"}]')='refused','Deactivated doctor: refused');
select pg_temp.ok((select expires_at<=now()from public.conversation_grants where actor_id='a7100000-0000-4000-8000-000000000002'),'Deactivated doctor not renewed');
update public.workspace_staff set active=true where user_id='a7100000-0000-4000-8000-000000000002';
-- A doctor no longer assigned is refused and not renewed.
update public.patient_clinical_cases set assigned_doctor_id=null where user_id='a7100000-0000-4000-8000-000000000001';
select pg_temp.ok(pg_temp.staff_read('a7100000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000012','a7100000-0000-4000-8000-000000000001','[{"method":"password"},{"method":"otp"}]')='refused','Unassigned doctor: refused');
select pg_temp.ok((select expires_at<=now()from public.conversation_grants where actor_id='a7100000-0000-4000-8000-000000000002'),'Unassigned doctor not renewed');
update public.patient_clinical_cases set assigned_doctor_id='a7100000-0000-4000-8000-000000000002' where user_id='a7100000-0000-4000-8000-000000000001';
-- An ended auth session is refused and not renewed.
update auth.sessions set not_after=now()-interval '1 second'where id='a7100000-0000-4000-8000-000000000012';
select pg_temp.ok(pg_temp.staff_read('a7100000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000012','a7100000-0000-4000-8000-000000000001','[{"method":"password"},{"method":"otp"}]')='refused','Ended doctor session: refused');
select pg_temp.ok((select expires_at<=now()from public.conversation_grants where actor_id='a7100000-0000-4000-8000-000000000002'),'Ended doctor session not renewed');
update auth.sessions set not_after=null where id='a7100000-0000-4000-8000-000000000012';
-- Signed out (revoked): refused, stays revoked.
select pg_temp.ok(pg_temp.staff_read('a7100000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000012','a7100000-0000-4000-8000-000000000001','[{"method":"password"},{"method":"otp"}]')='ok','Live session again: renewed');
select pg_temp.as_user('a7100000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000012','password');
set local role authenticated;select public.conversation_revoke_grant();reset role;
select pg_temp.ok(pg_temp.staff_read('a7100000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000012','a7100000-0000-4000-8000-000000000001','[{"method":"password"},{"method":"otp"}]')='refused','Revoked doctor grant: refused');
select pg_temp.ok((select revoked from public.conversation_grants where actor_id='a7100000-0000-4000-8000-000000000002'),'Doctor grant stays revoked');
-- Delivery never renews: conversation_claim checks the approving grant with create_grant=false.
update public.conversation_grants set revoked=false,expires_at=now()-interval '1 second'where actor_id='a7100000-0000-4000-8000-000000000002';
do $$begin
 perform public._conversation_authorize('a7100000-0000-4000-8000-000000000001'::uuid,'a7100000-0000-4000-8000-000000000002'::uuid,'a7100000-0000-4000-8000-000000000012'::uuid,(select amr from public.conversation_grants where actor_id='a7100000-0000-4000-8000-000000000002'),true,false);
 raise exception 'FAIL: claim-style check renewed an expired grant';
exception when insufficient_privilege then null;end$$;
select pg_temp.ok((select expires_at<=now()from public.conversation_grants where actor_id='a7100000-0000-4000-8000-000000000002'),'create_grant=false never renews');
-- The member keeps sending across the same policy change.
select pg_temp.ok(pg_temp.send('a7100000-0000-4000-8000-000000000001','a7100000-0000-4000-8000-000000000022','a7100000-0000-4000-8000-0000000000c6','After v3')->>'ok'='true','Member renewed across v3');
-- A doctor through the member path (no case of their own) is refused.
select pg_temp.ok(pg_temp.staff_read('a7100000-0000-4000-8000-000000000002','a7100000-0000-4000-8000-000000000012','a7100000-0000-4000-8000-000000000002')='refused','Doctor as own member refused');

select 'zoe app send codes: all checks passed';
rollback;
