begin;
do $$
declare c uuid:=gen_random_uuid(); r text:=gen_random_uuid()::text; path text; candidate text; n integer;
begin
 path:=c||'/'||r||'/'||gen_random_uuid();
 perform public.workspace_create_case(c,jsonb_build_object('userId',c,'expiresAt',extract(epoch from now()+interval '1 day')*1000),null);
 perform public.workspace_write_report(c,r,'insert',null,jsonb_build_object('id',r,'user_id',c,'object_path',path));
 -- An upload attempt may be discarded only when no live original references it.
 if public.workspace_write_report(c,r,'discard-upload',null,jsonb_build_object('object_path',path))<>0 then raise exception 'TEST: live original queued for cleanup';end if;
 if exists(select 1 from public.workspace_report_cleanup where object_path=path) then raise exception 'TEST: live original cleanup entry';end if;
 candidate:=c||'/'||r||'/'||gen_random_uuid();
   if public.workspace_write_report(c,r,'discard-upload',null,jsonb_build_object('object_path',candidate))<>1 then raise exception 'TEST: orphan candidate not queued';end if;
   if not exists(select 1 from public.workspace_report_cleanup where object_path=candidate) then raise exception 'TEST: candidate queue lost';end if;
   begin
     perform public.workspace_write_report(c,r,'discard-upload',null,jsonb_build_object('object_path',gen_random_uuid()||'/'||r||'/'||gen_random_uuid()));
     raise exception 'TEST: another case path accepted';
   exception when others then if sqlerrm<>'invalid upload path' then raise;end if;end;
 begin
   perform public.workspace_write_report(c,r,'delete',99);
   raise exception 'TEST: conflicting delete accepted';
 exception when others then if sqlerrm<>'conflict' then raise; end if; end;
 if exists(select 1 from public.workspace_report_cleanup where object_path=path) then raise exception 'TEST: conflict queued a live file'; end if;
 perform public.workspace_write_report(c,r,'delete',0);
 if not exists(select 1 from public.workspace_report_cleanup where object_path=path) then raise exception 'TEST: successful deletion lost cleanup path'; end if;
 -- Rollback must undo both removal and queued cleanup.
 perform public.workspace_write_report(c,r,'insert',null,jsonb_build_object('id',r,'user_id',c,'object_path',path||'.second'));
 begin
  perform public.workspace_write_report(c,r,'delete',0);
  raise exception 'forced rollback';
 exception when others then if sqlerrm<>'forced rollback' then raise; end if; end;
 if not exists(select 1 from public.workspace_case_reports where case_id=c and id=r) or exists(select 1 from public.workspace_report_cleanup where object_path=path||'.second') then raise exception 'TEST: rollback was not atomic'; end if;
 perform 1 from public.workspace_cases where id=c for update;
 update public.workspace_cases set expires_at=now()-interval '1 second' where id=c;
 perform public.workspace_delete_expired_case(c);
 if not exists(select 1 from public.workspace_report_cleanup where object_path=path||'.second') then raise exception 'TEST: expiry lost cleanup path'; end if;
 if has_table_privilege('anon','public.workspace_report_cleanup','select') or has_table_privilege('authenticated','public.workspace_report_cleanup','select') then raise exception 'TEST: cleanup paths exposed'; end if;
end $$;
rollback;
