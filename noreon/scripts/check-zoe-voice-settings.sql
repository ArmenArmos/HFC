-- Isolated replay only. No hosted data: the check runner chooses the lane/CI database.
begin;
do $$
begin
 if not (select relrowsecurity from pg_class where oid='public.voice_settings'::regclass) then
  raise exception 'Voice settings must have RLS';
 end if;
 if exists(select 1 from pg_policies where schemaname='public' and tablename='voice_settings') then
  raise exception 'Voice settings must have no client policies';
 end if;
 if has_table_privilege('anon','public.voice_settings','select') or has_table_privilege('authenticated','public.voice_settings','select') then
  raise exception 'Client roles must not read voice settings';
 end if;
 if not has_table_privilege('service_role','public.voice_settings','select') then
  raise exception 'Server must be able to read voice settings';
 end if;
 if (select count(*) from public.voice_settings)<>1 then raise exception 'Voice settings must have one row'; end if;
 begin
  insert into public.voice_settings(id) values(false);
  raise exception 'False singleton id unexpectedly accepted';
 exception when check_violation then null;
 end;
end $$;
set local role service_role;
update public.voice_settings set enabled=false,tts_voice='Synthetic voice',version=version+1,updated_at=now() where id=true;
do $$ begin
 if (select enabled from public.voice_settings where id=true) then raise exception 'Server settings update failed'; end if;
end $$;
rollback;
