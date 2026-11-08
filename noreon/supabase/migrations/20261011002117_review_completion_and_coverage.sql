-- Exact coverage makes deleted and newly approved reports visible to no-change validation.
create function public.workspace_review_coverage(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'reports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'revision',r.record->'revision','approval',r.approval) order by r.id) from public.workspace_case_reports r where r.case_id=p_id),'[]'),
 'receipts',coalesce((select jsonb_agg(jsonb_build_object('requirementId',r->>'requirementId','receivedAt',r->'receivedAt') order by r->>'requirementId') from jsonb_array_elements(coalesce(c.state#>'{workflow,receiptHistory}','[]')) r where exists(select 1 from jsonb_array_elements(coalesce(c.state#>'{workflow,requirements}','[]')) q where q->>'retiredAtRevision' is null and q->>'requirementId'=r->>'requirementId')),'[]'))
 from public.workspace_cases c where c.id=p_id
$$;
revoke all on function public.workspace_review_coverage(uuid) from public,anon,authenticated,service_role;

create or replace function public.workspace_publish_review(p_id uuid,p_actor uuid,p_expected_revision integer,p_expected_evidence_revision bigint)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases; w jsonb; pub jsonb; dname text; stamp timestamptz:=clock_timestamp(); key text; n integer; care jsonb; task_id uuid;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision<>p_expected_revision then raise exception 'workspace case conflict'; end if;
 stamp:=clock_timestamp();
 dname:=public.workspace_review_doctor(p_id,p_actor);
 w:=c.state->'workflow';
 if c.state#>>'{state,consentAccepted}' is distinct from 'true' or c.state#>>'{state,assessment,completedAt}' is null or c.state#>>'{state,assessment,urgentRule}' is not null then raise exception 'Complete the questionnaire and resolve urgent guidance before publication.'; end if;
 if w->>'clinicalContext' is not null and (w->>'clinicalContext')::jsonb is distinct from public.workspace_clinical_context(c.state) then raise exception 'Review the changed questionnaire before publication.'; end if;
 if w->>'recommendationsPending'='true' or w->>'allResultsAt' is null or exists(select 1 from jsonb_array_elements(w->'tests') t where not coalesce(w->'receivedTestIds','[]') ? (t->>'id')) then raise exception 'Receive every required test result before publication.'; end if;
 if w ? 'requirements' and exists(select 1 from jsonb_array_elements(w->'tests') t where not exists(
  select 1 from jsonb_array_elements(w->'requirements') q join jsonb_array_elements(coalesce(w->'receiptHistory','[]')) r on r->>'requirementId'=q->>'requirementId'
  where q->>'retiredAtRevision' is null and q#>>'{test,id}'=t->>'id' and q#>>'{test,method}'=t->>'method')) then raise exception 'Receive every current required test result before publication.'; end if;
 if w->>'consultation' not in ('required','not-required') or w->>'consultation' is null then raise exception 'Record whether a consultation is needed.'; end if;
 if w->>'consultation'='required' and (w#>>'{appointment,status}' is distinct from 'completed' or w#>>'{appointment,completedForContext}' is distinct from w->>'clinicalContext' or w->>'clinicalContext' is null or w#>>'{appointment,at}' is null or (w#>>'{appointment,at}')::timestamptz>stamp) then raise exception 'Complete the required consultation after its scheduled time.'; end if;
 if w->>'draftSaved' is distinct from 'true' or not public.workspace_valid_review_draft(w->'draft') or c.draft_saved_by is null then raise exception 'Save a valid review draft before publication.'; end if;
 if p_expected_evidence_revision is null or c.evidence_revision<>p_expected_evidence_revision or c.draft_evidence_revision is distinct from c.evidence_revision then raise exception 'Review the changed evidence and save the draft again.'; end if;
 perform 1 from public.workspace_case_reports where case_id=p_id order by id for update;
 if exists(select 1 from public.workspace_case_reports r where r.case_id=p_id and (r.approval is null or r.approval->>'revision' is distinct from r.record->>'revision')) then raise exception 'Check and approve every imported report before publication.'; end if;
 n:=coalesce((w->>'revision')::integer,0)+1;
 pub:=jsonb_build_object('workflowRevision',n,'at',stamp,'doctor',dname,'version',coalesce((w#>>'{publication,version}')::integer,0)+1,'resultTestIds',w->'receivedTestIds','resultReceipts',coalesce((select jsonb_agg(r) from jsonb_array_elements(coalesce(w->'receiptHistory','[]')) r where exists(select 1 from jsonb_array_elements(coalesce(w->'requirements','[]')) q where q->>'retiredAtRevision' is null and q->>'requirementId'=r->>'requirementId')),'[]'::jsonb),'draft',w->'draft');
 pub:=pub||jsonb_build_object('evidenceRevision',c.evidence_revision,'reviewCoverage',public.workspace_review_coverage(p_id));
 task_id:=public.workspace_reconcile_review_task(p_id,true,'publication');
 key:=(w->>'startedAt')||':'||n;
 perform public.workspace_set_actor(p_actor,p_id);
 update public.workspace_case_reports set published=jsonb_build_object('key',key,'approval',approval),updated_at=stamp where case_id=p_id;
 care:=public.workspace_care_continuity(c.state->'care',w->'publication');
 w:=public.workspace_publication_continuity(w,pub);
 w:=w||jsonb_build_object('revision',n,'events',jsonb_build_array(jsonb_build_object('at',stamp,'text','Fictional workflow: publish'))||coalesce(w->'events','[]'));
 update public.workspace_cases set state=jsonb_set(jsonb_set(state,'{workflow}',w),'{care}',care),revision=revision+1 where id=p_id returning revision into p_expected_revision;
 return public.workspace_finish_review_task(p_id,task_id,p_actor,p_expected_evidence_revision,'published',null);
end $$;

create function public.workspace_complete_review_no_change(p_id uuid,p_actor uuid,p_expected_revision integer,p_task_id uuid,p_expected_evidence_revision bigint,p_note text)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases; w jsonb; stamp timestamptz;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision<>p_expected_revision then raise exception 'workspace case conflict';end if;
 perform public.workspace_review_doctor(p_id,p_actor);
 stamp:=clock_timestamp();w:=c.state->'workflow';
 if c.state#>>'{state,consentAccepted}' is distinct from 'true' or c.state#>>'{state,assessment,completedAt}' is null or c.state#>>'{state,assessment,urgentRule}' is not null then raise exception 'Complete the questionnaire and resolve urgent guidance before publication.'; end if;
 if w->>'clinicalContext' is not null and (w->>'clinicalContext')::jsonb is distinct from public.workspace_clinical_context(c.state) then raise exception 'Review the changed questionnaire before publication.'; end if;
 if w->>'recommendationsPending'='true' or w->>'allResultsAt' is null or exists(select 1 from jsonb_array_elements(w->'tests') t where not coalesce(w->'receivedTestIds','[]') ? (t->>'id')) then raise exception 'Receive every required test result before publication.'; end if;
 if w ? 'requirements' and exists(select 1 from jsonb_array_elements(w->'tests') t where not exists(
  select 1 from jsonb_array_elements(w->'requirements') q join jsonb_array_elements(coalesce(w->'receiptHistory','[]')) r on r->>'requirementId'=q->>'requirementId'
  where q->>'retiredAtRevision' is null and q#>>'{test,id}'=t->>'id' and q#>>'{test,method}'=t->>'method')) then raise exception 'Receive every current required test result before publication.'; end if;
 if w->>'consultation' not in ('required','not-required') or w->>'consultation' is null then raise exception 'Record whether a consultation is needed.'; end if;
 if w->>'consultation'='required' and (w#>>'{appointment,status}' is distinct from 'completed' or w#>>'{appointment,completedForContext}' is distinct from w->>'clinicalContext' or w->>'clinicalContext' is null or w#>>'{appointment,at}' is null or (w#>>'{appointment,at}')::timestamptz>stamp) then raise exception 'Complete the required consultation after its scheduled time.'; end if;
 if w->>'draftSaved' is distinct from 'true' or not public.workspace_valid_review_draft(w->'draft') or c.draft_saved_by is null then raise exception 'Save a valid review draft before publication.'; end if;
 if p_expected_evidence_revision is null or c.evidence_revision<>p_expected_evidence_revision or c.draft_evidence_revision is distinct from c.evidence_revision then raise exception 'Review the changed evidence and save the draft again.'; end if;
 perform 1 from public.workspace_case_reports where case_id=p_id order by id for update;
 if exists(select 1 from public.workspace_case_reports r where r.case_id=p_id and (r.approval is null or r.approval->>'revision' is distinct from r.record->>'revision')) then raise exception 'Check and approve every imported report before publication.'; end if;

 if w->'publication' is null or w->'publication'='null'::jsonb then raise exception 'Publish the initial care plan before recording no change.';end if;
 if w->'draft' is distinct from w#>'{publication,draft}' then raise exception 'Publish the changed treatment draft.';end if;
 if w#>'{publication,reviewCoverage}' is null or w#>'{publication,reviewCoverage}' is distinct from public.workspace_review_coverage(p_id) then raise exception 'Publish the changed results before completing this review.';end if;
 if exists(select 1 from public.workspace_case_reports r where r.case_id=p_id and
 (r.published->>'key' is distinct from (w->>'startedAt')||':'||(w#>>'{publication,workflowRevision}') or r.published->'approval' is distinct from r.approval)) then raise exception 'Publish approved results before completing this review.';end if;
 return public.workspace_finish_review_task(p_id,p_task_id,p_actor,p_expected_evidence_revision,'no-change',p_note);
end $$;
revoke all on function public.workspace_complete_review_no_change(uuid,uuid,integer,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.workspace_complete_review_no_change(uuid,uuid,integer,uuid,bigint,text) to service_role;

create or replace function public.workspace_case_snapshot(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('case',to_jsonb(c),
 'reports',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from public.workspace_case_reports r where r.case_id=c.id),'[]'),
 'changes',coalesce((select jsonb_agg(to_jsonb(e) order by e.revision,e.id) from public.workspace_evidence_changes e where e.case_id=c.id and e.revision>coalesce(c.draft_evidence_revision,-1)),'[]'),
 'reviewChanges',coalesce((select jsonb_agg(to_jsonb(e) order by e.revision,e.id) from public.workspace_evidence_changes e where e.case_id=c.id and e.revision>coalesce(c.reviewed_evidence_revision,-1)),'[]'),
 'reviewTasks',coalesce((select jsonb_agg(to_jsonb(t) order by t.opened_at desc,t.id) from public.workspace_review_tasks t where t.case_id=c.id),'[]'))
 from public.workspace_cases c where c.id=p_id and c.expires_at>now()
$$;
