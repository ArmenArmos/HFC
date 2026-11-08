-- Gohar QA 151 and 155: the nurse's Visits list and the visit page use one access rule, and visit
-- items are recorded only from the visit day (Yerevan). Fictional fixtures; everything rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.q_assert(ok boolean,label text)returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.q_as(p_user uuid,p_session uuid)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',p_session)::text,true);
end$$;
-- m1: confirmed phone, visits today (r1) and in two days (r2). m3: no confirmed phone (the QA 151
-- member), visit today (r3). m4: confirmed phone, but the assigned doctor works in another clinic (r4).
-- Doctor d1 and nurses n1 (assigned to all), n2 in clinic k1; doctor d2 in clinic k2; admin.
insert into auth.users(id,phone,phone_confirmed_at)values
 ('c7710000-0000-4000-8000-000000000001','374000771001',now()),('c7710000-0000-4000-8000-000000000003',null,null),
 ('c7710000-0000-4000-8000-000000000004','374000771004',now()),
 ('c7710000-0000-4000-8000-000000000011',null,null),('c7710000-0000-4000-8000-000000000012',null,null),
 ('c7710000-0000-4000-8000-000000000013',null,null),('c7710000-0000-4000-8000-000000000014',null,null),
 ('c7710000-0000-4000-8000-000000000015',null,null);
insert into public.workspace_clinics(id,name)values('c7710000-0000-4000-8000-000000000020','Synthetic QA151 clinic one'),('c7710000-0000-4000-8000-000000000021','Synthetic QA151 clinic two');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('c7710000-0000-4000-8000-000000000011','doctor','Synthetic doctor one','c7710000-0000-4000-8000-000000000020'),
 ('c7710000-0000-4000-8000-000000000015','doctor','Synthetic doctor two','c7710000-0000-4000-8000-000000000021'),
 ('c7710000-0000-4000-8000-000000000012','nurse','Synthetic nurse one','c7710000-0000-4000-8000-000000000020'),
 ('c7710000-0000-4000-8000-000000000013','nurse','Synthetic nurse two','c7710000-0000-4000-8000-000000000020'),
 ('c7710000-0000-4000-8000-000000000014','admin','Synthetic admin',null);
insert into auth.sessions(id,user_id,created_at,updated_at)values
 ('c7710000-0000-4000-8000-000000000032','c7710000-0000-4000-8000-000000000012',now(),now()),
 ('c7710000-0000-4000-8000-000000000033','c7710000-0000-4000-8000-000000000013',now(),now()),
 ('c7710000-0000-4000-8000-000000000034','c7710000-0000-4000-8000-000000000014',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('c7710000-0000-4000-8000-000000000001','c7710000-0000-4000-8000-000000000011','c7710000-0000-4000-8000-000000000012'),
 ('c7710000-0000-4000-8000-000000000003','c7710000-0000-4000-8000-000000000011','c7710000-0000-4000-8000-000000000012'),
 ('c7710000-0000-4000-8000-000000000004','c7710000-0000-4000-8000-000000000015','c7710000-0000-4000-8000-000000000012');
insert into public.patient_test_requests(id,user_id,status,requested_terms,requirements,algorithm_version,context_token,create_payload,current_arrangement)
 select id,m,'confirmed','{}','[{"id":"lipid-panel","title":"Lipid panel","method":"lab"},{"id":"anthropometry","title":"Weight and waist","method":"clinic"}]',
  'synthetic','synthetic','{}',jsonb_build_object('terms',jsonb_build_object('mode','home','startsAt',s,'endsAt',s+interval '1 hour','timezone','Asia/Yerevan','location','Synthetic street 1'))
 from(values('c7710000-0000-4000-8000-000000000041'::uuid,'c7710000-0000-4000-8000-000000000001'::uuid,date_trunc('minute',now())),
  ('c7710000-0000-4000-8000-000000000042'::uuid,'c7710000-0000-4000-8000-000000000001'::uuid,date_trunc('minute',now())+interval '2 days'),
  ('c7710000-0000-4000-8000-000000000043'::uuid,'c7710000-0000-4000-8000-000000000003'::uuid,date_trunc('minute',now())),
  ('c7710000-0000-4000-8000-000000000044'::uuid,'c7710000-0000-4000-8000-000000000004'::uuid,date_trunc('minute',now())))t(id,m,s);
update public.nurse_visit_settings set enabled=true;
create temp table q(label text primary key,v jsonb);
grant select,insert,update on q to authenticated;
create function pg_temp.q_mark(p_sub text,p_item text,p_done boolean,p_note text,p_vals jsonb,p_id text default 'c7710000-0000-4000-8000-000000000042',p_member text default 'c7710000-0000-4000-8000-000000000001')returns jsonb language sql as $$
 select public.nurse_visit_mark(jsonb_build_object('version','nurse-visit-v1','memberId',p_member,'source','home-request','sourceId',p_id,'submissionId',p_sub,'item',p_item,'done',p_done,'note',p_note,'values',coalesce(p_vals,'null'::jsonb)))
$$;
create function pg_temp.q_step(p_sub text,p_step text,p_id text default 'c7710000-0000-4000-8000-000000000042')returns jsonb language sql as $$
 select public.nurse_visit_step(jsonb_build_object('version','nurse-visit-v1','memberId','c7710000-0000-4000-8000-000000000001','source','home-request','sourceId',p_id,'submissionId',p_sub,'step',p_step))
$$;
grant execute on function pg_temp.q_mark(text,text,boolean,text,jsonb,text,text),pg_temp.q_step(text,text,text)to authenticated;

-- QA 151: list and detail agree -----------------------------------------------------------------
select pg_temp.q_as('c7710000-0000-4000-8000-000000000012','c7710000-0000-4000-8000-000000000032');
set local role authenticated;
insert into q values('list',public.nurse_visit_list());
insert into q select 'detail:'||(x->>'id'),public.nurse_visit_detail((x->>'memberId')::uuid,x->>'source',(x->>'id')::uuid)from q,jsonb_array_elements(q.v->'visits')x where q.label='list';
insert into q values('detail-nophone',public.nurse_visit_detail('c7710000-0000-4000-8000-000000000003','home-request','c7710000-0000-4000-8000-000000000043'));
insert into q values('detail-otherclinic',public.nurse_visit_detail('c7710000-0000-4000-8000-000000000004','home-request','c7710000-0000-4000-8000-000000000044'));
insert into q values('mark-nophone',pg_temp.q_mark('c7710000-0000-4000-8000-000000000105','measure:bp',false,null,null,'c7710000-0000-4000-8000-000000000043','c7710000-0000-4000-8000-000000000003'));
reset role;
select pg_temp.q_assert((select array_agg(x->>'id' order by x->>'id')=array['c7710000-0000-4000-8000-000000000041','c7710000-0000-4000-8000-000000000042']from q,jsonb_array_elements(v->'visits')x where label='list'),
 'Nurse lists only the visits of members she may open (not the unconfirmed-phone member, not the other-clinic doctor''s member)');
select pg_temp.q_assert((select count(*)=2 and bool_and(v->>'enabled'='true'and v ? 'visit')from q where label like 'detail:%'),'Every listed visit opens');
select pg_temp.q_assert((select v->>'status'='access'from q where label='detail-nophone'),'Unconfirmed-phone member: detail refused');
select pg_temp.q_assert((select v->>'status'='access'from q where label='detail-otherclinic'),'Doctor in another clinic: detail refused');
select pg_temp.q_assert((select v->>'status'='access'from q where label='mark-nophone'),'Unconfirmed-phone member: ticks refused');
select pg_temp.q_as('c7710000-0000-4000-8000-000000000013','c7710000-0000-4000-8000-000000000033');
set local role authenticated;
insert into q values('n2-list',public.nurse_visit_list());
insert into q values('n2-detail',public.nurse_visit_detail('c7710000-0000-4000-8000-000000000001','home-request','c7710000-0000-4000-8000-000000000041'));
reset role;
select pg_temp.q_assert((select jsonb_array_length(v->'visits')=0 from q where label='n2-list')and(select v->>'status'='access'from q where label='n2-detail'),'Unassigned nurse: neither list nor detail');
select pg_temp.q_as('c7710000-0000-4000-8000-000000000014','c7710000-0000-4000-8000-000000000034');
set local role authenticated;
insert into q values('admin-list',public.nurse_visit_list());
reset role;
select pg_temp.q_assert((select count(*)=4 from q,jsonb_array_elements(v->'visits')x where label='admin-list'and x->>'id' like 'c7710000-%'),'Admin list unchanged');

-- QA 155: visit-day lock ------------------------------------------------------------------------
select pg_temp.q_as('c7710000-0000-4000-8000-000000000012','c7710000-0000-4000-8000-000000000032');
set local role authenticated;
insert into q values('early-sample',pg_temp.q_mark('c7710000-0000-4000-8000-000000000201','sample:lipid-panel',true,null,null));
insert into q values('early-not-taken',pg_temp.q_mark('c7710000-0000-4000-8000-000000000202','sample:lipid-panel',false,'Synthetic reason',null));
insert into q values('early-bp',pg_temp.q_mark('c7710000-0000-4000-8000-000000000203','measure:bp',true,null,'{"systolic":130,"diastolic":80,"pulse":70}'));
insert into q values('early-weight',pg_temp.q_mark('c7710000-0000-4000-8000-000000000204','measure:weight',true,null,'{"value":80}'));
insert into q values('early-check',pg_temp.q_mark('c7710000-0000-4000-8000-000000000205','check:bp-cuff-fit',true,null,null));
insert into q values('early-confirm',pg_temp.q_step('c7710000-0000-4000-8000-000000000206','confirmed'));
insert into q values('early-detail',public.nurse_visit_detail('c7710000-0000-4000-8000-000000000001','home-request','c7710000-0000-4000-8000-000000000042'));
insert into q values('today-sample',pg_temp.q_mark('c7710000-0000-4000-8000-000000000211','sample:lipid-panel',true,null,null,'c7710000-0000-4000-8000-000000000041'));
insert into q values('today-bp',pg_temp.q_mark('c7710000-0000-4000-8000-000000000212','measure:bp',true,null,'{"systolic":130,"diastolic":80,"pulse":null}','c7710000-0000-4000-8000-000000000041'));
insert into q values('today-check',pg_temp.q_mark('c7710000-0000-4000-8000-000000000213','check:bp-cuff-fit',false,'Synthetic comment','null','c7710000-0000-4000-8000-000000000041'));
reset role;
select pg_temp.q_assert((select bool_and(v->>'status'='too-early')and count(*)=5 from q where label like 'early-%'and label not in('early-confirm','early-detail')),'Before the day: sample taken, not taken, readings and checklist ticks are refused');
select pg_temp.q_assert(not exists(select 1 from public.nurse_visit_marks where source_id='c7710000-0000-4000-8000-000000000042'),'Before the day: nothing is written');
select pg_temp.q_assert((select v->>'status'='saved'from q where label='early-confirm'),'Before the day: confirming the visit is still allowed');
select pg_temp.q_assert((select v->>'today'<(v#>>'{visit,startsAt}')from q where label='early-detail'),'Detail gives the UI the dates it locks on');
select pg_temp.q_assert((select bool_and(v->>'status'='saved')and count(*)=3 from q where label like 'today-%'),'On the day: samples, readings and checklist ticks are saved');

-- A completed visit is unaffected: further ticks answer completed, a replay still answers saved.
select pg_temp.q_as('c7710000-0000-4000-8000-000000000012','c7710000-0000-4000-8000-000000000032');
set local role authenticated;
insert into q values('complete',public.nurse_visit_complete(jsonb_build_object('version','nurse-visit-v1','memberId','c7710000-0000-4000-8000-000000000001','source','home-request',
 'sourceId','c7710000-0000-4000-8000-000000000041','submissionId','c7710000-0000-4000-8000-000000000301','visitId','c7710000-0000-4000-8000-000000000302',
 'openSubmissionId','c7710000-0000-4000-8000-000000000303','appendSubmissionId','c7710000-0000-4000-8000-000000000304','reason','Synthetic reason')));
insert into q values('after-mark',pg_temp.q_mark('c7710000-0000-4000-8000-000000000221','measure:weight',true,null,'{"value":80}','c7710000-0000-4000-8000-000000000041'));
insert into q values('after-replay',pg_temp.q_mark('c7710000-0000-4000-8000-000000000211','sample:lipid-panel',true,null,null,'c7710000-0000-4000-8000-000000000041'));
insert into q values('after-detail',public.nurse_visit_detail('c7710000-0000-4000-8000-000000000001','home-request','c7710000-0000-4000-8000-000000000041'));
reset role;
select pg_temp.q_assert((select v->>'status'='saved'from q where label='complete'),'Today''s visit completes');
select pg_temp.q_assert((select v->>'status'='completed'from q where label='after-mark'),'Completed visit: further ticks answer completed');
select pg_temp.q_assert((select v->>'status'='saved'and v->>'replayed'='true'from q where label='after-replay'),'Completed visit: a replay of a saved tick still answers saved');
select pg_temp.q_assert((select v->'completion'<>'null'::jsonb and(v->'counts'->>'samplesTaken')::int=1 from q where label='after-detail'),'Completed visit still opens with its recorded sample');
rollback;
\echo 'Nurse visits QA 151/155: every listed visit opens, unconfirmed-phone and other-clinic members are in neither list nor detail; items are refused before the visit day and saved on it; confirming stays allowed early; completed visits unchanged.'
