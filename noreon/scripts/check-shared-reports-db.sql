begin;
do $$
declare c uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); cl uuid:=gen_random_uuid(); r text:=gen_random_uuid()::text;
 s jsonb; w jsonb; draft jsonb; rec jsonb; ap jsonb; snap jsonb; rev integer; ev bigint; key text;
begin
 insert into auth.users(id) values(d);
 insert into public.workspace_clinics(id,name) values(cl,'Fictional report regression clinic');
 insert into public.workspace_staff(user_id,role,display_name,clinic_id) values(d,'doctor','Fictional',cl);
 draft:='{"explanation":"Checked","instructions":"Reviewed instructions","followUp":"","medicationName":"","medicationDose":"","medicationInstructions":"","medicationTimes":[]}';
 w:=jsonb_build_object('version',1,'revision',0,'startedAt','2026-10-11T00:00:00Z','tests','[]'::jsonb,'receivedTestIds','[]'::jsonb,'allResultsAt',now(),'consultation','not-required','draft',draft,'draftSaved',false,'publication',null,'events','[]'::jsonb);
 s:=jsonb_build_object('version',1,'userId',c,'expiresAt',extract(epoch from now()+interval '1 day')*1000,'state',jsonb_build_object('consentAccepted',true,'assessment',jsonb_build_object('completedAt',now(),'urgentRule',null)));
 perform public.workspace_create_case(c,s,d);
 rev:=public.workspace_initialize_workflow(c,0,w);
 rec:=jsonb_build_object('id',r,'user_id',c,'revision',0,'state','confirmed','reviewed',jsonb_build_object('rows','[]'::jsonb));
 perform public.workspace_write_report(c,r,'insert',null,rec);
 select record into rec from public.workspace_case_reports where case_id=c and id=r;
 select evidence_revision into ev from public.workspace_cases where id=c;
 rev:=public.workspace_save_review_draft(c,d,rev,ev,draft);
 begin
  perform public.workspace_publish_review(c,d,rev,ev);raise exception 'TEST: unapproved report published';
 exception when others then if sqlerrm not like '%approve every%' then raise; end if; end;
 if (select revision from public.workspace_cases where id=c)<>rev then raise exception 'TEST: failed publish changed case revision'; end if;
 ap:=jsonb_build_object('revision',0,'doctor','Fictional','at',now(),'report',rec);
 perform public.workspace_write_report(c,r,'approve',0,null,ap,d);
 select evidence_revision into ev from public.workspace_cases where id=c;
 rev:=public.workspace_save_review_draft(c,d,rev,ev,draft);
 rev:=public.workspace_publish_review(c,d,rev,ev);
 select published into snap from public.workspace_case_reports where case_id=c and id=r;
 select (state#>>'{workflow,startedAt}')||':'||(state#>>'{workflow,publication,workflowRevision}') into key from public.workspace_cases where id=c;
 if snap->>'key' is distinct from key or snap->'approval' is distinct from ap then raise exception 'TEST: first snapshot/key differs from approved report'; end if;
 rec:=jsonb_set(rec,'{revision}','1');
 perform public.workspace_write_report(c,r,'update',1,rec,null,d);
 if (select published from public.workspace_case_reports where case_id=c and id=r) is distinct from snap then raise exception 'TEST: editing changed published snapshot'; end if;
 select evidence_revision into ev from public.workspace_cases where id=c;
 rev:=public.workspace_save_review_draft(c,d,rev,ev,draft);
 begin
  perform public.workspace_publish_review(c,d,rev,ev);raise exception 'TEST: stale approval published';
 exception when others then if sqlerrm not like '%approve every%' then raise; end if; end;
 ap:=jsonb_set(jsonb_set(ap,'{revision}','1'),'{report}',rec);
 perform public.workspace_write_report(c,r,'approve',2,null,ap,d);
 select evidence_revision into ev from public.workspace_cases where id=c;
 rev:=public.workspace_save_review_draft(c,d,rev,ev,draft);
 rev:=public.workspace_publish_review(c,d,rev,ev);
 select published into snap from public.workspace_case_reports where case_id=c and id=r;
 if snap#>>'{approval,revision}' is distinct from '1' then raise exception 'TEST: second publication has old report'; end if;
 select state into s from public.workspace_cases where id=c;
 begin
  perform public.workspace_save_case(c,rev,s,'forged:key');raise exception 'TEST: caller supplied publication key accepted';
 exception when others then if sqlerrm not like '%publication command%' then raise; end if; end;
 begin
  perform public.workspace_save_case(c,rev-1,s);raise exception 'TEST: stale member revision accepted';
 exception when others then if sqlerrm not like '%workspace case conflict%' then raise; end if; end;
 rev:=public.workspace_save_case(c,rev,jsonb_set(s,'{display}','"ordinary member save"'));
 if (select published from public.workspace_case_reports where case_id=c and id=r) is distinct from snap then raise exception 'TEST: ordinary save changed report snapshot'; end if;
end $$;
rollback;
