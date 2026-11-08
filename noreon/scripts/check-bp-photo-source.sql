-- Synthetic fixtures only. Source labels never alter the existing save trigger or one rule.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
insert into auth.users(id,phone,phone_confirmed_at)values('bfa00000-0000-4000-8000-000000000001','37499087001',now());
update public.profiles set display_name='Fictional',birth_date='1970-01-01',biological_sex='male'where id='bfa00000-0000-4000-8000-000000000001';
insert into public.patient_consents(user_id,version)values('bfa00000-0000-4000-8000-000000000001','patient-pilot-v1');
insert into public.patient_assessments(user_id)values('bfa00000-0000-4000-8000-000000000001');
insert into public.care_alert_settings(singleton,enabled)values(true,true)on conflict(singleton)do update set enabled=true;
create function pg_temp.save(src text,mins integer)returns uuid language plpgsql as $$declare result uuid;begin
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"bfa00000-0000-4000-8000-000000000001"}',true);
 result:=public.record_patient_measurement_sourced(gen_random_uuid(),185,115,78,clock_timestamp()-make_interval(mins=>mins),src);
 return result;
end$$;
-- Each source uses exactly the same trigger, first reading and rested repeat.
do $$declare src text;mid uuid;begin
 foreach src in array array['patient_text_entry','patient_photo_confirmed']loop
  delete from public.care_alerts where member_id='bfa00000-0000-4000-8000-000000000001';
  delete from public.bp_repeat_notes where member_id='bfa00000-0000-4000-8000-000000000001';
  delete from public.patient_measurements where user_id='bfa00000-0000-4000-8000-000000000001';
  mid:=pg_temp.save(src,20);
  perform pg_temp.ok((select entry_source=src from public.patient_measurements where id=mid),'RPC accepts '||src);
  perform pg_temp.ok(exists(select 1 from public.bp_repeat_notes where measurement_id=mid and closed_at is null),'First high leaves quiet note: '||src);
  perform pg_temp.ok(not exists(select 1 from public.care_alerts where member_id='bfa00000-0000-4000-8000-000000000001'),'First high raises no alert: '||src);
  -- Zone updates cannot relabel a photo-confirmed reading.
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.zoe_bp_reading_zone('bfa00000-0000-4000-8000-000000000001',mid,'orange','photo-source-test');
  perform pg_temp.ok((select entry_source=src from public.patient_measurements where id=mid),'Zone preserves source');
  perform pg_temp.save(src,10);
  perform pg_temp.ok(exists(select 1 from public.care_alerts where member_id='bfa00000-0000-4000-8000-000000000001'and reason_code='bp_doctor_today'),'Rested repeat raises same alert: '||src);
 end loop;
 begin perform pg_temp.save('invented_source',0);raise exception 'Made-up source accepted';exception when check_violation then null;end;
end$$;
-- A staff account cannot save a photo-sourced reading, and the route's admission helper says so (Astra, 5 Nov).
insert into auth.users(id,phone,phone_confirmed_at)values('bfa00000-0000-4000-8000-000000000003','37499087003',now());
insert into public.workspace_clinics(id,name)values('bfa00000-0000-4000-8000-000000000020','Synthetic photo clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('bfa00000-0000-4000-8000-000000000003','doctor','Synthetic Doctor','bfa00000-0000-4000-8000-000000000020');
do $$begin
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"bfa00000-0000-4000-8000-000000000003"}',true);
 begin perform public.record_patient_measurement_sourced(gen_random_uuid(),150,95,70,clock_timestamp(),'patient_photo_confirmed');raise exception 'Staff photo source accepted';
 exception when insufficient_privilege then null;end;
 begin perform public.bp_week_record_sourced('bfa00000-0000-4000-8000-000000000002','evening',gen_random_uuid(),150,95,null,clock_timestamp(),'patient_photo_confirmed');raise exception 'Staff week photo source accepted';
 exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform pg_temp.ok(public.bp_photo_member_allowed('bfa00000-0000-4000-8000-000000000001')=true,'A member passes the photo admission check');
 perform pg_temp.ok(public.bp_photo_member_allowed('bfa00000-0000-4000-8000-000000000003')=false,'A staff account does not');
 perform pg_temp.ok(not has_function_privilege('authenticated','public.bp_photo_member_allowed(uuid)','execute'),'The browser cannot call the admission helper');
end$$;
-- Week slots carry the label too; replay cannot relabel an already confirmed reading.
update public.bp_week_settings set enabled=true where singleton;
insert into public.bp_weeks(id,member_id,starts_on,started_by,started_by_role)
 values('bfa00000-0000-4000-8000-000000000002','bfa00000-0000-4000-8000-000000000001',public._bp_week_today(),'bfa00000-0000-4000-8000-000000000001','member');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"bfa00000-0000-4000-8000-000000000001"}',true);
do $$declare result jsonb;sid uuid:=gen_random_uuid();at timestamptz:=clock_timestamp();begin
 result:=public.bp_week_record_sourced('bfa00000-0000-4000-8000-000000000002','morning',sid,142,91,null,at,'patient_photo_confirmed');
 perform pg_temp.ok(result->>'status'='saved','Week source RPC saves through ordinary capacity check');
 perform pg_temp.ok((select entry_source='patient_photo_confirmed'from public.patient_measurements where id=(result->>'measurementId')::uuid),'Week photo label persists');
 result:=public.bp_week_record_sourced('bfa00000-0000-4000-8000-000000000002','morning',sid,142,91,null,at,'patient_text_entry');
 perform pg_temp.ok(result->>'status'='replayed','Week retry still replays');
 perform pg_temp.ok((select entry_source='patient_photo_confirmed'from public.patient_measurements where id=(result->>'measurementId')::uuid),'Week retry preserves first label');
end$$;
-- A photo-confirmed reading keeps its label even when its numbers equal a dictated voice card's (the voice trigger only fills an empty source).
insert into public.zoe_chat_cards(member_id,request_id,kind,source,snapshot,claims)values
 ('bfa00000-0000-4000-8000-000000000001','bfa10000-0000-4000-8000-000000000001','bp','chip',
  '{"v":1,"week":null,"typed":{"systolic":150,"diastolic":95,"pulse":70,"measuredAt":"2026-11-02T10:00:00Z","entrySource":"patient_voice_confirmed"}}',
  '{"bp":{"op":"bfa20000-0000-4000-8000-000000000001","payload":{}}}');
do $$declare mid uuid;begin
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"bfa00000-0000-4000-8000-000000000001"}',true);
 mid:=public.record_patient_measurement_sourced('bfa20000-0000-4000-8000-000000000001',150,95,70,'2026-11-02T10:00:00Z','patient_photo_confirmed');
 perform pg_temp.ok((select entry_source='patient_photo_confirmed'from public.patient_measurements where id=mid),'Voice trigger does not relabel a photo-confirmed reading');
end$$;
-- Same ledger admission as lab reading, and no job or photo content persisted.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.ok((public.lab_ai_call_reserve(null,null,'extract','medium','test/model',false,0)->>'ok')::boolean=false,'Ordinary lab calls still require a job');
select pg_temp.ok(not has_function_privilege('authenticated','public.lab_ai_call_reserve(uuid,uuid,text,text,text,boolean,numeric)','execute'),'Browser cannot reserve model spend');
rollback;
