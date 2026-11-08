begin;
insert into auth.users(id,phone,phone_confirmed_at) values
 ('b9400000-0000-4000-8000-000000000001','37499000001',now()),
 ('b9400000-0000-4000-8000-000000000002','37499000002',null);
update public.profiles set display_name='Fictional member',birth_date='1980-01-01',biological_sex='female' where id in ('b9400000-0000-4000-8000-000000000001','b9400000-0000-4000-8000-000000000002');
insert into public.patient_consents(user_id,version) values('b9400000-0000-4000-8000-000000000001','patient-pilot-v1');
set local role authenticated;
select set_config('request.jwt.claim.sub','b9400000-0000-4000-8000-000000000001',true);
do $$ begin
 if public.save_patient_message_preferences('whatsapp',0,'messaging-service-v1')<>1 then raise exception 'TEST: opt-in failed';end if;
 if public.save_patient_message_preferences('whatsapp',1,'messaging-service-v1')<>1 then raise exception 'TEST: unchanged save creates revision';end if;
 if public.save_patient_message_preferences('sms',0,'messaging-service-v1')<>-1 then raise exception 'TEST: stale write accepted';end if;
 if (select verified_phone from public.patient_message_preferences)<>'+37499000001' then raise exception 'TEST: verified phone not normalized';end if;
 begin update public.patient_message_preferences set channel='sms';raise exception 'TEST: direct preference write';exception when insufficient_privilege then null;end;
 begin perform public.save_patient_message_preferences('email',1,'messaging-service-v1');raise exception 'TEST: invalid channel';exception when others then if sqlerrm<>'invalid' then raise;end if;end;
 begin perform public.save_patient_message_preferences('sms',1,'different-consent');raise exception 'TEST: unrecognized consent';exception when others then if sqlerrm<>'invalid' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','b9400000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from public.patient_message_preferences) or exists(select 1 from public.patient_message_consent_events) then raise exception 'TEST: cross member leak';end if;
 begin perform public.save_patient_message_preferences('sms',0,'messaging-service-v1');raise exception 'TEST: unverified opt-in';exception when others then if sqlerrm<>'verified membership required' then raise;end if;end;
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 begin perform public.save_patient_message_preferences('none',0,'messaging-service-v1');raise exception 'TEST: anonymous write';exception when others then if sqlerrm<>'unauthorized' then raise;end if;end;
end $$;
reset role;
insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at) values
 ('b9410000-0000-4000-8000-000000000001','b9400000-0000-4000-8000-000000000001','Fictional GP','Fictional only',now()),
 ('b9410000-0000-4000-8000-000000000002','b9400000-0000-4000-8000-000000000002','Fictional GP','Fictional only',now());
set local role service_role;
do $$ declare j uuid;begin
 j:=public.enqueue_patient_plan_message('b9410000-0000-4000-8000-000000000001');
 if j is null or j<>public.enqueue_patient_plan_message('b9410000-0000-4000-8000-000000000001') then raise exception 'TEST: enqueue not idempotent';end if;
 if public.enqueue_patient_plan_message('b9410000-0000-4000-8000-000000000002') is not null then raise exception 'TEST: opted-out foreign owner enqueued';end if;
 if public.enqueue_patient_plan_message(gen_random_uuid()) is not null then raise exception 'TEST: synthetic source accepted';end if;
 if (select count(*) from public.patient_message_outbox)<>1 then raise exception 'TEST: duplicate job';end if;
 begin delete from public.patient_message_outbox;raise exception 'TEST: service direct write';exception when insufficient_privilege then null;end;
end $$;
reset role;
update auth.users set phone='37499000003',phone_confirmed_at=null where id='b9400000-0000-4000-8000-000000000001';
do $$ begin
 if public.enqueue_patient_plan_message('b9410000-0000-4000-8000-000000000001') is not null then raise exception 'TEST: old-phone consent reused';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','b9400000-0000-4000-8000-000000000001',true);
do $$ begin
 if public.save_patient_message_preferences('none',1,'messaging-service-v1')<>2 then raise exception 'TEST: opt-out requires verified phone';end if;
 begin perform public.enqueue_patient_plan_message('b9410000-0000-4000-8000-000000000001');raise exception 'TEST: browser can enqueue';exception when insufficient_privilege then null;end;
 begin perform * from public.patient_message_outbox;raise exception 'TEST: browser reads outbox';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 if (select state from public.patient_message_outbox)<>'cancelled' then raise exception 'TEST: opt-out did not cancel';end if;
 if (select count(*) from public.patient_message_consent_events)<>2 then raise exception 'TEST: missing consent history';end if;
end $$;
update auth.users set phone='37499000001',phone_confirmed_at=now() where id='b9400000-0000-4000-8000-000000000001';
set local role authenticated;
select public.save_patient_message_preferences('sms',2,'messaging-service-v1');
reset role;
do $$ begin
 if public.enqueue_patient_plan_message('b9410000-0000-4000-8000-000000000001') is not null then raise exception 'TEST: cancelled enqueue reported success';end if;
 if (select count(*) from public.patient_message_outbox)<>1 or (select state from public.patient_message_outbox)<>'cancelled' then raise exception 'TEST: re-enable replayed cancelled event';end if;
end $$;
update public.patient_care_plans set published_at=now()+interval '1 day' where id='b9410000-0000-4000-8000-000000000001';
do $$ begin if public.enqueue_patient_plan_message('b9410000-0000-4000-8000-000000000001') is not null then raise exception 'TEST: future plan queued';end if;end $$;
update public.patient_care_plans set published_at=now(),active=false where id='b9410000-0000-4000-8000-000000000001';
do $$ begin if public.enqueue_patient_plan_message('b9410000-0000-4000-8000-000000000001') is not null then raise exception 'TEST: inactive plan queued';end if;end $$;
update public.patient_care_plans set active=true,acknowledged_at=now() where id='b9410000-0000-4000-8000-000000000001';
do $$ begin if public.enqueue_patient_plan_message('b9410000-0000-4000-8000-000000000001') is not null then raise exception 'TEST: acknowledged plan queued';end if;end $$;
do $$ begin
 if has_function_privilege('anon','public.save_patient_message_preferences(text,integer,text)','EXECUTE') or has_table_privilege('authenticated','public.patient_message_preferences','TRUNCATE') or has_table_privilege('service_role','public.patient_message_consent_events','UPDATE') then raise exception 'TEST: excessive privileges';end if;
end $$;
update public.patient_care_plans set acknowledged_at=null,published_at=now()-interval '1 hour' where id='b9410000-0000-4000-8000-000000000001';
do $$ begin if public.enqueue_patient_plan_message('b9410000-0000-4000-8000-000000000001') is not null then raise exception 'TEST: opt-in replayed an older event';end if;end $$;
update public.patient_care_plans set published_at=now()-interval '3 days' where id='b9410000-0000-4000-8000-000000000001';
do $$ begin if public.enqueue_patient_plan_message('b9410000-0000-4000-8000-000000000001') is not null then raise exception 'TEST: expired event queued';end if;end $$;
-- Model prior activity in the current hour without making test loops slow.
insert into public.patient_message_consent_events(user_id,revision,channel,consent_version)
 select 'b9400000-0000-4000-8000-000000000001',n,'sms','messaging-service-v1' from generate_series(4,30) n;
set local role authenticated;
do $$ begin
 begin perform public.save_patient_message_preferences('whatsapp',3,'messaging-service-v1');raise exception 'TEST: excessive opt-in changes';exception when others then if sqlerrm<>'too many preference changes' then raise;end if;end;
end $$;
reset role;
-- Keep the simulated audit revisions consistent before exercising opt-out.
update public.patient_message_preferences set revision=30 where user_id='b9400000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 if public.save_patient_message_preferences('none',30,'messaging-service-v1')<>31 then raise exception 'TEST: throttled opt-out';end if;
 if public.save_patient_message_preferences('none',31,'messaging-service-v1')<>31 then raise exception 'TEST: repeated opt-out creates audit spam';end if;
end $$;
reset role;
rollback;
