-- Test accounts and "Reset test account": only an admin flags; an admin or qa resets flagged member
-- accounts only; doctor, nurse, clinic, member and anon are refused; qa sees no real member data;
-- a reset keeps every row, unlinks Telegram, ends sessions, audits, and is idempotent per click.
-- Synthetic fixtures, rolled back.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.refused(sql text)returns text language plpgsql as $$begin execute sql;return 'ran';exception when others then return sqlstate;end$$;
create function pg_temp.val(sql text)returns text language plpgsql as $$declare v text;begin execute sql into v;return coalesce(v,'<null>');exception when others then return 'ERR '||sqlstate;end$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.as_user(text,text),pg_temp.refused(text),pg_temp.val(text)to authenticated,anon;

-- Members: T (test, Telegram linked, 2 sessions), R (real). Staff: admin A, qa Q, doctor D, nurse N,
-- clinic desk C, removed qa X, qa without a live session Y.
insert into auth.users(id,phone,phone_confirmed_at)values
 ('a7000000-0000-4000-8000-000000000001','37499018101',now()),('a7000000-0000-4000-8000-000000000002','37499018102',now()),
 ('a7000000-0000-4000-8000-000000000011',null,null),('a7000000-0000-4000-8000-000000000012',null,null),('a7000000-0000-4000-8000-000000000013',null,null),
 ('a7000000-0000-4000-8000-000000000014',null,null),('a7000000-0000-4000-8000-000000000015',null,null),('a7000000-0000-4000-8000-000000000016',null,null),
 ('a7000000-0000-4000-8000-000000000017',null,null);
insert into public.workspace_clinics(id,name)values('a7000000-0000-4000-8000-000000000030','Synthetic test-account clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id,active,removed_at)values
 ('a7000000-0000-4000-8000-000000000011','admin','Admin Tester',null,true,null),
 ('a7000000-0000-4000-8000-000000000012','qa','QA Tester',null,true,null),
 ('a7000000-0000-4000-8000-000000000013','doctor','Dr Tester','a7000000-0000-4000-8000-000000000030',true,null),
 ('a7000000-0000-4000-8000-000000000014','nurse','Nurse Tester','a7000000-0000-4000-8000-000000000030',true,null),
 ('a7000000-0000-4000-8000-000000000016','qa','Removed QA',null,false,now()),
 ('a7000000-0000-4000-8000-000000000017','qa','Sessionless QA',null,true,null);
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name)values('a7000000-0000-4000-8000-000000000015','a7000000-0000-4000-8000-000000000030','Clinic Desk');
insert into auth.sessions(id,user_id,created_at,updated_at)values
 ('a7000000-0000-4000-8000-000000000101','a7000000-0000-4000-8000-000000000001',now(),now()),('a7000000-0000-4000-8000-000000000102','a7000000-0000-4000-8000-000000000001',now(),now()),
 ('a7000000-0000-4000-8000-000000000103','a7000000-0000-4000-8000-000000000002',now(),now()),
 ('a7000000-0000-4000-8000-000000000111','a7000000-0000-4000-8000-000000000011',now(),now()),('a7000000-0000-4000-8000-000000000112','a7000000-0000-4000-8000-000000000012',now(),now()),
 ('a7000000-0000-4000-8000-000000000113','a7000000-0000-4000-8000-000000000013',now(),now()),('a7000000-0000-4000-8000-000000000114','a7000000-0000-4000-8000-000000000014',now(),now()),
 ('a7000000-0000-4000-8000-000000000115','a7000000-0000-4000-8000-000000000015',now(),now()),('a7000000-0000-4000-8000-000000000116','a7000000-0000-4000-8000-000000000016',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000013'),('a7000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000013');
update public.profiles set display_name='Test Member' where id='a7000000-0000-4000-8000-000000000001';
update public.profiles set display_name='Real Member' where id='a7000000-0000-4000-8000-000000000002';
insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation)values
 ('a7000000-0000-4000-8000-000000000001','member','fictional-ta-principal','fictional-ta-account','+37499018101','5550101',1);

-- Constraints: qa never has a clinic.
select pg_temp.ok(pg_temp.refused($$insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('a7000000-0000-4000-8000-000000000015','qa','Clinic QA','a7000000-0000-4000-8000-000000000030')$$)='23514','qa with a clinic is refused');

set local role authenticated;

-- 1. A member cannot flag their own profile, and keeps editing their name.
select pg_temp.as_user('a7000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000103');
select pg_temp.ok(pg_temp.refused($$update public.profiles set is_test_account=true where id='a7000000-0000-4000-8000-000000000002'$$)='42501','member cannot set the flag');
select pg_temp.ok(pg_temp.refused($$update public.profiles set test_account_reset_count=5 where id='a7000000-0000-4000-8000-000000000002'$$)='42501','member cannot set reset fields');
-- Members have no UPDATE grant on profiles today; the trigger still refuses the flag if one is ever added.
reset role;grant update on public.profiles to authenticated;set local role authenticated;
select pg_temp.ok(pg_temp.refused($$update public.profiles set is_test_account=true where id='a7000000-0000-4000-8000-000000000002'$$)='42501','trigger refuses the flag with an update grant');
select pg_temp.ok(pg_temp.refused($$update public.profiles set display_name='Real Member' where id='a7000000-0000-4000-8000-000000000002'$$)='ran','other profile fields still update');
reset role;revoke update on public.profiles from authenticated;set local role authenticated;

-- 2. Only an admin flags; staff and clinic accounts cannot be flagged.
select pg_temp.as_user('a7000000-0000-4000-8000-000000000012','a7000000-0000-4000-8000-000000000112');
select pg_temp.ok(pg_temp.refused($$select public.admin_set_test_account('a7000000-0000-4000-8000-000000000001',true,'QA tester account')$$)='42501','qa cannot flag');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000013','a7000000-0000-4000-8000-000000000113');
select pg_temp.ok(pg_temp.refused($$select public.admin_set_test_account('a7000000-0000-4000-8000-000000000001',true,'QA tester account')$$)='42501','doctor cannot flag');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-000000000111');
select pg_temp.ok(pg_temp.refused($$select public.admin_set_test_account('a7000000-0000-4000-8000-000000000013',true,'Staff account')$$)='42501','a doctor account cannot be flagged');
select pg_temp.ok(pg_temp.refused($$select public.admin_set_test_account('a7000000-0000-4000-8000-000000000015',true,'Clinic account')$$)='42501','a clinic account cannot be flagged');
select pg_temp.ok(pg_temp.refused($$select public.admin_set_test_account('a7000000-0000-4000-8000-000000000001',true,'x')$$)='22023','a reason is required');
select pg_temp.ok((public.admin_set_test_account('a7000000-0000-4000-8000-000000000001',true,'QA tester account')->>'changed')::boolean,'admin flags the test member');
select pg_temp.ok(not(public.admin_set_test_account('a7000000-0000-4000-8000-000000000001',true,'QA tester account')->>'changed')::boolean,'flagging twice changes nothing');
select pg_temp.ok(public.test_account_operator_identity()->>'role'='admin','admin is an operator');

-- 3. Everyone else is refused the operator functions: doctor, nurse, clinic, member, removed qa,
--    qa without a live session, anon.
do $$declare who text[];begin
 foreach who slice 1 in array array[
  ['a7000000-0000-4000-8000-000000000013','a7000000-0000-4000-8000-000000000113'],['a7000000-0000-4000-8000-000000000014','a7000000-0000-4000-8000-000000000114'],
  ['a7000000-0000-4000-8000-000000000015','a7000000-0000-4000-8000-000000000115'],['a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000101'],
  ['a7000000-0000-4000-8000-000000000016','a7000000-0000-4000-8000-000000000116'],['a7000000-0000-4000-8000-000000000017','a7000000-0000-4000-8000-000000000199']]
 loop
  perform pg_temp.as_user(who[1],who[2]);
  perform pg_temp.ok(public.test_account_operator_identity()is null,'no operator identity for '||who[1]);
  perform pg_temp.ok(pg_temp.refused($q$select public.test_accounts_list()$q$)='42501','list refused for '||who[1]);
  perform pg_temp.ok(pg_temp.refused($q$select public.test_account_reset_begin('a7000000-0000-4000-8000-000000000001',gen_random_uuid())$q$)='42501','reset refused for '||who[1]);
 end loop;
end$$;
select set_config('request.jwt.claims','{"role":"anon"}',true);
reset role;set local role anon;
select pg_temp.ok(pg_temp.refused($$select public.test_account_reset_begin('a7000000-0000-4000-8000-000000000001',gen_random_uuid())$$)='42501','anon cannot reset');
select pg_temp.ok(pg_temp.refused($$select public.staff_test_account_flags(array['a7000000-0000-4000-8000-000000000001'::uuid])$$)='42501','anon cannot read flags');
reset role;set local role authenticated;

-- 4. qa sees only test accounts and no real member data.
select pg_temp.as_user('a7000000-0000-4000-8000-000000000012','a7000000-0000-4000-8000-000000000112');
select pg_temp.ok(public.test_account_operator_identity()->>'role'='qa','qa is an operator');
select pg_temp.ok((public.staff_signin_state()->>'staffEligible')::boolean and (public.staff_signin_state()->>'eligible')::boolean,'qa may take the staff Telegram sign-in step (RESET-02)');
select pg_temp.ok(public.real_clinical_staff_identity()is null,'qa has no clinical staff identity');
select pg_temp.ok(jsonb_array_length(public.test_accounts_list())=1 and public.test_accounts_list()->0->>'id'='a7000000-0000-4000-8000-000000000001','qa lists only the test account');
select pg_temp.ok(public.test_accounts_list()->0->>'phoneEnding'='101' and (public.test_accounts_list()->0->>'telegramLinked')::boolean,'list shows phone ending and Telegram');
select pg_temp.ok(position('a7000000-0000-4000-8000-000000000002' in pg_temp.val($$select public.patient_clinical_case_search('')::text$$))=0,'qa search shows no real member');
select pg_temp.ok(pg_temp.val($$select public.patient_clinical_case_snapshot('a7000000-0000-4000-8000-000000000002')::text$$) like 'ERR%','qa cannot read a real member snapshot');
select pg_temp.ok(pg_temp.val($$select public.patient_clinical_case_snapshot('a7000000-0000-4000-8000-000000000001')::text$$) like 'ERR%','qa cannot read a test member snapshot either');
select pg_temp.ok(pg_temp.refused($$select public.staff_record_member_access('a7000000-0000-4000-8000-000000000002','member_history',null)$$)='42501','qa cannot record member access');
select pg_temp.ok(position('a7000000-0000-4000-8000-000000000002' in pg_temp.val($$select public.patient_coordination_members(null,null,null,50)::text$$))=0,'qa coordination list shows no real member');
select pg_temp.ok(pg_temp.val($$select public.admin_conversation_list()::text$$) like 'ERR%' or position('a7000000-0000-4000-8000-000000000002' in pg_temp.val($$select public.admin_conversation_list()::text$$))=0,'qa reads no conversations');
select pg_temp.ok(pg_temp.val($$select (select count(*) from public.profiles where id='a7000000-0000-4000-8000-000000000002')::text$$)='0','qa cannot read real profiles through RLS');
select pg_temp.ok(pg_temp.refused($$select public.test_account_reset_begin('a7000000-0000-4000-8000-000000000002',gen_random_uuid())$$)='42501','qa cannot reset a real account');

-- 5. The TEST badge: staff learn only which of the given members are test accounts.
select pg_temp.as_user('a7000000-0000-4000-8000-000000000013','a7000000-0000-4000-8000-000000000113');
select pg_temp.ok(public.staff_test_account_flags(array['a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000002']::uuid[])=array['a7000000-0000-4000-8000-000000000001'::uuid],'doctor sees the TEST flag');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000103');
select pg_temp.ok(pg_temp.refused($$select public.staff_test_account_flags(array['a7000000-0000-4000-8000-000000000001'::uuid])$$)='42501','a member cannot read flags');

-- 6. qa resets the test account; the same click again is the same reset; nothing is deleted.
select pg_temp.as_user('a7000000-0000-4000-8000-000000000012','a7000000-0000-4000-8000-000000000112');
create temp table r1 on commit drop as select public.test_account_reset_begin('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-0000000000f1')j;
select pg_temp.ok((select j->>'placeholder' ~ '^\+9990[0-9]{8}$' and not (j->>'replay')::boolean and j->>'state'='phone_pending' from r1),'reset starts with a +999 placeholder');
select pg_temp.ok((select (public.test_account_reset_begin('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-0000000000f1')->>'resetId')=j->>'resetId' from r1),'same request key replays');
select pg_temp.ok((select (public.test_account_reset_begin('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-0000000000f2')->>'resetId')=j->>'resetId' from r1),'another click while pending returns the same reset');
select pg_temp.ok(pg_temp.refused($$select public.test_account_reset_begin('a7000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-0000000000f1')$$) in('22023','42501'),'a request key cannot move to another member');
reset role;
select pg_temp.ok((select count(*) from public.test_account_resets where member_id='a7000000-0000-4000-8000-000000000001')=1,'one reset row');
select pg_temp.ok(not exists(select 1 from public.telegram_auth_bindings where auth_user_id='a7000000-0000-4000-8000-000000000001' and active),'Telegram unlinked');
select pg_temp.ok((select revoked_reason from public.telegram_auth_bindings where auth_user_id='a7000000-0000-4000-8000-000000000001')='test_account_reset','binding kept with its reason');
select pg_temp.ok(not exists(select 1 from auth.sessions where user_id='a7000000-0000-4000-8000-000000000001'),'test member sessions ended');
select pg_temp.ok(exists(select 1 from auth.sessions where user_id='a7000000-0000-4000-8000-000000000002'),'real member sessions untouched');
select pg_temp.ok(exists(select 1 from public.patient_clinical_cases where user_id='a7000000-0000-4000-8000-000000000001') and exists(select 1 from auth.users where id='a7000000-0000-4000-8000-000000000001'),'rows kept');
select pg_temp.ok((select test_account_reset_at is not null and test_account_reset_count=1 from public.profiles where id='a7000000-0000-4000-8000-000000000001'),'profile marked reset');
select pg_temp.ok((select previous_phone='37499018101' and telegram_revoked and sessions_revoked>=0 and actor_role='qa' from public.test_account_resets where member_id='a7000000-0000-4000-8000-000000000001'),'reset row records actor and previous phone');
select pg_temp.ok((select count(*) from public.test_account_audit where member_id='a7000000-0000-4000-8000-000000000001' and action='reset.started' and actor_role='qa')=1,'reset audited once');
select pg_temp.ok((select phone from auth.users where id='a7000000-0000-4000-8000-000000000001')='37499018101','phone unchanged until the admin API step');

-- 7. One claim at a time; finishing needs the claim and Auth holding the placeholder.
set local role authenticated;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000012','a7000000-0000-4000-8000-000000000112');
create temp table c1 on commit drop as select public.test_account_reset_claim((select (j->>'resetId')::uuid from r1))j;
select pg_temp.ok((select (j->>'ok')::boolean and j->>'placeholder'=(select j->>'placeholder' from r1) from c1),'first request claims the reset');
select pg_temp.ok((select public.test_account_reset_claim((j->>'resetId')::uuid)->>'code'='busy' from r1),'a duplicate request sees the live claim (no second Auth call)');
select pg_temp.ok((select pg_temp.refused(format('select public.test_account_reset_finish(%L,true,gen_random_uuid())',j->>'resetId'))='22023' from r1),'finish without the claim is refused');
select pg_temp.ok((select not (public.test_account_reset_finish((select (j->>'resetId')::uuid from r1),true,(j->>'claimToken')::uuid)->>'ok')::boolean from c1),'finish refuses before the phone changed');
select pg_temp.ok((select (public.test_account_reset_claim((j->>'resetId')::uuid)->>'ok')::boolean from r1),'a failed attempt releases the claim for a retry');
reset role;
update auth.users set phone=(select substr(j->>'placeholder',2) from r1),phone_confirmed_at=coalesce(phone_confirmed_at,now()) where id='a7000000-0000-4000-8000-000000000001';
select claim_token as first_claim from public.test_account_resets where id=(select (j->>'resetId')::uuid from r1) \gset
set local role authenticated;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000012','a7000000-0000-4000-8000-000000000112');
select pg_temp.ok((select public.test_account_reset_finish((j->>'resetId')::uuid,true,:'first_claim')->>'state'='done' from r1),'finish records the phone change');
select pg_temp.ok((select (public.test_account_reset_finish((j->>'resetId')::uuid,true,null)->>'replay')::boolean from r1),'finish again is a replay');
select pg_temp.ok((select public.test_account_reset_claim((j->>'resetId')::uuid)->>'code'='done' from r1),'a late duplicate sees done and makes no Auth call');
select pg_temp.ok((public.test_accounts_list()->0->>'placeholder')::boolean and public.test_accounts_list()->0->>'phoneEnding' is null,'list shows the placeholder');
-- RESET-01 round 2: right after a reset, the mark stays and the account cannot become staff while
-- an Auth call from a duplicate request could still be in flight.
select pg_temp.as_user('a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-000000000111');
select pg_temp.ok(pg_temp.refused($$select public.admin_set_test_account('a7000000-0000-4000-8000-000000000001',false,'Testing finished')$$)='55006','unflag refused inside the Auth call window');
reset role;
select pg_temp.ok(pg_temp.refused($$insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('a7000000-0000-4000-8000-000000000001','qa','Flagged QA',null)$$)='42501','no staff conversion inside the window');
set local role authenticated;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000013','a7000000-0000-4000-8000-000000000113');
select pg_temp.ok((select pg_temp.refused(format('select public.test_account_reset_claim(%L)',j->>'resetId'))='42501' from r1),'doctor cannot claim a reset');
select pg_temp.ok((select pg_temp.refused(format('select public.test_account_reset_finish(%L,true,null)',j->>'resetId'))='42501' from r1),'doctor cannot finish a reset');
reset role;
select pg_temp.ok((select phone_confirmed_at is not null from auth.users where id='a7000000-0000-4000-8000-000000000001'),'phone stays confirmed');
select pg_temp.ok((select count(*) from public.test_account_audit where member_id='a7000000-0000-4000-8000-000000000001' and action in('reset.phone_failed','reset.phone_changed'))=2,'finish attempts audited');

-- 8. An admin resets again later: a new placeholder; unflagged accounts are refused.
set local role authenticated;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-000000000111');
select pg_temp.ok((select public.test_account_reset_begin('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-0000000000f3')->>'placeholder'<>j->>'placeholder' from r1),'admin resets again with a new placeholder');
-- RESET-01: the mark stays while a reset is pending, and a replay re-checks the target first.
select pg_temp.ok(pg_temp.refused($$select public.admin_set_test_account('a7000000-0000-4000-8000-000000000001',false,'Testing finished')$$)='55006','unflag refused while a reset is pending');
reset role;
update public.profiles set is_test_account=false where id='a7000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000012','a7000000-0000-4000-8000-000000000112');
select pg_temp.ok(pg_temp.refused($$select public.test_account_reset_begin('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-0000000000f3')$$)='42501','replaying a pending key on an unflagged account is refused');
select pg_temp.ok(pg_temp.refused($$select public.test_account_reset_begin('a7000000-0000-4000-8000-000000000001',gen_random_uuid())$$)='42501','another click on an unflagged account is refused');
reset role;
update public.profiles set is_test_account=true where id='a7000000-0000-4000-8000-000000000001';
-- A flagged account cannot become staff or clinic staff.
select pg_temp.ok(pg_temp.refused($$insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('a7000000-0000-4000-8000-000000000001','qa','Flagged QA',null)$$)='42501','a test account cannot become staff');
select pg_temp.ok(pg_temp.refused($$insert into public.clinic_portal_memberships(user_id,clinic_id,display_name)values('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000030','Flagged desk')$$)='42501','a test account cannot become clinic staff');
update auth.users set phone=(select placeholder_phone from public.test_account_resets where request_key='a7000000-0000-4000-8000-0000000000f3') where id='a7000000-0000-4000-8000-000000000001';
select id as second_reset from public.test_account_resets where request_key='a7000000-0000-4000-8000-0000000000f3' \gset
set local role authenticated;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-000000000111');
select public.test_account_reset_claim(:'second_reset')->>'claimToken' as second_claim \gset
select pg_temp.ok(public.test_account_reset_finish(:'second_reset',true,:'second_claim')->>'state'='done','second reset finishes');
reset role;
-- Past the Auth call window the mark can be removed.
update public.test_account_resets set claimed_at=claimed_at-interval '4 minutes' where member_id='a7000000-0000-4000-8000-000000000001' and claimed_at is not null;
set local role authenticated;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-000000000111');
select pg_temp.ok((public.admin_set_test_account('a7000000-0000-4000-8000-000000000001',false,'Testing finished')->>'changed')::boolean,'admin removes the flag');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000012','a7000000-0000-4000-8000-000000000112');
select pg_temp.ok(pg_temp.refused($$select public.test_account_reset_begin('a7000000-0000-4000-8000-000000000001',gen_random_uuid())$$)='42501','an unflagged account cannot be reset');
select pg_temp.ok(jsonb_array_length(public.test_accounts_list())=0,'unflagged account leaves the list');
reset role;
select pg_temp.ok((select count(*) from public.test_account_audit where member_id='a7000000-0000-4000-8000-000000000001' and action in('flag.set','flag.cleared'))=2,'flag changes audited');

-- 9. Clients never read the records directly.
set local role authenticated;
select pg_temp.ok(pg_temp.refused($$select 1 from public.test_account_resets$$)='42501','resets table closed');
select pg_temp.ok(pg_temp.refused($$select 1 from public.test_account_audit$$)='42501','audit table closed');
reset role;

select 'check-test-account-reset: ok';
rollback;
