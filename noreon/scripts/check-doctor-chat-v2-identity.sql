-- Isolated local/CI database only. All synthetic data and audits roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.chat_identity_actor(id uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated','session_id',id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
end$$;
do $$declare clinic uuid:=gen_random_uuid();other_clinic uuid:=gen_random_uuid();a uuid:=gen_random_uuid();d uuid:=gen_random_uuid();n uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();u uuid;i int;begin
 perform set_config('test.chat_admin',a::text,true);perform set_config('test.chat_doctor',d::text,true);perform set_config('test.chat_nurse',n::text,true);perform set_config('test.chat_outsider',outsider::text,true);
 insert into public.workspace_clinics(id,name)values(clinic,'Linked identity clinic'),(other_clinic,'Viewing identity clinic');
 foreach u in array array[a,d,n,outsider]loop
  insert into auth.users(id,email)values(u,u||'@example.invalid');
  insert into auth.sessions(id,user_id,created_at,updated_at)values(u,u,clock_timestamp(),clock_timestamp());
 end loop;
 insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(a,'admin','Identity admin',null),(d,'doctor','Assigned doctor',clinic),(n,'nurse','Assigned nurse',clinic),(outsider,'doctor','Other doctor',other_clinic);
 for i in 1..2 loop
  u:=('a9100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  insert into auth.users(id,email,phone,phone_confirmed_at)values(u,u||'@example.invalid',case i when 1 then '37499123456' else '37499787890' end,now());
  insert into public.profiles(id,display_name,birth_date,biological_sex)values(u,'Same Name',case i when 1 then date '1986-11-06' else date '1992-04-15' end,'female')on conflict(id)do update set display_name=excluded.display_name,birth_date=excluded.birth_date,biological_sex=excluded.biological_sex;
  insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(u,d,n);
 end loop;
end$$;
set local role authenticated;
do $$declare actor uuid;rows jsonb;denied jsonb;missing jsonb;begin
 foreach actor in array array[current_setting('test.chat_doctor')::uuid,current_setting('test.chat_nurse')::uuid]loop
  perform pg_temp.chat_identity_actor(actor);
  rows:=public.staff_chat_member_identities(array['a9100000-0000-4000-8000-000000000001'::uuid,'a9100000-0000-4000-8000-000000000002'::uuid]);
  if jsonb_array_length(rows)<>2 or rows#>>'{0,phone}' is distinct from '+37499123456' or rows#>>'{1,phone}' is distinct from '+37499787890'
   or rows#>>'{0,clinic}' is distinct from 'Linked identity clinic' or rows#>>'{0,birthDate}' is distinct from '1986-11-06' or rows#>>'{1,birthDate}' is distinct from '1992-04-15'
   or rows#>>'{0,sex}' is distinct from 'female' or rows#>>'{0,shortId}' is distinct from '00000001' then raise exception 'Assigned care-team identity payload incorrect';end if;
 end loop;
 perform pg_temp.chat_identity_actor(current_setting('test.chat_admin')::uuid);
 rows:=public.staff_chat_member_identities(array['a9100000-0000-4000-8000-000000000001'::uuid,'a9100000-0000-4000-8000-000000000002'::uuid]);
 if jsonb_array_length(rows)<>2 or exists(select 1 from jsonb_array_elements(rows)r where r?'phone')
  or rows::text like '%37499123456%' or rows::text like '%37499787890%' or rows#>>'{0,phoneLast4}' is distinct from '3456' then raise exception 'Non-care-team payload contains full phone';end if;
 if rows#>>'{0,clinic}' is distinct from 'Linked identity clinic' then raise exception 'Clinic must belong to the member';end if;
 perform pg_temp.chat_identity_actor(current_setting('test.chat_outsider')::uuid);
 denied:=public.staff_chat_member_identities(array['a9100000-0000-4000-8000-000000000001'::uuid]);
 missing:=public.staff_chat_member_identities(array['a9100000-0000-4000-8000-000000000099'::uuid]);
 if denied<>'[]'::jsonb or denied is distinct from missing then raise exception 'Denied identity responses reveal member existence';end if;
 if public.staff_chat_member_identities(array[current_setting('test.chat_outsider')::uuid])<>'[]'::jsonb then raise exception 'Staff ID probe leaked';end if;
end$$;
reset role;
-- Audit reads run as the test owner, never granting staff access to the audit table.
do $$declare actor uuid;expected_role text;begin
 foreach actor in array array[current_setting('test.chat_doctor')::uuid,current_setting('test.chat_nurse')::uuid,current_setting('test.chat_admin')::uuid]loop
  expected_role:=case actor when current_setting('test.chat_doctor')::uuid then 'doctor' when current_setting('test.chat_nurse')::uuid then 'nurse' else 'admin' end;
  if (select count(*) from public.access_audit where actor_id=actor and actor_role=expected_role
   and session_id=actor::text and surface='chat_member_identities'
   and member_id in('a9100000-0000-4000-8000-000000000001'::uuid,'a9100000-0000-4000-8000-000000000002'::uuid)
   and object_id=case when expected_role='admin' then 'admin-masked' else 'allowed' end)<>2
  then raise exception 'Allowed or admin-masked identity audit missing actor, role, member or outcome';end if;
 end loop;
 actor:=current_setting('test.chat_outsider')::uuid;
 if not exists(select 1 from public.access_audit where actor_id=actor and actor_role='doctor' and session_id=actor::text
  and member_id='a9100000-0000-4000-8000-000000000001' and surface='chat_member_identities' and object_id='not assigned')
 or not exists(select 1 from public.access_audit where actor_id=actor and actor_role='doctor' and session_id=actor::text
  and member_id='a9100000-0000-4000-8000-000000000099' and surface='chat_member_identities' and object_id='not found')
 or not exists(select 1 from public.access_audit where actor_id=actor and actor_role='doctor' and session_id=actor::text
  and member_id=actor and surface='chat_member_identities' and object_id='not found')
 then raise exception 'Denied identity probe audit missing actor, role, member or outcome';end if;
end$$;
-- An unconfirmed phone and a revoked nurse assignment do not retain full-phone access.
update auth.users set phone_confirmed_at=null where id='a9100000-0000-4000-8000-000000000001';
update public.patient_clinical_cases set assigned_nurse_id=null where user_id='a9100000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.chat_identity_actor(current_setting('test.chat_doctor')::uuid);
do $$declare rows jsonb;begin
 rows:=public.staff_chat_member_identities(array['a9100000-0000-4000-8000-000000000001'::uuid]);
 if rows#>'{0,phone}' is not null or rows#>'{0,phoneLast4}' is distinct from 'null'::jsonb then raise exception 'Unconfirmed phone leaked';end if;
end$$;
select pg_temp.chat_identity_actor(current_setting('test.chat_nurse')::uuid);
do $$begin
 if public.staff_chat_member_identities(array['a9100000-0000-4000-8000-000000000002'::uuid])<>'[]'::jsonb then raise exception 'Revoked nurse identity leaked';end if;
end$$;
reset role;
rollback;
\echo 'Doctor chat identity payload: care team full phone, admin masked, indistinguishable denials, every requested ID audited, linked clinic and revoked/unconfirmed access passed.'
