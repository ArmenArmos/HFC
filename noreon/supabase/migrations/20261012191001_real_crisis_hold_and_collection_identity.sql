-- A source report is one collection; a corrected extraction revision is not a new collection.
alter table public.patient_care_tests add column source_report_id uuid references public.patient_reports(id), add column source_requirement_id text;
alter table public.patient_care_tests add constraint care_test_source_identity unique(user_id,source_report_id,source_requirement_id);
-- Bind only an unambiguous existing test whose time/title/source match immutable publication evidence.
with candidates as (
 select t.id,p.user_id,receipt.value->>'reportId' report_id,requirement.value->>'id' requirement_id,
 row_number() over(partition by p.user_id,receipt.value->>'reportId',requirement.value->>'id' order by t.ordered_at,t.id) rn
 from public.patient_care_tests t join public.patient_clinical_publications p on p.user_id=t.user_id
 cross join lateral jsonb_array_elements(p.review#>'{engine,tests}') requirement
 join lateral jsonb_each(p.review->'receipts') receipt on receipt.key=requirement.value->>'id'
 where t.ordered_at=(p.review->>'preparedAt')::timestamptz and t.title=requirement.value->>'title'
 and exists(select 1 from jsonb_array_elements(p.evidence->'reports') report where report.value->>'id'=receipt.value->>'reportId' and t.source_label=coalesce(nullif(report.value#>>'{reviewed,laboratory}',''),'Source report'))
), unambiguous as (select id from candidates group by id having count(distinct (report_id,requirement_id))=1)
update public.patient_care_tests t set source_report_id=c.report_id::uuid,source_requirement_id=c.requirement_id from candidates c where c.id=t.id and c.rn=1 and c.id in(select id from unambiguous);

create or replace function public.lock_assigned_clinical_case(p_user_id uuid,p_actor uuid,p_revision bigint,p_token text) returns public.patient_clinical_cases
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;e jsonb;
begin
 perform public.lock_patient_clinical_sources(p_user_id);
 select * into c from public.patient_clinical_cases where user_id=p_user_id for update nowait;
 if not found or c.assigned_doctor_id is distinct from p_actor or not exists(select 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id where s.user_id=p_actor and s.role='doctor' and s.active and k.active) then raise insufficient_privilege using message='Assigned active doctor required';end if;
 if c.revision is distinct from p_revision then raise serialization_failure using message='Case changed. Reload and review';end if;
 e:=public.patient_clinical_evidence(p_user_id);
 if e->>'token' is distinct from p_token then raise serialization_failure using message='Evidence changed. Reload and review';end if;
 if e#>>'{data,assessment,completed_at}' is null or e#>>'{data,assessment,urgent_rule}' is not null or e#>'{data,consent}'='null'::jsonb then raise exception 'Complete questionnaire and resolve urgent guidance';end if;
 -- Existing NRN clinical THRESHOLD: >=180 systolic OR >=110 diastolic.
 -- No reading-linked native symptom triage/resolution exists: no implicit clearance.
 if exists(select 1 from public.patient_measurements where user_id=p_user_id and (systolic>=180 or diastolic>=110)) then raise exception 'Routine review is on hold: recorded crisis-range blood pressure has no linked symptom triage or resolution. Arrange clinical assessment; later normal readings do not clear this hold.';end if;
 return c;
end $$;
-- Preserve the existing owner/publication RLS boundary. Release copied source rows
-- through the actual plan created by this same publication transaction.
create or replace function public.publish_patient_clinical_plan(p_user_id uuid,p_actor uuid,p_expected_revision bigint,p_evidence_token text,p_engine jsonb,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;e jsonb;v jsonb;pub public.patient_clinical_publications;pid uuid;stamp timestamptz;label text;n bigint;test jsonb;receipt jsonb;r public.patient_reports;tid uuid;mid uuid;prior_plan uuid;row_index jsonb;source_row jsonb;
begin
 -- No auto-retry: a lock conflict rolls the entire command back for explicit reload.
 perform public.lock_patient_clinical_sources(p_user_id);
 select * into c from public.patient_clinical_cases where user_id=p_user_id for update nowait;
 if c.assigned_doctor_id is distinct from p_actor or not exists(select 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id where s.user_id=p_actor and s.role='doctor' and s.active and k.active) then raise insufficient_privilege using message='Assigned active doctor required';end if;
 select * into pub from public.patient_clinical_publications where request_id=p_request_id;
 if found then
  if pub.user_id<>p_user_id or pub.actor_id<>p_actor or pub.evidence_token<>p_evidence_token or pub.review->'engine' is distinct from p_engine then raise exception 'Publication request conflict';end if;
  return pub.plan_id;
 end if;
 c:=public.lock_assigned_clinical_case(p_user_id,p_actor,p_expected_revision,p_evidence_token);
 v:=c.review;e:=public.patient_clinical_evidence(p_user_id);
 if v is null or v->>'evidenceToken' is distinct from p_evidence_token or v->>'doctorId' is distinct from p_actor::text or v->'engine' is distinct from p_engine or coalesce(p_engine->>'urgency','') not in ('green','yellow','orange') then raise exception 'Refresh current clinical recommendations';end if;
 if c.draft_saved_by is distinct from p_actor or c.draft_evidence_token is distinct from p_evidence_token or c.draft_review_token is distinct from md5(v::text) or not public.workspace_valid_review_draft(c.draft) then raise exception 'Save a valid draft after reviewing the current evidence and gates';end if;
 if exists(select 1 from public.patient_reports src where src.user_id=p_user_id and src.deleted_at is null and (src.state<>'confirmed' or src.reviewed is null or v#>>array['approvals',src.id::text,'revision'] is distinct from src.revision::text)) then raise exception 'Approve every current imported source report';end if;
 for test in select * from jsonb_array_elements(v#>'{engine,tests}') loop
  receipt:=v#>array['receipts',test->>'id'];
  if test->>'method'<>'lab' then raise exception 'A required clinic or home-log test has no supported native receipt pathway';end if;
  if receipt is null then raise exception 'Receive every required laboratory result';end if;
  select * into r from public.patient_reports where id=(receipt->>'reportId')::uuid and user_id=p_user_id and deleted_at is null;
  if not found or r.state<>'confirmed' or r.revision::text is distinct from receipt->>'reportRevision' or v#>>array['approvals',r.id::text,'revision'] is distinct from r.revision::text then raise exception 'Required source receipt is stale';end if;
 end loop;
 if v#>>'{consultation,decision}' not in ('required','not-required') or v#>>'{consultation,decision}' is null then raise exception 'Record an explicit consultation decision';end if;
 if v#>>'{consultation,decision}'='required' and (v#>>'{consultation,completedAt}' is null or (v#>>'{consultation,completedAt}')::timestamptz>now() or v#>>'{consultation,evidenceToken}' is distinct from p_evidence_token) then raise exception 'Complete the consultation for the current evidence';end if;
 -- Never lock medication rows after plans: dose commands lock medication then plan.
 select id into prior_plan from public.patient_care_plans where user_id=p_user_id and active for update nowait;
 stamp:=now();select display_name into label from public.workspace_staff where user_id=p_actor;
 update public.patient_care_plans set active=false,retired_at=stamp where user_id=p_user_id and active;
 insert into public.patient_care_plans(user_id,clinician,published_at,instructions) values(p_user_id,label,stamp,concat_ws(E'\n\n',c.draft->>'explanation',c.draft->>'instructions',nullif(c.draft->>'followUp',''))) returning id into pid;
 if nullif(btrim(c.draft->>'medicationName'),'') is not null then
  select m.id into mid from public.patient_care_medications m join public.patient_care_plan_medications link on link.medication_id=m.id and link.plan_id=prior_plan
  where m.user_id=p_user_id and m.name=c.draft->>'medicationName' and m.dose=c.draft->>'medicationDose' and m.instructions=c.draft->>'medicationInstructions'
  and array(select distinct t from unnest(m.times) t order by t)=array(select distinct value::time from jsonb_array_elements_text(c.draft->'medicationTimes') order by value::time);
  if mid is null then
   insert into public.patient_care_medications(user_id,plan_id,name,dose,instructions,times,start_date,effective_at) values(p_user_id,pid,c.draft->>'medicationName',c.draft->>'medicationDose',c.draft->>'medicationInstructions',array(select value::time from jsonb_array_elements_text(c.draft->'medicationTimes')),timezone('Asia/Yerevan',stamp)::date,stamp) returning id into mid;
  end if;
  insert into public.patient_care_plan_medications(plan_id,medication_id,user_id) values(pid,mid,p_user_id);
 end if;
 -- Copy only doctor-received, actual source data. Non-numeric printed rows remain
 -- verbatim in the immutable publication, without a fabricated numeric conversion.
 for test in select * from jsonb_array_elements(v#>'{engine,tests}') loop
  receipt:=v#>array['receipts',test->>'id'];
  select * into r from public.patient_reports where id=(receipt->>'reportId')::uuid and user_id=p_user_id;
  select id into tid from public.patient_care_tests where user_id=p_user_id and source_report_id=r.id and source_requirement_id=test->>'id';
  if tid is null then
   insert into public.patient_care_tests(user_id,title,preparation,status,ordered_by,ordered_at,source,source_label,source_report_id,source_requirement_id)
   values(p_user_id,test->>'title',test->>'preparation','collected',label,(v->>'preparedAt')::timestamptz,'laboratory',coalesce(nullif(r.reviewed->>'laboratory',''),'Source report'),r.id,test->>'id') returning id into tid;
  end if;
  for row_index in select * from jsonb_array_elements(receipt->'rows') loop
   source_row:=r.reviewed#>array['rows',row_index::text];
   if length(source_row->>'literal')<=30 and source_row->>'literal' ~ '^-?[0-9]+([.,][0-9]+)?$' and nullif(btrim(source_row->>'unit'),'') is not null then
    insert into public.patient_care_results(user_id,test_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,explanation,reference_text,source_report_id,source_revision,source_row,publication_plan_id)
    values(p_user_id,tid,source_row->>'name',replace(source_row->>'literal',',','.')::double precision,source_row->>'unit',((r.reviewed->>'reportDate')||'T00:00:00+04:00')::timestamptz,(receipt->>'at')::timestamptz,'laboratory',coalesce(nullif(r.reviewed->>'laboratory',''),'Source report'),stamp,label,receipt->>'note',source_row->>'reference',r.id,r.revision,(row_index::text)::integer,pid) on conflict on constraint care_result_source_identity do nothing;
   end if;
  end loop;
 end loop;
 update public.patient_clinical_cases set revision=revision+1,updated_at=stamp where user_id=p_user_id returning revision into n;
 insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft,published_at) values(p_user_id,pid,p_request_id,p_actor,n,p_evidence_token,e->'data',v,c.draft,stamp);
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(p_user_id,n,'plan-published',p_actor,jsonb_build_object('planId',pid));
 -- Native enqueue only qualifies explicit current channel consent; never fabricates it.
 perform public.enqueue_patient_plan_message(pid);
 return pid;
end $$;

