\set ON_ERROR_STOP on
begin isolation level repeatable read;
create temp table paging_fixture as select gen_random_uuid() d,gen_random_uuid() n,gen_random_uuid() a,gen_random_uuid() m,gen_random_uuid() c,gen_random_uuid() sid,gen_random_uuid() late_task,gen_random_uuid() late_member,(select count(*) from public.patient_clinical_cases) base_count;
grant select on paging_fixture to authenticated;
insert into auth.users(id,phone,phone_confirmed_at) select id,id::text,now() from paging_fixture cross join lateral unnest(array[d,n,a,m,late_member]) id;
insert into public.workspace_clinics(id,name) select c,'Fictional paging clinic' from paging_fixture;
insert into public.workspace_staff(user_id,role,display_name,clinic_id) select d,'doctor','Paging doctor',c from paging_fixture union all select n,'nurse','Paging nurse',c from paging_fixture union all select a,'admin','Paging admin',null from paging_fixture;
insert into auth.sessions(id,user_id,created_at,updated_at) select sid,a,now(),now() from paging_fixture;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id,created_at) select m,d,n,now()-interval '3 days' from paging_fixture union all select late_member,d,n,now() from paging_fixture;
update public.profiles set display_name='Find this later member' where id=(select late_member from paging_fixture);
-- 210 earlier historical rows must not consume the active/orphan page.
insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,creator_id,owner_id,status,created_at) select gen_random_uuid(),f.m,'contact-followup','Historical task','Historical instructions',f.d,f.n,'completed',now()-interval '2 days' from paging_fixture f cross join generate_series(1,210);
insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,creator_id,owner_id,created_at) select late_task,late_member,'contact-followup','Later active task','Later instructions',d,n,now() from paging_fixture;
select set_config('request.jwt.claim.sub',a::text,true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','session_id',sid,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true) from paging_fixture;
set local role authenticated;
do $$declare page jsonb;cursor jsonb;count_rows integer:=0;late jsonb;begin
 loop
  page:=public.patient_coordination_queue(null,'active',case when cursor is null then null else (cursor->>'createdAt')::timestamptz end,case when cursor is null then null else (cursor->>'id')::uuid end,50);
  select task into late from jsonb_array_elements(page->'tasks') task where task->>'id'=(select late_task::text from paging_fixture);
  exit when late is not null;cursor:=page->'nextCursor';exit when cursor='null'::jsonb;
 end loop;
 if late is null then raise exception 'TEST active task hidden by historical rows';end if;
 if jsonb_array_length(late->'eligibleOwners')<>2 then raise exception 'TEST repair owners absent from late task';end if;
 cursor:=null;
 loop
  page:=public.patient_coordination_queue((select m from paging_fixture),'completed',case when cursor is null then null else (cursor->>'createdAt')::timestamptz end,case when cursor is null then null else (cursor->>'id')::uuid end,50);
  count_rows:=count_rows+jsonb_array_length(page->'tasks');cursor:=page->'nextCursor';exit when cursor='null'::jsonb;
 end loop;
 if count_rows<>210 then raise exception 'TEST completed task paging unreachable or duplicated %',count_rows;end if;
end$$;
reset role;
update public.patient_clinical_cases set assigned_nurse_id=null where user_id=(select late_member from paging_fixture);
set local role authenticated;
do $$declare page jsonb;begin page:=public.patient_coordination_queue((select late_member from paging_fixture),'reassign',null,null,50);if jsonb_array_length(page->'tasks')<>1 or not (page#>>'{tasks,0,needsReassignment}')::boolean then raise exception 'TEST orphan hidden after historical cap';end if;end$$;
reset role;
-- More than 200 cases, with a later member searchable and reachable through pages.
do $$declare f record;id uuid;begin select * into f from paging_fixture;for i in 1..210 loop id:=gen_random_uuid();insert into auth.users(id,phone,phone_confirmed_at) values(id,id::text,now());insert into public.patient_clinical_cases(user_id,assigned_doctor_id,created_at) values(id,f.d,now()-interval '1 day');end loop;end$$;
set local role authenticated;
do $$declare page jsonb;cursor jsonb;count_rows integer:=0;begin
 page:=public.patient_coordination_members('Find this later member',null,null,50);
 if jsonb_array_length(page->'members')<>1 or page#>>'{members,0,name}'<>'Find this later member' then raise exception 'TEST later member not searchable';end if;
 loop
 page:=public.patient_coordination_members('',case when cursor is null then null else (cursor->>'createdAt')::timestamptz end,case when cursor is null then null else (cursor->>'id')::uuid end,50);
 count_rows:=count_rows+jsonb_array_length(page->'members');cursor:=page->'nextCursor';exit when cursor='null'::jsonb;
 end loop;
 if count_rows<>(select base_count+212 from paging_fixture) then raise exception 'TEST member pages unreachable or duplicated %',count_rows;end if;
end$$;
reset role;
rollback;
