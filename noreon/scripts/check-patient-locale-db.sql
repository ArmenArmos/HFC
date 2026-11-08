\set ON_ERROR_STOP on
begin;
insert into auth.users(id,phone,phone_confirmed_at) values('10000000-0000-4000-8000-000000000001','37499000101',now()),('10000000-0000-4000-8000-000000000002','37499000102',now());
update public.profiles set display_name='Fictional member',birth_date='1974-05-18',biological_sex='male',locale='en' where id='10000000-0000-4000-8000-000000000001';
insert into public.patient_consents(user_id,version) values('10000000-0000-4000-8000-000000000001','patient-pilot-v1');
insert into public.patient_assessments(user_id,revision,completed_at,answers) values('10000000-0000-4000-8000-000000000001',4,now(),'{"preserved":"answer"}');
create temporary table locale_snapshot as select to_jsonb(p)-'locale' profile,(select to_jsonb(a) from public.patient_assessments a where a.user_id=p.id) assessment,(select to_jsonb(c) from public.patient_consents c where c.user_id=p.id) consent from public.profiles p where id='10000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
 if public.save_patient_locale('hy','en',4)<>4 then raise exception 'TEST locale save failed'; end if;
 if public.save_patient_locale('en','en',4)<>-1 then raise exception 'TEST stale locale accepted'; end if;
 if public.save_patient_locale('en','hy',3)<>-1 then raise exception 'TEST stale assessment accepted'; end if;
 begin perform public.save_patient_locale('fr','hy',4);raise exception 'TEST unsupported locale accepted';exception when others then if sqlerrm like 'TEST%' then raise;end if;end;
 begin perform public.save_patient_locale(null,'hy',4);raise exception 'TEST null locale accepted';exception when others then if sqlerrm like 'TEST%' then raise;end if;end;
end $$;
reset role;
do $$ begin
 if (select locale from public.profiles where id='10000000-0000-4000-8000-000000000001')<>'hy' then raise exception 'TEST locale missing';end if;
 if exists(select 1 from locale_snapshot s where s.profile<>(select to_jsonb(p)-'locale' from public.profiles p where id='10000000-0000-4000-8000-000000000001') or s.assessment<>(select to_jsonb(a) from public.patient_assessments a where user_id='10000000-0000-4000-8000-000000000001') or s.consent<>(select to_jsonb(c) from public.patient_consents c where user_id='10000000-0000-4000-8000-000000000001')) then raise exception 'TEST non-locale data changed';end if;
 if has_function_privilege('anon','public.save_patient_locale(text,text,bigint)','execute') or has_function_privilege('authenticated','public.workspace_save_member_locale(uuid,integer,bigint,text,text)','execute') then raise exception 'TEST excess privilege';end if;
end $$;
update auth.users set phone_confirmed_at=null where id='10000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 begin perform public.save_patient_locale('en','hy',4);raise exception 'TEST unconfirmed phone accepted';exception when others then if sqlerrm like 'TEST%' then raise;end if;end;
end $$;
reset role;
update auth.users set phone=null,phone_confirmed_at=now() where id='10000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 begin perform public.save_patient_locale('en','hy',4);raise exception 'TEST email-only identity accepted';exception when others then if sqlerrm like 'TEST%' then raise;end if;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin
 begin perform public.save_patient_locale('en','hy',4);raise exception 'TEST another owner accepted';exception when others then if sqlerrm like 'TEST%' then raise;end if;end;
end $$;
reset role;
insert into public.workspace_cases(id,state,revision,expires_at) values('10000000-0000-4000-8000-000000000003','{"version":1,"userId":"10000000-0000-4000-8000-000000000003","state":{"profile":{"userId":"10000000-0000-4000-8000-000000000003","locale":"en"},"consentAccepted":true,"assessment":{"revision":4,"completedAt":"kept","answers":{"kept":1}}},"care":{"kept":true}}',7,now()+interval '1 day');
create temporary table shared_locale_snapshot as select state from public.workspace_cases where id='10000000-0000-4000-8000-000000000003';
set local role service_role;
do $$ begin
 if public.workspace_save_member_locale('10000000-0000-4000-8000-000000000003',7,4,'en','hy')<>8 then raise exception 'TEST shared save failed';end if;
 if public.workspace_save_member_locale('10000000-0000-4000-8000-000000000003',7,4,'hy','en')<>-1 then raise exception 'TEST shared stale accepted';end if;
end $$;
reset role;
do $$ begin
 if (select state from public.workspace_cases where id='10000000-0000-4000-8000-000000000003')<>(select jsonb_set(state,'{state,profile,locale}','"hy"') from shared_locale_snapshot) then raise exception 'TEST shared non-locale data changed';end if;
end $$;
update public.workspace_cases set expires_at=now()-interval '1 day' where id='10000000-0000-4000-8000-000000000003';
set local role service_role;
do $$ begin
 begin perform public.workspace_save_member_locale('10000000-0000-4000-8000-000000000003',8,4,'hy','en');raise exception 'TEST expired accepted';exception when others then if sqlerrm like 'TEST%' then raise;end if;end;
end $$;
reset role;
rollback;
\echo Locale SQL owner/revision/expiry/privilege and exact data preservation checks pass.
