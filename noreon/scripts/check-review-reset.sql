-- Review reset reopens the case's review task and clears the reviewed watermark (kept from the
-- retired check-review-backfill.sql when the one-off backfill was dropped, WP-22b).
begin;
do $$
declare reviewed uuid:=gen_random_uuid();a uuid:=gen_random_uuid();w jsonb;rev integer;
begin
 insert into auth.users(id) values(a);
 insert into public.workspace_staff(user_id,role,display_name) values(a,'admin','Fictional review admin');
 perform public.workspace_create_case(reviewed,jsonb_build_object('userId',reviewed,'expiresAt',extract(epoch from now()+interval '1 day')*1000,'state',jsonb_build_object('consentAccepted',true,'assessment',jsonb_build_object('completedAt',now(),'urgentRule',null))));
 update public.workspace_cases set reviewed_evidence_revision=evidence_revision where id=reviewed;
 w:=jsonb_build_object('revision',0,'startedAt',now(),'tests','[]'::jsonb,'bookings','[]'::jsonb,'receivedTestIds','[]'::jsonb,'allResultsAt',null,'consultation','undecided','draft','{}'::jsonb,'draftSaved',false,'publication',null);
 select revision into rev from public.workspace_cases where id=reviewed;
 rev:=public.workspace_reset_review(reviewed,a,rev,w);
 if not exists(select 1 from public.workspace_review_tasks where case_id=reviewed and status='open' and reason='workflow.reset') then raise exception 'TEST: reset did not reopen review';end if;
 if not exists(select 1 from public.workspace_cases where id=reviewed and reviewed_evidence_revision is null) then raise exception 'TEST: reset retained reviewed watermark';end if;
end $$;
rollback;
