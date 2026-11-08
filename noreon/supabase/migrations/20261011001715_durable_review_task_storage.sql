-- Policy-independent storage. Opening policy and public commands are wired separately.
alter table public.workspace_cases add column reviewed_evidence_revision bigint;
create table public.workspace_review_tasks (
 id uuid primary key default gen_random_uuid(),
 case_id uuid not null references public.workspace_cases(id) on delete cascade,
 status text not null default 'open' check(status in ('open','completed')),
 opened_evidence_revision bigint not null check(opened_evidence_revision>=0),
 target_evidence_revision bigint not null check(target_evidence_revision>=opened_evidence_revision),
 owner_id uuid,
 opened_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 reason text not null,
 completed_at timestamptz,
 completed_by uuid,
 completed_evidence_revision bigint,
 outcome text check(outcome in ('published','no-change')),
 completion_note text,
 check ((status='open' and completed_at is null and completed_by is null and completed_evidence_revision is null and outcome is null and completion_note is null)
 or (status='completed' and completed_at is not null and completed_by is not null and completed_evidence_revision is not null and completed_evidence_revision=target_evidence_revision and outcome is not null)),
 check(completion_note is null or length(completion_note)<=1500),
 check(outcome is distinct from 'no-change' or (completion_note is not null and length(btrim(completion_note))>0))
);
create unique index workspace_review_one_open on public.workspace_review_tasks(case_id) where status='open';
create index workspace_review_history on public.workspace_review_tasks(case_id,opened_at desc);
alter table public.workspace_review_tasks enable row level security;
revoke all on public.workspace_review_tasks from public,anon,authenticated,service_role;
grant select on public.workspace_review_tasks to service_role;

create function public.workspace_reconcile_review_task(p_id uuid,p_opens boolean,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases; task public.workspace_review_tasks; stamp timestamptz;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found then return null;end if;
 stamp:=clock_timestamp();
 select * into task from public.workspace_review_tasks where case_id=p_id and status='open' for update;
 if found then
  update public.workspace_review_tasks set target_evidence_revision=c.evidence_revision,owner_id=c.assigned_doctor_id,updated_at=stamp where id=task.id;
  return task.id;
 end if;
 if p_opens is distinct from true then return null;end if;
 insert into public.workspace_review_tasks(case_id,opened_evidence_revision,target_evidence_revision,owner_id,opened_at,updated_at,reason)
 values(p_id,c.evidence_revision,c.evidence_revision,c.assigned_doctor_id,stamp,stamp,p_reason) returning id into task.id;
 return task.id;
end $$;

-- Internal only: callers enforce publication/no-change prerequisites before this transition.
create function public.workspace_finish_review_task(p_id uuid,p_task_id uuid,p_actor uuid,p_expected_evidence_revision bigint,p_outcome text,p_note text) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases; task public.workspace_review_tasks; stamp timestamptz; note text;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found then raise exception 'This case is unavailable.';end if;
 perform public.workspace_review_doctor(p_id,p_actor);
 select * into task from public.workspace_review_tasks where id=p_task_id and case_id=p_id and status='open' for update;
 if not found then raise exception 'This review task is no longer open.';end if;
 if task.owner_id is distinct from p_actor then raise exception 'The review owner changed.';end if;
 if p_expected_evidence_revision is null or c.evidence_revision<>p_expected_evidence_revision or task.target_evidence_revision<>p_expected_evidence_revision then raise exception 'Evidence changed. Refresh and review it before completing this task.';end if;
 note:=nullif(btrim(p_note),'');
 if p_outcome is null or p_outcome not in ('published','no-change') or (p_outcome='no-change' and note is null) or length(note)>1500 then raise exception 'Enter a valid review outcome and note of 1–1500 characters.';end if;
 stamp:=clock_timestamp();
 update public.workspace_review_tasks set status='completed',completed_at=stamp,updated_at=stamp,completed_by=p_actor,
 completed_evidence_revision=c.evidence_revision,outcome=p_outcome,completion_note=note where id=task.id;
 perform public.workspace_set_actor(p_actor,p_id);
 update public.workspace_cases set reviewed_evidence_revision=evidence_revision,revision=revision+1 where id=p_id returning revision into c.revision;
 perform public.workspace_record_event(p_id,case when p_outcome='published' then 'review.published' else 'review.no_change' end,c.revision);
 return c.revision;
end $$;
revoke all on function public.workspace_reconcile_review_task(uuid,boolean,text),public.workspace_finish_review_task(uuid,uuid,uuid,bigint,text,text) from public,anon,authenticated,service_role;
