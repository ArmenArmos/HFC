begin;
do $$
declare doctor uuid:=gen_random_uuid();other_doctor uuid:=gen_random_uuid();admin_id uuid:=gen_random_uuid();clinic uuid:=gen_random_uuid();c uuid;other_case uuid;ids uuid[]:='{}';batch uuid[];i integer;
begin
 insert into auth.users(id) values(doctor),(other_doctor),(admin_id);
 insert into public.workspace_clinics(id,name) values(clinic,'Fictional isolation clinic');
 insert into public.workspace_staff(user_id,role,display_name,clinic_id) values(doctor,'doctor','Fictional doctor',clinic),(other_doctor,'doctor','Other fictional doctor',clinic),(admin_id,'admin','Fictional admin',null);
 for i in 1..151 loop
  c:=gen_random_uuid();
  insert into public.workspace_cases(id,assigned_doctor_id) values(c,case when i=151 then other_doctor else doctor end);
  insert into public.workspace_monitoring_requirements(case_id,created_at,starts_at,ends_at,required_count,instructions,actor_id,actor_label,source_publication,current_publication,source_snapshot)
  values(c,now()-interval '3 days',now()-interval '2 days',now()-interval '1 day'+i*interval '1 minute',1,'Fictional instruction',doctor,'Fictional doctor',1,1,'{}');
  if i<=100 then ids:=array_append(ids,c);end if;
  if i=151 then other_case:=c;end if;
 end loop;
 select array_agg(x) into batch from public.workspace_due_monitoring_cases(doctor,100,ids) x;
 if cardinality(batch)<>50 or batch&&ids or other_case=any(batch) then raise exception 'TEST: exclusion failed or actor scope leaked';end if;
 if (select count(*) from public.workspace_due_monitoring_cases(admin_id,100,ids))<>51 then raise exception 'TEST: admin did not reach later cases';end if;
 if (select count(*) from public.workspace_due_monitoring_cases(doctor,100))<>100 then raise exception 'TEST: legacy call changed';end if;
 if (select count(*) from public.workspace_due_monitoring_cases(null,100,ids))<>51 then raise exception 'TEST: scheduler did not reach later cases';end if;
 update public.workspace_cases set expires_at=now()-interval '1 second' where id=other_case;
 if (select count(*) from public.workspace_due_monitoring_cases(null,100,ids))<>50 then raise exception 'TEST: expired case included';end if;
 begin perform public.workspace_due_monitoring_cases(null,100,array_fill(c,array[1001]));raise exception 'TEST: oversized exclusion accepted';exception when others then if sqlerrm not like '%invalid exclusion%' then raise;end if;end;
 begin perform public.workspace_due_monitoring_cases(null,100,array[null::uuid]);raise exception 'TEST: null exclusion accepted';exception when others then if sqlerrm not like '%invalid exclusion%' then raise;end if;end;
 update public.workspace_staff set active=false where user_id=doctor;
 begin perform public.workspace_due_monitoring_cases(doctor,100,ids);raise exception 'TEST: inactive actor accepted';exception when others then if sqlerrm not like '%forbidden%' then raise;end if;end;
 if has_function_privilege('anon','public.workspace_due_monitoring_cases(uuid,integer,uuid[])','EXECUTE') or has_function_privilege('authenticated','public.workspace_due_monitoring_cases(uuid,integer,uuid[])','EXECUTE') or not has_function_privilege('service_role','public.workspace_due_monitoring_cases(uuid,integer,uuid[])','EXECUTE') then raise exception 'TEST: RPC grants incorrect';end if;
end $$;
rollback;
