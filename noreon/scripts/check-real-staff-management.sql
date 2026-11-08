-- Local isolated replay only. Changes roll back; no real recipient exists.
\set ON_ERROR_STOP on
begin;
-- Ordinary password sign-in fixtures carry a live session and explicit AMR.
-- This helper only selects claims; it never creates/resurrects a session.
create function pg_temp.password_actor(p_id uuid) returns text language plpgsql as $password$begin
 perform set_config('request.jwt.claim.sub',p_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','session_id',p_id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 return p_id::text;end$password$;

create function pg_temp.reject_sql(q text,expected text) returns void language plpgsql as $$
begin
 begin execute q;exception when others then if sqlerrm like '%'||expected||'%' then return;end if;raise;end;
 raise exception 'Expected rejection: %',q;
end $$;
do $$
declare a uuid:=gen_random_uuid();c uuid:=gen_random_uuid();c2 uuid:=gen_random_uuid();m uuid:=gen_random_uuid();i jsonb;j jsonb;r jsonb;uid uuid;sid uuid:=gen_random_uuid();old_sid uuid:=gen_random_uuid();v text;req uuid;doctor uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(a,a||'@example.invalid'),(doctor,doctor||'@example.invalid'),(m,m||'@example.invalid');
 insert into public.workspace_clinics(id,name) values(c,'Staff management A'),(c2,'Staff management B');
 insert into public.workspace_staff(user_id,role,display_name,clinic_id) values(a,'admin','Admin',null),(doctor,'doctor','Legacy doctor',c);
 insert into auth.sessions(id,user_id,created_at,updated_at) select x,x,clock_timestamp(),clock_timestamp() from unnest(array[a,doctor]) x;
 perform pg_temp.password_actor(a);perform set_config('request.jwt.claim.role','authenticated',true);
 i:=public.real_admin_reserve_staff_invitation(gen_random_uuid(),'nurse-'||gen_random_uuid()||'@example.invalid','Nurse',c,'nurse');
 if i->>'role'<>'nurse' then raise exception 'Nurse role not reserved';end if;
 uid:=(i->>'expectedAuthUserId')::uuid;
 perform pg_temp.reject_sql(format('select public.real_admin_reissue_doctor_invitation(%L,1,%L)',i->>'id',gen_random_uuid()),'Doctor invitation required');
 perform pg_temp.reject_sql(format('select public.real_admin_reserve_staff_invitation(%L,%L,%L,%L,%L)',gen_random_uuid(),'bad@example.invalid','Bad',c,'admin'),'Check staff details');
 perform set_config('request.jwt.claim.role','service_role',true);
 perform public.real_staff_claim_invitation_dispatch((i->>'id')::uuid,1,(i->>'operationId')::uuid);
 insert into auth.users(id,email,email_confirmed_at) values(uid,i->>'email',clock_timestamp());
 perform public.real_staff_bind_invitation_identity((i->>'id')::uuid,1,(i->>'operationId')::uuid,uid);
 perform public.real_staff_store_invitation_token((i->>'id')::uuid,1,(i->>'operationId')::uuid,repeat('a',64),'invite');
 perform public.real_staff_record_invitation_verification((i->>'id')::uuid,1,uid);
 if exists(select 1 from public.workspace_staff where user_id=uid and active) then raise exception 'Nurse activated before password/session finalization';end if;
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,uid,clock_timestamp(),clock_timestamp()),(old_sid,uid,clock_timestamp()-interval '2 hours',clock_timestamp());
 perform pg_temp.reject_sql(format('select public.real_staff_finalize_doctor_invitation(%L,1,%L,%L)',i->>'id',uid,sid),'Doctor invitation required');
 perform public.real_staff_finalize_invitation((i->>'id')::uuid,1,uid,sid);
 if not exists(select 1 from public.workspace_staff where user_id=uid and role='nurse' and active) then raise exception 'Nurse activation failed';end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 r:=(select x from jsonb_array_elements(public.real_admin_staff()) x where x->>'id'=uid::text);v:=r->>'version';
 if r->>'role'<>'nurse' or v is null then raise exception 'Directory missing role/version';end if;
 req:=gen_random_uuid();j:=public.real_admin_update_staff(uid,v,'Updated nurse',c2,req);
 if j->>'name'<>'Updated nurse' or j->>'clinicId'<>c2::text then raise exception 'Edit did not update directory';end if;
 if public.real_admin_update_staff(uid,v,'Updated nurse',c2,req) is distinct from j then raise exception 'Edit request replay changed';end if;
 perform pg_temp.reject_sql(format('select public.real_admin_update_staff(%L,%L,%L,%L,%L)',uid,v,'Stale',c,gen_random_uuid()),'Staff changed');
 j:=public.real_admin_update_staff(uid,j->>'version','Nurse',c,gen_random_uuid());
 -- Returning to identical visible values must not resurrect an earlier CAS version.
 perform pg_temp.reject_sql(format('select public.real_admin_update_staff(%L,%L,%L,%L,%L)',uid,v,'ABA edit',c,gen_random_uuid()),'Staff changed');
 j:=public.real_admin_update_staff(uid,j->>'version',repeat('🩺',160),c,gen_random_uuid());
 perform pg_temp.reject_sql(format('select public.real_admin_remove_staff(%L,%L,%L)',uid,j->>'version',req),'Request identity conflicts');
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id) values(m,doctor,uid);
 perform pg_temp.reject_sql(format('select public.real_admin_remove_staff(%L,%L,%L)',uid,j->>'version',gen_random_uuid()),'Reassign');
 perform pg_temp.reject_sql(format('select public.real_admin_update_staff(%L,%L,%L,%L,%L)',uid,j->>'version','Updated nurse',c2,gen_random_uuid()),'Reassign');
 perform pg_temp.password_actor(uid);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','session_id',sid,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 if public.real_clinical_staff_identity()->>'role' is distinct from 'nurse' or not public.staff_care_access(m,uid,true) then raise exception 'Current nurse denied';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','session_id',old_sid,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 if public.real_clinical_staff_identity() is not null or public.staff_care_access(m,uid,true) then raise exception 'Old nurse session authorized';end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','session_id',sid,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 delete from auth.sessions where id=sid;
 if public.real_clinical_staff_identity() is not null or public.staff_care_access(m,uid,true) then raise exception 'Deleted nurse session authorized';end if;
 perform pg_temp.password_actor(a);perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','session_id',a,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 update public.patient_clinical_cases set assigned_nurse_id=null where user_id=m;
 req:=gen_random_uuid();r:=public.real_admin_remove_staff(uid,j->>'version',req);
 if (r->>'assignmentCount')::int<>0 then raise exception 'Removed directory assignment count';end if;
 if (r->>'active')::boolean or r->>'status'<>'revoked' then raise exception 'Removal did not revoke';end if;
 if public.real_admin_remove_staff(uid,j->>'version',req) is distinct from r then raise exception 'Removal replay changed';end if;
 if not exists(select 1 from public.workspace_staff where user_id=uid) or not exists(select 1 from auth.users where id=uid) then raise exception 'History identity was deleted';end if;
 perform pg_temp.reject_sql(format('select public.real_admin_reissue_staff_invitation(%L,%s,%L)',i->>'id',r->>'generation',gen_random_uuid()),'cannot be reissued');
 insert into auth.sessions(id,user_id,created_at,updated_at) values(sid,uid,clock_timestamp()+interval '1 second',clock_timestamp());
 perform pg_temp.password_actor(uid);perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','session_id',sid,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 if public.real_clinical_staff_identity() is not null then raise exception 'New login restored removed staff';end if;
 perform set_config('request.jwt.claim.role','service_role',true);
 perform pg_temp.reject_sql(format('select public.real_staff_finalize_invitation(%L,1,%L,%L)',i->>'id',uid,sid),'Invitation changed');
 if has_function_privilege('authenticated','public.real_staff_finalize_invitation(uuid,bigint,uuid,uuid)','execute') or has_function_privilege('service_role','public.real_admin_remove_staff(uuid,text,uuid)','execute') then raise exception 'RPC grant widened';end if;
end $$;
rollback;
