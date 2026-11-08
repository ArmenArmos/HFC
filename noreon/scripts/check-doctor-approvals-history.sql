-- Synthetic read fixtures only. Automatically registered by run-checks.mjs --sql.
-- Run after a clean local replay. No provider or worker is called; everything rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'FAIL: %',label;end if;
end$$;
create function pg_temp.u(n int)returns uuid language sql immutable as $$
 select ('d7c00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.as_user(n int)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',pg_temp.u(n+100))::text,true)
$$;
create function pg_temp.history(n int,s timestamptz default now()-interval '1 day',u timestamptz default now())returns jsonb language plpgsql as $$
declare r jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;
 r:=public.doctor_approvals_history(s,u);reset role;return r;
end$$;
create function pg_temp.refused(n int)returns boolean language plpgsql as $$begin
 perform pg_temp.history(n);return false;exception when insufficient_privilege then return true;
end$$;
grant execute on all functions in schema pg_temp to authenticated,anon;
insert into auth.users(id,phone,phone_confirmed_at)
 select pg_temp.u(n),case when n<10 then '374991940'||lpad(n::text,2,'0')end,
 case when n<10 then now()end from unnest(array[1,2,3,11,12,13,14])n;
insert into auth.sessions(id,user_id,created_at,updated_at)
 select pg_temp.u(n+100),pg_temp.u(n),now()-interval '1 hour',now()from unnest(array[1,11,12,13,14])n;
insert into public.workspace_clinics(id,name)values(pg_temp.u(20),'Synthetic history clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.u(11),'doctor','History One',pg_temp.u(20)),(pg_temp.u(12),'doctor','History Two',pg_temp.u(20)),
 (pg_temp.u(13),'nurse','History Nurse',pg_temp.u(20)),(pg_temp.u(14),'admin','History Admin',null);
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values
 (pg_temp.u(1),pg_temp.u(11)),(pg_temp.u(2),pg_temp.u(12)),(pg_temp.u(3),pg_temp.u(11));
update public.profiles set display_name='Synthetic history member'where id=pg_temp.u(1);
select pg_temp.ok(pg_temp.history(11)->'rows'='[]'::jsonb,'empty history');

-- Minimal projection fixtures. Disable insert guards and unrelated foreign keys only
-- while seeding records normally created by the separate write-path checks.
-- n=1 own action; 2 another doctor on own member; 3 own action on another member;
-- 4 another doctor's action on their member; 5 own action before reassignment.
create temp table seeds(n int,m int,d int);
insert into seeds values(1,1,11),(2,1,12),(3,2,11),(4,2,12),(5,3,11);
set local session_replication_role=replica;
insert into public.conversations(id,member_id)select pg_temp.u(200+n),pg_temp.u(n)from generate_series(1,3)n;
insert into public.conversation_drafts(id,conversation_id,state,context_version,clinical_revision,source_token)
 select pg_temp.u(300+n),pg_temp.u(200+m),'approved',0,0,'synthetic'from seeds;
insert into public.conversation_approvals(id,draft_id,revision,context_version,content_hash,body,doctor_id,doctor_name,doctor_role,clinic_id,grant_id,grant_generation,intent_id,created_at)
 select pg_temp.u(400+n),pg_temp.u(300+n),1,0,'synthetic',repeat('Approved text ',10),pg_temp.u(d),'Synthetic doctor','doctor',pg_temp.u(20),pg_temp.u(500+n),1,pg_temp.u(600+n),now()-interval '1 hour'from seeds;
insert into public.conversation_deliveries(id,conversation_id,approval_id,state)
 select pg_temp.u(700+n),pg_temp.u(200+m),pg_temp.u(400+n),'held'from seeds;
insert into public.lab_ai_values(id,job_id,user_id,file_id,attachment_id,seq,test_name,value_text,page)
 select pg_temp.u(800+n),pg_temp.u(900+n),pg_temp.u(m),pg_temp.u(1000+n),pg_temp.u(1100+n),1,'Synthetic value','5',1 from seeds;
insert into public.lab_ai_value_reviews(value_id,submission_id,actor_id,action,before,after,created_at)
 select pg_temp.u(800+n),pg_temp.u(1200+n),pg_temp.u(d),'confirm','{}','{}',now()-interval '2 hours'from seeds;
insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft,published_at)
 select pg_temp.u(m),pg_temp.u(1300+n),pg_temp.u(1400+n),pg_temp.u(d),n,'synthetic','{}','{}','{}',now()-interval '3 hours'from seeds;
insert into public.member_upload_doctor_approvals(job_id,member_id,document_id,doctor_id,submission_id,version,interpretation_hy,interpretation_en,interpretation_edited,changes,created_at)
 select pg_temp.u(1500+n),pg_temp.u(m),pg_temp.u(1600+n),pg_temp.u(d),pg_temp.u(1700+n),1,'Synthetic','Synthetic',false,'{}',now()-interval '4 hours'from seeds;
insert into public.care_alerts(id,member_id,source,reason_code,rule_id,rule_version,source_ref)
 select pg_temp.u(1800+n),pg_temp.u(n),'message','synthetic','synthetic','v1','synthetic'from generate_series(1,3)n;
insert into public.care_alert_audit(alert_id,actor_id,kind,created_at)
 select pg_temp.u(1800+m),pg_temp.u(d),'acknowledged',now()-interval '5 hours'from seeds;
set local session_replication_role=origin;
-- Removing the current assignment must remove every source, even old own actions.
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.u(12)where user_id=pg_temp.u(3);
create temp table result as select pg_temp.history(11)body;
select pg_temp.ok((select jsonb_array_length(body->'rows')=5 and body->>'hasMore'='false'from result),'one own row from each source');
select pg_temp.ok((select count(distinct x->>'kind')=5 and bool_and(x->>'memberId'=pg_temp.u(1)::text)
 from result,jsonb_array_elements(body->'rows')x),'no other author or unassigned member in any source');
select pg_temp.ok((select bool_and((x->>'at')::timestamptz>=(y->>'at')::timestamptz)
 from result,jsonb_array_elements(body->'rows')with ordinality a(x,i),jsonb_array_elements(body->'rows')with ordinality b(y,j)where j=i+1),'newest first');
select pg_temp.ok((select length(x->>'excerpt')=80 and x->>'state'='held'from result,jsonb_array_elements(body->'rows')x where x->>'kind'='reply'),'frozen excerpt capped and current delivery state');
select pg_temp.ok((select bool_and(x-'kind'-'at'-'memberId'-'memberName'-'state'-'excerpt'='{}'::jsonb)from result,jsonb_array_elements(body->'rows')x),'minimal fields, no phone or birth date');
select pg_temp.ok(jsonb_array_length(pg_temp.history(12)->'rows')=5,'other doctor sees their own actions for currently assigned members only');
update public.conversation_deliveries set state='accepted_by_provider'where approval_id=pg_temp.u(401);
select pg_temp.ok(pg_temp.history(11)#>>'{rows,0,state}'='accepted_by_provider','latest delivery state is read on refresh');
update public.patient_clinical_cases set assigned_doctor_id=null where user_id=pg_temp.u(1);
select pg_temp.ok(pg_temp.history(11)->'rows'='[]'::jsonb,'unassigned members fail closed for all sources');
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.u(11)where user_id=pg_temp.u(1);

insert into public.care_alert_audit(alert_id,actor_id,kind,created_at)values
 (pg_temp.u(1801),pg_temp.u(11),'resolved',now()-interval '7 days'),
 (pg_temp.u(1801),pg_temp.u(11),'resolved',now()-interval '7 days 1 microsecond'),
 (pg_temp.u(1801),pg_temp.u(11),'resolved',now());
select pg_temp.ok(jsonb_array_length(pg_temp.history(11,now()-interval '30 days',now())->'rows')=6,'seven day clamp includes lower bound, excludes older and upper bound');
select pg_temp.ok(jsonb_array_length(pg_temp.history(11,now()-interval '8 days',now()-interval '7 days')->'rows')=1,'requested past window respected, upper bound exclusive');
insert into public.care_alert_audit(alert_id,actor_id,kind,created_at)
 select pg_temp.u(1801),pg_temp.u(11),'resolved',now()-n*interval '1 second'from generate_series(1,101)n;
select pg_temp.ok(jsonb_array_length(pg_temp.history(11)->'rows')=100 and pg_temp.history(11)->>'hasMore'='true','100 cap and honest truncation');
-- A missing delivery is unknown and exposes no text absent from the doctor chat.
set local session_replication_role=replica;
insert into public.conversation_approvals(id,draft_id,revision,context_version,content_hash,body,doctor_id,doctor_name,doctor_role,clinic_id,grant_id,grant_generation,intent_id,created_at)
 values(pg_temp.u(499),pg_temp.u(301),2,0,'synthetic','Not in the conversation',pg_temp.u(11),'Synthetic doctor','doctor',pg_temp.u(20),pg_temp.u(599),1,pg_temp.u(699),now()-interval '1 microsecond');
set local session_replication_role=origin;
select pg_temp.ok(pg_temp.history(11)#>>'{rows,0,state}'='unknown'and pg_temp.history(11)#>>'{rows,0,excerpt}'='','missing delivery is unknown, with no excerpt');
select pg_temp.ok(pg_temp.history(11,null,now())->>'code'='refused'and pg_temp.history(11,now(),now())->>'code'='refused','invalid windows refused');
select pg_temp.ok(pg_temp.refused(13)and pg_temp.refused(14)and pg_temp.refused(1),'nurse, admin and member refused');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(11),'role','authenticated')::text,true);
do $$begin
 set local role authenticated;perform public.doctor_approvals_history(now()-interval '1 day',now());
 raise exception 'FAIL: no-session doctor admitted';exception when insufficient_privilege then null;
end$$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$begin
 set local role anon;perform public.doctor_approvals_history(now()-interval '1 day',now());
 raise exception 'FAIL: anonymous admitted';exception when insufficient_privilege then null;
end$$;
reset role;
select pg_temp.ok(has_function_privilege('authenticated','public.doctor_approvals_history(timestamptz,timestamptz)','execute')
 and not has_function_privilege('anon','public.doctor_approvals_history(timestamptz,timestamptz)','execute')
 and not has_function_privilege('service_role','public.doctor_approvals_history(timestamptz,timestamptz)','execute'),'authenticated execution only');
select 'Doctor approvals history SQL checks passed.';
rollback;
