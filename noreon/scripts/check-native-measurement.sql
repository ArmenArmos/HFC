begin;
insert into auth.users(id,phone,phone_confirmed_at) values('b9e00000-0000-4000-8000-000000000001','37499000771',now()),('b9e00000-0000-4000-8000-000000000002','37499000772',now());
update public.profiles set display_name='Fictional member',birth_date='1980-01-01',biological_sex='female' where id='b9e00000-0000-4000-8000-000000000001';
insert into public.patient_consents(user_id,version) values('b9e00000-0000-4000-8000-000000000001','patient-pilot-v1');
insert into public.patient_assessments(user_id) values('b9e00000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub','b9e00000-0000-4000-8000-000000000001',true);
do $$ declare first_id uuid;again uuid;sid uuid:='b9e10000-0000-4000-8000-000000000001';begin
 first_id:=public.record_patient_measurement(sid,120,80,null,now());
 again:=public.record_patient_measurement(sid,120,80,null,now());
 if first_id is null or first_id<>again then raise exception 'TEST: retry duplicated';end if;
 if (select count(*) from public.patient_measurements where submission_id=sid)<>1 then raise exception 'TEST: duplicate reading';end if;
 begin perform public.record_patient_measurement(sid,121,80,null,now());raise exception 'TEST: conflict accepted';exception when others then if sqlerrm<>'measurement conflict' then raise;end if;end;
 begin perform public.record_patient_measurement(gen_random_uuid(),80,120,null,now());raise exception 'TEST: reversed values';exception when others then if sqlerrm<>'invalid measurement' then raise;end if;end;
 begin perform public.record_patient_measurement(gen_random_uuid(),120,80,0,now());raise exception 'TEST: pulse';exception when others then if sqlerrm<>'invalid measurement' then raise;end if;end;
 begin perform public.record_patient_measurement(gen_random_uuid(),120,80,null,now()+interval '6 minutes');raise exception 'TEST: future';exception when others then if sqlerrm<>'invalid measurement' then raise;end if;end;
 begin perform public.record_patient_measurement(gen_random_uuid(),120,80,null,'infinity');raise exception 'TEST: infinity';exception when others then if sqlerrm<>'invalid measurement' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','b9e00000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from public.patient_measurements) then raise exception 'TEST: cross-owner read';end if;
 begin perform public.record_patient_measurement(gen_random_uuid(),120,80,null,now());raise exception 'TEST: unregistered write';exception when others then if sqlerrm<>'verified membership required' then raise;end if;end;
end $$;
reset role;
update auth.users set phone_confirmed_at=null where id='b9e00000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','b9e00000-0000-4000-8000-000000000001',true);
do $$ begin
 begin perform public.record_patient_measurement(gen_random_uuid(),120,80,null,now());raise exception 'TEST: unverified write';exception when others then if sqlerrm<>'verified membership required' then raise;end if;end;
 if has_table_privilege('authenticated','public.patient_measurements','INSERT') then raise exception 'TEST: broad write grant';end if;
 if has_function_privilege('anon','public.record_patient_measurement(uuid,integer,integer,integer,timestamptz)','EXECUTE') then raise exception 'TEST: anonymous RPC';end if;
end $$;
reset role;
update auth.users set phone_confirmed_at=now() where id='b9e00000-0000-4000-8000-000000000001';
delete from public.patient_consents where user_id='b9e00000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 begin perform public.record_patient_measurement(gen_random_uuid(),120,80,null,now());raise exception 'TEST: missing consent accepted';exception when others then if sqlerrm<>'verified membership required' then raise;end if;end;
end $$;
reset role;
insert into public.patient_consents(user_id,version) values('b9e00000-0000-4000-8000-000000000001','patient-pilot-v1');
delete from public.patient_assessments where user_id='b9e00000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 begin perform public.record_patient_measurement(gen_random_uuid(),120,80,null,now());raise exception 'TEST: missing assessment accepted';exception when others then if sqlerrm<>'verified membership required' then raise;end if;end;
end $$;
rollback;
