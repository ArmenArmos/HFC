-- PR11 atomic voice provenance. Synthetic data, rolled back. Run only in the isolated replay database.
begin;
create function pg_temp.voice_ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
insert into auth.users(id,email)values
 ('b9000000-0000-4000-8000-000000000001','voice-member@example.test'),
 ('b9000000-0000-4000-8000-000000000002','voice-other@example.test');
insert into public.zoe_chat_cards(member_id,request_id,kind,source,snapshot,claims)values
 ('b9000000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000001','bp','chip',
  '{"v":1,"week":null,"typed":{"systolic":145,"diastolic":92,"pulse":null,"measuredAt":"2026-11-02T10:00:00Z","entrySource":"patient_voice_confirmed"}}',
  '{"bp":{"op":"b9200000-0000-4000-8000-000000000001","payload":{}}}'),
 ('b9000000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000002','bp','chip',
  '{"v":1,"week":null,"typed":{"systolic":145,"diastolic":92,"pulse":70,"measuredAt":"2026-11-02T10:00:00Z","entrySource":"patient_voice_confirmed"}}',
  '{"bp":{"op":"b9200000-0000-4000-8000-000000000004","payload":{}}}'),
 ('b9000000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000003','bp','chip',
  '{"v":1,"week":null,"typed":{"systolic":145,"diastolic":92,"pulse":null,"measuredAt":"2026-11-02T10:00:00Z","entrySource":"patient_voice_confirmed"}}',
  '{"bp":{"op":"b9200000-0000-4000-8000-000000000005","payload":{}}}'),
 ('b9000000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000004','bp','chip',
  '{"v":1,"week":null,"typed":{"systolic":145,"diastolic":92,"pulse":null,"measuredAt":"2026-11-02T10:00:00Z","entrySource":"patient_voice_confirmed"}}',
  '{"bp":{"op":"b9200000-0000-4000-8000-000000000006","payload":{}}}'),
 ('b9000000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000005','bp','chip',
  '{"v":1,"week":null,"typed":{"systolic":145,"diastolic":92,"pulse":null,"measuredAt":"2026-11-02T10:00:00Z","entrySource":"patient_voice_confirmed"}}',
  '{"bp":{"op":"b9200000-0000-4000-8000-000000000007","payload":{}}}'),
 ('b9000000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000006','bp','chip',
  '{"v":1,"week":null,"typed":{"systolic":145,"diastolic":92,"pulse":null,"measuredAt":"2026-11-02T10:00:00Z","entrySource":"patient_voice_confirmed"}}',
  '{"bp":{"op":"b9200000-0000-4000-8000-000000000008","payload":{}}}'),
 ('b9000000-0000-4000-8000-000000000001','b9100000-0000-4000-8000-000000000007','bp','chip',
  '{"v":1,"week":null,"typed":{"systolic":145,"diastolic":92,"pulse":null,"measuredAt":"2026-11-02T10:00:00Z","entrySource":"patient_voice_confirmed"}}',
  '{"bp":{"op":"b9200000-0000-4000-8000-000000000009","payload":{}}}');
-- The save happens after the claim and before any zone update or card outcome.
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)values
 ('b9000000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000001',145,92,'2026-11-02T10:00:00Z'),
 ('b9000000-0000-4000-8000-000000000002','b9200000-0000-4000-8000-000000000001',145,92,'2026-11-02T10:00:00Z'),
 ('b9000000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000003',146,93,'2026-11-02T10:00:00Z');
-- An edited card is typed: changed systolic, diastolic or pulse (including a pulse added to a dictated reading) lose voice; unchanged values with a pulse keep it.
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at)values
 ('b9000000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000004',145,92,70,'2026-11-02T10:00:00Z'),
 ('b9000000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000005',160,92,null,'2026-11-02T10:00:00Z'),
 ('b9000000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000006',145,100,null,'2026-11-02T10:00:00Z'),
 ('b9000000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000007',145,92,72,'2026-11-02T10:00:00Z'),
 ('b9000000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000008',145,92,null,'2026-11-02T12:00:00+02:00'),
 ('b9000000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000009',145,92,null,'2026-11-01T10:00:00Z');
select pg_temp.voice_ok((select entry_source='patient_voice_confirmed' from public.patient_measurements where submission_id='b9200000-0000-4000-8000-000000000004'),'Unchanged values with a dictated pulse keep voice');
select pg_temp.voice_ok((select entry_source='patient_voice_confirmed' from public.patient_measurements where submission_id='b9200000-0000-4000-8000-000000000008'),'The same instant in another zone keeps voice');
select pg_temp.voice_ok((select entry_source is null from public.patient_measurements where submission_id='b9200000-0000-4000-8000-000000000009'),'A changed measurement time loses voice');
select pg_temp.voice_ok((select entry_source is null from public.patient_measurements where submission_id='b9200000-0000-4000-8000-000000000005'),'An edited systolic loses voice');
select pg_temp.voice_ok((select entry_source is null from public.patient_measurements where submission_id='b9200000-0000-4000-8000-000000000006'),'An edited diastolic loses voice');
select pg_temp.voice_ok((select entry_source is null from public.patient_measurements where submission_id='b9200000-0000-4000-8000-000000000007'),'A pulse added to a dictated reading loses voice');
select pg_temp.voice_ok((select entry_source='patient_voice_confirmed' from public.patient_measurements where user_id='b9000000-0000-4000-8000-000000000001'and submission_id='b9200000-0000-4000-8000-000000000001'),'Voice source is atomic with save, independent of zone RPC');
select pg_temp.voice_ok((select entry_source is null from public.patient_measurements where user_id='b9000000-0000-4000-8000-000000000002'),'Another member cannot borrow a voice claim');
select public.zoe_bp_reading_zone('b9000000-0000-4000-8000-000000000001',(select id from public.patient_measurements where user_id='b9000000-0000-4000-8000-000000000001'and submission_id='b9200000-0000-4000-8000-000000000001'),'yellow','v1');
select pg_temp.voice_ok((select entry_source='patient_voice_confirmed' from public.patient_measurements where user_id='b9000000-0000-4000-8000-000000000001'and submission_id='b9200000-0000-4000-8000-000000000001'),'Later zone updates preserve voice');
select public.zoe_bp_reading_zone('b9000000-0000-4000-8000-000000000001',(select id from public.patient_measurements where submission_id='b9200000-0000-4000-8000-000000000003'),'yellow','v1');
select pg_temp.voice_ok((select entry_source='patient_text_entry' from public.patient_measurements where submission_id='b9200000-0000-4000-8000-000000000003'),'Ordinary typed reading stays typed');
select pg_temp.voice_ok(not has_function_privilege('authenticated','public._zoe_bp_entry_source()','execute'),'Member cannot invoke the trigger function');
rollback;
