-- Required results can be received from a clinic lab result the doctor confirmed (QA 174, 29 Oct 2026).
--
-- Before this, a required laboratory test could be received only from a report the member imported
-- (patient_reports). A clinic's PDF goes to clinic_batch_files, is read into lab_ai_values and confirmed by
-- the doctor there, so it never reached the review: "Source report approval" said no reports, and the plan
-- could not be published ("Receive every required laboratory result").
--
-- Now the assigned doctor may receive a required laboratory test from values of one current clinic
-- attachment (not detached or moved, _lab_ai_current) that a doctor verified or corrected. AI-read values that
-- nobody checked, auto-accepted values and rejected values never count. The receipt keeps a copy of each value
-- as it was received; publication recomputes it and refuses a receipt whose values changed since (a later
-- correction, a detach), as it does for a changed report revision. Publication copies the numeric values with a
-- unit into patient_care_results under the new plan, exactly as it does for report rows, so the member sees them
-- only once the plan is published (own_published_care_results).
--
-- Each function below is its previous definition with only the named change:
--  * command_patient_clinical_review: wraps the 20261012162648 command, adds operation 'receive-clinic-result'.
--  * publish_patient_clinical_plan: 20261012191602 plus the clinic-lab receipt check and copy.
-- New: doctor_clinic_lab_receipt_sources, the doctor's list of current confirmed clinic values for the review
-- screen. Nothing here reads or writes member_reported_values (member uploads have their own approval).

-- 1. Provenance columns ------------------------------------------------------------------------------------------
alter table public.patient_care_tests add column source_lab_attachment_id uuid references public.clinic_result_attachments(id);
alter table public.patient_care_tests add constraint care_test_lab_source_identity unique(user_id,source_lab_attachment_id,source_requirement_id);
alter table public.patient_care_results add column source_lab_value_id uuid references public.lab_ai_values(id),add column source_lab_reviewed_at timestamptz,
 add constraint care_result_lab_source_pair check((source_lab_value_id is null)=(source_lab_reviewed_at is null));
alter table public.patient_care_results add constraint care_result_lab_source_identity unique(user_id,source_lab_value_id,source_lab_reviewed_at);

-- 2. The values of one attachment as a receipt holds them, or null --------------------------------------------------
-- Null unless every id is distinct, belongs to this member and attachment, was verified or corrected by a doctor,
-- has a past collection date, and the attachment is still current. Locks the rows so a review cannot change
-- them while a receipt or publication reads them.
create function public._clinic_lab_receipt_values(p_user uuid,p_attachment uuid,p_ids jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ids uuid[];n int;out jsonb;
begin
 if p_user is null or p_attachment is null or jsonb_typeof(p_ids)is distinct from 'array'or jsonb_array_length(p_ids)not between 1 and 100 then return null;end if;
 if exists(select 1 from jsonb_array_elements(p_ids)i where jsonb_typeof(i)<>'string'or i#>>'{}'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')then return null;end if;
 select array_agg(distinct (i#>>'{}')::uuid)into ids from jsonb_array_elements(p_ids)i;
 if cardinality(ids)<>jsonb_array_length(p_ids)or not public._lab_ai_current(p_attachment)then return null;end if;
 perform 1 from public.lab_ai_values v where v.id=any(ids)for share nowait;
 select count(*),jsonb_agg(jsonb_build_object('id',v.id,'seq',v.seq,'reviewedAt',v.reviewed_at,'name',v.test_name,
   'valueText',case when v.status='corrected'then v.corrected_value::text else v.value_text end,'value',coalesce(v.corrected_value,v.value),
   'unit',coalesce(v.corrected_unit,v.unit),'reference',coalesce(v.ref_text,nullif(concat_ws(' - ',v.ref_low,v.ref_high),'')),
   'collectedOn',v.collected_on,'laboratory',v.lab_name)order by v.seq)
  into n,out from public.lab_ai_values v
  where v.id=any(ids)and v.user_id=p_user and v.attachment_id=p_attachment and v.status in('verified','corrected')
   and v.reviewed_by is not null and v.reviewed_at is not null and v.collected_on is not null
   and v.collected_on<=(clock_timestamp()at time zone 'Asia/Yerevan')::date;
 if n<>cardinality(ids)then return null;end if;
 return out;
end$$;

-- 3. Receive from a clinic lab result ------------------------------------------------------------------------------
alter function public.command_patient_clinical_review(uuid,bigint,text,text,jsonb)rename to command_patient_clinical_review_before_clinic_lab;
revoke all on function public.command_patient_clinical_review_before_clinic_lab(uuid,bigint,text,text,jsonb)from public,anon,authenticated,service_role;
create function public.command_patient_clinical_review(p_user_id uuid,p_expected_revision bigint,p_evidence_token text,p_operation text,p_input jsonb)returns bigint
language plpgsql security definer set search_path=''as $$
declare c public.patient_clinical_cases;v jsonb;n bigint;test jsonb;vals jsonb;att uuid;
begin
 if p_operation is distinct from 'receive-clinic-result'then
  return public.command_patient_clinical_review_before_clinic_lab(p_user_id,p_expected_revision,p_evidence_token,p_operation,p_input);
 end if;
 c:=public.lock_assigned_clinical_case(p_user_id,auth.uid(),p_expected_revision,p_evidence_token);v:=c.review;
 if v is null or v->>'evidenceToken' is distinct from p_evidence_token or v->>'doctorId' is distinct from auth.uid()::text then raise exception 'Refresh clinical recommendations before review';end if;
 if p_input->>'sourceChecked' is distinct from 'true' then raise exception 'Check the original source document';end if;
 select t into test from jsonb_array_elements(v#>'{engine,tests}') t where t->>'id'=p_input->>'testId';
 if test is null or test->>'method'<>'lab' then raise exception 'This required test needs a supported native evidence pathway';end if;
 if nullif(btrim(p_input->>'note'),'') is null or length(p_input->>'note')>2000 then raise exception 'Select source rows and describe their relevance';end if;
 att:=case when p_input->>'attachmentId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (p_input->>'attachmentId')::uuid end;
 vals:=public._clinic_lab_receipt_values(p_user_id,att,p_input->'valueIds');
 if vals is null then raise exception 'Every selected clinic lab value must be confirmed by a doctor and current';end if;
 v:=jsonb_set(v,array['receipts',test->>'id'],jsonb_build_object('source','clinic-lab','attachmentId',att,'values',vals,'note',btrim(p_input->>'note'),'actorId',auth.uid(),'at',now()));
 update public.patient_clinical_cases set review=v,revision=revision+1,updated_at=now() where user_id=p_user_id returning revision into n;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(p_user_id,n,'result-received',auth.uid(),jsonb_build_object('evidenceToken',p_evidence_token,'source','clinic-lab'));return n;
end $$;
revoke all on function public.command_patient_clinical_review(uuid,bigint,text,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.command_patient_clinical_review(uuid,bigint,text,text,jsonb)to authenticated;

-- 4. Publication: the 20261012191602 definition plus clinic-lab receipts -------------------------------------------
create or replace function public.publish_patient_clinical_plan(p_user_id uuid,p_actor uuid,p_expected_revision bigint,p_evidence_token text,p_engine jsonb,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;e jsonb;v jsonb;pub public.patient_clinical_publications;pid uuid;stamp timestamptz;label text;n bigint;test jsonb;receipt jsonb;r public.patient_reports;tid uuid;mid uuid;prior_plan uuid;row_index jsonb;source_row jsonb;lab_row jsonb;
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
 -- Fresh request IDs cannot manufacture an identical plan version or notification.
 -- Assignment and evidence CAS above are checked before this semantic guard.
 if exists(select 1 from public.patient_clinical_publications prior join public.patient_care_plans active_plan on active_plan.id=prior.plan_id and active_plan.user_id=prior.user_id and active_plan.active
  where prior.user_id=p_user_id and prior.actor_id=p_actor and prior.evidence_token=p_evidence_token and prior.review=c.review and prior.draft=c.draft) then raise exception 'Unchanged plan already published. Review and save a changed clinical draft before publishing a new version.';end if;
 v:=c.review;e:=public.patient_clinical_evidence(p_user_id);
 if v is null or v->>'evidenceToken' is distinct from p_evidence_token or v->>'doctorId' is distinct from p_actor::text or v->'engine' is distinct from p_engine or coalesce(p_engine->>'urgency','') not in ('green','yellow','orange') then raise exception 'Refresh current clinical recommendations';end if;
 if c.draft_saved_by is distinct from p_actor or c.draft_evidence_token is distinct from p_evidence_token or c.draft_review_token is distinct from md5(v::text) or not public.workspace_valid_review_draft(c.draft) then raise exception 'Save a valid draft after reviewing the current evidence and gates';end if;
 if exists(select 1 from public.patient_reports src where src.user_id=p_user_id and src.deleted_at is null and (src.state<>'confirmed' or src.reviewed is null or v#>>array['approvals',src.id::text,'revision'] is distinct from src.revision::text)) then raise exception 'Approve every current imported source report';end if;
 for test in select * from jsonb_array_elements(v#>'{engine,tests}') loop
  receipt:=v#>array['receipts',test->>'id'];
  if test->>'method'<>'lab' then raise exception 'A required clinic or home-log test has no supported native receipt pathway';end if;
  if receipt is null then raise exception 'Receive every required laboratory result';end if;
  -- Clinic lab: the values must still be exactly what was received (no later correction, detach or move).
  if receipt->>'source'='clinic-lab' then
   if public._clinic_lab_receipt_values(p_user_id,(receipt->>'attachmentId')::uuid,(select jsonb_agg(x->'id')from jsonb_array_elements(receipt->'values')x)) is distinct from receipt->'values' then raise exception 'Required source receipt is stale';end if;
   continue;
  end if;
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
  if receipt->>'source'='clinic-lab' then
   select id into tid from public.patient_care_tests where user_id=p_user_id and source_lab_attachment_id=(receipt->>'attachmentId')::uuid and source_requirement_id=test->>'id';
   if tid is null then
    insert into public.patient_care_tests(user_id,title,preparation,status,ordered_by,ordered_at,source,source_label,source_lab_attachment_id,source_requirement_id)
    values(p_user_id,test->>'title',test->>'preparation','collected',label,(v->>'preparedAt')::timestamptz,'laboratory',
     coalesce((select nullif(x->>'laboratory','')from jsonb_array_elements(receipt->'values')x where nullif(x->>'laboratory','')is not null limit 1),'Clinic laboratory'),
     (receipt->>'attachmentId')::uuid,test->>'id') returning id into tid;
   end if;
   for lab_row in select * from jsonb_array_elements(receipt->'values') loop
    if jsonb_typeof(lab_row->'value')='number' and nullif(btrim(lab_row->>'unit'),'') is not null then
     insert into public.patient_care_results(user_id,test_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,explanation,reference_text,source_lab_value_id,source_lab_reviewed_at,publication_plan_id)
     values(p_user_id,tid,lab_row->>'name',(lab_row->>'value')::double precision,lab_row->>'unit',((lab_row->>'collectedOn')||'T00:00:00+04:00')::timestamptz,(receipt->>'at')::timestamptz,'laboratory',
      coalesce(nullif(lab_row->>'laboratory',''),'Clinic laboratory'),stamp,label,receipt->>'note',left(lab_row->>'reference',160),(lab_row->>'id')::uuid,(lab_row->>'reviewedAt')::timestamptz,pid)
     on conflict on constraint care_result_lab_source_identity do nothing;
    end if;
   end loop;
   continue;
  end if;
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

-- 5. The doctor's sources for the review screen ------------------------------------------------------------------
-- Current clinic attachments of the member with the values a doctor verified or corrected, as a receipt would hold
-- them. Assigned active doctor in an admitted session only (the same values the doctor's lab screen shows).
create function public.doctor_clinic_lab_receipt_sources(p_user_id uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 perform public._assigned_active_doctor(p_user_id);
 -- An attachment is listed only with at least one value that could be received (the same rule as
 -- _clinic_lab_receipt_values), so one undated or future-dated sheet never hides the others (Astra QA174-R1).
 return jsonb_build_object('version','clinic-lab-receipt-sources-v1','attachments',coalesce((
  select jsonb_agg(jsonb_build_object('attachmentId',a.id,'fileId',a.file_id,'fileName',f.name,'clinic',k.name,'attachedAt',a.created_at,'values',vals.values)
   order by a.created_at desc,a.id)
  from public.clinic_result_attachments a join public.clinic_batch_files f on f.id=a.file_id join public.workspace_clinics k on k.id=a.clinic_id
  cross join lateral(select jsonb_agg(jsonb_build_object('id',v.id,'seq',v.seq,'reviewedAt',v.reviewed_at,'name',v.test_name,
      'valueText',case when v.status='corrected'then v.corrected_value::text else v.value_text end,'value',coalesce(v.corrected_value,v.value),
      'unit',coalesce(v.corrected_unit,v.unit),'reference',coalesce(v.ref_text,nullif(concat_ws(' - ',v.ref_low,v.ref_high),'')),
      'collectedOn',v.collected_on,'laboratory',v.lab_name)order by v.seq)as values
     from public.lab_ai_values v where v.attachment_id=a.id and v.user_id=p_user_id and v.status in('verified','corrected')and v.reviewed_by is not null
      and v.reviewed_at is not null and v.collected_on is not null and v.collected_on<=(clock_timestamp()at time zone 'Asia/Yerevan')::date)vals
  where a.user_id=p_user_id and vals.values is not null and public._lab_ai_current(a.id)),'[]'));
end$$;

revoke all on function public._clinic_lab_receipt_values(uuid,uuid,jsonb),public.doctor_clinic_lab_receipt_sources(uuid)from public,anon,authenticated,service_role;
grant execute on function public.doctor_clinic_lab_receipt_sources(uuid)to authenticated;
