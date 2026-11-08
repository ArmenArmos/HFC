begin;
do $$
declare c uuid:=gen_random_uuid(); s jsonb;
begin
 s:=jsonb_build_object('userId',c,'workflow',jsonb_build_object('startedAt','2026-10-11T00:00:00Z','draft',jsonb_build_object('instructions','Original'),'draftSaved',false,'publication',null));
 insert into public.workspace_cases(id,state) values(c,s);
 begin
  perform public.workspace_save_case(c,0,jsonb_set(s,'{workflow,draft,instructions}','"Unauthorized change"'));
  raise exception 'TEST: generic save changed protected draft';
 exception when others then
  if sqlerrm<>'Protected review fields require an explicit command.' then raise; end if;
 end;
 if has_function_privilege('anon','public.workspace_publish_review(uuid,uuid,integer,bigint)','execute')
 or has_function_privilege('authenticated','public.workspace_save_review_draft(uuid,uuid,integer,bigint,jsonb,jsonb)','execute')
 or has_function_privilege('service_role','public.workspace_review_doctor(uuid,uuid)','execute') then raise exception 'TEST: review boundary grants too broad'; end if;
end $$;
rollback;
