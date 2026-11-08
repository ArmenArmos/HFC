-- Explicit isolated replay/CI only. All synthetic changes roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.setting_actor(id uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated','session_id',id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
end$$;
create function pg_temp.reject_setting(q text,code text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=code then return;end if;raise;end;
 raise exception 'Expected rejection % for %',code,q;
end$$;
do $$declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();c uuid:=gen_random_uuid();i uuid;begin
 perform set_config('test.settings_admin',a::text,true);perform set_config('test.settings_other_admin',b::text,true);perform set_config('test.settings_clinic',c::text,true);
 insert into auth.users(id,email) values(a,a||'@example.invalid'),(b,b||'@example.invalid');
 insert into auth.sessions(id,user_id,created_at,updated_at) values(a,a,clock_timestamp(),clock_timestamp()),(b,b,clock_timestamp(),clock_timestamp());
 insert into public.workspace_staff(user_id,role,display_name) values(a,'admin','Synthetic settings admin'),(b,'admin','Other synthetic admin');
 insert into public.workspace_clinics(id,name) values(c,'Synthetic settings clinic');
 i:=gen_random_uuid();perform set_config('test.settings_inactive_clinic',i::text,true);
 insert into public.workspace_clinics(id,name,active)values(i,'Synthetic inactive settings clinic',false);
 for i in select gen_random_uuid() from generate_series(1,4) loop
  insert into auth.users(id,email) values(i,i||'@example.invalid');insert into auth.sessions(id,user_id,created_at,updated_at)values(i,i,clock_timestamp(),clock_timestamp());
  if current_setting('test.settings_doctor',true) is null then
   perform set_config('test.settings_doctor',i::text,true);insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(i,'doctor','Doctor',c);
  elsif current_setting('test.settings_nurse',true) is null then
   perform set_config('test.settings_nurse',i::text,true);insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(i,'nurse','Nurse',c);
  elsif current_setting('test.settings_member',true) is null then perform set_config('test.settings_member',i::text,true);
  else perform set_config('test.settings_inactive',i::text,true);insert into public.workspace_staff(user_id,role,display_name,active)values(i,'admin','Inactive admin',false);end if;
 end loop;
end$$;
-- A request already used by another admin operation forces a late audit failure.
do $$declare req uuid:=gen_random_uuid();begin
 perform set_config('test.settings_collision',req::text,true);
 insert into public.real_staff_admin_events(actor_id,request_id,kind) values(current_setting('test.settings_admin')::uuid,req,'clinic_created');
end$$;
set local role authenticated;
select pg_temp.setting_actor(current_setting('test.settings_admin')::uuid);
do $$declare c uuid:=current_setting('test.settings_clinic');r jsonb;r2 jsonb;req uuid:=gen_random_uuid();begin
 if (public.real_admin_scheduling_copy_settings()->'email')<>'null'::jsonb then raise exception 'Copy must initially be unconfigured';end if;
 perform pg_temp.reject_setting(format('select public.real_admin_update_clinic_scheduling_email(%L,0,%L,%L)',current_setting('test.settings_inactive_clinic'),gen_random_uuid(),'inactive@example.invalid'),'42501');
 perform pg_temp.reject_setting(format('select public.real_admin_update_clinic_scheduling_email(%L,0,%L,%L)',gen_random_uuid(),gen_random_uuid(),'missing@example.invalid'),'42501');
 r:=public.real_admin_update_clinic_scheduling_email(c,0,req,' clinic@example.invalid ');
 if r<>jsonb_build_object('id',c,'email','clinic@example.invalid','revision',1) then raise exception 'Incorrect saved result %',r;end if;
 perform set_config('test.settings_request',req::text,true);
 r2:=public.real_admin_update_clinic_scheduling_email(c,1,gen_random_uuid(),'new@example.invalid');
 if (r2->>'revision')::int<>2 then raise exception 'Revision did not advance';end if;
 if public.real_admin_update_clinic_scheduling_email(c,0,req,'clinic@example.invalid')<>r then raise exception 'Replay must return original outcome after later changes';end if;
 perform pg_temp.reject_setting(format('select public.real_admin_update_clinic_scheduling_email(%L,0,%L,%L)',c,req,'different@example.invalid'),'22023');
 perform pg_temp.reject_setting(format('select public.real_admin_update_clinic_scheduling_email(%L,0,%L,%L)',c,gen_random_uuid(),'stale@example.invalid'),'40001');
 perform pg_temp.reject_setting(format('select public.real_admin_update_scheduling_copy_email(0,%L,%L)',req,'clinic@example.invalid'),'22023');
 for r2 in select to_jsonb(v) from unnest(array[E'a@example.invalid\r\nBcc:x@example.invalid','a@example.invalid,b@example.invalid','bad','a..b@example.invalid','a@-example.invalid',repeat('a',250)||'@example.invalid']) v loop
  perform pg_temp.reject_setting(format('select public.real_admin_update_clinic_scheduling_email(%L,2,%L,%L)',c,gen_random_uuid(),r2#>>'{}'),'22023');
 end loop;
 perform pg_temp.reject_setting(format('select public.real_admin_update_clinic_scheduling_email(%L,2,%L,%L)',c,current_setting('test.settings_collision'),'rollback@example.invalid'),'23505');
 perform pg_temp.reject_setting(format('select public.real_admin_update_clinic_scheduling_email(%L,2,null,%L)',c,'none@example.invalid'),'22023');
 perform pg_temp.reject_setting(format('select public.real_admin_update_clinic_scheduling_email(%L,null,%L,%L)',c,gen_random_uuid(),'none@example.invalid'),'22023');
 r2:=public.real_admin_update_clinic_scheduling_email(c,2,gen_random_uuid());
 if r2->'email'<>'null'::jsonb or r2->>'revision'<>'3' then raise exception 'Clear must persist null';end if;
 r2:=public.real_admin_update_scheduling_copy_email(0,gen_random_uuid(),'ops@example.invalid');
 if r2<>jsonb_build_object('email','ops@example.invalid','revision',1) then raise exception 'Copy not saved';end if;
 if public.real_admin_scheduling_copy_settings()<>r2 then raise exception 'Copy readback mismatch';end if;
 perform pg_temp.reject_setting(format('select public.real_admin_update_scheduling_copy_email(0,%L,%L)',gen_random_uuid(),'stale@example.invalid'),'40001');
 req:=gen_random_uuid();r:=public.real_admin_update_scheduling_copy_email(1,req,'next@example.invalid');
 perform public.real_admin_update_scheduling_copy_email(2,gen_random_uuid(),'latest@example.invalid');
 if public.real_admin_update_scheduling_copy_email(1,req,'next@example.invalid')<>r then raise exception 'Copy replay is not the immutable original result';end if;
 perform public.real_admin_update_scheduling_copy_email(3,gen_random_uuid());
 if public.real_admin_scheduling_copy_settings()->'email'<>'null'::jsonb then raise exception 'Copy clear failed';end if;
 if not exists(select from jsonb_array_elements(public.real_admin_clinics()) x where x->>'id'=c::text and x->'schedulingEmail'='null'::jsonb and x->>'schedulingRevision'='3') then raise exception 'Clinic readback mismatch';end if;
end$$;
-- Admin membership alone is insufficient without a current managed session.
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.settings_admin'),'role','authenticated')::text,true);
select pg_temp.reject_setting('select public.real_admin_scheduling_copy_settings()','42501');
select pg_temp.setting_actor(current_setting('test.settings_admin')::uuid);
-- A different administrator cannot reuse another actor's request.
select pg_temp.setting_actor(current_setting('test.settings_other_admin')::uuid);
select pg_temp.reject_setting(format('select public.real_admin_update_clinic_scheduling_email(%L,0,%L,%L)',current_setting('test.settings_clinic'),current_setting('test.settings_request'),'clinic@example.invalid'),'22023');
-- Deny all non-admin actors independently of the UI.
do $$declare who text;c uuid:=current_setting('test.settings_clinic');begin
 foreach who in array array['doctor','nurse','member','inactive'] loop
  perform pg_temp.setting_actor(current_setting('test.settings_'||who)::uuid);
  perform pg_temp.reject_setting('select public.real_admin_scheduling_copy_settings()','42501');
  if exists(select from public.workspace_clinics where id=c)then raise exception 'Non-admin direct clinic read leaked directory';end if;
  perform pg_temp.reject_setting(format('select public.real_admin_update_scheduling_copy_email(1,%L,%L)',gen_random_uuid(),'denied@example.invalid'),'42501');
  perform pg_temp.reject_setting(format('select public.real_admin_update_clinic_scheduling_email(%L,3,%L,%L)',c,gen_random_uuid(),'denied@example.invalid'),'42501');
 end loop;
 perform pg_temp.reject_setting('select * from public.workspace_scheduling_settings','42501');
 perform pg_temp.reject_setting('select * from public.clinic_scheduling_operations','42501');
end$$;
set local role anon;
select pg_temp.reject_setting('select public.real_admin_scheduling_copy_settings()','42501');
set local role service_role;
insert into public.workspace_clinics(name) values('Synthetic service-role default compatibility');
select pg_temp.reject_setting('select public.real_admin_scheduling_copy_settings()','42501');
select pg_temp.reject_setting('select * from public.workspace_scheduling_settings','42501');
reset role;
do $$declare c uuid:=current_setting('test.settings_clinic');begin
 if (select scheduling_revision from public.workspace_clinics where id=c)<>3 then raise exception 'Rejected updates modified clinic';end if;
 if (select count(*) from public.real_staff_admin_events where clinic_id=c and kind='clinic_scheduling_updated')<>3 then raise exception 'Audit must be once per successful request';end if;
 if exists(select from public.clinic_scheduling_operations where request_id=current_setting('test.settings_collision')::uuid) then raise exception 'Late audit failure must roll back the receipt';end if;
 if exists(select from public.real_staff_admin_events where kind in('clinic_scheduling_updated','scheduling_copy_updated') and details::text like '%@%') then raise exception 'Audit logs must not contain recipients';end if;
 if has_function_privilege('authenticated','public._real_admin_save_scheduling_email(text,uuid,integer,uuid,text)','EXECUTE') or has_function_privilege('anon','public._real_scheduling_email(text)','EXECUTE') then raise exception 'Internal helper permissions widened';end if;
 if has_table_privilege('authenticated','public.workspace_scheduling_settings','UPDATE') or has_table_privilege('anon','public.workspace_scheduling_settings','SELECT') then raise exception 'Direct permissions widened';end if;
end$$;
rollback;
