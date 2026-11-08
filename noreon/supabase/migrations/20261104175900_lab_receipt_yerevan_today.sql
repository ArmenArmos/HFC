create or replace function public.command_patient_clinical_review_before_clinic_lab(p_user_id uuid,p_expected_revision bigint,p_evidence_token text,p_operation text,p_input jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;r public.patient_reports;v jsonb;n bigint;test jsonb;indices jsonb;stamp timestamptz;kind text;
begin
 c:=public.lock_assigned_clinical_case(p_user_id,auth.uid(),p_expected_revision,p_evidence_token);v:=c.review;
 if v is null or v->>'evidenceToken' is distinct from p_evidence_token or v->>'doctorId' is distinct from auth.uid()::text then raise exception 'Refresh clinical recommendations before review';end if;
 if p_operation in ('approve-report','receive-result') then
  select * into r from public.patient_reports where id=(p_input->>'reportId')::uuid and user_id=p_user_id and deleted_at is null;
  if not found or r.state<>'confirmed' or r.confirmed_at is null or r.reviewed is null or r.revision is distinct from (p_input->>'reportRevision')::integer then raise exception 'Confirm and review the current source report';end if;
  if p_input->>'sourceChecked' is distinct from 'true' then raise exception 'Check the original source document';end if;
  if p_operation='approve-report' then
   v:=jsonb_set(v,array['approvals',r.id::text],jsonb_build_object('revision',r.revision,'actorId',auth.uid(),'at',now()));kind:='report-approved';
  else
   select t into test from jsonb_array_elements(v#>'{engine,tests}') t where t->>'id'=p_input->>'testId';
   if test is null or test->>'method'<>'lab' then raise exception 'This required test needs a supported native evidence pathway';end if;
   if v#>>array['approvals',r.id::text,'revision'] is distinct from r.revision::text then raise exception 'Approve this source revision first';end if;
   indices:=p_input->'rows';
   if jsonb_typeof(indices) is distinct from 'array' or jsonb_array_length(indices) not between 1 and 100 or nullif(btrim(p_input->>'note'),'') is null or length(p_input->>'note')>2000 then raise exception 'Select source rows and describe their relevance';end if;
   if r.reviewed->>'reportDate' is null or (r.reviewed->>'reportDate')::date>(clock_timestamp() at time zone 'Asia/Yerevan')::date then raise exception 'A valid past collection date is required';end if;
   if exists(select 1 from jsonb_array_elements(indices) i where jsonb_typeof(i)<>'number' or i::text !~ '^[0-9]+$' or (i::text)::int>=jsonb_array_length(r.reviewed->'rows') or r.reviewed#>>array['rows',i::text,'uncertain'] is distinct from 'false' or nullif(btrim(r.reviewed#>>array['rows',i::text,'literal']),'') is null) then raise exception 'Every selected source row must be readable and confirmed';end if;
   v:=jsonb_set(v,array['receipts',test->>'id'],jsonb_build_object('reportId',r.id,'reportRevision',r.revision,'rows',indices,'note',btrim(p_input->>'note'),'actorId',auth.uid(),'at',now()));kind:='result-received';
  end if;
 elsif p_operation='consultation-decision' then
  if coalesce(p_input->>'decision','') not in ('required','not-required') or nullif(btrim(p_input->>'note'),'') is null or length(p_input->>'note')>2000 then raise exception 'Record an explicit consultation decision and reason';end if;
  v:=jsonb_set(v,'{consultation}',jsonb_build_object('decision',p_input->>'decision','note',btrim(p_input->>'note'),'actorId',auth.uid(),'at',now()));kind:='consultation-decided';
 elsif p_operation='complete-consultation' then
  stamp:=(p_input->>'completedAt')::timestamptz;
  if v#>>'{consultation,decision}' is distinct from 'required' or stamp is null or stamp>now() or stamp<(v->>'preparedAt')::timestamptz or nullif(btrim(p_input->>'note'),'') is null or length(p_input->>'note')>2000 or coalesce(p_input->>'mode','') not in ('phone','video','in-person') then raise exception 'Record the actual completed consultation and time';end if;
  v:=jsonb_set(v,'{consultation}',v->'consultation'||jsonb_build_object('completedAt',stamp,'completedBy',auth.uid(),'completionNote',btrim(p_input->>'note'),'mode',p_input->>'mode','evidenceToken',p_evidence_token));kind:='consultation-completed';
 else raise exception 'Unsupported clinical command';end if;
 update public.patient_clinical_cases set review=v,revision=revision+1,updated_at=now() where user_id=p_user_id returning revision into n;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(p_user_id,n,kind,auth.uid(),jsonb_build_object('evidenceToken',p_evidence_token));return n;
end $$;
