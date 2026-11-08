begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('b9300000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fictional-reminder-a@example.invalid','',now(),now()),
('b9300000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','fictional-reminder-b@example.invalid','',now(),now());
set local role authenticated;
select set_config('request.jwt.claim.sub','b9300000-0000-4000-8000-000000000001',true);
do $$ declare p jsonb := '{"medicationEnabled":true,"medicationOffsetMinutes":0,"bpEnabled":true,"bpTimes":["08:00","20:00"],"quietStart":"22:00","quietEnd":"07:00"}'; r integer; begin
 r:=public.save_patient_reminder_preferences(p,0); if r<>1 then raise exception 'first revision failed'; end if;
 r:=public.save_patient_reminder_preferences(p,0); if r<>-1 then raise exception 'stale write accepted'; end if;
 r:=public.save_patient_reminder_preferences(p,1); if r<>2 then raise exception 'update failed'; end if;
 if (select count(*) from public.patient_reminder_preferences)<>1 then raise exception 'owner cannot read'; end if;
 begin perform public.save_patient_reminder_preferences(jsonb_set(p,'{bpTimes}','["25:00"]'),2); raise exception 'accepted invalid time'; exception when others then if sqlerrm<>'invalid' then raise; end if; end;
 begin perform public.save_patient_reminder_preferences(jsonb_set(p,'{bpTimes}','["08:00","08:00"]'),2); raise exception 'accepted duplicate time'; exception when others then if sqlerrm<>'invalid' then raise; end if; end;
 begin perform public.save_patient_reminder_preferences(p||'{"user_id":"b9300000-0000-4000-8000-000000000002"}',2); raise exception 'accepted user spoof'; exception when others then if sqlerrm<>'invalid' then raise; end if; end;
end $$;
reset role;
insert into public.patient_care_plans(id,user_id,clinician,published_at,instructions,active) values
('b9310000-0000-4000-8000-000000000001','b9300000-0000-4000-8000-000000000001','Fictional GP',date_trunc('day',now() at time zone 'Asia/Yerevan') at time zone 'Asia/Yerevan' - interval '1 day','Fictional instructions',true);
insert into public.patient_care_medications(id,user_id,plan_id,name,dose,instructions,times,start_date,active) values
('b9320000-0000-4000-8000-000000000001','b9300000-0000-4000-8000-000000000001','b9310000-0000-4000-8000-000000000001','Fictional medicine','Example dose','Fictional only',array[time '23:50'],(now() at time zone 'Asia/Yerevan')::date - 1,true);
set local role authenticated;
do $$ declare due timestamptz:= ((now() at time zone 'Asia/Yerevan')::date-1 + time '23:50') at time zone 'Asia/Yerevan'; begin
 begin perform public.report_patient_dose('b9320000-0000-4000-8000-000000000001',due,'skipped');raise exception 'yesterday allowed without offset';exception when others then if sqlerrm<>'dose outside schedule' then raise;end if;end;
 perform public.save_patient_reminder_preferences('{"medicationEnabled":true,"medicationOffsetMinutes":15,"bpEnabled":true,"bpTimes":["08:00","20:00"],"quietStart":"22:00","quietEnd":"07:00"}',2);
 perform public.report_patient_dose('b9320000-0000-4000-8000-000000000001',due,'skipped');
 if not exists(select 1 from public.patient_dose_events where medication_id='b9320000-0000-4000-8000-000000000001' and due_at=due and status='skipped') then raise exception 'midnight original dose not recorded';end if;
end $$;
select set_config('request.jwt.claim.sub','b9300000-0000-4000-8000-000000000002',true);
do $$ begin
 if (select count(*) from public.patient_reminder_preferences)<>0 then raise exception 'cross member leak'; end if;
 if public.save_patient_reminder_preferences('{"medicationEnabled":true,"medicationOffsetMinutes":0,"bpEnabled":false,"bpTimes":["08:00"],"quietStart":"22:00","quietEnd":"07:00"}',2)<>-1 then raise exception 'cross member mutation'; end if;
 begin update public.patient_reminder_preferences set revision=9; raise exception 'direct write allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 begin perform public.save_patient_reminder_preferences('{}',0); raise exception 'unauthenticated write'; exception when others then if sqlerrm<>'unauthorized' then raise; end if; end;
end $$;
rollback;
