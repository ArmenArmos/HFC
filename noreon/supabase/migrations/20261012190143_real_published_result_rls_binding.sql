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
  insert into public.patient_care_tests(user_id,title,preparation,status,ordered_by,ordered_at,source,source_label)
  values(p_user_id,test->>'title',test->>'preparation','collected',label,(v->>'preparedAt')::timestamptz,'laboratory',coalesce(nullif(r.reviewed->>'laboratory',''),'Source report')) returning id into tid;
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

-- Repair only provenance-backed rows already included in an immutable publication.
-- The exact source receipt, report revision, row, owner and original review timestamp
-- must agree. Withheld/unpublished rows and older rows without provenance stay withheld.
with matched as (
 select result.id,(
  select publication.plan_id
  from public.patient_clinical_publications publication
  join public.patient_care_plans plan on plan.id=publication.plan_id and plan.user_id=publication.user_id
  cross join lateral jsonb_each(publication.review->'receipts') receipt
  cross join lateral jsonb_array_elements(publication.evidence->'reports') report
  where publication.user_id=result.user_id
    and publication.published_at=result.reviewed_at
    and plan.clinician=result.reviewed_by
    and receipt.value->>'reportId'=result.source_report_id::text
    and receipt.value->>'reportRevision'=result.source_revision::text
    and receipt.value->'rows' @> jsonb_build_array(result.source_row)
    and report.value->>'id'=result.source_report_id::text
    and report.value->>'revision'=result.source_revision::text
    and report.value#>>array['reviewed','rows',result.source_row::text,'name']=result.marker
    and report.value#>>array['reviewed','rows',result.source_row::text,'unit']=result.unit
    and case when length(report.value#>>array['reviewed','rows',result.source_row::text,'literal'])<=30 and report.value#>>array['reviewed','rows',result.source_row::text,'literal'] ~ '^-?[0-9]+([.,][0-9]+)?$'
      then replace(report.value#>>array['reviewed','rows',result.source_row::text,'literal'],',','.')::double precision=result.value else false end
  order by publication.published_at,publication.id limit 1
 ) plan_id
 from public.patient_care_results result
 where result.publication_plan_id is null and result.source_report_id is not null
   and result.source_revision is not null and result.source_row is not null
)
update public.patient_care_results result set publication_plan_id=matched.plan_id
from matched where result.id=matched.id and matched.plan_id is not null and result.publication_plan_id is null;
