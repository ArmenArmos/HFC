begin;
insert into auth.users(id,phone,phone_confirmed_at) values('b9900000-0000-4000-8000-000000000001','37499000888',now());
update public.profiles set display_name='Fictional member',birth_date='1980-01-01',biological_sex='female' where id='b9900000-0000-4000-8000-000000000001';
insert into public.patient_consents(user_id,version) values('b9900000-0000-4000-8000-000000000001','patient-pilot-v1');
set local role authenticated;
select set_config('request.jwt.claim.sub','b9900000-0000-4000-8000-000000000001',true);
select public.save_patient_message_preferences('sms',0,'messaging-service-v1');
reset role;
insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at) values('b9910000-0000-4000-8000-000000000001','b9900000-0000-4000-8000-000000000001','Fictional GP','Fictional only',now()+interval '1 hour');
do $$ begin
 if exists(select 1 from public.patient_plan_message_candidates(null,null,100)) then raise exception 'TEST: scheduled plan queued early';end if;
end $$;
update public.patient_care_plans set published_at=now() where id='b9910000-0000-4000-8000-000000000001';
do $$ declare r record;begin
 select * into r from public.patient_plan_message_candidates(null,null,100);
 if r.plan_id is distinct from 'b9910000-0000-4000-8000-000000000001'::uuid then raise exception 'TEST: due plan not discovered';end if;
 if exists(select 1 from public.patient_plan_message_candidates(r.published_at,r.plan_id,100)) then raise exception 'TEST: keyset repeats candidate';end if;
 perform public.enqueue_patient_plan_message(r.plan_id);
 if exists(select 1 from public.patient_plan_message_candidates(null,null,100)) then raise exception 'TEST: existing logical event rediscovered';end if;
 if has_function_privilege('authenticated','public.patient_plan_message_candidates(timestamptz,uuid,integer)','EXECUTE') then raise exception 'TEST: member can enumerate sources';end if;
end $$;
-- More than one page of quiet jobs cannot hide an eligible later job.
do $$ declare uid uuid; source uuid; eligible uuid; quiet_job uuid;begin
 for n in 1..31 loop
  uid:=gen_random_uuid();source:=gen_random_uuid();
  insert into auth.users(id) values(uid);
  insert into public.patient_care_plans(id,user_id,clinician,instructions) values(source,uid,'Fictional GP','Fictional only');
  insert into public.patient_message_outbox(user_id,plan_id,consent_revision,channel,created_at,expires_at) values(uid,source,1,'sms',now()-interval '1 hour'+n*interval '1 second',now()+interval '1 hour') returning id into quiet_job;
  insert into public.patient_reminder_preferences(user_id,preferences) values(uid,jsonb_build_object('quietStart',case when n=31 then '00:00' else to_char(now() at time zone 'Asia/Yerevan','HH24:MI') end,'quietEnd',case when n=31 then '00:00' else to_char((now()+interval '1 hour') at time zone 'Asia/Yerevan','HH24:MI') end));
  if n=31 then eligible:=quiet_job;end if;
 end loop;
 if not exists(select 1 from public.patient_message_queue_candidates(25) where job_id=eligible) then raise exception 'TEST: quiet backlog starves eligible job';end if;
 if has_function_privilege('authenticated','public.patient_message_queue_candidates(integer)','EXECUTE') then raise exception 'TEST: member can enumerate queue';end if;
end $$;
rollback;
