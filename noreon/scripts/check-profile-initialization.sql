begin;
do $$
declare c uuid:=gen_random_uuid(); s jsonb;w jsonb;rev integer;
begin
 s:=jsonb_build_object('version',1,'userId',c,'expiresAt',extract(epoch from now()+interval '1 day')*1000,'measurements','[]'::jsonb,'state',jsonb_build_object('profile',null,'consentAccepted',false,'assessment',null));
 perform public.workspace_create_case(c,s);
 w:=jsonb_build_object('version',1,'revision',0,'startedAt',now(),'tests','[]'::jsonb,'bookings','[]'::jsonb,'receivedTestIds','[]'::jsonb,'allResultsAt',null,'consultation','undecided','draft','{}'::jsonb,'draftSaved',false,'publication',null);
 rev:=public.workspace_initialize_workflow(c,0,w);
 select state into s from public.workspace_cases where id=c;
 s:=jsonb_set(s,'{state,profile}','{"name":"Fictional first profile","birthDate":"1980-01-01","biologicalSex":"male","locale":"en"}');
 s:=jsonb_set(s,'{state,consentAccepted}','true');
 rev:=public.workspace_save_case(c,rev,s);
 if not exists(select 1 from public.workspace_cases where id=c and revision=rev and state#>>'{state,profile,name}'='Fictional first profile') then raise exception 'TEST: first profile not saved';end if;
 if public.workspace_evidence_projection('{"state":{"profile":null}}')->'profile' is distinct from 'null'::jsonb then raise exception 'TEST: null profile projection';end if;
end $$;
rollback;
