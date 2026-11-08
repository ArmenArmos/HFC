-- Nurse visit flow: action list, ticks and Complete visit. Fictional fixtures; everything rolls back.
-- The assigned nurse can read, tick and complete; another nurse, the member and the doctor cannot;
-- the admin reads completion counts only. A home request becomes completed; a slot booking counts
-- as attended and gets collection entries through the existing visit command.
\set ON_ERROR_STOP on
begin;
create function pg_temp.nv_assert(ok boolean,label text)returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.nv_as(p_user uuid,p_session uuid)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',p_session)::text,true);
end$$;
-- Members m1 (home request) and m2 (slot booking); doctor; nurse n1 (assigned), n2 (same clinic); admin.
insert into auth.users(id,phone,phone_confirmed_at)values
 ('c7700000-0000-4000-8000-000000000001','374000770001',now()),('c7700000-0000-4000-8000-000000000002','374000770002',now()),
 ('c7700000-0000-4000-8000-000000000011',null,null),('c7700000-0000-4000-8000-000000000012',null,null),
 ('c7700000-0000-4000-8000-000000000013',null,null),('c7700000-0000-4000-8000-000000000014',null,null);
insert into public.workspace_clinics(id,name)values('c7700000-0000-4000-8000-000000000020','Synthetic nurse visit clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('c7700000-0000-4000-8000-000000000011','doctor','Synthetic doctor','c7700000-0000-4000-8000-000000000020'),
 ('c7700000-0000-4000-8000-000000000012','nurse','Synthetic nurse one','c7700000-0000-4000-8000-000000000020'),
 ('c7700000-0000-4000-8000-000000000013','nurse','Synthetic nurse two','c7700000-0000-4000-8000-000000000020'),
 ('c7700000-0000-4000-8000-000000000014','admin','Synthetic admin',null);
insert into auth.sessions(id,user_id,created_at,updated_at)values
 ('c7700000-0000-4000-8000-000000000031','c7700000-0000-4000-8000-000000000011',now(),now()),
 ('c7700000-0000-4000-8000-000000000032','c7700000-0000-4000-8000-000000000012',now(),now()),
 ('c7700000-0000-4000-8000-000000000033','c7700000-0000-4000-8000-000000000013',now(),now()),
 ('c7700000-0000-4000-8000-000000000034','c7700000-0000-4000-8000-000000000014',now(),now()),
 ('c7700000-0000-4000-8000-000000000035','c7700000-0000-4000-8000-000000000001',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('c7700000-0000-4000-8000-000000000001','c7700000-0000-4000-8000-000000000011','c7700000-0000-4000-8000-000000000012'),
 ('c7700000-0000-4000-8000-000000000002','c7700000-0000-4000-8000-000000000011','c7700000-0000-4000-8000-000000000012');
insert into public.profiles(id,display_name)values('c7700000-0000-4000-8000-000000000001','Synthetic Member One')on conflict(id)do update set display_name=excluded.display_name;
-- Home request today (r1) and tomorrow (r2) for m1.
insert into public.patient_test_requests(id,user_id,status,requested_terms,requirements,algorithm_version,context_token,create_payload,current_arrangement)
 select id,'c7700000-0000-4000-8000-000000000001','confirmed','{}',
  '[{"id":"lipid-panel","title":"Lipid panel","method":"lab"},{"id":"ecg-12-lead","title":"ECG","method":"clinic"},{"id":"urine-acr","title":"Urine ACR","method":"lab"},{"id":"anthropometry","title":"Weight and waist","method":"clinic"}]',
  'synthetic','synthetic','{}',jsonb_build_object('terms',jsonb_build_object('mode','home','startsAt',s,'endsAt',s+interval '1 hour','timezone','Asia/Yerevan','location','Synthetic street 1'))
 from(values('c7700000-0000-4000-8000-000000000041'::uuid,date_trunc('minute',now())),('c7700000-0000-4000-8000-000000000042'::uuid,date_trunc('minute',now())+interval '2 days'))t(id,s);
update public.nurse_visit_settings set enabled=true;

-- Switch-off and role refusals ---------------------------------------------------------------
create temp table nv(label text primary key,v jsonb);
grant select,insert,update on nv to authenticated;
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000012','c7700000-0000-4000-8000-000000000032');
set local role authenticated;
insert into nv values('list',public.nurse_visit_list());
insert into nv values('nav-on',to_jsonb(public.nurse_visit_navigation()));
insert into nv values('detail',public.nurse_visit_detail('c7700000-0000-4000-8000-000000000001','home-request','c7700000-0000-4000-8000-000000000041'));
reset role;
select pg_temp.nv_assert((select v->>'enabled'='true'and jsonb_array_length(v->'visits')=2 from nv where label='list'),'Assigned nurse lists both home visits');
select pg_temp.nv_assert((select v#>>'{visits,0,id}'='c7700000-0000-4000-8000-000000000041'and(v#>>'{visits,0,samplesPlanned}')::int=2 and v#>>'{visits,0,memberName}'='Synthetic Member One'from nv where label='list'),'Today first, two lab samples (clinic test excluded)');
select pg_temp.nv_assert((select v#>>'{items,0,key}'='sample:lipid-panel'and v#>>'{items,1,key}'='sample:urine-acr'and v#>>'{items,2,key}'='measure:bp'
 and v#>>'{items,3,key}'='measure:weight'and v#>>'{items,4,key}'='measure:waist'and not exists(select 1 from jsonb_array_elements(v->'items')i where i->>'kind'='device')from nv where label='detail'),'Items from data: two samples, BP, weight and waist (anthropometry ordered), no device when none assigned');
select pg_temp.nv_assert((select array_agg(i->>'checkId' order by o)=array['bp-validated-device','bp-cuff-fit','bp-seated-rest','bp-conditions-medicines','urgent-symptoms','severe-bp-contact','uacr-first-morning','uacr-confounders','sample-time-medicines']
 and bool_and(i->>'version'='protocol-draft-2'and length(i->>'source')>3)from nv,jsonb_array_elements(v->'items')with ordinality x(i,o)where label='detail'and i->>'kind'='check'),'Protocol checklist: always items plus urine ACR and lab-sample items, no fasting item without fasting glucose, each with its source');
select pg_temp.nv_assert((select v->>'checklistVersion'='protocol-draft-2'and v->'steps'='[]'::jsonb from nv where label='detail'),'Checklist version and empty timeline');
select pg_temp.nv_assert(exists(select 1 from public.access_audit where member_id='c7700000-0000-4000-8000-000000000001'and surface='member_nurse_visit'),'Detail read is audited');
-- Another nurse, the doctor, the admin and the member.
create function pg_temp.nv_mark(p_sub text,p_item text,p_done boolean,p_note text,p_vals jsonb,p_source text default 'home-request',p_id text default 'c7700000-0000-4000-8000-000000000041',p_member text default 'c7700000-0000-4000-8000-000000000001')returns jsonb language sql as $$
 select public.nurse_visit_mark(jsonb_build_object('version','nurse-visit-v1','memberId',p_member,'source',p_source,'sourceId',p_id,'submissionId',p_sub,'item',p_item,'done',p_done,'note',p_note,'values',coalesce(p_vals,'null'::jsonb)))
$$;
create function pg_temp.nv_complete(p_sub text,p_visit text,p_reason text,p_source text default 'home-request',p_id text default 'c7700000-0000-4000-8000-000000000041',p_member text default 'c7700000-0000-4000-8000-000000000001')returns jsonb language sql as $$
 select public.nurse_visit_complete(jsonb_build_object('version','nurse-visit-v1','memberId',p_member,'source',p_source,'sourceId',p_id,'submissionId',p_sub,'visitId',p_visit,
  'openSubmissionId',left(p_visit,34)||'a1','appendSubmissionId',left(p_visit,34)||'a2','reason',p_reason))
$$;
grant execute on function pg_temp.nv_mark(text,text,boolean,text,jsonb,text,text,text),pg_temp.nv_complete(text,text,text,text,text,text)to authenticated;
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000013','c7700000-0000-4000-8000-000000000033');
set local role authenticated;
insert into nv values('n2-detail',public.nurse_visit_detail('c7700000-0000-4000-8000-000000000001','home-request','c7700000-0000-4000-8000-000000000041'));
insert into nv values('n2-mark',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000101','sample:lipid-panel',true,null,null));
insert into nv values('n2-complete',pg_temp.nv_complete('c7700000-0000-4000-8000-000000000102','c7700000-0000-4000-8000-000000000103','Synthetic reason'));
insert into nv values('n2-list',public.nurse_visit_list());
insert into nv values('n2-step',public.nurse_visit_step(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001','source','home-request','sourceId','c7700000-0000-4000-8000-000000000041','submissionId','c7700000-0000-4000-8000-000000000108','step','confirmed')));
insert into nv values('n2-record',public.nurse_visit_record('c7700000-0000-4000-8000-000000000001'));
reset role;
select pg_temp.nv_assert((select v->>'status'='access'from nv where label='n2-detail'),'Other nurse cannot read the visit');
select pg_temp.nv_assert((select v->>'status'='access'from nv where label='n2-mark'),'Other nurse cannot tick');
select pg_temp.nv_assert((select v->>'status'='access'from nv where label='n2-complete'),'Other nurse cannot complete');
select pg_temp.nv_assert((select jsonb_array_length(v->'visits')=0 from nv where label='n2-list'),'Other nurse lists none of these visits');
select pg_temp.nv_assert((select v->>'status'='access'from nv where label='n2-step')and(select v->>'status'='access'from nv where label='n2-record'),'Other nurse cannot record a step or read the record');
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000011','c7700000-0000-4000-8000-000000000031');
set local role authenticated;
insert into nv values('doctor-mark',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000104','sample:lipid-panel',true,null,null));
reset role;
select pg_temp.nv_assert((select v->>'status'='access'from nv where label='doctor-mark'),'Doctor cannot tick');
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000001','c7700000-0000-4000-8000-000000000035');
set local role authenticated;
insert into nv values('member-mark',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000105','sample:lipid-panel',true,null,null));
insert into nv values('member-complete',pg_temp.nv_complete('c7700000-0000-4000-8000-000000000106','c7700000-0000-4000-8000-000000000107','Synthetic reason'));
insert into nv values('member-before',public.patient_member_nurse_visit());
insert into nv values('nav-member',to_jsonb(public.nurse_visit_navigation()));
insert into nv values('member-step',public.nurse_visit_step(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001','source','home-request','sourceId','c7700000-0000-4000-8000-000000000041','submissionId','c7700000-0000-4000-8000-000000000109','step','confirmed')));
reset role;
select pg_temp.nv_assert((select v->>'status'='access'from nv where label='member-mark'),'Member cannot tick');
select pg_temp.nv_assert((select v->>'status'='access'from nv where label='member-complete'),'Member cannot complete');
select pg_temp.nv_assert((select v->'visit'='null'::jsonb from nv where label='member-before'),'Member sees no completed visit yet');
select pg_temp.nv_assert((select v->>'status'='access'from nv where label='member-step'),'Member cannot record a step');
do $$begin
 perform pg_temp.nv_as('c7700000-0000-4000-8000-000000000001','c7700000-0000-4000-8000-000000000035');
 set local role authenticated;
 begin perform public.nurse_visit_list();raise exception 'TEST member list refused';exception when insufficient_privilege then null;end;
 if public.nurse_visit_record('c7700000-0000-4000-8000-000000000001')->>'status'is distinct from 'access'then raise exception 'TEST member record refused';end if;
 reset role;
end$$;
select pg_temp.nv_assert(not exists(select 1 from public.nurse_visit_marks),'Refused callers wrote nothing');

-- Ticks --------------------------------------------------------------------------------------
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000012','c7700000-0000-4000-8000-000000000032');
set local role authenticated;
insert into nv values('mark-lipid',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000201','sample:lipid-panel',true,'Two tubes',null));
insert into nv values('mark-lipid-again',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000201','sample:lipid-panel',true,'Two tubes',null));
insert into nv values('mark-lipid-changed',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000201','sample:lipid-panel',false,'Two tubes',null));
insert into nv values('mark-bp-bad',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000202','measure:bp',true,null,'{"systolic":80,"diastolic":90,"pulse":null}'));
insert into nv values('mark-bp-novalues',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000203','measure:bp',true,null,null));
insert into nv values('mark-sample-values',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000204','sample:urine-acr',true,null,'{"systolic":120,"diastolic":80,"pulse":null}'));
insert into nv values('mark-unknown-item',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000205','sample:ecg-12-lead',true,null,null));
insert into nv values('mark-bp',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000206','measure:bp',true,null,'{"systolic":132,"diastolic":84,"pulse":71}'));
insert into nv values('mark-urine',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000207','sample:urine-acr',false,'Member had no sample',null));
insert into nv values('mark-weight',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000210','measure:weight',true,null,'{"value":82.5}'));
insert into nv values('mark-waist-bad',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000211','measure:waist',true,null,'{"value":10}'));
insert into nv values('mark-check',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000212','check:bp-cuff-fit',true,'Large cuff used',null));
insert into nv values('mark-check-unknown',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000213','check:fasting-8h',true,null,null));
insert into nv values('mark-long-note',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000214','check:bp-seated-rest',true,repeat('x',1001),null));
-- Steps.
insert into nv values('step-collected-early',public.nurse_visit_step(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001','source','home-request','sourceId','c7700000-0000-4000-8000-000000000041','submissionId','c7700000-0000-4000-8000-000000000220','step','samples-at-lab')));
insert into nv values('step-confirm-future',public.nurse_visit_step(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001','source','home-request','sourceId','c7700000-0000-4000-8000-000000000042','submissionId','c7700000-0000-4000-8000-000000000221','step','confirmed')));
insert into nv values('step-start-future',public.nurse_visit_step(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001','source','home-request','sourceId','c7700000-0000-4000-8000-000000000042','submissionId','c7700000-0000-4000-8000-000000000222','step','started')));
insert into nv values('step-collected-none',public.nurse_visit_step(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001','source','home-request','sourceId','c7700000-0000-4000-8000-000000000042','submissionId','c7700000-0000-4000-8000-000000000223','step','samples-collected')));
insert into nv values('step-confirm',public.nurse_visit_step(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001','source','home-request','sourceId','c7700000-0000-4000-8000-000000000041','submissionId','c7700000-0000-4000-8000-000000000224','step','confirmed')));
insert into nv values('step-confirm-again',public.nurse_visit_step(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001','source','home-request','sourceId','c7700000-0000-4000-8000-000000000041','submissionId','c7700000-0000-4000-8000-000000000224','step','confirmed')));
insert into nv values('step-confirm-twice',public.nurse_visit_step(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001','source','home-request','sourceId','c7700000-0000-4000-8000-000000000041','submissionId','c7700000-0000-4000-8000-000000000225','step','confirmed')));
insert into nv values('step-collected',public.nurse_visit_step(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001','source','home-request','sourceId','c7700000-0000-4000-8000-000000000041','submissionId','c7700000-0000-4000-8000-000000000226','step','samples-collected')));
insert into nv values('step-at-lab',public.nurse_visit_step(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001','source','home-request','sourceId','c7700000-0000-4000-8000-000000000041','submissionId','c7700000-0000-4000-8000-000000000227','step','samples-at-lab')));
insert into nv values('step-completed-direct',public.nurse_visit_step(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001','source','home-request','sourceId','c7700000-0000-4000-8000-000000000041','submissionId','c7700000-0000-4000-8000-000000000228','step','completed')));
reset role;
select pg_temp.nv_assert((select v->>'status'='saved'from nv where label='mark-weight'),'Weight saved with its value');
select pg_temp.nv_assert((select bool_and(v->>'status'='invalid')from nv where label in('mark-waist-bad','mark-long-note')),'Out-of-range waist and a comment over 1000 characters are refused');
select pg_temp.nv_assert((select v->>'status'='saved'from nv where label='mark-check')and exists(select 1 from public.nurse_visit_marks where item='check:bp-cuff-fit'and note='Large cuff used'and checklist_version='protocol-draft-2'),'Checklist tick with a comment keeps its version');
select pg_temp.nv_assert((select v->>'status'='stale'from nv where label='mark-check-unknown'),'A checklist item whose condition does not hold is refused');
select pg_temp.nv_assert((select v->>'status'='no-samples'from nv where label='step-collected-early'),'Handed to the lab needs samples collected first');
select pg_temp.nv_assert((select v->>'status'='saved'from nv where label='step-confirm-future'),'The nurse can confirm a future visit');
select pg_temp.nv_assert((select v->>'status'='too-early'from nv where label='step-start-future'),'Arrival cannot be recorded before the visit day');
select pg_temp.nv_assert((select v->>'status'='too-early'from nv where label='step-collected-none'),'Samples cannot be collected before the visit day');
select pg_temp.nv_assert((select v->>'status'='saved'and v->>'replayed'='false'from nv where label='step-confirm')and(select v->>'replayed'='true'from nv where label='step-confirm-again'),'Step saved and replayed');
select pg_temp.nv_assert((select v->>'status'='already-recorded'from nv where label='step-confirm-twice'),'Each step is recorded once');
select pg_temp.nv_assert((select bool_and(v->>'status'='saved')from nv where label in('step-collected','step-at-lab')),'Samples collected, then handed to the lab');
select pg_temp.nv_assert((select v->>'status'='invalid'from nv where label='step-completed-direct'),'Completed is only recorded by Complete visit');
select pg_temp.nv_assert((select count(*)=4 from public.nurse_visit_events)and exists(select 1 from public.patient_clinical_case_events where detail->>'nurseVisit'='step'),'Steps are stored and in the case audit');
-- Review F4 and F5: a rescheduled visit starts a fresh timeline; a stored time without an offset is normalised.
update public.patient_test_requests set current_arrangement=jsonb_set(jsonb_set(current_arrangement,'{terms,startsAt}',
  to_jsonb(((current_arrangement#>>'{terms,startsAt}')::timestamptz+interval '1 day')at time zone 'UTC')),
  '{terms,endsAt}',to_jsonb((current_arrangement#>>'{terms,endsAt}')::timestamptz+interval '1 day'))where id='c7700000-0000-4000-8000-000000000042';
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000012','c7700000-0000-4000-8000-000000000032');
set local role authenticated;
insert into nv values('moved-detail',public.nurse_visit_detail('c7700000-0000-4000-8000-000000000001','home-request','c7700000-0000-4000-8000-000000000042'));
insert into nv values('moved-confirm',public.nurse_visit_step(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001','source','home-request','sourceId','c7700000-0000-4000-8000-000000000042','submissionId','c7700000-0000-4000-8000-000000000229','step','confirmed')));
reset role;
select pg_temp.nv_assert((select v#>'{steps}'='[]'::jsonb and v#>>'{visit,startsAt}'~'\+00:00$'from nv where label='moved-detail'),'A moved visit shows no earlier confirmation, and its time carries an offset');
select pg_temp.nv_assert((select v->>'status'='saved'from nv where label='moved-confirm'),'The nurse confirms the new time again');
select pg_temp.nv_assert((select v->>'status'='saved'and v->>'replayed'='false'from nv where label='mark-lipid'),'Nurse ticks a sample with a note');
select pg_temp.nv_assert((select v->>'status'='saved'and v->>'replayed'='true'from nv where label='mark-lipid-again'),'Same submission replays');
select pg_temp.nv_assert((select v->>'status'='stale'from nv where label='mark-lipid-changed'),'Reused submission with other content is stale');
select pg_temp.nv_assert((select bool_and(v->>'status'='invalid')from nv where label in('mark-bp-bad','mark-bp-novalues','mark-sample-values')),'BP bounds, missing values and values on a sample are refused');
select pg_temp.nv_assert((select v->>'status'='stale'from nv where label='mark-unknown-item'),'An item outside the visit is refused');
select pg_temp.nv_assert((select count(*)=5 from public.nurse_visit_marks),'Five ticks stored');
select pg_temp.nv_assert(exists(select 1 from public.patient_clinical_case_events where user_id='c7700000-0000-4000-8000-000000000001'and detail->>'nurseVisit'='mark'),'Ticks are in the case audit');
do $$begin
 begin update public.nurse_visit_marks set done=false;raise exception 'TEST marks immutable';exception when sqlstate '55000' then null;end;
end$$;

-- Astra N1-4 and N1-6: legacy ticks recover only when history proves the arrangement unchanged.
savepoint night_review;
alter table public.nurse_visit_marks disable trigger nurse_visit_marks_immutable;
update public.nurse_visit_marks set arrangement=null where source='home-request'and source_id='c7700000-0000-4000-8000-000000000041';
alter table public.nurse_visit_marks enable trigger nurse_visit_marks_immutable;
insert into public.patient_test_request_events(request_id,command_id,actor_id,revision,operation,payload,result,created_at)
 values('c7700000-0000-4000-8000-000000000041','c7700000-0000-4000-8000-000000000801','c7700000-0000-4000-8000-000000000012',1,'completed-by-visit','{}','{}',clock_timestamp());
select public._nurse_visit_marks_backfill();
set local role authenticated;
insert into nv values('legacy-visible',public.nurse_visit_detail('c7700000-0000-4000-8000-000000000001','home-request','c7700000-0000-4000-8000-000000000041'));
reset role;
select pg_temp.nv_assert((select exists(select 1 from jsonb_array_elements(v->'items')i where i->>'key'='measure:bp'and i->'mark'<>'null'::jsonb)from nv where label='legacy-visible'),'Legacy marks recover despite a later completion event');
alter table public.nurse_visit_marks disable trigger nurse_visit_marks_immutable;
update public.nurse_visit_marks set arrangement=null where source='home-request'and source_id='c7700000-0000-4000-8000-000000000041';
alter table public.nurse_visit_marks enable trigger nurse_visit_marks_immutable;
update public.patient_test_requests set current_arrangement=jsonb_set(current_arrangement,'{terms,startsAt}',to_jsonb((current_arrangement#>>'{terms,startsAt}')::timestamptz-interval '1 day'))where id='c7700000-0000-4000-8000-000000000041';
insert into public.patient_test_request_events(request_id,command_id,actor_id,revision,operation,payload,result,created_at)
 values('c7700000-0000-4000-8000-000000000041','c7700000-0000-4000-8000-000000000802','c7700000-0000-4000-8000-000000000012',2,'reschedule','{}','{}',clock_timestamp());
select public._nurse_visit_marks_backfill();
set local role authenticated;
insert into nv values('legacy-hidden',public.nurse_visit_detail('c7700000-0000-4000-8000-000000000001','home-request','c7700000-0000-4000-8000-000000000041'));
reset role;
select pg_temp.nv_assert(not exists(select 1 from public.nurse_visit_marks where arrangement is not null)
 and(select not exists(select 1 from jsonb_array_elements(v->'items')i where i->'mark'<>'null'::jsonb)from nv where label='legacy-hidden'),'Ambiguous legacy marks stay null and hidden');
-- Optional command guards use the displayed detail; old clients still save.
set local role authenticated;
insert into nv select label,public.nurse_visit_mark(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000001',
 'source','home-request','sourceId','c7700000-0000-4000-8000-000000000041','submissionId',sub,'item','check:bp-cuff-fit','done',true,'note',null,'values',null)||extra)
 from(values
 ('guard-match','c7700000-0000-4000-8000-000000000803',jsonb_build_object('startsAt',(select v#>>'{visit,startsAt}'from nv where label='legacy-hidden'),'checklistVersion','protocol-draft-2')),
 ('guard-old','c7700000-0000-4000-8000-000000000804',jsonb_build_object('startsAt',(select v#>>'{visit,startsAt}'from nv where label='detail'))),
 ('guard-legacy','c7700000-0000-4000-8000-000000000805','{}'::jsonb),
 ('guard-checklist','c7700000-0000-4000-8000-000000000806','{"checklistVersion":"old-protocol"}'::jsonb),
 ('guard-invalid','c7700000-0000-4000-8000-000000000807','{"startsAt":"bad-time"}'::jsonb),
 ('guard-invalid-zone','c7700000-0000-4000-8000-000000000808','{"startsAt":"2026-10-22 12:00 Unknown/Zone"}'::jsonb))x(label,sub,extra);
reset role;
select pg_temp.nv_assert((select bool_and(v->>'status'='saved')from nv where label in('guard-match','guard-legacy')),'Matching arrangement and old client save');
select pg_temp.nv_assert((select bool_and(v->>'status'='stale')from nv where label in('guard-old','guard-checklist')),'Old arrangement and checklist are stale');
select pg_temp.nv_assert((select bool_and(v->>'status'='invalid')from nv where label in('guard-invalid','guard-invalid-zone')),'Invalid timestamp is invalid');
rollback to night_review;

-- B1-2: ticks belong to the arranged time; moved a day earlier, r1 shows no BP and completing it carries none.
savepoint b12;
update public.patient_test_requests set current_arrangement=jsonb_set(current_arrangement,'{terms,startsAt}',to_jsonb((current_arrangement#>>'{terms,startsAt}')::timestamptz-interval '1 day'))where id='c7700000-0000-4000-8000-000000000041';
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000012','c7700000-0000-4000-8000-000000000032');
set local role authenticated;
insert into nv values('b12-detail',public.nurse_visit_detail('c7700000-0000-4000-8000-000000000001','home-request','c7700000-0000-4000-8000-000000000041'));
insert into nv values('b12-pending',pg_temp.nv_complete('c7700000-0000-4000-8000-000000000391','c7700000-0000-4000-8000-000000000392','Synthetic reason'));
insert into nv values('b12-lipid',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000393','sample:lipid-panel',false,'Synthetic collection exception',null));
insert into nv values('b12-urine',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000394','sample:urine-acr',false,'Synthetic collection exception',null));
insert into nv values('b12-complete',pg_temp.nv_complete('c7700000-0000-4000-8000-000000000391','c7700000-0000-4000-8000-000000000392','Synthetic reason'));
reset role;
select pg_temp.nv_assert((select bool_and(i->'mark'is null or i->'mark'='null'::jsonb)from nv,jsonb_array_elements(v->'items')i where label='b12-detail'),'A moved visit shows no earlier ticks');
select pg_temp.nv_assert((select v->>'status'='pending-samples'from nv where label='b12-pending'),'Moved visit cannot complete with Pending samples');
select pg_temp.nv_assert((select v->>'status'='saved'and v#>>'{summary,bpTaken}'='false'from nv where label='b12-complete')
 and not exists(select 1 from public.patient_care_visit_entries where visit_id='c7700000-0000-4000-8000-000000000392'and payload->>'kind'='observation'),'Completing a moved visit carries no earlier BP');
rollback to savepoint b12;

-- Complete -----------------------------------------------------------------------------------
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000012','c7700000-0000-4000-8000-000000000032');
set local role authenticated;
insert into nv values('complete-noreason',pg_temp.nv_complete('c7700000-0000-4000-8000-000000000301','c7700000-0000-4000-8000-000000000302',null));
insert into nv values('complete-early',pg_temp.nv_complete('c7700000-0000-4000-8000-000000000303','c7700000-0000-4000-8000-000000000304','Synthetic reason',p_id=>'c7700000-0000-4000-8000-000000000042'));
insert into nv values('complete',pg_temp.nv_complete('c7700000-0000-4000-8000-000000000301','c7700000-0000-4000-8000-000000000302','Urine sample to follow'));
insert into nv values('complete-again',pg_temp.nv_complete('c7700000-0000-4000-8000-000000000301','c7700000-0000-4000-8000-000000000302','Urine sample to follow'));
insert into nv values('complete-other',pg_temp.nv_complete('c7700000-0000-4000-8000-000000000305','c7700000-0000-4000-8000-000000000306','Urine sample to follow'));
insert into nv values('mark-after',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000208','sample:urine-acr',true,null,null));
insert into nv values('detail-after',public.nurse_visit_detail('c7700000-0000-4000-8000-000000000001','home-request','c7700000-0000-4000-8000-000000000041'));
reset role;
select pg_temp.nv_assert((select v->>'status'='reason-required'and v->'openItems' @> '["sample:urine-acr","measure:waist","check:urgent-symptoms"]'and not(v->'openItems' @> '["check:bp-cuff-fit"]')from nv where label='complete-noreason'),'Unticked items, checklist included, need a reason');
select pg_temp.nv_assert((select v->>'status'='too-early'from nv where label='complete-early'),'A future visit cannot be completed');
select pg_temp.nv_assert((select v->>'status'='saved'and(v#>>'{summary,samplesTaken}')::int=1 and(v#>>'{summary,samplesPlanned}')::int=2 and v#>>'{summary,bpTaken}'='true'from nv where label='complete'),'Completed with counts');
select pg_temp.nv_assert((select v->>'replayed'='true'from nv where label='complete-again'),'Complete replays');
select pg_temp.nv_assert((select v->>'status'='completed'from nv where label='complete-other'),'A second completion is refused');
select pg_temp.nv_assert((select v->>'status'='completed'from nv where label='mark-after'),'No ticks after completion');
select pg_temp.nv_assert((select status='completed'from public.patient_test_requests where id='c7700000-0000-4000-8000-000000000041'),'Home request completed');
select pg_temp.nv_assert((select status='confirmed'from public.patient_test_requests where id='c7700000-0000-4000-8000-000000000042'),'Future home request untouched');
select pg_temp.nv_assert(exists(select 1 from public.patient_test_request_events where request_id='c7700000-0000-4000-8000-000000000041'and operation='completed-by-visit'and payload->>'visitId'='c7700000-0000-4000-8000-000000000302'),'Request event names the visit');
select pg_temp.nv_assert(exists(select 1 from public.patient_care_visits where id='c7700000-0000-4000-8000-000000000302'and actor_id='c7700000-0000-4000-8000-000000000012'and booking_context is null),'Visit record through the existing path');
select pg_temp.nv_assert((select count(*)=1 and bool_and(systolic=132 and diastolic=84 and pulse=71)from public.patient_measurements where user_id='c7700000-0000-4000-8000-000000000001'),'BP pair projected once');
select pg_temp.nv_assert((select count(*)=5 from public.patient_care_visit_entries where visit_id='c7700000-0000-4000-8000-000000000302'),'Systolic, diastolic, pulse, weight and the reason note recorded');
select pg_temp.nv_assert(exists(select 1 from public.patient_care_visit_entries where visit_id='c7700000-0000-4000-8000-000000000302'and payload->>'field'='weight'and(payload->>'value')::numeric=82.5 and payload->>'unit'='kg'),'Weight recorded as a visit observation');
select pg_temp.nv_assert((select array_agg(step order by occurred_at,step)@>array['confirmed','samples-collected','samples-at-lab','completed']and count(*)=4 from public.nurse_visit_events where source_id='c7700000-0000-4000-8000-000000000041'),'Timeline ends with completed');
select pg_temp.nv_assert(exists(select 1 from public.patient_care_visit_entries where visit_id='c7700000-0000-4000-8000-000000000302'and payload->>'kind'='note'and payload->>'text'='Urine sample to follow'),'Reason kept as a factual note');
select pg_temp.nv_assert((select v#>>'{completion,reason}'='Urine sample to follow'and v#>>'{visit,bookingStatus}'='completed'from nv where label='detail-after'),'Nurse sees the completion');
-- Member and admin.
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000001','c7700000-0000-4000-8000-000000000035');
set local role authenticated;
insert into nv values('member-after',public.patient_member_nurse_visit());
reset role;
select pg_temp.nv_assert((select(v#>>'{visit,samplesTaken}')::int=1 and(v#>>'{visit,samplesPlanned}')::int=2 and v#>>'{visit,completedAt}'is not null
 and(select array_agg(x->>'step')from jsonb_array_elements(v#>'{visit,steps}')x)=array['confirmed','samples-collected','samples-at-lab','completed']
 and not exists(select 1 from jsonb_array_elements(v#>'{visit,steps}')x where x?'by')from nv where label='member-after'),'Member sees the steps and the visit done, no names');
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000011','c7700000-0000-4000-8000-000000000031');
set local role authenticated;
insert into nv values('doctor-record',public.nurse_visit_record('c7700000-0000-4000-8000-000000000001'));
reset role;
select pg_temp.nv_assert((select exists(select 1 from jsonb_array_elements(v#>'{visits,0,items}')i where i->>'key'='measure:bp'and(i#>>'{mark,values,systolic}')::int=132)
 and exists(select 1 from jsonb_array_elements(v#>'{visits,0,items}')i where i->>'key'='check:bp-cuff-fit'and i#>>'{mark,note}'='Large cuff used')from nv where label='doctor-record'),'Doctor sees values and comments');
select pg_temp.nv_assert(exists(select 1 from public.access_audit where surface='member_nurse_visit_record'and actor_id='c7700000-0000-4000-8000-000000000011'),'Record reads are audited');
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000014','c7700000-0000-4000-8000-000000000034');
set local role authenticated;
insert into nv values('admin',public.nurse_visit_record('c7700000-0000-4000-8000-000000000001'));
insert into nv values('admin-list',public.nurse_visit_list());
insert into nv values('admin-detail',public.nurse_visit_detail('c7700000-0000-4000-8000-000000000001','home-request','c7700000-0000-4000-8000-000000000041'));
insert into nv values('admin-mark',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000209','sample:urine-acr',true,null,null,p_id=>'c7700000-0000-4000-8000-000000000042'));
reset role;
select pg_temp.nv_assert((select jsonb_array_length(v->'visits')=2 and v#>>'{visits,0,visit,id}'='c7700000-0000-4000-8000-000000000041'and v#>>'{visits,0,completion,reason}'='Urine sample to follow'and v#>>'{visits,0,completion,nurseName}'='Synthetic nurse one'
 and exists(select 1 from jsonb_array_elements(v#>'{visits,0,items}')i where i->>'key'='sample:urine-acr'and i#>>'{mark,note}'='Member had no sample')
 and not exists(select 1 from jsonb_array_elements(v#>'{visits,0,items}')i where i#>'{mark,values}'is not null and i#>'{mark,values}'<>'null'::jsonb)
 and(select array_agg(x->>'step')from jsonb_array_elements(v#>'{visits,0,steps}')x)=array['confirmed','samples-collected','samples-at-lab','completed']
 and v#>>'{visits,0,steps,0,by}'='Synthetic nurse one'from nv where label='admin'),'Admin sees the timeline with who, comments and the reason, no measurement values');
select pg_temp.nv_assert((select v->>'role'='admin'and exists(select 1 from jsonb_array_elements(v->'visits')x where x->>'id'='c7700000-0000-4000-8000-000000000042'and x->>'nurseName'='Synthetic nurse one')from nv where label='admin-list'),'Admin bookings list shows every visit with its nurse');
select pg_temp.nv_assert((select v->>'status'='access'from nv where label='admin-detail'),'Admin cannot read clinical visit detail');
select pg_temp.nv_assert((select v->>'status'='access'from nv where label='admin-mark'),'Admin cannot tick');

-- Slot booking (m2): collections through the visit command and attended -----------------------
insert into public.booking_program_seals(id,member_id,actor_id,source_token,requirements_token,engine_version,program)
 values('c7700000-0000-4000-8000-000000000501','c7700000-0000-4000-8000-000000000002','c7700000-0000-4000-8000-000000000012','synthetic',
  public.patient_test_context('c7700000-0000-4000-8000-000000000002')->>'requirementsToken','synthetic-only',
  '{"items":[{"id":"hba1c","title":"HbA1c","method":"lab"},{"id":"ecg-12-lead","title":"ECG","method":"clinic"}]}');
insert into public.booking_manual_capacity(key,source,reference,clinic_id,starts_at,ends_at,capacity,valid_until,created_by)
 values('nv-synthetic','synthetic','nv-synthetic','c7700000-0000-4000-8000-000000000020',now()-interval '1 hour',now(),2,now()+interval '3 days','c7700000-0000-4000-8000-000000000012');
insert into public.booking_offer_snapshots(id,version,capacity_key,offer,created_by)values('c7700000-0000-4000-8000-000000000502','synthetic','nv-synthetic','{}','c7700000-0000-4000-8000-000000000012');
insert into public.booking_appointments(id,member_id,program_id,requirements_token,revision,status,current_arrangement,proposed_arrangement,current_reservation_id,proposed_reservation_id,notice_id)
 select 'c7700000-0000-4000-8000-000000000503','c7700000-0000-4000-8000-000000000002','c7700000-0000-4000-8000-000000000501',
  public.patient_test_context('c7700000-0000-4000-8000-000000000002')->>'requirementsToken',1,'confirmed',arr,arr,
  'c7700000-0000-4000-8000-000000000504','c7700000-0000-4000-8000-000000000504','c7700000-0000-4000-8000-000000000505'
 from(select jsonb_build_object('coveredTestIds',jsonb_build_array('hba1c','ecg-12-lead'),'mode','clinic','startsAt',now()-interval '1 hour','endsAt',now(),
  'location','Synthetic clinic address','clinicId','c7700000-0000-4000-8000-000000000020')arr)x;
insert into public.booking_manual_reservations(id,appointment_id,capacity_key,offer_id,offer_version,member_id,valid_until)
 values('c7700000-0000-4000-8000-000000000504','c7700000-0000-4000-8000-000000000503','nv-synthetic','c7700000-0000-4000-8000-000000000502','synthetic','c7700000-0000-4000-8000-000000000002',now()+interval '3 days');
insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,copy_revision,sender_email,clinic_email,copy_email,template_version,subject,text_content,envelope_hash,state)
 values('c7700000-0000-4000-8000-000000000505','c7700000-0000-4000-8000-000000000503',1,'c7700000-0000-4000-8000-000000000501','c7700000-0000-4000-8000-000000000504','c7700000-0000-4000-8000-000000000020',0,0,
  'synthetic@example.invalid','synthetic@example.invalid','synthetic@example.invalid','synthetic','Synthetic','Never sent',repeat('a',64),'accepted');
insert into public.booking_appointment_versions(appointment_id,revision,program_id,proposed_arrangement,notice_id,actor_id)
 select 'c7700000-0000-4000-8000-000000000503',1,'c7700000-0000-4000-8000-000000000501',current_arrangement,'c7700000-0000-4000-8000-000000000505','c7700000-0000-4000-8000-000000000012'
 from public.booking_appointments where id='c7700000-0000-4000-8000-000000000503';
set constraints all immediate;
set constraints all deferred;
select pg_temp.nv_assert(public._booking_visit_attended('c7700000-0000-4000-8000-000000000504') is not true,'Booking not attended before completion');
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000012','c7700000-0000-4000-8000-000000000032');
set local role authenticated;
insert into nv values('appt-detail',public.nurse_visit_detail('c7700000-0000-4000-8000-000000000002','appointment','c7700000-0000-4000-8000-000000000503'));
insert into nv values('appt-mark',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000601','sample:hba1c',true,null,null,'appointment','c7700000-0000-4000-8000-000000000503','c7700000-0000-4000-8000-000000000002'));
reset role;
-- Astra N1-4: appointment marks also recover against their existing version history.
savepoint night_appointment;
alter table public.nurse_visit_marks disable trigger nurse_visit_marks_immutable;
update public.nurse_visit_marks set arrangement=null where source='appointment'and source_id='c7700000-0000-4000-8000-000000000503';
alter table public.nurse_visit_marks enable trigger nurse_visit_marks_immutable;
select public._nurse_visit_marks_backfill();
set local role authenticated;
insert into nv values('appt-legacy-visible',public.nurse_visit_detail('c7700000-0000-4000-8000-000000000002','appointment','c7700000-0000-4000-8000-000000000503'));
reset role;
select pg_temp.nv_assert((select exists(select 1 from jsonb_array_elements(v->'items')i where i->>'key'='sample:hba1c'and i->'mark'<>'null'::jsonb)from nv where label='appt-legacy-visible'),'Appointment legacy mark recovers when no later version exists');
rollback to night_appointment;
-- Review F1: a stale booking context refuses completion instead of skipping the collection entries.
update public.booking_program_seals set requirements_token='synthetic-stale'where id='c7700000-0000-4000-8000-000000000501';
set local role authenticated;
insert into nv values('appt-stale',pg_temp.nv_complete('c7700000-0000-4000-8000-000000000607','c7700000-0000-4000-8000-000000000608','Blood pressure not taken','appointment','c7700000-0000-4000-8000-000000000503','c7700000-0000-4000-8000-000000000002'));
reset role;
select pg_temp.nv_assert((select v->>'status'='booking-stale'from nv where label='appt-stale')and not exists(select 1 from public.nurse_visit_completions where source_id='c7700000-0000-4000-8000-000000000503'),'A stale booking context is refused and nothing is written');
update public.booking_program_seals set requirements_token=public.patient_test_context('c7700000-0000-4000-8000-000000000002')->>'requirementsToken'where id='c7700000-0000-4000-8000-000000000501';
set local role authenticated;
insert into nv values('appt-complete',pg_temp.nv_complete('c7700000-0000-4000-8000-000000000602','c7700000-0000-4000-8000-000000000603','Blood pressure not taken','appointment','c7700000-0000-4000-8000-000000000503','c7700000-0000-4000-8000-000000000002'));
insert into nv values('appt-member-wrong',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000604','sample:hba1c',true,null,null,'appointment','c7700000-0000-4000-8000-000000000503','c7700000-0000-4000-8000-000000000001'));
reset role;
select pg_temp.nv_assert((select v#>>'{items,0,key}'='sample:hba1c'and v#>>'{items,1,key}'='measure:bp'and v#>>'{visit,clinic}'='Synthetic nurse visit clinic'
 and(select count(*)from jsonb_array_elements(v->'items')i where i->>'kind'='check')=7 from nv where label='appt-detail'),'Slot booking items: covered lab test, BP and the always and lab-sample checklist items');
select pg_temp.nv_assert((select v->>'status'='saved'from nv where label='appt-complete'),'Slot booking visit completed');
select pg_temp.nv_assert((select booking_context->>'appointmentId'='c7700000-0000-4000-8000-000000000503'from public.patient_care_visits where id='c7700000-0000-4000-8000-000000000603'),'Visit linked to the booking');
select pg_temp.nv_assert(exists(select 1 from public.patient_care_visit_entries where visit_id='c7700000-0000-4000-8000-000000000603'and payload->>'kind'='collection'and payload->>'testId'='hba1c'and payload->>'outcome'='collected'),'Sample recorded as a collection entry');
select pg_temp.nv_assert(jsonb_array_length(public._patient_lab_samples('c7700000-0000-4000-8000-000000000002',false))=1,'Member lab stages see the collected sample');
select pg_temp.nv_assert(public._booking_visit_attended('c7700000-0000-4000-8000-000000000504'),'Booking counts as attended');
select pg_temp.nv_assert(exists(select 1 from public.nurse_visit_events where source_id='c7700000-0000-4000-8000-000000000503'and step='samples-collected'),'Completion records samples collected when samples were taken');
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000012','c7700000-0000-4000-8000-000000000032');
-- Codex F1 re-check: a later "not collected" correction supersedes the only collected sample, so
-- handing to the lab is refused; a newer "collected" entry makes it current again.
reset role;
select set_config('nv.rev',(select revision::text from public.patient_clinical_cases where user_id='c7700000-0000-4000-8000-000000000002'),true),
 set_config('nv.accepted',(select booking_context->>'acceptedRevision' from public.patient_care_visits where id='c7700000-0000-4000-8000-000000000603'),true);
set local role authenticated;
insert into nv select 'corr-not',public.patient_staff_visit_command(jsonb_build_object('version','visit-evidence-v1','op','append-evidence','id','c7700000-0000-4000-8000-000000000002',
 'visitId','c7700000-0000-4000-8000-000000000603','submissionId','c7700000-0000-4000-8000-000000000609','revision',current_setting('nv.rev')::int,
 'entries',jsonb_build_array(jsonb_build_object('kind','collection','observedAt',to_char(clock_timestamp()at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'appointmentId','c7700000-0000-4000-8000-000000000503','acceptedRevision',current_setting('nv.accepted')::int,'testId','hba1c','outcome','not-collected','reason','Synthetic correction'))));
insert into nv values('appt-at-lab-superseded',public.nurse_visit_step(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000002','source','appointment','sourceId','c7700000-0000-4000-8000-000000000503','submissionId','c7700000-0000-4000-8000-000000000610','step','samples-at-lab')));
reset role;
select pg_temp.nv_assert((select v->>'status'='saved'from nv where label='corr-not')and(select v->>'status'='no-lab-entries'from nv where label='appt-at-lab-superseded')
 and not exists(select 1 from public.nurse_visit_events where source_id='c7700000-0000-4000-8000-000000000503'and step='samples-at-lab'),'A superseded sample cannot be handed to the lab');
reset role;
select set_config('nv.rev',(select revision::text from public.patient_clinical_cases where user_id='c7700000-0000-4000-8000-000000000002'),true),
 set_config('nv.accepted',(select booking_context->>'acceptedRevision' from public.patient_care_visits where id='c7700000-0000-4000-8000-000000000603'),true);
set local role authenticated;
insert into nv select 'corr-again',public.patient_staff_visit_command(jsonb_build_object('version','visit-evidence-v1','op','append-evidence','id','c7700000-0000-4000-8000-000000000002',
 'visitId','c7700000-0000-4000-8000-000000000603','submissionId','c7700000-0000-4000-8000-000000000611','revision',current_setting('nv.rev')::int,
 'entries',jsonb_build_array(jsonb_build_object('kind','collection','observedAt',to_char(clock_timestamp()at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'appointmentId','c7700000-0000-4000-8000-000000000503','acceptedRevision',current_setting('nv.accepted')::int,'testId','hba1c','outcome','collected'))));
insert into nv values('appt-at-lab',public.nurse_visit_step(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000002','source','appointment','sourceId','c7700000-0000-4000-8000-000000000503','submissionId','c7700000-0000-4000-8000-000000000605','step','samples-at-lab')));
insert into nv values('appt-confirm-after',public.nurse_visit_step(jsonb_build_object('version','nurse-visit-v1','memberId','c7700000-0000-4000-8000-000000000002','source','appointment','sourceId','c7700000-0000-4000-8000-000000000503','submissionId','c7700000-0000-4000-8000-000000000606','step','confirmed')));
reset role;
select pg_temp.nv_assert((select v->>'status'='saved'from nv where label='appt-at-lab'),'Handed to the lab after completion');
select pg_temp.nv_assert((select v->>'status'='completed'from nv where label='appt-confirm-after'),'No other steps after completion');
select pg_temp.nv_assert(exists(select 1 from public.patient_care_lab_stages s join public.patient_care_visit_entries e on e.id=s.collection_entry_id where e.visit_id='c7700000-0000-4000-8000-000000000603'and s.stage='at-lab'),'Handed to the lab records the existing at-lab stage');
select pg_temp.nv_assert((select v->>'status'='access'from nv where label='appt-member-wrong'),'A visit cannot be ticked under another member');

-- Switch off -----------------------------------------------------------------------------------
update public.nurse_visit_settings set enabled=false;
select pg_temp.nv_as('c7700000-0000-4000-8000-000000000012','c7700000-0000-4000-8000-000000000032');
set local role authenticated;
insert into nv values('off-list',public.nurse_visit_list());
insert into nv values('nav-off',to_jsonb(public.nurse_visit_navigation()));
insert into nv values('off-mark',pg_temp.nv_mark('c7700000-0000-4000-8000-000000000701','sample:urine-acr',true,null,null,p_id=>'c7700000-0000-4000-8000-000000000042'));
reset role;
select pg_temp.nv_assert((select v->>'enabled'='false'and jsonb_array_length(v->'visits')=0 from nv where label='off-list'),'Off: list empty');
select pg_temp.nv_assert((select v->>'status'='disabled'from nv where label='off-mark'),'Off: ticks refused');
select pg_temp.nv_assert((select v='true'::jsonb from nv where label='nav-on')and(select v='false'::jsonb from nv where label='nav-member')and(select v='false'::jsonb from nv where label='nav-off'),'Navigation entry: nurse while on; never for a member; hidden while off');
select pg_temp.nv_assert(not has_table_privilege('authenticated','public.nurse_visit_marks','select')and not has_table_privilege('anon','public.nurse_visit_completions','select'),'Tables are not directly readable');
rollback;
\echo 'Nurse visit flow: assigned nurse reads, ticks (measurements, checklist, comments), records steps and completes; other nurse, doctor, member refused for writes; doctor sees values and comments, admin sees timeline, comments and reason without values; member sees steps only; home request completed; slot booking attended, collections and lab stages; off refuses.'
