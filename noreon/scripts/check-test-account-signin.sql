-- Option A: rolled-back SQL risk path. No provider calls or real sessions are created.
-- The signed-hook crypto and real entry-point wiring are exercised in the TS companion.
\set ON_ERROR_STOP on
begin;
create function pg_temp.tsi_id(n integer)returns uuid language sql immutable as $$select('a9150000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.tsi_ok(value boolean,label text)returns void language plpgsql as $$begin
 if value is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.tsi_count()returns bigint language sql security definer set search_path=''as $$
 select count(*)from public.telegram_auth_audit where kind like 'test_signin.%'$$;
create function pg_temp.tsi_one(label text,query text,expected jsonb)returns jsonb language plpgsql as $$
declare before_count bigint:=pg_temp.tsi_count();result jsonb;
begin
 execute query into result;
 perform pg_temp.tsi_ok(result @> expected,label||': result');
 perform pg_temp.tsi_ok(result::text not like '%code_hash%'and result::text not like '%$2a$%',label||': code hash never returned');
 perform pg_temp.tsi_ok(pg_temp.tsi_count()=before_count+1,label||': exactly one audit');
 return result;
end$$;
create function pg_temp.tsi_user(n integer)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.tsi_id(n),'exp',4102444800,
 'session_id',pg_temp.tsi_id(n+100),'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true),
 set_config('request.jwt.claim.sub',pg_temp.tsi_id(n)::text,true)$$;
create temp table tsi_codes(code text);
create function pg_temp.tsi_code()returns text language sql security definer set search_path=''as $$select code from pg_temp.tsi_codes limit 1$$;
create function pg_temp.tsi_wrong()returns text language sql as $$select lpad(((pg_temp.tsi_code()::int+1)%1000000)::text,6,'0')$$;
create function pg_temp.tsi_issue(ph text,env_enabled boolean)returns jsonb language plpgsql as $$
declare opened jsonb;claimed jsonb;rid uuid;
begin
 opened:=public.auth_code_request_begin(ph,repeat('b',64));
 perform pg_temp.tsi_ok(opened->>'ok'='true','request opens');rid:=(opened->>'requestId')::uuid;
 claimed:=public.test_signin_claim(ph,'test_'||rid::text,repeat('c',64),env_enabled);
 return claimed||jsonb_build_object('requestId',rid);
end$$;
create function pg_temp.tsi_ready(ph text)returns uuid language plpgsql as $$
declare claimed jsonb;rid uuid;
begin
 claimed:=pg_temp.tsi_one('issue challenge',format('select pg_temp.tsi_issue(%L,true)',ph),'{"ok":true,"route":"test"}');
 rid:=(claimed->>'requestId')::uuid;
 perform pg_temp.tsi_ok(public.auth_code_request_seal(rid,'test_'||rid::text,'ciphertext-canary')->>'updated'='true','seal');
 perform pg_temp.tsi_ok(public.auth_code_request_finish(rid,'test_'||rid::text,'accepted',repeat('a',64))->>'updated'='true','finish');
 return rid;
end$$;
-- Call only after RESET ROLE: issue a new code through the real admin RPC and
-- retain the generated value for this rolled-back fixture. Never reset guess counters.
create function pg_temp.tsi_reset()returns void language plpgsql as $$
declare claims text:=current_setting('request.jwt.claims',true);subject text:=current_setting('request.jwt.claim.sub',true);result jsonb;
begin
 perform pg_temp.tsi_user(1);
 result:=pg_temp.tsi_one('issue fresh code',$q$select public.test_signin_admin_set_code((select id from public.test_signin_numbers where phone='+99900000001'))$q$,'{"ok":true}');
 truncate pg_temp.tsi_codes;insert into pg_temp.tsi_codes values(result->>'testCode');
 perform pg_temp.tsi_ok((select code_used_at is null from public.test_signin_numbers where phone='+99900000001'),'fresh issue clears spent state');
 perform set_config('request.jwt.claims',coalesce(claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(subject,''),true);
end$$;
grant execute on all functions in schema pg_temp to authenticated,service_role;
-- Only synthetic identities. Profiles are created by the normal auth insert trigger.
insert into auth.users(id,phone,phone_confirmed_at)values
 (pg_temp.tsi_id(1),null,null),(pg_temp.tsi_id(2),null,null),(pg_temp.tsi_id(3),'99900000001',now()),
 (pg_temp.tsi_id(4),'99900000004',now()),(pg_temp.tsi_id(5),'99900000005',now());
insert into auth.sessions(id,user_id,created_at,updated_at)values
 (pg_temp.tsi_id(101),pg_temp.tsi_id(1),now(),now()),(pg_temp.tsi_id(102),pg_temp.tsi_id(2),now(),now());
insert into public.workspace_staff(user_id,role,display_name)values(pg_temp.tsi_id(1),'admin','Fictional test sign-in admin');
insert into public.workspace_clinics(id,name)values(pg_temp.tsi_id(20),'Fictional test sign-in clinic');
-- Off and empty without a seed (do not silently depend on an environment switch).
select pg_temp.tsi_ok(not exists(select 1 from public.test_signin_settings where enabled),'DB default off');
select pg_temp.tsi_ok(not exists(select 1 from public.test_signin_numbers),'allowlist has no seed rows');
do $$declare tab text;caller text;priv text;f record;seen integer:=0;
 signatures text[]:=array[
  'public.test_signin_direct_begin(text,text,boolean)',
  'public.test_signin_direct_check(uuid,text,text,text,boolean)',
  'public.test_signin_direct_verified(uuid,text,text,text,uuid,uuid,boolean)',
  'public.test_signin_direct_abandon(uuid,text,text,boolean)',
  'public.test_signin_claim(text,text,text,boolean)',
  'public.test_signin_check(uuid,text,text,text,boolean)',
  'public.test_signin_verified(uuid,text,text,uuid,uuid,boolean)',
  'public.test_signin_admin_list()','public.test_signin_admin_add(text,text,integer)',
  'public.test_signin_admin_remove(uuid)','public.test_signin_admin_switch(boolean)','public.test_signin_admin_set_code(uuid)'];
begin
 foreach tab in array array['test_signin_settings','test_signin_numbers','test_signin_challenges']loop
  perform pg_temp.tsi_ok((select relrowsecurity from pg_class where oid=('public.'||tab)::regclass),tab||': RLS enabled');
  foreach caller in array array['anon','authenticated','service_role']loop
   foreach priv in array array['SELECT','INSERT','UPDATE','DELETE']loop
    perform pg_temp.tsi_ok(not has_table_privilege(caller,'public.'||tab,priv),tab||': no '||caller||' '||priv);
   end loop;
  end loop;
 end loop;
 -- Enumerate pg_proc, rather than checking only known regprocedures: an added overload fails too.
 for f in select p.oid,p.proname,format('public.%I(%s)',p.proname,replace(oidvectortypes(p.proargtypes),', ',','))as signature
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'and p.proname in(
   'test_signin_direct_begin','test_signin_direct_check','test_signin_direct_verified','test_signin_direct_abandon',
   'test_signin_claim','test_signin_check','test_signin_verified','test_signin_admin_list',
   'test_signin_admin_add','test_signin_admin_remove','test_signin_admin_switch','test_signin_admin_set_code')loop
  seen:=seen+1;
  perform pg_temp.tsi_ok(f.signature=any(signatures),'expected RPC signature: '||f.signature);
  foreach caller in array array['anon','authenticated','service_role']loop
   perform pg_temp.tsi_ok(has_function_privilege(caller,f.oid,'EXECUTE')=
    case when f.proname like 'test_signin_admin_%'then caller='authenticated'else caller='service_role'end,
    f.signature||': '||caller||' EXECUTE');
  end loop;
  -- PUBLIC is an ACL pseudo-role (grantee 0), not a role accepted by has_function_privilege.
  perform pg_temp.tsi_ok(not exists(select 1 from pg_proc p,
   lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a
   where p.oid=f.oid and a.grantee=0 and a.privilege_type='EXECUTE'),f.signature||': no PUBLIC EXECUTE');
 end loop;
 perform pg_temp.tsi_ok(seen=cardinality(signatures),'all exact RPC signatures present');
end$$;
grant insert on tsi_codes to authenticated;
set local role authenticated;
select pg_temp.tsi_user(2);
select pg_temp.tsi_one('non-admin add',$q$select public.test_signin_admin_add('+99900000001','Fictional',7)$q$,'{"ok":false,"code":"forbidden"}');
select pg_temp.tsi_one('non-admin list','select public.test_signin_admin_list()','{"ok":false,"code":"forbidden"}');
select pg_temp.tsi_one('non-admin code reset',$q$select public.test_signin_admin_set_code(pg_temp.tsi_id(999))$q$,'{"ok":false,"code":"forbidden"}');
select pg_temp.tsi_one('non-admin remove',$q$select public.test_signin_admin_remove(pg_temp.tsi_id(999))$q$,'{"ok":false,"code":"forbidden"}');
select pg_temp.tsi_one('non-admin switch','select public.test_signin_admin_switch(true)','{"ok":false,"code":"forbidden"}');
select pg_temp.tsi_user(1);
select pg_temp.tsi_one('outside range add',$q$select public.test_signin_admin_add('+37499000001','Fictional',7)$q$,'{"ok":false,"code":"invalid"}');
select pg_temp.tsi_one('expiry cap',$q$select public.test_signin_admin_add('+99900000001','Fictional',31)$q$,'{"ok":false,"code":"invalid"}');
insert into tsi_codes select pg_temp.tsi_one('admin add',$q$select public.test_signin_admin_add('+99900000001','Fictional',30)$q$,'{"ok":true}')->>'testCode';
select pg_temp.tsi_ok(public.test_signin_admin_list()#>>'{numbers,0,last4}'='0001','list last4');
select pg_temp.tsi_ok(public.test_signin_admin_list()::text not like '%+99900000001%'
 and public.test_signin_admin_list()::text not like '%code_digest%'and public.test_signin_admin_list()::text not like '%hash%','list has no phone/code/hash');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.sub','',true);
select pg_temp.tsi_one('direct DB off',$q$select public.test_signin_direct_begin('+99900000001',repeat('b',64),true)$q$,'{"ok":false,"code":"switched_off"}');
select pg_temp.tsi_one('DB off',$q$select pg_temp.tsi_issue('+99900000001',true)$q$,'{"ok":false,"code":"no_destination"}');
reset role;
set local role authenticated;
select pg_temp.tsi_user(1);
select pg_temp.tsi_one('admin enable','select public.test_signin_admin_switch(true)','{"ok":true}');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.sub','',true);
select pg_temp.tsi_one('direct env off',$q$select public.test_signin_direct_begin('+99900000001',repeat('b',64),false)$q$,'{"ok":false,"code":"switched_off"}');
select pg_temp.tsi_one('direct no allowlist',$q$select public.test_signin_direct_begin('+99900000002',repeat('b',64),true)$q$,'{"ok":false,"code":"not_allowlisted"}');
select pg_temp.tsi_one('direct outside range',$q$select public.test_signin_direct_begin('+37499000003',repeat('b',64),true)$q$,'{"ok":false,"code":"outside_range"}');
select pg_temp.tsi_one('env off',$q$select pg_temp.tsi_issue('+99900000001',false)$q$,'{"ok":false,"code":"no_destination"}');
select pg_temp.tsi_one('not allowlisted',$q$select pg_temp.tsi_issue('+99900000002',true)$q$,'{"ok":false,"code":"no_destination"}');
select pg_temp.tsi_one('outside range',$q$select pg_temp.tsi_issue('+37499000003',true)$q$,'{"ok":false,"code":"no_destination"}');
reset role;
-- Exercise both identity branches at admission and after a valid challenge was issued.
-- Membership changes are fixture setup only; every tested RPC uses its real caller role.
do $$declare i integer;ph text;label text;membership_insert text;membership_delete text;
 result jsonb;rid uuid;test_code text;number_id uuid;direct_digest text;
begin
 for i in 4..5 loop
  ph:='+9990000000'||i;label:=case when i=4 then 'staff'else 'clinic'end;
  membership_insert:=case when i=4 then
   format('insert into public.workspace_staff(user_id,role,display_name,active)values(%L,''admin'',''Fictional excluded staff'',true)',pg_temp.tsi_id(i))
   else format('insert into public.clinic_portal_memberships(user_id,clinic_id,display_name,active)values(%L,%L,''Fictional excluded clinic member'',true)',pg_temp.tsi_id(i),pg_temp.tsi_id(20))end;
  membership_delete:=format('delete from public.%I where user_id=%L',
   case when i=4 then 'workspace_staff'else 'clinic_portal_memberships'end,pg_temp.tsi_id(i));
  execute membership_insert;
  execute 'set local role authenticated';perform pg_temp.tsi_user(1);
  perform pg_temp.tsi_one(label||' admin add refused',
   format('select public.test_signin_admin_add(%L,''Fictional excluded identity'',7)',ph),'{"ok":false,"code":"invalid"}');
  execute 'reset role';
  perform pg_temp.tsi_ok(not exists(select 1 from public.test_signin_numbers where phone=ph),label||': refused add writes no allowlist entry');
  -- Seed a legacy allowlist entry, so admission must reject the identity independently of allowlisting.
  insert into public.test_signin_numbers(phone,label,created_by,expires_at,code_hash)
   values(ph,'Fictional legacy entry',pg_temp.tsi_id(1),clock_timestamp()+interval '1 day',extensions.crypt('246810',extensions.gen_salt('bf',10)));
  execute 'set local role service_role';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform set_config('request.jwt.claim.sub','',true);
  perform pg_temp.tsi_one(label||' direct admission refused',format('select public.test_signin_direct_begin(%L,repeat(''b'',64),true)',ph),'{"ok":false,"code":"not_allowlisted"}');
  result:=pg_temp.tsi_one(label||' admission refused',format('select pg_temp.tsi_issue(%L,true)',ph),'{"ok":false,"code":"no_destination"}');
  execute 'reset role';
  perform pg_temp.tsi_ok(not exists(select 1 from public.test_signin_challenges where request_id=(result->>'requestId')::uuid),label||': no challenge admitted');
  delete from public.test_signin_numbers where phone=ph;
  execute membership_delete;

  -- Allowlist and issue while this is still an ordinary member, then add membership.
  execute 'set local role authenticated';perform pg_temp.tsi_user(1);
  result:=pg_temp.tsi_one(label||' add before membership',
   format('select public.test_signin_admin_add(%L,''Fictional future identity'',7)',ph),'{"ok":true}');
  test_code:=result->>'testCode';
  execute 'reset role';
  select id into number_id from public.test_signin_numbers where phone=ph;
  execute 'set local role service_role';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform set_config('request.jwt.claim.sub','',true);
  result:=pg_temp.tsi_one(label||' direct issue before membership',format('select public.test_signin_direct_begin(%L,repeat(''b'',64),true)',ph),' {"ok":true}');
  rid:=(result->>'requestId')::uuid;
  execute 'reset role';execute membership_insert;
  execute 'set local role service_role';
  perform pg_temp.tsi_one(label||' direct check after membership',format('select public.test_signin_direct_check(%L,repeat(''b'',64),%L,%L,true)',rid,ph,test_code),'{"ok":false,"code":"switched_off_or_removed"}');
  execute 'reset role';execute membership_delete;
  update auth.users set role='authenticated'where id=pg_temp.tsi_id(i);
  insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.tsi_id(i+100),pg_temp.tsi_id(i),now(),now())on conflict(id)do nothing;
  execute 'set local role service_role';
  result:=pg_temp.tsi_one(label||' direct accepted before membership',format('select public.test_signin_direct_check(%L,repeat(''b'',64),%L,%L,true)',rid,ph,test_code),'{"ok":true}');
  direct_digest:=result->>'codeDigest';
  execute 'reset role';execute membership_insert;
  execute 'set local role service_role';
  perform pg_temp.tsi_one(label||' direct finalize after membership',format('select public.test_signin_direct_verified(%L,repeat(''b'',64),%L,%L,%L,%L,true)',rid,ph,direct_digest,pg_temp.tsi_id(i),pg_temp.tsi_id(i+100)), '{"ok":false,"code":"not_verifiable"}');
  perform pg_temp.tsi_one(label||' direct abandon',format('select public.test_signin_direct_abandon(%L,repeat(''b'',64),%L,true)',rid,ph),'{"ok":true}');
  execute 'reset role';execute membership_delete;
  execute 'set local role authenticated';perform pg_temp.tsi_user(1);
  result:=pg_temp.tsi_one(label||' fresh issue after failed exchange',format('select public.test_signin_admin_set_code(%L)',number_id),'{"ok":true}');
  test_code:=result->>'testCode';
  execute 'reset role';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform set_config('request.jwt.claim.sub','',true);
  execute 'set local role service_role';
  rid:=pg_temp.tsi_ready(ph);
  execute 'reset role';execute membership_insert;
  execute 'set local role service_role';
  result:=pg_temp.tsi_one(label||' membership added after issue: exchange refused',
   format('select public.test_signin_check(%L,repeat(''b'',64),%L,repeat(''a'',64),true)',rid,test_code),'{"ok":false,"code":"switched_off_or_removed"}');
  perform pg_temp.tsi_ok(result='{"ok":false,"code":"switched_off_or_removed"}'::jsonb,label||': refused exchange returns no OTP');
  execute 'reset role';
  perform pg_temp.tsi_ok((select checked_at is null from public.test_signin_challenges where request_id=rid)
   and(select code_sealed='ciphertext-canary'from public.auth_code_requests where id=rid),label||': refused exchange does not consume or expose OTP');

  -- Finalization must fail even after a successful exchange, with every other gate valid.
  execute membership_delete;
  execute 'set local role service_role';
  perform pg_temp.tsi_one(label||' exchange before membership',
   format('select public.test_signin_check(%L,repeat(''b'',64),%L,repeat(''a'',64),true)',rid,test_code),'{"ok":true,"sealed":"ciphertext-canary"}');
  execute 'reset role';
  perform pg_temp.tsi_ok((select checked_at is not null and expires_at>clock_timestamp()from public.test_signin_challenges where request_id=rid)
   and(select state='sent'and code_digest=repeat('a',64)from public.auth_code_requests where id=rid),label||': otherwise valid finalization fixture');
  execute membership_insert;
  execute 'set local role service_role';
  result:=pg_temp.tsi_one(label||' membership added after exchange: finalization refused',
   format('select public.test_signin_verified(%L,repeat(''b'',64),repeat(''a'',64),%L,%L,true)',rid,pg_temp.tsi_id(i),pg_temp.tsi_id(i+100)),
   '{"ok":false,"code":"not_verifiable"}');
  perform pg_temp.tsi_ok(result='{"ok":false,"code":"not_verifiable"}'::jsonb,label||': refused finalization returns no session');
  execute 'reset role';
  perform pg_temp.tsi_ok((select state='sent'and verified_user is null and verified_session is null from public.auth_code_requests where id=rid)
   and not exists(select 1 from public.telegram_auth_audit where kind='test_signin.signin.succeeded'and auth_user_id=pg_temp.tsi_id(i)),label||': no verified session or success audit');
  execute 'set local role authenticated';perform pg_temp.tsi_user(1);
  perform pg_temp.tsi_one(label||' fixture cleanup',format('select public.test_signin_admin_remove(%L)',number_id),'{"ok":true}');
  execute 'reset role';
 end loop;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform set_config('request.jwt.claim.sub','',true);
end$$;
update public.test_signin_numbers set active=false where phone='+99900000001';
set local role service_role;
select pg_temp.tsi_one('direct inactive',$q$select public.test_signin_direct_begin('+99900000001',repeat('b',64),true)$q$,'{"ok":false,"code":"not_allowlisted"}');
select pg_temp.tsi_one('inactive',$q$select pg_temp.tsi_issue('+99900000001',true)$q$,'{"ok":false,"code":"no_destination"}');
reset role;
update public.test_signin_numbers set active=true,created_at=now()-interval '2 days',expires_at=now()-interval '1 day'where phone='+99900000001';
set local role service_role;
select pg_temp.tsi_one('direct expired entry',$q$select public.test_signin_direct_begin('+99900000001',repeat('b',64),true)$q$,'{"ok":false,"code":"not_allowlisted"}');
select pg_temp.tsi_one('expired entry',$q$select pg_temp.tsi_issue('+99900000001',true)$q$,'{"ok":false,"code":"no_destination"}');
reset role;
update public.test_signin_numbers set created_at=now(),expires_at=now()+interval '1 day'where phone='+99900000001';
set local role service_role;
-- Wrong code count spans challenges, with exactly one redacted event per failed check.
do $$declare rid uuid;i integer;begin
 rid:=pg_temp.tsi_ready('+99900000001');
 for i in 1..5 loop
  perform pg_temp.tsi_one('wrong code '||i,format('select public.test_signin_check(%L,repeat(''b'',64),pg_temp.tsi_wrong(),repeat(''d'',64),true)',rid),'{"ok":false,"code":"wrong_code"}');
 end loop;
 perform pg_temp.tsi_one('right code rate limited',format('select public.test_signin_check(%L,repeat(''b'',64),pg_temp.tsi_code(),repeat(''a'',64),true)',rid),'{"ok":false,"code":"rate_limited"}');
 perform pg_temp.tsi_one('new challenge rate limited',$q$select pg_temp.tsi_issue('+99900000001',true)$q$,'{"ok":false,"code":"rate_limited"}');
end$$;
reset role;
select pg_temp.tsi_ok((select code_used_at is null and failed_attempts=5 from public.test_signin_numbers where phone='+99900000001'),'wrong guesses do not spend code');
select pg_temp.tsi_reset();
select pg_temp.tsi_ok((select failed_attempts=5 from public.test_signin_numbers where phone='+99900000001'),'admin issue preserves guess limit');
update public.test_signin_numbers set window_started_at=now()-interval '16 minutes'where phone='+99900000001';
set local role service_role;
-- The real code/digest is still checked, once, for the browser nonce; no code/hash is returned.
do $$declare rid uuid;result jsonb;begin
 rid:=pg_temp.tsi_ready('+99900000001');
 perform pg_temp.tsi_one('wrong browser',format('select public.test_signin_check(%L,repeat(''f'',64),pg_temp.tsi_code(),repeat(''a'',64),true)',rid),'{"ok":false,"code":"unknown_request"}');
 perform pg_temp.tsi_one('env switched off after issue',format('select public.test_signin_check(%L,repeat(''b'',64),pg_temp.tsi_code(),repeat(''a'',64),false)',rid),'{"ok":false,"code":"switched_off_or_removed"}');
 result:=pg_temp.tsi_one('right code',format('select public.test_signin_check(%L,repeat(''b'',64),pg_temp.tsi_code(),repeat(''a'',64),true)',rid),'{"ok":true,"phone":"+99900000001"}');
 perform pg_temp.tsi_ok(result=jsonb_build_object('ok',true,'phone','+99900000001','sealed','ciphertext-canary'),'no code/hash returned');
 perform pg_temp.tsi_ok(public.auth_code_request_check(rid,repeat('b',64),repeat('a',64))->>'ok'='true','real OTP digest follows normal check');
 perform pg_temp.tsi_one('replay',format('select public.test_signin_check(%L,repeat(''b'',64),pg_temp.tsi_code(),repeat(''a'',64),true)',rid),'{"ok":false,"code":"not_verifiable"}');
 perform pg_temp.tsi_one('session verified',format('select public.test_signin_verified(%L,repeat(''b'',64),repeat(''a'',64),pg_temp.tsi_id(3),pg_temp.tsi_id(103),true)',rid),'{"ok":true,"result":"signed_in"}');
 result:=public.test_signin_verified(rid,repeat('b',64),repeat('a',64),pg_temp.tsi_id(3),pg_temp.tsi_id(103),true);
 perform pg_temp.tsi_ok(result->>'ok'='true','finalization is idempotent');
end$$;
reset role;
select pg_temp.tsi_ok(exists(select 1 from public.auth_code_requests where verified_user=pg_temp.tsi_id(3)and state='verified'),'same normal verified session record');
select pg_temp.tsi_ok((select code_used_at is not null from public.test_signin_numbers where phone='+99900000001'),'successful bcrypt match spends code');
set local role service_role;
select pg_temp.tsi_ready('+99900000001')as spent_request \gset
select pg_temp.tsi_one('same code new challenge refused',format('select public.test_signin_check(%L,repeat(''b'',64),pg_temp.tsi_code(),repeat(''a'',64),true)',:'spent_request'),'{"ok":false,"code":"wrong_code"}');
reset role;
select pg_temp.tsi_reset();
-- Provider-independent RPCs never call Auth or any hook. Supabase session creation is
-- the TS transport test; these checks prove service-only storage/admission boundaries.
select pg_temp.tsi_ok(not has_function_privilege('service_role','public._test_signin_hash_equal(text,text)','EXECUTE')
 and not has_function_privilege('anon','public._test_signin_hash_equal(text,text)','EXECUTE')
 and not has_function_privilege('authenticated','public._test_signin_hash_equal(text,text)','EXECUTE'),'hash helper is internal only');
select pg_temp.tsi_ok(public._test_signin_hash_equal('same','same')and not public._test_signin_hash_equal('a','b')
 and not public._test_signin_hash_equal(null,null),'fixed-work digest comparison');
-- Real Auth sessions are fixtures only, never manufactured by the production RPC.
update auth.users set role='authenticated'where id=pg_temp.tsi_id(3);
insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.tsi_id(103),pg_temp.tsi_id(3),now(),now())on conflict(id)do nothing;
set local role service_role;
do $$declare rid uuid;other uuid;result jsonb;digest text;i integer;begin
 result:=pg_temp.tsi_one('direct challenge',$q$select public.test_signin_direct_begin('+99900000001',repeat('b',64),true)$q$,'{"ok":true}');
 rid:=(result->>'requestId')::uuid;
 perform pg_temp.tsi_one('direct wrong browser',format('select public.test_signin_direct_check(%L,repeat(''f'',64),''+99900000001'',pg_temp.tsi_code(),true)',rid),'{"ok":false,"code":"unknown_request"}');
 perform pg_temp.tsi_one('direct wrong phone',format('select public.test_signin_direct_check(%L,repeat(''b'',64),''+99900000002'',pg_temp.tsi_code(),true)',rid),'{"ok":false,"code":"unknown_request"}');
 perform pg_temp.tsi_one('direct env off at check',format('select public.test_signin_direct_check(%L,repeat(''b'',64),''+99900000001'',pg_temp.tsi_code(),false)',rid),'{"ok":false,"code":"switched_off_or_removed"}');
 -- A second browser has a challenge but must not rotate a password while the first exchanges.
 result:=pg_temp.tsi_one('second browser challenge',$q$select public.test_signin_direct_begin('+99900000001',repeat('e',64),true)$q$,'{"ok":true}');
 other:=(result->>'requestId')::uuid;
 perform pg_temp.tsi_one('direct wrong code before acceptance',format('select public.test_signin_direct_check(%L,repeat(''b'',64),''+99900000001'',pg_temp.tsi_wrong(),true)',rid),'{"ok":false,"code":"wrong_code"}');
 result:=pg_temp.tsi_one('direct code accepted',format('select public.test_signin_direct_check(%L,repeat(''b'',64),''+99900000001'',pg_temp.tsi_code(),true)',rid),'{"ok":true}');
 perform pg_temp.tsi_ok(result->>'phone'='+99900000001'and result->>'userId'=pg_temp.tsi_id(3)::text
 and not(result?'sealed')and not(result?'testCode'),'no credential or OTP returned');
 digest:=result->>'codeDigest';
 perform pg_temp.tsi_one('direct replay',format('select public.test_signin_direct_check(%L,repeat(''b'',64),''+99900000001'',pg_temp.tsi_code(),true)',rid),'{"ok":false,"code":"not_verifiable"}');
 perform pg_temp.tsi_one('new request during exchange',$q$select public.test_signin_direct_begin('+99900000001',repeat('b',64),true)$q$,'{"ok":false,"code":"rate_limited"}');
 perform pg_temp.tsi_one('second exchange refused',format('select public.test_signin_direct_check(%L,repeat(''e'',64),''+99900000001'',pg_temp.tsi_code(),true)',other),'{"ok":false,"code":"rate_limited"}');
 perform pg_temp.tsi_one('session owner mismatch',format('select public.test_signin_direct_verified(%L,repeat(''b'',64),''+99900000001'',%L,pg_temp.tsi_id(3),pg_temp.tsi_id(101),true)',rid,digest),'{"ok":false,"code":"not_verifiable"}');
 perform pg_temp.tsi_one('env off at finalize',format('select public.test_signin_direct_verified(%L,repeat(''b'',64),''+99900000001'',%L,pg_temp.tsi_id(3),pg_temp.tsi_id(103),false)',rid,digest),'{"ok":false,"code":"not_verifiable"}');
 perform pg_temp.tsi_one('direct finalize',format('select public.test_signin_direct_verified(%L,repeat(''b'',64),''+99900000001'',%L,pg_temp.tsi_id(3),pg_temp.tsi_id(103),true)',rid,digest),'{"ok":true,"result":"signed_in"}');
 -- Finalized exchange releases the phone, but cannot revive the accepted admin code.
 result:=pg_temp.tsi_one('direct spent-code challenge',$q$select public.test_signin_direct_begin('+99900000001',repeat('b',64),true)$q$,'{"ok":true}');
 rid:=(result->>'requestId')::uuid;
 perform pg_temp.tsi_one('direct spent code refused',format('select public.test_signin_direct_check(%L,repeat(''b'',64),''+99900000001'',pg_temp.tsi_code(),true)',rid),'{"ok":false,"code":"wrong_code"}');
end$$;
reset role;
select pg_temp.tsi_reset();
-- Keep the original five-guess assertions isolated from the extra replay/wrong-code checks.
update public.test_signin_numbers set window_started_at=now()-interval '16 minutes'where phone='+99900000001';
set local role service_role;
do $$declare result jsonb;rid uuid;i integer;begin
 -- Finalized exchange releases the phone; guesses remain bounded across challenges.
 result:=pg_temp.tsi_one('direct wrong-code challenge',$q$select public.test_signin_direct_begin('+99900000001',repeat('b',64),true)$q$,'{"ok":true}');
 rid:=(result->>'requestId')::uuid;
 for i in 1..5 loop
  perform pg_temp.tsi_one('direct wrong code '||i,format('select public.test_signin_direct_check(%L,repeat(''b'',64),''+99900000001'',pg_temp.tsi_wrong(),true)',rid),'{"ok":false,"code":"wrong_code"}');
 end loop;
 perform pg_temp.tsi_one('direct guess limit',format('select public.test_signin_direct_check(%L,repeat(''b'',64),''+99900000001'',pg_temp.tsi_code(),true)',rid),'{"ok":false,"code":"rate_limited"}');
 perform pg_temp.tsi_one('direct request guess limit',$q$select public.test_signin_direct_begin('+99900000001',repeat('b',64),true)$q$,'{"ok":false,"code":"rate_limited"}');
end$$;
reset role;
update public.test_signin_numbers set window_started_at=now()-interval '16 minutes'where phone='+99900000001';
set local role service_role;
select (public.test_signin_direct_begin('+99900000001',repeat('b',64),true)->>'requestId')as direct_expiring \gset
reset role;
update public.test_signin_challenges set expires_at=now()-interval '1 second'where request_id=:'direct_expiring';
set local role service_role;
select pg_temp.tsi_one('direct expired',format('select public.test_signin_direct_check(%L,repeat(''b'',64),''+99900000001'',pg_temp.tsi_code(),true)',:'direct_expiring'),'{"ok":false,"code":"expired"}');
select pg_temp.tsi_one('direct exchange failure audit',format('select public.test_signin_direct_abandon(%L,repeat(''b'',64),''+99900000001'',true)',:'direct_expiring'),'{"ok":true}');
reset role;
-- Simulate a process dying after acceptance, before it can abandon/finalize.
select pg_temp.tsi_reset();
set local role service_role;
select (public.test_signin_direct_begin('+99900000001',repeat('b',64),true)->>'requestId')as failed_exchange \gset
select pg_temp.tsi_one('accepted before exchange failure',format('select public.test_signin_direct_check(%L,repeat(''b'',64),''+99900000001'',pg_temp.tsi_code(),true)',:'failed_exchange'),'{"ok":true}');
select pg_temp.tsi_one('failed exchange still owns phone',$q$select public.test_signin_direct_begin('+99900000001',repeat('b',64),true)$q$,'{"ok":false,"code":"rate_limited"}');
reset role;
update public.test_signin_challenges set expires_at=clock_timestamp()-interval '1 second'where request_id=:'failed_exchange';
select code_digest as failed_digest from public.auth_code_requests where id=:'failed_exchange' \gset
set local role service_role;
select pg_temp.tsi_one('expired exchange cannot finalize',format('select public.test_signin_direct_verified(%L,repeat(''b'',64),''+99900000001'',%L,pg_temp.tsi_id(3),pg_temp.tsi_id(103),true)',:'failed_exchange',:'failed_digest'),'{"ok":false,"code":"not_verifiable"}');
select (public.test_signin_direct_begin('+99900000001',repeat('b',64),true)->>'requestId')as retry_exchange \gset
select pg_temp.tsi_one('expired exchange releases phone but not spent code',format('select public.test_signin_direct_check(%L,repeat(''b'',64),''+99900000001'',pg_temp.tsi_code(),true)',:'retry_exchange'),'{"ok":false,"code":"wrong_code"}');
reset role;
select pg_temp.tsi_reset();
select pg_temp.tsi_ok((select state='cancelled'from public.auth_code_requests where id=:'retry_exchange'),'admin issue cancels pending retry');
set local role service_role;
select (public.test_signin_direct_begin('+99900000001',repeat('b',64),true)->>'requestId')as reissued_exchange \gset
select pg_temp.tsi_one('fresh code works after failed exchange',format('select public.test_signin_direct_check(%L,repeat(''b'',64),''+99900000001'',pg_temp.tsi_code(),true)',:'reissued_exchange'),'{"ok":true}');
reset role;
select pg_temp.tsi_reset();
-- Test credential stays hashed and is unrelated to Supabase's OTP. Reset cancels challenges.
select pg_temp.tsi_ok((select extensions.crypt(pg_temp.tsi_code(),code_hash)=code_hash and code_hash<>pg_temp.tsi_code()from public.test_signin_numbers where phone='+99900000001'),'salted code hash');
set local role service_role;
select pg_temp.tsi_ready('+99900000001')as pending_request \gset
reset role;
update public.test_signin_challenges set expires_at=now()-interval '1 second'where request_id=:'pending_request';
set local role service_role;
select pg_temp.tsi_one('challenge expired',format('select public.test_signin_check(%L,repeat(''b'',64),pg_temp.tsi_code(),repeat(''a'',64),true)',:'pending_request'),'{"ok":false,"code":"expired"}');
select pg_temp.tsi_ready('+99900000001')as pending_request \gset
reset role;
set local role authenticated;
select pg_temp.tsi_user(1);
select pg_temp.tsi_one('code reset',$q$select public.test_signin_admin_set_code((public.test_signin_admin_list()#>>'{numbers,0,id}')::uuid)$q$,'{"ok":true}');
reset role;
select pg_temp.tsi_ok(not exists(select 1 from public.auth_code_requests where id=:'pending_request'and(code_sealed is not null or state='sent')),'reset cancels code');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select (public.test_signin_direct_begin('+99900000001',repeat('b',64),true)->>'requestId')as direct_disabled \gset
reset role;
set local role authenticated;
select pg_temp.tsi_user(1);
select pg_temp.tsi_one('switch off cancels','select public.test_signin_admin_switch(false)','{"ok":true}');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.sub','',true);
select pg_temp.tsi_one('direct DB switched off after issue',format('select public.test_signin_direct_check(%L,repeat(''b'',64),''+99900000001'',pg_temp.tsi_code(),true)',:'direct_disabled'),'{"ok":false,"code":"switched_off_or_removed"}');
select pg_temp.tsi_one('DB switched off after issue',format('select public.test_signin_check(%L,repeat(''b'',64),pg_temp.tsi_code(),repeat(''a'',64),true)',:'pending_request'),'{"ok":false,"code":"switched_off_or_removed"}');
reset role;
set local role authenticated;
select pg_temp.tsi_user(1);
select pg_temp.tsi_one('admin remove',$q$select public.test_signin_admin_remove((public.test_signin_admin_list()#>>'{numbers,0,id}')::uuid)$q$,'{"ok":true}');
reset role;
select pg_temp.tsi_ok(not exists(select 1 from public.test_signin_numbers where phone='+99900000001'),'removed');
select pg_temp.tsi_ok(not exists(select 1 from public.telegram_auth_audit where kind like 'test_signin.%'
 and(detail-'phoneLast4'-'outcome'<>'{}'::jsonb or detail::text like '%+999%'or detail::text like '%ciphertext%'or detail::text like '%code_digest%'
 or detail->>'phoneLast4'!~'^[0-9]{0,4}$')),'all audit details contain last4 and fixed outcome only');
select pg_temp.tsi_ok(exists(select 1 from public.telegram_auth_audit where kind='test_signin.signin.succeeded'and auth_user_id=pg_temp.tsi_id(3)),'success actor');
select pg_temp.tsi_ok(exists(select 1 from public._audit_rows(now()-interval '1 hour',now()+interval '1 hour',null,null,'sign_in')where action='test_signin.signin.succeeded'),'Activity sign_in category');
rollback;
