alter table public.workspace_review_tasks add column completed_by_label text;
-- Earlier missing labels remain unknown; do not reconstruct historical names.
create or replace function public.workspace_finish_review_task(p_id uuid,p_task_id uuid,p_actor uuid,p_expected_evidence_revision bigint,p_outcome text,p_note text) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases; task public.workspace_review_tasks; stamp timestamptz; note text; actor_label text;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found then raise exception 'This case is unavailable.';end if;
 actor_label:=public.workspace_review_doctor(p_id,p_actor);
 select * into task from public.workspace_review_tasks where id=p_task_id and case_id=p_id and status='open' for update;
 if not found then raise exception 'This review task is no longer open.';end if;
 if task.owner_id is distinct from p_actor then raise exception 'The review owner changed.';end if;
 if p_expected_evidence_revision is null or c.evidence_revision<>p_expected_evidence_revision or task.target_evidence_revision<>p_expected_evidence_revision then raise exception 'Evidence changed. Refresh and review it before completing this task.';end if;
 note:=nullif(btrim(p_note),'');
 if p_outcome is null or p_outcome not in ('published','no-change') or (p_outcome='no-change' and note is null) or length(note)>1500 then raise exception 'Enter a valid review outcome and note of 1–1500 characters.';end if;
 stamp:=clock_timestamp();
 update public.workspace_review_tasks set status='completed',completed_at=stamp,updated_at=stamp,completed_by=p_actor,completed_by_label=actor_label,
 completed_evidence_revision=c.evidence_revision,outcome=p_outcome,completion_note=note where id=task.id;
 perform public.workspace_set_actor(p_actor,p_id);
 update public.workspace_cases set reviewed_evidence_revision=evidence_revision,revision=revision+1 where id=p_id returning revision into c.revision;
 perform public.workspace_record_event(p_id,case when p_outcome='published' then 'review.published' else 'review.no_change' end,c.revision);
 return c.revision;
end $$;
