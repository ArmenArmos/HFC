-- Fictional SQL-role evidence only. All fixture data and schema changes roll back.
begin;
create function pg_temp.cp_assert(v boolean,m text)returns void language plpgsql as $$begin if v is distinct from true then raise exception 'FAIL %',m;end if;end$$;
select pg_temp.cp_assert(to_regprocedure('public.clinic_batch_command(jsonb)')is not null,'clinic durable RPC absent');
insert into auth.users(id)values('c4500000-0000-4000-8000-000000000001'),('c4500000-0000-4000-8000-000000000002');
insert into auth.sessions(id,user_id,created_at,updated_at)values('c4500000-0000-4000-8000-000000000011','c4500000-0000-4000-8000-000000000001',now(),now()),('c4500000-0000-4000-8000-000000000012','c4500000-0000-4000-8000-000000000002',now(),now());
insert into public.workspace_clinics(id,name)values('c4500000-0000-4000-8000-000000000021','Fictional clinic A'),('c4500000-0000-4000-8000-000000000022','Fictional clinic B');
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name)values('c4500000-0000-4000-8000-000000000001','c4500000-0000-4000-8000-000000000021','Fictional uploader A'),('c4500000-0000-4000-8000-000000000002','c4500000-0000-4000-8000-000000000022','Fictional uploader B');
insert into public.clinic_portal_capabilities(singleton,storage_enabled)values(true,true)on conflict(singleton)do update set storage_enabled=excluded.storage_enabled;
create temp table commands(name text primary key,payload jsonb);grant all on commands to authenticated,service_role;
insert into commands values('create','{"version":"clinic-command-v1","op":"create-batch","submissionId":"c4500000-0000-4000-8000-000000000031","clinicId":"c4500000-0000-4000-8000-000000000021","batchId":"c4500000-0000-4000-8000-000000000041","name":"Synthetic laboratory batch"}'),('reserve','{"version":"clinic-command-v1","op":"reserve-upload","submissionId":"c4500000-0000-4000-8000-000000000032","clinicId":"c4500000-0000-4000-8000-000000000021","batchId":"c4500000-0000-4000-8000-000000000041","revision":0,"logicalKey":"c4500000-0000-4000-8000-000000000051","fileId":"c4500000-0000-4000-8000-000000000061","attemptId":"c4500000-0000-4000-8000-000000000071","name":"two-members.pdf","mime":"application/pdf","declaredSizeBytes":5,"fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');
select set_config('request.jwt.claims','{"sub":"c4500000-0000-4000-8000-000000000001","session_id":"c4500000-0000-4000-8000-000000000011","exp":4102444800,"role":"authenticated","amr":[{"method":"password"}]}',true);set local role authenticated;
select pg_temp.cp_assert(public.clinic_portal_identity(null)->>'status'='ready','explicit membership resolves');
select pg_temp.cp_assert(public.clinic_batch_command(payload)->>'status'='committed','create once')from commands where name='create';
select pg_temp.cp_assert(public.clinic_batch_command(payload)->>'status'='committed','create replay')from commands where name='create';
select pg_temp.cp_assert(public.clinic_batch_command(jsonb_set(payload,'{name}','"changed"'))->>'reason'='conflict','same key different payload')from commands where name='create';
select pg_temp.cp_assert(public.clinic_batch_command(payload)->>'status'='committed','reserve')from commands where name='reserve';
select pg_temp.cp_assert(public.clinic_batch_read('c4500000-0000-4000-8000-000000000021','c4500000-0000-4000-8000-000000000041',null,50)#>>'{files,0,upload,status}'='reserved','reservation not stored');
do $$begin perform public.clinic_batch_read('c4500000-0000-4000-8000-000000000022','c4500000-0000-4000-8000-000000000041',null,50);raise exception 'cross clinic leak';exception when insufficient_privilege then null;end$$;
-- Service proof cannot adopt unrelated object or fake bytes; actual Storage is a separate gate.
reset role;
insert into storage.objects(id,bucket_id,name,metadata)values('c4500000-0000-4000-8000-000000000081','clinic-originals','c4500000-0000-4000-8000-000000000021/c4500000-0000-4000-8000-000000000061/c4500000-0000-4000-8000-000000000071.pdf','{"size":5,"mimetype":"application/pdf"}');
-- Inspect effective installed policies and inheritance, not text mentioning our bucket only.
select policyname,roles,cmd,qual,with_check from pg_policies where schemaname='storage'and tablename='objects'order by policyname;
select rolname,rolsuper,rolbypassrls,rolinherit from pg_roles where rolname in('anon','authenticated','service_role');
select member::regrole,roleid::regrole from pg_auth_members where member in('anon'::regrole,'authenticated'::regrole,'service_role'::regrole);
select c.relname,c.relrowsecurity,c.relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname='storage'and c.relname='objects')or(n.nspname='public'and c.relname like 'clinic_%')order by c.relname;
select p.oid::regprocedure,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and(p.proname like '_clinic_portal_%'or p.proname like 'clinic_%')order by p.proname;
set local role anon;
do $$declare n bigint;begin select count(*)into n from storage.objects where bucket_id='clinic-originals';if n<>0 then raise exception 'anon original read leak';end if;exception when insufficient_privilege then null;end$$;
do $$begin insert into storage.objects(bucket_id,name)values('clinic-originals','anon-forged');raise exception 'anon storage write accepted';exception when insufficient_privilege then null;end$$;
reset role;set local role authenticated;
do $$declare n bigint;begin select count(*)into n from storage.objects where bucket_id='clinic-originals';if n<>0 then raise exception 'authenticated original read leak';end if;exception when insufficient_privilege then null;end$$;
do $$begin insert into storage.objects(bucket_id,name)values('clinic-originals','auth-forged');raise exception 'authenticated storage write accepted';exception when insufficient_privilege then null;end$$;
do $$declare n bigint;begin update storage.objects set metadata='{"size":99}'where bucket_id='clinic-originals';get diagnostics n=row_count;if n<>0 then raise exception 'authenticated original overwrite';end if;exception when insufficient_privilege then null;end$$;
reset role;
insert into auth.sessions(id,user_id,created_at,updated_at)values('c4500000-0000-4000-8000-000000000015','c4500000-0000-4000-8000-000000000001',now(),now());
-- Fresh-session reload must expose exact persisted command only to its actor.
select set_config('request.jwt.claims','{"sub":"c4500000-0000-4000-8000-000000000001","session_id":"c4500000-0000-4000-8000-000000000015","exp":4102444800,"role":"authenticated","amr":[{"method":"password"}]}',true);set local role authenticated;
select pg_temp.cp_assert(public.clinic_batch_read('c4500000-0000-4000-8000-000000000021','c4500000-0000-4000-8000-000000000041',null,50)#>'{files,0,recoveryCommand}'='null'::jsonb,'fresh-session legacy recovery hides original name')from commands where name='reserve';
reset role;
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name)values('c4500000-0000-4000-8000-000000000002','c4500000-0000-4000-8000-000000000021','Second clinic A administrator');
select set_config('request.jwt.claims','{"sub":"c4500000-0000-4000-8000-000000000002","session_id":"c4500000-0000-4000-8000-000000000012","exp":4102444800,"role":"authenticated","amr":[{"method":"password"}]}',true);set local role authenticated;
select pg_temp.cp_assert(public.clinic_batch_read('c4500000-0000-4000-8000-000000000021','c4500000-0000-4000-8000-000000000041',null,50)#>'{files,0,recoveryCommand}'='null'::jsonb,'other clinic administrator gets no actor recovery command');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
do $$begin perform public.clinic_upload_target('c4500000-0000-4000-8000-000000000061','c4500000-0000-4000-8000-000000000002','c4500000-0000-4000-8000-000000000012');raise exception 'wrong actor claimed execution';exception when insufficient_privilege then null;end$$;
do $$begin perform public.clinic_upload_target('c4500000-0000-4000-8000-000000000061','c4500000-0000-4000-8000-000000000001','c4500000-0000-4000-8000-000000000015');raise exception 'same actor wrong SID claimed execution';exception when insufficient_privilege then null;end$$;
select pg_temp.cp_assert(public.clinic_upload_target('c4500000-0000-4000-8000-000000000061','c4500000-0000-4000-8000-000000000001','c4500000-0000-4000-8000-000000000011')->>'actorId'='c4500000-0000-4000-8000-000000000001','target immutable original actor');
-- Repeat immediately while session, membership and reserved state are unchanged.
do $$begin perform public.clinic_upload_target('c4500000-0000-4000-8000-000000000061','c4500000-0000-4000-8000-000000000001','c4500000-0000-4000-8000-000000000011');raise exception 'unchanged-authority repeat claim accepted';exception when object_not_in_prerequisite_state then null;end$$;
reset role;
select pg_temp.cp_assert((select execution='active'and state='reserved'and object_id is null from public.clinic_batch_files where id='c4500000-0000-4000-8000-000000000061'),'repeat claim leaves original active ownership');
insert into storage.buckets(id,name,public)values('clinic-wrong-fixture','clinic-wrong-fixture',false);
insert into storage.objects(id,bucket_id,name,metadata)values
 ('c4500000-0000-4000-8000-000000000085','clinic-wrong-fixture','c4500000-0000-4000-8000-000000000021/c4500000-0000-4000-8000-000000000061/c4500000-0000-4000-8000-000000000071.pdf','{"size":5}'),
 ('c4500000-0000-4000-8000-000000000086','clinic-originals','wrong-reserved-key','{"size":5}');
set local role service_role;
do $$begin perform public.clinic_upload_finalize('c4500000-0000-4000-8000-000000000061','c4500000-0000-4000-8000-000000000099',repeat('a',64),5);raise exception 'wrong object UUID accepted';exception when invalid_parameter_value then null;end$$;
do $$begin perform public.clinic_upload_finalize('c4500000-0000-4000-8000-000000000061','c4500000-0000-4000-8000-000000000085',repeat('a',64),5);raise exception 'wrong bucket accepted';exception when invalid_parameter_value then null;end$$;
do $$begin perform public.clinic_upload_finalize('c4500000-0000-4000-8000-000000000061','c4500000-0000-4000-8000-000000000086',repeat('a',64),5);raise exception 'wrong key accepted';exception when invalid_parameter_value then null;end$$;
do $$begin perform public.clinic_upload_finalize('c4500000-0000-4000-8000-000000000061','c4500000-0000-4000-8000-000000000081',repeat('a',64),6);raise exception 'wrong measured size accepted';exception when invalid_parameter_value then null;end$$;
reset role;update storage.objects set metadata='{"size":6}'where id='c4500000-0000-4000-8000-000000000081';set local role service_role;
do $$begin perform public.clinic_upload_finalize('c4500000-0000-4000-8000-000000000061','c4500000-0000-4000-8000-000000000081',repeat('a',64),5);raise exception 'wrong stored size accepted';exception when invalid_parameter_value then null;end$$;
reset role;update storage.objects set metadata='{"size":5}'where id='c4500000-0000-4000-8000-000000000081';
select pg_temp.cp_assert((select state='reserved'and execution='active'and object_id is null and sha256 is null and measured_size is null from public.clinic_batch_files where id='c4500000-0000-4000-8000-000000000061'),'all identity failures preserve unassociated original');set local role service_role;
do $$begin perform public.clinic_upload_finalize('c4500000-0000-4000-8000-000000000061','c4500000-0000-4000-8000-000000000081',repeat('b',64),5);raise exception 'wrong hash accepted';exception when invalid_parameter_value then null;end$$;
reset role;
-- Revocation is checked by finalizer even with valid service role.
update public.clinic_portal_memberships set active=false where user_id='c4500000-0000-4000-8000-000000000001';
set local role service_role;
do $$begin perform public.clinic_upload_finalize('c4500000-0000-4000-8000-000000000061','c4500000-0000-4000-8000-000000000081',repeat('a',64),5);raise exception 'revoked membership accepted';exception when insufficient_privilege then null;end$$;
reset role;
update public.clinic_portal_memberships set active=true where user_id='c4500000-0000-4000-8000-000000000001';
-- Original revision remains invalid after reactivation; new session can retire old request.
insert into auth.sessions(id,user_id,created_at,updated_at)values('c4500000-0000-4000-8000-000000000013','c4500000-0000-4000-8000-000000000001',now(),now());
select set_config('request.jwt.claims','{"sub":"c4500000-0000-4000-8000-000000000001","session_id":"c4500000-0000-4000-8000-000000000013","exp":4102444800,"role":"authenticated","amr":[{"method":"password"}]}',true);set local role authenticated;
select pg_temp.cp_assert(public.clinic_batch_refresh('c4500000-0000-4000-8000-000000000021','c4500000-0000-4000-8000-000000000041',payload)#>>'{receipt,status}'='retired','reserved recovery retires upload')from commands where name='reserve';
select pg_temp.cp_assert(public.clinic_batch_command(payload)->>'reason'='unavailable','delayed retired reserve denied')from commands where name='reserve';
-- Explicit new attempt in current session, separate UUIDs and revised batch.
update commands set payload=payload||jsonb_build_object('submissionId','c4500000-0000-4000-8000-000000000033','fileId','c4500000-0000-4000-8000-000000000062','logicalKey','c4500000-0000-4000-8000-000000000052','attemptId','c4500000-0000-4000-8000-000000000072','revision',(public.clinic_batch_read('c4500000-0000-4000-8000-000000000021','c4500000-0000-4000-8000-000000000041',null,50)#>>'{batch,revision}')::bigint)where name='reserve';
select pg_temp.cp_assert(public.clinic_batch_command(payload)->>'status'='committed','explicit new reservation')from commands where name='reserve';
reset role;
insert into storage.objects(id,bucket_id,name,metadata)values('c4500000-0000-4000-8000-000000000082','clinic-originals','c4500000-0000-4000-8000-000000000021/c4500000-0000-4000-8000-000000000062/c4500000-0000-4000-8000-000000000072.pdf','{"size":5,"mimetype":"application/pdf"}');
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select public.clinic_upload_target('c4500000-0000-4000-8000-000000000062','c4500000-0000-4000-8000-000000000001','c4500000-0000-4000-8000-000000000013');
select pg_temp.cp_assert(public.clinic_upload_finalize('c4500000-0000-4000-8000-000000000062','c4500000-0000-4000-8000-000000000082',repeat('a',64),5)->>'status'='stored','measured immutable object stored');
select pg_temp.cp_assert(public.clinic_upload_finalize('c4500000-0000-4000-8000-000000000062','c4500000-0000-4000-8000-000000000082',repeat('a',64),5)->>'status'='stored','same finalization replay');
reset role;
select set_config('request.jwt.claims','{"sub":"c4500000-0000-4000-8000-000000000001","session_id":"c4500000-0000-4000-8000-000000000013","exp":4102444800,"role":"authenticated","amr":[{"method":"password"}]}',true);set local role authenticated;
select pg_temp.cp_assert(public.clinic_batch_refresh('c4500000-0000-4000-8000-000000000021','c4500000-0000-4000-8000-000000000041',payload)#>>'{receipt,status}'='committed','stored recovery never retires original')from commands where name='reserve';
select pg_temp.cp_assert(not(public.clinic_batch_read('c4500000-0000-4000-8000-000000000021','c4500000-0000-4000-8000-000000000041',null,50)::text like '%objectKey%'),'no private keys in snapshot');
-- Recovery-first canonical namespace fences a delayed create from a new session.
insert into commands values('never-created','{"version":"clinic-command-v1","op":"create-batch","submissionId":"C4500000000040008000000000000039","clinicId":"C4500000000040008000000000000021","batchId":"C4500000000040008000000000000049","name":"Never committed"}');
select pg_temp.cp_assert(public.clinic_batch_refresh('c4500000-0000-4000-8000-000000000021','c4500000-0000-4000-8000-000000000049',payload)#>>'{receipt,status}'='retired','absent create is durably retired')from commands where name='never-created';
select pg_temp.cp_assert(public.clinic_batch_command(payload)->>'reason'='unavailable','late create fenced canonical UUID')from commands where name='never-created';
insert into commands values('access',public.clinic_original_access('c4500000-0000-4000-8000-000000000062'));
select pg_temp.cp_assert(payload='{"status":"refused"}'::jsonb,'Clinic original access returns no ticket')from commands where name='access';
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
do $$begin perform public.clinic_original_target(gen_random_uuid());raise exception 'TEST clinic original target accepted';exception when insufficient_privilege then null;end$$;
-- One claimed upload cannot be re-claimed by a second handler.
do $$begin perform public.clinic_upload_target('c4500000-0000-4000-8000-000000000061','c4500000-0000-4000-8000-000000000001','c4500000-0000-4000-8000-000000000011');raise exception 'repeat execution claim accepted';exception when insufficient_privilege or object_not_in_prerequisite_state then null;end$$;
do $$begin perform public.clinic_upload_execution_end('c4500000-0000-4000-8000-000000000061','c4500000-0000-4000-8000-000000000071','{"kind":"unknown"}');raise exception 'unknown execution ended';exception when invalid_parameter_value then null;end$$;
do $$begin perform public.clinic_upload_cleanup('c4500000-0000-4000-8000-000000000061');raise exception 'active cleanup falsely completed';exception when object_not_in_prerequisite_state then null;end$$;
reset role;
-- Deleting original session blocks captured read proof and finalization replay.
delete from auth.sessions where id='c4500000-0000-4000-8000-000000000013';
set local role service_role;
do $$declare t uuid;begin select(payload->>'accessId')::uuid into t from commands where name='access';perform public.clinic_original_target(t);raise exception 'revoked source ticket accepted';exception when insufficient_privilege then null;end$$;
do $$begin perform public.clinic_upload_finalize('c4500000-0000-4000-8000-000000000062','c4500000-0000-4000-8000-000000000082',repeat('a',64),5);raise exception 'revoked finalization accepted';exception when insufficient_privilege then null;end$$;
reset role;
insert into auth.sessions(id,user_id,created_at,updated_at)values('c4500000-0000-4000-8000-000000000014','c4500000-0000-4000-8000-000000000001',now(),now());
select set_config('request.jwt.claims','{"sub":"c4500000-0000-4000-8000-000000000001","session_id":"c4500000-0000-4000-8000-000000000014","exp":4102444800,"role":"authenticated","amr":[{"method":"password"}]}',true);set local role authenticated;
select pg_temp.cp_assert(jsonb_array_length(public.clinic_batch_read('c4500000-0000-4000-8000-000000000021','c4500000-0000-4000-8000-000000000041',null,50)->'files')=2,'new session reconstructs persisted rows');
select pg_temp.cp_assert(public.clinic_original_access('c4500000-0000-4000-8000-000000000062')->>'status'='refused','new current session cannot request stored original');
reset role;
select pg_temp.cp_assert((select cleanup='pending' from public.clinic_batch_files where id='c4500000-0000-4000-8000-000000000061'),'cleanup not claimed complete');
select pg_temp.cp_assert(not has_function_privilege('authenticated','public.clinic_upload_finalize(uuid,uuid,text,bigint)','execute'),'finalize service only');
select pg_temp.cp_assert(not has_table_privilege('authenticated','public.clinic_batch_files','insert'),'no direct file writes');
select pg_temp.cp_assert(not exists(select 1 from pg_policies where schemaname='storage'and tablename='objects'and (qual like '%clinic-originals%'or with_check like '%clinic-originals%')),'no direct browser storage access');
select pg_temp.cp_assert(not has_sequence_privilege('anon','public.clinic_portal_audit_id_seq','UPDATE')and not has_sequence_privilege('authenticated','public.clinic_portal_audit_id_seq','UPDATE')and not has_sequence_privilege('service_role','public.clinic_portal_audit_id_seq','UPDATE'),'audit sequence cannot be rewound by API roles');
rollback;
