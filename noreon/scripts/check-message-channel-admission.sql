\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values('b9700000-0000-4000-8000-000000000001');
insert into public.patient_care_plans(id,user_id,clinician,instructions) values('b9710000-0000-4000-8000-000000000001','b9700000-0000-4000-8000-000000000001','Fictional GP','Fictional only');
insert into public.patient_reminder_preferences(user_id,preferences) values('b9700000-0000-4000-8000-000000000001','{"quietStart":"00:00","quietEnd":"00:00"}');
do $$declare job uuid;sms uuid;source uuid;before_count bigint;begin
 for n in 1..30 loop
  source:=gen_random_uuid();
  insert into public.patient_care_plans(id,user_id,clinician,instructions,active) values(source,'b9700000-0000-4000-8000-000000000001','Fictional GP','Fictional only',false);
  insert into public.patient_message_outbox(user_id,plan_id,consent_revision,channel,created_at,expires_at) values('b9700000-0000-4000-8000-000000000001',source,1,'whatsapp',now()-interval '1 hour',now()+interval '1 hour') returning id into job;
 end loop;
 insert into public.patient_message_outbox(user_id,plan_id,consent_revision,channel,created_at,expires_at) values('b9700000-0000-4000-8000-000000000001','b9710000-0000-4000-8000-000000000001',1,'sms',now(),now()+interval '1 hour') returning id into sms;
 if (select job_id from public.patient_message_queue_candidates(1,array['sms'])) is distinct from sms then raise exception 'TEST unavailable backlog starves SMS';end if;
 select count(*) into before_count from public.patient_message_attempts;
 if exists(select 1 from public.begin_patient_message_submission_budgeted(job,0,array['sms'])) then raise exception 'TEST unavailable channel admitted';end if;
 if (select state from public.patient_message_outbox where id=job)<>'queued' or (select count(*) from public.patient_message_attempts)<>before_count then raise exception 'TEST unavailable channel changed ledger';end if;
 if exists(select 1 from public.patient_message_queue_candidates(25,array['sms']) where job_id=job) then raise exception 'TEST unavailable channel in queue';end if;
 if not exists(select 1 from public.patient_message_queue_candidates(25,array['sms','whatsapp'])) then raise exception 'TEST available channel hidden';end if;
 if exists(select 1 from public.begin_patient_message_submission_budgeted(job,0,array[]::text[])) then raise exception 'TEST empty capabilities admitted';end if;
 begin perform public.patient_message_queue_candidates(25,array['other']);raise exception 'TEST invalid capabilities accepted';exception when others then if sqlerrm<>'invalid' then raise;end if;end;
 if has_function_privilege('authenticated','public.begin_patient_message_submission_budgeted(uuid,bigint,text[])','execute') or has_function_privilege('anon','public.patient_message_queue_candidates(integer,text[])','execute') then raise exception 'TEST browser admission access';end if;
end$$;
rollback;
