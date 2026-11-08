-- Report dispatch is independent of the pending routine-measurement opening policy.
create or replace function public.workspace_bump_report_evidence() returns trigger
language plpgsql security definer set search_path='' as $$
declare c uuid; r bigint; rid text;
begin
 if tg_op='UPDATE' then
  if new.case_id<>old.case_id or new.id<>old.id then raise exception 'report identity immutable'; end if;
  if new.record is not distinct from old.record and new.approval is not distinct from old.approval then return new; end if;
 end if;
 c:=case when tg_op='DELETE' then old.case_id else new.case_id end;
 rid:=case when tg_op='DELETE' then old.id else new.id end;
 update public.workspace_cases set evidence_revision=evidence_revision+1 where id=c returning evidence_revision into r;
 if not found then
  if tg_op='DELETE' then return old; else return new; end if;
 end if;
 insert into public.workspace_evidence_changes(case_id,revision,kind,reference_id)
 values(c,r,'report.'||lower(tg_op),rid);
 perform public.workspace_reconcile_review_task(c,(select state#>>'{state,assessment,completedAt}' is not null or state#>>'{workflow,publication,at}' is not null from public.workspace_cases where id=c),'report.'||lower(tg_op));
 if tg_op='DELETE' then return old; else return new; end if;
end $$;

-- Match the server action whitespace validation for direct privileged RPC calls.
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
 note:=nullif(public.workspace_js_trim(p_note),'');
 if p_outcome is null or p_outcome not in ('published','no-change') or (p_outcome='no-change' and note is null) or length(note)>1500 then raise exception 'Enter a valid review outcome and note of 1–1500 characters.';end if;
 stamp:=clock_timestamp();
 update public.workspace_review_tasks set status='completed',completed_at=stamp,updated_at=stamp,completed_by=p_actor,completed_by_label=actor_label,
 completed_evidence_revision=c.evidence_revision,outcome=p_outcome,completion_note=note where id=task.id;
 perform public.workspace_set_actor(p_actor,p_id);
 update public.workspace_cases set reviewed_evidence_revision=evidence_revision,revision=revision+1 where id=p_id returning revision into c.revision;
 perform public.workspace_record_event(p_id,case when p_outcome='published' then 'review.published' else 'review.no_change' end,c.revision);
 return c.revision;
end $$;

-- Assignment changes update ownership without deciding whether evidence opens work.
create function public.workspace_sync_review_owner() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.assigned_doctor_id is distinct from old.assigned_doctor_id then
  perform public.workspace_reconcile_review_task(new.id,false,'assignment');
 end if;
 return new;
end $$;
revoke all on function public.workspace_sync_review_owner() from public,anon,authenticated,service_role;
create trigger workspace_review_owner_after after update of assigned_doctor_id on public.workspace_cases
 for each row execute function public.workspace_sync_review_owner();
