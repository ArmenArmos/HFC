-- Run only against an isolated local database. All fixtures roll back.
\set ON_ERROR_STOP on
begin;
-- Ordinary password sign-in fixtures carry a live session and explicit AMR.
-- This helper only selects claims; it never creates/resurrects a session.
create function pg_temp.password_actor(p_id uuid) returns text language plpgsql as $password$begin
 perform set_config('request.jwt.claim.sub',p_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','session_id',p_id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 return p_id::text;end$password$;

create function pg_temp.expect_error(p_sql text,p_code text) returns void language plpgsql as $$
declare observed text;
begin
 begin execute p_sql; exception when others then observed:=sqlstate;end;
 if observed is distinct from p_code then raise exception 'Expected %, got % for %',p_code,observed,p_sql;end if;
end $$;
do $$
declare
 admin_id uuid:=gen_random_uuid();doctor_id uuid:=gen_random_uuid();nurse_id uuid:=gen_random_uuid();member_id uuid:=gen_random_uuid();
 clinic_id uuid; inactive_clinic_id uuid;request_id uuid:=gen_random_uuid();inv jsonb;again jsonb;next_inv jsonb;
 iid uuid; uid uuid;op uuid;session_id uuid:=gen_random_uuid();old_session_id uuid:=gen_random_uuid();wrong_session_id uuid:=gen_random_uuid();svc record;result jsonb;
begin
 -- The first assertion also provides the pre-implementation red check.
 if has_function_privilege('anon','public.real_admin_clinics()','execute') then raise exception 'anonymous directory exposed';end if;
 for svc in select oid,proname from pg_proc where pronamespace='public'::regnamespace and proname like 'real_staff_%invitation%' loop
  if has_function_privilege('authenticated',svc.oid,'execute') or has_function_privilege('anon',svc.oid,'execute') then raise exception 'service RPC exposed: %',svc.proname;end if;
 end loop;
 if not exists(select 1 from pg_class where oid='public.real_staff_invitations'::regclass and relrowsecurity) or not exists(select 1 from pg_class where oid='public.real_staff_admin_events'::regclass and relrowsecurity) then raise exception 'missing RLS';end if;
 insert into auth.users(id,email,aud,role) values
 (admin_id,'staff-admin-'||admin_id||'@example.invalid','authenticated','authenticated'),
 (doctor_id,'staff-doctor-'||doctor_id||'@example.invalid','authenticated','authenticated'),
 (nurse_id,'staff-nurse-'||nurse_id||'@example.invalid','authenticated','authenticated'),
 (member_id,'staff-member-'||member_id||'@example.invalid','authenticated','authenticated');
 insert into public.workspace_clinics(name,address) values('Onboarding fixture','Address') returning id into clinic_id;
 insert into public.workspace_clinics(name,active) values('Inactive fixture',false) returning id into inactive_clinic_id;
 insert into public.workspace_staff(user_id,role,display_name,clinic_id) values(admin_id,'admin','Admin',null),(doctor_id,'doctor','Doctor',clinic_id),(nurse_id,'nurse','Nurse',clinic_id);
 insert into auth.sessions(id,user_id,created_at,updated_at) select x,x,clock_timestamp(),clock_timestamp() from unnest(array[admin_id,doctor_id,nurse_id]) x;
 perform set_config('request.jwt.claim.sub','',true);
 perform pg_temp.expect_error('select public.real_admin_clinics()','42501');
 for uid in select unnest(array[doctor_id,nurse_id,member_id]) loop
  perform pg_temp.password_actor(uid);
  perform pg_temp.expect_error('select public.real_admin_clinics()','42501');
  perform pg_temp.expect_error($q$select public.real_admin_create_clinic('Forbidden','')$q$,'42501');
 end loop;
 perform pg_temp.password_actor(admin_id);
 result:=public.real_admin_create_clinic(' New clinic ','New address');
 if result->>'name'<>'New clinic' or (result->>'active')::boolean is not true then raise exception 'clinic response invalid';end if;
 perform pg_temp.expect_error(format('select public.real_admin_reserve_doctor_invitation(%L,%L,%L,%L)',gen_random_uuid(),'inactive@example.invalid','Doctor',inactive_clinic_id),'42501');
 perform pg_temp.expect_error(format('select public.real_admin_reserve_doctor_invitation(%L,%L,%L,%L)',gen_random_uuid(),'staff-member-'||member_id||'@example.invalid','Doctor',clinic_id),'23505');
 inv:=public.real_admin_reserve_doctor_invitation(request_id,'  New-Doctor@example.invalid  ',' New doctor ',clinic_id);
 iid:=(inv->>'id')::uuid;uid:=(inv->>'expectedAuthUserId')::uuid;op:=(inv->>'operationId')::uuid;
 if inv->>'email'<>'new-doctor@example.invalid' or (inv->>'generation')::int<>1 or inv->>'authUserId' is not null then raise exception 'reservation invalid';end if;
 again:=public.real_admin_reserve_doctor_invitation(request_id,'new-doctor@example.invalid','New doctor',clinic_id);
 if again->>'id'<>iid::text then raise exception 'idempotency failed';end if;
 perform pg_temp.expect_error(format('select public.real_admin_reserve_doctor_invitation(%L,%L,%L,%L)',request_id,'changed@example.invalid','New doctor',clinic_id),'22023');
 perform pg_temp.expect_error(format('select public.real_admin_reserve_doctor_invitation(%L,%L,%L,%L)',gen_random_uuid(),'NEW-DOCTOR@example.invalid','New doctor',clinic_id),'23505');
 result:=public.real_staff_claim_invitation_dispatch(iid,1,op);
 if (result->>'claimed')::boolean is not true then raise exception 'first claim denied';end if;
 result:=public.real_staff_claim_invitation_dispatch(iid,1,op);
 if (result->>'claimed')::boolean is not false then raise exception 'duplicate dispatch allowed';end if;
 perform pg_temp.expect_error(format('select public.real_admin_reissue_doctor_invitation(%L,1,%L)',iid,gen_random_uuid()),'40001');
 update public.real_staff_invitations set last_requested_at=clock_timestamp()-interval '90 seconds' where id=iid;
 perform pg_temp.expect_error(format('select public.real_admin_reissue_doctor_invitation(%L,1,%L)',iid,gen_random_uuid()),'40001');
 perform pg_temp.expect_error(format('select public.real_staff_bind_invitation_identity(%L,1,%L,%L)',iid,op,member_id),'42501');
 insert into auth.users(id,email,aud,role) values(uid,'new-doctor@example.invalid','authenticated','authenticated');
 perform public.real_staff_bind_invitation_identity(iid,1,op,uid);
 if (select active from public.workspace_staff where user_id=uid) or (select role from public.workspace_staff where user_id=uid)<>'doctor' then raise exception 'premature access';end if;
 perform pg_temp.password_actor(uid);
 if public.real_clinical_staff_identity() is not null then raise exception 'pending identity exposed';end if;
 perform pg_temp.password_actor(admin_id);
 perform pg_temp.expect_error(format('select public.real_staff_store_invitation_token(%L,1,%L,%L,%L)',iid,op,'rawtoken','invite'),'22023');
 perform public.real_staff_store_invitation_token(iid,1,op,repeat('a',64),'invite');
 perform public.real_staff_record_invitation_submission(iid,1,op,'unknown',null);
 perform pg_temp.expect_error(format('select public.real_staff_finalize_doctor_invitation(%L,1,%L,%L)',iid,uid,session_id),'42501');
 update public.real_staff_invitations set last_requested_at=clock_timestamp()-interval '3 minutes',dispatch_claimed_at=clock_timestamp()-interval '3 minutes' where id=iid;
 next_inv:=public.real_admin_reissue_doctor_invitation(iid,1,gen_random_uuid());
 if (next_inv->>'generation')::int<>2 or next_inv->>'expectedAuthUserId'<>uid::text or next_inv->>'tokenDigest' is not null then raise exception 'reissue invalid';end if;
 perform pg_temp.expect_error(format('select public.real_staff_record_invitation_verification(%L,1,%L)',iid,uid),'40001');
 perform pg_temp.expect_error(format('select public.real_staff_record_invitation_submission(%L,1,%L,%L,null)',iid,op,'accepted'),'40001');
 op:=(next_inv->>'operationId')::uuid;
 perform public.real_staff_claim_invitation_dispatch(iid,2,op);
 perform public.real_staff_bind_invitation_identity(iid,2,op,uid);
 perform public.real_staff_store_invitation_token(iid,2,op,repeat('b',64),'invite');
 perform pg_temp.expect_error(format('select public.real_staff_record_invitation_verification(%L,2,%L)',iid,member_id),'42501');
 update public.workspace_clinics set active=false where id=clinic_id;
 perform pg_temp.expect_error(format('select public.real_staff_record_invitation_verification(%L,2,%L)',iid,uid),'42501');
 update public.workspace_clinics set active=true where id=clinic_id;
 update public.workspace_staff set active=false where user_id=admin_id;
 perform pg_temp.expect_error(format('select public.real_staff_record_invitation_verification(%L,2,%L)',iid,uid),'42501');
 update public.workspace_staff set active=true where user_id=admin_id;
 perform pg_temp.expect_error(format('select public.real_staff_record_invitation_verification(%L,2,%L)',iid,uid),'42501');
 update auth.users set email_confirmed_at=clock_timestamp() where id=uid;
 update public.workspace_staff set role='nurse' where user_id=uid;
 perform pg_temp.expect_error(format('select public.real_staff_record_invitation_verification(%L,2,%L)',iid,uid),'42501');
 update public.workspace_staff set role='doctor' where user_id=uid;
 perform public.real_staff_record_invitation_verification(iid,2,uid);
 perform public.real_staff_record_invitation_verification(iid,2,uid);
 update public.real_staff_invitations set expires_at=clock_timestamp()-interval '1 second' where id=iid;
 perform pg_temp.expect_error(format('select public.real_staff_finalize_doctor_invitation(%L,2,%L,%L)',iid,uid,session_id),'42501');
 update public.real_staff_invitations set expires_at=clock_timestamp()+interval '1 hour' where id=iid;
 insert into auth.sessions(id,user_id,created_at,updated_at) values(session_id,uid,clock_timestamp(),clock_timestamp());
 insert into auth.sessions(id,user_id,created_at,updated_at) values(old_session_id,uid,clock_timestamp()-interval '1 day',clock_timestamp()),(wrong_session_id,member_id,clock_timestamp(),clock_timestamp());
 perform pg_temp.expect_error(format('select public.real_staff_finalize_doctor_invitation(%L,2,%L,%L)',iid,uid,gen_random_uuid()),'42501');
 perform pg_temp.expect_error(format('select public.real_staff_finalize_doctor_invitation(%L,2,%L,%L)',iid,uid,old_session_id),'42501');
 perform pg_temp.expect_error(format('select public.real_staff_finalize_doctor_invitation(%L,2,%L,%L)',iid,uid,wrong_session_id),'42501');
 result:=public.real_staff_finalize_doctor_invitation(iid,2,uid,session_id);
 if result->>'status'<>'accepted' or not (select active from public.workspace_staff where user_id=uid) then raise exception 'activation failed';end if;
 -- A fast recipient can complete before the sender persists Brevo's response.
 perform public.real_staff_record_invitation_submission(iid,2,op,'accepted','fixture-message');
 if (select send_status from public.real_staff_invitations where id=iid)<>'accepted' then raise exception 'late delivery result lost';end if;
 update public.workspace_staff set active=false where user_id=uid;
 perform public.real_staff_finalize_doctor_invitation(iid,2,uid,session_id);
 if (select active from public.workspace_staff where user_id=uid) then raise exception 'idempotency reactivated disabled doctor';end if;
 perform pg_temp.expect_error(format('select public.real_admin_reissue_doctor_invitation(%L,2,%L)',iid,gen_random_uuid()),'42501');
 if not exists(select 1 from jsonb_array_elements(public.real_admin_doctors()) x where x->>'id'=uid::text and x->>'email'='new-doctor@example.invalid') then raise exception 'doctor directory missing';end if;
 if exists(select 1 from public.real_staff_admin_events where invitation_id=iid and (details::text like '%bbbbbbbb%' or details::text like '%fixture-message%')) then raise exception 'audit leaks transport content';end if;
end $$;
set local role anon;
select pg_temp.expect_error('select public.real_staff_finalize_doctor_invitation(gen_random_uuid(),1,gen_random_uuid(),gen_random_uuid())','42501');
set local role authenticated;
select pg_temp.expect_error('select public.real_staff_claim_invitation_dispatch(gen_random_uuid(),1,gen_random_uuid())','42501');
select pg_temp.expect_error('select * from public.real_staff_invitations','42501');
select pg_temp.expect_error('select * from public.real_staff_admin_events','42501');
select pg_temp.expect_error('select public._real_staff_require_admin()','42501');
reset role;
rollback;
\echo 'Real staff onboarding authorization and lifecycle checks passed'
