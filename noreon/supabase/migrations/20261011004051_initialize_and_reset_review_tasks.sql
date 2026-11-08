create or replace function public.workspace_reset_review(p_id uuid,p_actor uuid,p_expected_revision integer,p_workflow jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision<>p_expected_revision then raise exception 'workspace case conflict'; end if;
 if not exists(select 1 from public.workspace_staff where user_id=p_actor and role='admin' and active) then raise exception 'admin required'; end if;
 if coalesce((p_workflow->>'draftSaved')::boolean,false) or p_workflow->'publication' is distinct from 'null'::jsonb then raise exception 'Invalid reset.'; end if;
 perform public.workspace_set_actor(p_actor,p_id);
 if coalesce(p_workflow->'publicationHistory','[]')<>'[]'::jsonb or coalesce(p_workflow->'medicationOrders','[]')<>'[]'::jsonb then raise exception 'Invalid historical review fields.'; end if;
 update public.workspace_cases set state=jsonb_set(jsonb_set(state,'{workflow}',p_workflow),'{care}',jsonb_build_object('stage',coalesce(state#>>'{care,stage}','profile'),'events','[]'::jsonb,'acknowledged',false)),
 revision=revision+1,reviewed_evidence_revision=null,draft_evidence_revision=null,draft_saved_by=null,draft_saved_at=null where id=p_id returning revision into p_expected_revision;
 perform public.workspace_reconcile_review_task(p_id,true,'workflow.reset');
 return p_expected_revision;
end $$;

-- Legacy publications do not prove which evidence was reviewed. Never infer a watermark.
create function public.workspace_backfill_review_tasks() returns integer
language plpgsql security definer set search_path='' as $$
declare candidate record; processed integer:=0;
begin
 for candidate in select c.id from public.workspace_cases c
 where c.expires_at>now()
 and (c.state#>>'{state,assessment,completedAt}' is not null or c.state#>>'{workflow,publication,at}' is not null)
 and (c.reviewed_evidence_revision is null or c.reviewed_evidence_revision<c.evidence_revision)
 and not exists(select 1 from public.workspace_review_tasks t where t.case_id=c.id and t.status='open')
 order by c.id for update of c loop
  perform public.workspace_reconcile_review_task(candidate.id,true,'legacy-verification');
  processed:=processed+1;
 end loop;
 return processed;
end $$;
revoke all on function public.workspace_backfill_review_tasks() from public,anon,authenticated,service_role;
select public.workspace_backfill_review_tasks();
