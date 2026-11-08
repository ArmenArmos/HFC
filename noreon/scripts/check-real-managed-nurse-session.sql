\set ON_ERROR_STOP on
begin;
create temp table nurse_session_fixture as select gen_random_uuid() a,gen_random_uuid() d,gen_random_uuid() n,gen_random_uuid() m,gen_random_uuid() c,gen_random_uuid() accepted,gen_random_uuid() old,gen_random_uuid() later;
grant select on nurse_session_fixture to authenticated;
insert into auth.users(id,email) select x,x||'@example.invalid' from nurse_session_fixture cross join lateral unnest(array[a,d,n,m]) x;
update auth.users set phone='37499000991',phone_confirmed_at=clock_timestamp() where id=(select m from nurse_session_fixture);
insert into public.workspace_clinics(id,name) select c,'Managed nurse fixture' from nurse_session_fixture;
insert into public.workspace_staff(user_id,role,display_name,clinic_id) select a,'admin','Admin',null from nurse_session_fixture union all select d,'doctor','Doctor',c from nurse_session_fixture union all select n,'nurse','Managed nurse',c from nurse_session_fixture;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id) select m,d,n from nurse_session_fixture;
insert into public.real_staff_invitations(email,display_name,clinic_id,issuer_id,expected_auth_user_id,auth_user_id,role,status,verified_at,accepted_at,accepted_session_id) select n||'@example.invalid','Managed nurse',c,a,n,n,'nurse','accepted',clock_timestamp(),clock_timestamp(),accepted from nurse_session_fixture;
insert into auth.sessions(id,user_id,created_at,updated_at) select accepted,n,clock_timestamp()-interval '1 minute',clock_timestamp() from nurse_session_fixture union all select old,n,clock_timestamp()-interval '2 hours',clock_timestamp() from nurse_session_fixture union all select later,n,clock_timestamp()+interval '1 second',clock_timestamp() from nurse_session_fixture;
create function pg_temp.nurse_denied() returns void language plpgsql as $$
declare f record;denied boolean;
begin
 select * into f from nurse_session_fixture;
 if public.real_clinical_staff_identity() is not null then raise exception 'Invalid nurse session gained identity';end if;
 begin if jsonb_array_length(public.patient_clinical_case_queue())<>0 then raise exception 'Invalid nurse session gained queue';end if;exception when insufficient_privilege then null;end;
 denied:=false;begin perform public.patient_clinical_case_snapshot(f.m);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Invalid nurse session gained snapshot';end if;
 denied:=false;begin perform public.patient_staff_care_command(f.m,0,'note','{"kind":"evidence","note":"Must not write"}');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Invalid nurse session wrote care note';end if;
 -- Browser grants/RLS must not provide a separate data path.
 denied:=false;begin perform 1 from public.patient_clinical_cases;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Browser read clinical table';end if;
end $$;
select set_config('request.jwt.claim.sub',n::text,true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claims',jsonb_build_object('sub',n,'role','authenticated','session_id',old,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true) from nurse_session_fixture;
set local role authenticated;
select pg_temp.nurse_denied();
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',n,'role','authenticated','session_id',accepted,'amr',jsonb_build_array(jsonb_build_object('method','otp')))::text,true) from nurse_session_fixture;
set local role authenticated;
do $$declare f record;s jsonb;denied boolean:=false;begin
 select * into f from nurse_session_fixture;
 if public.real_clinical_staff_identity()->>'role' is distinct from 'nurse' or jsonb_array_length(public.patient_clinical_case_queue())<>1 then raise exception 'Current nurse session denied';end if;
 s:=public.patient_clinical_case_snapshot(f.m);
 if s->'draft'<>'null'::jsonb or s->'review'<>'null'::jsonb then raise exception 'Nurse saw unpublished clinical data';end if;
 perform public.patient_staff_care_command(f.m,0,'note','{"kind":"evidence","note":"Authorized care evidence"}');
 begin perform public.save_patient_clinical_draft(f.m,1,'irrelevant','{}');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Nurse wrote clinical draft';end if;
end $$;
reset role;
delete from auth.sessions where id=(select accepted from nurse_session_fixture);
set local role authenticated;
select pg_temp.nurse_denied();
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',n,'role','authenticated','session_id',later,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true) from nurse_session_fixture;
set local role authenticated;
do $$begin if public.real_clinical_staff_identity()->>'role' is distinct from 'nurse' then raise exception 'Later password session denied';end if;end$$;
reset role;
update public.workspace_staff set active=false where user_id=(select n from nurse_session_fixture);
set local role authenticated;
select pg_temp.nurse_denied();
reset role;
rollback;
