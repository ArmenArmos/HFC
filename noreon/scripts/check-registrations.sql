-- Registrations: only an active admin can list member-side sign-ups and their journey step; each
-- list read is recorded; staff, clinic, banned accounts are left out; no clinical detail beyond the
-- step and an urgent yes/no. Synthetic fixtures, rolled back.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.denied(sql text)returns boolean language plpgsql as $$begin execute sql;return false;exception when insufficient_privilege then return true;end$$;
create function pg_temp.refused(sql text)returns text language plpgsql as $$begin execute sql;return 'ran';exception when others then return sqlstate;end$$;
grant execute on function pg_temp.denied(text),pg_temp.refused(text) to authenticated,anon,service_role;

-- Members M01..M10, one per step; staff: admin A (21), doctor D (22), nurse N (23); clinic user C (24);
-- banned member B (25).
insert into auth.users(id,phone,phone_confirmed_at,created_at)
 select ('cb000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'3749901800'||(n%10)::text||lpad(n::text,2,'0'),now(),now()-interval '1 day'from generate_series(1,10)n;
update auth.users set created_at=now()-interval '10 days' where id='cb000000-0000-4000-8000-000000000001';
insert into auth.users(id,phone,phone_confirmed_at)values
 ('cb000000-0000-4000-8000-000000000021',null,null),('cb000000-0000-4000-8000-000000000022',null,null),
 ('cb000000-0000-4000-8000-000000000023',null,null),('cb000000-0000-4000-8000-000000000024',null,null);
insert into auth.users(id,phone,phone_confirmed_at,banned_until)values('cb000000-0000-4000-8000-000000000025','37499018925',now(),now()+interval '100 years');
insert into public.workspace_clinics(id,name)values('cb000000-0000-4000-8000-000000000030','Synthetic registrations clinic');
insert into public.workspace_staff(user_id,role,display_name)values('cb000000-0000-4000-8000-000000000021','admin','Admin Reg');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('cb000000-0000-4000-8000-000000000022','doctor','Dr Reg','cb000000-0000-4000-8000-000000000030'),
 ('cb000000-0000-4000-8000-000000000023','nurse','Nurse Reg','cb000000-0000-4000-8000-000000000030');
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name)values('cb000000-0000-4000-8000-000000000024','cb000000-0000-4000-8000-000000000030','Clinic Reg');
-- Real sessions, so each refusal below is about the role, not a missing session.
insert into auth.sessions(id,user_id,created_at,updated_at)values
 ('cb000000-0000-4000-8000-000000000031','cb000000-0000-4000-8000-000000000021',now(),now()),('cb000000-0000-4000-8000-000000000032','cb000000-0000-4000-8000-000000000022',now(),now()),
 ('cb000000-0000-4000-8000-000000000033','cb000000-0000-4000-8000-000000000023',now(),now()),('cb000000-0000-4000-8000-000000000034','cb000000-0000-4000-8000-000000000024',now(),now()),
 ('cb000000-0000-4000-8000-000000000035','cb000000-0000-4000-8000-000000000001',now(),now());

-- M02..M10 completed the profile and consent; M03 has only the profile's own answers (not started).
update public.profiles set display_name='Reg Member '||right(id::text,2),birth_date='1970-01-01',biological_sex='female'
 where id in(select ('cb000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid from generate_series(2,10)n);
insert into public.patient_consents(user_id,version)select ('cb000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'patient-pilot-v1'from generate_series(2,10)n;
insert into public.patient_assessments(user_id,answers)values('cb000000-0000-4000-8000-000000000003','{"q1.age":56,"q1.sex":"female"}');
insert into public.patient_assessments(user_id,answers,urgent_rule)values('cb000000-0000-4000-8000-000000000004','{"q1.age":56,"q2.chest_pain":"yes"}','RF-01');
insert into public.patient_assessments(user_id,answers,completed_at)
 select ('cb000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'{"q1.age":56,"q2.x":"no"}',now()from generate_series(5,10)n;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('cb000000-0000-4000-8000-000000000005',null);
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)
 select ('cb000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'cb000000-0000-4000-8000-000000000022'from generate_series(6,10)n;
insert into public.patient_test_requests(id,user_id,requested_terms,requirements,algorithm_version,context_token,create_payload)
 values(gen_random_uuid(),'cb000000-0000-4000-8000-000000000006','{}','{}','v','t','{}');
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id)
 values(gen_random_uuid(),'cb000000-0000-4000-8000-000000000007','cb000000-0000-4000-8000-000000000023','Nurse Reg','nurse','cb000000-0000-4000-8000-000000000030');
insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label)
 values('cb000000-0000-4000-8000-000000000008','ldl',3.1,'mmol/L',now(),now(),'laboratory','Lab');
insert into public.patient_care_plans(id,user_id,clinician,instructions,active,acknowledged_at)values
 ('cb000000-0000-4000-8000-000000000049','cb000000-0000-4000-8000-000000000009','Dr Reg','Synthetic',true,null),
 ('cb000000-0000-4000-8000-000000000050','cb000000-0000-4000-8000-000000000010','Dr Reg','Synthetic',true,now());
insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft)values
 ('cb000000-0000-4000-8000-000000000009','cb000000-0000-4000-8000-000000000049',gen_random_uuid(),'cb000000-0000-4000-8000-000000000022',1,'e','{}','{}','{}'),
 ('cb000000-0000-4000-8000-000000000010','cb000000-0000-4000-8000-000000000050',gen_random_uuid(),'cb000000-0000-4000-8000-000000000022',1,'e','{}','{}','{}');

-- Review fixtures: M11 results received then retracted (stays enrolled), M12 results received;
-- M13 a short phone number; I a clinic invitee verified without a membership (excluded).
insert into auth.users(id,phone,phone_confirmed_at)values('cb000000-0000-4000-8000-000000000011','37499018111',now()),
 ('cb000000-0000-4000-8000-000000000012','37499018112',now()),('cb000000-0000-4000-8000-000000000013','1234567',now()),
 ('cb000000-0000-4000-8000-000000000026','37499018926',now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('cb000000-0000-4000-8000-000000000011','cb000000-0000-4000-8000-000000000022'),('cb000000-0000-4000-8000-000000000012','cb000000-0000-4000-8000-000000000022');
-- Lab stages need a whole visit, entry and attachment chain; only the stage rows matter here, so
-- foreign keys are not enforced for these inserts.
set local session_replication_role=replica;
insert into public.patient_care_lab_stages(id,user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id,attachment_id,retracts)values
 ('cb000000-0000-4000-8000-000000000061','cb000000-0000-4000-8000-000000000011','cb000000-0000-4000-8000-000000000071','results-received',gen_random_uuid(),now(),'cb000000-0000-4000-8000-000000000023','Nurse Reg','nurse','cb000000-0000-4000-8000-000000000030',null,null),
 ('cb000000-0000-4000-8000-000000000062','cb000000-0000-4000-8000-000000000011','cb000000-0000-4000-8000-000000000071','results-retracted',gen_random_uuid(),now(),null,'System','system','cb000000-0000-4000-8000-000000000030',gen_random_uuid(),'cb000000-0000-4000-8000-000000000061'),
 ('cb000000-0000-4000-8000-000000000063','cb000000-0000-4000-8000-000000000012','cb000000-0000-4000-8000-000000000072','results-received',gen_random_uuid(),now(),'cb000000-0000-4000-8000-000000000023','Nurse Reg','nurse','cb000000-0000-4000-8000-000000000030',null,null);
insert into public.clinic_portal_invitations(clinic_id,email,display_name,invited_phone,issuer_id,request_id,auth_user_id,status,expires_at)values
 ('cb000000-0000-4000-8000-000000000030','invitee.reg@synthetic.invalid','Clinic Invitee','+37499018926','cb000000-0000-4000-8000-000000000021',gen_random_uuid(),'cb000000-0000-4000-8000-000000000026','pending',now()+interval '1 day');
set local session_replication_role=origin;

-- 0. Review F1: the per-member lookups are indexed.
select pg_temp.ok(exists(select 1 from pg_indexes where schemaname='public' and indexname=i),format('Index %s exists',i))
 from unnest(array['clinic_booking_checkins_appointment','programme_checkins_member','patient_care_plans_member'])i;

-- 1. Grants: only authenticated may call, and the definer refuses everyone but an active admin.
select pg_temp.ok(has_function_privilege('authenticated','public.admin_member_registrations(integer,integer,integer)','execute')
 and not has_function_privilege('anon','public.admin_member_registrations(integer,integer,integer)','execute')
 and not has_function_privilege('service_role','public.admin_member_registrations(integer,integer,integer)','execute')
 and not has_function_privilege('public','public.admin_member_registrations(integer,integer,integer)','execute'),'Only authenticated holds execute');
select pg_temp.ok((select prosecdef and proconfig@>array['search_path=""'] from pg_proc where oid='public.admin_member_registrations(integer,integer,integer)'::regprocedure),'Definer with an empty search_path');

select pg_temp.as_user('cb000000-0000-4000-8000-000000000022','cb000000-0000-4000-8000-000000000032');set local role authenticated;
select pg_temp.ok(pg_temp.denied('select public.admin_member_registrations()'),'Doctor cannot list registrations');reset role;
select pg_temp.as_user('cb000000-0000-4000-8000-000000000023','cb000000-0000-4000-8000-000000000033');set local role authenticated;
select pg_temp.ok(pg_temp.denied('select public.admin_member_registrations()'),'Nurse cannot list registrations');reset role;
select pg_temp.as_user('cb000000-0000-4000-8000-000000000024','cb000000-0000-4000-8000-000000000034');set local role authenticated;
select pg_temp.ok(pg_temp.denied('select public.admin_member_registrations()'),'Clinic user cannot list registrations');reset role;
select pg_temp.as_user('cb000000-0000-4000-8000-000000000001','cb000000-0000-4000-8000-000000000035');set local role authenticated;
select pg_temp.ok(pg_temp.denied('select public.admin_member_registrations()'),'Member cannot list registrations');reset role;
select set_config('request.jwt.claims','',true);
set local role anon;select pg_temp.ok(pg_temp.denied('select public.admin_member_registrations()'),'Anonymous cannot list registrations');reset role;
set local role service_role;select pg_temp.ok(pg_temp.denied('select public.admin_member_registrations()'),'Service role cannot list registrations');reset role;
select pg_temp.ok(not exists(select 1 from public.access_audit where surface='registrations.list'),'Refused calls record nothing');

-- A deactivated admin is refused too.
update public.workspace_staff set active=false where user_id='cb000000-0000-4000-8000-000000000021';
select pg_temp.as_user('cb000000-0000-4000-8000-000000000021','cb000000-0000-4000-8000-000000000031');set local role authenticated;
select pg_temp.ok(pg_temp.denied('select public.admin_member_registrations()'),'Inactive admin cannot list registrations');reset role;
update public.workspace_staff set active=true where user_id='cb000000-0000-4000-8000-000000000021';

-- 2. The admin sees each member at the right step; staff, clinic and banned accounts are not listed.
select pg_temp.as_user('cb000000-0000-4000-8000-000000000021','cb000000-0000-4000-8000-000000000031');set local role authenticated;
create temp table allrows as select public.admin_member_registrations()v;
create temp table step5 as select public.admin_member_registrations(p_step=>5)v;
create temp table stuck as select public.admin_member_registrations(p_stuck_days=>7)v;
select pg_temp.ok(pg_temp.refused('select public.admin_member_registrations(p_step=>11)')='22023','Unknown step refused');
select pg_temp.ok(pg_temp.refused('select public.admin_member_registrations(p_stuck_days=>0)')='22023','Stuck days out of range refused');
reset role;
create temp table mine as select r from allrows,jsonb_array_elements(v->'rows')r where r->>'id' like 'cb000000-%';
select pg_temp.ok((select count(*)from mine)=13,'Thirteen members listed, no staff, clinic, invitee or banned account');
select pg_temp.ok(not exists(select 1 from mine where r->>'id' in('cb000000-0000-4000-8000-000000000021','cb000000-0000-4000-8000-000000000022',
 'cb000000-0000-4000-8000-000000000023','cb000000-0000-4000-8000-000000000024','cb000000-0000-4000-8000-000000000025','cb000000-0000-4000-8000-000000000026')),'Excluded accounts absent');
select pg_temp.ok((r->>'step')::int=e,format('Member %s at step %s (got %s)',right(r->>'id',2),e,r->>'step'))
 from mine join(values(1,1),(2,3),(3,3),(4,4),(5,5),(6,6),(7,7),(8,8),(9,9),(10,10),(11,5),(12,8),(13,1))x(n,e)on right(r->>'id',2)=lpad(n::text,2,'0');
select pg_temp.ok((select (r->>'urgent')::boolean and r->>'questionnaire'='started' from mine where r->>'id'='cb000000-0000-4000-8000-000000000004'),'Urgent flag set, questionnaire started');
select pg_temp.ok((select not (r->>'urgent')::boolean and r->'questionnaire'='null'::jsonb from mine where r->>'id'='cb000000-0000-4000-8000-000000000003'),'Profile answers alone are not a started questionnaire');
select pg_temp.ok((select not (r->>'doctorAssigned')::boolean and (r->>'enrolled')::boolean from mine where r->>'id'='cb000000-0000-4000-8000-000000000005'),'Enrolled without a doctor');
select pg_temp.ok((select (r->>'doctorAssigned')::boolean from mine where r->>'id'='cb000000-0000-4000-8000-000000000006'),'Enrolled with a doctor');
select pg_temp.ok((select r->'name'='null'::jsonb and r->>'phoneMasked' like '+374 ••• %' and r->>'channel'='phone' from mine where r->>'id'='cb000000-0000-4000-8000-000000000001'),'No name: masked phone only');
select pg_temp.ok((select r->>'phoneMasked'='+123 •••' from mine where r->>'id'='cb000000-0000-4000-8000-000000000013'),'Short phone: only the prefix shown');
select pg_temp.ok((select r->>'name'='Reg Member 02' from mine where r->>'id'='cb000000-0000-4000-8000-000000000002'),'Name shown');
-- Nothing clinical beyond step and urgent: the row keys are exactly these.
select pg_temp.ok(not exists(select 1 from mine,jsonb_object_keys(r)k where k not in('id','name','phoneMasked','signedUpAt','channel','step','stepAt','questionnaire','urgent','enrolled','doctorAssigned','lastActivityAt')),'Row carries only the listed fields');
select pg_temp.ok(position('RF-01' in (select v::text from allrows))=0 and position('ldl' in (select v::text from allrows))=0 and position('Synthetic' in (select v::text from allrows))=0,'No rule id, result or plan text in the payload');
select pg_temp.ok((select sum(value::int)from allrows,jsonb_each_text(v->'counts'))=(select (v->>'total')::int from allrows),'Step counts add up to the total');
select pg_temp.ok((select (v->'counts'->>'3')::int>=2 from allrows),'Counts per step');
select pg_temp.ok((select bool_and((r->>'step')::int=5)and count(*)filter(where r->>'id' like 'cb000000-%')=2 from step5,jsonb_array_elements(v->'rows')r),'Step filter');
select pg_temp.ok((select count(*)filter(where r->>'id' like 'cb000000-%')=1 and bool_or(r->>'id'='cb000000-0000-4000-8000-000000000001')from stuck,jsonb_array_elements(v->'rows')r),'Stuck filter: only the member idle for 10 days');

-- 3. Each read is recorded once, by the admin, with no member and the filters.
select pg_temp.ok((select count(*)from public.access_audit where surface='registrations.list' and actor_id='cb000000-0000-4000-8000-000000000021' and actor_role='admin' and member_id is null)=3,'Three successful reads recorded');
select pg_temp.ok(exists(select 1 from public.access_audit where surface='registrations.list' and object_id='step=5'),'Filter recorded');
select pg_temp.ok(exists(select 1 from public.access_audit where surface='registrations.list' and object_id='stuck=7' and session_id='cb000000-0000-4000-8000-000000000031'),'Stuck filter and session recorded');
rollback;
