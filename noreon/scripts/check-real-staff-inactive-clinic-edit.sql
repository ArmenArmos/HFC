\set ON_ERROR_STOP on
begin;
-- Ordinary password sign-in fixtures carry a live session and explicit AMR.
-- This helper only selects claims; it never creates/resurrects a session.
create function pg_temp.password_actor(p_id uuid) returns text language plpgsql as $password$begin
 perform set_config('request.jwt.claim.sub',p_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','session_id',p_id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 return p_id::text;end$password$;

do $$
declare a uuid:=gen_random_uuid();d uuid:=gen_random_uuid();m uuid:=gen_random_uuid();c uuid:=gen_random_uuid();c2 uuid:=gen_random_uuid();r jsonb;saved jsonb;req uuid:=gen_random_uuid();denied boolean:=false;
begin
 insert into auth.users(id,email) values(a,a||'@example.invalid'),(d,d||'@example.invalid'),(m,m||'@example.invalid');
 insert into public.workspace_clinics(id,name,active) values(c,'Existing inactive clinic',false),(c2,'Other inactive clinic',false);
 insert into public.workspace_staff(user_id,role,display_name,clinic_id) values(a,'admin','Admin',null),(d,'doctor','Doctor',c);
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id) values(m,d);
 insert into auth.sessions(id,user_id,created_at,updated_at) select x,x,clock_timestamp(),clock_timestamp() from unnest(array[a,d]) x;
 perform pg_temp.password_actor(a);perform set_config('request.jwt.claim.role','authenticated',true);
 r:=(select x from jsonb_array_elements(public.real_admin_staff()) x where x->>'id'=d::text);
 saved:=public.real_admin_update_staff(d,r->>'version','Renamed doctor',c,req);
 if saved->>'name'<>'Renamed doctor' or saved->>'clinicId'<>c::text then raise exception 'Name-only edit at existing inactive clinic failed';end if;
 if public.real_admin_update_staff(d,r->>'version','Renamed doctor',c,req) is distinct from saved then raise exception 'Edit receipt changed';end if;
 if not exists(select 1 from public.patient_clinical_cases where user_id=m and assigned_doctor_id=d and revision=0) then raise exception 'Name edit changed active assignment';end if;
 perform pg_temp.password_actor(d);
 if public.real_clinical_staff_identity() is not null then raise exception 'Name edit restored access to inactive clinic';end if;
 perform pg_temp.password_actor(a);
 update public.patient_clinical_cases set assigned_doctor_id=null where user_id=m;
 begin perform public.real_admin_update_staff(d,saved->>'version','Must not move',c2,gen_random_uuid());exception when insufficient_privilege then denied:=sqlerrm='Active clinic required';end;
 if not denied then raise exception 'Move into inactive clinic succeeded';end if;
 if (select clinic_id from public.workspace_staff where user_id=d)<>c then raise exception 'Failed move mutated membership';end if;
end $$;
rollback;
