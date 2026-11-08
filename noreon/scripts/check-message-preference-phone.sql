begin;
insert into auth.users(id,phone,phone_confirmed_at) values('b9500000-0000-4000-8000-000000000001','37499000333',now());
update public.profiles set display_name='Fictional member',birth_date='1980-01-01',biological_sex='female' where id='b9500000-0000-4000-8000-000000000001';
insert into public.patient_consents(user_id,version) values('b9500000-0000-4000-8000-000000000001','patient-pilot-v1');
set local role authenticated;
select set_config('request.jwt.claim.sub','b9500000-0000-4000-8000-000000000001',true);
do $$ begin
 begin perform public.save_patient_message_preferences_for_phone('sms',0,'messaging-service-v1','+37499000999');raise exception 'TEST: stale phone accepted';exception when others then if sqlerrm<>'phone changed' then raise;end if;end;
 if public.save_patient_message_preferences_for_phone('sms',0,'messaging-service-v1','+37499000333')<>1 then raise exception 'TEST: matching phone failed';end if;
end $$;
reset role;
update auth.users set phone='37499000444',phone_confirmed_at=null where id='b9500000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 if public.save_patient_message_preferences_for_phone('none',1,'messaging-service-v1',null)<>2 then raise exception 'TEST: opt-out blocked by changed phone';end if;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.save_patient_message_preferences_for_phone(text,integer,text,text)','EXECUTE') or has_function_privilege('service_role','public.save_patient_message_preferences_for_phone(text,integer,text,text)','EXECUTE') then raise exception 'TEST: excessive phone-guard privilege';end if;
end $$;
rollback;
