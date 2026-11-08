begin;
do $$ begin
 if not exists(select 1 from public.patient_message_spend_policy where id=1 and not enabled and currency is null) then raise exception 'TEST: policy must start disabled';end if;
 if has_function_privilege('service_role','public.begin_patient_message_submission(uuid)','EXECUTE') then raise exception 'TEST: stale worker bypass';end if;
 if has_table_privilege('service_role','public.patient_message_spend_policy','UPDATE') or has_table_privilege('authenticated','public.patient_message_spend_reservations','SELECT') then raise exception 'TEST: spend grants';end if;
end $$;
set local role service_role;
select public.configure_patient_message_spend(0,'{"enabled":true,"currency":"USD","daily_limit_micros":6000,"sms_segment_ceiling_micros":1000,"whatsapp_message_ceiling_micros":2000,"max_sms_segments":3,"allowed_prefixes":["+374"]}'::jsonb || jsonb_build_object('valid_until',clock_timestamp()+interval '1 day'),'test-operator');
reset role;
do $$ begin
 if not exists(select 1 from public.patient_message_spend_policy where revision=1 and enabled and currency='USD') then raise exception 'TEST: configuration missing';end if;
 if not exists(select 1 from public.patient_message_spend_policy_events where revision=1 and operator_label='test-operator') then raise exception 'TEST: policy audit missing';end if;
 if public.configure_patient_message_spend(0,'{}','test-operator') then raise exception 'TEST: stale policy update accepted';end if;
 begin perform public.configure_patient_message_spend(1,'{"enabled":true,"currency":"USD","daily_limit_micros":1.5}','test-operator');raise exception 'TEST: malformed policy accepted';exception when others then if sqlerrm<>'invalid' then raise;end if;end;
end $$;
do $$ declare uid uuid;plan uuid;jobs uuid[]:='{}';j uuid;a uuid;b uuid;r bigint;original jsonb;before_count integer;begin
 select started_count into before_count from public.patient_message_dispatch_control where id=1;
 for n in 1..4 loop
  uid:=gen_random_uuid();plan:=gen_random_uuid();
  insert into auth.users(id,phone,phone_confirmed_at) values(uid,(case when n=4 then '4499009' else '37499009' end)||lpad(n::text,3,'0'),now());
  update public.profiles set display_name='Fictional spending member',birth_date='1980-01-01',biological_sex='female' where id=uid;
  insert into public.patient_consents(user_id,version) values(uid,'patient-pilot-v1');
  insert into public.patient_message_preferences(user_id,revision,channel,verified_phone,consent_version,consented_at) values(uid,1,'sms','+'||(case when n=4 then '4499009' else '37499009' end)||lpad(n::text,3,'0'),'messaging-service-v1',now());
  insert into public.patient_reminder_preferences(user_id,revision,preferences) values(uid,1,'{"medicationEnabled":true,"medicationOffsetMinutes":0,"bpEnabled":false,"bpTimes":["08:00"],"quietStart":"00:00","quietEnd":"00:00"}');
  insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at) values(plan,uid,'Fictional GP','Fictional only',now());
  jobs:=array_append(jobs,public.enqueue_patient_plan_message(plan));
 end loop;
 j:=jobs[1];
 begin perform * from public.begin_patient_message_submission_budgeted(j,0,array['sms','whatsapp']);raise exception 'TEST: revision race allowed';exception when others then if sqlerrm<>'message spending revision' then raise;end if;end;
 update public.patient_message_outbox set created_at=created_at-interval '1 minute' where id=jobs[4];
 if (select job_id from public.patient_message_queue_candidates(1))<>jobs[4] then raise exception 'TEST: blocked fixture not queue head';end if;
 if exists(select 1 from public.begin_patient_message_submission_budgeted(jobs[4],1,array['sms','whatsapp'])) then raise exception 'TEST: unsupported destination allowed';end if;
 if not exists(select 1 from public.patient_message_outbox where id=jobs[4] and state='cancelled' and cancellation_reason='destination-blocked' and cancellation_policy_revision=1) then raise exception 'TEST: blocked destination not cancelled with reason';end if;
 if exists(select 1 from public.patient_message_queue_candidates(25) where job_id=jobs[4]) then raise exception 'TEST: blocked job still poisons queue';end if;
 if (select started_count from public.patient_message_dispatch_control where id=1)<>before_count then raise exception 'TEST: blocked destination consumed daily count';end if;
 if exists(select 1 from public.patient_message_attempts where job_id=jobs[4]) or exists(select 1 from public.patient_message_spend_reservations) or (select state from public.patient_message_outbox where id=j)<>'queued' then raise exception 'TEST: denied reservation leaked attempt';end if;

 select attempt_id into a from public.begin_patient_message_submission_budgeted(j,1,array['sms','whatsapp']);
 if a is null or (select amount_micros from public.patient_message_spend_reservations where attempt_id=a)<>3000 then raise exception 'TEST: first monetary reservation missing';end if;
 if exists(select 1 from public.begin_patient_message_submission_budgeted(j,1,array['sms','whatsapp'])) then raise exception 'TEST: duplicate spent again';end if;
 perform public.finish_patient_message_submission(a,'accepted','SM'||repeat('a',32));
 select attempt_id into b from public.begin_patient_message_submission_budgeted(jobs[2],1,array['sms','whatsapp']);
 perform public.finish_patient_message_submission(b,'failed',null);
 if (select reserved_micros from public.patient_message_spend_totals where currency='USD' and budget_day=(clock_timestamp() at time zone 'UTC')::date)<>6000 then raise exception 'TEST: rejected attempt released reservation';end if;
 select revision into r from public.patient_message_dispatch_control where id=1;
 perform public.resume_patient_message_dispatch(r,'configuration-checked',null,'test-operator');
 begin perform * from public.begin_patient_message_submission_budgeted(jobs[3],1,array['sms','whatsapp']);raise exception 'TEST: budget exceeded';exception when others then if sqlerrm<>'message spending limit' then raise;end if;end;
 if exists(select 1 from public.patient_message_attempts where job_id=jobs[3]) then raise exception 'TEST: budget failure leaked attempt';end if;
 select jsonb_build_object('enabled',p.enabled,'currency',p.currency,'daily_limit_micros',p.daily_limit_micros,'sms_segment_ceiling_micros',p.sms_segment_ceiling_micros,'whatsapp_message_ceiling_micros',p.whatsapp_message_ceiling_micros,'max_sms_segments',p.max_sms_segments,'allowed_prefixes',p.allowed_prefixes,'valid_until',p.valid_until) into original from public.patient_message_spend_policy p where id=1;
 begin perform public.configure_patient_message_spend(1,original||'{"currency":"EUR"}','test-operator');raise exception 'TEST: currency reinterpreted';exception when others then if sqlerrm<>'message currency locked' then raise;end if;end;
 update public.patient_message_spend_policy set valid_until=clock_timestamp()-interval '1 second' where id=1;
 begin perform * from public.begin_patient_message_submission_budgeted(jobs[3],1,array['sms','whatsapp']);raise exception 'TEST: expired rate allowed';exception when others then if sqlerrm<>'message spending unconfigured' then raise;end if;end;
 if not public.configure_patient_message_spend(1,'{"enabled":false}','test-operator') then raise exception 'TEST: operator cannot disable';end if;
 if (select count(*) from public.patient_message_spend_reservations)<>2 then raise exception 'TEST: disabling changed history';end if;
 -- Move the two synthetic prior reservations to yesterday to exercise rollover.
 insert into public.patient_message_spend_totals(budget_day,currency,reserved_micros) select budget_day-1,currency,reserved_micros from public.patient_message_spend_totals;
 update public.patient_message_spend_reservations set budget_day=budget_day-1;
 delete from public.patient_message_spend_totals where budget_day=(clock_timestamp() at time zone 'UTC')::date;
 if not public.configure_patient_message_spend(2,original,'test-operator') then raise exception 'TEST: could not renew same currency';end if;
 select attempt_id into a from public.begin_patient_message_submission_budgeted(jobs[3],3,array['sms','whatsapp']);
 if a is null or (select reserved_micros from public.patient_message_spend_totals where budget_day=(clock_timestamp() at time zone 'UTC')::date)<>3000 then raise exception 'TEST: daily rollover failed';end if;
 if (select reserved_micros from public.patient_message_spend_totals where budget_day=(clock_timestamp() at time zone 'UTC')::date-1)<>6000 then raise exception 'TEST: rollover erased earlier money';end if;
 begin perform public.configure_patient_message_spend(3,original||'{"currency":"EUR"}','test-operator');raise exception 'TEST: currency reset after rollover';exception when others then if sqlerrm<>'message currency locked' then raise;end if;end;

end $$;
rollback;
