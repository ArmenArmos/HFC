-- Routine readings and identity edits advance an existing review, without
-- creating recurring clinical work. Follow-up scheduling owns routine reviews.
create function public.workspace_dispatch_case_review() returns trigger
language plpgsql security definer set search_path='' as $$
declare a jsonb;b jsonb;k text;opens boolean:=false;eligible boolean;reason text:='evidence';
begin
 if old.state is not distinct from new.state or old.evidence_revision=new.evidence_revision then return new;end if;
 a:=public.workspace_evidence_projection(old.state);b:=public.workspace_evidence_projection(new.state);
 for k in select jsonb_object_keys(b) order by 1 loop
  if a->k is distinct from b->k and k not in ('measurements','profile') then
   opens:=true;reason:='evidence.'||k;
  end if;
 end loop;
 -- Keep previously published cases visible even while reassessment is incomplete.
 eligible:=new.state#>>'{state,assessment,completedAt}' is not null
  or new.state#>>'{workflow,publication,at}' is not null;
 perform public.workspace_reconcile_review_task(new.id,opens and eligible,reason);
 return new;
end $$;
revoke all on function public.workspace_dispatch_case_review() from public,anon,authenticated,service_role;
create trigger workspace_review_task_after after update of state on public.workspace_cases
 for each row execute function public.workspace_dispatch_case_review();
