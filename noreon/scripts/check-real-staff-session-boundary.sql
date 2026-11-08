-- Isolated local PostgreSQL regression for cached JWTs from superseded invitations.
\set ON_ERROR_STOP on
begin;
-- Ordinary password sign-in fixtures carry a live session and explicit AMR.
-- This helper only selects claims; it never creates/resurrects a session.
create function pg_temp.password_actor(p_id uuid) returns text language plpgsql as $password$begin
 perform set_config('request.jwt.claim.sub',p_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','session_id',p_id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 return p_id::text;end$password$;

create function pg_temp.assert_session_denied(p_member uuid) returns void language plpgsql as $$
declare denied boolean:=false;
begin
 if public.real_clinical_staff_identity() is not null then raise exception 'Superseded cached JWT gained staff identity';end if;
 if public.staff_care_access(p_member,auth.uid(),true) then raise exception 'Superseded cached JWT gained care access';end if;
 begin perform public.save_patient_clinical_draft(p_member,0,'old','{}');exception when insufficient_privilege then denied:=sqlerrm='Current doctor session required';end;
 if not denied then raise exception 'Superseded JWT was not rejected before clinical draft processing';end if;
 denied:=false;
 begin perform public.command_patient_clinical_review(p_member,0,'old','consultation','{}');exception when insufficient_privilege then denied:=sqlerrm='Current doctor session required';end;
 if not denied then raise exception 'Superseded JWT was not rejected before clinical review command processing';end if;
end $$;
do $$
declare
 a uuid:=gen_random_uuid();d uuid:=gen_random_uuid();m uuid:=gen_random_uuid();n uuid:=gen_random_uuid();legacy uuid:=gen_random_uuid();
 c uuid:=gen_random_uuid();i uuid:=gen_random_uuid();old_session uuid:=gen_random_uuid();accepted_session uuid:=gen_random_uuid();later_session uuid:=gen_random_uuid();wrong_session uuid:=gen_random_uuid();
 stamp timestamptz:=clock_timestamp();
begin
 insert into auth.users(id,email,email_confirmed_at) values(a,a||'@example.invalid',stamp),(d,d||'@example.invalid',stamp),(m,m||'@example.invalid',stamp),(n,n||'@example.invalid',stamp),(legacy,legacy||'@example.invalid',stamp);
 update auth.users set phone='374'||lpad(floor(random()*100000000)::bigint::text,8,'0'),phone_confirmed_at=stamp where id=m;
 insert into public.workspace_clinics(id,name) values(c,'Session boundary fixture');
 insert into public.workspace_staff(user_id,role,display_name,clinic_id) values(a,'admin','Admin',null),(d,'doctor','Managed doctor',c),(n,'nurse','Nurse',c),(legacy,'doctor','Legacy doctor',c);
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id) values(m,d,n);
 insert into auth.sessions(id,user_id,created_at,updated_at) values(old_session,d,stamp-interval '20 minutes',stamp),(accepted_session,d,stamp-interval '1 minute',stamp),(later_session,d,stamp+interval '1 second',stamp),(wrong_session,m,stamp+interval '1 second',stamp);
 insert into public.real_staff_invitations(id,email,display_name,clinic_id,issuer_id,expected_auth_user_id,auth_user_id,status,verified_at,accepted_at) values(i,d||'@example.invalid','Managed doctor',c,a,d,d,'accepted',stamp,stamp);
 -- Conditional only allows this regression to run against the pre-fix schema.
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='real_staff_invitations' and column_name='accepted_session_id') then
  execute 'update public.real_staff_invitations set accepted_session_id=$1 where id=$2' using accepted_session,i;
 end if;
 insert into auth.sessions(id,user_id,created_at,updated_at) select x,x,stamp,stamp from unnest(array[a,n,legacy]) x;
 perform set_config('request.jwt.claim.sub',d::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',d,'role','authenticated','session_id',old_session,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 -- Retained old sessions and deleted old sessions both fail, although JWT expiry is valid.
 perform pg_temp.assert_session_denied(m);
 delete from auth.sessions where id=old_session;
 perform pg_temp.assert_session_denied(m);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',d,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 perform pg_temp.assert_session_denied(m);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',d,'role','authenticated','session_id','malformed','amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 perform pg_temp.assert_session_denied(m);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',d,'role','authenticated','session_id',wrong_session,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 perform pg_temp.assert_session_denied(m);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',d,'role','authenticated','session_id',accepted_session,'amr',jsonb_build_array(jsonb_build_object('method','otp')))::text,true);
 if public.real_clinical_staff_identity()->>'role' is distinct from 'doctor' or not public.staff_care_access(m,d,true) then raise exception 'Accepted setup session denied';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',d,'role','authenticated','session_id',later_session,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 if public.real_clinical_staff_identity()->>'role' is distinct from 'doctor' or not public.staff_care_access(m,d,true) then raise exception 'Later password login session denied';end if;
 update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=later_session;
 perform pg_temp.assert_session_denied(m);
 -- Trusted server operations are preserved; they authenticate with requireRealStaff first.
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claim.role','service_role',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 if not public.staff_care_access(m,d,true) then raise exception 'Trusted service care path changed';end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 perform pg_temp.password_actor(a);
 if public.real_clinical_staff_identity()->>'role' is distinct from 'admin' then raise exception 'Existing admin changed';end if;
 perform pg_temp.password_actor(n);
 if public.real_clinical_staff_identity()->>'role' is distinct from 'nurse' or not public.staff_care_access(m,n,true) then raise exception 'Existing nurse changed';end if;
 perform pg_temp.password_actor(legacy);
 if public.real_clinical_staff_identity()->>'role' is distinct from 'doctor' then raise exception 'Unmanaged doctor changed';end if;
 if to_regprocedure('public.real_staff_finalize_doctor_invitation(uuid,bigint,uuid)') is not null then raise exception 'Old unbound activation overload remains';end if;
 if has_function_privilege('authenticated','public.real_staff_finalize_doctor_invitation(uuid,bigint,uuid,uuid)','execute') or has_function_privilege('anon','public.real_staff_finalize_doctor_invitation(uuid,bigint,uuid,uuid)','execute') then raise exception 'Activation exposed';end if;
end $$;
rollback;
\echo 'Managed doctor session boundary passed'
