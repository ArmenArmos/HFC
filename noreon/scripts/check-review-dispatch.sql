begin;
do $$
declare c uuid:=gen_random_uuid();t uuid;r bigint;
begin
 perform public.workspace_create_case(c,jsonb_build_object('userId',c,'expiresAt',extract(epoch from now()+interval '1 day')*1000,'state',jsonb_build_object('consentAccepted',true,'assessment',jsonb_build_object('completedAt',null))));
 update public.workspace_cases set state=jsonb_set(state,'{measurements}','[{"systolic":120}]') where id=c;
 if exists(select 1 from public.workspace_review_tasks where case_id=c) then raise exception 'TEST: routine measurement opened review';end if;
 update public.workspace_cases set state=jsonb_set(state,'{state,assessment,completedAt}',to_jsonb(now())) where id=c;
 select id into t from public.workspace_review_tasks where case_id=c and status='open';
 if t is null then raise exception 'TEST: completed questionnaire did not open review';end if;
 update public.workspace_cases set state=jsonb_set(state,'{measurements}','[{"systolic":120},{"systolic":121}]') where id=c;
 select evidence_revision into r from public.workspace_cases where id=c;
 if not exists(select 1 from public.workspace_review_tasks where id=t and target_evidence_revision=r) then raise exception 'TEST: measurement did not advance open review';end if;
 -- Simulate a completed task to isolate dispatch from clinical completion prerequisites.
 update public.workspace_review_tasks set status='completed',completed_at=now(),completed_by=gen_random_uuid(),completed_evidence_revision=r,outcome='published' where id=t;
 update public.workspace_cases set state=jsonb_set(state,'{measurements}','[{"systolic":122}]') where id=c;
 update public.workspace_cases set state=jsonb_set(state,'{state,profile}','{"name":"Changed fictional name"}') where id=c;
 if exists(select 1 from public.workspace_review_tasks where case_id=c and status='open') then raise exception 'TEST: routine evidence reopened completed review';end if;
 update public.workspace_cases set state=jsonb_set(state,'{state,profile,biologicalSex}','"female"') where id=c;
 if not exists(select 1 from public.workspace_review_tasks where case_id=c and status='open' and id<>t) then raise exception 'TEST: clinical profile change did not reopen review';end if;
 if (select count(*) from public.workspace_review_tasks where case_id=c)<>2 then raise exception 'TEST: history lost or duplicate tasks';end if;
end $$;
rollback;
