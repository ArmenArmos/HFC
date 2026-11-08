begin;
insert into auth.users(id) values('b9f00000-0000-4000-8000-000000000001'),('b9f00000-0000-4000-8000-000000000002');
insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at) values('b9f10000-0000-4000-8000-000000000001','b9f00000-0000-4000-8000-000000000001','Fictional GP','Fictional only',now()-interval '2 days');
insert into public.patient_care_medications(id,user_id,plan_id,name,dose,instructions,times,start_date) values('b9f20000-0000-4000-8000-000000000001','b9f00000-0000-4000-8000-000000000001','b9f10000-0000-4000-8000-000000000001','Fictional medicine','Example','Fictional only',array[time '00:00'],(now() at time zone 'Asia/Yerevan')::date-1);
set local role authenticated;
select set_config('request.jwt.claim.sub','b9f00000-0000-4000-8000-000000000001',true);
do $$ declare med uuid:='b9f20000-0000-4000-8000-000000000001';due timestamptz:=date_trunc('day',now() at time zone 'Asia/Yerevan') at time zone 'Asia/Yerevan';stamp timestamptz;r bigint;begin
 r:=public.report_patient_dose_versioned(med,due,'taken',0);if r<>1 then raise exception 'TEST: first revision';end if;
 select recorded_at into stamp from public.patient_dose_events where medication_id=med;
 perform pg_sleep(0.01);
 if public.report_patient_dose_versioned(med,due,'taken',0)<>1 then raise exception 'TEST: retry';end if;
 if (select recorded_at from public.patient_dose_events where medication_id=med)<>stamp then raise exception 'TEST: retry changed timestamp';end if;
 begin perform public.report_patient_dose_versioned(med,due,'skipped',0);raise exception 'TEST: stale overwrite';exception when others then if sqlerrm<>'dose revision conflict' then raise;end if;end;
 if public.report_patient_dose_versioned(med,due,'skipped',1)<>2 then raise exception 'TEST: correction';end if;
 if (select count(*) from public.patient_dose_event_history where medication_id=med)<>2 then raise exception 'TEST: missing history';end if;
 if not exists(select 1 from public.patient_dose_event_history where medication_id=med and revision=1 and status='taken' and recorded_at=stamp and plan_id='b9f10000-0000-4000-8000-000000000001') then raise exception 'TEST: first report lost';end if;
 begin perform public.report_patient_dose(med,due,'taken');raise exception 'TEST: legacy overwrote correction';exception when others then if sqlerrm<>'dose revision conflict' then raise;end if;end;
 if public.report_patient_dose_versioned(med,due,'skipped',2)<>2 then raise exception 'TEST: unchanged report incremented';end if;
 if (select count(*) from public.patient_dose_event_history where medication_id=med)<>2 then raise exception 'TEST: unchanged report created history';end if;
 if has_function_privilege('authenticated','public.report_patient_dose_unversioned(uuid,timestamptz,text)','EXECUTE') or has_table_privilege('authenticated','public.patient_dose_event_history','INSERT') then raise exception 'TEST: history/write bypass';end if;
end $$;
select set_config('request.jwt.claim.sub','b9f00000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from public.patient_dose_event_history) then raise exception 'TEST: cross-owner history';end if;
 begin perform public.report_patient_dose_versioned('b9f20000-0000-4000-8000-000000000001',now(),'taken',0);raise exception 'TEST: cross-owner write';exception when others then if sqlerrm<>'medication unavailable' then raise;end if;end;
end $$;
rollback;
