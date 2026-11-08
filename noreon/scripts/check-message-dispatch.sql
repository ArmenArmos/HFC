begin;
select public.configure_patient_message_spend((select revision from public.patient_message_spend_policy where id=1),'{"enabled":true,"currency":"USD","daily_limit_micros":9000000000,"sms_segment_ceiling_micros":1000,"whatsapp_message_ceiling_micros":2000,"max_sms_segments":3,"allowed_prefixes":["+374"]}'::jsonb || jsonb_build_object('valid_until',clock_timestamp()+interval '1 day'),'test-operator');
insert into auth.users(id,phone,phone_confirmed_at) values('b9600000-0000-4000-8000-000000000001','37499000555',now());
update public.profiles set display_name='Fictional member',birth_date='1980-01-01',biological_sex='female' where id='b9600000-0000-4000-8000-000000000001';
insert into public.patient_consents(user_id,version) values('b9600000-0000-4000-8000-000000000001','patient-pilot-v1');
set local role authenticated;
select set_config('request.jwt.claim.sub','b9600000-0000-4000-8000-000000000001',true);
select public.save_patient_message_preferences('sms',0,'messaging-service-v1');
select public.save_patient_reminder_preferences('{"medicationEnabled":true,"medicationOffsetMinutes":0,"bpEnabled":false,"bpTimes":["08:00"],"quietStart":"00:00","quietEnd":"00:00"}',0);
reset role;
insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at) values('b9610000-0000-4000-8000-000000000001','b9600000-0000-4000-8000-000000000001','Fictional GP','Fictional only',now());
do $$ declare j uuid; a uuid; r record; begin
 if not public.message_is_quiet('22:00','07:00','2026-10-12T19:00:00Z') or public.message_is_quiet('22:00','07:00','2026-10-12T03:00:00Z') or not public.message_is_quiet('08:00','10:00','2026-10-12T04:00:00Z') or public.message_is_quiet('00:00','00:00',now()) then raise exception 'TEST: quiet boundaries';end if;
 j:=public.enqueue_patient_plan_message('b9610000-0000-4000-8000-000000000001');
 select * into r from public.begin_patient_message_submission_budgeted(j,(select revision from public.patient_message_spend_policy where id=1),array['sms']);
 if r.attempt_id is null or r.destination<>'+37499000555' or r.channel<>'sms' then raise exception 'TEST: eligible submission missing';end if;
 a:=r.attempt_id;
 if exists(select 1 from public.begin_patient_message_submission_budgeted(j,(select revision from public.patient_message_spend_policy where id=1),array['sms'])) then raise exception 'TEST: duplicate submission';end if;
 if not public.finish_patient_message_submission(a,'unknown',null) then raise exception 'TEST: unknown recording';end if;
 if exists(select 1 from public.begin_patient_message_submission_budgeted(j,(select revision from public.patient_message_spend_policy where id=1),array['sms'])) then raise exception 'TEST: unknown retried';end if;
 if not public.finish_patient_message_submission(a,'accepted','test-provider-ref-1') then raise exception 'TEST: unknown reconciliation';end if;
 if public.finish_patient_message_submission(a,'failed',null) then raise exception 'TEST: acceptance regressed';end if;
 if not public.finish_patient_message_submission(a,'accepted','test-provider-ref-1') then raise exception 'TEST: duplicate result not idempotent';end if;
 if public.finish_patient_message_submission(a,'accepted','different-ref') then raise exception 'TEST: provider reference overwritten';end if;
 if has_function_privilege('authenticated','public.begin_patient_message_submission(uuid)','EXECUTE') or has_function_privilege('anon','public.finish_patient_message_submission(uuid,text,text)','EXECUTE') or has_table_privilege('service_role','public.patient_message_attempts','INSERT') or has_table_privilege('authenticated','public.patient_message_attempts','SELECT') then raise exception 'TEST: excessive dispatch grants';end if;
end $$;
update public.patient_care_plans set active=false where user_id='b9600000-0000-4000-8000-000000000001';
-- Earlier explicit unknown pauses dispatch; operator review resumes this isolated fixture.
select public.resume_patient_message_dispatch((select revision from public.patient_message_dispatch_control where id=1),'unknown-reviewed',null,'test-operator');
-- A new event with acknowledged source must be cancelled at dispatch, even after enqueue.
insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at) values('b9610000-0000-4000-8000-000000000002','b9600000-0000-4000-8000-000000000001','Fictional GP','Fictional only',now());
select public.enqueue_patient_plan_message('b9610000-0000-4000-8000-000000000002');
update public.patient_care_plans set acknowledged_at=now() where id='b9610000-0000-4000-8000-000000000002';
do $$ declare j uuid; begin
 select id into j from public.patient_message_outbox where plan_id='b9610000-0000-4000-8000-000000000002';
 if exists(select 1 from public.begin_patient_message_submission_budgeted(j,(select revision from public.patient_message_spend_policy where id=1),array['sms'])) then raise exception 'TEST: stale source sent';end if;
 if (select state from public.patient_message_outbox where id=j)<>'cancelled' then raise exception 'TEST: stale source not cancelled';end if;
end $$;
-- Recheck mutable facts at the boundary, not only during enqueue.
do $$ declare source uuid; job uuid; mode text; r record; begin
 foreach mode in array array['phone','profile','care-consent','future','inactive','expired','quiet','stale-attempt'] loop
  update public.patient_care_plans set active=false where user_id='b9600000-0000-4000-8000-000000000001';
  source:=gen_random_uuid();
  insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at) values(source,'b9600000-0000-4000-8000-000000000001','Fictional GP','Fictional only',now());
  job:=public.enqueue_patient_plan_message(source);
  if job is null then raise exception 'TEST: test fixture not enqueued';end if;
  if mode='phone' then update auth.users set phone='37499000666' where id='b9600000-0000-4000-8000-000000000001';
  elsif mode='profile' then update public.profiles set display_name='' where id='b9600000-0000-4000-8000-000000000001';
  elsif mode='care-consent' then delete from public.patient_consents where user_id='b9600000-0000-4000-8000-000000000001';
  elsif mode='future' then update public.patient_care_plans set published_at=now()+interval '1 hour' where id=source;
  elsif mode='inactive' then update public.patient_care_plans set active=false where id=source;
  elsif mode='expired' then update public.patient_message_outbox set created_at=now()-interval '3 days',expires_at=now()-interval '1 day' where id=job;
  elsif mode='quiet' then update public.patient_reminder_preferences set preferences=jsonb_set(jsonb_set(preferences,'{quietStart}',to_jsonb(to_char(clock_timestamp() at time zone 'Asia/Yerevan','HH24:MI'))),'{quietEnd}',to_jsonb(to_char((clock_timestamp()+interval '1 hour') at time zone 'Asia/Yerevan','HH24:MI'))) where user_id='b9600000-0000-4000-8000-000000000001';
  end if;
  if mode='stale-attempt' then
   select * into r from public.begin_patient_message_submission_budgeted(job,(select revision from public.patient_message_spend_policy where id=1),array['sms','whatsapp']);
   if r.attempt_id is null then raise exception 'TEST: missing stale fixture';end if;
   update public.patient_message_attempts set started_at=clock_timestamp()-interval '3 minutes' where id=r.attempt_id;
   if public.mark_stale_patient_message_submissions()<>1 then raise exception 'TEST: stale attempt not swept';end if;
   if (select status from public.patient_message_attempts where id=r.attempt_id)<>'unknown' then raise exception 'TEST: stale attempt not unknown';end if;
   if exists(select 1 from public.begin_patient_message_submission_budgeted(job,(select revision from public.patient_message_spend_policy where id=1),array['sms','whatsapp'])) then raise exception 'TEST: stale attempt resubmitted';end if;
   if not public.finish_patient_message_submission(r.attempt_id,'failed',null) then raise exception 'TEST: definitive failure could not resolve unknown';end if;
  else
   if exists(select 1 from public.begin_patient_message_submission_budgeted(job,(select revision from public.patient_message_spend_policy where id=1),array['sms','whatsapp'])) then raise exception 'TEST: invalid or quiet dispatch: %',mode;end if;
   if (select state from public.patient_message_outbox where id=job)<>(case when mode='quiet' then 'queued' else 'cancelled' end) then raise exception 'TEST: wrong rejection state: %',mode;end if;
  end if;
  update auth.users set phone='37499000555' where id='b9600000-0000-4000-8000-000000000001';
  update public.profiles set display_name='Fictional member' where id='b9600000-0000-4000-8000-000000000001';
  insert into public.patient_consents(user_id,version) values('b9600000-0000-4000-8000-000000000001','patient-pilot-v1') on conflict do nothing;
  update public.patient_reminder_preferences set preferences=jsonb_set(jsonb_set(preferences,'{quietStart}','"00:00"'),'{quietEnd}','"00:00"') where user_id='b9600000-0000-4000-8000-000000000001';
 end loop;
end $$;
-- Account deletion preserves minimal evidence without an owner/clinical-source link.
delete from auth.users where id='b9600000-0000-4000-8000-000000000001';
do $$ begin
 if not exists(select 1 from public.patient_message_attempts where provider_reference='test-provider-ref-1' and user_id is null and job_id is null) then raise exception 'TEST: submission evidence erased';end if;
end $$;
rollback;
