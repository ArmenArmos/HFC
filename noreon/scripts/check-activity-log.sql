-- Activity log: staff reads of member data are recorded at the source, the audit rows cannot be
-- altered, settings changes are recorded, and only an active admin can read or export the log.
-- Synthetic fixtures, rolled back.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.denied(sql text)returns boolean language plpgsql as $$begin execute sql;return false;exception when insufficient_privilege then return true;end$$;
create function pg_temp.refused(sql text)returns text language plpgsql as $$begin execute sql;return 'ran';exception when others then return sqlstate;end$$;
grant execute on function pg_temp.denied(text),pg_temp.refused(text) to authenticated,anon,service_role;
create function pg_temp.reads(m uuid,a uuid,s text)returns bigint language sql as $$select count(*)from public.access_audit where member_id=m and actor_id=a and surface=s$$;

-- Members M1 (assigned to doctor D1) and M2 (no doctor); doctors D1, D2; nurse N; admin A; clinic user C.
insert into auth.users(id,phone,phone_confirmed_at)values
 ('ac000000-0000-4000-8000-000000000001','37499017001',now()),('ac000000-0000-4000-8000-000000000002','37499017002',now()),
 ('ac000000-0000-4000-8000-000000000011',null,null),('ac000000-0000-4000-8000-000000000012',null,null),
 ('ac000000-0000-4000-8000-000000000013',null,null),('ac000000-0000-4000-8000-000000000014',null,null),('ac000000-0000-4000-8000-000000000015',null,null);
insert into public.workspace_clinics(id,name)values('ac000000-0000-4000-8000-000000000020','Synthetic audit clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('ac000000-0000-4000-8000-000000000011','doctor','Dr Audit One','ac000000-0000-4000-8000-000000000020'),
 ('ac000000-0000-4000-8000-000000000012','doctor','Dr Audit Two','ac000000-0000-4000-8000-000000000020'),
 ('ac000000-0000-4000-8000-000000000014','nurse','Nurse Audit','ac000000-0000-4000-8000-000000000020');
insert into public.workspace_staff(user_id,role,display_name)values('ac000000-0000-4000-8000-000000000013','admin','Admin Audit');
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name)values('ac000000-0000-4000-8000-000000000015','ac000000-0000-4000-8000-000000000020','Clinic Desk');
insert into auth.sessions(id,user_id,created_at,updated_at)values
 ('ac000000-0000-4000-8000-000000000031','ac000000-0000-4000-8000-000000000011',now(),now()),('ac000000-0000-4000-8000-000000000032','ac000000-0000-4000-8000-000000000012',now(),now()),
 ('ac000000-0000-4000-8000-000000000033','ac000000-0000-4000-8000-000000000013',now(),now()),('ac000000-0000-4000-8000-000000000034','ac000000-0000-4000-8000-000000000001',now(),now()),
 ('ac000000-0000-4000-8000-000000000035','ac000000-0000-4000-8000-000000000014',now(),now()),('ac000000-0000-4000-8000-000000000036','ac000000-0000-4000-8000-000000000015',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000011'),('ac000000-0000-4000-8000-000000000002',null);
update public.profiles set display_name='Audit Member One' where id='ac000000-0000-4000-8000-000000000001';
insert into public.patient_assessments(user_id)values('ac000000-0000-4000-8000-000000000001'),('ac000000-0000-4000-8000-000000000002');

-- 1. The originals are no longer reachable by any client role; the wrappers keep their grants.
select pg_temp.ok(not has_function_privilege('authenticated','public.patient_clinical_case_snapshot_unlogged(uuid)','execute')
 and not has_function_privilege('service_role','public.patient_clinical_case_snapshot_unlogged(uuid)','execute')
 and not has_function_privilege('authenticated','public._access_audit_record(uuid,text,text)','execute')
 and not has_function_privilege('authenticated','public._audit_rows(timestamptz,timestamptz,uuid,uuid,text)','execute')
 and not has_function_privilege('authenticated','public._audit_page(uuid,uuid,text,timestamptz,timestamptz,text,integer,uuid)','execute')
 and has_function_privilege('authenticated','public.patient_clinical_case_snapshot(uuid)','execute'),'Originals and helpers closed, wrappers open');
select pg_temp.ok((select count(*)from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like '%\_unlogged'
  and (has_function_privilege('authenticated',p.oid,'execute')or has_function_privilege('anon',p.oid,'execute')or has_function_privilege('service_role',p.oid,'execute')))=0,'No *_unlogged original is executable by a client role');
select pg_temp.ok((select count(*)from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like '%\_unlogged')=19,'Nineteen read functions wrapped');
-- Guard: a later migration that replaces a wrapper with its own body would silently stop recording.
-- A public wrapper may delegate to its private _<name>_as body, which then does the recording.
select pg_temp.ok((prosrc ~ '_access_audit_record' and prosrc ~ (proname||'_unlogged'))or
 (prosrc ~ ('_'||proname||'_as')and exists(select 1 from pg_proc a where a.pronamespace='public'::regnamespace and a.proname='_'||pg_proc.proname||'_as'
  and a.prosrc ~ '_access_audit_record_as' and a.prosrc ~ (pg_proc.proname||'_unlogged'))),format('%s still records reads',proname))
 from pg_proc where pronamespace='public'::regnamespace and exists(select 1 from pg_proc u where u.pronamespace='public'::regnamespace and u.proname=pg_proc.proname||'_unlogged');
select pg_temp.ok(not has_table_privilege(r,t,p),format('%s has no %s on %s',r,p,t))
 from unnest(array['anon','authenticated','service_role'])r,unnest(array['public.access_audit','public.config_audit'])t,unnest(array['select','insert','update','delete','truncate'])p;

-- 2. An assigned doctor's file read is recorded once, with no content; a refused read records nothing.
select pg_temp.as_user('ac000000-0000-4000-8000-000000000011','ac000000-0000-4000-8000-000000000031');set local role authenticated;
select pg_temp.ok((public.patient_clinical_case_snapshot('ac000000-0000-4000-8000-000000000001')->>'id')='ac000000-0000-4000-8000-000000000001','Doctor reads the assigned file');
select pg_temp.ok(pg_temp.denied('select 1 from public.access_audit'),'Doctor cannot read the audit table');
select pg_temp.ok(pg_temp.denied($q$select public.patient_clinical_case_snapshot_unlogged('ac000000-0000-4000-8000-000000000001')$q$),'Doctor cannot call the unrecorded original');
select pg_temp.ok(pg_temp.refused($q$select public.patient_clinical_case_snapshot('ac000000-0000-4000-8000-000000000002')$q$)<>'ran','Doctor refused an unassigned file');
select pg_temp.ok(pg_temp.denied('select public.admin_audit_log()'),'Doctor cannot read the activity log');
select pg_temp.ok(pg_temp.denied('select public.admin_audit_log_export()'),'Doctor cannot export the activity log');
select pg_temp.ok(pg_temp.denied('select public.admin_audit_people()'),'Doctor cannot list people');
select public.staff_record_member_access('ac000000-0000-4000-8000-000000000001','member_upload','ac000000-0000-4000-8000-0000000000aa');
select pg_temp.ok(pg_temp.refused($q$select public.staff_record_member_access('ac000000-0000-4000-8000-000000000001','member_file_hacked',null)$q$)='22023','Unknown surface refused');
reset role;
select pg_temp.ok(pg_temp.reads('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000011','member_file')=1,'Doctor file read recorded once');
select pg_temp.ok(not exists(select 1 from public.access_audit where member_id='ac000000-0000-4000-8000-000000000002'),'Refused read recorded nothing');
select pg_temp.ok((select actor_role='doctor' and object_id is null and session_id='ac000000-0000-4000-8000-000000000031' from public.access_audit where surface='member_file' and member_id='ac000000-0000-4000-8000-000000000001'),'Row says who, role and session, nothing read');
select pg_temp.ok(pg_temp.reads('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000011','member_upload')=1,'App-recorded upload open stored');

-- 2b. Review F1: with a switch off a read returns {"enabled": false}, sometimes before the access check.
-- Nothing was shown, so nothing is recorded, whoever calls (here an unassigned doctor, the nurse, a clinic user).
select set_config('request.jwt.claims','',true);update public.gp_report_capabilities set enabled=false;
select pg_temp.as_user('ac000000-0000-4000-8000-000000000012','ac000000-0000-4000-8000-000000000032');set local role authenticated;
select pg_temp.ok(public.doctor_gp_report_source('ac000000-0000-4000-8000-000000000001')->>'enabled'='false','Switch off: unassigned doctor gets enabled=false');
select public.doctor_gp_report_version('ac000000-0000-4000-8000-000000000001',1);
reset role;
select pg_temp.as_user('ac000000-0000-4000-8000-000000000014','ac000000-0000-4000-8000-000000000035');set local role authenticated;
select public.doctor_gp_report_source('ac000000-0000-4000-8000-000000000001');reset role;
select pg_temp.as_user('ac000000-0000-4000-8000-000000000015','ac000000-0000-4000-8000-000000000036');set local role authenticated;
select public.doctor_gp_report_source('ac000000-0000-4000-8000-000000000001');reset role;
select pg_temp.as_user('ac000000-0000-4000-8000-000000000011','ac000000-0000-4000-8000-000000000031');set local role authenticated;
select public.doctor_gp_report_source('ac000000-0000-4000-8000-000000000001');reset role;
select pg_temp.ok(not exists(select 1 from public.access_audit where surface like 'member_gp_report%'),'Switch off: no GP report read recorded for anyone');
-- Switch on: the unassigned doctor is refused and the assigned doctor's read is recorded once.
select set_config('request.jwt.claims','',true);update public.gp_report_capabilities set enabled=true;
select pg_temp.as_user('ac000000-0000-4000-8000-000000000012','ac000000-0000-4000-8000-000000000032');set local role authenticated;
select pg_temp.ok(pg_temp.refused($q$select public.doctor_gp_report_source('ac000000-0000-4000-8000-000000000001')$q$)='42501','Switch on: unassigned doctor refused');reset role;
select pg_temp.as_user('ac000000-0000-4000-8000-000000000011','ac000000-0000-4000-8000-000000000031');set local role authenticated;
select pg_temp.ok(pg_temp.refused($q$select public.doctor_gp_report_source('ac000000-0000-4000-8000-000000000001')$q$)='ran','Switch on: assigned doctor reads');reset role;
select pg_temp.ok((select count(*)from public.access_audit where surface='member_gp_report')=1 and pg_temp.reads('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000011','member_gp_report')=1,'Switch on: one row, the assigned doctor');
select set_config('request.jwt.claims','',true);update public.gp_report_capabilities set enabled=false;

-- 2c. Review F2: the app-side recorder refuses members the caller cannot read, and unknown members.
select pg_temp.as_user('ac000000-0000-4000-8000-000000000012','ac000000-0000-4000-8000-000000000032');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.staff_record_member_access('ac000000-0000-4000-8000-000000000001','member_upload','x')$q$),'Unassigned doctor cannot record an upload open');
reset role;
select pg_temp.as_user('ac000000-0000-4000-8000-000000000011','ac000000-0000-4000-8000-000000000031');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.staff_record_member_access('ac000000-0000-4000-8000-0000000000ff','member_history',null)$q$),'Unknown member refused');
select pg_temp.ok(pg_temp.denied($q$select public.staff_record_member_access('ac000000-0000-4000-8000-000000000002','member_history',null)$q$),'Assigned doctor cannot record another member');
reset role;
select pg_temp.as_user('ac000000-0000-4000-8000-000000000013','ac000000-0000-4000-8000-000000000033');set local role authenticated;
select pg_temp.ok(pg_temp.refused($q$select public.staff_record_member_access('ac000000-0000-4000-8000-000000000002','member_history',null)$q$)='ran','Admin records a history read');
reset role;
select pg_temp.ok(not exists(select 1 from public.access_audit where actor_id='ac000000-0000-4000-8000-000000000012' and surface='member_upload'),'Refused recorder wrote nothing');

-- 3. Rows cannot be altered, not even by the owner.
select pg_temp.ok(pg_temp.refused('update public.access_audit set surface=''member_trace''')='55000','access_audit update blocked');
select pg_temp.ok(pg_temp.refused('delete from public.access_audit')='55000','access_audit delete blocked');

-- 4. A member reading their own data, and an unlinked account, are not recorded; a member cannot write rows.
select pg_temp.as_user('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000034');set local role authenticated;
select pg_temp.refused('select public.booking_pilot_workspace()');
select pg_temp.ok(pg_temp.denied($q$select public.staff_record_member_access('ac000000-0000-4000-8000-000000000002','member_history',null)$q$),'Member cannot write a staff read');
select pg_temp.ok(pg_temp.denied('select public.admin_audit_log()'),'Member cannot read the activity log');
reset role;
select pg_temp.ok(not exists(select 1 from public.access_audit where actor_id='ac000000-0000-4000-8000-000000000001'),'Member self-read not recorded');

-- 5. Nurse and clinic users cannot read the log either.
select pg_temp.as_user('ac000000-0000-4000-8000-000000000014','ac000000-0000-4000-8000-000000000035');set local role authenticated;
select pg_temp.ok(pg_temp.denied('select public.admin_audit_log()'),'Nurse cannot read the activity log');
reset role;
select pg_temp.as_user('ac000000-0000-4000-8000-000000000015','ac000000-0000-4000-8000-000000000036');set local role authenticated;
select pg_temp.ok(pg_temp.denied('select public.admin_audit_log()'),'Clinic user cannot read the activity log');
select pg_temp.ok(pg_temp.denied('select public.admin_audit_log_export()'),'Clinic user cannot export the activity log');
reset role;
set local role anon;select pg_temp.ok(pg_temp.denied('select public.admin_audit_log()'),'Anonymous cannot read the activity log');reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
select pg_temp.ok(pg_temp.denied('select public.admin_audit_log()'),'Service role cannot read the activity log');reset role;

-- 6. Settings changes are recorded with the database role; a no-op update is not.
insert into public.lab_ai_capabilities(singleton,enabled)values(true,false)on conflict(singleton)do update set enabled=false;
update public.lab_ai_capabilities set enabled=true;
update public.lab_ai_capabilities set enabled=true;
select pg_temp.ok((select count(*)from public.config_audit where at>=now() and table_name='lab_ai_capabilities' and operation='update' and changed->'enabled'->>'to'='true' and db_role is not null and actor_id is null)=1,'Switch change recorded once, operator role kept');
update public.workspace_staff set role='nurse' where user_id='ac000000-0000-4000-8000-000000000012';
select pg_temp.ok(exists(select 1 from public.config_audit where table_name='workspace_staff' and row_key='ac000000-0000-4000-8000-000000000012' and changed->'role'->>'to'='nurse'),'Role change recorded');
select pg_temp.ok(pg_temp.refused('delete from public.config_audit')='55000','config_audit delete blocked');

-- 7. The admin sees the unified log, filtered and paged; the export is recorded and shows up.
select pg_temp.as_user('ac000000-0000-4000-8000-000000000013','ac000000-0000-4000-8000-000000000033');set local role authenticated;
select public.admin_member_contacts(array['ac000000-0000-4000-8000-000000000001'::uuid]);
create temp table page as select public.admin_audit_log(p_member=>'ac000000-0000-4000-8000-000000000001',p_category=>'record_access')v;
reset role;
select pg_temp.ok(pg_temp.reads('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000013','member_contacts')=1,'Admin contact read recorded');
select pg_temp.ok(jsonb_array_length((select v->'rows' from page))=5,'Four reads of M1 and the log view listed');
select pg_temp.ok((select v->'rows'->0->>'action' from page)='audit_log.view' and (select v->'rows'->0->>'actorName' from page)='Admin Audit'
 and (select v->'rows'->0->>'memberName' from page)='Audit Member One','Newest first, with names');
select pg_temp.ok(not exists(select 1 from page,jsonb_array_elements(v->'rows')r where r ?| array['detail','details','changed','payload','body']),'No detail columns leak');
select pg_temp.as_user('ac000000-0000-4000-8000-000000000013','ac000000-0000-4000-8000-000000000033');set local role authenticated;
create temp table p1 as select public.admin_audit_log(p_member=>'ac000000-0000-4000-8000-000000000001',p_limit=>2)v;
create temp table p2 as select public.admin_audit_log(p_member=>'ac000000-0000-4000-8000-000000000001',p_limit=>2,p_cursor=>(select v->>'next' from p1))v;
create temp table byactor as select public.admin_audit_log(p_actor=>'ac000000-0000-4000-8000-000000000011')v;
create temp table admins as select public.admin_audit_log(p_category=>'permission_change')v;
select pg_temp.ok(pg_temp.refused($q$select public.admin_audit_log(p_cursor=>'x; drop')$q$)='22023','Malformed cursor refused');
select pg_temp.ok(pg_temp.refused($q$select public.admin_audit_log(p_category=>'everything')$q$)='22023','Unknown category refused');
create temp table ex as select public.admin_audit_log_export(p_member=>'ac000000-0000-4000-8000-000000000001')v;
create temp table exports as select public.admin_audit_log(p_category=>'export',p_member=>'ac000000-0000-4000-8000-000000000001')v;
create temp table people as select public.admin_audit_people()v;
reset role;
select pg_temp.ok(jsonb_array_length((select v->'rows' from p1))=2 and (select v->>'next' from p1) is not null and jsonb_array_length((select v->'rows' from p2))>=1
 and not exists(select 1 from jsonb_array_elements((select v->'rows' from p1))a,jsonb_array_elements((select v->'rows' from p2))b where a->>'key'=b->>'key'),'Pages do not overlap');
select pg_temp.ok((select bool_and(r->>'actorId'='ac000000-0000-4000-8000-000000000011')from byactor,jsonb_array_elements(v->'rows')r) and jsonb_array_length((select v->'rows' from byactor))=3,'Person filter');
select pg_temp.ok(exists(select 1 from admins,jsonb_array_elements(v->'rows')r where r->>'source'='config' and r->>'action'='update:workspace_staff'),'Role change in the permission category');
select pg_temp.ok(jsonb_array_length((select v->'rows' from ex))>=3,'Export returns the rows');
select pg_temp.ok(exists(select 1 from public.access_audit where surface='audit_log.export' and actor_id='ac000000-0000-4000-8000-000000000013' and member_id='ac000000-0000-4000-8000-000000000001'),'Export recorded');
select pg_temp.ok(jsonb_array_length((select v->'rows' from exports))=1,'Export listed under exports');
select pg_temp.ok((select count(*)from people,jsonb_array_elements(v->'people')p where p->>'id' like 'ac000000-%')=5 and exists(select 1 from people,jsonb_array_elements(v->'people')p where p->>'id'='ac000000-0000-4000-8000-000000000015' and p->>'role'='clinic'),'People: four staff and one clinic user');
rollback;
