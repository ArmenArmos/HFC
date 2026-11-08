\set ON_ERROR_STOP on
begin;
do $$begin if to_regprocedure('public.claim_auth_sms_hook(text,text)') is null then raise exception 'TEST auth SMS claim missing';end if;end$$;
set local role service_role;
select public.configure_patient_message_spend((select revision from public.patient_message_spend_policy where id=1),'{"enabled":true,"currency":"USD","daily_limit_micros":9000000000,"sms_segment_ceiling_micros":1000000,"whatsapp_message_ceiling_micros":1000000,"max_sms_segments":1,"allowed_prefixes":["+374"]}'::jsonb||jsonb_build_object('valid_until',clock_timestamp()+interval '1 day'),'test-operator');
do $$declare r jsonb;t uuid;begin
 r:=public.claim_auth_sms_hook('test-auth-one',repeat('a',64));
 if r->>'status'<>'send' then raise exception 'TEST first hook not admitted';end if;t:=(r->>'claimToken')::uuid;
 if public.claim_auth_sms_hook('test-auth-one',repeat('a',64))->>'status'<>'submitting' then raise exception 'TEST pending duplicate sent';end if;
 begin perform public.claim_auth_sms_hook('test-auth-one',repeat('b',64));raise exception 'TEST different body accepted';exception when others then if sqlerrm<>'auth hook conflict' then raise;end if;end;
 if not public.finish_auth_sms_hook('test-auth-one',t,'accepted','12345') then raise exception 'TEST acceptance not saved';end if;
 if public.claim_auth_sms_hook('test-auth-one',repeat('a',64))->>'status'<>'accepted' then raise exception 'TEST accepted retry not recognized';end if;
 if public.finish_auth_sms_hook('test-auth-one',t,'accepted','54321') then raise exception 'TEST conflicting acceptance allowed';end if;
end$$;
reset role;
do $$declare uid uuid:=gen_random_uuid();plan uuid:=gen_random_uuid();job uuid;a uuid;begin
 insert into auth.users(id,phone,phone_confirmed_at)values(uid,'37499000201',now());
 update public.profiles set display_name='Synthetic budget check',birth_date='1980-01-01',biological_sex='female' where id=uid;
 insert into public.patient_consents(user_id,version)values(uid,'patient-pilot-v1');
 insert into public.patient_message_preferences(user_id,revision,channel,verified_phone,consent_version,consented_at)values(uid,1,'sms','+37499000201','messaging-service-v1',now());
 insert into public.patient_reminder_preferences(user_id,revision,preferences)values(uid,1,'{"medicationEnabled":true,"medicationOffsetMinutes":0,"bpEnabled":false,"bpTimes":["08:00"],"quietStart":"00:00","quietEnd":"00:00"}');
 insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at)values(plan,uid,'Synthetic clinician','Local test only',now());
 job:=public.enqueue_patient_plan_message(plan);
 perform set_config('test.auth_sms_owner',uid::text,true);
 select attempt_id into a from public.begin_patient_message_submission_budgeted(job,(select revision from public.patient_message_spend_policy where id=1),array['sms','whatsapp']);
 if a is null then raise exception 'TEST notice reservation missing';end if;
 perform public.finish_patient_message_submission(a,'accepted','SM'||repeat('a',32));
 if (select reserved_micros from public.patient_message_spend_totals where currency='USD' and budget_day=(clock_timestamp()at time zone'UTC')::date)<>2000000 then raise exception 'TEST OTP and notice spending not combined';end if;
end$$;
-- An OTP-only reservation must also lock monetary history to USD.
do $$declare policy jsonb;begin
 select jsonb_build_object('enabled',p.enabled,'currency',p.currency,'daily_limit_micros',p.daily_limit_micros,'sms_segment_ceiling_micros',p.sms_segment_ceiling_micros,'whatsapp_message_ceiling_micros',p.whatsapp_message_ceiling_micros,'max_sms_segments',p.max_sms_segments,'allowed_prefixes',p.allowed_prefixes,'valid_until',p.valid_until) into policy from public.patient_message_spend_policy p where id=1;
 begin perform public.configure_patient_message_spend((select revision from public.patient_message_spend_policy where id=1),policy||'{"currency":"EUR"}','test-operator');raise exception 'TEST currency changed after reservation';exception when others then if sqlerrm<>'message currency locked' then raise;end if;end;
end$$;
set local role service_role;
do $$declare r jsonb;begin
 for n in 2..4 loop
 r:=public.claim_auth_sms_hook('test-auth-'||n,repeat('c',64));
 if r->>'status'<>'send' then raise exception 'TEST expected admitted';end if;
 perform public.finish_auth_sms_hook('test-auth-'||n,(r->>'claimToken')::uuid,'accepted',n::text);
 end loop;
 begin perform public.claim_auth_sms_hook('test-auth-over',repeat('d',64));raise exception 'TEST five dollar cap bypassed';exception when others then if sqlerrm<>'message spending limit' then raise;end if;end;
end$$;
reset role;
do $$declare uid uuid:=current_setting('test.auth_sms_owner')::uuid;plan uuid:=gen_random_uuid();job uuid;begin
 update public.patient_care_plans set active=false where user_id=uid;
 insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at)values(plan,uid,'Synthetic clinician','Local test only',now());
 job:=public.enqueue_patient_plan_message(plan);
 begin perform public.begin_patient_message_submission_budgeted(job,(select revision from public.patient_message_spend_policy where id=1),array['sms','whatsapp']);raise exception 'TEST notice bypassed shared five dollar cap';exception when others then if sqlerrm<>'message spending limit' then raise;end if;end;
 if exists(select 1 from public.patient_message_attempts where job_id=job) then raise exception 'TEST rejected notice leaked attempt';end if;
end$$;
do $$begin
 if exists(select 1 from public.auth_sms_hook_attempts where webhook_id='test-auth-over') then raise exception 'TEST denial leaked attempt';end if;
 if (select reserved_micros from public.patient_message_spend_totals where currency='USD' and budget_day=(clock_timestamp()at time zone'UTC')::date)<>5000000 then raise exception 'TEST combined cap wrong';end if;
 if has_function_privilege('authenticated','public.claim_auth_sms_hook(text,text)','execute') or has_function_privilege('anon','public.finish_auth_sms_hook(text,uuid,text,text)','execute') or has_table_privilege('service_role','public.auth_sms_hook_attempts','insert') then raise exception 'TEST broad hook privileges';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='auth_sms_hook_attempts' and column_name in('phone','otp','body','raw_body','user_id')) then raise exception 'TEST sensitive hook storage';end if;
end$$;
-- Independent failure-path state: reuse the reservation history but roll day forward.
update public.patient_message_spend_policy set valid_until=clock_timestamp()-interval '1 second' where id=1;
do $$begin begin perform public.claim_auth_sms_hook('test-expired',repeat('e',64));raise exception 'TEST expired policy allowed';exception when others then if sqlerrm<>'message spending unconfigured' then raise;end if;end;end$$;
update public.patient_message_spend_policy set valid_until=clock_timestamp()+interval '1 day',allowed_prefixes=array['+44'] where id=1;
do $$begin begin perform public.claim_auth_sms_hook('test-country',repeat('e',64));raise exception 'TEST scope allowed';exception when others then if sqlerrm<>'message spending unconfigured' then raise;end if;end;end$$;
-- A terminal uncertainty keeps its reservation and cannot be retried, even while paused.
update public.patient_message_spend_policy set allowed_prefixes=array['+374'],sms_segment_ceiling_micros=1 where id=1;
update public.patient_message_spend_totals set reserved_micros=4999999 where currency='USD' and budget_day=(clock_timestamp()at time zone'UTC')::date;
set local role service_role;
do $$declare r jsonb;begin
 r:=public.claim_auth_sms_hook('test-unknown',repeat('f',64));
 if not public.finish_auth_sms_hook('test-unknown',(r->>'claimToken')::uuid,'unknown',null) then raise exception 'TEST unknown not recorded';end if;
 if public.claim_auth_sms_hook('test-unknown',repeat('f',64))->>'status'<>'unknown' then raise exception 'TEST unknown retried';end if;
 begin perform public.claim_auth_sms_hook('test-paused',repeat('a',64));raise exception 'TEST pause bypassed';exception when others then if sqlerrm<>'message dispatch paused' then raise;end if;end;
end$$;
reset role;
do $$begin if (select reserved_micros from public.patient_message_spend_totals where currency='USD' and budget_day=(clock_timestamp()at time zone'UTC')::date)<>5000000 then raise exception 'TEST uncertainty refunded';end if;end$$;
rollback;
\echo Shared OTP/notice budget, idempotency, privacy and privilege checks pass.
