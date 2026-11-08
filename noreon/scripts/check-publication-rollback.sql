begin;
create temporary table publication_mutations(id text);
create function pg_temp.fail_second_publication() returns trigger language plpgsql as $$
begin
 if new.record->>'rollback_fixture'='yes' and new.published is distinct from old.published then
  insert into publication_mutations values(new.id);
  if (select count(*) from publication_mutations)=2 then raise exception 'forced second report failure'; end if;
 end if;
 return new;
end $$;
create trigger publication_rollback_fixture before update on public.workspace_case_reports for each row execute function pg_temp.fail_second_publication();
do $$
declare c uuid:=gen_random_uuid();d uuid:=gen_random_uuid();cl uuid:=gen_random_uuid();r text; rev integer;ev bigint;w jsonb;s jsonb;rec jsonb;draft jsonb;i integer;
begin
 insert into auth.users(id) values(d);
 insert into public.workspace_clinics(id,name) values(cl,'Fictional rollback clinic');
 insert into public.workspace_staff(user_id,role,display_name,clinic_id) values(d,'doctor','Fictional',cl);
 draft:='{"explanation":"Reviewed","instructions":"Reviewed instructions","followUp":"","medicationName":"","medicationDose":"","medicationInstructions":"","medicationTimes":[]}';
 w:=jsonb_build_object('revision',0,'startedAt',now(),'tests','[]'::jsonb,'receivedTestIds','[]'::jsonb,'allResultsAt',now(),'consultation','not-required','draft',draft,'draftSaved',false,'publication',null);
 s:=jsonb_build_object('userId',c,'expiresAt',extract(epoch from now()+interval '1 day')*1000,'state',jsonb_build_object('consentAccepted',true,'assessment',jsonb_build_object('completedAt',now(),'urgentRule',null)));
 perform public.workspace_create_case(c,s,d);rev:=public.workspace_initialize_workflow(c,0,w);
 for i in 1..2 loop
  r:=gen_random_uuid()::text;rec:=jsonb_build_object('id',r,'user_id',c,'revision',0,'state','confirmed','reviewed','{}'::jsonb,'rollback_fixture','yes');
  perform public.workspace_write_report(c,r,'insert',null,rec);
 select record into rec from public.workspace_case_reports where case_id=c and id=r;
  perform public.workspace_write_report(c,r,'approve',0,null,jsonb_build_object('revision',0,'report',rec),d);
 end loop;
 select evidence_revision into ev from public.workspace_cases where id=c;
 rev:=public.workspace_save_review_draft(c,d,rev,ev,draft);
 begin
  perform public.workspace_publish_review(c,d,rev,ev);raise exception 'TEST: forced failure did not happen';
 exception when others then if sqlerrm<>'forced second report failure' then raise;end if;end;
 if (select count(*) from public.workspace_case_reports where case_id=c and published is null)<>2 then raise exception 'TEST: partial report snapshot survived';end if;
 if not exists(select 1 from public.workspace_cases where id=c and revision=rev and evidence_revision=ev and state#>'{workflow,publication}'='null'::jsonb) then raise exception 'TEST: failed publication changed case';end if;
 if exists(select 1 from public.workspace_activity where case_id=c and kind='plan.published') then raise exception 'TEST: failed publication emitted activity';end if;
 drop trigger publication_rollback_fixture on public.workspace_case_reports;
 perform public.workspace_publish_review(c,d,rev,ev);
 if (select count(*) from public.workspace_case_reports where case_id=c and published is not null)<>2 then raise exception 'TEST: retry did not publish both reports';end if;
end $$;
rollback;
