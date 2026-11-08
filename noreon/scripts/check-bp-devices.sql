-- Fictional BP monitor inventory, hand-over, reassignment and the wrong-member
-- guard; all fixtures roll back. Every outcome is asserted on stored values.
\set ON_ERROR_STOP on
begin;
create function pg_temp.bp_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'TEST %',label;end if;
end$$;
-- b7 fixture namespace: member 01, doctor 02, nurse 03 (member 01), nurse 04 (member 06), admin 05, member 06, clinic 07.
insert into auth.users(id,phone,phone_confirmed_at) values
 ('b7000000-0000-4000-8000-000000000001','374000770001',now()),
 ('b7000000-0000-4000-8000-000000000002',null,null),('b7000000-0000-4000-8000-000000000003',null,null),
 ('b7000000-0000-4000-8000-000000000004',null,null),('b7000000-0000-4000-8000-000000000005',null,null),
 ('b7000000-0000-4000-8000-000000000006','374000770006',now()),('b7000000-0000-4000-8000-000000000008','374000770008',now());
update public.profiles set display_name='Synthetic member one' where id='b7000000-0000-4000-8000-000000000001';
update public.profiles set display_name='Synthetic member six' where id='b7000000-0000-4000-8000-000000000006';
insert into public.workspace_clinics(id,name) values('b7000000-0000-4000-8000-000000000007','Synthetic device clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id) values
 ('b7000000-0000-4000-8000-000000000002','doctor','Synthetic device doctor','b7000000-0000-4000-8000-000000000007'),
 ('b7000000-0000-4000-8000-000000000003','nurse','Synthetic nurse one','b7000000-0000-4000-8000-000000000007'),
 ('b7000000-0000-4000-8000-000000000004','nurse','Synthetic nurse six','b7000000-0000-4000-8000-000000000007'),
 ('b7000000-0000-4000-8000-000000000005','admin','Synthetic device admin',null);
insert into auth.sessions(id,user_id,created_at,updated_at) select ('b7000000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid,('b7000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,now(),now() from generate_series(1,8)n where n<>7;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('b7000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000002','b7000000-0000-4000-8000-000000000003'),
 ('b7000000-0000-4000-8000-000000000006','b7000000-0000-4000-8000-000000000002','b7000000-0000-4000-8000-000000000004'),
 ('b7000000-0000-4000-8000-000000000008','b7000000-0000-4000-8000-000000000002','b7000000-0000-4000-8000-000000000003');
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at)values
 ('b7000000-0000-4000-8000-000000000001','b7000000-0000-4000-8000-000000000900',128,82,70,now()-interval '3 days');

create function pg_temp.as_user(n int) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','b7000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'exp',extract(epoch from now()+interval '1 hour')::bigint,
  'session_id','b7000000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::text,true)
$$;
create function pg_temp.sub(n text) returns text language sql as $$select 'b7000000-0000-4000-8000-0000000005'||lpad(n,2,'0')$$;
create function pg_temp.iso(t timestamptz) returns text language sql as $$select to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')$$;
create function pg_temp.reading(ext text,serial text,minutes int,claimed text default null) returns jsonb language sql as $$
 select jsonb_build_object('version','bp-reading-v1','transport','fake','externalId',ext,'serial',serial,'systolic',131,'diastolic',84,'pulse',72,
  'measuredAt',pg_temp.iso(now()-make_interval(mins=>minutes)),'memberId',claimed)
$$;
create temp table bp_results(label text primary key,result jsonb);
grant all on bp_results to authenticated,service_role;
grant execute on function pg_temp.as_user(int),pg_temp.sub(text),pg_temp.iso(timestamptz),pg_temp.reading(text,text,int,text) to authenticated,service_role;

select pg_temp.bp_assert(not has_function_privilege('anon','public.bp_device_command(jsonb)','execute')
 and not has_function_privilege('anon','public.bp_admin_device_inventory()','execute')
 and not has_function_privilege('anon','public.bp_staff_member_devices(uuid)','execute')
 and not has_function_privilege('anon','public.bp_device_ingest_reading(jsonb)','execute')
 and not has_function_privilege('authenticated','public.bp_device_ingest_reading(jsonb)','execute')
 and has_function_privilege('service_role','public.bp_device_ingest_reading(jsonb)','execute'),'Only the service role ingests; anonymous callers reach nothing');
select pg_temp.bp_assert(not has_table_privilege('authenticated','public.bp_devices','select')
 and not has_table_privilege('authenticated','public.bp_device_readings','select')
 and not has_table_privilege('service_role','public.bp_device_assignments','insert'),'No direct table access');

set local role authenticated;
-- Registration: admin only, serial normalised, duplicate refused, replay safe.
select pg_temp.as_user(5);
insert into bp_results values('register-a',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('01'),'action','register','model','Synthetic BP-1','serial','bp-a1')));
insert into bp_results values('register-replay',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('01'),'action','register','model','Synthetic BP-1','serial','bp-a1')));
insert into bp_results values('register-changed',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('01'),'action','register','model','Synthetic BP-2','serial','bp-a1')));
insert into bp_results values('register-dup',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('02'),'action','register','model','Synthetic BP-1','serial','BP-A1')));
insert into bp_results values('register-b',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('03'),'action','register','model','Synthetic BP-1','serial','BP-B2')));
insert into bp_results values('extra-key',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('04'),'action','register','model','Synthetic BP-1','serial','BP-C3','memberId','b7000000-0000-4000-8000-000000000001')));
select pg_temp.as_user(3);
insert into bp_results values('nurse-register',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('05'),'action','register','model','Synthetic BP-1','serial','BP-N1')));
select pg_temp.as_user(2);
insert into bp_results values('doctor-register',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('06'),'action','register','model','Synthetic BP-1','serial','BP-D1')));
select pg_temp.as_user(1);
insert into bp_results values('member-register',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('07'),'action','register','model','Synthetic BP-1','serial','BP-M1')));
reset role;
select pg_temp.bp_assert((select result->>'status' from bp_results where label='register-a')='saved'
 and (select (result->>'replayed')::boolean from bp_results where label='register-replay')
 and (select result->>'deviceId' from bp_results where label='register-replay')=(select result->>'deviceId' from bp_results where label='register-a')
 and (select result->>'status' from bp_results where label='register-changed')='stale'
 and (select result->>'status' from bp_results where label='register-dup')='duplicate-serial'
 and (select result->>'status' from bp_results where label='extra-key')='invalid'
 and (select result->>'status' from bp_results where label='nurse-register')='access'
 and (select result->>'status' from bp_results where label='doctor-register')='access'
 and (select result->>'status' from bp_results where label='member-register')='access'
 and (select count(*) from public.bp_devices where created_by='b7000000-0000-4000-8000-000000000005')=2
 and (select serial from public.bp_devices where id=(select (result->>'deviceId')::uuid from bp_results where label='register-a'))='BP-A1','Registration rules');

create temp table bp_ids as select (select (result->>'deviceId')::uuid from bp_results where label='register-a') a,(select (result->>'deviceId')::uuid from bp_results where label='register-b') b;
grant select on bp_ids to authenticated,service_role;

-- Hand-over: the assigned nurse records it during the visit; others cannot.
set local role authenticated;
select pg_temp.as_user(4);
insert into bp_results values('other-nurse-assign',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('10'),'action','assign','deviceId',(select a from bp_ids),'memberId','b7000000-0000-4000-8000-000000000001','effectiveAt',null,'reason',null)));
select pg_temp.as_user(3);
insert into bp_results values('nurse-backdated',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('11'),'action','assign','deviceId',(select a from bp_ids),'memberId','b7000000-0000-4000-8000-000000000001','effectiveAt',pg_temp.iso(now()-interval '3 days'),'reason',null)));
insert into bp_results values('nurse-assign',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('12'),'action','assign','deviceId',(select a from bp_ids),'memberId','b7000000-0000-4000-8000-000000000001','effectiveAt',pg_temp.iso(now()-interval '60 minutes'),'reason',null)));
insert into bp_results values('nurse-second-device',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('13'),'action','assign','deviceId',(select b from bp_ids),'memberId','b7000000-0000-4000-8000-000000000001','effectiveAt',null,'reason',null)));
reset role;
select pg_temp.bp_assert((select result->>'status' from bp_results where label='other-nurse-assign')='access'
 and (select result->>'status' from bp_results where label='nurse-backdated')='invalid'
 and (select result->>'status' from bp_results where label='nurse-assign')='saved'
 and (select result->>'status' from bp_results where label='nurse-second-device')='member-has-device'
 and (select status from public.bp_devices where id=(select a from bp_ids))='assigned'
 and (select assigned_by_role from public.bp_device_assignments where device_id=(select a from bp_ids) and ended_at is null)='nurse'
 and (select status from public.bp_devices where id=(select b from bp_ids))='in-stock','Hand-over rules');

-- Wrong-member guard on ingest (service role, as the sync adapter).
set local role service_role;
insert into bp_results values('r-attached',public.bp_device_ingest_reading(pg_temp.reading('r1','bp-a1',30)));
insert into bp_results values('r-before',public.bp_device_ingest_reading(pg_temp.reading('r2','BP-A1',120)));
insert into bp_results values('r-unknown',public.bp_device_ingest_reading(pg_temp.reading('r3','BP-Z9',10)));
insert into bp_results values('r-mismatch',public.bp_device_ingest_reading(pg_temp.reading('r4','BP-A1',20,'b7000000-0000-4000-8000-000000000006')));
insert into bp_results values('r-claimed-ok',public.bp_device_ingest_reading(pg_temp.reading('r5','BP-A1',25,'b7000000-0000-4000-8000-000000000001')));
insert into bp_results values('r-replay',public.bp_device_ingest_reading(pg_temp.reading('r1','bp-a1',30)));
insert into bp_results values('r-conflict',public.bp_device_ingest_reading(pg_temp.reading('r1','BP-A1',29)));
insert into bp_results values('r-future',public.bp_device_ingest_reading(pg_temp.reading('r6','BP-A1',-60)));
insert into bp_results values('r-fraction',public.bp_device_ingest_reading(pg_temp.reading('r7','BP-A1',5)||'{"systolic":131.5}'));
insert into bp_results values('r-extra',public.bp_device_ingest_reading(pg_temp.reading('r8','BP-A1',5)||'{"note":"x"}'));
reset role;
select pg_temp.bp_assert((select result->>'status' from bp_results where label='r-attached')='attached'
 and (select member_id from public.bp_device_readings where external_id='r1')='b7000000-0000-4000-8000-000000000001'
 and (select result->>'status'||'/'||(result->>'reason') from bp_results where label='r-before')='held/no-assignment'
 and (select result->>'status'||'/'||(result->>'reason') from bp_results where label='r-unknown')='held/unknown-device'
 and (select result->>'status'||'/'||(result->>'reason') from bp_results where label='r-mismatch')='held/member-mismatch'
 and (select member_id from public.bp_device_readings where external_id='r4') is null
 and (select result->>'status' from bp_results where label='r-claimed-ok')='attached'
 and (select (result->>'replayed')::boolean from bp_results where label='r-replay')
 and (select result->>'status' from bp_results where label='r-conflict')='conflict'
 and (select result->>'status' from bp_results where label='r-future')='invalid'
 and (select result->>'status' from bp_results where label='r-fraction')='invalid'
 and (select result->>'status' from bp_results where label='r-extra')='invalid'
 and (select count(*) from public.bp_device_readings where external_id ~ '^r[0-9]+$')=5
 and not exists(select 1 from public.patient_measurements where user_id='b7000000-0000-4000-8000-000000000001' and measured_at>now()-interval '1 day'),'Ingest guard and idempotency; device readings stay out of clinical evidence');

-- Reassignment: admin only, reason required, never over already-attached readings.
set local role authenticated;
select pg_temp.as_user(4);
insert into bp_results values('nurse-reassign',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('20'),'action','assign','deviceId',(select a from bp_ids),'memberId','b7000000-0000-4000-8000-000000000006','effectiveAt',null,'reason','Synthetic swap')));
select pg_temp.as_user(5);
insert into bp_results values('reassign-no-reason',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('21'),'action','assign','deviceId',(select a from bp_ids),'memberId','b7000000-0000-4000-8000-000000000006','effectiveAt',null,'reason',null)));
insert into bp_results values('reassign-overlap',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('22'),'action','assign','deviceId',(select a from bp_ids),'memberId','b7000000-0000-4000-8000-000000000006','effectiveAt',pg_temp.iso(now()-interval '40 minutes'),'reason','Synthetic swap')));
insert into bp_results values('reassign',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('23'),'action','assign','deviceId',(select a from bp_ids),'memberId','b7000000-0000-4000-8000-000000000006','effectiveAt',pg_temp.iso(now()-interval '10 minutes'),'reason','Synthetic swap after wrong hand-over')));
reset role;
set local role service_role;
-- 15 minutes ago member 01 still held it; 5 minutes ago member 06 did.
insert into bp_results values('r-old-holder',public.bp_device_ingest_reading(pg_temp.reading('r10','BP-A1',15)));
insert into bp_results values('r-new-holder',public.bp_device_ingest_reading(pg_temp.reading('r11','BP-A1',5)));
reset role;
select pg_temp.bp_assert((select result->>'status' from bp_results where label='nurse-reassign')='device-unavailable'
 and (select result->>'status' from bp_results where label='reassign-no-reason')='reason-required'
 and (select result->>'status' from bp_results where label='reassign-overlap')='overlap'
 and (select result->>'status' from bp_results where label='reassign')='saved'
 and (select end_reason from public.bp_device_assignments where device_id=(select a from bp_ids) and member_id='b7000000-0000-4000-8000-000000000001')='Synthetic swap after wrong hand-over'
 and (select ended_by_role from public.bp_device_assignments where device_id=(select a from bp_ids) and member_id='b7000000-0000-4000-8000-000000000001')='admin'
 and (select member_id from public.bp_device_assignments where device_id=(select a from bp_ids) and ended_at is null)='b7000000-0000-4000-8000-000000000006'
 and (select member_id from public.bp_device_readings where external_id='r10')='b7000000-0000-4000-8000-000000000001'
 and (select member_id from public.bp_device_readings where external_id='r11')='b7000000-0000-4000-8000-000000000006'
 and (select count(*) from public.bp_device_events where device_id=(select a from bp_ids) and kind in('assigned','ended'))=3,'Reassignment with history; the guard follows the holder at reading time');

-- Held readings: recheck re-runs the guard; dismissal needs a reason.
create temp table bp_rids as select external_id ext,id from public.bp_device_readings where external_id ~ '^r[0-9]+$';
grant select on bp_rids to authenticated;
set local role authenticated;
select pg_temp.as_user(5);
insert into bp_results values('register-z',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('30'),'action','register','model','Synthetic BP-1','serial','BP-Z9')));
insert into bp_results values('recheck-unknown',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('31'),'action','recheck-held','readingId',(select id from bp_rids where ext='r3'))));
insert into bp_results values('assign-z-backdated',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('32'),'action','assign','deviceId',(select (result->>'deviceId')::uuid from bp_results where label='register-z'),'memberId','b7000000-0000-4000-8000-000000000001','effectiveAt',pg_temp.iso(now()-interval '10 minutes'),'reason','Synthetic hand-over not recorded at the visit')));
insert into bp_results values('recheck-matched',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('33'),'action','recheck-held','readingId',(select id from bp_rids where ext='r3'))));
insert into bp_results values('recheck-mismatch',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('34'),'action','recheck-held','readingId',(select id from bp_rids where ext='r4'))));
insert into bp_results values('dismiss-no-reason',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('35'),'action','dismiss-held','readingId',(select id from bp_rids where ext='r4'),'reason','  ')));
-- A hand-over older than the end of the member's previous holding period would overlap it.
insert into bp_results values('assign-overlap-member',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('38'),'action','assign','deviceId',(select b from bp_ids),'memberId','b7000000-0000-4000-8000-000000000006','effectiveAt',pg_temp.iso(now()-interval '1 day'),'reason',null)));
insert into bp_results values('dismiss',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('36'),'action','dismiss-held','readingId',(select id from bp_rids where ext='r4'),'reason','Synthetic reading from another household member')));
insert into bp_results values('inventory',public.bp_admin_device_inventory());
insert into bp_results values('admin-member',public.bp_staff_member_devices('b7000000-0000-4000-8000-000000000001'));
select pg_temp.as_user(3);
insert into bp_results values('nurse-recheck',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('37'),'action','recheck-held','readingId',(select id from bp_rids where ext='r2'))));
reset role;
select pg_temp.bp_assert((select result->>'status'||'/'||(result->>'reason') from bp_results where label='recheck-unknown')='still-held/no-assignment'
 and (select result->>'status' from bp_results where label='assign-z-backdated')='saved'
 and (select result->>'status' from bp_results where label='assign-overlap-member')='member-has-device'
 and (select result->>'reading' from bp_results where label='recheck-matched')='attached'
 and (select member_id from public.bp_device_readings where external_id='r3')='b7000000-0000-4000-8000-000000000001'
 and (select result->>'status'||'/'||(result->>'reason') from bp_results where label='recheck-mismatch')='still-held/member-mismatch'
 and (select result->>'status' from bp_results where label='dismiss-no-reason')='reason-required'
 and (select state||'/'||resolution_note from public.bp_device_readings where external_id='r4')='dismissed/Synthetic reading from another household member'
 and (select result->>'status' from bp_results where label='nurse-recheck')='access'
 and (select count(*) from jsonb_array_elements((select result->'held' from bp_results where label='inventory'))h where h->>'id' in(select id::text from bp_rids))=1
 and not ((select result->'held'->0 from bp_results where label='inventory') ? 'systolic')
 and (select result->'readings' from bp_results where label='admin-member')='null'::jsonb
 and jsonb_array_length((select result->'history' from bp_results where label='admin-member'))=2,'Held review, and admins never see reading values');

-- Readings history: assigned clinicians see manual and device readings; others are refused.
set local role authenticated;
select pg_temp.as_user(2);
insert into bp_results values('doctor-member',public.bp_staff_member_devices('b7000000-0000-4000-8000-000000000001'));
select pg_temp.as_user(4);
do $$begin perform public.bp_staff_member_devices('b7000000-0000-4000-8000-000000000001');insert into bp_results values('other-nurse-read','"allowed"');
exception when insufficient_privilege then insert into bp_results values('other-nurse-read','"refused"');end$$;
select pg_temp.as_user(1);
do $$begin perform public.bp_admin_device_inventory();insert into bp_results values('member-inventory','"allowed"');
exception when insufficient_privilege then insert into bp_results values('member-inventory','"refused"');end$$;
-- End: the assigned nurse of the current holder returns it, with a reason.
select pg_temp.as_user(3);
insert into bp_results values('wrong-nurse-end',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('40'),'action','end','deviceId',(select a from bp_ids),'status','returned','reason','Synthetic return')));
select pg_temp.as_user(4);
insert into bp_results values('nurse-end',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('41'),'action','end','deviceId',(select a from bp_ids),'status','returned','reason','Synthetic return at visit')));
select pg_temp.as_user(5);
insert into bp_results values('set-faulty-no-reason',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('42'),'action','set-status','deviceId',(select a from bp_ids),'status','faulty','reason',null)));
insert into bp_results values('set-faulty',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('43'),'action','set-status','deviceId',(select a from bp_ids),'status','faulty','reason','Synthetic cuff leak')));
insert into bp_results values('assign-faulty',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('44'),'action','assign','deviceId',(select a from bp_ids),'memberId','b7000000-0000-4000-8000-000000000006','effectiveAt',null,'reason',null)));
reset role;
set local role service_role;
insert into bp_results values('r-after-return',public.bp_device_ingest_reading(pg_temp.reading('r12','BP-A1',-1)));
reset role;
select pg_temp.bp_assert(jsonb_array_length((select result->'readings' from bp_results where label='doctor-member'))=5
 and (select result->'readings'->0->>'source' from bp_results where label='doctor-member')='device'
 and (select count(*) from jsonb_array_elements((select result->'readings' from bp_results where label='doctor-member'))x where x->>'source'='manual')=1
 and (select result->'available' from bp_results where label='doctor-member')='[]'::jsonb
 and (select result from bp_results where label='other-nurse-read')='"refused"'
 and (select result from bp_results where label='member-inventory')='"refused"'
 and (select result->>'status' from bp_results where label='wrong-nurse-end')='access'
 and (select result->>'status' from bp_results where label='nurse-end')='saved'
 and (select result->>'status' from bp_results where label='set-faulty-no-reason')='reason-required'
 and (select result->>'status' from bp_results where label='set-faulty')='saved'
 and (select result->>'status' from bp_results where label='assign-faulty')='device-unavailable'
 and (select status from public.bp_devices where id=(select a from bp_ids))='faulty'
 and (select result->>'status'||'/'||(result->>'reason') from bp_results where label='r-after-return')='held/no-assignment','Readings history scope, return and status');

-- Review B7-R2: an admin backdates an end to correct a late return; readings after it go back to review.
reset role;
set local role authenticated;
select pg_temp.as_user(5);
insert into bp_results values('r2-register',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('60'),'action','register','model','Synthetic BP-1','serial','BP-R2')));
insert into bp_results values('r2-assign',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('61'),'action','assign','deviceId',(select (result->>'deviceId')::uuid from bp_results where label='r2-register'),'memberId','b7000000-0000-4000-8000-000000000008','effectiveAt',pg_temp.iso(now()-interval '5 hours'),'reason',null)));
reset role;
set local role service_role;
insert into bp_results values('r2-early',public.bp_device_ingest_reading(pg_temp.reading('r20','BP-R2',240)));
insert into bp_results values('r2-late',public.bp_device_ingest_reading(pg_temp.reading('r21','BP-R2',60)));
reset role;
set local role authenticated;
select pg_temp.as_user(3);
insert into bp_results values('r2-nurse-backdate',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('62'),'action','end','deviceId',(select (result->>'deviceId')::uuid from bp_results where label='r2-register'),'status','returned','reason','Synthetic','effectiveAt',pg_temp.iso(now()-interval '2 hours'))));
select pg_temp.as_user(5);
insert into bp_results values('r2-before-start',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('63'),'action','end','deviceId',(select (result->>'deviceId')::uuid from bp_results where label='r2-register'),'status','returned','reason','Synthetic','effectiveAt',pg_temp.iso(now()-interval '6 hours'))));
insert into bp_results values('r2-end',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('64'),'action','end','deviceId',(select (result->>'deviceId')::uuid from bp_results where label='r2-register'),'status','returned','reason','Synthetic late return record','effectiveAt',pg_temp.iso(now()-interval '2 hours'))));
-- A returned monitor waits for the admin check: the nurse cannot hand it over.
select pg_temp.as_user(3);
insert into bp_results values('r7-nurse-returned',public.bp_device_command(jsonb_build_object('version','bp-device-v1','submissionId',pg_temp.sub('65'),'action','assign','deviceId',(select (result->>'deviceId')::uuid from bp_results where label='r2-register'),'memberId','b7000000-0000-4000-8000-000000000008','effectiveAt',null,'reason',null)));
reset role;
select pg_temp.bp_assert((select result->>'status' from bp_results where label='r2-early')='attached' and (select result->>'status' from bp_results where label='r2-late')='attached'
 and (select result->>'status' from bp_results where label='r2-nurse-backdate')='invalid'
 and (select result->>'status' from bp_results where label='r2-before-start')='invalid'
 and (select result->>'status' from bp_results where label='r2-end')='saved'
 and (select state||'/'||coalesce(member_id::text,'') from public.bp_device_readings where external_id='r20')='attached/b7000000-0000-4000-8000-000000000008'
 and (select state||'/'||hold_reason||'/'||coalesce(member_id::text,'none') from public.bp_device_readings where external_id='r21')='held/no-assignment/none'
 and exists(select 1 from public.bp_device_events where kind='reading-detached' and detail->>'readingId'=(select id::text from public.bp_device_readings where external_id='r21'))
 and (select result->>'status' from bp_results where label='r7-nurse-returned')='device-unavailable','Backdated end detaches later readings; nurses hand over in-stock monitors only');

-- History is append-only.
do $$begin update public.bp_device_assignments set member_id='b7000000-0000-4000-8000-000000000006' where member_id='b7000000-0000-4000-8000-000000000001';raise exception 'TEST assignment edited';
exception when object_not_in_prerequisite_state then null;end$$;
do $$begin update public.bp_device_assignments set end_reason='rewritten' where ended_at is not null;raise exception 'TEST closed period edited';
exception when object_not_in_prerequisite_state then null;end$$;
do $$begin delete from public.bp_device_events;raise exception 'TEST events deleted';
exception when object_not_in_prerequisite_state then null;end$$;
do $$begin delete from public.bp_device_assignments;raise exception 'TEST assignments deleted';
exception when object_not_in_prerequisite_state then null;end$$;
rollback;
\echo BP device inventory, hand-over, reassignment and wrong-member guard checks passed.
