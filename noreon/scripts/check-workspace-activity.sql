begin;
do $$
declare c uuid:=gen_random_uuid(); n integer; s jsonb;
begin
 if has_table_privilege('anon','public.workspace_activity','select') or has_table_privilege('authenticated','public.workspace_notifications','select') then raise exception 'inbox exposed'; end if;
 if has_table_privilege('service_role','public.workspace_activity','update') or has_table_privilege('service_role','public.workspace_activity','delete') then raise exception 'audit mutable'; end if;
 if has_function_privilege('authenticated','public.workspace_save_case_audited(uuid,integer,jsonb,uuid,text)','execute') then raise exception 'audit RPC exposed'; end if;
 s:=jsonb_build_object('userId',c::text,'workflow',jsonb_build_object('bookings','[]'::jsonb,'receivedTestIds','[]'::jsonb,'consultation','undecided','appointment',null));
 insert into public.workspace_cases(id,state) values(c,s);
 perform 1 from public.workspace_cases where id=c for update;
 perform public.workspace_save_case_audited(c,0,s);
 if exists(select 1 from public.workspace_activity where case_id=c and kind in ('booking.changed','results.updated','consultation.changed','appointment.changed')) then raise exception 'empty workflow generated false events'; end if;
 s:=jsonb_set(s,'{workflow,consultation}','"required"');
 perform public.workspace_save_case_audited(c,1,s);
 if not exists(select 1 from public.workspace_activity where case_id=c and kind='consultation.changed' and actor_id='member:'||c) then raise exception 'missing attributed audit event'; end if;
 select count(*) into n from public.workspace_activity where case_id=c;
 begin perform public.workspace_save_case_audited(c,1,s); raise exception 'stale save accepted'; exception when others then if sqlerrm='stale save accepted' then raise; end if; end;
 if n<>(select count(*) from public.workspace_activity where case_id=c) then raise exception 'failed save wrote audit'; end if;
 perform set_config('noreon.actor','system',true);perform set_config('noreon.actor_label','System',true);
 s:=jsonb_set(s,'{workflow,publication}',jsonb_build_object('at',now()));
 update public.workspace_cases set state=s,revision=revision+1 where id=c;
 if not exists(select 1 from public.workspace_notifications n join public.workspace_activity e on e.id=n.event_id where e.case_id=c and e.kind='plan.published' and n.recipient='member:'||c) then raise exception 'publication notification missing'; end if;
 s:=jsonb_set(s,'{workflow,draft}',jsonb_build_object('explanation','private text'));
 update public.workspace_cases set state=s,revision=revision+1 where id=c;
 if exists(select 1 from public.workspace_notifications n join public.workspace_activity e on e.id=n.event_id where e.case_id=c and e.kind='draft.saved') then raise exception 'draft leaked'; end if;
 if exists(select 1 from public.workspace_activity where case_id=c and actor_label like '%private text%') then raise exception 'clinical text leaked'; end if;
end $$;
rollback;
